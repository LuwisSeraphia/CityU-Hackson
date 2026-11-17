export const PREVIEW_CHANNEL = 'liukanshan-knowledge-planet-scene-preview-v1';
export const PREVIEW_STORAGE_KEY = 'liukanshan-knowledge-planet-scene-preview';

export function createDefaultScene(snapshot) {
  return {
    title: '刘看山的知识星球 办公室',
    updatedAt: Date.now(),
    agents: snapshot.agents.map(agent => ({
      id: agent.id, name: agent.name, role: agent.role, color: agent.color,
      taskDescription: agent.taskDescription, state: agent.state,
      position: [...agent.position],
    })),
    offset: [0, 0, 0], rotationY: 0, scale: 1,
  };
}

export function createPreviewBridge() {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(PREVIEW_CHANNEL) : null;
  let previewWindow = null;
  return {
    open(scene) {
      try { localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(scene)); } catch { /* storage can be disabled */ }
      const preview = new URL('./preview.html?preview=1', window.location.href);
      previewWindow = window.open(preview.href, 'liukanshan-knowledge-planet-scene-preview', 'popup,width=1250,height=850,resizable=yes');
      if (!previewWindow) return false;
      previewWindow.focus();
      setTimeout(() => channel?.postMessage({ type: 'scene:update', scene }), 250);
      return true;
    },
    update(scene) {
      try { localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(scene)); } catch { /* channel remains available */ }
      channel?.postMessage({ type: 'scene:update', scene });
    },
    select(id) { channel?.postMessage({ type: 'agent:select', id }); },
    status(id, state) { channel?.postMessage({ type: 'agent:status', id, state }); },
    onMessage(listener) { if (channel) channel.onmessage = event => listener(event.data); },
    dispose() { channel?.close(); },
  };
}

export function readPreviewScene(snapshot) {
  try {
    const value = JSON.parse(localStorage.getItem(PREVIEW_STORAGE_KEY));
    if (value?.agents?.length === 3) return value;
  } catch { /* use default scene */ }
  return createDefaultScene(snapshot);
}
