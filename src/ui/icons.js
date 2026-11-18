/** Small inline SVG icon set; no font or image requests. */
const paths = {
  web: 'M3 4h18v16H3ZM3 9h18M6 6.5h.01M9 6.5h.01M7 13h10M7 16h6',
  workflow: 'M9 2h6v5H9ZM2 17h6v5H2Zm14 0h6v5h-6ZM12 7v5M5 17v-5h14v5',
  archive: 'M3 4h18v5H3Zm2 5v12h14V9M9 13h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01M3 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0m7 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0m7 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
  zhihu: 'M10 13a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2',
  knowledge: 'M3 3h18v18H3Zm0 6h18M3 15h18M7 3v6m4-6v6m6 0v6m-9 0v6',
  chat: 'M4 3h16v13H9l-5 4V3m8 3v7m-4-3h8',
  clock: 'M12 7v6l4 2M5 2 2 5m17-3 3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  tool: 'm3 21 9-9m2-9a6 6 0 0 0-5 8l4 4a6 6 0 0 0 8-7l-4 4-5-5 4-4Z',
  apps: 'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
  doc: 'M5 2h10l4 4v16H5Zm3 12h7m-7 4h5',
  image: 'M3 3h18v18H3Zm2 14 6-6 7 7M16 7h1',
  computer: 'M2 3h20v15H2Zm5 19h10',
  office: 'M9 3c-8 0-6 16 5 18M9 3c10-3 16 15 5 18M8 4l8 15',
  search: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16m6 14 6 6',
  bell: 'M5 17h14l-2-4V8a5 5 0 0 0-10 0v5Zm5 4h4',
  user: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6M5 18c1-7 13-7 14 0',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.doc}"/></svg>`;
}
