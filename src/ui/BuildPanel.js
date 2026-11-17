const PRESETS = {
  default: { offset: [0, 0, 0], rotationY: 0, scale: 1, positions: [[-1.85, 0, -2.35], [1.85, 0, -0.75], [-0.85, 0, 2.25]] },
  wide: { offset: [0, 0, 0.12], rotationY: 0, scale: 1.06, positions: [[-2.55, 0, -2.2], [2.55, 0, -0.65], [-1.05, 0, 2.45]] },
  compact: { offset: [0, 0, 0], rotationY: 0, scale: 0.9, positions: [[-1.55, 0, -1.95], [1.55, 0, -0.75], [-0.75, 0, 1.95]] },
};

export class BuildPanel {
  constructor(container, getScene, onBuild, bridge, notify) {
    this.container = container;
    this.getScene = getScene;
    this.onBuild = onBuild;
    this.bridge = bridge;
    this.notify = notify;
    this.revision = 0;
    this.lastPrompt = '';
    container.innerHTML = `
      <div class="build-panel-top"><span class="build-icon">✳</span><div><strong>AI 场景搭建</strong><small>修改描述，即时预览</small></div><span class="build-live"><i></i> LIVE</span></div>
      <form id="scene-build-form">
        <label for="scene-prompt">描述你想调整的办公室</label>
        <textarea id="scene-prompt" placeholder="例如：把工位排列得更宽敞，转成稍微从左上方观察，整体缩小一点。" maxlength="500"></textarea>
        <div class="build-controls"><button class="build-submit" type="submit">✦ <span>搭建并预览</span></button><button id="open-preview" class="preview-submit" type="button">↗ <span>独立预览</span></button></div>
      </form>
      <div class="preset-title">快速场景</div>
      <div class="scene-presets"><button data-preset="default" class="active">⌂ <span>经典工位</span></button><button data-preset="wide">↔ <span>宽敞排布</span></button><button data-preset="compact">▧ <span>紧凑布局</span></button></div>
      <div class="build-progress" id="build-progress" hidden><span class="progress-spark">✳</span><span id="progress-text">正在理解场景描述</span><span class="progress-dots"><i></i><i></i><i></i></span></div>
      <div class="build-caption"><span>⌘</span> 本地场景生成演示 · 无需连接 AI</div>`;
    container.querySelector('#scene-build-form').onsubmit = event => {
      event.preventDefault();
      const prompt = container.querySelector('#scene-prompt').value.trim();
      if (!prompt) { notify('先输入想要修改的场景'); container.querySelector('#scene-prompt').focus(); return; }
      this.applyPrompt(prompt);
    };
    container.querySelector('#open-preview').onclick = () => {
      const scene = this.getScene();
      if (!bridge.open(scene)) notify('弹出窗口被浏览器拦截，请允许本站打开弹窗后重试');
      else notify('已打开独立场景预览，拖动画布旋转场景');
    };
    container.querySelectorAll('[data-preset]').forEach(button => {
      button.onclick = () => {
        container.querySelectorAll('[data-preset]').forEach(item => item.classList.toggle('active', item === button));
        const scene = this.getScene();
        const preset = PRESETS[button.dataset.preset];
        const next = { ...scene, ...preset, agents: scene.agents.map((agent, i) => ({ ...agent, position: [...preset.positions[i]] })), updatedAt: Date.now() };
        this.onBuild(next);
        this.bridge.update(next);
        this.lastPrompt = button.querySelector('span').textContent;
        this.renderProgress('场景已更新', false);
      };
    });
  }

  applyPrompt(prompt) {
    const lower = prompt.toLowerCase();
    const scene = this.getScene();
    let preset = PRESETS.default;
    if (/宽敞|宽一点|分散|间距|wide|spacious/.test(prompt)) preset = PRESETS.wide;
    else if (/紧凑|靠近|聚拢|compact/.test(prompt)) preset = PRESETS.compact;
    let rotationY = scene.rotationY || 0;
    if (/左边|左侧|从左|left/.test(prompt)) rotationY = -0.22;
    if (/右边|右侧|从右|right/.test(prompt)) rotationY = 0.22;
    if (/正面|正视|front/.test(prompt)) rotationY = 0;
    const next = {
      ...scene, ...preset, title: 'AI 场景搭建', rotationY,
      agents: scene.agents.map((agent, i) => ({ ...agent, position: [...preset.positions[i]] })), updatedAt: Date.now(),
    };
    this.lastPrompt = prompt;
    this.renderProgress('正在排列办公工位', true);
    setTimeout(() => {
      this.onBuild(next);
      this.bridge.update(next);
      this.renderProgress('预览已同步到独立窗口', false);
    }, 420);
  }

  renderProgress(message, loading) {
    const progress = this.container.querySelector('#build-progress');
    progress.hidden = false;
    progress.classList.toggle('is-loading', loading);
    this.container.querySelector('#progress-text').textContent = message;
    if (this.progressTimeout) clearTimeout(this.progressTimeout);
    if (!loading) this.progressTimeout = setTimeout(() => { progress.hidden = true; }, 2600);
  }

  dispose() { clearTimeout(this.progressTimeout); }
}
