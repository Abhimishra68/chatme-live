/* Chatme service worker.
 *
 * Scope (web-platform reality):
 *  - Offline app-shell caching so the UI loads without a network.
 *  - Network-first for navigations with a cached fallback.
 *  - Background Sync: when the browser fires a 'sync' event (connectivity
 *    restored), wake any open clients so they flush the outbox queue. The
 *    queue itself lives in the page (localStorage), so the SW signals the
 *    page rather than sending directly. On platforms without Background Sync
 *    the page's own 'online' listener handles the flush.
 *
 * Note: true always-on background delivery (app fully closed) requires Web
 * Push + a push backend, or a native shell. This SW covers the web-supported
 * subset; see docs for the native path.
 */

const CACHE = 'chatme-shell-v2';
const SHELL = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never cache API / realtime / storage calls — always go to network.
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});

// Background Sync: notify open clients to flush their outbox.
self.addEventListener('sync', (event) => {
  if (event.tag === 'chatme-outbox') {
    event.waitUntil(notifyClients('flush-queue'));
  }
});

async function notifyClients(type) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage({ type });
}
