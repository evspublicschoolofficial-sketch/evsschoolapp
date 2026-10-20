import { SchoolUser, StaffAttendanceRecord } from '../types';

export interface SchoolShiftSettings {
  schoolOpeningTime: string; // e.g. "08:30 AM"
  schoolClosingTime: string; // e.g. "02:00 PM"
  graceMinutes: number; // e.g. 10 minutes allowed after opening time before marking Late
  overtimeThresholdMinutes: number; // e.g. 15 minutes after closing time to count as overtime
  fullDayMinHours: number; // e.g. 5.5 hours for full day
  halfDayMinHours: number; // e.g. 3.0 hours for half day
}

export const DEFAULT_SHIFT_SETTINGS: SchoolShiftSettings = {
  schoolOpeningTime: '08:00 AM',
  schoolClosingTime: '02:00 PM',
  graceMinutes: 15,
  overtimeThresholdMinutes: 15,
  fullDayMinHours: 5.5,
  halfDayMinHours: 3.0,
};

export const STORAGE_KEY_SHIFT_SETTINGS = 'evs_school_shift_settings';

export function getSchoolShiftSettings(): SchoolShiftSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SHIFT_SETTINGS);
    if (saved) {
      return { ...DEFAULT_SHIFT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {}
  return DEFAULT_SHIFT_SETTINGS;
}

export function saveSchoolShiftSettings(settings: SchoolShiftSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SHIFT_SETTINGS, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent('evs_shift_settings_updated', { detail: settings }));
  } catch {}
}

export async function syncShiftSettingsFromServer(): Promise<SchoolShiftSettings> {
  try {
    const res = await fetch(`/api/school-shift-settings?_t=${Date.now()}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.schoolOpeningTime) {
        const merged: SchoolShiftSettings = {
          ...DEFAULT_SHIFT_SETTINGS,
          ...data,
        };
        saveSchoolShiftSettings(merged);
        return merged;
      }
    }
  } catch (e) {
    console.warn('Could not sync shift settings from server:', e);
  }
  return getSchoolShiftSettings();
}

export async function saveShiftSettingsToServer(settings: SchoolShiftSettings): Promise<SchoolShiftSettings> {
  saveSchoolShiftSettings(settings);
  try {
    const res = await fetch('/api/school-shift-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.settings) {
        saveSchoolShiftSettings(data.settings);
        return data.settings;
      }
    }
  } catch (e) {
    console.warn('Could not save shift settings to server:', e);
  }
  return settings;
}

/**
 * Parses time strings such as "08:30 AM", "8:15 am", "14:45", "02:15 PM" to minutes from midnight (0-1439).
 */
export function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr) return null;
  const clean = timeStr.trim().toUpperCase();
  
  // Match 12-hour format: "08:30 AM" or "8:30AM" or "8:30"
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const meridiem = ampmMatch[3];

    if (meridiem === 'PM' && hours < 12) {
      hours += 12;
    } else if (meridiem === 'AM' && hours === 12) {
      hours = 0;
    }
    return hours * 60 + minutes;
  }

  // Fallback ISO date string like "2026-10-15T08:30:00"
  if (clean.includes('T')) {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  return null;
}

/**
 * Formats minutes into human-readable Hindi/English strings: e.g. "1 घंटा 15 मिनट" or "45 मिनट"
 */
export function formatMinutesToHuman(minutes: number): string {
  if (!minutes || minutes <= 0) return '0 मिनट';
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (hrs > 0 && mins > 0) {
    return `${hrs} घंटा ${mins} मिनट`;
  }
  if (hrs > 0) {
    return `${hrs} घंटा`;
  }
  return `${mins} मिनट`;
}

/**
 * Formats hours into decimals: e.g. 1.5 घंटे
 */
export function formatHoursDec(hours: number): string {
  if (!hours || hours <= 0) return '0 घंटे';
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded} घंटे`;
}

export interface StaffTimeEvaluation {
  isLate: boolean;
  lateMinutes: number;
  isEarlyArrival: boolean;
  earlyArrivalMinutes: number;
  isOnTime: boolean;
  isEarlyDeparture: boolean;
  earlyDepartureMinutes: number;
  isOvertime: boolean;
  overtimeMinutes: number;
  totalDurationMinutes: number;
  formattedDuration: string;
  arrivalBadge: { text: string; bgClass: string; textClass: string; icon: string };
  departureBadge: { text: string; bgClass: string; textClass: string; icon: string } | null;
}

/**
 * Evaluates whether a staff member arrived on time, early, or late,
 * whether they departed early or did overtime, and total working duration.
 */
export function evaluateStaffTimeStatus(
  checkInTimeStr?: string | null,
  checkOutTimeStr?: string | null,
  settings: SchoolShiftSettings = getSchoolShiftSettings()
): StaffTimeEvaluation {
  const inMin = parseTimeToMinutes(checkInTimeStr);
  const outMin = parseTimeToMinutes(checkOutTimeStr);

  const openMin = parseTimeToMinutes(settings.schoolOpeningTime) ?? (8 * 60 + 30);
  const closeMin = parseTimeToMinutes(settings.schoolClosingTime) ?? (14 * 60);
  const graceCutoff = openMin + (settings.graceMinutes || 0);

  let isLate = false;
  let lateMinutes = 0;
  let isEarlyArrival = false;
  let earlyArrivalMinutes = 0;
  let isOnTime = false;

  let isEarlyDeparture = false;
  let earlyDepartureMinutes = 0;
  let isOvertime = false;
  let overtimeMinutes = 0;
  let totalDurationMinutes = 0;

  if (inMin !== null) {
    if (inMin > graceCutoff) {
      isLate = true;
      lateMinutes = inMin - openMin;
    } else if (inMin < openMin) {
      isEarlyArrival = true;
      earlyArrivalMinutes = openMin - inMin;
      isOnTime = true;
    } else {
      isOnTime = true;
    }
  }

  if (outMin !== null) {
    if (outMin < closeMin) {
      isEarlyDeparture = true;
      earlyDepartureMinutes = closeMin - outMin;
    } else if (outMin > closeMin + (settings.overtimeThresholdMinutes || 0)) {
      isOvertime = true;
      overtimeMinutes = outMin - closeMin;
    }
  }

  if (inMin !== null && outMin !== null && outMin >= inMin) {
    totalDurationMinutes = outMin - inMin;
  }

  let arrivalBadge = {
    text: 'उपस्थिति दर्ज',
    bgClass: 'bg-emerald-100',
    textClass: 'text-emerald-800',
    icon: 'fa-check',
  };

  if (isLate) {
    arrivalBadge = {
      text: `${lateMinutes} मिनट लेट`,
      bgClass: 'bg-amber-100',
      textClass: 'text-amber-900',
      icon: 'fa-triangle-exclamation',
    };
  } else if (isEarlyArrival && earlyArrivalMinutes >= 5) {
    arrivalBadge = {
      text: `${earlyArrivalMinutes} मिनट पहले आए`,
      bgClass: 'bg-emerald-100',
      textClass: 'text-emerald-800',
      icon: 'fa-circle-check',
    };
  } else if (isOnTime) {
    arrivalBadge = {
      text: 'समय पर उपस्थित',
      bgClass: 'bg-emerald-100',
      textClass: 'text-emerald-800',
      icon: 'fa-circle-check',
    };
  }

  let departureBadge: StaffTimeEvaluation['departureBadge'] = null;
  if (outMin !== null) {
    if (isOvertime) {
      departureBadge = {
        text: `+${formatMinutesToHuman(overtimeMinutes)} ओवर-टाइम`,
        bgClass: 'bg-indigo-100',
        textClass: 'text-indigo-900',
        icon: 'fa-business-time',
      };
    } else if (isEarlyDeparture && earlyDepartureMinutes >= 5) {
      departureBadge = {
        text: `${earlyDepartureMinutes} मिनट पहले निकले`,
        bgClass: 'bg-rose-100',
        textClass: 'text-rose-900',
        icon: 'fa-person-walking-dashed-line-arrow-right',
      };
    } else {
      departureBadge = {
        text: 'समय पर प्रस्थान',
        bgClass: 'bg-slate-100',
        textClass: 'text-slate-800',
        icon: 'fa-check',
      };
    }
  }

  return {
    isLate,
    lateMinutes,
    isEarlyArrival,
    earlyArrivalMinutes,
    isOnTime,
    isEarlyDeparture,
    earlyDepartureMinutes,
    isOvertime,
    overtimeMinutes,
    totalDurationMinutes,
    formattedDuration: formatMinutesToHuman(totalDurationMinutes),
    arrivalBadge,
    departureBadge,
  };
}

export interface DayAttendanceDetail {
  date: string; // YYYY-MM-DD
  dayNumber: number;
  dayName: string; // 'सोमवार', 'मंगलवार', etc.
  isSunday: boolean;
  isToday: boolean;
  isFuture: boolean;
  record?: StaffAttendanceRecord;
  status: 'Present' | 'Late' | 'Half-Day' | 'Absent' | 'Leave' | 'On-Duty' | 'Sunday' | 'Upcoming';
  checkIn?: string;
  checkOut?: string;
  totalDurationMinutes: number;
  totalDurationHours: number;
  isLate: boolean;
  lateMinutes: number;
  extraMinutes: number; // overtime past departure cutoff
  extraHours: number;
  method?: string;
  remark?: string;
}

export interface StaffMonthlyReport {
  user: SchoolUser;
  userId: string;
  name: string;
  designation: string;
  mobile: string;
  month: string; // "YYYY-MM"
  monthName: string; // "अक्टूबर 2026"
  totalCalendarDays: number;
  totalSundays: number;
  workingDays: number; // कितने दिन स्कूल खुला
  workingDaysElapsed: number; // महीने में आज तक कार्य दिवस
  presentDays: number; // कितने दिन आया
  absentDays: number; // कितनी एब्सेंट है
  lateDays: number; // कितने दिन लेट है
  totalLateMinutes: number; // कुल कितना लेट समय
  formattedLateTime: string; // "45 मिनट" / "1 घंटा 10 मिनट"
  onTimeDays: number; // समय पर उपस्थिति
  halfDays: number;
  leaveDays: number;
  onDutyDays: number;
  extraOvertimeHours: number; // कितना ऐड एक्स्ट्रा घंटे है
  extraDutyDays: number; // अतिरिक्त रविवार/अवकाश कार्य
  totalWorkingHours: number; // कुल कार्य घंटे
  attendancePercentage: number; // % हाजिरी
  lateDetails: Array<{ date: string; checkIn: string; lateMinutes: number }>;
  extraDetails: Array<{ date: string; checkOut: string; extraMinutes: number }>;
  dailyBreakdown: DayAttendanceDetail[];
}

const HINDI_DAYS = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const HINDI_MONTHS = [
  'जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून',
  'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'
];

/**
 * Returns list of all dates in a month YYYY-MM
 */
export function getMonthDates(year: number, monthZeroBased: number): {
  totalDays: number;
  sundaysCount: number;
  dates: Array<{ dateStr: string; dayNumber: number; isSunday: boolean; dayName: string }>;
} {
  const totalDays = new Date(year, monthZeroBased + 1, 0).getDate();
  const dates = [];
  let sundaysCount = 0;

  for (let d = 1; d <= totalDays; d++) {
    const dt = new Date(year, monthZeroBased, d);
    const dayOfWeek = dt.getDay();
    const isSunday = dayOfWeek === 0;
    if (isSunday) sundaysCount++;

    const mm = String(monthZeroBased + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    dates.push({
      dateStr: `${year}-${mm}-${dd}`,
      dayNumber: d,
      isSunday,
      dayName: HINDI_DAYS[dayOfWeek],
    });
  }

  return { totalDays, sundaysCount, dates };
}

/**
 * Computes complete monthly staff attendance report for an individual staff member
 */
export function calculateStaffMonthlyStats(
  user: SchoolUser,
  monthStr: string, // "YYYY-MM"
  records: StaffAttendanceRecord[],
  customWorkingDays?: number,
  standardStartTimeStr: string = '08:30 AM', // Arrival cutoff for lateness
  standardEndTimeStr: string = '02:00 PM'    // Departure cutoff for overtime/extra
): StaffMonthlyReport {
  const [yStr, mStr] = monthStr.split('-');
  const year = parseInt(yStr, 10);
  const monthZero = parseInt(mStr, 10) - 1;

  const monthName = `${HINDI_MONTHS[monthZero]} ${year}`;
  const { totalDays, sundaysCount, dates } = getMonthDates(year, monthZero);

  // Default school open days: Calendar days minus Sundays
  const defaultWorkingDays = totalDays - sundaysCount;
  const workingDays = typeof customWorkingDays === 'number' && customWorkingDays > 0
    ? customWorkingDays
    : defaultWorkingDays;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const standardStartMin = parseTimeToMinutes(standardStartTimeStr) ?? (8 * 60 + 30); // 8:30 AM
  const standardEndMin = parseTimeToMinutes(standardEndTimeStr) ?? (14 * 60); // 2:00 PM

  // Match records for this user in this month
  const userId = String(user.User_ID || user.Mobile_number || '').trim().toLowerCase();
  const userName = (user.Name || '').trim().toLowerCase();

  const userRecords = records.filter((r) => {
    if (!r.date || !r.date.startsWith(monthStr)) return false;
    const rUserId = String(r.user_id || '').trim().toLowerCase();
    const rName = (r.name || '').trim().toLowerCase();
    return rUserId === userId || (userName && rName === userName);
  });

  const recordMap = new Map<string, StaffAttendanceRecord>();
  userRecords.forEach((r) => {
    recordMap.set(r.date, r);
  });

  let presentDays = 0;
  let lateDays = 0;
  let totalLateMinutes = 0;
  let onTimeDays = 0;
  let halfDays = 0;
  let leaveDays = 0;
  let onDutyDays = 0;
  let extraDutyDays = 0;
  let totalExtraMinutes = 0;
  let totalWorkingMinutes = 0;
  let workingDaysElapsed = 0;

  const lateDetails: Array<{ date: string; checkIn: string; lateMinutes: number }> = [];
  const extraDetails: Array<{ date: string; checkOut: string; extraMinutes: number }> = [];
  const dailyBreakdown: DayAttendanceDetail[] = [];

  dates.forEach((d) => {
    const isToday = d.dateStr === todayStr;
    const isFuture = d.dateStr > todayStr;
    const rec = recordMap.get(d.dateStr);

    if (!d.isSunday && !isFuture) {
      workingDaysElapsed++;
    }

    let status: DayAttendanceDetail['status'] = 'Absent';
    let isLate = false;
    let lateMins = 0;
    let extraMins = 0;
    let durMins = 0;

    if (rec) {
      const inMin = parseTimeToMinutes(rec.check_in_time);
      const outMin = parseTimeToMinutes(rec.check_out_time);

      if (inMin !== null && outMin !== null && outMin >= inMin) {
        durMins = outMin - inMin;
      } else if (inMin !== null) {
        // default 6 hours shift if not checked out yet
        durMins = 330; // 5.5 hours approx
      }
      totalWorkingMinutes += durMins;

      // Late calculation
      if (inMin !== null && inMin > standardStartMin) {
        isLate = true;
        lateMins = inMin - standardStartMin;
        totalLateMinutes += lateMins;
        lateDetails.push({
          date: d.dateStr,
          checkIn: rec.check_in_time,
          lateMinutes: lateMins,
        });
      }

      // Overtime / Add Extra calculation
      if (outMin !== null && outMin > standardEndMin) {
        extraMins = outMin - standardEndMin;
        totalExtraMinutes += extraMins;
        extraDetails.push({
          date: d.dateStr,
          checkOut: rec.check_out_time || '',
          extraMinutes: extraMins,
        });
      }

      // If came on Sunday / non-working day
      if (d.isSunday) {
        extraDutyDays++;
      }

      // Status aggregation
      if (rec.status === 'Late' || isLate) {
        status = 'Late';
        lateDays++;
        presentDays += 1;
      } else if (rec.status === 'Half-Day') {
        status = 'Half-Day';
        halfDays++;
        presentDays += 0.5;
      } else if (rec.status === 'Leave') {
        status = 'Leave';
        leaveDays++;
      } else if (rec.status === 'On-Duty') {
        status = 'On-Duty';
        onDutyDays++;
        presentDays += 1;
      } else {
        status = 'Present';
        onTimeDays++;
        presentDays += 1;
      }
    } else {
      if (d.isSunday) {
        status = 'Sunday';
      } else if (isFuture) {
        status = 'Upcoming';
      } else {
        status = 'Absent';
      }
    }

    dailyBreakdown.push({
      date: d.dateStr,
      dayNumber: d.dayNumber,
      dayName: d.dayName,
      isSunday: d.isSunday,
      isToday,
      isFuture,
      record: rec,
      status,
      checkIn: rec?.check_in_time,
      checkOut: rec?.check_out_time,
      totalDurationMinutes: durMins,
      totalDurationHours: Math.round((durMins / 60) * 10) / 10,
      isLate,
      lateMinutes: lateMins,
      extraMinutes: extraMins,
      extraHours: Math.round((extraMins / 60) * 10) / 10,
      method: rec?.method,
      remark: rec?.remark,
    });
  });

  // Calculate Absent Days:
  // If viewing past/completed month: absent = workingDays - presentDays
  // If current month: can show absent relative to working days elapsed so far, or total working days
  const absentDays = Math.max(0, Math.round((workingDays - presentDays - leaveDays) * 10) / 10);
  const attendancePercentage = workingDays > 0
    ? Math.min(100, Math.round((presentDays / workingDays) * 100))
    : 0;

  const extraOvertimeHours = Math.round((totalExtraMinutes / 60) * 10) / 10;
  const totalWorkingHours = Math.round((totalWorkingMinutes / 60) * 10) / 10;

  return {
    user,
    userId: user.User_ID || user.Username || String(user.Mobile_number || ''),
    name: user.Name,
    designation: user.Designation || 'Teacher',
    mobile: String(user.Mobile_number || ''),
    month: monthStr,
    monthName,
    totalCalendarDays: totalDays,
    totalSundays: sundaysCount,
    workingDays,
    workingDaysElapsed,
    presentDays,
    absentDays,
    lateDays,
    totalLateMinutes,
    formattedLateTime: formatMinutesToHuman(totalLateMinutes),
    onTimeDays,
    halfDays,
    leaveDays,
    onDutyDays,
    extraOvertimeHours,
    extraDutyDays,
    totalWorkingHours,
    attendancePercentage,
    lateDetails,
    extraDetails,
    dailyBreakdown,
  };
}
