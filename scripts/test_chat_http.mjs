/** End-to-end HTTP check through the same Vite proxy the browser uses. Demo only. */
import assert from 'node:assert/strict';
import { AgentClient } from '../src/api/AgentClient.js';
const base = process.env.AGENT_TEST_URL || 'http://127.0.0.1:5175';
const client = new AgentClient(fetch, base + '/api/v1');
const health = await client.health();
assert.equal(health.mode, 'local_demo', 'This test is restricted to explicit local demo mode; it never calls a paid model.');
const cid = 'http-test-' + crypto.randomUUID();
try {
  assert.equal((await client.create(cid)).id, cid);
  assert.equal((await client.create(cid)).id, cid);
  const file = await client.uploadContext(cid, '# 光合作用\n植物通过光合作用利用光能，将水和二氧化碳转化为有机物。');
  const input = { conversation_id: cid, text: '光合作用', file_ids: [file.id], request_id: crypto.randomUUID(), memory_policy_override: 'skip' };
  const { run_id } = await client.start(input);
  assert.equal((await client.start(input)).run_id, run_id);
  const stages = [];
  const result = await client.watch(run_id, state => stages.push(state.status));
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result.error));
  let conversation = await client.conversation(cid);
  assert.equal(conversation.messages.length, 2);
  const answer = conversation.messages[1];
  assert.match(answer.text, /本地联调模式/);
  assert.ok(answer.citations.length > 0, 'The context must travel through backend file retrieval and citation handling.');
  assert.match((await client.evidence(answer.citations[0])).text, /光合作用/);
  const cancelled = await client.start({ ...input, text: '取消测试', request_id: crypto.randomUUID(), file_ids: [] });
  await client.cancel(cancelled.run_id);
  assert.equal((await client.watch(cancelled.run_id, () => {})).status, 'CANCELLED');
  conversation = await client.conversation(cid);
  const failed = conversation.messages.at(-1);
  const retry = await client.start({ conversation_id: cid, text: failed.answer.retryText, request_id: crypto.randomUUID(), memory_policy_override: 'skip', retry_message_id: failed.id });
  assert.equal((await client.watch(retry.run_id, () => {})).status, 'SUCCEEDED');
  assert.equal((await client.conversation(cid)).messages.length, 4, 'Retry must replace the failed response without adding a second user message.');
  assert.ok((await client.workspace()).conversations.some(c => c.id === cid));
  console.log('PASS: proxy → auth → idempotent conversation/run → attachment → SSE → answer/citation → history → cancel → retry');
} finally {
  await client.request('/conversations/' + encodeURIComponent(cid), { method: 'DELETE' });
}
