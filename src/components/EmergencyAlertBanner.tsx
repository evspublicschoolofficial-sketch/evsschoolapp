import React, { useState, useEffect, useRef } from 'react';
import { SchoolNotice } from '../types';
import {
  startEmergencySiren,
  stopEmergencySiren,
  isEmergencySirenPlaying,
  unlockAudioContext,
  isAnnouncementSeen,
  markAnnouncementSeen,
  EVS_ANNOUNCEMENT_SEEN_EVENT,
  EVS_SEEN_ANNOUNCEMENTS_KEY,
} from '../utils/sirenAudio';

interface EmergencyAlertBannerProps {
  notices: SchoolNotice[];
  schoolName?: string;
  isParentView?: boolean;
  lang?: 'en' | 'hi';
}

export const EmergencyAlertBanner: React.FC<EmergencyAlertBannerProps> = ({
  notices,
  schoolName = 'E.V.S. PUBLIC SCHOOL',
  lang = 'en',
}) => {
  const [activeEmergency, setActiveEmergency] = useState<SchoolNotice | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSirenActive, setIsSirenActive] = useState<boolean>(false);
  const [hasHeardOnce, setHasHeardOnce] = useState<boolean>(false);
  const [voiceLang, setVoiceLang] = useState<'hi' | 'en'>('hi');
  const [seenTick, setSeenTick] = useState<number>(0);

  const sirenStopFnRef = useRef<(() => void) | null>(null);
  const userMutedRef = useRef<boolean>(false);
  const isModalOpenRef = useRef<boolean>(false);
  const activeEmergencyRef = useRef<SchoolNotice | null>(null);

  isModalOpenRef.current = isModalOpen;
  activeEmergencyRef.current = activeEmergency;

  const isIOS =
    typeof window !== 'undefined'
      ? /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
      : false;

  const handleStopSiren = () => {
    stopEmergencySiren();
    if (sirenStopFnRef.current) {
      sirenStopFnRef.current();
      sirenStopFnRef.current = null;
    }
    setIsSirenActive(false);
  };

  const handleStartSiren = (
    noticeOverride?: SchoolNotice | null,
    targetLang: 'hi' | 'en' = voiceLang
  ) => {
    const notice = noticeOverride || activeEmergencyRef.current;
    if (!notice) return;
    try {
      unlockAudioContext();
      userMutedRef.current = false;
      setIsSirenActive(true);

      sirenStopFnRef.current = startEmergencySiren(
        notice.title,
        true,
        targetLang,
        () => {
          // Announcement voice finished speaking once:
          // Stop endless repeat and record as seen+heard in localStorage so it won't re-show on future visits
          setHasHeardOnce(true);
          handleStopSiren();
          markAnnouncementSeen(notice, { dispatchEvent: false });
        }
      );
    } catch (e) {
      console.warn('Error starting announcement:', e);
    }
  };

  const toggleSiren = () => {
    if (isSirenActive) {
      userMutedRef.current = true;
      handleStopSiren();
    } else {
      handleStartSiren(activeEmergency, voiceLang);
    }
  };

  // Listen to cross-component / cross-tab seen events
  useEffect(() => {
    const onSeenEvent = () => setSeenTick((t) => t + 1);
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === EVS_SEEN_ANNOUNCEMENTS_KEY) {
        setSeenTick((t) => t + 1);
      }
    };
    window.addEventListener(EVS_ANNOUNCEMENT_SEEN_EVENT, onSeenEvent);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVS_ANNOUNCEMENT_SEEN_EVENT, onSeenEvent);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Find the latest emergency notice that has NOT already been seen & heard
  useEffect(() => {
    const emergency = notices.find(
      (n) => (n.isEmergency === true || n.category === 'emergency') && !isAnnouncementSeen(n)
    );

    if (!emergency) {
      // Notice was either removed or already permanently marked seen
      if (!isModalOpenRef.current) {
        setActiveEmergency(null);
        handleStopSiren();
      }
      return;
    }

    setActiveEmergency(emergency);
    setHasHeardOnce(false);
    userMutedRef.current = false;
    setIsModalOpen(true);

    // Attempt to play once automatically
    handleStartSiren(emergency, voiceLang);

    // Register one-touch audio unlock listener for strict mobile autoplay browsers
    const unlockOnFirstTouch = () => {
      unlockAudioContext();
      if (!userMutedRef.current && !isEmergencySirenPlaying() && activeEmergencyRef.current) {
        handleStartSiren(activeEmergencyRef.current, voiceLang);
      }
      window.removeEventListener('click', unlockOnFirstTouch);
      window.removeEventListener('touchstart', unlockOnFirstTouch);
      window.removeEventListener('keydown', unlockOnFirstTouch);
    };

    window.addEventListener('click', unlockOnFirstTouch, { once: true });
    window.addEventListener('touchstart', unlockOnFirstTouch, { once: true });
    window.addEventListener('keydown', unlockOnFirstTouch, { once: true });

    return () => {
      window.removeEventListener('click', unlockOnFirstTouch);
      window.removeEventListener('touchstart', unlockOnFirstTouch);
      window.removeEventListener('keydown', unlockOnFirstTouch);
    };
  }, [notices, seenTick]);

  // Clean up siren on unmount
  useEffect(() => {
    return () => {
      handleStopSiren();
    };
  }, []);

  const handleAcknowledge = () => {
    const target = activeEmergencyRef.current;
    handleStopSiren();
    userMutedRef.current = true;
    setIsModalOpen(false);
    setActiveEmergency(null);
    if (target) {
      markAnnouncementSeen(target, { dispatchEvent: true });
    }
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
      {/* ANNOUNCEMENT TOP BANNER (Visible only until user has seen/heard it) */}
      <div className="relative z-40 bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white shadow-lg border-b-2 border-amber-400">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 font-black text-[10px] tracking-wider uppercase shrink-0 shadow-2xs flex items-center gap-1">
              <i className="fa-solid fa-bullhorn text-[11px]"></i>
              {lang === 'hi' ? 'स्कूल उद्घोषणा' : 'School Announcement'}
            </span>
            <span className="font-extrabold truncate text-xs sm:text-sm text-white">
              {activeEmergency.title}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-auto flex-wrap">
            <button
              type="button"
              onClick={toggleSiren}
              className={`px-2.5 py-1 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                isSirenActive
                  ? 'bg-amber-400 text-slate-950 animate-pulse'
                  : 'bg-white/20 hover:bg-white/30 text-white border border-white/30'
              }`}
              title={
                isSirenActive
                  ? lang === 'hi'
                    ? 'अनाउंसमेंट म्यूट करें'
                    : 'Mute Announcement'
                  : lang === 'hi'
                  ? 'अनाउंसमेंट ध्वनि सुनें'
                  : 'Listen Announcement'
              }
            >
              <i
                className={`fa-solid ${
                  isSirenActive ? 'fa-volume-high text-blue-900' : 'fa-volume-xmark text-slate-300'
                }`}
              ></i>
              <span>
                {isSirenActive
                  ? lang === 'hi'
                    ? 'म्यूट करें'
                    : 'Mute'
                  : lang === 'hi'
                  ? '📢 अनाउंसमेंट सुनें'
                  : '📢 Listen Announcement'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="px-3 py-1 bg-white hover:bg-amber-100 text-blue-950 rounded-xl text-xs font-black shadow-xs cursor-pointer transition-all"
            >
              <span>{lang === 'hi' ? 'पूरी सूचना देखें →' : 'View Full Notice →'}</span>
            </button>

            <button
              type="button"
              onClick={handleAcknowledge}
              className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer transition-all"
              title={lang === 'hi' ? 'देख व सुन लिया — दोबारा न दिखाएं' : 'Mark seen & dismiss'}
            >
              ✓ {lang === 'hi' ? 'देख लिया' : 'Dismiss'}
            </button>
          </div>
        </div>
      </div>

      {/* FULL ANNOUNCEMENT POPUP MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl border-4 border-indigo-500 overflow-y-auto my-auto max-h-[92vh] flex flex-col animate-bounce-short">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-blue-800 text-white px-5 sm:px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-2xl font-black shadow-md">
                  <i className="fa-solid fa-bullhorn text-blue-900"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-white text-blue-900">
                      IMPORTANT NOTICE
                    </span>
                    <span className="text-xs text-amber-200 font-bold">{schoolName}</span>
                  </div>
                  <h3 className="text-base sm:text-xl font-black text-white mt-0.5">
                    {lang === 'hi' ? '📢 महत्वपूर्ण स्कूल उद्घोषणा' : '📢 Important School Announcement'}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAcknowledge}
                className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer transition-colors"
                title={lang === 'hi' ? 'बंद करें' : 'Close'}
              >
                ✕
              </button>
            </div>

            {/* Announcement Audio Controls Bar */}
            <div className="bg-blue-50/90 border-b border-blue-200 px-4 sm:px-6 py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 text-blue-950 text-xs font-bold">
                  <i
                    className={`fa-solid ${
                      isSirenActive
                        ? 'fa-bullhorn animate-bounce text-blue-700'
                        : hasHeardOnce
                        ? 'fa-circle-check text-emerald-600'
                        : 'fa-bell text-slate-400'
                    }`}
                  ></i>
                  <span>
                    {isSirenActive
                      ? lang === 'hi'
                        ? '📢 स्कूल उद्घोषणा चालू है (Playing Voice)'
                        : '📢 Playing Voice Announcement'
                      : hasHeardOnce
                      ? lang === 'hi'
                        ? '✅ सूचना पूरी सुन ली गई (दोबारा अपने आप नहीं बजेगी)'
                        : '✅ Announcement heard (will not repeat)'
                      : lang === 'hi'
                      ? 'अनाउंसमेंट सुनने के लिए बटन दबाएँ'
                      : 'Tap button to listen'}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setVoiceLang('hi');
                      handleStartSiren(activeEmergency, 'hi');
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs transition-transform active:scale-95 ${
                      isSirenActive && voiceLang === 'hi'
                        ? 'bg-blue-700 text-white'
                        : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                    }`}
                    title="हिंदी में घोषणा सुनें"
                  >
                    <i className="fa-solid fa-volume-high"></i>
                    <span>📢 {lang === 'hi' ? 'सुनें (Hindi)' : 'Listen (Hindi)'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setVoiceLang('en');
                      handleStartSiren(activeEmergency, 'en');
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs transition-transform active:scale-95 ${
                      isSirenActive && voiceLang === 'en'
                        ? 'bg-blue-700 text-white'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                    title="Listen announcement in English"
                  >
                    <i className="fa-solid fa-language"></i>
                    <span>Listen (English)</span>
                  </button>

                  {isSirenActive && (
                    <button
                      type="button"
                      onClick={() => {
                        userMutedRef.current = true;
                        handleStopSiren();
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-black bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 cursor-pointer shadow-xs transition-transform active:scale-95"
                    >
                      <i className="fa-solid fa-volume-xmark"></i>
                      <span>{lang === 'hi' ? 'रोकें / म्यूट' : 'Mute'}</span>
                    </button>
                  )}
                </div>
              </div>

              {isIOS && (
                <div className="bg-amber-100/80 border border-amber-300 rounded-lg px-2.5 py-1.5 text-[11px] text-amber-900 flex items-center gap-1.5 font-medium">
                  <i className="fa-solid fa-circle-exclamation text-amber-600 shrink-0"></i>
                  <span>
                    <strong>{lang === 'hi' ? 'iPhone यूज़र्स:' : 'iPhone Users:'}</strong>{' '}
                    {lang === 'hi'
                      ? 'आवाज़ सुनने हेतु कृपया iPhone के बाईं ओर का Silent Mode (Mute Switch) बंद करें व वॉल्यूम बढ़ाएं।'
                      : 'Please turn off the silent switch on the side of your iPhone and raise the volume to hear announcement audio.'}
                  </span>
                </div>
              )}
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
                    {lang === 'hi' ? 'दिनांक:' : 'Date:'} {activeEmergency.date}
                  </span>
                  <span className="flex items-center gap-1 font-semibold text-blue-900 bg-blue-50 px-2 py-0.5 rounded-md">
                    <i className="fa-solid fa-school"></i>
                    {lang === 'hi' ? 'कक्षा:' : 'Class:'}{' '}
                    {activeEmergency.targetClass || (lang === 'hi' ? 'सभी कक्षाएं (All)' : 'All Classes')}
                  </span>
                  {activeEmergency.issuedBy && (
                    <span className="text-slate-500">
                      {lang === 'hi' ? 'जारीकर्ता:' : 'Issued By:'}{' '}
                      <strong>{activeEmergency.issuedBy}</strong>
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
                  {lang === 'hi'
                    ? 'एक बार सुनकर व पढ़कर बंद करने के बाद यह सूचना दोबारा पॉपअप नहीं होगी। आप इसे बाद में "स्कूल सूचनाएँ" टैब में कभी भी देख सकते हैं।'
                    : 'Once heard and acknowledged, this popup will not show again. You can always view it later inside the School Notices tab.'}
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
                <span>{lang === 'hi' ? 'WhatsApp पर शेयर करें' : 'Share on WhatsApp'}</span>
              </button>

              <button
                type="button"
                onClick={handleAcknowledge}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-700 to-indigo-800 hover:from-blue-800 hover:to-indigo-900 text-white rounded-xl font-black text-xs sm:text-sm shadow-md cursor-pointer transition-transform active:scale-95 flex items-center gap-2 ml-auto"
              >
                <i className="fa-solid fa-check-double"></i>
                <span>
                  {lang === 'hi'
                    ? 'देख व सुन लिया / दोबारा न दिखाएं'
                    : 'Seen & Heard / Do Not Show Again'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
