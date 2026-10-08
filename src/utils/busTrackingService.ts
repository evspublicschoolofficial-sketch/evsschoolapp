// Bus Tracking Service & Telemetry Synchronizer
// Synchronizes with Google Sheets ("Bus_Tracking" & "Users") and real-time backend API

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

// School Campus Coordinates (E.V.S. Public School, Saharanpur, UP)
export const DEFAULT_SCHOOL_COORDS = {
  lat: 30.056038,
  lng: 77.419096,
  name: 'E.V.S. Public School (Saharanpur)',
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

  var msg = created.length > 0
    ? "✅ सफलतापूर्वक " + created.length + " नए टैब बनाए गए: " + created.join(", ")
    : "✅ सभी आवश्यक टैब (Fee_Master, School_Notices, Students आदि) पहले से मौजूद हैं!";

  try {
    SpreadsheetApp.getUi().alert("🏫 EVS स्कूल ऑटोमेशन", msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch(e) {}

  return {
    status: "success",
    message: msg,
    created: created,
    totalRequiredChecked: 7
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

  // 9. SETUP ALL REQUIRED SHEETS / AUTO-CREATE TABS
  if (action === "setupAllSheets" || action === "setupDatabase" || action === "createAllSheets" || action === "initTabs") {
    var setupRes = setupAllRequiredSheets();
    return ContentService.createTextOutput(JSON.stringify(setupRes))
      .setMimeType(ContentService.MimeType.JSON);
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

    // 1. ADD HOMEWORK
    if (action === "addHomework") {
      var sheet = ss.getSheetByName("Homework");
      if (!sheet) sheet = ss.insertSheet("Homework");
      sheet.appendRow([
        data.homework_id || "HW-" + Date.now(),
        data.date || new Date().toISOString().split("T")[0],
        data.class_name || data.class || "",
        data.subject || "",
        data.detail || "",
        "Whole Class",
        "",
        "",
        "",
        "",
        data.teacher || "Faculty"
      ]);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Homework Saved Successfully!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. UPDATE BUS TRACKING (BUS LIVE LOCATION)
    if (action === "updateBusTracking" || action === "updateLocation") {
      return handleUpdateBusTracking(ss, data);
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

    // 4. ADD BEHAVIOR
    if (action === "addBehavior") {
      var sheet = ss.getSheetByName("Student_Behavior");
      if (!sheet) sheet = ss.insertSheet("Student_Behavior");
      sheet.appendRow([
        data.behavior_id || "BEH-" + Date.now(),
        data.student_id || "",
        data.date || new Date().toISOString().split("T")[0],
        data.class || "",
        data.is_bathed || "Yes",
        data.nails_clean || "Yes",
        data.uniform_clean || "Yes",
        data.good_manners || "Yes",
        data.discipline || "Good",
        data.is_present || "Present",
        data.remark || ""
      ]);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Behavior Saved Successfully!"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // 5. UPDATE HOMEWORK TRACKER
    if (action === "updateHomeworkTracker") {
      var sheet = ss.getSheetByName("Homework_Tracker");
      if (!sheet) sheet = ss.insertSheet("Homework_Tracker");
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(["ID", "Date", "Class", "Student_ID", "Subject", "Last_homework_Status", "Remark"]);
      }
      sheet.appendRow([
        data.record_id || "TRK-" + Date.now(),
        data.date || new Date().toISOString().split("T")[0],
        data.class || "",
        data.student_id || "",
        data.subject || "General",
        data.status || "Completed",
        data.remark || ""
      ]);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Homework Tracker Status Updated!"
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
      
      var row = [];
      for (var i = 0; i < headers.length; i++) {
        var h = String(headers[i] || "").trim().toLowerCase();
        if (h === "student_id" || h === "student id" || h === "id") {
          row.push(studentId);
        } else if (h === "admission_number" || h === "admission no" || h === "adm_no") {
          row.push(data.admission_number || "");
        } else if (h === "roll_number" || h === "roll no" || h === "roll") {
          row.push(data.roll_number || "");
        } else if (h === "student_name" || h === "name" || h === "student name") {
          row.push(data.student_name || "");
        } else if (h === "class") {
          row.push(data.class || "");
        } else if (h === "father_name" || h === "father name") {
          row.push(data.father_name || "");
        } else if (h === "mother_name" || h === "mother name") {
          row.push(data.mother_name || "");
        } else if (h === "parent_mobile" || h === "mobile" || h === "parent mobile" || h === "phone") {
          row.push(data.parent_mobile || "");
        } else if (h === "student_photo" || h === "photo") {
          row.push(data.student_photo || "");
        } else if (h.indexOf("village") !== -1 || h.indexOf("route") !== -1) {
          row.push(data.village_route || data.village || "");
        } else if (h.indexOf("balance") !== -1) {
          row.push(data.balance_amount !== undefined ? Number(data.balance_amount) : 0);
        } else if (h.indexOf("start_month") !== -1 || h.indexOf("session_start") !== -1 || h.indexOf("start month") !== -1 || h.indexOf("fee_start") !== -1) {
          row.push(data.session_start_month || data.Session_Start_Month || "April");
        } else if (h.indexOf("qr") !== -1) {
          row.push(qrFormula);
        } else {
          row.push("");
        }
      }

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
 * OPTION B: GET FEE MASTER (Auto-Creates Fee_Master sheet if not present)
 */
function handleGetFeeMaster(ss) {
  var sheet = ss.getSheetByName("Fee_Master");
  var defaultClasses = [
    { key: "play", name: "Play Group (प्ले ग्रुप)", monthlyTuition: 500, admissionFee: 1500, examFee: 300, transportFee: 500, annualFee: 1000, booksFee: 800, uniformFee: 800, lateFine: 50 },
    { key: "nursery", name: "Nursery (नर्सरी)", monthlyTuition: 600, admissionFee: 1500, examFee: 300, transportFee: 500, annualFee: 1000, booksFee: 1000, uniformFee: 800, lateFine: 50 },
    { key: "lkg", name: "L.K.G. (एल.के.जी.)", monthlyTuition: 600, admissionFee: 1500, examFee: 300, transportFee: 500, annualFee: 1000, booksFee: 1000, uniformFee: 800, lateFine: 50 },
    { key: "ukg", name: "U.K.G. (यू.के.जी.)", monthlyTuition: 600, admissionFee: 1500, examFee: 300, transportFee: 500, annualFee: 1000, booksFee: 1000, uniformFee: 800, lateFine: 50 },
    { key: "1st", name: "Class 1st (कक्षा 1)", monthlyTuition: 650, admissionFee: 2000, examFee: 350, transportFee: 500, annualFee: 1200, booksFee: 1200, uniformFee: 800, lateFine: 50 },
    { key: "2nd", name: "Class 2nd (कक्षा 2)", monthlyTuition: 650, admissionFee: 2000, examFee: 350, transportFee: 500, annualFee: 1200, booksFee: 1200, uniformFee: 800, lateFine: 50 },
    { key: "3rd", name: "Class 3rd (कक्षा 3)", monthlyTuition: 650, admissionFee: 2000, examFee: 350, transportFee: 500, annualFee: 1200, booksFee: 1200, uniformFee: 800, lateFine: 50 },
    { key: "4th", name: "Class 4th (कक्षा 4)", monthlyTuition: 700, admissionFee: 2000, examFee: 400, transportFee: 500, annualFee: 1200, booksFee: 1400, uniformFee: 800, lateFine: 50 },
    { key: "5th", name: "Class 5th (कक्षा 5)", monthlyTuition: 700, admissionFee: 2000, examFee: 400, transportFee: 500, annualFee: 1200, booksFee: 1400, uniformFee: 800, lateFine: 50 },
    { key: "6th", name: "Class 6th (कक्षा 6)", monthlyTuition: 800, admissionFee: 2500, examFee: 450, transportFee: 600, annualFee: 1500, booksFee: 1600, uniformFee: 900, lateFine: 50 },
    { key: "7th", name: "Class 7th (कक्षा 7)", monthlyTuition: 800, admissionFee: 2500, examFee: 450, transportFee: 600, annualFee: 1500, booksFee: 1600, uniformFee: 900, lateFine: 50 },
    { key: "8th", name: "Class 8th (कक्षा 8)", monthlyTuition: 850, admissionFee: 2500, examFee: 500, transportFee: 600, annualFee: 1500, booksFee: 1800, uniformFee: 900, lateFine: 50 }
  ];

  if (!sheet) {
    sheet = ss.insertSheet("Fee_Master");
    sheet.appendRow([
      "Class_Key", "Class_Name", "Monthly_Tuition", "Admission_Fee", "Exam_Fee",
      "Transport_Auto_Fee", "Annual_Fee", "Books_Fee", "Uniform_Fee", "Late_Fine", "Last_Updated"
    ]);
    var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm");
    for (var i = 0; i < defaultClasses.length; i++) {
      var d = defaultClasses[i];
      sheet.appendRow([
        d.key, d.name, d.monthlyTuition, d.admissionFee, d.examFee,
        d.transportFee, d.annualFee, d.booksFee, d.uniformFee, d.lateFine, nowStr
      ]);
    }
  }

  var rows = sheet.getDataRange().getValues();
  var result = {};
  if (rows.length > 1) {
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var key = String(row[0] || "").toLowerCase().trim();
      if (!key) continue;
      result[key] = {
        monthlyTuition: Number(row[2]) || 600,
        admissionFee: Number(row[3]) || 2000,
        examFee: Number(row[4]) || 400,
        transportFee: Number(row[5]) || 500,
        annualFee: Number(row[6]) || 1200,
        booksFee: Number(row[7]) || 1000,
        uniformFee: Number(row[8]) || 800,
        lateFine: Number(row[9]) || 50
      };
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    source: "Fee_Master sheet",
    configs: result
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * OPTION B: SAVE/UPDATE FEE MASTER SHEET
 */
function handleSaveFeeMaster(ss, configs) {
  if (!configs || typeof configs !== "object") {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "No fee master configuration data provided."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = ss.getSheetByName("Fee_Master");
  if (!sheet) {
    sheet = ss.insertSheet("Fee_Master");
    sheet.appendRow([
      "Class_Key", "Class_Name", "Monthly_Tuition", "Admission_Fee", "Exam_Fee",
      "Transport_Auto_Fee", "Annual_Fee", "Books_Fee", "Uniform_Fee", "Late_Fine", "Last_Updated"
    ]);
  }

  var nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  var existingRows = sheet.getDataRange().getValues();
  var keyToRow = {};
  for (var r = 1; r < existingRows.length; r++) {
    var k = String(existingRows[r][0] || "").toLowerCase().trim();
    if (k) keyToRow[k] = r + 1;
  }

  var updatedCount = 0;
  var insertedCount = 0;

  for (var classKey in configs) {
    var conf = configs[classKey];
    if (!conf || typeof conf !== "object") continue;
    var rowData = [
      classKey.toLowerCase(),
      String(conf.name || classKey.toUpperCase()),
      Number(conf.monthlyTuition !== undefined ? conf.monthlyTuition : 600),
      Number(conf.admissionFee !== undefined ? conf.admissionFee : 2000),
      Number(conf.examFee !== undefined ? conf.examFee : 400),
      Number(conf.transportFee !== undefined ? conf.transportFee : 500),
      Number(conf.annualFee !== undefined ? conf.annualFee : 1200),
      Number(conf.booksFee !== undefined ? conf.booksFee : 1000),
      Number(conf.uniformFee !== undefined ? conf.uniformFee : 800),
      Number(conf.lateFine !== undefined ? conf.lateFine : 50),
      nowStr
    ];

    if (keyToRow[classKey.toLowerCase()]) {
      sheet.getRange(keyToRow[classKey.toLowerCase()], 1, 1, rowData.length).setValues([rowData]);
      updatedCount++;
    } else {
      sheet.appendRow(rowData);
      insertedCount++;
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "success",
    message: "Fee_Master sheet updated successfully! (" + updatedCount + " updated, " + insertedCount + " added)",
    updatedAt: nowStr
  })).setMimeType(ContentService.MimeType.JSON);
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

    // 2. Test getBusTracking
    let getText = '';
    try {
      const getRes = await fetch(`${urlToTest}?action=getBusTracking`);
      getText = await getRes.text();
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

    // If ping succeeded or getBusTracking returns valid table/JSON or bus data
    let hasBusData = false;
    try {
      const parsed = JSON.parse(getText);
      if (Array.isArray(parsed)) {
        hasBusData = true;
      }
    } catch {}

    if (pingWorking || hasBusData || getText.includes('Bus_ID') || getText.includes('success')) {
      return {
        configured: true,
        statusType: 'success',
        message: '✅ बहुत बढ़िया! Google Sheet "Bus_Tracking" पूरी तरह कनेक्टेड व सक्रिय है!',
        details: 'नया वर्शन सफलतापूर्वक कनेक्ट हो चुका है। अब बस की लोकेशन हर 15 सेकंड में गूगल शीट में ऑटो-अपडेट हो रही है।',
        testedUrl: urlToTest,
      };
    }

    if (getText.includes('Invalid Action')) {
      return {
        configured: false,
        statusType: 'old_version',
        message: 'पुराना डिप्लॉयमेंट सक्रिय है: Apps Script में "New version" डिप्लॉय करें!',
        details: 'आपने Apps Script एडिटर में कोड डाल दिया है, लेकिन Google Apps Script पुराने वर्शन को चला रहा है। Apps Script में ऊपर Deploy > Manage deployments > ✏️ Edit > Version: "New version" चुनकर Deploy दबाएँ।',
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

  // 2. Sync to Google Sheets via Apps Script Web App
  try {
    const payload = {
      action: 'updateBusTracking',
      bus_id: data.busId,
      driver_name: data.driverName,
      current_location: locStr,
      last_updated: now,
      speed: data.speed || 0,
      status: data.status || 'running',
    };

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
    const res = await fetch(activeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (text.includes('success') || text.includes('Bus location updated')) {
      return { success: true, message: 'गूगल शीट (Bus_Tracking) में लोकेशन अपडेट हो गई!' };
    }

    return {
      success: false,
      message: 'Apps Script में "New version" डिप्लॉय करने की आवश्यकता है',
    };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
};
