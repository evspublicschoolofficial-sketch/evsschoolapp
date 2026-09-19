import React, { useState, useEffect } from 'react';
import {
  GOOGLE_APPS_SCRIPT_CODE,
  testGoogleSheetSync,
  getAppsScriptUrl,
  setAppsScriptUrl,
  DEFAULT_API_URL,
  SheetSyncDiagnostic,
} from '../utils/busTrackingService';

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
  const [customUrl, setCustomUrl] = useState<string>(getAppsScriptUrl());
  const [urlSaved, setUrlSaved] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<SheetSyncDiagnostic | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCustomUrl(getAppsScriptUrl());
      setTestResult(null);
      setUrlSaved(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
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

  const handleSaveUrl = () => {
    const success = setAppsScriptUrl(customUrl);
    if (success) {
      setUrlSaved(true);
      setTimeout(() => setUrlSaved(false), 2500);
      handleTestConnection(customUrl);
    }
  };

  const handleResetUrl = () => {
    setCustomUrl(DEFAULT_API_URL);
    setAppsScriptUrl('');
    setUrlSaved(true);
    setTimeout(() => setUrlSaved(false), 2500);
    handleTestConnection(DEFAULT_API_URL);
  };

  const handleTestConnection = async (overrideUrl?: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testGoogleSheetSync(overrideUrl || customUrl);
      setTestResult(res);
    } catch (e: any) {
      setTestResult({
        configured: false,
        statusType: 'network_error',
        message: e.message || 'परीक्षण असफल',
        details: 'कृपया इंटरनेट कनेक्शन जाँचें अथवा सुनिश्चित करें कि URL सही है।',
        testedUrl: overrideUrl || customUrl,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      id="google-sheet-sync-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-blue-900 to-indigo-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 text-lg">
              <i className="fa-solid fa-file-excel"></i>
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight">
                गूगल शीट (Bus_Tracking) लोकेशन सिंक सेटअप
              </h2>
              <p className="text-[11px] sm:text-xs text-blue-200">
                Google Apps Script कोड व न्यू वर्शन डिप्लॉयमेंट गाइड
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
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-slate-800 text-xs sm:text-sm">
          {/* Important Explanation Card */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 space-y-2">
            <div className="flex items-center gap-2 font-black text-amber-950">
              <i className="fa-solid fa-circle-exclamation text-amber-600 text-base"></i>
              <span>कोड डालने के बाद भी लोकेशन क्यों नहीं आ रही थी?</span>
            </div>
            <p className="text-xs text-amber-900 leading-relaxed">
              Google Apps Script में <strong>केवल 'Save' (डिस्क आइकन) दबाने से नया कोड लाइव नहीं होता है!</strong> जब तक आप ऊपर <strong>Deploy &gt; Manage deployments</strong> में जाकर <strong>'New version'</strong> नहीं चुनेंगे, तब तक पुराना कोड ही चलता रहता है और 'Invalid Action' एरर आता है।
            </p>
          </div>

          {/* Web App URL Configuration */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-900 text-xs flex items-center gap-1.5">
                <i className="fa-solid fa-link text-blue-700"></i>
                <span>Apps Script Web App URL:</span>
              </span>
              <button
                type="button"
                onClick={handleResetUrl}
                className="text-[11px] text-blue-700 hover:text-blue-900 font-semibold cursor-pointer underline"
              >
                डिफ़ॉल्ट URL रीसेट करें
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-300 font-mono text-[11px] text-slate-800 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSaveUrl}
                  className="px-3.5 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs cursor-pointer shrink-0 shadow-xs flex items-center gap-1"
                >
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>{urlSaved ? 'सहेजा गया ✓' : 'सेव करें'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTestConnection()}
                  disabled={testing}
                  className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs cursor-pointer shrink-0 shadow-xs flex items-center gap-1 disabled:opacity-50"
                >
                  <i className={`fa-solid fa-satellite-dish ${testing ? 'fa-spin' : ''}`}></i>
                  <span>{testing ? 'जाँच...' : 'टेस्ट करें'}</span>
                </button>
              </div>
            </div>

            {/* Test Diagnostic Result */}
            {testResult && (
              <div
                className={`p-3 rounded-xl text-xs space-y-1 ${
                  testResult.statusType === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border border-emerald-300'
                    : testResult.statusType === 'old_version'
                    ? 'bg-amber-50 text-amber-950 border border-amber-300'
                    : 'bg-rose-50 text-rose-900 border border-rose-300'
                }`}
              >
                <div className="font-bold flex items-center gap-2">
                  <i
                    className={`fa-solid ${
                      testResult.statusType === 'success'
                        ? 'fa-circle-check text-emerald-600'
                        : testResult.statusType === 'old_version'
                        ? 'fa-triangle-exclamation text-amber-600'
                        : 'fa-circle-xmark text-rose-600'
                    }`}
                  ></i>
                  <span>{testResult.message}</span>
                </div>
                {testResult.details && (
                  <p className="text-[11px] leading-relaxed text-slate-700 pl-5">
                    {testResult.details}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quick 4 Steps Guide */}
          <div className="space-y-2.5">
            <h3 className="font-extrabold text-slate-900 flex items-center gap-2 text-xs sm:text-sm">
              <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-[11px] flex items-center justify-center font-black">
                ✓
              </span>
              <span>गूगल शीट में सही तरह से डिप्लॉय करने के 4 स्टेप्स:</span>
            </h3>

            <div className="grid grid-cols-1 gap-2 pl-1">
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-900 text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <p className="text-xs text-slate-700">
                  अपनी स्कूल की गूगल शीट (<strong>E.V.S. Public School</strong>) खोलें और ऊपर मेन्यू में <strong>Extensions</strong> &gt; <strong>Apps Script</strong> पर क्लिक करें।
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-900 text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <p className="text-xs text-slate-700">
                  नीचे दिए गए नीले बटन <strong>"पूरा Apps Script कोड कॉपी करें"</strong> पर क्लिक करें और Apps Script के <code>Code.gs</code> में पुराना कोड हटाकर यह नया कोड पेस्ट कर दें।
                </p>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-amber-50 border border-amber-300">
                <span className="w-5 h-5 rounded-md bg-amber-500 text-slate-950 text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  3
                </span>
                <div className="text-xs text-amber-950 space-y-0.5">
                  <p className="font-bold">
                    ★ सबसे महत्वपूर्ण स्टेप (Deploy New Version):
                  </p>
                  <p>
                    ऊपर दाएँ कोने में <strong>Deploy</strong> बटन &gt; <strong>Manage deployments</strong> पर जाएँ, बाईं तरफ ✏️ <strong>Edit (पेंसिल)</strong> आइकन पर क्लिक करें, <strong>Version</strong> ड्रॉपडाउन में <strong>"New version"</strong> चुनें, और <strong>Deploy</strong> दबाएँ!
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <span className="w-5 h-5 rounded-md bg-blue-100 text-blue-900 text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                  4
                </span>
                <p className="text-xs text-slate-700">
                  यदि नया URL बना हो, तो उसे ऊपर बॉक्स में पेस्ट करके <strong>"सेव करें"</strong> पर क्लिक करें और <strong>"टेस्ट करें"</strong> बटन दबाएँ।
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
                <span>{copied ? 'कॉपी हो गया! ✓' : 'पूरा Apps Script कोड कॉपी करें'}</span>
              </button>
            </div>

            <div className="relative rounded-2xl bg-slate-900 p-4 text-emerald-400 font-mono text-[11px] leading-relaxed max-h-44 overflow-y-auto border border-slate-800 shadow-inner">
              <pre className="whitespace-pre-wrap">{GOOGLE_APPS_SCRIPT_CODE}</pre>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            टैब: Bus_Tracking • स्प्रेडशीट ID: 1AHQowKTK_...
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
