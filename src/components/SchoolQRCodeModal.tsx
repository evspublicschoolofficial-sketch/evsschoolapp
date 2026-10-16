import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';

interface SchoolQRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolName?: string;
  campusName?: string;
}

export const SCHOOL_CHECKIN_CODE = 'EVS-CAMPUS-ATTENDANCE-2026';
export const SCHOOL_QR_PAYLOAD = JSON.stringify({
  protocol: 'evs-school-checkin',
  school: 'E.V.S. PUBLIC SCHOOL',
  code: SCHOOL_CHECKIN_CODE,
  type: 'STAFF_ATTENDANCE',
  campus: 'Main Gate & Reception',
  valid: true,
});

export const SchoolQRCodeModal: React.FC<SchoolQRCodeModalProps> = ({
  isOpen,
  onClose,
  schoolName = 'E.V.S. PUBLIC SCHOOL',
  campusName = 'Main Campus & Gate Reception',
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const printRef = useRef<HTMLDivElement>(null);

  // Update clock for fullscreen gate display
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('hi-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Generate QR Code data URL
  useEffect(() => {
    QRCode.toDataURL(SCHOOL_QR_PAYLOAD, {
      width: 480,
      margin: 2,
      color: {
        dark: '#0c2340',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'H',
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate School QR:', err));
  }, []);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(SCHOOL_CHECKIN_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const todayStr = new Date().toLocaleDateString('hi-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div
        className={`bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden transition-all duration-300 w-full ${
          isFullscreen ? 'fixed inset-2 max-w-none h-[calc(100vh-16px)] z-50 flex flex-col' : 'max-w-xl'
        }`}
      >
        {/* Modal Header */}
        <div className="bg-[#0c2340] text-white p-4 sm:p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shadow-md">
              <i className="fa-solid fa-qrcode text-lg"></i>
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-amber-300 flex items-center gap-2">
                स्कूल उपस्थिति क्यूआर कोड (School Staff QR)
              </h3>
              <p className="text-xs text-slate-300">{campusName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
              title={isFullscreen ? 'सामान्य दृश्य' : 'गेट स्क्रीन / फुलस्क्रीन मोड'}
            >
              <i className={`fa-solid ${isFullscreen ? 'fa-compress' : 'fa-expand'}`}></i>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-rose-600 text-white transition-colors"
              title="बंद करें"
            >
              <i className="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        {/* Printable Poster Area */}
        <div
          ref={printRef}
          className={`p-6 sm:p-8 flex flex-col items-center justify-center text-center bg-gradient-to-b from-amber-50/40 via-white to-slate-50 overflow-y-auto ${
            isFullscreen ? 'flex-1' : ''
          }`}
        >
          {/* School Emblem / Header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full text-xs font-bold uppercase tracking-wider">
              Official Campus Presence QR
            </span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-[#0c2340] font-serif tracking-wide">
            {schoolName}
          </h2>
          <p className="text-sm font-semibold text-slate-600 mt-1">
            दैनिक स्टाफ उपस्थिति एवं चेक-इन केंद्र (Staff Attendance Portal)
          </p>

          {/* Live Date & Clock Display */}
          <div className="mt-3 px-4 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700 flex items-center gap-3">
            <span>📅 {todayStr}</span>
            <span className="font-bold text-emerald-700 font-mono">🕒 {currentTime}</span>
          </div>

          {/* The High-Resolution QR Card */}
          <div className="mt-6 p-4 sm:p-6 bg-white rounded-2xl shadow-xl border-4 border-dashed border-amber-400/80 relative group flex flex-col items-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="School Check-in QR Code"
                className="w-56 h-56 sm:w-64 sm:h-64 object-contain rounded-lg"
              />
            ) : (
              <div className="w-56 h-56 flex items-center justify-center text-slate-400">
                <i className="fa-solid fa-circle-notch fa-spin text-3xl"></i>
              </div>
            )}

            <div className="mt-3 flex items-center gap-2 text-xs font-mono font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-md border border-slate-200">
              <span>Code: {SCHOOL_CHECKIN_CODE}</span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="text-amber-700 hover:text-amber-900 transition-colors ml-1"
                title="कोड कॉपी करें"
              >
                <i className={`fa-solid ${copied ? 'fa-check text-emerald-600' : 'fa-copy'}`}></i>
              </button>
            </div>
          </div>

          {/* Scanning Instructions (in Hindi & English) */}
          <div className="mt-5 max-w-md bg-blue-50/80 border border-blue-200 rounded-xl p-3 sm:p-4 text-xs text-blue-900 text-left space-y-1.5 shadow-sm">
            <div className="font-bold flex items-center gap-1.5 text-blue-950 text-sm">
              <i className="fa-solid fa-circle-info text-blue-600"></i>
              <span>स्टाफ के लिए निर्देश (Scanning Guide):</span>
            </div>
            <p className="leading-relaxed">
              1. स्कूल में प्रवेश करते समय अपने फोन में <strong>Teacher Portal</strong> खोलें।
            </p>
            <p className="leading-relaxed">
              2. <strong>'स्कूल QR स्कैन करें'</strong> बटन पर टैप करके इस कोड को स्कैन करें।
            </p>
            <p className="leading-relaxed">
              3. स्क्रीन पर <strong>'YES'</strong> पुष्टि करते ही आपकी आज की हाजिरी व समय दर्ज हो जाएगी।
            </p>
          </div>
        </div>

        {/* Modal Action Footer */}
        <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 font-medium">
            💡 इस पोस्टर को स्कूल गेट या स्टाफ रूम में लगाएं।
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-[#0c2340] text-amber-300 hover:bg-slate-800 transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <i className="fa-solid fa-print"></i>
              <span>प्रिंट पोस्टर (Print)</span>
            </button>

            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download="School_Staff_Attendance_QR.png"
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <i className="fa-solid fa-download"></i>
                <span>डाउनलोड QR</span>
              </a>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-slate-700 hover:bg-slate-200 border border-slate-300 transition-colors cursor-pointer"
            >
              बंद करें
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
