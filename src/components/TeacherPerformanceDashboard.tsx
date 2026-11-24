import React, { useState, useMemo, useEffect } from 'react';
import { getLocalDateYMD, getLocalTimestamp } from '../utils/localTime';
import {
  ExamMarkRecord,
  ReportCardRemarkRecord,
  SchoolUser,
  Homework,
  HomeworkTrackerRecord,
  StaffAttendanceRecord,
  StudentBehaviorRecord,
  Student,
  SyllabusTopicRecord,
  WeeklyTestRecord,
  TeacherProfileMeta,
} from '../types';
import {
  TeacherPerformanceRecord,
  MonthlyLeaderboardSummary,
  TeacherOfTheYearResult,
} from '../types/teacherPerformance';
import {
  ACADEMIC_MONTHS,
  CURRENT_ACADEMIC_YEAR,
  getDefaultAcademicMonth,
  calculateMonthlyScore,
  computeMonthlyLeaderboard,
  computeTeacherOfTheYear,
  loadLocalPerformanceRecords,
  saveLocalPerformanceRecords,
  syncPerformanceRecordToApi,
  fetchPerformanceRecordsFromApi,
  syncAllPerformanceTwoWay,
  autoCalculateTeacherMonthlyScoreFromAppData,
  autoEvaluateAllTeachersForMonth,
  AutoCalculationBreakdown,
} from '../utils/teacherPerformanceEngine';
import {
  fetchExamMarksFromServer,
  fetchReportCardMetaFromServer,
  fetchReportCardWorkflowFromServer,
  loadLocalExamMarks,
  loadLocalReportCardMeta,
  loadLocalReportCardWorkflow,
} from '../utils/reportCardHelper';
import {
  fetchTeacherProfilesFromServer,
  findTeacherProfileInMap,
  loadLocalTeacherProfiles,
} from '../utils/teacherProfileHelper';
import { getAppsScriptUrl, GOOGLE_APPS_SCRIPT_CODE } from '../utils/busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from '../utils/sheetDirectSync';
import { TeacherSyllabusPlanner } from './TeacherSyllabusPlanner';
import { WeeklySubjectTestManager, loadLocalWeeklyTests } from './WeeklySubjectTestManager';
import { TeacherPerformanceReportView } from './TeacherPerformanceReportView';

interface TeacherPerformanceDashboardProps {
  users?: SchoolUser[];
  managerName?: string;
  onClose?: () => void;
  initialTab?: 'leaderboard' | 'annual' | 'records' | 'setup' | 'syllabus' | 'weekly_tests' | 'report';
  isTeacherView?: boolean;
  loggedTeacherId?: string;
  loggedUser?: SchoolUser | null;
  homeworkList?: Homework[];
  homeworkTrackerList?: HomeworkTrackerRecord[];
  staffAttendanceList?: StaffAttendanceRecord[];
  behaviorList?: StudentBehaviorRecord[];
  students?: Student[];
  syllabusTopics?: SyllabusTopicRecord[];
  weeklyTests?: WeeklyTestRecord[];
  examMarks?: ExamMarkRecord[];
  reportCardMeta?: Record<string, ReportCardRemarkRecord>;
  pendingMarks?: ExamMarkRecord[];
  classMap?: Record<string, string>;
}

export const TeacherPerformanceDashboard: React.FC<TeacherPerformanceDashboardProps> = ({
  users = [],
  managerName = 'प्रबंधक (Principal / Manager)',
  onClose,
  initialTab = 'leaderboard',
  isTeacherView = false,
  loggedTeacherId,
  loggedUser = null,
  homeworkList = [],
  homeworkTrackerList = [],
  staffAttendanceList = [],
  behaviorList = [],
  students = [],
  syllabusTopics = [],
  weeklyTests = [],
  examMarks = [],
  reportCardMeta,
  pendingMarks = [],
  classMap,
}) => {
  const [loadedTeacherProfiles, setLoadedTeacherProfiles] = useState<Record<string, TeacherProfileMeta>>(() =>
    loadLocalTeacherProfiles()
  );

  // Filter active teachers from users list (exclude drivers/parents/non-teaching transport staff)
  const teachers = useMemo(() => {
    const baseUsers = users.length > 0 ? users : loggedUser ? [loggedUser] : [];
    return baseUsers
      .filter((u) => {
        const desig = String(u.Designation || '').toLowerCase();
        if (/driver|van|bus|conductor|guard|peon|parent|student/i.test(desig)) return false;
        return (
          !desig ||
          desig.includes('teacher') ||
          desig.includes('शिक्षक') ||
          desig.includes('faculty') ||
          desig.includes('instructor') ||
          desig.includes('principal') ||
          desig.includes('staff')
        );
      })
      .map((u) => {
        const prof = findTeacherProfileInMap(loadedTeacherProfiles, {
          userId: u.User_ID,
          username: u.Username,
          name: u.Name,
        });
        if (!prof) return u;
        return {
          ...u,
          Assigned_Subjects: u.Assigned_Subjects || prof.assigned_subjects || '',
          Department: u.Department || prof.department || '',
          Teacher_Photo: u.Teacher_Photo || prof.teacher_photo || '',
        };
      });
  }, [users, loggedUser, loadedTeacherProfiles]);

  const [records, setRecords] = useState<TeacherPerformanceRecord[]>(() => loadLocalPerformanceRecords());
  const [loadedSyllabusTopics, setLoadedSyllabusTopics] = useState<SyllabusTopicRecord[]>(syllabusTopics);
  const [loadedWeeklyTests, setLoadedWeeklyTests] = useState<WeeklyTestRecord[]>(() =>
    weeklyTests.length > 0 ? weeklyTests : loadLocalWeeklyTests()
  );
  const [loadedExamMarks, setLoadedExamMarks] = useState<ExamMarkRecord[]>(() =>
    examMarks.length > 0 ? examMarks : loadLocalExamMarks()
  );
  const [loadedReportCardMeta, setLoadedReportCardMeta] = useState<Record<string, ReportCardRemarkRecord>>(() =>
    reportCardMeta && Object.keys(reportCardMeta).length > 0 ? reportCardMeta : loadLocalReportCardMeta()
  );
  const [loadedPendingMarks, setLoadedPendingMarks] = useState<ExamMarkRecord[]>(() =>
    pendingMarks.length > 0 ? pendingMarks : loadLocalReportCardWorkflow().pendingMarks || []
  );
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'annual' | 'records' | 'setup' | 'syllabus' | 'weekly_tests' | 'report'>(initialTab);
  const [selectedReportTeacherId, setSelectedReportTeacherId] = useState<string>(() =>
    String(loggedTeacherId || loggedUser?.User_ID || loggedUser?.Username || '')
  );
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getDefaultAcademicMonth());
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRecord, setEditingRecord] = useState<TeacherPerformanceRecord | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedFullCode, setCopiedFullCode] = useState<boolean>(false);
  const [fullCodeLoading, setFullCodeLoading] = useState<boolean>(false);
  const [certificateRecord, setCertificateRecord] = useState<TeacherPerformanceRecord | null>(null);

  // Form State for Entry Modal
  const [formTeacherId, setFormTeacherId] = useState<string>('');
  const [formMonth, setFormMonth] = useState<string>(() => getDefaultAcademicMonth());
  const [formSyllabus, setFormSyllabus] = useState<number>(25);
  const [formTest, setFormTest] = useState<number>(20);
  const [formAttendance, setFormAttendance] = useState<number>(14);
  const [formHomework, setFormHomework] = useState<number>(14);
  const [formPunctuality, setFormPunctuality] = useState<number>(14);
  const [formRemarks, setFormRemarks] = useState<string>('');
  const [autoBreakdown, setAutoBreakdown] = useState<AutoCalculationBreakdown | null>(null);
  const [isAutoCalculatingAll, setIsAutoCalculatingAll] = useState<boolean>(false);
  const [isRefreshingSheet, setIsRefreshingSheet] = useState<boolean>(false);

  const effectiveSyllabusTopics = syllabusTopics.length > 0 ? syllabusTopics : loadedSyllabusTopics;
  const effectiveWeeklyTests = weeklyTests.length > 0 ? weeklyTests : loadedWeeklyTests;
  const effectiveExamMarks = examMarks.length > 0 ? examMarks : loadedExamMarks;
  const effectiveReportCardMeta =
    reportCardMeta && Object.keys(reportCardMeta).length > 0 ? reportCardMeta : loadedReportCardMeta;
  const effectivePendingMarks = pendingMarks.length > 0 ? pendingMarks : loadedPendingMarks;

  useEffect(() => {
    if (!selectedReportTeacherId && teachers.length > 0) {
      setSelectedReportTeacherId(
        String(loggedTeacherId || teachers[0].User_ID || teachers[0].Username || '')
      );
    }
  }, [teachers, loggedTeacherId, selectedReportTeacherId]);

  const handleSyncPerformanceFromSheet = async () => {
    setIsRefreshingSheet(true);
    setSyncStatus('🔄 Google Sheet से 2-Way सिंक हो रहा है (लंबित डेटा भेजा जा रहा है)...');
    try {
      const activeUrl = getAppsScriptUrl();
      const sylDemoIds = new Set(['syl_2026_09_sunita_1', 'syl_2026_09_sunita_2', 'syl_2026_09_sunita_3', 'syl_2026_09_sunita_4']);
      const localTopics = effectiveSyllabusTopics.filter((t) => t && t.topic_description && !sylDemoIds.has(String(t.id)));

      const tpSync = await syncAllPerformanceTwoWay(records, (done, total) => {
        setSyncStatus(`🔄 शिक्षक मूल्यांकन Google Sheet में भेजा जा रहा है... (${done}/${total})`);
      });

      // Push any pending syllabus topics sequentially with direct fallback
      let sylPushed = 0;
      let sylFailed = 0;
      let sylError = '';
      let sylSheetCount = 0;
      let finalSylTopics = effectiveSyllabusTopics;

      try {
        const directSyl = await directGetFromSheet('getSyllabusTracker', activeUrl);
        const sheetRaw: any[] = directSyl.ok
          ? (Array.isArray(directSyl.json) ? directSyl.json : Array.isArray(directSyl.json?.topics) ? directSyl.json.topics : [])
          : [];
        const sheetSylIds = new Set(sheetRaw.filter((r) => r && !Array.isArray(r)).map((r) => String(r.id || '').trim()).filter(Boolean));
        const toPushSyl = localTopics.filter((t) => !sheetSylIds.has(String(t.id).trim()));

        for (let i = 0; i < toPushSyl.length; i++) {
          const top = toPushSyl[i];
          setSyncStatus(`🔄 सिलेबस टॉपिक Google Sheet में भेजा जा रहा है... (${i + 1}/${toPushSyl.length})`);
          const wr = await dualSyncWriteToSheet({
            apiPath: '/api/syllabus-tracker',
            method: 'POST',
            apiBody: top,
            directPayload: { action: 'saveSyllabusTopic', topic: JSON.stringify(top), ...top },
            overrideUrl: activeUrl,
          });
          if (wr.sheetSynced) sylPushed++;
          else {
            sylFailed++;
            if (!sylError && wr.sheetError) sylError = wr.sheetError;
          }
        }

        const freshSylRes = await fetch('/api/syllabus-tracker?refresh=1', {
          headers: { 'x-apps-script-url': activeUrl },
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        if (freshSylRes && freshSylRes.ok) {
          const freshArr = await freshSylRes.json().catch(() => null);
          if (Array.isArray(freshArr) && freshArr.length > 0) {
            finalSylTopics = freshArr;
          }
        } else if (sheetRaw.length > 0) {
          finalSylTopics = sheetRaw;
        }
        sylSheetCount = sheetSylIds.size + sylPushed;
      } catch {}

      if (tpSync.records && tpSync.records.length > 0) setRecords(tpSync.records);
      if (finalSylTopics.length > 0) setLoadedSyllabusTopics(finalSylTopics);

      const totalPushed = (tpSync.pushed || 0) + sylPushed;
      const totalFailed = (tpSync.failed || 0) + sylFailed;
      const errMsg = tpSync.lastError || sylError;

      if (totalFailed > 0) {
        setSyncStatus(`⚠️ ${totalPushed} रिकॉर्ड Sheet में गए, पर ${totalFailed} में त्रुटि: ${errMsg || 'Apps Script जांचें'}`);
        setTimeout(() => setSyncStatus(null), 9000);
      } else if (totalPushed > 0) {
        setSyncStatus(`✅ 2-Way सिंक पूर्ण! ${totalPushed} लंबित रिकॉर्ड Google Sheet में भेजकर ताज़ा डेटा लोड किया गया!`);
        setTimeout(() => setSyncStatus(null), 5000);
      } else if ((tpSync.sheetCount || 0) + sylSheetCount > 0) {
        setSyncStatus(`🔄 Google Sheet से सभी ${tpSync.sheetCount} मूल्यांकन और ${sylSheetCount} सिलेबस रिकॉर्ड पहले से सिंक हैं!`);
        setTimeout(() => setSyncStatus(null), 4000);
      } else {
        setSyncStatus('🔄 Google Sheet कनेक्टेड है! नया मूल्यांकन जोड़ने या "ऑटो-मूल्यांकन" दबाने पर डेटा सीधे Sheet में जाएगा।');
        setTimeout(() => setSyncStatus(null), 4500);
      }
    } catch {
      setSyncStatus('⚠️ नेटवर्क त्रुटि: Google Sheet से सिंक नहीं हो सका');
      setTimeout(() => setSyncStatus(null), 5000);
    }
    setIsRefreshingSheet(false);
  };

  // Fetch fresh records and syllabus topics on mount + live cross-tab WebSocket/storage sync
  useEffect(() => {
    const loadFresh = () => {
      const activeUrl = getAppsScriptUrl();
      fetchPerformanceRecordsFromApi(true).then((fresh) => {
        if (fresh && fresh.length > 0) setRecords(fresh);
      });
      fetchTeacherProfilesFromServer(activeUrl, false).then((profs) => {
        if (profs && Object.keys(profs).length > 0) setLoadedTeacherProfiles(profs);
      });
      if (examMarks.length === 0) {
        fetchExamMarksFromServer(false).then((marks) => {
          if (Array.isArray(marks) && marks.length > 0) setLoadedExamMarks(marks);
        });
      }
      if (!reportCardMeta || Object.keys(reportCardMeta).length === 0) {
        fetchReportCardMetaFromServer(false).then((meta) => {
          if (meta && Object.keys(meta).length > 0) setLoadedReportCardMeta(meta);
        });
      }
      if (pendingMarks.length === 0) {
        fetchReportCardWorkflowFromServer(false).then((wf) => {
          if (wf && Array.isArray(wf.pendingMarks)) setLoadedPendingMarks(wf.pendingMarks);
        });
      }
      if (syllabusTopics.length === 0) {
        fetch('/api/syllabus-tracker?refresh=1', {
          headers: { 'x-apps-script-url': activeUrl },
          signal: AbortSignal.timeout(10000),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then(async (data) => {
            if (Array.isArray(data) && data.length > 0) {
              setLoadedSyllabusTopics(data);
              return;
            }
            const direct = await directGetFromSheet('getSyllabusTracker', activeUrl);
            const rows = direct.ok
              ? (Array.isArray(direct.json) ? direct.json : Array.isArray(direct.json?.topics) ? direct.json.topics : [])
              : [];
            if (rows.length > 0) setLoadedSyllabusTopics(rows);
          })
          .catch(() => {});
      }
      if (weeklyTests.length === 0) {
        fetch('/api/weekly-tests?refresh=1', {
          headers: { 'x-apps-script-url': activeUrl },
          signal: AbortSignal.timeout(10000),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (Array.isArray(data) && data.length > 0) {
              setLoadedWeeklyTests(data);
            }
          })
          .catch(() => {});
      }
    };
    loadFresh();

    const onStorage = (ev: StorageEvent) => {
      if (
        ev.key === 'evs_teacher_performance_records_v1' ||
        ev.key === 'evs_syllabus_planner_records_v1' ||
        ev.key === 'evs_weekly_subject_tests_v1' ||
        ev.key === 'evs_exam_marks_v1' ||
        ev.key === 'evs_report_card_meta_v1' ||
        ev.key === 'evs_teacher_profiles_v1'
      ) {
        loadFresh();
      }
    };
    window.addEventListener('storage', onStorage);

    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/location`);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (
            msg?.type === 'APP_DATA_UPDATED' &&
            (msg.entity === 'teacher_performance' ||
              msg.entity === 'syllabus_tracker' ||
              msg.entity === 'weekly_tests' ||
              msg.entity === 'report_cards' ||
              msg.entity === 'users')
          ) {
            loadFresh();
          }
        } catch {}
      };
    } catch {}

    return () => {
      window.removeEventListener('storage', onStorage);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, [syllabusTopics.length, weeklyTests.length, examMarks.length]);

  // Compute Live Calculated Monthly Score for Modal
  const liveScore = useMemo(() => {
    return calculateMonthlyScore({
      syllabusProgress: formSyllabus,
      studentTest: formTest,
      attendanceLogging: formAttendance,
      homeworkEvaluation: formHomework,
      punctualityDiscipline: formPunctuality,
    });
  }, [formSyllabus, formTest, formAttendance, formHomework, formPunctuality]);

  // Compute Monthly Leaderboard
  const monthlySummary: MonthlyLeaderboardSummary = useMemo(() => {
    return computeMonthlyLeaderboard(records, selectedMonth, teachers);
  }, [records, selectedMonth, teachers]);

  // Compute Teacher of the Year
  const annualSummary: TeacherOfTheYearResult = useMemo(() => {
    return computeTeacherOfTheYear(records, CURRENT_ACADEMIC_YEAR);
  }, [records]);

  // Open modal for new entry or edit
  const handleOpenEvaluationModal = (existing?: TeacherPerformanceRecord) => {
    setAutoBreakdown(null);
    if (existing) {
      setEditingRecord(existing);
      setFormTeacherId(existing.teacher_id);
      setFormMonth(existing.month || selectedMonth);
      setFormSyllabus(existing.syllabus_progress_score || 0);
      setFormTest(existing.student_test_score || 0);
      setFormAttendance(existing.attendance_logging_score || 0);
      setFormHomework(existing.homework_evaluation_score || 0);
      setFormPunctuality(existing.punctuality_discipline_score || 0);
      setFormRemarks(existing.remarks || '');
    } else {
      setEditingRecord(null);
      const defaultTeacher = teachers[0]?.User_ID || '';
      setFormTeacherId(defaultTeacher);
      setFormMonth(selectedMonth);
      setFormSyllabus(26);
      setFormTest(21);
      setFormAttendance(14);
      setFormHomework(14);
      setFormPunctuality(14);
      setFormRemarks('');
    }
    setIsModalOpen(true);
  };

  // 1-Click Auto-Calculation from App Database for Modal
  const handleRunAutoCalculationForModal = () => {
    const teacher = teachers.find((t) => t.User_ID === formTeacherId) || teachers[0];
    if (!teacher) return;
    const res = autoCalculateTeacherMonthlyScoreFromAppData({
      teacher,
      month: formMonth,
      homeworkList,
      homeworkTrackerList,
      staffAttendanceList,
      behaviorList,
      students,
      syllabusTopics: effectiveSyllabusTopics,
      weeklyTests: effectiveWeeklyTests,
      classMap,
      evaluatedBy: managerName,
    });
    setFormSyllabus(res.record.syllabus_progress_score);
    setFormTest(res.record.student_test_score);
    setFormAttendance(res.record.attendance_logging_score);
    setFormHomework(res.record.homework_evaluation_score);
    setFormPunctuality(res.record.punctuality_discipline_score);
    setFormRemarks(res.record.remarks || '');
    setAutoBreakdown(res.breakdown);
    setSyncStatus(`🤖 ${teacher.Name} के लिए ऐप डेटा से सभी 5 पैरामीटर ऑटो-कैलकुलेट हो गए!`);
    setTimeout(() => setSyncStatus(null), 4500);
  };

  // 1-Click Auto-Evaluate ALL teachers in school for selected month
  const handleAutoEvaluateAllTeachers = async () => {
    if (teachers.length === 0) return;
    setIsAutoCalculatingAll(true);
    try {
      const updated = autoEvaluateAllTeachersForMonth({
        teachers,
        month: selectedMonth,
        homeworkList,
        homeworkTrackerList,
        staffAttendanceList,
        behaviorList,
        students,
        syllabusTopics: effectiveSyllabusTopics,
        weeklyTests: effectiveWeeklyTests,
        classMap,
        evaluatedBy: managerName,
      });

      // Merge with existing records of other months
      const existingOtherMonths = records.filter((r) => r.month !== selectedMonth);
      const newAll = [...updated, ...existingOtherMonths];
      setRecords(newAll);
      saveLocalPerformanceRecords(newAll);

      // Sequential sync to server API -> Google Sheet (prevents Apps Script concurrent appendRow drops)
      let syncedCount = 0;
      let firstSheetError = '';
      for (const rec of updated) {
        const res = await syncPerformanceRecordToApi(rec);
        if (res.sheetSynced) syncedCount++;
        else if (!firstSheetError && res.sheetError) firstSheetError = res.sheetError;
      }

      if (syncedCount === updated.length) {
        setSyncStatus(`⚡ शाबाश! ${updated.length} शिक्षकों का ${selectedMonth} हेतु ऑटो-मूल्यांकन Google Sheet में भी सुरक्षित हो गया!`);
        setTimeout(() => setSyncStatus(null), 5000);
      } else {
        setSyncStatus(`⚠️ ${updated.length} शिक्षकों की गणना ऐप में हो गई, लेकिन Google Sheet में नहीं गया (${firstSheetError || 'Code.gs doPost अपडेट करें'})`);
        setTimeout(() => setSyncStatus(null), 9000);
      }
    } catch (err) {
      console.error('Error auto evaluating teachers:', err);
    } finally {
      setIsAutoCalculatingAll(false);
    }
  };

  // Save Evaluation
  const handleSaveEvaluation = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedTeacherObj = teachers.find((t) => t.User_ID === formTeacherId) || teachers[0];
    const teacherName = selectedTeacherObj?.Name || 'शिक्षक';
    const assignedClass = selectedTeacherObj?.Assigned_Class || '';

    const newRecord: TeacherPerformanceRecord = {
      id: editingRecord?.id || `tp_${formMonth.replace('-', '_')}_${formTeacherId}`,
      teacher_id: formTeacherId,
      teacher_name: teacherName,
      assigned_class: assignedClass,
      month: formMonth,
      academic_year: CURRENT_ACADEMIC_YEAR,
      syllabus_progress_score: Number(formSyllabus),
      student_test_score: Number(formTest),
      attendance_logging_score: Number(formAttendance),
      homework_evaluation_score: Number(formHomework),
      punctuality_discipline_score: Number(formPunctuality),
      monthly_total_score: liveScore.totalScore,
      grade: liveScore.grade,
      evaluation_date: getLocalDateYMD(),
      evaluated_by: managerName,
      remarks: formRemarks,
      timestamp: getLocalTimestamp(),
    };

    setSyncStatus('Google Sheet में सिंक किया जा रहा है...');
    const result = await syncPerformanceRecordToApi(newRecord);

    setRecords((prev) => {
      const idx = prev.findIndex((r) => r.id === newRecord.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newRecord;
        return copy;
      }
      return [newRecord, ...prev];
    });

    setSyncStatus(result.message || '✅ सुरक्षित हो गया!');
    setTimeout(() => {
      setIsModalOpen(false);
    }, result.sheetSynced === false ? 1800 : 1200);
    setTimeout(() => {
      setSyncStatus(null);
    }, result.sheetSynced === false ? 9000 : 4000);
  };

  // Complete 2-Way Google Apps Script Snippet (doGet + doPost for all 3 Tabs)
  const appsScriptCode = `// ============================================================
// E.V.S. PUBLIC SCHOOL - 3 TABS 2-WAY SYNC (READ + WRITE + DELETE)
// 1) अपने Code.gs में function doGet(e) के अंदर यह जोड़ें:
// ============================================================
/*
  if (action === "getTeacherPerformance") return handleGetTeacherPerformance(ss);
  if (action === "getSyllabusTracker") return handleGetSyllabusTracker(ss);
  if (action === "getSchoolHolidays") return handleGetSchoolHolidays(ss);
  if (action === "saveTeacherPerformance" || action === "saveSyllabusTopic" || action === "saveSchoolHoliday" || action === "deleteSyllabusTopic" || action === "deleteSchoolHoliday") {
    return doPost(e);
  }
*/

// ============================================================
// 2) अपने Code.gs में function doPost(e) के अंदर यह जोड़ें
// ⚠️ ध्यान दें: इसे "Unknown action" वाले return से ठीक ऊपर पेस्ट करें!
// ============================================================
/*
  if (action === "saveTeacherPerformance") return handleSaveTeacherPerformance(ss, data);
  if (action === "saveSyllabusTopic") return handleSaveSyllabusTopic(ss, data);
  if (action === "deleteSyllabusTopic") return handleDeleteRowById(ss, "Syllabus_Tracker", data.id);
  if (action === "saveSchoolHoliday") return handleSaveSchoolHoliday(ss, data);
  if (action === "deleteSchoolHoliday") return handleDeleteRowById(ss, "School_Holidays", data.id);
*/

// ============================================================
// 3) नीचे दिए सभी फंक्शन्स Code.gs के सबसे नीचे पेस्ट करें:
// (School_Holidays अपने आप Date/Title कॉलम क्रम पहचान लेगा)
// ============================================================

function formatCellMonth_(val) {
  if (!val) return "";
  if (Object.prototype.toString.call(val) === "[object Date]") {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "Asia/Kolkata", "yyyy-MM");
  }
  var s = String(val).trim();
  return s.length >= 7 ? s.slice(0, 7) : s;
}

function formatCellDate_(val) {
  if (!val) return "";
  if (Object.prototype.toString.call(val) === "[object Date]") {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || "Asia/Kolkata", "yyyy-MM-dd");
  }
  var s = String(val).trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function isHolidayDateFirst_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() < 1 || lastCol < 4) return false;
  var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var colB = String(hdr[1] || "").toLowerCase();
  return colB.indexOf("date") !== -1;
}

function handleGetTeacherPerformance(ss) {
  var sheet = ss.getSheetByName("Teacher_Performance");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: "success", records: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  var rows = sheet.getDataRange().getValues();
  var records = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] && !r[1]) continue;
    records.push({
      id: String(r[0] || ("tp_" + i)),
      teacher_id: String(r[1] || ""),
      teacher_name: String(r[2] || ""),
      assigned_class: String(r[3] || ""),
      month: formatCellMonth_(r[4]),
      academic_year: String(r[5] || "2026-2027"),
      syllabus_progress_score: Number(r[6] || 0),
      student_test_score: Number(r[7] || 0),
      attendance_logging_score: Number(r[8] || 0),
      homework_evaluation_score: Number(r[9] || 0),
      punctuality_discipline_score: Number(r[10] || 0),
      monthly_total_score: Number(r[11] || 0),
      grade: String(r[12] || "B"),
      evaluated_by: String(r[13] || "Principal / Manager"),
      remarks: String(r[14] || ""),
      timestamp: String(r[15] || "")
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "success", records: records })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetSyllabusTracker(ss) {
  var sheet = ss.getSheetByName("Syllabus_Tracker");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: "success", topics: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  var rows = sheet.getDataRange().getValues();
  var topics = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0] && !r[8] && !r[9]) continue;
    topics.push({
      id: String(r[0] || ("syl_" + i)),
      teacher_id: String(r[1] || ""),
      teacher_name: String(r[2] || ""),
      class_name: String(r[3] || ""),
      subject: String(r[4] || ""),
      month: formatCellMonth_(r[5]),
      week_number: Number(r[6] || 1),
      week_label: String(r[7] || ""),
      chapter_title: String(r[8] || ""),
      topic_description: String(r[9] || ""),
      planned_date: formatCellDate_(r[10]),
      target_completion_date: formatCellDate_(r[11]),
      completed_date: formatCellDate_(r[12]),
      status: String(r[13] || "Pending"),
      timestamp: String(r[14] || "")
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "success", topics: topics })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetSchoolHolidays(ss) {
  var sheet = ss.getSheetByName("School_Holidays");
  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({ status: "success", holidays: [] })).setMimeType(ContentService.MimeType.JSON);
  }
  var rows = sheet.getDataRange().getValues();
  var dateFirst = isHolidayDateFirst_(sheet);
  var holidays = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[1] && !r[2]) continue;
    holidays.push({
      id: String(r[0] || ("hol_" + i)),
      title: String((dateFirst ? r[3] : r[1]) || ""),
      date: formatCellDate_(dateFirst ? r[1] : r[2]),
      end_date: formatCellDate_(dateFirst ? r[2] : r[3]),
      category: String(r[4] || "festival"),
      description: String(r[5] || ""),
      timestamp: String(r[6] || "")
    });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "success", holidays: holidays })).setMimeType(ContentService.MimeType.JSON);
}

function handleSaveTeacherPerformance(ss, data) {
  var sheet = ss.getSheetByName("Teacher_Performance");
  if (!sheet) {
    sheet = ss.insertSheet("Teacher_Performance");
    sheet.appendRow([
      "Record_ID", "Teacher_ID", "Teacher_Name", "Assigned_Class",
      "Month", "Academic_Year", "Syllabus_Score_30", "Test_Score_25",
      "Attendance_Score_15", "Homework_Score_15", "Punctuality_Score_15",
      "Total_Score_100", "Grade", "Evaluated_By", "Remarks", "Timestamp"
    ]);
  }
  var rec = data.record ? (typeof data.record === "string" ? JSON.parse(data.record) : data.record) : data;
  var recordId = String(rec.id || ("tp_" + rec.month + "_" + rec.teacher_id));
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === recordId || (String(rows[i][1]) === String(rec.teacher_id) && formatCellMonth_(rows[i][4]) === String(rec.month))) {
      rowIndex = i + 1;
      break;
    }
  }
  var rowData = [
    recordId, rec.teacher_id || "", rec.teacher_name || "", rec.assigned_class || "",
    "'" + String(rec.month || ""), rec.academic_year || "2026-2027",
    Number(rec.syllabus_progress_score || 0), Number(rec.student_test_score || 0),
    Number(rec.attendance_logging_score || 0), Number(rec.homework_evaluation_score || 0),
    Number(rec.punctuality_discipline_score || 0), Number(rec.monthly_total_score || 0),
    rec.grade || "B", rec.evaluated_by || "Principal / Manager", rec.remarks || "", new Date()
  ];
  if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  else sheet.appendRow(rowData);
  return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Teacher performance saved!" })).setMimeType(ContentService.MimeType.JSON);
}

function handleSaveSyllabusTopic(ss, data) {
  var sheet = ss.getSheetByName("Syllabus_Tracker");
  if (!sheet) {
    sheet = ss.insertSheet("Syllabus_Tracker");
    sheet.appendRow([
      "ID", "Teacher_ID", "Teacher_Name", "Class", "Subject",
      "Month", "Week_Number", "Week_Label", "Chapter_Title", "Topic_Description",
      "Planned_Date", "Target_Completion_Date", "Completed_Date", "Status", "Timestamp"
    ]);
  }
  var t = data.topic ? (typeof data.topic === "string" ? JSON.parse(data.topic) : data.topic) : data;
  var topicId = String(t.id || ("syl_" + Date.now()));
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === topicId) { rowIndex = i + 1; break; }
  }
  var rowData = [
    topicId, t.teacher_id || "", t.teacher_name || "", t.class_name || "", t.subject || "",
    "'" + String(t.month || ""), Number(t.week_number || 1), t.week_label || "",
    t.chapter_title || "", t.topic_description || "", t.planned_date || "",
    t.target_completion_date || "", t.completed_date || "", t.status || "Pending", new Date()
  ];
  if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  else sheet.appendRow(rowData);
  return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Syllabus topic saved!" })).setMimeType(ContentService.MimeType.JSON);
}

function handleSaveSchoolHoliday(ss, data) {
  var sheet = ss.getSheetByName("School_Holidays");
  if (!sheet) {
    sheet = ss.insertSheet("School_Holidays");
    sheet.appendRow(["ID", "Date", "End_Date", "Title", "Category", "Description", "Timestamp"]);
  }
  var h = data.holiday ? (typeof data.holiday === "string" ? JSON.parse(data.holiday) : data.holiday) : data;
  var holId = String(h.id || ("hol_" + Date.now()));
  var dateFirst = isHolidayDateFirst_(sheet);
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === holId) { rowIndex = i + 1; break; }
  }
  var rowData = dateFirst
    ? [holId, "'" + String(h.date || ""), h.end_date ? ("'" + String(h.end_date)) : "", h.title || "", h.category || "festival", h.description || "", new Date()]
    : [holId, h.title || "", "'" + String(h.date || ""), h.end_date ? ("'" + String(h.end_date)) : "", h.category || "festival", h.description || "", new Date()];
  if (rowIndex > 0) sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  else sheet.appendRow(rowData);
  return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Holiday saved!" })).setMimeType(ContentService.MimeType.JSON);
}

function handleDeleteRowById(ss, sheetName, id) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || !id) {
    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  }
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: "success", deleted: id })).setMimeType(ContentService.MimeType.JSON);
}`;

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER BANNER */}
      <div className="no-print bg-gradient-to-r from-[#0c2340] via-[#163a6f] to-[#0c2340] rounded-3xl p-6 sm:p-8 text-white shadow-xl border-2 border-amber-400/40 relative overflow-hidden">
        {/* Background Decorative Crest */}
        <div className="absolute -right-8 -bottom-8 opacity-10 pointer-events-none text-9xl">
          <i className="fa-solid fa-trophy"></i>
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider mb-3 shadow-md">
              <i className="fa-solid fa-crown text-amber-900"></i>
              <span>E.V.S. Academic Excellence System</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
              <span>शिक्षक प्रदर्शन एवं मासिक लीडरबोर्ड</span>
              <span className="text-amber-400 text-xl font-normal hidden sm:inline">|</span>
              <span className="text-amber-300 text-lg font-bold hidden sm:inline">Teacher of the Year</span>
            </h2>
            <p className="text-slate-300 text-sm mt-1.5 max-w-2xl leading-relaxed">
              5 प्रमुख मापदंडों (कुल 100 अंक) पर स्वचालित मासिक मूल्यांकन, लाइव लीडरबोर्ड रैंकिंग और वार्षिक 'Teacher of the Year' चयन प्रणाली। डेटा सीधे Google Sheet में सुरक्षित होता है।
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {!isTeacherView && (
              <>
                <button
                  type="button"
                  onClick={handleAutoEvaluateAllTeachers}
                  disabled={isAutoCalculatingAll}
                  className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold text-sm rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2 border border-emerald-300 transform active:scale-95"
                  title="स्कूल ऐप डेटाबेस (हाजिरी, होमवर्क, QR स्कैन) से सभी शिक्षकों का 1-क्लिक ऑटो-मूल्यांकन करें"
                >
                  <i className={`fa-solid ${isAutoCalculatingAll ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles text-amber-300'}`}></i>
                  <span>{isAutoCalculatingAll ? 'ऑटो-गणना चालू है...' : '⚡ ऐप डेटा से सभी का ऑटो-मूल्यांकन'}</span>
                </button>

                <button
                  onClick={() => handleOpenEvaluationModal()}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-lg shadow-amber-500/25 flex items-center gap-2 transition-all transform active:scale-95 cursor-pointer"
                >
                  <i className="fa-solid fa-plus-circle text-base"></i>
                  <span>नया मासिक मूल्यांकन दर्ज करें</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleSyncPerformanceFromSheet}
              disabled={isRefreshingSheet}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-sm rounded-xl border border-white/20 backdrop-blur-sm flex items-center gap-2 transition-all cursor-pointer disabled:opacity-60"
              title="Google Sheet (Teacher_Performance) से 2-Way सिंक करें"
            >
              <i className={`fa-solid fa-arrows-rotate ${isRefreshingSheet ? 'fa-spin' : 'text-emerald-300'}`}></i>
              <span>{isRefreshingSheet ? 'सिंक...' : 'Sheet सिंक'}</span>
            </button>

            <button
              onClick={() => setActiveTab('annual')}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-sm rounded-xl border border-white/20 backdrop-blur-sm flex items-center gap-2 transition-all cursor-pointer"
            >
              <i className="fa-solid fa-award text-amber-400 text-base"></i>
              <span>Teacher of the Year</span>
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/20 transition-all cursor-pointer"
                title="बंद करें"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            )}
          </div>
        </div>

        {/* 5 Parameters Weightage Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mt-6 pt-5 border-t border-white/15 text-xs">
          <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
            <span className="text-slate-300 block text-[11px]">1. पाठ्यक्रम प्रगति</span>
            <strong className="text-amber-300 text-sm font-black">अधिकतम 30 अंक</strong>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
            <span className="text-slate-300 block text-[11px]">2. छात्र टेस्ट परिणाम</span>
            <strong className="text-amber-300 text-sm font-black">अधिकतम 25 अंक</strong>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
            <span className="text-slate-300 block text-[11px]">3. उपस्थिति व ऐप लॉग्स</span>
            <strong className="text-amber-300 text-sm font-black">अधिकतम 15 अंक</strong>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
            <span className="text-slate-300 block text-[11px]">4. होमवर्क व कॉपी चेकिंग</span>
            <strong className="text-amber-300 text-sm font-black">अधिकतम 15 अंक</strong>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 border border-white/10">
            <span className="text-slate-300 block text-[11px]">5. पाबंदी व अनुशासन</span>
            <strong className="text-amber-300 text-sm font-black">अधिकतम 15 अंक</strong>
          </div>
        </div>
      </div>

      {/* 2. TAB CONTROLS & MONTH SELECTOR */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'leaderboard'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-ranking-star"></i>
            <span>मासिक लीडरबोर्ड</span>
          </button>

          <button
            onClick={() => setActiveTab('report')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'report'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm ring-2 ring-amber-400/50'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-file-chart-column text-sky-500"></i>
            <span>📊 टीचर रिपोर्ट (A4 PDF)</span>
          </button>

          <button
            onClick={() => setActiveTab('annual')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'annual'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-trophy"></i>
            <span>Teacher of the Year</span>
          </button>

          <button
            onClick={() => setActiveTab('records')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'records'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-table-list"></i>
            <span>सभी प्रविष्टियाँ ({records.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('syllabus')}
            className={`px-3 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'syllabus'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm ring-2 ring-amber-400/50'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-book-open-reader text-amber-500"></i>
            <span>वीकली सिलेबस ट्रैकर (30 Pts)</span>
          </button>

          <button
            onClick={() => setActiveTab('weekly_tests')}
            className={`px-3 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'weekly_tests'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm ring-2 ring-amber-400/50'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-file-pen text-emerald-500"></i>
            <span>वीकली विषय टेस्ट (25 Pts)</span>
          </button>

          <button
            onClick={() => setActiveTab('setup')}
            className={`px-3 py-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'setup'
                ? 'bg-[#0c2340] text-amber-400 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fa-solid fa-file-code"></i>
            <span>शीट कोड (Apps Script)</span>
          </button>
        </div>

        {/* Month Selector Dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-500 whitespace-nowrap">
            <i className="fa-regular fa-calendar-check mr-1.5 text-blue-900"></i>
            मूल्यांकन माह:
          </label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-extrabold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-900 cursor-pointer"
          >
            {ACADEMIC_MONTHS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Dashboard Sync Status Banner */}
      {syncStatus && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2.5 animate-fadeIn ${
            syncStatus.includes('⚠️')
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          <i className={`fa-solid ${syncStatus.includes('⚠️') ? 'fa-triangle-exclamation text-amber-600' : 'fa-circle-check text-emerald-600'}`}></i>
          <span>{syncStatus}</span>
        </div>
      )}

      {/* 3. TAB CONTENT */}
      {/* ========================================================================= */}
      {/* TAB 1: MONTHLY LEADERBOARD WITH PODIUM & DETAILED TABLE                   */}
      {/* ========================================================================= */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-6">
          {/* Top 3 Winner Podium View */}
          {monthlySummary.rankings.length >= 2 && (
            <div className="bg-gradient-to-b from-slate-900 via-[#0c2340] to-slate-950 p-6 sm:p-8 rounded-3xl border-2 border-amber-400/40 shadow-xl text-white">
              <div className="text-center mb-6">
                <span className="text-xs uppercase tracking-widest text-amber-400 font-black">
                  ✦ {ACADEMIC_MONTHS.find((m) => m.key === selectedMonth)?.label || selectedMonth} के शीर्ष शिक्षक ✦
                </span>
                <h3 className="text-2xl font-black text-white mt-1">मासिक प्रदर्शन पोडियम (Top 3 Podium)</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end max-w-4xl mx-auto pt-4 pb-2">
                {/* 2nd Place (Silver) */}
                {monthlySummary.rankings[1] && (
                  <div className="order-2 md:order-1 flex flex-col items-center bg-white/5 border border-slate-400/30 rounded-2xl p-5 hover:bg-white/10 transition-all text-center">
                    <div className="w-16 h-16 rounded-full bg-slate-300 text-slate-900 border-4 border-slate-200 flex items-center justify-center font-black text-2xl shadow-lg mb-3">
                      🥈
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-slate-300 text-slate-950 font-black text-[10px] uppercase mb-1">
                      Rank #2 • Silver
                    </span>
                    <h4 className="text-base font-bold text-white">{monthlySummary.rankings[1].teacher_name}</h4>
                    <span className="text-xs text-slate-300">{monthlySummary.rankings[1].assigned_class || 'शिक्षक'}</span>
                    <div className="mt-3 px-3 py-1 bg-white/10 rounded-xl border border-white/10 font-mono text-lg font-black text-amber-300">
                      {monthlySummary.rankings[1].monthly_total_score} <span className="text-xs text-slate-400">/ 100</span>
                    </div>
                  </div>
                )}

                {/* 1st Place (Gold Winner - Elevated Center) */}
                {monthlySummary.rankings[0] && (
                  <div className="order-1 md:order-2 flex flex-col items-center bg-gradient-to-b from-amber-500/20 via-amber-400/10 to-transparent border-2 border-amber-400 rounded-3xl p-6 shadow-2xl text-center transform md:-translate-y-4">
                    <div className="text-3xl mb-1 animate-bounce">👑</div>
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-300 via-amber-400 to-amber-500 text-slate-950 border-4 border-amber-200 flex items-center justify-center font-black text-3xl shadow-xl shadow-amber-500/30 mb-3">
                      🥇
                    </div>
                    <span className="px-3 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wide mb-1.5 shadow-md">
                      माह का सर्वश्रेष्ठ शिक्षक (#1 Gold)
                    </span>
                    <h4 className="text-lg font-extrabold text-amber-200">{monthlySummary.rankings[0].teacher_name}</h4>
                    <span className="text-xs text-slate-200">{monthlySummary.rankings[0].assigned_class || 'शिक्षक'}</span>
                    <div className="mt-3 px-4 py-1.5 bg-amber-400/20 rounded-2xl border border-amber-400/40 font-mono text-2xl font-black text-amber-300">
                      {monthlySummary.rankings[0].monthly_total_score} <span className="text-xs text-slate-300">/ 100</span>
                    </div>
                    <span className="mt-2 text-[11px] text-amber-300/80 font-semibold italic">
                      "{monthlySummary.rankings[0].remarks || 'उत्कृष्ट प्रदर्शन'}"
                    </span>
                  </div>
                )}

                {/* 3rd Place (Bronze) */}
                {monthlySummary.rankings[2] && (
                  <div className="order-3 flex flex-col items-center bg-white/5 border border-amber-700/40 rounded-2xl p-5 hover:bg-white/10 transition-all text-center">
                    <div className="w-16 h-16 rounded-full bg-amber-700 text-amber-100 border-4 border-amber-600 flex items-center justify-center font-black text-2xl shadow-lg mb-3">
                      🥉
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-700 text-amber-100 font-black text-[10px] uppercase mb-1">
                      Rank #3 • Bronze
                    </span>
                    <h4 className="text-base font-bold text-white">{monthlySummary.rankings[2].teacher_name}</h4>
                    <span className="text-xs text-slate-300">{monthlySummary.rankings[2].assigned_class || 'शिक्षक'}</span>
                    <div className="mt-3 px-3 py-1 bg-white/10 rounded-xl border border-white/10 font-mono text-lg font-black text-amber-300">
                      {monthlySummary.rankings[2].monthly_total_score} <span className="text-xs text-slate-400">/ 100</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Full Ranked Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 sm:p-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-list-ol text-blue-900"></i>
                  <span>मासिक स्कोर एवं पैरामीटर विश्लेषण ({selectedMonth})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  कुल {monthlySummary.rankings.length} शिक्षक मूल्यांकित • विद्यालय औसत स्कोर: {monthlySummary.averageSchoolScore}/100
                </p>
              </div>

              {!isTeacherView && (
                <button
                  onClick={() => handleOpenEvaluationModal()}
                  className="px-3.5 py-1.5 bg-[#0c2340] text-amber-400 font-bold text-xs rounded-xl hover:bg-slate-800 transition-all cursor-pointer flex items-center gap-1.5 self-start sm:self-auto"
                >
                  <i className="fa-solid fa-plus"></i>
                  <span>इस माह का स्कोर दर्ज करें</span>
                </button>
              )}
            </div>

            {/* Alert if old cached auto-score shows test > 0 without any Weekly Subject Test */}
            {!isTeacherView &&
              monthlySummary.rankings.some(
                (r) =>
                  r.student_test_score > 0 &&
                  String(r.remarks || '').includes('लाइव ऐप डेटा स्कोर:') &&
                  !effectiveWeeklyTests.some(
                    (wt) =>
                      (wt.month || String(wt.test_date || '').slice(0, 7)) === selectedMonth &&
                      String(wt.teacher_id || '').toLowerCase() === String(r.teacher_id || '').toLowerCase()
                  )
              ) && (
                <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
                  <div className="flex items-start gap-2.5">
                    <i className="fa-solid fa-circle-info text-amber-600 text-base mt-0.5"></i>
                    <div>
                      <strong className="font-black block">
                        पुराने टेस्ट स्कोर को वास्तविक साप्ताहिक विषय टेस्ट (Weekly Subject Test) से रीसेट/अपडेट करें:
                      </strong>
                      <span className="text-amber-900">
                        पिछले ऑटो-मूल्यांकन में टेस्ट अंक व्यवहार/होमवर्क लॉग से जुड़े थे। अब जब तक <strong>वीकली विषय टेस्ट</strong> दर्ज न हो, टेस्ट स्कोर <strong>0</strong> रहेगा।
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAutoEvaluateAllTeachers}
                    disabled={isAutoCalculatingAll}
                    className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs shadow-xs cursor-pointer shrink-0 transition"
                  >
                    {isAutoCalculatingAll ? 'गणना हो रही...' : '🔄 अभी ताज़ा री-कैलकुलेट करें'}
                  </button>
                </div>
              )}

            {monthlySummary.rankings.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-3xl mx-auto mb-3">
                  <i className="fa-regular fa-clipboard"></i>
                </div>
                <h4 className="text-base font-bold text-slate-800">इस माह का कोई मूल्यांकन नहीं मिला</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 mb-4">
                  {selectedMonth} के लिए अभी किसी शिक्षक का स्कोर दर्ज नहीं किया गया है।
                </p>
                {!isTeacherView && (
                  <button
                    onClick={() => handleOpenEvaluationModal()}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
                  >
                    + पहला मूल्यांकन दर्ज करें
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-black border-b border-slate-200 uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-4">रैंक</th>
                      <th className="py-3 px-4">शिक्षक का नाम</th>
                      <th className="py-3 px-3 text-center" title="पाठ्यक्रम प्रगति (अधिकतम 30 अंक)">
                        पाठ्यक्रम (30)
                      </th>
                      <th className="py-3 px-3 text-center" title="छात्र टेस्ट परिणाम (अधिकतम 25 अंक)">
                        टेस्ट (25)
                      </th>
                      <th className="py-3 px-3 text-center" title="उपस्थिति व ऐप लॉग्स (अधिकतम 15 अंक)">
                        उपस्थिति (15)
                      </th>
                      <th className="py-3 px-3 text-center" title="होमवर्क व कॉपी चेकिंग (अधिकतम 15 अंक)">
                        होमवर्क (15)
                      </th>
                      <th className="py-3 px-3 text-center" title="पाबंदी व अनुशासन (अधिकतम 15 अंक)">
                        अनुशासन (15)
                      </th>
                      <th className="py-3 px-4 text-center">कुल स्कोर</th>
                      <th className="py-3 px-3 text-center">ग्रेड</th>
                      <th className="py-3 px-4 text-right">कार्य</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthlySummary.rankings.map((rec) => {
                      const isTop1 = rec.rank === 1;
                      const isTop2 = rec.rank === 2;
                      const isTop3 = rec.rank === 3;

                      return (
                        <tr
                          key={rec.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isTop1 ? 'bg-amber-50/40 font-semibold' : ''
                          }`}
                        >
                          {/* Rank Badge */}
                          <td className="py-3.5 px-4 font-black">
                            <span
                              className={`w-7 h-7 rounded-full inline-flex items-center justify-center font-mono text-xs ${
                                isTop1
                                  ? 'bg-amber-400 text-slate-950 shadow-sm font-extrabold'
                                  : isTop2
                                  ? 'bg-slate-300 text-slate-900 font-bold'
                                  : isTop3
                                  ? 'bg-amber-700 text-white font-bold'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {rec.rank}
                            </span>
                          </td>

                          {/* Teacher Name */}
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                              <span>{rec.teacher_name}</span>
                              {isTop1 && <span className="text-amber-500 text-xs" title="मासिक विजेता">👑</span>}
                            </div>
                            <span className="text-[11px] text-slate-500 block">
                              {rec.assigned_class || 'शिक्षक'} {rec.subject ? `• ${rec.subject}` : ''}
                            </span>
                          </td>

                          {/* Syllabus (30) */}
                          <td className="py-3.5 px-3 text-center">
                            <span className="font-mono font-bold text-slate-800">
                              {rec.syllabus_progress_score}
                            </span>
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mt-1 overflow-hidden">
                              <div
                                className="h-full bg-blue-600 rounded-full"
                                style={{ width: `${(rec.syllabus_progress_score / 30) * 100}%` }}
                              ></div>
                            </div>
                          </td>

                          {/* Test (25) */}
                          <td className="py-3.5 px-3 text-center">
                            <span className="font-mono font-bold text-slate-800">
                              {rec.student_test_score}
                            </span>
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mt-1 overflow-hidden">
                              <div
                                className="h-full bg-emerald-600 rounded-full"
                                style={{ width: `${(rec.student_test_score / 25) * 100}%` }}
                              ></div>
                            </div>
                          </td>

                          {/* Attendance (15) */}
                          <td className="py-3.5 px-3 text-center">
                            <span className="font-mono font-bold text-slate-800">
                              {rec.attendance_logging_score}
                            </span>
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mt-1 overflow-hidden">
                              <div
                                className="h-full bg-violet-600 rounded-full"
                                style={{ width: `${(rec.attendance_logging_score / 15) * 100}%` }}
                              ></div>
                            </div>
                          </td>

                          {/* Homework (15) */}
                          <td className="py-3.5 px-3 text-center">
                            <span className="font-mono font-bold text-slate-800">
                              {rec.homework_evaluation_score}
                            </span>
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mt-1 overflow-hidden">
                              <div
                                className="h-full bg-amber-600 rounded-full"
                                style={{ width: `${(rec.homework_evaluation_score / 15) * 100}%` }}
                              ></div>
                            </div>
                          </td>

                          {/* Discipline (15) */}
                          <td className="py-3.5 px-3 text-center">
                            <span className="font-mono font-bold text-slate-800">
                              {rec.punctuality_discipline_score}
                            </span>
                            <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mt-1 overflow-hidden">
                              <div
                                className="h-full bg-teal-600 rounded-full"
                                style={{ width: `${(rec.punctuality_discipline_score / 15) * 100}%` }}
                              ></div>
                            </div>
                          </td>

                          {/* Total Score (100) */}
                          <td className="py-3.5 px-4 text-center">
                            <span className="font-mono text-base font-black text-blue-950">
                              {rec.monthly_total_score}
                            </span>
                            <span className="text-[10px] text-slate-400 block font-normal">/ 100</span>
                          </td>

                          {/* Grade */}
                          <td className="py-3.5 px-3 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-md text-[11px] font-black uppercase inline-block ${
                                rec.grade === 'A+'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : rec.grade === 'A'
                                  ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                  : rec.grade === 'B'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-rose-100 text-rose-800 border border-rose-300'
                              }`}
                            >
                              {rec.grade}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {(!isTeacherView ||
                                String(rec.teacher_id || '').toLowerCase() === String(loggedTeacherId || '').toLowerCase()) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedReportTeacherId(rec.teacher_id);
                                    setActiveTab('report');
                                  }}
                                  className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                  title="Teacher Performance Report व A4 PDF खोलें"
                                >
                                  📊 रिपोर्ट
                                </button>
                              )}

                              <button
                                onClick={() => setCertificateRecord(rec)}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold transition-all cursor-pointer"
                                title="सर्टिफिकेट देखें"
                              >
                                📜 प्रमाणपत्र
                              </button>

                              {!isTeacherView && (
                                <button
                                  onClick={() => handleOpenEvaluationModal(rec)}
                                  className="p-1.5 hover:bg-slate-200 text-slate-600 hover:text-slate-900 rounded-lg transition-all cursor-pointer"
                                  title="एडिट करें"
                                >
                                  <i className="fa-solid fa-pen-to-square"></i>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TEACHER OF THE YEAR (ANNUAL SELECTION ENGINE)                      */}
      {/* ========================================================================= */}
      {activeTab === 'annual' && (
        <div className="space-y-6">
          {annualSummary.winner ? (
            <div className="bg-gradient-to-br from-amber-50 via-yellow-100/50 to-amber-100 p-8 sm:p-10 rounded-3xl border-3 border-amber-400 shadow-2xl relative overflow-hidden">
              {/* Background celebration confetti graphics */}
              <div className="absolute right-4 top-4 text-7xl opacity-20 pointer-events-none">
                🏆
              </div>

              <div className="max-w-3xl mx-auto text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 text-white font-black text-xs uppercase tracking-widest shadow-md">
                  <span>👑 E.V.S. PUBLIC SCHOOL ANNUAL HONOUR 👑</span>
                </div>

                <h3 className="text-3xl sm:text-4xl font-extrabold text-[#0c2340] tracking-tight">
                  TEACHER OF THE YEAR {CURRENT_ACADEMIC_YEAR}
                </h3>
                <p className="text-sm text-slate-700 max-w-xl mx-auto font-medium">
                  पूरे शैक्षणिक सत्र (12 माह) में निरंतर सर्वोच्च औसत स्कोर, अनुकरणीय अनुशासन और छात्रों की शैक्षणिक प्रगति के आधार पर स्वचालित रूप से चयनित:
                </p>

                {/* Winner Card Centerpiece */}
                <div className="bg-white/90 backdrop-blur-md p-6 sm:p-8 rounded-3xl border-2 border-amber-300 shadow-xl max-w-lg mx-auto mt-6">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-amber-400 via-amber-300 to-yellow-200 border-4 border-amber-400 flex items-center justify-center text-4xl shadow-xl mx-auto mb-4">
                    🥇
                  </div>

                  <h4 className="text-2xl font-black text-slate-900">{annualSummary.winner.teacher_name}</h4>
                  <p className="text-sm font-bold text-blue-900 mt-0.5">
                    {annualSummary.winner.assigned_class || 'वरिष्ठ शिक्षक'}
                  </p>

                  <div className="grid grid-cols-2 gap-3 mt-6 text-left">
                    <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200">
                      <span className="text-[11px] text-slate-600 font-bold block">वार्षिक औसत स्कोर</span>
                      <strong className="text-2xl font-black text-blue-950 font-mono">
                        {annualSummary.winner.annualAverageScore} <span className="text-xs text-slate-500">/ 100</span>
                      </strong>
                    </div>

                    <div className="bg-amber-50 p-3 rounded-2xl border border-amber-200">
                      <span className="text-[11px] text-slate-600 font-bold block">मूल्यांकित कुल माह</span>
                      <strong className="text-2xl font-black text-emerald-700 font-mono">
                        {annualSummary.winner.totalMonthsEvaluated} माह
                      </strong>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                      <span className="text-[11px] text-slate-600 font-bold block">सर्वोच्च मासिक स्कोर</span>
                      <strong className="text-lg font-black text-amber-700 font-mono">
                        {annualSummary.winner.highestMonthScore}/100
                      </strong>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200">
                      <span className="text-[11px] text-slate-600 font-bold block">स्थिरता रेटिंग (Consistency)</span>
                      <strong className="text-xs font-black text-emerald-800 block mt-1">
                        {annualSummary.winner.consistencyRating}
                      </strong>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => setCertificateRecord(annualSummary.winner!.records[0])}
                      className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
                    >
                      <i className="fa-solid fa-award"></i>
                      <span>प्रशस्ति पत्र (Award Certificate) प्रिंट करें</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedReportTeacherId(annualSummary.winner!.teacher_id);
                        setActiveTab('report');
                      }}
                      className="px-5 py-2.5 bg-[#0c2340] hover:bg-slate-800 text-amber-300 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2"
                    >
                      <i className="fa-solid fa-file-chart-column"></i>
                      <span>📊 Performance Report / A4 PDF</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white p-12 text-center rounded-3xl border border-slate-200">
              <i className="fa-solid fa-trophy text-4xl text-slate-300 mb-3"></i>
              <h4 className="text-base font-bold text-slate-800">वार्षिक डेटा अभी पर्याप्त नहीं है</h4>
              <p className="text-xs text-slate-500 mt-1">
                कम से कम एक शिक्षक का मासिक मूल्यांकन दर्ज करने के बाद वार्षिक 'Teacher of the Year' रैंकिंग सक्रिय हो जाएगी।
              </p>
            </div>
          )}

          {/* Annual Standings Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6">
            <h3 className="text-base font-black text-slate-900 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-award text-amber-600"></i>
              <span>वार्षिक रैंकिंग एवं औसत स्कोर तालिका ({CURRENT_ACADEMIC_YEAR})</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-black border-b border-slate-200 uppercase text-[10px] tracking-wider">
                    <th className="py-3 px-4">वार्षिक रैंक</th>
                    <th className="py-3 px-4">शिक्षक का नाम</th>
                    <th className="py-3 px-3 text-center">कक्षा</th>
                    <th className="py-3 px-3 text-center">मूल्यांकित माह</th>
                    <th className="py-3 px-3 text-center">वार्षिक औसत स्कोर (100)</th>
                    <th className="py-3 px-3 text-center">ग्रेड</th>
                    <th className="py-3 px-4 text-center">स्थिरता रेटिंग</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {annualSummary.allAnnualRankings.map((item) => (
                    <tr key={item.teacher_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-black">
                        <span
                          className={`w-7 h-7 rounded-full inline-flex items-center justify-center font-mono text-xs ${
                            item.rank === 1
                              ? 'bg-amber-400 text-slate-950 font-black shadow-sm'
                              : 'bg-slate-100 text-slate-700 font-bold'
                          }`}
                        >
                          {item.rank === 1 ? '👑 1' : item.rank}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900 text-sm">
                        {item.teacher_name}
                      </td>
                      <td className="py-3.5 px-3 text-center text-slate-600">
                        {item.assigned_class || '—'}
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono font-bold text-slate-700">
                        {item.totalMonthsEvaluated} माह
                      </td>
                      <td className="py-3.5 px-3 text-center font-mono text-base font-black text-blue-900">
                        {item.annualAverageScore}
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-blue-100 text-blue-800">
                          {item.grade}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center text-emerald-700 font-bold text-[11px]">
                        {item.consistencyRating}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: ALL RECORDS ARCHIVE                                                */}
      {/* ========================================================================= */}
      {activeTab === 'records' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <i className="fa-solid fa-database text-blue-900"></i>
              <span>सभी दर्ज मासिक प्रविष्टियाँ ({records.length})</span>
            </h3>

            {!isTeacherView && (
              <button
                onClick={() => handleOpenEvaluationModal()}
                className="px-3.5 py-1.5 bg-[#0c2340] text-amber-400 font-bold text-xs rounded-xl hover:bg-slate-800 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <i className="fa-solid fa-plus"></i>
                <span>नई प्रविष्टि</span>
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-black border-b border-slate-200 uppercase text-[10px]">
                  <th className="py-2.5 px-3">माह</th>
                  <th className="py-2.5 px-3">शिक्षक</th>
                  <th className="py-2.5 px-3 text-center">पाठ्यक्रम (30)</th>
                  <th className="py-2.5 px-3 text-center">टेस्ट (25)</th>
                  <th className="py-2.5 px-3 text-center">उपस्थिति (15)</th>
                  <th className="py-2.5 px-3 text-center">होमवर्क (15)</th>
                  <th className="py-2.5 px-3 text-center">अनुशासन (15)</th>
                  <th className="py-2.5 px-3 text-center">कुल (100)</th>
                  <th className="py-2.5 px-3 text-center">ग्रेड</th>
                  <th className="py-2.5 px-3">मूल्यांकनकर्ता</th>
                  <th className="py-2.5 px-3 text-right">कार्य</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-blue-900">{r.month}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-800">{r.teacher_name}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{r.syllabus_progress_score}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{r.student_test_score}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{r.attendance_logging_score}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{r.homework_evaluation_score}</td>
                    <td className="py-2.5 px-3 text-center font-mono">{r.punctuality_discipline_score}</td>
                    <td className="py-2.5 px-3 text-center font-mono font-black text-blue-950 text-sm">
                      {r.monthly_total_score}
                    </td>
                    <td className="py-2.5 px-3 text-center font-bold">{r.grade}</td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px]">{r.evaluated_by}</td>
                    <td className="py-2.5 px-3 text-right">
                      {!isTeacherView && (
                        <button
                          onClick={() => handleOpenEvaluationModal(r)}
                          className="text-blue-900 hover:text-blue-700 font-bold cursor-pointer"
                        >
                          एडिट
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: TEACHER WEEKLY SYLLABUS PLANNER & TRACKER                          */}
      {/* ========================================================================= */}
      {activeTab === 'syllabus' && (
        <TeacherSyllabusPlanner
          allTeachers={teachers}
          currentUser={teachers.find(
            (t) =>
              (loggedTeacherId && (String(t.User_ID) === String(loggedTeacherId) || String(t.Username) === String(loggedTeacherId)))
          )}
          isManager={!isTeacherView}
          onSyllabusUpdated={(updated) => setLoadedSyllabusTopics(updated)}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB 4B: WEEKLY SUBJECT TEST MANAGER (25 POINTS REAL TEST ENGINE)          */}
      {/* ========================================================================= */}
      {activeTab === 'weekly_tests' && (
        <WeeklySubjectTestManager
          allTeachers={teachers}
          students={students}
          classMap={classMap}
          currentUser={teachers.find(
            (t) =>
              (loggedTeacherId && (String(t.User_ID) === String(loggedTeacherId) || String(t.Username) === String(loggedTeacherId)))
          )}
          isManager={!isTeacherView}
          onTestsUpdated={(updated) => setLoadedWeeklyTests(updated)}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB 4C: TEACHER PERFORMANCE REPORT (A4 LANDSCAPE PRINT / PDF)            */}
      {/* ========================================================================= */}
      {activeTab === 'report' && (
        <TeacherPerformanceReportView
          teachers={
            isTeacherView && loggedTeacherId
              ? teachers.filter(
                  (t) =>
                    String(t.User_ID || '').toLowerCase() === String(loggedTeacherId).toLowerCase() ||
                    String(t.Username || '').toLowerCase() === String(loggedTeacherId).toLowerCase() ||
                    String(t.Name || '').toLowerCase() === String(loggedTeacherId).toLowerCase()
                )
              : teachers
          }
          selectedTeacherId={
            isTeacherView && loggedTeacherId ? String(loggedTeacherId) : selectedReportTeacherId
          }
          onSelectTeacherId={(id) => setSelectedReportTeacherId(id)}
          isTeacherView={isTeacherView}
          students={students}
          examMarks={effectiveExamMarks}
          pendingMarks={effectivePendingMarks}
          weeklyTests={effectiveWeeklyTests}
          staffAttendance={staffAttendanceList}
          behaviorList={behaviorList}
          reportCardMeta={effectiveReportCardMeta}
          classMap={classMap}
        />
      )}

      {/* ========================================================================= */}
      {/* TAB 5: GOOGLE SHEET & APPS SCRIPT SETUP GUIDE                             */}
      {/* ========================================================================= */}
      {activeTab === 'setup' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div>
            <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2.5">
              <i className="fa-solid fa-file-code text-blue-900"></i>
              <span>Google Sheet 'Teacher_Performance' टैब व Apps Script सेटअप</span>
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              इस सिस्टम का डेटा आपकी गूगल स्प्रेडशीट में पूरी तरह स्वचालित रूप से सुरक्षित होता है।
            </p>
          </div>

          {/* 1-Click Complete Merged Code.gs Card */}
          <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border-2 border-emerald-300 rounded-2xl p-5 space-y-3 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider mb-1.5">
                  ✅ 100% तैयार पूरा कोड (All Functions Safe)
                </span>
                <h4 className="text-base font-black text-emerald-950">
                  आपका पूरा अपडेटेड Code.gs (सभी लेटेस्ट मॉड्यूल्स सहित — बिना किसी पुराने फंक्शन को छेड़े)
                </h4>
                <p className="text-xs text-emerald-900 mt-0.5">
                  इसे कॉपी करके Apps Script के <strong>Code.gs</strong> में पूरा बदल दें (<code>Ctrl+A</code> → <code>Ctrl+V</code> → <code>Ctrl+S</code>) और फिर <strong>Deploy → Manage deployments → Edit → New version → Deploy</strong> करें।
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  type="button"
                  disabled={fullCodeLoading}
                  onClick={async () => {
                    setFullCodeLoading(true);
                    try {
                      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
                      setCopiedFullCode(true);
                      setTimeout(() => setCopiedFullCode(false), 4000);
                    } catch {
                      setSyncStatus('⚠️ कृपया "फाइल डाउनलोड करें" बटन से Code.gs फाइल डाउनलोड करें।');
                      setTimeout(() => setSyncStatus(null), 5000);
                    } finally {
                      setFullCodeLoading(false);
                    }
                  }}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black shadow-md transition-all cursor-pointer flex items-center gap-2 disabled:opacity-60"
                >
                  <i className={`fa-solid ${copiedFullCode ? 'fa-check' : fullCodeLoading ? 'fa-spinner fa-spin' : 'fa-copy'}`}></i>
                  <span>{copiedFullCode ? '✅ पूरा Code.gs कॉपी हो गया!' : 'पूरा Code.gs कॉपी करें'}</span>
                </button>
                <a
                  href="/EVS_Complete_Code.gs.txt"
                  download="EVS_Code_gs.txt"
                  className="px-4 py-2.5 bg-white hover:bg-slate-50 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-bold shadow-xs transition-all flex items-center gap-2"
                >
                  <i className="fa-solid fa-download"></i>
                  <span>फाइल डाउनलोड करें</span>
                </a>
              </div>
            </div>
          </div>

          {/* Schema Information Table */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
            <h4 className="text-sm font-black text-slate-900">📋 Google Sheet टैब का नाम: Teacher_Performance</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">1. Record_ID</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">2. Teacher_ID</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">3. Teacher_Name</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">4. Assigned_Class</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">5. Month</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">6. Academic_Year</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">7. Syllabus_Score_30</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">8. Test_Score_25</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">9. Attendance_Score_15</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">10. Homework_Score_15</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">11. Punctuality_Score_15</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">12. Total_Score_100</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">13. Grade</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">14. Evaluated_By</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">15. Remarks</div>
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 font-mono">16. Timestamp</div>
            </div>
          </div>

          {/* Copyable Apps Script Code Block */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700">Apps Script Code (Copy & Paste):</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(appsScriptCode);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2500);
                }}
                className="px-3 py-1 bg-blue-900 hover:bg-blue-800 text-white rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <i className={`fa-solid ${copiedCode ? 'fa-check text-emerald-400' : 'fa-copy'}`}></i>
                <span>{copiedCode ? 'कॉपी हो गया!' : 'कोड कॉपी करें'}</span>
              </button>
            </div>
            <pre className="bg-slate-900 text-amber-300 p-4 rounded-2xl text-xs font-mono overflow-x-auto max-h-96 leading-relaxed border border-slate-800">
              {appsScriptCode}
            </pre>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. EVALUATION ENTRY / EDIT MODAL                                          */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border-2 border-amber-400 overflow-hidden my-auto max-h-[92vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-[#0c2340] to-[#163a6f] text-white p-5 sm:p-6 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                  {editingRecord ? '✏️ मूल्यांकन संशोधित करें' : '➕ नया शिक्षक मूल्यांकन'}
                </span>
                <h3 className="text-lg sm:text-xl font-extrabold text-white">
                  5-पैरामीटर प्रदर्शन मूल्यांकन प्रविष्टि
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-all shrink-0"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEvaluation} className="p-5 sm:p-6 space-y-5 flex-1 overflow-y-auto">
              {/* Teacher & Month Selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    शिक्षक का चयन करें (Teacher):
                  </label>
                  <select
                    value={formTeacherId}
                    onChange={(e) => setFormTeacherId(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-900 cursor-pointer"
                  >
                    {teachers.map((t) => (
                      <option key={t.User_ID} value={t.User_ID}>
                        {t.Name} ({t.Assigned_Class || 'शिक्षक'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    मूल्यांकन माह (Month):
                  </label>
                  <select
                    value={formMonth}
                    onChange={(e) => setFormMonth(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-900 cursor-pointer"
                  >
                    {ACADEMIC_MONTHS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 1-Click Auto Calculate from App Data Button */}
              <div className="bg-gradient-to-r from-amber-50 to-blue-50 p-3.5 rounded-2xl border border-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center font-black shadow-xs shrink-0">
                    <i className="fa-solid fa-wand-magic-sparkles text-sm"></i>
                  </div>
                  <div>
                    <strong className="text-xs font-black text-slate-800 block">
                      ऐप डेटा से स्वतः स्कोर भरें (Auto-Calculate from App)
                    </strong>
                    <span className="text-[11px] text-slate-600 block leading-tight">
                      स्टाफ QR चेक-इन, छात्र उपस्थिति रजिस्टर, होमवर्क अपलोड व कॉपी चेकिंग से गणना करें
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRunAutoCalculationForModal}
                  className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-blue-900 to-indigo-900 hover:from-blue-800 hover:to-indigo-800 text-amber-300 font-extrabold text-xs rounded-xl shadow-sm transition-all cursor-pointer flex items-center justify-center gap-1.5 shrink-0 border border-amber-400/30"
                >
                  <i className="fa-solid fa-bolt text-amber-400"></i>
                  <span>ऑटो-कैलकुलेट करें</span>
                </button>
              </div>

              {/* Auto Breakdown Details Banner if generated */}
              {autoBreakdown && (
                <div className="bg-emerald-50 border border-emerald-300 p-3.5 rounded-2xl text-[11px] text-emerald-950 space-y-1.5 shadow-xs animate-fadeIn">
                  <div className="font-extrabold flex items-center gap-1.5 text-emerald-900 text-xs">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i>
                    <span>ऐप डेटाबेस विश्लेषण परिणाम (Live App Provenance):</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
                    <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                      <span className="font-bold text-slate-700 block">📚 1. पाठ्यक्रम प्रगति (30)</span>
                      <span className="text-emerald-800">{autoBreakdown.syllabus.detail}</span>
                    </div>
                    <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                      <span className="font-bold text-slate-700 block">📊 2. टेस्ट परिणाम (25)</span>
                      <span className="text-emerald-800">{autoBreakdown.test.detail}</span>
                    </div>
                    <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                      <span className="font-bold text-slate-700 block">📝 3. छात्र हाजिरी लॉग (15)</span>
                      <span className="text-emerald-800">{autoBreakdown.attendance.detail}</span>
                    </div>
                    <div className="bg-white/80 p-2 rounded-lg border border-emerald-200">
                      <span className="font-bold text-slate-700 block">✍️ 4. होमवर्क व कॉपियां (15)</span>
                      <span className="text-emerald-800">{autoBreakdown.homework.detail}</span>
                    </div>
                    <div className="bg-white/80 p-2 rounded-lg border border-emerald-200 sm:col-span-2">
                      <span className="font-bold text-slate-700 block">⏰ 5. QR समयबद्धता व अनुशासन (15)</span>
                      <span className="text-emerald-800">{autoBreakdown.punctuality.detail}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 5 Parameters Input Sliders */}
              <div className="bg-slate-50 p-4 sm:p-5 rounded-2xl border border-slate-200 space-y-4">
                {/* 1. Syllabus Progress */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-extrabold text-slate-800">
                      1. पाठ्यक्रम प्रगति (Syllabus Progress)
                    </span>
                    <span className="font-mono font-black text-blue-900 bg-blue-100 px-2 py-0.5 rounded-md">
                      {formSyllabus} / 30 अंक
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="0.5"
                    value={formSyllabus}
                    onChange={(e) => setFormSyllabus(parseFloat(e.target.value))}
                    className="w-full accent-blue-900 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0 अंक (0% प्रगति)</span>
                    <span>15 अंक (50% प्रगति)</span>
                    <span>30 अंक (100% लक्ष्य पूर्ण)</span>
                  </div>
                </div>

                {/* 2. Student Test Results */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-extrabold text-slate-800">
                      2. छात्र टेस्ट परिणाम (Student Test Results)
                    </span>
                    <span className="font-mono font-black text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-md">
                      {formTest} / 25 अंक
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="25"
                    step="0.5"
                    value={formTest}
                    onChange={(e) => setFormTest(parseFloat(e.target.value))}
                    className="w-full accent-emerald-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0 अंक (कमजोर)</span>
                    <span>12.5 अंक (औसत)</span>
                    <span>25 अंक (सर्वश्रेष्ठ परिणाम)</span>
                  </div>
                </div>

                {/* 3. Student Attendance Logging */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-extrabold text-slate-800">
                      3. छात्र उपस्थिति व ऐप लॉग्स (Student Attendance & App Logs)
                    </span>
                    <span className="font-mono font-black text-violet-900 bg-violet-100 px-2 py-0.5 rounded-md">
                      {formAttendance} / 15 अंक
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="0.5"
                    value={formAttendance}
                    onChange={(e) => setFormAttendance(parseFloat(e.target.value))}
                    className="w-full accent-violet-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0 अंक (अनियमित लॉग)</span>
                    <span>7.5 अंक (सामान्य)</span>
                    <span>15 अंक (शत-प्रतिशत समय पर हाज़िरी)</span>
                  </div>
                </div>

                {/* 4. Homework & Notebook Evaluation */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-extrabold text-slate-800">
                      4. होमवर्क व कॉपी चेकिंग (Homework & Notebook Evaluation)
                    </span>
                    <span className="font-mono font-black text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md">
                      {formHomework} / 15 अंक
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="0.5"
                    value={formHomework}
                    onChange={(e) => setFormHomework(parseFloat(e.target.value))}
                    className="w-full accent-amber-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0 अंक (चेकिंग नहीं)</span>
                    <span>7.5 अंक (साप्ताहिक)</span>
                    <span>15 अंक (दैनिक नियमबद्ध चेकिंग)</span>
                  </div>
                </div>

                {/* 5. Punctuality & Discipline */}
                <div>
                  <div className="flex justify-between items-center text-xs mb-1">
                    <span className="font-extrabold text-slate-800">
                      5. समय की पाबंदी व अनुशासन (Punctuality & Discipline)
                    </span>
                    <span className="font-mono font-black text-teal-900 bg-teal-100 px-2 py-0.5 rounded-md">
                      {formPunctuality} / 15 अंक
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="15"
                    step="0.5"
                    value={formPunctuality}
                    onChange={(e) => setFormPunctuality(parseFloat(e.target.value))}
                    className="w-full accent-teal-600 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>0 अंक (विलंब आगमन)</span>
                    <span>7.5 अंक (संतोषजनक)</span>
                    <span>15 अंक (सदा समय पर व आदर्श अनुशासन)</span>
                  </div>
                </div>
              </div>

              {/* Total Calculated Score Live Display */}
              <div className="bg-gradient-to-r from-slate-900 to-[#0c2340] text-white p-4 rounded-2xl flex items-center justify-between border border-amber-400/50">
                <div>
                  <span className="text-[11px] text-amber-300 font-bold block uppercase tracking-wider">
                    कुल स्वचालित मासिक स्कोर (Monthly Total)
                  </span>
                  <span className="text-2xl font-black font-mono text-white">
                    {liveScore.totalScore} <span className="text-sm text-slate-400 font-normal">/ 100</span>
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-300 block font-bold">निर्धारित ग्रेड:</span>
                  <span
                    className={`px-3 py-1 rounded-lg text-sm font-black uppercase inline-block ${
                      liveScore.grade === 'A+'
                        ? 'bg-emerald-500 text-slate-950 font-extrabold'
                        : liveScore.grade === 'A'
                        ? 'bg-blue-400 text-slate-950 font-bold'
                        : 'bg-amber-400 text-slate-950 font-bold'
                    }`}
                  >
                    Grade {liveScore.grade}
                  </span>
                </div>
              </div>

              {/* Remarks */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  प्रबंधक / प्रधानाचार्य रिमार्क (Remarks / Feedback):
                </label>
                <textarea
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  placeholder="शिक्षक के प्रदर्शन पर टिप्पणी अथवा सुधार के निर्देश..."
                  rows={2}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-900"
                />
              </div>

              {syncStatus && (
                <div className="p-3 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold flex items-center gap-2">
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  <span>{syncStatus}</span>
                </div>
              )}

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer transition-all"
                >
                  रद्द करें
                </button>

                <button
                  type="submit"
                  className="px-6 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer transition-all flex items-center gap-2"
                >
                  <i className="fa-solid fa-cloud-arrow-up"></i>
                  <span>स्कोर सुरक्षित करें एवं Google Sheet सिंक करें</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. OFFICIAL CERTIFICATE MODAL (Printable Award)                           */}
      {/* ========================================================================= */}
      {certificateRecord && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border-4 border-amber-400 relative text-center space-y-4 my-auto max-h-[92vh] overflow-y-auto">
            <button
              onClick={() => setCertificateRecord(null)}
              className="absolute right-4 top-4 w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
            >
              ✕
            </button>

            <div className="w-16 h-16 rounded-2xl bg-amber-400 text-[#0c2340] flex items-center justify-center text-3xl mx-auto shadow-lg shadow-amber-400/30">
              🏅
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 block">
                E.V.S. PUBLIC SCHOOL • CHILKANA SULTANPUR
              </span>
              <h3 className="text-2xl font-black text-[#0c2340]">
                शिक्षक प्रदर्शन उत्कृष्टता प्रमाण-पत्र
              </h3>
              <p className="text-xs text-slate-500">Certificate of Academic Excellence</p>
            </div>

            <div className="p-5 bg-amber-50/60 rounded-2xl border border-amber-200 space-y-2 text-xs">
              <p className="text-slate-700">
                यह प्रमाणित किया जाता है कि शिक्षक{' '}
                <strong className="text-base text-blue-950 font-black">{certificateRecord.teacher_name}</strong>{' '}
                ({certificateRecord.assigned_class || 'शिक्षक'}) ने माह{' '}
                <strong className="text-blue-900 font-bold">{certificateRecord.month}</strong> में 5 प्रमुख मापदंडों में
                सराहनीय कार्य करते हुए कुल{' '}
                <strong className="font-mono font-black text-amber-700 text-sm">
                  {certificateRecord.monthly_total_score}/100
                </strong>{' '}
                अंक एवं ग्रेड <strong className="font-black text-emerald-800">{certificateRecord.grade}</strong> अर्जित किया है।
              </p>
            </div>

            <div className="flex justify-between items-end pt-6 border-t border-slate-200 text-xs">
              <div className="text-left">
                <span className="block text-[10px] text-slate-400">दिनांक:</span>
                <span className="font-bold text-slate-700">{certificateRecord.evaluation_date}</span>
              </div>
              <div className="text-right">
                <div className="h-8 border-b border-slate-400 w-32 mb-1 mx-auto"></div>
                <span className="font-bold text-slate-800 block">प्रधानाचार्य / प्रबंधक</span>
                <span className="text-[10px] text-slate-400 block">ई.वी.एस. पब्लिक स्कूल</span>
              </div>
            </div>

            <button
              onClick={() => window.print()}
              className="w-full py-2.5 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-xl shadow-md cursor-pointer transition-all flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-print"></i>
              <span>सर्टिफिकेट प्रिंट करें (Print Certificate)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherPerformanceDashboard;
