const CACHE = 'nano-static-v2';
const STATIC = ['/manifest.json', '/nano-logo.svg'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(
        STATIC.map(path =>
          fetch(path, { cache: 'no-store' })
            .then(response => {
              if (response.ok) return cache.put(path, response);
              return undefined;
            })
            .catch(() => undefined),
        ),
      ),
    ),
  );
  // Las actualizaciones esperan a que el usuario pulse "Actualizar".
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // No interceptar peticiones a la API ni a Socket.IO.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return;

  // El HTML siempre se solicita primero al servidor. Así una publicación nueva
  // no queda bloqueada por una copia vieja del index.html.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put('/', copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Los assets generados por Vite llevan hash en el nombre y son seguros para
  // cachear. Si no están en caché, se descargan y se guardan.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached ||
        fetch(event.request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => undefined);
          }
          return response;
        }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request)),
  );
});
