import React, { useMemo, useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { FeeCollectionRecord, Student } from '../types';
import {
  ACADEMIC_MONTHS,
  calculateStudentSummary,
  getElapsedMonthsCount,
  getStudentHeadPaymentStatus,
  isStudentFeeExempt,
  normalizeStudentId,
} from '../utils/feeCalculation';
import { getLocalDateYMD } from '../utils/localTime';

const LEDGER_CHECKED_STORAGE_KEY = 'evs_ledger_reconciled_students_v1';

type RegisterSubView = 'head_wise' | 'month_grid';
type RegisterFilterMode = 'all' | 'unpaid' | 'paid' | 'unchecked';

interface MonthCellStatus {
  monthIndex: number; // 1 = Apr ... 12 = Mar
  short: string;
  status: 'na' | 'free' | 'paid' | 'advance' | 'partial' | 'due' | 'upcoming';
  paidAmount: number;
  dueAmount: number;
}

interface RegisterStudentRow {
  student: Student;
  studentKey: string;
  className: string;
  admNo: string;
  rollNo: string;
  fatherName: string;
  mobile: string;
  isExempt: boolean;
  startMonth: string;
  currentMonth: string;
  elapsedMonths: number;
  netMonthly: number;
  // Admission
  admFee: number;
  admPaid: number;
  admDue: number;
  // Books
  booksStandard: number;
  booksPaid: number;
  booksRemaining: number;
  booksIsPaid: boolean;
  booksIsPartial: boolean;
  // Tuition
  tuitionBilled: number;
  tuitionPaid: number;
  tuitionDue: number;
  paidMonthsEquivalent: number;
  // 12 months Apr..Mar
  months: MonthCellStatus[];
  // Exam
  examPaid: number;
  term1Paid: boolean;
  term2Paid: boolean;
  term3Paid: boolean;
  paidTermsCount: number;
  isExamFullPaid: boolean;
  examBilledDue: number;
  // Other / Transport
  otherBilledPaid: number;
  otherBilledDue: number;
  otherLabels: string[];
  // Totals & Last Receipt
  totalPaid: number;
  totalDiscount: number;
  netBalance: number;
  lastReceiptNo: string;
  lastReceiptDate: string;
}

interface ClassFeeRegisterViewProps {
  students: Student[];
  feeRecords: FeeCollectionRecord[];
  getClassName?: (c: string | undefined | null) => string;
  onOpenAddFeeModal?: (studentId?: string) => void;
  onSelectStudentProfile?: (student: Student) => void;
}

const MONTH_SHORTS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

const parseReceiptDateTs = (raw?: string): number => {
  const s = String(raw || '').trim();
  if (!s) return 0;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const dt = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return isNaN(dt.getTime()) ? 0 : dt.getTime();
  }
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
};

const formatShortDate = (raw?: string): string => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[1].padStart(2, '0')}/${dmy[2].padStart(2, '0')}/${dmy[3].slice(-2)}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
};

const classSortWeight = (rawClass: string, displayName: string): number => {
  const combined = `${rawClass} ${displayName}`.toLowerCase();
  if (/play|pg/.test(combined)) return 1;
  if (/nursery|m1\b/.test(combined)) return 2;
  if (/lkg|m2\b/.test(combined)) return 3;
  if (/ukg|m3\b/.test(combined)) return 4;
  const cMatch = rawClass.trim().match(/^c(\d+)$/i);
  if (cMatch) return 10 + Number(cMatch[1]);
  const numMatch = displayName.match(/(\d+)/);
  if (numMatch) return 14 + Number(numMatch[1]);
  return 999;
};

const sanitizeAsciiForPdf = (val: string): string => {
  const cleaned = String(val || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || '-';
};

const fitPdfText = (doc: jsPDF, text: string, maxWidthMm: number): string => {
  const clean = sanitizeAsciiForPdf(text);
  if (doc.getTextWidth(clean) <= maxWidthMm) return clean;
  let truncated = clean;
  while (truncated.length > 2 && doc.getTextWidth(`${truncated}...`) > maxWidthMm) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
};

const csvEscape = (val: string | number): string => {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const ClassFeeRegisterView: React.FC<ClassFeeRegisterViewProps> = ({
  students,
  feeRecords,
  getClassName = (c) => c || 'N/A',
  onOpenAddFeeModal,
  onSelectStudentProfile,
}) => {
  const [subView, setSubView] = useState<RegisterSubView>('head_wise');
  const [filterMode, setFilterMode] = useState<RegisterFilterMode>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);

  // Checked / Verified state for manual ledger matching (stored locally in browser only)
  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(LEDGER_CHECKED_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LEDGER_CHECKED_STORAGE_KEY, JSON.stringify(checkedMap));
    } catch {}
  }, [checkedMap]);

  // Build ordered class list from active students
  const orderedClasses = useMemo(() => {
    const map = new Map<string, { raw: string; label: string; count: number }>();
    students.forEach((s) => {
      const raw = String(s.Class || '').trim();
      const label = getClassName(raw) || raw || 'Other';
      const key = label.toLowerCase();
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(key, { raw, label, count: 1 });
      }
    });
    return Array.from(map.entries())
      .map(([key, info]) => ({ key, ...info }))
      .sort((a, b) => {
        const wa = classSortWeight(a.raw, a.label);
        const wb = classSortWeight(b.raw, b.label);
        if (wa !== wb) return wa - wb;
        return a.label.localeCompare(b.label, 'en', { numeric: true, sensitivity: 'base' });
      });
  }, [students, getClassName]);

  const [selectedClassKey, setSelectedClassKey] = useState<string>(() => orderedClasses[0]?.key || '');

  useEffect(() => {
    if (orderedClasses.length > 0 && !orderedClasses.some((c) => c.key === selectedClassKey)) {
      setSelectedClassKey(orderedClasses[0].key);
    }
  }, [orderedClasses, selectedClassKey]);

  // Pre-index latest payment receipt per student across all feeRecords
  const latestReceiptByStudent = useMemo(() => {
    const map = new Map<string, { recNo: string; dateStr: string; ts: number }>();
    feeRecords.forEach((r) => {
      const sid = normalizeStudentId(r.Student_ID);
      if (!sid) return;
      if ((Number(r.Amount_Paid) || 0) <= 0) return;
      const ts = parseReceiptDateTs(r.Date);
      const prev = map.get(sid);
      if (!prev || ts >= prev.ts) {
        map.set(sid, {
          recNo: String(r.Receipt_Number || '').trim() || 'REC',
          dateStr: String(r.Date || '').trim(),
          ts,
        });
      }
    });
    return map;
  }, [feeRecords]);

  // Compute full register rows for any given class students array
  const computeRegisterRowsForStudents = useMemo(() => {
    return (classStudentList: Student[]): RegisterStudentRow[] => {
      const sortedStudents = [...classStudentList].sort((a, b) => {
        const rA = String(a.Roll_Number || a.Admission_Number || '').trim();
        const rB = String(b.Roll_Number || b.Admission_Number || '').trim();
        if (rA && rB) {
          const cmp = rA.localeCompare(rB, undefined, { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
        }
        return String(a.Student_Name || '').localeCompare(String(b.Student_Name || ''), 'en', {
          sensitivity: 'base',
        });
      });

      return sortedStudents.map((s) => {
        const normId = normalizeStudentId(s.Student_ID);
        const studentKey = normId || String(s.Admission_Number || s.Student_Name || '');
        const summary = calculateStudentSummary(s.Student_ID, feeRecords, s);
        const headStatus = getStudentHeadPaymentStatus(s, feeRecords);
        const isExempt = isStudentFeeExempt(s);
        const { startMonthIdx, currentAcadIdx } = getElapsedMonthsCount(
          s.Session_Start_Month || s.Start_Month
        );

        const netMonthly = Math.max(0, summary.netMonthlyTuition);
        // Net tuition settled beyond the permanent monthly discount across elapsed months
        const permDiscTotal = summary.monthlyDiscount * summary.elapsedMonths;
        const tuitionReceiptDisc = Math.max(
          0,
          (summary.tuitionBilled - summary.tuitionDue - summary.tuitionPaid) - permDiscTotal
        );
        let remainingTuitionCredit = Math.max(0, summary.tuitionPaid + tuitionReceiptDisc);

        const months: MonthCellStatus[] = ACADEMIC_MONTHS.map((mName, idx) => {
          const mOrder = idx + 1; // 1 = Apr ... 12 = Mar
          const short = MONTH_SHORTS[idx] || mName.slice(0, 3);

          if (mOrder < startMonthIdx) {
            return { monthIndex: mOrder, short, status: 'na', paidAmount: 0, dueAmount: 0 };
          }
          if (isExempt || netMonthly === 0) {
            return {
              monthIndex: mOrder,
              short,
              status: mOrder <= currentAcadIdx ? 'free' : 'upcoming',
              paidAmount: 0,
              dueAmount: 0,
            };
          }

          if (mOrder <= currentAcadIdx) {
            if (remainingTuitionCredit >= netMonthly) {
              remainingTuitionCredit -= netMonthly;
              return { monthIndex: mOrder, short, status: 'paid', paidAmount: netMonthly, dueAmount: 0 };
            }
            if (remainingTuitionCredit > 0) {
              const paidAmt = Math.round(remainingTuitionCredit);
              const dueAmt = Math.max(0, Math.round(netMonthly - remainingTuitionCredit));
              remainingTuitionCredit = 0;
              return { monthIndex: mOrder, short, status: 'partial', paidAmount: paidAmt, dueAmount: dueAmt };
            }
            return { monthIndex: mOrder, short, status: 'due', paidAmount: 0, dueAmount: netMonthly };
          }

          // Future month (mOrder > currentAcadIdx) — check if advance payment covers it
          if (remainingTuitionCredit >= netMonthly) {
            remainingTuitionCredit -= netMonthly;
            return { monthIndex: mOrder, short, status: 'advance', paidAmount: netMonthly, dueAmount: 0 };
          }
          if (remainingTuitionCredit > 0) {
            const paidAmt = Math.round(remainingTuitionCredit);
            remainingTuitionCredit = 0;
            return { monthIndex: mOrder, short, status: 'advance', paidAmount: paidAmt, dueAmount: 0 };
          }
          return { monthIndex: mOrder, short, status: 'upcoming', paidAmount: 0, dueAmount: 0 };
        });

        const otherItems = summary.itemizedOtherFees || [];
        const examBilledItems = otherItems.filter((f) => /exam|परीक्षा/i.test(f.type));
        const examBilledDue = examBilledItems.reduce((sum, f) => sum + Math.max(0, f.balance), 0);

        const nonExamNonBookItems = otherItems.filter(
          (f) => !/exam|परीक्षा|book|पुस्तक|stationary/i.test(f.type)
        );
        const otherBilledPaid = nonExamNonBookItems.reduce((sum, f) => sum + Math.max(0, f.paid), 0);
        const otherBilledDue = nonExamNonBookItems.reduce((sum, f) => sum + Math.max(0, f.balance), 0);
        const otherLabels = nonExamNonBookItems.map((f) => f.type);

        const paidMonthsEquivalent =
          netMonthly > 0
            ? Math.min(summary.elapsedMonths, Math.floor((summary.tuitionPaid + tuitionReceiptDisc + 0.01) / netMonthly))
            : summary.elapsedMonths;

        const latest = normId ? latestReceiptByStudent.get(normId) : undefined;

        return {
          student: s,
          studentKey,
          className: getClassName(s.Class) || s.Class || '',
          admNo: String(s.Admission_Number || '—'),
          rollNo: String(s.Roll_Number || '—'),
          fatherName: String(s.Father_Name || '—'),
          mobile: String(s.Parent_Mobile || '—'),
          isExempt,
          startMonth: summary.startMonth,
          currentMonth: summary.currentMonth,
          elapsedMonths: summary.elapsedMonths,
          netMonthly,
          admFee: summary.admissionFee,
          admPaid: summary.admissionPaid,
          admDue: summary.admissionDue,
          booksStandard: headStatus.books.standardFee,
          booksPaid: headStatus.books.paid,
          booksRemaining: headStatus.books.remaining,
          booksIsPaid: headStatus.books.isPaid,
          booksIsPartial: headStatus.books.isPartial,
          tuitionBilled: summary.tuitionBilled,
          tuitionPaid: summary.tuitionPaid,
          tuitionDue: summary.tuitionDue,
          paidMonthsEquivalent,
          months,
          examPaid: headStatus.exam.paid,
          term1Paid: headStatus.exam.term1Paid,
          term2Paid: headStatus.exam.term2Paid,
          term3Paid: headStatus.exam.term3Paid,
          paidTermsCount: headStatus.exam.paidTermsCount,
          isExamFullPaid: headStatus.exam.isFullYearPaid,
          examBilledDue,
          otherBilledPaid,
          otherBilledDue,
          otherLabels,
          totalPaid: summary.totalPaid,
          totalDiscount: summary.totalDiscount,
          netBalance: summary.netBalance,
          lastReceiptNo: latest?.recNo || '',
          lastReceiptDate: latest?.dateStr || '',
        };
      });
    };
  }, [feeRecords, getClassName, latestReceiptByStudent]);

  // Rows for currently selected class
  const selectedClassInfo = orderedClasses.find((c) => c.key === selectedClassKey) || orderedClasses[0];

  const classAllRows = useMemo(() => {
    if (!selectedClassInfo) return [];
    const matching = students.filter(
      (s) => (getClassName(s.Class) || s.Class || 'Other').toLowerCase() === selectedClassInfo.key
    );
    return computeRegisterRowsForStudents(matching);
  }, [students, selectedClassInfo, getClassName, computeRegisterRowsForStudents]);

  // Filtered rows inside selected class
  const displayedRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return classAllRows.filter((row) => {
      if (q) {
        const hay = `${row.student.Student_Name} ${row.fatherName} ${row.admNo} ${row.rollNo} ${row.mobile} ${row.lastReceiptNo}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filterMode === 'unpaid' && row.netBalance <= 0) return false;
      if (filterMode === 'paid' && row.netBalance > 0) return false;
      if (filterMode === 'unchecked' && checkedMap[row.studentKey]) return false;
      return true;
    });
  }, [classAllRows, searchTerm, filterMode, checkedMap]);

  // Grand Totals for currently displayed rows (bottom footer row)
  const grandTotals = useMemo(() => {
    const monthPaidSums = Array(12).fill(0);
    const monthDueSums = Array(12).fill(0);
    let admFee = 0;
    let admPaid = 0;
    let admDue = 0;
    let booksPaid = 0;
    let tuitionBilled = 0;
    let tuitionPaid = 0;
    let tuitionDue = 0;
    let examPaid = 0;
    let otherPaid = 0;
    let otherDue = 0;
    let totalPaid = 0;
    let totalDiscount = 0;
    let totalNetDue = 0;
    let totalAdvance = 0;
    let checkedCount = 0;
    let unpaidStudents = 0;

    displayedRows.forEach((r) => {
      admFee += r.admFee;
      admPaid += r.admPaid;
      admDue += r.admDue;
      booksPaid += r.booksPaid;
      tuitionBilled += r.tuitionBilled;
      tuitionPaid += r.tuitionPaid;
      tuitionDue += r.tuitionDue;
      examPaid += r.examPaid;
      otherPaid += r.otherBilledPaid;
      otherDue += r.otherBilledDue;
      totalPaid += r.totalPaid;
      totalDiscount += r.totalDiscount;
      if (r.netBalance > 0) {
        totalNetDue += r.netBalance;
        unpaidStudents += 1;
      } else if (r.netBalance < 0) {
        totalAdvance += Math.abs(r.netBalance);
      }
      if (checkedMap[r.studentKey]) checkedCount += 1;
      r.months.forEach((m, idx) => {
        monthPaidSums[idx] += m.paidAmount;
        monthDueSums[idx] += m.dueAmount;
      });
    });

    return {
      admFee,
      admPaid,
      admDue,
      booksPaid,
      tuitionBilled,
      tuitionPaid,
      tuitionDue,
      examPaid,
      otherPaid,
      otherDue,
      totalPaid,
      totalDiscount,
      totalNetDue,
      totalAdvance,
      checkedCount,
      unpaidStudents,
      paidStudents: displayedRows.length - unpaidStudents,
      monthPaidSums,
      monthDueSums,
    };
  }, [displayedRows, checkedMap]);

  const classCheckedCount = useMemo(
    () => classAllRows.filter((r) => checkedMap[r.studentKey]).length,
    [classAllRows, checkedMap]
  );

  const toggleCheckedStudent = (key: string) => {
    setCheckedMap((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleClearClassChecks = () => {
    setCheckedMap((prev) => {
      const next = { ...prev };
      classAllRows.forEach((r) => {
        delete next[r.studentKey];
      });
      return next;
    });
  };

  const showToast = (msg: string) => {
    setExportStatusMsg(msg);
    setTimeout(() => setExportStatusMsg(null), 4500);
  };

  // =========================================================================
  // EXPORT TO EXCEL (.CSV WITH UTF-8 BOM FOR CLEAN HINDI + ENGLISH OPENING)
  // =========================================================================
  const handleExportCsv = (scope: 'selected' | 'all') => {
    const classBatches =
      scope === 'selected' && selectedClassInfo
        ? [{ label: selectedClassInfo.label, rows: displayedRows }]
        : orderedClasses.map((cls) => ({
            label: cls.label,
            rows: computeRegisterRowsForStudents(
              students.filter((s) => (getClassName(s.Class) || s.Class || 'Other').toLowerCase() === cls.key)
            ),
          }));

    const lines: string[] = [];

    if (subView === 'head_wise') {
      lines.push(
        [
          'Class',
          'Roll No',
          'Adm No',
          'Student Name',
          'Father Name',
          'Mobile',
          'Adm Fee Status',
          'Adm Paid',
          'Adm Due',
          'Books Status',
          'Books Paid',
          'Tuition Paid Months',
          'Tuition Paid',
          'Tuition Due',
          'Exam Terms (T1/T2/T3)',
          'Exam Paid',
          'Other Paid',
          'Other Due',
          'Total Paid',
          'Discount',
          'Net Balance (Due/Adv)',
          'Last Receipt No',
          'Last Paid Date',
          'Ledger Verified',
        ]
          .map(csvEscape)
          .join(',')
      );

      classBatches.forEach((batch) => {
        let sumAdmPaid = 0;
        let sumAdmDue = 0;
        let sumBooksPaid = 0;
        let sumTuitPaid = 0;
        let sumTuitDue = 0;
        let sumExamPaid = 0;
        let sumOtherPaid = 0;
        let sumOtherDue = 0;
        let sumTotalPaid = 0;
        let sumDisc = 0;
        let sumNetDue = 0;

        batch.rows.forEach((r) => {
          sumAdmPaid += r.admPaid;
          sumAdmDue += r.admDue;
          sumBooksPaid += r.booksPaid;
          sumTuitPaid += r.tuitionPaid;
          sumTuitDue += r.tuitionDue;
          sumExamPaid += r.examPaid;
          sumOtherPaid += r.otherBilledPaid;
          sumOtherDue += r.otherBilledDue;
          sumTotalPaid += r.totalPaid;
          sumDisc += r.totalDiscount;
          if (r.netBalance > 0) sumNetDue += r.netBalance;

          const admStatus = r.admDue > 0 ? `Due ${r.admDue}` : r.admFee > 0 ? 'Paid' : 'Rs.0';
          const booksStatus = r.booksIsPaid
            ? 'Paid'
            : r.booksIsPartial
            ? `Partial (Due ${r.booksRemaining})`
            : 'Pending/Unbilled';
          const examLabel = r.isExamFullPaid
            ? '3x Paid'
            : `T1:${r.term1Paid ? 'OK' : 'Due'} | T2:${r.term2Paid ? 'OK' : 'Due'} | T3:${r.term3Paid ? 'OK' : 'Due'}`;
          const netLabel =
            r.netBalance > 0
              ? `Due ${r.netBalance}`
              : r.netBalance < 0
              ? `Advance ${Math.abs(r.netBalance)}`
              : 'Paid (0)';

          lines.push(
            [
              batch.label,
              r.rollNo,
              r.admNo,
              r.student.Student_Name || '',
              r.fatherName,
              r.mobile,
              admStatus,
              r.admPaid,
              r.admDue,
              booksStatus,
              r.booksPaid,
              r.isExempt ? 'Free' : `${r.paidMonthsEquivalent}/${r.elapsedMonths}`,
              r.tuitionPaid,
              r.tuitionDue,
              examLabel,
              r.examPaid,
              r.otherBilledPaid,
              r.otherBilledDue,
              r.totalPaid,
              r.totalDiscount,
              netLabel,
              r.lastReceiptNo || '-',
              r.lastReceiptDate || '-',
              checkedMap[r.studentKey] ? 'Verified' : 'Pending',
            ]
              .map(csvEscape)
              .join(',')
          );
        });

        lines.push(
          [
            `${batch.label} TOTAL`,
            `${batch.rows.length} Students`,
            '',
            '',
            '',
            '',
            '',
            sumAdmPaid,
            sumAdmDue,
            '',
            sumBooksPaid,
            '',
            sumTuitPaid,
            sumTuitDue,
            '',
            sumExamPaid,
            sumOtherPaid,
            sumOtherDue,
            sumTotalPaid,
            sumDisc,
            `Due ${sumNetDue}`,
            '',
            '',
            '',
          ]
            .map(csvEscape)
            .join(',')
        );
      });
    } else {
      // 12-Month Apr-Mar Grid CSV
      lines.push(
        [
          'Class',
          'Roll No',
          'Student Name',
          'Father Name',
          ...MONTH_SHORTS,
          'Adm Paid/Due',
          'Exam Terms',
          'Total Paid',
          'Net Due/Adv',
          'Last Receipt',
          'Ledger Verified',
        ]
          .map(csvEscape)
          .join(',')
      );

      classBatches.forEach((batch) => {
        const mSums = Array(12).fill(0);
        let sumPaid = 0;
        let sumDue = 0;

        batch.rows.forEach((r) => {
          sumPaid += r.totalPaid;
          if (r.netBalance > 0) sumDue += r.netBalance;

          const monthCells = r.months.map((m, idx) => {
            mSums[idx] += m.paidAmount;
            if (m.status === 'paid' || m.status === 'advance') return `Paid ${m.paidAmount}`;
            if (m.status === 'partial') return `Part ${m.paidAmount} (Due ${m.dueAmount})`;
            if (m.status === 'due') return `Due ${m.dueAmount}`;
            if (m.status === 'free') return 'Free';
            return '-';
          });

          const admCol = r.admDue > 0 ? `Due ${r.admDue}` : r.admFee > 0 ? 'Paid' : '0';
          const examCol = r.isExamFullPaid
            ? '3x Paid'
            : `${r.paidTermsCount}/3 Paid`;
          const netLabel =
            r.netBalance > 0
              ? `Due ${r.netBalance}`
              : r.netBalance < 0
              ? `Adv ${Math.abs(r.netBalance)}`
              : '0 (Paid)';

          lines.push(
            [
              batch.label,
              r.rollNo,
              r.student.Student_Name || '',
              r.fatherName,
              ...monthCells,
              admCol,
              examCol,
              r.totalPaid,
              netLabel,
              r.lastReceiptNo ? `${r.lastReceiptNo} (${r.lastReceiptDate})` : '-',
              checkedMap[r.studentKey] ? 'Verified' : 'Pending',
            ]
              .map(csvEscape)
              .join(',')
          );
        });

        lines.push(
          [
            `${batch.label} TOTAL`,
            `${batch.rows.length} Students`,
            '',
            '',
            ...mSums,
            '',
            '',
            sumPaid,
            `Due ${sumDue}`,
            '',
            '',
          ]
            .map(csvEscape)
            .join(',')
        );
      });
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug =
      scope === 'selected' && selectedClassInfo
        ? selectedClassInfo.label.replace(/[^a-z0-9]+/gi, '_')
        : 'All_Classes';
    const viewSlug = subView === 'head_wise' ? 'HeadWise' : 'Apr_Mar_Grid';
    link.href = url;
    link.download = `EVS_Fee_Register_${slug}_${viewSlug}_${getLocalDateYMD()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Excel CSV डाउनलोड हो गई (${scope === 'selected' ? selectedClassInfo?.label : 'सभी कक्षाएं'})!`);
  };

  // =========================================================================
  // GENERATE A4 LANDSCAPE PRINTABLE PDF (1 CLASS PER PAGE) USING jsPDF
  // =========================================================================
  const handleDownloadPdf = (scope: 'selected' | 'all') => {
    const classBatches =
      scope === 'selected' && selectedClassInfo
        ? [{ label: selectedClassInfo.label, rows: displayedRows }]
        : orderedClasses.map((cls) => ({
            label: cls.label,
            rows: computeRegisterRowsForStudents(
              students.filter((s) => (getClassName(s.Class) || s.Class || 'Other').toLowerCase() === cls.key)
            ),
          }));

    if (classBatches.length === 0) return;

    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 297;
    const pageHeight = 210;
    const marginX = 8;
    const usableW = pageWidth - marginX * 2; // 281 mm
    const printDate = getLocalDateYMD();
    let isFirstPage = true;

    const renderPageHeader = (classLabel: string, rows: RegisterStudentRow[], pageNo: number) => {
      const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
      const totalDue = rows.reduce((s, r) => s + (r.netBalance > 0 ? r.netBalance : 0), 0);
      const unpaidCnt = rows.filter((r) => r.netBalance > 0).length;

      // Navy Header Band
      doc.setFillColor(12, 35, 64);
      doc.rect(marginX, 7, usableW, 15, 'F');
      doc.setDrawColor(245, 158, 11);
      doc.setLineWidth(0.6);
      doc.line(marginX, 22, marginX + usableW, 22);

      doc.setTextColor(253, 224, 71);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('E.V.S. PUBLIC SCHOOL — CLASS FEE REGISTER & LEDGER SHEET', marginX + 4, 13.5);

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      const modeText = subView === 'head_wise' ? 'Fee Head-Wise Register' : 'Apr to Mar (12-Month Ledger Grid)';
      doc.text(
        `Class: ${sanitizeAsciiForPdf(classLabel)}   |   View: ${modeText}   |   Date: ${printDate}   |   Sheet Page ${pageNo}`,
        marginX + 4,
        19
      );

      // Right summary pills inside header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(167, 243, 208);
      doc.text(
        `Students: ${rows.length} (Unpaid: ${unpaidCnt})   |   Paid: Rs.${totalPaid.toLocaleString('en-IN')}   |   Due: Rs.${totalDue.toLocaleString('en-IN')}`,
        marginX + usableW - 4,
        16,
        { align: 'right' }
      );
    };

    classBatches.forEach((batch) => {
      const rows = batch.rows;
      if (rows.length === 0 && scope === 'all') return;

      const rowH = 7;
      const startTableY = 25;
      const maxRowsPerPage = 22;

      const totalPagesForClass = Math.max(1, Math.ceil(rows.length / maxRowsPerPage));

      for (let pIdx = 0; pIdx < totalPagesForClass; pIdx++) {
        if (!isFirstPage) doc.addPage();
        isFirstPage = false;

        renderPageHeader(batch.label, rows, pIdx + 1);
        const pageRows = rows.slice(pIdx * maxRowsPerPage, (pIdx + 1) * maxRowsPerPage);

        if (subView === 'head_wise') {
          const cols = [
            { title: 'Roll', w: 14, align: 'center' as const },
            { title: 'Student Name & Father', w: 53, align: 'left' as const },
            { title: 'Adm Fee', w: 23, align: 'center' as const },
            { title: 'Books', w: 22, align: 'center' as const },
            { title: 'Tuition (Mo)', w: 34, align: 'center' as const },
            { title: 'Exam (T1/T2/T3)', w: 32, align: 'center' as const },
            { title: 'Other/Van', w: 21, align: 'center' as const },
            { title: 'Total Paid', w: 24, align: 'right' as const },
            { title: 'Net Due/Status', w: 28, align: 'right' as const },
            { title: 'Last Receipt / Check', w: 30, align: 'left' as const },
          ];

          // Header row
          let curX = marginX;
          let curY = startTableY;
          doc.setFillColor(226, 232, 240);
          doc.rect(marginX, curY, usableW, 7.5, 'F');
          doc.setDrawColor(148, 163, 184);
          doc.setLineWidth(0.2);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.2);
          doc.setTextColor(15, 23, 42);

          cols.forEach((c) => {
            doc.rect(curX, curY, c.w, 7.5, 'S');
            const tx = c.align === 'right' ? curX + c.w - 1.5 : c.align === 'center' ? curX + c.w / 2 : curX + 1.5;
            doc.text(c.title, tx, curY + 5, { align: c.align === 'left' ? 'left' : c.align });
            curX += c.w;
          });
          curY += 7.5;

          pageRows.forEach((r, idx) => {
            const isUnpaid = r.netBalance > 0;
            doc.setFillColor(isUnpaid ? 255 : 240, isUnpaid ? 241 : 253, isUnpaid ? 242 : 244);
            if (idx % 2 === 1 && !isUnpaid) doc.setFillColor(236, 253, 245);
            doc.rect(marginX, curY, usableW, rowH, 'F');

            const admText = r.admDue > 0 ? `Due ${r.admDue}` : r.admFee > 0 ? `Paid ${r.admPaid}` : 'Rs.0';
            const booksText = r.booksIsPaid ? 'Paid' : r.booksIsPartial ? `Due ${r.booksRemaining}` : '-';
            const tuitText = r.isExempt
              ? 'Free'
              : r.tuitionDue > 0
              ? `${r.paidMonthsEquivalent}/${r.elapsedMonths}m Due ${r.tuitionDue}`
              : `${r.paidMonthsEquivalent}/${r.elapsedMonths}m Paid`;
            const examText = r.isExamFullPaid
              ? '3x Paid'
              : `${r.term1Paid ? '1' : '-'}/${r.term2Paid ? '2' : '-'}/${r.term3Paid ? '3' : '-'}`;
            const otherText =
              r.otherBilledDue > 0 ? `Due ${r.otherBilledDue}` : r.otherBilledPaid > 0 ? `Paid ${r.otherBilledPaid}` : '-';
            const netText =
              r.netBalance > 0
                ? `DUE Rs.${r.netBalance}`
                : r.netBalance < 0
                ? `ADV Rs.${Math.abs(r.netBalance)}`
                : 'PAID Rs.0';
            const recText = r.lastReceiptNo
              ? `${r.lastReceiptNo} (${formatShortDate(r.lastReceiptDate)})`
              : '[ ] No Rec';

            const cellVals = [
              r.rollNo !== '—' ? r.rollNo : r.admNo,
              `${r.student.Student_Name || ''} (${r.fatherName})`,
              admText,
              booksText,
              tuitText,
              examText,
              otherText,
              `Rs.${r.totalPaid}`,
              netText,
              recText,
            ];

            curX = marginX;
            cols.forEach((c, ci) => {
              doc.setDrawColor(203, 213, 225);
              doc.rect(curX, curY, c.w, rowH, 'S');
              doc.setFont('helvetica', ci === 1 || ci === 8 ? 'bold' : 'normal');
              doc.setFontSize(6.8);
              if (ci === 8) {
                doc.setTextColor(isUnpaid ? 185 : 21, isUnpaid ? 28 : 128, isUnpaid ? 28 : 61);
              } else {
                doc.setTextColor(30, 41, 59);
              }
              const tx = c.align === 'right' ? curX + c.w - 1.5 : c.align === 'center' ? curX + c.w / 2 : curX + 1.5;
              doc.text(fitPdfText(doc, cellVals[ci], c.w - 3), tx, curY + 4.7, {
                align: c.align === 'left' ? 'left' : c.align,
              });
              curX += c.w;
            });
            curY += rowH;
          });

          // Grand Total Footer on last page of each class
          if (pIdx === totalPagesForClass - 1) {
            const sumAdmPaid = rows.reduce((s, r) => s + r.admPaid, 0);
            const sumAdmDue = rows.reduce((s, r) => s + r.admDue, 0);
            const sumBooks = rows.reduce((s, r) => s + r.booksPaid, 0);
            const sumTuitPaid = rows.reduce((s, r) => s + r.tuitionPaid, 0);
            const sumTuitDue = rows.reduce((s, r) => s + r.tuitionDue, 0);
            const sumExam = rows.reduce((s, r) => s + r.examPaid, 0);
            const sumOther = rows.reduce((s, r) => s + r.otherBilledPaid, 0);
            const sumTotalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
            const sumTotalDue = rows.reduce((s, r) => s + (r.netBalance > 0 ? r.netBalance : 0), 0);

            doc.setFillColor(12, 35, 64);
            doc.rect(marginX, curY, usableW, rowH + 0.5, 'F');
            const footVals = [
              'TOT',
              `${batch.label} (${rows.length} Students)`,
              `${sumAdmPaid}/${sumAdmDue}`,
              `${sumBooks}`,
              `P:${sumTuitPaid} D:${sumTuitDue}`,
              `Rs.${sumExam}`,
              `Rs.${sumOther}`,
              `Rs.${sumTotalPaid}`,
              `DUE Rs.${sumTotalDue}`,
              'Sign: ________',
            ];
            curX = marginX;
            cols.forEach((c, ci) => {
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(6.8);
              doc.setTextColor(253, 224, 71);
              const tx = c.align === 'right' ? curX + c.w - 1.5 : c.align === 'center' ? curX + c.w / 2 : curX + 1.5;
              doc.text(fitPdfText(doc, footVals[ci], c.w - 2.5), tx, curY + 5, {
                align: c.align === 'left' ? 'left' : c.align,
              });
              curX += c.w;
            });
          }
        } else {
          // 12-Month Apr..Mar Grid PDF
          const cols = [
            { title: 'Roll', w: 12, align: 'center' as const },
            { title: 'Student Name', w: 39, align: 'left' as const },
            ...MONTH_SHORTS.map((m) => ({ title: m, w: 14.5, align: 'center' as const })),
            { title: 'Adm/Exm', w: 18, align: 'center' as const },
            { title: 'Paid', w: 18, align: 'right' as const },
            { title: 'Net Due', w: 20, align: 'right' as const },
          ];

          let curX = marginX;
          let curY = startTableY;
          doc.setFillColor(226, 232, 240);
          doc.rect(marginX, curY, usableW, 7.5, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.8);
          doc.setTextColor(15, 23, 42);

          cols.forEach((c) => {
            doc.setDrawColor(148, 163, 184);
            doc.rect(curX, curY, c.w, 7.5, 'S');
            const tx = c.align === 'right' ? curX + c.w - 1.2 : c.align === 'center' ? curX + c.w / 2 : curX + 1.2;
            doc.text(c.title, tx, curY + 5, { align: c.align === 'left' ? 'left' : c.align });
            curX += c.w;
          });
          curY += 7.5;

          pageRows.forEach((r) => {
            const isUnpaid = r.netBalance > 0;
            curX = marginX;

            // Roll & Name
            cols.forEach((c, ci) => {
              let fill: [number, number, number] = [255, 255, 255];
              let textColor: [number, number, number] = [30, 41, 59];
              let textVal = '';

              if (ci === 0) {
                textVal = r.rollNo !== '—' ? r.rollNo : r.admNo;
              } else if (ci === 1) {
                textVal = r.student.Student_Name || '';
              } else if (ci >= 2 && ci <= 13) {
                const m = r.months[ci - 2];
                if (m.status === 'paid' || m.status === 'advance') {
                  fill = [220, 252, 231];
                  textColor = [22, 101, 52];
                  textVal = `${m.paidAmount}`;
                } else if (m.status === 'partial') {
                  fill = [254, 243, 199];
                  textColor = [146, 64, 14];
                  textVal = `P:${m.paidAmount}`;
                } else if (m.status === 'due') {
                  fill = [254, 226, 226];
                  textColor = [185, 28, 28];
                  textVal = `D:${m.dueAmount}`;
                } else if (m.status === 'free') {
                  fill = [236, 253, 245];
                  textColor = [4, 120, 87];
                  textVal = 'FREE';
                } else {
                  fill = [248, 250, 252];
                  textColor = [148, 163, 184];
                  textVal = '-';
                }
              } else if (ci === 14) {
                const admOk = r.admDue <= 0 ? 'A:OK' : `A:${r.admDue}`;
                const exmOk = r.isExamFullPaid ? 'E:3x' : `E:${r.paidTermsCount}`;
                textVal = `${admOk} ${exmOk}`;
              } else if (ci === 15) {
                textVal = `${r.totalPaid}`;
              } else if (ci === 16) {
                fill = isUnpaid ? [254, 226, 226] : [220, 252, 231];
                textColor = isUnpaid ? [185, 28, 28] : [22, 101, 52];
                textVal = r.netBalance > 0 ? `${r.netBalance}` : r.netBalance < 0 ? `-${Math.abs(r.netBalance)}` : '0';
              }

              doc.setFillColor(...fill);
              doc.rect(curX, curY, c.w, rowH, 'F');
              doc.setDrawColor(203, 213, 225);
              doc.rect(curX, curY, c.w, rowH, 'S');
              doc.setFont('helvetica', ci === 1 || ci === 16 ? 'bold' : 'normal');
              doc.setFontSize(6.5);
              doc.setTextColor(...textColor);
              const tx = c.align === 'right' ? curX + c.w - 1.2 : c.align === 'center' ? curX + c.w / 2 : curX + 1.2;
              doc.text(fitPdfText(doc, textVal, c.w - 2), tx, curY + 4.7, {
                align: c.align === 'left' ? 'left' : c.align,
              });
              curX += c.w;
            });
            curY += rowH;
          });

          if (pIdx === totalPagesForClass - 1) {
            const mSums = Array(12).fill(0);
            rows.forEach((r) => r.months.forEach((m, i) => (mSums[i] += m.paidAmount)));
            const sumPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
            const sumDue = rows.reduce((s, r) => s + (r.netBalance > 0 ? r.netBalance : 0), 0);

            doc.setFillColor(12, 35, 64);
            doc.rect(marginX, curY, usableW, rowH + 0.5, 'F');
            const footVals = ['TOT', `${batch.label} (${rows.length})`, ...mSums.map((v) => `${v}`), 'Total', `${sumPaid}`, `${sumDue}`];
            curX = marginX;
            cols.forEach((c, ci) => {
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(6.3);
              doc.setTextColor(253, 224, 71);
              const tx = c.align === 'right' ? curX + c.w - 1.2 : c.align === 'center' ? curX + c.w / 2 : curX + 1.2;
              doc.text(fitPdfText(doc, footVals[ci], c.w - 1.5), tx, curY + 5, {
                align: c.align === 'left' ? 'left' : c.align,
              });
              curX += c.w;
            });
          }
        }
      }
    });

    const slug =
      scope === 'selected' && selectedClassInfo
        ? selectedClassInfo.label.replace(/[^a-z0-9]+/gi, '_')
        : 'All_Classes_1PerPage';
    const viewSlug = subView === 'head_wise' ? 'HeadWise' : '12Month_Grid';
    doc.save(`EVS_Fee_Register_${slug}_${viewSlug}_${printDate}.pdf`);
    showToast(`A4 Print PDF डाउनलोड हो गई (${scope === 'selected' ? selectedClassInfo?.label : 'सभी कक्षाएं — हर क्लास नए पेज पर'})!`);
  };

  return (
    <div className="px-4 sm:px-6 pb-6 space-y-4 animate-fadeIn">
      {/* 1. REGISTER TOP HEADER & RECONCILIATION INFO */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] rounded-2xl p-4 sm:p-5 text-white shadow-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black text-[10px] uppercase tracking-wider">
                📒 Class-Wise Ledger Reconciliation
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold">
                लाइव Students व Fee_Collection से स्वतः तैयार (कोई अलग शीट टैब आवश्यक नहीं)
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-black text-white">
              कक्षा-वार फीस रजिस्टर व खाता मिलान पेज (Class Fee Register)
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              ऑफ़लाइन रजिस्टर से एक-एक छात्र और हर फीस मद (Admission, Books, Apr–Mar Tuition, Exam) का मिलान करें, ✓ टिक लगाएं और A4 PDF/Excel निकालें।
            </p>
          </div>

          {/* Print / PDF & Excel Export Buttons */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleDownloadPdf('selected')}
              className="px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-all active:scale-95"
              title="चुनी हुई क्लास का A4 Landscape प्रिंटेबल PDF डाउनलोड करें"
            >
              <i className="fa-solid fa-print"></i>
              <span>Print / PDF (यह क्लास)</span>
            </button>

            <button
              type="button"
              onClick={() => handleDownloadPdf('all')}
              className="px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/25 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
              title="सभी कक्षाओं का PDF निकालें (हर क्लास नए पेज पर)"
            >
              <i className="fa-solid fa-file-pdf text-amber-300"></i>
              <span>All Classes PDF</span>
            </button>

            <button
              type="button"
              onClick={() => handleExportCsv('selected')}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition-all"
              title="चुनी हुई क्लास का Excel (.csv) डाउनलोड करें"
            >
              <i className="fa-solid fa-file-excel"></i>
              <span>Excel (यह क्लास)</span>
            </button>

            <button
              type="button"
              onClick={() => handleExportCsv('all')}
              className="px-3 py-2 rounded-xl bg-emerald-800/80 hover:bg-emerald-700 text-emerald-100 border border-emerald-400/30 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-all"
              title="पूरे स्कूल की सभी कक्षाओं का Excel (.csv) डाउनलोड करें"
            >
              <i className="fa-solid fa-table"></i>
              <span>All Excel</span>
            </button>
          </div>
        </div>
      </div>

      {exportStatusMsg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-emerald-600"></i>
          <span>{exportStatusMsg}</span>
        </div>
      )}

      {/* 2. CLASS PILLS SELECTOR + VIEW MODE SWITCHER */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
        {/* Quick Class Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-600 mr-1 flex items-center gap-1">
            <i className="fa-solid fa-graduation-cap text-blue-900"></i>
            <span>कक्षा चुनें:</span>
          </span>
          {orderedClasses.map((cls) => {
            const active = cls.key === selectedClassInfo?.key;
            return (
              <button
                key={cls.key}
                type="button"
                onClick={() => setSelectedClassKey(cls.key)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                  active
                    ? 'bg-[#0c2340] text-amber-300 border-[#0c2340] shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <span>{cls.label}</span>
                <span
                  className={`text-[10px] px-1 rounded tabular-nums ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {cls.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Sub-view switcher (Head-Wise vs Apr-Mar 12-Month Grid) + Search + Filter */}
        <div className="pt-2.5 border-t border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex bg-white p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setSubView('head_wise')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  subView === 'head_wise'
                    ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-table-columns"></i>
                <span>View A: हेड-वार रजिस्टर (Head-Wise)</span>
              </button>
              <button
                type="button"
                onClick={() => setSubView('month_grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                  subView === 'month_grid'
                    ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-calendar-days"></i>
                <span>View B: Apr–Mar (12-Month चार्ट)</span>
              </button>
            </div>

            {/* Quick Status Filter */}
            <div className="inline-flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 text-xs">
              {(
                [
                  { id: 'all', label: `All (${classAllRows.length})` },
                  { id: 'unpaid', label: '🔴 बकाया' },
                  { id: 'paid', label: '🟢 जमा' },
                  { id: 'unchecked', label: '⬜ मिलान शेष' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFilterMode(opt.id)}
                  className={`px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-all ${
                    filterMode === opt.id
                      ? 'bg-blue-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-56">
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 text-xs pointer-events-none">
                <i className="fa-solid fa-magnifying-glass"></i>
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="नाम, रोल या रसीद खोजें..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs outline-none focus:border-blue-900"
              />
            </div>

            <div className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-[11px] font-bold text-slate-700 flex items-center gap-2">
              <span className="text-emerald-700">
                ✓ मिलान: {classCheckedCount}/{classAllRows.length}
              </span>
              {classCheckedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearClassChecks}
                  className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                  title="इस क्लास के सभी मिलान टिक हटाएं"
                >
                  रीसेट
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. CLASS REGISTER TABLE */}
      {subView === 'head_wise' ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-2.5 py-3 text-center w-10" title="ऑफ़लाइन लेजर से मिलान टिक">✓</th>
                <th className="px-2.5 py-3">Roll / Adm</th>
                <th className="px-3 py-3">Student & Father Name</th>
                <th className="px-2.5 py-3 text-center">Admission Fee</th>
                <th className="px-2.5 py-3 text-center">Books Fee</th>
                <th className="px-3 py-3 text-center">Monthly Tuition</th>
                <th className="px-2.5 py-3 text-center">Exam (T1/T2/T3)</th>
                <th className="px-2.5 py-3 text-center">Van / Other</th>
                <th className="px-2.5 py-3 text-right">Total Paid</th>
                <th className="px-2.5 py-3 text-right">Discount</th>
                <th className="px-3 py-3 text-right">Net Balance</th>
                <th className="px-2.5 py-3">Last Rec #</th>
                <th className="px-2.5 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-slate-400">
                    इस क्लास / फ़िल्टर में कोई छात्र नहीं मिला।
                  </td>
                </tr>
              ) : (
                displayedRows.map((r) => {
                  const isDue = r.netBalance > 0;
                  const isChecked = Boolean(checkedMap[r.studentKey]);
                  return (
                    <tr
                      key={r.studentKey}
                      className={`border-l-4 transition-colors ${
                        isChecked
                          ? 'bg-sky-50/70 hover:bg-sky-100/70 border-l-sky-500'
                          : isDue
                          ? 'bg-rose-50/55 hover:bg-rose-100/70 border-l-rose-500'
                          : 'bg-emerald-50/45 hover:bg-emerald-100/65 border-l-emerald-500'
                      }`}
                    >
                      <td className="px-2.5 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheckedStudent(r.studentKey)}
                          className="w-4 h-4 accent-emerald-600 cursor-pointer rounded"
                          title="लेजर मिलान सत्यापित मार्क करें"
                        />
                      </td>
                      <td className="px-2.5 py-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                        <div>#{r.rollNo !== '—' ? r.rollNo : r.admNo}</div>
                        <div className="text-[10px] font-normal text-slate-400">Adm: {r.admNo}</div>
                      </td>
                      <td className="px-3 py-2.5 min-w-[170px]">
                        <button
                          type="button"
                          onClick={() => onSelectStudentProfile && onSelectStudentProfile(r.student)}
                          className="font-bold text-blue-950 hover:underline text-left cursor-pointer block"
                        >
                          {r.student.Student_Name || 'Unknown'}
                        </button>
                        <div className="text-[10px] text-slate-500">
                          {r.fatherName} • {r.mobile}
                        </div>
                      </td>
                      {/* Admission */}
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {r.admFee === 0 ? (
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">₹0</span>
                        ) : r.admDue <= 0 ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                            ✓ ₹{r.admPaid.toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold">
                            Due ₹{r.admDue.toLocaleString('en-IN')}
                          </span>
                        )}
                      </td>
                      {/* Books */}
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {r.booksIsPaid ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                            ✓ ₹{r.booksPaid.toLocaleString('en-IN')}
                          </span>
                        ) : r.booksIsPartial ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                            शेष ₹{r.booksRemaining.toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-semibold">—</span>
                        )}
                      </td>
                      {/* Tuition */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        {r.isExempt ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                            Free (माफ़)
                          </span>
                        ) : r.tuitionDue <= 0 ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                              ✓ {r.paidMonthsEquivalent}/{r.elapsedMonths} माह
                            </span>
                            <span className="text-[10px] text-emerald-700 font-semibold">
                              ₹{r.tuitionPaid.toLocaleString('en-IN')}
                            </span>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-center">
                            <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold">
                              Due ₹{r.tuitionDue.toLocaleString('en-IN')}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {r.paidMonthsEquivalent}/{r.elapsedMonths} माह जमा
                            </span>
                          </div>
                        )}
                      </td>
                      {/* Exam */}
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {r.isExamFullPaid ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold">
                            3× Paid ✓
                          </span>
                        ) : (
                          <div className="inline-flex items-center gap-0.5 text-[10px] font-bold">
                            <span className={`px-1 py-0.2 rounded ${r.term1Paid ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
                              T1{r.term1Paid ? '✓' : '✗'}
                            </span>
                            <span className={`px-1 py-0.2 rounded ${r.term2Paid ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>
                              T2{r.term2Paid ? '✓' : '✗'}
                            </span>
                            <span className={`px-1 py-0.2 rounded ${r.term3Paid ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
                              T3{r.term3Paid ? '✓' : '—'}
                            </span>
                          </div>
                        )}
                      </td>
                      {/* Other / Van */}
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {r.otherBilledDue > 0 ? (
                          <span
                            className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-bold"
                            title={r.otherLabels.join(', ')}
                          >
                            Due ₹{r.otherBilledDue.toLocaleString('en-IN')}
                          </span>
                        ) : r.otherBilledPaid > 0 ? (
                          <span
                            className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-bold"
                            title={r.otherLabels.join(', ')}
                          >
                            ✓ ₹{r.otherBilledPaid.toLocaleString('en-IN')}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                      {/* Total Paid */}
                      <td className="px-2.5 py-2.5 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                        ₹{r.totalPaid.toLocaleString('en-IN')}
                      </td>
                      {/* Discount */}
                      <td className="px-2.5 py-2.5 text-right font-medium text-amber-700 tabular-nums whitespace-nowrap">
                        {r.totalDiscount > 0 ? `₹${r.totalDiscount.toLocaleString('en-IN')}` : '—'}
                      </td>
                      {/* Net Balance */}
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-extrabold text-[11px] border tabular-nums ${
                            r.netBalance > 0
                              ? 'bg-rose-100 text-rose-900 border-rose-300'
                              : r.netBalance < 0
                              ? 'bg-purple-100 text-purple-900 border-purple-300'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {r.netBalance > 0
                            ? `Due ₹${r.netBalance.toLocaleString('en-IN')}`
                            : r.netBalance < 0
                            ? `Adv ₹${Math.abs(r.netBalance).toLocaleString('en-IN')}`
                            : 'Paid ₹0 ✓'}
                        </span>
                      </td>
                      {/* Last Receipt */}
                      <td className="px-2.5 py-2.5 whitespace-nowrap">
                        {r.lastReceiptNo ? (
                          <div>
                            <div className="font-mono font-bold text-blue-900 text-[11px]">{r.lastReceiptNo}</div>
                            <div className="text-[10px] text-slate-400">{formatShortDate(r.lastReceiptDate)}</div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">कोई रसीद नहीं</span>
                        )}
                      </td>
                      {/* Action */}
                      <td className="px-2.5 py-2.5 text-center whitespace-nowrap">
                        {onOpenAddFeeModal && (
                          <button
                            type="button"
                            onClick={() => onOpenAddFeeModal(r.student.Student_ID)}
                            className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer shadow-2xs"
                            title="सीधे इस छात्र की फीस जमा करें"
                          >
                            + Fee
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {displayedRows.length > 0 && (
              <tfoot className="bg-[#0c2340] text-amber-300 font-black text-xs">
                <tr>
                  <td colSpan={3} className="px-3 py-3">
                    CLASS GRAND TOTAL ({selectedClassInfo?.label} • {displayedRows.length} छात्र • बकाया: {grandTotals.unpaidStudents})
                  </td>
                  <td className="px-2.5 py-3 text-center text-[11px] tabular-nums">
                    <div>जमा: ₹{grandTotals.admPaid.toLocaleString('en-IN')}</div>
                    {grandTotals.admDue > 0 && (
                      <div className="text-rose-300 text-[10px]">बाकी: ₹{grandTotals.admDue.toLocaleString('en-IN')}</div>
                    )}
                  </td>
                  <td className="px-2.5 py-3 text-center text-[11px] tabular-nums">
                    ₹{grandTotals.booksPaid.toLocaleString('en-IN')}
                  </td>
                  <td className="px-3 py-3 text-center text-[11px] tabular-nums">
                    <div className="text-emerald-300">जमा: ₹{grandTotals.tuitionPaid.toLocaleString('en-IN')}</div>
                    {grandTotals.tuitionDue > 0 && (
                      <div className="text-rose-300 text-[10px]">बाकी: ₹{grandTotals.tuitionDue.toLocaleString('en-IN')}</div>
                    )}
                  </td>
                  <td className="px-2.5 py-3 text-center text-[11px] tabular-nums">
                    ₹{grandTotals.examPaid.toLocaleString('en-IN')}
                  </td>
                  <td className="px-2.5 py-3 text-center text-[11px] tabular-nums">
                    ₹{grandTotals.otherPaid.toLocaleString('en-IN')}
                  </td>
                  <td className="px-2.5 py-3 text-right text-emerald-300 tabular-nums whitespace-nowrap">
                    ₹{grandTotals.totalPaid.toLocaleString('en-IN')}
                  </td>
                  <td className="px-2.5 py-3 text-right text-amber-200 tabular-nums whitespace-nowrap">
                    ₹{grandTotals.totalDiscount.toLocaleString('en-IN')}
                  </td>
                  <td className="px-3 py-3 text-right text-rose-300 tabular-nums whitespace-nowrap">
                    ₹{grandTotals.totalNetDue.toLocaleString('en-IN')}
                  </td>
                  <td colSpan={2} className="px-2.5 py-3 text-center text-[10px] text-slate-300">
                    ✓ {grandTotals.checkedCount}/{displayedRows.length} मिलान
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        /* VIEW B: APRIL TO MARCH 12-MONTH LEDGER GRID */
        <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-xs">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-2 py-3 text-center w-9" title="ऑफ़लाइन लेजर से मिलान टिक">✓</th>
                <th className="px-2 py-3">Roll</th>
                <th className="px-2.5 py-3 min-w-[140px]">Student Name</th>
                {MONTH_SHORTS.map((m) => (
                  <th key={m} className="px-1.5 py-3 text-center min-w-[46px]">
                    {m}
                  </th>
                ))}
                <th className="px-2 py-3 text-center">Adm / Exam</th>
                <th className="px-2.5 py-3 text-right">Paid (₹)</th>
                <th className="px-2.5 py-3 text-right">Net Due</th>
                <th className="px-2 py-3">Last Rec</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {displayedRows.length === 0 ? (
                <tr>
                  <td colSpan={19} className="py-10 text-center text-slate-400">
                    इस क्लास / फ़िल्टर में कोई छात्र नहीं मिला।
                  </td>
                </tr>
              ) : (
                displayedRows.map((r) => {
                  const isDue = r.netBalance > 0;
                  const isChecked = Boolean(checkedMap[r.studentKey]);
                  return (
                    <tr
                      key={r.studentKey}
                      className={`border-l-4 transition-colors ${
                        isChecked
                          ? 'bg-sky-50/50 border-l-sky-500'
                          : isDue
                          ? 'hover:bg-rose-50/40 border-l-rose-500'
                          : 'hover:bg-emerald-50/40 border-l-emerald-500'
                      }`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheckedStudent(r.studentKey)}
                          className="w-4 h-4 accent-emerald-600 cursor-pointer rounded"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono font-bold text-slate-900 whitespace-nowrap">
                        #{r.rollNo !== '—' ? r.rollNo : r.admNo}
                      </td>
                      <td className="px-2.5 py-2">
                        <button
                          type="button"
                          onClick={() => onSelectStudentProfile && onSelectStudentProfile(r.student)}
                          className="font-bold text-blue-950 hover:underline text-left cursor-pointer block leading-tight"
                        >
                          {r.student.Student_Name || 'Unknown'}
                        </button>
                        <span className="text-[10px] text-slate-400 block">
                          {r.fatherName}
                        </span>
                      </td>

                      {/* 12 Months Apr..Mar */}
                      {r.months.map((m) => (
                        <td key={m.monthIndex} className="px-1 py-1.5 text-center">
                          {m.status === 'paid' || m.status === 'advance' ? (
                            <span
                              className={`inline-block w-full px-1 py-0.5 rounded text-[10px] font-bold border ${
                                m.status === 'advance'
                                  ? 'bg-purple-100 text-purple-900 border-purple-300'
                                  : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              }`}
                              title={`${m.short}: ₹${m.paidAmount} जमा`}
                            >
                              ✓{m.paidAmount}
                            </span>
                          ) : m.status === 'partial' ? (
                            <span
                              className="inline-block w-full px-1 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300"
                              title={`${m.short}: आंशिक ₹${m.paidAmount} जमा, ₹${m.dueAmount} शेष`}
                            >
                              P:{m.paidAmount}
                            </span>
                          ) : m.status === 'due' ? (
                            <span
                              className="inline-block w-full px-1 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300"
                              title={`${m.short}: ₹${m.dueAmount} बकाया`}
                            >
                              {m.dueAmount}
                            </span>
                          ) : m.status === 'free' ? (
                            <span className="inline-block w-full px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Free
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-300">—</span>
                          )}
                        </td>
                      ))}

                      {/* Adm / Exam quick compact */}
                      <td className="px-2 py-2 text-center whitespace-nowrap text-[10px] font-bold">
                        <div className={r.admDue > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                          Adm:{r.admDue > 0 ? `₹${r.admDue}` : '✓'}
                        </div>
                        <div className={r.isExamFullPaid ? 'text-emerald-700' : 'text-indigo-700'}>
                          Exm:{r.isExamFullPaid ? '3×✓' : `${r.paidTermsCount}/3`}
                        </div>
                      </td>

                      {/* Total Paid */}
                      <td className="px-2.5 py-2 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                        ₹{r.totalPaid.toLocaleString('en-IN')}
                      </td>

                      {/* Net Due */}
                      <td className="px-2.5 py-2 text-right whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded font-extrabold text-[10px] border tabular-nums ${
                            r.netBalance > 0
                              ? 'bg-rose-100 text-rose-900 border-rose-300'
                              : r.netBalance < 0
                              ? 'bg-purple-100 text-purple-900 border-purple-300'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          }`}
                        >
                          {r.netBalance > 0
                            ? `₹${r.netBalance.toLocaleString('en-IN')}`
                            : r.netBalance < 0
                            ? `Adv ${Math.abs(r.netBalance)}`
                            : 'Paid'}
                        </span>
                      </td>

                      {/* Last Receipt */}
                      <td className="px-2 py-2 whitespace-nowrap text-[10px]">
                        {r.lastReceiptNo ? (
                          <span className="font-mono font-bold text-blue-900" title={r.lastReceiptDate}>
                            {r.lastReceiptNo}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {displayedRows.length > 0 && (
              <tfoot className="bg-[#0c2340] text-amber-300 font-black text-[10px]">
                <tr>
                  <td colSpan={3} className="px-2.5 py-3">
                    TOTAL ({selectedClassInfo?.label} • {displayedRows.length} छात्र)
                  </td>
                  {grandTotals.monthPaidSums.map((sum, idx) => (
                    <td key={idx} className="px-1 py-3 text-center tabular-nums">
                      <div className="text-emerald-300">₹{sum}</div>
                      {grandTotals.monthDueSums[idx] > 0 && (
                        <div className="text-rose-300 text-[9px]">D:{grandTotals.monthDueSums[idx]}</div>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-3 text-center text-amber-200">—</td>
                  <td className="px-2.5 py-3 text-right text-emerald-300 tabular-nums whitespace-nowrap">
                    ₹{grandTotals.totalPaid.toLocaleString('en-IN')}
                  </td>
                  <td className="px-2.5 py-3 text-right text-rose-300 tabular-nums whitespace-nowrap">
                    ₹{grandTotals.totalNetDue.toLocaleString('en-IN')}
                  </td>
                  <td className="px-2 py-3 text-center text-slate-300">
                    ✓{grandTotals.checkedCount}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Legend Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"></span>
            <span>जमा (Paid)</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block"></span>
            <span>बकाया (Due)</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block"></span>
            <span>आंशिक (Partial)</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block"></span>
            <span>अग्रिम (Advance)</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block"></span>
            <span>✓ मिलान सत्यापित (Checked)</span>
          </span>
        </div>
        <span className="text-[10px] text-slate-500">
          नोट: Print/PDF बटन से A4 Landscape में साफ रजिस्टर पेज डाउनलोड होगा (All Classes PDF में हर क्लास नए पेज पर)।
        </span>
      </div>
    </div>
  );
};
