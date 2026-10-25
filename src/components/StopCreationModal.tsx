import React, { useState } from 'react';
import { RouteStoppage } from '../types/routeTracking';

interface StopCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lat: number;
  lng: number;
  suggestedSequence: number;
  onSaveStop: (newStop: Omit<RouteStoppage, 'id'>) => void;
}

const getCurrentFormattedTime = (): string => {
  const d = new Date();
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  const hrStr = hours < 10 ? `0${hours}` : `${hours}`;
  return `${hrStr}:${minStr} ${ampm}`;
};

export const StopCreationModal: React.FC<StopCreationModalProps> = ({
  isOpen,
  onClose,
  lat,
  lng,
  suggestedSequence,
  onSaveStop,
}) => {
  const [name, setName] = useState<string>('');
  const [scheduledTime, setScheduledTime] = useState<string>(() => getCurrentFormattedTime());
  const [studentCount, setStudentCount] = useState<number>(5);
  const [landmark, setLandmark] = useState<string>('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSaveStop({
      sequence: suggestedSequence,
      name: name.trim(),
      lat,
      lng,
      scheduledTime: scheduledTime.trim() || '07:30 AM',
      studentCount: Number(studentCount) || 1,
      landmark: landmark.trim() || undefined,
    });

    setName('');
    setLandmark('');
    setStudentCount(5);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0c2340] to-blue-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-lg font-black shadow-md">
              <i className="fa-solid fa-map-pin"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-400/30">
                  नया स्टॉप #{suggestedSequence}
                </span>
              </div>
              <h3 className="text-base font-black">रूट पर नया स्टॉपेज जोड़ें</h3>
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

        {/* Pin Location Coordinates Pill */}
        <div className="bg-slate-50 px-5 py-2.5 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600 font-mono">
          <span className="flex items-center gap-1.5 font-bold text-slate-500">
            <i className="fa-solid fa-crosshairs text-blue-900"></i>
            चयनित निर्देशांक (GPS):
          </span>
          <span className="font-black text-slate-900">
            {lat.toFixed(6)}, {lng.toFixed(6)}
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              स्टॉप का नाम (Stop Name) <span className="text-rose-600">*</span>:
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="उदा. रामपुर मनिहारन मोड़ / चिलकाना चौराहा"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                निर्धारित समय (Time):
              </label>
              <input
                type="text"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                placeholder="07:35 AM"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                छात्रों की संख्या (Students):
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={studentCount}
                onChange={(e) => setStudentCount(parseInt(e.target.value, 10) || 1)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              लैंडमार्क / पहचान चिन्ह (Optional Notes):
            </label>
            <input
              type="text"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="उदा. प्राथमिक स्कूल के पास / शिव मंदिर तिराहा"
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
            />
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-[11px] text-blue-900 flex items-start gap-2">
            <i className="fa-solid fa-circle-info text-blue-600 mt-0.5 shrink-0"></i>
            <p>
              स्टॉप सहेजते ही रूट लाइन स्वतः बढ़ जाएगी और गाड़ी की वर्तमान गति के अनुसार लाइव ETA की गणना शुरू हो जाएगी।
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              रद्द करें
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-amber-300 text-xs font-black transition shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <i className="fa-solid fa-check"></i>
              <span>स्टॉप जोड़ें (# {suggestedSequence})</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
