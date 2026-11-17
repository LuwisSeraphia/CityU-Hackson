import { afterEach, describe, expect, it, vi } from "vitest";
import { RealGateway } from "../../src/lib/api/gateway";

afterEach(() => vi.unstubAllGlobals());
describe("real gateway transport boundaries", () => {
  it("never substitutes demonstration data when the real backend is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: "数据库未配置" } },
            { status: 503 },
          ),
        ),
    );
    await expect(new RealGateway().load()).rejects.toThrow("数据库未配置");
  });
  it("coalesces loads without silently recreating deleted conversations", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        calls.push(path);
        return Response.json(
          path.endsWith("workspace")
            ? { conversations: [] }
            : { id: "new", title: "新的对话", messages: [] },
        );
      }),
    );
    const gateway = new RealGateway();
    const [first, second] = await Promise.all([gateway.load(), gateway.load()]);
    expect(first).toEqual(second);
    expect(calls.filter((path) => path.endsWith("conversations"))).toHaveLength(
      0,
    );
    expect(first.conversations).toEqual([]);
  });
  it("sends the version guard and retained-source scope when deleting", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ job_id: "delete" }));
    vi.stubGlobal("fetch", fetch);
    await new RealGateway().deleteFact({ factId: "fact", baseVersionId: "v2" });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      base_version_id: "v2",
      scope: "fact_and_versions",
      preserve_sources: true,
    });
  });
  it("retries the existing memory job instead of creating another source", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        calls.push(path);
        return Response.json(
          path.includes("retry-memory")
            ? { job_id: "job" }
            : path.includes("/jobs/")
              ? { state: "SUCCEEDED", stage: "INDEXED" }
              : { id: "c", messages: [] },
        );
      }),
    );
    await new RealGateway().send({
      conversationId: "c",
      text: "我喜欢清楚的回答",
      mode: "record",
      requestId: "request",
      retryMessageId: "message",
    });
    expect(calls.some((path) => path.includes("/memory/records"))).toBe(false);
    expect(calls[0]).toContain("/messages/message/retry-memory");
  });
});
