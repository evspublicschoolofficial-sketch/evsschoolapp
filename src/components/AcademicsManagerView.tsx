import React, { useMemo, useState } from 'react';
import {
  AcademicSession,
  AcademicSubject,
  AcademicsConfigSnapshot,
  ClassSectionConfig,
  PeriodSetConfig,
  PeriodSlot,
  PromotionLogEntry,
  SchoolUser,
  StaffAttendanceRecord,
  Student,
  TeacherSubstitution,
  TimetableEntry,
  WeekdayKey,
} from '../types';
import {
  WEEKDAYS,
  WEEKDAY_LABELS_HI,
  STANDARD_CLASS_ORDER,
  computeTeacherWorkloadMap,
  createPromotionLogId,
  findFreeAndBusyTeachersAtSlot,
  findTeacherConflictsAtSlot,
  formatTime12Hr,
  getNextClassSuggestion,
  getPeriodSetForClass,
  getTeachersOnly,
  getTodayDateString,
  getTodayWeekdayKey,
  resolveStudentClassAndSection,
} from '../utils/academicsHelper';

type AcademicsSubTab = 'timetable' | 'sections' | 'periods' | 'workload' | 'sessions';

interface AcademicsManagerViewProps {
  config: AcademicsConfigSnapshot;
  onSaveConfig: (
    next: AcademicsConfigSnapshot
  ) => Promise<{ sheetSynced?: boolean; sheetError?: string } | void> | void;
  onRefreshFromSheet?: () => Promise<boolean | void> | void;
  onOpenSheetSetup?: () => void;
  students: Student[];
  users: SchoolUser[];
  staffAttendanceList: StaffAttendanceRecord[];
  classMap: Record<string, string>;
  getClassName: (cls: string) => string;
  managerName: string;
  onPromoteStudentsApplied?: (
    overrides: Record<string, any>
  ) => void;
}

export const AcademicsManagerView: React.FC<AcademicsManagerViewProps> = ({
  config,
  onSaveConfig,
  onRefreshFromSheet,
  onOpenSheetSetup,
  students,
  users,
  staffAttendanceList,
  classMap,
  getClassName,
  managerName,
  onPromoteStudentsApplied,
}) => {
  const [subTab, setSubTab] = useState<AcademicsSubTab>('timetable');
  const [saving, setSaving] = useState(false);
  const [isSheetSyncing, setIsSheetSyncing] = useState(false);
  const [lastSheetSyncState, setLastSheetSyncState] = useState<'idle' | 'synced' | 'local_only'>('idle');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const teachers = useMemo(() => getTeachersOnly(users), [users]);

  const allClassKeys = useMemo(() => {
    const keys = new Set<string>(STANDARD_CLASS_ORDER);
    Object.keys(classMap || {}).forEach((k) => {
      if (k.trim()) keys.add(k.trim());
    });
    config.sections.forEach((s) => {
      if (s.classKey.trim()) keys.add(s.classKey.trim());
    });
    students.forEach((st) => {
      const c = String(st.Class || '').trim();
      if (c && !keys.has(c)) {
        // Match by name if possible
        const foundKey = Object.entries(classMap || {}).find(
          ([, name]) => String(name || '').toLowerCase() === c.toLowerCase()
        )?.[0];
        if (!foundKey) keys.add(c);
      }
    });
    return Array.from(keys);
  }, [classMap, config.sections, students]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const commitConfig = async (next: AcademicsConfigSnapshot, msg?: string) => {
    setSaving(true);
    try {
      const res = await onSaveConfig(next);
      if (res && typeof res === 'object') {
        if (res.sheetSynced) {
          setLastSheetSyncState('synced');
          if (msg) showToast(`${msg} · ☁️ Sheet सिंक ✓`);
        } else {
          setLastSheetSyncState('local_only');
          if (msg) {
            showToast(
              `${msg} · ⚠️ सर्वर में सेव हुआ — Google Sheet सिंक के लिए Apps Script नया वर्शन Deploy करें`
            );
          }
        }
      } else if (msg) {
        showToast(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleManualSheetRefresh = async () => {
    if (!onRefreshFromSheet || isSheetSyncing) return;
    setIsSheetSyncing(true);
    try {
      const ok = await onRefreshFromSheet();
      if (ok !== false) {
        setLastSheetSyncState('synced');
        showToast('🔄 Google Sheet से Academics व Timetable डेटा सिंक हो गया!');
      } else {
        setLastSheetSyncState('local_only');
        showToast('⚠️ Sheet से सिंक नहीं हो सका — Apps Script Deploy/URL जाँचें');
      }
    } catch {
      setLastSheetSyncState('local_only');
      showToast('⚠️ Sheet से सिंक करते समय त्रुटि आई');
    } finally {
      setIsSheetSyncing(false);
    }
  };

  // =========================================================================
  // TAB 4 STATE: WEEKLY CLASS TIMETABLE BUILDER
  // =========================================================================
  const [ttClassKey, setTtClassKey] = useState<string>(allClassKeys[0] || 'C5');
  const availableSectionsForTt = useMemo(() => {
    const secs = config.sections.filter(
      (s) => s.classKey.toLowerCase() === ttClassKey.toLowerCase()
    );
    return secs.length > 0 ? secs : [{ id: `${ttClassKey}::A`, classKey: ttClassKey, sectionName: 'A' } as ClassSectionConfig];
  }, [config.sections, ttClassKey]);

  const [ttSection, setTtSection] = useState<string>('A');
  const effectiveTtSection = availableSectionsForTt.some((s) => s.sectionName === ttSection)
    ? ttSection
    : availableSectionsForTt[0]?.sectionName || 'A';

  const activePeriodSet = useMemo(
    () => getPeriodSetForClass(config, ttClassKey),
    [config, ttClassKey]
  );

  // Cell Editor Modal State
  const [editingCell, setEditingCell] = useState<{
    day: WeekdayKey;
    slot: PeriodSlot;
    subjectId: string;
    teacherId: string;
    roomNumber: string;
  } | null>(null);

  const [copySourceDay, setCopySourceDay] = useState<WeekdayKey>('Monday');
  const [copyTargetMode, setCopyTargetMode] = useState<'all' | WeekdayKey>('all');

  const getTimetableCell = (day: WeekdayKey, periodId: string): TimetableEntry | undefined => {
    return config.timetable.find(
      (e) =>
        e.sessionId === config.activeSessionId &&
        e.classKey.toLowerCase() === ttClassKey.toLowerCase() &&
        e.sectionName.toLowerCase() === effectiveTtSection.toLowerCase() &&
        e.day === day &&
        e.periodId === periodId
    );
  };

  const openTimetableCellEditor = (day: WeekdayKey, slot: PeriodSlot) => {
    const existing = getTimetableCell(day, slot.id);
    const secCfg = availableSectionsForTt.find((s) => s.sectionName === effectiveTtSection);
    const defaultSubjectId = existing?.subjectId || secCfg?.subjectIds?.[0] || config.subjects[0]?.id || '';
    const mappedTeacher =
      existing?.teacherId ||
      (defaultSubjectId && secCfg?.subjectTeachers?.[defaultSubjectId]) ||
      secCfg?.classTeacherId ||
      '';
    setEditingCell({
      day,
      slot,
      subjectId: defaultSubjectId,
      teacherId: mappedTeacher,
      roomNumber: existing?.roomNumber || secCfg?.roomNumber || '',
    });
  };

  const editingCellConflicts = useMemo(() => {
    if (!editingCell || !editingCell.teacherId) return [];
    return findTeacherConflictsAtSlot(config.timetable, {
      sessionId: config.activeSessionId,
      day: editingCell.day,
      periodId: editingCell.slot.id,
      teacherId: editingCell.teacherId,
      ignoreClassKey: ttClassKey,
      ignoreSectionName: effectiveTtSection,
    });
  }, [editingCell, config.timetable, config.activeSessionId, ttClassKey, effectiveTtSection]);

  const handleSaveTimetableCell = async () => {
    if (!editingCell) return;
    const subj = config.subjects.find((s) => s.id === editingCell.subjectId);
    const teacher = teachers.find((t) => t.User_ID === editingCell.teacherId);
    if (!subj) {
      showToast('⚠️ कृपया विषय चुनें');
      return;
    }

    const entryId = `${config.activeSessionId}::${ttClassKey}::${effectiveTtSection}::${editingCell.day}::${editingCell.slot.id}`;
    const newEntry: TimetableEntry = {
      id: entryId,
      sessionId: config.activeSessionId,
      classKey: ttClassKey,
      sectionName: effectiveTtSection,
      day: editingCell.day,
      periodId: editingCell.slot.id,
      subjectId: subj.id,
      subjectName: subj.name,
      teacherId: teacher?.User_ID || '',
      teacherName: teacher?.Name || 'Unassigned',
      roomNumber: editingCell.roomNumber.trim(),
    };

    const filtered = config.timetable.filter((e) => e.id !== entryId);
    await commitConfig(
      { ...config, timetable: [...filtered, newEntry] },
      `✅ ${WEEKDAY_LABELS_HI[editingCell.day]} (${editingCell.slot.label}) सेव हो गया`
    );
    setEditingCell(null);
  };

  const handleDeleteTimetableCell = async () => {
    if (!editingCell) return;
    const entryId = `${config.activeSessionId}::${ttClassKey}::${effectiveTtSection}::${editingCell.day}::${editingCell.slot.id}`;
    const filtered = config.timetable.filter((e) => e.id !== entryId);
    await commitConfig({ ...config, timetable: filtered }, '🗑️ पीरियड हटाया गया');
    setEditingCell(null);
  };

  const handleCopyDayTimetable = async () => {
    const sourceEntries = config.timetable.filter(
      (e) =>
        e.sessionId === config.activeSessionId &&
        e.classKey.toLowerCase() === ttClassKey.toLowerCase() &&
        e.sectionName.toLowerCase() === effectiveTtSection.toLowerCase() &&
        e.day === copySourceDay
    );
    if (sourceEntries.length === 0) {
      showToast(`⚠️ ${WEEKDAY_LABELS_HI[copySourceDay]} में कोई पीरियड सेट नहीं है`);
      return;
    }
    const targetDays: WeekdayKey[] =
      copyTargetMode === 'all'
        ? WEEKDAYS.filter((d) => d !== copySourceDay)
        : copyTargetMode !== copySourceDay
        ? [copyTargetMode]
        : [];
    if (targetDays.length === 0) {
      showToast('⚠️ कॉपी करने के लिए अलग दिन चुनें');
      return;
    }

    const targetDaySet = new Set(targetDays);
    const preserved = config.timetable.filter(
      (e) =>
        !(
          e.sessionId === config.activeSessionId &&
          e.classKey.toLowerCase() === ttClassKey.toLowerCase() &&
          e.sectionName.toLowerCase() === effectiveTtSection.toLowerCase() &&
          targetDaySet.has(e.day)
        )
    );

    const clones: TimetableEntry[] = [];
    for (const tDay of targetDays) {
      for (const src of sourceEntries) {
        clones.push({
          ...src,
          id: `${config.activeSessionId}::${ttClassKey}::${effectiveTtSection}::${tDay}::${src.periodId}`,
          day: tDay,
        });
      }
    }

    await commitConfig(
      { ...config, timetable: [...preserved, ...clones] },
      `✅ ${WEEKDAY_LABELS_HI[copySourceDay]} का टाइमटेबल कॉपी हो गया!`
    );
  };

  // =========================================================================
  // TAB 2 STATE: SECTIONS, SUBJECTS & SUBJECT-TEACHER MAPPING
  // =========================================================================
  const [secFilterClass, setSecFilterClass] = useState<string>(allClassKeys[0] || 'C5');
  const [newSectionName, setNewSectionName] = useState<string>('B');
  const [newSectionRoom, setNewSectionRoom] = useState<string>('');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(`${allClassKeys[0] || 'C5'}::A`);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCode, setNewSubjectCode] = useState('');
  const [newSubjectElective, setNewSubjectElective] = useState(false);

  const sectionsForSelectedClass = useMemo(() => {
    return config.sections.filter((s) => s.classKey.toLowerCase() === secFilterClass.toLowerCase());
  }, [config.sections, secFilterClass]);

  const activeSectionObj = useMemo(() => {
    return (
      config.sections.find((s) => s.id === selectedSectionId) ||
      sectionsForSelectedClass[0] ||
      config.sections[0]
    );
  }, [config.sections, selectedSectionId, sectionsForSelectedClass]);

  const handleAddSection = async () => {
    const cleanName = newSectionName.trim().toUpperCase();
    if (!cleanName) return;
    const id = `${secFilterClass}::${cleanName}`;
    if (config.sections.some((s) => s.id.toLowerCase() === id.toLowerCase())) {
      showToast('⚠️ यह सेक्शन इस कक्षा में पहले से मौजूद है');
      return;
    }
    const newSec: ClassSectionConfig = {
      id,
      classKey: secFilterClass,
      sectionName: cleanName,
      roomNumber: newSectionRoom.trim() || `Room ${secFilterClass}-${cleanName}`,
      classTeacherId: '',
      classTeacherName: '',
      subjectIds: config.subjects.slice(0, 6).map((s) => s.id),
      subjectTeachers: {},
    };
    await commitConfig({ ...config, sections: [...config.sections, newSec] }, `✅ Section ${cleanName} जोड़ा गया`);
    setSelectedSectionId(id);
    setNewSectionName('');
    setNewSectionRoom('');
  };

  const handleUpdateSectionConfig = async (updated: ClassSectionConfig, msg?: string) => {
    const nextSections = config.sections.map((s) => (s.id === updated.id ? updated : s));
    await commitConfig({ ...config, sections: nextSections }, msg);
  };

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newSubjectName.trim();
    if (!name) return;
    const code = (newSubjectCode.trim() || name.slice(0, 3)).toUpperCase();
    const subj: AcademicSubject = {
      id: `sub_${Date.now().toString(36)}`,
      name,
      code,
      isElective: newSubjectElective,
      colorHex: '#2563eb',
    };
    await commitConfig({ ...config, subjects: [...config.subjects, subj] }, `✅ विषय "${name}" जोड़ा गया`);
    setNewSubjectName('');
    setNewSubjectCode('');
    setNewSubjectElective(false);
  };

  const handleAssignStudentSection = async (student: Student, sectionName: string) => {
    const idKey = String(student.Student_ID || '').trim().toLowerCase();
    if (!idKey) return;
    const current = resolveStudentClassAndSection(student, config.studentOverrides);
    const nextOverrides = {
      ...config.studentOverrides,
      [idKey]: {
        studentId: student.Student_ID,
        classKey: current.classKey || student.Class,
        sectionName,
        sessionId: config.activeSessionId,
        status: 'Active' as const,
        updatedAt: new Date().toISOString(),
      },
    };
    await commitConfig(
      { ...config, studentOverrides: nextOverrides },
      `✅ ${student.Student_Name} को Section ${sectionName} में रखा गया`
    );
    onPromoteStudentsApplied?.(nextOverrides);
  };

  // =========================================================================
  // TAB 3 STATE: PERIOD TIMING SETS
  // =========================================================================
  const [selectedPeriodSetId, setSelectedPeriodSetId] = useState<string>(
    config.periodSets[0]?.id || 'pset_morning'
  );
  const [newPeriodSetName, setNewPeriodSetName] = useState('');
  const activeEditingPeriodSet =
    config.periodSets.find((p) => p.id === selectedPeriodSetId) || config.periodSets[0];

  const handleAddPeriodSet = async () => {
    const name = newPeriodSetName.trim();
    if (!name) return;
    const newSet: PeriodSetConfig = {
      id: `pset_${Date.now().toString(36)}`,
      name,
      assignedClassKeys: [],
      slots: [
        { id: `sp1_${Date.now()}`, periodNumber: 1, label: 'Period 1', startTime: '08:00', endTime: '08:40' },
        { id: `sp2_${Date.now()}`, periodNumber: 2, label: 'Period 2', startTime: '08:40', endTime: '09:20' },
        { id: `sbrk_${Date.now()}`, periodNumber: 0, label: 'Lunch Break', startTime: '09:20', endTime: '09:45', isBreak: true },
        { id: `sp3_${Date.now()}`, periodNumber: 3, label: 'Period 3', startTime: '09:45', endTime: '10:25' },
      ],
    };
    await commitConfig(
      { ...config, periodSets: [...config.periodSets, newSet] },
      `✅ Period Set "${name}" बनाया गया`
    );
    setSelectedPeriodSetId(newSet.id);
    setNewPeriodSetName('');
  };

  const handleSavePeriodSet = async (updated: PeriodSetConfig, msg?: string) => {
    const nextSets = config.periodSets.map((p) => (p.id === updated.id ? updated : p));
    await commitConfig({ ...config, periodSets: nextSets }, msg);
  };

  // =========================================================================
  // TAB 5 STATE: TEACHER WORKLOAD, FREE TEACHER FINDER & SUBSTITUTION
  // =========================================================================
  const [finderDay, setFinderDay] = useState<WeekdayKey>(getTodayWeekdayKey());
  const [finderPeriodId, setFinderPeriodId] = useState<string>(
    activePeriodSet.slots.find((s) => !s.isBreak)?.id || 'p1'
  );
  const [finderDate, setFinderDate] = useState<string>(getTodayDateString());
  const [subClassKey, setSubClassKey] = useState<string>(allClassKeys[0] || 'C5');
  const [subSectionName, setSubSectionName] = useState<string>('A');
  const [subOrigTeacherId, setSubOrigTeacherId] = useState<string>('');
  const [subTargetTeacherId, setSubTargetTeacherId] = useState<string>('');
  const [subSubjectName, setSubSubjectName] = useState<string>('Revision / Combined Class');
  const [subReason, setSubReason] = useState<string>('Teacher On Leave');

  const workloadList = useMemo(
    () => computeTeacherWorkloadMap(config.timetable, config.activeSessionId, teachers),
    [config.timetable, config.activeSessionId, teachers]
  );

  const freeBusySlot = useMemo(
    () =>
      findFreeAndBusyTeachersAtSlot(
        config.timetable,
        config.substitutions,
        config.activeSessionId,
        finderDay,
        finderPeriodId,
        finderDate,
        teachers
      ),
    [config.timetable, config.substitutions, config.activeSessionId, finderDay, finderPeriodId, finderDate, teachers]
  );

  const absentOrLeaveToday = useMemo(() => {
    const today = getTodayDateString();
    return staffAttendanceList.filter(
      (r) => r.date === today && (r.status === 'Absent' || r.status === 'Leave' || r.status === 'Half-Day')
    );
  }, [staffAttendanceList]);

  const handleCreateSubstitution = async (e: React.FormEvent) => {
    e.preventDefault();
    const subTeacher = teachers.find((t) => t.User_ID === subTargetTeacherId);
    if (!subTeacher) {
      showToast('⚠️ कृपया बदली (Substitute) शिक्षक चुनें');
      return;
    }
    const origTeacher = teachers.find((t) => t.User_ID === subOrigTeacherId);
    const periodObj = activePeriodSet.slots.find((s) => s.id === finderPeriodId);
    const newSub: TeacherSubstitution = {
      id: `sub_${Date.now().toString(36)}`,
      sessionId: config.activeSessionId,
      date: finderDate,
      day: finderDay,
      periodId: finderPeriodId,
      periodLabel: periodObj?.label || finderPeriodId,
      classKey: subClassKey,
      sectionName: subSectionName,
      subjectName: subSubjectName.trim() || 'General Class',
      originalTeacherId: origTeacher?.User_ID || '',
      originalTeacherName: origTeacher?.Name || 'Regular Teacher',
      substituteTeacherId: subTeacher.User_ID,
      substituteTeacherName: subTeacher.Name,
      reason: subReason.trim(),
      createdAt: new Date().toISOString(),
    };
    await commitConfig(
      { ...config, substitutions: [newSub, ...config.substitutions] },
      `✅ ${subTeacher.Name} को ${getClassName(subClassKey)}-${subSectionName} का बदली कार्य सौंपा गया`
    );
  };

  // =========================================================================
  // TAB 1 STATE: ACADEMIC SESSIONS & YEAR-END PROMOTION WIZARD
  // =========================================================================
  const [newSessionId, setNewSessionId] = useState('2027-28');
  const [newSessionStart, setNewSessionStart] = useState('2027-04-01');
  const [newSessionEnd, setNewSessionEnd] = useState('2028-03-31');

  const [promoFromClass, setPromoFromClass] = useState<string>(allClassKeys[0] || 'C5');
  const [promoFromSection, setPromoFromSection] = useState<string>('A');
  const [promoToClass, setPromoToClass] = useState<string>(() =>
    getNextClassSuggestion(allClassKeys[0] || 'C5', allClassKeys)
  );
  const [promoToSection, setPromoToSection] = useState<string>('A');
  const [promoTargetSession, setPromoTargetSession] = useState<string>(config.activeSessionId);
  const [promoActionType, setPromoActionType] = useState<'Promote' | 'Detain' | 'Passout'>('Promote');
  const [selectedPromoStudentIds, setSelectedPromoStudentIds] = useState<string[]>([]);

  const promoSourceStudents = useMemo(() => {
    return students.filter((st) => {
      const res = resolveStudentClassAndSection(st, config.studentOverrides);
      const classMatch =
        res.classKey.toLowerCase() === promoFromClass.toLowerCase() ||
        getClassName(res.classKey).toLowerCase() === getClassName(promoFromClass).toLowerCase();
      const secMatch = res.sectionName.toLowerCase() === promoFromSection.toLowerCase();
      return classMatch && secMatch;
    });
  }, [students, config.studentOverrides, promoFromClass, promoFromSection, getClassName]);

  const handleAddSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = newSessionId.trim();
    if (!cleanId) return;
    if (config.sessions.some((s) => s.id.toLowerCase() === cleanId.toLowerCase())) {
      showToast('⚠️ यह सेशन पहले से मौजूद है');
      return;
    }
    const newSess: AcademicSession = {
      id: cleanId,
      name: `Session ${cleanId}`,
      startDate: newSessionStart,
      endDate: newSessionEnd,
      isActive: false,
      createdAt: new Date().toISOString(),
    };
    await commitConfig(
      { ...config, sessions: [...config.sessions, newSess] },
      `✅ नया सत्र ${cleanId} जोड़ा गया`
    );
  };

  const handleSwitchActiveSession = async (sessionId: string) => {
    const nextSessions = config.sessions.map((s) => ({
      ...s,
      isActive: s.id === sessionId,
    }));
    await commitConfig(
      { ...config, sessions: nextSessions, activeSessionId: sessionId },
      `✅ सक्रिय सत्र अब ${sessionId} है`
    );
  };

  const handleExecutePromotion = async () => {
    if (selectedPromoStudentIds.length === 0) {
      showToast('⚠️ कम से कम 1 छात्र चुनें');
      return;
    }
    const targetCls =
      promoActionType === 'Detain'
        ? promoFromClass
        : promoActionType === 'Passout'
        ? 'Passout'
        : promoToClass;
    const targetSec = promoActionType === 'Detain' ? promoFromSection : promoToSection;

    const nextOverrides = { ...config.studentOverrides };
    for (const sid of selectedPromoStudentIds) {
      const idKey = sid.trim().toLowerCase();
      nextOverrides[idKey] = {
        studentId: sid,
        classKey: targetCls,
        sectionName: targetSec,
        sessionId: promoTargetSession || config.activeSessionId,
        status: promoActionType === 'Promote' ? 'Promoted' : promoActionType === 'Detain' ? 'Detained' : 'Passout',
        updatedAt: new Date().toISOString(),
      };
    }

    const logEntry: PromotionLogEntry = {
      id: createPromotionLogId(),
      fromSession: config.activeSessionId,
      toSession: promoTargetSession || config.activeSessionId,
      fromClass: promoFromClass,
      fromSection: promoFromSection,
      toClass: targetCls,
      toSection: targetSec,
      studentCount: selectedPromoStudentIds.length,
      studentIds: selectedPromoStudentIds,
      actionType: promoActionType,
      performedBy: managerName || 'Manager',
      performedAt: new Date().toLocaleString('en-IN'),
    };

    await commitConfig(
      {
        ...config,
        studentOverrides: nextOverrides,
        promotionLogs: [logEntry, ...config.promotionLogs],
      },
      `🎓 ${selectedPromoStudentIds.length} छात्रों का ${promoActionType} सफलतापूर्वक पूरा हुआ!`
    );
    onPromoteStudentsApplied?.(nextOverrides);
    setSelectedPromoStudentIds([]);
  };

  const activeSessionObj = config.sessions.find((s) => s.id === config.activeSessionId);

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-[140] px-4 py-3 rounded-xl bg-[#0c2340] text-amber-300 font-bold text-xs sm:text-sm shadow-2xl border border-amber-400/50 flex items-center gap-2 animate-fadeIn">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top ERP Header Banner with Live Session Switcher & 2-Way Google Sheet Sync */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#0c2340] text-amber-300 flex items-center justify-center text-xl shrink-0 shadow-sm">
              <i className="fa-solid fa-calendar-week" aria-hidden="true"></i>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  Academics, Timetable &amp; Session ERP
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-black">
                  सक्रिय सत्र: {config.activeSessionId}
                </span>
                {saving && (
                  <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                    <i className="fa-solid fa-circle-notch fa-spin"></i> सेव व सिंक हो रहा है...
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                शैक्षणिक सत्र, कक्षा सेक्शन, विषय-टीचर मैपिंग, पीरियड टाइमिंग, साप्ताहिक टाइमटेबल व छात्र प्रमोशन
              </p>
            </div>
          </div>

          {/* Session Switcher */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
            <span className="text-[11px] font-bold text-slate-600 px-1.5">
              <i className="fa-solid fa-layer-group mr-1 text-indigo-600"></i>
              Session:
            </span>
            <select
              value={config.activeSessionId}
              onChange={(e) => handleSwitchActiveSession(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-900 cursor-pointer focus:border-indigo-600 focus:outline-none"
            >
              {config.sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.isActive ? '(Active)' : ''}
                </option>
              ))}
            </select>
            {activeSessionObj && (
              <span className="text-[11px] text-slate-500 font-medium px-1">
                {activeSessionObj.startDate} → {activeSessionObj.endDate}
              </span>
            )}
          </div>
        </div>

        {/* 2-Way Google Sheet Sync Status & Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-3 border-t border-slate-100 bg-slate-50/70 -mx-1 px-3 py-2.5 rounded-xl">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-black text-slate-700 flex items-center gap-1.5 mr-1">
              <i className="fa-solid fa-cloud-arrow-up text-emerald-600"></i>
              2-Way Google Sheet Tabs:
            </span>
            {['Academics_Config', 'Class_Sections', 'Class_Timetable', 'Teacher_Substitutions'].map(
              (tabName) => (
                <span
                  key={tabName}
                  className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-bold"
                >
                  {tabName}
                </span>
              )
            )}
            {lastSheetSyncState === 'synced' && (
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 font-black">
                ✓ Sheet सिंक सक्रिय
              </span>
            )}
            {lastSheetSyncState === 'local_only' && (
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200 font-black">
                ⚠️ नया Apps Script Deploy आवश्यक
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onRefreshFromSheet && (
              <button
                type="button"
                onClick={handleManualSheetRefresh}
                disabled={isSheetSyncing}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i
                  className={`fa-solid ${isSheetSyncing ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'}`}
                  aria-hidden="true"
                ></i>
                <span>{isSheetSyncing ? 'सिंक हो रहा...' : '🔄 Sheet से सिंक करें'}</span>
              </button>
            )}
            {onOpenSheetSetup && (
              <button
                type="button"
                onClick={onOpenSheetSetup}
                className="px-3 py-1.5 rounded-lg bg-[#0c2340] hover:bg-slate-800 text-amber-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i className="fa-solid fa-code" aria-hidden="true"></i>
                <span>⚙️ Apps Script कोड</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-Navigation Pills */}
      <div className="flex flex-wrap gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-xs">
        {(
          [
            { id: 'timetable', label: 'साप्ताहिक टाइमटेबल (Timetable)', icon: 'fa-table-cells' },
            { id: 'sections', label: 'सेक्शन व विषय (Sections & Subjects)', icon: 'fa-chalkboard' },
            { id: 'periods', label: 'पीरियड टाइमिंग (Period Sets)', icon: 'fa-clock' },
            { id: 'workload', label: 'टीचर लोड व बदली (Free Teacher)', icon: 'fa-user-clock' },
            { id: 'sessions', label: 'सत्र व प्रमोशन (Session & Rollover)', icon: 'fa-graduation-cap' },
          ] as Array<{ id: AcademicsSubTab; label: string; icon: string }>
        ).map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-[13px] font-bold flex items-center gap-2 transition-all cursor-pointer ${
                active
                  ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200'
              }`}
            >
              <i className={`fa-solid ${tab.icon}`} aria-hidden="true"></i>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================================================================= */}
      {/* SUB-TAB 1: WEEKLY CLASS TIMETABLE BUILDER                         */}
      {/* ================================================================= */}
      {subTab === 'timetable' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
          {/* Controls Row */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">कक्षा चुनें (Class)</label>
                <select
                  value={ttClassKey}
                  onChange={(e) => setTtClassKey(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-slate-900 cursor-pointer"
                >
                  {allClassKeys.map((ck) => (
                    <option key={ck} value={ck}>
                      {getClassName(ck)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">सेक्शन (Section)</label>
                <select
                  value={effectiveTtSection}
                  onChange={(e) => setTtSection(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-slate-900 cursor-pointer"
                >
                  {availableSectionsForTt.map((sec) => (
                    <option key={sec.id} value={sec.sectionName}>
                      Section {sec.sectionName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pt-4 sm:pt-5">
                <span className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-900 border border-blue-200 text-xs font-bold inline-flex items-center gap-1.5">
                  <i className="fa-solid fa-clock text-blue-700"></i>
                  {activePeriodSet.name}
                </span>
              </div>
            </div>

            {/* Copy Day Tool + Print */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-700">Copy Day:</span>
              <select
                value={copySourceDay}
                onChange={(e) => setCopySourceDay(e.target.value as WeekdayKey)}
                className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABELS_HI[d]}
                  </option>
                ))}
              </select>
              <span className="text-slate-400 text-xs">→</span>
              <select
                value={copyTargetMode}
                onChange={(e) => setCopyTargetMode(e.target.value as 'all' | WeekdayKey)}
                className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
              >
                <option value="all">सभी अन्य दिन (All Days)</option>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {WEEKDAY_LABELS_HI[d]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCopyDayTimetable}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
              >
                <i className="fa-solid fa-copy mr-1"></i> कॉपी करें
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold cursor-pointer no-print"
              >
                <i className="fa-solid fa-print mr-1"></i> प्रिंट
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
            <span>
              <i className="fa-solid fa-circle-info text-indigo-600 mr-1"></i>
              किसी भी पीरियड बॉक्स पर क्लिक करके विषय, शिक्षक और कमरा नंबर सेट करें (एक ही समय पर डबल टीचर बुकिंग होने पर चेतावनी अपने आप दिखेगी)।
            </span>
          </div>

          {/* Interactive Weekly Grid */}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[780px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#0c2340] text-white">
                  <th className="p-2.5 text-left font-bold border-r border-white/15 w-32">
                    पीरियड / समय
                  </th>
                  {WEEKDAYS.map((day) => (
                    <th key={day} className="p-2.5 text-center font-bold border-r border-white/15 last:border-r-0">
                      <div>{WEEKDAY_LABELS_HI[day]}</div>
                      <div className="text-[10px] font-medium text-amber-300">{day}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activePeriodSet.slots.map((slot) => {
                  if (slot.isBreak) {
                    return (
                      <tr key={slot.id} className="bg-amber-50/90 border-t border-b border-amber-200">
                        <td className="p-2 font-black text-amber-900 border-r border-amber-200">
                          <div>{slot.label}</div>
                          <div className="text-[10px] font-semibold">
                            {formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)}
                          </div>
                        </td>
                        <td colSpan={6} className="p-2 text-center font-black text-amber-900 tracking-wide">
                          <i className="fa-solid fa-utensils mr-1.5"></i>
                          मध्याह्न अवकाश (LUNCH / RECESS BREAK)
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={slot.id} className="border-b border-slate-200 hover:bg-slate-50/60">
                      <td className="p-2.5 bg-slate-50 border-r border-slate-200 align-top">
                        <div className="font-black text-slate-900">{slot.label}</div>
                        <div className="text-[10px] font-semibold text-slate-500 mt-0.5 whitespace-nowrap">
                          {formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)}
                        </div>
                      </td>
                      {WEEKDAYS.map((day) => {
                        const cell = getTimetableCell(day, slot.id);
                        const hasConflict =
                          cell &&
                          cell.teacherId &&
                          findTeacherConflictsAtSlot(config.timetable, {
                            sessionId: config.activeSessionId,
                            day,
                            periodId: slot.id,
                            teacherId: cell.teacherId,
                            ignoreClassKey: ttClassKey,
                            ignoreSectionName: effectiveTtSection,
                          }).length > 0;
                        return (
                          <td
                            key={day}
                            className="p-1.5 border-r border-slate-200 last:border-r-0 align-top"
                          >
                            <button
                              type="button"
                              onClick={() => openTimetableCellEditor(day, slot)}
                              className={`w-full min-h-[66px] p-2 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                hasConflict
                                  ? 'bg-rose-50 border-rose-400 hover:bg-rose-100'
                                  : cell
                                  ? 'bg-indigo-50/70 hover:bg-indigo-100/80 border-indigo-200'
                                  : 'bg-white hover:bg-slate-50 border-dashed border-slate-300 text-slate-400'
                              }`}
                            >
                              {cell ? (
                                <>
                                  <div className="font-extrabold text-slate-900 text-xs leading-tight flex items-center justify-between gap-1">
                                    <span className="truncate">{cell.subjectName}</span>
                                    {hasConflict && (
                                      <i
                                        className="fa-solid fa-triangle-exclamation text-rose-600 shrink-0"
                                        title="Teacher double-booked!"
                                      ></i>
                                    )}
                                  </div>
                                  <div className="text-[11px] font-semibold text-indigo-800 truncate mt-1">
                                    <i className="fa-solid fa-user-tie mr-1 text-[10px]"></i>
                                    {cell.teacherName}
                                  </div>
                                  {cell.roomNumber && (
                                    <div className="text-[10px] text-slate-500 truncate">
                                      {cell.roomNumber}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="flex-1 flex items-center justify-center text-[11px] font-semibold">
                                  + जोड़ें
                                </div>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 2: CLASS SECTIONS, SUBJECTS & SUBJECT-TEACHER MAPPING     */}
      {/* ================================================================= */}
      {subTab === 'sections' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Sections & Class Teacher */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm sm:text-base font-black text-slate-900">
                  कक्षा सेक्शन व विषय-शिक्षक मैपिंग
                </h3>
                <p className="text-xs text-slate-500">
                  सेक्शन (A/B/C), क्लास टीचर और हर विषय का टीचर सेट करें
                </p>
              </div>
              <select
                value={secFilterClass}
                onChange={(e) => {
                  const ck = e.target.value;
                  setSecFilterClass(ck);
                  const first = config.sections.find((s) => s.classKey.toLowerCase() === ck.toLowerCase());
                  if (first) setSelectedSectionId(first.id);
                }}
                className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-slate-900 cursor-pointer"
              >
                {allClassKeys.map((ck) => (
                  <option key={ck} value={ck}>
                    Class {getClassName(ck)}
                  </option>
                ))}
              </select>
            </div>

            {/* Add New Section Bar */}
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <span className="text-xs font-bold text-slate-700">नया सेक्शन जोड़ें:</span>
              <input
                type="text"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="जैसे: B या C"
                className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
              />
              <input
                type="text"
                value={newSectionRoom}
                onChange={(e) => setNewSectionRoom(e.target.value)}
                placeholder="Room No (वैकल्पिक)"
                className="w-36 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
              />
              <button
                type="button"
                onClick={handleAddSection}
                className="px-3 py-1.5 rounded-lg bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-bold cursor-pointer"
              >
                + सेक्शन जोड़ें
              </button>
            </div>

            {/* Section Selector Pills */}
            <div className="flex flex-wrap gap-2">
              {sectionsForSelectedClass.map((sec) => {
                const active = activeSectionObj?.id === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setSelectedSectionId(sec.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer transition-all ${
                      active
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {getClassName(sec.classKey)} - Section {sec.sectionName}
                    {sec.roomNumber ? ` (${sec.roomNumber})` : ''}
                  </button>
                );
              })}
            </div>

            {/* Active Section Settings */}
            {activeSectionObj && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      क्लास टीचर (Class Teacher)
                    </label>
                    <select
                      value={activeSectionObj.classTeacherId || ''}
                      onChange={(e) => {
                        const t = teachers.find((u) => u.User_ID === e.target.value);
                        handleUpdateSectionConfig(
                          {
                            ...activeSectionObj,
                            classTeacherId: t?.User_ID || '',
                            classTeacherName: t?.Name || '',
                          },
                          '✅ क्लास टीचर अपडेट हुआ'
                        );
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
                    >
                      <option value="">-- क्लास टीचर चुनें --</option>
                      {teachers.map((t) => (
                        <option key={t.User_ID} value={t.User_ID}>
                          {t.Name} ({t.Designation})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      कमरा नंबर (Room No.)
                    </label>
                    <input
                      type="text"
                      value={activeSectionObj.roomNumber || ''}
                      onChange={(e) =>
                        handleUpdateSectionConfig({
                          ...activeSectionObj,
                          roomNumber: e.target.value,
                        })
                      }
                      placeholder="जैसे: Room 5"
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800"
                    />
                  </div>
                </div>

                {/* Subject-Teacher Mapping Table */}
                <div className="space-y-2">
                  <div className="text-xs font-black text-slate-800">
                    इस सेक्शन के विषय और विषय-अध्यापक (Subject-Teacher Mapping):
                  </div>
                  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white overflow-hidden">
                    {config.subjects.map((subj) => {
                      const isEnabled = (activeSectionObj.subjectIds || []).includes(subj.id);
                      const assignedTeacherId = activeSectionObj.subjectTeachers?.[subj.id] || '';
                      return (
                        <div
                          key={subj.id}
                          className="p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => {
                                const prevIds = activeSectionObj.subjectIds || [];
                                const nextIds = e.target.checked
                                  ? Array.from(new Set([...prevIds, subj.id]))
                                  : prevIds.filter((id) => id !== subj.id);
                                handleUpdateSectionConfig({
                                  ...activeSectionObj,
                                  subjectIds: nextIds,
                                });
                              }}
                              className="w-4 h-4 accent-indigo-600 cursor-pointer"
                            />
                            <span>{subj.name}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {subj.code}
                            </span>
                            {subj.isElective && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">
                                Elective
                              </span>
                            )}
                          </label>

                          {isEnabled && (
                            <select
                              value={assignedTeacherId}
                              onChange={(e) => {
                                const nextMap = {
                                  ...(activeSectionObj.subjectTeachers || {}),
                                  [subj.id]: e.target.value,
                                };
                                handleUpdateSectionConfig(
                                  {
                                    ...activeSectionObj,
                                    subjectTeachers: nextMap,
                                  },
                                  `✅ ${subj.name} का शिक्षक सेव हुआ`
                                );
                              }}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-800"
                            >
                              <option value="">-- टीचर असाइन करें --</option>
                              {teachers.map((t) => (
                                <option key={t.User_ID} value={t.User_ID}>
                                  {t.Name}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Student Section Assignment */}
            <div className="pt-2 space-y-2">
              <div className="text-xs font-black text-slate-900">
                कक्षा {getClassName(secFilterClass)} के छात्रों का सेक्शन बदलें:
              </div>
              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {students
                  .filter((st) => {
                    const res = resolveStudentClassAndSection(st, config.studentOverrides);
                    return (
                      res.classKey.toLowerCase() === secFilterClass.toLowerCase() ||
                      getClassName(res.classKey).toLowerCase() === getClassName(secFilterClass).toLowerCase()
                    );
                  })
                  .map((st) => {
                    const res = resolveStudentClassAndSection(st, config.studentOverrides);
                    return (
                      <div key={st.Student_ID} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-bold text-slate-900">{st.Student_Name}</span>
                          <span className="text-slate-500 ml-2">Roll: {st.Roll_Number}</span>
                        </div>
                        <select
                          value={res.sectionName}
                          onChange={(e) => handleAssignStudentSection(st, e.target.value)}
                          className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                        >
                          {sectionsForSelectedClass.map((sec) => (
                            <option key={sec.id} value={sec.sectionName}>
                              Section {sec.sectionName}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Right: Subject Master */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4 h-fit">
            <h3 className="text-sm sm:text-base font-black text-slate-900 border-b border-slate-200 pb-2.5">
              विषय मास्टर (Subject Master)
            </h3>

            <form onSubmit={handleAddSubject} className="space-y-2.5 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="text-xs font-bold text-slate-700">नया विषय जोड़ें</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  placeholder="विषय का नाम (जैसे: Moral Science)"
                  required
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                />
                <input
                  type="text"
                  value={newSubjectCode}
                  onChange={(e) => setNewSubjectCode(e.target.value)}
                  placeholder="Code (जैसे: MSC)"
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                />
              </div>
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newSubjectElective}
                    onChange={(e) => setNewSubjectElective(e.target.checked)}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <span>वैकल्पिक विषय (Elective)</span>
                </label>
                <button
                  type="submit"
                  className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-bold cursor-pointer"
                >
                  + विषय जोड़ें
                </button>
              </div>
            </form>

            <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
              {config.subjects.map((s) => (
                <div
                  key={s.id}
                  className="p-2.5 rounded-xl border border-slate-200 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 font-mono font-bold text-[11px]">
                      {s.code}
                    </span>
                    <span className="font-bold text-slate-900">{s.name}</span>
                    {s.isElective && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                        Elective
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const nextSubjects = config.subjects.filter((sub) => sub.id !== s.id);
                      commitConfig({ ...config, subjects: nextSubjects }, `🗑️ "${s.name}" हटाया गया`);
                    }}
                    className="text-rose-500 hover:text-rose-700 px-2 py-1 cursor-pointer"
                    title="हटाएं"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 3: PERIOD TIMING SETS                                     */}
      {/* ================================================================= */}
      {subTab === 'periods' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                पीरियड टाइमिंग सेट (Period Sets &amp; School Bell Timings)
              </h3>
              <p className="text-xs text-slate-500">
                गर्मी/सर्दी या अलग कक्षाओं के लिए पीरियड का समय और लंच ब्रेक तय करें
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newPeriodSetName}
                onChange={(e) => setNewPeriodSetName(e.target.value)}
                placeholder="नया सेट नाम (जैसे: Exam Half-Day)"
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
              />
              <button
                type="button"
                onClick={handleAddPeriodSet}
                className="px-3 py-2 rounded-xl bg-[#0c2340] text-amber-300 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                + नया सेट
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {config.periodSets.map((ps) => (
              <button
                key={ps.id}
                type="button"
                onClick={() => setSelectedPeriodSetId(ps.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${
                  activeEditingPeriodSet?.id === ps.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                {ps.name}
              </button>
            ))}
          </div>

          {activeEditingPeriodSet && (
            <div className="space-y-4">
              {/* Assigned Classes */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="text-xs font-black text-slate-800">
                  यह पीरियड सेट किन कक्षाओं पर लागू होगा (Assign Classes):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const hasAll = activeEditingPeriodSet.assignedClassKeys.includes('ALL');
                      handleSavePeriodSet(
                        {
                          ...activeEditingPeriodSet,
                          assignedClassKeys: hasAll ? [] : ['ALL'],
                        },
                        '✅ पीरियड सेट क्लास अपडेट हुई'
                      );
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                      activeEditingPeriodSet.assignedClassKeys.includes('ALL')
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-slate-700 border-slate-300'
                    }`}
                  >
                    सभी कक्षाएं (All Classes)
                  </button>
                  {allClassKeys.map((ck) => {
                    const active = activeEditingPeriodSet.assignedClassKeys.includes(ck);
                    return (
                      <button
                        key={ck}
                        type="button"
                        onClick={() => {
                          const filtered = activeEditingPeriodSet.assignedClassKeys.filter(
                            (x) => x !== 'ALL'
                          );
                          const next = active
                            ? filtered.filter((x) => x !== ck)
                            : [...filtered, ck];
                          handleSavePeriodSet({
                            ...activeEditingPeriodSet,
                            assignedClassKeys: next,
                          });
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-700 border-slate-300'
                        }`}
                      >
                        {getClassName(ck)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Slots Table */}
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold">
                    <tr>
                      <th className="p-2.5 text-left">नाम (Label)</th>
                      <th className="p-2.5 text-left">प्रकार</th>
                      <th className="p-2.5 text-left">Start Time</th>
                      <th className="p-2.5 text-left">End Time</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {activeEditingPeriodSet.slots.map((slot, idx) => (
                      <tr key={slot.id} className={slot.isBreak ? 'bg-amber-50/60' : 'bg-white'}>
                        <td className="p-2">
                          <input
                            type="text"
                            value={slot.label}
                            onChange={(e) => {
                              const nextSlots = [...activeEditingPeriodSet.slots];
                              nextSlots[idx] = { ...slot, label: e.target.value };
                              handleSavePeriodSet({ ...activeEditingPeriodSet, slots: nextSlots });
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-300 font-bold w-40"
                          />
                        </td>
                        <td className="p-2">
                          <select
                            value={slot.isBreak ? 'break' : 'class'}
                            onChange={(e) => {
                              const nextSlots = [...activeEditingPeriodSet.slots];
                              nextSlots[idx] = {
                                ...slot,
                                isBreak: e.target.value === 'break',
                              };
                              handleSavePeriodSet({ ...activeEditingPeriodSet, slots: nextSlots });
                            }}
                            className="px-2 py-1 rounded-lg border border-slate-300 font-semibold"
                          >
                            <option value="class">Class Period</option>
                            <option value="break">Lunch / Break</option>
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="time"
                            value={slot.startTime}
                            onChange={(e) => {
                              const nextSlots = [...activeEditingPeriodSet.slots];
                              nextSlots[idx] = { ...slot, startTime: e.target.value };
                              handleSavePeriodSet({ ...activeEditingPeriodSet, slots: nextSlots });
                            }}
                            className="px-2 py-1 rounded-lg border border-slate-300 font-mono"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="time"
                            value={slot.endTime}
                            onChange={(e) => {
                              const nextSlots = [...activeEditingPeriodSet.slots];
                              nextSlots[idx] = { ...slot, endTime: e.target.value };
                              handleSavePeriodSet({ ...activeEditingPeriodSet, slots: nextSlots });
                            }}
                            className="px-2 py-1 rounded-lg border border-slate-300 font-mono"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              const nextSlots = activeEditingPeriodSet.slots.filter(
                                (_, i) => i !== idx
                              );
                              handleSavePeriodSet(
                                { ...activeEditingPeriodSet, slots: nextSlots },
                                '🗑️ स्लॉट हटाया गया'
                              );
                            }}
                            className="text-rose-600 hover:text-rose-800 px-2 py-1 cursor-pointer"
                          >
                            <i className="fa-solid fa-trash-can"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const nextNum =
                      activeEditingPeriodSet.slots.filter((s) => !s.isBreak).length + 1;
                    const newSlot: PeriodSlot = {
                      id: `p_${Date.now().toString(36)}`,
                      periodNumber: nextNum,
                      label: `Period ${nextNum}`,
                      startTime: '13:45',
                      endTime: '14:20',
                    };
                    handleSavePeriodSet(
                      {
                        ...activeEditingPeriodSet,
                        slots: [...activeEditingPeriodSet.slots, newSlot],
                      },
                      '✅ नया पीरियड जोड़ा गया'
                    );
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                >
                  + नया Period जोड़ें
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const newSlot: PeriodSlot = {
                      id: `brk_${Date.now().toString(36)}`,
                      periodNumber: 0,
                      label: 'Short Break',
                      startTime: '10:40',
                      endTime: '11:00',
                      isBreak: true,
                    };
                    handleSavePeriodSet(
                      {
                        ...activeEditingPeriodSet,
                        slots: [...activeEditingPeriodSet.slots, newSlot],
                      },
                      '✅ Break जोड़ा गया'
                    );
                  }}
                  className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold cursor-pointer"
                >
                  + Break / Lunch जोड़ें
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 4: TEACHER WORKLOAD, FREE TEACHER FINDER & SUBSTITUTION   */}
      {/* ================================================================= */}
      {subTab === 'workload' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Free Teacher Finder + Assign Substitution */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                खाली शिक्षक खोजें व अस्थायी बदली (Find Free Teacher &amp; Substitution)
              </h3>
              <p className="text-xs text-slate-500">
                किसी भी दिन और पीरियड में देखें कौन-से शिक्षक खाली हैं और तुरंत Substitution असाइन करें
              </p>
            </div>

            {absentOrLeaveToday.length > 0 && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
                <div className="font-black mb-1">
                  <i className="fa-solid fa-user-xmark mr-1"></i>
                  आज छुट्टी / अनुपस्थित स्टाफ ({absentOrLeaveToday.length}):
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {absentOrLeaveToday.map((r) => (
                    <span key={r.id} className="px-2 py-0.5 rounded-lg bg-white border border-rose-200 font-bold">
                      {r.name} ({r.status})
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">तारीख (Date)</label>
                <input
                  type="date"
                  value={finderDate}
                  onChange={(e) => setFinderDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">दिन (Day)</label>
                <select
                  value={finderDay}
                  onChange={(e) => setFinderDay(e.target.value as WeekdayKey)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAY_LABELS_HI[d]} ({d})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">पीरियड (Period)</label>
                <select
                  value={finderPeriodId}
                  onChange={(e) => setFinderPeriodId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  {activePeriodSet.slots
                    .filter((s) => !s.isBreak)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label} ({formatTime12Hr(s.startTime)})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2">
                <div className="text-xs font-black text-emerald-900">
                  ✅ खाली शिक्षक (Free Teachers · {freeBusySlot.freeTeachers.length})
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {freeBusySlot.freeTeachers.map((t) => (
                    <div
                      key={t.User_ID}
                      className="p-2 rounded-lg bg-white border border-emerald-200 flex items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-900">{t.Name}</div>
                        <div className="text-[10px] text-slate-500">{t.Assigned_Subjects || t.Designation}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSubTargetTeacherId(t.User_ID)}
                        className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer"
                      >
                        चुनें
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="text-xs font-black text-slate-800">
                  📚 व्यस्त शिक्षक (Busy · {freeBusySlot.busyTeachers.length})
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {freeBusySlot.busyTeachers.length === 0 ? (
                    <p className="text-[11px] text-slate-500">इस पीरियड में अभी कोई क्लास असाइन नहीं है।</p>
                  ) : (
                    freeBusySlot.busyTeachers.map(({ teacher, assignmentLabel }) => (
                      <div
                        key={teacher.User_ID}
                        className="p-2 rounded-lg bg-white border border-slate-200 text-xs"
                      >
                        <div className="font-bold text-slate-900">{teacher.Name}</div>
                        <div className="text-[10px] text-indigo-700 font-semibold">{assignmentLabel}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Assign Substitution Form */}
            <form onSubmit={handleCreateSubstitution} className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-3">
              <div className="text-xs font-black text-indigo-950">
                <i className="fa-solid fa-repeat mr-1.5"></i>
                बदली ड्यूटी असाइन करें (Assign Substitution)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={subClassKey}
                  onChange={(e) => setSubClassKey(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  {allClassKeys.map((ck) => (
                    <option key={ck} value={ck}>
                      {getClassName(ck)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={subSectionName}
                  onChange={(e) => setSubSectionName(e.target.value.toUpperCase())}
                  placeholder="Section (A)"
                  className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                />
                <input
                  type="text"
                  value={subSubjectName}
                  onChange={(e) => setSubSubjectName(e.target.value)}
                  placeholder="विषय / गतिविधि"
                  className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  value={subOrigTeacherId}
                  onChange={(e) => setSubOrigTeacherId(e.target.value)}
                  className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs"
                >
                  <option value="">छुट्टी वाले टीचर (वैकल्पिक)</option>
                  {teachers.map((t) => (
                    <option key={t.User_ID} value={t.User_ID}>
                      {t.Name}
                    </option>
                  ))}
                </select>
                <select
                  value={subTargetTeacherId}
                  onChange={(e) => setSubTargetTeacherId(e.target.value)}
                  required
                  className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  <option value="">-- बदली टीचर चुनें --</option>
                  {teachers.map((t) => (
                    <option key={t.User_ID} value={t.User_ID}>
                      {t.Name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={subReason}
                  onChange={(e) => setSubReason(e.target.value)}
                  placeholder="कारण"
                  className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-bold cursor-pointer"
              >
                + बदली असाइन करें
              </button>
            </form>

            {/* Recent Substitutions */}
            {config.substitutions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-black text-slate-800">हाल के बदली असाइनमेंट:</div>
                {config.substitutions.slice(0, 6).map((s) => (
                  <div
                    key={s.id}
                    className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{s.substituteTeacherName}</span>
                      <span className="text-slate-600">
                        {' '}→ {getClassName(s.classKey)}-{s.sectionName} ({s.periodLabel}, {s.date})
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        commitConfig({
                          ...config,
                          substitutions: config.substitutions.filter((x) => x.id !== s.id),
                        })
                      }
                      className="text-rose-600 cursor-pointer"
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Weekly Teacher Workload */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3 h-fit">
            <h3 className="text-sm sm:text-base font-black text-slate-900 border-b border-slate-200 pb-2.5">
              शिक्षक साप्ताहिक कार्यभार (Teacher Workload)
            </h3>
            <div className="space-y-2.5 max-h-[540px] overflow-y-auto">
              {workloadList.map(({ teacher, periodsPerWeek, classes, subjects }) => (
                <div
                  key={teacher.User_ID}
                  className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-xs sm:text-sm text-slate-900">{teacher.Name}</div>
                    <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-black tabular-nums">
                      {periodsPerWeek} Periods/Week
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 rounded-full"
                      style={{ width: `${Math.min(100, Math.round((periodsPerWeek / 42) * 100))}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>कक्षाएं: {classes.length > 0 ? classes.join(', ') : '—'}</span>
                    <span>विषय: {subjects.length > 0 ? subjects.join(', ') : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 5: SESSIONS & YEAR-END STUDENT PROMOTION WIZARD           */}
      {/* ================================================================= */}
      {subTab === 'sessions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Sessions List */}
          <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4 h-fit">
            <h3 className="text-sm sm:text-base font-black text-slate-900 border-b border-slate-200 pb-2.5">
              शैक्षणिक सत्र प्रबंधन (Academic Sessions)
            </h3>

            <form onSubmit={handleAddSession} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="text-xs font-bold text-slate-700">नया शैक्षणिक सत्र जोड़ें</div>
              <input
                type="text"
                value={newSessionId}
                onChange={(e) => setNewSessionId(e.target.value)}
                placeholder="जैसे: 2027-28"
                required
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500">Start Date</label>
                  <input
                    type="date"
                    value={newSessionStart}
                    onChange={(e) => setNewSessionStart(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500">End Date</label>
                  <input
                    type="date"
                    value={newSessionEnd}
                    onChange={(e) => setNewSessionEnd(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                  />
                </div>
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-bold cursor-pointer"
              >
                + नया सत्र जोड़ें
              </button>
            </form>

            <div className="space-y-2">
              {config.sessions.map((sess) => (
                <div
                  key={sess.id}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                    sess.isActive
                      ? 'bg-emerald-50 border-emerald-300'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div>
                    <div className="font-black text-xs sm:text-sm text-slate-900 flex items-center gap-2">
                      <span>{sess.name}</span>
                      {sess.isActive && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {sess.startDate} से {sess.endDate}
                    </div>
                  </div>
                  {!sess.isActive && (
                    <button
                      type="button"
                      onClick={() => handleSwitchActiveSession(sess.id)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                    >
                      सक्रिय करें
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Year-End Student Promotion Wizard */}
          <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4">
            <div className="border-b border-slate-200 pb-2.5">
              <h3 className="text-sm sm:text-base font-black text-slate-900">
                Year-End Rollover / छात्र कक्षा प्रमोशन (Promote Students)
              </h3>
              <p className="text-xs text-slate-500">
                साल के अंत में छात्रों को अगली कक्षा में प्रमोट करें या पिछली कक्षा में रोकें (Detain / Passout)
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">मौजूदा कक्षा (From)</label>
                <select
                  value={promoFromClass}
                  onChange={(e) => {
                    const ck = e.target.value;
                    setPromoFromClass(ck);
                    setPromoToClass(getNextClassSuggestion(ck, allClassKeys));
                    setSelectedPromoStudentIds([]);
                  }}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  {allClassKeys.map((ck) => (
                    <option key={ck} value={ck}>
                      {getClassName(ck)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">From Section</label>
                <input
                  type="text"
                  value={promoFromSection}
                  onChange={(e) => setPromoFromSection(e.target.value.toUpperCase())}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">Action</label>
                <select
                  value={promoActionType}
                  onChange={(e) => setPromoActionType(e.target.value as 'Promote' | 'Detain' | 'Passout')}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  <option value="Promote">Promote (अगली कक्षा)</option>
                  <option value="Detain">Detain (उसी कक्षा में)</option>
                  <option value="Passout">Passout / TC</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">लक्ष्य सत्र</label>
                <select
                  value={promoTargetSession}
                  onChange={(e) => setPromoTargetSession(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-bold"
                >
                  {config.sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {promoActionType === 'Promote' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-indigo-50/60 p-3 rounded-xl border border-indigo-200">
                <div>
                  <label className="block text-[11px] font-bold text-indigo-900 mb-1">नई कक्षा (Promote To Class)</label>
                  <select
                    value={promoToClass}
                    onChange={(e) => setPromoToClass(e.target.value)}
                    className="w-full px-2.5 py-2 rounded-lg border border-indigo-300 bg-white text-xs font-bold"
                  >
                    {allClassKeys.map((ck) => (
                      <option key={ck} value={ck}>
                        {getClassName(ck)}
                      </option>
                    ))}
                    <option value="Passout">Passout / Alumni</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-indigo-900 mb-1">To Section</label>
                  <input
                    type="text"
                    value={promoToSection}
                    onChange={(e) => setPromoToSection(e.target.value.toUpperCase())}
                    className="w-full px-2.5 py-2 rounded-lg border border-indigo-300 bg-white text-xs font-bold"
                  />
                </div>
              </div>
            )}

            {/* Student Selection List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800">
                  छात्र चुनें ({selectedPromoStudentIds.length} / {promoSourceStudents.length} चयनित)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedPromoStudentIds(promoSourceStudents.map((s) => s.Student_ID))}
                    className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer"
                  >
                    सभी चुनें
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedPromoStudentIds([])}
                    className="text-xs font-bold text-slate-500 hover:underline cursor-pointer"
                  >
                    साफ़ करें
                  </button>
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                {promoSourceStudents.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    इस कक्षा/सेक्शन में कोई छात्र नहीं मिला।
                  </div>
                ) : (
                  promoSourceStudents.map((st) => {
                    const checked = selectedPromoStudentIds.includes(st.Student_ID);
                    return (
                      <label
                        key={st.Student_ID}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setSelectedPromoStudentIds((prev) =>
                                e.target.checked
                                  ? [...prev, st.Student_ID]
                                  : prev.filter((id) => id !== st.Student_ID)
                              );
                            }}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          <div>
                            <div className="font-bold text-slate-900">{st.Student_Name}</div>
                            <div className="text-[11px] text-slate-500">
                              Adm: {st.Admission_Number} · Roll: {st.Roll_Number} · Father: {st.Father_Name}
                            </div>
                          </div>
                        </div>
                        <span className="text-[11px] font-bold text-slate-600">
                          {getClassName(st.Class)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>

              <button
                type="button"
                onClick={handleExecutePromotion}
                disabled={selectedPromoStudentIds.length === 0}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs sm:text-sm font-black cursor-pointer shadow-sm"
              >
                <i className="fa-solid fa-graduation-cap mr-1.5"></i>
                चयनित {selectedPromoStudentIds.length} छात्रों को {promoActionType} करें
              </button>
            </div>

            {config.promotionLogs.length > 0 && (
              <div className="pt-3 border-t border-slate-200 space-y-1.5">
                <div className="text-xs font-black text-slate-800">प्रमोशन इतिहास (Promotion Log):</div>
                {config.promotionLogs.slice(0, 5).map((log) => (
                  <div
                    key={log.id}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] flex items-center justify-between gap-2"
                  >
                    <span>
                      <strong>{log.studentCount} छात्र</strong> ({getClassName(log.fromClass)}-{log.fromSection} →{' '}
                      {getClassName(log.toClass)}-{log.toSection}) · {log.actionType}
                    </span>
                    <span className="text-slate-500">{log.performedAt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* CELL EDITOR MODAL FOR TIMETABLE                                   */}
      {/* ================================================================= */}
      {editingCell && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingCell(null);
          }}
          className="fixed inset-0 z-[130] bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#0c2340] text-white px-4 py-3 flex items-center justify-between">
              <div>
                <h4 className="font-black text-sm text-amber-300">
                  {getClassName(ttClassKey)} - Section {effectiveTtSection}
                </h4>
                <p className="text-[11px] text-blue-100">
                  {WEEKDAY_LABELS_HI[editingCell.day]} · {editingCell.slot.label} (
                  {formatTime12Hr(editingCell.slot.startTime)} – {formatTime12Hr(editingCell.slot.endTime)})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">विषय (Subject)</label>
                <select
                  value={editingCell.subjectId}
                  onChange={(e) => {
                    const sid = e.target.value;
                    const secCfg = availableSectionsForTt.find((s) => s.sectionName === effectiveTtSection);
                    const autoTeacher = secCfg?.subjectTeachers?.[sid] || editingCell.teacherId;
                    setEditingCell({ ...editingCell, subjectId: sid, teacherId: autoTeacher });
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                >
                  {config.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">शिक्षक (Teacher)</label>
                <select
                  value={editingCell.teacherId}
                  onChange={(e) => setEditingCell({ ...editingCell, teacherId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold"
                >
                  <option value="">-- शिक्षक चुनें --</option>
                  {teachers.map((t) => (
                    <option key={t.User_ID} value={t.User_ID}>
                      {t.Name}
                    </option>
                  ))}
                </select>
              </div>

              {editingCellConflicts.length > 0 && (
                <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-300 text-xs text-rose-800">
                  <div className="font-black flex items-center gap-1.5">
                    <i className="fa-solid fa-triangle-exclamation"></i>
                    <span>शिक्षक टकराव चेतावनी (Double-Booking Conflict)!</span>
                  </div>
                  <div className="mt-1">
                    यह शिक्षक इसी समय पहले से पढ़ा रहे हैं:{' '}
                    {editingCellConflicts
                      .map((c) => `${getClassName(c.classKey)}-${c.sectionName} (${c.subjectName})`)
                      .join(', ')}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">कमरा नं. (Room No.)</label>
                <input
                  type="text"
                  value={editingCell.roomNumber}
                  onChange={(e) => setEditingCell({ ...editingCell, roomNumber: e.target.value })}
                  placeholder="जैसे: Room 4"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold"
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleDeleteTimetableCell}
                  className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold cursor-pointer"
                >
                  हटाएं
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingCell(null)}
                    className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                  >
                    रद्द करें
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTimetableCell}
                    className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-black cursor-pointer"
                  >
                    सेव करें
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AcademicsManagerView;
