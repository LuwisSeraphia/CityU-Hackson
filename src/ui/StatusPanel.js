import { escapeText } from './WorkspacePanel.js';
import { STATE_LABELS } from '../state/AgentStore.js';
const TASK_LABELS = { ...STATE_LABELS, cancelled: '已重置' };

export class StatusPanel {
  constructor(container, store) {
    this.container = container;
    this.store = store;
    this.filter = 'all';
    container.innerHTML = `
      <button class="overview-toggle" aria-label="收起工作概览" aria-expanded="true" aria-controls="overview-content"><span class="overview-chevron">›</span><span class="overview-rail-label">工作概览</span></button><div id="overview-content"><div class="panel-heading"><h2>工作概览</h2><span class="demo-badge">DEMO</span></div>
      <div class="token-grid"><div><span>交互估算 Token</span><strong id="tokens-used">0</strong><small>模拟用量</small></div><div><span>估算节省 Token</span><strong id="tokens-saved">0</strong><small>本地协作模拟</small></div></div>
      <div class="section-heading"><h3>对话明细</h3><select id="task-filter" aria-label="筛选任务"><option value="all">全部</option><option value="active">进行中</option><option value="completed">已完成</option></select></div>
      <div class="stats-grid"><div><strong id="active-count">0</strong><span>进行中</span></div><div><strong id="completed-count">0</strong><span>已完成</span></div><div><strong id="total-count">0</strong><span>总计</span></div></div>
      <p id="cancelled-note" class="cancelled-note" hidden></p>
      <div class="section-heading team-heading"><h3>你的 Agent 团队</h3><span>03</span></div>
      <div id="agent-list" class="agent-list"></div>
      <div class="section-heading task-heading"><h3>任务动态</h3><span id="task-count">0 条</span></div>
      <div id="task-list" class="task-list" aria-live="polite"></div>
      <p class="demo-note"><span>◌</span> Token 为界面估算。聊天状态来自后端；手动操作与定时任务为本地演示。办公室统计刷新后重置。</p></div>`;
    let collapsed = window.matchMedia('(max-width:760px)').matches;
    try { const saved = localStorage.getItem('office-overview-collapsed'); if (saved !== null) collapsed = saved === 'true'; } catch { /* optional storage */ }
    const toggle = container.querySelector('.overview-toggle');
    const setCollapsed = value => {
      collapsed = value;
      document.body.classList.toggle('overview-collapsed', value);
      container.querySelector('#overview-content').hidden = value;
      toggle.setAttribute('aria-expanded', String(!value));
      toggle.setAttribute('aria-label', value ? '展开工作概览' : '收起工作概览');
      toggle.querySelector('.overview-chevron').textContent = value ? '‹' : '›';
    };
    setCollapsed(collapsed);
    toggle.onclick = () => {
      setCollapsed(!collapsed);
      try { localStorage.setItem('office-overview-collapsed', String(collapsed)); } catch { /* optional storage */ }
    };
    container.querySelector('#task-filter').onchange = event => {
      this.filter = event.target.value;
      this.render(store.getSnapshot());
    };
    container.addEventListener('click', event => {
      const button = event.target.closest('[data-select-agent]');
      if (button) store.select(button.dataset.selectAgent);
    });
    container.addEventListener('keydown', event => {
      const row = event.target.closest('.task-entry');
      if (row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); store.select(row.dataset.selectAgent); }
    });
    this.unsubscribe = store.subscribe(snapshot => this.render(snapshot));
  }

  render({ agents, tasks, stats, selectedId }) {
    const set = (id, value) => { this.container.querySelector(`#${id}`).textContent = value; };
    set('active-count', stats.active);
    set('completed-count', stats.completed);
    set('total-count', stats.total);
    set('tokens-used', (stats.total * 240 + stats.completed * 1040).toLocaleString());
    set('tokens-saved', (stats.completed * 680).toLocaleString());
    const cancelled = this.container.querySelector('#cancelled-note');
    cancelled.hidden = !stats.cancelled;
    cancelled.textContent = `总计包含 ${stats.cancelled} 个已重置任务`;
    // Keep team buttons mounted so keyboard focus survives store updates.
    const list = this.container.querySelector('#agent-list');
    if (!list.children.length) list.innerHTML = agents.map(agent => `
      <button class="team-agent" data-select-agent="${agent.id}" style="--agent-color:${agent.color}">
        <span class="avatar"><span class="avatar-eyes">••</span></span>
        <span class="team-copy"><strong>${agent.name}</strong><small>${agent.role}</small></span>
        <span class="team-status"></span>
      </button>`).join('');
    agents.forEach(agent => {
      const row = list.querySelector(`[data-select-agent="${agent.id}"]`);
      row.classList.toggle('selected', selectedId === agent.id);
      row.setAttribute('aria-pressed', String(selectedId === agent.id));
      row.querySelector('.team-status').textContent = STATE_LABELS[agent.state];
      row.dataset.state = agent.state;
    });
    const filtered = tasks.filter(task => this.filter === 'all' || (this.filter === 'active' ? ['working', 'thinking'].includes(task.status) : task.status === 'completed'));
    set('task-count', `${filtered.length} 条`);
    this.container.querySelector('#task-list').innerHTML = filtered.length ? filtered.map(task => {
      const agent = agents.find(item => item.id === task.agentId);
      return `<article class="task-entry" role="button" tabindex="0" data-select-agent="${task.agentId}" data-task-id="${task.id}" style="--agent-color:${agent.color}"><span class="task-dot"></span><div><strong>${agent.name}</strong><p>${escapeText(task.name)}</p><small>${TASK_LABELS[task.status]}<span>DEMO · #${String(task.id).padStart(2, '0')}</span></small></div></article>`;
    }).join('') : '<div class="empty-tasks"><span>⌁</span><p>一切准备就绪</p><small>选择 Agent，开始第一个任务</small></div>';
  }

  dispose() { this.unsubscribe(); }
}
