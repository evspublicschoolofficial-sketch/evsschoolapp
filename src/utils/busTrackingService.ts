// Bus Tracking Service & Google Sheet Synchronizer
// Synchronizes with Google Sheets:
// 1. "Bus_Tracking" (Bus_ID, Driver_Name, Current_Location, Last_Updated)
// 2. "Users" (User_ID, Mobile_number, Username, Password, Name, Designation)

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
  tripType: 'morning_pickup' | 'afternoon_drop' | 'special_trip';
  status: 'running' | 'boarding' | 'traffic' | 'reached_school' | 'stopped';
  currentStop: string;
  nextStop: string;
  studentsOnBoard: number;
  sosAlert?: boolean;
  sosMessage?: string;
  isLiveFromSheet?: boolean;
}

// Fallback school coordinates in case not determined
export const DEFAULT_SCHOOL_COORDS = {
  lat: 29.0558,
  lng: 78.6302,
  name: 'E.V.S. Public School Campus',
};

// Parse coordinates string like "30.056038, 77.419096"
export const parseCoordinates = (locStr: string | null | undefined): { lat: number; lng: number } => {
  if (!locStr) {
    return { lat: 30.056038, lng: 77.419096 };
  }
  const parts = String(locStr).split(',').map((p) => parseFloat(p.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return { lat: parts[0], lng: parts[1] };
  }
  return { lat: 30.056038, lng: 77.419096 };
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

// Send live location update to Apps Script backend
export const syncLocationToSheetBackend = async (data: {
  busId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  speed?: number | null;
  status?: string;
  currentStop?: string;
  nextStop?: string;
}) => {
  const locStr = `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`;
  const now = new Date().toISOString();

  try {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateBusTracking',
        bus_id: data.busId,
        driver_name: data.driverName,
        current_location: locStr,
        last_updated: now,
        speed: data.speed || 0,
        status: data.status || 'running',
        current_stop: data.currentStop || '',
        next_stop: data.nextStop || '',
      }),
    }).catch((e) => console.warn('Background Bus_Tracking sync error:', e));
  } catch {}
};
