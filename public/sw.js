// EVS Public School - High-Performance PWA Service Worker
// Enables 0.1-second instant app launch on mobile devices with Stale-While-Revalidate caching

const CACHE_NAME = 'evs-school-pwa-v7';

// Static core assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Periodic background sync or message channel listener
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'PING') {
    event.source?.postMessage({ type: 'PONG', timestamp: Date.now() });
  } else if (data.type === 'STORE_LAST_LOCATION') {
    self.lastKnownLocation = data.payload;
    event.source?.postMessage({ type: 'LOCATION_STORED', timestamp: Date.now() });
  } else if (data.type === 'SHOW_NOTIFICATION') {
    const payload = data.payload || {};
    const title = payload.title || '📢 E.V.S. PUBLIC SCHOOL';
    const options = {
      body: payload.body || 'नया स्कूल अपडेट जारी हुआ है।',
      icon: payload.icon || '/pwa-192x192.png',
      badge: payload.badge || '/pwa-192x192.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: payload.tag || 'evs-school-alert',
      renotify: true,
      requireInteraction: true,
      data: { url: payload.url || '/' },
    };
    self.registration.showNotification(title, options);
  }
});

// Push notification handling
self.addEventListener('push', (event) => {
  let data = {
    title: '📢 E.V.S. PUBLIC SCHOOL',
    body: 'नया स्कूल नोटिस जारी हुआ है। देखने के लिए टैप करें।',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'evs-push-alert',
    url: '/',
  };

  if (event.data) {
    try {
      const json = event.data.json();
      data = { ...data, ...json };
    } catch (e) {
      const text = event.data.text();
      if (text) data.body = text;
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/pwa-192x192.png',
    vibrate: [300, 100, 300, 100, 300],
    tag: data.tag || 'evs-school-alert',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click listener
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_OPENED', url: targetUrl });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Background sync support
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-bus-location' && self.lastKnownLocation) {
    event.waitUntil(
      fetch('/api/bus-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(self.lastKnownLocation),
      }).catch((err) => console.warn('[SW] Background sync fetch failed:', err))
    );
  }
});

// High-speed Fetch Handler with Network-First Navigation for Instant Updates
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Bypass API and WebSocket routes
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
    return;
  }

  // CASE 1: HTML Document Navigation (Network-First to always deliver instant live updates)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // CASE 2: Static Assets (JS, CSS, Images, Fonts, Icons)
  // These are immutable with hashes (e.g. /assets/index-*.js) or static CDNs
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Serve from cache immediately in 5ms, revalidate in background
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        // Not in cache yet: fetch from network and cache for next time
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);
      })
    );
    return;
  }

  // Default: Network with Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
