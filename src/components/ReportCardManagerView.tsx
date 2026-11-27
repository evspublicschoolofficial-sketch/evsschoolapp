import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExamMarkRecord,
  ExamTermType,
  ReportCardAccessConfig,
  ReportCardRemarkRecord,
  SchoolUser,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import {
  CURRENT_ACADEMIC_SESSION,
  DEFAULT_MAX_MARKS_BY_TERM,
  DEFAULT_REPORT_CARD_ACCESS_CONFIG,
  EXAM_TERM_LABELS,
  REPORT_CARD_SUBJECTS,
  ReportCardBackupRow,
  ReportCardWorkflowSnapshot,
  computeClassRanksMap,
  computeStudentReportCardData,
  confirmPendingReportCardsToSheet,
  fetchReportCardWorkflowFromServer,
  normalizeSubjectKey,
  rejectPendingReportCardsOnServer,
  saveExamMarksBatchToServer,
  saveReportCardMetaToServer,
  submitTeacherReportCardDraftToServer,
  syncAllReportCardsBackupToSheet,
  updateReportCardAccessConfigOnServer,
} from '../utils/reportCardHelper';
import { getLocalTimestamp } from '../utils/localTime';
import { realtimeSync } from '../utils/realtimeSync';
import { PrintableReportCard } from './PrintableReportCard';

interface ReportCardManagerViewProps {
  students: Student[];
  users?: SchoolUser[];
  behaviorList: StudentBehaviorRecord[];
  weeklyTests: WeeklyTestRecord[];
  examMarks: ExamMarkRecord[];
  reportCardMeta: Record<string, ReportCardRemarkRecord>;
  onExamMarksUpdated: (marks: ExamMarkRecord[]) => void;
  onReportCardMetaUpdated: (meta: Record<string, ReportCardRemarkRecord>) => void;
  currentUser: { id?: string; name?: string; role?: string; assignedClass?: string };
  isManager: boolean;
  accessConfig?: ReportCardAccessConfig;
  pendingMarks?: ExamMarkRecord[];
  pendingMeta?: Record<string, ReportCardRemarkRecord>;
  onWorkflowUpdated?: (snap: ReportCardWorkflowSnapshot) => void;
}

const normalizeClassToken = (cls: string) =>
  String(cls || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^class-?/, '');

const getClassSortRank = (cls: string): number => {
  const t = normalizeClassToken(cls);
  if (!t) return 999;
  if (t.includes('play') || t.includes('pn') || t.includes('pre')) return 0;
  if (t.includes('nur')) return 1;
  if (t.includes('lkg')) return 2;
  if (t.includes('ukg')) return 3;
  const m = t.match(/\d+/);
  if (m) return 10 + parseInt(m[0], 10);
  return 500;
};

type QueueSortOption =
  | 'newest'
  | 'teacher_asc'
  | 'class_asc'
  | 'student_asc'
  | 'roll_asc'
  | 'marks_desc'
  | 'marks_asc'
  | 'subject_asc';

type DraftRowState = { obtained: string; absent: boolean; remarks: string };

export const ReportCardManagerView: React.FC<ReportCardManagerViewProps> = ({
  students,
  users = [],
  behaviorList,
  weeklyTests,
  examMarks,
  reportCardMeta,
  onExamMarksUpdated,
  onReportCardMetaUpdated,
  currentUser,
  isManager,
  accessConfig = DEFAULT_REPORT_CARD_ACCESS_CONFIG,
  pendingMarks = [],
  pendingMeta = {},
  onWorkflowUpdated,
}) => {
  const pendingMetaList = useMemo(() => Object.values(pendingMeta || {}), [pendingMeta]);
  const totalPendingCount = pendingMarks.length + pendingMetaList.length;

  const [hasManuallySwitchedTab, setHasManuallySwitchedTab] = useState(false);

  const [activeSubTab, setActiveSubTab] = useState<
    'pending_approvals' | 'report_card' | 'enter_marks' | 'merit_backup' | 'ptm_view'
  >(() => {
    if (!isManager) return 'enter_marks';
    return totalPendingCount > 0 ? 'pending_approvals' : 'report_card';
  });

  // Load workflow (permissions + teacher pending drafts) from cache first on mount
  useEffect(() => {
    fetchReportCardWorkflowFromServer(false)
      .then((snap) => onWorkflowUpdated?.(snap))
      .catch(() => {});
  }, []);

  // If async fetch finds pending teacher drafts for Manager who hasn't switched tabs yet, open Pending Approvals automatically
  useEffect(() => {
    if (isManager && !hasManuallySwitchedTab && totalPendingCount > 0 && activeSubTab === 'report_card') {
      setActiveSubTab('pending_approvals');
    }
  }, [isManager, hasManuallySwitchedTab, totalPendingCount, activeSubTab]);

  // Strict guard: Teacher can NEVER stay on manager-only sub-tabs
  useEffect(() => {
    if (!isManager && activeSubTab !== 'enter_marks' && activeSubTab !== 'ptm_view') {
      setActiveSubTab('enter_marks');
    }
  }, [isManager, activeSubTab]);

  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(
    null
  );

  // Determine available classes
  const availableClasses = useMemo(() => {
    const classSet = new Set<string>();
    students.forEach((s) => {
      if (s.Class) classSet.add(String(s.Class).trim());
    });
    const allSorted = Array.from(classSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (isManager || !currentUser.assignedClass) return allSorted;

    const assignedTokens = String(currentUser.assignedClass)
      .split(/[,/|]+/)
      .map((c) => normalizeClassToken(c))
      .filter(Boolean);

    if (assignedTokens.length === 0 || assignedTokens.includes('all')) return allSorted;
    const filtered = allSorted.filter((c) => assignedTokens.includes(normalizeClassToken(c)));
    return filtered.length > 0 ? filtered : allSorted;
  }, [students, isManager, currentUser.assignedClass]);

  const [selectedClass, setSelectedClass] = useState<string>(() => availableClasses[0] || '');

  useEffect(() => {
    if (availableClasses.length === 0) return;
    if (!selectedClass) {
      setSelectedClass(availableClasses[0]);
      return;
    }
    if (selectedClass !== 'ALL' && !availableClasses.includes(selectedClass)) {
      const matched = availableClasses.find((c) => normalizeClassToken(c) === normalizeClassToken(selectedClass));
      setSelectedClass(matched || availableClasses[0]);
    }
  }, [availableClasses, selectedClass]);

  const classStudents = useMemo(() => {
    if (!selectedClass || selectedClass === 'ALL') return students;
    const tok = normalizeClassToken(selectedClass);
    return students.filter((s) => normalizeClassToken(s.Class) === tok);
  }, [students, selectedClass]);

  const [selectedStudentId, setSelectedStudentId] = useState<string>('');

  useEffect(() => {
    if (classStudents.length > 0 && !classStudents.some((s) => String(s.Student_ID || '') === selectedStudentId)) {
      setSelectedStudentId(String(classStudents[0].Student_ID || ''));
    }
  }, [classStudents, selectedStudentId]);

  const selectedStudent = useMemo(
    () => classStudents.find((s) => String(s.Student_ID || '') === selectedStudentId) || classStudents[0] || null,
    [classStudents, selectedStudentId]
  );

  // Confirmed Report Card Data (always built from Manager-confirmed examMarks + reportCardMeta)
  const selectedReportData = useMemo(() => {
    if (!selectedStudent) return null;
    return computeStudentReportCardData({
      student: selectedStudent,
      weeklyTests,
      examMarks,
      behaviorList,
      metaMap: reportCardMeta,
      session: CURRENT_ACADEMIC_SESSION,
    });
  }, [selectedStudent, weeklyTests, examMarks, behaviorList, reportCardMeta]);

  const classRanksMap = useMemo(
    () =>
      computeClassRanksMap({
        students,
        weeklyTests,
        examMarks,
        behaviorList,
        metaMap: reportCardMeta,
        session: CURRENT_ACADEMIC_SESSION,
      }),
    [students, weeklyTests, examMarks, behaviorList, reportCardMeta]
  );

  // Access config toggles (Manager only)
  const [updatingAccess, setUpdatingAccess] = useState(false);

  const handleToggleAccessConfig = async (field: 'allowTeacherPtmView' | 'allowParentView') => {
    if (!isManager) return;
    setUpdatingAccess(true);
    setStatusBanner(null);
    try {
      const nextVal = !accessConfig[field];
      const res = await updateReportCardAccessConfigOnServer({
        [field]: nextVal,
        updatedBy: currentUser.name || 'Manager',
      });
      onWorkflowUpdated?.(res.snapshot);
      realtimeSync.broadcastUpdate('report_card_workflow', 'access_updated', {
        allowTeacherQrAttendance: res.snapshot.accessConfig.allowTeacherQrAttendance,
      });

      if (!res.serverOk && !res.sheetSynced) {
        setStatusBanner({
          type: 'error',
          text: `⚠️ अनुमति क्लाउड/Google Sheet में सेव नहीं हो पाई: ${res.sheetError || 'इंटरनेट या Apps Script जांचें'}`,
        });
        return;
      }

      const syncSuffix = res.sheetSynced ? ' (क्लाउड व Google Sheet सिंक पूर्ण)' : ' (ऐप सर्वर पर सेव)';
      if (field === 'allowTeacherPtmView') {
        setStatusBanner({
          type: res.sheetSynced ? 'success' : 'warning',
          text: res.snapshot.accessConfig.allowTeacherPtmView
            ? `✅ टीचर PTM मार्कशीट व्यू अनुमति चालू कर दी गई है${syncSuffix}।`
            : `🔒 टीचर PTM मार्कशीट व्यू अनुमति बंद कर दी गई है${syncSuffix}।`,
        });
      } else {
        setStatusBanner({
          type: res.sheetSynced ? 'success' : 'warning',
          text: res.snapshot.accessConfig.allowParentView
            ? `✅ अभिभावक/बच्चों के लिए रिपोर्ट कार्ड पोर्टल लाइव कर दिया गया है${syncSuffix}!`
            : `🔒 अभिभावक/बच्चों के लिए रिपोर्ट कार्ड देखना अभी बंद कर दिया गया है${syncSuffix}।`,
        });
      }
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'अनुमति अपडेट करने में त्रुटि हुई।' });
    } finally {
      setUpdatingAccess(false);
    }
  };

  const [refreshingWorkflow, setRefreshingWorkflow] = useState(false);
  const handleRefreshWorkflow = async (silent = false) => {
    setRefreshingWorkflow(true);
    try {
      const snap = await fetchReportCardWorkflowFromServer(true);
      onWorkflowUpdated?.(snap);
      if (!silent) {
        if (isManager) {
          const pCount = (snap.pendingMarks?.length || 0) + Object.keys(snap.pendingMeta || {}).length;
          setStatusBanner({
            type: 'success',
            text:
              pCount > 0
                ? `🔄 ताज़ा डेटा लोड: ${pCount} पेंडिंग टीचर ड्राफ्ट कन्फर्मेशन हेतु तैयार हैं।`
                : '✅ ताज़ा स्थिति लोड हो गई — अभी कोई नया पेंडिंग ड्राफ्ट नहीं है।',
          });
        } else {
          setStatusBanner({
            type: snap.accessConfig.allowTeacherPtmView ? 'success' : 'warning',
            text: snap.accessConfig.allowTeacherPtmView
              ? 'अनुमति अपडेट: मैनेजर द्वारा PTM मार्कशीट व्यू अनुमति चालू है।'
              : 'अनुमति स्थिति रीफ्रेश हो गई: अभी मैनेजर द्वारा मार्कशीट देखना बंद है।',
          });
        }
      }
    } catch {
      if (!silent) {
        setStatusBanner({ type: 'error', text: 'अनुमति व ड्राफ्ट स्थिति जांचने में समस्या आई।' });
      }
    } finally {
      setRefreshingWorkflow(false);
    }
  };

  // Remark Editor State (Manager direct edit vs Teacher draft submission)
  const [teacherRemarkDraft, setTeacherRemarkDraft] = useState('');
  const [principalRemarkDraft, setPrincipalRemarkDraft] = useState('');
  const [resultStatusDraft, setResultStatusDraft] = useState<'PROMOTED' | 'PASSED' | 'NEEDS IMPROVEMENT' | 'DETAINED'>(
    'PROMOTED'
  );
  const [publishedDraft, setPublishedDraft] = useState(true);
  const [savingRemark, setSavingRemark] = useState(false);

  useEffect(() => {
    if (!selectedReportData) return;
    const key = `${CURRENT_ACADEMIC_SESSION}::${selectedReportData.student.Student_ID}`;
    const pendingDraft = !isManager ? pendingMeta[key] : undefined;
    if (pendingDraft) {
      setTeacherRemarkDraft(pendingDraft.teacherRemark || selectedReportData.autoTeacherRemark);
      setResultStatusDraft((pendingDraft.resultStatus as any) || 'PROMOTED');
    } else {
      setTeacherRemarkDraft(selectedReportData.meta.teacherRemark || selectedReportData.autoTeacherRemark);
      setPrincipalRemarkDraft(selectedReportData.meta.principalRemark || selectedReportData.autoPrincipalRemark);
      setResultStatusDraft((selectedReportData.meta.resultStatus as any) || 'PROMOTED');
      setPublishedDraft(selectedReportData.meta.publishedToParent !== false);
    }
  }, [selectedReportData?.student.Student_ID, reportCardMeta, pendingMeta, isManager]);

  const handleSaveRemarksManager = async () => {
    if (!isManager || !selectedReportData) return;
    setSavingRemark(true);
    setStatusBanner(null);
    try {
      const payload: ReportCardRemarkRecord & {
        studentName?: string;
        className?: string;
        rollNumber?: string;
        classRank?: string;
      } = {
        reportKey: `${CURRENT_ACADEMIC_SESSION}::${selectedReportData.student.Student_ID}`,
        session: CURRENT_ACADEMIC_SESSION,
        studentId: selectedReportData.student.Student_ID,
        studentName: selectedReportData.student.Student_Name,
        className: selectedReportData.student.Class,
        rollNumber: String(selectedReportData.student.Roll_Number || ''),
        teacherRemark: teacherRemarkDraft.trim() || selectedReportData.autoTeacherRemark,
        principalRemark: principalRemarkDraft.trim() || selectedReportData.autoPrincipalRemark,
        resultStatus: resultStatusDraft,
        publishedToParent: publishedDraft,
        classRank: classRanksMap[selectedReportData.student.Student_ID]?.label || '—',
        approvalStatus: 'approved',
        updatedBy: currentUser.name || 'Manager',
        updatedAt: getLocalTimestamp(),
      };
      const res = await saveReportCardMetaToServer(payload);
      onReportCardMetaUpdated(res.metaMap);
      setStatusBanner({
        type: res.sheetSynced ? 'success' : 'warning',
        text: res.sheetSynced
          ? 'रिमार्क व रिपोर्ट कार्ड सेटिंग Google Sheet (Report_Cards_Backup) में सेव हो गई!'
          : 'रिमार्क ऐप में सेव हो गया! Google Sheet में सिंक करने हेतु Apps Script नया वर्शन डिप्लॉय करें।',
      });
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'रिमार्क सेव करने में त्रुटि हुई।' });
    } finally {
      setSavingRemark(false);
    }
  };

  const handleSubmitTeacherRemarkDraft = async () => {
    if (isManager || !selectedReportData) return;
    setSavingRemark(true);
    setStatusBanner(null);
    try {
      const payload: ReportCardRemarkRecord & { studentName?: string; className?: string; rollNumber?: string } = {
        reportKey: `${CURRENT_ACADEMIC_SESSION}::${selectedReportData.student.Student_ID}`,
        session: CURRENT_ACADEMIC_SESSION,
        studentId: selectedReportData.student.Student_ID,
        studentName: selectedReportData.student.Student_Name,
        className: selectedReportData.student.Class,
        rollNumber: String(selectedReportData.student.Roll_Number || ''),
        teacherRemark: teacherRemarkDraft.trim() || selectedReportData.autoTeacherRemark,
        principalRemark: '',
        resultStatus: resultStatusDraft,
        publishedToParent: false,
        submittedBy: currentUser.name || 'Teacher',
        submittedAt: getLocalTimestamp(),
        approvalStatus: 'pending_approval',
      };
      const res = await submitTeacherReportCardDraftToServer({
        meta: payload,
        submittedBy: currentUser.name || 'Teacher',
        submittedById: currentUser.id,
      });
      onWorkflowUpdated?.(res.snapshot);
      realtimeSync.broadcastUpdate('report_card_workflow', 'teacher_submit');
      if (!res.serverOk && !res.sheetSynced) {
        setStatusBanner({
          type: 'error',
          text: `❌ रिमार्क ड्राफ्ट मैनेजर तक नहीं पहुंच सका (${res.sheetError || 'सर्वर व Google Sheet सिंक विफल'})। कृपया इंटरनेट या Apps Script जांचकर दोबारा भेजें।`,
        });
      } else if (!res.sheetSynced) {
        setStatusBanner({
          type: 'warning',
          text: `⚠️ रिमार्क ड्राफ्ट ऐप सर्वर पर भेजा गया है, लेकिन Google Sheet सिंक में समस्या आई: ${res.sheetError || 'Apps Script जांचें'}।`,
        });
      } else {
        setStatusBanner({
          type: 'success',
          text: `✅ ${selectedReportData.student.Student_Name} का टीचर रिमार्क व परिणाम ड्राफ्ट क्लाउड में मैनेजर कन्फर्मेशन के लिए भेज दिया गया है!`,
        });
      }
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'ड्राफ्ट भेजने में त्रुटि हुई।' });
    } finally {
      setSavingRemark(false);
    }
  };

  // Batch Exam Marks Entry State
  const [examTerm, setExamTerm] = useState<ExamTermType>('Quarterly');
  const [examSubject, setExamSubject] = useState<string>(REPORT_CARD_SUBJECTS[0]);
  const [customSubject, setCustomSubject] = useState<string>('');
  const [maxMarksInput, setMaxMarksInput] = useState<string>(String(DEFAULT_MAX_MARKS_BY_TERM.Quarterly));
  const [savingMarks, setSavingMarks] = useState(false);

  const parsedMaxMarks = parseInt(maxMarksInput, 10);
  const maxMarks =
    Number.isFinite(parsedMaxMarks) && parsedMaxMarks > 0
      ? Math.min(500, parsedMaxMarks)
      : DEFAULT_MAX_MARKS_BY_TERM[examTerm];

  const effectiveSubject = examSubject === '__CUSTOM__' ? customSubject.trim() || 'सामान्य ज्ञान' : examSubject;

  const entryContextKey = `${currentUser.id || currentUser.name || (isManager ? 'mgr' : 'tch')}::${selectedClass}::${examTerm}::${effectiveSubject}::${isManager ? 'M' : 'T'}`;
  const localDraftStorageKey = `evs_marks_entry_draft_v1::${entryContextKey}`;

  const lastContextKeyRef = useRef<string>('');
  const dirtyStudentIdsRef = useRef<Set<string>>(new Set());
  const [hasRestoredLocalDraft, setHasRestoredLocalDraft] = useState(false);

  const handleExamTermChange = (term: ExamTermType) => {
    setExamTerm(term);
    setMaxMarksInput(String(DEFAULT_MAX_MARKS_BY_TERM[term]));
  };

  const [marksDraft, setMarksDraft] = useState<Record<string, DraftRowState>>({});

  const persistLocalDraft = (rows: Record<string, DraftRowState>, overrideMaxStr?: string) => {
    try {
      localStorage.setItem(
        localDraftStorageKey,
        JSON.stringify({
          maxMarksInput: overrideMaxStr !== undefined ? overrideMaxStr : maxMarksInput,
          rows,
          updatedAt: Date.now(),
        })
      );
    } catch {}
  };

  const handleMaxMarksInputChange = (rawVal: string) => {
    const cleaned = rawVal.replace(/[^0-9]/g, '').slice(0, 3);
    setMaxMarksInput(cleaned);
    persistLocalDraft(marksDraft, cleaned);
  };

  const handleSelectMaxMarksPreset = (val: number) => {
    const strVal = String(val);
    setMaxMarksInput(strVal);
    persistLocalDraft(marksDraft, strVal);
  };

  const updateStudentDraftRow = (studentId: string, patch: Partial<DraftRowState>) => {
    if (!studentId) return;
    dirtyStudentIdsRef.current.add(studentId);
    setMarksDraft((prev) => {
      const cur = prev[studentId] || { obtained: '', absent: false, remarks: '' };
      const next: Record<string, DraftRowState> = {
        ...prev,
        [studentId]: { ...cur, ...patch },
      };
      persistLocalDraft(next);
      return next;
    });
  };

  useEffect(() => {
    const subjLower = effectiveSubject.trim().toLowerCase();
    const subjKey = normalizeSubjectKey(effectiveSubject);
    const serverBase: Record<string, DraftRowState> = {};

    classStudents.forEach((st) => {
      const sid = String(st.Student_ID || '').trim();
      if (!sid) return;
      const matchFn = (m: ExamMarkRecord) =>
        String(m.student_id || '').trim().toLowerCase() === sid.toLowerCase() &&
        m.exam_type === examTerm &&
        (String(m.subject || '').trim().toLowerCase() === subjLower ||
          (subjKey && normalizeSubjectKey(m.subject) === subjKey)) &&
        (!m.session || m.session === CURRENT_ACADEMIC_SESSION);

      // For Teacher, prefer their pending submission if present so they can edit before Manager confirms
      const pendingExisting = !isManager ? pendingMarks.find(matchFn) : undefined;
      const confirmedExisting = examMarks.find(matchFn);
      const source = pendingExisting || confirmedExisting;

      serverBase[sid] = {
        obtained: source ? String(source.marks_obtained ?? '') : '',
        absent: source?.attendance_status === 'Absent',
        remarks: source?.remarks ? String(source.remarks) : '',
      };
    });

    const isContextSwitch = lastContextKeyRef.current !== entryContextKey;

    if (isContextSwitch) {
      lastContextKeyRef.current = entryContextKey;
      dirtyStudentIdsRef.current.clear();

      // Check for unsaved local auto-draft (prevents data loss if phone refreshed or tab closed mid-entry)
      let restored = false;
      const merged: Record<string, DraftRowState> = { ...serverBase };
      try {
        const raw = localStorage.getItem(localDraftStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.rows && typeof parsed.rows === 'object') {
            let anyDirty = false;
            Object.entries(parsed.rows as Record<string, DraftRowState>).forEach(([sid, row]) => {
              if (!row) return;
              const base = serverBase[sid] || { obtained: '', absent: false, remarks: '' };
              const differs =
                String(row.obtained || '') !== String(base.obtained || '') ||
                Boolean(row.absent) !== Boolean(base.absent) ||
                String(row.remarks || '') !== String(base.remarks || '');
              if (differs || row.obtained !== '' || row.absent || row.remarks !== '') {
                merged[sid] = {
                  obtained: String(row.obtained ?? ''),
                  absent: Boolean(row.absent),
                  remarks: String(row.remarks ?? ''),
                };
                if (differs) {
                  dirtyStudentIdsRef.current.add(sid);
                  anyDirty = true;
                }
              }
            });
            if (typeof parsed.maxMarksInput === 'string' && parsed.maxMarksInput.trim() !== '') {
              setMaxMarksInput(parsed.maxMarksInput);
            }
            restored = anyDirty;
          }
        }
      } catch {}

      setHasRestoredLocalDraft(restored);
      setMarksDraft(merged);
      return;
    }

    // Background sync while teacher is actively typing: NEVER overwrite dirty or already-typed cells!
    setMarksDraft((prev) => {
      let changed = false;
      const next: Record<string, DraftRowState> = { ...prev };
      Object.entries(serverBase).forEach(([sid, srvRow]) => {
        const cur = prev[sid];
        if (!cur) {
          next[sid] = srvRow;
          changed = true;
          return;
        }
        if (dirtyStudentIdsRef.current.has(sid)) return;
        const userTypedSomething = cur.obtained.trim() !== '' || cur.absent || cur.remarks.trim() !== '';
        if (!userTypedSomething && (srvRow.obtained !== '' || srvRow.absent || srvRow.remarks !== '')) {
          next[sid] = srvRow;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [classStudents, examMarks, pendingMarks, examTerm, effectiveSubject, isManager, entryContextKey, localDraftStorageKey]);

  const handleResetLocalDraft = () => {
    try {
      localStorage.removeItem(localDraftStorageKey);
    } catch {}
    dirtyStudentIdsRef.current.clear();
    setHasRestoredLocalDraft(false);
    lastContextKeyRef.current = '';
    setMaxMarksInput(String(DEFAULT_MAX_MARKS_BY_TERM[examTerm]));
    const subjLower = effectiveSubject.trim().toLowerCase();
    const subjKey = normalizeSubjectKey(effectiveSubject);
    const fresh: Record<string, DraftRowState> = {};
    classStudents.forEach((st) => {
      const sid = String(st.Student_ID || '').trim();
      if (!sid) return;
      const matchFn = (m: ExamMarkRecord) =>
        String(m.student_id || '').trim().toLowerCase() === sid.toLowerCase() &&
        m.exam_type === examTerm &&
        (String(m.subject || '').trim().toLowerCase() === subjLower ||
          (subjKey && normalizeSubjectKey(m.subject) === subjKey)) &&
        (!m.session || m.session === CURRENT_ACADEMIC_SESSION);
      const pendingExisting = !isManager ? pendingMarks.find(matchFn) : undefined;
      const confirmedExisting = examMarks.find(matchFn);
      const source = pendingExisting || confirmedExisting;
      fresh[sid] = {
        obtained: source ? String(source.marks_obtained ?? '') : '',
        absent: source?.attendance_status === 'Absent',
        remarks: source?.remarks ? String(source.remarks) : '',
      };
    });
    setMarksDraft(fresh);
  };

  const handleSaveBatchMarks = async () => {
    if (classStudents.length === 0) return;
    const typedMax = parseInt(maxMarksInput.trim(), 10);
    if (!Number.isFinite(typedMax) || typedMax <= 0) {
      setStatusBanner({
        type: 'warning',
        text: `कृपया सही अधिकतम अंक (Max Marks) दर्ज करें (जैसे ${DEFAULT_MAX_MARKS_BY_TERM[examTerm]})।`,
      });
      return;
    }
    const effectiveMax = Math.min(500, typedMax);

    setSavingMarks(true);
    setStatusBanner(null);
    try {
      const recordsToSave: ExamMarkRecord[] = [];
      classStudents.forEach((st) => {
        const sid = String(st.Student_ID || '').trim();
        if (!sid) return;
        const entry = marksDraft[sid];
        if (!entry) return;
        const hasVal = entry.obtained.trim() !== '' || entry.absent;
        if (!hasVal) return;

        const parsedObt = parseFloat(entry.obtained);
        const numObt = entry.absent
          ? 0
          : Math.min(effectiveMax, Math.max(0, Number.isFinite(parsedObt) ? parsedObt : 0));
        const safeSubjKey = effectiveSubject.replace(/[^a-z0-9\u0900-\u097f]/gi, '').slice(0, 18);
        recordsToSave.push({
          id: `em_${CURRENT_ACADEMIC_SESSION}_${examTerm}_${sid}_${safeSubjKey}`,
          session: CURRENT_ACADEMIC_SESSION,
          exam_type: examTerm,
          student_id: sid,
          student_name: String(st.Student_Name || sid),
          class_name: String(st.Class || selectedClass || ''),
          subject: effectiveSubject,
          max_marks: effectiveMax,
          marks_obtained: numObt,
          attendance_status: entry.absent ? 'Absent' : 'Present',
          teacher_id: currentUser.id || '',
          teacher_name: currentUser.name || (isManager ? 'Manager' : 'Teacher'),
          remarks: entry.remarks.trim(),
          approval_status: isManager ? 'approved' : 'pending_approval',
          submitted_at: !isManager ? getLocalTimestamp() : undefined,
          updated_at: getLocalTimestamp(),
        });
      });

      if (recordsToSave.length === 0) {
        setStatusBanner({
          type: 'warning',
          text: 'कृपया कम से कम एक छात्र के अंक दर्ज करें या Absent चुनें।',
        });
        setSavingMarks(false);
        return;
      }

      if (!isManager) {
        // TEACHER: Send strictly to Pending Manager Confirmation queue (never directly to Google Sheet!)
        const res = await submitTeacherReportCardDraftToServer({
          marks: recordsToSave,
          submittedBy: currentUser.name || 'Teacher',
          submittedById: currentUser.id,
        });
        onWorkflowUpdated?.(res.snapshot);
        realtimeSync.broadcastUpdate('report_card_workflow', 'teacher_submit');
        try {
          localStorage.removeItem(localDraftStorageKey);
        } catch {}
        dirtyStudentIdsRef.current.clear();
        setHasRestoredLocalDraft(false);
        if (!res.serverOk && !res.sheetSynced) {
          setStatusBanner({
            type: 'error',
            text: `❌ अंक ड्राफ्ट मैनेजर तक नहीं पहुंच पाए: ${res.sheetError || 'सर्वर और Google Sheet सिंक विफल — कृपया इंटरनेट / Apps Script जांचें।'}`,
          });
        } else if (!res.sheetSynced) {
          setStatusBanner({
            type: 'warning',
            text: `⚠️ ${recordsToSave.length} छात्रों के अंक स्थानीय सर्वर पर सेव हुए, पर Google Sheet क्लाउड सिंक नहीं हुआ: ${res.sheetError || 'Apps Script जांचें'}`,
          });
        } else {
          setStatusBanner({
            type: 'success',
            text: `✅ ${EXAM_TERM_LABELS[examTerm]} (${effectiveSubject} • /${effectiveMax}) के ${recordsToSave.length} छात्रों के अंक क्लाउड में मैनेजर कन्फर्मेशन के लिए भेज दिए गए हैं!`,
          });
        }
      } else {
        // MANAGER: Save directly to Sheet
        const res = await saveExamMarksBatchToServer(recordsToSave);
        onExamMarksUpdated(res.records);
        try {
          localStorage.removeItem(localDraftStorageKey);
        } catch {}
        dirtyStudentIdsRef.current.clear();
        setHasRestoredLocalDraft(false);
        setStatusBanner({
          type: res.sheetSynced ? 'success' : 'warning',
          text: res.sheetSynced
            ? `${EXAM_TERM_LABELS[examTerm]} (${effectiveSubject} • /${effectiveMax}) के ${recordsToSave.length} छात्रों के अंक Google Sheet 'Exam_Marks' में सेव हो गए!`
            : `ऐप में ${recordsToSave.length} अंक सेव हो गए! Google Sheet सिंक चेतावनी: ${res.sheetError || 'Apps Script सिंक टाइमआउट/त्रुटि'}`,
        });
      }
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'अंक सेव करने में समस्या आई।' });
    } finally {
      setSavingMarks(false);
    }
  };

  // Manager Confirm / Reject Pending Teacher Submissions
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

  const buildBackupRowsForStudents = (
    targetStudentIds: Set<string>,
    mergedMarks: ExamMarkRecord[],
    mergedMeta: Record<string, ReportCardRemarkRecord>
  ): ReportCardBackupRow[] => {
    const rankMap = computeClassRanksMap({
      students,
      weeklyTests,
      examMarks: mergedMarks,
      behaviorList,
      metaMap: mergedMeta,
      session: CURRENT_ACADEMIC_SESSION,
    });
    const out: ReportCardBackupRow[] = [];
    students.forEach((st) => {
      if (!targetStudentIds.has(String(st.Student_ID).trim().toLowerCase())) return;
      const rc = computeStudentReportCardData({
        student: st,
        weeklyTests,
        examMarks: mergedMarks,
        behaviorList,
        metaMap: mergedMeta,
        session: CURRENT_ACADEMIC_SESSION,
      });
      out.push({
        reportKey: rc.meta.reportKey,
        session: rc.session,
        studentId: st.Student_ID,
        studentName: st.Student_Name,
        className: st.Class,
        rollNumber: String(st.Roll_Number || ''),
        weeklyPct: rc.weeklySummary.pct,
        quarterlyPct: rc.quarterlySummary.pct,
        halfYearlyPct: rc.halfYearlySummary.pct,
        annualPct: rc.annualSummary.pct,
        overallPct: rc.overall.pct,
        grade: rc.overall.grade,
        attendancePct: rc.attendance.attendancePct,
        presentDays: rc.attendance.presentDays,
        totalDays: rc.attendance.totalDays,
        teacherRemark: rc.meta.teacherRemark || rc.autoTeacherRemark,
        principalRemark: rc.meta.principalRemark || rc.autoPrincipalRemark,
        resultStatus: rc.meta.resultStatus || 'PROMOTED',
        publishedToParent: rc.meta.publishedToParent !== false,
        classRank: rankMap[st.Student_ID]?.label || '—',
        updatedBy: currentUser.name || 'Manager',
        updatedAt: getLocalTimestamp(),
      });
    });
    return out;
  };

  const handleConfirmSubset = async (marksToConfirm: ExamMarkRecord[], metasToConfirm: ReportCardRemarkRecord[], actionId: string) => {
    if (!isManager) return;
    if (marksToConfirm.length === 0 && metasToConfirm.length === 0) return;
    setConfirmingKey(actionId);
    setStatusBanner(null);
    try {
      const markMap = new Map<string, ExamMarkRecord>(examMarks.map((m) => [m.id, m]));
      marksToConfirm.forEach((m) => markMap.set(m.id, { ...m, approval_status: 'approved' }));
      const nextMarks = Array.from(markMap.values());

      const nextMeta = { ...reportCardMeta };
      const resolvedMetas: ReportCardRemarkRecord[] = metasToConfirm.map((draft) => {
        const existing = nextMeta[draft.reportKey];
        const merged: ReportCardRemarkRecord = {
          ...existing,
          ...draft,
          principalRemark: existing?.principalRemark || draft.principalRemark || '',
          publishedToParent: existing?.publishedToParent !== false,
          approvalStatus: 'approved',
          updatedBy: currentUser.name || 'Manager',
          updatedAt: getLocalTimestamp(),
        };
        nextMeta[draft.reportKey] = merged;
        return merged;
      });

      const affectedIds = new Set<string>();
      marksToConfirm.forEach((m) => affectedIds.add(String(m.student_id || '').trim().toLowerCase()));
      resolvedMetas.forEach((m) => affectedIds.add(String(m.studentId || '').trim().toLowerCase()));

      const backups = buildBackupRowsForStudents(affectedIds, nextMarks, nextMeta);

      const res = await confirmPendingReportCardsToSheet({
        marks: marksToConfirm,
        metas: resolvedMetas,
        backups,
        confirmedBy: currentUser.name || 'Manager',
        removeMarkIds: marksToConfirm.map((m) => m.id),
        removeReportKeys: resolvedMetas.map((m) => m.reportKey),
      });

      onExamMarksUpdated(res.allMarks);
      onReportCardMetaUpdated(res.metaMap);
      onWorkflowUpdated?.(res.snapshot);

      setStatusBanner({
        type: res.sheetSynced ? 'success' : 'warning',
        text: res.sheetSynced
          ? `✅ कन्फर्म हो गया! ${marksToConfirm.length} अंक व ${resolvedMetas.length} रिमार्क स्थायी रूप से Google Sheet ('Exam_Marks' / 'Report_Cards_Backup') में सेव हो गए!`
          : `✅ ऐप में कन्फर्म हो गया (${marksToConfirm.length} अंक व ${resolvedMetas.length} रिमार्क)! Google Sheet सिंक स्थिति: ${res.sheetError || 'स्थानीय रूप से सेव'}`,
      });
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'कन्फर्म करने में त्रुटि हुई।' });
    } finally {
      setConfirmingKey(null);
    }
  };

  const handleRejectSubset = async (opts: { markIds?: string[]; reportKeys?: string[]; clearAll?: boolean }, actionId: string) => {
    if (!isManager) return;
    setConfirmingKey(actionId);
    setStatusBanner(null);
    try {
      const snap = await rejectPendingReportCardsOnServer(opts);
      onWorkflowUpdated?.(snap);
      setStatusBanner({
        type: 'warning',
        text: 'चयनित पेंडिंग ड्राफ्ट को अस्वीकार कर हटा दिया गया है। टीचर दोबारा सही अंक भेज सकते हैं।',
      });
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'हटाने में समस्या आई।' });
    } finally {
      setConfirmingKey(null);
    }
  };

  // Class Merit & Backup Computation (Manager Only)
  const meritRows = useMemo(() => {
    if (!isManager) return [];
    const scopeStudents = selectedClass === 'ALL' ? students : classStudents;
    const computed = scopeStudents.map((st) =>
      computeStudentReportCardData({
        student: st,
        weeklyTests,
        examMarks,
        behaviorList,
        metaMap: reportCardMeta,
        session: CURRENT_ACADEMIC_SESSION,
      })
    );
    return computed.sort((a, b) => b.overall.pct - a.overall.pct);
  }, [isManager, selectedClass, students, classStudents, weeklyTests, examMarks, behaviorList, reportCardMeta]);

  const [syncingBackup, setSyncingBackup] = useState(false);

  const handleSyncFullBackup = async () => {
    if (!isManager) return;
    setSyncingBackup(true);
    setStatusBanner(null);
    try {
      const backups: ReportCardBackupRow[] = students.map((st) => {
        const rc = computeStudentReportCardData({
          student: st,
          weeklyTests,
          examMarks,
          behaviorList,
          metaMap: reportCardMeta,
          session: CURRENT_ACADEMIC_SESSION,
        });
        return {
          reportKey: rc.meta.reportKey,
          session: rc.session,
          studentId: st.Student_ID,
          studentName: st.Student_Name,
          className: st.Class,
          rollNumber: String(st.Roll_Number || ''),
          weeklyPct: rc.weeklySummary.pct,
          quarterlyPct: rc.quarterlySummary.pct,
          halfYearlyPct: rc.halfYearlySummary.pct,
          annualPct: rc.annualSummary.pct,
          overallPct: rc.overall.pct,
          grade: rc.overall.grade,
          attendancePct: rc.attendance.attendancePct,
          presentDays: rc.attendance.presentDays,
          totalDays: rc.attendance.totalDays,
          teacherRemark: rc.meta.teacherRemark || rc.autoTeacherRemark,
          principalRemark: rc.meta.principalRemark || '',
          resultStatus: rc.meta.resultStatus || 'PROMOTED',
          publishedToParent: rc.meta.publishedToParent !== false,
          classRank: classRanksMap[st.Student_ID]?.label || '—',
          updatedBy: currentUser.name || 'Manager',
          updatedAt: getLocalTimestamp(),
        };
      });

      const res = await syncAllReportCardsBackupToSheet({ backups, examMarks });
      setStatusBanner({
        type: res.sheetSynced ? 'success' : 'warning',
        text: res.sheetSynced
          ? `✅ सभी ${backups.length} छात्रों के रिपोर्ट कार्ड ('Report_Cards_Backup' + Class_Rank) व ${examMarks.length} परीक्षा अंक ('Exam_Marks') Google Sheet में बैकअप हो गए!`
          : `स्थानीय सर्वर बैकअप पूरा (${backups.length} छात्र)! Google Sheet सिंक चेतावनी: ${res.sheetError || 'Apps Script सिंक टाइमआउट/त्रुटि'}`,
      });
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'Google Sheet बैकअप में त्रुटि आई।' });
    } finally {
      setSyncingBackup(false);
    }
  };

  const handleExportCsv = () => {
    if (!isManager) return;
    const header = [
      'Rank',
      'Class_Rank',
      'Student_ID',
      'Student_Name',
      'Class',
      'Roll_No',
      'Weekly_%',
      'Quarterly_%',
      'HalfYearly_%',
      'Annual_%',
      'Overall_%',
      'Grade',
      'Attendance_%',
      'Result_Status',
      'Teacher_Remark',
    ];
    const lines = [header.join(',')];
    meritRows.forEach((rc, idx) => {
      const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      lines.push(
        [
          idx + 1,
          classRanksMap[rc.student.Student_ID]?.label || '—',
          rc.student.Student_ID,
          rc.student.Student_Name,
          rc.student.Class,
          rc.student.Roll_Number || '',
          rc.weeklySummary.pct,
          rc.quarterlySummary.pct,
          rc.halfYearlySummary.pct,
          rc.annualSummary.pct,
          rc.overall.pct,
          rc.overall.grade,
          rc.attendance.attendancePct,
          rc.meta.resultStatus || 'PROMOTED',
          rc.meta.teacherRemark || rc.autoTeacherRemark,
        ]
          .map(esc)
          .join(',')
      );
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EVS_Report_Cards_${selectedClass || 'All'}_${CURRENT_ACADEMIC_SESSION}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Manager Queue Controls: Teacher-wise Grouping, Who Submitted vs Not Submitted, Filters & Sorting
  const [queueViewMode, setQueueViewMode] = useState<'by_teacher' | 'teacher_status' | 'all_rows'>('by_teacher');
  const [queueSearch, setQueueSearch] = useState<string>('');
  const [queueTeacherFilter, setQueueTeacherFilter] = useState<string>('ALL');
  const [queueClassFilter, setQueueClassFilter] = useState<string>('ALL');
  const [queueTermFilter, setQueueTermFilter] = useState<'ALL' | ExamTermType>('ALL');
  const [queueSubjectFilter, setQueueSubjectFilter] = useState<string>('ALL');
  const [queueSortBy, setQueueSortBy] = useState<QueueSortOption>('newest');
  const [statusTermFilter, setStatusTermFilter] = useState<'ALL' | ExamTermType>('ALL');
  const [statusMatrixFilter, setStatusMatrixFilter] = useState<'all' | 'pending' | 'confirmed' | 'not_submitted'>('all');
  const [collapsedTeacherKeys, setCollapsedTeacherKeys] = useState<Record<string, boolean>>({});

  const studentRollMap = useMemo(() => {
    const m = new Map<string, string>();
    students.forEach((s) => {
      const sid = String(s.Student_ID || '').trim().toLowerCase();
      if (sid) m.set(sid, String(s.Roll_Number || ''));
    });
    return m;
  }, [students]);

  const activeTeachersRoster = useMemo(() => {
    return (users || []).filter((u) => {
      const desig = String(u.Designation || '').toLowerCase();
      if (/driver|van|bus|conductor|guard|peon|parent|student/i.test(desig)) return false;
      return (
        !desig ||
        desig.includes('teacher') ||
        desig.includes('शिक्षक') ||
        desig.includes('faculty') ||
        desig.includes('instructor') ||
        desig.includes('incharge') ||
        desig.includes('head') ||
        desig.includes('principal') ||
        desig.includes('staff')
      );
    });
  }, [users]);

  const resolveTeacherCanonicalKey = useMemo(() => {
    return (teacherId?: string, teacherName?: string): { key: string; displayName: string; user?: SchoolUser } => {
      const tid = String(teacherId || '').trim().toLowerCase();
      const tname = String(teacherName || '').trim().toLowerCase();
      const matched = activeTeachersRoster.find((u) => {
        const uid = String(u.User_ID || '').trim().toLowerCase();
        const uname = String(u.Username || '').trim().toLowerCase();
        const nm = String(u.Name || '').trim().toLowerCase();
        return (tid && (uid === tid || uname === tid)) || (tname && nm === tname);
      });
      if (matched) {
        const k = `u::${String(matched.User_ID || matched.Username || matched.Name).trim().toLowerCase()}`;
        return { key: k, displayName: String(matched.Name || teacherName || 'Teacher'), user: matched };
      }
      const fallbackName = String(teacherName || teacherId || 'अन्य शिक्षक (Teacher)').trim();
      return {
        key: `n::${fallbackName.toLowerCase()}`,
        displayName: fallbackName,
      };
    };
  }, [activeTeachersRoster]);

  const teacherSubmissionDirectory = useMemo(() => {
    if (!isManager) return [];
    type Entry = {
      key: string;
      name: string;
      designation: string;
      assignedClass: string;
      assignedSubjects: string;
      mobile: string;
      pendingMarks: ExamMarkRecord[];
      pendingMetas: ReportCardRemarkRecord[];
      confirmedMarks: ExamMarkRecord[];
      pendingBatchSummary: string[];
      confirmedBatchSummary: string[];
      lastSubmittedAt: string;
      status: 'pending' | 'confirmed' | 'not_submitted';
    };

    const map = new Map<string, Entry>();
    activeTeachersRoster.forEach((u) => {
      const key = `u::${String(u.User_ID || u.Username || u.Name).trim().toLowerCase()}`;
      map.set(key, {
        key,
        name: String(u.Name || u.Username || u.User_ID || 'Teacher'),
        designation: String(u.Designation || 'Teacher'),
        assignedClass: String(u.Assigned_Class || ''),
        assignedSubjects: String(u.Assigned_Subjects || ''),
        mobile: String(u.Mobile_number || ''),
        pendingMarks: [],
        pendingMetas: [],
        confirmedMarks: [],
        pendingBatchSummary: [],
        confirmedBatchSummary: [],
        lastSubmittedAt: '',
        status: 'not_submitted',
      });
    });

    const ensureEntry = (tid?: string, tname?: string): Entry => {
      const resolved = resolveTeacherCanonicalKey(tid, tname);
      const existing = map.get(resolved.key);
      if (existing) return existing;
      const created: Entry = {
        key: resolved.key,
        name: resolved.displayName,
        designation: 'Teacher',
        assignedClass: '',
        assignedSubjects: '',
        mobile: '',
        pendingMarks: [],
        pendingMetas: [],
        confirmedMarks: [],
        pendingBatchSummary: [],
        confirmedBatchSummary: [],
        lastSubmittedAt: '',
        status: 'not_submitted',
      };
      map.set(resolved.key, created);
      return created;
    };

    pendingMarks.forEach((pm) => {
      if (statusTermFilter !== 'ALL' && pm.exam_type !== statusTermFilter) return;
      const e = ensureEntry(pm.teacher_id, pm.teacher_name);
      e.pendingMarks.push(pm);
      const ts = String(pm.submitted_at || pm.updated_at || '');
      if (ts && ts > e.lastSubmittedAt) e.lastSubmittedAt = ts;
    });

    pendingMetaList.forEach((draft) => {
      const e = ensureEntry(undefined, draft.submittedBy);
      e.pendingMetas.push(draft);
      const ts = String(draft.submittedAt || '');
      if (ts && ts > e.lastSubmittedAt) e.lastSubmittedAt = ts;
    });

    examMarks.forEach((em) => {
      if (em.session && em.session !== CURRENT_ACADEMIC_SESSION) return;
      if (statusTermFilter !== 'ALL' && em.exam_type !== statusTermFilter) return;
      if (!em.teacher_name && !em.teacher_id) return;
      const e = ensureEntry(em.teacher_id, em.teacher_name);
      e.confirmedMarks.push(em);
    });

    const summarizeMarks = (list: ExamMarkRecord[]): string[] => {
      const bMap = new Map<string, number>();
      list.forEach((m) => {
        const label = `${m.class_name || '—'} • ${m.exam_type} • ${m.subject || 'Subject'}`;
        bMap.set(label, (bMap.get(label) || 0) + 1);
      });
      return Array.from(bMap.entries()).map(([k, count]) => `${k} (${count})`);
    };

    const result = Array.from(map.values()).map((e) => {
      const pCount = e.pendingMarks.length + e.pendingMetas.length;
      const cCount = e.confirmedMarks.length;
      const status: Entry['status'] = pCount > 0 ? 'pending' : cCount > 0 ? 'confirmed' : 'not_submitted';
      return {
        ...e,
        pendingBatchSummary: summarizeMarks(e.pendingMarks),
        confirmedBatchSummary: summarizeMarks(e.confirmedMarks),
        status,
      };
    });

    // Sort: pending first, then not_submitted, then confirmed; alphabetically inside
    const orderRank = { pending: 0, not_submitted: 1, confirmed: 2 };
    result.sort((a, b) => {
      const rDiff = orderRank[a.status] - orderRank[b.status];
      if (rDiff !== 0) return rDiff;
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [isManager, activeTeachersRoster, pendingMarks, pendingMetaList, examMarks, statusTermFilter, resolveTeacherCanonicalKey]);

  const queueFilterOptions = useMemo(() => {
    const teacherMap = new Map<string, string>();
    const classSet = new Set<string>();
    const subjectSet = new Set<string>();

    pendingMarks.forEach((pm) => {
      const resolved = resolveTeacherCanonicalKey(pm.teacher_id, pm.teacher_name);
      teacherMap.set(resolved.key, resolved.displayName);
      if (pm.class_name) classSet.add(String(pm.class_name).trim());
      if (pm.subject) subjectSet.add(String(pm.subject).trim());
    });

    pendingMetaList.forEach((draft: any) => {
      const resolved = resolveTeacherCanonicalKey(undefined, draft.submittedBy);
      teacherMap.set(resolved.key, resolved.displayName);
      if (draft.className) classSet.add(String(draft.className).trim());
    });

    return {
      teachers: Array.from(teacherMap.entries())
        .map(([key, name]) => ({ key, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      classes: Array.from(classSet).sort((a, b) => getClassSortRank(a) - getClassSortRank(b) || a.localeCompare(b)),
      subjects: Array.from(subjectSet).sort((a, b) => a.localeCompare(b)),
    };
  }, [pendingMarks, pendingMetaList, resolveTeacherCanonicalKey]);

  const filteredAndSortedPendingMarks = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    const filtered = pendingMarks.filter((pm) => {
      if (queueTermFilter !== 'ALL' && pm.exam_type !== queueTermFilter) return false;
      if (queueClassFilter !== 'ALL' && normalizeClassToken(pm.class_name) !== normalizeClassToken(queueClassFilter)) {
        return false;
      }
      if (queueSubjectFilter !== 'ALL' && String(pm.subject || '').trim() !== queueSubjectFilter) return false;
      if (queueTeacherFilter !== 'ALL') {
        const res = resolveTeacherCanonicalKey(pm.teacher_id, pm.teacher_name);
        if (res.key !== queueTeacherFilter) return false;
      }
      if (q) {
        const sid = String(pm.student_id || '').trim().toLowerCase();
        const roll = String(studentRollMap.get(sid) || '').toLowerCase();
        const hay = `${pm.student_name || ''} ${pm.student_id || ''} ${roll} ${pm.class_name || ''} ${pm.subject || ''} ${pm.teacher_name || ''} ${pm.exam_type || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (queueSortBy) {
        case 'teacher_asc':
          return String(a.teacher_name || '').localeCompare(String(b.teacher_name || '')) ||
            getClassSortRank(a.class_name) - getClassSortRank(b.class_name) ||
            String(a.student_name || '').localeCompare(String(b.student_name || ''));
        case 'class_asc':
          return getClassSortRank(a.class_name) - getClassSortRank(b.class_name) ||
            String(a.class_name || '').localeCompare(String(b.class_name || '')) ||
            String(a.student_name || '').localeCompare(String(b.student_name || ''));
        case 'student_asc':
          return String(a.student_name || '').localeCompare(String(b.student_name || ''));
        case 'roll_asc': {
          const rA = parseInt(studentRollMap.get(String(a.student_id || '').trim().toLowerCase()) || '99999', 10) || 99999;
          const rB = parseInt(studentRollMap.get(String(b.student_id || '').trim().toLowerCase()) || '99999', 10) || 99999;
          return rA - rB || String(a.student_name || '').localeCompare(String(b.student_name || ''));
        }
        case 'marks_desc': {
          const pctA = a.attendance_status === 'Absent' ? -1 : (Number(a.marks_obtained) || 0);
          const pctB = b.attendance_status === 'Absent' ? -1 : (Number(b.marks_obtained) || 0);
          return pctB - pctA || String(a.student_name || '').localeCompare(String(b.student_name || ''));
        }
        case 'marks_asc': {
          const pctA = a.attendance_status === 'Absent' ? 99999 : (Number(a.marks_obtained) || 0);
          const pctB = b.attendance_status === 'Absent' ? 99999 : (Number(b.marks_obtained) || 0);
          return pctA - pctB || String(a.student_name || '').localeCompare(String(b.student_name || ''));
        }
        case 'subject_asc':
          return String(a.subject || '').localeCompare(String(b.subject || '')) ||
            getClassSortRank(a.class_name) - getClassSortRank(b.class_name);
        case 'newest':
        default: {
          const tsA = String(a.submitted_at || a.updated_at || '');
          const tsB = String(b.submitted_at || b.updated_at || '');
          return tsB.localeCompare(tsA) || String(a.student_name || '').localeCompare(String(b.student_name || ''));
        }
      }
    });
  }, [
    pendingMarks,
    queueSearch,
    queueTermFilter,
    queueClassFilter,
    queueSubjectFilter,
    queueTeacherFilter,
    queueSortBy,
    studentRollMap,
    resolveTeacherCanonicalKey,
  ]);

  const filteredPendingMetas = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return pendingMetaList.filter((draft: any) => {
      if (queueClassFilter !== 'ALL' && normalizeClassToken(draft.className || '') !== normalizeClassToken(queueClassFilter)) {
        return false;
      }
      if (queueTeacherFilter !== 'ALL') {
        const res = resolveTeacherCanonicalKey(undefined, draft.submittedBy);
        if (res.key !== queueTeacherFilter) return false;
      }
      if (q) {
        const hay = `${draft.studentName || ''} ${draft.studentId || ''} ${draft.className || ''} ${draft.submittedBy || ''} ${draft.teacherRemark || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pendingMetaList, queueSearch, queueClassFilter, queueTeacherFilter, resolveTeacherCanonicalKey]);

  const groupedPendingByTeacher = useMemo(() => {
    type TeacherGroup = {
      key: string;
      teacherName: string;
      assignedClass: string;
      marks: ExamMarkRecord[];
      metas: ReportCardRemarkRecord[];
      batchChips: string[];
      latestAt: string;
    };
    const gMap = new Map<string, TeacherGroup>();

    const ensureGroup = (tid?: string, tname?: string): TeacherGroup => {
      const resolved = resolveTeacherCanonicalKey(tid, tname);
      const existing = gMap.get(resolved.key);
      if (existing) return existing;
      const created: TeacherGroup = {
        key: resolved.key,
        teacherName: resolved.displayName,
        assignedClass: String(resolved.user?.Assigned_Class || ''),
        marks: [],
        metas: [],
        batchChips: [],
        latestAt: '',
      };
      gMap.set(resolved.key, created);
      return created;
    };

    filteredAndSortedPendingMarks.forEach((pm) => {
      const g = ensureGroup(pm.teacher_id, pm.teacher_name);
      g.marks.push(pm);
      const ts = String(pm.submitted_at || pm.updated_at || '');
      if (ts && ts > g.latestAt) g.latestAt = ts;
    });

    filteredPendingMetas.forEach((draft) => {
      const g = ensureGroup(undefined, draft.submittedBy);
      g.metas.push(draft);
      const ts = String(draft.submittedAt || '');
      if (ts && ts > g.latestAt) g.latestAt = ts;
    });

    const groups = Array.from(gMap.values()).map((g) => {
      const chipMap = new Map<string, number>();
      g.marks.forEach((m) => {
        const k = `${m.class_name || '—'} • ${m.exam_type} • ${m.subject || 'Subject'}`;
        chipMap.set(k, (chipMap.get(k) || 0) + 1);
      });
      if (g.metas.length > 0) {
        chipMap.set(`रिमार्क ड्राफ्ट`, g.metas.length);
      }
      return {
        ...g,
        batchChips: Array.from(chipMap.entries()).map(([k, count]) => `${k} (${count})`),
      };
    });

    if (queueSortBy === 'teacher_asc') {
      groups.sort((a, b) => a.teacherName.localeCompare(b.teacherName));
    } else {
      groups.sort((a, b) => b.latestAt.localeCompare(a.latestAt) || a.teacherName.localeCompare(b.teacherName));
    }

    return groups;
  }, [filteredAndSortedPendingMarks, filteredPendingMetas, queueSortBy, resolveTeacherCanonicalKey]);

  const hasActiveQueueFilters =
    queueSearch.trim() !== '' ||
    queueTeacherFilter !== 'ALL' ||
    queueClassFilter !== 'ALL' ||
    queueTermFilter !== 'ALL' ||
    queueSubjectFilter !== 'ALL';

  const resetQueueFilters = () => {
    setQueueSearch('');
    setQueueTeacherFilter('ALL');
    setQueueClassFilter('ALL');
    setQueueTermFilter('ALL');
    setQueueSubjectFilter('ALL');
  };

  // Helper to check if a student+term+subject has a pending mark awaiting approval
  const getPendingStatusForStudent = (studentId: string) => {
    const subjLower = effectiveSubject.trim().toLowerCase();
    const subjKey = normalizeSubjectKey(effectiveSubject);
    return pendingMarks.find(
      (m) =>
        String(m.student_id || '').trim().toLowerCase() === String(studentId || '').trim().toLowerCase() &&
        m.exam_type === examTerm &&
        (String(m.subject || '').trim().toLowerCase() === subjLower ||
          (subjKey && normalizeSubjectKey(m.subject) === subjKey)) &&
        (!m.session || m.session === CURRENT_ACADEMIC_SESSION)
    );
  };

  const getConfirmedStatusForStudent = (studentId: string) => {
    const subjLower = effectiveSubject.trim().toLowerCase();
    const subjKey = normalizeSubjectKey(effectiveSubject);
    return examMarks.find(
      (m) =>
        String(m.student_id || '').trim().toLowerCase() === String(studentId || '').trim().toLowerCase() &&
        m.exam_type === examTerm &&
        (String(m.subject || '').trim().toLowerCase() === subjLower ||
          (subjKey && normalizeSubjectKey(m.subject) === subjKey)) &&
        (!m.session || m.session === CURRENT_ACADEMIC_SESSION)
    );
  };

  return (
    <div className="space-y-4">
      {/* Module Header, Permission Controls & Role-Separated Sub-Tabs */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-900 to-indigo-950 text-amber-300 flex items-center justify-center text-xl shadow-sm shrink-0">
              <i className="fa-solid fa-graduation-cap"></i>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900">
                {isManager
                  ? 'डिजिटल रिपोर्ट कार्ड व परीक्षा नियंत्रण (Manager Control)'
                  : 'परीक्षा अंक प्रविष्टि व PTM व्यू (Teacher Mode)'}
              </h2>
              <p className="text-xs text-slate-600">
                {isManager
                  ? 'टीचर के भेजे अंक कन्फर्म कर Google Sheet में सेव करें, Print/PDF करें और टीचर/पेरेंट व्यू अनुमति नियंत्रित करें'
                  : 'केवल परीक्षा अंक व रिमार्क ड्राफ्ट दर्ज कर मैनेजर कन्फर्मेशन हेतु भेजें • Print / Download / Screenshot बंद है'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-900 outline-none focus:border-blue-800"
            >
              {isManager && <option value="ALL">सभी कक्षाएँ ({students.length} छात्र)</option>}
              {availableClasses.map((cls) => (
                <option key={cls} value={cls}>
                  कक्षा: {cls}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* MANAGER ONLY: Permission Control Panel (Teacher PTM View & Parent View Live Switch) */}
        {isManager && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={updatingAccess}
              onClick={() => handleToggleAccessConfig('allowTeacherPtmView')}
              className={`p-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer disabled:opacity-60 ${
                accessConfig.allowTeacherPtmView
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                    accessConfig.allowTeacherPtmView
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  <i className={`fa-solid ${accessConfig.allowTeacherPtmView ? 'fa-eye' : 'fa-lock'}`}></i>
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-black truncate">
                    टीचर PTM मार्कशीट व्यू अनुमति
                  </div>
                  <div className="text-[10px] text-slate-600 truncate">
                    {accessConfig.allowTeacherPtmView
                      ? 'चालू: टीचर PTM में पेरेंट्स को View-Only दिखा सकते हैं (No Print/Screenshot)'
                      : 'बंद: टीचर मार्कशीट नहीं देख सकते, केवल नंबर दर्ज कर सकते हैं'}
                  </div>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black shrink-0 ${
                  accessConfig.allowTeacherPtmView
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-300 text-slate-800'
                }`}
              >
                {accessConfig.allowTeacherPtmView ? 'ON' : 'LOCKED'}
              </span>
            </button>

            <button
              type="button"
              disabled={updatingAccess}
              onClick={() => handleToggleAccessConfig('allowParentView')}
              className={`p-3 rounded-xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer disabled:opacity-60 ${
                accessConfig.allowParentView
                  ? 'bg-blue-50 border-blue-300 text-blue-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950 hover:bg-amber-100/70'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                    accessConfig.allowParentView
                      ? 'bg-blue-700 text-white'
                      : 'bg-amber-500 text-slate-950'
                  }`}
                >
                  <i className={`fa-solid ${accessConfig.allowParentView ? 'fa-users' : 'fa-user-lock'}`}></i>
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-black truncate">
                    बच्चों / पेरेंट पोर्टल पर रिपोर्ट कार्ड दिखाएँ
                  </div>
                  <div className="text-[10px] text-slate-600 truncate">
                    {accessConfig.allowParentView
                      ? 'LIVE: अभिभावक अपने बच्चों का View-Only रिपोर्ट कार्ड देख सकते हैं'
                      : 'बंद: जब आप चाहें तभी ऑन करें — अभी पेरेंट्स को परिणाम नहीं दिखेगा'}
                  </div>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[10px] font-black shrink-0 ${
                  accessConfig.allowParentView
                    ? 'bg-blue-700 text-white'
                    : 'bg-amber-500 text-slate-950'
                }`}
              >
                {accessConfig.allowParentView ? 'LIVE' : 'HIDDEN'}
              </span>
            </button>
          </div>
        )}

        {/* Sub-tab Switcher (Strict Role Split) */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
          {isManager ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setHasManuallySwitchedTab(true);
                  setActiveSubTab('pending_approvals');
                  handleRefreshWorkflow(true);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubTab === 'pending_approvals'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : totalPendingCount > 0
                    ? 'bg-amber-50 text-amber-950 border border-amber-300 hover:bg-amber-100'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-hourglass-half"></i>
                <span>टीचर कन्फर्मेशन सूची</span>
                {totalPendingCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black">
                    {totalPendingCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setHasManuallySwitchedTab(true);
                  setActiveSubTab('report_card');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubTab === 'report_card'
                    ? 'bg-blue-950 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-file-pdf"></i>
                <span>मार्कशीट देखें व प्रिंट करें</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setHasManuallySwitchedTab(true);
                  setActiveSubTab('enter_marks');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubTab === 'enter_marks'
                    ? 'bg-indigo-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-pen-to-square"></i>
                <span>तिमाही / छमाही / सालाना अंक दर्ज</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setHasManuallySwitchedTab(true);
                  setActiveSubTab('merit_backup');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubTab === 'merit_backup'
                    ? 'bg-emerald-800 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-cloud-arrow-up"></i>
                <span>मेरिट सूची व Google Sheet बैकअप</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setHasManuallySwitchedTab(true);
                  setActiveSubTab('enter_marks');
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubTab === 'enter_marks'
                    ? 'bg-indigo-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <i className="fa-solid fa-pen-to-square"></i>
                <span>परीक्षा अंक जोड़ें व कन्फर्मेशन हेतु भेजें</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setHasManuallySwitchedTab(true);
                  setActiveSubTab('ptm_view');
                  handleRefreshWorkflow(true);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeSubTab === 'ptm_view'
                    ? 'bg-blue-950 text-white shadow-xs'
                    : accessConfig.allowTeacherPtmView
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-300 hover:bg-emerald-100'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <i className={`fa-solid ${accessConfig.allowTeacherPtmView ? 'fa-eye' : 'fa-lock'}`}></i>
                <span>
                  PTM मार्कशीट व्यू ({accessConfig.allowTeacherPtmView ? 'अनुमति प्राप्त — View Only' : 'लॉक है'})
                </span>
              </button>
            </>
          )}
        </div>

        {statusBanner && (
          <div
            className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between gap-2 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                : statusBanner.type === 'warning'
                ? 'bg-amber-50 text-amber-950 border border-amber-300'
                : 'bg-rose-50 text-rose-900 border border-rose-300'
            }`}
          >
            <span>{statusBanner.text}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        )}
      </div>

      {/* MANAGER TAB: Pending Teacher Approvals Queue (Teacher-Wise, Who Submitted vs Not Submitted, Filters & Sort) */}
      {isManager && activeSubTab === 'pending_approvals' && (() => {
        const pendingTeachersCount = teacherSubmissionDirectory.filter((t) => t.status === 'pending').length;
        const confirmedOnlyCount = teacherSubmissionDirectory.filter((t) => t.status === 'confirmed').length;
        const notSubmittedCount = teacherSubmissionDirectory.filter((t) => t.status === 'not_submitted').length;
        const filteredTotalCount = filteredAndSortedPendingMarks.length + filteredPendingMetas.length;

        const filteredStatusRows = teacherSubmissionDirectory.filter((t) => {
          if (statusMatrixFilter !== 'all' && t.status !== statusMatrixFilter) return false;
          const q = queueSearch.trim().toLowerCase();
          if (q) {
            const hay = `${t.name} ${t.assignedClass} ${t.assignedSubjects} ${t.pendingBatchSummary.join(' ')} ${t.confirmedBatchSummary.join(' ')}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const renderMarksTable = (rows: ExamMarkRecord[], showTeacherCol: boolean) => (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[680px]">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="py-2.5 px-3">छात्र (कक्षा / रोल)</th>
                  <th className="py-2.5 px-3">परीक्षा / विषय</th>
                  <th className="py-2.5 px-3 text-center">टीचर के अंक</th>
                  <th className="py-2.5 px-3 text-center">पुराने Sheet अंक</th>
                  {showTeacherCol && <th className="py-2.5 px-3">टीचर / समय</th>}
                  <th className="py-2.5 px-3 text-right">कार्रवाई</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {rows.map((pm) => {
                  const existing = examMarks.find((em) => em.id === pm.id);
                  const rollNo = studentRollMap.get(String(pm.student_id || '').trim().toLowerCase());
                  return (
                    <tr key={pm.id} className="hover:bg-amber-50/40">
                      <td className="py-2 px-3">
                        <div className="font-black text-slate-900">{pm.student_name}</div>
                        <div className="text-[10px] text-slate-500">
                          {pm.class_name} {rollNo ? `• Roll #${rollNo}` : ''} • {pm.student_id}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-bold text-indigo-900">{pm.exam_type}</div>
                        <div className="text-[11px] text-slate-700">{pm.subject}</div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {pm.attendance_status === 'Absent' ? (
                          <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 font-black text-[11px]">
                            Absent
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-950 font-black text-xs">
                            {pm.marks_obtained} / {pm.max_marks}
                          </span>
                        )}
                        {pm.remarks && <div className="text-[10px] text-slate-500 mt-0.5">{pm.remarks}</div>}
                      </td>
                      <td className="py-2 px-3 text-center text-slate-500 font-semibold">
                        {existing
                          ? existing.attendance_status === 'Absent'
                            ? 'Absent'
                            : `${existing.marks_obtained} / ${existing.max_marks}`
                          : 'नया रिकॉर्ड'}
                      </td>
                      {showTeacherCol && (
                        <td className="py-2 px-3 text-[11px] text-slate-600">
                          <div className="font-bold text-slate-800">{pm.teacher_name || 'Teacher'}</div>
                          <div>{pm.submitted_at || pm.updated_at}</div>
                        </td>
                      )}
                      <td className="py-2 px-3 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={confirmingKey !== null}
                          onClick={() => handleConfirmSubset([pm], [], `confirm_${pm.id}`)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-black cursor-pointer disabled:opacity-50"
                        >
                          ✓ कन्फर्म
                        </button>
                        <button
                          type="button"
                          disabled={confirmingKey !== null}
                          onClick={() => handleRejectSubset({ markIds: [pm.id] }, `reject_${pm.id}`)}
                          className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold cursor-pointer disabled:opacity-50"
                        >
                          ✕ हटाएँ
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );

        return (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
            {/* Top Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
              <div>
                <h3 className="text-xs sm:text-sm font-black text-amber-950">
                  ⏳ टीचर-वार अंक कन्फर्मेशन व सबमिशन ट्रैकर (Manager Confirmation Hub)
                </h3>
                <p className="text-[11px] text-amber-900 mt-0.5">
                  अलग-अलग टीचर के अनुसार देखें, फ़िल्टर/शॉर्ट करें और जानें किस टीचर के अंक आ गए व किसके अभी बाकी हैं।
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={refreshingWorkflow}
                  onClick={() => handleRefreshWorkflow(false)}
                  className="px-3 py-2 rounded-xl bg-white hover:bg-slate-50 border border-amber-300 text-amber-950 text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  <i className={`fa-solid ${refreshingWorkflow ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                  <span>{refreshingWorkflow ? 'जाँच हो रही है...' : 'ताज़ा ड्राफ्ट लाएँ'}</span>
                </button>
                {totalPendingCount > 0 && (
                  <>
                    <button
                      type="button"
                      disabled={confirmingKey !== null}
                      onClick={() => handleRejectSubset({ clearAll: true }, 'reject_all')}
                      className="px-3 py-2 rounded-xl bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <i className="fa-solid fa-trash-can mr-1"></i>
                      सभी अस्वीकार करें
                    </button>
                    <button
                      type="button"
                      disabled={confirmingKey !== null}
                      onClick={() => handleConfirmSubset(pendingMarks, pendingMetaList, 'confirm_all')}
                      className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                    >
                      <i className={`fa-solid ${confirmingKey === 'confirm_all' ? 'fa-spinner fa-spin' : 'fa-check-double'}`}></i>
                      <span>
                        {confirmingKey === 'confirm_all'
                          ? 'Sheet में सेव हो रहा है...'
                          : `सभी कन्फर्म करें (${totalPendingCount})`}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 4 Interactive KPI Summary Cards: Who Submitted vs Who Did Not */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setQueueViewMode('teacher_status');
                  setStatusMatrixFilter('all');
                }}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left cursor-pointer transition-all"
              >
                <div className="text-[11px] font-bold text-slate-600">कुल शिक्षक (Total Staff)</div>
                <div className="text-lg font-black text-slate-900 mt-0.5">{teacherSubmissionDirectory.length}</div>
                <div className="text-[10px] text-slate-500">सबमिशन स्टेटस देखें →</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setQueueViewMode('by_teacher');
                  setStatusMatrixFilter('pending');
                }}
                className="p-3 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100/70 text-left cursor-pointer transition-all"
              >
                <div className="text-[11px] font-bold text-amber-900">⏳ कन्फर्मेशन बाकी (आए हुए)</div>
                <div className="text-lg font-black text-amber-950 mt-0.5">
                  {pendingTeachersCount} टीचर <span className="text-xs font-bold">({totalPendingCount} प्रविष्टियाँ)</span>
                </div>
                <div className="text-[10px] text-amber-800">टीचर-वार कार्ड खोलें →</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setQueueViewMode('teacher_status');
                  setStatusMatrixFilter('not_submitted');
                }}
                className="p-3 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100/70 text-left cursor-pointer transition-all"
              >
                <div className="text-[11px] font-bold text-rose-800">❌ जिनके अभी नहीं आए</div>
                <div className="text-lg font-black text-rose-950 mt-0.5">{notSubmittedCount} टीचर</div>
                <div className="text-[10px] text-rose-700">किसने नहीं भेजे देखें →</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setQueueViewMode('teacher_status');
                  setStatusMatrixFilter('confirmed');
                }}
                className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100/70 text-left cursor-pointer transition-all"
              >
                <div className="text-[11px] font-bold text-emerald-800">✅ पहले से कन्फर्म हो चुके</div>
                <div className="text-lg font-black text-emerald-950 mt-0.5">{confirmedOnlyCount} टीचर</div>
                <div className="text-[10px] text-emerald-700">कन्फर्म सूची देखें →</div>
              </button>
            </div>

            {/* Sub-View Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setQueueViewMode('by_teacher')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer flex items-center gap-1.5 ${
                    queueViewMode === 'by_teacher'
                      ? 'bg-indigo-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <i className="fa-solid fa-chalkboard-user"></i>
                  <span>टीचर के अनुसार ग्रुप ({groupedPendingByTeacher.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQueueViewMode('teacher_status')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer flex items-center gap-1.5 ${
                    queueViewMode === 'teacher_status'
                      ? 'bg-blue-950 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <i className="fa-solid fa-clipboard-check"></i>
                  <span>किसके आए / किसके नहीं आए ({teacherSubmissionDirectory.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setQueueViewMode('all_rows')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer flex items-center gap-1.5 ${
                    queueViewMode === 'all_rows'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <i className="fa-solid fa-table-list"></i>
                  <span>सभी की सूची ({filteredTotalCount})</span>
                </button>
              </div>
            </div>

            {/* Filter & Sort Toolbar (शॉर्ट फ़ंक्शन) */}
            {queueViewMode !== 'teacher_status' ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] font-black text-slate-600 mb-1">खोजें (Search):</label>
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="छात्र, रोल नं, टीचर, कक्षा या विषय..."
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold outline-none focus:border-indigo-700"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">टीचर चुनें:</label>
                    <select
                      value={queueTeacherFilter}
                      onChange={(e) => setQueueTeacherFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold outline-none focus:border-indigo-700"
                    >
                      <option value="ALL">सभी टीचर</option>
                      {queueFilterOptions.teachers.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">कक्षा चुनें:</label>
                    <select
                      value={queueClassFilter}
                      onChange={(e) => setQueueClassFilter(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold outline-none focus:border-indigo-700"
                    >
                      <option value="ALL">सभी कक्षाएँ</option>
                      {queueFilterOptions.classes.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-slate-600 mb-1">परीक्षा / विषय:</label>
                    <div className="grid grid-cols-2 gap-1">
                      <select
                        value={queueTermFilter}
                        onChange={(e) => setQueueTermFilter(e.target.value as any)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold outline-none focus:border-indigo-700"
                      >
                        <option value="ALL">सब परीक्षा</option>
                        <option value="Quarterly">Quarterly</option>
                        <option value="Half-Yearly">Half-Yearly</option>
                        <option value="Annual">Annual</option>
                      </select>
                      <select
                        value={queueSubjectFilter}
                        onChange={(e) => setQueueSubjectFilter(e.target.value)}
                        className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] font-bold outline-none focus:border-indigo-700"
                      >
                        <option value="ALL">सब विषय</option>
                        {queueFilterOptions.subjects.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-indigo-900 mb-1">
                      <i className="fa-solid fa-arrow-up-wide-short mr-1"></i>
                      शॉर्ट / क्रम (Sort By):
                    </label>
                    <select
                      value={queueSortBy}
                      onChange={(e) => setQueueSortBy(e.target.value as QueueSortOption)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50/70 text-xs font-black text-indigo-950 outline-none focus:border-indigo-700"
                    >
                      <option value="newest">नवीनतम पहले (Newest First)</option>
                      <option value="teacher_asc">टीचर नाम (A → Z)</option>
                      <option value="class_asc">कक्षा क्रम (Play → 8th)</option>
                      <option value="student_asc">छात्र नाम (A → Z)</option>
                      <option value="roll_asc">रोल नंबर (1 → N)</option>
                      <option value="marks_desc">अंक: ज़्यादा → कम</option>
                      <option value="marks_asc">अंक: कम → ज़्यादा</option>
                      <option value="subject_asc">विषय के अनुसार (A → Z)</option>
                    </select>
                  </div>
                </div>

                {hasActiveQueueFilters && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200">
                    <div className="text-[11px] font-bold text-slate-700">
                      फ़िल्टर परिणाम: <span className="text-indigo-900 font-black">{filteredTotalCount}</span> प्रविष्टियाँ ({groupedPendingByTeacher.length} टीचर)
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={resetQueueFilters}
                        className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 text-slate-700 text-[11px] font-bold cursor-pointer hover:bg-slate-100"
                      >
                        ✕ फ़िल्टर हटाएँ
                      </button>
                      {filteredTotalCount > 0 && (
                        <>
                          <button
                            type="button"
                            disabled={confirmingKey !== null}
                            onClick={() =>
                              handleRejectSubset(
                                {
                                  markIds: filteredAndSortedPendingMarks.map((m) => m.id),
                                  reportKeys: filteredPendingMetas.map((d) => d.reportKey),
                                },
                                'reject_filtered'
                              )
                            }
                            className="px-2.5 py-1 rounded-lg bg-rose-50 border border-rose-300 text-rose-700 text-[11px] font-bold cursor-pointer"
                          >
                            फ़िल्टर किए अस्वीकार करें ({filteredTotalCount})
                          </button>
                          <button
                            type="button"
                            disabled={confirmingKey !== null}
                            onClick={() =>
                              handleConfirmSubset(filteredAndSortedPendingMarks, filteredPendingMetas, 'confirm_filtered')
                            }
                            className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black cursor-pointer"
                          >
                            ✓ फ़िल्टर किए कन्फर्म करें ({filteredTotalCount})
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* VIEW 1: Teacher-Wise Grouped Cards (Default) */}
            {queueViewMode === 'by_teacher' && (
              groupedPendingByTeacher.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">
                    <i className="fa-solid fa-circle-check"></i>
                  </div>
                  <div className="text-sm font-black text-slate-800">
                    {hasActiveQueueFilters ? 'चयनित फ़िल्टर में कोई पेंडिंग ड्राफ्ट नहीं मिला' : 'कोई पेंडिंग कन्फर्मेशन बाकी नहीं है'}
                  </div>
                  <p className="text-xs text-slate-500">
                    {hasActiveQueueFilters
                      ? 'कृपया फ़िल्टर बदलें या ऊपर "किसके आए / किसके नहीं आए" टैब से सभी टीचर की स्थिति देखें।'
                      : 'जब कोई टीचर परीक्षा अंक या रिमार्क ड्राफ्ट सबमिट करेगा, तो वह टीचर-वार कार्ड के रूप में यहाँ दिखाई देगा।'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {groupedPendingByTeacher.map((group) => {
                    const isCollapsed = Boolean(collapsedTeacherKeys[group.key]);
                    const groupTotal = group.marks.length + group.metas.length;
                    return (
                      <div key={group.key} className="border border-amber-300 rounded-2xl overflow-hidden shadow-2xs bg-amber-50/20">
                        <div className="p-3.5 bg-gradient-to-r from-amber-50 to-white border-b border-amber-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-xl bg-indigo-900 text-amber-300 font-black text-sm flex items-center justify-center shrink-0">
                              {group.teacherName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-black text-slate-900">{group.teacherName}</span>
                                <span className="px-2 py-0.5 rounded-full bg-amber-200 text-amber-950 text-[10px] font-black">
                                  {groupTotal} पेंडिंग
                                </span>
                                {group.assignedClass && (
                                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-bold">
                                    कक्षा: {group.assignedClass}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {group.batchChips.map((chip) => (
                                  <span
                                    key={chip}
                                    className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-700"
                                  >
                                    {chip}
                                  </span>
                                ))}
                                {group.latestAt && (
                                  <span className="text-[10px] text-slate-500 self-center">
                                    • अंतिम भेजा: {group.latestAt}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsedTeacherKeys((prev) => ({ ...prev, [group.key]: !prev[group.key] }))
                              }
                              className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-[11px] font-bold cursor-pointer"
                            >
                              {isCollapsed ? '▼ सूची खोलें' : '▲ छुपाएँ'}
                            </button>
                            <button
                              type="button"
                              disabled={confirmingKey !== null}
                              onClick={() =>
                                handleRejectSubset(
                                  {
                                    markIds: group.marks.map((m) => m.id),
                                    reportKeys: group.metas.map((d) => d.reportKey),
                                  },
                                  `reject_teacher_${group.key}`
                                )
                              }
                              className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-[11px] font-bold cursor-pointer disabled:opacity-50"
                            >
                              ✕ अस्वीकार
                            </button>
                            <button
                              type="button"
                              disabled={confirmingKey !== null}
                              onClick={() =>
                                handleConfirmSubset(group.marks, group.metas, `confirm_teacher_${group.key}`)
                              }
                              className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer shadow-xs disabled:opacity-50"
                            >
                              <i
                                className={`fa-solid ${
                                  confirmingKey === `confirm_teacher_${group.key}` ? 'fa-spinner fa-spin' : 'fa-check-double'
                                }`}
                              ></i>
                              <span>इस टीचर के कन्फर्म करें ({groupTotal})</span>
                            </button>
                          </div>
                        </div>

                        {!isCollapsed && (
                          <div className="p-3 space-y-3">
                            {group.marks.length > 0 && renderMarksTable(group.marks, false)}
                            {group.metas.length > 0 && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                {group.metas.map((draft: any) => (
                                  <div key={draft.reportKey} className="p-3 rounded-xl border border-amber-200 bg-white space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <div className="font-black text-xs text-slate-900">
                                          {draft.studentName || draft.studentId}{' '}
                                          <span className="text-blue-900">({draft.className || '—'})</span>
                                        </div>
                                        <div className="text-[10px] text-slate-500">रिमार्क ड्राफ्ट • {draft.submittedAt}</div>
                                      </div>
                                      <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 text-[10px] font-black">
                                        {draft.resultStatus || 'PROMOTED'}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-800 bg-slate-50 p-2 rounded-lg border border-slate-200">
                                      {draft.teacherRemark}
                                    </p>
                                    <div className="flex justify-end gap-2">
                                      <button
                                        type="button"
                                        disabled={confirmingKey !== null}
                                        onClick={() =>
                                          handleRejectSubset({ reportKeys: [draft.reportKey] }, `reject_meta_${draft.reportKey}`)
                                        }
                                        className="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold cursor-pointer"
                                      >
                                        ✕ अस्वीकार
                                      </button>
                                      <button
                                        type="button"
                                        disabled={confirmingKey !== null}
                                        onClick={() =>
                                          handleConfirmSubset([], [draft], `confirm_meta_${draft.reportKey}`)
                                        }
                                        className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-black cursor-pointer"
                                      >
                                        ✓ कन्फर्म
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* VIEW 2: Teacher Submission Status Matrix ("किसके आए / किसके नहीं आए") */}
            {queueViewMode === 'teacher_status' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-black text-slate-700 mr-1">परीक्षा:</span>
                    {(['ALL', 'Quarterly', 'Half-Yearly', 'Annual'] as const).map((term) => (
                      <button
                        key={term}
                        type="button"
                        onClick={() => setStatusTermFilter(term)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          statusTermFilter === term
                            ? 'bg-indigo-900 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {term === 'ALL' ? 'सभी परीक्षाएँ' : term === 'Quarterly' ? 'तिमाही (Quarterly)' : term === 'Half-Yearly' ? 'छमाही (Half-Yearly)' : 'सालाना (Annual)'}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { id: 'all', label: `सब (${teacherSubmissionDirectory.length})` },
                      { id: 'pending', label: `⏳ आए हुए / बाकी (${pendingTeachersCount})` },
                      { id: 'not_submitted', label: `❌ नहीं आए (${notSubmittedCount})` },
                      { id: 'confirmed', label: `✅ कन्फर्म हो चुके (${confirmedOnlyCount})` },
                    ].map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => setStatusMatrixFilter(st.id as any)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          statusMatrixFilter === st.id
                            ? 'bg-blue-950 text-white'
                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    value={queueSearch}
                    onChange={(e) => setQueueSearch(e.target.value)}
                    placeholder="टीचर का नाम, कक्षा या विषय खोजें..."
                    className="w-full sm:w-80 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold outline-none focus:border-indigo-700"
                  />
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs min-w-[720px]">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        <th className="py-2.5 px-3">शिक्षक (Teacher)</th>
                        <th className="py-2.5 px-3">असाइन कक्षा / विषय</th>
                        <th className="py-2.5 px-3">स्थिति (Status)</th>
                        <th className="py-2.5 px-3">कन्फर्मेशन बाकी (आए हुए)</th>
                        <th className="py-2.5 px-3">Sheet में कन्फर्म हो चुके</th>
                        <th className="py-2.5 px-3 text-right">कार्रवाई</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {filteredStatusRows.map((row) => {
                        const pTotal = row.pendingMarks.length + row.pendingMetas.length;
                        const cleanPhone = String(row.mobile || '').replace(/\D/g, '').slice(-10);
                        const waText = encodeURIComponent(
                          `नमस्ते ${row.name} जी, कृपया E.V.S. Public School ऐप के Teacher Portal से ${statusTermFilter === 'ALL' ? 'परीक्षा' : statusTermFilter} के अंक जल्द ही भरकर भेज दें।`
                        );
                        return (
                          <tr key={row.key} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3">
                              <div className="font-black text-slate-900">{row.name}</div>
                              <div className="text-[10px] text-slate-500">
                                {row.designation} {row.mobile ? `• ${row.mobile}` : ''}
                              </div>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-blue-900">{row.assignedClass || '—'}</div>
                              {row.assignedSubjects && (
                                <div className="text-[10px] text-slate-500">{row.assignedSubjects}</div>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {row.status === 'pending' ? (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-950 border border-amber-300 text-[10px] font-black">
                                  ⏳ आ गए ({pTotal} कन्फर्म बाकी)
                                </span>
                              ) : row.status === 'confirmed' ? (
                                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black">
                                  ✅ कन्फर्म हो चुके
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-black">
                                  ❌ अभी नहीं आए
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {pTotal > 0 ? (
                                <div className="space-y-0.5">
                                  <div className="font-black text-amber-900">{pTotal} प्रविष्टियाँ</div>
                                  <div className="text-[10px] text-slate-600">
                                    {row.pendingBatchSummary.join(' | ') || `${row.pendingMetas.length} रिमार्क`}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {row.confirmedMarks.length > 0 ? (
                                <div className="space-y-0.5">
                                  <div className="font-black text-emerald-800">{row.confirmedMarks.length} अंक</div>
                                  <div className="text-[10px] text-slate-600">
                                    {row.confirmedBatchSummary.slice(0, 3).join(' | ')}
                                    {row.confirmedBatchSummary.length > 3 ? ` +${row.confirmedBatchSummary.length - 3}` : ''}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-slate-400">0</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {pTotal > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQueueTeacherFilter(row.key);
                                    if (statusTermFilter !== 'ALL') setQueueTermFilter(statusTermFilter);
                                    setQueueViewMode('by_teacher');
                                  }}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-900 hover:bg-indigo-800 text-white text-[10px] font-black cursor-pointer"
                                >
                                  देखें व कन्फर्म करें →
                                </button>
                              ) : cleanPhone.length === 10 ? (
                                <a
                                  href={`https://wa.me/91${cleanPhone}?text=${waText}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold"
                                >
                                  <i className="fa-brands fa-whatsapp"></i>
                                  <span>रिमाइंडर</span>
                                </a>
                              ) : (
                                <span className="text-[10px] text-slate-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* VIEW 3: Flat Detailed List (All Rows Sorted) */}
            {queueViewMode === 'all_rows' && (
              filteredTotalCount === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">
                    <i className="fa-solid fa-circle-check"></i>
                  </div>
                  <div className="text-sm font-black text-slate-800">कोई पेंडिंग प्रविष्टि नहीं मिली</div>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredAndSortedPendingMarks.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-slate-800">
                        📝 पेंडिंग परीक्षा अंक ({filteredAndSortedPendingMarks.length} प्रविष्टियाँ):
                      </h4>
                      {renderMarksTable(filteredAndSortedPendingMarks, true)}
                    </div>
                  )}

                  {filteredPendingMetas.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-slate-800">
                        💬 पेंडिंग टीचर रिमार्क व परिणाम ड्राफ्ट ({filteredPendingMetas.length}):
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredPendingMetas.map((draft: any) => (
                          <div key={draft.reportKey} className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-black text-xs text-slate-900">
                                  {draft.studentName || draft.studentId}{' '}
                                  <span className="text-blue-900">({draft.className || '—'})</span>
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  प्रेषक: {draft.submittedBy || 'Teacher'} • {draft.submittedAt}
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 text-[10px] font-black">
                                {draft.resultStatus || 'PROMOTED'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200">
                              {draft.teacherRemark}
                            </p>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                disabled={confirmingKey !== null}
                                onClick={() =>
                                  handleRejectSubset({ reportKeys: [draft.reportKey] }, `reject_meta_${draft.reportKey}`)
                                }
                                className="px-2.5 py-1 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold cursor-pointer"
                              >
                                ✕ अस्वीकार
                              </button>
                              <button
                                type="button"
                                disabled={confirmingKey !== null}
                                onClick={() =>
                                  handleConfirmSubset([], [draft], `confirm_meta_${draft.reportKey}`)
                                }
                                className="px-3 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-black cursor-pointer"
                              >
                                ✓ कन्फर्म व Sheet सेव
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        );
      })()}

      {/* MANAGER TAB: Report Card Preview, Remark Editor & 1-Click PDF Print */}
      {isManager && activeSubTab === 'report_card' && (
        <div className="space-y-4">
          <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-black text-slate-700 mb-1">छात्र चुनें (Select Student):</label>
                <select
                  value={selectedStudent?.Student_ID || ''}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-blue-800 outline-none"
                >
                  {classStudents.map((st) => (
                    <option key={st.Student_ID} value={st.Student_ID}>
                      {st.Student_Name} ({st.Class} • #{st.Roll_Number || st.Student_ID})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-700 mb-1">परिणाम स्थिति (Result Status):</label>
                <select
                  value={resultStatusDraft}
                  onChange={(e) => setResultStatusDraft(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-blue-800 outline-none"
                >
                  <option value="PROMOTED">PROMOTED (अगली कक्षा में प्रोन्नत)</option>
                  <option value="PASSED">PASSED (उत्तीर्ण)</option>
                  <option value="NEEDS IMPROVEMENT">NEEDS IMPROVEMENT (सुधार आवश्यक)</option>
                  <option value="DETAINED">DETAINED (रोका गया)</option>
                </select>
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 w-full cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishedDraft}
                    onChange={(e) => setPublishedDraft(e.target.checked)}
                    className="w-4 h-4 accent-blue-900"
                  />
                  <span className="text-xs font-bold text-slate-800">
                    इस छात्र के लिए पेरेंट व्यू सक्रिय रखें
                  </span>
                </label>
              </div>
            </div>

            {!accessConfig.allowParentView && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900 flex items-center gap-2">
                <i className="fa-solid fa-eye-slash"></i>
                <span>
                  सूचना: ग्लोबल "बच्चों / पेरेंट पोर्टल पर रिपोर्ट कार्ड दिखाएँ" स्विच अभी HIDDEN है, इसलिए अभी कोई भी अभिभावक रिपोर्ट कार्ड नहीं देख सकेगा।
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-black text-slate-700">टीचर रिमार्क (Teacher Remark):</label>
                  {selectedReportData && (
                    <button
                      type="button"
                      onClick={() => setTeacherRemarkDraft(selectedReportData.autoTeacherRemark)}
                      className="text-[10px] font-bold text-blue-700 hover:underline cursor-pointer"
                    >
                      ✨ Smart English Auto-Fill
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={teacherRemarkDraft}
                  onChange={(e) => setTeacherRemarkDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:border-blue-800 outline-none"
                  placeholder="Write personalized English remark about student's academic progress..."
                />
                {selectedReportData && (() => {
                  const sFirstName = String(selectedReportData.student.Student_Name || 'Student').trim().split(/\s+/)[0] || 'Student';
                  return (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[
                        {
                          label: 'Merit / Top',
                          text: `${sFirstName} is an exceptionally bright, disciplined, and conscientious learner who excels consistently across subjects.`,
                        },
                        {
                          label: 'Steady Growth',
                          text: `${sFirstName} shows steady progress and active curiosity in class. Daily written practice will elevate scores even further.`,
                        },
                        {
                          label: 'Focus & Attendance',
                          text: `${sFirstName} has good learning potential. Regular school attendance and daily home revision are strongly encouraged.`,
                        },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setTeacherRemarkDraft(preset.text)}
                          className="px-2 py-0.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-[10px] font-bold cursor-pointer"
                        >
                          + {preset.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-black text-slate-700">
                    प्रधानाचार्य / प्रबंधक रिमार्क (Principal Remark):
                  </label>
                  {selectedReportData && (
                    <button
                      type="button"
                      onClick={() => setPrincipalRemarkDraft(selectedReportData.autoPrincipalRemark)}
                      className="text-[10px] font-bold text-indigo-700 hover:underline cursor-pointer"
                    >
                      ✨ Smart English Auto-Fill
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={principalRemarkDraft}
                  onChange={(e) => setPrincipalRemarkDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:border-blue-800 outline-none"
                  placeholder="Write Principal's encouraging English remark..."
                />
                {selectedReportData && (() => {
                  const sFirstName = String(selectedReportData.student.Student_Name || 'Student').trim().split(/\s+/)[0] || 'Student';
                  return (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[
                        {
                          label: 'Honour Roll',
                          text: `Heartiest congratulations! Proud of ${sFirstName}'s outstanding dedication and conduct.`,
                        },
                        {
                          label: 'Good Potential',
                          text: `Keep striving for excellence! Consistent effort and discipline will bring even brighter achievements ahead.`,
                        },
                        {
                          label: 'Parent Support',
                          text: `With regular attendance and guided practice at home, ${sFirstName} can achieve distinction in upcoming terms.`,
                        },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setPrincipalRemarkDraft(preset.text)}
                          className="px-2 py-0.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-200 text-[10px] font-bold cursor-pointer"
                        >
                          + {preset.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveRemarksManager}
                disabled={savingRemark || !selectedReportData}
                className="px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <i className={`fa-solid ${savingRemark ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                <span>{savingRemark ? 'सेव हो रहा है...' : 'रिमार्क व सेटिंग सेव करें'}</span>
              </button>
            </div>
          </div>

          {selectedReportData ? (
            <PrintableReportCard
              data={selectedReportData}
              mode="staff_printable"
              classRankInfo={selectedStudent ? classRanksMap[selectedStudent.Student_ID] : undefined}
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-xs font-bold">
              कृपया रिपोर्ट कार्ड देखने के लिए ऊपर से कक्षा व छात्र चुनें।
            </div>
          )}
        </div>
      )}

      {/* TEACHER TAB: Strict PTM View-Only (Locked unless Manager explicitly enables) */}
      {!isManager && activeSubTab === 'ptm_view' && (
        <div className="space-y-4">
          {!accessConfig.allowTeacherPtmView ? (
            <div className="bg-white border-2 border-slate-200 rounded-2xl p-8 text-center space-y-3 shadow-xs">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center text-2xl">
                <i className="fa-solid fa-lock"></i>
              </div>
              <h3 className="text-base font-black text-slate-900">
                बिना मैनेजर की अनुमति के मार्कशीट देखना बंद है
              </h3>
              <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                वर्तमान में टीचर को केवल परीक्षा के नंबर जोड़ने व कन्फर्मेशन हेतु भेजने का अधिकार है।
                PTM में पेरेंट्स को मार्कशीट दिखाने के लिए कृपया स्कूल मैनेजर से <strong>"टीचर PTM मार्कशीट व्यू अनुमति"</strong> चालू करवाएँ।
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshWorkflow}
                  disabled={refreshingWorkflow}
                  className="px-4 py-2 rounded-xl bg-blue-950 hover:bg-blue-900 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <i className={`fa-solid ${refreshingWorkflow ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                  <span>{refreshingWorkflow ? 'जाँच हो रही है...' : 'अनुमति स्थिति रीफ्रेश करें'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubTab('enter_marks')}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer"
                >
                  ← वापस अंक दर्ज करने जाएं
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="no-print bg-white border border-emerald-200 rounded-2xl p-4 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs font-black text-emerald-950">
                    <i className="fa-solid fa-shield-halved text-emerald-700"></i>
                    <span>
                      PTM View-Only मोड सक्रिय — अभिभावकों को दिखाने हेतु केवल स्क्रीन व्यू (Print / PDF / Download / Screenshot प्रतिबंधित)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshWorkflow}
                    disabled={refreshingWorkflow}
                    className="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-[10px] font-bold cursor-pointer"
                  >
                    <i className={`fa-solid ${refreshingWorkflow ? 'fa-spinner fa-spin' : 'fa-rotate'} mr-1`}></i>
                    रीफ्रेश
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-700 mb-1">
                    PTM हेतु छात्र चुनें (केवल कन्फर्म मार्कशीट दिखेगी):
                  </label>
                  <select
                    value={selectedStudent?.Student_ID || ''}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full sm:w-96 px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-blue-800 outline-none"
                  >
                    {classStudents.map((st) => (
                      <option key={st.Student_ID} value={st.Student_ID}>
                        {st.Student_Name} ({st.Class} • #{st.Roll_Number || st.Student_ID})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedReportData ? (
                <PrintableReportCard
                  data={selectedReportData}
                  mode="teacher_ptm_view_only"
                  ptmViewerName={currentUser.name || 'Teacher'}
                  classRankInfo={selectedStudent ? classRanksMap[selectedStudent.Student_ID] : undefined}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-xs font-bold">
                  कृपया छात्र चुनें।
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB: Batch Exam Marks Entry (Both Manager & Teacher — Teacher submits to Manager Confirmation) */}
      {activeSubTab === 'enter_marks' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
            {!isManager && (
              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-950 flex items-center gap-2">
                <i className="fa-solid fa-user-shield text-indigo-700"></i>
                <span>
                  टीचर मोड: यहाँ से केवल परीक्षा के अंक दर्ज कर मैनेजर कन्फर्मेशन के लिए भेजें। मैनेजर के कन्फर्म करने के बाद ही अंक Google Sheet में सेव होंगे।
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-black text-slate-700 mb-1">परीक्षा प्रकार चुनें:</label>
                <select
                  value={examTerm}
                  onChange={(e) => handleExamTermChange(e.target.value as ExamTermType)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-slate-50 outline-none focus:border-indigo-700"
                >
                  <option value="Quarterly">तिमाही परीक्षा (Quarterly • 40 अंक)</option>
                  <option value="Half-Yearly">छमाही परीक्षा (Half-Yearly • 60 अंक)</option>
                  <option value="Annual">सालाना परीक्षा (Annual • 100 अंक)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-700 mb-1">विषय चुनें (Subject):</label>
                <select
                  value={examSubject}
                  onChange={(e) => setExamSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-slate-50 outline-none focus:border-indigo-700"
                >
                  {REPORT_CARD_SUBJECTS.map((subj) => (
                    <option key={subj} value={subj}>
                      {subj}
                    </option>
                  ))}
                  <option value="__CUSTOM__">+ अन्य विषय लिखें...</option>
                </select>
                {examSubject === '__CUSTOM__' && (
                  <input
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder="नया विषय नाम लिखें..."
                    className="mt-1.5 w-full px-3 py-1.5 rounded-xl border border-indigo-300 text-xs font-bold outline-none focus:border-indigo-700"
                  />
                )}
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-700 mb-1">अधिकतम अंक (Max Marks):</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={maxMarksInput}
                  onChange={(e) => handleMaxMarksInputChange(e.target.value)}
                  onBlur={() => {
                    if (!maxMarksInput.trim() || parseInt(maxMarksInput, 10) <= 0) {
                      handleSelectMaxMarksPreset(DEFAULT_MAX_MARKS_BY_TERM[examTerm]);
                    }
                  }}
                  placeholder={`उदा. ${DEFAULT_MAX_MARKS_BY_TERM[examTerm]}`}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-black text-slate-900 outline-none focus:border-indigo-700"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[40, 50, 60, 80, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSelectMaxMarksPreset(preset)}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-black cursor-pointer border ${
                        maxMarksInput === String(preset)
                          ? 'bg-indigo-900 text-white border-indigo-900'
                          : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleSaveBatchMarks}
                  disabled={savingMarks || classStudents.length === 0}
                  className={`w-full px-4 py-2.5 rounded-xl text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50 ${
                    isManager
                      ? 'bg-indigo-900 hover:bg-indigo-800'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  <i
                    className={`fa-solid ${
                      savingMarks ? 'fa-spinner fa-spin' : isManager ? 'fa-cloud-arrow-up' : 'fa-paper-plane'
                    }`}
                  ></i>
                  <span>
                    {savingMarks
                      ? 'भेजा जा रहा है...'
                      : isManager
                      ? 'सभी अंक सेव व Sheet बैकअप करें'
                      : 'अंक मैनेजर कन्फर्मेशन हेतु भेजें'}
                  </span>
                </button>
              </div>
            </div>

            {selectedClass === 'ALL' && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900">
                सुझाव: अंक भरने के लिए ऊपर दाईं ओर से किसी एक विशेष कक्षा का चयन करने पर सूची छोटी व आसान हो जाती है।
              </div>
            )}

            {/* Auto-Draft Safety Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-50/70 border border-emerald-200 text-[11px] font-bold text-emerald-950">
              <div className="flex items-center gap-1.5">
                <i className="fa-solid fa-shield-check text-emerald-700"></i>
                <span>
                  💾 टाइप करते ही अंक फोन मेमोरी में सुरक्षित हो रहे हैं — बैकग्राउंड रिफ्रेश से लिखे हुए नंबर ब्लैंक नहीं होंगे।
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-white border border-emerald-300 text-[10px] font-black">
                  भरे गए: {classStudents.filter((s) => {
                    const r = marksDraft[String(s.Student_ID || '').trim()];
                    return r && (r.obtained.trim() !== '' || r.absent);
                  }).length} / {classStudents.length}
                </span>
                {hasRestoredLocalDraft && (
                  <button
                    type="button"
                    onClick={handleResetLocalDraft}
                    className="px-2 py-0.5 rounded-md bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 text-[10px] font-bold cursor-pointer"
                  >
                    ड्राफ्ट रीसेट करें
                  </button>
                )}
              </div>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs min-w-[640px]">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2.5 px-3 font-bold">रोल नं / ID</th>
                    <th className="py-2.5 px-3 font-bold">छात्र का नाम</th>
                    <th className="py-2.5 px-3 font-bold">कक्षा</th>
                    <th className="py-2.5 px-3 font-bold text-center">स्थिति</th>
                    <th className="py-2.5 px-3 font-bold text-center">उपस्थिति</th>
                    <th className="py-2.5 px-3 font-bold text-center">प्राप्तांक (/{maxMarks})</th>
                    <th className="py-2.5 px-3 font-bold">नोट (वैकल्पिक)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {classStudents.map((st) => {
                    const sid = String(st.Student_ID || '').trim();
                    const rowState = marksDraft[sid] || { obtained: '', absent: false, remarks: '' };
                    const hasPending = getPendingStatusForStudent(sid);
                    const hasConfirmed = getConfirmedStatusForStudent(sid);
                    const numericObt = parseFloat(rowState.obtained);
                    const isOverMax = !rowState.absent && rowState.obtained.trim() !== '' && Number.isFinite(numericObt) && numericObt > maxMarks;
                    return (
                      <tr key={sid || String(st.Student_Name)} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                          #{st.Roll_Number || '—'} ({sid})
                        </td>
                        <td className="py-2 px-3 font-black text-slate-900">{st.Student_Name}</td>
                        <td className="py-2 px-3 font-semibold text-blue-900">{st.Class}</td>
                        <td className="py-2 px-3 text-center">
                          {hasPending ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black">
                              ⏳ कन्फर्मेशन बाकी
                            </span>
                          ) : hasConfirmed ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black">
                              ✓ कन्फर्म
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 font-semibold">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => updateStudentDraftRow(sid, { absent: !rowState.absent })}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-black cursor-pointer ${
                              rowState.absent
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            }`}
                          >
                            {rowState.absent ? 'Absent' : 'Present'}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={rowState.absent}
                            value={rowState.absent ? '' : rowState.obtained}
                            onChange={(e) => {
                              const cleaned = e.target.value
                                .replace(/[^0-9.]/g, '')
                                .replace(/(\..*)\./g, '$1');
                              updateStudentDraftRow(sid, { obtained: cleaned });
                            }}
                            placeholder={rowState.absent ? 'AB' : `0 - ${maxMarks}`}
                            className={`w-24 px-2.5 py-1.5 rounded-lg border text-center font-black text-slate-900 disabled:bg-slate-100 outline-none ${
                              isOverMax
                                ? 'border-rose-500 bg-rose-50 focus:border-rose-600'
                                : 'border-slate-300 focus:border-indigo-700'
                            }`}
                          />
                          {isOverMax && (
                            <div className="text-[9px] font-bold text-rose-600 mt-0.5">अधिकतम {maxMarks} से अधिक!</div>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={rowState.remarks}
                            onChange={(e) => updateStudentDraftRow(sid, { remarks: e.target.value })}
                            placeholder="विषय टिप्पणी..."
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-indigo-700"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* TEACHER ONLY: Draft Teacher Remark & Result Suggestion Card (No Preview, No Print, No Publish) */}
          {!isManager && selectedReportData && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">
                    📝 रिपोर्ट कार्ड रिमार्क व परिणाम ड्राफ्ट तैयार करें (केवल मैनेजर को भेजने हेतु)
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    यहाँ से आप छात्र का टीचर रिमार्क व परिणाम सुझाव बनाकर मैनेजर कन्फर्मेशन के लिए भेज सकते हैं।
                  </p>
                </div>
                {pendingMeta[`${CURRENT_ACADEMIC_SESSION}::${selectedReportData.student.Student_ID}`] && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-950 border border-amber-300 text-[10px] font-black">
                    ⏳ इस छात्र का रिमार्क ड्राफ्ट कन्फर्मेशन हेतु भेजा जा चुका है
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black text-slate-700 mb-1">छात्र चुनें:</label>
                  <select
                    value={selectedStudent?.Student_ID || ''}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-blue-800 outline-none"
                  >
                    {classStudents.map((st) => (
                      <option key={st.Student_ID} value={st.Student_ID}>
                        {st.Student_Name} ({st.Class} • #{st.Roll_Number || st.Student_ID})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-black text-slate-700 mb-1">परिणाम सुझाव (Result Status):</label>
                  <select
                    value={resultStatusDraft}
                    onChange={(e) => setResultStatusDraft(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 bg-white focus:border-blue-800 outline-none"
                  >
                    <option value="PROMOTED">PROMOTED (अगली कक्षा में प्रोन्नत)</option>
                    <option value="PASSED">PASSED (उत्तीर्ण)</option>
                    <option value="NEEDS IMPROVEMENT">NEEDS IMPROVEMENT (सुधार आवश्यक)</option>
                    <option value="DETAINED">DETAINED (रोका गया)</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-black text-slate-700">टीचर रिमार्क ड्राफ्ट (Teacher Remark):</label>
                  <button
                    type="button"
                    onClick={() => setTeacherRemarkDraft(selectedReportData.autoTeacherRemark)}
                    className="text-[10px] font-bold text-blue-700 hover:underline cursor-pointer"
                  >
                    ✨ Smart English Auto-Fill
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={teacherRemarkDraft}
                  onChange={(e) => setTeacherRemarkDraft(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 focus:border-blue-800 outline-none"
                  placeholder="छात्र के शैक्षणिक प्रदर्शन पर रिमार्क लिखें..."
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSubmitTeacherRemarkDraft}
                  disabled={savingRemark}
                  className="px-4 py-2 rounded-xl bg-blue-950 hover:bg-blue-900 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <i className={`fa-solid ${savingRemark ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
                  <span>{savingRemark ? 'भेजा जा रहा है...' : 'रिमार्क ड्राफ्ट मैनेजर को भेजें'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MANAGER TAB: Merit List & Dedicated Google Sheet Backup */}
      {isManager && activeSubTab === 'merit_backup' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
            <div>
              <h3 className="text-xs sm:text-sm font-black text-emerald-950">
                Google Sheet समर्पित बैकअप ('Exam_Marks' व 'Report_Cards_Backup')
              </h3>
              <p className="text-[11px] text-emerald-800 mt-0.5">
                सभी छात्रों के साप्ताहिक + तिमाही + छमाही + सालाना प्रतिशत, हाजिरी व रिमार्क 1 क्लिक में Sheet में सुरक्षित करें।
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-file-csv text-emerald-700"></i>
                <span>CSV डाउनलोड</span>
              </button>
              <button
                type="button"
                onClick={handleSyncFullBackup}
                disabled={syncingBackup}
                className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <i className={`fa-solid ${syncingBackup ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i>
                <span>{syncingBackup ? 'बैकअप हो रहा है...' : 'Sheet में सभी बैकअप सिंक करें'}</span>
              </button>
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[740px]">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="py-2.5 px-3 text-center">रैंक</th>
                  <th className="py-2.5 px-3">छात्र (ID)</th>
                  <th className="py-2.5 px-3">कक्षा</th>
                  <th className="py-2.5 px-2.5 text-center">साप्ताहिक %</th>
                  <th className="py-2.5 px-2.5 text-center">तिमाही %</th>
                  <th className="py-2.5 px-2.5 text-center">छमाही %</th>
                  <th className="py-2.5 px-2.5 text-center">सालाना %</th>
                  <th className="py-2.5 px-2.5 text-center">कुल % (Grade)</th>
                  <th className="py-2.5 px-2.5 text-center">हाजिरी</th>
                  <th className="py-2.5 px-3 text-right">कार्रवाई</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {meritRows.map((rc, index) => (
                  <tr key={rc.student.Student_ID} className="hover:bg-slate-50">
                    <td className="py-2 px-3 text-center font-black">
                      {index === 0 ? '🥇 1' : index === 1 ? '🥈 2' : index === 2 ? '🥉 3' : `#${index + 1}`}
                    </td>
                    <td className="py-2 px-3">
                      <div className="font-black text-slate-900">{rc.student.Student_Name}</div>
                      <div className="text-[10px] text-slate-500">{rc.student.Student_ID}</div>
                    </td>
                    <td className="py-2 px-3 font-bold text-blue-900">
                      <div>{rc.student.Class}</div>
                      <div className="text-[10px] text-amber-700 font-black">
                        Rank: {classRanksMap[rc.student.Student_ID]?.label || '—'}
                      </div>
                    </td>
                    <td className="py-2 px-2.5 text-center">{rc.weeklySummary.max > 0 ? `${rc.weeklySummary.pct}%` : '—'}</td>
                    <td className="py-2 px-2.5 text-center">{rc.quarterlySummary.hasData ? `${rc.quarterlySummary.pct}%` : '—'}</td>
                    <td className="py-2 px-2.5 text-center">{rc.halfYearlySummary.hasData ? `${rc.halfYearlySummary.pct}%` : '—'}</td>
                    <td className="py-2 px-2.5 text-center">{rc.annualSummary.hasData ? `${rc.annualSummary.pct}%` : '—'}</td>
                    <td className="py-2 px-2.5 text-center font-black text-indigo-900">
                      {rc.overall.pct}% ({rc.overall.grade})
                    </td>
                    <td className="py-2 px-2.5 text-center font-bold text-emerald-700">{rc.attendance.attendancePct}%</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClass(rc.student.Class);
                          setSelectedStudentId(rc.student.Student_ID);
                          setActiveSubTab('report_card');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-blue-900 hover:bg-blue-800 text-white text-[10px] font-bold cursor-pointer"
                      >
                        मार्कशीट / प्रिंट
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
