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
    const ACADEMIC_MONTHS_ARR = ["april", "may", "june", "july", "august", "september", "october", "november", "december", "january", "february", "march"];
    const now = new Date();
    const calMonth = now.getMonth();
    const currentAcadIdx = calMonth >= 3 ? (calMonth - 2) : (calMonth + 10);

    studentRecords.forEach((r, idx) => {
      const monthKey = String(r.Month || '').trim().toLowerCase();
      const typeKey = String(r.Fee_Type || '').trim().toLowerCase();
      const isAdvanceType = /(advance|अग्रिम)/i.test(typeKey);
      const isOneTimeHead = /(admission|प्रवेश|वार्षिक|annual|uniform|यूनिफॉर्म|books|पुस्तक|stationary|exam|परीक्षा|misc|अन्य|fine|विलंब)/i.test(typeKey);

      let isFutureMonth = false;
      if (monthKey && !isOneTimeHead) {
        for (let m = 0; m < ACADEMIC_MONTHS_ARR.length; m++) {
          if (monthKey.includes(ACADEMIC_MONTHS_ARR[m])) {
            const mIdx = m + 1;
            if (mIdx > currentAcadIdx) {
              isFutureMonth = true;
            }
            break;
          }
        }
      }

      if (isFutureMonth) {
        return;
      }

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

/**
 * DYNAMIC CURRENT-MONTH DUES CALCULATION (PREVENT OVER-BILLING)
 * Calculates Total Billed Dues ONLY for months elapsed from "Session_Start_Month" up to "Current_Month".
 * Does NOT include future months in "Total Session Fee" or "Pending Dues" until those months arrive.
 */
export const calculateStudentSummary = (
  studentId: string,
  allReceipts: FeeCollectionRecord[],
  studentProfile?: Student | null
) => {
  const ACADEMIC_MONTHS = [
    "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "January", "February", "March"
  ];

  const now = new Date();
  const calMonth = now.getMonth(); // 0-11
  const currentAcadIdx = calMonth >= 3 ? (calMonth - 2) : (calMonth + 10); // April=1 ... March=12

  const startMonthStr = studentProfile?.Session_Start_Month || studentProfile?.Start_Month || "April";
  let startMonthIdx = 1;
  const cleanStart = String(startMonthStr).trim().toLowerCase();
  for (let i = 0; i < ACADEMIC_MONTHS.length; i++) {
    if (cleanStart.includes(ACADEMIC_MONTHS[i].toLowerCase())) {
      startMonthIdx = i + 1;
      break;
    }
  }

  const elapsedMonths = Math.max(0, Math.min(12, currentAcadIdx - startMonthIdx + 1));

  let monthlyTuition = 600;
  if (studentProfile?.Monthly_Fee && Number(studentProfile.Monthly_Fee) > 0) {
    monthlyTuition = Number(studentProfile.Monthly_Fee);
  } else if (studentProfile?.Class) {
    const cls = String(studentProfile.Class).toLowerCase();
    if (cls.includes('play')) monthlyTuition = 500;
    else if (cls.includes('1st') || cls.includes('2nd') || cls.includes('3rd')) monthlyTuition = 650;
    else if (cls.includes('4th') || cls.includes('5th')) monthlyTuition = 700;
    else if (cls.includes('6th') || cls.includes('7th')) monthlyTuition = 800;
    else if (cls.includes('8th')) monthlyTuition = 850;
  }

  const admissionFee = (studentProfile?.Admission_Fee !== undefined && studentProfile?.Admission_Fee !== null) ? Number(studentProfile.Admission_Fee) : 0;
  const totalBilledSessionFee = (monthlyTuition * elapsedMonths) + admissionFee;

  const rawStudentReceipts = allReceipts.filter(
    (r) => normalizeStudentId(r.Student_ID) === normalizeStudentId(studentId)
  );
  const reconciled = reconcileFeeRecords(rawStudentReceipts);
  const totalPaid = reconciled.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);
  const currentDues = Math.max(0, totalBilledSessionFee - totalPaid);

  return {
    startMonth: ACADEMIC_MONTHS[startMonthIdx - 1],
    elapsedMonths,
    monthlyTuition,
    admissionFee,
    totalBilledSessionFee,
    totalPaid,
    currentDues,
    recordsCount: reconciled.length,
    records: reconciled
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

