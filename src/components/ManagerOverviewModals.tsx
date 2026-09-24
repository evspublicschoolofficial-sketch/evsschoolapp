import React, { useState, useMemo, useEffect } from 'react';
import { Student, FeeCollectionRecord, StudentBehaviorRecord } from '../types';
import { StudentAvatar } from './StudentAvatar';

interface ManagerOverviewModalsProps {
  students: Student[];
  feeRecords: FeeCollectionRecord[];
  feeBalances: Record<string, number>;
  behaviorList: StudentBehaviorRecord[];
  classMap: Record<string, string>;
  getClassName: (classId: string) => string;
  getStudentPhoto: (student: Student) => string;
  loadingStudents?: boolean;
  loadingFees?: boolean;
  loadingBehavior?: boolean;
  onSelectStudent?: (student: Student) => void;
}

export type ManagerModalType = 'totalStudents' | 'feesOverview' | 'absentToday' | 'faultyBehavior' | null;

export const getStudentPhone = (student?: any): string => {
  if (!student) return '';
  const raw =
    student.Parent_Mobile ||
    student['Parent_Mobile'] ||
    student['Parent Mobile'] ||
    student.Mobile_number ||
    student.Mobile ||
    student.phone ||
    '';
  return String(raw).trim();
};

export const formatIndianCurrency = (num: number): string => {
  return Number(num || 0).toLocaleString('en-IN');
};

export const ManagerOverviewModals: React.FC<ManagerOverviewModalsProps> = ({
  students,
  feeRecords,
  feeBalances,
  behaviorList,
  classMap,
  getClassName,
  getStudentPhoto,
  loadingStudents = false,
  loadingFees = false,
  loadingBehavior = false,
  onSelectStudent,
}) => {
  const [activeModal, setActiveModal] = useState<ManagerModalType>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [feeTab, setFeeTab] = useState<'collected' | 'pending'>('collected');
  const [attendanceDateTab, setAttendanceDateTab] = useState<'today' | 'recent'>('today');

  // Reset search and filters whenever modal opens/changes
  useEffect(() => {
    setSearchTerm('');
    setClassFilter('all');
  }, [activeModal]);

  // Handle ESC key to dismiss modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeModal) {
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal]);

  // Class options for filtering
  const classOptions = useMemo(() => {
    const set = new Set<string>();
    Object.keys(classMap).forEach((c) => set.add(c));
    students.forEach((s) => s.Class && set.add(s.Class.trim()));
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [students, classMap]);

  // Student quick lookup map
  const studentMap = useMemo(() => {
    const map = new Map<string, Student>();
    students.forEach((s) => {
      if (s.Student_ID) {
        map.set(String(s.Student_ID).toLowerCase().trim(), s);
      }
    });
    return map;
  }, [students]);

  // Helper to find student by ID
  const findStudent = (id?: string | null): Student | undefined => {
    if (!id) return undefined;
    const clean = String(id).toLowerCase().trim();
    return studentMap.get(clean);
  };

  // Current Date info
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayDmy = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const currentMonthNum = pad(now.getMonth() + 1);
  const currentMonthLong = now.toLocaleString('en-US', { month: 'long' }).toLowerCase();
  const currentMonthShort = now.toLocaleString('en-US', { month: 'short' }).toLowerCase();

  // 1. Total Students Metrics
  const totalStudentsCount = students.length;
  const activeClassCount = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => s.Class && set.add(s.Class.trim()));
    return set.size;
  }, [students]);

  // 2. Fees Overview Metrics
  const isFeeThisMonth = (f: FeeCollectionRecord) => {
    const m = (f.Month || '').toLowerCase().trim();
    if (m.includes(currentMonthLong) || m.includes(currentMonthShort) || m === currentMonthNum) {
      return true;
    }
    const d = String(f.Date || '').trim();
    if (d.includes(`-${currentMonthNum}-`) || d.includes(`/${currentMonthNum}/`) || d.startsWith(`${now.getFullYear()}-${currentMonthNum}`)) {
      return true;
    }
    return false;
  };

  // Fees collected this month
  const collectedThisMonthList = useMemo(() => {
    return feeRecords.filter((f) => {
      const amt = Number(f.Amount_Paid) || 0;
      return amt > 0 && isFeeThisMonth(f);
    });
  }, [feeRecords, currentMonthLong, currentMonthShort, currentMonthNum, now]);

  // Fallback: If no records are stamped this month yet, show recent payments
  const effectiveCollectedList = useMemo(() => {
    if (collectedThisMonthList.length > 0) return collectedThisMonthList;
    return feeRecords.filter((f) => (Number(f.Amount_Paid) || 0) > 0);
  }, [collectedThisMonthList, feeRecords]);

  const totalCollectedThisMonth = useMemo(() => {
    if (collectedThisMonthList.length > 0) {
      return collectedThisMonthList.reduce((acc, f) => acc + (Number(f.Amount_Paid) || 0), 0);
    }
    return feeRecords.reduce((acc, f) => acc + (Number(f.Amount_Paid) || 0), 0);
  }, [collectedThisMonthList, feeRecords]);

  // Pending Fees List: Students with unpaid dues
  const pendingFeesList = useMemo(() => {
    const list: { student: Student; pendingAmount: number; lastDate?: string }[] = [];
    students.forEach((st) => {
      const sId = String(st.Student_ID || '').toLowerCase().trim();
      const bal = feeBalances[sId] !== undefined ? feeBalances[sId] : Number(st.Balance_Amount || 0);
      if (bal > 0) {
        list.push({ student: st, pendingAmount: bal });
      }
    });
    return list.sort((a, b) => b.pendingAmount - a.pendingAmount);
  }, [students, feeBalances]);

  const totalPendingAmount = useMemo(() => {
    return pendingFeesList.reduce((acc, item) => acc + item.pendingAmount, 0);
  }, [pendingFeesList]);

  // 3. Absent Students Metrics
  // Check if date matches today
  const isDateToday = (dStr?: string): boolean => {
    if (!dStr) return false;
    const clean = String(dStr).trim();
    return (
      clean === todayDmy ||
      clean === todayYmd ||
      clean === `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}` ||
      clean.startsWith(todayYmd)
    );
  };

  const todayAttendanceRecords = useMemo(() => {
    return behaviorList.filter((b) => isDateToday(b.Date));
  }, [behaviorList, todayDmy, todayYmd]);

  const todayAbsentRecords = useMemo(() => {
    return todayAttendanceRecords.filter((b) => b.Is_Present === false);
  }, [todayAttendanceRecords]);

  // Latest recorded date if today has no attendance records submitted yet
  const latestRecordedDate = useMemo(() => {
    if (behaviorList.length === 0) return '';
    const sorted = [...behaviorList].sort((a, b) => {
      return String(b.Date || '').localeCompare(String(a.Date || ''));
    });
    return sorted[0]?.Date || '';
  }, [behaviorList]);

  const recentAbsentRecords = useMemo(() => {
    if (todayAbsentRecords.length > 0) return todayAbsentRecords;
    if (!latestRecordedDate) return [];
    return behaviorList.filter((b) => b.Date === latestRecordedDate && b.Is_Present === false);
  }, [todayAbsentRecords, latestRecordedDate, behaviorList]);

  // Effective absent count for summary card
  const effectiveAbsentCount = todayAttendanceRecords.length > 0 ? todayAbsentRecords.length : recentAbsentRecords.length;

  // 4. Faulty Behaviour Students Metrics
  const isFaultyRecord = (rec: StudentBehaviorRecord): { isFaulty: boolean; issue: string } => {
    const issues: string[] = [];

    // Discipline checkbox unchecked
    if (rec.Discipline === false) {
      issues.push('अनुशासनहीनता (Discipline Flagged)');
    }

    // Remark analysis for negative/warning notes
    const remark = (rec.Remark || '').trim();
    const lowerRemark = remark.toLowerCase();
    const negativeKeywords = [
      'faulty', 'bad', 'poor', 'warning', 'fight', 'fighting', 'shout', 'shouting',
      'late', 'incomplete', 'disturb', 'disturbing', 'aggressive', 'careless',
      'action', 'caution', 'complaint', 'मारपीट', 'लड़ाई', 'शिकायत', 'शरारत',
      'not listening', 'rudeness', 'rude', 'cheat', 'abuse', 'शोर', 'गाली'
    ];
    if (negativeKeywords.some((kw) => lowerRemark.includes(kw))) {
      issues.push(remark);
    }

    // Good manners poor/needs improvement
    const manners = (rec.Good_Manners || '').trim().toLowerCase();
    if (['bad', 'poor', 'needs improvement', 'unsatisfactory', 'खराब', 'सुधार की आवश्यकता'].includes(manners)) {
      issues.push(`शिष्टाचार: ${rec.Good_Manners}`);
    }

    // All hygiene neglected
    if (rec.Is_Bathed === false && rec.Nails_Clean === false && rec.Uniform_clean === false) {
      issues.push('साफ-सफाई उपेक्षित (Hygiene Neglected)');
    }

    // AI Feedback warning
    const feedback = (rec.AI_Feedback || '').toLowerCase();
    if (feedback.includes('caution') || feedback.includes('warning') || feedback.includes('attention needed')) {
      issues.push('AI चेतावनी (Caution)');
    }

    if (issues.length > 0) {
      return { isFaulty: true, issue: issues.join(' · ') };
    }
    return { isFaulty: false, issue: '' };
  };

  const faultyBehaviorRecords = useMemo(() => {
    const list: { record: StudentBehaviorRecord; student?: Student; issue: string }[] = [];
    behaviorList.forEach((rec) => {
      const { isFaulty, issue } = isFaultyRecord(rec);
      if (isFaulty) {
        const student = findStudent(rec.Student_ID);
        list.push({ record: rec, student, issue });
      }
    });
    return list;
  }, [behaviorList, studentMap]);

  // Filtered Student List for Card 1 Modal
  const filteredAllStudents = useMemo(() => {
    return students.filter((s) => {
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        String(s.Student_Name || '').toLowerCase().includes(term) ||
        String(s.Roll_Number || '').toLowerCase().includes(term) ||
        String(s.Admission_Number || '').toLowerCase().includes(term) ||
        String(s.Student_ID || '').toLowerCase().includes(term) ||
        String(getStudentPhone(s)).toLowerCase().includes(term) ||
        getClassName(s.Class).toLowerCase().includes(term);

      const matchClass =
        classFilter === 'all' ||
        String(s.Class || '').toLowerCase() === classFilter.toLowerCase() ||
        getClassName(s.Class).toLowerCase() === classFilter.toLowerCase();

      return matchSearch && matchClass;
    });
  }, [students, searchTerm, classFilter, classMap]);

  // Filtered Collected Fees for Card 2 Modal
  const filteredCollectedFees = useMemo(() => {
    return effectiveCollectedList.filter((f) => {
      const st = findStudent(f.Student_ID);
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        String(f.Receipt_Number || '').toLowerCase().includes(term) ||
        String(f.Student_ID || '').toLowerCase().includes(term) ||
        String(f.Fee_Type || '').toLowerCase().includes(term) ||
        (st && String(st.Student_Name || '').toLowerCase().includes(term)) ||
        (st && String(getStudentPhone(st)).toLowerCase().includes(term));

      const matchClass =
        classFilter === 'all' ||
        (st && (String(st.Class || '').toLowerCase() === classFilter.toLowerCase() ||
                getClassName(st.Class).toLowerCase() === classFilter.toLowerCase()));

      return matchSearch && matchClass;
    });
  }, [effectiveCollectedList, searchTerm, classFilter, studentMap]);

  // Filtered Pending Fees for Card 2 Modal
  const filteredPendingFees = useMemo(() => {
    return pendingFeesList.filter(({ student }) => {
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        String(student.Student_Name || '').toLowerCase().includes(term) ||
        String(student.Roll_Number || '').toLowerCase().includes(term) ||
        String(student.Student_ID || '').toLowerCase().includes(term) ||
        String(getStudentPhone(student)).toLowerCase().includes(term) ||
        getClassName(student.Class).toLowerCase().includes(term);

      const matchClass =
        classFilter === 'all' ||
        String(student.Class || '').toLowerCase() === classFilter.toLowerCase() ||
        getClassName(student.Class).toLowerCase() === classFilter.toLowerCase();

      return matchSearch && matchClass;
    });
  }, [pendingFeesList, searchTerm, classFilter]);

  // Filtered Absentees for Card 3 Modal
  const currentAbsentSource = attendanceDateTab === 'today' && todayAbsentRecords.length > 0 ? todayAbsentRecords : recentAbsentRecords;

  const filteredAbsentees = useMemo(() => {
    return currentAbsentSource.filter((rec) => {
      const st = findStudent(rec.Student_ID);
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        String(rec.Student_ID || '').toLowerCase().includes(term) ||
        (st && String(st.Student_Name || '').toLowerCase().includes(term)) ||
        (st && String(st.Roll_Number || '').toLowerCase().includes(term)) ||
        (st && String(getStudentPhone(st)).toLowerCase().includes(term)) ||
        getClassName(rec.Class).toLowerCase().includes(term);

      const matchClass =
        classFilter === 'all' ||
        String(rec.Class || '').toLowerCase() === classFilter.toLowerCase() ||
        getClassName(rec.Class).toLowerCase() === classFilter.toLowerCase();

      return matchSearch && matchClass;
    });
  }, [currentAbsentSource, searchTerm, classFilter, studentMap]);

  // Filtered Faulty Behaviour for Card 4 Modal
  const filteredFaultyRecords = useMemo(() => {
    return faultyBehaviorRecords.filter(({ record, student, issue }) => {
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        String(record.Student_ID || '').toLowerCase().includes(term) ||
        (student && String(student.Student_Name || '').toLowerCase().includes(term)) ||
        (student && String(getStudentPhone(student)).toLowerCase().includes(term)) ||
        issue.toLowerCase().includes(term) ||
        getClassName(record.Class).toLowerCase().includes(term);

      const matchClass =
        classFilter === 'all' ||
        String(record.Class || '').toLowerCase() === classFilter.toLowerCase() ||
        getClassName(record.Class).toLowerCase() === classFilter.toLowerCase();

      return matchSearch && matchClass;
    });
  }, [faultyBehaviorRecords, searchTerm, classFilter]);

  return (
    <>
      {/* 4 DYNAMIC SUMMARY CARDS IN MANAGER DASHBOARD HEADER */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CARD 1: TOTAL STUDENTS */}
        <button
          type="button"
          id="manager-card-total-students"
          onClick={() => setActiveModal('totalStudents')}
          className="group relative bg-white hover:bg-blue-50/40 p-4 rounded-2xl shadow-xs hover:shadow-md border border-slate-200/90 hover:border-blue-300 transition-all text-left cursor-pointer flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-900 flex items-center justify-center text-lg font-bold shadow-2xs group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-user-graduate"></i>
            </div>
            <span className="text-[10px] font-bold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
              {activeClassCount} Classes Active
            </span>
          </div>

          <div className="mt-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Total Students (कुल छात्र)
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900">
                {loadingStudents ? '...' : totalStudentsCount}
              </span>
              <span className="text-xs text-slate-500 font-medium">Enrolled</span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-blue-700 font-bold group-hover:text-blue-900">
            <span>View Full Directory</span>
            <i className="fa-solid fa-arrow-right text-[11px] group-hover:translate-x-1 transition-transform"></i>
          </div>
        </button>

        {/* CARD 2: FEES OVERVIEW */}
        <button
          type="button"
          id="manager-card-fees-overview"
          onClick={() => setActiveModal('feesOverview')}
          className="group relative bg-white hover:bg-emerald-50/40 p-4 rounded-2xl shadow-xs hover:shadow-md border border-slate-200/90 hover:border-emerald-300 transition-all text-left cursor-pointer flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-lg font-bold shadow-2xs group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              ₹ Accounts Live
            </span>
          </div>

          <div className="mt-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Fees Overview (शुल्क सारांश)
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl sm:text-2xl font-black text-emerald-700">
                {loadingFees ? '...' : `₹${formatIndianCurrency(totalCollectedThisMonth)}`}
              </span>
              <span className="text-[11px] text-slate-500 font-semibold">Collected</span>
            </div>
            <div className="mt-1 text-xs text-slate-600 font-medium">
              <span className="text-rose-600 font-bold">₹{formatIndianCurrency(totalPendingAmount)}</span> Pending Dues
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-emerald-700 font-bold group-hover:text-emerald-900">
            <span>Collected vs Pending</span>
            <i className="fa-solid fa-arrow-right text-[11px] group-hover:translate-x-1 transition-transform"></i>
          </div>
        </button>

        {/* CARD 3: ABSENT STUDENTS TODAY */}
        <button
          type="button"
          id="manager-card-absent-today"
          onClick={() => setActiveModal('absentToday')}
          className="group relative bg-white hover:bg-rose-50/40 p-4 rounded-2xl shadow-xs hover:shadow-md border border-slate-200/90 hover:border-rose-300 transition-all text-left cursor-pointer flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-800 flex items-center justify-center text-lg font-bold shadow-2xs group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-user-xmark"></i>
            </div>
            <span className="text-[10px] font-bold text-rose-800 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
              Today's Absentees
            </span>
          </div>

          <div className="mt-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Absent Students Today (अनुपस्थित)
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl sm:text-3xl font-black text-rose-600">
                {loadingBehavior ? '...' : effectiveAbsentCount}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                {todayAttendanceRecords.length > 0 ? 'Marked Absent Today' : 'Recent Absentees'}
              </span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-rose-700 font-bold group-hover:text-rose-900">
            <span>View & Call Parents</span>
            <i className="fa-solid fa-arrow-right text-[11px] group-hover:translate-x-1 transition-transform"></i>
          </div>
        </button>

        {/* CARD 4: FAULTY BEHAVIOUR STUDENTS */}
        <button
          type="button"
          id="manager-card-faulty-behavior"
          onClick={() => setActiveModal('faultyBehavior')}
          className="group relative bg-white hover:bg-amber-50/40 p-4 rounded-2xl shadow-xs hover:shadow-md border border-slate-200/90 hover:border-amber-300 transition-all text-left cursor-pointer flex flex-col justify-between"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center text-lg font-bold shadow-2xs group-hover:scale-105 transition-transform">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <span className="text-[10px] font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              Requires Action / Caution
            </span>
          </div>

          <div className="mt-3">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
              Faulty Behaviour Students (शिकायत/अनुशासन)
            </span>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl sm:text-3xl font-black text-amber-700">
                {loadingBehavior ? '...' : faultyBehaviorRecords.length}
              </span>
              <span className="text-xs text-slate-500 font-medium">Flagged Records</span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-amber-800 font-bold group-hover:text-amber-950">
            <span>Action Required</span>
            <i className="fa-solid fa-arrow-right text-[11px] group-hover:translate-x-1 transition-transform"></i>
          </div>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* INTERACTIVE FULL-SCREEN / RESPONSIVE SLIDE-OVER MODALS                    */}
      {/* ========================================================================= */}
      {activeModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 animate-fadeIn"
          onClick={() => setActiveModal(null)}
        >
          <div
            className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-scaleUp text-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* MODAL HEADER */}
            <div className="px-5 py-4 bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white flex items-center justify-between gap-4 border-b-2 border-amber-400">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center text-lg font-black shrink-0">
                  {activeModal === 'totalStudents' && <i className="fa-solid fa-users"></i>}
                  {activeModal === 'feesOverview' && <i className="fa-solid fa-file-invoice-dollar"></i>}
                  {activeModal === 'absentToday' && <i className="fa-solid fa-user-xmark"></i>}
                  {activeModal === 'faultyBehavior' && <i className="fa-solid fa-triangle-exclamation"></i>}
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-extrabold text-white">
                    {activeModal === 'totalStudents' && 'Enrolled Students Directory (कुल छात्र)'}
                    {activeModal === 'feesOverview' && 'School Fees Overview (फीस सारांश)'}
                    {activeModal === 'absentToday' && 'Absent Students Today (आज अनुपस्थित छात्र)'}
                    {activeModal === 'faultyBehavior' && 'Faulty Behaviour & Caution Records (आचरण व अनुशासन)'}
                  </h3>
                  <p className="text-xs text-amber-200/90">
                    {activeModal === 'totalStudents' && `Total ${students.length} students enrolled across ${activeClassCount} classes`}
                    {activeModal === 'feesOverview' && `Collected ₹${formatIndianCurrency(totalCollectedThisMonth)} · Pending ₹${formatIndianCurrency(totalPendingAmount)}`}
                    {activeModal === 'absentToday' && `${effectiveAbsentCount} students absent · Call parents directly`}
                    {activeModal === 'faultyBehavior' && `${faultyBehaviorRecords.length} students flagged for behavioral caution`}
                  </p>
                </div>
              </div>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
                title="बंद करें (Close)"
                aria-label="Close Modal"
              >
                <i className="fa-solid fa-xmark text-base"></i>
              </button>
            </div>

            {/* SEARCH & FILTER CONTROLS */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="छात्र का नाम, रोल नंबर, कक्षा या फ़ोन से खोजें (Search Name, Roll, Class, Phone)..."
                  className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="all">सभी कक्षाएं (All Classes)</option>
                  {classOptions.map((c) => (
                    <option key={c} value={c}>
                      Class {getClassName(c)}
                    </option>
                  ))}
                </select>

                {/* Sub-tabs for Fees Modal */}
                {activeModal === 'feesOverview' && (
                  <div className="flex bg-slate-200/80 p-0.5 rounded-xl text-xs font-bold shrink-0">
                    <button
                      type="button"
                      onClick={() => setFeeTab('collected')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        feeTab === 'collected'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      ✓ जमा शुल्क ({filteredCollectedFees.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeeTab('pending')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        feeTab === 'pending'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      ⚠ बकाया शुल्क ({filteredPendingFees.length})
                    </button>
                  </div>
                )}

                {/* Sub-tabs for Absentees Modal if attendance logged on multiple dates */}
                {activeModal === 'absentToday' && latestRecordedDate && (
                  <div className="flex bg-slate-200/80 p-0.5 rounded-xl text-xs font-bold shrink-0">
                    <button
                      type="button"
                      onClick={() => setAttendanceDateTab('today')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        attendanceDateTab === 'today'
                          ? 'bg-blue-900 text-white shadow-xs'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      आज (Today)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendanceDateTab('recent')}
                      className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                        attendanceDateTab === 'recent'
                          ? 'bg-blue-900 text-white shadow-xs'
                          : 'text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      हालिया ({latestRecordedDate})
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* MODAL BODY (SCROLLABLE LIST) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* ================================================================= */}
              {/* MODAL 1: TOTAL ENROLLED STUDENTS LIST                             */}
              {/* ================================================================= */}
              {activeModal === 'totalStudents' && (
                <>
                  {filteredAllStudents.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <i className="fa-solid fa-user-slash text-4xl mb-3"></i>
                      <p className="font-semibold text-sm">कोई छात्र नहीं मिला (No students found)</p>
                      <p className="text-xs mt-1">खोज शब्द या कक्षा फ़िल्टर बदलें।</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredAllStudents.map((st) => {
                        const phone = getStudentPhone(st);
                        const bal = feeBalances[String(st.Student_ID || '').toLowerCase()] ?? Number(st.Balance_Amount || 0);

                        return (
                          <div
                            key={st.Student_ID}
                            className="bg-white p-3.5 rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-xs transition-all flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <StudentAvatar
                                student={st}
                                photoUrl={getStudentPhoto(st)}
                                size="md"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h4 className="font-extrabold text-sm text-slate-900 truncate">
                                    {st.Student_Name}
                                  </h4>
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-900 rounded">
                                    Class {getClassName(st.Class)}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                                  <span>Roll: {st.Roll_Number || 'N/A'}</span>
                                  <span>•</span>
                                  <span>ID: {st.Student_ID}</span>
                                </div>
                                {bal > 0 && (
                                  <div className="text-[10px] text-rose-600 font-semibold mt-0.5">
                                    बकाया: ₹{formatIndianCurrency(bal)}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 shrink-0">
                              {phone ? (
                                <a
                                  href={`tel:${phone}`}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                                  title={`कॉल करें: ${phone}`}
                                >
                                  <i className="fa-solid fa-phone text-[10px]"></i>
                                  <span className="hidden sm:inline">Call Parent</span>
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                                  No Phone
                                </span>
                              )}

                              {onSelectStudent && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectStudent(st);
                                    setActiveModal(null);
                                  }}
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                                  title="प्रोफ़ाइल देखें (View Profile)"
                                >
                                  <i className="fa-solid fa-eye"></i>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ================================================================= */}
              {/* MODAL 2: FEES OVERVIEW (COLLECTED HISTORY vs PENDING FEES)        */}
              {/* ================================================================= */}
              {activeModal === 'feesOverview' && (
                <>
                  {feeTab === 'collected' ? (
                    <div>
                      <div className="mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between">
                        <span>
                          <strong>जमा शुल्क (Collected History):</strong> कुल ₹{formatIndianCurrency(totalCollectedThisMonth)}
                        </span>
                        <span className="text-[11px] font-bold">
                          {filteredCollectedFees.length} रसीदें (Receipts)
                        </span>
                      </div>

                      {filteredCollectedFees.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                          <i className="fa-solid fa-receipt text-4xl mb-3"></i>
                          <p className="font-semibold text-sm">कोई शुल्क रसीद नहीं मिली (No receipts found)</p>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {filteredCollectedFees.map((f, idx) => {
                            const st = findStudent(f.Student_ID);
                            const phone = getStudentPhone(st);

                            return (
                              <div
                                key={f.Receipt_Number || idx}
                                className="bg-white p-3.5 rounded-2xl border border-slate-200 hover:border-emerald-300 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <StudentAvatar
                                    student={st}
                                    photoUrl={st ? getStudentPhoto(st) : ''}
                                    size="md"
                                  />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-extrabold text-sm text-slate-900">
                                        {st?.Student_Name || `Student ${f.Student_ID}`}
                                      </h4>
                                      {st?.Class && (
                                        <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-900 rounded">
                                          Class {getClassName(st.Class)}
                                        </span>
                                      )}
                                      <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded">
                                        Receipt: {f.Receipt_Number || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1 flex-wrap">
                                      <span>तारीख: {f.Date || 'N/A'}</span>
                                      <span>•</span>
                                      <span>महीना: {f.Month || 'N/A'}</span>
                                      <span>•</span>
                                      <span>माध्यम: {f.Payment_Mode || 'Cash'}</span>
                                      {f.Received_By && <span>• प्राप्तकर्ता: {f.Received_By}</span>}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                  <div className="text-right">
                                    <div className="text-base font-black text-emerald-600">
                                      ₹{formatIndianCurrency(Number(f.Amount_Paid) || 0)}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-medium">Paid Successfully</div>
                                  </div>

                                  {phone && (
                                    <a
                                      href={`tel:${phone}`}
                                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                                      title={`अभिभावक को कॉल करें: ${phone}`}
                                    >
                                      <i className="fa-solid fa-phone text-[10px]"></i>
                                      <span className="hidden sm:inline">Call Parent</span>
                                    </a>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between">
                        <span>
                          <strong>बकाया शुल्क सूची (Pending Dues List):</strong> कुल बकाया ₹{formatIndianCurrency(totalPendingAmount)}
                        </span>
                        <span className="text-[11px] font-bold">
                          {filteredPendingFees.length} छात्र (Students with Dues)
                        </span>
                      </div>

                      {filteredPendingFees.length === 0 ? (
                        <div className="text-center py-12 text-slate-400">
                          <i className="fa-solid fa-circle-check text-4xl mb-3 text-emerald-500"></i>
                          <p className="font-semibold text-sm text-emerald-700">कोई बकाया नहीं! (No pending fees!)</p>
                          <p className="text-xs mt-1">सभी चयनित छात्रों की फीस जमा है।</p>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {filteredPendingFees.map(({ student, pendingAmount }) => {
                            const phone = getStudentPhone(student);

                            return (
                              <div
                                key={student.Student_ID}
                                className="bg-white p-3.5 rounded-2xl border border-slate-200 hover:border-rose-300 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <StudentAvatar
                                    student={student}
                                    photoUrl={getStudentPhoto(student)}
                                    size="md"
                                  />
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-extrabold text-sm text-slate-900">
                                        {student.Student_Name}
                                      </h4>
                                      <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-900 rounded">
                                        Class {getClassName(student.Class)}
                                      </span>
                                      <span className="text-[10px] text-slate-500">
                                        Roll: {student.Roll_Number || 'N/A'}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1">
                                      <span>पिता: {student.Father_Name || 'N/A'}</span>
                                      <span>•</span>
                                      <span>ID: {student.Student_ID}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                                  <div className="text-right">
                                    <div className="text-base font-black text-rose-600">
                                      ₹{formatIndianCurrency(pendingAmount)}
                                    </div>
                                    <div className="text-[10px] text-rose-500 font-semibold uppercase tracking-wider">
                                      Pending Due
                                    </div>
                                  </div>

                                  {phone ? (
                                    <a
                                      href={`tel:${phone}`}
                                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                                      title={`फीस याद दिलाने हेतु कॉल करें: ${phone}`}
                                    >
                                      <i className="fa-solid fa-phone text-[10px]"></i>
                                      <span>Call Parent</span>
                                    </a>
                                  ) : (
                                    <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                                      No Contact
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ================================================================= */}
              {/* MODAL 3: ABSENT STUDENTS TODAY                                    */}
              {/* ================================================================= */}
              {activeModal === 'absentToday' && (
                <>
                  <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center justify-between">
                    <span>
                      <strong>अनुपस्थित छात्र (Absentees):</strong>{' '}
                      {attendanceDateTab === 'today' ? `आज की हाजिरी (${todayDmy})` : `सत्र दिनांक (${latestRecordedDate})`}
                    </span>
                    <span className="text-[11px] font-bold">
                      {filteredAbsentees.length} अनुपस्थित (Absent)
                    </span>
                  </div>

                  {filteredAbsentees.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <i className="fa-solid fa-calendar-check text-4xl mb-3 text-emerald-500"></i>
                      <p className="font-semibold text-sm text-slate-800">
                        कोई अनुपस्थित छात्र नहीं! (All present or no absence recorded)
                      </p>
                      <p className="text-xs mt-1 text-slate-500">
                        {todayAttendanceRecords.length === 0
                          ? 'आज की उपस्थिति शीट में अभी तक कोई अनुपस्थिति दर्ज नहीं है।'
                          : 'आज सभी छात्र उपस्थित दर्ज हैं।'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredAbsentees.map((rec, idx) => {
                        const st = findStudent(rec.Student_ID);
                        const phone = getStudentPhone(st);

                        return (
                          <div
                            key={rec.Behavior_ID || `${rec.Student_ID}-${idx}`}
                            className="bg-white p-3.5 rounded-2xl border border-rose-200 hover:border-rose-400 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <StudentAvatar
                                student={st}
                                photoUrl={st ? getStudentPhoto(st) : ''}
                                size="md"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-extrabold text-sm text-slate-900">
                                    {st?.Student_Name || `Student ${rec.Student_ID}`}
                                  </h4>
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-900 rounded">
                                    Class {getClassName(rec.Class || st?.Class || '')}
                                  </span>
                                  <span className="text-[10px] font-bold px-2 py-0.2 bg-rose-100 text-rose-800 rounded-full">
                                    ❌ अनुपस्थित (Absent)
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-1 flex-wrap">
                                  <span>Roll: {st?.Roll_Number || 'N/A'}</span>
                                  <span>•</span>
                                  <span>पिता: {st?.Father_Name || 'N/A'}</span>
                                  <span>•</span>
                                  <span>तारीख: {rec.Date || todayDmy}</span>
                                </div>
                                {rec.Remark && rec.Remark !== 'OK' && (
                                  <div className="text-[11px] text-slate-600 italic mt-0.5">
                                    टिप्पणी: "{rec.Remark}"
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                              {phone ? (
                                <a
                                  href={`tel:${phone}`}
                                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                                  title={`अनुपस्थिति के कारण जानने हेतु कॉल करें: ${phone}`}
                                >
                                  <i className="fa-solid fa-phone text-[10px]"></i>
                                  <span>Call Parent</span>
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                                  फ़ोन उपलब्ध नहीं
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ================================================================= */}
              {/* MODAL 4: FAULTY BEHAVIOUR & CAUTION STUDENTS                      */}
              {/* ================================================================= */}
              {activeModal === 'faultyBehavior' && (
                <>
                  <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between">
                    <span>
                      <strong>आचरण व अनुशासन चेतावनी (Behavior & Disciplinary Action):</strong> तुरंत ध्यान देने योग्य
                    </span>
                    <span className="text-[11px] font-bold">
                      {filteredFaultyRecords.length} मामले (Flagged Cases)
                    </span>
                  </div>

                  {filteredFaultyRecords.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <i className="fa-solid fa-award text-4xl mb-3 text-amber-500"></i>
                      <p className="font-semibold text-sm text-slate-800">
                        कोई अनुशासनात्मक समस्या नहीं! (No faulty behaviour records found)
                      </p>
                      <p className="text-xs mt-1 text-slate-500">
                        सभी छात्रों का आचरण व स्वच्छता रिकॉर्ड संतोषजनक है।
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredFaultyRecords.map(({ record, student, issue }, idx) => {
                        const phone = getStudentPhone(student);

                        return (
                          <div
                            key={record.Behavior_ID || idx}
                            className="bg-white p-3.5 rounded-2xl border border-amber-200 hover:border-amber-400 hover:shadow-xs transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <StudentAvatar
                                student={student}
                                photoUrl={student ? getStudentPhoto(student) : ''}
                                size="md"
                              />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-extrabold text-sm text-slate-900">
                                    {student?.Student_Name || `Student ${record.Student_ID}`}
                                  </h4>
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 bg-blue-100 text-blue-900 rounded">
                                    Class {getClassName(record.Class || student?.Class || '')}
                                  </span>
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {record.Date}
                                  </span>
                                </div>
                                <div className="text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200/80 mt-1 inline-block">
                                  ⚠ {issue}
                                </div>
                                {record.Remark && (
                                  <div className="text-[11px] text-slate-600 mt-1">
                                    शिक्षक टिप्पणी: <em>"{record.Remark}"</em>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                              {phone ? (
                                <a
                                  href={`tel:${phone}`}
                                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors"
                                  title={`अभिभावक से बात करें: ${phone}`}
                                >
                                  <i className="fa-solid fa-phone text-[10px]"></i>
                                  <span>Call Parent</span>
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                                  फ़ोन उपलब्ध नहीं
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* MODAL FOOTER */}
            <div className="px-5 py-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <span>
                <i className="fa-solid fa-shield-check text-emerald-600 mr-1.5"></i>
                E.V.S. Public School Manager Portal
              </span>
              <button
                type="button"
                onClick={() => setActiveModal(null)}
                className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold rounded-xl transition-colors cursor-pointer"
              >
                बंद करें (Close)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ManagerOverviewModals;
