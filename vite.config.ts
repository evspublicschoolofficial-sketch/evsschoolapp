import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
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

function pwaBuildVersionPlugin(buildVersion: string, isBuild: boolean): Plugin {
  const devVersion = `dev-${Date.now().toString(36)}`;
  return {
    name: 'pwa-build-version-stamp',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const pathname = req.url.split('?')[0];
        if (pathname === '/version.json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              version: devVersion,
              mode: 'dev',
              builtAt: new Date().toISOString(),
            })
          );
        }
        if (pathname === '/sw.js' || pathname === '/index.html') {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        }
        return next();
      });
    },
    closeBundle() {
      if (!isBuild) return;
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) return;

      // 1. Write fresh dist/version.json matching __APP_BUILD_ID__
      let githubSha = String(process.env.GITHUB_SHA || process.env.COMMIT_SHA || '').trim();
      if (!githubSha) {
        try {
          const { execSync } = require('child_process');
          githubSha = String(execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
        } catch {}
      }
      const versionPayload = {
        version: buildVersion,
        mode: 'production',
        builtAt: new Date().toISOString(),
        githubSha: githubSha || undefined,
      };
      fs.writeFileSync(
        path.join(distDir, 'version.json'),
        JSON.stringify(versionPayload, null, 2),
        'utf-8'
      );

      // 2. Stamp dist/sw.js CACHE_NAME so every GitHub/Cloud build triggers SW byte change
      const swPath = path.join(distDir, 'sw.js');
      if (fs.existsSync(swPath)) {
        const rawSw = fs.readFileSync(swPath, 'utf-8');
        const stampedSw = rawSw.replace(
          /const CACHE_NAME\s*=\s*['"][^'"]+['"];/,
          `const CACHE_NAME = 'evs-school-pwa-${buildVersion}';`
        );
        fs.writeFileSync(swPath, stampedSw, 'utf-8');
      }
    },
  };
}

export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  const buildVersion = isBuild
    ? process.env.APP_BUILD_ID ||
      process.env.BUILD_VERSION ||
      `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`
    : 'dev';

  return {
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildVersion),
    },
    plugins: [react(), tailwindcss(), busTrackingApiPlugin(), pwaBuildVersionPlugin(buildVersion, isBuild)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts')) {
              return 'vendor-recharts';
            }
            if (id.includes('node_modules/leaflet')) {
              return 'vendor-leaflet';
            }
            if (id.includes('node_modules/qrcode') || id.includes('node_modules/html5-qrcode') || id.includes('node_modules/jsqr')) {
              return 'vendor-qr';
            }
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor-react';
            }
          },
        },
      },
    },
  };
});
