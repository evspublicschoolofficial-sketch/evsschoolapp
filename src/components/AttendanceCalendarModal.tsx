import React, { useState, useMemo } from 'react';
import { Student, StudentBehaviorRecord, SchoolHolidayRecord } from '../types';

interface AttendanceCalendarModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  selectedStudent?: Student | null;
  allStudents?: Student[];
  behaviorRecords?: StudentBehaviorRecord[];
  initialMode?: 'calendar' | 'absent_list';
  schoolName?: string;
  onSelectStudent?: (student: Student) => void;
  embedded?: boolean;
  isParentView?: boolean;
}

// Helper to normalize any date string to YYYY-MM-DD
const normalizeDateToYmd = (dateInput: string): string => {
  if (!dateInput) return '';
  const trimmed = String(dateInput).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  const parts = trimmed.split(/[-/.]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }
  return trimmed;
};

export const AttendanceCalendarModal: React.FC<AttendanceCalendarModalProps> = ({
  isOpen = true,
  onClose,
  selectedStudent,
  allStudents = [],
  behaviorRecords = [],
  initialMode = 'calendar',
  schoolName = 'E.V.S. PUBLIC SCHOOL',
  onSelectStudent,
  embedded = false,
  isParentView = false,
}) => {
  const [activeMode, setActiveMode] = useState<'calendar' | 'absent_list'>(isParentView ? 'calendar' : initialMode);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [calendarClassFilter, setCalendarClassFilter] = useState<string>('All');
  const [selectedDayDetail, setSelectedDayDetail] = useState<{
    dateStr: string;
    record?: StudentBehaviorRecord;
    isSunday: boolean;
    holiday?: SchoolHolidayRecord | null;
  } | null>(null);

  // School Holidays State (Sunday ke alawa chhuttiyan)
  const [holidays, setHolidays] = useState<SchoolHolidayRecord[]>([]);
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState<boolean>(false);
  const [holidayTitle, setHolidayTitle] = useState<string>('');
  const [holidayDate, setHolidayDate] = useState<string>('');
  const [holidayEndDate, setHolidayEndDate] = useState<string>('');
  const [holidayCategory, setHolidayCategory] = useState<'festival' | 'national' | 'weather' | 'order' | 'vacation'>('festival');
  const [holidayDescription, setHolidayDescription] = useState<string>('');
  const [holidaySyncMsg, setHolidaySyncMsg] = useState<string | null>(null);

  // Fetch school holidays on mount
  React.useEffect(() => {
    fetch('/api/school-holidays')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) {
          setHolidays(data);
        }
      })
      .catch(() => {});
  }, []);

  const getHolidayForDate = (dateYmd: string): SchoolHolidayRecord | null => {
    for (const h of holidays) {
      if (!h.date) continue;
      if (h.date === dateYmd) return h;
      if (h.end_date && dateYmd >= h.date && dateYmd <= h.end_date) {
        return h;
      }
    }
    return null;
  };

  const handleSaveHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayTitle.trim() || !holidayDate) return;

    const newHoliday: SchoolHolidayRecord = {
      id: `hol_${holidayDate.replace(/-/g, '_')}_${Date.now()}`,
      title: holidayTitle.trim(),
      date: holidayDate,
      end_date: holidayEndDate ? holidayEndDate : undefined,
      category: holidayCategory,
      description: holidayDescription.trim() || undefined,
      created_at: new Date().toISOString(),
    };

    const updated = [...holidays, newHoliday].sort((a, b) => a.date.localeCompare(b.date));
    setHolidays(updated);

    try {
      await fetch('/api/school-holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHoliday),
      });
      setHolidaySyncMsg('✅ अवकाश सफलतापूर्वक कैलेंडर व Google Sheet में सुरक्षित!');
      setTimeout(() => setHolidaySyncMsg(null), 3500);
    } catch {}

    setHolidayTitle('');
    setHolidayDate('');
    setHolidayEndDate('');
    setHolidayDescription('');
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm('क्या आप इस अवकाश को हटाना चाहते हैं?')) return;
    const filtered = holidays.filter((h) => h.id !== id);
    setHolidays(filtered);
    try {
      await fetch(`/api/school-holidays/${id}`, { method: 'DELETE' });
      setHolidaySyncMsg('अवकाश हटा दिया गया');
      setTimeout(() => setHolidaySyncMsg(null), 3000);
    } catch {}
  };

  // Sync mode if initialMode changes
  React.useEffect(() => {
    if (isParentView) {
      setActiveMode('calendar');
    } else if (initialMode) {
      setActiveMode(initialMode);
    }
  }, [initialMode, isOpen, isParentView]);

  // Filter for Absent List tab
  const [absentDateStr, setAbsentDateStr] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [absentClassFilter, setAbsentClassFilter] = useState<string>('All');
  const [activeStudentId, setActiveStudentId] = useState<string>(() => selectedStudent?.Student_ID || '');

  // Keep active student synced if selectedStudent or allStudents change
  React.useEffect(() => {
    if (selectedStudent?.Student_ID) {
      setActiveStudentId(selectedStudent.Student_ID);
    } else if (allStudents.length > 0 && !activeStudentId) {
      setActiveStudentId(allStudents[0].Student_ID);
    }
  }, [selectedStudent, allStudents, isOpen]);

  if (!isOpen && !embedded) return null;

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth(); // 0-indexed

  const monthNamesHindi = [
    'जनवरी (January)',
    'फ़रवरी (February)',
    'मार्च (March)',
    'अप्रैल (April)',
    'मई (May)',
    'जून (June)',
    'जुलाई (July)',
    'अगस्त (August)',
    'सितंबर (September)',
    'अक्टूबर (October)',
    'नवंबर (November)',
    'दिसंबर (December)',
  ];

  // Filter students based on calendarClassFilter
  const filteredStudents = useMemo(() => {
    return allStudents.filter(
      (s) => calendarClassFilter === 'All' || String(s.Class).trim() === calendarClassFilter
    );
  }, [allStudents, calendarClassFilter]);

  // Resolve target student
  const effectiveStudent =
    filteredStudents.find((s) => s.Student_ID === activeStudentId) ||
    allStudents.find((s) => s.Student_ID === activeStudentId) ||
    (selectedStudent && (calendarClassFilter === 'All' || String(selectedStudent.Class).trim() === calendarClassFilter) ? selectedStudent : null) ||
    filteredStudents[0] ||
    allStudents[0] ||
    null;

  React.useEffect(() => {
    if (effectiveStudent?.Student_ID && activeStudentId !== effectiveStudent.Student_ID) {
      setActiveStudentId(effectiveStudent.Student_ID);
    }
  }, [effectiveStudent?.Student_ID]);

  // Filter behavior records for the active student
  const studentRecords = useMemo(() => {
    if (!effectiveStudent?.Student_ID) return [];
    const id = String(effectiveStudent.Student_ID).toLowerCase().trim();
    return behaviorRecords.filter(
      (b) => String(b.Student_ID || '').toLowerCase().trim() === id
    );
  }, [behaviorRecords, effectiveStudent?.Student_ID]);

  // Index student records by YYYY-MM-DD or DD/MM/YYYY or parsed date
  const recordsByDate = useMemo(() => {
    const map = new Map<string, StudentBehaviorRecord>();
    for (const rec of studentRecords) {
      if (!rec.Date) continue;
      const raw = String(rec.Date).trim();
      map.set(raw, rec);

      const ymd = normalizeDateToYmd(raw);
      if (ymd) {
        map.set(ymd, rec);
        const [y, m, d] = ymd.split('-');
        map.set(`${d}/${m}/${y}`, rec);
        map.set(`${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`, rec);
        map.set(`${d}-${m}-${y}`, rec);
      }
    }
    return map;
  }, [studentRecords]);

  // Build calendar days for the selected month
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const startingDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // 0 = Mon, 6 = Sun

  // Month Statistics
  let presentDaysCount = 0;
  let absentDaysCount = 0;
  let sundaysCount = 0;
  let holidaysCount = 0;

  const calendarDays = [];
  // Pad blank days before the 1st
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(currentYear, currentMonth, day);
    const dayOfWeek = dayDate.getDay(); // 0 is Sunday
    const isSunday = dayOfWeek === 0;

    const key1 = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const key2 = `${String(day).padStart(2, '0')}/${String(currentMonth + 1).padStart(2, '0')}/${currentYear}`;
    const key3 = `${day}/${currentMonth + 1}/${currentYear}`;

    const record = recordsByDate.get(key1) || recordsByDate.get(key2) || recordsByDate.get(key3);
    const holiday = getHolidayForDate(key1);

    let status: 'present' | 'absent' | 'sunday' | 'holiday' | 'unmarked' = 'unmarked';

    if (isSunday) {
      status = 'sunday';
      sundaysCount++;
    } else if (holiday) {
      status = 'holiday';
      holidaysCount++;
    } else if (record) {
      if (record.Is_Present) {
        status = 'present';
        presentDaysCount++;
      } else {
        status = 'absent';
        absentDaysCount++;
      }
    }

    calendarDays.push({
      day,
      date: dayDate,
      dateKey: key1,
      isSunday,
      record,
      status,
      holiday,
    });
  }

  const workingDays = presentDaysCount + absentDaysCount;
  const attendancePercentage = workingDays > 0 ? ((presentDaysCount / workingDays) * 100).toFixed(1) : '100.0';

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth - 1, 1));
    setSelectedDayDetail(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentYear, currentMonth + 1, 1));
    setSelectedDayDetail(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setSelectedDayDetail(null);
  };

  // --- Absent List Logic (For Teacher / Manager) ---
  const absentStudentsToday = useMemo(() => {
    if (!absentDateStr) return [];
    const targetYmd = normalizeDateToYmd(absentDateStr);

    // Find records matching absentDateStr
    return allStudents.filter((student) => {
      if (absentClassFilter !== 'All' && String(student.Class).trim() !== absentClassFilter) {
        return false;
      }

      const sId = String(student.Student_ID).toLowerCase().trim();
      const rec = behaviorRecords.find((b) => {
        const matchesStudent = String(b.Student_ID || '').toLowerCase().trim() === sId;
        if (!matchesStudent) return false;

        const bDate = String(b.Date || '').trim();
        const bYmd = normalizeDateToYmd(bDate);
        return bYmd === targetYmd || bDate === absentDateStr;
      });

      // If record exists and Is_Present is false
      return Boolean(rec && !rec.Is_Present);
    });
  }, [allStudents, behaviorRecords, absentDateStr, absentClassFilter]);

  // WhatsApp Alert for Absent Student
  const handleSendAbsentWhatsApp = (student: Student) => {
    const parentMobile = String(student.Parent_Mobile || '').replace(/\D/g, '');
    const message =
      `*🏛️ ${schoolName}*\n` +
      `*छात्र अनुपस्थिति अलर्ट (Student Absence Alert)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `आदरणीय अभिभावक,\n` +
      `आपका बच्चा *${student.Student_Name}*\n` +
      `कक्षा: *${student.Class}* | रोल नं: *${student.Roll_Number || '1'}*\n` +
      `आईडी: *${student.Student_ID}*\n\n` +
      `आज दिनांक *${absentDateStr}* को स्कूल में *अनुपस्थित (ABSENT)* दर्ज किया गया है।\n\n` +
      `यदि बच्चा किसी आवश्यक कार्य या अस्वस्थता के कारण अनुपस्थित है, तो कृपया स्कूल को सूचित करें।\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_ई.वी.एस. पब्लिक स्कूल प्रशासन_`;

    const encoded = encodeURIComponent(message);
    const waUrl = parentMobile.length >= 10
      ? `https://wa.me/91${parentMobile.slice(-10)}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
  };

  const uniqueClasses = useMemo(() => {
    const set = new Set<string>();
    allStudents.forEach((s) => {
      if (s.Class) set.add(String(s.Class).trim());
    });
    return Array.from(set).sort();
  }, [allStudents]);

  const calendarBody = (
    <div className={`relative w-full ${embedded ? 'bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden' : 'max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto flex flex-col max-h-[92vh]'}`}>
      {/* Modal / Component Header */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-lg shadow-md">
            <i className="fa-solid fa-calendar-check"></i>
          </span>
          <div>
            <h3 className="font-black text-base sm:text-lg text-amber-300">
              {isParentView
                ? 'छात्र उपस्थिति कैलेंडर (Student Attendance Calendar)'
                : 'उपस्थिति प्रबंधन (Attendance Calendar & Absent Alert)'}
            </h3>
            <p className="text-xs text-blue-200">
              {isParentView
                ? 'मासिक हाजिरी रिपोर्ट एवं उपस्थिति स्थिति'
                : 'मासिक हाजिरी कैलेंडर व अनुपस्थित बच्चों के लिए 1-क्लिक WhatsApp अलर्ट'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Holiday manager button (Accessible to School Admin / Teachers) */}
          {!isParentView && (
            <button
              type="button"
              onClick={() => setIsHolidayModalOpen(true)}
              className="px-3 py-1.5 rounded-xl font-black text-xs bg-amber-400 hover:bg-amber-300 text-slate-950 flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
              title="रविवार के अलावा त्योहार, शीतकालीन व सरकारी छुट्टियां जोड़ें"
            >
              <span className="text-sm">🌴</span>
              <span className="hidden sm:inline">छुट्टियां जोड़ें / देखें</span>
              <span className="sm:hidden">छुट्टियां</span>
            </button>
          )}

          {/* Tab switch buttons (Only for Teachers / Managers, hidden for Parents) */}
          {!isParentView && (
            <div className="bg-white/10 p-1 rounded-xl flex items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveMode('calendar')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  activeMode === 'calendar'
                    ? 'bg-amber-400 text-slate-950 shadow-sm'
                    : 'text-white hover:bg-white/10'
                }`}
              >
                <i className="fa-solid fa-calendar-days mr-1.5"></i>
                <span>मासिक कैलेंडर</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('absent_list')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                  activeMode === 'absent_list'
                    ? 'bg-rose-500 text-white shadow-sm'
                    : 'text-white hover:bg-white/10'
                }`}
              >
                <i className="fa-solid fa-user-xmark mr-1.5"></i>
                <span>अनुपस्थित अलर्ट</span>
              </button>
            </div>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {activeMode === 'calendar' ? (
            /* ================= MODE 1: MONTHLY CALENDAR ================= */
            <div className="space-y-5">
              {/* Student Selector (If multiple students available) */}
              {allStudents.length > 1 && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <i className="fa-solid fa-user-graduate text-blue-900"></i>
                    <span>{isParentView ? 'बच्चा चुनें (Select Child):' : 'छात्र चुनें (Select Student):'}</span>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    {!isParentView && uniqueClasses.length > 1 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-bold text-slate-500">कक्षा:</span>
                        <select
                          value={calendarClassFilter}
                          onChange={(e) => {
                            const newClass = e.target.value;
                            setCalendarClassFilter(newClass);
                            const match = allStudents.find(
                              (s) => newClass === 'All' || String(s.Class).trim() === newClass
                            );
                            if (match) {
                              setActiveStudentId(match.Student_ID);
                              if (onSelectStudent) onSelectStudent(match);
                            }
                          }}
                          className="px-2.5 py-1 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer"
                        >
                          <option value="All">सभी कक्षाएं (All)</option>
                          {uniqueClasses.map((c) => (
                            <option key={c} value={c}>Class {c}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <select
                      value={activeStudentId}
                      onChange={(e) => {
                        setActiveStudentId(e.target.value);
                        const s = allStudents.find((st) => st.Student_ID === e.target.value);
                        if (s && onSelectStudent) onSelectStudent(s);
                      }}
                      className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-hidden cursor-pointer max-w-xs truncate"
                    >
                      {allStudents
                        .filter((s) => isParentView || calendarClassFilter === 'All' || String(s.Class).trim() === calendarClassFilter)
                        .map((s) => (
                          <option key={s.Student_ID} value={s.Student_ID}>
                            {s.Student_Name} ({s.Class} • Roll: {s.Roll_Number || '1'} • ID: {s.Student_ID})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Month Navigation & Stats Summary */}
              <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 border border-slate-200 rounded-2xl p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePrevMonth}
                      className="w-9 h-9 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold text-sm cursor-pointer shadow-2xs"
                    >
                      ‹
                    </button>
                    <h4 className="text-base sm:text-lg font-black text-slate-900 min-w-44 text-center">
                      {monthNamesHindi[currentMonth]} {currentYear}
                    </h4>
                    <button
                      type="button"
                      onClick={handleNextMonth}
                      className="w-9 h-9 rounded-xl bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center font-bold text-sm cursor-pointer shadow-2xs"
                    >
                      ›
                    </button>
                    <button
                      type="button"
                      onClick={handleToday}
                      className="ml-2 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-100 cursor-pointer shadow-2xs"
                    >
                      आज (Today)
                    </button>
                    {!isParentView && (
                      <button
                        type="button"
                        onClick={() => setIsHolidayModalOpen(true)}
                        className="ml-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 text-xs font-black shadow-xs cursor-pointer flex items-center gap-1.5 transition-all"
                        title="रविवार के अलावा स्कूल छुट्टियाँ व त्योहार अवकाश जोड़ें"
                      >
                        <i className="fa-solid fa-calendar-plus text-slate-950"></i>
                        <span>🌴 अवकाश जोड़ें / कैलेंडर</span>
                      </button>
                    )}
                  </div>

                  {effectiveStudent && (
                    <div className="text-xs text-right">
                      <span className="font-extrabold text-slate-900 text-sm block">
                        {effectiveStudent.Student_Name}
                      </span>
                      <span className="text-slate-500">
                        Class: <strong>{effectiveStudent.Class}</strong> • Roll: <strong>{effectiveStudent.Roll_Number || '1'}</strong>
                      </span>
                    </div>
                  )}
                </div>

                {/* 5 Stat Badges */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-3 text-center shadow-2xs">
                    <div className="text-[11px] font-bold text-slate-500 uppercase">कुल कार्यदिवस</div>
                    <div className="text-xl font-black text-slate-900 mt-0.5">{workingDays} दिन</div>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center shadow-2xs">
                    <div className="text-[11px] font-bold text-emerald-800 uppercase">उपस्थित (Present)</div>
                    <div className="text-xl font-black text-emerald-900 mt-0.5">{presentDaysCount} दिन</div>
                  </div>
                  <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center shadow-2xs">
                    <div className="text-[11px] font-bold text-rose-800 uppercase">अनुपस्थित (Absent)</div>
                    <div className="text-xl font-black text-rose-900 mt-0.5">{absentDaysCount} दिन</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-center shadow-2xs">
                    <div className="text-[11px] font-bold text-amber-800 uppercase">🌴 स्कूल अवकाश</div>
                    <div className="text-xl font-black text-amber-900 mt-0.5">{holidaysCount} दिन</div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center shadow-2xs col-span-2 sm:col-span-1">
                    <div className="text-[11px] font-bold text-blue-900 uppercase">हाजिरी प्रतिशत</div>
                    <div className="text-xl font-black text-blue-950 mt-0.5">{attendancePercentage}%</div>
                  </div>
                </div>
              </div>

              {/* 7-Days Calendar Grid */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2 text-center text-xs font-black text-slate-500">
                  <div className="py-1">सोम (Mon)</div>
                  <div className="py-1">मंगल (Tue)</div>
                  <div className="py-1">बुध (Wed)</div>
                  <div className="py-1">गुरु (Thu)</div>
                  <div className="py-1">शुक्र (Fri)</div>
                  <div className="py-1">शनि (Sat)</div>
                  <div className="py-1 text-rose-600">रवि (Sun)</div>
                </div>

                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                  {calendarDays.map((item, index) => {
                    if (!item) {
                      return (
                        <div
                          key={`empty-${index}`}
                          className="h-14 sm:h-16 rounded-xl bg-slate-50/50 border border-dashed border-slate-100"
                        />
                      );
                    }

                    const { day, isSunday, record, status, dateKey } = item;
                    const isSelected = selectedDayDetail?.dateStr === dateKey;

                    return (
                      <div
                        key={dateKey}
                        onClick={() =>
                          setSelectedDayDetail({
                            dateStr: dateKey,
                            record,
                            isSunday,
                            holiday: item.holiday,
                          })
                        }
                        className={`h-14 sm:h-16 rounded-xl p-1.5 flex flex-col justify-between transition-all cursor-pointer border select-none ${
                          isSelected
                            ? 'ring-2 ring-blue-900 shadow-md'
                            : ''
                        } ${
                          status === 'present'
                            ? 'bg-emerald-50/90 border-emerald-300 hover:bg-emerald-100 text-emerald-950'
                            : status === 'absent'
                            ? 'bg-rose-50/90 border-rose-300 hover:bg-rose-100 text-rose-950'
                            : status === 'sunday'
                            ? 'bg-slate-100 border-slate-200 text-slate-400'
                            : status === 'holiday'
                            ? 'bg-amber-100/90 border-amber-300 hover:bg-amber-200/90 text-amber-950 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-xs font-black ${
                              isSunday ? 'text-rose-500' : status === 'holiday' ? 'text-amber-800' : 'text-slate-900'
                            }`}
                          >
                            {day}
                          </span>
                          {status === 'present' && (
                            <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[9px] font-bold">
                              ✓
                            </span>
                          )}
                          {status === 'absent' && (
                            <span className="w-4 h-4 rounded-full bg-rose-600 text-white flex items-center justify-center text-[9px] font-bold">
                              ✕
                            </span>
                          )}
                          {status === 'holiday' && (
                            <span className="w-4 h-4 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center text-[9px] font-black" title={item.holiday?.title}>
                              🌴
                            </span>
                          )}
                        </div>

                        <div className="text-[10px] font-extrabold truncate">
                          {status === 'present' && (
                            <span className="text-emerald-800">उपस्थित</span>
                          )}
                          {status === 'absent' && (
                            <span className="text-rose-700">छुट्टी / नहीं आए</span>
                          )}
                          {status === 'sunday' && (
                            <span className="text-slate-400">रविवार</span>
                          )}
                          {status === 'holiday' && (
                            <span className="text-amber-900 font-black truncate block text-[9px]" title={item.holiday?.title}>
                              🌴 {item.holiday?.title || 'अवकाश'}
                            </span>
                          )}
                          {status === 'unmarked' && (
                            <span className="text-slate-300">—</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Day Detail Card (When clicked) */}
              {selectedDayDetail && (
                <div className="p-4 bg-amber-50/80 border border-amber-300 rounded-2xl animate-fadeIn text-xs text-slate-900 space-y-2">
                  <div className="flex items-center justify-between font-bold border-b border-amber-200 pb-2">
                    <span className="text-sm font-black text-[#0c2340]">
                      📅 दिनांक: {selectedDayDetail.dateStr} का विवरण
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-black text-xs ${
                        selectedDayDetail.isSunday
                          ? 'bg-slate-200 text-slate-700'
                          : selectedDayDetail.holiday
                          ? 'bg-amber-400 text-slate-950'
                          : selectedDayDetail.record?.Is_Present
                          ? 'bg-emerald-600 text-white'
                          : selectedDayDetail.record
                          ? 'bg-rose-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {selectedDayDetail.isSunday
                        ? 'रविवार (Sunday Off)'
                        : selectedDayDetail.holiday
                        ? `🌴 ${selectedDayDetail.holiday.title}`
                        : selectedDayDetail.record?.Is_Present
                        ? 'उपस्थित (Present)'
                        : selectedDayDetail.record
                        ? 'अनुपस्थित (Absent)'
                        : 'हाजिरी दर्ज नहीं है'}
                    </span>
                  </div>

                  {selectedDayDetail.holiday && (
                    <div className="p-3 bg-amber-100/90 rounded-xl border border-amber-300 text-amber-950 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🌴</span>
                        <strong className="text-xs font-black">
                          स्कूल अवकाश: {selectedDayDetail.holiday.title}
                        </strong>
                      </div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        {selectedDayDetail.holiday.description || 'इस दिन स्कूल में सार्वजनिक/त्योहार अवकाश घोषित रहा। छात्रों की अनुपस्थिति नहीं गिनी गई।'}
                      </p>
                    </div>
                  )}

                  {selectedDayDetail.record ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                      <div className="p-2 bg-white rounded-xl border border-amber-200">
                        <span className="text-slate-500 block text-[10px]">वर्दी (Uniform):</span>
                        <strong className={selectedDayDetail.record.Uniform_clean ? 'text-emerald-700' : 'text-rose-700'}>
                          {selectedDayDetail.record.Uniform_clean ? '✓ साफ़ (Clean)' : '✕ अस्वच्छ'}
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-amber-200">
                        <span className="text-slate-500 block text-[10px]">नाखून (Nails):</span>
                        <strong className={selectedDayDetail.record.Nails_Clean ? 'text-emerald-700' : 'text-rose-700'}>
                          {selectedDayDetail.record.Nails_Clean ? '✓ कटे हुए (Trimmed)' : '✕ गंदे'}
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-amber-200">
                        <span className="text-slate-500 block text-[10px]">अनुशासन (Discipline):</span>
                        <strong className={selectedDayDetail.record.Discipline ? 'text-emerald-700' : 'text-rose-700'}>
                          {selectedDayDetail.record.Discipline ? '✓ उत्तम (Good)' : '✕ ध्यान देने योग्य'}
                        </strong>
                      </div>
                      <div className="p-2 bg-white rounded-xl border border-amber-200">
                        <span className="text-slate-500 block text-[10px]">शिक्षक टिप्पणी (Remark):</span>
                        <strong className="text-slate-800 truncate block">
                          {selectedDayDetail.record.Remark || 'नियमित (Regular)'}
                        </strong>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-600 text-xs italic">
                      इस दिन कोई व्यवहार या अनुपस्थिति टिप्पणी दर्ज नहीं की गई है।
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ================= MODE 2: ABSENT STUDENTS & WHATSAPP ================= */
            <div className="space-y-4">
              <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="font-black text-sm sm:text-base text-rose-950 flex items-center gap-2">
                    <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                    <span>अनुपस्थित छात्र सूची व अभिभावक WhatsApp अलर्ट</span>
                  </h4>
                  <p className="text-xs text-rose-800 mt-0.5">
                    आज या किसी भी तारीख को अनुपस्थित छात्रों के माता-पिता को 1-क्लिक में आधिकारिक WhatsApp मेसेज भेजें।
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">तारीख (Date):</label>
                    <input
                      type="date"
                      value={absentDateStr}
                      onChange={(e) => setAbsentDateStr(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-0.5">कक्षा फ़िल्टर (Class):</label>
                    <select
                      value={absentClassFilter}
                      onChange={(e) => setAbsentClassFilter(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-800 focus:outline-hidden cursor-pointer"
                    >
                      <option value="All">सभी कक्षाएं (All)</option>
                      {uniqueClasses.map((c) => (
                        <option key={c} value={c}>Class {c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Absent List */}
              {absentStudentsToday.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-6">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl mx-auto mb-2">
                    <i className="fa-solid fa-circle-check"></i>
                  </div>
                  <h5 className="font-extrabold text-sm text-slate-800">
                    इस तारीख ({absentDateStr}) पर कोई छात्र अनुपस्थित नहीं मिला!
                  </h5>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    सभी छात्र उपस्थित हैं अथवा इस तिथि के लिए अभी Google Sheet में हाजिरी दर्ज नहीं की गई है।
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
                    <span>कुल अनुपस्थित छात्र: <strong className="text-rose-600">{absentStudentsToday.length}</strong></span>
                    <span>1-क्लिक अलर्ट बटन दबाएं</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {absentStudentsToday.map((student) => (
                      <div
                        key={student.Student_ID}
                        className="bg-white border border-rose-200 rounded-2xl p-3.5 shadow-2xs hover:shadow-md transition-shadow flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <h5 className="font-black text-sm text-slate-900 truncate">
                            {student.Student_Name}
                          </h5>
                          <p className="text-xs text-slate-600">
                            कक्षा: <strong className="text-blue-900">{student.Class}</strong> • रोल नं: <strong>{student.Roll_Number || '1'}</strong>
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                            ID: {student.Student_ID} • मो: {student.Parent_Mobile || 'N/A'}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSendAbsentWhatsApp(student)}
                          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0 transition-transform active:scale-95"
                          title="अभिभावक को WhatsApp अनुपस्थिति अलर्ट भेजें"
                        >
                          <i className="fa-brands fa-whatsapp text-sm"></i>
                          <span>अलर्ट भेजें</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>
            {schoolName} • {isParentView ? 'छात्र उपस्थिति कैलेंडर' : 'आधिकारिक उपस्थिति व व्यवहार ट्रैकर'}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold cursor-pointer transition-colors"
            >
              बंद करें (Close)
            </button>
          )}
        </div>
      </div>
  );

  const holidayModal = isHolidayModalOpen ? (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsHolidayModalOpen(false);
      }}
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-fadeIn"
    >
      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-amber-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700 px-6 py-4 text-slate-950 flex items-center justify-between shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-slate-950 text-amber-400 flex items-center justify-center font-black text-xl shadow-md">
              🌴
            </span>
            <div>
              <h3 className="font-black text-base sm:text-lg text-slate-950">
                स्कूल अवकाश व छुट्टियां प्रबंधन (School Holiday Calendar)
              </h3>
              <p className="text-xs text-amber-950 font-medium">
                रविवार के अतिरिक्त त्योहार, मौसम (शीतकालीन/ग्रीष्मकालीन) व डीएम आदेश अवकाश दर्ज करें।
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsHolidayModalOpen(false)}
            className="w-9 h-9 rounded-xl bg-slate-950/20 hover:bg-slate-950/30 text-slate-950 flex items-center justify-center font-black cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Sync notification */}
        {holidaySyncMsg && (
          <div className="px-6 py-2 bg-emerald-500 text-white text-xs font-black flex items-center justify-between animate-fadeIn">
            <span>{holidaySyncMsg}</span>
            <span className="text-[10px] bg-emerald-700/60 px-2 py-0.5 rounded">Google Sheets Synchronized</span>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Form Column */}
            <div className="lg:col-span-5 bg-amber-50/60 border border-amber-200 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-amber-200 pb-2">
                <span className="text-amber-800 font-black text-sm">➕ नया अवकाश जोड़ें</span>
              </div>

              <form onSubmit={handleSaveHoliday} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-black text-slate-800 mb-1">
                    अवकाश का नाम (Holiday Title) *
                  </label>
                  <input
                    type="text"
                    required
                    value={holidayTitle}
                    onChange={(e) => setHolidayTitle(e.target.value)}
                    placeholder="उदा. दीपावली अवकाश, ईद, शीतकालीन अवकाश"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block font-black text-slate-800 mb-1">
                      तारीख (Date) *
                    </label>
                    <input
                      type="date"
                      required
                      value={holidayDate}
                      onChange={(e) => setHolidayDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block font-black text-slate-800 mb-1">
                      अंतिम तारीख (Optional)
                    </label>
                    <input
                      type="date"
                      value={holidayEndDate}
                      onChange={(e) => setHolidayEndDate(e.target.value)}
                      placeholder="यदि कई दिनों का अवकाश हो"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-black text-slate-800 mb-1">
                    श्रेणी (Category)
                  </label>
                  <select
                    value={holidayCategory}
                    onChange={(e) => setHolidayCategory(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="festival">त्योहार (Festival)</option>
                    <option value="national">राष्ट्रीय पर्व (National Holiday)</option>
                    <option value="weather">मौसम / शीतकालीन / ग्रीष्मकालीन (Weather)</option>
                    <option value="admin">प्रशासनिक / डीएम आदेश (DM / Govt Order)</option>
                    <option value="other">अन्य अवकाश (Other)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-black text-slate-800 mb-1">
                    विवरण या आदेश संदर्भ (Description)
                  </label>
                  <textarea
                    rows={2}
                    value={holidayDescription}
                    onChange={(e) => setHolidayDescription(e.target.value)}
                    placeholder="उदा. डीएम कार्यालय आदेशानुसार अत्यधिक ठंड के कारण कक्षा 1 से 8 तक अवकाश।"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-black rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 active:scale-98"
                >
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>कैलेंडर में अवकाश जोड़ें (Save Holiday)</span>
                </button>
              </form>

              <div className="p-3 bg-amber-100/70 border border-amber-300 rounded-xl text-[11px] text-amber-900 leading-relaxed">
                💡 <strong>अटेंडेंस सुरक्षा:</strong> इस सूची में दर्ज दिन स्कूल कैलेंडर में <strong>🌴 पीले रंग</strong> में दिखते हैं। इन दिनों पर किसी छात्र या अध्यापक को अनुपस्थित (Absent) नहीं माना जाता।
              </div>
            </div>

            {/* List Column */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <span className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                  <span>📅 दर्ज अवकाश सूची ({holidays.length} छुट्टियां)</span>
                </span>
                <span className="text-[11px] font-bold text-slate-500">
                  Google Sheet: <code className="bg-slate-100 text-blue-900 px-1 py-0.5 rounded">School_Holidays</code>
                </span>
              </div>

              {holidays.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-6">
                  <p className="font-bold text-slate-600 text-sm">अभी कोई गैर-रविवार अवकाश दर्ज नहीं है।</p>
                  <p className="text-xs text-slate-400 mt-1">बाएं फॉर्म से त्योहार या सरकारी आदेश अनुसार अवकाश जोड़ें।</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {holidays.map((h) => {
                    const isRange = Boolean(h.end_date && h.end_date !== h.date);
                    return (
                      <div
                        key={h.id}
                        className="bg-white border border-slate-200 hover:border-amber-300 rounded-2xl p-3.5 shadow-2xs hover:shadow-md transition-all flex items-start justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded-lg bg-amber-100 border border-amber-300 text-amber-950 font-black text-xs font-mono">
                              📅 {h.date} {isRange ? `➔ ${h.end_date}` : ''}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                h.category === 'national'
                                  ? 'bg-blue-100 text-blue-800'
                                  : h.category === 'weather'
                                  ? 'bg-cyan-100 text-cyan-800'
                                  : h.category === 'admin'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {h.category === 'national'
                                ? 'राष्ट्रीय पर्व'
                                : h.category === 'weather'
                                ? 'मौसम / शीतकालीन'
                                : h.category === 'admin'
                                ? 'डीएम / प्रशासनिक'
                                : 'त्योहार'}
                            </span>
                          </div>

                          <h5 className="font-black text-slate-900 text-sm leading-snug">
                            🌴 {h.title}
                          </h5>

                          {h.description && (
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {h.description}
                            </p>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteHoliday(h.id)}
                          className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                          title="इस अवकाश को हटाएं"
                        >
                          <i className="fa-solid fa-trash-can text-xs"></i>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
          <span className="font-medium">
            ✅ स्कूल हॉलिडे डेटाबेस ई.वी.एस. पब्लिक स्कूल सर्वर व Google Sheet से स्वचालित रूप से लिंक रहता है।
          </span>
          <button
            type="button"
            onClick={() => setIsHolidayModalOpen(false)}
            className="px-4 py-1.5 bg-[#0c2340] text-amber-300 rounded-xl font-bold cursor-pointer hover:bg-[#10316b]"
          >
            पूर्ण (Done)
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (embedded) {
    return (
      <>
        {calendarBody}
        {holidayModal}
      </>
    );
  }

  return (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-fadeIn"
      >
        {calendarBody}
      </div>
      {holidayModal}
    </>
  );
};
