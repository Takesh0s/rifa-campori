// Service worker: makes the site installable and lets it open offline with the
// last data seen. Raffle state must never be stale while online, so every
// request is network-first; the cache is only a fallback. API calls and
// Supabase traffic are never cached.
const CACHE = 'rifa-shell-v1';
const SHELL = [
  '/', '/meus-numeros', '/galeria',
  '/assets/style.css', '/assets/theme.js', '/assets/config.js', '/assets/shared.js',
  '/assets/app.js', '/assets/my-numbers.js', '/assets/gallery.js',
  '/assets/vendor/supabase-2.118.0.js', '/assets/vendor/confetti-1.9.3.js',
  '/assets/tent.png', '/assets/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  // Cache entries one by one: a single missing file must not abort installation.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' })
        .then((hit) => hit || (request.mode === 'navigate' ? caches.match('/') : undefined))
        .then((hit) => hit || Response.error()))
  );
});
