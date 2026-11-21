import React, { useState, useEffect } from 'react';
import { HallPassConfig } from '../types';
import {
  getClassExamFee,
  getExamDisplayTitle,
  resolveHallPassLayout,
  StudentHallPassEligibility,
} from '../utils/hallPassHelper';

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
  const layoutSpec = resolveHallPassLayout(config.cardLayout);
  const isLandscape = layoutSpec.isLandscape;
  const isPolypackInset = layoutSpec.id === 'landscape_polypack_90x55';

  const examFeeAmount =
    typeof item.examFee === 'number' && !isNaN(item.examFee)
      ? item.examFee
      : getClassExamFee(student.Class);
  const isExamPaid = Boolean(item.isExamFeePaid);

  // HORIZONTAL / LANDSCAPE HALL PASS (fits 70×100mm horizontal lanyard polypack)
  if (isLandscape) {
    return (
      <div
        className={`hall-pass-slot relative flex items-center justify-center bg-white text-black overflow-hidden select-none ${
          isStandalone ? 'w-full max-w-[460px] mx-auto' : 'h-full w-full'
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
            {/* HORIZONTAL HEADER STRIP */}
            <div
              className={`bg-[#0c2340] text-white border-b-[2px] border-amber-400 flex items-center justify-between gap-2 shrink-0 ${
                isStandalone ? 'px-3.5 py-2' : 'px-2 py-[3px]'
              }`}
            >
              <div className="min-w-0">
                <div
                  className={`font-black tracking-wide uppercase leading-none truncate ${
                    isStandalone ? 'text-sm' : 'text-[9.5px]'
                  }`}
                >
                  E.V.S. PUBLIC SCHOOL
                </div>
                <div
                  className={`text-blue-100 font-semibold leading-tight truncate ${
                    isStandalone ? 'text-[10px] mt-0.5' : 'text-[6.8px] mt-[1px]'
                  }`}
                >
                  Chilkana Sultanpur, Saharanpur (U.P.)
                </div>
              </div>

              <div className="flex flex-col items-end shrink-0 leading-none gap-[2px]">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`font-bold tabular-nums text-white ${
                      isStandalone ? 'text-[11px]' : 'text-[7.5px]'
                    }`}
                  >
                    {config.session}
                  </span>
                  <span
                    className={`bg-amber-400 text-slate-950 font-black uppercase rounded-[2px] px-1.5 py-[1px] border border-amber-200 ${
                      isStandalone ? 'text-[10px]' : 'text-[7.5px]'
                    }`}
                  >
                    HALL PASS
                  </span>
                </div>
                <span
                  className={`font-extrabold uppercase tracking-wide text-amber-300 truncate max-w-[140px] ${
                    isStandalone ? 'text-[10px]' : 'text-[7px]'
                  }`}
                >
                  {examTitle}
                </span>
              </div>
            </div>

            {/* MIDDLE + FULL-WIDTH EXAM FEE & TEACHER PAID WRITE-IN AREA */}
            <div
              className={`flex-1 flex flex-col justify-between bg-white ${
                isStandalone ? 'p-3 gap-2.5' : 'px-2 py-1 gap-1'
              }`}
            >
              {/* TOP 3-COLUMN ROW: Photo | LARGE Name + Highlighted ID | QR + Sign */}
              <div className="flex-1 flex items-stretch justify-between gap-2 min-h-0">
                {/* Left Col: Student Photo + Class */}
                <div className="flex flex-col items-center justify-between shrink-0 gap-0.5">
                  <div
                    className={`rounded-[3px] border-[1.2pt] border-[#0c2340] bg-slate-100 overflow-hidden flex items-center justify-center ${
                      isStandalone
                        ? 'w-20 h-24'
                        : isPolypackInset
                        ? 'w-[16mm] h-[20.5mm]'
                        : 'w-[18.5mm] h-[24mm]'
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

                  {showClassOnCard && (
                    <div
                      className={`text-center font-black text-[#0c2340] leading-none truncate max-w-[19mm] ${
                        isStandalone ? 'text-[11px]' : 'text-[7.5px]'
                      }`}
                    >
                      {classNameLabel}
                    </div>
                  )}
                </div>

                {/* Center Col: Highlighted LARGE Name, Father, Highlighted SCHOOL ID + Roll, Timing */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div className="border-b border-slate-200 pb-0.5">
                    <div
                      className={`font-black text-[#0c2340] leading-tight uppercase truncate tracking-tight ${
                        isStandalone ? 'text-lg' : isPolypackInset ? 'text-[13.5px]' : 'text-[14.5px]'
                      }`}
                      title={student.Student_Name}
                    >
                      {student.Student_Name}
                    </div>
                    <div
                      className={`text-slate-800 font-bold leading-tight truncate ${
                        isStandalone ? 'text-xs' : 'text-[8.5px]'
                      }`}
                    >
                      S/o · D/o {student.Father_Name || '—'}
                    </div>
                  </div>

                  {/* Highlighted Large SCHOOL ID & Roll No */}
                  <div className="grid grid-cols-12 gap-1.5 items-stretch">
                    <div className="col-span-7 border-[1.5pt] border-[#0c2340] bg-amber-100 rounded-[3px] px-1.5 py-[2px] leading-none flex flex-col justify-center">
                      <div
                        className={`text-[#0c2340] font-black uppercase ${
                          isStandalone ? 'text-[8.5px]' : 'text-[6.2px]'
                        }`}
                      >
                        SCHOOL ID
                      </div>
                      <div
                        className={`font-black text-black tabular-nums truncate mt-[1px] ${
                          isStandalone ? 'text-base' : isPolypackInset ? 'text-[13px]' : 'text-[14px]'
                        }`}
                      >
                        {student.Student_ID}
                      </div>
                    </div>

                    <div className="col-span-5 border-[1pt] border-[#0c2340] bg-slate-50 rounded-[3px] px-1.5 py-[2px] leading-none flex flex-col justify-center">
                      <div
                        className={`text-slate-600 font-bold uppercase ${
                          isStandalone ? 'text-[8.5px]' : 'text-[6.2px]'
                        }`}
                      >
                        ROLL NO.
                      </div>
                      <div
                        className={`font-black text-black tabular-nums truncate mt-[1px] ${
                          isStandalone ? 'text-sm' : 'text-[11px]'
                        }`}
                      >
                        {student.Roll_Number || '—'}
                      </div>
                    </div>
                  </div>

                  {/* Exam Timing Line */}
                  <div
                    className={`text-slate-900 font-bold truncate leading-none ${
                      isStandalone ? 'text-xs' : 'text-[7.5px]'
                    }`}
                  >
                    {config.examScheduleLine || 'Exam: 09:30 AM - 12:00 PM'}
                  </div>
                </div>

                {/* Right Col: QR Code + Principal Sign */}
                <div className="shrink-0 flex flex-col items-center justify-between">
                  <div
                    className={`border-[1.1pt] border-[#0c2340] bg-white rounded-[3px] p-[1.5px] flex items-center justify-center ${
                      isStandalone
                        ? 'w-20 h-20'
                        : isPolypackInset
                        ? 'w-[17mm] h-[17mm]'
                        : 'w-[20mm] h-[20mm]'
                    }`}
                  >
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`QR ${student.Student_ID}`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-[7px] font-mono text-slate-500">QR</span>
                    )}
                  </div>

                  <div className="w-full text-center pt-1">
                    <div
                      className={`border-t-[1pt] border-black font-black text-black whitespace-nowrap ${
                        isStandalone ? 'text-[10px] pt-0.5' : 'text-[7px] pt-[1px]'
                      }`}
                    >
                      Principal Sign.
                    </div>
                  </div>
                </div>
              </div>

              {/* FULL-WIDTH EXAM FEE + TEACHER WRITE-IN PAID/UNPAID BOX */}
              <div
                className={`border-[1.2pt] border-[#0c2340] bg-amber-50 rounded-[3px] flex items-stretch justify-between overflow-hidden shrink-0 ${
                  isStandalone ? 'min-h-[38px]' : isPolypackInset ? 'min-h-[7.2mm]' : 'min-h-[8.5mm]'
                }`}
              >
                <div
                  className={`flex items-center gap-1.5 border-r-[1.2pt] border-[#0c2340] ${
                    isStandalone ? 'px-3 py-1.5' : 'px-2 py-0.5'
                  }`}
                >
                  <span
                    className={`font-black uppercase text-[#0c2340] whitespace-nowrap ${
                      isStandalone ? 'text-xs' : 'text-[8px]'
                    }`}
                  >
                    EXAM FEE:
                  </span>
                  <span
                    className={`font-black text-black tabular-nums whitespace-nowrap ${
                      isStandalone ? 'text-base' : 'text-[11.5px]'
                    }`}
                  >
                    ₹{examFeeAmount.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* Paid / Teacher Tick Box */}
                {isExamPaid ? (
                  <div
                    className={`flex-1 bg-emerald-50 flex items-center justify-between gap-2 ${
                      isStandalone ? 'px-3 py-1' : 'px-2 py-0.5'
                    }`}
                  >
                    <span
                      className={`font-extrabold text-slate-700 uppercase whitespace-nowrap ${
                        isStandalone ? 'text-[10px]' : 'text-[6.8px]'
                      }`}
                    >
                      Paid / Status:
                    </span>
                    <div
                      className={`inline-flex items-center gap-1 rounded-[2px] border-[1.2pt] border-emerald-800 bg-emerald-100 text-emerald-950 font-black uppercase tracking-wide ${
                        isStandalone ? 'px-2.5 py-0.5 text-xs' : 'px-1.5 py-[1px] text-[8.5px]'
                      }`}
                    >
                      <span
                        className={`inline-flex items-center justify-center rounded-[1.5px] border-[1.2pt] border-emerald-900 bg-white text-emerald-800 ${
                          isStandalone ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'
                        }`}
                      >
                        <svg viewBox="0 0 12 12" className="w-full h-full p-[1px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 6.5 L4.8 9.2 L10 2.8" />
                        </svg>
                      </span>
                      <span>PAID</span>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex-1 bg-white flex items-center justify-between gap-1.5 ${
                      isStandalone ? 'px-3 py-1' : 'px-2 py-0.5'
                    }`}
                  >
                    <span
                      className={`font-extrabold text-slate-600 uppercase whitespace-nowrap ${
                        isStandalone ? 'text-[10px]' : 'text-[6.6px]'
                      }`}
                    >
                      Paid (Teacher):
                    </span>
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <span
                        className={`inline-block shrink-0 border-[1.2pt] border-[#0c2340] rounded-[1.5px] bg-white ${
                          isStandalone ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'
                        }`}
                      />
                      <span
                        className={`font-bold text-slate-700 whitespace-nowrap ${
                          isStandalone ? 'text-[10px]' : 'text-[7px]'
                        }`}
                      >
                        Paid
                      </span>
                      <span
                        className={`border-b border-dashed border-slate-400 flex-1 ${
                          isStandalone ? 'min-w-[36px] h-3.5' : 'min-w-[8mm] h-2.5'
                        }`}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* COMPACT BOTTOM INSTRUCTION STRIP */}
            <div
              className={`border-t border-slate-300 bg-slate-50 text-slate-800 font-semibold truncate leading-none shrink-0 ${
                isStandalone ? 'px-3.5 py-1.5 text-[11px]' : 'px-2 py-[2.5px] text-[6.8px]'
              }`}
            >
              {config.instructionLine || 'Bring Hall Pass & School ID daily. Report 15 min prior.'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // PORTRAIT / VERTICAL HALL PASS (Standard 67.5 × 96.5 mm on A4 Portrait 3×3)
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
          className={`bg-[#0c2340] text-white border-b-[2.5px] border-amber-400 shrink-0 ${
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

        {/* MAIN IDENTITY & EXAM FEE + TEACHER BOX BODY (Evenly fills card height) */}
        <div
          className={`flex-1 flex flex-col justify-between bg-white ${
            isStandalone ? 'p-4 gap-3.5' : 'px-2.5 py-2 gap-1.5'
          }`}
        >
          {/* Student Photo + Large Highlighted Name / ID / Roll Row */}
          <div className={`flex items-stretch ${isStandalone ? 'gap-3.5' : 'gap-2'}`}>
            <div className="flex flex-col items-center justify-between shrink-0 gap-1">
              <div
                className={`rounded-[3px] border-[1.2pt] border-[#0c2340] bg-slate-100 overflow-hidden flex items-center justify-center ${
                  isStandalone ? 'w-20 h-24' : 'w-[18mm] h-[23mm]'
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

              {showClassOnCard && (
                <div className={`text-slate-900 font-black leading-none text-center truncate max-w-[19mm] ${isStandalone ? 'text-xs' : 'text-[8px]'}`}>
                  {classNameLabel}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div className="border-b border-slate-200 pb-1">
                <div
                  className={`font-black text-[#0c2340] leading-tight uppercase line-clamp-2 ${
                    isStandalone ? 'text-lg' : 'text-[14px]'
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

              {/* Highlighted Big School ID & Roll No */}
              <div className="grid grid-cols-12 gap-1.5 mt-1">
                <div className="col-span-7 border-[1.5pt] border-[#0c2340] bg-amber-100 rounded-[3px] px-1.5 py-1 leading-tight">
                  <div className={`text-[#0c2340] font-black uppercase leading-none ${isStandalone ? 'text-[9px]' : 'text-[7px]'}`}>
                    SCHOOL ID
                  </div>
                  <div className={`font-black text-black tabular-nums tracking-tight truncate ${isStandalone ? 'text-base mt-0.5' : 'text-[13.5px] mt-[1px]'}`}>
                    {student.Student_ID}
                  </div>
                </div>

                <div className="col-span-5 border-[1pt] border-[#0c2340] bg-slate-50 rounded-[3px] px-1.5 py-1 leading-tight">
                  <div className={`text-slate-600 font-bold uppercase leading-none ${isStandalone ? 'text-[9px]' : 'text-[7px]'}`}>
                    ROLL NO.
                  </div>
                  <div className={`font-black text-black tabular-nums truncate ${isStandalone ? 'text-sm mt-0.5' : 'text-[12px] mt-[1px]'}`}>
                    {student.Roll_Number || '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* EXAM FEE + TEACHER WRITE-IN PAID/STATUS BOX */}
          <div className="space-y-1.5">
            <div className="border-[1.3pt] border-[#0c2340] bg-amber-50 text-[#0c2340] rounded-[3px] flex items-stretch justify-between overflow-hidden">
              <div className={`flex flex-col justify-center border-r-[1.2pt] border-[#0c2340] ${isStandalone ? 'px-3 py-1.5' : 'px-2 py-1'}`}>
                <span className={`font-black uppercase tracking-wide leading-none ${isStandalone ? 'text-[10px]' : 'text-[7.5px]'}`}>
                  EXAM FEE
                </span>
                <span
                  className={`font-black uppercase tabular-nums tracking-tight text-black leading-tight mt-0.5 ${
                    isStandalone ? 'text-base' : 'text-[13px]'
                  }`}
                >
                  ₹{examFeeAmount.toLocaleString('en-IN')}
                </span>
              </div>

              {isExamPaid ? (
                <div className={`flex-1 bg-emerald-50 flex flex-col justify-between ${isStandalone ? 'px-3 py-1.5 min-h-[46px]' : 'px-2 py-1 min-h-[9.5mm]'}`}>
                  <span className={`font-extrabold text-slate-700 uppercase leading-none ${isStandalone ? 'text-[9px]' : 'text-[6.8px]'}`}>
                    Paid / Status:
                  </span>
                  <div className="flex items-center mt-1">
                    <div
                      className={`inline-flex items-center gap-1 rounded-[2px] border-[1.2pt] border-emerald-800 bg-emerald-100 text-emerald-950 font-black uppercase tracking-wide ${
                        isStandalone ? 'px-2.5 py-0.5 text-xs' : 'px-1.5 py-[1px] text-[9px]'
                      }`}
                    >
                      <span
                        className={`inline-flex items-center justify-center rounded-[1.5px] border-[1.2pt] border-emerald-900 bg-white text-emerald-800 ${
                          isStandalone ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'
                        }`}
                      >
                        <svg viewBox="0 0 12 12" className="w-full h-full p-[1px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 6.5 L4.8 9.2 L10 2.8" />
                        </svg>
                      </span>
                      <span>PAID</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`flex-1 bg-white flex flex-col justify-between ${isStandalone ? 'px-3 py-1.5 min-h-[46px]' : 'px-2 py-1 min-h-[9.5mm]'}`}>
                  <span className={`font-extrabold text-slate-600 uppercase leading-none ${isStandalone ? 'text-[9px]' : 'text-[6.8px]'}`}>
                    Paid / Status (Teacher):
                  </span>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span
                      className={`inline-block shrink-0 border-[1.2pt] border-[#0c2340] rounded-[1.5px] bg-white ${
                        isStandalone ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'
                      }`}
                    />
                    <span className={`font-bold text-slate-700 leading-none whitespace-nowrap ${isStandalone ? 'text-[10px]' : 'text-[7.5px]'}`}>
                      Paid
                    </span>
                    <span className="border-b border-dashed border-slate-400 flex-1 h-2" />
                  </div>
                </div>
              )}
            </div>

            <div
              className={`text-slate-900 font-bold border-b border-slate-300 pb-1 truncate ${
                isStandalone ? 'text-xs' : 'text-[8.5px]'
              }`}
            >
              {config.examScheduleLine || 'Timing: 09:00 AM - 12:00 PM'}
            </div>
          </div>

          {/* BOTTOM ROW: QR + Instructions + Principal Sign */}
          <div className="flex items-end justify-between gap-2 pt-0.5">
            <div className="flex items-end gap-2 min-w-0">
              <div
                className={`shrink-0 border-[1.2pt] border-[#0c2340] bg-white rounded-[3px] p-[1.5px] flex items-center justify-center ${
                  isStandalone ? 'w-20 h-20' : 'w-[22mm] h-[22mm]'
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
                  className={`text-slate-800 font-semibold leading-snug line-clamp-4 ${
                    isStandalone ? 'text-[11px]' : 'text-[7.8px]'
                  }`}
                >
                  {config.instructionLine || 'Bring Hall Pass & School ID daily. Report 15 min prior.'}
                </div>
              </div>
            </div>

            <div className="shrink-0 text-right pb-0.5">
              <div className="h-6" />
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
