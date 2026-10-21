import React, { useState, useMemo } from 'react';
import { SchoolUser, Student, Homework, HomeworkTrackerRecord } from '../types';

interface TeacherHomeworkCheckerProps {
  currentUser: SchoolUser;
  homeworkList: Homework[];
  students: Student[];
  hwTrackerList: HomeworkTrackerRecord[];
  onSetStudentStatus: (
    studentId: string,
    date: string,
    className: string,
    subject: string,
    targetStatus: 'Completed' | 'Incompleted'
  ) => void;
  onBulkSetStatus: (
    studentIds: string[],
    date: string,
    className: string,
    subject: string,
    targetStatus: 'Completed' | 'Incompleted'
  ) => void;
  getClassName: (classVal: any) => string;
  getStudentPhoto?: (student: Student) => string;
  onOpenUploadTab?: () => void;
}

export const TeacherHomeworkChecker: React.FC<TeacherHomeworkCheckerProps> = ({
  currentUser,
  homeworkList = [],
  students = [],
  hwTrackerList = [],
  onSetStudentStatus,
  onBulkSetStatus,
  getClassName,
  getStudentPhoto,
  onOpenUploadTab,
}) => {
  // Filter mode: 'my_homework' (default) vs 'all_homework'
  const [filterMode, setFilterMode] = useState<'my_homework' | 'all_homework'>('my_homework');
  
  // Selected Homework ID to view & check students
  const [selectedHwId, setSelectedHwId] = useState<string | null>(null);

  // Dedicated interactive modal to check homework (opens on mobile and desktop)
  const [isCheckerModalOpen, setIsCheckerModalOpen] = useState<boolean>(false);

  // Student Search in selected homework
  const [studentSearch, setStudentSearch] = useState<string>('');

  // Status Filter in selected homework: 'all' | 'completed' | 'incompleted'
  const [studentStatusFilter, setStudentStatusFilter] = useState<'all' | 'completed' | 'incompleted'>('all');

  // Handler to immediately open checker modal for a homework assignment
  const handleOpenChecker = (hw: Homework) => {
    setSelectedHwId(hw.Homework_ID);
    setStudentSearch('');
    setStudentStatusFilter('all');
    setIsCheckerModalOpen(true);
  };

  const currentTeacherName = (currentUser.Name || '').trim().toLowerCase();

  // Filter homework: If 'my_homework', show homework given by logged-in teacher
  const filteredHomeworkList = useMemo(() => {
    return homeworkList.filter((hw) => {
      if (filterMode === 'all_homework') return true;
      const hwTeacher = (hw.Teacher || '').trim().toLowerCase();
      // Match by teacher name
      if (currentTeacherName && hwTeacher.includes(currentTeacherName)) return true;
      if (currentTeacherName && currentTeacherName.includes(hwTeacher)) return true;
      // Or if assigned class matches teacher's assigned class
      if (currentUser.Assigned_Class && hw.Class) {
        if (getClassName(hw.Class) === getClassName(currentUser.Assigned_Class)) return true;
      }
      return false;
    });
  }, [homeworkList, filterMode, currentTeacherName, currentUser.Assigned_Class, getClassName]);

  // Set the first homework as selected by default if none selected
  const activeHomework = useMemo(() => {
    if (selectedHwId) {
      const found = homeworkList.find((h) => h.Homework_ID === selectedHwId);
      if (found) return found;
    }
    if (filteredHomeworkList.length > 0) {
      return filteredHomeworkList[0];
    }
    return homeworkList[0] || null;
  }, [selectedHwId, filteredHomeworkList, homeworkList]);

  // Students belonging to the active homework's class
  const classStudents = useMemo(() => {
    if (!activeHomework) return [];
    const targetClass = getClassName(activeHomework.Class).toLowerCase();
    return students.filter((s) => {
      return getClassName(s.Class).toLowerCase() === targetClass;
    });
  }, [activeHomework, students, getClassName]);

  // Normalize date helper
  const isMatchingDate = (date1?: string, date2?: string): boolean => {
    if (!date1 || !date2) return false;
    const d1 = date1.replace(/-/g, '/').trim();
    const d2 = date2.replace(/-/g, '/').trim();
    if (d1 === d2) return true;
    // Compare YYYY-MM-DD vs DD/MM/YYYY
    const p1 = d1.split('/');
    const p2 = d2.split('/');
    if (p1.length === 3 && p2.length === 3) {
      // standard check
      if (p1[0].length === 4 && p2[2].length === 4) {
        return p1[0] === p2[2] && parseInt(p1[1], 10) === parseInt(p2[1], 10) && parseInt(p1[2], 10) === parseInt(p2[0], 10);
      }
      if (p1[2].length === 4 && p2[0].length === 4) {
        return p1[2] === p2[0] && parseInt(p1[1], 10) === parseInt(p2[1], 10) && parseInt(p1[0], 10) === parseInt(p2[2], 10);
      }
    }
    return false;
  };

  // Helper to get status of student for the active homework
  const getStudentHomeworkStatus = (studentId: string): 'Completed' | 'Incompleted' => {
    if (!activeHomework) return 'Incompleted';
    const sId = String(studentId || '').trim().toLowerCase();
    
    // Look for matching record in hwTrackerList
    const rec = hwTrackerList.find((r) => {
      const rSId = String(r.Student_ID || r.ID || '').trim().toLowerCase();
      if (rSId !== sId) return false;
      // Match date if possible
      if (r.Date && activeHomework.Date && !isMatchingDate(r.Date, activeHomework.Date)) {
        return false;
      }
      // Match subject if present
      if (r.Subject && activeHomework.Subject) {
        const sub1 = r.Subject.toLowerCase();
        const sub2 = activeHomework.Subject.toLowerCase();
        if (!sub1.includes(sub2) && !sub2.includes(sub1) && !sub1.includes('general')) {
          return false;
        }
      }
      return true;
    });

    if (rec) {
      const st = (rec.Last_homework_Status || '').toLowerCase();
      if (st.includes('complete') && !st.includes('incom')) {
        return 'Completed';
      }
      return 'Incompleted';
    }

    return 'Incompleted';
  };

  // Students list with computed status
  const studentsWithStatus = useMemo(() => {
    return classStudents.map((st) => {
      const status = getStudentHomeworkStatus(st.Student_ID);
      return {
        student: st,
        status,
        isCompleted: status === 'Completed',
      };
    });
  }, [classStudents, hwTrackerList, activeHomework]);

  // Filtered students for search and status tabs
  const filteredStudents = useMemo(() => {
    return studentsWithStatus.filter(({ student, status }) => {
      const q = studentSearch.toLowerCase().trim();
      const matchesSearch =
        !q ||
        student.Student_Name.toLowerCase().includes(q) ||
        String(student.Roll_Number || '').includes(q) ||
        String(student.Student_ID || '').toLowerCase().includes(q);

      const matchesStatus =
        studentStatusFilter === 'all' ||
        (studentStatusFilter === 'completed' && status === 'Completed') ||
        (studentStatusFilter === 'incompleted' && status === 'Incompleted');

      return matchesSearch && matchesStatus;
    });
  }, [studentsWithStatus, studentSearch, studentStatusFilter]);

  // Overall counts for active homework
  const totalClassCount = studentsWithStatus.length;
  const completedCount = studentsWithStatus.filter((s) => s.isCompleted).length;
  const incompletedCount = totalClassCount - completedCount;
  const completionPercentage = totalClassCount > 0 ? Math.round((completedCount / totalClassCount) * 100) : 0;

  // Bulk actions
  const handleMarkAllComplete = () => {
    if (!activeHomework || classStudents.length === 0) return;
    const allIds = classStudents.map((s) => s.Student_ID);
    onBulkSetStatus(allIds, activeHomework.Date, activeHomework.Class, activeHomework.Subject, 'Completed');
  };

  const handleMarkAllIncomplete = () => {
    if (!activeHomework || classStudents.length === 0) return;
    const allIds = classStudents.map((s) => s.Student_ID);
    onBulkSetStatus(allIds, activeHomework.Date, activeHomework.Class, activeHomework.Subject, 'Incompleted');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Banner: Easy 1-Click Teacher Checker Intro */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#16365c] to-[#0c2340] p-5 sm:p-6 rounded-3xl text-white shadow-xl border border-amber-500/20 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                <i className="fa-solid fa-list-check"></i>
                <span>सरल होमवर्क चेकर (Easy HW Checker)</span>
              </span>
              <span className="text-xs text-amber-200/90 font-medium">
                अध्यापक द्वारा दिए गए होमवर्क की 1-क्लिक ट्रैकिंग
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              <span>{currentUser.Name}</span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-lg bg-white/10 text-amber-300 border border-white/10">
                {currentUser.Designation || 'Teacher'}
              </span>
            </h2>
            <p className="text-xs text-slate-300 max-w-xl">
              आप जिस होमवर्क को चुनेंगे, उसके सभी छात्र नीचे खुल जाएंगे। छात्र की कॉपी देखकर केवल <b>[Complete]</b> या <b>[Incomplete]</b> पर एक टच करें!
            </p>
          </div>

          {/* Filter Toggle: Only My Homework vs All Homework */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 bg-white/10 p-1.5 rounded-2xl border border-white/15">
            <button
              type="button"
              onClick={() => setFilterMode('my_homework')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                filterMode === 'my_homework'
                  ? 'bg-amber-400 text-slate-950 font-black shadow-sm'
                  : 'text-white hover:bg-white/10'
              }`}
            >
              <i className="fa-solid fa-user-check"></i>
              <span>केवल मेरे दिए गए होमवर्क ({homeworkList.filter(h => (h.Teacher || '').toLowerCase().includes(currentTeacherName)).length})</span>
            </button>

            <button
              type="button"
              onClick={() => setFilterMode('all_homework')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                filterMode === 'all_homework'
                  ? 'bg-amber-400 text-slate-950 font-black shadow-sm'
                  : 'text-white hover:bg-white/10'
              }`}
            >
              <i className="fa-solid fa-users"></i>
              <span>समस्त स्कूल होमवर्क ({homeworkList.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Layout: Left Side (Homework Cards) & Right Side (Interactive Student Roster Checker) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ============================================================== */}
        {/* LEFT COLUMN: HOMEWORK ASSIGNMENT SELECTOR (4 COLS) */}
        {/* ============================================================== */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
              <i className="fa-solid fa-book-open-reader text-amber-500"></i>
              <span>
                {filterMode === 'my_homework' ? 'मेरे द्वारा दिए गए होमवर्क' : 'स्कूल में दिए गए सभी होमवर्क'}
              </span>
            </h3>
            {onOpenUploadTab && (
              <button
                type="button"
                onClick={onOpenUploadTab}
                className="text-xs text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 hover:underline cursor-pointer"
              >
                <i className="fa-solid fa-plus text-[10px]"></i>
                <span>नया होमवर्क दें</span>
              </button>
            )}
          </div>

          {filteredHomeworkList.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto text-xl">
                <i className="fa-solid fa-book-open"></i>
              </div>
              <h4 className="font-bold text-slate-800 text-sm">अभी कोई होमवर्क असाइनमेंट नहीं मिला</h4>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                {filterMode === 'my_homework'
                  ? `आप (${currentUser.Name}) द्वारा अभी कोई होमवर्क पोस्ट नहीं किया गया है, या आप ऊपर 'समस्त स्कूल होमवर्क' चुन सकते हैं।`
                  : 'स्कूल में अभी कोई होमवर्क पोस्ट नहीं किया गया है।'}
              </p>
              {onOpenUploadTab && (
                <button
                  type="button"
                  onClick={onOpenUploadTab}
                  className="px-4 py-2 rounded-xl bg-[#0c2340] text-amber-300 font-bold text-xs hover:bg-slate-800 cursor-pointer shadow-sm"
                >
                  पहला होमवर्क अपलोड करें
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3 max-h-[750px] overflow-y-auto pr-1">
              {filteredHomeworkList.map((hw, idx) => {
                const isSelected = activeHomework?.Homework_ID === hw.Homework_ID;
                const hwClassTarget = getClassName(hw.Class).toLowerCase();
                const totalInClass = students.filter(
                  (s) => getClassName(s.Class).toLowerCase() === hwClassTarget
                ).length;

                return (
                  <div
                    key={hw.Homework_ID || idx}
                    onClick={() => {
                      handleOpenChecker(hw);
                    }}
                    className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden ${
                      isSelected
                        ? 'bg-amber-50/60 border-amber-500 shadow-md ring-2 ring-amber-400/40'
                        : 'bg-white border-slate-200 hover:border-amber-400 hover:shadow-sm'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute top-0 right-0 bg-amber-500 text-slate-950 font-black text-[10px] px-2.5 py-0.5 rounded-bl-xl shadow-2xs">
                        सक्रिय चेकर (Active)
                      </span>
                    )}

                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-[#0c2340] text-amber-300 font-bold text-xs">
                          कक्षा {getClassName(hw.Class)}
                        </span>
                        <span className="font-bold text-slate-900 text-xs sm:text-sm">
                          {hw.Subject}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-700 line-clamp-2 mt-1">
                      {hw.Homework_Detail}
                    </p>

                    <div className="flex items-center justify-between pt-2.5 mt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1 font-mono">
                        <i className="fa-regular fa-calendar text-slate-400"></i>
                        <span>{hw.Date}</span>
                      </span>

                      <span className="font-semibold text-slate-700">
                        शिक्षक: {hw.Teacher || 'Faculty'}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[11px] pt-1 gap-2">
                      <span className="text-emerald-700 font-bold flex items-center gap-1 shrink-0">
                        <i className="fa-solid fa-users text-[10px]"></i>
                        <span>{totalInClass} छात्र</span>
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenChecker(hw);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer ring-1 ring-amber-500/40"
                      >
                        <i className="fa-solid fa-list-check text-[11px]"></i>
                        <span>चेक करें</span>
                        <i className="fa-solid fa-chevron-right text-[10px]"></i>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* RIGHT COLUMN: 1-CLICK INTERACTIVE STUDENT ROSTER (7 COLS) */}
        {/* ============================================================== */}
        <div className="lg:col-span-7">
          {activeHomework ? (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-5">
              {/* Active Homework Header Details */}
              <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 p-4 rounded-2xl border border-blue-200/60 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-xl bg-blue-900 text-white font-black text-xs">
                      Class {getClassName(activeHomework.Class)}
                    </span>
                    <h3 className="font-black text-slate-900 text-base">
                      {activeHomework.Subject}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="text-xs font-mono font-bold text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                      तारीख: {activeHomework.Date}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCheckerModalOpen(true)}
                      className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs flex items-center gap-1 shadow-2xs cursor-pointer active:scale-95 transition-all"
                      title="पॉपअप चेकर खोलें"
                    >
                      <i className="fa-solid fa-expand text-[10px]"></i>
                      <span>पॉपअप</span>
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-800 bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs whitespace-pre-wrap">
                  <span className="font-bold text-slate-500 block mb-0.5 text-[10px] uppercase">
                    दिए गए होमवर्क का विवरण (Homework Detail):
                  </span>
                  {activeHomework.Homework_Detail}
                </div>

                {/* Progress Bar & Stats */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-700 flex items-center gap-1.5">
                      <i className="fa-solid fa-chart-line text-emerald-600"></i>
                      <span>होमवर्क प्रगति: {completedCount}/{totalClassCount} छात्र पूर्ण</span>
                    </span>
                    <span className="font-mono text-emerald-800 font-black">
                      {completionPercentage}% पूर्ण
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden shadow-inner">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        completionPercentage >= 90
                          ? 'bg-emerald-500'
                          : completionPercentage >= 50
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${completionPercentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Quick 1-Click Bulk Actions Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-amber-50/70 border border-amber-200/80 rounded-2xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                    <i className="fa-solid fa-bolt text-amber-600"></i>
                    <span>क्विक एक्शन:</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleMarkAllComplete}
                    disabled={classStudents.length === 0}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
                    title="पूरी कक्षा के सभी बच्चों को Complete मार्क करें"
                  >
                    <i className="fa-solid fa-check-double"></i>
                    <span>⚡ सभी को Complete करें</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleMarkAllIncomplete}
                    disabled={classStudents.length === 0}
                    className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold text-xs rounded-xl transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
                    title="पूरी कक्षा को Incomplete मार्क करें"
                  >
                    <i className="fa-solid fa-rotate-left text-[11px]"></i>
                    <span>सभी Incomplete</span>
                  </button>
                </div>
              </div>

              {/* Search & Student Status Filter Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="relative flex-1 max-w-sm">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="छात्र का नाम या रोल नंबर खोजें..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
                  />
                  {studentSearch && (
                    <button
                      onClick={() => setStudentSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setStudentStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      studentStatusFilter === 'all'
                        ? 'bg-[#0c2340] text-amber-300 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    सभी ({totalClassCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentStatusFilter('completed')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      studentStatusFilter === 'completed'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    पूर्ण ({completedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentStatusFilter('incompleted')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      studentStatusFilter === 'incompleted'
                        ? 'bg-rose-600 text-white shadow-2xs'
                        : 'text-rose-700 hover:bg-rose-50'
                    }`}
                  >
                    अपूर्ण ({incompletedCount})
                  </button>
                </div>
              </div>

              {/* Student Cards List with 1-Click Toggle */}
              {classStudents.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-500">
                  इस कक्षा में अभी कोई छात्र रिकॉर्ड उपलब्ध नहीं है।
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-2xl text-xs text-slate-500">
                  दिए गए फ़िल्टर से कोई छात्र मेल नहीं खाया।
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                  {filteredStudents.map(({ student, status, isCompleted }, index) => {
                    const photo = getStudentPhoto ? getStudentPhoto(student) : '';
                    return (
                      <div
                        key={student.Student_ID || index}
                        className={`p-3.5 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isCompleted
                            ? 'bg-emerald-50/40 border-emerald-300/80 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {/* Student Info */}
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            {photo ? (
                              <img
                                src={photo}
                                alt={student.Student_Name}
                                className="w-10 h-10 rounded-xl object-cover border border-slate-200 shadow-2xs shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-sm shadow-2xs shrink-0">
                                {student.Student_Name.charAt(0)}
                              </div>
                            )}
                            <span
                              className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-black ${
                                isCompleted ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                              }`}
                            >
                              {isCompleted ? '✓' : '✕'}
                            </span>
                          </div>

                          <div>
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                              <span>{student.Student_Name}</span>
                              {student.Roll_Number && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                                  Roll {student.Roll_Number}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              ID: {student.Student_ID}
                            </div>
                          </div>
                        </div>

                        {/* 1-Click Toggle Button */}
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          <span
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs inline-flex items-center gap-1.5 shadow-2xs ${
                              isCompleted
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                : 'bg-rose-100 text-rose-900 border border-rose-300'
                            }`}
                          >
                            <i className={`fa-solid ${isCompleted ? 'fa-check' : 'fa-xmark'}`}></i>
                            <span>{isCompleted ? 'Completed (पूर्ण)' : 'Incomplete (अपूर्ण)'}</span>
                          </span>

                          <button
                            type="button"
                            onClick={() => {
                              const nextStatus = isCompleted ? 'Incompleted' : 'Completed';
                              onSetStudentStatus(
                                student.Student_ID,
                                activeHomework.Date,
                                activeHomework.Class,
                                activeHomework.Subject,
                                nextStatus
                              );
                            }}
                            className={`px-4 py-2 rounded-xl font-bold text-xs transition-all shadow-sm cursor-pointer flex items-center gap-1.5 transform active:scale-95 ${
                              isCompleted
                                ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-500/30'
                            }`}
                            title="एक टच में स्थिति बदलें"
                          >
                            {isCompleted ? (
                              <>
                                <i className="fa-solid fa-rotate-left"></i>
                                <span>अपूर्ण करें</span>
                              </>
                            ) : (
                              <>
                                <i className="fa-solid fa-check"></i>
                                <span>✓ Complete मार्क करें</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-500 text-xs">
              कृपया बाईं ओर से कोई होमवर्क असाइनमेंट चुनें।
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* DEDICATED FULL-SCREEN INTERACTIVE HOMEWORK CHECKER MODAL */}
      {/* ============================================================== */}
      {isCheckerModalOpen && activeHomework && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-fadeIn">
          <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border-2 border-amber-400/50 overflow-hidden flex flex-col max-h-[95vh] my-auto">
            {/* Modal Top Bar */}
            <div className="bg-[#0c2340] text-white p-4 sm:p-5 flex items-center justify-between gap-3 border-b border-amber-400/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-lg font-black shrink-0 shadow-md">
                  <i className="fa-solid fa-list-check"></i>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg bg-amber-400 text-slate-950 font-black text-xs">
                      कक्षा {getClassName(activeHomework.Class)}
                    </span>
                    <h3 className="font-black text-base sm:text-lg text-white">
                      {activeHomework.Subject} होमवर्क चेकर
                    </h3>
                  </div>
                  <div className="text-xs text-amber-200/90 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span>📅 तारीख: {activeHomework.Date}</span>
                    <span>👤 शिक्षक: {activeHomework.Teacher || 'Faculty'}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsCheckerModalOpen(false)}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm font-black transition-all cursor-pointer shrink-0"
                title="बंद करें"
              >
                ✕
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
              {/* Homework Detail Card */}
              <div className="bg-gradient-to-br from-amber-50/70 to-blue-50/40 p-3.5 sm:p-4 rounded-2xl border border-amber-200/80 space-y-2">
                <div className="text-xs text-slate-800 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs whitespace-pre-wrap">
                  <span className="font-bold text-slate-500 block mb-0.5 text-[10px] uppercase tracking-wider">
                    गृहकार्य विवरण (Homework Detail):
                  </span>
                  {activeHomework.Homework_Detail}
                </div>

                {/* Progress Bar & Stats */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-slate-800 flex items-center gap-1.5">
                      <i className="fa-solid fa-chart-line text-emerald-600"></i>
                      <span>प्रगति: {completedCount}/{totalClassCount} छात्र पूर्ण</span>
                    </span>
                    <span className="font-mono text-emerald-800 font-black">
                      {completionPercentage}% पूर्ण
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden shadow-inner">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        completionPercentage >= 90
                          ? 'bg-emerald-500'
                          : completionPercentage >= 50
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${completionPercentage}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* 1-Click Fast Bulk Actions & Google Sheet Status */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <i className="fa-solid fa-bolt text-amber-500"></i>
                    <span>त्वरित एक्शन:</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleMarkAllComplete}
                    disabled={classStudents.length === 0}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    <i className="fa-solid fa-check-double"></i>
                    <span>सभी पूर्ण (All Complete)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMarkAllIncomplete}
                    disabled={classStudents.length === 0}
                    className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold text-xs rounded-xl shadow-2xs flex items-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    <i className="fa-solid fa-rotate-left"></i>
                    <span>सभी अपूर्ण (Reset)</span>
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                  <i className="fa-solid fa-cloud-arrow-up text-emerald-600"></i>
                  <span>Google Sheet ऑटो सिंक चालू</span>
                </div>
              </div>

              {/* Search & Status Filters */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1">
                <div className="relative flex-1">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={(e) => setStudentSearch(e.target.value)}
                    placeholder="छात्र का नाम या रोल नंबर खोजें..."
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
                  />
                  {studentSearch && (
                    <button
                      onClick={() => setStudentSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs shrink-0">
                  <button
                    type="button"
                    onClick={() => setStudentStatusFilter('all')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      studentStatusFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    सभी ({totalClassCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentStatusFilter('completed')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      studentStatusFilter === 'completed'
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    पूर्ण ({completedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentStatusFilter('incompleted')}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      studentStatusFilter === 'incompleted'
                        ? 'bg-rose-600 text-white shadow-2xs'
                        : 'text-rose-700 hover:bg-rose-50'
                    }`}
                  >
                    अपूर्ण ({incompletedCount})
                  </button>
                </div>
              </div>

              {/* Student Cards List */}
              {classStudents.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-500">
                  इस कक्षा में अभी कोई छात्र रिकॉर्ड उपलब्ध नहीं है।
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-2xl text-xs text-slate-500">
                  खोज से कोई छात्र मेल नहीं खाया।
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {filteredStudents.map(({ student, status, isCompleted }, index) => {
                    const photo = getStudentPhoto ? getStudentPhoto(student) : '';
                    const parentPhone = String(student.Parent_Mobile || '').replace(/\D/g, '');

                    return (
                      <div
                        key={student.Student_ID || index}
                        className={`p-3.5 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isCompleted
                            ? 'bg-emerald-50/50 border-emerald-300 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-amber-300'
                        }`}
                      >
                        {/* Student Info */}
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            {photo ? (
                              <img
                                src={photo}
                                alt={student.Student_Name}
                                className="w-11 h-11 rounded-xl object-cover border border-slate-200 shadow-2xs shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded-xl bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-sm shadow-2xs shrink-0">
                                {student.Student_Name.charAt(0)}
                              </div>
                            )}
                            <span
                              className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center text-[8px] font-black ${
                                isCompleted ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                              }`}
                            >
                              {isCompleted ? '✓' : '✕'}
                            </span>
                          </div>

                          <div>
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                              <span>{student.Student_Name}</span>
                              {student.Roll_Number && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-mono font-bold">
                                  Roll {student.Roll_Number}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>ID: {student.Student_ID}</span>
                              {student.Father_Name && (
                                <span>• पिता: {student.Father_Name}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Badge & 1-Click Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto shrink-0">
                          <span
                            className={`px-3 py-1.5 rounded-xl font-black text-xs inline-flex items-center gap-1.5 shadow-2xs ${
                              isCompleted
                                ? 'bg-emerald-100 text-emerald-950 border border-emerald-300'
                                : 'bg-rose-100 text-rose-950 border border-rose-300'
                            }`}
                          >
                            <i className={`fa-solid ${isCompleted ? 'fa-check' : 'fa-xmark'}`}></i>
                            <span>{isCompleted ? 'Complete (पूर्ण)' : 'Incomplete (अपूर्ण)'}</span>
                          </span>

                          <button
                            type="button"
                            onClick={() => {
                              const nextStatus = isCompleted ? 'Incompleted' : 'Completed';
                              onSetStudentStatus(
                                student.Student_ID,
                                activeHomework.Date,
                                activeHomework.Class,
                                activeHomework.Subject,
                                nextStatus
                              );
                            }}
                            className={`px-4 py-2 rounded-xl font-black text-xs transition-all shadow-sm cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                              isCompleted
                                ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20'
                            }`}
                          >
                            {isCompleted ? (
                              <>
                                <i className="fa-solid fa-rotate-left"></i>
                                <span>अपूर्ण करें</span>
                              </>
                            ) : (
                              <>
                                <i className="fa-solid fa-check"></i>
                                <span>✓ Complete मार्क करें</span>
                              </>
                            )}
                          </button>

                          {!isCompleted && parentPhone && (
                            <a
                              href={`https://wa.me/91${parentPhone}?text=${encodeURIComponent(
                                `अस्सलाम वालेकुम! E.V.S. Public School से सूचना: आज दिनांक ${activeHomework.Date} को कक्षा ${getClassName(activeHomework.Class)} में दिए गए ${activeHomework.Subject} का होमवर्क (${activeHomework.Homework_Detail}) ${student.Student_Name} द्वारा पूरा नहीं किया गया है। कृपया बच्चे का कार्य पूरा करवाएं।`
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold text-xs flex items-center gap-1 transition-all"
                              title="माता-पिता को WhatsApp संदेश भेजें"
                            >
                              <i className="fa-brands fa-whatsapp text-emerald-600"></i>
                              <span>अलर्ट</span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Modal Bottom Done Bar */}
            <div className="bg-slate-50 p-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-medium">
                सभी बदलाव सीधे ऐप और Google Sheet में सेव हो रहे हैं।
              </span>
              <button
                type="button"
                onClick={() => setIsCheckerModalOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 font-black text-xs shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-2"
              >
                <i className="fa-solid fa-circle-check"></i>
                <span>चेक पूरा हुआ (Done)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

