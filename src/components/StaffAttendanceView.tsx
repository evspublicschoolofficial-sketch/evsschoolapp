import React, { useState, useMemo } from 'react';
import { SchoolUser, StaffAttendanceRecord } from '../types';
import { StaffMonthlyReportView } from './StaffMonthlyReportView';
import { SchoolLocationModal } from './SchoolLocationModal';

interface StaffAttendanceViewProps {
  currentUser: SchoolUser;
  allStaffUsers: SchoolUser[];
  attendanceRecords: StaffAttendanceRecord[];
  onOpenScanner: () => void;
  onOpenSchoolQr: () => void;
  onManualCheckIn?: (record: Partial<StaffAttendanceRecord>) => void;
  isManager?: boolean;
}

export const StaffAttendanceView: React.FC<StaffAttendanceViewProps> = ({
  currentUser,
  allStaffUsers = [],
  attendanceRecords = [],
  onOpenScanner,
  onOpenSchoolQr,
  onManualCheckIn,
  isManager = false,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'my_attendance' | 'all_today' | 'history' | 'monthly_report'>(
    isManager ? 'all_today' : 'my_attendance'
  );
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [searchStaff, setSearchStaff] = useState<string>('');
  const [filterDesignation, setFilterDesignation] = useState<string>('all');

  // Manual Check-in modal state
  const [manualModalOpen, setManualModalOpen] = useState<boolean>(false);
  const [manualSelectedUser, setManualSelectedUser] = useState<SchoolUser | null>(null);
  const [manualStatus, setManualStatus] = useState<StaffAttendanceRecord['status']>('Present');
  const [manualTime, setManualTime] = useState<string>(() => {
    return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  });
  const [manualRemark, setManualRemark] = useState<string>('');

  const todayStr = new Date().toISOString().split('T')[0];

  // Current logged in user's record for today
  const myTodayRecord = useMemo(() => {
    const myId = String(currentUser.User_ID || currentUser.Mobile_number || '').trim().toLowerCase();
    const myName = (currentUser.Name || '').trim().toLowerCase();
    return attendanceRecords.find(
      (r) =>
        r.date === todayStr &&
        (String(r.user_id).trim().toLowerCase() === myId || (myName && r.name.toLowerCase() === myName))
    );
  }, [attendanceRecords, currentUser, todayStr]);

  // Current user's monthly / all records
  const myAttendanceHistory = useMemo(() => {
    const myId = String(currentUser.User_ID || currentUser.Mobile_number || '').trim().toLowerCase();
    const myName = (currentUser.Name || '').trim().toLowerCase();
    return attendanceRecords
      .filter(
        (r) =>
          String(r.user_id).trim().toLowerCase() === myId || (myName && r.name.toLowerCase() === myName)
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [attendanceRecords, currentUser]);

  // Stats for the logged in staff member
  const myStats = useMemo(() => {
    const totalPresent = myAttendanceHistory.filter((r) => r.status === 'Present' || r.status === 'Late').length;
    const totalLate = myAttendanceHistory.filter((r) => r.status === 'Late').length;
    const totalOnTime = totalPresent - totalLate;
    const qrScans = myAttendanceHistory.filter((r) => r.method === 'School QR Scan').length;
    return {
      totalRecords: myAttendanceHistory.length,
      totalPresent,
      totalLate,
      totalOnTime,
      qrScans,
    };
  }, [myAttendanceHistory]);

  // Attendance for the selected date across all staff
  const recordsForSelectedDate = useMemo(() => {
    return attendanceRecords.filter((r) => r.date === selectedDate);
  }, [attendanceRecords, selectedDate]);

  // Roster of all registered staff from Users sheet and their attendance status on selected date
  const staffRosterForDate = useMemo(() => {
    const list = allStaffUsers.length > 0 ? allStaffUsers : [currentUser];
    return list.map((user) => {
      const uId = String(user.User_ID || user.Mobile_number || '').trim().toLowerCase();
      const uName = (user.Name || '').trim().toLowerCase();
      const att = recordsForSelectedDate.find(
        (r) =>
          String(r.user_id).trim().toLowerCase() === uId || (uName && r.name.toLowerCase() === uName)
      );
      return {
        user,
        attendance: att || null,
        isCheckedIn: !!att,
      };
    });
  }, [allStaffUsers, currentUser, recordsForSelectedDate]);

  // Filtered roster for search and designation
  const filteredRoster = useMemo(() => {
    return staffRosterForDate.filter(({ user }) => {
      const q = searchStaff.toLowerCase();
      const matchesSearch =
        !q ||
        user.Name.toLowerCase().includes(q) ||
        String(user.Mobile_number).includes(q) ||
        (user.Designation && user.Designation.toLowerCase().includes(q));

      const matchesDesignation =
        filterDesignation === 'all' ||
        (filterDesignation === 'Teacher' && /teacher|faculty/i.test(user.Designation || '')) ||
        (filterDesignation === 'Manager' && /manager|principal|admin/i.test(user.Designation || '')) ||
        (filterDesignation === 'Staff' && !/teacher|faculty|manager|principal|admin/i.test(user.Designation || ''));

      return matchesSearch && matchesDesignation;
    });
  }, [staffRosterForDate, searchStaff, filterDesignation]);

  const totalRegisteredStaff = staffRosterForDate.length;
  const presentCountOnSelectedDate = staffRosterForDate.filter((s) => s.isCheckedIn).length;
  const absentCountOnSelectedDate = totalRegisteredStaff - presentCountOnSelectedDate;

  // Submit manual check-in
  const handleSaveManual = () => {
    if (!manualSelectedUser || !onManualCheckIn) return;
    onManualCheckIn({
      user_id: manualSelectedUser.User_ID || String(manualSelectedUser.Mobile_number),
      username: manualSelectedUser.Username || '',
      name: manualSelectedUser.Name,
      designation: manualSelectedUser.Designation || 'Staff',
      date: selectedDate,
      check_in_time: manualTime,
      status: manualStatus,
      method: 'Manual',
      location: 'School Campus',
      remark: manualRemark,
      timestamp: Date.now(),
    });
    setManualModalOpen(false);
    setManualRemark('');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Banner / Welcome Card */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#123157] to-[#0c2340] rounded-3xl p-5 sm:p-7 text-white shadow-xl relative overflow-hidden border border-amber-500/20">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-radial from-amber-500/10 to-transparent pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                <i className="fa-solid fa-qrcode"></i>
                <span>Smart Attendance</span>
              </span>
              <span className="text-xs text-amber-200/90 font-medium">
                {isManager ? 'स्कूल स्टाफ उपस्थिति प्रबंधन' : 'अध्यापक व स्टाफ उपस्थिति पोर्टल'}
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              <span>{currentUser.Name}</span>
              <span className="text-xs sm:text-sm font-semibold px-2.5 py-0.5 rounded-lg bg-white/10 text-amber-300 border border-white/10">
                {currentUser.Designation || 'Teacher'}
              </span>
            </h2>

            {/* Today's Presence Status Pill */}
            <div className="pt-1">
              {myTodayRecord ? (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-bold text-xs sm:text-sm shadow-inner">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>आज की उपस्थिति: ✅ उपस्थित (Checked-In at {myTodayRecord.check_in_time})</span>
                  {myTodayRecord.check_out_time && (
                    <span className="text-emerald-200 text-xs">
                      • चेक-आउट: {myTodayRecord.check_out_time}
                    </span>
                  )}
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-200 font-bold text-xs sm:text-sm">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
                  <span>⚠️ आज की हाजिरी अभी दर्ज नहीं हुई है — कृपया स्कूल QR कोड स्कैन करें</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Action Buttons on Top Banner */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onOpenScanner}
              className="px-5 py-3.5 rounded-2xl font-black text-xs sm:text-sm bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 shadow-lg hover:shadow-amber-400/30 transition-all flex items-center gap-2.5 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
            >
              {myTodayRecord?.check_in_time && !myTodayRecord?.check_out_time ? (
                <>
                  <i className="fa-solid fa-arrow-right-from-bracket text-base"></i>
                  <span>🚪 स्कूल QR स्कैन करें (चेक-आउट दर्ज करें)</span>
                </>
              ) : myTodayRecord?.check_in_time && myTodayRecord?.check_out_time ? (
                <>
                  <i className="fa-solid fa-check-double text-base"></i>
                  <span>✅ आज की हाजिरी पूर्ण (QR पुनः स्कैन)</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-camera text-base"></i>
                  <span>📷 स्कूल QR स्कैन करें (Check-In)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSchoolQr}
              className="px-4 py-3.5 rounded-2xl font-bold text-xs sm:text-sm bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all flex items-center gap-2 cursor-pointer"
              title="स्कूल का आधिकारिक उपस्थिति QR कोड देखें व प्रिंट करें"
            >
              <i className="fa-solid fa-qrcode text-amber-300"></i>
              <span>स्कूल QR कोड देखें / प्रिंट</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSubTab('monthly_report')}
              className={`px-4 py-3.5 rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer shadow-md ${
                activeSubTab === 'monthly_report'
                  ? 'bg-amber-400 text-slate-950 font-black ring-2 ring-amber-300'
                  : 'bg-gradient-to-r from-purple-600/90 to-indigo-600/90 hover:from-purple-600 hover:to-indigo-600 text-white border border-purple-400/40'
              }`}
              title="माह के अंत का पूरा डाटा, स्कूल खुला, हाजिरी, गैरहाजिरी, लेट और ऐड एक्स्ट्रा देखें"
            >
              <i className="fa-solid fa-chart-pie text-amber-300"></i>
              <span>📊 मासिक स्टाफ डाटा (Monthly Report)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Geofence & GPS Security Verification Banner */}
      <div className="bg-gradient-to-r from-blue-50 via-emerald-50 to-blue-50 border border-blue-200/80 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs shadow-2xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
            <i className="fa-solid fa-location-dot"></i>
          </div>
          <div>
            <div className="font-bold text-slate-900 flex items-center gap-2">
              <span>स्कूल कैंपस GPS जियोफेंस सुरक्षा (Campus Geofence Active)</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                सख्त उपस्थिति नियम
              </span>
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">
              अटेंडेंस केवल स्कूल में शारीरिक रूप से मौजूद रहकर लाइव कैमरे से QR स्कैन करने पर ही लगेगी। फोटो या बाहर से स्कैन स्वतः अस्वीकृत हो जाएगा।
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setIsLocationModalOpen(true)}
            className="px-3.5 py-1.5 rounded-xl bg-[#0c2340] hover:bg-slate-900 text-amber-300 font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer border border-amber-400/40"
            title="स्कूल कैंपस GPS लोकेशन सेट करें या बदलें"
          >
            <i className="fa-solid fa-location-dot text-amber-400"></i>
            <span>स्कूल GPS सेटिंग्स</span>
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-2">
          {!isManager && (
            <button
              type="button"
              onClick={() => setActiveSubTab('my_attendance')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                activeSubTab === 'my_attendance'
                  ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <i className="fa-solid fa-user-check text-emerald-400"></i>
              <span>मेरी हाजिरी लॉग (My Attendance)</span>
              <span className="px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 text-[11px]">
                {myAttendanceHistory.length}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveSubTab('all_today')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === 'all_today'
                ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <i className="fa-solid fa-users-viewfinder text-blue-400"></i>
            <span>आज का स्टाफ चेक-इन रोस्टर (Staff Today)</span>
            <span className="px-2 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[11px]">
              {presentCountOnSelectedDate}/{totalRegisteredStaff}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('history')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === 'history'
                ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <i className="fa-solid fa-calendar-days text-amber-400"></i>
            <span>तारीख अनुसार (Date Report)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('monthly_report')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeSubTab === 'monthly_report'
                ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <i className="fa-solid fa-chart-pie text-purple-400"></i>
            <span>मासिक स्टाफ विश्लेषण (Monthly Data)</span>
            <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-black">
              महीने का डाटा
            </span>
          </button>
        </div>

        {/* Date Selector for history & roster (shown when in single-day view) */}
        {activeSubTab !== 'monthly_report' && (
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
            <span>तारीख:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="font-bold text-slate-900 border-none bg-transparent focus:outline-none cursor-pointer"
            />
            {selectedDate !== todayStr && (
              <button
                type="button"
                onClick={() => setSelectedDate(todayStr)}
                className="text-[11px] text-amber-600 hover:text-amber-800 font-bold underline ml-1"
              >
                आज (Today)
              </button>
            )}
          </div>
        )}
      </div>

      {/* VIEW 1: MY ATTENDANCE LOG */}
      {activeSubTab === 'my_attendance' && (
        <div className="space-y-6">
          {/* Quick Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
              <span className="text-xs text-slate-500 font-medium block">कुल दर्ज दिन</span>
              <span className="text-xl sm:text-2xl font-black text-slate-900">
                {myStats.totalRecords} दिन
              </span>
            </div>

            <div className="bg-emerald-50/70 p-4 rounded-2xl border border-emerald-200 shadow-2xs">
              <span className="text-xs text-emerald-700 font-medium block">उपस्थित (Present)</span>
              <span className="text-xl sm:text-2xl font-black text-emerald-800">
                {myStats.totalPresent}
              </span>
            </div>

            <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200 shadow-2xs">
              <span className="text-xs text-amber-700 font-medium block">समय पर चेक-इन</span>
              <span className="text-xl sm:text-2xl font-black text-amber-800">
                {myStats.totalOnTime}
              </span>
            </div>

            <div className="bg-blue-50/70 p-4 rounded-2xl border border-blue-200 shadow-2xs">
              <span className="text-xs text-blue-700 font-medium block">QR कोड स्कैन द्वारा</span>
              <span className="text-xl sm:text-2xl font-black text-blue-800">
                {myStats.qrScans}
              </span>
            </div>
          </div>

          {/* Attendance History Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-clock-rotate-left text-amber-500"></i>
                <span>मेरी दैनिक उपस्थिति तालिका (Attendance Records)</span>
              </h3>
              <span className="text-xs text-slate-500">
                कुल प्रविष्टियां: {myAttendanceHistory.length}
              </span>
            </div>

            {myAttendanceHistory.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-2xl">
                  <i className="fa-solid fa-calendar-xmark"></i>
                </div>
                <h4 className="font-bold text-slate-700">अभी तक कोई उपस्थिति रिकॉर्ड नहीं मिला</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  जब आप स्कूल के गेट पर लगे QR कोड को स्कैन करके 'YES' पुष्टि करेंगे, तो आपकी दैनिक उपस्थिति यहाँ दिखना शुरू हो जाएगी।
                </p>
                <button
                  type="button"
                  onClick={onOpenScanner}
                  className="mt-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 cursor-pointer shadow-sm"
                >
                  पहला चेक-इन दर्ज करें (Scan QR)
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">तारीख (Date)</th>
                      <th className="px-4 py-3">चेक-इन समय (Arrival)</th>
                      <th className="px-4 py-3">चेक-आउट समय (Departure)</th>
                      <th className="px-4 py-3">स्थिति (Status)</th>
                      <th className="px-4 py-3">माध्यम (Method)</th>
                      <th className="px-4 py-3">स्थान (Location)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {myAttendanceHistory.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {new Date(rec.date).toLocaleDateString('hi-IN', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-emerald-700">
                          <i className="fa-regular fa-clock mr-1 text-emerald-500"></i>
                          {rec.check_in_time}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600">
                          {rec.check_out_time ? (
                            <>
                              <i className="fa-solid fa-arrow-right-from-bracket mr-1 text-slate-400"></i>
                              {rec.check_out_time}
                            </>
                          ) : (
                            <span className="text-slate-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                              rec.status === 'Present'
                                ? 'bg-emerald-100 text-emerald-800'
                                : rec.status === 'Late'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {rec.status === 'Present'
                              ? 'उपस्थित (Present)'
                              : rec.status === 'Late'
                              ? 'विलंब (Late)'
                              : rec.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 text-[11px] font-medium">
                            <i className="fa-solid fa-qrcode text-indigo-500"></i>
                            {rec.method}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {rec.location || 'School Campus'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: ALL STAFF TODAY ROSTER */}
      {(activeSubTab === 'all_today' || activeSubTab === 'history') && (
        <div className="space-y-6">
          {/* Summary Pills on Selected Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-500 font-medium block">कुल पंजीकृत स्टाफ</span>
                <span className="text-2xl font-black text-slate-900">{totalRegisteredStaff}</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-xl">
                <i className="fa-solid fa-users"></i>
              </div>
            </div>

            <div className="bg-emerald-50/80 p-4 rounded-2xl border border-emerald-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-emerald-700 font-medium block">उपस्थित स्टाफ (Present)</span>
                <span className="text-2xl font-black text-emerald-800">
                  {presentCountOnSelectedDate}
                </span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl">
                <i className="fa-solid fa-user-check"></i>
              </div>
            </div>

            <div className="bg-rose-50/80 p-4 rounded-2xl border border-rose-200 shadow-2xs flex items-center justify-between">
              <div>
                <span className="text-xs text-rose-700 font-medium block">शेष / अनुपस्थित (Pending)</span>
                <span className="text-2xl font-black text-rose-800">
                  {absentCountOnSelectedDate}
                </span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-xl">
                <i className="fa-solid fa-user-xmark"></i>
              </div>
            </div>
          </div>

          {/* Roster Table Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Filter controls */}
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2 flex-1 max-w-sm">
                <div className="relative w-full">
                  <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                  <input
                    type="text"
                    value={searchStaff}
                    onChange={(e) => setSearchStaff(e.target.value)}
                    placeholder="स्टाफ का नाम या मोबाइल खोजें..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={filterDesignation}
                  onChange={(e) => setFilterDesignation(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="all">सभी पद (All Roles)</option>
                  <option value="Teacher">केवल शिक्षक (Teachers)</option>
                  <option value="Manager">प्रबंधन (Manager/Principal)</option>
                  <option value="Staff">अन्य स्टाफ (Other Staff)</option>
                </select>

                {isManager && (
                  <button
                    type="button"
                    onClick={() => {
                      setManualSelectedUser(null);
                      setManualModalOpen(true);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[#0c2340] text-amber-300 font-bold text-xs hover:bg-slate-800 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                  >
                    <i className="fa-solid fa-plus"></i>
                    <span>मैनुअल प्रविष्टि (Add Manual)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Roster Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">स्टाफ का नाम (Name)</th>
                    <th className="px-4 py-3">पद (Designation)</th>
                    <th className="px-4 py-3">मोबाइल (Mobile)</th>
                    <th className="px-4 py-3">हाजिरी स्थिति</th>
                    <th className="px-4 py-3">चेक-इन समय (Arrival)</th>
                    <th className="px-4 py-3">चेक-आउट समय</th>
                    <th className="px-4 py-3">माध्यम</th>
                    {isManager && <th className="px-4 py-3 text-right">कार्य (Action)</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRoster.map(({ user, attendance, isCheckedIn }) => (
                    <tr
                      key={user.User_ID || user.Username || String(user.Mobile_number)}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isCheckedIn ? 'bg-emerald-50/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{user.Name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          ID: {user.User_ID || 'STAFF'}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-semibold">
                          {user.Designation || 'Teacher'}
                        </span>
                      </td>

                      <td className="px-4 py-3 font-mono text-slate-600">
                        {user.Mobile_number}
                      </td>

                      <td className="px-4 py-3">
                        {isCheckedIn ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 inline-flex items-center gap-1">
                            <i className="fa-solid fa-check"></i>
                            <span>उपस्थित (Present)</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-500 inline-flex items-center gap-1">
                            <i className="fa-regular fa-clock"></i>
                            <span>चेक-इन नहीं हुआ</span>
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 font-mono font-bold text-emerald-700">
                        {attendance?.check_in_time ? (
                          <>
                            <i className="fa-regular fa-clock mr-1 text-emerald-500"></i>
                            {attendance.check_in_time}
                          </>
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 font-mono text-slate-600">
                        {attendance?.check_out_time || <span className="text-slate-400 italic">—</span>}
                      </td>

                      <td className="px-4 py-3 text-slate-600">
                        {attendance ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {attendance.method}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>

                      {isManager && (
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setManualSelectedUser(user);
                              setManualModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs border border-amber-300 transition-colors cursor-pointer"
                          >
                            {isCheckedIn ? 'संशोधन' : 'हाजिरी लगाएं'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 3: ALL STAFF MONTHLY REPORT & ANALYTICS */}
      {activeSubTab === 'monthly_report' && (
        <StaffMonthlyReportView
          currentUser={currentUser}
          allStaffUsers={allStaffUsers}
          attendanceRecords={attendanceRecords}
          isManager={isManager}
        />
      )}

      {/* MANUAL CHECK-IN MODAL (FOR MANAGER OR EMERGENCIES) */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="font-bold text-base text-slate-900">
                मैनुअल स्टाफ हाजिरी दर्ज करें (Manual Check-In)
              </h3>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 font-bold mb-1">स्टाफ सदस्य चुनें:</label>
                <select
                  value={manualSelectedUser?.User_ID || ''}
                  onChange={(e) => {
                    const found = allStaffUsers.find((u) => u.User_ID === e.target.value);
                    setManualSelectedUser(found || null);
                  }}
                  className="w-full p-2 rounded-xl border border-slate-300 font-semibold"
                >
                  <option value="">-- स्टाफ चुनें --</option>
                  {allStaffUsers.map((u) => (
                    <option key={u.User_ID} value={u.User_ID}>
                      {u.Name} ({u.Designation || 'Teacher'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-bold mb-1">तारीख:</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-300 font-semibold"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-bold mb-1">चेक-इन समय (Time):</label>
                <input
                  type="text"
                  value={manualTime}
                  onChange={(e) => setManualTime(e.target.value)}
                  placeholder="08:30 AM"
                  className="w-full p-2 rounded-xl border border-slate-300 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-bold mb-1">स्थिति (Status):</label>
                <select
                  value={manualStatus}
                  onChange={(e) => setManualStatus(e.target.value as any)}
                  className="w-full p-2 rounded-xl border border-slate-300 font-semibold"
                >
                  <option value="Present">उपस्थित (Present)</option>
                  <option value="Late">विलंब (Late)</option>
                  <option value="On-Duty">ऑन-ड्यूटी (On-Duty / Tour)</option>
                  <option value="Half-Day">हाफ-डे (Half-Day)</option>
                  <option value="Leave">अवकाश (Leave)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-bold mb-1">टिप्पणी (Note / Remark):</label>
                <input
                  type="text"
                  value={manualRemark}
                  onChange={(e) => setManualRemark(e.target.value)}
                  placeholder="उदाहरण: कैमरा खराब होने के कारण मैनुअल हाजिरी"
                  className="w-full p-2 rounded-xl border border-slate-300"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-semibold text-xs hover:bg-slate-100"
              >
                रद्द करें
              </button>
              <button
                type="button"
                onClick={handleSaveManual}
                disabled={!manualSelectedUser}
                className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                हाजिरी सहेजें (Save)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* School Location Settings Modal */}
      <SchoolLocationModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        isManager={isManager}
      />
    </div>
  );
};
