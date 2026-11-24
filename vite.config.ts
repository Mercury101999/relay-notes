import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';
import { shouldPrecache, VOICE_CACHE } from './src/core/precache';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "manifest-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function offline(): Plugin {
  return {
    name: 'relay-offline',
    apply: 'build',
    transformIndexHtml(html) {
      if (html.includes('Content-Security-Policy')) return html;
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
    generateBundle(_, bundle) {
      const bundled = Object.keys(bundle);
      const publics = walk('public').map((file) => relative('public', file).split('\\').join('/'));
      const files = [...bundled, ...publics].filter((file) => shouldPrecache(file));
      const list = [...new Set(['./index.html', ...files.map((file) => `./${file}`)])];
      const version = createHash('sha256').update(list.join('|')).digest('hex').slice(0, 12);
      const sw = `// Generated app shell. Voice model files are not precached.
const CACHE = 'relay-shell-${version}';
const VOICE = '${VOICE_CACHE}';
const ASSETS = ${JSON.stringify(list)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== VOICE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/models/') || url.pathname.includes('/ort/')) {
    event.respondWith(caches.open(VOICE).then((cache) => cache.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request).then((response) => {
      if (response.ok && response.status === 200) cache.put(request, response.clone());
      return response;
    }))));
    return;
  }
  event.respondWith(caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html', { ignoreVary: true }) : fetch(request))));
});
`;
      new Function(sw);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

function dropBundledWasm(): Plugin {
  return {
    name: 'drop-bundled-wasm',
    generateBundle(_, bundle) {
      for (const key of Object.keys(bundle)) if (key.endsWith('.wasm')) delete bundle[key];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), offline()],
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es', plugins: () => [dropBundledWasm()] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 20_000 },
});
