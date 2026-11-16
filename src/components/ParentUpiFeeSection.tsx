import React, { useEffect, useState, useMemo } from 'react';
import { Student, UpiPaymentRequest, UpiSettings } from '../types';
import {
  DEFAULT_UPI_SETTINGS,
  loadLocalUpiSettings,
  fetchUpiSettingsFromServer,
  fetchUpiPaymentsFromServer,
  submitUpiPaymentToServer,
  subscribeUpiUpdates,
  buildUpiIntentUri,
  compressReceiptImageFile,
} from '../utils/upiFeeHelper';

interface ParentUpiFeeSectionProps {
  student: Student;
  pendingDue: number;
  monthlyTuition: number;
  getClassName: (c?: string | null) => string;
  onFeeSynced?: () => void;
}

const FEE_HEAD_OPTIONS = [
  'Monthly Tuition Fee',
  'Admission Fee',
  'Examination Fee',
  'Annual Charges',
  'Transportation / Bus Fee',
  'Books & Stationery',
  'Advance Fee Deposit',
  'Other',
];

const MONTH_OPTIONS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
  'Full Academic Session', 'Advance Deposit',
];

export const ParentUpiFeeSection: React.FC<ParentUpiFeeSectionProps> = ({
  student,
  pendingDue,
  monthlyTuition,
  getClassName,
  onFeeSynced,
}) => {
  const [upiSettings, setUpiSettings] = useState<UpiSettings>(() => loadLocalUpiSettings());
  const [payments, setPayments] = useState<UpiPaymentRequest[]>([]);
  const [loadingPayments, setLoadingPayments] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  // Payment Form State
  const defaultSuggestedAmount = pendingDue > 0 ? pendingDue : monthlyTuition > 0 ? monthlyTuition : 500;
  const [amount, setAmount] = useState<string>(String(defaultSuggestedAmount));
  const [feeType, setFeeType] = useState<string>('Monthly Tuition Fee');
  const [month, setMonth] = useState<string>(() => {
    const m = new Date().toLocaleString('en-US', { month: 'long' });
    return MONTH_OPTIONS.includes(m) ? m : 'April';
  });
  const [utrNumber, setUtrNumber] = useState<string>('');
  const [paymentApp, setPaymentApp] = useState<string>('PhonePe');
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [payerName, setPayerName] = useState<string>(student.Father_Name || '');
  const [notes, setNotes] = useState<string>('');
  const [screenshotData, setScreenshotData] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync suggested amount when switching student or balance changes
  useEffect(() => {
    const nextAmt = pendingDue > 0 ? pendingDue : monthlyTuition > 0 ? monthlyTuition : 500;
    setAmount(String(nextAmt));
    setPayerName(student.Father_Name || '');
  }, [student.Student_ID, pendingDue, monthlyTuition, student.Father_Name]);

  const loadAll = async () => {
    setLoadingPayments(true);
    try {
      const [settingsRes, paymentsRes] = await Promise.all([
        fetchUpiSettingsFromServer(),
        fetchUpiPaymentsFromServer(student.Student_ID),
      ]);
      setUpiSettings(settingsRes);
      setPayments(paymentsRes);
    } finally {
      setLoadingPayments(false);
    }
  };

  useEffect(() => {
    loadAll();
    const unsub = subscribeUpiUpdates((kind) => {
      if (kind === 'settings' || kind === 'all') {
        fetchUpiSettingsFromServer().then(setUpiSettings).catch(() => {});
      }
      if (kind === 'payments' || kind === 'all') {
        fetchUpiPaymentsFromServer(student.Student_ID)
          .then((list) => {
            setPayments(list);
            if (list.some((p) => p.status === 'Approved') && onFeeSynced) {
              onFeeSynced();
            }
          })
          .catch(() => {});
      }
    });
    return unsub;
  }, [student.Student_ID]);

  const numericAmount = Math.max(0, Number(amount) || 0);
  const hasConfiguredUpi = Boolean(upiSettings.upiId?.trim());
  const upiIntentUri = useMemo(() => {
    if (!hasConfiguredUpi) return '';
    return buildUpiIntentUri({
      upiId: upiSettings.upiId,
      payeeName: upiSettings.payeeName || 'E.V.S. Public School',
      amount: numericAmount,
      note: `${student.Student_Name} Fee ${student.Student_ID}`,
    });
  }, [upiSettings, numericAmount, student.Student_Name, student.Student_ID, hasConfiguredUpi]);

  // Generate dynamic QR Code image using qrcode package
  useEffect(() => {
    let active = true;
    if (!upiIntentUri) {
      setQrDataUrl('');
      return;
    }
    import('qrcode')
      .then((QRCodeLib) => QRCodeLib.toDataURL(upiIntentUri, { width: 240, margin: 2 }))
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [upiIntentUri]);

  const handleCopyUpi = async () => {
    if (!upiSettings.upiId) return;
    try {
      await navigator.clipboard.writeText(upiSettings.upiId);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = upiSettings.upiId;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2500);
  };

  const handleScreenshotChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressReceiptImageFile(file);
      setScreenshotData(compressed);
    } catch {
      setFeedback({ type: 'error', text: 'स्क्रीनशॉट पढ़ने में त्रुटि हुई, कृपया सही फोटो चुनें।' });
    }
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setFeedback({ type: 'error', text: 'कृपया ₹1 या उससे अधिक की वैध भुगतान राशि दर्ज करें।' });
      return;
    }
    if (!utrNumber.trim() || utrNumber.trim().length < 6) {
      setFeedback({ type: 'error', text: 'कृपया कम से कम 6+ अंकों का सही UTR / Transaction ID दर्ज करें।' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitUpiPaymentToServer({
        studentId: student.Student_ID,
        studentName: student.Student_Name,
        className: getClassName(student.Class),
        parentMobile: String(student.Parent_Mobile || ''),
        payerName: payerName.trim() || student.Father_Name || 'Parent',
        amount: amt,
        feeType,
        month,
        utrNumber: utrNumber.trim(),
        paymentApp,
        paymentDate,
        screenshotData,
        notes: notes.trim(),
      });

      if (!res.success) {
        setFeedback({ type: 'error', text: res.error || 'सबमिशन विफल रहा।' });
        return;
      }

      setUtrNumber('');
      setNotes('');
      setScreenshotData('');
      setFeedback({
        type: 'success',
        text: 'आपका UPI भुगतान विवरण सफलतापूर्वक कार्यालय भेज दिया गया है! मैनेजर द्वारा सत्यापित होते ही पक्की रसीद यहाँ दिखेगी।',
      });
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = payments.filter((p) => p.status === 'Pending').length;

  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/50 via-white to-emerald-50/40 p-4 sm:p-5 space-y-5">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-indigo-100">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0c2340] text-amber-300 flex items-center justify-center text-lg shrink-0">
            <i className="fa-solid fa-qrcode"></i>
          </div>
          <div>
            <h5 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2 flex-wrap">
              <span>ऑनलाइन UPI / QR द्वारा फीस जमा करें</span>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold">
                  {pendingCount} सत्यापन लंबित
                </span>
              )}
            </h5>
            <p className="text-[11px] text-slate-500">
              PhonePe, Google Pay, Paytm या किसी भी UPI ऐप से सीधे स्कूल खाते में फीस भेजें व UTR नंबर जमा करें
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer"
        >
          <i className={`fa-solid fa-rotate ${loadingPayments ? 'fa-spin text-indigo-700' : ''}`}></i>
          <span>स्टेटस जांचें</span>
        </button>
      </div>

      {/* Main 2-Column Grid: QR Scan + Payment Proof Submission */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT: QR CODE & DIRECT UPI INTENT */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-col items-center justify-between text-center space-y-3.5 shadow-2xs">
          {hasConfiguredUpi || upiSettings.staticQrImage ? (
            <>
              <div className="w-full flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">{upiSettings.payeeName || 'E.V.S. Public School'}</span>
                {upiSettings.bankName && (
                  <span className="text-[11px] font-semibold text-slate-500">{upiSettings.bankName}</span>
                )}
              </div>

              {/* QR Display */}
              <div className="p-3 bg-white border-2 border-[#0c2340] rounded-2xl shadow-xs">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="School Fee UPI QR Code"
                    className="w-44 h-44 sm:w-48 sm:h-48 object-contain"
                  />
                ) : upiSettings.staticQrImage ? (
                  <img
                    src={upiSettings.staticQrImage}
                    alt="School Static UPI QR"
                    className="w-44 h-44 sm:w-48 sm:h-48 object-contain"
                  />
                ) : (
                  <div className="w-44 h-44 flex items-center justify-center text-slate-400 text-xs">
                    QR लोड हो रहा है...
                  </div>
                )}
              </div>

              {/* Quick Amount Chips */}
              <div className="w-full space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500">त्वरित राशि चुनें (Select Pay Amount):</div>
                <div className="flex flex-wrap justify-center gap-1.5 tabular-nums">
                  {pendingDue > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(pendingDue))}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                        Number(amount) === pendingDue
                          ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                          : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                      }`}
                    >
                      पूरा बकाया: ₹{pendingDue.toLocaleString('en-IN')}
                    </button>
                  )}
                  {monthlyTuition > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(monthlyTuition))}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                        Number(amount) === monthlyTuition
                          ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                          : 'bg-blue-50 text-blue-900 border-blue-200 hover:bg-blue-100'
                      }`}
                    >
                      1 माह: ₹{monthlyTuition.toLocaleString('en-IN')}
                    </button>
                  )}
                </div>
              </div>

              {/* UPI ID + Copy */}
              {hasConfiguredUpi && (
                <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="truncate text-left">
                    <span className="text-[10px] text-slate-400 block">स्कूल UPI ID:</span>
                    <span className="font-mono font-bold text-slate-900">{upiSettings.upiId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyUpi}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-bold text-slate-700 cursor-pointer shrink-0"
                  >
                    {copiedUpi ? 'Copied ✓' : 'Copy ID'}
                  </button>
                </div>
              )}

              {/* Direct UPI App Launch Link */}
              {hasConfiguredUpi && upiIntentUri && (
                <a
                  href={upiIntentUri}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
                >
                  <i className="fa-solid fa-mobile-screen-button"></i>
                  <span>
                    UPI ऐप खोलें व ₹{numericAmount.toLocaleString('en-IN')} भुगतान करें
                  </span>
                </a>
              )}

              <p className="text-[11px] text-slate-500 leading-relaxed">
                {upiSettings.instructions || DEFAULT_UPI_SETTINGS.instructions}
              </p>
            </>
          ) : (
            <div className="py-10 px-4 space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-2xl mx-auto">
                <i className="fa-solid fa-building-columns"></i>
              </div>
              <h6 className="font-extrabold text-sm text-slate-800">
                स्कूल UPI ID सेटअप प्रतीक्षित है
              </h6>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                विद्यालय कार्यालय द्वारा जैसे ही स्कूल का आधिकारिक UPI ID / QR जोड़ा जाएगा, यहाँ डायनामिक पेमेंट QR कोड स्वतः उपलब्ध हो जाएगा। यदि आपने बैंक/UPI से शुल्क भेजा है तो दाहिनी ओर UTR विवरण दर्ज कर सकते हैं।
              </p>
            </div>
          )}
        </div>

        {/* RIGHT: PAYMENT PROOF FORM */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs">
          <h6 className="font-black text-slate-900 text-sm mb-1 flex items-center gap-2">
            <i className="fa-solid fa-receipt text-indigo-600"></i>
            <span>भुगतान के बाद UTR व रसीद प्रमाण जमा करें</span>
          </h6>
          <p className="text-[11px] text-slate-500 mb-4">
            सफल UPI ट्रांजैक्शन के बाद प्राप्त 12 अंकों का UTR / Ref No दर्ज करें — प्रबंधक सत्यापन के बाद पक्की रसीद स्वतः खाते में जुड़ जाएगी।
          </p>

          {feedback && (
            <div
              className={`mb-4 p-3 rounded-xl text-xs font-semibold flex items-start gap-2 border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-rose-50 border-rose-300 text-rose-900'
              }`}
            >
              <i
                className={`fa-solid ${
                  feedback.type === 'success' ? 'fa-circle-check text-emerald-600' : 'fa-circle-exclamation text-rose-600'
                } mt-0.5`}
              ></i>
              <span>{feedback.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmitProof} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  भुगतान राशि (Amount ₹) *
                </label>
                <input
                  type="number"
                  min="1"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-black text-sm text-emerald-800 outline-none focus:border-blue-900 tabular-nums"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">शुल्क मद (Fee Type)</label>
                <select
                  value={feeType}
                  onChange={(e) => setFeeType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none focus:border-blue-900"
                >
                  {FEE_HEAD_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">माह / अवधि (Month)</label>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none focus:border-blue-900"
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  UTR / Transaction ID (12 अंक) *
                </label>
                <input
                  type="text"
                  required
                  value={utrNumber}
                  onChange={(e) => setUtrNumber(e.target.value)}
                  placeholder="उदा. 431928475612"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono font-bold outline-none focus:border-blue-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">UPI ऐप (Payment App)</label>
                <select
                  value={paymentApp}
                  onChange={(e) => setPaymentApp(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none focus:border-blue-900"
                >
                  <option value="PhonePe">PhonePe</option>
                  <option value="Google Pay">Google Pay</option>
                  <option value="Paytm">Paytm</option>
                  <option value="BHIM / Bank UPI">BHIM / Bank UPI</option>
                  <option value="Other UPI">Other UPI App</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">भुगतान दिनांक (Date)</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-blue-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">भेजने वाले का नाम (Payer Name)</label>
                <input
                  type="text"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="अभिभावक का नाम"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-blue-900"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  भुगतान स्क्रीनशॉट (Optional Screenshot)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleScreenshotChange}
                  className="w-full text-[11px] file:mr-2.5 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-800 hover:file:bg-indigo-100 cursor-pointer"
                />
                {screenshotData && (
                  <div className="mt-2 flex items-center gap-2">
                    <img
                      src={screenshotData}
                      alt="Screenshot preview"
                      onClick={() => setPreviewImg(screenshotData)}
                      className="w-12 h-12 rounded-lg object-cover border border-slate-300 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setScreenshotData('')}
                      className="text-[11px] text-rose-600 font-bold hover:underline cursor-pointer"
                    >
                      हटाएं
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">टिप्पणी (Notes)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="उदा. सितंबर व अक्टूबर फीस"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-blue-900"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-black text-xs flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
              >
                <i className={`fa-solid ${submitting ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i>
                <span>{submitting ? 'भेजा जा रहा है...' : 'भुगतान सत्यापन के लिए भेजें'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* PARENT'S SUBMITTED UPI PAYMENTS TRACKER */}
      {payments.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h6 className="font-extrabold text-xs sm:text-sm text-slate-900 flex items-center gap-2">
              <i className="fa-solid fa-clock-rotate-left text-indigo-600"></i>
              <span>मेरे ऑनलाइन UPI भुगतान आवेदन ({payments.length})</span>
            </h6>
          </div>

          <div className="space-y-2">
            {payments.map((pay) => (
              <div
                key={pay.id}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap tabular-nums">
                    <span className="font-black text-slate-900 text-sm">
                      ₹{Number(pay.amount || 0).toLocaleString('en-IN')}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-bold text-slate-700">
                      {pay.feeType} ({pay.month})
                    </span>
                    <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                      UTR: {pay.utrNumber}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                    <span>{pay.paymentApp || 'UPI'}</span>
                    <span>·</span>
                    <span>{pay.paymentDate}</span>
                    {pay.receiptNumber && (
                      <>
                        <span>·</span>
                        <span className="font-mono font-bold text-emerald-700">रसीद #{pay.receiptNumber}</span>
                      </>
                    )}
                    {pay.managerNote && (
                      <>
                        <span>·</span>
                        <span className="text-rose-700 font-semibold">कार्यालय नोट: {pay.managerNote}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {pay.screenshotData && (
                    <button
                      type="button"
                      onClick={() => setPreviewImg(pay.screenshotData || null)}
                      className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-[11px] font-bold text-slate-700 cursor-pointer"
                    >
                      <i className="fa-regular fa-image mr-1"></i>फोटो
                    </button>
                  )}

                  {pay.status === 'Pending' && (
                    <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold">
                      ⏳ सत्यापन लंबित
                    </span>
                  )}
                  {pay.status === 'Approved' && (
                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold">
                      ✅ स्वीकृत व रसीद जारी
                    </span>
                  )}
                  {pay.status === 'Rejected' && (
                    <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-900 border border-rose-300 text-[11px] font-bold">
                      ❌ अस्वीकृत
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lightbox for Screenshot Preview */}
      {previewImg && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 flex items-start justify-center p-4"
          onClick={() => setPreviewImg(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full my-auto max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-[#0c2340] text-white flex items-center justify-between shrink-0">
              <span className="font-bold text-xs">भुगतान स्क्रीनशॉट (Payment Proof)</span>
              <button
                type="button"
                onClick={() => setPreviewImg(null)}
                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex items-center justify-center bg-slate-50">
              <img src={previewImg} alt="Payment proof" className="max-h-[72vh] rounded-xl object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
