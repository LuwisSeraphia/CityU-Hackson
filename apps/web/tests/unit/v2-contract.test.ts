import { afterEach, expect, it, vi } from "vitest";
import { v2, jobOutcome } from "@/lib/api/v2";

afterEach(() => vi.unstubAllGlobals());
it("rejects incomplete response settings before rendering controls", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 1 }))),
  );
  await expect(v2("/settings/response")).rejects.toThrow("回应设置不完整");
});
it("rejects malformed paginated lists without substituting demo records", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: null }))),
  );
  await expect(v2("/profiles?cursor=next")).rejects.toThrow("列表格式不正确");
});
it("distinguishes an empty extraction from committed and rejected batches", () => {
  expect(jobOutcome("no_candidates")).toBe("没有新增记忆");
  expect(jobOutcome("rejected")).toBe("未保存");
  expect(jobOutcome("committed")).toBe("已保存");
  expect(jobOutcome(undefined)).toBeUndefined();
});

it("accepts successful settings PATCH without GET-only limits", async () => {
  const saved = { revision: 2, options: { mode: "deep" } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(saved))));
  await expect(v2("/settings/response", { method: "PATCH", body: "{}" })).resolves.toEqual(saved);
});
it("still rejects settings PATCH without a revision", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ options: { mode: "deep" } }))));
  await expect(v2("/settings/response", { method: "PATCH", body: "{}" })).rejects.toThrow("回应设置不完整");
});
