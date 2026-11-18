import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentClient, readRunStream } from '../src/api/AgentClient.js';
import { ConversationStore } from '../src/state/ConversationStore.js';
import { ChatController } from '../src/state/ChatController.js';
const memory = () => { const map = new Map(); return { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) }; };
const health = { database: true, api_token_configured: true, model_configured: false, mode: 'local_demo', worker_required: false };
const stream = text => new ReadableStream({ start(controller) { for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });

test('SSE parser handles UTF-8 byte boundaries, CRLF and heartbeats, then rejects truncation', async () => {
  const updates = [];
  const result = await readRunStream(stream(': heartbeat\r\n\r\nevent: status\r\ndata: {"id":"r","status":"RUNNING","stage":"生成中"}\r\n\r\nevent: status\ndata: {"id":"r","status":"SUCCEEDED"}\n\n'), s => updates.push(s));
  assert.equal(updates[0].stage, '生成中'); assert.equal(result.status, 'SUCCEEDED');
  await assert.rejects(readRunStream(stream('data: {"id":"r","status":"RUNNING"}\n\n'), () => {}), { code: 'STREAM_INTERRUPTED' });
  await assert.rejects(readRunStream(stream('data: not-json\n\n'), () => {}), { code: 'STREAM_INVALID' });
});

test('client preserves backend errors and never sends a token from the browser', async () => {
  let request;
  const client = new AgentClient(async (url, options) => { request = { url, options }; return Response.json({ error: { code: 'MODEL_NOT_CONFIGURED', message: '请配置模型' } }, { status: 503 }); });
  await assert.rejects(client.start({ text: 'hello' }), { code: 'MODEL_NOT_CONFIGURED', message: '请配置模型' });
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.url, '/api/v1/agent/runs');
  assert.equal(JSON.parse(request.options.body).text, 'hello');
});

function fixture() {
  const conversations = new ConversationStore(memory());
  const first = conversations.create('browser');
  const records = new Map(); const requests = []; const events = [];
  const client = {
    health: async () => health, workspace: async () => ({ conversations: [] }),
    create: async id => { const c = { id, title: '新对话', messages: [] }; records.set(id, c); return c; },
    conversation: async id => structuredClone(records.get(id)),
    start: async body => { requests.push(body); records.get(body.conversation_id).messages.push({ id: 'user', role: 'user', text: body.text }); return { run_id: 'run' }; },
    watch: async (_id, onStatus) => { onStatus({ id: 'run', status: 'RUNNING', stage: 'generating' }); records.get(requests.at(-1).conversation_id).messages.push({ id: 'answer', role: 'assistant', text: '后端返回的答案' }); return { id: 'run', status: 'SUCCEEDED' }; },
    cancel: async () => {}, uploadContext: async () => ({ id: 'file' }),
  };
  const controller = new ChatController(conversations, { client, onTask: event => events.push(event) });
  return { conversations, first, client, records, requests, events, controller };
}

test('backend answer replaces cache only for its original conversation when switching sessions', async () => {
  const f = fixture();
  const watch = f.client.watch;
  f.client.watch = async (...args) => { f.conversations.create('file'); return watch(...args); };
  await f.controller.send('问题一');
  assert.notEqual(f.conversations.activeId, f.first.id);
  assert.equal(f.first.messages.at(-1).text, '后端返回的答案');
  assert.equal(f.conversations.active.messages.length, 0);
  assert.equal(f.events.at(-1).status, 'SUCCEEDED');
  assert.equal(f.first.pendingRunId, undefined);
});

test('ambiguous POST failure reuses request key; a broken stream resumes without another POST', async () => {
  const f = fixture(); let once = true;
  const start = f.client.start;
  f.client.start = async body => { if (once) { once = false; f.requests.push(body); throw new Error('网络中断'); } return start(body); };
  await f.controller.send('同一条问题');
  assert.equal(f.first.messages.length, 0); assert.equal(f.controller.error, '网络中断');
  const watch = f.client.watch; f.client.watch = async () => { throw new Error('状态流中断'); };
  await f.controller.send('同一条问题');
  assert.equal(f.requests[0].request_id, f.requests[1].request_id);
  assert.equal(f.first.pendingRunId, 'run');
  f.client.watch = watch;
  await f.controller.resume(f.first);
  assert.equal(f.requests.length, 2);
  assert.equal(f.first.messages.length, 2);
  assert.equal(f.first.pendingRunId, undefined);
});

test('legacy local history is preserved and never silently sent to the backend', async () => {
  const f = fixture(); f.conversations.append('旧消息', { id: 'browser' });
  await f.controller.send('新消息');
  assert.equal(f.requests.length, 0); assert.equal(f.first.messages.length, 2);
  assert.match(f.controller.error, /旧版本地/);
});

test('cancellation and attachment context use backend endpoints with no simulated answer', async () => {
  const f = fixture(); let uploaded = '', cancelId;
  f.client.uploadContext = async (_id, text) => { uploaded = text; return { id: 'context-file' }; };
  f.client.watch = async () => { throw new Error('lost'); };
  await f.controller.send('资料问题', { context: '用户明确选择的节选' });
  assert.equal(uploaded, '用户明确选择的节选'); assert.deepEqual(f.requests[0].file_ids, ['context-file']);
  f.client.cancel = async id => { cancelId = id; };
  f.client.watch = async () => ({ id: 'run', status: 'CANCELLED' });
  await f.controller.cancel();
  assert.equal(cancelId, 'run'); assert.equal(f.events.at(-1).status, 'CANCELLED');
  assert.ok(!f.first.messages.some(m => m.text.includes('本地任务回执')));
});
