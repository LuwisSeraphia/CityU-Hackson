import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const prd = readFileSync(
  new URL("../Personal_Agent_Memory_Module_PRD_v1.0.md", import.meta.url),
  "utf8",
);
const archive = readFileSync(
  new URL(
    "../docs/archive/Personal_Agent_Memory_Module_PRD_v1.0.original.md",
    import.meta.url,
  ),
  "utf8",
);
const section = (number) => {
  const match = prd.match(
    new RegExp(`^## ${number}\\. [\\s\\S]*?(?=^## |$(?![\\s\\S]))`, "m"),
  );
  assert.ok(match, `Missing section ${number}`);
  return match[0];
};

test("revision and original remain distinguishable", () => {
  assert.match(prd, /文档版本：\*\* 1\.1/);
  assert.match(archive, /文档版本：\*\* 1\.0/);
  assert.match(prd, /真实后端与前端接入代码已实现/);
  assert.match(prd, /PostgreSQL 基础闭环真实验收已通过/);
  assert.match(section(23), /数据库服务重启与完整浏览器真实链路尚未验收/);
  assert.match(prd, /原稿备份/);
  assert.doesNotMatch(archive, /ADR-016/);
});

test("superseded write and scope policies cannot remain active", () => {
  for (const obsolete of [
    "否，永不隐式写入",
    "对话默认只读取，不后台抽取新长期事实",
    "问答默认不写长期记忆",
    "不产生隐式写入，用户可完整演示",
    "只有“记录”操作自动触发长期记忆写入",
    "文件/图片/视频解析、多模态输入",
  ]) {
    assert.ok(!prd.includes(obsolete), `Contradictory old policy: ${obsolete}`);
  }
  assert.match(prd, /关闭时普通聊天不提取，仍可显式记录/);
  assert.match(section(17), /关闭时提高 policy epoch/);
  assert.match(section(17), /低风险.*新增/);
  assert.match(section(17), /必须确认/);
});

test("all functional requirements and confirmed decisions are uniquely numbered", () => {
  const ids = [...prd.matchAll(/^\| (FR-\d+) \|/gm)].map((match) => match[1]);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 20 },
      (_, i) => `FR-${String(i + 1).padStart(2, "0")}`,
    ),
  );
  const decisions = [...prd.matchAll(/^\| (ADR-\d+) \|/gm)].map(
    (match) => match[1],
  );
  assert.equal(new Set(decisions).size, 16);
  assert.match(prd, /ADR-015.*保留 Source/);
  assert.match(prd, /ADR-016.*修改候选后重新审核/);
});

test("tools specify execution boundary, budgets and corresponding results", () => {
  const runtime = section(18);
  for (const name of [
    "search_memory",
    "read_memory_source",
    "get_fact_history",
    "search_files",
    "read_file",
    "web_search",
    "read_web_page",
    "propose_memory",
    "request_forget",
  ]) {
    assert.match(runtime, new RegExp(`^\\|\\s+${name}\\s+\\|`, "m"));
  }
  for (const invariant of [
    "后端执行实际函数",
    "tool_call_id",
    "JSON Schema",
    "幂等",
    "6 个模型轮次",
    "12 次工具执行",
    "不作为模型可自我调用的批准工具",
  ])
    assert.ok(runtime.includes(invariant), invariant);
});

test("context and external sources cannot silently become personal facts", () => {
  assert.match(section(17), /摘要不覆盖原文、不直接参与个人事实提取/);
  assert.match(section(17), /遗忘过滤/);
  assert.match(section(19), /不包含整机扫描或任意路径读取/);
  assert.match(section(19), /不能因为用户上传就推断/);
  assert.match(section(19), /SSRF/);
  for (const format of ["TXT", "Markdown", "PDF", "DOCX"])
    assert.ok(section(19).includes(format));
});

test("real acceptance covers every new capability and asynchronous terminal outcomes", () => {
  const acceptance = section(23);
  const ids = [...acceptance.matchAll(/^\| (A\d+) \|/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    ids,
    Array.from({ length: 15 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`),
  );
  assert.match(acceptance, /两次独立进程启动/);
  assert.match(acceptance, /不能作为本版真实能力的完成证明/);
  for (const outcome of [
    "SUCCEEDED+NOOP",
    "SUCCEEDED+DELETED",
    "PARTIAL",
    "memory.committed",
    "tool.completed",
  ])
    assert.ok(section(21).includes(outcome));
});

test("fences, JSON examples, and numeric section references are well formed", () => {
  assert.equal((prd.match(/^```/gm) ?? []).length % 2, 0);
  for (const block of prd.matchAll(/^```json\r?\n([\s\S]*?)^```/gm))
    assert.doesNotThrow(() => JSON.parse(block[1]));
  const headings = new Set(
    [...prd.matchAll(/^#{2,3} (\d+(?:\.\d+)?)(?:\.|\s)/gm)].map(
      (match) => match[1],
    ),
  );
  for (const reference of prd.matchAll(/§(\d+(?:\.\d+)?)/g))
    assert.ok(
      headings.has(reference[1]),
      `Missing referenced section ${reference[1]}`,
    );
});
