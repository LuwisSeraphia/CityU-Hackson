import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installAgentContract } from "../fixtures/agent-contract";

test("import requires conflict choice and explicit final confirmation", async ({
  page,
}) => {
  let committed: Record<string, unknown> | undefined;
  await page.route("**/api/agent-v2/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/commit")) {
      committed = route.request().postDataJSON();
      return route.fulfill({
        json: { state: "completed", index_status: "pending" },
      });
    }
    return route.fulfill({
      json: {
        job_id: "import-1",
        state: "ready",
        epoch: 4,
        report: {
          counts: { memories: 1 },
          conflicts: [
            {
              conflict_id: "m1",
              table: "memories",
              local_preview: "周三复盘",
              import_preview: "周五复盘",
            },
          ],
        },
      },
    });
  });
  await page.goto("/settings/data");
  await page.getByLabel("个人记忆 ZIP 文件").setInputFiles({
    name: "memory.zip",
    mimeType: "application/zip",
    buffer: Buffer.from("test archive"),
  });
  await page.getByRole("button", { name: "检查备份" }).click();
  const submit = page.getByRole("button", { name: "确认导入", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel("保留内容").selectOption("keep_local");
  await expect(submit).toBeDisabled();
  await page.getByLabel("我已确认导入内容及影响").check();
  await submit.click();
  await expect.poll(() => committed?.expected_epoch).toBe(4);
  await expect(
    page.getByText("数据已恢复，索引状态待查询。跟进许可保持暂停。"),
  ).toBeVisible();
});

test("response preferences validate budget and save revision", async ({
  page,
}) => {
  await installAgentContract(page);
  let saved: Record<string, unknown> | undefined;
  await page.route("**/api/agent-v2/settings/response", async (route) => {
    if (route.request().method() === "PATCH")
      saved = route.request().postDataJSON();
    await route.fulfill({
      json: {
        revision: saved ? 2 : 1,
        options: {
          mode: "auto",
          memory_budget_tokens: null,
          retrieval_rounds: null,
          history_scope: "recent",
        },
        limits: { memory_budget_max: 6400, retrieval_rounds_max: 3 },
      },
    });
  });
  await page.goto("/settings/response");
  await page.getByLabel("深入梳理", { exact: true }).check();
  await page.getByText("高级设置", { exact: true }).click();
  await page.getByLabel("记忆预算", { exact: true }).fill("6500");
  await page.getByRole("button", { name: "保存设置" }).click();
  expect(saved).toBeUndefined();
  await page.getByLabel("记忆预算", { exact: true }).fill("0");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect.poll(() => saved?.memory_budget_tokens).toBe(0);
  expect(saved?.expected_revision).toBe(1);
  expect(saved?.mode).toBe("deep");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `test-results/response-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("batch review saves only explicitly selected candidates", async ({
  page,
}) => {
  let decision:
    | { decisions: { candidate_id: string; defer_profile: boolean }[] }
    | undefined;
  await page.route("**/api/agent/memory/library?**", (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  await page.route("**/api/agent-v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/decisions")) {
      decision = route.request().postDataJSON();
      return route.fulfill({ json: { revision: 2 } });
    }
    if (path.endsWith("/memory/batches"))
      return route.fulfill({
        json: {
          items: [
            {
              id: "batch-1",
              state: "pending",
              revision: 1,
              created: "2026-11-04T08:00:00Z",
            },
          ],
          next_cursor: null,
        },
      });
    return route.fulfill({
      json: {
        id: "batch-1",
        revision: decision ? 2 : 1,
        candidates: [
          {
            id: "c1",
            revision: 1,
            state: decision ? "accepted" : "pending",
            data: {
              title: "学习安排",
              content: "每周三复盘论文",
              evidence: "我打算每周三复盘论文",
              assertion_kind: "explicit",
            },
          },
          {
            id: "c2",
            revision: 1,
            state: "pending",
            data: {
              title: "性格推断",
              content: "可能偏好独处",
              assertion_kind: "inferred",
            },
          },
        ],
      },
    });
  });
  await page.goto("/memories?tab=pending&batch=batch-1");
  await expect(page.getByRole("dialog", { name: "确认记忆" })).toBeVisible();
  await page.getByRole("button", { name: "全选可保存项" }).click();
  await page.getByLabel("仅保存经历，不更新画像").check();
  await page.getByRole("button", { name: "保存选中 1 项" }).click();
  await expect.poll(() => decision?.decisions.length).toBe(1);
  expect(decision?.decisions[0]).toMatchObject({
    candidate_id: "c1",
    defer_profile: true,
  });
  await page.screenshot({
    path: `test-results/review-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test("profile mutation conflict keeps content visible", async ({ page }) => {
  await page.route("**/api/agent-v2/profiles**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            items: [
              {
                id: "p1",
                content: "偏好简洁直接的反馈",
                category: "communication",
                origin: "explicit",
                state: "active",
                pinned: false,
                revision: 3,
                evidence_ids: [],
                context: {},
              },
            ],
            next_cursor: null,
          },
        })
      : route.fulfill({
          status: 409,
          json: {
            error: { code: "VERSION_CONFLICT", message: "画像已更新。" },
          },
        }),
  );
  await page.goto("/profile");
  await page.getByRole("button", { name: /偏好简洁直接/ }).click();
  await page.getByRole("button", { name: "暂停使用" }).click();
  await expect(page.locator(".form-error")).toContainText("画像已更新");
  await expect(page.getByRole("dialog")).toContainText("偏好简洁直接");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("disabled backend displays real error without mock content", async ({
  page,
}) => {
  await page.route("**/api/agent-v2/**", (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "FEATURE_DISABLED", message: "尚未启用" } },
    }),
  );
  await page.goto("/profile");
  await expect(page.locator(".form-error")).toContainText("新版记忆尚未启用");
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  expect(await page.locator(".record-row").count()).toBe(0);
});

test("chat exposes only one memory control", async ({ page }) => {
  await installAgentContract(page);
  let enabled = false;
  await page.route("**/api/agent-v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("settings/response"))
      return route.fulfill({
        json: {
          revision: 1,
          options: {
            mode: "auto",
            memory_budget_tokens: null,
            retrieval_rounds: null,
            history_scope: "recent",
          },
          limits: { memory_budget_max: 6400, retrieval_rounds_max: 3 },
        },
      });
    if (path.endsWith("memory-policy")) {
      if (route.request().method() === "PATCH") enabled = true;
      return route.fulfill({
        json: { mode: enabled ? "on" : "off", revision: enabled ? 2 : 1 },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/");
  await page.getByRole("switch", { name: "记忆：关闭" }).click();
  await page.getByRole("button", { name: "开启记忆", exact: true }).click();
  await expect(page.getByRole("switch", { name: "记忆：开启" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "记忆与上下文" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "我的记忆" })).toHaveCount(0);
  await expect(page.getByLabel("本条不记")).toHaveCount(0);
  await page.screenshot({
    path: `test-results/chat-v2-${test.info().project.name}.png`,
    fullPage: true,
  });
});
