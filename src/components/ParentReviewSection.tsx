import React, { useMemo, useRef, useState } from 'react';
import { Student } from '../types';
import { AppLanguage } from '../utils/translations';
import {
  compressReviewPhoto,
  computeSurveyMetrics,
  getSatisfactionLabel,
  loadGoogleReviewLink,
  ParentReviewRecord,
  requestAiParentReviewDraft,
  REVIEW_CATEGORIES,
  submitParentReviewToServer,
  SURVEY_QUESTIONS,
  SurveyQuestionAnswer,
} from '../utils/parentReviewHelper';

interface ParentReviewSectionProps {
  student: Student;
  reviews: ParentReviewRecord[];
  onReviewsChange: (updated: ParentReviewRecord[]) => void;
  getClassName: (raw?: string) => string;
  studentPhoto?: string;
  currentLang?: AppLanguage;
}

interface QuestionDraftState {
  yesNo?: 'yes' | 'no';
  stars: number;
}

export const ParentReviewSection: React.FC<ParentReviewSectionProps> = ({
  student,
  reviews,
  onReviewsChange,
  getClassName,
  studentPhoto,
  currentLang = 'hi',
}) => {
  const isEn = currentLang === 'en';
  const defaultParentName = student.Father_Name ? `श्री ${student.Father_Name}` : '';

  const [surveyState, setSurveyState] = useState<Record<string, QuestionDraftState>>(() => {
    const initial: Record<string, QuestionDraftState> = {};
    SURVEY_QUESTIONS.forEach((q) => {
      initial[q.id] = { yesNo: undefined, stars: 5 };
    });
    return initial;
  });

  const [manualOverallRating, setManualOverallRating] = useState<number | null>(null);
  const [category, setCategory] = useState<string>(REVIEW_CATEGORIES[0]);
  const [aiLanguage, setAiLanguage] = useState<'hi' | 'hinglish' | 'en'>(isEn ? 'en' : 'hi');
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const [reviewText, setReviewText] = useState<string>('');
  const [parentName, setParentName] = useState<string>(defaultParentName);
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const [marketingConsent, setMarketingConsent] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [compressingPhoto, setCompressingPhoto] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<{
    message: string;
    sheetSynced: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const googleReviewUrl = useMemo(() => loadGoogleReviewLink(), []);

  const answeredList: SurveyQuestionAnswer[] = useMemo(() => {
    return SURVEY_QUESTIONS.reduce<SurveyQuestionAnswer[]>((acc, q) => {
      const state = surveyState[q.id];
      if (state?.yesNo) {
        acc.push({
          questionId: q.id,
          topic: q.topic,
          question: isEn ? q.questionEn : q.questionHi,
          yesNo: state.yesNo,
          stars: state.stars,
        });
      }
      return acc;
    }, []);
  }, [surveyState, isEn]);

  const metrics = useMemo(() => computeSurveyMetrics(answeredList), [answeredList]);
  const answeredCount = answeredList.length;
  const totalSurveyCount = SURVEY_QUESTIONS.length;
  const effectiveOverallRating = manualOverallRating ?? (answeredCount > 0 ? metrics.roundedStars : 5);

  const myReviews = useMemo(() => {
    const sid = String(student.Student_ID || '').trim().toLowerCase();
    const mob = String(student.Parent_Mobile || '').replace(/\D/g, '').slice(-10);
    return reviews.filter((r) => {
      const rSid = String(r.studentId || '').trim().toLowerCase();
      const rMob = String(r.parentMobile || '').replace(/\D/g, '').slice(-10);
      return (sid && rSid === sid) || (mob.length === 10 && rMob === mob);
    });
  }, [reviews, student]);

  const approvedPublicReviews = useMemo(() => {
    return reviews
      .filter((r) => r.status === 'approved')
      .sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
      })
      .slice(0, 6);
  }, [reviews]);

  const handleSetYesNo = (qId: string, choice: 'yes' | 'no') => {
    setErrorMsg(null);
    setAiError(null);
    setManualOverallRating(null);
    setSurveyState((prev) => {
      const current = prev[qId] || { stars: 5 };
      const nextStars =
        current.yesNo === undefined
          ? choice === 'yes'
            ? 5
            : 2
          : choice === 'no' && current.stars >= 4
          ? 2
          : choice === 'yes' && current.stars <= 2
          ? 5
          : current.stars;
      return {
        ...prev,
        [qId]: { yesNo: choice, stars: nextStars },
      };
    });
  };

  const handleSetQuestionStars = (qId: string, stars: number) => {
    setErrorMsg(null);
    setAiError(null);
    setManualOverallRating(null);
    setSurveyState((prev) => {
      const current = prev[qId] || { yesNo: undefined, stars: 5 };
      const autoYesNo: 'yes' | 'no' = current.yesNo ?? (stars >= 3 ? 'yes' : 'no');
      return {
        ...prev,
        [qId]: { yesNo: autoYesNo, stars },
      };
    });
  };

  const handleQuickAllYes = () => {
    setErrorMsg(null);
    setAiError(null);
    setManualOverallRating(null);
    const updated: Record<string, QuestionDraftState> = {};
    SURVEY_QUESTIONS.forEach((q) => {
      updated[q.id] = { yesNo: 'yes', stars: 5 };
    });
    setSurveyState(updated);
  };

  const handleGenerateAiReview = async () => {
    setAiError(null);
    setAiNotice(null);
    setErrorMsg(null);

    if (answeredCount === 0) {
      setAiError(
        isEn
          ? 'Please answer at least one Yes/No + Star question above first so AI can draft an accurate review.'
          : 'कृपया पहले ऊपर कम से कम 1 सवाल पर "हाँ / नहीं" और स्टार चुनें, ताकि AI आपके अनुभव के अनुसार सटीक रिव्यू लिख सके।'
      );
      return;
    }

    setAiGenerating(true);
    try {
      const draft = await requestAiParentReviewDraft({
        studentName: student.Student_Name || '',
        className: getClassName(student.Class),
        parentName: parentName.trim() || defaultParentName,
        language: aiLanguage,
        overallRating: effectiveOverallRating,
        satisfactionPct: metrics.satisfactionPct,
        surveyResponses: answeredList,
      });
      setReviewText(draft);
      setAiNotice(
        isEn
          ? 'AI draft generated from your answers. You may edit it freely before submitting.'
          : 'आपके जवाबों के आधार पर AI ड्राफ्ट तैयार है। सबमिट करने से पहले आप इसमें बदलाव भी कर सकते हैं।'
      );
    } catch (err: any) {
      setAiError(
        err?.message ||
          (isEn
            ? 'Could not generate AI review right now. You can write your review below.'
            : 'अभी AI ड्राफ्ट तैयार नहीं हो सका। आप नीचे अपना अनुभव स्वयं लिख सकते हैं।')
      );
    } finally {
      setAiGenerating(false);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setCompressingPhoto(true);
    try {
      const compressed = await compressReviewPhoto(file, 360, 0.72);
      setPhotoUrl(compressed);
    } catch {
      setErrorMsg(
        isEn
          ? 'Could not process selected photo. Please try another image.'
          : 'फ़ोटो प्रोसेस नहीं हो सकी। कृपया दूसरी फ़ोटो चुनें।'
      );
    } finally {
      setCompressingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessBanner(null);

    const cleanName = parentName.trim();
    const cleanText = reviewText.trim();

    if (answeredCount < totalSurveyCount) {
      setErrorMsg(
        isEn
          ? `Please complete all ${totalSurveyCount} Yes/No survey questions (${answeredCount}/${totalSurveyCount} completed).`
          : `कृपया सभी ${totalSurveyCount} सवालों पर "हाँ" या "नहीं" और स्टार चुनें (अभी ${answeredCount}/${totalSurveyCount} पूरे हैं)।`
      );
      return;
    }

    if (!cleanName) {
      setErrorMsg(isEn ? 'Please enter parent name.' : 'कृपया अभिभावक का नाम दर्ज करें।');
      return;
    }

    if (cleanText.length < 15) {
      setErrorMsg(
        isEn
          ? 'Please tap "AI Review Writer" or write at least 15 characters about your experience.'
          : 'कृपया "AI से रिव्यू लिखवाएं" बटन दबाएं या कम से कम 15 अक्षरों में अपना अनुभव लिखें।'
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitParentReviewToServer({
        studentId: String(student.Student_ID || ''),
        studentName: String(student.Student_Name || ''),
        className: getClassName(student.Class),
        parentName: cleanName,
        fatherName: String(student.Father_Name || ''),
        parentMobile: String(student.Parent_Mobile || ''),
        rating: effectiveOverallRating,
        category,
        reviewText: cleanText,
        photoUrl: photoUrl || '',
        marketingConsent,
        status: 'pending',
        featured: false,
        source: 'parent_portal',
        surveyAnswers: answeredList,
        yesCount: metrics.yesCount,
        totalQuestions: metrics.totalQuestions,
        satisfactionPct: metrics.satisfactionPct,
      });

      onReviewsChange(result.reviews);
      setReviewText('');
      setPhotoUrl('');
      setAiNotice(null);
      setManualOverallRating(null);
      const resetState: Record<string, QuestionDraftState> = {};
      SURVEY_QUESTIONS.forEach((q) => {
        resetState[q.id] = { yesNo: undefined, stars: 5 };
      });
      setSurveyState(resetState);

      setSuccessBanner({
        message: isEn
          ? 'Thank you! Your survey ratings and feedback have been submitted.'
          : 'धन्यवाद! आपका संतुष्टि सर्वेक्षण व अनुभव सफलतापूर्वक दर्ज हो गया है।',
        sheetSynced: result.sheetSynced,
      });
    } catch {
      setErrorMsg(
        isEn ? 'Could not save review. Please retry.' : 'रिव्यू सेव नहीं हो सका, कृपया पुनः प्रयास करें।'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h4 className="text-lg sm:text-xl font-extrabold text-[#0c2340] tracking-tight">
            {isEn ? 'Parent Satisfaction Survey & Review' : 'अभिभावक संतुष्टि सर्वेक्षण व अनुभव'}
          </h4>
          <p className="text-xs text-slate-600 mt-1">
            {[
              student.Student_Name,
              getClassName(student.Class),
              student.Father_Name ? `अभिभावक: श्री ${student.Father_Name}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        {googleReviewUrl && (
          <a
            href={googleReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 border border-slate-300 text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
          >
            <i className="fa-brands fa-google text-blue-700"></i>
            <span>{isEn ? 'Rate Us on Google Maps' : 'Google Maps पर भी 5★ दें'}</span>
          </a>
        )}
      </div>

      {successBanner && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-950 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <i className="fa-solid fa-circle-check text-emerald-600"></i>
            <span>{successBanner.message}</span>
          </div>
          <p className="text-xs text-emerald-800">
            {successBanner.sheetSynced
              ? 'Google Sheet (Parent_Reviews) में आपका स्कोर व विवरण सुरक्षित हो गया।'
              : 'डिवाइस व सर्वर पर सुरक्षित हो गया है। प्रबंधन स्वीकृति के बाद यह स्कूल वॉल पर दिखेगा।'}
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
          <i className="fa-solid fa-triangle-exclamation text-rose-600 shrink-0"></i>
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION A: Live Progress + 5 Structured Yes/No & Star Survey Questions */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {/* Progress & Live Score Bar */}
          <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-[#0c2340]">
                  {isEn
                    ? `Step 1 · Answer ${totalSurveyCount} Quick Questions`
                    : `चरण 1 · विद्यालय व्यवस्था पर ${totalSurveyCount} आसान सवाल`}
                </div>
                <div className="text-xs text-slate-600 mt-0.5 tabular-nums">
                  {answeredCount > 0 ? (
                    <>
                      <span>{answeredCount}/{totalSurveyCount} पूर्ण</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-semibold text-emerald-700">{metrics.yesCount} हाँ</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-semibold text-amber-700">{metrics.avgStars} ★</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-bold text-[#0c2340]">{metrics.satisfactionPct}% संतुष्ट</span>
                    </>
                  ) : (
                    <span>
                      {isEn
                        ? 'Select Yes/No and stars for each topic below'
                        : 'प्रत्येक सवाल पर हाँ/नहीं और अपनी संतुष्टि के अनुसार स्टार चुनें'}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleQuickAllYes}
                className="px-3.5 py-2 rounded-lg bg-white hover:bg-emerald-50 text-emerald-800 border border-emerald-300 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <i className="fa-solid fa-check-double text-emerald-600"></i>
                <span>{isEn ? 'All Yes (5★)' : "सभी पर 'हाँ (5★)' चुनें"}</span>
              </button>
            </div>

            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#0c2340] transition-all duration-200"
                style={{ width: `${Math.round((answeredCount / totalSurveyCount) * 100)}%` }}
              />
            </div>
          </div>

          {/* Divided Question Rows */}
          <div className="divide-y divide-slate-200">
            {SURVEY_QUESTIONS.map((q, idx) => {
              const qState = surveyState[q.id] || { yesNo: undefined, stars: 5 };
              const numPrefix = String(idx + 1).padStart(2, '0');

              return (
                <div key={q.id} className="p-4 sm:p-5 space-y-3.5 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-500">
                        {numPrefix}. {q.topic}
                      </div>
                      <p className="text-sm sm:text-[15px] font-bold text-slate-900 leading-snug">
                        {isEn ? q.questionEn : q.questionHi}
                      </p>
                    </div>
                  </div>

                  {/* Interactive Row: Yes/No + Individual Star Rating */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
                    {/* Yes / No Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSetYesNo(q.id, 'yes')}
                        className={`h-10 px-4 rounded-xl text-xs sm:text-sm font-bold border flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          qState.yesNo === 'yes'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-emerald-400 hover:text-emerald-800'
                        }`}
                      >
                        <i className="fa-solid fa-check"></i>
                        <span>{isEn ? 'Yes' : 'हाँ (Yes)'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSetYesNo(q.id, 'no')}
                        className={`h-10 px-4 rounded-xl text-xs sm:text-sm font-bold border flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                          qState.yesNo === 'no'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                            : 'bg-white text-slate-700 border-slate-300 hover:border-rose-400 hover:text-rose-800'
                        }`}
                      >
                        <i className="fa-solid fa-xmark"></i>
                        <span>{isEn ? 'No' : 'नहीं (No)'}</span>
                      </button>
                    </div>

                    {/* Individual 1–5 Star Selector */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex items-center gap-1" role="group" aria-label={`${q.topic} rating`}>
                        {[1, 2, 3, 4, 5].map((starVal) => {
                          const active = starVal <= qState.stars && qState.yesNo !== undefined;
                          const previewActive = qState.yesNo === undefined && starVal <= qState.stars;
                          return (
                            <button
                              key={starVal}
                              type="button"
                              onClick={() => handleSetQuestionStars(q.id, starVal)}
                              aria-label={`${starVal} Stars`}
                              className={`w-10 h-10 rounded-xl border flex items-center justify-center cursor-pointer transition-transform active:scale-95 ${
                                active
                                  ? 'bg-amber-50 border-amber-300'
                                  : 'bg-white border-slate-200 hover:border-amber-300'
                              }`}
                            >
                              <i
                                className={`fa-solid fa-star text-base ${
                                  active
                                    ? 'text-amber-500'
                                    : previewActive
                                    ? 'text-slate-300'
                                    : 'text-slate-200'
                                }`}
                              ></i>
                            </button>
                          );
                        })}
                      </div>

                      <span className="text-xs font-bold text-slate-700 tabular-nums min-w-[140px]">
                        {qState.yesNo === undefined
                          ? isEn
                            ? 'Tap Yes/No or Star'
                            : 'हाँ/नहीं या स्टार चुनें'
                          : getSatisfactionLabel(qState.stars, isEn)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SECTION B: Overall Rating Summary + AI Smart Review Studio */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-5">
          {/* Overall Computed Score + Highlight Topic */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="space-y-1">
              <div className="text-xs font-bold text-slate-500">
                {isEn ? 'Step 2 · Overall Satisfaction Score' : 'चरण 2 · संपूर्ण संतुष्टि स्कोर'}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setManualOverallRating(st)}
                      className="w-9 h-9 rounded-lg border border-slate-200 hover:border-amber-400 flex items-center justify-center cursor-pointer"
                      aria-label={`Overall ${st} stars`}
                    >
                      <i
                        className={`fa-solid fa-star text-base ${
                          st <= effectiveOverallRating ? 'text-amber-500' : 'text-slate-200'
                        }`}
                      ></i>
                    </button>
                  ))}
                </div>
                <span className="text-sm font-extrabold text-[#0c2340] tabular-nums">
                  {effectiveOverallRating}.0 / 5.0 · {answeredCount > 0 ? `${metrics.satisfactionPct}% संतुष्ट` : 'ऑटो स्कोर'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-bold text-slate-500">
                {isEn ? 'Primary Highlight Area' : 'मुख्य प्रशंसा क्षेत्र चुनें'}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REVIEW_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      category === cat
                        ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* AI Smart Review Writer */}
          <div className="rounded-xl bg-[#0c2340] text-white p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h5 className="text-sm sm:text-base font-extrabold text-amber-300">
                  {isEn ? 'AI Smart Review Writer' : 'AI स्मार्ट रिव्यू लेखक'}
                </h5>
                <p className="text-xs text-slate-200 mt-0.5 leading-relaxed">
                  {isEn
                    ? 'Automatically draft a personalized review grounded strictly in your Yes/No and star ratings.'
                    : 'ऊपर चुने गए आपके "हाँ/नहीं" और स्टार जवाबों से AI तुरंत आपके शब्दों में सटीक रिव्यू लिख देगा।'}
                </p>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-lg bg-white/10 shrink-0 self-start sm:self-auto">
                {(
                  [
                    { id: 'hi', label: 'हिंदी' },
                    { id: 'hinglish', label: 'Hinglish' },
                    { id: 'en', label: 'English' },
                  ] as Array<{ id: 'hi' | 'hinglish' | 'en'; label: string }>
                ).map((langOpt) => (
                  <button
                    key={langOpt.id}
                    type="button"
                    onClick={() => setAiLanguage(langOpt.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      aiLanguage === langOpt.id
                        ? 'bg-amber-400 text-[#0c2340]'
                        : 'text-slate-100 hover:bg-white/10'
                    }`}
                  >
                    {langOpt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-300 tabular-nums">
                {answeredCount > 0
                  ? `${answeredCount}/${totalSurveyCount} सवाल चयनित · ${metrics.yesCount} हाँ · ${metrics.avgStars}★ औसत`
                  : 'पहले चरण 1 के सवाल चुनें'}
              </span>

              <button
                type="button"
                onClick={handleGenerateAiReview}
                disabled={aiGenerating}
                className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-[#0c2340] text-xs sm:text-sm font-extrabold flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
              >
                <i className={`fa-solid ${aiGenerating ? 'fa-circle-notch fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
                <span>
                  {aiGenerating
                    ? isEn
                      ? 'Drafting Review...'
                      : 'AI रिव्यू लिख रहा है...'
                    : reviewText.trim().length > 0
                    ? isEn
                      ? 'Regenerate with AI'
                      : 'AI से पुनः लिखवाएं'
                    : isEn
                    ? 'Draft My Review with AI'
                    : 'AI से मेरा रिव्यू लिखवाएं'}
                </span>
              </button>
            </div>

            {aiError && (
              <div className="p-3 rounded-lg bg-rose-950/70 border border-rose-400/50 text-rose-100 text-xs font-semibold flex items-start gap-2">
                <i className="fa-solid fa-circle-exclamation text-rose-300 mt-0.5 shrink-0"></i>
                <span>{aiError}</span>
              </div>
            )}

            {aiNotice && !aiError && (
              <div className="p-2.5 rounded-lg bg-emerald-950/60 border border-emerald-400/40 text-emerald-100 text-xs font-semibold flex items-center gap-2">
                <i className="fa-solid fa-check text-emerald-300 shrink-0"></i>
                <span>{aiNotice}</span>
              </div>
            )}
          </div>

          {/* Editable Testimonial Box */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-extrabold text-slate-800">
                {isEn ? 'Your Final Review Message (Editable)' : 'आपका अंतिम अनुभव संदेश (आप इसमें बदलाव कर सकते हैं)'}
              </label>
              {reviewText.trim() && (
                <button
                  type="button"
                  onClick={() => setReviewText('')}
                  className="text-xs font-bold text-slate-500 hover:text-rose-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  साफ़ करें
                </button>
              )}
            </div>
            <textarea
              rows={4}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder={
                isEn
                  ? 'Tap "Draft My Review with AI" above or write your experience directly here...'
                  : 'ऊपर "AI से मेरा रिव्यू लिखवाएं" बटन दबाएं या यहाँ स्वयं अपने शब्द लिखें...'
              }
              className="w-full rounded-xl border border-slate-300 bg-slate-50/40 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0c2340] focus:bg-white focus:outline-none"
            />
            <div className="flex items-center justify-between text-xs text-slate-500 mt-1 tabular-nums">
              <span>{isEn ? 'Minimum 15 characters' : 'न्यूनतम 15 अक्षर आवश्यक'}</span>
              <span>{reviewText.trim().length} अक्षर</span>
            </div>
          </div>
        </div>

        {/* SECTION C: Parent Attribution, Photo & Marketing Consent */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="text-xs font-bold text-slate-500">
            {isEn ? 'Step 3 · Parent Name, Photo & Submit' : 'चरण 3 · अभिभावक विवरण व सबमिट'}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-extrabold text-slate-800 mb-1.5">
                {isEn ? 'Parent / Guardian Name' : 'अभिभावक का नाम (पोस्टर पर दिखेगा)'}
              </label>
              <input
                type="text"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                placeholder="उदा. श्री मोहम्मद आसिफ / श्रीमती शायरा बानो"
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:border-[#0c2340] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-extrabold text-slate-800 mb-1.5">
                {isEn ? 'Optional Photo (Parent / Student)' : 'वैकल्पिक फ़ोटो (अभिभावक या छात्र)'}
              </label>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={compressingPhoto}
                  className="px-4 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-300 text-xs font-bold text-slate-800 flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <i className={`fa-solid ${compressingPhoto ? 'fa-circle-notch fa-spin' : 'fa-camera'} text-blue-900`}></i>
                  <span>
                    {compressingPhoto
                      ? 'प्रोसेसिंग...'
                      : photoUrl
                      ? 'फ़ोटो बदलें'
                      : 'फ़ोटो अपलोड करें'}
                  </span>
                </button>

                {photoUrl ? (
                  <div className="flex items-center gap-2">
                    <img
                      src={photoUrl}
                      alt="Parent upload preview"
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-lg object-cover border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoUrl('')}
                      className="text-xs font-bold text-rose-700 hover:text-rose-900 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      हटाएं
                    </button>
                  </div>
                ) : studentPhoto ? (
                  <span className="text-xs text-slate-500">
                    वैकल्पिक (न अपलोड करने पर नाम के अक्षर दिखेंगे)
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#0c2340] rounded cursor-pointer shrink-0"
            />
            <span className="text-xs text-slate-700 leading-relaxed">
              <strong className="text-slate-900 block mb-0.5">
                {isEn ? 'Permission for School Testimonials & Admission Poster' : 'प्रचार व मार्केटिंग सहमति (Marketing Consent)'}
              </strong>
              {isEn
                ? 'I allow E.V.S. Public School to display my name, rating, and review on official school admission brochures, WhatsApp updates, and social media.'
                : 'मैं E.V.S. Public School को मेरी समीक्षा और नाम को विद्यालय के आधिकारिक एडमिशन ब्रोशर, WhatsApp और सोशल मीडिया पर प्रकाशित करने की सहमति देता/देती हूँ।'}
            </span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-xs text-slate-500">
              आपका मोबाइल नंबर सार्वजनिक पोस्टर पर नहीं दिखाया जाता।
            </span>
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-[#0c2340] hover:bg-[#13315c] text-amber-300 font-extrabold text-xs sm:text-sm flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 transition-colors"
            >
              <i className={`fa-solid ${submitting ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`}></i>
              <span>
                {submitting
                  ? isEn
                    ? 'Saving Survey...'
                    : 'सर्वेक्षण सेव हो रहा है...'
                  : isEn
                  ? 'Submit Survey & Review'
                  : 'सर्वेक्षण व समीक्षा सबमिट करें'}
              </span>
            </button>
          </div>
        </div>
      </form>

      {/* Parent's Own Submitted Reviews */}
      {myReviews.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-slate-200">
          <h5 className="text-sm font-extrabold text-[#0c2340]">
            {isEn ? 'Your Submitted Reviews' : 'आपकी भेजी गई समीक्षाएं'}
          </h5>
          <div className="grid grid-cols-1 gap-3">
            {myReviews.map((rev) => (
              <div
                key={rev.id}
                className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-500 font-black tabular-nums">
                      {'★'.repeat(rev.rating)}
                      <span className="text-slate-200">{'★'.repeat(5 - rev.rating)}</span>
                    </span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="font-bold text-slate-800">{rev.category}</span>
                    {rev.totalQuestions ? (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-emerald-700 font-bold tabular-nums">
                          {rev.yesCount ?? 0}/{rev.totalQuestions} हाँ ({rev.satisfactionPct ?? 100}% संतुष्ट)
                        </span>
                      </>
                    ) : null}
                  </div>
                  <span
                    className={`font-extrabold ${
                      rev.status === 'approved'
                        ? 'text-emerald-700'
                        : rev.status === 'hidden'
                        ? 'text-slate-500'
                        : 'text-amber-700'
                    }`}
                  >
                    {rev.status === 'approved'
                      ? '✓ स्वीकृत व प्रकाशित'
                      : rev.status === 'hidden'
                      ? 'निजी समीक्षा'
                      : '⏳ प्रबंधन समीक्षाधीन'}
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                  “{rev.reviewText}”
                </p>
                <div className="text-xs text-slate-500 tabular-nums">
                  {rev.parentName} · {String(rev.createdAt || '').slice(0, 10)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Published School Testimonials Wall */}
      {approvedPublicReviews.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <h5 className="text-sm font-extrabold text-[#0c2340]">
              {isEn ? 'Verified Parent Testimonials' : 'सम्मानित अभिभावकों के विश्वास संदेश'}
            </h5>
            <span className="text-xs font-bold text-slate-500 tabular-nums">
              {approvedPublicReviews.length} प्रकाशित
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {approvedPublicReviews.map((rev) => (
              <div
                key={rev.id}
                className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-amber-500 font-black tabular-nums">
                      {'★'.repeat(rev.rating)}
                    </span>
                    <span className="font-semibold text-blue-800">
                      {rev.totalQuestions
                        ? `${rev.yesCount ?? 0}/${rev.totalQuestions} हाँ · ${rev.category}`
                        : rev.category}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 leading-relaxed">
                    “{rev.reviewText}”
                  </p>
                </div>
                <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100">
                  {rev.photoUrl ? (
                    <img
                      src={rev.photoUrl}
                      alt={rev.parentName}
                      referrerPolicy="no-referrer"
                      className="w-8 h-8 rounded-lg object-cover border border-slate-300 shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-lg bg-[#0c2340] text-amber-300 font-black text-xs flex items-center justify-center shrink-0">
                      {(rev.parentName || rev.studentName || 'P').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-slate-900 truncate">
                      {rev.parentName || (rev.fatherName ? `श्री ${rev.fatherName}` : 'अभिभावक')}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {[rev.studentName, rev.className].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
