const KEY = 'office-conversations-v1';

/** Conversation data is independent from short-lived office task state. */
export class ConversationStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.sessions = [];
    try {
      const data = JSON.parse(storage?.getItem(KEY) || '[]');
      if (Array.isArray(data)) this.sessions = data.filter(s => s && typeof s.id === 'string' && typeof s.title === 'string' && Array.isArray(s.messages)).map(s => ({ ...s, draft: typeof s.draft === 'string' ? s.draft : '', messages: s.messages.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.text === 'string') }));
    } catch { /* storage is optional */ }
    this.activeId = null;
    this.listeners = new Set();
  }
  get active() { return this.sessions.find(s => s.id === this.activeId); }
  subscribe(callback) { this.listeners.add(callback); callback(); return () => this.listeners.delete(callback); }
  save() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.sessions)); } catch { this.storageFailed = true; }
    this.listeners.forEach(callback => callback());
  }
  create(agentId = 'browser') {
    const session = { id: crypto.randomUUID(), title: '新对话', agentId, messages: [], draft: '', updatedAt: Date.now() };
    this.sessions.unshift(session); this.activeId = session.id; this.save(); return session;
  }
  select(id) { if (!this.sessions.some(s => s.id === id)) return false; this.activeId = id; this.save(); return true; }
  upsertRemote(remote, agentId = 'browser', localId) {
    if (!remote || typeof remote.id !== 'string' || !Array.isArray(remote.messages)) throw new Error('后端会话格式无效');
    let session = this.sessions.find(s => s.backendId === remote.id || s.id === localId || s.id === remote.id);
    if (!session) {
      session = { id: remote.id, draft: '', agentId, messages: [] };
      this.sessions.push(session);
    }
    Object.assign(session, { backendId: remote.id, title: remote.title || '新对话', updatedAt: remote.updatedAt, messages: remote.messages.filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string').map(m => ({ ...m, agentId: session.agentId || agentId })) });
    this.save(); return session;
  }
  append(text, agent, reply) {
    const session = this.active;
    text = String(text).trim(); if (!session || !text) return false;
    if (!session.messages.length) session.title = text.slice(0, 28);
    session.agentId = agent.id; session.draft = ''; session.updatedAt = Date.now();
    session.messages.push({ role: 'user', text, createdAt: Date.now() }, { role: 'assistant', agentId: agent.id, text: reply || '已记录这项任务，并交给办公室伙伴处理。当前为本地任务回执，尚未接入真实 AI 服务。', createdAt: Date.now() });
    this.save(); return true;
  }
}
