/*
 * Single service worker with two jobs:
 *
 * 1. Cross-origin isolation shim: GitHub Pages cannot set custom HTTP
 *    response headers, but the multi-threaded FFmpeg.wasm core needs
 *    SharedArrayBuffer, which requires the page to be "cross-origin
 *    isolated" (COOP: same-origin + COEP: require-corp on the document
 *    response). This worker intercepts every same-origin fetch —
 *    including the navigation request for the document itself — and adds
 *    those two headers to the response. Approach based on the well-known
 *    coi-serviceworker technique (github.com/gzuidhof/coi-serviceworker).
 * 2. App-shell caching so the app installs as a PWA and keeps working
 *    offline, including caching the (large) FFmpeg core files fetched
 *    from the CDN at runtime so repeat runs don't re-download them.
 *
 * All paths are resolved relative to this file's own scope so the app
 * works when deployed under a GitHub Pages subfolder
 * (https://user.github.io/repo-name/) as well as at a domain root.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `slowmo-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `slowmo-runtime-${CACHE_VERSION}`;

const SCOPE_URL = self.registration.scope;

const APP_SHELL_PATHS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/ffmpeg-commands.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const urls = APP_SHELL_PATHS.map((p) => new URL(p, SCOPE_URL).toString());
      try {
        await cache.addAll(urls);
      } catch (err) {
        // Don't let a single missing/renamed asset block installation of
        // the worker entirely - isolation headers matter more than a
        // perfect offline cache.
        console.warn('[sw] app shell precache incomplete:', err);
      }
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

function withIsolationHeaders(response) {
  // Opaque responses (status 0, e.g. no-cors cross-origin) can't have
  // their headers read or altered - just pass them through untouched.
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(request);
          if (network && network.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(request, network.clone());
          }
          return withIsolationHeaders(network);
        } catch (err) {
          const cached = await caches.match(request);
          if (cached) return withIsolationHeaders(cached);
          if (request.mode === 'navigate') {
            const fallback = await caches.match(new URL('./index.html', SCOPE_URL).toString());
            if (fallback) return withIsolationHeaders(fallback);
          }
          throw err;
        }
      })()
    );
    return;
  }

  // Cross-origin requests: the FFmpeg.wasm JS/WASM/worker files fetched
  // from the CDN at process-time. Cache them at runtime (cache-first) so
  // they only get downloaded once, letting repeat use and offline mode
  // skip the ~30MB re-download.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const network = await fetch(request);
        if (network && network.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, network.clone());
        }
        return network;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    })()
  );
});
