import React, { useEffect, useMemo, useState } from 'react';
import { FeePromiseRecord, Student } from '../types';
import { getLocalDateYMD } from '../utils/localTime';
import {
  ensureWebPushSubscribed,
  formatPromiseDateDisplay,
  getEffectivePromiseState,
  saveFeePromiseToServer,
} from '../utils/feePromiseHelper';
import {
  getNotificationPermission,
  isNotificationSupported,
  requestDeviceNotificationPermission,
  showDeviceNotification,
} from '../utils/notificationService';

interface ParentFeePromiseCardProps {
  student: Student;
  pendingDue: number;
  getClassName: (c?: string | null) => string;
  promises: FeePromiseRecord[];
  onPromisesUpdated: (nextList: FeePromiseRecord[]) => void;
  onPayPromisedAmount: (amount: number) => void;
}

const addDaysYmd = (baseYmd: string, days: number): string => {
  const parts = baseYmd.split('-').map(Number);
  const d = new Date(parts[0], (parts[1] || 1) - 1, (parts[2] || 1) + days);
  return getLocalDateYMD(d);
};

const getNextMonthDayYmd = (dayOfMonth: number): string => {
  const now = new Date();
  let target = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
  if (getLocalDateYMD(target) <= getLocalDateYMD(now)) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth);
  }
  return getLocalDateYMD(target);
};

export const ParentFeePromiseCard: React.FC<ParentFeePromiseCardProps> = ({
  student,
  pendingDue,
  getClassName,
  promises,
  onPromisesUpdated,
  onPayPromisedAmount,
}) => {
  const todayYmd = getLocalDateYMD();
  const maxDateYmd = useMemo(() => addDaysYmd(todayYmd, 45), [todayYmd]);

  const studentPromises = useMemo(() => {
    const sid = String(student.Student_ID || '').trim().toLowerCase();
    return promises.filter((p) => String(p.studentId || '').trim().toLowerCase() === sid);
  }, [promises, student.Student_ID]);

  const activePromise = useMemo(
    () => studentPromises.find((p) => p.status === 'Pending') || null,
    [studentPromises]
  );

  const effectiveState = activePromise
    ? getEffectivePromiseState(activePromise, pendingDue, todayYmd)
    : null;

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [promisedDate, setPromisedDate] = useState<string>(() => addDaysYmd(todayYmd, 3));
  const [promisedAmount, setPromisedAmount] = useState<string>(() =>
    String(pendingDue > 0 ? pendingDue : 500)
  );
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermission()
  );

  useEffect(() => {
    setIsEditing(false);
    setFeedback(null);
    if (activePromise) {
      setPromisedDate(activePromise.promisedDate >= todayYmd ? activePromise.promisedDate : addDaysYmd(todayYmd, 2));
      setPromisedAmount(String(activePromise.promisedAmount || pendingDue || 500));
      setNotes(activePromise.notes || '');
    } else {
      setPromisedDate(addDaysYmd(todayYmd, 3));
      setPromisedAmount(String(pendingDue > 0 ? pendingDue : 500));
      setNotes('');
    }
  }, [student.Student_ID, pendingDue]);

  // Don't clutter screen if student has zero dues and no active promise
  if (pendingDue <= 0 && !activePromise) {
    return null;
  }

  const handleEnablePushReminder = async () => {
    if (!isNotificationSupported()) return;
    const perm = await requestDeviceNotificationPermission();
    setNotifPermission(perm);
    if (perm === 'granted') {
      await ensureWebPushSubscribed({
        role: 'parent',
        studentId: student.Student_ID,
        mobile: String(student.Parent_Mobile || ''),
        name: student.Father_Name || student.Student_Name,
      });
      await showDeviceNotification({
        title: '🔔 फीस वादा रिमाइंडर चालू हो गया!',
        body: `तय तारीख को फोन पर अपने आप रिमाइंडर आ जाएगा (${student.Student_Name})।`,
        tag: `promise-notif-enabled-${student.Student_ID}`,
        url: '/',
      });
    }
  };

  const handleSavePromise = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const amtNum = Math.max(0, Number(promisedAmount) || 0);
    if (!amtNum || amtNum < 1) {
      setFeedback({ type: 'error', text: 'कृपया ₹1 या उससे अधिक की वादा राशि दर्ज करें।' });
      return;
    }
    if (!promisedDate || promisedDate < todayYmd) {
      setFeedback({ type: 'error', text: 'कृपया आज या आने वाली कोई वैध तारीख चुनें।' });
      return;
    }

    setSaving(true);
    try {
      const res = await saveFeePromiseToServer({
        studentId: student.Student_ID,
        studentName: student.Student_Name || student.Student_ID,
        className: getClassName(student.Class),
        fatherName: student.Father_Name || '',
        parentMobile: String(student.Parent_Mobile || ''),
        totalDueAtPromise: pendingDue,
        promisedAmount: amtNum,
        promisedDate,
        notes: notes.trim(),
        createdBy: student.Father_Name ? `Parent (${student.Father_Name})` : 'Parent',
      });

      onPromisesUpdated(res.promises);
      setIsEditing(false);

      // Register Web Push automatically if notification permission is already granted
      if (Notification.permission === 'granted') {
        ensureWebPushSubscribed({
          role: 'parent',
          studentId: student.Student_ID,
          mobile: String(student.Parent_Mobile || ''),
          name: student.Father_Name || student.Student_Name,
        }).catch(() => {});
        showDeviceNotification({
          title: '🤝 फीस जमा वादा सुरक्षित हुआ!',
          body: `${student.Student_Name}: ${formatPromiseDateDisplay(promisedDate)} को ₹${amtNum.toLocaleString('en-IN')} जमा करने का रिमाइंडर सेट हो गया है।`,
          tag: `promise-saved-${student.Student_ID}`,
          url: '/',
        }).catch(() => {});
      }

      setFeedback({
        type: 'success',
        text: res.sheetSynced
          ? `✅ वादा सेव हो गया व Google Sheet ('Fee_Promises') में दर्ज हो गया! ${formatPromiseDateDisplay(promisedDate)} को स्वतः रिमाइंडर मिलेगा।`
          : `✅ आपका वादा (${formatPromiseDateDisplay(promisedDate)} को ₹${amtNum.toLocaleString('en-IN')}) सेव हो गया! उस दिन अपने-आप रिमाइंडर दिखेगा।`,
      });
    } catch {
      setFeedback({ type: 'error', text: 'वादा सेव करने में समस्या आई, कृपया पुनः प्रयास करें।' });
    } finally {
      setSaving(false);
    }
  };

  const quickAmounts = [
    pendingDue > 0 ? { label: `पूरा बकाया: ₹${pendingDue.toLocaleString('en-IN')}`, val: pendingDue } : null,
    pendingDue >= 200 ? { label: `आधा (50%): ₹${Math.ceil(pendingDue / 2).toLocaleString('en-IN')}`, val: Math.ceil(pendingDue / 2) } : null,
    { label: '₹500', val: 500 },
    { label: '₹1,000', val: 1000 },
  ].filter(Boolean) as Array<{ label: string; val: number }>;

  const showForm = !activePromise || isEditing || effectiveState === 'fulfilled';

  return (
    <div
      id="parent-fee-promise-section"
      className={`rounded-2xl border-2 p-4 sm:p-5 space-y-4 transition-all ${
        effectiveState === 'due_today'
          ? 'border-amber-400 bg-gradient-to-br from-amber-50 via-white to-rose-50 shadow-md'
          : effectiveState === 'overdue'
          ? 'border-rose-300 bg-gradient-to-br from-rose-50 via-white to-amber-50/40 shadow-sm'
          : 'border-amber-200 bg-gradient-to-br from-amber-50/50 via-white to-indigo-50/30'
      }`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-amber-200/70">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-[#0c2340] text-amber-300 flex items-center justify-center text-lg shrink-0">
            <i className="fa-solid fa-handshake"></i>
          </div>
          <div>
            <h5 className="font-black text-slate-900 text-sm sm:text-base flex items-center gap-2 flex-wrap">
              <span>बकाया फीस जमा करने का वादा (Fee Promise Date)</span>
              {effectiveState === 'due_today' && (
                <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black animate-pulse">
                  🔔 आज वादे की तारीख है!
                </span>
              )}
              {effectiveState === 'overdue' && (
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-black">
                  ⚠️ तारीख निकल गई
                </span>
              )}
              {effectiveState === 'upcoming' && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black">
                  ✓ वादा दर्ज
                </span>
              )}
            </h5>
            <p className="text-[11px] text-slate-600">
              अपनी सुविधा की तारीख चुनें — तय तारीख को फोन पर स्वतः रिमाइंडर मिलेगा और स्कूल रजिस्टर (Google Sheet) में एंट्री दर्ज होगी
            </p>
          </div>
        </div>

        {isNotificationSupported() && notifPermission !== 'granted' && (
          <button
            type="button"
            onClick={handleEnablePushReminder}
            className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs shrink-0"
          >
            <i className="fa-solid fa-bell"></i>
            <span>🔔 ऑटो फोन रिमाइंडर चालू करें</span>
          </button>
        )}
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs font-bold border flex items-start gap-2 ${
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

      {/* Active Promise Summary Card */}
      {activePromise && effectiveState !== 'fulfilled' && !isEditing && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                वर्तमान सक्रिय वादा ({student.Student_Name})
              </div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="text-lg sm:text-xl font-black text-[#0c2340] tabular-nums">
                  📅 {formatPromiseDateDisplay(activePromise.promisedDate)}
                </span>
                <span className="text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg tabular-nums">
                  वादा राशि: ₹{activePromise.promisedAmount.toLocaleString('en-IN')}
                </span>
              </div>
              {activePromise.notes && (
                <p className="text-xs text-slate-600 italic">📝 नोट: {activePromise.notes}</p>
              )}
              <p className="text-[11px] text-slate-500">
                {effectiveState === 'due_today'
                  ? '⏰ आज आपके वादे की तारीख है! कृपया नीचे बटन दबाकर अपनी सुविधा अनुसार UPI से जमा करें।'
                  : effectiveState === 'overdue'
                  ? '⚠️ वादे की तारीख बीत चुकी है — कृपया आज जमा करें या नई तारीख अपडेट करें।'
                  : `🔔 ${formatPromiseDateDisplay(activePromise.promisedDate)} को ऐप और फोन नोटिफिकेशन द्वारा अपने आप याद दिलाया जाएगा।`}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onPayPromisedAmount(activePromise.promisedAmount)}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i className="fa-solid fa-qrcode"></i>
                <span>अभी ₹{activePromise.promisedAmount.toLocaleString('en-IN')} UPI से भरें</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-calendar-pen"></i>
                <span>तारीख बदलें</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Promise Entry / Edit Form */}
      {showForm && pendingDue > 0 && (
        <form onSubmit={handleSavePromise} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3.5 shadow-2xs text-xs">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="font-black text-slate-800 text-xs sm:text-sm">
              {isEditing ? '📅 वादा तारीख व राशि अपडेट करें' : '🤝 नई फीस वादा तारीख चुनें'}
            </span>
            {isEditing && (
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                ✕ रद्द करें
              </button>
            )}
          </div>

          {/* Quick Date Presets */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-500 block">त्वरित तारीख चुनें:</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'कल', date: addDaysYmd(todayYmd, 1) },
                { label: '3 दिन बाद', date: addDaysYmd(todayYmd, 3) },
                { label: '7 दिन बाद', date: addDaysYmd(todayYmd, 7) },
                { label: 'अगली 1 तारीख', date: getNextMonthDayYmd(1) },
                { label: 'अगली 10 तारीख', date: getNextMonthDayYmd(10) },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setPromisedDate(preset.date)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                    promisedDate === preset.date
                      ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {preset.label} ({formatPromiseDateDisplay(preset.date)})
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                जमा करने की तारीख (Promised Date) *
              </label>
              <input
                type="date"
                required
                min={todayYmd}
                max={maxDateYmd}
                value={promisedDate}
                onChange={(e) => setPromisedDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold text-slate-900 outline-none focus:border-blue-900"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                वादा राशि (Amount ₹) *
              </label>
              <input
                type="number"
                min="1"
                required
                value={promisedAmount}
                onChange={(e) => setPromisedAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-black text-emerald-800 outline-none focus:border-blue-900 tabular-nums"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                छोटा नोट (वैकल्पिक)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="जैसे: सैलरी के बाद जमा करूँगा"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-blue-900"
              />
            </div>
          </div>

          {/* Quick Amount Chips */}
          <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
            <span className="text-[11px] font-bold text-slate-500 mr-1">राशि चुनें:</span>
            {quickAmounts.map((qa) => (
              <button
                key={qa.label}
                type="button"
                onClick={() => setPromisedAmount(String(qa.val))}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                  Number(promisedAmount) === qa.val
                    ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                    : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-200'
                }`}
              >
                {qa.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-slate-500">
              💡 कुल बकाया ₹{pendingDue.toLocaleString('en-IN')} में से आप जितना दे सकें उतनी राशि का वादा कर सकते हैं।
            </p>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-[#0c2340] hover:bg-slate-800 disabled:opacity-60 text-amber-300 font-black text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm shrink-0"
            >
              <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-calendar-check'}`}></i>
              <span>{saving ? 'सेव हो रहा है...' : '🤝 वादा दर्ज करें व रिमाइंडर सेट करें'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
