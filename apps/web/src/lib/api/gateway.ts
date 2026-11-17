import type {
  Conversation,
  Evidence,
  MemoryGateway,
  MemoryPage,
  OperationProgress,
  SendInput,
  WorkspaceSnapshot,
} from "@/types/memory";
import { ApiClient } from "./client";

export interface ServiceHealth {
  database: boolean;
  model_configured: boolean;
  api_token_configured: boolean;
  worker: boolean;
  message?: string;
  model: string;
}
export interface AgentInsights {
  core: { id: string; content: string; kind: string }[];
  summary?: { text: string; message_ids: string[] };
  jobs_pending: number;
  last_run?: {
    id: string;
    status: string;
    events: { name: string; status: string; elapsed: number }[];
    usage: { model?: string; provider_request_id?: string }[];
    warnings: string[];
  };
}
export interface UploadedFile {
  id: string;
  name: string;
  status: string;
}
export interface RunStatus {
  id: string;
  status: string;
  stage: string;
  active_tool?: string;
  events: { name: string; status: string; elapsed: number }[];
}

export const toolLabels: Record<string, string> = {
  search_memory: "检索个人记忆",
  get_memory_history: "查阅记忆版本",
  get_source: "回查原始记录",
  web_search: "联网搜索",
  read_web_page: "读取网页",
  search_files: "检索会话文件",
  read_file: "读取文件片段",
  propose_memory: "整理记忆候选",
  forget_request: "准备删除确认",
};

export class RealGateway extends EventTarget implements MemoryGateway {
  v2Enabled = false;
  responseOptions?: import("./v2").ResponseOptions;
  private snapshots = new Map<
    string,
    { skip: boolean; options?: import("./v2").ResponseOptions }
  >();
  setV2Enabled(value: boolean) {
    this.v2Enabled = value;
  }
  setResponseOptions(value?: import("./v2").ResponseOptions) {
    this.responseOptions = value;
  }
  readonly mode = "api" as const;
  readonly client = new ApiClient("/api/agent");
  private skipNext = false;
  setSkipMemory(value: boolean) {
    this.skipNext = value;
  }
  currentRun?: string;
  private loading?: Promise<WorkspaceSnapshot>;
  request<T>(path: string, init?: RequestInit) {
    return this.client.request<T>(path, init);
  }
  load() {
    // Strict Mode may mount twice; never create duplicate initial conversations.
    return (this.loading ??= this.request<WorkspaceSnapshot>(
      "/workspace",
    ).finally(() => {
      this.loading = undefined;
    }));
  }
  createConversation() {
    return this.request<Conversation>("/conversations", {
      method: "POST",
      body: "{}",
    });
  }
  async deleteConversation(id: string) {
    await this.request(`/conversations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  conversation(id: string) {
    return this.request<Conversation>(
      `/conversations/${encodeURIComponent(id)}`,
    );
  }
  async send(
    input: SendInput,
    onProgress?: (progress: OperationProgress) => void,
  ) {
    const progress = (stage: OperationProgress["stage"], text?: string) =>
      onProgress?.({ stage, text, conversationId: input.conversationId });
    if (input.mode === "record" && this.v2Enabled) {
      const { mutation } = await import("./v2");
      const result = await mutation<{ job_id: string }>("/memory/records", {
        conversation_id: input.conversationId,
        text: input.text,
        request_id: input.requestId,
        mode: "explicit",
      });
      this.dispatchEvent(
        new CustomEvent("memory-job", {
          detail: { id: result.job_id, conversationId: input.conversationId },
        }),
      );
      return this.conversation(input.conversationId);
    }
    if (input.mode === "record") {
      const accepted = input.retryMessageId
        ? await this.request<{ job_id: string }>(
            `/messages/${input.retryMessageId}/retry-memory`,
            { method: "POST" },
          )
        : await this.request<{ job_id: string }>("/memory/records", {
            method: "POST",
            headers: { "Idempotency-Key": input.requestId },
            body: JSON.stringify({
              conversation_id: input.conversationId,
              text: input.text,
            }),
          });
      for (let attempt = 0; attempt < 180; attempt++) {
        const job = await this.request<{ state: string; stage: string }>(
          `/memory/jobs/${accepted.job_id}`,
        );
        if (!["QUEUED", "RUNNING"].includes(job.state))
          return this.conversation(input.conversationId);
        progress(job.stage === "INDEXING" ? "indexing" : "extracting");
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      throw new Error(
        `记忆仍在后台处理。任务 ${accepted.job_id} 已保留，请刷新查看，不必重复提交。`,
      );
    }
    if (!this.snapshots.has(input.requestId))
      this.snapshots.set(input.requestId, {
        skip: this.skipNext,
        options: this.responseOptions,
      });
    const snapshot = this.snapshots.get(input.requestId)!;
    const accepted = await this.request<{ run_id: string }>("/agent/runs", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: input.conversationId,
        text: input.text,
        request_id: input.requestId,
        retry_message_id: input.retryMessageId,
        memory_policy_override: snapshot.skip ? "skip" : "default",
        response_options: this.v2Enabled ? snapshot.options : undefined,
      }),
    });
    this.currentRun = accepted.run_id;
    try {
      for (let attempt = 0; attempt < 210; attempt++) {
        const run = await this.request<RunStatus>(
          `/agent/runs/${accepted.run_id}`,
        );
        if (run.status !== "RUNNING") {
          if (run.status === "SUCCEEDED") {
            this.skipNext = false;
            this.responseOptions = undefined;
            this.dispatchEvent(new Event("sent"));
          }
          return this.conversation(input.conversationId);
        }
        progress(
          run.stage === "retrieving" ? "retrieving" : "generating",
          run.stage === "tool"
            ? `正在${toolLabels[run.active_tool ?? ""] ?? "执行工具"}…`
            : undefined,
        );
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      throw new Error(
        `回答仍在后台处理。运行 ${accepted.run_id} 已保留，请刷新查看。`,
      );
    } finally {
      this.currentRun = undefined;
    }
  }
  async cancel() {
    if (this.currentRun)
      await this.request(`/agent/runs/${this.currentRun}/cancel`, {
        method: "POST",
      });
  }
  async decide(input: Parameters<MemoryGateway["decide"]>[0]) {
    await this.request(
      `/memory/proposals/${input.proposalId}/${input.decision}`,
      {
        method: "POST",
        body: JSON.stringify({ base_version_id: input.baseVersionId }),
      },
    );
    return this.conversation(input.conversationId);
  }
  evidence(id: string) {
    return this.request<Evidence>(`/evidence/${encodeURIComponent(id)}`);
  }
  listMemories(query: Parameters<MemoryGateway["listMemories"]>[0]) {
    return this.request<MemoryPage>(
      `/memory/library?${new URLSearchParams({ query: query.query, kind: query.kind, page: String(query.page) })}`,
    );
  }
  reviseFact(input: Parameters<MemoryGateway["reviseFact"]>[0]) {
    return this.request<Evidence>(`/memory/facts/${input.factId}`, {
      method: "PATCH",
      body: JSON.stringify({
        base_version_id: input.baseVersionId,
        text: input.text,
      }),
    });
  }
  async deleteFact(input: Parameters<MemoryGateway["deleteFact"]>[0]) {
    await this.request(`/memory/facts/${input.factId}`, {
      method: "DELETE",
      body: JSON.stringify({
        base_version_id: input.baseVersionId,
        scope: "fact_and_versions",
        preserve_sources: true,
      }),
    });
  }
  private async proposalId(conversationId: string, messageId: string) {
    const conversation = await this.conversation(conversationId);
    const id = conversation.messages.find((message) => message.id === messageId)
      ?.receipt?.proposal?.id;
    if (!id) throw new Error("候选已不可用，请刷新会话。");
    return id;
  }
  async editProposal(input: Parameters<MemoryGateway["editProposal"]>[0]) {
    const id = await this.proposalId(input.conversationId, input.messageId);
    await this.request(`/memory/proposals/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ text: input.text }),
    });
    return this.conversation(input.conversationId);
  }
  async refreshProposal(conversationId: string, messageId: string) {
    const id = await this.proposalId(conversationId, messageId);
    await this.request(`/memory/proposals/${id}/refresh`, {
      method: "POST",
      body: "{}",
    });
    return this.conversation(conversationId);
  }
  health() {
    return this.request<ServiceHealth>("/health/ready");
  }
  policy() {
    return this.request<{ enabled: boolean }>("/settings/memory");
  }
  setPolicy(enabled: boolean) {
    return this.request<{ enabled: boolean }>("/settings/memory", {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  }
  insights(id: string) {
    return this.request<AgentInsights>(`/conversations/${id}/insights`);
  }
  files(id: string) {
    return this.request<UploadedFile[]>(`/conversations/${id}/files`);
  }
  async upload(
    id: string,
    file: File,
    signal: AbortSignal,
  ): Promise<UploadedFile> {
    if (file.size > 20 * 1024 * 1024) throw new Error("文件不能超过 20 MB。");
    if (!/\.(txt|md|pdf|docx)$/i.test(file.name))
      throw new Error("请选择 TXT、MD、PDF 或 DOCX 文件。");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/agent/conversations/${id}/files`, {
      method: "POST",
      body: form,
      signal,
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        body.error?.message ?? "文件上传失败，可重新选择并重试。",
      );
    return body as UploadedFile;
  }
}
