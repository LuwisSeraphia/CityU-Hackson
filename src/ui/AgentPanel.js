import { STATE_LABELS } from '../state/AgentStore.js';

export class AgentPanel {
  constructor(container, store, onTransition = () => {}, onSend = () => {}) {
    this.container = container;
    this.store = store;
    this.lastId = null;
    this.drafts = new Map();
    container.innerHTML = `
      <div class="agent-panel-heading"><span id="detail-role">AGENT DETAILS</span><button id="close-agent" aria-label="关闭 Agent 信息">×</button></div>
      <div class="detail-identity"><span class="avatar large"><span class="avatar-eyes">••</span></span><div><h2 id="detail-name"></h2><span id="detail-state"></span></div></div>
      <div class="detail-task"><span>当前任务 <small>DEMO</small></span><p id="detail-task"></p></div>
      <div class="agent-chat-history" id="agent-chat-history"><span>从办公室叫一位伙伴，直接交代要做的事。</span></div>
      <form class="agent-chat-form" id="agent-chat-form"><textarea id="agent-chat-input" rows="1" maxlength="240" aria-label="给 Agent 的任务" placeholder="给这位伙伴安排任务…"></textarea><button aria-label="发送任务">↑</button></form>
      <div class="agent-actions"><button data-state="working">▶ <span>继续工作</span></button><button data-state="thinking">✦ <span>让它思考</span></button><button data-state="completed">✓ <span>完成任务</span></button><button data-state="idle">↺ <span>重置</span></button></div>
      <p class="detail-hint">交代任务后，伙伴会在办公室里开始工作。</p>`;
    container.querySelector('#close-agent').onclick = () => store.select(null);
    container.querySelectorAll('[data-state]').forEach(button => {
      button.onclick = () => {
        const id = store.selectedId;
        const state = button.dataset.state;
        if (store.transition(id, state)) onTransition(id, state);
      };
    });
    container.querySelector('#agent-chat-form').onsubmit = event => {
      event.preventDefault();
      const input = container.querySelector('#agent-chat-input');
      const message = input.value.trim();
      if (!message || !this.store.selectedId) return;
      onSend(this.store.selectedId, message);
      input.value = '';
      this.drafts.delete(this.store.selectedId);
    };
    const input = container.querySelector('#agent-chat-input');
    input.addEventListener('input', () => { if (store.selectedId) this.drafts.set(store.selectedId, input.value); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); container.querySelector('#agent-chat-form').requestSubmit(); }
    });
    this.unsubscribe = store.subscribe(snapshot => this.render(snapshot));
  }

  render({ agents, tasks, messages = [], selectedId }) {
    const agent = agents.find(item => item.id === selectedId);
    this.container.hidden = !agent;
    if (!agent) { this.lastId = null; return; }
    this.container.style.setProperty('--agent-color', agent.color);
    this.container.querySelector('#detail-name').textContent = agent.name;
    this.container.querySelector('#detail-role').textContent = agent.role;
    this.container.querySelector('#detail-state').textContent = STATE_LABELS[agent.state];
    const task = tasks.find(item => item.id === agent.taskId);
    this.container.querySelector('#detail-task').textContent = task?.name || (agent.state === 'completed' ? '做得很棒！任务已完成。' : `准备就绪 · ${agent.taskDescription}`);
    const history = this.container.querySelector('#agent-chat-history');
    const conversation = messages.filter(message => message.agentId === selectedId);
    history.innerHTML = conversation.length
      ? conversation.map(message => `<p><small>你 · ${new Date(message.createdAt).toLocaleTimeString()}</small><br>${this.escape(message.text)}</p>`).join('') + '<span>任务交代已记录。后端回答请在对应对话中查看；此面板的手动状态操作为本地演示。</span>'
      : '<span>从办公室叫一位伙伴，直接交代要做的事。</span>';
    if (this.lastId !== selectedId) this.container.querySelector('#agent-chat-input').value = this.drafts.get(selectedId) || '';
    history.scrollTop = history.scrollHeight;
    this.container.querySelectorAll('[data-state]').forEach(button => {
      const state = button.dataset.state;
      button.classList.toggle('is-current', agent.state === state);
      button.disabled = state === 'completed' ? !task : agent.state === state;
    });
    if (this.lastId !== selectedId) this.container.setAttribute('aria-label', `${agent.name} 信息与状态控制`);
    this.lastId = selectedId;
  }

  escape(value) {
    const node = document.createElement('span');
    node.textContent = value;
    return node.innerHTML;
  }

  dispose() { this.unsubscribe(); }
}
