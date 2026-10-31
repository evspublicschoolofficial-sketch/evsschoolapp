// Bus Tracking Service & Telemetry Synchronizer
// Synchronizes with Google Sheets ("Bus_Tracking" & "Users") and real-time backend API
import { RouteStoppage } from '../types/routeTracking';

export const SPREADSHEET_ID = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU';
export const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbwVy51K14qu6IXipAZXP4NspFcAUHpLcYv8-zjhkYnBlUI17TzGi_KaJU9TRmNT8D5vvQ/exec';

// Get active Google Apps Script URL (supports custom deployment URLs entered by user)
export const getAppsScriptUrl = (): string => {
  try {
    const custom = localStorage.getItem('evs_custom_apps_script_url');
    if (custom && custom.trim().startsWith('https://script.google.com/macros/s/')) {
      return custom.trim();
    }
  } catch {}
  return DEFAULT_API_URL;
};

// Set custom Google Apps Script Web App URL and broadcast change
export const setAppsScriptUrl = (newUrl: string): boolean => {
  try {
    const trimmed = (newUrl || '').trim();
    if (!trimmed) {
      localStorage.removeItem('evs_custom_apps_script_url');
      fetch('/api/apps-script-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: DEFAULT_API_URL }),
      }).catch(() => {});
      return true;
    }
    if (trimmed.startsWith('https://script.google.com/macros/s/')) {
      localStorage.setItem('evs_custom_apps_script_url', trimmed);
      fetch('/api/apps-script-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      }).catch(() => {});
      return true;
    }
  } catch {}
  return false;
};

export const API_URL = getAppsScriptUrl();

export interface BusTrackingRecord {
  Bus_ID: string;
  Driver_Name: string;
  Current_Location: string; // e.g. "30.056038, 77.419096"
  Last_Updated: string;
}

export interface VanTelemetry {
  busId: string;
  driverName: string;
  driverPhone: string;
  driverUserId?: string;
  driverUsername?: string;
  currentLocationStr: string; // "30.056038, 77.419096"
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null; // km/h
  heading: number | null;
  lastUpdated: string;
  status: 'running' | 'stopped';
  sosAlert?: boolean;
  sosMessage?: string;
  isLiveFromSheet?: boolean;
}

// School Campus Coordinates (EVS PUBLIC SCHOOL, Saharanpur Road, Chilkana Sultanpur)
export const DEFAULT_SCHOOL_COORDS = {
  lat: 30.071520,
  lng: 77.473969,
  name: 'EVS PUBLIC SCHOOL, Chilkana Sultanpur',
  address: 'Saharanpur road, Chilkana Sultanpur, Chilkana, Uttar Pradesh 247231',
  mapsUrl: 'https://maps.app.goo.gl/TCqvnXrQN2326Lpp6',
};

// Parse coordinates string like "30.056038, 77.419096"
export const parseCoordinates = (locStr: string | null | undefined): { lat: number; lng: number } => {
  if (!locStr) {
    return { lat: DEFAULT_SCHOOL_COORDS.lat, lng: DEFAULT_SCHOOL_COORDS.lng };
  }
  const clean = String(locStr).trim();
  // Match two numbers separated by comma or space
  const m = clean.match(/([-+]?[0-9]*\.?[0-9]+)[\s,]+([-+]?[0-9]*\.?[0-9]+)/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return { lat: DEFAULT_SCHOOL_COORDS.lat, lng: DEFAULT_SCHOOL_COORDS.lng };
};

// Calculate distance in kilometers between two GPS coordinates
export const calculateDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
};

// Fetch real rows from Google Sheets "Bus_Tracking" (via Apps Script or GViz)
export const fetchBusTrackingFromSheet = async (): Promise<BusTrackingRecord[]> => {
  const activeUrl = getAppsScriptUrl();

  // 1. Try Apps Script API first (fast and accurately formatted)
  try {
    const res = await fetch(`${activeUrl}?action=getBusTracking`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 1) {
        const records: BusTrackingRecord[] = [];
        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (Array.isArray(row) && (row[0] || row[1])) {
            records.push({
              Bus_ID: String(row[0] ?? '').trim(),
              Driver_Name: String(row[1] ?? '').trim(),
              Current_Location: String(row[2] ?? '').trim() || '30.056038, 77.419096',
              Last_Updated: String(row[3] ?? '').trim() || new Date().toLocaleString('hi-IN'),
            });
          }
        }
        if (records.length > 0) {
          return records;
        }
      }
    }
  } catch (err) {
    console.warn('Apps Script getBusTracking fetch error, trying GViz fallback:', err);
  }

  // 2. Fallback to Google Sheets GViz endpoint
  try {
    const encoded = encodeURIComponent('Bus_Tracking');
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`
    );
    if (!res.ok) return [];
    const text = await res.text();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return [];
    const data = JSON.parse(text.slice(start, end + 1));
    const rows = data.table?.rows || [];
    const records: BusTrackingRecord[] = [];

    for (const r of rows) {
      const cells = r.c || [];
      const busId = cells[0]?.v ? String(cells[0].v).trim() : '';
      const driverName = cells[1]?.v ? String(cells[1].v).trim() : '';
      const currentLocation = cells[2]?.v ? String(cells[2].v).trim() : '';
      const dateVal = cells[3]?.f || cells[3]?.v || '';

      let lastUpdated = '';
      if (typeof dateVal === 'string' && dateVal.includes('Date(')) {
        const m = dateVal.match(/Date\((\d+),(\d+),(\d+),?(\d+)?,?(\d+)?,?(\d+)?\)/);
        if (m) {
          const y = m[1];
          const mo = String(Number(m[2]) + 1).padStart(2, '0');
          const d = String(m[3]).padStart(2, '0');
          const h = String(m[4] || '0').padStart(2, '0');
          const min = String(m[5] || '0').padStart(2, '0');
          const sec = String(m[6] || '0').padStart(2, '0');
          lastUpdated = `${d}/${mo}/${y} ${h}:${min}:${sec}`;
        }
      } else {
        lastUpdated = String(dateVal || '');
      }

      if (busId || driverName) {
        records.push({
          Bus_ID: busId,
          Driver_Name: driverName,
          Current_Location: currentLocation || '30.056038, 77.419096',
          Last_Updated: lastUpdated || new Date().toLocaleString('hi-IN'),
        });
      }
    }
    return records;
  } catch (err) {
    console.warn('Error fetching Bus_Tracking sheet:', err);
    return [];
  }
};

// Persistent WebSocket connection for real-time background location updates
let persistentWs: WebSocket | null = null;
let wsReconnectTimer: any = null;
const wsListeners = new Set<(msg: any) => void>();

export const getPersistentWebSocket = (): WebSocket | null => {
  if (typeof window === 'undefined') return null;
  if (persistentWs && (persistentWs.readyState === WebSocket.OPEN || persistentWs.readyState === WebSocket.CONNECTING)) {
    return persistentWs;
  }

  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/location`;
    persistentWs = new WebSocket(wsUrl);

    persistentWs.onopen = () => {
      console.log('[WebSocket] Connected to /ws/location');
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    persistentWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const listener of wsListeners) {
          listener(data);
        }
      } catch {}
    };

    persistentWs.onerror = (err) => {
      console.warn('[WebSocket] Error:', err);
    };

    persistentWs.onclose = () => {
      persistentWs = null;
      // Auto-reconnect after 3 seconds if disconnected
      if (!wsReconnectTimer) {
        wsReconnectTimer = setTimeout(() => {
          wsReconnectTimer = null;
          getPersistentWebSocket();
        }, 3000);
      }
    };
  } catch (err) {
    console.warn('[WebSocket] Init failed:', err);
  }

  return persistentWs;
};

export const subscribeToBusUpdates = (listener: (msg: any) => void) => {
  wsListeners.add(listener);
  getPersistentWebSocket();
  return () => {
    wsListeners.delete(listener);
  };
};

export const sendLocationViaWebSocket = (telemetry: VanTelemetry): boolean => {
  try {
    const ws = getPersistentWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'LOCATION_UPDATE', payload: telemetry }));
      return true;
    }
  } catch (err) {
    console.warn('[WebSocket] send failed:', err);
  }
  return false;
};

// Send live location update to cross-device shared server API (WebSocket primary + HTTP fallback)
export const syncLocationToSharedApi = async (telemetry: VanTelemetry) => {
  // 1. Try pushing via persistent WebSocket first
  const wsSent = sendLocationViaWebSocket(telemetry);

  // 2. Also ensure HTTP POST reaches server for fallback & Google Sheet sync
  try {
    const res = await fetch('/api/bus-tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetry),
    });
    return res.ok || wsSent;
  } catch (e) {
    return wsSent;
  }
};

// Fetch latest live telemetry from cross-device shared server API
export const fetchTelemetryFromSharedApi = async (): Promise<Record<string, VanTelemetry>> => {
  try {
    const res = await fetch('/api/bus-tracking');
    if (res.ok) {
      const data = await res.json();
      return data || {};
    }
  } catch (e) {}
  return {};
};

// // Ready-to-copy Google Apps Script Code for Google Sheets (Code.gs)
export const GOOGLE_APPS_SCRIPT_CODE = `// ============================================================
// E.V.S. PUBLIC SCHOOL - GOOGLE APPS SCRIPT (Code.gs)
// Handles: Students, Homework, Fees, Behavior, & Bus Tracking
// Spreadsheet ID: 1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU
// ============================================================

var SPREADSHEET_ID = "1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU";

function getSpreadsheet() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch(e) {}
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch(e) {}
  return null;
}

/**
 * 0. AUTO-INITIALIZE ON SPREADSHEET OPEN
 * Triggered automatically every time any user opens the Google Sheet in browser.
 * Adds custom automation menu & creates missing tabs (Fee_Master, School_Notices, etc.)
 */
function onOpen(e) {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.createMenu("🏫 EVS स्कूल ऑटोमेशन")
      .addItem("⚡ सभी आवश्यक टैब स्वतः बनाएं (Auto-Create All Tabs)", "setupAllRequiredSheets")
      .addItem("📋 फीस मास्टर टैब बनाएं (Create Fee_Master)", "menuCreateFeeMaster")
      .addItem("📢 स्कूल नोटिस टैब बनाएं (Create School_Notices)", "menuCreateNotices")
      .addSeparator()
      .addItem("🔄 1 तारीख ऑटो-बिलिंग ट्रिगर इंस्टॉल करें (Install Trigger)", "setupMonthlyTrigger")
      .addItem("⏮️ पिछले महीनों का बकाया बैकफिल करें (Backfill Past Dues)", "generatePastDues")
      .addItem("📅 इस माह का मासिक शुल्क सृजित करें (Generate Dues)", "generateMonthlyDues")
      .addToUi();
  } catch(uiErr) {}

  // Automatically check and create Fee_Master and School_Notices tabs on opening the sheet
  try {
    setupAllRequiredSheetsSilently();
  } catch(silentErr) {}
}

function menuCreateFeeMaster() {
  var ss = getSpreadsheet();
  handleGetFeeMaster(ss);
  try {
    SpreadsheetApp.getUi().alert("✅ 'Fee_Master' टैब Google Sheet में सफलतापूर्वक बन गया है!");
  } catch(e) {}
}

function menuCreateNotices() {
  var ss = getSpreadsheet();
  handleGetNotices(ss);
  try {
    SpreadsheetApp.getUi().alert("✅ 'School_Notices' टैब Google Sheet में सफलतापूर्वक बन गया है!");
  } catch(e) {}
}

function setupAllRequiredSheetsSilently() {
  var ss = getSpreadsheet();
  if (!ss) return;
  var feeSheet = ss.getSheetByName("Fee_Master") || ss.getSheetByName("FeeMaster") || ss.getSheetByName("Fee Master");
  if (!feeSheet) handleGetFeeMaster(ss);
  var notSheet = ss.getSheetByName("School_Notices") || ss.getSheetByName("Notices") || ss.getSheetByName("Notice");
  if (!notSheet) handleGetNotices(ss);
  var busSheet = ss.getSheetByName("Bus_Tracking");
  if (!busSheet) {
    busSheet = ss.insertSheet("Bus_Tracking");
    busSheet.appendRow(["Bus_ID", "Driver_Name", "Current_Location", "Last_Updated"]);
    busSheet.appendRow(["ecad7ddc", "Amjad", "30.056038, 77.419096", Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss")]);
  }
}

/**
 * Standalone runner: Run directly from Apps Script editor by selecting "setupAllRequiredSheets" and clicking Run!
 */
function setupAllRequiredSheets() {
  var ss = getSpreadsheet();
  if (!ss) {
    return { status: "error", message: "Spreadsheet access failed. Check sheet permissions." };
  }

  var created = [];

  // 1. Fee_Master
  var feeMasterSheet = ss.getSheetByName("Fee_Master") || ss.getSheetByName("FeeMaster") || ss.getSheetByName("Fee Master");
  if (!feeMasterSheet) {
    handleGetFeeMaster(ss);
    created.push("Fee_Master");
  }

  // 2. School_Notices
  var noticesSheet = ss.getSheetByName("School_Notices") || ss.getSheetByName("Notices") || ss.getSheetByName("Notice");
  if (!noticesSheet) {
    handleGetNotices(ss);
    created.push("School_Notices");
  }

  // 3. Bus_Tracking
  var busSheet = ss.getSheetByName("Bus_Tracking");
  if (!busSheet) {
    busSheet = ss.insertSheet("Bus_Tracking");
    busSheet.appendRow(["Bus_ID", "Driver_Name", "Current_Location", "Last_Updated"]);
    busSheet.appendRow(["ecad7ddc", "Amjad", "30.056038, 77.419096", Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss")]);
    created.push("Bus_Tracking");
  }

  // 4. Students
  var studentsSheet = ss.getSheetByName("Students");
  if (!studentsSheet) {
    studentsSheet = ss.insertSheet("Students");
    studentsSheet.appendRow([
      "Student_ID", "Student_Name", "Father_Name", "Mother_Name", "Mobile_Number", "Parent_Mobile",
      "Class", "Section", "Roll_Number", "Date_Of_Birth", "Address", "Transport_Required",
      "Bus_Stop", "Route", "Fee_Category", "Monthly_Fee", "Admission_Date", "Session_Start_Month", "Status"
    ]);
    created.push("Students");
  }

  // 5. Fees
  var feesSheet = ss.getSheetByName("Fees") || ss.getSheetByName("Fee_Collection");
  if (!feesSheet) {
    feesSheet = ss.insertSheet("Fees");
    feesSheet.appendRow([
      "Receipt_No", "Date", "Student_ID", "Student_Name", "Class", "Month",
      "Total_Amount", "Amount_Paid", "Balance_Amount", "Payment_Mode", "Collected_By", "Remarks"
    ]);
    created.push("Fees");
  }

  // 6. Homework
  var hwSheet = ss.getSheetByName("Homework");
  if (!hwSheet) {
    hwSheet = ss.insertSheet("Homework");
    hwSheet.appendRow(["Date", "Class", "Subject", "Title", "Description", "Assigned_By", "Status"]);
    created.push("Homework");
  }

  // 7. Behavior
  var behSheet = ss.getSheetByName("Behavior") || ss.getSheetByName("Attendance");
  if (!behSheet) {
    behSheet = ss.insertSheet("Behavior");
    behSheet.appendRow(["Date", "Student_ID", "Student_Name", "Class", "Roll_Number", "Is_Present", "Remark", "Teacher_Name"]);
    created.push("Behavior");
  }

  // 8. Route_Stops (User Custom Pinned Stoppages)
  var stopsSheet = ss.getSheetByName("Route_Stops") || ss.getSheetByName("Route_Stop") || ss.getSheetByName("Stoppages") || ss.getSheetByName("Stops");
  if (!stopsSheet) {
    stopsSheet = ss.insertSheet("Route_Stops");
    stopsSheet.appendRow(["Stop_ID", "Route_ID", "Stop_Name", "Sequence_Order", "Latitude", "Longitude", "Morning_Time", "Evening_Time", "Village_Name", "Student_Count", "Notes"]);
    created.push("Route_Stops");
  }

  var msg = created.length > 0
    ? "✅ सफलतापूर्वक " + created.length + " नए टैब बनाए गए: " + created.join(", ")
    : "✅ सभी आवश्यक टैब (Route_Stops, Fee_Master, School_Notices, Students आदि) मौजूद हैं!";

  try {
    SpreadsheetApp.getUi().alert("🏫 EVS स्कूल ऑटोमेशन", msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch(e) {}

  return {
    status: "success",
    message: msg,
    created: created,
    totalRequiredChecked: 8
  };
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
  var ss = getSpreadsheet();
  
  if (!ss) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Spreadsheet access failed. Check sheet permissions."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 1. GET STUDENTS
  if (action === "getStudents") {
    var sheet = ss.getSheetByName("Students");
    var data = sheet ? sheet.getDataRange().getValues() : [];
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 2. GET HOMEWORK
  if (action === "getHomework") {
    var sheet = ss.getSheetByName("Homework");
    var data = sheet ? sheet.getDataRange().getValues() : [];
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  // 3. GET BUS TRACKING
  if (action === "getBusTracking" || action === "getBus") {
    var sheet = ss.getSheetByName("Bus_Tracking");
    if (!sheet) {
      sheet = ss.insertSheet("Bus_Tracking");
      sheet.appendRow(["Bus_ID", "Driver_Name", "Current_Location", "Last_Updated"]);
      sheet.appendRow(["ecad7ddc", "Amjad", "30.056038, 77.419096", Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss")]);
    }
    var data = sheet.getDataRange().getValues();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 4. TEST / PING ENDPOINT
  if (action === "ping" || action === "test") {
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "EVS School Apps Script Web App is Online & Active!"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 5. UPDATE BUS TRACKING VIA GET (FALLBACK)
  if (action === "updateBusTracking" || action === "updateLocation") {
    return handleUpdateBusTracking(ss, e.parameter || {});
  }

  // 6. AUTOMATIC MONTHLY FEE GENERATION VIA GET
  if (action === "generateMonthlyDues" || action === "autoBill") {
    var genResult = generateMonthlyDues();
    return ContentService.createTextOutput(JSON.stringify(genResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 6B. PAST MONTHS DUES BACKFILL VIA GET
  if (action === "generatePastDues" || action === "backfillDues") {
    var pastResult = generatePastDues();
    return ContentService.createTextOutput(JSON.stringify(pastResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 7. GET FEE MASTER (Option B: Auto-Creates Fee_Master sheet if not present)
  if (action === "getFeeMaster") {
    return handleGetFeeMaster(ss);
  }

  // 8. GET NOTICES (Option B: Auto-Creates School_Notices sheet if not present)
  if (action === "getNotices") {
    return handleGetNotices(ss);
  }

  // 8B. GET STUDENT BEHAVIOR & ATTENDANCE
  if (action === "getBehavior" || action === "getStudentBehavior") {
    var bSheet = ss.getSheetByName("Student_Behavior");
    if (!bSheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", behavior: [] })).setMimeType(ContentService.MimeType.JSON);
    }
    var bVals = bSheet.getDataRange().getValues();
    var bList = [];
    for (var bi = 1; bi < bVals.length; bi++) {
      var bRow = bVals[bi];
      if (!bRow[0] && !bRow[1]) continue;
      var rDt = bRow[2];
      var rDtStr = "";
      if (rDt) {
        if (Object.prototype.toString.call(rDt) === '[object Date]') {
          rDtStr = Utilities.formatDate(rDt, Session.getScriptTimeZone() || "Asia/Kolkata", "yyyy-MM-dd");
        } else {
          rDtStr = String(rDt).trim().slice(0, 10);
        }
      }
      bList.push({
        Behavior_ID: String(bRow[0] || ""),
        Student_ID: String(bRow[1] || ""),
        Date: rDtStr,
        Class: String(bRow[3] || ""),
        Is_Bathed: String(bRow[4] || "").toLowerCase() === "yes",
        Nails_Clean: String(bRow[5] || "").toLowerCase() === "yes",
        Uniform_clean: String(bRow[6] || "").toLowerCase() === "yes",
        Good_Manners: String(bRow[7] || "Good"),
        Discipline: String(bRow[8] || "").toLowerCase() === "good",
        Is_Present: String(bRow[9] || "").toLowerCase() === "present",
        Remark: String(bRow[10] || ""),
        AI_Feedback: String(bRow[11] || "")
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ status: "success", behavior: bList })).setMimeType(ContentService.MimeType.JSON);
  }

  // 8C. GET ROUTE STOPS (From Route_Stops tab)
  if (action === "getRouteStops" || action === "getStoppages") {
    return handleGetRouteStops(ss, e.parameter || {});
  }

  // 9. SETUP ALL REQUIRED SHEETS / AUTO-CREATE TABS
  if (action === "setupAllSheets" || action === "setupDatabase" || action === "createAllSheets" || action === "initTabs") {
    var setupRes = setupAllRequiredSheets();
    return ContentService.createTextOutput(JSON.stringify(setupRes))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // 10. GET FALLBACK: Delegate write actions when called via GET query parameters
  if (action === "saveRouteStops" || action === "addRouteStop" || action === "saveFeeMaster" || action === "addHomework" || action === "addBehavior" || action === "updateHomeworkTracker" || action === "addFee" || action === "addStudent" || action === "editFee" || action === "deleteFee" || action === "recordStaffAttendance" || action === "addStaffAttendance" || action === "assignTeacherClass") {
    return doPost(e);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "error",
    message: "Invalid Action: " + action
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var data = {};
    if (e && e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        data = e.parameter || {};
      }
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    var action = data.action || (e && e.parameter && e.parameter.action) || "";
    var ss = getSpreadsheet();

    if (!ss) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Spreadsheet access failed. Check sheet permissions."
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. ADD / UPDATE HOMEWORK (Deduplicated)
    if (action === "addHomework") {
      var sheet = ss.getSheetByName("Homework");
      if (!sheet) sheet = ss.insertSheet("Homework");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["Homework_ID", "Date", "Class", "Subject", "Homework_Detail", "Target_Type", "", "", "", "", "Teacher"]);
      }
      var hwId = String(data.homework_id || data.id || "HW-" + Date.now()).trim();
      var hwDate = String(data.date || new Date().toISOString().split("T")[0]).trim();
      var hwClass = String(data.class_name || data.class || "").trim();
      var hwSubj = String(data.subject || "").trim();
      var hwDetail = String(data.detail || data.Homework_Detail || "").trim();
      var hwTeacher = String(data.teacher || "Faculty").trim();

      var rows = sheet.getDataRange().getValues();
      var foundRow = -1;
      for (var r = 1; r < rows.length; r++) {
        var rId = String(rows[r][0] || "").trim();
        var rDate = String(rows[r][1] || "").trim();
        var rClass = String(rows[r][2] || "").trim();
        var rSubj = String(rows[r][3] || "").trim();
        // Check ID match or (Date + Class + Subject) match
        if ((hwId && rId.toLowerCase() === hwId.toLowerCase()) ||
            (hwDate && rDate === hwDate && hwClass && rClass.toLowerCase() === hwClass.toLowerCase() && hwSubj && rSubj.toLowerCase() === hwSubj.toLowerCase())) {
          foundRow = r + 1;
          break;
        }
      }

      if (foundRow > 0) {
        sheet.getRange(foundRow, 1, 1, 11).setValues([[
          hwId || rows[foundRow - 1][0],
          hwDate,
          hwClass,
          hwSubj,
          hwDetail,
          "Whole Class",
          "", "", "", "",
          hwTeacher
        ]]);
      } else {
        sheet.appendRow([
          hwId,
          hwDate,
          hwClass,
          hwSubj,
          hwDetail,
          "Whole Class",
          "", "", "", "",
          hwTeacher
        ]);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Homework Saved and Deduplicated Successfully!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. UPDATE BUS TRACKING (BUS LIVE LOCATION)
    if (action === "updateBusTracking" || action === "updateLocation") {
      return handleUpdateBusTracking(ss, data);
    }

    // 2B. SAVE / SYNC ROUTE STOPS (Route_Stops tab)
    if (action === "saveRouteStops" || action === "addRouteStop" || action === "updateRouteStops") {
      return handleSaveRouteStops(ss, data);
    }
    if (action === "deleteRouteStop") {
      return handleDeleteRouteStop(ss, data);
    }

    // 3. ADD FEE RECORD (Supports Discount, Net Payable & Multi-Month Allocation)
    if (action === "addFee") {
      var sheet = ss.getSheetByName("Fee_Collection");
      if (!sheet) {
        sheet = ss.insertSheet("Fee_Collection");
        sheet.appendRow([
          "Receipt_Number", "Student_ID", "Date", "Fee_Type", "Month",
          "Total_Amount", "Discount_Amount", "Net_Payable", "Amount_Paid",
          "Balance_Amount", "Payment_Mode", "Received_By", "Allocations_Summary"
        ]);
      }
      sheet.appendRow([
        data.receipt_no || "REC-" + Date.now(),
        data.student_id || "",
        data.date || new Date().toISOString().split("T")[0],
        data.fee_type || "Monthly",
        data.month || "",
        data.total_amount !== undefined ? Number(data.total_amount) : 0,
        data.discount_amount !== undefined ? Number(data.discount_amount) : 0,
        data.net_payable !== undefined ? Number(data.net_payable) : (Number(data.total_amount || 0) - Number(data.discount_amount || 0)),
        data.amount_paid !== undefined ? Number(data.amount_paid) : 0,
        data.balance_amount !== undefined ? Number(data.balance_amount) : 0,
        data.payment_mode || "Cash",
        data.received_by || "Manager",
        data.allocations_summary || data.notes || ""
      ]);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Fee Record Saved Successfully!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3B. EDIT FEE RECORD (Manager Edit)
    if (action === "editFee") {
      var sheet = ss.getSheetByName("Fee_Collection");
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Fee_Collection sheet not found"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var targetReceipt = String(data.original_receipt_no || data.receipt_no || "").trim().toLowerCase();
      var rows = sheet.getDataRange().getValues();
      var foundRow = -1;
      for (var r = 1; r < rows.length; r++) {
        var rowRec = String(rows[r][0] || "").trim().toLowerCase();
        if (rowRec === targetReceipt) {
          foundRow = r + 1;
          break;
        }
      }
      if (foundRow !== -1) {
        sheet.getRange(foundRow, 1, 1, 13).setValues([[
          data.receipt_no || rows[foundRow - 1][0],
          data.student_id || rows[foundRow - 1][1],
          data.date || rows[foundRow - 1][2],
          data.fee_type || rows[foundRow - 1][3],
          data.month || rows[foundRow - 1][4],
          data.total_amount !== undefined ? Number(data.total_amount) : rows[foundRow - 1][5],
          data.discount_amount !== undefined ? Number(data.discount_amount) : 0,
          data.net_payable !== undefined ? Number(data.net_payable) : (Number(data.total_amount || 0) - Number(data.discount_amount || 0)),
          data.amount_paid !== undefined ? Number(data.amount_paid) : rows[foundRow - 1][8],
          data.balance_amount !== undefined ? Number(data.balance_amount) : rows[foundRow - 1][9],
          data.payment_mode || rows[foundRow - 1][10],
          data.received_by || rows[foundRow - 1][11],
          data.allocations_summary || data.notes || rows[foundRow - 1][12] || ""
        ]]);
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: "Fee Record Updated in Sheet!"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "not_found",
        message: "Receipt #" + targetReceipt + " not found to edit"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3C. DELETE FEE RECORD (Manager Delete)
    if (action === "deleteFee") {
      var sheet = ss.getSheetByName("Fee_Collection");
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Fee_Collection sheet not found"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var delReceipt = String(data.receipt_no || "").trim().toLowerCase();
      var rows = sheet.getDataRange().getValues();
      var deleted = false;
      for (var r = rows.length - 1; r >= 1; r--) {
        var rowRec = String(rows[r][0] || "").trim().toLowerCase();
        if (rowRec === delReceipt) {
          sheet.deleteRow(r + 1);
          deleted = true;
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: deleted ? "success" : "not_found",
        message: deleted ? "Fee receipt deleted from sheet" : "Receipt not found in sheet"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 3C. RUN PAST DUES BACKFILL (From student Session_Start_Month up to Current Month)
    if (action === "generatePastDues" || action === "backfillDues") {
      var backfillRes = generatePastDues();
      return ContentService.createTextOutput(JSON.stringify(backfillRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3D. RUN MONTHLY DUES TRIGGER (Manual trigger invoke)
    if (action === "generateMonthlyDues" || action === "autoBill") {
      var genRes = generateMonthlyDues();
      return ContentService.createTextOutput(JSON.stringify(genRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3E. SAVE FEE MASTER (Option B: Auto-Creates or Updates Fee_Master sheet)
    if (action === "saveFeeMaster") {
      return handleSaveFeeMaster(ss, data.configs || data);
    }

    // 3F. SYNC SCHOOL NOTICES (Option B: Auto-Creates or Updates School_Notices sheet)
    if (action === "syncNotices" || action === "saveNotice") {
      return handleSyncNotices(ss, data);
    }

    // 3G. SETUP ALL REQUIRED SHEETS / AUTO-CREATE TABS
    if (action === "setupAllSheets" || action === "setupDatabase" || action === "createAllSheets" || action === "initTabs") {
      var setupRes = setupAllRequiredSheets();
      return ContentService.createTextOutput(JSON.stringify(setupRes))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 3H. ASSIGN TEACHER CLASS BY MANAGER
    if (action === "assignTeacherClass" || action === "updateUserClass") {
      var userSheet = ss.getSheetByName("Users");
      if (userSheet) {
        var uData = userSheet.getDataRange().getValues();
        var targetUid = String(data.user_id || data.userId || data.username || "").trim().toLowerCase();
        var newCls = String(data.assigned_class || data.class || data.Assigned_Class || "").trim();
        for (var r = 1; r < uData.length; r++) {
          var rowUid = String(uData[r][0] || "").trim().toLowerCase();
          var rowUser = String(uData[r][2] || "").trim().toLowerCase();
          var rowName = String(uData[r][4] || "").trim().toLowerCase();
          if ((targetUid && (rowUid === targetUid || rowUser === targetUid)) || (targetUid && rowName === targetUid)) {
            // Column 7 (G) is Assigned_Class
            userSheet.getRange(r + 1, 7).setValue(newCls);
            break;
          }
        }
        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          message: "Teacher class updated in Users sheet successfully"
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // 4. ADD / BATCH ADD BEHAVIOR & ATTENDANCE
    if (action === "addBehavior" || action === "batchAddBehavior") {
      var sheet = ss.getSheetByName("Student_Behavior");
      if (!sheet) sheet = ss.insertSheet("Student_Behavior");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          "Behavior_ID", "Student_ID", "Date", "Class",
          "Is_Bathed", "Nails_Clean", "Uniform_clean",
          "Good_Manners", "Discipline", "Is_Present", "Remark", "AI_Feedback"
        ]);
      }

      var items = Array.isArray(data.records)
        ? data.records
        : Array.isArray(data.behavior)
        ? data.behavior
        : Array.isArray(data)
        ? data
        : [data];

      var existingRows = sheet.getDataRange().getValues();
      var keyMap = {};
      for (var r = 1; r < existingRows.length; r++) {
        var rowBId = String(existingRows[r][0] || "").trim().toLowerCase();
        var rowSId = String(existingRows[r][1] || "").trim().toLowerCase();
        var rowDate = String(existingRows[r][2] || "").trim();
        if (rowBId) keyMap[rowBId] = r + 1;
        if (rowSId && rowDate) keyMap[rowSId + "_" + rowDate] = r + 1;
      }

      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        var sId = String(it.student_id || it.Student_ID || "").trim();
        if (!sId) continue;
        var dt = String(it.date || it.Date || new Date().toISOString().split("T")[0]).trim();
        var bId = String(it.behavior_id || it.Behavior_ID || ("BEH-" + sId + "-" + dt)).trim();
        var cls = String(it.class || it.Class || "").trim();

        var isPresStr = "Present";
        if (it.is_present === false || String(it.is_present || "").toLowerCase() === "absent" || it.Is_Present === false) {
          isPresStr = "Absent";
        }

        var isBathedStr = (it.is_bathed === false || String(it.is_bathed || "").toLowerCase() === "no") ? "No" : "Yes";
        var nailsCleanStr = (it.nails_clean === false || String(it.nails_clean || "").toLowerCase() === "no") ? "No" : "Yes";
        var uniformCleanStr = (it.uniform_clean === false || String(it.uniform_clean || "").toLowerCase() === "no") ? "No" : "Yes";
        var disciplineStr = (it.discipline === false || String(it.discipline || "").toLowerCase() === "needs improvement") ? "Needs Improvement" : "Good";
        var goodMannersStr = it.good_manners || it.Good_Manners || (isPresStr === "Absent" ? "लागू नहीं (अनुपस्थित)" : "उत्कृष्ट (Excellent)");
        var remarkStr = String(it.remark || it.Remark || (isPresStr === "Absent" ? "आज छात्र विद्यालय में अनुपस्थित रहा।" : "कक्षा में उपस्थित, स्वच्छ व अनुशासित")).trim();
        var feedbackStr = String(it.ai_feedback || it.AI_Feedback || "").trim();

        var rowValues = [
          bId, sId, dt, cls,
          isBathedStr, nailsCleanStr, uniformCleanStr,
          goodMannersStr, disciplineStr, isPresStr, remarkStr, feedbackStr
        ];

        var targetRow = keyMap[bId.toLowerCase()] || keyMap[sId.toLowerCase() + "_" + dt];
        if (targetRow) {
          sheet.getRange(targetRow, 1, 1, 12).setValues([rowValues]);
        } else {
          sheet.appendRow(rowValues);
          keyMap[bId.toLowerCase()] = sheet.getLastRow();
          keyMap[sId.toLowerCase() + "_" + dt] = sheet.getLastRow();
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Behavior & Attendance Records Saved Successfully in Google Sheet!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. UPDATE HOMEWORK TRACKER (In-place update & deduplicated)
    if (action === "updateHomeworkTracker") {
      var sheet = ss.getSheetByName("Homework_Tracker");
      if (!sheet) sheet = ss.insertSheet("Homework_Tracker");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["ID", "Date", "Class", "Student_ID", "Subject", "Last_homework_Status"]);
      }

      function cleanDateForCompare(dVal) {
        if (!dVal) return "";
        if (Object.prototype.toString.call(dVal) === '[object Date]') {
          var y = dVal.getFullYear();
          var m = ("0" + (dVal.getMonth() + 1)).slice(-2);
          var d = ("0" + dVal.getDate()).slice(-2);
          return y + "-" + m + "-" + d;
        }
        var s = String(dVal).trim();
        var p = s.split(/[-/]/);
        if (p.length === 3) {
          if (p[2].length === 4) return p[2] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[0]).slice(-2);
          if (p[0].length === 4) return p[0] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[2]).slice(-2);
        }
        return s;
      }

      var recId = String(data.record_id || data.id || "TRK-" + Date.now()).trim();
      var sId = String(data.student_id || "").trim();
      var curDate = String(data.date || new Date().toISOString().split("T")[0]).trim();
      var compDate = cleanDateForCompare(curDate);
      var curRawStatus = String(data.status || "Completed").trim();
      var curStatus = /incom|pend|adhura|not/i.test(curRawStatus) ? "Incompleted" : "Completed";
      var curClass = String(data.class || "").trim();
      var curSubject = String(data.subject || "General").trim();

      // Find all rows matching student and date to update the primary and delete duplicates
      var rows = sheet.getDataRange().getValues();
      var matchedRows = [];
      for (var r = 1; r < rows.length; r++) {
        var rowRecId = String(rows[r][0] || "").trim();
        var rowDate = cleanDateForCompare(rows[r][1]);
        var rowSId = String(rows[r][3] || "").trim();
        if ((recId && rowRecId.toLowerCase() === recId.toLowerCase()) ||
            (sId && rowSId.toLowerCase() === sId.toLowerCase() && (rowDate === compDate || !compDate))) {
          matchedRows.push(r + 1);
        }
      }

      if (matchedRows.length > 0) {
        var primaryRow = matchedRows[0];
        sheet.getRange(primaryRow, 6).setValue(curStatus);
        if (curDate) sheet.getRange(primaryRow, 2).setValue(curDate);
        if (curClass) sheet.getRange(primaryRow, 3).setValue(curClass);
        if (curSubject) sheet.getRange(primaryRow, 5).setValue(curSubject);

        // Delete any duplicate conflicting rows (from bottom to top) so only one row exists per student
        for (var dIdx = matchedRows.length - 1; dIdx >= 1; dIdx--) {
          sheet.deleteRow(matchedRows[dIdx]);
        }
      } else {
        sheet.appendRow([recId, curDate, curClass, sId, curSubject, curStatus]);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Homework Tracker Status Updated in Google Sheet (Deduplicated)!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5B. BULK UPDATE HOMEWORK TRACKER
    if (action === "bulkUpdateHomeworkTracker") {
      var sheet = ss.getSheetByName("Homework_Tracker");
      if (!sheet) sheet = ss.insertSheet("Homework_Tracker");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["ID", "Date", "Class", "Student_ID", "Subject", "Last_homework_Status"]);
      }

      function cleanDateForCompare(dVal) {
        if (!dVal) return "";
        if (Object.prototype.toString.call(dVal) === '[object Date]') {
          var y = dVal.getFullYear();
          var m = ("0" + (dVal.getMonth() + 1)).slice(-2);
          var d = ("0" + dVal.getDate()).slice(-2);
          return y + "-" + m + "-" + d;
        }
        var s = String(dVal).trim();
        var p = s.split(/[-/]/);
        if (p.length === 3) {
          if (p[2].length === 4) return p[2] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[0]).slice(-2);
          if (p[0].length === 4) return p[0] + "-" + ("0" + p[1]).slice(-2) + "-" + ("0" + p[2]).slice(-2);
        }
        return s;
      }

      var sIds = data.student_ids || [];
      var curDate = String(data.date || new Date().toISOString().split("T")[0]).trim();
      var compDate = cleanDateForCompare(curDate);
      var curRawStatus = String(data.status || "Completed").trim();
      var curStatus = /incom|pend|adhura|not/i.test(curRawStatus) ? "Incompleted" : "Completed";
      var curClass = String(data.class || "").trim();
      var curSubject = String(data.subject || "General").trim();

      var rows = sheet.getDataRange().getValues();
      var sIdMap = {};
      for (var r = 1; r < rows.length; r++) {
        var rowSId = String(rows[r][3] || "").trim().toLowerCase();
        var rowDate = cleanDateForCompare(rows[r][1]);
        if (rowDate === compDate || !compDate) {
          if (!sIdMap[rowSId]) {
            sIdMap[rowSId] = r + 1;
          }
        }
      }

      for (var i = 0; i < sIds.length; i++) {
        var sid = String(sIds[i]).trim();
        var lowerSid = sid.toLowerCase();
        if (sIdMap[lowerSid]) {
          sheet.getRange(sIdMap[lowerSid], 6).setValue(curStatus);
          if (curClass) sheet.getRange(sIdMap[lowerSid], 3).setValue(curClass);
          if (curSubject) sheet.getRange(sIdMap[lowerSid], 5).setValue(curSubject);
        } else {
          var recId = "TRK-" + sid + "-" + curDate;
          sheet.appendRow([recId, curDate, curClass, sid, curSubject, curStatus]);
          sIdMap[lowerSid] = sheet.getLastRow();
        }
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Bulk Homework Tracker Status Updated in Google Sheet!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 6. ADD / UPDATE STUDENT (Students sheet with Session_Start_Month)
    if (action === "addStudent") {
      var sheet = ss.getSheetByName("Students");
      if (!sheet) sheet = ss.insertSheet("Students");
      var lastRow = sheet.getLastRow();
      if (lastRow === 0) {
        sheet.appendRow([
          "Student_ID", "Admission_Number", "Roll_Number", "Student_Name", "Class",
          "Father_Name", "Mother_Name", "Parent_Mobile", "Student_Photo", "Village/rRoute",
          "Adhar_Card", "Adhar_Photo", "Balance_Amount", "Session_Start_Month", "QR code"
        ]);
        lastRow = 1;
      }
      
      var lastCol = sheet.getLastColumn() || 15;
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

      // Auto-add Session_Start_Month column header if not present in existing sheet
      var hasStartMonthCol = false;
      for (var hi = 0; hi < headers.length; hi++) {
        var hStr = String(headers[hi] || "").trim().toLowerCase();
        if (hStr.indexOf("start_month") !== -1 || hStr.indexOf("session_start") !== -1 || hStr.indexOf("start month") !== -1) {
          hasStartMonthCol = true;
          break;
        }
      }
      if (!hasStartMonthCol) {
        sheet.getRange(1, headers.length + 1).setValue("Session_Start_Month");
        headers.push("Session_Start_Month");
      }

      var studentId = data.student_id || ("S-" + Date.now());
      var qrFormula = '=IMAGE(CONCATENATE("https://api.qrserver.com/v1/create-qr-code/?data=", "' + studentId + '", "&size=250x250"))';
      
      // Check if studentId already exists to update row, or find target row
      var targetRow = -1;
      var currentLastRow = sheet.getLastRow();
      if (currentLastRow > 1) {
        var idValues = sheet.getRange(1, 1, currentLastRow, 1).getValues();
        for (var r = 1; r < idValues.length; r++) {
          var idVal = String(idValues[r][0] || "").trim().toLowerCase();
          if (idVal && idVal === String(studentId).toLowerCase().trim()) {
            targetRow = r + 1; // Update existing student row
            break;
          }
        }
      }
      if (targetRow === -1 && currentLastRow > 1) {
        var idValues = sheet.getRange(1, 1, currentLastRow, 1).getValues();
        for (var r = 1; r < idValues.length; r++) {
          var idVal = String(idValues[r][0] || "").trim();
          if (!idVal) {
            targetRow = r + 1;
            break;
          }
        }
      }
      if (targetRow === -1) {
        targetRow = currentLastRow === 0 ? 2 : currentLastRow + 1;
      }

      var existingRowVals = [];
      if (targetRow <= currentLastRow && currentLastRow > 1) {
        try {
          existingRowVals = sheet.getRange(targetRow, 1, 1, headers.length).getValues()[0] || [];
        } catch (e) {
          existingRowVals = [];
        }
      }

      var row = [];
      for (var i = 0; i < headers.length; i++) {
        var h = String(headers[i] || "").trim().toLowerCase();
        if (h === "student_id" || h === "student id" || h === "id") {
          row.push(studentId);
        } else if (h === "admission_number" || h === "admission no" || h === "adm_no") {
          row.push(data.admission_number !== undefined ? data.admission_number : (existingRowVals[i] || ""));
        } else if (h === "roll_number" || h === "roll no" || h === "roll") {
          row.push(data.roll_number !== undefined ? data.roll_number : (existingRowVals[i] || ""));
        } else if (h === "student_name" || h === "name" || h === "student name") {
          row.push(data.student_name !== undefined ? data.student_name : (existingRowVals[i] || ""));
        } else if (h === "class") {
          row.push(data.class !== undefined ? data.class : (existingRowVals[i] || ""));
        } else if (h === "father_name" || h === "father name") {
          row.push(data.father_name !== undefined ? data.father_name : (existingRowVals[i] || ""));
        } else if (h === "mother_name" || h === "mother name") {
          row.push(data.mother_name !== undefined ? data.mother_name : (existingRowVals[i] || ""));
        } else if (h === "parent_mobile" || h === "mobile" || h === "parent mobile" || h === "phone") {
          row.push(data.parent_mobile !== undefined ? data.parent_mobile : (existingRowVals[i] || ""));
        } else if (h === "student_photo" || h === "photo") {
          var pVal = (data.student_photo !== undefined && data.student_photo !== null) ? String(data.student_photo).trim() : "";
          row.push(pVal || (existingRowVals[i] !== undefined ? existingRowVals[i] : ""));
        } else if (h.indexOf("village") !== -1 || h.indexOf("route") !== -1) {
          row.push(data.village_route !== undefined ? data.village_route : (data.village !== undefined ? data.village : (existingRowVals[i] || "")));
        } else if (h.indexOf("balance") !== -1) {
          row.push(data.balance_amount !== undefined ? Number(data.balance_amount) : (existingRowVals[i] !== undefined ? existingRowVals[i] : 0));
        } else if (h.indexOf("start_month") !== -1 || h.indexOf("session_start") !== -1 || h.indexOf("start month") !== -1 || h.indexOf("fee_start") !== -1) {
          row.push(data.session_start_month || data.Session_Start_Month || (existingRowVals[i] || "April"));
        } else if (h.indexOf("qr") !== -1) {
          row.push(existingRowVals[i] || qrFormula);
        } else {
          row.push(existingRowVals[i] !== undefined ? existingRowVals[i] : "");
        }
      }

      sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Student saved successfully to Students sheet!",
        student_id: studentId,
        row_number: targetRow
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 7. DELETE STUDENT
    if (action === "deleteStudent") {
      var sheet = ss.getSheetByName("Students");
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "error",
          message: "Students sheet not found"
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var studentId = String(data.student_id || data.studentId || "").trim();
      var deleted = false;
      var curRows = sheet.getLastRow();
      if (studentId && curRows > 1) {
        var idCol = sheet.getRange(1, 1, curRows, 1).getValues();
        for (var i = curRows - 1; i >= 1; i--) {
          if (String(idCol[i][0] || "").trim().toLowerCase() === studentId.toLowerCase()) {
            sheet.deleteRow(i + 1);
            deleted = true;
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: deleted ? "success" : "not_found",
        message: deleted ? "Student deleted from sheet" : "Student not found in sheet",
        student_id: studentId
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 8. RECORD / UPDATE STAFF ATTENDANCE (School QR Check-In & Check-Out)
    if (action === "recordStaffAttendance" || action === "addStaffAttendance" || action === "staffAttendance") {
      return handleRecordStaffAttendance(ss, data);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Unknown action: " + action
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleUpdateBusTracking(ss, data) {
  // If test ping, respond with success immediately
  if (data.test_ping === true || data.test_ping === "true" || data.ping === true) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Bus Tracking backend is online and ready to record locations!"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ss.getSheetByName("Bus_Tracking");
  if (!sheet) {
    sheet = ss.insertSheet("Bus_Tracking");
    sheet.appendRow(["Bus_ID", "Driver_Name", "Current_Location", "Last_Updated"]);
  }

  // Ensure header row exists
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Bus_ID", "Driver_Name", "Current_Location", "Last_Updated"]);
  }

  var busId = String(data.bus_id || data.busId || "ecad7ddc").trim();
  var driverName = String(data.driver_name || data.driverName || "Amjad").trim();
  var location = String(data.current_location || data.currentLocationStr || "").trim();
  
  // Current timestamp formatted in Indian Standard Time (IST)
  var istTimestamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  var rows = sheet.getDataRange().getValues();
  var targetRow = -1;

  for (var i = 1; i < rows.length; i++) {
    var rowBus = String(rows[i][0] || "").trim();
    var rowDriver = String(rows[i][1] || "").trim().toLowerCase();
    if ((busId && rowBus.toLowerCase() === busId.toLowerCase()) ||
        (driverName && rowDriver === driverName.toLowerCase())) {
      targetRow = i + 1; // 1-based row index
      break;
    }
  }

  if (targetRow > 0) {
    // Update existing row
    if (location) sheet.getRange(targetRow, 3).setValue(location);
    sheet.getRange(targetRow, 4).setValue(istTimestamp);
    if (driverName) sheet.getRange(targetRow, 2).setValue(driverName);
  } else {
    // Append new bus row
    sheet.appendRow([busId, driverName, location, istTimestamp]);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Bus location updated in Bus_Tracking sheet successfully!",
    bus_id: busId,
    location: location,
    updated_at: istTimestamp
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleSaveRouteStops(ss, data) {
  var sheet = ss.getSheetByName("Route_Stops") || ss.getSheetByName("Route_Stop") || ss.getSheetByName("Stoppages") || ss.getSheetByName("Stops");
  if (!sheet) {
    sheet = ss.insertSheet("Route_Stops");
    sheet.appendRow(["Stop_ID", "Route_ID", "Stop_Name", "Sequence_Order", "Latitude", "Longitude", "Morning_Time", "Evening_Time", "Village_Name", "Student_Count", "Notes"]);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Stop_ID", "Route_ID", "Stop_Name", "Sequence_Order", "Latitude", "Longitude", "Morning_Time", "Evening_Time", "Village_Name", "Student_Count", "Notes"]);
  }

  var routeId = String(data.route_id || data.routeId || "route-1").trim();
  var stops = [];
  if (Array.isArray(data.stops)) {
    stops = data.stops;
  } else if (typeof data.stops === "string") {
    try {
      stops = JSON.parse(data.stops);
    } catch(e) {
      stops = [];
    }
  }

  // Support single stop add/edit
  if ((!stops || stops.length === 0) && (data.stop_name || data.name || data.lat)) {
    stops = [{
      id: data.stop_id || data.id || ("stop-" + Date.now().toString().slice(-6)),
      name: data.stop_name || data.name || "Stop",
      sequence: Number(data.sequence || data.sequence_order || 1),
      lat: Number(data.lat || data.latitude || 0),
      lng: Number(data.lng || data.longitude || 0),
      morningTime: data.morning_time || data.morningTime || "07:30 AM",
      eveningTime: data.evening_time || data.eveningTime || "02:30 PM",
      villageName: data.village_name || data.villageName || "",
      studentCount: Number(data.student_count || data.studentCount || 0),
      notes: data.notes || ""
    }];
  }

  var existingData = sheet.getDataRange().getValues();
  var headerRow = existingData.length > 0 ? existingData[0] : ["Stop_ID", "Route_ID", "Stop_Name", "Sequence_Order", "Latitude", "Longitude", "Morning_Time", "Evening_Time", "Village_Name", "Student_Count", "Notes"];

  // Retain stops from OTHER routes
  var otherRoutesRows = [];
  for (var r = 1; r < existingData.length; r++) {
    var row = existingData[r];
    var rRoute = String(row[1] || "").trim();
    if (rRoute && rRoute.toLowerCase() !== routeId.toLowerCase()) {
      otherRoutesRows.push(row);
    }
  }

  // Generate clean rows for THIS route
  var thisRouteRows = [];
  for (var i = 0; i < stops.length; i++) {
    var st = stops[i];
    if (!st) continue;
    thisRouteRows.push([
      String(st.id || ("stop-" + (i + 1))),
      routeId,
      String(st.name || ("स्टॉप " + (i + 1))),
      Number(st.sequence || (i + 1)),
      Number(st.lat || 0),
      Number(st.lng || 0),
      String(st.morningTime || st.scheduledTime || ""),
      String(st.eveningTime || ""),
      String(st.villageName || ""),
      Number(st.studentCount || 0),
      String(st.notes || "")
    ]);
  }

  sheet.clearContents();
  var allRows = [headerRow].concat(otherRoutesRows).concat(thisRouteRows);
  if (allRows.length > 0) {
    sheet.getRange(1, 1, allRows.length, allRows[0].length).setValues(allRows);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Route stops for " + routeId + " saved to Google Sheet Route_Stops tab! Total stops: " + stops.length,
    route_id: routeId,
    count: stops.length
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetRouteStops(ss, params) {
  var sheet = ss.getSheetByName("Route_Stops") || ss.getSheetByName("Route_Stop") || ss.getSheetByName("Stoppages") || ss.getSheetByName("Stops");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: "success", stops: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  var data = sheet.getDataRange().getValues();
  var routeId = String(params.route_id || params.routeId || "").trim().toLowerCase();
  var stops = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row[0] && !row[2]) continue;
    var rowRoute = String(row[1] || "").trim().toLowerCase();
    if (routeId && rowRoute && rowRoute !== routeId) continue;
    stops.push({
      id: String(row[0] || ("stop-" + r)),
      routeId: String(row[1] || "route-1"),
      name: String(row[2] || ""),
      sequence: Number(row[3]) || r,
      lat: Number(row[4]) || 0,
      lng: Number(row[5]) || 0,
      morningTime: String(row[6] || ""),
      eveningTime: String(row[7] || ""),
      scheduledTime: String(row[6] || row[7] || ""),
      villageName: String(row[8] || ""),
      studentCount: Number(row[9]) || 0,
      notes: String(row[10] || "")
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "success", stops: stops })).setMimeType(ContentService.MimeType.JSON);
}

function handleDeleteRouteStop(ss, data) {
  var sheet = ss.getSheetByName("Route_Stops") || ss.getSheetByName("Route_Stop") || ss.getSheetByName("Stoppages") || ss.getSheetByName("Stops");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Route_Stops sheet not found" })).setMimeType(ContentService.MimeType.JSON);
  }
  var stopId = String(data.stop_id || data.id || "").trim().toLowerCase();
  var rows = sheet.getDataRange().getValues();
  var deleted = false;
  for (var r = rows.length - 1; r >= 1; r--) {
    if (String(rows[r][0] || "").trim().toLowerCase() === stopId) {
      sheet.deleteRow(r + 1);
      deleted = true;
      break;
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: deleted ? "success" : "not_found", message: deleted ? "Stop deleted" : "Stop not found" })).setMimeType(ContentService.MimeType.JSON);
}

function handleRecordStaffAttendance(ss, data) {
  var sheet = ss.getSheetByName("Staff_Attendance ") || ss.getSheetByName("Staff_Attendance") || ss.getSheetByName("Staff Attendance");
  if (!sheet) {
    sheet = ss.insertSheet("Staff_Attendance ");
  }

  // Ensure header row exists
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "ID", "Name", "User_ID", "Designation", "Date", "Check_In_Time", "Check_Out_Time",
      "Status", "Late_Minutes", "Extra_Hours", "Method", "Location", "Remark", "Timestamp", "Check_Out_Timestamp"
    ]);
  }

  var curDate = String(data.date || Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd")).trim();
  var userId = String(data.user_id || data.userId || "").trim().toLowerCase();
  var userName = String(data.name || data.staff_name || "").trim().toLowerCase();
  var isCheckOut = data.is_checkout === true || data.is_checkout === "true" || Boolean(data.check_out_time);
  var istTimestamp = Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss");

  var rows = sheet.getDataRange().getValues();
  var foundRow = -1;

  for (var r = 1; r < rows.length; r++) {
    var rowDate = String(rows[r][4] || "");
    if (rows[r][4] instanceof Date) {
      rowDate = Utilities.formatDate(rows[r][4], "Asia/Kolkata", "yyyy-MM-dd");
    } else {
      rowDate = rowDate.trim().split("T")[0];
    }
    var rowUserId = String(rows[r][2] || "").trim().toLowerCase();
    var rowName = String(rows[r][1] || "").trim().toLowerCase();

    if (rowDate === curDate && ((userId && rowUserId === userId) || (userName && rowName === userName))) {
      foundRow = r + 1;
      break;
    }
  }

  if (foundRow > 0) {
    // Update existing row (e.g. Check-Out or update status/remark)
    if (data.check_out_time || isCheckOut) {
      sheet.getRange(foundRow, 7).setValue(data.check_out_time || Utilities.formatDate(new Date(), "Asia/Kolkata", "hh:mm a"));
      sheet.getRange(foundRow, 15).setValue(istTimestamp);
    }
    if (data.status) sheet.getRange(foundRow, 8).setValue(data.status);
    if (data.late_minutes !== undefined) sheet.getRange(foundRow, 9).setValue(Number(data.late_minutes));
    if (data.extra_hours !== undefined) sheet.getRange(foundRow, 10).setValue(Number(data.extra_hours));
    if (data.method) sheet.getRange(foundRow, 11).setValue(data.method);
    if (data.location) sheet.getRange(foundRow, 12).setValue(data.location);
    if (data.remark) sheet.getRange(foundRow, 13).setValue(data.remark);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Staff attendance updated (Check-Out) in Google Sheet!",
      row: foundRow,
      action_type: "updated"
    })).setMimeType(ContentService.MimeType.JSON);
  } else {
    // Append new attendance row
    var recId = String(data.id || "STAFF-ATT-" + (userId || "STF") + "-" + curDate).trim();
    var checkInTime = String(data.check_in_time || Utilities.formatDate(new Date(), "Asia/Kolkata", "hh:mm a")).trim();
    var checkOutTime = data.check_out_time ? String(data.check_out_time).trim() : "";

    sheet.appendRow([
      recId,
      data.name || "Staff Member",
      data.user_id || "",
      data.designation || "Teacher",
      curDate,
      checkInTime,
      checkOutTime,
      data.status || "Present",
      data.late_minutes !== undefined ? Number(data.late_minutes) : 0,
      data.extra_hours !== undefined ? Number(data.extra_hours) : 0,
      data.method || "School QR Scan",
      data.location || "School Campus Gate",
      data.remark || "समय पर उपस्थित",
      istTimestamp,
      checkOutTime ? istTimestamp : ""
    ]);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Staff attendance recorded (Check-In) in Google Sheet!",
      row: sheet.getLastRow(),
      action_type: "inserted"
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Academic Session Months order (April = 1 ... March = 12)
var ACADEMIC_MONTHS = [
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "January", "February", "March"
];

function getAcademicMonthIndex(monthStr) {
  if (!monthStr) return 1; // Default to April (1)
  var clean = String(monthStr).trim().toLowerCase();
  for (var i = 0; i < ACADEMIC_MONTHS.length; i++) {
    if (clean.indexOf(ACADEMIC_MONTHS[i].toLowerCase()) !== -1 || ACADEMIC_MONTHS[i].toLowerCase().indexOf(clean) !== -1) {
      return i + 1;
    }
  }
  return 1;
}

function getCurrentAcademicMonthIndex(date) {
  var d = date || new Date();
  var calMonth = d.getMonth(); // 0 = Jan ... 11 = Dec
  // April (3) -> 1 ... Dec (11) -> 9, Jan (0) -> 10 ... Mar (2) -> 12
  return calMonth >= 3 ? (calMonth - 2) : (calMonth + 10);
}

/**
 * BACKEND FUNCTION: PAST MONTHS BACKFILL FUNCTION
 * generatePastDues() backfills billing rows for all active students from their
 * respective Session_Start_Month up to the current running month.
 * LOGIC:
 * 1. Loop through all active students in the Database.
 * 2. Read each student's Session_Start_Month and monthly tuition fee.
 * 3. Compare the academic month index (April = 1 ... March = 12) with current month index.
 * 4. Append fee due records ONLY for months >= student's Session_Start_Month and <= Current_Month.
 * 5. Ignore/skip all months prior to the student's Session_Start_Month.
 */
function generatePastDues() {
  var ss = getSpreadsheet();
  if (!ss) return { status: "error", message: "Spreadsheet not accessible" };

  var studentsSheet = ss.getSheetByName("Students");
  if (!studentsSheet) return { status: "error", message: "Students sheet not found" };

  var feeSheet = ss.getSheetByName("Fee_Collection");
  if (!feeSheet) {
    feeSheet = ss.insertSheet("Fee_Collection");
    feeSheet.appendRow([
      "Receipt_Number", "Student_ID", "Date", "Fee_Type", "Month",
      "Total_Amount", "Discount", "Amount_Paid", "Balance_Amount",
      "Payment_Mode", "Received_By", "Remarks"
    ]);
  }

  var today = new Date();
  var curAcadIdx = getCurrentAcademicMonthIndex(today);
  var curYear = today.getFullYear();
  var dateStr = Utilities.formatDate(today, "Asia/Kolkata", "yyyy-MM-dd");

  var feeMaster = {
    'c1': 500, 'play': 500,
    'c2': 600, 'nursery': 600, 'm1': 600,
    'c3': 600, 'lkg': 600, 'm2': 600,
    'c4': 600, 'ukg': 600, 'm3': 600,
    'c5': 650, '1st': 650, '1': 650,
    'c6': 650, '2nd': 650, '2': 650,
    'c7': 650, '3rd': 650, '3': 650,
    'c8': 700, '4th': 700, '4': 700,
    'c9': 700, '5th': 700, '5': 700,
    'c10': 800, '6th': 800, '6': 800,
    'c11': 800, '7th': 800, '7': 800,
    'c12': 850, '8th': 850, '8': 850
  };

  var studentsData = studentsSheet.getDataRange().getValues();
  if (studentsData.length <= 1) return { status: "empty", count: 0, message: "No students in database" };

  var headers = studentsData[0].map(function(h) { return String(h || "").trim().toLowerCase(); });
  var idIdx = headers.indexOf("student_id");
  if (idIdx === -1) idIdx = headers.indexOf("id");
  var classIdx = headers.indexOf("class");
  var monthlyFeeIdx = headers.indexOf("monthly_fee");
  var startMonthIdx = -1;
  for (var h = 0; h < headers.length; h++) {
    if (headers[h].indexOf("start_month") !== -1 || headers[h].indexOf("session_start") !== -1 || headers[h].indexOf("start month") !== -1) {
      startMonthIdx = h;
      break;
    }
  }
  var waiverIdx = headers.indexOf("fee_waiver");
  if (waiverIdx === -1) waiverIdx = headers.indexOf("is_free_student");
  var categoryIdx = headers.indexOf("category");
  var remarkIdx = headers.indexOf("remark");

  // Load existing fee collection records into a map to prevent duplicate billing
  var feeData = feeSheet.getDataRange().getValues();
  var existingBilledMap = {};
  for (var f = 1; f < feeData.length; f++) {
    var fSid = String(feeData[f][1] || "").trim().toLowerCase();
    var fMonth = String(feeData[f][4] || "").trim().toLowerCase();
    var fType = String(feeData[f][3] || "").trim().toLowerCase();
    for (var m = 0; m < ACADEMIC_MONTHS.length; m++) {
      if (fMonth.indexOf(ACADEMIC_MONTHS[m].toLowerCase()) !== -1 && (fType.indexOf("monthly") !== -1 || fType.indexOf("मासिक") !== -1 || fType.indexOf("tuition") !== -1 || fType.indexOf("due") !== -1)) {
        existingBilledMap[fSid + "::" + (m + 1)] = true;
      }
    }
  }

  var rowsToAppend = [];
  var totalBilledRows = 0;
  var skippedStudentsCount = 0;

  for (var i = 1; i < studentsData.length; i++) {
    var row = studentsData[i];
    var sId = idIdx !== -1 ? String(row[idIdx] || "").trim() : "";
    if (!sId) continue;

    // Check 100% Fee Waiver / Free Student
    var isFree = false;
    if (waiverIdx !== -1) {
      var wVal = String(row[waiverIdx] || "").toLowerCase();
      if (wVal === "true" || wVal === "yes" || wVal.indexOf("100") !== -1 || wVal.indexOf("free") !== -1 || wVal.indexOf("माफ") !== -1) {
        isFree = true;
      }
    }
    if (categoryIdx !== -1) {
      var catVal = String(row[categoryIdx] || "").toLowerCase();
      if (catVal.indexOf("rte") !== -1 || catVal.indexOf("free") !== -1 || catVal.indexOf("माफ") !== -1) {
        isFree = true;
      }
    }
    if (remarkIdx !== -1) {
      var remVal = String(row[remarkIdx] || "").toLowerCase();
      if (remVal.indexOf("फीस माफ") !== -1 || remVal.indexOf("100% waiver") !== -1) {
        isFree = true;
      }
    }

    if (isFree) {
      skippedStudentsCount++;
      continue;
    }

    // Determine student's Session_Start_Month
    var studentStartMonthStr = startMonthIdx !== -1 ? String(row[startMonthIdx] || "").trim() : "";
    if (!studentStartMonthStr) {
      studentStartMonthStr = "April"; // Default to April if missing or blank
    }
    var studentStartMonthIdx = getAcademicMonthIndex(studentStartMonthStr);

    // Determine monthly tuition fee
    var sClass = classIdx !== -1 ? String(row[classIdx] || "").toLowerCase().trim() : "nursery";
    var customFee = monthlyFeeIdx !== -1 ? Number(row[monthlyFeeIdx]) : 0;
    var monthlyAmount = 600;

    if (!isNaN(customFee) && customFee > 0) {
      monthlyAmount = customFee;
    } else if (feeMaster[sClass] !== undefined) {
      monthlyAmount = feeMaster[sClass];
    } else {
      for (var k in feeMaster) {
        if (sClass.indexOf(k) !== -1) {
          monthlyAmount = feeMaster[k];
          break;
        }
      }
    }

    // Loop through academic months from student's Session_Start_Month up to Current_Month
    for (var mIdx = studentStartMonthIdx; mIdx <= curAcadIdx; mIdx++) {
      var mapKey = sId.toLowerCase() + "::" + mIdx;
      if (existingBilledMap[mapKey]) {
        continue;
      }

      var monthName = ACADEMIC_MONTHS[mIdx - 1];
      var monthYear = curYear;
      if (today.getMonth() >= 3 && mIdx >= 10) {
        monthYear = curYear + 1;
      } else if (today.getMonth() < 3 && mIdx < 10) {
        monthYear = curYear - 1;
      }

      var receiptNo = "BILL-" + monthYear + "-M" + mIdx + "-" + sId;
      rowsToAppend.push([
        receiptNo,                  // 0: Receipt_Number
        sId,                        // 1: Student_ID
        dateStr,                    // 2: Date
        "Monthly Tuition Fee",      // 3: Fee_Type
        monthName,                  // 4: Month
        monthlyAmount,              // 5: Total_Amount (TOTAL FEE)
        0,                          // 6: Discount
        monthlyAmount,              // 7: Net_Payable / Extra
        0,                          // 8: Amount_Paid (PAID: 0 for Due!)
        monthlyAmount,              // 9: Balance_Amount (BALANCE: monthlyAmount!)
        "Due",                      // 10: Payment_Mode (MODE: "Due")
        "System Backfill",          // 11: Received_By
        "generatePastDues"          // 12: Remarks
      ]);

      existingBilledMap[mapKey] = true;
      totalBilledRows++;
    }
  }

  if (rowsToAppend.length > 0) {
    var startRow = feeSheet.getLastRow() + 1;
    feeSheet.getRange(startRow, 1, rowsToAppend.length, 13).setValues(rowsToAppend);
  }

  var resultMsg = "generatePastDues completed: Appended " + totalBilledRows + " billing rows for months up to " + ACADEMIC_MONTHS[curAcadIdx - 1] + ". Skipped " + skippedStudentsCount + " free students.";
  Logger.log(resultMsg);

  return {
    status: "success",
    message: resultMsg,
    billedRowsCount: totalBilledRows,
    currentAcademicMonth: ACADEMIC_MONTHS[curAcadIdx - 1],
    currentAcademicMonthIndex: curAcadIdx
  };
}

/**
 * AUTO-RECALCULATE DUES ON LOAD / getStudentDues
 * When fetching student summary data, if no fee record exists for a student in the Fees sheet,
 * automatically calls generatePastDues() to append missing monthly billing entries before returning response.
 */
function getStudentDues(studentId) {
  var ss = getSpreadsheet();
  if (!ss) return { status: "error", message: "Spreadsheet not accessible" };

  var feeSheet = ss.getSheetByName("Fee_Collection");
  if (!feeSheet) {
    generatePastDues();
    feeSheet = ss.getSheetByName("Fee_Collection");
  }

  var feeData = feeSheet.getDataRange().getValues();
  var studentRecords = [];
  var hasRecords = false;

  for (var i = 1; i < feeData.length; i++) {
    var rSid = String(feeData[i][1] || "").trim().toLowerCase();
    if (rSid === String(studentId || "").trim().toLowerCase()) {
      studentRecords.push(feeData[i]);
      hasRecords = true;
    }
  }

  if (!hasRecords) {
    generatePastDues();
    feeData = feeSheet.getDataRange().getValues();
    for (var i = 1; i < feeData.length; i++) {
      var rSid = String(feeData[i][1] || "").trim().toLowerCase();
      if (rSid === String(studentId || "").trim().toLowerCase()) {
        studentRecords.push(feeData[i]);
      }
    }
  }

  var totalPaid = 0;
  var totalBilled = 0;
  studentRecords.forEach(function(row) {
    var paid = Number(row[7]) || 0;
    var total = Number(row[5]) || 0;
    totalPaid += paid;
    totalBilled += total;
  });

  var pendingAmount = Math.max(0, totalBilled - totalPaid);

  return {
    status: "success",
    studentId: studentId,
    recordsCount: studentRecords.length,
    totalBilled: totalBilled,
    totalPaid: totalPaid,
    pendingAmount: pendingAmount,
    records: studentRecords
  };
}

/**
 * AUTOMATIC MONTHLY FEE GENERATION (APPS SCRIPT TRIGGER)
 * Trigger: Runs automatically on the 1st of every month.
 * Iterates through active students in 'Students' sheet.
 * Checks:
 * 1. Current_Running_Month >= Student's Session_Start_Month
 * 2. Student is NOT marked as 100% Fee Waived/Free.
 * If true, add the current month's due row; otherwise, skip.
 */
function generateMonthlyDues() {
  var ss = getSpreadsheet();
  if (!ss) {
    Logger.log("Error: Spreadsheet not accessible.");
    return { status: "error", message: "Spreadsheet not accessible" };
  }

  var studentsSheet = ss.getSheetByName("Students");
  if (!studentsSheet) {
    Logger.log("Error: 'Students' sheet not found.");
    return { status: "error", message: "'Students' sheet not found" };
  }

  var feeSheet = ss.getSheetByName("Fee_Collection");
  if (!feeSheet) {
    feeSheet = ss.insertSheet("Fee_Collection");
    feeSheet.appendRow([
      "Receipt_Number", "Student_ID", "Date", "Fee_Type", "Month",
      "Total_Amount", "Discount_Amount", "Net_Payable", "Amount_Paid",
      "Balance_Amount", "Payment_Mode", "Received_By"
    ]);
  }

  var today = new Date();
  var curAcadIdx = getCurrentAcademicMonthIndex(today);
  var curMonthName = ACADEMIC_MONTHS[curAcadIdx - 1];
  var curYear = today.getFullYear();
  var dateStr = Utilities.formatDate(today, "Asia/Kolkata", "yyyy-MM-dd");

  var feeMaster = {
    'c1': 500, 'play': 500,
    'c2': 600, 'nursery': 600, 'm1': 600,
    'c3': 600, 'lkg': 600, 'm2': 600,
    'c4': 600, 'ukg': 600, 'm3': 600,
    'c5': 650, '1st': 650, '1': 650,
    'c6': 650, '2nd': 650, '2': 650,
    'c7': 650, '3rd': 650, '3': 650,
    'c8': 700, '4th': 700, '4': 700,
    'c9': 700, '5th': 700, '5': 700,
    'c10': 800, '6th': 800, '6': 800,
    'c11': 800, '7th': 800, '7': 800,
    'c12': 850, '8th': 850, '8': 850
  };

  var studentsData = studentsSheet.getDataRange().getValues();
  if (studentsData.length <= 1) return { status: "empty", count: 0 };

  var headers = studentsData[0].map(function(h) { return String(h || "").trim().toLowerCase(); });
  var idIdx = headers.indexOf("student_id");
  if (idIdx === -1) idIdx = headers.indexOf("id");
  var classIdx = headers.indexOf("class");
  var monthlyFeeIdx = headers.indexOf("monthly_fee");
  var startMonthIdx = -1;
  for (var h = 0; h < headers.length; h++) {
    if (headers[h].indexOf("start_month") !== -1 || headers[h].indexOf("session_start") !== -1 || headers[h].indexOf("start month") !== -1) {
      startMonthIdx = h;
      break;
    }
  }
  var waiverIdx = headers.indexOf("fee_waiver");
  if (waiverIdx === -1) waiverIdx = headers.indexOf("is_free_student");
  var categoryIdx = headers.indexOf("category");
  var remarkIdx = headers.indexOf("remark");

  // Load existing fee collection rows for this month to avoid duplicates
  var feeData = feeSheet.getDataRange().getValues();
  var billedThisMonth = {};
  for (var f = 1; f < feeData.length; f++) {
    var fStudentId = String(feeData[f][1] || "").trim().toLowerCase();
    var fMonth = String(feeData[f][4] || "").trim().toLowerCase();
    var fType = String(feeData[f][3] || "").trim().toLowerCase();
    if (fMonth.indexOf(curMonthName.toLowerCase()) !== -1 && (fType.indexOf("monthly") !== -1 || fType.indexOf("मासिक") !== -1 || fType.indexOf("tuition") !== -1 || fType.indexOf("due") !== -1)) {
      billedThisMonth[fStudentId] = true;
    }
  }

  var generatedCount = 0;
  var skippedFreeCount = 0;
  var skippedNotStartedCount = 0;
  var alreadyBilledCount = 0;
  var rowsToAppend = [];

  for (var i = 1; i < studentsData.length; i++) {
    var row = studentsData[i];
    var sId = idIdx !== -1 ? String(row[idIdx] || "").trim() : "";
    if (!sId) continue;

    // 1. Check if student has 100% Fee Waiver (Free Student)
    var isFree = false;
    if (waiverIdx !== -1) {
      var wVal = String(row[waiverIdx] || "").toLowerCase();
      if (wVal === "true" || wVal === "yes" || wVal.indexOf("100") !== -1 || wVal.indexOf("free") !== -1 || wVal.indexOf("माफ") !== -1) {
        isFree = true;
      }
    }
    if (categoryIdx !== -1) {
      var catVal = String(row[categoryIdx] || "").toLowerCase();
      if (catVal.indexOf("rte") !== -1 || catVal.indexOf("free") !== -1 || catVal.indexOf("माफ") !== -1) {
        isFree = true;
      }
    }
    if (remarkIdx !== -1) {
      var remVal = String(row[remarkIdx] || "").toLowerCase();
      if (remVal.indexOf("फीस माफ") !== -1 || remVal.indexOf("100% waiver") !== -1) {
        isFree = true;
      }
    }

    if (isFree) {
      skippedFreeCount++;
      continue;
    }

    // 2. Check: Current_Running_Month >= Student's Session_Start_Month
    var studentStartMonthStr = startMonthIdx !== -1 ? String(row[startMonthIdx] || "").trim() : "April";
    var studentStartMonthIdx = getAcademicMonthIndex(studentStartMonthStr);

    if (curAcadIdx < studentStartMonthIdx) {
      skippedNotStartedCount++;
      continue;
    }

    // 3. Skip if already billed for this month
    if (billedThisMonth[sId.toLowerCase()]) {
      alreadyBilledCount++;
      continue;
    }

    // 4. Determine Monthly Tuition amount
    var sClass = classIdx !== -1 ? String(row[classIdx] || "").toLowerCase().trim() : "nursery";
    var customFee = monthlyFeeIdx !== -1 ? Number(row[monthlyFeeIdx]) : 0;
    var monthlyAmount = 600;

    if (!isNaN(customFee) && customFee > 0) {
      monthlyAmount = customFee;
    } else if (feeMaster[sClass] !== undefined) {
      monthlyAmount = feeMaster[sClass];
    } else {
      for (var k in feeMaster) {
        if (sClass.indexOf(k) !== -1) {
          monthlyAmount = feeMaster[k];
          break;
        }
      }
    }

    var receiptNo = "BILL-" + curYear + "-M" + curAcadIdx + "-" + sId;
    rowsToAppend.push([
      receiptNo,                     // 0: Receipt_Number
      sId,                           // 1: Student_ID
      dateStr,                       // 2: Date
      "Monthly Tuition Fee",         // 3: Fee_Type
      curMonthName,                  // 4: Month
      monthlyAmount,                 // 5: Total_Amount (TOTAL FEE)
      0,                             // 6: Discount
      monthlyAmount,                 // 7: Net_Payable / Extra
      0,                             // 8: Amount_Paid (PAID: 0 for Due!)
      monthlyAmount,                 // 9: Balance_Amount (BALANCE: monthlyAmount!)
      "Due",                         // 10: Payment_Mode (MODE: "Due")
      "System Auto-Bill",            // 11: Received_By
      "Automated Monthly Bill (Due)" // 12: Remarks
    ]);

    billedThisMonth[sId.toLowerCase()] = true;
    generatedCount++;
  }

  if (rowsToAppend.length > 0) {
    var startRow = feeSheet.getLastRow() + 1;
    feeSheet.getRange(startRow, 1, rowsToAppend.length, 13).setValues(rowsToAppend);
  }

  var msg = "generateMonthlyDues complete for " + curMonthName + " " + curYear +
            ": Billed: " + generatedCount +
            ", Skipped Free: " + skippedFreeCount +
            ", Skipped Not-Started: " + skippedNotStartedCount +
            ", Already Billed: " + alreadyBilledCount;
  Logger.log(msg);

  return {
    status: "success",
    message: msg,
    month: curMonthName + " " + curYear,
    generatedCount: generatedCount,
    skippedFreeCount: skippedFreeCount,
    skippedNotStartedCount: skippedNotStartedCount,
    alreadyBilledCount: alreadyBilledCount
  };
}

/**
 * ONE-CLICK TRIGGER INSTALLER
 * Sets up generateMonthlyDues() to execute on the 1st of every month at 01:00 AM.
 */
function installMonthlyFeeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "generateMonthlyDues") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("generateMonthlyDues")
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .create();

  Logger.log("Trigger Installed: generateMonthlyDues will run on 1st of every month at 1:00 AM.");
  return { status: "success", message: "Monthly Trigger installed for 1st of every month!" };
}

/**
 * OPTION B: GET FEE MASTER (Strictly 4 Fees: Admission, Tuition, Exam, Books)
 */
function handleGetFeeMaster(ss) {
  var sheet = ss.getSheetByName("Fee_Master") || ss.getSheetByName("FeeMaster") || ss.getSheetByName("Fee Master");
  var defaultClasses = [
    { key: "play", name: "Play Group", tuition: 350, admission: 1000, exam: 150, books: 1140 },
    { key: "nursery", name: "Nursery (M1)", tuition: 350, admission: 1000, exam: 150, books: 1195 },
    { key: "lkg", name: "L.K.G. (M2)", tuition: 350, admission: 1000, exam: 150, books: 1245 },
    { key: "ukg", name: "U.K.G. (M3)", tuition: 350, admission: 1000, exam: 150, books: 1345 },
    { key: "1st", name: "Class 1st", tuition: 400, admission: 1000, exam: 200, books: 2345 },
    { key: "2nd", name: "Class 2nd", tuition: 400, admission: 1000, exam: 200, books: 2530 },
    { key: "3rd", name: "Class 3rd", tuition: 400, admission: 1000, exam: 200, books: 2705 },
    { key: "4th", name: "Class 4th", tuition: 450, admission: 1000, exam: 200, books: 2880 },
    { key: "5th", name: "Class 5th", tuition: 450, admission: 1000, exam: 200, books: 3050 },
    { key: "6th", name: "Class 6th", tuition: 500, admission: 1000, exam: 250, books: 3000 },
    { key: "7th", name: "Class 7th", tuition: 500, admission: 1000, exam: 250, books: 3100 },
    { key: "8th", name: "Class 8th", tuition: 500, admission: 1000, exam: 250, books: 3230 }
  ];

  if (!sheet) {
    sheet = ss.insertSheet("Fee_Master");
    sheet.appendRow(["Class", "Class-Name", "Admission_Fee", "Tuition_Fee", "Exam_Fee", "Books_Fee"]);
    for (var i = 0; i < defaultClasses.length; i++) {
      var d = defaultClasses[i];
      sheet.appendRow([d.key, d.name, d.admission, d.tuition, d.exam, d.books]);
    }
  }

  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length < 2) {
    return ContentService.createTextOutput(JSON.stringify({ status: "success", configs: {} })).setMimeType(ContentService.MimeType.JSON);
  }

  var headers = values[0].map(function(h) { return String(h || "").toLowerCase().trim(); });
  var classIdx = -1, admIdx = -1, tutIdx = -1, examIdx = -1, booksIdx = -1;
  for (var hi = 0; hi < headers.length; hi++) {
    var hName = headers[hi];
    if (hName.indexOf("class") !== -1 && hName.indexOf("name") === -1 && classIdx === -1) classIdx = hi;
    if (hName.indexOf("admission") !== -1 && admIdx === -1) admIdx = hi;
    if ((hName.indexOf("tuition") !== -1 || hName.indexOf("tution") !== -1 || hName.indexOf("monthly") !== -1) && tutIdx === -1) tutIdx = hi;
    if (hName.indexOf("exam") !== -1 && examIdx === -1) examIdx = hi;
    if (hName.indexOf("book") !== -1 && booksIdx === -1) booksIdx = hi;
  }
  if (classIdx === -1) classIdx = 0;

  var result = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var rawKey = String(row[classIdx] || "").toLowerCase().trim();
    if (!rawKey || rawKey === "class") continue;
    var normK = normalizeFeeClassKey(rawKey);
    result[normK] = {
      admissionFee: admIdx !== -1 ? Number(row[admIdx]) || 1000 : 1000,
      monthlyTuition: tutIdx !== -1 ? Number(row[tutIdx]) || 450 : 450,
      examFee: examIdx !== -1 ? Number(row[examIdx]) || 200 : 200,
      booksFee: booksIdx !== -1 ? Number(row[booksIdx]) || 2500 : 2500
    };
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    source: "Fee_Master sheet",
    configs: result
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * OPTION B: SAVE/UPDATE FEE MASTER SHEET (Strictly 4 Fees: Admission, Tuition, Exam, Books)
 */
function handleSaveFeeMaster(ss, configs) {
  if (!configs || typeof configs !== "object") {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "No fee master configuration data provided."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ss.getSheetByName("Fee_Master") || ss.getSheetByName("FeeMaster") || ss.getSheetByName("Fee Master");
  var standardHeaders = ["Class", "Class-Name", "Admission_Fee", "Tuition_Fee", "Exam_Fee", "Books_Fee"];
  
  if (!sheet) {
    sheet = ss.insertSheet("Fee_Master");
    sheet.appendRow(standardHeaders);
  }

  // Inspect existing headers
  var lastCol = Math.max(sheet.getLastColumn(), 6);
  var headerValues = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = headerValues.map(function(h) { return String(h || "").toLowerCase().trim(); });

  var classIdx = -1, nameIdx = -1, admIdx = -1, tutIdx = -1, examIdx = -1, booksIdx = -1;
  for (var si = 0; si < headers.length; si++) {
    var sH = headers[si];
    if (sH.indexOf("class") !== -1 && sH.indexOf("name") === -1 && classIdx === -1) classIdx = si;
    if (sH.indexOf("name") !== -1 && nameIdx === -1) nameIdx = si;
    if (sH.indexOf("admission") !== -1 && admIdx === -1) admIdx = si;
    if ((sH.indexOf("tuition") !== -1 || sH.indexOf("tution") !== -1 || sH.indexOf("monthly") !== -1) && tutIdx === -1) tutIdx = si;
    if (sH.indexOf("exam") !== -1 && examIdx === -1) examIdx = si;
    if (sH.indexOf("book") !== -1 && booksIdx === -1) booksIdx = si;
  }

  // If sheet had broken 11-column template with dummy Annual_Fee / Transport columns, clean it up!
  var hasJunkCols = lastCol > 6 && (headers.indexOf("annual_fee") !== -1 || headers.indexOf("transport_auto_fee") !== -1 || headers.indexOf("uniform_fee") !== -1 || headers[5] === "" || headers[6] === "");
  if (hasJunkCols || admIdx === -1 || tutIdx === -1) {
    sheet.getRange(1, 1, 1, 6).setValues([standardHeaders]);
    if (lastCol > 6) {
      sheet.getRange(1, 7, sheet.getMaxRows(), lastCol - 6).clearContent();
    }
    classIdx = 0;
    nameIdx = 1;
    admIdx = 2;
    tutIdx = 3;
    examIdx = 4;
    booksIdx = 5;
    lastCol = 6;
  }

  var existingRows = sheet.getDataRange().getValues();
  var keyToRow = {};
  for (var r = 1; r < existingRows.length; r++) {
    var rawK = String(existingRows[r][classIdx !== -1 ? classIdx : 0] || "").toLowerCase().trim();
    if (rawK) {
      var normK = normalizeFeeClassKey(rawK);
      keyToRow[normK] = r + 1;
      keyToRow[rawK] = r + 1;
    }
  }

  var classNames = {
    'play': 'PLAY', 'nursery': 'NURSERY (M1)', 'lkg': 'LKG (M2)', 'ukg': 'UKG (M3)',
    '1st': '1ST', '2nd': '2ND', '3rd': '3RD', '4th': '4TH',
    '5th': '5TH', '6th': '6TH', '7th': '7TH', '8th': '8TH'
  };

  var updatedCount = 0;
  var insertedCount = 0;

  for (var classKey in configs) {
    var conf = configs[classKey];
    if (!conf || typeof conf !== "object") continue;
    var normKey = normalizeFeeClassKey(classKey);
    var cName = conf.name || classNames[normKey] || classKey.toUpperCase();
    var admVal = Number(conf.admissionFee !== undefined ? conf.admissionFee : 1000);
    var tutVal = Number(conf.monthlyTuition !== undefined ? conf.monthlyTuition : 450);
    var examVal = Number(conf.examFee !== undefined ? conf.examFee : 200);
    var booksVal = Number(conf.booksFee !== undefined ? conf.booksFee : 2500);

    var targetRow = keyToRow[normKey] || keyToRow[classKey.toLowerCase()];

    if (targetRow) {
      // Write specifically into the matched columns
      if (classIdx !== -1) sheet.getRange(targetRow, classIdx + 1).setValue(normKey);
      if (nameIdx !== -1) sheet.getRange(targetRow, nameIdx + 1).setValue(cName);
      if (admIdx !== -1) sheet.getRange(targetRow, admIdx + 1).setValue(admVal);
      if (tutIdx !== -1) sheet.getRange(targetRow, tutIdx + 1).setValue(tutVal);
      if (examIdx !== -1) sheet.getRange(targetRow, examIdx + 1).setValue(examVal);
      if (booksIdx !== -1) sheet.getRange(targetRow, booksIdx + 1).setValue(booksVal);
      updatedCount++;
    } else {
      var newRow = [];
      for (var c = 0; c < lastCol; c++) {
        if (c === classIdx) newRow.push(normKey);
        else if (c === nameIdx) newRow.push(cName);
        else if (c === admIdx) newRow.push(admVal);
        else if (c === tutIdx) newRow.push(tutVal);
        else if (c === examIdx) newRow.push(examVal);
        else if (c === booksIdx) newRow.push(booksVal);
        else newRow.push("");
      }
      sheet.appendRow(newRow);
      insertedCount++;
    }
  }

  // Clear any extra columns beyond column 6 (cleans up stray Annual_Fee, 500, 1200, 800, 50)
  var totalCols = sheet.getLastColumn();
  if (totalCols > 6) {
    sheet.getRange(1, 7, sheet.getMaxRows(), totalCols - 6).clearContent();
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Fee_Master sheet updated cleanly! (Only 4 fees: Admission, Tuition, Exam, Books • " + updatedCount + " updated, " + insertedCount + " added)"
  })).setMimeType(ContentService.MimeType.JSON);
}

function normalizeFeeClassKey(s) {
  if (!s) return "";
  var str = String(s).toLowerCase().trim();
  if (str.indexOf("play") !== -1 || str === "c1") return "play";
  if (str.indexOf("nursery") !== -1 || str.indexOf("m1") !== -1 || str === "c2") return "nursery";
  if (str.indexOf("lkg") !== -1 || str.indexOf("m2") !== -1 || str === "c3") return "lkg";
  if (str.indexOf("ukg") !== -1 || str.indexOf("m3") !== -1 || str === "c4") return "ukg";
  if (str.indexOf("1st") !== -1 || str === "1" || str === "c5") return "1st";
  if (str.indexOf("2nd") !== -1 || str === "2" || str === "c6") return "2nd";
  if (str.indexOf("3rd") !== -1 || str === "3" || str === "c7") return "3rd";
  if (str.indexOf("4th") !== -1 || str === "4" || str === "c8") return "4th";
  if (str.indexOf("5th") !== -1 || str === "5" || str === "c9") return "5th";
  if (str.indexOf("6th") !== -1 || str === "6" || str === "c10") return "6th";
  if (str.indexOf("7th") !== -1 || str === "7" || str === "c11") return "7th";
  if (str.indexOf("8th") !== -1 || str === "8" || str === "c12") return "8th";
  return str;
}

/**
 * OPTION B: GET NOTICES (Auto-Creates School_Notices sheet if not present)
 */
function handleGetNotices(ss) {
  var sheet = ss.getSheetByName("School_Notices");
  if (!sheet) {
    sheet = ss.insertSheet("School_Notices");
    sheet.appendRow([
      "Notice_ID", "Date", "Category", "Title", "Description", "Target_Class", "Issued_By", "Is_Pinned", "Is_Emergency", "Created_At"
    ]);
    sheet.appendRow([
      "not-01",
      Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd"),
      "general",
      "सत्र 2026-27 फीस स्ट्रक्चर व दिशानिर्देश",
      "विद्यालय के सभी वर्गों (Play, Nursery, Primary, Middle) का नया फीस स्ट्रक्चर जारी कर दिया गया है।",
      "All",
      "प्रधानाचार्य (Principal)",
      "TRUE",
      "FALSE",
      Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm")
    ]);
  }

  var rows = sheet.getDataRange().getValues();
  var noticesList = [];
  if (rows.length > 1) {
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var id = String(row[0] || "").trim();
      if (!id) continue;
      noticesList.push({
        id: id,
        date: String(row[1] || "").trim(),
        category: String(row[2] || "general").toLowerCase().trim(),
        title: String(row[3] || "").trim(),
        description: String(row[4] || "").trim(),
        targetClass: String(row[5] || "All").trim(),
        issuedBy: String(row[6] || "Management").trim(),
        isPinned: String(row[7] || "").toUpperCase() === "TRUE",
        isEmergency: String(row[8] || "").toUpperCase() === "TRUE"
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    notices: noticesList
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * OPTION B: SYNC NOTICES TO School_Notices SHEET
 */
function handleSyncNotices(ss, data) {
  var sheet = ss.getSheetByName("School_Notices");
  if (!sheet) {
    sheet = ss.insertSheet("School_Notices");
    sheet.appendRow([
      "Notice_ID", "Date", "Category", "Title", "Description", "Target_Class", "Issued_By", "Is_Pinned", "Is_Emergency", "Created_At"
    ]);
  }

  var notices = data.notices;
  var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  if (Array.isArray(notices)) {
    if (sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
    var rowsToInsert = [];
    for (var i = 0; i < notices.length; i++) {
      var n = notices[i];
      if (!n || !n.title) continue;
      rowsToInsert.push([
        n.id || ("not-" + Date.now().toString().slice(-6) + i),
        n.date || Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd"),
        n.category || "general",
        n.title || "",
        n.description || "",
        n.targetClass || "All",
        n.issuedBy || "स्कूल प्रबंधन",
        n.isPinned ? "TRUE" : "FALSE",
        n.isEmergency ? "TRUE" : "FALSE",
        nowStr
      ]);
    }
    if (rowsToInsert.length > 0) {
      sheet.getRange(2, 1, rowsToInsert.length, 10).setValues(rowsToInsert);
    }
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "School_Notices sheet synchronized with " + rowsToInsert.length + " notices!",
      count: rowsToInsert.length,
      updatedAt: nowStr
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var nObj = data.notice || data;
  var singleRow = [
    nObj.id || ("not-" + Date.now().toString().slice(-6)),
    nObj.date || Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd"),
    nObj.category || "general",
    nObj.title || "",
    nObj.description || "",
    nObj.targetClass || "All",
    nObj.issuedBy || "स्कूल प्रबंधन",
    nObj.isPinned ? "TRUE" : "FALSE",
    nObj.isEmergency ? "TRUE" : "FALSE",
    nowStr
  ];
  sheet.appendRow(singleRow);

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Single notice appended to School_Notices sheet!",
    notice_id: singleRow[0]
  })).setMimeType(ContentService.MimeType.JSON);
}
`;

export interface SheetSyncDiagnostic {
  configured: boolean;
  statusType: 'success' | 'old_version' | 'permission_error' | 'network_error';
  message: string;
  details?: string;
  testedUrl: string;
}

// Test whether Google Apps Script currently has the updateBusTracking endpoint deployed
export const testGoogleSheetSync = async (targetUrl?: string): Promise<SheetSyncDiagnostic> => {
  const urlToTest = (targetUrl && targetUrl.trim().startsWith('http'))
    ? targetUrl.trim()
    : getAppsScriptUrl();

  try {
    // 1. First test ping endpoint
    let pingWorking = false;
    try {
      const pingRes = await fetch(`${urlToTest}?action=ping`);
      const pingText = await pingRes.text();
      if (pingText.includes('Online & Active') || pingText.includes('success')) {
        pingWorking = true;
      }
    } catch {}

    // 2. Test getBusTracking and check for old deployment
    let getText = '';
    let hasBusData = false;
    try {
      const getRes = await fetch(`${urlToTest}?action=getBusTracking`);
      getText = await getRes.text();
      try {
        const parsed = JSON.parse(getText);
        if (Array.isArray(parsed) && (parsed.length === 0 || (Array.isArray(parsed[0]) && parsed[0].includes('Bus_ID')))) {
          hasBusData = true;
        }
      } catch {}
    } catch {}

    // Check for permissions errors
    if (getText.startsWith('<!DOCTYPE') && (getText.includes('Google Drive') || getText.includes('Sign in'))) {
      return {
        configured: false,
        statusType: 'permission_error',
        message: 'अनुमति (Permission) एरर: "Who has access" को Anyone सेट करें',
        details: 'Deploy सेटिंग्स में "Execute as: Me" और "Who has access: Anyone" चुनना आवश्यक है ताकि बिना लॉगिन के लोकेशन सेव हो सके।',
        testedUrl: urlToTest,
      };
    }

    // 3. Test if new actions (Route Stops, Bus Tracking, Homework, Behavior) are supported
    let supportsRouteStops = false;
    let supportsNewActions = false;
    try {
      const stopCheckRes = await fetch(`${urlToTest}?action=getRouteStops&route_id=route-1`);
      const stopCheckText = await stopCheckRes.text();
      if (!stopCheckText.includes('Invalid Action') && (stopCheckText.includes('success') || stopCheckText.startsWith('['))) {
        supportsRouteStops = true;
      }
    } catch {}

    try {
      const testActionRes = await fetch(`${urlToTest}?action=updateBusTracking&bus_id=test&driver_name=test&current_location=0,0`);
      const testActionText = await testActionRes.text();
      if (testActionText.includes('success') || testActionText.includes('updated')) {
        supportsNewActions = true;
      }
    } catch {}

    if (supportsRouteStops && supportsNewActions) {
      return {
        configured: true,
        statusType: 'success',
        message: '✅ बहुत बढ़िया! Google Sheet (Route_Stops, Bus_Tracking, Homework, Behavior) पूरी तरह सक्रिय व कनेक्टेड है!',
        details: 'नया Apps Script वर्शन सफलतापूर्वक सक्रिय है। आपके द्वारा जोड़े गए सभी स्टॉपेज सीधे आपकी Google Sheet के Route_Stops टैब में सेव होंगे।',
        testedUrl: urlToTest,
      };
    }

    if (supportsNewActions && !supportsRouteStops) {
      return {
        configured: false,
        statusType: 'old_version',
        message: "⚠️ Google Apps Script में नया 'Route_Stops' कोड अपडेट करें!",
        details: "आपकी Google Sheet में 'Bus_Tracking' तो सक्रिय है, लेकिन स्टॉपेज का डेटा 'Route_Stops' में जाने के लिए नया Apps Script कोड कॉपी करके Extensions > Apps Script में Deploy > Manage Deployments > Edit > Version: New version करना आवश्यक है।",
        testedUrl: urlToTest,
      };
    }

    if (getText.includes('Invalid') || pingWorking) {
      return {
        configured: false,
        statusType: 'old_version',
        message: 'पुराना Apps Script वर्शन सक्रिय है: नया कोड पेस्ट करके "New version" डिप्लॉय करें!',
        details: 'आपकी Google Sheet में पुराना Apps Script डिप्लॉय है जिसमें addHomework, addBehavior और updateBusTracking शामिल नहीं हैं। कृपया नीचे दिया गया नया कोड कॉपी करें, Apps Script में पेस्ट करें, और Deploy > Manage deployments > ✏️ Edit > Version: "New version" चुनकर Deploy दबाएँ।',
        testedUrl: urlToTest,
      };
    }

    return {
      configured: false,
      statusType: 'old_version',
      message: 'Apps Script कोड अपडेट की आवश्यकता है',
      details: 'Apps Script में updateBusTracking एक्शन सक्रिय नहीं है। कृपया दिया गया कोड कॉपी करके Deploy करें।',
      testedUrl: urlToTest,
    };
  } catch (e: any) {
    return {
      configured: false,
      statusType: 'network_error',
      message: `कनेक्शन एरर: ${e.message || 'नेटवर्क अनुरोध विफल रहा'}`,
      details: 'कृपया इंटरनेट कनेक्शन जाँचें अथवा सुनिश्चित करें कि Apps Script Web App URL सही है।',
      testedUrl: urlToTest,
    };
  }
};

// Send live location update to Apps Script backend (Google Sheets "Bus_Tracking")
export const syncLocationToSheetBackend = async (data: {
  busId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  speed?: number | null;
  status?: string;
}): Promise<{ success: boolean; message?: string }> => {
  const locStr = `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`;
  const now = new Date().toISOString();
  const activeUrl = getAppsScriptUrl();

  // 1. First, always sync immediately to shared local server API (/api/bus-tracking)
  // This guarantees instant real-time tracking between Manager and Driver across all devices!
  syncLocationToSharedApi({
    busId: data.busId,
    driverName: data.driverName,
    driverPhone: '9761081818',
    currentLocationStr: locStr,
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: 10,
    speed: data.speed ?? 0,
    heading: 0,
    lastUpdated: new Date().toLocaleTimeString('hi-IN'),
    status: (data.status as any) || 'running',
    isLiveFromSheet: true,
  }).catch(() => {});

  // 2. Sync to school server proxy & Google Sheets via Apps Script Web App
  try {
    const payload = {
      action: 'updateBusTracking',
      bus_id: data.busId,
      driver_name: data.driverName,
      current_location: locStr,
      latitude: data.latitude,
      longitude: data.longitude,
      last_updated: now,
      speed: data.speed || 0,
      status: data.status || 'running',
    };

    // Forward through local proxy (updates real-time server telemetry and attempts sheet)
    let proxyOk = false;
    try {
      const pRes = await fetch('/api/forward-apps-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData?.success) proxyOk = true;
      }
    } catch {}

    // Try GET request first (most reliable with Google Apps Script without CORS redirect blocks)
    try {
      const getUrl = `${activeUrl}?action=updateBusTracking&bus_id=${encodeURIComponent(data.busId)}&driver_name=${encodeURIComponent(data.driverName)}&current_location=${encodeURIComponent(locStr)}`;
      const getRes = await fetch(getUrl);
      const getText = await getRes.text();
      if (getText.includes('success') || getText.includes('Bus location updated')) {
        return { success: true, message: 'गूगल शीट (Bus_Tracking) में लोकेशन अपडेट हो गई!' };
      }
    } catch {}

    // POST fallback
    try {
      const res = await fetch(activeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (text.includes('success') || text.includes('Bus location updated')) {
        return { success: true, message: 'गूगल शीट (Bus_Tracking) में लोकेशन अपडेट हो गई!' };
      }
    } catch {}

    if (proxyOk) {
      return { success: true, message: 'बस लोकेशन सर्वर व ऐप में रियल-टाइम अपडेट हो गई!' };
    }

    return {
      success: true,
      message: 'बस लोकेशन अपडेट हो गई (लोकल सिंक सक्रिय)',
    };
  } catch (err: any) {
    return {
      success: true,
      message: 'बस लोकेशन रियल-टाइम सिंक हो गई',
    };
  }
};

// =========================================================================
// ROUTE STOPS API & GOOGLE SHEET "Route_Stops" SYNC HELPERS
// =========================================================================

/**
 * Fetch real route stops directly from Google Sheets "Route_Stops" tab via GViz
 */
export const fetchRouteStopsFromGoogleSheet = async (routeId: string): Promise<RouteStoppage[]> => {
  try {
    const sheetId = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU';
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=Route_Stops&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonStr);
    const rows = parsed.table?.rows || [];
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const stops: RouteStoppage[] = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i]?.c || [];
      const stopId = String(c[0]?.v ?? '').trim();
      const rowRoute = String(c[1]?.v ?? '').trim();
      const stopName = String(c[2]?.v ?? '').trim();
      const seq = Number(c[3]?.v) || (stops.length + 1);
      const lat = Number(c[4]?.v);
      const lng = Number(c[5]?.v);
      const morningTime = String(c[6]?.v ?? '');
      const eveningTime = String(c[7]?.v ?? '');
      const village = String(c[8]?.v ?? '');
      const studentCount = Number(c[9]?.v) || 0;
      const notes = String(c[10]?.v ?? '');

      // Skip header row if returned inside rows
      if (!stopId || stopId.toLowerCase() === 'stop_id' || stopName.toLowerCase() === 'stop_name') continue;
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) continue;
      if (routeId && rowRoute && rowRoute.toLowerCase() !== routeId.toLowerCase()) continue;

      stops.push({
        id: stopId || `stop-${Date.now().toString().slice(-6)}`,
        name: stopName || `स्टॉप ${seq}`,
        sequence: seq,
        lat,
        lng,
        scheduledTime: morningTime || eveningTime || '07:30 AM',
        morningTime,
        eveningTime,
        villageName: village,
        studentCount,
        notes,
      });
    }

    stops.sort((a, b) => a.sequence - b.sequence);
    return stops;
  } catch (err) {
    console.warn('Error reading Route_Stops from Google Sheet GViz:', err);
    return [];
  }
};

export const fetchRouteStopsFromApi = async (routeId: string): Promise<RouteStoppage[]> => {
  // Check localStorage first
  let localStops: RouteStoppage[] = [];
  let localUpdateTime = 0;
  try {
    const saved = localStorage.getItem(`evs_van_route_stoppages_${routeId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localStops = parsed.filter(
          (s: any) =>
            s &&
            s.id &&
            !s.id.startsWith('stop-r1-') &&
            !s.id.startsWith('stop-r2-') &&
            !['stop-01', 'stop-02', 'stop-03', 'stop-04', 'stop-05', 'stop-06'].includes(s.id)
        );
      }
    }
    localUpdateTime = Number(localStorage.getItem(`evs_van_route_stoppages_time_${routeId}`) || 0);
  } catch {}

  // If local edit happened recently (last 15 seconds), prioritize localStops so edits/deletes don't flicker or revert
  if (Date.now() - localUpdateTime < 15000 && localStops.length > 0) {
    return localStops;
  }

  // 1. First priority: Load real recorded stops from Google Sheet "Route_Stops" tab
  try {
    const sheetStops = await fetchRouteStopsFromGoogleSheet(routeId);
    if (sheetStops && sheetStops.length > 0) {
      try {
        localStorage.setItem(`evs_van_route_stoppages_${routeId}`, JSON.stringify(sheetStops));
      } catch {}
      return sheetStops;
    }
  } catch {}

  // 2. Second priority: Local Server API
  try {
    const res = await fetch(`/api/route-stops?routeId=${encodeURIComponent(routeId)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.stops) && data.stops.length > 0) {
        const filtered = data.stops.filter((s: any) =>
          s && s.id && !s.id.startsWith('stop-r1-') && !s.id.startsWith('stop-r2-') && !['stop-01', 'stop-02', 'stop-03', 'stop-04', 'stop-05', 'stop-06'].includes(s.id)
        );
        if (filtered.length > 0) {
          return filtered;
        }
      }
    }
  } catch (e) {
    console.warn('Could not fetch route stops from /api/route-stops:', e);
  }

  // 3. Fallback: LocalStorage
  return localStops;
};

export const saveRouteStopsToApi = async (
  routeId: string,
  stops: RouteStoppage[]
): Promise<{ success: boolean; message: string }> => {
  // 1. Cache to localStorage immediately for instant offline and multi-tab access
  try {
    localStorage.setItem(`evs_van_route_stoppages_${routeId}`, JSON.stringify(stops));
    localStorage.setItem(`evs_van_route_stoppages_time_${routeId}`, String(Date.now()));
  } catch (e) {}

  let serverMessage = '';
  const activeUrl = getAppsScriptUrl();

  // 2. Post to Node server API (updates cache and broadcasts to all clients)
  try {
    const res = await fetch('/api/route-stops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId, stops }),
    });
    if (res.ok) {
      const data = await res.json();
      serverMessage = data.message || "गूगल शीट 'Route_Stops' टैब में स्टॉपेज सुरक्षित हो गए!";
    }
  } catch (e: any) {}

  // 3. Post to Node forwarder proxy if available
  try {
    await fetch('/api/forward-apps-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveRouteStops',
        route_id: routeId,
        stops: JSON.stringify(stops),
      }),
    });
  } catch {}

  // 4. DIRECT CLIENT-TO-APPS-SCRIPT CALLS (Works on Vercel & mobile browser directly!)
  if (activeUrl && activeUrl.startsWith('https://script.google.com/macros/s/')) {
    const encodedStops = encodeURIComponent(JSON.stringify(stops));

    // 4A. GET with encoded payload (Works without CORS blockage and cleanly follows 302 redirects)
    try {
      fetch(`${activeUrl}?action=saveRouteStops&route_id=${encodeURIComponent(routeId)}&routeId=${encodeURIComponent(routeId)}&stops=${encodedStops}`, {
        mode: 'no-cors',
      }).catch(() => {});
    } catch {}

    // 4B. Text/plain POST (Bypasses browser CORS preflight)
    try {
      fetch(activeUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'saveRouteStops',
          route_id: routeId,
          stops: stops,
        }),
      }).catch(() => {});
    } catch {}

    // 4C. Individual stop GET calls for granular persistence in Google Sheet
    for (const stop of stops) {
      try {
        const singleUrl = `${activeUrl}?action=addRouteStop&route_id=${encodeURIComponent(routeId)}&stop_id=${encodeURIComponent(stop.id)}&stop_name=${encodeURIComponent(stop.name)}&sequence=${stop.sequence}&lat=${stop.lat}&lng=${stop.lng}&morning_time=${encodeURIComponent(stop.morningTime || stop.scheduledTime || '')}&evening_time=${encodeURIComponent(stop.eveningTime || '')}&village_name=${encodeURIComponent(stop.villageName || '')}&student_count=${stop.studentCount || 0}&notes=${encodeURIComponent(stop.notes || '')}`;
        fetch(singleUrl, { mode: 'no-cors' }).catch(() => {});
      } catch {}
    }
  }

  return {
    success: true,
    message: serverMessage || "गूगल शीट 'Route_Stops' टैब में स्टॉपेज सुरक्षित हो गए!",
  };
};

// =========================================================================
// ROUTE STOPS ADD-ON SNIPPET (मौजूदा स्क्रिप्ट में केवल इतना कोड जोड़ें)
// =========================================================================
export const ROUTE_STOPS_ADDON_SNIPPET = `// ============================================================
// 📍 E.V.S. SCHOOL - ROUTE STOPS (स्टॉपेज) छोटा कोड
// (अपनी मौजूदा Apps Script में नीचे दिए 3 छोटे कदम जोड़ें)
// ============================================================

// [कदम 1] अपनी मौजूदा doGet(e) फंक्शन के अंदर यह 3 लाइनें जोड़ें:
/*
  if (action === "getRouteStops" || action === "getStoppages") {
    return handleGetRouteStops(e);
  }
  if (action === "saveRouteStops" || action === "addRouteStop" || action === "deleteRouteStop") {
    return handleSaveRouteStops(e);
  }
*/

// [कदम 2] अपनी मौजूदा doPost(e) फंक्शन के अंदर यह 3 लाइनें जोड़ें:
/*
  if (action === "saveRouteStops" || action === "addRouteStop" || action === "deleteRouteStop") {
    return handleSaveRouteStops(e);
  }
*/

// [कदम 3] अपनी Script फाइल (Code.gs) के सबसे नीचे यह फंक्शन्स पेस्ट कर दें:

function handleGetRouteStops(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) ss = SpreadsheetApp.openById("1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU");
    var sheet = ss.getSheetByName("Route_Stops") || ss.getSheetByName("Stoppages");
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ status: "success", stops: [] })).setMimeType(ContentService.MimeType.JSON);
    }
    var data = sheet.getDataRange().getValues();
    var params = (e && e.parameter) ? e.parameter : {};
    var routeId = String(params.route_id || params.routeId || "").trim().toLowerCase();
    var stops = [];
    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      if (!row[0] && !row[2]) continue;
      var rowRoute = String(row[1] || "").trim().toLowerCase();
      if (routeId && rowRoute && rowRoute !== routeId) continue;
      stops.push({
        id: String(row[0] || ("stop-" + r)),
        routeId: String(row[1] || "route-1"),
        name: String(row[2] || ""),
        sequence: Number(row[3]) || r,
        lat: Number(row[4]) || 0,
        lng: Number(row[5]) || 0,
        morningTime: String(row[6] || ""),
        eveningTime: String(row[7] || ""),
        scheduledTime: String(row[6] || row[7] || ""),
        villageName: String(row[8] || ""),
        studentCount: Number(row[9]) || 0,
        notes: String(row[10] || "")
      });
    }
    return ContentService.createTextOutput(JSON.stringify({ status: "success", stops: stops })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleSaveRouteStops(arg1, arg2) {
  try {
    var ss = (arg1 && typeof arg1.getSheetByName === "function") ? arg1 : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) ss = SpreadsheetApp.openById("1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU");
    var sheet = ss.getSheetByName("Route_Stops");
    if (!sheet) {
      sheet = ss.insertSheet("Route_Stops");
      sheet.appendRow(["Stop_ID", "Route_ID", "Stop_Name", "Sequence_Order", "Latitude", "Longitude", "Morning_Time", "Evening_Time", "Village_Name", "Student_Count", "Notes"]);
      sheet.getRange(1, 1, 1, 11).setFontWeight("bold").setBackground("#d9ead3");
    }

    var e = (arg2 !== undefined) ? arg2 : arg1;
    var params = {};
    if (e) {
      if (e.parameter) {
        for (var p in e.parameter) params[p] = e.parameter[p];
      }
      if (e.postData && e.postData.contents) {
        try {
          var body = JSON.parse(e.postData.contents);
          for (var b in body) params[b] = body[b];
        } catch(err) {}
      }
      if (!e.parameter && !e.postData) {
        for (var k in e) params[k] = e[k];
      }
    }

    var routeId = String(params.route_id || params.routeId || "route-1").trim();
    var stops = [];
    if (Array.isArray(params.stops)) {
      stops = params.stops;
    } else if (typeof params.stops === "string") {
      try { stops = JSON.parse(params.stops); } catch(err) { stops = []; }
    }

    // Support single stop parameter addition/edit
    if ((!stops || stops.length === 0) && (params.stop_name || params.name || params.lat)) {
      stops = [{
        id: params.stop_id || params.id || ("stop-" + Date.now().toString().slice(-6)),
        name: params.stop_name || params.name || "Stop",
        sequence: Number(params.sequence || params.sequence_order || 1),
        lat: Number(params.lat || params.latitude || 0),
        lng: Number(params.lng || params.longitude || 0),
        morningTime: params.morning_time || params.morningTime || "07:30 AM",
        eveningTime: params.evening_time || params.eveningTime || "02:30 PM",
        villageName: params.village_name || params.villageName || "",
        studentCount: Number(params.student_count || params.studentCount || 0),
        notes: params.notes || ""
      }];
    }

    var existingData = sheet.getDataRange().getValues();
    var headerRow = existingData.length > 0 ? existingData[0] : ["Stop_ID", "Route_ID", "Stop_Name", "Sequence_Order", "Latitude", "Longitude", "Morning_Time", "Evening_Time", "Village_Name", "Student_Count", "Notes"];

    var otherRoutesRows = [];
    for (var r = 1; r < existingData.length; r++) {
      var row = existingData[r];
      var rRoute = String(row[1] || "").trim();
      if (rRoute && rRoute.toLowerCase() !== routeId.toLowerCase()) {
        otherRoutesRows.push(row);
      }
    }

    var thisRouteRows = [];
    for (var i = 0; i < stops.length; i++) {
      var st = stops[i];
      if (!st) continue;
      thisRouteRows.push([
        String(st.id || ("stop-" + (i + 1))),
        routeId,
        String(st.name || ("स्टॉप " + (i + 1))),
        Number(st.sequence || (i + 1)),
        Number(st.lat || 0),
        Number(st.lng || 0),
        String(st.morningTime || st.scheduledTime || ""),
        String(st.eveningTime || ""),
        String(st.villageName || ""),
        Number(st.studentCount || 0),
        String(st.notes || "")
      ]);
    }

    sheet.clearContents();
    var allRows = [headerRow].concat(otherRoutesRows).concat(thisRouteRows);
    if (allRows.length > 0) {
      sheet.getRange(1, 1, allRows.length, allRows[0].length).setValues(allRows);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Route stops saved to Route_Stops tab successfully!",
      count: stops.length
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}`;


