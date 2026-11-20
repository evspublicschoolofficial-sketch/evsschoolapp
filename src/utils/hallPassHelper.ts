import { ExamTermType, FeeCollectionRecord, HallPassCardLayout, HallPassConfig, HallPassDatesheetRow, Student } from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { calculateStudentSummary, isStudentFeeExempt, normalizeStudentId } from './feeCalculation';
import { DEFAULT_FEE_CONFIG, getActiveFeeMasterConfig, normalizeClassKey } from './feeMaster';
import { saveToPhoneMemory } from './phoneMemoryCache';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';

export const HALL_PASS_CONFIG_STORAGE_KEY = 'evs_hall_pass_config_v1';

export const DATESHEET_CLASS_COLUMNS = [
  'M1',
  'M2',
  'M3',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6 & 7',
  'Class 8',
] as const;

export const DEFAULT_HALF_YEARLY_DATESHEET_ROWS: HallPassDatesheetRow[] = [
  {
    date: '23/11/2026',
    day: 'Mon',
    subjects: {
      M1: 'Maths (Written)',
      M2: 'Maths (Written)',
      M3: 'English',
      'Class 1': 'English',
      'Class 2': 'English',
      'Class 3': 'English',
      'Class 4': 'English',
      'Class 5': 'EVS',
      'Class 6 & 7': 'Science',
      'Class 8': 'SST',
    },
  },
  {
    date: '25/11/2026',
    day: 'Wed',
    subjects: {
      M1: 'Maths (Oral)',
      M2: 'Maths (Oral)',
      M3: 'Hindi',
      'Class 1': 'Computer',
      'Class 2': 'EVS',
      'Class 3': 'Maths',
      'Class 4': 'Maths',
      'Class 5': 'Maths',
      'Class 6 & 7': 'English',
      'Class 8': 'Science',
    },
  },
  {
    date: '26/11/2026',
    day: 'Thu',
    subjects: {
      M1: 'English (Written)',
      M2: 'English (Written)',
      M3: 'Maths',
      'Class 1': 'Hindi',
      'Class 2': 'Urdu',
      'Class 3': 'EVS',
      'Class 4': 'EVS',
      'Class 5': 'Computer',
      'Class 6 & 7': 'SST',
      'Class 8': 'Maths',
    },
  },
  {
    date: '27/11/2026',
    day: 'Fri',
    subjects: {
      M1: 'English (Oral)',
      M2: 'English (Oral)',
      M3: 'EVS',
      'Class 1': 'Urdu',
      'Class 2': 'Hindi',
      'Class 3': 'Hindi',
      'Class 4': 'Hindi',
      'Class 5': 'Hindi',
      'Class 6 & 7': 'Hindi',
      'Class 8': 'English',
    },
  },
  {
    date: '28/11/2026',
    day: 'Sat',
    subjects: {
      M1: 'Hindi (Written)',
      M2: 'Hindi (Written)',
      M3: 'Computer',
      'Class 1': 'EVS',
      'Class 2': 'Maths',
      'Class 3': 'Computer',
      'Class 4': 'Urdu',
      'Class 5': 'English',
      'Class 6 & 7': 'Maths',
      'Class 8': 'Hindi',
    },
  },
  {
    date: '30/11/2026',
    day: 'Mon',
    subjects: {
      M1: 'Hindi (Oral)',
      M2: 'Hindi (Oral)',
      M3: 'Drawing',
      'Class 1': 'Maths',
      'Class 2': 'Computer',
      'Class 3': 'Urdu',
      'Class 4': 'Computer',
      'Class 5': 'Urdu',
      'Class 6 & 7': 'Urdu',
      'Class 8': 'Urdu',
    },
  },
  {
    date: '01/12/2026',
    day: 'Tue',
    subjects: {
      M1: 'Drawing',
      M2: 'Drawing',
      M3: 'Urdu',
      'Class 1': 'G.K.',
      'Class 2': 'Drawing',
      'Class 3': 'G.K.',
      'Class 4': 'G.K.',
      'Class 5': 'G.K.',
      'Class 6 & 7': 'Drawing',
      'Class 8': 'Drawing',
    },
  },
  {
    date: '02/12/2026',
    day: 'Wed',
    subjects: {
      M1: 'G.K. (Oral)',
      M2: 'G.K. (Oral)',
      M3: 'G.K.',
      'Class 1': 'Drawing',
      'Class 2': 'G.K.',
      'Class 3': 'Drawing',
      'Class 4': 'Drawing',
      'Class 5': 'Drawing',
      'Class 6 & 7': 'G.K.',
      'Class 8': 'G.K.',
    },
  },
  {
    date: '03/12/2026',
    day: 'Thu',
    subjects: {
      M1: 'PT / Conversation',
      M2: 'PT / Conversation',
      M3: 'PT / Conversation',
      'Class 1': 'PT / Conversation',
      'Class 2': 'PT / Conversation',
      'Class 3': 'PT / Conversation',
      'Class 4': 'PT / Conversation',
      'Class 5': 'PT / Conversation',
      'Class 6 & 7': 'PT / Conversation',
      'Class 8': 'PT / Conversation',
    },
  },
];

export const DEFAULT_HALL_PASS_CONFIG: HallPassConfig = {
  examType: 'Half-Yearly',
  session: '2026-27',
  customExamTitle: '',
  examScheduleLine: 'Exam: 09:30 AM - 12:00 PM (2.5 Hrs)',
  instructionLine: 'Bring Hall Pass, School ID & stationery daily. Report by 08:45 AM.',
  publishedToParent: true,
  allowedOverrides: {},
  datesheetArrivalLine: 'Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM',
  datesheetHolidayNote: '24/11 Tue: Guru Nanak Jayanti Holiday · 29/11 Sun: Sunday Off',
  backsideFlipMode: 'book_flip',
  cardLayout: 'portrait_67x96',
  datesheetRows: DEFAULT_HALF_YEARLY_DATESHEET_ROWS,
  updatedAt: '',
};

export interface HallPassLayoutSpec {
  id: HallPassCardLayout;
  isLandscape: boolean;
  widthMm: number;
  heightMm: number;
  labelHi: string;
  shortNoteHi: string;
}

export const HALL_PASS_LAYOUT_SPECS: Record<HallPassCardLayout, HallPassLayoutSpec> = {
  portrait_67x96: {
    id: 'portrait_67x96',
    isLandscape: false,
    widthMm: 67.5,
    heightMm: 96.5,
    labelHi: 'खड़ा कार्ड (67.5 × 96.5 mm · ऊपर छोटा सिरा)',
    shortNoteHi: 'A4 Portrait पर 9 कार्ड · स्टैंडर्ड वर्टिकल पॉलीपैक के लिए',
  },
  landscape_polypack_90x55: {
    id: 'landscape_polypack_90x55',
    isLandscape: true,
    widthMm: 90,
    heightMm: 55,
    labelHi: 'लेटा कार्ड · 70×100 पॉलीपैक फिट (90 × 55 mm)',
    shortNoteHi: 'A4 Landscape पर 9 कार्ड · 70×100mm लैनयार्ड पॉलीपैक के अंदर बिना मुड़े एकदम फिट',
  },
  landscape_full_96x67: {
    id: 'landscape_full_96x67',
    isLandscape: true,
    widthMm: 96.5,
    heightMm: 67.5,
    labelHi: 'लेटा कार्ड · फुल ग्रिड (96.5 × 67.5 mm)',
    shortNoteHi: 'A4 Landscape पर 9 कार्ड · बड़े हॉरिजॉन्टल पाउच के लिए',
  },
};

export function resolveHallPassLayout(layout?: HallPassCardLayout): HallPassLayoutSpec {
  if (layout && layout in HALL_PASS_LAYOUT_SPECS) {
    return HALL_PASS_LAYOUT_SPECS[layout];
  }
  return HALL_PASS_LAYOUT_SPECS.portrait_67x96;
}

export const EXAM_TYPE_TITLES: Record<ExamTermType, { en: string; hi: string }> = {
  Quarterly: { en: 'QUARTERLY EXAMINATION', hi: 'तिमाही परीक्षा' },
  'Half-Yearly': { en: 'HALF-YEARLY EXAMINATION', hi: 'छमाही परीक्षा' },
  Annual: { en: 'ANNUAL EXAMINATION', hi: 'सालाना परीक्षा' },
};

export function getExamDisplayTitle(examType: ExamTermType, customTitle?: string): string {
  const custom = String(customTitle || '').trim();
  if (custom) return custom.toUpperCase();
  return EXAM_TYPE_TITLES[examType]?.en || 'HALF-YEARLY EXAMINATION';
}

export function resolveDatesheetClassKey(rawClass?: string | null, mappedLabel?: string | null): string {
  const combined = `${String(rawClass || '').trim()} ${String(mappedLabel || '').trim()}`.toLowerCase();
  const code = String(rawClass || '').trim().toUpperCase();

  if (code === 'C1' || code === 'C2' || /\b(m1|nursery|play)\b/i.test(combined)) return 'M1';
  if (code === 'C3' || /\b(m2|lkg)\b/i.test(combined)) return 'M2';
  if (code === 'C4' || /\b(m3|ukg)\b/i.test(combined)) return 'M3';
  if (code === 'C5' || /\b(1st|class\s*1)\b/i.test(combined) || /^1$/.test(code)) return 'Class 1';
  if (code === 'C6' || /\b(2nd|class\s*2)\b/i.test(combined) || /^2$/.test(code)) return 'Class 2';
  if (code === 'C7' || /\b(3rd|class\s*3)\b/i.test(combined) || /^3$/.test(code)) return 'Class 3';
  if (code === 'C8' || /\b(4th|class\s*4)\b/i.test(combined) || /^4$/.test(code)) return 'Class 4';
  if (code === 'C9' || /\b(5th|class\s*5)\b/i.test(combined) || /^5$/.test(code)) return 'Class 5';
  if (code === 'C10' || code === 'C11' || /\b(6th|7th|class\s*6|class\s*7)\b/i.test(combined) || /^[67]$/.test(code)) {
    return 'Class 6 & 7';
  }
  if (code === 'C12' || /\b(8th|class\s*8)\b/i.test(combined) || /^8$/.test(code)) return 'Class 8';
  return 'Class 1';
}

export function getStudentDatesheetSchedule(
  config: HallPassConfig,
  rawClass?: string | null,
  mappedLabel?: string | null
): Array<{ date: string; day: string; subject: string }> {
  const classKey = resolveDatesheetClassKey(rawClass, mappedLabel);
  const rows = Array.isArray(config.datesheetRows) && config.datesheetRows.length > 0
    ? config.datesheetRows
    : DEFAULT_HALF_YEARLY_DATESHEET_ROWS;

  return rows
    .map((r) => ({
      date: r.date,
      day: r.day,
      subject: r.subjects?.[classKey] || '—',
    }))
    .filter((r) => r.date || r.subject !== '—');
}

/**
 * Rearrange 9 padded grid slots of a single 3x3 A4 page so the backside aligns behind each front card:
 * - book_flip (Long-edge / left-to-right flip like turning a book): Each row [0,1,2] mirrors to [2,1,0].
 * - row_flip (Short-edge / top-to-bottom flip): Rows reverse [Row2, Row1, Row0] keeping columns [0,1,2].
 */
export function mapPageSlotsForBackside<T>(
  nineSlots: Array<T | null>,
  flipMode: 'book_flip' | 'row_flip' = 'book_flip'
): Array<T | null> {
  const padded = [...nineSlots];
  while (padded.length < 9) padded.push(null);

  if (flipMode === 'row_flip') {
    return [
      padded[6], padded[7], padded[8],
      padded[3], padded[4], padded[5],
      padded[0], padded[1], padded[2],
    ];
  }

  // Default book_flip: mirror horizontally per row
  return [
    padded[2], padded[1], padded[0],
    padded[5], padded[4], padded[3],
    padded[8], padded[7], padded[6],
  ];
}

export function getClassExamFee(classRaw?: string | null): number {
  const classKey = normalizeClassKey(classRaw);
  const activeMaster = getActiveFeeMasterConfig();
  const fee = activeMaster?.[classKey]?.examFee;
  if (fee !== undefined && !isNaN(Number(fee)) && Number(fee) >= 0) {
    return Number(fee);
  }
  return DEFAULT_FEE_CONFIG.examFee;
}

export type HallPassEligibilityStatus = 'CLEARED' | 'WAIVED' | 'OVERRIDE_ALLOWED' | 'FEE_HOLD';

export interface StudentHallPassEligibility {
  student: Student;
  status: HallPassEligibilityStatus;
  isEligible: boolean;
  isFeeWaived: boolean;
  isManagerAllowed: boolean;
  dueAmount: number;
  advanceAmount: number;
  examFee: number;
  statusLabel: string;
  overrideNote?: string;
}

export function computeStudentHallPassEligibility(
  student: Student,
  feeRecords: FeeCollectionRecord[],
  config: HallPassConfig
): StudentHallPassEligibility {
  const normId = normalizeStudentId(student.Student_ID);
  const summary = calculateStudentSummary(student.Student_ID, feeRecords, student);
  const isFeeWaived = isStudentFeeExempt(student);
  const dueAmount = Math.max(0, Number(summary.currentDues || 0));
  const advanceAmount = Math.max(0, Number(summary.advanceAmount || 0));
  const examFee = getClassExamFee(student.Class);
  const overrideEntry = config?.allowedOverrides?.[normId];
  const isManagerAllowed = Boolean(overrideEntry?.allowed);

  let status: HallPassEligibilityStatus = 'FEE_HOLD';
  let statusLabel = `Due ₹${dueAmount.toLocaleString('en-IN')}`;

  if (dueAmount <= 0) {
    if (isFeeWaived) {
      status = 'WAIVED';
      statusLabel = 'FEE WAIVED';
    } else {
      status = 'CLEARED';
      statusLabel = 'FEE CLEARED';
    }
  } else if (isManagerAllowed) {
    status = 'OVERRIDE_ALLOWED';
    statusLabel = 'PROVISIONAL';
  }

  return {
    student,
    status,
    isEligible: dueAmount <= 0 || isManagerAllowed,
    isFeeWaived,
    isManagerAllowed,
    dueAmount,
    advanceAmount,
    examFee,
    statusLabel,
    overrideNote: overrideEntry?.note,
  };
}

export function chunkIntoPages<T>(items: T[], perPage: number = 9): T[][] {
  if (!items || items.length === 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}

function mergeWithDefaults(parsed: any): HallPassConfig {
  return {
    ...DEFAULT_HALL_PASS_CONFIG,
    ...(parsed || {}),
    allowedOverrides:
      parsed?.allowedOverrides && typeof parsed.allowedOverrides === 'object'
        ? parsed.allowedOverrides
        : {},
    datesheetRows:
      Array.isArray(parsed?.datesheetRows) && parsed.datesheetRows.length > 0
        ? parsed.datesheetRows
        : DEFAULT_HALF_YEARLY_DATESHEET_ROWS,
    backsideFlipMode: parsed?.backsideFlipMode === 'row_flip' ? 'row_flip' : 'book_flip',
    cardLayout:
      parsed?.cardLayout === 'landscape_polypack_90x55' ||
      parsed?.cardLayout === 'landscape_full_96x67'
        ? parsed.cardLayout
        : 'portrait_67x96',
  };
}

export function loadLocalHallPassConfig(): HallPassConfig {
  try {
    const raw = localStorage.getItem(HALL_PASS_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return mergeWithDefaults(parsed);
      }
    }
  } catch {}
  return mergeWithDefaults(null);
}

export async function fetchHallPassConfigFromServer(forceRefresh = false): Promise<HallPassConfig> {
  const activeUrl = getAppsScriptUrl();
  try {
    const res = await fetch(
      `/api/hall-pass-config${forceRefresh ? '?fresh=1&' : '?'}_t=${Date.now()}`,
      {
        headers: { 'x-apps-script-url': activeUrl },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const json = await res.json();
      if (json?.config && typeof json.config === 'object') {
        const merged = mergeWithDefaults(json.config);
        saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, merged);
        return merged;
      }
    }
  } catch {}

  try {
    const direct = await directGetFromSheet('getHallPassConfig', activeUrl);
    if (direct.ok && direct.json?.config && typeof direct.json.config === 'object') {
      const merged = mergeWithDefaults(direct.json.config);
      saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, merged);
      return merged;
    }
  } catch {}

  return loadLocalHallPassConfig();
}

export async function saveHallPassConfigWithStatus(config: HallPassConfig): Promise<{
  config: HallPassConfig;
  sheetSynced: boolean;
  sheetError?: string;
}> {
  const mergedLocal = mergeWithDefaults(config);
  saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, mergedLocal);

  try {
    const syncRes = await dualSyncWriteToSheet({
      apiPath: '/api/hall-pass-config',
      apiBody: { config: mergedLocal },
      directPayload: {
        action: 'saveHallPassConfig',
        config: JSON.stringify(mergedLocal),
      },
    });

    if (syncRes.data?.config) {
      const merged = mergeWithDefaults(syncRes.data.config);
      saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, merged);
      return {
        config: merged,
        sheetSynced: syncRes.sheetSynced,
        sheetError: syncRes.sheetError,
      };
    }

    return {
      config: mergedLocal,
      sheetSynced: syncRes.sheetSynced,
      sheetError: syncRes.sheetError,
    };
  } catch (err: any) {
    return {
      config: mergedLocal,
      sheetSynced: false,
      sheetError: err?.message || 'Could not reach sync server',
    };
  }
}

export async function saveHallPassConfigToServer(config: HallPassConfig): Promise<HallPassConfig> {
  const res = await saveHallPassConfigWithStatus(config);
  return res.config;
}
