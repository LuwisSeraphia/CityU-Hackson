import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeStore } from '../src/knowledge/KnowledgeStore.js';
import { AgentStore } from '../src/state/AgentStore.js';
import { Agent } from '../src/world/Agent.js';
import { BookTrip } from '../src/world/BookTrip.js';
import * as THREE from 'three';

const memory = () => { const data = new Map(); return { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) }; };

test('knowledge retrieval preserves source offsets, supports Chinese and does not invent matches', () => {
  const store = new KnowledgeStore(memory());
  store.add('团队文档', '知识库支持检索团队文档。资料整理时需要记录来源。');
  store.add('花园', '花园种植向日葵。');
  const hits = store.search('资料来源');
  assert.ok(hits.length);
  assert.equal(hits[0].title, '团队文档');
  const source = store.documents.find(d => d.id === hits[0].documentId);
  assert.equal(source.text.slice(hits[0].offset, hits[0].offset + 480), hits[0].excerpt);
  assert.deepEqual(store.search('zzzzzzzz'), []);
  assert.deepEqual(store.search(''), []);
});

test('documents restore and removal updates subsequent retrieval', () => {
  const storage = memory();
  const store = new KnowledgeStore(storage);
  const doc = store.add('Planning', 'The roadmap includes quarterly planning milestones.');
  const restored = new KnowledgeStore(storage);
  assert.equal(restored.search('quarterly')[0].documentId, doc.id);
  restored.remove(doc.id);
  assert.deepEqual(restored.search('quarterly'), []);
  assert.throws(() => restored.add('', 'test'));
});

test('Agent walks, picks up a book, carries it home and finishes once', () => {
  const agent = new Agent(new AgentStore().getSnapshot().agents[0]);
  agent.setState('working');
  const home = agent.group.position.clone(); let completed = 0, sawBook = false, sawShelf = false;
  agent.trip = new BookTrip(agent, new THREE.Vector3(4, 0, -2.7), () => completed++);
  agent.update(0); assert.ok(agent.group.position.distanceTo(home) < 1e-8);
  for (let i = 0; i < 1500; i++) {
    agent.update(1 / 60);
    if (agent.trip?.phase === 'pickup') sawShelf = true;
    if (agent.book.visible) sawBook = true;
  }
  assert.ok(sawShelf && sawBook);
  assert.equal(completed, 1);
  assert.equal(agent.trip, null);
  assert.ok(agent.group.position.distanceTo(home) < 1e-8);
  assert.equal(agent.book.visible, false);
  assert.equal(agent.state, 'working');
});

test('reset cancels an ongoing trip and restores the work station', () => {
  const agent = new Agent(new AgentStore().getSnapshot().agents[1]);
  agent.setState('working'); const home = agent.group.position.clone(); let finished = false;
  agent.trip = new BookTrip(agent, new THREE.Vector3(4,0,-2.7), () => { finished = true; });
  agent.update(1); assert.ok(agent.group.position.distanceTo(home) > 0);
  agent.setState('idle');
  assert.equal(agent.trip, null); assert.equal(finished, false);
  assert.ok(agent.group.position.distanceTo(home) < 1e-8);
});

test('idle wandering excludes working or selected agents and yields to new tasks', async () => {
  const { IdleWalkController } = await import('../src/world/IdleWalkController.js');
  const definitions = new AgentStore().getSnapshot().agents;
  const agents = new Map(definitions.map(d => [d.id, new Agent(d)]));
  agents.get('browser').setState('working');
  agents.get('computer').selected = true;
  const controller = new IdleWalkController(agents, () => 0);
  controller.update(7);
  const walker = agents.get('file');
  assert.equal(walker.trip?.kind, 'wander');
  assert.equal(agents.get('browser').trip, null);
  assert.equal(agents.get('computer').trip, null);
  walker.update(1);
  walker.setState('working');
  assert.equal(walker.trip, null);
  assert.ok(walker.group.position.distanceTo(walker.homePosition) < 1e-8);
});

test('wandering returns with the whole body facing the desk and no book', async () => {
  const { IdleWalkController } = await import('../src/world/IdleWalkController.js');
  const agent = new Agent(new AgentStore().getSnapshot().agents[0]);
  const controller = new IdleWalkController(new Map([[agent.id, agent]]), () => 0);
  controller.update(7);
  for (let i = 0; i < 3500; i++) {
    agent.update(1 / 60);
    assert.equal(agent.book.visible, false);
  }
  assert.equal(agent.trip, null);
  assert.ok(agent.group.position.distanceTo(agent.homePosition) < 1e-8);
  assert.equal(agent.group.rotation.y, Math.PI);
  agent.update(1 / 60);
  assert.ok(Math.abs(agent.head.rotation.y) < 0.1);
});

test('bookshelf is parallel to the right edge with its book face pointing inward', async () => {
  const { LibraryWall } = await import('../src/world/LibraryWall.js');
  const library = new LibraryWall();
  assert.equal(library.position.x, 5);
  assert.equal(library.position.z, -2.4);
  assert.ok(library.destination.x < library.position.x);
  assert.equal(library.rotation.y, -Math.PI / 2);
  const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), library.rotation.y);
  assert.ok(front.dot(new THREE.Vector3(-1, 0, 0)) > 0.99999);
  const pickupForward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), library.pickupYaw);
  const towardBooks = library.position.clone().sub(library.destination).normalize();
  assert.ok(pickupForward.dot(towardBooks) > 0.99999);
  const bounds = new THREE.Box3().setFromObject(library);
  assert.ok(bounds.max.z - bounds.min.z > 4.8);
});

test('Zhihu pages retain source URLs in retrieval and survive storage reloads', () => {
  const storage = memory();
  const knowledge = new KnowledgeStore(storage);
  const link = knowledge.addZhihuLink('知识整理', 'https://zhuanlan.zhihu.com/p/123456', '知识整理需要记录原始资料来源和证据。');
  const restored = new KnowledgeStore(storage);
  const hit = restored.search('证据')[0];
  assert.equal(hit.documentId, link.id);
  assert.equal(hit.sourceUrl, 'https://zhuanlan.zhihu.com/p/123456');
  assert.equal(restored.documents[0].kind, 'zhihu');
});

test('link-only bookmarks are not indexed and non-Zhihu URLs are rejected', () => {
  const knowledge = new KnowledgeStore(memory());
  knowledge.addZhihuLink('uniqueBookmarkTitle', 'https://www.zhihu.com/question/123');
  assert.deepEqual(knowledge.search('uniqueBookmarkTitle'), []);
  for (const url of ['javascript:alert(1)', 'http://www.zhihu.com/question/1', 'https://zhihu.com.evil.example/p/1', 'https://example.com/']) {
    assert.throws(() => knowledge.addZhihuLink('invalid', url, 'text'));
  }
});

test('legacy notes gain metadata without losing text and categories survive reload', () => {
  const storage = memory();
  storage.setItem('office-knowledge-v1', JSON.stringify([{ id: 'old', title: '旧资料', text: '不能丢失的正文' }]));
  const store = new KnowledgeStore(storage);
  assert.equal(store.documents[0].category, '待整理');
  assert.deepEqual(store.documents[0].tags, []);
  store.addCategory('旅行见闻');
  store.update('old', { category: '旅行见闻', tags: '香港，阅读' });
  const restored = new KnowledgeStore(storage);
  assert.equal(restored.documents[0].text, '不能丢失的正文');
  assert.equal(restored.documents[0].category, '旅行见闻');
  assert.deepEqual(restored.documents[0].tags, ['香港', '阅读']);
  restored.renameCategory('旅行见闻', '城市观察');
  assert.equal(restored.documents[0].category, '城市观察');
  assert.throws(() => restored.renameCategory('城市观察', '自然知识'));
  restored.removeCategory('城市观察');
  assert.equal(restored.documents[0].category, '待整理');
  assert.equal(restored.documents[0].text, '不能丢失的正文');
  assert.throws(() => restored.removeCategory('待整理'));
});

test('recently read notes rise in inspiration without changing creation dates', () => {
  const store = new KnowledgeStore(memory());
  const first = store.add('第一本', '资料一');
  const second = store.add('第二本', '资料二');
  first.createdAt = first.updatedAt = 1;
  second.createdAt = second.updatedAt = 2;
  assert.equal(store.recent(1)[0].id, second.id);
  store.touch(first.id);
  assert.equal(store.recent(1)[0].id, first.id);
  assert.equal(first.createdAt, 1);
  store.update(first.id, { title: '修订版', text: '可检索的光合作用知识' });
  assert.equal(store.search('光合作用')[0].title, '修订版');
});

test('classification suggestions and edits validate content and keep failures atomic', async () => {
  const { suggestCategory } = await import('../src/knowledge/KnowledgeStore.js');
  assert.equal(suggestCategory('植物的光合作用', '生物与自然科学'), '自然知识');
  assert.equal(suggestCategory('每日食谱', '饮食健康'), '生活常识');
  assert.equal(suggestCategory('随手记', 'xyz'), '待整理');
  const store = new KnowledgeStore(memory());
  const note = store.add('原始资料', '保留正文');
  assert.throws(() => store.update(note.id, { title: '', category: '不应新增' }));
  assert.equal(note.title, '原始资料');
  assert.ok(!store.categories.includes('不应新增'));
  const bookmark = store.addZhihuLink('书签', 'https://www.zhihu.com/question/1');
  store.update(bookmark.id, { category: '人文知识', tags: '待读' });
  assert.equal(bookmark.text, '');
  assert.equal(bookmark.sourceUrl, 'https://www.zhihu.com/question/1');
});

test('free bubble field has varied sizes and independent positions inside narrow and wide bounds', async () => {
  const { createBubbleLayout, advanceBubbles } = await import('../src/knowledge/InspirationField.js');
  let seed = 29;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [width, height] of [[275, 990], [1050, 650]]) {
    const bubbles = createBubbleLayout(width, height, 10, random);
    assert.ok(new Set(bubbles.map(b => Math.round(b.radius))).size > 4);
    assert.ok(new Set(bubbles.map(b => Math.round(b.y))).size > 6);
    const original = bubbles.map(b => ({ x: b.x, y: b.y }));
    for (let frame = 0; frame < 1800; frame++) advanceBubbles(bubbles, width, height, 1 / 60, frame / 60, 0);
    assert.deepEqual({ x: bubbles[0].x, y: bubbles[0].y }, original[0]);
    assert.ok(bubbles.slice(1).every((b, i) => Math.hypot(b.x - original[i + 1].x, b.y - original[i + 1].y) > 1));
    for (const b of bubbles) {
      assert.ok(b.x >= b.radius && b.x <= width - b.radius);
      assert.ok(b.y >= b.radius && b.y <= height - b.radius);
    }
  }
});

test('starter bubbles seed an empty library once, preserve real notes and stay removed after deletion', () => {
  const storage = memory();
  const store = new KnowledgeStore(storage);
  assert.equal(store.addExamples({ automatic: true }), 8);
  assert.equal(new Set(store.documents.map(d => d.category)).size, 5);
  assert.ok(store.documents.every(d => d.isExample && d.text && d.tags.includes('示例')));
  const first = store.documents[0];
  store.update(first.id, { title: '我修改过的示例' });
  const restored = new KnowledgeStore(storage);
  assert.equal(restored.addExamples({ automatic: true }), 0);
  assert.equal(restored.documents[0].title, '我修改过的示例');
  for (const d of [...restored.documents]) restored.remove(d.id);
  assert.equal(new KnowledgeStore(storage).addExamples({ automatic: true }), 0);
  assert.equal(restored.addExamples(), 8);
  assert.equal(restored.addExamples(), 0);
  const userStore = new KnowledgeStore(memory());
  userStore.add('自己的资料', '自己的正文');
  assert.equal(userStore.addExamples({ automatic: true }), 0);
  assert.equal(userStore.documents.length, 1);
});
