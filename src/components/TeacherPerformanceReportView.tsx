import React, { useMemo, useState, useEffect } from 'react';
import {
  ExamMarkRecord,
  ReportCardRemarkRecord,
  SchoolUser,
  StaffAttendanceRecord,
  Student,
  StudentBehaviorRecord,
  WeeklyTestRecord,
} from '../types';
import { CURRENT_ACADEMIC_SESSION } from '../utils/reportCardHelper';
import {
  buildTeacherPerformanceReport,
  ReportTermScope,
} from '../utils/teacherPerformanceReportHelper';

interface TeacherPerformanceReportViewProps {
  teachers: SchoolUser[];
  selectedTeacherId: string;
  onSelectTeacherId?: (id: string) => void;
  isTeacherView?: boolean;
  students: Student[];
  examMarks: ExamMarkRecord[];
  pendingMarks?: ExamMarkRecord[];
  weeklyTests?: WeeklyTestRecord[];
  staffAttendance?: StaffAttendanceRecord[];
  behaviorList?: StudentBehaviorRecord[];
  reportCardMeta?: Record<string, ReportCardRemarkRecord>;
  classMap?: Record<string, string>;
  session?: string;
}

const getInitials = (name: string): string => {
  const parts = String(name || 'T').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'T';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const TeacherAvatarBox: React.FC<{ name: string; photoUrl?: string }> = ({ name, photoUrl }) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [photoUrl]);

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
        className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border border-slate-200 bg-slate-100 shrink-0"
      />
    );
  }

  return (
    <div
      className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-[#0c2340] text-amber-300 border border-slate-200 flex items-center justify-center font-black text-xl sm:text-2xl tracking-tight shrink-0"
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
};

export const TeacherPerformanceReportView: React.FC<TeacherPerformanceReportViewProps> = ({
  teachers,
  selectedTeacherId,
  onSelectTeacherId,
  isTeacherView = false,
  students,
  examMarks,
  pendingMarks = [],
  weeklyTests = [],
  staffAttendance = [],
  behaviorList = [],
  reportCardMeta = {},
  classMap,
  session = CURRENT_ACADEMIC_SESSION,
}) => {
  const [termScope, setTermScope] = useState<ReportTermScope>('all');
  const [attendanceMode, setAttendanceMode] = useState<'teacher' | 'student'>('teacher');
  const [isPrinting, setIsPrinting] = useState(false);

  const activeTeacher = useMemo(() => {
    if (teachers.length === 0) return null;
    const clean = String(selectedTeacherId || '').trim().toLowerCase();
    const matched = teachers.find(
      (t) =>
        (clean && String(t.User_ID || '').trim().toLowerCase() === clean) ||
        (clean && String(t.Username || '').trim().toLowerCase() === clean) ||
        (clean && String(t.Name || '').trim().toLowerCase() === clean)
    );
    return matched || teachers[0];
  }, [teachers, selectedTeacherId]);

  const report = useMemo(() => {
    if (!activeTeacher) return null;
    return buildTeacherPerformanceReport({
      teacher: activeTeacher,
      students,
      examMarks,
      pendingMarks,
      weeklyTests,
      staffAttendance,
      behaviorList,
      reportCardMeta,
      classMap,
      termScope,
      session,
    });
  }, [
    activeTeacher,
    students,
    examMarks,
    pendingMarks,
    weeklyTests,
    staffAttendance,
    behaviorList,
    reportCardMeta,
    classMap,
    termScope,
    session,
  ]);

  useEffect(() => {
    const handleAfterPrint = () => {
      document.body.classList.remove('printing-performance-report');
      setIsPrinting(false);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      document.body.classList.remove('printing-performance-report');
    };
  }, []);

  const handlePrintA4Pdf = () => {
    setIsPrinting(true);
    document.body.classList.add('printing-performance-report');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-performance-report');
        setIsPrinting(false);
      }, 600);
    }, 80);
  };

  if (!activeTeacher || !report) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
        No teacher profile found to generate a performance report.
      </div>
    );
  }

  // Donut Ring Calculations
  const donutRadius = 38;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutOffset =
    donutCircumference - (report.assessmentCompletion.overallPct / 100) * donutCircumference;

  // Attendance KPI resolved based on toggle
  const primaryAttendancePct =
    attendanceMode === 'teacher'
      ? report.teacherQrAttendancePct
      : report.studentClassAttendancePct;

  const secondaryAttendanceCaption =
    attendanceMode === 'teacher'
      ? report.teacherTotalLoggedDays > 0
        ? `${report.teacherAttendanceDays}/${report.teacherTotalLoggedDays} QR Days`
        : 'No QR Logs Yet'
      : report.studentClassAttendancePct !== null
      ? 'Class Avg Attendance'
      : 'No Class Logs';

  const maxDistPct = Math.max(40, ...report.distribution.map((d) => d.pct));

  return (
    <div className="space-y-4">
      {/* Screen-only Filter & Control Toolbar */}
      <div className="no-print bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {!isTeacherView ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor="report-teacher-select"
                className="text-xs font-semibold text-slate-600 whitespace-nowrap"
              >
                Teacher:
              </label>
              <select
                id="report-teacher-select"
                value={activeTeacher.User_ID || activeTeacher.Username}
                onChange={(e) => onSelectTeacherId?.(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-900 cursor-pointer"
              >
                {teachers.map((t) => (
                  <option
                    key={t.User_ID || t.Username}
                    value={t.User_ID || t.Username}
                  >
                    {t.Name} {t.Assigned_Class ? `(${t.Assigned_Class})` : ''}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs font-bold text-slate-700">
              My Performance Report · <span className="text-blue-900">{activeTeacher.Name}</span>
            </div>
          )}

          {/* Term Scope Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {(
              [
                { id: 'all', label: 'Full Session' },
                { id: 'Quarterly', label: 'Quarterly' },
                { id: 'Half-Yearly', label: 'Half-Yearly' },
                { id: 'Annual', label: 'Annual' },
              ] as { id: ReportTermScope; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTermScope(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  termScope === opt.id
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Attendance Metric Switch */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setAttendanceMode('teacher')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                attendanceMode === 'teacher'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Staff QR Att.
            </button>
            <button
              type="button"
              onClick={() => setAttendanceMode('student')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                attendanceMode === 'student'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Class Att.
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handlePrintA4Pdf}
          disabled={isPrinting}
          className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 disabled:opacity-60"
        >
          <i className="fa-solid fa-print text-amber-300"></i>
          <span>{isPrinting ? 'Preparing A4 PDF...' : 'Print / Save A4 PDF'}</span>
        </button>
      </div>

      {/* Printable A4 Landscape Report Sheet */}
      <div
        id="printable-performance-report-sheet"
        className="bg-white rounded-2xl border border-slate-200 overflow-hidden text-slate-900"
      >
        {/* Top Institutional Header Band */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#133563] to-[#1d5fa7] text-white px-5 py-3.5 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-[#0c2340] flex items-center justify-center font-black text-base shrink-0">
              EVS
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                E.V.S. Public School · Academic Analytics
              </div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-tight">
                Teacher Performance Report
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:text-right">
            <div>
              <div className="text-xs font-semibold text-blue-100">
                Academic Session {session}
              </div>
              <div className="text-[11px] text-amber-200 font-medium">
                Scope: {termScope === 'all' ? 'Full Academic Session' : `${termScope} Term`}
              </div>
            </div>
            <button
              type="button"
              onClick={handlePrintA4Pdf}
              className="no-print hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-bold cursor-pointer transition-colors"
            >
              <i className="fa-solid fa-file-pdf text-amber-300"></i>
              <span>Print / PDF</span>
            </button>
          </div>
        </div>

        {/* Report Body Content */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* ROW 1: Teacher Profile + 5 Summary KPI Cards */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5 items-stretch">
            {/* Teacher Profile Card (4 cols on xl) */}
            <div className="xl:col-span-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex items-center gap-3.5">
              <TeacherAvatarBox name={activeTeacher.Name} photoUrl={report.photoUrl} />
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 truncate">
                  {activeTeacher.Name}
                </h3>
                <div className="text-[11px] text-slate-600 space-y-0.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <i className="fa-regular fa-id-badge text-blue-800 w-3.5 text-center"></i>
                    <span className="text-slate-500">ID:</span>
                    <strong className="font-mono text-slate-900">
                      {activeTeacher.User_ID || activeTeacher.Username || '—'}
                    </strong>
                  </div>
                  <div className="flex items-center gap-1.5 truncate">
                    <i className="fa-solid fa-building-columns text-blue-800 w-3.5 text-center"></i>
                    <span className="text-slate-500">Dept:</span>
                    <strong className="text-slate-800 truncate">{report.departmentLabel}</strong>
                  </div>
                  <div className="flex items-center gap-1.5 truncate">
                    <i className="fa-solid fa-user-tie text-blue-800 w-3.5 text-center"></i>
                    <span className="text-slate-500">Role:</span>
                    <strong className="text-slate-800 truncate">{report.roleLabel}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* 5 KPI Summary Cards (8 cols on xl) */}
            <div className="xl:col-span-8 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {/* KPI 1: Classes Taught */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 flex flex-col justify-between text-center">
                <div className="text-[11px] font-bold text-slate-600 flex items-center justify-center gap-1">
                  <i className="fa-solid fa-chalkboard text-blue-700"></i>
                  <span>Classes</span>
                </div>
                <div className="text-2xl font-black text-slate-900 tabular-nums my-1">
                  {report.classesTaughtCount}
                </div>
                <div className="text-[10px] font-semibold text-slate-600 truncate">
                  {report.assignedClasses.length > 0
                    ? report.assignedClasses.map((c) => c.label).join(', ')
                    : 'Not Assigned'}
                </div>
              </div>

              {/* KPI 2: Total Students */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 flex flex-col justify-between text-center">
                <div className="text-[11px] font-bold text-slate-600 flex items-center justify-center gap-1">
                  <i className="fa-solid fa-users text-emerald-700"></i>
                  <span>Students</span>
                </div>
                <div className="text-2xl font-black text-emerald-900 tabular-nums my-1">
                  {report.totalStudentsCount}
                </div>
                <div className="text-[10px] font-semibold text-emerald-700 truncate">
                  {report.evaluatedStudentsTotal > 0
                    ? `${report.evaluatedStudentsTotal} Evaluated`
                    : 'Active Roster'}
                </div>
              </div>

              {/* KPI 3: Subjects */}
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 flex flex-col justify-between text-center">
                <div className="text-[11px] font-bold text-slate-600 flex items-center justify-center gap-1">
                  <i className="fa-solid fa-book-open text-violet-700"></i>
                  <span>Subjects</span>
                </div>
                <div className="text-2xl font-black text-violet-950 tabular-nums my-1">
                  {report.subjectsCount}
                </div>
                <div
                  className="text-[10px] font-semibold text-violet-800 truncate"
                  title={report.assignedSubjects.join(', ')}
                >
                  {report.assignedSubjects.length > 0
                    ? report.assignedSubjects.join(', ')
                    : 'No Subject Assigned'}
                </div>
              </div>

              {/* KPI 4: Avg. Attendance */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 flex flex-col justify-between text-center">
                <div className="text-[11px] font-bold text-slate-600 flex items-center justify-center gap-1">
                  <i className="fa-solid fa-circle-check text-amber-600"></i>
                  <span>{attendanceMode === 'teacher' ? 'Staff Att.' : 'Class Att.'}</span>
                </div>
                <div className="text-2xl font-black text-amber-900 tabular-nums my-1">
                  {primaryAttendancePct !== null ? `${primaryAttendancePct}%` : '—'}
                </div>
                <div className="text-[10px] font-semibold text-amber-800 truncate">
                  {secondaryAttendanceCaption}
                </div>
              </div>

              {/* KPI 5: Avg Subject Result % */}
              <div className="col-span-2 sm:col-span-1 rounded-xl border border-sky-200 bg-sky-50/70 p-3 flex flex-col justify-between text-center">
                <div className="text-[11px] font-bold text-slate-600 flex items-center justify-center gap-1">
                  <i className="fa-solid fa-chart-line text-sky-700"></i>
                  <span>Avg. Result</span>
                </div>
                <div className="text-2xl font-black text-blue-900 tabular-nums my-1">
                  {report.overallSubjectResultPct !== null
                    ? `${report.overallSubjectResultPct}%`
                    : '—'}
                </div>
                <div
                  className={`text-[10px] font-bold tabular-nums ${
                    report.overallTrendPp === null
                      ? 'text-slate-500'
                      : report.overallTrendPp >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-700'
                  }`}
                >
                  {report.overallTrendPp !== null
                    ? `${report.overallTrendPp >= 0 ? '▲ +' : '▼ '}${report.overallTrendPp} pp`
                    : report.hasAnyMarks
                    ? 'Single Term Data'
                    : 'Awaiting Marks'}
                </div>
              </div>
            </div>
          </div>

          {/* ROW 2: Subject-wise Performance (Left 6 cols) + Class-wise Table (Right 6 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            {/* Subject-wise Performance */}
            <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-chart-simple text-blue-800 text-sm"></i>
                  <h4 className="text-sm font-extrabold text-slate-900">
                    Subject-wise Performance
                  </h4>
                  <span className="text-[11px] text-slate-500">(Average %)</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-bold text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block"></span>
                    Quarterly
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block"></span>
                    Half-Yearly
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-amber-500 inline-block"></span>
                    Annual
                  </span>
                </div>
              </div>

              {report.subjectBreakdowns.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <i className="fa-regular fa-folder-open text-2xl text-slate-300 mb-2"></i>
                  <p className="text-xs font-semibold text-slate-700">
                    No subjects assigned or marks entered yet
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 max-w-xs">
                    Manager can assign subjects in Staff Directory or teacher can submit marks in Report Card module.
                  </p>
                </div>
              ) : (
                <div
                  className={`grid gap-3 flex-1 ${
                    report.subjectBreakdowns.length === 1
                      ? 'grid-cols-1'
                      : 'grid-cols-1 sm:grid-cols-2'
                  }`}
                >
                  {report.subjectBreakdowns.slice(0, 4).map((sub) => {
                    const bars = [
                      { key: 'Qtr', val: sub.quarterlyPct, color: 'bg-blue-600' },
                      { key: 'HY', val: sub.halfYearlyPct, color: 'bg-emerald-500' },
                      { key: 'Ann', val: sub.annualPct, color: 'bg-amber-500' },
                    ];
                    return (
                      <div
                        key={sub.subjectKey}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <strong className="text-xs font-extrabold text-slate-900 truncate">
                            {sub.subjectLabel}
                          </strong>
                          {sub.weeklyPct !== null && (
                            <span className="text-[10px] font-bold text-slate-600 tabular-nums shrink-0">
                              Weekly: {sub.weeklyPct}%
                            </span>
                          )}
                        </div>

                        <div className="flex items-end justify-between gap-2.5 pt-2">
                          {/* Term Bar Columns */}
                          <div className="flex items-end gap-2.5 h-24 flex-1 justify-around">
                            {bars.map((b) => {
                              const hPct = b.val !== null ? Math.max(12, Math.min(100, b.val)) : 8;
                              return (
                                <div
                                  key={b.key}
                                  className="flex flex-col items-center justify-end h-full flex-1 max-w-[44px]"
                                >
                                  <span className="text-[10px] font-bold text-slate-700 tabular-nums mb-1">
                                    {b.val !== null ? `${Math.round(b.val)}%` : '—'}
                                  </span>
                                  <div className="w-full flex-1 flex items-end justify-center">
                                    <div
                                      className={`w-full rounded-t-md transition-all ${
                                        b.val !== null ? b.color : 'bg-slate-200'
                                      }`}
                                      style={{ height: `${hPct}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-semibold text-slate-500 mt-1">
                                    {b.key}
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Overall Avg Box */}
                          <div className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-center shrink-0 min-w-[76px]">
                            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                              Overall Avg
                            </div>
                            <div className="text-base font-black text-blue-950 tabular-nums mt-0.5">
                              {sub.overallPct !== null ? `${sub.overallPct}%` : '—'}
                            </div>
                            <div
                              className={`text-[10px] font-bold tabular-nums mt-0.5 ${
                                sub.trendPp === null
                                  ? 'text-slate-400'
                                  : sub.trendPp >= 0
                                  ? 'text-emerald-700'
                                  : 'text-rose-700'
                              }`}
                            >
                              {sub.trendPp !== null
                                ? `${sub.trendPp >= 0 ? '▲ +' : '▼ '}${sub.trendPp} pp`
                                : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Class-wise Subject Performance Table */}
            <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-table text-blue-800 text-sm"></i>
                  <h4 className="text-sm font-extrabold text-slate-900">
                    Class-wise Subject Performance
                  </h4>
                  <span className="text-[11px] text-slate-500">(Overall %)</span>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                  {report.classRows.length} Classes
                </span>
              </div>

              {report.classRows.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-8 text-center text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <p className="text-xs font-semibold text-slate-700">No classes mapped yet</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Assign one or more classes to this teacher in the Staff Directory.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 text-[11px]">
                        <th className="py-2 px-2.5 rounded-tl-lg">Class</th>
                        <th className="py-2 px-2.5">Subject(s)</th>
                        <th className="py-2 px-2 text-center">Students</th>
                        <th className="py-2 px-2.5 text-center">Average %</th>
                        <th className="py-2 px-2.5 text-right rounded-tr-lg">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.classRows.map((row) => (
                        <tr key={row.classKey} className="hover:bg-slate-50/70">
                          <td className="py-2 px-2.5 font-bold text-slate-900 whitespace-nowrap">
                            Class {row.classLabel}
                          </td>
                          <td className="py-2 px-2.5 text-slate-700 max-w-[170px] truncate" title={row.subjectsLabel}>
                            {row.subjectsLabel}
                          </td>
                          <td className="py-2 px-2 text-center font-semibold text-slate-800 tabular-nums">
                            {row.studentsCount}
                          </td>
                          <td className="py-2 px-2.5 text-center tabular-nums">
                            {row.averagePct !== null ? (
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md font-extrabold ${
                                  row.averagePct >= 75
                                    ? 'bg-emerald-50 text-emerald-800'
                                    : row.averagePct >= 60
                                    ? 'bg-amber-50 text-amber-800'
                                    : 'bg-rose-50 text-rose-800'
                                }`}
                              >
                                {row.averagePct}%
                              </span>
                            ) : (
                              <span className="text-slate-400 font-medium">—</span>
                            )}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-bold tabular-nums whitespace-nowrap ${
                              row.trendPp === null
                                ? 'text-slate-400'
                                : row.trendPp >= 0
                                ? 'text-emerald-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {row.trendPp !== null
                              ? `${row.trendPp >= 0 ? '▲ +' : '▼ '}${row.trendPp} pp`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ROW 3: Assessment Completion | Student Performance Distribution | Key Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
            {/* Panel 1: Assessment Completion (4 cols) */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <i className="fa-solid fa-clipboard-check text-blue-800 text-sm"></i>
                <h4 className="text-sm font-extrabold text-slate-900">
                  Assessment Completion
                </h4>
              </div>

              <div className="flex items-center gap-4">
                {/* Circular Donut SVG */}
                <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                    <circle
                      cx="48"
                      cy="48"
                      r={donutRadius}
                      fill="none"
                      stroke="#e2e8f0"
                      strokeWidth="10"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={donutRadius}
                      fill="none"
                      stroke="#16a34a"
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={donutCircumference}
                      strokeDashoffset={donutOffset}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-lg font-black text-slate-900 tabular-nums leading-none">
                      {report.assessmentCompletion.overallPct}%
                    </span>
                    <span className="text-[9px] font-bold text-slate-500 mt-0.5">
                      Completed
                    </span>
                  </div>
                </div>

                {/* Checklist */}
                <div className="flex-1 space-y-2 min-w-0">
                  {report.assessmentCompletion.items.map((item) => {
                    const isDone = item.completed > 0 && item.completed >= item.total;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <i
                            className={`fa-solid ${
                              isDone
                                ? 'fa-circle-check text-emerald-600'
                                : item.completed > 0
                                ? 'fa-circle-half-stroke text-amber-500'
                                : 'fa-circle text-slate-300'
                            } text-xs shrink-0`}
                          ></i>
                          <span className="font-semibold text-slate-700 truncate">
                            {item.label}
                          </span>
                        </div>
                        <span className="font-bold text-slate-900 tabular-nums shrink-0">
                          {item.completed} / {item.total}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Panel 2: Student Performance Distribution (4 cols) */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 flex flex-col">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-chart-column text-blue-800 text-sm"></i>
                  <h4 className="text-sm font-extrabold text-slate-900">
                    Performance Distribution
                  </h4>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                  {report.evaluatedStudentsTotal} Students
                </span>
              </div>

              <div className="flex items-end justify-between gap-2.5 h-28 pt-3 border-b border-slate-200 pb-1 flex-1">
                {report.distribution.map((bucket) => {
                  const barH =
                    report.evaluatedStudentsTotal > 0 && bucket.pct > 0
                      ? Math.max(14, Math.round((bucket.pct / maxDistPct) * 100))
                      : 6;
                  return (
                    <div
                      key={bucket.key}
                      className="flex-1 flex flex-col items-center justify-end h-full"
                    >
                      <span className="text-[11px] font-extrabold text-slate-900 tabular-nums mb-1">
                        {report.evaluatedStudentsTotal > 0 ? `${bucket.pct}%` : '0%'}
                      </span>
                      <div className="w-full flex-1 flex items-end justify-center px-1">
                        <div
                          className={`w-full max-w-[38px] rounded-t-md ${
                            bucket.count > 0 ? bucket.barColor : 'bg-slate-200'
                          }`}
                          style={{ height: `${barH}%` }}
                          title={`${bucket.label} (${bucket.subLabel}): ${bucket.count} students`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-1.5 pt-1.5 text-center">
                {report.distribution.map((bucket) => (
                  <div key={bucket.key} className="leading-tight">
                    <div className="text-[10px] font-bold text-slate-800 tabular-nums">
                      {bucket.label}
                    </div>
                    <div className="text-[9px] text-slate-500">
                      {bucket.subLabel} · {bucket.count}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Panel 3: Key Insights (4 cols) */}
            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <i className="fa-solid fa-bullseye text-emerald-700 text-sm"></i>
                  <h4 className="text-sm font-extrabold text-slate-900">Key Insights</h4>
                </div>
                <ul className="space-y-1.5">
                  {report.insights.slice(0, 5).map((line, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-xs text-slate-700 leading-snug"
                    >
                      <i className="fa-solid fa-circle-check text-emerald-600 text-xs mt-0.5 shrink-0"></i>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                <span>E.V.S. Public School · Official Record</span>
                <span className="tabular-nums">Session {session}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
