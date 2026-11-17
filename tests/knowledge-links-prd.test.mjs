import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const url = new URL(
  "../docs/knowledge-links-interaction-prd.md",
  import.meta.url,
);
const prd = readFileSync(url, "utf8");

test("harbour design keeps motion tied to real state and accessible fallbacks", () => {
  const ids = [...prd.matchAll(/^\| (VH-\d+)\s*\|/gm)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    Array.from({ length: 8 }, (_, i) => `VH-${String(i + 1).padStart(2, "0")}`),
  );
  for (const requirement of [
    "prefers-reduced-motion",
    "forced-colors",
    "只在后端成功后",
    "不能承担保存",
    "DESIGN.md 为 token 单一来源",
    "不报告运行界面",
  ]) {
    assert.ok(prd.includes(requirement), requirement);
  }
});

test("interaction acceptance identifiers are complete and unique", () => {
  const ids = [...prd.matchAll(/^\| (LK-\d+)\s*\|/gm)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 12 },
      (_, i) => `LK-${String(i + 1).padStart(2, "0")}`,
    ),
  );
});

test("local document references resolve", () => {
  for (const match of prd.matchAll(/\]\(([^)]+\.md)\)/g)) {
    assert.ok(existsSync(new URL(match[1], url)), match[1]);
  }
});

test("frontend contract retains backend prerequisites and version boundaries", () => {
  for (const text of [
    "待实现规格",
    "GET /items?collection_id",
    "CONNECTION_VERSION_CONFLICT",
    "reconfirm_endpoints",
    "Idempotency-Key",
    "AGENT_KNOWLEDGE_API_URL",
    "current_version_id",
    "旧备份升级",
    "原生 dialog",
  ]) {
    assert.ok(prd.includes(text), text);
  }
});
