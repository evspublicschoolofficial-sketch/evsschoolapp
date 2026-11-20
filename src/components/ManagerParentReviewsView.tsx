import React, { useEffect, useMemo, useState } from 'react';
import { Student } from '../types';
import {
  buildSocialMarketingCaption,
  buildWhatsappReviewInviteMessage,
  compressReviewPhoto,
  deleteParentReviewOnServer,
  downloadTestimonialPosterPng,
  generateTestimonialPosterDataUrl,
  loadGoogleReviewLink,
  ParentReviewRecord,
  PosterThemeId,
  REVIEW_CATEGORIES,
  ReviewSource,
  saveGoogleReviewLink,
  submitParentReviewToServer,
  updateParentReviewOnServer,
} from '../utils/parentReviewHelper';

interface ManagerParentReviewsViewProps {
  reviews: ParentReviewRecord[];
  onReviewsChange: (updated: ParentReviewRecord[]) => void;
  onRefreshReviews: () => Promise<void>;
  students: Student[];
  getClassName: (raw?: string) => string;
  getStudentPhoto: (student: Student) => string | undefined;
}

type FilterMode = 'all' | 'pending' | 'approved' | 'featured' | 'marketing_ready';

export const ManagerParentReviewsView: React.FC<ManagerParentReviewsViewProps> = ({
  reviews,
  onReviewsChange,
  onRefreshReviews,
  students,
  getClassName,
  getStudentPhoto,
}) => {
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedSurveyId, setExpandedSurveyId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Manual / PTM / WhatsApp Review Modal
  const [addModalOpen, setAddModalOpen] = useState<boolean>(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [manualParentName, setManualParentName] = useState<string>('');
  const [manualStudentName, setManualStudentName] = useState<string>('');
  const [manualClassName, setManualClassName] = useState<string>('');
  const [manualMobile, setManualMobile] = useState<string>('');
  const [manualRating, setManualRating] = useState<number>(5);
  const [manualCategory, setManualCategory] = useState<string>(REVIEW_CATEGORIES[0]);
  const [manualSource, setManualSource] = useState<ReviewSource>('whatsapp');
  const [manualText, setManualText] = useState<string>('');
  const [manualPhotoUrl, setManualPhotoUrl] = useState<string>('');
  const [manualConsent, setManualConsent] = useState<boolean>(true);
  const [manualSaving, setManualSaving] = useState<boolean>(false);

  // WhatsApp Invite & Google Maps Link Modal
  const [inviteModalOpen, setInviteModalOpen] = useState<boolean>(false);
  const [googleReviewLink, setGoogleReviewLink] = useState<string>(() => loadGoogleReviewLink());
  const [inviteSearch, setInviteSearch] = useState<string>('');
  const [inviteClassFilter, setInviteClassFilter] = useState<string>('all');

  // Marketing Poster Studio Modal
  const [posterReview, setPosterReview] = useState<ParentReviewRecord | null>(null);
  const [posterTheme, setPosterTheme] = useState<PosterThemeId>('royal_navy');
  const [posterHeadline, setPosterHeadline] = useState<string>('अभिभावक विश्वास संदेश');
  const [posterBanner, setPosterBanner] = useState<string>(
    '🎓 प्रवेश प्रारंभ (Admissions Open 2026–27) · Play Group से 8th तक'
  );
  const [posterSchoolPhone, setPosterSchoolPhone] = useState<string>('');
  const [posterPreviewUrl, setPosterPreviewUrl] = useState<string>('');
  const [generatingPoster, setGeneratingPoster] = useState<boolean>(false);
  const [captionCopied, setCaptionCopied] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const stats = useMemo(() => {
    const total = reviews.length;
    const pending = reviews.filter((r) => r.status === 'pending').length;
    const approved = reviews.filter((r) => r.status === 'approved').length;
    const marketingReady = reviews.filter(
      (r) => r.status === 'approved' && r.marketingConsent
    ).length;
    const avg =
      total > 0
        ? (reviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / total).toFixed(1)
        : '5.0';
    const surveyReviews = reviews.filter((r) => typeof r.satisfactionPct === 'number' && (r.totalQuestions || 0) > 0);
    const avgSatisfaction =
      surveyReviews.length > 0
        ? Math.round(
            surveyReviews.reduce((sum, r) => sum + (Number(r.satisfactionPct) || 0), 0) / surveyReviews.length
          )
        : null;
    return { total, pending, approved, marketingReady, avg, avgSatisfaction, surveyCount: surveyReviews.length };
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return reviews.filter((r) => {
      if (filterMode === 'pending' && r.status !== 'pending') return false;
      if (filterMode === 'approved' && r.status !== 'approved') return false;
      if (filterMode === 'featured' && !r.featured) return false;
      if (filterMode === 'marketing_ready' && !(r.status === 'approved' && r.marketingConsent)) {
        return false;
      }
      if (!q) return true;
      return (
        r.parentName.toLowerCase().includes(q) ||
        r.studentName.toLowerCase().includes(q) ||
        r.className.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.reviewText.toLowerCase().includes(q)
      );
    });
  }, [reviews, filterMode, searchTerm]);

  const findStudentFallbackPhoto = (rev: ParentReviewRecord): string | undefined => {
    if (!rev.studentId) return undefined;
    const match = students.find(
      (s) => String(s.Student_ID || '').trim().toLowerCase() === rev.studentId.trim().toLowerCase()
    );
    return match ? getStudentPhoto(match) : undefined;
  };

  useEffect(() => {
    if (!posterReview) {
      setPosterPreviewUrl('');
      return;
    }
    let cancelled = false;
    setGeneratingPoster(true);
    generateTestimonialPosterDataUrl(posterReview, {
      theme: posterTheme,
      headline: posterHeadline,
      admissionBanner: posterBanner,
      schoolPhone: posterSchoolPhone,
      studentPhotoFallback: findStudentFallbackPhoto(posterReview),
    })
      .then((url) => {
        if (!cancelled) setPosterPreviewUrl(url);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setGeneratingPoster(false);
      });
    return () => {
      cancelled = true;
    };
  }, [posterReview, posterTheme, posterHeadline, posterBanner, posterSchoolPhone]);

  const handleStatusPatch = async (
    rev: ParentReviewRecord,
    patch: Partial<Pick<ParentReviewRecord, 'status' | 'featured' | 'marketingConsent'>>,
    feedbackText: string
  ) => {
    setBusyId(rev.id);
    try {
      const res = await updateParentReviewOnServer(rev, patch);
      onReviewsChange(res.reviews);
      showToast(feedbackText + (res.sheetSynced ? ' (Sheet Synced ✓)' : ''));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (rev: ParentReviewRecord) => {
    setBusyId(rev.id);
    try {
      const res = await deleteParentReviewOnServer(rev.id);
      onReviewsChange(res.reviews);
      showToast('रिव्यू हटा दिया गया।');
    } finally {
      setBusyId(null);
    }
  };

  const handleStudentPick = (sid: string) => {
    setSelectedStudentId(sid);
    const st = students.find((s) => String(s.Student_ID) === sid);
    if (st) {
      setManualStudentName(st.Student_Name || '');
      setManualClassName(getClassName(st.Class));
      setManualParentName(st.Father_Name ? `श्री ${st.Father_Name}` : '');
      setManualMobile(String(st.Parent_Mobile || ''));
    }
  };

  const handleManualSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualParentName.trim() || !manualText.trim()) return;
    setManualSaving(true);
    try {
      const selectedStudent = students.find((s) => String(s.Student_ID) === selectedStudentId);
      const res = await submitParentReviewToServer({
        studentId: selectedStudentId || '',
        studentName: manualStudentName.trim(),
        className: manualClassName.trim(),
        parentName: manualParentName.trim(),
        fatherName: selectedStudent?.Father_Name || manualParentName.trim(),
        parentMobile: manualMobile.trim(),
        rating: manualRating,
        category: manualCategory,
        reviewText: manualText.trim(),
        photoUrl: manualPhotoUrl,
        marketingConsent: manualConsent,
        status: 'approved',
        featured: false,
        source: manualSource,
      });
      onReviewsChange(res.reviews);
      setAddModalOpen(false);
      setSelectedStudentId('');
      setManualParentName('');
      setManualStudentName('');
      setManualClassName('');
      setManualMobile('');
      setManualText('');
      setManualPhotoUrl('');
      showToast(
        res.sheetSynced
          ? 'रिव्यू जोड़ा गया व Google Sheet (Parent_Reviews) में सेव हुआ!'
          : 'रिव्यू सफलतापूर्वक जोड़ दिया गया!'
      );
    } finally {
      setManualSaving(false);
    }
  };

  const inviteStudentsList = useMemo(() => {
    const q = inviteSearch.trim().toLowerCase();
    return students
      .filter((s) => {
        const mob = String(s.Parent_Mobile || '').replace(/\D/g, '');
        if (mob.length < 10) return false;
        if (inviteClassFilter !== 'all' && getClassName(s.Class) !== inviteClassFilter) return false;
        if (!q) return true;
        return (
          String(s.Student_Name || '').toLowerCase().includes(q) ||
          String(s.Father_Name || '').toLowerCase().includes(q) ||
          mob.includes(q)
        );
      })
      .slice(0, 40);
  }, [students, inviteSearch, inviteClassFilter, getClassName]);

  const classOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      const c = getClassName(s.Class);
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [students, getClassName]);

  const handleOpenWhatsAppInvite = (st?: Student) => {
    const msg = buildWhatsappReviewInviteMessage(
      st?.Father_Name ? `श्री ${st.Father_Name}` : undefined,
      st?.Student_Name,
      googleReviewLink
    );
    const digits = String(st?.Parent_Mobile || '').replace(/\D/g, '').slice(-10);
    const url = digits
      ? `https://wa.me/91${digits}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5">
      {/* Top Action Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg sm:text-xl font-black text-[#0c2340] flex items-center gap-2">
            <i className="fa-solid fa-bullhorn text-amber-500"></i>
            <span>पैरेंट रिव्यू व एडमिशन मार्केटिंग स्टूडियो</span>
          </h3>
          <p className="text-xs text-slate-600 mt-1">
            अभिभावकों से प्राप्त अनुभवों को मंज़ूरी दें, WhatsApp/PTM रिव्यू जोड़ें और 1-क्लिक में एडमिशन पोस्टर (PNG) डाउनलोड करें।
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={async () => {
              setRefreshing(true);
              await onRefreshReviews();
              setRefreshing(false);
              showToast('Parent_Reviews डेटा सिंक हो गया।');
            }}
            disabled={refreshing}
            className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <i className={`fa-solid fa-arrows-rotate ${refreshing ? 'fa-spin' : ''}`}></i>
            <span>सिंक करें</span>
          </button>

          <button
            type="button"
            onClick={() => setInviteModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <i className="fa-brands fa-whatsapp text-sm"></i>
            <span>WhatsApp पर रिव्यू मांगें</span>
          </button>

          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-[#0c2340] hover:bg-[#13315c] text-amber-300 text-xs font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <i className="fa-solid fa-plus"></i>
            <span>नया रिव्यू जोड़ें (PTM / WhatsApp)</span>
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-circle-check text-emerald-600"></i>
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 4-Metric KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">कुल समीक्षाएं</div>
          <div className="text-2xl font-black text-[#0c2340] mt-1 tabular-nums">{stats.total}</div>
          <div className="text-xs text-slate-500 mt-0.5">Parent_Reviews Sheet</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">औसत रेटिंग</div>
          <div className="text-2xl font-black text-amber-600 mt-1 tabular-nums">
            {stats.avg} ★
          </div>
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {stats.avgSatisfaction !== null
              ? `${stats.avgSatisfaction}% संतुष्ट · ${stats.surveyCount} सर्वे`
              : '5.0 में से अभिभावक स्कोर'}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">मार्केटिंग तैयार</div>
          <div className="text-2xl font-black text-emerald-700 mt-1 tabular-nums">{stats.marketingReady}</div>
          <div className="text-xs text-slate-500 mt-0.5">स्वीकृत + प्रचार सहमति</div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">पेंडिंग अप्रूवल</div>
          <div className="text-2xl font-black text-rose-700 mt-1 tabular-nums">{stats.pending}</div>
          <div className="text-xs text-slate-500 mt-0.5">मंज़ूरी की प्रतीक्षा</div>
        </div>
      </div>

      {/* Filter Tabs + Search */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `सभी (${reviews.length})` },
              { id: 'pending', label: `पेंडिंग (${stats.pending})` },
              { id: 'approved', label: `स्वीकृत (${stats.approved})` },
              { id: 'featured', label: 'फीचर्ड' },
              { id: 'marketing_ready', label: `मार्केटिंग रेडी (${stats.marketingReady})` },
            ] as Array<{ id: FilterMode; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-[#0c2340] text-amber-300'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <i className="fa-solid fa-magnifying-glass text-slate-400 text-xs absolute left-3 top-1/2 -translate-y-1/2"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="अभिभावक, छात्र या शब्द खोजें..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:border-[#0c2340] focus:outline-none"
          />
        </div>
      </div>

      {/* Reviews List */}
      {filteredReviews.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-2xl mx-auto">
            <i className="fa-solid fa-comments"></i>
          </div>
          <h4 className="text-base font-black text-slate-900">अभी कोई अभिभावक समीक्षा उपलब्ध नहीं है</h4>
          <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
            अभिभावकों को WhatsApp पर आमंत्रण भेजें या PTM / WhatsApp चैट पर मिले रिव्यू को सीधे "+ नया रिव्यू जोड़ें" बटन से यहाँ दर्ज करें।
          </p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInviteModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-extrabold cursor-pointer whitespace-nowrap shrink-0"
            >
              WhatsApp आमंत्रण भेजें
            </button>
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-[#0c2340] text-amber-300 text-xs font-extrabold cursor-pointer whitespace-nowrap shrink-0"
            >
              + PTM / WhatsApp रिव्यू जोड़ें
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredReviews.map((rev) => {
            const fallbackPhoto = findStudentFallbackPhoto(rev);
            const displayPhoto = rev.photoUrl || fallbackPhoto;
            const isBusy = busyId === rev.id;
            const sourceLabel =
              rev.source === 'whatsapp'
                ? 'WhatsApp'
                : rev.source === 'ptm'
                ? 'PTM'
                : rev.source === 'manual'
                ? 'Manual'
                : 'Parent App';

            return (
              <div
                key={rev.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  {/* Top metadata row without pill clutter */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {displayPhoto ? (
                        <img
                          src={displayPhoto}
                          alt={rev.parentName}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-[#0c2340] text-amber-300 font-black text-sm flex items-center justify-center shrink-0">
                          {(rev.parentName || rev.studentName || 'EV').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <h5 className="text-sm font-black text-slate-900 truncate">
                          {rev.parentName || (rev.fatherName ? `श्री ${rev.fatherName}` : 'अभिभावक')}
                        </h5>
                        <p className="text-xs text-slate-500 truncate">
                          {[rev.studentName, rev.className, sourceLabel].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-amber-500 text-sm font-black tabular-nums">
                        {'★'.repeat(rev.rating)}
                        <span className="text-slate-200">{'★'.repeat(5 - rev.rating)}</span>
                      </div>
                      <div
                        className={`text-[11px] font-black mt-0.5 ${
                          rev.status === 'approved'
                            ? 'text-emerald-700'
                            : rev.status === 'hidden'
                            ? 'text-slate-500'
                            : 'text-amber-700'
                        }`}
                      >
                        {rev.status === 'approved'
                          ? rev.featured
                            ? '★ फीचर्ड व स्वीकृत'
                            : '✓ स्वीकृत'
                          : rev.status === 'hidden'
                          ? 'छिपाया गया'
                          : '⏳ पेंडिंग'}
                      </div>
                    </div>
                  </div>

                  {/* Quote */}
                  <p className="text-sm text-slate-800 leading-relaxed bg-slate-50 rounded-xl p-3 border border-slate-100">
                    “{rev.reviewText}”
                  </p>

                  {/* Yes/No + Star Survey Breakdown (if captured) */}
                  {Array.isArray(rev.surveyAnswers) && rev.surveyAnswers.length > 0 && (
                    <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="font-bold text-slate-800 tabular-nums">
                          सर्वे स्कोर: <span className="text-emerald-700">{rev.yesCount ?? 0}/{rev.totalQuestions ?? rev.surveyAnswers.length} हाँ</span>
                          <span aria-hidden="true"> · </span>
                          <span className="text-[#0c2340]">{rev.satisfactionPct ?? 100}% संतुष्ट</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedSurveyId(expandedSurveyId === rev.id ? null : rev.id)}
                          className="text-xs font-bold text-blue-800 hover:text-blue-950 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {expandedSurveyId === rev.id ? 'विवरण छुपाएं ▲' : 'सवाल-जवाब विवरण देखें ▼'}
                        </button>
                      </div>

                      {expandedSurveyId === rev.id && (
                        <div className="divide-y divide-slate-100 pt-1 border-t border-slate-100">
                          {rev.surveyAnswers.map((ans) => (
                            <div
                              key={ans.questionId}
                              className="py-1.5 flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-slate-700 font-semibold truncate">
                                {ans.topic}
                              </span>
                              <div className="flex items-center gap-2.5 shrink-0 tabular-nums">
                                <span
                                  className={`font-extrabold ${
                                    ans.yesNo === 'yes' ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {ans.yesNo === 'yes' ? '✓ हाँ' : '✕ नहीं'}
                                </span>
                                <span className="text-amber-500 font-black">
                                  {'★'.repeat(Math.min(5, Math.max(1, ans.stars || 5)))}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Category & Consent Status */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span>
                      श्रेणी: <strong className="text-slate-800">{rev.category}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleStatusPatch(
                          rev,
                          { marketingConsent: !rev.marketingConsent },
                          !rev.marketingConsent ? 'मार्केटिंग सहमति चालू की गई' : 'मार्केटिंग सहमति बंद की गई'
                        )
                      }
                      className={`text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                        rev.marketingConsent ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {rev.marketingConsent ? '✓ प्रचार सहमति प्राप्त' : '⚠ प्रचार सहमति नहीं'}
                    </button>
                  </div>
                </div>

                {/* Actions Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {rev.status !== 'approved' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleStatusPatch(rev, { status: 'approved' }, 'समीक्षा स्वीकृत (Approved) हुई')
                        }
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        ✓ स्वीकृत करें
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        handleStatusPatch(
                          rev,
                          { featured: !rev.featured, status: !rev.featured ? 'approved' : rev.status },
                          !rev.featured ? 'समीक्षा Featured की गई' : 'Featured से हटाया गया'
                        )
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border whitespace-nowrap shrink-0 cursor-pointer ${
                        rev.featured
                          ? 'bg-amber-50 border-amber-300 text-amber-900'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {rev.featured ? '★ Featured' : '☆ Feature करें'}
                    </button>

                    {rev.status !== 'hidden' && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          handleStatusPatch(rev, { status: 'hidden', featured: false }, 'समीक्षा छिपाई गई')
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        छिपाएं
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleDelete(rev)}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                      title="Delete Review"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPosterReview(rev)}
                    className="px-3.5 py-1.5 rounded-xl bg-[#0c2340] hover:bg-[#13315c] text-amber-300 text-xs font-black flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <i className="fa-solid fa-image"></i>
                    <span>पोस्टर बनाएं (PNG)</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: ADD PTM / WHATSAPP / MANUAL REVIEW */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 shadow-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h4 className="text-base font-black text-[#0c2340]">
                WhatsApp / PTM से मिला अभिभावक रिव्यू जोड़ें
              </h4>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <form onSubmit={handleManualSave} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  छात्र चुनें (वैकल्पिक — विवरण अपने-आप भर जाएगा)
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => handleStudentPick(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold bg-white"
                >
                  <option value="">-- मैन्युअल दर्ज करें या छात्र चुनें --</option>
                  {students.map((st) => (
                    <option key={st.Student_ID} value={st.Student_ID}>
                      {st.Student_Name} ({getClassName(st.Class)}) — {st.Father_Name || st.Student_ID}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">अभिभावक का नाम *</label>
                  <input
                    type="text"
                    required
                    value={manualParentName}
                    onChange={(e) => setManualParentName(e.target.value)}
                    placeholder="उदा. श्री राकेश कुमार"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">छात्र का नाम</label>
                  <input
                    type="text"
                    value={manualStudentName}
                    onChange={(e) => setManualStudentName(e.target.value)}
                    placeholder="उदा. आरव शर्मा"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">कक्षा</label>
                  <input
                    type="text"
                    value={manualClassName}
                    onChange={(e) => setManualClassName(e.target.value)}
                    placeholder="उदा. Class 4th"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">स्रोत (Source)</label>
                  <select
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value as ReviewSource)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold bg-white"
                  >
                    <option value="whatsapp">WhatsApp संदेश</option>
                    <option value="ptm">PTM मीटिंग फीडबैक</option>
                    <option value="manual">ऑफलाइन / लिखित</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">रेटिंग</label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setManualRating(st)}
                        className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center cursor-pointer"
                      >
                        <i className={`fa-solid fa-star text-sm ${st <= manualRating ? 'text-amber-400' : 'text-slate-200'}`}></i>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">मुख्य विषय</label>
                  <select
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold bg-white"
                  >
                    {REVIEW_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">अभिभावक का संदेश / रिव्यू *</label>
                <textarea
                  rows={3}
                  required
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  placeholder="WhatsApp या PTM में अभिभावक ने स्कूल के बारे में जो कहा वह यहाँ लिखें..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800 cursor-pointer flex items-center gap-2">
                  <i className="fa-solid fa-camera text-blue-900"></i>
                  <span>{manualPhotoUrl ? 'फ़ोटो चुनी गई ✓' : 'फ़ोटो जोड़ें (वैकल्पिक)'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const url = await compressReviewPhoto(f, 360, 0.72);
                      setManualPhotoUrl(url);
                    }}
                  />
                </label>

                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualConsent}
                    onChange={(e) => setManualConsent(e.target.checked)}
                    className="w-4 h-4 accent-[#0c2340]"
                  />
                  <span>प्रचार सहमति प्राप्त (Marketing Ready)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold cursor-pointer"
                >
                  रद्द करें
                </button>
                <button
                  type="submit"
                  disabled={manualSaving}
                  className="px-5 py-2 rounded-xl bg-[#0c2340] text-amber-300 text-xs font-black cursor-pointer disabled:opacity-60"
                >
                  {manualSaving ? 'सेव हो रहा है...' : 'स्वीकृत कर सेव करें'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: WHATSAPP REVIEW INVITE BUILDER */}
      {inviteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 bg-[#0c2340] text-white flex items-center justify-between">
              <div>
                <h4 className="text-sm sm:text-base font-black text-amber-300">
                  WhatsApp पर अभिभावकों से रिव्यू आमंत्रित करें
                </h4>
                <p className="text-[11px] text-blue-100">
                  3 आसान सवालों वाला तैयार संदेश व Google Maps रिव्यू लिंक 1-क्लिक में भेजें
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              {/* Google Maps Review Link setting */}
              <div className="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 space-y-2">
                <label className="block text-xs font-black text-blue-950">
                  Google Maps Review लिंक (वैकल्पिक — मैसेज व Parent App में जुड़ जाएगा):
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="url"
                    value={googleReviewLink}
                    onChange={(e) => {
                      setGoogleReviewLink(e.target.value);
                      saveGoogleReviewLink(e.target.value);
                    }}
                    placeholder="https://g.page/r/..."
                    className="flex-1 min-w-[200px] rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleOpenWhatsAppInvite()}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    WhatsApp ग्रुप में भेजें →
                  </button>
                </div>
              </div>

              {/* Filter Students */}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder="छात्र, पिता या मोबाइल से खोजें..."
                  className="flex-1 min-w-[180px] rounded-xl border border-slate-300 px-3 py-2 text-xs"
                />
                <select
                  value={inviteClassFilter}
                  onChange={(e) => setInviteClassFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold bg-white"
                >
                  <option value="all">सभी कक्षाएं</option>
                  {classOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl max-h-72 overflow-y-auto">
                {inviteStudentsList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    मोबाइल नंबर वाला कोई छात्र नहीं मिला।
                  </div>
                ) : (
                  inviteStudentsList.map((st) => (
                    <div
                      key={st.Student_ID}
                      className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-900 truncate">
                          {st.Student_Name} · {getClassName(st.Class)}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {st.Father_Name ? `श्री ${st.Father_Name}` : 'अभिभावक'} · {st.Parent_Mobile}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleOpenWhatsAppInvite(st)}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <i className="fa-brands fa-whatsapp"></i>
                        <span>आमंत्रण भेजें</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: 1-CLICK MARKETING POSTER STUDIO (1080x1080 PNG) */}
      {posterReview && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden">
            <div className="p-4 sm:p-5 bg-[#0c2340] text-white flex items-center justify-between shrink-0">
              <div>
                <h4 className="text-sm sm:text-base font-black text-amber-300 flex items-center gap-2">
                  <i className="fa-solid fa-wand-magic-sparkles"></i>
                  <span>एडमिशन मार्केटिंग पोस्टर स्टूडियो (1080×1080 HD PNG)</span>
                </h4>
                <p className="text-[11px] text-blue-100">
                  WhatsApp Status, Facebook, Instagram व प्रिंट ब्रोशर के लिए तैयार पोस्टर
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPosterReview(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Live Poster Canvas Preview */}
              <div className="md:col-span-6 flex flex-col items-center justify-center bg-slate-100 rounded-2xl p-3 border border-slate-200">
                {posterPreviewUrl ? (
                  <img
                    src={posterPreviewUrl}
                    alt="Testimonial Marketing Poster"
                    className="w-full max-w-[380px] aspect-square rounded-xl shadow-lg border border-slate-300"
                  />
                ) : (
                  <div className="w-full max-w-[380px] aspect-square rounded-xl bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                    {generatingPoster ? 'पोस्टर तैयार हो रहा है...' : 'प्रीव्यू उपलब्ध नहीं'}
                  </div>
                )}
              </div>

              {/* Studio Controls & Share Actions */}
              <div className="md:col-span-6 space-y-4">
                <div>
                  <label className="block text-xs font-black text-slate-800 mb-1.5">पोस्टर थीम चुनें</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPosterTheme('royal_navy')}
                      className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer ${
                        posterTheme === 'royal_navy'
                          ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                          : 'bg-white text-slate-800 border-slate-300'
                      }`}
                    >
                      Royal Navy & Gold
                    </button>
                    <button
                      type="button"
                      onClick={() => setPosterTheme('warm_editorial')}
                      className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer ${
                        posterTheme === 'warm_editorial'
                          ? 'bg-amber-100 text-[#0c2340] border-amber-500'
                          : 'bg-white text-slate-800 border-slate-300'
                      }`}
                    >
                      Warm Cream Editorial
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">शीर्ष लेबल (Headline)</label>
                  <input
                    type="text"
                    value={posterHeadline}
                    onChange={(e) => setPosterHeadline(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">नीचे की पट्टी (Admission CTA)</label>
                  <input
                    type="text"
                    value={posterBanner}
                    onChange={(e) => setPosterBanner(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    स्कूल संपर्क नंबर (वैकल्पिक — पोस्टर पर दिखेगा)
                  </label>
                  <input
                    type="text"
                    value={posterSchoolPhone}
                    onChange={(e) => setPosterSchoolPhone(e.target.value)}
                    placeholder="उदा. 9897XXXXXX"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold"
                  />
                </div>

                {!posterReview.marketingConsent && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900">
                    नोट: इस समीक्षा पर अभिभावक की प्रचार सहमति चिह्नित नहीं है। पोस्ट करने से पहले मौखिक/लिखित सहमति सुनिश्चित करें।
                  </div>
                )}

                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() =>
                      downloadTestimonialPosterPng(posterReview, {
                        theme: posterTheme,
                        headline: posterHeadline,
                        admissionBanner: posterBanner,
                        schoolPhone: posterSchoolPhone,
                        studentPhotoFallback: findStudentFallbackPhoto(posterReview),
                      })
                    }
                    className="w-full py-2.5 px-4 rounded-xl bg-[#0c2340] hover:bg-[#13315c] text-amber-300 font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <i className="fa-solid fa-download"></i>
                    <span>HD PNG पोस्टर डाउनलोड करें</span>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const caption = buildSocialMarketingCaption(posterReview);
                        navigator.clipboard?.writeText(caption);
                        setCaptionCopied(true);
                        setTimeout(() => setCaptionCopied(false), 2500);
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <i className={`fa-solid ${captionCopied ? 'fa-check text-emerald-600' : 'fa-copy'}`}></i>
                      <span>{captionCopied ? 'कैप्शन कॉपी हुआ ✓' : 'सोशल कैप्शन कॉपी'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const caption = buildSocialMarketingCaption(posterReview);
                        window.open(
                          `https://wa.me/?text=${encodeURIComponent(caption)}`,
                          '_blank',
                          'noopener,noreferrer'
                        );
                      }}
                      className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <i className="fa-brands fa-whatsapp"></i>
                      <span>WhatsApp पर शेयर</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
