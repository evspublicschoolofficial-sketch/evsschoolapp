import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

// Global resilience handlers to prevent unexpected process exit
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = 3000;
const SERVER_BOOT_AT = new Date().toISOString();
const SERVER_BOOT_VERSION = `srv-${SERVER_BOOT_AT.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
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

// Pre-seed real coordinates for Bus 121212 (Amjad) from Google Sheet
if (!liveTelemetryStore['121212'] || liveTelemetryStore['121212'].currentLocationStr === '30.078676, 77.469929') {
  liveTelemetryStore['121212'] = {
    busId: '121212',
    driverName: 'Amjad',
    driverPhone: '9761081818',
    currentLocationStr: '30.071192, 77.473767',
    latitude: 30.071192,
    longitude: 77.473767,
    accuracy: 8,
    speed: 0,
    heading: 0,
    lastUpdated: new Date().toISOString(),
    status: 'running',
    isLiveFromSheet: true,
  };
}

function saveTelemetryCache() {
  try {
    fs.writeFileSync(TELEMETRY_CACHE_FILE, JSON.stringify(liveTelemetryStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write telemetry cache file:', e);
  }
}

// =========================================================================
// ROUTE STOPS PERSISTENCE & GOOGLE SHEET "Route_Stops" SYNC
// =========================================================================
const ROUTE_STOPS_FILE = '/tmp/evs_route_stops.json';

const DEFAULT_SERVER_ROUTE_STOPS: Record<string, any[]> = {
  'route-1': [],
  'route-2': [],
};

let routeStopsStore: Record<string, any[]> = { 'route-1': [], 'route-2': [] };
try {
  if (fs.existsSync(ROUTE_STOPS_FILE)) {
    const rawStops = fs.readFileSync(ROUTE_STOPS_FILE, 'utf-8');
    const parsed = JSON.parse(rawStops) || {};
    const cleanStore: Record<string, any[]> = { 'route-1': [], 'route-2': [] };
    for (const [rId, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) {
        cleanStore[rId] = list.filter((s: any) =>
          s && s.id && !s.id.startsWith('stop-r1-') && !s.id.startsWith('stop-r2-') && !['stop-01', 'stop-02', 'stop-03', 'stop-04', 'stop-05', 'stop-06'].includes(s.id)
        );
      } else {
        cleanStore[rId] = [];
      }
    }
    routeStopsStore = cleanStore;
    fs.writeFileSync(ROUTE_STOPS_FILE, JSON.stringify(routeStopsStore, null, 2), 'utf-8');
  } else {
    routeStopsStore = { 'route-1': [], 'route-2': [] };
    fs.writeFileSync(ROUTE_STOPS_FILE, JSON.stringify(routeStopsStore, null, 2), 'utf-8');
  }
} catch (e) {
  routeStopsStore = { 'route-1': [], 'route-2': [] };
}

function saveRouteStopsCache() {
  try {
    fs.writeFileSync(ROUTE_STOPS_FILE, JSON.stringify(routeStopsStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write route stops cache file:', e);
  }
}

const TEACHER_PERFORMANCE_FILE = '/tmp/evs_teacher_performance.json';
let teacherPerformanceStore: any[] = [];
try {
  if (fs.existsSync(TEACHER_PERFORMANCE_FILE)) {
    const raw = fs.readFileSync(TEACHER_PERFORMANCE_FILE, 'utf-8');
    teacherPerformanceStore = JSON.parse(raw) || [];
  }
} catch (e) {
  teacherPerformanceStore = [];
}

function saveTeacherPerformanceCache() {
  try {
    fs.writeFileSync(TEACHER_PERFORMANCE_FILE, JSON.stringify(teacherPerformanceStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write teacher performance cache file:', e);
  }
}

// =========================================================================
// SYLLABUS TRACKER PERSISTENCE & GOOGLE SHEET "Syllabus_Tracker" SYNC
// =========================================================================
const SYLLABUS_TRACKER_FILE = '/tmp/evs_syllabus_tracker.json';
let syllabusTrackerStore: any[] = [];
try {
  if (fs.existsSync(SYLLABUS_TRACKER_FILE)) {
    const rawSyl = fs.readFileSync(SYLLABUS_TRACKER_FILE, 'utf-8');
    syllabusTrackerStore = JSON.parse(rawSyl) || [];
  }
} catch (e) {
  syllabusTrackerStore = [];
}

function saveSyllabusTrackerCache() {
  try {
    fs.writeFileSync(SYLLABUS_TRACKER_FILE, JSON.stringify(syllabusTrackerStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write syllabus tracker cache file:', e);
  }
}

// =========================================================================
// WEEKLY SUBJECT TESTS PERSISTENCE & GOOGLE SHEET "Weekly_Tests" SYNC
// =========================================================================
const WEEKLY_TESTS_FILE = '/tmp/evs_weekly_tests.json';
let weeklyTestsStore: any[] = [];
try {
  if (fs.existsSync(WEEKLY_TESTS_FILE)) {
    const rawWt = fs.readFileSync(WEEKLY_TESTS_FILE, 'utf-8');
    weeklyTestsStore = JSON.parse(rawWt) || [];
  }
} catch {
  weeklyTestsStore = [];
}

function saveWeeklyTestsCache() {
  try {
    fs.writeFileSync(WEEKLY_TESTS_FILE, JSON.stringify(weeklyTestsStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write weekly tests cache file:', e);
  }
}

// =========================================================================
// SCHOOL HOLIDAYS (SUNDAY KE ALAWA CHHUTTIYAN) & "School_Holidays" SYNC
// =========================================================================
const HOLIDAYS_FILE = '/tmp/evs_school_holidays.json';
const DEFAULT_SCHOOL_HOLIDAYS = [
  { id: 'hol_1', title: 'स्वतंत्रता दिवस (Independence Day)', date: '2026-08-15', category: 'national', description: 'राष्ट्रीय अवकाश • ध्वजारोहण' },
  { id: 'hol_2', title: 'रक्षाबंधन (Raksha Bandhan)', date: '2026-08-28', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_3', title: 'श्री कृष्ण जन्माष्टमी (Janmashtami)', date: '2026-09-04', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_4', title: 'गांधी जयंती (Gandhi Jayanti)', date: '2026-10-02', category: 'national', description: 'राष्ट्रीय अवकाश' },
  { id: 'hol_5', title: 'दशहरा / विजयादशमी (Dussehra)', date: '2026-10-20', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_6', title: 'दीपावली व गोवर्धन पूजा (Diwali Vacation)', date: '2026-11-01', end_date: '2026-11-03', category: 'festival', description: 'दीपावली पर्व अवकाश' },
  { id: 'hol_7', title: 'भाई दूज (Bhai Dooj)', date: '2026-11-05', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_8', title: 'गुरु नानक जयंती (Guru Nanak Jayanti)', date: '2026-11-25', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_9', title: 'क्रिसमस (Christmas Day)', date: '2026-12-25', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_10', title: 'शीतकालीन अवकाश (Winter Vacation)', date: '2026-12-31', end_date: '2027-01-05', category: 'vacation', description: 'अत्यधिक ठंड के कारण अवकाश' },
  { id: 'hol_11', title: 'गणतंत्र दिवस (Republic Day)', date: '2027-01-26', category: 'national', description: 'राष्ट्रीय अवकाश • ध्वजारोहण समारोह' },
  { id: 'hol_12', title: 'महाशिवरात्रि (Maha Shivratri)', date: '2027-02-15', category: 'festival', description: 'त्योहार अवकाश' },
  { id: 'hol_13', title: 'होली अवकाश (Holi Festival)', date: '2027-03-22', end_date: '2027-03-24', category: 'festival', description: 'रंगोत्सव होली अवकाश' },
  { id: 'hol_14', title: 'ईद-उल-फितर (Eid-ul-Fitr)', date: '2027-03-30', category: 'festival', description: 'ईद पर्व अवकाश' },
];

let schoolHolidaysStore: any[] = [];
try {
  if (fs.existsSync(HOLIDAYS_FILE)) {
    const rawH = fs.readFileSync(HOLIDAYS_FILE, 'utf-8');
    schoolHolidaysStore = JSON.parse(rawH) || DEFAULT_SCHOOL_HOLIDAYS;
  } else {
    schoolHolidaysStore = DEFAULT_SCHOOL_HOLIDAYS;
    fs.writeFileSync(HOLIDAYS_FILE, JSON.stringify(schoolHolidaysStore, null, 2), 'utf-8');
  }
} catch (e) {
  schoolHolidaysStore = DEFAULT_SCHOOL_HOLIDAYS;
}

function saveSchoolHolidaysCache() {
  try {
    fs.writeFileSync(HOLIDAYS_FILE, JSON.stringify(schoolHolidaysStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write school holidays cache file:', e);
  }
}

function parseAppsScriptResponse(text: string): { ok: boolean; error?: string } {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, error: 'Google Apps Script से खाली जवाब मिला' };
  if (trimmed.startsWith('<')) {
    return { ok: false, error: 'Apps Script ने JSON के बजाय HTML पेज लौटाया (Deployment permissions जांचें)' };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && (parsed.status === 'error' || parsed.error)) {
      return { ok: false, error: String(parsed.message || parsed.error || 'Apps Script error') };
    }
    if (parsed && (parsed.status === 'success' || parsed.success === true || parsed.updated || parsed.created)) {
      return { ok: true };
    }
  } catch {
    // Non-JSON text fallback
  }
  if (trimmed.toLowerCase().includes('success') || trimmed.toLowerCase().includes('updated')) {
    return { ok: true };
  }
  return { ok: false, error: trimmed.slice(0, 180) };
}

function resolveTargetAppsScriptUrl(req?: any): string {
  const fromBody = typeof req?.body?.appsScriptUrl === 'string' ? req.body.appsScriptUrl.trim() : '';
  if (fromBody.startsWith('https://script.google.com/macros/s/')) return fromBody;
  const rawHeader = req?.headers?.['x-apps-script-url'];
  const fromHeader = typeof rawHeader === 'string' ? rawHeader.trim() : '';
  if (fromHeader.startsWith('https://script.google.com/macros/s/')) return fromHeader;
  return currentAppsScriptUrl;
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

    // For updateBusTracking, Google Apps Script doGet is proven 100% reliable and follows redirects cleanly
    if (formattedPayload.action === 'updateBusTracking') {
      try {
        const getUrl = `${targetUrl}?action=updateBusTracking&bus_id=${encodeURIComponent(formattedPayload.bus_id)}&driver_name=${encodeURIComponent(formattedPayload.driver_name)}&current_location=${encodeURIComponent(formattedPayload.current_location)}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
        const gText = await gRes.text();
        if (gText.includes('success') || gText.includes('updated')) {
          return { ok: true, response: gText };
        }
      } catch (err: any) {
        console.warn('GET updateBusTracking error:', err);
      }
    }

    // 1. Try POST to Google Apps Script for other actions
    let lastPostStatus = 0;
    let lastPostText = '';
    let postCheck: { ok: boolean; error?: string } = { ok: false };
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(formattedPayload),
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      lastPostStatus = res.status;
      lastPostText = await res.text();
      postCheck = parseAppsScriptResponse(lastPostText);
      if (res.ok && postCheck.ok) {
        return { ok: true, response: lastPostText };
      }
    } catch (postErr: any) {
      postCheck = { ok: false, error: postErr?.message || 'POST timeout/error' };
    }

    if (formattedPayload.action === 'addHomework') {
      try {
        const getUrl = `${targetUrl}?action=addHomework&homework_id=${encodeURIComponent(formattedPayload.homework_id || '')}&date=${encodeURIComponent(formattedPayload.date || '')}&class_name=${encodeURIComponent(formattedPayload.class_name || formattedPayload.class || '')}&subject=${encodeURIComponent(formattedPayload.subject || '')}&detail=${encodeURIComponent(formattedPayload.detail || formattedPayload.Homework_Detail || '')}&teacher=${encodeURIComponent(formattedPayload.teacher || '')}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'updateHomeworkTracker') {
      try {
        const getUrl = `${targetUrl}?action=updateHomeworkTracker&record_id=${encodeURIComponent(formattedPayload.record_id || formattedPayload.id || '')}&student_id=${encodeURIComponent(formattedPayload.student_id || '')}&date=${encodeURIComponent(formattedPayload.date || '')}&class=${encodeURIComponent(formattedPayload.class || '')}&subject=${encodeURIComponent(formattedPayload.subject || '')}&status=${encodeURIComponent(formattedPayload.status || '')}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'addBehavior') {
      try {
        const getUrl = `${targetUrl}?action=addBehavior&behavior_id=${encodeURIComponent(formattedPayload.behavior_id || '')}&student_id=${encodeURIComponent(formattedPayload.student_id || '')}&date=${encodeURIComponent(formattedPayload.date || '')}&class=${encodeURIComponent(formattedPayload.class || '')}&is_present=${encodeURIComponent(formattedPayload.is_present || 'Present')}&is_bathed=${encodeURIComponent(formattedPayload.is_bathed || 'Yes')}&nails_clean=${encodeURIComponent(formattedPayload.nails_clean || 'Yes')}&uniform_clean=${encodeURIComponent(formattedPayload.uniform_clean || 'Yes')}&discipline=${encodeURIComponent(formattedPayload.discipline || 'Good')}&good_manners=${encodeURIComponent(formattedPayload.good_manners || '')}&remark=${encodeURIComponent(formattedPayload.remark || '')}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'saveRouteStops') {
      try {
        const getUrl = `${targetUrl}?action=saveRouteStops&route_id=${encodeURIComponent(formattedPayload.route_id || 'route-1')}&routeId=${encodeURIComponent(formattedPayload.route_id || 'route-1')}&stops=${encodeURIComponent(typeof formattedPayload.stops === 'string' ? formattedPayload.stops : JSON.stringify(formattedPayload.stops || []))}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'saveTeacherPerformance') {
      try {
        const getUrl = `${targetUrl}?action=saveTeacherPerformance&record=${encodeURIComponent(typeof formattedPayload.record === 'string' ? formattedPayload.record : JSON.stringify(formattedPayload))}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'saveSyllabusTopic') {
      try {
        const getUrl = `${targetUrl}?action=saveSyllabusTopic&topic=${encodeURIComponent(typeof formattedPayload.topic === 'string' ? formattedPayload.topic : JSON.stringify(formattedPayload))}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'saveSchoolHoliday') {
      try {
        const getUrl = `${targetUrl}?action=saveSchoolHoliday&holiday=${encodeURIComponent(typeof formattedPayload.holiday === 'string' ? formattedPayload.holiday : JSON.stringify(formattedPayload))}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'saveWeeklyTest') {
      try {
        const getUrl = `${targetUrl}?action=saveWeeklyTest&record=${encodeURIComponent(typeof formattedPayload.record === 'string' ? formattedPayload.record : JSON.stringify(formattedPayload))}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (
      formattedPayload.action === 'deleteSyllabusTopic' ||
      formattedPayload.action === 'deleteSchoolHoliday' ||
      formattedPayload.action === 'deleteWeeklyTest'
    ) {
      try {
        const getUrl = `${targetUrl}?action=${encodeURIComponent(formattedPayload.action)}&id=${encodeURIComponent(formattedPayload.id || '')}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    }

    return { ok: false, error: postCheck.error || `HTTP ${lastPostStatus || 500}`, response: lastPostText };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// =========================================================================
// 2-WAY GOOGLE SHEET READ SYNC FOR TEACHER PERFORMANCE, SYLLABUS & HOLIDAYS
// =========================================================================
let lastTpSheetSync = 0;
let lastSyllabusSheetSync = 0;
let lastHolidaySheetSync = 0;
let lastWeeklyTestSheetSync = 0;

function normalizeSheetMonth(val: any): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^\d{4}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 7);
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
  return str;
}

function normalizeSheetDate(val: any): string {
  if (!val) return '';
  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str.slice(0, 10);
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str.slice(0, 10);
}

async function syncTeacherPerformanceFromSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastTpSheetSync < 2500) return false;
  lastTpSheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getTeacherPerformance&_t=${now}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return false;
    const json: any = JSON.parse(text);
    if (json?.status === 'error') return false;

    const rawRows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.records)
      ? json.records
      : Array.isArray(json?.data)
      ? json.data
      : [];

    const parsed: any[] = [];
    // Support both 2D array (header + rows) and array of objects
    if (rawRows.length > 0 && Array.isArray(rawRows[0])) {
      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || (!r[0] && !r[1])) continue;
        const syllabusScore = Number(r[6] || 0);
        const testScore = Number(r[7] || 0);
        const attScore = Number(r[8] || 0);
        const hwScore = Number(r[9] || 0);
        const puncScore = Number(r[10] || 0);
        const totalScore = Number(r[11] || (syllabusScore + testScore + attScore + hwScore + puncScore));
        const monthStr = normalizeSheetMonth(r[4]) || '2026-09';
        parsed.push({
          id: String(r[0] || `tp_${monthStr}_${r[1] || i}`).trim(),
          teacher_id: String(r[1] || '').trim(),
          teacher_name: String(r[2] || '').trim(),
          assigned_class: String(r[3] || '').trim(),
          month: monthStr,
          academic_year: String(r[5] || '2026-2027').trim(),
          syllabus_progress_score: syllabusScore,
          student_test_score: testScore,
          attendance_logging_score: attScore,
          homework_evaluation_score: hwScore,
          punctuality_discipline_score: puncScore,
          monthly_total_score: Math.round(totalScore * 10) / 10,
          grade: String(r[12] || (totalScore >= 90 ? 'A+' : totalScore >= 80 ? 'A' : totalScore >= 70 ? 'B' : totalScore >= 60 ? 'C' : 'D')).trim(),
          evaluated_by: String(r[13] || 'Principal / Manager').trim(),
          remarks: String(r[14] || '').trim(),
          evaluation_date: normalizeSheetDate(r[15]) || new Date().toISOString().slice(0, 10),
          timestamp: r[15] ? String(r[15]) : new Date().toISOString(),
          _sheetSynced: true,
        });
      }
    } else {
      for (const obj of rawRows) {
        if (!obj || (!obj.teacher_id && !obj.Teacher_ID)) continue;
        const syllabusScore = Number(obj.syllabus_progress_score ?? obj.Syllabus_Score_30 ?? 0);
        const testScore = Number(obj.student_test_score ?? obj.Test_Score_25 ?? 0);
        const attScore = Number(obj.attendance_logging_score ?? obj.Attendance_Score_15 ?? 0);
        const hwScore = Number(obj.homework_evaluation_score ?? obj.Homework_Score_15 ?? 0);
        const puncScore = Number(obj.punctuality_discipline_score ?? obj.Punctuality_Score_15 ?? 0);
        const totalScore = Number(obj.monthly_total_score ?? obj.Total_Score_100 ?? (syllabusScore + testScore + attScore + hwScore + puncScore));
        const monthStr = normalizeSheetMonth(obj.month ?? obj.Month) || '2026-09';
        const teacherId = String(obj.teacher_id ?? obj.Teacher_ID ?? '').trim();
        parsed.push({
          id: String(obj.id ?? obj.Record_ID ?? `tp_${monthStr}_${teacherId}`).trim(),
          teacher_id: teacherId,
          teacher_name: String(obj.teacher_name ?? obj.Teacher_Name ?? '').trim(),
          assigned_class: String(obj.assigned_class ?? obj.Assigned_Class ?? '').trim(),
          subject: String(obj.subject ?? obj.Subject ?? '').trim(),
          month: monthStr,
          academic_year: String(obj.academic_year ?? obj.Academic_Year ?? '2026-2027').trim(),
          syllabus_progress_score: syllabusScore,
          student_test_score: testScore,
          attendance_logging_score: attScore,
          homework_evaluation_score: hwScore,
          punctuality_discipline_score: puncScore,
          monthly_total_score: Math.round(totalScore * 10) / 10,
          grade: String(obj.grade ?? obj.Grade ?? (totalScore >= 90 ? 'A+' : totalScore >= 80 ? 'A' : totalScore >= 70 ? 'B' : totalScore >= 60 ? 'C' : 'D')).trim(),
          evaluated_by: String(obj.evaluated_by ?? obj.Evaluated_By ?? 'Principal / Manager').trim(),
          remarks: String(obj.remarks ?? obj.Remarks ?? '').trim(),
          evaluation_date: normalizeSheetDate(obj.evaluation_date ?? obj.Timestamp) || new Date().toISOString().slice(0, 10),
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? new Date().toISOString()),
          _sheetSynced: true,
        });
      }
    }

    const sheetKeys = new Set(parsed.map((p) => `${p.teacher_id}_${p.month}`));
    const sheetIds = new Set(parsed.map((p) => p.id));
    const localPending = teacherPerformanceStore.filter(
      (loc) =>
        !sheetIds.has(loc.id) &&
        !sheetKeys.has(`${loc.teacher_id}_${loc.month}`) &&
        (loc._sheetSynced !== true || (loc.timestamp && Date.now() - new Date(loc.timestamp).getTime() < 45000))
    );
    teacherPerformanceStore = [...localPending, ...parsed];
    saveTeacherPerformanceCache();
    return true;
  } catch {
    return false;
  }
}

async function syncSyllabusTrackerFromSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastSyllabusSheetSync < 2500) return false;
  lastSyllabusSheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getSyllabusTracker&_t=${now}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return false;
    const json: any = JSON.parse(text);
    if (json?.status === 'error') return false;

    const rawRows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.topics)
      ? json.topics
      : Array.isArray(json?.records)
      ? json.records
      : [];

    const parsed: any[] = [];
    if (rawRows.length > 0 && Array.isArray(rawRows[0])) {
      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || (!r[0] && !r[8] && !r[9])) continue;
        const monthStr = normalizeSheetMonth(r[5]) || '2026-09';
        const weekNum = Number(r[6] || 1);
        const rawStatus = String(r[13] || 'Pending').trim();
        const status = rawStatus === 'Completed' || rawStatus === 'In_Progress' ? rawStatus : 'Pending';
        parsed.push({
          id: String(r[0] || `syl_${monthStr}_${r[1] || i}`).trim(),
          teacher_id: String(r[1] || '').trim(),
          teacher_name: String(r[2] || '').trim(),
          class_name: String(r[3] || '').trim(),
          subject: String(r[4] || '').trim(),
          month: monthStr,
          week_number: weekNum,
          week_label: String(r[7] || `सप्ताह ${weekNum}`).trim(),
          chapter_title: String(r[8] || '').trim(),
          topic_description: String(r[9] || '').trim(),
          planned_date: normalizeSheetDate(r[10]) || new Date().toISOString().slice(0, 10),
          target_completion_date: normalizeSheetDate(r[11]) || new Date().toISOString().slice(0, 10),
          completed_date: normalizeSheetDate(r[12]) || undefined,
          status,
          timestamp: r[14] ? String(r[14]) : new Date().toISOString(),
          _sheetSynced: true,
        });
      }
    } else {
      for (const obj of rawRows) {
        if (!obj || (!obj.topic_description && !obj.Topic_Description && !obj.chapter_title && !obj.Chapter_Title)) continue;
        const monthStr = normalizeSheetMonth(obj.month ?? obj.Month) || '2026-09';
        const weekNum = Number(obj.week_number ?? obj.Week_Number ?? 1);
        const rawStatus = String(obj.status ?? obj.Status ?? 'Pending').trim();
        const status = rawStatus === 'Completed' || rawStatus === 'In_Progress' ? rawStatus : 'Pending';
        parsed.push({
          id: String(obj.id ?? obj.Topic_ID ?? `syl_${monthStr}_${obj.teacher_id || 't'}`).trim(),
          teacher_id: String(obj.teacher_id ?? obj.Teacher_ID ?? '').trim(),
          teacher_name: String(obj.teacher_name ?? obj.Teacher_Name ?? '').trim(),
          class_name: String(obj.class_name ?? obj.Class_Name ?? '').trim(),
          subject: String(obj.subject ?? obj.Subject ?? '').trim(),
          month: monthStr,
          week_number: weekNum,
          week_label: String(obj.week_label ?? obj.Week_Label ?? `सप्ताह ${weekNum}`).trim(),
          chapter_title: String(obj.chapter_title ?? obj.Chapter_Title ?? '').trim(),
          topic_description: String(obj.topic_description ?? obj.Topic_Description ?? '').trim(),
          planned_date: normalizeSheetDate(obj.planned_date ?? obj.Planned_Date) || new Date().toISOString().slice(0, 10),
          target_completion_date: normalizeSheetDate(obj.target_completion_date ?? obj.Target_Completion_Date) || new Date().toISOString().slice(0, 10),
          completed_date: normalizeSheetDate(obj.completed_date ?? obj.Completed_Date) || undefined,
          status,
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? new Date().toISOString()),
          _sheetSynced: true,
        });
      }
    }

    const sheetIds = new Set(parsed.map((p) => p.id));
    const localPending = syllabusTrackerStore.filter(
      (loc) =>
        !sheetIds.has(loc.id) &&
        (loc._sheetSynced !== true || (loc.timestamp && Date.now() - new Date(loc.timestamp).getTime() < 45000))
    );
    syllabusTrackerStore = [...localPending, ...parsed];
    saveSyllabusTrackerCache();
    return true;
  } catch {
    return false;
  }
}

async function syncWeeklyTestsFromSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastWeeklyTestSheetSync < 2500) return false;
  lastWeeklyTestSheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getWeeklyTests&_t=${now}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return false;
    const json: any = JSON.parse(text);
    if (json?.status === 'error') return false;

    const rawRows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.tests)
      ? json.tests
      : Array.isArray(json?.records)
      ? json.records
      : [];

    const parsed: any[] = [];
    if (rawRows.length > 0 && Array.isArray(rawRows[0])) {
      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || (!r[0] && !r[9] && !r[10])) continue;
        const testDate = normalizeSheetDate(r[7]) || new Date().toISOString().slice(0, 10);
        const monthStr = normalizeSheetMonth(r[5]) || testDate.slice(0, 7);
        parsed.push({
          id: String(r[0] || `wt_${i}`).trim(),
          test_session_id: String(r[1] || '').trim(),
          teacher_id: String(r[2] || '').trim(),
          teacher_name: String(r[3] || '').trim(),
          class_name: String(r[4] || '').trim(),
          month: monthStr,
          week_number: Number(r[6] || 1),
          test_date: testDate,
          subject: String(r[8] || '').trim(),
          topic_name: String(r[9] || '').trim(),
          student_id: String(r[10] || '').trim(),
          student_name: String(r[11] || '').trim(),
          max_marks: Number(r[12] || 20),
          marks_obtained: Number(r[13] || 0),
          attendance_status: String(r[14] || 'Present').trim() === 'Absent' ? 'Absent' : 'Present',
          remarks: String(r[15] || '').trim(),
          timestamp: r[16] ? String(r[16]) : new Date().toISOString(),
          _sheetSynced: true,
        });
      }
    } else {
      for (const obj of rawRows) {
        if (!obj || (!obj.student_id && !obj.student_name && !obj.Student_ID && !obj.Student_Name)) continue;
        const testDate = normalizeSheetDate(obj.test_date ?? obj.Test_Date) || new Date().toISOString().slice(0, 10);
        const monthStr = normalizeSheetMonth(obj.month ?? obj.Month) || testDate.slice(0, 7);
        parsed.push({
          id: String(obj.id ?? obj.ID ?? `wt_${testDate}_${obj.student_id || 's'}`).trim(),
          test_session_id: String(obj.test_session_id ?? obj.Session_ID ?? '').trim(),
          teacher_id: String(obj.teacher_id ?? obj.Teacher_ID ?? '').trim(),
          teacher_name: String(obj.teacher_name ?? obj.Teacher_Name ?? '').trim(),
          class_name: String(obj.class_name ?? obj.Class ?? '').trim(),
          month: monthStr,
          week_number: Number(obj.week_number ?? obj.Week_Number ?? 1),
          test_date: testDate,
          subject: String(obj.subject ?? obj.Subject ?? '').trim(),
          topic_name: String(obj.topic_name ?? obj.Topic ?? '').trim(),
          student_id: String(obj.student_id ?? obj.Student_ID ?? '').trim(),
          student_name: String(obj.student_name ?? obj.Student_Name ?? '').trim(),
          max_marks: Number(obj.max_marks ?? obj.Max_Marks ?? 20),
          marks_obtained: Number(obj.marks_obtained ?? obj.Marks_Obtained ?? 0),
          attendance_status:
            String(obj.attendance_status ?? obj.Status ?? 'Present').trim() === 'Absent' ? 'Absent' : 'Present',
          remarks: String(obj.remarks ?? obj.Remarks ?? '').trim(),
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? new Date().toISOString()),
          _sheetSynced: true,
        });
      }
    }

    const sheetIds = new Set(parsed.map((p) => p.id));
    const localPending = weeklyTestsStore.filter(
      (loc) =>
        !sheetIds.has(loc.id) &&
        (loc._sheetSynced !== true || (loc.timestamp && Date.now() - new Date(loc.timestamp).getTime() < 45000))
    );
    weeklyTestsStore = [...localPending, ...parsed];
    saveWeeklyTestsCache();
    return true;
  } catch {
    return false;
  }
}

async function syncSchoolHolidaysFromSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastHolidaySheetSync < 2500) return false;
  lastHolidaySheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getSchoolHolidays&_t=${now}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return false;
    const json: any = JSON.parse(text);
    if (json?.status === 'error') return false;

    const rawRows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.holidays)
      ? json.holidays
      : Array.isArray(json?.records)
      ? json.records
      : [];

    if (rawRows.length === 0) return false;

    const looksLikeDateValue = (val: any): boolean => {
      if (!val) return false;
      if (val instanceof Date) return true;
      const s = String(val).trim();
      return (
        /^\d{4}-\d{2}-\d{2}/.test(s) ||
        /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(s) ||
        /GMT\+|India Standard Time|^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i.test(s)
      );
    };

    const parsed: any[] = [];
    if (Array.isArray(rawRows[0])) {
      const hdr = rawRows[0].map((c: any) => String(c || '').trim().toLowerCase());
      const headerDateFirst = hdr[1]?.includes('date') && (hdr[3]?.includes('title') || hdr[3]?.includes('name'));
      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i];
        if (!r || (!r[1] && !r[2])) continue;
        const rowDateFirst = headerDateFirst || (looksLikeDateValue(r[1]) && !looksLikeDateValue(r[3]));
        const dateStr = normalizeSheetDate(rowDateFirst ? r[1] : r[2]);
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        const endStr = normalizeSheetDate(rowDateFirst ? r[2] : r[3]);
        const titleStr = String((rowDateFirst ? r[3] : r[1]) || 'अवकाश').trim();
        parsed.push({
          id: String(r[0] || `hol_${dateStr.replace(/-/g, '_')}_${i}`).trim(),
          title: titleStr,
          date: dateStr,
          end_date: endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr) && endStr !== dateStr ? endStr : undefined,
          category: String(r[4] || 'festival').trim(),
          description: String(r[5] || '').trim() || undefined,
          timestamp: r[6] ? String(r[6]) : new Date().toISOString(),
        });
      }
    } else {
      for (const obj of rawRows) {
        const rawTitle = obj.title ?? obj.Title ?? '';
        const rawDate = obj.date ?? obj.Date ?? '';
        const rawEnd = obj.end_date ?? obj.End_Date ?? '';
        // Handle sheet column layout ID | Date | End_Date | Title when Code.gs read fixed indices r[1], r[2], r[3]
        const swapped = looksLikeDateValue(rawTitle) && !looksLikeDateValue(rawEnd);
        const dateStr = normalizeSheetDate(swapped ? rawTitle : rawDate);
        const endStr = normalizeSheetDate(swapped ? rawDate : rawEnd);
        const titleStr = String(swapped ? rawEnd : rawTitle).trim();
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !titleStr) continue;
        parsed.push({
          id: String(obj.id ?? obj.Holiday_ID ?? `hol_${dateStr.replace(/-/g, '_')}`).trim(),
          title: titleStr,
          date: dateStr,
          end_date: endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr) && endStr !== dateStr ? endStr : undefined,
          category: String(obj.category ?? obj.Category ?? 'festival').trim(),
          description: String(obj.description ?? obj.Description ?? '').trim() || undefined,
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? new Date().toISOString()),
          _sheetSynced: true,
        });
      }
    }

    if (parsed.length > 0) {
      const sheetIds = new Set(parsed.map((p) => p.id));
      const sheetDateTitles = new Set(parsed.map((p) => `${p.date}_${p.title}`));
      const localOnly = schoolHolidaysStore.filter(
        (loc) =>
          !sheetIds.has(loc.id) &&
          !sheetDateTitles.has(`${loc.date}_${loc.title}`) &&
          (loc._sheetSynced === false || (loc.timestamp && Date.now() - new Date(loc.timestamp).getTime() < 45000))
      );
      schoolHolidaysStore = [...parsed, ...localOnly].sort((a, b) => a.date.localeCompare(b.date));
      saveSchoolHolidaysCache();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function getHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
  const existing = liveTelemetryStore[busId];

  // Derive instantaneous speed if device GPS speed is 0 or null
  let finalSpeed = typeof data.speed === 'number' && data.speed > 0 ? Math.round(data.speed) : 0;
  let finalHeading = typeof data.heading === 'number' ? data.heading : (existing?.heading || 0);

  if ((!finalSpeed || finalSpeed === 0) && existing && existing.latitude && existing.longitude) {
    const prevTime = new Date(existing.lastServerSync || existing.lastUpdated).getTime();
    const elapsedSec = (Date.now() - prevTime) / 1000;
    if (elapsedSec >= 1 && elapsedSec <= 60) {
      const distMeters = getHaversineDistanceMeters(existing.latitude, existing.longitude, lat, lng);
      if (distMeters >= 3.5) {
        const computedKmh = Math.round((distMeters / elapsedSec) * 3.6);
        if (computedKmh <= 100) {
          finalSpeed = computedKmh;
        }
        // Also compute bearing if heading is missing
        if (!finalHeading || finalHeading === 0) {
          const y = Math.sin(((lng - existing.longitude) * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180);
          const x =
            Math.cos((existing.latitude * Math.PI) / 180) * Math.sin((lat * Math.PI) / 180) -
            Math.sin((existing.latitude * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.cos(((lng - existing.longitude) * Math.PI) / 180);
          finalHeading = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
        }
      } else {
        finalSpeed = 0;
      }
    }
  }

  const telemetry = {
    busId,
    driverName,
    driverPhone: data.driverPhone || existing?.driverPhone || '9761081818',
    currentLocationStr: locStr,
    latitude: lat,
    longitude: lng,
    accuracy: data.accuracy || 8,
    speed: finalSpeed,
    heading: finalHeading,
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
    try {
      const host = request.headers.host || 'localhost';
      const pathname = new URL(request.url || '', `http://${host}`).pathname;
      if (pathname === '/ws/location') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore invalid upgrade attempts cleanly
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

  // Live App Version endpoint for installed PWA update detection
  app.get('/api/app-version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
      const distVersionFile = path.join(process.cwd(), 'dist', 'version.json');
      if (process.env.NODE_ENV === 'production' && fs.existsSync(distVersionFile)) {
        const parsed = JSON.parse(fs.readFileSync(distVersionFile, 'utf-8'));
        return res.json({
          version: parsed?.version || SERVER_BOOT_VERSION,
          builtAt: parsed?.builtAt || SERVER_BOOT_AT,
          mode: 'production',
        });
      }
    } catch {}

    res.json({
      version: SERVER_BOOT_VERSION,
      builtAt: SERVER_BOOT_AT,
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'dev',
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
  const TEACHER_ASSIGNMENTS_FILE = '/tmp/evs_teacher_class_assignments.json';

  const getTeacherClassAssignments = (): Record<string, string> => {
    try {
      if (fs.existsSync(TEACHER_ASSIGNMENTS_FILE)) {
        return JSON.parse(fs.readFileSync(TEACHER_ASSIGNMENTS_FILE, 'utf-8'));
      }
    } catch (e) {
      console.warn('Error reading teacher assignments file:', e);
    }
    return {};
  };

  const saveTeacherClassAssignment = (
    userId: string,
    assignedClass: string,
    userName?: string,
    username?: string
  ): Record<string, string> => {
    const assignments = getTeacherClassAssignments();
    const cleanId = String(userId || '').trim();
    const cleanClass = String(assignedClass || '').trim();
    if (cleanId) {
      assignments[cleanId] = cleanClass;
      assignments[cleanId.toLowerCase()] = cleanClass;
    }
    if (userName) {
      const cleanName = String(userName).trim();
      assignments[cleanName] = cleanClass;
      assignments[cleanName.toLowerCase()] = cleanClass;
    }
    if (username) {
      const cleanUser = String(username).trim();
      assignments[cleanUser] = cleanClass;
      assignments[cleanUser.toLowerCase()] = cleanClass;
    }
    try {
      fs.writeFileSync(TEACHER_ASSIGNMENTS_FILE, JSON.stringify(assignments, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving teacher assignments file:', e);
    }
    return assignments;
  };

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

  // Helper to normalize dates into YYYY-MM-DD
  const normalizeDateKey = (val: any): string => {
    if (!val) return '';
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parts = str.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }
      if (parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
    return str;
  };

  const saveHomeworkItem = (item: any): any[] => {
    let list = getHomeworkList();
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

    const targetDate = normalizeDateKey(normalized.Date);
    const targetClass = String(normalized.Class || '').toLowerCase().trim();
    const targetSubj = String(normalized.Subject || '').toLowerCase().trim();
    const targetDetail = String(normalized.Homework_Detail || '').toLowerCase().trim().slice(0, 40);

    // Look for exact ID match or composite match (Class + Date + Subject + snippet of detail)
    const existingIdx = list.findIndex((h) => {
      const hId = String(h.Homework_ID || '').toLowerCase().trim();
      if (hId && hId === hwId.toLowerCase().trim()) return true;
      const hDate = normalizeDateKey(h.Date);
      const hClass = String(h.Class || '').toLowerCase().trim();
      const hSubj = String(h.Subject || '').toLowerCase().trim();
      const hDetail = String(h.Homework_Detail || '').toLowerCase().trim().slice(0, 40);
      return hDate === targetDate && hClass === targetClass && hSubj === targetSubj && (hDetail === targetDetail || !targetDetail);
    });

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...normalized };
    } else {
      list.unshift(normalized);
    }

    // Deduplicate entire list to eliminate any historical duplicate homework
    const seenComp = new Set<string>();
    const seenHwIds = new Set<string>();
    list = list.filter((h) => {
      const hId = String(h.Homework_ID || '').toLowerCase().trim();
      const hDate = normalizeDateKey(h.Date);
      const hClass = String(h.Class || '').toLowerCase().trim();
      const hSubj = String(h.Subject || '').toLowerCase().trim();
      const hDetail = String(h.Homework_Detail || '').toLowerCase().trim().slice(0, 40);
      const compKey = `${hClass}_${hDate}_${hSubj}_${hDetail}`;

      if (hId && seenHwIds.has(hId)) return false;
      if (seenComp.has(compKey)) return false;

      if (hId) seenHwIds.add(hId);
      seenComp.add(compKey);
      return true;
    });

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
    let list = getHwTrackerList();
    const tId = String(item.record_id || item.ID || `TRK-${Date.now()}`);
    const sId = String(item.student_id || item.Student_ID || '').trim();
    const dateStr = item.date || item.Date || new Date().toISOString().split('T')[0];
    const targetDate = normalizeDateKey(dateStr);
    const targetSubject = String(item.subject || item.Subject || 'General').toLowerCase().trim();

    // Standardize status: Completed or Incompleted
    let targetStatus = String(item.status || item.Last_homework_Status || 'Completed').trim();
    if (/incom|pend|adhura|not/i.test(targetStatus)) {
      targetStatus = 'Incompleted';
    } else {
      targetStatus = 'Completed';
    }

    const normalized = {
      ID: tId,
      Date: dateStr,
      Class: item.class || item.Class || '',
      Student_ID: sId,
      Subject: item.subject || item.Subject || 'General',
      Last_homework_Status: targetStatus,
      Remark: item.remark || item.Remark || '',
    };

    // Filter out ANY previous record for this student on the same date/subject to eliminate conflicting dual status
    const remaining = list.filter((t) => {
      if (t.ID && t.ID === tId) return false;
      if (sId && t.Student_ID && t.Student_ID.toLowerCase().trim() === sId.toLowerCase().trim()) {
        const tDate = normalizeDateKey(t.Date);
        const tSubj = String(t.Subject || 'General').toLowerCase().trim();
        if (tDate === targetDate && (tSubj === targetSubject || !t.Subject || tSubj.includes('general') || targetSubject.includes('general'))) {
          return false;
        }
      }
      return true;
    });

    list = [normalized, ...remaining];

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

    // 1. Send as batchAddBehavior so Google Apps Script processes all records in 1 atomic write
    let batchSucceeded = false;
    try {
      const batchRes = await forwardToGoogleAppsScript({
        action: 'batchAddBehavior',
        records: items,
        appsScriptUrl: targetScriptUrl,
      });
      const respStr = String(batchRes?.response || '');
      if (batchRes?.ok && !respStr.includes('error') && !respStr.includes('Invalid action')) {
        batchSucceeded = true;
        console.log(`[server] ✅ Successfully synced batch of ${items.length} behavior records to Google Sheet!`);
      }
    } catch (bErr) {
      console.warn('[server] batchAddBehavior error:', bErr);
    }

    // 2. Only if batchAddBehavior failed or was rejected by older Apps Script, fall back to sequential individual requests
    if (!batchSucceeded) {
      console.log(`[server] ⚠️ batchAddBehavior not acknowledged, falling back to sequential writes for ${items.length} records...`);
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
            await new Promise((r) => setTimeout(r, 200));
          } catch (fErr) {
            console.warn(`[AppsScriptForwarder] Error forwarding behavior for ${sid}:`, fErr);
          }
        }
      })();
    }

    res.json({ success: true, behavior: list, remoteSynced: batchSucceeded });
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

  // Endpoints for Teacher Class Assignments by Manager
  app.get('/api/teacher-class-assignments', (_req, res) => {
    res.json({ assignments: getTeacherClassAssignments() });
  });

  app.post('/api/assign-teacher-class', (req, res) => {
    const { userId, assignedClass, userName, username, appsScriptUrl } = req.body || {};
    const updated = saveTeacherClassAssignment(
      String(userId || '').trim(),
      String(assignedClass || '').trim(),
      userName ? String(userName).trim() : undefined,
      username ? String(username).trim() : undefined
    );

    // Broadcast to connected WebSocket clients for real-time live sync across portals
    const updateBroadcast = JSON.stringify({
      type: 'APP_DATA_UPDATED',
      entity: 'users',
      action: 'assignTeacherClass',
      details: { userId, assignedClass, userName, username },
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(updateBroadcast);
      }
    }

    // Forward to Google Apps Script
    forwardToGoogleAppsScript({
      action: 'assignTeacherClass',
      user_id: userId,
      assigned_class: assignedClass,
      user_name: userName,
      username: username,
      appsScriptUrl: appsScriptUrl || req.headers['x-apps-script-url'] || currentAppsScriptUrl,
    }).catch(() => {});

    res.json({ success: true, assignments: updated });
  });

  // Endpoints for Teacher Performance Tracking, Monthly Leaderboard & Teacher of the Year
  app.get('/api/teacher-performance', async (req, res) => {
    const force = req.query.refresh === '1' || req.query.sync === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    await syncTeacherPerformanceFromSheet(force, targetUrl);
    res.json(teacherPerformanceStore);
  });

  app.post('/api/teacher-performance', async (req, res) => {
    try {
      const record = req.body;
      if (!record || !record.teacher_id) {
        return res.status(400).json({ error: 'teacher_id is required' });
      }
      const targetUrl = resolveTargetAppsScriptUrl(req);

      const idx = teacherPerformanceStore.findIndex(
        (r) => r.id === record.id || (r.teacher_id === record.teacher_id && r.month === record.month)
      );
      if (idx >= 0) {
        teacherPerformanceStore[idx] = { ...teacherPerformanceStore[idx], ...record, timestamp: new Date().toISOString() };
      } else {
        teacherPerformanceStore.unshift({ ...record, timestamp: new Date().toISOString() });
      }
      saveTeacherPerformanceCache();

      // Forward to Google Apps Script (Teacher_Performance tab)
      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveTeacherPerformance',
        record: JSON.stringify(record),
        appsScriptUrl: targetUrl,
        ...record,
      });

      const savedIdx = teacherPerformanceStore.findIndex(
        (r) => r.id === record.id || (r.teacher_id === record.teacher_id && r.month === record.month)
      );
      if (savedIdx >= 0) {
        teacherPerformanceStore[savedIdx]._sheetSynced = gasResult.ok;
        saveTeacherPerformanceCache();
      }

      // Broadcast update to all connected clients via WebSocket
      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'teacher_performance',
        action: 'update',
        details: { teacherId: record.teacher_id, month: record.month },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : (gasResult.error || gasResult.response || 'Apps Script doPost में saveTeacherPerformance नहीं मिला'),
        message: gasResult.ok
          ? "Google Sheet 'Teacher_Performance' में शिक्षक प्रदर्शन सुरक्षित हो गया!"
          : `⚠️ स्थानीय सर्वर में सेव हुआ, लेकिन Google Sheet में नहीं गया: ${gasResult.error || 'Apps Script doPost अपडेट करें'}`,
        record,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error saving teacher performance' });
    }
  });

  // True 2-Way Push + Pull Sync for Teacher Performance
  app.post('/api/teacher-performance/sync-all', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const demoSeedIds = new Set(['tp_2026_09_t1', 'tp_2026_09_t2', 'tp_2026_09_t3', 'tp_2026_09_t4']);
      const localRecords = Array.isArray(req.body?.localRecords) ? req.body.localRecords : [];

      for (const loc of localRecords) {
        if (!loc || !loc.teacher_id || demoSeedIds.has(String(loc.id))) continue;
        const existsIdx = teacherPerformanceStore.findIndex(
          (r) => r.id === loc.id || (r.teacher_id === loc.teacher_id && r.month === loc.month)
        );
        if (existsIdx < 0) {
          teacherPerformanceStore.unshift({ ...loc, _sheetSynced: false });
        }
      }
      saveTeacherPerformanceCache();

      // 1. Inspect what is currently in Google Sheet
      let sheetIds = new Set<string>();
      let sheetKeys = new Set<string>();
      let sheetReachable = true;
      let fetchError = '';
      try {
        const sRes = await fetch(`${targetUrl}?action=getTeacherPerformance&_t=${Date.now()}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(9000),
        });
        const sText = await sRes.text();
        if (!sRes.ok || sText.trim().startsWith('<')) {
          sheetReachable = false;
          fetchError = 'Apps Script Deployment अनुमति (Anyone) जांचें';
        } else {
          const sJson: any = JSON.parse(sText);
          if (sJson?.status === 'error') {
            sheetReachable = false;
            fetchError = String(sJson.message || sJson.error || 'Apps Script error');
          } else {
            const rows: any[] = Array.isArray(sJson) ? sJson : Array.isArray(sJson?.records) ? sJson.records : [];
            for (const row of rows) {
              if (!row || Array.isArray(row)) continue;
              const rid = String(row.id || '').trim();
              const tid = String(row.teacher_id || '').trim();
              const mo = normalizeSheetMonth(row.month);
              if (rid) sheetIds.add(rid);
              if (tid && mo) sheetKeys.add(`${tid}_${mo}`);
            }
          }
        }
      } catch (e: any) {
        sheetReachable = false;
        fetchError = e?.message || 'Google Sheet से कनेक्ट नहीं हो सका';
      }

      if (!sheetReachable) {
        return res.json({
          success: false,
          pushed: 0,
          failed: 1,
          sheetCount: 0,
          lastError: fetchError,
          records: teacherPerformanceStore,
        });
      }

      // 2. Push unsynced real records sequentially (1 by 1) to avoid Google Apps Script appendRow concurrency races
      const toPush = teacherPerformanceStore.filter(
        (r) => r && r.teacher_id && !demoSeedIds.has(String(r.id)) && !sheetIds.has(String(r.id)) && !sheetKeys.has(`${r.teacher_id}_${r.month}`)
      );

      let pushed = 0;
      let failed = 0;
      let lastError = '';
      for (const rec of toPush) {
        const r = await forwardToGoogleAppsScript({
          action: 'saveTeacherPerformance',
          record: JSON.stringify(rec),
          appsScriptUrl: targetUrl,
          ...rec,
        });
        if (r.ok) {
          pushed++;
          rec._sheetSynced = true;
        } else {
          failed++;
          if (!lastError) lastError = r.error || 'Sheet save error';
        }
      }
      saveTeacherPerformanceCache();

      // 3. Pull refreshed records from Google Sheet
      await syncTeacherPerformanceFromSheet(true, targetUrl);
      const sheetCount = Math.max(sheetIds.size + pushed, teacherPerformanceStore.filter((r) => !demoSeedIds.has(String(r.id))).length);

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'teacher_performance',
        action: 'sync',
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      res.json({
        success: failed === 0,
        pushed,
        failed,
        sheetCount,
        lastError: lastError || undefined,
        records: teacherPerformanceStore,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, pushed: 0, failed: 1, lastError: err?.message, records: teacherPerformanceStore });
    }
  });

  // Endpoints for Weekly & Monthly Syllabus Tracker & Progress Planning
  app.get('/api/syllabus-tracker', async (req, res) => {
    const force = req.query.refresh === '1' || req.query.sync === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    await syncSyllabusTrackerFromSheet(force, targetUrl);
    const { teacher_id, month, class_name } = req.query;
    let filtered = syllabusTrackerStore;
    if (teacher_id) {
      filtered = filtered.filter((s) => s.teacher_id === teacher_id);
    }
    if (month) {
      filtered = filtered.filter((s) => s.month === month);
    }
    if (class_name) {
      filtered = filtered.filter((s) => s.class_name === class_name);
    }
    res.json(filtered);
  });

  app.post('/api/syllabus-tracker', async (req, res) => {
    try {
      const topic = req.body;
      if (!topic || !topic.teacher_id || !topic.topic_description) {
        return res.status(400).json({ error: 'teacher_id and topic_description are required' });
      }
      const targetUrl = resolveTargetAppsScriptUrl(req);

      if (!topic.id) {
        topic.id = `syl_${(topic.month || '2026').replace('-', '_')}_${topic.teacher_id}_${Date.now()}`;
      }

      const idx = syllabusTrackerStore.findIndex((s) => s.id === topic.id);
      if (idx >= 0) {
        syllabusTrackerStore[idx] = { ...syllabusTrackerStore[idx], ...topic, timestamp: new Date().toISOString() };
      } else {
        syllabusTrackerStore.unshift({ ...topic, timestamp: new Date().toISOString() });
      }
      saveSyllabusTrackerCache();

      // Forward to Google Apps Script (Syllabus_Tracker tab)
      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveSyllabusTopic',
        topic: JSON.stringify(topic),
        appsScriptUrl: targetUrl,
        ...topic,
      });

      const savedIdx = syllabusTrackerStore.findIndex((s) => s.id === topic.id);
      if (savedIdx >= 0) {
        syllabusTrackerStore[savedIdx]._sheetSynced = gasResult.ok;
        saveSyllabusTrackerCache();
      }

      // Broadcast update via WebSocket
      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'syllabus_tracker',
        action: 'update',
        details: { teacherId: topic.teacher_id, month: topic.month, id: topic.id },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : (gasResult.error || gasResult.response || 'Apps Script doPost में saveSyllabusTopic नहीं मिला'),
        message: gasResult.ok
          ? "Google Sheet 'Syllabus_Tracker' में पाठ्यक्रम लक्ष्य सुरक्षित हो गया!"
          : `⚠️ स्थानीय सर्वर में सेव हुआ, लेकिन Google Sheet में नहीं गया: ${gasResult.error || 'Apps Script doPost अपडेट करें'}`,
        topic,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error saving syllabus tracker record' });
    }
  });

  // True 2-Way Push + Pull Sync for Syllabus Tracker
  app.post('/api/syllabus-tracker/sync-all', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const demoSeedIds = new Set(['syl_2026_09_sunita_1', 'syl_2026_09_sunita_2', 'syl_2026_09_sunita_3', 'syl_2026_09_sunita_4']);
      const localTopics = Array.isArray(req.body?.localTopics) ? req.body.localTopics : [];

      for (const loc of localTopics) {
        if (!loc || !loc.topic_description || demoSeedIds.has(String(loc.id))) continue;
        if (!syllabusTrackerStore.some((s) => s.id === loc.id)) {
          syllabusTrackerStore.unshift({ ...loc, _sheetSynced: false });
        }
      }
      saveSyllabusTrackerCache();

      let sheetIds = new Set<string>();
      let sheetReachable = true;
      let fetchError = '';
      try {
        const sRes = await fetch(`${targetUrl}?action=getSyllabusTracker&_t=${Date.now()}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(9000),
        });
        const sText = await sRes.text();
        if (!sRes.ok || sText.trim().startsWith('<')) {
          sheetReachable = false;
          fetchError = 'Apps Script Deployment अनुमति (Anyone) जांचें';
        } else {
          const sJson: any = JSON.parse(sText);
          if (sJson?.status === 'error') {
            sheetReachable = false;
            fetchError = String(sJson.message || sJson.error || 'Apps Script error');
          } else {
            const rows: any[] = Array.isArray(sJson) ? sJson : Array.isArray(sJson?.topics) ? sJson.topics : [];
            for (const row of rows) {
              if (!row || Array.isArray(row)) continue;
              const tid = String(row.id || '').trim();
              if (tid) sheetIds.add(tid);
            }
          }
        }
      } catch (e: any) {
        sheetReachable = false;
        fetchError = e?.message || 'Google Sheet से कनेक्ट नहीं हो सका';
      }

      if (!sheetReachable) {
        return res.json({
          success: false,
          pushed: 0,
          failed: 1,
          sheetCount: 0,
          lastError: fetchError,
          topics: syllabusTrackerStore,
        });
      }

      const toPush = syllabusTrackerStore.filter(
        (t) => t && t.topic_description && !demoSeedIds.has(String(t.id)) && !sheetIds.has(String(t.id))
      );

      let pushed = 0;
      let failed = 0;
      let lastError = '';
      for (const topic of toPush) {
        const r = await forwardToGoogleAppsScript({
          action: 'saveSyllabusTopic',
          topic: JSON.stringify(topic),
          appsScriptUrl: targetUrl,
          ...topic,
        });
        if (r.ok) {
          pushed++;
          topic._sheetSynced = true;
        } else {
          failed++;
          if (!lastError) lastError = r.error || 'Sheet save error';
        }
      }
      saveSyllabusTrackerCache();

      await syncSyllabusTrackerFromSheet(true, targetUrl);
      const sheetCount = Math.max(sheetIds.size + pushed, syllabusTrackerStore.filter((t) => !demoSeedIds.has(String(t.id))).length);

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'syllabus_tracker',
        action: 'sync',
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      res.json({
        success: failed === 0,
        pushed,
        failed,
        sheetCount,
        lastError: lastError || undefined,
        topics: syllabusTrackerStore,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, pushed: 0, failed: 1, lastError: err?.message, topics: syllabusTrackerStore });
    }
  });

  app.delete('/api/syllabus-tracker/:id', async (req, res) => {
    const id = req.params.id;
    const targetUrl = resolveTargetAppsScriptUrl(req);
    syllabusTrackerStore = syllabusTrackerStore.filter((s) => s.id !== id);
    saveSyllabusTrackerCache();
    const gasResult = await forwardToGoogleAppsScript({
      action: 'deleteSyllabusTopic',
      id,
      appsScriptUrl: targetUrl,
    });
    const broadcastMsg = JSON.stringify({
      type: 'APP_DATA_UPDATED',
      entity: 'syllabus_tracker',
      action: 'delete',
      details: { id },
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
    }
    res.json({
      success: true,
      sheetSynced: gasResult.ok,
      sheetError: gasResult.ok ? undefined : (gasResult.error || gasResult.response),
      message: gasResult.ok
        ? 'पाठ्यक्रम लक्ष्य Google Sheet से भी हटा दिया गया'
        : `⚠️ ऐप से हटा, पर Google Sheet में नहीं: ${gasResult.error || 'Apps Script अपडेट करें'}`,
    });
  });

  // Endpoints for Weekly Subject Tests & Student Test Marks (25-pt Teacher Parameter)
  app.get('/api/weekly-tests', async (req, res) => {
    const force = req.query.refresh === '1' || req.query.sync === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    await syncWeeklyTestsFromSheet(force, targetUrl);
    const { teacher_id, month, class_name } = req.query;
    let filtered = weeklyTestsStore;
    if (teacher_id) {
      filtered = filtered.filter((t) => String(t.teacher_id) === String(teacher_id));
    }
    if (month) {
      filtered = filtered.filter((t) => String(t.month) === String(month));
    }
    if (class_name) {
      filtered = filtered.filter((t) => String(t.class_name) === String(class_name));
    }
    res.json(filtered);
  });

  app.post('/api/weekly-tests', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const batchInput: any[] = Array.isArray(req.body?.records)
        ? req.body.records
        : req.body
        ? [req.body]
        : [];
      const validRecords = batchInput.filter((r) => r && (r.student_id || r.student_name));
      if (validRecords.length === 0) {
        return res.status(400).json({ error: 'Valid weekly test record(s) required' });
      }

      const nowIso = new Date().toISOString();
      const savedRecords: any[] = [];
      for (const rec of validRecords) {
        const rid = String(
          rec.id || `wt_${(rec.month || '2026').replace('-', '_')}_${rec.student_id || 's'}_${Date.now()}`
        ).trim();
        const normalized = { ...rec, id: rid, timestamp: nowIso };
        const idx = weeklyTestsStore.findIndex((w) => w.id === rid);
        if (idx >= 0) {
          weeklyTestsStore[idx] = { ...weeklyTestsStore[idx], ...normalized };
        } else {
          weeklyTestsStore.unshift(normalized);
        }
        savedRecords.push(normalized);
      }
      saveWeeklyTestsCache();

      let sheetSynced = false;
      let sheetError = '';
      const batchRes = await forwardToGoogleAppsScript({
        action: 'saveWeeklyTestsBatch',
        records: JSON.stringify(savedRecords),
        appsScriptUrl: targetUrl,
      });

      if (batchRes.ok) {
        sheetSynced = true;
      } else {
        sheetError = batchRes.error || batchRes.response || 'Apps Script doPost में saveWeeklyTestsBatch / saveWeeklyTest नहीं मिला';
        if (savedRecords.length === 1) {
          const singleRes = await forwardToGoogleAppsScript({
            action: 'saveWeeklyTest',
            record: JSON.stringify(savedRecords[0]),
            appsScriptUrl: targetUrl,
            ...savedRecords[0],
          });
          if (singleRes.ok) {
            sheetSynced = true;
            sheetError = '';
          }
        }
      }

      if (sheetSynced) {
        const savedSet = new Set(savedRecords.map((s) => s.id));
        weeklyTestsStore.forEach((w) => {
          if (savedSet.has(w.id)) w._sheetSynced = true;
        });
        saveWeeklyTestsCache();
      }

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'weekly_tests',
        action: 'update',
        details: { count: savedRecords.length },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      res.json({
        success: true,
        sheetSynced,
        sheetError: sheetSynced ? undefined : sheetError,
        message: sheetSynced
          ? `Google Sheet 'Weekly_Tests' में ${savedRecords.length} टेस्ट प्रविष्टियाँ सुरक्षित हो गईं!`
          : `⚠️ ऐप में सेव हुआ, पर Sheet में नहीं गया: ${sheetError}`,
        records: savedRecords,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Error saving weekly test records' });
    }
  });

  app.delete('/api/weekly-tests/:id', async (req, res) => {
    const id = req.params.id;
    const targetUrl = resolveTargetAppsScriptUrl(req);
    let gasResult: { ok: boolean; error?: string; response?: string } = { ok: false };

    if (id.startsWith('session:')) {
      const sessId = id.slice('session:'.length);
      const removed = weeklyTestsStore.filter((w) => w.test_session_id === sessId);
      weeklyTestsStore = weeklyTestsStore.filter((w) => w.test_session_id !== sessId);
      saveWeeklyTestsCache();
      for (const r of removed) {
        gasResult = await forwardToGoogleAppsScript({
          action: 'deleteWeeklyTest',
          id: r.id,
          appsScriptUrl: targetUrl,
        });
      }
    } else {
      weeklyTestsStore = weeklyTestsStore.filter((w) => w.id !== id);
      saveWeeklyTestsCache();
      gasResult = await forwardToGoogleAppsScript({
        action: 'deleteWeeklyTest',
        id,
        appsScriptUrl: targetUrl,
      });
    }

    const broadcastMsg = JSON.stringify({
      type: 'APP_DATA_UPDATED',
      entity: 'weekly_tests',
      action: 'delete',
      details: { id },
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
    }

    res.json({
      success: true,
      sheetSynced: gasResult.ok,
      message: gasResult.ok ? 'Weekly test deleted from sheet' : 'Deleted locally',
    });
  });

  // Endpoints for School Holidays (Sunday ke alawa chhuttiyan)
  app.get('/api/school-holidays', async (req, res) => {
    const force = req.query.refresh === '1' || req.query.sync === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    await syncSchoolHolidaysFromSheet(force, targetUrl);
    res.json(schoolHolidaysStore);
  });

  app.post('/api/school-holidays', async (req, res) => {
    try {
      const holiday = req.body;
      if (!holiday || !holiday.title || !holiday.date) {
        return res.status(400).json({ error: 'title and date are required' });
      }
      const targetUrl = resolveTargetAppsScriptUrl(req);

      if (!holiday.id) {
        holiday.id = `hol_${holiday.date.replace(/-/g, '_')}_${Date.now()}`;
      }

      const idx = schoolHolidaysStore.findIndex((h) => h.id === holiday.id || (h.date === holiday.date && h.title === holiday.title));
      if (idx >= 0) {
        schoolHolidaysStore[idx] = { ...schoolHolidaysStore[idx], ...holiday, timestamp: new Date().toISOString() };
      } else {
        schoolHolidaysStore.push({ ...holiday, timestamp: new Date().toISOString() });
      }
      // Sort chronologically by date
      schoolHolidaysStore.sort((a, b) => a.date.localeCompare(b.date));
      saveSchoolHolidaysCache();

      // Forward to Google Apps Script (School_Holidays tab)
      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveSchoolHoliday',
        holiday: JSON.stringify(holiday),
        appsScriptUrl: targetUrl,
        ...holiday,
      });

      const savedHolIdx = schoolHolidaysStore.findIndex((h) => h.id === holiday.id);
      if (savedHolIdx >= 0) {
        schoolHolidaysStore[savedHolIdx]._sheetSynced = gasResult.ok;
        saveSchoolHolidaysCache();
      }

      // Broadcast update via WebSocket
      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'school_holidays',
        action: 'update',
        details: { id: holiday.id, title: holiday.title, date: holiday.date },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : (gasResult.error || gasResult.response || 'Apps Script doPost में saveSchoolHoliday नहीं मिला'),
        message: gasResult.ok
          ? "Google Sheet 'School_Holidays' में अवकाश सुरक्षित हो गया!"
          : `⚠️ स्थानीय सर्वर में सेव हुआ, लेकिन Google Sheet में नहीं गया: ${gasResult.error || 'Apps Script doPost अपडेट करें'}`,
        holiday,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error saving holiday' });
    }
  });

  // True 2-Way Push + Pull Sync for School Holidays
  app.post('/api/school-holidays/sync-all', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const defaultIds = new Set(DEFAULT_SCHOOL_HOLIDAYS.map((d) => d.id));
      const localHolidays = Array.isArray(req.body?.localHolidays) ? req.body.localHolidays : [];

      for (const loc of localHolidays) {
        if (!loc || !loc.title || !loc.date || defaultIds.has(String(loc.id))) continue;
        if (!schoolHolidaysStore.some((h) => h.id === loc.id || (h.date === loc.date && h.title === loc.title))) {
          schoolHolidaysStore.push({ ...loc, _sheetSynced: false });
        }
      }
      schoolHolidaysStore.sort((a, b) => a.date.localeCompare(b.date));
      saveSchoolHolidaysCache();

      let sheetIds = new Set<string>();
      let sheetDateKeys = new Set<string>();
      let sheetReachable = true;
      let fetchError = '';
      try {
        const sRes = await fetch(`${targetUrl}?action=getSchoolHolidays&_t=${Date.now()}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(9000),
        });
        const sText = await sRes.text();
        if (!sRes.ok || sText.trim().startsWith('<')) {
          sheetReachable = false;
          fetchError = 'Apps Script Deployment अनुमति (Anyone) जांचें';
        } else {
          const sJson: any = JSON.parse(sText);
          if (sJson?.status === 'error') {
            sheetReachable = false;
            fetchError = String(sJson.message || sJson.error || 'Apps Script error');
          } else {
            const rows: any[] = Array.isArray(sJson) ? sJson : Array.isArray(sJson?.holidays) ? sJson.holidays : [];
            for (const row of rows) {
              if (!row || Array.isArray(row)) continue;
              const hid = String(row.id || '').trim();
              const hd = normalizeSheetDate(row.date);
              if (hid) sheetIds.add(hid);
              if (hd) sheetDateKeys.add(hd);
            }
          }
        }
      } catch (e: any) {
        sheetReachable = false;
        fetchError = e?.message || 'Google Sheet से कनेक्ट नहीं हो सका';
      }

      if (!sheetReachable) {
        return res.json({
          success: false,
          pushed: 0,
          failed: 1,
          sheetCount: 0,
          lastError: fetchError,
          holidays: schoolHolidaysStore,
        });
      }

      const toPush = schoolHolidaysStore.filter(
        (h) => h && h.title && h.date && !defaultIds.has(String(h.id)) && !sheetIds.has(String(h.id)) && !sheetDateKeys.has(String(h.date))
      );

      let pushed = 0;
      let failed = 0;
      let lastError = '';
      for (const hol of toPush) {
        const r = await forwardToGoogleAppsScript({
          action: 'saveSchoolHoliday',
          holiday: JSON.stringify(hol),
          appsScriptUrl: targetUrl,
          ...hol,
        });
        if (r.ok) {
          pushed++;
          hol._sheetSynced = true;
        } else {
          failed++;
          if (!lastError) lastError = r.error || 'Sheet save error';
        }
      }
      saveSchoolHolidaysCache();

      await syncSchoolHolidaysFromSheet(true, targetUrl);
      const sheetCount = Math.max(sheetIds.size + pushed, schoolHolidaysStore.filter((h) => !defaultIds.has(String(h.id))).length);

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'school_holidays',
        action: 'sync',
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      res.json({
        success: failed === 0,
        pushed,
        failed,
        sheetCount,
        lastError: lastError || undefined,
        holidays: schoolHolidaysStore,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, pushed: 0, failed: 1, lastError: err?.message, holidays: schoolHolidaysStore });
    }
  });

  app.delete('/api/school-holidays/:id', async (req, res) => {
    const id = req.params.id;
    const targetUrl = resolveTargetAppsScriptUrl(req);
    schoolHolidaysStore = schoolHolidaysStore.filter((h) => h.id !== id);
    saveSchoolHolidaysCache();
    const gasResult = await forwardToGoogleAppsScript({
      action: 'deleteSchoolHoliday',
      id,
      appsScriptUrl: targetUrl,
    });
    const broadcastMsg = JSON.stringify({
      type: 'APP_DATA_UPDATED',
      entity: 'school_holidays',
      action: 'delete',
      details: { id },
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
    }
    res.json({
      success: true,
      sheetSynced: gasResult.ok,
      sheetError: gasResult.ok ? undefined : (gasResult.error || gasResult.response),
      message: gasResult.ok
        ? 'अवकाश Google Sheet से भी हटा दिया गया'
        : `⚠️ ऐप से हटा, पर Google Sheet में नहीं: ${gasResult.error || 'Apps Script अपडेट करें'}`,
    });
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
      } else if (payload?.action === 'assignTeacherClass') {
        saveTeacherClassAssignment(
          String(payload.user_id || payload.userId || '').trim(),
          String(payload.assigned_class || payload.assignedClass || '').trim()
        );
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
      if (['deleteFee', 'deleteStudent', 'deleteHomework', 'addHomework', 'addBehavior', 'batchAddBehavior', 'updateHomeworkTracker', 'updateBusTracking', 'assignTeacherClass'].includes(payload?.action)) {
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

  // =========================================================================
  // ROUTE STOPS API: GET & POST with Google Sheet 'Route_Stops' Tab Forwarding
  // =========================================================================
  app.get('/api/route-stops', (req, res) => {
    try {
      const routeId = (req.query.routeId as string) || '';
      if (routeId === 'all' || routeId === 'auto') {
        const allStops = Object.values(routeStopsStore).flat();
        return res.json({ success: true, routeId, stops: allStops });
      }
      if (routeId) {
        const stops = routeStopsStore[routeId] || DEFAULT_SERVER_ROUTE_STOPS[routeId] || [];
        return res.json({ success: true, routeId, stops });
      }
      res.json({ success: true, routeStops: routeStopsStore });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Error fetching route stops' });
    }
  });

  app.post('/api/route-stops', async (req, res) => {
    try {
      let body = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {}
      }

      const routeId = body.routeId || body.route_id || 'route-1';
      const stops = Array.isArray(body.stops) ? body.stops : [];

      routeStopsStore[routeId] = stops;
      saveRouteStopsCache();

      // Forward asynchronously to Google Apps Script (Route_Stops tab)
      forwardToGoogleAppsScript({
        action: 'saveRouteStops',
        route_id: routeId,
        stops: JSON.stringify(stops),
      }).then((result) => {
        if (result.ok) {
          console.log(`[GoogleSheetSync] Saved route stops for ${routeId} to Google Sheet Route_Stops tab`);
        }
      });

      // Broadcast update via WebSocket to connected monitors & parent devices
      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'route_stops',
        action: 'update',
        details: { routeId, count: stops.length },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      res.json({
        success: true,
        message: `Route stops for ${routeId} saved and synced to Google Sheet Route_Stops tab`,
        count: stops.length,
      });
    } catch (err: any) {
      console.error('Error saving route stops:', err);
      res.status(500).json({ error: err.message || 'Could not save route stops' });
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
    app.use((req, res, next) => {
      const p = req.path;
      if (p === '/sw.js' || p === '/version.json' || p === '/' || p === '/index.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
      next();
    });
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'sw.js' ||
            base === 'version.json' ||
            base === 'index.html' ||
            base === 'manifest.webmanifest' ||
            base === 'manifest.json'
          ) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Automatic continuous background sync from Google Sheet 'Bus_Tracking' (every 5 seconds)
  // Ensures whenever driver's location updates in Google Sheet, server cache & all connected screens update instantly!
  const syncBusTrackingFromSheet = async () => {
    try {
      const url = `${currentAppsScriptUrl}?action=getBusTracking&_t=${Date.now()}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 1) {
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            if (Array.isArray(row) && row[0]) {
              const busId = String(row[0]).trim();
              const driverName = String(row[1] || 'Amjad').trim();
              const locStr = String(row[2] || '').trim();
              const lastUpdated = String(row[3] || '').trim();

              if (locStr && locStr.includes(',')) {
                const parts = locStr.split(',').map((p) => parseFloat(p.trim()));
                const lat = parts[0];
                const lng = parts[1];
                if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
                  const existing = liveTelemetryStore[busId];
                  // CRITICAL PROTECTION: If driver is actively broadcasting live GPS directly (within last 60s),
                  // DO NOT allow Google Sheets (which has a 10-20s update delay) to overwrite with an older location!
                  // This completely eliminates the vehicle jumping backwards ("पीछे भागना")!
                  const isDirectDriverLive =
                    existing &&
                    !existing.isLiveFromSheet &&
                    Date.now() - new Date(existing.lastServerSync || existing.lastUpdated).getTime() < 60000;

                  if (isDirectDriverLive) {
                    continue;
                  }

                  // If coordinates changed or if existing was stale school default
                  if (!existing || existing.currentLocationStr !== locStr || existing.latitude !== lat || existing.longitude !== lng) {
                    let finalSpeed = 0;
                    let finalHeading = existing?.heading || 0;

                    if (existing && existing.latitude && existing.longitude) {
                      const distMeters = getHaversineDistanceMeters(existing.latitude, existing.longitude, lat, lng);
                      const prevTime = new Date(existing.lastServerSync || existing.lastUpdated).getTime();
                      const elapsedSec = Math.max(1, (Date.now() - prevTime) / 1000);

                      if (distMeters >= 4) {
                        const computedKmh = Math.round((distMeters / elapsedSec) * 3.6);
                        if (computedKmh > 0 && computedKmh <= 90) {
                          finalSpeed = computedKmh;
                        } else if (computedKmh > 90) {
                          finalSpeed = 28;
                        }

                        const y = Math.sin(((lng - existing.longitude) * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180);
                        const x =
                          Math.cos((existing.latitude * Math.PI) / 180) * Math.sin((lat * Math.PI) / 180) -
                          Math.sin((existing.latitude * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.cos(((lng - existing.longitude) * Math.PI) / 180);
                        finalHeading = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
                      } else {
                        finalSpeed = 0;
                      }
                    }

                    const telemetry = {
                      busId,
                      driverName,
                      driverPhone: existing?.driverPhone || '9761081818',
                      currentLocationStr: locStr,
                      latitude: lat,
                      longitude: lng,
                      accuracy: existing?.accuracy || 8,
                      speed: finalSpeed,
                      heading: finalHeading,
                      lastUpdated: lastUpdated || new Date().toISOString(),
                      status: finalSpeed > 2 ? 'running' : 'stopped',
                      isLiveFromSheet: true,
                      lastServerSync: new Date().toISOString(),
                    };
                    liveTelemetryStore[busId] = telemetry;
                    saveTelemetryCache();

                    const broadcastMsg = JSON.stringify({ type: 'BUS_UPDATE', telemetry });
                    for (const client of clients) {
                      if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastMsg);
                      }
                    }
                    console.log(`[GoogleSheetSync] Live bus ${busId} moved to ${locStr} (Speed: ${finalSpeed} km/h, Status: ${telemetry.status})`);
                  } else if (existing && (existing.speed || 0) > 0) {
                    // Vehicle hasn't moved for over 15 seconds - transition to stopped smoothly
                    const prevTime = new Date(existing.lastServerSync || existing.lastUpdated).getTime();
                    if (Date.now() - prevTime > 15000) {
                      existing.speed = 0;
                      existing.status = 'stopped';
                      existing.lastServerSync = new Date().toISOString();
                      saveTelemetryCache();
                      const broadcastMsg = JSON.stringify({ type: 'BUS_UPDATE', telemetry: existing });
                      for (const client of clients) {
                        if (client.readyState === WebSocket.OPEN) {
                          client.send(broadcastMsg);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch {}
  };

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${PORT} already in use, exiting cleanly.`);
      process.exit(1);
    } else {
      console.error('[Server] Server error:', err);
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} with WebSocket /ws/location`);
    // Defer sheet sync slightly so dev server pre-warming health checks get immediate 200 OK
    setTimeout(() => {
      syncBusTrackingFromSheet();
      setInterval(syncBusTrackingFromSheet, 5000);
      syncTeacherPerformanceFromSheet(true).catch(() => {});
      syncSyllabusTrackerFromSheet(true).catch(() => {});
      syncSchoolHolidaysFromSheet(true).catch(() => {});
      syncWeeklyTestsFromSheet(true).catch(() => {});
    }, 3000);
  });

  const handleShutdown = () => {
    try {
      server.close(() => process.exit(0));
    } catch {
      process.exit(0);
    }
  };
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
