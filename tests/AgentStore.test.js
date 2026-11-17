import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStore } from '../src/state/AgentStore.js';

test('starts with three independent idle agents and no tasks', () => {
  const snapshot = new AgentStore().getSnapshot();
  assert.equal(snapshot.agents.length, 3);
  assert.deepEqual(snapshot.agents.map(agent => agent.state), ['idle', 'idle', 'idle']);
  assert.deepEqual(snapshot.stats, { active: 0, completed: 0, cancelled: 0, total: 0 });
});

test('thinking and working reuse one task; Complete counts exactly once', () => {
  const store = new AgentStore();
  store.transition('browser', 'working');
  const taskId = store.getSnapshot().agents[0].taskId;
  store.transition('browser', 'thinking');
  assert.equal(store.getSnapshot().agents[0].taskId, taskId);
  assert.equal(store.getSnapshot().stats.total, 1);
  store.transition('browser', 'completed');
  assert.equal(store.transition('browser', 'completed'), false);
  assert.deepEqual(store.getSnapshot().stats, { active: 0, completed: 1, cancelled: 0, total: 1 });
  store.finishCelebration('browser');
  assert.equal(store.getSnapshot().agents[0].state, 'idle');
  assert.equal(store.getSnapshot().stats.completed, 1);
});

test('an idle agent cannot complete a nonexistent task', () => {
  const store = new AgentStore();
  assert.equal(store.transition('file', 'completed'), false);
  assert.equal(store.getSnapshot().stats.total, 0);
});

test('agents run and complete tasks independently', () => {
  const store = new AgentStore();
  store.transition('browser', 'working');
  store.transition('computer', 'thinking');
  store.transition('file', 'working');
  store.transition('file', 'completed');
  assert.deepEqual(store.getSnapshot().stats, { active: 2, completed: 1, cancelled: 0, total: 3 });
  assert.deepEqual(store.getSnapshot().agents.map(agent => agent.state), ['working', 'thinking', 'completed']);
});

test('reset cancels an active task without claiming completion', () => {
  const store = new AgentStore();
  store.transition('computer', 'working');
  store.transition('computer', 'idle');
  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.stats, { active: 0, completed: 0, cancelled: 1, total: 1 });
  assert.equal(snapshot.tasks[0].status, 'cancelled');
  assert.equal(snapshot.agents[1].taskId, null);
});

test('a new assignment after completion creates a new task and preserves history', () => {
  const store = new AgentStore();
  store.transition('file', 'working');
  store.transition('file', 'completed');
  store.transition('file', 'thinking');
  // A stale celebration callback must not reset a new active assignment.
  store.finishCelebration('file');
  assert.equal(store.getSnapshot().agents[2].state, 'thinking');
  assert.deepEqual(store.getSnapshot().stats, { active: 1, completed: 1, cancelled: 0, total: 2 });
});

test('selection and invalid transitions cannot change task counts', () => {
  const store = new AgentStore();
  store.select('browser');
  assert.equal(store.selectedId, 'browser');
  store.select('missing');
  assert.equal(store.selectedId, 'browser');
  store.select(null);
  assert.equal(store.selectedId, null);
  assert.equal(store.transition('browser', 'unknown'), false);
  assert.equal(store.transition('unknown', 'working'), false);
  assert.equal(store.getSnapshot().stats.total, 0);
});

test('snapshots cannot mutate internal agent or task state', () => {
  const store = new AgentStore();
  store.transition('browser', 'working');
  const snapshot = store.getSnapshot();
  snapshot.agents[0].state = 'completed';
  snapshot.agents[0].position[0] = 999;
  snapshot.tasks[0].status = 'completed';
  assert.equal(store.getSnapshot().agents[0].state, 'working');
  assert.notEqual(store.getSnapshot().agents[0].position[0], 999);
  assert.equal(store.getSnapshot().tasks[0].status, 'working');
});

test('subscribers see one synchronized snapshot per actual state change', () => {
  const store = new AgentStore();
  const updates = [];
  const unsubscribe = store.subscribe(snapshot => updates.push(snapshot));
  store.transition('file', 'working');
  store.transition('file', 'working');
  store.transition('file', 'completed');
  assert.equal(updates.length, 3);
  assert.equal(updates[1].agents[2].state, 'working');
  assert.equal(updates[1].stats.active, 1);
  assert.equal(updates[2].stats.completed, 1);
  unsubscribe();
  store.finishCelebration('file');
  assert.equal(updates.length, 3);
});

test('task messages remain separate per agent and survive completion', () => {
  const store = new AgentStore();
  store.assignTask('browser', '整理网页资料');
  store.assignTask('file', '归档文档');
  store.assignTask('browser', '补充来源链接');
  assert.equal(store.getSnapshot().stats.total, 2);
  assert.deepEqual(store.getSnapshot().messages.filter(m => m.agentId === 'browser').map(m => m.text), ['整理网页资料', '补充来源链接']);
  store.transition('browser', 'completed');
  store.finishCelebration('browser');
  assert.equal(store.getSnapshot().messages.length, 3);
  assert.deepEqual(store.getSnapshot().stats, { active: 1, completed: 1, cancelled: 0, total: 2 });
});

test('invalid messages create no tasks and message snapshots are isolated', () => {
  const store = new AgentStore();
  assert.equal(store.assignTask('browser', '  '), false);
  assert.equal(store.assignTask('missing', 'test'), false);
  store.assignTask('file', '<script>literal user text</script>');
  const snapshot = store.getSnapshot();
  snapshot.messages[0].text = 'tampered';
  assert.equal(store.getSnapshot().messages[0].text, '<script>literal user text</script>');
  assert.equal(store.getSnapshot().stats.total, 1);
});
