// EOS XE Dashboard - Service Worker
// Caches ONLY the local app shell (HTML, icons, manifest).
// External resources (Supabase, unpkg, jsdelivr CDNs) ALWAYS go to network -
// they must never be cached by the SW or stale/broken versions stick forever.

const CACHE = 'eos-xe-v9';
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
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ONLY handle requests for our own origin (the GitHub Pages site).
  // Everything else (Supabase, unpkg, jsdelivr, etc.) is left untouched and
  // goes through the network directly. This prevents stale CDN scripts from
  // being cached forever by the SW.
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML/navigation so updates always roll out immediately
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

  // Cache-first for local shell assets (icons, manifest, sw.js)
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
