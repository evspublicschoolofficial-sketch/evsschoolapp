import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HallPassConfig, SchoolUser, Student } from '../types';
import { getLocalTimestamp } from '../utils/localTime';
import { realtimeSync } from '../utils/realtimeSync';
import {
  buildAutoBalancedRoomConfigs,
  buildExamSeatingPlanFromHistoryEntry,
  buildSeatingArchiveKey,
  clearRoomAllocations,
  deleteExamSeatingHistoryEntry,
  ExamSeatingHistoryEntry,
  ExamSeatingSnapshot,
  fetchExamSeatingHistory,
  fetchExamSeatingPlanSnapshot,
  findTeacherAssignedRooms,
  formatExamDateDisplay,
  generateCustomSeatingPlan,
  generateExamSeatingPlanPdf,
  getTodayIstDateKey,
  loadLocalSeatingHistory,
  loadLocalSeatingWorkflow,
  normalizeExamDateKey,
  RoomStudentCheckInStatus,
  saveExamSeatingPlanToSheet,
  saveExamSeatingRoomDispatch,
  saveLocalSeatingWorkflow,
  saveTeacherSeatingDraft,
  SeatingDistributionMode,
  SeatingPlanApprovalStatus,
  SeatingPlanConfigPayload,
  SeatingRoomConfig,
  TeacherAssignedRoomView,
} from '../utils/seatingPlanHelper';

interface ExamSeatingPlanViewProps {
  students: Student[];
  config: HallPassConfig;
  getClassName: (cls?: string | null) => string;
  onOpenSheetSetup?: () => void;
  userRole?: 'teacher' | 'manager';
  currentUserName?: string;
  currentUserId?: string;
  users?: SchoolUser[];
  initialSubTab?: 'my_room' | 'planner' | 'history';
}

const CLASS_BADGE_COLORS: Record<string, string> = {
  C1: 'bg-pink-50 text-pink-900 border-pink-200',
  C2: 'bg-sky-50 text-sky-900 border-sky-200',
  C3: 'bg-indigo-50 text-indigo-900 border-indigo-200',
  C4: 'bg-violet-50 text-violet-900 border-violet-200',
  C5: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  C6: 'bg-amber-50 text-amber-900 border-amber-200',
  C7: 'bg-cyan-50 text-cyan-900 border-cyan-200',
  C8: 'bg-rose-50 text-rose-900 border-rose-200',
  C9: 'bg-teal-50 text-teal-900 border-teal-200',
  C10: 'bg-orange-50 text-orange-900 border-orange-200',
  C11: 'bg-lime-50 text-lime-900 border-lime-200',
  C12: 'bg-purple-50 text-purple-900 border-purple-200',
};

export const ExamSeatingPlanView: React.FC<ExamSeatingPlanViewProps> = ({
  students,
  config,
  getClassName,
  onOpenSheetSetup,
  userRole = 'manager',
  currentUserName = '',
  currentUserId = '',
  users = [],
  initialSubTab,
}) => {
  const [initialBoot] = useState(() => {
    const local = loadLocalSeatingWorkflow();
    if (local && local.rooms.length > 0) return local;
    return null;
  });

  const [roomConfigs, setRoomConfigs] = useState<SeatingRoomConfig[]>(() => {
    if (initialBoot) return initialBoot.rooms;
    return buildAutoBalancedRoomConfigs({ students, getClassName });
  });
  const [seatsPerBench, setSeatsPerBench] = useState<number>(() => initialBoot?.seatsPerBench ?? 3);
  const [mode, setMode] = useState<SeatingDistributionMode>(() => initialBoot?.mode ?? 'anti_cheating_mixed');
  const [examDate, setExamDate] = useState<string>(() =>
    initialBoot?.examDate ? normalizeExamDateKey(initialBoot.examDate) : getTodayIstDateKey()
  );
  const [examShift, setExamShift] = useState<string>(() => initialBoot?.examShift ?? '');
  const [workflowStatus, setWorkflowStatus] = useState<SeatingPlanApprovalStatus>(
    () => initialBoot?.status ?? 'draft'
  );
  const [submittedBy, setSubmittedBy] = useState<string>(() => initialBoot?.submittedBy ?? '');
  const [submittedAt, setSubmittedAt] = useState<string>(() => initialBoot?.submittedAt ?? '');
  const [approvedBy, setApprovedBy] = useState<string>(() => initialBoot?.approvedBy ?? '');
  const [approvedAt, setApprovedAt] = useState<string>(() => initialBoot?.approvedAt ?? '');
  const [teacherNote, setTeacherNote] = useState<string>(() => initialBoot?.teacherNote ?? '');
  const [managerNote, setManagerNote] = useState<string>(() => initialBoot?.managerNote ?? '');

  const [serverSnapshot, setServerSnapshot] = useState<ExamSeatingSnapshot | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'my_room' | 'planner' | 'history'>(() =>
    initialSubTab || (userRole === 'teacher' ? 'my_room' : 'planner')
  );
  const userTouchedSubTabRef = useRef<boolean>(Boolean(initialSubTab));

  const [selectedRoomKey, setSelectedRoomKey] = useState<string>('ALL');
  const [showMatrixEditor, setShowMatrixEditor] = useState<boolean>(true);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState<boolean>(false);
  const [submittingDraft, setSubmittingDraft] = useState<boolean>(false);
  const [savingToSheet, setSavingToSheet] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sheetWarning, setSheetWarning] = useState<string | null>(null);
  const [hasLoadedServerOnce, setHasLoadedServerOnce] = useState<boolean>(false);
  const [manualInvigSlots, setManualInvigSlots] = useState<Record<string, boolean>>({});

  // Teacher My Exam Room Duty states
  const [selectedMyRoomKey, setSelectedMyRoomKey] = useState<string>('');
  const [roomStatusDrafts, setRoomStatusDrafts] = useState<Record<string, RoomStudentCheckInStatus>>({});
  const [roomNoteDraft, setRoomNoteDraft] = useState<string>('');
  const [roomStudentSearch, setRoomStudentSearch] = useState<string>('');
  const [roomStatusFilter, setRoomStatusFilter] = useState<'ALL' | RoomStudentCheckInStatus>('ALL');
  const [roomClassFilter, setRoomClassFilter] = useState<string>('ALL');
  const [roomViewMode, setRoomViewMode] = useState<'list' | 'bench'>('list');
  const [savingRoomDispatch, setSavingRoomDispatch] = useState<boolean>(false);

  // History Archive & Search state
  const [historyEntries, setHistoryEntries] = useState<ExamSeatingHistoryEntry[]>(() =>
    loadLocalSeatingHistory()
  );
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [historySheetSynced, setHistorySheetSynced] = useState<boolean>(true);
  const [searchStudentQuery, setSearchStudentQuery] = useState<string>('');
  const [searchClassFilter, setSearchClassFilter] = useState<string>('ALL');
  const [searchInvigilatorQuery, setSearchInvigilatorQuery] = useState<string>('');
  const [searchDateFilter, setSearchDateFilter] = useState<string>('');
  const [selectedHistoryKey, setSelectedHistoryKey] = useState<string | null>(null);
  const [historyRoomFilter, setHistoryRoomFilter] = useState<string>('ALL');
  const [deletingHistoryKey, setDeletingHistoryKey] = useState<string | null>(null);

  // If initial students arrived after first render and local storage was empty & allocations are all 0, auto-seed once
  useEffect(() => {
    if (initialBoot || hasLoadedServerOnce || students.length === 0) return;
    const totalAllocated = roomConfigs.reduce<number>(
      (sum, r) => sum + Object.values(r.classCounts || {}).reduce<number>((s, v) => s + (Number(v) || 0), 0),
      0
    );
    if (totalAllocated === 0) {
      setRoomConfigs(buildAutoBalancedRoomConfigs({ students, getClassName, existingRooms: roomConfigs }));
    }
  }, [students.length]);

  const applyServerPayload = (payload: SeatingPlanConfigPayload) => {
    setRoomConfigs(payload.rooms);
    setSeatsPerBench([2, 3, 4].includes(payload.seatsPerBench) ? payload.seatsPerBench : 3);
    setMode(payload.mode === 'class_grouped' ? 'class_grouped' : 'anti_cheating_mixed');
    if (payload.examDate) setExamDate(normalizeExamDateKey(payload.examDate));
    if (payload.examShift !== undefined) setExamShift(payload.examShift || '');
    setWorkflowStatus(payload.status || 'draft');
    setSubmittedBy(payload.submittedBy || '');
    setSubmittedAt(payload.submittedAt || '');
    setApprovedBy(payload.approvedBy || '');
    setApprovedAt(payload.approvedAt || '');
    setTeacherNote(payload.teacherNote || '');
    setManagerNote(payload.managerNote || '');
    saveLocalSeatingWorkflow(payload);
  };

  const loadFromServer = async (showFeedback = false) => {
    setRefreshingSnapshot(true);
    try {
      const snap = await fetchExamSeatingPlanSnapshot(true);
      setHasLoadedServerOnce(true);
      if (snap) {
        setServerSnapshot(snap);
        const chosen = snap.draftConfig || snap.approvedConfig;
        if (chosen && Array.isArray(chosen.rooms) && chosen.rooms.length > 0) {
          applyServerPayload(chosen);
          if (showFeedback) {
            setNotice(
              chosen.status === 'pending_approval'
                ? `✓ टीचर (${chosen.submittedBy || 'Teacher'}) द्वारा भेजा गया नया प्लान लोड हो गया है।`
                : '✓ सर्वर व Google Sheet से ताज़ा सीटिंग प्लान लोड हो गया है।'
            );
            setTimeout(() => setNotice(null), 4500);
          }
        } else if (showFeedback) {
          setNotice('सर्वर पर अभी कोई नया सबमिट किया गया ड्राफ्ट नहीं मिला।');
          setTimeout(() => setNotice(null), 3500);
        }
      }
    } catch {
      if (showFeedback) setErrorMsg('सर्वर से ताज़ा डेटा लाने में समस्या हुई।');
    } finally {
      setRefreshingSnapshot(false);
    }
  };

  const loadHistoryFromServer = async (showFeedback = false) => {
    setLoadingHistory(true);
    try {
      const res = await fetchExamSeatingHistory(showFeedback);
      setHistoryEntries(res.entries);
      setHistorySheetSynced(res.sheetSynced);
      if (showFeedback) {
        setNotice(`✓ कुल ${res.entries.length} तारीख/शिफ्ट के सीटिंग रिकॉर्ड लोड हो गए हैं।`);
        setTimeout(() => setNotice(null), 4000);
      }
    } catch {
      if (showFeedback) setErrorMsg('हिस्ट्री रिकॉर्ड लाने में समस्या आई।');
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadFromServer(false);
    loadHistoryFromServer(false);
    const unsub = realtimeSync.subscribe((ev) => {
      if (ev.entity === 'exam_seating_plan') {
        loadFromServer(false);
        loadHistoryFromServer(false);
      }
    });
    return () => unsub();
  }, []);

  const seatingPlan = useMemo(
    () =>
      generateCustomSeatingPlan({
        students,
        getClassName,
        roomConfigs,
        seatsPerBench,
        mode,
      }),
    [students, getClassName, roomConfigs, seatsPerBench, mode]
  );

  const visibleRooms = useMemo(() => {
    if (selectedRoomKey === 'ALL') return seatingPlan.rooms;
    return seatingPlan.rooms.filter((r) => r.slotKey === selectedRoomKey);
  }, [seatingPlan.rooms, selectedRoomKey]);

  const overAllocatedClasses = useMemo(
    () => seatingPlan.classSummaries.filter((c) => c.overAllocatedBy > 0),
    [seatingPlan.classSummaries]
  );

  // Sorted Teachers list for Invigilator dropdown
  const teacherOptions = useMemo(() => {
    const teachersOnly = users.filter((u) => {
      const des = String(u.Designation || '').toLowerCase();
      return !/driver|peon|helper|bus|van|guard/i.test(des);
    });
    return [...teachersOnly].sort((a, b) => {
      const aIsTeacher = /teacher|faculty|instructor/i.test(String(a.Designation || '')) ? 0 : 1;
      const bIsTeacher = /teacher|faculty|instructor/i.test(String(b.Designation || '')) ? 0 : 1;
      if (aIsTeacher !== bIsTeacher) return aIsTeacher - bIsTeacher;
      return String(a.Name || '').localeCompare(String(b.Name || ''));
    });
  }, [users]);

  // Teacher Assigned Exam Rooms (morning duty & room check-in)
  const myAssignedRooms = useMemo<TeacherAssignedRoomView[]>(() => {
    if (userRole !== 'teacher' || (!currentUserId && !currentUserName)) return [];
    const fallbackSnapshot: ExamSeatingSnapshot = serverSnapshot || {
      rows: [],
      roomMeta: {},
      draftConfig: {
        rooms: roomConfigs,
        seatsPerBench,
        mode,
        status: workflowStatus,
        examDate,
        examShift,
      },
      approvedConfig:
        workflowStatus === 'approved'
          ? {
              rooms: roomConfigs,
              seatsPerBench,
              mode,
              status: 'approved',
              examDate,
              examShift,
            }
          : null,
      roomDispatches: {},
    };
    return findTeacherAssignedRooms({
      snapshot: fallbackSnapshot,
      historyEntries,
      students,
      getClassName,
      config,
      teacherId: currentUserId,
      teacherName: currentUserName,
    });
  }, [
    userRole,
    currentUserId,
    currentUserName,
    serverSnapshot,
    roomConfigs,
    seatsPerBench,
    mode,
    workflowStatus,
    examDate,
    examShift,
    historyEntries,
    students,
    getClassName,
    config,
  ]);

  // Keep selectedMyRoomKey synced cleanly & auto-select 'planner' if teacher has no assigned room after load
  useEffect(() => {
    if (userRole !== 'teacher') return;
    if (myAssignedRooms.length > 0) {
      const stillValid = myAssignedRooms.some(
        (r) => `${r.archiveKey}::${r.slotKey}` === selectedMyRoomKey
      );
      if (!stillValid) {
        const first = myAssignedRooms[0];
        setSelectedMyRoomKey(`${first.archiveKey}::${first.slotKey}`);
      }
      if (!userTouchedSubTabRef.current && activeSubTab !== 'my_room') {
        setActiveSubTab('my_room');
      }
    } else if (hasLoadedServerOnce && !userTouchedSubTabRef.current && activeSubTab === 'my_room') {
      setActiveSubTab('planner');
    }
  }, [userRole, myAssignedRooms, hasLoadedServerOnce]);

  const activeMyRoom = useMemo(() => {
    if (myAssignedRooms.length === 0) return null;
    return (
      myAssignedRooms.find((r) => `${r.archiveKey}::${r.slotKey}` === selectedMyRoomKey) ||
      myAssignedRooms[0]
    );
  }, [myAssignedRooms, selectedMyRoomKey]);

  // Seed draft statuses & note whenever activeMyRoom changes or updates from server
  useEffect(() => {
    if (!activeMyRoom) return;
    const nextMap: Record<string, RoomStudentCheckInStatus> = {};
    activeMyRoom.studentsList.forEach((st) => {
      nextMap[st.studentId] = st.roomCheckInStatus;
    });
    setRoomStatusDrafts(nextMap);
    setRoomNoteDraft(activeMyRoom.note || '');
  }, [
    activeMyRoom?.archiveKey,
    activeMyRoom?.slotKey,
    activeMyRoom?.dispatchedAt,
    activeMyRoom?.sentCount,
    activeMyRoom?.absentCount,
  ]);

  useEffect(() => {
    setRoomClassFilter('ALL');
  }, [activeMyRoom?.archiveKey, activeMyRoom?.slotKey]);

  const activeArchiveKey = useMemo(
    () => buildSeatingArchiveKey(examDate, examShift),
    [examDate, examShift]
  );

  // History filter derived collections
  const historyClassOptions = useMemo(() => {
    const set = new Set<string>();
    historyEntries.forEach((entry) => {
      entry.rows.forEach((r) => {
        if (r.className) set.add(r.className);
      });
    });
    return Array.from(set);
  }, [historyEntries]);

  const historyInvigilatorOptions = useMemo(() => {
    const set = new Set<string>();
    historyEntries.forEach((entry) => {
      entry.rows.forEach((r) => {
        if (r.invigilator && r.invigilator.trim()) set.add(r.invigilator.trim());
      });
    });
    return Array.from(set).sort();
  }, [historyEntries]);

  const isHistoryFilterActive = Boolean(
    searchStudentQuery.trim() ||
      searchClassFilter !== 'ALL' ||
      searchInvigilatorQuery.trim() ||
      searchDateFilter.trim()
  );

  const filteredHistoryRowMatches = useMemo(() => {
    if (!isHistoryFilterActive) return [];
    const qStudent = searchStudentQuery.trim().toLowerCase();
    const qInvig = searchInvigilatorQuery.trim().toLowerCase();
    const qDate = searchDateFilter.trim();
    const out: Array<{
      archiveKey: string;
      examDate: string;
      examShift: string;
      examType: string;
      roomNo: string;
      invigilator: string;
      benchNo: number;
      seatPosition: string;
      studentId: string;
      rollNumber: string;
      studentName: string;
      className: string;
      roomCheckInStatus?: string;
    }> = [];

    for (const entry of historyEntries) {
      if (qDate && entry.examDate !== qDate) continue;
      for (const r of entry.rows) {
        if (searchClassFilter !== 'ALL' && r.className !== searchClassFilter) continue;
        if (qInvig && !String(r.invigilator || '').toLowerCase().includes(qInvig)) continue;
        if (qStudent) {
          const hay = `${r.studentName || ''} ${r.studentId || ''} ${r.rollNumber || ''} ${r.roomNo || ''}`.toLowerCase();
          if (!hay.includes(qStudent)) continue;
        }
        out.push({
          archiveKey: entry.archiveKey,
          examDate: entry.examDate,
          examShift: entry.examShift,
          examType: entry.examType,
          roomNo: r.roomNo,
          invigilator: r.invigilator || '—',
          benchNo: r.benchNo,
          seatPosition: r.seatPosition,
          studentId: r.studentId,
          rollNumber: r.rollNumber,
          studentName: r.studentName,
          className: r.className,
          roomCheckInStatus: r.roomCheckInStatus,
        });
      }
    }
    return out.slice(0, 250);
  }, [
    historyEntries,
    isHistoryFilterActive,
    searchStudentQuery,
    searchClassFilter,
    searchInvigilatorQuery,
    searchDateFilter,
  ]);

  const filteredHistoryEntries = useMemo(() => {
    if (!searchDateFilter.trim() && !searchInvigilatorQuery.trim()) return historyEntries;
    const qInvig = searchInvigilatorQuery.trim().toLowerCase();
    return historyEntries.filter((entry) => {
      if (searchDateFilter.trim() && entry.examDate !== searchDateFilter.trim()) return false;
      if (qInvig) {
        return entry.roomsSummary.some((rm) => String(rm.invigilator || '').toLowerCase().includes(qInvig));
      }
      return true;
    });
  }, [historyEntries, searchDateFilter, searchInvigilatorQuery]);

  const selectedHistoryEntry = useMemo(
    () => historyEntries.find((e) => e.archiveKey === selectedHistoryKey) || null,
    [historyEntries, selectedHistoryKey]
  );

  const selectedHistoryPlanData = useMemo(() => {
    if (!selectedHistoryEntry) return null;
    return buildExamSeatingPlanFromHistoryEntry(selectedHistoryEntry);
  }, [selectedHistoryEntry]);

  const persistLocalSnapshot = (
    nextRooms: SeatingRoomConfig[],
    nextSeats = seatsPerBench,
    nextMode = mode,
    nextStatus: SeatingPlanApprovalStatus = workflowStatus === 'approved' ? 'draft' : workflowStatus,
    nextDate = examDate,
    nextShift = examShift
  ) => {
    saveLocalSeatingWorkflow({
      rooms: nextRooms,
      seatsPerBench: nextSeats,
      mode: nextMode,
      status: nextStatus,
      examDate: normalizeExamDateKey(nextDate),
      examShift: nextShift,
      submittedBy,
      submittedAt,
      approvedBy,
      approvedAt,
      teacherNote,
      managerNote,
    });
  };

  const markModifiedIfApproved = () => {
    if (workflowStatus === 'approved') {
      setWorkflowStatus('draft');
    }
  };

  const handleRoomFieldChange = (
    slotKey: string,
    field: 'roomNumber' | 'invigilator',
    value: string,
    invigilatorId?: string
  ) => {
    markModifiedIfApproved();
    setRoomConfigs((prev) => {
      const next = prev.map((r) => {
        if (r.slotKey !== slotKey) return r;
        if (field === 'invigilator') {
          return {
            ...r,
            invigilator: value,
            invigilatorId: invigilatorId !== undefined ? invigilatorId : r.invigilatorId,
          };
        }
        return { ...r, [field]: value };
      });
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleToggleStudentRoomStatus = (studentId: string, targetStatus: RoomStudentCheckInStatus) => {
    setRoomStatusDrafts((prev) => {
      const current = prev[studentId] || 'Pending';
      const nextStatus: RoomStudentCheckInStatus = current === targetStatus ? 'Pending' : targetStatus;
      return {
        ...prev,
        [studentId]: nextStatus,
      };
    });
  };

  const handleSaveMyRoomDispatch = async (sendAllRemaining = false) => {
    if (!activeMyRoom || savingRoomDispatch) return;
    setErrorMsg(null);
    setNotice(null);

    const effectiveStatuses: Record<string, RoomStudentCheckInStatus> = {};
    activeMyRoom.studentsList.forEach((st) => {
      const cur = roomStatusDrafts[st.studentId] ?? st.roomCheckInStatus ?? 'Pending';
      if (sendAllRemaining) {
        effectiveStatuses[st.studentId] = cur === 'Absent' ? 'Absent' : 'Sent to Room';
      } else {
        effectiveStatuses[st.studentId] = cur;
      }
    });

    if (sendAllRemaining) {
      setRoomStatusDrafts(effectiveStatuses);
    }

    setSavingRoomDispatch(true);
    try {
      const res = await saveExamSeatingRoomDispatch({
        room: activeMyRoom,
        studentStatuses: effectiveStatuses,
        dispatchedBy: currentUserName || activeMyRoom.invigilator || 'Teacher',
        dispatchedById: currentUserId || activeMyRoom.invigilatorId,
        dispatchedAt: getLocalTimestamp(),
        note: roomNoteDraft,
      });

      if (!res.serverOk && !res.sheetSynced) {
        setErrorMsg(
          `रूम डेटा सेव करने में समस्या आई (${res.sheetError || 'नेटवर्क त्रुटि'})। कृपया पुनः प्रयास करें।`
        );
        return;
      }

      realtimeSync.broadcastUpdate('exam_seating_plan', 'room_dispatched');
      await Promise.all([loadFromServer(false), loadHistoryFromServer(false)]);

      setNotice(
        `✅ ${activeMyRoom.roomNumber} की ड्यूटी सेव हो गई! ${res.sentCount}/${activeMyRoom.totalStudents} बच्चे रूम में भेजे गए${
          res.absentCount > 0 ? ` (${res.absentCount} अनुपस्थित)` : ''
        } — अब यह स्थायी रिकॉर्ड व हिस्ट्री में सुरक्षित है।`
      );
      setTimeout(() => setNotice(null), 6000);
    } catch {
      setErrorMsg('रूम ड्यूटी सेव करने में त्रुटि हुई।');
    } finally {
      setSavingRoomDispatch(false);
    }
  };

  const handleClassCountChange = (slotKey: string, classCode: string, rawVal: string) => {
    const num = Math.max(0, Math.min(500, Math.floor(Number(rawVal) || 0)));
    markModifiedIfApproved();
    setErrorMsg(null);
    setRoomConfigs((prev) => {
      const next = prev.map((r) => {
        if (r.slotKey !== slotKey) return r;
        const nextCounts = { ...(r.classCounts || {}) };
        if (num <= 0) delete nextCounts[classCode];
        else nextCounts[classCode] = num;
        return { ...r, classCounts: nextCounts };
      });
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleFillRemainingIntoRoom = (slotKey: string, classCode: string, remaining: number) => {
    if (remaining <= 0) return;
    markModifiedIfApproved();
    setErrorMsg(null);
    setRoomConfigs((prev) => {
      const next = prev.map((r) => {
        if (r.slotKey !== slotKey) return r;
        const curr = Number(r.classCounts?.[classCode] || 0);
        return {
          ...r,
          classCounts: {
            ...(r.classCounts || {}),
            [classCode]: curr + remaining,
          },
        };
      });
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleAddRoom = () => {
    markModifiedIfApproved();
    setRoomConfigs((prev) => {
      const idx = prev.length + 1;
      const next = [
        ...prev,
        {
          slotKey: `room_${Date.now()}_${idx}`,
          roomNumber: `Room ${idx}`,
          invigilator: '',
          classCounts: {},
        },
      ];
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleRemoveRoom = (slotKey: string) => {
    if (roomConfigs.length <= 1) return;
    markModifiedIfApproved();
    setRoomConfigs((prev) => {
      const next = prev.filter((r) => r.slotKey !== slotKey);
      persistLocalSnapshot(next);
      return next;
    });
    if (selectedRoomKey === slotKey) setSelectedRoomKey('ALL');
  };

  const handleAutoFillCounts = () => {
    markModifiedIfApproved();
    setErrorMsg(null);
    const filled = buildAutoBalancedRoomConfigs({
      students,
      getClassName,
      existingRooms: roomConfigs,
    });
    setRoomConfigs(filled);
    persistLocalSnapshot(filled);
    setNotice('✓ सभी कक्षाओं के बच्चे उपलब्ध कमरों में संतुलित (Anti-Cheating) तरीके से भर दिए गए हैं। आप चाहें तो संख्या बदल सकते हैं।');
    setTimeout(() => setNotice(null), 4500);
  };

  const handleClearAllCounts = () => {
    markModifiedIfApproved();
    setErrorMsg(null);
    const cleared = clearRoomAllocations(roomConfigs);
    setRoomConfigs(cleared);
    persistLocalSnapshot(cleared);
    setNotice('सभी कमरों की संख्या 0 कर दी गई है — अब अपनी पसंद से हर कमरे में कक्षा-वार बच्चे चुनें।');
    setTimeout(() => setNotice(null), 4000);
  };

  const buildCurrentPayload = (status: SeatingPlanApprovalStatus): SeatingPlanConfigPayload => ({
    rooms: roomConfigs,
    seatsPerBench,
    mode,
    status,
    examDate: normalizeExamDateKey(examDate),
    examShift: examShift.trim(),
    submittedBy:
      userRole === 'teacher'
        ? currentUserName || submittedBy || 'Teacher'
        : submittedBy || currentUserName || 'Manager',
    submittedById: userRole === 'teacher' ? currentUserId : undefined,
    submittedAt: status === 'pending_approval' ? getLocalTimestamp() : submittedAt || getLocalTimestamp(),
    approvedBy: status === 'approved' ? currentUserName || 'Manager' : undefined,
    approvedAt: status === 'approved' ? getLocalTimestamp() : undefined,
    teacherNote: teacherNote.trim() || undefined,
    managerNote: managerNote.trim() || undefined,
  });

  // TEACHER ACTION: Submit draft for Manager confirmation (does NOT write to Sheet yet)
  const handleTeacherSubmitForApproval = async (asDraftOnly = false) => {
    if (submittingDraft) return;
    setErrorMsg(null);
    setNotice(null);

    if (seatingPlan.allocatedStudentsCount === 0) {
      setErrorMsg('कृपया पहले कम से कम 1 कमरे में कुछ बच्चों की संख्या चुनें।');
      return;
    }
    if (overAllocatedClasses.length > 0) {
      setErrorMsg(
        `इन कक्षाओं में कुल बच्चों से ज्यादा संख्या भर दी गई है: ${overAllocatedClasses
          .map((c) => `${c.classLabel} (+${c.overAllocatedBy})`)
          .join(', ')}। कृपया सही करें।`
      );
      return;
    }

    setSubmittingDraft(true);
    try {
      const nextStatus: SeatingPlanApprovalStatus = asDraftOnly ? 'draft' : 'pending_approval';
      const payload = buildCurrentPayload(nextStatus);
      const res = await saveTeacherSeatingDraft(payload);
      if (!res.serverOk && !res.sheetSynced) {
        setErrorMsg(
          `ड्राफ्ट मैनेजर तक नहीं पहुँच सका (${res.sheetError || 'सर्वर व Google Sheet सिंक विफल'})। कृपया इंटरनेट और Apps Script URL जांचकर पुनः प्रयास करें।`
        );
        return;
      }

      setWorkflowStatus(nextStatus);
      setSubmittedBy(payload.submittedBy || '');
      setSubmittedAt(payload.submittedAt || '');
      realtimeSync.broadcastUpdate('exam_seating_plan', asDraftOnly ? 'draft_saved' : 'pending_approval');

      if (asDraftOnly) {
        setNotice(
          res.sheetSynced
            ? '✓ ड्राफ्ट क्लाउड व Google Sheet में सुरक्षित सेव हो गया है।'
            : '⚠️ ड्राफ्ट ऐप सर्वर पर सेव हुआ है (Google Sheet सिंक लंबित है)।'
        );
      } else {
        setNotice(
          res.sheetSynced
            ? `✅ सीटिंग प्लान (${seatingPlan.allocatedStudentsCount} छात्र · ${seatingPlan.rooms.length} कमरे) मैनेजर की पुष्टि के लिए क्लाउड में भेज दिया गया है! मैनेजर कन्फर्म करते ही यह Google Sheet में सेव हो जाएगा।`
            : `⚠️ सीटिंग प्लान ऐप सर्वर पर भेजा गया है, लेकिन Google Sheet सिंक में समस्या आई: ${res.sheetError || 'Apps Script जांचें'}`
        );
      }
    } catch {
      setErrorMsg('ड्राफ्ट भेजने में समस्या आई, कृपया पुनः प्रयास करें।');
    } finally {
      setSubmittingDraft(false);
    }
  };

  // MANAGER ACTION: Confirm & Permanently Save to Google Sheet ("Exam_Seating_Plan" tab)
  const handleManagerConfirmAndSaveToSheet = async () => {
    if (savingToSheet) return;
    setErrorMsg(null);
    setNotice(null);
    setSheetWarning(null);

    if (seatingPlan.allocatedStudentsCount === 0) {
      setErrorMsg('कन्फर्म करने के लिए कम से कम 1 कमरे में छात्र आवंटित होने चाहिए।');
      return;
    }
    if (overAllocatedClasses.length > 0) {
      setErrorMsg(
        `कृपया पहले इन कक्षाओं की अतिरिक्त संख्या ठीक करें: ${overAllocatedClasses
          .map((c) => `${c.classLabel} (+${c.overAllocatedBy})`)
          .join(', ')}`
      );
      return;
    }

    setSavingToSheet(true);
    try {
      const approvedPayload = buildCurrentPayload('approved');
      const roomMetaCompat: Record<string, { roomNumber: string; invigilator: string }> = {};
      roomConfigs.forEach((r) => {
        roomMetaCompat[r.slotKey] = { roomNumber: r.roomNumber, invigilator: r.invigilator };
      });

      const res = await saveExamSeatingPlanToSheet(seatingPlan, config, roomMetaCompat, approvedPayload);
      setWorkflowStatus('approved');
      setApprovedBy(approvedPayload.approvedBy || 'Manager');
      setApprovedAt(approvedPayload.approvedAt || getLocalTimestamp());
      loadHistoryFromServer(false);
      realtimeSync.broadcastUpdate('exam_seating_plan', 'approved');

      const dateText = formatExamDateDisplay(approvedPayload.examDate);
      const shiftText = approvedPayload.examShift ? ` (${approvedPayload.examShift})` : '';
      if (res.sheetSynced) {
        setNotice(
          `✅ कन्फर्म हो गया! सभी ${res.savedCount} छात्रों का प्लान Google Sheet की "Exam_Seating_Plan" और दिनांक ${dateText}${shiftText} की "Exam_Seating_History" में स्थायी सेव हो गया है।`
        );
      } else {
        setNotice(
          `✓ प्लान ऐप सर्वर और दिनांक ${dateText}${shiftText} की हिस्ट्री में सेव हो गया है (${res.savedCount} छात्र)।`
        );
        setSheetWarning(
          'Google Sheet में तारीख-वार हिस्ट्री ("Exam_Seating_History") सेव करने के लिए कृपया Apps Script कोड एक बार अपडेट करें।'
        );
      }
    } catch {
      setErrorMsg('Google Sheet में सेव करते समय त्रुटि हुई।');
    } finally {
      setSavingToSheet(false);
    }
  };

  const handleManagerReturnToDraft = async () => {
    if (submittingDraft) return;
    setSubmittingDraft(true);
    setErrorMsg(null);
    try {
      const payload = buildCurrentPayload('draft');
      await saveTeacherSeatingDraft(payload);
      setWorkflowStatus('draft');
      realtimeSync.broadcastUpdate('exam_seating_plan', 'returned_to_draft');
      setNotice('↩️ प्लान ड्राफ्ट में वापस कर दिया गया है — टीचर या आप इसमें बदलाव कर सकते हैं।');
    } finally {
      setSubmittingDraft(false);
    }
  };

  const handleDeleteHistory = async (archiveKey: string, label: string) => {
    setDeletingHistoryKey(archiveKey);
    try {
      await deleteExamSeatingHistoryEntry(archiveKey);
      setHistoryEntries((prev) => prev.filter((e) => e.archiveKey !== archiveKey));
      if (selectedHistoryKey === archiveKey) {
        setSelectedHistoryKey(null);
      }
      setNotice(`✓ ${label} का पुराना रिकॉर्ड हटा दिया गया है।`);
      setTimeout(() => setNotice(null), 3500);
    } finally {
      setDeletingHistoryKey(null);
    }
  };

  const handleDownloadPdf = (roomKey: string = selectedRoomKey) => {
    const filename = generateExamSeatingPlanPdf({
      plan: seatingPlan,
      config,
      selectedRoomKey: roomKey,
      seatsPerBench,
      examDate,
      examShift,
    });
    setNotice(`✓ PDF डाउनलोड हो गई: ${filename}`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleDownloadHistoryPdf = (entry: ExamSeatingHistoryEntry, roomKey: string = 'ALL') => {
    const rebuilt = buildExamSeatingPlanFromHistoryEntry(entry);
    const filename = generateExamSeatingPlanPdf({
      plan: rebuilt.plan,
      config: { ...config, examType: entry.examType as any, session: entry.session },
      selectedRoomKey: roomKey,
      seatsPerBench: rebuilt.seatsPerBench,
      examDate: entry.examDate,
      examShift: entry.examShift,
    });
    setNotice(`✓ पुरानी तारीख (${formatExamDateDisplay(entry.examDate)}) की PDF डाउनलोड हो गई: ${filename}`);
    setTimeout(() => setNotice(null), 5000);
  };

  const gridColsClass =
    seatsPerBench === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : seatsPerBench === 4
      ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
      : 'grid-cols-1 md:grid-cols-3';

  const myRoomLiveStats = useMemo(() => {
    if (!activeMyRoom) return { sent: 0, absent: 0, pending: 0 };
    let sent = 0;
    let absent = 0;
    let pending = 0;
    activeMyRoom.studentsList.forEach((st) => {
      const status = roomStatusDrafts[st.studentId] ?? st.roomCheckInStatus ?? 'Pending';
      if (status === 'Sent to Room') sent++;
      else if (status === 'Absent') absent++;
      else pending++;
    });
    return { sent, absent, pending };
  }, [activeMyRoom, roomStatusDrafts]);

  const myRoomClassStats = useMemo(() => {
    if (!activeMyRoom) return [];
    const statsMap = new Map<
      string,
      { classCode: string; classLabel: string; total: number; sent: number; absent: number; pending: number }
    >();
    activeMyRoom.classBreakdown.forEach((cb) => {
      statsMap.set(cb.classCode, {
        classCode: cb.classCode,
        classLabel: cb.classLabel,
        total: 0,
        sent: 0,
        absent: 0,
        pending: 0,
      });
    });
    activeMyRoom.studentsList.forEach((st) => {
      const existing = statsMap.get(st.classCode) || {
        classCode: st.classCode,
        classLabel: st.classLabel,
        total: 0,
        sent: 0,
        absent: 0,
        pending: 0,
      };
      existing.total += 1;
      const status = roomStatusDrafts[st.studentId] ?? st.roomCheckInStatus ?? 'Pending';
      if (status === 'Sent to Room') existing.sent += 1;
      else if (status === 'Absent') existing.absent += 1;
      else existing.pending += 1;
      statsMap.set(st.classCode, existing);
    });
    return Array.from(statsMap.values());
  }, [activeMyRoom, roomStatusDrafts]);

  const filteredMyRoomStudents = useMemo(() => {
    if (!activeMyRoom) return [];
    const q = roomStudentSearch.trim().toLowerCase();
    return activeMyRoom.studentsList.filter((st) => {
      if (roomClassFilter !== 'ALL' && st.classCode !== roomClassFilter) return false;
      const status = roomStatusDrafts[st.studentId] ?? st.roomCheckInStatus ?? 'Pending';
      if (roomStatusFilter !== 'ALL' && status !== roomStatusFilter) return false;
      if (q) {
        const hay = `${st.studentName} ${st.rollNumber} ${st.studentId} ${st.classLabel} bench ${st.benchNumber}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeMyRoom, roomStatusDrafts, roomStudentSearch, roomStatusFilter, roomClassFilter]);

  return (
    <div className="space-y-4">
      {/* SUB-TAB SWITCHER: MY EXAM ROOM (TEACHER) vs PLANNER vs DATE-WISE HISTORY & SEARCH */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {userRole === 'teacher' && (
            <button
              type="button"
              onClick={() => {
                userTouchedSubTabRef.current = true;
                setActiveSubTab('my_room');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer inline-flex items-center gap-2 transition-colors ${
                activeSubTab === 'my_room'
                  ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                  : myAssignedRooms.length > 0
                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-300 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <i className="fa-solid fa-door-open"></i>
              <span>मेरा एग्जाम रूम व बच्चे भेजें</span>
              {myAssignedRooms.length > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-black tabular-nums ${
                    activeSubTab === 'my_room'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-emerald-600 text-white'
                  }`}
                >
                  {myAssignedRooms.map((r) => r.roomNumber).join(', ')}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              userTouchedSubTabRef.current = true;
              setActiveSubTab('planner');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer inline-flex items-center gap-2 transition-colors ${
              activeSubTab === 'planner'
                ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <i className="fa-solid fa-chair"></i>
            <span>नया / चालू सिटिंग प्लान (Planner)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              userTouchedSubTabRef.current = true;
              setActiveSubTab('history');
              loadHistoryFromServer(false);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-black cursor-pointer inline-flex items-center gap-2 transition-colors ${
              activeSubTab === 'history'
                ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <i className="fa-solid fa-clock-rotate-left"></i>
            <span>तारीख-वार रिकॉर्ड व छात्र खोज (History & Search)</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-black tabular-nums ${
                activeSubTab === 'history' ? 'bg-amber-400 text-slate-950' : 'bg-white text-slate-800'
              }`}
            >
              {historyEntries.length}
            </span>
          </button>
        </div>

        <div className="text-[11px] font-bold text-slate-600 px-2">
          {activeSubTab === 'my_room'
            ? activeMyRoom
              ? `${activeMyRoom.roomNumber} · ${formatExamDateDisplay(activeMyRoom.examDate)}`
              : 'मेरा परीक्षा रूम'
            : activeSubTab === 'planner'
            ? `तारीख: ${formatExamDateDisplay(examDate)}${examShift ? ` · ${examShift}` : ''}`
            : `कुल सेव परीक्षा रिकॉर्ड: ${historyEntries.length}`}
        </div>
      </div>

      {activeSubTab === 'my_room' ? (
        <div className="space-y-4">
          {myAssignedRooms.length === 0 || !activeMyRoom ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-blue-50 text-[#0c2340] flex items-center justify-center text-2xl">
                <i className="fa-solid fa-door-closed"></i>
              </div>
              <h3 className="text-base font-black text-slate-900">
                अभी आपको किसी एग्जाम रूम की ड्यूटी आवंटित नहीं हुई है
              </h3>
              <p className="text-xs text-slate-600 max-w-xl mx-auto leading-relaxed">
                जैसे ही मैनेजर / प्लानर "चालू सिटिंग प्लान" में किसी कमरे (जैसे Room 1) में बच्चों को चुनकर निरीक्षक (टीचर) में आपका नाम ({currentUserName || 'Teacher'}) सेव करेंगे, सुबह से ही आपके ऐप में वह कमरा व उसके सभी बच्चे दिखने लगेंगे।
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => loadFromServer(true)}
                  disabled={refreshingSnapshot}
                  className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-xs font-black cursor-pointer inline-flex items-center gap-2"
                >
                  <i className={`fa-solid fa-rotate ${refreshingSnapshot ? 'fa-spin' : ''}`}></i>
                  <span>ताज़ा ड्यूटी चेक करें</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    userTouchedSubTabRef.current = true;
                    setActiveSubTab('planner');
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer"
                >
                  पूरा सिटिंग प्लान देखें
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {myAssignedRooms.length > 1 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-black text-slate-700 mr-1">आपके आवंटित कमरे:</span>
                  {myAssignedRooms.map((rm) => {
                    const key = `${rm.archiveKey}::${rm.slotKey}`;
                    const active = `${activeMyRoom.archiveKey}::${activeMyRoom.slotKey}` === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedMyRoomKey(key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer transition-colors ${
                          active
                            ? 'bg-[#0c2340] text-amber-300'
                            : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                        }`}
                      >
                        {rm.roomNumber} ({rm.totalStudents} छात्र)
                      </button>
                    );
                  })}
                </div>
              )}

              {/* TEACHER MORNING EXAM ROOM DUTY HERO CARD */}
              <div className="bg-gradient-to-r from-[#0c2340] via-[#133262] to-[#0c2340] text-white rounded-2xl p-4 sm:p-5 border-b-4 border-amber-400 shadow-sm space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-xs font-black">
                        🏫 {activeMyRoom.roomNumber}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold">
                        {formatExamDateDisplay(activeMyRoom.examDate)}
                        {activeMyRoom.examShift ? ` · ${activeMyRoom.examShift}` : ''}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-blue-100 text-[11px] font-bold">
                        {activeMyRoom.examType} ({activeMyRoom.session})
                      </span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-black text-white mt-2">
                      आज की परीक्षा ड्यूटी: आपको {activeMyRoom.roomNumber} मिला है
                    </h2>
                    <p className="text-xs text-blue-100 mt-0.5">
                      निरीक्षक: <span className="font-black text-amber-300">{activeMyRoom.invigilator || currentUserName}</span> · आपके रूम में कुल{' '}
                      <span className="font-black text-white">{activeMyRoom.totalStudents} बच्चे</span> ({activeMyRoom.benches.length} बेंच) हैं — कक्षाएं:{' '}
                      {activeMyRoom.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join(', ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSaveMyRoomDispatch(true)}
                      disabled={savingRoomDispatch || activeMyRoom.totalStudents === 0}
                      className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs sm:text-sm font-black cursor-pointer inline-flex items-center gap-2 shadow-md active:scale-95"
                    >
                      <i className={`fa-solid ${savingRoomDispatch ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`}></i>
                      <span>
                        {savingRoomDispatch
                          ? 'रूम में भेजा व सेव हो रहा है...'
                          : myRoomLiveStats.pending > 0
                          ? `🚀 सभी बाकी (${myRoomLiveStats.pending}) बच्चों को रूम में भेजें व सेव करें`
                          : '✅ सभी बच्चों को रूम में कन्फर्म व सेव करें'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const filename = generateExamSeatingPlanPdf({
                          plan: activeMyRoom.plan,
                          config: {
                            ...config,
                            examType: activeMyRoom.examType as any,
                            session: activeMyRoom.session,
                          },
                          selectedRoomKey: activeMyRoom.slotKey,
                          seatsPerBench: activeMyRoom.seatsPerBench,
                          examDate: activeMyRoom.examDate,
                          examShift: activeMyRoom.examShift,
                        });
                        setNotice(`✓ ${activeMyRoom.roomNumber} की PDF डाउनलोड हो गई: ${filename}`);
                        setTimeout(() => setNotice(null), 4000);
                      }}
                      className="px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <i className="fa-solid fa-file-pdf"></i>
                      <span>रूम चार्ट PDF</span>
                    </button>
                  </div>
                </div>

                {/* 4 KPI COUNTERS */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-xl bg-white/10 border border-white/15 px-3 py-2.5">
                    <div className="text-[11px] font-bold text-blue-200">कुल आवंटित बच्चे</div>
                    <div className="text-xl font-black text-white tabular-nums">{activeMyRoom.totalStudents}</div>
                  </div>
                  <div className="rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3 py-2.5">
                    <div className="text-[11px] font-bold text-emerald-200">रूम में भेजे / बैठे</div>
                    <div className="text-xl font-black text-emerald-300 tabular-nums">{myRoomLiveStats.sent}</div>
                  </div>
                  <div className="rounded-xl bg-amber-400/20 border border-amber-300/40 px-3 py-2.5">
                    <div className="text-[11px] font-bold text-amber-200">भेजना बाकी (Pending)</div>
                    <div className="text-xl font-black text-amber-300 tabular-nums">{myRoomLiveStats.pending}</div>
                  </div>
                  <div className="rounded-xl bg-rose-500/20 border border-rose-400/40 px-3 py-2.5">
                    <div className="text-[11px] font-bold text-rose-200">अनुपस्थित (Absent)</div>
                    <div className="text-xl font-black text-rose-300 tabular-nums">{myRoomLiveStats.absent}</div>
                  </div>
                </div>

                {/* PROMINENT CLASS-WISE STUDENT COUNT CARDS */}
                {myRoomClassStats.length > 0 && (
                  <div className="pt-2.5 border-t border-white/15 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-black text-amber-300 flex items-center gap-1.5">
                        <i className="fa-solid fa-layer-group"></i>
                        <span>किस कक्षा के कितने बच्चे ({myRoomClassStats.length} कक्षाएं)</span>
                      </span>
                      <div className="flex items-center gap-2">
                        {roomClassFilter !== 'ALL' ? (
                          <button
                            type="button"
                            onClick={() => setRoomClassFilter('ALL')}
                            className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-black cursor-pointer hover:bg-amber-300"
                          >
                            सभी कक्षाएं दिखाएं ({activeMyRoom.totalStudents})
                          </button>
                        ) : (
                          <span className="text-[11px] font-semibold text-blue-200">
                            किसी कक्षा पर टैप करके उसी कक्षा के बच्चे देखें
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                      {myRoomClassStats.map((cls) => {
                        const isSelected = roomClassFilter === cls.classCode;
                        return (
                          <button
                            key={cls.classCode}
                            type="button"
                            onClick={() => setRoomClassFilter(isSelected ? 'ALL' : cls.classCode)}
                            className={`text-left rounded-xl px-3 py-2 border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-amber-400 border-amber-300 text-slate-950 shadow-md ring-2 ring-amber-300/60'
                                : 'bg-white/10 hover:bg-white/20 border-white/15 text-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span
                                className={`text-xs font-black truncate ${
                                  isSelected ? 'text-slate-950' : 'text-amber-300'
                                }`}
                              >
                                {cls.classLabel}
                              </span>
                              <span
                                className={`text-base font-black tabular-nums leading-none ${
                                  isSelected ? 'text-slate-950' : 'text-white'
                                }`}
                              >
                                {cls.total}
                              </span>
                            </div>
                            <div
                              className={`text-[10px] font-bold mt-1 tabular-nums flex items-center justify-between gap-1 ${
                                isSelected ? 'text-slate-900' : 'text-blue-100'
                              }`}
                            >
                              <span>{cls.total} बच्चे</span>
                              <span>
                                {cls.sent === cls.total
                                  ? '✓ सभी भेजे'
                                  : cls.sent > 0 || cls.absent > 0
                                  ? `✓${cls.sent}${cls.absent > 0 ? ` ✕${cls.absent}` : ''}`
                                  : `बाकी ${cls.pending}`}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {errorMsg && (
                <div className="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
                  {errorMsg}
                </div>
              )}
              {notice && (
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                  {notice}
                </div>
              )}

              {/* SEARCH, FILTER, NOTE & SAVE BAR */}
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                  <div className="relative flex-1">
                    <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input
                      type="text"
                      value={roomStudentSearch}
                      onChange={(e) => setRoomStudentSearch(e.target.value)}
                      placeholder="अपने रूम के छात्र को नाम, रोल नंबर, कक्षा या बेंच से खोजें..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'ALL', label: `सभी (${activeMyRoom.totalStudents})` },
                        { id: 'Pending', label: `बाकी (${myRoomLiveStats.pending})` },
                        { id: 'Sent to Room', label: `रूम में (${myRoomLiveStats.sent})` },
                        { id: 'Absent', label: `अनुपस्थित (${myRoomLiveStats.absent})` },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setRoomStatusFilter(f.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black cursor-pointer tabular-nums ${
                          roomStatusFilter === f.id
                            ? 'bg-[#0c2340] text-amber-300'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}

                    {roomClassFilter !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setRoomClassFilter('ALL')}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-black cursor-pointer bg-amber-100 text-amber-950 border border-amber-300 hover:bg-amber-200 inline-flex items-center gap-1"
                      >
                        <span>
                          कक्षा:{' '}
                          {myRoomClassStats.find((c) => c.classCode === roomClassFilter)?.classLabel ||
                            roomClassFilter}
                        </span>
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}
                    <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg ml-1">
                      <button
                        type="button"
                        onClick={() => setRoomViewMode('list')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-black cursor-pointer ${
                          roomViewMode === 'list' ? 'bg-white text-[#0c2340] shadow-xs' : 'text-slate-600'
                        }`}
                      >
                        लिस्ट
                      </button>
                      <button
                        type="button"
                        onClick={() => setRoomViewMode('bench')}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-black cursor-pointer ${
                          roomViewMode === 'bench' ? 'bg-white text-[#0c2340] shadow-xs' : 'text-slate-600'
                        }`}
                      >
                        बेंच नक्शा
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1 border-t border-slate-100">
                  <input
                    type="text"
                    value={roomNoteDraft}
                    onChange={(e) => setRoomNoteDraft(e.target.value)}
                    placeholder="रूम ड्यूटी नोट (वैकल्पिक, जैसे: सभी बच्चे शांति से बैठ गए व पेपर शुरू)..."
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveMyRoomDispatch(false)}
                    disabled={savingRoomDispatch}
                    className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-50 text-amber-300 text-xs font-black cursor-pointer inline-flex items-center justify-center gap-2 shrink-0"
                  >
                    <i className={`fa-solid ${savingRoomDispatch ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'}`}></i>
                    <span>रूम ड्यूटी व बच्चों की स्थिति सेव करें</span>
                  </button>
                </div>

                {activeMyRoom.dispatchedAt && (
                  <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      ✓ अंतिम सेव: <span className="font-black">{activeMyRoom.dispatchedBy || currentUserName}</span> · {activeMyRoom.dispatchedAt}
                    </span>
                    <span className="font-black tabular-nums">
                      सेव रिकॉर्ड: {activeMyRoom.sentCount}/{activeMyRoom.totalStudents} रूम में · {activeMyRoom.absentCount} अनुपस्थित
                    </span>
                  </div>
                )}
              </div>

              {/* STUDENT CHECK-IN LIST OR BENCH-BY-BENCH INTERACTIVE GRID */}
              {roomViewMode === 'list' ? (
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200">
                  {filteredMyRoomStudents.length === 0 ? (
                    <div className="p-8 text-center text-xs font-bold text-slate-500">
                      इस फ़िल्टर में कोई छात्र नहीं मिला।
                    </div>
                  ) : (
                    filteredMyRoomStudents.map((st, idx) => {
                      const status = roomStatusDrafts[st.studentId] ?? st.roomCheckInStatus ?? 'Pending';
                      const badgeClass =
                        CLASS_BADGE_COLORS[st.classCode] || 'bg-slate-100 text-slate-900 border-slate-300';
                      return (
                        <div
                          key={`${st.studentId}-${idx}`}
                          className={`p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors ${
                            status === 'Sent to Room'
                              ? 'bg-emerald-50/60'
                              : status === 'Absent'
                              ? 'bg-rose-50/60'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start sm:items-center gap-3 min-w-0">
                            <div className="px-2.5 py-1.5 rounded-xl bg-[#0c2340] text-amber-300 text-center shrink-0 tabular-nums">
                              <div className="text-[10px] font-bold leading-none">बेंच</div>
                              <div className="text-sm font-black leading-tight">#{st.benchNumber}</div>
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-black text-slate-900 truncate">
                                  {st.studentName}
                                </span>
                                <span className={`px-2 py-0.5 rounded border text-[10px] font-black ${badgeClass}`}>
                                  {st.classLabel}
                                </span>
                              </div>
                              <div className="text-[11px] font-bold text-slate-600 tabular-nums mt-0.5">
                                Roll: {st.rollNumber || '—'} · ID: {st.studentId} · सीट: {st.seatPosition}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => handleToggleStudentRoomStatus(st.studentId, 'Sent to Room')}
                              className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer inline-flex items-center gap-1.5 border transition-all ${
                                status === 'Sent to Room'
                                  ? 'bg-emerald-600 border-emerald-700 text-white shadow-xs'
                                  : 'bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                              }`}
                            >
                              <i className="fa-solid fa-check"></i>
                              <span>{status === 'Sent to Room' ? 'रूम में भेजा ✓' : 'रूम में भेजें'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleStudentRoomStatus(st.studentId, 'Absent')}
                              className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer inline-flex items-center gap-1.5 border transition-all ${
                                status === 'Absent'
                                  ? 'bg-rose-600 border-rose-700 text-white shadow-xs'
                                  : 'bg-white border-rose-300 text-rose-800 hover:bg-rose-50'
                              }`}
                            >
                              <i className="fa-solid fa-xmark"></i>
                              <span>{status === 'Absent' ? 'अनुपस्थित ✓' : 'अनुपस्थित'}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="bg-white border-2 border-[#0c2340] rounded-2xl overflow-hidden p-3 sm:p-4 space-y-2.5">
                  {activeMyRoom.benches.map((bench) => (
                    <div
                      key={`myroom-b-${bench.benchNumber}`}
                      className="flex flex-col sm:flex-row border border-slate-300 rounded-xl overflow-hidden bg-slate-50/40"
                    >
                      <div className="sm:w-24 shrink-0 bg-slate-100 border-b sm:border-b-0 sm:border-r border-slate-300 px-3 py-2 flex sm:flex-col items-center justify-between sm:justify-center text-center">
                        <span className="text-xs font-black text-[#0c2340] tabular-nums">
                          Bench {bench.benchNumber}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                          {bench.seats.length} सीट
                        </span>
                      </div>
                      <div
                        className={`flex-1 grid ${
                          activeMyRoom.seatsPerBench === 2
                            ? 'grid-cols-1 md:grid-cols-2'
                            : activeMyRoom.seatsPerBench === 4
                            ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
                            : 'grid-cols-1 md:grid-cols-3'
                        } divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white`}
                      >
                        {bench.seats.map((seat) => {
                          const sId = String(seat.student.Student_ID || '');
                          const status = roomStatusDrafts[sId] ?? 'Pending';
                          const badgeClass =
                            CLASS_BADGE_COLORS[seat.classCode] || 'bg-slate-100 text-slate-900 border-slate-300';
                          const matchesClass = roomClassFilter === 'ALL' || seat.classCode === roomClassFilter;
                          return (
                            <div
                              key={sId}
                              className={`p-2.5 space-y-2 transition-opacity ${
                                !matchesClass
                                  ? 'opacity-35 bg-slate-50'
                                  : status === 'Sent to Room'
                                  ? 'bg-emerald-50/60'
                                  : status === 'Absent'
                                  ? 'bg-rose-50/60'
                                  : ''
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-extrabold uppercase text-slate-500">
                                    {seat.seatPosition}
                                  </div>
                                  <div className="text-sm font-black text-slate-900 truncate">
                                    {seat.student.Student_Name}
                                  </div>
                                  <div className="text-[11px] font-bold text-[#0c2340] tabular-nums">
                                    Roll: {seat.student.Roll_Number || '—'} · ID: {sId}
                                  </div>
                                </div>
                                <span className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-black ${badgeClass}`}>
                                  {seat.classLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleToggleStudentRoomStatus(sId, 'Sent to Room')}
                                  className={`flex-1 py-1 rounded-lg text-[11px] font-black cursor-pointer border ${
                                    status === 'Sent to Room'
                                      ? 'bg-emerald-600 border-emerald-700 text-white'
                                      : 'bg-white border-emerald-300 text-emerald-800'
                                  }`}
                                >
                                  ✓ रूम में
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleStudentRoomStatus(sId, 'Absent')}
                                  className={`py-1 px-2 rounded-lg text-[11px] font-black cursor-pointer border ${
                                    status === 'Absent'
                                      ? 'bg-rose-600 border-rose-700 text-white'
                                      : 'bg-white border-rose-300 text-rose-800'
                                  }`}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : activeSubTab === 'history' ? (
        <div className="space-y-4">
          {/* HISTORY SEARCH & FILTER HEADER */}
          <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  परीक्षा सीटिंग प्लान हिस्ट्री — तारीख, छात्र या निरीक्षक से खोजें
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  पता करें किस तारीख को कौन सा छात्र किस कमरे व बेंच पर बैठा था और किस टीचर (Examiner) ने उसका एग्जाम लिया।
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => loadHistoryFromServer(true)}
                  disabled={loadingHistory}
                  className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <i className={`fa-solid fa-rotate ${loadingHistory ? 'fa-spin' : ''}`}></i>
                  <span>ताज़ा रिकॉर्ड लाएं</span>
                </button>
              </div>
            </div>

            {!historySheetSynced && (
              <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  Google Sheet में तारीख-वार हिस्ट्री ("Exam_Seating_History") सिंक करने के लिए कृपया एक बार अपडेटेड Apps Script पेस्ट व डिप्लॉय करें।
                </span>
                {onOpenSheetSetup && (
                  <button
                    type="button"
                    onClick={onOpenSheetSetup}
                    className="px-3 py-1 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-[11px] font-bold cursor-pointer"
                  >
                    शीट सेटअप कोड देखें
                  </button>
                )}
              </div>
            )}

            {notice && (
              <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                {notice}
              </div>
            )}

            {/* 4 SEARCH FILTERS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  छात्र खोजें (नाम / Roll / ID)
                </label>
                <div className="relative">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                  <input
                    type="text"
                    value={searchStudentQuery}
                    onChange={(e) => setSearchStudentQuery(e.target.value)}
                    placeholder="जैसे: Farah, 104, Room 2..."
                    className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">कक्षा चुनें (Class)</label>
                <select
                  value={searchClassFilter}
                  onChange={(e) => setSearchClassFilter(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                >
                  <option value="ALL">सभी कक्षाएं</option>
                  {historyClassOptions.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  एग्जामिनर / टीचर (Invigilator)
                </label>
                <input
                  type="text"
                  list="seating-history-invigilators"
                  value={searchInvigilatorQuery}
                  onChange={(e) => setSearchInvigilatorQuery(e.target.value)}
                  placeholder="टीचर का नाम लिखें या चुनें..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-900"
                />
                <datalist id="seating-history-invigilators">
                  {historyInvigilatorOptions.map((inv) => (
                    <option key={inv} value={inv} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">परीक्षा की तारीख</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={searchDateFilter}
                    onChange={(e) => setSearchDateFilter(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
                  />
                  {isHistoryFilterActive && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchStudentQuery('');
                        setSearchClassFilter('ALL');
                        setSearchInvigilatorQuery('');
                        setSearchDateFilter('');
                      }}
                      className="px-2.5 py-2 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer"
                      title="फ़िल्टर साफ करें"
                    >
                      साफ
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* INSTANT STUDENT / INVIGILATOR SEARCH RESULTS */}
            {isHistoryFilterActive && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/40 overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[#0c2340] text-white flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-black text-amber-300">
                    खोज परिणाम: {filteredHistoryRowMatches.length} प्रविष्टियाँ मिलीं
                  </span>
                  <span className="text-[11px] text-blue-100">
                    रूम, बेंच, सीट और निरीक्षक टीचर का विवरण
                  </span>
                </div>
                {filteredHistoryRowMatches.length === 0 ? (
                  <div className="p-5 text-center text-xs font-bold text-slate-600">
                    इस खोज से मेल खाने वाला कोई छात्र या टीचर रिकॉर्ड नहीं मिला।
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[380px]">
                    <table className="w-full text-xs border-collapse bg-white">
                      <thead className="sticky top-0 bg-slate-100 border-b border-slate-300 text-slate-800">
                        <tr>
                          <th className="text-left p-2.5 font-black">तारीख / शिफ्ट</th>
                          <th className="text-left p-2.5 font-black">छात्र (नाम · रोल)</th>
                          <th className="text-left p-2.5 font-black">कक्षा</th>
                          <th className="text-left p-2.5 font-black">रूम नं.</th>
                          <th className="text-left p-2.5 font-black">बेंच व सीट</th>
                          <th className="text-left p-2.5 font-black">निरीक्षक (Examiner)</th>
                          <th className="text-right p-2.5 font-black">पूरा चार्ट</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {filteredHistoryRowMatches.map((m, idx) => (
                          <tr key={`${m.archiveKey}-${m.studentId}-${idx}`} className="hover:bg-amber-50/50">
                            <td className="p-2.5 whitespace-nowrap">
                              <div className="font-black text-slate-900 tabular-nums">
                                {formatExamDateDisplay(m.examDate)}
                              </div>
                              {m.examShift && (
                                <div className="text-[10px] font-bold text-indigo-700">{m.examShift}</div>
                              )}
                            </td>
                            <td className="p-2.5">
                              <div className="font-black text-slate-900">{m.studentName}</div>
                              <div className="text-[10px] font-bold text-slate-500 tabular-nums">
                                Roll: {m.rollNumber || '—'} · ID: {m.studentId}
                              </div>
                            </td>
                            <td className="p-2.5 font-bold text-slate-800 whitespace-nowrap">{m.className}</td>
                            <td className="p-2.5 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded bg-blue-100 text-[#0c2340] font-black">
                                {m.roomNo}
                              </span>
                            </td>
                            <td className="p-2.5 font-bold text-slate-700 whitespace-nowrap tabular-nums">
                              Bench {m.benchNo} · {m.seatPosition}
                            </td>
                            <td className="p-2.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-black">
                                  {m.invigilator || '—'}
                                </span>
                                {m.roomCheckInStatus === 'Sent to Room' && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-black">
                                    ✓ रूम में
                                  </span>
                                )}
                                {m.roomCheckInStatus === 'Absent' && (
                                  <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 text-[10px] font-black">
                                    ✕ Absent
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-2.5 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedHistoryKey(m.archiveKey);
                                  setHistoryRoomFilter('ALL');
                                }}
                                className="px-2.5 py-1 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-[11px] font-bold cursor-pointer"
                              >
                                पूरा प्लान देखें
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SELECTED HISTORICAL DATE FULL VIEWER OR SAVED DATE CARDS */}
          {selectedHistoryEntry && selectedHistoryPlanData ? (
            <div className="space-y-4">
              <div className="no-print bg-[#0c2340] text-white rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 border-b-4 border-amber-400">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedHistoryKey(null)}
                      className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-black cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <i className="fa-solid fa-arrow-left"></i>
                      <span>सभी तारीखों पर वापस</span>
                    </button>
                    <h3 className="text-base font-black text-amber-300 tabular-nums">
                      दिनांक: {formatExamDateDisplay(selectedHistoryEntry.examDate)}
                      {selectedHistoryEntry.examShift ? ` · ${selectedHistoryEntry.examShift}` : ''}
                    </h3>
                  </div>
                  <p className="text-xs text-blue-100 mt-1">
                    {selectedHistoryEntry.examType} ({selectedHistoryEntry.session}) ·{' '}
                    {selectedHistoryEntry.totalStudents} छात्र · कन्फर्म किया: {selectedHistoryEntry.confirmedBy}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={historyRoomFilter}
                    onChange={(e) => setHistoryRoomFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-white text-slate-950 text-xs font-bold"
                  >
                    <option value="ALL">सभी कमरे ({selectedHistoryPlanData.plan.rooms.length})</option>
                    {selectedHistoryPlanData.plan.rooms.map((r) => (
                      <option key={r.slotKey} value={r.slotKey}>
                        {r.roomNumber} ({r.invigilator || 'No Teacher'})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleDownloadHistoryPdf(selectedHistoryEntry, historyRoomFilter)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-file-pdf"></i>
                    <span>PDF डाउनलोड</span>
                  </button>
                </div>
              </div>

              {selectedHistoryPlanData.plan.rooms
                .filter((r) => historyRoomFilter === 'ALL' || r.slotKey === historyRoomFilter)
                .map((room) => (
                  <div
                    key={`hist-${selectedHistoryEntry.archiveKey}-${room.slotKey}`}
                    className="bg-white border-2 border-[#0c2340] rounded-2xl overflow-hidden shadow-xs break-inside-avoid"
                  >
                    <div className="bg-[#0c2340] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-amber-400">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-black">{room.roomNumber}</h3>
                          <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-black">
                            निरीक्षक: {room.invigilator || '—'}
                          </span>
                        </div>
                        <p className="text-xs text-blue-100 font-semibold mt-0.5">
                          {room.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join('  ·  ')}
                        </p>
                      </div>
                      <div className="text-right text-xs font-black text-amber-300 tabular-nums">
                        {room.totalStudents} छात्र · {room.benches.length} बेंच
                      </div>
                    </div>

                    <div className="p-3 sm:p-4 space-y-2.5">
                      {room.benches.map((bench) => (
                        <div
                          key={`hb-${room.slotKey}-${bench.benchNumber}`}
                          className="flex flex-col sm:flex-row border border-slate-300 rounded-xl overflow-hidden bg-slate-50/40"
                        >
                          <div className="sm:w-24 shrink-0 bg-slate-100 border-b sm:border-b-0 sm:border-r border-slate-300 p-2.5 flex sm:flex-col items-center justify-center gap-1">
                            <span className="text-[10px] font-extrabold text-slate-500 uppercase">बेंच</span>
                            <span className="text-base font-black text-[#0c2340] tabular-nums">
                              #{bench.benchNumber}
                            </span>
                          </div>
                          <div
                            className={`flex-1 grid ${
                              selectedHistoryPlanData.seatsPerBench === 2
                                ? 'grid-cols-1 md:grid-cols-2'
                                : selectedHistoryPlanData.seatsPerBench === 4
                                ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
                                : 'grid-cols-1 md:grid-cols-3'
                            } divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white`}
                          >
                            {bench.seats.map((seat, sIdx) => {
                              const badgeClass =
                                CLASS_BADGE_COLORS[seat.classCode] || 'bg-slate-100 text-slate-900 border-slate-300';
                              return (
                                <div
                                  key={`${seat.student.Student_ID}-${sIdx}`}
                                  className="p-2.5 flex items-start justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                                      {seat.seatPosition}
                                    </div>
                                    <div className="text-sm font-black text-slate-900 truncate">
                                      {seat.student.Student_Name}
                                    </div>
                                    <div className="text-[11px] font-bold text-[#0c2340] tabular-nums">
                                      Roll: {seat.student.Roll_Number || '—'} · ID: {seat.student.Student_ID}
                                    </div>
                                  </div>
                                  <span
                                    className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-black ${badgeClass}`}
                                  >
                                    {seat.classLabel}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredHistoryEntries.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-2">
                  <div className="text-sm font-black text-slate-800">
                    अभी तक कोई तारीख-वार सीटिंग प्लान रिकॉर्ड सेव नहीं है।
                  </div>
                  <p className="text-xs text-slate-600">
                    "नया / चालू सिटिंग प्लान" में परीक्षा की तारीख चुनकर जब मैनेजर प्लान को कन्फर्म व सेव करेंगे, तो हर तारीख का पूरा डेटा यहाँ स्थायी रूप से दिखने लगेगा।
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredHistoryEntries.map((entry) => (
                    <div
                      key={entry.archiveKey}
                      className="bg-white border border-slate-200 hover:border-[#0c2340] rounded-2xl p-4 space-y-3 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2.5 py-1 rounded-lg bg-[#0c2340] text-amber-300 text-xs font-black tabular-nums">
                              {formatExamDateDisplay(entry.examDate)}
                            </span>
                            {entry.examShift && (
                              <span className="px-2 py-0.5 rounded-lg bg-indigo-100 text-indigo-900 text-xs font-black">
                                {entry.examShift}
                              </span>
                            )}
                            <span className="text-xs font-bold text-slate-600">
                              {entry.examType} ({entry.session})
                            </span>
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500 mt-1">
                            {entry.totalStudents} छात्र · {entry.roomsSummary.length} कमरे · कन्फर्म किया:{' '}
                            {entry.confirmedBy || 'Manager'}
                          </div>
                        </div>

                        {userRole === 'manager' && (
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteHistory(
                                entry.archiveKey,
                                `${formatExamDateDisplay(entry.examDate)}${entry.examShift ? ` (${entry.examShift})` : ''}`
                              )
                            }
                            disabled={deletingHistoryKey === entry.archiveKey}
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 cursor-pointer"
                            title="यह पुराना रिकॉर्ड हटाएं"
                          >
                            <i className="fa-solid fa-trash-can text-xs"></i>
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {entry.roomsSummary.map((rm) => (
                          <div
                            key={`${entry.archiveKey}-${rm.slotKey}`}
                            className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]"
                          >
                            <span className="font-black text-slate-900">{rm.roomNumber}</span>
                            <span className="text-slate-500"> · </span>
                            <span className="font-bold text-emerald-800">
                              {rm.invigilator || 'बिना निरीक्षक'}
                            </span>
                            <span className="text-slate-500 tabular-nums"> ({rm.totalStudents})</span>
                            {(rm.sentCount || 0) > 0 && (
                              <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 text-[10px] font-black tabular-nums">
                                ✓ {rm.sentCount}/{rm.totalStudents} रूम में
                              </span>
                            )}
                            {(rm.absentCount || 0) > 0 && (
                              <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-black tabular-nums">
                                {rm.absentCount} Abs
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedHistoryKey(entry.archiveKey);
                            setHistoryRoomFilter('ALL');
                          }}
                          className="flex-1 px-3 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-xs font-black cursor-pointer inline-flex items-center justify-center gap-1.5"
                        >
                          <i className="fa-solid fa-eye"></i>
                          <span>पूरा सिटिंग प्लान देखें</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadHistoryPdf(entry, 'ALL')}
                          className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <i className="fa-solid fa-file-pdf text-rose-600"></i>
                          <span>PDF</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
      {/* WORKFLOW STATUS BANNER */}
      <div
        className={`no-print rounded-2xl border p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
          workflowStatus === 'approved'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : workflowStatus === 'pending_approval'
            ? 'bg-amber-50 border-amber-300 text-amber-950'
            : 'bg-slate-50 border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${
              workflowStatus === 'approved'
                ? 'bg-emerald-600 text-white'
                : workflowStatus === 'pending_approval'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-[#0c2340] text-amber-300'
            }`}
          >
            <i
              className={`fa-solid ${
                workflowStatus === 'approved'
                  ? 'fa-circle-check'
                  : workflowStatus === 'pending_approval'
                  ? 'fa-hourglass-half'
                  : 'fa-chair'
              }`}
            ></i>
          </div>
          <div className="text-xs space-y-0.5">
            <div className="font-black text-sm flex flex-wrap items-center gap-2">
              {workflowStatus === 'approved' && (
                <span>✅ कन्फर्म और Google Sheet में सेव (Confirmed)</span>
              )}
              {workflowStatus === 'pending_approval' && (
                <span>⏳ मैनेजर कन्फर्मेशन के लिए प्रतीक्षारत (Pending Manager Approval)</span>
              )}
              {workflowStatus === 'draft' && (
                <span>📝 ड्राफ्ट सीटिंग प्लान (Teacher Room × Class Setup)</span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-white/80 border border-black/10 text-[10px] font-bold">
                {userRole === 'teacher' ? 'Teacher View' : 'Manager View'}
              </span>
            </div>
            <p className="text-[11px] font-semibold opacity-90">
              {workflowStatus === 'approved'
                ? `कन्फर्म किया: ${approvedBy || 'Manager'} ${approvedAt ? `· ${approvedAt}` : ''} — Sheet की "Exam_Seating_Plan" टैब में सेव है।`
                : workflowStatus === 'pending_approval'
                ? `टीचर (${submittedBy || 'Teacher'})${
                    submittedAt ? ` · ${submittedAt}` : ''
                  } ने यह प्लान भेजा है। ${
                    userRole === 'manager'
                      ? 'जांचें और नीचे "कन्फर्म व Google Sheet में सेव करें" दबाएं।'
                      : 'मैनेजर द्वारा कन्फर्म होने पर यह Google Sheet में सेव हो जाएगा।'
                  }`
                : userRole === 'teacher'
                ? 'हर कमरे के नीचे कक्षा-वार बच्चों की संख्या डालें → ऐप अपने-आप Anti-Cheating सीटिंग बना देगा → फिर "मैनेजर को कन्फर्मेशन के लिए भेजें" दबाएं।'
                : 'टीचर द्वारा भेजे गए प्लान को देखने के लिए "रिफ्रेश करें" दबाएं, या आप स्वयं कमरे तय करके सीधे Google Sheet में कन्फर्म कर सकते हैं।'}
            </p>
            {teacherNote && (
              <p className="text-[11px] font-bold text-indigo-900 bg-white/70 px-2 py-0.5 rounded inline-block mt-1">
                टीचर नोट: {teacherNote}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => loadFromServer(true)}
            disabled={refreshingSnapshot}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <i className={`fa-solid fa-rotate ${refreshingSnapshot ? 'fa-spin' : ''}`}></i>
            <span>ताज़ा प्लान लाएं</span>
          </button>

          {userRole === 'teacher' ? (
            <>
              <button
                type="button"
                onClick={() => handleTeacherSubmitForApproval(true)}
                disabled={submittingDraft}
                className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                <span>ड्राफ्ट सेव</span>
              </button>
              <button
                type="button"
                onClick={() => handleTeacherSubmitForApproval(false)}
                disabled={submittingDraft || seatingPlan.allocatedStudentsCount === 0}
                className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-50 text-amber-300 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i className={`fa-solid ${submittingDraft ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`}></i>
                <span>
                  {submittingDraft ? 'भेजा जा रहा है...' : 'मैनेजर को कन्फर्मेशन के लिए भेजें'}
                </span>
              </button>
            </>
          ) : (
            <>
              {workflowStatus === 'pending_approval' && (
                <button
                  type="button"
                  onClick={handleManagerReturnToDraft}
                  disabled={submittingDraft}
                  className="px-3 py-2 rounded-xl border border-rose-300 bg-white hover:bg-rose-50 text-rose-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fa-solid fa-rotate-left"></i>
                  <span>वापस भेजें</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleManagerConfirmAndSaveToSheet}
                disabled={savingToSheet || seatingPlan.allocatedStudentsCount === 0}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i className={`fa-solid ${savingToSheet ? 'fa-circle-notch fa-spin' : 'fa-check-double'}`}></i>
                <span>
                  {savingToSheet
                    ? 'Sheet में सेव हो रहा है...'
                    : 'कन्फर्म करें और Google Sheet में सेव करें'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* TOP CONTROL & SUMMARY CARD */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              स्मार्ट परीक्षा सीटिंग प्लान — रूम व क्लास चयन + ऑटो एंटी-चीटिंग
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              तय करें कि किस कमरे में किस कक्षा के कितने बच्चे बैठेंगे — ऐप अपने आप हर बेंच पर अलग-अलग कक्षा के बच्चे (0 नकल) बैठा देगा।
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleDownloadPdf('ALL')}
              disabled={seatingPlan.allocatedStudentsCount === 0}
              className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-50 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <i className="fa-solid fa-file-pdf"></i>
              <span>सभी कमरों की PDF डाउनलोड</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <i className="fa-solid fa-print"></i>
              <span>प्रिंट करें</span>
            </button>
          </div>
        </div>

        {/* EXAM DATE & SHIFT / SUBJECT METADATA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3">
          <div>
            <label className="block text-[11px] font-black text-[#0c2340] mb-1">
              परीक्षा की तारीख (Exam Date — हिस्ट्री के लिए)
            </label>
            <input
              type="date"
              value={examDate}
              onChange={(e) => {
                const nextDate = normalizeExamDateKey(e.target.value);
                markModifiedIfApproved();
                setExamDate(nextDate);
                persistLocalSnapshot(roomConfigs, seatsPerBench, mode, undefined, nextDate, examShift);
              }}
              className="w-full px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-xs font-black text-slate-900"
            />
          </div>
          <div>
            <label className="block text-[11px] font-black text-[#0c2340] mb-1">
              शिफ्ट / विषय (Shift / Subject — वैकल्पिक)
            </label>
            <input
              type="text"
              value={examShift}
              onChange={(e) => {
                const nextShift = e.target.value;
                markModifiedIfApproved();
                setExamShift(nextShift);
                persistLocalSnapshot(roomConfigs, seatsPerBench, mode, undefined, examDate, nextShift);
              }}
              placeholder="जैसे: Morning / Maths / Paper 1"
              className="w-full px-3 py-1.5 rounded-lg border border-blue-300 bg-white text-xs font-bold text-slate-900"
            />
          </div>
          <div className="flex items-end">
            <div className="w-full px-3 py-1.5 rounded-lg bg-white/80 border border-blue-200 text-[11px] font-semibold text-slate-700">
              कन्फर्म करते ही <span className="font-black text-[#0c2340]">{formatExamDateDisplay(examDate)}</span>
              {examShift.trim() ? ` (${examShift.trim()})` : ''} का पूरा रूम + टीचर + छात्र डेटा स्थायी रिकॉर्ड में जुड़ जाएगा।
            </div>
          </div>
        </div>

        {/* 4 SUMMARY KPI BOXES */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-bold text-slate-500">आवंटित छात्र (Seated)</div>
            <div className="text-xl font-black text-slate-900 tabular-nums mt-0.5">
              {seatingPlan.allocatedStudentsCount}{' '}
              <span className="text-sm font-bold text-slate-500">/ {seatingPlan.totalStudents}</span>
            </div>
            <div className="text-[11px] text-slate-600 font-semibold mt-0.5 tabular-nums">
              कुल {seatingPlan.totalBenches} बेंच ({seatsPerBench}/बेंच)
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
            <div className="text-[11px] font-bold text-blue-900">सक्रिय कमरे (Rooms)</div>
            <div className="text-xl font-black text-blue-950 tabular-nums mt-0.5">
              {seatingPlan.rooms.filter((r) => r.totalStudents > 0).length} / {seatingPlan.rooms.length} कमरे
            </div>
            <div className="text-[11px] text-blue-800 font-semibold mt-0.5 truncate">
              {seatingPlan.rooms
                .filter((r) => r.totalStudents > 0)
                .map((r) => `${r.roomNumber}: ${r.totalStudents}`)
                .join(' · ') || 'अभी किसी रूम में बच्चे नहीं'}
            </div>
          </div>

          <div
            className={`rounded-xl border p-3 ${
              seatingPlan.unassignedCount > 0 || overAllocatedClasses.length > 0
                ? 'border-amber-300 bg-amber-50/80'
                : 'border-indigo-200 bg-indigo-50/60'
            }`}
          >
            <div className="text-[11px] font-bold text-slate-700">बाकी बचे छात्र (Unassigned)</div>
            <div className="text-xl font-black text-slate-900 tabular-nums mt-0.5">
              {seatingPlan.unassignedCount} छात्र
            </div>
            <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
              {seatingPlan.unassignedCount === 0
                ? '✓ सभी बच्चे कमरों में बैठ गए हैं'
                : 'नीचे तालिका में पीले बैज से भरें'}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
            <div className="text-[11px] font-bold text-emerald-900">एंटी-चीटिंग व्यवस्था</div>
            <div className="text-xl font-black text-emerald-800 tabular-nums mt-0.5">
              {seatingPlan.totalSameClassConflicts === 0
                ? '0 पास-पास नकल'
                : `${seatingPlan.totalSameClassConflicts} जोड़े`}
            </div>
            <div className="text-[11px] text-emerald-800 font-semibold mt-0.5">
              {mode === 'anti_cheating_mixed'
                ? 'हर कक्षा अधिकतम दूरी पर (अगली-पिछली व अगल-बगल बेंच से दूर)'
                : 'एक कक्षा के बच्चे क्रमवार साथ'}
            </div>
          </div>
        </div>

        {/* ROOM x CLASS ALLOCATION MATRIX HEADER CONTROLS */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-table-cells text-[#0c2340]"></i>
                <span>स्टेप 1: चुनें किस कमरे में किस कक्षा के कितने बच्चे बैठेंगे</span>
              </h3>
              <p className="text-[11px] text-slate-600">
                हर बॉक्स में संख्या लिखें (या <span className="font-bold text-amber-800">+बाकी</span> बटन दबाकर बचे हुए सभी छात्र उस कमरे में डालें)।
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleAddRoom}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-plus"></i>
                <span>रूम जोड़ें</span>
              </button>
              <button
                type="button"
                onClick={handleAutoFillCounts}
                className="px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-300 hover:bg-blue-100 text-blue-900 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
                title="सभी कमरों में अपने-आप संतुलित संख्या भरें"
              >
                <i className="fa-solid fa-wand-magic-sparkles"></i>
                <span>ऑटो-बांटें</span>
              </button>
              <button
                type="button"
                onClick={handleClearAllCounts}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-eraser"></i>
                <span>सब 0 करें</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMatrixEditor((v) => !v)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200/80 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
              >
                {showMatrixEditor ? 'तालिका छुपाएं' : 'तालिका दिखाएं'}
              </button>
            </div>
          </div>

          {showMatrixEditor && (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#0c2340] text-white">
                      <th className="sticky left-0 z-10 bg-[#0c2340] text-left p-2.5 min-w-[165px] border-r border-white/15">
                        <div className="font-black text-amber-300">कक्षा (Class)</div>
                        <div className="text-[10px] font-medium text-blue-100">कुल छात्र · बाकी सीट</div>
                      </th>
                      {roomConfigs.map((room, rIdx) => {
                        const roomStats = seatingPlan.rooms[rIdx];
                        return (
                          <th
                            key={room.slotKey}
                            className="p-2 min-w-[148px] border-r border-white/15 align-top text-left"
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <input
                                type="text"
                                value={room.roomNumber}
                                onChange={(e) =>
                                  handleRoomFieldChange(room.slotKey, 'roomNumber', e.target.value)
                                }
                                placeholder={`Room ${rIdx + 1}`}
                                className="w-full px-2 py-1 rounded bg-white text-slate-950 text-xs font-black border border-amber-300"
                              />
                              {roomConfigs.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRoom(room.slotKey)}
                                  className="p-1 text-rose-300 hover:text-rose-100 cursor-pointer"
                                  title="यह रूम हटाएं"
                                >
                                  <i className="fa-solid fa-xmark"></i>
                                </button>
                              )}
                            </div>
                            {teacherOptions.length > 0 && !manualInvigSlots[room.slotKey] ? (
                              <div className="space-y-1">
                                <select
                                  value={
                                    room.invigilatorId
                                      ? `ID:${room.invigilatorId}`
                                      : room.invigilator
                                      ? `NAME:${room.invigilator}`
                                      : ''
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (val === '__MANUAL__') {
                                      setManualInvigSlots((prev) => ({ ...prev, [room.slotKey]: true }));
                                      return;
                                    }
                                    if (!val) {
                                      handleRoomFieldChange(room.slotKey, 'invigilator', '', '');
                                      return;
                                    }
                                    if (val.startsWith('ID:')) {
                                      const uId = val.slice(3);
                                      const u = teacherOptions.find((t) => String(t.User_ID) === uId);
                                      handleRoomFieldChange(
                                        room.slotKey,
                                        'invigilator',
                                        u?.Name || room.invigilator,
                                        uId
                                      );
                                    } else if (val.startsWith('NAME:')) {
                                      handleRoomFieldChange(room.slotKey, 'invigilator', val.slice(5), '');
                                    }
                                  }}
                                  className="w-full px-2 py-1 rounded bg-[#133262] text-white text-[11px] font-bold border border-white/25"
                                >
                                  <option value="">-- टीचर चुनें --</option>
                                  {teacherOptions.map((t) => (
                                    <option key={t.User_ID || t.Name} value={`ID:${t.User_ID}`}>
                                      {t.Name} ({t.Designation || 'Teacher'})
                                    </option>
                                  ))}
                                  {room.invigilator &&
                                    !teacherOptions.some(
                                      (t) =>
                                        (room.invigilatorId && t.User_ID === room.invigilatorId) ||
                                        t.Name.trim().toLowerCase() === room.invigilator.trim().toLowerCase()
                                    ) && (
                                      <option value={`NAME:${room.invigilator}`}>
                                        {room.invigilator}
                                      </option>
                                    )}
                                  <option value="__MANUAL__">✏️ अन्य नाम लिखें...</option>
                                </select>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={room.invigilator}
                                  onChange={(e) =>
                                    handleRoomFieldChange(room.slotKey, 'invigilator', e.target.value, '')
                                  }
                                  placeholder="निरीक्षक / टीचर"
                                  className="w-full px-2 py-1 rounded bg-white/10 text-white placeholder:text-blue-200/70 text-[11px] font-semibold border border-white/20"
                                />
                                {teacherOptions.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setManualInvigSlots((prev) => ({ ...prev, [room.slotKey]: false }))
                                    }
                                    className="p-1 text-amber-300 hover:text-amber-200 cursor-pointer shrink-0"
                                    title="टीचर सूची से चुनें"
                                  >
                                    <i className="fa-solid fa-list text-[11px]"></i>
                                  </button>
                                )}
                              </div>
                            )}
                            <div className="mt-1 text-[10px] font-bold text-amber-300 tabular-nums">
                              {roomStats?.totalStudents || 0} छात्र · {roomStats?.benches.length || 0} बेंच
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {seatingPlan.classSummaries.map((cls) => {
                      const isOver = cls.overAllocatedBy > 0;
                      const isDone = !isOver && cls.remainingCount === 0;
                      return (
                        <tr key={cls.classCode} className="hover:bg-slate-50/80">
                          <td className="sticky left-0 z-10 bg-white border-r border-slate-200 p-2">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-black text-slate-900">{cls.classLabel}</span>
                              <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                                ({cls.totalStudents})
                              </span>
                            </div>
                            <div className="mt-0.5">
                              {isOver ? (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-black tabular-nums">
                                  अधिक: +{cls.overAllocatedBy}!
                                </span>
                              ) : isDone ? (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-black">
                                  ✓ पूरे {cls.totalStudents} सेट
                                </span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-black tabular-nums">
                                  बाकी: {cls.remainingCount}
                                </span>
                              )}
                            </div>
                          </td>
                          {roomConfigs.map((room) => {
                            const val = Number(room.classCounts?.[cls.classCode] || 0);
                            return (
                              <td
                                key={`${cls.classCode}-${room.slotKey}`}
                                className={`p-1.5 border-r border-slate-200 ${
                                  val > 0 ? 'bg-blue-50/40' : ''
                                }`}
                              >
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    max={cls.totalStudents}
                                    value={val === 0 ? '' : val}
                                    placeholder="0"
                                    onChange={(e) =>
                                      handleClassCountChange(room.slotKey, cls.classCode, e.target.value)
                                    }
                                    className={`w-14 px-2 py-1 rounded-lg border text-center text-xs font-black tabular-nums ${
                                      isOver && val > 0
                                        ? 'border-rose-400 bg-rose-50 text-rose-900'
                                        : val > 0
                                        ? 'border-blue-400 bg-white text-[#0c2340]'
                                        : 'border-slate-300 bg-white text-slate-600'
                                    }`}
                                  />
                                  {cls.remainingCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleFillRemainingIntoRoom(
                                          room.slotKey,
                                          cls.classCode,
                                          cls.remainingCount
                                        )
                                      }
                                      className="px-1.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 text-[10px] font-black cursor-pointer shrink-0 tabular-nums"
                                      title={`बचे हुए ${cls.remainingCount} बच्चे इस कमरे में जोड़ें`}
                                    >
                                      +{cls.remainingCount}
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-black text-slate-900">
                      <td className="sticky left-0 z-10 bg-slate-100 p-2.5 border-r border-slate-300">
                        कमरे का कुल योग
                      </td>
                      {seatingPlan.rooms.map((room) => (
                        <td
                          key={`tot-${room.slotKey}`}
                          className="p-2.5 border-r border-slate-300 tabular-nums text-xs"
                        >
                          <div className="text-[#0c2340] font-black">
                            {room.totalStudents} छात्र · {room.benches.length} बेंच
                          </div>
                          <div className="text-[10px] font-semibold text-slate-600 truncate">
                            {room.adjacentSameClassPairs === 0
                              ? '✓ 0 नकल जोड़े'
                              : `${room.adjacentSameClassPairs} पास-पास जोड़े`}
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Optional note field for Teacher */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-xs font-bold text-slate-700 shrink-0">
                  {userRole === 'teacher' ? 'टीचर नोट (वैकल्पिक):' : 'टीचर/मैनेजर नोट:'}
                </label>
                <input
                  type="text"
                  value={teacherNote}
                  onChange={(e) => setTeacherNote(e.target.value)}
                  placeholder="जैसे: 5वीं और 6वीं को हॉल 1 में रखा है, छोटे बच्चे नीचे के कमरों में..."
                  className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900"
                />
              </div>
            </>
          )}
        </div>

        {/* FILTER + MODE + SEATS CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedRoomKey}
              onChange={(e) => setSelectedRoomKey(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
            >
              <option value="ALL">
                सभी {seatingPlan.rooms.length} कमरे दिखाएं ({seatingPlan.allocatedStudentsCount} छात्र)
              </option>
              {seatingPlan.rooms.map((r) => (
                <option key={r.slotKey} value={r.slotKey}>
                  {r.roomNumber} ({r.totalStudents} छात्र · {r.benches.length} बेंच)
                </option>
              ))}
            </select>

            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  markModifiedIfApproved();
                  setMode('anti_cheating_mixed');
                  persistLocalSnapshot(roomConfigs, seatsPerBench, 'anti_cheating_mixed');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  mode === 'anti_cheating_mixed'
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                एंटी-चीटिंग मिक्स्ड (बिना नकल)
              </button>
              <button
                type="button"
                onClick={() => {
                  markModifiedIfApproved();
                  setMode('class_grouped');
                  persistLocalSnapshot(roomConfigs, seatsPerBench, 'class_grouped');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  mode === 'class_grouped'
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                कक्षा-वार क्रम से
              </button>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
              <span className="font-bold text-slate-700">1 बेंच पर:</span>
              {[2, 3, 4].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => {
                    markModifiedIfApproved();
                    setSeatsPerBench(cnt);
                    persistLocalSnapshot(roomConfigs, cnt, mode);
                  }}
                  className={`px-2 py-0.5 rounded-md font-black cursor-pointer tabular-nums ${
                    seatsPerBench === cnt
                      ? 'bg-[#0c2340] text-amber-300'
                      : 'bg-white text-slate-700 border border-slate-300'
                  }`}
                >
                  {cnt}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ALERTS & NOTICES */}
        {overAllocatedClasses.length > 0 && (
          <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold">
            ⚠️ चेतावनी: इन कक्षाओं में वास्तविक छात्रों से ज्यादा संख्या डाली गई है —{' '}
            {overAllocatedClasses.map((c) => `${c.classLabel} (+${c.overAllocatedBy})`).join(', ')}। कृपया सही करें।
          </div>
        )}

        {errorMsg && (
          <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {errorMsg}
          </div>
        )}

        {notice && (
          <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            {notice}
          </div>
        )}

        {sheetWarning && (
          <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{sheetWarning}</span>
            {onOpenSheetSetup && (
              <button
                type="button"
                onClick={onOpenSheetSetup}
                className="px-3 py-1 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-[11px] font-bold cursor-pointer"
              >
                शीट सेटअप कोड देखें
              </button>
            )}
          </div>
        )}
      </div>

      {/* ROOM-BY-ROOM BENCH SEATING CARDS (PRINTABLE) */}
      <div className="space-y-5">
        {visibleRooms.map((room) => (
          <div
            key={room.slotKey}
            className="bg-white border-2 border-[#0c2340] rounded-2xl overflow-hidden shadow-xs break-inside-avoid print:break-after-page print:rounded-none"
          >
            {/* Room Header */}
            <div className="bg-[#0c2340] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-amber-400">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base sm:text-lg font-black tracking-wide">{room.roomNumber}</h3>
                  <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-black">
                    {room.groupLabelHi}
                  </span>
                  {room.adjacentSameClassPairs === 0 && room.totalStudents > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[10px] font-black">
                      ✓ 0 नकल जोड़े
                    </span>
                  )}
                  {(() => {
                    const liveDisp =
                      serverSnapshot?.roomDispatches?.[`${activeArchiveKey}::${room.slotKey}`] ||
                      serverSnapshot?.roomDispatches?.[`${activeArchiveKey}::${room.roomNumber}`];
                    if (!liveDisp) return null;
                    return (
                      <span className="px-2 py-0.5 rounded bg-emerald-400 text-slate-950 text-[10px] font-black tabular-nums">
                        ✓ {liveDisp.sentCount}/{liveDisp.totalStudents} रूम में भेजे गए
                        {liveDisp.absentCount > 0 ? ` (${liveDisp.absentCount} Abs)` : ''}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-blue-100 font-semibold mt-0.5">
                  {room.classBreakdown.length > 0
                    ? room.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join('  ·  ')
                    : 'अभी इस कमरे में कोई कक्षा नहीं चुनी गई है'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="text-right tabular-nums">
                  <div className="font-black text-amber-300">
                    {room.totalStudents} छात्र · {room.benches.length} बेंच
                  </div>
                  <div className="text-[11px] text-blue-100">निरीक्षक: {room.invigilator || '—'}</div>
                </div>
                {room.totalStudents > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(room.slotKey)}
                    className="no-print px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-black cursor-pointer inline-flex items-center gap-1"
                  >
                    <i className="fa-solid fa-file-arrow-down"></i>
                    <span>PDF</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bench-by-Bench Grid */}
            <div className="p-3 sm:p-4 space-y-2.5">
              {room.benches.length === 0 ? (
                <div className="py-6 text-center text-xs font-bold text-slate-500">
                  इस कमरे में कोई छात्र आवंटित नहीं है। ऊपर की तालिका में संख्या भरें।
                </div>
              ) : (
                room.benches.map((bench) => (
                  <div
                    key={`${room.slotKey}-b-${bench.benchNumber}`}
                    className="flex flex-col sm:flex-row border border-slate-300 rounded-xl overflow-hidden bg-slate-50/40"
                  >
                    <div className="sm:w-24 shrink-0 bg-slate-100 border-b sm:border-b-0 sm:border-r border-slate-300 px-3 py-2 flex sm:flex-col items-center justify-between sm:justify-center text-center">
                      <span className="text-xs font-black text-[#0c2340] tabular-nums">
                        Bench {bench.benchNumber}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                        {bench.seats.length}/{seatsPerBench} सीट
                      </span>
                    </div>

                    <div
                      className={`flex-1 grid ${gridColsClass} divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white`}
                    >
                      {Array.from({ length: seatsPerBench }, (_, sIdx) => {
                        const seat = bench.seats[sIdx];
                        if (!seat) {
                          return (
                            <div
                              key={`empty-${sIdx}`}
                              className="p-2.5 flex items-center justify-center text-xs text-slate-400 font-semibold"
                            >
                              — खाली सीट —
                            </div>
                          );
                        }
                        const badgeClass =
                          CLASS_BADGE_COLORS[seat.classCode] || 'bg-slate-100 text-slate-900 border-slate-300';
                        return (
                          <div
                            key={seat.student.Student_ID}
                            className="p-2.5 flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                                {seat.seatPosition}
                              </div>
                              <div className="text-sm font-black text-slate-900 truncate">
                                {seat.student.Student_Name}
                              </div>
                              <div className="text-[11px] font-bold text-[#0c2340] tabular-nums">
                                Roll: {seat.student.Roll_Number || '—'} · ID: {seat.student.Student_ID}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-black ${badgeClass}`}
                            >
                              {seat.classLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
        </>
      )}
    </div>
  );
};
