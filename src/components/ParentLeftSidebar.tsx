import React, { useEffect, useMemo, useState } from 'react';

export type ParentSectionId =
  | 'overview'
  | 'homework'
  | 'tracker'
  | 'fees'
  | 'calendar'
  | 'behavior'
  | 'notices'
  | 'profile'
  | 'reportCard'
  | 'hallPass'
  | 'timetable'
  | 'reviews';

export interface ParentMenuItemMeta {
  id: Exclude<ParentSectionId, 'overview'>;
  titleEn: string;
  titleHi: string;
  subtitleHi: string;
  iconClass: string;
  accentBg: string;
  accentText: string;
  keywords: string;
}

export const PARENT_MENU_ITEMS: ParentMenuItemMeta[] = [
  {
    id: 'homework',
    titleEn: "1. Today's Homework",
    titleHi: '1. आज का होमवर्क',
    subtitleHi: 'गृहकार्य व शिक्षक फ़ोटो देखें',
    iconClass: 'fa-solid fa-book-open',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-900',
    keywords: 'homework diary subjects होमवर्क गृहकार्य',
  },
  {
    id: 'tracker',
    titleEn: '2. Homework Status',
    titleHi: '2. काम पूरा या अधूरा',
    subtitleHi: 'दैनिक होमवर्क चेकिंग रिपोर्ट',
    iconClass: 'fa-solid fa-list-check',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'homework tracker status complete incomplete स्थिति पूरा अधूरा',
  },
  {
    id: 'fees',
    titleEn: '3. School Fees & Receipts',
    titleHi: '3. स्कूल फीस व रसीदें',
    subtitleHi: 'बकाया, भुगतान व रसीद डाउनलोड',
    iconClass: 'fa-solid fa-indian-rupee-sign',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    keywords: 'fees receipts payment due upi फीस रसीद बकाया',
  },
  {
    id: 'calendar',
    titleEn: '4. Attendance Calendar',
    titleHi: '4. मासिक हाजिरी कैलेंडर',
    subtitleHi: 'तारीखवार उपस्थिति व छुट्टियाँ',
    iconClass: 'fa-solid fa-calendar-check',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'attendance calendar present absent हाजिरी कैलेंडर उपस्थिति',
  },
  {
    id: 'behavior',
    titleEn: '5. Behavior & Discipline',
    titleHi: '5. आचरण व अनुशासन',
    subtitleHi: 'यूनिफॉर्म, नाखून व कक्षा टिप्पणी',
    iconClass: 'fa-solid fa-star',
    accentBg: 'bg-purple-50',
    accentText: 'text-purple-800',
    keywords: 'behavior uniform nails manners आचरण व्यवहार',
  },
  {
    id: 'notices',
    titleEn: '6. School Notices',
    titleHi: '6. सूचना पट्ट व अवकाश',
    subtitleHi: 'विद्यालय परिपत्र व महत्वपूर्ण सूचनाएं',
    iconClass: 'fa-solid fa-bullhorn',
    accentBg: 'bg-orange-50',
    accentText: 'text-orange-800',
    keywords: 'notices holiday announcement circular सूचना अवकाश',
  },
  {
    id: 'profile',
    titleEn: '7. Student Profile & QR',
    titleHi: '7. छात्र प्रोफ़ाइल व QR पास',
    subtitleHi: 'रोल नंबर, फोटो व डिजिटल आईडी कार्ड',
    iconClass: 'fa-solid fa-id-card',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-900',
    keywords: 'profile qr pass roll number प्रोफ़ाइल आईडी',
  },
  {
    id: 'reportCard',
    titleEn: '8. Digital Report Card',
    titleHi: '8. डिजिटल रिपोर्ट कार्ड',
    subtitleHi: 'परीक्षा अंक व मार्कशीट देखें',
    iconClass: 'fa-solid fa-graduation-cap',
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-900',
    keywords: 'report card marksheet result रिपोर्ट कार्ड मार्कशीट',
  },
  {
    id: 'hallPass',
    titleEn: '9. Exam Hall Pass',
    titleHi: '9. परीक्षा हॉल पास',
    subtitleHi: 'एडमिट कार्ड व परीक्षा टाइमटेबल',
    iconClass: 'fa-solid fa-ticket',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    keywords: 'hall pass admit card exam datesheet हॉल पास परीक्षा',
  },
  {
    id: 'timetable',
    titleEn: '10. Class Timetable',
    titleHi: '10. कक्षा टाइमटेबल व शिक्षक',
    subtitleHi: 'आज की कक्षाएं, पीरियड व विषय-अध्यापक',
    iconClass: 'fa-solid fa-calendar-week',
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-800',
    keywords: 'timetable class schedule periods teachers टाइमटेबल कक्षा',
  },
  {
    id: 'reviews',
    titleEn: '11. School Review',
    titleHi: '11. स्कूल रिव्यू दें',
    subtitleHi: 'विद्यालय के बारे में अपना अनुभव लिखें',
    iconClass: 'fa-solid fa-comment-dots',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'review rating feedback स्कूल रिव्यू',
  },
];

interface ParentLeftSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeSection: ParentSectionId;
  onSelectSection: (sec: ParentSectionId) => void;
  studentName: string;
  currentLang: 'en' | 'hi';
  onRefreshData: () => void;
  isRefreshing: boolean;
  counts: {
    homeworkCount: number;
    incompleteTrackerCount: number;
    feeLabel: string;
    noticesCount: number;
  };
}

export const ParentLeftSidebar: React.FC<ParentLeftSidebarProps> = ({
  isOpen,
  onClose,
  activeSection,
  onSelectSection,
  studentName,
  currentLang,
  onRefreshData,
  isRefreshing,
  counts,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getBadgeLabel = (id: ParentMenuItemMeta['id']): string => {
    switch (id) {
      case 'homework':
        return `${counts.homeworkCount}`;
      case 'tracker':
        return counts.incompleteTrackerCount > 0 ? `${counts.incompleteTrackerCount} बाकी` : 'पूरा ✓';
      case 'fees':
        return counts.feeLabel;
      case 'notices':
        return `${counts.noticesCount}`;
      default:
        return '';
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return PARENT_MENU_ITEMS;
    return PARENT_MENU_ITEMS.filter(
      (item) =>
        item.titleHi.toLowerCase().includes(q) ||
        item.titleEn.toLowerCase().includes(q) ||
        item.subtitleHi.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  const handleChoose = (sec: ParentSectionId) => {
    onSelectSection(sec);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="पेरेंट्स मेन्यू लिस्ट"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="no-print fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-[2px] flex justify-start animate-fadeIn"
    >
      <aside className="w-[300px] sm:w-[328px] max-w-[88vw] h-full bg-white border-r border-slate-200 shadow-2xl flex flex-col animate-slide-in-left">
        {/* Header */}
        <div className="bg-[#0c2340] px-4 py-3.5 text-white flex items-center justify-between gap-3 border-b border-amber-400/40 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-base shrink-0">
              <i className="fa-solid fa-user-group" aria-hidden="true"></i>
            </span>
            <div className="min-w-0">
              <h2 className="font-black text-sm text-amber-300 truncate">
                {currentLang === 'en' ? 'Parent Menu' : 'अभिभावक मेन्यू (Menu)'}
              </h2>
              <p className="text-[11px] text-blue-100/90 truncate">
                {studentName || 'Student'} · E.V.S. Public School
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="मेन्यू बंद करें"
            className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-black cursor-pointer transition-colors shrink-0"
          >
            <i className="fa-solid fa-xmark text-base" aria-hidden="true"></i>
          </button>
        </div>

        {/* Search Filter */}
        <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="relative">
            <i
              className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none"
              aria-hidden="true"
            ></i>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={currentLang === 'en' ? 'Search section...' : 'ऑप्शन खोजें (जैसे: फीस, रिपोर्ट कार्ड)...'}
              className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#0c2340] focus:outline-none"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="खोज साफ़ करें"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-slate-400 hover:text-slate-700 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark text-xs" aria-hidden="true"></i>
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Vertical Menu List */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          <button
            type="button"
            id="parent-menu-item-overview"
            onClick={() => handleChoose('overview')}
            className={`w-full min-h-[48px] px-3 py-2.5 rounded-xl border text-left transition-colors flex items-center justify-between gap-2.5 cursor-pointer ${
              activeSection === 'overview'
                ? 'bg-[#0c2340] border-[#0c2340] text-white shadow-sm'
                : 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-200 text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                  activeSection === 'overview'
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-amber-200/80 text-amber-950'
                }`}
              >
                <i className="fa-solid fa-house" aria-hidden="true"></i>
              </span>
              <div className="min-w-0">
                <div className="font-black text-xs sm:text-[13px] truncate">
                  {currentLang === 'en' ? 'Home Page (4 Cards)' : 'होम पेज (Parent Home)'}
                </div>
                <div
                  className={`text-[11px] truncate ${
                    activeSection === 'overview' ? 'text-blue-100' : 'text-slate-600'
                  }`}
                >
                  {currentLang === 'en' ? '4 main overview cards' : '4 मुख्य कार्ड्स व सारांश'}
                </div>
              </div>
            </div>
            <span
              className={`text-[11px] font-black whitespace-nowrap shrink-0 tabular-nums ${
                activeSection === 'overview' ? 'text-amber-300' : 'text-amber-900'
              }`}
            >
              4 कार्ड
            </span>
          </button>

          <div className="pt-2 border-t border-slate-100 space-y-1">
            {filteredItems.length === 0 ? (
              <div className="py-8 px-4 text-center text-xs text-slate-500">
                <p className="font-bold text-slate-700">कोई विकल्प नहीं मिला</p>
                <p className="mt-1">कृपया दूसरा शब्द लिखें।</p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const isActive = activeSection === item.id;
                const badge = getBadgeLabel(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    id={`parent-menu-item-${item.id}`}
                    onClick={() => handleChoose(item.id)}
                    className={`w-full min-h-[46px] px-3 py-2 rounded-xl border text-left transition-colors flex items-center justify-between gap-2.5 cursor-pointer ${
                      isActive
                        ? 'bg-[#0c2340] border-[#0c2340] text-white shadow-xs'
                        : 'bg-white hover:bg-slate-50 border-transparent hover:border-slate-200 text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                          isActive
                            ? 'bg-white/15 text-amber-300'
                            : `${item.accentBg} ${item.accentText}`
                        }`}
                      >
                        <i className={item.iconClass} aria-hidden="true"></i>
                      </span>
                      <div className="min-w-0">
                        <div className="font-bold text-xs sm:text-[13px] truncate">
                          {currentLang === 'en' ? item.titleEn : item.titleHi}
                        </div>
                        <div
                          className={`text-[11px] truncate ${
                            isActive ? 'text-blue-100' : 'text-slate-500'
                          }`}
                        >
                          {item.subtitleHi}
                        </div>
                      </div>
                    </div>
                    {badge && (
                      <span
                        className={`text-[11px] font-bold whitespace-nowrap shrink-0 tabular-nums ${
                          isActive ? 'text-amber-300' : 'text-slate-600'
                        }`}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </nav>

        {/* Drawer Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              onRefreshData();
            }}
            disabled={isRefreshing}
            className="flex-1 min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
          >
            <i className={`fa-solid fa-rotate-right text-xs ${isRefreshing ? 'fa-spin' : ''}`} aria-hidden="true"></i>
            <span>{currentLang === 'en' ? 'Refresh Data' : 'डेटा रिफ्रेश करें'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
          >
            बंद करें
          </button>
        </div>
      </aside>
    </div>
  );
};

export default ParentLeftSidebar;
