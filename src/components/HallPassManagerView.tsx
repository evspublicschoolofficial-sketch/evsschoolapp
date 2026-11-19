import React, { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { ExamTermType, FeeCollectionRecord, HallPassConfig, HallPassDatesheetRow, Student } from '../types';
import {
  chunkIntoPages,
  computeStudentHallPassEligibility,
  DATESHEET_CLASS_COLUMNS,
  DEFAULT_HALF_YEARLY_DATESHEET_ROWS,
  DEFAULT_HALL_PASS_CONFIG,
  getExamDisplayTitle,
  mapPageSlotsForBackside,
  saveHallPassConfigWithStatus,
} from '../utils/hallPassHelper';
import { normalizeStudentId } from '../utils/feeCalculation';
import { getLocalTimestamp } from '../utils/localTime';
import { openWhatsappAlert } from '../utils/whatsappReminders';
import { HallPassCard } from './HallPassCard';
import { HallPassDatesheetCard } from './HallPassDatesheetCard';
import { generateAndDownloadHallPassPdf, HallPassPdfMode } from '../utils/hallPassPdfGenerator';
import { GoogleSheetSyncModal } from './GoogleSheetSyncModal';

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
  const [showClassOnCard, setShowClassOnCard] = useState<boolean>(false);
  const [activeSideView, setActiveSideView] = useState<'front' | 'back' | 'duplex'>('front');
  const [showDatesheetEditor, setShowDatesheetEditor] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hasInitializedSelection, setHasInitializedSelection] = useState<boolean>(false);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [downloadingPdf, setDownloadingPdf] = useState<HallPassPdfMode | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [sheetSyncWarning, setSheetSyncWarning] = useState<string | null>(null);
  const [showSheetSetupModal, setShowSheetSetupModal] = useState<boolean>(false);
  const [qrMap, setQrMap] = useState<Record<string, string>>({});

  const flipMode = config.backsideFlipMode === 'row_flip' ? 'row_flip' : 'book_flip';
  const datesheetRows = useMemo(
    () =>
      Array.isArray(config.datesheetRows) && config.datesheetRows.length > 0
        ? config.datesheetRows
        : DEFAULT_HALF_YEARLY_DATESHEET_ROWS,
    [config.datesheetRows]
  );

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

  // Auto-select eligible students in current filter on first load
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

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (nextAllowed) next.add(normId);
      else if (item.dueAmount > 0) next.delete(normId);
      return next;
    });

    const res = await saveHallPassConfigWithStatus(nextConfig);
    if (res.sheetSynced) {
      setSheetSyncWarning(null);
      setSaveNotice(`✓ ${item.student.Student_Name} की अनुमति Google Sheet (Hall_Pass_Config) में सेव हो गई।`);
    } else {
      setSheetSyncWarning('सेटिंग्स ऐप में सेव हैं, लेकिन Google Sheet में सिंक करने के लिए Apps Script (New Version) अपडेट करें।');
    }
    setTimeout(() => setSaveNotice(null), 4000);
  };

  const handleSaveSettings = async (nextPartial?: Partial<HallPassConfig>) => {
    const merged: HallPassConfig = {
      ...config,
      ...(nextPartial || {}),
    };
    onConfigChange(merged);
    setSavingConfig(true);
    setSaveNotice(null);
    const res = await saveHallPassConfigWithStatus(merged);
    setSavingConfig(false);
    if (res.sheetSynced) {
      setSheetSyncWarning(null);
      setSaveNotice('✓ परीक्षा हॉल पास व Datesheet सेटिंग्स ऐप और Google Sheet (Hall_Pass_Config) दोनों में सेव हो गईं।');
    } else {
      setSaveNotice('✓ सेटिंग्स ऐप में सेव हो गई हैं।');
      setSheetSyncWarning(
        res.sheetError
          ? `Google Sheet (Hall_Pass_Config) सिंक लंबित: ${res.sheetError}`
          : 'Google Sheet में "Hall_Pass_Config" टैब चलाने हेतु एक बार Apps Script अपडेट करें।'
      );
    }
    setTimeout(() => setSaveNotice(null), 4500);
  };

  // Datesheet editing helpers
  const updateDatesheetMeta = (rowIdx: number, field: 'date' | 'day', value: string) => {
    const nextRows: HallPassDatesheetRow[] = datesheetRows.map((row, idx) =>
      idx === rowIdx ? { ...row, [field]: value } : row
    );
    onConfigChange({ ...config, datesheetRows: nextRows });
  };

  const updateDatesheetSubject = (rowIdx: number, classKey: string, value: string) => {
    const nextRows: HallPassDatesheetRow[] = datesheetRows.map((row, idx) =>
      idx === rowIdx
        ? {
            ...row,
            subjects: { ...(row.subjects || {}), [classKey]: value },
          }
        : row
    );
    onConfigChange({ ...config, datesheetRows: nextRows });
  };

  const handleAddDatesheetRow = () => {
    const emptySubjects: Record<string, string> = {};
    DATESHEET_CLASS_COLUMNS.forEach((col) => {
      emptySubjects[col] = '';
    });
    const nextRows: HallPassDatesheetRow[] = [
      ...datesheetRows,
      { date: '', day: '', subjects: emptySubjects },
    ];
    onConfigChange({ ...config, datesheetRows: nextRows });
  };

  const handleRemoveDatesheetRow = (rowIdx: number) => {
    if (datesheetRows.length <= 1) return;
    const nextRows = datesheetRows.filter((_, idx) => idx !== rowIdx);
    onConfigChange({ ...config, datesheetRows: nextRows });
  };

  const handleResetHalfYearlyPreset = () => {
    handleSaveSettings({
      examType: 'Half-Yearly',
      datesheetRows: DEFAULT_HALF_YEARLY_DATESHEET_ROWS,
      datesheetArrivalLine: DEFAULT_HALL_PASS_CONFIG.datesheetArrivalLine,
      datesheetHolidayNote: DEFAULT_HALL_PASS_CONFIG.datesheetHolidayNote,
      examScheduleLine: DEFAULT_HALL_PASS_CONFIG.examScheduleLine,
    });
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
              width: 240,
              margin: 1,
              color: { dark: '#000000', light: '#ffffff' },
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

  const handlePrintMode = (mode: 'front' | 'back' | 'duplex') => {
    if (printableItems.length === 0) return;

    flushSync(() => {
      setActiveSideView(mode);
    });

    // Force @page margin to minimal 2.5mm so 9 cards fill A4 edge-to-edge without wasted white borders
    let pageStyleEl = document.getElementById('evs-hallpass-print-page-style') as HTMLStyleElement | null;
    if (!pageStyleEl) {
      pageStyleEl = document.createElement('style');
      pageStyleEl.id = 'evs-hallpass-print-page-style';
      document.head.appendChild(pageStyleEl);
    }
    pageStyleEl.textContent = `@media print { @page { size: A4 portrait; margin: 2.5mm !important; } }`;

    document.body.classList.add('printing-hall-passes');
    const cleanup = () => {
      document.body.classList.remove('printing-hall-passes');
      document.getElementById('evs-hallpass-print-page-style')?.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2000);
    }, 80);
  };

  const handleDownloadPdf = async (mode: HallPassPdfMode) => {
    if (printableItems.length === 0 || downloadingPdf) return;
    setDownloadingPdf(mode);
    setActiveSideView(mode);
    try {
      const { filename, pageCount } = await generateAndDownloadHallPassPdf({
        items: printableItems,
        config,
        mode,
        getClassName,
        getStudentPhoto,
        qrMap,
        showCutBorder,
        showClassOnCard,
      });
      setSaveNotice(`PDF डाउनलोड तैयार: ${filename} (${pageCount} A4 पेज) — अपने फोन/कंप्यूटर के Downloads में खोलकर प्रिंट करें।`);
      setTimeout(() => setSaveNotice(null), 6000);
    } catch {
      setSaveNotice('PDF बनाने में समस्या आई, कृपया ब्राउज़र प्रिंट बटन का उपयोग करें।');
      setTimeout(() => setSaveNotice(null), 5000);
    } finally {
      setDownloadingPdf(null);
    }
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

  // Flat list of A4 print sheets to output depending on activeSideView
  const renderSheets = useMemo(() => {
    const sheets: Array<{
      key: string;
      side: 'front' | 'back';
      pageNumber: number;
      studentCount: number;
      slots: Array<(typeof allEligibility)[number] | null>;
    }> = [];

    a4Pages.forEach((pageItems, pageIdx) => {
      const paddedSlots: Array<(typeof allEligibility)[number] | null> = [...pageItems];
      while (paddedSlots.length < 9) {
        paddedSlots.push(null);
      }

      if (activeSideView === 'front' || activeSideView === 'duplex') {
        sheets.push({
          key: `front-page-${pageIdx}`,
          side: 'front',
          pageNumber: pageIdx + 1,
          studentCount: pageItems.length,
          slots: paddedSlots,
        });
      }

      if (activeSideView === 'back' || activeSideView === 'duplex') {
        sheets.push({
          key: `back-page-${pageIdx}`,
          side: 'back',
          pageNumber: pageIdx + 1,
          studentCount: pageItems.length,
          slots: mapPageSlotsForBackside(paddedSlots, flipMode),
        });
      }
    });

    return sheets;
  }, [a4Pages, activeSideView, flipMode]);

  return (
    <div className="space-y-4">
      {/* HEADER + 1-SIDED PRINTER WORKFLOW ACTIONS */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              परीक्षा हॉल पास + बैकसाइड Datesheet (1 A4 पेज = 9 पास)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
              <span>{getExamDisplayTitle(config.examType, config.customExamTitle)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">सत्र {config.session}</span>
              <span aria-hidden="true">·</span>
              <span>फुल A4 3×3 ग्रिड (आगे Hall Pass · पीछे बच्चे की कक्षा की Datesheet)</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSheetSetupModal(true)}
              className="px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-xs font-bold cursor-pointer transition-colors inline-flex items-center gap-1.5"
              title="Google Sheet में Hall_Pass_Config टैब जोड़ने का Apps Script कोड देखें"
            >
              <i className="fa-solid fa-table"></i>
              <span>शीट टैब सेटअप</span>
            </button>
            <button
              type="button"
              onClick={() => handleSaveSettings()}
              disabled={savingConfig}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold cursor-pointer transition-colors"
            >
              {savingConfig ? 'सेव हो रहा है...' : 'सेटिंग्स सेव करें'}
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPdf('front')}
              disabled={printableItems.length === 0 || Boolean(downloadingPdf)}
              className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-40 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
            >
              <i className="fa-solid fa-file-arrow-down"></i>
              <span className="tabular-nums">
                {downloadingPdf === 'front'
                  ? 'PDF बन रही है...'
                  : `Step 1: आगे PDF डाउनलोड (${a4Pages.length} पेज)`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPdf('back')}
              disabled={printableItems.length === 0 || Boolean(downloadingPdf)}
              className="px-3.5 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
            >
              <i className="fa-solid fa-file-arrow-down"></i>
              <span className="tabular-nums">
                {downloadingPdf === 'back'
                  ? 'PDF बन रही है...'
                  : `Step 2: पीछे Datesheet PDF (${a4Pages.length} पेज)`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPdf('duplex')}
              disabled={printableItems.length === 0 || Boolean(downloadingPdf)}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
              title="आगे और पीछे दोनों पेज एक ही PDF फ़ाइल में डाउनलोड करें"
            >
              <i className="fa-solid fa-file-pdf"></i>
              <span>{downloadingPdf === 'duplex' ? 'बन रही है...' : 'दोनों साथ PDF'}</span>
            </button>
          </div>
        </div>

        {/* DIRECT BROWSER PRINT + 1-SIDED PRINTER FLIP & PAPER FEED GUIDE */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-3.5 space-y-2.5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1 text-xs">
              <div className="font-black text-slate-900 flex items-center gap-1.5">
                <i className="fa-solid fa-print text-[#0c2340]"></i>
                <span>प्रिंट और PDF डाउनलोड तरीका (1-साइड प्रिंटर के लिए):</span>
              </div>
              <p className="text-slate-700 leading-relaxed">
                1. ऊपर नीले <strong>Step 1 (आगे PDF डाउनलोड)</strong> बटन से फ़ाइल डाउनलोड करें व प्रिंट निकालें (या नीचे <strong>प्रिंट आगे</strong> दबाएं)।{' '}
                2. निकले कागज़ को{' '}
                <strong>
                  {flipMode === 'book_flip'
                    ? 'किताब की तरह बायाँ ↔ दायाँ पलटकर वापस ट्रे में डालें (ऊपर वाला हिस्सा ऊपर रहे)'
                    : 'ऊपर से नीचे (↑↓) पलटकर वापस ट्रे में डालें'}
                </strong>
                । 3. पीले <strong>Step 2 (पीछे Datesheet PDF)</strong> से प्रिंट करें — हर कार्ड के ठीक पीछे उसी बच्चे की Datesheet आ जाएगी।
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0 bg-white p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => handleSaveSettings({ backsideFlipMode: 'book_flip' })}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold cursor-pointer transition-colors ${
                  flipMode === 'book_flip'
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                बायाँ ↔ दायाँ पलटें (किताब जैसा)
              </button>
              <button
                type="button"
                onClick={() => handleSaveSettings({ backsideFlipMode: 'row_flip' })}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold cursor-pointer transition-colors ${
                  flipMode === 'row_flip'
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ऊपर ↕ नीचे पलटें
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80 text-[11px]">
            <span className="text-slate-600 font-semibold">
              कंप्यूटर से सीधे प्रिंट करने के लिए (डायरेक्ट ब्राउज़र प्रिंट):
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handlePrintMode('front')}
                disabled={printableItems.length === 0}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-800 font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-print"></i>
                <span>प्रिंट आगे</span>
              </button>
              <button
                type="button"
                onClick={() => handlePrintMode('back')}
                disabled={printableItems.length === 0}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-800 font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-print"></i>
                <span>प्रिंट पीछे (Datesheet)</span>
              </button>
              <button
                type="button"
                onClick={() => handlePrintMode('duplex')}
                disabled={printableItems.length === 0}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 text-slate-800 font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-copy"></i>
                <span>प्रिंट दोनों</span>
              </button>
            </div>
          </div>
        </div>

        {saveNotice && (
          <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            {saveNotice}
          </div>
        )}

        {sheetSyncWarning && (
          <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{sheetSyncWarning}</span>
            <button
              type="button"
              onClick={() => setShowSheetSetupModal(true)}
              className="px-3 py-1 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-[11px] font-bold cursor-pointer"
            >
              शीट सेटअप कोड देखें
            </button>
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
              placeholder="Exam: 09:30 AM - 12:00 PM (2.5 Hrs)"
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

        {/* TOGGLES ROW + DATESHEET EDITOR EXPANDER */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={config.publishedToParent}
                onChange={(e) => handleSaveSettings({ publishedToParent: e.target.checked })}
                className="w-4 h-4 accent-[#0c2340] rounded"
              />
              <span>पेरेंट पोर्टल में हॉल पास + Datesheet दिखाएं</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={showCutBorder}
                onChange={(e) => setShowCutBorder(e.target.checked)}
                className="w-4 h-4 accent-[#0c2340] rounded"
              />
              <span>काटने की डॉटेड लाइन दिखाएं</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={showClassOnCard}
                onChange={(e) => setShowClassOnCard(e.target.checked)}
                className="w-4 h-4 accent-[#0c2340] rounded"
              />
              <span>आगे क्लास दिखाएं</span>
            </label>

            <button
              type="button"
              onClick={() => setShowDatesheetEditor((prev) => !prev)}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 font-bold cursor-pointer inline-flex items-center gap-1.5"
            >
              <i className={`fa-solid ${showDatesheetEditor ? 'fa-chevron-up' : 'fa-pen-to-square'}`}></i>
              <span>{showDatesheetEditor ? 'Datesheet संपादन बंद करें' : 'Datesheet / विषय संपादित करें'}</span>
            </button>
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

        {/* COLLAPSIBLE BACKSIDE DATESHEET EDITOR */}
        {showDatesheetEditor && (
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs sm:text-sm font-black text-slate-900">
                  बैकसाइड Datesheet तालिका (M1 से Class 8 तक)
                </h3>
                <p className="text-[11px] text-slate-500">
                  हर बच्चे के हॉल पास के पीछे उसकी कक्षा (जैसे M1, Class 1, Class 6 &amp; 7) की यही Datesheet प्रिंट होगी।
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetHalfYearlyPreset}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-950 text-[11px] font-bold cursor-pointer"
                >
                  छमाही PDF (23 Nov - 03 Dec) रीसेट करें
                </button>
                <button
                  type="button"
                  onClick={handleAddDatesheetRow}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-[11px] font-bold cursor-pointer"
                >
                  + नई तिथि जोड़ें
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveSettings()}
                  disabled={savingConfig}
                  className="px-3 py-1.5 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-[11px] font-bold cursor-pointer"
                >
                  Datesheet सेव करें
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  Datesheet आगमन व परीक्षा समय (Arrival / Exam Line)
                </label>
                <input
                  type="text"
                  value={config.datesheetArrivalLine || ''}
                  onChange={(e) => onConfigChange({ ...config, datesheetArrivalLine: e.target.value })}
                  placeholder="Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1">
                  छुट्टी नोट (Holidays Note)
                </label>
                <input
                  type="text"
                  value={config.datesheetHolidayNote || ''}
                  onChange={(e) => onConfigChange({ ...config, datesheetHolidayNote: e.target.value })}
                  placeholder="24/11 Tue: Guru Nanak Jayanti Holiday · 29/11 Sun: Sunday Off"
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-900"
                />
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead className="bg-slate-100 text-slate-700 font-black border-b border-slate-200">
                  <tr>
                    <th className="p-2 whitespace-nowrap">Date</th>
                    <th className="p-2 whitespace-nowrap">Day</th>
                    {DATESHEET_CLASS_COLUMNS.map((clsKey) => (
                      <th key={clsKey} className="p-2 whitespace-nowrap min-w-[96px]">
                        {clsKey}
                      </th>
                    ))}
                    <th className="p-2 text-center">हटाएं</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {datesheetRows.map((row, rowIdx) => (
                    <tr key={`ds-row-${rowIdx}`} className="bg-white hover:bg-slate-50/70">
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={row.date}
                          onChange={(e) => updateDatesheetMeta(rowIdx, 'date', e.target.value)}
                          placeholder="23/11/2026"
                          className="w-24 px-2 py-1 rounded border border-slate-300 font-bold text-slate-900 tabular-nums"
                        />
                      </td>
                      <td className="p-1.5">
                        <input
                          type="text"
                          value={row.day}
                          onChange={(e) => updateDatesheetMeta(rowIdx, 'day', e.target.value)}
                          placeholder="Mon"
                          className="w-14 px-2 py-1 rounded border border-slate-300 font-semibold text-slate-800"
                        />
                      </td>
                      {DATESHEET_CLASS_COLUMNS.map((clsKey) => (
                        <td key={clsKey} className="p-1.5">
                          <input
                            type="text"
                            value={row.subjects?.[clsKey] || ''}
                            onChange={(e) => updateDatesheetSubject(rowIdx, clsKey, e.target.value)}
                            className="w-full min-w-[88px] px-2 py-1 rounded border border-slate-300 font-semibold text-slate-900"
                          />
                        </td>
                      ))}
                      <td className="p-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveDatesheetRow(rowIdx)}
                          disabled={datesheetRows.length <= 1}
                          className="px-2 py-1 rounded text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                          title="पंक्ति हटाएं"
                        >
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
        <div className="no-print flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-600 font-semibold">
          <div className="flex flex-wrap items-center gap-2">
            <span>A4 प्रिंट प्रीव्यू:</span>
            <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveSideView('front')}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  activeSideView === 'front' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                आगे: Hall Pass
              </button>
              <button
                type="button"
                onClick={() => setActiveSideView('back')}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  activeSideView === 'back' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                पीछे: Datesheet (Mirrored)
              </button>
              <button
                type="button"
                onClick={() => setActiveSideView('duplex')}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  activeSideView === 'duplex' ? 'bg-[#0c2340] text-amber-300' : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                दोनों साथ देखें
              </button>
            </div>
          </div>
          <span className="tabular-nums">
            चयनित: {printableItems.length} कार्ड · {a4Pages.length} A4 शीट ({renderSheets.length} प्रिंट पेज)
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
          <div
            id="printable-hall-passes-root"
            className="space-y-6 overflow-x-auto pb-2 print:space-y-0 print:overflow-visible print:pb-0"
          >
            {renderSheets.map((sheet) => (
              <div key={sheet.key} className="hall-pass-page-wrap space-y-1.5 print:space-y-0">
                <div className="no-print flex items-center justify-between text-[11px] font-bold px-1">
                  <span className={sheet.side === 'back' ? 'text-amber-800' : 'text-slate-600'}>
                    {sheet.side === 'front'
                      ? `आगे (FRONT: HALL PASS) · A4 शीट ${sheet.pageNumber} / ${a4Pages.length} · ${sheet.studentCount} कार्ड`
                      : `पीछे (BACK: DATESHEET · MIRRORED ${
                          flipMode === 'book_flip' ? 'बायाँ↔दायाँ' : 'ऊपर↕नीचे'
                        }) · A4 शीट ${sheet.pageNumber} / ${a4Pages.length}`}
                  </span>
                </div>
                <div
                  className="hall-pass-a4-page bg-white border border-slate-300 shadow-sm mx-auto"
                  style={{
                    width: '205mm',
                    height: '291mm',
                    padding: '0',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
                    gap: '1.2mm',
                    boxSizing: 'border-box',
                  }}
                >
                  {sheet.slots.map((slotItem, slotIdx) =>
                    slotItem ? (
                      sheet.side === 'front' ? (
                        <HallPassCard
                          key={`front-${slotItem.student.Student_ID}`}
                          item={slotItem}
                          config={config}
                          classNameLabel={getClassName(slotItem.student.Class)}
                          photoUrl={getStudentPhoto(slotItem.student)}
                          qrDataUrl={qrMap[String(slotItem.student.Student_ID || '').trim()]}
                          variant="a4_grid_9"
                          showCutBorder={showCutBorder}
                          showClassOnCard={showClassOnCard}
                        />
                      ) : (
                        <HallPassDatesheetCard
                          key={`back-${slotItem.student.Student_ID}`}
                          item={slotItem}
                          config={config}
                          classNameLabel={getClassName(slotItem.student.Class)}
                          variant="a4_grid_9"
                          showCutBorder={showCutBorder}
                        />
                      )
                    ) : (
                      <div
                        key={`empty-slot-${sheet.key}-${slotIdx}`}
                        className={`hall-pass-slot rounded-[2px] ${
                          showCutBorder ? 'border border-dashed border-slate-200/70' : ''
                        }`}
                      />
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <GoogleSheetSyncModal
        isOpen={showSheetSetupModal}
        onClose={() => setShowSheetSetupModal(false)}
      />
    </div>
  );
};
