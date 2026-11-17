// VicTravels service worker: push notifications + offline support.
//  - App shell (index.html etc.): network-first, falls back to the saved copy when offline.
//  - CDN libraries & fonts: saved on install, refreshed in the background.
//  - Uploaded photos/files (Supabase public storage): saved as they are viewed, or all at once
//    from the "Offline pack" tool in the app; served from the saved copy first.
// Trip data itself is saved by the app (localStorage); this file only handles files & the page.
const VER = 'v3';
const SHELL = 'vt-shell-' + VER;
const LIBS = 'vt-libs-v1';
const FILES = 'vt-files-v1'; // also written to by the app's "Download for offline" button
const SHELL_URLS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const LIB_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(u => shell.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_URLS.map(u => libs.add(u).catch(() => {})));
    // Also keep the font files the Google Fonts stylesheet points to.
    try {
      const css = await (await fetch(LIB_URLS[2])).text();
      const fontUrls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
      await Promise.all(fontUrls.map(u => libs.add(u).catch(() => {})));
    } catch (e) { /* fonts are optional */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, LIBS, FILES]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('vt-') && !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

async function networkFirst(req, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await withTimeout(fetch(req), timeoutMs || 6000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html', { ignoreSearch: true }) : null);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  // ok responses and opaque ones (plain <img> requests) are both fine to keep
  if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.pathname.includes('/storage/v1/object/public/')) {
    event.respondWith(cacheFirst(req, FILES));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, SHELL, req.mode === 'navigate' ? 5000 : 8000));
  } else if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, LIBS));
  }
});

self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'VicTravels', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'VicTravels', {
    body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png',
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
