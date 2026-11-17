import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prd = readFileSync(
  new URL("../docs/personal-knowledge-companion-prd-v2.md", import.meta.url),
  "utf8",
);

test("confirmed scope and write authorization remain explicit", () => {
  for (const id of ["KD-01", "KD-02", "KD-03", "KD-04", "KD-05"]) {
    assert.equal(prd.split(`| ${id} |`).length - 1, 1);
  }
  for (const requirement of [
    "自动提炼的思想与连接先确认",
    "暂不做其他 Agent 接入",
    "暂不定时推送",
    "本地数据库＋原文件库＋云端模型",
    "原文件未保留",
  ]) {
    assert.ok(prd.includes(requirement), requirement);
  }
});

test("acceptance scenarios cover the full knowledge lifecycle", () => {
  const ids = [...prd.matchAll(/^\| (KA-\d+) \|/gm)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 14 },
      (_, i) => `KA-${String(i + 1).padStart(2, "0")}`,
    ),
  );
  assert.match(prd, /功能尚未实施/);
  assert.match(prd, /首期仅恢复至空库/);
});

test("general memory and adaptation have executable contracts", () => {
  for (const heading of [
    "13. 通用结构化记忆",
    "14. 思考方式记忆",
    "15. API",
    "16. 代码功能规划",
    "17. 编码执行顺序",
    "18. V2.1 增量验收",
  ]) {
    assert.ok(prd.includes(`## ${heading}`), heading);
  }
  for (const invariant of [
    "用户当前的要求优先于历史模式",
    "生活、课程、工作只是验收示例",
    "usage_status=ready/needs_review/suspended",
    "批准前不用于跨会话个性化",
    "本期不微调模型",
    "POST /feedback",
    "knowledge/patterns.py",
  ]) {
    assert.ok(prd.includes(invariant), invariant);
  }
  const ids = [...prd.matchAll(/^\| (KB-\d+) \|/gm)].map((m) => m[1]);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 14 },
      (_, i) => `KB-${String(i + 1).padStart(2, "0")}`,
    ),
  );
});
