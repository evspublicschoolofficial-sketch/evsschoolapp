import { Student, FeeCollectionRecord } from '../types';
import {
  DEFAULT_FEE_CONFIG,
  getActiveFeeMasterConfig,
  getStudentMonthlyDiscount,
  isFreeStudent,
  normalizeClassKey,
} from './feeMaster';

export interface StudentFeeMetrics {
  totalSessionFee: number; // Unique billed total fee (till current month, including books/exam/uniform if billed)
  fullYearFee?: number;    // Full 12-month session fee
  monthlyTuition?: number; // Detected monthly tuition (gross)
  monthlyDiscount?: number; // Permanent per-month tuition discount (₹50 / ₹100 / custom)
  netMonthlyTuition?: number; // Net monthly tuition after permanent discount
  admissionFee?: number;   // Standard or custom admission fee
  admissionPaid?: number;  // Paid toward admission fee
  admissionDue?: number;   // Balance due on admission fee
  tuitionBilled?: number;  // Monthly tuition billed till running month
  tuitionPaid?: number;    // Paid toward monthly tuition
  tuitionDue?: number;     // Balance due on monthly tuition
  otherBilledFees?: number;// Non-tuition fees billed (Books & Stationery, Exam, Uniform, etc.)
  itemizedOtherFees?: Array<{ type: string; amount: number; paid: number; balance: number }>;
  totalPaid: number;       // SUM of Amount_Paid
  totalDiscount: number;   // SUM of discounts / concessions applied
  dueBalance: number;      // totalSessionFee - totalPaid - totalDiscount (negative if advance, e.g. 600 - 700 = -100)
  hasDues: boolean;        // dueBalance > 0
  isAdvance: boolean;      // dueBalance < 0
  advanceAmount: number;   // Math.abs(dueBalance) if isAdvance else 0
  receiptsCount: number;
  startMonth?: string;
  currentMonth?: string;
  elapsedMonths?: number;
}

export interface SchoolFeeTotals {
  totalReceipts: number;
  totalCollected: number;
  totalPendingDues: number;
  totalDiscounts: number;
  totalAdvance: number;
  totalBilled: number;
  totalWaivedStudents: number;
  totalWaivedAmountTillDate: number;
  totalAnnualWaivedAmount: number;
}

export interface WaivedStudentDetail {
  student: Student;
  reason: string;
  startMonth: string;
  currentMonth: string;
  elapsedMonths: number;
  monthlyTuitionRate: number;
  tuitionWaivedTillDate: number;
  admissionWaived: number;
  totalWaivedTillDate: number;
  annualWaivedTotal: number;
  otherChargedFees: number;
  totalPaidByStudent: number;
  remainingDueOnOtherFees: number;
}

export interface WaivedStudentsSummary {
  totalWaivedStudents: number;
  totalWaivedAmountTillDate: number;
  totalAnnualWaivedAmount: number;
  totalTuitionWaivedTillDate: number;
  totalAdmissionWaived: number;
  waivedStudents: WaivedStudentDetail[];
}

/**
 * Normalizes student ID for comparison
 */
export const normalizeStudentId = (id?: string | null): string => {
  return String(id || '').trim().toLowerCase();
};

/**
 * Reconciles fee records from Google Sheet:
 * In a real school sheet, there may be separate billing rows (Amount_Paid: 0)
 * and payment receipts (Total_Amount: 0 or Net_Payable: 0).
 * If both exist for the same student + month + fee_type, they represent the SAME obligation and payment!
 * Reconciling merges them into clean, accurate receipts so that:
 * - Paid amount is never shown as 0 if a payment exists
 * - Total amount is preserved from the billing row
 * - Balance is accurate (Total - Paid)
 * - Dummy uncollected duplicate rows for already-paid months do not clutter the view
 */
export const reconcileFeeRecords = (records: FeeCollectionRecord[]): FeeCollectionRecord[] => {
  if (!records || records.length === 0) return [];

  // Group by student id
  const byStudent = new Map<string, FeeCollectionRecord[]>();
  records.forEach((r) => {
    const sId = normalizeStudentId(r.Student_ID);
    if (!sId) return;
    if (!byStudent.has(sId)) byStudent.set(sId, []);
    byStudent.get(sId)!.push(r);
  });

  const reconciledList: FeeCollectionRecord[] = [];

  byStudent.forEach((stRecords) => {
    // Group records by periodKey (Month + Fee_Type)
    const periodMap = new Map<string, FeeCollectionRecord[]>();

    stRecords.forEach((r) => {
      const monthKey = String(r.Month || '').trim().toLowerCase();
      const typeKey = String(r.Fee_Type || '').trim().toLowerCase();
      const isSessionOneTime = /(admission|प्रवेश|book|पुस्तक|stationary)/i.test(typeKey);
      const isExam = /(exam|परीक्षा)/i.test(typeKey);
      const key = isSessionOneTime
        ? `onetime::${typeKey}`
        : isExam
        ? `exam::${typeKey}::${monthKey || 'general'}`
        : `${monthKey}::${typeKey || 'tuition'}`;

      if (!periodMap.has(key)) periodMap.set(key, []);
      periodMap.get(key)!.push(r);
    });

    periodMap.forEach((groupRecs) => {
      if (groupRecs.length === 1) {
        // Keep Total_Amount exactly as present in Google Sheet (do NOT overwrite with Amount_Paid for multi-month receipts)
        reconciledList.push(groupRecs[0]);
        return;
      }

      // Multiple records for the same month/head:
      const payments = groupRecs.filter((r) => (Number(r.Amount_Paid) || 0) > 0);
      const billings = groupRecs.filter((r) => (Number(r.Amount_Paid) || 0) === 0 && (Number(r.Total_Amount) || 0) > 0);

      if (payments.length > 0 && billings.length > 0) {
        // We have billing entry (Total > 0, Paid = 0) and payment receipt(s) (Paid > 0)
        // Consolidate into the payment receipt(s) so that the payment is visibly reflected
        const totalBilled = Math.max(...billings.map((b) => Number(b.Total_Amount) || 0));
        const totalPaidInGroup = payments.reduce((sum, p) => sum + (Number(p.Amount_Paid) || 0), 0);

        payments.forEach((p, idx) => {
          const authTotal = Number(p.Total_Amount) > 0 ? Number(p.Total_Amount) : totalBilled;
          const bal = Math.max(0, authTotal - totalPaidInGroup);
          reconciledList.push({
            ...p,
            Total_Amount: p.Total_Amount !== undefined ? p.Total_Amount : authTotal,
            Balance_Amount: idx === payments.length - 1 ? bal : 0,
          });
        });
        // The uncollected billing row with Paid: 0 is replaced by the actual payment receipt!
      } else {
        // All are payments or all are billings
        groupRecs.forEach((r) => reconciledList.push(r));
      }
    });
  });

  return reconciledList;
};

/**
 * Standard School Academic Session Months Array in Chronological Order
 */
export const ACADEMIC_MONTHS = [
  "April", "May", "June", "July", "August", "September",
  "October", "November", "December", "January", "February", "March"
];

/**
 * Standard Class Tuition Fee Map (Matching C1-C12 and Class Names)
 */
export const CLASS_TUITION_FEES: Record<string, number> = {
  c1: 350, play: 350,
  c2: 350, nursery: 350, m1: 350,
  c3: 350, lkg: 350, m2: 350,
  c4: 350, ukg: 350, m3: 350,
  c5: 400, '1st': 400, '1': 400,
  c6: 400, '2nd': 400, '2': 400,
  c7: 400, '3rd': 400, '3': 400,
  c8: 450, '4th': 450, '4': 450,
  c9: 450, '5th': 450, '5': 450,
  c10: 500, '6th': 500, '6': 500,
  c11: 500, '7th': 500, '7': 500,
  c12: 500, '8th': 500, '8': 500,
};

/**
 * Lookup Monthly Tuition Fee from Student profile or Class ID/name, or live Fee Master
 */
export const getStudentMonthlyTuition = (student?: any, studentReceipts?: FeeCollectionRecord[]): number => {
  if (!student) return 450;
  const custom = Number(student.Monthly_Fee || student.monthly_fee);
  if (!isNaN(custom) && custom > 0) return custom;

  // 1. Check live Fee Master configuration (synced directly from Fee_Maseter Google Sheet)
  try {
    const feeConfig = getActiveFeeMasterConfig();
    const classKey = normalizeClassKey(student.Class || student.class);
    if (feeConfig && feeConfig[classKey] && feeConfig[classKey].monthlyTuition > 0) {
      return feeConfig[classKey].monthlyTuition;
    }
  } catch {}

  // 2. Direct mapping from class identifier (C1-C12 or text)
  const rawClass = String(student.Class || student.class || '').trim().toLowerCase();
  if (CLASS_TUITION_FEES[rawClass] !== undefined) {
    return CLASS_TUITION_FEES[rawClass];
  }
  for (const key of Object.keys(CLASS_TUITION_FEES)) {
    if (rawClass.includes(key)) {
      return CLASS_TUITION_FEES[key];
    }
  }
  return 450;
};

/**
 * Check if student has 100% Fee Waiver (Free Student)
 * Checks both Google Sheet profile columns AND Manager's local fee-waiver tag map.
 */
export const isStudentFeeExempt = (student?: any): boolean => {
  if (!student) return false;
  return isFreeStudent(student).isFree;
};

/**
 * Dynamic Month Filter:
 * Identifies the Current Running Month (e.g., "October").
 * Calculates Elapsed Months count strictly from "Session_Start_Month" up to "Current_Month".
 * DOES NOT include future months (November to March) until those months arrive!
 */
export const getElapsedMonthsCount = (startMonthStr?: string): {
  elapsedMonths: number;
  currentAcadIdx: number;
  currentMonthName: string;
  startMonthIdx: number;
  startMonthName: string;
} => {
  const now = new Date();
  const calMonth = now.getMonth(); // 0 = Jan ... 9 = Oct
  // Academic index (1-indexed: April = 1 ... March = 12)
  const currentAcadIdx = calMonth >= 3 ? (calMonth - 2) : (calMonth + 10);
  const currentMonthName = ACADEMIC_MONTHS[currentAcadIdx - 1] || "October";

  const cleanStart = String(startMonthStr || 'April').trim().toLowerCase();
  let startMonthIdx = 1; // Default to April
  for (let i = 0; i < ACADEMIC_MONTHS.length; i++) {
    const mName = ACADEMIC_MONTHS[i].toLowerCase();
    if (cleanStart.includes(mName) || mName.includes(cleanStart)) {
      startMonthIdx = i + 1;
      break;
    }
  }

  // Count of months elapsed from Session Start Month up to Current Month
  // (e.g., April to October = 7 months)
  const elapsedMonths = Math.max(0, Math.min(12, currentAcadIdx - startMonthIdx + 1));
  const startMonthName = ACADEMIC_MONTHS[startMonthIdx - 1] || "April";

  return {
    elapsedMonths,
    currentAcadIdx,
    currentMonthName,
    startMonthIdx,
    startMonthName,
  };
};

export interface StudentSummaryResult {
  studentId: string;
  startMonth: string;
  currentMonth: string;
  elapsedMonths: number;
  monthlyTuition: number;
  monthlyDiscount: number;
  netMonthlyTuition: number;
  admissionFee: number;
  admissionPaid: number;         // Amount paid strictly toward admission fee
  admissionDue: number;          // Balance due strictly on admission fee
  tuitionBilled: number;         // Monthly tuition billed till running month
  tuitionPaid: number;           // Amount paid strictly toward monthly tuition
  tuitionDue: number;            // Balance due strictly on monthly tuition
  otherBilledFees: number;       // Non-tuition billed fees (Books & Stationery, Exam, Uniform, etc.)
  itemizedOtherFees: Array<{ type: string; amount: number; paid: number; balance: number }>;
  totalBilledSessionFee: number; // Fees strictly till current running month (Tuition + Admission + Books/Other)
  fullYearFee: number;           // Total full 12 months session fee
  totalPaid: number;
  totalDiscount: number;         // Total discount / concession given
  currentDues: number;      // Math.max(0, Total Billed Session Fee - Total Fees Paid - Total Discount)
  netBalance: number;       // Total Billed Session Fee - Total Fees Paid - Total Discount (negative = advance)
  isDue: boolean;
  isAdvance: boolean;
  advanceAmount: number;
  recordsCount: number;
  records: FeeCollectionRecord[];
}

/**
 * Check if a fee record is strictly a monthly tuition fee record.
 * One-time / non-tuition fees (Admission, Books, Exam, Uniform, Transport, etc.) must NEVER settle monthly tuition.
 */
export const isTuitionFeeRecord = (feeType?: string): boolean => {
  const clean = String(feeType || '').trim().toLowerCase();
  if (!clean) return true;
  if (/(admission|प्रवेश|book|पुस्तक|exam|परीक्षा|uniform|यूनिफॉर्म|annual|वार्षिक|transport|वाहन|bus|late fee|fine|advance|अग्रिम|miscellaneous|अन्य)/i.test(clean)) {
    return false;
  }
  return true;
};

export const isAdmissionFeeRecord = (feeType?: string): boolean => {
  const clean = String(feeType || '').trim().toLowerCase();
  return /(admission|प्रवेश)/i.test(clean);
};

export const isBooksFeeRecord = (feeType?: string): boolean => {
  const clean = String(feeType || '').trim().toLowerCase();
  return /(book|पुस्तक|stationary)/i.test(clean);
};

export const isExamFeeRecord = (feeType?: string): boolean => {
  const clean = String(feeType || '').trim().toLowerCase();
  return /(exam|परीक्षा)/i.test(clean);
};

/**
 * 2. DYNAMIC CURRENT-MONTH DUES CALCULATION (PREVENT OVER-BILLING & ACCOUNT FOR DISCOUNTS)
 * Formula:
 * 1. Elapsed Months Count = Count of months from Session Start Month up to Current Month (e.g., April to October = 7 months).
 * 2. Total Billed Session Fee = (Monthly Tuition Fee * Elapsed Months) + Admission Fee (if applicable) + Other Billed Fees (Books, Exam, Uniform, etc.).
 * 3. Total Fees Paid = Sum of Amount_Paid (Col H / row[7]) across all valid payment receipts.
 * 4. Total Discount = Sum of Discount_Amount / Discount across fee receipts + any profile-level concession.
 * 5. Current Dues (DUE) = Math.max(0, Total Billed Session Fee - Total Fees Paid - Total Discount).
 */
export const calculateStudentSummary = (
  studentId: string,
  allReceipts: FeeCollectionRecord[],
  studentProfile?: any
): StudentSummaryResult => {
  const normId = normalizeStudentId(studentId);

  // 1. Elapsed Months Count up to Current Running Month
  const { elapsedMonths, currentMonthName, startMonthName } = getElapsedMonthsCount(
    studentProfile?.Session_Start_Month || studentProfile?.Start_Month
  );

  // 2. Fee Waiver check
  const isExempt = isStudentFeeExempt(studentProfile);

  // Filter student receipts first
  const rawStudentReceipts = allReceipts.filter(
    (r) => normalizeStudentId(r.Student_ID) === normId
  );
  const reconciled = reconcileFeeRecords(rawStudentReceipts);

  // 3. Monthly tuition fee & permanent monthly discount
  // Per School Rule: For Fee-Waived students, ONLY Monthly Tuition Fee is ₹0 (and never added to pending dues).
  const monthlyTuition = isExempt ? 0 : getStudentMonthlyTuition(studentProfile, reconciled);
  const { monthlyDiscount: rawMonthlyDisc } = isExempt
    ? { monthlyDiscount: 0 }
    : getStudentMonthlyDiscount(studentProfile);
  const effectiveMonthlyDiscount = isExempt ? 0 : Math.min(monthlyTuition, Math.max(0, rawMonthlyDisc));
  const netMonthlyTuition = isExempt ? 0 : Math.max(0, monthlyTuition - effectiveMonthlyDiscount);

  // 4. Admission Fee (Always applicable for ALL students, including Tuition-Waived students!)
  let defaultAdmissionFee = 1000;
  try {
    const feeConfig = getActiveFeeMasterConfig();
    const classKey = normalizeClassKey(studentProfile?.Class || studentProfile?.class);
    if (feeConfig && feeConfig[classKey] && feeConfig[classKey].admissionFee !== undefined) {
      defaultAdmissionFee = feeConfig[classKey].admissionFee;
    }
  } catch {}

  const admissionRecordsAll = reconciled.filter((r) => isAdmissionFeeRecord(r.Fee_Type));
  const admissionPaidTotal = admissionRecordsAll.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);
  const admissionDiscountTotal = admissionRecordsAll.reduce(
    (sum, r) => sum + (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0),
    0
  );
  const admissionRecordsBilled =
    admissionRecordsAll.length > 0
      ? Math.max(
          ...admissionRecordsAll.map((r) => Number(r.Total_Amount) || 0),
          admissionPaidTotal + admissionDiscountTotal
        )
      : 0;

  const hasExplicitProfileAdm =
    studentProfile?.Admission_Fee !== undefined &&
    studentProfile?.Admission_Fee !== null &&
    String(studentProfile.Admission_Fee).trim() !== '';
  const explicitProfileAdmVal = hasExplicitProfileAdm ? (Number(studentProfile.Admission_Fee) || 0) : 0;

  const admissionFee = hasExplicitProfileAdm
    ? explicitProfileAdmVal
    : Math.max(defaultAdmissionFee, admissionRecordsBilled);

  // 4b. Other Billed Fees (Books & Stationery, Exam Fee, Uniform, Annual Fee, etc.)
  // Option A: Exam Fee / Books Fee are only added to session billing when explicitly recorded/billed.
  const nonTuitionRecords = reconciled.filter((r) => {
    const type = String(r.Fee_Type || '').trim();
    const isTuition = /(monthly|tuition|मासिक|ट्यूशन|multi-month)/i.test(type);
    const isAdmission = /(admission|प्रवेश)/i.test(type);
    return !isTuition && !isAdmission && type.length > 0;
  });

  const nonTuitionGroups = new Map<string, FeeCollectionRecord[]>();
  nonTuitionRecords.forEach((r) => {
    const typeKey = String(r.Fee_Type || '').trim().toLowerCase();
    const monthKey = String(r.Month || '').trim().toLowerCase();
    const groupKey = isExamFeeRecord(typeKey)
      ? `exam::${typeKey}::${monthKey || 'general'}`
      : typeKey;
    if (!nonTuitionGroups.has(groupKey)) nonTuitionGroups.set(groupKey, []);
    nonTuitionGroups.get(groupKey)!.push(r);
  });

  let otherBilledFees = 0;
  let otherNonTuitionDiscount = 0;
  const itemizedOtherFees: Array<{ type: string; amount: number; paid: number; balance: number }> = [];

  nonTuitionGroups.forEach((recs) => {
    const origType = recs[0].Fee_Type || 'Other Fee';
    const paid = recs.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);
    const disc = recs.reduce(
      (sum, r) => sum + (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0),
      0
    );
    const isBooks = isBooksFeeRecord(origType);
    const hasExplicitTotals = recs.some((r) => (Number(r.Total_Amount) || 0) > 0);
    const billed = isBooks && hasExplicitTotals
      ? Math.max(...recs.map((r) => Number(r.Total_Amount) || 0), paid + disc)
      : Math.max(
          ...recs.map((r) => Number(r.Total_Amount) || 0),
          recs.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0) + (Number(r.Balance_Amount) || 0), 0)
        );
    const balance = Math.max(0, billed - paid - disc);

    otherNonTuitionDiscount += disc;
    if (billed > 0) {
      otherBilledFees += billed;
      const monthLabel = isExamFeeRecord(origType) && recs[0]?.Month ? ` (${recs[0].Month})` : '';
      itemizedOtherFees.push({
        type: `${origType}${monthLabel}`,
        amount: billed,
        paid,
        balance,
      });
    }
  });

  // 5. Total Billed Session Fee = (Monthly Tuition Fee * Elapsed Months) + Admission Fee + Other Billed Fees
  const totalBilledSessionFee = (monthlyTuition * elapsedMonths) + admissionFee + otherBilledFees;
  // Full 12-month annual fee
  const fullYearFee = (monthlyTuition * 12) + admissionFee + otherBilledFees;

  // 6. Total Fees Paid = Sum of Amount_Paid across all valid payment receipts
  const totalPaid = reconciled.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);

  // Category-wise Breakdown (Strictly segregated by Fee Type)
  const admissionPaid = admissionPaidTotal;
  const admissionDiscount = admissionDiscountTotal;
  const admissionDue = Math.max(0, admissionFee - admissionPaid - admissionDiscount);

  const tuitionRecords = reconciled.filter((r) => isTuitionFeeRecord(r.Fee_Type));
  const tuitionBilled = isExempt ? 0 : monthlyTuition * elapsedMonths;
  const tuitionPaid = tuitionRecords.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);
  const tuitionReceiptDiscount = tuitionRecords.reduce(
    (sum, r) => sum + (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0),
    0
  );
  const tuitionDiscount = isExempt
    ? 0
    : Math.max(tuitionReceiptDiscount, effectiveMonthlyDiscount * elapsedMonths);
  const tuitionDue = isExempt ? 0 : Math.max(0, tuitionBilled - tuitionPaid - tuitionDiscount);

  // 7. Total Discounts Given (Segregated so monthly tuition discount never hides Admission/Books receipt discounts)
  const rawMonthlyField = Number(
    studentProfile?.Monthly_Discount || studentProfile?.Discount_Per_Month || 0
  ) || 0;
  const profileFlatDiscount = Number(studentProfile?.Concession || 0) ||
    (rawMonthlyField > 0 || effectiveMonthlyDiscount > 0
      ? 0
      : (Number(studentProfile?.Discount || studentProfile?.Fee_Discount || 0) || 0));

  const totalDiscount = tuitionDiscount + admissionDiscount + otherNonTuitionDiscount + profileFlatDiscount;

  // 8. Current Dues (DUE) = Math.max(0, Total Billed Session Fee - Total Fees Paid - Total Discount)
  const netBalance = totalBilledSessionFee - totalPaid - totalDiscount;
  const currentDues = Math.max(0, netBalance);
  const isAdvance = netBalance < 0;
  const advanceAmount = isAdvance ? Math.abs(netBalance) : 0;

  return {
    studentId: normId,
    startMonth: startMonthName,
    currentMonth: currentMonthName,
    elapsedMonths,
    monthlyTuition,
    monthlyDiscount: effectiveMonthlyDiscount,
    netMonthlyTuition,
    admissionFee,
    admissionPaid,
    admissionDue,
    tuitionBilled,
    tuitionPaid,
    tuitionDue,
    otherBilledFees,
    itemizedOtherFees,
    totalBilledSessionFee,
    fullYearFee,
    totalPaid,
    totalDiscount,
    currentDues,
    netBalance,
    isDue: currentDues > 0,
    isAdvance,
    advanceAmount,
    recordsCount: reconciled.length,
    records: reconciled,
  };
};

/**
 * Calculate individual student fee metrics:
 * Consistently uses calculateStudentSummary to enforce the current-month dynamic dues formula.
 */
export const computeStudentFeeMetrics = (
  student: Student | null | undefined,
  allFeeRecords: FeeCollectionRecord[]
): StudentFeeMetrics => {
  if (!student) {
    return {
      totalSessionFee: 0,
      totalPaid: 0,
      totalDiscount: 0,
      dueBalance: 0,
      hasDues: false,
      isAdvance: false,
      advanceAmount: 0,
      receiptsCount: 0,
    };
  }

  const sId = normalizeStudentId(student.Student_ID);
  const summary = calculateStudentSummary(sId, allFeeRecords, student);

  return {
    totalSessionFee: summary.totalBilledSessionFee,
    fullYearFee: summary.fullYearFee,
    monthlyTuition: summary.monthlyTuition,
    monthlyDiscount: summary.monthlyDiscount,
    netMonthlyTuition: summary.netMonthlyTuition,
    admissionFee: summary.admissionFee,
    admissionPaid: summary.admissionPaid,
    admissionDue: summary.admissionDue,
    tuitionBilled: summary.tuitionBilled,
    tuitionPaid: summary.tuitionPaid,
    tuitionDue: summary.tuitionDue,
    otherBilledFees: summary.otherBilledFees,
    itemizedOtherFees: summary.itemizedOtherFees,
    totalPaid: summary.totalPaid,
    totalDiscount: summary.totalDiscount,
    dueBalance: summary.netBalance,
    hasDues: summary.currentDues > 0,
    isAdvance: summary.isAdvance,
    advanceAmount: summary.advanceAmount,
    receiptsCount: summary.recordsCount,
    startMonth: summary.startMonth,
    currentMonth: summary.currentMonth,
    elapsedMonths: summary.elapsedMonths,
  };
};

/**
 * Calculate single receipt balance strictly reading Index 8 (Balance_Amount):
 * Total_Amount - Discount - Amount_Paid fallback if Balance_Amount is not provided.
 */
export const computeReceiptBalance = (fee: FeeCollectionRecord): {
  balance: number;
  isAdvance: boolean;
  isPending: boolean;
  isCleared: boolean;
} => {
  const total = Number(fee.Total_Amount) || 0;
  const discount = Number((fee as any).Discount_Amount || (fee as any).Discount || 0) || 0;
  const paid = Number(fee.Amount_Paid) || 0;
  const rawBal = Number(fee.Balance_Amount);

  const netPayable = Math.max(0, total - discount);
  let balance = !isNaN(rawBal) ? rawBal : Math.max(0, netPayable - paid);
  const isAdvance = /(advance|अग्रिम)/i.test(String(fee.Fee_Type || '')) || balance < 0;

  return {
    balance,
    isAdvance,
    isPending: balance > 0,
    isCleared: balance === 0,
  };
};

/**
 * 4. Overall School Summary Total:
 * Individual student totals ke basis par Overall Total Collection aur Overall Due Balance calculate karein
 * taaki duplicate entries ki वजह se total double/triple na ho.
 */
export const computeSchoolFeeTotals = (
  students: Student[],
  allFeeRecords: FeeCollectionRecord[]
): SchoolFeeTotals => {
  const totalReceipts = allFeeRecords.length;

  // Total Collected: Fee receipts table me se sirf Amount_Paid column ka SUM nikalein
  const totalCollected = allFeeRecords.reduce(
    (sum, r) => sum + (Number(r.Amount_Paid) || 0),
    0
  );

  // Map each unique student by ID
  const studentMap = new Map<string, Student>();
  students.forEach((s) => {
    if (s.Student_ID) {
      studentMap.set(normalizeStudentId(s.Student_ID), s);
    }
  });

  allFeeRecords.forEach((r) => {
    if (r.Student_ID) {
      const normId = normalizeStudentId(r.Student_ID);
      if (!studentMap.has(normId)) {
        studentMap.set(normId, { Student_ID: r.Student_ID, Student_Name: r.Student_ID } as Student);
      }
    }
  });

  let totalBilled = 0;
  let totalPendingDues = 0;
  let totalDiscounts = 0;
  let studentExcessAdvance = 0;

  studentMap.forEach((student) => {
    const metrics = computeStudentFeeMetrics(student, allFeeRecords);
    totalBilled += metrics.totalSessionFee;
    totalDiscounts += (metrics.totalDiscount || 0);
    if (metrics.dueBalance > 0) {
      totalPendingDues += metrics.dueBalance;
    } else if (metrics.dueBalance < 0) {
      studentExcessAdvance += metrics.advanceAmount;
    }
  });

  // Calculate sum of payments where Fee Type is "Advance Fee Deposit" (or contains advance/अग्रिम)
  const advanceFeeDepositSum = allFeeRecords.reduce((sum, r) => {
    const type = String(r.Fee_Type || '').toLowerCase();
    if (/(advance|अग्रिम)/i.test(type)) {
      return sum + (Number(r.Amount_Paid) || 0);
    }
    return sum;
  }, 0);

  // Take the comprehensive advance fee total (student excess advance or advance deposit receipts)
  const totalAdvance = Math.max(studentExcessAdvance, advanceFeeDepositSum);

  // Compute complete Fee Waiver summary across all active students
  const waivedSummary = computeWaivedStudentsSummary(Array.from(studentMap.values()), allFeeRecords);

  return {
    totalReceipts,
    totalCollected,
    totalPendingDues,
    totalDiscounts,
    totalAdvance,
    totalBilled,
    totalWaivedStudents: waivedSummary.totalWaivedStudents,
    totalWaivedAmountTillDate: waivedSummary.totalWaivedAmountTillDate,
    totalAnnualWaivedAmount: waivedSummary.totalAnnualWaivedAmount,
  };
};

/**
 * Computes how many students have 100% Fee Waiver and the exact rupee value
 * of tuition & admission fees waived (both till the current running month and for the full 12-month session).
 */
export const computeWaivedStudentsSummary = (
  students: Student[],
  allFeeRecords: FeeCollectionRecord[]
): WaivedStudentsSummary => {
  const feeConfig = (() => {
    try {
      return getActiveFeeMasterConfig();
    } catch {
      return {};
    }
  })();

  const waivedStudents: WaivedStudentDetail[] = [];
  let totalWaivedAmountTillDate = 0;
  let totalAnnualWaivedAmount = 0;
  let totalTuitionWaivedTillDate = 0;
  let totalAdmissionWaived = 0;

  const seenIds = new Set<string>();
  students.forEach((student) => {
    if (!student) return;
    const normId = normalizeStudentId(student.Student_ID);
    if (normId) {
      if (seenIds.has(normId)) return;
      seenIds.add(normId);
    }

    const freeCheck = isFreeStudent(student);
    if (!freeCheck.isFree) return;

    const classKey = normalizeClassKey(student.Class);
    const masterClassCfg = (feeConfig as any)?.[classKey];
    const customMonthly = Number((student as any).Monthly_Fee || (student as any).monthly_fee);
    const monthlyTuitionRate =
      !isNaN(customMonthly) && customMonthly > 0
        ? customMonthly
        : masterClassCfg?.monthlyTuition > 0
          ? Number(masterClassCfg.monthlyTuition)
          : getStudentMonthlyTuition(student);

    const { elapsedMonths, currentMonthName, startMonthName } = getElapsedMonthsCount(
      student.Session_Start_Month || (student as any).Start_Month
    );

    const summary = calculateStudentSummary(student.Student_ID, allFeeRecords, student);
    const tuitionWaivedTillDate = monthlyTuitionRate * elapsedMonths;
    const annualTuitionWaived = monthlyTuitionRate * 12;
    // Per school rule: ONLY Monthly Tuition Fee is waived; Admission, Exam, Books, Auto etc. are NOT waived.
    const admissionWaived = 0;
    const totalWaivedTill = tuitionWaivedTillDate;
    const annualWaived = annualTuitionWaived;

    totalTuitionWaivedTillDate += tuitionWaivedTillDate;
    totalWaivedAmountTillDate += totalWaivedTill;
    totalAnnualWaivedAmount += annualWaived;

    waivedStudents.push({
      student,
      reason: freeCheck.reason || 'Tuition Fee Waived (केवल ट्यूशन फीस माफ)',
      startMonth: startMonthName,
      currentMonth: currentMonthName,
      elapsedMonths,
      monthlyTuitionRate,
      tuitionWaivedTillDate,
      admissionWaived,
      totalWaivedTillDate: totalWaivedTill,
      annualWaivedTotal: annualWaived,
      otherChargedFees: (summary.admissionFee || 0) + (summary.otherBilledFees || 0),
      totalPaidByStudent: summary.totalPaid || 0,
      remainingDueOnOtherFees: summary.currentDues || 0,
    });
  });

  waivedStudents.sort((a, b) => b.totalWaivedTillDate - a.totalWaivedTillDate);

  return {
    totalWaivedStudents: waivedStudents.length,
    totalWaivedAmountTillDate,
    totalAnnualWaivedAmount,
    totalTuitionWaivedTillDate,
    totalAdmissionWaived,
    waivedStudents,
  };
};

export interface StudentHeadPaymentStatus {
  admission: {
    standardFee: number;
    paid: number;
    discount: number;
    settled: number;
    remaining: number;
    isPaid: boolean;
    isPartial: boolean;
  };
  books: {
    standardFee: number;
    paid: number;
    discount: number;
    settled: number;
    remaining: number;
    isPaid: boolean;
    isPartial: boolean;
  };
  exam: {
    perTermFee: number;
    fullYearFee: number;
    paid: number;
    discount: number;
    settled: number;
    term1Paid: boolean;
    term2Paid: boolean;
    term3Paid: boolean;
    paidTermsCount: number;
    remainingTermsCount: number;
    remainingFullYearAmount: number;
    isFullYearPaid: boolean;
  };
}

/**
 * Checks whether Admission, Books, and each Exam term (1st, 2nd, 3rd or 3× Full Year)
 * have already been settled so duplicate fee collection can be locked accurately.
 */
export const getStudentHeadPaymentStatus = (
  student: Student | null | undefined,
  allReceipts: FeeCollectionRecord[]
): StudentHeadPaymentStatus => {
  const activeConfig = (() => {
    try {
      return getActiveFeeMasterConfig();
    } catch {
      return {};
    }
  })();
  const classKey = normalizeClassKey(student?.Class);
  const classCfg = (activeConfig as any)?.[classKey] || DEFAULT_FEE_CONFIG;

  const hasExplicitAdm =
    student?.Admission_Fee !== undefined &&
    student?.Admission_Fee !== null &&
    String(student.Admission_Fee).trim() !== '';
  const admStandard = hasExplicitAdm
    ? Math.max(0, Number(student?.Admission_Fee) || 0)
    : Number(classCfg.admissionFee ?? DEFAULT_FEE_CONFIG.admissionFee);
  const booksStandard = Number(classCfg.booksFee ?? DEFAULT_FEE_CONFIG.booksFee);
  const perTermExamFee = Number(classCfg.examFee ?? DEFAULT_FEE_CONFIG.examFee);
  const fullYearExamFee = perTermExamFee * 3;

  const normId = normalizeStudentId(student?.Student_ID);
  const rawStudentReceipts = normId
    ? allReceipts.filter((r) => normalizeStudentId(r.Student_ID) === normId)
    : [];
  const reconciled = reconcileFeeRecords(rawStudentReceipts);

  // 1. Admission
  const admRecs = reconciled.filter((r) => isAdmissionFeeRecord(r.Fee_Type));
  const admPaid = admRecs.reduce((s, r) => s + (Number(r.Amount_Paid) || 0), 0);
  const admDisc = admRecs.reduce(
    (s, r) => s + (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0),
    0
  );
  const admSettled = admPaid + admDisc;
  const admRemaining = Math.max(0, admStandard - admSettled);
  const admIsPaid = admStandard > 0 ? admSettled >= admStandard : admSettled > 0;

  // 2. Books & Stationery
  const booksRecs = reconciled.filter((r) => isBooksFeeRecord(r.Fee_Type));
  const booksPaid = booksRecs.reduce((s, r) => s + (Number(r.Amount_Paid) || 0), 0);
  const booksDisc = booksRecs.reduce(
    (s, r) => s + (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0),
    0
  );
  const booksSettled = booksPaid + booksDisc;
  const booksRemaining = Math.max(0, booksStandard - booksSettled);
  const booksIsPaid = booksStandard > 0 ? booksSettled >= booksStandard : booksSettled > 0;

  // 3. Examination Fee (Option A: 1x Term-wise, 2x Two Terms, & 3x Full Year)
  const examRecs = reconciled.filter((r) => isExamFeeRecord(r.Fee_Type));
  const examPaid = examRecs.reduce((s, r) => s + (Number(r.Amount_Paid) || 0), 0);
  const examDisc = examRecs.reduce(
    (s, r) => s + (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0),
    0
  );
  const examSettled = examPaid + examDisc;

  let term1Paid = false;
  let term2Paid = false;
  let term3Paid = false;
  let fullYearMarked = false;
  let twoTermsMarked = false;

  examRecs.forEach((r) => {
    const recSettled =
      (Number(r.Amount_Paid) || 0) +
      (Number((r as any).Discount_Amount || (r as any).Discount || 0) || 0);
    if (recSettled <= 0) return; // Unpaid due bill does not lock payment

    const text = `${r.Month || ''} ${r.Notes || ''} ${r.Fee_Type || ''}`.toLowerCase();
    if (
      /(3x|3×|all\s*3|three\s*term|तीनों\s*टर्म|full\s*year|full\s*session\s*exam|पूरे\s*साल)/i.test(text) ||
      (fullYearExamFee > 0 && recSettled >= fullYearExamFee)
    ) {
      fullYearMarked = true;
    }
    if (/(2x|2×|2\s*terms?|two\s*terms?|दो\s*टर्म)/i.test(text)) {
      twoTermsMarked = true;
    }
    if (/(1st\s*term|1st\s*[+&]|term\s*1|first\s*term|quarter\s*1|q1|unit\s*test\s*1|प्रथम\s*टर्म|प्रथम\s*परीक्षा|तिमाही)/i.test(text)) {
      term1Paid = true;
    }
    if (/(2nd\s*term|2nd\s*[+&]|[+&]\s*2nd|term\s*2|second\s*term|half[\s-]*yearly|quarter\s*2|q2|unit\s*test\s*2|द्वितीय\s*टर्म|अर्धवार्षिक|छमाही)/i.test(text)) {
      term2Paid = true;
    }
    if (/(3rd\s*term|[+&]\s*3rd|term\s*3|third\s*term|annual\s*exam|final\s*exam|तृतीय\s*टर्म|वार्षिक)/i.test(text)) {
      term3Paid = true;
    }
  });

  if (fullYearMarked || (fullYearExamFee > 0 && examSettled >= fullYearExamFee)) {
    term1Paid = true;
    term2Paid = true;
    term3Paid = true;
  } else if (examSettled > 0 && perTermExamFee > 0) {
    // Reconcile 2x / legacy / unlabeled exam receipts against per-term rate
    const amountImpliedTerms = Math.min(3, Math.floor((examSettled + 0.01) / perTermExamFee));
    const impliedTerms = Math.max(twoTermsMarked ? 2 : 0, amountImpliedTerms);
    let currentCount = (term1Paid ? 1 : 0) + (term2Paid ? 1 : 0) + (term3Paid ? 1 : 0);
    if (currentCount < impliedTerms) {
      if (!term1Paid && currentCount < impliedTerms) { term1Paid = true; currentCount++; }
      if (!term2Paid && currentCount < impliedTerms) { term2Paid = true; currentCount++; }
      if (!term3Paid && currentCount < impliedTerms) { term3Paid = true; currentCount++; }
    }
  }

  const paidTermsCount = (term1Paid ? 1 : 0) + (term2Paid ? 1 : 0) + (term3Paid ? 1 : 0);
  const remainingTermsCount = Math.max(0, 3 - paidTermsCount);
  const isFullYearPaid = remainingTermsCount === 0 || (fullYearExamFee > 0 && examSettled >= fullYearExamFee);
  const remainingFullYearAmount =
    perTermExamFee > 0
      ? Math.max(0, Math.min(fullYearExamFee - examSettled, remainingTermsCount * perTermExamFee))
      : 0;

  return {
    admission: {
      standardFee: admStandard,
      paid: admPaid,
      discount: admDisc,
      settled: admSettled,
      remaining: admRemaining,
      isPaid: admIsPaid,
      isPartial: !admIsPaid && admSettled > 0,
    },
    books: {
      standardFee: booksStandard,
      paid: booksPaid,
      discount: booksDisc,
      settled: booksSettled,
      remaining: booksRemaining,
      isPaid: booksIsPaid,
      isPartial: !booksIsPaid && booksSettled > 0,
    },
    exam: {
      perTermFee: perTermExamFee,
      fullYearFee: fullYearExamFee,
      paid: examPaid,
      discount: examDisc,
      settled: examSettled,
      term1Paid,
      term2Paid,
      term3Paid,
      paidTermsCount,
      remainingTermsCount,
      remainingFullYearAmount,
      isFullYearPaid,
    },
  };
};

export interface DiscountedStudentDetail {
  student: Student;
  reason: string;
  startMonth: string;
  currentMonth: string;
  elapsedMonths: number;
  grossMonthlyTuition: number;
  monthlyDiscount: number;
  netMonthlyTuition: number;
  discountTillDate: number;
  annualDiscountTotal: number;
}

export const computeDiscountedStudentsSummary = (
  students: Student[],
  allFeeRecords: FeeCollectionRecord[]
): {
  totalDiscountedStudents: number;
  totalMonthlySavings: number;
  totalDiscountTillDate: number;
  totalAnnualDiscount: number;
  discountedStudents: DiscountedStudentDetail[];
} => {
  const discountedStudents: DiscountedStudentDetail[] = [];
  let totalMonthlySavings = 0;
  let totalDiscountTillDate = 0;
  let totalAnnualDiscount = 0;

  const seen = new Set<string>();
  students.forEach((student) => {
    if (!student) return;
    const normId = normalizeStudentId(student.Student_ID);
    if (normId) {
      if (seen.has(normId)) return;
      seen.add(normId);
    }
    if (isFreeStudent(student).isFree) return;
    const discInfo = getStudentMonthlyDiscount(student);
    if (discInfo.monthlyDiscount <= 0) return;

    const summary = calculateStudentSummary(student.Student_ID, allFeeRecords, student);
    const gross = summary.monthlyTuition;
    const monthlyDiscount = Math.min(gross, discInfo.monthlyDiscount);
    const netMonthlyTuition = Math.max(0, gross - monthlyDiscount);
    const discountTillDate = monthlyDiscount * summary.elapsedMonths;
    const annualDiscountTotal = monthlyDiscount * 12;

    totalMonthlySavings += monthlyDiscount;
    totalDiscountTillDate += discountTillDate;
    totalAnnualDiscount += annualDiscountTotal;

    discountedStudents.push({
      student,
      reason: discInfo.reason || `स्थायी मासिक छूट ₹${monthlyDiscount}/माह`,
      startMonth: summary.startMonth,
      currentMonth: summary.currentMonth,
      elapsedMonths: summary.elapsedMonths,
      grossMonthlyTuition: gross,
      monthlyDiscount,
      netMonthlyTuition,
      discountTillDate,
      annualDiscountTotal,
    });
  });

  discountedStudents.sort((a, b) => b.discountTillDate - a.discountTillDate);

  return {
    totalDiscountedStudents: discountedStudents.length,
    totalMonthlySavings,
    totalDiscountTillDate,
    totalAnnualDiscount,
    discountedStudents,
  };
};

/**
 * LEDGER TABLE RENDERING (12-COLUMN ARRAY MAPPING)
 * strictly reads Google Sheets data rows using 0-based array indices without column shifting:
 * Index 0: Receipt_Number
 * Index 1: Student_ID
 * Index 2: Date
 * Index 3: Fee_Type
 * Index 4: Month
 * Index 5: Total_Amount (TOTAL FEE)
 * Index 6: Discount (DISCOUNT)
 * Index 7: Amount_Paid (PAID)
 * Index 8: Balance_Amount (BALANCE)
 * Index 9: Payment_Mode (MODE)
 * Index 10: Received_By (RECEIVED BY)
 * Index 11: Remarks / Notes
 */
export const renderLedgerTable = (rowsData: any[]) => {
  if (!rowsData || rowsData.length === 0) {
    return `<div class="text-center py-10 text-slate-400">कोई फीस रिकॉर्ड नहीं मिला</div>`;
  }

  let html = `
    <div class="overflow-x-auto rounded-2xl border border-slate-200">
      <table class="w-full text-left text-xs text-slate-700">
        <thead class="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
          <tr>
            <th class="px-3.5 py-3">RECEIPT NO</th>
            <th class="px-3.5 py-3">DATE</th>
            <th class="px-3.5 py-3">FEE TYPE</th>
            <th class="px-3.5 py-3">MONTH / DURATION</th>
            <th class="px-3.5 py-3 text-right">TOTAL FEE</th>
            <th class="px-3.5 py-3 text-right">DISCOUNT</th>
            <th class="px-3.5 py-3 text-right">PAID</th>
            <th class="px-3.5 py-3 text-right">BALANCE</th>
            <th class="px-3.5 py-3">PAYMENT MODE</th>
            <th class="px-3.5 py-3">RECEIVED BY</th>
            <th class="px-3.5 py-3">REMARKS</th>
            <th class="px-3.5 py-3 text-center">ACTIONS</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200 bg-white">
  `;

  rowsData.forEach((row, idx) => {
    const receiptNo = Array.isArray(row) ? (row[0] || `REC-${idx + 1}`) : (row.Receipt_Number || `REC-${idx + 1}`);
    const studentId = Array.isArray(row) ? (row[1] || '') : (row.Student_ID || '');
    const dateVal = Array.isArray(row) ? (row[2] || '') : (row.Date || '');
    const feeType = Array.isArray(row) ? (row[3] || 'Monthly Tuition Fee') : (row.Fee_Type || 'Monthly Tuition Fee');
    const monthVal = Array.isArray(row) ? (row[4] || '—') : (row.Month || '—');
    const totalFee = Array.isArray(row) ? (Number(row[5]) || 0) : (Number(row.Total_Amount) || 0);
    const discount = Array.isArray(row) ? (Number(row[6]) || 0) : (Number((row as any).Discount_Amount || (row as any).Discount) || 0);
    const amountPaid = Array.isArray(row) ? (Number(row[7]) || 0) : (Number(row.Amount_Paid) || 0);
    const balance = Array.isArray(row) ? (Number(row[8]) || 0) : (Number(row.Balance_Amount) || (totalFee - amountPaid));
    let paymentMode = Array.isArray(row) ? (row[9] || 'Cash') : (row.Payment_Mode || 'Cash');
    if (!paymentMode || !isNaN(Number(paymentMode)) || String(paymentMode).startsWith('-') || /^\d+$/.test(String(paymentMode))) {
      paymentMode = 'Cash';
    }
    const receivedBy = Array.isArray(row) ? (row[10] || 'School Office') : (row.Received_By || 'School Office');
    const remarks = Array.isArray(row) ? (row[11] || '') : ((row as any).Remarks || (row as any).Notes || '');

    let balanceBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">₹0</span>`;
    if (balance > 0) {
      balanceBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800">₹${balance.toLocaleString('en-IN')}</span>`;
    } else if (balance < 0) {
      balanceBadge = `<span class="px-2 py-0.5 rounded text-[11px] font-black bg-purple-100 text-purple-900 border border-purple-200 inline-flex items-center gap-1"><span>-₹${Math.abs(balance).toLocaleString('en-IN')}</span><span class="text-[9px] uppercase font-bold text-purple-700 bg-purple-200/80 px-1 py-0.2 rounded">ADV</span></span>`;
    }

    let remarksHtml = remarks ? `<span class="text-xs text-slate-600">${remarks}</span>` : `<span class="text-xs text-slate-400">—</span>`;
    if (remarks && (remarks.includes("Paid") || remarks.includes("Bal") || remarks.includes("₹"))) {
      remarksHtml = `<span class="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">${remarks}</span>`;
    }

    html += `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="px-3.5 py-2.5 font-mono font-bold text-blue-950 whitespace-nowrap">${receiptNo}</td>
        <td class="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">${dateVal}</td>
        <td class="px-3.5 py-2.5 font-medium text-slate-800 whitespace-nowrap">${feeType}</td>
        <td class="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">${monthVal}</td>
        <td class="px-3.5 py-2.5 text-right font-medium text-slate-700 whitespace-nowrap">₹${totalFee.toLocaleString('en-IN')}</td>
        <td class="px-3.5 py-2.5 text-right text-amber-700 font-medium whitespace-nowrap">${discount > 0 ? `-₹${discount.toLocaleString('en-IN')}` : '—'}</td>
        <td class="px-3.5 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">₹${amountPaid.toLocaleString('en-IN')}</td>
        <td class="px-3.5 py-2.5 text-right whitespace-nowrap">${balanceBadge}</td>
        <td class="px-3.5 py-2.5 text-slate-600 whitespace-nowrap"><span class="inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700">${paymentMode}</span></td>
        <td class="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">${receivedBy}</td>
        <td class="px-3.5 py-2.5">${remarksHtml}</td>
        <td class="px-3.5 py-2.5 text-center whitespace-nowrap">
          <button type="button" class="px-2.5 py-1 rounded-lg bg-blue-900 text-amber-300 font-bold text-[11px] hover:bg-blue-800 cursor-pointer">प्रिंट</button>
        </td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;
  return html;
};

