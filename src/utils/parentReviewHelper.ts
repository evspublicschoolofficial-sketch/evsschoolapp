import { getAppsScriptUrl } from './busTrackingService';
import { saveToPhoneMemory } from './phoneMemoryCache';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';

export const PARENT_REVIEWS_STORAGE_KEY = 'evs_parent_reviews_v1';
export const GOOGLE_REVIEW_LINK_STORAGE_KEY = 'evs_google_review_link_v1';

export type ReviewStatus = 'pending' | 'approved' | 'hidden';
export type ReviewSource = 'parent_portal' | 'whatsapp' | 'ptm' | 'manual';
export type PosterThemeId = 'royal_navy' | 'warm_editorial';

export interface SurveyQuestionConfig {
  id: string;
  topic: string;
  questionHi: string;
  questionEn: string;
  icon: string;
}

export interface SurveyQuestionAnswer {
  questionId: string;
  topic: string;
  question: string;
  yesNo: 'yes' | 'no';
  stars: number;
}

export const SURVEY_QUESTIONS: SurveyQuestionConfig[] = [
  {
    id: 'q_academics',
    topic: 'पढ़ाई व लिखावट',
    questionHi: 'क्या आपके बच्चे की पढ़ाई, रीडिंग और लिखावट में संतोषजनक सुधार हुआ है?',
    questionEn: 'Have you seen positive improvement in your child’s studies, reading, and writing?',
    icon: 'fa-book-open-reader',
  },
  {
    id: 'q_teachers',
    topic: 'शिक्षक व्यवहार व ध्यान',
    questionHi: 'क्या स्कूल के शिक्षक विनम्र हैं और प्रत्येक बच्चे पर व्यक्तिगत ध्यान देते हैं?',
    questionEn: 'Are teachers polite, supportive, and attentive to your child individually?',
    icon: 'fa-chalkboard-user',
  },
  {
    id: 'q_discipline',
    topic: 'अनुशासन व संस्कार',
    questionHi: 'क्या स्कूल का वातावरण, साफ-सफाई और बच्चों में अनुशासन व संस्कार अच्छे हैं?',
    questionEn: 'Are you satisfied with school discipline, cleanliness, and moral values?',
    icon: 'fa-shield-halved',
  },
  {
    id: 'q_facilities',
    topic: 'डिजिटल ऐप व वैन सुरक्षा',
    questionHi: 'क्या घर बैठे होमवर्क, हाजिरी, फीस व बस ट्रैकिंग जैसी डिजिटल सुविधाएं उपयोगी हैं?',
    questionEn: 'Do you find daily homework updates, attendance, fee & van tracking helpful?',
    icon: 'fa-mobile-screen-button',
  },
  {
    id: 'q_recommend',
    topic: 'संपूर्ण संतुष्टि व सिफारिश',
    questionHi: 'क्या आप अन्य अभिभावकों को भी E.V.S. Public School में दाखिले की सलाह देंगे?',
    questionEn: 'Would you happily recommend E.V.S. Public School to other parents?',
    icon: 'fa-award',
  },
];

export interface ParentReviewRecord {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  parentName: string;
  fatherName: string;
  parentMobile: string;
  rating: number;
  category: string;
  reviewText: string;
  photoUrl?: string;
  marketingConsent: boolean;
  status: ReviewStatus;
  featured: boolean;
  source: ReviewSource;
  createdAt: string;
  updatedAt: string;
  surveyAnswers?: SurveyQuestionAnswer[];
  yesCount?: number;
  totalQuestions?: number;
  satisfactionPct?: number;
  _sheetSynced?: boolean;
}

export const REVIEW_CATEGORIES = [
  'पढ़ाई व रिज़ल्ट',
  'अनुशासन व संस्कार',
  'शिक्षक व्यवहार',
  'लाइव बस व सुरक्षा',
  'डिजिटल ऐप सुविधा',
  'संपूर्ण अनुभव',
] as const;

export function getSatisfactionLabel(stars: number, isEn = false): string {
  if (stars >= 5) return isEn ? 'Delighted (5★)' : 'पूरी तरह संतुष्ट (5★)';
  if (stars === 4) return isEn ? 'Very Satisfied (4★)' : 'बहुत संतुष्ट (4★)';
  if (stars === 3) return isEn ? 'Satisfied (3★)' : 'संतोषजनक (3★)';
  if (stars === 2) return isEn ? 'Needs Attention (2★)' : 'सुधार की उम्मीद (2★)';
  return isEn ? 'Dissatisfied (1★)' : 'असंतुष्ट (1★)';
}

export function computeSurveyMetrics(answers: SurveyQuestionAnswer[]) {
  const totalQuestions = answers.length;
  if (totalQuestions === 0) {
    return {
      totalQuestions: 0,
      yesCount: 0,
      noCount: 0,
      avgStars: 5,
      roundedStars: 5,
      satisfactionPct: 100,
    };
  }
  const yesCount = answers.filter((a) => a.yesNo === 'yes').length;
  const noCount = totalQuestions - yesCount;
  const starSum = answers.reduce((acc, a) => acc + Math.min(5, Math.max(1, Number(a.stars) || 5)), 0);
  const avgStars = Math.round((starSum / totalQuestions) * 10) / 10;
  const roundedStars = Math.min(5, Math.max(1, Math.round(avgStars)));
  // Weight both Yes/No agreement (30%) and star satisfaction (70%) cleanly
  const starPct = (starSum / (totalQuestions * 5)) * 100;
  const yesPct = (yesCount / totalQuestions) * 100;
  const satisfactionPct = Math.round(starPct * 0.7 + yesPct * 0.3);

  return {
    totalQuestions,
    yesCount,
    noCount,
    avgStars,
    roundedStars,
    satisfactionPct,
  };
}

export async function requestAiParentReviewDraft(params: {
  studentName?: string;
  className?: string;
  parentName?: string;
  language: 'hi' | 'hinglish' | 'en';
  overallRating: number;
  satisfactionPct: number;
  surveyResponses: SurveyQuestionAnswer[];
}): Promise<string> {
  const res = await fetch('/api/ai-parent-review-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(25000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success || !json?.draft) {
    throw new Error(json?.error || `AI अनुरोध असफल रहा (HTTP ${res.status})`);
  }
  return String(json.draft).trim();
}

function normalizeReviewRecord(raw: any, index = 0): ParentReviewRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const reviewText = String(raw.reviewText ?? raw.Review_Text ?? '').trim();
  if (!reviewText) return null;

  const rawStatus = String(raw.status ?? raw.Status ?? 'pending').trim().toLowerCase();
  const status: ReviewStatus =
    rawStatus === 'approved' || rawStatus === 'hidden' ? rawStatus : 'pending';

  const rawSource = String(raw.source ?? raw.Source ?? 'parent_portal').trim().toLowerCase();
  const source: ReviewSource =
    rawSource === 'whatsapp' || rawSource === 'ptm' || rawSource === 'manual'
      ? rawSource
      : 'parent_portal';

  const nowIso = new Date().toISOString();
  return {
    id: String(raw.id ?? raw.Review_ID ?? `REV-${Date.now()}-${index}`).trim(),
    studentId: String(raw.studentId ?? raw.Student_ID ?? '').trim(),
    studentName: String(raw.studentName ?? raw.Student_Name ?? '').trim(),
    className: String(raw.className ?? raw.Class_Name ?? '').trim(),
    parentName: String(raw.parentName ?? raw.Parent_Name ?? '').trim(),
    fatherName: String(raw.fatherName ?? raw.Father_Name ?? '').trim(),
    parentMobile: String(raw.parentMobile ?? raw.Parent_Mobile ?? '').trim(),
    rating: Math.min(5, Math.max(1, Number(raw.rating ?? raw.Rating ?? 5) || 5)),
    category: String(raw.category ?? raw.Highlight_Category ?? 'संपूर्ण अनुभव').trim(),
    reviewText,
    photoUrl: String(raw.photoUrl ?? raw.Parent_Photo ?? ''),
    marketingConsent:
      raw.marketingConsent === true ||
      String(raw.marketingConsent ?? raw.Marketing_Consent ?? '').toUpperCase() === 'TRUE' ||
      String(raw.marketingConsent ?? raw.Marketing_Consent ?? '').toUpperCase() === 'YES',
    status,
    featured:
      raw.featured === true ||
      String(raw.featured ?? raw.Featured ?? '').toUpperCase() === 'TRUE' ||
      String(raw.featured ?? raw.Featured ?? '').toUpperCase() === 'YES',
    source,
    createdAt: String(raw.createdAt ?? raw.Created_At ?? nowIso),
    updatedAt: String(raw.updatedAt ?? raw.Updated_At ?? nowIso),
    surveyAnswers: Array.isArray(raw.surveyAnswers) ? raw.surveyAnswers : undefined,
    yesCount: raw.yesCount !== undefined ? Number(raw.yesCount) : undefined,
    totalQuestions: raw.totalQuestions !== undefined ? Number(raw.totalQuestions) : undefined,
    satisfactionPct: raw.satisfactionPct !== undefined ? Number(raw.satisfactionPct) : undefined,
    _sheetSynced: raw._sheetSynced === true,
  };
}

export function loadLocalParentReviews(): ParentReviewRecord[] {
  try {
    const raw = localStorage.getItem(PARENT_REVIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, idx) => normalizeReviewRecord(item, idx))
      .filter((r): r is ParentReviewRecord => r !== null);
  } catch {
    return [];
  }
}

export function saveLocalParentReviews(reviews: ParentReviewRecord[]): void {
  saveToPhoneMemory(PARENT_REVIEWS_STORAGE_KEY, reviews);
}

export function loadGoogleReviewLink(): string {
  try {
    return localStorage.getItem(GOOGLE_REVIEW_LINK_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveGoogleReviewLink(url: string): void {
  try {
    const clean = url.trim();
    if (clean) localStorage.setItem(GOOGLE_REVIEW_LINK_STORAGE_KEY, clean);
    else localStorage.removeItem(GOOGLE_REVIEW_LINK_STORAGE_KEY);
  } catch {}
}

export async function fetchParentReviewsFromServer(forceRefresh = false): Promise<ParentReviewRecord[]> {
  const activeUrl = getAppsScriptUrl();
  try {
    const res = await fetch(
      `/api/parent-reviews${forceRefresh ? '?fresh=1&' : '?'}_t=${Date.now()}`,
      {
        headers: { 'x-apps-script-url': activeUrl },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json?.reviews)) {
        const clean = json.reviews
          .map((item: any, idx: number) => normalizeReviewRecord(item, idx))
          .filter((r: ParentReviewRecord | null): r is ParentReviewRecord => r !== null);
        saveLocalParentReviews(clean);
        return clean;
      }
    }
  } catch {}

  try {
    const direct = await directGetFromSheet('getParentReviews', activeUrl);
    if (direct.ok && Array.isArray(direct.json?.reviews)) {
      const clean = direct.json.reviews
        .map((item: any, idx: number) => normalizeReviewRecord(item, idx))
        .filter((r: ParentReviewRecord | null): r is ParentReviewRecord => r !== null);
      saveLocalParentReviews(clean);
      return clean;
    }
  } catch {}

  return loadLocalParentReviews();
}

export async function submitParentReviewToServer(
  reviewInput: Omit<ParentReviewRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<{
  review: ParentReviewRecord;
  reviews: ParentReviewRecord[];
  sheetSynced: boolean;
  sheetError?: string;
}> {
  const nowIso = new Date().toISOString();
  const fullReview: ParentReviewRecord = {
    ...reviewInput,
    id: reviewInput.id || `REV-${Date.now()}`,
    createdAt: nowIso,
    updatedAt: nowIso,
    rating: Math.min(5, Math.max(1, Number(reviewInput.rating || 5))),
  };

  const existingLocal = loadLocalParentReviews();
  const filteredLocal = existingLocal.filter((r) => r.id !== fullReview.id);
  const optimisticList = [fullReview, ...filteredLocal];
  saveLocalParentReviews(optimisticList);

  try {
    const syncRes = await dualSyncWriteToSheet({
      apiPath: '/api/parent-reviews',
      apiBody: { review: fullReview },
      directPayload: {
        action: 'saveParentReview',
        review: JSON.stringify(fullReview),
      },
    });

    if (Array.isArray(syncRes.data?.reviews)) {
      const clean = syncRes.data.reviews
        .map((item: any, idx: number) => normalizeReviewRecord(item, idx))
        .filter((r: ParentReviewRecord | null): r is ParentReviewRecord => r !== null);
      saveLocalParentReviews(clean);
      const saved = clean.find((r) => r.id === fullReview.id) || fullReview;
      return {
        review: saved,
        reviews: clean,
        sheetSynced: syncRes.sheetSynced,
        sheetError: syncRes.sheetError,
      };
    }

    return {
      review: fullReview,
      reviews: optimisticList,
      sheetSynced: syncRes.sheetSynced,
      sheetError: syncRes.sheetError,
    };
  } catch (err: any) {
    return {
      review: fullReview,
      reviews: optimisticList,
      sheetSynced: false,
      sheetError: err?.message || 'Sync error',
    };
  }
}

export async function updateParentReviewOnServer(
  review: ParentReviewRecord,
  patch: Partial<Pick<ParentReviewRecord, 'status' | 'featured' | 'marketingConsent' | 'reviewText' | 'rating' | 'category' | 'parentName'>>
): Promise<{
  reviews: ParentReviewRecord[];
  sheetSynced: boolean;
  sheetError?: string;
}> {
  const updatedReview: ParentReviewRecord = {
    ...review,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  const currentList = loadLocalParentReviews();
  const optimistic = currentList.map((r) => (r.id === review.id ? updatedReview : r));
  saveLocalParentReviews(optimistic);

  const isStatusOnly =
    patch.reviewText === undefined &&
    patch.rating === undefined &&
    patch.category === undefined &&
    patch.parentName === undefined;

  try {
    const syncRes = await dualSyncWriteToSheet({
      apiPath: '/api/parent-reviews',
      apiBody: { review: updatedReview, statusOnly: isStatusOnly },
      directPayload: isStatusOnly
        ? {
            action: 'updateParentReviewStatus',
            reviewId: updatedReview.id,
            status: updatedReview.status,
            featured: String(updatedReview.featured),
            marketingConsent: String(updatedReview.marketingConsent),
          }
        : {
            action: 'saveParentReview',
            review: JSON.stringify(updatedReview),
          },
    });

    if (Array.isArray(syncRes.data?.reviews)) {
      const clean = syncRes.data.reviews
        .map((item: any, idx: number) => normalizeReviewRecord(item, idx))
        .filter((r: ParentReviewRecord | null): r is ParentReviewRecord => r !== null);
      saveLocalParentReviews(clean);
      return {
        reviews: clean,
        sheetSynced: syncRes.sheetSynced,
        sheetError: syncRes.sheetError,
      };
    }

    return {
      reviews: optimistic,
      sheetSynced: syncRes.sheetSynced,
      sheetError: syncRes.sheetError,
    };
  } catch (err: any) {
    return {
      reviews: optimistic,
      sheetSynced: false,
      sheetError: err?.message || 'Sync error',
    };
  }
}

export async function deleteParentReviewOnServer(reviewId: string): Promise<{
  reviews: ParentReviewRecord[];
  sheetSynced: boolean;
}> {
  const currentList = loadLocalParentReviews();
  const optimistic = currentList.filter((r) => r.id !== reviewId);
  saveLocalParentReviews(optimistic);

  const activeUrl = getAppsScriptUrl();
  let sheetSynced = false;

  try {
    const res = await fetch(`/api/parent-reviews/${encodeURIComponent(reviewId)}`, {
      method: 'DELETE',
      headers: { 'x-apps-script-url': activeUrl },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json = await res.json();
      sheetSynced = Boolean(json?.sheetSynced);
      if (Array.isArray(json?.reviews)) {
        const clean = json.reviews
          .map((item: any, idx: number) => normalizeReviewRecord(item, idx))
          .filter((r: ParentReviewRecord | null): r is ParentReviewRecord => r !== null);
        saveLocalParentReviews(clean);
        return { reviews: clean, sheetSynced };
      }
    }
  } catch {
    try {
      await dualSyncWriteToSheet({
        apiPath: `/api/parent-reviews/${encodeURIComponent(reviewId)}`,
        apiBody: { reviewId },
        directPayload: { action: 'deleteParentReview', reviewId, id: reviewId },
      });
    } catch {}
  }

  return { reviews: optimistic, sheetSynced };
}

/**
 * Compresses an uploaded parent photo cleanly under ~35KB so it stores
 * reliably inside Google Sheets cells and renders crisply on 1080px marketing cards.
 */
export function compressReviewPhoto(file: File, maxDim = 360, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h >= w && h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function buildWhatsappReviewInviteMessage(
  parentName?: string,
  studentName?: string,
  googleReviewLink?: string
): string {
  const greeting = parentName ? `आदरणीय ${parentName} जी,` : 'आदरणीय अभिभावक जी,';
  const childLine = studentName
    ? `${studentName} के अभिभावक के रूप में आपका अनुभव हमारे लिए अत्यंत महत्वपूर्ण है।`
    : 'E.V.S. Public School परिवार में आपका अनुभव हमारे लिए अत्यंत महत्वपूर्ण है।';
  const linkBlock = googleReviewLink?.trim()
    ? `\n\n📍 *Google पर भी 5-Star रिव्यू दें:*\n${googleReviewLink.trim()}`
    : '';

  return `${greeting}\n🙏 *E.V.S. Public School (Chilkana Sultanpur)* की ओर से नमस्कार!\n\n${childLine}\n\nकृपया केवल 30 सेकंड निकालकर स्कूल के ऐप (Parent Portal → "⭐ 10. रिव्यू दें") में या इसी मैसेज के जवाब में इन 3 बातों पर अपना बहुमूल्य अनुभव लिखें:\n1️⃣ बच्चे की पढ़ाई और लिखावट में कैसा सुधार लगा?\n2️⃣ शिक्षकों का व्यवहार और स्कूल ऐप सुविधा कैसी लगी?\n3️⃣ क्या आप अन्य अभिभावकों को EVS School की सलाह देंगे?${linkBlock}\n\nसादर धन्यवाद,\n*प्रधानाचार्य एवं प्रबंधन — E.V.S. Public School*`;
}

export function buildSocialMarketingCaption(review: ParentReviewRecord): string {
  const stars = '⭐'.repeat(Math.min(5, Math.max(1, review.rating)));
  const parentTitle = review.parentName || (review.fatherName ? `श्री ${review.fatherName}` : 'अभिभावक');
  const studentMeta = [review.studentName, review.className].filter(Boolean).join(' · ');

  return `${stars} *अभिभावक विश्वास — E.V.S. Public School* ${stars}\n\n"${review.reviewText}"\n\n— *${parentTitle}*${studentMeta ? ` (${studentMeta})` : ''}\n\n🎓 *Admissions Open (Session 2026-27)* | Play Group to Class 8th\n✅ अनुभवी शिक्षक · डिजिटल लाइव ऐप · सुरक्षित वैन ट्रैकिंग\n📍 Saharanpur Road, Chilkana Sultanpur (UP)\n\n#EVSPublicSchool #ParentTestimonial #AdmissionsOpen #BestSchoolChilkana`;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.replace(/\r/g, '').split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function loadCanvasImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface PosterGeneratorOptions {
  theme?: PosterThemeId;
  headline?: string;
  admissionBanner?: string;
  schoolPhone?: string;
  studentPhotoFallback?: string;
}

/**
 * Renders a crisp 1080×1080 square social-ready Marketing Testimonial Poster
 * (works on WhatsApp Status, Instagram, Facebook, Admission pamphlets).
 */
export async function generateTestimonialPosterDataUrl(
  review: ParentReviewRecord,
  options: PosterGeneratorOptions = {}
): Promise<string> {
  const W = 1080;
  const H = 1080;
  const theme: PosterThemeId = options.theme || 'royal_navy';
  const isNavy = theme === 'royal_navy';

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize canvas');

  // Palette
  const bgPrimary = isNavy ? '#0C2340' : '#FAF7F0';
  const bgSecondary = isNavy ? '#13315C' : '#F3EDE0';
  const cardSurface = isNavy ? '#FFFFFF' : '#FFFFFF';
  const borderGold = '#E5A00D';
  const textHeading = isNavy ? '#FFFFFF' : '#0C2340';
  const textSub = isNavy ? '#CBD5E1' : '#475569';
  const quoteTextColor = '#0F172A';
  const accentBlue = '#1D4ED8';

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, bgPrimary);
  grad.addColorStop(1, bgSecondary);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Outer editorial hairline frame
  ctx.strokeStyle = isNavy ? 'rgba(229, 160, 13, 0.45)' : 'rgba(12, 35, 64, 0.18)';
  ctx.lineWidth = 3;
  drawRoundedRectPath(ctx, 28, 28, W - 56, H - 56, 28);
  ctx.stroke();

  // Top Header Strip: School Emblem + Brand Name + Session Tag
  ctx.fillStyle = borderGold;
  drawRoundedRectPath(ctx, 72, 68, 72, 72, 18);
  ctx.fill();

  ctx.fillStyle = '#0C2340';
  ctx.font = '800 32px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EVS', 108, 105);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = textHeading;
  ctx.font = '800 36px "Plus Jakarta Sans", "Noto Sans Devanagari", sans-serif';
  ctx.fillText('E.V.S. PUBLIC SCHOOL', 164, 100);

  ctx.fillStyle = textSub;
  ctx.font = '600 21px "Plus Jakarta Sans", "Noto Sans Devanagari", sans-serif';
  ctx.fillText('Chilkana Sultanpur, Saharanpur · English Medium', 164, 132);

  // Top-right Editorial Label
  ctx.fillStyle = isNavy ? 'rgba(229, 160, 13, 0.16)' : 'rgba(12, 35, 64, 0.08)';
  drawRoundedRectPath(ctx, 736, 74, 272, 52, 12);
  ctx.fill();
  ctx.strokeStyle = isNavy ? 'rgba(229, 160, 13, 0.55)' : 'rgba(12, 35, 64, 0.2)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = isNavy ? '#FCD34D' : '#0C2340';
  ctx.font = '700 20px "Plus Jakarta Sans", "Noto Sans Devanagari", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(options.headline || 'अभिभावक विश्वास संदेश', 872, 107);

  // Main White Editorial Testimonial Card
  const cardX = 72;
  const cardY = 178;
  const cardW = W - 144;
  const cardH = 684;

  ctx.save();
  ctx.shadowColor = isNavy ? 'rgba(0, 0, 0, 0.28)' : 'rgba(15, 23, 42, 0.10)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = cardSurface;
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = isNavy ? 'rgba(229, 160, 13, 0.4)' : '#E2E8F0';
  ctx.lineWidth = 2;
  drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.stroke();

  // Subtle top accent bar inside card
  ctx.fillStyle = borderGold;
  drawRoundedRectPath(ctx, cardX + 48, cardY, cardW - 96, 6, 3);
  ctx.fill();

  // Stars & Highlight Category Row
  const starCount = Math.min(5, Math.max(1, Number(review.rating) || 5));
  ctx.textAlign = 'left';
  ctx.font = '700 34px sans-serif';
  let starX = cardX + 56;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i < starCount ? '#F59E0B' : '#E2E8F0';
    ctx.fillText('★', starX, cardY + 78);
    starX += 42;
  }

  ctx.fillStyle = '#0F172A';
  ctx.font = '800 24px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`${starCount}.0 / 5.0`, starX + 8, cardY + 75);

  ctx.textAlign = 'right';
  ctx.fillStyle = accentBlue;
  ctx.font = '700 22px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`✦ ${review.category || 'संपूर्ण अनुभव'}`, cardX + cardW - 56, cardY + 74);

  // Oversized Decorative Quote Mark
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(229, 160, 13, 0.25)';
  ctx.font = '900 120px Georgia, serif';
  ctx.fillText('“', cardX + 46, cardY + 190);

  // Review Quote Text (dynamic font size based on length)
  const quoteLen = review.reviewText.length;
  const quoteFontSize = quoteLen > 260 ? 27 : quoteLen > 170 ? 31 : 36;
  const quoteLineHeight = quoteLen > 260 ? 42 : quoteLen > 170 ? 48 : 54;

  ctx.fillStyle = quoteTextColor;
  ctx.font = `600 ${quoteFontSize}px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif`;
  const maxTextW = cardW - 120;
  const lines = wrapCanvasText(ctx, review.reviewText, maxTextW).slice(0, 7);

  let textY = cardY + 210;
  for (const line of lines) {
    ctx.fillText(line, cardX + 60, textY);
    textY += quoteLineHeight;
  }

  // Divider above Parent Profile
  const attrTopY = cardY + cardH - 178;
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 56, attrTopY);
  ctx.lineTo(cardX + cardW - 56, attrTopY);
  ctx.stroke();

  // Parent Photo / Avatar
  const avatarX = cardX + 56;
  const avatarY = attrTopY + 32;
  const avatarSize = 112;
  const imgSrc = review.photoUrl || options.studentPhotoFallback || '';
  const loadedImg = await loadCanvasImage(imgSrc);

  if (loadedImg) {
    ctx.save();
    drawRoundedRectPath(ctx, avatarX, avatarY, avatarSize, avatarSize, 22);
    ctx.clip();
    // Cover fit
    const scale = Math.max(avatarSize / loadedImg.width, avatarSize / loadedImg.height);
    const dw = loadedImg.width * scale;
    const dh = loadedImg.height * scale;
    ctx.drawImage(
      loadedImg,
      avatarX + (avatarSize - dw) / 2,
      avatarY + (avatarSize - dh) / 2,
      dw,
      dh
    );
    ctx.restore();
    ctx.strokeStyle = borderGold;
    ctx.lineWidth = 3;
    drawRoundedRectPath(ctx, avatarX, avatarY, avatarSize, avatarSize, 22);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#0C2340';
    drawRoundedRectPath(ctx, avatarX, avatarY, avatarSize, avatarSize, 22);
    ctx.fill();
    const displayInitial = (review.parentName || review.studentName || 'EVS')
      .trim()
      .slice(0, 2)
      .toUpperCase();
    ctx.fillStyle = '#FCD34D';
    ctx.font = '800 38px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayInitial, avatarX + avatarSize / 2, avatarY + avatarSize / 2 + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Parent Name & Student Attribution
  const metaX = avatarX + avatarSize + 28;
  const parentHeading =
    review.parentName || (review.fatherName ? `श्री ${review.fatherName}` : 'सम्मानित अभिभावक');

  ctx.fillStyle = '#0C2340';
  ctx.font = '800 32px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(parentHeading, metaX, avatarY + 42);

  const subParts = [
    review.studentName ? `अभिभावक: ${review.studentName}` : '',
    review.className ? `कक्षा ${review.className}` : '',
  ].filter(Boolean);
  ctx.fillStyle = '#475569';
  ctx.font = '600 22px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    subParts.length > 0 ? subParts.join('  ·  ') : 'Verified School Parent',
    metaX,
    avatarY + 78
  );

  ctx.fillStyle = review.marketingConsent ? '#047857' : '#64748B';
  ctx.font = '700 18px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif';
  const trustLabel =
    review.totalQuestions && review.yesCount !== undefined
      ? `✓ प्रमाणित अभिभावक · ${review.yesCount}/${review.totalQuestions} सकारात्मक मानक (${review.satisfactionPct || 100}% संतुष्ट)`
      : review.marketingConsent
      ? '✓ प्रमाणित अभिभावक समीक्षा (Verified Parent Consent)'
      : '✓ प्रमाणित अभिभावक समीक्षा';
  ctx.fillText(trustLabel, metaX, avatarY + 108);

  // Bottom Admission Call-To-Action Strip
  const footerY = 900;
  ctx.fillStyle = isNavy ? 'rgba(255, 255, 255, 0.1)' : '#0C2340';
  drawRoundedRectPath(ctx, 72, footerY, W - 144, 114, 22);
  ctx.fill();

  ctx.fillStyle = '#FCD34D';
  ctx.font = '800 28px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    options.admissionBanner || '🎓 प्रवेश प्रारंभ (Admissions Open 2026–27) · Play Group से 8th तक',
    104,
    footerY + 48
  );

  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 21px "Noto Sans Devanagari", "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    options.schoolPhone
      ? `📞 संपर्क: ${options.schoolPhone}  ·  Saharanpur Road, Chilkana Sultanpur`
      : '✨ अनुभवी शिक्षक  ·  डिजिटल होमवर्क व फीस ऐप  ·  सुरक्षित लाइव बस ट्रैकिंग',
    104,
    footerY + 86
  );

  return canvas.toDataURL('image/png');
}

export async function downloadTestimonialPosterPng(
  review: ParentReviewRecord,
  options: PosterGeneratorOptions = {}
): Promise<string> {
  const dataUrl = await generateTestimonialPosterDataUrl(review, options);
  const a = document.createElement('a');
  const safeName = (review.parentName || review.studentName || 'parent')
    .replace(/[^a-zA-Z0-9\u0900-\u097F_-]+/g, '_')
    .slice(0, 28);
  a.href = dataUrl;
  a.download = `EVS_Review_Poster_${safeName || 'Card'}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return dataUrl;
}
