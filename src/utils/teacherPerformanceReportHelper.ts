import {
  ExamMarkRecord,
  ReportCardRemarkRecord,
  SchoolUser,
  StaffAttendanceRecord,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import {
  CURRENT_ACADEMIC_SESSION,
  ENGLISH_SUBJECT_LABELS,
  normalizeSubjectKey,
} from './reportCardHelper';
import { parseAssignedSubjects } from './teacherProfileHelper';

export type ReportTermScope = 'all' | 'Quarterly' | 'Half-Yearly' | 'Annual';

export interface SubjectTermBreakdown {
  subjectKey: string;
  subjectLabel: string;
  quarterlyPct: number | null;
  halfYearlyPct: number | null;
  annualPct: number | null;
  weeklyPct: number | null;
  overallPct: number | null;
  trendPp: number | null;
  entriesCount: number;
}

export interface ClassSubjectPerformanceRow {
  classKey: string;
  classLabel: string;
  subjectsLabel: string;
  studentsCount: number;
  evaluatedStudents: number;
  averagePct: number | null;
  trendPp: number | null;
}

export interface AssessmentCompletionItem {
  key: 'quarterly' | 'halfYearly' | 'annual' | 'reportCards';
  label: string;
  completed: number;
  total: number;
  pct: number;
}

export interface DistributionBucket {
  key: 'excellent' | 'good' | 'average' | 'support';
  label: string;
  subLabel: string;
  count: number;
  pct: number;
  barColor: string;
}

export interface TeacherPerformanceReportData {
  teacher: SchoolUser;
  session: string;
  termScope: ReportTermScope;
  roleLabel: string;
  departmentLabel: string;
  photoUrl: string;
  assignedClasses: { raw: string; key: string; label: string }[];
  assignedSubjects: string[];
  classesTaughtCount: number;
  totalStudentsCount: number;
  subjectsCount: number;
  teacherQrAttendancePct: number | null;
  teacherAttendanceDays: number;
  teacherTotalLoggedDays: number;
  studentClassAttendancePct: number | null;
  overallSubjectResultPct: number | null;
  overallTrendPp: number | null;
  subjectBreakdowns: SubjectTermBreakdown[];
  classRows: ClassSubjectPerformanceRow[];
  assessmentCompletion: {
    overallPct: number;
    items: AssessmentCompletionItem[];
    pendingDraftsCount: number;
  };
  distribution: DistributionBucket[];
  evaluatedStudentsTotal: number;
  insights: string[];
  hasAnyMarks: boolean;
}

export const normalizeClassToken = (cls: string | null | undefined, classMap?: Record<string, string>): string => {
  const raw = String(cls || '').trim();
  if (!raw) return '';

  let resolved = raw;
  if (classMap) {
    if (classMap[raw]) resolved = classMap[raw];
    else if (classMap[raw.toUpperCase()]) resolved = classMap[raw.toUpperCase()];
    else {
      const found = Object.entries(classMap).find(([k]) => k.toLowerCase() === raw.toLowerCase());
      if (found && found[1]) resolved = found[1];
    }
  }

  let tok = String(resolved || '')
    .trim()
    .toLowerCase()
    .replace(/^class[-\s]*/i, '')
    .replace(/^cls[-\s]*/i, '')
    .replace(/\s+/g, '');

  // Handle numeric ordinals like 5th -> 5, 1st -> 1, 2nd -> 2, 3rd -> 3
  tok = tok.replace(/^(\d+)(st|nd|rd|th)$/i, '$1');

  // Map common sheet codes (M1/Nursery, M2/LKG, M3/UKG, C1..C12 -> 1..12 or similar)
  const codeAliases: Record<string, string> = {
    m1: 'nursery',
    nur: 'nursery',
    nursery: 'nursery',
    m2: 'lkg',
    lkg: 'lkg',
    m3: 'ukg',
    ukg: 'ukg',
    c1: 'nursery',
    c2: 'lkg',
    c3: 'ukg',
    c4: '1',
    c5: '2',
    c6: '3',
    c7: '4',
    c8: '5',
    c9: '6',
    c10: '7',
    c11: '8',
    c12: '8',
  };

  if (!classMap && codeAliases[tok]) return codeAliases[tok];
  return tok;
};

export const formatClassDisplayLabel = (rawCls: string, classMap?: Record<string, string>): string => {
  const s = String(rawCls || '').trim();
  if (!s) return 'Unassigned';
  if (classMap) {
    if (classMap[s]) return String(classMap[s]);
    if (classMap[s.toUpperCase()]) return String(classMap[s.toUpperCase()]);
    const found = Object.entries(classMap).find(([k]) => k.toLowerCase() === s.toLowerCase());
    if (found && found[1]) return String(found[1]);
  }
  return s.replace(/^Class\s+/i, '');
};

const parseTeacherClassTokens = (
  rawClassStr: string | undefined,
  classMap?: Record<string, string>
): { raw: string; key: string; label: string }[] => {
  const raw = String(rawClassStr || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/[,;|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: { raw: string; key: string; label: string }[] = [];
  for (const p of parts) {
    if (/^all$/i.test(p)) continue;
    const key = normalizeClassToken(p, classMap);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: p, key, label: formatClassDisplayLabel(p, classMap) });
  }
  return out;
};

const formatCleanSubjectLabel = (raw: string): string => {
  const key = normalizeSubjectKey(raw);
  if (key && ENGLISH_SUBJECT_LABELS[key]) return ENGLISH_SUBJECT_LABELS[key];
  const stripped = String(raw || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  return stripped || raw.trim() || 'General';
};

const round1 = (val: number): number => Math.round(val * 10) / 10;

export const buildTeacherPerformanceReport = (params: {
  teacher: SchoolUser;
  students: Student[];
  examMarks: ExamMarkRecord[];
  pendingMarks?: ExamMarkRecord[];
  weeklyTests?: WeeklyTestRecord[];
  staffAttendance?: StaffAttendanceRecord[];
  behaviorList?: StudentBehaviorRecord[];
  reportCardMeta?: Record<string, ReportCardRemarkRecord>;
  classMap?: Record<string, string>;
  termScope?: ReportTermScope;
  session?: string;
}): TeacherPerformanceReportData => {
  const {
    teacher,
    students,
    examMarks,
    pendingMarks = [],
    weeklyTests = [],
    staffAttendance = [],
    behaviorList = [],
    reportCardMeta = {},
    classMap,
    termScope = 'all',
    session = CURRENT_ACADEMIC_SESSION,
  } = params;

  const tUid = String(teacher.User_ID || '').trim().toLowerCase();
  const tUname = String(teacher.Username || '').trim().toLowerCase();
  const tName = String(teacher.Name || '').trim().toLowerCase();

  const assignedClassItems = parseTeacherClassTokens(teacher.Assigned_Class, classMap);
  const assignedClassKeySet = new Set(assignedClassItems.map((c) => c.key));

  const configuredSubjects = parseAssignedSubjects(teacher.Assigned_Subjects);
  const configuredSubjectKeys = new Set(
    configuredSubjects.map((s) => normalizeSubjectKey(s) || s.toLowerCase())
  );

  // Determine whether an exam mark / weekly test belongs to this teacher
  const matchesTeacherMark = (m: {
    teacher_id?: string;
    teacher_name?: string;
    class_name?: string;
    subject?: string;
    session?: string;
  }): boolean => {
    if (m.session && m.session !== session) return false;

    const mTid = String(m.teacher_id || '').trim().toLowerCase();
    const mTname = String(m.teacher_name || '').trim().toLowerCase();

    if (mTid && ((tUid && mTid === tUid) || (tUname && mTid === tUname))) {
      return true;
    }
    if (mTname && tName && mTname === tName) {
      return true;
    }

    // Fallback: match by teacher's assigned classes + assigned subjects
    const mClsKey = normalizeClassToken(m.class_name, classMap);
    if (!mClsKey || !assignedClassKeySet.has(mClsKey)) return false;

    if (configuredSubjectKeys.size === 0) return true;
    const mSubKey = normalizeSubjectKey(m.subject || '') || String(m.subject || '').trim().toLowerCase();
    return configuredSubjectKeys.has(mSubKey);
  };

  // Deduplicate examMarks keeping newest update for each (session, exam_type, student_id, subject)
  const dedupedMarksMap = new Map<string, ExamMarkRecord>();
  [...examMarks]
    .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')))
    .forEach((m) => {
      if (!matchesTeacherMark(m)) return;
      const k = `${String(m.session || session).toLowerCase()}::${String(m.exam_type || '').toLowerCase()}::${String(m.student_id || '').toLowerCase()}::${normalizeSubjectKey(m.subject || '')}`;
      dedupedMarksMap.set(k, m);
    });
  const allMatchedMarks = Array.from(dedupedMarksMap.values());

  const matchedPendingMarks = pendingMarks.filter((m) => matchesTeacherMark(m));
  const matchedWeeklyTests = weeklyTests.filter((wt) =>
    matchesTeacherMark({
      teacher_id: wt.teacher_id,
      teacher_name: wt.teacher_name,
      class_name: wt.class_name,
      subject: wt.subject,
    })
  );

  // Scoped marks based on selected term filter
  const scopedMarks =
    termScope === 'all'
      ? allMatchedMarks
      : allMatchedMarks.filter((m) => m.exam_type === termScope);

  // Union of classes from explicit Assigned_Class + any classes where teacher entered marks
  const classMapEntries = new Map<string, { raw: string; key: string; label: string }>();
  assignedClassItems.forEach((c) => classMapEntries.set(c.key, c));
  allMatchedMarks.forEach((m) => {
    const key = normalizeClassToken(m.class_name, classMap);
    if (key && !classMapEntries.has(key)) {
      classMapEntries.set(key, {
        raw: m.class_name,
        key,
        label: formatClassDisplayLabel(m.class_name, classMap),
      });
    }
  });
  matchedWeeklyTests.forEach((wt) => {
    const key = normalizeClassToken(wt.class_name, classMap);
    if (key && !classMapEntries.has(key)) {
      classMapEntries.set(key, {
        raw: wt.class_name,
        key,
        label: formatClassDisplayLabel(wt.class_name, classMap),
      });
    }
  });
  const finalClasses = Array.from(classMapEntries.values());
  const finalClassKeySet = new Set(finalClasses.map((c) => c.key));

  // Students in teacher's classes
  const teacherStudents = students.filter((st) => {
    const stKey = normalizeClassToken(st.Class, classMap);
    return stKey && finalClassKeySet.has(stKey);
  });
  const teacherStudentIds = new Set(teacherStudents.map((s) => String(s.Student_ID || '').trim().toLowerCase()));

  // Subjects taught: configured + detected from marks/weekly tests
  const subjectNamesByKey = new Map<string, string>();
  configuredSubjects.forEach((s) => {
    const k = normalizeSubjectKey(s) || s.toLowerCase();
    if (k) subjectNamesByKey.set(k, formatCleanSubjectLabel(s));
  });
  allMatchedMarks.forEach((m) => {
    const k = normalizeSubjectKey(m.subject) || String(m.subject || '').trim().toLowerCase();
    if (k && !subjectNamesByKey.has(k)) {
      subjectNamesByKey.set(k, formatCleanSubjectLabel(m.subject));
    }
  });
  matchedWeeklyTests.forEach((wt) => {
    const k = normalizeSubjectKey(wt.subject) || String(wt.subject || '').trim().toLowerCase();
    if (k && !subjectNamesByKey.has(k)) {
      subjectNamesByKey.set(k, formatCleanSubjectLabel(wt.subject));
    }
  });

  const finalSubjectLabels = Array.from(subjectNamesByKey.values());

  // Subject-wise Performance Breakdown
  const subjectBreakdowns: SubjectTermBreakdown[] = Array.from(subjectNamesByKey.entries()).map(
    ([subKey, subLabel]) => {
      const subMarksAll = allMatchedMarks.filter(
        (m) => (normalizeSubjectKey(m.subject) || String(m.subject || '').trim().toLowerCase()) === subKey
      );
      const subWeeklyAll = matchedWeeklyTests.filter(
        (wt) => (normalizeSubjectKey(wt.subject) || String(wt.subject || '').trim().toLowerCase()) === subKey
      );

      const calcTermAvg = (term: 'Quarterly' | 'Half-Yearly' | 'Annual'): number | null => {
        const list = subMarksAll.filter((m) => m.exam_type === term && Number(m.max_marks) > 0);
        if (list.length === 0) return null;
        let sumPct = 0;
        list.forEach((m) => {
          const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
          sumPct += (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
        });
        return round1(sumPct / list.length);
      };

      const qPct = termScope === 'all' || termScope === 'Quarterly' ? calcTermAvg('Quarterly') : null;
      const hPct = termScope === 'all' || termScope === 'Half-Yearly' ? calcTermAvg('Half-Yearly') : null;
      const aPct = termScope === 'all' || termScope === 'Annual' ? calcTermAvg('Annual') : null;

      let wPct: number | null = null;
      if (termScope === 'all' && subWeeklyAll.length > 0) {
        let wSum = 0;
        let wCount = 0;
        subWeeklyAll.forEach((wt) => {
          const mx = Number(wt.max_marks) || 0;
          if (mx <= 0) return;
          const ob = wt.attendance_status === 'Absent' ? 0 : Math.max(0, Number(wt.marks_obtained) || 0);
          wSum += (ob / mx) * 100;
          wCount++;
        });
        if (wCount > 0) wPct = round1(wSum / wCount);
      }

      const scopedSubMarks =
        termScope === 'all' ? subMarksAll : subMarksAll.filter((m) => m.exam_type === termScope);

      let overallPct: number | null = null;
      if (scopedSubMarks.length > 0) {
        let totPct = 0;
        scopedSubMarks.forEach((m) => {
          const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
          totPct += (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
        });
        overallPct = round1(totPct / scopedSubMarks.length);
      } else if (wPct !== null) {
        overallPct = wPct;
      }

      // Real pp trend across terms (always measured against earliest -> latest available term)
      const qFull = calcTermAvg('Quarterly');
      const hFull = calcTermAvg('Half-Yearly');
      const aFull = calcTermAvg('Annual');
      const orderedTerms = [qFull, hFull, aFull].filter((v): v is number => v !== null);
      let trendPp: number | null = null;
      if (orderedTerms.length >= 2) {
        trendPp = round1(orderedTerms[orderedTerms.length - 1] - orderedTerms[0]);
      }

      return {
        subjectKey: subKey,
        subjectLabel: subLabel,
        quarterlyPct: qPct,
        halfYearlyPct: hPct,
        annualPct: aPct,
        weeklyPct: wPct,
        overallPct,
        trendPp,
        entriesCount: scopedSubMarks.length + (termScope === 'all' ? subWeeklyAll.length : 0),
      };
    }
  );

  // Class-wise Subject Performance Table
  const classRows: ClassSubjectPerformanceRow[] = finalClasses.map((cls) => {
    const classStudents = students.filter(
      (s) => normalizeClassToken(s.Class, classMap) === cls.key
    );
    const clsMarksAll = allMatchedMarks.filter(
      (m) => normalizeClassToken(m.class_name, classMap) === cls.key
    );
    const clsScopedMarks = scopedMarks.filter(
      (m) => normalizeClassToken(m.class_name, classMap) === cls.key
    );

    const clsSubjects = new Set<string>();
    clsScopedMarks.forEach((m) => clsSubjects.add(formatCleanSubjectLabel(m.subject)));
    if (clsSubjects.size === 0) {
      finalSubjectLabels.forEach((lbl) => clsSubjects.add(lbl));
    }

    let averagePct: number | null = null;
    const evalStudentSet = new Set<string>();
    if (clsScopedMarks.length > 0) {
      let sumPct = 0;
      clsScopedMarks.forEach((m) => {
        const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
        sumPct += (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
        if (m.student_id) evalStudentSet.add(String(m.student_id).trim().toLowerCase());
      });
      averagePct = round1(sumPct / clsScopedMarks.length);
    }

    const termAvgForClass = (term: 'Quarterly' | 'Half-Yearly' | 'Annual'): number | null => {
      const list = clsMarksAll.filter((m) => m.exam_type === term && Number(m.max_marks) > 0);
      if (list.length === 0) return null;
      const sum = list.reduce((acc, m) => {
        const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
        return acc + (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
      }, 0);
      return round1(sum / list.length);
    };
    const clsTermSequence = [
      termAvgForClass('Quarterly'),
      termAvgForClass('Half-Yearly'),
      termAvgForClass('Annual'),
    ].filter((v): v is number => v !== null);
    const trendPp =
      clsTermSequence.length >= 2
        ? round1(clsTermSequence[clsTermSequence.length - 1] - clsTermSequence[0])
        : null;

    return {
      classKey: cls.key,
      classLabel: cls.label,
      subjectsLabel: clsSubjects.size > 0 ? Array.from(clsSubjects).join(', ') : 'All Assigned',
      studentsCount: classStudents.length,
      evaluatedStudents: evalStudentSet.size,
      averagePct,
      trendPp,
    };
  });

  // Overall Avg Subject Result %
  let overallSubjectResultPct: number | null = null;
  if (scopedMarks.length > 0) {
    const sum = scopedMarks.reduce((acc, m) => {
      const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
      return acc + (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
    }, 0);
    overallSubjectResultPct = round1(sum / scopedMarks.length);
  } else if (subjectBreakdowns.some((s) => s.overallPct !== null)) {
    const valid = subjectBreakdowns.filter((s) => s.overallPct !== null);
    overallSubjectResultPct = round1(
      valid.reduce((acc, s) => acc + (s.overallPct || 0), 0) / Math.max(1, valid.length)
    );
  }

  // Overall Trend across terms
  const calcGlobalTermAvg = (term: 'Quarterly' | 'Half-Yearly' | 'Annual'): number | null => {
    const list = allMatchedMarks.filter((m) => m.exam_type === term && Number(m.max_marks) > 0);
    if (list.length === 0) return null;
    const sum = list.reduce((acc, m) => {
      const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
      return acc + (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
    }, 0);
    return round1(sum / list.length);
  };
  const globalSeq = [
    calcGlobalTermAvg('Quarterly'),
    calcGlobalTermAvg('Half-Yearly'),
    calcGlobalTermAvg('Annual'),
  ].filter((v): v is number => v !== null);
  const overallTrendPp =
    globalSeq.length >= 2 ? round1(globalSeq[globalSeq.length - 1] - globalSeq[0]) : null;

  // Teacher QR Attendance %
  const myStaffLogs = staffAttendance.filter((rec) => {
    const rUid = String(rec.user_id || '').trim().toLowerCase();
    const rUn = String(rec.username || '').trim().toLowerCase();
    const rNm = String(rec.name || '').trim().toLowerCase();
    return (
      (tUid && rUid === tUid) ||
      (tUname && (rUn === tUname || rUid === tUname)) ||
      (tName && rNm === tName)
    );
  });
  const presentStaffDays = myStaffLogs.filter(
    (r) => r.status === 'Present' || r.status === 'Late' || r.status === 'Half-Day' || r.status === 'On-Duty'
  ).length;
  const teacherQrAttendancePct =
    myStaffLogs.length > 0 ? round1((presentStaffDays / myStaffLogs.length) * 100) : null;

  // Student Class Attendance % (from behaviorList)
  let studentClassAttendancePct: number | null = null;
  const classBehaviorLogs = behaviorList.filter((b) => {
    const bCls = normalizeClassToken(b.Class, classMap);
    const bSid = String(b.Student_ID || '').trim().toLowerCase();
    return (bCls && finalClassKeySet.has(bCls)) || (bSid && teacherStudentIds.has(bSid));
  });
  if (classBehaviorLogs.length > 0) {
    const pres = classBehaviorLogs.filter((b) => b.Is_Present).length;
    studentClassAttendancePct = round1((pres / classBehaviorLogs.length) * 100);
  }

  // Assessment Completion Checklist
  const expectedClassSubjects = Math.max(
    1,
    finalClasses.length * Math.max(1, finalSubjectLabels.length)
  );
  const countCompletedPairsForTerm = (term: 'Quarterly' | 'Half-Yearly' | 'Annual'): number => {
    const pairSet = new Set<string>();
    allMatchedMarks
      .filter((m) => m.exam_type === term)
      .forEach((m) => {
        const ck = normalizeClassToken(m.class_name, classMap) || 'cls';
        const sk = normalizeSubjectKey(m.subject) || 'sub';
        pairSet.add(`${ck}::${sk}`);
      });
    return Math.min(expectedClassSubjects, pairSet.size);
  };

  const qCompleted = countCompletedPairsForTerm('Quarterly');
  const hCompleted = countCompletedPairsForTerm('Half-Yearly');
  const aCompleted = countCompletedPairsForTerm('Annual');

  // Report cards / remarks completed for teacher's students
  const rcTotalStudents = Math.max(
    teacherStudents.length,
    new Set(allMatchedMarks.map((m) => String(m.student_id || '').trim().toLowerCase()).filter(Boolean)).size
  );
  let rcCompletedCount = 0;
  if (rcTotalStudents > 0) {
    const studentListForRc =
      teacherStudents.length > 0
        ? teacherStudents.map((s) => String(s.Student_ID || '').trim())
        : Array.from(new Set(allMatchedMarks.map((m) => String(m.student_id || '').trim()).filter(Boolean)));
    studentListForRc.forEach((sid) => {
      const k1 = `${session}::${sid}`;
      const meta = reportCardMeta[k1] || reportCardMeta[sid];
      const hasAnyMarksForSid = allMatchedMarks.some(
        (m) => String(m.student_id || '').trim().toLowerCase() === sid.toLowerCase()
      );
      if (meta || hasAnyMarksForSid) rcCompletedCount++;
    });
  }

  const completionItems: AssessmentCompletionItem[] = [
    {
      key: 'quarterly',
      label: 'Quarterly Marks Entry',
      completed: qCompleted,
      total: expectedClassSubjects,
      pct: Math.round((qCompleted / expectedClassSubjects) * 100),
    },
    {
      key: 'halfYearly',
      label: 'Half-Yearly Marks Entry',
      completed: hCompleted,
      total: expectedClassSubjects,
      pct: Math.round((hCompleted / expectedClassSubjects) * 100),
    },
    {
      key: 'annual',
      label: 'Annual Marks Entry',
      completed: aCompleted,
      total: expectedClassSubjects,
      pct: Math.round((aCompleted / expectedClassSubjects) * 100),
    },
    {
      key: 'reportCards',
      label: 'Report Cards Ready',
      completed: rcCompletedCount,
      total: Math.max(1, rcTotalStudents),
      pct: rcTotalStudents > 0 ? Math.round((rcCompletedCount / rcTotalStudents) * 100) : 0,
    },
  ];
  const overallCompletionPct = Math.round(
    completionItems.reduce((acc, it) => acc + it.pct, 0) / completionItems.length
  );

  // Student Performance Distribution (across scoped marks grouped per student)
  const studentScoresMap = new Map<string, { sumPct: number; count: number }>();
  scopedMarks.forEach((m) => {
    const sid = String(m.student_id || '').trim().toLowerCase();
    if (!sid || Number(m.max_marks) <= 0) return;
    const obt = m.attendance_status === 'Absent' ? 0 : Math.max(0, Number(m.marks_obtained) || 0);
    const pct = (obt / Math.max(1, Number(m.max_marks) || 100)) * 100;
    const cur = studentScoresMap.get(sid) || { sumPct: 0, count: 0 };
    cur.sumPct += pct;
    cur.count += 1;
    studentScoresMap.set(sid, cur);
  });

  let bExcel = 0;
  let bGood = 0;
  let bAvg = 0;
  let bSupport = 0;
  studentScoresMap.forEach((v) => {
    const avg = v.sumPct / Math.max(1, v.count);
    if (avg >= 90) bExcel++;
    else if (avg >= 75) bGood++;
    else if (avg >= 60) bAvg++;
    else bSupport++;
  });
  const evalStudentsTotal = studentScoresMap.size;
  const pctOfEval = (cnt: number) => (evalStudentsTotal > 0 ? round1((cnt / evalStudentsTotal) * 100) : 0);

  const distribution: DistributionBucket[] = [
    {
      key: 'excellent',
      label: '>= 90%',
      subLabel: 'Excellent',
      count: bExcel,
      pct: pctOfEval(bExcel),
      barColor: 'bg-emerald-500',
    },
    {
      key: 'good',
      label: '75–89%',
      subLabel: 'Good',
      count: bGood,
      pct: pctOfEval(bGood),
      barColor: 'bg-blue-600',
    },
    {
      key: 'average',
      label: '60–74%',
      subLabel: 'Average',
      count: bAvg,
      pct: pctOfEval(bAvg),
      barColor: 'bg-amber-500',
    },
    {
      key: 'support',
      label: '< 60%',
      subLabel: 'Needs Support',
      count: bSupport,
      pct: pctOfEval(bSupport),
      barColor: 'bg-rose-500',
    },
  ];

  // Dynamic, strictly factual Key Insights
  const insights: string[] = [];
  if (overallSubjectResultPct !== null) {
    const trendTxt =
      overallTrendPp !== null
        ? ` (${overallTrendPp >= 0 ? '+' : ''}${overallTrendPp} pp across terms)`
        : '';
    insights.push(`Overall subject result stands at ${overallSubjectResultPct}%${trendTxt}.`);
  } else {
    insights.push('No approved term exam marks recorded yet for the selected scope.');
  }

  const scoredClasses = classRows
    .filter((c) => c.averagePct !== null)
    .sort((a, b) => (b.averagePct || 0) - (a.averagePct || 0));
  if (scoredClasses.length > 0) {
    const bestCls = scoredClasses[0];
    insights.push(`Best performing class: Class ${bestCls.classLabel} (${bestCls.averagePct}%).`);
  }

  if (evalStudentsTotal > 0) {
    const excelPct = pctOfEval(bExcel);
    insights.push(`${excelPct}% of evaluated students (${bExcel}/${evalStudentsTotal}) scored >= 90%.`);
    if (bSupport > 0) {
      insights.push(`${bSupport} student${bSupport > 1 ? 's' : ''} scored below 60% and need targeted remedial support.`);
    }
  }

  if (overallCompletionPct === 100) {
    insights.push('All scheduled term assessments and report cards are 100% completed.');
  } else {
    insights.push(
      `Assessment completion is at ${overallCompletionPct}%${
        matchedPendingMarks.length > 0 ? ` (${matchedPendingMarks.length} pending marks awaiting manager approval)` : ''
      }.`
    );
  }

  if (teacherQrAttendancePct !== null) {
    insights.push(`Teacher QR staff attendance rate is ${teacherQrAttendancePct}% (${presentStaffDays}/${myStaffLogs.length} logged days).`);
  }

  const roleLabel =
    finalClasses.length > 0
      ? `Class Teacher (${finalClasses.map((c) => c.label).slice(0, 3).join(', ')}${finalClasses.length > 3 ? ` +${finalClasses.length - 3}` : ''})`
      : teacher.Designation || 'Subject Teacher';

  const departmentLabel =
    String(teacher.Department || '').trim() ||
    (finalSubjectLabels.length > 0 ? finalSubjectLabels.slice(0, 2).join(' & ') : teacher.Designation || 'Academic Faculty');

  return {
    teacher,
    session,
    termScope,
    roleLabel,
    departmentLabel,
    photoUrl: String(teacher.Teacher_Photo || '').trim(),
    assignedClasses: finalClasses,
    assignedSubjects: finalSubjectLabels,
    classesTaughtCount: finalClasses.length,
    totalStudentsCount: teacherStudents.length || evalStudentsTotal,
    subjectsCount: finalSubjectLabels.length,
    teacherQrAttendancePct,
    teacherAttendanceDays: presentStaffDays,
    teacherTotalLoggedDays: myStaffLogs.length,
    studentClassAttendancePct,
    overallSubjectResultPct,
    overallTrendPp,
    subjectBreakdowns,
    classRows,
    assessmentCompletion: {
      overallPct: overallCompletionPct,
      items: completionItems,
      pendingDraftsCount: matchedPendingMarks.length,
    },
    distribution,
    evaluatedStudentsTotal: evalStudentsTotal,
    insights,
    hasAnyMarks: allMatchedMarks.length > 0 || matchedWeeklyTests.length > 0,
  };
};
