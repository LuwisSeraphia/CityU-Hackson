import { escapeText } from './WorkspacePanel.js';
import { ConversationStore } from '../state/ConversationStore.js';

/** Main conversation view, with the office folded behind it. */
export class ChatDrawer {
  constructor(store, notify, onRetrieve = () => null) {
    this.store = store;
    this.notify = notify;
    this.conversations = new ConversationStore();
    this.root = document.createElement('dialog');
    this.root.className = 'chat-drawer';
    this.root.setAttribute('aria-label', '对话内容');
    this.root.innerHTML = `
      <header><div><small>知乎 · 知识星球</small><h2>新对话</h2></div><button data-close aria-label="展开办公室">展开办公室 ↗</button></header>
      <div class="folded-office"><span>⌂ 办公室已折叠 · 3 位伙伴在线</span><button data-office>返回办公室</button></div>
      <div class="chat-drawer-tools"><label>对话伙伴<select aria-label="选择对话伙伴">${store.getSnapshot().agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label><button data-new>新对话</button></div>
      <label class="knowledge-toggle"><input type="checkbox" data-knowledge> 调用图书墙知识区 <small>本地检索</small></label>
      <div class="chat-drawer-messages" role="log" aria-live="polite"></div>
      <form><textarea aria-label="输入消息" placeholder="输入消息，交给伙伴处理…" rows="3" maxlength="240" required></textarea><footer><small>Enter 发送 · Shift+Enter 换行</small><button type="submit">发送 ↑</button></footer></form>
      <p class="chat-drawer-note">历史对话保存在本浏览器。当前为本地任务演示。</p>`;
    document.querySelector('.workspace').append(this.root);
    this.root.querySelector('[data-close]').onclick = () => this.close();
    this.root.querySelector('[data-office]').onclick = () => this.close();
    this.root.querySelector('[data-new]').onclick = () => this.newConversation();
    this.root.addEventListener('close', () => { document.body.classList.remove('conversation-mode'); this.onClose?.(); });
    const form = this.root.querySelector('form'), input = this.root.querySelector('textarea'), select = this.root.querySelector('select');
    input.oninput = () => { if (this.conversations.active) { this.conversations.active.draft = input.value; this.conversations.save(); } };
    select.onchange = () => { if (this.conversations.active) { this.conversations.active.agentId = select.value; this.conversations.save(); } };
    input.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    };
    form.onsubmit = event => {
      event.preventDefault();
      const text = input.value.trim(); if (!text) return;
      const agent = store.getSnapshot().agents.find(a => a.id === select.value);
      if (!agent) return;
      let reply;
      if (this.root.querySelector('[data-knowledge]').checked) {
        const result = onRetrieve(agent.id, text);
        if (!result?.hits?.length) return;
        reply = '已检索到以下资料，伙伴正在前往图书墙取书（本地检索片段，非模型生成回答）：\n\n' + result.hits.map((hit, i) => `[${i + 1}] ${hit.title} · 第 ${hit.offset + 1} 字起${hit.sourceUrl ? '\n来源：' + hit.sourceUrl : ''}\n${hit.excerpt}`).join('\n\n');
      } else if (!store.assignTask(agent.id, text)) return;
      this.conversations.append(text, agent, reply); input.value = ''; this.render(); input.focus();
      if (this.conversations.storageFailed) notify('存储空间不可用，对话仅保留在本次会话');
    };
    this.render();
  }
  newConversation() { this.conversations.create(); this.openActive(); }
  open(id) {
    if (id) { if (!this.conversations.select(id)) return; }
    else this.conversations.create();
    this.openActive();
  }
  openActive() {
    this.store.select(null);
    document.body.classList.add('conversation-mode');
    if (!this.root.open) this.root.show();
    this.root.classList.add('is-open');
    const session = this.conversations.active;
    this.root.querySelector('select').value = this.store.getSnapshot().agents.some(a => a.id === session?.agentId) ? session.agentId : 'browser';
    this.root.querySelector('textarea').value = session?.draft || '';
    this.render(); this.root.querySelector('textarea').focus();
  }
  close() {
    if (this.root.open) this.root.close();
    document.body.classList.remove('conversation-mode');
    this.root.classList.remove('is-open');
  }
  avatar(agent) {
    return `<span class="conversation-avatar" style="--agent-color:${agent.color}" role="img" aria-label="${agent.name} 头像"><i class="portrait-ear left"></i><i class="portrait-ear right"></i><i class="portrait-eye left"></i><i class="portrait-eye right"></i><i class="portrait-nose"></i></span>`;
  }
  render() {
    const session = this.conversations.active;
    const agents = this.store.getSnapshot().agents;
    const log = this.root.querySelector('.chat-drawer-messages');
    this.root.querySelector('h2').textContent = session?.title || '新对话';
    log.innerHTML = session?.messages.length ? session.messages.map(m => {
      const agent = agents.find(a => a.id === m.agentId) || agents[0];
      return `<article class="conversation-message ${m.role}">${m.role === 'assistant' ? this.avatar(agent) : '<span class="user-portrait" aria-label="用户头像">我</span>'}<div class="chat-bubble ${m.role}"><small>${m.role === 'assistant' ? agent.name : '你'}</small><p>${escapeText(m.text)}</p></div></article>`;
    }).join('') : '<div class="chat-welcome"><h3>有什么想交给伙伴？</h3><p>选择一位 Agent，开始这次对话。</p></div>';
    log.scrollTop = log.scrollHeight;
  }
  dispose() { this.root.remove(); document.body.classList.remove('conversation-mode'); }
}
