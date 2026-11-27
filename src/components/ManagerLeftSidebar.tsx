import React, { useEffect, useMemo, useState } from 'react';

export type ManagerTabId =
  | 'home'
  | 'students'
  | 'homework'
  | 'behavior'
  | 'teacherPerformance'
  | 'reportCards'
  | 'hallPass'
  | 'fees'
  | 'autoTransport'
  | 'users'
  | 'staffAttendance'
  | 'attendance'
  | 'vanTracking'
  | 'notices'
  | 'parentReviews';

export interface ManagerMenuItemMeta {
  id: Exclude<ManagerTabId, 'home'>;
  category: 'academics' | 'finance' | 'staff' | 'operations';
  title: string;
  subtitle: string;
  iconClass: string;
  accentBg: string;
  accentText: string;
  keywords: string;
}

export const MANAGER_MENU_CATEGORIES: Array<{
  key: ManagerMenuItemMeta['category'];
  label: string;
}> = [
  { key: 'academics', label: '1. छात्र एवं शिक्षण' },
  { key: 'finance', label: '2. शुल्क व वित्तीय प्रबंधन' },
  { key: 'staff', label: '3. स्टाफ व उपस्थिति' },
  { key: 'operations', label: '4. परिवहन, सूचना व प्रचार' },
];

export const MANAGER_MENU_ITEMS: ManagerMenuItemMeta[] = [
  {
    id: 'students',
    category: 'academics',
    title: 'All Students Records',
    subtitle: 'छात्र प्रोफाइल, क्लास व डायरेक्टरी',
    iconClass: 'fa-solid fa-users',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-900',
    keywords: 'students records directory class admission छात्र रिकॉर्ड',
  },
  {
    id: 'homework',
    category: 'academics',
    title: 'Homework Submissions',
    subtitle: 'गृहकार्य, डायरी व चेकिंग फोटो',
    iconClass: 'fa-solid fa-book-open',
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-800',
    keywords: 'homework diary submissions गृहकार्य',
  },
  {
    id: 'behavior',
    category: 'academics',
    title: 'Behavior Logs',
    subtitle: 'वर्दी, नाखून, व्यवहार व अनुशासन',
    iconClass: 'fa-solid fa-clipboard-check',
    accentBg: 'bg-purple-50',
    accentText: 'text-purple-800',
    keywords: 'behavior uniform hygiene discipline व्यवहार अनुशासन',
  },
  {
    id: 'teacherPerformance',
    category: 'academics',
    title: 'शिक्षक लीडरबोर्ड',
    subtitle: 'सिलेबस प्लानर व Teacher of the Year',
    iconClass: 'fa-solid fa-trophy',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-700',
    keywords: 'teacher leaderboard performance syllabus points शिक्षक लीडरबोर्ड',
  },
  {
    id: 'reportCards',
    category: 'academics',
    title: 'मार्कशीट व रिपोर्ट कार्ड',
    subtitle: 'तिमाही + छमाही + सालाना अंक व PDF',
    iconClass: 'fa-solid fa-graduation-cap',
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-900',
    keywords: 'report cards marksheet exam marks pdf मार्कशीट रिपोर्ट कार्ड',
  },
  {
    id: 'hallPass',
    category: 'academics',
    title: 'परीक्षा हॉल पास व सीटिंग प्लान',
    subtitle: '9 पास/पेज · Datesheet · 6-रूम सीटिंग प्लान',
    iconClass: 'fa-solid fa-ticket',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-900',
    keywords: 'hall pass admit card datesheet seating plan room हॉल पास सीटिंग प्लान परीक्षा',
  },
  {
    id: 'fees',
    category: 'finance',
    title: 'Fee Collection & Accounts',
    subtitle: 'शुल्क संग्रह, बकाया व रसीदें',
    iconClass: 'fa-solid fa-file-invoice-dollar',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'fee collection accounts receipt pending dues फीस शुल्क रसीद',
  },
  {
    id: 'autoTransport',
    category: 'finance',
    title: 'ऑटो व रूट फीस',
    subtitle: 'वाहन किराया, रूट व स्टॉपेज प्रबंधन',
    iconClass: 'fa-solid fa-route',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    keywords: 'auto transport route fee van village ऑटो रूट फीस',
  },
  {
    id: 'users',
    category: 'staff',
    title: 'Staff & Users Sheet',
    subtitle: 'शिक्षक व कर्मचारी यूजर आईडी',
    iconClass: 'fa-solid fa-id-card-clip',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-900',
    keywords: 'staff users teachers login password id स्टाफ यूजर',
  },
  {
    id: 'staffAttendance',
    category: 'staff',
    title: 'स्टाफ उपस्थिति',
    subtitle: 'शिक्षक व स्टाफ दैनिक हाजिरी रजिस्टर',
    iconClass: 'fa-solid fa-clipboard-user',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'staff attendance register teachers हाजिरी स्टाफ उपस्थिति',
  },
  {
    id: 'attendance',
    category: 'staff',
    title: 'उपस्थिति व अनुपस्थित अलर्ट',
    subtitle: 'तुरंत QR स्कैन हाजिरी, कैलेंडर व WhatsApp अलर्ट',
    iconClass: 'fa-solid fa-calendar-check',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'attendance absent alert qr calendar whatsapp उपस्थिति अनुपस्थित अलर्ट',
  },
  {
    id: 'vanTracking',
    category: 'operations',
    title: 'वैन लाइव ट्रैकिंग',
    subtitle: 'GPS लाइव लोकेशन व स्टॉपेज दूरी',
    iconClass: 'fa-solid fa-van-shuttle',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    keywords: 'van gps live tracking driver location वैन ट्रैकिंग',
  },
  {
    id: 'notices',
    category: 'operations',
    title: 'सूचना पट्ट व अवकाश',
    subtitle: 'विद्यालय परिपत्र व आधिकारिक घोषणाएं',
    iconClass: 'fa-solid fa-bullhorn',
    accentBg: 'bg-orange-50',
    accentText: 'text-orange-800',
    keywords: 'notices holiday announcement siren सूचना अवकाश',
  },
  {
    id: 'parentReviews',
    category: 'operations',
    title: 'पैरेंट रिव्यू व मार्केटिंग पोस्टर',
    subtitle: 'अभिभावक समीक्षा संग्रह व 1-क्लिक एडमिशन पोस्टर',
    iconClass: 'fa-solid fa-star',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    keywords: 'parent reviews marketing poster admission रिव्यू पोस्टर',
  },
];

interface ManagerLeftSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ManagerTabId;
  onSelectTab: (tab: ManagerTabId) => void;
  managerName: string;
  onOpenQrAttendance: () => void;
  onOpenQrSearch: () => void;
  onOpenSheetSync: () => void;
  counts: {
    students: number;
    homework: number;
    behavior: number;
    fees: number;
    users: number;
    notices: number;
    parentReviews: number;
    reportCardsPending: number;
  };
}

export const ManagerLeftSidebar: React.FC<ManagerLeftSidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  managerName,
  onOpenQrAttendance,
  onOpenQrSearch,
  onOpenSheetSync,
  counts,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const getBadgeLabel = (id: ManagerMenuItemMeta['id']): string => {
    switch (id) {
      case 'students':
        return `${counts.students}`;
      case 'homework':
        return `${counts.homework}`;
      case 'behavior':
        return `${counts.behavior}`;
      case 'fees':
        return `${counts.fees}`;
      case 'users':
        return `${counts.users}`;
      case 'staffAttendance':
        return 'लाइव';
      case 'vanTracking':
        return 'GPS';
      case 'attendance':
        return 'QR + अलर्ट';
      case 'notices':
        return `${counts.notices}`;
      case 'autoTransport':
        return 'रूट्स';
      case 'teacherPerformance':
        return '100 Pts';
      case 'reportCards':
        return counts.reportCardsPending > 0 ? `${counts.reportCardsPending} Pending` : 'PDF';
      case 'hallPass':
        return '9/A4';
      case 'parentReviews':
        return `${counts.parentReviews}`;
      default:
        return '';
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return MANAGER_MENU_ITEMS;
    return MANAGER_MENU_ITEMS.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  const handleChooseTab = (tab: ManagerTabId) => {
    onSelectTab(tab);
    onClose();
  };

  return (
    <>
      {/* Flush Left-Wall Slide-Out Navigation Drawer */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="प्रबंधन मेन्यू लिस्ट"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          className="no-print fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-[2px] flex justify-start animate-fadeIn"
        >
          <aside className="w-[300px] sm:w-[328px] max-w-[88vw] h-full bg-white border-r border-slate-200/90 shadow-[20px_0_50px_-15px_rgba(15,23,42,0.2)] flex flex-col animate-slide-in-left">
            {/* Drawer Header */}
            <div className="bg-gradient-to-r from-[#1e3a8a] via-[#312e81] to-[#4338ca] px-4 py-3.5 text-white flex items-center justify-between gap-3 border-b-4 border-[#fbbf24] shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#fbbf24] to-[#f97316] text-[#0f172a] flex items-center justify-center font-black text-sm shadow-sm shrink-0">
                  <i className="fa-solid fa-layer-group" aria-hidden="true"></i>
                </span>
                <div className="min-w-0">
                  <h2 className="font-extrabold text-sm text-white truncate">
                    प्रबंधन मेन्यू
                  </h2>
                  <p className="text-[11px] text-[#fde68a] font-medium truncate">
                    {managerName || 'प्रबंधक'} · E.V.S. Public School
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="मेन्यू बंद करें"
                className="w-10 h-10 rounded-xl bg-[#4f46e5] hover:bg-[#6366f1] text-white border border-[#818cf8] flex items-center justify-center font-bold cursor-pointer transition-colors shrink-0"
              >
                <i className="fa-solid fa-xmark text-base" aria-hidden="true"></i>
              </button>
            </div>

            {/* Quick Filter Search */}
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
                  placeholder="फंक्शन खोजें (जैसे: Fees, Hall Pass)..."
                  className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 focus:outline-none transition-all"
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
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {/* Primary Home Entry */}
              <div>
                <button
                  type="button"
                  id="manager-menu-item-home"
                  onClick={() => handleChooseTab('home')}
                  className={`w-full min-h-[48px] px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2.5 cursor-pointer ${
                    activeTab === 'home'
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                      : 'bg-indigo-50/60 hover:bg-indigo-50 border-indigo-200/80 text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                        activeTab === 'home'
                          ? 'bg-white/20 text-white'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      <i className="fa-solid fa-house" aria-hidden="true"></i>
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-xs sm:text-[13px] truncate">
                        होम पेज (Manager Home)
                      </div>
                      <div
                        className={`text-[11px] truncate ${
                          activeTab === 'home' ? 'text-indigo-100' : 'text-slate-600'
                        }`}
                      >
                        5 मुख्य सारांश कार्ड व डैशबोर्ड
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold whitespace-nowrap shrink-0 tabular-nums ${
                      activeTab === 'home' ? 'text-indigo-100' : 'text-indigo-700'
                    }`}
                  >
                    5 कार्ड
                  </span>
                </button>
              </div>

              {/* Categorized Vertical Function List */}
              {filteredItems.length === 0 ? (
                <div className="py-8 px-4 text-center text-xs text-slate-500">
                  <p className="font-bold text-slate-700">कोई फंक्शन नहीं मिला</p>
                  <p className="mt-1">कृपया दूसरा शब्द लिखें या खोज साफ़ करें।</p>
                </div>
              ) : (
                MANAGER_MENU_CATEGORIES.map((category) => {
                  const items = filteredItems.filter((i) => i.category === category.key);
                  if (items.length === 0) return null;
                  return (
                    <div key={category.key} className="space-y-1.5 pt-2 border-t border-slate-100">
                      <div className="px-2 text-[11px] font-bold text-slate-500">
                        {category.label}
                      </div>
                      <div className="space-y-1">
                        {items.map((item) => {
                          const isActive = activeTab === item.id;
                          const badgeLabel = getBadgeLabel(item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              id={`manager-menu-item-${item.id}`}
                              onClick={() => handleChooseTab(item.id)}
                              className={`w-full min-h-[46px] px-3 py-2 rounded-xl border text-left transition-all flex items-center justify-between gap-2.5 cursor-pointer ${
                                isActive
                                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                                  : 'bg-white hover:bg-slate-50 border-transparent hover:border-slate-200/90 text-slate-900'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                                    isActive
                                      ? 'bg-white/20 text-white'
                                      : `${item.accentBg} ${item.accentText}`
                                  }`}
                                >
                                  <i className={item.iconClass} aria-hidden="true"></i>
                                </span>
                                <div className="min-w-0">
                                  <div className="font-semibold text-xs sm:text-[13px] truncate">
                                    {item.title}
                                  </div>
                                  <div
                                    className={`text-[11px] truncate ${
                                      isActive ? 'text-indigo-100' : 'text-slate-500'
                                    }`}
                                  >
                                    {item.subtitle}
                                  </div>
                                </div>
                              </div>
                              {badgeLabel && (
                                <span
                                  className={`text-[11px] font-bold whitespace-nowrap shrink-0 tabular-nums ${
                                    isActive ? 'text-indigo-100' : 'text-slate-500'
                                  }`}
                                >
                                  {badgeLabel}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </nav>

            {/* Drawer Footer: Quick Actions */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-2 shrink-0">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenQrAttendance();
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <i className="fa-solid fa-camera text-xs" aria-hidden="true"></i>
                  <span>QR हाजिरी</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenQrSearch();
                  }}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <i className="fa-solid fa-qrcode text-xs" aria-hidden="true"></i>
                  <span>QR खोजें</span>
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSheetSync();
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-slate-200 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <i className="fa-solid fa-file-excel text-emerald-600" aria-hidden="true"></i>
                  <span>Sheet Sync</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-[11px] font-bold cursor-pointer transition-colors"
                >
                  बंद करें
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
};

export default ManagerLeftSidebar;
