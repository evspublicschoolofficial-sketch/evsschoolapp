import React, { useEffect, useMemo, useState } from 'react';
import {
  ExamMarkRecord,
  ExamTermType,
  ReportCardRemarkRecord,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import {
  CURRENT_ACADEMIC_SESSION,
  EXAM_TERM_LABELS,
  REPORT_CARD_SUBJECTS,
  ReportCardBackupRow,
  computeStudentReportCardData,
  normalizeSubjectKey,
  saveExamMarksBatchToServer,
  saveReportCardMetaToServer,
  syncAllReportCardsBackupToSheet,
} from '../utils/reportCardHelper';
import { getLocalTimestamp } from '../utils/localTime';
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
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'report_card' | 'enter_marks' | 'merit_backup'>('report_card');
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
    if (availableClasses.length > 0 && (!selectedClass || (selectedClass !== 'ALL' && !availableClasses.includes(selectedClass)))) {
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

  // Remark Editor State
  const [teacherRemarkDraft, setTeacherRemarkDraft] = useState('');
  const [principalRemarkDraft, setPrincipalRemarkDraft] = useState('');
  const [resultStatusDraft, setResultStatusDraft] = useState<'PROMOTED' | 'PASSED' | 'NEEDS IMPROVEMENT' | 'DETAINED'>(
    'PROMOTED'
  );
  const [publishedDraft, setPublishedDraft] = useState(true);
  const [savingRemark, setSavingRemark] = useState(false);

  useEffect(() => {
    if (selectedReportData) {
      setTeacherRemarkDraft(selectedReportData.meta.teacherRemark || selectedReportData.autoTeacherRemark);
      setPrincipalRemarkDraft(selectedReportData.meta.principalRemark || selectedReportData.autoPrincipalRemark);
      setResultStatusDraft((selectedReportData.meta.resultStatus as any) || 'PROMOTED');
      setPublishedDraft(selectedReportData.meta.publishedToParent !== false);
    }
  }, [selectedReportData?.student.Student_ID, reportCardMeta]);

  const handleSaveRemarks = async () => {
    if (!selectedReportData) return;
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
        principalRemark: principalRemarkDraft.trim() || selectedReportData.autoPrincipalRemark,
        resultStatus: resultStatusDraft,
        publishedToParent: publishedDraft,
        updatedBy: currentUser.name || (isManager ? 'Manager' : 'Teacher'),
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
      const existing = examMarks.find(
        (m) =>
          String(m.student_id || '').trim().toLowerCase() === String(st.Student_ID || '').trim().toLowerCase() &&
          m.exam_type === examTerm &&
          (String(m.subject || '').trim().toLowerCase() === subjLower ||
            (subjKey && normalizeSubjectKey(m.subject) === subjKey)) &&
          (!m.session || m.session === CURRENT_ACADEMIC_SESSION)
      );
      draft[st.Student_ID] = {
        obtained: existing ? String(existing.marks_obtained) : '',
        absent: existing?.attendance_status === 'Absent',
        remarks: existing?.remarks || '',
      };
    });
    setMarksDraft(draft);
  }, [classStudents, examMarks, examTerm, effectiveSubject]);

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

      const res = await saveExamMarksBatchToServer(recordsToSave);
      onExamMarksUpdated(res.records);
      setStatusBanner({
        type: res.sheetSynced ? 'success' : 'warning',
        text: res.sheetSynced
          ? `${EXAM_TERM_LABELS[examTerm]} (${effectiveSubject}) के ${recordsToSave.length} छात्रों के अंक Google Sheet 'Exam_Marks' में सेव हो गए!`
          : `ऐप में ${recordsToSave.length} अंक सेव हो गए! Google Sheet सिंक चेतावनी: ${res.sheetError || 'Apps Script सिंक टाइमआउट/त्रुटि'}`,
      });
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'अंक सेव करने में समस्या आई।' });
    } finally {
      setSavingMarks(false);
    }
  };

  // Class Merit & Backup Computation
  const meritRows = useMemo(() => {
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
  }, [selectedClass, students, classStudents, weeklyTests, examMarks, behaviorList, reportCardMeta]);

  const [syncingBackup, setSyncingBackup] = useState(false);

  const handleSyncFullBackup = async () => {
    setSyncingBackup(true);
    setStatusBanner(null);
    try {
      const targetStudents = isManager ? students : classStudents;
      const backups: ReportCardBackupRow[] = targetStudents.map((st) => {
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
          updatedBy: currentUser.name || (isManager ? 'Manager' : 'Teacher'),
          updatedAt: getLocalTimestamp(),
        };
      });

      const res = await syncAllReportCardsBackupToSheet({ backups, examMarks });
      setStatusBanner({
        type: res.sheetSynced ? 'success' : 'warning',
        text: res.sheetSynced
          ? `✅ सभी ${backups.length} छात्रों के रिपोर्ट कार्ड ('Report_Cards_Backup') व ${examMarks.length} परीक्षा अंक ('Exam_Marks') Google Sheet में बैकअप हो गए!`
          : `स्थानीय सर्वर बैकअप पूरा (${backups.length} छात्र)! Google Sheet सिंक चेतावनी: ${res.sheetError || 'Apps Script सिंक टाइमआउट/त्रुटि'}`,
      });
    } catch (e: any) {
      setStatusBanner({ type: 'error', text: e?.message || 'Google Sheet बैकअप में त्रुटि आई।' });
    } finally {
      setSyncingBackup(false);
    }
  };

  const handleExportCsv = () => {
    const header = [
      'Rank',
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

  return (
    <div className="space-y-4">
      {/* Module Header & Sub-Tabs */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-900 to-indigo-950 text-amber-300 flex items-center justify-center text-xl shadow-sm shrink-0">
              <i className="fa-solid fa-graduation-cap"></i>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900">
                डिजिटल रिपोर्ट कार्ड व परीक्षा प्रबंधन (Marksheet PDF)
              </h2>
              <p className="text-xs text-slate-600">
                साप्ताहिक टेस्ट + तिमाही + छमाही + सालाना परीक्षा अंक, हाजिरी % व Google Sheet बैकअप
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

        {/* Sub-tab Switcher */}
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setActiveSubTab('report_card')}
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
            onClick={() => setActiveSubTab('enter_marks')}
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
            onClick={() => setActiveSubTab('merit_backup')}
            className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'merit_backup'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <i className="fa-solid fa-cloud-arrow-up"></i>
            <span>मेरिट सूची व Google Sheet बैकअप</span>
          </button>
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

      {/* TAB 1: Report Card Preview, Remark Editor & 1-Click PDF Print */}
      {activeSubTab === 'report_card' && (
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
                    पेरेंट पोर्टल पर व्यू-ओनली दिखाएँ
                  </span>
                </label>
              </div>
            </div>

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
                onClick={handleSaveRemarks}
                disabled={savingRemark || !selectedReportData}
                className="px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <i className={`fa-solid ${savingRemark ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                <span>{savingRemark ? 'सेव हो रहा है...' : 'रिमार्क व सेटिंग सेव करें'}</span>
              </button>
            </div>
          </div>

          {selectedReportData ? (
            <PrintableReportCard data={selectedReportData} mode="staff_printable" />
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-xs font-bold">
              कृपया रिपोर्ट कार्ड देखने के लिए ऊपर से कक्षा व छात्र चुनें।
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Batch Exam Marks Entry (Quarterly, Half-Yearly, Annual) */}
      {activeSubTab === 'enter_marks' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-4">
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
                className="w-full px-4 py-2.5 rounded-xl bg-indigo-900 hover:bg-indigo-800 text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <i className={`fa-solid ${savingMarks ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i>
                <span>{savingMarks ? 'सेव हो रहा है...' : 'सभी अंक सेव व Sheet बैकअप करें'}</span>
              </button>
            </div>
          </div>

          {selectedClass === 'ALL' && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-900">
              सुझाव: अंक भरने के लिए ऊपर दाईं ओर से किसी एक विशेष कक्षा का चयन करने पर सूची छोटी व आसान हो जाती है।
            </div>
          )}

          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[580px]">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="py-2.5 px-3 font-bold">रोल नं / ID</th>
                  <th className="py-2.5 px-3 font-bold">छात्र का नाम</th>
                  <th className="py-2.5 px-3 font-bold">कक्षा</th>
                  <th className="py-2.5 px-3 font-bold text-center">उपस्थिति</th>
                  <th className="py-2.5 px-3 font-bold text-center">प्राप्तांक (/{maxMarks})</th>
                  <th className="py-2.5 px-3 font-bold">नोट (वैकल्पिक)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {classStudents.map((st) => {
                  const rowState = marksDraft[st.Student_ID] || { obtained: '', absent: false, remarks: '' };
                  return (
                    <tr key={st.Student_ID} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono text-[11px] text-slate-600">
                        #{st.Roll_Number || '—'} ({st.Student_ID})
                      </td>
                      <td className="py-2 px-3 font-black text-slate-900">{st.Student_Name}</td>
                      <td className="py-2 px-3 font-semibold text-blue-900">{st.Class}</td>
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
      )}

      {/* TAB 3: Merit List & Dedicated Google Sheet Backup */}
      {activeSubTab === 'merit_backup' && (
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
                    <td className="py-2 px-3 font-bold text-blue-900">{rc.student.Class}</td>
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
