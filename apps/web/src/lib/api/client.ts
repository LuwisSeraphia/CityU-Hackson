import type {
  ApiErrorBody,
  RecordAccepted,
  RecordRequest,
  ProcessingJob,
  ChatRequest,
  FactDetailResponse,
  JobAccepted,
} from "@/types/api";
import {
  accepted,
  recordAccepted,
  processingJob,
  factDetail,
} from "./contracts";
import { readChatEvents } from "./sse";
import { validateMessage } from "@/lib/validation";

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail?: ApiErrorBody["error"],
  ) {
    super(
      detail?.message ??
        (status === 405
          ? "当前后端未加载此操作接口，请重启后端服务后重试。"
          : "服务暂时不可用，请稍后重试。"),
    );
  }
}

/** Transport only. Never falls back to Mock on a real service error. */
export class ApiClient {
  constructor(
    private baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ??
      "http://127.0.0.1:8000/api/v1",
  ) {}
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(response.status, body?.error);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  async record(
    input: RecordRequest,
    idempotencyKey: string,
  ): Promise<RecordAccepted> {
    const invalid = validateMessage(input.text);
    if (invalid) throw new Error(invalid);
    return recordAccepted(
      await this.request<unknown>("/memory/records", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
      }),
    );
  }
  async job(id: string, signal?: AbortSignal): Promise<ProcessingJob> {
    return processingJob(
      await this.request<unknown>(`/memory/jobs/${encodeURIComponent(id)}`, {
        signal,
      }),
    );
  }
  approve(id: string, baseVersionId: string) {
    return this.request<unknown>(
      `/memory/proposals/${encodeURIComponent(id)}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ base_version_id: baseVersionId }),
      },
    );
  }
  reject(id: string) {
    return this.request<unknown>(
      `/memory/proposals/${encodeURIComponent(id)}/reject`,
      { method: "POST" },
    );
  }
  recordResult(id: string) {
    return this.request<unknown>(`/memory/records/${encodeURIComponent(id)}`);
  }
  proposals(conversationId: string) {
    return this.request<unknown>(
      `/memory/proposals?conversation_id=${encodeURIComponent(conversationId)}`,
    );
  }
  messages(conversationId: string) {
    return this.request<unknown>(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
  }
  async fact(id: string): Promise<FactDetailResponse> {
    return factDetail(
      await this.request<unknown>(`/memory/facts/${encodeURIComponent(id)}`),
    );
  }
  async reviseFact(
    id: string,
    baseVersionId: string,
    text: string,
  ): Promise<FactDetailResponse> {
    const invalid = validateMessage(text);
    if (invalid) throw new Error(invalid);
    return factDetail(
      await this.request<unknown>(`/memory/facts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ base_version_id: baseVersionId, text }),
      }),
    );
  }
  async deleteFact(id: string, baseVersionId: string): Promise<JobAccepted> {
    return accepted(
      await this.request<unknown>(`/memory/facts/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({
          base_version_id: baseVersionId,
          scope: "fact_and_versions",
          preserve_sources: true,
        }),
      }),
    );
  }
  health(kind: "live" | "ready") {
    return this.request<unknown>(`/health/${kind}`);
  }
  async waitForJob(
    id: string,
    options: {
      signal?: AbortSignal;
      intervalMs?: number;
      maxAttempts?: number;
      onStage?: (job: ProcessingJob) => void;
    } = {},
  ) {
    for (let attempt = 0; attempt < (options.maxAttempts ?? 60); attempt++) {
      options.signal?.throwIfAborted();
      const job = await this.job(id, options.signal);
      options.onStage?.(job);
      if (["INDEXED", "PENDING_REVIEW", "FAILED"].includes(job.stage))
        return job;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(options.signal?.reason);
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", abort);
          resolve();
        }, options.intervalMs ?? 1000);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    }
    throw new Error(
      "任务仍在处理，请稍后按任务编号查询；不要重新创建原始记录。",
    );
  }
  async *chat(input: ChatRequest, signal?: AbortSignal) {
    const invalid = validateMessage(input.text);
    if (invalid) throw new Error(invalid);
    const response = await fetch(`${this.baseUrl}/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Idempotency-Key": input.request_id,
      },
      body: JSON.stringify(input),
      signal: signal ?? AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const body = (await response
        .json()
        .catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(response.status, body?.error);
    }
    if (
      !response.headers.get("content-type")?.includes("text/event-stream") ||
      !response.body
    )
      throw new Error("服务没有返回有效的回答流。");
    yield* readChatEvents(response.body);
  }
}
