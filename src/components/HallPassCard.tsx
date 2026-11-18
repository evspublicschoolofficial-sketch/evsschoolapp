import React, { useState, useEffect } from 'react';
import { HallPassConfig, Student } from '../types';
import { getExamDisplayTitle, StudentHallPassEligibility } from '../utils/hallPassHelper';

interface HallPassCardProps {
  item: StudentHallPassEligibility;
  config: HallPassConfig;
  classNameLabel: string;
  photoUrl?: string;
  qrDataUrl?: string;
  variant?: 'a4_grid_9' | 'parent_standalone';
  showCutBorder?: boolean;
}

const getInitials = (name?: string): string => {
  const parts = String(name || 'EVS').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'S';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const HallPassCard: React.FC<HallPassCardProps> = ({
  item,
  config,
  classNameLabel,
  photoUrl,
  qrDataUrl,
  variant = 'a4_grid_9',
  showCutBorder = true,
}) => {
  const { student } = item;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    setImgErr(false);
  }, [photoUrl, student.Student_ID]);

  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const isStandalone = variant === 'parent_standalone';

  const statusText =
    item.status === 'WAIVED'
      ? 'FEE WAIVED · CLEARED'
      : item.status === 'OVERRIDE_ALLOWED'
      ? 'PROVISIONAL PASS'
      : item.status === 'CLEARED'
      ? 'FEE CLEARED · ELIGIBLE'
      : `FEE DUE ₹${item.dueAmount.toLocaleString('en-IN')}`;

  return (
    <div
      className={`hall-pass-slot relative flex flex-col justify-between bg-white text-slate-900 overflow-hidden select-none ${
        isStandalone
          ? 'w-full max-w-[360px] mx-auto rounded-xl border-2 border-[#0c2340] shadow-md'
          : `h-full w-full rounded-[3px] ${
              showCutBorder ? 'border border-dashed border-slate-400 p-[1.5mm]' : 'p-[0.5mm]'
            }`
      }`}
    >
      <div
        className={`flex flex-col justify-between h-full w-full bg-white overflow-hidden ${
          isStandalone ? '' : 'border-[1.2pt] border-[#0c2340] rounded-[2px]'
        }`}
      >
        {/* TOP SCHOOL & EXAM BAND */}
        <div className="bg-[#0c2340] text-white px-2 py-1.5 border-b-[2px] border-amber-400">
          <div className="flex items-center justify-between gap-1">
            <div className="min-w-0">
              <div
                className={`font-black tracking-wide uppercase leading-tight truncate ${
                  isStandalone ? 'text-sm' : 'text-[9.5px]'
                }`}
              >
                E.V.S. PUBLIC SCHOOL
              </div>
              <div
                className={`text-blue-200 font-semibold leading-tight truncate ${
                  isStandalone ? 'text-[10px]' : 'text-[7px]'
                }`}
              >
                Chilkana Sultanpur, Saharanpur (U.P.)
              </div>
            </div>
            <div
              className={`shrink-0 bg-amber-400 text-slate-950 font-black uppercase rounded-[2px] px-1.5 py-0.5 leading-none ${
                isStandalone ? 'text-[10px]' : 'text-[7px]'
              }`}
            >
              HALL PASS
            </div>
          </div>

          <div
            className={`mt-1 pt-0.5 border-t border-white/15 flex items-center justify-between gap-1 font-bold text-amber-300 leading-tight ${
              isStandalone ? 'text-[11px]' : 'text-[7.5px]'
            }`}
          >
            <span className="truncate uppercase">{examTitle}</span>
            <span className="shrink-0 tabular-nums text-white/90">{config.session}</span>
          </div>
        </div>

        {/* STUDENT IDENTITY BODY */}
        <div
          className={`flex-1 flex flex-col justify-between bg-white ${
            isStandalone ? 'p-3.5 gap-3' : 'px-2 py-1.5 gap-1'
          }`}
        >
          <div className={`flex items-start ${isStandalone ? 'gap-3' : 'gap-1.5'}`}>
            {/* Photo Box */}
            <div
              className={`shrink-0 rounded-[2px] border border-slate-300 bg-slate-100 overflow-hidden flex items-center justify-center ${
                isStandalone ? 'w-16 h-20' : 'w-[14mm] h-[17mm]'
              }`}
            >
              {photoUrl && !imgErr ? (
                <img
                  src={photoUrl}
                  alt={student.Student_Name}
                  referrerPolicy="no-referrer"
                  onError={() => setImgErr(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-slate-100 text-[#0c2340] flex items-center justify-center font-black text-xs">
                  {getInitials(student.Student_Name)}
                </div>
              )}
            </div>

            {/* Identity Details */}
            <div className="flex-1 min-w-0 space-y-0.5">
              <div
                className={`font-black text-[#0c2340] leading-tight truncate uppercase ${
                  isStandalone ? 'text-sm' : 'text-[9.5px]'
                }`}
                title={student.Student_Name}
              >
                {student.Student_Name}
              </div>

              <div
                className={`text-slate-600 font-semibold leading-tight truncate ${
                  isStandalone ? 'text-xs' : 'text-[7.5px]'
                }`}
              >
                S/o · D/o {student.Father_Name || '—'}
              </div>

              <div
                className={`grid grid-cols-2 gap-x-1.5 gap-y-0.5 pt-0.5 border-t border-slate-200 ${
                  isStandalone ? 'text-xs mt-1.5 pt-1.5' : 'text-[7.5px]'
                }`}
              >
                <div className="truncate">
                  <span className="text-slate-500">Class: </span>
                  <strong className="text-slate-900">{classNameLabel}</strong>
                </div>
                <div className="truncate tabular-nums">
                  <span className="text-slate-500">Roll: </span>
                  <strong className="text-[#0c2340] font-black">
                    {student.Roll_Number || '—'}
                  </strong>
                </div>
                <div className="truncate tabular-nums col-span-2">
                  <span className="text-slate-500">ID / Adm: </span>
                  <strong className="text-slate-800">{student.Student_ID}</strong>
                  {student.Admission_Number ? (
                    <span className="text-slate-500"> ({student.Admission_Number})</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Schedule + Eligibility Row */}
          <div
            className={`border-t border-b border-slate-200 flex items-center justify-between gap-1 ${
              isStandalone ? 'py-2 text-[11px]' : 'py-[2px] text-[7px]'
            }`}
          >
            <span className="text-slate-700 font-semibold truncate">
              {config.examScheduleLine || 'Timing: 09:00 AM - 12:00 PM'}
            </span>
            <span
              className={`shrink-0 font-black uppercase tabular-nums ${
                item.status === 'FEE_HOLD'
                  ? 'text-rose-700'
                  : item.status === 'OVERRIDE_ALLOWED'
                  ? 'text-amber-700'
                  : 'text-emerald-700'
              }`}
            >
              {statusText}
            </span>
          </div>

          {/* Footer: QR + Instruction + Principal Sign */}
          <div className="flex items-end justify-between gap-1.5 pt-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={`shrink-0 border border-slate-300 bg-white rounded-[2px] p-[1px] flex items-center justify-center ${
                  isStandalone ? 'w-14 h-14' : 'w-[12.5mm] h-[12.5mm]'
                }`}
              >
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR ${student.Student_ID}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[7px] font-mono text-slate-400">QR</span>
                )}
              </div>
              <div
                className={`text-slate-600 leading-tight line-clamp-3 ${
                  isStandalone ? 'text-[10px]' : 'text-[6.5px]'
                }`}
              >
                {config.instructionLine || 'Bring Hall Pass & School ID daily.'}
              </div>
            </div>

            <div className="shrink-0 text-right">
              <div
                className={`border-t border-slate-800 font-bold text-slate-800 whitespace-nowrap ${
                  isStandalone ? 'text-[10px] pt-0.5 px-2' : 'text-[6.5px] pt-[1px] px-1'
                }`}
              >
                Principal Sign.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
