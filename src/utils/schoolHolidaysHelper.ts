import { SchoolHolidayRecord } from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { directGetFromSheet } from './sheetDirectSync';

export const HOLIDAY_STORAGE_KEY = 'evs_school_holidays_v1';
export const HOLIDAYS_UPDATED_EVENT = 'evs-holidays-updated';

export function normalizeHolidayYmd(dateInput: any): string {
  if (!dateInput) return '';
  const trimmed = String(dateInput).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  const slashParts = trimmed.split(/[-/.]/);
  if (slashParts.length === 3) {
    if (slashParts[0].length === 4) {
      return `${slashParts[0]}-${slashParts[1].padStart(2, '0')}-${slashParts[2].padStart(2, '0')}`;
    }
    const d = slashParts[0].padStart(2, '0');
    const m = slashParts[1].padStart(2, '0');
    let y = slashParts[2];
    if (y.length === 2) y = `20${y}`;
    if (/^\d{4}$/.test(y) && /^\d{2}$/.test(m) && /^\d{2}$/.test(d)) {
      return `${y}-${m}-${d}`;
    }
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return trimmed.slice(0, 10);
}

export function loadLocalSchoolHolidays(): SchoolHolidayRecord[] {
  try {
    const raw = localStorage.getItem(HOLIDAY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveLocalSchoolHolidays(list: SchoolHolidayRecord[], notifySameTab = true): void {
  try {
    localStorage.setItem(HOLIDAY_STORAGE_KEY, JSON.stringify(list));
    if (notifySameTab && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(HOLIDAYS_UPDATED_EVENT, { detail: list }));
    }
  } catch {}
}

export function findHolidayForDate(
  dateYmd: string,
  holidays: SchoolHolidayRecord[]
): SchoolHolidayRecord | null {
  const ymd = normalizeHolidayYmd(dateYmd);
  if (!ymd || !Array.isArray(holidays) || holidays.length === 0) return null;
  for (const h of holidays) {
    if (!h || !h.date) continue;
    const start = normalizeHolidayYmd(h.date);
    if (!start) continue;
    if (start === ymd) return h;
    if (h.end_date) {
      const end = normalizeHolidayYmd(h.end_date);
      if (end && ymd >= start && ymd <= end) {
        return h;
      }
    }
  }
  return null;
}

export function countWorkingDaysInMonth(
  year: number,
  monthZeroBased: number,
  holidays: SchoolHolidayRecord[]
): { totalDays: number; sundaysCount: number; holidaysCount: number; workingDays: number } {
  const totalDays = new Date(year, monthZeroBased + 1, 0).getDate();
  let sundaysCount = 0;
  let holidaysCount = 0;

  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, monthZeroBased, d);
    const isSunday = dt.getDay() === 0;
    const mm = String(monthZeroBased + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const ymd = `${year}-${mm}-${dd}`;
    const hol = findHolidayForDate(ymd, holidays);
    if (isSunday) {
      sundaysCount++;
    } else if (hol) {
      holidaysCount++;
    }
  }

  return {
    totalDays,
    sundaysCount,
    holidaysCount,
    workingDays: Math.max(0, totalDays - sundaysCount - holidaysCount),
  };
}

function normalizeHolidayList(rawList: any[]): SchoolHolidayRecord[] {
  const result: SchoolHolidayRecord[] = [];
  for (const item of rawList) {
    if (!item || Array.isArray(item)) continue;
    const dateYmd = normalizeHolidayYmd(item.date ?? item.Date);
    const title = String(item.title ?? item.Title ?? '').trim();
    if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd) || !title) continue;
    const endYmd = normalizeHolidayYmd(item.end_date ?? item.End_Date);
    result.push({
      id: String(item.id ?? item.Holiday_ID ?? `hol_${dateYmd.replace(/-/g, '_')}`).trim(),
      title,
      date: dateYmd,
      end_date: endYmd && /^\d{4}-\d{2}-\d{2}$/.test(endYmd) && endYmd !== dateYmd ? endYmd : undefined,
      category: (String(item.category ?? item.Category ?? 'festival').trim() || 'festival') as SchoolHolidayRecord['category'],
      description: String(item.description ?? item.Description ?? '').trim() || undefined,
      created_at: item.created_at ?? item.timestamp,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchSchoolHolidaysFromApiOrSheet(forceRefresh = true): Promise<SchoolHolidayRecord[]> {
  const activeUrl = getAppsScriptUrl();
  try {
    const r = await fetch(`/api/school-holidays${forceRefresh ? '?refresh=1' : ''}`, {
      headers: { 'x-apps-script-url': activeUrl },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
      const data = await r.json();
      if (Array.isArray(data)) {
        const normalized = normalizeHolidayList(data);
        saveLocalSchoolHolidays(normalized, true);
        return normalized;
      }
    }
  } catch {}

  try {
    const direct = await directGetFromSheet('getSchoolHolidays', activeUrl);
    if (direct.ok) {
      const rows = Array.isArray(direct.json)
        ? direct.json
        : Array.isArray(direct.json?.holidays)
        ? direct.json.holidays
        : [];
      const normalized = normalizeHolidayList(rows);
      saveLocalSchoolHolidays(normalized, true);
      return normalized;
    }
  } catch {}

  return loadLocalSchoolHolidays();
}

export function subscribeSchoolHolidaysUpdates(
  onUpdate: (holidays: SchoolHolidayRecord[]) => void
): () => void {
  const handleCustom = (ev: Event) => {
    const detail = (ev as CustomEvent)?.detail;
    if (Array.isArray(detail)) {
      onUpdate(detail);
    } else {
      onUpdate(loadLocalSchoolHolidays());
    }
  };

  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === HOLIDAY_STORAGE_KEY && ev.newValue) {
      try {
        const parsed = JSON.parse(ev.newValue);
        if (Array.isArray(parsed)) onUpdate(parsed);
      } catch {}
    }
  };

  window.addEventListener(HOLIDAYS_UPDATED_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  let ws: WebSocket | null = null;
  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === 'APP_DATA_UPDATED' && msg.entity === 'school_holidays') {
          fetchSchoolHolidaysFromApiOrSheet(true).then(onUpdate).catch(() => {});
        }
      } catch {}
    };
  } catch {}

  return () => {
    window.removeEventListener(HOLIDAYS_UPDATED_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
    if (ws) {
      try { ws.close(); } catch {}
    }
  };
}
