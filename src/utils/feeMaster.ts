import { Student, FeeCollectionRecord } from '../types';
import { saveToPhoneMemory } from './phoneMemoryCache';

export const FREE_STUDENTS_UPDATED_EVENT = 'evs-free-students-updated';
export const FEE_MASTER_UPDATED_EVENT = 'evs-fee-master-updated';

/**
 * Standard Fee Structure per Class (Strictly 4 Fees per School Brief:
 * 1. Admission Fee, 2. Monthly Tuition Fee, 3. Exam Fee, 4. Books Fee)
 */
export interface ClassFeeConfig {
  admissionFee: number;
  monthlyTuition: number;
  examFee: number;
  booksFee: number;
}

export const FEE_MASTER_CONFIG: Record<string, ClassFeeConfig> = {
  // Pre-Primary (Tuition: 350, Admission: 1000)
  'play': {
    admissionFee: 1000,
    monthlyTuition: 350,
    examFee: 150,
    booksFee: 1140,
  },
  'nursery': {
    admissionFee: 1000,
    monthlyTuition: 350,
    examFee: 150,
    booksFee: 1195,
  },
  'lkg': {
    admissionFee: 1000,
    monthlyTuition: 350,
    examFee: 150,
    booksFee: 1245,
  },
  'ukg': {
    admissionFee: 1000,
    monthlyTuition: 350,
    examFee: 150,
    booksFee: 1345,
  },
  // Primary Classes (1st-3rd: Tuition 400, Admission 1000; 4th-5th: Tuition 450, Admission 1000)
  '1st': {
    admissionFee: 1000,
    monthlyTuition: 400,
    examFee: 200,
    booksFee: 2345,
  },
  '2nd': {
    admissionFee: 1000,
    monthlyTuition: 400,
    examFee: 200,
    booksFee: 2530,
  },
  '3rd': {
    admissionFee: 1000,
    monthlyTuition: 400,
    examFee: 200,
    booksFee: 2705,
  },
  '4th': {
    admissionFee: 1000,
    monthlyTuition: 450,
    examFee: 200,
    booksFee: 2880,
  },
  '5th': {
    admissionFee: 1000,
    monthlyTuition: 450,
    examFee: 200,
    booksFee: 3050,
  },
  // Upper Primary / Middle Classes (6th-8th: Tuition 500, Admission 1000)
  '6th': {
    admissionFee: 1000,
    monthlyTuition: 500,
    examFee: 250,
    booksFee: 3000,
  },
  '7th': {
    admissionFee: 1000,
    monthlyTuition: 500,
    examFee: 250,
    booksFee: 3100,
  },
  '8th': {
    admissionFee: 1000,
    monthlyTuition: 500,
    examFee: 250,
    booksFee: 3230,
  },
};

export interface ClassMeta {
  key: string;
  name: string;
  hindiName: string;
  group: 'Pre-Primary' | 'Primary' | 'Middle';
}

export const CLASS_META_LIST: ClassMeta[] = [
  { key: 'play', name: 'Play Group', hindiName: 'प्ले ग्रुप', group: 'Pre-Primary' },
  { key: 'nursery', name: 'Nursery (M1)', hindiName: 'नर्सरी', group: 'Pre-Primary' },
  { key: 'lkg', name: 'L.K.G. (M2)', hindiName: 'एल.के.जी.', group: 'Pre-Primary' },
  { key: 'ukg', name: 'U.K.G. (M3)', hindiName: 'यू.के.जी.', group: 'Pre-Primary' },
  { key: '1st', name: 'Class 1st', hindiName: 'कक्षा 1', group: 'Primary' },
  { key: '2nd', name: 'Class 2nd', hindiName: 'कक्षा 2', group: 'Primary' },
  { key: '3rd', name: 'Class 3rd', hindiName: 'कक्षा 3', group: 'Primary' },
  { key: '4th', name: 'Class 4th', hindiName: 'कक्षा 4', group: 'Primary' },
  { key: '5th', name: 'Class 5th', hindiName: 'कक्षा 5', group: 'Primary' },
  { key: '6th', name: 'Class 6th', hindiName: 'कक्षा 6', group: 'Middle' },
  { key: '7th', name: 'Class 7th', hindiName: 'कक्षा 7', group: 'Middle' },
  { key: '8th', name: 'Class 8th', hindiName: 'कक्षा 8', group: 'Middle' },
];

export const DEFAULT_FEE_CONFIG: ClassFeeConfig = {
  admissionFee: 1000,
  monthlyTuition: 450,
  examFee: 200,
  booksFee: 2500,
};

/**
 * Get active Fee Master configuration from localStorage or default seed
 */
export const getActiveFeeMasterConfig = (): Record<string, ClassFeeConfig> => {
  try {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('evs_fee_master_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          // If corrupted with the old 1234 Users password glitch, purge it!
          if (parsed['nursery']?.admissionFee === 1234 || parsed['4th']?.admissionFee === 1234) {
            localStorage.removeItem('evs_fee_master_config');
            return FEE_MASTER_CONFIG;
          }
          return { ...FEE_MASTER_CONFIG, ...parsed };
        }
      }
    }
  } catch (e) {
    console.warn('Could not read saved fee master:', e);
  }
  return FEE_MASTER_CONFIG;
};

/**
 * Save updated Fee Master configuration to localStorage
 */
export const saveActiveFeeMasterConfig = (newConfig: Record<string, ClassFeeConfig>): void => {
  try {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('evs_fee_master_config', JSON.stringify(newConfig));
      window.dispatchEvent(new CustomEvent(FEE_MASTER_UPDATED_EVENT, { detail: newConfig }));
    }
  } catch (e) {
    console.warn('Could not save fee master config:', e);
  }
};

/**
 * Synchronize Fee Master configuration with Google Sheet (Option B: Auto-Creates Fee_Master sheet)
 */
export const syncFeeMasterToGoogleSheet = async (
  config: Record<string, ClassFeeConfig>,
  apiUrl: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveFeeMaster',
        configs: config,
      }),
    });
    const json = await res.json();
    return {
      success: json.status === 'success',
      message: json.message || 'Fee Master Google Sheet me safe ho gaya!',
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message || 'Google Sheet sync note',
    };
  }
};

/**
 * Synchronize School Notices with Google Sheet (Option B: Auto-Creates School_Notices sheet)
 */
export const syncNoticesToGoogleSheet = async (
  notices: any[],
  apiUrl: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncNotices',
        notices: notices,
      }),
    });
    const json = await res.json();
    return {
      success: json.status === 'success',
      message: json.message || 'Notices Google Sheet me safe ho gaye!',
    };
  } catch (e: any) {
    return {
      success: false,
      message: e.message || 'Google Sheet notice sync note',
    };
  }
};

/**
 * Fetch Fee Master configuration directly from Google Sheet (Option B)
 */
export const fetchFeeMasterFromGoogleSheet = async (
  apiUrl: string
): Promise<Record<string, ClassFeeConfig> | null> => {
  try {
    const res = await fetch(`${apiUrl}?action=getFeeMaster`);
    const json = await res.json();
    if (json.status === 'success' && json.configs && typeof json.configs === 'object') {
      const merged = { ...FEE_MASTER_CONFIG, ...json.configs };
      saveActiveFeeMasterConfig(merged);
      return merged;
    }
  } catch (e) {
    console.warn('Could not fetch Fee Master from Google Sheet via Apps Script:', e);
  }
  return null;
};

/**
 * Fetch Fee Master directly from Google Sheets via GViz (Supports 'Fee_Maseter', 'Fee_Master', etc.)
 */
export const fetchFeeMasterDirectGViz = async (
  spreadsheetId: string = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU'
): Promise<Record<string, ClassFeeConfig> | null> => {
  const tabCandidates = ['Fee_Master', 'FeeMaster', 'Fee Master'];
  for (const sheetName of tabCandidates) {
    try {
      const encoded = encodeURIComponent(sheetName);
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encoded}&_t=${Date.now()}`);
      if (!res.ok) continue;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) continue;
      const data = JSON.parse(text.slice(start, end + 1));
      const rawCols = (data.table?.cols || []).map((c: any) => String(c?.label || '').trim().toLowerCase());
      const rawRows = data.table?.rows || [];
      if (rawRows.length === 0) continue;

      // Determine where the headers are located (in table cols or in first row cells)
      let headerList = rawCols;
      let startRowIdx = 0;

      const firstRowCells = (rawRows[0]?.c || []).map((cell: any) => String(cell?.v || '').trim().toLowerCase());
      const colsHasHeaders = headerList.some((c) => c.includes('class') || c.includes('admission') || c.includes('tution') || c.includes('tuition') || c.includes('fee'));
      const rowHasHeaders = firstRowCells.some((c: string) => c.includes('class') || c.includes('admission') || c.includes('tution') || c.includes('tuition') || c.includes('fee'));

      if (!colsHasHeaders && rowHasHeaders) {
        headerList = firstRowCells;
        startRowIdx = 1;
      } else if (colsHasHeaders && rowHasHeaders) {
        // If cols has headers AND row 0 also repeats the header row
        if (firstRowCells[0] && (firstRowCells[0] === 'class' || firstRowCells[0] === 'c1' || firstRowCells[0].includes('class'))) {
          if (firstRowCells[0] === 'class') {
            startRowIdx = 1;
          }
        }
      }

      // Reject if this is not a fee sheet (e.g. Google Sheets served Users sheet fallback with password/user_id)
      if (headerList.some((c) => c.includes('password') || c.includes('user_id'))) continue;
      const hasRealFeeCol = headerList.some((c) => c.includes('admission') || c.includes('tution') || c.includes('tuition'));
      if (!hasRealFeeCol) continue;

      const classIdx = headerList.findIndex((c: string) => c.includes('class') && !c.includes('name'));
      const admIdx = headerList.findIndex((c: string) => c.includes('admission'));
      const tutionIdx = headerList.findIndex((c: string) => c.includes('tution') || c.includes('tuition') || c.includes('monthly'));
      const examIdx = headerList.findIndex((c: string) => c.includes('exam'));
      const booksIdx = headerList.findIndex((c: string) => c.includes('book'));

      // If headers not detected at all, default indices based on standard sheet layout
      const effectiveClassIdx = classIdx !== -1 ? classIdx : 0;
      const effectiveAdmIdx = admIdx !== -1 ? admIdx : 3; // Col D is usually admission in user's sheet
      const effectiveTutIdx = tutionIdx !== -1 ? tutionIdx : 2; // Col C is usually tuition in user's sheet
      const effectiveExamIdx = examIdx !== -1 ? examIdx : 4; // Col E is usually exam in user's sheet
      const effectiveBooksIdx = booksIdx !== -1 ? booksIdx : (headerList.length > 7 ? 7 : 5); // Col H or Col F

      const result: Record<string, ClassFeeConfig> = {};
      for (let r = startRowIdx; r < rawRows.length; r++) {
        const cells = (rawRows[r].c || []).map((c: any) => c?.v);
        const rawClass = String(cells[effectiveClassIdx] || '').trim();
        if (!rawClass || rawClass.toLowerCase() === 'class') continue;

        const classKey = normalizeClassKey(rawClass);
        const rawAdm = Number(cells[effectiveAdmIdx]);
        const rawTut = Number(cells[effectiveTutIdx]);
        const rawExam = Number(cells[effectiveExamIdx]);
        const rawBooks = Number(cells[effectiveBooksIdx]);

        const defaultClassCfg = FEE_MASTER_CONFIG[classKey] || DEFAULT_FEE_CONFIG;
        result[classKey] = {
          admissionFee: !isNaN(rawAdm) && rawAdm >= 0 ? rawAdm : defaultClassCfg.admissionFee,
          monthlyTuition: !isNaN(rawTut) && rawTut >= 0 ? rawTut : defaultClassCfg.monthlyTuition,
          examFee: !isNaN(rawExam) && rawExam >= 0 ? rawExam : defaultClassCfg.examFee,
          booksFee: !isNaN(rawBooks) && rawBooks >= 0 ? rawBooks : defaultClassCfg.booksFee,
        };
      }

      if (Object.keys(result).length > 0) {
        const merged = { ...FEE_MASTER_CONFIG, ...result };
        saveActiveFeeMasterConfig(merged);
        return merged;
      }
    } catch (e) {
      console.warn(`Error reading Fee Master sheet ${sheetName}:`, e);
    }
  }
  return null;
};

/**
 * Fetch School Notices directly from Google Sheet (Option B)
 */
export const fetchNoticesFromGoogleSheet = async (
  apiUrl: string
): Promise<any[] | null> => {
  try {
    const res = await fetch(`${apiUrl}?action=getNotices`);
    const json = await res.json();
    if (json.status === 'success' && Array.isArray(json.notices)) {
      return json.notices;
    }
  } catch (e) {
    console.warn('Could not fetch Notices from Google Sheet:', e);
  }
  return null;
};

/**
 * Normalizes class strings (e.g. "C2", "Nursery (M1)", "1st", "class 5") to lookup key
 */
export const normalizeClassKey = (classStr?: string | null): string => {
  if (!classStr) return 'nursery';
  const s = String(classStr).toLowerCase().trim();

  if (s.includes('play') || s === 'c1') return 'play';
  if (s.includes('nursery') || s.includes('m1') || s === 'c2') return 'nursery';
  if (s.includes('lkg') || s.includes('m2') || s === 'c3') return 'lkg';
  if (s.includes('ukg') || s.includes('m3') || s === 'c4') return 'ukg';
  if (s.includes('1st') || s === '1' || s.includes('कक्षा 1') || s === 'c5') return '1st';
  if (s.includes('2nd') || s === '2' || s.includes('कक्षा 2') || s === 'c6') return '2nd';
  if (s.includes('3rd') || s === '3' || s.includes('कक्षा 3') || s === 'c7') return '3rd';
  if (s.includes('4th') || s === '4' || s.includes('कक्षा 4') || s === 'c8') return '4th';
  if (s.includes('5th') || s === '5' || s.includes('कक्षा 5') || s === 'c9') return '5th';
  if (s.includes('6th') || s === '6' || s.includes('कक्षा 6') || s === 'c10') return '6th';
  if (s.includes('7th') || s === '7' || s.includes('कक्षा 7') || s === 'c11') return '7th';
  if (s.includes('8th') || s === '8' || s.includes('कक्षा 8') || s === 'c12') return '8th';

  return 'nursery';
};

/**
 * Check if a student is tagged with 100% Fee Waiver (Free Student)
 */
export const isFreeStudent = (
  student?: Student | null
): { isFree: boolean; reason: string } => {
  if (!student) return { isFree: false, reason: '' };

  const sId = String(student.Student_ID || '').toLowerCase().trim();

  // 1. Check LocalStorage Tagged Waiver Map (supports explicit true OR explicit untag false)
  try {
    const savedMap = localStorage.getItem('evs_free_students_map');
    if (savedMap && sId) {
      const map: Record<string, { isFree: boolean; reason: string }> = JSON.parse(savedMap);
      if (map[sId] !== undefined) {
        if (map[sId].isFree) {
          return { isFree: true, reason: map[sId].reason || '100% Fee Waived (स्कूल द्वारा फीस माफ)' };
        }
        return { isFree: false, reason: '' };
      }
    }
  } catch {}

  // 2. Explicit boolean property on student record
  if (student.Is_Free_Student === true || String(student.Is_Free_Student || '').trim().toLowerCase() === 'true') {
    return { isFree: true, reason: '100% Fee Waived (फीस माफ छात्र)' };
  }

  // 3. Fee_Waiver / Category / Remark columns from Google Sheet
  const waiverVal = String(
    student.Fee_Waiver || (student as any).fee_waiver || (student as any).is_free_student || ''
  )
    .trim()
    .toLowerCase();
  const isNegativeExplicit = /^(false|no|none|0|नहीं|normal)$/i.test(waiverVal);
  if (!isNegativeExplicit && waiverVal && /(true|yes|100|free|waiv|exempt|rte|माफ|निःशुल्क|फ्री)/i.test(waiverVal)) {
    return { isFree: true, reason: student.Fee_Waiver_Reason || '100% Fee Waived (शुल्क माफी अधिकृत)' };
  }

  const cat = String(student.Category || (student as any).category || '').trim().toLowerCase();
  const remark = String(
    student.Remark || (student as any).Remarks || (student as any).remark || ''
  )
    .trim()
    .toLowerCase();
  if (
    /(rte|free|waiv|exempt|माफ|निःशुल्क)/i.test(cat) ||
    /(फीस माफ|fee\s*waiv|100%\s*waiv|free\s*student|निःशुल्क)/i.test(remark)
  ) {
    return { isFree: true, reason: 'RTE / 100% Fee Waived (निःशुल्क प्रवेश श्रेणी)' };
  }

  // 4. Explicit Monthly_Fee === 0 in student profile
  const rawMonthlyFee = (student as any).Monthly_Fee ?? (student as any).monthly_fee;
  if (rawMonthlyFee !== undefined && rawMonthlyFee !== null && String(rawMonthlyFee).trim() === '0') {
    return { isFree: true, reason: '100% Tuition Waived (मासिक ट्यूशन ₹0)' };
  }

  return { isFree: false, reason: '' };
};

/**
 * Check if a student has a permanent monthly tuition discount (e.g., ₹50 or ₹100 per month)
 */
export const getStudentMonthlyDiscount = (
  student?: Student | null
): { monthlyDiscount: number; reason: string } => {
  if (!student) return { monthlyDiscount: 0, reason: '' };
  if (isFreeStudent(student).isFree) return { monthlyDiscount: 0, reason: '' };

  const sId = String(student.Student_ID || '').toLowerCase().trim();

  // 1. Check Fee Waivers / Discounts Map (synced with Server & Google Sheet 'Fee_Waivers')
  try {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const savedMap = localStorage.getItem('evs_free_students_map');
      if (savedMap && sId) {
        const map: Record<string, FeeWaiverEntry> = JSON.parse(savedMap);
        if (map[sId] !== undefined && map[sId].monthlyDiscount !== undefined) {
          const val = Math.max(0, Math.round(Number(map[sId].monthlyDiscount) || 0));
          return {
            monthlyDiscount: val,
            reason: map[sId].reason || (val > 0 ? `स्थायी मासिक छूट ₹${val}/माह` : ''),
          };
        }
      }
    }
  } catch {}

  // 2. Fallback to Student record columns (Monthly_Discount / Discount_Per_Month)
  const rawDisc = Number(
    (student as any).Monthly_Discount ??
      (student as any).Discount_Per_Month ??
      0
  );
  if (!isNaN(rawDisc) && rawDisc > 0) {
    const val = Math.round(rawDisc);
    return { monthlyDiscount: val, reason: `मासिक ट्यूशन छूट ₹${val}/माह` };
  }

  return { monthlyDiscount: 0, reason: '' };
};

/**
 * Tag or untag a student with 100% Fee Waiver and/or Monthly Tuition Discount
 */
export interface FeeWaiverEntry {
  isFree: boolean;
  reason: string;
  monthlyDiscount?: number;
  updatedAt?: number;
}

const pushFeeWaiverEntryToServer = (sId: string, entry: FeeWaiverEntry) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FREE_STUDENTS_UPDATED_EVENT, {
      detail: {
        studentId: sId,
        isFree: entry.isFree,
        reason: entry.reason,
        monthlyDiscount: entry.monthlyDiscount || 0,
      },
    })
  );
  let appsScriptUrl: string | undefined;
  try {
    const storedUrl = localStorage.getItem('evs_apps_script_url');
    if (storedUrl && storedUrl.trim().startsWith('http')) appsScriptUrl = storedUrl.trim();
  } catch {}
  fetch('/api/fee-waivers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: sId,
      isFree: entry.isFree,
      reason: entry.reason,
      monthlyDiscount: Math.max(0, Math.round(Number(entry.monthlyDiscount) || 0)),
      updatedAt: entry.updatedAt || Date.now(),
      appsScriptUrl,
    }),
  }).catch(() => {});
};

export const tagStudentWaiver = (
  studentId: string,
  isFree: boolean,
  reason: string = 'Tuition Fee Waived (केवल ट्यूशन फीस माफ)',
  monthlyDiscount?: number
) => {
  try {
    const sId = studentId.toLowerCase().trim();
    const updatedAt = Date.now();
    const savedMap = localStorage.getItem('evs_free_students_map');
    const map: Record<string, FeeWaiverEntry> = savedMap ? JSON.parse(savedMap) : {};
    const prev = map[sId];
    const nextMonthlyDiscount =
      monthlyDiscount !== undefined
        ? Math.max(0, Math.round(Number(monthlyDiscount) || 0))
        : Math.max(0, Math.round(Number(prev?.monthlyDiscount) || 0));
    const entry: FeeWaiverEntry = {
      isFree,
      reason,
      monthlyDiscount: nextMonthlyDiscount,
      updatedAt,
    };
    map[sId] = entry;
    saveToPhoneMemory('evs_free_students_map', map);
    pushFeeWaiverEntryToServer(sId, entry);
  } catch (e) {
    console.warn('Could not save free student map:', e);
  }
};

/**
 * Set or clear a permanent per-student monthly tuition discount (e.g. ₹50 / ₹100 / custom)
 */
export const tagStudentMonthlyDiscount = (
  studentId: string,
  monthlyDiscount: number,
  reason?: string
) => {
  try {
    const sId = studentId.toLowerCase().trim();
    const updatedAt = Date.now();
    const cleanAmt = Math.max(0, Math.round(Number(monthlyDiscount) || 0));
    const savedMap = localStorage.getItem('evs_free_students_map');
    const map: Record<string, FeeWaiverEntry> = savedMap ? JSON.parse(savedMap) : {};
    const prev = map[sId];
    const keepIsFree = Boolean(prev?.isFree && cleanAmt === 0);
    const nextReason =
      reason !== undefined
        ? reason
        : cleanAmt > 0
        ? `स्थायी मासिक छूट ₹${cleanAmt}/माह`
        : keepIsFree
        ? (prev?.reason || 'Tuition Fee Waived (केवल ट्यूशन फीस माफ)')
        : '';
    const entry: FeeWaiverEntry = {
      isFree: cleanAmt > 0 ? false : Boolean(prev?.isFree),
      reason: nextReason,
      monthlyDiscount: cleanAmt,
      updatedAt,
    };
    map[sId] = entry;
    saveToPhoneMemory('evs_free_students_map', map);
    pushFeeWaiverEntryToServer(sId, entry);
  } catch (e) {
    console.warn('Could not save monthly discount:', e);
  }
};

/**
 * Fetch Fee_Waivers directly from Google Sheet via GViz (Read fallback even if Apps Script isn't updated yet)
 */
export const fetchFeeWaiversDirectGViz = async (
  spreadsheetId: string = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU'
): Promise<Record<string, FeeWaiverEntry> | null> => {
  const tabCandidates = ['Fee_Waivers', 'Fee Waivers', 'FeeWaivers'];
  for (const sheetName of tabCandidates) {
    try {
      const encoded = encodeURIComponent(sheetName);
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encoded}&_t=${Date.now()}`);
      if (!res.ok) continue;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) continue;
      const data = JSON.parse(text.slice(start, end + 1));
      const rawCols = (data.table?.cols || []).map((c: any) => String(c?.label || '').trim().toLowerCase());
      const rawRows = data.table?.rows || [];
      if (rawRows.length === 0) continue;

      let headerList = rawCols;
      let startRowIdx = 0;
      const firstRowCells = (rawRows[0]?.c || []).map((cell: any) => String(cell?.v ?? '').trim().toLowerCase());
      const colsHaveHeaders = headerList.some((c: string) => c.includes('student_id') || c === 'is_free' || c === 'fee_waiver');
      const rowHasHeaders = firstRowCells.some((c: string) => c.includes('student_id') || c === 'is_free' || c === 'fee_waiver');

      if (!colsHaveHeaders && rowHasHeaders) {
        headerList = firstRowCells;
        startRowIdx = 1;
      } else if (colsHaveHeaders && rowHasHeaders && firstRowCells[0] === 'student_id') {
        startRowIdx = 1;
      }

      // Guard: Reject unrelated tabs (GViz returns first tab like Students/Users if sheetName missing!)
      if (headerList.some((c: string) => c.includes('password') || c.includes('user_id') || c.includes('father_name') || c.includes('receipt'))) {
        continue;
      }
      const idIdx = headerList.findIndex((c: string) => c === 'student_id' || c === 'id');
      const freeIdx = headerList.findIndex((c: string) => c === 'is_free' || c === 'fee_waiver' || c === 'is_free_student' || c.includes('waiv'));
      if (idIdx === -1 || freeIdx === -1) continue;

      const reasonIdx = headerList.findIndex((c: string) => c.includes('reason') || c.includes('remark'));
      const updAtIdx = headerList.findIndex((c: string) => c === 'updated_at');
      const updTsIdx = headerList.findIndex((c: string) => c === 'updated_ts');
      const discIdx = headerList.findIndex((c: string) => c === 'monthly_discount' || c === 'monthlydiscount' || c === 'discount');

      const result: Record<string, FeeWaiverEntry> = {};
      for (let r = startRowIdx; r < rawRows.length; r++) {
        const cells = (rawRows[r].c || []).map((c: any) => c?.v);
        const sid = String(cells[idIdx] || '').trim().toLowerCase();
        if (!sid || sid === 'student_id') continue;
        const rawFree = cells[freeIdx];
        const freeStr = String(rawFree ?? '').trim().toLowerCase();
        const isFree =
          rawFree === true ||
          freeStr === 'true' ||
          freeStr === 'yes' ||
          freeStr === '1' ||
          /(free|waiv|माफ)/i.test(freeStr);
        const reason = reasonIdx !== -1 ? String(cells[reasonIdx] || '') : '';
        const monthlyDiscount = discIdx !== -1 ? Math.max(0, Math.round(Number(cells[discIdx]) || 0)) : 0;
        let tsNum = updTsIdx !== -1 ? Number(cells[updTsIdx]) : 0;
        if ((!tsNum || isNaN(tsNum)) && updAtIdx !== -1 && cells[updAtIdx]) {
          const parsed = Date.parse(String(cells[updAtIdx]));
          if (!isNaN(parsed)) tsNum = parsed;
        }
        result[sid] = {
          isFree,
          reason,
          monthlyDiscount,
          updatedAt: tsNum && !isNaN(tsNum) ? tsNum : 0,
        };
      }
      return result;
    } catch {}
  }
  return null;
};

/**
 * Synchronize Fee Waivers between Phone Memory, backend server, and Google Sheet ('Fee_Waivers' tab)
 * so pending dues & waiver status never drift across Mobile, Desktop, or server restarts.
 */
export const syncFeeWaiversWithServer = async (
  force = false
): Promise<{ total: number; sheetSynced: boolean }> => {
  if (typeof window === 'undefined') return { total: 0, sheetSynced: false };
  try {
    let localMap: Record<string, FeeWaiverEntry> = {};
    try {
      const raw = localStorage.getItem('evs_free_students_map');
      if (raw) localMap = JSON.parse(raw) || {};
    } catch {}

    let appsScriptParam = '';
    try {
      const storedUrl = localStorage.getItem('evs_apps_script_url');
      if (storedUrl && storedUrl.trim().startsWith('http')) {
        appsScriptParam = `&appsScriptUrl=${encodeURIComponent(storedUrl.trim())}`;
      }
    } catch {}

    const [serverResp, gvizMap] = await Promise.all([
      fetch(`/api/fee-waivers?_t=${Date.now()}${force ? '&fresh=1' : ''}${appsScriptParam}`).catch(() => null),
      fetchFeeWaiversDirectGViz().catch(() => null),
    ]);

    let serverMap: Record<string, FeeWaiverEntry> = {};
    let sheetSynced = false;
    if (serverResp && serverResp.ok) {
      const json = await serverResp.json();
      serverMap = (json && json.waivers) || {};
      sheetSynced = Boolean(json && json.sheetSynced);
    }

    // Merge direct GViz 'Fee_Waivers' rows into serverMap if Apps Script didn't already supply newer rows
    if (gvizMap) {
      sheetSynced = true;
      (Object.entries(gvizMap) as Array<[string, FeeWaiverEntry]>).forEach(([id, gv]) => {
        const srv = serverMap[id];
        const gvTs = Number(gv.updatedAt) || 0;
        const srvTs = Number(srv?.updatedAt) || 0;
        if (!srv || gvTs > srvTs) {
          serverMap[id] = gv;
        }
      });
    }

    const merged: Record<string, FeeWaiverEntry> = {};
    const allIds = new Set([...Object.keys(localMap), ...Object.keys(serverMap)]);
    let localChanged = false;
    const entriesToPush: Record<string, FeeWaiverEntry> = {};

    allIds.forEach((rawId) => {
      const id = String(rawId || '').trim().toLowerCase();
      if (!id) return;
      const loc = localMap[rawId] || localMap[id];
      const srv = serverMap[id];

      if (loc && srv) {
        const locTs = Number(loc.updatedAt) || 0;
        const srvTs = Number(srv.updatedAt) || 0;
        const locDisc = Math.max(0, Math.round(Number(loc.monthlyDiscount) || 0));
        const srvDisc = Math.max(0, Math.round(Number(srv.monthlyDiscount) || 0));
        if (srvTs > locTs) {
          merged[id] = {
            ...srv,
            monthlyDiscount: srv.monthlyDiscount !== undefined ? srvDisc : locDisc,
          };
          if (loc.isFree !== srv.isFree || loc.reason !== srv.reason || locDisc !== srvDisc) {
            localChanged = true;
          }
        } else {
          merged[id] = {
            ...loc,
            monthlyDiscount: loc.monthlyDiscount !== undefined ? locDisc : srvDisc,
          };
          if (locTs > srvTs || loc.isFree !== srv.isFree || locDisc !== srvDisc) {
            entriesToPush[id] = {
              isFree: Boolean(loc.isFree),
              reason: String(loc.reason || ''),
              monthlyDiscount: merged[id].monthlyDiscount || 0,
              updatedAt: locTs || Date.now(),
            };
          }
        }
      } else if (srv) {
        merged[id] = {
          ...srv,
          monthlyDiscount: Math.max(0, Math.round(Number(srv.monthlyDiscount) || 0)),
        };
        localChanged = true;
      } else if (loc) {
        const ts = Number(loc.updatedAt) || Date.now();
        merged[id] = {
          ...loc,
          monthlyDiscount: Math.max(0, Math.round(Number(loc.monthlyDiscount) || 0)),
          updatedAt: ts,
        };
        entriesToPush[id] = merged[id];
      }
    });

    if (Object.keys(entriesToPush).length > 0 || (force && Object.keys(merged).length > 0)) {
      let appsScriptUrl: string | undefined;
      try {
        const storedUrl = localStorage.getItem('evs_apps_script_url');
        if (storedUrl && storedUrl.trim().startsWith('http')) appsScriptUrl = storedUrl.trim();
      } catch {}
      const payloadEntries = Object.keys(entriesToPush).length > 0 ? entriesToPush : merged;
      try {
        const pushRes = await fetch('/api/fee-waivers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries: payloadEntries, appsScriptUrl }),
        });
        if (pushRes.ok) {
          const pushJson = await pushRes.json();
          if (pushJson && pushJson.sheetSynced) sheetSynced = true;
        }
      } catch {}
    }

    if (localChanged || Object.keys(merged).length > 0) {
      await saveToPhoneMemory('evs_free_students_map', merged);
      if (localChanged) {
        window.dispatchEvent(new CustomEvent(FREE_STUDENTS_UPDATED_EVENT));
      }
    }
    return { total: Object.keys(merged).length, sheetSynced };
  } catch (e) {
    console.warn('Could not sync fee waivers with server:', e);
    return { total: 0, sheetSynced: false };
  }
};

/**
 * Auto-detect and pre-fill standard fee amount based on Class and Fee Type
 */
export const getStandardFeeAmount = (
  className?: string | null,
  feeType?: string | null,
  student?: Student | null
): number => {
  const normType = String(feeType || '').toLowerCase().trim();

  // If student is 100% fee waived, ONLY monthly tuition fee is 0. Admission, Books & Exam are charged!
  const isFree = student ? isFreeStudent(student).isFree : false;
  const isTuition = normType.includes('tuition') || normType.includes('शिक्षण') || normType.includes('monthly') || normType === '';
  if (isFree && isTuition) {
    return 0;
  }

  // If advance deposit, no standard billed amount
  if (normType.includes('advance') || normType.includes('अग्रिम')) {
    return 0;
  }

  // If student has explicit custom registered monthly fee in their record
  if (
    student &&
    (normType.includes('tuition') || normType.includes('शिक्षण') || normType.includes('monthly') || normType === '')
  ) {
    if (student.Monthly_Fee !== undefined && student.Monthly_Fee !== null && student.Monthly_Fee !== '') {
      const num = Number(student.Monthly_Fee);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  const classKey = normalizeClassKey(className || (student ? student.Class : ''));
  const activeMaster = getActiveFeeMasterConfig();
  const config = activeMaster[classKey] || DEFAULT_FEE_CONFIG;

  if (normType.includes('admission') || normType.includes('प्रवेश')) {
    return config.admissionFee;
  }
  if (normType.includes('exam') || normType.includes('परीक्षा')) {
    return config.examFee;
  }
  if (normType.includes('book') || normType.includes('पुस्तक') || normType.includes('stationary')) {
    return config.booksFee;
  }

  // Default to monthly tuition
  return config.monthlyTuition;
};

/**
 * Academic session months list in chronological order
 */
export const ACADEMIC_SESSION_MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March'
];

/**
 * Itemized Month allocation simulation for Lump-sum Multi-Month Payments
 */
export interface MonthPaymentAllocation {
  periodName: string;
  headType: string;
  billedAmount: number;
  allocatedAmount: number;
  remainingDue: number;
  status: 'SETTLED' | 'PARTIAL' | 'UNPAID';
}

export interface MultiMonthDistributionResult {
  allocations: MonthPaymentAllocation[];
  totalDuesCovered: number;
  advanceExcess: number;
  coveredMonthsSummary: string;
  fullyPaidMonths: string[];
  partialMonthNote?: string;
}

/**
 * Simulates chronological allocation of a lump-sum payment against pending student dues
 */
export const simulateMultiMonthPaymentDistribution = (
  pendingItems: Array<{ periodName: string; headType: string; dueAmount: number }>,
  lumpSumPaid: number,
  discountAmount: number = 0
): MultiMonthDistributionResult => {
  let remainingPaid = Math.max(0, lumpSumPaid);
  let remainingDiscount = Math.max(0, discountAmount);

  const allocations: MonthPaymentAllocation[] = [];
  const fullyPaidMonths: string[] = [];
  let partialMonthNote = '';

  for (const item of pendingItems) {
    let grossDue = Math.max(0, item.dueAmount);

    // Apply discount chronologically first
    let appliedDiscount = 0;
    if (remainingDiscount > 0 && grossDue > 0) {
      appliedDiscount = Math.min(grossDue, remainingDiscount);
      grossDue -= appliedDiscount;
      remainingDiscount -= appliedDiscount;
    }

    if (grossDue <= 0) {
      allocations.push({
        periodName: item.periodName,
        headType: item.headType,
        billedAmount: item.dueAmount,
        allocatedAmount: 0,
        remainingDue: 0,
        status: 'SETTLED',
      });
      fullyPaidMonths.push(item.periodName);
      continue;
    }

    if (remainingPaid >= grossDue) {
      // Fully settles this item
      allocations.push({
        periodName: item.periodName,
        headType: item.headType,
        billedAmount: item.dueAmount,
        allocatedAmount: grossDue,
        remainingDue: 0,
        status: 'SETTLED',
      });
      fullyPaidMonths.push(item.periodName);
      remainingPaid -= grossDue;
    } else if (remainingPaid > 0) {
      // Partially settles this item
      const allocated = remainingPaid;
      const rem = grossDue - allocated;
      allocations.push({
        periodName: item.periodName,
        headType: item.headType,
        billedAmount: item.dueAmount,
        allocatedAmount: allocated,
        remainingDue: rem,
        status: 'PARTIAL',
      });
      partialMonthNote = `${item.periodName}: ₹${allocated.toLocaleString('en-IN')} (आंशिक / शेष ₹${rem.toLocaleString('en-IN')})`;
      remainingPaid = 0;
    } else {
      // Unpaid
      allocations.push({
        periodName: item.periodName,
        headType: item.headType,
        billedAmount: item.dueAmount,
        allocatedAmount: 0,
        remainingDue: grossDue,
        status: 'UNPAID',
      });
    }
  }

  // Summary generation
  let summaryParts: string[] = [];
  if (fullyPaidMonths.length > 0) {
    summaryParts.push(`${fullyPaidMonths.join(', ')} (पूर्ण चुकता)`);
  }
  if (partialMonthNote) {
    summaryParts.push(partialMonthNote);
  }
  if (remainingPaid > 0) {
    summaryParts.push(`अग्रिम (Advance): ₹${remainingPaid.toLocaleString('en-IN')}`);
  }

  const coveredMonthsSummary = summaryParts.length > 0 ? summaryParts.join(' • ') : 'कोई देय चुकता नहीं';

  return {
    allocations,
    totalDuesCovered: lumpSumPaid - remainingPaid,
    advanceExcess: remainingPaid,
    coveredMonthsSummary,
    fullyPaidMonths,
    partialMonthNote: partialMonthNote || undefined,
  };
};

/**
 * Production-ready Google Apps Script backend code for Automated Fee Generation
 * and Fee Management in Google Sheets (Code.gs).
 * Includes generateMonthlyDues() running on 1st of every month.
 */
export const APPS_SCRIPT_FEE_CODE = `// ====================================================================
// E.V.S. PUBLIC SCHOOL - AUTOMATED FEE MANAGEMENT & DUES GENERATION
// Google Apps Script (Code.gs)
// Spreadsheet ID: 1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU
// ====================================================================

var SPREADSHEET_ID = "1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU";

/**
 * Standard Fee Structure per Class
 */
var FEE_MASTER = {
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

// Academic Session Months order (April = 1 ... March = 12)
var ACADEMIC_MONTHS = [
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "January", "February", "March"
];

function getAcademicMonthIndex(monthStr) {
  if (!monthStr) return 1;
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
  var calMonth = d.getMonth();
  return calMonth >= 3 ? (calMonth - 2) : (calMonth + 10);
}

/**
 * BACKEND FUNCTION: PAST MONTHS BACKFILL FUNCTION
 * generatePastDues() backfills billing rows for all active students from their
 * respective Session_Start_Month up to the current running month.
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
      "Total_Amount", "Discount_Amount", "Net_Payable", "Amount_Paid",
      "Balance_Amount", "Payment_Mode", "Received_By"
    ]);
  }

  var today = new Date();
  var curAcadIdx = getCurrentAcademicMonthIndex(today);
  var curYear = today.getFullYear();
  var dateStr = Utilities.formatDate(today, "Asia/Kolkata", "yyyy-MM-dd");

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

  var waiverSheet = ss.getSheetByName("Fee_Waivers");
  var waiverTabMap = {};
  if (waiverSheet && waiverSheet.getLastRow() >= 2) {
    var wData = waiverSheet.getDataRange().getValues();
    for (var wi = 1; wi < wData.length; wi++) {
      var wSid = String(wData[wi][0] || "").trim().toLowerCase();
      var wFlag = String(wData[wi][1] || "").trim().toLowerCase();
      if (wSid) {
        waiverTabMap[wSid] = (wData[wi][1] === true || wFlag === "true" || wFlag === "yes" || wFlag === "1");
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

    var isFree = false;
    var normSid = sId.toLowerCase();
    if (waiverTabMap[normSid] !== undefined) {
      isFree = waiverTabMap[normSid];
    } else {
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
    }

    if (isFree) {
      skippedStudentsCount++;
      continue;
    }

    var studentStartMonthStr = startMonthIdx !== -1 ? String(row[startMonthIdx] || "").trim() : "";
    if (!studentStartMonthStr) {
      studentStartMonthStr = "April"; // Default to April if missing or blank
    }
    var studentStartMonthIdx = getAcademicMonthIndex(studentStartMonthStr);

    var sClass = classIdx !== -1 ? String(row[classIdx] || "").toLowerCase().trim() : "nursery";
    var customFee = monthlyFeeIdx !== -1 ? Number(row[monthlyFeeIdx]) : 0;
    var monthlyAmount = 600;

    if (!isNaN(customFee) && customFee > 0) {
      monthlyAmount = customFee;
    } else if (FEE_MASTER[sClass] !== undefined) {
      monthlyAmount = FEE_MASTER[sClass];
    } else {
      for (var k in FEE_MASTER) {
        if (sClass.indexOf(k) !== -1) {
          monthlyAmount = FEE_MASTER[k];
          break;
        }
      }
    }

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
        receiptNo,                  // 0: Col A Receipt_Number
        sId,                        // 1: Col B Student_ID
        dateStr,                    // 2: Col C Date
        "Monthly Tuition Fee",      // 3: Col D Fee_Type
        monthName,                  // 4: Col E Month
        monthlyAmount,              // 5: Col F Total_Amount
        0,                          // 6: Col G Discount
        monthlyAmount,              // 7: Col H Net_Payable / extra
        0,                          // 8: Col I Amount_Paid (Must be 0 for due!)
        monthlyAmount,              // 9: Col J Balance_Amount (Must be monthlyAmount!)
        "Due",                      // 10: Col K Payment_Mode ("Due")
        "System Backfill",          // 11: Col L Received_By
        "generatePastDues"          // 12: Col M Remarks
      ]);

      existingBilledMap[mapKey] = true;
      totalBilledRows++;
    }
  }

  if (rowsToAppend.length > 0) {
    var startRow = feeSheet.getLastRow() + 1;
    feeSheet.getRange(startRow, 1, rowsToAppend.length, 13).setValues(rowsToAppend);
  }

  return {
    status: "success",
    message: "generatePastDues complete: Appended " + totalBilledRows + " billing rows.",
    billedRowsCount: totalBilledRows
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
    var paid = Number(row[7]) || 0; // Amount_Paid (Index 7)
    var total = Number(row[5]) || 0; // Total_Amount (Index 5)
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
 * Runs on 1st of every month. Checks Current_Running_Month >= Student's Session_Start_Month and !isFree.
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

  var studentsData = studentsSheet.getDataRange().getValues();
  if (studentsData.length <= 1) {
    Logger.log("No student records found in Students sheet.");
    return { status: "empty", count: 0 };
  }

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

  var feeData = feeSheet.getDataRange().getValues();
  var billedMap = {};
  for (var f = 1; f < feeData.length; f++) {
    var fSid = String(feeData[f][1] || "").trim().toLowerCase();
    var fMonth = String(feeData[f][4] || "").trim().toLowerCase();
    var fType = String(feeData[f][3] || "").trim().toLowerCase();
    if (fMonth.indexOf(curMonthName.toLowerCase()) !== -1 && (fType.indexOf("monthly") !== -1 || fType.indexOf("मासिक") !== -1 || fType.indexOf("tuition") !== -1 || fType.indexOf("due") !== -1)) {
      billedMap[fSid] = true;
    }
  }

  var waiverSheet = ss.getSheetByName("Fee_Waivers");
  var waiverTabMap = {};
  if (waiverSheet && waiverSheet.getLastRow() >= 2) {
    var wData = waiverSheet.getDataRange().getValues();
    for (var wi = 1; wi < wData.length; wi++) {
      var wSid = String(wData[wi][0] || "").trim().toLowerCase();
      var wFlag = String(wData[wi][1] || "").trim().toLowerCase();
      if (wSid) {
        waiverTabMap[wSid] = (wData[wi][1] === true || wFlag === "true" || wFlag === "yes" || wFlag === "1");
      }
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

    var isFree = false;
    var normSid = sId.toLowerCase();
    if (waiverTabMap[normSid] !== undefined) {
      isFree = waiverTabMap[normSid];
    } else {
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
    }

    if (isFree) {
      skippedFreeCount++;
      continue;
    }

    var studentStartMonthStr = startMonthIdx !== -1 ? String(row[startMonthIdx] || "").trim() : "April";
    var studentStartMonthIdx = getAcademicMonthIndex(studentStartMonthStr);

    if (curAcadIdx < studentStartMonthIdx) {
      skippedNotStartedCount++;
      continue;
    }

    if (billedMap[sId.toLowerCase()]) {
      alreadyBilledCount++;
      continue;
    }

    var sClass = classIdx !== -1 ? String(row[classIdx] || "").toLowerCase().trim() : "nursery";
    var customFee = monthlyFeeIdx !== -1 ? Number(row[monthlyFeeIdx]) : 0;
    var monthlyAmount = 600;

    if (!isNaN(customFee) && customFee > 0) {
      monthlyAmount = customFee;
    } else if (FEE_MASTER[sClass] !== undefined) {
      monthlyAmount = FEE_MASTER[sClass];
    } else {
      for (var k in FEE_MASTER) {
        if (sClass.indexOf(k) !== -1) {
          monthlyAmount = FEE_MASTER[k];
          break;
        }
      }
    }

    var receiptNo = "BILL-" + curYear + "-M" + curAcadIdx + "-" + sId;
    rowsToAppend.push([
      receiptNo,                     // 0: Col A Receipt_Number
      sId,                           // 1: Col B Student_ID
      dateStr,                       // 2: Col C Date
      "Monthly Tuition Fee",         // 3: Col D Fee_Type
      curMonthName,                  // 4: Col E Month
      monthlyAmount,                 // 5: Col F Total_Amount
      0,                             // 6: Col G Discount
      monthlyAmount,                 // 7: Col H Net_Payable / extra
      0,                             // 8: Col I Amount_Paid (Must be 0 for due!)
      monthlyAmount,                 // 9: Col J Balance_Amount (Must be monthlyAmount!)
      "Due",                         // 10: Col K Payment_Mode ("Due")
      "System Auto-Bill",            // 11: Col L Received_By
      "Automated Monthly Bill (Due)" // 12: Col M Remarks
    ]);

    billedMap[sId.toLowerCase()] = true;
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
  return { status: "success", message: "Trigger installed for 1st of every month!" };
}
`;
