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
    const targetUrl = (typeof payload?.appsScriptUrl === 'string' && payload.appsScriptUrl.trim().startsWith('https://script.google.com/macros/s/'))
      ? payload.appsScriptUrl.trim()
      : currentAppsScriptUrl;

    const formattedPayload = payload.action ? payload : {
      action: 'updateBusTracking',
      bus_id: payload.busId || payload.bus_id || '121212',
      driver_name: payload.driverName || payload.driver_name || 'Amjad',
      current_location: payload.currentLocationStr || `${payload.latitude}, ${payload.longitude}`,
      last_updated: payload.lastUpdated || new Date().toISOString(),
      speed: payload.speed || 0,
      status: payload.status || 'running',
    };

    // 1. Try POST to Google Apps Script
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(formattedPayload),
    });
    const text = await res.text();

    // 2. Fallbacks if needed
    if (text.includes('Invalid action') && formattedPayload.action === 'updateBusTracking') {
      try {
        const getUrl = `${targetUrl}?action=updateBusTracking&bus_id=${encodeURIComponent(formattedPayload.bus_id)}&driver_name=${encodeURIComponent(formattedPayload.driver_name)}&current_location=${encodeURIComponent(formattedPayload.current_location)}`;
        const gRes = await fetch(getUrl);
        const gText = await gRes.text();
        if (gText.includes('success') || gText.includes('updated')) {
          return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'addHomework' && (!res.ok || text.includes('error'))) {
      try {
        const getUrl = `${targetUrl}?action=addHomework&homework_id=${encodeURIComponent(formattedPayload.homework_id || '')}&date=${encodeURIComponent(formattedPayload.date || '')}&class_name=${encodeURIComponent(formattedPayload.class_name || formattedPayload.class || '')}&subject=${encodeURIComponent(formattedPayload.subject || '')}&detail=${encodeURIComponent(formattedPayload.detail || formattedPayload.Homework_Detail || '')}&teacher=${encodeURIComponent(formattedPayload.teacher || '')}`;
        const gRes = await fetch(getUrl);
        const gText = await gRes.text();
        if (gText.includes('success')) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'updateHomeworkTracker' && (!res.ok || text.includes('error'))) {
      try {
        const getUrl = `${targetUrl}?action=updateHomeworkTracker&record_id=${encodeURIComponent(formattedPayload.record_id || formattedPayload.id || '')}&student_id=${encodeURIComponent(formattedPayload.student_id || '')}&date=${encodeURIComponent(formattedPayload.date || '')}&class=${encodeURIComponent(formattedPayload.class || '')}&subject=${encodeURIComponent(formattedPayload.subject || '')}&status=${encodeURIComponent(formattedPayload.status || '')}`;
        const gRes = await fetch(getUrl);
        const gText = await gRes.text();
        if (gText.includes('success')) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'addBehavior' && (!res.ok || text.includes('error'))) {
      try {
        const getUrl = `${targetUrl}?action=addBehavior&behavior_id=${encodeURIComponent(formattedPayload.behavior_id || '')}&student_id=${encodeURIComponent(formattedPayload.student_id || '')}&date=${encodeURIComponent(formattedPayload.date || '')}&class=${encodeURIComponent(formattedPayload.class || '')}&is_present=${encodeURIComponent(formattedPayload.is_present || 'Present')}&is_bathed=${encodeURIComponent(formattedPayload.is_bathed || 'Yes')}&nails_clean=${encodeURIComponent(formattedPayload.nails_clean || 'Yes')}&uniform_clean=${encodeURIComponent(formattedPayload.uniform_clean || 'Yes')}&discipline=${encodeURIComponent(formattedPayload.discipline || 'Good')}&good_manners=${encodeURIComponent(formattedPayload.good_manners || '')}&remark=${encodeURIComponent(formattedPayload.remark || '')}`;
        const gRes = await fetch(getUrl);
        const gText = await gRes.text();
        if (gText.includes('success')) return { ok: true, response: gText };
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

  // Persistent deleted fee receipts, homework, and students file paths
  const DELETED_RECEIPTS_FILE = '/tmp/evs_deleted_receipts.json';
  const DELETED_HOMEWORK_FILE = '/tmp/evs_deleted_homework.json';
  const DELETED_STUDENTS_FILE = '/tmp/evs_deleted_students.json';
  const HOMEWORK_FILE = '/tmp/evs_homework.json';
  const BEHAVIOR_FILE = '/tmp/evs_behavior.json';
  const HW_TRACKER_FILE = '/tmp/evs_hw_tracker.json';
  const STAFF_ATTENDANCE_FILE = '/tmp/evs_staff_attendance.json';
  const SCHOOL_LOCATION_FILE = '/tmp/evs_school_location.json';
  const SCHOOL_SHIFT_SETTINGS_FILE = '/tmp/evs_school_shift_settings.json';

  const DEFAULT_SCHOOL_LOCATION = {
    lat: 30.078676,
    lng: 77.469929,
    radiusMeters: 4000,
    name: 'EVS PUBLIC SCHOOL, Chilkana Sultanpur',
    address: 'Saharanpur road, Chilkana Sultanpur, Chilkana, Uttar Pradesh 247231',
    mapsUrl: 'https://maps.app.goo.gl/TCqvnXrQN2326Lpp6',
    geofenceEnabled: true,
    updated_at: new Date().toISOString(),
    updated_by: 'School Location Registered',
  };

  const DEFAULT_SCHOOL_SHIFT_SETTINGS = {
    schoolOpeningTime: '08:00 AM',
    schoolClosingTime: '02:00 PM',
    graceMinutes: 15,
    overtimeThresholdMinutes: 15,
    fullDayMinHours: 5.5,
    halfDayMinHours: 3.0,
    updated_at: new Date().toISOString(),
    updated_by: 'Default Schedule',
  };

  const getSchoolShiftSettings = () => {
    try {
      if (fs.existsSync(SCHOOL_SHIFT_SETTINGS_FILE)) {
        return { ...DEFAULT_SCHOOL_SHIFT_SETTINGS, ...JSON.parse(fs.readFileSync(SCHOOL_SHIFT_SETTINGS_FILE, 'utf-8')) };
      }
    } catch (e) {
      console.warn('Error reading school shift settings file:', e);
    }
    return DEFAULT_SCHOOL_SHIFT_SETTINGS;
  };

  const saveSchoolShiftSettings = (body: any) => {
    const current = getSchoolShiftSettings();
    const updated = {
      ...current,
      schoolOpeningTime: body.schoolOpeningTime || current.schoolOpeningTime || '08:00 AM',
      schoolClosingTime: body.schoolClosingTime || current.schoolClosingTime || '02:00 PM',
      graceMinutes: typeof body.graceMinutes === 'number' ? body.graceMinutes : current.graceMinutes,
      overtimeThresholdMinutes: typeof body.overtimeThresholdMinutes === 'number' ? body.overtimeThresholdMinutes : current.overtimeThresholdMinutes,
      fullDayMinHours: typeof body.fullDayMinHours === 'number' ? body.fullDayMinHours : current.fullDayMinHours,
      halfDayMinHours: typeof body.halfDayMinHours === 'number' ? body.halfDayMinHours : current.halfDayMinHours,
      updated_at: new Date().toISOString(),
      updated_by: body.updated_by || 'Manager',
    };
    try {
      fs.writeFileSync(SCHOOL_SHIFT_SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error writing school shift settings file:', e);
    }
    return updated;
  };

  const getSchoolLocation = () => {
    try {
      if (fs.existsSync(SCHOOL_LOCATION_FILE)) {
        return { ...DEFAULT_SCHOOL_LOCATION, ...JSON.parse(fs.readFileSync(SCHOOL_LOCATION_FILE, 'utf-8')) };
      }
    } catch (e) {
      console.warn('Error reading school location file:', e);
    }
    return DEFAULT_SCHOOL_LOCATION;
  };

  const saveSchoolLocation = (body: any) => {
    const current = getSchoolLocation();
    const updated = {
      lat: typeof body.lat === 'number' ? body.lat : current.lat,
      lng: typeof body.lng === 'number' ? body.lng : current.lng,
      radiusMeters: typeof body.radiusMeters === 'number' ? body.radiusMeters : current.radiusMeters,
      name: body.name || current.name || 'EVS PUBLIC SCHOOL, Chilkana Sultanpur',
      address: body.address || current.address || 'Saharanpur road, Chilkana Sultanpur, Chilkana, Uttar Pradesh 247231',
      mapsUrl: body.mapsUrl || current.mapsUrl || 'https://maps.app.goo.gl/TCqvnXrQN2326Lpp6',
      geofenceEnabled: body.geofenceEnabled !== undefined ? Boolean(body.geofenceEnabled) : current.geofenceEnabled,
      updated_at: new Date().toISOString(),
      updated_by: body.updated_by || 'Manager',
    };
    try {
      fs.writeFileSync(SCHOOL_LOCATION_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error writing school location file:', e);
    }
    return updated;
  };

  // Persistent deleted students
  const getDeletedStudents = (): string[] => {
    try {
      if (fs.existsSync(DELETED_STUDENTS_FILE)) {
        const content = fs.readFileSync(DELETED_STUDENTS_FILE, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
      console.warn('Error reading deleted students file:', e);
    }
    return [];
  };

  const saveDeletedStudent = (studentId: string): string[] => {
    const clean = String(studentId || '').trim().toLowerCase();
    if (!clean) return getDeletedStudents();
    const list = getDeletedStudents();
    if (!list.includes(clean)) {
      list.push(clean);
      try {
        fs.writeFileSync(DELETED_STUDENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
      } catch (e) {
        console.warn('Error saving deleted student:', e);
      }
    }
    return list;
  };

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

  // Persistent deleted homework
  const getDeletedHomework = (): string[] => {
    try {
      if (fs.existsSync(DELETED_HOMEWORK_FILE)) {
        const content = fs.readFileSync(DELETED_HOMEWORK_FILE, 'utf-8');
        return JSON.parse(content);
      }
    } catch (e) {
      console.warn('Error reading deleted homework file:', e);
    }
    return [];
  };

  const saveDeletedHomework = (idOrKey: string): string[] => {
    const clean = String(idOrKey || '').trim().toLowerCase();
    if (!clean) return getDeletedHomework();
    const list = getDeletedHomework();
    if (!list.includes(clean)) {
      list.push(clean);
      try {
        fs.writeFileSync(DELETED_HOMEWORK_FILE, JSON.stringify(list, null, 2), 'utf-8');
      } catch (e) {
        console.warn('Error saving deleted homework:', e);
      }
    }
    return list;
  };

  // Persistent Homework Storage
  const getHomeworkList = (): any[] => {
    try {
      if (fs.existsSync(HOMEWORK_FILE)) {
        const raw = JSON.parse(fs.readFileSync(HOMEWORK_FILE, 'utf-8'));
        const deleted = getDeletedHomework();
        if (deleted.length > 0) {
          return raw.filter((h: any) => {
            const hwId = String(h.Homework_ID || '').trim().toLowerCase();
            const composite = `${h.Date}_${h.Class}_${h.Subject}_${h.Homework_Detail}`.trim().toLowerCase();
            return !deleted.includes(hwId) && !deleted.includes(composite);
          });
        }
        return raw;
      }
    } catch (e) {
      console.warn('Error reading homework file:', e);
    }
    return [];
  };

  const deleteHomeworkItem = (idOrKey: string): any[] => {
    const clean = String(idOrKey || '').trim().toLowerCase();
    if (clean) saveDeletedHomework(clean);
    const list = getHomeworkList();
    const filtered = list.filter((h) => {
      const hwId = String(h.Homework_ID || '').trim().toLowerCase();
      const composite = `${h.Date}_${h.Class}_${h.Subject}_${h.Homework_Detail}`.trim().toLowerCase();
      return hwId !== clean && composite !== clean;
    });
    try {
      fs.writeFileSync(HOMEWORK_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving homework file after delete:', e);
    }
    return filtered;
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
    const items = Array.isArray(item)
      ? item
      : item && Array.isArray(item.behavior)
      ? item.behavior
      : [item];

    for (const it of items) {
      if (!it) continue;
      const sId = String(it.student_id || it.Student_ID || '').trim();
      const dt = it.date || it.Date || new Date().toISOString().split('T')[0];
      const bId = String(it.behavior_id || it.Behavior_ID || (sId ? `BEH-${sId}-${dt}` : `BEH-${Date.now()}`));
      const normalized = {
        Behavior_ID: bId,
        Student_ID: sId,
        Date: dt,
        Class: it.class || it.Class || '',
        Is_Bathed: it.is_bathed ?? it.Is_Bathed ?? true,
        Nails_Clean: it.nails_clean ?? it.Nails_Clean ?? true,
        Uniform_clean: it.uniform_clean ?? it.Uniform_clean ?? true,
        Good_Manners: it.good_manners || it.Good_Manners || 'Good',
        Discipline: it.discipline ?? it.Discipline ?? true,
        Is_Present: it.is_present ?? it.Is_Present ?? true,
        Remark: it.remark || it.Remark || '',
        AI_Feedback: it.ai_feedback || it.AI_Feedback || '',
      };
      const idx = list.findIndex(
        (b) => b.Behavior_ID === bId || (sId && String(b.Student_ID || '').trim() === sId && b.Date === dt)
      );
      if (idx >= 0) {
        list[idx] = normalized;
      } else {
        list.unshift(normalized);
      }
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

  // Persistent Staff Attendance Storage
  const getStaffAttendanceList = (): any[] => {
    try {
      if (fs.existsSync(STAFF_ATTENDANCE_FILE)) {
        return JSON.parse(fs.readFileSync(STAFF_ATTENDANCE_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('Error reading staff attendance file:', e);
    }
    return [];
  };

  const saveStaffAttendanceRecord = (item: any): any[] => {
    const list = getStaffAttendanceList();
    const userId = String(item.user_id || item.User_ID || '').trim();
    const date = item.date || item.Date || new Date().toISOString().split('T')[0];
    const recId = String(item.id || item.ID || `STAFF-ATT-${userId}-${date}`);
    
    const nowTimeStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

    const normalized = {
      id: recId,
      user_id: userId,
      username: item.username || item.Username || '',
      name: item.name || item.Name || 'Staff Member',
      designation: item.designation || item.Designation || 'Teacher',
      date,
      check_in_time: item.check_in_time || item.Check_In_Time || nowTimeStr,
      check_out_time: item.check_out_time || item.Check_Out_Time || null,
      status: item.status || 'Present',
      method: item.method || 'School QR Scan',
      school_code: item.school_code || 'EVS-CAMPUS-2026',
      location: item.location || 'School Campus Gate',
      remark: item.remark || item.Note || '',
      timestamp: item.timestamp || Date.now(),
      created_at: item.created_at || new Date().toISOString(),
    };

    const idx = list.findIndex(
      (a) => a.id === recId || (userId && a.user_id && a.user_id.toLowerCase() === userId.toLowerCase() && a.date === date)
    );

    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        ...normalized,
        // preserve original check_in_time if already set
        check_in_time: list[idx].check_in_time || normalized.check_in_time,
        // preserve original check_out_time if not explicitly updating it
        check_out_time: normalized.check_out_time || list[idx].check_out_time || null,
      };
    } else {
      list.unshift(normalized);
    }

    try {
      fs.writeFileSync(STAFF_ATTENDANCE_FILE, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving staff attendance file:', e);
    }

    // Forward asynchronously to Google Apps Script if active
    forwardToGoogleAppsScript({
      action: 'recordStaffAttendance',
      user_id: normalized.user_id,
      name: normalized.name,
      designation: normalized.designation,
      date: normalized.date,
      check_in_time: normalized.check_in_time,
      check_out_time: normalized.check_out_time || '',
      status: normalized.status,
      method: normalized.method,
      last_updated: new Date().toISOString(),
    }).catch(() => {});

    return list;
  };

  // Endpoints for Local Server Data
  app.get('/api/homework', (_req, res) => {
    res.json({ homework: getHomeworkList() });
  });

  app.post('/api/homework', (req, res) => {
    const item = req.body;
    const list = saveHomeworkItem(item);
    forwardToGoogleAppsScript({
      action: 'addHomework',
      appsScriptUrl: item.appsScriptUrl || req.headers['x-apps-script-url'],
      ...item,
    }).catch(() => {});
    res.json({ success: true, homework: list });
  });

  app.get('/api/behavior', (_req, res) => {
    res.json({ behavior: getBehaviorList() });
  });

  app.post('/api/behavior', async (req, res) => {
    const item = req.body;
    const list = saveBehaviorItem(item);
    const targetScriptUrl = item.appsScriptUrl || req.headers['x-apps-script-url'] || currentAppsScriptUrl;

    const items: any[] = Array.isArray(item)
      ? item
      : Array.isArray(item.behavior)
      ? item.behavior
      : Array.isArray(item.records)
      ? item.records
      : [item];

    // 1. Send as batchAddBehavior so Apps Script processes all at once
    forwardToGoogleAppsScript({
      action: 'batchAddBehavior',
      records: items,
      appsScriptUrl: targetScriptUrl,
    }).catch(() => {});

    // 2. Also forward individual records sequentially to ensure 100% sheet sync without lock contention
    (async () => {
      for (const rec of items) {
        if (!rec) continue;
        const sid = rec.student_id || rec.Student_ID;
        if (!sid) continue;

        const isPresStr = (rec.is_present === false || rec.Is_Present === false || String(rec.is_present || '').toLowerCase() === 'absent') ? 'Absent' : 'Present';
        const isBathedStr = (rec.is_bathed === false || rec.Is_Bathed === false || String(rec.is_bathed || '').toLowerCase() === 'no') ? 'No' : 'Yes';
        const nailsCleanStr = (rec.nails_clean === false || rec.Nails_Clean === false || String(rec.nails_clean || '').toLowerCase() === 'no') ? 'No' : 'Yes';
        const uniformCleanStr = (rec.uniform_clean === false || rec.Uniform_clean === false || String(rec.uniform_clean || '').toLowerCase() === 'no') ? 'No' : 'Yes';
        const disciplineStr = (rec.discipline === false || rec.Discipline === false || String(rec.discipline || '').toLowerCase() === 'needs improvement') ? 'Needs Improvement' : 'Good';

        try {
          await forwardToGoogleAppsScript({
            action: 'addBehavior',
            behavior_id: rec.behavior_id || rec.Behavior_ID || `BEH-${sid}-${rec.date || rec.Date}`,
            student_id: sid,
            date: rec.date || rec.Date,
            class: rec.class || rec.Class,
            is_bathed: isBathedStr,
            nails_clean: nailsCleanStr,
            uniform_clean: uniformCleanStr,
            good_manners: rec.good_manners || rec.Good_Manners || (isPresStr === 'Absent' ? 'लागू नहीं (अनुपस्थित)' : 'उत्कृष्ट (Excellent)'),
            discipline: disciplineStr,
            is_present: isPresStr,
            remark: rec.remark || rec.Remark || '',
            ai_feedback: rec.ai_feedback || rec.AI_Feedback || '',
            appsScriptUrl: targetScriptUrl,
          });
          // Small delay to prevent Apps Script spreadsheet lock timeout
          await new Promise((r) => setTimeout(r, 120));
        } catch (fErr) {
          console.warn(`[AppsScriptForwarder] Error forwarding behavior for ${sid}:`, fErr);
        }
      }
    })();

    res.json({ success: true, behavior: list });
  });

  app.get('/api/homework-tracker', (_req, res) => {
    res.json({ records: getHwTrackerList() });
  });

  app.post('/api/homework-tracker', (req, res) => {
    const item = req.body;
    if (item.action === 'bulkUpdateHomeworkTracker' && Array.isArray(item.student_ids)) {
      const cleanDate = item.date || new Date().toISOString().split('T')[0];
      const hwClass = item.class || '';
      const hwSubject = item.subject || 'General';
      const targetStatus = item.status || 'Completed';
      const scriptUrl = item.appsScriptUrl || req.headers['x-apps-script-url'];

      for (const sId of item.student_ids) {
        const singlePayload = {
          action: 'updateHomeworkTracker',
          record_id: `TRK-${sId}-${cleanDate}`,
          student_id: sId,
          date: cleanDate,
          class: hwClass,
          subject: hwSubject,
          status: targetStatus,
          appsScriptUrl: scriptUrl,
        };
        saveHwTrackerItem(singlePayload);
        forwardToGoogleAppsScript(singlePayload).catch(() => {});
      }
      return res.json({ success: true, message: `Bulk updated ${item.student_ids.length} students in sheet` });
    }

    const list = saveHwTrackerItem(item);
    forwardToGoogleAppsScript({
      action: 'updateHomeworkTracker',
      appsScriptUrl: item.appsScriptUrl || req.headers['x-apps-script-url'],
      ...item,
    }).catch(() => {});
    res.json({ success: true, records: list });
  });

  // Endpoints for Staff Attendance
  app.get('/api/staff-attendance', (_req, res) => {
    res.json({ records: getStaffAttendanceList() });
  });

  app.post('/api/staff-attendance', (req, res) => {
    const item = req.body;
    const list = saveStaffAttendanceRecord(item);
    res.json({ success: true, records: list });
  });

  app.post('/api/staff-attendance/checkin', (req, res) => {
    const item = req.body;
    const list = saveStaffAttendanceRecord({
      ...item,
      method: item.method || 'School QR Scan',
      status: item.status || 'Present',
    });

    // Forward to Google Apps Script
    const forwardPayload = {
      action: 'recordStaffAttendance',
      ...item,
    };
    fetch(currentAppsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(forwardPayload),
    }).catch((e) => console.warn('Server forward staff attendance err:', e));

    res.json({ success: true, records: list });
  });

  // Endpoints for School Campus GPS Location
  app.get('/api/school-location', (_req, res) => {
    res.json(getSchoolLocation());
  });

  app.post('/api/school-location', (req, res) => {
    try {
      const updated = saveSchoolLocation(req.body);
      res.json({ success: true, location: updated });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Failed to update school location' });
    }
  });

  // Endpoints for School Shift Timing & Late/Overtime Rules
  app.get('/api/school-shift-settings', (_req, res) => {
    res.json(getSchoolShiftSettings());
  });

  app.post('/api/school-shift-settings', (req, res) => {
    try {
      const updated = saveSchoolShiftSettings(req.body);
      res.json({ success: true, settings: updated });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Failed to update school shift settings' });
    }
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

  // Get list of deleted homework IDs & keys
  app.get('/api/deleted-homework', (_req, res) => {
    res.json({ deleted: getDeletedHomework() });
  });

  // Add a deleted homework ID / key
  app.post('/api/deleted-homework', (req, res) => {
    const id = req.body?.id || req.body?.homework_id || req.body?.key;
    const list = saveDeletedHomework(id);
    if (req.body?.composite_key) {
      saveDeletedHomework(req.body.composite_key);
    }
    if (id) {
      deleteHomeworkItem(id);
    }
    res.json({ success: true, deleted: list });
  });

  // Delete homework endpoint
  app.delete('/api/homework/:id', (req, res) => {
    const { id } = req.params;
    const list = deleteHomeworkItem(id);
    res.json({ success: true, homework: list });
  });

  app.post('/api/homework/delete', (req, res) => {
    const id = req.body?.id || req.body?.homework_id;
    const compositeKey = req.body?.composite_key;
    if (id) deleteHomeworkItem(id);
    if (compositeKey) deleteHomeworkItem(compositeKey);
    res.json({ success: true });
  });

  // Get list of deleted students
  app.get('/api/deleted-students', (_req, res) => {
    res.json({ students: getDeletedStudents() });
  });

  // Add a deleted student ID
  app.post('/api/deleted-students', (req, res) => {
    const sId = req.body?.student_id || req.body?.studentId || req.body?.id;
    const list = saveDeletedStudent(sId);
    res.json({ success: true, students: list });
  });

  // Delete student endpoint
  app.delete('/api/students/:id', (req, res) => {
    const { id } = req.params;
    const list = saveDeletedStudent(id);
    res.json({ success: true, students: list });
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
      } else if (payload?.action === 'deleteStudent') {
        const sid = payload?.student_id || payload?.studentId;
        if (sid) saveDeletedStudent(sid);
      } else if (payload?.action === 'deleteHomework') {
        if (payload?.homework_id) deleteHomeworkItem(payload.homework_id);
        if (payload?.composite_key) deleteHomeworkItem(payload.composite_key);
      } else if (payload?.action === 'addHomework') {
        saveHomeworkItem(payload);
      } else if (payload?.action === 'addBehavior') {
        const isPresStr = (payload.is_present === false || payload.Is_Present === false || String(payload.is_present || '').toLowerCase() === 'absent') ? 'Absent' : 'Present';
        const isBathedStr = (payload.is_bathed === false || payload.Is_Bathed === false || String(payload.is_bathed || '').toLowerCase() === 'no') ? 'No' : 'Yes';
        const nailsCleanStr = (payload.nails_clean === false || payload.Nails_Clean === false || String(payload.nails_clean || '').toLowerCase() === 'no') ? 'No' : 'Yes';
        const uniformCleanStr = (payload.uniform_clean === false || payload.Uniform_clean === false || String(payload.uniform_clean || '').toLowerCase() === 'no') ? 'No' : 'Yes';
        const disciplineStr = (payload.discipline === false || payload.Discipline === false || String(payload.discipline || '').toLowerCase() === 'needs improvement') ? 'Needs Improvement' : 'Good';
        payload.is_present = isPresStr;
        payload.Is_Present = isPresStr === 'Present';
        payload.is_bathed = isBathedStr;
        payload.Is_Bathed = isBathedStr === 'Yes';
        payload.nails_clean = nailsCleanStr;
        payload.Nails_Clean = nailsCleanStr === 'Yes';
        payload.uniform_clean = uniformCleanStr;
        payload.Uniform_clean = uniformCleanStr === 'Yes';
        payload.discipline = disciplineStr;
        payload.Discipline = disciplineStr === 'Good';
        saveBehaviorItem(payload);
      } else if (payload?.action === 'batchAddBehavior' && (Array.isArray(payload?.records) || Array.isArray(payload?.behavior))) {
        const bItems = payload.records || payload.behavior;
        for (const b of bItems) {
          saveBehaviorItem(b);
        }
      } else if (payload?.action === 'updateHomeworkTracker') {
        saveHwTrackerItem(payload);
      } else if (payload?.action === 'bulkUpdateHomeworkTracker' && Array.isArray(payload?.student_ids)) {
        const cleanDate = payload.date || new Date().toISOString().split('T')[0];
        const hwClass = payload.class || '';
        const hwSubject = payload.subject || 'General';
        const targetStatus = payload.status || 'Completed';
        for (const sId of payload.student_ids) {
          const itemPayload = {
            action: 'updateHomeworkTracker',
            record_id: `TRK-${sId}-${cleanDate}`,
            student_id: sId,
            date: cleanDate,
            class: hwClass,
            subject: hwSubject,
            status: targetStatus,
          };
          saveHwTrackerItem(itemPayload);
        }
      } else if (payload?.action === 'updateBusTracking') {
        processTelemetryPayload(payload);
      } else if (payload?.action === 'recordStaffAttendance' || payload?.action === 'addStaffAttendance') {
        saveStaffAttendanceRecord(payload);
      }

      // Check if client provided a specific custom URL in payload or headers
      const clientUrl = payload?.appsScriptUrl || req.headers['x-apps-script-url'];
      const targetUrl = (typeof clientUrl === 'string' && clientUrl.trim().startsWith('https://script.google.com/macros/s/'))
        ? clientUrl.trim()
        : currentAppsScriptUrl;

      // Update currentAppsScriptUrl cache if client provided a valid URL
      if (typeof clientUrl === 'string' && clientUrl.trim().startsWith('https://script.google.com/macros/s/')) {
        currentAppsScriptUrl = clientUrl.trim();
        try {
          fs.writeFileSync(URL_CONFIG_FILE, currentAppsScriptUrl, 'utf-8');
        } catch {}
      }

      console.log(`[AppsScriptForwarder] Action: ${payload?.action}, Target: ${targetUrl}`);

      // If bulk update, also send individual items to Apps Script targetUrl
      if (payload?.action === 'bulkUpdateHomeworkTracker' && Array.isArray(payload?.student_ids)) {
        const cleanDate = payload.date || new Date().toISOString().split('T')[0];
        const hwClass = payload.class || '';
        const hwSubject = payload.subject || 'General';
        const targetStatus = payload.status || 'Completed';
        for (const sId of payload.student_ids) {
          const itemPayload = {
            action: 'updateHomeworkTracker',
            record_id: `TRK-${sId}-${cleanDate}`,
            student_id: sId,
            date: cleanDate,
            class: hwClass,
            subject: hwSubject,
            status: targetStatus,
          };
          fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(itemPayload),
          }).catch(() => {});
        }
      }

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
      if (['deleteFee', 'deleteStudent', 'deleteHomework', 'addHomework', 'addBehavior', 'batchAddBehavior', 'updateHomeworkTracker', 'updateBusTracking'].includes(payload?.action)) {
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
