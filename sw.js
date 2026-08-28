// EOS XE Dashboard - Service Worker
// Auto-updates on every deploy without user intervention.
// - Caches only local shell (HTML, icons, manifest); external CDNs go to network.
// - New SW activates immediately on install (skipWaiting) and forces open tabs
//   to reload so the new version takes effect without "clear cache" dance.

const CACHE = 'eos-xe-v11';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Delete old caches
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    // Take control of all open tabs immediately
    await self.clients.claim();
    // Tell any open clients that a new SW is active so they can reload
    const clients = await self.clients.matchAll({type: 'window'});
    for (const client of clients) client.postMessage({type: 'SW_UPDATED'});
  })());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // ONLY handle same-origin requests. External CDNs (Supabase, cdnjs, jsdelivr)
  // go directly to network so stale scripts never get cached.
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML so updates always roll out immediately
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for local shell assets (icons, manifest)
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(r => {
        if (r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return r;
      }).catch(() => cached)
    )
  );
});
