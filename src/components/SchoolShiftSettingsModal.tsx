import React, { useState, useEffect } from 'react';
import {
  SchoolShiftSettings,
  getSchoolShiftSettings,
  saveShiftSettingsToServer,
  evaluateStaffTimeStatus,
  formatMinutesToHuman,
} from '../utils/staffAttendanceMetrics';

interface SchoolShiftSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: (settings: SchoolShiftSettings) => void;
}

export const SchoolShiftSettingsModal: React.FC<SchoolShiftSettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsSaved,
}) => {
  const [settings, setSettings] = useState<SchoolShiftSettings>(() => getSchoolShiftSettings());
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Simulator / test state
  const [testInTime, setTestInTime] = useState<string>('08:20 AM');
  const [testOutTime, setTestOutTime] = useState<string>('02:45 PM');

  useEffect(() => {
    if (isOpen) {
      setSettings(getSchoolShiftSettings());
      setSaveSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Evaluate test calculation based on current modal inputs
  const simulatedEval = evaluateStaffTimeStatus(testInTime, testOutTime, settings);

  const handleApplyPreset = (preset: 'summer' | 'regular' | 'winter') => {
    if (preset === 'summer') {
      setSettings((prev) => ({
        ...prev,
        schoolOpeningTime: '07:30 AM',
        schoolClosingTime: '01:30 PM',
        graceMinutes: 15,
        overtimeThresholdMinutes: 15,
      }));
    } else if (preset === 'regular') {
      setSettings((prev) => ({
        ...prev,
        schoolOpeningTime: '08:00 AM',
        schoolClosingTime: '02:00 PM',
        graceMinutes: 15,
        overtimeThresholdMinutes: 15,
      }));
    } else if (preset === 'winter') {
      setSettings((prev) => ({
        ...prev,
        schoolOpeningTime: '09:00 AM',
        schoolClosingTime: '03:00 PM',
        graceMinutes: 15,
        overtimeThresholdMinutes: 15,
      }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const updated = await saveShiftSettingsToServer(settings);
      setSaveSuccess(true);
      onSettingsSaved?.(updated);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1200);
    } catch {
      alert('टाइमिंग सेटिंग्स सेव करने में त्रुटि आई।');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden w-full max-w-2xl transition-all animate-fadeIn my-auto">
        {/* Header */}
        <div className="bg-[#0c2340] text-white p-5 sm:p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-xl shadow-md">
              <i className="fa-solid fa-business-time"></i>
            </div>
            <div>
              <h3 className="font-black text-lg sm:text-xl text-amber-300 flex items-center gap-2">
                <span>स्कूल टाइमिंग व लेट/ओवरटाइम सेटिंग्स</span>
                <span className="text-[10px] uppercase font-black px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40">
                  मैनेजर नियंत्रण
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                स्कूल खुलने, बंद होने का समय, ग्रेस पीरियड और अतिरिक्त कार्य गणना नियम सेट करें
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-rose-600 text-white transition-colors cursor-pointer"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSave} className="p-4 sm:p-6 space-y-5 max-h-[80vh] overflow-y-auto text-xs sm:text-sm">
          {/* Quick Shift Presets Bar */}
          <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-2xl space-y-2">
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <i className="fa-solid fa-bolt text-amber-500"></i>
              <span>त्वरित शिफ्ट प्रीसेट (1-क्लिक में मौसम अनुसार समय चुनें):</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleApplyPreset('summer')}
                className={`py-2 px-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  settings.schoolOpeningTime === '07:30 AM'
                    ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-xs'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <span>☀️ ग्रीष्मकालीन (07:30 - 01:30)</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyPreset('regular')}
                className={`py-2 px-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  settings.schoolOpeningTime === '08:00 AM'
                    ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-xs'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <span>🏫 सामान्य (08:00 - 02:00)</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyPreset('winter')}
                className={`py-2 px-3 rounded-xl border font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  settings.schoolOpeningTime === '09:00 AM'
                    ? 'bg-amber-100 border-amber-400 text-amber-950 shadow-xs'
                    : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <span>❄️ शीतकालीन (09:00 - 03:00)</span>
              </button>
            </div>
          </div>

          {/* Core Shift Fields Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. School Opening Time */}
            <div className="p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50/40 space-y-2">
              <label className="font-black text-emerald-950 flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <i className="fa-solid fa-door-open text-emerald-600"></i>
                  <span>स्कूल खुलने / आने का समय:</span>
                </span>
                <span className="text-[11px] font-mono text-emerald-700 font-bold">Opening</span>
              </label>

              <input
                type="text"
                value={settings.schoolOpeningTime}
                onChange={(e) => setSettings({ ...settings, schoolOpeningTime: e.target.value })}
                placeholder="08:00 AM"
                className="w-full px-3.5 py-2.5 rounded-xl border border-emerald-300 bg-white font-mono font-black text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                required
              />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {['07:30 AM', '08:00 AM', '08:30 AM', '09:00 AM'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSettings({ ...settings, schoolOpeningTime: t })}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                      settings.schoolOpeningTime === t
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : 'bg-white text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-emerald-800 leading-tight">
                इस समय या इससे पहले आने वाले स्टाफ को <strong>'समय पर / जल्दी आए'</strong> माना जाएगा।
              </p>
            </div>

            {/* 2. Grace Period Minutes */}
            <div className="p-4 rounded-2xl border-2 border-amber-200 bg-amber-50/40 space-y-2">
              <label className="font-black text-amber-950 flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <i className="fa-solid fa-hourglass-half text-amber-600"></i>
                  <span>ग्रेस छूट अवधि (Grace Minutes):</span>
                </span>
                <span className="text-[11px] font-mono text-amber-700 font-bold">{settings.graceMinutes} min</span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="60"
                  value={settings.graceMinutes}
                  onChange={(e) => setSettings({ ...settings, graceMinutes: parseInt(e.target.value, 10) || 0 })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-amber-300 bg-white font-mono font-black text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
                  required
                />
                <span className="text-xs font-bold text-slate-600 shrink-0">मिनट</span>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {[0, 5, 10, 15, 20, 30].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSettings({ ...settings, graceMinutes: m })}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                      settings.graceMinutes === m
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white text-amber-900 border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-amber-900 leading-tight">
                स्कूल खुलने के बाद {settings.graceMinutes} मिनट तक की छूट रहेगी। इसके बाद चेक-इन पर <strong>'Late (देर से आए)'</strong> गिना जाएगा।
              </p>
            </div>

            {/* 3. School Closing Time */}
            <div className="p-4 rounded-2xl border-2 border-blue-200 bg-blue-50/40 space-y-2">
              <label className="font-black text-blue-950 flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <i className="fa-solid fa-door-closed text-blue-600"></i>
                  <span>स्कूल बंद होने / छुट्टी का समय:</span>
                </span>
                <span className="text-[11px] font-mono text-blue-700 font-bold">Closing</span>
              </label>

              <input
                type="text"
                value={settings.schoolClosingTime}
                onChange={(e) => setSettings({ ...settings, schoolClosingTime: e.target.value })}
                placeholder="02:00 PM"
                className="w-full px-3.5 py-2.5 rounded-xl border border-blue-300 bg-white font-mono font-black text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                required
              />

              <div className="flex flex-wrap gap-1.5 pt-1">
                {['01:30 PM', '02:00 PM', '02:30 PM', '03:00 PM'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSettings({ ...settings, schoolClosingTime: t })}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                      settings.schoolClosingTime === t
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-blue-800 border-blue-200 hover:bg-blue-100'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-blue-900 leading-tight">
                इस समय से पहले चेक-आउट करने पर <strong>'समय से पहले प्रस्थान (Early Departure)'</strong> रिकॉर्ड होगा।
              </p>
            </div>

            {/* 4. Overtime Threshold Minutes */}
            <div className="p-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 space-y-2">
              <label className="font-black text-indigo-950 flex items-center justify-between text-xs sm:text-sm">
                <span className="flex items-center gap-1.5">
                  <i className="fa-solid fa-bolt text-indigo-600"></i>
                  <span>ओवरटाइम कट-ऑफ (Overtime Threshold):</span>
                </span>
                <span className="text-[11px] font-mono text-indigo-700 font-bold">{settings.overtimeThresholdMinutes} min</span>
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={settings.overtimeThresholdMinutes}
                  onChange={(e) =>
                    setSettings({ ...settings, overtimeThresholdMinutes: parseInt(e.target.value, 10) || 0 })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-indigo-300 bg-white font-mono font-black text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                  required
                />
                <span className="text-xs font-bold text-slate-600 shrink-0">मिनट</span>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {[0, 15, 30, 45, 60].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSettings({ ...settings, overtimeThresholdMinutes: m })}
                    className={`px-2 py-0.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                      settings.overtimeThresholdMinutes === m
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-indigo-900 border-indigo-200 hover:bg-indigo-100'
                    }`}
                  >
                    +{m} min
                  </button>
                ))}
              </div>

              <p className="text-[11px] text-indigo-900 leading-tight">
                छुट्टी के समय के {settings.overtimeThresholdMinutes} मिनट बाद तक रुकने पर <strong>'Add Extra ओवर-टाइम'</strong> जुड़ेगा।
              </p>
            </div>
          </div>

          {/* Interactive Calculation Simulator */}
          <div className="bg-gradient-to-r from-slate-900 to-[#0c2340] text-white p-4 sm:p-5 rounded-2xl shadow-md space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-black text-amber-300 text-xs sm:text-sm flex items-center gap-1.5">
                <i className="fa-solid fa-calculator text-base"></i>
                <span>लाइव कैलकुलेशन टेस्ट (हाजिरी कैसे कैलकुलेट होगी?):</span>
              </div>
              <span className="text-[10px] text-slate-300">तुरंत परिणाम देखें</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-slate-300 block mb-1">परीक्षण चेक-इन समय:</label>
                <input
                  type="text"
                  value={testInTime}
                  onChange={(e) => setTestInTime(e.target.value)}
                  placeholder="08:20 AM"
                  className="w-full px-3 py-1.5 rounded-xl bg-white/10 text-white font-mono font-bold text-xs border border-white/20 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-300 block mb-1">परीक्षण चेक-आउट समय:</label>
                <input
                  type="text"
                  value={testOutTime}
                  onChange={(e) => setTestOutTime(e.target.value)}
                  placeholder="02:45 PM"
                  className="w-full px-3 py-1.5 rounded-xl bg-white/10 text-white font-mono font-bold text-xs border border-white/20 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
            </div>

            {/* Simulation Result Pill Badges */}
            <div className="p-3 bg-white/10 rounded-xl border border-white/10 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${simulatedEval.arrivalBadge.bgClass} ${simulatedEval.arrivalBadge.textClass}`}>
                  <i className={`fa-solid ${simulatedEval.arrivalBadge.icon}`}></i>
                  <span>{simulatedEval.arrivalBadge.text}</span>
                </span>

                {simulatedEval.departureBadge && (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 ${simulatedEval.departureBadge.bgClass} ${simulatedEval.departureBadge.textClass}`}>
                    <i className={`fa-solid ${simulatedEval.departureBadge.icon}`}></i>
                    <span>{simulatedEval.departureBadge.text}</span>
                  </span>
                )}
              </div>

              <div className="text-right text-xs">
                <span className="text-slate-300">कुल कार्य अवधि: </span>
                <span className="font-black text-amber-300 font-mono">
                  {simulatedEval.formattedDuration}
                </span>
              </div>
            </div>

            {/* Explanation Rules in Hindi */}
            <div className="text-[11px] text-slate-300 space-y-1 bg-black/20 p-2.5 rounded-xl">
              <div className="text-amber-200 font-bold">गणना का स्पष्ट नियम:</div>
              <div>• <strong>जल्दी आए (Early):</strong> {settings.schoolOpeningTime} से पहले चेक-इन करने पर।</div>
              <div>• <strong>समय पर (On Time):</strong> {settings.schoolOpeningTime} से {settings.graceMinutes} मिनट तक (ग्रेस पीरियड)।</div>
              <div>• <strong>लेट (Late):</strong> ग्रेस कट-ऑफ के बाद चेक-इन होने पर लेट मिनट स्वतः दर्ज होंगे।</div>
              <div>• <strong>समय से पहले निकले (Early Exit):</strong> {settings.schoolClosingTime} से पहले चेक-आउट करने पर।</div>
              <div>• <strong>ओवर-टाइम (Overtime):</strong> {settings.schoolClosingTime} के {settings.overtimeThresholdMinutes} मिनट बाद तक रुकने पर 'Add Extra' अतिरिक्त कार्य गिना जाएगा।</div>
            </div>
          </div>

          {saveSuccess && (
            <div className="p-3 bg-emerald-100 border border-emerald-400 text-emerald-950 rounded-xl font-bold text-center text-xs animate-bounce">
              ✓ स्कूल टाइमिंग व नियम सफलतापूर्वक सहेज लिए गए हैं! सभी स्टाफ रिकॉर्ड तुरंत अपडेट हो गए।
            </div>
          )}

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 cursor-pointer"
            >
              रद्द करें
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-md flex items-center gap-2 cursor-pointer transition-all transform active:scale-95"
            >
              <i className="fa-solid fa-floppy-disk text-base"></i>
              <span>{isSaving ? 'सहेजा जा रहा है...' : 'स्कूल टाइमिंग सुरक्षित करें (Save Timings)'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
