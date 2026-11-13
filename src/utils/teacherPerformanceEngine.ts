import {
  SchoolUser,
  Homework,
  HomeworkTrackerRecord,
  StudentBehaviorRecord,
  StaffAttendanceRecord,
  Student,
  SyllabusTopicRecord,
} from '../types';
import {
  TeacherPerformanceRecord,
  MonthlyLeaderboardSummary,
  TeacherOfTheYearResult,
} from '../types/teacherPerformance';

export const PERFORMANCE_CACHE_KEY = 'evs_teacher_performance_records_v1';
export const CURRENT_ACADEMIC_YEAR = '2026-2027';

export const ACADEMIC_MONTHS = [
  { key: '2026-04', label: 'अप्रैल 2026 (April)' },
  { key: '2026-05', label: 'मई 2026 (May)' },
  { key: '2026-07', label: 'जुलाई 2026 (July)' },
  { key: '2026-08', label: 'अगस्त 2026 (August)' },
  { key: '2026-09', label: 'सितंबर 2026 (September)' },
  { key: '2026-10', label: 'अक्टूबर 2026 (October)' },
  { key: '2026-11', label: 'नवंबर 2026 (November)' },
  { key: '2026-12', label: 'दिसंबर 2026 (December)' },
  { key: '2027-01', label: 'जनवरी 2027 (January)' },
  { key: '2027-02', label: 'फ़रवरी 2027 (February)' },
  { key: '2027-03', label: 'मार्च 2027 (March)' },
];

export const getDefaultAcademicMonth = (): string => {
  const ym = new Date().toISOString().slice(0, 7);
  if (ACADEMIC_MONTHS.some((m) => m.key === ym)) return ym;
  return '2026-11';
};

const normalizeDateYmd = (val: any): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parts = s.split(/[-/.]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return s;
};

const normalizeClassKey = (raw: any, classMap?: Record<string, string>): string => {
  if (raw === undefined || raw === null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (classMap && classMap[s]) {
    s = String(classMap[s]).trim();
  }
  return s
    .toLowerCase()
    .replace(/^class\s+/i, '')
    .replace(/^कक्षा\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const getTeacherAssignedClassKeys = (teacher: SchoolUser, classMap?: Record<string, string>): string[] => {
  let raw = String(teacher.Assigned_Class || '').trim();
  if (!raw && typeof window !== 'undefined') {
    try {
      const saved = localStorage.getItem('teacher_class_assignments');
      if (saved) {
        const map = JSON.parse(saved);
        raw = String(
          map[teacher.User_ID] ||
            map[teacher.Username || ''] ||
            map[teacher.Name || ''] ||
            ''
        ).trim();
      }
    } catch {}
  }
  if (!raw) return [];
  return raw
    .split(/[,;|]+/)
    .map((part) => normalizeClassKey(part, classMap))
    .filter(Boolean);
};

const parseCheckInMinutes = (timeStr?: string): number | null => {
  if (!timeStr) return null;
  const s = String(timeStr).trim().toUpperCase();
  const isPM = s.includes('PM');
  const isAM = s.includes('AM');
  const clean = s.replace(/AM|PM/g, '').trim();
  const match = clean.match(/(\d{1,2}):(\d{1,2})/);
  if (!match) return null;
  let hr = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  if (isNaN(hr) || isNaN(min)) return null;
  if (isPM && hr < 12) hr += 12;
  if (isAM && hr === 12) hr = 0;
  return hr * 60 + min;
};

/**
 * 1. Automatic Monthly Score & Grade Calculation
 * Sums all 5 key parameters strictly within weightage boundaries
 */
export const calculateMonthlyScore = (params: {
  syllabusProgress: number; // Max 30
  studentTest: number; // Max 25
  attendanceLogging: number; // Max 15
  homeworkEvaluation: number; // Max 15
  punctualityDiscipline: number; // Max 15
}): { totalScore: number; grade: 'A+' | 'A' | 'B' | 'C' | 'D' } => {
  const syllabus = Math.max(0, Math.min(30, Number(params.syllabusProgress) || 0));
  const test = Math.max(0, Math.min(25, Number(params.studentTest) || 0));
  const attendance = Math.max(0, Math.min(15, Number(params.attendanceLogging) || 0));
  const homework = Math.max(0, Math.min(15, Number(params.homeworkEvaluation) || 0));
  const punctuality = Math.max(0, Math.min(15, Number(params.punctualityDiscipline) || 0));

  const total = Math.round((syllabus + test + attendance + homework + punctuality) * 10) / 10;

  let grade: 'A+' | 'A' | 'B' | 'C' | 'D' = 'D';
  if (total >= 90) grade = 'A+';
  else if (total >= 80) grade = 'A';
  else if (total >= 70) grade = 'B';
  else if (total >= 60) grade = 'C';
  else grade = 'D';

  return { totalScore: total, grade };
};

/**
 * 2. Automated Monthly Leaderboard Ranking Logic
 * Sorts all teachers for a given month in descending order of Monthly_Total_Score
 */
export const computeMonthlyLeaderboard = (
  records: TeacherPerformanceRecord[],
  targetMonth: string,
  teachersList: SchoolUser[] = []
): MonthlyLeaderboardSummary => {
  // Filter records for the specified month
  const monthRecords = records.filter(
    (r) => String(r.month || '').trim().toLowerCase() === String(targetMonth || '').trim().toLowerCase()
  );

  // If a teacher doesn't have an entry for this month yet, optionally represent them
  const recordsMap = new Map<string, TeacherPerformanceRecord>();
  monthRecords.forEach((r) => recordsMap.set(String(r.teacher_id).trim(), r));

  const activeRankings: Array<TeacherPerformanceRecord & { rank: number; percentile: number }> = [];

  // Sort descending by monthly_total_score
  const sorted = [...monthRecords].sort((a, b) => b.monthly_total_score - a.monthly_total_score);

  sorted.forEach((rec, idx) => {
    const rank = idx + 1;
    const percentile = sorted.length > 1
      ? Math.round(((sorted.length - idx) / sorted.length) * 100)
      : 100;
    activeRankings.push({
      ...rec,
      rank,
      percentile,
    });
  });

  const totalScore = activeRankings.reduce((sum, r) => sum + r.monthly_total_score, 0);
  const averageSchoolScore = activeRankings.length > 0
    ? Math.round((totalScore / activeRankings.length) * 10) / 10
    : 0;

  return {
    month: targetMonth,
    academic_year: CURRENT_ACADEMIC_YEAR,
    totalTeachersEvaluated: activeRankings.length,
    averageSchoolScore,
    topScorer: activeRankings[0] || null,
    rankings: activeRankings,
  };
};

/**
 * 3. Automated "Teacher of the Year" Selection Engine
 * Aggregates all monthly evaluations across the entire academic year (12 months).
 * Computes Annual Average Score = Sum of Monthly Scores ÷ Total Months Evaluated.
 * The teacher with the highest overall annual average is selected as "Teacher of the Year".
 */
export const computeTeacherOfTheYear = (
  allRecords: TeacherPerformanceRecord[],
  academicYear: string = CURRENT_ACADEMIC_YEAR
): TeacherOfTheYearResult => {
  const yearRecords = allRecords.filter(
    (r) => !r.academic_year || r.academic_year === academicYear
  );

  // Group by teacher_id
  const teacherMap = new Map<string, TeacherPerformanceRecord[]>();
  yearRecords.forEach((r) => {
    const tid = String(r.teacher_id).trim();
    if (!teacherMap.has(tid)) {
      teacherMap.set(tid, []);
    }
    teacherMap.get(tid)!.push(r);
  });

  const summaryList: Array<{
    rank: number;
    teacher_id: string;
    teacher_name: string;
    assigned_class?: string;
    annualAverageScore: number;
    totalMonthsEvaluated: number;
    highestMonthScore: number;
    lowestMonthScore: number;
    consistencyScore: number;
    consistencyRating: string;
    bestMonth: string;
    grade: 'A+' | 'A' | 'B' | 'C' | 'D';
    records: TeacherPerformanceRecord[];
  }> = [];

  teacherMap.forEach((records, teacherId) => {
    if (records.length === 0) return;
    const teacherName = records[0].teacher_name || 'शिक्षक';
    const assignedClass = records[0].assigned_class || '';

    // Calculate sum of monthly scores
    const sum = records.reduce((acc, curr) => acc + curr.monthly_total_score, 0);
    const monthsCount = records.length;
    const avg = Math.round((sum / monthsCount) * 10) / 10;

    let highest = -Infinity;
    let lowest = Infinity;
    let bestMonth = '';

    records.forEach((r) => {
      if (r.monthly_total_score > highest) {
        highest = r.monthly_total_score;
        bestMonth = r.month;
      }
      if (r.monthly_total_score < lowest) {
        lowest = r.monthly_total_score;
      }
    });

    // Consistency rating: standard deviation or delta
    const delta = highest - lowest;
    const consistencyScore = Math.max(0, 100 - delta * 3);
    let consistencyRating = 'उत्कृष्ट स्थिरता (Very Consistent)';
    if (delta > 20) consistencyRating = 'परिवर्तनशील (Variable)';
    else if (delta > 10) consistencyRating = 'संतोषजनक (Moderate)';

    let grade: 'A+' | 'A' | 'B' | 'C' | 'D' = 'D';
    if (avg >= 90) grade = 'A+';
    else if (avg >= 80) grade = 'A';
    else if (avg >= 70) grade = 'B';
    else if (avg >= 60) grade = 'C';

    summaryList.push({
      rank: 0,
      teacher_id: teacherId,
      teacher_name: teacherName,
      assigned_class: assignedClass,
      annualAverageScore: avg,
      totalMonthsEvaluated: monthsCount,
      highestMonthScore: highest,
      lowestMonthScore: lowest,
      consistencyScore,
      consistencyRating,
      bestMonth,
      grade,
      records,
    });
  });

  // Sort descending by Annual Average Score
  summaryList.sort((a, b) => b.annualAverageScore - a.annualAverageScore);

  summaryList.forEach((s, idx) => {
    s.rank = idx + 1;
  });

  const winner = summaryList.length > 0 ? summaryList[0] : null;

  return {
    winner,
    allAnnualRankings: summaryList.map((s) => ({
      rank: s.rank,
      teacher_id: s.teacher_id,
      teacher_name: s.teacher_name,
      assigned_class: s.assigned_class,
      annualAverageScore: s.annualAverageScore,
      totalMonthsEvaluated: s.totalMonthsEvaluated,
      consistencyRating: s.consistencyRating,
      grade: s.grade,
    })),
    academic_year: academicYear,
  };
};

/**
 * 4. Automated Parameter Calculation from Real App Data
 * Automatically extracts and computes scores for the 5 parameters by inspecting:
 * 1. Syllabus Progress (Max 30) -> Homework lesson plans, chapter coverage & curriculum tasks
 * 2. Student Test Results (Max 25) -> Class test average marks & academic test logs
 * 3. Student Attendance & App Logs (Max 15) -> Daily classroom attendance register logs
 * 4. Homework & Notebook Evaluation (Max 15) -> Daily homework posting & notebook checking records
 * 5. Punctuality & School Discipline (Max 15) -> Staff QR code attendance check-in timestamps & arrival status
 */
export interface AutoCalculationBreakdown {
  syllabus: { score: number; max: number; detail: string; percent: number };
  test: { score: number; max: number; detail: string; percent: number };
  attendance: { score: number; max: number; detail: string; percent: number };
  homework: { score: number; max: number; detail: string; percent: number };
  punctuality: { score: number; max: number; detail: string; percent: number };
}

export interface AutoCalculationResult {
  record: TeacherPerformanceRecord;
  breakdown: AutoCalculationBreakdown;
}

export const autoCalculateTeacherMonthlyScoreFromAppData = (params: {
  teacher: SchoolUser;
  month: string; // e.g. "2026-11"
  academicYear?: string;
  homeworkList?: Homework[];
  homeworkTrackerList?: HomeworkTrackerRecord[];
  staffAttendanceList?: StaffAttendanceRecord[];
  behaviorList?: StudentBehaviorRecord[];
  students?: Student[];
  syllabusTopics?: SyllabusTopicRecord[];
  classMap?: Record<string, string>;
  evaluatedBy?: string;
}): AutoCalculationResult => {
  const {
    teacher,
    month,
    academicYear = CURRENT_ACADEMIC_YEAR,
    homeworkList = [],
    homeworkTrackerList = [],
    staffAttendanceList = [],
    behaviorList = [],
    students = [],
    syllabusTopics = [],
    classMap,
    evaluatedBy = 'AI Auto Engine (App Database)',
  } = params;

  const teacherName = String(teacher.Name || teacher.Username || 'शिक्षक').trim();
  const teacherUsername = String(teacher.Username || '').trim();
  const teacherId = String(teacher.User_ID || teacher.Username || '').trim();
  const teacherNameLower = teacherName.toLowerCase();
  const teacherUsernameLower = teacherUsername.toLowerCase();
  const teacherIdLower = teacherId.toLowerCase();

  const assignedClassKeys = getTeacherAssignedClassKeys(teacher, classMap);
  const assignedClassDisplay = teacher.Assigned_Class || (assignedClassKeys.length > 0 ? assignedClassKeys.join(', ') : '');

  // Helper: does record belong to this teacher's identity?
  const matchesTeacherIdentity = (val?: string): boolean => {
    if (!val) return false;
    const v = String(val).trim().toLowerCase();
    if (!v) return false;
    return (
      (teacherIdLower && v === teacherIdLower) ||
      (teacherUsernameLower && v === teacherUsernameLower) ||
      (teacherNameLower && (v === teacherNameLower || v.includes(teacherNameLower) || teacherNameLower.includes(v)))
    );
  };

  // Pre-build student -> normalized class map for fast fallback lookup
  const studentClassLookup = new Map<string, string>();
  for (const st of students) {
    if (st?.Student_ID) {
      studentClassLookup.set(String(st.Student_ID).trim().toLowerCase(), normalizeClassKey(st.Class, classMap));
    }
  }

  // Filter homework assigned in this month specifically by THIS teacher (or their assigned classes if Teacher field empty)
  const teacherMonthHw = homeworkList.filter((h) => {
    const ymd = normalizeDateYmd(h.Date);
    if (!ymd.startsWith(month)) return false;
    if (h.Teacher && String(h.Teacher).trim()) {
      return matchesTeacherIdentity(h.Teacher);
    }
    const hwClassKey = normalizeClassKey(h.Class, classMap);
    return assignedClassKeys.length > 0 && hwClassKey && assignedClassKeys.includes(hwClassKey);
  });
  const uniqueHwDays = new Set(teacherMonthHw.map((h) => normalizeDateYmd(h.Date))).size;

  // Classes handled by this teacher (assigned classes + classes they actually taught via homework)
  const taughtClassKeys = new Set<string>(assignedClassKeys);
  if (taughtClassKeys.size === 0) {
    teacherMonthHw.forEach((h) => {
      const ck = normalizeClassKey(h.Class, classMap);
      if (ck) taughtClassKeys.add(ck);
    });
  }

  const recordMatchesTeacherClass = (rawClass?: string, studentId?: string): boolean => {
    if (taughtClassKeys.size === 0) return false;
    const ck = normalizeClassKey(rawClass, classMap);
    if (ck && taughtClassKeys.has(ck)) return true;
    if (studentId) {
      const sck = studentClassLookup.get(String(studentId).trim().toLowerCase());
      if (sck && taughtClassKeys.has(sck)) return true;
    }
    return false;
  };

  // -------------------------------------------------------------
  // PARAMETER 1: Syllabus Progress (Max 30 Points)
  // Target: Weekly planned topics vs completed topics in month, or unique homework days
  // -------------------------------------------------------------
  const teacherSyllabusList = syllabusTopics.filter((s) => {
    const sMonth = String(s.month || '').trim().slice(0, 7);
    if (sMonth !== month) return false;
    const sTid = String(s.teacher_id || '').trim().toLowerCase();
    return (
      (teacherIdLower && sTid === teacherIdLower) ||
      (teacherUsernameLower && sTid === teacherUsernameLower) ||
      matchesTeacherIdentity(s.teacher_name)
    );
  });

  let syllabusScore: number;
  let syllabusPercent: number;
  let syllabusDetail: string;

  if (teacherSyllabusList.length > 0) {
    const completedCount = teacherSyllabusList.filter((s) => s.status === 'Completed').length;
    const totalTarget = teacherSyllabusList.length;
    syllabusPercent = Math.round((completedCount / totalTarget) * 100);
    syllabusScore = Math.min(30, Math.round(((completedCount / totalTarget) * 30) * 10) / 10);
    syllabusDetail = `साप्ताहिक प्लानर: ${completedCount}/${totalTarget} टॉपिक पूर्ण (${syllabusPercent}% पाठ्यक्रम लक्ष्य)`;
  } else if (uniqueHwDays > 0) {
    syllabusPercent = Math.min(100, Math.round((uniqueHwDays / 18) * 100));
    syllabusScore = Math.min(30, Math.round(((uniqueHwDays / 18) * 30) * 10) / 10);
    syllabusDetail = `${uniqueHwDays} दिन पाठ/होमवर्क अपलोड (${syllabusPercent}% प्रगति)`;
  } else {
    syllabusPercent = 0;
    syllabusScore = 0;
    syllabusDetail = 'इस माह अभी तक कोई पाठ योजना या होमवर्क दर्ज नहीं है';
  }

  // -------------------------------------------------------------
  // PARAMETER 2: Student Test & Academic Performance (Max 25 Points)
  // -------------------------------------------------------------
  const classTracker = homeworkTrackerList.filter((t) => {
    const ymd = normalizeDateYmd(t.Date);
    return ymd.startsWith(month) && recordMatchesTeacherClass(t.Class, t.Student_ID);
  });

  const classBehavior = behaviorList.filter((b) => {
    const ymd = normalizeDateYmd(b.Date);
    return ymd.startsWith(month) && recordMatchesTeacherClass(b.Class, b.Student_ID);
  });

  let testScore: number;
  let testPercent: number;
  let testDetail: string;

  if (classTracker.length > 0) {
    const completedCount = classTracker.filter((t) => t.Last_homework_Status === 'Completed').length;
    testPercent = Math.round((completedCount / classTracker.length) * 100);
    testScore = Math.min(25, Math.round(((testPercent / 100) * 25) * 10) / 10);
    testDetail = `कक्षा असाइनमेंट/टेस्ट पूर्णता दर: ${testPercent}% (${completedCount}/${classTracker.length})`;
  } else if (classBehavior.length > 0) {
    const goodCount = classBehavior.filter((b) => b.Discipline !== false && b.Is_Present !== false).length;
    testPercent = Math.round((goodCount / classBehavior.length) * 100);
    testScore = Math.min(25, Math.round(((testPercent / 100) * 22) * 10) / 10);
    testDetail = `कक्षा शैक्षणिक सहभागिता दर: ${testPercent}% (${goodCount}/${classBehavior.length} लॉग्स)`;
  } else {
    testPercent = 0;
    testScore = 0;
    testDetail = taughtClassKeys.size === 0
      ? 'शिक्षक को कोई कक्षा असाइन नहीं है (कक्षा असाइन करें)'
      : 'इस माह कक्षा का कोई टेस्ट/असाइनमेंट रिकॉर्ड नहीं मिला';
  }

  // -------------------------------------------------------------
  // PARAMETER 3: Student Attendance & App Logs (Max 15 Points)
  // -------------------------------------------------------------
  const uniqueAttendanceDates = new Set(classBehavior.map((b) => normalizeDateYmd(b.Date))).size;
  let attendanceScore: number;
  let attendancePercent: number;
  let attendanceDetail: string;

  if (uniqueAttendanceDates > 0) {
    attendancePercent = Math.min(100, Math.round((uniqueAttendanceDates / 22) * 100));
    attendanceScore = Math.min(15, Math.round(((uniqueAttendanceDates / 22) * 15) * 10) / 10);
    attendanceDetail = `${uniqueAttendanceDates}/22 कार्यदिवस कक्षा छात्र हाजिरी ऐप में दर्ज`;
  } else {
    attendancePercent = 0;
    attendanceScore = 0;
    attendanceDetail = taughtClassKeys.size === 0
      ? 'कक्षा असाइन न होने से छात्र हाजिरी मिलान उपलब्ध नहीं'
      : 'इस माह कक्षा की कोई दैनिक छात्र हाजिरी दर्ज नहीं मिली';
  }

  // -------------------------------------------------------------
  // PARAMETER 4: Homework & Notebook Evaluation (Max 15 Points)
  // Target: Assigning homework (max 8) + Checking copies (max 7)
  // -------------------------------------------------------------
  const hwAssignedCount = teacherMonthHw.length;
  const hwCheckedCount = classTracker.filter((t) => t.Last_homework_Status === 'Completed').length;

  let homeworkScore: number;
  let homeworkPercent: number;
  let homeworkDetail: string;

  if (hwAssignedCount > 0 || hwCheckedCount > 0) {
    const assignPts = Math.min(8, Math.round((hwAssignedCount / 16) * 8 * 10) / 10);
    const checkPts = Math.min(7, Math.round((hwCheckedCount / 30) * 7 * 10) / 10);
    homeworkScore = Math.min(15, Math.round((assignPts + checkPts) * 10) / 10);
    homeworkPercent = Math.round((homeworkScore / 15) * 100);
    homeworkDetail = `${hwAssignedCount} होमवर्क जारी, ${hwCheckedCount} छात्र कॉपियों की जाँच पूर्ण`;
  } else {
    homeworkPercent = 0;
    homeworkScore = 0;
    homeworkDetail = 'इस माह होमवर्क या कॉपी जाँच का कोई रिकॉर्ड नहीं मिला';
  }

  // -------------------------------------------------------------
  // PARAMETER 5: Punctuality & School Discipline (Max 15 Points)
  // Target: School QR Code check-in timestamps for THIS teacher
  // -------------------------------------------------------------
  const teacherStaffAtt = staffAttendanceList.filter((sa) => {
    const ymd = normalizeDateYmd(sa.date);
    if (!ymd.startsWith(month)) return false;
    const saUid = String(sa.user_id || '').trim().toLowerCase();
    const saUname = String(sa.username || '').trim().toLowerCase();
    const saName = String(sa.name || '').trim().toLowerCase();
    return (
      (teacherIdLower && saUid === teacherIdLower) ||
      (teacherUsernameLower && (saUname === teacherUsernameLower || saUid === teacherUsernameLower)) ||
      (teacherNameLower && (saName === teacherNameLower || saName.includes(teacherNameLower) || teacherNameLower.includes(saName)))
    );
  });

  let punctualityScore: number;
  let punctualityPercent: number;
  let punctualityDetail: string;
  let onTimeDaysCount = 0;

  if (teacherStaffAtt.length > 0) {
    let earnedDayWeight = 0;
    for (const sa of teacherStaffAtt) {
      const st = String(sa.status || '').toLowerCase();
      if (st === 'absent' || st === 'leave') continue;
      if (st === 'on-duty') {
        onTimeDaysCount += 1;
        earnedDayWeight += 1;
        continue;
      }
      if (st === 'late' || st === 'half-day') {
        earnedDayWeight += 0.6;
        continue;
      }
      const mins = parseCheckInMinutes(sa.check_in_time);
      if (mins === null || mins <= 8 * 60 + 35) {
        onTimeDaysCount += 1;
        earnedDayWeight += 1;
      } else if (mins <= 9 * 60) {
        earnedDayWeight += 0.75;
      } else {
        earnedDayWeight += 0.5;
      }
    }

    const workingTarget = Math.max(teacherStaffAtt.length, 1);
    punctualityPercent = Math.round((earnedDayWeight / workingTarget) * 100);
    // Reflect both punctuality quality (10 pts) and attendance regularity (5 pts across month)
    const qualityPts = (earnedDayWeight / workingTarget) * 10;
    const regularityPts = Math.min(5, (onTimeDaysCount / 22) * 5);
    punctualityScore = Math.min(15, Math.round((qualityPts + regularityPts) * 10) / 10);
    punctualityDetail = `${onTimeDaysCount}/${teacherStaffAtt.length} दिन समय पर स्कूल QR चेक-इन (${punctualityPercent}% समयबद्धता)`;
  } else {
    punctualityPercent = 0;
    punctualityScore = 0;
    punctualityDetail = 'इस माह स्टाफ़ QR उपस्थिति लॉग नहीं मिला';
  }

  // -------------------------------------------------------------
  // TOTAL MONTHLY SCORE (Sum of 5 parameters)
  // -------------------------------------------------------------
  const calculated = calculateMonthlyScore({
    syllabusProgress: syllabusScore,
    studentTest: testScore,
    attendanceLogging: attendanceScore,
    homeworkEvaluation: homeworkScore,
    punctualityDiscipline: punctualityScore,
  });

  const autoRecord: TeacherPerformanceRecord = {
    id: `tp_${month.replace('-', '_')}_${teacherId || teacherUsername}`,
    teacher_id: teacherId,
    teacher_name: teacherName,
    assigned_class: assignedClassDisplay,
    subject: teacher.Designation || 'समस्त विषय',
    month,
    academic_year: academicYear,
    syllabus_progress_score: syllabusScore,
    syllabus_target_percent: syllabusPercent,
    student_test_score: testScore,
    test_average_percent: testPercent,
    attendance_logging_score: attendanceScore,
    attendance_log_accuracy: attendancePercent,
    homework_evaluation_score: homeworkScore,
    homework_checked_count: hwCheckedCount,
    punctuality_discipline_score: punctualityScore,
    punctuality_percent: punctualityPercent,
    monthly_total_score: calculated.totalScore,
    grade: calculated.grade,
    evaluation_date: new Date().toISOString().split('T')[0],
    evaluated_by: evaluatedBy,
    remarks: `लाइव ऐप डेटा स्कोर: पाठ्यक्रम (${syllabusScore}/30), कक्षा परिणाम (${testScore}/25), हाजिरी (${attendanceScore}/15), होमवर्क (${homeworkScore}/15), समयबद्धता (${punctualityScore}/15)।`,
    timestamp: new Date().toISOString(),
    auto_metrics: {
      is_auto_calculated: true,
      syllabus_topics_count: teacherSyllabusList.length || uniqueHwDays,
      test_marks_avg: testPercent,
      attendance_days_logged: uniqueAttendanceDates,
      attendance_total_working_days: 22,
      homework_assigned_count: hwAssignedCount,
      homework_copies_checked: hwCheckedCount,
      punctuality_on_time_days: onTimeDaysCount,
      punctuality_total_days: teacherStaffAtt.length,
      calculation_breakdown: `${syllabusScore}+${testScore}+${attendanceScore}+${homeworkScore}+${punctualityScore} = ${calculated.totalScore}/100`,
    },
  };

  return {
    record: autoRecord,
    breakdown: {
      syllabus: { score: syllabusScore, max: 30, detail: syllabusDetail, percent: syllabusPercent },
      test: { score: testScore, max: 25, detail: testDetail, percent: testPercent },
      attendance: { score: attendanceScore, max: 15, detail: attendanceDetail, percent: attendancePercent },
      homework: { score: homeworkScore, max: 15, detail: homeworkDetail, percent: homeworkPercent },
      punctuality: { score: punctualityScore, max: 15, detail: punctualityDetail, percent: punctualityPercent },
    },
  };
};

/**
 * 5. Auto-Evaluate ALL teachers in school for a given month in 1 click
 */
export const autoEvaluateAllTeachersForMonth = (params: {
  teachers: SchoolUser[];
  month: string;
  academicYear?: string;
  homeworkList?: Homework[];
  homeworkTrackerList?: HomeworkTrackerRecord[];
  staffAttendanceList?: StaffAttendanceRecord[];
  behaviorList?: StudentBehaviorRecord[];
  students?: Student[];
  syllabusTopics?: SyllabusTopicRecord[];
  classMap?: Record<string, string>;
  evaluatedBy?: string;
}): TeacherPerformanceRecord[] => {
  const { teachers, ...rest } = params;
  return teachers.map((teacher) => {
    const res = autoCalculateTeacherMonthlyScoreFromAppData({
      teacher,
      ...rest,
    });
    return res.record;
  });
};

/**
 * 6. Seed Data for initial out-of-the-box experience
 */
export const DEFAULT_TEACHER_PERFORMANCE_SEED: TeacherPerformanceRecord[] = [
  {
    id: 'tp_2026_09_t1',
    teacher_id: 'teacher_sunita',
    teacher_name: 'सुनीता शर्मा (Sunita Sharma)',
    assigned_class: 'Class 5',
    subject: 'गणित व विज्ञान (Math & Science)',
    month: '2026-09',
    academic_year: '2026-2027',
    syllabus_progress_score: 28.5,
    syllabus_target_percent: 95,
    student_test_score: 23.5,
    test_average_percent: 86,
    attendance_logging_score: 14.5,
    attendance_log_accuracy: 97,
    homework_evaluation_score: 14.0,
    homework_checked_count: 48,
    punctuality_discipline_score: 14.5,
    punctuality_percent: 98,
    monthly_total_score: 95.0,
    grade: 'A+',
    evaluation_date: '2026-09-30',
    evaluated_by: 'प्रबंधक (Manager / Principal)',
    remarks: 'असाधारण समर्पण, शत-प्रतिशत कॉपी चेकिंग और समय की पाबंदी।',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'tp_2026_09_t2',
    teacher_id: 'teacher_rahul',
    teacher_name: 'राहुल वर्मा (Rahul Verma)',
    assigned_class: 'Class 4',
    subject: 'अंग्रेज़ी (English)',
    month: '2026-09',
    academic_year: '2026-2027',
    syllabus_progress_score: 27.0,
    syllabus_target_percent: 90,
    student_test_score: 22.0,
    test_average_percent: 82,
    attendance_logging_score: 14.0,
    attendance_log_accuracy: 94,
    homework_evaluation_score: 14.5,
    homework_checked_count: 52,
    punctuality_discipline_score: 14.0,
    punctuality_percent: 95,
    monthly_total_score: 91.5,
    grade: 'A+',
    evaluation_date: '2026-09-30',
    evaluated_by: 'प्रबंधक (Manager / Principal)',
    remarks: 'छात्रों के टेस्ट अंकों में बहुत अच्छा सुधार।',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'tp_2026_09_t3',
    teacher_id: 'teacher_priya',
    teacher_name: 'प्रिया त्यागी (Priya Tyagi)',
    assigned_class: 'Class 3',
    subject: 'हिंदी व सामाजिक विज्ञान (Hindi & EVS)',
    month: '2026-09',
    academic_year: '2026-2027',
    syllabus_progress_score: 25.5,
    syllabus_target_percent: 85,
    student_test_score: 21.0,
    test_average_percent: 78,
    attendance_logging_score: 13.5,
    attendance_log_accuracy: 90,
    homework_evaluation_score: 13.5,
    homework_checked_count: 42,
    punctuality_discipline_score: 13.5,
    punctuality_percent: 91,
    monthly_total_score: 87.0,
    grade: 'A',
    evaluation_date: '2026-09-30',
    evaluated_by: 'प्रबंधक (Manager / Principal)',
    remarks: 'कक्षा अनुशासन और दैनिक होमवर्क नियमित रूप से दिया।',
    timestamp: new Date().toISOString(),
  },
  {
    id: 'tp_2026_09_t4',
    teacher_id: 'teacher_amit',
    teacher_name: 'अमित चौहान (Amit Chauhan)',
    assigned_class: 'Class 2',
    subject: 'गणित (Mathematics)',
    month: '2026-09',
    academic_year: '2026-2027',
    syllabus_progress_score: 24.0,
    syllabus_target_percent: 80,
    student_test_score: 19.5,
    test_average_percent: 74,
    attendance_logging_score: 13.0,
    attendance_log_accuracy: 88,
    homework_evaluation_score: 12.5,
    homework_checked_count: 36,
    punctuality_discipline_score: 13.0,
    punctuality_percent: 89,
    monthly_total_score: 82.0,
    grade: 'A',
    evaluation_date: '2026-09-30',
    evaluated_by: 'प्रबंधक (Manager / Principal)',
    remarks: 'अच्छा प्रदर्शन, कमजोर छात्रों पर विशेष ध्यान आवश्यक है।',
    timestamp: new Date().toISOString(),
  },
];

/**
 * 5. LocalStorage & Server Sync
 */
export const loadLocalPerformanceRecords = (): TeacherPerformanceRecord[] => {
  try {
    const saved = localStorage.getItem(PERFORMANCE_CACHE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_TEACHER_PERFORMANCE_SEED;
};

export const saveLocalPerformanceRecords = (records: TeacherPerformanceRecord[]) => {
  try {
    localStorage.setItem(PERFORMANCE_CACHE_KEY, JSON.stringify(records));
  } catch {}
};

/**
 * 6. Google Sheets & Node Server Sync
 */
export const syncPerformanceRecordToApi = async (
  record: TeacherPerformanceRecord
): Promise<{ success: boolean; message: string }> => {
  // Update local storage first
  const current = loadLocalPerformanceRecords();
  const index = current.findIndex((r) => r.id === record.id || (r.teacher_id === record.teacher_id && r.month === record.month));
  let updatedList: TeacherPerformanceRecord[];
  if (index >= 0) {
    updatedList = [...current];
    updatedList[index] = record;
  } else {
    updatedList = [record, ...current];
  }
  saveLocalPerformanceRecords(updatedList);

  // Send to Node Server API
  try {
    const res = await fetch('/api/teacher-performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (res.ok) {
      const data = await res.json();
      return { success: true, message: data.message || 'Google Sheet में रिकॉर्ड सुरक्षित हो गया!' };
    }
  } catch (err: any) {
    console.warn('API sync warning:', err);
  }

  return { success: true, message: 'स्थानीय रूप से सुरक्षित (Local Storage Updated)' };
};

export const fetchPerformanceRecordsFromApi = async (forceRefresh = false): Promise<TeacherPerformanceRecord[]> => {
  try {
    const res = await fetch(`/api/teacher-performance${forceRefresh ? '?refresh=1' : ''}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        saveLocalPerformanceRecords(data);
        return data;
      }
    }
  } catch {}
  return loadLocalPerformanceRecords();
};
