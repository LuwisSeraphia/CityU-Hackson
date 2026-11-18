import { InspirationField } from './InspirationField.js';
import { escapeText } from '../ui/WorkspacePanel.js';
import { CATEGORY_COLORS, suggestCategory } from './KnowledgeStore.js';

const symbols = {
  inspiration: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="10" r="6"/><circle cx="18" cy="17" r="3"/><circle cx="19" cy="5" r="1.5"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h4v15H4zM10 4h4v15h-4zM16 5l3-1 4 14-3 1zM2 21h21"/></svg>',
};
export class KnowledgePanel {
  constructor(knowledge, agents, onRetrieve, notify) {
    Object.assign(this, { knowledge, agents, onRetrieve, notify, view: 'inspiration', query: '', category: '', cycle: 0 });
    this.root = document.createElement('section');
    this.root.className = 'knowledge-page'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '知识书墙');
    Object.defineProperty(this.root, 'open', { get: () => !this.root.hidden });
    this.root.close = () => this.close();
    document.querySelector('.app-shell').append(this.root);
    this.timer = setInterval(() => {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && this.root.open && this.mode !== 'zhihu' && this.view === 'inspiration' && !this.selectedId && !this.editor && !this.root.querySelector('input:focus, textarea:focus, select:focus') && !this.root.querySelector('.inspiration-field')?.matches(':hover, :focus-within')) {
        this.cycle++; this.renderView();
      }
    }, 14000);
  }
  open(mode = 'all') {
    this.previousFocus = document.activeElement;
    this.mode = mode; this.editor = null; this.selectedId = null;
    this.root.hidden = false;
    document.body.classList.add('knowledge-mode');
    this.render();
    this.root.querySelector('[data-close]')?.focus();
  }
  close() {
    if (!this.root.open) return;
    this.fieldMotion?.dispose();
    this.root.hidden = true; document.body.classList.remove('knowledge-mode');
    this.onClose?.();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
  color(category) { return CATEGORY_COLORS[Math.max(0, this.knowledge.categories.indexOf(category)) % CATEGORY_COLORS.length]; }
  options(value) { return this.knowledge.categories.map(c => `<option ${c === value ? 'selected' : ''}>${escapeText(c)}</option>`).join(''); }
  persistNotice() { if (!this.knowledge.persisted) this.notify('浏览器存储不可用，修改仅保留在本次会话'); }
  render() {
    this.fieldMotion?.dispose();
    this.root.classList.toggle('is-inspiration', this.mode !== 'zhihu' && this.view === 'inspiration');
    this.root.classList.toggle('zhihu-web-window', this.mode === 'zhihu');
    if (this.mode === 'zhihu') { this.renderZhihu(); return; }
    this.root.innerHTML = `<header class="knowledge-header"><div><span class="knowledge-eyebrow">A LITTLE KNOWLEDGE, EVERY DAY</span><h1>知识书墙<span>${this.knowledge.documents.length} 份收藏</span></h1><p>让每一次好奇，都有自己的栖息地。</p></div><button data-close class="knowledge-exit" aria-label="返回办公室">返回办公室 ↗</button></header>
      <div class="knowledge-toolbar"><div class="knowledge-modes" role="group" aria-label="知识展示模式">${['inspiration', 'library'].map(v => `<button data-view="${v}" aria-pressed="${this.view === v}" title="${v === 'inspiration' ? '灵感模式' : '图书馆模式'}">${symbols[v]}<span>${v === 'inspiration' ? '灵感' : '图书馆'}</span></button>`).join('')}</div><label class="knowledge-searchbox"><span>⌕</span><input type="search" aria-label="搜索知识" placeholder="寻找一束灵感…" value="${escapeText(this.query)}"></label><button data-import aria-label="导入 TXT 或 Markdown" class="knowledge-secondary">↥ <span>导入</span></button><button data-add class="knowledge-primary">＋ 添加知识</button></div>
      <div class="knowledge-body"><div class="knowledge-main"><div class="knowledge-categories" aria-label="知识分区"></div><div class="knowledge-view"></div>
      <details class="knowledge-retrieval"><summary>⌕ 让伙伴帮你查找资料</summary><form class="workspace-form" id="knowledge-search"><label>调用伙伴<select name="agent">${this.agents.map(a => `<option value="${a.id}">${escapeText(a.name)}</option>`).join('')}</select></label><label>检索问题<input name="query" required maxlength="240" placeholder="输入要查找的知识"></label><button class="knowledge-primary">调用知识区并取书</button></form><div class="knowledge-results" aria-live="polite"></div></details></div><aside class="knowledge-detail" hidden aria-label="知识详情"></aside></div>
      <footer class="knowledge-footnote"><span>◌ 保存在此浏览器 · 随时回来继续探索</span><span data-mode-note></span></footer>`;
    this.root.querySelector('[data-close]').onclick = () => this.close();
    this.root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { this.view = b.dataset.view; if (this.view === 'inspiration') this.category = ''; this.cycle = 0; this.render(); });
    this.root.querySelector('input[type="search"]').oninput = e => { this.query = e.target.value; this.cycle = 0; this.renderView(); };
    this.root.querySelector('[data-add]').onclick = () => { this.editor = 'new'; this.selectedId = null; this.renderDetail(); };
    this.root.querySelector('[data-import]').onclick = () => this.importFiles();
    this.root.querySelector('#knowledge-search').onsubmit = e => {
      e.preventDefault(); const data = new FormData(e.target);
      const result = this.onRetrieve(data.get('agent'), data.get('query'));
      if (result?.hits?.length) { this.close(); this.showResults(result.hits); }
    };
    if (this.view === 'inspiration') this.root.append(this.root.querySelector('.knowledge-searchbox'));
    this.renderCategories(); this.renderView(); this.renderDetail();
    if (this.lastHits) this.showResults(this.lastHits);
  }
  renderCategories() {
    const target = this.root.querySelector('.knowledge-categories');
    target.innerHTML = `<button data-category="" aria-pressed="${!this.category}">全部 <small>${this.knowledge.documents.length}</small></button>${this.knowledge.categories.map(c => `<button data-category="${escapeText(c)}" aria-pressed="${this.category === c}" style="--category-color:${this.color(c)}"><i></i>${escapeText(c)} <small>${this.knowledge.documents.filter(d => d.category === c).length}</small></button>`).join('')}<button data-manage title="编辑分区">＋ 管理分区</button>`;
    target.querySelectorAll('[data-category]').forEach(b => b.onclick = () => { this.category = b.dataset.category; this.cycle = 0; this.renderCategories(); this.renderView(); });
    target.querySelector('[data-manage]').onclick = () => { this.editor = 'categories'; this.selectedId = null; this.renderDetail(); };
  }
  filtered() {
    const q = this.query.trim().toLowerCase();
    return this.knowledge.recent(Infinity).filter(d => (this.view === 'inspiration' || !this.category || d.category === this.category) && `${d.title} ${d.text} ${d.tags.join(' ')} ${d.category}`.toLowerCase().includes(q));
  }
  renderView() {
    const target = this.root.querySelector('.knowledge-view'); if (!target) return;
    this.fieldMotion?.dispose();
    const docs = this.filtered();
    this.root.querySelector('[data-mode-note]').textContent = this.view === 'inspiration' ? '最近新增 / 阅读优先 · 停留时暂停轮换' : '按分区收纳 · 点击卡片展开阅读';
    if (!docs.length) {
      target.innerHTML = `<div class="knowledge-empty"><span>${symbols[this.view]}</span><h2>${this.query ? '还没有找到这束灵感' : '给好奇心留一个位置'}</h2><p>${this.query ? '换个关键词，或查看其他分区。' : '添加第一份知识，让它在这里慢慢生长。'}</p><button class="knowledge-primary" data-empty-add>＋ 添加知识</button>${!this.knowledge.documents.length ? '<button class="knowledge-secondary" data-examples>体验示例泡泡</button>' : ''}</div>`;
      target.querySelector('[data-empty-add]').onclick = () => { this.editor = 'new'; this.selectedId = null; this.renderDetail(); };
      const examples = target.querySelector('[data-examples]');
      if (examples) examples.onclick = () => { const count = this.knowledge.addExamples(); this.query = ''; this.category = ''; this.render(); this.persistNotice(); this.notify(`已添加 ${count} 份示例知识，可以自由编辑或删除`); };
      return;
    }
    if (this.view === 'inspiration') {
      // Keep six recent items visible; rotate older knowledge into the remaining six slots.
      const older = docs.slice(6); const start = older.length ? (this.cycle * 6) % older.length : 0;
      const ranked = [...docs.slice(0, 6), ...older.slice(start), ...older.slice(0, start)].slice(0, 12);
      const shift = ranked.length ? this.cycle % ranked.length : 0;
      const shown = [...ranked.slice(shift), ...ranked.slice(0, shift)];
      target.innerHTML = `<div class="inspiration-caption"><span>灵感在此相遇</span><small>${docs.length} 份知识 · 当前浮现 ${shown.length} 份</small><button data-refresh aria-label="换一组灵感">换一组 ↻</button></div><div class="inspiration-field">${shown.map((d, i) => `<div class="bubble-slot" style="--delay:${i * -.7}s"><button class="knowledge-bubble" data-doc="${escapeText(d.id)}" style="--bubble-color:${this.color(d.category)};--bubble-size:${136 + Math.min(70, Math.sqrt(d.text.length) * 1.8)}px;--enter-delay:${i * 45}ms"><small>${escapeText(d.category)}</small><strong>${escapeText(d.title)}</strong><span>${escapeText(d.tags[0] || (docs.indexOf(d) < 3 ? '最近的灵感' : '点击探索'))} ↗</span></button></div>`).join('')}</div>`;
      this.fieldMotion = new InspirationField(target.querySelector('.inspiration-field'));
      target.querySelector('[data-refresh]').onclick = () => { this.cycle++; this.renderView(); };
    } else {
      const categories = this.category ? [this.category] : this.knowledge.categories;
      target.innerHTML = `<div class="library-intro"><div><h2>你的私人图书馆</h2><p>把零散的发现，整理成有迹可循的收藏。</p></div><span>${docs.length} 份知识</span></div><div class="library-shelves">${categories.map(c => {
        const items = docs.filter(d => d.category === c);
        if (this.query && !items.length) return '';
        return `<section class="library-section" style="--category-color:${this.color(c)}"><h3><i></i>${escapeText(c)}<small>${items.length.toString().padStart(2, '0')}</small></h3><div class="knowledge-card-grid">${items.map(d => `<button class="knowledge-card" data-doc="${escapeText(d.id)}"><span class="card-topline">${d.kind === 'zhihu' ? '知乎收藏' : '知识笔记'}<span>↗</span></span><h4>${escapeText(d.title)}</h4><p>${escapeText(d.text.slice(0, 95) || '仅保存链接，点击查看来源。')}</p><footer><span>${escapeText(d.tags.slice(0, 2).map(t => '#' + t).join(' ') || c)}</span><small>${d.text.length} 字</small></footer></button>`).join('') || '<p class="category-empty">一层空书架，等待下一次发现。</p>'}</div></section>`;
      }).join('')}</div>`;
    }
    target.querySelectorAll('[data-doc]').forEach(b => b.onclick = () => { this.selectedId = b.dataset.doc; this.editor = null; this.knowledge.touch(this.selectedId); this.persistNotice(); this.renderDetail(); });
  }
  renderDetail() {
    const target = this.root.querySelector('.knowledge-detail'); if (!target) return;
    const doc = this.knowledge.documents.find(d => d.id === this.selectedId);
    target.hidden = !doc && !this.editor;
    this.root.classList.toggle('has-detail', !target.hidden);
    if (target.hidden) return;
    const close = '<button data-detail-close class="detail-close" aria-label="关闭详情">×</button>';
    if (this.editor === 'categories') {
      target.innerHTML = `${close}<small class="knowledge-eyebrow">MAKE ROOM FOR IDEAS</small><h2>整理你的分区</h2><p class="detail-muted">重命名会同步更新资料。删除分区后，资料移至待整理。</p><div class="category-edit-list">${this.knowledge.categories.map((c, i) => `<form data-rename="${i}"><input aria-label="分区名称" value="${escapeText(c)}" maxlength="30" required ${c === '待整理' ? 'disabled' : ''}><button ${c === '待整理' ? 'disabled' : ''}>保存</button><button type="button" data-delete-category="${i}" aria-label="删除${escapeText(c)}分区" ${c === '待整理' ? 'disabled' : ''}>×</button></form>`).join('')}</div><form data-new-category class="workspace-form"><label>新分区<input name="name" maxlength="30" placeholder="例如：旅行见闻" required></label><button class="knowledge-primary">＋ 新增分区</button></form>`;
      target.querySelectorAll('[data-rename]').forEach(f => f.onsubmit = e => { e.preventDefault(); this.tryAction(() => { const old = this.knowledge.categories[Number(f.dataset.rename)]; const next = f.querySelector('input').value; this.knowledge.renameCategory(old, next); if (this.category === old) this.category = next.trim(); this.refresh(); }); });
      target.querySelectorAll('[data-delete-category]').forEach(b => b.onclick = () => this.tryAction(() => { const c = this.knowledge.categories[Number(b.dataset.deleteCategory)]; this.knowledge.removeCategory(c); if (this.category === c) this.category = ''; this.refresh(); }));
      target.querySelector('[data-new-category]').onsubmit = e => { e.preventDefault(); this.tryAction(() => { this.knowledge.addCategory(new FormData(e.target).get('name')); this.refresh(); }); };
    } else if (this.editor) {
      target.innerHTML = `${close}<small class="knowledge-eyebrow">COLLECT SOMETHING GOOD</small><h2>${doc ? '编辑知识' : '一份新的发现'}</h2><form class="workspace-form" id="knowledge-add"><label>资料名称<input name="title" value="${escapeText(doc?.title || '')}" maxlength="120" required></label><label>知识正文<textarea name="text" rows="9" maxlength="100000" ${doc?.kind === 'zhihu' ? '' : 'required'}>${escapeText(doc?.text || '')}</textarea></label><label>所属分区<select name="category">${this.options(doc?.category || this.category || '待整理')}</select></label><div class="classification-actions"><button type="button" data-suggest>✧ 本地分类建议</button><button type="button" data-ai>✦ AI 识别分区</button></div><p class="classification-status" role="status">AI 会将标题和前 6000 字正文发送给已配置的模型，并可建议新分区。保存前可调整。</p><label>标签 · 用逗号分隔<input name="tags" maxlength="200" value="${escapeText(doc?.tags.join(', ') || '')}" placeholder="例如：灵感, 阅读"></label><button class="knowledge-primary" type="submit">${doc ? '保存修改' : '放入书墙'} ↗</button></form>`;
      const form = target.querySelector('form');
      form.onsubmit = e => { e.preventDefault(); this.tryAction(() => { const data = Object.fromEntries(new FormData(form)); const saved = doc ? this.knowledge.update(doc.id, data) : this.knowledge.add(data.title, data.text, data.category, data.tags); this.selectedId = saved.id; this.editor = null; this.category = ''; this.query = ''; this.render(); this.notify('已保存到知识书墙'); }); };
      target.querySelector('[data-suggest]').onclick = () => { const data = new FormData(form); this.setSuggestion(form, suggestCategory(data.get('title'), data.get('text')), '本地关键词建议，可手动调整。'); };
      target.querySelector('[data-ai]').onclick = async e => {
        const button = e.currentTarget; const data = new FormData(form);
        if (!String(data.get('title')).trim() && !String(data.get('text')).trim()) { target.querySelector('.classification-status').textContent = '先填写标题或正文，再识别分区。'; return; }
        button.disabled = true; target.querySelector('.classification-status').textContent = '正在识别分区…';
        try {
          const response = await fetch('/api/knowledge/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: data.get('title'), text: String(data.get('text')).slice(0, 6000), categories: this.knowledge.categories }), signal: AbortSignal.timeout(55000) });
          const result = await response.json().catch(() => null);
          if (!response.ok) throw new Error(result?.error?.message || 'AI 服务尚未就绪，请配置并启动后端；也可以使用本地分类建议。');
          if (typeof result?.category !== 'string' || !result.category.trim()) throw new Error('AI 未返回有效分区，请重试。');
          if (form.isConnected) this.setSuggestion(form, result.category.trim().slice(0, 30), 'AI 已建议分区，保存知识时生效。');
        } catch (error) { if (form.isConnected) target.querySelector('.classification-status').textContent = error.name === 'TimeoutError' ? 'AI 响应超时，可以重试或使用本地建议。' : error.message; }
        finally { button.disabled = false; }
      };
    } else if (doc) {
      target.innerHTML = `${close}<small class="detail-category" style="color:${this.color(doc.category)}">${escapeText(doc.category)} / ${doc.kind === 'zhihu' ? '知乎收藏' : '知识笔记'}</small><h2>${escapeText(doc.title)}</h2><div class="detail-tags">${doc.tags.map(t => `<span># ${escapeText(t)}</span>`).join('')}</div><small class="detail-muted">${doc.isExample ? '示例知识 · ' : ''}${doc.text.length} 字 · 已保存于本浏览器</small><div class="knowledge-reading">${escapeText(doc.text || '这份收藏仅保存了链接，可以打开原文阅读。')}</div>${this.sourceLink(doc.sourceUrl)}<div class="detail-actions"><button data-edit class="knowledge-secondary">编辑知识</button><button data-remove class="knowledge-danger">移除资料</button></div><div class="delete-confirm" hidden><p>确定移除这份资料？此操作无法撤销。</p><button data-confirm-remove class="knowledge-danger">确定移除</button><button data-cancel-remove>保留</button></div>`;
      target.querySelector('[data-edit]').onclick = () => { this.editor = 'edit'; this.renderDetail(); };
      target.querySelector('[data-remove]').onclick = () => { target.querySelector('.delete-confirm').hidden = false; };
      target.querySelector('[data-cancel-remove]').onclick = () => { target.querySelector('.delete-confirm').hidden = true; };
      target.querySelector('[data-confirm-remove]').onclick = () => { this.knowledge.remove(doc.id); this.selectedId = null; this.persistNotice(); this.refresh(); };
    }
    target.querySelector('[data-detail-close]').onclick = () => { this.editor = null; this.selectedId = null; this.renderDetail(); };
    target.querySelector('input, textarea, [data-detail-close]')?.focus();
  }
  setSuggestion(form, category, message) {
    const select = form.elements.category;
    if (![...select.options].some(o => o.value === category)) select.add(new Option(category, category));
    select.value = category;
    form.querySelector('.classification-status').textContent = message;
  }
  refresh() { this.persistNotice(); this.renderCategories(); this.renderView(); this.renderDetail(); }
  tryAction(action) { try { action(); this.persistNotice(); } catch (error) { this.notify(error.message); } }
  importFiles() {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.txt,.md,text/plain,text/markdown';
    input.onchange = async () => {
      for (const file of input.files) {
        try {
          if (file.size > 400000) throw new Error(`${file.name} 过大，请控制在 400KB 内`);
          const text = await file.text(); this.knowledge.add(file.name, text, this.category || suggestCategory(file.name, text));
        } catch (error) { this.notify(error.message); }
      }
      this.persistNotice(); this.render();
    }; input.click();
  }
  renderZhihu() {
    this.root.innerHTML = `<header class="zhihu-web-header"><span class="zhihu-web-logo">知乎</span><span class="zhihu-web-tab">网页知识</span><button data-close aria-label="关闭知乎网页窗口">×</button></header>
      <div class="zhihu-search-bar"><input aria-label="搜索已保存的知乎网页" placeholder="搜索你保存的内容…" value="${escapeText(this.zhihuQuery || '')}"><span>⌕</span></div>
      <div class="zhihu-web-content">
        <details class="zhihu-settings"><summary>网页设置 · 添加链接与正文</summary>
          <p>保存在本浏览器。搜索与阅读仅使用已添加的正文，不自动抓取远程页面。</p>
          <form class="workspace-form" id="zhihu-add">
            <label>网页标题<input name="title" required maxlength="120" placeholder="输入文章或回答标题"></label>
            <label>知乎网页链接<input name="url" type="url" required placeholder="https://www.zhihu.com/question/…"></label>
            <label>网页正文（可选）<textarea name="text" rows="5" maxlength="100000" placeholder="粘贴正文，便可在窗口内阅读并用于知识检索"></textarea></label>
            <button class="workspace-primary">保存到知识区</button>
          </form>
        </details>
        <div class="zhihu-reading-content"></div>
        <div class="knowledge-results" aria-live="polite"></div>
      </div>`;
    this.root.querySelector('[data-close]').onclick = () => this.root.close();
    this.root.querySelector('.zhihu-search-bar input').oninput = event => {
      this.zhihuQuery = event.target.value; this.readingId = null; this.renderZhihuContent();
    };
    this.root.onkeydown = event => { if (event.key === 'Escape') this.root.close(); };
    this.root.querySelector('#zhihu-add').onsubmit = event => {
      event.preventDefault(); const data = new FormData(event.target);
      try {
        const doc = this.knowledge.addZhihuLink(data.get('title'), data.get('url'), data.get('text'));
        if (!this.knowledge.persisted) this.notify('存储已满，链接仅保留在本次会话');
        this.zhihuQuery = ''; this.readingId = doc.id; this.render();
      } catch (error) { this.notify(error.message); }
    };
    this.renderZhihuContent();
    if (this.lastHits) this.showResults(this.lastHits);
  }
  renderZhihuContent() {
    const target = this.root.querySelector('.zhihu-reading-content');
    const documents = this.knowledge.documents.filter(doc => doc.kind === 'zhihu');
    const selected = documents.find(doc => doc.id === this.readingId);
    if (selected) {
      target.innerHTML = `<article class="zhihu-reader"><button class="zhihu-back">← 返回已保存网页</button><h1>${escapeText(selected.title)}</h1><div class="zhihu-reader-meta">已保存的知乎正文 · ${selected.text.length} 字符</div><div class="zhihu-article-body">${selected.text ? selected.text.split(/\n\s*\n/).map(paragraph => `<p>${escapeText(paragraph)}</p>`).join('') : '<p>此网页仅保存了链接。请打开知乎原文阅读，或在“网页设置”中添加正文。</p>'}</div><footer>${this.sourceLink(selected.sourceUrl)}<button data-remove="${escapeText(selected.id)}">移除网页</button></footer></article>`;
      target.querySelector('.zhihu-back').onclick = () => { this.readingId = null; this.renderZhihuContent(); };
    } else {
      const query = (this.zhihuQuery || '').trim().toLowerCase();
      const matches = documents.filter(doc => (doc.title + ' ' + doc.text).toLowerCase().includes(query));
      target.innerHTML = `<div class="zhihu-list-heading">${query ? '搜索结果' : '已保存网页'} <span>${matches.length} 篇</span></div><div class="zhihu-link-list">${matches.map(doc => `<article><button class="zhihu-read-title" data-read="${escapeText(doc.id)}">${escapeText(doc.title)}</button><p>${doc.text ? escapeText(doc.text.slice(0,180)) + (doc.text.length > 180 ? '…' : '') : '仅链接 · 尚未添加正文'}</p><footer><button class="zhihu-read" data-read="${escapeText(doc.id)}">阅读全文</button>${this.sourceLink(doc.sourceUrl)}<button data-remove="${escapeText(doc.id)}">移除</button></footer></article>`).join('') || `<p>${query ? '没有匹配的网页，试试其他关键词。' : '还没有网页，展开上方“网页设置”添加第一篇。'}</p>`}</div>`;
      target.querySelectorAll('[data-read]').forEach(button => button.onclick = () => {
        this.readingId = button.dataset.read; this.renderZhihuContent();
        this.root.querySelector('.zhihu-web-content').scrollTop = 0;
      });
    }
    target.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
      this.knowledge.remove(button.dataset.remove); this.readingId = null; this.renderZhihuContent();
    });
  }
  sourceLink(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'zhihu.com' || parsed.hostname.endsWith('.zhihu.com'))) return '';
      return `<a href="${escapeText(parsed.href)}" target="_blank" rel="noopener noreferrer">打开知乎原文 ↗</a>`;
    } catch { return ''; }
  }
  showResults(hits) {
    this.lastHits = hits;
    const results = this.root.querySelector('.knowledge-results');
    if (!results) return;
    results.innerHTML = '<h3>最近检索来源</h3>' + hits.map((h, i) => `<article><strong>[${i + 1}] ${escapeText(h.title)} · 第 ${h.offset + 1} 字起</strong><p>${escapeText(h.excerpt)}</p>${this.sourceLink(h.sourceUrl)}</article>`).join('');
  }
  dispose() { this.fieldMotion?.dispose(); clearInterval(this.timer); this.close(); this.root.remove(); }
}
