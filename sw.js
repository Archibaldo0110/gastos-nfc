// Este service worker existe SOLO para que Chrome permita instalar la app
// como app real (uno de los requisitos técnicos de las PWA). A propósito
// NO cachea ni intercepta nada: cada pedido va directo a la red, exactamente
// como si no existiera. Así nunca puede repetirse el problema anterior de
// servir una versión vieja guardada en caché.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intencionalmente vacío: no se llama a respondWith(), así que el
  // navegador maneja el pedido de forma normal, sin pasar por ningún caché.
});
