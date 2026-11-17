import React, { useState, useMemo, useEffect } from 'react';
import { getLocalTimestamp } from '../utils/localTime';
import { SchoolUser, StaffAttendanceRecord, SchoolHolidayRecord } from '../types';
import {
  calculateStaffMonthlyStats,
  StaffMonthlyReport,
  formatMinutesToHuman,
  formatHoursDec,
  getSchoolShiftSettings,
  saveSchoolShiftSettings,
} from '../utils/staffAttendanceMetrics';
import {
  loadLocalSchoolHolidays,
  fetchSchoolHolidaysFromApiOrSheet,
  subscribeSchoolHolidaysUpdates,
} from '../utils/schoolHolidaysHelper';
import { StaffSalaryConfig } from '../types';
import {
  loadLocalSalaryConfigs,
  fetchSalaryConfigsFromServer,
  saveStaffSalaryConfigToServer,
  subscribeSalaryConfigUpdates,
  getDefaultStaffSalaryConfig,
  calculateStaffMonthlySalary,
  StaffSalaryCalculation,
  syncAllPayrollBackupToSheet,
  StaffPayrollBackupRecord,
} from '../utils/staffSalaryHelper';
import { openWhatsappAlert } from '../utils/whatsappReminders';

interface StaffMonthlyReportViewProps {
  currentUser: SchoolUser;
  allStaffUsers: SchoolUser[];
  attendanceRecords: StaffAttendanceRecord[];
  isManager?: boolean;
  schoolName?: string;
  defaultStaffId?: string;
}

export const StaffMonthlyReportView: React.FC<StaffMonthlyReportViewProps> = ({
  currentUser,
  allStaffUsers = [],
  attendanceRecords = [],
  isManager = false,
  schoolName = 'Eastern Valley School',
  defaultStaffId,
}) => {
  // Current month string "YYYY-MM"
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`;
  });

  // Working days override (optional)
  const [customWorkingDays, setCustomWorkingDays] = useState<number | undefined>(undefined);
  const [showConfig, setShowConfig] = useState<boolean>(false);

  // Shift Cutoffs from centralized School Shift Settings
  const [standardStartTime, setStandardStartTime] = useState<string>(() => getSchoolShiftSettings().schoolOpeningTime || '08:30 AM');
  const [standardEndTime, setStandardEndTime] = useState<string>(() => getSchoolShiftSettings().schoolClosingTime || '02:00 PM');

  // View Mode: 'master_register' | 'individual_report' | 'salary_payroll'
  const [viewMode, setViewMode] = useState<'master_register' | 'individual_report' | 'salary_payroll'>(
    isManager ? 'master_register' : 'individual_report'
  );

  // Feature 5: Staff Salary Configs & Pay-Slip Modals
  const [salaryConfigs, setSalaryConfigs] = useState<Record<string, StaffSalaryConfig>>(() => loadLocalSalaryConfigs());
  const [editingSalaryStaff, setEditingSalaryStaff] = useState<StaffMonthlyReport | null>(null);
  const [salaryForm, setSalaryForm] = useState<StaffSalaryConfig | null>(null);
  const [savingSalaryConfig, setSavingSalaryConfig] = useState<boolean>(false);
  const [paySlipStaff, setPaySlipStaff] = useState<StaffMonthlyReport | null>(null);
  const [syncingPayrollBackup, setSyncingPayrollBackup] = useState<boolean>(false);
  const [payrollSyncBanner, setPayrollSyncBanner] = useState<{ ok: boolean; msg: string } | null>(null);

  // Selected staff user for individual report (Staff only sees themselves, Manager sees all staff)
  const staffList = useMemo(() => {
    if (!isManager) {
      return [currentUser];
    }
    return allStaffUsers.length > 0 ? allStaffUsers : [currentUser];
  }, [allStaffUsers, currentUser, isManager]);

  const [selectedStaffUserId, setSelectedStaffUserId] = useState<string>(() => {
    if (defaultStaffId && isManager) return defaultStaffId;
    return currentUser.User_ID || currentUser.Username || String(currentUser.Mobile_number || '');
  });

  // Filter & Search in master register
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'teacher' | 'manager' | 'staff'>('all');

  // Month navigation helpers
  const handlePrevMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const mm = String(prevDate.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${prevDate.getFullYear()}-${mm}`);
  };

  const handleNextMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const nextDate = new Date(y, m, 1);
    const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${nextDate.getFullYear()}-${mm}`);
  };

  const handleCurrentMonth = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${d.getFullYear()}-${mm}`);
  };

  // School Holidays state (synced from School_Holidays sheet + local cache + cross-tab events)
  const [schoolHolidays, setSchoolHolidays] = useState<SchoolHolidayRecord[]>(() => loadLocalSchoolHolidays());

  useEffect(() => {
    fetchSchoolHolidaysFromApiOrSheet(true).then(setSchoolHolidays).catch(() => {});
    const unsubscribe = subscribeSchoolHolidaysUpdates((latest) => {
      setSchoolHolidays(latest);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    fetchSalaryConfigsFromServer().then(setSalaryConfigs).catch(() => {});
    const unsubscribe = subscribeSalaryConfigUpdates((latest) => {
      setSalaryConfigs(latest);
    });
    return unsubscribe;
  }, []);

  // Compute monthly report for ALL staff in selected month
  const allStaffReports = useMemo<StaffMonthlyReport[]>(() => {
    return staffList.map((user) => {
      return calculateStaffMonthlyStats(
        user,
        selectedMonth,
        attendanceRecords,
        customWorkingDays,
        standardStartTime,
        standardEndTime,
        schoolHolidays
      );
    });
  }, [staffList, selectedMonth, attendanceRecords, customWorkingDays, standardStartTime, standardEndTime, schoolHolidays]);

  // Aggregate School-Wide Rollup
  const schoolRollup = useMemo(() => {
    if (allStaffReports.length === 0) return null;
    const totalStaff = allStaffReports.length;
    const workingDays = allStaffReports[0].workingDays;
    const totalHolidays = allStaffReports[0].totalHolidays;
    const totalPresentDaysSum = allStaffReports.reduce((acc, r) => acc + r.presentDays, 0);
    const totalAbsentDaysSum = allStaffReports.reduce((acc, r) => acc + r.absentDays, 0);
    const totalLateCases = allStaffReports.reduce((acc, r) => acc + r.lateDays, 0);
    const totalLateMinutesSum = allStaffReports.reduce((acc, r) => acc + r.totalLateMinutes, 0);
    const totalExtraHoursSum = allStaffReports.reduce((acc, r) => acc + r.extraOvertimeHours, 0);
    const avgAttendancePercent =
      totalStaff > 0
        ? Math.round(
            allStaffReports.reduce((acc, r) => acc + r.attendancePercentage, 0) / totalStaff
          )
        : 0;

    return {
      totalStaff,
      workingDays,
      totalHolidays,
      totalPresentDaysSum,
      totalAbsentDaysSum,
      totalLateCases,
      totalLateMinutesSum,
      totalExtraHoursSum: Math.round(totalExtraHoursSum * 10) / 10,
      avgAttendancePercent,
    };
  }, [allStaffReports]);

  // Filtered staff for master register
  const filteredReports = useMemo(() => {
    return allStaffReports.filter((rep) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        rep.name.toLowerCase().includes(q) ||
        rep.mobile.includes(q) ||
        rep.designation.toLowerCase().includes(q) ||
        rep.userId.toLowerCase().includes(q);

      const des = (rep.designation || '').toLowerCase();
      const matchesRole =
        roleFilter === 'all' ||
        (roleFilter === 'teacher' && /teacher|faculty|शिक्षक/i.test(des)) ||
        (roleFilter === 'manager' && /manager|principal|admin|प्रबंधक/i.test(des)) ||
        (roleFilter === 'staff' && !/teacher|faculty|manager|principal|admin/i.test(des));

      return matchesSearch && matchesRole;
    });
  }, [allStaffReports, searchQuery, roleFilter]);

  // Selected Staff's Detailed Report
  const currentSelectedReport = useMemo<StaffMonthlyReport | null>(() => {
    const found = allStaffReports.find(
      (r) =>
        r.userId.toLowerCase() === selectedStaffUserId.toLowerCase() ||
        String(r.user.Mobile_number || '').trim() === selectedStaffUserId.trim()
    );
    return found || allStaffReports[0] || null;
  }, [allStaffReports, selectedStaffUserId]);

  // CSV Export for monthly register
  const handleExportCSV = () => {
    if (filteredReports.length === 0) return;
    const headers = [
      'ID',
      'Name',
      'Designation',
      'Mobile',
      'Month',
      'School_Open_Days',
      'Days_Present',
      'Days_Absent',
      'Attendance_Percentage',
      'Late_Days_Count',
      'Total_Late_Minutes',
      'Extra_Overtime_Hours',
      'Extra_Duty_Days',
      'Total_Working_Hours',
    ];

    const rows = filteredReports.map((r) => [
      `"${r.userId}"`,
      `"${r.name}"`,
      `"${r.designation}"`,
      `"${r.mobile}"`,
      `"${r.monthName}"`,
      r.workingDays,
      r.presentDays,
      r.absentDays,
      `${r.attendancePercentage}%`,
      r.lateDays,
      r.totalLateMinutes,
      r.extraOvertimeHours,
      r.extraDutyDays,
      r.totalWorkingHours,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Staff_Monthly_Attendance_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Print Report Handler
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#16365c] to-[#0c2340] text-white p-5 sm:p-6 rounded-3xl shadow-xl border border-amber-500/20 relative overflow-hidden">
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                <i className="fa-solid fa-chart-pie"></i>
                <span>मासिक विश्लेषण (Monthly Analytics)</span>
              </span>
              <span className="text-xs text-amber-200/90 font-medium">
                स्टाफ, टीचर व प्रबंधन संपूर्ण उपस्थिति रजिस्टर
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              <span>मासिक स्टाफ हाजिरी व ओवर-टाइम रिपोर्ट</span>
            </h2>
            <p className="text-xs text-slate-300 max-w-xl">
              स्कूल खुला दिन, कुल हाजिरी, गैरहाजिरी, लेट आगमन व अतिरिक्त कार्य (Add Extra) का सम्पूर्ण ऑन-डिमांड रिकॉर्ड।
            </p>
          </div>

          {/* Month Selector & Controls */}
          <div className="flex flex-wrap items-center gap-2.5 bg-white/10 p-2.5 rounded-2xl border border-white/15 backdrop-blur-md">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
              title="पिछला महीना"
            >
              <i className="fa-solid fa-chevron-left"></i>
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-slate-900 font-bold text-xs sm:text-sm shadow-inner">
              <i className="fa-regular fa-calendar-days text-amber-600"></i>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => {
                  if (e.target.value) setSelectedMonth(e.target.value);
                }}
                className="bg-transparent font-black border-none focus:outline-none cursor-pointer text-slate-900"
              />
            </div>

            <button
              type="button"
              onClick={handleNextMonth}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all cursor-pointer"
              title="अगला महीना"
            >
              <i className="fa-solid fa-chevron-right"></i>
            </button>

            <button
              type="button"
              onClick={handleCurrentMonth}
              className="px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs transition-all cursor-pointer shadow-sm"
            >
              इस माह
            </button>

            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 text-xs font-bold transition-all cursor-pointer"
              title="स्कूल नियम व कार्य दिवस सेट करें"
            >
              <i className="fa-solid fa-sliders"></i>
            </button>
          </div>
        </div>

        {/* Collapsible Rules / Settings drawer */}
        {showConfig && (
          <div className="mt-4 pt-4 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-black/20 p-4 rounded-2xl animate-fadeIn">
            <div>
              <label className="block text-amber-200 font-bold mb-1">
                स्कूल खुला कार्य दिवस (Working Days):
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="31"
                  placeholder={String(allStaffReports[0]?.workingDays || 26)}
                  value={customWorkingDays !== undefined ? customWorkingDays : ''}
                  onChange={(e) => {
                    const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                    setCustomWorkingDays(val);
                  }}
                  className="w-full px-3 py-1.5 rounded-xl bg-white text-slate-900 font-bold text-xs"
                />
                {customWorkingDays !== undefined && (
                  <button
                    type="button"
                    onClick={() => setCustomWorkingDays(undefined)}
                    className="text-[11px] text-amber-300 hover:underline shrink-0"
                  >
                    रीसेट
                  </button>
                )}
              </div>
              <span className="text-[10px] text-slate-300 block mt-0.5">
                (डिफ़ॉल्ट: कुल माह दिन में से रविवार घटाकर)
              </span>
            </div>

            <div>
              <label className="block text-amber-200 font-bold mb-1">
                स्कूल आगमन समय (Late कट-ऑफ):
              </label>
              <input
                type="text"
                value={standardStartTime}
                onChange={(e) => setStandardStartTime(e.target.value)}
                placeholder="08:30 AM"
                className="w-full px-3 py-1.5 rounded-xl bg-white text-slate-900 font-bold font-mono text-xs"
              />
              <span className="text-[10px] text-slate-300 block mt-0.5">
                इसके बाद आगमन पर लेट गिना जाएगा
              </span>
            </div>

            <div>
              <label className="block text-amber-200 font-bold mb-1">
                स्कूल समाप्ति समय (Add Extra कट-ऑफ):
              </label>
              <input
                type="text"
                value={standardEndTime}
                onChange={(e) => setStandardEndTime(e.target.value)}
                placeholder="02:00 PM"
                className="w-full px-3 py-1.5 rounded-xl bg-white text-slate-900 font-bold font-mono text-xs"
              />
              <span className="text-[10px] text-slate-300 block mt-0.5">
                इसके बाद चेक-आउट होने पर अतिरिक्त कार्य (Add Extra) जुड़ेगा
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Mode Navigation Tabs & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <button
              type="button"
              onClick={() => setViewMode('master_register')}
              className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                viewMode === 'master_register'
                  ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <i className="fa-solid fa-table-list text-amber-400"></i>
              <span>मास्टर स्टाफ मासिक रजिस्टर (All Staff Table)</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-900 text-[11px] font-black">
                {allStaffReports.length}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setViewMode('individual_report')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'individual_report'
                ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <i className="fa-solid fa-id-card text-emerald-400"></i>
            <span>व्यक्तिगत स्टाफ रिपोर्ट पर्ची</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('salary_payroll')}
            className={`px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              viewMode === 'salary_payroll'
                ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <i className="fa-solid fa-money-check-dollar text-amber-400"></i>
            <span>{isManager ? '💰 वेतन व पे-स्लिप (Payroll)' : '💰 मेरी वेतन पर्ची (Pay-Slip)'}</span>
          </button>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCSV}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            title="इस महीने का पूरा डाटा एक्सेल/CSV में डाउनलोड करें"
          >
            <i className="fa-solid fa-file-excel"></i>
            <span>CSV डाउनलोड</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
            title="माह का उपस्थिति रजिस्टर प्रिंट करें"
          >
            <i className="fa-solid fa-print text-indigo-600"></i>
            <span>प्रिंट (Print)</span>
          </button>
        </div>
      </div>

      {/* 5 OVERALL SUMMARY METRICS CARDS (FOR MONTH - MANAGER ONLY) */}
      {isManager && schoolRollup && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          {/* 1. कितने दिन स्कूल खुला */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50/50 p-4 rounded-2xl border border-blue-200 shadow-2xs relative overflow-hidden">
            <div className="flex items-center justify-between text-blue-700 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">स्कूल खुला</span>
              <i className="fa-solid fa-school text-blue-500"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-slate-900">
              {schoolRollup.workingDays} <span className="text-xs font-bold text-slate-500">दिन</span>
            </div>
            <div className="text-[11px] text-blue-800 font-medium mt-1">
              {allStaffReports[0]?.monthName}
              {schoolRollup.totalHolidays > 0 && (
                <span className="ml-1 font-bold text-amber-700">
                  • 🌴 {schoolRollup.totalHolidays} अवकाश घटाकर
                </span>
              )}
            </div>
          </div>

          {/* 2. कुल हाजिरी (उपस्थित) */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50/50 p-4 rounded-2xl border border-emerald-200 shadow-2xs relative overflow-hidden">
            <div className="flex items-center justify-between text-emerald-700 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">कुल हाजिरी</span>
              <i className="fa-solid fa-user-check text-emerald-500"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-800">
              {schoolRollup.avgAttendancePercent}%
            </div>
            <div className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
              <span>औसत उपस्थिति दर</span>
            </div>
          </div>

          {/* 3. गैरहाजिरी */}
          <div className="bg-gradient-to-br from-rose-50 to-red-50/50 p-4 rounded-2xl border border-rose-200 shadow-2xs relative overflow-hidden">
            <div className="flex items-center justify-between text-rose-700 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">कुल गैरहाजिरी</span>
              <i className="fa-solid fa-user-xmark text-rose-500"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-rose-800">
              {schoolRollup.totalAbsentDaysSum} <span className="text-xs font-bold text-slate-500">दिन</span>
            </div>
            <div className="text-[11px] text-rose-700 font-medium mt-1">
              स्टाफ अनुपस्थिति संचयी
            </div>
          </div>

          {/* 4. कितना लेट है */}
          <div className="bg-gradient-to-br from-amber-50 to-orange-50/50 p-4 rounded-2xl border border-amber-200 shadow-2xs relative overflow-hidden">
            <div className="flex items-center justify-between text-amber-700 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">कितना लेट</span>
              <i className="fa-solid fa-clock text-amber-500"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-900">
              {schoolRollup.totalLateCases} <span className="text-xs font-bold text-slate-500">बार</span>
            </div>
            <div className="text-[11px] text-amber-800 font-medium mt-1 truncate">
              {formatMinutesToHuman(schoolRollup.totalLateMinutesSum)} कुल
            </div>
          </div>

          {/* 5. कितना ऐड एक्स्ट्रा है */}
          <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50/50 p-4 rounded-2xl border border-purple-200 shadow-2xs relative overflow-hidden col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-purple-700 mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">ऐड एक्स्ट्रा</span>
              <i className="fa-solid fa-bolt text-purple-500"></i>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-purple-900">
              +{schoolRollup.totalExtraHoursSum} <span className="text-xs font-bold text-slate-500">घंटे</span>
            </div>
            <div className="text-[11px] text-purple-800 font-medium mt-1">
              अतिरिक्त ओवर-टाइम कार्य
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODE 1: ALL STAFF MASTER REGISTER TABLE */}
      {/* ============================================================== */}
      {viewMode === 'master_register' && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Table Filters & Header */}
          <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-lg shrink-0">
                <i className="fa-solid fa-users-gear"></i>
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-sm sm:text-base">
                  संपूर्ण स्टाफ मासिक उपस्थिति व ओवर-टाइम रजिस्टर
                </h3>
                <p className="text-xs text-slate-500">
                  {allStaffReports[0]?.monthName} — कुल {filteredReports.length} स्टाफ सदस्य
                </p>
              </div>
            </div>

            {/* Filter buttons and Search */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="स्टाफ का नाम खोजें..."
                  className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 w-44"
                />
              </div>

              <div className="flex items-center bg-white p-1 rounded-xl border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setRoleFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    roleFilter === 'all' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-600'
                  }`}
                >
                  सभी
                </button>
                <button
                  type="button"
                  onClick={() => setRoleFilter('teacher')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    roleFilter === 'teacher' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-600'
                  }`}
                >
                  शिक्षक
                </button>
                <button
                  type="button"
                  onClick={() => setRoleFilter('manager')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    roleFilter === 'manager' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-600'
                  }`}
                >
                  प्रबंधन
                </button>
                <button
                  type="button"
                  onClick={() => setRoleFilter('staff')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                    roleFilter === 'staff' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-600'
                  }`}
                >
                  अन्य
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-slate-100/80 text-slate-700 font-black border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3.5">क्र.</th>
                  <th className="px-4 py-3.5">स्टाफ का नाम (Staff Name)</th>
                  <th className="px-4 py-3.5 text-center">स्कूल खुला दिन</th>
                  <th className="px-4 py-3.5 text-center">कुल हाजिरी (Present)</th>
                  <th className="px-4 py-3.5 text-center">गैरहाजिरी (Absent)</th>
                  <th className="px-4 py-3.5 text-center">उपस्थिति %</th>
                  <th className="px-4 py-3.5 text-center">कितना लेट (Late)</th>
                  <th className="px-4 py-3.5 text-center">ऐड एक्स्ट्रा (Extra Overtime)</th>
                  <th className="px-4 py-3.5 text-right">कार्य (Action)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredReports.map((rep, idx) => (
                  <tr
                    key={rep.userId || idx}
                    className="hover:bg-amber-50/30 transition-colors"
                  >
                    <td className="px-4 py-3.5 text-slate-400 font-mono text-xs">
                      {idx + 1}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="font-bold text-slate-900">{rep.name}</div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="px-2 py-0.2 rounded bg-slate-100 font-semibold text-slate-700">
                          {rep.designation}
                        </span>
                        <span className="font-mono text-slate-400">{rep.mobile}</span>
                      </div>
                    </td>

                    {/* स्कूल खुला */}
                    <td className="px-4 py-3.5 text-center font-bold text-slate-800">
                      <span className="px-2.5 py-1 rounded-xl bg-blue-50 text-blue-900 border border-blue-200/60 font-mono">
                        {rep.workingDays} दिन
                      </span>
                    </td>

                    {/* कुल हाजिरी */}
                    <td className="px-4 py-3.5 text-center">
                      <span className="px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-900 font-black font-mono inline-flex items-center gap-1">
                        <i className="fa-solid fa-check text-[10px]"></i>
                        <span>{rep.presentDays} दिन</span>
                      </span>
                    </td>

                    {/* गैरहाजिरी */}
                    <td className="px-4 py-3.5 text-center">
                      <span
                        className={`px-2.5 py-1 rounded-xl font-black font-mono inline-flex items-center gap-1 ${
                          rep.absentDays > 0
                            ? 'bg-rose-100 text-rose-900'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {rep.absentDays > 0 ? (
                          <>
                            <i className="fa-solid fa-xmark text-[10px]"></i>
                            <span>{rep.absentDays} दिन</span>
                          </>
                        ) : (
                          <span>0</span>
                        )}
                      </span>
                    </td>

                    {/* उपस्थिति % */}
                    <td className="px-4 py-3.5 text-center">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="font-black text-slate-900 font-mono">
                          {rep.attendancePercentage}%
                        </span>
                        <div className="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              rep.attendancePercentage >= 90
                                ? 'bg-emerald-500'
                                : rep.attendancePercentage >= 75
                                ? 'bg-amber-500'
                                : 'bg-rose-500'
                            }`}
                            style={{ width: `${rep.attendancePercentage}%` }}
                          ></div>
                        </div>
                      </div>
                    </td>

                    {/* कितना लेट */}
                    <td className="px-4 py-3.5 text-center">
                      {rep.lateDays > 0 ? (
                        <div className="inline-flex flex-col items-center">
                          <span className="px-2 py-0.5 rounded-lg bg-amber-100 text-amber-900 font-bold text-xs">
                            {rep.lateDays} दिन लेट
                          </span>
                          <span className="text-[10px] text-amber-700 font-medium mt-0.5">
                            ({rep.formattedLateTime})
                          </span>
                        </div>
                      ) : (
                        <span className="text-emerald-700 text-xs font-bold flex items-center justify-center gap-1">
                          <i className="fa-solid fa-check text-[10px]"></i>
                          <span>समयनिष्ठ</span>
                        </span>
                      )}
                    </td>

                    {/* कितना ऐड एक्स्ट्रा */}
                    <td className="px-4 py-3.5 text-center">
                      {rep.extraOvertimeHours > 0 || rep.extraDutyDays > 0 ? (
                        <div className="inline-flex flex-col items-center">
                          <span className="px-2 py-0.5 rounded-lg bg-purple-100 text-purple-900 font-black text-xs font-mono">
                            +{rep.extraOvertimeHours} घंटे
                          </span>
                          {rep.extraDutyDays > 0 && (
                            <span className="text-[10px] text-purple-700 font-semibold mt-0.5">
                              {rep.extraDutyDays} अतिरिक्त दिवस
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 font-mono">—</span>
                      )}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPaySlipStaff(rep)}
                          className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                          title="मासिक वेतन पे-स्लिप देखें"
                        >
                          <i className="fa-solid fa-file-invoice-dollar text-[11px]"></i>
                          <span>पे-स्लिप</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStaffUserId(rep.userId);
                            setViewMode('individual_report');
                          }}
                          className="px-3 py-1.5 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                        >
                          <i className="fa-solid fa-eye text-[11px]"></i>
                          <span>पूरी पर्ची</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODE 2: INDIVIDUAL STAFF DETAILED REPORT CARD & SLIP */}
      {/* ============================================================== */}
      {viewMode === 'individual_report' && currentSelectedReport && (
        <div className="space-y-6 animate-fadeIn">
          {/* Staff Member Selector Bar */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 font-black flex items-center justify-center text-xl shadow-sm">
                <i className="fa-solid fa-user-tie"></i>
              </div>
              <div>
                <span className="text-xs text-slate-500 font-bold block uppercase tracking-wider">
                  व्यक्तिगत स्टाफ रिपोर्ट
                </span>
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <span>{currentSelectedReport.name}</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-700 font-bold">
                    {currentSelectedReport.designation}
                  </span>
                </h3>
              </div>
            </div>

            {/* Selector Dropdown if multiple staff exist (Manager Only) */}
            {isManager && staffList.length > 1 && (
              <div className="flex items-center gap-2 w-full md:w-auto">
                <label className="text-xs text-slate-600 font-bold shrink-0">
                  स्टाफ चुनें:
                </label>
                <select
                  value={selectedStaffUserId}
                  onChange={(e) => setSelectedStaffUserId(e.target.value)}
                  className="w-full md:w-64 px-3.5 py-2 rounded-xl border border-slate-300 font-bold text-xs bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs cursor-pointer"
                >
                  {staffList.map((st) => (
                    <option
                      key={st.User_ID || st.Username || String(st.Mobile_number)}
                      value={st.User_ID || st.Username || String(st.Mobile_number)}
                    >
                      {st.Name} ({st.Designation || 'Teacher'})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* 5 Big KPI Hero Cards for this Individual */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {/* Card 1: कितने दिन स्कूल खुला */}
            <div className="bg-white p-5 rounded-3xl border-2 border-blue-200 shadow-sm flex flex-col justify-between">
              <div className="flex items-center justify-between text-blue-600 mb-2">
                <span className="text-xs font-black uppercase tracking-wider">1. स्कूल खुला</span>
                <i className="fa-solid fa-door-open text-base"></i>
              </div>
              <div>
                <div className="text-3xl font-black text-slate-900 font-mono">
                  {currentSelectedReport.workingDays}{' '}
                  <span className="text-sm font-bold text-slate-500">दिन</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  कुल कार्य दिवस ({currentSelectedReport.monthName})
                  {currentSelectedReport.totalHolidays > 0 && (
                    <span className="block text-[10px] font-bold text-amber-700 mt-0.5">
                      🌴 {currentSelectedReport.totalHolidays} स्कूल अवकाश छोड़कर
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Card 2: कितने दिन टीचर आया (हाजिरी) */}
            <div className="bg-white p-5 rounded-3xl border-2 border-emerald-300 shadow-sm flex flex-col justify-between bg-emerald-50/20">
              <div className="flex items-center justify-between text-emerald-700 mb-2">
                <span className="text-xs font-black uppercase tracking-wider">2. कुल हाजिरी</span>
                <i className="fa-solid fa-calendar-check text-base"></i>
              </div>
              <div>
                <div className="text-3xl font-black text-emerald-800 font-mono">
                  {currentSelectedReport.presentDays}{' '}
                  <span className="text-sm font-bold text-emerald-600">दिन</span>
                </div>
                <div className="text-[11px] text-emerald-700 font-bold mt-1">
                  {currentSelectedReport.attendancePercentage}% उपस्थिति दर
                </div>
              </div>
            </div>

            {/* Card 3: कितनी एब्सेंट है */}
            <div className="bg-white p-5 rounded-3xl border-2 border-rose-300 shadow-sm flex flex-col justify-between bg-rose-50/20">
              <div className="flex items-center justify-between text-rose-700 mb-2">
                <span className="text-xs font-black uppercase tracking-wider">3. गैरहाजिरी</span>
                <i className="fa-solid fa-calendar-xmark text-base"></i>
              </div>
              <div>
                <div className="text-3xl font-black text-rose-800 font-mono">
                  {currentSelectedReport.absentDays}{' '}
                  <span className="text-sm font-bold text-rose-600">दिन</span>
                </div>
                <div className="text-[11px] text-rose-700 font-medium mt-1">
                  {currentSelectedReport.absentDays === 0
                    ? 'शानदार! 0 अनुपस्थिति'
                    : 'अनुपस्थित कार्य दिवस'}
                </div>
              </div>
            </div>

            {/* Card 4: कितना लेट है */}
            <div className="bg-white p-5 rounded-3xl border-2 border-amber-300 shadow-sm flex flex-col justify-between bg-amber-50/20">
              <div className="flex items-center justify-between text-amber-700 mb-2">
                <span className="text-xs font-black uppercase tracking-wider">4. कितना लेट</span>
                <i className="fa-solid fa-clock-rotate-left text-base"></i>
              </div>
              <div>
                <div className="text-3xl font-black text-amber-900 font-mono">
                  {currentSelectedReport.lateDays}{' '}
                  <span className="text-sm font-bold text-amber-700">दिन</span>
                </div>
                <div className="text-[11px] text-amber-800 font-bold mt-1">
                  {currentSelectedReport.lateDays > 0
                    ? `कुल ${currentSelectedReport.formattedLateTime} लेट`
                    : 'बिल्कुल समय पर (0 लेट)'}
                </div>
              </div>
            </div>

            {/* Card 5: कितना ऐड एक्स्ट्रा है */}
            <div className="bg-white p-5 rounded-3xl border-2 border-purple-300 shadow-sm flex flex-col justify-between bg-purple-50/20 col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-purple-700 mb-2">
                <span className="text-xs font-black uppercase tracking-wider">5. ऐड एक्स्ट्रा</span>
                <i className="fa-solid fa-bolt-lightning text-base"></i>
              </div>
              <div>
                <div className="text-3xl font-black text-purple-900 font-mono">
                  +{currentSelectedReport.extraOvertimeHours}{' '}
                  <span className="text-sm font-bold text-purple-700">घंटे</span>
                </div>
                <div className="text-[11px] text-purple-800 font-bold mt-1">
                  {currentSelectedReport.extraDutyDays > 0
                    ? `${currentSelectedReport.extraDutyDays} अतिरिक्त दिवस ड्यूटी`
                    : 'अतिरिक्त कार्य समय'}
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Panels for Late & Extra */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Late Analysis Details */}
            <div className="bg-white p-5 rounded-3xl border border-amber-200/80 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center text-xs">
                    <i className="fa-solid fa-clock"></i>
                  </span>
                  <span>लेट आगमन विवरण (Late Breakdown)</span>
                </h4>
                <span className="text-xs font-mono font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-200">
                  कट-ऑफ: {standardStartTime}
                </span>
              </div>

              {currentSelectedReport.lateDetails.length === 0 ? (
                <div className="p-4 rounded-2xl bg-emerald-50 text-emerald-800 text-xs flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-200 flex items-center justify-center font-bold">
                    <i className="fa-solid fa-trophy"></i>
                  </div>
                  <div>
                    <span className="font-bold block">उत्कृष्ट समयबद्धता!</span>
                    <span>इस महीने यह स्टाफ सदस्य किसी भी दिन लेट नहीं हुए।</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {currentSelectedReport.lateDetails.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/60 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-circle-exclamation text-amber-600"></i>
                        <span className="font-bold text-slate-900">{item.date}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-600">
                          पहुंचे: <b>{item.checkIn}</b>
                        </span>
                        <span className="font-bold text-amber-800 bg-amber-200/80 px-2 py-0.5 rounded-md font-mono">
                          +{item.lateMinutes} मिनट लेट
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Extra Overtime Details */}
            <div className="bg-white p-5 rounded-3xl border border-purple-200/80 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-purple-100 text-purple-800 flex items-center justify-center text-xs">
                    <i className="fa-solid fa-bolt"></i>
                  </span>
                  <span>ऐड एक्स्ट्रा ओवर-टाइम विवरण (Overtime Breakdown)</span>
                </h4>
                <span className="text-xs font-mono font-bold text-purple-800 bg-purple-50 px-2 py-0.5 rounded-lg border border-purple-200">
                  कट-ऑफ: {standardEndTime}
                </span>
              </div>

              {currentSelectedReport.extraDetails.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-50 text-slate-600 text-xs flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-bold">
                    <i className="fa-regular fa-clock"></i>
                  </div>
                  <div>
                    <span className="font-bold block">सामान्य ड्यूटी</span>
                    <span>इस माह कोई अतिरिक्त ओवर-टाइम कार्य दर्ज नहीं है।</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {currentSelectedReport.extraDetails.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/60 border border-purple-200/60 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-plus text-purple-600"></i>
                        <span className="font-bold text-slate-900">{item.date}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-600">
                          प्रस्थान: <b>{item.checkOut}</b>
                        </span>
                        <span className="font-bold text-purple-800 bg-purple-200/80 px-2 py-0.5 rounded-md font-mono">
                          +{formatMinutesToHuman(item.extraMinutes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* DAY-BY-DAY CALENDAR & TIMELINE TABLE */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60">
              <h4 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                <i className="fa-regular fa-calendar-check text-amber-500"></i>
                <span>दैनिक उपस्थिति व समय सारणी (Day-by-Day Timeline)</span>
              </h4>
              <span className="text-xs text-slate-500 font-semibold">
                {currentSelectedReport.monthName} (1 से {currentSelectedReport.totalCalendarDays} तारीख तक)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-100 text-slate-700 font-black border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">तारीख व वार</th>
                    <th className="px-4 py-3">स्थिति (Status)</th>
                    <th className="px-4 py-3">चेक-इन (Arrival)</th>
                    <th className="px-4 py-3">चेक-आउट (Departure)</th>
                    <th className="px-4 py-3">कार्य घंटे</th>
                    <th className="px-4 py-3">विलंब (Late)</th>
                    <th className="px-4 py-3">ऐड एक्स्ट्रा</th>
                    <th className="px-4 py-3">माध्यम व टिप्पणी</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentSelectedReport.dailyBreakdown.map((day) => (
                    <tr
                      key={day.date}
                      className={`hover:bg-slate-50 transition-colors ${
                        day.isSunday
                          ? 'bg-slate-50/70 text-slate-400'
                          : day.isHoliday && day.status === 'Holiday'
                          ? 'bg-amber-50/70 text-amber-900'
                          : day.status === 'Present'
                          ? 'bg-emerald-50/15'
                          : day.status === 'Late'
                          ? 'bg-amber-50/25'
                          : day.status === 'Absent'
                          ? 'bg-rose-50/15'
                          : ''
                      }`}
                    >
                      {/* तारीख व वार */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-7 h-7 rounded-lg font-mono font-bold flex items-center justify-center text-xs ${
                              day.isSunday
                                ? 'bg-slate-200 text-slate-600'
                                : day.isHoliday
                                ? 'bg-amber-200 text-amber-900'
                                : day.isToday
                                ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-400/50'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {day.dayNumber}
                          </span>
                          <div>
                            <span className="font-bold text-slate-900 block">{day.dayName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{day.date}</span>
                          </div>
                        </div>
                      </td>

                      {/* स्थिति */}
                      <td className="px-4 py-3">
                        {day.isSunday ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">
                            रविवार (अवकाश)
                          </span>
                        ) : day.status === 'Holiday' || (day.isHoliday && !day.record) ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                            <span>🌴</span>
                            <span>{day.holidayTitle || 'विद्यालय अवकाश'}</span>
                          </span>
                        ) : day.isFuture ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-400">
                            आगामी
                          </span>
                        ) : day.status === 'Present' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 inline-flex items-center gap-1">
                            <i className="fa-solid fa-check text-[10px]"></i>
                            <span>उपस्थित</span>
                          </span>
                        ) : day.status === 'Late' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-900 inline-flex items-center gap-1">
                            <i className="fa-solid fa-clock text-[10px]"></i>
                            <span>विलंब (Late)</span>
                          </span>
                        ) : day.status === 'Half-Day' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-sky-100 text-sky-800">
                            हाफ-डे
                          </span>
                        ) : day.status === 'Leave' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-100 text-indigo-800">
                            स्वीकृत अवकाश
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-800 inline-flex items-center gap-1">
                            <i className="fa-solid fa-xmark text-[10px]"></i>
                            <span>अनुपस्थित (Absent)</span>
                          </span>
                        )}
                      </td>

                      {/* चेक-इन */}
                      <td className="px-4 py-3 font-mono font-bold">
                        {day.checkIn ? (
                          <span className="text-emerald-700 flex items-center gap-1">
                            <i className="fa-regular fa-clock text-emerald-500"></i>
                            <span>{day.checkIn}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* चेक-आउट */}
                      <td className="px-4 py-3 font-mono">
                        {day.checkOut ? (
                          <span className="text-slate-700 flex items-center gap-1">
                            <i className="fa-solid fa-arrow-right-from-bracket text-slate-400"></i>
                            <span>{day.checkOut}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* कार्य घंटे */}
                      <td className="px-4 py-3 font-mono text-slate-700">
                        {day.totalDurationHours > 0 ? (
                          <span>{day.totalDurationHours} घंटे</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* विलंब */}
                      <td className="px-4 py-3 font-mono">
                        {day.isLate ? (
                          <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-xs">
                            +{day.lateMinutes} मिनट
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* ऐड एक्स्ट्रा */}
                      <td className="px-4 py-3 font-mono">
                        {day.extraMinutes > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-900 font-black text-xs">
                            +{formatMinutesToHuman(day.extraMinutes)}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      {/* माध्यम */}
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {day.method ? (
                          <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-medium">
                            <i className="fa-solid fa-qrcode text-indigo-500"></i>
                            <span>{day.method}</span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODE 3: FEATURE 5 — STAFF SALARY & LATE/OVERTIME PAY-SLIP HUB */}
      {/* ============================================================== */}
      {viewMode === 'salary_payroll' && (
        <div className="space-y-5 animate-fadeIn">
          {(() => {
            const targetReports = isManager ? filteredReports : currentSelectedReport ? [currentSelectedReport] : [];
            const rows = targetReports.map((rep) => {
              const cfg =
                salaryConfigs[rep.userId] ||
                salaryConfigs[String(rep.mobile || '').trim()] ||
                getDefaultStaffSalaryConfig(rep.userId, rep.name);
              const calc: StaffSalaryCalculation = calculateStaffMonthlySalary(rep, cfg);
              return { rep, cfg, calc };
            });

            const totalBase = rows.reduce((acc, r) => acc + r.calc.baseSalary, 0);
            const totalAdditions = rows.reduce((acc, r) => acc + r.calc.totalAdditions, 0);
            const totalDeductions = rows.reduce((acc, r) => acc + r.calc.totalDeductions, 0);
            const totalNet = rows.reduce((acc, r) => acc + r.calc.netPayable, 0);

            const openEditSalary = (rep: StaffMonthlyReport, cfg: StaffSalaryConfig) => {
              setEditingSalaryStaff(rep);
              setSalaryForm({
                ...getDefaultStaffSalaryConfig(rep.userId, rep.name),
                ...cfg,
                userId: rep.userId,
                name: rep.name,
              });
            };

            return (
              <>
                {/* Summary KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                      कुल मूल वेतन (Base Salary)
                    </span>
                    <div className="text-2xl font-black text-slate-900 mt-1">
                      ₹{totalBase.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-slate-500 mt-0.5 block">
                      {rows.length} स्टाफ · {allStaffReports[0]?.monthName}
                    </span>
                  </div>

                  <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 shadow-2xs">
                    <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
                      ओवर-टाइम व बोनस (+)
                    </span>
                    <div className="text-2xl font-black text-emerald-800 mt-1">
                      +₹{totalAdditions.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-emerald-700 mt-0.5 block">
                      Add Extra घंटे + अवकाश ड्यूटी + भत्ता
                    </span>
                  </div>

                  <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-200 shadow-2xs">
                    <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
                      अनुपस्थिति / लेट कटौती (-)
                    </span>
                    <div className="text-2xl font-black text-rose-800 mt-1">
                      -₹{totalDeductions.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-rose-700 mt-0.5 block">
                      सवैतनिक अवकाश व लेट छूट घटाकर
                    </span>
                  </div>

                  <div className="bg-[#0c2340] text-white p-4 rounded-2xl border border-amber-400/40 shadow-sm">
                    <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider block">
                      शुद्ध देय वेतन (Net Payable)
                    </span>
                    <div className="text-2xl font-black text-white mt-1">
                      ₹{totalNet.toLocaleString('en-IN')}
                    </div>
                    <span className="text-[11px] text-amber-200/80 mt-0.5 block">
                      ऑटो हाजिरी आधारित गणना
                    </span>
                  </div>
                </div>

                {/* Payroll Table */}
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <h3 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2">
                        <i className="fa-solid fa-money-check-dollar text-emerald-600"></i>
                        <span>मासिक स्टाफ वेतन व लेट/ओवर-टाइम पे-रोल रजिस्टर</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        उपस्थिति, लेट मिनट, और Add Extra घंटों के आधार पर स्वतः वेतन गणना · {allStaffReports[0]?.monthName}
                      </p>
                    </div>

                    {isManager && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={syncingPayrollBackup || rows.length === 0}
                          onClick={async () => {
                            setSyncingPayrollBackup(true);
                            setPayrollSyncBanner(null);
                            try {
                              const payloadRecords: StaffPayrollBackupRecord[] = rows.map(({ rep, calc }) => ({
                                payrollKey: `${rep.monthKey}::${rep.userId}`,
                                monthKey: rep.monthKey,
                                monthName: rep.monthName,
                                userId: rep.userId,
                                name: rep.name,
                                role: rep.designation,
                                mobile: String(rep.mobile || ''),
                                workingDays: rep.workingDays,
                                presentDays: rep.presentDays,
                                absentDays: rep.absentDays,
                                halfDays: rep.halfDays,
                                lateDays: rep.lateDays,
                                totalLateMinutes: rep.totalLateMinutes,
                                extraOvertimeHours: rep.extraOvertimeHours,
                                extraDutyDays: rep.extraDutyDays,
                                baseSalary: calc.baseSalary,
                                totalAdditions: calc.totalAdditions,
                                totalDeductions: calc.totalDeductions,
                                netPayable: calc.netPayable,
                                savedAt: getLocalTimestamp(),
                              }));
                              const res = await syncAllPayrollBackupToSheet({
                                records: payloadRecords,
                                configs: salaryConfigs,
                              });
                              if (res.sheetSynced) {
                                setPayrollSyncBanner({
                                  ok: true,
                                  msg: `✅ ${payloadRecords.length} स्टाफ का वेतन डेटा 'Staff_Salary_Payroll' व 'Staff_Salary_Config' Google Sheet टैब में बैकअप हो गया!`,
                                });
                              } else {
                                setPayrollSyncBanner({
                                  ok: false,
                                  msg: `⚠️ सर्वर पर सेव हो गया, पर Google Sheet में नहीं गया (${res.sheetError || 'कृपया नया Apps Script कोड Deploy करें'})`,
                                });
                              }
                            } finally {
                              setSyncingPayrollBackup(false);
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                          title="इस माह का पूरा वेतन रजिस्टर Google Sheet (Staff_Salary_Payroll) में बैकअप करें"
                        >
                          <i className={`fa-solid ${syncingPayrollBackup ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i>
                          <span>{syncingPayrollBackup ? 'सिंक हो रहा है...' : 'Sheet में बैकअप'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const headers = ['Staff_Name', 'Role', 'Month', 'Working_Days', 'Present', 'Absent', 'Half_Days', 'Late_Days', 'Late_Min', 'Overtime_Hrs', 'Base_Salary', 'Additions', 'Deductions', 'Net_Payable'];
                            const csvLines = [headers.join(',')];
                            rows.forEach(({ rep, calc }) => {
                              csvLines.push(
                                [
                                  `"${String(rep.name || '').replace(/"/g, '""')}"`,
                                  `"${String(rep.designation || '').replace(/"/g, '""')}"`,
                                  `"${String(rep.monthName || '')}"`,
                                  rep.workingDays,
                                  rep.presentDays,
                                  rep.absentDays,
                                  rep.halfDays,
                                  rep.lateDays,
                                  rep.totalLateMinutes,
                                  rep.extraOvertimeHours,
                                  calc.baseSalary,
                                  calc.totalAdditions,
                                  calc.totalDeductions,
                                  calc.netPayable,
                                ].join(',')
                              );
                            });
                            const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            link.href = URL.createObjectURL(blob);
                            link.download = `EVS_Staff_Payroll_${selectedMonth}.csv`;
                            link.click();
                          }}
                          className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                          title="Excel/CSV बैकअप डाउनलोड करें"
                        >
                          <i className="fa-solid fa-file-csv text-emerald-700"></i>
                          <span>CSV बैकअप</span>
                        </button>

                        <div className="relative">
                          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="स्टाफ खोजें..."
                            className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 w-40"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {payrollSyncBanner && (
                    <div
                      className={`mx-4 mt-3 p-3 rounded-xl text-xs font-bold flex items-center justify-between gap-2 ${
                        payrollSyncBanner.ok
                          ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                          : 'bg-amber-50 border border-amber-300 text-amber-900'
                      }`}
                    >
                      <span>{payrollSyncBanner.msg}</span>
                      <button
                        type="button"
                        onClick={() => setPayrollSyncBanner(null)}
                        className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm tabular-nums">
                      <thead className="bg-[#0c2340] text-amber-300 text-[11px] uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-3.5">स्टाफ व पद</th>
                          <th className="px-3.5 py-3.5 text-right">मूल वेतन</th>
                          <th className="px-3.5 py-3.5 text-center">हाजिरी / अनुपस्थित</th>
                          <th className="px-3.5 py-3.5 text-center">लेट / एक्स्ट्रा</th>
                          <th className="px-3.5 py-3.5 text-right">कटौती (-)</th>
                          <th className="px-3.5 py-3.5 text-right">अतिरिक्त (+)</th>
                          <th className="px-4 py-3.5 text-right">शुद्ध देय (Net ₹)</th>
                          <th className="px-4 py-3.5 text-right">पे-स्लिप व नियम</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map(({ rep, cfg, calc }) => (
                          <tr key={rep.userId} className="hover:bg-amber-50/30 transition-colors">
                            <td className="px-4 py-3.5">
                              <div className="font-extrabold text-slate-900">{rep.name}</div>
                              <div className="text-[11px] text-slate-500">
                                {rep.designation} · ₹{calc.perDaySalary.toLocaleString('en-IN')}/दिन
                              </div>
                            </td>
                            <td className="px-3.5 py-3.5 text-right font-bold text-slate-800 whitespace-nowrap">
                              ₹{calc.baseSalary.toLocaleString('en-IN')}
                            </td>
                            <td className="px-3.5 py-3.5 text-center whitespace-nowrap">
                              <div className="font-bold text-emerald-700">
                                {rep.presentDays}/{rep.workingDays} दिन
                              </div>
                              <div className="text-[11px] text-rose-600">
                                {rep.absentDays} Absent ({calc.paidLeaveApplied} Free)
                              </div>
                            </td>
                            <td className="px-3.5 py-3.5 text-center whitespace-nowrap">
                              <div className="text-amber-800 font-semibold">
                                {rep.lateDays} लेट ({rep.totalLateMinutes}m)
                              </div>
                              <div className="text-purple-700 font-semibold text-[11px]">
                                +{rep.extraOvertimeHours}h Extra
                              </div>
                            </td>
                            <td className="px-3.5 py-3.5 text-right font-bold text-rose-700 whitespace-nowrap">
                              {calc.totalDeductions > 0 ? `-₹${calc.totalDeductions.toLocaleString('en-IN')}` : '₹0'}
                            </td>
                            <td className="px-3.5 py-3.5 text-right font-bold text-emerald-700 whitespace-nowrap">
                              {calc.totalAdditions > 0 ? `+₹${calc.totalAdditions.toLocaleString('en-IN')}` : '₹0'}
                            </td>
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <span className="px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-950 font-black text-sm border border-emerald-200">
                                ₹{calc.netPayable.toLocaleString('en-IN')}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {isManager && (
                                  <button
                                    type="button"
                                    onClick={() => openEditSalary(rep, cfg)}
                                    className="px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1 border border-amber-300"
                                    title="वेतन और कटौती/ओवर-टाइम नियम सेट करें"
                                  >
                                    <i className="fa-solid fa-sliders text-[10px]"></i>
                                    <span>नियम सेट</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setPaySlipStaff(rep)}
                                  className="px-3 py-1.5 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 font-bold text-xs transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                >
                                  <i className="fa-solid fa-receipt text-[10px]"></i>
                                  <span>Pay-Slip</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL A: STAFF SALARY & RULE CONFIGURATION (MANAGER ONLY)       */}
      {/* ============================================================== */}
      {isManager && editingSalaryStaff && salaryForm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/70 backdrop-blur-xs flex items-start justify-center p-3 sm:p-5 animate-fadeIn"
          onClick={() => setEditingSalaryStaff(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-[#0c2340] to-[#16365c] px-5 py-4 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-base font-extrabold text-amber-300">
                  वेतन व लेट/ओवर-टाइम नियम — {editingSalaryStaff.name}
                </h3>
                <p className="text-[11px] text-slate-300">
                  {editingSalaryStaff.designation} · ID: {editingSalaryStaff.userId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSalaryStaff(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSavingSalaryConfig(true);
                try {
                  const res = await saveStaffSalaryConfigToServer(salaryForm);
                  setSalaryConfigs(res.configs);
                  setEditingSalaryStaff(null);
                  setPayrollSyncBanner(
                    res.sheetSynced
                      ? {
                          ok: true,
                          msg: `✅ ${salaryForm.name || salaryForm.userId} का वेतन नियम सर्वर व Google Sheet ('Staff_Salary_Config') में सेव हो गया!`,
                        }
                      : {
                          ok: false,
                          msg: `⚠️ नियम ऐप सर्वर पर सेव हुआ (${res.sheetError || 'Google Sheet सिंक के लिए नया Apps Script Deploy करें'})`,
                        }
                  );
                } finally {
                  setSavingSalaryConfig(false);
                }
              }}
              className="p-5 overflow-y-auto flex-1 space-y-4 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    मासिक मूल वेतन (Base Salary ₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    required
                    value={salaryForm.baseSalary}
                    onChange={(e) => setSalaryForm({ ...salaryForm, baseSalary: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-sm outline-none focus:border-blue-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    मासिक मुफ्त छुट्टी (Paid Leave Days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="1"
                    value={salaryForm.paidLeaveDays}
                    onChange={(e) => setSalaryForm({ ...salaryForm, paidLeaveDays: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-sm outline-none focus:border-blue-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    लेट छूट सीमा (Free Late Days/माह)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="15"
                    value={salaryForm.lateThresholdDays}
                    onChange={(e) => setSalaryForm({ ...salaryForm, lateThresholdDays: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold outline-none focus:border-blue-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    अतिरिक्त लेट दिन कटौती (₹ / Late Day)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={salaryForm.latePenaltyPerDay}
                    onChange={(e) => setSalaryForm({ ...salaryForm, latePenaltyPerDay: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold outline-none focus:border-blue-900"
                  />
                </div>

                <div>
                  <label className="block font-bold text-purple-800 mb-1">
                    ओवर-टाइम दर (Overtime ₹ / घंटा)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    value={salaryForm.overtimeHourlyRate}
                    onChange={(e) => setSalaryForm({ ...salaryForm, overtimeHourlyRate: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-purple-300 font-bold outline-none focus:border-purple-700"
                  />
                </div>

                <div>
                  <label className="block font-bold text-purple-800 mb-1">
                    अवकाश ड्यूटी बोनस (₹ / Extra Day)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={salaryForm.extraDutyDayBonus}
                    onChange={(e) => setSalaryForm({ ...salaryForm, extraDutyDayBonus: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-purple-300 font-bold outline-none focus:border-purple-700"
                  />
                </div>

                <div>
                  <label className="block font-bold text-emerald-800 mb-1">
                    अन्य भत्ता / बोनस (Allowances ₹ +)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={salaryForm.allowances}
                    onChange={(e) => setSalaryForm({ ...salaryForm, allowances: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-emerald-300 font-bold outline-none focus:border-emerald-700"
                  />
                </div>

                <div>
                  <label className="block font-bold text-rose-800 mb-1">
                    अग्रिम / अन्य कटौती (Advance Cut ₹ -)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="50"
                    value={salaryForm.manualDeduction}
                    onChange={(e) => setSalaryForm({ ...salaryForm, manualDeduction: Number(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-rose-300 font-bold outline-none focus:border-rose-700"
                  />
                </div>
              </div>

              {(() => {
                const preview = calculateStaffMonthlySalary(editingSalaryStaff, salaryForm);
                return (
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between tabular-nums">
                    <div>
                      <div className="font-bold text-slate-700">अनुमानित शुद्ध वेतन (Live Preview)</div>
                      <div className="text-[11px] text-slate-500">
                        मूल ₹{preview.baseSalary.toLocaleString('en-IN')} + अतिरिक्त ₹{preview.totalAdditions.toLocaleString('en-IN')} − कटौती ₹{preview.totalDeductions.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div className="text-xl font-black text-emerald-700">
                      ₹{preview.netPayable.toLocaleString('en-IN')}
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingSalaryStaff(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  रद्द करें
                </button>
                <button
                  type="submit"
                  disabled={savingSalaryConfig}
                  className="px-5 py-2 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 font-extrabold cursor-pointer disabled:opacity-50"
                >
                  {savingSalaryConfig ? 'सेव हो रहा है...' : '✓ नियम सेव करें'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL B: OFFICIAL PRINTABLE MONTHLY SALARY PAY-SLIP (वेतन पर्ची) */}
      {/* ============================================================== */}
      {paySlipStaff && (() => {
        const cfg =
          salaryConfigs[paySlipStaff.userId] ||
          salaryConfigs[String(paySlipStaff.mobile || '').trim()] ||
          getDefaultStaffSalaryConfig(paySlipStaff.userId, paySlipStaff.name);
        const calc = calculateStaffMonthlySalary(paySlipStaff, cfg);

        const handleShareSalaryWhatsapp = () => {
          const msg =
            `*E.V.S. PUBLIC SCHOOL — मासिक वेतन पर्ची (Salary Pay-Slip)*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🗓️ *माह:* ${paySlipStaff.monthName}\n` +
            `👤 *नाम:* ${paySlipStaff.name} (${paySlipStaff.designation})\n` +
            `📊 *हाजिरी:* ${paySlipStaff.presentDays}/${paySlipStaff.workingDays} दिन · अनुपस्थित: ${paySlipStaff.absentDays} दिन\n` +
            `⏰ *लेट:* ${paySlipStaff.lateDays} दिन (${paySlipStaff.totalLateMinutes} मिनट) · *ओवर-टाइम:* +${paySlipStaff.extraOvertimeHours} घंटे\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `💵 *मूल वेतन (Base):* ₹${calc.baseSalary.toLocaleString('en-IN')}\n` +
            `➕ *ओवर-टाइम / बोनस:* +₹${calc.totalAdditions.toLocaleString('en-IN')}\n` +
            `➖ *अनुपस्थिति / लेट कटौती:* -₹${calc.totalDeductions.toLocaleString('en-IN')}\n` +
            `✅ *शुद्ध देय वेतन (Net Payable):* *₹${calc.netPayable.toLocaleString('en-IN')}*\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n` +
            `_सादर, लेखा व प्रबंधन कार्यालय — ई.वी.एस. पब्लिक स्कूल_`;
          openWhatsappAlert(paySlipStaff.mobile, msg, {
            alertType: 'Staff Salary Slip',
            recipientType: 'Staff',
            recipientId: paySlipStaff.userId,
            recipientName: paySlipStaff.name,
            classOrRole: paySlipStaff.designation,
            amount: calc.netPayable,
            sentBy: 'Manager',
          });
        };

        return (
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/75 backdrop-blur-xs flex items-start justify-center p-3 sm:p-5 animate-fadeIn"
            onClick={() => setPaySlipStaff(null)}
          >
            <div
              className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Top Toolbar (Hidden on print inside slip) */}
              <div className="bg-gradient-to-r from-[#0c2340] to-[#16365c] px-5 py-3.5 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <i className="fa-solid fa-file-invoice-dollar text-amber-400 text-lg"></i>
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-white">
                      आधिकारिक मासिक वेतन पर्ची (Salary Pay-Slip)
                    </h3>
                    <p className="text-[11px] text-amber-200">
                      {paySlipStaff.name} · {paySlipStaff.monthName}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPaySlipStaff(null)}
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Pay-Slip Printable Body */}
              <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5 text-xs text-slate-800 tabular-nums">
                {/* School Letterhead Banner */}
                <div className="border-b-2 border-[#0c2340] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-lg font-black text-[#0c2340] uppercase tracking-tight">
                      {schoolName || 'E.V.S. PUBLIC SCHOOL'}
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      आधिकारिक मासिक वेतन विवरण पत्र (Official Monthly Salary Statement)
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <span className="inline-block px-3 py-1 rounded-lg bg-amber-100 text-amber-950 font-black border border-amber-300">
                      वेतन माह: {paySlipStaff.monthName}
                    </span>
                  </div>
                </div>

                {/* Employee Metadata */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                  <div>
                    <span className="text-[10px] text-slate-500 block">स्टाफ का नाम</span>
                    <span className="font-extrabold text-slate-900 text-sm">{paySlipStaff.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">पद (Designation)</span>
                    <span className="font-bold text-slate-800">{paySlipStaff.designation}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">स्टाफ आईडी</span>
                    <span className="font-mono font-bold text-blue-900">{paySlipStaff.userId}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">मोबाइल नंबर</span>
                    <span className="font-mono font-bold text-slate-800">{paySlipStaff.mobile || '—'}</span>
                  </div>
                </div>

                {/* Attendance Breakdown Strip */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                  <div className="p-2 rounded-xl bg-blue-50 border border-blue-200">
                    <div className="text-[10px] text-blue-700 font-semibold">स्कूल खुला</div>
                    <div className="font-black text-sm text-blue-950">{paySlipStaff.workingDays} दिन</div>
                  </div>
                  <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="text-[10px] text-emerald-700 font-semibold">उपस्थित</div>
                    <div className="font-black text-sm text-emerald-900">{paySlipStaff.presentDays} दिन</div>
                  </div>
                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-200">
                    <div className="text-[10px] text-rose-700 font-semibold">अनुपस्थित</div>
                    <div className="font-black text-sm text-rose-900">{paySlipStaff.absentDays} दिन</div>
                  </div>
                  <div className="p-2 rounded-xl bg-amber-50 border border-amber-200">
                    <div className="text-[10px] text-amber-800 font-semibold">स्कूल अवकाश</div>
                    <div className="font-black text-sm text-amber-950">{paySlipStaff.totalHolidays} दिन</div>
                  </div>
                  <div className="p-2 rounded-xl bg-orange-50 border border-orange-200">
                    <div className="text-[10px] text-orange-800 font-semibold">लेट दिन</div>
                    <div className="font-black text-sm text-orange-950">{paySlipStaff.lateDays} ({paySlipStaff.totalLateMinutes}m)</div>
                  </div>
                  <div className="p-2 rounded-xl bg-purple-50 border border-purple-200">
                    <div className="text-[10px] text-purple-800 font-semibold">ऐड एक्स्ट्रा</div>
                    <div className="font-black text-sm text-purple-950">+{paySlipStaff.extraOvertimeHours}h</div>
                  </div>
                </div>

                {/* Earnings vs Deductions Two-Column Table */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Earnings */}
                  <div className="border border-emerald-200 rounded-2xl overflow-hidden">
                    <div className="bg-emerald-700 text-white px-3.5 py-2 font-bold text-xs flex items-center justify-between">
                      <span>आय व भत्ते (Earnings)</span>
                      <span>राशि (₹)</span>
                    </div>
                    <div className="p-3.5 space-y-2 bg-emerald-50/20">
                      <div className="flex justify-between">
                        <span className="text-slate-600">मासिक मूल वेतन (Base Salary)</span>
                        <span className="font-bold text-slate-900">₹{calc.baseSalary.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          ओवर-टाइम ({paySlipStaff.extraOvertimeHours}h × ₹{calc.config.overtimeHourlyRate})
                        </span>
                        <span className="font-bold text-emerald-700">+₹{calc.overtimePay.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          अतिरिक्त ड्यूटी ({paySlipStaff.extraDutyDays} दिन × ₹{calc.config.extraDutyDayBonus})
                        </span>
                        <span className="font-bold text-emerald-700">+₹{calc.extraDutyBonusPay.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">अन्य भत्ता / बोनस</span>
                        <span className="font-bold text-emerald-700">+₹{calc.allowances.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="pt-2 border-t border-emerald-200 flex justify-between font-black text-emerald-900">
                        <span>कुल सकल वेतन (Gross)</span>
                        <span>₹{calc.grossEarnings.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions */}
                  <div className="border border-rose-200 rounded-2xl overflow-hidden">
                    <div className="bg-rose-700 text-white px-3.5 py-2 font-bold text-xs flex items-center justify-between">
                      <span>कटौतियाँ (Deductions)</span>
                      <span>राशि (₹)</span>
                    </div>
                    <div className="p-3.5 space-y-2 bg-rose-50/20">
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          अनुपस्थिति ({calc.chargeableAbsentDays} दिन × ₹{calc.perDaySalary})
                        </span>
                        <span className="font-bold text-rose-700">-₹{calc.absentDeduction.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">हाफ-डे कटौती ({paySlipStaff.halfDays} दिन)</span>
                        <span className="font-bold text-rose-700">-₹{calc.halfDayDeduction.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">
                          लेट आगमन दंड ({calc.chargeableLateDays} अतिरिक्त दिन)
                        </span>
                        <span className="font-bold text-rose-700">-₹{calc.lateDeduction.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">अग्रिम वेतन / अन्य कटौती</span>
                        <span className="font-bold text-rose-700">-₹{calc.manualDeduction.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="pt-2 border-t border-rose-200 flex justify-between font-black text-rose-900">
                        <span>कुल कटौती (Total Cuts)</span>
                        <span>-₹{calc.totalDeductions.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Net Payable Hero Strip */}
                <div className="bg-[#0c2340] text-white p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-2 border-amber-400/60">
                  <div>
                    <div className="text-[11px] text-amber-300 font-bold uppercase tracking-wider">
                      शुद्ध देय मासिक वेतन (Net Payable Salary)
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      सवैतनिक अवकाश छूट: {calc.paidLeaveApplied} दिन · लेट छूट सीमा: {calc.config.lateThresholdDays} दिन
                    </div>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-amber-300">
                    ₹{calc.netPayable.toLocaleString('en-IN')}
                  </div>
                </div>

                {/* Signature Bar */}
                <div className="grid grid-cols-2 gap-6 pt-6 text-[11px] text-slate-500">
                  <div className="border-t border-slate-300 pt-1.5 text-center">
                    कर्मचारी हस्ताक्षर ({paySlipStaff.name})
                  </div>
                  <div className="border-t border-slate-300 pt-1.5 text-center">
                    प्रबंधक / प्रधानाचार्य हस्ताक्षर ({schoolName || 'E.V.S. Public School'})
                  </div>
                </div>
              </div>

              {/* Footer Actions */}
              <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleShareSalaryWhatsapp}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <i className="fa-brands fa-whatsapp text-sm"></i>
                  <span>WhatsApp पर स्लिप भेजें</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-4 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <i className="fa-solid fa-print"></i>
                    <span>प्रिंट / PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaySlipStaff(null)}
                    className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs cursor-pointer"
                  >
                    बंद करें
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
