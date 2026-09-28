/*
 * webyak's service worker: an installable app with an offline shell, and
 * nothing more (docs/ARCHITECTURE.md#installable-and-an-offline-shell).
 *
 * It caches only webyak's own files, never anything from another origin: no
 * API response, no image, no token ever lands in a cache here. The archive
 * (IndexedDB) is what keeps posts readable offline.
 *
 * - Page loads: network first, so a new deploy is picked up the moment it's
 *   online. Offline, the last page shell that loaded.
 * - /_expo/static/: cache first. Those names carry a content hash, so a file
 *   under one never changes.
 * - A few root files (icons, the manifest): stale while revalidate.
 *
 * To take it out of service: replace this file with one that calls
 * `self.registration.unregister()`, and deploy.
 */

const VERSION = 'webyak-v1';
const SHELL = '/index.html';
const ROOT_FILES = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll([SHELL, ...ROOT_FILES]).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never another origin: the API, images and video all pass straight through.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(SHELL, copy));
          }
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith('/_expo/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (ROOT_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});
