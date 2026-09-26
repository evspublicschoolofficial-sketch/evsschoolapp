import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const TELEMETRY_CACHE_FILE = '/tmp/evs_bus_telemetry.json';
const URL_CONFIG_FILE = '/tmp/evs_apps_script_url.txt';
const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVy51K14qu6IXipAZXP4NspFcAUHpLcYv8-zjhkYnBlUI17TzGi_KaJU9TRmNT8D5vvQ/exec';

let currentAppsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
try {
  if (fs.existsSync(URL_CONFIG_FILE)) {
    const savedUrl = fs.readFileSync(URL_CONFIG_FILE, 'utf-8').trim();
    if (savedUrl.startsWith('https://script.google.com/macros/s/')) {
      currentAppsScriptUrl = savedUrl;
    }
  }
} catch (e) {
  console.warn('Could not read URL config file:', e);
}

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
    const res = await fetch(currentAppsScriptUrl, {
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

function processTelemetryPayload(data: any) {
  const busId = String(data.busId || data.bus_id || 'ecad7ddc').trim();
  const driverName = String(data.driverName || data.driver_name || 'Amjad').trim();
  const lat = typeof data.latitude === 'number' ? data.latitude : parseFloat(data.latitude);
  const lng = typeof data.longitude === 'number' ? data.longitude : parseFloat(data.longitude);

  if (isNaN(lat) || isNaN(lng)) {
    return null;
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

  liveTelemetryStore[busId] = telemetry;
  saveTelemetryCache();

  // Forward asynchronously to Google Sheets
  forwardToGoogleAppsScript(telemetry).then((result) => {
    if (result.ok && !result.response?.includes('error')) {
      console.log(`[GoogleSheetSync] Updated bus ${busId} in Google Sheets`);
    }
  });

  return telemetry;
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Setup WebSocket Server on /ws/location
  const wss = new WebSocketServer({ noServer: true });

  const clients = new Set<WebSocket>();

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    // Send immediate snapshot of current buses
    ws.send(JSON.stringify({ type: 'SNAPSHOT', data: liveTelemetryStore }));

    ws.on('message', (message: string | Buffer) => {
      try {
        const raw = message.toString();
        const parsed = JSON.parse(raw);

        if (parsed.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
          return;
        }

        if (parsed.type === 'LOCATION_UPDATE' && parsed.payload) {
          const telemetry = processTelemetryPayload(parsed.payload);
          if (telemetry) {
            // Acknowledge to sender
            ws.send(JSON.stringify({ type: 'ACK', busId: telemetry.busId, timestamp: telemetry.lastUpdated }));

            // Broadcast update to all connected clients (monitors, parents, dashboard)
            const broadcastMsg = JSON.stringify({ type: 'BUS_UPDATE', telemetry });
            for (const client of clients) {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(broadcastMsg);
              }
            }
          }
        }
      } catch (err) {
        console.warn('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === '/ws/location') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Allow other upgrades (e.g. Vite HMR if any) to pass through
    }
  });

  // Keep WebSocket connections alive with heartbeat
  setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
        } catch {}
      }
    }
  }, 20000);

  // CORS Middleware for seamless local & preview cross-origin requests
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-apps-script-url');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Parsing middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(express.text({ type: ['text/*', 'application/json'] }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      buses: Object.keys(liveTelemetryStore),
      appsScriptUrl: currentAppsScriptUrl,
      wsClients: clients.size,
    });
  });

  // Get current Google Apps Script URL
  app.get('/api/apps-script-url', (_req, res) => {
    res.json({ url: currentAppsScriptUrl, isDefault: currentAppsScriptUrl === DEFAULT_APPS_SCRIPT_URL });
  });

  // Update Google Apps Script URL
  app.post('/api/apps-script-url', (req, res) => {
    try {
      const newUrl = String(req.body?.url || '').trim();
      if (!newUrl || newUrl === DEFAULT_APPS_SCRIPT_URL) {
        currentAppsScriptUrl = DEFAULT_APPS_SCRIPT_URL;
        if (fs.existsSync(URL_CONFIG_FILE)) fs.unlinkSync(URL_CONFIG_FILE);
        return res.json({ success: true, url: DEFAULT_APPS_SCRIPT_URL, message: 'Reset to default Apps Script URL' });
      }
      if (newUrl.startsWith('https://script.google.com/macros/s/')) {
        currentAppsScriptUrl = newUrl;
        fs.writeFileSync(URL_CONFIG_FILE, newUrl, 'utf-8');
        return res.json({ success: true, url: newUrl, message: 'Apps Script URL updated successfully' });
      }
      return res.status(400).json({ error: 'Invalid Google Apps Script Web App URL format' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Forward any action payload (addStudent, addFee, etc.) to Google Apps Script
  app.post('/api/forward-apps-script', async (req, res) => {
    try {
      let payload = req.body;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {}
      }

      // Check if client provided a specific custom URL in payload or headers
      const clientUrl = payload?.appsScriptUrl || req.headers['x-apps-script-url'];
      const targetUrl = (typeof clientUrl === 'string' && clientUrl.trim().startsWith('https://script.google.com/macros/s/'))
        ? clientUrl.trim()
        : currentAppsScriptUrl;

      console.log(`[AppsScriptForwarder] Action: ${payload?.action}, Target: ${targetUrl}`);

      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();

      // Check for Google Apps Script 404 / access error
      if (responseText.includes('Page not found') || responseText.includes('unable to open the file') || responseText.includes('Service invoked too many times')) {
        return res.status(502).json({
          success: false,
          error: 'Google Apps Script Web App unshared or access denied. Please verify Web App deployment with "Who has access: Anyone".',
          needsDeployment: true,
          raw: responseText,
        });
      }

      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(responseText);
      } catch {}

      if (response.ok && (!parsedJson || parsedJson.status !== 'error')) {
        return res.json({
          success: true,
          data: parsedJson || responseText,
        });
      }

      return res.status(response.status || 500).json({
        success: false,
        error: parsedJson?.message || responseText || 'Apps Script returned error',
      });
    } catch (err: any) {
      console.error('[AppsScriptForwarder] Connection Error:', err.message);
      return res.status(502).json({
        success: false,
        error: err.message || 'Failed to connect to Google Apps Script Web App',
      });
    }
  });

  // Ping/Test current Google Apps Script connection
  app.get('/api/test-apps-script', async (req, res) => {
    try {
      const queryUrl = req.query?.url;
      const targetUrl = (typeof queryUrl === 'string' && queryUrl.trim().startsWith('https://script.google.com/macros/s/'))
        ? queryUrl.trim()
        : currentAppsScriptUrl;

      const response = await fetch(`${targetUrl}?action=ping`, { method: 'GET' });
      const text = await response.text();
      if (text.includes('Page not found') || text.includes('unable to open the file')) {
        return res.json({
          ok: false,
          configured: false,
          error: 'Google Apps Script Web App not found. Deploy with "Anyone" access.',
        });
      }
      return res.json({ ok: response.ok, configured: true, response: text.slice(0, 200) });
    } catch (err: any) {
      return res.json({ ok: false, configured: false, error: err.message });
    }
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

      const telemetry = processTelemetryPayload(data);
      if (!telemetry) {
        return res.status(400).json({ error: 'Valid latitude and longitude required' });
      }

      // Broadcast to any connected WebSocket clients
      const broadcastMsg = JSON.stringify({ type: 'BUS_UPDATE', telemetry });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

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

  // In-memory cache for student daily AI greetings to avoid duplicate Gemini API calls & rate limits
  const greetingCache = new Map<string, { text: string; timestamp: number }>();

  // AI Daily Greeting & Activity Summary via Gemini API (@google/genai)
  app.post('/api/ai-student-greeting', async (req, res) => {
    try {
      const {
        studentName = 'छात्र',
        attendanceStatus = 'उपस्थित',
        isAbsent = false,
        homeworkSummary = '',
        behaviorSummary = '',
        teacherRemark = '',
        date = '',
      } = req.body || {};

      const fallbackGreeting = (() => {
        if (isAbsent) {
          return `नमस्ते! आज ${studentName} विद्यालय में अनुपस्थित रहे। हम आशा करते हैं कि वे सकुशल हैं। कृपया छूटे हुए अध्ययन और गृहकार्य का विवरण नीचे देख लें और स्वास्थ्य में सुधार होते ही नियमित उपस्थिति सुनिश्चित करें।`;
        }
        let msg = `नमस्ते! आज ${studentName} विद्यालय में उपस्थित रहे और कक्षा की गतिविधियों में सक्रिय रूप से भाग लिया।`;
        if (teacherRemark && !teacherRemark.toLowerCase().includes('fault')) {
          msg += ` शिक्षक की टिप्पणी: "${teacherRemark}"।`;
        } else if (behaviorSummary) {
          msg += ` आज उनका आचरण व अनुशासन सराहनीय रहा।`;
        }
        if (homeworkSummary) {
          msg += ` आज ${homeworkSummary} दिया गया है, कृपया शाम को समय पर पूरा करवाएं।`;
        } else {
          msg += ` आज का दैनिक विवरण और गृहकार्य नीचे उपलब्ध है।`;
        }
        return msg;
      })();

      const cacheKey = `${studentName}_${date}_${isAbsent}_${attendanceStatus}_${homeworkSummary}_${teacherRemark}`;
      const now = Date.now();
      const cached = greetingCache.get(cacheKey);
      if (cached && now - cached.timestamp < 30 * 60 * 1000) {
        return res.json({ success: true, greeting: cached.text, cached: true });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        greetingCache.set(cacheKey, { text: fallbackGreeting, timestamp: now });
        return res.json({ success: true, greeting: fallbackGreeting, fallback: true });
      }

      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `तुम E.V.S. Public School (ई.वी.एस. पब्लिक स्कूल) के आत्मीय, सम्मानजनक व उत्साहवर्धक AI शिक्षा सहायक हो।
निम्नलिखित छात्र की आज (${date || 'आज'}) की विद्यालय गतिविधियों का विवरण दिया गया है:
- छात्र का नाम: ${studentName}
- उपस्थिति स्थिति: ${isAbsent ? 'अनुपस्थित (Absent)' : attendanceStatus}
- आज का गृहकार्य (Homework): ${homeworkSummary || 'कोई नया गृहकार्य दर्ज नहीं है'}
- आचरण व स्वच्छता (Behavior/Conduct): ${behaviorSummary || 'सामान्य'}
- शिक्षक की टिप्पणी (Teacher Remark): ${teacherRemark || 'कोई विशेष टिप्पणी नहीं'}

निर्देश:
1. अभिभावक को संबोधित करते हुए शुद्ध, सरल, आत्मीय व सम्मानजनक हिंदी में 2 से 3 वाक्यों का संक्षिप्त अभिवादन और आज की मुख्य गतिविधि का सार लिखो।
2. यदि छात्र अनुपस्थित है, तो स्वास्थ्य का हाल पूछें और छूटी पढ़ाई/गृहकार्य की तरफ ध्यान दिलाएं।
3. यदि छात्र उपस्थित था और आचरण/गृहकार्य अच्छा है, तो प्रशंसा करें और गृहकार्य समय पर कराने के लिए प्रेरित करें।
4. कोई शीर्षक, बुलेट पॉइंट या अंग्रेजी शब्द न लिखें। केवल शुद्ध, मधुर व पठनीय हिंदी पैराग्राफ में संदेश दें।`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
        });

        const greetingText = response.text?.trim() || fallbackGreeting;
        greetingCache.set(cacheKey, { text: greetingText, timestamp: now });
        return res.json({
          success: true,
          greeting: greetingText,
        });
      } catch {
        // Gracefully handle rate limit (429), quota exhaustion or API error with fallback greeting
        greetingCache.set(cacheKey, { text: fallbackGreeting, timestamp: now });
        return res.json({
          success: true,
          greeting: fallbackGreeting,
          fallback: true,
        });
      }
    } catch {
      return res.json({
        success: true,
        greeting: 'नमस्ते! छात्र की दैनिक विद्यालय गतिविधियां व विवरण नीचे काम की चीजों में प्रस्तुत हैं।',
        fallback: true,
      });
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} with WebSocket /ws/location`);
  });
}

startServer();
