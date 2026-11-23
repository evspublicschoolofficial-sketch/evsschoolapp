// EVS Public School - High-Performance PWA Service Worker with Live Update Support
// Build version stamped automatically during production build

const CACHE_NAME = 'evs-school-pwa-v10';

// Static core assets to pre-cache on install (HTML is always fetched Network-First)
const PRECACHE_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.png',
  '/icon.svg',
  '/apple-touch-icon.png',
  '/pwa-192x192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(PRECACHE_ASSETS).catch(() => {});
      try {
        const htmlRes = await fetch('/index.html', { cache: 'reload' });
        if (htmlRes && htmlRes.ok) {
          await cache.put('/index.html', htmlRes);
        }
      } catch {}
    })
  );

  // If no existing windows are controlled yet, activate immediately;
  // otherwise let waiting worker notify the UI so user can click "Update App" cleanly.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: false }).then((clientList) => {
      if (!clientList || clientList.length === 0) {
        return self.skipWaiting();
      }
    })
  );
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

// Message channel listener (Notifications, GPS sync, and PWA Instant Update commands)
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => {
        event.source?.postMessage({ type: 'CACHES_CLEARED', timestamp: Date.now() });
      })
    );
  } else if (data.type === 'PING') {
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

// Fetch Handler: Strict Network-First for HTML & bypass for API/version checks
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Never intercept APIs, WebSockets, version metadata, or the service worker script itself
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/ws') ||
    url.pathname === '/version.json' ||
    url.pathname === '/sw.js'
  ) {
    return;
  }

  // CASE 1: Strict Network-First for HTML Document Navigation (prevents stale index.html chunk mismatches on Vercel)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          const contentType = networkResponse.headers.get('content-type') || '';
          if (networkResponse && networkResponse.status === 200 && contentType.includes('text/html')) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedHtml = await caches.match('/index.html');
          return cachedHtml || Response.error();
        })
    );
    return;
  }

  const isScriptOrStyle =
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.mjs') ||
    url.pathname.endsWith('.css');

  // CASE 2: Hashed build assets (/assets/*) — Cache-first since filenames change on every build,
  // with strict MIME validation so Vercel SPA HTML fallbacks are never cached as JS/CSS.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(async (cachedResponse) => {
        if (cachedResponse) {
          const cachedType = cachedResponse.headers.get('content-type') || '';
          if (!(isScriptOrStyle && cachedType.includes('text/html'))) {
            return cachedResponse;
          }
          caches.open(CACHE_NAME).then((cache) => cache.delete(event.request));
        }
        const networkResponse = await fetch(event.request, { cache: 'no-cache' });
        const contentType = networkResponse.headers.get('content-type') || '';
        if (isScriptOrStyle && contentType.includes('text/html')) {
          caches.open(CACHE_NAME).then((cache) => cache.delete('/index.html'));
          return new Response('Stale chunk not found', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain' },
          });
        }
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
    );
    return;
  }

  // CASE 3: Icons, Fonts, Manifest, External CDNs — Stale-While-Revalidate
  const isStaticAsset =
    isScriptOrStyle ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest') ||
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('fonts.gstatic.com');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const validCached =
          cachedResponse &&
          !(isScriptOrStyle && (cachedResponse.headers.get('content-type') || '').includes('text/html'))
            ? cachedResponse
            : undefined;

        const networkFetch = fetch(event.request)
          .then((networkResponse) => {
            const contentType = networkResponse.headers.get('content-type') || '';
            if (isScriptOrStyle && contentType.includes('text/html')) {
              return new Response('Invalid module response', {
                status: 404,
                statusText: 'Not Found',
                headers: { 'Content-Type': 'text/plain' },
              });
            }
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => validCached);

        return validCached || networkFetch;
      })
    );
    return;
  }

  // Default: Network with Cache Fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        const contentType = networkResponse.headers.get('content-type') || '';
        if (networkResponse && networkResponse.status === 200 && !(isScriptOrStyle && contentType.includes('text/html'))) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
