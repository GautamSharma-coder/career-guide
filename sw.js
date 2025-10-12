const CACHE_NAME = "EduPath-pwa-v1";
const DYNAMIC_CACHE = "EduPath-dynamic-v1";
const IMAGE_CACHE = "EduPath-images-v1";
const CDN_CACHE = "EduPath-cdn-v1";
const MAX_DYNAMIC_ITEMS = 50;
const MAX_IMAGE_ITEMS = 100;

const urlsToCache = [
  '/',
  '/index.html',
  '/pages/roadmaps_page.html',
  '/pages/explore_colleges.html',
  '/pages/careers_page.html'
  '/manifest.json',
  '/icons/favicon.png',
  '/offline.html'
];

// CDN resources to cache (CRITICAL for offline functionality)
const cdnUrlsToCache = [
  // Tailwind CSS CDN
  'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4',
  
  // Google Fonts CSS
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Poppins:wght@300;400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap'
  
  // Common font files (these will be cached when first loaded)
  // Google Fonts serve different files per browser, so we cache them dynamically
];

// Install event - cache static assets and CDN resources
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    Promise.all([
      // Cache local static assets
      caches.open(CACHE_NAME).then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(urlsToCache);
      }),
      // Cache CDN resources
      caches.open(CDN_CACHE).then((cache) => {
        console.log('[SW] Caching CDN resources');
        return cache.addAll(cdnUrlsToCache).catch(err => {
          console.warn('[SW] Some CDN resources failed to cache:', err);
          // Continue even if some CDN resources fail
        });
      })
    ]).then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  const cacheWhitelist = [CACHE_NAME, DYNAMIC_CACHE, IMAGE_CACHE, CDN_CACHE];
  
  event.waitUntil(
    caches.keys().then((keyList) =>
      Promise.all(
        keyList.map((key) => {
          if (!cacheWhitelist.includes(key)) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch event - handle different resource types
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Handle CDN resources (Tailwind, Google Fonts, etc.)
  if (isCDNResource(url)) {
    event.respondWith(handleCDNRequest(request));
    return;
  }

  // Skip other cross-origin requests
  if (url.origin !== location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // Handle different resource types
  if (request.destination === 'image') {
    event.respondWith(handleImageRequest(request));
  } else if (request.url.includes('/api/')) {
    event.respondWith(handleApiRequest(request));
  } else {
    event.respondWith(handlePageRequest(request));
  }
});

// Check if URL is a CDN resource
function isCDNResource(url) {
  const cdnDomains = [
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'unpkg.com',
    'cdn.jsdelivr.net'
  ];
  
  return cdnDomains.some(domain => url.hostname.includes(domain));
}

// Cache-first strategy for CDN resources (fonts, CSS libraries)
async function handleCDNRequest(request) {
  try {
    // Try cache first
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[SW] CDN cache hit:', request.url);
      return cachedResponse;
    }

    // If not in cache, fetch from network
    console.log('[SW] CDN cache miss, fetching:', request.url);
    const networkResponse = await fetch(request);
    
    // Only cache successful responses
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CDN_CACHE);
      // Clone the response because it can only be used once
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] CDN fetch failed:', request.url, error);
    
    // Try to return cached version if network fails
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // If it's a CSS file, return a minimal fallback
    if (request.url.includes('.css') || request.url.includes('tailwind')) {
      return new Response('/* Offline - CSS unavailable */', {
        headers: { 'Content-Type': 'text/css' }
      });
    }
    
    throw error;
  }
}

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
  } else if (event.data.action === 'cacheCDN') {
    // Manually cache CDN resources
    event.waitUntil(
      caches.open(CDN_CACHE).then(cache => {
        return cache.addAll(cdnUrlsToCache);
      })
    );
  }
});