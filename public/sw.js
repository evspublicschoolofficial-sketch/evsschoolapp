// EVS Public School - PWA Background & Web Push Service Worker
// Provides background keep-alive capability, sleep-mode notification handling, and caching

const CACHE_NAME = 'evs-school-pwa-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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

// PUSH EVENT LISTENER: Triggered when a push message is sent to the device (Sleep / Locked mode)
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

// NOTIFICATION CLICK LISTENER: Opens or focuses app when user taps the top notification bar
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus already open window if exists
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_OPENED', url: targetUrl });
          return client.focus();
        }
      }
      // Otherwise open new window
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// Background sync support where available in mobile browsers
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

// PWA Fetch Cache Handler (network first with cache fallback)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Bypass API and WebSocket routes
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        if (event.request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
