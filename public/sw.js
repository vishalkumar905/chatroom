// ChatCord Service Worker - Version 1.2.0
const CACHE_NAME = 'chatcord-cache-v3';

// Essential App Shell resources to precache
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/chat.html',
  '/css/style.css',
  '/js/main.js',
  '/js/pwa.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg',
  'https://fonts.googleapis.com/css?family=Roboto&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.12.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/qs/6.9.4/qs.min.js'
];

// Install Event: Precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use individual caching to avoid a single CDN failure breaking entire install
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn(`[SW] Precache skipped for ${asset}:`, err.message);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-first for HTML pages, Cache-first/Stale-while-revalidate for assets
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never intercept Socket.io, WebSockets, or non-GET requests
  if (req.method !== 'GET' || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // 2. Navigation / HTML Requests: Network-first with cache fallback
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(async () => {
          // Offline fallback
          const cachedRes = await caches.match(req);
          if (cachedRes) return cachedRes;

          // If navigating to chat.html or index.html while offline
          if (url.pathname.includes('chat.html')) {
            return (await caches.match('/chat.html')) || (await caches.match('/index.html'));
          }
          return await caches.match('/index.html');
        })
    );
    return;
  }

  // 3. Static Assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cachedRes) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => null);

      return cachedRes || fetchPromise;
    })
  );
});

// Allow clients to trigger immediate update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
