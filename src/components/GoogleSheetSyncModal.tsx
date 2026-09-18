import React, { useState } from 'react';
import { GOOGLE_APPS_SCRIPT_CODE, testGoogleSheetSync } from '../utils/busTrackingService';

interface GoogleSheetSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GoogleSheetSyncModal: React.FC<GoogleSheetSyncModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    configured: boolean;
    message: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = GOOGLE_APPS_SCRIPT_CODE;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testGoogleSheetSync();
      setTestResult({
        tested: true,
        configured: res.configured,
        message: res.message,
      });
    } catch (e: any) {
      setTestResult({
        tested: true,
        configured: false,
        message: e.message || 'परीक्षण असफल',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      id="google-sheet-sync-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-blue-900 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 text-lg">
              <i className="fa-solid fa-file-excel"></i>
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">
                गूगल शीट (Bus_Tracking) ऑटो-अपडेट सेटअप
              </h2>
              <p className="text-xs text-blue-200">
                Google Apps Script में 1 मिनट का आसान कोड सेटअप
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 text-slate-800 text-xs sm:text-sm">
          {/* Important Explanation Card */}
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-2">
            <div className="flex items-center gap-2 font-black text-amber-950">
              <i className="fa-solid fa-circle-exclamation text-amber-600"></i>
              <span>लोकेशन शीट में क्यों अपडेट नहीं हो रही थी?</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              वर्तमान में आपके Google Apps Script में केवल <strong>होमवर्क (addHomework)</strong> सेव करने का कोड था।
              ड्राइवर पोर्टल से भेजी जा रही लाइव लोकेशन को <strong>'Bus_Tracking'</strong> शीट में ऑटोमैटिक लिखने के लिए Apps Script में <strong>updateBusTracking</strong> कोड जोड़ना जरूरी है।
            </p>
          </div>

          {/* Quick 4 Steps Guide */}
          <div className="space-y-3">
            <h3 className="font-extrabold text-slate-900 flex items-center gap-2 text-sm">
              <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-[11px] flex items-center justify-center font-black">
                1
              </span>
              <span>4 आसान स्टेप्स में एक्टिवेट करें:</span>
            </h3>

            <div className="grid grid-cols-1 gap-2.5 pl-2">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-900 text-xs font-black flex items-center justify-center shrink-0">
                  1
                </span>
                <p className="text-xs text-slate-700">
                  अपनी स्कूल की गूगल शीट (<strong>E.V.S. Public School</strong>) खोलें।
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-900 text-xs font-black flex items-center justify-center shrink-0">
                  2
                </span>
                <p className="text-xs text-slate-700">
                  ऊपर मेन्यू में <strong>Extensions (एक्सटेंशन)</strong> &gt; <strong>Apps Script</strong> पर क्लिक करें।
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-900 text-xs font-black flex items-center justify-center shrink-0">
                  3
                </span>
                <div className="space-y-1 text-xs text-slate-700">
                  <p>
                    नीचे दिए गए नीले बटन <strong>"पूरा Apps Script कोड कॉपी करें"</strong> पर क्लिक करें और Apps Script के <code>Code.gs</code> में पेस्ट कर दें।
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-6 h-6 rounded-lg bg-blue-100 text-blue-900 text-xs font-black flex items-center justify-center shrink-0">
                  4
                </span>
                <p className="text-xs text-slate-700">
                  ऊपर दाएँ कोने में <strong>Deploy</strong> &gt; <strong>Manage deployments</strong> पर जाएँ, ✏️ पेंसिल आइकन दबाएँ, Version में <strong>New version</strong> चुनें और <strong>Deploy</strong> पर क्लिक करें!
                </p>
              </div>
            </div>
          </div>

          {/* Apps Script Code Preview Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-900 text-xs">
                Code.gs (Apps Script कोड):
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-blue-900 hover:bg-blue-800 text-white'
                }`}
              >
                <i className={`fa-solid ${copied ? 'fa-check' : 'fa-copy'}`}></i>
                <span>{copied ? 'कॉपी हो गया! ✅' : 'पूरा Apps Script कोड कॉपी करें'}</span>
              </button>
            </div>

            <div className="relative rounded-2xl bg-slate-900 p-4 text-emerald-400 font-mono text-[11px] leading-relaxed max-h-48 overflow-y-auto border border-slate-800 shadow-inner">
              <pre className="whitespace-pre-wrap">{GOOGLE_APPS_SCRIPT_CODE}</pre>
            </div>
          </div>

          {/* Test Connection Button & Result */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h4 className="font-extrabold text-slate-900 text-xs">
                  Apps Script सिंक कनेक्शन टेस्ट करें
                </h4>
                <p className="text-[11px] text-slate-500">
                  चेक करें कि Apps Script में updateBusTracking सक्रिय हो चुका है या नहीं
                </p>
              </div>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <i className={`fa-solid fa-satellite-dish ${testing ? 'animate-spin' : ''}`}></i>
                <span>{testing ? 'जाँच जारी है...' : 'अभी टेस्ट करें'}</span>
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                  testResult.configured
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                }`}
              >
                <i
                  className={`fa-solid ${
                    testResult.configured ? 'fa-circle-check text-emerald-600' : 'fa-clock text-amber-600'
                  }`}
                ></i>
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            शीट ID: 1AHQowKTK_... • टैब: Bus_Tracking
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            समझ गया (बंद करें)
          </button>
        </div>
      </div>
    </div>
  );
};
