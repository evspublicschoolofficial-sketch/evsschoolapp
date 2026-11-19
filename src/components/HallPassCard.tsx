import React, { useState, useEffect } from 'react';
import { HallPassConfig } from '../types';
import { getClassExamFee, getExamDisplayTitle, StudentHallPassEligibility } from '../utils/hallPassHelper';

interface HallPassCardProps {
  item: StudentHallPassEligibility;
  config: HallPassConfig;
  classNameLabel: string;
  photoUrl?: string;
  qrDataUrl?: string;
  variant?: 'a4_grid_9' | 'parent_standalone';
  showCutBorder?: boolean;
  showClassOnCard?: boolean;
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
  showClassOnCard = false,
}) => {
  const { student } = item;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    setImgErr(false);
  }, [photoUrl, student.Student_ID]);

  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const isStandalone = variant === 'parent_standalone';
  const examFeeAmount =
    typeof item.examFee === 'number' && !isNaN(item.examFee)
      ? item.examFee
      : getClassExamFee(student.Class);

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
        {/* TOP OFFICIAL SCHOOL & EXAM HEADER */}
        <div
          className={`bg-[#0c2340] text-white border-b-[2.5px] border-amber-400 ${
            isStandalone ? 'px-3.5 py-2.5' : 'px-2.5 py-1.5'
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0">
              <div
                className={`font-black tracking-wide uppercase leading-none truncate ${
                  isStandalone ? 'text-base' : 'text-[11.5px]'
                }`}
              >
                E.V.S. PUBLIC SCHOOL
              </div>
              <div
                className={`text-blue-100 font-semibold leading-tight truncate mt-0.5 ${
                  isStandalone ? 'text-[11px]' : 'text-[8px]'
                }`}
              >
                Chilkana Sultanpur, Saharanpur (U.P.)
              </div>
            </div>
            <div
              className={`shrink-0 bg-amber-400 text-slate-950 font-black uppercase rounded-[2px] px-1.5 py-0.5 leading-none border border-amber-200 ${
                isStandalone ? 'text-[11px]' : 'text-[8.5px]'
              }`}
            >
              HALL PASS
            </div>
          </div>

          <div
            className={`mt-1 pt-1 border-t border-white/20 flex items-center justify-between gap-1 font-extrabold text-amber-300 leading-none ${
              isStandalone ? 'text-xs' : 'text-[9px]'
            }`}
          >
            <span className="truncate uppercase tracking-wide">{examTitle}</span>
            <span className="shrink-0 tabular-nums text-white font-bold">{config.session}</span>
          </div>
        </div>

        {/* MAIN IDENTITY & FEE STATUS BODY (Tightly proportioned with high-contrast large print typography) */}
        <div
          className={`flex-1 flex flex-col justify-between bg-white ${
            isStandalone ? 'p-4 gap-3.5' : 'px-2.5 py-2 gap-1.5'
          }`}
        >
          {/* Student Photo + Large Name / ID / Roll Row */}
          <div className={`flex items-stretch ${isStandalone ? 'gap-3.5' : 'gap-2'}`}>
            {/* Student Photo */}
            <div
              className={`shrink-0 rounded-[3px] border-[1.2pt] border-[#0c2340] bg-slate-100 overflow-hidden flex items-center justify-center ${
                isStandalone ? 'w-20 h-24' : 'w-[17mm] h-[21mm]'
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
                <div className="w-full h-full bg-slate-100 text-[#0c2340] flex items-center justify-center font-black text-sm">
                  {getInitials(student.Student_Name)}
                </div>
              )}
            </div>

            {/* Student Name, Father, Prominent School ID & Roll No */}
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <div
                  className={`font-black text-black leading-tight uppercase line-clamp-2 ${
                    isStandalone ? 'text-base' : 'text-[13px]'
                  }`}
                  title={student.Student_Name}
                >
                  {student.Student_Name}
                </div>
                <div
                  className={`text-slate-800 font-bold leading-tight truncate mt-0.5 ${
                    isStandalone ? 'text-xs' : 'text-[9.5px]'
                  }`}
                >
                  S/o · D/o {student.Father_Name || '—'}
                </div>
              </div>

              {/* Prominent ID & Roll Boxes (Unmistakable at a glance) */}
              <div className={`grid grid-cols-2 gap-1.5 mt-1 ${isStandalone ? 'mt-2' : ''}`}>
                <div className="border-[1.1pt] border-[#0c2340] bg-slate-50 rounded-[3px] px-1.5 py-0.5 leading-tight">
                  <div className={`text-slate-600 font-bold uppercase leading-none ${isStandalone ? 'text-[9px]' : 'text-[7px]'}`}>
                    SCHOOL ID
                  </div>
                  <div className={`font-black text-[#0c2340] tabular-nums tracking-tight truncate ${isStandalone ? 'text-sm mt-0.5' : 'text-[12px] mt-[1px]'}`}>
                    {student.Student_ID}
                  </div>
                </div>

                <div className="border-[1.1pt] border-[#0c2340] bg-slate-50 rounded-[3px] px-1.5 py-0.5 leading-tight">
                  <div className={`text-slate-600 font-bold uppercase leading-none ${isStandalone ? 'text-[9px]' : 'text-[7px]'}`}>
                    ROLL NO.
                  </div>
                  <div className={`font-black text-black tabular-nums truncate ${isStandalone ? 'text-sm mt-0.5' : 'text-[12px] mt-[1px]'}`}>
                    {student.Roll_Number || '—'}
                  </div>
                </div>
              </div>

              {showClassOnCard && (
                <div className={`text-slate-800 font-bold leading-none mt-1 truncate ${isStandalone ? 'text-xs' : 'text-[8.5px]'}`}>
                  Class: <span className="font-black text-black">{classNameLabel}</span>
                </div>
              )}
            </div>
          </div>

          {/* Highlighted Class Exam Fee & Timing Strip */}
          <div className="space-y-1">
            <div className="border-[1.2pt] border-[#0c2340] bg-amber-50 text-[#0c2340] rounded-[3px] px-2 py-1 flex items-center justify-between gap-1">
              <span className={`font-black uppercase tracking-wide ${isStandalone ? 'text-[11px]' : 'text-[8.5px]'}`}>
                EXAM FEE
              </span>
              <span
                className={`font-black uppercase tabular-nums tracking-tight text-black ${
                  isStandalone ? 'text-base' : 'text-[13px]'
                }`}
              >
                ₹{examFeeAmount.toLocaleString('en-IN')}
              </span>
            </div>

            <div
              className={`text-slate-900 font-bold border-b border-slate-300 pb-1 truncate ${
                isStandalone ? 'text-xs' : 'text-[8.5px]'
              }`}
            >
              {config.examScheduleLine || 'Timing: 09:00 AM - 12:00 PM'}
            </div>
          </div>

          {/* Bottom Row: Large QR Code + Instructions + Principal Sign */}
          <div className="flex items-end justify-between gap-2 pt-0.5">
            <div className="flex items-end gap-2 min-w-0">
              <div
                className={`shrink-0 border-[1.2pt] border-[#0c2340] bg-white rounded-[3px] p-[1.5px] flex items-center justify-center ${
                  isStandalone ? 'w-20 h-20' : 'w-[21mm] h-[21mm]'
                }`}
              >
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`QR ${student.Student_ID}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[8px] font-mono text-slate-500">QR</span>
                )}
              </div>

              <div className="min-w-0 pb-0.5">
                <div
                  className={`text-slate-800 font-semibold leading-snug line-clamp-3 ${
                    isStandalone ? 'text-[11px]' : 'text-[7.5px]'
                  }`}
                >
                  {config.instructionLine || 'Bring Hall Pass & School ID daily. Report 15 min prior.'}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right pb-0.5">
              <div className="h-5" />
              <div
                className={`border-t-[1.2pt] border-black font-black text-black whitespace-nowrap ${
                  isStandalone ? 'text-[11px] pt-0.5 px-2' : 'text-[8px] pt-[2px] px-1'
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
