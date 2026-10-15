import React, { useState, useEffect, useRef } from 'react';
import { SchoolNotice } from '../types';
import {
  startEmergencySiren,
  stopEmergencySiren,
  playEmergencyChime,
  isEmergencySirenPlaying,
  unlockAudioContext,
} from '../utils/sirenAudio';

interface EmergencyAlertBannerProps {
  notices: SchoolNotice[];
  schoolName?: string;
  isParentView?: boolean;
}

export const EmergencyAlertBanner: React.FC<EmergencyAlertBannerProps> = ({
  notices,
  schoolName = 'E.V.S. PUBLIC SCHOOL',
  isParentView = false,
}) => {
  const [activeEmergency, setActiveEmergency] = useState<SchoolNotice | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSirenActive, setIsSirenActive] = useState<boolean>(false);
  const [userMuted, setUserMuted] = useState<boolean>(false);
  const sirenStopFnRef = useRef<(() => void) | null>(null);

  const handleStartSiren = (noticeTitle?: string) => {
    try {
      unlockAudioContext();
      sirenStopFnRef.current = startEmergencySiren(noticeTitle || activeEmergency?.title);
      setIsSirenActive(true);
      setUserMuted(false);
    } catch (e) {
      console.warn('Error starting announcement:', e);
    }
  };

  const handleStopSiren = () => {
    stopEmergencySiren();
    if (sirenStopFnRef.current) {
      sirenStopFnRef.current();
      sirenStopFnRef.current = null;
    }
    setIsSirenActive(false);
  };

  const toggleSiren = () => {
    if (isSirenActive) {
      handleStopSiren();
      setUserMuted(true);
    } else {
      handleStartSiren(activeEmergency?.title);
    }
  };

  // Find the latest emergency notice
  useEffect(() => {
    const emergency = notices.find(
      (n) => n.isEmergency === true || n.category === 'emergency'
    );

    if (emergency) {
      setActiveEmergency(emergency);
      // If parent has not acknowledged it this session, open modal and activate alert
      const isAck = sessionStorage.getItem(`evs_emergency_ack_${emergency.id}`);
      if (!isAck) {
        setIsModalOpen(true);
        // Attempt to start announcement tone automatically
        handleStartSiren(emergency.title);

        // Also register one-touch audio unlock listener for mobile/browsers with strict autoplay policy
        const unlockOnFirstTouch = () => {
          unlockAudioContext().then(() => {
            if (!userMuted && !isEmergencySirenPlaying()) {
              handleStartSiren(emergency.title);
            }
          });
          window.removeEventListener('click', unlockOnFirstTouch);
          window.removeEventListener('touchstart', unlockOnFirstTouch);
          window.removeEventListener('keydown', unlockOnFirstTouch);
        };

        window.addEventListener('click', unlockOnFirstTouch, { once: true });
        window.addEventListener('touchstart', unlockOnFirstTouch, { once: true });
        window.addEventListener('keydown', unlockOnFirstTouch, { once: true });
      }
    } else {
      setActiveEmergency(null);
      setIsModalOpen(false);
      handleStopSiren();
    }
  }, [notices]);

  // Clean up siren on unmount
  useEffect(() => {
    return () => {
      handleStopSiren();
    };
  }, []);

  const handleAcknowledge = () => {
    if (activeEmergency) {
      sessionStorage.setItem(`evs_emergency_ack_${activeEmergency.id}`, 'true');
    }
    handleStopSiren();
    setUserMuted(true);
    setIsModalOpen(false);
  };

  const handleShareWhatsApp = (notice: SchoolNotice) => {
    const text =
      `*📢 ${schoolName} - आवश्यक स्कूल सूचना प्रसारण (IMPORTANT NOTICE) 📢*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📌 *शीर्षक:* ${notice.title}\n` +
      `📅 *दिनांक:* ${notice.date}\n` +
      `🏫 *कक्षा:* ${notice.targetClass || 'समस्त कक्षाएं (All Classes)'}\n` +
      `✍️ *जारीकर्ता:* ${notice.issuedBy || 'विद्यालय प्रशासन'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `*विवरण:*\n${notice.description}\n\n` +
      `*सभी अभिभावक कृपया संज्ञान लें।*`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  if (!activeEmergency) return null;

  return (
    <>
      {/* PERSISTENT TOP ANNOUNCEMENT BANNER */}
      <div className="relative z-40 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white shadow-lg border-b-2 border-amber-400">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-3.5 w-3.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-300"></span>
            </span>
            <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[10px] tracking-wider uppercase shrink-0 shadow-2xs flex items-center gap-1">
              <i className="fa-solid fa-bullhorn text-[11px]"></i>
              स्कूल उद्घोषणा
            </span>
            <span className="font-extrabold truncate text-xs sm:text-sm text-white">
              {activeEmergency.title}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <button
              type="button"
              onClick={toggleSiren}
              className={`px-2.5 py-1 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                isSirenActive
                  ? 'bg-amber-400 text-slate-950 animate-pulse'
                  : 'bg-white/20 hover:bg-white/30 text-white border border-white/30'
              }`}
              title={isSirenActive ? 'अनाउंसमेंट म्यूट करें' : 'अनाउंसमेंट ध्वनि सुनें'}
            >
              <i
                className={`fa-solid ${
                  isSirenActive ? 'fa-volume-high text-blue-900' : 'fa-volume-xmark text-slate-300'
                }`}
              ></i>
              <span>{isSirenActive ? 'म्यूट करें' : '📢 अनाउंसमेंट सुनें'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-3 py-1 bg-white hover:bg-amber-100 text-blue-950 rounded-xl text-xs font-black shadow-xs cursor-pointer transition-all"
            >
              <span>पूरी सूचना देखें →</span>
            </button>
          </div>
        </div>
      </div>

      {/* FULL ANNOUNCEMENT POPUP MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border-4 border-indigo-500 overflow-hidden my-auto animate-bounce-short">
            {/* Header with pleasant announcement theme */}
            <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white px-5 sm:px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-2xl font-black shadow-md animate-pulse">
                  <i className="fa-solid fa-bullhorn text-blue-900"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-white text-blue-900">
                      IMPORTANT NOTICE
                    </span>
                    <span className="text-xs text-amber-200 font-bold">
                      {schoolName}
                    </span>
                  </div>
                  <h3 className="text-base sm:text-xl font-black text-white mt-0.5">
                    📢 महत्वपूर्ण स्कूल उद्घोषणा
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAcknowledge}
                className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer transition-colors"
                title="बंद करें"
              >
                ✕
              </button>
            </div>

            {/* Announcement Audio Controls Bar */}
            <div className="bg-blue-50/80 border-b border-blue-200 px-5 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-blue-950 text-xs font-bold">
                <i className={`fa-solid ${isSirenActive ? 'fa-bullhorn animate-bounce text-blue-700' : 'fa-bell text-slate-400'}`}></i>
                <span>{isSirenActive ? '📢 स्कूल अनाउंसमेंट चालू है (Announcement Active)' : 'अनाउंसमेंट ध्वनि बंद है'}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSiren}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs transition-transform active:scale-95 ${
                    isSirenActive
                      ? 'bg-blue-700 text-white hover:bg-blue-800'
                      : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                  }`}
                >
                  <i className={`fa-solid ${isSirenActive ? 'fa-volume-xmark' : 'fa-volume-high'}`}></i>
                  <span>{isSirenActive ? 'म्यूट करें' : '📢 अनाउंसमेंट सुनें'}</span>
                </button>
              </div>
            </div>

            {/* Notice Body */}
            <div className="p-5 sm:p-7 space-y-4">
              <div>
                <h4 className="text-lg sm:text-xl font-black text-slate-900 leading-snug">
                  {activeEmergency.title}
                </h4>
                <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-500 mt-2 pb-3 border-b border-slate-100">
                  <span className="flex items-center gap-1 font-semibold text-blue-800 bg-blue-100/70 px-2 py-0.5 rounded-md">
                    <i className="fa-solid fa-calendar-day"></i>
                    दिनांक: {activeEmergency.date}
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded-md">
                    <i className="fa-solid fa-school"></i>
                    कक्षा: {activeEmergency.targetClass || 'सभी कक्षाएं (All)'}
                  </span>
                  {activeEmergency.issuedBy && (
                    <span className="text-slate-500">
                      जारीकर्ता: <strong>{activeEmergency.issuedBy}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Description Box */}
              <div className="p-4 bg-gradient-to-br from-amber-50/70 to-blue-50/40 rounded-2xl border-2 border-blue-200 text-slate-900 text-sm sm:text-base leading-relaxed whitespace-pre-line font-medium shadow-2xs">
                {activeEmergency.description}
              </div>

              <div className="p-3 bg-slate-100 rounded-xl text-[11px] text-slate-600 flex items-start gap-2">
                <i className="fa-solid fa-circle-info text-blue-900 mt-0.5 text-xs shrink-0"></i>
                <span>
                  यह सूचना विद्यालय द्वारा प्राथमिकता (School Notice Announcement) के अंतर्गत प्रसारित की गई है। कृपया निर्देशानुसार संज्ञान लें।
                </span>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="bg-slate-50 px-5 sm:px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => handleShareWhatsApp(activeEmergency)}
                className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs flex items-center gap-2 shadow-sm cursor-pointer transition-transform active:scale-95"
              >
                <i className="fa-brands fa-whatsapp text-sm"></i>
                <span>WhatsApp पर शेयर करें</span>
              </button>

              <button
                type="button"
                onClick={handleAcknowledge}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-800 hover:to-indigo-900 text-white rounded-xl font-black text-xs sm:text-sm shadow-md cursor-pointer transition-transform active:scale-95 flex items-center gap-2 ml-auto"
              >
                <i className="fa-solid fa-check-double"></i>
                <span>मैंने पढ़ लिया है / बंद करें (Acknowledge & Close)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
