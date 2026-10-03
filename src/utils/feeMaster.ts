import { Student, FeeCollectionRecord } from '../types';

/**
 * Standard Fee Structure per Class
 */
export interface ClassFeeConfig {
  monthlyTuition: number;
  admissionFee: number;
  examFee: number;
  annualFee: number;
  transportFee: number;
  booksFee: number;
  uniformFee: number;
  lateFine: number;
}

export const FEE_MASTER_CONFIG: Record<string, ClassFeeConfig> = {
  // Pre-Primary
  'play': {
    monthlyTuition: 500,
    admissionFee: 1500,
    examFee: 300,
    annualFee: 1000,
    transportFee: 500,
    booksFee: 800,
    uniformFee: 800,
    lateFine: 50,
  },
  'nursery': {
    monthlyTuition: 600,
    admissionFee: 1500,
    examFee: 300,
    annualFee: 1000,
    transportFee: 500,
    booksFee: 1000,
    uniformFee: 800,
    lateFine: 50,
  },
  'lkg': {
    monthlyTuition: 600,
    admissionFee: 1500,
    examFee: 300,
    annualFee: 1000,
    transportFee: 500,
    booksFee: 1000,
    uniformFee: 800,
    lateFine: 50,
  },
  'ukg': {
    monthlyTuition: 600,
    admissionFee: 1500,
    examFee: 300,
    annualFee: 1000,
    transportFee: 500,
    booksFee: 1000,
    uniformFee: 800,
    lateFine: 50,
  },
  // Primary Classes
  '1st': {
    monthlyTuition: 650,
    admissionFee: 2000,
    examFee: 400,
    annualFee: 1200,
    transportFee: 600,
    booksFee: 1200,
    uniformFee: 900,
    lateFine: 50,
  },
  '2nd': {
    monthlyTuition: 650,
    admissionFee: 2000,
    examFee: 400,
    annualFee: 1200,
    transportFee: 600,
    booksFee: 1200,
    uniformFee: 900,
    lateFine: 50,
  },
  '3rd': {
    monthlyTuition: 650,
    admissionFee: 2000,
    examFee: 400,
    annualFee: 1200,
    transportFee: 600,
    booksFee: 1200,
    uniformFee: 900,
    lateFine: 50,
  },
  '4th': {
    monthlyTuition: 700,
    admissionFee: 2000,
    examFee: 400,
    annualFee: 1200,
    transportFee: 600,
    booksFee: 1400,
    uniformFee: 900,
    lateFine: 50,
  },
  '5th': {
    monthlyTuition: 700,
    admissionFee: 2000,
    examFee: 400,
    annualFee: 1200,
    transportFee: 600,
    booksFee: 1400,
    uniformFee: 900,
    lateFine: 50,
  },
  // Upper Primary / Middle Classes
  '6th': {
    monthlyTuition: 800,
    admissionFee: 2500,
    examFee: 500,
    annualFee: 1500,
    transportFee: 700,
    booksFee: 1600,
    uniformFee: 1000,
    lateFine: 100,
  },
  '7th': {
    monthlyTuition: 800,
    admissionFee: 2500,
    examFee: 500,
    annualFee: 1500,
    transportFee: 700,
    booksFee: 1600,
    uniformFee: 1000,
    lateFine: 100,
  },
  '8th': {
    monthlyTuition: 850,
    admissionFee: 2500,
    examFee: 500,
    annualFee: 1500,
    transportFee: 700,
    booksFee: 1800,
    uniformFee: 1000,
    lateFine: 100,
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
  monthlyTuition: 600,
  admissionFee: 2000,
  examFee: 400,
  annualFee: 1200,
  transportFee: 600,
  booksFee: 1200,
  uniformFee: 900,
  lateFine: 50,
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
    console.warn('Could not fetch Fee Master from Google Sheet:', e);
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
  if (normType.includes('annual') || normType.includes('वार्षिक')) {
    return config.annualFee;
  }
  if (normType.includes('transport') || normType.includes('bus') || normType.includes('वाहन')) {
    return config.transportFee;
  }
  if (normType.includes('book') || normType.includes('पुस्तक') || normType.includes('stationary')) {
    return config.booksFee;
  }
  if (normType.includes('uniform') || normType.includes('यूनिफॉर्म')) {
    return config.uniformFee;
  }
  if (normType.includes('late') || normType.includes('fine') || normType.includes('विलंब')) {
    return config.lateFine;
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

/**
 * AUTOMATIC MONTHLY FEE GENERATION
 * Trigger: Runs automatically on the 1st of every month via Time-Driven Trigger.
 * 1. Iterates active students in 'Students' sheet.
 * 2. Checks 'Fee_Waiver' / '100% Free' / 'RTE' flag.
 * 3. Skips 100% Fee Waived students automatically.
 * 4. Checks 'Fee_Collection' to prevent duplicate billing for current month.
 * 5. Appends monthly tuition dues with standard or custom student monthly fee.
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
  var monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  var curMonthName = monthNames[today.getMonth()];
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
  var nameIdx = headers.indexOf("student_name");
  var classIdx = headers.indexOf("class");
  var monthlyFeeIdx = headers.indexOf("monthly_fee");
  var waiverIdx = headers.indexOf("fee_waiver");
  if (waiverIdx === -1) waiverIdx = headers.indexOf("is_free_student");
  var categoryIdx = headers.indexOf("category");
  var remarkIdx = headers.indexOf("remark");

  // Load existing fee records to prevent duplicate billing
  var feeData = feeSheet.getDataRange().getValues();
  var billedMap = {};
  for (var f = 1; f < feeData.length; f++) {
    var fSid = String(feeData[f][1] || "").trim().toLowerCase();
    var fMonth = String(feeData[f][4] || "").trim().toLowerCase();
    var fType = String(feeData[f][3] || "").trim().toLowerCase();
    if (fMonth.indexOf(curMonthName.toLowerCase()) !== -1 && (fType.indexOf("monthly") !== -1 || fType.indexOf("मासिक") !== -1)) {
      billedMap[fSid] = true;
    }
  }

  var generatedCount = 0;
  var skippedFreeCount = 0;
  var alreadyBilledCount = 0;

  for (var i = 1; i < studentsData.length; i++) {
    var row = studentsData[i];
    var sId = idIdx !== -1 ? String(row[idIdx] || "").trim() : "";
    if (!sId) continue;

    // Check if student has 100% Fee Waiver (Free Student)
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

    // Skip if already billed for this month
    if (billedMap[sId.toLowerCase()]) {
      alreadyBilledCount++;
      continue;
    }

    // Determine Monthly Tuition amount
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

    var receiptNo = "BILL-" + curYear + "-" + (today.getMonth() + 1) + "-" + sId;
    feeSheet.appendRow([
      receiptNo,
      sId,
      dateStr,
      "Monthly Tuition Fee",
      curMonthName,
      monthlyAmount, // Total_Amount
      0,             // Discount_Amount
      monthlyAmount, // Net_Payable
      0,             // Amount_Paid (Unpaid obligation)
      monthlyAmount, // Balance_Amount
      "System Auto-Bill",
      "Automated Trigger (1st of Month)"
    ]);

    billedMap[sId.toLowerCase()] = true;
    generatedCount++;
  }

  var msg = "generateMonthlyDues complete for " + curMonthName + " " + curYear +
            ": Billed: " + generatedCount +
            ", Skipped Free: " + skippedFreeCount +
            ", Already Billed: " + alreadyBilledCount;
  Logger.log(msg);

  return {
    status: "success",
    message: msg,
    month: curMonthName + " " + curYear,
    generatedCount: generatedCount,
    skippedFreeCount: skippedFreeCount,
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
