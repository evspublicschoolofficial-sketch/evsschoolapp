import React, { useMemo, useState } from 'react';
import { AcademicsConfigSnapshot, SchoolUser, WeekdayKey } from '../types';
import {
  WEEKDAYS,
  WEEKDAY_LABELS_HI,
  computeTeacherWorkloadMap,
  findFreeAndBusyTeachersAtSlot,
  formatTime12Hr,
  getCurrentTimeMinutesIST,
  getPeriodSetForClass,
  getTeachersOnly,
  getTodayDateString,
  getTodayWeekdayKey,
  parseHHMMToMinutes,
} from '../utils/academicsHelper';

interface TeacherTimetableViewProps {
  config: AcademicsConfigSnapshot;
  teacherUser: SchoolUser;
  allUsers: SchoolUser[];
  getClassName: (cls: string) => string;
  currentLang: 'en' | 'hi';
}

export const TeacherTimetableView: React.FC<TeacherTimetableViewProps> = ({
  config,
  teacherUser,
  allUsers,
  getClassName,
  currentLang,
}) => {
  const [viewMode, setViewMode] = useState<'my_schedule' | 'class_timetable' | 'free_teachers'>(
    'my_schedule'
  );
  const todayDay = getTodayWeekdayKey();
  const todayDate = getTodayDateString();
  const nowMinutes = getCurrentTimeMinutesIST();
  const teachers = useMemo(() => getTeachersOnly(allUsers), [allUsers]);

  const defaultPeriodSet = config.periodSets[0];
  const [finderDay, setFinderDay] = useState<WeekdayKey>(todayDay);
  const [finderPeriodId, setFinderPeriodId] = useState<string>(
    defaultPeriodSet?.slots.find((s) => !s.isBreak)?.id || 'p1'
  );

  const myTeacherId = String(teacherUser.User_ID || '').trim().toLowerCase();
  const myTeacherName = String(teacherUser.Name || '').trim().toLowerCase();

  const myEntries = useMemo(() => {
    return config.timetable.filter((e) => {
      if (e.sessionId !== config.activeSessionId) return false;
      const eId = String(e.teacherId || '').trim().toLowerCase();
      const eName = String(e.teacherName || '').trim().toLowerCase();
      return (myTeacherId && eId === myTeacherId) || (myTeacherName && eName === myTeacherName);
    });
  }, [config.timetable, config.activeSessionId, myTeacherId, myTeacherName]);

  const myTodaySubstitutions = useMemo(() => {
    return config.substitutions.filter((s) => {
      if (s.sessionId !== config.activeSessionId || s.date !== todayDate) return false;
      const sId = String(s.substituteTeacherId || '').trim().toLowerCase();
      return sId === myTeacherId;
    });
  }, [config.substitutions, config.activeSessionId, todayDate, myTeacherId]);

  const myWorkload = useMemo(() => {
    const list = computeTeacherWorkloadMap(config.timetable, config.activeSessionId, [teacherUser]);
    return list[0] || { periodsPerWeek: myEntries.length, classes: [], subjects: [] };
  }, [config.timetable, config.activeSessionId, teacherUser, myEntries.length]);

  const myAssignedClassRaw = String(teacherUser.Assigned_Class || '').split(/[,;|]/)[0]?.trim() || 'C5';
  const [selectedClassKey, setSelectedClassKey] = useState<string>(myAssignedClassRaw);
  const [selectedSection, setSelectedSection] = useState<string>('A');

  const classPeriodSet = useMemo(
    () => getPeriodSetForClass(config, selectedClassKey),
    [config, selectedClassKey]
  );

  const freeBusyResult = useMemo(
    () =>
      findFreeAndBusyTeachersAtSlot(
        config.timetable,
        config.substitutions,
        config.activeSessionId,
        finderDay,
        finderPeriodId,
        todayDate,
        teachers
      ),
    [config.timetable, config.substitutions, config.activeSessionId, finderDay, finderPeriodId, todayDate, teachers]
  );

  const allSlots = defaultPeriodSet?.slots || [];

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header Summary Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              {currentLang === 'en' ? 'My Timetable & Teaching Load' : 'मेरा टाइमटेबल व साप्ताहिक कार्यभार'}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-black">
              Session {config.activeSessionId}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            कुल साप्ताहिक पीरियड: <strong>{myWorkload.periodsPerWeek} Periods/Week</strong> · आज बदली ड्यूटी:{' '}
            <strong>{myTodaySubstitutions.length}</strong>
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'my_schedule', label: currentLang === 'en' ? 'My Timetable' : 'मेरा टाइमटेबल' },
            { id: 'class_timetable', label: currentLang === 'en' ? 'Class Timetable' : 'कक्षा टाइमटेबल' },
            { id: 'free_teachers', label: currentLang === 'en' ? 'Free Teachers' : 'खाली शिक्षक' },
          ].map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setViewMode(btn.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                viewMode === btn.id
                  ? 'bg-[#0c2340] text-amber-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode 1: My Schedule (Today + Full Week Grid) */}
      {viewMode === 'my_schedule' && (
        <div className="space-y-4">
          {myTodaySubstitutions.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2">
              <div className="text-xs sm:text-sm font-black text-amber-950">
                <i className="fa-solid fa-repeat mr-1.5"></i>
                आज आपकी बदली (Substitution) ड्यूटी:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {myTodaySubstitutions.map((sub) => (
                  <div key={sub.id} className="p-2.5 rounded-xl bg-white border border-amber-200 text-xs">
                    <div className="font-bold text-slate-900">
                      {sub.periodLabel} · {getClassName(sub.classKey)}-{sub.sectionName}
                    </div>
                    <div className="text-slate-600">
                      विषय: {sub.subjectName} (मूल शिक्षक: {sub.originalTeacherName})
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Today's Timeline */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900">
                आज की कक्षाएं ({WEEKDAY_LABELS_HI[todayDay]} · {todayDate})
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {allSlots.map((slot) => {
                if (slot.isBreak) {
                  return (
                    <div
                      key={slot.id}
                      className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col justify-center"
                    >
                      <div className="font-black">{slot.label}</div>
                      <div className="text-[11px]">
                        {formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)}
                      </div>
                    </div>
                  );
                }
                const entry = myEntries.find((e) => e.day === todayDay && e.periodId === slot.id);
                const subEntry = myTodaySubstitutions.find((s) => s.periodId === slot.id);
                const startM = parseHHMMToMinutes(slot.startTime);
                const endM = parseHHMMToMinutes(slot.endTime);
                const isLiveNow = nowMinutes >= startM && nowMinutes <= endM;
                return (
                  <div
                    key={slot.id}
                    className={`p-3 rounded-xl border text-xs transition-all ${
                      isLiveNow
                        ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400/30'
                        : entry || subEntry
                        ? 'bg-indigo-50/70 border-indigo-200'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 font-bold text-slate-900">
                      <span>{slot.label}</span>
                      {isLiveNow && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px]">
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 mb-1.5">
                      {formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)}
                    </div>
                    {subEntry ? (
                      <div className="font-bold text-amber-900">
                        [Substitution] {getClassName(subEntry.classKey)}-{subEntry.sectionName} · {subEntry.subjectName}
                      </div>
                    ) : entry ? (
                      <div>
                        <div className="font-black text-indigo-900">
                          {getClassName(entry.classKey)} - Sec {entry.sectionName}
                        </div>
                        <div className="text-slate-700 font-semibold">{entry.subjectName}</div>
                      </div>
                    ) : (
                      <div className="text-[11px] font-semibold text-emerald-700">Free Period (खाली)</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Full Weekly Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-black text-slate-900">पूरा साप्ताहिक टाइमटेबल (Mon–Sat)</h3>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[#0c2340] text-white">
                    <th className="p-2.5 text-left border-r border-white/15">Period</th>
                    {WEEKDAYS.map((day) => (
                      <th key={day} className="p-2.5 text-center border-r border-white/15 last:border-r-0">
                        {WEEKDAY_LABELS_HI[day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allSlots.map((slot) => {
                    if (slot.isBreak) {
                      return (
                        <tr key={slot.id} className="bg-amber-50 border-y border-amber-200">
                          <td className="p-2 font-bold text-amber-900">{slot.label}</td>
                          <td colSpan={6} className="p-2 text-center font-bold text-amber-900">
                            Lunch / Break ({formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)})
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={slot.id} className="border-b border-slate-200">
                        <td className="p-2 bg-slate-50 border-r border-slate-200 font-bold">
                          <div>{slot.label}</div>
                          <div className="text-[10px] text-slate-500">
                            {formatTime12Hr(slot.startTime)}
                          </div>
                        </td>
                        {WEEKDAYS.map((day) => {
                          const cell = myEntries.find((e) => e.day === day && e.periodId === slot.id);
                          return (
                            <td key={day} className="p-2 border-r border-slate-200 last:border-r-0 text-center">
                              {cell ? (
                                <div className="p-1.5 rounded-lg bg-indigo-50 border border-indigo-200">
                                  <div className="font-black text-indigo-950">
                                    {getClassName(cell.classKey)}-{cell.sectionName}
                                  </div>
                                  <div className="text-[11px] text-slate-700">{cell.subjectName}</div>
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Mode 2: Class Timetable Viewer */}
      {viewMode === 'class_timetable' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedClassKey}
              onChange={(e) => setSelectedClassKey(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
            >
              {Array.from(new Set(config.sections.map((s) => s.classKey))).map((ck) => (
                <option key={ck} value={ck}>
                  {getClassName(ck)}
                </option>
              ))}
            </select>
            <select
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
            >
              {config.sections
                .filter((s) => s.classKey.toLowerCase() === selectedClassKey.toLowerCase())
                .map((s) => (
                  <option key={s.id} value={s.sectionName}>
                    Section {s.sectionName}
                  </option>
                ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="bg-[#0c2340] text-white">
                  <th className="p-2.5 text-left">Period</th>
                  {WEEKDAYS.map((day) => (
                    <th key={day} className="p-2.5 text-center">
                      {WEEKDAY_LABELS_HI[day]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classPeriodSet.slots.map((slot) =>
                  slot.isBreak ? (
                    <tr key={slot.id} className="bg-amber-50 border-y border-amber-200">
                      <td className="p-2 font-bold text-amber-900">{slot.label}</td>
                      <td colSpan={6} className="p-2 text-center font-bold text-amber-900">
                        Lunch / Break
                      </td>
                    </tr>
                  ) : (
                    <tr key={slot.id} className="border-b border-slate-200">
                      <td className="p-2 bg-slate-50 font-bold border-r border-slate-200">
                        {slot.label}
                      </td>
                      {WEEKDAYS.map((day) => {
                        const cell = config.timetable.find(
                          (e) =>
                            e.sessionId === config.activeSessionId &&
                            e.classKey.toLowerCase() === selectedClassKey.toLowerCase() &&
                            e.sectionName.toLowerCase() === selectedSection.toLowerCase() &&
                            e.day === day &&
                            e.periodId === slot.id
                        );
                        return (
                          <td key={day} className="p-2 border-r border-slate-200 text-center">
                            {cell ? (
                              <div className="p-1.5 rounded-lg bg-slate-50 border border-slate-200">
                                <div className="font-bold text-slate-900">{cell.subjectName}</div>
                                <div className="text-[10px] text-indigo-700">{cell.teacherName}</div>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mode 3: Free Teacher Finder */}
      {viewMode === 'free_teachers' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={finderDay}
              onChange={(e) => setFinderDay(e.target.value as WeekdayKey)}
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {WEEKDAY_LABELS_HI[d]}
                </option>
              ))}
            </select>
            <select
              value={finderPeriodId}
              onChange={(e) => setFinderPeriodId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold"
            >
              {allSlots
                .filter((s) => !s.isBreak)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({formatTime12Hr(s.startTime)})
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1.5">
              <div className="text-xs font-black text-emerald-900">
                Free Teachers ({freeBusyResult.freeTeachers.length})
              </div>
              {freeBusyResult.freeTeachers.map((t) => (
                <div key={t.User_ID} className="p-2 rounded-lg bg-white border border-emerald-200 text-xs font-bold">
                  {t.Name}
                </div>
              ))}
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="text-xs font-black text-slate-800">
                In Class ({freeBusyResult.busyTeachers.length})
              </div>
              {freeBusyResult.busyTeachers.map(({ teacher, assignmentLabel }) => (
                <div key={teacher.User_ID} className="p-2 rounded-lg bg-white border border-slate-200 text-xs">
                  <div className="font-bold">{teacher.Name}</div>
                  <div className="text-[11px] text-indigo-700">{assignmentLabel}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherTimetableView;
