import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** CSP добавляется только в продакшен-сборку (dev-сервер Vite использует inline-скрипты). */
const csp = (): Plugin => ({
  name: 'guloxy-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self' https://api.modrinth.com https://meta.fabricmc.net",
      "script-src 'self'",
    ].join('; ');
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173, strictPort: true },
});
