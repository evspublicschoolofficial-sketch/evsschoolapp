// EVS Public School - GPS Telemetry Service Worker
// Provides background keep-alive capability and caching for offline/screen-lock scenarios

const CACHE_NAME = 'evs-bus-tracker-v1';

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
    // Keep last known coordinates available in worker context
    self.lastKnownLocation = data.payload;
    event.source?.postMessage({ type: 'LOCATION_STORED', timestamp: Date.now() });
  }
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
