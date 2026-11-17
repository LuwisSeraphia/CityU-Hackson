import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "@/lib/api/client";
import { factToEvidence } from "@/lib/api/mappers";
afterEach(() => vi.unstubAllGlobals());
it("maps version references and strips content from deleted evidence", () => {
  const fact = {
    fact_id: "f",
    current_version_id: "v",
    versions: [
      {
        version_id: "v",
        content: "历史文本",
        version: 1,
        status: "DELETED" as const,
        source_ids: ["s"],
        created_at: "2026-10-25T00:00:00Z",
      },
    ],
    sources: [
      { source_id: "s", text: "原文", created_at: "2026-10-25T00:00:00Z" },
    ],
  };
  expect(factToEvidence(fact)).toMatchObject({
    status: "deleted",
    text: "",
    sourceIds: [],
  });
  expect(factToEvidence(fact).originalRecords).toBeUndefined();
  const current = factToEvidence({
    ...fact,
    versions: [{ ...fact.versions[0], status: "CURRENT" }],
  });
  expect(current).toMatchObject({
    id: "v",
    factId: "f",
    status: "current",
    originalRecords: [{ id: "s", text: "原文" }],
  });
});
it("preserves 202 RECEIVED and sends an idempotency key", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        source_id: "s",
        job_id: "j",
        trace_id: "t",
        status: "RECEIVED",
      }),
      { status: 202 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await new ApiClient("http://example.test/api/v1").record(
    { conversation_id: "c", text: "记录", client_timezone: "Asia/Shanghai" },
    "key-1",
  );
  expect(result.status).toBe("RECEIVED");
  expect(fetcher).toHaveBeenCalledWith(
    "http://example.test/api/v1/memory/records",
    expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "key-1" }),
    }),
  );
});
it("surfaces version conflicts rather than falling back to mock", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "MEMORY_VERSION_CONFLICT",
            message: "版本已变化",
            stage: "memory_controller",
            retryable: false,
            trace_id: "t",
          },
        }),
        { status: 409 },
      ),
    ),
  );
  await expect(new ApiClient().approve("p", "v1")).rejects.toMatchObject({
    status: 409,
    message: "版本已变化",
  });
});
it("polls through COMMITTED until INDEXED and keeps deletion asynchronous", async () => {
  const states = ["RECEIVED", "EXTRACTED", "COMMITTED", "INDEXED"];
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ job_id: "j", trace_id: "t", stage: states.shift() }),
        ),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const stages: string[] = [];
  expect(
    (
      await new ApiClient().waitForJob("j", {
        intervalMs: 0,
        onStage: (job) => stages.push(job.stage),
      })
    ).stage,
  ).toBe("INDEXED");
  expect(stages).toEqual(["RECEIVED", "EXTRACTED", "COMMITTED", "INDEXED"]);
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ job_id: "delete-j", trace_id: "t", status: "RECEIVED" }),
      { status: 202 },
    ),
  );
  expect(await new ApiClient().deleteFact("fact/a", "v1")).toMatchObject({
    status: "RECEIVED",
    job_id: "delete-j",
  });
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining("/memory/facts/fact%2Fa"),
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({
        base_version_id: "v1",
        scope: "fact_and_versions",
        preserve_sources: true,
      }),
    }),
  );
});
it("rejects invalid response shapes and does not resubmit a timed out job", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ status: "OK" })));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    new ApiClient().record(
      { conversation_id: "c", text: "记录", client_timezone: "Asia/Shanghai" },
      "key",
    ),
  ).rejects.toThrow("响应格式");
  fetcher.mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ job_id: "j", trace_id: "t", stage: "COMMITTED" }),
      ),
    ),
  );
  await expect(
    new ApiClient().waitForJob("j", { intervalMs: 0, maxAttempts: 2 }),
  ).rejects.toThrow("不要重新创建");
  const controller = new AbortController();
  controller.abort();
  const count = fetcher.mock.calls.length;
  await expect(
    new ApiClient().waitForJob("j", { signal: controller.signal }),
  ).rejects.toBeDefined();
  expect(fetcher.mock.calls).toHaveLength(count);
});
