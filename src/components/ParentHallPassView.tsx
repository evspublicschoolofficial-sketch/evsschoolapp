import React, { useEffect, useState } from 'react';
import { FeeCollectionRecord, HallPassConfig, Student } from '../types';
import {
  computeStudentHallPassEligibility,
  getExamDisplayTitle,
} from '../utils/hallPassHelper';
import { HallPassCard } from './HallPassCard';
import { HallPassDatesheetCard } from './HallPassDatesheetCard';
import { generateParentSingleStudentPdf } from '../utils/hallPassPdfGenerator';

interface ParentHallPassViewProps {
  student: Student;
  feeRecords: FeeCollectionRecord[];
  config: HallPassConfig;
  getClassName: (cls?: string | null) => string;
  photoUrl?: string;
  onGoToFees: () => void;
}

export const ParentHallPassView: React.FC<ParentHallPassViewProps> = ({
  student,
  feeRecords,
  config,
  getClassName,
  photoUrl,
  onGoToFees,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [downloadingPdf, setDownloadingPdf] = useState<boolean>(false);
  const eligibility = computeStudentHallPassEligibility(student, feeRecords, config);
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);

  useEffect(() => {
    let cancelled = false;
    const sid = String(student.Student_ID || '').trim();
    if (!sid) return;
    (async () => {
      try {
        const mod = await import('qrcode');
        const QRCodeLib = mod.default || mod;
        const url = await QRCodeLib.toDataURL(sid, {
          width: 180,
          margin: 1,
          color: { dark: '#0c2340', light: '#ffffff' },
        });
        if (!cancelled) setQrDataUrl(url);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [student.Student_ID]);

  const handleParentDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await generateParentSingleStudentPdf({
        item: eligibility,
        config,
        classNameLabel: getClassName(student.Class),
        photoUrl,
        qrDataUrl,
      });
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!config.publishedToParent) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
        <div className="text-base font-black text-amber-950">
          परीक्षा हॉल पास विद्यालय कार्यालय से जारी होगा
        </div>
        <p className="text-xs text-amber-800 max-w-md mx-auto leading-relaxed">
          {examTitle} ({config.session}) का डिजिटल हॉल पास अभी पेरेंट पोर्टल के लिए पब्लिश नहीं किया गया है। कृपया स्कूल कार्यालय से संपर्क करें।
        </p>
      </div>
    );
  }

  if (!eligibility.isEligible) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 sm:p-6 text-center space-y-3">
        <div className="w-11 h-11 mx-auto rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center text-lg">
          <i className="fa-solid fa-lock"></i>
        </div>
        <div className="space-y-1">
          <h4 className="text-base font-black text-rose-950">
            हॉल पास अस्थायी रूप से रोका गया है (Fee Pending)
          </h4>
          <p className="text-xs text-rose-800 max-w-md mx-auto leading-relaxed">
            <strong>{student.Student_Name}</strong> की बकाया फ़ीस{' '}
            <strong className="tabular-nums">₹{eligibility.dueAmount.toLocaleString('en-IN')}</strong>{' '}
            जमा होते ही <strong>{examTitle}</strong> का हॉल पास (एडमिट कार्ड) स्वतः अनलॉक हो जाएगा।
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToFees}
          className="px-4 py-2.5 rounded-xl bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-xs font-extrabold cursor-pointer transition-colors"
        >
          फ़ीस विवरण देखें / जमा करें →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          <div className="font-bold text-emerald-900">
            {eligibility.status === 'WAIVED'
              ? 'फ़ीस माफी के अंतर्गत हॉल पास जारी (Fee Waived ✓)'
              : eligibility.status === 'OVERRIDE_ALLOWED'
              ? 'विद्यालय प्रबंधक की विशेष अनुमति से जारी (Provisional Pass ✓)'
              : 'सभी देय फ़ीस जमा · हॉल पास जारी (Cleared ✓)'}
          </div>
          <div className="text-[11px] font-semibold text-emerald-700 tabular-nums mt-0.5">
            {examTitle} · {config.session}
          </div>
        </div>

        <button
          type="button"
          onClick={handleParentDownloadPdf}
          disabled={downloadingPdf}
          className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-50 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
        >
          <i className="fa-solid fa-file-arrow-down"></i>
          <span>{downloadingPdf ? 'PDF बन रही है...' : 'PDF डाउनलोड करें (Hall Pass + Datesheet)'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-1.5">
          <div className="text-center text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">
            आगे (Front · Hall Pass)
          </div>
          <HallPassCard
            item={eligibility}
            config={config}
            classNameLabel={getClassName(student.Class)}
            photoUrl={photoUrl}
            qrDataUrl={qrDataUrl}
            variant="parent_standalone"
          />
        </div>

        <div className="space-y-1.5">
          <div className="text-center text-[11px] font-extrabold text-slate-600 uppercase tracking-wide">
            पीछे (Back · Exam Datesheet)
          </div>
          <HallPassDatesheetCard
            item={eligibility}
            config={config}
            classNameLabel={getClassName(student.Class)}
            variant="parent_standalone"
          />
        </div>
      </div>
    </div>
  );
};
