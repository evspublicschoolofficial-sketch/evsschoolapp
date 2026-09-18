import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

// Server-side in-memory live location store for cross-device synchronization
const busLocationsCache: Record<string, any> = {
  ecad7ddc: {
    busId: 'ecad7ddc',
    driverName: 'Amjad',
    driverPhone: '9761081818',
    currentLocationStr: '30.056038, 77.419096',
    latitude: 30.056038,
    longitude: 77.419096,
    accuracy: 8,
    speed: 0,
    heading: 0,
    lastUpdated: new Date().toISOString(),
    status: 'running',
  },
  '756cedc0': {
    busId: '756cedc0',
    driverName: 'Amjad',
    driverPhone: '9761081818',
    currentLocationStr: '30.056038, 77.419096',
    latitude: 30.056038,
    longitude: 77.419096,
    accuracy: 10,
    speed: 0,
    heading: 0,
    lastUpdated: new Date().toISOString(),
    status: 'running',
  },
};

function busTrackingApiPlugin(): Plugin {
  return {
    name: 'bus-tracking-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/bus-tracking')) {
          return next();
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          return res.end();
        }

        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          return res.end(JSON.stringify(busLocationsCache));
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const data = body ? JSON.parse(body) : {};
              const busId = data.busId || data.bus_id || 'ecad7ddc';
              const prev = busLocationsCache[busId] || {};
              busLocationsCache[busId] = {
                ...prev,
                ...data,
                busId,
                lastUpdated: new Date().toISOString(),
              };
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              return res.end(JSON.stringify({ status: 'success', data: busLocationsCache[busId] }));
            } catch (err: any) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ status: 'error', message: err.message }));
            }
          });
          return;
        }

        return next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), busTrackingApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
