const CACHE_NAME = 'shopping-assistant-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/error-tracker.js',
  '/js/shopping-list.js',
  '/js/product-catalog.js',
  '/js/recommendation-engine.js',
  '/js/command-parser.js',
  '/js/voice-recognition.js',
  '/js/ui.js',
  '/js/hybrid-parser.js',
  '/js/intent-schema.js',
  '/js/rule-based-parser.js',
  '/js/llm-parser.js',
  '/js/sync-manager.js',
  '/data/products.json',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

const CACHE_STRATEGIES = {
  static: 'cache-first',
  api: 'network-first',
  firebase: 'network-only'
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip Firebase API calls - let them go through network
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.pathname.startsWith('/api/')) {
    return;
  }

  // Skip external domains
  if (url.origin !== location.origin) {
    return;
  }

  // Handle different strategies based on request type
  if (url.pathname.startsWith('/data/')) {
    // Data files - cache first
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }

  if (url.pathname.startsWith('/js/') || 
      url.pathname.startsWith('/css/') ||
      url.pathname === '/' ||
      url.pathname === '/index.html' ||
      url.pathname === '/manifest.json') {
    // Static assets - cache first
    event.respondWith(cacheFirstStrategy(event.request));
    return;
  }

  // Default: network first with cache fallback
  event.respondWith(networkFirstStrategy(event.request));
});

async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Cache first failed:', error);
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-shopping-list') {
    event.waitUntil(syncShoppingList());
  }
});

async function syncShoppingList() {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_COMPLETE' });
    }
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    vibrate: [100, 50, 100],
    data: data.data,
    actions: [
      { action: 'view', title: 'View List' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
          if (clients.length > 0) {
            return clients[0].focus();
          }
          return self.clients.openWindow('/');
        })
    );
  }
});

console.log('[SW] Service Worker loaded');