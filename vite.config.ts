import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Cross-origin isolation enables SharedArrayBuffer, which lets ONNX Runtime Web use
// multiple WASM threads. Everything is served from the same origin, so this is safe.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// In production builds, forbid every network destination except this origin. This turns the
// "nothing is uploaded" promise into something the browser enforces.
const csp = [
  "default-src 'self'",
  // MediaPipe's legacy Face Mesh loader uses eval(); scripts are still restricted to this origin.
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin = {
  name: 'emotivision-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
};

// Dev server only: Vite appends "?import" to ONNX Runtime's dynamic import of its own runtime files in /public and then
// refuses to transform them. Serve those files untouched instead.
const ortRaw = {
  name: 'emotivision-ort-raw',
  apply: 'serve' as const,
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/ort', (req, res, next) => {
      const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
      const file = resolve(process.cwd(), 'public/ort', name);
      if (!name || !file.startsWith(resolve(process.cwd(), 'public/ort')) || !existsSync(file)) return next();
      res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); // worker scripts need their own COEP header
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.end(readFileSync(file));
    });
  },
};

export default defineConfig({
  plugins: [react(), cspPlugin, ortRaw],
  server: { headers: isolation, host: '127.0.0.1', port: 5173 },
  preview: { headers: isolation, host: '127.0.0.1', port: 4173 },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
