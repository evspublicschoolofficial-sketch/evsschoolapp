import { Student, FeeCollectionRecord } from '../types';

export interface StudentFeeMetrics {
  totalSessionFee: number; // Unique billed total fee
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
 * Calculate individual student fee metrics strictly per specifications:
 * 1. Total Paid Amount: Fee receipts table me se sirf Amount_Paid column ka SUM nikalein.
 * 2. Total Session Fee: Receipts ka SUM mat karein. Isko har student ki unique billed rows (Total_Amount) se calculate karein.
 * 3. Due Balance: Simply Total Session Fee - Total Paid Amount karein (e.g. 600 - 700 = -100).
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

  // Find all receipts matching this student
  const studentRecords = allFeeRecords.filter((r) => {
    const rSid = normalizeStudentId(r.Student_ID);
    return Boolean(rSid && (rSid === sId || sId.includes(rSid) || rSid.includes(sId)));
  });

  // 1. Total Paid Amount: Fee receipts table me se sirf Amount_Paid column ka SUM nikalein
  const totalPaid = studentRecords.reduce(
    (sum, r) => sum + (Number(r.Amount_Paid) || 0),
    0
  );

  // 2. Total Session Fee: Receipts ka SUM mat karein. Isko har student ki unique billed rows (Total_Amount) se calculate karein.
  let totalSessionFee = 0;

  if (studentRecords.length > 0) {
    const uniqueBilledMap = new Map<string, number>();

    studentRecords.forEach((r, idx) => {
      const monthKey = String(r.Month || '').trim().toLowerCase();
      const typeKey = String(r.Fee_Type || '').trim().toLowerCase();

      // Extract period identifier (from Month or Date)
      let periodKey = monthKey;
      if (!periodKey && r.Date) {
        const dStr = String(r.Date).trim();
        const parts = dStr.split(/[-/]/);
        if (parts.length >= 2) {
          if (parts[0].length === 4) {
            periodKey = `${parts[0]}-${parts[1]}`;
          } else if (parts[2] && parts[2].length === 4) {
            periodKey = `${parts[2]}-${parts[1]}`;
          }
        }
      }

      // Check if this is an advance deposit (not a billed obligation)
      const isAdvanceType = /(advance|अग्रिम)/i.test(typeKey);

      // Check if this is an annual/one-time fee head vs recurring monthly fee
      const isOneTimeHead = /(admission|प्रवेश|वार्षिक|annual|uniform|यूनिफॉर्म|books|पुस्तक|stationary|exam|परीक्षा|misc|अन्य|fine|विलंब)/i.test(typeKey);

      let billedKey = '';
      if (periodKey) {
        billedKey = `${periodKey}::${typeKey || 'tuition'}`;
      } else if (isOneTimeHead) {
        billedKey = `head::${typeKey}`;
      } else {
        billedKey = `receipt::${idx}::${typeKey || 'fee'}`;
      }

      // Advance deposits are payments, not billed fee liabilities
      if (!isAdvanceType) {
        const billedAmt = Number(r.Total_Amount) || 0;
        if (billedAmt > 0) {
          const existing = uniqueBilledMap.get(billedKey) || 0;
          // Keep the authoritative billed Total_Amount for this unique billed row
          if (billedAmt > existing) {
            uniqueBilledMap.set(billedKey, billedAmt);
          }
        }
      }
    });

    uniqueBilledMap.forEach((amt) => {
      totalSessionFee += amt;
    });

    // Fallback if receipts lacked Total_Amount: derive from student's registered session fees or initial balance
    if (totalSessionFee === 0 && student.Balance_Amount !== undefined && student.Balance_Amount !== null && student.Balance_Amount !== '') {
      const rawBal = Number(student.Balance_Amount) || 0;
      totalSessionFee = Math.max(0, rawBal);
    }
  } else if (student.Balance_Amount !== undefined && student.Balance_Amount !== null && student.Balance_Amount !== '') {
    totalSessionFee = Math.max(0, Number(student.Balance_Amount) || 0);
  }

  // 3. Due Balance: Simply Total Session Fee - Total Paid Amount
  // If paid > total, dueBalance is negative (advance, e.g. 600 - 700 = -100)
  const dueBalance = totalSessionFee - totalPaid;
  const hasDues = dueBalance > 0;
  const isAdvance = dueBalance < 0;
  const advanceAmount = isAdvance ? Math.abs(dueBalance) : 0;

  return {
    totalSessionFee,
    totalPaid,
    dueBalance,
    hasDues,
    isAdvance,
    advanceAmount,
    receiptsCount: studentRecords.length,
  };
};

/**
 * Calculate single receipt balance:
 * Total_Amount - Amount_Paid (e.g. 600 - 700 = -100)
 */
export const computeReceiptBalance = (fee: FeeCollectionRecord): {
  balance: number;
  isAdvance: boolean;
  isPending: boolean;
  isCleared: boolean;
} => {
  const total = Number(fee.Total_Amount) || 0;
  const paid = Number(fee.Amount_Paid) || 0;

  const balance = total - paid;

  return {
    balance,
    isAdvance: balance < 0,
    isPending: balance > 0,
    isCleared: balance === 0,
  };
};

/**
 * 4. Overall School Summary Total:
 * Individual student totals ke basis par Overall Total Collection aur Overall Due Balance calculate karein
 * taaki duplicate entries ki wajah se total double/triple na ho.
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

