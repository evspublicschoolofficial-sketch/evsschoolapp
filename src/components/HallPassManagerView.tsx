import React, { useEffect, useMemo, useState } from 'react';
import { ExamTermType, FeeCollectionRecord, HallPassConfig, Student } from '../types';
import {
  chunkIntoPages,
  computeStudentHallPassEligibility,
  getExamDisplayTitle,
  saveHallPassConfigToServer,
} from '../utils/hallPassHelper';
import { normalizeStudentId } from '../utils/feeCalculation';
import { getLocalTimestamp } from '../utils/localTime';
import { openWhatsappAlert } from '../utils/whatsappReminders';
import { HallPassCard } from './HallPassCard';

interface HallPassManagerViewProps {
  students: Student[];
  feeRecords: FeeCollectionRecord[];
  config: HallPassConfig;
  onConfigChange: (next: HallPassConfig) => void;
  getClassName: (cls?: string | null) => string;
  getStudentPhoto: (student: Student) => string;
  managerName: string;
}

const normalizeClassToken = (cls?: string | null) =>
  String(cls || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^class-?/, '');

export const HallPassManagerView: React.FC<HallPassManagerViewProps> = ({
  students,
  feeRecords,
  config,
  onConfigChange,
  getClassName,
  getStudentPhoto,
  managerName,
}) => {
  const [selectedClass, setSelectedClass] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'eligible' | 'hold'>('all');
  const [showCutBorder, setShowCutBorder] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hasInitializedSelection, setHasInitializedSelection] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  // Available classes sorted naturally
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.Class) set.add(String(s.Class).trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // Compute fee & override eligibility for all students
  const allEligibility = useMemo(() => {
    return students
      .map((s) => computeStudentHallPassEligibility(s, feeRecords, config))
      .sort((a, b) => {
        const clsCmp = String(a.student.Class || '').localeCompare(String(b.student.Class || ''), undefined, {
          numeric: true,
        });
        if (clsCmp !== 0) return clsCmp;
        return String(a.student.Roll_Number || '').localeCompare(String(b.student.Roll_Number || ''), undefined, {
          numeric: true,
        });
      });
  }, [students, feeRecords, config]);

  // Visible filtered list
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const selTok = normalizeClassToken(selectedClass);

    return allEligibility.filter((item) => {
      if (selectedClass !== 'ALL' && normalizeClassToken(item.student.Class) !== selTok) {
        return false;
      }
      if (statusFilter === 'eligible' && !item.isEligible) return false;
      if (statusFilter === 'hold' && item.isEligible) return false;
      if (!q) return true;
      return (
        String(item.student.Student_Name || '').toLowerCase().includes(q) ||
        String(item.student.Student_ID || '').toLowerCase().includes(q) ||
        String(item.student.Roll_Number || '').toLowerCase().includes(q) ||
        String(item.student.Father_Name || '').toLowerCase().includes(q) ||
        String(item.student.Parent_Mobile || '').toLowerCase().includes(q)
      );
    });
  }, [allEligibility, selectedClass, statusFilter, searchQuery]);

  // Auto-select eligible students in current filter on first load or class switch
  useEffect(() => {
    if (!hasInitializedSelection && allEligibility.length > 0) {
      const eligibleIds = new Set(
        allEligibility.filter((i) => i.isEligible).map((i) => normalizeStudentId(i.student.Student_ID))
      );
      setSelectedIds(eligibleIds);
      setHasInitializedSelection(true);
    }
  }, [allEligibility, hasInitializedSelection]);

  const handleSelectEligibleInView = () => {
    const next = new Set<string>();
    filteredList.forEach((item) => {
      if (item.isEligible) {
        next.add(normalizeStudentId(item.student.Student_ID));
      }
    });
    setSelectedIds(next);
  };

  const handleSelectAllInView = () => {
    const next = new Set<string>();
    filteredList.forEach((item) => {
      next.add(normalizeStudentId(item.student.Student_ID));
    });
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const toggleStudentSelection = (studentId: string) => {
    const norm = normalizeStudentId(studentId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(norm)) next.delete(norm);
      else next.add(norm);
      return next;
    });
  };

  // Toggle manager override for a pending student and persist
  const handleToggleOverride = async (item: (typeof allEligibility)[number]) => {
    const normId = normalizeStudentId(item.student.Student_ID);
    const nextAllowed = !item.isManagerAllowed;
    const nextOverrides = { ...(config.allowedOverrides || {}) };
    if (nextAllowed) {
      nextOverrides[normId] = {
        allowed: true,
        note: 'Manager Permission',
        updatedBy: managerName,
        updatedAt: getLocalTimestamp(),
      };
    } else {
      delete nextOverrides[normId];
    }
    const nextConfig: HallPassConfig = {
      ...config,
      allowedOverrides: nextOverrides,
    };
    onConfigChange(nextConfig);

    // Sync selection state immediately
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (nextAllowed) next.add(normId);
      else if (item.dueAmount > 0) next.delete(normId);
      return next;
    });

    await saveHallPassConfigToServer(nextConfig);
  };

  const handleSaveSettings = async (nextPartial?: Partial<HallPassConfig>) => {
    const merged: HallPassConfig = {
      ...config,
      ...(nextPartial || {}),
    };
    onConfigChange(merged);
    setSavingConfig(true);
    setSaveNotice(null);
    await saveHallPassConfigToServer(merged);
    setSavingConfig(false);
    setSaveNotice('परीक्षा हॉल पास सेटिंग्स सेव हो गई हैं');
    setTimeout(() => setSaveNotice(null), 3000);
  };

  // Printable items matching current view & selection
  const printableItems = useMemo(() => {
    return filteredList.filter((item) => selectedIds.has(normalizeStudentId(item.student.Student_ID)));
  }, [filteredList, selectedIds]);

  // Strictly chunk into 9 cards per A4 page (3x3)
  const a4Pages = useMemo(() => chunkIntoPages(printableItems, 9), [printableItems]);

  // Generate QR codes offline-safe in batch for printable items
  useEffect(() => {
    let cancelled = false;
    const missing = printableItems.filter((item) => {
      const id = String(item.student.Student_ID || '').trim();
      return id && !qrMap[id];
    });
    if (missing.length === 0) return;

    (async () => {
      try {
        const mod = await import('qrcode');
        const QRCodeLib = mod.default || mod;
        const generated: Record<string, string> = {};
        for (const item of missing) {
          const sid = String(item.student.Student_ID || '').trim();
          if (!sid) continue;
          try {
            generated[sid] = await QRCodeLib.toDataURL(sid, {
              width: 140,
              margin: 1,
              color: { dark: '#0c2340', light: '#ffffff' },
            });
          } catch {}
        }
        if (!cancelled && Object.keys(generated).length > 0) {
          setQrMap((prev) => ({ ...prev, ...generated }));
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [printableItems, qrMap]);

  const handlePrint9PerA4 = () => {
    if (printableItems.length === 0) return;
    document.body.classList.add('printing-hall-passes');
    const cleanup = () => {
      document.body.classList.remove('printing-hall-passes');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 1500);
    }, 80);
  };

  const handleSendDueWhatsapp = (item: (typeof allEligibility)[number]) => {
    const mobile = String(item.student.Parent_Mobile || '').trim();
    if (!mobile) return;
    const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
    const msg =
      `*E.V.S. PUBLIC SCHOOL*\n` +
      `अभिभावक नमस्ते,\n` +
      `*${item.student.Student_Name}* (${getClassName(item.student.Class)}, Roll No: ${item.student.Roll_Number || '—'}) का *${examTitle}* का Hall Pass जारी होना है।\n` +
      `आपकी बकाया स्कूल फ़ीस *₹${item.dueAmount.toLocaleString('en-IN')}* शेष है। कृपया परीक्षा से पहले फ़ीस जमा कराएं ताकि Admit Card / Hall Pass समय पर जारी किया जा सके।`;
    openWhatsappAlert(mobile, msg, {
      alertType: 'Fee Due Reminder',
      recipientType: 'Parent',
      recipientId: item.student.Student_ID,
      recipientName: item.student.Student_Name,
      classOrRole: getClassName(item.student.Class),
      amount: item.dueAmount,
      sentBy: managerName,
    });
  };

  const summaryCounts = useMemo(() => {
    let eligible = 0;
    let hold = 0;
    let waived = 0;
    filteredList.forEach((i) => {
      if (i.isEligible) eligible++;
      else hold++;
      if (i.isFeeWaived) waived++;
    });
    return { total: filteredList.length, eligible, hold, waived };
  }, [filteredList]);

  return (
    <div className="space-y-4">
      {/* HEADER + PRIMARY PRINT ACTION */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              परीक्षा हॉल पास / एडमिट कार्ड (1 A4 पेज = 9 पास)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
              <span>{getExamDisplayTitle(config.examType, config.customExamTitle)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">सत्र {config.session}</span>
              <span aria-hidden="true">·</span>
              <span>3×3 A4 लेआउट (लगभग 65×93mm प्रति कार्ड)</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleSaveSettings()}
              disabled={savingConfig}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer transition-colors"
            >
              {savingConfig ? 'सेव हो रहा है...' : 'सेटिंग्स सेव करें'}
            </button>
            <button
              type="button"
              onClick={handlePrint9PerA4}
              disabled={printableItems.length === 0}
              className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-40 text-amber-300 text-xs font-black flex items-center gap-2 cursor-pointer transition-colors shadow-xs"
            >
              <i className="fa-solid fa-print"></i>
              <span className="tabular-nums">
                प्रिंट / PDF ({printableItems.length} कार्ड · {a4Pages.length} A4 पेज)
              </span>
            </button>
          </div>
        </div>

        {saveNotice && (
          <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            {saveNotice}
          </div>
        )}

        {/* EXAM CONFIGURATION CONTROLS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">परीक्षा प्रकार (Exam)</label>
            <select
              value={config.examType}
              onChange={(e) => handleSaveSettings({ examType: e.target.value as ExamTermType })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
            >
              <option value="Quarterly">Quarterly Examination (तिमाही)</option>
              <option value="Half-Yearly">Half-Yearly Examination (छमाही)</option>
              <option value="Annual">Annual Examination (सालाना)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">सत्र (Session)</label>
            <input
              type="text"
              value={config.session}
              onChange={(e) => onConfigChange({ ...config, session: e.target.value })}
              placeholder="2026-27"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 tabular-nums"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">तारीख / समय लाइन (Schedule)</label>
            <input
              type="text"
              value={config.examScheduleLine}
              onChange={(e) => onConfigChange({ ...config, examScheduleLine: e.target.value })}
              placeholder="Timing: 09:00 AM - 12:00 PM"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">निर्देश (Instruction Line)</label>
            <input
              type="text"
              value={config.instructionLine}
              onChange={(e) => onConfigChange({ ...config, instructionLine: e.target.value })}
              placeholder="Bring Hall Pass & School ID daily."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900"
            />
          </div>
        </div>

        {/* TOGGLES ROW */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={config.publishedToParent}
                onChange={(e) => handleSaveSettings({ publishedToParent: e.target.checked })}
                className="w-4 h-4 accent-[#0c2340] rounded"
              />
              <span>पेरेंट पोर्टल में भी दिखाएं (Eligible बच्चों के लिए)</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={showCutBorder}
                onChange={(e) => setShowCutBorder(e.target.checked)}
                className="w-4 h-4 accent-[#0c2340] rounded"
              />
              <span>कैंची से काटने की डॉटेड लाइन दिखाएं</span>
            </label>
          </div>

          <div className="text-xs text-slate-600 font-semibold tabular-nums flex items-center gap-2">
            <span>कुल: {summaryCounts.total}</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-700">Eligible: {summaryCounts.eligible}</span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-700">फ़ीस Hold: {summaryCounts.hold}</span>
            <span aria-hidden="true">·</span>
            <span>फीस माफी: {summaryCounts.waived}</span>
          </div>
        </div>
      </div>

      {/* FILTER + STUDENT SELECTION TABLE */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
            >
              <option value="ALL">सभी कक्षाएं (All Classes)</option>
              {availableClasses.map((cls) => (
                <option key={cls} value={cls}>
                  {getClassName(cls)} ({cls})
                </option>
              ))}
            </select>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="नाम, रोल नं, ID या मोबाइल खोजें..."
              className="px-3 py-2 rounded-xl border border-slate-300 text-xs w-56 text-slate-900"
            />

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                सभी
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('eligible')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  statusFilter === 'eligible' ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Eligible
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('hold')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  statusFilter === 'hold' ? 'bg-white text-rose-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                फ़ीस बाकी
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSelectEligibleInView}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              सभी Eligible चुनें
            </button>
            <button
              type="button"
              onClick={handleSelectAllInView}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer"
            >
              सभी चुनें ({filteredList.length})
            </button>
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold cursor-pointer"
            >
              चयन हटाएं
            </button>
          </div>
        </div>

        {/* Clean High-Density Eligibility Table */}
        <div className="overflow-x-auto max-h-80 border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold sticky top-0 border-b border-slate-200 z-10">
              <tr>
                <th className="py-2.5 px-3 w-10">चुनें</th>
                <th className="py-2.5 px-3">रोल नं / ID</th>
                <th className="py-2.5 px-3">छात्र व पिता का नाम</th>
                <th className="py-2.5 px-3">कक्षा</th>
                <th className="py-2.5 px-3">फ़ीस व पात्रता स्थिति</th>
                <th className="py-2.5 px-3 text-right">कार्रवाई (Override / Alert)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-semibold">
                    चुने गए फ़िल्टर में कोई छात्र नहीं मिला।
                  </td>
                </tr>
              ) : (
                filteredList.map((item) => {
                  const normId = normalizeStudentId(item.student.Student_ID);
                  const isChecked = selectedIds.has(normId);
                  return (
                    <tr key={item.student.Student_ID} className="hover:bg-slate-50/80">
                      <td className="py-2 px-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleStudentSelection(item.student.Student_ID)}
                          className="w-4 h-4 accent-[#0c2340] cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-3 tabular-nums font-bold text-slate-800 whitespace-nowrap">
                        #{item.student.Roll_Number || '—'} · {item.student.Student_ID}
                      </td>
                      <td className="py-2 px-3">
                        <div className="font-bold text-slate-900">{item.student.Student_Name}</div>
                        <div className="text-[11px] text-slate-500">S/o {item.student.Father_Name || '—'}</div>
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-700 whitespace-nowrap">
                        {getClassName(item.student.Class)}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap font-bold tabular-nums">
                        {item.status === 'CLEARED' && (
                          <span className="text-emerald-700">फ़ीस जमा (Cleared ✓)</span>
                        )}
                        {item.status === 'WAIVED' && (
                          <span className="text-teal-700">फ़ीस माफ (Waived ✓)</span>
                        )}
                        {item.status === 'OVERRIDE_ALLOWED' && (
                          <span className="text-amber-700">
                            विशेष अनुमति (Due ₹{item.dueAmount.toLocaleString('en-IN')})
                          </span>
                        )}
                        {item.status === 'FEE_HOLD' && (
                          <span className="text-rose-700">
                            फ़ीस बाकी · ₹{item.dueAmount.toLocaleString('en-IN')} Hold
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        {item.dueAmount > 0 ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleOverride(item)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                                item.isManagerAllowed
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200'
                                  : 'bg-[#0c2340] text-amber-300 hover:bg-blue-950'
                              }`}
                            >
                              {item.isManagerAllowed ? 'अनुमति हटाएं (Hold)' : 'Allow Pass (छूट)'}
                            </button>
                            {item.student.Parent_Mobile && (
                              <button
                                type="button"
                                onClick={() => handleSendDueWhatsapp(item)}
                                className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-[11px] font-bold cursor-pointer"
                                title="WhatsApp पर फ़ीस रिमाइंडर भेजें"
                              >
                                <i className="fa-brands fa-whatsapp"></i>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-semibold">स्वतः पात्र</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* LIVE 9-PER-A4 PRINT PREVIEW & ACTUAL PRINT ROOT */}
      <div className="space-y-4">
        <div className="no-print flex items-center justify-between px-1 text-xs text-slate-600 font-semibold">
          <span>
            A4 प्रिंट प्रीव्यू (प्रत्येक A4 पेज पर 3×3 ग्रिड में 9 हॉल पास)
          </span>
          <span className="tabular-nums">
            चयनित: {printableItems.length} कार्ड · {a4Pages.length} A4 शीट
          </span>
        </div>

        {a4Pages.length === 0 ? (
          <div className="no-print bg-white border border-slate-200 rounded-2xl p-10 text-center space-y-2">
            <p className="text-sm font-bold text-slate-700">प्रिंट के लिए कोई छात्र चयनित नहीं है</p>
            <p className="text-xs text-slate-500">
              ऊपर तालिका में से Eligible छात्र चुनें या बकाया छात्रों पर Allow Pass पर क्लिक करें।
            </p>
            <button
              type="button"
              onClick={handleSelectEligibleInView}
              className="mt-2 px-4 py-2 rounded-xl bg-[#0c2340] text-amber-300 text-xs font-bold cursor-pointer"
            >
              सभी Eligible छात्र चुनें
            </button>
          </div>
        ) : (
          <div id="printable-hall-passes-root" className="space-y-6 overflow-x-auto pb-2">
            {a4Pages.map((pageItems, pageIdx) => {
              // Pad partial last page cleanly to 9 grid slots so rows stay uniform height on A4
              const slots: Array<(typeof allEligibility)[number] | null> = [...pageItems];
              while (slots.length < 9) {
                slots.push(null);
              }
              return (
                <div key={`a4-page-${pageIdx}`} className="space-y-1.5">
                  <div className="no-print text-[11px] font-bold text-slate-500 tabular-nums px-1">
                    A4 शीट {pageIdx + 1} / {a4Pages.length} · {pageItems.length} हॉल पास
                  </div>
                  <div
                    className="hall-pass-a4-page bg-white border border-slate-300 shadow-sm mx-auto"
                    style={{
                      width: '200mm',
                      height: '286mm',
                      padding: '2mm',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
                      gap: '2.5mm',
                      boxSizing: 'border-box',
                    }}
                  >
                    {slots.map((slotItem, slotIdx) =>
                      slotItem ? (
                        <HallPassCard
                          key={slotItem.student.Student_ID}
                          item={slotItem}
                          config={config}
                          classNameLabel={getClassName(slotItem.student.Class)}
                          photoUrl={getStudentPhoto(slotItem.student)}
                          qrDataUrl={qrMap[String(slotItem.student.Student_ID || '').trim()]}
                          variant="a4_grid_9"
                          showCutBorder={showCutBorder}
                        />
                      ) : (
                        <div
                          key={`empty-slot-${pageIdx}-${slotIdx}`}
                          className={`hall-pass-slot rounded-[3px] ${
                            showCutBorder ? 'border border-dashed border-slate-200/70' : ''
                          }`}
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
