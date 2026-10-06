import { Student, FeeCollectionRecord } from '../types';

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
  // Pre-Primary
  'play': {
    admissionFee: 1500,
    monthlyTuition: 500,
    examFee: 300,
    booksFee: 800,
  },
  'nursery': {
    admissionFee: 1500,
    monthlyTuition: 600,
    examFee: 300,
    booksFee: 1000,
  },
  'lkg': {
    admissionFee: 1500,
    monthlyTuition: 600,
    examFee: 300,
    booksFee: 1000,
  },
  'ukg': {
    admissionFee: 1500,
    monthlyTuition: 600,
    examFee: 300,
    booksFee: 1000,
  },
  // Primary Classes
  '1st': {
    admissionFee: 2000,
    monthlyTuition: 650,
    examFee: 400,
    booksFee: 1200,
  },
  '2nd': {
    admissionFee: 2000,
    monthlyTuition: 650,
    examFee: 400,
    booksFee: 1200,
  },
  '3rd': {
    admissionFee: 2000,
    monthlyTuition: 650,
    examFee: 400,
    booksFee: 1200,
  },
  '4th': {
    admissionFee: 2000,
    monthlyTuition: 700,
    examFee: 400,
    booksFee: 1400,
  },
  '5th': {
    admissionFee: 2000,
    monthlyTuition: 700,
    examFee: 400,
    booksFee: 1400,
  },
  // Upper Primary / Middle Classes
  '6th': {
    admissionFee: 2500,
    monthlyTuition: 800,
    examFee: 500,
    booksFee: 1600,
  },
  '7th': {
    admissionFee: 2500,
    monthlyTuition: 800,
    examFee: 500,
    booksFee: 1600,
  },
  '8th': {
    admissionFee: 2500,
    monthlyTuition: 850,
    examFee: 500,
    booksFee: 1800,
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
  admissionFee: 2000,
  monthlyTuition: 600,
  examFee: 400,
  booksFee: 1200,
};

/**
 * Get active Fee Master configuration from localStorage or default seed
 */
export const getActiveFeeMasterConfig = (): Record<string, ClassFeeConfig> => {
  try {
    const saved = localStorage.getItem('evs_fee_master_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        return { ...FEE_MASTER_CONFIG, ...parsed };
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
    localStorage.setItem('evs_fee_master_config', JSON.stringify(newConfig));
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
  const tabCandidates = ['Fee_Maseter', 'Fee_Master', 'FeeMaster', 'Fee Master'];
  for (const sheetName of tabCandidates) {
    try {
      const encoded = encodeURIComponent(sheetName);
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encoded}`);
      if (!res.ok) continue;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) continue;
      const data = JSON.parse(text.slice(start, end + 1));
      const cols = (data.table?.cols || []).map((c: any) => String(c?.label || c?.id || '').trim().toLowerCase());

      const hasFeeCol = cols.some((c: string) => c.includes('class') || c.includes('admission') || c.includes('tution') || c.includes('tuition') || c.includes('fee'));
      if (!hasFeeCol) continue;

      const rows = data.table?.rows || [];
      const classIdx = cols.findIndex((c: string) => c.includes('class'));
      const admIdx = cols.findIndex((c: string) => c.includes('admission'));
      const tutionIdx = cols.findIndex((c: string) => c.includes('tution') || c.includes('tuition'));
      const examIdx = cols.findIndex((c: string) => c.includes('exam'));
      const booksIdx = cols.findIndex((c: string) => c.includes('book'));

      const result: Record<string, ClassFeeConfig> = {};
      for (const r of rows) {
        const cells = (r.c || []).map((c: any) => c?.v);
        const rawClass = String(cells[classIdx !== -1 ? classIdx : 0] || '').trim();
        if (!rawClass || rawClass.toLowerCase() === 'class') continue;

        const classKey = normalizeClassKey(rawClass);
        const rawAdm = Number(cells[admIdx !== -1 ? admIdx : 1]);
        const rawTut = Number(cells[tutionIdx !== -1 ? tutionIdx : 2]);
        const rawExam = Number(cells[examIdx !== -1 ? examIdx : 3]);
        const rawBooks = Number(cells[booksIdx !== -1 ? booksIdx : 4]);

        const defaultClassCfg = FEE_MASTER_CONFIG[classKey] || DEFAULT_FEE_CONFIG;
        result[classKey] = {
          admissionFee: !isNaN(rawAdm) && rawAdm > 0 ? rawAdm : defaultClassCfg.admissionFee,
          monthlyTuition: !isNaN(rawTut) && rawTut > 0 ? rawTut : defaultClassCfg.monthlyTuition,
          examFee: !isNaN(rawExam) && rawExam > 0 ? rawExam : defaultClassCfg.examFee,
          booksFee: !isNaN(rawBooks) && rawBooks > 0 ? rawBooks : defaultClassCfg.booksFee,
        };
      }

      if (Object.keys(result).length > 0) {
        saveActiveFeeMasterConfig(result);
        return result;
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

  if (s.includes('play')) return 'play';
  if (s.includes('nursery') || s.includes('m1') || s === 'c2') return 'nursery';
  if (s.includes('lkg') || s.includes('m2') || s === 'c3') return 'lkg';
  if (s.includes('ukg') || s.includes('m3') || s === 'c4') return 'ukg';
  if (s.includes('1st') || s.includes('1') || s === 'c5') return '1st';
  if (s.includes('2nd') || s.includes('2') || s === 'c6') return '2nd';
  if (s.includes('3rd') || s.includes('3') || s === 'c7') return '3rd';
  if (s.includes('4th') || s.includes('4') || s === 'c8') return '4th';
  if (s.includes('5th') || s.includes('5') || s === 'c9') return '5th';
  if (s.includes('6th') || s.includes('6') || s === 'c10') return '6th';
  if (s.includes('7th') || s.includes('7') || s === 'c11') return '7th';
  if (s.includes('8th') || s.includes('8') || s === 'c12') return '8th';

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

  // Check LocalStorage Tagged Waiver Map
  try {
    const savedMap = localStorage.getItem('evs_free_students_map');
    if (savedMap) {
      const map: Record<string, { isFree: boolean; reason: string }> = JSON.parse(savedMap);
      if (map[sId] && map[sId].isFree) {
        return { isFree: true, reason: map[sId].reason || '100% Fee Waived (स्कूल द्वारा फीस माफ)' };
      }
    }
  } catch {}

  // Explicit property on student record
  if (student.Is_Free_Student === true || String(student.Is_Free_Student).toLowerCase() === 'true') {
    return { isFree: true, reason: '100% Fee Waived (फीस माफ छात्र)' };
  }

  // Fee_Waiver column in Google Sheet
  const waiverVal = String(student.Fee_Waiver || student.fee_waiver || '').toLowerCase();
  if (waiverVal === 'true' || waiverVal === 'yes' || waiverVal.includes('100') || waiverVal.includes('free') || waiverVal.includes('माफ')) {
    return { isFree: true, reason: student.Fee_Waiver_Reason || '100% Fee Waived (शुल्क माफी अधिकृत)' };
  }

  // Category or remarks check
  const cat = String(student.Category || student.category || '').toLowerCase();
  const remark = String(student.Remark || student.remark || '').toLowerCase();
  if (cat.includes('rte') || cat.includes('free') || cat.includes('माफ') || remark.includes('फीस माफ') || remark.includes('100% waiver')) {
    return { isFree: true, reason: 'RTE / 100% Fee Waived (निःशुल्क प्रवेश श्रेणी)' };
  }

  return { isFree: false, reason: '' };
};

/**
 * Tag or untag a student with 100% Fee Waiver
 */
export const tagStudentWaiver = (
  studentId: string,
  isFree: boolean,
  reason: string = '100% Fee Waived (प्रबंधक द्वारा फीस माफ)'
) => {
  try {
    const sId = studentId.toLowerCase().trim();
    const savedMap = localStorage.getItem('evs_free_students_map');
    const map: Record<string, { isFree: boolean; reason: string }> = savedMap ? JSON.parse(savedMap) : {};
    map[sId] = { isFree, reason };
    localStorage.setItem('evs_free_students_map', JSON.stringify(map));
  } catch (e) {
    console.warn('Could not save free student map:', e);
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
  // If student is 100% fee waived, payable amount is strictly 0
  if (student && isFreeStudent(student).isFree) {
    return 0;
  }

  const normType = String(feeType || '').toLowerCase().trim();

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
  'play': 500,
  'nursery': 600,
  'lkg': 600,
  'ukg': 600,
  '1st': 650,
  '2nd': 650,
  '3rd': 650,
  '4th': 700,
  '5th': 700,
  '6th': 800,
  '7th': 800,
  '8th': 850
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

  var rowsToAppend = [];
  var totalBilledRows = 0;
  var skippedStudentsCount = 0;

  for (var i = 1; i < studentsData.length; i++) {
    var row = studentsData[i];
    var sId = idIdx !== -1 ? String(row[idIdx] || "").trim() : "";
    if (!sId) continue;

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
        receiptNo,
        sId,
        dateStr,
        "Monthly Tuition Fee",
        monthName,
        monthlyAmount,
        0,
        monthlyAmount,
        0,
        monthlyAmount,
        "System Backfill",
        "generatePastDues"
      ]);

      existingBilledMap[mapKey] = true;
      totalBilledRows++;
    }
  }

  if (rowsToAppend.length > 0) {
    var startRow = feeSheet.getLastRow() + 1;
    feeSheet.getRange(startRow, 1, rowsToAppend.length, 12).setValues(rowsToAppend);
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
      receiptNo,
      sId,
      dateStr,
      "Monthly Tuition Fee",
      curMonthName,
      monthlyAmount,
      0,
      monthlyAmount,
      0,
      monthlyAmount,
      "System Auto-Bill",
      "Automated Trigger (1st of Month)"
    ]);

    billedMap[sId.toLowerCase()] = true;
    generatedCount++;
  }

  if (rowsToAppend.length > 0) {
    var startRow = feeSheet.getLastRow() + 1;
    feeSheet.getRange(startRow, 1, rowsToAppend.length, 12).setValues(rowsToAppend);
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
