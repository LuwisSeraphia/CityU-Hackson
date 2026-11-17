const KEY = 'office-knowledge-v1';
function tokens(text) {
  const source = text.toLowerCase();
  const result = source.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]/g) || [];
  for (const run of source.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let i = 0; i < run.length - 1; i++) result.push(run.slice(i, i + 2));
  }
  return [...new Set(result)];
}

/** Local chunk retrieval with source attribution, without embeddings or model calls. */
export class KnowledgeStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage; this.documents = [];
    try {
      const saved = JSON.parse(storage?.getItem(KEY) || '[]');
      if (Array.isArray(saved)) this.documents = saved.filter(d => d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.text === 'string');
    } catch { /* optional storage */ }
  }
  save() { try { this.storage?.setItem(KEY, JSON.stringify(this.documents)); return true; } catch { return false; } }
  add(title, text) {
    title = String(title).trim(); text = String(text).trim();
    if (!title || !text) throw new Error('请填写资料名称与内容');
    if (text.length > 100000) throw new Error('单份资料请控制在 10 万字符以内');
    const document = { id: crypto.randomUUID(), title: title.slice(0, 120), text };
    this.documents.push(document); this.persisted = this.save(); return document;
  }
  addZhihuLink(title, url, text = '') {
    const source = new URL(String(url).trim());
    if (source.protocol !== 'https:' || !(source.hostname === 'zhihu.com' || source.hostname.endsWith('.zhihu.com')) || source.username || source.password) {
      throw new Error('请填写 https://www.zhihu.com 或知乎子域名的网页链接');
    }
    title = String(title).trim(); text = String(text).trim();
    if (!title) throw new Error('请填写网页标题');
    if (text.length > 100000) throw new Error('正文请控制在 10 万字符以内');
    const document = { id: crypto.randomUUID(), title: title.slice(0, 120), text, sourceUrl: source.href, kind: 'zhihu' };
    this.documents.push(document); this.persisted = this.save(); return document;
  }
  remove(id) { this.documents = this.documents.filter(d => d.id !== id); this.save(); }
  search(query, limit = 3) {
    const terms = tokens(query); if (!terms.length) return [];
    const hits = [];
    for (const document of this.documents) {
      for (let offset = 0; offset < document.text.length; offset += 360) {
        const excerpt = document.text.slice(offset, offset + 480);
        const content = (document.title + ' ' + excerpt).toLowerCase();
        const score = terms.reduce((sum, term) => sum + (content.includes(term) ? term.length : 0), 0);
        if (score) hits.push({ documentId: document.id, title: document.title, excerpt, offset, score, sourceUrl: document.sourceUrl });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
