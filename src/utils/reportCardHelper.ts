import {
  ExamMarkRecord,
  ExamTermType,
  ReportCardRemarkRecord,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';

export const EXAM_MARKS_STORAGE_KEY = 'evs_exam_marks_v1';
export const REPORT_CARD_META_STORAGE_KEY = 'evs_report_card_meta_v1';
export const REPORT_CARD_UPDATED_EVENT = 'evs-report-card-updated';
export const CURRENT_ACADEMIC_SESSION = '2026-27';

export const REPORT_CARD_SUBJECTS = [
  'हिन्दी (Hindi)',
  'अंग्रेज़ी (English)',
  'गणित (Mathematics)',
  'विज्ञान (Science)',
  'पर्यावरण अध्ययन (EVS)',
  'सामाजिक विज्ञान (Social Studies)',
  'उर्दू / अरबी (Urdu / Arabic)',
  'कंप्यूटर (Computer)',
  'सामान्य ज्ञान (GK)',
];

export const EXAM_TERM_LABELS: Record<ExamTermType, string> = {
  Quarterly: 'तिमाही परीक्षा (Quarterly Exam)',
  'Half-Yearly': 'छमाही परीक्षा (Half-Yearly Exam)',
  Annual: 'सालाना परीक्षा (Annual Exam)',
};

export const loadLocalExamMarks = (): ExamMarkRecord[] => {
  try {
    const raw = localStorage.getItem(EXAM_MARKS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

export const saveLocalExamMarks = (records: ExamMarkRecord[]) => {
  try {
    localStorage.setItem(EXAM_MARKS_STORAGE_KEY, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent(REPORT_CARD_UPDATED_EVENT, { detail: { type: 'marks', records } }));
  } catch {}
};

export const loadLocalReportCardMeta = (): Record<string, ReportCardRemarkRecord> => {
  try {
    const raw = localStorage.getItem(REPORT_CARD_META_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
};

export const saveLocalReportCardMeta = (map: Record<string, ReportCardRemarkRecord>) => {
  try {
    localStorage.setItem(REPORT_CARD_META_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(REPORT_CARD_UPDATED_EVENT, { detail: { type: 'meta', map } }));
  } catch {}
};

export const fetchExamMarksFromServer = async (forceRefresh = false): Promise<ExamMarkRecord[]> => {
  const activeUrl = getAppsScriptUrl();
  try {
    const res = await fetch(`/api/exam-marks${forceRefresh ? '?refresh=1&' : '?'}_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': activeUrl },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : Array.isArray(data?.marks) ? data.marks : [];
      if (list.length > 0 || !forceRefresh) {
        saveLocalExamMarks(list);
        return list;
      }
    }
  } catch {}

  try {
    const direct = await directGetFromSheet('getExamMarks', activeUrl);
    if (direct.ok) {
      const rows = Array.isArray(direct.json?.marks) ? direct.json.marks : [];
      if (rows.length > 0) {
        saveLocalExamMarks(rows);
        return rows;
      }
    }
  } catch {}

  return loadLocalExamMarks();
};

export const saveExamMarksBatchToServer = async (
  records: ExamMarkRecord[]
): Promise<{ success: boolean; records: ExamMarkRecord[]; sheetSynced: boolean; sheetError?: string }> => {
  const local = loadLocalExamMarks();
  const map = new Map<string, ExamMarkRecord>(local.map((m) => [m.id, m]));
  records.forEach((r) => map.set(r.id, r));
  const merged = Array.from(map.values());
  saveLocalExamMarks(merged);

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-marks',
    apiBody: { records },
    directPayload: {
      action: 'saveExamMarksBatch',
      records: JSON.stringify(records),
    },
  });

  if (Array.isArray(syncRes.data?.allMarks)) {
    saveLocalExamMarks(syncRes.data.allMarks);
    return {
      success: true,
      records: syncRes.data.allMarks,
      sheetSynced: syncRes.sheetSynced,
      sheetError: syncRes.sheetError,
    };
  }

  return {
    success: syncRes.serverOk || syncRes.sheetSynced,
    records: merged,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
};

export const fetchReportCardMetaFromServer = async (
  forceRefresh = false
): Promise<Record<string, ReportCardRemarkRecord>> => {
  const activeUrl = getAppsScriptUrl();
  const local = loadLocalReportCardMeta();
  try {
    const res = await fetch(`/api/report-cards-meta${forceRefresh ? '?refresh=1&' : '?'}_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': activeUrl },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.meta && typeof data.meta === 'object') {
        const merged = { ...local, ...data.meta };
        saveLocalReportCardMeta(merged);
        return merged;
      }
    }
  } catch {}

  try {
    const direct = await directGetFromSheet('getReportCardMeta', activeUrl);
    if (direct.ok && direct.json?.meta && typeof direct.json.meta === 'object') {
      const merged = { ...local, ...direct.json.meta };
      saveLocalReportCardMeta(merged);
      return merged;
    }
  } catch {}

  return local;
};

export const saveReportCardMetaToServer = async (
  meta: ReportCardRemarkRecord
): Promise<{ metaMap: Record<string, ReportCardRemarkRecord>; sheetSynced: boolean; sheetError?: string }> => {
  const local = loadLocalReportCardMeta();
  const next = {
    ...local,
    [meta.reportKey]: {
      ...meta,
      updatedAt: new Date().toISOString(),
    },
  };
  saveLocalReportCardMeta(next);

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/report-cards-meta',
    apiBody: { meta: next[meta.reportKey] },
    directPayload: {
      action: 'saveReportCardMeta',
      meta: next[meta.reportKey],
    },
  });

  if (syncRes.data?.meta && typeof syncRes.data.meta === 'object') {
    saveLocalReportCardMeta(syncRes.data.meta);
    return {
      metaMap: syncRes.data.meta,
      sheetSynced: syncRes.sheetSynced,
      sheetError: syncRes.sheetError,
    };
  }

  return {
    metaMap: next,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
};

export interface ReportCardBackupRow {
  reportKey: string;
  session: string;
  studentId: string;
  studentName: string;
  className: string;
  rollNumber: string;
  weeklyPct: number;
  quarterlyPct: number;
  halfYearlyPct: number;
  annualPct: number;
  overallPct: number;
  grade: string;
  attendancePct: number;
  presentDays: number;
  totalDays: number;
  teacherRemark: string;
  principalRemark: string;
  resultStatus: string;
  publishedToParent: boolean;
  updatedBy: string;
  updatedAt: string;
}

export const syncAllReportCardsBackupToSheet = async (params: {
  backups: ReportCardBackupRow[];
  examMarks: ExamMarkRecord[];
}): Promise<{ serverOk: boolean; sheetSynced: boolean; sheetError?: string }> => {
  const res = await dualSyncWriteToSheet({
    apiPath: '/api/report-cards-backup/sync-all',
    apiBody: params,
    directPayload: {
      action: 'syncReportCardsBatch',
      backups: JSON.stringify(params.backups),
      examMarks: JSON.stringify(params.examMarks),
    },
  });
  return {
    serverOk: res.serverOk,
    sheetSynced: res.sheetSynced,
    sheetError: res.sheetError,
  };
};

export const subscribeReportCardUpdates = (onUpdate: () => void): (() => void) => {
  const handleCustom = () => onUpdate();
  const handleStorage = (e: StorageEvent) => {
    if (e.key === EXAM_MARKS_STORAGE_KEY || e.key === REPORT_CARD_META_STORAGE_KEY) {
      onUpdate();
    }
  };
  window.addEventListener(REPORT_CARD_UPDATED_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  let ws: WebSocket | null = null;
  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}/ws/location`);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (
          msg?.type === 'APP_DATA_UPDATED' &&
          (msg.entity === 'exam_marks' || msg.entity === 'report_card_meta' || msg.entity === 'weekly_tests')
        ) {
          onUpdate();
        }
      } catch {}
    };
  } catch {}

  return () => {
    window.removeEventListener(REPORT_CARD_UPDATED_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
    try {
      ws?.close();
    } catch {}
  };
};

export const normalizeSubjectKey = (subj: string): string => {
  const s = String(subj || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('hindi') || s.includes('हिन्दी') || s.includes('हिंदी')) return 'hindi';
  if (s.includes('english') || s.includes('अंग्रे')) return 'english';
  if (s.includes('math') || s.includes('गणित')) return 'math';
  if (s.includes('evs') || s.includes('पर्यावरण')) return 'evs';
  if (s.includes('social') || s.includes('सामाजिक')) return 'social';
  if (s.includes('science') || s.includes('विज्ञान')) return 'science';
  if (s.includes('urdu') || s.includes('arabic') || s.includes('उर्दू') || s.includes('अरबी')) return 'urdu';
  if (s.includes('comp') || s.includes('कंप्यूटर')) return 'computer';
  if (s.includes('gk') || s.includes('सामान्य ज्ञान') || s.includes('general')) return 'gk';
  return s.replace(/[^a-z0-9\u0900-\u097f]/g, '');
};

export const getGradeFromPercentage = (pct: number): { grade: string; label: string; colorClass: string } => {
  if (pct >= 90) return { grade: 'A+', label: 'उत्कृष्ट (Outstanding)', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-300' };
  if (pct >= 80) return { grade: 'A', label: 'अति उत्तम (Very Good)', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  if (pct >= 70) return { grade: 'B+', label: 'उत्तम (Good)', colorClass: 'text-blue-800 bg-blue-50 border-blue-200' };
  if (pct >= 60) return { grade: 'B', label: 'संतोषजनक (Above Avg)', colorClass: 'text-indigo-800 bg-indigo-50 border-indigo-200' };
  if (pct >= 50) return { grade: 'C', label: 'औसत (Satisfactory)', colorClass: 'text-amber-800 bg-amber-50 border-amber-200' };
  if (pct >= 33) return { grade: 'D', label: 'उत्तीर्ण (Pass)', colorClass: 'text-orange-800 bg-orange-50 border-orange-200' };
  return { grade: 'E', label: 'सुधार आवश्यक (Needs Effort)', colorClass: 'text-rose-800 bg-rose-50 border-rose-200' };
};

export interface SubjectScoreRow {
  subjectKey: string;
  subjectLabel: string;
  weeklyObtained: number;
  weeklyMax: number;
  weeklyCount: number;
  weeklyAbsentCount: number;
  quarterlyObtained: number | null;
  quarterlyMax: number;
  quarterlyAbsent: boolean;
  halfYearlyObtained: number | null;
  halfYearlyMax: number;
  halfYearlyAbsent: boolean;
  annualObtained: number | null;
  annualMax: number;
  annualAbsent: boolean;
  combinedObtained: number;
  combinedMax: number;
  combinedPct: number;
  grade: string;
}

export interface ComputedReportCardData {
  student: Student;
  session: string;
  subjects: SubjectScoreRow[];
  weeklySummary: { obtained: number; max: number; pct: number; testsCount: number };
  quarterlySummary: { obtained: number; max: number; pct: number; hasData: boolean };
  halfYearlySummary: { obtained: number; max: number; pct: number; hasData: boolean };
  annualSummary: { obtained: number; max: number; pct: number; hasData: boolean };
  overall: { obtained: number; max: number; pct: number; grade: string; gradeLabel: string; hasAnyScore: boolean };
  attendance: {
    totalDays: number;
    presentDays: number;
    absentDays: number;
    attendancePct: number;
    cleanConductPct: number;
  };
  meta: ReportCardRemarkRecord;
  autoTeacherRemark: string;
}

export const computeStudentAttendanceForReportCard = (
  studentId: string,
  behaviorList: StudentBehaviorRecord[]
) => {
  const cleanId = String(studentId || '').trim().toLowerCase();
  const seenDates = new Map<string, StudentBehaviorRecord>();

  behaviorList.forEach((b) => {
    if (String(b.Student_ID || '').trim().toLowerCase() !== cleanId) return;
    const dKey = String(b.Date || b.Behavior_ID || '').trim();
    if (!seenDates.has(dKey) || b.Is_Present) {
      seenDates.set(dKey, b);
    }
  });

  const rows = Array.from(seenDates.values());
  const totalDays = rows.length;
  const presentDays = rows.filter((r) => Boolean(r.Is_Present)).length;
  const absentDays = Math.max(0, totalDays - presentDays);
  const attendancePct = totalDays > 0 ? Math.round((presentDays / totalDays) * 1000) / 10 : 0;

  let conductPoints = 0;
  let conductChecks = 0;
  rows.forEach((r) => {
    if (!r.Is_Present) return;
    conductChecks += 4;
    if (r.Is_Bathed) conductPoints++;
    if (r.Nails_Clean) conductPoints++;
    if (r.Uniform_clean) conductPoints++;
    if (r.Discipline) conductPoints++;
  });
  const cleanConductPct = conductChecks > 0 ? Math.round((conductPoints / conductChecks) * 100) : 100;

  return {
    totalDays,
    presentDays,
    absentDays,
    attendancePct,
    cleanConductPct,
  };
};

export const computeStudentReportCardData = (params: {
  student: Student;
  weeklyTests: WeeklyTestRecord[];
  examMarks: ExamMarkRecord[];
  behaviorList: StudentBehaviorRecord[];
  metaMap: Record<string, ReportCardRemarkRecord>;
  session?: string;
}): ComputedReportCardData => {
  const { student, weeklyTests, examMarks, behaviorList, metaMap, session = CURRENT_ACADEMIC_SESSION } = params;
  const sid = String(student.Student_ID || '').trim().toLowerCase();

  const studentWeekly = weeklyTests.filter((t) => String(t.student_id || '').trim().toLowerCase() === sid);
  const studentExams = examMarks.filter(
    (m) =>
      String(m.student_id || '').trim().toLowerCase() === sid &&
      (!m.session || m.session === session)
  );

  const subjectMap = new Map<string, SubjectScoreRow>();
  const ensureSubjectRow = (rawLabel: string): SubjectScoreRow => {
    const key = normalizeSubjectKey(rawLabel) || rawLabel.trim().toLowerCase();
    const existing = subjectMap.get(key);
    if (existing) return existing;
    const niceLabel =
      REPORT_CARD_SUBJECTS.find((s) => normalizeSubjectKey(s) === key) || rawLabel.trim() || 'अन्य विषय';
    const created: SubjectScoreRow = {
      subjectKey: key,
      subjectLabel: niceLabel,
      weeklyObtained: 0,
      weeklyMax: 0,
      weeklyCount: 0,
      weeklyAbsentCount: 0,
      quarterlyObtained: null,
      quarterlyMax: 50,
      quarterlyAbsent: false,
      halfYearlyObtained: null,
      halfYearlyMax: 100,
      halfYearlyAbsent: false,
      annualObtained: null,
      annualMax: 100,
      annualAbsent: false,
      combinedObtained: 0,
      combinedMax: 0,
      combinedPct: 0,
      grade: '-',
    };
    subjectMap.set(key, created);
    return created;
  };

  studentWeekly.forEach((wt) => {
    const row = ensureSubjectRow(wt.subject || 'General');
    const maxM = Math.max(0, Number(wt.max_marks) || 0);
    const isAbs = wt.attendance_status === 'Absent';
    const obtM = isAbs ? 0 : Math.max(0, Number(wt.marks_obtained) || 0);
    row.weeklyMax += maxM;
    row.weeklyObtained += obtM;
    row.weeklyCount += 1;
    if (isAbs) row.weeklyAbsentCount += 1;
  });

  studentExams.forEach((em) => {
    const row = ensureSubjectRow(em.subject || 'General');
    const maxM = Math.max(1, Number(em.max_marks) || 50);
    const isAbs = em.attendance_status === 'Absent';
    const obtM = isAbs ? 0 : Math.max(0, Number(em.marks_obtained) || 0);
    if (em.exam_type === 'Quarterly') {
      row.quarterlyObtained = obtM;
      row.quarterlyMax = maxM;
      row.quarterlyAbsent = isAbs;
    } else if (em.exam_type === 'Half-Yearly') {
      row.halfYearlyObtained = obtM;
      row.halfYearlyMax = maxM;
      row.halfYearlyAbsent = isAbs;
    } else if (em.exam_type === 'Annual') {
      row.annualObtained = obtM;
      row.annualMax = maxM;
      row.annualAbsent = isAbs;
    }
  });

  let wTotalObt = 0, wTotalMax = 0, wTestsCount = 0;
  let qTotalObt = 0, qTotalMax = 0, qHas = false;
  let hTotalObt = 0, hTotalMax = 0, hHas = false;
  let aTotalObt = 0, aTotalMax = 0, aHas = false;
  let grandObt = 0, grandMax = 0;

  const subjects = Array.from(subjectMap.values()).map((row) => {
    let subObt = 0;
    let subMax = 0;

    if (row.weeklyMax > 0) {
      wTotalObt += row.weeklyObtained;
      wTotalMax += row.weeklyMax;
      wTestsCount += row.weeklyCount;
      subObt += row.weeklyObtained;
      subMax += row.weeklyMax;
    }
    if (row.quarterlyObtained !== null) {
      qHas = true;
      qTotalObt += row.quarterlyObtained;
      qTotalMax += row.quarterlyMax;
      subObt += row.quarterlyObtained;
      subMax += row.quarterlyMax;
    }
    if (row.halfYearlyObtained !== null) {
      hHas = true;
      hTotalObt += row.halfYearlyObtained;
      hTotalMax += row.halfYearlyMax;
      subObt += row.halfYearlyObtained;
      subMax += row.halfYearlyMax;
    }
    if (row.annualObtained !== null) {
      aHas = true;
      aTotalObt += row.annualObtained;
      aTotalMax += row.annualMax;
      subObt += row.annualObtained;
      subMax += row.annualMax;
    }

    grandObt += subObt;
    grandMax += subMax;

    const pct = subMax > 0 ? Math.round((subObt / subMax) * 1000) / 10 : 0;
    const g = subMax > 0 ? getGradeFromPercentage(pct).grade : '-';
    return {
      ...row,
      combinedObtained: Math.round(subObt * 10) / 10,
      combinedMax: Math.round(subMax * 10) / 10,
      combinedPct: pct,
      grade: g,
    };
  });

  // Sort subjects following REPORT_CARD_SUBJECTS order
  subjects.sort((a, b) => {
    const idxA = REPORT_CARD_SUBJECTS.findIndex((s) => normalizeSubjectKey(s) === a.subjectKey);
    const idxB = REPORT_CARD_SUBJECTS.findIndex((s) => normalizeSubjectKey(s) === b.subjectKey);
    const rankA = idxA === -1 ? 999 : idxA;
    const rankB = idxB === -1 ? 999 : idxB;
    if (rankA !== rankB) return rankA - rankB;
    return a.subjectLabel.localeCompare(b.subjectLabel);
  });

  const overallPct = grandMax > 0 ? Math.round((grandObt / grandMax) * 1000) / 10 : 0;
  const gradeInfo = getGradeFromPercentage(overallPct);
  const attendance = computeStudentAttendanceForReportCard(student.Student_ID, behaviorList);

  const reportKey = `${session}::${student.Student_ID}`;
  const existingMeta = metaMap[reportKey] || metaMap[student.Student_ID];

  const autoTeacherRemark =
    overallPct >= 85
      ? 'उत्कृष्ट शैक्षणिक प्रदर्शन! छात्र अत्यंत मेहनती एवं अनुशासित है।'
      : overallPct >= 70
      ? 'बहुत अच्छा प्रदर्शन। निरंतर अभ्यास से और श्रेष्ठ परिणाम प्राप्त किए जा सकते हैं।'
      : overallPct >= 50
      ? 'संतोषजनक प्रगति। गणित व लेखन पर थोड़ा और ध्यान देने से परिणाम और बेहतर होंगे।'
      : grandMax > 0
      ? 'नियमित विद्यालय उपस्थिति व प्रतिदिन गृहकार्य अभ्यास की आवश्यकता है।'
      : 'साप्ताहिक टेस्ट एवं परीक्षा अंक जुड़ने पर शैक्षणिक प्रगति यहाँ प्रदर्शित होगी।';

  const meta: ReportCardRemarkRecord = existingMeta || {
    reportKey,
    session,
    studentId: student.Student_ID,
    teacherRemark: autoTeacherRemark,
    principalRemark: overallPct >= 75 ? 'उज्ज्वल भविष्य की शुभकामनाएँ!' : 'मेहनत व नियमितता बनाए रखें।',
    resultStatus: grandMax === 0 || overallPct >= 33 ? 'PROMOTED' : 'NEEDS IMPROVEMENT',
    publishedToParent: true,
  };

  return {
    student,
    session,
    subjects,
    weeklySummary: {
      obtained: Math.round(wTotalObt * 10) / 10,
      max: Math.round(wTotalMax * 10) / 10,
      pct: wTotalMax > 0 ? Math.round((wTotalObt / wTotalMax) * 1000) / 10 : 0,
      testsCount: wTestsCount,
    },
    quarterlySummary: {
      obtained: qTotalObt,
      max: qTotalMax,
      pct: qTotalMax > 0 ? Math.round((qTotalObt / qTotalMax) * 1000) / 10 : 0,
      hasData: qHas,
    },
    halfYearlySummary: {
      obtained: hTotalObt,
      max: hTotalMax,
      pct: hTotalMax > 0 ? Math.round((hTotalObt / hTotalMax) * 1000) / 10 : 0,
      hasData: hHas,
    },
    annualSummary: {
      obtained: aTotalObt,
      max: aTotalMax,
      pct: aTotalMax > 0 ? Math.round((aTotalObt / aTotalMax) * 1000) / 10 : 0,
      hasData: aHas,
    },
    overall: {
      obtained: Math.round(grandObt * 10) / 10,
      max: Math.round(grandMax * 10) / 10,
      pct: overallPct,
      grade: grandMax > 0 ? gradeInfo.grade : '-',
      gradeLabel: grandMax > 0 ? gradeInfo.label : 'अंक प्रतीक्षित',
      hasAnyScore: grandMax > 0,
    },
    attendance,
    meta,
    autoTeacherRemark,
  };
};
