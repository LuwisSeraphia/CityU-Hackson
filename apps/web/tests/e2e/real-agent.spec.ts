import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installAgentContract } from "../fixtures/agent-contract";

test("execution trace distinguishes recorded and legacy evidence", async ({
  page,
}) => {
  await installAgentContract(page);
  await page.route("**/agent/runs/run-1/trace", (route) =>
    route.fulfill({
      json: {
        availability: "recorded",
        status: "SUCCEEDED",
        answer_elapsed_ms: 1200,
        injected: [],
        cited: [],
        steps: [],
        calls: [],
        retrievals: [],
        context: { summary_generated: false },
        memory_job: { status: "SUCCEEDED" },
      },
    }),
  );
  await page.goto("/");
  await page.locator("#message-input").fill("查看本轮执行过程");
  await page.getByRole("button", { name: "发送提问", exact: true }).click();
  await page.getByRole("button", { name: "查看执行过程" }).click();
  await expect(page.getByRole("dialog")).toContainText("本轮未记录注入材料");
  await expect(page.getByRole("dialog")).toContainText("1.2 秒");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("real-service screen: setup failure is explicit, never a demo answer", async ({
  page,
}) => {
  await page.route("**/api/agent/**", async (route) => {
    if (route.request().url().endsWith("/health/ready"))
      return route.fulfill({
        json: {
          database: false,
          model_configured: false,
          worker: false,
          api_token_configured: true,
          model: "qwen-plus",
        },
      });
    await route.fulfill({
      status: 503,
      json: { error: { message: "数据库尚未连接。" } },
    });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "让你的 Agent 准备好" }),
  ).toBeVisible();
  await expect(page.getByText("待配置", { exact: true })).toHaveCount(2);
  await expect(page.getByText("演示数据仅保留", { exact: false })).toHaveCount(
    0,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("API contract double: memory policy, upload, tool activity, source and context", async ({
  page,
}) => {
  const contract = await installAgentContract(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const memorySwitch = page.getByRole("switch");
  await expect(memorySwitch).toHaveAttribute("aria-checked", "true");
  await memorySwitch.click();
  await expect(memorySwitch).toHaveAttribute("aria-checked", "false");
  expect(contract.state.consentOn).toBe(false);
  await page.getByLabel("上传会话文件").setInputFiles({
    name: "project.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("项目采用 PostgreSQL。"),
  });
  await expect(page.getByText("project.md · 可读取")).toBeVisible();
  await page.locator("#message-input").fill("结合我的文件，联网查找最新资料");
  await page.getByRole("button", { name: "发送提问", exact: true }).click();
  await expect(page.getByText("正在检索会话文件…")).toBeVisible();
  await expect(page.locator("#message-input")).toHaveValue("");
  expect(contract.state.consentOn).toBe(false);
  await page.getByRole("button", { name: "文件来源 1" }).click();
  await expect(
    page.getByRole("heading", { name: "project.md · 第 1 段" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "记忆与上下文" })).toHaveCount(
    0,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("API contract double: temporary chat clears locally and cannot record", async ({
  page,
}) => {
  const contract = await installAgentContract(page);
  await page.goto("/");
  await page.getByRole("button", { name: "临时对话", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("不读取个人记忆", { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "记录到记忆" })).toHaveCount(
    0,
  );
  await dialog.locator("#temporary-message-input").fill("临时讨论一下");
  await dialog.getByRole("button", { name: "发送提问" }).click();
  await expect(dialog.getByText("这条回答仅用于临时契约测试。")).toBeVisible();
  expect(contract.state.runs).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "结束并清空" }).click();
  await page.getByRole("button", { name: "临时对话", exact: true }).click();
  await expect(page.getByText("这条回答仅用于临时契约测试。")).toHaveCount(0);
});

test("API contract double: failed policy save preserves previous value", async ({
  page,
}) => {
  const contract = await installAgentContract(page);
  await page.goto("/");
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  contract.state.policyFailure = true;
  await page.getByRole("switch").click();
  await expect(page.getByText("设置保存失败，请重试。")).toBeVisible();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  contract.state.policyFailure = false;
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
