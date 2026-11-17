import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installAgentContract } from "../fixtures/agent-contract";

test("profile cards distinguish origins and preserve edits on close", async ({
  page,
}) => {
  await page.route("**/api/agent-v2/profiles", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "p1",
            content: "准备申请人机交互方向的博士项目",
            category: "goal",
            origin: "self_report",
            state: "active",
            pinned: true,
            revision: 1,
            evidence_ids: ["m1"],
            context: {},
          },
          {
            id: "p2",
            content: "讨论方案时，倾向先看到结论，再展开细节",
            category: "communication",
            origin: "inference",
            state: "pending",
            pinned: false,
            revision: 1,
            evidence_ids: ["m2", "m3"],
            context: {},
          },
          {
            id: "p3",
            content: "每周三晚上留出时间阅读论文",
            category: "learning",
            origin: "self_report",
            state: "active",
            pinned: false,
            revision: 1,
            evidence_ids: ["m4"],
            context: {},
          },
        ],
        next_cursor: null,
      },
    }),
  );
  await page.goto("/profile");
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByText("系统推断", { exact: true })).toBeVisible();
  await expect(page.locator(".memory-card")).toHaveCount(3);
  await page.screenshot({
    path: `test-results/mvp-profile-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /准备申请人机交互/ }).click();
  await page.getByRole("button", { name: "更正", exact: true }).click();
  await page.getByLabel("更正内容").fill("准备申请信息系统博士项目");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("更正内容")).toHaveValue(
    "准备申请信息系统博士项目",
  );
});

test("memory cards and discard dialog work on small screens", async ({
  page,
}) => {
  await page.route("**/api/agent/memory/library?**", (route) =>
    route.fulfill({
      json: {
        total: 3,
        items: [
          {
            id: "m1",
            title: "博士申请方向",
            text: "计划申请人机交互方向，重点关注有长期记忆的个人 Agent。",
            kind: "fact",
            status: "current",
            version: 2,
          },
          {
            id: "m2",
            title: "论文复盘",
            text: "周三与导师讨论了记忆检索的评估方法。",
            kind: "episode",
            status: "current",
            version: 1,
          },
          {
            id: "s1",
            title: "一次讨论",
            text: "先把核心流程演示清楚，再扩展其他场景。",
            kind: "source",
            status: "current",
            version: 1,
          },
        ],
      },
    }),
  );
  await page.route("**/api/agent-v2/memory/batches", (route) =>
    route.fulfill({ json: { items: [], next_cursor: null } }),
  );
  await page.goto("/memories");
  await expect(page.locator(".memory-card")).toHaveCount(3);
  await page.screenshot({
    path: `test-results/mvp-memory-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "记一件事", exact: true }).click();
  await page.getByLabel("内容", { exact: true }).fill("这是一段尚未提交的记录");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "放弃未保存的内容？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("trace separates model materials from background jobs", async ({
  page,
}) => {
  await installAgentContract(page);
  await page.route("**/api/agent-v2/**", (route) =>
    route.fulfill({
      json: {
        items: [],
        mode: "off",
        revision: 1,
        options: {
          mode: "auto",
          memory_budget_tokens: null,
          retrieval_rounds: null,
          history_scope: "recent",
        },
        limits: { memory_budget_max: 6400, retrieval_rounds_max: 3 },
      },
    }),
  );
  await page.route("**/api/agent/agent/runs/run-1/trace", (route) =>
    route.fulfill({
      json: {
        availability: "recorded",
        status: "SUCCEEDED",
        answer_elapsed_ms: 1420,
        intent: { origin: "model", plan: { task: "advise" } },
        information: [{ need_id: "recent", source: "memory", status: "found", selected_count: 1 }, { need_id: "external", source: "web", status: "not_requested" }],
        injected: [
          {
            id: "m1",
            kind: "memory",
            title: "博士申请方向",
            evidence_id: "m1",
          },
          {
            id: "p1",
            kind: "profile",
            title: "偏好先给结论，再展开细节",
            evidence_id: "m1",
          },
        ],
        cited: [{ id: "m1", title: "博士申请方向", evidence_id: "m1" }],
        background_jobs: [
          { id: "j1", kind: "memory_v2", status: "SUCCEEDED", stage: "REVIEW" },
          { id: "j2", kind: "index", status: "FAILED", stage: "INDEXING" },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.locator("#message-input").fill("结合我的申请方向，给我建议");
  await page.getByRole("button", { name: "发送提问", exact: true }).click();
  await page.getByRole("button", { name: "查看执行过程", exact: true }).click();
  await expect(page.getByRole("heading", { name: "本轮写入" })).toBeVisible();
  await expect(page.getByText("记忆整理 · 已完成 · 待确认")).toBeVisible();
  await page.getByText("信息规划", { exact: true }).click();
  await expect(page.getByText("历史记忆 · 已获取 · 选入 1 条", { exact: true })).toBeVisible();
  await expect(page.getByText("外部信息 · 尚未查询", { exact: true })).toBeVisible();
  await expect(page.getByText("索引 · 失败")).toBeVisible();
  await page.screenshot({
    path: `test-results/mvp-trace-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
