import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installAgentContract } from "../fixtures/agent-contract";

test("new conversations render one toolbar and can be selected and deleted", async ({
  page,
}) => {
  await installAgentContract(page);
  let serial = 0;
  let rows = [
    {
      id: "c0",
      title: "已有对话",
      updatedAt: "2026-11-05T08:00:00Z",
      messages: [],
    },
  ];
  let failDelete = false;
  await page.route("**/api/agent/workspace", (route) =>
    route.fulfill({ json: { conversations: rows } }),
  );
  await page.route("**/api/agent/conversations", async (route) => {
    const item = {
      id: `c${++serial}`,
      title: `新对话 ${serial}`,
      updatedAt: "2026-11-05T08:00:00Z",
      messages: [],
    };
    rows = [item, ...rows];
    await route.fulfill({ json: item });
  });
  await page.route(/\/api\/agent\/conversations\/c\d+$/, async (route) => {
    const id = route.request().url().split("/").pop();
    if (route.request().method() === "DELETE") {
      if (failDelete)
        return route.fulfill({
          status: 409,
          json: {
            error: { message: "此对话仍有任务进行中，请等待完成后删除。" },
          },
        });
      rows = rows.filter((row) => row.id !== id);
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({ json: rows.find((row) => row.id === id) });
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `新对话 ${i + 1}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "上传文件", exact: true }),
    ).toHaveCount(1);
    await expect(page.locator("#message-input")).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "记忆与上下文" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "我的记忆" })).toHaveCount(0);
  const menu = page.getByRole("button", { name: "打开导航" });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("button", { name: "新对话 1", exact: true })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "新对话 1", exact: true }),
  ).toBeVisible();
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole("button", { name: "删除对话：新对话 1", exact: true })
    .filter({ visible: true })
    .click();
  failDelete = true;
  await page.getByRole("button", { name: "删除对话", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "任务进行中",
  );
  expect(rows).toHaveLength(4);
  failDelete = false;
  await page.getByRole("button", { name: "删除对话", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(rows).toHaveLength(3);
  await expect(
    page.getByRole("heading", { name: "新对话 3", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/conversation-fixed-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors.filter((error) => /same key|unique.*key/i.test(error))).toEqual(
    [],
  );
});
