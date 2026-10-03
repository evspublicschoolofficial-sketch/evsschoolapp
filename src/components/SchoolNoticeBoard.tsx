import React, { useState, useEffect, useMemo } from 'react';
import { SchoolNotice } from '../types';
import {
  startEmergencySiren,
  stopEmergencySiren,
  playEmergencyChime,
} from '../utils/sirenAudio';
import {
  syncNoticesToGoogleSheet,
  fetchNoticesFromGoogleSheet,
} from '../utils/feeMaster';
import { getAppsScriptUrl } from '../utils/busTrackingService';
import { realtimeSync } from '../utils/realtimeSync';

interface SchoolNoticeBoardProps {
  isManager?: boolean;
  isTeacher?: boolean;
  schoolName?: string;
  onNoticeCountChange?: (count: number) => void;
  notices?: SchoolNotice[];
  onNoticesUpdate?: (notices: SchoolNotice[]) => void;
  className?: string;
}

export const DEFAULT_SEED_NOTICES: SchoolNotice[] = [
  {
    id: 'not-emerg-01',
    title: 'अति आवश्यक: मौसम विभाग की चेतावनी - भारी वर्षा अलर्ट (Emergency Weather Alert)',
    date: '2026-10-01',
    category: 'emergency',
    description: 'जिला प्रशासन व मौसम विभाग के निर्देशानुसार भारी वर्षा व तेज आंधी की चेतावनी के मद्देनजर आज विद्यालय समय से 1 घंटा पूर्व बंद रहेगा। सभी वैन व बसें सुरक्षित बच्चों को पहुंचाएंगी। अभिभावक कृपया ध्यान दें।',
    targetClass: 'All',
    issuedBy: 'प्रधानाचार्य (Principal)',
    isPinned: true,
    isEmergency: true,
  },
  {
    id: 'not-01',
    title: 'दशहरा व विजयदशमी अवकाश सूचना (Dussehra & Vijayadashami Holidays)',
    date: '2026-10-18',
    category: 'holiday',
    description: 'समस्त विद्यार्थियों व अभिभावकों को सूचित किया जाता है कि दशहरा व विजयदशमी के पावन अवसर पर विद्यालय में दिनांक 19 अक्टूबर से 21 अक्टूबर तक अवकाश रहेगा। विद्यालय 22 अक्टूबर को समयानुसार पुनः खुलेगा।',
    targetClass: 'All',
    issuedBy: 'प्रधानाचार्य (Principal)',
    isPinned: true,
  },
  {
    id: 'not-02',
    title: 'अर्धवार्षिक परीक्षा समय-सारणी घोषित (Half-Yearly Exam Datesheet Released)',
    date: '2026-10-10',
    category: 'exam',
    description: 'कक्षा 1 से 10 तक के सभी छात्रों के लिए अर्धवार्षिक परीक्षा (Half-Yearly Examination) 5 नवंबर से आयोजित की जाएगी। विस्तृत विषयवार समय-सारणी छात्र डायरी व पोर्टल पर उपलब्ध करा दी गई है। सभी छात्र पूर्ण तैयारी रखें।',
    targetClass: 'All',
    issuedBy: 'परीक्षा नियंत्रक (Exam Controller)',
    isPinned: true,
  },
  {
    id: 'not-03',
    title: 'अभिभावक-शिक्षक बैठक (Parent-Teacher Meeting - PTM)',
    date: '2026-10-05',
    category: 'ptm',
    description: 'माह अक्टूबर की अभिभावक-शिक्षक संगोष्ठी आगामी शनिवार को प्रातः 09:00 बजे से दोपहर 12:30 बजे तक आयोजित होगी। सभी अभिभावकों से सादर अनुरोध है कि अपने पाल्य की प्रगति व व्यवहार पर चर्चा हेतु अनिवार्यतः उपस्थित हों।',
    targetClass: 'All',
    issuedBy: 'ई.वी.एस. स्कूल प्रबंधन',
    isPinned: false,
  },
  {
    id: 'not-04',
    title: 'शीतकालीन वर्दी नियम (Winter Uniform Advisory Notice)',
    date: '2026-11-01',
    category: 'general',
    description: 'मौसम में बदलाव को ध्यान में रखते हुए 15 नवंबर से सभी विद्यार्थियों के लिए विद्यालय की निर्धारित शीतकालीन वर्दी (नेवी ब्लू स्वेटर/ब्लेज़र व टाई) पहनकर आना अनिवार्य होगा।',
    targetClass: 'All',
    issuedBy: 'अनुशासन समिति',
    isPinned: false,
  },
];

export const SchoolNoticeBoard: React.FC<SchoolNoticeBoardProps> = ({
  isManager = false,
  isTeacher = false,
  schoolName = 'E.V.S. PUBLIC SCHOOL',
  onNoticeCountChange,
  notices: propNotices,
  onNoticesUpdate,
  className = '',
}) => {
  const [internalNotices, setInternalNotices] = useState<SchoolNotice[]>(() => {
    try {
      const stored = localStorage.getItem('evs_school_notices');
      if (stored !== null) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Could not read stored notices:', e);
    }
    return DEFAULT_SEED_NOTICES;
  });

  const notices = propNotices || internalNotices;

  const setNotices = (updater: React.SetStateAction<SchoolNotice[]>) => {
    const nextNotices = typeof updater === 'function' ? updater(notices) : updater;
    setInternalNotices(nextNotices);
    try {
      localStorage.setItem('evs_school_notices', JSON.stringify(nextNotices));
    } catch (e) {}
    if (onNoticesUpdate) {
      onNoticesUpdate(nextNotices);
    }
  };

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [noticeToDelete, setNoticeToDelete] = useState<SchoolNotice | null>(null);
  const [deleteToast, setDeleteToast] = useState<string | null>(null);
  const [playingSirenNoticeId, setPlayingSirenNoticeId] = useState<string | null>(null);
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [sheetSyncMsg, setSheetSyncMsg] = useState<string | null>(null);

  // Form State for Adding Notice
  const [newTitle, setNewTitle] = useState<string>('');
  const [newCategory, setNewCategory] = useState<SchoolNotice['category']>('general');
  const [newDate, setNewDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newTargetClass, setNewTargetClass] = useState<string>('All');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newIsPinned, setNewIsPinned] = useState<boolean>(false);
  const [newIsEmergency, setNewIsEmergency] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem('evs_school_notices', JSON.stringify(notices));
    } catch (e) {
      console.warn('Failed saving notices to localStorage:', e);
    }
    if (onNoticeCountChange) {
      onNoticeCountChange(notices.length);
    }
  }, [notices, onNoticeCountChange]);

  useEffect(() => {
    return () => {
      stopEmergencySiren();
    };
  }, []);

  // Fetch notices from Google Sheet (Option B) on mount and on real-time update
  useEffect(() => {
    let isMounted = true;
    const fetchLatestNotices = async () => {
      try {
        const url = getAppsScriptUrl();
        const sheetNotices = await fetchNoticesFromGoogleSheet(url);
        if (isMounted && sheetNotices && sheetNotices.length > 0) {
          setNotices(sheetNotices);
        }
      } catch (e) {
        // silent fallback to local/seed
      }
    };
    fetchLatestNotices();

    // Subscribe to cross-tab / cross-device real-time updates for notices
    const unsubscribe = realtimeSync.subscribe((event) => {
      if (event.entity === 'notice' || event.entity === 'all') {
        // Re-read from localStorage or Google Sheet
        try {
          const stored = localStorage.getItem('evs_school_notices');
          if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && isMounted) {
              setNotices(parsed);
              return;
            }
          }
        } catch {}
        fetchLatestNotices();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const handleSyncToSheet = async () => {
    setIsSyncingSheet(true);
    setSheetSyncMsg(null);
    try {
      const url = getAppsScriptUrl();
      const res = await syncNoticesToGoogleSheet(notices, url);
      if (res.success) {
        setSheetSyncMsg('✅ Google Sheet में "School_Notices" शीट सफलतापूर्वक अपडेट हो गई!');
      } else {
        setSheetSyncMsg(`⚠️ नोट: ${res.message || 'लोकल में सुरक्षित'}`);
      }
    } catch (e: any) {
      setSheetSyncMsg('⚠️ सिंक त्रुटि: कृपया Apps Script लिंक जांचें');
    } finally {
      setIsSyncingSheet(false);
      setTimeout(() => setSheetSyncMsg(null), 4000);
    }
  };

  const handleFetchFromSheet = async () => {
    setIsSyncingSheet(true);
    setSheetSyncMsg(null);
    try {
      const url = getAppsScriptUrl();
      const sheetNotices = await fetchNoticesFromGoogleSheet(url);
      if (sheetNotices && sheetNotices.length > 0) {
        setNotices(sheetNotices);
        setSheetSyncMsg(`✅ Google Sheet से ${sheetNotices.length} नोटिस लोड किए गए!`);
      } else {
        setSheetSyncMsg('ℹ️ Google Sheet में कोई अतिरिक्त नोटिस नहीं मिले');
      }
    } catch (e) {
      setSheetSyncMsg('⚠️ Google Sheet से लोड करने में त्रुटि');
    } finally {
      setIsSyncingSheet(false);
      setTimeout(() => setSheetSyncMsg(null), 4000);
    }
  };

  const filteredNotices = useMemo(() => {
    return notices
      .filter((n) => {
        if (activeCategory === 'emergency') {
          return n.category === 'emergency' || n.isEmergency === true;
        }
        if (activeCategory !== 'all' && n.category !== activeCategory) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          return (
            n.title.toLowerCase().includes(q) ||
            n.description.toLowerCase().includes(q) ||
            (n.issuedBy && n.issuedBy.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => {
        // Emergency first, then Pinned, then by date descending
        const aEmerg = a.isEmergency || a.category === 'emergency';
        const bEmerg = b.isEmergency || b.category === 'emergency';
        if (aEmerg && !bEmerg) return -1;
        if (!aEmerg && bEmerg) return 1;
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
  }, [notices, activeCategory, searchTerm]);

  const handleAddNotice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDescription.trim()) return;

    const notice: SchoolNotice = {
      id: 'not-' + Date.now().toString().slice(-6),
      title: newTitle.trim(),
      date: newDate || new Date().toISOString().slice(0, 10),
      category: newIsEmergency ? 'emergency' : newCategory,
      description: newDescription.trim(),
      targetClass: newTargetClass || 'All',
      issuedBy: isManager ? 'स्कूल प्रबंधन (Management)' : 'शिक्षक वर्ग (Teacher)',
      isPinned: newIsEmergency ? true : newIsPinned,
      isEmergency: newIsEmergency,
    };

    const nextList = [notice, ...notices];
    setNotices(nextList);
    setIsAddModalOpen(false);
    setNewTitle('');
    setNewDescription('');
    setNewIsPinned(false);
    setNewIsEmergency(false);

    // Option B: Auto-sync to Google Sheet School_Notices
    try {
      const url = getAppsScriptUrl();
      syncNoticesToGoogleSheet(nextList, url);
    } catch (err) {
      console.warn('Google Sheet notice auto-sync note:', err);
    }

    // Broadcast real-time update to all tabs and devices
    realtimeSync.broadcastUpdate('notice', 'addNotice', notice);
  };

  const handleDeleteNotice = (id: string) => {
    const target = notices.find((n) => n.id === id);
    if (target) {
      setNoticeToDelete(target);
    }
  };

  const confirmDeleteNotice = () => {
    if (!noticeToDelete) return;
    const targetId = noticeToDelete.id;
    const targetTitle = noticeToDelete.title;
    const nextList = notices.filter((n) => n.id !== targetId);
    setNotices(nextList);
    setNoticeToDelete(null);
    setDeleteToast(`सूचना "${targetTitle}" सफलतापूर्वक हटा दी गई है।`);
    setTimeout(() => setDeleteToast(null), 3500);

    // Option B: Auto-sync updated notices to Google Sheet
    try {
      const url = getAppsScriptUrl();
      syncNoticesToGoogleSheet(nextList, url);
    } catch (err) {
      console.warn('Google Sheet notice auto-sync note:', err);
    }

    // Broadcast real-time update to all tabs and devices
    realtimeSync.broadcastUpdate('notice', 'deleteNotice', { id: targetId });
  };

  const handleShareOnWhatsApp = (notice: SchoolNotice) => {
    const isEmerg = notice.isEmergency || notice.category === 'emergency';
    const text = isEmerg
      ? `*🚨 ${schoolName} - अत्यंत महत्वपूर्ण व आपातकालीन सूचना (EMERGENCY NOTICE) 🚨*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 *${notice.title}*\n` +
        `📅 *दिनांक:* ${notice.date}\n` +
        `🏫 *कक्षा:* ${notice.targetClass || 'सभी कक्षाएं (All Classes)'}\n` +
        `✍️ *जारीकर्ता:* ${notice.issuedBy || 'विद्यालय कार्यालय'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${notice.description}\n\n` +
        `⚠️ *सभी अभिभावक कृपया तत्काल संज्ञान लें।*`
      : `*🏛️ ${schoolName}*\n` +
        `*📢 स्कूल आधिकारिक सूचना (Official Circular)*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📌 *${notice.title}*\n` +
        `📅 *दिनांक:* ${notice.date}\n` +
        `🏫 *कक्षा:* ${notice.targetClass || 'सभी कक्षाएं (All Classes)'}\n` +
        `✍️ *जारीकर्ता:* ${notice.issuedBy || 'विद्यालय कार्यालय'}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${notice.description}\n\n` +
        `_ई.वी.एस. पब्लिक स्कूल वेब पोर्टल से प्रेषित_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const categoryBadges: Record<
    SchoolNotice['category'],
    { label: string; icon: string; bg: string; text: string; border: string }
  > = {
    emergency: {
      label: '🚨 आपातकालीन (Emergency Siren)',
      icon: 'fa-triangle-exclamation',
      bg: 'bg-rose-100',
      text: 'text-rose-950 font-black',
      border: 'border-rose-400',
    },
    urgent: {
      label: 'आवश्यक (Urgent)',
      icon: 'fa-bell',
      bg: 'bg-rose-50',
      text: 'text-rose-900',
      border: 'border-rose-200',
    },
    holiday: {
      label: 'अवकाश (Holiday)',
      icon: 'fa-umbrella-beach',
      bg: 'bg-emerald-50',
      text: 'text-emerald-800',
      border: 'border-emerald-200',
    },
    exam: {
      label: 'परीक्षा (Exam)',
      icon: 'fa-file-signature',
      bg: 'bg-blue-50',
      text: 'text-blue-900',
      border: 'border-blue-200',
    },
    ptm: {
      label: 'पी.टी.एम. (PTM)',
      icon: 'fa-users',
      bg: 'bg-purple-50',
      text: 'text-purple-900',
      border: 'border-purple-200',
    },
    event: {
      label: 'कार्यक्रम (Event)',
      icon: 'fa-trophy',
      bg: 'bg-amber-50',
      text: 'text-amber-900',
      border: 'border-amber-200',
    },
    general: {
      label: 'सामान्य (General)',
      icon: 'fa-bullhorn',
      bg: 'bg-slate-100',
      text: 'text-slate-800',
      border: 'border-slate-200',
    },
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Top Banner / Actions Bar */}
      <div className="bg-gradient-to-br from-[#0c2340] via-[#10316b] to-[#0c2340] rounded-2xl p-4 sm:p-5 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md border border-blue-900">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-xl shadow-lg border border-amber-300">
            <i className="fa-solid fa-bullhorn"></i>
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-amber-300 flex items-center gap-2">
              <span>स्कूल सूचना पट्ट एवं अवकाश (Notice Board & Holidays)</span>
            </h3>
            <p className="text-xs text-blue-200">
              छुट्टियाँ, परीक्षा कार्यक्रम, पीटीएम व विद्यालय की महत्वपूर्ण घोषणाएँ
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(isManager || isTeacher) && (
            <>
              <button
                type="button"
                onClick={handleSyncToSheet}
                disabled={isSyncingSheet}
                title="Google Sheet में 'School_Notices' टैब में सभी सूचनाएं सिंक करें"
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs flex items-center gap-1.5 border border-white/20 shadow-xs cursor-pointer transition-colors active:scale-95 disabled:opacity-50 shrink-0"
              >
                <i className={`fa-solid ${isSyncingSheet ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-amber-300`}></i>
                <span>{isSyncingSheet ? 'सिंक हो रहा है...' : 'Sheet में सहेजें (Option B)'}</span>
              </button>

              <button
                type="button"
                onClick={handleFetchFromSheet}
                disabled={isSyncingSheet}
                title="Google Sheet 'School_Notices' से ताज़ा नोटिस लोड करें"
                className="px-3 py-2 rounded-xl bg-blue-900/60 hover:bg-blue-900 text-blue-200 hover:text-white font-semibold text-xs flex items-center gap-1 border border-blue-700/60 cursor-pointer transition-colors active:scale-95 shrink-0"
              >
                <i className="fa-solid fa-rotate text-xs"></i>
                <span className="hidden md:inline">Sheet से लोड</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAddModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-transform active:scale-95 shrink-0"
              >
                <i className="fa-solid fa-plus"></i>
                <span>नई सूचना जारी करें</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sync Status Banner */}
      {sheetSyncMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-xl text-xs font-bold flex items-center justify-between shadow-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-circle-check text-emerald-600 text-sm"></i>
            <span>{sheetSyncMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSheetSyncMsg(null)}
            className="text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold scrollbar-none">
          <button
            type="button"
            onClick={() => setActiveCategory('all')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === 'all'
                ? 'bg-[#0c2340] text-amber-300 shadow-xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            सभी सूचनाएँ ({notices.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('emergency')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === 'emergency'
                ? 'bg-rose-600 text-white shadow-xs font-black'
                : 'bg-rose-50 border border-rose-300 text-rose-800 hover:bg-rose-100 font-bold'
            }`}
          >
            🚨 आपातकालीन ({notices.filter((n) => n.isEmergency || n.category === 'emergency').length})
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('holiday')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === 'holiday'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            🌴 छुट्टियाँ (Holidays)
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('exam')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === 'exam'
                ? 'bg-blue-800 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            📝 परीक्षा (Exams)
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory('ptm')}
            className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
              activeCategory === 'ptm'
                ? 'bg-purple-800 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            👨‍👩‍👧 पी.टी.एम. (PTM)
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-60">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
          <input
            type="text"
            placeholder="सूचना खोजें..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-900"
          />
        </div>
      </div>

      {/* Notices List Cards */}
      {filteredNotices.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-slate-300 p-6">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-xl mx-auto mb-2">
            <i className="fa-solid fa-inbox"></i>
          </div>
          <h5 className="font-extrabold text-sm text-slate-800">कोई सूचना नहीं मिली</h5>
          <p className="text-xs text-slate-500 mt-1">
            इस श्रेणी में वर्तमान में कोई सक्रिय सूचना उपलब्ध नहीं है।
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          {filteredNotices.map((notice) => {
            const badge = categoryBadges[notice.category] || categoryBadges.general;

            return (
              <div
                key={notice.id}
                className={`relative bg-white rounded-2xl border p-4 sm:p-5 shadow-2xs hover:shadow-md transition-shadow flex flex-col justify-between space-y-3 ${
                  notice.isPinned
                    ? 'border-amber-400/90 ring-1 ring-amber-300/60 bg-gradient-to-br from-amber-50/20 via-white to-white'
                    : 'border-slate-200'
                }`}
              >
                {/* Notice Top Meta */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border flex items-center gap-1 ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        <i className={`fa-solid ${badge.icon} text-[9px]`}></i>
                        <span>{badge.label}</span>
                      </span>

                      {notice.isPinned && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black flex items-center gap-1 shadow-2xs">
                          <i className="fa-solid fa-thumbtack text-[9px]"></i>
                          <span>महत्वपूर्ण</span>
                        </span>
                      )}

                      <span className="text-[11px] font-bold text-slate-500">
                        {notice.targetClass && notice.targetClass !== 'All'
                          ? `कक्षा: ${notice.targetClass}`
                          : 'सभी कक्षाएं (All)'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0">
                      <i className="fa-solid fa-calendar text-slate-400 text-[10px]"></i>
                      <span>{notice.date}</span>
                    </div>
                  </div>

                  {/* Title */}
                  <h4 className="font-black text-sm sm:text-base text-slate-900 leading-snug">
                    {notice.title}
                  </h4>

                  {/* Description */}
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                    {notice.description}
                  </p>
                </div>

                {/* Footer Toolbar */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                    <i className="fa-solid fa-pen-nib text-blue-900 text-[10px]"></i>
                    <span>{notice.issuedBy || 'कार्यालय'}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {(notice.isEmergency || notice.category === 'emergency') && (
                      <button
                        type="button"
                        onClick={() => {
                          if (playingSirenNoticeId === notice.id) {
                            stopEmergencySiren();
                            setPlayingSirenNoticeId(null);
                          } else {
                            startEmergencySiren();
                            setPlayingSirenNoticeId(notice.id);
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs ${
                          playingSirenNoticeId === notice.id
                            ? 'bg-rose-600 text-white animate-pulse'
                            : 'bg-amber-100 hover:bg-amber-200 text-slate-900 border border-amber-300'
                        }`}
                        title={playingSirenNoticeId === notice.id ? 'सायरन बंद करें' : 'सायरन ध्वनि बजाएं'}
                      >
                        <i className={`fa-solid ${playingSirenNoticeId === notice.id ? 'fa-volume-xmark text-white' : 'fa-bullhorn text-rose-600'}`}></i>
                        <span>{playingSirenNoticeId === notice.id ? 'सायरन बंद करें' : '🔊 सायरन'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleShareOnWhatsApp(notice)}
                      className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1"
                      title="WhatsApp पर शेयर करें"
                    >
                      <i className="fa-brands fa-whatsapp text-emerald-600"></i>
                      <span>शेयर</span>
                    </button>

                    {(isManager || isTeacher) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteNotice(notice.id)}
                        className="px-2 py-1 bg-rose-50 hover:bg-rose-600 hover:text-white text-rose-700 border border-rose-200 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                        title="सूचना हटाएं"
                      >
                        <i className="fa-solid fa-trash text-[10px]"></i>
                        <span>हटाएं</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Toast Notification for Deleted Notice */}
      {deleteToast && (
        <div className="fixed bottom-5 right-5 z-[110] bg-emerald-700 text-white px-4 py-2.5 rounded-2xl shadow-xl border border-emerald-500 text-xs font-bold flex items-center gap-2 animate-bounce">
          <i className="fa-solid fa-circle-check text-base"></i>
          <span>{deleteToast}</span>
        </div>
      )}

      {/* Custom Confirmation Modal for Deleting Notice (Bypasses iframe window.confirm block) */}
      {noticeToDelete && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setNoticeToDelete(null);
          }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
        >
          <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center text-2xl mx-auto shadow-xs">
                <i className="fa-solid fa-trash-can"></i>
              </div>
              <div>
                <h4 className="font-black text-base text-slate-900">
                  क्या आप यह सूचना हटाना चाहते हैं?
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  हटाने के बाद यह सूचना पोर्टल और नोटिस बोर्ड से हट जाएगी।
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200 text-left text-xs">
                <div className="font-bold text-slate-900 line-clamp-2">
                  📌 {noticeToDelete.title}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                  <span>📅 {noticeToDelete.date}</span>
                  <span>•</span>
                  <span>{noticeToDelete.targetClass || 'All Classes'}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNoticeToDelete(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-300 font-bold text-xs text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  रद्द करें (Cancel)
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteNotice}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
                >
                  हाँ, हटाएं (Yes, Delete)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for Adding New Notice (Manager / Teacher) */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="bg-[#0c2340] px-5 py-4 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className="fa-solid fa-bullhorn text-amber-400"></i>
                <h4 className="font-extrabold text-sm sm:text-base text-amber-300">
                  नई स्कूल सूचना जारी करें (Issue New Circular)
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddNotice} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  सूचना का शीर्षक (Notice Title) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="उदा. दीपावली अवकाश सूचना / अर्धवार्षिक परीक्षा समय-सारणी"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    श्रेणी (Category) *
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => {
                      const val = e.target.value as any;
                      setNewCategory(val);
                      if (val === 'emergency') {
                        setNewIsEmergency(true);
                        setNewIsPinned(true);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-hidden"
                  >
                    <option value="emergency">🚨 आपातकालीन (Emergency Siren)</option>
                    <option value="urgent">⚠️ आवश्यक (Urgent)</option>
                    <option value="holiday">🌴 अवकाश (Holiday)</option>
                    <option value="exam">📝 परीक्षा (Exam)</option>
                    <option value="ptm">👨‍👩‍👧 पीटीएम (PTM)</option>
                    <option value="event">🏆 कार्यक्रम (Event)</option>
                    <option value="general">📢 सामान्य (General)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    दिनांक (Date) *
                  </label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-800 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Emergency Siren Alert Toggle Switch */}
              <div className={`p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${
                newIsEmergency
                  ? 'bg-rose-50 border-rose-400 shadow-sm'
                  : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-center gap-3">
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg font-black shrink-0 ${
                    newIsEmergency ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-200 text-slate-600'
                  }`}>
                    <i className="fa-solid fa-triangle-exclamation"></i>
                  </span>
                  <div>
                    <label htmlFor="emergency-toggle" className="font-black text-slate-900 block text-xs cursor-pointer">
                      🚨 आपातकालीन सायरन सूचना (Play Siren Audio)
                    </label>
                    <span className="text-[11px] text-slate-500 block mt-0.5">
                      अभिभावकों के पोर्टल पर लाल इमरजेंसी अलर्ट व सायरन ध्वनि सुनाई देगी।
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={playEmergencyChime}
                    className="px-2.5 py-1 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold rounded-lg text-[10px] flex items-center gap-1 cursor-pointer shadow-2xs"
                    title="सायरन टेस्ट ध्वनि सुनें"
                  >
                    <i className="fa-solid fa-volume-high"></i>
                    <span>टेस्ट साउंड</span>
                  </button>
                  <input
                    id="emergency-toggle"
                    type="checkbox"
                    checked={newIsEmergency}
                    onChange={(e) => {
                      const chk = e.target.checked;
                      setNewIsEmergency(chk);
                      if (chk) {
                        setNewCategory('emergency');
                        setNewIsPinned(true);
                        playEmergencyChime();
                      }
                    }}
                    className="w-5 h-5 text-rose-600 accent-rose-600 rounded cursor-pointer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    लक्षित कक्षा (Target Class)
                  </label>
                  <input
                    type="text"
                    placeholder="All अथवा Class 5"
                    value={newTargetClass}
                    onChange={(e) => setNewTargetClass(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 font-semibold text-slate-900 focus:outline-hidden"
                  />
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="pin-notice"
                    checked={newIsPinned}
                    onChange={(e) => setNewIsPinned(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-900 cursor-pointer"
                  />
                  <label htmlFor="pin-notice" className="font-bold text-slate-700 cursor-pointer">
                    शीर्ष पर पिन करें (Pin to Top)
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  विस्तृत विवरण (Description / Message) *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="अभिभावकों व विद्यार्थियों के लिए सम्पूर्ण संदेश यहाँ लिखें..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-900 leading-relaxed"
                ></textarea>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold cursor-pointer"
                >
                  रद्द करें
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-900 hover:bg-blue-800 text-amber-300 font-black cursor-pointer shadow-md"
                >
                  सूचना प्रकाशित करें (Publish Notice)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
