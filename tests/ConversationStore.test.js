import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationStore } from '../src/state/ConversationStore.js';
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
};

test('new sessions preserve independent messages, agent identity and drafts across reloads', () => {
  const storage = memory();
  const store = new ConversationStore(storage);
  const first = store.create('browser');
  store.append('整理网页资料', { id: 'browser' });
  const second = store.create('file');
  second.draft = '下一项文件任务'; store.save();
  store.append('整理目录', { id: 'file' });
  second.draft = '补充要求'; store.save();
  assert.equal(store.sessions.length, 2);
  assert.equal(first.messages[1].agentId, 'browser');
  const restored = new ConversationStore(storage);
  assert.ok(restored.select(first.id));
  assert.equal(restored.active.title, '整理网页资料');
  assert.equal(restored.active.messages[0].text, '整理网页资料');
  restored.select(second.id);
  assert.equal(restored.active.draft, '补充要求');
  assert.equal(restored.active.messages[1].agentId, 'file');
});

test('missing sessions and unavailable storage do not discard in-memory conversations', () => {
  const store = new ConversationStore({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  const session = store.create();
  assert.equal(store.select('unknown'), false);
  assert.equal(store.active.id, session.id);
  assert.equal(store.append(' ', { id: 'browser' }), false);
  assert.ok(store.append('hello', { id: 'browser' }));
  assert.equal(store.active.messages.length, 2);
  assert.equal(store.storageFailed, true);
});
