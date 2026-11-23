import React, { useEffect, useMemo, useState } from 'react';
import {
  ExamMarkRecord,
  ExamTermType,
  ReportCardAccessConfig,
  ReportCardRemarkRecord,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import {
  CURRENT_ACADEMIC_SESSION,
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

export const ReportCardManagerView: React.FC<ReportCardManagerViewProps> = ({
  students,
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

  // Automatically fetch latest workflow (permissions + teacher pending drafts) on mount
  useEffect(() => {
    fetchReportCardWorkflowFromServer(true)
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
    if (
      availableClasses.length > 0 &&
      (!selectedClass || (selectedClass !== 'ALL' && !availableClasses.includes(selectedClass)))
    ) {
      setSelectedClass(availableClasses[0]);
    }
  }, [availableClasses, selectedClass]);

  const classStudents = useMemo(() => {
    if (!selectedClass || selectedClass === 'ALL') return students;
    const tok = normalizeClassToken(selectedClass);
    return students.filter((s) => normalizeClassToken(s.Class) === tok);
  }, [students, selectedClass]);

  const [selectedStudentId, setSelectedStudentId] = useState<string>('');

  useEffect(() => {
    if (classStudents.length > 0 && !classStudents.some((s) => s.Student_ID === selectedStudentId)) {
      setSelectedStudentId(classStudents[0].Student_ID);
    }
  }, [classStudents, selectedStudentId]);

  const selectedStudent = useMemo(
    () => classStudents.find((s) => s.Student_ID === selectedStudentId) || classStudents[0] || null,
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
  const [maxMarks, setMaxMarks] = useState<number>(50);
  const [savingMarks, setSavingMarks] = useState(false);

  const effectiveSubject = examSubject === '__CUSTOM__' ? customSubject.trim() || 'सामान्य ज्ञान' : examSubject;

  const handleExamTermChange = (term: ExamTermType) => {
    setExamTerm(term);
    setMaxMarks(term === 'Quarterly' ? 50 : 100);
  };

  const [marksDraft, setMarksDraft] = useState<
    Record<string, { obtained: string; absent: boolean; remarks: string }>
  >({});

  useEffect(() => {
    const draft: Record<string, { obtained: string; absent: boolean; remarks: string }> = {};
    const subjLower = effectiveSubject.trim().toLowerCase();
    const subjKey = normalizeSubjectKey(effectiveSubject);
    classStudents.forEach((st) => {
      const matchFn = (m: ExamMarkRecord) =>
        String(m.student_id || '').trim().toLowerCase() === String(st.Student_ID || '').trim().toLowerCase() &&
        m.exam_type === examTerm &&
        (String(m.subject || '').trim().toLowerCase() === subjLower ||
          (subjKey && normalizeSubjectKey(m.subject) === subjKey)) &&
        (!m.session || m.session === CURRENT_ACADEMIC_SESSION);

      // For Teacher, prefer their pending submission if present so they can edit before Manager confirms
      const pendingExisting = !isManager ? pendingMarks.find(matchFn) : undefined;
      const confirmedExisting = examMarks.find(matchFn);
      const source = pendingExisting || confirmedExisting;

      draft[st.Student_ID] = {
        obtained: source ? String(source.marks_obtained) : '',
        absent: source?.attendance_status === 'Absent',
        remarks: source?.remarks || '',
      };
    });
    setMarksDraft(draft);
  }, [classStudents, examMarks, pendingMarks, examTerm, effectiveSubject, isManager]);

  const handleSaveBatchMarks = async () => {
    if (classStudents.length === 0) return;
    setSavingMarks(true);
    setStatusBanner(null);
    try {
      const recordsToSave: ExamMarkRecord[] = [];
      classStudents.forEach((st) => {
        const entry = marksDraft[st.Student_ID];
        if (!entry) return;
        const hasVal = entry.obtained.trim() !== '' || entry.absent;
        if (!hasVal) return;

        const numObt = entry.absent ? 0 : Math.min(maxMarks, Math.max(0, Number(entry.obtained) || 0));
        const safeSubjKey = effectiveSubject.replace(/[^a-z0-9\u0900-\u097f]/gi, '').slice(0, 18);
        recordsToSave.push({
          id: `em_${CURRENT_ACADEMIC_SESSION}_${examTerm}_${st.Student_ID}_${safeSubjKey}`,
          session: CURRENT_ACADEMIC_SESSION,
          exam_type: examTerm,
          student_id: st.Student_ID,
          student_name: st.Student_Name,
          class_name: st.Class,
          subject: effectiveSubject,
          max_marks: maxMarks,
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
            text: `✅ ${EXAM_TERM_LABELS[examTerm]} (${effectiveSubject}) के ${recordsToSave.length} छात्रों के अंक क्लाउड में मैनेजर कन्फर्मेशन के लिए भेज दिए गए हैं!`,
          });
        }
      } else {
        // MANAGER: Save directly to Sheet
        const res = await saveExamMarksBatchToServer(recordsToSave);
        onExamMarksUpdated(res.records);
        setStatusBanner({
          type: res.sheetSynced ? 'success' : 'warning',
          text: res.sheetSynced
            ? `${EXAM_TERM_LABELS[examTerm]} (${effectiveSubject}) के ${recordsToSave.length} छात्रों के अंक Google Sheet 'Exam_Marks' में सेव हो गए!`
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

      {/* MANAGER TAB: Pending Teacher Approvals Queue */}
      {isManager && activeSubTab === 'pending_approvals' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
            <div>
              <h3 className="text-xs sm:text-sm font-black text-amber-950">
                ⏳ टीचर द्वारा भेजे गए अंक व रिपोर्ट कार्ड ड्राफ्ट (Manager Confirmation Queue)
              </h3>
              <p className="text-[11px] text-amber-900 mt-0.5">
                जब तक आप कन्फर्म नहीं करेंगे, तब तक ये अंक Google Sheet ('Exam_Marks' / 'Report_Cards_Backup') में सेव नहीं होंगे।
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
                        : `सभी कन्फर्म करें व Google Sheet में सेव करें (${totalPendingCount})`}
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>

          {totalPendingCount === 0 ? (
            <div className="p-8 text-center border border-dashed border-slate-200 rounded-xl space-y-2">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <div className="text-sm font-black text-slate-800">कोई पेंडिंग कन्फर्मेशन बाकी नहीं है</div>
              <p className="text-xs text-slate-500">
                जब कोई टीचर परीक्षा अंक या रिमार्क ड्राफ्ट सबमिट करेगा, तो वह यहाँ आपकी मंज़ूरी के लिए दिखाई देगा।
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingMarks.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-slate-800">
                    📝 पेंडिंग परीक्षा अंक ({pendingMarks.length} प्रविष्टियाँ):
                  </h4>
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs min-w-[680px]">
                      <thead>
                        <tr className="bg-slate-900 text-white">
                          <th className="py-2.5 px-3">छात्र (कक्षा)</th>
                          <th className="py-2.5 px-3">परीक्षा / विषय</th>
                          <th className="py-2.5 px-3 text-center">टीचर के अंक</th>
                          <th className="py-2.5 px-3 text-center">पुराने Sheet अंक</th>
                          <th className="py-2.5 px-3">टीचर / समय</th>
                          <th className="py-2.5 px-3 text-right">कार्रवाई</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {pendingMarks.map((pm) => {
                          const existing = examMarks.find((em) => em.id === pm.id);
                          return (
                            <tr key={pm.id} className="hover:bg-amber-50/40">
                              <td className="py-2 px-3">
                                <div className="font-black text-slate-900">{pm.student_name}</div>
                                <div className="text-[10px] text-slate-500">
                                  {pm.class_name} • {pm.student_id}
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
                              <td className="py-2 px-3 text-[11px] text-slate-600">
                                <div className="font-bold text-slate-800">{pm.teacher_name || 'Teacher'}</div>
                                <div>{pm.submitted_at || pm.updated_at}</div>
                              </td>
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
                </div>
              )}

              {pendingMetaList.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-black text-slate-800">
                    💬 पेंडिंग टीचर रिमार्क व परिणाम ड्राफ्ट ({pendingMetaList.length}):
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {pendingMetaList.map((draft) => (
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
          )}
        </div>
      )}

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
                {selectedReportData && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {[
                      {
                        label: 'Merit / Top',
                        text: `${selectedReportData.student.Student_Name.split(' ')[0]} is an exceptionally bright, disciplined, and conscientious learner who excels consistently across subjects.`,
                      },
                      {
                        label: 'Steady Growth',
                        text: `${selectedReportData.student.Student_Name.split(' ')[0]} shows steady progress and active curiosity in class. Daily written practice will elevate scores even further.`,
                      },
                      {
                        label: 'Focus & Attendance',
                        text: `${selectedReportData.student.Student_Name.split(' ')[0]} has good learning potential. Regular school attendance and daily home revision are strongly encouraged.`,
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
                )}
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
                {selectedReportData && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {[
                      {
                        label: 'Honour Roll',
                        text: `Heartiest congratulations! Proud of ${selectedReportData.student.Student_Name.split(' ')[0]}'s outstanding dedication and conduct.`,
                      },
                      {
                        label: 'Good Potential',
                        text: `Keep striving for excellence! Consistent effort and discipline will bring even brighter achievements ahead.`,
                      },
                      {
                        label: 'Parent Support',
                        text: `With regular attendance and guided practice at home, ${selectedReportData.student.Student_Name.split(' ')[0]} can achieve distinction in upcoming terms.`,
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
                )}
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
                  <option value="Quarterly">तिमाही परीक्षा (Quarterly Exam)</option>
                  <option value="Half-Yearly">छमाही परीक्षा (Half-Yearly Exam)</option>
                  <option value="Annual">सालाना परीक्षा (Annual Exam)</option>
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
              </div>

              {examSubject === '__CUSTOM__' ? (
                <div>
                  <label className="block text-[11px] font-black text-slate-700 mb-1">नया विषय नाम:</label>
                  <input
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder="उदा. ड्राइंग / कला"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold outline-none focus:border-indigo-700"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-[11px] font-black text-slate-700 mb-1">अधिकतम अंक (Max Marks):</label>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    value={maxMarks}
                    onChange={(e) => setMaxMarks(Math.max(1, Number(e.target.value) || 50))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-black text-slate-900 outline-none focus:border-indigo-700"
                  />
                </div>
              )}

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
                    const rowState = marksDraft[st.Student_ID] || { obtained: '', absent: false, remarks: '' };
                    const hasPending = getPendingStatusForStudent(st.Student_ID);
                    const hasConfirmed = getConfirmedStatusForStudent(st.Student_ID);
                    return (
                      <tr key={st.Student_ID} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                          #{st.Roll_Number || '—'} ({st.Student_ID})
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
                            onClick={() =>
                              setMarksDraft((prev) => ({
                                ...prev,
                                [st.Student_ID]: { ...rowState, absent: !rowState.absent },
                              }))
                            }
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
                            type="number"
                            min={0}
                            max={maxMarks}
                            step="0.5"
                            disabled={rowState.absent}
                            value={rowState.absent ? '' : rowState.obtained}
                            onChange={(e) =>
                              setMarksDraft((prev) => ({
                                ...prev,
                                [st.Student_ID]: { ...rowState, obtained: e.target.value },
                              }))
                            }
                            placeholder={rowState.absent ? 'AB' : `0 - ${maxMarks}`}
                            className="w-24 px-2.5 py-1.5 rounded-lg border border-slate-300 text-center font-black text-slate-900 disabled:bg-slate-100 outline-none focus:border-indigo-700"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={rowState.remarks}
                            onChange={(e) =>
                              setMarksDraft((prev) => ({
                                ...prev,
                                [st.Student_ID]: { ...rowState, remarks: e.target.value },
                              }))
                            }
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
