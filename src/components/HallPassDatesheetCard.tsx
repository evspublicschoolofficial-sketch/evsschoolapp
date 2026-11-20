import React from 'react';
import { HallPassConfig } from '../types';
import {
  getExamDisplayTitle,
  getStudentDatesheetSchedule,
  resolveDatesheetClassKey,
  resolveHallPassLayout,
  StudentHallPassEligibility,
} from '../utils/hallPassHelper';

interface HallPassDatesheetCardProps {
  item: StudentHallPassEligibility;
  config: HallPassConfig;
  classNameLabel: string;
  variant?: 'a4_grid_9' | 'parent_standalone';
  showCutBorder?: boolean;
}

const formatShortDate = (d: string) => {
  const clean = String(d || '').trim();
  const m = clean.match(/^(\d{2}\/\d{2})\/\d{4}$/);
  return m ? m[1] : clean;
};

export const HallPassDatesheetCard: React.FC<HallPassDatesheetCardProps> = ({
  item,
  config,
  classNameLabel,
  variant = 'a4_grid_9',
  showCutBorder = false,
}) => {
  const { student } = item;
  const isStandalone = variant === 'parent_standalone';
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const classKey = resolveDatesheetClassKey(student.Class, classNameLabel);
  const rows = getStudentDatesheetSchedule(config, student.Class, classNameLabel);
  const layoutSpec = resolveHallPassLayout(config.cardLayout);
  const isLandscape = layoutSpec.isLandscape;
  const isPolypackInset = layoutSpec.id === 'landscape_polypack_90x55';

  // HORIZONTAL / LANDSCAPE BACKSIDE DATESHEET (2-column split so 8–10 subjects fit cleanly in 55mm height)
  if (isLandscape) {
    const splitAt = Math.ceil(rows.length / 2);
    const leftRows = rows.slice(0, splitAt);
    const rightRows = rows.slice(splitAt);

    return (
      <div
        className={`hall-pass-slot relative flex items-center justify-center bg-white text-black overflow-hidden select-none ${
          isStandalone ? 'w-full max-w-[440px] mx-auto' : 'h-full w-full'
        }`}
      >
        <div
          className={`flex flex-col justify-between bg-white overflow-hidden ${
            isStandalone
              ? 'w-full rounded-xl border-2 border-[#0c2340] shadow-md'
              : isPolypackInset
              ? `w-[90mm] h-[55mm] ${showCutBorder ? 'border border-dashed border-slate-500 p-[0.6mm]' : ''}`
              : `w-full h-full ${showCutBorder ? 'border border-dashed border-slate-500 p-[0.7mm]' : ''}`
          }`}
        >
          <div
            className={`flex flex-col justify-between h-full w-full bg-white overflow-hidden ${
              isStandalone ? '' : 'border-[1.3pt] border-[#0c2340] rounded-[2px]'
            }`}
          >
            {/* COMPACT HORIZONTAL HEADER */}
            <div
              className={`bg-[#0c2340] text-white border-b-[2px] border-amber-400 flex items-center justify-between gap-1.5 ${
                isStandalone ? 'px-3.5 py-1.5' : 'px-2 py-[3px]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`font-black uppercase tracking-wide shrink-0 ${
                    isStandalone ? 'text-xs' : 'text-[8.5px]'
                  }`}
                >
                  DATESHEET · {classKey}
                </span>
                <span
                  className={`truncate uppercase text-blue-100 font-bold ${
                    isStandalone ? 'text-[11px]' : 'text-[7.5px]'
                  }`}
                >
                  {student.Student_Name}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`tabular-nums text-amber-300 font-bold ${
                    isStandalone ? 'text-[10px]' : 'text-[7px]'
                  }`}
                >
                  {examTitle.replace(' EXAMINATION', '')} ({config.session})
                </span>
                <span
                  className={`font-black tabular-nums bg-amber-400 text-slate-950 rounded-[2px] px-1.5 py-[1px] leading-none ${
                    isStandalone ? 'text-[10px]' : 'text-[7.5px]'
                  }`}
                >
                  ID: {student.Student_ID}
                </span>
              </div>
            </div>

            {/* 2-COLUMN DATESHEET GRID */}
            <div className={`flex-1 flex flex-col justify-between ${isStandalone ? 'p-2.5 gap-2' : 'px-1.5 py-1 gap-0.5'}`}>
              <div className="grid grid-cols-2 gap-1.5 flex-1">
                {[leftRows, rightRows].map((colRows, colIdx) => (
                  <table key={colIdx} className="w-full border-collapse border border-slate-200 self-start">
                    <thead>
                      <tr className="border-b-[1pt] border-[#0c2340] bg-slate-100 text-[#0c2340]">
                        <th
                          className={`text-left font-black uppercase py-[1.5px] px-1 ${
                            isStandalone ? 'text-[10px]' : 'text-[6.8px]'
                          }`}
                        >
                          DATE
                        </th>
                        <th
                          className={`text-left font-black uppercase py-[1.5px] px-1 ${
                            isStandalone ? 'text-[10px]' : 'text-[6.8px]'
                          }`}
                        >
                          SUBJECT
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {colRows.map((r, idx) => (
                        <tr key={`${r.date}-${idx}`} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                          <td
                            className={`py-[1.5px] px-1 font-extrabold text-slate-900 tabular-nums whitespace-nowrap ${
                              isStandalone ? 'text-[11px]' : 'text-[7px]'
                            }`}
                          >
                            {formatShortDate(r.date)}{' '}
                            <span className="font-bold text-slate-600">{r.day}</span>
                          </td>
                          <td
                            className={`py-[1.5px] px-1 font-black text-black truncate max-w-[26mm] ${
                              isStandalone ? 'text-[11px]' : 'text-[7.2px]'
                            }`}
                          >
                            {r.subject}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </div>

              {/* FOOTER NOTES */}
              <div className="border-t-[1pt] border-[#0c2340] pt-[2px] flex flex-wrap items-center justify-between gap-x-2 gap-y-[1px]">
                <span
                  className={`font-bold text-slate-900 leading-tight truncate ${
                    isStandalone ? 'text-[10px]' : 'text-[6.8px]'
                  }`}
                >
                  {config.datesheetArrivalLine || 'Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM'}
                </span>
                {config.datesheetHolidayNote && (
                  <span
                    className={`font-extrabold text-slate-800 leading-tight truncate ${
                      isStandalone ? 'text-[9.5px]' : 'text-[6.2px]'
                    }`}
                  >
                    Off: {config.datesheetHolidayNote}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PORTRAIT / VERTICAL BACKSIDE DATESHEET (Standard 67.5 × 96.5 mm)
  return (
    <div
      className={`hall-pass-slot relative flex flex-col justify-between bg-white text-black overflow-hidden select-none ${
        isStandalone
          ? 'w-full max-w-[380px] mx-auto rounded-xl border-2 border-[#0c2340] shadow-md'
          : `h-full w-full ${showCutBorder ? 'border border-dashed border-slate-500 p-[0.7mm]' : ''}`
      }`}
    >
      <div
        className={`flex flex-col justify-between h-full w-full bg-white overflow-hidden ${
          isStandalone ? '' : 'border-[1.4pt] border-[#0c2340] rounded-[2px]'
        }`}
      >
        {/* TOP HEADER */}
        <div
          className={`bg-[#0c2340] text-white border-b-[2px] border-amber-400 ${
            isStandalone ? 'px-3.5 py-2' : 'px-2 py-1'
          }`}
        >
          <div className="flex items-center justify-between gap-1">
            <span
              className={`font-black uppercase tracking-wide truncate ${
                isStandalone ? 'text-sm' : 'text-[10px]'
              }`}
            >
              DATESHEET · {classKey}
            </span>
            <span
              className={`shrink-0 font-black tabular-nums bg-amber-400 text-slate-950 rounded-[2px] px-1.5 py-[1px] leading-none ${
                isStandalone ? 'text-[10px]' : 'text-[8px]'
              }`}
            >
              ID: {student.Student_ID}
            </span>
          </div>

          <div
            className={`mt-0.5 flex items-center justify-between gap-1 text-blue-100 font-bold leading-none ${
              isStandalone ? 'text-[11px]' : 'text-[8px]'
            }`}
          >
            <span className="truncate uppercase text-white">{student.Student_Name}</span>
            <span className="shrink-0 tabular-nums text-amber-300">
              {examTitle.replace(' EXAMINATION', '')} ({config.session})
            </span>
          </div>
        </div>

        {/* DATESHEET TABLE */}
        <div className={`flex-1 flex flex-col justify-between ${isStandalone ? 'p-3 gap-2' : 'px-1.5 py-1 gap-0.5'}`}>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-[1.2pt] border-[#0c2340] bg-slate-100 text-[#0c2340]">
                <th
                  className={`text-left font-black uppercase py-[2px] px-1 ${
                    isStandalone ? 'text-[11px]' : 'text-[8px]'
                  }`}
                >
                  DATE & DAY
                </th>
                <th
                  className={`text-left font-black uppercase py-[2px] px-1 ${
                    isStandalone ? 'text-[11px]' : 'text-[8px]'
                  }`}
                >
                  SUBJECT
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {rows.map((r, idx) => (
                <tr key={`${r.date}-${idx}`} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                  <td
                    className={`py-[2px] px-1 font-extrabold text-slate-900 tabular-nums whitespace-nowrap ${
                      isStandalone ? 'text-xs py-1' : 'text-[8.5px]'
                    }`}
                  >
                    {formatShortDate(r.date)}{' '}
                    <span className="font-bold text-slate-600">{r.day}</span>
                  </td>
                  <td
                    className={`py-[2px] px-1 font-black text-black truncate ${
                      isStandalone ? 'text-xs py-1' : 'text-[9px]'
                    }`}
                  >
                    {r.subject}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* FOOTER NOTES: HOLIDAYS, TIMING & INSTRUCTIONS */}
          <div className="border-t-[1.2pt] border-[#0c2340] pt-1 space-y-[2px]">
            {config.datesheetHolidayNote && (
              <div
                className={`font-extrabold text-slate-900 bg-slate-100 px-1 py-[1px] rounded-[2px] leading-tight truncate ${
                  isStandalone ? 'text-[10px] py-0.5' : 'text-[7px]'
                }`}
              >
                Off: {config.datesheetHolidayNote}
              </div>
            )}
            <div
              className={`font-bold text-slate-900 leading-tight truncate ${
                isStandalone ? 'text-[11px]' : 'text-[7.5px]'
              }`}
            >
              {config.datesheetArrivalLine || 'Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM'}
            </div>
            <div
              className={`text-slate-700 font-semibold leading-tight truncate ${
                isStandalone ? 'text-[10px]' : 'text-[6.8px]'
              }`}
            >
              Winter uniform &amp; own stationery compulsory. No re-exam.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
