import React, { useState, useMemo, useEffect } from 'react';
import { StudentRecordForScan } from './StudentQRScannerModal';
import { computeStudentFeeMetrics } from '../utils/feeCalculation';
import {
  getStandardFeeAmount,
  isFreeStudent,
  tagStudentWaiver,
  simulateMultiMonthPaymentDistribution,
  ACADEMIC_SESSION_MONTHS,
} from '../utils/feeMaster';
import { FeeCollectionRecord } from '../types';
export type { FeeCollectionRecord };

interface AddFeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFeeAdded: (record: FeeCollectionRecord, sendWhatsApp: boolean) => Promise<void> | void;
  students: StudentRecordForScan[];
  feeRecords?: FeeCollectionRecord[];
  managerName?: string;
  classMap?: Record<string, string>;
  getClassName?: (c: string | undefined | null) => string;
  feeBalances?: Record<string, number>;
  onTriggerQRScan?: () => void;
  initialSelectedStudentId?: string;
}

const MONTHS_LIST = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
  'Quarter 1 (Apr-Jun)', 'Quarter 2 (Jul-Sep)', 'Quarter 3 (Oct-Dec)', 'Quarter 4 (Jan-Mar)', 'Full Academic Session'
];

const FEE_TYPES = [
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

export const AddFeeModal: React.FC<AddFeeModalProps> = ({
  isOpen,
  onClose,
  onFeeAdded,
  students,
  feeRecords = [],
  managerName = 'Principal / Manager',
  getClassName = (c) => c || 'N/A',
  feeBalances = {},
  onTriggerQRScan,
  initialSelectedStudentId,
}) => {
  // Form State
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<StudentRecordForScan | null>(null);
  const [showStudentDropdown, setShowStudentDropdown] = useState<boolean>(false);
  const [waiverVersion, setWaiverVersion] = useState<number>(0);

  const [receiptNumber, setReceiptNumber] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [isAdvanceMode, setIsAdvanceMode] = useState<boolean>(false);
  const [isMultiMonthMode, setIsMultiMonthMode] = useState<boolean>(false);
  const [feeType, setFeeType] = useState<string>('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
  const [month, setMonth] = useState<string>('');
  
  // Financial inputs
  const [totalAmount, setTotalAmount] = useState<string>('600');
  const [discountAmount, setDiscountAmount] = useState<string>('0');
  const [amountPaid, setAmountPaid] = useState<string>('600');
  const [userManuallyEditedPaid, setUserManuallyEditedPaid] = useState<boolean>(false);

  const [paymentMode, setPaymentMode] = useState<string>('Cash');
  const [receivedBy, setReceivedBy] = useState<string>(managerName);
  const [remarks, setRemarks] = useState<string>('');
  const [sendWhatsAppImmediate, setSendWhatsAppImmediate] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 100% Free Student / Fee Waiver Check
  const freeStudentInfo = useMemo(() => {
    return isFreeStudent(selectedStudent as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudent, waiverVersion]);

  // Compute selected student's fee metrics
  const studentMetrics = useMemo(() => {
    if (!selectedStudent) return null;
    return computeStudentFeeMetrics(selectedStudent as any, feeRecords);
  }, [selectedStudent, feeRecords]);

  // Current balance of selected student from computed metrics, feeBalances, or student record
  const currentPendingBalance = useMemo(() => {
    if (studentMetrics) return studentMetrics.dueBalance;
    if (!selectedStudent) return 0;
    const sId = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    if (sId && feeBalances[sId] !== undefined) {
      return feeBalances[sId];
    }
    if (selectedStudent.Balance_Amount !== undefined && selectedStudent.Balance_Amount !== null) {
      const num = Number(selectedStudent.Balance_Amount);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  }, [selectedStudent, studentMetrics, feeBalances]);

  // Standard fee lookup for current student and fee type
  const detectedStandardFee = useMemo(() => {
    if (!selectedStudent) return 600;
    if (freeStudentInfo.isFree) return 0;
    if (isAdvanceMode) return 0;
    return getStandardFeeAmount(selectedStudent.Class, feeType, selectedStudent as any);
  }, [selectedStudent, feeType, freeStudentInfo.isFree, isAdvanceMode]);

  // Multi-Month Pending Queue (Admission -> April -> May -> June...)
  const pendingDuesQueue = useMemo(() => {
    if (!selectedStudent) return [];
    if (freeStudentInfo.isFree) return [];
    const sId = String(selectedStudent.Student_ID || '').toLowerCase().trim();
    const stRecords = feeRecords.filter(
      (r) => String(r.Student_ID || '').toLowerCase().trim() === sId
    );

    const monthlyRate = getStandardFeeAmount(selectedStudent.Class, 'Monthly Tuition Fee', selectedStudent as any) || 600;

    // Map payments per month
    const paidPerMonth: Record<string, number> = {};
    stRecords.forEach((r) => {
      const m = String(r.Month || '').trim();
      const paid = Number(r.Amount_Paid) || 0;
      if (m && paid > 0) {
        ACADEMIC_SESSION_MONTHS.forEach((sessionMonth) => {
          if (m.toLowerCase().includes(sessionMonth.toLowerCase())) {
            paidPerMonth[sessionMonth] = (paidPerMonth[sessionMonth] || 0) + paid;
          }
        });
      }
    });

    const queue: Array<{ periodName: string; headType: string; dueAmount: number }> = [];

    // Admission fee if applicable and not yet paid
    const hasPaidAdmission = stRecords.some((r) => /(admission|प्रवेश)/i.test(String(r.Fee_Type || '')));
    if (!hasPaidAdmission) {
      const admRate = getStandardFeeAmount(selectedStudent.Class, 'Admission Fee', selectedStudent as any);
      if (admRate > 0) {
        queue.push({ periodName: 'प्रवेश शुल्क (Admission Fee)', headType: 'Admission Fee', dueAmount: admRate });
      }
    }

    // Academic session months
    ACADEMIC_SESSION_MONTHS.forEach((m) => {
      const alreadyPaid = paidPerMonth[m] || 0;
      const remaining = Math.max(0, monthlyRate - alreadyPaid);
      if (remaining > 0) {
        queue.push({ periodName: m, headType: 'Monthly Tuition Fee', dueAmount: remaining });
      }
    });

    return queue;
  }, [selectedStudent, feeRecords, freeStudentInfo.isFree]);

  // Total pending across all chronological dues
  const totalPendingQueueAmount = useMemo(() => {
    return pendingDuesQueue.reduce((acc, item) => acc + item.dueAmount, 0);
  }, [pendingDuesQueue]);

  // Net Payable Calculation: (Standard Amount - Discount)
  const numTotalAmount = isAdvanceMode ? 0 : (totalAmount.trim() === '' ? 0 : (parseFloat(totalAmount) || 0));
  const numDiscountAmount = isAdvanceMode ? 0 : (discountAmount.trim() === '' ? 0 : (parseFloat(discountAmount) || 0));
  const netPayable = Math.max(0, numTotalAmount - numDiscountAmount);

  // Paid amount calculation
  const numPaidAmount = amountPaid.trim() === '' ? 0 : (parseFloat(amountPaid) || 0);

  // Balance calculation: Net Payable - Amount Paid (negative for advance)
  const calculatedBalance = useMemo(() => {
    if (isAdvanceMode) {
      return -numPaidAmount;
    }
    if (freeStudentInfo.isFree) {
      return 0;
    }
    return netPayable - numPaidAmount;
  }, [isAdvanceMode, freeStudentInfo.isFree, netPayable, numPaidAmount]);

  // Multi-Month Auto-Distribution Simulation
  const multiMonthResult = useMemo(() => {
    if (!isMultiMonthMode || pendingDuesQueue.length === 0) return null;
    return simulateMultiMonthPaymentDistribution(pendingDuesQueue, numPaidAmount, numDiscountAmount);
  }, [isMultiMonthMode, pendingDuesQueue, numPaidAmount, numDiscountAmount]);

  // Auto-fill standard fee when student or feeType changes
  useEffect(() => {
    if (selectedStudent) {
      if (freeStudentInfo.isFree) {
        setTotalAmount('0');
        setDiscountAmount('0');
        if (!userManuallyEditedPaid) setAmountPaid('0');
      } else if (isAdvanceMode) {
        setTotalAmount('0');
        setDiscountAmount('0');
        if (!userManuallyEditedPaid && (amountPaid === '0' || amountPaid === '600')) {
          setAmountPaid('700');
        }
      } else if (isMultiMonthMode) {
        // Multi-month default to total pending or 3 months
        const targetTotal = totalPendingQueueAmount > 0 ? totalPendingQueueAmount : detectedStandardFee * 3;
        setTotalAmount(String(targetTotal));
        const net = Math.max(0, targetTotal - numDiscountAmount);
        if (!userManuallyEditedPaid) {
          setAmountPaid(String(net));
        }
      } else {
        setTotalAmount(String(detectedStandardFee));
        const net = Math.max(0, detectedStandardFee - numDiscountAmount);
        if (!userManuallyEditedPaid) {
          setAmountPaid(String(net));
        }
      }
    }
  }, [
    selectedStudent,
    feeType,
    freeStudentInfo.isFree,
    isAdvanceMode,
    isMultiMonthMode,
    detectedStandardFee,
    totalPendingQueueAmount,
  ]);

  // Update Net Payable whenever totalAmount or discountAmount changes
  useEffect(() => {
    if (!userManuallyEditedPaid && !isAdvanceMode && !freeStudentInfo.isFree) {
      const net = Math.max(0, numTotalAmount - numDiscountAmount);
      setAmountPaid(String(net));
    }
  }, [numTotalAmount, numDiscountAmount, isAdvanceMode, freeStudentInfo.isFree, userManuallyEditedPaid]);

  // Filter students based on search input
  const filteredStudents = useMemo(() => {
    if (!studentSearch.trim()) return [];
    const term = studentSearch.toLowerCase().trim();
    return students.filter((s) => {
      const name = String(s.Student_Name || '').toLowerCase();
      const id = String(s.Student_ID || '').toLowerCase();
      const adm = String(s.Admission_Number || '').toLowerCase();
      const roll = String(s.Roll_Number || '').toLowerCase();
      const cls = String(s.Class || '').toLowerCase();
      const mobile = String(s.Parent_Mobile || '');
      return (
        name.includes(term) ||
        id.includes(term) ||
        adm.includes(term) ||
        roll.includes(term) ||
        cls.includes(term) ||
        mobile.includes(term)
      );
    }).slice(0, 8);
  }, [students, studentSearch]);

  // Initialize form when opened
  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().split('T')[0];
      setDate(today);
      const randomSuffix = Math.floor(10000 + Math.random() * 90000);
      setReceiptNumber(`REC-${new Date().getFullYear()}-${randomSuffix}`);

      const curMonthIdx = new Date().getMonth();
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      setMonth(monthNames[curMonthIdx] || 'September');
      setReceivedBy(managerName || 'Principal / Manager');
      setErrorMsg(null);
      setUserManuallyEditedPaid(false);
      setDiscountAmount('0');
      setIsMultiMonthMode(false);
      setIsAdvanceMode(false);

      if (initialSelectedStudentId) {
        const found = students.find(
          (s) => String(s.Student_ID || '').toLowerCase() === initialSelectedStudentId.toLowerCase()
        );
        if (found) {
          setSelectedStudent(found);
          setStudentSearch(`${found.Student_Name} (${found.Student_ID})`);
        }
      } else {
        setSelectedStudent(null);
        setStudentSearch('');
      }
    }
  }, [isOpen, initialSelectedStudentId, managerName]);

  // Toggle Fee Waiver for selected student
  const handleToggleWaiver = () => {
    if (!selectedStudent) return;
    const newStatus = !freeStudentInfo.isFree;
    tagStudentWaiver(
      selectedStudent.Student_ID,
      newStatus,
      newStatus ? '100% Fee Waived (प्रबंधक द्वारा फीस माफ)' : ''
    );
    setWaiverVersion((v) => v + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!selectedStudent) {
      setErrorMsg('कृपया पहले छात्र का चयन करें (Please select a student).');
      return;
    }
    if (!receiptNumber.trim()) {
      setErrorMsg('कृपया रसीद संख्या (Receipt Number) दर्ज करें।');
      return;
    }

    if (isNaN(numTotalAmount) || numTotalAmount < 0) {
      setErrorMsg('कुल देय राशि अमान्य है।');
      return;
    }
    if (isNaN(numPaidAmount) || numPaidAmount < 0) {
      setErrorMsg('कृपया वैध जमा राशि दर्ज करें।');
      return;
    }
    // If not 100% free student, paid amount should be > 0
    if (!freeStudentInfo.isFree && numPaidAmount <= 0) {
      setErrorMsg('कृपया वैध जमा राशि दर्ज करें (जमा राशि 0 से अधिक होनी चाहिए)।');
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanFeeType = isMultiMonthMode
        ? 'Multi-Month Tuition (मल्टी-मंथ फीस)'
        : feeType.split('(')[0].trim();

      const receiptMonth = isMultiMonthMode && multiMonthResult
        ? (multiMonthResult.fullyPaidMonths.join(', ') || month)
        : month;

      const newRec: FeeCollectionRecord = {
        Receipt_Number: receiptNumber.trim(),
        Student_ID: String(selectedStudent.Student_ID || '').trim(),
        Date: date,
        Fee_Type: cleanFeeType,
        Month: receiptMonth,
        Total_Amount: numTotalAmount,
        Discount_Amount: numDiscountAmount > 0 ? numDiscountAmount : 0,
        Net_Payable: netPayable,
        Amount_Paid: numPaidAmount,
        Balance_Amount: calculatedBalance,
        Payment_Mode: paymentMode,
        Received_By: receivedBy.trim(),
        Allocations_Summary: multiMonthResult ? multiMonthResult.coveredMonthsSummary : undefined,
        Notes: multiMonthResult?.partialMonthNote || remarks || (freeStudentInfo.isFree ? '100% Fee Waived' : undefined),
      };

      await onFeeAdded(newRec, sendWhatsAppImmediate);
      onClose();
    } catch (err: any) {
      console.error('Error saving fee:', err);
      setErrorMsg(err.message || 'फीस रिकॉर्ड सेव करने में त्रुटि हुई।');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 my-auto max-h-[95vh] flex flex-col">
        {/* Modal Header */}
        <div className="bg-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-base shadow-sm">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <h3 className="text-base font-bold text-amber-300 leading-tight">
                नई स्कूल फीस जमा करें (Fee Collection)
              </h3>
              <p className="text-[11px] text-slate-300">
                डायनामिक ऑटो-फीस, डिस्काउंट/छूट, 100% माफी एवं मल्टी-मंथ ऑटो आवंटन
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1 text-slate-800">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs font-semibold flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation text-rose-600 text-sm"></i>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Student Search / Selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
              <span>
                छात्र का चयन करें (Select Student) <span className="text-rose-500">*</span>
              </span>
              {onTriggerQRScan && (
                <button
                  type="button"
                  onClick={onTriggerQRScan}
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-900 hover:text-blue-950 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200 cursor-pointer shadow-2xs hover:bg-blue-100"
                >
                  <i className="fa-solid fa-qrcode text-amber-600"></i>
                  <span>QR स्कैन करें</span>
                </button>
              )}
            </label>

            <div className="relative">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                    <i className="fa-solid fa-magnifying-glass"></i>
                  </span>
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => {
                      setStudentSearch(e.target.value);
                      setShowStudentDropdown(true);
                    }}
                    onFocus={() => setShowStudentDropdown(true)}
                    placeholder="छात्र का नाम, ID (e.g. 57dd106d), या रोल नंबर खोजें..."
                    className="w-full pl-8 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none bg-white"
                  />
                  {studentSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setStudentSearch('');
                        setSelectedStudent(null);
                      }}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {onTriggerQRScan && (
                  <button
                    type="button"
                    onClick={onTriggerQRScan}
                    className="px-3 py-2 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0"
                    title="Scan Student QR Code"
                  >
                    <i className="fa-solid fa-qrcode"></i>
                    <span className="hidden sm:inline">Scan QR</span>
                  </button>
                )}
              </div>

              {/* Dropdown search suggestions */}
              {showStudentDropdown && filteredStudents.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto divide-y divide-slate-100">
                  {filteredStudents.map((st) => (
                    <div
                      key={st.Student_ID}
                      onClick={() => {
                        setSelectedStudent(st);
                        setStudentSearch(`${st.Student_Name} (${st.Student_ID})`);
                        setShowStudentDropdown(false);
                      }}
                      className="p-2.5 hover:bg-amber-50 cursor-pointer flex items-center justify-between text-xs transition-colors"
                    >
                      <div>
                        <span className="font-bold text-slate-900">{st.Student_Name}</span>
                        <div className="text-[10px] text-slate-500">
                          कक्षा: {getClassName(st.Class)} • रोल: {st.Roll_Number || 'N/A'} • Adm: {st.Admission_Number}
                        </div>
                      </div>
                      <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                        {st.Student_ID}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Student Preview Badge */}
            {selectedStudent && (
              <div className="mt-2.5 p-3 rounded-xl bg-gradient-to-r from-blue-50/90 to-indigo-50/60 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-sm shrink-0 shadow-xs">
                    {selectedStudent.Student_Name ? selectedStudent.Student_Name.charAt(0) : 'S'}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <span>{selectedStudent.Student_Name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-100 text-blue-900 rounded font-normal">
                        {selectedStudent.Student_ID}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 flex items-center gap-2 mt-0.5">
                      <span>कक्षा: <strong>{getClassName(selectedStudent.Class)}</strong></span>
                      <span>•</span>
                      <span>मानक फीस: <strong>₹{detectedStandardFee}</strong></span>
                      <span>•</span>
                      <span>पिता: {selectedStudent.Father_Name || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between border-t sm:border-t-0 pt-2 sm:pt-0 border-blue-200">
                  <span className="text-[10px] text-slate-500 block">
                    {currentPendingBalance < 0 ? 'वर्तमान अग्रिम (Advance):' : 'वर्तमान बकाया (Dues):'}
                  </span>
                  <span
                    className={`text-xs font-black ${
                      currentPendingBalance < 0
                        ? 'text-purple-700 bg-purple-100 px-2 py-0.5 rounded border border-purple-200'
                        : currentPendingBalance > 0
                        ? 'text-rose-700 font-bold'
                        : 'text-emerald-700 font-bold'
                    }`}
                  >
                    {currentPendingBalance < 0
                      ? `-₹${Math.abs(currentPendingBalance).toLocaleString('en-IN')}`
                      : `₹${currentPendingBalance.toLocaleString('en-IN')}`}
                  </span>
                </div>
              </div>
            )}

            {/* 3. FREE STUDENT / 100% WAIVER PROMINENT BADGE */}
            {selectedStudent && freeStudentInfo.isFree && (
              <div className="mt-2.5 p-3 rounded-xl bg-gradient-to-r from-amber-500/15 via-emerald-500/15 to-amber-500/15 border-2 border-emerald-500/50 flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center text-sm shadow-xs shrink-0">
                    <i className="fa-solid fa-graduation-cap"></i>
                  </div>
                  <div>
                    <div className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                      <span>✨ 100% Fee Waived (फीस माफ है)</span>
                      <span className="px-1.5 py-0.2 rounded bg-emerald-200 text-emerald-900 text-[10px] font-bold">
                        FREE STUDENT
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-900 mt-0.5">
                      {freeStudentInfo.reason} • देय मानक शुल्क स्वतः <strong>₹0</strong> निर्धारित है।
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleToggleWaiver}
                  className="px-2.5 py-1 text-[10px] font-bold text-emerald-800 bg-white hover:bg-emerald-100 rounded-lg border border-emerald-300 shadow-2xs cursor-pointer shrink-0 transition-colors"
                  title="माफी स्टेटस बदलें"
                >
                  माफी हटाएँ
                </button>
              </div>
            )}

            {/* Waiver Toggle Option for non-free students */}
            {selectedStudent && !freeStudentInfo.isFree && (
              <div className="mt-1.5 text-right">
                <button
                  type="button"
                  onClick={handleToggleWaiver}
                  className="text-[10px] text-slate-500 hover:text-emerald-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <i className="fa-solid fa-tag text-[9px]"></i>
                  <span>इस छात्र को 100% फीस माफी (Free Student) टैग करें</span>
                </button>
              </div>
            )}

            {/* Payment Mode Selector Tabs */}
            <div className="mt-3 grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
              {/* Tab 1: Regular Fee */}
              <button
                type="button"
                onClick={() => {
                  setIsAdvanceMode(false);
                  setIsMultiMonthMode(false);
                  if (feeType.includes('Advance') || feeType.includes('अग्रिम')) {
                    setFeeType('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
                  }
                  setUserManuallyEditedPaid(false);
                }}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                  !isAdvanceMode && !isMultiMonthMode
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <i className="fa-solid fa-receipt"></i>
                <span>नियमित फीस (Single)</span>
              </button>

              {/* Tab 2: Multi-Month Auto-Distribution */}
              <button
                type="button"
                onClick={() => {
                  setIsAdvanceMode(false);
                  setIsMultiMonthMode(true);
                  setFeeType('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
                  setUserManuallyEditedPaid(false);
                }}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                  isMultiMonthMode
                    ? 'bg-indigo-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <i className="fa-solid fa-calendar-days text-amber-300"></i>
                <span>मल्टी-मंथ (Lump Sum)</span>
              </button>

              {/* Tab 3: Advance Deposit */}
              <button
                type="button"
                onClick={() => {
                  setIsAdvanceMode(true);
                  setIsMultiMonthMode(false);
                  setFeeType('Advance Fee Deposit (अग्रिम शुल्क जमा)');
                  setTotalAmount('0');
                  setDiscountAmount('0');
                  setUserManuallyEditedPaid(false);
                }}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                  isAdvanceMode
                    ? 'bg-purple-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <i className="fa-solid fa-bolt text-amber-300"></i>
                <span>अग्रिम जमा (Advance)</span>
              </button>
            </div>

            {/* Advance Deposit Banner */}
            {isAdvanceMode && (
              <div className="mt-2.5 p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-start gap-2">
                <i className="fa-solid fa-circle-info text-purple-700 mt-0.5"></i>
                <div>
                  <div className="font-bold">⚡ अग्रिम फीस जमा मोड (Advance Deposit Active)</div>
                  <div className="text-[11px] text-purple-700">
                    छात्र के खाते में यह राशि सीधे अग्रिम जमा (Advance) होगी। कोई नया बिल नहीं जुड़ेगा (Total = ₹0), जिससे शेष बैलेंस माइनस (-₹{numPaidAmount || 0}) में अग्रिम दर्ज होगा।
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Receipt Number & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                रसीद संख्या (Receipt No) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
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
                value={date}
                onChange={(e) => setDate(e.target.value)}
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
                value={feeType}
                onChange={(e) => {
                  const val = e.target.value;
                  setFeeType(val);
                  setUserManuallyEditedPaid(false);
                  if (val.includes('Advance') || val.includes('अग्रिम')) {
                    setIsAdvanceMode(true);
                    setTotalAmount('0');
                    setDiscountAmount('0');
                  } else {
                    setIsAdvanceMode(false);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white font-medium"
              >
                {FEE_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                माह / अवधि (Fee Month) <span className="text-rose-500">*</span>
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white font-medium"
              >
                {MONTHS_LIST.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 4. MULTI-MONTH CHRONOLOGICAL AUTO-DISTRIBUTION PANEL */}
          {isMultiMonthMode && (
            <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-black text-indigo-950">
                  <i className="fa-solid fa-list-check text-indigo-600"></i>
                  <span>मल्टी-मंथ भुगतान आवंटन (Multi-Month Auto-Distribution)</span>
                </div>
                <span className="text-[10px] font-bold text-indigo-800 bg-indigo-100 px-2 py-0.5 rounded border border-indigo-200">
                  पुराने देय से नए देय तक
                </span>
              </div>

              {pendingDuesQueue.length > 0 ? (
                <>
                  <div className="text-[11px] text-indigo-900 leading-relaxed">
                    अभिभावक द्वारा दी गई एकमुश्त राशि (Lump Sum) पुराने बकाए (Oldest Pending Fee First) के क्रम में अपने आप विभाजित होगी।
                  </div>

                  {/* Chronological Pending Queue visual */}
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {pendingDuesQueue.map((item, idx) => {
                      const allocItem = multiMonthResult?.allocations.find(
                        (a) => a.periodName === item.periodName
                      );
                      const isSettled = allocItem?.status === 'SETTLED';
                      const isPartial = allocItem?.status === 'PARTIAL';

                      return (
                        <div
                          key={idx}
                          className={`p-2 rounded-lg text-xs flex items-center justify-between border transition-all ${
                            isSettled
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold'
                              : isPartial
                              ? 'bg-amber-50 border-amber-300 text-amber-950 font-semibold'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] w-4 text-slate-400">
                              {idx + 1}.
                            </span>
                            <span className="font-bold">{item.periodName}</span>
                            <span className="text-[10px] text-slate-500">
                              (देय: ₹{item.dueAmount})
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isSettled && (
                              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded flex items-center gap-1">
                                <i className="fa-solid fa-check text-[9px]"></i>
                                <span>पूर्ण चुकता (₹{allocItem?.allocatedAmount})</span>
                              </span>
                            )}
                            {isPartial && (
                              <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded">
                                आंशिक ₹{allocItem?.allocatedAmount} (शेष ₹{allocItem?.remainingDue})
                              </span>
                            )}
                            {!isSettled && !isPartial && (
                              <span className="text-[10px] text-slate-400">लंबित (Pending)</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Summary of covered months */}
                  {multiMonthResult && (
                    <div className="p-2.5 rounded-lg bg-white border border-indigo-200 text-xs space-y-1">
                      <div className="font-bold text-indigo-950 flex items-center justify-between">
                        <span>रसीद में शामिल माह:</span>
                        <span className="text-emerald-700 font-black">
                          {multiMonthResult.fullyPaidMonths.length} माह पूर्ण चुकता
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-700">
                        {multiMonthResult.coveredMonthsSummary}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-xs text-indigo-700 italic">
                  इस छात्र का कोई पुराना बकाया नहीं है। पूरी राशि आगामी माहों हेतु अग्रिम (Advance) के रूप में ली जा सकती है।
                </div>
              )}
            </div>
          )}

          {/* 1 & 2. FINANCIALS GRID: Standard Fee, Discount/Concession, Net Payable, Paid Amount, Balance */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold text-slate-800 flex items-center gap-1.5">
                <i className="fa-solid fa-calculator text-blue-900"></i>
                <span>शुल्क गणना एवं छूट प्रणाली (Fee & Discount)</span>
              </span>
              {selectedStudent && (
                <span className="text-[10px] font-bold text-blue-900 bg-blue-100/80 px-2 py-0.5 rounded">
                  कक्षा: {getClassName(selectedStudent.Class)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Standard Fee (Dynamic Auto-Fill) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                  <span>मानक शुल्क (Standard Fee ₹)</span>
                  {detectedStandardFee > 0 && (
                    <span className="text-[10px] font-normal text-slate-500">
                      ऑटो दर: ₹{detectedStandardFee}
                    </span>
                  )}
                </label>
                {isAdvanceMode ? (
                  <div className="w-full px-3 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-sm font-bold text-purple-900 flex items-center justify-between">
                    <span>₹0</span>
                    <span className="text-[10px] font-semibold text-purple-700 bg-purple-200/80 px-1.5 py-0.5 rounded">
                      अग्रिम (No Bill)
                    </span>
                  </div>
                ) : (
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={totalAmount}
                    onChange={(e) => {
                      setTotalAmount(e.target.value);
                      setUserManuallyEditedPaid(false);
                    }}
                    placeholder="0"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-800 outline-none focus:border-blue-800 bg-white"
                  />
                )}
              </div>

              {/* Discount / Concession Amount */}
              <div>
                <label className="block text-xs font-bold text-amber-900 mb-1 flex items-center justify-between">
                  <span>छूट / रियायत (Discount ₹)</span>
                  <span className="text-[10px] font-normal text-amber-700">कॉन्सेशन</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={discountAmount}
                  onChange={(e) => {
                    setDiscountAmount(e.target.value);
                    setUserManuallyEditedPaid(false);
                  }}
                  disabled={isAdvanceMode}
                  placeholder="0"
                  className="w-full px-3 py-1.5 rounded-lg border border-amber-300 text-sm font-bold text-amber-900 outline-none focus:border-amber-600 bg-white disabled:opacity-50"
                />
              </div>
            </div>

            {/* Net Payable Breakdown Display */}
            {!isAdvanceMode && (
              <div className="p-2.5 rounded-lg bg-blue-50/70 border border-blue-200 text-xs flex items-center justify-between">
                <div>
                  <span className="text-slate-600 font-medium">शुद्ध देय राशि (Net Payable):</span>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    मानक ₹{numTotalAmount} - छूट ₹{numDiscountAmount}
                  </div>
                </div>
                <div className="text-base font-black text-blue-950">
                  ₹{netPayable.toLocaleString('en-IN')}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Amount Paid */}
              <div>
                <label className="block text-xs font-bold text-emerald-800 mb-1">
                  {isAdvanceMode ? 'अग्रिम जमा राशि (Advance Paid ₹)' : 'जमा की जा रही राशि (Amount Paid ₹)'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={amountPaid}
                  onChange={(e) => {
                    setAmountPaid(e.target.value);
                    setUserManuallyEditedPaid(true);
                  }}
                  required
                  placeholder={isAdvanceMode ? '700' : '600'}
                  className="w-full px-3 py-1.5 rounded-lg border border-emerald-300 text-sm font-bold text-emerald-900 outline-none focus:border-emerald-600 bg-white"
                />
              </div>

              {/* Real-time Balance / Advance */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {calculatedBalance < 0 ? 'अग्रिम जमा (Advance Payment ₹)' : 'शेष बकाया (Balance Due ₹)'}
                </label>
                <div
                  className={`w-full px-3 py-1.5 rounded-lg border text-sm font-black flex items-center justify-between ${
                    calculatedBalance < 0
                      ? 'bg-purple-100/90 border-purple-300 text-purple-950 shadow-2xs'
                      : calculatedBalance > 0
                      ? 'bg-rose-50 border-rose-300 text-rose-800'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  }`}
                >
                  <span>
                    {calculatedBalance < 0
                      ? `-₹${Math.abs(calculatedBalance).toLocaleString('en-IN')}`
                      : `₹${calculatedBalance.toLocaleString('en-IN')}`}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      calculatedBalance < 0
                        ? 'bg-purple-200 text-purple-900'
                        : calculatedBalance === 0
                        ? 'bg-emerald-200 text-emerald-900'
                        : 'bg-rose-200 text-rose-900'
                    }`}
                  >
                    {calculatedBalance < 0 ? 'Advance (अग्रिम)' : calculatedBalance === 0 ? 'Clear (पूर्ण)' : 'Due (बकाया)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick-fill payment buttons */}
            {!isAdvanceMode && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-slate-500 text-[10px] font-semibold">त्वरित चयन:</span>
                <button
                  type="button"
                  onClick={() => {
                    setAmountPaid(String(netPayable));
                    setUserManuallyEditedPaid(true);
                  }}
                  className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer transition-colors"
                >
                  पूर्ण देय (₹{netPayable})
                </button>
                {detectedStandardFee > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const amt = detectedStandardFee * 2;
                        setTotalAmount(String(amt));
                        setAmountPaid(String(Math.max(0, amt - numDiscountAmount)));
                        setIsMultiMonthMode(true);
                        setUserManuallyEditedPaid(true);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer transition-colors"
                    >
                      2 माह (₹{detectedStandardFee * 2})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const amt = detectedStandardFee * 3;
                        setTotalAmount(String(amt));
                        setAmountPaid(String(Math.max(0, amt - numDiscountAmount)));
                        setIsMultiMonthMode(true);
                        setUserManuallyEditedPaid(true);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer transition-colors"
                    >
                      त्रैमासिक / 3 माह (₹{detectedStandardFee * 3})
                    </button>
                  </>
                )}
                {totalPendingQueueAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTotalAmount(String(totalPendingQueueAmount));
                      setAmountPaid(String(Math.max(0, totalPendingQueueAmount - numDiscountAmount)));
                      setIsMultiMonthMode(true);
                      setUserManuallyEditedPaid(true);
                    }}
                    className="px-2 py-0.5 rounded bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-black cursor-pointer transition-colors"
                  >
                    कुल बकाया (₹{totalPendingQueueAmount})
                  </button>
                )}
              </div>
            )}
          </div>

          {calculatedBalance < 0 && (
            <div className="p-2.5 rounded-xl bg-purple-50/90 border border-purple-200 text-purple-900 text-xs font-medium flex items-center gap-2">
              <i className="fa-solid fa-sparkles text-purple-600 text-sm"></i>
              <span>
                छात्र <strong>₹{Math.abs(calculatedBalance).toLocaleString('en-IN')}</strong> अग्रिम (Advance) जमा कर रहा है। रसीद में बैलेंस{' '}
                <strong className="font-mono">-₹{Math.abs(calculatedBalance).toLocaleString('en-IN')}</strong> दर्ज होगा।
              </span>
            </div>
          )}

          {/* Payment Mode & Received By */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                भुगतान माध्यम (Payment Mode)
              </label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
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
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                placeholder="Manager / Principal Name"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white"
              />
            </div>
          </div>

          {/* Remarks (Optional) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              टिप्पणी / रिमार्क (Optional Note)
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. 50% स्कॉलरशिप छूट, जुलाई व अगस्त का एकमुश्त भुगतान..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:border-blue-800 outline-none bg-white"
            />
          </div>

          {/* WhatsApp Direct Share Option */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <i className="fa-brands fa-whatsapp text-emerald-600 text-xl"></i>
              <div>
                <span className="text-xs font-bold text-emerald-950 block leading-tight">
                  माता-पिता को तत्काल व्हाट्सएप रसीद भेजें
                </span>
                <span className="text-[11px] text-emerald-700">
                  फीस जमा होते ही रसीद का मैसेज अभिभावक के नंबर पर खुलेगा
                </span>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={sendWhatsAppImmediate}
                onChange={(e) => setSendWhatsAppImmediate(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
          >
            रद्द करें (Cancel)
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <i className="fa-solid fa-spinner fa-spin"></i>
                <span>सहेज रहे हैं...</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-check"></i>
                <span>फीस रसीद दर्ज करें (Save Receipt)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
