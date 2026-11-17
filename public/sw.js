import { CACHE_NAME, STATIC_ASSETS } from './precache-manifest.js';

const ownedCache = /^shopping-assistant-(?:shell-[a-f0-9]+|v[0-9]+)$/;
const precached = new Set(STATIC_ASSETS);

self.addEventListener('install', (event) => {
  // The active worker keeps its own complete shell until every old tab closes.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(STATIC_ASSETS.map(path => new Request(path, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME && ownedCache.test(name))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isAppNavigation = request.mode === 'navigate' &&
    (url.pathname === '/' || url.pathname === '/index.html');
  const path = isAppNavigation ? '/index.html' : url.pathname;
  if (!precached.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(path) || fetch(request);
  })());
});

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