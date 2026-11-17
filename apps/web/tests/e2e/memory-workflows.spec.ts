import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.get(page)!.push(message.text());
  });
  await page.goto("/demo");
  await expect(page.locator("#message-input")).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});
async function send(page: Page, text: string, record = true) {
  await page
    .locator(".mode-switch label")
    .filter({ hasText: record ? "记录到记忆" : "向 AI 提问" })
    .click();
  await page.locator("#message-input").fill(text);
  await page
    .getByRole("button", {
      name: record ? "提交记录" : "发送提问",
      exact: true,
    })
    .click();
  await expect(page.locator("#message-input")).toHaveValue("");
}
async function library(page: Page) {
  await page.getByRole("button", { name: "我的记忆", exact: true }).click();
  await expect(page.locator(".memory-list-item").first()).toBeVisible();
}
test("memory search, revision history, restoration and deletion preserve raw sources", async ({
  page,
}, info) => {
  await library(page);
  const dialog = page.getByRole("dialog", { name: "我的记忆" });
  await dialog.getByRole("button", { name: "事实", exact: true }).click();
  await page
    .locator(".memory-list-item")
    .filter({ hasText: "第一阶段目标" })
    .click();
  await page.getByRole("button", { name: "修订事实", exact: true }).click();
  await page
    .getByLabel("修订事实内容", { exact: true })
    .fill("先完成交互回归测试。");
  await page.keyboard.press("Escape");
  await expect(page.getByText("放弃尚未保存的修改？")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByLabel("修订事实内容", { exact: true })).toHaveValue(
    "先完成交互回归测试。",
  );
  await page.getByRole("button", { name: "保存为新版本" }).click();
  await expect(
    page.getByRole("button", { name: "修订事实", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".version-history button")).toHaveCount(2);
  await page.getByRole("button", { name: "刷新版本", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "修订事实", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".version-history button").filter({ hasText: "v2" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator(".version-history button")
    .filter({ hasText: "v1" })
    .click();
  await page.getByRole("button", { name: "恢复为新版本" }).click();
  await page.getByRole("button", { name: "保存为新版本" }).click();
  await expect(page.locator(".version-history button")).toHaveCount(3);
  await page.getByRole("button", { name: "删除事实", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "确认删除事实" }),
  ).toContainText("保留原始记录");
  await page.getByRole("button", { name: "删除事实及版本" }).click();
  await expect(page.getByText("此事实已删除 · 引用已失效")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "原始记录", exact: true }).click();
  await page.getByLabel("搜索记忆", { exact: true }).fill("先完成交互回归测试");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".memory-list-item")).toHaveCount(1);
  await page.getByRole("button", { name: "清空记忆搜索" }).click();
  await expect(page.getByLabel("搜索记忆", { exact: true })).toBeFocused();
  await expect(page.locator(".memory-list-item")).toHaveCount(6);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: resolve(
      `../../docs/screenshots/${info.project.name}-memory-library.png`,
    ),
  });
});
test("edited proposals require review and stale approvals cannot overwrite", async ({
  page,
}) => {
  await send(page, "我决定把项目的第一阶段目标改为：先做测试。");
  await page.getByRole("button", { name: "修改候选", exact: true }).click();
  await page
    .getByLabel("修改候选内容", { exact: true })
    .fill("第一阶段先完善无障碍交互。");
  await page.getByRole("button", { name: "保存候选，重新审核" }).click();
  const pending = page.getByRole("region", { name: "等待你的确认" });
  await expect(pending).toContainText("第一阶段先完善无障碍交互");
  await send(page, "第一阶段目标是什么？", false);
  await expect(page.locator(".message-assistant").last()).not.toContainText(
    "完善无障碍交互",
  );
  await send(page, "我决定把项目的第一阶段目标改为：先做验收。");
  await pending
    .first()
    .getByRole("button", { name: "确认更新", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "已确认更新" })).toHaveCount(1);
  await pending.getByRole("button", { name: "确认更新", exact: true }).click();
  const stale = page.getByRole("region", { name: "版本已变化，需重新审核" });
  await expect(stale).toBeVisible();
  await stale.getByRole("button", { name: "加载最新版本" }).click();
  await expect(pending).toContainText("第一阶段先完善无障碍交互");
  await pending.getByRole("button", { name: "确认更新", exact: true }).click();
  await expect(page.getByRole("region", { name: "已确认更新" })).toHaveCount(2);
});
test("index retry, interrupted answer replacement, degradation and no-candidate feedback", async ({
  page,
}) => {
  await send(page, "演示索引失败：今天整理了浏览器测试。");
  await expect(
    page.getByRole("region", { name: "部分完成 · 索引待恢复" }),
  ).toBeVisible();
  const before = await page.getByRole("article", { name: "你的消息" }).count();
  await page.getByRole("button", { name: "仅重试索引" }).click();
  await expect(
    page.getByText("索引已重新同步，没有重新提取或重复新增记忆"),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "你的消息" })).toHaveCount(
    before,
  );
  await send(page, "演示回答中断：最近记录了什么？", false);
  await expect(page.getByText("回答已中断", { exact: true })).toBeVisible();
  const count = await page.getByRole("article", { name: "Agent 回复" }).count();
  await page.getByRole("button", { name: "重新生成回答" }).click();
  await expect(page.getByText("回答已中断", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Agent 回复" })).toHaveCount(
    count,
  );
  await send(page, "演示检索降级：最近记录了什么？", false);
  await expect(page.locator(".answer-status").last()).toContainText("回答存在限制");
  await send(page, "演示零候选：暂时没有明确记录。");
  await expect(
    page.getByRole("region", { name: "未形成长期事实" }),
  ).toContainText("没有新增正式记忆");
});
test("search empty state, credential preflight and small-screen layout", async ({
  page,
}) => {
  await library(page);
  await page
    .getByLabel("搜索记忆", { exact: true })
    .fill("没有匹配的关键词xyz");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("没有找到匹配的记忆")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("#message-input").fill("password=sample-test-credential");
  await page.getByRole("button", { name: "发送提问", exact: true }).click();
  await expect(page.locator("#message-input")).toHaveValue(
    "password=sample-test-credential",
  );
  await expect(
    page.getByText("检测到疑似密码、API Key 或私钥。请移除凭据后再提交。"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
