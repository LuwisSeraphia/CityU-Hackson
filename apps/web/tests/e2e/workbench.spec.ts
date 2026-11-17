import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const runtimeErrors = new WeakMap<Page, string[]>();

async function openSidebar(page: Page) {
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
}
async function chooseMode(page: Page, mode: "记录到记忆" | "向 AI 提问") {
  await page.locator(".mode-switch label").filter({ hasText: mode }).click();
}
async function send(page: Page, text: string, record = false) {
  await chooseMode(page, record ? "记录到记忆" : "向 AI 提问");
  await page.locator("#message-input").fill(text);
  await page
    .getByRole("button", {
      name: record ? "提交记录" : "发送提问",
      exact: true,
    })
    .click();
  await expect(page.locator("#message-input")).toHaveValue("");
  await expect(page.locator("#message-input")).not.toHaveAttribute(
    "readonly",
    "",
  );
}
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/demo");
  await expect(page.locator("#message-input")).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
});
test("navigation, layout, sources, keyboard focus and accessibility", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await openSidebar(page);
  for (const name of ["记忆", "关于我", "设置"])
    await expect(
      page.getByRole("link", { name, exact: true }).filter({ visible: true }),
    ).toBeVisible();
  await expect(page.getByRole("button", { name: /即将推出/ })).toHaveCount(0);
  if (await page.getByRole("dialog").isVisible())
    await page.keyboard.press("Escape");
  mkdirSync(resolve("../../docs/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve(`../../docs/screenshots/${info.project.name}.png`),
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const citation = page.getByRole("button", {
    name: "记忆来源 1",
    exact: true,
  });
  await citation.click();
  await expect(page.getByRole("dialog", { name: "记忆来源" })).toBeVisible();
  await expect(page.getByText("原始记录", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "关闭", exact: true }),
  ).toBeFocused();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: resolve(`../../docs/screenshots/${info.project.name}-source.png`),
  });
  await page.keyboard.press("Escape");
  await expect(citation).toBeFocused();
  expect(errors).toEqual([]);
});
test("new session, record, merge and cross-session recall", async ({
  page,
}) => {
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByText("从一句话开始，")).toBeVisible();
  await send(page, "今天完成了前端工作台的交互设计。", true);
  await expect(
    page.getByRole("region", { name: "已新增演示记忆" }),
  ).toBeVisible();
  await send(page, "今天完成了前端工作台的交互设计。", true);
  await expect(
    page.getByRole("region", { name: "已合并重复记忆" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新对话", exact: true }).click();
  await expect(page.getByText("从一句话开始，")).toBeVisible();
  await send(page, "最近记录了什么？");
  await expect(page.locator(".message-assistant").last()).toContainText(
    "今天完成了前端工作台的交互设计。",
  );
});
test("update proposal approval and rejection", async ({ page }) => {
  await page.getByRole("button", { name: "体验更新确认" }).click();
  await page.getByRole("button", { name: "提交记录", exact: true }).click();
  const pending = page.getByRole("region", { name: "等待你的确认" });
  await expect(pending).toBeVisible();
  await pending.getByRole("button", { name: "查看来源" }).click();
  await expect(page.getByText("待确认 · 暂不用于回答")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "确认更新", exact: true }).click();
  await expect(page.getByRole("region", { name: "已确认更新" })).toBeVisible();
  await send(page, "第一阶段目标是什么？");
  await expect(page.locator(".message-assistant").last()).toContainText(
    "先完成工作台界面",
  );
  await send(page, "我决定把项目的第一阶段目标改为：优先完善测试。", true);
  await page.getByRole("button", { name: "忽略此更新" }).click();
  await expect(page.getByRole("region", { name: "已忽略更新" })).toBeVisible();
});
test("failure retries in place without duplicate user messages", async ({
  page,
}) => {
  await page.getByRole("button", { name: "体验处理失败" }).click();
  await page.getByRole("button", { name: "提交记录", exact: true }).click();
  await expect(page.getByRole("region", { name: "处理失败" })).toBeVisible();
  const count = await page.getByRole("article", { name: "你的消息" }).count();
  await page.getByRole("button", { name: "重试处理" }).click();
  await expect(page.getByRole("region", { name: "处理失败" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "你的消息" })).toHaveCount(
    count,
  );
  await expect(
    page.getByRole("region", { name: "已新增演示记忆" }).last(),
  ).toContainText("新增 1 条原文记录");
});
test("drafts survive session switching and prompt replacement is guarded", async ({
  page,
}) => {
  await page.locator("#message-input").fill("还没写完的想法");
  await openSidebar(page);
  await page
    .getByRole("button", { name: "把阅读变成自己的知识", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator("#message-input")).toHaveValue("");
  await openSidebar(page);
  await page
    .getByRole("button", { name: "Personal Agent 的技术方向", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.locator("#message-input")).toHaveValue("还没写完的想法");
  await page.getByRole("button", { name: "记录一个想法", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "替换当前草稿？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保留草稿" }).click();
  await expect(page.locator("#message-input")).toHaveValue("还没写完的想法");
});
test("IME, multiline, validation, and unknown question", async ({ page }) => {
  const field = page.locator("#message-input");
  const before = await page.getByRole("article", { name: "你的消息" }).count();
  await field.fill("中文输入");
  await field.dispatchEvent("compositionstart");
  await field.press("Enter");
  await expect(page.getByRole("article", { name: "你的消息" })).toHaveCount(
    before,
  );
  await field.dispatchEvent("compositionend");
  // Synthetic composition does not invoke the OS IME, so reset before separately checking newline behavior.
  await field.fill("中文输入");
  await field.press("Shift+Enter");
  await expect(field).toHaveValue("中文输入\n");
  await field.fill("字".repeat(4001));
  await page.getByRole("button", { name: "发送提问", exact: true }).click();
  await expect(page.locator("#composer-error")).toContainText(
    "不能超过 4000 字",
  );
  await send(page, "我小学班主任叫什么？");
  await expect(page.locator(".message-assistant").last()).toContainText(
    "没有与这个问题相关的记录",
  );
  await expect(
    page.locator(".message-assistant").last().locator(".citation-chip"),
  ).toHaveCount(0);
});
test("reduced motion, long content and short viewport remain usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 667 });
  await send(page, "长期记忆".repeat(250), true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator("#message-input")).toBeInViewport();
  await expect(
    page.getByRole("region", { name: "已新增演示记忆" }).last(),
  ).toBeVisible();
  const scrollbar = await page
    .locator(".message-scroller")
    .evaluate((element) => getComputedStyle(element).scrollbarColor);
  expect(scrollbar).not.toBe("auto");
});
