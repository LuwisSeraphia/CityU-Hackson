/** Single source of truth. Animation poses never own task counters. */
export const STATE_LABELS = Object.freeze({
  idle: '空闲待命', thinking: '正在思考', working: '专注工作', completed: '任务完成',
});
const DEFINITIONS = [
  { id: 'browser', name: 'Browser Agent', role: '浏览与信息检索', color: '#15b9c4', taskDescription: '检索网页，整理参考资料与摘要', position: [-1.85, 0, -2.35] },
  { id: 'computer', name: 'Computer Agent', role: '桌面操作与执行', color: '#77aa56', taskDescription: '整理工作流程，执行桌面操作', position: [1.85, 0, -0.75] },
  { id: 'file', name: 'File Agent', role: '文件整理与归档', color: '#9565d6', taskDescription: '分类项目文档，建立清晰的文件目录', position: [-0.85, 0, 2.25] },
];

export class AgentStore {
  #agents = DEFINITIONS.map(agent => ({ ...agent, position: [...agent.position], state: 'idle', taskId: null }));
  #tasks = [];
  #messages = [];
  #listeners = new Set();
  #sequence = 0;
  selectedId = null;

  getSnapshot() {
    const tasks = this.#tasks.map(task => ({ ...task }));
    return {
      agents: this.#agents.map(agent => ({ ...agent, position: [...agent.position] })),
      tasks,
      messages: this.#messages.map(message => ({ ...message })),
      selectedId: this.selectedId,
      stats: {
        active: tasks.filter(task => ['working', 'thinking'].includes(task.status)).length,
        completed: tasks.filter(task => task.status === 'completed').length,
        cancelled: tasks.filter(task => task.status === 'cancelled').length,
        total: tasks.length,
      },
    };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    const snapshot = this.getSnapshot();
    this.#listeners.forEach(listener => listener(snapshot));
  }

  select(id) {
    if (id !== null && !this.#agents.some(agent => agent.id === id)) return;
    this.selectedId = id;
    this.#emit();
  }

  transition(id, state) {
    const agent = this.#agents.find(item => item.id === id);
    if (!agent || !Object.hasOwn(STATE_LABELS, state)) return false;
    if (agent.state === state) return false;
    let task = this.#tasks.find(item => item.id === agent.taskId);

    if (state === 'completed') {
      // Complete is an event, and only an active task can be completed once.
      if (!task || !['working', 'thinking'].includes(task.status)) return false;
      task.status = 'completed';
      task.finishedAt = Date.now();
      agent.taskId = null;
    } else if (state === 'working' || state === 'thinking') {
      if (!task) {
        task = {
          id: ++this.#sequence, agentId: id, name: agent.taskDescription,
          status: state, createdAt: Date.now(), finishedAt: null,
        };
        this.#tasks.unshift(task);
        agent.taskId = task.id;
      } else task.status = state;
    } else if (state === 'idle') {
      if (task && ['working', 'thinking'].includes(task.status)) {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
      }
      agent.taskId = null;
    }
    agent.state = state;
    this.#emit();
    return true;
  }

  assignTask(id, description) {
    const agent = this.#agents.find(item => item.id === id);
    const name = String(description || '').trim().slice(0, 240);
    if (!agent || !name) return false;
    let task = this.#tasks.find(item => item.id === agent.taskId);
    if (!task || !['working', 'thinking'].includes(task.status)) {
      task = { id: ++this.#sequence, agentId: id, name, status: 'working', createdAt: Date.now(), finishedAt: null };
      this.#tasks.unshift(task);
      agent.taskId = task.id;
    } else {
      task.name = name;
      task.status = 'working';
      task.finishedAt = null;
    }
    this.#messages.push({ agentId: id, text: name, createdAt: Date.now() });
    agent.state = 'working';
    this.#emit();
    return true;
  }

  finishCelebration(id) {
    const agent = this.#agents.find(item => item.id === id);
    if (agent?.state === 'completed') this.transition(id, 'idle');
  }
}
