import {
  AcademicSession,
  AcademicSubject,
  AcademicsConfigSnapshot,
  ClassSectionConfig,
  PeriodSetConfig,
  PeriodSlot,
  PromotionLogEntry,
  SchoolUser,
  Student,
  StudentAcademicOverride,
  TeacherSubstitution,
  TimetableEntry,
  WeekdayKey,
} from '../types';
import { getLocalDateYMD, getLocalTimestamp } from './localTime';
import { saveToPhoneMemory } from './phoneMemoryCache';
import { realtimeSync } from './realtimeSync';
import { getAppsScriptUrl } from './busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';

export const ACADEMICS_CONFIG_STORAGE_KEY = 'evs_academics_config_v1';
export const ACADEMICS_UPDATED_EVENT = 'evs-academics-updated';

export const WEEKDAYS: WeekdayKey[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export const WEEKDAY_LABELS_HI: Record<WeekdayKey, string> = {
  Monday: 'सोमवार',
  Tuesday: 'मंगलवार',
  Wednesday: 'बुधवार',
  Thursday: 'गुरुवार',
  Friday: 'शुक्रवार',
  Saturday: 'शनिवार',
};

export const STANDARD_CLASS_ORDER: string[] = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'C11',
  'C12',
];

export const DEFAULT_ACADEMIC_SESSIONS: AcademicSession[] = [
  {
    id: '2025-26',
    name: 'Session 2025-26',
    startDate: '2025-04-01',
    endDate: '2026-03-31',
    isActive: false,
  },
  {
    id: '2026-27',
    name: 'Session 2026-27',
    startDate: '2026-04-01',
    endDate: '2027-03-31',
    isActive: true,
  },
];

export const DEFAULT_ACADEMIC_SUBJECTS: AcademicSubject[] = [
  { id: 'sub_hindi', name: 'Hindi', code: 'HIN', colorHex: '#e11d48' },
  { id: 'sub_english', name: 'English', code: 'ENG', colorHex: '#2563eb' },
  { id: 'sub_math', name: 'Mathematics', code: 'MATH', colorHex: '#7c3aed' },
  { id: 'sub_science', name: 'Science', code: 'SCI', colorHex: '#059669' },
  { id: 'sub_evs', name: 'EVS / Social Science', code: 'EVS', colorHex: '#0d9488' },
  { id: 'sub_urdu', name: 'Urdu / Arabic', code: 'URD', colorHex: '#b45309' },
  { id: 'sub_computer', name: 'Computer', code: 'CMP', colorHex: '#4f46e5' },
  { id: 'sub_gk', name: 'GK / Moral Education', code: 'GK', colorHex: '#d97706' },
  { id: 'sub_art', name: 'Drawing / Art', code: 'ART', isElective: true, colorHex: '#db2777' },
  { id: 'sub_sanskrit', name: 'Sanskrit', code: 'SAN', isElective: true, colorHex: '#ea580c' },
  { id: 'sub_pe', name: 'Games / PT', code: 'PT', isElective: true, colorHex: '#16a34a' },
];

export const DEFAULT_PERIOD_SLOTS: PeriodSlot[] = [
  { id: 'p1', periodNumber: 1, label: 'Period 1', startTime: '08:00', endTime: '08:40' },
  { id: 'p2', periodNumber: 2, label: 'Period 2', startTime: '08:40', endTime: '09:20' },
  { id: 'p3', periodNumber: 3, label: 'Period 3', startTime: '09:20', endTime: '10:00' },
  { id: 'p4', periodNumber: 4, label: 'Period 4', startTime: '10:00', endTime: '10:40' },
  { id: 'lunch', periodNumber: 0, label: 'Lunch Break', startTime: '10:40', endTime: '11:05', isBreak: true },
  { id: 'p5', periodNumber: 5, label: 'Period 5', startTime: '11:05', endTime: '11:45' },
  { id: 'p6', periodNumber: 6, label: 'Period 6', startTime: '11:45', endTime: '12:25' },
  { id: 'p7', periodNumber: 7, label: 'Period 7', startTime: '12:25', endTime: '13:05' },
  { id: 'p8', periodNumber: 8, label: 'Period 8', startTime: '13:05', endTime: '13:45' },
];

export const DEFAULT_PERIOD_SETS: PeriodSetConfig[] = [
  {
    id: 'pset_morning',
    name: 'Morning Regular Shift (08:00 AM – 01:45 PM)',
    assignedClassKeys: ['ALL'],
    slots: DEFAULT_PERIOD_SLOTS,
  },
  {
    id: 'pset_winter',
    name: 'Winter Shift (09:00 AM – 02:30 PM)',
    assignedClassKeys: [],
    slots: [
      { id: 'wp1', periodNumber: 1, label: 'Period 1', startTime: '09:00', endTime: '09:40' },
      { id: 'wp2', periodNumber: 2, label: 'Period 2', startTime: '09:40', endTime: '10:20' },
      { id: 'wp3', periodNumber: 3, label: 'Period 3', startTime: '10:20', endTime: '11:00' },
      { id: 'wp4', periodNumber: 4, label: 'Period 4', startTime: '11:00', endTime: '11:40' },
      { id: 'wlunch', periodNumber: 0, label: 'Lunch Break', startTime: '11:40', endTime: '12:05', isBreak: true },
      { id: 'wp5', periodNumber: 5, label: 'Period 5', startTime: '12:05', endTime: '12:45' },
      { id: 'wp6', periodNumber: 6, label: 'Period 6', startTime: '12:45', endTime: '13:25' },
      { id: 'wp7', periodNumber: 7, label: 'Period 7', startTime: '13:25', endTime: '14:00' },
      { id: 'wp8', periodNumber: 8, label: 'Period 8', startTime: '14:00', endTime: '14:30' },
    ],
  },
];

export const DEFAULT_CLASS_SECTIONS: ClassSectionConfig[] = STANDARD_CLASS_ORDER.map((classKey, idx) => ({
  id: `${classKey}::A`,
  classKey,
  sectionName: 'A',
  roomNumber: `Room ${idx + 1}`,
  classTeacherId: '',
  classTeacherName: '',
  subjectIds:
    idx <= 3
      ? ['sub_hindi', 'sub_english', 'sub_math', 'sub_gk', 'sub_art', 'sub_pe']
      : ['sub_hindi', 'sub_english', 'sub_math', 'sub_science', 'sub_evs', 'sub_computer', 'sub_gk'],
  subjectTeachers: {},
}));

export const DEFAULT_ACADEMICS_CONFIG: AcademicsConfigSnapshot = {
  sessions: DEFAULT_ACADEMIC_SESSIONS,
  activeSessionId: '2026-27',
  subjects: DEFAULT_ACADEMIC_SUBJECTS,
  sections: DEFAULT_CLASS_SECTIONS,
  periodSets: DEFAULT_PERIOD_SETS,
  timetable: [],
  substitutions: [],
  studentOverrides: {},
  promotionLogs: [],
};

let cachedAcademicsConfig: AcademicsConfigSnapshot | null = null;

export const normalizeAcademicsConfig = (raw: any): AcademicsConfigSnapshot => {
  const base = raw && typeof raw === 'object' ? raw : {};
  const sessions: AcademicSession[] =
    Array.isArray(base.sessions) && base.sessions.length > 0
      ? base.sessions
      : DEFAULT_ACADEMIC_SESSIONS;
  const activeSession =
    sessions.find((s) => s.id === base.activeSessionId) ||
    sessions.find((s) => s.isActive) ||
    sessions[0];

  return {
    sessions: sessions.map((s) => ({ ...s, isActive: s.id === activeSession.id })),
    activeSessionId: activeSession.id,
    subjects:
      Array.isArray(base.subjects) && base.subjects.length > 0
        ? base.subjects
        : DEFAULT_ACADEMIC_SUBJECTS,
    sections:
      Array.isArray(base.sections) && base.sections.length > 0
        ? base.sections
        : DEFAULT_CLASS_SECTIONS,
    periodSets:
      Array.isArray(base.periodSets) && base.periodSets.length > 0
        ? base.periodSets
        : DEFAULT_PERIOD_SETS,
    timetable: Array.isArray(base.timetable) ? base.timetable : [],
    substitutions: Array.isArray(base.substitutions) ? base.substitutions : [],
    studentOverrides:
      base.studentOverrides && typeof base.studentOverrides === 'object'
        ? base.studentOverrides
        : {},
    promotionLogs: Array.isArray(base.promotionLogs) ? base.promotionLogs : [],
    updatedAt: base.updatedAt ? String(base.updatedAt) : undefined,
    updatedBy: base.updatedBy ? String(base.updatedBy) : undefined,
  };
};

export const loadLocalAcademicsConfig = (): AcademicsConfigSnapshot => {
  if (cachedAcademicsConfig) return cachedAcademicsConfig;
  try {
    const raw = localStorage.getItem(ACADEMICS_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = normalizeAcademicsConfig(JSON.parse(raw));
      cachedAcademicsConfig = parsed;
      return parsed;
    }
  } catch {}
  return DEFAULT_ACADEMICS_CONFIG;
};

export const saveLocalAcademicsConfig = (cfg: AcademicsConfigSnapshot): AcademicsConfigSnapshot => {
  const normalized = normalizeAcademicsConfig(cfg);
  cachedAcademicsConfig = normalized;
  try {
    saveToPhoneMemory(ACADEMICS_CONFIG_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent(ACADEMICS_UPDATED_EVENT, { detail: normalized }));
  } catch {}
  return normalized;
};

export const invalidateAcademicsCache = () => {
  cachedAcademicsConfig = null;
};

export const fetchAcademicsConfigFromServer = async (
  forceRefresh = false
): Promise<AcademicsConfigSnapshot> => {
  const local = loadLocalAcademicsConfig();
  if (!forceRefresh && cachedAcademicsConfig) {
    return cachedAcademicsConfig;
  }
  const activeUrl = (getAppsScriptUrl() || '').trim();
  try {
    const res = await fetch(
      forceRefresh ? '/api/academics-config?refresh=1' : '/api/academics-config',
      {
        headers: activeUrl ? { 'x-apps-script-url': activeUrl } : undefined,
        signal: AbortSignal.timeout(9000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.config) {
        const normalized = normalizeAcademicsConfig(data.config);
        return saveLocalAcademicsConfig(normalized);
      }
    }
  } catch {}

  if (activeUrl) {
    try {
      const directRes = await directGetFromSheet('getAcademicsConfig', activeUrl);
      if (directRes.ok && directRes.json?.config) {
        const normalized = normalizeAcademicsConfig(directRes.json.config);
        return saveLocalAcademicsConfig(normalized);
      }
    } catch {}
  }
  return local;
};

export const syncAcademicsConfigFromSheetWithStatus = async (): Promise<{
  sheetSynced: boolean;
  config: AcademicsConfigSnapshot;
}> => {
  invalidateAcademicsCache();
  const local = loadLocalAcademicsConfig();
  const activeUrl = (getAppsScriptUrl() || '').trim();
  try {
    const res = await fetch('/api/academics-config?refresh=1', {
      headers: activeUrl ? { 'x-apps-script-url': activeUrl } : undefined,
      signal: AbortSignal.timeout(9500),
    });
    if (res.ok) {
      const data = await res.json();
      const resolvedCfg = data?.config
        ? saveLocalAcademicsConfig(data.config)
        : local;
      if (data?.sheetSynced) {
        return { sheetSynced: true, config: resolvedCfg };
      }
    }
  } catch {}

  if (activeUrl) {
    try {
      const directRes = await directGetFromSheet('getAcademicsConfig', activeUrl);
      if (directRes.ok && directRes.json?.config) {
        const resolvedCfg = saveLocalAcademicsConfig(directRes.json.config);
        return { sheetSynced: true, config: resolvedCfg };
      }
    } catch {}
  }

  return { sheetSynced: false, config: local };
};

export const saveAcademicsConfigToServer = async (
  nextConfig: AcademicsConfigSnapshot,
  updatedBy = 'Manager'
): Promise<{
  success: boolean;
  sheetSynced: boolean;
  sheetError?: string;
  config: AcademicsConfigSnapshot;
}> => {
  const activeUrl = (getAppsScriptUrl() || '').trim();
  const payloadConfig: AcademicsConfigSnapshot = normalizeAcademicsConfig({
    ...nextConfig,
    updatedAt: getLocalTimestamp(),
    updatedBy,
  });
  const savedLocal = saveLocalAcademicsConfig(payloadConfig);

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/academics-config',
    apiBody: { config: payloadConfig },
    directPayload: {
      action: 'saveAcademicsConfig',
      config: payloadConfig,
    },
    overrideUrl: activeUrl,
  });

  const resolvedCfg = syncRes.data?.config
    ? saveLocalAcademicsConfig(syncRes.data.config)
    : savedLocal;

  realtimeSync.broadcastUpdate('academics', 'updateAcademicsConfig', {
    activeSessionId: resolvedCfg.activeSessionId,
  });

  return {
    success: true,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
    config: resolvedCfg,
  };
};

export const getTodayWeekdayKey = (): WeekdayKey => {
  const dayIndex = new Date().getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const map: Record<number, WeekdayKey> = {
    0: 'Monday',
    1: 'Monday',
    2: 'Tuesday',
    3: 'Wednesday',
    4: 'Thursday',
    5: 'Friday',
    6: 'Saturday',
  };
  return map[dayIndex] || 'Monday';
};

export const getNextClassSuggestion = (
  currentClassKey: string,
  orderedKeys: string[] = STANDARD_CLASS_ORDER
): string => {
  const clean = String(currentClassKey || '').trim();
  const idx = orderedKeys.findIndex((k) => k.toLowerCase() === clean.toLowerCase());
  if (idx >= 0 && idx < orderedKeys.length - 1) {
    return orderedKeys[idx + 1];
  }
  if (idx === orderedKeys.length - 1) {
    return 'Passout / Alumni';
  }
  return clean;
};

export const resolveStudentClassAndSection = (
  student: Student,
  overrides?: Record<string, StudentAcademicOverride>
): { classKey: string; sectionName: string; status: string } => {
  const idKey = String(student.Student_ID || '').trim().toLowerCase();
  const ov = overrides && idKey ? overrides[idKey] : undefined;
  const classKey = String(ov?.classKey || student.Class || '').trim();
  const sectionName = String(ov?.sectionName || (student as any).Section || 'A').trim() || 'A';
  const status = ov?.status || 'Active';
  return { classKey, sectionName, status };
};

export const applyAcademicOverridesToStudents = (
  students: Student[],
  overrides?: Record<string, StudentAcademicOverride>
): Student[] => {
  if (!overrides || Object.keys(overrides).length === 0) return students;
  return students.map((st) => {
    const idKey = String(st.Student_ID || '').trim().toLowerCase();
    const ov = idKey ? overrides[idKey] : undefined;
    if (!ov) return st;
    return {
      ...st,
      Class: ov.classKey || st.Class,
      Section: ov.sectionName || (st as any).Section || 'A',
      Academic_Session: ov.sessionId || (st as any).Academic_Session,
      Academic_Status: ov.status || 'Active',
    };
  });
};

export const getPeriodSetForClass = (
  config: AcademicsConfigSnapshot,
  classKey: string
): PeriodSetConfig => {
  const clean = String(classKey || '').trim().toLowerCase();
  const specific = config.periodSets.find((ps) =>
    ps.assignedClassKeys.some((k) => k.trim().toLowerCase() === clean)
  );
  if (specific) return specific;
  const fallbackAll = config.periodSets.find((ps) =>
    ps.assignedClassKeys.some((k) => k.trim().toUpperCase() === 'ALL')
  );
  return fallbackAll || config.periodSets[0] || DEFAULT_PERIOD_SETS[0];
};

export const findTeacherConflictsAtSlot = (
  timetable: TimetableEntry[],
  params: {
    sessionId: string;
    day: WeekdayKey;
    periodId: string;
    teacherId: string;
    ignoreClassKey?: string;
    ignoreSectionName?: string;
  }
): TimetableEntry[] => {
  const tId = String(params.teacherId || '').trim().toLowerCase();
  if (!tId) return [];
  return timetable.filter((entry) => {
    if (entry.sessionId !== params.sessionId) return false;
    if (entry.day !== params.day || entry.periodId !== params.periodId) return false;
    if (String(entry.teacherId || '').trim().toLowerCase() !== tId) return false;
    if (
      params.ignoreClassKey &&
      params.ignoreSectionName &&
      entry.classKey.toLowerCase() === params.ignoreClassKey.toLowerCase() &&
      entry.sectionName.toLowerCase() === params.ignoreSectionName.toLowerCase()
    ) {
      return false;
    }
    return true;
  });
};

export const getTeachersOnly = (users: SchoolUser[]): SchoolUser[] => {
  return users.filter((u) => {
    const des = String(u.Designation || '').toLowerCase();
    const isDriver = des.includes('driver') || des.includes('van') || des.includes('bus');
    return !isDriver;
  });
};

export const computeTeacherWorkloadMap = (
  timetable: TimetableEntry[],
  sessionId: string,
  teachers: SchoolUser[]
): Array<{
  teacher: SchoolUser;
  periodsPerWeek: number;
  classes: string[];
  subjects: string[];
  entries: TimetableEntry[];
}> => {
  const activeEntries = timetable.filter((e) => e.sessionId === sessionId);
  return teachers
    .map((teacher) => {
      const tId = String(teacher.User_ID || '').trim().toLowerCase();
      const tName = String(teacher.Name || '').trim().toLowerCase();
      const mine = activeEntries.filter((e) => {
        const eId = String(e.teacherId || '').trim().toLowerCase();
        const eName = String(e.teacherName || '').trim().toLowerCase();
        return (tId && eId === tId) || (tName && eName === tName);
      });
      const classes = Array.from(new Set(mine.map((m) => `${m.classKey}-${m.sectionName}`)));
      const subjects = Array.from(new Set(mine.map((m) => m.subjectName).filter(Boolean)));
      return {
        teacher,
        periodsPerWeek: mine.length,
        classes,
        subjects,
        entries: mine,
      };
    })
    .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek);
};

export const findFreeAndBusyTeachersAtSlot = (
  timetable: TimetableEntry[],
  substitutions: TeacherSubstitution[],
  sessionId: string,
  day: WeekdayKey,
  periodId: string,
  dateYMD: string,
  teachers: SchoolUser[]
): {
  freeTeachers: SchoolUser[];
  busyTeachers: Array<{ teacher: SchoolUser; assignmentLabel: string }>;
} => {
  const freeTeachers: SchoolUser[] = [];
  const busyTeachers: Array<{ teacher: SchoolUser; assignmentLabel: string }> = [];

  for (const teacher of teachers) {
    const tId = String(teacher.User_ID || '').trim().toLowerCase();
    const regular = timetable.find(
      (e) =>
        e.sessionId === sessionId &&
        e.day === day &&
        e.periodId === periodId &&
        String(e.teacherId || '').trim().toLowerCase() === tId
    );
    const sub = substitutions.find(
      (s) =>
        s.sessionId === sessionId &&
        s.date === dateYMD &&
        s.periodId === periodId &&
        String(s.substituteTeacherId || '').trim().toLowerCase() === tId
    );
    if (sub) {
      busyTeachers.push({
        teacher,
        assignmentLabel: `Substitution: ${sub.classKey}-${sub.sectionName} (${sub.subjectName})`,
      });
    } else if (regular) {
      busyTeachers.push({
        teacher,
        assignmentLabel: `${regular.classKey}-${regular.sectionName} (${regular.subjectName})`,
      });
    } else {
      freeTeachers.push(teacher);
    }
  }

  return { freeTeachers, busyTeachers };
};

export const getCurrentTimeMinutesIST = (): number => {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return (h === 24 ? 0 : h) * 60 + m;
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
};

export const parseHHMMToMinutes = (hhmm: string): number => {
  const [h, m] = String(hhmm || '00:00').split(':').map((n) => Number(n) || 0);
  return h * 60 + m;
};

export const formatTime12Hr = (hhmm: string): string => {
  const [hRaw, mRaw] = String(hhmm || '08:00').split(':').map((n) => Number(n) || 0);
  const suffix = hRaw >= 12 ? 'PM' : 'AM';
  const h12 = hRaw % 12 === 0 ? 12 : hRaw % 12;
  return `${h12}:${String(mRaw).padStart(2, '0')} ${suffix}`;
};

export const getTodayDateString = (): string => getLocalDateYMD();

export const createPromotionLogId = (): string =>
  `promo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
