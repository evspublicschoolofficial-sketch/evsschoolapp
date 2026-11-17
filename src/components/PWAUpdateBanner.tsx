import React, { useEffect, useState } from 'react';
import {
  applyPWAUpdate,
  getPWAUpdateState,
  PWAUpdateState,
  subscribePWAUpdate,
} from '../utils/pwaUpdater';
import { AppLanguage } from '../utils/translations';

interface PWAUpdateProps {
  lang?: AppLanguage;
}

/**
 * Compact header button always visible at the top of the app across all portals.
 * Turns into a bright highlighted "Update Now" button as soon as a new GitHub/server build is detected.
 */
export const PWAHeaderUpdateButton: React.FC<PWAUpdateProps> = ({ lang = 'hi' }) => {
  const [pwaState, setPwaState] = useState<PWAUpdateState>(getPWAUpdateState);

  useEffect(() => {
    return subscribePWAUpdate(setPwaState);
  }, []);

  if (pwaState.updateAvailable) {
    return (
      <button
        type="button"
        onClick={() => applyPWAUpdate()}
        disabled={pwaState.isUpdating}
        className="relative px-2.5 sm:px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-400 via-emerald-300 to-amber-300 hover:from-emerald-300 hover:to-amber-200 text-slate-950 font-black text-xs shadow-lg shadow-emerald-500/30 border border-emerald-200 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 shrink-0"
        title={
          lang === 'en'
            ? 'New GitHub/App update available! Tap Update Now to load the latest version.'
            : 'GitHub पर नया ऐप अपडेट उपलब्ध है! अभी अपडेट करने के लिए क्लिक करें।'
        }
      >
        <span className="w-2 h-2 rounded-full bg-rose-600 animate-ping shrink-0" />
        <i className={`fa-solid ${pwaState.isUpdating ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'} text-xs`} />
        <span>
          {pwaState.isUpdating
            ? lang === 'en'
              ? 'Updating...'
              : 'अपडेट हो रहा...'
            : lang === 'en'
            ? 'Update Now'
            : 'अभी अपडेट करें'}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className="px-2.5 py-1.5 rounded-xl bg-white/5 text-slate-300/60 border border-white/10 text-xs font-bold flex items-center gap-1.5 cursor-not-allowed opacity-60 shrink-0 select-none"
      title={
        lang === 'en'
          ? 'Up to date — Update Now becomes active only when a new update is pushed to GitHub'
          : 'ऐप नवीनतम वर्ज़न पर है — GitHub पर नया अपडेट आने पर ही यह बटन सक्रिय होगा'
      }
    >
      <i className="fa-solid fa-circle-check text-[11px] text-emerald-400/75" />
      <span className="hidden sm:inline">{lang === 'en' ? 'Update Now' : 'अभी अपडेट करें'}</span>
      <span className="sm:hidden">{lang === 'en' ? 'Update Now' : 'अपडेट'}</span>
    </button>
  );
};

/**
 * Top notification strip directly below the main header:
 * - Shows prominent "Update Now" banner whenever a new deploy/GitHub build is ready
 * - Shows brief confirmation after update completes
 * - Shows brief status toast after user taps "Check Update"
 */
export const PWAUpdateBanner: React.FC<PWAUpdateProps> = ({ lang = 'hi' }) => {
  const [pwaState, setPwaState] = useState<PWAUpdateState>(getPWAUpdateState);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    return subscribePWAUpdate(setPwaState);
  }, []);

  const currentTargetVer = pwaState.latestVersion || 'waiting-sw';
  const showBanner = pwaState.updateAvailable && dismissedVersion !== currentTargetVer;

  return (
    <>
      {showBanner && (
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white border-b-2 border-amber-300 shadow-md sticky top-[72px] sm:top-[68px] z-20">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-300 text-slate-950 flex items-center justify-center shrink-0 shadow-sm">
                <i className="fa-solid fa-sparkles text-sm" />
              </div>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-black tracking-tight leading-snug">
                  {lang === 'en'
                    ? 'New App Update Ready! Tap "Update Now" to get the latest improvements.'
                    : 'नया ऐप अपडेट उपलब्ध है! नई सुविधाएं और सुधार देखने के लिए अभी अपडेट करें।'}
                </p>
                <p className="text-[11px] text-emerald-100 font-medium leading-tight">
                  {lang === 'en'
                    ? 'Your saved login & school data stays completely safe.'
                    : 'आपका लॉगिन व स्कूल डेटा पूरी तरह सुरक्षित रहेगा।'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto shrink-0">
              <button
                type="button"
                onClick={() => applyPWAUpdate()}
                disabled={pwaState.isUpdating}
                className="px-3.5 py-1.5 rounded-xl bg-amber-300 hover:bg-amber-200 text-slate-950 font-black text-xs sm:text-sm shadow-md flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-70"
              >
                <i className={`fa-solid ${pwaState.isUpdating ? 'fa-spinner fa-spin' : 'fa-download'}`} />
                <span>
                  {pwaState.isUpdating
                    ? lang === 'en'
                      ? 'Updating App...'
                      : 'अपडेट हो रहा है...'
                    : lang === 'en'
                    ? 'Update Now'
                    : 'अभी अपडेट करें'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDismissedVersion(currentTargetVer)}
                className="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-xs cursor-pointer transition"
                aria-label="Close update banner"
                title={lang === 'en' ? 'Hide banner (button remains in top bar)' : 'बैनर छुपाएं (ऊपर बटन बना रहेगा)'}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          </div>
        </div>
      )}

      {pwaState.justUpdated && (
        <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-900 px-4 py-2 text-xs font-bold flex items-center justify-center gap-2 shadow-xs">
          <i className="fa-solid fa-circle-check text-emerald-600 text-sm" />
          <span>
            {lang === 'en'
              ? 'App updated successfully to the latest version!'
              : 'ऐप सफलतापूर्वक नवीनतम वर्ज़न पर अपडेट हो गया है!'}
          </span>
        </div>
      )}

      {pwaState.checkFeedback && !showBanner && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-2xl border text-xs font-bold flex items-center gap-2 backdrop-blur-xs max-w-[92vw] ${
            pwaState.checkFeedback.type === 'latest'
              ? 'bg-emerald-900/95 text-white border-emerald-400/50'
              : pwaState.checkFeedback.type === 'update'
              ? 'bg-amber-400 text-slate-950 border-amber-200'
              : 'bg-rose-900/95 text-white border-rose-400/50'
          }`}
        >
          <span>{pwaState.checkFeedback.text}</span>
        </div>
      )}
    </>
  );
};
