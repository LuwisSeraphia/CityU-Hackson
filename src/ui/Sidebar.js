import { icon } from './icons.js';
const navigation = [
  ['chat', '新建对话'], ['clock', '自动任务'], ['tool', '技能广场'],
  ['knowledge', '知识书墙'], ['zhihu', '知乎网页'], ['apps', '应用'], ['doc', '文档'], ['image', '图库'], ['computer', '此电脑'], ['office', '办公室'],
];

export function Sidebar(container, notify, onNavigate) {
  container.innerHTML = `
    <a class="brand" href="#office" aria-label="知乎知识星球办公室"><span class="zhihu-mark">知</span><span class="brand-name">知乎</span><span class="brand-caption">知识星球</span></a>
    <label class="sidebar-search">${icon('search')}<input placeholder="搜索" aria-label="搜索导航"><kbd>⌘ K</kbd></label>
    <nav aria-label="主导航">${navigation.map(([symbol, title], i) => `
      ${symbol === 'knowledge' ? '<p class="nav-caption">本地知识库</p>' : ''}
      ${symbol === 'office' ? '<p class="nav-caption">对话</p>' : ''}
      <button class="nav-link ${symbol === 'office' ? 'active' : ''}" data-nav="${symbol}" ${symbol === 'office' ? 'aria-current="page"' : ''}>
        ${icon(symbol)}<span>${title}</span>${['doc', 'image', 'computer'].includes(symbol) ? '<span class="nav-chevron">⌄</span>' : ''}
      </button>`).join('')}
    </nav>
    <footer><button class="account-button">${icon('user')}<span>登录与设置</span></button><button class="notification-button" aria-label="查看通知">${icon('bell')}</button></footer>`;
  container.querySelectorAll('[data-nav]').forEach(button => {
    button.onclick = () => {
      onNavigate(button.dataset.nav);
      setActive(button.dataset.nav);
    };
  });
  container.querySelector('.account-button').onclick = () => onNavigate('settings');
  container.querySelector('.notification-button').onclick = () => onNavigate('notifications');
  const search = container.querySelector('input');
  search.oninput = () => {
    const query = search.value.trim().toLowerCase();
    container.querySelectorAll('[data-nav], .history-conversation').forEach(button => { button.hidden = !button.textContent.toLowerCase().includes(query); });
  };
  function setActive(page) {
    container.querySelectorAll('[data-nav]').forEach(button => {
      button.classList.toggle('active', button.dataset.nav === page);
      if (button.dataset.nav === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  container.querySelector('.brand').onclick = event => { event.preventDefault(); onNavigate('office'); setActive('office'); };
  return { focusSearch: () => search.focus(), setActive };
}
