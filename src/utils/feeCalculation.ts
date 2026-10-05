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
        const single = groupRecs[0];
        // If a payment receipt had Total_Amount: 0 but Amount_Paid > 0, set Total_Amount to Amount_Paid if not specified
        const total = Number(single.Total_Amount) || 0;
        const paid = Number(single.Amount_Paid) || 0;
        if (total === 0 && paid > 0 && !/(advance|अग्रिम)/i.test(String(single.Fee_Type || ''))) {
          reconciledList.push({
            ...single,
            Total_Amount: paid,
            Balance_Amount: 0,
          });
        } else {
          reconciledList.push(single);
        }
        return;
      }

      // Multiple records for the same month/head:
      const payments = groupRecs.filter((r) => (Number(r.Amount_Paid) || 0) > 0);
      const billings = groupRecs.filter((r) => (Number(r.Amount_Paid) || 0) === 0 && (Number(r.Total_Amount) || 0) > 0);

      if (payments.length > 0 && billings.length > 0) {
        // We have billing entry (Total > 0, Paid = 0) and payment receipt(s) (Paid > 0)
        // Consolidate into the payment receipt(s) so that the payment is visibly reflected!
        const totalBilled = Math.max(...billings.map((b) => Number(b.Total_Amount) || 0));
        const totalPaidInGroup = payments.reduce((sum, p) => sum + (Number(p.Amount_Paid) || 0), 0);

        payments.forEach((p, idx) => {
          const authTotal = Number(p.Total_Amount) > 0 ? Number(p.Total_Amount) : totalBilled;
          const bal = Math.max(0, authTotal - totalPaidInGroup);
          reconciledList.push({
            ...p,
            Total_Amount: authTotal,
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
  const rawStudentRecords = allFeeRecords.filter((r) => {
    const rSid = normalizeStudentId(r.Student_ID);
    return Boolean(rSid && (rSid === sId || sId.includes(rSid) || rSid.includes(sId)));
  });

  // Reconcile student records
  const studentRecords = reconcileFeeRecords(rawStudentRecords);

  // 1. Total Paid Amount: Fee receipts table me se sirf Amount_Paid column ka SUM nikalein
  const totalPaid = studentRecords.reduce(
    (sum, r) => sum + (Number(r.Amount_Paid) || 0),
    0
  );

  // 2. Total Session Fee: Unique billed rows (Total_Amount) se calculate karein
  let totalSessionFee = 0;

  if (studentRecords.length > 0) {
    const uniqueBilledMap = new Map<string, number>();

    studentRecords.forEach((r, idx) => {
      const monthKey = String(r.Month || '').trim().toLowerCase();
      const typeKey = String(r.Fee_Type || '').trim().toLowerCase();
      const isAdvanceType = /(advance|अग्रिम)/i.test(typeKey);
      const isOneTimeHead = /(admission|प्रवेश|वार्षिक|annual|uniform|यूनिफॉर्म|books|पुस्तक|stationary|exam|परीक्षा|misc|अन्य|fine|विलंब)/i.test(typeKey);

      let billedKey = '';
      if (monthKey) {
        billedKey = `${monthKey}::${typeKey || 'tuition'}`;
      } else if (isOneTimeHead) {
        billedKey = `head::${typeKey}`;
      } else {
        billedKey = `receipt::${r.Receipt_Number || idx}::${typeKey || 'fee'}`;
      }

      if (!isAdvanceType) {
        const billedAmt = Number(r.Total_Amount) || 0;
        if (billedAmt > 0) {
          const existing = uniqueBilledMap.get(billedKey) || 0;
          if (billedAmt > existing) {
            uniqueBilledMap.set(billedKey, billedAmt);
          }
        }
      }
    });

    uniqueBilledMap.forEach((amt) => {
      totalSessionFee += amt;
    });

    // If receipts had Total_Amount 0 but had actual payments, ensure totalSessionFee accounts for paid
    if (totalSessionFee === 0 && totalPaid > 0) {
      totalSessionFee = totalPaid;
    }

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
  const rawBal = Number(fee.Balance_Amount);

  let balance = !isNaN(rawBal) ? rawBal : (total - paid);
  // If payment receipt where Total was omitted or 0 but Amount_Paid > 0 and rawBal is 0:
  if (total === 0 && paid > 0 && (isNaN(rawBal) || rawBal === 0)) {
    balance = 0;
  }

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

