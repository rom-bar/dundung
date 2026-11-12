import { readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const outputDirectory = resolve('dist');
const files = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(absolutePath);
    else if (entry.name !== 'sw.js') {
      files.push(relative(outputDirectory, absolutePath).split(sep).join('/'));
    }
  }
}

await collect(outputDirectory);
files.sort();
const precache = JSON.stringify(files, null, 2);
const source = `/* Pocket Pal offline shell. Generated after each build. */
const CACHE_NAME = 'pocket-pal-shell-v1';
const PRECACHE_FILES = ${precache};
const scopeUrl = self.registration.scope;
const PRECACHE_URLS = PRECACHE_FILES.map((file) => new URL(file, scopeUrl).href);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('pocket-pal-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(scopeUrl)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(new URL('index.html', scopeUrl).href, { ignoreVary: true }))));
    return;
  }

  event.respondWith(caches.open(CACHE_NAME).then((cache) => cache.match(url.href, { ignoreVary: true })).then((cached) => cached || fetch(request)));
});
`;

await writeFile(resolve(outputDirectory, 'sw.js'), source, 'utf8');
console.log(`Generated offline service worker with ${files.length} precached files.`);
