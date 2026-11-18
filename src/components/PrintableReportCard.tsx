import React, { useEffect, useState } from 'react';
import { ComputedReportCardData, getGradeFromPercentage } from '../utils/reportCardHelper';

interface PrintableReportCardProps {
  data: ComputedReportCardData;
  mode: 'staff_printable' | 'parent_view_only';
  onPrintTriggered?: () => void;
}

export const PrintableReportCard: React.FC<PrintableReportCardProps> = ({
  data,
  mode,
  onPrintTriggered,
}) => {
  const isParentProtected = mode === 'parent_view_only';
  const [imgError, setImgError] = useState(false);
  const [screenShieldActive, setScreenShieldActive] = useState(false);
  const [shieldReason, setShieldReason] = useState(
    'Display temporarily hidden to prevent screenshots, printing, or copying.'
  );

  useEffect(() => {
    setImgError(false);
  }, [data.student.Student_ID, data.student.Student_Photo]);

  const triggerShield = (reason: string) => {
    if (!isParentProtected) return;
    setShieldReason(reason);
    setScreenShieldActive(true);
  };

  useEffect(() => {
    if (!isParentProtected) return;

    const handleKeyGuard = (e: KeyboardEvent) => {
      const keyLower = (e.key || '').toLowerCase();
      const isModifierPrintOrSave =
        (e.ctrlKey || e.metaKey) &&
        (keyLower === 'p' || keyLower === 's' || keyLower === 'u' || (e.shiftKey && keyLower === 's'));
      const isMacScreenshotShortcut =
        e.metaKey && e.shiftKey && (keyLower === '3' || keyLower === '4' || keyLower === '5' || keyLower === 's');
      const isPrintScreenKey = keyLower === 'printscreen' || e.code === 'PrintScreen' || e.keyCode === 44;

      if (isPrintScreenKey || isModifierPrintOrSave || isMacScreenshotShortcut) {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText('E.V.S. Public School — View-Only Marksheet Protected').catch(() => {});
          }
        } catch {}
        triggerShield('प्रिंट या स्क्रीनशॉट शॉर्टकट प्रतिबंधित है। यह रिपोर्ट कार्ड केवल देखने के लिए है।');
      }
    };

    const handleBeforePrint = () => {
      triggerShield('पेरेंट पोर्टल से रिपोर्ट कार्ड प्रिंट या PDF सेव करना बंद है।');
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerShield('स्क्रीन सुरक्षा सक्रिय: पेज दोबारा खोलने के बाद नीचे बटन दबाकर मार्कशीट देखें।');
      }
    };

    const handleWindowBlur = () => {
      triggerShield('स्क्रीन फोकस हटने के कारण गोपनीयता शील्ड सक्रिय हो गई है।');
    };

    window.addEventListener('keydown', handleKeyGuard, true);
    window.addEventListener('keyup', handleKeyGuard, true);
    window.addEventListener('beforeprint', handleBeforePrint);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyGuard, true);
      window.removeEventListener('keyup', handleKeyGuard, true);
      window.removeEventListener('beforeprint', handleBeforePrint);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isParentProtected]);

  const handleStaffPrintPdf = () => {
    if (isParentProtected) return;
    document.body.classList.add('printing-report-card');
    const cleanup = () => {
      document.body.classList.remove('printing-report-card');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    onPrintTriggered?.();
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1200);
    }, 60);
  };

  if (isParentProtected && data.meta.publishedToParent === false) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center space-y-2">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl">
          <i className="fa-solid fa-hourglass-half"></i>
        </div>
        <h3 className="text-base font-black text-amber-950">Report Card Under Review</h3>
        <p className="text-xs text-amber-800 font-medium max-w-md mx-auto">
          Your child&apos;s digital report card will appear here in view-only mode once finalized by the Class Teacher &amp; Principal.
        </p>
      </div>
    );
  }

  const gradeMeta = getGradeFromPercentage(data.overall.pct);
  const cleanPhone = String(data.student.Parent_Mobile || '').replace(/[^0-9]/g, '');
  const waPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  const waSummaryText = encodeURIComponent(
    `*E.V.S. PUBLIC SCHOOL — Academic Progress Report (${data.session})*\n` +
      `Student: ${data.student.Student_Name} (Class ${data.student.Class}, ID: ${data.student.Student_ID})\n` +
      `• Weekly Tests: ${data.weeklySummary.testsCount > 0 ? `${data.weeklySummary.obtained}/${data.weeklySummary.max} (${data.weeklySummary.pct}%)` : 'Pending'}\n` +
      `• Quarterly: ${data.quarterlySummary.hasData ? `${data.quarterlySummary.obtained}/${data.quarterlySummary.max} (${data.quarterlySummary.pct}%)` : 'Pending'} | Half-Yearly: ${data.halfYearlySummary.hasData ? `${data.halfYearlySummary.obtained}/${data.halfYearlySummary.max} (${data.halfYearlySummary.pct}%)` : 'Pending'} | Annual: ${data.annualSummary.hasData ? `${data.annualSummary.obtained}/${data.annualSummary.max} (${data.annualSummary.pct}%)` : 'Pending'}\n` +
      `• Overall: ${data.overall.obtained}/${data.overall.max} (${data.overall.pct}% • Grade ${data.overall.grade}) | Attendance: ${data.attendance.attendancePct}%\n` +
      `• Teacher Remark: ${data.meta.teacherRemark || data.autoTeacherRemark}\n` +
      `• Principal Remark: ${data.meta.principalRemark || data.autoPrincipalRemark}`
  );
  const waShareHref = waPhone ? `https://wa.me/${waPhone}?text=${waSummaryText}` : `https://wa.me/?text=${waSummaryText}`;

  const watermarkText = `VIEW ONLY • ${data.student.Student_Name} (${data.student.Student_ID}) • ${data.student.Parent_Mobile || 'EVS PUBLIC SCHOOL'}`;

  const renderMarkCell = (obtained: number | null, max: number, isAbsent: boolean) => {
    if (obtained === null) {
      return <span className="text-slate-400 text-[11px]">—</span>;
    }
    if (isAbsent) {
      return <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold text-[10px]">AB</span>;
    }
    return (
      <span className="font-bold text-slate-900">
        {obtained}
        <span className="text-slate-400 font-normal text-[10px]">/{max}</span>
      </span>
    );
  };

  return (
    <div className="space-y-3">
      {/* Staff Action Bar (Never shown in Parent View-Only Mode) */}
      {!isParentProtected && (
        <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black">
              <i className="fa-solid fa-award"></i>
            </span>
            <div>
              <div className="text-xs font-black">1-क्लिक डिजिटल मार्कशीट व रिपोर्ट कार्ड</div>
              <div className="text-[11px] text-slate-300">
                साप्ताहिक + तिमाही + छमाही + सालाना अंक + हाजिरी शामिल
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={waShareHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <i className="fa-brands fa-whatsapp text-sm"></i>
              <span>WhatsApp सारांश</span>
            </a>
            <button
              type="button"
              onClick={handleStaffPrintPdf}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-sm transition-colors"
            >
              <i className="fa-solid fa-print"></i>
              <span>प्रिंट / PDF सेव करें</span>
            </button>
          </div>
        </div>
      )}

      {/* Parent View-Only Strict Security Banner */}
      {isParentProtected && (
        <div className="no-print bg-gradient-to-r from-rose-950 via-slate-900 to-indigo-950 text-white px-4 py-3 rounded-2xl border border-rose-500/40 flex flex-wrap items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-rose-500/20 border border-rose-400/40 text-rose-300 flex items-center justify-center shrink-0">
              <i className="fa-solid fa-shield-halved"></i>
            </span>
            <div>
              <div className="text-xs font-black tracking-tight">
                सुरक्षित व्यू-ओनली रिपोर्ट कार्ड (View-Only Protected Mode)
              </div>
              <div className="text-[11px] text-slate-300">
                इस पोर्टल पर मार्कशीट केवल देखी जा सकती है — डाउनलोड, प्रिंट व स्क्रीनशॉट बंद हैं।
              </div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-400/30 text-[10px] font-black text-rose-200 uppercase">
            No Print • No Download
          </span>
        </div>
      )}

      {/* Shown ONLY if a parent attempts OS print despite protections */}
      {isParentProtected && (
        <div className="parent-print-block-notice">
          <div>
            <p className="text-xl font-black mb-2">🔒 E.V.S. PUBLIC SCHOOL — प्रिंट व डाउनलोड प्रतिबंधित</p>
            <p className="text-sm font-semibold">
              पेरेंट पोर्टल से डिजिटल रिपोर्ट कार्ड का प्रिंट या PDF बनाना सुरक्षा नीति के तहत बंद है। आधिकारिक प्रिंट कॉपी के लिए विद्यालय कार्यालय से संपर्क करें।
            </p>
          </div>
        </div>
      )}

      {/* Main Marksheet Sheet */}
      <div
        id={!isParentProtected ? 'printable-report-card-sheet' : undefined}
        onContextMenu={isParentProtected ? (e) => e.preventDefault() : undefined}
        onCopy={
          isParentProtected
            ? (e) => {
                e.preventDefault();
                triggerShield('मार्कशीट डेटा कॉपी करना प्रतिबंधित है।');
              }
            : undefined
        }
        onCut={isParentProtected ? (e) => e.preventDefault() : undefined}
        onDragStart={isParentProtected ? (e) => e.preventDefault() : undefined}
        className={`relative bg-white border-2 border-blue-950 rounded-2xl overflow-hidden shadow-md ${
          isParentProtected ? 'parent-protected-marksheet no-capture-surface' : ''
        }`}
      >
        {/* Dynamic Repeating Diagonal Security Watermark for Parent Mode */}
        {isParentProtected && (
          <div
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-0 z-20 overflow-hidden opacity-25"
          >
            <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern
                  id={`wm-${data.student.Student_ID}`}
                  width="320"
                  height="160"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(-24)"
                >
                  <text
                    x="10"
                    y="60"
                    fill="#1e3a8a"
                    fontSize="11"
                    fontWeight="800"
                    fontFamily="sans-serif"
                  >
                    {watermarkText}
                  </text>
                  <text
                    x="40"
                    y="130"
                    fill="#9f1239"
                    fontSize="10"
                    fontWeight="700"
                    fontFamily="sans-serif"
                  >
                    E.V.S. PUBLIC SCHOOL • NO SCREENSHOT / NO PRINT
                  </text>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#wm-${data.student.Student_ID})`} />
            </svg>
          </div>
        )}

        {/* Privacy Blur Shield Overlay when screenshot/print/focus-loss is triggered */}
        {isParentProtected && screenShieldActive && (
          <div className="no-print absolute inset-0 z-30 bg-slate-950/92 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center text-white">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-400/50 text-rose-300 flex items-center justify-center text-2xl mb-3">
              <i className="fa-solid fa-eye-slash"></i>
            </div>
            <h4 className="text-base font-black mb-1">सुरक्षा शील्ड सक्रिय (Privacy Shield)</h4>
            <p className="text-xs text-slate-300 max-w-sm mb-4 leading-relaxed">{shieldReason}</p>
            <button
              type="button"
              onClick={() => setScreenShieldActive(false)}
              className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black cursor-pointer shadow-lg transition-colors"
            >
              <i className="fa-solid fa-eye mr-1.5"></i>
              वापस देखें (Resume View)
            </button>
          </div>
        )}

        {/* Marksheet Inner Content */}
        <div className={`relative z-10 p-4 sm:p-6 space-y-4 ${isParentProtected && screenShieldActive ? 'blur-lg' : ''}`}>
          {/* Top School Header */}
          <div className="bg-gradient-to-r from-blue-950 via-indigo-950 to-blue-900 text-white rounded-xl p-4 sm:p-5 border-b-4 border-amber-400 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-center sm:text-left">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-2xl font-black shrink-0 shadow">
                <i className="fa-solid fa-graduation-cap"></i>
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-black tracking-wider uppercase">
                  E.V.S. PUBLIC SCHOOL
                </h2>
                <p className="text-[11px] sm:text-xs text-blue-100 font-semibold tracking-wide">
                  Chilkana Sultanpur, Saharanpur (U.P.) • An English Medium Co-Educational Institution
                </p>
                <span className="inline-block mt-1 px-2.5 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-[10px] font-extrabold tracking-widest uppercase text-amber-200">
                  Official Academic Progress Report Card
                </span>
              </div>
            </div>

            <div className="text-center sm:text-right bg-white/10 px-4 py-2 rounded-xl border border-white/15 shrink-0">
              <div className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">
                Academic Session
              </div>
              <div className="text-sm font-black tracking-wide">{data.session}</div>
            </div>
          </div>

          {/* Student Profile Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
            <div className="md:col-span-9 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Student Name
                </span>
                <span className="font-black text-slate-900 text-sm">{data.student.Student_Name}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Class
                </span>
                <span className="font-black text-blue-900">{data.student.Class}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Roll No. / Student ID
                </span>
                <span className="font-bold text-slate-800">
                  #{data.student.Roll_Number || '—'} • {data.student.Student_ID}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Father&apos;s Name
                </span>
                <span className="font-semibold text-slate-800">{data.student.Father_Name || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Mother&apos;s Name
                </span>
                <span className="font-semibold text-slate-800">{data.student.Mother_Name || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Result Status
                </span>
                <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-black text-[11px] uppercase tracking-wide">
                  {data.meta.resultStatus || 'PROMOTED'}
                </span>
              </div>
            </div>

            <div className="md:col-span-3 flex items-center md:justify-end gap-3 border-t md:border-t-0 md:border-l border-slate-200 pt-2.5 md:pt-0 md:pl-3">
              {data.student.Student_Photo && !imgError ? (
                <img
                  src={data.student.Student_Photo}
                  alt={data.student.Student_Name}
                  onError={() => setImgError(true)}
                  className="w-16 h-16 rounded-xl object-cover border-2 border-blue-900/20"
                  draggable={false}
                />
              ) : (
                <div
                  className="w-16 h-16 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-100 border border-blue-200 text-blue-900 flex flex-col items-center justify-center shrink-0"
                  title="Student Portrait"
                >
                  <i className="fa-solid fa-user-graduate text-xl"></i>
                  <span className="text-[8px] font-extrabold uppercase tracking-wider text-blue-700 mt-1">
                    Student
                  </span>
                </div>
              )}
              <div className={`px-3.5 py-2 rounded-xl border text-center min-w-[78px] ${gradeMeta.colorClass}`}>
                <div className="text-[9px] font-extrabold uppercase tracking-wider">Grade</div>
                <div className="text-xl font-black leading-none mt-0.5">{data.overall.grade}</div>
                <div className="text-[10px] font-bold mt-0.5 tabular-nums">{data.overall.pct}%</div>
              </div>
            </div>
          </div>

          {/* Academic Marks Table combining Weekly Tests + Quarterly + Half-Yearly + Annual */}
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs min-w-[640px]">
              <thead>
                <tr className="bg-blue-950 text-white">
                  <th className="py-2.5 px-3 font-black uppercase tracking-wide text-[11px]">Subject</th>
                  <th className="py-2.5 px-2.5 text-center font-bold">
                    Weekly Tests
                    <span className="block text-[9px] font-normal text-blue-200">Continuous Eval.</span>
                  </th>
                  <th className="py-2.5 px-2.5 text-center font-bold">
                    Quarterly Exam
                    <span className="block text-[9px] font-normal text-blue-200">Term I</span>
                  </th>
                  <th className="py-2.5 px-2.5 text-center font-bold">
                    Half-Yearly Exam
                    <span className="block text-[9px] font-normal text-blue-200">Mid-Term</span>
                  </th>
                  <th className="py-2.5 px-2.5 text-center font-bold">
                    Annual Exam
                    <span className="block text-[9px] font-normal text-blue-200">Final Term</span>
                  </th>
                  <th className="py-2.5 px-2.5 text-center font-black bg-indigo-900">
                    Grand Total
                    <span className="block text-[9px] font-normal text-amber-300">Marks (%)</span>
                  </th>
                  <th className="py-2.5 px-2.5 text-center font-black bg-indigo-950 uppercase">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.subjects.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 font-semibold">
                      Assessment marks for Weekly Tests or Term Examinations have not been recorded yet.
                    </td>
                  </tr>
                ) : (
                  data.subjects.map((row) => (
                    <tr key={row.subjectKey} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-bold text-slate-900">{row.subjectLabel}</td>
                      <td className="py-2.5 px-2.5 text-center tabular-nums">
                        {row.weeklyMax > 0 ? (
                          <div>
                            <span className="font-bold text-slate-900">
                              {row.weeklyObtained}
                              <span className="text-slate-400 font-normal text-[10px]">/{row.weeklyMax}</span>
                            </span>
                            <span className="block text-[9px] text-slate-500">
                              ({row.weeklyCount} {row.weeklyCount === 1 ? 'Test' : 'Tests'})
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-center tabular-nums">
                        {renderMarkCell(row.quarterlyObtained, row.quarterlyMax, row.quarterlyAbsent)}
                      </td>
                      <td className="py-2.5 px-2.5 text-center tabular-nums">
                        {renderMarkCell(row.halfYearlyObtained, row.halfYearlyMax, row.halfYearlyAbsent)}
                      </td>
                      <td className="py-2.5 px-2.5 text-center tabular-nums">
                        {renderMarkCell(row.annualObtained, row.annualMax, row.annualAbsent)}
                      </td>
                      <td className="py-2.5 px-2.5 text-center bg-indigo-50/50 font-black text-blue-950 tabular-nums">
                        {row.combinedMax > 0 ? (
                          <>
                            {row.combinedObtained}/{row.combinedMax}{' '}
                            <span className="text-[10px] text-indigo-700">({row.combinedPct}%)</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-center font-black text-slate-900 bg-slate-50">
                        {row.grade}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {data.subjects.length > 0 && (
                <tfoot>
                  <tr className="bg-blue-50 font-black text-blue-950 border-t-2 border-blue-900/30 tabular-nums">
                    <td className="py-2.5 px-3 uppercase tracking-wide text-[11px]">
                      Grand Total &amp; Percentage
                    </td>
                    <td className="py-2.5 px-2.5 text-center">
                      {data.weeklySummary.max > 0 ? (
                        <div>
                          <span>{data.weeklySummary.obtained}/{data.weeklySummary.max}</span>
                          <span className="block text-[10px] text-indigo-700 font-bold">
                            ({data.weeklySummary.pct}%)
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-normal">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-center">
                      {data.quarterlySummary.hasData ? (
                        <div>
                          <span>{data.quarterlySummary.obtained}/{data.quarterlySummary.max}</span>
                          <span className="block text-[10px] text-indigo-700 font-bold">
                            ({data.quarterlySummary.pct}%)
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-normal">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-center">
                      {data.halfYearlySummary.hasData ? (
                        <div>
                          <span>{data.halfYearlySummary.obtained}/{data.halfYearlySummary.max}</span>
                          <span className="block text-[10px] text-indigo-700 font-bold">
                            ({data.halfYearlySummary.pct}%)
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-normal">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-center">
                      {data.annualSummary.hasData ? (
                        <div>
                          <span>{data.annualSummary.obtained}/{data.annualSummary.max}</span>
                          <span className="block text-[10px] text-indigo-700 font-bold">
                            ({data.annualSummary.pct}%)
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 font-normal">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-center bg-indigo-100">
                      <div>
                        <span>{data.overall.obtained}/{data.overall.max}</span>
                        <span className="block text-[10px] text-indigo-800 font-extrabold">
                          ({data.overall.pct}%)
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-center bg-amber-100 text-amber-950 text-sm">
                      {data.overall.grade}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Attendance, Discipline & Overall Performance Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Attendance</div>
              <div className="text-lg font-black text-emerald-950 mt-0.5">{data.attendance.attendancePct}%</div>
              <div className="text-[10px] text-emerald-800">
                Present: {data.attendance.presentDays} / {data.attendance.totalDays} Days
              </div>
            </div>

            <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
              <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Weekly Tests Avg.</div>
              <div className="text-lg font-black text-blue-950 mt-0.5">
                {data.weeklySummary.testsCount > 0 ? `${data.weeklySummary.pct}%` : '—'}
              </div>
              <div className="text-[10px] text-blue-800">
                {data.weeklySummary.testsCount > 0
                  ? `${data.weeklySummary.testsCount} ${data.weeklySummary.testsCount === 1 ? 'Test' : 'Tests'} Conducted`
                  : 'No Tests Yet'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-purple-50 border border-purple-200">
              <div className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Conduct &amp; Hygiene</div>
              <div className="text-lg font-black text-purple-950 mt-0.5">{data.attendance.cleanConductPct}%</div>
              <div className="text-[10px] text-purple-800">Uniform, Discipline &amp; Neatness</div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Overall Evaluation</div>
              <div className="text-lg font-black text-amber-950 mt-0.5">
                {data.overall.hasAnyScore ? `Grade ${data.overall.grade}` : 'Pending'}
              </div>
              <div className="text-[10px] text-amber-900 truncate font-semibold">{data.overall.gradeLabel}</div>
            </div>
          </div>

          {/* Teacher & Principal Remarks + Signatures */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50/40 border border-blue-200/70 space-y-1.5">
              <div className="text-[11px] font-black text-blue-950 flex items-center gap-1.5 uppercase tracking-wide">
                <i className="fa-solid fa-chalkboard-user text-blue-700"></i>
                <span>Class Teacher&apos;s Remarks</span>
              </div>
              <p className="text-xs text-slate-800 font-medium leading-relaxed italic">
                &ldquo;{data.meta.teacherRemark || data.autoTeacherRemark}&rdquo;
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-gradient-to-br from-slate-50 to-amber-50/40 border border-amber-200/70 space-y-1.5">
              <div className="text-[11px] font-black text-indigo-950 flex items-center gap-1.5 uppercase tracking-wide">
                <i className="fa-solid fa-user-tie text-indigo-700"></i>
                <span>Principal&apos;s Remarks</span>
              </div>
              <p className="text-xs text-slate-800 font-medium leading-relaxed italic">
                &ldquo;{data.meta.principalRemark || data.autoPrincipalRemark}&rdquo;
              </p>
            </div>
          </div>

          {/* Signatures Footer */}
          <div className="pt-4 border-t border-dashed border-slate-300 grid grid-cols-3 gap-3 text-center text-[11px] text-slate-700">
            <div>
              <div className="h-7"></div>
              <div className="border-t border-slate-300 pt-1 font-bold">Parent / Guardian&apos;s Signature</div>
            </div>
            <div>
              <div className="h-7"></div>
              <div className="border-t border-slate-300 pt-1 font-bold">Class Teacher&apos;s Signature</div>
            </div>
            <div>
              <div className="h-7 font-black text-blue-900 text-[10px] tracking-wider flex items-end justify-center pb-0.5 uppercase">
                E.V.S. PUBLIC SCHOOL
              </div>
              <div className="border-t border-slate-300 pt-1 font-bold">Principal&apos;s Signature &amp; Seal</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
