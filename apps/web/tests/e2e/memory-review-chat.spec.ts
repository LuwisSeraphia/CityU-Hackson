import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installAgentContract } from "../fixtures/agent-contract";

test("chat resolves a conflicting memory without leaving the conversation", async ({ page }) => {
  await installAgentContract(page);
  let saved: { decisions: { reason: string; expected_revision: number }[] } | undefined;
  await page.route("**/api/agent-v2/conversations/*/memory-jobs", route => route.fulfill({ json: {
    items: [{ id: "job", state: "SUCCEEDED", stage: "REVIEW", outcome: saved ? "committed" : "partial", batch_id: "batch" }],
  } }));
  await page.route("**/api/agent-v2/memory/batches/batch", route => route.fulfill({ json: {
    id: "batch", revision: saved ? 2 : 1, candidates: [{ id: "candidate", revision: 1,
      state: saved ? "accepted" : "pending", data: { title: "音乐偏好", content: "心情不好时喜欢听安静的钢琴曲",
        previous_content: "心情不好时喜欢听 R&B", assertion_kind: "explicit", evidence: "现在更喜欢听安静的钢琴曲" } }],
  } }));
  await page.route("**/api/agent-v2/memory/batches/batch/decisions", route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { revision: 2 } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "查看并确认" }).click();
  await expect(page.getByText("原记录：心情不好时喜欢听 R&B")).toBeVisible();
  await expect(page.getByRole("button", { name: "情况变了" })).toBeVisible();
  await page.screenshot({ path: `test-results/chat-memory-review-${test.info().project.name}.png`, fullPage: true, animations: "disabled" });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "之前记错了" }).click();
  await expect.poll(() => saved?.decisions[0].reason).toBe("correction");
  expect(saved?.decisions[0].expected_revision).toBe(1);
  await expect(page.getByText("本批次已处理")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});
