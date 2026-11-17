import { escapeText } from '../ui/WorkspacePanel.js';

export class KnowledgePanel {
  constructor(knowledge, agents, onRetrieve, notify) {
    this.knowledge = knowledge; this.agents = agents; this.onRetrieve = onRetrieve; this.notify = notify;
    this.root = document.createElement('dialog'); this.root.className = 'workspace-dialog knowledge-dialog';
    document.body.append(this.root);
    this.render();
  }
  open(mode = 'all') {
    if (this.root.open) this.root.close();
    this.mode = mode;
    this.root.classList.toggle('zhihu-web-window', mode === 'zhihu');
    this.render();
    if (mode === 'zhihu') this.root.show(); else this.root.showModal();
  }
  render() {
    if (this.mode === 'zhihu') { this.renderZhihu(); return; }
    this.root.innerHTML = `<header><h2>图书墙 · 知识区</h2><button data-close aria-label="关闭">×</button></header>
      <p>添加文本资料，按段落检索并引用来源。当前是浏览器本地关键词检索，尚未接入向量库或生成模型。</p>
      <form class="workspace-form" id="knowledge-add"><label>书名 / 资料名称<input name="title" required maxlength="120"></label><label>资料内容<textarea name="text" required maxlength="100000" rows="4"></textarea></label><button class="workspace-primary">放入书墙</button></form>
      <button class="workspace-primary" data-import>导入 TXT / Markdown</button>
      <div class="schedule-list">${this.knowledge.documents.map(d => `<article><strong>${escapeText(d.title)}</strong><small>${d.text.length} 字符${d.kind === 'zhihu' ? ' · 知乎网页' : ''}</small><button data-remove="${d.id}">移除资料</button></article>`).join('') || '<p>书墙还没有资料，先添加一本书。</p>'}</div>
      <form class="workspace-form" id="knowledge-search"><label>调用伙伴<select name="agent">${this.agents.map(a => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label><label>检索问题<input name="query" required maxlength="240" placeholder="输入要查找的知识"></label><button class="workspace-primary">调用知识区并取书</button></form>
      <div class="knowledge-results" aria-live="polite"></div>`;
    this.root.querySelector('[data-close]').onclick = () => this.root.close();
    this.root.querySelector('#knowledge-add').onsubmit = event => {
      event.preventDefault(); const data = new FormData(event.target);
      try { this.knowledge.add(data.get('title'), data.get('text')); if (!this.knowledge.persisted) this.notify('浏览器存储已满，资料仅保留在本次会话'); this.render(); }
      catch (error) { this.notify(error.message); }
    };
    this.root.querySelector('[data-import]').onclick = () => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.txt,.md,text/plain,text/markdown';
      input.onchange = async () => {
        for (const file of input.files) {
          try {
            if (file.size > 400000) throw new Error(`${file.name} 过大，请控制在 400KB 内`);
            this.knowledge.add(file.name, await file.text());
          } catch (error) { this.notify(error.message); }
        }
        if (!this.knowledge.persisted && input.files.length) this.notify('资料可能未持久保存，请检查浏览器存储空间');
        this.render();
      }; input.click();
    };
    this.root.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => { this.knowledge.remove(button.dataset.remove); this.render(); });
    this.root.querySelector('#knowledge-search').onsubmit = event => {
      event.preventDefault(); const data = new FormData(event.target);
      const result = this.onRetrieve(data.get('agent'), data.get('query'));
      if (result?.hits?.length) {
        this.root.close();
        this.showResults(result.hits);
      }
    };
    if (this.lastHits) this.showResults(this.lastHits);
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
    // Results remain available in the knowledge panel after the animation.
    const results = this.root.querySelector('.knowledge-results');
    results.innerHTML = '<h3>最近检索来源</h3>' + hits.map((h,i) => `<article><strong>[${i+1}] ${escapeText(h.title)} · 第 ${h.offset + 1} 字起</strong><p>${escapeText(h.excerpt)}</p>${this.sourceLink(h.sourceUrl)}</article>`).join('');
  }
  dispose() { this.root.remove(); }
}
