import { describe, expect, it } from "vitest";
import { createMockGateway } from "@/lib/mock/gateway";
import type { MemoryGateway, Message } from "@/types/memory";
const cid = "conversation-project";
const send = (
  api: MemoryGateway,
  text: string,
  mode: "ask" | "record" = "record",
) =>
  api.send({ conversationId: cid, text, mode, requestId: crypto.randomUUID() });
const last = (messages: Message[]) => messages[messages.length - 1];
const update = "我决定把项目的第一阶段目标改为：先完成工作台界面。";
describe("mock memory semantics", () => {
  it("does not write questions into memory and refuses unsupported questions", async () => {
    const api = createMockGateway(0);
    const answer = last(
      (await send(api, "我的护照号码是什么？", "ask")).messages,
    );
    expect(answer.citations).toEqual([]);
    expect(answer.receipt).toBeUndefined();
    expect(answer.text).toContain("没有与这个问题相关");
    const record = last((await send(api, "我的护照号码是什么？")).messages);
    expect(record.receipt?.kind).toBe("added");
  });
  it("merges exact duplicates and retains the source identity", async () => {
    const api = createMockGateway(0);
    const first = last((await send(api, "今天整理了我的读书笔记。")).messages);
    const second = last((await send(api, "今天整理了我的读书笔记。")).messages);
    expect(second.receipt?.kind).toBe("merged");
    expect(second.receipt?.sourceIds).toEqual(first.receipt?.sourceIds);
  });
  it("shares confirmed records across conversations", async () => {
    const api = createMockGateway(0);
    await send(api, "今天完成了前端原型。");
    const fresh = await api.createConversation();
    const result = await api.send({
      conversationId: fresh.id,
      text: "最近记录了什么？",
      mode: "ask",
      requestId: "cross-session",
    });
    expect(last(result.messages).text).toContain("今天完成了前端原型。");
  });
  it("excludes pending updates until approved, preserves original evidence", async () => {
    const api = createMockGateway(0);
    const candidate = last((await send(api, update)).messages);
    const receipt = candidate.receipt!;
    expect((await api.evidence(receipt.sourceIds[0])).status).toBe("pending");
    expect(
      last((await send(api, "第一阶段目标是什么？", "ask")).messages).text,
    ).not.toContain("先完成工作台界面");
    await api.decide({
      conversationId: cid,
      messageId: candidate.id,
      proposalId: receipt.proposal!.id,
      baseVersionId: receipt.proposal!.baseVersionId,
      decision: "approve",
    });
    expect(
      last((await send(api, "第一阶段目标是什么？", "ask")).messages).text,
    ).toContain("先完成工作台界面");
    expect((await api.evidence("source-scope")).status).toBe("historical");
  });
  it("rejects proposals without changing current evidence", async () => {
    const api = createMockGateway(0);
    const message = last((await send(api, update)).messages);
    await api.decide({
      conversationId: cid,
      messageId: message.id,
      proposalId: message.receipt!.proposal!.id,
      baseVersionId: "source-scope",
      decision: "reject",
    });
    expect((await api.evidence("source-scope")).status).toBe("current");
    expect(
      last((await send(api, "第一阶段目标是什么？", "ask")).messages).text,
    ).not.toContain("先完成工作台界面");
  });
  it("rejects approval based on stale versions", async () => {
    const api = createMockGateway(0);
    const first = last((await send(api, update)).messages);
    const second = last((await send(api, update + "下一步再测试。")).messages);
    const decision = (message: Message) =>
      api.decide({
        conversationId: cid,
        messageId: message.id,
        proposalId: message.receipt!.proposal!.id,
        baseVersionId: "source-scope",
        decision: "approve",
      });
    await decision(first);
    const conflict = await decision(second);
    expect(last(conflict.messages).receipt?.proposal?.status).toBe("stale");
    const refreshed = await api.refreshProposal(cid, second.id);
    const latest = last(refreshed.messages).receipt!.proposal!;
    expect(latest.status).toBe("pending");
    expect(latest.baseVersionId).toBe(first.receipt!.sourceIds[0]);
    expect((await api.evidence(first.receipt!.sourceIds[0])).status).toBe(
      "current",
    );
  });
  it("retries a failure in place and deduplicates simultaneous request IDs", async () => {
    const api = createMockGateway(0);
    const input = {
      conversationId: cid,
      text: "演示处理失败：今天整理了测试计划。",
      mode: "record" as const,
      requestId: "request-a",
    };
    const [a, b] = await Promise.all([api.send(input), api.send(input)]);
    expect(a.messages).toEqual(b.messages);
    const failed = last(a.messages);
    expect(failed.receipt?.kind).toBe("failed");
    const result = await api.send({
      ...input,
      requestId: "request-b",
      retryMessageId: failed.id,
    });
    expect(result.messages.length).toBe(a.messages.length);
    expect(last(result.messages).receipt?.kind).toBe("added");
  });
  it("returns isolated snapshots and rejects missing evidence", async () => {
    const api = createMockGateway(0);
    const snapshot = await api.load();
    snapshot.conversations[0].messages.length = 0;
    expect((await api.load()).conversations[0].messages.length).toBeGreaterThan(
      0,
    );
    await expect(api.evidence("missing")).rejects.toThrow("暂时无法查看");
  });
});
