import React, { useState, useEffect } from 'react';

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({ isOpen, onClose }) => {
  const [isIOS, setIsIOS] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(ua);
    setIsIOS(isIOSDevice);

    // Detect if opened in WhatsApp, Instagram, FB, etc. in-app browser
    const inApp = /wv|fbav|instagram|whatsapp|telegram|line|snapchat/.test(ua) || (isIOSDevice && !/safari/.test(ua));
    setIsInAppBrowser(inApp);

    // Detect if already installed / standalone
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleCopyLink = () => {
    try {
      const url = window.location.origin || window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      });
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleNativeInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        onClose();
      }
      setDeferredPrompt(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-fadeIn">
      <div 
        className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden border-2 border-amber-400 animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white p-5 relative">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-[#0c2340] flex items-center justify-center font-black text-2xl shadow-md shrink-0">
              <i className="fa-brands fa-apple text-slate-950"></i>
            </div>
            <div className="pr-8">
              <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40">
                iPhone & Mobile Installation Guide
              </span>
              <h3 className="text-lg sm:text-xl font-black text-white mt-1">
                iPhone / Android में App Install करें
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
            title="बंद करें (Close)"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-slate-800 text-sm">
          {isStandalone ? (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xl mx-auto shadow-md">
                <i className="fa-solid fa-circle-check"></i>
              </div>
              <h4 className="font-black text-base">App पहले से ही Installed है!</h4>
              <p className="text-xs text-emerald-800">
                यह ऐप आपकी होम स्क्रीन पर पहले से ही एक स्वतंत्र मोबाइल ऐप की तरह काम कर रहा है।
              </p>
            </div>
          ) : (
            <>
              {/* Important iOS Notice */}
              <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-xs space-y-1">
                <div className="flex items-center gap-2 font-black text-blue-900">
                  <i className="fa-solid fa-circle-info text-blue-600 text-sm"></i>
                  <span>iPhone में App Store के बिना 1 मिनट में Install करें:</span>
                </div>
                <p className="text-blue-800 leading-relaxed">
                  Apple के नियमों के अनुसार iPhone में वेब-ऐप (PWA) को <strong>Safari</strong> ब्राउज़र के <strong>"Add to Home Screen"</strong> फीचर द्वारा सीधे इंस्टॉल किया जाता है।
                </p>
              </div>

              {/* In-App Browser Warning (WhatsApp / Instagram / FB) */}
              {isInAppBrowser && (
                <div className="p-3.5 bg-amber-50 border-2 border-amber-400 rounded-2xl text-xs space-y-2">
                  <div className="flex items-start gap-2 text-amber-950 font-black">
                    <i className="fa-solid fa-triangle-exclamation text-amber-600 text-base mt-0.5"></i>
                    <div>
                      <span className="block text-amber-900 font-extrabold">
                        सावधानी: आप WhatsApp या सोशल ऐप के ब्राउज़र में हैं!
                      </span>
                      <span className="text-[11px] font-normal text-amber-800 block mt-0.5">
                        WhatsApp के अंदर 'Add to Home Screen' का विकल्प नहीं आता। कृपया लिंक को <strong>Safari ब्राउज़र</strong> में खोलें:
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-xs cursor-pointer transition"
                    >
                      <i className={`fa-solid ${copied ? 'fa-check text-emerald-950' : 'fa-copy'}`}></i>
                      <span>{copied ? 'लिंक कॉपी हो गया!' : '📋 लिंक कॉपी करें (Copy Link)'}</span>
                    </button>
                    <span className="text-[11px] text-amber-800 font-semibold">
                      फिर iPhone का <strong>Safari</strong> खोलकर पेस्ट करें
                    </span>
                  </div>
                </div>
              )}

              {/* Step-by-Step iOS Safari Guide */}
              <div className="space-y-3">
                <h4 className="font-black text-slate-900 text-sm flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-[#0c2340] text-amber-300 flex items-center justify-center text-xs font-black">
                    <i className="fa-brands fa-apple"></i>
                  </span>
                  <span>iPhone / iPad में 4 आसान स्टेप्स:</span>
                </h4>

                {/* Step 1 */}
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="w-7 h-7 rounded-full bg-blue-900 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    1
                  </div>
                  <div>
                    <div className="font-extrabold text-slate-900 text-xs sm:text-sm">
                      Safari ब्राउज़र में खोलें
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      सुनिश्चित करें कि यह वेबसाइट आपके iPhone के <strong>Safari</strong> (नीला कम्पास आइकन) में खुली हो।
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-amber-50/70 border-2 border-amber-300">
                  <div className="w-7 h-7 rounded-full bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    2
                  </div>
                  <div className="flex-1">
                    <div className="font-extrabold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                      <span>नीचे 'Share' (शेयर) बटन दबाएँ</span>
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold shadow-xs">
                        <i className="fa-solid fa-arrow-up-from-bracket mr-1"></i> Share
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Safari स्क्रीन के सबसे नीचे बीच में चौकोर बॉक्स जिसमें ऊपर तीर बना है (Share Sheet) पर टैप करें।
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-emerald-50/80 border-2 border-emerald-300">
                  <div className="w-7 h-7 rounded-full bg-emerald-600 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    3
                  </div>
                  <div className="flex-1">
                    <div className="font-extrabold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5 flex-wrap">
                      <span>'Add to Home Screen' चुनें</span>
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-lg bg-emerald-700 text-white text-[11px] font-bold shadow-xs">
                        <i className="fa-solid fa-plus-square mr-1"></i> होम स्क्रीन में जोड़ें
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      शेयर मेनू को थोड़ा ऊपर स्क्रॉल करें और <strong>"Add to Home Screen"</strong> (प्लस आइकन) पर क्लिक करें।
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="w-7 h-7 rounded-full bg-blue-900 text-white font-black text-xs flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    4
                  </div>
                  <div>
                    <div className="font-extrabold text-slate-900 text-xs sm:text-sm">
                      ऊपर 'Add' (जोड़ें) दबाएँ
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5">
                      ऊपरी दाएँ कोने में <strong>"Add"</strong> पर टैप करें। आपके iPhone की स्क्रीन पर <strong>EVS School</strong> का लोगो वाला ऐप आ जाएगा!
                    </div>
                  </div>
                </div>
              </div>

              {/* Android Flow if on Android */}
              {deferredPrompt && (
                <div className="pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={handleNativeInstall}
                    className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer transition transform active:scale-98"
                  >
                    <i className="fa-solid fa-download text-base"></i>
                    <span>📲 एक क्लिक में Android / Chrome पर Install करें</span>
                  </button>
                </div>
              )}
            </>
          )}

          {/* Quick link copy bar */}
          <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <span className="text-slate-500 font-medium text-[11px]">
              स्कूल पोर्टल URL: <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-mono">{typeof window !== 'undefined' ? window.location.host : ''}</code>
            </span>

            <button
              type="button"
              onClick={handleCopyLink}
              className="px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
            >
              <i className={`fa-solid ${copied ? 'fa-check text-emerald-600' : 'fa-copy'}`}></i>
              <span>{copied ? 'कॉपी हो गया' : 'Copy School Link'}</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-bold">
            <i className="fa-solid fa-shield-halved text-emerald-600"></i>
            <span>सुरक्षित एवं तेज़ PWA तकनीक</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#0c2340] hover:bg-slate-900 text-white font-black text-xs cursor-pointer shadow-md transition"
          >
            समझ गया (Done)
          </button>
        </div>
      </div>
    </div>
  );
};
