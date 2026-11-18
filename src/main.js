import './style.css';
import './theme.css';
import * as THREE from 'three';
import { SceneManager } from './core/SceneManager.js';
import { AnimationLoop } from './core/AnimationLoop.js';
import { Office } from './world/Office.js';
import { RaycastManager } from './interaction/RaycastManager.js';
import { AgentStore, STATE_LABELS } from './state/AgentStore.js';
import { Sidebar } from './ui/Sidebar.js';
import { StatusPanel } from './ui/StatusPanel.js';
import { AgentPanel } from './ui/AgentPanel.js';
import { ChatDrawer } from './ui/ChatDrawer.js';
import { KnowledgeStore } from './knowledge/KnowledgeStore.js';
import { KnowledgePanel } from './knowledge/KnowledgePanel.js';
import { WorkspacePanel } from './ui/WorkspacePanel.js';

const store = new AgentStore();
const notify = message => {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove('visible'), 3200);
};
const knowledge = new KnowledgeStore();
const exampleCount = knowledge.addExamples({ automatic: true });
if (exampleCount && !knowledge.persisted) notify('已加载示例知识，存储不可用，刷新后修改可能丢失');
function retrieveKnowledge(id, query) {
  if (!office || office.agents.get(id)?.trip?.kind === 'book') { notify('伙伴正在取书或办公室尚未就绪，请稍后调用'); return null; }
  const hits = knowledge.search(query);
  if (!hits.length) { notify('未找到相关片段，请先添加资料或调整问题'); return null; }
  store.assignTask(id, query);
  chatDrawer.close(); workspacePanel.dialog.close(); store.select(null);
  if (loop) { loop.paused = false; updatePauseButton(); }
  office.retrieve(id, () => {
    notify('伙伴已取书回到工位，可查看检索来源');
    knowledgePanel.showResults(hits);
  });
  knowledgePanel.showResults(hits);
  notify('正在调用知识区：伙伴前往图书墙取书');
  return { hits };
}
const knowledgePanel = new KnowledgePanel(knowledge, store.getSnapshot().agents, retrieveKnowledge, notify);
const workspacePanel = new WorkspacePanel(store, notify);
const chatDrawer = new ChatDrawer(store, notify, { knowledgeSearch: query => knowledge.search(query) });
const sidebar = Sidebar(document.querySelector('#sidebar'), notify, page => {
  if (page === 'knowledge' || page === 'zhihu') { chatDrawer.close(); workspacePanel.dialog.close(); store.select(null); knowledgePanel.open(page === 'zhihu' ? 'zhihu' : 'all'); return; }
  knowledgePanel.root.close();
  if (page === 'chat') { workspacePanel.dialog.close(); chatDrawer.open(); }
  else { chatDrawer.close(); if (page === 'office') workspacePanel.dialog.close(); else workspacePanel.open(page); }
});
workspacePanel.onSkill = (agentId, prompt) => { knowledgePanel.close(); chatDrawer.startTask(agentId, prompt); sidebar.setActive('chat'); };
knowledgePanel.onClose = () => { if (!chatDrawer.root.open) sidebar.setActive('office'); };
workspacePanel.onClose = () => { if (!chatDrawer.root.open && !knowledgePanel.root.open) sidebar.setActive('office'); };
chatDrawer.onClose = () => { if (!workspacePanel.dialog.open && !knowledgePanel.root.open) sidebar.setActive('office'); };
const historyList = document.createElement('div');
historyList.className = 'conversation-history';
document.querySelector('.sidebar nav').append(historyList);
const stopHistory = chatDrawer.conversations.subscribe(() => {
  historyList.replaceChildren();
  const heading = document.createElement('p'); heading.className = 'nav-caption'; heading.textContent = '历史对话'; historyList.append(heading);
  for (const session of chatDrawer.conversations.sessions) {
    const button = document.createElement('button');
    button.className = 'history-conversation';
    button.textContent = (!session.backendId && session.messages.length ? '旧记录 · ' : '') + session.title; button.title = session.title;
    button.classList.toggle('active', chatDrawer.conversations.activeId === session.id);
    button.onclick = () => { knowledgePanel.close(); workspacePanel.dialog.close(); chatDrawer.open(session.id); sidebar.setActive('chat'); };
    historyList.append(button);
  }
});
const scheduleTimer = setInterval(() => workspacePanel.tick(), 1000);
const statusPanel = new StatusPanel(document.querySelector('#status-panel'), store);
const agentPanel = new AgentPanel(document.querySelector('#agent-panel'), store, () => {}, (id, message) => {
  if (store.assignTask(id, message)) notify('任务已交代，Agent 开始工作');
});
const container = document.querySelector('#scene-container');
const labels = document.querySelector('#agent-labels');
const projected = new THREE.Vector3();
const definitions = store.getSnapshot().agents;
labels.innerHTML = definitions.map(agent => `<button class="world-label" data-agent="${agent.id}" style="--agent-color:${agent.color}" aria-label="选择 ${agent.name}"><span class="label-name"><i></i>${agent.name}</span><span class="label-state">${STATE_LABELS[agent.state]}</span></button>`).join('');
const labelElements = new Map([...labels.children].map(label => [label.dataset.agent, label]));
const libraryLabel = document.createElement('button');
libraryLabel.className = 'world-label library-label';
libraryLabel.innerHTML = '<span class="label-name">▥ 图书墙 · RAG 知识区</span><span class="label-state">管理资料 / 调用取书</span>';
labels.append(libraryLabel);
libraryLabel.onclick = () => { chatDrawer.close(); workspacePanel.dialog.close(); store.select(null); knowledgePanel.open(); sidebar.setActive('knowledge'); };
labels.addEventListener('click', event => {
  const label = event.target.closest('[data-agent]');
  if (label) store.select(label.dataset.agent);
});

let manager, office, raycast, loop, unsubscribe;
const pauseButton = document.querySelector('#toggle-animation');
const speedControl = document.querySelector('#animation-speed');
const updatePauseButton = () => {
  pauseButton.innerHTML = loop.paused ? '▶ <span>播放动画</span>' : 'Ⅱ <span>暂停动画</span>';
  pauseButton.setAttribute('aria-pressed', String(loop.paused));
};
function showRenderError(message) {
  const loading = document.querySelector('#scene-loading');
  loading.classList.add('is-error'); loading.hidden = false; loading.textContent = message;
  labels.hidden = true; pauseButton.disabled = true; speedControl.disabled = true;
  document.querySelector('#reset-camera').disabled = true;
  loop?.dispose();
}
try {
  manager = new SceneManager(container);
  office = new Office(manager.scene, definitions, id => store.finishCelebration(id));
  raycast = new RaycastManager(manager.renderer.domElement, manager.camera, office.agents, store);
  unsubscribe = store.subscribe(snapshot => {
    office.sync(snapshot);
    snapshot.agents.forEach(agent => {
      const label = labelElements.get(agent.id);
      label.querySelector('.label-state').textContent = STATE_LABELS[agent.state];
      label.classList.toggle('selected', snapshot.selectedId === agent.id);
      label.dataset.state = agent.state;
      label.setAttribute('aria-pressed', String(snapshot.selectedId === agent.id));
    });
  });
  loop = new AnimationLoop(delta => {
    office.update(delta);
    if (chatDrawer.root.open || knowledgePanel.root.open) return;
    manager.controls.update();
    raycast.update();
    const width = container.clientWidth, height = container.clientHeight;
    office.agents.forEach(agent => {
      projected.set(agent.group.position.x, agent.group.position.y + 2.7, agent.group.position.z).project(manager.camera);
      const label = labelElements.get(agent.id);
      label.querySelector('.label-state').textContent = agent.trip ? (agent.trip.kind === 'wander' ? (agent.trip.phase === 'return' ? '返回工位' : '离座走动') : agent.trip.phase === 'outbound' ? '前往图书墙' : agent.trip.phase === 'pickup' ? '正在取书' : '携书返回') : STATE_LABELS[agent.state];
      label.style.transform = `translate(-50%, -100%) translate(${(projected.x * .5 + .5) * width}px, ${(-projected.y * .5 + .5) * height}px)`;
    });
    projected.copy(office.library.labelAnchor).project(manager.camera);
    libraryLabel.style.transform = `translate(-50%, -100%) translate(${(projected.x * .5 + .5) * width}px, ${(-projected.y * .5 + .5) * height}px)`;
  }, () => { if (!chatDrawer.root.open && !knowledgePanel.root.open) manager.render(); });
  manager.render(); document.querySelector('#scene-loading').hidden = true;
  updatePauseButton(); loop.start();
  pauseButton.onclick = () => { loop.paused = !loop.paused; updatePauseButton(); };
  speedControl.onchange = event => { loop.speed = Number(event.target.value); };
  document.querySelector('#reset-camera').onclick = () => {
    manager.controls.reset();
    loop.paused = false; loop.speed = 1; speedControl.value = '1'; updatePauseButton();
    notify('已重置视角及动画设置');
  };
  container.addEventListener('render-unavailable', event => showRenderError(event.detail));
} catch (error) {
  loop?.dispose(); raycast?.dispose(); office?.dispose(); manager?.dispose(); unsubscribe?.();
  showRenderError('无法创建 3D 办公室。请使用支持 WebGL 2 的浏览器，并启用硬件加速后刷新。');
  console.warn('知乎办公室初始化失败:', error.message);
}
const keyboard = event => {
  if (event.key === 'Escape') { knowledgePanel.root.close(); chatDrawer.close(); store.select(null); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); sidebar.focusSearch(); }
};
document.addEventListener('keydown', keyboard);
if (import.meta.hot) import.meta.hot.dispose(() => {
  clearTimeout(notify.timeout); document.removeEventListener('keydown', keyboard);
  unsubscribe?.(); loop?.dispose(); raycast?.dispose(); office?.dispose(); manager?.dispose();
  knowledgePanel.dispose();
  clearInterval(scheduleTimer); stopHistory(); workspacePanel.dispose(); chatDrawer.dispose();
  sidebar.dispose(); statusPanel.dispose(); agentPanel.dispose();
});
