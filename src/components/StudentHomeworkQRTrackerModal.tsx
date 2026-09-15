import React, { useState, useMemo } from 'react';
import { StudentRecordForScan } from './StudentQRScannerModal';
import { Homework, HomeworkTrackerRecord } from '../App';

interface StudentHomeworkQRTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: StudentRecordForScan | null;
  homeworkList: Homework[];
  hwTrackerList: HomeworkTrackerRecord[];
  classMap?: Record<string, string>;
  getClassName?: (c: string | undefined | null) => string;
  getStudentPhoto?: (s: StudentRecordForScan | null | undefined) => string;
  onUpdateStatus: (
    recordId: string,
    status: 'Completed' | 'Incompleted',
    studentId: string,
    subject?: string,
    date?: string,
    remark?: string
  ) => void;
  onScanNextStudent: () => void;
  teacherName?: string;
  allStudents?: StudentRecordForScan[];
  onSelectStudent?: (student: StudentRecordForScan) => void;
}

export const StudentHomeworkQRTrackerModal: React.FC<StudentHomeworkQRTrackerModalProps> = ({
  isOpen,
  onClose,
  student,
  homeworkList,
  hwTrackerList,
  getClassName = (c) => c || 'N/A',
  getStudentPhoto,
  onUpdateStatus,
  onScanNextStudent,
  teacherName = 'Teacher',
  allStudents = [],
  onSelectStudent,
  classMap,
}) => {
  const [selectedDateFilter, setSelectedDateFilter] = useState<'yesterday' | 'today' | 'recent'>('yesterday');
  const [customRemark, setCustomRemark] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [searchStudentInput, setSearchStudentInput] = useState<string>('');
  const [showStudentSearch, setShowStudentSearch] = useState<boolean>(false);

  // Parse date string into comparable timestamp at midnight
  const parseDateToTimestamp = (dateStr: string | null | undefined): number => {
    if (!dateStr) return 0;
    const str = String(dateStr).trim();
    if (!str) return 0;
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      }
    } catch {}
    const parts = str.split(/[-/]/);
    if (parts.length === 3) {
      let day = parseInt(parts[0], 10);
      let month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        day = parseInt(parts[2], 10);
      }
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return new Date(year, month, day).getTime();
      }
    }
    return 0;
  };

  const formatDateLabel = (ts: number): string => {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}/${d.getFullYear()}`;
  };

  // Play audio chime when marking
  const playSound = (type: 'complete' | 'incomplete') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      if (type === 'complete') {
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08); // A5
      } else {
        osc.frequency.setValueAtTime(392, audioCtx.currentTime); // G4
        osc.frequency.setValueAtTime(329.63, audioCtx.currentTime + 0.08); // E4
      }
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    } catch {}
  };

  // Filter homework assigned to this student's class
  const studentClassHomework = useMemo(() => {
    if (!student) return [];
    const studentId = String(student.Student_ID || '').trim().toLowerCase();
    const studentClass = String(student.Class || '').trim().toLowerCase();
    const studentClassName = getClassName(student.Class).trim().toLowerCase();

    return homeworkList.filter((hw) => {
      const hwStudentId = String(hw.Student_ID || '').trim().toLowerCase();
      const hwClassVal = String(hw.Class || '').trim().toLowerCase();
      const hwClassName = getClassName(hw.Class).trim().toLowerCase();

      // If targeted to a different student specifically, skip
      if (hwStudentId && hwStudentId !== studentId) {
        return false;
      }
      if (hwStudentId && hwStudentId === studentId) {
        return true;
      }

      // Match class
      return Boolean(
        hwClassVal &&
          (hwClassVal === studentClass ||
            hwClassName === studentClassName ||
            hwClassVal === studentClassName ||
            hwClassName === studentClass ||
            studentClass.includes(hwClassVal) ||
            hwClassVal.includes(studentClass) ||
            (studentClassName !== 'n/a' &&
              hwClassName !== 'n/a' &&
              (studentClassName.includes(hwClassName) || hwClassName.includes(studentClassName))))
      );
    });
  }, [student, homeworkList, classMap]);

  // Timestamps calculations for Yesterday & Today
  const dateBenchmarks = useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayMidnight = todayMidnight - 86400000;

    // Distinct dates from class homework sorted descending
    const distinctTimestamps: number[] = Array.from(
      new Set<number>(
        studentClassHomework
          .map((h) => parseDateToTimestamp(h.Date))
          .filter((t): t is number => t > 0)
      )
    ).sort((a, b) => b - a);

    // Check if there is homework exactly on yesterday
    const hasExactYesterday = distinctTimestamps.includes(yesterdayMidnight);

    // Latest prior to today
    const latestPastTs = distinctTimestamps.find((t) => t < todayMidnight);
    const targetYesterdayTs = hasExactYesterday
      ? yesterdayMidnight
      : latestPastTs !== undefined
      ? latestPastTs
      : yesterdayMidnight;

    return {
      todayMidnight,
      yesterdayMidnight,
      targetYesterdayTs,
      hasExactYesterday,
      distinctTimestamps,
    };
  }, [studentClassHomework]);

  // Homework items to display based on selected filter
  const targetHomeworkItems = useMemo(() => {
    if (studentClassHomework.length === 0) return [];

    if (selectedDateFilter === 'yesterday') {
      const targetTs = dateBenchmarks.targetYesterdayTs;
      const items = studentClassHomework.filter((hw) => parseDateToTimestamp(hw.Date) === targetTs);
      if (items.length > 0) return items;
      // Fallback to most recent homework if none matched exact timestamp
      return studentClassHomework.slice(0, 4);
    }

    if (selectedDateFilter === 'today') {
      const items = studentClassHomework.filter(
        (hw) => parseDateToTimestamp(hw.Date) === dateBenchmarks.todayMidnight
      );
      return items;
    }

    // 'recent'
    return studentClassHomework.slice(0, 6);
  }, [studentClassHomework, selectedDateFilter, dateBenchmarks]);

  // Get tracker status for a specific homework item and this student
  const getItemTrackerStatus = (hw: Homework) => {
    if (!student) return { status: 'Incompleted', recordId: `TRK-${Date.now()}` };
    const sId = String(student.Student_ID || '').trim().toLowerCase();
    const hwSubj = String(hw.Subject || '').trim().toLowerCase();
    const hwTs = parseDateToTimestamp(hw.Date);

    const match = hwTrackerList.find((tr) => {
      const trSid = String(tr.Student_ID || '').trim().toLowerCase();
      const trId = String(tr.ID || '').trim().toLowerCase();
      const isStudentMatch = trSid === sId || trId === sId;
      if (!isStudentMatch) return false;

      const trSubj = String(tr.Subject || '').trim().toLowerCase();
      const trTs = parseDateToTimestamp(tr.Date);
      const isSubjMatch = !trSubj || trSubj === hwSubj || hwSubj.includes(trSubj) || trSubj.includes(hwSubj);
      const isDateMatch = !trTs || !hwTs || trTs === hwTs;

      return isSubjMatch && isDateMatch;
    });

    if (match) {
      const isComp = (match.Last_homework_Status || '').toLowerCase().includes('complete') &&
        !(match.Last_homework_Status || '').toLowerCase().includes('incom');
      return {
        status: isComp ? 'Completed' : 'Incompleted',
        recordId: match.ID || `TRK-${hw.Homework_ID}-${student.Student_ID}`,
        isExisting: true,
      };
    }

    return {
      status: 'Not Checked',
      recordId: `TRK-${hw.Homework_ID}-${student.Student_ID || 'STU'}`,
      isExisting: false,
    };
  };

  // Handle Mark Action
  const handleMark = (hw: Homework, nextStatus: 'Completed' | 'Incompleted') => {
    if (!student) return;
    const sId = String(student.Student_ID || '');
    const { recordId } = getItemTrackerStatus(hw);
    const remark = customRemark[hw.Homework_ID] || (nextStatus === 'Completed' ? 'कार्य पूर्ण किया' : 'कार्य अधूरा रहा');

    onUpdateStatus(recordId, nextStatus, sId, hw.Subject, hw.Date, remark);
    playSound(nextStatus === 'Completed' ? 'complete' : 'incomplete');

    setToastMessage(
      `✓ ${student.Student_Name || 'छात्र'}: ${hw.Subject} होमवर्क '${nextStatus === 'Completed' ? 'पूर्ण (Completed)' : 'अपूर्ण (Incompleted)'}' मार्क किया गया!`
    );
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Send WhatsApp notice to parent
  const handleSendWhatsAppNotice = (hw: Homework, status: string) => {
    if (!student) return;
    const parentMobile = String(student.Parent_Mobile || student.Mobile_Number || '').replace(/\D/g, '');
    const studentName = student.Student_Name || 'छात्र';
    const className = getClassName(student.Class);
    const isCompleted = status === 'Completed';

    const message =
      `*ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)*\n` +
      `*गृहकार्य जांच रिपोर्ट (Homework Tracking Update)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *विद्यार्थी:* ${studentName} (ID: ${student.Student_ID || 'N/A'})\n` +
      `🏫 *कक्षा:* ${className} | रोल नंबर: ${student.Roll_Number || 'N/A'}\n` +
      `📅 *तारीख:* ${hw.Date || 'कल'}\n` +
      `📚 *विषय:* ${hw.Subject}\n` +
      `📝 *गृहकार्य कार्य:* ${hw.Homework_Detail}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *जांच स्थिति (Status):* ${isCompleted ? '✅ पूर्ण (Completed)' : '❌ अपूर्ण (Incomplete / कार्य नहीं किया)'}\n` +
      `👩‍🏫 *चेक किया:* ${teacherName || 'कक्षा अध्यापक'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${
        isCompleted
          ? '🎉 शाबाश! छात्र ने अपना गृहकार्य पूर्ण और व्यवस्थित रूप से किया है।'
          : '⚠️ कृपया घर पर बच्चे की डायरी व कॉपी देखकर गृहकार्य पूर्ण कराना सुनिश्चित करें।'
      }\n` +
      `_ई.वी.एस. पब्लिक स्कूल, बड़ौत (बागपत)_`;

    const encoded = encodeURIComponent(message);
    const waUrl =
      parentMobile.length >= 10
        ? `https://wa.me/91${parentMobile.slice(-10)}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
  };

  // Filter students for quick search in modal
  const filteredSearchStudents = useMemo(() => {
    if (!searchStudentInput.trim()) return [];
    const q = searchStudentInput.toLowerCase().trim();
    return allStudents
      .filter((s) => {
        const name = String(s.Student_Name || '').toLowerCase();
        const id = String(s.Student_ID || '').toLowerCase();
        const roll = String(s.Roll_Number || '').toLowerCase();
        const adm = String(s.Admission_Number || '').toLowerCase();
        return name.includes(q) || id.includes(q) || roll.includes(q) || adm.includes(q);
      })
      .slice(0, 6);
  }, [allStudents, searchStudentInput]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-2xl w-full my-auto shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header Banner */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center text-xl font-black shadow-md border-2 border-amber-300 shrink-0">
              <i className="fa-solid fa-qrcode"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-extrabold tracking-tight">
                  कल का होमवर्क ट्रैकर (Homework Tracker)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold">
                  Live QR Scan
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                बच्चे का क्यूआर स्कैन करके कल का होमवर्क चेक एवं मार्क करें
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white flex items-center justify-center text-sm font-bold cursor-pointer transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Notification Toast */}
        {toastMessage && (
          <div className="bg-emerald-600 text-white px-4 py-2.5 text-xs font-bold flex items-center justify-between shadow-sm animate-fadeIn shrink-0">
            <div className="flex items-center gap-2">
              <i className="fa-solid fa-circle-check text-sm"></i>
              <span>{toastMessage}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-emerald-100 hover:text-white text-xs">
              ✕
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Quick Switch Student Bar */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
            <button
              onClick={() => setShowStudentSearch(!showStudentSearch)}
              className="text-xs font-bold text-blue-900 hover:text-blue-700 flex items-center gap-1.5 cursor-pointer"
            >
              <i className="fa-solid fa-magnifying-glass text-amber-500"></i>
              <span>दूसरा छात्र चुनें (Search Another Student)</span>
            </button>

            <button
              onClick={onScanNextStudent}
              className="px-3 py-1.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
            >
              <i className="fa-solid fa-camera"></i>
              <span>अगला QR स्कैन करें</span>
            </button>
          </div>

          {/* Student Search Dropdown if toggled */}
          {showStudentSearch && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 animate-fadeIn">
              <div className="relative">
                <input
                  type="text"
                  value={searchStudentInput}
                  onChange={(e) => setSearchStudentInput(e.target.value)}
                  placeholder="छात्र का नाम, आईडी या रोल नंबर लिखें..."
                  className="w-full pl-8 pr-3 py-2 bg-white rounded-xl border border-slate-300 text-xs outline-none focus:border-blue-700"
                  autoFocus
                />
                <i className="fa-solid fa-magnifying-glass absolute left-2.5 top-2.5 text-slate-400 text-xs"></i>
              </div>

              {filteredSearchStudents.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {filteredSearchStudents.map((st) => (
                    <button
                      key={st.Student_ID}
                      onClick={() => {
                        if (onSelectStudent) onSelectStudent(st);
                        setShowStudentSearch(false);
                        setSearchStudentInput('');
                      }}
                      className="p-2 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-xl text-left flex items-center gap-2 text-xs transition-colors cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-700 text-[10px]">
                        {st.Student_Name?.charAt(0) || 'S'}
                      </div>
                      <div className="truncate">
                        <div className="font-bold text-slate-900 truncate">{st.Student_Name}</div>
                        <div className="text-[10px] text-slate-500">
                          {getClassName(st.Class)} • ID: {st.Student_ID}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Active Student Header Card */}
          {student ? (
            <div className="bg-gradient-to-br from-slate-50 to-blue-50/50 p-4 rounded-2xl border border-slate-200/90 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-16 h-16 rounded-2xl bg-[#0c2340] border-2 border-amber-300 shadow-md overflow-hidden shrink-0 flex items-center justify-center text-amber-400 font-bold text-xl">
                  {getStudentPhoto ? (
                    <img
                      src={getStudentPhoto(student)}
                      alt={student.Student_Name || 'Student'}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    student.Student_Name?.charAt(0) || 'S'
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base sm:text-lg font-black text-slate-900 leading-snug">
                      {student.Student_Name}
                    </h4>
                    <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-900 font-bold text-[10px] border border-blue-200">
                      Class {getClassName(student.Class)}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-0.5 mt-0.5">
                    <div>
                      <span className="text-slate-400">ID:</span>{' '}
                      <span className="font-mono font-bold text-slate-800">{student.Student_ID}</span>
                      <span className="mx-1.5 text-slate-300">•</span>
                      <span className="text-slate-400">Roll:</span>{' '}
                      <span className="font-semibold text-slate-800">{student.Roll_Number || '—'}</span>
                      <span className="mx-1.5 text-slate-300">•</span>
                      <span className="text-slate-400">Adm No:</span>{' '}
                      <span className="font-semibold text-slate-800">{student.Admission_Number || '—'}</span>
                    </div>

                    <div className="text-[11px] text-slate-500">
                      <span>पिता: {student.Father_Name || '—'}</span>
                      {student.Parent_Mobile && (
                        <>
                          <span className="mx-1.5 text-slate-300">•</span>
                          <span>मो: {student.Parent_Mobile}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Pills */}
              <div className="flex sm:flex-col items-center sm:items-end gap-1.5 w-full sm:w-auto justify-between border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">कक्षा स्तर</span>
                <span className="px-3 py-1 rounded-xl bg-amber-400 text-slate-950 font-black text-xs shadow-2xs">
                  {getClassName(student.Class)}
                </span>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
              <i className="fa-solid fa-qrcode text-3xl text-slate-400 mb-2 block"></i>
              कोई छात्र चयनित नहीं है। कृपया कैमरा से क्यूआर स्कैन करें।
            </div>
          )}

          {/* Date Selector Tabs */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setSelectedDateFilter('yesterday')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  selectedDateFilter === 'yesterday'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-clock-rotate-left text-[11px]"></i>
                <span>कल का होमवर्क (Yesterday)</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedDateFilter('today')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  selectedDateFilter === 'today'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-calendar-day text-[11px]"></i>
                <span>आज का (Today)</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedDateFilter('recent')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  selectedDateFilter === 'recent'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span>हालिया समस्त (All Recent)</span>
              </button>
            </div>

            <div className="text-[11px] text-slate-500 font-medium hidden sm:block">
              {selectedDateFilter === 'yesterday' && (
                <span>
                  दिनांक:{' '}
                  <strong className="text-slate-800">
                    {formatDateLabel(dateBenchmarks.targetYesterdayTs)}
                  </strong>
                  {!dateBenchmarks.hasExactYesterday && ' (पिछली कक्षा)'}
                </span>
              )}
            </div>
          </div>

          {/* Homework Items List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <i className="fa-solid fa-book-open text-blue-900"></i>
                <span>दिए गए गृहकार्य (Assigned Homework Tasks) — {targetHomeworkItems.length} विषय</span>
              </span>
              <span className="text-[11px] text-slate-400 font-normal">
                बटन दबाकर तुरंत Complete / Incomplete मार्क करें
              </span>
            </div>

            {targetHomeworkItems.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 space-y-2">
                <i className="fa-solid fa-file-circle-check text-3xl text-slate-300 block"></i>
                <div className="font-bold text-slate-700">
                  इस तारीख के लिए कोई गृहकार्य दर्ज नहीं है
                </div>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  कक्षा {getClassName(student?.Class)} के लिए इस दिन कोई होमवर्क पोस्ट नहीं किया गया था।
                  आप ऊपर दिए गए 'हालिया समस्त' टैब पर क्लिक करके पिछले कार्य देख सकते हैं।
                </p>
              </div>
            ) : (
              targetHomeworkItems.map((hw, idx) => {
                const { status } = getItemTrackerStatus(hw);
                const isCompleted = status === 'Completed';
                const isIncompleted = status === 'Incompleted';

                return (
                  <div
                    key={hw.Homework_ID || idx}
                    className={`p-4 rounded-2xl border transition-all space-y-3 ${
                      isCompleted
                        ? 'bg-emerald-50/70 border-emerald-200 shadow-2xs'
                        : isIncompleted
                        ? 'bg-rose-50/70 border-rose-200 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    {/* Item Top: Subject & Date */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-[#0c2340] text-amber-300 text-xs font-black tracking-wide">
                          {hw.Subject}
                        </span>
                        <span className="text-xs font-bold text-slate-700">
                          Class {getClassName(hw.Class)}
                        </span>
                        <span className="text-[11px] text-slate-400">•</span>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {hw.Date || 'कल'}
                        </span>
                      </div>

                      {/* Current Status Badge */}
                      <div>
                        {isCompleted && (
                          <span className="px-2.5 py-1 rounded-full bg-emerald-600 text-white text-xs font-extrabold flex items-center gap-1 shadow-2xs">
                            <i className="fa-solid fa-check text-xs"></i>
                            <span>पूर्ण (Complete)</span>
                          </span>
                        )}
                        {isIncompleted && (
                          <span className="px-2.5 py-1 rounded-full bg-rose-600 text-white text-xs font-extrabold flex items-center gap-1 shadow-2xs">
                            <i className="fa-solid fa-xmark text-xs"></i>
                            <span>अपूर्ण (Incomplete)</span>
                          </span>
                        )}
                        {!isCompleted && !isIncompleted && (
                          <span className="px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center gap-1">
                            <i className="fa-solid fa-hourglass-start text-xs text-slate-500"></i>
                            <span>जाँचना शेष (Pending)</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Homework Details / Question text */}
                    <div className="bg-white/90 p-3 rounded-xl border border-slate-200/80 text-xs text-slate-800 leading-relaxed whitespace-pre-wrap">
                      {hw.Homework_Detail || 'कोई विवरण नहीं'}
                    </div>

                    {/* Quick Toggle Action Buttons (Large Touch Targets) */}
                    <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {/* Complete Button */}
                        <button
                          type="button"
                          onClick={() => handleMark(hw, 'Completed')}
                          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer active:scale-95 shadow-xs ${
                            isCompleted
                              ? 'bg-emerald-600 text-white ring-2 ring-emerald-400 ring-offset-1'
                              : 'bg-emerald-50 hover:bg-emerald-600 text-emerald-800 hover:text-white border border-emerald-300'
                          }`}
                        >
                          <i className="fa-solid fa-circle-check text-sm"></i>
                          <span>✓ पूर्ण (Complete)</span>
                        </button>

                        {/* Incomplete Button */}
                        <button
                          type="button"
                          onClick={() => handleMark(hw, 'Incompleted')}
                          className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer active:scale-95 shadow-xs ${
                            isIncompleted
                              ? 'bg-rose-600 text-white ring-2 ring-rose-400 ring-offset-1'
                              : 'bg-rose-50 hover:bg-rose-600 text-rose-800 hover:text-white border border-rose-300'
                          }`}
                        >
                          <i className="fa-solid fa-circle-xmark text-sm"></i>
                          <span>✗ अपूर्ण (Incomplete)</span>
                        </button>
                      </div>

                      {/* WhatsApp Notify Button */}
                      <button
                        type="button"
                        onClick={() => handleSendWhatsAppNotice(hw, status)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
                        title="Send WhatsApp notice to parent"
                      >
                        <i className="fa-brands fa-whatsapp text-sm"></i>
                        <span>व्हाट्सएप सूचना</span>
                      </button>
                    </div>

                    {/* Quick Remark Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-slate-500">
                      <span className="text-[10px] text-slate-400">रिमार्क:</span>
                      {['शाबाश! पूरा कार्य सही', 'आधा अधूरा कार्य', 'कॉपी नहीं लाए', 'पुनः लिखकर लाएं'].map((rem) => (
                        <button
                          key={rem}
                          type="button"
                          onClick={() => {
                            setCustomRemark((prev) => ({ ...prev, [hw.Homework_ID]: rem }));
                            setToastMessage(`रिमार्क '${rem}' चुना गया`);
                            setTimeout(() => setToastMessage(null), 2000);
                          }}
                          className="px-2 py-0.5 rounded-md bg-white border border-slate-200 hover:border-slate-400 text-[10px] text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          {rem}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-5 py-3.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            अध्यापक:{' '}
            <strong className="text-slate-800">{teacherName || 'Faculty'}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold rounded-xl text-xs border border-slate-300 cursor-pointer transition-colors"
            >
              बंद करें (Close)
            </button>

            <button
              type="button"
              onClick={onScanNextStudent}
              className="px-4 py-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black rounded-xl text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all active:scale-95"
            >
              <i className="fa-solid fa-camera"></i>
              <span>सेव करें और अगला बच्चा स्कैन करें →</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
