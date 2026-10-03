import React, { useState } from 'react';
import {
  ClassFeeConfig,
  CLASS_META_LIST,
  DEFAULT_FEE_CONFIG,
  getActiveFeeMasterConfig,
  saveActiveFeeMasterConfig,
  syncFeeMasterToGoogleSheet,
} from '../utils/feeMaster';

interface FeeMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl?: string;
  onFeeMasterUpdated?: () => void;
}

export const FeeMasterModal: React.FC<FeeMasterModalProps> = ({
  isOpen,
  onClose,
  apiUrl = 'https://script.google.com/macros/s/AKfycbz_W4kC9zLgWl_KjRz10e1w/exec',
  onFeeMasterUpdated,
}) => {
  const [configMap, setConfigMap] = useState<Record<string, ClassFeeConfig>>(() => getActiveFeeMasterConfig());
  const [activeGroup, setActiveGroup] = useState<'All' | 'Pre-Primary' | 'Primary' | 'Middle'>('All');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [bulkTransportVal, setBulkTransportVal] = useState<string>('');
  const [showBulkTransport, setShowBulkTransport] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleFieldChange = (classKey: string, field: keyof ClassFeeConfig, value: string) => {
    const num = Math.max(0, parseInt(value, 10) || 0);
    setConfigMap((prev) => {
      const current = prev[classKey] || { ...DEFAULT_FEE_CONFIG };
      return {
        ...prev,
        [classKey]: {
          ...current,
          [field]: num,
        },
      };
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveSuccessMsg(null);
    try {
      // 1. Save to local storage
      saveActiveFeeMasterConfig(configMap);

      // 2. Sync to Google Sheets (Option B: Auto-creates Fee_Master tab in spreadsheet)
      if (apiUrl) {
        const syncRes = await syncFeeMasterToGoogleSheet(configMap, apiUrl);
        console.log('Fee Master Sheet sync result:', syncRes);
      }

      setSaveSuccessMsg('✅ स्कूल फीस मास्टर सफलतापूर्वक सुरक्षित हो गया एवं Google Sheet (Fee_Master) में अपडेट हो गया!');
      if (onFeeMasterUpdated) {
        onFeeMasterUpdated();
      }
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (e: any) {
      setSaveSuccessMsg(`⚠️ स्थानीय रूप से सुरक्षित हो गया! (${e.message || 'Sheet sync note'})`);
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (window.confirm('क्या आप सभी कक्षाओं की फीस स्कूल डिफ़ॉल्ट दरों पर रीसेट करना चाहते हैं?')) {
      localStorage.removeItem('evs_fee_master_config');
      const def = getActiveFeeMasterConfig();
      setConfigMap(def);
      setSaveSuccessMsg('डिफ़ॉल्ट फीस स्ट्रक्चर लोड हो गया है। इसे स्थायी करने के लिए Save दबाएं।');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const handleApplyBulkTransport = () => {
    const val = parseInt(bulkTransportVal, 10);
    if (isNaN(val) || val < 0) return;

    setConfigMap((prev) => {
      const updated = { ...prev };
      CLASS_META_LIST.forEach((cls) => {
        const current = updated[cls.key] || { ...DEFAULT_FEE_CONFIG };
        updated[cls.key] = { ...current, transportFee: val };
      });
      return updated;
    });

    setShowBulkTransport(false);
    setBulkTransportVal('');
    setSaveSuccessMsg(`सभी कक्षाओं में वाहन/ऑटो शुल्क ₹${val} निर्धारित कर दिया गया।`);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const filteredClasses = CLASS_META_LIST.filter(
    (c) => activeGroup === 'All' || c.group === activeGroup
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fadeIn overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-5xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-base shadow-sm">
              <i className="fa-solid fa-sliders"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-amber-300">
                  स्कूल फीस मास्टर स्ट्रक्चर (Fee Master Setup)
                </h3>
                <span className="text-[10px] bg-emerald-500/25 text-emerald-200 border border-emerald-400/30 px-2 py-0.5 rounded-full font-bold">
                  ऑटो-सिंक समर्थित
                </span>
              </div>
              <p className="text-[11px] text-blue-200">
                प्ले से कक्षा 8वीं तक मासिक शिक्षण, प्रवेश, परीक्षा, वाहन (ऑटो/वैन) एवं वार्षिक शुल्क निर्धारित करें
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Group Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 rounded-xl">
            {(['All', 'Pre-Primary', 'Primary', 'Middle'] as const).map((grp) => (
              <button
                key={grp}
                type="button"
                onClick={() => setActiveGroup(grp)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeGroup === grp
                    ? 'bg-blue-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {grp === 'All' ? 'सभी कक्षाएं' : grp === 'Pre-Primary' ? 'प्री-प्राइमरी (Play-UKG)' : grp === 'Primary' ? 'प्राइमरी (1st-5th)' : 'मिडिल (6th-8th)'}
              </button>
            ))}
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowBulkTransport(!showBulkTransport)}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
            >
              <i className="fa-solid fa-van-shuttle text-amber-600"></i>
              <span>वाहन / ऑटो शुल्क एक साथ भरें</span>
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
            >
              डिफ़ॉल्ट लोड करें
            </button>
          </div>
        </div>

        {/* Bulk Transport Popup Input */}
        {showBulkTransport && (
          <div className="px-5 py-2.5 bg-amber-50/90 border-b border-amber-200 flex items-center justify-between gap-3 text-xs animate-fadeIn shrink-0">
            <div className="flex items-center gap-2 text-amber-950 font-bold">
              <i className="fa-solid fa-bus-simple text-amber-700"></i>
              <span>सभी कक्षाओं हेतु एक समान वाहन (ऑटो/वैन) शुल्क दर्ज करें:</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="50"
                value={bulkTransportVal}
                onChange={(e) => setBulkTransportVal(e.target.value)}
                placeholder="e.g. 600"
                className="w-28 px-2.5 py-1 rounded-lg border border-amber-300 font-bold text-xs bg-white outline-none focus:border-amber-600"
              />
              <button
                type="button"
                onClick={handleApplyBulkTransport}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs cursor-pointer shadow-2xs"
              >
                लागू करें
              </button>
              <button
                type="button"
                onClick={() => setShowBulkTransport(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Success Alert */}
        {saveSuccessMsg && (
          <div className="mx-5 mt-3 p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 text-xs font-bold flex items-center gap-2 animate-fadeIn shrink-0">
            <i className="fa-solid fa-circle-check text-emerald-600 text-base"></i>
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {/* Fee Master Table */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="overflow-x-auto rounded-2xl border border-slate-200 shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3.5 py-3">कक्षा (Class)</th>
                  <th className="px-3.5 py-3 text-right">मासिक शिक्षण (Monthly ₹)</th>
                  <th className="px-3.5 py-3 text-right">प्रवेश शुल्क (Admission ₹)</th>
                  <th className="px-3.5 py-3 text-right">परीक्षा शुल्क (Exam ₹)</th>
                  <th className="px-3.5 py-3 text-right">वाहन / ऑटो (Transport ₹)</th>
                  <th className="px-3.5 py-3 text-right">वार्षिक शुल्क (Annual ₹)</th>
                  <th className="px-3.5 py-3 text-right">पुस्तकें (Books ₹)</th>
                  <th className="px-3.5 py-3 text-right">यूनिफॉर्म (Uniform ₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filteredClasses.map((cls) => {
                  const cfg = configMap[cls.key] || DEFAULT_FEE_CONFIG;
                  return (
                    <tr key={cls.key} className="hover:bg-slate-50 transition-colors">
                      {/* Class Badge */}
                      <td className="px-3.5 py-3">
                        <div className="font-bold text-slate-900 text-sm">{cls.name}</div>
                        <div className="text-[10px] text-slate-500 font-medium">
                          {cls.hindiName} • <span className="font-semibold text-blue-900">{cls.group}</span>
                        </div>
                      </td>

                      {/* Monthly Tuition Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.monthlyTuition}
                          onChange={(e) => handleFieldChange(cls.key, 'monthlyTuition', e.target.value)}
                          className="w-24 px-2 py-1 text-right rounded-lg border border-slate-300 font-bold text-blue-950 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
                        />
                      </td>

                      {/* Admission Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={cfg.admissionFee}
                          onChange={(e) => handleFieldChange(cls.key, 'admissionFee', e.target.value)}
                          className="w-24 px-2 py-1 text-right rounded-lg border border-slate-300 font-semibold text-slate-800 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
                        />
                      </td>

                      {/* Examination Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.examFee}
                          onChange={(e) => handleFieldChange(cls.key, 'examFee', e.target.value)}
                          className="w-20 px-2 py-1 text-right rounded-lg border border-slate-300 font-semibold text-slate-800 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
                        />
                      </td>

                      {/* Transport / Auto Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.transportFee}
                          onChange={(e) => handleFieldChange(cls.key, 'transportFee', e.target.value)}
                          className="w-20 px-2 py-1 text-right rounded-lg border border-amber-300 font-bold text-amber-950 focus:border-amber-600 outline-none text-xs bg-amber-50/40 focus:bg-white"
                        />
                      </td>

                      {/* Annual Charges */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={cfg.annualFee}
                          onChange={(e) => handleFieldChange(cls.key, 'annualFee', e.target.value)}
                          className="w-22 px-2 py-1 text-right rounded-lg border border-slate-300 font-semibold text-slate-800 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
                        />
                      </td>

                      {/* Books Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.booksFee}
                          onChange={(e) => handleFieldChange(cls.key, 'booksFee', e.target.value)}
                          className="w-20 px-2 py-1 text-right rounded-lg border border-slate-300 text-slate-700 focus:border-blue-900 outline-none text-xs"
                        />
                      </td>

                      {/* Uniform Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.uniformFee}
                          onChange={(e) => handleFieldChange(cls.key, 'uniformFee', e.target.value)}
                          className="w-20 px-2 py-1 text-right rounded-lg border border-slate-300 text-slate-700 focus:border-blue-900 outline-none text-xs"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Option B Explanation Box */}
          <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-950 text-xs flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-sm shadow-xs shrink-0 mt-0.5">
              <i className="fa-solid fa-cloud-arrow-up"></i>
            </div>
            <div className="space-y-1">
              <div className="font-extrabold text-indigo-900 text-xs">
                विकल्प B: Google Sheet में 'Fee_Master' टैब स्वतः सृजन (Auto-Created)
              </div>
              <p className="text-[11px] text-indigo-800 leading-relaxed">
                जब आप नीचे दिए गए हरे बटन से फीस सुरक्षित करेंगे, तो Google Apps Script आपकी स्कूल स्प्रेडशीट में <strong>'Fee_Master'</strong> नाम की शीट स्वतः तैयार कर देगा और प्रत्येक क्लास का पूरा ढांचा वहाँ सुरक्षित रहेगा। ऐप में फीस रसीद काटते समय नई दरें स्वतः लोड हो जाएँगी।
              </p>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 hidden sm:block">
            * बदलाव करने के बाद <strong>"Save & Sync"</strong> बटन दबाना अनिवार्य है।
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
            >
              बंद करें (Close)
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center gap-2 shadow-md cursor-pointer disabled:opacity-50 transition-all active:scale-95"
            >
              {isSaving ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  <span>गूगल शीट में सुरक्षित हो रहा है...</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>फीस स्ट्रक्चर सहेजें (Save & Sync)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
