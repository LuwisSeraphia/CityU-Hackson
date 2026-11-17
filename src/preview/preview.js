import '../style.css';
import './preview.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SceneManager } from '../core/SceneManager.js';
import { AnimationLoop } from '../core/AnimationLoop.js';
import { SceneBuilder } from '../world/SceneBuilder.js';
import { AgentStore, STATE_LABELS } from '../state/AgentStore.js';
import { PREVIEW_CHANNEL, PREVIEW_STORAGE_KEY, createDefaultScene } from '../ui/PreviewBridge.js';
const container = document.querySelector('#preview-canvas');
const labelLayer = document.querySelector('#preview-labels');
const store = new AgentStore();
const scratch = new THREE.Vector3();
let manager, builder, loop, controls, currentScene;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(PREVIEW_CHANNEL) : null;
function makeFallback() {
  try { const data = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY)); if (data?.agents?.length === 3) return data; } catch { /* storage optional */ }
  return createDefaultScene(store.getSnapshot());
}
function selectAgent(id) {
  const selected = builder.office.agents.get(id);
  if (!selected) return;
  builder.office.agents.forEach(agent => { agent.selected = agent.id === id; });
  renderAgentBar(currentScene.agents, id);
}
function renderAgentBar(agents, selectedId = null) {
  const bar = document.querySelector('#preview-agent-bar');
  bar.innerHTML = agents.map(agent => `<button data-agent="${agent.id}" class="preview-agent-chip ${selectedId === agent.id ? 'active' : ''}" style="--agent-color:${agent.color}"><span class="chip-dot"></span><span><strong>${agent.name}</strong><small>${STATE_LABELS[agent.state] || '空闲待命'}</small></span></button>`).join('');
  bar.querySelectorAll('[data-agent]').forEach(button => button.onclick = () => { selectAgent(button.dataset.agent); channel?.postMessage({ type: 'agent:select', id: button.dataset.agent }); });
}
function applyScene(scene) {
  if (!scene?.agents || scene.agents.length !== 3) return;
  currentScene = scene;
  try {
    const office = builder.build(scene);
    labelLayer.innerHTML = scene.agents.map(agent => `<button class="preview-label" data-agent="${agent.id}" style="--agent-color:${agent.color}"><i></i>${agent.name}</button>`).join('');
    labelLayer.querySelectorAll('[data-agent]').forEach(label => label.onclick = () => { selectAgent(label.dataset.agent); channel?.postMessage({ type: 'agent:select', id: label.dataset.agent }); });
    document.querySelector('#preview-title').textContent = scene.title || '刘看山的知识星球 办公室';
    document.querySelector('#preview-updated').textContent = `已同步 ${new Date(scene.updatedAt || Date.now()).toLocaleTimeString()}`;
    document.querySelector('#preview-message').hidden = true;
    scene.agents.forEach(agent => {
      if (['idle', 'working', 'thinking', 'completed'].includes(agent.state)) office.agents.get(agent.id)?.setState(agent.state);
    });
    renderAgentBar(scene.agents);
    manager.render();
  } catch (error) { const message = document.querySelector('#preview-message'); message.hidden = false; message.textContent = `无法载入场景：${error.message}`; }
}
try {
  manager = new SceneManager(container);
  manager.camera.position.set(10, 13, 17); manager.camera.lookAt(0, 0.6, 0);
  controls = new OrbitControls(manager.camera, manager.renderer.domElement);
  controls.target.set(0, 0.6, 0); controls.enableDamping = true; controls.dampingFactor = 0.075;
  controls.minPolarAngle = Math.PI / 6; controls.maxPolarAngle = Math.PI / 2.08; controls.minDistance = 9; controls.maxDistance = 29; controls.minZoom = 0.65; controls.maxZoom = 2.1;
  controls.addEventListener('change', () => manager.render()); controls.update();
  builder = new SceneBuilder(manager.scene, id => store.finishCelebration(id));
  loop = new AnimationLoop(delta => {
    builder.update(delta); controls.update();
    const width = container.clientWidth, height = container.clientHeight;
    builder.office?.agents.forEach(agent => {
      const label = labelLayer.querySelector(`[data-agent="${agent.id}"]`); if (!label) return;
      scratch.copy(agent.labelAnchor).applyMatrix4(builder.office.group.matrixWorld).project(manager.camera);
      label.style.transform = `translate(-50%, -100%) translate(${(scratch.x * .5 + .5) * width}px, ${(-scratch.y * .5 + .5) * height}px)`;
    });
  }, () => manager.render());
  loop.start(); applyScene(makeFallback());
  document.querySelector('#preview-reset').onclick = () => { controls.reset(); manager.camera.position.set(10, 13, 17); controls.target.set(0, .6, 0); controls.update(); };
  if (channel) channel.onmessage = event => {
    const data = event.data;
    if (data?.type === 'scene:update') applyScene(data.scene);
    if (data?.type === 'agent:select') selectAgent(data.id);
    if (data?.type === 'agent:status') { const agent = currentScene.agents.find(item => item.id === data.id); if (agent) { agent.state = data.state; builder.office.agents.get(data.id).setState(data.state); renderAgentBar(currentScene.agents); } }
  };
  container.addEventListener('render-unavailable', event => { const message = document.querySelector('#preview-message'); message.hidden = false; message.textContent = event.detail; });
} catch (error) { console.warn('独立预览初始化失败:', error.message); const message = document.querySelector('#preview-message'); message.hidden = false; message.textContent = '浏览器未能启动 WebGL，请启用硬件加速后刷新。'; }
if (import.meta.hot) import.meta.hot.dispose(() => { channel?.close(); controls?.dispose(); loop?.dispose(); builder?.dispose(); manager?.dispose(); });
