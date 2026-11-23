import {
  ExamMarkRecord,
  ExamTermType,
  ReportCardAccessConfig,
  ReportCardRemarkRecord,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';
import { getLocalTimestamp } from './localTime';
import { saveToPhoneMemory } from './phoneMemoryCache';

export const EXAM_MARKS_STORAGE_KEY = 'evs_exam_marks_v1';
export const REPORT_CARD_META_STORAGE_KEY = 'evs_report_card_meta_v1';
export const REPORT_CARD_WORKFLOW_STORAGE_KEY = 'evs_report_card_workflow_v1';
export const REPORT_CARD_UPDATED_EVENT = 'evs-report-card-updated';
export const CURRENT_ACADEMIC_SESSION = '2026-27';

export const DEFAULT_REPORT_CARD_ACCESS_CONFIG: ReportCardAccessConfig = {
  allowTeacherPtmView: false,
  allowParentView: false,
  allowTeacherQrAttendance: false,
};

export interface ReportCardWorkflowSnapshot {
  accessConfig: ReportCardAccessConfig;
  pendingMarks: ExamMarkRecord[];
  pendingMeta: Record<string, ReportCardRemarkRecord>;
}

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

export const ENGLISH_SUBJECT_LABELS: Record<string, string> = {
  hindi: 'Hindi',
  english: 'English',
  math: 'Mathematics',
  science: 'Science',
  evs: 'Environmental Studies (EVS)',
  social: 'Social Studies',
  urdu: 'Urdu / Arabic',
  computer: 'Computer Science',
  gk: 'General Knowledge',
};

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
    saveToPhoneMemory(EXAM_MARKS_STORAGE_KEY, records);
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
    saveToPhoneMemory(REPORT_CARD_META_STORAGE_KEY, map);
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
      updatedAt: getLocalTimestamp(),
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
  classRank?: string;
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

export const loadLocalReportCardWorkflow = (): ReportCardWorkflowSnapshot => {
  try {
    const raw = localStorage.getItem(REPORT_CARD_WORKFLOW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          accessConfig: {
            allowTeacherPtmView: Boolean(parsed.accessConfig?.allowTeacherPtmView),
            allowParentView: Boolean(parsed.accessConfig?.allowParentView),
            allowTeacherQrAttendance: Boolean(parsed.accessConfig?.allowTeacherQrAttendance),
            updatedBy: parsed.accessConfig?.updatedBy,
            updatedAt: parsed.accessConfig?.updatedAt,
          },
          pendingMarks: Array.isArray(parsed.pendingMarks) ? parsed.pendingMarks : [],
          pendingMeta: parsed.pendingMeta && typeof parsed.pendingMeta === 'object' ? parsed.pendingMeta : {},
        };
      }
    }
  } catch {}
  return {
    accessConfig: { ...DEFAULT_REPORT_CARD_ACCESS_CONFIG },
    pendingMarks: [],
    pendingMeta: {},
  };
};

export const saveLocalReportCardWorkflow = (snap: ReportCardWorkflowSnapshot) => {
  try {
    const nextJson = JSON.stringify(snap);
    const prevJson = localStorage.getItem(REPORT_CARD_WORKFLOW_STORAGE_KEY);
    if (prevJson === nextJson) return;
    saveToPhoneMemory(REPORT_CARD_WORKFLOW_STORAGE_KEY, snap);
    window.dispatchEvent(new CustomEvent(REPORT_CARD_UPDATED_EVENT, { detail: { type: 'workflow', snap } }));
  } catch {}
};

export const fetchReportCardWorkflowFromServer = async (
  forceRefresh = false
): Promise<ReportCardWorkflowSnapshot> => {
  const activeUrl = getAppsScriptUrl();
  const local = loadLocalReportCardWorkflow();
  try {
    const res = await fetch(`/api/report-cards-workflow${forceRefresh ? '?refresh=1&' : '?'}_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': activeUrl },
      cache: 'no-store',
    });
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      const data = await res.json();
      if (data && typeof data === 'object' && data.accessConfig) {
        const snap: ReportCardWorkflowSnapshot = {
          accessConfig: {
            allowTeacherPtmView: Boolean(data.accessConfig.allowTeacherPtmView),
            allowParentView: Boolean(data.accessConfig.allowParentView),
            allowTeacherQrAttendance: Boolean(data.accessConfig.allowTeacherQrAttendance),
            updatedBy: data.accessConfig.updatedBy,
            updatedAt: data.accessConfig.updatedAt,
          },
          pendingMarks: Array.isArray(data.pendingMarks) ? data.pendingMarks : [],
          pendingMeta: data.pendingMeta && typeof data.pendingMeta === 'object' ? data.pendingMeta : {},
        };
        saveLocalReportCardWorkflow(snap);
        return snap;
      }
    }
  } catch {}

  try {
    const direct = await directGetFromSheet('getReportCardWorkflow', activeUrl);
    if (direct.ok && direct.json && direct.json.accessConfig) {
      const snap: ReportCardWorkflowSnapshot = {
        accessConfig: {
          allowTeacherPtmView: Boolean(direct.json.accessConfig.allowTeacherPtmView),
          allowParentView: Boolean(direct.json.accessConfig.allowParentView),
          allowTeacherQrAttendance: Boolean(direct.json.accessConfig.allowTeacherQrAttendance),
          updatedBy: direct.json.accessConfig.updatedBy,
          updatedAt: direct.json.accessConfig.updatedAt,
        },
        pendingMarks: Array.isArray(direct.json.pendingMarks) ? direct.json.pendingMarks : local.pendingMarks,
        pendingMeta:
          direct.json.pendingMeta && typeof direct.json.pendingMeta === 'object'
            ? direct.json.pendingMeta
            : local.pendingMeta,
      };
      saveLocalReportCardWorkflow(snap);
      return snap;
    }
  } catch {}

  return local;
};

/**
 * TEACHER ONLY: Saves marks & teacher remark draft as Pending Manager Confirmation.
 * Does NOT write permanently to Google Sheet tabs ("Exam_Marks" / "Report_Cards_Backup").
 */
export const submitTeacherReportCardDraftToServer = async (params: {
  marks?: ExamMarkRecord[];
  meta?: ReportCardRemarkRecord;
  submittedBy: string;
  submittedById?: string;
}): Promise<{ snapshot: ReportCardWorkflowSnapshot; serverOk: boolean; sheetSynced: boolean }> => {
  const local = loadLocalReportCardWorkflow();
  const compKey = (m: ExamMarkRecord) =>
    `${String(m.session || CURRENT_ACADEMIC_SESSION).toLowerCase()}::${String(m.exam_type || 'Quarterly').toLowerCase()}::${String(m.student_id || '').toLowerCase()}::${normalizeSubjectKey(m.subject) || String(m.subject || '').toLowerCase()}`;

  const markMap = new Map<string, ExamMarkRecord>();
  local.pendingMarks.forEach((m) => markMap.set(compKey(m), m));
  const incomingMarks = (params.marks || []).map((m) => ({
    ...m,
    approval_status: 'pending_approval' as const,
    submitted_at: getLocalTimestamp(),
  }));
  incomingMarks.forEach((m) => markMap.set(compKey(m), m));

  const nextMetaMap = { ...local.pendingMeta };
  if (params.meta) {
    nextMetaMap[params.meta.reportKey] = {
      ...params.meta,
      principalRemark: '',
      publishedToParent: false,
      submittedBy: params.submittedBy,
      submittedAt: getLocalTimestamp(),
      approvalStatus: 'pending_approval',
    };
  }

  const nextSnap: ReportCardWorkflowSnapshot = {
    accessConfig: local.accessConfig,
    pendingMarks: Array.from(markMap.values()),
    pendingMeta: nextMetaMap,
  };
  saveLocalReportCardWorkflow(nextSnap);

  const res = await dualSyncWriteToSheet({
    apiPath: '/api/report-cards-workflow/teacher-submit',
    apiBody: {
      marks: incomingMarks,
      meta: params.meta ? nextMetaMap[params.meta.reportKey] : undefined,
      submittedBy: params.submittedBy,
      submittedById: params.submittedById,
    },
    directPayload: {
      action: 'saveReportCardDraft',
      draft: JSON.stringify({
        pendingMarks: nextSnap.pendingMarks,
        pendingMeta: nextSnap.pendingMeta,
      }),
    },
  });

  if (res.data?.accessConfig) {
    const serverSnap: ReportCardWorkflowSnapshot = {
      accessConfig: res.data.accessConfig,
      pendingMarks: Array.isArray(res.data.pendingMarks) ? res.data.pendingMarks : nextSnap.pendingMarks,
      pendingMeta: res.data.pendingMeta || nextSnap.pendingMeta,
    };
    saveLocalReportCardWorkflow(serverSnap);
    return { snapshot: serverSnap, serverOk: res.serverOk, sheetSynced: res.sheetSynced };
  }

  return { snapshot: nextSnap, serverOk: res.serverOk, sheetSynced: res.sheetSynced };
};

/**
 * MANAGER ONLY: Toggle Teacher PTM View-Only permission & Global Parent View permission.
 */
export const updateReportCardAccessConfigOnServer = async (
  accessConfig: ReportCardAccessConfig
): Promise<{ snapshot: ReportCardWorkflowSnapshot; sheetSynced: boolean }> => {
  const local = loadLocalReportCardWorkflow();
  const stamped: ReportCardAccessConfig = {
    ...accessConfig,
    updatedAt: getLocalTimestamp(),
  };
  const nextSnap: ReportCardWorkflowSnapshot = {
    ...local,
    accessConfig: stamped,
  };
  saveLocalReportCardWorkflow(nextSnap);

  const res = await dualSyncWriteToSheet({
    apiPath: '/api/report-cards-workflow/access',
    apiBody: { accessConfig: stamped },
    directPayload: {
      action: 'saveReportCardAccess',
      accessConfig: JSON.stringify(stamped),
    },
  });

  if (res.data?.accessConfig) {
    const serverSnap: ReportCardWorkflowSnapshot = {
      accessConfig: res.data.accessConfig,
      pendingMarks: Array.isArray(res.data.pendingMarks) ? res.data.pendingMarks : nextSnap.pendingMarks,
      pendingMeta: res.data.pendingMeta || nextSnap.pendingMeta,
    };
    saveLocalReportCardWorkflow(serverSnap);
    return { snapshot: serverSnap, sheetSynced: res.sheetSynced };
  }

  return { snapshot: nextSnap, sheetSynced: res.sheetSynced };
};

/**
 * MANAGER ONLY: Confirm Teacher-submitted marks & remarks and save permanently to Google Sheet.
 */
export const confirmPendingReportCardsToSheet = async (params: {
  marks: ExamMarkRecord[];
  metas: ReportCardRemarkRecord[];
  backups: ReportCardBackupRow[];
  confirmedBy: string;
  removeMarkIds?: string[];
  removeReportKeys?: string[];
}): Promise<{
  allMarks: ExamMarkRecord[];
  metaMap: Record<string, ReportCardRemarkRecord>;
  snapshot: ReportCardWorkflowSnapshot;
  sheetSynced: boolean;
  sheetError?: string;
}> => {
  const localMarks = loadLocalExamMarks();
  const markMap = new Map<string, ExamMarkRecord>(localMarks.map((m) => [m.id, m]));
  const approvedMarks = params.marks.map((m) => ({
    ...m,
    approval_status: 'approved' as const,
    updated_at: getLocalTimestamp(),
  }));
  approvedMarks.forEach((m) => markMap.set(m.id, m));
  const nextAllMarks = Array.from(markMap.values());
  saveLocalExamMarks(nextAllMarks);

  const localMeta = loadLocalReportCardMeta();
  const nextMeta = { ...localMeta };
  params.metas.forEach((m) => {
    nextMeta[m.reportKey] = {
      ...m,
      approvalStatus: 'approved',
      updatedBy: params.confirmedBy,
      updatedAt: getLocalTimestamp(),
    };
  });
  saveLocalReportCardMeta(nextMeta);

  const localWf = loadLocalReportCardWorkflow();
  const rmMarkSet = new Set(params.removeMarkIds || approvedMarks.map((m) => m.id));
  const rmMetaSet = new Set(params.removeReportKeys || params.metas.map((m) => m.reportKey));
  const nextWf: ReportCardWorkflowSnapshot = {
    accessConfig: localWf.accessConfig,
    pendingMarks: localWf.pendingMarks.filter((m) => !rmMarkSet.has(m.id)),
    pendingMeta: Object.fromEntries(
      Object.entries(localWf.pendingMeta).filter(([k]) => !rmMetaSet.has(k))
    ),
  };
  saveLocalReportCardWorkflow(nextWf);

  const res = await dualSyncWriteToSheet({
    apiPath: '/api/report-cards-workflow/manager-confirm',
    apiBody: {
      marks: approvedMarks,
      metas: params.metas.map((m) => nextMeta[m.reportKey]),
      backups: params.backups,
      confirmedBy: params.confirmedBy,
      removeMarkIds: Array.from(rmMarkSet),
      removeReportKeys: Array.from(rmMetaSet),
    },
    directPayload: {
      action: 'syncReportCardsBatch',
      backups: JSON.stringify(params.backups),
      examMarks: JSON.stringify(nextAllMarks),
    },
  });

  if (res.data?.allMarks && Array.isArray(res.data.allMarks)) {
    saveLocalExamMarks(res.data.allMarks);
  }
  if (res.data?.meta && typeof res.data.meta === 'object') {
    saveLocalReportCardMeta(res.data.meta);
  }
  if (res.data?.workflow) {
    saveLocalReportCardWorkflow(res.data.workflow);
  }

  return {
    allMarks: Array.isArray(res.data?.allMarks) ? res.data.allMarks : nextAllMarks,
    metaMap: res.data?.meta && typeof res.data.meta === 'object' ? res.data.meta : nextMeta,
    snapshot: res.data?.workflow || nextWf,
    sheetSynced: res.sheetSynced,
    sheetError: res.sheetError,
  };
};

/**
 * MANAGER ONLY: Return/Reject pending teacher marks or remarks draft so Teacher can edit again.
 */
export const rejectPendingReportCardsOnServer = async (params: {
  markIds?: string[];
  reportKeys?: string[];
  clearAll?: boolean;
}): Promise<ReportCardWorkflowSnapshot> => {
  const localWf = loadLocalReportCardWorkflow();
  const rmMarkSet = new Set(params.markIds || []);
  const rmMetaSet = new Set(params.reportKeys || []);

  const nextWf: ReportCardWorkflowSnapshot = params.clearAll
    ? { accessConfig: localWf.accessConfig, pendingMarks: [], pendingMeta: {} }
    : {
        accessConfig: localWf.accessConfig,
        pendingMarks: localWf.pendingMarks.filter((m) => !rmMarkSet.has(m.id)),
        pendingMeta: Object.fromEntries(
          Object.entries(localWf.pendingMeta).filter(([k]) => !rmMetaSet.has(k))
        ),
      };
  saveLocalReportCardWorkflow(nextWf);

  const res = await dualSyncWriteToSheet({
    apiPath: '/api/report-cards-workflow/manager-reject',
    apiBody: params,
    directPayload: {
      action: 'saveReportCardDraft',
      draft: JSON.stringify({
        pendingMarks: nextWf.pendingMarks,
        pendingMeta: nextWf.pendingMeta,
      }),
    },
  });

  if (res.data?.accessConfig) {
    const serverSnap: ReportCardWorkflowSnapshot = {
      accessConfig: res.data.accessConfig,
      pendingMarks: Array.isArray(res.data.pendingMarks) ? res.data.pendingMarks : nextWf.pendingMarks,
      pendingMeta: res.data.pendingMeta || nextWf.pendingMeta,
    };
    saveLocalReportCardWorkflow(serverSnap);
    return serverSnap;
  }

  return nextWf;
};

export const subscribeReportCardUpdates = (onUpdate: () => void): (() => void) => {
  const handleCustom = () => onUpdate();
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === EXAM_MARKS_STORAGE_KEY ||
      e.key === REPORT_CARD_META_STORAGE_KEY ||
      e.key === REPORT_CARD_WORKFLOW_STORAGE_KEY
    ) {
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
          (msg.entity === 'exam_marks' ||
            msg.entity === 'report_card_meta' ||
            msg.entity === 'report_card_workflow' ||
            msg.entity === 'weekly_tests')
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
  if (pct >= 90) return { grade: 'A+', label: 'Outstanding Performance', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-300' };
  if (pct >= 80) return { grade: 'A', label: 'Very Good Achievement', colorClass: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
  if (pct >= 70) return { grade: 'B+', label: 'Good & Consistent', colorClass: 'text-blue-800 bg-blue-50 border-blue-200' };
  if (pct >= 60) return { grade: 'B', label: 'Commendable Effort', colorClass: 'text-indigo-800 bg-indigo-50 border-indigo-200' };
  if (pct >= 50) return { grade: 'C', label: 'Satisfactory Progress', colorClass: 'text-amber-800 bg-amber-50 border-amber-200' };
  if (pct >= 33) return { grade: 'D', label: 'Pass — Needs Consistency', colorClass: 'text-orange-800 bg-orange-50 border-orange-200' };
  return { grade: 'E', label: 'Needs Focused Effort', colorClass: 'text-rose-800 bg-rose-50 border-rose-200' };
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
  autoPrincipalRemark: string;
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
    const strippedRaw = String(rawLabel || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const cleanEnglish =
      ENGLISH_SUBJECT_LABELS[key] ||
      (/^[A-Za-z0-9\s/&.-]+$/.test(strippedRaw) ? strippedRaw : rawLabel.trim()) ||
      'Other Subject';
    const created: SubjectScoreRow = {
      subjectKey: key,
      subjectLabel: cleanEnglish,
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

  // Sort ascending by updated_at so newer edits override any duplicate older records cleanly
  const sortedExams = [...studentExams].sort((a, b) =>
    String(a.updated_at || '').localeCompare(String(b.updated_at || ''))
  );

  sortedExams.forEach((em) => {
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

  const firstName = String(student.Student_Name || 'Student').trim().split(/\s+/)[0] || 'Student';
  const scoredSubjects = [...subjects]
    .filter((s) => s.combinedMax > 0)
    .sort((a, b) => b.combinedPct - a.combinedPct);
  const strongestSub = scoredSubjects[0];
  const weakestSub = scoredSubjects.length > 1 ? scoredSubjects[scoredSubjects.length - 1] : undefined;

  const hasLowAttendance = attendance.totalDays > 0 && attendance.attendancePct < 75;
  const hasStrongConduct = attendance.cleanConductPct >= 90;

  let autoTeacherRemark = '';
  if (grandMax === 0) {
    autoTeacherRemark = `${firstName} maintains good classroom discipline. Academic remarks will be updated once term assessments are recorded.`;
  } else if (overallPct >= 85) {
    autoTeacherRemark = `${firstName} has demonstrated outstanding academic excellence, particularly in ${strongestSub?.subjectLabel || 'core subjects'} (${strongestSub?.combinedPct ?? overallPct}%). ${hasStrongConduct ? 'Exemplary classroom conduct, neatness, and active participation are highly commendable.' : 'Keep up this brilliant dedication and consistent effort!'}`;
  } else if (overallPct >= 70) {
    autoTeacherRemark = `${firstName} has shown a commendable performance with notable strength in ${strongestSub?.subjectLabel || 'key subjects'} (${strongestSub?.combinedPct ?? overallPct}%). ${weakestSub && weakestSub.combinedPct < 75 ? `Targeted revision in ${weakestSub.subjectLabel} will help achieve top distinction.` : 'Sustained practice will lead to even greater heights.'}`;
  } else if (overallPct >= 50) {
    autoTeacherRemark = `${firstName} exhibits ${hasStrongConduct ? 'exemplary discipline & neatness' : 'steady classroom effort'} with promising progress in ${strongestSub?.subjectLabel || 'studies'} (${strongestSub?.combinedPct ?? overallPct}%). ${weakestSub && weakestSub.combinedPct < 65 ? `Focused daily practice in ${weakestSub.subjectLabel} (${weakestSub.combinedPct}%)` : 'Regular written revision'}${hasLowAttendance ? ' along with more regular school attendance' : ''} will significantly boost overall grades.`;
  } else {
    autoTeacherRemark = `${firstName} shows potential and needs structured daily revision${weakestSub ? `, especially in ${weakestSub.subjectLabel}` : ''}. Consistent homework completion${hasLowAttendance ? ' and improved attendance' : ''} with supportive guidance at home will build strong academic confidence.`;
  }

  let autoPrincipalRemark = '';
  if (grandMax === 0) {
    autoPrincipalRemark = `Wishing ${firstName} a joyful and productive academic session at E.V.S. Public School.`;
  } else if (overallPct >= 85) {
    autoPrincipalRemark = `Heartiest congratulations on an exceptional result! Proud of ${firstName}'s dedication, discipline, and academic excellence.`;
  } else if (overallPct >= 70) {
    autoPrincipalRemark = `Well done, ${firstName}! Consistent curiosity and disciplined study habits will surely place you among the top merit scholars.`;
  } else if (overallPct >= 50) {
    autoPrincipalRemark = `${firstName} possesses bright potential and good conduct. With steady home revision${hasLowAttendance ? ' and regular attendance' : ''}, an A-grade milestone is well within reach.`;
  } else {
    autoPrincipalRemark = `Every step forward counts. Regular school attendance and focused daily study will help ${firstName} achieve strong progress ahead.`;
  }

  // Upgrade legacy auto-generated Hindi boilerplate remarks cleanly while preserving custom teacher/principal edits
  const LEGACY_HINDI_TEACHER_DEFAULTS = new Set([
    'उत्कृष्ट शैक्षणिक प्रदर्शन! छात्र अत्यंत मेहनती एवं अनुशासित है।',
    'बहुत अच्छा प्रदर्शन। निरंतर अभ्यास से और श्रेष्ठ परिणाम प्राप्त किए जा सकते हैं।',
    'संतोषजनक प्रगति। गणित व लेखन पर थोड़ा और ध्यान देने से परिणाम और बेहतर होंगे।',
    'नियमित विद्यालय उपस्थिति व प्रतिदिन गृहकार्य अभ्यास की आवश्यकता है।',
    'साप्ताहिक टेस्ट एवं परीक्षा अंक जुड़ने पर शैक्षणिक प्रगति यहाँ प्रदर्शित होगी।',
  ]);
  const LEGACY_HINDI_PRINCIPAL_DEFAULTS = new Set([
    'उज्ज्वल भविष्य की शुभकामनाएँ!',
    'मेहनत व नियमितता बनाए रखें।',
  ]);

  const savedTeacher = existingMeta?.teacherRemark?.trim() || '';
  const savedPrincipal = existingMeta?.principalRemark?.trim() || '';

  const resolvedTeacherRemark =
    !savedTeacher || LEGACY_HINDI_TEACHER_DEFAULTS.has(savedTeacher) ? autoTeacherRemark : savedTeacher;
  const resolvedPrincipalRemark =
    !savedPrincipal || LEGACY_HINDI_PRINCIPAL_DEFAULTS.has(savedPrincipal) ? autoPrincipalRemark : savedPrincipal;

  const meta: ReportCardRemarkRecord = existingMeta
    ? {
        ...existingMeta,
        teacherRemark: resolvedTeacherRemark,
        principalRemark: resolvedPrincipalRemark,
      }
    : {
        reportKey,
        session,
        studentId: student.Student_ID,
        teacherRemark: autoTeacherRemark,
        principalRemark: autoPrincipalRemark,
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
      gradeLabel: grandMax > 0 ? gradeInfo.label : 'Awaiting Scores',
      hasAnyScore: grandMax > 0,
    },
    attendance,
    meta,
    autoTeacherRemark,
    autoPrincipalRemark,
  };
};

export interface ClassRankInfo {
  rank: number;
  total: number;
  label: string;
}

const normalizeClassRankToken = (cls: string) =>
  String(cls || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^class-?/, '');

export const computeClassRanksMap = (params: {
  students: Student[];
  weeklyTests: WeeklyTestRecord[];
  examMarks: ExamMarkRecord[];
  behaviorList: StudentBehaviorRecord[];
  metaMap: Record<string, ReportCardRemarkRecord>;
  session?: string;
}): Record<string, ClassRankInfo> => {
  const { students, weeklyTests, examMarks, behaviorList, metaMap, session = CURRENT_ACADEMIC_SESSION } = params;
  const byClass = new Map<string, { studentId: string; pct: number; hasScore: boolean }[]>();

  students.forEach((st) => {
    const rc = computeStudentReportCardData({
      student: st,
      weeklyTests,
      examMarks,
      behaviorList,
      metaMap,
      session,
    });
    const clsTok = normalizeClassRankToken(st.Class) || '__unassigned__';
    if (!byClass.has(clsTok)) byClass.set(clsTok, []);
    byClass.get(clsTok)!.push({
      studentId: st.Student_ID,
      pct: rc.overall.pct,
      hasScore: rc.overall.hasAnyScore,
    });
  });

  const result: Record<string, ClassRankInfo> = {};
  byClass.forEach((rows) => {
    const total = rows.length;
    const scored = rows.filter((r) => r.hasScore).sort((a, b) => b.pct - a.pct);
    const unscored = rows.filter((r) => !r.hasScore);

    let currentRank = 0;
    let prevPct: number | null = null;
    scored.forEach((item, idx) => {
      if (prevPct === null || item.pct < prevPct) {
        currentRank = idx + 1;
        prevPct = item.pct;
      }
      result[item.studentId] = {
        rank: currentRank,
        total,
        label: `${currentRank} / ${total}`,
      };
    });

    unscored.forEach((item) => {
      result[item.studentId] = {
        rank: 0,
        total,
        label: `— / ${total}`,
      };
    });
  });

  return result;
};

export interface SubjectAssessmentBar {
  key: 'WT' | 'QTR' | 'HY' | 'ANN';
  label: string;
  fullLabel: string;
  obtained: number;
  max: number;
  pct: number;
  isAbsent: boolean;
}

export interface SubjectComparisonAnalytics {
  subjectKey: string;
  subjectLabel: string;
  bars: SubjectAssessmentBar[];
  deltaPp: number | null;
  fromLabel: string;
  toLabel: string;
  trend: 'improved' | 'declined' | 'neutral' | 'single';
}

export interface PerformanceAnalyticsSummary {
  subjects: SubjectComparisonAnalytics[];
  comparedCount: number;
  improvedCount: number;
  declinedCount: number;
  unchangedCount: number;
  averageChangePp: number | null;
  firstExamLabel: string;
  lastExamLabel: string;
  wtAvg: number | null;
  qtrAvg: number | null;
  hyAvg: number | null;
  annAvg: number | null;
  classRank: ClassRankInfo;
}

export const computePerformanceAnalytics = (params: {
  data: ComputedReportCardData;
  classRankInfo?: ClassRankInfo;
  includeWeekly?: boolean;
}): PerformanceAnalyticsSummary => {
  const { data, classRankInfo, includeWeekly = true } = params;

  const subjects: SubjectComparisonAnalytics[] = [];
  let improvedCount = 0;
  let declinedCount = 0;
  let unchangedCount = 0;
  let deltaSum = 0;
  let comparedCount = 0;

  data.subjects.forEach((row) => {
    const bars: SubjectAssessmentBar[] = [];
    if (includeWeekly && row.weeklyMax > 0) {
      bars.push({
        key: 'WT',
        label: 'WT Avg',
        fullLabel: `Weekly Tests (${row.weeklyCount})`,
        obtained: Math.round(row.weeklyObtained * 10) / 10,
        max: Math.round(row.weeklyMax * 10) / 10,
        pct: Math.round((row.weeklyObtained / row.weeklyMax) * 1000) / 10,
        isAbsent: false,
      });
    }
    if (row.quarterlyObtained !== null) {
      bars.push({
        key: 'QTR',
        label: 'QTR',
        fullLabel: 'Quarterly Exam',
        obtained: row.quarterlyObtained,
        max: row.quarterlyMax,
        pct: row.quarterlyAbsent ? 0 : Math.round((row.quarterlyObtained / row.quarterlyMax) * 1000) / 10,
        isAbsent: row.quarterlyAbsent,
      });
    }
    if (row.halfYearlyObtained !== null) {
      bars.push({
        key: 'HY',
        label: 'HY',
        fullLabel: 'Half-Yearly Exam',
        obtained: row.halfYearlyObtained,
        max: row.halfYearlyMax,
        pct: row.halfYearlyAbsent ? 0 : Math.round((row.halfYearlyObtained / row.halfYearlyMax) * 1000) / 10,
        isAbsent: row.halfYearlyAbsent,
      });
    }
    if (row.annualObtained !== null) {
      bars.push({
        key: 'ANN',
        label: 'ANN',
        fullLabel: 'Annual Exam',
        obtained: row.annualObtained,
        max: row.annualMax,
        pct: row.annualAbsent ? 0 : Math.round((row.annualObtained / row.annualMax) * 1000) / 10,
        isAbsent: row.annualAbsent,
      });
    }

    if (bars.length === 0) return;

    let deltaPp: number | null = null;
    let fromLabel = '';
    let toLabel = '';
    let trend: 'improved' | 'declined' | 'neutral' | 'single' = 'single';

    if (bars.length >= 2) {
      const first = bars[0];
      const last = bars[bars.length - 1];
      deltaPp = Math.round((last.pct - first.pct) * 10) / 10;
      fromLabel = first.label;
      toLabel = last.label;
      if (deltaPp > 0) {
        trend = 'improved';
        improvedCount++;
      } else if (deltaPp < 0) {
        trend = 'declined';
        declinedCount++;
      } else {
        trend = 'neutral';
        unchangedCount++;
      }
      deltaSum += deltaPp;
      comparedCount++;
    }

    subjects.push({
      subjectKey: row.subjectKey,
      subjectLabel: row.subjectLabel,
      bars,
      deltaPp,
      fromLabel,
      toLabel,
      trend,
    });
  });

  const averageChangePp =
    comparedCount > 0 ? Math.round((deltaSum / comparedCount) * 10) / 10 : null;

  const presentKeys = new Set<string>();
  subjects.forEach((s) => s.bars.forEach((b) => presentKeys.add(b.label)));
  const orderedLabels = ['WT Avg', 'QTR', 'HY', 'ANN'].filter((k) => presentKeys.has(k));

  return {
    subjects,
    comparedCount,
    improvedCount,
    declinedCount,
    unchangedCount,
    averageChangePp,
    firstExamLabel: orderedLabels[0] || '',
    lastExamLabel: orderedLabels[orderedLabels.length - 1] || '',
    wtAvg: data.weeklySummary.testsCount > 0 && data.weeklySummary.max > 0 ? data.weeklySummary.pct : null,
    qtrAvg: data.quarterlySummary.hasData ? data.quarterlySummary.pct : null,
    hyAvg: data.halfYearlySummary.hasData ? data.halfYearlySummary.pct : null,
    annAvg: data.annualSummary.hasData ? data.annualSummary.pct : null,
    classRank: classRankInfo || { rank: 0, total: 0, label: '—' },
  };
};

