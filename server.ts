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
    const formattedPayload = payload.action ? payload : {
      action: 'updateBusTracking',
      bus_id: payload.busId || payload.bus_id || '121212',
      driver_name: payload.driverName || payload.driver_name || 'Amjad',
      current_location: payload.currentLocationStr || `${payload.latitude}, ${payload.longitude}`,
      last_updated: payload.lastUpdated || new Date().toISOString(),
      speed: payload.speed || 0,
      status: payload.status || 'running',
    };

    // 1. Try POST
    const res = await fetch(currentAppsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(formattedPayload),
    });
    const text = await res.text();

    // 2. If POST returned "Invalid action", attempt GET fallback for actions like updateBusTracking
    if (text.includes('Invalid action') && formattedPayload.action === 'updateBusTracking') {
      try {
        const getUrl = `${currentAppsScriptUrl}?action=updateBusTracking&bus_id=${encodeURIComponent(formattedPayload.bus_id)}&driver_name=${encodeURIComponent(formattedPayload.driver_name)}&current_location=${encodeURIComponent(formattedPayload.current_location)}`;
        const gRes = await fetch(getUrl);
        const gText = await gRes.text();
        if (gText.includes('success') || gText.includes('updated')) {
          return { ok: true, response: gText };
        }
      } catch {}
    }

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

        // Real-Time Data Mutation Broadcast (Fees, Students, Notices, Behavior, Homework)
        if (parsed.type === 'DATA_MUTATED' || parsed.type === 'APP_DATA_UPDATED') {
          const updateBroadcast = JSON.stringify({
            type: 'APP_DATA_UPDATED',
            entity: parsed.entity || 'all',
            action: parsed.action || '',
            details: parsed.details || {},
            timestamp: Date.now(),
          });
          for (const client of clients) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(updateBroadcast);
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

  // Diagnostic endpoint for Apps Script Live Features
  app.get('/api/apps-script-diagnostic', async (_req, res) => {
    let pingOk = false;
    let supportsHomework = false;
    let supportsBus = false;

    try {
      const pRes = await fetch(`${currentAppsScriptUrl}?action=ping`);
      const pText = await pRes.text();
      pingOk = pText.includes('success') || pText.includes('Active');
    } catch {}

    try {
      const bRes = await fetch(`${currentAppsScriptUrl}?action=getBusTracking`);
      const bText = await bRes.text();
      supportsBus = !bText.includes('Invalid') && !bText.includes('<!DOCTYPE');
    } catch {}

    try {
      const hRes = await fetch(`${currentAppsScriptUrl}?action=getHomework`);
      const hText = await hRes.text();
      supportsHomework = !hText.includes('Invalid') && !hText.includes('Active') && !hText.includes('<!DOCTYPE');
    } catch {}

    res.json({
      url: currentAppsScriptUrl,
      pingOk,
      supportsBus,
      supportsHomework,
      needsDeployment: !supportsBus || !supportsHomework,
    });
  });

  // Persistent deleted fee receipts file path
  const DELETED_RECEIPTS_FILE = '/tmp/evs_deleted_receipts.json';
  const HOMEWORK_FILE = '/tmp/evs_homework.json';
  const BEHAVIOR_FILE = '/tmp/evs_behavior.json';
  const HW_TRACKER_FILE = '/tmp/evs_hw_tracker.json';

  const getDeletedReceipts = (): string[] => {
    try {
      if (fs.existsSync(DELETED_RECEIPTS_FILE)) {
        const content = fs.readFileSync(DELETED_RECEIPTS_FILE, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
      console.warn('Error reading deleted receipts file:', e);
    }
    return [];
  };

  const saveDeletedReceipt = (receiptNo: string): string[] => {
    const clean = String(receiptNo || '').replace(/^#/, '').trim().toLowerCase();
    if (!clean) return getDeletedReceipts();
    const list = getDeletedReceipts();
    if (!list.includes(clean)) {
      list.push(clean);
      try {
        fs.writeFileSync(DELETED_RECEIPTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
      } catch (e) {
        console.warn('Error saving deleted receipt:', e);
      }
    }
    return list;
  };

  // Persistent Homework Storage
  const getHomeworkList = (): any[] => {
    try {
      if (fs.existsSync(HOMEWORK_FILE)) {
        return JSON.parse(fs.readFileSync(HOMEWORK_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('Error reading homework file:', e);
    }
    return [];
  };

  const saveHomeworkItem = (item: any): any[] => {
    const list = getHomeworkList();
    const hwId = String(item.homework_id || item.Homework_ID || `HW-${Date.now()}`);
    const normalized = {
      Homework_ID: hwId,
      Date: item.date || item.Date || new Date().toISOString().split('T')[0],
      Class: item.class_name || item.class || item.Class || '',
      Subject: item.subject || item.Subject || 'General',
      Homework_Detail: item.detail || item.detail_text || item.Homework_Detail || '',
      Target_Type: 'Whole Class',
      Teacher: item.teacher || item.Teacher || 'Faculty',
    };
    const idx = list.findIndex((h) => h.Homework_ID === hwId);
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      list.unshift(normalized);
    }
    try {
      fs.writeFileSync(HOMEWORK_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving homework file:', e);
    }
    return list;
  };

  // Persistent Behavior Storage
  const getBehaviorList = (): any[] => {
    try {
      if (fs.existsSync(BEHAVIOR_FILE)) {
        return JSON.parse(fs.readFileSync(BEHAVIOR_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('Error reading behavior file:', e);
    }
    return [];
  };

  const saveBehaviorItem = (item: any): any[] => {
    const list = getBehaviorList();
    const bId = String(item.behavior_id || item.Behavior_ID || `BEH-${Date.now()}`);
    const normalized = {
      Behavior_ID: bId,
      Student_ID: item.student_id || item.Student_ID || '',
      Date: item.date || item.Date || new Date().toISOString().split('T')[0],
      Class: item.class || item.Class || '',
      Is_Bathed: item.is_bathed ?? item.Is_Bathed ?? true,
      Nails_Clean: item.nails_clean ?? item.Nails_Clean ?? true,
      Uniform_clean: item.uniform_clean ?? item.Uniform_clean ?? true,
      Good_Manners: item.good_manners || item.Good_Manners || 'Good',
      Discipline: item.discipline ?? item.Discipline ?? true,
      Is_Present: item.is_present ?? item.Is_Present ?? true,
      Remark: item.remark || item.Remark || '',
      AI_Feedback: item.ai_feedback || item.AI_Feedback || '',
    };
    const idx = list.findIndex((b) => b.Behavior_ID === bId);
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      list.unshift(normalized);
    }
    try {
      fs.writeFileSync(BEHAVIOR_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving behavior file:', e);
    }
    return list;
  };

  // Persistent Homework Tracker Storage
  const getHwTrackerList = (): any[] => {
    try {
      if (fs.existsSync(HW_TRACKER_FILE)) {
        return JSON.parse(fs.readFileSync(HW_TRACKER_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('Error reading tracker file:', e);
    }
    return [];
  };

  const saveHwTrackerItem = (item: any): any[] => {
    const list = getHwTrackerList();
    const tId = String(item.record_id || item.ID || `TRK-${Date.now()}`);
    const sId = String(item.student_id || item.Student_ID || '');
    const normalized = {
      ID: tId,
      Date: item.date || item.Date || new Date().toISOString().split('T')[0],
      Class: item.class || item.Class || '',
      Student_ID: sId,
      Subject: item.subject || item.Subject || 'General',
      Last_homework_Status: item.status || item.Last_homework_Status || 'Completed',
      Remark: item.remark || item.Remark || '',
    };
    const idx = list.findIndex(
      (t) => t.ID === tId || (sId && t.Student_ID && t.Student_ID.toLowerCase() === sId.toLowerCase() && t.Date === normalized.Date)
    );
    if (idx >= 0) {
      list[idx] = normalized;
    } else {
      list.unshift(normalized);
    }
    try {
      fs.writeFileSync(HW_TRACKER_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving tracker file:', e);
    }
    return list;
  };

  // Endpoints for Local Server Data
  app.get('/api/homework', (_req, res) => {
    res.json({ homework: getHomeworkList() });
  });

  app.post('/api/homework', (req, res) => {
    const item = req.body;
    const list = saveHomeworkItem(item);
    res.json({ success: true, homework: list });
  });

  app.get('/api/behavior', (_req, res) => {
    res.json({ behavior: getBehaviorList() });
  });

  app.post('/api/behavior', (req, res) => {
    const item = req.body;
    const list = saveBehaviorItem(item);
    res.json({ success: true, behavior: list });
  });

  app.get('/api/homework-tracker', (_req, res) => {
    res.json({ records: getHwTrackerList() });
  });

  app.post('/api/homework-tracker', (req, res) => {
    const item = req.body;
    const list = saveHwTrackerItem(item);
    res.json({ success: true, records: list });
  });

  // Get list of deleted receipts
  app.get('/api/deleted-receipts', (_req, res) => {
    res.json({ receipts: getDeletedReceipts() });
  });

  // Add a deleted receipt
  app.post('/api/deleted-receipts', (req, res) => {
    const receiptNo = req.body?.receipt_no || req.body?.receiptNo;
    const list = saveDeletedReceipt(receiptNo);
    res.json({ success: true, receipts: list });
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

      // Pre-persist locally to prevent any data loss
      if (payload?.action === 'deleteFee' && payload?.receipt_no) {
        saveDeletedReceipt(payload.receipt_no);
      } else if (payload?.action === 'addHomework') {
        saveHomeworkItem(payload);
      } else if (payload?.action === 'addBehavior') {
        saveBehaviorItem(payload);
      } else if (payload?.action === 'updateHomeworkTracker') {
        saveHwTrackerItem(payload);
      } else if (payload?.action === 'updateBusTracking') {
        processTelemetryPayload(payload);
      }

      // Check if client provided a specific custom URL in payload or headers
      const clientUrl = payload?.appsScriptUrl || req.headers['x-apps-script-url'];
      const targetUrl = (typeof clientUrl === 'string' && clientUrl.trim().startsWith('https://script.google.com/macros/s/'))
        ? clientUrl.trim()
        : currentAppsScriptUrl;

      console.log(`[AppsScriptForwarder] Action: ${payload?.action}, Target: ${targetUrl}`);

      let responseText = '';
      let remoteOk = false;
      let remoteStatus = 200;

      try {
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload),
        });
        remoteStatus = response.status;
        responseText = await response.text();
        remoteOk = response.ok;
      } catch (networkErr: any) {
        console.warn(`[AppsScriptForwarder] Remote network warning: ${networkErr.message}`);
      }

      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(responseText);
      } catch {}

      const isRemoteSuccess = remoteOk && (!parsedJson || (parsedJson.status !== 'error' && parsedJson.error !== 'Invalid action'));

      // Broadcast real-time update to all connected clients
      try {
        const act = String(payload?.action || '');
        let entity = 'all';
        if (act.includes('Fee')) entity = 'fee';
        else if (act.includes('Student')) entity = 'student';
        else if (act.includes('Notice')) entity = 'notice';
        else if (act.includes('Behavior')) entity = 'behavior';
        else if (act.includes('Homework')) entity = 'homework';
        else if (act.includes('Bus') || act.includes('Location')) entity = 'bus';

        const broadcastMsg = JSON.stringify({
          type: 'APP_DATA_UPDATED',
          action: act,
          entity,
          payload,
          timestamp: Date.now(),
        });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMsg);
          }
        }
      } catch {}

      if (isRemoteSuccess) {
        return res.json({
          success: true,
          data: parsedJson || responseText,
        });
      }

      // If remote script returned "Invalid action" or failed, but we handled it locally on the school server
      if (['deleteFee', 'addHomework', 'addBehavior', 'updateHomeworkTracker', 'updateBusTracking'].includes(payload?.action)) {
        return res.json({
          success: true,
          message: `${payload.action} school server me safe ho gaya hai (Locally saved & synced)!`,
          locallyHandled: true,
          needsScriptDeployment: true,
        });
      }

      return res.status(remoteStatus || 500).json({
        success: false,
        error: parsedJson?.message || parsedJson?.error || responseText || 'Apps Script returned error',
      });
    } catch (err: any) {
      console.error('[AppsScriptForwarder] Error:', err.message);
      return res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  // Direct HTTP broadcast endpoint (notifies all connected clients in real time)
  app.post('/api/notify-update', (req, res) => {
    try {
      const entity = req.body?.entity || 'all';
      const action = req.body?.action || '';
      const details = req.body?.details || {};

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity,
        action,
        details,
        timestamp: Date.now(),
      });

      let sentCount = 0;
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
          sentCount++;
        }
      }

      res.json({ success: true, clientsNotified: sentCount });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
          return `अस्सलाम वालेकुम! आज ${studentName} स्कूल में गैर-हाज़िर (अनुपस्थित) रहे। अल्लाह से दुआ है कि वे बाखैरियत व सेहतमंद हों। बराए मेहरबानी छूटे हुए सबक और गृहकार्य का विवरण नीचे देख लें और सेहत में सुधार होते ही उन्हें नियमित स्कूल भेजें।`;
        }
        let msg = `अस्सलाम वालेकुम! हमें यह बताते हुए बेहद खुशी हो रही है कि आज ${studentName} स्कूल में हाज़िर रहे और कक्षा की गतिविधियों में बड़े अदब व लगन के साथ हिस्सा लिया।`;
        if (teacherRemark && !teacherRemark.toLowerCase().includes('fault')) {
          msg += ` उस्ताद (शिक्षक) की टिप्पणी: "${teacherRemark}"।`;
        } else if (behaviorSummary) {
          msg += ` माशाअल्लाह, आज उनका आचरण व अनुशासन बहुत अच्छा रहा।`;
        }
        if (homeworkSummary) {
          msg += ` आज ${homeworkSummary} दिया गया है, बराए मेहरबानी शाम को इसे पूरा करवाएं।`;
        } else {
          msg += ` आज का दैनिक गृहकार्य व विवरण नीचे उपलब्ध है।`;
        }
        msg += ` अल्लाह आपके बच्चे को इल्म व नेक तरबियत से नवाज़े।`;
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

        const prompt = `तुम E.V.S. Public School (ई.वी.एस. पब्लिक स्कूल) के आत्मीय, सम्मानजनक व उत्साहवर्धक AI शिक्षा सहायक हो। यह एक इस्लामिक तहज़ीब व अदब से जुड़ा स्कूल है।
निम्नलिखित छात्र की आज (${date || 'आज'}) की विद्यालय गतिविधियों का विवरण दिया गया है:
- छात्र का नाम: ${studentName}
- उपस्थिति स्थिति: ${isAbsent ? 'अनुपस्थित (गैर-हाज़िर / Absent)' : attendanceStatus}
- आज का गृहकार्य (Homework): ${homeworkSummary || 'कोई नया गृहकार्य दर्ज नहीं है'}
- आचरण व स्वच्छता (Behavior/Conduct): ${behaviorSummary || 'सामान्य'}
- शिक्षक की टिप्पणी (Teacher Remark): ${teacherRemark || 'कोई विशेष टिप्पणी नहीं'}

विशेष निर्देश:
1. ग्रीटिंग की शुरुआत हमेशा "अस्सलाम वालेकुम" या "अस्सलाम वालेकुम व रहमतुल्लाह" से करें।
2. "नमस्ते", "सादर", "प्रणाम", "चरण स्पर्श" जैसे शब्दों का उपयोग बिल्कुल न करें।
3. अभिभावक को आदर देते हुए तहज़ीबदार, मोहब्बत भरी व शेरीन ज़बान का प्रयोग करें (जैसे "खुशी होगी", "हमें यह बताते हुए खुशी है", "माशाअल्लाह", "अल्लाह बच्चे को इल्म व नेक अमल की तौफ़ीक दे", "दुआ है")।
4. यदि छात्र गैर-हाज़िर (अनुपस्थित) है, तो उसकी सेहत व खैरियत की दुआ करें और छूटी पढ़ाई व गृहकार्य कराने की गुज़ारिश करें।
5. यदि छात्र उपस्थित था और आचरण/गृहकार्य अच्छा है, तो खुशी जाहिर करें और गृहकार्य समय पर कराने के लिए प्रेरित करें।
6. 2 से 3 वाक्यों का संक्षिप्त, मधुर व दिल छूने वाला पैराग्राफ लिखें। कोई शीर्षक, बुलेट पॉइंट या अंग्रेजी शब्द न लिखें।`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
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
        greeting: 'अस्सलाम वालेकुम! छात्र की आज की स्कूल गतिविधियां व विवरण नीचे काम की चीजों में प्रस्तुत हैं। अल्लाह आपके बच्चे को इल्म व तरक्की से नवाज़े।',
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
