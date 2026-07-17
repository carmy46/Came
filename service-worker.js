const CACHE_NAME = 'came-v26';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/admin.html',
  '/employee.html',
  '/report.html',
  '/css/style.css',
  '/js/auth.js',
  '/js/admin.js',
  '/js/employee.js',
  '/js/guard.js',
  '/js/supabaseClient.js',
  '/js/export.js',
  '/js/notifications.js',
  '/js/projectReport.js'
];

// Installazione: cache degli asset statici
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Attivazione: pulizia cache vecchie
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: strategia ibrida
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network Only per API Supabase: mai cachare dati sensibili
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache First per asset statici (HTML, CSS, JS)
  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request)
          .then((response) => {
            // Non cachare errori o richieste non-GET
            if (!response || response.status !== 200 || request.method !== 'GET') {
              return response;
            }
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
            return response;
          });
      })
  );
});
