import React, { useEffect, useMemo, useState } from 'react';

export type TeacherTabId =
  | 'home'
  | 'staff_attendance'
  | 'upload'
  | 'tracker'
  | 'submissions'
  | 'behavior'
  | 'notices'
  | 'performance'
  | 'syllabus'
  | 'weekly_tests'
  | 'report_card'
  | 'seating_plan';

export interface TeacherMenuItemMeta {
  id: Exclude<TeacherTabId, 'home'>;
  category: 'daily' | 'exams' | 'school';
  titleEn: string;
  titleHi: string;
  subtitleHi: string;
  iconClass: string;
  accentBg: string;
  accentText: string;
  keywords: string;
}

export const TEACHER_MENU_CATEGORIES: Array<{
  key: TeacherMenuItemMeta['category'];
  labelHi: string;
  labelEn: string;
}> = [
  { key: 'daily', labelHi: '1. दैनिक कक्षा व हाजिरी', labelEn: '1. Daily Class & Attendance' },
  { key: 'exams', labelHi: '2. परीक्षा, सिलेबस व प्रदर्शन', labelEn: '2. Exams, Syllabus & Score' },
  { key: 'school', labelHi: '3. विद्यालय सूचनाएं', labelEn: '3. School Notices' },
];

export const TEACHER_MENU_ITEMS: TeacherMenuItemMeta[] = [
  {
    id: 'staff_attendance',
    category: 'daily',
    titleEn: 'My Staff Attendance',
    titleHi: 'मेरी स्टाफ हाजिरी',
    subtitleHi: 'स्कूल QR चेक-इन, चेक-आउट व रिकॉर्ड',
    iconClass: 'fa-solid fa-id-card-clip',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'staff attendance check in out qr स्टाफ हाजिरी',
  },
  {
    id: 'upload',
    category: 'daily',
    titleEn: 'Upload Homework',
    titleHi: 'नया होमवर्क डालें',
    subtitleHi: 'कक्षा व विषय के अनुसार गृहकार्य भेजें',
    iconClass: 'fa-solid fa-cloud-arrow-up',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-900',
    keywords: 'upload homework diary assignment होमवर्क डालें',
  },
  {
    id: 'tracker',
    category: 'daily',
    titleEn: 'Homework Checker',
    titleHi: 'होमवर्क चेकर (1-Click)',
    subtitleHi: 'बच्चों का गृहकार्य पूरा/अधूरा मार्क करें',
    iconClass: 'fa-solid fa-list-check',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'homework checker tracker complete incomplete होमवर्क चेकर',
  },
  {
    id: 'submissions',
    category: 'daily',
    titleEn: 'Recent Homework',
    titleHi: 'हाल के होमवर्क',
    subtitleHi: 'भेजे गए गृहकार्य की सूची देखें',
    iconClass: 'fa-solid fa-clock-rotate-left',
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-800',
    keywords: 'recent submissions homework history हाल के होमवर्क',
  },
  {
    id: 'behavior',
    category: 'daily',
    titleEn: 'Student Attendance & Conduct',
    titleHi: 'छात्र हाजिरी व दैनिक आचरण',
    subtitleHi: 'उपस्थिति, वर्दी, नाखून व अनुशासन दर्ज करें',
    iconClass: 'fa-solid fa-user-check',
    accentBg: 'bg-purple-50',
    accentText: 'text-purple-800',
    keywords: 'student attendance behavior conduct discipline हाजिरी आचरण',
  },
  {
    id: 'seating_plan',
    category: 'exams',
    titleEn: 'Exam Room & Seating Plan',
    titleHi: 'मेरा एग्जाम रूम व सीटिंग प्लान',
    subtitleHi: 'रूम ड्यूटी, सीटिंग चार्ट व रूम में भेजें',
    iconClass: 'fa-solid fa-chair',
    accentBg: 'bg-blue-50',
    accentText: 'text-blue-900',
    keywords: 'exam room seating plan duty invigilator सीटिंग प्लान रूम',
  },
  {
    id: 'report_card',
    category: 'exams',
    titleEn: 'Exam Marks & Report Card',
    titleHi: 'परीक्षा अंक व रिपोर्ट कार्ड',
    subtitleHi: 'तिमाही, छमाही व सालाना अंक दर्ज करें',
    iconClass: 'fa-solid fa-graduation-cap',
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-900',
    keywords: 'exam marks report card marksheet परीक्षा अंक रिपोर्ट कार्ड',
  },
  {
    id: 'weekly_tests',
    category: 'exams',
    titleEn: 'Weekly Subject Test',
    titleHi: 'वीकली विषय टेस्ट',
    subtitleHi: 'साप्ताहिक टेस्ट शेड्यूल व अंक (25 Pts)',
    iconClass: 'fa-solid fa-file-pen',
    accentBg: 'bg-emerald-50',
    accentText: 'text-emerald-800',
    keywords: 'weekly subject test marks वीकली टेस्ट',
  },
  {
    id: 'syllabus',
    category: 'exams',
    titleEn: 'Weekly Syllabus Tracker',
    titleHi: 'वीकली सिलेबस ट्रैकर',
    subtitleHi: 'अध्याय प्रगति व शिक्षण योजना (30 Pts)',
    iconClass: 'fa-solid fa-book-open-reader',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-800',
    keywords: 'syllabus tracker chapters सिलेबस',
  },
  {
    id: 'performance',
    category: 'exams',
    titleEn: 'Teacher Leaderboard',
    titleHi: 'शिक्षक लीडरबोर्ड',
    subtitleHi: 'मेरा स्कोर, रैंक व 100 Pts प्रदर्शन',
    iconClass: 'fa-solid fa-trophy',
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-700',
    keywords: 'teacher leaderboard score rank performance लीडरबोर्ड',
  },
  {
    id: 'notices',
    category: 'school',
    titleEn: 'School Notices',
    titleHi: 'स्कूल सूचना पट्ट व अवकाश',
    subtitleHi: 'विद्यालय परिपत्र व महत्वपूर्ण घोषणाएं',
    iconClass: 'fa-solid fa-bullhorn',
    accentBg: 'bg-orange-50',
    accentText: 'text-orange-800',
    keywords: 'notices holiday announcement सूचना अवकाश',
  },
];

interface TeacherLeftSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: TeacherTabId;
  onSelectTab: (tab: TeacherTabId) => void;
  teacherName: string;
  currentLang: 'en' | 'hi';
  onOpenFindStudent: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
  counts: {
    staffPresent: boolean;
    homeworkCount: number;
    behaviorCount: number;
    assignedRoomsLabel: string;
    noticesCount: number;
  };
}

export const TeacherLeftSidebar: React.FC<TeacherLeftSidebarProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  teacherName,
  currentLang,
  onOpenFindStudent,
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

  const getBadgeLabel = (id: TeacherMenuItemMeta['id']): string => {
    switch (id) {
      case 'staff_attendance':
        return counts.staffPresent ? (currentLang === 'en' ? 'Present' : 'उपस्थित') : (currentLang === 'en' ? 'Pending' : 'बाकी');
      case 'submissions':
        return `${counts.homeworkCount}`;
      case 'behavior':
        return `${counts.behaviorCount}`;
      case 'tracker':
        return '1-Click';
      case 'seating_plan':
        return counts.assignedRoomsLabel || 'Plan';
      case 'syllabus':
        return '30 Pts';
      case 'weekly_tests':
        return '25 Pts';
      case 'performance':
        return '100 Pts';
      case 'notices':
        return `${counts.noticesCount}`;
      default:
        return '';
    }
  };

  const filteredItems = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return TEACHER_MENU_ITEMS;
    return TEACHER_MENU_ITEMS.filter(
      (item) =>
        item.titleHi.toLowerCase().includes(q) ||
        item.titleEn.toLowerCase().includes(q) ||
        item.subtitleHi.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  const handleChoose = (tab: TeacherTabId) => {
    onSelectTab(tab);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="टीचर मेन्यू लिस्ट"
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
              <i className="fa-solid fa-chalkboard-user" aria-hidden="true"></i>
            </span>
            <div className="min-w-0">
              <h2 className="font-black text-sm text-amber-300 truncate">
                {currentLang === 'en' ? 'Teacher Menu' : 'टीचर मेन्यू (Menu)'}
              </h2>
              <p className="text-[11px] text-blue-100/90 truncate">
                {teacherName || 'Teacher'} · E.V.S. Public School
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
              placeholder={currentLang === 'en' ? 'Search feature...' : 'फंक्शन खोजें (जैसे: Homework, Room)...'}
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
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          <div>
            <button
              type="button"
              id="teacher-menu-item-home"
              onClick={() => handleChoose('home')}
              className={`w-full min-h-[48px] px-3 py-2.5 rounded-xl border text-left transition-colors flex items-center justify-between gap-2.5 cursor-pointer ${
                activeTab === 'home'
                  ? 'bg-[#0c2340] border-[#0c2340] text-white shadow-sm'
                  : 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-200 text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                    activeTab === 'home'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-amber-200/80 text-amber-950'
                  }`}
                >
                  <i className="fa-solid fa-house" aria-hidden="true"></i>
                </span>
                <div className="min-w-0">
                  <div className="font-black text-xs sm:text-[13px] truncate">
                    {currentLang === 'en' ? 'Home Page (4 Cards)' : 'होम पेज (Teacher Home)'}
                  </div>
                  <div
                    className={`text-[11px] truncate ${
                      activeTab === 'home' ? 'text-blue-100' : 'text-slate-600'
                    }`}
                  >
                    {currentLang === 'en' ? '4 quick summary cards' : '4 मुख्य सारांश कार्ड'}
                  </div>
                </div>
              </div>
              <span
                className={`text-[11px] font-black whitespace-nowrap shrink-0 tabular-nums ${
                  activeTab === 'home' ? 'text-amber-300' : 'text-amber-900'
                }`}
              >
                4 कार्ड
              </span>
            </button>
          </div>

          {filteredItems.length === 0 ? (
            <div className="py-8 px-4 text-center text-xs text-slate-500">
              <p className="font-bold text-slate-700">कोई फंक्शन नहीं मिला</p>
              <p className="mt-1">कृपया दूसरा शब्द लिखें।</p>
            </div>
          ) : (
            TEACHER_MENU_CATEGORIES.map((category) => {
              const items = filteredItems.filter((i) => i.category === category.key);
              if (items.length === 0) return null;
              return (
                <div key={category.key} className="space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="px-2 text-[11px] font-bold text-slate-500">
                    {currentLang === 'en' ? category.labelEn : category.labelHi}
                  </div>
                  <div className="space-y-1">
                    {items.map((item) => {
                      const isActive = activeTab === item.id;
                      const badge = getBadgeLabel(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          id={`teacher-menu-item-${item.id}`}
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
                    })}
                  </div>
                </div>
              );
            })
          )}
        </nav>

        {/* Drawer Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 space-y-2 shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFindStudent();
              }}
              className="min-h-[40px] px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
            >
              <i className="fa-solid fa-qrcode text-xs" aria-hidden="true"></i>
              <span>{currentLang === 'en' ? 'Find Student' : 'छात्र खोजें / QR'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRefreshData();
              }}
              disabled={isRefreshing}
              className="min-h-[40px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <i className={`fa-solid fa-rotate-right text-xs ${isRefreshing ? 'fa-spin' : ''}`} aria-hidden="true"></i>
              <span>{currentLang === 'en' ? 'Refresh' : 'रिफ्रेश करें'}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default TeacherLeftSidebar;
