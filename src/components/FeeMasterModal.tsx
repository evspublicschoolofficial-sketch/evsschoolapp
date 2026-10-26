import React, { useState, useEffect } from 'react';
import {
  ClassFeeConfig,
  CLASS_META_LIST,
  DEFAULT_FEE_CONFIG,
  getActiveFeeMasterConfig,
  saveActiveFeeMasterConfig,
  syncFeeMasterToGoogleSheet,
  fetchFeeMasterDirectGViz,
} from '../utils/feeMaster';
import { GOOGLE_APPS_SCRIPT_CODE } from '../utils/busTrackingService';

interface FeeMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiUrl?: string;
  onFeeMasterUpdated?: () => void;
}

export const FeeMasterModal: React.FC<FeeMasterModalProps> = ({
  isOpen,
  onClose,
  apiUrl = 'https://script.google.com/macros/s/AKfycbwVy51K14qu6IXipAZXP4NspFcAUHpLcYv8-zjhkYnBlUI17TzGi_KaJU9TRmNT8D5vvQ/exec',
  onFeeMasterUpdated,
}) => {
  const [configMap, setConfigMap] = useState<Record<string, ClassFeeConfig>>(() => getActiveFeeMasterConfig());
  const [activeGroup, setActiveGroup] = useState<'All' | 'Pre-Primary' | 'Primary' | 'Middle'>('All');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  const [showDeployGuide, setShowDeployGuide] = useState<boolean>(false);

  // Sync directly from Google Sheet when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchFeeMasterDirectGViz().then((fresh) => {
        if (fresh && Object.keys(fresh).length > 0) {
          setConfigMap(fresh);
        } else {
          setConfigMap(getActiveFeeMasterConfig());
        }
      });
    }
  }, [isOpen]);

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

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_CODE);
      setCopiedCode(true);
      setShowDeployGuide(true);
      setSaveSuccessMsg('📋 नया Apps Script कोड क्लिपबोर्ड पर कॉपी हो गया! नीचे दिए गए 4 स्टेप्स को देखकर Google Sheet में Deploy करें।');
      setTimeout(() => {
        setCopiedCode(false);
      }, 5000);
    } catch {
      alert('क्लिपबोर्ड पर कॉपी नहीं हो सका।');
    }
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
        if (syncRes.message) {
          setSaveSuccessMsg(`✅ ${syncRes.message}`);
        } else {
          setSaveSuccessMsg('✅ स्कूल फीस मास्टर (केवल 4 फीस: एडमिशन, ट्यूशन, एग्जाम, बुक्स) Google Sheet में सुरक्षित हो गया!');
        }
      } else {
        setSaveSuccessMsg('✅ स्कूल फीस मास्टर स्थानीय रूप से सुरक्षित हो गया!');
      }

      if (onFeeMasterUpdated) {
        onFeeMasterUpdated();
      }
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } catch (e: any) {
      setSaveSuccessMsg(`⚠️ स्थानीय रूप से सुरक्षित हो गया! (${e.message || 'Sheet sync note'})`);
      setTimeout(() => setSaveSuccessMsg(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (window.confirm('क्या आप सभी कक्षाओं की फीस स्कूल डिफ़ॉल्ट दरों पर रीसेट करना चाहते हैं?')) {
      localStorage.removeItem('evs_fee_master_config');
      const def = getActiveFeeMasterConfig();
      setConfigMap(def);
      setSaveSuccessMsg('डिफ़ॉल्ट 4-फीस स्ट्रक्चर लोड हो गया है। इसे स्थायी करने के लिए Save दबाएं।');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const filteredClasses = CLASS_META_LIST.filter(
    (c) => activeGroup === 'All' || c.group === activeGroup
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-fadeIn overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-base shadow-sm">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-amber-300">
                  स्कूल फीस मास्टर (Fee Master - केवल 4 मुख्य फीस)
                </h3>
                <span className="text-[10px] bg-emerald-500/25 text-emerald-200 border border-emerald-400/30 px-2 py-0.5 rounded-full font-bold">
                  4 फीस हेड
                </span>
              </div>
              <p className="text-[11px] text-blue-200">
                1. एडमिशन फीस • 2. ट्यूशन फीस • 3. एग्जाम फीस • 4. बुक्स/किताबें फीस (ऑटो/वाहन फीस रूट अनुसार अलग है)
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

        {/* Info Banner */}
        <div className="bg-amber-50/80 px-5 py-2.5 border-b border-amber-200 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 text-amber-950 font-semibold">
            <i className="fa-solid fa-circle-info text-amber-600"></i>
            <span>
              <strong>स्पष्टीकरण:</strong> स्कूल में सिर्फ <strong>4 फीस हेड</strong> हैं। M1 (नर्सरी) और 4th का एडमिशन शुल्क डिफ़ॉल्ट ₹1000 है (आप इसे यहाँ कोई भी मान देकर बदल सकते हैं)।
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyCode}
              className="px-3 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 rounded-lg text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <i className={`fa-solid ${copiedCode ? 'fa-check text-emerald-700' : 'fa-code'}`}></i>
              <span>{copiedCode ? 'कोड कॉपी हो गया!' : 'Apps Script कोड कॉपी करें'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowDeployGuide(!showDeployGuide)}
              className="px-2.5 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              <i className="fa-solid fa-book-open mr-1"></i>
              {showDeployGuide ? 'गाइड छिपाएं' : 'डिप्लॉय कैसे करें?'}
            </button>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
            >
              डिफ़ॉल्ट लोड करें
            </button>
          </div>
        </div>

        {/* Expandable Deploy Steps Guide */}
        {showDeployGuide && (
          <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white p-4 border-b border-blue-800 text-xs shrink-0 animate-fadeIn space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-300 flex items-center gap-2">
                <i className="fa-solid fa-circle-question"></i>
                Google Apps Script में पुराना हटाकर नया कोड कैसे डिप्लॉय करें? (4 आवश्यक स्टेप्स):
              </span>
              <button
                type="button"
                onClick={() => setShowDeployGuide(false)}
                className="text-white/60 hover:text-white cursor-pointer text-xs"
              >
                ✕ बंद करें
              </button>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-blue-100 text-[11px] leading-relaxed">
              <li>
                अपनी Google Sheet खोलें और ऊपर मेनू में <strong>Extensions (एक्सटेंशन) &gt; Apps Script</strong> पर क्लिक करें।
              </li>
              <li>
                `Code.gs` में जाकर <strong>Ctrl + A</strong> दबाएं और पूरा पुराना कोड <strong>Delete</strong> कर दें।
              </li>
              <li>
                यहाँ ऊपर दिए <strong>"Apps Script कोड कॉपी करें"</strong> बटन से कॉपी किया गया नया कोड <strong>Ctrl + V</strong> करके पेस्ट करें और 💾 <strong>Save (Ctrl + S)</strong> दबाएं।
              </li>
              <li className="text-amber-200 font-bold bg-white/10 p-1.5 rounded-lg border border-amber-400/30">
                ⭐ सबसे महत्वपूर्ण: ऊपर दाएँ नीले बटन <strong>Deploy (डिप्लॉय) &gt; Manage deployments (डिप्लॉयमेंट प्रबंधित करें)</strong> पर जाएँ ➔ पेंसिल ✏️ (Edit) दबाएँ ➔ <strong>Version</strong> में <strong>"New version" (नया संस्करण)</strong> चुनें ➔ फिर <strong>Deploy</strong> दबाएँ!
              </li>
            </ol>
            <p className="text-[10px] text-emerald-300 font-medium">
              ✓ न्यू वर्शन डिप्लॉय होते ही आप ऐप में जिस भी कक्षा की एडमिशन फीस बदलेंगे, वह गूगल शीट में तुरंत सेव हो जाएगी और फालतू कॉलम भी नहीं बनेंगे।
            </p>
          </div>
        )}

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
        </div>

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
                  <th className="px-3.5 py-3 text-right">1. एडमिशन फीस (Admission ₹)</th>
                  <th className="px-3.5 py-3 text-right">2. ट्यूशन फीस (Tuition/माह ₹)</th>
                  <th className="px-3.5 py-3 text-right">3. एग्जाम फीस (Exam ₹)</th>
                  <th className="px-3.5 py-3 text-right">4. बुक्स फीस (Books ₹)</th>
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

                      {/* Admission Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={cfg.admissionFee}
                          onChange={(e) => handleFieldChange(cls.key, 'admissionFee', e.target.value)}
                          className="w-28 px-2.5 py-1.5 text-right rounded-lg border border-slate-300 font-bold text-slate-900 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
                        />
                      </td>

                      {/* Monthly Tuition Fee */}
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.monthlyTuition}
                          onChange={(e) => handleFieldChange(cls.key, 'monthlyTuition', e.target.value)}
                          className="w-28 px-2.5 py-1.5 text-right rounded-lg border border-blue-300 font-black text-blue-950 focus:border-blue-900 outline-none text-xs bg-blue-50/30 focus:bg-white"
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
                          className="w-28 px-2.5 py-1.5 text-right rounded-lg border border-slate-300 font-semibold text-slate-800 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
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
                          className="w-28 px-2.5 py-1.5 text-right rounded-lg border border-slate-300 font-semibold text-slate-800 focus:border-blue-900 outline-none text-xs bg-slate-50/50 focus:bg-white"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Google Sheet Tab Guide Box */}
          <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-blue-950 text-xs space-y-2">
            <div className="flex items-center gap-2 font-bold text-blue-900">
              <i className="fa-solid fa-table text-blue-700 text-sm"></i>
              <span>Google Sheet में 'Fee_Master' टैब कैसे बनाएं (या ऑटो-सिंक करें):</span>
            </div>
            <p className="text-[11px] text-blue-900 leading-relaxed">
              अगर आप Google Sheet में खुद मैन्युअल टैब बनाना चाहते हैं, तो अपनी शीट में <strong>+ (Add Sheet)</strong> दबाएं और उसका नाम <strong>'Fee_Master'</strong> रखें। पहली पंक्ति (Row 1 Header) में यह 6 कॉलम लिख दें:
            </p>
            <div className="bg-white p-2.5 rounded-xl border border-blue-200 font-mono text-[11px] text-slate-800 overflow-x-auto font-bold select-all">
              Class | Class-Name | Admission_Fee | Tuition_Fee | Exam_Fee | Books_Fee
            </div>
            <p className="text-[11px] text-slate-600">
              या फिर नीचे दिए गए हरे बटन <strong>"फीस स्ट्रक्चर सहेजें (Save & Sync)"</strong> पर क्लिक करें, यह स्वतः Google Sheet में सुरक्षित हो जाएगा।
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 hidden sm:block">
            * 4 मुख्य फीस: प्रवेश, मासिक शिक्षण, परीक्षा व पुस्तकें।
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
