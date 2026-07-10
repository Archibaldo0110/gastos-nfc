// v2: fuerza siempre a traer la versión más nueva del servidor cuando hay
// internet, ignorando el caché HTTP del navegador (cache:'no-store').
// Solo usa lo guardado en caché si de verdad no hay conexión.
const CACHE = 'gastos-v2';
const ASSETS = ['/', '/index.html', '/quick-add.html', '/auth.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(resp => {
        caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
