import { escapeText } from './WorkspacePanel.js';
import { ConversationStore } from '../state/ConversationStore.js';
import { ChatController } from '../state/ChatController.js';

/** Backend conversations with a local cache; no fallback to simulated replies. */
export class ChatDrawer {
  constructor(store, notify, { knowledgeSearch = () => [], client } = {}) {
    Object.assign(this, { store, notify, knowledgeSearch, officeRuns: new Map() });
    this.conversations = new ConversationStore();
    this.root = document.createElement('dialog'); this.root.className = 'chat-drawer'; this.root.setAttribute('aria-label', '对话内容');
    this.root.innerHTML = `
      <header><div><small>知乎 · 知识星球</small><h2>新对话</h2></div><button data-close aria-label="展开办公室">展开办公室 ↗</button></header>
      <div class="folded-office"><span>⌂ 办公室已折叠</span><button data-office>返回办公室</button></div>
      <div class="backend-connection"><span data-connection role="status">正在连接后端…</span><button data-connect>重新连接</button></div>
      <div class="chat-drawer-tools"><label>对话伙伴<select aria-label="选择对话伙伴">${store.getSnapshot().agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label><button data-new>新对话</button></div>
      <label class="knowledge-toggle"><input type="checkbox" data-knowledge> 附上本地书墙相关资料</label><small class="knowledge-send-note">勾选后，将命中的资料片段随本条消息发送到后端。</small>
      <div class="chat-drawer-messages" role="log" aria-live="polite"></div>
      <aside class="chat-source" hidden aria-label="引用来源"></aside>
      <div class="chat-run-state" role="status"></div><div class="chat-backend-error" role="alert" hidden></div>
      <div class="chat-run-actions"><button data-resume hidden>恢复回答连接</button><button data-cancel hidden>停止回答</button></div>
      <form><textarea aria-label="输入消息" placeholder="输入消息，交给伙伴处理…" rows="2" maxlength="4000" required></textarea><footer><small>Enter 发送 · Shift+Enter 换行</small><button type="submit">发送 ↑</button></footer></form>
      <p class="chat-drawer-note">回答和历史由后端保存，浏览器保留缓存。运行状态实时更新，完成后显示回答。本轮不写入长期记忆。</p>`;
    document.querySelector('.workspace').append(this.root);
    this.controller = new ChatController(this.conversations, { ...(client ? { client } : {}), onChange: () => this.render(), onTask: event => this.syncOffice(event) });
    this.root.querySelector('[data-close]').onclick = () => this.close();
    this.root.querySelector('[data-office]').onclick = () => this.close();
    this.root.querySelector('[data-new]').onclick = () => this.newConversation();
    this.root.querySelector('[data-connect]').onclick = async () => { await this.controller.connect(); await this.controller.activate(this.conversations.active); };
    this.root.querySelector('[data-resume]').onclick = () => this.controller.resume();
    this.root.querySelector('[data-cancel]').onclick = () => this.controller.cancel();
    this.root.addEventListener('close', () => { document.body.classList.remove('conversation-mode'); this.onClose?.(); });
    const form = this.root.querySelector('form'), input = this.root.querySelector('textarea'), select = this.root.querySelector('select');
    input.oninput = () => { if (this.conversations.active) { this.conversations.active.draft = input.value; this.conversations.save(); } };
    select.onchange = () => { if (this.conversations.active) { this.conversations.active.agentId = select.value; this.conversations.save(); } };
    input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } };
    form.onsubmit = async event => {
      event.preventDefault();
      const session = this.conversations.active, text = input.value.trim();
      if (!text || !session || this.controller.busy) return;
      session.agentId = select.value; session.draft = text; this.conversations.save();
      let context = '';
      if (this.root.querySelector('[data-knowledge]').checked) {
        const matches = this.knowledgeSearch(text);
        const hits = matches.filter(hit => hit.score >= (matches[0]?.score || 0) * .6);
        if (!hits.length) { this.notify('书墙没有命中资料，可调整问题或取消附带资料'); return; }
        context = '# 用户从本地知识墙选择的资料节选\n\n' + hits.map(hit => `## ${hit.title}\n原文第 ${hit.offset + 1} 字起${hit.sourceUrl ? '\n来源：' + hit.sourceUrl : ''}\n\n${hit.excerpt}`).join('\n\n');
      }
      await this.controller.send(text, { context });
      if (this.conversations.active === session) { input.value = session.draft || ''; if (!this.controller.busy) input.focus(); }
      if (this.conversations.storageFailed) notify('本地缓存无法保存，消息仍可从后端恢复');
    };
    this.unsubscribe = this.conversations.subscribe(() => this.render());
    this.controller.connect();
  }
  syncOffice({ agentId, text, status, runId }) {
    if (status === 'RUNNING') {
      this.store.assignTask(agentId, text);
      this.officeRuns.set(runId, this.store.getSnapshot().agents.find(a => a.id === agentId)?.taskId);
    } else {
      const agent = this.store.getSnapshot().agents.find(a => a.id === agentId);
      const task = this.store.getSnapshot().tasks.find(t => t.id === agent?.taskId);
      if (this.officeRuns.has(runId) && agent?.taskId === this.officeRuns.get(runId) && task?.name === text.slice(0, 240)) this.store.transition(agentId, status === 'SUCCEEDED' ? 'completed' : 'idle');
      this.officeRuns.delete(runId);
    }
  }
  newConversation(agentId = 'browser', draft = '') { const session = this.conversations.create(agentId); session.draft = draft; this.conversations.save(); this.openActive(); }
  startTask(agentId, prompt) { this.newConversation(agentId, prompt); this.root.querySelector('form').requestSubmit(); }
  open(id) {
    if (id) { if (!this.conversations.select(id)) return; }
    else this.conversations.create();
    this.openActive();
  }
  openActive() {
    this.store.select(null); document.body.classList.add('conversation-mode');
    if (!this.root.open) this.root.show(); this.root.classList.add('is-open');
    const session = this.conversations.active;
    this.root.querySelector('select').value = this.store.getSnapshot().agents.some(a => a.id === session?.agentId) ? session.agentId : 'browser';
    this.root.querySelector('textarea').value = session?.draft || '';
    this.root.querySelector('.chat-source').hidden = true;
    this.render(); this.controller.activate(session); this.root.querySelector('textarea').focus();
  }
  close() { if (this.root.open) this.root.close(); document.body.classList.remove('conversation-mode'); this.root.classList.remove('is-open'); }
  avatar(agent) { return `<span class="conversation-avatar" style="--agent-color:${agent.color}" role="img" aria-label="${agent.name} 头像"><i class="portrait-ear left"></i><i class="portrait-ear right"></i><i class="portrait-eye left"></i><i class="portrait-eye right"></i><i class="portrait-nose"></i></span>`; }
  async showSource(identifier) {
    const sessionId = this.conversations.activeId, panel = this.root.querySelector('.chat-source');
    panel.hidden = false; panel.innerHTML = '<p>正在读取后端来源…</p>';
    try {
      const source = await this.controller.client.evidence(identifier);
      if (this.conversations.activeId !== sessionId) return;
      panel.innerHTML = `<button data-source-close aria-label="关闭来源">×</button><h3>${escapeText(source.title || '引用来源')}</h3><p>${escapeText(source.text || source.excerpt || '暂无原文')}</p>`;
    } catch (error) { panel.innerHTML = `<button data-source-close aria-label="关闭来源">×</button><p>${escapeText(error.message)}</p>`; }
    panel.querySelector('[data-source-close]').onclick = () => { panel.hidden = true; };
  }
  render() {
    const session = this.conversations.active, controller = this.controller;
    const agents = this.store.getSnapshot().agents, log = this.root.querySelector('.chat-drawer-messages');
    const keepAtBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    this.root.querySelector('h2').textContent = session?.title || '新对话';
    log.innerHTML = session?.messages.length ? session.messages.map((m, index) => {
      const agent = agents.find(a => a.id === m.agentId) || agents[0];
      const citations = Array.isArray(m.citations) ? m.citations.filter(id => typeof id === 'string') : [];
      return `<article class="conversation-message ${m.role}">${m.role === 'assistant' ? this.avatar(agent) : '<span class="user-portrait" aria-label="用户头像">我</span>'}<div class="chat-bubble ${m.role}"><small>${m.role === 'assistant' ? agent.name : '你'}</small><p>${escapeText(m.text)}</p>${citations.map(id => `<button class="chat-citation" data-citation="${escapeText(id)}">查看来源 ${citations.indexOf(id) + 1}</button>`).join('')}${m.answer?.retryText && m.id ? `<button data-retry="${index}">重试回答</button>` : ''}${Array.isArray(m.answer?.warnings) ? m.answer.warnings.map(w => `<small class="chat-warning">${escapeText(w)}</small>`).join('') : ''}</div></article>`;
    }).join('') : '<div class="chat-welcome"><h3>有什么想交给伙伴？</h3><p>消息会发送到后端，回答完成后保存在历史中。</p></div>';
    log.querySelectorAll('[data-citation]').forEach(b => b.onclick = () => this.showSource(b.dataset.citation));
    log.querySelectorAll('[data-retry]').forEach(b => { b.disabled = controller.busy; b.onclick = () => { const m = session.messages[Number(b.dataset.retry)]; this.controller.send(m.answer.retryText, { retryMessageId: m.id }); }; });
    if (keepAtBottom) log.scrollTop = log.scrollHeight;
    const legacy = !!(session?.messages.length && !session.backendId);
    const connection = this.root.querySelector('[data-connection]');
    connection.textContent = controller.loading ? '正在连接后端…' : !controller.ready ? '后端未就绪' : controller.health.mode === 'local_demo' ? '本地联调模式 · 非云端 AI' : '云模型已配置 · 回答将调用后端';
    connection.dataset.ready = String(controller.ready);
    const error = this.root.querySelector('.chat-backend-error'); error.hidden = !controller.error && !legacy; error.textContent = legacy ? '这是旧版本地演示记录。请新建对话使用后端，原记录仍保留。' : controller.error;
    const stages = { connecting: '正在连接并提交消息…', reconnecting: '正在恢复回答连接…', received: '后端已接收', retrieving: '正在读取上下文与资料…', generating: '后端正在生成回答…', complete: '回答已保存', failed: '本次运行已结束' };
    const another = controller.busy && controller.runSession?.id !== session?.id;
    this.root.querySelector('.chat-run-state').textContent = controller.busy ? (another ? '另一个会话正在回答，可切回查看或停止。' : stages[controller.stage] || '后端正在处理…') : '';
    const cancel = this.root.querySelector('[data-cancel]'); cancel.hidden = !(controller.runSession?.pendingRunId || session?.pendingRunId); cancel.disabled = !!controller.cancelling; cancel.textContent = controller.cancelling ? '正在停止…' : '停止回答';
    this.root.querySelector('[data-resume]').hidden = !session?.pendingRunId || controller.busy;
    this.root.querySelector('[data-connect]').disabled = controller.loading || controller.busy;
    this.root.querySelector('form button').disabled = controller.busy || controller.loading || legacy || !!session?.pendingRunId;
    this.root.querySelector('textarea').disabled = controller.busy || legacy;
    this.root.querySelector('select').disabled = controller.busy || !!session?.messages.length;
    if (controller.busy && session?.pendingRunId && controller.runSession?.id === session.id) this.root.querySelector('textarea').value = '';
  }
  dispose() { this.controller.dispose(); this.unsubscribe(); this.root.remove(); document.body.classList.remove('conversation-mode'); }
}
