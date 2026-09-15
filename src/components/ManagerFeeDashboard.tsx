import React, { useState, useMemo } from 'react';
import { StudentRecordForScan } from './StudentQRScannerModal';
import { FeeCollectionRecord } from './AddFeeModal';

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
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [selectedStudent, setSelectedStudent] = useState<StudentRecordForScan | null>(initialSelectedStudent);
  const [activeViewMode, setActiveViewMode] = useState<'student' | 'allLedger'>('student');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [ledgerClassFilter, setLedgerClassFilter] = useState<string>('all');
  const [copiedReceipt, setCopiedReceipt] = useState<string | null>(null);

  // Sync initial student if provided from parent (e.g. after QR scan)
  React.useEffect(() => {
    if (initialSelectedStudent) {
      setSelectedStudent(initialSelectedStudent);
      setActiveViewMode('student');
    }
  }, [initialSelectedStudent]);

  // Format date helper
  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1)
          .toString()
          .padStart(2, '0')}/${d.getFullYear()}`;
      }
    } catch {}
    return String(dateStr);
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

  // Fee records strictly for the active selected student
  const studentFeeRecords = useMemo(() => {
    if (!selectedStudent) return [];
    const sid = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    return feeRecords.filter((r) => {
      const rSid = String(r.Student_ID || '').trim().toLowerCase();
      return Boolean(rSid && (rSid === sid || sid.includes(rSid) || rSid.includes(sid)));
    });
  }, [selectedStudent, feeRecords]);

  // Student Fee Summary Metrics
  const studentFeeSummary = useMemo(() => {
    if (!selectedStudent) {
      return { totalFee: 0, totalPaid: 0, balance: 0, isDue: false, count: 0 };
    }
    const rawBalance = getStudentBalance(selectedStudent);
    const totalPaid = studentFeeRecords.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);
    const balance = rawBalance > 0 ? rawBalance : 0;
    const totalFee = balance + totalPaid;
    return {
      totalFee: totalFee > 0 ? totalFee : totalPaid,
      totalPaid,
      balance,
      isDue: balance > 0,
      count: studentFeeRecords.length,
    };
  }, [selectedStudent, studentFeeRecords, feeBalances]);

  // Overall School Fee Metrics
  const schoolFeeTotals = useMemo(() => {
    let collected = 0;
    let balance = 0;
    feeRecords.forEach((f) => {
      collected += Number(f.Amount_Paid) || 0;
      balance += Number(f.Balance_Amount) || 0;
    });
    return {
      totalReceipts: feeRecords.length,
      collected,
      balance,
    };
  }, [feeRecords]);

  // Filtered All School Ledger
  const filteredAllLedger = useMemo(() => {
    return feeRecords.filter((r) => {
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
  }, [feeRecords, ledgerSearch, ledgerClassFilter, students, getClassName]);

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
          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10">
            <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
              कुल स्कूल रसीदें (Total Receipts)
            </div>
            <div className="text-lg sm:text-xl font-black text-amber-300 mt-0.5">
              {schoolFeeTotals.totalReceipts}
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10">
            <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
              प्राप्त कुल राशि (Total Collected)
            </div>
            <div className="text-lg sm:text-xl font-black text-emerald-300 mt-0.5">
              ₹{schoolFeeTotals.collected.toLocaleString('en-IN')}
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10">
            <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
              अपेक्षित कुल बकाया (Pending Dues)
            </div>
            <div className="text-lg sm:text-xl font-black text-rose-300 mt-0.5">
              ₹{schoolFeeTotals.balance.toLocaleString('en-IN')}
            </div>
          </div>

          <div className="bg-white/5 backdrop-blur-xs p-3 rounded-2xl border border-white/10 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-slate-300 uppercase tracking-wider font-semibold">
                प्रबंधक प्राधिकृत
              </div>
              <div className="text-xs font-bold text-white mt-0.5 truncate">{managerName}</div>
            </div>
            <i className="fa-solid fa-shield-check text-amber-400 text-lg"></i>
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

          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-2xl shrink-0">
            <button
              type="button"
              onClick={() => setActiveViewMode('student')}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeViewMode === 'student'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <i className="fa-solid fa-user-graduate text-xs"></i>
              <span>छात्र फीस इतिहास</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveViewMode('allLedger')}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeViewMode === 'allLedger'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
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
                      {getStudentPhoto ? (
                        <img
                          src={getStudentPhoto(st)}
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
                    {getStudentPhoto ? (
                      <img
                        src={getStudentPhoto(selectedStudent)}
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
                    studentFeeSummary.isDue
                      ? 'bg-rose-50 border-rose-300 text-rose-950'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-bold uppercase tracking-wide ${
                        studentFeeSummary.isDue ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {studentFeeSummary.isDue ? 'वर्तमान बकाया (DUE)' : 'बकाया स्थिति (STATUS)'}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${
                        studentFeeSummary.isDue
                          ? 'bg-rose-200 text-rose-900'
                          : 'bg-emerald-200 text-emerald-900'
                      }`}
                    >
                      {studentFeeSummary.isDue ? 'PENDING' : 'CLEARED'}
                    </span>
                  </div>
                  <span
                    className={`text-xl sm:text-2xl font-black mt-1 block ${
                      studentFeeSummary.isDue ? 'text-rose-900' : 'text-emerald-900'
                    }`}
                  >
                    ₹{studentFeeSummary.balance.toLocaleString('en-IN')}
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
                          const isPending = (fee.Balance_Amount || 0) > 0;

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
                                {fee.Fee_Type || 'Monthly Tuition Fee'}
                              </td>
                              <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                                {fee.Month || '—'}
                              </td>
                              <td className="px-3.5 py-3 text-right font-medium text-slate-700 whitespace-nowrap">
                                ₹{(fee.Total_Amount || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="px-3.5 py-3 text-right font-bold text-emerald-700 whitespace-nowrap">
                                ₹{(fee.Amount_Paid || 0).toLocaleString('en-IN')}
                              </td>
                              <td className="px-3.5 py-3 text-right whitespace-nowrap">
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                                    isPending
                                      ? 'bg-rose-100 text-rose-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  ₹{(fee.Balance_Amount || 0).toLocaleString('en-IN')}
                                </span>
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
                                <button
                                  type="button"
                                  onClick={() => handleShareSingleReceipt(fee)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                  title="Share WhatsApp Receipt with Parent"
                                >
                                  <i className="fa-brands fa-whatsapp text-xs"></i>
                                  <span>Receipt</span>
                                </button>
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
        <div className="px-6 pb-6 space-y-4">
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
                    const isPending = (fee.Balance_Amount || 0) > 0;

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
                          {fee.Fee_Type || 'Monthly Tuition'}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                          {fee.Month || '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-700 whitespace-nowrap">
                          ₹{(fee.Total_Amount || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                          ₹{(fee.Amount_Paid || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isPending ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            ₹{(fee.Balance_Amount || 0).toLocaleString('en-IN')}
                          </span>
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
                          <button
                            type="button"
                            onClick={() => handleShareSingleReceipt(fee)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                            title="Share WhatsApp Receipt"
                          >
                            <i className="fa-brands fa-whatsapp text-xs"></i>
                            <span>रसीद</span>
                          </button>
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
    </div>
  );
};
