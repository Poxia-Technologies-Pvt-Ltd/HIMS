// Service worker of the Field app. It only lets the app open without a network: the page shell and
// the built script/style files are kept; data never is (patients and orders live in the app's own
// IndexedDB store, and every /api request goes straight to the network).
const CACHE = 'ka-field-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/field.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Opening /field: the live page when online (and remember it), the remembered page when not.
  if (req.mode === 'navigate' && url.pathname.startsWith('/field')) {
    e.respondWith(
      fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/field', copy)); } return res; })
        .catch(() => caches.match('/field').then((hit) => hit || new Response('Open the Field app once with a network connection first.', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
    );
    return;
  }

  // Built files carry a hash in their name, so a cached copy is never stale.
  if (url.pathname.startsWith('/assets/') || url.pathname === '/karnataka-logo.png' || url.pathname === '/field.webmanifest') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
