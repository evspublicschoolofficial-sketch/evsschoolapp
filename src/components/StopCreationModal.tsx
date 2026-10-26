import React, { useState, useEffect } from 'react';
import { RouteStoppage, RouteShift } from '../types/routeTracking';

interface StopCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lat: number;
  lng: number;
  suggestedSequence: number;
  activeShift?: RouteShift;
  editingStop?: RouteStoppage | null;
  totalStoppagesCount?: number;
  onSaveStop: (newStop: Omit<RouteStoppage, 'id'>) => void;
  onUpdateStop?: (stopId: string, updatedFields: Partial<RouteStoppage>) => void;
}

export const StopCreationModal: React.FC<StopCreationModalProps> = ({
  isOpen,
  onClose,
  lat,
  lng,
  suggestedSequence,
  activeShift = 'morning',
  editingStop,
  totalStoppagesCount = 1,
  onSaveStop,
  onUpdateStop,
}) => {
  const isEditing = !!editingStop;
  const isMorning = activeShift === 'morning';

  const [name, setName] = useState<string>('');
  const [sequence, setSequence] = useState<number>(suggestedSequence);
  const [morningTime, setMorningTime] = useState<string>('07:30 AM');
  const [eveningTime, setEveningTime] = useState<string>('02:30 PM');
  const [studentCount, setStudentCount] = useState<number>(5);
  const [landmark, setLandmark] = useState<string>('');
  const [customLat, setCustomLat] = useState<number>(lat);
  const [customLng, setCustomLng] = useState<number>(lng);

  // Sync state whenever modal opens or editingStop changes
  useEffect(() => {
    if (editingStop) {
      setName(editingStop.name || '');
      setSequence(editingStop.sequence || suggestedSequence);
      setMorningTime(editingStop.morningTime || editingStop.scheduledTime || '07:30 AM');
      setEveningTime(editingStop.eveningTime || '02:30 PM');
      setStudentCount(editingStop.studentCount || 5);
      setLandmark(editingStop.landmark || '');
      setCustomLat(editingStop.lat);
      setCustomLng(editingStop.lng);
    } else {
      setName('');
      setSequence(suggestedSequence);
      setMorningTime('07:30 AM');
      setEveningTime('02:30 PM');
      setStudentCount(5);
      setLandmark('');
      setCustomLat(lat);
      setCustomLng(lng);
    }
  }, [editingStop, suggestedSequence, lat, lng, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const mTime = morningTime.trim() || '07:30 AM';
    const eTime = eveningTime.trim() || '02:30 PM';
    const activeScheduled = isMorning ? mTime : eTime;

    if (isEditing && editingStop && onUpdateStop) {
      onUpdateStop(editingStop.id, {
        name: name.trim(),
        sequence: Number(sequence) || editingStop.sequence,
        scheduledTime: activeScheduled,
        morningTime: mTime,
        eveningTime: eTime,
        studentCount: Number(studentCount) || 1,
        landmark: landmark.trim() || undefined,
        lat: customLat,
        lng: customLng,
      });
    } else {
      onSaveStop({
        sequence: Number(sequence) || suggestedSequence,
        name: name.trim(),
        lat: customLat,
        lng: customLng,
        scheduledTime: activeScheduled,
        morningTime: mTime,
        eveningTime: eTime,
        studentCount: Number(studentCount) || 1,
        landmark: landmark.trim() || undefined,
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className={`p-5 flex items-center justify-between text-white ${
          isEditing
            ? 'bg-gradient-to-r from-[#0c2340] via-amber-900 to-[#163660]'
            : 'bg-gradient-to-r from-[#0c2340] to-blue-900'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-black shadow-md ${
              isEditing ? 'bg-amber-400 text-slate-950' : 'bg-emerald-400 text-slate-950'
            }`}>
              <i className={`fa-solid ${isEditing ? 'fa-pen-to-square' : 'fa-map-pin'}`}></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 text-white px-2 py-0.5 rounded-full border border-white/20">
                  {isEditing ? `स्टॉप #${editingStop?.sequence} संपादन` : `नया स्टॉप #${suggestedSequence}`}
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  {isMorning ? '🌅 सुबह पिकअप' : '🌇 शाम ड्रॉप'}
                </span>
              </div>
              <h3 className="text-base font-black">
                {isEditing ? 'स्टॉपेज विवरण संशोधित करें' : 'रूट पर नया स्टॉपेज जोड़ें'}
              </h3>
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

        {/* GPS Coordinates & Sequence Bar */}
        <div className="bg-slate-50 px-5 py-2.5 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600 font-mono">
          <span className="flex items-center gap-1.5 font-bold text-slate-500">
            <i className="fa-solid fa-crosshairs text-blue-900"></i>
            सड़क GPS:
          </span>
          <span className="font-black text-slate-900">
            {customLat.toFixed(5)}, {customLng.toFixed(5)}
          </span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {/* Sequence Order */}
            <div className="col-span-1">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                क्रम (#):
              </label>
              <input
                type="number"
                min={1}
                max={Math.max(totalStoppagesCount + 1, 30)}
                value={sequence}
                onChange={(e) => setSequence(parseInt(e.target.value, 10) || 1)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-black text-center focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
            </div>

            {/* Stop Name */}
            <div className="col-span-3">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                स्टॉप का नाम (Stop Name) <span className="text-rose-600">*</span>:
              </label>
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="उदा. रामपुर मनिहारन मोड़ / चिलकाना बस स्टैंड"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
            </div>
          </div>

          {/* Morning & Evening Shift Times */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50/70 rounded-2xl border border-amber-200">
            <div>
              <label className="block text-[11px] font-bold text-amber-950 mb-1 flex items-center gap-1">
                <span>🌅 सुबह लाने का समय:</span>
              </label>
              <input
                type="text"
                value={morningTime}
                onChange={(e) => setMorningTime(e.target.value)}
                placeholder="07:30 AM"
                className="w-full px-3 py-2 rounded-xl bg-white border border-amber-300 text-xs font-bold focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
              <span className="text-[10px] text-amber-800 font-medium">घर से स्कूल लाते समय</span>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-amber-950 mb-1 flex items-center gap-1">
                <span>🌇 शाम छोड़ने का समय:</span>
              </label>
              <input
                type="text"
                value={eveningTime}
                onChange={(e) => setEveningTime(e.target.value)}
                placeholder="02:30 PM"
                className="w-full px-3 py-2 rounded-xl bg-white border border-amber-300 text-xs font-bold focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
              <span className="text-[10px] text-amber-800 font-medium">स्कूल से घर छोड़ते समय</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                विद्यार्थी संख्या (Students):
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

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                पहचान / लैंडमार्क (Optional):
              </label>
              <input
                type="text"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                placeholder="उदा. प्राथमिक स्कूल के पास"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-medium focus:border-blue-900 focus:ring-2 focus:ring-blue-900/20 outline-none"
              />
            </div>
          </div>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl text-[11px] text-blue-900 flex items-start gap-2">
            <i className="fa-solid fa-road text-blue-600 mt-0.5 shrink-0"></i>
            <p>
              {isEditing
                ? 'विवरण सहेजते ही रूट लाइन और ETA तुरंत अपडेट हो जाएंगे।'
                : 'स्टॉप सहेजते ही नीली रूट लाइन सीधे सड़क के मोड़ों व रास्तों पर (Road Snapping) स्वतः खिंच जाएगी।'}
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
              className={`px-5 py-2.5 rounded-xl text-xs font-black transition shadow-md flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                isEditing
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-black'
                  : 'bg-blue-900 hover:bg-blue-950 text-amber-300 font-black'
              }`}
            >
              <i className={`fa-solid ${isEditing ? 'fa-check-double' : 'fa-check'}`}></i>
              <span>{isEditing ? 'बदलाव सहेजें (Update)' : `स्टॉप जोड़ें (#${sequence})`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
