import React, { useEffect, useMemo, useState } from 'react';
import { FeeCollectionRecord, Student } from '../types';
import { getLocalDateYMD } from '../utils/localTime';
import {
  buildFamilyGroups,
  buildFamilyWhatsappPaymentReceipt,
  computeFamilyFeeSummary,
  distributeLumpSumAcrossFamily,
  FamilyFeeSummary,
} from '../utils/familyFeeHelper';
import { getStandardFeeAmount } from '../utils/feeMaster';
import { isStudentFeeExempt } from '../utils/feeCalculation';
import { openWhatsappAlert } from '../utils/whatsappReminders';

interface FamilyFeeCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  feeRecords: FeeCollectionRecord[];
  initialFamily?: FamilyFeeSummary | null;
  managerName?: string;
  getClassName: (c?: string | null) => string;
  onAddFeeRecord: (record: FeeCollectionRecord, sendWhatsApp: boolean) => Promise<void> | void;
}

interface ChildPaymentRowState {
  selected: boolean;
  feeType: string;
  month: string;
  totalAmount: string;
  discountAmount: string;
  amountPaid: string;
}

interface SavedCombinedReceiptData {
  family: FamilyFeeSummary;
  batchReceiptId: string;
  date: string;
  paymentMode: string;
  receivedBy: string;
  notes: string;
  items: Array<{
    student: Student;
    feeType: string;
    month: string;
    receiptNumber: string;
    totalAmount: number;
    discount: number;
    amountPaid: number;
    remainingBalance: number;
  }>;
}

const FEE_TYPES = [
  'Monthly Tuition Fee (मासिक शिक्षण शुल्क)',
  'Admission Fee (प्रवेश शुल्क)',
  'Examination Fee (परीक्षा शुल्क)',
  'Annual Charges (वार्षिक शुल्क)',
  'Transportation / Bus Fee (वाहन शुल्क)',
  'Books & Stationery (पुस्तकालय / पुस्तकें)',
  'Advance Fee Deposit (अग्रिम शुल्क जमा)',
  'Miscellaneous / Other (अन्य)',
];

const MONTHS_OPTIONS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
  'Multi-Month Dues', 'Advance Deposit',
];

export const FamilyFeeCollectionModal: React.FC<FamilyFeeCollectionModalProps> = ({
  isOpen,
  onClose,
  students,
  feeRecords,
  initialFamily = null,
  managerName = 'School Manager',
  getClassName,
  onAddFeeRecord,
}) => {
  const [mobileSearch, setMobileSearch] = useState<string>('');
  const [activeFamilyKey, setActiveFamilyKey] = useState<string>('');
  const [date, setDate] = useState<string>(() => getLocalDateYMD());
  const [paymentMode, setPaymentMode] = useState<string>('Cash');
  const [receivedBy, setReceivedBy] = useState<string>(managerName);
  const [globalFeeType, setGlobalFeeType] = useState<string>('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
  const [globalMonth, setGlobalMonth] = useState<string>(() => {
    const m = new Date().toLocaleString('en-US', { month: 'long' });
    return MONTHS_OPTIONS.includes(m) ? m : 'April';
  });
  const [notes, setNotes] = useState<string>('');
  const [lumpSumInput, setLumpSumInput] = useState<string>('');
  const [rowsState, setRowsState] = useState<Record<string, ChildPaymentRowState>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sendWhatsappOnSave, setSendWhatsappOnSave] = useState<boolean>(true);
  const [savedReceipt, setSavedReceipt] = useState<SavedCombinedReceiptData | null>(null);

  const matchingFamilies = useMemo(() => {
    return buildFamilyGroups(students, feeRecords, mobileSearch);
  }, [students, feeRecords, mobileSearch]);

  const activeFamily = useMemo<FamilyFeeSummary | null>(() => {
    if (activeFamilyKey) {
      const exact = buildFamilyGroups(students, feeRecords).find((f) => f.mobileKey === activeFamilyKey);
      if (exact) return exact;
    }
    if (initialFamily) {
      return computeFamilyFeeSummary(
        initialFamily.members.map((m) => m.student),
        feeRecords
      );
    }
    return matchingFamilies[0] || null;
  }, [activeFamilyKey, initialFamily, students, feeRecords, matchingFamilies]);

  // Reset state when modal opens or active family switches
  useEffect(() => {
    if (!isOpen) return;
    setSavedReceipt(null);
    setErrorMsg(null);
    setDate(getLocalDateYMD());
    setReceivedBy(managerName || 'School Manager');
    setLumpSumInput('');
    setNotes('');
    if (initialFamily) {
      setActiveFamilyKey(initialFamily.mobileKey);
      setMobileSearch(initialFamily.displayMobile !== 'N/A' ? initialFamily.displayMobile : '');
    } else {
      setActiveFamilyKey('');
      setMobileSearch('');
    }
  }, [isOpen, initialFamily, managerName]);

  const [collectionScope, setCollectionScope] = useState<'monthly' | 'total_due'>('monthly');

  // Helper to apply either 1-month tuition (simple single-student default) or total current-month dues
  const applyCollectionScope = (scope: 'monthly' | 'total_due', fam: FamilyFeeSummary | null) => {
    if (!fam) return;
    setCollectionScope(scope);
    const defaultMonth = fam.currentMonth || new Date().toLocaleString('en-US', { month: 'long' });
    const cleanMonth = MONTHS_OPTIONS.includes(defaultMonth) ? defaultMonth : 'April';
    setGlobalFeeType('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
    setGlobalMonth(scope === 'total_due' ? 'Multi-Month Dues' : cleanMonth);

    const nextRows: Record<string, ChildPaymentRowState> = {};
    fam.members.forEach((m) => {
      const st = m.student;
      const due = m.dueAmount;
      const stdTuition = isStudentFeeExempt(st)
        ? 0
        : (m.metrics.monthlyTuition || getStandardFeeAmount(st.Class, 'Monthly Tuition Fee', st as any) || 450);
      const targetAmt =
        scope === 'total_due'
          ? (due > 0 ? due : stdTuition)
          : (due > 0 && due < stdTuition ? due : stdTuition);
      nextRows[st.Student_ID] = {
        selected: scope === 'total_due' ? (due > 0 || fam.totalDue === 0) : (stdTuition > 0 || due > 0 || fam.totalDue === 0),
        feeType: 'Monthly Tuition Fee (मासिक शिक्षण शुल्क)',
        month: scope === 'total_due' ? 'Multi-Month Dues' : cleanMonth,
        totalAmount: String(targetAmt),
        discountAmount: '0',
        amountPaid: String(targetAmt),
      };
    });
    setRowsState(nextRows);
  };

  // Populate child rows whenever activeFamily changes (defaults to simple 1-month fee like single student)
  useEffect(() => {
    if (!isOpen || !activeFamily) return;
    applyCollectionScope('monthly', activeFamily);
  }, [isOpen, activeFamily?.mobileKey]);

  const handleApplyGlobalFeeType = (newType: string) => {
    setGlobalFeeType(newType);
    if (!activeFamily) return;
    setRowsState((prev) => {
      const next = { ...prev };
      activeFamily.members.forEach((m) => {
        const st = m.student;
        const cur = next[st.Student_ID];
        if (!cur) return;
        const isAdv = newType.toLowerCase().includes('advance') || newType.includes('अग्रिम');
        const stdAmt = isAdv ? 0 : getStandardFeeAmount(st.Class, newType, st as any);
        const amt = isAdv ? (Number(cur.amountPaid) || 500) : stdAmt;
        next[st.Student_ID] = {
          ...cur,
          feeType: newType,
          totalAmount: String(isAdv ? 0 : amt),
          amountPaid: String(amt),
        };
      });
      return next;
    });
  };

  const handleApplyGlobalMonth = (newMonth: string) => {
    setGlobalMonth(newMonth);
    setRowsState((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        next[id] = { ...next[id], month: newMonth };
      });
      return next;
    });
  };

  const handleFillFullDues = () => {
    applyCollectionScope('total_due', activeFamily);
  };

  const handleAutoSplitLumpSum = () => {
    if (!activeFamily) return;
    const lump = Number(lumpSumInput);
    if (!lump || lump <= 0) {
      setErrorMsg('कृपया ऑटो-बाँटने के लिए ₹1 या उससे अधिक राशि दर्ज करें।');
      return;
    }
    setErrorMsg(null);
    const checkedMembers = activeFamily.members.filter(
      (m) => rowsState[m.student.Student_ID]?.selected !== false
    );
    const targetMembers = checkedMembers.length > 0 ? checkedMembers : activeFamily.members;
    const splitMap = distributeLumpSumAcrossFamily(targetMembers, lump);

    setRowsState((prev) => {
      const next = { ...prev };
      activeFamily.members.forEach((m) => {
        const sId = m.student.Student_ID;
        const alloc = splitMap[sId] || 0;
        const cur = next[sId];
        if (!cur) return;
        next[sId] = {
          ...cur,
          selected: alloc > 0,
          totalAmount: String(alloc),
          amountPaid: String(alloc),
        };
      });
      return next;
    });
  };

  const totals = useMemo(() => {
    if (!activeFamily) {
      return { selectedCount: 0, grandTotal: 0, grandDiscount: 0, grandPaid: 0, remainingDue: 0 };
    }
    let selectedCount = 0;
    let grandTotal = 0;
    let grandDiscount = 0;
    let grandPaid = 0;
    let remainingDue = 0;

    activeFamily.members.forEach((m) => {
      const row = rowsState[m.student.Student_ID];
      if (!row || !row.selected) {
        remainingDue += m.dueAmount;
        return;
      }
      selectedCount++;
      const tot = Math.max(0, Number(row.totalAmount) || 0);
      const disc = Math.max(0, Number(row.discountAmount) || 0);
      const paid = Math.max(0, Number(row.amountPaid) || 0);
      grandTotal += tot;
      grandDiscount += disc;
      grandPaid += paid;
      remainingDue += Math.max(0, m.dueAmount - paid - disc);
    });

    return { selectedCount, grandTotal, grandDiscount, grandPaid, remainingDue };
  }, [activeFamily, rowsState]);

  const handleSubmitCombined = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!activeFamily) {
      setErrorMsg('कृपया पहले मोबाइल नंबर या अभिभावक खोजें।');
      return;
    }

    const chosenMembers = activeFamily.members.filter((m) => {
      const r = rowsState[m.student.Student_ID];
      return r && r.selected && ((Number(r.amountPaid) || 0) > 0 || (Number(r.discountAmount) || 0) > 0);
    });

    if (chosenMembers.length === 0) {
      setErrorMsg('कृपया कम से कम 1 बच्चे का चयन करें और उसकी जमा राशि दर्ज करें।');
      return;
    }

    setIsSubmitting(true);
    try {
      const batchId = `FAM-${Date.now().toString().slice(-6)}`;
      const savedItems: SavedCombinedReceiptData['items'] = [];

      for (let i = 0; i < chosenMembers.length; i++) {
        const m = chosenMembers[i];
        const row = rowsState[m.student.Student_ID];
        const cleanFeeType = row.feeType.split('(')[0].trim();
        const totalAmt = Math.max(0, Number(row.totalAmount) || 0);
        const discAmt = Math.max(0, Number(row.discountAmount) || 0);
        const paidAmt = Math.max(0, Number(row.amountPaid) || 0);
        const netPay = Math.max(0, totalAmt - discAmt);
        const balAfter = netPay - paidAmt;
        const recNo = `${batchId}-${i + 1}`;
        const remainingStudentDue = Math.max(0, m.dueAmount - paidAmt - discAmt);

        const record: FeeCollectionRecord = {
          Receipt_Number: recNo,
          Student_ID: String(m.student.Student_ID || '').trim(),
          Date: date,
          Fee_Type: cleanFeeType,
          Month: row.month,
          Total_Amount: totalAmt,
          Discount_Amount: discAmt,
          Net_Payable: netPay,
          Amount_Paid: paidAmt,
          Balance_Amount: balAfter,
          Payment_Mode: paymentMode,
          Received_By: receivedBy.trim() || managerName,
          Notes:
            notes.trim() ||
            `Family Combined Receipt (${batchId} • ${chosenMembers.length} Children)`,
        };

        await onAddFeeRecord(record, false);
        savedItems.push({
          student: m.student,
          feeType: cleanFeeType,
          month: row.month,
          receiptNumber: recNo,
          totalAmount: totalAmt,
          discount: discAmt,
          amountPaid: paidAmt,
          remainingBalance: remainingStudentDue,
        });
      }

      if (sendWhatsappOnSave && activeFamily.displayMobile !== 'N/A') {
        const waMsg = buildFamilyWhatsappPaymentReceipt({
          family: activeFamily,
          date,
          paymentMode,
          receivedBy: receivedBy.trim() || managerName,
          paidItems: savedItems,
          getClassName,
        });
        openWhatsappAlert(activeFamily.displayMobile, waMsg, {
          alertType: 'Fee Due Reminder',
          recipientType: 'Parent',
          recipientId: activeFamily.mobileKey,
          recipientName: activeFamily.fatherName,
          classOrRole: `${savedItems.length} Children`,
          amount: totals.grandPaid,
          sentBy: receivedBy.trim() || managerName,
        });
      }

      setSavedReceipt({
        family: activeFamily,
        batchReceiptId: batchId,
        date,
        paymentMode,
        receivedBy: receivedBy.trim() || managerName,
        notes: notes.trim(),
        items: savedItems,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'संयुक्त फीस सेव करने में त्रुटि हुई।');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintCombinedReceipt = () => {
    document.body.classList.add('printing-family-receipt');
    const cleanup = () => {
      document.body.classList.remove('printing-family-receipt');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1200);
    }, 60);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-start justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-200 my-auto max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0 no-print">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center text-lg font-black shadow-sm">
              <i className="fa-solid fa-people-roof"></i>
            </div>
            <div>
              <h3 className="text-base font-black text-amber-300 leading-tight">
                {savedReceipt
                  ? 'संयुक्त पारिवारिक फीस रसीद (Combined Family Receipt)'
                  : 'मोबाइल नंबर से सभी बच्चों की एक जगह फीस जमा (Family Fee Counter)'}
              </h3>
              <p className="text-[11px] text-slate-300">
                एक ही स्क्रीन से परिवार के किसी एक, चुनिंदा या सभी बच्चों की फीस जमा करें व संयुक्त रसीद प्रिंट करें
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* BODY */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 text-slate-800">
          {savedReceipt ? (
            /* PRINTABLE COMBINED FAMILY RECEIPT VIEW */
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-bold flex flex-wrap items-center justify-between gap-2 no-print">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-circle-check text-emerald-600 text-base"></i>
                  <span>
                    सफलता! {savedReceipt.items.length} बच्चों की कुल ₹
                    {savedReceipt.items.reduce((s, i) => s + i.amountPaid, 0).toLocaleString('en-IN')} फीस रिकॉर्ड व Google Sheet में दर्ज हो गई है।
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrintCombinedReceipt}
                    className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <i className="fa-solid fa-print"></i>
                    <span>संयुक्त रसीद प्रिंट करें (Print)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const waMsg = buildFamilyWhatsappPaymentReceipt({
                        family: savedReceipt.family,
                        date: savedReceipt.date,
                        paymentMode: savedReceipt.paymentMode,
                        receivedBy: savedReceipt.receivedBy,
                        paidItems: savedReceipt.items,
                        getClassName,
                      });
                      openWhatsappAlert(savedReceipt.family.displayMobile, waMsg, {
                        alertType: 'Fee Due Reminder',
                        recipientType: 'Parent',
                        recipientId: savedReceipt.family.mobileKey,
                        recipientName: savedReceipt.family.fatherName,
                        classOrRole: `${savedItemsCount(savedReceipt)} Children`,
                        amount: savedReceipt.items.reduce((s, i) => s + i.amountPaid, 0),
                        sentBy: savedReceipt.receivedBy,
                      });
                    }}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <i className="fa-brands fa-whatsapp text-sm"></i>
                    <span>WhatsApp रसीद भेजें</span>
                  </button>
                </div>
              </div>

              {/* Printable Sheet */}
              <div
                id="printable-family-receipt-sheet"
                className="bg-white border-2 border-[#0c2340] rounded-2xl p-6 space-y-5 shadow-sm"
              >
                <div className="border-b-2 border-[#0c2340] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                      OFFICIAL COMBINED FAMILY FEE RECEIPT
                    </div>
                    <h2 className="text-xl font-black text-[#0c2340]">E.V.S. PUBLIC SCHOOL</h2>
                    <p className="text-xs text-slate-600">
                      संयुक्त पारिवारिक शुल्क रसीद • बैच सं: <span className="font-mono font-bold">#{savedReceipt.batchReceiptId}</span>
                    </p>
                  </div>
                  <div className="text-left sm:text-right text-xs space-y-0.5">
                    <div>
                      दिनांक: <strong>{savedReceipt.date}</strong>
                    </div>
                    <div>
                      भुगतान माध्यम: <strong>{savedReceipt.paymentMode}</strong>
                    </div>
                    <div>
                      प्राप्तकर्ता: <strong>{savedReceipt.receivedBy}</strong>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">अभिभावक / पिता का नाम</span>
                    <strong className="text-slate-900 text-sm">{savedReceipt.family.fatherName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">पंजीकृत मोबाइल नंबर</span>
                    <strong className="font-mono text-slate-900 text-sm">{savedReceipt.family.displayMobile}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">शामिल बच्चे</span>
                    <strong className="text-slate-900 text-sm">{savedReceipt.items.length} छात्र</strong>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-300">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#0c2340] text-amber-300 uppercase text-[10px]">
                      <tr>
                        <th className="px-3 py-2.5">रसीद सं.</th>
                        <th className="px-3 py-2.5">छात्र व कक्षा</th>
                        <th className="px-3 py-2.5">मद व माह</th>
                        <th className="px-3 py-2.5 text-right">देय ₹</th>
                        <th className="px-3 py-2.5 text-right">छूट ₹</th>
                        <th className="px-3 py-2.5 text-right">जमा ₹</th>
                        <th className="px-3 py-2.5 text-right">शेष ₹</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {savedReceipt.items.map((it) => (
                        <tr key={it.receiptNumber}>
                          <td className="px-3 py-2.5 font-mono font-bold text-blue-950">#{it.receiptNumber}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-slate-900">{it.student.Student_Name}</div>
                            <div className="text-[10px] text-slate-500">
                              {getClassName(it.student.Class)} • ID: {it.student.Student_ID}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            <div>{it.feeType}</div>
                            <div className="text-[10px] text-slate-500">{it.month}</div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">₹{it.totalAmount.toLocaleString('en-IN')}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">
                            {it.discount > 0 ? `-₹${it.discount.toLocaleString('en-IN')}` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-black text-emerald-700">
                            ₹{it.amountPaid.toLocaleString('en-IN')}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-bold text-rose-700">
                            ₹{it.remainingBalance.toLocaleString('en-IN')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
                      <tr>
                        <td colSpan={4} className="px-3 py-2.5 text-right">
                          कुल योग (GRAND TOTAL):
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-800">
                          ₹{savedReceipt.items.reduce((s, i) => s + i.discount, 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-800 text-sm">
                          ₹{savedReceipt.items.reduce((s, i) => s + i.amountPaid, 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-rose-800">
                          ₹{savedReceipt.items.reduce((s, i) => s + i.remainingBalance, 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {savedReceipt.notes && (
                  <div className="text-xs text-slate-600 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                    <strong>नोट / टिप्पणी:</strong> {savedReceipt.notes}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-dashed border-slate-300 text-[11px] text-slate-500">
                  <span>नोट: यह डिजिटल संयुक्त शुल्क रसीद विद्यालय रिकॉर्ड में सुरक्षित कर ली गई है।</span>
                  <span className="font-bold text-slate-800">हस्ताक्षर ({savedReceipt.receivedBy})</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 no-print">
                <button
                  type="button"
                  onClick={() => setSavedReceipt(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs cursor-pointer"
                >
                  एक और परिवार की फीस जमा करें
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-black text-xs cursor-pointer"
                >
                  बंद करें (Done)
                </button>
              </div>
            </div>
          ) : (
            /* COLLECTION FORM */
            <form onSubmit={handleSubmitCombined} className="space-y-4">
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs font-bold flex items-center gap-2">
                  <i className="fa-solid fa-circle-exclamation text-rose-600"></i>
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Search / Switch Family by Mobile Number */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2.5">
                <label className="block text-xs font-black text-slate-800">
                  📱 अभिभावक का मोबाइल नंबर, पिता का नाम या छात्र खोजें:
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={mobileSearch}
                    onChange={(e) => {
                      setMobileSearch(e.target.value);
                      setActiveFamilyKey('');
                    }}
                    placeholder="10 अंकों का मोबाइल नंबर (उदा. 9876543210), पिता या छात्र का नाम..."
                    className="flex-1 px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold outline-none focus:border-blue-900"
                  />
                  {mobileSearch.trim() && matchingFamilies.length > 1 && (
                    <select
                      value={activeFamily?.mobileKey || ''}
                      onChange={(e) => setActiveFamilyKey(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold outline-none"
                    >
                      {matchingFamilies.slice(0, 15).map((f) => (
                        <option key={f.mobileKey} value={f.mobileKey}>
                          {f.fatherName} ({f.displayMobile}) — {f.members.length} बच्चे • बकाया ₹{f.totalDue}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {activeFamily ? (
                <>
                  {/* Family Overview Banner (Simple Single-Student-Style Current Month Summary) */}
                  <div className="rounded-2xl bg-gradient-to-r from-indigo-50 via-blue-50 to-emerald-50 border border-indigo-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full bg-[#0c2340] text-amber-300 text-[10px] font-black">
                          {activeFamily.members.length} बच्चे जुड़े हैं
                        </span>
                        <span className="font-mono text-xs font-bold text-indigo-900">
                          📱 {activeFamily.displayMobile}
                        </span>
                        {activeFamily.totalMonthlyTuition > 0 && (
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold">
                            मासिक ट्यूशन कुल: ₹{activeFamily.totalMonthlyTuition.toLocaleString('en-IN')}/माह
                          </span>
                        )}
                      </div>
                      <h4 className="font-black text-slate-900 text-base">
                        अभिभावक: {activeFamily.fatherName}
                      </h4>
                      <p className="text-[11px] text-slate-700 font-medium">
                        सत्र देय ({activeFamily.currentMonth} तक):{' '}
                        <strong className="text-slate-900">₹{activeFamily.totalBilled.toLocaleString('en-IN')}</strong>
                        {' '}• कुल जमा:{' '}
                        <strong className="text-emerald-700">₹{activeFamily.totalPaid.toLocaleString('en-IN')}</strong>
                        {activeFamily.totalDiscount > 0 && (
                          <>
                            {' '}• छूट:{' '}
                            <strong className="text-amber-700">-₹{activeFamily.totalDiscount.toLocaleString('en-IN')}</strong>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="bg-white rounded-xl px-4 py-2.5 border border-rose-200 text-right shrink-0">
                      <span className="text-[10px] text-slate-500 font-bold block">
                        वर्तमान बकाया ({activeFamily.currentMonth} तक)
                      </span>
                      <span className={`text-xl font-black tabular-nums ${activeFamily.totalDue > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        ₹{activeFamily.totalDue.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  {/* Simple Quick Mode Switcher (1 Month vs Total Current Dues + Optional Lump-Sum Split) */}
                  <div className="bg-amber-50/90 border border-amber-300 rounded-2xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => applyCollectionScope('monthly', activeFamily)}
                        className={`px-3 py-2 rounded-xl text-xs font-black border cursor-pointer transition-colors ${
                          collectionScope === 'monthly'
                            ? 'bg-[#0c2340] text-amber-300 border-[#0c2340] shadow-xs'
                            : 'bg-white text-slate-800 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        1 माह की फीस ({activeFamily.currentMonth}: ₹{activeFamily.totalMonthlyTuition.toLocaleString('en-IN')})
                      </button>
                      <button
                        type="button"
                        onClick={handleFillFullDues}
                        className={`px-3 py-2 rounded-xl text-xs font-black border cursor-pointer transition-colors ${
                          collectionScope === 'total_due'
                            ? 'bg-[#0c2340] text-amber-300 border-[#0c2340] shadow-xs'
                            : 'bg-white text-amber-950 border-amber-300 hover:bg-amber-100'
                        }`}
                      >
                        कुल बकाया ({activeFamily.currentMonth} तक: ₹{activeFamily.totalDue.toLocaleString('en-IN')})
                      </button>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <input
                        type="number"
                        min="0"
                        value={lumpSumInput}
                        onChange={(e) => setLumpSumInput(e.target.value)}
                        placeholder="एकमुश्त ₹ (जैसे 1500)"
                        className="w-36 px-3 py-2 rounded-xl border border-amber-400 bg-white font-bold text-xs text-slate-900 outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAutoSplitLumpSum}
                        className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs cursor-pointer shadow-2xs"
                      >
                        ऑटो बाँटें
                      </button>
                    </div>
                  </div>

                  {/* Shared Metadata Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">दिनांक (Date)</label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 outline-none focus:border-blue-900"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">भुगतान माध्यम</label>
                      <select
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none"
                      >
                        <option value="Cash">Cash (नकद)</option>
                        <option value="UPI / Online">UPI / Online</option>
                        <option value="Bank Transfer">Bank Transfer</option>
                        <option value="Cheque">Cheque</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">सभी बच्चों की मद</label>
                      <select
                        value={globalFeeType}
                        onChange={(e) => handleApplyGlobalFeeType(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none"
                      >
                        {FEE_TYPES.map((ft) => (
                          <option key={ft} value={ft}>
                            {ft.split('(')[0].trim()}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">माह / अवधि</label>
                      <select
                        value={globalMonth}
                        onChange={(e) => handleApplyGlobalMonth(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none"
                      >
                        {MONTHS_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">प्राप्तकर्ता</label>
                      <input
                        type="text"
                        value={receivedBy}
                        onChange={(e) => setReceivedBy(e.target.value)}
                        className="w-full px-2.5 py-2 rounded-xl border border-slate-300 outline-none"
                      />
                    </div>
                  </div>

                  {/* Multi-Child Editable Breakdown */}
                  <div className="space-y-2.5">
                    {activeFamily.members.map((m) => {
                      const st = m.student;
                      const row = rowsState[st.Student_ID] || {
                        selected: true,
                        feeType: globalFeeType,
                        month: globalMonth,
                        totalAmount: String(m.dueAmount),
                        discountAmount: '0',
                        amountPaid: String(m.dueAmount),
                      };
                      const paidNum = Math.max(0, Number(row.amountPaid) || 0);
                      const discNum = Math.max(0, Number(row.discountAmount) || 0);
                      const balAfter = Math.max(0, m.dueAmount - paidNum - discNum);

                      return (
                        <div
                          key={st.Student_ID}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            row.selected
                              ? 'bg-white border-blue-300 shadow-xs'
                              : 'bg-slate-50 border-slate-200 opacity-70'
                          }`}
                        >
                          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                            {/* Left: Checkbox + Child Info */}
                            <label className="flex items-start gap-2.5 cursor-pointer min-w-0 flex-1">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={(e) =>
                                  setRowsState((prev) => ({
                                    ...prev,
                                    [st.Student_ID]: { ...row, selected: e.target.checked },
                                  }))
                                }
                                className="mt-1 w-4 h-4 accent-[#0c2340] rounded cursor-pointer"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-black text-slate-900 text-sm">{st.Student_Name}</span>
                                  <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold">
                                    {getClassName(st.Class)}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-500">ID: {st.Student_ID}</span>
                                </div>
                                <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                                  <span>
                                    सत्र ({m.currentMonth} तक): <strong>₹{m.metrics.totalSessionFee.toLocaleString('en-IN')}</strong>
                                    <span className="text-slate-500">
                                      {' '}({m.elapsedMonths} माह × ₹{(m.metrics.monthlyTuition || 0).toLocaleString('en-IN')}
                                      {(m.metrics.admissionFee || 0) > 0 ? ` + प्रवेश ₹${m.metrics.admissionFee!.toLocaleString('en-IN')}` : ''}
                                      {(m.metrics.otherBilledFees || 0) > 0 ? ` + अन्य ₹${m.metrics.otherBilledFees!.toLocaleString('en-IN')}` : ''})
                                    </span>
                                  </span>
                                  <span>·</span>
                                  <span className="text-emerald-700 font-bold">
                                    जमा: ₹{m.metrics.totalPaid.toLocaleString('en-IN')}
                                  </span>
                                  <span>·</span>
                                  <span>
                                    बकाया:{' '}
                                    <strong className={m.dueAmount > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                                      ₹{m.dueAmount.toLocaleString('en-IN')}
                                    </strong>
                                  </span>
                                </div>
                              </div>
                            </label>

                            {/* Right: Inputs */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end text-xs">
                              <div>
                                <span className="block text-[10px] font-bold text-slate-500 mb-0.5">मद (Type)</span>
                                <select
                                  disabled={!row.selected}
                                  value={row.feeType}
                                  onChange={(e) => {
                                    const newType = e.target.value;
                                    const isAdv = newType.toLowerCase().includes('advance') || newType.includes('अग्रिम');
                                    const stdAmt = isAdv ? 0 : getStandardFeeAmount(st.Class, newType, st as any);
                                    const nextPaid = isAdv ? (Number(row.amountPaid) || 500) : stdAmt;
                                    setRowsState((prev) => ({
                                      ...prev,
                                      [st.Student_ID]: {
                                        ...row,
                                        feeType: newType,
                                        totalAmount: String(isAdv ? 0 : stdAmt),
                                        amountPaid: String(nextPaid),
                                      },
                                    }));
                                  }}
                                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-semibold"
                                >
                                  {FEE_TYPES.map((ft) => (
                                    <option key={ft} value={ft}>
                                      {ft.split('(')[0].trim()}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <span className="block text-[10px] font-bold text-slate-500 mb-0.5">छूट ₹</span>
                                <input
                                  type="number"
                                  min="0"
                                  disabled={!row.selected}
                                  value={row.discountAmount}
                                  onChange={(e) =>
                                    setRowsState((prev) => ({
                                      ...prev,
                                      [st.Student_ID]: { ...row, discountAmount: e.target.value },
                                    }))
                                  }
                                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 font-bold text-amber-800"
                                />
                              </div>
                              <div>
                                <span className="block text-[10px] font-bold text-slate-500 mb-0.5">जमा ₹ *</span>
                                <input
                                  type="number"
                                  min="0"
                                  disabled={!row.selected}
                                  value={row.amountPaid}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setRowsState((prev) => ({
                                      ...prev,
                                      [st.Student_ID]: {
                                        ...row,
                                        amountPaid: val,
                                        totalAmount: collectionScope === 'total_due' ? String((Number(val) || 0) + (Number(row.discountAmount) || 0)) : row.totalAmount,
                                      },
                                    }));
                                  }}
                                  className="w-full px-2.5 py-1.5 rounded-lg border-2 border-emerald-500 bg-emerald-50/40 font-black text-emerald-900"
                                />
                              </div>
                              <div className="text-right">
                                <span className="block text-[10px] font-bold text-slate-500">नया शेष</span>
                                <span
                                  className={`font-black text-xs ${
                                    balAfter > 0 ? 'text-rose-700' : 'text-emerald-700'
                                  }`}
                                >
                                  ₹{balAfter.toLocaleString('en-IN')}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Notes & WhatsApp Toggle */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-1">
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="संयुक्त रसीद टिप्पणी / नोट (Optional)..."
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs outline-none focus:border-blue-900"
                    />
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendWhatsappOnSave}
                        onChange={(e) => setSendWhatsappOnSave(e.target.checked)}
                        className="w-4 h-4 accent-emerald-600 rounded"
                      />
                      <span>सेव करते ही अभिभावक को संयुक्त WhatsApp रसीद भेजें</span>
                    </label>
                  </div>

                  {/* Grand Total Summary & Submit Bar */}
                  <div className="bg-[#0c2340] text-white rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <div>
                        <span className="text-slate-300 block text-[10px]">चुने गए बच्चे</span>
                        <strong className="text-amber-300 text-base">{totals.selectedCount}</strong>
                      </div>
                      <div>
                        <span className="text-slate-300 block text-[10px]">कुल जमा राशि</span>
                        <strong className="text-emerald-300 text-lg tabular-nums">
                          ₹{totals.grandPaid.toLocaleString('en-IN')}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-300 block text-[10px]">बचा पारिवारिक बकाया</span>
                        <strong className="text-rose-300 text-base tabular-nums">
                          ₹{totals.remainingDue.toLocaleString('en-IN')}
                        </strong>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting || totals.selectedCount === 0}
                      className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md cursor-pointer disabled:opacity-50"
                    >
                      <i className={`fa-solid ${isSubmitting ? 'fa-spinner fa-spin' : 'fa-check-double'}`}></i>
                      <span>
                        {isSubmitting
                          ? 'सभी रसीदें सेव हो रही हैं...'
                          : `₹${totals.grandPaid.toLocaleString('en-IN')} जमा करें व संयुक्त रसीद बनाएँ`}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
                  ऊपर मोबाइल नंबर, पिता का नाम या छात्र का नाम डालकर परिवार खोजें।
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

function savedItemsCount(r: SavedCombinedReceiptData): number {
  return r.items.length;
}
