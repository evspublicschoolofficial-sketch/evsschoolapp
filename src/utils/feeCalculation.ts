import { Student, FeeCollectionRecord } from '../types';

export interface StudentFeeMetrics {
  totalSessionFee: number; // Unique billed total fee (till current month)
  fullYearFee?: number;    // Full 12-month session fee
  monthlyTuition?: number; // Detected monthly tuition
  totalPaid: number;       // SUM of Amount_Paid
  dueBalance: number;      // totalSessionFee - totalPaid (negative if advance, e.g. 600 - 700 = -100)
  hasDues: boolean;        // dueBalance > 0
  isAdvance: boolean;      // dueBalance < 0
  advanceAmount: number;   // Math.abs(dueBalance) if isAdvance else 0
  receiptsCount: number;
}

export interface SchoolFeeTotals {
  totalReceipts: number;
  totalCollected: number;
  totalPendingDues: number;
  totalAdvance: number;
  totalBilled: number;
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
      const isOneTime = /(admission|प्रवेश|exam|परीक्षा|book|पुस्तक)/i.test(typeKey);
      const key = isOneTime ? `onetime::${typeKey}` : `${monthKey}::${typeKey || 'tuition'}`;

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
  c1: 500, play: 500,
  c2: 600, nursery: 600, m1: 600,
  c3: 600, lkg: 600, m2: 600,
  c4: 600, ukg: 600, m3: 600,
  c5: 650, '1st': 650, '1': 650,
  c6: 650, '2nd': 650, '2': 650,
  c7: 650, '3rd': 650, '3': 650,
  c8: 700, '4th': 700, '4': 700,
  c9: 700, '5th': 700, '5': 700,
  c10: 800, '6th': 800, '6': 800,
  c11: 800, '7th': 800, '7': 800,
  c12: 850, '8th': 850, '8': 850,
};

/**
 * Lookup Monthly Tuition Fee from Student profile or Class ID/name, or existing receipts
 */
export const getStudentMonthlyTuition = (student?: any, studentReceipts?: FeeCollectionRecord[]): number => {
  if (!student) return 600;
  const custom = Number(student.Monthly_Fee || student.monthly_fee);
  if (!isNaN(custom) && custom > 0) return custom;

  // If student has existing receipts in Fee_Collection with an established monthly rate
  if (studentReceipts && studentReceipts.length > 0) {
    const tuitionRec = studentReceipts.find(
      (r) => /(tuition|मासिक|monthly)/i.test(String(r.Fee_Type || '')) &&
        ((Number(r.Total_Amount) || 0) > 0 || (Number(r.Amount_Paid) || 0) > 0)
    );
    if (tuitionRec) {
      const amt = (Number(tuitionRec.Total_Amount) || 0) > 0 ? Number(tuitionRec.Total_Amount) : Number(tuitionRec.Amount_Paid);
      if (amt > 0) return amt;
    }
  }

  const rawClass = String(student.Class || student.class || '').trim().toLowerCase();
  if (CLASS_TUITION_FEES[rawClass] !== undefined) {
    return CLASS_TUITION_FEES[rawClass];
  }
  for (const key of Object.keys(CLASS_TUITION_FEES)) {
    if (rawClass.includes(key)) {
      return CLASS_TUITION_FEES[key];
    }
  }
  return 600;
};

/**
 * Check if student has 100% Fee Waiver (Free Student)
 */
export const isStudentFeeExempt = (student?: any): boolean => {
  if (!student) return false;
  const waiver = String(student.fee_waiver || student.Fee_Waiver || student.is_free_student || '').toLowerCase();
  if (waiver === 'true' || waiver === 'yes' || waiver.includes('100') || waiver.includes('free') || waiver.includes('माफ')) return true;
  const cat = String(student.Category || student.category || '').toLowerCase();
  if (cat.includes('rte') || cat.includes('free') || cat.includes('माफ')) return true;
  const rem = String(student.Remark || student.Remarks || student.remark || '').toLowerCase();
  if (rem.includes('फीस माफ') || rem.includes('100% waiver') || rem.includes('free student')) return true;
  return false;
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
  admissionFee: number;
  totalBilledSessionFee: number; // Fees strictly till current running month
  fullYearFee: number;           // Total full 12 months session fee
  totalPaid: number;
  currentDues: number;      // Math.max(0, Total Billed Session Fee - Total Fees Paid)
  netBalance: number;       // Total Billed Session Fee - Total Fees Paid (negative = advance)
  isDue: boolean;
  isAdvance: boolean;
  advanceAmount: number;
  recordsCount: number;
  records: FeeCollectionRecord[];
}

/**
 * 2. DYNAMIC CURRENT-MONTH DUES CALCULATION (PREVENT OVER-BILLING)
 * Formula:
 * 1. Elapsed Months Count = Count of months from Session Start Month up to Current Month (e.g., April to October = 7 months).
 * 2. Total Billed Session Fee = (Monthly Tuition Fee * Elapsed Months) + Admission Fee (if applicable).
 * 3. Total Fees Paid = Sum of Amount_Paid (Col H / row[7]) across all valid payment receipts.
 * 4. Current Dues (DUE) = Math.max(0, Total Billed Session Fee - Total Fees Paid).
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

  // 3. Monthly tuition fee (from profile, existing receipts, or class master)
  const monthlyTuition = isExempt ? 0 : getStudentMonthlyTuition(studentProfile, reconciled);

  // 4. Admission Fee (if applicable)
  const admissionFee = (!isExempt && studentProfile?.Admission_Fee !== undefined && studentProfile?.Admission_Fee !== null && studentProfile?.Admission_Fee !== '')
    ? Number(studentProfile.Admission_Fee) || 0
    : 0;

  // 5. Total Billed Session Fee = (Monthly Tuition Fee * Elapsed Months) + Admission Fee (if applicable)
  // Strictly capped at current running month (prevents over-billing for future unarrived months!)
  const totalBilledSessionFee = (monthlyTuition * elapsedMonths) + admissionFee;
  // Full 12-month annual fee
  const fullYearFee = (monthlyTuition * 12) + admissionFee;

  // 6. Total Fees Paid = Sum of Amount_Paid across all valid payment receipts
  const totalPaid = reconciled.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);

  // 7. Current Dues (DUE) = Math.max(0, Total Billed Session Fee - Total Fees Paid)
  const netBalance = totalBilledSessionFee - totalPaid;
  const currentDues = Math.max(0, netBalance);
  const isAdvance = netBalance < 0;
  const advanceAmount = isAdvance ? Math.abs(netBalance) : 0;

  return {
    studentId: normId,
    startMonth: startMonthName,
    currentMonth: currentMonthName,
    elapsedMonths,
    monthlyTuition,
    admissionFee,
    totalBilledSessionFee,
    fullYearFee,
    totalPaid,
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
    totalPaid: summary.totalPaid,
    dueBalance: summary.netBalance,
    hasDues: summary.currentDues > 0,
    isAdvance: summary.isAdvance,
    advanceAmount: summary.advanceAmount,
    receiptsCount: summary.recordsCount,
  };
};

/**
 * Calculate single receipt balance strictly reading Index 8 (Balance_Amount):
 * Total_Amount - Amount_Paid fallback if Balance_Amount is not provided.
 */
export const computeReceiptBalance = (fee: FeeCollectionRecord): {
  balance: number;
  isAdvance: boolean;
  isPending: boolean;
  isCleared: boolean;
} => {
  const total = Number(fee.Total_Amount) || 0;
  const paid = Number(fee.Amount_Paid) || 0;
  const rawBal = Number(fee.Balance_Amount);

  let balance = !isNaN(rawBal) ? rawBal : (total - paid);
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
  let studentExcessAdvance = 0;

  studentMap.forEach((student) => {
    const metrics = computeStudentFeeMetrics(student, allFeeRecords);
    totalBilled += metrics.totalSessionFee;
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

  return {
    totalReceipts,
    totalCollected,
    totalPendingDues,
    totalAdvance,
    totalBilled,
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

