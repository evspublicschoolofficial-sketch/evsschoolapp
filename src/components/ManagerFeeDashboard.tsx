import React, { useState, useMemo, useRef } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { StudentRecordForScan } from './StudentQRScannerModal';
import { FeeCollectionRecord } from './AddFeeModal';
import { OfficialFeeReceiptModal } from './OfficialFeeReceiptModal';
import { FeeMasterModal } from './FeeMasterModal';
import { Student } from '../types';
import {
  computeStudentFeeMetrics,
  computeSchoolFeeTotals,
  computeReceiptBalance,
} from '../utils/feeCalculation';
import { APPS_SCRIPT_FEE_CODE } from '../utils/feeMaster';

// Academic session months mapping (April through March)
const ACADEMIC_MONTHS = [
  { key: 'apr', name: 'April', short: 'Apr', hindi: 'अप्रैल', order: 1 },
  { key: 'may', name: 'May', short: 'May', hindi: 'मई', order: 2 },
  { key: 'jun', name: 'June', short: 'Jun', hindi: 'जून', order: 3 },
  { key: 'jul', name: 'July', short: 'Jul', hindi: 'जुलाई', order: 4 },
  { key: 'aug', name: 'August', short: 'Aug', hindi: 'अगस्त', order: 5 },
  { key: 'sep', name: 'September', short: 'Sep', hindi: 'सितंबर', order: 6 },
  { key: 'oct', name: 'October', short: 'Oct', hindi: 'अक्टूबर', order: 7 },
  { key: 'nov', name: 'November', short: 'Nov', hindi: 'नवंबर', order: 8 },
  { key: 'dec', name: 'December', short: 'Dec', hindi: 'दिसंबर', order: 9 },
  { key: 'jan', name: 'January', short: 'Jan', hindi: 'जनवरी', order: 10 },
  { key: 'feb', name: 'February', short: 'Feb', hindi: 'फ़रवरी', order: 11 },
  { key: 'mar', name: 'March', short: 'Mar', hindi: 'मार्च', order: 12 },
];

export const LEDGER_FEE_TYPES = [
  'Monthly Tuition Fee (मासिक शिक्षण शुल्क)',
  'Advance Fee Deposit (अग्रिम शुल्क जमा)',
  'Admission Fee (प्रवेश शुल्क)',
  'Examination Fee (परीक्षा शुल्क)',
  'Annual Charges (वार्षिक शुल्क)',
  'Transportation / Bus Fee (वाहन शुल्क)',
  'Books & Stationery (पुस्तकालय / पुस्तकें)',
  'School Uniform Fee (यूनिफॉर्म)',
  'Late Fee / Fine (विलंब शुल्क)',
  'Miscellaneous / Other (अन्य)',
];

export const LEDGER_MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
  'Quarter 1 (Apr-Jun)', 'Quarter 2 (Jul-Sep)', 'Quarter 3 (Oct-Dec)', 'Quarter 4 (Jan-Mar)', 'Full Academic Session', 'Advance Deposit'
];

// Helper to extract academic month from a fee collection record
const extractMonthInfo = (
  fee: FeeCollectionRecord
): { key: string; name: string; short: string; order: number } => {
  const monthStr = String(fee.Month || '').toLowerCase().trim();
  const dateStr = String(fee.Date || '').toLowerCase().trim();

  // 1. Direct match in Month string
  for (const m of ACADEMIC_MONTHS) {
    if (
      monthStr === m.key ||
      monthStr.startsWith(m.key) ||
      monthStr.includes(m.name.toLowerCase()) ||
      monthStr.includes(m.hindi)
    ) {
      return { key: m.key, name: m.name, short: m.short, order: m.order };
    }
  }

  // 2. Check Date(yyyy, m, d) format from Google Sheets
  if (dateStr.includes('date(')) {
    const match = dateStr.match(/date\((\d+),\s*(\d+)/i);
    if (match) {
      const monthIdx = Number(match[2]); // 0 to 11
      const academicMap: Record<number, { key: string; name: string; short: string; order: number }> = {
        3: { key: 'apr', name: 'April', short: 'Apr', order: 1 },
        4: { key: 'may', name: 'May', short: 'May', order: 2 },
        5: { key: 'jun', name: 'June', short: 'Jun', order: 3 },
        6: { key: 'jul', name: 'July', short: 'Jul', order: 4 },
        7: { key: 'aug', name: 'August', short: 'Aug', order: 5 },
        8: { key: 'sep', name: 'September', short: 'Sep', order: 6 },
        9: { key: 'oct', name: 'October', short: 'Oct', order: 7 },
        10: { key: 'nov', name: 'November', short: 'Nov', order: 8 },
        11: { key: 'dec', name: 'December', short: 'Dec', order: 9 },
        0: { key: 'jan', name: 'January', short: 'Jan', order: 10 },
        1: { key: 'feb', name: 'February', short: 'Feb', order: 11 },
        2: { key: 'mar', name: 'March', short: 'Mar', order: 12 },
      };
      if (academicMap[monthIdx]) return academicMap[monthIdx];
    }
  }

  // 3. YYYY-MM-DD
  const partsHyphen = dateStr.split('-');
  if (partsHyphen.length === 3 && partsHyphen[0].length === 4) {
    const moNum = parseInt(partsHyphen[1], 10);
    const academicMonthByNum: Record<number, { key: string; name: string; short: string; order: number }> = {
      4: { key: 'apr', name: 'April', short: 'Apr', order: 1 },
      5: { key: 'may', name: 'May', short: 'May', order: 2 },
      6: { key: 'jun', name: 'June', short: 'Jun', order: 3 },
      7: { key: 'jul', name: 'July', short: 'Jul', order: 4 },
      8: { key: 'aug', name: 'August', short: 'Aug', order: 5 },
      9: { key: 'sep', name: 'September', short: 'Sep', order: 6 },
      10: { key: 'oct', name: 'October', short: 'Oct', order: 7 },
      11: { key: 'nov', name: 'November', short: 'Nov', order: 8 },
      12: { key: 'dec', name: 'December', short: 'Dec', order: 9 },
      1: { key: 'jan', name: 'January', short: 'Jan', order: 10 },
      2: { key: 'feb', name: 'February', short: 'Feb', order: 11 },
      3: { key: 'mar', name: 'March', short: 'Mar', order: 12 },
    };
    if (academicMonthByNum[moNum]) return academicMonthByNum[moNum];
  }

  // 4. DD/MM/YYYY
  const partsSlash = dateStr.split('/');
  if (partsSlash.length === 3) {
    const moNum = parseInt(partsSlash[1], 10);
    const academicMonthByNum: Record<number, { key: string; name: string; short: string; order: number }> = {
      4: { key: 'apr', name: 'April', short: 'Apr', order: 1 },
      5: { key: 'may', name: 'May', short: 'May', order: 2 },
      6: { key: 'jun', name: 'June', short: 'Jun', order: 3 },
      7: { key: 'jul', name: 'July', short: 'Jul', order: 4 },
      8: { key: 'aug', name: 'August', short: 'Aug', order: 5 },
      9: { key: 'sep', name: 'September', short: 'Sep', order: 6 },
      10: { key: 'oct', name: 'October', short: 'Oct', order: 7 },
      11: { key: 'nov', name: 'November', short: 'Nov', order: 8 },
      12: { key: 'dec', name: 'December', short: 'Dec', order: 9 },
      1: { key: 'jan', name: 'January', short: 'Jan', order: 10 },
      2: { key: 'feb', name: 'February', short: 'Feb', order: 11 },
      3: { key: 'mar', name: 'March', short: 'Mar', order: 12 },
    };
    if (academicMonthByNum[moNum]) return academicMonthByNum[moNum];
  }

  // 5. Quarter checks
  if (monthStr.includes('q1') || monthStr.includes('quarter 1')) {
    return { key: 'apr', name: 'April (Q1)', short: 'Q1-Apr', order: 1 };
  }
  if (monthStr.includes('q2') || monthStr.includes('quarter 2')) {
    return { key: 'jul', name: 'July (Q2)', short: 'Q2-Jul', order: 4 };
  }
  if (monthStr.includes('q3') || monthStr.includes('quarter 3')) {
    return { key: 'oct', name: 'October (Q3)', short: 'Q3-Oct', order: 7 };
  }
  if (monthStr.includes('q4') || monthStr.includes('quarter 4')) {
    return { key: 'jan', name: 'January (Q4)', short: 'Q4-Jan', order: 10 };
  }

  // 6. Generic JS Date fallback
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const mo = d.getMonth();
      const academicMap: Record<number, { key: string; name: string; short: string; order: number }> = {
        3: { key: 'apr', name: 'April', short: 'Apr', order: 1 },
        4: { key: 'may', name: 'May', short: 'May', order: 2 },
        5: { key: 'jun', name: 'June', short: 'Jun', order: 3 },
        6: { key: 'jul', name: 'July', short: 'Jul', order: 4 },
        7: { key: 'aug', name: 'August', short: 'Aug', order: 5 },
        8: { key: 'sep', name: 'September', short: 'Sep', order: 6 },
        9: { key: 'oct', name: 'October', short: 'Oct', order: 7 },
        10: { key: 'nov', name: 'November', short: 'Nov', order: 8 },
        11: { key: 'dec', name: 'December', short: 'Dec', order: 9 },
        0: { key: 'jan', name: 'January', short: 'Jan', order: 10 },
        1: { key: 'feb', name: 'February', short: 'Feb', order: 11 },
        2: { key: 'mar', name: 'March', short: 'Mar', order: 12 },
      };
      if (academicMap[mo]) return academicMap[mo];
    }
  } catch {}

  const fallbackName = fee.Month || 'Current';
  return {
    key: fallbackName.toLowerCase().slice(0, 4),
    name: fallbackName,
    short: fallbackName.slice(0, 3),
    order: 99,
  };
};

// Custom tooltip for fee collection trends chart
const TrendsTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload || {};
    return (
      <div className="bg-slate-950/95 text-white p-3.5 rounded-2xl shadow-xl border border-slate-700/80 text-xs space-y-2 min-w-[210px] backdrop-blur-md">
        <div className="font-bold text-amber-300 border-b border-slate-700/80 pb-1.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <i className="fa-solid fa-calendar-day text-[11px] text-amber-400"></i>
            <span>{data.monthFull || label}</span>
          </span>
          <span className="text-[10px] text-slate-300 bg-white/10 px-2 py-0.5 rounded-md font-mono">
            {data.receiptCount || 0} रसीदें
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-emerald-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>जमा वसूली (Paid):</span>
            </span>
            <span className="font-extrabold font-mono text-[13px]">
              ₹{(data.collected || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-300">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400"></span>
              <span>कुल देय (Billed):</span>
            </span>
            <span className="font-medium font-mono">
              ₹{(data.totalBilled || 0).toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex items-center justify-between text-rose-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-400"></span>
              <span>शेष बकाया (Due):</span>
            </span>
            <span className="font-medium font-mono">
              ₹{(data.balance || 0).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
        <div className="pt-1.5 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
          <span>वसूली दक्षता:</span>
          <span className="font-bold text-emerald-300">{data.recoveryRate || 0}%</span>
        </div>
        {data.topMode && (
          <div className="text-[10px] text-slate-400 flex items-center justify-between">
            <span>प्रमुख माध्यम:</span>
            <span className="font-medium text-amber-300">{data.topMode}</span>
          </div>
        )}
      </div>
    );
  }
  return null;
};

interface ManagerFeeDashboardProps {
  students: StudentRecordForScan[];
  feeRecords: FeeCollectionRecord[];
  feeBalances: Record<string, number>;
  classMap?: Record<string, string>;
  getClassName?: (c: string | undefined | null) => string;
  getStudentPhoto?: (s: StudentRecordForScan | null | undefined) => string;
  onOpenAddFeeModal: (studentId?: string) => void;
  onTriggerQRScan: () => void;
  onRefreshFees: () => void;
  loadingFees?: boolean;
  managerName?: string;
  initialSelectedStudent?: StudentRecordForScan | null;
  onClearBalance?: (student: StudentRecordForScan, currentDue: number) => void;
  onEditFee?: (updatedRecord: FeeCollectionRecord, originalReceiptNo: string) => Promise<void> | void;
  onDeleteFee?: (receiptNo: string, studentId: string) => Promise<boolean | void> | void;
}

export const ManagerFeeDashboard: React.FC<ManagerFeeDashboardProps> = ({
  students,
  feeRecords,
  feeBalances,
  getClassName = (c) => c || 'N/A',
  getStudentPhoto,
  onOpenAddFeeModal,
  onTriggerQRScan,
  onRefreshFees,
  loadingFees = false,
  managerName = 'School Manager',
  initialSelectedStudent = null,
  onClearBalance,
  onEditFee,
  onDeleteFee,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [selectedStudent, setSelectedStudent] = useState<StudentRecordForScan | null>(initialSelectedStudent);
  const [activeViewMode, setActiveViewMode] = useState<'trends' | 'student' | 'allLedger'>('trends');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [ledgerClassFilter, setLedgerClassFilter] = useState<string>('all');
  const [copiedReceipt, setCopiedReceipt] = useState<string | null>(null);
  const [printingReceiptRecord, setPrintingReceiptRecord] = useState<{
    student: Student;
    fee: FeeCollectionRecord;
  } | null>(null);

  // Edit Fee Modal State for Manager
  const [editingFee, setEditingFee] = useState<FeeCollectionRecord | null>(null);
  const [editReceiptNo, setEditReceiptNo] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [editFeeType, setEditFeeType] = useState<string>('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
  const [editMonth, setEditMonth] = useState<string>('September');
  const [editTotalAmount, setEditTotalAmount] = useState<string>('0');
  const [editAmountPaid, setEditAmountPaid] = useState<string>('0');
  const [editPaymentMode, setEditPaymentMode] = useState<string>('Cash');
  const [editReceivedBy, setEditReceivedBy] = useState<string>(managerName);
  const [editIsSubmitting, setEditIsSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete Fee Modal State for Manager
  const [deletingFee, setDeletingFee] = useState<FeeCollectionRecord | null>(null);
  const [deleteIsSubmitting, setDeleteIsSubmitting] = useState<boolean>(false);

  // Monthly Fee Trends state controls
  const [trendsMetricFilter, setTrendsMetricFilter] = useState<'all' | 'collectionOnly' | 'collectionVsDue'>('all');
  const [trendsScope, setTrendsScope] = useState<'allSession' | 'activeOnly'>('allSession');
  const [trendsClassFilter, setTrendsClassFilter] = useState<string>('all');
  const [showAppsScriptModal, setShowAppsScriptModal] = useState<boolean>(false);
  const [appsScriptCopied, setAppsScriptCopied] = useState<boolean>(false);
  const [isFeeMasterModalOpen, setIsFeeMasterModalOpen] = useState<boolean>(false);

  // School Ledger section ref for auto-scrolling
  const ledgerSectionRef = useRef<HTMLDivElement | null>(null);

  // Sync initial student if provided from parent (e.g. after QR scan)
  React.useEffect(() => {
    if (initialSelectedStudent) {
      setSelectedStudent(initialSelectedStudent);
      setActiveViewMode('student');
    }
  }, [initialSelectedStudent]);

  // Robust date parser supporting Google Visualization Date(Y,M,D), ISO strings, and Indian formats
  const parseGVizOrStandardDate = (dateVal: any): Date | null => {
    if (!dateVal) return null;
    if (dateVal instanceof Date && !isNaN(dateVal.getTime())) return dateVal;
    const str = String(dateVal).trim();
    if (!str) return null;

    // Handle Google Visualization Date(2026,9,2) or Date(2026, 9, 2)
    const gvizMatch = str.match(/Date\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+))?(?:,\s*(\d+))?(?:,\s*(\d+))?\)/i);
    if (gvizMatch) {
      const y = parseInt(gvizMatch[1], 10);
      const m = parseInt(gvizMatch[2], 10); // 0-indexed in JS GViz
      const d = parseInt(gvizMatch[3], 10);
      const hr = gvizMatch[4] ? parseInt(gvizMatch[4], 10) : 0;
      const min = gvizMatch[5] ? parseInt(gvizMatch[5], 10) : 0;
      const sec = gvizMatch[6] ? parseInt(gvizMatch[6], 10) : 0;
      return new Date(y, m, d, hr, min, sec);
    }

    // Handle DD/MM/YYYY or DD-MM-YYYY
    const parts = str.split(/[-/]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        const d = new Date(str);
        if (!isNaN(d.getTime())) return d;
      } else if (parts[2].length === 4) {
        // DD/MM/YYYY
        const day = parseInt(parts[0], 10);
        const mon = parseInt(parts[1], 10) - 1;
        const yr = parseInt(parts[2], 10);
        const d = new Date(yr, mon, day);
        if (!isNaN(d.getTime())) return d;
      }
    }

    const d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    return null;
  };

  // Format date helper with robust parsing
  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '—';
    const parsed = parseGVizOrStandardDate(dateStr);
    if (parsed) {
      return `${parsed.getDate().toString().padStart(2, '0')}/${(parsed.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${parsed.getFullYear()}`;
    }
    return String(dateStr);
  };

  // Click handler to directly navigate/redirect and auto-scroll to the School Ledger section
  const handleNavigateToLedger = () => {
    setActiveViewMode('allLedger');
    setTimeout(() => {
      if (ledgerSectionRef.current) {
        ledgerSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        const el = document.getElementById('school-ledger-section');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  // Get balance for any student
  const getStudentBalance = (student: StudentRecordForScan | null | undefined): number => {
    if (!student) return 0;
    const sId = String(student.Student_ID || '').trim().toLowerCase();
    if (sId && feeBalances[sId] !== undefined) {
      return feeBalances[sId];
    }
    if (student.Balance_Amount !== undefined && student.Balance_Amount !== null && student.Balance_Amount !== '') {
      const num = Number(student.Balance_Amount);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };

  // Start editing a fee record
  const handleStartEditFee = (fee: FeeCollectionRecord) => {
    setEditingFee(fee);
    setEditReceiptNo(fee.Receipt_Number || '');
    let cleanDate = fee.Date || new Date().toISOString().split('T')[0];
    if (cleanDate.includes('T')) cleanDate = cleanDate.split('T')[0];
    setEditDate(cleanDate);
    setEditFeeType(fee.Fee_Type || 'Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
    setEditMonth(fee.Month || 'September');
    setEditTotalAmount(fee.Total_Amount !== null && fee.Total_Amount !== undefined ? String(fee.Total_Amount) : '0');
    setEditAmountPaid(fee.Amount_Paid !== null && fee.Amount_Paid !== undefined ? String(fee.Amount_Paid) : '0');
    setEditPaymentMode(fee.Payment_Mode || 'Cash');
    setEditReceivedBy(fee.Received_By || managerName);
    setEditError(null);
  };

  // Real-time calculated balance in Edit modal (allows negative for advance payments)
  const editCalculatedBalance = useMemo(() => {
    const isAdvance = editFeeType.toLowerCase().includes('advance') || editFeeType.includes('अग्रिम');
    const total = isAdvance ? 0 : (editTotalAmount.trim() === '' ? 0 : (parseFloat(editTotalAmount) || 0));
    const paid = editAmountPaid.trim() === '' ? 0 : (parseFloat(editAmountPaid) || 0);
    return total - paid;
  }, [editFeeType, editTotalAmount, editAmountPaid]);

  // Save edited fee record
  const handleSaveEditFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFee) return;
    setEditError(null);

    const isAdvance = editFeeType.toLowerCase().includes('advance') || editFeeType.includes('अग्रिम');
    const total = isAdvance ? 0 : (editTotalAmount.trim() === '' ? 0 : parseFloat(editTotalAmount));
    const paid = editAmountPaid.trim() === '' ? 0 : parseFloat(editAmountPaid);

    if (isNaN(total) || total < 0) {
      setEditError('कुल देय राशि अमान्य है।');
      return;
    }
    if (isNaN(paid) || paid <= 0) {
      setEditError('कृपया वैध जमा राशि दर्ज करें (जमा राशि 0 से अधिक होनी चाहिए)।');
      return;
    }

    setEditIsSubmitting(true);
    try {
      const cleanFeeType = editFeeType.split('(')[0].trim();
      const updated: FeeCollectionRecord = {
        ...editingFee,
        Receipt_Number: editReceiptNo.trim() || editingFee.Receipt_Number,
        Date: editDate,
        Fee_Type: cleanFeeType,
        Month: editMonth.trim(),
        Total_Amount: total,
        Amount_Paid: paid,
        Balance_Amount: editCalculatedBalance,
        Payment_Mode: editPaymentMode,
        Received_By: editReceivedBy.trim(),
      };

      if (onEditFee) {
        await onEditFee(updated, editingFee.Receipt_Number || '');
      }
      setEditingFee(null);
    } catch (err: any) {
      setEditError(err.message || 'त्रुटि: रिकॉर्ड अपडेट नहीं हो सका।');
    } finally {
      setEditIsSubmitting(false);
    }
  };

  // Open custom in-app Delete Confirmation Modal
  const handleDeleteFeeClick = (fee: FeeCollectionRecord) => {
    setDeletingFee(fee);
  };

  // Confirm delete fee record
  const handleConfirmDelete = async () => {
    if (!deletingFee) return;
    setDeleteIsSubmitting(true);
    try {
      if (onDeleteFee) {
        await onDeleteFee(deletingFee.Receipt_Number || '', deletingFee.Student_ID || '');
      }
      if (editingFee && editingFee.Receipt_Number === deletingFee.Receipt_Number) {
        setEditingFee(null);
      }
      setDeletingFee(null);
    } catch (err) {
      console.error('Error deleting fee record:', err);
    } finally {
      setDeleteIsSubmitting(false);
    }
  };

  // Filter students for the search bar & suggestions
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const q = searchTerm.toLowerCase().trim();
      const matchSearch =
        q === '' ||
        String(s.Student_Name || '').toLowerCase().includes(q) ||
        String(s.Student_ID || '').toLowerCase().includes(q) ||
        String(s.Roll_Number || '').toLowerCase().includes(q) ||
        String(s.Admission_Number || '').toLowerCase().includes(q) ||
        String(s.Parent_Mobile || '').includes(q) ||
        String(s['Village/rRoute'] || s.Village || '').toLowerCase().includes(q) ||
        getClassName(s.Class).toLowerCase().includes(q);

      const matchClass =
        classFilter === 'all' ||
        String(s.Class || '').toLowerCase() === classFilter.toLowerCase() ||
        getClassName(s.Class).toLowerCase() === classFilter.toLowerCase();

      return matchSearch && matchClass;
    });
  }, [students, searchTerm, classFilter, getClassName]);

  // Fee records strictly for the active selected student (Sorted descending: newest first)
  const studentFeeRecords = useMemo(() => {
    if (!selectedStudent) return [];
    const sid = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    const list = feeRecords.filter((r) => {
      const rSid = String(r.Student_ID || '').trim().toLowerCase();
      return Boolean(rSid && (rSid === sid || sid.includes(rSid) || rSid.includes(sid)));
    });

    return [...list].sort((a, b) => {
      const dateA = parseGVizOrStandardDate(a.Date)?.getTime() || 0;
      const dateB = parseGVizOrStandardDate(b.Date)?.getTime() || 0;
      if (dateB !== dateA) return dateB - dateA;
      const recA = String(a.Receipt_Number || '');
      const recB = String(b.Receipt_Number || '');
      return recB.localeCompare(recA, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [selectedStudent, feeRecords]);

  // Student Fee Summary Metrics
  const studentFeeSummary = useMemo(() => {
    if (!selectedStudent) {
      return {
        totalFee: 0,
        totalPaid: 0,
        balance: 0,
        isDue: false,
        isAdvance: false,
        advanceAmount: 0,
        count: 0,
      };
    }
    const metrics = computeStudentFeeMetrics(selectedStudent, feeRecords);
    return {
      totalFee: metrics.totalSessionFee,
      totalPaid: metrics.totalPaid,
      balance: metrics.dueBalance,
      isDue: metrics.hasDues,
      isAdvance: metrics.isAdvance,
      advanceAmount: metrics.advanceAmount,
      count: metrics.receiptsCount,
    };
  }, [selectedStudent, feeRecords]);

  // Overall School Fee Metrics (Calculated on individual student totals to prevent duplicate entries)
  const schoolFeeTotals = useMemo(() => {
    const totals = computeSchoolFeeTotals(students, feeRecords);
    return {
      totalReceipts: totals.totalReceipts,
      collected: totals.totalCollected,
      balance: totals.totalPendingDues,
      totalAdvance: totals.totalAdvance,
      totalBilled: totals.totalBilled,
    };
  }, [students, feeRecords]);

  // Filtered All School Ledger (Default sorting order: Newest / Latest entries at the TOP)
  const filteredAllLedger = useMemo(() => {
    const list = feeRecords.filter((r) => {
      const q = ledgerSearch.toLowerCase().trim();
      const matchSearch =
        q === '' ||
        String(r.Receipt_Number || '').toLowerCase().includes(q) ||
        String(r.Student_ID || '').toLowerCase().includes(q) ||
        String(r.Fee_Type || '').toLowerCase().includes(q) ||
        String(r.Month || '').toLowerCase().includes(q);

      if (ledgerClassFilter === 'all') return matchSearch;

      const matchedStudent = students.find(
        (s) => String(s.Student_ID || '').toLowerCase() === String(r.Student_ID || '').toLowerCase()
      );
      const matchClass =
        matchedStudent &&
        (String(matchedStudent.Class || '').toLowerCase() === ledgerClassFilter.toLowerCase() ||
          getClassName(matchedStudent.Class).toLowerCase() === ledgerClassFilter.toLowerCase());

      return matchSearch && matchClass;
    });

    // Sort descending: newest entries at the TOP by Date, then by Receipt ID
    return [...list].sort((a, b) => {
      const dateA = parseGVizOrStandardDate(a.Date)?.getTime() || 0;
      const dateB = parseGVizOrStandardDate(b.Date)?.getTime() || 0;
      if (dateB !== dateA) return dateB - dateA;
      const recA = String(a.Receipt_Number || '');
      const recB = String(b.Receipt_Number || '');
      return recB.localeCompare(recA, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [feeRecords, ledgerSearch, ledgerClassFilter, students, getClassName]);

  // Distinct class list for filtering trends
  const trendsClassOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.Class) set.add(String(s.Class));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // Fee records filtered by class for trends
  const trendsFeeRecords = useMemo(() => {
    if (trendsClassFilter === 'all') return feeRecords;
    return feeRecords.filter((r) => {
      const matched = students.find(
        (s) => String(s.Student_ID || '').toLowerCase() === String(r.Student_ID || '').toLowerCase()
      );
      if (!matched) return false;
      return (
        String(matched.Class || '').toLowerCase() === trendsClassFilter.toLowerCase() ||
        getClassName(matched.Class).toLowerCase() === trendsClassFilter.toLowerCase()
      );
    });
  }, [feeRecords, trendsClassFilter, students, getClassName]);

  // Monthly aggregated data for Recharts LineChart
  const monthlyTrendsData = useMemo(() => {
    // 12 Academic months template
    const monthMap: Record<
      string,
      {
        monthKey: string;
        monthShort: string;
        monthFull: string;
        order: number;
        collected: number;
        totalBilled: number;
        balance: number;
        receiptCount: number;
        modes: Record<string, number>;
      }
    > = {};

    ACADEMIC_MONTHS.forEach((m) => {
      monthMap[m.key] = {
        monthKey: m.key,
        monthShort: m.short,
        monthFull: m.name,
        order: m.order,
        collected: 0,
        totalBilled: 0,
        balance: 0,
        receiptCount: 0,
        modes: {},
      };
    });

    const extraMonths: Record<string, (typeof monthMap)[string]> = {};

    trendsFeeRecords.forEach((fee) => {
      const monthInfo = extractMonthInfo(fee);
      const paid = Number(fee.Amount_Paid) || 0;
      const billed = Number(fee.Total_Amount) || 0;
      const mode = String(fee.Payment_Mode || 'Cash').trim() || 'Cash';

      let target = monthMap[monthInfo.key];
      if (!target) {
        if (!extraMonths[monthInfo.key]) {
          extraMonths[monthInfo.key] = {
            monthKey: monthInfo.key,
            monthShort: monthInfo.short,
            monthFull: monthInfo.name,
            order: monthInfo.order,
            collected: 0,
            totalBilled: 0,
            balance: 0,
            receiptCount: 0,
            modes: {},
          };
        }
        target = extraMonths[monthInfo.key];
      }

      target.collected += paid;
      target.totalBilled += billed;
      target.receiptCount += 1;
      target.modes[mode] = (target.modes[mode] || 0) + 1;
    });

    let combined = [...Object.values(monthMap), ...Object.values(extraMonths)];
    combined.sort((a, b) => a.order - b.order);

    if (trendsScope === 'activeOnly') {
      const active = combined.filter((m) => m.receiptCount > 0 || m.collected > 0);
      if (active.length > 0) {
        combined = active;
      }
    }

    let prevCollected: number | null = null;
    return combined.map((m) => {
      // 1. FORMULA CORRECTION FOR MONTHLY DUE:
      // Net_Due = Math.max(0, Billed_Amount - Paid_Amount)
      // For May & June (Billed ₹750, Paid ₹750) -> Net Due MUST show ₹0 (Cleared)
      // For July (Billed ₹750, Paid ₹600) -> Net Due MUST show ₹150 (Pending balance)
      const netDue = Math.max(0, m.totalBilled - m.collected);

      // 2. COLLECTION EFFICIENCY (%) FORMULA:
      // Efficiency = Billed_Amount > 0 ? Math.min(100, Math.round((Paid_Amount / Billed_Amount) * 100)) : 0
      // For July (600 / 750 * 100), Efficiency shows 80%
      const recoveryRate =
        m.totalBilled > 0
          ? Math.min(100, Math.round((m.collected / m.totalBilled) * 100))
          : 0;

      let topMode = 'Cash';
      let maxCount = 0;
      Object.entries(m.modes).forEach(([k, cnt]) => {
        const countNum = Number(cnt) || 0;
        if (countNum > maxCount) {
          maxCount = countNum;
          topMode = k;
        }
      });

      const avgPerReceipt = m.receiptCount > 0 ? Math.round(m.collected / m.receiptCount) : 0;

      let growthPct: number | null = null;
      if (prevCollected !== null && prevCollected > 0) {
        growthPct = Math.round(((m.collected - prevCollected) / prevCollected) * 100);
      }
      if (m.collected > 0) {
        prevCollected = m.collected;
      }

      return {
        ...m,
        balance: netDue,
        avgPerReceipt,
        recoveryRate,
        growthPct,
        topMode,
      };
    });
  }, [trendsFeeRecords, trendsScope]);

  // Overall KPIs for the trends summary
  // 3. SESSION TOTAL ROW RE-CALCULATION:
  // Total Billed = SUM of all monthly billed amounts.
  // Total Paid = SUM of all monthly paid amounts.
  // Total Session Due = Total Billed - Total Paid (Ensure total due correctly sums up to ₹2,550 instead of ₹4,650).
  const trendsKPIs = useMemo(() => {
    let totalCollected = 0;
    let totalBilled = 0;
    let totalReceipts = 0;
    let peakMonth: { name: string; amount: number; receipts: number } | null = null;
    const modeCounts: Record<string, number> = {};

    monthlyTrendsData.forEach((m) => {
      totalCollected += m.collected;
      totalBilled += m.totalBilled;
      totalReceipts += m.receiptCount;

      if (!peakMonth || m.collected > peakMonth.amount) {
        if (m.collected > 0) {
          peakMonth = { name: m.monthFull, amount: m.collected, receipts: m.receiptCount };
        }
      }

      Object.entries(m.modes).forEach(([mode, cnt]) => {
        modeCounts[mode] = (modeCounts[mode] || 0) + (Number(cnt) || 0);
      });
    });

    const totalBalance = Math.max(0, totalBilled - totalCollected);
    const activeMonthsCount = monthlyTrendsData.filter((m) => m.collected > 0).length || 1;
    const avgMonthly = Math.round(totalCollected / activeMonthsCount);
    const overallRecovery =
      totalBilled > 0 ? Math.min(100, Math.round((totalCollected / totalBilled) * 100)) : 0;

    let topOverallMode = 'Cash';
    let maxModeCount = 0;
    Object.entries(modeCounts).forEach(([mode, cnt]) => {
      const countNum = Number(cnt) || 0;
      if (countNum > maxModeCount) {
        maxModeCount = countNum;
        topOverallMode = mode;
      }
    });

    return {
      totalCollected,
      totalBilled,
      totalBalance,
      totalReceipts,
      peakMonth,
      avgMonthly,
      overallRecovery,
      topOverallMode,
      activeMonthsCount,
    };
  }, [monthlyTrendsData]);

  // WhatsApp Fee Statement Share
  const handleShareFeeStatement = () => {
    if (!selectedStudent) return;
    const parentMobile = String(selectedStudent.Parent_Mobile || selectedStudent.Mobile_Number || '').replace(
      /\D/g,
      ''
    );
    const studentName = selectedStudent.Student_Name || 'छात्र';
    const className = getClassName(selectedStudent.Class);

    const message =
      `*ई.वी.एस. पब्लिक स्कूल - छात्र फीस स्टेटमेंट*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *विद्यार्थी:* ${studentName}\n` +
      `🆔 *छात्र ID:* ${selectedStudent.Student_ID || 'N/A'}\n` +
      `🏫 *कक्षा:* ${className} | रोल नंबर: ${selectedStudent.Roll_Number || 'N/A'}\n` +
      `👨‍👦 *अभिभावक:* ${selectedStudent.Father_Name || '—'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *सत्र कुल देय:* ₹${studentFeeSummary.totalFee.toLocaleString('en-IN')}\n` +
      `✅ *कुल जमा राशि:* ₹${studentFeeSummary.totalPaid.toLocaleString('en-IN')}\n` +
      `⚠️ *वर्तमान शेष बकाया:* ₹${studentFeeSummary.balance.toLocaleString('en-IN')}\n` +
      `📄 *रसीदों की संख्या:* ${studentFeeSummary.count}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${
        studentFeeSummary.isDue
          ? `⚠️ *सूचना:* कृपया विद्यालय में समय पर बकाया फीस (₹${studentFeeSummary.balance.toLocaleString(
              'en-IN'
            )}) जमा कराना सुनिश्चित करें।`
          : `🎉 *धन्यवाद:* आपके बच्चे का समस्त शुल्क पूर्ण रूप से चुकता है।`
      }\n` +
      `_ई.वी.एस. पब्लिक स्कूल कार्यालय_`;

    const encoded = encodeURIComponent(message);
    const waUrl =
      parentMobile.length >= 10
        ? `https://wa.me/91${parentMobile.slice(-10)}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
  };

  // WhatsApp Single Receipt Share
  const handleShareSingleReceipt = (fee: FeeCollectionRecord) => {
    const matchedStudent = students.find(
      (s) => String(s.Student_ID || '').toLowerCase() === String(fee.Student_ID || '').toLowerCase()
    );
    const studentName = matchedStudent?.Student_Name || fee.Student_ID;
    const className = matchedStudent ? getClassName(matchedStudent.Class) : 'N/A';
    const parentMobile = String(matchedStudent?.Parent_Mobile || '').replace(/\D/g, '');

    const message =
      `*ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)*\n` +
      `*आधिकारिक फीस भुगतान रसीद (Official Fee Receipt)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📄 *रसीद सं:* ${fee.Receipt_Number || 'REC-N/A'}\n` +
      `📅 *भुगतान दिनांक:* ${formatDate(fee.Date)}\n` +
      `👤 *छात्र:* ${studentName} (ID: ${fee.Student_ID})\n` +
      `🏫 *कक्षा:* ${className}\n` +
      `🏷️ *शुल्क प्रकार:* ${fee.Fee_Type || 'मासिक शिक्षण शुल्क'}\n` +
      `🗓️ *अवधि / माह:* ${fee.Month || 'Current'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 *कुल शुल्क राशि:* ₹${(fee.Total_Amount || 0).toLocaleString('en-IN')}\n` +
      `✅ *जमा की गई राशि:* ₹${(fee.Amount_Paid || 0).toLocaleString('en-IN')}\n` +
      `⚠️ *शेष बकाया राशि:* ₹${(fee.Balance_Amount || 0).toLocaleString('en-IN')}\n` +
      `💳 *भुगतान माध्यम:* ${fee.Payment_Mode || 'Cash'}\n` +
      `✍️ *प्राप्तकर्ता:* ${fee.Received_By || managerName}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_शुल्क भुगतान के लिए धन्यवाद। E.V.S. Public School_`;

    const encoded = encodeURIComponent(message);
    const waUrl =
      parentMobile.length >= 10
        ? `https://wa.me/91${parentMobile.slice(-10)}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
  };

  // Print Student Statement
  const handlePrintStatement = () => {
    window.print();
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden space-y-6 animate-fadeIn">
      {/* 1. TOP HEADER & PRIMARY ACTIONS */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-13 h-13 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center text-2xl font-black shadow-lg shadow-amber-500/20 border-2 border-amber-300 shrink-0">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold tracking-wider uppercase">
                  मैनेजर फीस एवं एकाउंट्स हब
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                  Live Sheets Sync
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight mt-0.5">
                छात्र फीस प्रबंधन एवं क्यूआर इतिहास
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                किसी भी बच्चे का क्यूआर स्कैन करके या नाम डालकर फीस का इतिहास देखें, नई फीस जमा करें और व्हाट्सएप रसीद भेजें
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onTriggerQRScan}
              className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all active:scale-95"
            >
              <i className="fa-solid fa-qrcode text-base"></i>
              <span>📷 छात्र QR स्कैन करें</span>
            </button>

            <button
              type="button"
              onClick={() => onOpenAddFeeModal(selectedStudent?.Student_ID)}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-600 text-white font-black rounded-xl text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all active:scale-95"
            >
              <i className="fa-solid fa-plus-circle text-amber-300 text-base"></i>
              <span>+ नई फ़ीस जमा करें</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveViewMode('trends')}
              className={`px-3.5 py-2.5 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 ${
                activeViewMode === 'trends'
                  ? 'bg-amber-400 text-slate-950 shadow-md ring-2 ring-amber-300'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
              title="मासिक फीस वसूली ट्रेंड्स एवं सारांश चार्ट देखें"
            >
              <i className="fa-solid fa-chart-line text-sm text-amber-300"></i>
              <span>मासिक ट्रेंड्स सारांश</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAppsScriptModal(true)}
              className="px-3.5 py-2.5 bg-indigo-600/70 hover:bg-indigo-600 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 border border-indigo-400/40 shadow-xs"
              title="Google Apps Script मासिक फीस ऑटो जेनरेशन ट्रिगर कोड देखें"
            >
              <i className="fa-solid fa-code text-amber-300"></i>
              <span>ऑटो मासिक फीस (Apps Script)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFeeMasterModalOpen(true)}
              className="px-3.5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-md"
              title="हर क्लास की फीस (मासिक, एडमिशन, एग्जाम, ऑटो/वाहन) निर्धारित करें"
            >
              <i className="fa-solid fa-sliders text-sm"></i>
              <span>⚙️ फीस मास्टर सेटिंग्स</span>
            </button>

            <button
              type="button"
              onClick={onRefreshFees}
              disabled={loadingFees}
              className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
              title="Refresh Fee Records"
            >
              <i className={`fa-solid fa-rotate-right ${loadingFees ? 'fa-spin' : ''}`}></i>
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* Global Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-white/10 text-slate-200">
          {/* Card 1: Total Receipts (Clickable to jump to School Ledger) */}
          <div
            onClick={handleNavigateToLedger}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleNavigateToLedger();
              }
            }}
            className="bg-white/5 hover:bg-white/15 backdrop-blur-xs p-3 rounded-2xl border border-white/10 hover:border-amber-400/50 cursor-pointer transition-all duration-200 hover:scale-[1.02] active:scale-98 group shadow-sm flex flex-col justify-between"
            title="क्लिक करें: सीधे 'समस्त स्कूल लेजर' पर जाएं"
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold group-hover:text-amber-200 transition-colors">
                कुल स्कूल रसीदें (Total Receipts)
              </div>
              <span className="text-[9px] text-amber-300 bg-amber-400/20 px-1.5 py-0.5 rounded font-bold group-hover:bg-amber-400 group-hover:text-slate-950 transition-colors flex items-center gap-1">
                <span>लेजर</span>
                <i className="fa-solid fa-arrow-down text-[8px]"></i>
              </span>
            </div>
            <div className="text-lg sm:text-xl font-black text-amber-300 mt-1 flex items-baseline justify-between">
              <span>{schoolFeeTotals.totalReceipts}</span>
              <span className="text-[10px] font-bold text-slate-300 group-hover:text-amber-200 flex items-center gap-1">
                <span>देखें</span>
                <i className="fa-solid fa-chevron-right text-[8px]"></i>
              </span>
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10 flex flex-col justify-between">
            <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
              प्राप्त कुल राशि (Total Collected)
            </div>
            <div className="text-lg sm:text-xl font-black text-emerald-300 mt-1">
              ₹{schoolFeeTotals.collected.toLocaleString('en-IN')}
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10 flex flex-col justify-between">
            <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
              अपेक्षित कुल बकाया (Pending Dues)
            </div>
            <div className="text-lg sm:text-xl font-black text-rose-300 mt-1">
              ₹{schoolFeeTotals.balance.toLocaleString('en-IN')}
            </div>
          </div>

          {/* Card 4: Total Advance Fee (Replaced Manager Name) */}
          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
                कुल अग्रिम जमा (TOTAL ADVANCE FEE)
              </div>
              <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-purple-400/25 text-purple-200 border border-purple-400/40">
                Advance
              </span>
            </div>
            <div className="text-lg sm:text-xl font-black text-purple-300 mt-1">
              ₹{(schoolFeeTotals.totalAdvance || 0).toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* 2. SEARCH & DISCOVERY BAR */}
      <div className="px-6 space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Main Search Input */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400 text-sm pointer-events-none">
              <i className="fa-solid fa-magnifying-glass"></i>
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="छात्र का नाम, आईडी (e.g. 57dd106d), रोल नंबर, या मोबाइल नंबर लिखें..."
              className="w-full pl-10 pr-10 py-3 rounded-2xl border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 text-xs sm:text-sm outline-none bg-slate-50/70 focus:bg-white transition-all shadow-2xs"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 text-sm cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* QR Scan Button */}
          <button
            type="button"
            onClick={onTriggerQRScan}
            className="px-4 py-3 bg-amber-400 hover:bg-amber-500 text-slate-950 font-black rounded-2xl text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95 shrink-0"
            title="Scan QR Code"
          >
            <i className="fa-solid fa-camera"></i>
            <span>QR कोड स्कैन</span>
          </button>

          {/* View Mode Toggle: Trends Summary | Student Profile | School Ledger */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl shrink-0 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveViewMode('trends')}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeViewMode === 'trends'
                  ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <i className="fa-solid fa-chart-line text-xs"></i>
              <span>मासिक ट्रेंड्स सारांश</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveViewMode('student')}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeViewMode === 'student'
                  ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <i className="fa-solid fa-user-graduate text-xs"></i>
              <span>छात्र फीस इतिहास</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveViewMode('allLedger')}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeViewMode === 'allLedger'
                  ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <i className="fa-solid fa-book text-xs"></i>
              <span>समस्त स्कूल लेजर</span>
            </button>
          </div>
        </div>

        {/* Search Results Dropdown when user types */}
        {searchTerm.trim().length > 0 && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 animate-fadeIn max-h-60 overflow-y-auto">
            <div className="text-[11px] font-bold text-slate-500 flex items-center justify-between px-1">
              <span>खोज परिणाम ({filteredStudents.length} छात्र मिले)</span>
              <span>छात्र पर क्लिक करके उसका पूरा फीस इतिहास देखें</span>
            </div>
            {filteredStudents.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                '{searchTerm}' से मिलता-जुलता कोई छात्र नहीं मिला
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {filteredStudents.slice(0, 9).map((st) => (
                  <button
                    key={st.Student_ID}
                    type="button"
                    onClick={() => {
                      setSelectedStudent(st);
                      setActiveViewMode('student');
                      setSearchTerm('');
                    }}
                    className="p-2.5 bg-white hover:bg-amber-50/70 border border-slate-200 hover:border-amber-300 rounded-xl text-left flex items-center gap-2.5 text-xs transition-colors cursor-pointer group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#0c2340] text-amber-400 font-bold flex items-center justify-center text-xs shrink-0 overflow-hidden">
                      {Boolean(getStudentPhoto && getStudentPhoto(st)) ? (
                        <img
                          src={getStudentPhoto(st) || undefined}
                          alt={st.Student_Name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        st.Student_Name?.charAt(0) || 'S'
                      )}
                    </div>
                    <div className="truncate flex-1 min-w-0">
                      <div className="font-bold text-slate-900 truncate group-hover:text-blue-900">
                        {st.Student_Name}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {getClassName(st.Class)} • ID: <span className="font-mono font-bold">{st.Student_ID}</span>
                      </div>
                    </div>
                    <i className="fa-solid fa-chevron-right text-[10px] text-slate-300 group-hover:text-amber-600 shrink-0"></i>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2.5 VIEW MODE: MONTHLY FEE COLLECTION TRENDS & SUMMARY (RECHARTS) */}
      {activeViewMode === 'trends' && (
        <div className="px-6 pb-6 space-y-6 animate-fadeIn">
          {/* Section Banner Header */}
          <div className="bg-gradient-to-br from-slate-900 via-[#0c2340] to-slate-900 text-white rounded-3xl p-6 border border-slate-800 shadow-md">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-wider">
                    Executive Analytics
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-bold">
                    Recharts Live Trends
                  </span>
                </div>
                <h3 className="text-xl sm:text-2xl font-black mt-1 text-white">
                  मासिक फीस वसूली विश्लेषण एवं वित्तीय ट्रेंड्स
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                  संपूर्ण विद्यालय के मासिक शुल्क संग्रहण, कुल देय एवं शेष बकाया का क्रमिक विश्लेषण। रेखा ग्राफ (Line Chart) के माध्यम से प्रत्येक माह की वित्तीय प्रगति का अवलोकन करें।
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors border border-white/10"
                  title="Print Summary Report"
                >
                  <i className="fa-solid fa-print"></i>
                  <span>प्रिंट सारांश</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAddFeeModal()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer transition-all shadow-md active:scale-95"
                >
                  <i className="fa-solid fa-plus-circle text-amber-300"></i>
                  <span>+ नई फीस जमा</span>
                </button>
              </div>
            </div>

            {/* Top Key Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-6 pt-5 border-t border-white/10">
              {/* Total Collected */}
              <div className="bg-white/5 backdrop-blur-xs p-3.5 rounded-2xl border border-white/10">
                <span className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold block">
                  कुल संचित वसूली (Total Paid)
                </span>
                <span className="text-xl sm:text-2xl font-black text-emerald-300 mt-1 block">
                  ₹{trendsKPIs.totalCollected.toLocaleString('en-IN')}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  कुल {trendsKPIs.totalReceipts} रसीदें दर्ज
                </span>
              </div>

              {/* Peak Collection Month */}
              <div className="bg-white/5 backdrop-blur-xs p-3.5 rounded-2xl border border-white/10">
                <span className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold block">
                  उच्चतम वसूली माह (Peak Month)
                </span>
                <span className="text-xl sm:text-2xl font-black text-amber-300 mt-1 block truncate">
                  {trendsKPIs.peakMonth ? trendsKPIs.peakMonth.name : '—'}
                </span>
                <span className="text-[10px] text-amber-200/80 mt-0.5 block">
                  {trendsKPIs.peakMonth
                    ? `₹${trendsKPIs.peakMonth.amount.toLocaleString('en-IN')} (${trendsKPIs.peakMonth.receipts} रसीदें)`
                    : 'कोई रिकॉर्ड नहीं'}
                </span>
              </div>

              {/* Average Monthly */}
              <div className="bg-white/5 backdrop-blur-xs p-3.5 rounded-2xl border border-white/10">
                <span className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold block">
                  औसत मासिक संग्रह (Avg Monthly)
                </span>
                <span className="text-xl sm:text-2xl font-black text-sky-300 mt-1 block">
                  ₹{trendsKPIs.avgMonthly.toLocaleString('en-IN')}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  सक्रिय {trendsKPIs.activeMonthsCount} महीनों का औसत
                </span>
              </div>

              {/* Collection Recovery Rate */}
              <div className="bg-white/5 backdrop-blur-xs p-3.5 rounded-2xl border border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold block">
                    वसूली दर (Recovery %)
                  </span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase bg-emerald-500/30 text-emerald-300 border border-emerald-400/30">
                    {trendsKPIs.overallRecovery}%
                  </span>
                </div>
                <span className="text-xl sm:text-2xl font-black text-emerald-400 mt-1 block">
                  {trendsKPIs.overallRecovery}%
                </span>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden mt-1.5">
                  <div
                    className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, trendsKPIs.overallRecovery))}%` }}
                  ></div>
                </div>
              </div>

              {/* Top Payment Mode */}
              <div className="bg-white/5 backdrop-blur-xs p-3.5 rounded-2xl border border-white/10 col-span-2 lg:col-span-1">
                <span className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold block">
                  प्रमुख भुगतान माध्यम (Top Mode)
                </span>
                <span className="text-xl sm:text-2xl font-black text-purple-300 mt-1 block flex items-center gap-1.5">
                  <i className="fa-solid fa-money-bill-transfer text-base text-purple-400"></i>
                  <span>{trendsKPIs.topOverallMode}</span>
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  अधिकांश अभिभावकों की पसंद
                </span>
              </div>
            </div>
          </div>

          {/* Interactive Chart Control Toolbar */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Metric Mode Filter */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-slate-600 mr-1 flex items-center gap-1">
                <i className="fa-solid fa-sliders text-amber-600 text-[11px]"></i>
                <span>चार्ट मेट्रिक्स:</span>
              </span>
              <button
                type="button"
                onClick={() => setTrendsMetricFilter('all')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  trendsMetricFilter === 'all'
                    ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                समस्त वित्तीय आंकड़े (All)
              </button>
              <button
                type="button"
                onClick={() => setTrendsMetricFilter('collectionOnly')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  trendsMetricFilter === 'collectionOnly'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                केवल वसूली ट्रेंड (Paid)
              </button>
              <button
                type="button"
                onClick={() => setTrendsMetricFilter('collectionVsDue')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  trendsMetricFilter === 'collectionVsDue'
                    ? 'bg-rose-700 text-white shadow-xs'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                वसूली बनाम बकाया (Paid vs Due)
              </button>
            </div>

            {/* Scope & Class Filter Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Scope Selector */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setTrendsScope('allSession')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    trendsScope === 'allSession'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="शैक्षणिक सत्र के सभी 12 माह दिखाएं"
                >
                  पूरा सत्र (12 माह)
                </button>
                <button
                  type="button"
                  onClick={() => setTrendsScope('activeOnly')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    trendsScope === 'activeOnly'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="केवल वही माह जिनमें फीस जमा हुई है"
                >
                  सक्रिय माह (Active Only)
                </button>
              </div>

              {/* Class Filter */}
              <div className="flex items-center gap-1.5">
                <select
                  value={trendsClassFilter}
                  onChange={(e) => setTrendsClassFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white outline-none font-semibold text-slate-800"
                >
                  <option value="all">कक्षा: All Classes</option>
                  {trendsClassOptions.map((c) => (
                    <option key={c} value={c}>
                      कक्षा: {getClassName(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* RECHARTS LINE CHART CONTAINER */}
          <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center text-sm border border-emerald-200 shrink-0">
                  <i className="fa-solid fa-chart-line"></i>
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900">
                    मासिक फीस वसूली प्रवृत्ति रेखा (Fee Collection Trend Chart)
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    {trendsClassFilter === 'all'
                      ? 'समस्त कक्षाओं के लिए मासिक संग्रहण प्रगति'
                      : `कक्षा ${getClassName(trendsClassFilter)} के लिए मासिक संग्रहण प्रगति`}
                  </span>
                </div>
              </div>

              {/* Live Legend indicator */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-emerald-200"></span>
                  <span className="font-semibold text-slate-700">जमा वसूली (Paid)</span>
                </div>
                {trendsMetricFilter === 'all' && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-1 bg-slate-900 border-t-2 border-dashed border-slate-900"></span>
                    <span className="font-semibold text-slate-700">कुल देय (Billed)</span>
                  </div>
                )}
                {(trendsMetricFilter === 'all' || trendsMetricFilter === 'collectionVsDue') && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-rose-500 ring-2 ring-rose-200"></span>
                    <span className="font-semibold text-slate-700">शेष बकाया (Due)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Recharts LineChart Component */}
            <div className="w-full pt-2" style={{ minHeight: '340px' }}>
              <ResponsiveContainer width="100%" height={340}>
                <LineChart
                  data={monthlyTrendsData}
                  margin={{ top: 20, right: 30, left: 15, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="monthShort"
                    tick={{ fill: '#334155', fontSize: 12, fontWeight: 700 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1' }}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(val) =>
                      `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`
                    }
                  />
                  <Tooltip content={<TrendsTooltip />} />
                  <Legend
                    wrapperStyle={{ paddingTop: '16px', fontSize: '12px', fontWeight: 600 }}
                  />
                  {trendsKPIs.avgMonthly > 0 && (
                    <ReferenceLine
                      y={trendsKPIs.avgMonthly}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{
                        value: `Avg: ₹${trendsKPIs.avgMonthly.toLocaleString('en-IN')}`,
                        position: 'insideTopRight',
                        fill: '#64748b',
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="collected"
                    name="फीस वसूली (Collection ₹)"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={{ r: 5, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
                    activeDot={{ r: 7, fill: '#059669', stroke: '#ffffff', strokeWidth: 3 }}
                  />
                  {trendsMetricFilter === 'all' && (
                    <Line
                      type="monotone"
                      dataKey="totalBilled"
                      name="कुल देय शुल्क (Total Billed ₹)"
                      stroke="#0c2340"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={{ r: 3, fill: '#0c2340' }}
                    />
                  )}
                  {(trendsMetricFilter === 'all' || trendsMetricFilter === 'collectionVsDue') && (
                    <Line
                      type="monotone"
                      dataKey="balance"
                      name="शेष बकाया (Pending Due ₹)"
                      stroke="#f43f5e"
                      strokeWidth={2}
                      dot={{ r: 4, fill: '#f43f5e', stroke: '#ffffff', strokeWidth: 1 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span className="flex items-center gap-1.5">
                <i className="fa-solid fa-circle-info text-amber-500"></i>
                <span>चार्ट के किसी भी बिंदु (Point) पर होवर करके उस माह का विस्तृत विवरण देखें।</span>
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                कुल {monthlyTrendsData.length} माह विश्लेषित
              </span>
            </div>
          </div>

          {/* MONTHLY BREAKDOWN TABLE & DRILLDOWN */}
          <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 font-bold flex items-center justify-center text-sm border border-amber-200 shrink-0">
                  <i className="fa-solid fa-table-list"></i>
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900">
                    मासिक विवरण एवं वित्तीय संतुलन तालिका (Monthly Breakdown Table)
                  </h4>
                  <span className="text-[11px] text-slate-500">
                    प्रत्येक शैक्षणिक माह का शुल्क संग्रहण, देय राशि, वसूली दक्षता एवं माह-दर-माह वृद्धि
                  </span>
                </div>
              </div>

              <div className="text-xs text-slate-500">
                सक्रिय लेनदेन माह: <strong>{trendsKPIs.activeMonthsCount}</strong>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3">माह (Month)</th>
                    <th className="px-3 py-3 text-center">रसीदें</th>
                    <th className="px-4 py-3 text-right">जमा वसूली (Paid ₹)</th>
                    <th className="px-4 py-3 text-right">कुल देय (Billed ₹)</th>
                    <th className="px-4 py-3 text-right">शुद्ध बकाया (Net Due ₹)</th>
                    <th className="px-3.5 py-3 text-center">वसूली दक्षता (Efficiency %)</th>
                    <th className="px-3.5 py-3 text-center">वृद्धि दर (Trend)</th>
                    <th className="px-3.5 py-3">प्रमुख माध्यम</th>
                    <th className="px-3 py-3 text-center">लेजर देखें</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {monthlyTrendsData.map((m) => {
                    const isPeak =
                      trendsKPIs.peakMonth &&
                      trendsKPIs.peakMonth.name === m.monthFull &&
                      m.collected > 0;
                    const hasData = m.receiptCount > 0 || m.collected > 0;

                    return (
                      <tr
                        key={m.monthKey}
                        className={`hover:bg-slate-50 transition-colors ${
                          isPeak ? 'bg-amber-50/40 font-semibold' : ''
                        }`}
                      >
                        {/* Month Name */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{m.monthFull}</span>
                            {isPeak && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[9px] uppercase tracking-wider">
                                Peak 🏆
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Receipts Count */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md font-mono text-[11px] font-bold ${
                              m.receiptCount > 0
                                ? 'bg-blue-50 text-blue-900 border border-blue-200'
                                : 'text-slate-400'
                            }`}
                          >
                            {m.receiptCount}
                          </span>
                        </td>

                        {/* Amount Collected */}
                        <td className="px-4 py-3 text-right whitespace-nowrap font-black font-mono text-emerald-700 text-sm">
                          ₹{m.collected.toLocaleString('en-IN')}
                        </td>

                        {/* Total Billed */}
                        <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-slate-600">
                          ₹{m.totalBilled.toLocaleString('en-IN')}
                        </td>

                        {/* Balance / Net Due */}
                        <td className="px-4 py-3 text-right whitespace-nowrap font-mono font-bold">
                          {m.balance === 0 && m.totalBilled > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <i className="fa-solid fa-circle-check text-[10px]"></i>
                              <span>₹0 (Cleared)</span>
                            </span>
                          ) : m.balance > 0 ? (
                            <span className="text-rose-700 font-extrabold">
                              ₹{m.balance.toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="text-slate-400">₹0</span>
                          )}
                        </td>

                        {/* Collection Efficiency (%) */}
                        <td className="px-3.5 py-3 text-center whitespace-nowrap">
                          {m.totalBilled > 0 ? (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                m.recoveryRate >= 80
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : m.recoveryRate >= 50
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {m.recoveryRate}%
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Growth % vs Previous Month */}
                        <td className="px-3.5 py-3 text-center whitespace-nowrap">
                          {m.growthPct !== null ? (
                            <span
                              className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                                m.growthPct > 0
                                  ? 'text-emerald-700 bg-emerald-50'
                                  : m.growthPct < 0
                                  ? 'text-rose-700 bg-rose-50'
                                  : 'text-slate-500 bg-slate-50'
                              }`}
                            >
                              <i
                                className={`fa-solid ${
                                  m.growthPct > 0
                                    ? 'fa-arrow-up text-[9px]'
                                    : m.growthPct < 0
                                    ? 'fa-arrow-down text-[9px]'
                                    : 'fa-minus text-[9px]'
                                }`}
                              ></i>
                              <span>{Math.abs(m.growthPct)}%</span>
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Top Payment Mode */}
                        <td className="px-3.5 py-3 whitespace-nowrap text-slate-600">
                          {hasData ? (
                            <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700">
                              {m.topMode}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        {/* Action: Jump to ledger */}
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          {m.receiptCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setLedgerSearch(m.monthFull);
                                setActiveViewMode('allLedger');
                              }}
                              className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 rounded-lg font-bold text-[10px] cursor-pointer transition-colors"
                              title={`${m.monthFull} की समस्त रसीदें देखें`}
                            >
                              रसीदें ({m.receiptCount}) →
                            </button>
                          ) : (
                            <span className="text-slate-300 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* Table Footer with Summary Totals */}
                <tfoot className="bg-slate-100 text-slate-900 font-extrabold text-xs border-t-2 border-slate-300">
                  <tr>
                    <td className="px-4 py-3">सत्र कुल योग (Session Total)</td>
                    <td className="px-3 py-3 text-center font-mono font-bold text-blue-900">
                      {trendsKPIs.totalReceipts}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-black text-emerald-800 text-sm">
                      ₹{trendsKPIs.totalCollected.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      ₹{trendsKPIs.totalBilled.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-rose-800">
                      ₹{trendsKPIs.totalBalance.toLocaleString('en-IN')}
                    </td>
                    <td className="px-3.5 py-3 text-center text-emerald-800">
                      {trendsKPIs.overallRecovery}%
                    </td>
                    <td className="px-3.5 py-3 text-center text-slate-400">—</td>
                    <td className="px-3.5 py-3 text-slate-700 font-normal">
                      {trendsKPIs.topOverallMode}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setLedgerSearch('');
                          setActiveViewMode('allLedger');
                        }}
                        className="text-blue-900 font-bold hover:underline text-[10px] cursor-pointer"
                      >
                        पूर्ण लेजर →
                      </button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. VIEW MODE: STUDENT FEE PROFILE & HISTORY */}
      {activeViewMode === 'student' && (
        <div className="px-6 pb-6 space-y-6">
          {/* Selected Student Card */}
          {selectedStudent ? (
            <div className="bg-gradient-to-br from-slate-50 via-white to-amber-50/30 rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-5">
              {/* Profile Header */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pb-5 border-b border-slate-200/80">
                <div className="flex items-start sm:items-center gap-4">
                  {/* Photo */}
                  <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-[#0c2340] text-amber-400 font-black text-2xl flex items-center justify-center border-2 border-amber-300 shadow-md shrink-0 overflow-hidden">
                    {Boolean(getStudentPhoto && getStudentPhoto(selectedStudent)) ? (
                      <img
                        src={getStudentPhoto(selectedStudent) || undefined}
                        alt={selectedStudent.Student_Name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      selectedStudent.Student_Name?.charAt(0) || 'S'
                    )}
                  </div>

                  {/* Details */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl sm:text-2xl font-black text-slate-900">
                        {selectedStudent.Student_Name}
                      </h3>
                      <span className="px-3 py-1 rounded-xl bg-[#0c2340] text-amber-300 font-extrabold text-xs">
                        Class {getClassName(selectedStudent.Class)}
                      </span>
                      {selectedStudent.Roll_Number && (
                        <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-xs border border-slate-200">
                          Roll #{selectedStudent.Roll_Number}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-slate-600 pt-0.5">
                      <div>
                        <span className="text-slate-400">Student ID:</span>{' '}
                        <span className="font-mono font-bold text-blue-950">{selectedStudent.Student_ID}</span>
                      </div>
                      <span className="text-slate-300">•</span>
                      <div>
                        <span className="text-slate-400">Adm No:</span>{' '}
                        <span className="font-semibold text-slate-800">
                          {selectedStudent.Admission_Number || '—'}
                        </span>
                      </div>
                      <span className="text-slate-300">•</span>
                      <div>
                        <span className="text-slate-400">पिता का नाम:</span>{' '}
                        <span className="font-semibold text-slate-800">
                          {selectedStudent.Father_Name || '—'}
                        </span>
                      </div>
                      <span className="text-slate-300">•</span>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400">सत्र प्रारंभ माह:</span>{' '}
                        <span className="font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                          {selectedStudent.Session_Start_Month || 'April'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-xs text-slate-500 pt-0.5">
                      {selectedStudent.Parent_Mobile && (
                        <div className="flex items-center gap-1.5">
                          <i className="fa-solid fa-phone text-[10px] text-slate-400"></i>
                          <span>{selectedStudent.Parent_Mobile}</span>
                        </div>
                      )}
                      {(selectedStudent['Village/rRoute'] || selectedStudent.Village) && (
                        <div className="flex items-center gap-1.5">
                          <i className="fa-solid fa-location-dot text-[10px] text-slate-400"></i>
                          <span>{selectedStudent['Village/rRoute'] || selectedStudent.Village}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Action Toolbar for this student */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onOpenAddFeeModal(selectedStudent.Student_ID)}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                  >
                    <i className="fa-solid fa-plus-circle text-amber-300 text-sm"></i>
                    <span>+ इस छात्र की फीस जमा करें</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShareFeeStatement}
                    className="px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold rounded-xl text-xs flex items-center gap-1.5 border border-emerald-300 cursor-pointer transition-colors shadow-2xs"
                    title="Send Statement via WhatsApp"
                  >
                    <i className="fa-brands fa-whatsapp text-emerald-600 text-sm"></i>
                    <span>व्हाट्सएप विवरण</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintStatement}
                    className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center gap-1.5 border border-slate-300 cursor-pointer transition-colors"
                    title="Print Statement"
                  >
                    <i className="fa-solid fa-print text-xs"></i>
                    <span>प्रिंट</span>
                  </button>
                </div>
              </div>

              {/* Financial Metrics Cards for this student */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 shadow-2xs">
                  <span className="text-[11px] text-slate-500 font-medium block">
                    सत्र कुल देय (Total Session Fee)
                  </span>
                  <span className="text-xl sm:text-2xl font-black text-slate-800 mt-1 block">
                    ₹{studentFeeSummary.totalFee.toLocaleString('en-IN')}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-2xs">
                  <span className="text-[11px] text-emerald-700 font-medium block">
                    कुल जमा राशि (Total Fees Paid)
                  </span>
                  <span className="text-xl sm:text-2xl font-black text-emerald-900 mt-1 block">
                    ₹{studentFeeSummary.totalPaid.toLocaleString('en-IN')}
                  </span>
                </div>

                <div
                  className={`p-4 rounded-2xl border shadow-2xs ${
                    studentFeeSummary.isAdvance
                      ? 'bg-purple-50 border-purple-300 text-purple-950'
                      : studentFeeSummary.isDue
                      ? 'bg-rose-50 border-rose-300 text-rose-950'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-bold uppercase tracking-wide ${
                        studentFeeSummary.isAdvance
                          ? 'text-purple-700'
                          : studentFeeSummary.isDue
                          ? 'text-rose-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {studentFeeSummary.isAdvance
                        ? 'अग्रिम जमा (ADVANCE)'
                        : studentFeeSummary.isDue
                        ? 'वर्तमान बकाया (DUE)'
                        : 'बकाया स्थिति (STATUS)'}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${
                        studentFeeSummary.isAdvance
                          ? 'bg-purple-200 text-purple-900'
                          : studentFeeSummary.isDue
                          ? 'bg-rose-200 text-rose-900'
                          : 'bg-emerald-200 text-emerald-900'
                      }`}
                    >
                      {studentFeeSummary.isAdvance ? 'ADVANCE' : studentFeeSummary.isDue ? 'PENDING' : 'CLEARED'}
                    </span>
                  </div>
                  <span
                    className={`text-xl sm:text-2xl font-black mt-1 block ${
                      studentFeeSummary.isAdvance
                        ? 'text-purple-900'
                        : studentFeeSummary.isDue
                        ? 'text-rose-900'
                        : 'text-emerald-900'
                    }`}
                  >
                    {studentFeeSummary.isAdvance
                      ? `-₹${studentFeeSummary.advanceAmount.toLocaleString('en-IN')}`
                      : `₹${studentFeeSummary.balance.toLocaleString('en-IN')}`}
                  </span>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 shadow-2xs flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] text-slate-500 font-medium block">
                      कुल रसीदें (Receipts)
                    </span>
                    <span className="text-xl sm:text-2xl font-black text-slate-800 mt-1 block">
                      {studentFeeSummary.count} रसीदें
                    </span>
                  </div>

                  {studentFeeSummary.isDue && onClearBalance && (
                    <button
                      type="button"
                      onClick={() => onClearBalance(selectedStudent, studentFeeSummary.balance)}
                      className="text-[11px] font-bold text-rose-700 hover:text-rose-900 hover:underline cursor-pointer text-left pt-1"
                    >
                      बकाया हटाकर ₹0 करें →
                    </button>
                  )}
                </div>
              </div>

              {/* Complete Fee History Table for this Student */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    <i className="fa-solid fa-clock-rotate-left text-amber-600"></i>
                    <span>
                      {selectedStudent.Student_Name} का संपूर्ण फीस भुगतान इतिहास (Payment Records)
                    </span>
                  </h4>

                  <span className="text-xs text-slate-500">
                    कुल <strong>{studentFeeRecords.length}</strong> भुगतान रिकॉर्ड उपलब्ध
                  </span>
                </div>

                {studentFeeRecords.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-slate-500 space-y-3">
                    <i className="fa-solid fa-receipt text-3xl text-slate-300 block"></i>
                    <div className="font-bold text-slate-700 text-sm">
                      इस छात्र के लिए अभी कोई फीस भुगतान दर्ज नहीं है
                    </div>
                    <p className="text-xs text-slate-400 max-w-sm mx-auto">
                      पहली फीस रसीद बनाने के लिए नीचे दिए गए बटन पर क्लिक करें। रसीद बनाते ही छात्र के खाते में जमा जुड़ जाएगा।
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenAddFeeModal(selectedStudent.Student_ID)}
                      className="px-4 py-2 bg-[#0c2340] text-amber-300 font-bold rounded-xl text-xs hover:bg-[#10316b] cursor-pointer inline-flex items-center gap-2 shadow-sm"
                    >
                      <i className="fa-solid fa-plus-circle text-amber-400"></i>
                      <span>+ इस छात्र की पहली फीस रसीद बनाएं</span>
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-left text-xs text-slate-700">
                      <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-3.5 py-3">Receipt No</th>
                          <th className="px-3.5 py-3">Date</th>
                          <th className="px-3.5 py-3">Fee Type</th>
                          <th className="px-3.5 py-3">Month / Duration</th>
                          <th className="px-3.5 py-3 text-right">Total Fee</th>
                          <th className="px-3.5 py-3 text-right">Paid (₹)</th>
                          <th className="px-3.5 py-3 text-right">Balance</th>
                          <th className="px-3.5 py-3">Payment Mode</th>
                          <th className="px-3.5 py-3">Received By</th>
                          <th className="px-3.5 py-3 text-center">Receipt Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 bg-white">
                        {studentFeeRecords.map((fee, idx) => {
                          const recBal = computeReceiptBalance(fee);

                          return (
                            <tr
                              key={fee.Receipt_Number || idx}
                              className="hover:bg-slate-50/80 transition-colors"
                            >
                              <td className="px-3.5 py-3 font-mono font-bold text-blue-950 whitespace-nowrap">
                                {fee.Receipt_Number || `REC-${idx + 1}`}
                              </td>
                              <td className="px-3.5 py-3 text-slate-500 whitespace-nowrap">
                                {formatDate(fee.Date)}
                              </td>
                              <td className="px-3.5 py-3 font-medium text-slate-800 whitespace-nowrap">
                                <div>{fee.Fee_Type || 'Monthly Tuition Fee'}</div>
                                {(fee as any).Allocations_Summary && (
                                  <div className="text-[10px] text-indigo-700 font-bold max-w-[170px] truncate" title={(fee as any).Allocations_Summary}>
                                    {(fee as any).Allocations_Summary}
                                  </div>
                                )}
                              </td>
                              <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                                {fee.Month || '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-medium text-slate-700 whitespace-nowrap">
                                <div>₹{(fee.Total_Amount || 0).toLocaleString('en-IN')}</div>
                                {(fee as any).Discount_Amount > 0 && (
                                  <div className="text-[10px] font-bold text-amber-700">
                                    -₹{Number((fee as any).Discount_Amount).toLocaleString('en-IN')} छूट
                                  </div>
                                )}
                              </td>
                              <td className="px-3.5 py-3 text-right font-bold text-emerald-700 whitespace-nowrap">
                                ₹{(fee.Amount_Paid || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                {recBal.isAdvance ? (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-black bg-purple-100 text-purple-900 border border-purple-200 inline-flex items-center gap-1">
                                    <span>-₹{Math.abs(recBal.balance).toLocaleString('en-IN')}</span>
                                    <span className="text-[9px] uppercase font-bold text-purple-700 bg-purple-200/80 px-1 py-0.2 rounded">
                                      Adv
                                    </span>
                                  </span>
                                ) : recBal.isPending ? (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800">
                                    ₹{recBal.balance.toLocaleString('en-IN')}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                                    ₹0
                                  </span>
                                )}
                              </td>
                              <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                                <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700">
                                  {fee.Payment_Mode || 'Cash'}
                                </span>
                              </td>
                              <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                                {fee.Received_By || managerName}
                              </td>
                              <td className="px-3.5 py-3 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const st = (selectedStudent || students.find((s) => String(s.Student_ID).toLowerCase() === String(fee.Student_ID).toLowerCase())) as Student;
                                      if (st) setPrintingReceiptRecord({ student: st, fee });
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-900 hover:bg-blue-800 text-amber-300 font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                    title="आधिकारिक रसीद प्रिंट / PDF करें"
                                  >
                                    <i className="fa-solid fa-print text-xs"></i>
                                    <span>प्रिंट</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleShareSingleReceipt(fee)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                    title="Share WhatsApp Receipt with Parent"
                                  >
                                    <i className="fa-brands fa-whatsapp text-xs"></i>
                                    <span>Receipt</span>
                                  </button>
                                  {onEditFee && (
                                    <button
                                      type="button"
                                      onClick={() => handleStartEditFee(fee)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                      title="इस फीस प्रविष्टि को संपादित करें (Edit Fee)"
                                    >
                                      <i className="fa-solid fa-pen-to-square text-xs"></i>
                                      <span>एडिट</span>
                                    </button>
                                  )}
                                  {onDeleteFee && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteFeeClick(fee)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                      title="इस फीस प्रविष्टि को हटाएं (Delete Fee)"
                                    >
                                      <i className="fa-solid fa-trash-can text-xs"></i>
                                      <span>हटाएं</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-12 text-center bg-slate-50 rounded-3xl border border-slate-200 text-slate-500 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto text-2xl">
                <i className="fa-solid fa-id-badge"></i>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  किसी भी छात्र की फीस देखने हेतु नाम या QR स्कैन करें
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
                  ऊपर दिए गए सर्च बार में छात्र का नाम, आईडी या रोल नंबर टाइप करें अथवा '📷 QR स्कैन करें' बटन से बच्चे के आई-कार्ड का क्यूआर कोड स्कैन करें।
                </p>
              </div>

              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveViewMode('trends')}
                  className="px-4 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold rounded-xl text-xs cursor-pointer flex items-center gap-2 transition-colors shadow-2xs"
                >
                  <i className="fa-solid fa-chart-line text-emerald-700"></i>
                  <span>मासिक फीस ट्रेंड्स सारांश देखें</span>
                </button>

                <button
                  type="button"
                  onClick={onTriggerQRScan}
                  className="px-4 py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-qrcode"></i>
                  <span>QR कोड स्कैन करें</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenAddFeeModal()}
                  className="px-4 py-2.5 bg-[#0c2340] text-amber-300 font-bold rounded-xl text-xs hover:bg-[#10316b] cursor-pointer flex items-center gap-2"
                >
                  <i className="fa-solid fa-plus-circle"></i>
                  <span>+ नई फीस जमा करें</span>
                </button>
              </div>

              {/* Sample Quick Student Shortcuts */}
              {students.length > 0 && (
                <div className="pt-6 border-t border-slate-200/80 max-w-xl mx-auto">
                  <span className="text-[11px] font-bold text-slate-400 block mb-2">
                    त्वरित छात्र चयन (Quick Student Select):
                  </span>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {students.slice(0, 6).map((st) => (
                      <button
                        key={st.Student_ID}
                        type="button"
                        onClick={() => setSelectedStudent(st)}
                        className="px-3 py-1.5 rounded-xl bg-white hover:bg-blue-50 border border-slate-200 text-xs font-semibold text-slate-700 hover:text-blue-900 cursor-pointer transition-colors"
                      >
                        {st.Student_Name} ({getClassName(st.Class)})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. VIEW MODE: ALL SCHOOL FEE LEDGER */}
      {activeViewMode === 'allLedger' && (
        <div ref={ledgerSectionRef} id="school-ledger-section" className="px-6 pb-6 space-y-4 scroll-mt-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                <i className="fa-solid fa-magnifying-glass"></i>
              </span>
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="रसीद संख्या, छात्र आईडी, शुल्क प्रकार से खोजें..."
                className="w-full pl-8 pr-3.5 py-2 rounded-xl border border-slate-300 text-xs outline-none focus:border-blue-900"
              />
            </div>

            <div className="text-xs text-slate-500">
              कुल रसीदें: <strong>{filteredAllLedger.length}</strong>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3.5 py-3">Receipt No</th>
                  <th className="px-3.5 py-3">Date</th>
                  <th className="px-3.5 py-3">Student Name & ID</th>
                  <th className="px-3.5 py-3">Fee Type</th>
                  <th className="px-3.5 py-3">Month</th>
                  <th className="px-3.5 py-3 text-right">Total Fee</th>
                  <th className="px-3.5 py-3 text-right">Paid</th>
                  <th className="px-3.5 py-3 text-right">Balance</th>
                  <th className="px-3.5 py-3">Mode</th>
                  <th className="px-3.5 py-3">Received By</th>
                  <th className="px-3.5 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredAllLedger.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-10 text-slate-400">
                      कोई फीस रिकॉर्ड नहीं मिला
                    </td>
                  </tr>
                ) : (
                  filteredAllLedger.map((fee, idx) => {
                    const matchedStudent = students.find(
                      (s) => String(s.Student_ID || '').toLowerCase() === String(fee.Student_ID || '').toLowerCase()
                    );
                    const studentName = matchedStudent?.Student_Name || fee.Student_ID;
                    const classNameStr = matchedStudent?.Class ? getClassName(matchedStudent.Class) : '';
                    const recBal = computeReceiptBalance(fee);

                    return (
                      <tr key={fee.Receipt_Number || idx} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3.5 py-2.5 font-mono font-bold text-blue-950 whitespace-nowrap">
                          {fee.Receipt_Number || `REC-${idx + 1}`}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                          {formatDate(fee.Date)}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (matchedStudent) {
                                setSelectedStudent(matchedStudent);
                                setActiveViewMode('student');
                              }
                            }}
                            className="text-left font-bold text-blue-900 hover:underline cursor-pointer"
                          >
                            {studentName}
                          </button>
                          <div className="text-[10px] text-slate-500 flex items-center gap-1.5">
                            <span className="font-mono">{fee.Student_ID}</span>
                            {classNameStr && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-slate-700">{classNameStr}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                          <div>{fee.Fee_Type || 'Monthly Tuition'}</div>
                          {(fee as any).Allocations_Summary && (
                            <div className="text-[10px] text-indigo-700 font-bold max-w-[170px] truncate" title={(fee as any).Allocations_Summary}>
                              {(fee as any).Allocations_Summary}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                          {fee.Month || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-700 whitespace-nowrap">
                          <div>₹{(fee.Total_Amount || 0).toLocaleString('en-IN')}</div>
                          {(fee as any).Discount_Amount > 0 && (
                            <div className="text-[10px] font-bold text-amber-700">
                              -₹{Number((fee as any).Discount_Amount).toLocaleString('en-IN')} छूट
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                          ₹{(fee.Amount_Paid || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                          {recBal.isAdvance ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-black bg-purple-100 text-purple-900 border border-purple-200 inline-flex items-center gap-1">
                              <span>-₹{Math.abs(recBal.balance).toLocaleString('en-IN')}</span>
                              <span className="text-[9px] uppercase font-bold text-purple-700 bg-purple-200/80 px-1 py-0.2 rounded">
                                Adv
                              </span>
                            </span>
                          ) : recBal.isPending ? (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-100 text-rose-800">
                              ₹{recBal.balance.toLocaleString('en-IN')}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                              ₹0
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                          <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700">
                            {fee.Payment_Mode || 'Cash'}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                          {fee.Received_By || managerName}
                        </td>
                        <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                const st = (selectedStudent || students.find((s) => String(s.Student_ID).toLowerCase() === String(fee.Student_ID).toLowerCase())) as Student;
                                if (st) setPrintingReceiptRecord({ student: st, fee });
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-900 hover:bg-blue-800 text-amber-300 font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                              title="आधिकारिक रसीद प्रिंट / PDF करें"
                            >
                              <i className="fa-solid fa-print text-xs"></i>
                              <span>प्रिंट</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleShareSingleReceipt(fee)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                              title="Share WhatsApp Receipt"
                            >
                              <i className="fa-brands fa-whatsapp text-xs"></i>
                              <span>रसीद</span>
                            </button>
                            {onEditFee && (
                              <button
                                type="button"
                                onClick={() => handleStartEditFee(fee)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                title="इस फीस प्रविष्टि को संपादित करें (Edit Fee)"
                              >
                                <i className="fa-solid fa-pen-to-square text-xs"></i>
                                <span>एडिट</span>
                              </button>
                            )}
                            {onDeleteFee && (
                              <button
                                type="button"
                                onClick={() => handleDeleteFeeClick(fee)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                title="इस फीस प्रविष्टि को हटाएं (Delete Fee)"
                              >
                                <i className="fa-solid fa-trash-can text-xs"></i>
                                <span>हटाएं</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Fee Record Modal for Manager */}
      {editingFee && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 my-auto max-h-[95vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-base shadow-sm">
                  <i className="fa-solid fa-pen-to-square"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold text-amber-300 leading-tight">
                    फीस रसीद संपादित करें (Edit Fee Receipt)
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    रसीद संख्या: <span className="font-mono text-amber-200">#{editingFee.Receipt_Number}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingFee(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveEditFee} className="p-5 overflow-y-auto space-y-4 flex-1">
              {editError && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs font-semibold flex items-center gap-2">
                  <i className="fa-solid fa-circle-exclamation text-rose-600 text-sm"></i>
                  <span>{editError}</span>
                </div>
              )}

              {/* Student Info Card */}
              {(() => {
                const matched = students.find((s) => String(s.Student_ID).toLowerCase() === String(editingFee.Student_ID).toLowerCase());
                return (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-full bg-blue-900 text-amber-300 font-bold flex items-center justify-center text-sm">
                        {matched?.Student_Name ? matched.Student_Name.charAt(0) : 'S'}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{matched?.Student_Name || editingFee.Student_ID}</div>
                        <div className="text-[11px] text-slate-500">
                          ID: <span className="font-mono text-slate-700 font-bold">{editingFee.Student_ID}</span>
                          {matched?.Class && <span> • कक्षा: {getClassName(matched.Class)}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Receipt Number & Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    रसीद संख्या (Receipt No) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editReceiptNo}
                    onChange={(e) => setEditReceiptNo(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs focus:border-blue-800 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    भुगतान तिथि (Date) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none"
                  />
                </div>
              </div>

              {/* Fee Type & Month */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    शुल्क प्रकार (Fee Type) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={editFeeType}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditFeeType(val);
                      if (val.toLowerCase().includes('advance') || val.includes('अग्रिम')) {
                        setEditTotalAmount('0');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white font-medium"
                  >
                    <option value="Monthly Tuition Fee (मासिक शिक्षण शुल्क)">Monthly Tuition Fee (मासिक शिक्षण शुल्क)</option>
                    <option value="Advance Fee Deposit (अग्रिम शुल्क जमा)">Advance Fee Deposit (अग्रिम शुल्क जमा)</option>
                    <option value="Admission Fee (प्रवेश शुल्क)">Admission Fee (प्रवेश शुल्क)</option>
                    <option value="Examination Fee (परीक्षा शुल्क)">Examination Fee (परीक्षा शुल्क)</option>
                    <option value="Annual Charges (वार्षिक शुल्क)">Annual Charges (वार्षिक शुल्क)</option>
                    <option value="Transportation / Bus Fee (वाहन शुल्क)">Transportation / Bus Fee (वाहन शुल्क)</option>
                    <option value="Books & Stationery (पुस्तकालय / पुस्तकें)">Books & Stationery (पुस्तकालय / पुस्तकें)</option>
                    <option value="School Uniform Fee (यूनिफॉर्म)">School Uniform Fee (यूनिफॉर्म)</option>
                    <option value="Late Fee / Fine (विलंब शुल्क)">Late Fee / Fine (विलंब शुल्क)</option>
                    <option value="Miscellaneous / Other (अन्य)">Miscellaneous / Other (अन्य)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    माह / अवधि (Fee Month) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editMonth}
                    onChange={(e) => setEditMonth(e.target.value)}
                    placeholder="e.g. September, Quarter 1"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white font-medium"
                  />
                </div>
              </div>

              {/* Financials: Total, Paid, Balance */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    कुल देय (Total Amount ₹){' '}
                    <span className="text-[10px] text-slate-400 font-normal">
                      {(editFeeType.toLowerCase().includes('advance') || editFeeType.includes('अग्रिम')) ? '(अग्रिम में ₹0)' : ''}
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={editTotalAmount}
                    onChange={(e) => setEditTotalAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-800 outline-none focus:border-blue-800 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-emerald-800 mb-1">
                    जमा राशि (Amount Paid ₹) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="10"
                    value={editAmountPaid}
                    onChange={(e) => setEditAmountPaid(e.target.value)}
                    required
                    className="w-full px-3 py-1.5 rounded-lg border border-emerald-300 text-sm font-bold text-emerald-900 outline-none focus:border-emerald-600 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {editCalculatedBalance < 0 ? 'अग्रिम जमा (Advance ₹)' : 'शेष बकाया (Balance Due ₹)'}
                  </label>
                  <div
                    className={`w-full px-3 py-1.5 rounded-lg border text-sm font-black flex items-center justify-between ${
                      editCalculatedBalance < 0
                        ? 'bg-purple-100 border-purple-300 text-purple-950'
                        : editCalculatedBalance > 0
                        ? 'bg-rose-50 border-rose-300 text-rose-800'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    }`}
                  >
                    <span>
                      {editCalculatedBalance < 0
                        ? `-₹${Math.abs(editCalculatedBalance).toLocaleString('en-IN')}`
                        : `₹${editCalculatedBalance.toLocaleString('en-IN')}`}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        editCalculatedBalance < 0
                          ? 'bg-purple-200 text-purple-900'
                          : editCalculatedBalance === 0
                          ? 'bg-emerald-200 text-emerald-900'
                          : 'bg-rose-200 text-rose-900'
                      }`}
                    >
                      {editCalculatedBalance < 0 ? 'Advance' : editCalculatedBalance === 0 ? 'Clear' : 'Due'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Mode & Received By */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    भुगतान माध्यम (Payment Mode)
                  </label>
                  <select
                    value={editPaymentMode}
                    onChange={(e) => setEditPaymentMode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white font-medium"
                  >
                    <option value="Cash">Cash (नकद)</option>
                    <option value="UPI / Online">UPI / PhonePe / Paytm / GPay</option>
                    <option value="Bank Transfer">Bank Transfer / NEFT / IMPS</option>
                    <option value="Cheque">Cheque / Demand Draft</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    प्राप्तकर्ता (Received By)
                  </label>
                  <input
                    type="text"
                    value={editReceivedBy}
                    onChange={(e) => setEditReceivedBy(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white"
                  />
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingFee(null)}
                  disabled={editIsSubmitting}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  रद्द करें (Cancel)
                </button>
                <button
                  type="submit"
                  disabled={editIsSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 text-xs font-bold shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {editIsSubmitting ? (
                    <>
                      <i className="fa-solid fa-circle-notch fa-spin"></i>
                      <span>अपडेट हो रहा है...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-floppy-disk"></i>
                      <span>अपडेट सेव करें (Save Changes)</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Fee Confirmation Modal for Manager */}
      {deletingFee && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200 my-auto">
            {/* Modal Header */}
            <div className="bg-rose-700 px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/20 text-white flex items-center justify-center font-bold text-base">
                  <i className="fa-solid fa-triangle-exclamation"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold leading-tight">
                    फीस रसीद स्थायी रूप से हटाएं
                  </h3>
                  <p className="text-[11px] text-rose-100">
                    Delete Fee Receipt Confirmation
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingFee(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-700 leading-relaxed">
                क्या आप वाकई इस फीस रसीद को स्थायी रूप से हटाना चाहते हैं? यह प्रविष्टि लेजर, रिपोर्ट और छात्र के फीस बैलेंस से हटा दी जाएगी।
              </p>

              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl space-y-2 text-xs">
                {(() => {
                  const matched = students.find((s) => String(s.Student_ID).toLowerCase() === String(deletingFee.Student_ID).toLowerCase());
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">छात्र का नाम:</span>
                        <span className="font-bold text-slate-900">{matched?.Student_Name || deletingFee.Student_ID}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">छात्र ID:</span>
                        <span className="font-mono font-bold text-slate-700">{deletingFee.Student_ID}</span>
                      </div>
                    </>
                  );
                })()}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">रसीद सं (Receipt No):</span>
                  <span className="font-mono font-bold text-rose-800">#{deletingFee.Receipt_Number}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">जमा राशि (Amount Paid):</span>
                  <span className="font-bold text-emerald-800 text-sm">₹{Number(deletingFee.Amount_Paid || 0).toLocaleString('en-IN')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">माह / शुल्क प्रकार:</span>
                  <span className="font-medium text-slate-800">{deletingFee.Month || '—'} • {deletingFee.Fee_Type || 'Tuition'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">भुगतान तिथि:</span>
                  <span className="font-medium text-slate-700">{formatDate(deletingFee.Date)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setDeletingFee(null)}
                  disabled={deleteIsSubmitting}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                >
                  रद्द करें (Cancel)
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleteIsSubmitting}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {deleteIsSubmitting ? (
                    <>
                      <i className="fa-solid fa-circle-notch fa-spin"></i>
                      <span>हटाया जा रहा है...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-trash-can"></i>
                      <span>हाँ, स्थायी रूप से हटाएं</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Official Printable Fee Receipt Modal for Manager */}
      <OfficialFeeReceiptModal
        isOpen={Boolean(printingReceiptRecord)}
        onClose={() => setPrintingReceiptRecord(null)}
        student={printingReceiptRecord?.student}
        feeRecord={printingReceiptRecord?.fee}
        schoolName="E.V.S. PUBLIC SCHOOL"
        managerName={managerName}
      />

      {/* Google Apps Script Monthly Dues Trigger Code Modal */}
      {showAppsScriptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fadeIn overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col">
            <div className="bg-gradient-to-r from-[#0c2340] to-indigo-950 px-5 py-4 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-base shadow-sm">
                  <i className="fa-solid fa-clock"></i>
                </div>
                <div>
                  <h3 className="text-base font-bold text-amber-300">
                    मासिक फीस ऑटो-जेनरेशन (Google Apps Script Trigger)
                  </h3>
                  <p className="text-[11px] text-blue-200">
                    हर महीने की 1 तारीख को सक्रिय छात्रों के खाते में मासिक फीस स्वतः जोड़ने हेतु कोड
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAppsScriptModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-800">
              {/* Highlight cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200">
                  <div className="font-bold text-amber-950 flex items-center gap-1.5 mb-1">
                    <i className="fa-solid fa-bolt text-amber-600"></i>
                    <span>generateMonthlyDues()</span>
                  </div>
                  <p className="text-[11px] text-amber-900 leading-relaxed">
                    यह फ़ंक्शन हर महीने की 1 तारीख को टाइम-ड्रिवन ट्रिगर से अपने आप चलता है और 'Students' शीट से सभी नॉन-फ्री छात्रों का मासिक बिल तैयार करता है।
                  </p>
                </div>

                <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
                  <div className="font-bold text-emerald-950 flex items-center gap-1.5 mb-1">
                    <i className="fa-solid fa-graduation-cap text-emerald-600"></i>
                    <span>100% फीस माफी छात्र सुरक्षा</span>
                  </div>
                  <p className="text-[11px] text-emerald-900 leading-relaxed">
                    जिन छात्रों पर 'Fee_Waiver' या '100% Free Student' या 'RTE' टैग है, उनके खाते में कोई मासिक बिल नहीं जुड़ेगा।
                  </p>
                </div>
              </div>

              {/* Instructions */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <i className="fa-solid fa-list-ol text-blue-900"></i>
                  <span>गूगल शीट में सेटअप करने के 3 आसान कदम:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-700 pl-1">
                  <li>
                    अपनी Google Sheet खोलें और ऊपर मेन्यू में <strong>Extensions &gt; Apps Script</strong> पर क्लिक करें।
                  </li>
                  <li>
                    नीचे दिए गए नीले बटन <strong>"Apps Script कोड कॉपी करें"</strong> पर क्लिक करें और Apps Script एडिटर में पेस्ट कर दें।
                  </li>
                  <li>
                    एडिटर में <code>installMonthlyFeeTrigger</code> फंक्शन चुनकर <strong>Run</strong> दबाएँ (यह हर 1 तारीख को रात 1 बजे का ऑटो ट्रिगर सक्रिय कर देगा)।
                  </li>
                </ol>
              </div>

              {/* Code Preview Box */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-slate-700 flex items-center gap-1.5">
                    <i className="fa-solid fa-file-code text-indigo-700"></i>
                    <span>Code.gs (Apps Script कोड)</span>
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(APPS_SCRIPT_FEE_CODE);
                        setAppsScriptCopied(true);
                        setTimeout(() => setAppsScriptCopied(false), 3000);
                      } catch {
                        const ta = document.createElement('textarea');
                        ta.value = APPS_SCRIPT_FEE_CODE;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        setAppsScriptCopied(true);
                        setTimeout(() => setAppsScriptCopied(false), 3000);
                      }
                    }}
                    className="px-3 py-1 bg-blue-900 hover:bg-blue-800 text-amber-300 font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <i className={`fa-solid ${appsScriptCopied ? 'fa-check text-emerald-300' : 'fa-copy'}`}></i>
                    <span>{appsScriptCopied ? 'कोड कॉपी हो गया! ✓' : 'पूरा Apps Script कोड कॉपी करें'}</span>
                  </button>
                </div>
                <pre className="p-3.5 bg-slate-950 text-emerald-400 font-mono text-[10px] rounded-2xl max-h-56 overflow-y-auto leading-relaxed border border-slate-800">
                  {APPS_SCRIPT_FEE_CODE}
                </pre>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setShowAppsScriptModal(false)}
                className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
              >
                बंद करें (Close)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fee Master Setup Modal (Option B: Auto-creates Fee_Master in Google Sheets) */}
      <FeeMasterModal
        isOpen={isFeeMasterModalOpen}
        onClose={() => setIsFeeMasterModalOpen(false)}
        onFeeMasterUpdated={() => {
          if (onRefreshFees) onRefreshFees();
        }}
      />
    </div>
  );
};
