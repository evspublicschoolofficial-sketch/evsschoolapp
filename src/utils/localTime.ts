// Centralized Local Time (IST / Device Local Time) Utility
// Prevents UTC (.toISOString()) date/time drift across UI, localStorage, Server, and Google Sheets.

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Returns local calendar date in YYYY-MM-DD format (e.g. "2026-11-17").
 * Safe for <input type="date"> and date comparisons without UTC off-by-one shifts.
 */
export const getLocalDateYMD = (input: Date | number | string = new Date()): string => {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/**
 * Returns local Year-Month string in YYYY-MM format (e.g. "2026-11").
 */
export const getLocalMonthYM = (input: Date | number | string = new Date()): string => {
  const ymd = getLocalDateYMD(input);
  return ymd.slice(0, 7);
};

/**
 * Returns local date & 24h time in "YYYY-MM-DD HH:mm:ss" format (e.g. "2026-11-17 13:28:02").
 * Compatible with JS Date(), Excel, Google Sheets, and chronological string sorting.
 */
export const getLocalTimestamp = (input: Date | number | string = new Date()): string => {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/**
 * Formats any timestamp (including legacy UTC ISO strings like "2026-11-17T07:39:23.633Z")
 * into user-friendly local Date + 12h Time (e.g. "17/11/2026, 01:09 pm").
 */
export const formatLocalDateTime = (
  val: string | number | Date | null | undefined,
  fallback = ''
): string => {
  if (val === null || val === undefined || val === '') return fallback;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return fallback;
    return val.toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  const s = String(val).trim();
  if (!s) return fallback;
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }
  return s;
};

/**
 * Formats any timestamp/date into user-friendly local Time (e.g. "01:09 pm").
 */
export const formatLocalTime = (
  val: string | number | Date | null | undefined = new Date(),
  includeSeconds = false
): string => {
  const d = val instanceof Date ? val : val ? new Date(val) : new Date();
  if (isNaN(d.getTime())) return String(val || '');
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: true,
  });
};
