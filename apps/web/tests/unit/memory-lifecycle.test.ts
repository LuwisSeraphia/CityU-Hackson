import { describe, expect, it } from "vitest";
import { createMockGateway } from "@/lib/mock/gateway";
import { processingDescription } from "@/lib/memory-presentation";
import type { MemoryGateway, Message } from "@/types/memory";
const cid = "conversation-project";
const last = (messages: Message[]) => messages[messages.length - 1];
const send = async (
  api: MemoryGateway,
  text: string,
  mode: "record" | "ask" = "record",
) =>
  last(
    (
      await api.send({
        conversationId: cid,
        text,
        mode,
        requestId: crypto.randomUUID(),
      })
    ).messages,
  );
const list = (
  api: MemoryGateway,
  kind: "all" | "fact" | "episode" | "source" = "all",
  query = "",
  page = 1,
) => api.listMemories({ kind, query, page });
describe("memory lifecycle", () => {
  it("edits a candidate without committing it, then approves the edited version", async () => {
    const api = createMockGateway(0);
    const candidate = await send(
      api,
      "我决定把项目的第一阶段目标改为：测试交互。",
    );
    const edited = last(
      (
        await api.editProposal({
          conversationId: cid,
          messageId: candidate.id,
          text: "第一阶段目标是先完善无障碍交互。",
        })
      ).messages,
    );
    expect(edited.receipt?.proposal?.status).toBe("pending");
    expect((await send(api, "第一阶段目标是什么？", "ask")).text).not.toContain(
      "无障碍交互",
    );
    const proposal = edited.receipt!.proposal!;
    await api.decide({
      conversationId: cid,
      messageId: edited.id,
      proposalId: proposal.id,
      baseVersionId: proposal.baseVersionId,
      decision: "approve",
    });
    expect((await send(api, "第一阶段目标是什么？", "ask")).text).toContain(
      "无障碍交互",
    );
    expect(
      (await api.evidence(edited.receipt!.sourceIds[0])).originalRecords,
    ).toHaveLength(2);
  });
  it("preserves versions, restores via a new version, and rejects stale writes", async () => {
    const api = createMockGateway(0);
    const original = await api.evidence("source-stack");
    const updated = await api.reviseFact({
      factId: original.factId!,
      baseVersionId: original.id,
      text: "技术方案先验证 PostgreSQL。",
    });
    expect(updated.version).toBe(2);
    expect((await api.evidence(original.id)).status).toBe("historical");
    await expect(
      api.reviseFact({
        factId: original.factId!,
        baseVersionId: original.id,
        text: "旧标签页写入",
      }),
    ).rejects.toThrow("版本已变化");
    expect((await send(api, "技术方案是什么？", "ask")).text).toContain(
      updated.text,
    );
    const restored = await api.reviseFact({
      factId: original.factId!,
      baseVersionId: updated.id,
      text: original.text,
    });
    expect(restored.version).toBe(3);
    expect(restored.versions).toHaveLength(3);
    expect(
      restored.versions?.filter((v) => v.status === "current"),
    ).toHaveLength(1);
  });
  it("deletes every fact version, expires proposals, retains originals, invalidates citations", async () => {
    const api = createMockGateway(0);
    const candidate = await send(
      api,
      "我决定把项目的第一阶段目标改为：先完善交互。",
    );
    const original = await api.evidence("source-scope");
    const updated = await api.reviseFact({
      factId: original.factId!,
      baseVersionId: original.id,
      text: "先完成测试。",
    });
    const sourcesBefore = await list(api, "source");
    await api.deleteFact({
      factId: original.factId!,
      baseVersionId: updated.id,
    });
    for (const id of [
      original.id,
      updated.id,
      candidate.receipt!.sourceIds[0],
    ]) {
      expect(await api.evidence(id)).toMatchObject({
        status: "deleted",
        text: "",
        sourceIds: [],
      });
    }
    expect((await list(api, "source")).total).toBe(sourcesBefore.total);
    expect(
      (await api.load()).conversations[0].messages.find(
        (m) => m.id === candidate.id,
      )?.receipt?.proposal?.status,
    ).toBe("expired");
    expect(
      (await send(api, "第一阶段目标是什么？", "ask")).answer?.status,
    ).toBe("insufficient");
  });
  it("retries indexing only, without adding sources, memories, or messages", async () => {
    const api = createMockGateway(0);
    const failed = await send(api, "演示索引失败：今天整理了测试用例。");
    expect(failed.receipt?.processing).toMatchObject({
      sourceStatus: "COMMITTED",
      indexStatus: "FAILED",
    });
    const sourcesBefore = await list(api, "source");
    const before = await list(api);
    const messagesBefore = (await api.load()).conversations[0].messages.length;
    const stages: string[] = [];
    const retried = await api.send(
      {
        conversationId: cid,
        text: failed.receipt!.retryText!,
        mode: "record",
        requestId: "retry-index",
        retryMessageId: failed.id,
      },
      (progress) => stages.push(progress.stage),
    );
    expect(stages).toEqual(["indexing"]);
    expect(last(retried.messages).receipt?.processing?.indexStatus).toBe(
      "READY",
    );
    expect(retried.messages).toHaveLength(messagesBefore);
    expect((await list(api)).total).toBe(before.total);
    expect((await list(api, "source")).total).toBe(sourcesBefore.total);
  });
  it("keeps plans separate, zero-candidate originals out of answers, and reasons unknown", async () => {
    const api = createMockGateway(0);
    await send(api, "演示未来计划：下个月计划做一次分享。");
    expect((await send(api, "将来有什么计划？", "ask")).text).toContain(
      "尚未发生",
    );
    expect((await send(api, "最近记录了什么？", "ask")).text).not.toContain(
      "下个月",
    );
    const noop = await send(api, "演示零候选：暂时没有确定的内容。");
    expect(processingDescription(noop.receipt!.processing!)).not.toContain(
      "待确认",
    );
    expect((await api.evidence(noop.receipt!.sourceIds[0])).kind).toBe(
      "source",
    );
    expect((await send(api, "为什么选择这个技术方案？", "ask")).text).toContain(
      "不能据此推断",
    );
  });
  it("replaces an interrupted answer and distinguishes degradation from no evidence", async () => {
    const api = createMockGateway(0);
    const interrupted = await send(
      api,
      "演示回答中断：最近记录了什么？",
      "ask",
    );
    expect(interrupted.answer?.status).toBe("interrupted");
    const before = (await api.load()).conversations[0].messages.length;
    const retried = await api.send({
      conversationId: cid,
      text: interrupted.answer!.retryText!,
      mode: "ask",
      requestId: "retry-answer",
      retryMessageId: interrupted.id,
    });
    expect(retried.messages).toHaveLength(before);
    expect(last(retried.messages).answer?.status).toBe("complete");
    expect(
      (await send(api, "演示检索降级：最近记录了什么？", "ask")).answer?.status,
    ).toBe("partial");
    expect(
      (await send(api, "演示服务不可用：最近记录了什么？", "ask")).answer
        ?.status,
    ).toBe("unavailable");
  });
  it("supports filtering, paging and search and never persists obvious credentials", async () => {
    const api = createMockGateway(0);
    for (let i = 0; i < 12; i++) await send(api, `分页样本 ${i}`);
    expect((await list(api, "episode", "分页样本", 1)).items).toHaveLength(10);
    expect((await list(api, "episode", "分页样本", 2)).items).toHaveLength(2);
    expect((await list(api, "fact", "分页样本")).total).toBe(0);
    const before = await api.load();
    await expect(
      send(api, "password=example-credential-for-test"),
    ).rejects.toThrow("凭据");
    expect(await api.load()).toEqual(before);
    expect((await list(api, "source", "example-credential")).total).toBe(0);
  });
});
