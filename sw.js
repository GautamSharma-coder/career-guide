const CACHE_NAME = "EduPath-pwa-v1";
const DYNAMIC_CACHE = "EduPath-dynamic-v1";
const IMAGE_CACHE = "EduPath-images-v1";
const MAX_DYNAMIC_ITEMS = 50;
const MAX_IMAGE_ITEMS = 100;

const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/favicon.png',
  '/offline.html' // fallback page
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME && key !== DYNAMIC_CACHE && key !== IMAGE_CACHE) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch event - network-first strategy with fallbacks
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin requests
  if (url.origin !== location.origin) return;

  // Handle different resource types
  if (request.destination === 'image') {
    event.respondWith(handleImageRequest(request));
  } else if (request.url.includes('/api/')) {
    event.respondWith(handleApiRequest(request));
  } else {
    event.respondWith(handlePageRequest(request));
  }
});

// Network-first strategy for pages
async function handlePageRequest(request) {
  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(DYNAMIC_CACHE);
    cache.put(request, networkResponse.clone());
    await limitCacheSize(DYNAMIC_CACHE, MAX_DYNAMIC_ITEMS);
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    return cachedResponse || caches.match('/offline.html');
  }
}

// Cache-first strategy for images
async function handleImageRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    const cache = await caches.open(IMAGE_CACHE);
    cache.put(request, networkResponse.clone());
    await limitCacheSize(IMAGE_CACHE, MAX_IMAGE_ITEMS);
    return networkResponse;
  } catch (error) {
    return new Response('Image not available', { status: 404 });
  }
}

// Network-only strategy for API calls with timeout
async function handleApiRequest(request) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), 5000)
  );

  try {
    return await Promise.race([fetch(request), timeoutPromise]);
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Network error', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Limit cache size
async function limitCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    await limitCacheSize(cacheName, maxItems);
  }
}

// Background sync for offline data
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-data') {
    event.waitUntil(syncOfflineData());
  }
});

async function syncOfflineData() {
  // Implement your sync logic here
  console.log('[SW] Syncing offline data...');
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'New update available!',
    icon: '/icons/favicon.png',
    badge: '/icons/favicon.png',
    vibrate: [200, 100, 200],
    data: data.url || '/',
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'EduPath', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data || '/')
    );
  }
});

// Message handler for manual cache updates
self.addEventListener('message', (event) => {
  if (event.data.action === 'skipWaiting') {
    self.skipWaiting();
  } else if (event.data.action === 'clearCache') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
    );
  }
});