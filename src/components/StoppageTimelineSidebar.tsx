import React from 'react';
import { RouteStoppage, RouteConfig } from '../types/routeTracking';

interface StoppageTimelineSidebarProps {
  routeConfig: RouteConfig;
  stoppages: RouteStoppage[];
  passedCount: number;
  totalStudents: number;
  isPinDropActive: boolean;
  onTogglePinDrop: () => void;
  onResetToDefault: () => void;
  onClearAllStoppages?: () => void;
  onAddStopAtCurrentGps?: () => void;
  onSelectStoppage: (stoppage: RouteStoppage) => void;
  onDeleteStoppage: (stoppageId: string) => void;
  activeStoppageId?: string;
  selectedBusName?: string;
}

export const StoppageTimelineSidebar: React.FC<StoppageTimelineSidebarProps> = ({
  routeConfig,
  stoppages,
  passedCount,
  totalStudents,
  isPinDropActive,
  onTogglePinDrop,
  onResetToDefault,
  onClearAllStoppages,
  onAddStopAtCurrentGps,
  onSelectStoppage,
  onDeleteStoppage,
  activeStoppageId,
  selectedBusName = 'वैन (Amjad)',
}) => {
  const totalStops = stoppages.length;

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
      {/* SIDEBAR HEADER & SUMMARY COUNTERS */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-[#0c2340] to-[#163660] text-white">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 bg-amber-400/20 px-2 py-0.5 rounded-full border border-amber-400/30">
              रूट टाइमलाइन व स्टॉपेज
            </span>
            <h3 className="text-base font-black text-white mt-1">
              {routeConfig.routeName}
            </h3>
          </div>
          <span className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-amber-400 text-sm">
            <i className="fa-solid fa-timeline"></i>
          </span>
        </div>

        {/* 2 COUNTERS: STOPS PASSED & TOTAL STUDENTS */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
          <div className="bg-white/10 rounded-2xl p-2.5 text-center backdrop-blur-xs">
            <span className="text-[10px] text-slate-300 font-bold block uppercase">
              स्टॉप स्थिति (Progress)
            </span>
            <span className="text-base font-black text-amber-300 mt-0.5 block">
              {passedCount} / {totalStops} पार (Passed)
            </span>
          </div>

          <div className="bg-white/10 rounded-2xl p-2.5 text-center backdrop-blur-xs">
            <span className="text-[10px] text-slate-300 font-bold block uppercase">
              कुल छात्र (Students)
            </span>
            <span className="text-base font-black text-emerald-300 mt-0.5 block">
              {totalStudents} छात्र सवार/प्रतीक्षारत
            </span>
          </div>
        </div>

        {/* PRIMARY ACTION BUTTONS */}
        <div className="space-y-2 mt-3 pt-3 border-t border-white/10">
          {onAddStopAtCurrentGps && (
            <button
              type="button"
              onClick={onAddStopAtCurrentGps}
              className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition active:scale-95"
            >
              <i className="fa-solid fa-location-crosshairs text-amber-300"></i>
              <span>📍 वाहन की लोकेशन पर स्टॉप बनाएं</span>
            </button>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePinDrop}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-black flex items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                isPinDropActive
                  ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse'
                  : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
              }`}
            >
              <i className={`fa-solid ${isPinDropActive ? 'fa-xmark' : 'fa-map-pin'}`}></i>
              <span>{isPinDropActive ? 'पिन रद्द करें' : '📌 मैप पर पिन गिराएं'}</span>
            </button>

            {onClearAllStoppages && (
              <button
                type="button"
                onClick={onClearAllStoppages}
                className="py-2 px-2.5 rounded-xl bg-white/10 hover:bg-rose-500/80 text-slate-300 hover:text-white text-xs font-bold transition cursor-pointer"
                title="सभी स्टॉपेज हटाएं (Clear All Stoppages)"
              >
                <i className="fa-solid fa-trash-can"></i>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* TIMELINE LIST */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 max-h-[580px]">
        {/* 1. SCHOOL CAMPUS ORIGIN CARD */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-9 h-9 rounded-2xl bg-[#0c2340] text-amber-300 flex items-center justify-center text-sm font-black shadow-md border-2 border-amber-400">
              <i className="fa-solid fa-school"></i>
            </div>
            <div className="w-0.5 h-10 bg-slate-200 mt-1"></div>
          </div>

          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl p-3 shadow-2xs">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase text-blue-900 bg-blue-100 px-2 py-0.5 rounded-full">
                प्रस्थान स्थल (Origin)
              </span>
              <span className="text-[11px] font-bold text-slate-500">07:00 AM</span>
            </div>
            <h4 className="text-xs font-black text-slate-900 mt-1">
              {routeConfig.schoolOrigin.name}
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
              {routeConfig.schoolOrigin.address || 'चिलकाना, सहारनपुर'}
            </p>
          </div>
        </div>

        {/* 2. ORDERED STOPPAGES LIST OR EMPTY STATE */}
        {stoppages.length === 0 ? (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center space-y-2 my-2 animate-fadeIn">
            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center text-base mx-auto">
              <i className="fa-solid fa-route"></i>
            </div>
            <h5 className="font-extrabold text-xs text-slate-800">
              कोई पुराना स्टॉपेज नहीं है (Clean Route)
            </h5>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
              कल ऑटो जहाँ-जहाँ रुकेगा, आप ऊपर <strong>'वाहन की लोकेशन पर स्टॉप बनाएं'</strong> दबाकर वास्तविक स्टॉपेज सहेज सकेंगे।
            </p>
          </div>
        ) : (
          stoppages.map((stop, idx) => {
            const isSelected = activeStoppageId === stop.id;
            const isPassed = stop.status === 'passed';
            const isAtStop = stop.status === 'at_stop';
            const isApproaching = stop.status === 'approaching';

            let statusBadgeClass = 'bg-blue-100 text-blue-900 border-blue-200';
            let statusLabel = 'आगामी (Upcoming)';
            let dotClass = 'bg-sky-500 text-white border-white';

            if (isPassed) {
              statusBadgeClass = 'bg-slate-100 text-slate-600 border-slate-200';
              statusLabel = 'पार हो चुका (Passed ✓)';
              dotClass = 'bg-slate-400 text-white border-slate-200';
            } else if (isAtStop) {
              statusBadgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
              statusLabel = 'वैन स्टॉप पर है (At Stop)';
              dotClass = 'bg-emerald-600 text-white border-white ring-4 ring-emerald-200';
            } else if (isApproaching) {
              statusBadgeClass = 'bg-amber-100 text-amber-900 border-amber-300';
              statusLabel = 'पहुँच रही है (Approaching)';
              dotClass = 'bg-amber-500 text-slate-950 border-white ring-4 ring-amber-300 animate-pulse';
            }

            return (
              <div key={stop.id} className="flex items-start gap-3 group">
                {/* Step indicator */}
                <div className="flex flex-col items-center shrink-0">
                  <div
                    className={`w-9 h-9 rounded-2xl flex items-center justify-center text-xs font-black shadow-md border-2 transition-all ${dotClass}`}
                  >
                    {isPassed ? '✓' : `#${stop.sequence}`}
                  </div>
                  {idx < stoppages.length - 1 && (
                    <div
                      className={`w-0.5 h-12 mt-1 ${
                        isPassed ? 'bg-slate-300' : 'bg-slate-200'
                      }`}
                    ></div>
                  )}
                </div>

                {/* Card Container */}
                <div
                  onClick={() => onSelectStoppage(stop)}
                  className={`flex-1 rounded-2xl p-3 border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-50/70 border-amber-400 shadow-md ring-2 ring-amber-400/30'
                      : isApproaching
                      ? 'bg-amber-50/40 border-amber-300 shadow-2xs hover:border-amber-400'
                      : isPassed
                      ? 'bg-slate-50/70 border-slate-200/80 opacity-75 hover:opacity-100'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusBadgeClass}`}
                        >
                          {statusLabel}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500">
                          निर्धारित: {stop.scheduledTime}
                        </span>
                      </div>

                      <h4 className="text-xs font-black text-slate-900 mt-1">
                        #{stop.sequence}. {stop.name}
                      </h4>
                    </div>

                    {/* Delete button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`क्या आप स्टॉप #${stop.sequence} (${stop.name}) हटाना चाहते हैं?`)) {
                          onDeleteStoppage(stop.id);
                        }
                      }}
                      className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-400 hover:text-rose-600 flex items-center justify-center text-[10px] transition-colors cursor-pointer"
                      title="स्टॉपेज हटाएं"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>

                  {/* Dynamic Live ETA & Student count pill */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                    <div className="flex items-center gap-1 text-slate-700 font-bold">
                      <i className="fa-solid fa-clock text-amber-500"></i>
                      <span>लाइव ETA:</span>
                      <span
                        className={`font-black ${
                          isApproaching ? 'text-amber-700' : isPassed ? 'text-slate-500' : 'text-blue-900'
                        }`}
                      >
                        {stop.etaFormatted || 'गणना हो रही है'}
                      </span>
                      {!isPassed && stop.projectedArrival && (
                        <span className="text-[10px] text-slate-400">
                          (~{stop.projectedArrival})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        👥 {stop.studentCount} छात्र
                      </span>
                      {stop.distanceFromVanKm !== undefined && !isPassed && (
                        <span className="text-[10px] font-mono text-slate-500">
                          {stop.distanceFromVanKm} km
                        </span>
                      )}
                    </div>
                  </div>

                  {stop.landmark && (
                    <p className="text-[10px] text-slate-400 mt-1 italic truncate">
                      📍 {stop.landmark}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* RETURN TO CAMPUS CARD */}
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-9 h-9 rounded-2xl bg-emerald-700 text-white flex items-center justify-center text-sm font-black shadow-md border-2 border-emerald-500">
              <i className="fa-solid fa-flag-checkered"></i>
            </div>
          </div>

          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl p-3 shadow-2xs">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-black uppercase text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                अंतिम गंतव्य (Campus Return)
              </span>
              <span className="text-[11px] font-bold text-slate-500">08:20 AM</span>
            </div>
            <h4 className="text-xs font-black text-slate-900 mt-1">
              ई.वी.एस. पब्लिक स्कूल वापसी
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              सभी छात्र सुरक्षित विद्यालय पहुंचे।
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
