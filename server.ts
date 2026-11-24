import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

// Global resilience handlers to prevent unexpected process exit
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

const pad2 = (n: number) => String(n).padStart(2, '0');

function getLocalTimestampIST(d: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
    const hr = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hr}:${get('minute')}:${get('second')}`;
  } catch {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
}

function getLocalDateIST(d: Date = new Date()): string {
  return getLocalTimestampIST(d).slice(0, 10);
}

const PORT = 3000;
const SERVER_BOOT_AT = getLocalTimestampIST();
const SERVER_BOOT_VERSION = `srv-${SERVER_BOOT_AT.replace(/[-: ]/g, '').slice(0, 14)}`;
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
    lastUpdated: getLocalTimestampIST(),
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

// =========================================================================
// STAFF SALARY CONFIGURATION PERSISTENCE (/api/staff-salary-config)
// =========================================================================
const STAFF_SALARY_CONFIG_FILE = '/tmp/evs_staff_salary_config.json';
let staffSalaryConfigStore: Record<string, any> = {};
try {
  if (fs.existsSync(STAFF_SALARY_CONFIG_FILE)) {
    const rawSalary = fs.readFileSync(STAFF_SALARY_CONFIG_FILE, 'utf-8');
    staffSalaryConfigStore = JSON.parse(rawSalary) || {};
  }
} catch {
  staffSalaryConfigStore = {};
}

function saveStaffSalaryConfigCache() {
  try {
    fs.writeFileSync(STAFF_SALARY_CONFIG_FILE, JSON.stringify(staffSalaryConfigStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write staff salary config cache file:', e);
  }
}

// =========================================================================
// FEE WAIVERS PERSISTENCE (/api/fee-waivers) - Cross-Device Sync
// =========================================================================
const FEE_WAIVERS_FILE = '/tmp/evs_fee_waivers.json';
let feeWaiversStore: Record<string, { isFree: boolean; reason: string; monthlyDiscount?: number; updatedAt: number }> = {};
try {
  if (fs.existsSync(FEE_WAIVERS_FILE)) {
    const rawWaivers = fs.readFileSync(FEE_WAIVERS_FILE, 'utf-8');
    feeWaiversStore = JSON.parse(rawWaivers) || {};
  }
} catch {
  feeWaiversStore = {};
}

function saveFeeWaiversCache() {
  try {
    fs.writeFileSync(FEE_WAIVERS_FILE, JSON.stringify(feeWaiversStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write fee waivers cache file:', e);
  }
}

// =========================================================================
// PARENT REVIEWS & MARKETING TESTIMONIALS PERSISTENCE (/api/parent-reviews)
// =========================================================================
const PARENT_REVIEWS_FILE = '/tmp/evs_parent_reviews.json';
let parentReviewsStore: any[] = [];
try {
  if (fs.existsSync(PARENT_REVIEWS_FILE)) {
    const rawRev = fs.readFileSync(PARENT_REVIEWS_FILE, 'utf-8');
    const parsedRev = JSON.parse(rawRev);
    parentReviewsStore = Array.isArray(parsedRev) ? parsedRev : [];
  }
} catch {
  parentReviewsStore = [];
}

function saveParentReviewsCache() {
  try {
    fs.writeFileSync(PARENT_REVIEWS_FILE, JSON.stringify(parentReviewsStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write parent reviews cache file:', e);
  }
}

// =========================================================================
// SCHOOL UPI SETTINGS & ONLINE FEE PAYMENTS QUEUE (/api/upi-settings, /api/upi-payments)
// =========================================================================
const UPI_SETTINGS_FILE = '/tmp/evs_upi_settings.json';
const DEFAULT_UPI_SETTINGS_STORE = {
  upiId: '',
  payeeName: 'E.V.S. Public School',
  bankName: '',
  instructions: 'QR स्कैन या UPI ऐप से भुगतान करने के बाद 12 अंकों का UTR / Reference No नीचे दर्ज करें।',
  staticQrImage: '',
  updatedAt: '',
};
let upiSettingsStore: any = { ...DEFAULT_UPI_SETTINGS_STORE };
try {
  if (fs.existsSync(UPI_SETTINGS_FILE)) {
    const rawUpi = fs.readFileSync(UPI_SETTINGS_FILE, 'utf-8');
    upiSettingsStore = { ...DEFAULT_UPI_SETTINGS_STORE, ...(JSON.parse(rawUpi) || {}) };
  }
} catch {
  upiSettingsStore = { ...DEFAULT_UPI_SETTINGS_STORE };
}

function saveUpiSettingsCache() {
  try {
    fs.writeFileSync(UPI_SETTINGS_FILE, JSON.stringify(upiSettingsStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write UPI settings cache file:', e);
  }
}

const UPI_PAYMENTS_FILE = '/tmp/evs_upi_payments.json';
let upiPaymentsStore: any[] = [];
try {
  if (fs.existsSync(UPI_PAYMENTS_FILE)) {
    const rawPay = fs.readFileSync(UPI_PAYMENTS_FILE, 'utf-8');
    const parsed = JSON.parse(rawPay);
    upiPaymentsStore = Array.isArray(parsed) ? parsed : [];
  }
} catch {
  upiPaymentsStore = [];
}

function saveUpiPaymentsCache() {
  try {
    fs.writeFileSync(UPI_PAYMENTS_FILE, JSON.stringify(upiPaymentsStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write UPI payments cache file:', e);
  }
}

// =========================================================================
// WHATSAPP ALERT LOGS & STAFF MONTHLY PAYROLL SNAPSHOTS
// =========================================================================
const WHATSAPP_LOGS_FILE = '/tmp/evs_whatsapp_logs.json';
let whatsappLogsStore: any[] = [];
try {
  if (fs.existsSync(WHATSAPP_LOGS_FILE)) {
    const rawWa = fs.readFileSync(WHATSAPP_LOGS_FILE, 'utf-8');
    const parsed = JSON.parse(rawWa);
    whatsappLogsStore = Array.isArray(parsed) ? parsed : [];
  }
} catch {
  whatsappLogsStore = [];
}

function saveWhatsappLogsCache() {
  try {
    fs.writeFileSync(WHATSAPP_LOGS_FILE, JSON.stringify(whatsappLogsStore.slice(0, 500), null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write whatsapp logs cache file:', e);
  }
}

const STAFF_PAYROLL_FILE = '/tmp/evs_staff_salary_payroll.json';
let staffPayrollStore: any[] = [];
try {
  if (fs.existsSync(STAFF_PAYROLL_FILE)) {
    const rawPay = fs.readFileSync(STAFF_PAYROLL_FILE, 'utf-8');
    const parsed = JSON.parse(rawPay);
    staffPayrollStore = Array.isArray(parsed) ? parsed : [];
  }
} catch {
  staffPayrollStore = [];
}

function saveStaffPayrollCache() {
  try {
    fs.writeFileSync(STAFF_PAYROLL_FILE, JSON.stringify(staffPayrollStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write staff payroll cache file:', e);
  }
}

// =========================================================================
// EXAM MARKS (QUARTERLY/HALF-YEARLY/ANNUAL) & REPORT CARD META PERSISTENCE
// =========================================================================
const EXAM_MARKS_FILE = '/tmp/evs_exam_marks.json';
let examMarksStore: any[] = [];
try {
  if (fs.existsSync(EXAM_MARKS_FILE)) {
    const rawEm = fs.readFileSync(EXAM_MARKS_FILE, 'utf-8');
    const parsed = JSON.parse(rawEm);
    examMarksStore = Array.isArray(parsed) ? parsed : [];
  }
} catch {
  examMarksStore = [];
}

function saveExamMarksCache() {
  try {
    fs.writeFileSync(EXAM_MARKS_FILE, JSON.stringify(examMarksStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write exam marks cache file:', e);
  }
}

const REPORT_CARD_META_FILE = '/tmp/evs_report_card_meta.json';
let reportCardMetaStore: Record<string, any> = {};
try {
  if (fs.existsSync(REPORT_CARD_META_FILE)) {
    const rawRc = fs.readFileSync(REPORT_CARD_META_FILE, 'utf-8');
    const parsed = JSON.parse(rawRc);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      reportCardMetaStore = parsed;
    }
  }
} catch {
  reportCardMetaStore = {};
}

function saveReportCardMetaCache() {
  try {
    fs.writeFileSync(REPORT_CARD_META_FILE, JSON.stringify(reportCardMetaStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write report card meta cache file:', e);
  }
}

// =========================================================================
// EXAM HALL PASS / ADMIT CARD CONFIGURATION & FEE-OVERRIDE PERSISTENCE
// =========================================================================
const HALL_PASS_CONFIG_FILE = '/tmp/evs_hall_pass_config.json';
const DEFAULT_HALL_PASS_CONFIG = {
  examType: 'Half-Yearly',
  session: '2026-27',
  customExamTitle: '',
  examScheduleLine: 'Exam: 09:30 AM - 12:00 PM (2.5 Hrs)',
  instructionLine: 'Bring Hall Pass, School ID & stationery daily. Report by 08:45 AM.',
  publishedToParent: true,
  backsideFlipMode: 'book_flip',
  datesheetArrivalLine: 'Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM',
  datesheetHolidayNote: '24/11 Tue: Guru Nanak Jayanti Holiday · 29/11 Sun: Sunday Off',
  datesheetRows: [] as any[],
  allowedOverrides: {} as Record<string, any>,
  updatedAt: '',
};
let hallPassConfigStore: any = { ...DEFAULT_HALL_PASS_CONFIG };
try {
  if (fs.existsSync(HALL_PASS_CONFIG_FILE)) {
    const rawHp = fs.readFileSync(HALL_PASS_CONFIG_FILE, 'utf-8');
    const parsedHp = JSON.parse(rawHp);
    if (parsedHp && typeof parsedHp === 'object' && !Array.isArray(parsedHp)) {
      hallPassConfigStore = { ...DEFAULT_HALL_PASS_CONFIG, ...parsedHp };
    }
  }
} catch {
  hallPassConfigStore = { ...DEFAULT_HALL_PASS_CONFIG };
}

function saveHallPassConfigCache() {
  try {
    fs.writeFileSync(HALL_PASS_CONFIG_FILE, JSON.stringify(hallPassConfigStore, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write hall pass config cache file:', e);
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
      last_updated: payload.lastUpdated || getLocalTimestampIST(),
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
        signal: AbortSignal.timeout(25000),
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
      formattedPayload.action === 'deleteWeeklyTest' ||
      formattedPayload.action === 'deleteExamMark'
    ) {
      try {
        const getUrl = `${targetUrl}?action=${encodeURIComponent(formattedPayload.action)}&id=${encodeURIComponent(formattedPayload.id || '')}`;
        const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(12000) });
        const gText = await gRes.text();
        const gCheck = parseAppsScriptResponse(gText);
        if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
      } catch {}
    } else if (formattedPayload.action === 'saveReportCardMeta') {
      try {
        const metaStr = typeof formattedPayload.meta === 'string' ? formattedPayload.meta : JSON.stringify(formattedPayload.meta || formattedPayload);
        const getUrl = `${targetUrl}?action=saveReportCardMeta&meta=${encodeURIComponent(metaStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveExamMarksBatch') {
      try {
        const recStr = typeof formattedPayload.records === 'string' ? formattedPayload.records : JSON.stringify(formattedPayload.records || []);
        const getUrl = `${targetUrl}?action=saveExamMarksBatch&records=${encodeURIComponent(recStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveHallPassConfig') {
      try {
        const cfgStr = typeof formattedPayload.config === 'string' ? formattedPayload.config : JSON.stringify(formattedPayload.config || formattedPayload);
        const getUrl = `${targetUrl}?action=saveHallPassConfig&config=${encodeURIComponent(cfgStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveFeeWaiver') {
      try {
        const getUrl = `${targetUrl}?action=saveFeeWaiver&studentId=${encodeURIComponent(formattedPayload.studentId || '')}&isFree=${encodeURIComponent(String(Boolean(formattedPayload.isFree)))}&reason=${encodeURIComponent(formattedPayload.reason || '')}&monthlyDiscount=${encodeURIComponent(String(Math.max(0, Math.round(Number(formattedPayload.monthlyDiscount) || 0))))}&updatedAt=${encodeURIComponent(String(formattedPayload.updatedAt || Date.now()))}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveFeeWaiversBatch') {
      try {
        const entStr = typeof formattedPayload.entries === 'string' ? formattedPayload.entries : JSON.stringify(formattedPayload.entries || {});
        const getUrl = `${targetUrl}?action=saveFeeWaiversBatch&entries=${encodeURIComponent(entStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveParentReview') {
      try {
        const revStr = typeof formattedPayload.review === 'string' ? formattedPayload.review : JSON.stringify(formattedPayload.review || formattedPayload);
        const getUrl = `${targetUrl}?action=saveParentReview&review=${encodeURIComponent(revStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'updateParentReviewStatus') {
      try {
        const params = new URLSearchParams({
          action: 'updateParentReviewStatus',
          reviewId: String(formattedPayload.reviewId || formattedPayload.id || ''),
        });
        if (formattedPayload.status !== undefined) params.set('status', String(formattedPayload.status));
        if (formattedPayload.featured !== undefined) params.set('featured', String(formattedPayload.featured));
        if (formattedPayload.marketingConsent !== undefined) params.set('marketingConsent', String(formattedPayload.marketingConsent));
        const getUrl = `${targetUrl}?${params.toString()}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'deleteParentReview') {
      try {
        const getUrl = `${targetUrl}?action=deleteParentReview&id=${encodeURIComponent(String(formattedPayload.reviewId || formattedPayload.id || ''))}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveExamSeatingDraft') {
      try {
        const draftStr =
          typeof formattedPayload.draftConfig === 'string'
            ? formattedPayload.draftConfig
            : JSON.stringify(formattedPayload.draftConfig || {});
        const getUrl = `${targetUrl}?action=saveExamSeatingDraft&draftConfig=${encodeURIComponent(draftStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveReportCardAccess') {
      try {
        const accStr =
          typeof formattedPayload.accessConfig === 'string'
            ? formattedPayload.accessConfig
            : JSON.stringify(formattedPayload.accessConfig || {});
        const getUrl = `${targetUrl}?action=saveReportCardAccess&accessConfig=${encodeURIComponent(accStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'saveReportCardDraft') {
      try {
        const drStr =
          typeof formattedPayload.draft === 'string'
            ? formattedPayload.draft
            : JSON.stringify(formattedPayload.draft || {});
        const getUrl = `${targetUrl}?action=saveReportCardDraft&draft=${encodeURIComponent(drStr)}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    } else if (formattedPayload.action === 'assignTeacherClass' || formattedPayload.action === 'updateUserClass') {
      try {
        const params = new URLSearchParams({
          action: 'assignTeacherClass',
          user_id: String(formattedPayload.user_id || formattedPayload.userId || ''),
          assigned_class: String(formattedPayload.assigned_class ?? formattedPayload.assignedClass ?? ''),
        });
        if (formattedPayload.name || formattedPayload.user_name) {
          params.set('name', String(formattedPayload.name || formattedPayload.user_name));
        }
        if (formattedPayload.username) {
          params.set('username', String(formattedPayload.username));
        }
        const getUrl = `${targetUrl}?${params.toString()}`;
        if (getUrl.length < 7500) {
          const gRes = await fetch(getUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
          const gText = await gRes.text();
          const gCheck = parseAppsScriptResponse(gText);
          if (gRes.ok && gCheck.ok) return { ok: true, response: gText };
        }
      } catch {}
    }

    return { ok: false, error: postCheck.error || `HTTP ${lastPostStatus || 500}`, response: lastPostText };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// =========================================================================
// 2-WAY GOOGLE SHEET READ SYNC FOR TEACHER PERFORMANCE, SYLLABUS, HOLIDAYS & HALL PASS
// =========================================================================
let lastTpSheetSync = 0;
let lastSyllabusSheetSync = 0;
let lastHolidaySheetSync = 0;
let lastWeeklyTestSheetSync = 0;
let lastHallPassSheetSync = 0;

const SERVER_SPREADSHEET_ID = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU';
const SERVER_DATESHEET_COLS = ['Play', 'M1', 'M2', 'M3', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6 & 7', 'Class 8'];

function matchServerDatesheetHeader(rawHeader: string): string | null {
  const norm = String(rawHeader || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const compact = norm.replace(/[^a-z0-9&]/g, '');
  if (!norm) return null;
  if (norm === 'date' || compact === 'examdate') return 'date';
  if (norm === 'day') return 'day';
  if (norm === 'play' || compact === 'playgroup' || compact === 'playclass') return 'Play';
  if (norm === 'm1' || norm === 'nursery' || compact === 'nurserym1') return 'M1';
  if (norm === 'm2' || norm === 'lkg' || compact === 'lkgm2') return 'M2';
  if (norm === 'm3' || norm === 'ukg' || compact === 'ukgm3') return 'M3';
  if (compact === 'class1' || norm === '1st' || norm === '1') return 'Class 1';
  if (compact === 'class2' || norm === '2nd' || norm === '2') return 'Class 2';
  if (compact === 'class3' || norm === '3rd' || norm === '3') return 'Class 3';
  if (compact === 'class4' || norm === '4th' || norm === '4') return 'Class 4';
  if (compact === 'class5' || norm === '5th' || norm === '5') return 'Class 5';
  if (compact === 'class6&7' || compact === 'class67' || compact === '6&7' || compact === '6th&7th' || compact === 'class6' || compact === 'class7') {
    return 'Class 6 & 7';
  }
  if (compact === 'class8' || norm === '8th' || norm === '8') return 'Class 8';
  return null;
}

function formatServerGvizCell(cell: any, isDateCol: boolean): string {
  if (!cell) return '';
  if (cell.f && String(cell.f).trim()) return String(cell.f).trim();
  const v = cell.v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    const gDate = v.match(/^Date\((\d+),(\d+),(\d+)/);
    if (gDate && isDateCol) {
      return `${gDate[3].padStart(2, '0')}/${String(Number(gDate[2]) + 1).padStart(2, '0')}/${gDate[1]}`;
    }
    return v.trim();
  }
  return String(v).trim();
}

async function fetchExamDatesheetGvizServer(): Promise<any[] | null> {
  for (const tab of ['Exam_Datesheet', 'Exam Datesheet', 'Datesheet']) {
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${SERVER_SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}&_t=${Date.now()}`;
      const res = await fetch(gvizUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text();
      const m = text.match(/setResponse\(([\s\S]*)\);?\s*$/);
      if (!m) continue;
      const json: any = JSON.parse(m[1]);
      const cols = Array.isArray(json?.table?.cols) ? json.table.cols : [];
      const rows = Array.isArray(json?.table?.rows) ? json.table.rows : [];
      if (rows.length === 0) continue;

      const hasColLabels = cols.some((c: any) => String(c?.label || '').trim().length > 0);
      const rawHeaders: string[] = hasColLabels
        ? cols.map((c: any) => String(c?.label || '').trim())
        : (rows[0]?.c || []).map((c: any) => formatServerGvizCell(c, false));
      const dataRows = hasColLabels ? rows : rows.slice(1);

      const mappedCols = rawHeaders.map((h) => matchServerDatesheetHeader(h));
      const dateIdx = mappedCols.indexOf('date');
      const hasClassCol = mappedCols.some((c) => c && c !== 'date' && c !== 'day');
      if (dateIdx === -1 || !hasClassCol) continue;

      const parsedRows: any[] = [];
      for (const r of dataRows) {
        const cells = Array.isArray(r?.c) ? r.c : [];
        let dateVal = '';
        let dayVal = '';
        const subjects: Record<string, string> = {};
        SERVER_DATESHEET_COLS.forEach((col) => { subjects[col] = ''; });
        let hasContent = false;
        mappedCols.forEach((target, idx) => {
          if (!target) return;
          const cellText = formatServerGvizCell(cells[idx], target === 'date');
          if (target === 'date') dateVal = cellText;
          else if (target === 'day') dayVal = cellText;
          else {
            subjects[target] = cellText;
            if (cellText) hasContent = true;
          }
        });
        if (!subjects['Play'] && subjects['M1']) subjects['Play'] = subjects['M1'];
        if (dateVal || dayVal || hasContent) {
          parsedRows.push({ date: dateVal, day: dayVal, subjects });
        }
      }
      if (parsedRows.length > 0) return parsedRows;
    } catch {}
  }
  return null;
}

async function syncHallPassConfigFromGoogleSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastHallPassSheetSync < 25000) return false;
  lastHallPassSheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getHallPassConfig&_t=${now}`;
    const [cfgResult, gvizRows] = await Promise.all([
      fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) })
        .then(async (res) => {
          if (!res.ok) return null;
          const text = await res.text();
          if (!text || text.trim().startsWith('<')) return null;
          const json: any = JSON.parse(text);
          return json && json.status !== 'error' && json.config && typeof json.config === 'object' ? json.config : null;
        })
        .catch(() => null),
      fetchExamDatesheetGvizServer().catch(() => null),
    ]);

    if (!cfgResult && (!gvizRows || gvizRows.length === 0)) {
      return false;
    }

    const sc = cfgResult || {};
    const resolvedRows =
      Array.isArray(gvizRows) && gvizRows.length > 0
        ? gvizRows
        : Array.isArray(sc.datesheetRows) && sc.datesheetRows.length > 0
        ? sc.datesheetRows
        : hallPassConfigStore.datesheetRows;

    hallPassConfigStore = {
      ...DEFAULT_HALL_PASS_CONFIG,
      ...hallPassConfigStore,
      examType: sc.examType || hallPassConfigStore.examType,
      session: sc.session || hallPassConfigStore.session,
      customExamTitle: sc.customExamTitle !== undefined ? String(sc.customExamTitle) : hallPassConfigStore.customExamTitle,
      examScheduleLine: sc.examScheduleLine || hallPassConfigStore.examScheduleLine,
      instructionLine: sc.instructionLine || hallPassConfigStore.instructionLine,
      publishedToParent: sc.publishedToParent !== undefined ? Boolean(sc.publishedToParent) : hallPassConfigStore.publishedToParent,
      backsideFlipMode: sc.backsideFlipMode === 'row_flip' ? 'row_flip' : (sc.backsideFlipMode === 'book_flip' ? 'book_flip' : hallPassConfigStore.backsideFlipMode),
      datesheetArrivalLine: sc.datesheetArrivalLine || hallPassConfigStore.datesheetArrivalLine,
      datesheetHolidayNote: sc.datesheetHolidayNote || hallPassConfigStore.datesheetHolidayNote,
      datesheetRows: resolvedRows,
      allowedOverrides:
        sc.allowedOverrides && typeof sc.allowedOverrides === 'object' && !Array.isArray(sc.allowedOverrides)
          ? sc.allowedOverrides
          : hallPassConfigStore.allowedOverrides || {},
      updatedAt: sc.updatedAt || hallPassConfigStore.updatedAt || '',
    };
    saveHallPassConfigCache();
    return true;
  } catch {
    return false;
  }
}

let lastFeeWaiversSheetSync = 0;

async function syncFeeWaiversFromGoogleSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastFeeWaiversSheetSync < 25000) return false;
  lastFeeWaiversSheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getFeeWaivers&_t=${now}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return false;
    const json: any = JSON.parse(text);
    if (!json || json.status === 'error' || !json.waivers || typeof json.waivers !== 'object') {
      return false;
    }

    let changed = false;
    for (const [rawId, val] of Object.entries(json.waivers as Record<string, any>)) {
      const sId = String(rawId || '').trim().toLowerCase();
      if (!sId || !val || typeof val !== 'object') continue;
      const incomingTs = Number(val.updatedAt) || 0;
      const existing = feeWaiversStore[sId];
      if (!existing || (incomingTs > 0 && incomingTs >= (Number(existing.updatedAt) || 0))) {
        const nextEntry = {
          isFree: Boolean(val.isFree),
          reason: String(val.reason || ''),
          monthlyDiscount: Math.max(0, Math.round(Number(val.monthlyDiscount) || 0)),
          updatedAt: incomingTs || Date.now(),
        };
        if (
          !existing ||
          existing.isFree !== nextEntry.isFree ||
          existing.reason !== nextEntry.reason ||
          (Number(existing.monthlyDiscount) || 0) !== nextEntry.monthlyDiscount ||
          incomingTs > (Number(existing.updatedAt) || 0)
        ) {
          feeWaiversStore[sId] = nextEntry;
          changed = true;
        }
      }
    }
    if (changed) {
      saveFeeWaiversCache();
    }
    return true;
  } catch {
    return false;
  }
}

let lastParentReviewsSheetSync = 0;

async function syncParentReviewsFromGoogleSheet(force = false, overrideUrl?: string): Promise<boolean> {
  const now = Date.now();
  if (!force && now - lastParentReviewsSheetSync < 25000) return false;
  lastParentReviewsSheetSync = now;
  try {
    const baseUrl = overrideUrl || currentAppsScriptUrl;
    const url = `${baseUrl}?action=getParentReviews&_t=${now}`;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) return false;
    const json: any = JSON.parse(text);
    if (!json || json.status === 'error' || !Array.isArray(json.reviews)) {
      return false;
    }

    const parsed: any[] = json.reviews.map((r: any) => ({
      id: String(r.id || '').trim(),
      studentId: String(r.studentId || '').trim(),
      studentName: String(r.studentName || '').trim(),
      className: String(r.className || '').trim(),
      parentName: String(r.parentName || '').trim(),
      fatherName: String(r.fatherName || '').trim(),
      parentMobile: String(r.parentMobile || '').trim(),
      rating: Math.min(5, Math.max(1, Number(r.rating || 5))),
      category: String(r.category || 'संपूर्ण अनुभव').trim(),
      reviewText: String(r.reviewText || '').trim(),
      photoUrl: String(r.photoUrl || ''),
      marketingConsent: Boolean(r.marketingConsent),
      status: r.status === 'approved' || r.status === 'hidden' ? r.status : 'pending',
      featured: Boolean(r.featured),
      source: String(r.source || 'parent_portal'),
      createdAt: String(r.createdAt || getLocalTimestampIST()),
      updatedAt: String(r.updatedAt || r.createdAt || getLocalTimestampIST()),
      surveyAnswers: Array.isArray(r.surveyAnswers) ? r.surveyAnswers : [],
      yesCount: r.yesCount !== undefined ? Number(r.yesCount) : undefined,
      totalQuestions: r.totalQuestions !== undefined ? Number(r.totalQuestions) : undefined,
      satisfactionPct: r.satisfactionPct !== undefined ? Number(r.satisfactionPct) : undefined,
      _sheetSynced: true,
    })).filter((r: any) => r.id && r.reviewText);

    const existingMap = new Map(parentReviewsStore.map((x) => [String(x.id).toLowerCase(), x]));
    const sheetIds = new Set(parsed.map((p) => String(p.id).toLowerCase()));

    const mergedFromSheet = parsed.map((sh) => {
      const loc = existingMap.get(String(sh.id).toLowerCase());
      if (loc && loc.updatedAt && sh.updatedAt) {
        const locMs = Date.parse(String(loc.updatedAt)) || 0;
        const shMs = Date.parse(String(sh.updatedAt)) || 0;
        if (locMs > shMs + 1000) {
          return loc;
        }
      }
      return {
        ...sh,
        photoUrl: sh.photoUrl || loc?.photoUrl || '',
      };
    });

    const localPending = parentReviewsStore.filter(
      (loc) =>
        !sheetIds.has(String(loc.id).toLowerCase()) &&
        (loc._sheetSynced !== true || (loc.createdAt && Date.now() - (Date.parse(String(loc.createdAt)) || 0) < 45000))
    );

    parentReviewsStore = [...localPending, ...mergedFromSheet].sort((a, b) => {
      const tA = Date.parse(String(a.createdAt || '')) || 0;
      const tB = Date.parse(String(b.createdAt || '')) || 0;
      return tB - tA;
    });
    saveParentReviewsCache();
    return true;
  } catch {
    return false;
  }
}

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
          evaluation_date: normalizeSheetDate(r[15]) || getLocalDateIST(),
          timestamp: r[15] ? String(r[15]) : getLocalTimestampIST(),
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
          evaluation_date: normalizeSheetDate(obj.evaluation_date ?? obj.Timestamp) || getLocalDateIST(),
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? getLocalTimestampIST()),
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
          planned_date: normalizeSheetDate(r[10]) || getLocalDateIST(),
          target_completion_date: normalizeSheetDate(r[11]) || getLocalDateIST(),
          completed_date: normalizeSheetDate(r[12]) || undefined,
          status,
          timestamp: r[14] ? String(r[14]) : getLocalTimestampIST(),
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
          planned_date: normalizeSheetDate(obj.planned_date ?? obj.Planned_Date) || getLocalDateIST(),
          target_completion_date: normalizeSheetDate(obj.target_completion_date ?? obj.Target_Completion_Date) || getLocalDateIST(),
          completed_date: normalizeSheetDate(obj.completed_date ?? obj.Completed_Date) || undefined,
          status,
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? getLocalTimestampIST()),
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
        const testDate = normalizeSheetDate(r[7]) || getLocalDateIST();
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
          timestamp: r[16] ? String(r[16]) : getLocalTimestampIST(),
          _sheetSynced: true,
        });
      }
    } else {
      for (const obj of rawRows) {
        if (!obj || (!obj.student_id && !obj.student_name && !obj.Student_ID && !obj.Student_Name)) continue;
        const testDate = normalizeSheetDate(obj.test_date ?? obj.Test_Date) || getLocalDateIST();
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
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? getLocalTimestampIST()),
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
          timestamp: r[6] ? String(r[6]) : getLocalTimestampIST(),
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
          timestamp: String(obj.timestamp ?? obj.Timestamp ?? getLocalTimestampIST()),
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
  const now = getLocalTimestampIST();
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
      timestamp: getLocalTimestampIST(),
      buses: Object.keys(liveTelemetryStore),
      appsScriptUrl: currentAppsScriptUrl,
      wsClients: clients.size,
    });
  });

  // Live App Version endpoint for installed PWA + GitHub update detection
  let githubCheckCache: { checkedAt: number; latestSha: string | null; repo: string | null } = {
    checkedAt: 0,
    latestSha: null,
    repo: null,
  };

  function resolveGitHubRepo(): string | null {
    const envRepo = String(process.env.GITHUB_REPO || process.env.VITE_GITHUB_REPO || '').trim();
    if (envRepo && envRepo.includes('/')) return envRepo.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
    try {
      const pkgPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const rawRepo = typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url;
        if (rawRepo) {
          const m = String(rawRepo).match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?/i);
          if (m?.[1]) return m[1];
        }
      }
    } catch {}
    return null;
  }

  let localGitHeadSha = '';
  try {
    const { execSync } = await import('child_process');
    localGitHeadSha = String(execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
  } catch {}

  app.get('/api/app-version', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let version = SERVER_BOOT_VERSION;
    let builtAt = SERVER_BOOT_AT;
    let mode = process.env.NODE_ENV === 'production' ? 'production' : 'dev';
    let builtSha = String(process.env.GITHUB_SHA || process.env.COMMIT_SHA || localGitHeadSha || '').trim();

    try {
      const distVersionFile = path.join(process.cwd(), 'dist', 'version.json');
      if (process.env.NODE_ENV === 'production' && fs.existsSync(distVersionFile)) {
        const parsed = JSON.parse(fs.readFileSync(distVersionFile, 'utf-8'));
        version = parsed?.version || SERVER_BOOT_VERSION;
        builtAt = parsed?.builtAt || SERVER_BOOT_AT;
        if (parsed?.githubSha) builtSha = String(parsed.githubSha).trim();
        mode = 'production';
      }
    } catch {}

    let githubLatestSha: string | null = null;
    let hasGitHubUpdate = false;
    const repo = resolveGitHubRepo();
    if (repo) {
      const nowMs = Date.now();
      if (nowMs - githubCheckCache.checkedAt > 60_000 || githubCheckCache.repo !== repo) {
        githubCheckCache.checkedAt = nowMs;
        githubCheckCache.repo = repo;
        try {
          const branch = String(process.env.GITHUB_BRANCH || 'main').trim();
          const ghRes = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'evs-school-portal' },
            signal: AbortSignal.timeout(3500),
          });
          if (ghRes.ok) {
            const ghData: any = await ghRes.json();
            if (ghData?.sha) githubCheckCache.latestSha = String(ghData.sha).trim();
          }
        } catch {}
      }
      githubLatestSha = githubCheckCache.latestSha;
      if (githubLatestSha && builtSha && !githubLatestSha.toLowerCase().startsWith(builtSha.toLowerCase())) {
        hasGitHubUpdate = true;
      }
    }

    res.json({
      version,
      builtAt,
      mode,
      hasGitHubUpdate,
      githubLatestSha,
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
  const TEACHER_PROFILES_FILE = '/tmp/evs_teacher_profiles.json';
  const TEACHER_QR_ATTENDANCE_ACCESS_FILE = '/tmp/evs_teacher_qr_attendance_access.json';

  interface TeacherProfileEntry {
    assigned_subjects?: string;
    department?: string;
    teacher_photo?: string;
    updated_at?: string;
    updated_by?: string;
  }

  const getTeacherProfilesStore = (): Record<string, TeacherProfileEntry> => {
    try {
      if (fs.existsSync(TEACHER_PROFILES_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(TEACHER_PROFILES_FILE, 'utf-8'));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.warn('Error reading teacher profiles file:', e);
    }
    return {};
  };

  const saveTeacherProfileStore = (
    userId: string,
    profile: TeacherProfileEntry,
    userName?: string,
    username?: string
  ): Record<string, TeacherProfileEntry> => {
    const profiles = getTeacherProfilesStore();
    const cleanId = String(userId || '').trim();
    const cleanName = String(userName || '').trim();
    const cleanUser = String(username || '').trim();
    const nextEntry: TeacherProfileEntry = {
      assigned_subjects: String(profile.assigned_subjects ?? '').trim(),
      department: String(profile.department ?? '').trim(),
      teacher_photo: String(profile.teacher_photo ?? '').trim(),
      updated_at: getLocalTimestampIST(),
      updated_by: String(profile.updated_by || 'Manager'),
    };
    const keys = [
      cleanId,
      cleanId.toLowerCase(),
      cleanUser,
      cleanUser.toLowerCase(),
      cleanName,
      cleanName.toLowerCase(),
    ].filter(Boolean);
    for (const k of keys) {
      profiles[k] = nextEntry;
    }
    try {
      fs.writeFileSync(TEACHER_PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error saving teacher profiles file:', e);
    }
    return profiles;
  };

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
    updated_at: getLocalTimestampIST(),
    updated_by: 'School Location Registered',
  };

  const DEFAULT_SCHOOL_SHIFT_SETTINGS = {
    schoolOpeningTime: '08:00 AM',
    schoolClosingTime: '02:00 PM',
    graceMinutes: 15,
    overtimeThresholdMinutes: 15,
    fullDayMinHours: 5.5,
    halfDayMinHours: 3.0,
    updated_at: getLocalTimestampIST(),
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
      updated_at: getLocalTimestampIST(),
      updated_by: body.updated_by || 'Manager',
    };
    try {
      fs.writeFileSync(SCHOOL_SHIFT_SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error writing school shift settings file:', e);
    }
    return updated;
  };

  const getTeacherQrAttendanceAccess = () => {
    try {
      if (fs.existsSync(TEACHER_QR_ATTENDANCE_ACCESS_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(TEACHER_QR_ATTENDANCE_ACCESS_FILE, 'utf-8'));
        return {
          enabled: Boolean(parsed?.enabled),
          updatedBy: String(parsed?.updatedBy || ''),
          updatedAt: String(parsed?.updatedAt || ''),
        };
      }
    } catch (e) {
      console.warn('Error reading teacher QR attendance access file:', e);
    }
    return { enabled: false, updatedBy: '', updatedAt: '' };
  };

  const saveTeacherQrAttendanceAccess = (body: any) => {
    const updated = {
      enabled: Boolean(body?.enabled),
      updatedBy: String(body?.updatedBy || 'Manager'),
      updatedAt: getLocalTimestampIST(),
    };
    try {
      fs.writeFileSync(TEACHER_QR_ATTENDANCE_ACCESS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    } catch (e) {
      console.warn('Error writing teacher QR attendance access file:', e);
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
      updated_at: getLocalTimestampIST(),
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
      Date: item.date || item.Date || getLocalDateIST(),
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
      const dt = it.date || it.Date || getLocalDateIST();
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
    const dateStr = item.date || item.Date || getLocalDateIST();
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
    const date = item.date || item.Date || getLocalDateIST();
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
      created_at: item.created_at || getLocalTimestampIST(),
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
      last_updated: getLocalTimestampIST(),
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
      const cleanDate = item.date || getLocalDateIST();
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

  let syncRcWorkflowHook: ((targetUrl: string, force?: boolean) => Promise<boolean>) | null = null;

  // Endpoints for Manager-controlled Teacher Instant QR Attendance Access (All Classes)
  app.get('/api/teacher-qr-attendance-access', async (req, res) => {
    const localAccess = getTeacherQrAttendanceAccess();
    const forceRefresh = req.query.refresh === '1' || req.query.fresh === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    let sheetSynced = false;
    if (syncRcWorkflowHook) {
      sheetSynced = await syncRcWorkflowHook(targetUrl, forceRefresh || !localAccess.updatedAt);
    }
    const latestLocalAccess = getTeacherQrAttendanceAccess();
    res.json({ success: true, sheetSynced, access: latestLocalAccess });
  });

  app.post('/api/teacher-qr-attendance-access', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      // Ensure sibling workflow permissions (allowTeacherPtmView / allowParentView) are hydrated from Sheet before saving
      if (syncRcWorkflowHook && !reportCardWorkflowStore.accessConfig.updatedAt) {
        await syncRcWorkflowHook(targetUrl, true);
      }

      const updated = saveTeacherQrAttendanceAccess(req.body);

      reportCardWorkflowStore.accessConfig = {
        ...reportCardWorkflowStore.accessConfig,
        allowTeacherQrAttendance: updated.enabled,
        updatedBy: updated.updatedBy,
        updatedAt: updated.updatedAt,
      };
      saveReportCardWorkflowCache();

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'teacher_qr_attendance_access',
        action: 'update',
        details: updated,
        timestamp: Date.now(),
      });
      const wfBroadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'report_card_workflow',
        action: 'access_updated',
        details: updated,
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
          client.send(wfBroadcastMsg);
        }
      }

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveReportCardAccess',
        accessConfig: JSON.stringify(reportCardWorkflowStore.accessConfig),
        appsScriptUrl: targetUrl,
      });

      res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        access: updated,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || 'Failed to update teacher QR attendance access' });
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

  // Endpoints for Extended Teacher Profiles (Assigned_Subjects, Department, Teacher_Photo)
  app.get('/api/teacher-profiles', async (req, res) => {
    let localProfiles = getTeacherProfilesStore();
    const forceRefresh = req.query.refresh === '1' || req.query.sync === '1' || Object.keys(localProfiles).length === 0;
    const targetUrl = resolveTargetAppsScriptUrl(req);
    if (forceRefresh && targetUrl) {
      try {
        const sep = targetUrl.includes('?') ? '&' : '?';
        const gRes = await fetch(`${targetUrl}${sep}action=getTeacherProfiles`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        if (gRes.ok) {
          const gJson: any = await gRes.json().catch(() => null);
          if (gJson && gJson.profiles && typeof gJson.profiles === 'object') {
            localProfiles = { ...gJson.profiles, ...localProfiles };
            if (req.query.refresh === '1') {
              // Sheet wins on explicit refresh when entries are newer
              for (const [k, v] of Object.entries(gJson.profiles as Record<string, TeacherProfileEntry>)) {
                const existing = localProfiles[k];
                if (!existing || String(v?.updated_at || '') >= String(existing?.updated_at || '')) {
                  localProfiles[k] = v;
                }
              }
            }
            try {
              fs.writeFileSync(TEACHER_PROFILES_FILE, JSON.stringify(localProfiles, null, 2), 'utf-8');
            } catch {}
          }
        }
      } catch {}
    }
    res.json({ profiles: localProfiles });
  });

  app.post('/api/teacher-profile', (req, res) => {
    const {
      userId,
      user_id,
      userName,
      user_name,
      username,
      assigned_subjects,
      department,
      teacher_photo,
      updated_by,
      appsScriptUrl,
    } = req.body || {};

    const resolvedId = String(userId || user_id || '').trim();
    const resolvedName = String(userName || user_name || '').trim();
    const resolvedUsername = String(username || '').trim();

    const updated = saveTeacherProfileStore(
      resolvedId,
      {
        assigned_subjects: String(assigned_subjects ?? '').trim(),
        department: String(department ?? '').trim(),
        teacher_photo: String(teacher_photo ?? '').trim(),
        updated_by: String(updated_by || 'Manager'),
      },
      resolvedName || undefined,
      resolvedUsername || undefined
    );

    const updateBroadcast = JSON.stringify({
      type: 'APP_DATA_UPDATED',
      entity: 'users',
      action: 'saveTeacherProfile',
      details: { userId: resolvedId, userName: resolvedName, username: resolvedUsername },
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(updateBroadcast);
      }
    }

    forwardToGoogleAppsScript({
      action: 'saveTeacherProfile',
      user_id: resolvedId,
      user_name: resolvedName,
      username: resolvedUsername,
      assigned_subjects: String(assigned_subjects ?? '').trim(),
      department: String(department ?? '').trim(),
      teacher_photo: String(teacher_photo ?? '').trim(),
      updated_by: String(updated_by || 'Manager'),
      appsScriptUrl: appsScriptUrl || req.headers['x-apps-script-url'] || currentAppsScriptUrl,
    }).catch(() => {});

    res.json({ success: true, profiles: updated });
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
        teacherPerformanceStore[idx] = { ...teacherPerformanceStore[idx], ...record, timestamp: getLocalTimestampIST() };
      } else {
        teacherPerformanceStore.unshift({ ...record, timestamp: getLocalTimestampIST() });
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
        syllabusTrackerStore[idx] = { ...syllabusTrackerStore[idx], ...topic, timestamp: getLocalTimestampIST() };
      } else {
        syllabusTrackerStore.unshift({ ...topic, timestamp: getLocalTimestampIST() });
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

      const nowIso = getLocalTimestampIST();
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
        schoolHolidaysStore[idx] = { ...schoolHolidaysStore[idx], ...holiday, timestamp: getLocalTimestampIST() };
      } else {
        schoolHolidaysStore.push({ ...holiday, timestamp: getLocalTimestampIST() });
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
        const cleanDate = payload.date || getLocalDateIST();
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
        const cleanDate = payload.date || getLocalDateIST();
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

  // =========================================================================
  // FEATURE 2 BACKUP: WHATSAPP ALERT LOGS (/api/whatsapp-logs)
  // =========================================================================
  app.get('/api/whatsapp-logs', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (whatsappLogsStore.length === 0 || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getWhatsappLogs&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed?.logs)) {
              const seen = new Set(whatsappLogsStore.map((l) => l.id));
              for (const row of parsed.logs) {
                if (row?.id && !seen.has(row.id)) {
                  whatsappLogsStore.push(row);
                  seen.add(row.id);
                }
              }
              saveWhatsappLogsCache();
            }
          }
        } catch {}
      }
      return res.json({ success: true, logs: whatsappLogsStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error fetching WhatsApp logs' });
    }
  });

  app.post('/api/whatsapp-logs', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const raw = req.body?.log || req.body || {};
      const now = new Date();
      const entry = {
        id: String(raw.id || `WA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
        date: String(raw.date || getLocalDateIST(now)),
        time: String(raw.time || now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })),
        alertType: String(raw.alertType || 'WhatsApp Alert').trim(),
        recipientType: String(raw.recipientType || 'Parent').trim(),
        recipientId: String(raw.recipientId || '').trim(),
        recipientName: String(raw.recipientName || '').trim(),
        classOrRole: String(raw.classOrRole || '').trim(),
        mobile: String(raw.mobile || '').trim(),
        amount: Number(raw.amount || 0),
        summary: String(raw.summary || '').trim().slice(0, 350),
        sentBy: String(raw.sentBy || 'Manager').trim(),
      };
      whatsappLogsStore = [entry, ...whatsappLogsStore.filter((l) => l.id !== entry.id)].slice(0, 500);
      saveWhatsappLogsCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'logWhatsappAlert',
        log: entry,
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        log: entry,
        logs: whatsappLogsStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error logging WhatsApp alert' });
    }
  });

  // =========================================================================
  // FEATURE 5: STAFF SALARY & LATE/OVERTIME CONFIG & PAYROLL BACKUP ROUTES
  // =========================================================================
  app.get('/api/staff-salary-config', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (Object.keys(staffSalaryConfigStore).length === 0 || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getStaffSalaryConfig&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (parsed?.configs && typeof parsed.configs === 'object') {
              staffSalaryConfigStore = { ...parsed.configs, ...staffSalaryConfigStore };
              saveStaffSalaryConfigCache();
            }
          }
        } catch {}
      }
    } catch {}
    res.json({ success: true, configs: staffSalaryConfigStore });
  });

  app.post('/api/staff-salary-config', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const cfg = req.body?.config || req.body;
      const userId = String(cfg?.userId || '').trim();
      if (!userId) {
        return res.status(400).json({ success: false, error: 'userId is required' });
      }
      const savedEntry = {
        ...cfg,
        userId,
        updatedAt: getLocalTimestampIST(),
      };
      staffSalaryConfigStore[userId] = savedEntry;
      saveStaffSalaryConfigCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveStaffSalaryConfig',
        config: savedEntry,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'staff_salary_config',
        action: 'save',
        details: { userId },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        configs: staffSalaryConfigStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error saving salary config' });
    }
  });

  app.get('/api/staff-salary-payroll', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (staffPayrollStore.length === 0 || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getStaffSalaryPayroll&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed?.payroll)) {
              const map = new Map<string, any>();
              for (const row of parsed.payroll) {
                if (row?.payrollKey) map.set(row.payrollKey, row);
              }
              for (const cur of staffPayrollStore) {
                if (cur?.payrollKey) map.set(cur.payrollKey, cur);
              }
              staffPayrollStore = Array.from(map.values());
              saveStaffPayrollCache();
            }
          }
        } catch {}
      }
      return res.json({ success: true, payroll: staffPayrollStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error reading payroll backup' });
    }
  });

  app.post('/api/staff-salary-payroll', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const records: any[] = Array.isArray(req.body?.records)
        ? req.body.records
        : req.body?.record
        ? [req.body.record]
        : [];
      const configsPayload = req.body?.configs && typeof req.body.configs === 'object' ? req.body.configs : null;

      if (configsPayload) {
        for (const k of Object.keys(configsPayload)) {
          if (configsPayload[k]?.userId) {
            staffSalaryConfigStore[configsPayload[k].userId] = configsPayload[k];
          }
        }
        saveStaffSalaryConfigCache();
      }

      const map = new Map<string, any>();
      for (const cur of staffPayrollStore) {
        if (cur?.payrollKey) map.set(cur.payrollKey, cur);
      }
      const nowIso = getLocalTimestampIST();
      for (const r of records) {
        if (!r?.userId) continue;
        const pKey = String(r.payrollKey || `${r.monthKey || 'cur'}::${r.userId}`).trim();
        map.set(pKey, { ...r, payrollKey: pKey, savedAt: r.savedAt || nowIso });
      }
      staffPayrollStore = Array.from(map.values());
      saveStaffPayrollCache();

      let cfgSynced = true;
      if (configsPayload && Object.keys(configsPayload).length > 0) {
        const cfgRes = await forwardToGoogleAppsScript({
          action: 'saveStaffSalaryConfig',
          configs: configsPayload,
          appsScriptUrl: targetUrl,
        });
        cfgSynced = cfgRes.ok;
      }

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveStaffSalaryPayroll',
        records: records.map((r) => ({ ...r, payrollKey: String(r.payrollKey || `${r.monthKey || 'cur'}::${r.userId}`), savedAt: r.savedAt || nowIso })),
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok && cfgSynced,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        count: records.length,
        payroll: staffPayrollStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error backing up salary payroll' });
    }
  });

  // =========================================================================
  // FEATURE 6: SCHOOL UPI SETTINGS & ONLINE PAYMENT SUBMISSION / VERIFICATION
  // =========================================================================
  app.get('/api/upi-settings', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (!upiSettingsStore.upiId || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getUpiSettings&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (parsed?.settings && parsed.settings.upiId && !upiSettingsStore.upiId) {
              upiSettingsStore = {
                ...DEFAULT_UPI_SETTINGS_STORE,
                ...parsed.settings,
                staticQrImage: upiSettingsStore.staticQrImage || '',
              };
              saveUpiSettingsCache();
            }
          }
        } catch {}
      }
    } catch {}
    res.json({ success: true, settings: upiSettingsStore });
  });

  app.post('/api/upi-settings', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const incoming = req.body?.settings || req.body || {};
      upiSettingsStore = {
        ...DEFAULT_UPI_SETTINGS_STORE,
        ...upiSettingsStore,
        upiId: String(incoming.upiId ?? upiSettingsStore.upiId ?? '').trim(),
        payeeName: String(incoming.payeeName || upiSettingsStore.payeeName || 'E.V.S. Public School').trim(),
        bankName: String(incoming.bankName ?? upiSettingsStore.bankName ?? '').trim(),
        instructions: String(incoming.instructions || upiSettingsStore.instructions || DEFAULT_UPI_SETTINGS_STORE.instructions).trim(),
        staticQrImage: incoming.staticQrImage !== undefined ? String(incoming.staticQrImage || '') : (upiSettingsStore.staticQrImage || ''),
        updatedAt: getLocalTimestampIST(),
      };
      saveUpiSettingsCache();

      const sheetSafeSettings = {
        upiId: upiSettingsStore.upiId,
        payeeName: upiSettingsStore.payeeName,
        bankName: upiSettingsStore.bankName,
        instructions: upiSettingsStore.instructions,
        hasStaticQr: Boolean(upiSettingsStore.staticQrImage),
        updatedAt: upiSettingsStore.updatedAt,
      };
      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveUpiSettings',
        settings: sheetSafeSettings,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'upi_settings',
        action: 'update',
        details: { upiId: upiSettingsStore.upiId },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        settings: upiSettingsStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Could not save UPI settings' });
    }
  });

  app.get('/api/upi-payments', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (upiPaymentsStore.length === 0 || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getUpiPayments&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed?.payments) && parsed.payments.length > 0) {
              const existingMap = new Map(upiPaymentsStore.map((p) => [p.id, p]));
              for (const sp of parsed.payments) {
                if (!sp?.id) continue;
                const local = existingMap.get(sp.id);
                if (!local) {
                  existingMap.set(sp.id, sp);
                } else {
                  // Preserve local screenshotData if present
                  existingMap.set(sp.id, { ...sp, screenshotData: local.screenshotData || sp.screenshotData || '' });
                }
              }
              upiPaymentsStore = Array.from(existingMap.values()).sort(
                (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
              );
              saveUpiPaymentsCache();
            }
          }
        } catch {}
      }

      const studentId = String(req.query.studentId || '').trim().toLowerCase();
      const statusFilter = String(req.query.status || '').trim().toLowerCase();

      let list = [...upiPaymentsStore];
      if (studentId) {
        list = list.filter((p) => String(p.studentId || '').trim().toLowerCase() === studentId);
      }
      if (statusFilter && statusFilter !== 'all') {
        list = list.filter((p) => String(p.status || '').trim().toLowerCase() === statusFilter);
      }
      return res.json({ success: true, payments: list });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error fetching UPI payments' });
    }
  });

  app.post('/api/upi-payments', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const body = req.body || {};
      const studentId = String(body.studentId || '').trim();
      const amount = Number(body.amount || 0);
      const utrNumber = String(body.utrNumber || '').trim();

      if (!studentId || !amount || amount <= 0 || !utrNumber) {
        return res.status(400).json({
          success: false,
          error: 'छात्र आईडी, जमा राशि और UTR / Transaction ID अनिवार्य हैं।',
        });
      }

      // Guard against duplicate UTR submission
      const dup = upiPaymentsStore.find(
        (p) =>
          String(p.utrNumber || '').trim().toLowerCase() === utrNumber.toLowerCase() &&
          p.status !== 'Rejected'
      );
      if (dup) {
        return res.status(409).json({
          success: false,
          error: `यह UTR नंबर (${utrNumber}) पहले से दर्ज है (Status: ${dup.status})।`,
        });
      }

      const record = {
        id: String(body.id || `upi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
        studentId,
        studentName: String(body.studentName || studentId).trim(),
        className: String(body.className || '').trim(),
        parentMobile: String(body.parentMobile || '').trim(),
        payerName: String(body.payerName || '').trim(),
        amount,
        feeType: String(body.feeType || 'Monthly Tuition Fee').trim(),
        month: String(body.month || 'Current').trim(),
        utrNumber,
        paymentApp: String(body.paymentApp || 'UPI').trim(),
        paymentDate: String(body.paymentDate || getLocalDateIST()).trim(),
        screenshotData: body.screenshotData ? String(body.screenshotData) : '',
        notes: String(body.notes || '').trim(),
        status: 'Pending',
        createdAt: String(body.createdAt || getLocalTimestampIST()),
      };

      upiPaymentsStore = [record, ...upiPaymentsStore];
      saveUpiPaymentsCache();

      const sheetSafePayment = {
        ...record,
        screenshotData: '',
        hasScreenshot: Boolean(record.screenshotData),
      };
      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveUpiPayment',
        payment: sheetSafePayment,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'upi_payments',
        action: 'create',
        details: { id: record.id, studentId: record.studentId, amount: record.amount },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        payment: record,
        payments: upiPaymentsStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error submitting payment' });
    }
  });

  app.post('/api/upi-payments/sync-all', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const sheetSafeSettings = {
        upiId: upiSettingsStore.upiId,
        payeeName: upiSettingsStore.payeeName,
        bankName: upiSettingsStore.bankName,
        instructions: upiSettingsStore.instructions,
        hasStaticQr: Boolean(upiSettingsStore.staticQrImage),
        updatedAt: upiSettingsStore.updatedAt || getLocalTimestampIST(),
      };
      const sheetSafePayments = upiPaymentsStore.map((p) => ({
        ...p,
        screenshotData: '',
        hasScreenshot: Boolean(p.screenshotData),
      }));

      const gasResult = await forwardToGoogleAppsScript({
        action: 'syncAllUpiPayments',
        settings: sheetSafeSettings,
        payments: sheetSafePayments,
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        count: sheetSafePayments.length,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Batch UPI sync failed' });
    }
  });

  app.post('/api/upi-payments/:id/verify', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const targetId = String(req.params.id || '').trim();
      const { status, receiptNumber, managerNote, verifiedBy } = req.body || {};

      if (status !== 'Approved' && status !== 'Rejected') {
        return res.status(400).json({ success: false, error: 'Status must be Approved or Rejected' });
      }

      const idx = upiPaymentsStore.findIndex((p) => p.id === targetId);
      if (idx === -1) {
        return res.status(404).json({ success: false, error: 'UPI payment request not found' });
      }

      const updated = {
        ...upiPaymentsStore[idx],
        status,
        receiptNumber: receiptNumber || upiPaymentsStore[idx].receiptNumber || '',
        managerNote: managerNote !== undefined ? String(managerNote).trim() : (upiPaymentsStore[idx].managerNote || ''),
        verifiedBy: String(verifiedBy || 'School Manager').trim(),
        verifiedAt: getLocalTimestampIST(),
      };

      upiPaymentsStore[idx] = updated;
      saveUpiPaymentsCache();

      const sheetSafePayment = {
        ...updated,
        screenshotData: '',
        hasScreenshot: Boolean(updated.screenshotData),
      };
      const gasResult = await forwardToGoogleAppsScript({
        action: 'verifyUpiPayment',
        payment: sheetSafePayment,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'upi_payments',
        action: status.toLowerCase(),
        details: { id: updated.id, studentId: updated.studentId, status: updated.status },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMsg);
        }
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        payment: updated,
        payments: upiPaymentsStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error verifying payment' });
    }
  });

  app.delete('/api/upi-payments/:id', (req, res) => {
    try {
      const targetId = String(req.params.id || '').trim();
      const before = upiPaymentsStore.length;
      upiPaymentsStore = upiPaymentsStore.filter((p) => p.id !== targetId);
      if (upiPaymentsStore.length === before) {
        return res.status(404).json({ success: false, error: 'UPI payment not found' });
      }
      saveUpiPaymentsCache();
      return res.json({ success: true, payments: upiPaymentsStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Delete failed' });
    }
  });

  // =========================================================================
  // REPORT CARD & EXAM MARKS API (Exam_Marks & Report_Cards_Backup)
  // =========================================================================
  app.get('/api/exam-marks', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (examMarksStore.length === 0 || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getExamMarks&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (Array.isArray(parsed?.marks) && parsed.marks.length > 0) {
              const map = new Map<string, any>();
              const getCompKey = (m: any) =>
                `${String(m.session || '2026-27').toLowerCase()}::${String(m.exam_type || '').toLowerCase()}::${String(m.student_id || '').toLowerCase()}::${String(m.subject || '').toLowerCase()}`;
              for (const m of parsed.marks) {
                if (m?.student_id && m?.subject) map.set(getCompKey(m), m);
              }
              for (const cur of examMarksStore) {
                if (cur?.student_id && cur?.subject) map.set(getCompKey(cur), cur);
              }
              examMarksStore = Array.from(map.values());
              saveExamMarksCache();
            }
          }
        } catch {}
      }

      let list = [...examMarksStore];
      if (req.query.studentId) {
        const sid = String(req.query.studentId).trim().toLowerCase();
        list = list.filter((m) => String(m.student_id || '').trim().toLowerCase() === sid);
      }
      if (req.query.class_name) {
        const cls = String(req.query.class_name).trim().toLowerCase();
        list = list.filter((m) => String(m.class_name || '').trim().toLowerCase() === cls);
      }
      if (req.query.exam_type) {
        const et = String(req.query.exam_type).trim().toLowerCase();
        list = list.filter((m) => String(m.exam_type || '').trim().toLowerCase() === et);
      }
      return res.json({ success: true, marks: list });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error reading exam marks' });
    }
  });

  app.post('/api/exam-marks', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const batchInput: any[] = Array.isArray(req.body?.records)
        ? req.body.records
        : req.body?.record
        ? [req.body.record]
        : req.body && req.body.student_id
        ? [req.body]
        : [];
      const valid = batchInput.filter((r) => r && r.student_id && r.subject);
      if (valid.length === 0) {
        return res.status(400).json({ success: false, error: 'Valid exam mark record(s) required' });
      }

      const nowIso = getLocalTimestampIST();
      const getCompKey = (m: any) =>
        `${String(m.session || '2026-27').toLowerCase()}::${String(m.exam_type || 'Quarterly').toLowerCase()}::${String(m.student_id || '').toLowerCase()}::${String(m.subject || '').toLowerCase()}`;

      const map = new Map<string, any>();
      for (const cur of examMarksStore) {
        if (cur?.student_id && cur?.subject) map.set(getCompKey(cur), cur);
      }

      const savedRecords: any[] = [];
      for (const rec of valid) {
        const normalized = {
          ...rec,
          id: String(
            rec.id ||
              `em_${String(rec.session || '2026-27').replace(/[^a-z0-9]/gi, '')}_${String(rec.exam_type || 'Q')}_${String(rec.student_id)}_${String(rec.subject).replace(/\s+/g, '_')}`
          ).trim(),
          session: String(rec.session || '2026-27').trim(),
          exam_type: rec.exam_type || 'Quarterly',
          max_marks: Number(rec.max_marks || 50),
          marks_obtained: Number(rec.marks_obtained || 0),
          attendance_status: rec.attendance_status === 'Absent' ? 'Absent' : 'Present',
          updated_at: nowIso,
        };
        map.set(getCompKey(normalized), normalized);
        savedRecords.push(normalized);
      }
      examMarksStore = Array.from(map.values());
      saveExamMarksCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveExamMarksBatch',
        records: JSON.stringify(savedRecords),
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'exam_marks',
        action: 'update',
        details: { count: savedRecords.length },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        records: savedRecords,
        allMarks: examMarksStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error saving exam marks' });
    }
  });

  app.delete('/api/exam-marks/:id', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const id = String(req.params.id || '').trim();
      examMarksStore = examMarksStore.filter((m) => m.id !== id);
      saveExamMarksCache();
      const gasResult = await forwardToGoogleAppsScript({
        action: 'deleteExamMark',
        id,
        appsScriptUrl: targetUrl,
      });
      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'exam_marks',
        action: 'delete',
        details: { id },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }
      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        allMarks: examMarksStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error deleting exam mark' });
    }
  });

  app.get('/api/report-cards-meta', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (Object.keys(reportCardMetaStore).length === 0 || req.query.refresh === '1') {
        try {
          const sRes = await fetch(`${targetUrl}?action=getReportCardMeta&_t=${Date.now()}`, {
            redirect: 'follow',
            signal: AbortSignal.timeout(7000),
          });
          const txt = await sRes.text();
          if (sRes.ok && !txt.trim().startsWith('<')) {
            const parsed = JSON.parse(txt);
            if (parsed?.meta && typeof parsed.meta === 'object') {
              reportCardMetaStore = { ...parsed.meta, ...reportCardMetaStore };
              saveReportCardMetaCache();
            }
          }
        } catch {}
      }
      return res.json({ success: true, meta: reportCardMetaStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error fetching report card meta' });
    }
  });

  app.post('/api/report-cards-meta', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const m = req.body?.meta || req.body || {};
      const reportKey = String(m.reportKey || `${m.session || '2026-27'}::${m.studentId || ''}`).trim();
      if (!reportKey || reportKey.endsWith('::')) {
        return res.status(400).json({ success: false, error: 'reportKey & studentId are required' });
      }
      const savedMeta = {
        ...m,
        reportKey,
        updatedAt: getLocalTimestampIST(),
      };
      reportCardMetaStore[reportKey] = savedMeta;
      saveReportCardMetaCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveReportCardMeta',
        meta: savedMeta,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'report_card_meta',
        action: 'update',
        details: { reportKey },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        meta: reportCardMetaStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error saving report card remark' });
    }
  });

  app.post('/api/report-cards-backup/sync-all', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const backups: any[] = Array.isArray(req.body?.backups) ? req.body.backups : [];
      const examMarks: any[] = Array.isArray(req.body?.examMarks) ? req.body.examMarks : examMarksStore;

      if (backups.length > 0) {
        const nowIso = getLocalTimestampIST();
        for (const b of backups) {
          if (b?.reportKey && !reportCardMetaStore[b.reportKey]) {
            reportCardMetaStore[b.reportKey] = {
              reportKey: b.reportKey,
              session: b.session || '2026-27',
              studentId: b.studentId,
              teacherRemark: b.teacherRemark || '',
              principalRemark: b.principalRemark || '',
              resultStatus: b.resultStatus || 'PROMOTED',
              publishedToParent: b.publishedToParent !== false,
              updatedBy: b.updatedBy || 'Manager',
              updatedAt: b.updatedAt || nowIso,
            };
          }
        }
        saveReportCardMetaCache();
      }

      const gasResult = await forwardToGoogleAppsScript({
        action: 'syncReportCardsBatch',
        backups: JSON.stringify(backups),
        examMarks: JSON.stringify(examMarks),
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'report_card_meta',
        action: 'sync',
        details: { count: backups.length },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        count: backups.length,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Batch report card backup failed' });
    }
  });

  // REPORT CARD WORKFLOW: Teacher Draft -> Manager Confirm & Sheet Save + PTM/Parent Access Locks
  const RC_WORKFLOW_CACHE_FILE = '/tmp/evs_report_card_workflow.json';
  let reportCardWorkflowStore: {
    accessConfig: {
      allowTeacherPtmView: boolean;
      allowParentView: boolean;
      allowTeacherQrAttendance?: boolean;
      updatedBy?: string;
      updatedAt?: string;
    };
    pendingMarks: any[];
    pendingMeta: Record<string, any>;
  } = {
    accessConfig: {
      allowTeacherPtmView: false,
      allowParentView: false,
      allowTeacherQrAttendance: false,
    },
    pendingMarks: [],
    pendingMeta: {},
  };

  try {
    if (fs.existsSync(RC_WORKFLOW_CACHE_FILE)) {
      const rawWf = JSON.parse(fs.readFileSync(RC_WORKFLOW_CACHE_FILE, 'utf-8'));
      if (rawWf && typeof rawWf === 'object') {
        reportCardWorkflowStore = {
          accessConfig: {
            allowTeacherPtmView: Boolean(rawWf.accessConfig?.allowTeacherPtmView),
            allowParentView: Boolean(rawWf.accessConfig?.allowParentView),
            allowTeacherQrAttendance: Boolean(rawWf.accessConfig?.allowTeacherQrAttendance),
            updatedBy: rawWf.accessConfig?.updatedBy,
            updatedAt: rawWf.accessConfig?.updatedAt,
          },
          pendingMarks: Array.isArray(rawWf.pendingMarks) ? rawWf.pendingMarks : [],
          pendingMeta: rawWf.pendingMeta && typeof rawWf.pendingMeta === 'object' ? rawWf.pendingMeta : {},
        };
      }
    }
  } catch {}

  const saveReportCardWorkflowCache = () => {
    try {
      fs.writeFileSync(RC_WORKFLOW_CACHE_FILE, JSON.stringify(reportCardWorkflowStore, null, 2), 'utf-8');
    } catch {}
  };

  let lastRcWorkflowSheetSyncAt = 0;

  const syncReportCardWorkflowFromSheet = async (targetUrl: string, force = false): Promise<boolean> => {
    if (
      !force &&
      lastRcWorkflowSheetSyncAt > 0 &&
      Date.now() - lastRcWorkflowSheetSyncAt < 8000 &&
      reportCardWorkflowStore.accessConfig.updatedAt
    ) {
      return true;
    }
    try {
      const sRes = await fetch(`${targetUrl}?action=getReportCardWorkflow&_t=${Date.now()}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      const txt = await sRes.text();
      if (sRes.ok && txt && !txt.trim().startsWith('<')) {
        const parsed: any = JSON.parse(txt);
        if (parsed?.status === 'success') {
          if (parsed.accessConfig && typeof parsed.accessConfig === 'object') {
            const qrAllowed =
              typeof parsed.accessConfig.allowTeacherQrAttendance === 'boolean'
                ? Boolean(parsed.accessConfig.allowTeacherQrAttendance)
                : Boolean(reportCardWorkflowStore.accessConfig.allowTeacherQrAttendance);
            reportCardWorkflowStore.accessConfig = {
              allowTeacherPtmView: Boolean(parsed.accessConfig.allowTeacherPtmView),
              allowParentView: Boolean(parsed.accessConfig.allowParentView),
              allowTeacherQrAttendance: qrAllowed,
              updatedBy: parsed.accessConfig.updatedBy,
              updatedAt: parsed.accessConfig.updatedAt,
            };
            if (typeof parsed.accessConfig.allowTeacherQrAttendance === 'boolean') {
              saveTeacherQrAttendanceAccess({
                enabled: qrAllowed,
                updatedBy: String(parsed.accessConfig.updatedBy || 'Manager'),
              });
            }
          }
          if (Array.isArray(parsed.pendingMarks)) {
            reportCardWorkflowStore.pendingMarks = parsed.pendingMarks;
          }
          if (parsed.pendingMeta && typeof parsed.pendingMeta === 'object') {
            reportCardWorkflowStore.pendingMeta = parsed.pendingMeta;
          }
          lastRcWorkflowSheetSyncAt = Date.now();
          saveReportCardWorkflowCache();
          return true;
        }
      }
    } catch {}
    return false;
  };

  syncRcWorkflowHook = syncReportCardWorkflowFromSheet;

  const broadcastRcWorkflow = (action: string, details?: any) => {
    const msg = JSON.stringify({
      type: 'APP_DATA_UPDATED',
      entity: 'report_card_workflow',
      action,
      details,
      timestamp: Date.now(),
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  app.get('/api/report-cards-workflow', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const force = req.query.refresh === '1' || req.query.fresh === '1';
      const sheetSynced = await syncReportCardWorkflowFromSheet(targetUrl, force);
      return res.json({ success: true, sheetSynced, ...reportCardWorkflowStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Could not load report card workflow' });
    }
  });

  app.post('/api/report-cards-workflow/teacher-submit', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      // Sync existing pending drafts from Sheet FIRST so concurrent Teacher submissions never wipe each other
      await syncReportCardWorkflowFromSheet(targetUrl, true);

      const nowIso = getLocalTimestampIST();
      const incomingMarks: any[] = Array.isArray(req.body?.marks) ? req.body.marks : [];
      const incomingMeta: any = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : null;
      const submittedBy = String(req.body?.submittedBy || 'Teacher').trim();

      const getCompKey = (m: any) =>
        `${String(m.session || '2026-27').toLowerCase()}::${String(m.exam_type || 'Quarterly').toLowerCase()}::${String(m.student_id || '').toLowerCase()}::${String(m.subject || '').toLowerCase()}`;

      const map = new Map<string, any>();
      for (const cur of reportCardWorkflowStore.pendingMarks) {
        if (cur?.student_id && cur?.subject) map.set(getCompKey(cur), cur);
      }
      for (const rec of incomingMarks) {
        if (!rec?.student_id || !rec?.subject) continue;
        const normalized = {
          ...rec,
          approval_status: 'pending_approval',
          submitted_at: nowIso,
          teacher_name: rec.teacher_name || submittedBy,
        };
        map.set(getCompKey(normalized), normalized);
      }
      reportCardWorkflowStore.pendingMarks = Array.from(map.values());

      if (incomingMeta && incomingMeta.reportKey) {
        reportCardWorkflowStore.pendingMeta[String(incomingMeta.reportKey)] = {
          ...incomingMeta,
          principalRemark: '',
          publishedToParent: false,
          submittedBy,
          submittedAt: nowIso,
          approvalStatus: 'pending_approval',
        };
      }

      saveReportCardWorkflowCache();
      broadcastRcWorkflow('teacher_submit');

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveReportCardDraft',
        mode: 'merge',
        marks: incomingMarks,
        meta: incomingMeta && incomingMeta.reportKey ? { [String(incomingMeta.reportKey)]: reportCardWorkflowStore.pendingMeta[String(incomingMeta.reportKey)] } : undefined,
        draft: JSON.stringify({
          pendingMarks: reportCardWorkflowStore.pendingMarks,
          pendingMeta: reportCardWorkflowStore.pendingMeta,
        }),
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        ...reportCardWorkflowStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error submitting draft' });
    }
  });

  app.post('/api/report-cards-workflow/access', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      if (!reportCardWorkflowStore.accessConfig.updatedAt) {
        await syncReportCardWorkflowFromSheet(targetUrl, true);
      }
      const ac = req.body?.accessConfig || req.body || {};
      const nextPtmView =
        typeof ac.allowTeacherPtmView === 'boolean'
          ? Boolean(ac.allowTeacherPtmView)
          : Boolean(reportCardWorkflowStore.accessConfig.allowTeacherPtmView);
      const nextParentView =
        typeof ac.allowParentView === 'boolean'
          ? Boolean(ac.allowParentView)
          : Boolean(reportCardWorkflowStore.accessConfig.allowParentView);
      const nextQrAllowed =
        typeof ac.allowTeacherQrAttendance === 'boolean'
          ? Boolean(ac.allowTeacherQrAttendance)
          : Boolean(reportCardWorkflowStore.accessConfig.allowTeacherQrAttendance);

      reportCardWorkflowStore.accessConfig = {
        allowTeacherPtmView: nextPtmView,
        allowParentView: nextParentView,
        allowTeacherQrAttendance: nextQrAllowed,
        updatedBy: String(ac.updatedBy || 'Manager'),
        updatedAt: getLocalTimestampIST(),
      };
      saveReportCardWorkflowCache();

      const updatedQr = saveTeacherQrAttendanceAccess({
        enabled: nextQrAllowed,
        updatedBy: String(ac.updatedBy || 'Manager'),
      });

      broadcastRcWorkflow('access_updated', { enabled: nextQrAllowed });
      if (typeof ac.allowTeacherQrAttendance === 'boolean') {
        const qrMsg = JSON.stringify({
          type: 'APP_DATA_UPDATED',
          entity: 'teacher_qr_attendance_access',
          action: 'update',
          details: updatedQr,
          timestamp: Date.now(),
        });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(qrMsg);
        }
      }

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveReportCardAccess',
        accessConfig: JSON.stringify(reportCardWorkflowStore.accessConfig),
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        ...reportCardWorkflowStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error updating permissions' });
    }
  });

  app.post('/api/report-cards-workflow/manager-confirm', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const nowIso = getLocalTimestampIST();
      const marks: any[] = Array.isArray(req.body?.marks) ? req.body.marks : [];
      const metas: any[] = Array.isArray(req.body?.metas) ? req.body.metas : [];
      const backups: any[] = Array.isArray(req.body?.backups) ? req.body.backups : [];
      const confirmedBy = String(req.body?.confirmedBy || 'Manager');
      const removeMarkIds = new Set<string>(Array.isArray(req.body?.removeMarkIds) ? req.body.removeMarkIds : []);
      const removeReportKeys = new Set<string>(
        Array.isArray(req.body?.removeReportKeys) ? req.body.removeReportKeys : []
      );

      const getCompKey = (m: any) =>
        `${String(m.session || '2026-27').toLowerCase()}::${String(m.exam_type || 'Quarterly').toLowerCase()}::${String(m.student_id || '').toLowerCase()}::${String(m.subject || '').toLowerCase()}`;
      const markMap = new Map<string, any>();
      for (const cur of examMarksStore) {
        if (cur?.student_id && cur?.subject) markMap.set(getCompKey(cur), cur);
      }
      for (const rec of marks) {
        if (!rec?.student_id || !rec?.subject) continue;
        const clean = {
          ...rec,
          approval_status: 'approved',
          updated_at: nowIso,
        };
        markMap.set(getCompKey(clean), clean);
        if (rec.id) removeMarkIds.add(String(rec.id));
      }
      examMarksStore = Array.from(markMap.values());
      saveExamMarksCache();

      for (const m of metas) {
        if (m?.reportKey) {
          reportCardMetaStore[m.reportKey] = {
            ...m,
            approvalStatus: 'approved',
            updatedBy: confirmedBy,
            updatedAt: nowIso,
          };
          removeReportKeys.add(String(m.reportKey));
        }
      }
      saveReportCardMetaCache();

      reportCardWorkflowStore.pendingMarks = reportCardWorkflowStore.pendingMarks.filter(
        (m) => !removeMarkIds.has(String(m.id || ''))
      );
      for (const rk of removeReportKeys) {
        delete reportCardWorkflowStore.pendingMeta[rk];
      }
      saveReportCardWorkflowCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'syncReportCardsBatch',
        backups: JSON.stringify(backups),
        examMarks: JSON.stringify(examMarksStore),
        appsScriptUrl: targetUrl,
      });
      await forwardToGoogleAppsScript({
        action: 'saveReportCardDraft',
        draft: JSON.stringify({
          pendingMarks: reportCardWorkflowStore.pendingMarks,
          pendingMeta: reportCardWorkflowStore.pendingMeta,
        }),
        appsScriptUrl: targetUrl,
      });

      for (const entity of ['exam_marks', 'report_card_meta', 'report_card_workflow']) {
        const bMsg = JSON.stringify({ type: 'APP_DATA_UPDATED', entity, action: 'confirm', timestamp: Date.now() });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(bMsg);
        }
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        allMarks: examMarksStore,
        meta: reportCardMetaStore,
        workflow: reportCardWorkflowStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error confirming report cards' });
    }
  });

  app.post('/api/report-cards-workflow/manager-reject', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const clearAll = Boolean(req.body?.clearAll);
      const markIds = new Set<string>(Array.isArray(req.body?.markIds) ? req.body.markIds : []);
      const reportKeys = new Set<string>(Array.isArray(req.body?.reportKeys) ? req.body.reportKeys : []);

      if (clearAll) {
        reportCardWorkflowStore.pendingMarks = [];
        reportCardWorkflowStore.pendingMeta = {};
      } else {
        reportCardWorkflowStore.pendingMarks = reportCardWorkflowStore.pendingMarks.filter(
          (m) => !markIds.has(String(m.id || ''))
        );
        for (const rk of reportKeys) {
          delete reportCardWorkflowStore.pendingMeta[rk];
        }
      }
      saveReportCardWorkflowCache();
      broadcastRcWorkflow('manager_reject');

      await forwardToGoogleAppsScript({
        action: 'saveReportCardDraft',
        draft: JSON.stringify({
          pendingMarks: reportCardWorkflowStore.pendingMarks,
          pendingMeta: reportCardWorkflowStore.pendingMeta,
        }),
        appsScriptUrl: targetUrl,
      });

      return res.json({ success: true, ...reportCardWorkflowStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Error rejecting draft' });
    }
  });

  app.get('/api/hall-pass-config', async (req, res) => {
    const force = req.query.fresh === '1' || req.query.refresh === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    const sheetSynced = await syncHallPassConfigFromGoogleSheet(force, targetUrl);
    return res.json({
      success: true,
      sheetSynced,
      config: hallPassConfigStore,
    });
  });

  app.post('/api/hall-pass-config', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const incoming = req.body?.config || req.body || {};
      hallPassConfigStore = {
        ...DEFAULT_HALL_PASS_CONFIG,
        ...hallPassConfigStore,
        ...incoming,
        allowedOverrides:
          incoming.allowedOverrides && typeof incoming.allowedOverrides === 'object'
            ? incoming.allowedOverrides
            : hallPassConfigStore.allowedOverrides || {},
        datesheetRows:
          Array.isArray(incoming.datesheetRows) && incoming.datesheetRows.length > 0
            ? incoming.datesheetRows
            : hallPassConfigStore.datesheetRows || [],
        updatedAt: getLocalTimestampIST(),
      };
      saveHallPassConfigCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveHallPassConfig',
        config: hallPassConfigStore,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'hall_pass_config',
        action: 'update',
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        config: hallPassConfigStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Could not save hall pass config' });
    }
  });

  const EXAM_SEATING_CACHE_FILE = '/tmp/evs_exam_seating_plan.json';
  let examSeatingStore: {
    rows: any[];
    roomMeta: Record<string, any>;
    draftConfig: any | null;
    approvedConfig: any | null;
    updatedAt: string;
  } = {
    rows: [],
    roomMeta: {},
    draftConfig: null,
    approvedConfig: null,
    updatedAt: '',
  };
  try {
    if (fs.existsSync(EXAM_SEATING_CACHE_FILE)) {
      const rawSeat = JSON.parse(fs.readFileSync(EXAM_SEATING_CACHE_FILE, 'utf-8'));
      if (rawSeat && typeof rawSeat === 'object') {
        examSeatingStore = {
          rows: Array.isArray(rawSeat.rows) ? rawSeat.rows : [],
          roomMeta: rawSeat.roomMeta && typeof rawSeat.roomMeta === 'object' ? rawSeat.roomMeta : {},
          draftConfig: rawSeat.draftConfig && typeof rawSeat.draftConfig === 'object' ? rawSeat.draftConfig : null,
          approvedConfig: rawSeat.approvedConfig && typeof rawSeat.approvedConfig === 'object' ? rawSeat.approvedConfig : null,
          updatedAt: String(rawSeat.updatedAt || ''),
        };
      }
    }
  } catch {}

  const persistExamSeatingStore = () => {
    try {
      fs.writeFileSync(EXAM_SEATING_CACHE_FILE, JSON.stringify(examSeatingStore, null, 2), 'utf-8');
    } catch {}
  };

  app.get('/api/exam-seating-plan', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      let sheetSynced = false;
      try {
        const gasRes = await fetch(`${targetUrl}?action=getExamSeatingPlan&_t=${Date.now()}`, {
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        if (gasRes.ok) {
          const text = await gasRes.text();
          if (text && !text.trim().startsWith('<')) {
            const parsed: any = JSON.parse(text);
            if (parsed?.status === 'success') {
              sheetSynced = true;
              let changed = false;
              if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
                examSeatingStore.rows = parsed.rows;
                changed = true;
              }
              if (parsed.roomMeta && typeof parsed.roomMeta === 'object' && Object.keys(parsed.roomMeta).length > 0) {
                examSeatingStore.roomMeta = parsed.roomMeta;
                changed = true;
              }
              if (parsed.draftConfig && typeof parsed.draftConfig === 'object' && Array.isArray(parsed.draftConfig.rooms)) {
                examSeatingStore.draftConfig = parsed.draftConfig;
                changed = true;
              }
              if (parsed.approvedConfig && typeof parsed.approvedConfig === 'object' && Array.isArray(parsed.approvedConfig.rooms)) {
                examSeatingStore.approvedConfig = parsed.approvedConfig;
                changed = true;
              }
              if (changed) {
                examSeatingStore.updatedAt = getLocalTimestampIST();
                persistExamSeatingStore();
              }
            }
          }
        }
      } catch {}
      return res.json({ success: true, sheetSynced, ...examSeatingStore });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Could not load seating plan' });
    }
  });

  app.post('/api/exam-seating-plan/draft', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const draftConfig = req.body?.draftConfig && typeof req.body.draftConfig === 'object' ? req.body.draftConfig : null;
      if (!draftConfig || !Array.isArray(draftConfig.rooms)) {
        return res.status(400).json({ success: false, error: 'Invalid seating draft configuration' });
      }
      examSeatingStore.draftConfig = draftConfig;
      examSeatingStore.updatedAt = getLocalTimestampIST();
      persistExamSeatingStore();

      const seatingBroadcast = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'exam_seating_plan',
        action: 'draft_submitted',
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(seatingBroadcast);
      }

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveExamSeatingDraft',
        draftConfig,
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        ...examSeatingStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Could not save seating draft' });
    }
  });

  app.post('/api/exam-seating-plan', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const roomMeta = req.body?.roomMeta && typeof req.body.roomMeta === 'object' ? req.body.roomMeta : {};
      const approvedConfig =
        req.body?.approvedConfig && typeof req.body.approvedConfig === 'object' ? req.body.approvedConfig : null;

      examSeatingStore = {
        rows,
        roomMeta,
        draftConfig: approvedConfig || examSeatingStore.draftConfig,
        approvedConfig: approvedConfig || examSeatingStore.approvedConfig,
        updatedAt: getLocalTimestampIST(),
      };
      persistExamSeatingStore();

      const seatingBroadcast = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'exam_seating_plan',
        action: 'approved',
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(seatingBroadcast);
      }

      const gasResult = await forwardToGoogleAppsScript({
        action: 'saveExamSeatingPlan',
        rows,
        approvedConfig,
        appsScriptUrl: targetUrl,
      });

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        savedCount: rows.length,
        ...examSeatingStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Could not save seating plan' });
    }
  });

  app.get('/api/fee-waivers', async (req, res) => {
    const force = req.query.fresh === '1' || req.query.refresh === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    const sheetSynced = await syncFeeWaiversFromGoogleSheet(force, targetUrl);
    return res.json({
      success: true,
      sheetSynced,
      waivers: feeWaiversStore,
    });
  });

  app.post('/api/fee-waivers', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const body = req.body || {};
      let changed = false;
      const entriesToForward: Record<string, { isFree: boolean; reason: string; monthlyDiscount?: number; updatedAt: number }> = {};

      if (body.entries && typeof body.entries === 'object') {
        for (const [rawId, val] of Object.entries(body.entries)) {
          const sId = String(rawId || '').trim().toLowerCase();
          if (!sId || !val || typeof val !== 'object') continue;
          const v: any = val;
          const incomingTs = Number(v.updatedAt) || Date.now();
          const entry = {
            isFree: Boolean(v.isFree),
            reason: String(v.reason || ''),
            monthlyDiscount: Math.max(0, Math.round(Number(v.monthlyDiscount) || 0)),
            updatedAt: incomingTs,
          };
          entriesToForward[sId] = entry;
          const existing = feeWaiversStore[sId];
          if (!existing || incomingTs >= (Number(existing.updatedAt) || 0)) {
            feeWaiversStore[sId] = entry;
            changed = true;
          }
        }
      } else if (body.studentId) {
        const sId = String(body.studentId).trim().toLowerCase();
        const incomingTs = Number(body.updatedAt) || Date.now();
        const entry = {
          isFree: Boolean(body.isFree),
          reason: String(body.reason || ''),
          monthlyDiscount: Math.max(0, Math.round(Number(body.monthlyDiscount) || 0)),
          updatedAt: incomingTs,
        };
        feeWaiversStore[sId] = entry;
        entriesToForward[sId] = entry;
        changed = true;
      } else if (body.forceSyncAll) {
        for (const [k, v] of Object.entries(feeWaiversStore)) {
          entriesToForward[k] = v;
        }
      }

      if (changed) {
        saveFeeWaiversCache();
        const broadcastMsg = JSON.stringify({
          type: 'APP_DATA_UPDATED',
          entity: 'fee_waivers',
          action: 'update',
          timestamp: Date.now(),
        });
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
        }
      }

      let gasResult: { ok: boolean; error?: string } = { ok: false };
      const forwardKeys = Object.keys(entriesToForward);
      if (forwardKeys.length === 1) {
        const onlyId = forwardKeys[0];
        const e = entriesToForward[onlyId];
        gasResult = await forwardToGoogleAppsScript({
          action: 'saveFeeWaiver',
          studentId: onlyId,
          isFree: e.isFree,
          reason: e.reason,
          monthlyDiscount: e.monthlyDiscount || 0,
          updatedAt: e.updatedAt,
          appsScriptUrl: targetUrl,
        });
      } else if (forwardKeys.length > 1) {
        gasResult = await forwardToGoogleAppsScript({
          action: 'saveFeeWaiversBatch',
          entries: entriesToForward,
          appsScriptUrl: targetUrl,
        });
      } else if (body.forceSyncAll) {
        gasResult = { ok: true };
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        waivers: feeWaiversStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to save fee waivers' });
    }
  });

  // =========================================================================
  // AI SMART PARENT REVIEW WRITER (/api/ai-parent-review-draft) via Gemini 4
  // =========================================================================
  app.post('/api/ai-parent-review-draft', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        error: 'Gemini API key उपलब्ध नहीं है। कृपया Settings > Secrets में GEMINI_API_KEY सेट करें।',
      });
    }

    try {
      const {
        studentName = '',
        className = '',
        parentName = '',
        language = 'hi',
        overallRating = 5,
        satisfactionPct = 100,
        surveyResponses = [],
      } = req.body || {};

      const cleanResponses = Array.isArray(surveyResponses) ? surveyResponses : [];
      if (cleanResponses.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'AI रिव्यू बनाने के लिए कम से कम एक सवाल का जवाब चुनें।',
        });
      }

      const summaryLines = cleanResponses
        .map((q: any, idx: number) => {
          const ansText = q.yesNo === 'yes' ? 'हाँ (Yes)' : q.yesNo === 'no' ? 'नहीं (No)' : 'चयनित नहीं';
          return `${idx + 1}. ${q.question || q.topic}: जवाब=${ansText}, संतुष्टि=${Number(q.stars || 5)}/5 स्टार`;
        })
        .join('\n');

      const langDirective =
        language === 'en'
          ? 'Write strictly in natural, warm, heartfelt Indian English (first-person parent voice). No Hindi words.'
          : language === 'hinglish'
          ? 'Write in natural modern Hinglish (spoken conversational Roman script mixing English & simple Hindi words smoothly, e.g., "Bacche ki padhai aur teachers ka behaviour bahut accha hai...").'
          : 'शुद्ध, सहज व दिल से निकले देवनागरी हिंदी वाक्यों में लिखें (जैसे आम समझदार अभिभावक अपने बच्चे के स्कूल के बारे में गर्व व विश्वास से लिखते हैं)।';

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const callGemini = () =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Parent Survey Inputs:
- Student Name: ${studentName || 'हमारा बच्चा'}
- Class: ${className || 'विद्यालय'}
- Parent Name: ${parentName || 'अभिभावक'}
- Overall Star Rating: ${overallRating}/5 (${satisfactionPct}% satisfaction)
- Question-by-Question Yes/No & Star Ratings:
${summaryLines}

Write an authentic 2 to 3 sentence parent review reflecting ONLY the exact strengths and any constructive feedback indicated above. Output ONLY the review paragraph text without quotes, headings, bullet points, or emojis.`,
          config: {
            systemInstruction: `You are an expert parent-voice review drafting assistant for E.V.S. Public School (Chilkana Sultanpur, Saharanpur). Write sincere, human, specific 2-3 sentence testimonials strictly reflecting the parent's Yes/No answers and star ratings. Respect the parent's honesty: highlight topics rated 4-5 stars / Yes, and if any topic got "No" or <=2 stars, mention it politely as an area of expectation without exaggerating praise. ${langDirective}`,
          },
        });

      let response;
      try {
        response = await callGemini();
      } catch (firstErr: any) {
        const firstStatus = Number(firstErr?.status || firstErr?.code) || 0;
        const firstMsg = String(firstErr?.message || '');
        if (firstStatus === 503 || firstMsg.includes('"code":503') || firstMsg.includes('UNAVAILABLE')) {
          await new Promise((r) => setTimeout(r, 1200));
          response = await callGemini();
        } else {
          throw firstErr;
        }
      }

      const draft = response.text?.trim();
      if (!draft) {
        return res.status(502).json({
          success: false,
          error: 'AI ने खाली उत्तर लौटाया। कृपया पुनः प्रयास करें।',
        });
      }

      return res.json({ success: true, draft });
    } catch (err: any) {
      console.error('[AI Parent Review Draft Error]', err);
      const rawMsg = String(err?.message || 'AI review generation failed');
      const status =
        Number(err?.status || err?.code) ||
        (rawMsg.includes('"code":503') || rawMsg.includes('UNAVAILABLE')
          ? 503
          : rawMsg.includes('"code":429') || rawMsg.includes('RESOURCE_EXHAUSTED')
          ? 429
          : 500);
      const friendly =
        status === 403 || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('API_KEY_INVALID')
          ? 'Gemini API Key अमान्य या अनधिकृत है। कृपया Settings > Secrets में API Key जांचें।'
          : status === 429 || rawMsg.includes('RESOURCE_EXHAUSTED')
          ? 'AI कोटा अभी व्यस्त है। कृपया कुछ सेकंड बाद पुनः प्रयास करें।'
          : status === 503 || rawMsg.includes('UNAVAILABLE') || rawMsg.includes('high demand')
          ? 'AI सर्वर पर अभी अधिक ट्रैफ़िक है। कृपया 5–10 सेकंड बाद "AI से पुनः लिखवाएं" दबाएं या नीचे स्वयं लिखें।'
          : rawMsg;
      return res.status(status >= 400 && status < 600 ? status : 500).json({
        success: false,
        error: friendly,
      });
    }
  });

  // =========================================================================
  // PARENT REVIEWS & MARKETING TESTIMONIALS (/api/parent-reviews)
  // =========================================================================
  app.get('/api/parent-reviews', async (req, res) => {
    const force = req.query.fresh === '1' || req.query.refresh === '1';
    const targetUrl = resolveTargetAppsScriptUrl(req);
    const sheetSynced = await syncParentReviewsFromGoogleSheet(force, targetUrl);
    return res.json({
      success: true,
      sheetSynced,
      reviews: parentReviewsStore,
    });
  });

  app.post('/api/parent-reviews', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const body = req.body || {};
      const incoming = body.review || body;
      const nowIso = getLocalTimestampIST();
      const reviewId = String(incoming.id || `REV-${Date.now()}`).trim();
      const existingIdx = parentReviewsStore.findIndex(
        (r) => String(r.id || '').trim().toLowerCase() === reviewId.toLowerCase()
      );
      const existing = existingIdx >= 0 ? parentReviewsStore[existingIdx] : null;

      const savedReview = {
        id: reviewId,
        studentId: String(incoming.studentId ?? existing?.studentId ?? '').trim(),
        studentName: String(incoming.studentName ?? existing?.studentName ?? '').trim(),
        className: String(incoming.className ?? existing?.className ?? '').trim(),
        parentName: String(incoming.parentName ?? existing?.parentName ?? '').trim(),
        fatherName: String(incoming.fatherName ?? existing?.fatherName ?? '').trim(),
        parentMobile: String(incoming.parentMobile ?? existing?.parentMobile ?? '').trim(),
        rating: Math.min(5, Math.max(1, Number(incoming.rating ?? existing?.rating ?? 5))),
        category: String(incoming.category ?? existing?.category ?? 'संपूर्ण अनुभव').trim(),
        reviewText: String(incoming.reviewText ?? existing?.reviewText ?? '').trim(),
        photoUrl: String(incoming.photoUrl !== undefined ? incoming.photoUrl : existing?.photoUrl || ''),
        marketingConsent:
          incoming.marketingConsent !== undefined
            ? Boolean(incoming.marketingConsent)
            : Boolean(existing?.marketingConsent),
        status:
          incoming.status === 'approved' || incoming.status === 'hidden' || incoming.status === 'pending'
            ? incoming.status
            : existing?.status || 'pending',
        featured:
          incoming.featured !== undefined ? Boolean(incoming.featured) : Boolean(existing?.featured),
        source: String(incoming.source ?? existing?.source ?? 'parent_portal'),
        createdAt: String(incoming.createdAt || existing?.createdAt || nowIso),
        updatedAt: nowIso,
        surveyAnswers: Array.isArray(incoming.surveyAnswers)
          ? incoming.surveyAnswers
          : Array.isArray(existing?.surveyAnswers)
          ? existing.surveyAnswers
          : [],
        yesCount:
          incoming.yesCount !== undefined ? Number(incoming.yesCount) : existing?.yesCount,
        totalQuestions:
          incoming.totalQuestions !== undefined
            ? Number(incoming.totalQuestions)
            : existing?.totalQuestions,
        satisfactionPct:
          incoming.satisfactionPct !== undefined
            ? Number(incoming.satisfactionPct)
            : existing?.satisfactionPct,
        _sheetSynced: false,
      };

      if (!savedReview.reviewText) {
        return res.status(400).json({ success: false, error: 'Review text is required' });
      }

      if (existingIdx >= 0) {
        parentReviewsStore[existingIdx] = savedReview;
      } else {
        parentReviewsStore.unshift(savedReview);
      }
      saveParentReviewsCache();

      const isStatusOnlyUpdate = Boolean(existing && body.statusOnly);
      const gasResult = await forwardToGoogleAppsScript(
        isStatusOnlyUpdate
          ? {
              action: 'updateParentReviewStatus',
              reviewId: savedReview.id,
              status: savedReview.status,
              featured: savedReview.featured,
              marketingConsent: savedReview.marketingConsent,
              appsScriptUrl: targetUrl,
            }
          : {
              action: 'saveParentReview',
              review: savedReview,
              appsScriptUrl: targetUrl,
            }
      );

      if (gasResult.ok) {
        const idx = parentReviewsStore.findIndex((r) => r.id === savedReview.id);
        if (idx >= 0) {
          parentReviewsStore[idx]._sheetSynced = true;
          saveParentReviewsCache();
        }
      }

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'parent_reviews',
        action: existing ? 'update' : 'create',
        details: { reviewId: savedReview.id },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        sheetError: gasResult.ok ? undefined : gasResult.error,
        review: savedReview,
        reviews: parentReviewsStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to save parent review' });
    }
  });

  app.delete('/api/parent-reviews/:id', async (req, res) => {
    try {
      const targetUrl = resolveTargetAppsScriptUrl(req);
      const reviewId = String(req.params.id || '').trim();
      if (!reviewId) {
        return res.status(400).json({ success: false, error: 'Review ID required' });
      }
      parentReviewsStore = parentReviewsStore.filter(
        (r) => String(r.id || '').trim().toLowerCase() !== reviewId.toLowerCase()
      );
      saveParentReviewsCache();

      const gasResult = await forwardToGoogleAppsScript({
        action: 'deleteParentReview',
        reviewId,
        id: reviewId,
        appsScriptUrl: targetUrl,
      });

      const broadcastMsg = JSON.stringify({
        type: 'APP_DATA_UPDATED',
        entity: 'parent_reviews',
        action: 'delete',
        details: { reviewId },
        timestamp: Date.now(),
      });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) client.send(broadcastMsg);
      }

      return res.json({
        success: true,
        sheetSynced: gasResult.ok,
        reviews: parentReviewsStore,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Failed to delete parent review' });
    }
  });

  // =========================================================================
  // REAL ROAD-SNAPPED ROUTING PROXY (OSRM Germany + Project OSRM Fallback)
  // Prevents browser CORS / 429 bursts and NEVER caches failed straight lines
  // =========================================================================
  const roadRouteServerCache = new Map<
    string,
    {
      roadCoordinates: [number, number][];
      distanceKm: number;
      durationMinutes: number;
      isSnappedToRoad: boolean;
      provider: string;
      cachedAt: number;
    }
  >();

  const OSRM_PROVIDERS = [
    { name: 'osm-de', baseUrl: 'https://routing.openstreetmap.de/routed-car/route/v1/driving' },
    { name: 'project-osrm', baseUrl: 'https://router.project-osrm.org/route/v1/driving' },
  ];

  async function queryOsrmProvider(
    coordsPath: string,
    provider: { name: string; baseUrl: string }
  ): Promise<{
    roadCoordinates: [number, number][];
    distanceKm: number;
    durationMinutes: number;
    provider: string;
  } | null> {
    const url = `${provider.baseUrl}/${coordsPath}?overview=full&geometries=geojson&continue_straight=false`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'EVS-School-Van-Tracker/1.0',
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) return null;
      const data: any = await response.json();
      if (data?.code === 'Ok' && Array.isArray(data?.routes) && data.routes[0]?.geometry?.coordinates?.length > 0) {
        const route = data.routes[0];
        const leafletCoords: [number, number][] = route.geometry.coordinates.map(
          (c: [number, number]) => [Number(c[1]), Number(c[0])]
        );
        return {
          roadCoordinates: leafletCoords,
          distanceKm: Math.round(((Number(route.distance) || 0) / 1000) * 100) / 100,
          durationMinutes: Math.round(((Number(route.duration) || 0) / 60) * 10) / 10,
          provider: provider.name,
        };
      }
    } catch {}
    return null;
  }

  async function computeRoadSnappedRoute(rawWaypoints: Array<{ lat: number; lng: number }>) {
    const cleanWaypoints: Array<{ lat: number; lng: number }> = [];
    for (const pt of rawWaypoints) {
      const lat = Number(pt?.lat);
      const lng = Number(pt?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (cleanWaypoints.length > 0) {
        const prev = cleanWaypoints[cleanWaypoints.length - 1];
        if (getHaversineDistanceMeters(prev.lat, prev.lng, lat, lng) < 12) continue;
      }
      cleanWaypoints.push({ lat, lng });
    }

    if (cleanWaypoints.length < 2) {
      return {
        roadCoordinates: cleanWaypoints.map((w) => [w.lat, w.lng] as [number, number]),
        distanceKm: 0,
        durationMinutes: 0,
        isSnappedToRoad: false,
        provider: 'none',
      };
    }

    const cacheKey = cleanWaypoints.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');
    const cached = roadRouteServerCache.get(cacheKey);
    if (cached && cached.isSnappedToRoad && Date.now() - cached.cachedAt < 1000 * 60 * 60 * 12) {
      return {
        roadCoordinates: cached.roadCoordinates,
        distanceKm: cached.distanceKm,
        durationMinutes: cached.durationMinutes,
        isSnappedToRoad: true,
        provider: `${cached.provider}-cached`,
      };
    }

    // 1. Single multi-waypoint query for the entire route (follows true connected roads in 1 API call)
    const fullCoordsPath = cleanWaypoints.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    for (const provider of OSRM_PROVIDERS) {
      const res = await queryOsrmProvider(fullCoordsPath, provider);
      if (res && res.roadCoordinates.length >= 2) {
        const payload = {
          ...res,
          isSnappedToRoad: true,
        };
        roadRouteServerCache.set(cacheKey, { ...payload, cachedAt: Date.now() });
        return payload;
      }
    }

    // 2. Leg-by-leg sequential fallback (if multi-waypoint fails for a specific stop)
    const mergedCoords: [number, number][] = [];
    let totalDist = 0;
    let totalDur = 0;
    let snappedLegs = 0;
    let totalLegs = 0;

    for (let i = 0; i < cleanWaypoints.length - 1; i++) {
      const start = cleanWaypoints[i];
      const end = cleanWaypoints[i + 1];
      const distMeters = getHaversineDistanceMeters(start.lat, start.lng, end.lat, end.lng);
      totalLegs++;

      if (distMeters < 40) {
        snappedLegs++;
        const seg: [number, number][] = [[start.lat, start.lng], [end.lat, end.lng]];
        if (i === 0) mergedCoords.push(...seg);
        else mergedCoords.push(...seg.slice(1));
        totalDist += distMeters / 1000;
        totalDur += 0.1;
        continue;
      }

      const legPath = `${start.lng.toFixed(6)},${start.lat.toFixed(6)};${end.lng.toFixed(6)},${end.lat.toFixed(6)}`;
      let legRes = null;
      for (const provider of OSRM_PROVIDERS) {
        legRes = await queryOsrmProvider(legPath, provider);
        if (legRes) break;
      }

      if (legRes) {
        snappedLegs++;
        totalDist += legRes.distanceKm;
        totalDur += legRes.durationMinutes;
        if (i === 0) mergedCoords.push(...legRes.roadCoordinates);
        else mergedCoords.push(...legRes.roadCoordinates.slice(1));
      } else {
        const straightDistKm = distMeters / 1000;
        totalDist += straightDistKm;
        totalDur += (straightDistKm / 25) * 60;
        const seg: [number, number][] = [[start.lat, start.lng], [end.lat, end.lng]];
        if (i === 0) mergedCoords.push(...seg);
        else mergedCoords.push(...seg.slice(1));
      }
    }

    const fullySnapped = snappedLegs === totalLegs && totalLegs > 0;
    const anySnapped = snappedLegs > 0;
    const result = {
      roadCoordinates: mergedCoords,
      distanceKm: Math.round(totalDist * 100) / 100,
      durationMinutes: Math.round(totalDur * 10) / 10,
      isSnappedToRoad: anySnapped,
      provider: fullySnapped ? 'leg-osrm' : anySnapped ? 'partial-osrm' : 'fallback',
    };

    // Only cache if EVERY leg snapped cleanly to real roads
    if (fullySnapped) {
      roadRouteServerCache.set(cacheKey, { ...result, cachedAt: Date.now() });
    }

    return result;
  }

  app.post('/api/road-route', async (req, res) => {
    try {
      const waypoints = Array.isArray(req.body?.waypoints) ? req.body.waypoints : [];
      const result = await computeRoadSnappedRoute(waypoints);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Road routing failed' });
    }
  });

  app.get('/api/road-route', async (req, res) => {
    try {
      const raw = String(req.query.waypoints || '').trim();
      const waypoints = raw
        .split(';')
        .map((pair) => {
          const [latStr, lngStr] = pair.split(',');
          return { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
        })
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const result = await computeRoadSnappedRoute(waypoints);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Road routing failed' });
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
                      lastUpdated: lastUpdated || getLocalTimestampIST(),
                      status: finalSpeed > 2 ? 'running' : 'stopped',
                      isLiveFromSheet: true,
                      lastServerSync: getLocalTimestampIST(),
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
                      existing.lastServerSync = getLocalTimestampIST();
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
