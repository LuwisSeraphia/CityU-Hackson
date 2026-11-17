import type {
  Conversation,
  Evidence,
  MemoryGateway,
  Message,
  ProposalInput,
  SendInput,
  OperationProgress,
  OperationStage,
} from "@/types/memory";
import { seedConversations } from "./fixtures";
import { validateMessage } from "@/lib/validation";
import { createMemoryStore } from "./memory-store";

/** Deterministic demo, not an Extractor/Resolver implementation. State lives in this page only. */
export function createMockGateway(delayMs = 650): MemoryGateway {
  const conversations = structuredClone(seedConversations);
  const memory = createMemoryStore();
  const sources = memory.evidence;
  const requests = new Map<string, Promise<Conversation>>();
  const delay = () =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID();
  const conversation = (key: string) => {
    const found = conversations.find((item) => item.id === key);
    if (!found) throw new Error("找不到这段会话，请重新选择。");
    return found;
  };
  function answer(
    text: string,
    retry = false,
  ): Pick<Message, "text" | "citations" | "answer"> {
    let evidence: Evidence[] = [];
    const interrupted = text.startsWith("演示回答中断：") && !retry;
    const unavailable = text.startsWith("演示服务不可用：") && !retry;
    const degraded = text.startsWith("演示检索降级：");
    if (unavailable)
      return {
        text: "本次演示的检索服务不可用，未生成回答。",
        citations: [],
        answer: {
          status: "unavailable",
          warnings: ["读取失败不能视为没有相关记忆。"],
          traceId: id(),
          retryText: text,
        },
      };
    if (/之前|以前|历史/.test(text)) {
      evidence = sources.filter(
        (item) =>
          ["current", "historical"].includes(item.status) &&
          item.kind === "fact",
      );
    } else if (/第一阶段|目标/.test(text)) {
      evidence = sources.filter(
        (item) => item.status === "current" && item.title === "第一阶段目标",
      );
    } else if (/计划|将来/.test(text)) {
      evidence = sources.filter((item) => item.status === "planned");
    } else if (/技术|方案|架构|项目|Personal Agent/i.test(text)) {
      evidence = sources.filter(
        (item) =>
          item.status === "current" &&
          (item.id === "source-project" || item.factId === "fact-source-stack"),
      );
    } else if (/阅读/.test(text)) {
      evidence = sources.filter(
        (item) => item.status === "current" && item.id === "source-reading",
      );
    } else if (/记住|最近|记录|记忆/.test(text)) {
      evidence = sources.filter((item) => item.status === "current").slice(-3);
    }
    const result = evidence.length
      ? {
          text: `${/为什么|原因/.test(text) ? "当前记录没有明确说明决策原因，我不能据此推断。\n\n" : ""}在演示记忆中，找到了这些记录：\n\n${evidence.map((item) => `${item.status === "historical" ? "曾经：" : item.status === "planned" ? "计划（尚未发生）：" : "当前："}${item.text}`).join("\n\n")}`,
          citations: evidence.map((item) => item.id),
        }
      : {
          text: "当前演示记忆中没有与这个问题相关的记录。我还不能据此回答。\n\n你可以切换到「记录到记忆」补充信息，或试试下方的演示问题。",
          citations: [],
        };
    return {
      ...result,
      ...(interrupted ? { text: result.text.slice(0, 48), citations: [] } : {}),
      answer: {
        status: interrupted
          ? "interrupted"
          : !evidence.length
            ? "insufficient"
            : degraded
              ? "partial"
              : "complete",
        warnings: degraded ? ["演示：重排服务超时，已使用基础检索结果。"] : [],
        traceId: id(),
        ...(interrupted ? { retryText: text } : {}),
      },
    };
  }
  function record(
    text: string,
    retry: boolean,
    originalSourceId?: string,
  ): Pick<Message, "text" | "receipt"> {
    const normalized = text.replace(
      /^演示(?:处理失败|索引失败|未来计划|零候选)：/,
      "",
    );
    const original =
      memory.records.find((item) => item.id === originalSourceId) ??
      memory.source(normalized);
    if (text.startsWith("演示处理失败：") && !retry) {
      return {
        text: "这次演示记录未完成处理，尚未加入记忆。",
        receipt: {
          kind: "failed",
          summary: "模拟的处理服务暂时不可用。原文仍在这里，可以重试。",
          sourceIds: [`raw:${original.id}`],
          originalSourceId: original.id,
          retryText: text,
        },
      };
    }
    if (text.startsWith("演示零候选："))
      return {
        text: "原始内容已收到，但本次演示没有提取到可确认的事实或事件。",
        receipt: {
          kind: "noop",
          summary: "未形成长期事实，不会用于回答",
          sourceIds: [`raw:${original.id}`],
          originalSourceId: original.id,
        },
      };
    const duplicate = sources.find(
      (item) => item.status === "current" && item.text === normalized,
    );
    if (duplicate) {
      duplicate.sourceIds = [...(duplicate.sourceIds ?? []), original.id];
      return {
        text: "这条内容与已有演示记忆一致，已关联到原记录。",
        receipt: {
          kind: "merged",
          summary: "相同内容已合并，没有重复新增记忆",
          sourceIds: [duplicate.id],
        },
      };
    }
    const isUpdate = normalized.startsWith("我决定把项目的第一阶段目标改为：");
    const previous = sources.find(
      (item) => item.title === "第一阶段目标" && item.status === "current",
    );
    const source: Evidence = {
      id: id(),
      title: isUpdate ? "第一阶段目标" : "新的记录",
      text: normalized,
      kind: isUpdate ? "fact" : "episode",
      version: isUpdate ? (previous?.version ?? 0) + 1 : 1,
      createdAt: now(),
      status:
        isUpdate && previous
          ? "pending"
          : text.startsWith("演示未来计划：")
            ? "planned"
            : "current",
      sourceIds: [original.id],
      ...(isUpdate ? { factId: previous?.factId ?? id() } : {}),
    };
    sources.push(source);
    if (isUpdate && previous)
      return {
        text: "这条记录改变了已有的阶段目标。请确认是否采用新的内容。",
        receipt: {
          kind: "pending",
          summary: "第一阶段目标有变化",
          sourceIds: [source.id],
          proposal: {
            id: id(),
            baseVersionId: previous.id,
            before: previous.text,
            after: normalized,
            status: "pending",
            factId: previous.factId,
            reason: "阶段目标发生重要变化，需要由你审核后采用。",
            createdAt: now(),
          },
        },
      };
    return {
      text: "已将原文加入本页的演示记忆。你可以查看来源，或在新会话里回顾最近的记录。",
      receipt: {
        kind: "added",
        summary: "新增 1 条原文记录",
        sourceIds: [source.id],
      },
    };
  }
  async function performSend(
    input: SendInput,
    onProgress?: (progress: OperationProgress) => void,
  ) {
    const error = validateMessage(input.text);
    if (error) throw new Error(error);
    const target = conversation(input.conversationId);
    const progress = async (stage: OperationStage) => {
      onProgress?.({ stage, conversationId: input.conversationId });
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs / 3));
    };
    const retryMessage = input.retryMessageId
      ? target.messages.find((item) => item.id === input.retryMessageId)
      : undefined;
    if (
      input.retryMessageId &&
      (!retryMessage ||
        (!["failed", "partial"].includes(retryMessage.receipt?.kind ?? "") &&
          !retryMessage.answer?.retryText))
    )
      throw new Error("这条记录已经处理，请勿重复重试。");
    if (retryMessage?.receipt?.processing?.indexStatus === "FAILED") {
      await progress("indexing");
      retryMessage.receipt.processing.indexStatus = "READY";
      retryMessage.receipt.processing.failed = 0;
      retryMessage.receipt.kind = "added";
      retryMessage.receipt.summary =
        "索引已重新同步，没有重新提取或重复新增记忆";
      retryMessage.text = "演示索引已恢复，这条记录现在可正常检索。";
      delete retryMessage.receipt.retryText;
      return structuredClone(target);
    }
    if (input.mode === "record") {
      await progress("received");
      await progress("extracting");
      await progress("resolving");
    } else {
      await progress("retrieving");
      await progress("generating");
    }
    const result: Pick<Message, "text"> &
      Partial<Pick<Message, "receipt" | "citations" | "answer">> =
      input.mode === "ask"
        ? answer(input.text, Boolean(input.retryMessageId))
        : record(
            input.text.trim(),
            Boolean(input.retryMessageId),
            retryMessage?.receipt?.originalSourceId,
          );
    if (input.mode === "ask" && result.answer?.status !== "unavailable") {
      for (let part = 1; part <= 3; part++) {
        onProgress?.({
          stage: "generating",
          conversationId: input.conversationId,
          text: result.text.slice(
            0,
            Math.ceil((result.text.length * part) / 3),
          ),
        });
        await delay();
      }
    }
    if (result.receipt) {
      const receipt = result.receipt;
      const committed = ["added", "merged"].includes(receipt.kind);
      if (committed) await progress("indexing");
      receipt.processing = {
        sourceStatus:
          receipt.kind === "failed"
            ? "FAILED"
            : committed
              ? "COMMITTED"
              : "RECEIVED",
        indexStatus: committed ? "READY" : "NOT_STARTED",
        traceId: id(),
        addedEpisodes:
          receipt.kind === "added"
            ? sources.filter(
                (item) =>
                  receipt.sourceIds.includes(item.id) &&
                  item.kind === "episode",
              ).length
            : 0,
        addedFacts:
          receipt.kind === "added"
            ? sources.filter(
                (item) =>
                  receipt.sourceIds.includes(item.id) && item.kind === "fact",
              ).length
            : 0,
        pending: receipt.proposal ? 1 : 0,
        failed: receipt.kind === "failed" ? 1 : 0,
      };
      if (input.text.startsWith("演示索引失败：") && committed) {
        receipt.kind = "partial";
        receipt.processing.indexStatus = "FAILED";
        receipt.processing.failed = 1;
        receipt.retryText = input.text;
        receipt.summary = "原文已提交，索引同步失败";
        result.text =
          "这条演示记忆已经提交，但索引尚未完成。你可以仅重试索引同步。";
      }
    }
    if (input.retryMessageId) {
      const message = target.messages.find(
        (item) => item.id === input.retryMessageId,
      );
      if (!message) throw new Error("这条记录已经处理，请勿重复重试。");
      Object.assign(message, result);
    } else {
      if (target.messages.length === 0)
        target.title = input.text.trim().slice(0, 24);
      target.messages.push({
        id: id(),
        role: "user",
        mode: input.mode,
        text: input.text.trim(),
        createdAt: now(),
      });
      target.messages.push({
        id: id(),
        role: "assistant",
        createdAt: now(),
        ...result,
      });
    }
    target.updatedAt = now();
    return structuredClone(target);
  }
  return {
    mode: "mock",
    async load() {
      await delay();
      return { conversations: structuredClone(conversations) };
    },
    async deleteConversation(key: string) {
      await delay();
      const index = conversations.findIndex((item) => item.id === key);
      if (index !== -1) conversations.splice(index, 1);
    },
    async createConversation() {
      await delay();
      const created: Conversation = {
        id: id(),
        title: "新的对话",
        updatedAt: now(),
        messages: [],
      };
      conversations.unshift(created);
      return structuredClone(created);
    },
    send(input: SendInput, onProgress) {
      const existing = requests.get(input.requestId);
      if (existing) return existing;
      const result = performSend(input, onProgress).catch((error) => {
        requests.delete(input.requestId);
        throw error;
      });
      requests.set(input.requestId, result);
      return result;
    },
    async decide(input: ProposalInput) {
      await delay();
      const target = conversation(input.conversationId);
      const receipt = target.messages.find(
        (item) => item.id === input.messageId,
      )?.receipt;
      const proposal = receipt?.proposal;
      if (!receipt || !proposal || proposal.id !== input.proposalId)
        throw new Error("找不到这条更新提案。");
      if (
        proposal.status !== "pending" &&
        !(input.decision === "reject" && proposal.status === "stale")
      )
        throw new Error("这条更新已经处理。");
      const previous = sources.find((item) => item.id === input.baseVersionId);
      if (
        input.decision === "approve" &&
        (proposal.baseVersionId !== input.baseVersionId ||
          previous?.status !== "current")
      ) {
        proposal.status = "stale";
        return structuredClone(target);
      }
      proposal.status = input.decision === "approve" ? "approved" : "rejected";
      const next = sources.find((item) => item.id === receipt.sourceIds[0]);
      if (next)
        next.status = input.decision === "approve" ? "current" : "rejected";
      if (previous && input.decision === "approve")
        previous.status = "historical";
      if (receipt.processing) {
        receipt.processing.pending = 0;
        if (input.decision === "approve") {
          receipt.processing.sourceStatus = "COMMITTED";
          receipt.processing.indexStatus = "READY";
          receipt.processing.addedFacts = 1;
        }
      }
      return structuredClone(target);
    },
    async evidence(key: string) {
      await delay();
      return memory.detail(key);
    },
    async listMemories(query) {
      await delay();
      return memory.list(query);
    },
    async reviseFact(input) {
      await delay();
      return memory.revise(input);
    },
    async deleteFact(input) {
      await delay();
      memory.remove(input);
      for (const chat of conversations)
        for (const message of chat.messages) {
          const proposal = message.receipt?.proposal;
          if (
            proposal?.factId === input.factId &&
            ["pending", "stale"].includes(proposal.status)
          ) {
            proposal.status = "expired";
            if (message.receipt?.processing)
              message.receipt.processing.pending = 0;
          }
        }
    },
    async editProposal(input) {
      const error = validateMessage(input.text);
      if (error) throw new Error(error);
      await delay();
      const target = conversation(input.conversationId);
      const receipt = target.messages.find(
        (item) => item.id === input.messageId,
      )?.receipt;
      if (
        !receipt?.proposal ||
        !["pending", "stale"].includes(receipt.proposal.status)
      )
        throw new Error("这条提案已经处理，无法修改。");
      const candidate = sources.find(
        (item) => item.id === receipt.sourceIds[0],
      );
      if (!candidate || candidate.status === "deleted")
        throw new Error("事实已删除，无法修改提案。");
      const original = memory.source(input.text.trim());
      candidate.text = input.text.trim();
      candidate.sourceIds = [...(candidate.sourceIds ?? []), original.id];
      receipt.proposal.after = candidate.text;
      // Editing never commits a fact and never silently refreshes a stale approval base.
      return structuredClone(target);
    },
    async refreshProposal(conversationId, messageId) {
      await delay();
      const target = conversation(conversationId);
      const receipt = target.messages.find(
        (item) => item.id === messageId,
      )?.receipt;
      const proposal = receipt?.proposal;
      if (!proposal || proposal.status !== "stale")
        throw new Error("无需刷新此提案。");
      const latest = sources.find(
        (item) => item.factId === proposal.factId && item.status === "current",
      );
      if (!latest) {
        proposal.status = "expired";
        return structuredClone(target);
      }
      proposal.baseVersionId = latest.id;
      proposal.before = latest.text;
      proposal.status = "pending";
      const candidate = sources.find(
        (item) => item.id === receipt!.sourceIds[0],
      );
      if (candidate) candidate.version = latest.version + 1;
      return structuredClone(target);
    },
  };
}
