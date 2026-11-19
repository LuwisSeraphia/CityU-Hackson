import { icon } from './icons.js';
const navigation = [
  ['chat', '新建对话'],
  ['knowledge', '知识书墙'], ['zhihu', '知乎网页'], ['office', '办公室'],
];
const plugins = [['doc', '文稿'], ['image', '图片'], ['computer', '此电脑']];
// Skills and scheduling live here; local viewers remain in the More menu.
import { APPLICATION_TOOLS } from './applicationTools.js';
const shortcuts = APPLICATION_TOOLS;

export function Sidebar(container, notify, onNavigate) {
  container.innerHTML = `
    <a class="brand" href="#office" aria-label="知乎知识星球办公室"><span class="zhihu-mark">知</span><span class="brand-name">知乎</span><span class="brand-caption">知识星球</span></a>
    <label class="sidebar-search">${icon('search')}<input placeholder="搜索" aria-label="搜索导航"><kbd>⌘ K</kbd></label>
    <nav aria-label="主导航">${navigation.map(([symbol, title]) => `
      ${symbol === 'knowledge' ? '<p class="nav-caption">本地知识库</p>' : ''}
      ${symbol === 'office' ? `<button class="nav-link toolbar-trigger" aria-label="工具栏" aria-expanded="false" aria-controls="radial-toolbar">${icon('apps')}<span>工具栏</span><span class="toolbar-hint">⌁</span></button><button class="nav-link more-trigger" aria-label="更多小插件" aria-expanded="false" aria-controls="sidebar-plugins">${icon('more')}<span>更多</span></button><div id="sidebar-plugins" class="sidebar-plugins" hidden>${plugins.map(([id, label]) => `<button class="nav-link plugin-link" data-nav="${id}" aria-label="${label}">${icon(id)}<span>${label}</span></button>`).join('')}</div><p class="nav-caption">对话</p>` : ''}
      <button class="nav-link ${symbol === 'office' ? 'active' : ''}" data-nav="${symbol}" aria-label="${title}" ${symbol === 'office' ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${title}</span></button>`).join('')}
    </nav>
    <footer><button class="account-button" aria-label="设置">${icon('user')}<span>设置</span></button><button class="notification-button" aria-label="查看通知">${icon('bell')}</button></footer>`;
  const cleanup = new AbortController(), signal = cleanup.signal;
  const trigger = container.querySelector('.toolbar-trigger');
  const more = container.querySelector('.more-trigger');
  const extras = container.querySelector('.sidebar-plugins');
  const radial = document.createElement('div');
  radial.id = 'radial-toolbar'; radial.className = 'radial-toolbar'; radial.hidden = true;
  radial.setAttribute('role', 'group'); radial.setAttribute('aria-label', '快捷工具');
  const positions = [[65, 26], [148, 102], [148, 192], [65, 268]];
  radial.innerHTML = `<svg class="radial-orbit" viewBox="0 0 280 320" aria-hidden="true"><path d="M80 42 C218 80 218 248 80 288"/></svg><span class="radial-center">✧</span>${shortcuts.map(([id, label, symbol], i) => `<button class="radial-tool" data-shortcut="${id}" aria-label="${label}" style="--tool-x:${positions[i][0]}px;--tool-y:${positions[i][1]}px;--tool-order:${i}"><span class="radial-tool-icon">${icon(symbol || id)}</span><span class="radial-tool-label">${label}</span></button>`).join('')}`;
  document.body.append(radial);
  let timer, closeTimer, openFrame, isOpen = false;
  const position = () => {
    if (radial.hidden) return;
    const rect = trigger.getBoundingClientRect();
    radial.style.left = `${Math.max(0, Math.min(innerWidth - 280, rect.right - 12))}px`;
    radial.style.top = `${Math.max(8, Math.min(innerHeight - 328, rect.top + rect.height / 2 - 160))}px`;
  };
  const show = () => {
    clearTimeout(timer); clearTimeout(closeTimer); cancelAnimationFrame(openFrame);
    isOpen = true; radial.hidden = false; radial.inert = false;
    trigger.setAttribute('aria-expanded', 'true'); position();
    // Let the mounted panel acquire its closed style before starting a reversible transition.
    openFrame = requestAnimationFrame(() => { if (isOpen) radial.classList.add('is-open'); });
  };
  const hide = () => {
    clearTimeout(timer); clearTimeout(closeTimer); cancelAnimationFrame(openFrame);
    isOpen = false; radial.inert = true; radial.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    closeTimer = setTimeout(() => { if (!isOpen) radial.hidden = true; }, 200);
  };
  const inRegion = target => target instanceof Node && (trigger.contains(target) || radial.contains(target));
  const leaveRegion = event => {
    if (inRegion(event.relatedTarget)) return;
    // A short bridge prevents flicker while crossing the gap between the trigger and its orbit.
    clearTimeout(timer); timer = setTimeout(hide, 90);
  };
  trigger.onpointerenter = e => { if (e.pointerType === 'mouse') show(); };
  trigger.onpointerleave = leaveRegion;
  trigger.onblur = e => { if (!inRegion(e.relatedTarget)) hide(); };
  radial.onpointerenter = () => { clearTimeout(timer); if (!isOpen) show(); };
  radial.onpointerleave = leaveRegion;
  trigger.onclick = e => {
    // Mouse hover never pins the panel. Touch and keyboard can still toggle it explicitly.
    if (e.detail === 0 || e.pointerType === 'touch') { if (isOpen) hide(); else show(); }
    else show();
  };
  trigger.onkeydown = e => { if (['ArrowRight', 'ArrowDown'].includes(e.key)) { e.preventDefault(); show(); radial.querySelector('button').focus(); } };
  radial.onkeydown = e => {
    const buttons = [...radial.querySelectorAll('button')], current = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  };
  radial.addEventListener('focusout', e => { if (!radial.contains(e.relatedTarget) && e.relatedTarget !== trigger) hide(); });
  document.addEventListener('pointerdown', e => { if (!radial.contains(e.target) && !trigger.contains(e.target)) hide(); }, { signal });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopImmediatePropagation(); hide(); trigger.focus(); } }, { capture: true, signal });
  window.addEventListener('resize', position, { signal });
  window.addEventListener('scroll', position, { capture: true, signal });
  function navigate(page) { hide(); onNavigate(page); setActive(page); }
  radial.querySelectorAll('[data-shortcut]').forEach(button => button.onclick = () => navigate(button.dataset.shortcut));
  more.onclick = () => { hide(); extras.hidden = !extras.hidden; more.setAttribute('aria-expanded', String(!extras.hidden)); };
  container.querySelectorAll('[data-nav]').forEach(button => { button.onclick = () => navigate(button.dataset.nav); });
  container.querySelector('.account-button').onclick = () => navigate('settings');
  container.querySelector('.notification-button').onclick = () => navigate('notifications');
  const search = container.querySelector('input');
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    container.querySelectorAll('[data-nav], .history-conversation').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); });
    extras.hidden = query ? !plugins.some(([, label]) => label.includes(query)) : more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(!extras.hidden));
  };
  function setActive(page) {
    container.querySelectorAll('[data-nav]').forEach(button => {
      button.classList.toggle('active', button.dataset.nav === page);
      if (button.dataset.nav === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    more.classList.toggle('active', plugins.some(([id]) => id === page));
    trigger.classList.toggle('active', shortcuts.some(([id]) => id === page));
  }
  container.querySelector('.brand').onclick = event => { event.preventDefault(); navigate('office'); };
  return { focusSearch: () => search.focus(), setActive, dispose: () => { clearTimeout(timer); clearTimeout(closeTimer); cancelAnimationFrame(openFrame); cleanup.abort(); radial.remove(); } };
}
