import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  // This configuration runs on the dev server. Tokens never enter the browser bundle.
  const backend = loadEnv(mode, fileURLToPath(new URL('./apps/api/', import.meta.url)), '');
  return {
    base: './',
    server: {
      host: '127.0.0.1', port: 5173,
      proxy: {
        '^/api/(v1|v2|knowledge)(/|$)': {
          target: process.env.AGENT_API_URL || backend.AGENT_API_URL || 'http://127.0.0.1:8000',
          headers: { Authorization: `Bearer ${process.env.API_TOKEN || backend.API_TOKEN || ''}` },
          configure(proxy) {
            proxy.on('error', (_error, _request, response) => {
              if (!response.headersSent && response.writeHead) {
                response.writeHead(503, { 'Content-Type': 'application/json' });
                response.end(JSON.stringify({ error: { code: 'BACKEND_UNAVAILABLE', message: '后端未启动，请运行前后端启动命令后重新连接。' } }));
              }
            });
          },
        },
      },
    },
    build: { target: 'es2022' },
  };
});
