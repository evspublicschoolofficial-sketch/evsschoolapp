import React, { useState, useMemo, useEffect } from 'react';
import { StudentRecordForScan } from './StudentQRScannerModal';
import { computeStudentFeeMetrics } from '../utils/feeCalculation';

export interface FeeCollectionRecord {
  Receipt_Number: string;
  Student_ID: string;
  Date: string;
  Fee_Type: string;
  Month: string;
  Total_Amount: number | null;
  Amount_Paid: number | null;
  Balance_Amount: number | null;
  Payment_Mode: string;
  Received_By?: string;
}

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

  const [receiptNumber, setReceiptNumber] = useState<string>('');
  const [date, setDate] = useState<string>('');
  const [isAdvanceMode, setIsAdvanceMode] = useState<boolean>(false);
  const [feeType, setFeeType] = useState<string>('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
  const [month, setMonth] = useState<string>('');
  const [totalAmount, setTotalAmount] = useState<string>('600');
  const [amountPaid, setAmountPaid] = useState<string>('600');
  const [paymentMode, setPaymentMode] = useState<string>('Cash');
  const [receivedBy, setReceivedBy] = useState<string>(managerName);
  const [remarks, setRemarks] = useState<string>('');
  const [sendWhatsAppImmediate, setSendWhatsAppImmediate] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  // Auto calculate balance amount (allows negative for advance payments, e.g. 600 - 700 = -100 or 0 - 1000 = -1000)
  const calculatedBalance = useMemo(() => {
    const total = isAdvanceMode ? 0 : (totalAmount.trim() === '' ? 0 : (parseFloat(totalAmount) || 0));
    const paid = amountPaid.trim() === '' ? 0 : (parseFloat(amountPaid) || 0);
    return total - paid;
  }, [isAdvanceMode, totalAmount, amountPaid]);

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

      // Determine current month name
      const curMonthIdx = new Date().getMonth(); // 0 = Jan, 8 = Sep
      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      setMonth(monthNames[curMonthIdx] || 'September');
      setReceivedBy(managerName || 'Principal / Manager');
      setErrorMsg(null);

      // Handle initial student if provided
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

  // Update selected student if initialSelectedStudentId changes while open
  useEffect(() => {
    if (isOpen && initialSelectedStudentId) {
      const found = students.find(
        (s) => String(s.Student_ID || '').toLowerCase() === initialSelectedStudentId.toLowerCase()
      );
      if (found) {
        setSelectedStudent(found);
        setStudentSearch(`${found.Student_Name} (${found.Student_ID})`);
      }
    }
  }, [initialSelectedStudentId, isOpen]);

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
    // For advance payment, totalAmount can be 0 or blank
    const total = totalAmount.trim() === '' ? 0 : parseFloat(totalAmount);
    const paid = amountPaid.trim() === '' ? 0 : parseFloat(amountPaid);

    if (isNaN(total) || total < 0) {
      setErrorMsg('कुल देय राशि अमान्य है।');
      return;
    }
    if (isNaN(paid) || paid <= 0) {
      setErrorMsg('कृपया वैध जमा राशि दर्ज करें (जमा राशि 0 से अधिक होनी चाहिए)।');
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanFeeType = feeType.split('(')[0].trim();
      const newRec: FeeCollectionRecord = {
        Receipt_Number: receiptNumber.trim(),
        Student_ID: String(selectedStudent.Student_ID || '').trim(),
        Date: date,
        Fee_Type: cleanFeeType,
        Month: month,
        Total_Amount: total,
        Amount_Paid: paid,
        Balance_Amount: calculatedBalance,
        Payment_Mode: paymentMode,
        Received_By: receivedBy.trim(),
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
                नई स्कूल फीस जमा करें (Add Fee Receipt)
              </h3>
              <p className="text-[11px] text-slate-300">
                मैनेजर व प्रिंसिपल द्वारा छात्र फीस प्रविष्टि एवं तत्काल रसीद सृजन
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
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
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
              <div className="mt-2.5 p-3 rounded-xl bg-gradient-to-r from-blue-50/90 to-indigo-50/60 border border-blue-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-sm shrink-0">
                    {selectedStudent.Student_Name ? selectedStudent.Student_Name.charAt(0) : 'S'}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{selectedStudent.Student_Name}</div>
                    <div className="text-[11px] text-slate-600 flex items-center gap-2">
                      <span>कक्षा: <strong>{getClassName(selectedStudent.Class)}</strong></span>
                      <span>•</span>
                      <span>पिता: {selectedStudent.Father_Name || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
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

            {/* Mode Switcher: Regular vs Advance Deposit */}
            <div className="mt-3 flex items-center gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setIsAdvanceMode(false);
                  if (feeType.includes('Advance') || feeType.includes('अग्रिम')) {
                    setFeeType('Monthly Tuition Fee (मासिक शिक्षण शुल्क)');
                  }
                  if (totalAmount === '0') {
                    setTotalAmount(currentPendingBalance > 0 ? String(currentPendingBalance) : '600');
                  }
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  !isAdvanceMode
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <i className="fa-solid fa-receipt"></i>
                <span>नियमित फीस जमा (Regular Fee)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsAdvanceMode(true);
                  setFeeType('Advance Fee Deposit (अग्रिम शुल्क जमा)');
                  setTotalAmount('0');
                  if (amountPaid === '0' || amountPaid === '600') {
                    setAmountPaid('700');
                  }
                }}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  isAdvanceMode
                    ? 'bg-purple-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                }`}
              >
                <i className="fa-solid fa-bolt text-amber-300"></i>
                <span>अग्रिम फीस जमा (Advance Deposit)</span>
              </button>
            </div>

            {isAdvanceMode && (
              <div className="mt-2.5 p-2.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-start gap-2">
                <i className="fa-solid fa-circle-info text-purple-700 mt-0.5"></i>
                <div>
                  <div className="font-bold">⚡ अग्रिम फीस जमा मोड (Advance Deposit Active)</div>
                  <div className="text-[11px] text-purple-700">
                    छात्र के खाते में यह राशि सीधे अग्रिम जमा (Advance) होगी। कोई नया बिल नहीं जुड़ेगा (Total = ₹0), जिससे शेष बैलेंस माइनस (-₹{amountPaid || 0}) में अग्रिम दर्ज होगा।
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
                  if (val.includes('Advance') || val.includes('अग्रिम')) {
                    setTotalAmount('0');
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

          {/* Financials: Total, Paid, Balance */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                कुल देय (Total Amount ₹){' '}
                <span className="text-[10px] text-slate-400 font-normal">
                  {isAdvanceMode ? '(अग्रिम में ₹0)' : '(अग्रिम में 0 या खाली छोड़ें)'}
                </span>
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
                  onChange={(e) => setTotalAmount(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-800 outline-none focus:border-blue-800 bg-white"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-emerald-800 mb-1">
                {isAdvanceMode ? 'अग्रिम जमा राशि (Advance Paid ₹)' : 'जमा राशि (Amount Paid ₹)'}{' '}
                <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                step="10"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                required
                placeholder={isAdvanceMode ? '700' : '600'}
                className="w-full px-3 py-1.5 rounded-lg border border-emerald-300 text-sm font-bold text-emerald-900 outline-none focus:border-emerald-600 bg-white"
              />
            </div>

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
