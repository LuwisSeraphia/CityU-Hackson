import { EXAMPLE_KNOWLEDGE } from './exampleKnowledge.js';
const KEY = 'office-knowledge-v1';
const CATEGORY_KEY = 'office-knowledge-categories-v1';
export const CATEGORY_COLORS = ['#5b8def', '#c29a73', '#829bc4', '#b394ba', '#baae70', '#7ba9ad'];
const DEFAULT_CATEGORIES = ['人文知识', '生活常识', '自然知识', '技术与创造', '待整理'];
export function suggestCategory(title, text) {
  const content = `${title} ${text}`;
  const rules = [
    ['人文知识', /历史|哲学|文学|艺术|文化|社会|心理|诗歌|history|culture/gi],
    ['生活常识', /生活|健康|饮食|烹饪|旅行|收纳|运动|睡眠|食谱|health|travel/gi],
    ['自然知识', /自然|物理|化学|生物|植物|动物|宇宙|地理|科学|science|nature/gi],
    ['技术与创造', /代码|编程|算法|设计|技术|数据库|软件|javascript|python|api|ai/gi],
  ];
  return rules.map(([name, pattern]) => [name, (content.match(pattern) || []).length])
    .sort((a, b) => b[1] - a[1]).find(([, score]) => score > 0)?.[0] || '待整理';
}
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
    this.categories = [...DEFAULT_CATEGORIES];
    try {
      const saved = JSON.parse(storage?.getItem(KEY) || '[]');
      if (Array.isArray(saved)) this.documents = saved.filter(d => d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.text === 'string');
    } catch { /* optional storage */ }
    try {
      const saved = JSON.parse(storage?.getItem(CATEGORY_KEY) || 'null');
      if (Array.isArray(saved)) this.categories = [...new Set([...saved.filter(c => typeof c === 'string' && c.trim()), '待整理'])];
    } catch { /* optional storage */ }
    this.documents.forEach((d, i) => {
      d.category ||= '待整理'; d.tags = Array.isArray(d.tags) ? d.tags.filter(t => typeof t === 'string') : [];
      d.createdAt ||= i + 1; d.updatedAt ||= d.createdAt; d.lastViewedAt ||= 0;
      if (!this.categories.includes(d.category)) this.categories.push(d.category);
    });
  }
  addExamples({ automatic = false } = {}) {
    if (automatic) {
      if (this.documents.length) return 0;
      try { if (this.storage?.getItem('office-knowledge-examples-v1') === 'loaded') return 0; } catch { /* optional storage */ }
    }
    const existing = new Set(this.documents.map(d => d.id));
    const now = Date.now(); let added = 0;
    EXAMPLE_KNOWLEDGE.forEach((sample, index) => {
      if (existing.has(sample.id)) return;
      if (!this.categories.includes(sample.category)) this.categories.push(sample.category);
      this.documents.push({ ...sample, tags: [...sample.tags], isExample: true, createdAt: now - index * 60000, updatedAt: now - index * 60000, lastViewedAt: 0 });
      added++;
    });
    this.persisted = this.save();
    if (this.persisted) {
      try { this.storage?.setItem('office-knowledge-examples-v1', 'loaded'); } catch { /* optional storage */ }
    }
    return added;
  }
  save() { try { this.storage?.setItem(KEY, JSON.stringify(this.documents)); this.storage?.setItem(CATEGORY_KEY, JSON.stringify(this.categories)); return true; } catch { return false; } }
  addCategory(name) {
    name = String(name).trim().slice(0, 30);
    if (!name) throw new Error('请填写分区名称');
    if (!this.categories.includes(name)) this.categories.push(name);
    this.persisted = this.save(); return name;
  }
  renameCategory(previous, next) {
    next = String(next).trim().slice(0, 30);
    if (!next) throw new Error('请填写分区名称');
    if (previous === '待整理') throw new Error('默认待整理分区需要保留');
    if (!this.categories.includes(previous)) throw new Error('分区不存在');
    if (next !== previous && this.categories.includes(next)) throw new Error('已有同名分区');
    this.categories = this.categories.map(c => c === previous ? next : c);
    this.documents.forEach(d => { if (d.category === previous) d.category = next; });
    this.persisted = this.save();
  }
  removeCategory(name) {
    if (name === '待整理') throw new Error('默认待整理分区需要保留');
    this.categories = this.categories.filter(c => c !== name);
    this.documents.forEach(d => { if (d.category === name) d.category = '待整理'; });
    this.persisted = this.save();
  }
  update(id, values) {
    const d = this.documents.find(d => d.id === id);
    if (!d) throw new Error('资料不存在');
    const title = String(values.title ?? d.title).trim().slice(0, 120);
    const text = String(values.text ?? d.text).trim();
    if (!title || (!text && d.kind !== 'zhihu')) throw new Error('请填写资料名称与内容');
    if (text.length > 100000) throw new Error('单份资料请控制在 10 万字符以内');
    const category = String(values.category ?? d.category).trim() || '待整理';
    const tags = values.tags === undefined ? d.tags : String(values.tags).split(/[,，]/).map(t => t.trim().slice(0, 24)).filter(Boolean).slice(0, 8);
    this.addCategory(category);
    Object.assign(d, { title, text, category, tags, updatedAt: Date.now() });
    this.persisted = this.save(); return d;
  }
  touch(id) {
    const d = this.documents.find(d => d.id === id);
    if (d) { d.lastViewedAt = Date.now(); this.persisted = this.save(); }
  }
  recent(limit = 18) {
    return [...this.documents].sort((a, b) => Math.max(b.lastViewedAt, b.updatedAt, b.createdAt) - Math.max(a.lastViewedAt, a.updatedAt, a.createdAt)).slice(0, limit);
  }
  add(title, text, category = '待整理', tags = '') {
    title = String(title).trim(); text = String(text).trim();
    if (!title || !text) throw new Error('请填写资料名称与内容');
    if (text.length > 100000) throw new Error('单份资料请控制在 10 万字符以内');
    const document = { id: crypto.randomUUID(), title: title.slice(0, 120), text, category: this.addCategory(category), tags: String(tags).split(/[,，]/).map(t => t.trim().slice(0, 24)).filter(Boolean).slice(0, 8), createdAt: Date.now(), updatedAt: Date.now(), lastViewedAt: 0 };
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
    const document = { id: crypto.randomUUID(), title: title.slice(0, 120), text, sourceUrl: source.href, kind: 'zhihu', category: '待整理', tags: [], createdAt: Date.now(), updatedAt: Date.now(), lastViewedAt: 0 };
    this.documents.push(document); this.persisted = this.save(); return document;
  }
  remove(id) { this.documents = this.documents.filter(d => d.id !== id); this.persisted = this.save(); }
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
