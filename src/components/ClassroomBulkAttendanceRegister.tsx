import React, { useState, useMemo, useEffect } from 'react';
import { Student, StudentBehaviorRecord } from '../types';
import { StudentAvatar } from './StudentAvatar';

export interface ClassroomBulkAttendanceProps {
  students: Student[];
  behaviorRecords: StudentBehaviorRecord[];
  classOptions: string[];
  initialClass?: string;
  teacherName?: string;
  getClassName?: (c?: string) => string;
  getStudentPhoto?: (s: Student) => string;
  onSaveBatch: (records: Partial<StudentBehaviorRecord>[]) => Promise<void> | void;
  onClose?: () => void;
  isEmbedded?: boolean;
}

// Quick 1-tap Fault Tags
interface FaultTagDef {
  id: string;
  label: string;
  icon: string;
  field?: 'isBathed' | 'nailsClean' | 'uniformClean' | 'discipline';
  faultValue?: boolean; // false when fault is active
  remarkText: string;
}

const FAULT_TAGS: FaultTagDef[] = [
  {
    id: 'unbathed',
    label: 'नहा कर नहीं आया',
    icon: 'fa-soap',
    field: 'isBathed',
    faultValue: false,
    remarkText: 'नहा कर नहीं आया',
  },
  {
    id: 'hair',
    label: 'बाल नहीं कटे',
    icon: 'fa-scissors',
    remarkText: 'बाल बड़े हैं, कटवाने की आवश्यकता है',
  },
  {
    id: 'nails',
    label: 'नाखून गंदे / बड़े',
    icon: 'fa-hand',
    field: 'nailsClean',
    faultValue: false,
    remarkText: 'नाखून गंदे व बड़े हैं',
  },
  {
    id: 'uniform',
    label: 'ड्रेस गंदी / अधूरी',
    icon: 'fa-shirt',
    field: 'uniformClean',
    faultValue: false,
    remarkText: 'यूनिफॉर्म स्वच्छ नहीं है',
  },
  {
    id: 'shoes',
    label: 'जूते-मोजे नहीं',
    icon: 'fa-shoe-prints',
    remarkText: 'उचित जूते व मोजे नहीं पहने',
  },
  {
    id: 'hw',
    label: 'होमवर्क अधूरा',
    icon: 'fa-book-open',
    remarkText: 'गृहकार्य अधूरा / नहीं लाया',
  },
  {
    id: 'late',
    label: 'देर से आया',
    icon: 'fa-clock',
    remarkText: 'कक्षा में विलम्ब (लेट) से आया',
  },
  {
    id: 'star',
    label: '🌟 उत्कृष्ट',
    icon: 'fa-star',
    remarkText: 'कक्षा में बहुत अच्छा आचरण व अनुशासन रहा',
  },
];

interface StudentRowState {
  studentId: string;
  isPresent: boolean;
  selectedFaults: Set<string>;
  customRemark: string;
  showCustomNoteInput: boolean;
}

export const ClassroomBulkAttendanceRegister: React.FC<ClassroomBulkAttendanceProps> = ({
  students,
  behaviorRecords,
  classOptions,
  initialClass,
  teacherName = 'School Teacher',
  getClassName = (c) => c || 'N/A',
  getStudentPhoto = (_s?: any) => '',
  onSaveBatch,
  onClose,
  isEmbedded = false,
}) => {
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Selected Class
  const [selectedClass, setSelectedClass] = useState<string>(() => {
    if (initialClass && initialClass !== 'all') return initialClass;
    if (classOptions.length > 0) return classOptions[0];
    return '1';
  });

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Filter students by selected class
  const classStudents = useMemo(() => {
    const clsTrim = String(selectedClass || '').trim().toLowerCase();
    if (!clsTrim || clsTrim === 'all') return students;
    return students.filter((s) => {
      const sCls = String(s.Class || '').trim().toLowerCase();
      return sCls === clsTrim || getClassName(s.Class).toLowerCase() === clsTrim;
    });
  }, [students, selectedClass, getClassName]);

  // Initial state map: Student_ID -> StudentRowState
  const [rowStates, setRowStates] = useState<Record<string, StudentRowState>>({});

  // Populate row states whenever class or date changes
  useEffect(() => {
    const newStates: Record<string, StudentRowState> = {};

    classStudents.forEach((st) => {
      const sId = String(st.Student_ID || '');
      // Check if there is an existing record for this student on this date
      const existing = behaviorRecords.find(
        (b) =>
          String(b.Student_ID || '').trim().toLowerCase() === sId.trim().toLowerCase() &&
          b.Date === selectedDate
      );

      if (existing) {
        const faults = new Set<string>();
        if (existing.Is_Bathed === false) faults.add('unbathed');
        if (existing.Nails_Clean === false) faults.add('nails');
        if (existing.Uniform_clean === false) faults.add('uniform');
        if (existing.Discipline === false) faults.add('late');

        // Check text in remark for hair / shoes / hw
        const rem = existing.Remark || '';
        if (/बाल/i.test(rem)) faults.add('hair');
        if (/जूते|मोजे/i.test(rem)) faults.add('shoes');
        if (/गृहकार्य|होमवर्क/i.test(rem)) faults.add('hw');
        if (/उत्कृष्ट|शाबाश/i.test(rem)) faults.add('star');

        newStates[sId] = {
          studentId: sId,
          isPresent: existing.Is_Present !== false, // default true unless explicitly false
          selectedFaults: faults,
          customRemark: existing.Remark || '',
          showCustomNoteInput: !!existing.Remark && !faults.has('star'),
        };
      } else {
        // Default: ALL PRESENT, NO FAULTS ("सब ठीक है")
        newStates[sId] = {
          studentId: sId,
          isPresent: true,
          selectedFaults: new Set<string>(),
          customRemark: '',
          showCustomNoteInput: false,
        };
      }
    });

    setRowStates(newStates);
  }, [classStudents, selectedDate, behaviorRecords]);

  // Search filtered student list
  const filteredStudents = useMemo(() => {
    if (!searchQuery.trim()) return classStudents;
    const q = searchQuery.toLowerCase().trim();
    return classStudents.filter((st) => {
      const name = (st.Student_Name || '').toLowerCase();
      const father = (st.Father_Name || '').toLowerCase();
      const roll = String(st.Roll_Number || '').toLowerCase();
      const adm = String(st.Admission_Number || '').toLowerCase();
      const id = String(st.Student_ID || '').toLowerCase();
      return (
        name.includes(q) ||
        father.includes(q) ||
        roll.includes(q) ||
        adm.includes(q) ||
        id.includes(q)
      );
    });
  }, [classStudents, searchQuery]);

  // Counters
  const totalCount = classStudents.length;
  const presentCount = classStudents.filter(
    (st) => rowStates[st.Student_ID]?.isPresent !== false
  ).length;
  const absentCount = totalCount - presentCount;
  const faultCount = classStudents.filter((st) => {
    const state = rowStates[st.Student_ID];
    return state?.isPresent && state.selectedFaults.size > 0 && !state.selectedFaults.has('star');
  }).length;

  // 1-Click: Mark ALL Present
  const handleMarkAllPresent = () => {
    setRowStates((prev) => {
      const updated = { ...prev };
      classStudents.forEach((st) => {
        const sId = String(st.Student_ID || '');
        if (updated[sId]) {
          updated[sId] = { ...updated[sId], isPresent: true };
        } else {
          updated[sId] = {
            studentId: sId,
            isPresent: true,
            selectedFaults: new Set(),
            customRemark: '',
            showCustomNoteInput: false,
          };
        }
      });
      return updated;
    });
  };

  // 1-Click: Mark ALL Absent
  const handleMarkAllAbsent = () => {
    setRowStates((prev) => {
      const updated = { ...prev };
      classStudents.forEach((st) => {
        const sId = String(st.Student_ID || '');
        if (updated[sId]) {
          updated[sId] = {
            ...updated[sId],
            isPresent: false,
            selectedFaults: new Set(),
          };
        }
      });
      return updated;
    });
  };

  // Toggle single student presence
  const handleTogglePresent = (studentId: string) => {
    setRowStates((prev) => {
      const cur = prev[studentId] || {
        studentId,
        isPresent: true,
        selectedFaults: new Set(),
        customRemark: '',
        showCustomNoteInput: false,
      };
      const nextPresent = !cur.isPresent;
      return {
        ...prev,
        [studentId]: {
          ...cur,
          isPresent: nextPresent,
          // "पहली बात तो जो एब्सेंट है, उसका तो आचरण है ही नहीं, सब कुछ गायब"
          selectedFaults: nextPresent ? cur.selectedFaults : new Set(),
        },
      };
    });
  };

  // Toggle specific fault tag for a student
  const handleToggleFault = (studentId: string, faultId: string) => {
    setRowStates((prev) => {
      const cur = prev[studentId];
      if (!cur || !cur.isPresent) return prev; // Cannot apply fault if absent

      const nextFaults = new Set(cur.selectedFaults);
      if (nextFaults.has(faultId)) {
        nextFaults.delete(faultId);
      } else {
        // If selecting 'star' (excellent), remove faults
        if (faultId === 'star') {
          nextFaults.clear();
          nextFaults.add('star');
        } else {
          nextFaults.delete('star');
          nextFaults.add(faultId);
        }
      }

      return {
        ...prev,
        [studentId]: {
          ...cur,
          selectedFaults: nextFaults,
        },
      };
    });
  };

  // Update custom remark for a student
  const handleRemarkChange = (studentId: string, text: string) => {
    setRowStates((prev) => {
      const cur = prev[studentId];
      if (!cur) return prev;
      return {
        ...prev,
        [studentId]: {
          ...cur,
          customRemark: text,
        },
      };
    });
  };

  // Toggle custom note input box
  const handleToggleNoteInput = (studentId: string) => {
    setRowStates((prev) => {
      const cur = prev[studentId];
      if (!cur) return prev;
      return {
        ...prev,
        [studentId]: {
          ...cur,
          showCustomNoteInput: !cur.showCustomNoteInput,
        },
      };
    });
  };

  // Batch Save Handler
  const handleSaveAll = async () => {
    if (classStudents.length === 0) return;
    setIsSaving(true);

    try {
      const recordsToSave: Partial<StudentBehaviorRecord>[] = classStudents.map((st) => {
        const sId = String(st.Student_ID || '');
        const state = rowStates[sId] || {
          studentId: sId,
          isPresent: true,
          selectedFaults: new Set(),
          customRemark: '',
          showCustomNoteInput: false,
        };

        const isPres = state.isPresent;

        if (!isPres) {
          // Absent: Everything conduct-wise is cleared
          return {
            Behavior_ID: `BEH-${sId}-${selectedDate}`,
            Student_ID: sId,
            Date: selectedDate,
            Class: st.Class || selectedClass,
            Is_Present: false,
            Is_Bathed: false,
            Nails_Clean: false,
            Uniform_clean: false,
            Good_Manners: 'लागू नहीं (अनुपस्थित)',
            Discipline: false,
            Remark: 'आज छात्र विद्यालय में अनुपस्थित रहा।',
            AI_Feedback: 'आज छात्र विद्यालय में अनुपस्थित रहा।',
          };
        }

        // Present student
        const hasUnbathed = state.selectedFaults.has('unbathed');
        const hasNails = state.selectedFaults.has('nails');
        const hasUniform = state.selectedFaults.has('uniform');
        const isStar = state.selectedFaults.has('star');

        // Build remark string from active tags
        const remarkParts: string[] = [];
        state.selectedFaults.forEach((fId) => {
          const def = FAULT_TAGS.find((t) => t.id === fId);
          if (def) remarkParts.push(def.remarkText);
        });

        if (state.customRemark.trim()) {
          remarkParts.push(state.customRemark.trim());
        }

        const finalRemark =
          remarkParts.length > 0
            ? remarkParts.join(' • ')
            : 'कक्षा में उपस्थित, स्वच्छ व अनुशासित';

        return {
          Behavior_ID: `BEH-${sId}-${selectedDate}`,
          Student_ID: sId,
          Date: selectedDate,
          Class: st.Class || selectedClass,
          Is_Present: true,
          Is_Bathed: !hasUnbathed,
          Nails_Clean: !hasNails,
          Uniform_clean: !hasUniform,
          Good_Manners: isStar
            ? 'उत्कृष्ट (Excellent)'
            : remarkParts.length > 0
            ? 'सुधार आवश्यक (Needs Improvement)'
            : 'उत्कृष्ट (Excellent)',
          Discipline: !state.selectedFaults.has('late'),
          Remark: finalRemark,
          AI_Feedback: isStar
            ? 'उत्कृष्ट आचरण व अनुशासन हेतु शाबाश!'
            : remarkParts.length > 0
            ? 'अभिभावक कृपया बच्चे की स्वच्छता व समय की पाबंदी पर ध्यान दें।'
            : 'नियमित उपस्थिति व स्वच्छता बनाए रखें।',
        };
      });

      await onSaveBatch(recordsToSave);

      const msg = `🎉 क्लास ${getClassName(selectedClass)} की हाजिरी व आचरण सुरक्षित हो गया! (${presentCount} उपस्थित, ${absentCount} अनुपस्थित)`;
      setSaveSuccessMsg(msg);
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (err: any) {
      alert(`हाजिरी सुरक्षित करने में त्रुटि: ${err?.message || 'अज्ञात त्रुटि'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`space-y-4 ${isEmbedded ? '' : 'bg-white rounded-3xl p-4 sm:p-6 shadow-xl border border-slate-200'}`}>
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] p-4 sm:p-5 rounded-2xl text-white shadow-md relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black text-[11px] mb-1.5 uppercase">
              <i className="fa-solid fa-users-viewfinder"></i>
              <span>संपूर्ण क्लास दैनिक हाजिरी व आचरण रजिस्टर</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
              <span>कक्षा उपस्थिति एवं स्वच्छता जांच</span>
              <span className="text-amber-300 text-sm font-semibold">
                (Class {getClassName(selectedClass)})
              </span>
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              पूरी क्लास को 1-क्लिक में मार्क करें। जो गैरहाजिर हैं उन्हें अनमार्क करें और फॉल्ट वाले बच्चों के टैग पर टैप करें।
            </p>
          </div>

          {/* Quick Date and Class Picker */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs">
              <i className="fa-solid fa-calendar-day text-amber-300"></i>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-white font-bold outline-none cursor-pointer"
              />
            </div>

            <div className="bg-white/10 border border-white/20 rounded-xl px-3 py-1.5 flex items-center gap-2 text-xs">
              <i className="fa-solid fa-graduation-cap text-amber-300"></i>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="bg-transparent text-white font-bold outline-none cursor-pointer text-xs"
              >
                {classOptions.map((c) => (
                  <option key={c} value={c} className="bg-slate-900 text-white">
                    Class {getClassName(c)}
                  </option>
                ))}
              </select>
            </div>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-white/10 hover:bg-rose-600 text-white transition-colors cursor-pointer"
                title="बंद करें"
              >
                <i className="fa-solid fa-xmark text-sm"></i>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Success Notification Bar */}
      {saveSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border-2 border-emerald-400 rounded-2xl text-emerald-900 font-bold text-xs sm:text-sm flex items-center justify-between shadow-sm animate-fadeIn">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-circle-check text-emerald-600 text-base"></i>
            <span>{saveSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveSuccessMsg(null)}
            className="text-xs text-emerald-700 hover:text-emerald-950 font-bold px-2 py-0.5"
          >
            ✕
          </button>
        </div>
      )}

      {/* Summary KPI Cards & Quick Action Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500">कक्षा के कुल छात्र</div>
            <div className="text-xl font-black text-slate-900">{totalCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-bold">
            <i className="fa-solid fa-users"></i>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-emerald-700">उपस्थित (Present)</div>
            <div className="text-xl font-black text-emerald-900">{presentCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold shadow-xs">
            <i className="fa-solid fa-check"></i>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-rose-700">अनुपस्थित (Absent)</div>
            <div className="text-xl font-black text-rose-900">{absentCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-rose-500 text-white flex items-center justify-center font-bold shadow-xs">
            <i className="fa-solid fa-xmark"></i>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-amber-800">स्वच्छता/फॉल्ट वाले</div>
            <div className="text-xl font-black text-amber-950">{faultCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-xs">
            <i className="fa-solid fa-triangle-exclamation"></i>
          </div>
        </div>
      </div>

      {/* Quick Action Toolbar */}
      <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleMarkAllPresent}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95"
            title="पूरी क्लास को एक साथ Present मार्क करें"
          >
            <i className="fa-solid fa-check-double text-amber-300"></i>
            <span>सबको Present करें</span>
          </button>

          <button
            type="button"
            onClick={handleMarkAllAbsent}
            className="px-3 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
            title="सबको Absent मार्क करें"
          >
            <i className="fa-solid fa-rotate-left text-rose-500"></i>
            <span>सबको Absent करें</span>
          </button>

          <span className="text-slate-400 hidden sm:inline">|</span>

          {/* Search Box */}
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="छात्र या रोल नं. खोजें..."
              className="pl-8 pr-7 py-1.5 rounded-xl border border-slate-300 bg-white text-xs outline-none focus:border-blue-800 w-44 sm:w-56"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-400 hover:text-slate-700 font-bold text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Top Save Button */}
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={isSaving || classStudents.length === 0}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-600 text-white font-black flex items-center gap-2 shadow-md cursor-pointer transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
        >
          <i className={`fa-solid ${isSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} text-amber-300`}></i>
          <span>{isSaving ? 'सेव हो रहा है...' : `💾 क्लास हाजिरी सेव करें (${presentCount} Present)`}</span>
        </button>
      </div>

      {/* Student List Table / Cards */}
      <div className="space-y-2.5">
        {filteredStudents.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
            <i className="fa-solid fa-user-slash text-2xl text-slate-400 mb-2"></i>
            <p className="font-bold">इस कक्षा में कोई छात्र नहीं मिले।</p>
            <p className="text-[11px] text-slate-400 mt-0.5">कृपया ऊपर से कक्षा बदलें या खोज शब्द हटाएं।</p>
          </div>
        ) : (
          filteredStudents.map((student, idx) => {
            const sId = String(student.Student_ID || '');
            const state = rowStates[sId] || {
              studentId: sId,
              isPresent: true,
              selectedFaults: new Set(),
              customRemark: '',
              showCustomNoteInput: false,
            };

            const isPres = state.isPresent;
            const hasFaults = state.selectedFaults.size > 0 && !state.selectedFaults.has('star');
            const isStar = state.selectedFaults.has('star');

            return (
              <div
                key={sId || idx}
                className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${
                  !isPres
                    ? 'bg-rose-50/40 border-rose-200/90'
                    : hasFaults
                    ? 'bg-amber-50/40 border-amber-300/90 shadow-2xs'
                    : isStar
                    ? 'bg-indigo-50/40 border-indigo-200/90'
                    : 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Student Identity */}
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="relative shrink-0">
                      <StudentAvatar
                        student={student}
                        photoUrl={getStudentPhoto(student)}
                        size="md"
                      />
                      <span
                        className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center text-[9px] font-black ${
                          isPres ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                        }`}
                      >
                        {isPres ? 'P' : 'A'}
                      </span>
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-900 text-sm">
                          {student.Student_Name}
                        </span>
                        {student.Roll_Number && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            रोल #{student.Roll_Number}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                        <span>पिता: {student.Father_Name || 'N/A'}</span>
                        {student.Village && (
                          <span className="text-slate-400">• {student.Village}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Attendance Toggle Button (BIG, TOUCH FRIENDLY) */}
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTogglePresent(sId)}
                      className={`px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center gap-2 cursor-pointer shadow-xs transition-all active:scale-95 ${
                        isPres
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20'
                          : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20'
                      }`}
                      title={isPres ? 'क्लिक करके अनुपस्थित (Absent) मार्क करें' : 'क्लिक करके उपस्थित (Present) मार्क करें'}
                    >
                      <i className={`fa-solid ${isPres ? 'fa-check' : 'fa-xmark'} text-base`}></i>
                      <span>{isPres ? 'उपस्थित (Present)' : 'अनुपस्थित (Absent)'}</span>
                    </button>
                  </div>
                </div>

                {/* BEHAVIOR & GROOMING SECTION */}
                {/* Rule: "पहली बात तो जो एब्सेंट है, उसका तो आचरण है ही नहीं, सब कुछ गायब" */}
                {!isPres ? (
                  <div className="mt-2.5 pt-2 border-t border-rose-200/80 flex items-center gap-2 text-xs text-rose-800 font-medium">
                    <i className="fa-solid fa-ban text-rose-500"></i>
                    <span>छात्र आज अनुपस्थित है — आचरण व स्वच्छता रिकॉर्ड लागू नहीं है।</span>
                  </div>
                ) : (
                  <div className="mt-3 pt-2.5 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-500 mr-1 flex items-center gap-1">
                        <i className="fa-solid fa-sparkles text-amber-500"></i>
                        <span>जांच टैग:</span>
                      </span>

                      {/* 1-Tap Quick Fault Badges */}
                      {FAULT_TAGS.map((tag) => {
                        const isSelected = state.selectedFaults.has(tag.id);
                        const isStarTag = tag.id === 'star';

                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleToggleFault(sId, tag.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                              isSelected
                                ? isStarTag
                                  ? 'bg-amber-400 text-slate-950 font-black shadow-xs ring-1 ring-amber-500'
                                  : 'bg-rose-600 text-white font-black shadow-xs ring-1 ring-rose-700'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/90'
                            }`}
                          >
                            <i className={`fa-solid ${tag.icon} ${isSelected ? (isStarTag ? 'text-slate-950' : 'text-amber-200') : 'text-slate-400'} text-[10px]`}></i>
                            <span>{tag.label}</span>
                          </button>
                        );
                      })}

                      {/* Custom Note Button */}
                      <button
                        type="button"
                        onClick={() => handleToggleNoteInput(sId)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer ${
                          state.showCustomNoteInput || state.customRemark
                            ? 'bg-indigo-600 text-white font-black'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200/90'
                        }`}
                        title="अतिरिक्त विशेष रिमार्क लिखें"
                      >
                        <i className="fa-solid fa-pen text-[10px]"></i>
                        <span>{state.customRemark ? 'रिमार्क दर्ज' : '+ रिमार्क'}</span>
                      </button>
                    </div>

                    {/* Quick Custom Note Input if open */}
                    {state.showCustomNoteInput && (
                      <div className="mt-2 flex items-center gap-2 animate-fadeIn">
                        <input
                          type="text"
                          value={state.customRemark}
                          onChange={(e) => handleRemarkChange(sId, e.target.value)}
                          placeholder="विशेष रिमार्क (उदा. कॉपी घर भूल आया, तबीयत ढीली है)..."
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white outline-none focus:border-indigo-600"
                        />
                        {state.customRemark && (
                          <button
                            type="button"
                            onClick={() => handleRemarkChange(sId, '')}
                            className="text-xs text-slate-400 hover:text-slate-600 font-bold px-1"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sticky Bottom Save Bar */}
      {filteredStudents.length > 0 && (
        <div className="sticky bottom-3 z-20 bg-gradient-to-r from-[#0c2340] to-slate-900 border border-amber-400/40 p-3.5 rounded-2xl shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-400/40 flex items-center justify-center font-bold">
              <i className="fa-solid fa-clipboard-check"></i>
            </div>
            <div>
              <div className="font-bold text-white">
                कक्षा {getClassName(selectedClass)} • {selectedDate}
              </div>
              <div className="text-[11px] text-slate-300">
                कुल: <strong className="text-white">{totalCount}</strong> | उपस्थित:{' '}
                <strong className="text-emerald-400">{presentCount}</strong> | अनुपस्थित:{' '}
                <strong className="text-rose-400">{absentCount}</strong>
                {faultCount > 0 && (
                  <span>
                    {' '}
                    | फॉल्ट:{' '}
                    <strong className="text-amber-400">{faultCount}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleSaveAll}
              disabled={isSaving}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-lg hover:shadow-amber-400/30 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
            >
              <i className={`fa-solid ${isSaving ? 'fa-spinner fa-spin' : 'fa-check-double'} text-base`}></i>
              <span>{isSaving ? 'सेव हो रहा है...' : '💾 पूरी क्लास की हाजिरी व आचरण सेव करें'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
