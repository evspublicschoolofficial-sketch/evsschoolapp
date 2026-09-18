import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const TELEMETRY_CACHE_FILE = '/tmp/evs_bus_telemetry.json';
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzrASF0ip3AsJI-JwgPzXSgUcTphOp3GAMiPGH4sa3iN2pkqGvJaVEDq-uwkgX9xrUuCQ/exec';

// Load cached telemetry if exists
let liveTelemetryStore: Record<string, any> = {};
try {
  if (fs.existsSync(TELEMETRY_CACHE_FILE)) {
    const raw = fs.readFileSync(TELEMETRY_CACHE_FILE, 'utf-8');
    liveTelemetryStore = JSON.parse(raw) || {};
  }
} catch (e) {
  console.warn('Could not read telemetry cache file:', e);
}

function saveTelemetryCache() {
  try {
    fs.writeFileSync(TELEMETRY_CACHE_FILE, JSON.stringify(liveTelemetryStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write telemetry cache file:', e);
  }
}

async function forwardToGoogleAppsScript(payload: any) {
  try {
    const res = await fetch(GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateBusTracking',
        bus_id: payload.busId || payload.bus_id,
        driver_name: payload.driverName || payload.driver_name,
        current_location: payload.currentLocationStr || `${payload.latitude}, ${payload.longitude}`,
        last_updated: payload.lastUpdated || new Date().toISOString(),
        speed: payload.speed || 0,
        status: payload.status || 'running',
      }),
    });
    const text = await res.text();
    return { ok: res.ok, response: text };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function startServer() {
  const app = express();

  // Parsing middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.text({ type: ['text/*', 'application/json'] }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), buses: Object.keys(liveTelemetryStore) });
  });

  // GET live bus telemetry (all buses)
  app.get('/api/bus-tracking', (_req, res) => {
    res.json(liveTelemetryStore);
  });

  // GET live bus telemetry for specific bus
  app.get('/api/bus-tracking/:busId', (req, res) => {
    const busId = req.params.busId;
    res.json(liveTelemetryStore[busId] || null);
  });

  // POST update bus telemetry from Driver Portal
  app.post('/api/bus-tracking', async (req, res) => {
    try {
      let data = req.body;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {}
      }

      const busId = String(data.busId || data.bus_id || 'ecad7ddc').trim();
      const driverName = String(data.driverName || data.driver_name || 'Amjad').trim();
      const lat = typeof data.latitude === 'number' ? data.latitude : parseFloat(data.latitude);
      const lng = typeof data.longitude === 'number' ? data.longitude : parseFloat(data.longitude);

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ error: 'Valid latitude and longitude required' });
      }

      const locStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      const now = new Date().toISOString();

      const telemetry = {
        busId,
        driverName,
        driverPhone: data.driverPhone || '9761081818',
        currentLocationStr: locStr,
        latitude: lat,
        longitude: lng,
        accuracy: data.accuracy || 10,
        speed: data.speed !== undefined ? data.speed : null,
        heading: data.heading !== undefined ? data.heading : null,
        lastUpdated: data.lastUpdated || now,
        status: data.status || 'running',
        isLiveFromSheet: false,
        lastServerSync: now,
      };

      // Store in memory & cache
      liveTelemetryStore[busId] = telemetry;
      saveTelemetryCache();

      // Forward to Google Apps Script in background
      forwardToGoogleAppsScript(telemetry).then((result) => {
        if (result.ok && !result.response?.includes('error')) {
          console.log(`[GoogleSheetSync] Updated bus ${busId} in Google Sheets successfully`);
        }
      });

      res.json({
        success: true,
        message: 'Location saved to server',
        telemetry,
      });
    } catch (err: any) {
      console.error('Error saving bus telemetry:', err);
      res.status(500).json({ error: err.message || 'Internal error' });
    }
  });

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
