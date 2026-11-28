import React, { useMemo } from 'react';
import { AcademicsConfigSnapshot, SchoolUser, Student } from '../types';
import {
  WEEKDAYS,
  WEEKDAY_LABELS_HI,
  formatTime12Hr,
  getPeriodSetForClass,
  getTodayDateString,
  getTodayWeekdayKey,
  resolveStudentClassAndSection,
} from '../utils/academicsHelper';

interface ParentTimetableViewProps {
  config: AcademicsConfigSnapshot;
  student: Student;
  users: SchoolUser[];
  getClassName: (cls: string) => string;
  currentLang: 'en' | 'hi';
}

export const ParentTimetableView: React.FC<ParentTimetableViewProps> = ({
  config,
  student,
  users,
  getClassName,
  currentLang,
}) => {
  const { classKey, sectionName } = resolveStudentClassAndSection(student, config.studentOverrides);
  const todayDay = getTodayWeekdayKey();
  const todayDate = getTodayDateString();
  const periodSet = useMemo(() => getPeriodSetForClass(config, classKey), [config, classKey]);

  const sectionCfg = useMemo(() => {
    return config.sections.find(
      (s) =>
        s.classKey.toLowerCase() === classKey.toLowerCase() &&
        s.sectionName.toLowerCase() === sectionName.toLowerCase()
    );
  }, [config.sections, classKey, sectionName]);

  const classTimetable = useMemo(() => {
    return config.timetable.filter(
      (e) =>
        e.sessionId === config.activeSessionId &&
        (e.classKey.toLowerCase() === classKey.toLowerCase() ||
          getClassName(e.classKey).toLowerCase() === getClassName(classKey).toLowerCase()) &&
        e.sectionName.toLowerCase() === sectionName.toLowerCase()
    );
  }, [config.timetable, config.activeSessionId, classKey, sectionName, getClassName]);

  const todaySubs = useMemo(() => {
    return config.substitutions.filter(
      (s) =>
        s.sessionId === config.activeSessionId &&
        s.date === todayDate &&
        (s.classKey.toLowerCase() === classKey.toLowerCase() ||
          getClassName(s.classKey).toLowerCase() === getClassName(classKey).toLowerCase()) &&
        s.sectionName.toLowerCase() === sectionName.toLowerCase()
    );
  }, [config.substitutions, config.activeSessionId, todayDate, classKey, sectionName, getClassName]);

  const subjectTeachersList = useMemo(() => {
    if (!sectionCfg) return [];
    const subjIds = sectionCfg.subjectIds || [];
    return subjIds
      .map((sid) => {
        const subj = config.subjects.find((s) => s.id === sid);
        const tid = sectionCfg.subjectTeachers?.[sid] || '';
        const teacher = users.find((u) => u.User_ID === tid);
        return subj ? { subject: subj.name, teacherName: teacher?.Name || '—' } : null;
      })
      .filter(Boolean) as Array<{ subject: string; teacherName: string }>;
  }, [sectionCfg, config.subjects, users]);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Header */}
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-base sm:text-lg font-black text-slate-900">
            {currentLang === 'en'
              ? `Class Timetable: ${getClassName(classKey)} - Section ${sectionName}`
              : `कक्षा टाइमटेबल: ${getClassName(classKey)} - सेक्शन ${sectionName}`}
          </h3>
          <p className="text-xs text-slate-600 mt-0.5">
            सत्र: <strong>{config.activeSessionId}</strong>
            {sectionCfg?.classTeacherName ? (
              <> · क्लास टीचर: <strong>{sectionCfg.classTeacherName}</strong></>
            ) : null}
            {sectionCfg?.roomNumber ? <> · {sectionCfg.roomNumber}</> : null}
          </p>
        </div>
        <span className="px-3 py-1 rounded-full bg-[#0c2340] text-amber-300 text-xs font-black w-fit">
          आज: {WEEKDAY_LABELS_HI[todayDay]}
        </span>
      </div>

      {/* Today's Classes Cards */}
      <div className="space-y-2">
        <div className="text-xs font-black text-slate-800">
          आज के पीरियड ({WEEKDAY_LABELS_HI[todayDay]}):
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {periodSet.slots.map((slot) => {
            if (slot.isBreak) {
              return (
                <div key={slot.id} className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <div className="font-black">{slot.label}</div>
                  <div className="text-[11px]">
                    {formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)}
                  </div>
                </div>
              );
            }
            const entry = classTimetable.find((e) => e.day === todayDay && e.periodId === slot.id);
            const sub = todaySubs.find((s) => s.periodId === slot.id);
            return (
              <div key={slot.id} className="p-3 rounded-xl bg-white border border-slate-200 text-xs">
                <div className="flex items-center justify-between font-bold text-slate-500 text-[11px]">
                  <span>{slot.label}</span>
                  <span>{formatTime12Hr(slot.startTime)}</span>
                </div>
                {sub ? (
                  <div className="mt-1">
                    <div className="font-black text-amber-900">{sub.subjectName}</div>
                    <div className="text-[11px] text-indigo-700">बदली: {sub.substituteTeacherName}</div>
                  </div>
                ) : entry ? (
                  <div className="mt-1">
                    <div className="font-black text-slate-900">{entry.subjectName}</div>
                    <div className="text-[11px] text-indigo-700">{entry.teacherName}</div>
                  </div>
                ) : (
                  <div className="mt-1 text-slate-400">अभी सेट नहीं है</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Full Week Timetable Matrix */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[700px] border-collapse text-xs">
          <thead>
            <tr className="bg-[#0c2340] text-white">
              <th className="p-2.5 text-left border-r border-white/15">पीरियड / समय</th>
              {WEEKDAYS.map((day) => (
                <th key={day} className="p-2.5 text-center border-r border-white/15 last:border-r-0">
                  {WEEKDAY_LABELS_HI[day]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periodSet.slots.map((slot) =>
              slot.isBreak ? (
                <tr key={slot.id} className="bg-amber-50 border-y border-amber-200">
                  <td className="p-2 font-bold text-amber-900">{slot.label}</td>
                  <td colSpan={6} className="p-2 text-center font-bold text-amber-900">
                    Lunch / Recess ({formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)})
                  </td>
                </tr>
              ) : (
                <tr key={slot.id} className="border-b border-slate-200">
                  <td className="p-2 bg-slate-50 border-r border-slate-200 font-bold">
                    <div>{slot.label}</div>
                    <div className="text-[10px] text-slate-500">
                      {formatTime12Hr(slot.startTime)} – {formatTime12Hr(slot.endTime)}
                    </div>
                  </td>
                  {WEEKDAYS.map((day) => {
                    const entry = classTimetable.find((e) => e.day === day && e.periodId === slot.id);
                    return (
                      <td key={day} className="p-2 border-r border-slate-200 last:border-r-0 text-center">
                        {entry ? (
                          <div className="p-1.5 rounded-lg bg-indigo-50/70 border border-indigo-200">
                            <div className="font-bold text-slate-900">{entry.subjectName}</div>
                            <div className="text-[10px] text-indigo-800">{entry.teacherName}</div>
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

      {/* Subject Teachers Card */}
      {subjectTeachersList.length > 0 && (
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
          <div className="text-xs font-black text-slate-900">विषय एवं अध्यापक सूची (Subject Teachers):</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {subjectTeachersList.map((item, idx) => (
              <div key={idx} className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">{item.subject}</span>
                <span className="text-indigo-800 font-semibold">{item.teacherName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ParentTimetableView;
