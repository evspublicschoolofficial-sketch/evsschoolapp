// Dedicated background Web Worker for continuous GPS tracking and timer heartbeat
// Web Workers run in their own background thread and are not throttled as aggressively
// by mobile browsers when tabs lose focus or screens lock.

let heartbeatInterval = null;
let currentCountdown = 15;

self.onmessage = function (e) {
  const data = e.data;
  if (!data) return;

  if (data.action === 'START_TRACKING') {
    currentCountdown = 15;
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    heartbeatInterval = setInterval(() => {
      currentCountdown--;
      if (currentCountdown <= 0) {
        currentCountdown = 15;
        // Notify main thread to trigger high accuracy GPS position and sheet push
        self.postMessage({ type: 'TRIGGER_UPDATE', timestamp: Date.now() });
      } else {
        self.postMessage({ type: 'TICK', countdown: currentCountdown });
      }
    }, 1000);

    self.postMessage({ type: 'STARTED' });
  } else if (data.action === 'STOP_TRACKING') {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    currentCountdown = 15;
    self.postMessage({ type: 'STOPPED' });
  }
};
