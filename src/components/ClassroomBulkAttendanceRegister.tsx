import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Student, StudentBehaviorRecord } from '../types';
import { StudentAvatar } from './StudentAvatar';

export interface ClassroomBulkAttendanceProps {
  students: Student[];
  behaviorRecords: StudentBehaviorRecord[];
  classOptions: string[];
  initialClass?: string;
  lockedClass?: string | string[]; // Can be single class or multiple classes (e.g. ['4th', '5th'] or '4th, 5th')
  allowedClasses?: string[] | string; // Optional explicit allowed classes list
  teacherName?: string;
  getClassName?: (c?: string) => string;
  getStudentPhoto?: (s: Student) => string;
  onSaveBatch: (records: Partial<StudentBehaviorRecord>[]) => Promise<void> | void;
  onClose?: () => void;
  isEmbedded?: boolean;
  lang?: 'en' | 'hi';
}

// Quick 1-tap Fault Tags
interface FaultTagDef {
  id: string;
  label: string;
  labelEn: string;
  icon: string;
  field?: 'isBathed' | 'nailsClean' | 'uniformClean' | 'discipline';
  faultValue?: boolean;
  remarkText: string;
  remarkTextEn: string;
}

const FAULT_TAGS: FaultTagDef[] = [
  {
    id: 'unbathed',
    label: 'नहा कर नहीं आया',
    labelEn: 'Not Bathed',
    icon: 'fa-soap',
    field: 'isBathed',
    faultValue: false,
    remarkText: 'नहा कर नहीं आया',
    remarkTextEn: 'Not bathed / unwashed',
  },
  {
    id: 'hair',
    label: 'बाल नहीं कटे',
    labelEn: 'Uncut Hair',
    icon: 'fa-scissors',
    remarkText: 'बाल बड़े हैं, कटवाने की आवश्यकता है',
    remarkTextEn: 'Hair is untidy / needs haircut',
  },
  {
    id: 'nails',
    label: 'नाखून गंदे / बड़े',
    labelEn: 'Dirty Nails',
    icon: 'fa-hand',
    field: 'nailsClean',
    faultValue: false,
    remarkText: 'नाखून गंदे व बड़े हैं',
    remarkTextEn: 'Nails are untidy / overgrown',
  },
  {
    id: 'uniform',
    label: 'ड्रेस गंदी / अधूरी',
    labelEn: 'Improper Uniform',
    icon: 'fa-shirt',
    field: 'uniformClean',
    faultValue: false,
    remarkText: 'यूनिफॉर्म स्वच्छ नहीं है',
    remarkTextEn: 'Uniform is untidy / incomplete',
  },
  {
    id: 'shoes',
    label: 'जूते-मोजे नहीं',
    labelEn: 'No Shoes/Socks',
    icon: 'fa-shoe-prints',
    remarkText: 'उचित जूते व मोजे नहीं पहने',
    remarkTextEn: 'Proper shoes / socks not worn',
  },
  {
    id: 'hw',
    label: 'होमवर्क अधूरा',
    labelEn: 'Incomplete HW',
    icon: 'fa-book-open',
    remarkText: 'गृहकार्य अधूरा / नहीं लाया',
    remarkTextEn: 'Homework incomplete / not brought',
  },
  {
    id: 'late',
    label: 'देर से आया',
    labelEn: 'Came Late',
    icon: 'fa-clock',
    remarkText: 'कक्षा में विलम्ब (लेट) से आया',
    remarkTextEn: 'Arrived late to class',
  },
  {
    id: 'star',
    label: '🌟 उत्कृष्ट',
    labelEn: '🌟 Star Student',
    icon: 'fa-star',
    remarkText: 'कक्षा में बहुत अच्छा आचरण व अनुशासन रहा',
    remarkTextEn: 'Outstanding conduct and discipline',
  },
];

interface StudentRowState {
  studentId: string;
  isPresent: boolean;
  selectedFaults: Set<string>;
  customRemark: string;
  showCustomNoteInput: boolean;
}

// Helper to normalize any date to YYYY-MM-DD
const normalizeDateISO = (val: any): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (s.includes('Date(')) {
    const m = s.match(/Date\((\d+),(\d+),(\d+)/);
    if (m) {
      const y = m[1];
      const mo = String(Number(m[2]) + 1).padStart(2, '0');
      const d = String(m[3]).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
  }
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return `${y}-${m}-${d}`;
  }
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s;
};

// Robust helper to parse boolean / string presence from Sheet or API
const parseIsPresent = (val: any): boolean => {
  if (val === false || val === 0) return false;
  if (val === true || val === 1) return true;
  const s = String(val ?? '').trim().toLowerCase();
  if (s === 'absent' || s === 'no' || s === 'false' || s === '0' || s === 'a' || s === 'anupasthit') return false;
  if (s === 'present' || s === 'yes' || s === 'true' || s === '1' || s === 'p' || s === 'upasthit') return true;
  return true;
};

const isRecordPresent = (rec: any): boolean => {
  if (!rec) return true;
  const val = rec.Is_Present !== undefined ? rec.Is_Present : rec.is_present !== undefined ? rec.is_present : rec.attendance;
  return parseIsPresent(val);
};

// Robust bidirectional helper to match class IDs and names (e.g. "C5" <=> "1st", "1" <=> "Class 1", "UKG" <=> "C4")
export const areClassesMatching = (
  classA: string | null | undefined,
  classB: string | null | undefined,
  getClassName?: (c?: string) => string
): boolean => {
  if (!classA || !classB) return false;
  const rawA = String(classA).trim().toLowerCase();
  const rawB = String(classB).trim().toLowerCase();
  if (rawA === rawB) return true;
  if (rawA === 'all' || rawB === 'all') return true;

  const getName = getClassName || ((c?: string) => c || '');
  const nameA = String(getName(classA)).trim().toLowerCase();
  const nameB = String(getName(classB)).trim().toLowerCase();

  if (nameA === nameB && nameA !== 'n/a' && nameA !== '') return true;
  if (rawA === nameB || rawB === nameA) return true;

  // Clean strings by removing non-alphanumeric (e.g. "class 1" -> "class1", "1st" -> "1st")
  const cleanA = rawA.replace(/[^a-z0-9]/g, '');
  const cleanB = rawB.replace(/[^a-z0-9]/g, '');
  if (cleanA === cleanB && cleanA !== '') return true;

  const cleanNameA = nameA.replace(/[^a-z0-9]/g, '');
  const cleanNameB = nameB.replace(/[^a-z0-9]/g, '');
  if (cleanNameA === cleanNameB && cleanNameA !== 'na' && cleanNameA !== '') return true;
  if (cleanA === cleanNameB || cleanB === cleanNameA) return true;

  // Strip "class" prefix
  const stripA = cleanA.replace(/^class/, '');
  const stripB = cleanB.replace(/^class/, '');
  if (stripA === stripB && stripA !== '') return true;

  // Numeric equivalence for numbered classes (1st == 1 == Class 1 == C5)
  const isPrePrimaryA = /play|nursery|lkg|ukg|m1|m2|m3/.test(rawA) || /play|nursery|lkg|ukg|m1|m2|m3/.test(nameA);
  const isPrePrimaryB = /play|nursery|lkg|ukg|m1|m2|m3/.test(rawB) || /play|nursery|lkg|ukg|m1|m2|m3/.test(nameB);

  if (!isPrePrimaryA && !isPrePrimaryB) {
    const numA = rawA.replace(/\D/g, '') || nameA.replace(/\D/g, '');
    const numB = rawB.replace(/\D/g, '') || nameB.replace(/\D/g, '');
    if (numA && numB && numA === numB) return true;
  }

  // Pre-primary match
  if (isPrePrimaryA && isPrePrimaryB) {
    if (rawA.includes('play') && rawB.includes('play')) return true;
    if (rawA.includes('nursery') && rawB.includes('nursery')) return true;
    if (rawA.includes('lkg') && rawB.includes('lkg')) return true;
    if (rawA.includes('ukg') && rawB.includes('ukg')) return true;
  }

  return false;
};

// Robust helper to parse cleanliness / fault tags
const parseIsClean = (val: any): boolean => {
  if (val === false || val === 0) return false;
  if (val === true || val === 1) return true;
  const s = String(val ?? '').trim().toLowerCase();
  if (s === 'no' || s === 'false' || s === '0' || s === 'needs improvement') return false;
  return true;
};

export const ClassroomBulkAttendanceRegister: React.FC<ClassroomBulkAttendanceProps> = ({
  students,
  behaviorRecords,
  classOptions,
  initialClass,
  lockedClass,
  allowedClasses,
  teacherName = 'School Teacher',
  getClassName = (c) => c || 'N/A',
  getStudentPhoto = (_s?: any) => '',
  onSaveBatch,
  onClose,
  isEmbedded = false,
  lang = 'en',
}) => {
  const isEn = lang === 'en';
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Normalize allowed classes list if teacher has assigned class(es)
  const allowedClassList = useMemo<string[] | null>(() => {
    const raw = allowedClasses ?? lockedClass;
    if (!raw) return null;
    let list: string[] = [];
    if (Array.isArray(raw)) {
      list = raw.map((s) => String(s ?? '').trim()).filter(Boolean);
    } else {
      const s = String(raw).trim();
      if (!s) return null;
      list = s.split(/[,;|]+/).map((item) => item.trim()).filter(Boolean);
    }
    const unique = Array.from(new Set(list));
    return unique.length > 0 ? unique : null;
  }, [allowedClasses, lockedClass]);

  // Selected Class - auto-selects initialClass or first assigned class
  const [selectedClass, setSelectedClass] = useState<string>(() => {
    if (allowedClassList && allowedClassList.length > 0) {
      if (initialClass) {
        const found = allowedClassList.find((c) => areClassesMatching(c, initialClass, getClassName));
        if (found) return found;
      }
      return allowedClassList[0];
    }
    if (initialClass && initialClass !== 'all') return initialClass;
    if (classOptions.length > 0) return classOptions[0];
    return '1';
  });

  // Ensure selectedClass is valid whenever allowedClassList changes
  useEffect(() => {
    if (allowedClassList && allowedClassList.length > 0) {
      const isCurrentlyAllowed = allowedClassList.some((c) => areClassesMatching(c, selectedClass, getClassName));
      if (!isCurrentlyAllowed) {
        setSelectedClass(allowedClassList[0]);
      }
    }
  }, [allowedClassList, selectedClass, getClassName]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  // By user request: Already recorded students are hidden for that day!
  // If user explicitly wants to view/edit them, they can toggle showRecorded.
  const [showRecorded, setShowRecorded] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Filter students by selected class using robust bidirectional class matching
  const classStudents = useMemo(() => {
    const clsTrim = String(selectedClass || '').trim();
    if (!clsTrim || clsTrim.toLowerCase() === 'all') return students;
    return students.filter((s) => {
      return areClassesMatching(s.Class, clsTrim, getClassName);
    });
  }, [students, selectedClass, getClassName]);

  // Saved records lookup for selectedDate (matched with normalized ISO dates)
  const savedRecordsMap = useMemo(() => {
    const map = new Map<string, StudentBehaviorRecord>();
    const selIso = normalizeDateISO(selectedDate);
    behaviorRecords.forEach((b) => {
      const sId = String(b.Student_ID || '').trim().toLowerCase();
      const bDateIso = normalizeDateISO(b.Date);
      if (sId && bDateIso === selIso) {
        map.set(sId, b);
      }
    });
    return map;
  }, [behaviorRecords, selectedDate]);

  // Track student IDs that the teacher has manually touched in the UI
  // This prevents background re-renders or pollings from flipping teacher's inputs
  const touchedStudentsRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef<string>('');

  // Initial state map: Student_ID -> StudentRowState
  const [rowStates, setRowStates] = useState<Record<string, StudentRowState>>({});

  // Populate row states whenever class, date, or behaviorRecords changes
  useEffect(() => {
    const currentKey = `${selectedClass}_${selectedDate}`;
    const isKeyChanged = lastKeyRef.current !== currentKey;
    if (isKeyChanged) {
      lastKeyRef.current = currentKey;
      touchedStudentsRef.current.clear();
    }

    setRowStates((prev) => {
      const updated: Record<string, StudentRowState> = isKeyChanged ? {} : { ...prev };

      classStudents.forEach((st) => {
        const sId = String(st.Student_ID || '').trim();
        const sIdLower = sId.toLowerCase();

        // If user already manually edited this student in the current session, NEVER overwrite it!
        if (!isKeyChanged && touchedStudentsRef.current.has(sId) && updated[sId]) {
          return;
        }

        const existing = savedRecordsMap.get(sIdLower);

        if (existing) {
          const faults = new Set<string>();
          if (!parseIsClean(existing.Is_Bathed)) faults.add('unbathed');
          if (!parseIsClean(existing.Nails_Clean)) faults.add('nails');
          if (!parseIsClean(existing.Uniform_clean)) faults.add('uniform');
          if (!parseIsClean(existing.Discipline)) faults.add('late');

          const rem = existing.Remark || '';
          if (/बाल/i.test(rem)) faults.add('hair');
          if (/जूते|मोजे/i.test(rem)) faults.add('shoes');
          if (/गृहकार्य|होमवर्क/i.test(rem)) faults.add('hw');
          if (/उत्कृष्ट|शाबाश/i.test(rem)) faults.add('star');

          const isPres = isRecordPresent(existing);

          updated[sId] = {
            studentId: sId,
            isPresent: isPres,
            selectedFaults: isPres ? faults : new Set(),
            customRemark: existing.Remark || '',
            showCustomNoteInput: !!existing.Remark && !faults.has('star'),
          };
        } else {
          // If no existing saved record and not yet in state, default to Present with clean conduct
          if (!updated[sId]) {
            updated[sId] = {
              studentId: sId,
              isPresent: true,
              selectedFaults: new Set<string>(),
              customRemark: '',
              showCustomNoteInput: false,
            };
          }
        }
      });

      return updated;
    });
  }, [classStudents, selectedDate, selectedClass, savedRecordsMap]);

  // Counts
  const totalCount = classStudents.length;
  const savedCount = useMemo(() => {
    return classStudents.filter((st) =>
      savedRecordsMap.has(String(st.Student_ID || '').trim().toLowerCase())
    ).length;
  }, [classStudents, savedRecordsMap]);
  const pendingCount = Math.max(0, totalCount - savedCount);

  // Separate pending vs all class students
  const pendingStudents = useMemo(() => {
    return classStudents.filter(
      (st) => !savedRecordsMap.has(String(st.Student_ID || '').trim().toLowerCase())
    );
  }, [classStudents, savedRecordsMap]);

  // List of students to display:
  // Jinki haziri aur behaviour darj ho gaya unko us din ke liye hide karna hai!
  const displayedStudents = useMemo(() => {
    const baseList = showRecorded ? classStudents : pendingStudents;

    if (!searchQuery.trim()) return baseList;
    const q = searchQuery.toLowerCase().trim();
    return baseList.filter((st) => {
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
  }, [classStudents, pendingStudents, showRecorded, searchQuery]);

  // Present / Absent / Fault counts for the currently displayed list
  const currentRegisterStudents = showRecorded ? classStudents : pendingStudents;
  const presentCount = currentRegisterStudents.filter(
    (st) => rowStates[st.Student_ID]?.isPresent !== false
  ).length;
  const absentCount = currentRegisterStudents.length - presentCount;
  const faultCount = currentRegisterStudents.filter((st) => {
    const state = rowStates[st.Student_ID];
    return state?.isPresent && state.selectedFaults.size > 0 && !state.selectedFaults.has('star');
  }).length;

  // 1-Click: Mark ALL in current list Present
  const handleMarkAllPresent = () => {
    displayedStudents.forEach((st) => {
      touchedStudentsRef.current.add(String(st.Student_ID || '').trim());
    });
    setRowStates((prev) => {
      const updated = { ...prev };
      displayedStudents.forEach((st) => {
        const sId = String(st.Student_ID || '').trim();
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

  // 1-Click: Mark ALL in current list Absent
  const handleMarkAllAbsent = () => {
    displayedStudents.forEach((st) => {
      touchedStudentsRef.current.add(String(st.Student_ID || '').trim());
    });
    setRowStates((prev) => {
      const updated = { ...prev };
      displayedStudents.forEach((st) => {
        const sId = String(st.Student_ID || '').trim();
        if (updated[sId]) {
          updated[sId] = {
            ...updated[sId],
            isPresent: false,
            selectedFaults: new Set(),
          };
        } else {
          updated[sId] = {
            studentId: sId,
            isPresent: false,
            selectedFaults: new Set(),
            customRemark: '',
            showCustomNoteInput: false,
          };
        }
      });
      return updated;
    });
  };

  // Toggle single student presence
  const handleTogglePresent = (studentId: string) => {
    touchedStudentsRef.current.add(studentId);
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
          selectedFaults: nextPresent ? cur.selectedFaults : new Set(),
        },
      };
    });
  };

  // Toggle specific fault tag for a student
  const handleToggleFault = (studentId: string, faultId: string) => {
    touchedStudentsRef.current.add(studentId);
    setRowStates((prev) => {
      const cur = prev[studentId];
      if (!cur || !cur.isPresent) return prev; // Cannot apply fault if absent

      const nextFaults = new Set(cur.selectedFaults);
      if (nextFaults.has(faultId)) {
        nextFaults.delete(faultId);
      } else {
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
    touchedStudentsRef.current.add(studentId);
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

  // Batch Save Handler (Saves displayed students and automatically hides them once saved)
  const handleSaveAll = async () => {
    const studentsToSave = displayedStudents;
    if (studentsToSave.length === 0) return;
    setIsSaving(true);

    try {
      const recordsToSave: Partial<StudentBehaviorRecord>[] = studentsToSave.map((st) => {
        const sId = String(st.Student_ID || '').trim();
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
            student_id: sId,
            Date: selectedDate,
            date: selectedDate,
            Class: st.Class || selectedClass,
            class: st.Class || selectedClass,
            Is_Present: false,
            is_present: 'Absent',
            Is_Bathed: false,
            is_bathed: 'No',
            Nails_Clean: false,
            nails_clean: 'No',
            Uniform_clean: false,
            uniform_clean: 'No',
            Good_Manners: isEn ? 'N/A (Absent)' : 'लागू नहीं (अनुपस्थित)',
            good_manners: isEn ? 'N/A (Absent)' : 'लागू नहीं (अनुपस्थित)',
            Discipline: false,
            discipline: 'Needs Improvement',
            Remark: isEn ? 'Student is absent today.' : 'आज छात्र विद्यालय में अनुपस्थित रहा।',
            remark: isEn ? 'Student is absent today.' : 'आज छात्र विद्यालय में अनुपस्थित रहा।',
            AI_Feedback: isEn ? 'Student is absent today.' : 'आज छात्र विद्यालय में अनुपस्थित रहा।',
            ai_feedback: isEn ? 'Student is absent today.' : 'आज छात्र विद्यालय में अनुपस्थित रहा।',
          };
        }

        // Present student
        const hasUnbathed = state.selectedFaults.has('unbathed');
        const hasNails = state.selectedFaults.has('nails');
        const hasUniform = state.selectedFaults.has('uniform');
        const hasLate = state.selectedFaults.has('late');
        const isStar = state.selectedFaults.has('star');

        const remarkParts: string[] = [];
        state.selectedFaults.forEach((fId) => {
          const def = FAULT_TAGS.find((t) => t.id === fId);
          if (def) remarkParts.push(isEn ? (def.remarkTextEn || def.remarkText) : def.remarkText);
        });

        if (state.customRemark.trim()) {
          remarkParts.push(state.customRemark.trim());
        }

        const finalRemark =
          remarkParts.length > 0
            ? remarkParts.join(' • ')
            : isEn
            ? 'Present in class, neat and disciplined'
            : 'कक्षा में उपस्थित, स्वच्छ व अनुशासित';

        return {
          Behavior_ID: `BEH-${sId}-${selectedDate}`,
          Student_ID: sId,
          student_id: sId,
          Date: selectedDate,
          date: selectedDate,
          Class: st.Class || selectedClass,
          class: st.Class || selectedClass,
          Is_Present: true,
          is_present: 'Present',
          Is_Bathed: !hasUnbathed,
          is_bathed: hasUnbathed ? 'No' : 'Yes',
          Nails_Clean: !hasNails,
          nails_clean: hasNails ? 'No' : 'Yes',
          Uniform_clean: !hasUniform,
          uniform_clean: hasUniform ? 'No' : 'Yes',
          Good_Manners: isStar
            ? 'उत्कृष्ट (Excellent)'
            : remarkParts.length > 0
            ? 'सुधार आवश्यक (Needs Improvement)'
            : 'उत्कृष्ट (Excellent)',
          good_manners: isStar
            ? 'उत्कृष्ट (Excellent)'
            : remarkParts.length > 0
            ? 'सुधार आवश्यक (Needs Improvement)'
            : 'उत्कृष्ट (Excellent)',
          Discipline: !hasLate,
          discipline: hasLate ? 'Needs Improvement' : 'Good',
          Remark: finalRemark,
          remark: finalRemark,
          AI_Feedback: isStar
            ? (isEn ? 'Kudos for outstanding conduct and discipline!' : 'उत्कृष्ट आचरण व अनुशासन हेतु शाबाश!')
            : remarkParts.length > 0
            ? (isEn ? 'Parents are requested to pay attention to child hygiene and punctuality.' : 'अभिभावक कृपया बच्चे की स्वच्छता व समय की पाबंदी पर ध्यान दें।')
            : (isEn ? 'Keep up regular attendance and cleanliness.' : 'नियमित उपस्थिति व स्वच्छता बनाए रखें।'),
          ai_feedback: isStar
            ? (isEn ? 'Kudos for outstanding conduct and discipline!' : 'उत्कृष्ट आचरण व अनुशासन हेतु शाबाश!')
            : remarkParts.length > 0
            ? (isEn ? 'Parents are requested to pay attention to child hygiene and punctuality.' : 'अभिभावक कृपया बच्चे की स्वच्छता व समय की पाबंदी पर ध्यान दें।')
            : (isEn ? 'Keep up regular attendance and cleanliness.' : 'नियमित उपस्थिति व स्वच्छता बनाए रखें।'),
        };
      });

      await onSaveBatch(recordsToSave);

      touchedStudentsRef.current.clear();
      const msg = isEn
        ? `🎉 Successfully saved attendance for ${recordsToSave.length} students of Class ${getClassName(selectedClass)}!`
        : `🎉 क्लास ${getClassName(selectedClass)} के ${recordsToSave.length} छात्रों का डेटा सुरक्षित हो गया और वे सूची से हाइड हो गए!`;
      setSaveSuccessMsg(msg);
      setTimeout(() => setSaveSuccessMsg(null), 6000);
    } catch (err: any) {
      alert(isEn ? `Error saving attendance: ${err?.message || 'Unknown error'}` : `हाजिरी सुरक्षित करने में त्रुटि: ${err?.message || 'अज्ञात त्रुटि'}`);
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
              <span>{isEn ? 'Classroom Daily Attendance & Conduct Register' : 'संपूर्ण क्लास दैनिक हाजिरी व आचरण रजिस्टर'}</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
              <span>{isEn ? 'Class Attendance & Hygiene Check' : 'कक्षा उपस्थिति एवं स्वच्छता जांच'}</span>
              <span className="text-amber-300 text-sm font-semibold">
                (Class {getClassName(selectedClass)})
              </span>
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              {allowedClassList ? (
                allowedClassList.length === 1 ? (
                  <span className="text-amber-200 font-semibold">
                    <i className="fa-solid fa-lock mr-1"></i>
                    {isEn
                      ? `You are assigned Class ${getClassName(allowedClassList[0])} by School Manager.`
                      : `आपको स्कूल मैनेजर द्वारा निर्धारित कक्षा (Class ${getClassName(allowedClassList[0])}) असाइन की गई है।`}
                  </span>
                ) : (
                  <span className="text-amber-200 font-semibold">
                    <i className="fa-solid fa-layer-group mr-1"></i>
                    {isEn
                      ? `You are assigned ${allowedClassList.length} classes (${allowedClassList.map((c) => `Class ${getClassName(c)}`).join(', ')}). Switch class above.`
                      : `आपको स्कूल मैनेजर द्वारा ${allowedClassList.length} कक्षाएं (${allowedClassList.map((c) => `Class ${getClassName(c)}`).join(', ')}) असाइन की गई हैं। ऊपर से कक्षा बदलें।`}
                  </span>
                )
              ) : (
                isEn
                  ? 'Mark students and save. Recorded students are automatically hidden from the active list.'
                  : 'छात्रों को मार्क करें और सेव करें। सुरक्षित होने के बाद छात्र सूची से स्वतः छुप जाएंगे।'
              )}
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

            {/* Quick 1-Tap Class Switcher for Multiple Assigned Classes */}
            {allowedClassList && allowedClassList.length > 1 && (
              <div className="flex items-center gap-1 bg-white/10 p-1 rounded-xl border border-white/20">
                {allowedClassList.map((c) => {
                  const isCur = areClassesMatching(c, selectedClass, getClassName);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedClass(c)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1 ${
                        isCur
                          ? 'bg-amber-400 text-slate-950 shadow-sm'
                          : 'text-white/80 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      <i className="fa-solid fa-graduation-cap text-[10px]"></i>
                      <span>Class {getClassName(c)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Class Dropdown with Assigned Classes Highlighted */}
            <div className="bg-white/10 border border-white/20 rounded-xl px-2.5 py-1.5 flex items-center gap-2 text-xs">
              <i className="fa-solid fa-chalkboard-user text-amber-300"></i>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
                className="bg-transparent text-white font-bold outline-none cursor-pointer text-xs"
              >
                {allowedClassList && allowedClassList.length > 0 && (
                  <optgroup label={isEn ? "✨ Assigned Classes" : "✨ मैनेजर द्वारा असाइन की गई कक्षाएं"} className="bg-slate-950 text-amber-400 font-bold">
                    {allowedClassList.map((c) => (
                      <option key={`assigned-${c}`} value={c} className="bg-slate-900 text-amber-300 font-bold">
                        ★ Class {getClassName(c)} {isEn ? '(Assigned)' : '(असाइन की गई)'}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={isEn ? "Other Classes" : "अन्य सभी स्कूल कक्षाएं"} className="bg-slate-950 text-slate-300 font-bold">
                  {classOptions
                    .filter((c) => !allowedClassList || !allowedClassList.some((ac) => areClassesMatching(ac, c, getClassName)))
                    .map((c) => (
                      <option key={c} value={c} className="bg-slate-900 text-white font-medium">
                        Class {getClassName(c)}
                      </option>
                    ))}
                </optgroup>
              </select>
              {allowedClassList && (
                <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-1.5 py-0.5 rounded-md shrink-0">
                  {allowedClassList.length} {isEn ? 'Assigned' : 'असाइन'}
                </span>
              )}
            </div>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl bg-white/10 hover:bg-rose-600 text-white transition-colors cursor-pointer"
                title={isEn ? "Close" : "बंद करें"}
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
            className="text-xs text-emerald-700 hover:text-emerald-950 font-bold px-2 py-0.5 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-slate-500">{isEn ? 'Total Students' : 'कुल छात्र (Total)'}</div>
            <div className="text-xl font-black text-slate-900">{totalCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center font-bold">
            <i className="fa-solid fa-users"></i>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-amber-800">{isEn ? 'Pending Students' : 'बाकी छात्र (Pending)'}</div>
            <div className="text-xl font-black text-amber-900">{pendingCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-xs">
            <i className="fa-solid fa-clock"></i>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-emerald-700">{isEn ? 'Recorded Today' : 'आज दर्ज (Recorded)'}</div>
            <div className="text-xl font-black text-emerald-900">{savedCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold shadow-xs">
            <i className="fa-solid fa-check"></i>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-rose-700">{isEn ? 'Absent Students' : 'गैरहाजिर (Absent)'}</div>
            <div className="text-xl font-black text-rose-900">{absentCount}</div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-rose-500 text-white flex items-center justify-center font-bold shadow-xs">
            <i className="fa-solid fa-xmark"></i>
          </div>
        </div>
      </div>

      {/* STATUS BAR WITH HIDE/UNHIDE TOGGLE */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-600 font-medium">
            {isEn ? 'Class Total: ' : 'कक्षा कुल: '}<strong className="text-slate-900">{totalCount}</strong> | 
            {' '}{isEn ? 'Pending: ' : 'बाकी छात्र: '}<strong className="text-amber-800 font-bold">{pendingCount}</strong>
            {savedCount > 0 && (
              <span> | {isEn ? 'Recorded: ' : 'आज दर्ज हो चुके: '}<strong className="text-emerald-700 font-bold">{savedCount}</strong> ({showRecorded ? (isEn ? 'Visible' : 'दिख रहे हैं') : (isEn ? 'Hidden' : 'छिपे हुए हैं')})</span>
            )}
          </span>
        </div>

        {savedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowRecorded(!showRecorded)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shadow-2xs ${
              showRecorded
                ? 'bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-300'
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300'
            }`}
          >
            <i className={`fa-solid ${showRecorded ? 'fa-eye-slash text-amber-700' : 'fa-eye text-blue-600'}`}></i>
            <span>
              {showRecorded
                ? (isEn ? 'Hide Recorded Students' : 'दर्ज छात्र पुनः छुपाएं (Hide)')
                : (isEn ? `View Recorded Students (${savedCount})` : `आज दर्ज हो चुके छात्र देखें (${savedCount})`)}
            </span>
          </button>
        )}
      </div>

      {/* Quick Action Toolbar */}
      <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleMarkAllPresent}
            disabled={displayedStudents.length === 0}
            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 shadow-xs cursor-pointer transition-all active:scale-95 disabled:opacity-50"
            title={isEn ? "Mark displayed students Present" : "दिख रहे छात्रों को Present मार्क करें"}
          >
            <i className="fa-solid fa-check-double text-amber-300"></i>
            <span>{isEn ? 'Mark All Present' : 'सबको Present करें'}</span>
          </button>

          <button
            type="button"
            onClick={handleMarkAllAbsent}
            disabled={displayedStudents.length === 0}
            className="px-3 py-2 rounded-xl bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-bold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
            title={isEn ? "Mark displayed students Absent" : "दिख रहे छात्रों को Absent मार्क करें"}
          >
            <i className="fa-solid fa-rotate-left text-rose-500"></i>
            <span>{isEn ? 'Mark All Absent' : 'सबको Absent करें'}</span>
          </button>

          <span className="text-slate-400 hidden sm:inline">|</span>

          {/* Search Box */}
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isEn ? "Search student or roll no..." : "छात्र या रोल नं. खोजें..."}
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
          disabled={isSaving || displayedStudents.length === 0}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-600 text-white font-black flex items-center gap-2 shadow-md cursor-pointer transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
        >
          <i className={`fa-solid ${isSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} text-amber-300`}></i>
          <span>
            {isSaving
              ? (isEn ? 'Saving...' : 'सेव हो रहा है...')
              : isEn
              ? `💾 Save Register (${presentCount} Present, ${absentCount} Absent)`
              : `💾 क्लास हाजिरी सेव करें (${presentCount} Present, ${absentCount} Absent)`}
          </span>
        </button>
      </div>

      {/* Student List Table / Cards */}
      <div className="space-y-2.5">
        {displayedStudents.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500 text-xs">
            {pendingCount === 0 && savedCount > 0 && !showRecorded ? (
              <div className="py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3 text-3xl shadow-sm">
                  <i className="fa-solid fa-circle-check"></i>
                </div>
                <h3 className="text-base font-black text-emerald-900">
                  {isEn
                    ? `Awesome! Today's attendance & conduct for Class ${getClassName(selectedClass)} is recorded!`
                    : `शानदार! क्लास ${getClassName(selectedClass)} के सभी छात्रों की हाजिरी व आचरण आज दर्ज हो चुका है!`}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  {isEn
                    ? `All ${savedCount} student records are safe and hidden according to rules.`
                    : `सभी ${savedCount} छात्रों का डेटा सुरक्षित है और नियमानुसार सूची से छुपा दिया गया है।`}
                </p>
                <button
                  type="button"
                  onClick={() => setShowRecorded(true)}
                  className="mt-4 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs inline-flex items-center gap-2 cursor-pointer transition-all active:scale-95 shadow-sm"
                >
                  <i className="fa-solid fa-eye"></i>
                  <span>
                    {isEn
                      ? `View / Edit Recorded Students (${savedCount})`
                      : `दर्ज हो चुके छात्र देखें / पुनः संपादित करें (${savedCount})`}
                  </span>
                </button>
              </div>
            ) : (
              <div>
                <i className="fa-solid fa-user-slash text-2xl text-slate-400 mb-2"></i>
                <p className="font-bold">{isEn ? 'No students found.' : 'कोई छात्र नहीं मिले।'}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {isEn ? 'Please clear your search query or switch class above.' : 'कृपया खोज शब्द हटाएं या ऊपर से कक्षा बदलें।'}
                </p>
              </div>
            )}
          </div>
        ) : (
          displayedStudents.map((student, idx) => {
            const sId = String(student.Student_ID || '').trim();
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-slate-900 text-sm">
                          {student.Student_Name}
                        </span>
                        {student.Roll_Number && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                            {isEn ? 'Roll #' : 'रोल #'}{student.Roll_Number}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
                        <span>ID: <strong className="text-slate-700">{sId}</strong></span>
                        <span>• {isEn ? 'Father:' : 'पिता:'} {student.Father_Name || 'N/A'}</span>
                        {student.Village && (
                          <span className="text-slate-400">• {student.Village}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Attendance Toggle Button */}
                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleTogglePresent(sId)}
                      className={`px-4 py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center gap-2 cursor-pointer shadow-xs transition-all active:scale-95 ${
                        isPres
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20'
                          : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20'
                      }`}
                      title={
                        isPres
                          ? (isEn ? 'Click to mark Absent' : 'क्लिक करके अनुपस्थित (Absent) मार्क करें')
                          : (isEn ? 'Click to mark Present' : 'क्लिक करके उपस्थित (Present) मार्क करें')
                      }
                    >
                      <i className={`fa-solid ${isPres ? 'fa-check' : 'fa-xmark'} text-base`}></i>
                      <span>{isPres ? (isEn ? 'Present' : 'उपस्थित (Present)') : (isEn ? 'Absent' : 'अनुपस्थित (Absent)')}</span>
                    </button>
                  </div>
                </div>

                {/* BEHAVIOR & GROOMING SECTION */}
                {!isPres ? (
                  <div className="mt-2.5 pt-2 border-t border-rose-200/80 flex items-center gap-2 text-xs text-rose-800 font-medium">
                    <i className="fa-solid fa-ban text-rose-500"></i>
                    <span>
                      {isEn
                        ? 'Student is absent today — conduct & grooming not applicable.'
                        : 'छात्र आज अनुपस्थित है — आचरण व स्वच्छता रिकॉर्ड लागू नहीं है।'}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 pt-2.5 border-t border-slate-100">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-bold text-slate-500 mr-1 flex items-center gap-1">
                        <i className="fa-solid fa-sparkles text-amber-500"></i>
                        <span>{isEn ? 'Tags:' : 'जांच टैग:'}</span>
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
                            <span>{isEn ? (tag.labelEn || tag.label) : tag.label}</span>
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
                        title={isEn ? "Add special remark" : "अतिरिक्त विशेष रिमार्क लिखें"}
                      >
                        <i className="fa-solid fa-pen text-[10px]"></i>
                        <span>
                          {state.customRemark
                            ? (isEn ? 'Note Added' : 'रिमार्क दर्ज')
                            : (isEn ? '+ Note' : '+ रिमार्क')}
                        </span>
                      </button>
                    </div>

                    {/* Quick Custom Note Input if open */}
                    {state.showCustomNoteInput && (
                      <div className="mt-2 flex items-center gap-2 animate-fadeIn">
                        <input
                          type="text"
                          value={state.customRemark}
                          onChange={(e) => handleRemarkChange(sId, e.target.value)}
                          placeholder={isEn ? "Special remark (e.g. forgot notebook, feeling unwell)..." : "विशेष रिमार्क (उदा. कॉपी घर भूल आया, तबीयत ढीली है)..."}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white outline-none focus:border-indigo-600"
                        />
                        {state.customRemark && (
                          <button
                            type="button"
                            onClick={() => handleRemarkChange(sId, '')}
                            className="text-xs text-slate-400 hover:text-slate-600 font-bold px-1 cursor-pointer"
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
      {displayedStudents.length > 0 && (
        <div className="sticky bottom-3 z-20 bg-gradient-to-r from-[#0c2340] to-slate-900 border border-amber-400/40 p-3.5 rounded-2xl shadow-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-2 text-xs">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-400/40 flex items-center justify-center font-bold">
              <i className="fa-solid fa-clipboard-check"></i>
            </div>
            <div>
              <div className="font-bold text-white">
                {isEn ? 'Class' : 'कक्षा'} {getClassName(selectedClass)} • {selectedDate}
              </div>
              <div className="text-[11px] text-slate-300">
                {isEn ? 'Pending: ' : 'बाकी छात्र: '}<strong className="text-amber-300">{pendingCount}</strong> | {isEn ? 'Present: ' : 'उपस्थित: '}
                <strong className="text-emerald-400">{presentCount}</strong> | {isEn ? 'Absent: ' : 'अनुपस्थित: '}
                <strong className="text-rose-400">{absentCount}</strong>
                {faultCount > 0 && (
                  <span>
                    {' '}
                    | {isEn ? 'Faults: ' : 'फॉल्ट: '}
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
              <span>{isSaving ? (isEn ? 'Saving...' : 'सेव हो रहा है...') : (isEn ? '💾 Save Remaining Students' : '💾 बाकी छात्रों की हाजिरी सेव करें')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
