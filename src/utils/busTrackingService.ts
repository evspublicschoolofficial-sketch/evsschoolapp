// Bus Tracking Service & Telemetry Synchronizer
// Synchronizes with Google Sheets ("Bus_Tracking" & "Users") and real-time backend API

export const SPREADSHEET_ID = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU';
export const API_URL = 'https://script.google.com/macros/s/AKfycbzrASF0ip3AsJI-JwgPzXSgUcTphOp3GAMiPGH4sa3iN2pkqGvJaVEDq-uwkgX9xrUuCQ/exec';

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

// Fetch real rows from Google Sheets "Bus_Tracking"
export const fetchBusTrackingFromSheet = async (): Promise<BusTrackingRecord[]> => {
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

// Send live location update to cross-device shared server API
export const syncLocationToSharedApi = async (telemetry: VanTelemetry) => {
  try {
    const res = await fetch('/api/bus-tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telemetry),
    });
    return res.ok;
  } catch (e) {
    // Non-blocking in case server endpoint is unavailable
    return false;
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

// Ready-to-copy Google Apps Script Code for Google Sheets (Code.gs)
export const GOOGLE_APPS_SCRIPT_CODE = `// ============================================================
// E.V.S. PUBLIC SCHOOL - GOOGLE APPS SCRIPT (Code.gs)
// Handles: Students, Homework, Fees, Behavior, & Bus Tracking
// ============================================================

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === "getStudents") {
    var sheet = ss.getSheetByName("Students");
    var data = sheet ? sheet.getDataRange().getValues() : [];
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === "getHomework") {
    var sheet = ss.getSheetByName("Homework");
    var data = sheet ? sheet.getDataRange().getValues() : [];
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (action === "getBusTracking" || action === "getBus") {
    var sheet = ss.getSheetByName("Bus_Tracking");
    var data = sheet ? sheet.getDataRange().getValues() : [];
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Allow updating via GET as well (browser fallback)
  if (action === "updateBusTracking" || action === "updateLocation") {
    return handleUpdateBusTracking(ss, e.parameter);
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

    var action = data.action || "";
    var ss = SpreadsheetApp.getActiveSpreadsheet();

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

    // 3. ADD FEE RECORD
    if (action === "addFee") {
      var sheet = ss.getSheetByName("Fee_Collection");
      if (!sheet) sheet = ss.insertSheet("Fee_Collection");
      sheet.appendRow([
        data.receipt_no || "REC-" + Date.now(),
        data.student_id || "",
        data.date || new Date().toISOString().split("T")[0],
        data.fee_type || "Monthly",
        data.month || "",
        data.total_amount || 0,
        data.amount_paid || 0,
        data.balance_amount || 0,
        data.payment_mode || "Cash",
        data.received_by || "Manager"
      ]);
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Fee Record Saved Successfully!"
      })).setMimeType(ContentService.MimeType.JSON);
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
  var sheet = ss.getSheetByName("Bus_Tracking");
  if (!sheet) {
    sheet = ss.insertSheet("Bus_Tracking");
    sheet.appendRow(["Bus_ID", "Driver_Name", "Current_Location", "Last_Updated"]);
  }

  var busId = String(data.bus_id || data.busId || "ecad7ddc").trim();
  var driverName = String(data.driver_name || data.driverName || "Amjad").trim();
  var location = String(data.current_location || data.currentLocationStr || "").trim();
  
  // Current timestamp formatted in IST
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
}`;

// Test whether Google Apps Script currently has the updateBusTracking endpoint deployed
export const testGoogleSheetSync = async (): Promise<{ configured: boolean; message: string }> => {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateBusTracking',
        test_ping: true,
      }),
    });
    const text = await res.text();
    if (text.includes('success') || text.includes('Bus location updated')) {
      return { configured: true, message: 'गूगल शीट Apps Script सिंक सक्रिय और कनेक्टेड है!' };
    }
    return {
      configured: false,
      message: 'Apps Script में updateBusTracking कोड जोड़ना बाकी है।',
    };
  } catch (e: any) {
    return { configured: false, message: e.message || 'कनेक्शन त्रुटि' };
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

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    if (text.includes('success') || text.includes('Bus location updated')) {
      return { success: true, message: 'गूगल शीट (Bus_Tracking) में लोकेशन अपडेट हो गई!' };
    }

    // Try GET fallback if POST didn't return success
    try {
      const getUrl = `${API_URL}?action=updateBusTracking&bus_id=${encodeURIComponent(data.busId)}&driver_name=${encodeURIComponent(data.driverName)}&current_location=${encodeURIComponent(locStr)}`;
      const getRes = await fetch(getUrl);
      const getText = await getRes.text();
      if (getText.includes('success')) {
        return { success: true, message: 'गूगल शीट (Bus_Tracking) में लोकेशन अपडेट हो गई!' };
      }
    } catch {}

    return {
      success: false,
      message: 'Apps Script कोड अपडेट की आवश्यकता है',
    };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
};
