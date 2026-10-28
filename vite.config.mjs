import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    {
      name: 'moyu-shell-csp',
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          const development = Boolean(context.server);
          const policy = [
            "default-src 'self'",
            "script-src 'self'",
            "worker-src 'self' blob:",
            "style-src 'self' 'unsafe-inline' blob:",
            "img-src 'self' data: blob:", "font-src 'self' data: blob:",
            development ? `connect-src 'self' blob: ws://127.0.0.1:${context.server.config.server.port}` : "connect-src blob:",
            "object-src 'none'", "base-uri 'none'", "frame-src 'self' blob:", "form-action 'none'",
          ].join('; ');
          return html.replace('__MOYU_CSP__', policy);
        },
      },
    },
  ],
  server: {host: '127.0.0.1', port: 5173, strictPort: true},
  build: {outDir: 'renderer-dist', emptyOutDir: true, target: 'chrome140'},
});
