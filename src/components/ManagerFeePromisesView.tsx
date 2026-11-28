import React, { useMemo, useState } from 'react';
import { FeePromiseRecord } from '../types';
import { StudentRecordForScan } from './StudentQRScannerModal';
import { getLocalDateYMD } from '../utils/localTime';
import {
  deleteFeePromiseOnServer,
  fetchFeePromisesFromServer,
  formatPromiseDateDisplay,
  getEffectivePromiseState,
  saveFeePromiseToServer,
  updateFeePromiseStatusOnServer,
} from '../utils/feePromiseHelper';
import { buildFeePromiseReminderMessage, openWhatsappAlert } from '../utils/whatsappReminders';

interface ManagerFeePromisesViewProps {
  promises: FeePromiseRecord[];
  onPromisesUpdated: (next: FeePromiseRecord[]) => void;
  students: StudentRecordForScan[];
  feeBalances: Record<string, number>;
  getClassName: (c?: string | null) => string;
  managerName: string;
  onOpenAddFeeModal: (studentId?: string) => void;
  preselectedStudentId?: string | null;
  preselectEpoch?: number;
}

type PromiseFilter = 'all' | 'due_today' | 'overdue' | 'upcoming' | 'fulfilled';

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

export const ManagerFeePromisesView: React.FC<ManagerFeePromisesViewProps> = ({
  promises,
  onPromisesUpdated,
  students,
  feeBalances,
  getClassName,
  managerName,
  onOpenAddFeeModal,
  preselectedStudentId,
  preselectEpoch = 0,
}) => {
  const todayYmd = getLocalDateYMD();
  const [filter, setFilter] = useState<PromiseFilter>('all');
  const [search, setSearch] = useState<string>('');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [sentIds, setSentIds] = useState<Record<string, boolean>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Add Promise form state (Manager adding on parent's behalf)
  const [addStudentSearch, setAddStudentSearch] = useState<string>('');
  const [addStudentId, setAddStudentId] = useState<string>('');
  const [addDate, setAddDate] = useState<string>(() => addDaysYmd(todayYmd, 3));
  const [addAmount, setAddAmount] = useState<string>('500');
  const [addNotes, setAddNotes] = useState<string>('');
  const [savingAdd, setSavingAdd] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const getStudentDue = (studentId: string): number => {
    const sid = String(studentId || '').trim();
    return Number(feeBalances[sid] ?? feeBalances[sid.toLowerCase()] ?? 0);
  };

  const enriched = useMemo(() => {
    return promises
      .filter((p) => p.status !== 'Cancelled')
      .map((p) => {
        const liveDue = getStudentDue(p.studentId);
        const effective = getEffectivePromiseState(p, liveDue, todayYmd);
        return { promise: p, liveDue, effective };
      });
  }, [promises, feeBalances, todayYmd]);

  const counts = useMemo(() => {
    let dueToday = 0;
    let overdue = 0;
    let upcoming = 0;
    let fulfilled = 0;
    let activePromisedTotal = 0;
    for (const item of enriched) {
      if (item.effective === 'due_today') {
        dueToday++;
        activePromisedTotal += item.promise.promisedAmount;
      } else if (item.effective === 'overdue') {
        overdue++;
        activePromisedTotal += item.promise.promisedAmount;
      } else if (item.effective === 'upcoming') {
        upcoming++;
        activePromisedTotal += item.promise.promisedAmount;
      } else if (item.effective === 'fulfilled') {
        fulfilled++;
      }
    }
    return { dueToday, overdue, upcoming, fulfilled, activePromisedTotal };
  }, [enriched]);

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return enriched
      .filter((item) => {
        if (filter !== 'all' && item.effective !== filter) return false;
        if (!q) return true;
        const p = item.promise;
        return (
          p.studentName.toLowerCase().includes(q) ||
          p.studentId.toLowerCase().includes(q) ||
          p.parentMobile.toLowerCase().includes(q) ||
          (p.fatherName || '').toLowerCase().includes(q) ||
          p.className.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const rank: Record<string, number> = {
          due_today: 0,
          overdue: 1,
          upcoming: 2,
          fulfilled: 3,
          cancelled: 4,
        };
        const ra = rank[a.effective] ?? 5;
        const rb = rank[b.effective] ?? 5;
        if (ra !== rb) return ra - rb;
        return (a.promise.promisedDate || '').localeCompare(b.promise.promisedDate || '');
      });
  }, [enriched, filter, search]);

  const selectableStudents = useMemo(() => {
    const q = addStudentSearch.trim().toLowerCase();
    return [...students]
      .filter((st) => {
        if (!q) return true;
        return (
          String(st.Student_Name || '').toLowerCase().includes(q) ||
          String(st.Student_ID || '').toLowerCase().includes(q) ||
          String(st.Father_Name || '').toLowerCase().includes(q) ||
          String(st.Parent_Mobile || '').toLowerCase().includes(q) ||
          getClassName(st.Class).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => getStudentDue(b.Student_ID) - getStudentDue(a.Student_ID));
  }, [students, feeBalances, addStudentSearch, getClassName]);

  React.useEffect(() => {
    if (preselectEpoch > 0 && preselectedStudentId) {
      setShowAddForm(true);
      setAddStudentId(preselectedStudentId);
      const due = getStudentDue(preselectedStudentId);
      if (due > 0) setAddAmount(String(due));
    }
  }, [preselectEpoch, preselectedStudentId]);

  const selectedStudentDue = useMemo(
    () => (addStudentId ? getStudentDue(addStudentId) : 0),
    [addStudentId, feeBalances]
  );

  const handleRefreshFromSheet = async () => {
    setSyncing(true);
    try {
      const res = await fetchFeePromisesFromServer(true);
      onPromisesUpdated(res.promises);
      showToast(
        res.sheetSynced
          ? '🔄 Google Sheet (Fee_Promises) से ताज़ा वादे सिंक हो गए!'
          : '✅ सर्वर से फीस वादे ताज़ा हो गए!'
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleManagerAddPromise = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetSt = students.find((s) => s.Student_ID === addStudentId);
    if (!targetSt) return;
    const due = getStudentDue(targetSt.Student_ID);
    const amt = Math.max(1, Number(addAmount) || due || 500);
    setSavingAdd(true);
    try {
      const res = await saveFeePromiseToServer({
        studentId: targetSt.Student_ID,
        studentName: targetSt.Student_Name || targetSt.Student_ID,
        className: getClassName(targetSt.Class),
        fatherName: targetSt.Father_Name || '',
        parentMobile: String(targetSt.Parent_Mobile || ''),
        totalDueAtPromise: due,
        promisedAmount: amt,
        promisedDate: addDate,
        notes: addNotes.trim() || 'मैनेजर द्वारा फोन/कार्यालय वार्ता पर दर्ज',
        createdBy: `Manager (${managerName})`,
      });
      onPromisesUpdated(res.promises);
      setShowAddForm(false);
      setAddStudentId('');
      setAddStudentSearch('');
      setAddNotes('');
      showToast(`🤝 ${targetSt.Student_Name} का वादा (${formatPromiseDateDisplay(addDate)}) सेव हो गया!`);
    } finally {
      setSavingAdd(false);
    }
  };

  return (
    <div className="px-4 sm:px-6 pb-6 space-y-4">
      {toastMsg && (
        <div className="p-3 rounded-xl bg-[#0c2340] text-amber-300 text-xs font-bold shadow-md flex items-center justify-between">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header & KPI Strip */}
      <div className="bg-gradient-to-br from-slate-50 to-amber-50/40 rounded-2xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <i className="fa-solid fa-handshake text-amber-600"></i>
              <span>अभिभावकों के फीस जमा वादे (Fee Promises · 2-Way Sheet Sync)</span>
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              जिन अभिभावकों ने बकाया जमा करने की तारीख तय की है — आज देय वादों पर 1-क्लिक में WhatsApp रिमाइंडर भेजें (टैब: <strong>Fee_Promises</strong>)
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="px-3 py-2 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <i className="fa-solid fa-plus"></i>
              <span>+ नया वादा जोड़ें</span>
            </button>
            <button
              type="button"
              onClick={handleRefreshFromSheet}
              disabled={syncing}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <i className={`fa-solid ${syncing ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i>
              <span>🔄 Sheet से सिंक</span>
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
          <div className="bg-white rounded-xl border border-amber-300 p-3">
            <div className="text-[10px] font-bold text-amber-700 uppercase">🔔 आज के वादे (Due Today)</div>
            <div className="text-xl font-black text-amber-900 mt-0.5">{counts.dueToday}</div>
          </div>
          <div className="bg-white rounded-xl border border-rose-300 p-3">
            <div className="text-[10px] font-bold text-rose-700 uppercase">⚠️ तारीख बीती (Overdue)</div>
            <div className="text-xl font-black text-rose-800 mt-0.5">{counts.overdue}</div>
          </div>
          <div className="bg-white rounded-xl border border-indigo-200 p-3">
            <div className="text-[10px] font-bold text-indigo-700 uppercase">📅 आने वाले (Upcoming)</div>
            <div className="text-xl font-black text-indigo-900 mt-0.5">{counts.upcoming}</div>
          </div>
          <div className="bg-white rounded-xl border border-emerald-200 p-3">
            <div className="text-[10px] font-bold text-emerald-700 uppercase">💰 सक्रिय वादा राशि</div>
            <div className="text-xl font-black text-emerald-800 mt-0.5">
              ₹{counts.activePromisedTotal.toLocaleString('en-IN')}
            </div>
          </div>
        </div>
      </div>

      {/* Manager Manual Add Promise Form */}
      {showAddForm && (
        <form
          onSubmit={handleManagerAddPromise}
          className="bg-white rounded-2xl border-2 border-[#0c2340]/20 p-4 space-y-3 text-xs shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="font-black text-slate-900">
              🤝 मैनेजर द्वारा अभिभावक का फीस वादा दर्ज करें
            </span>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
            >
              ✕ बंद करें
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1.5">
              <label className="block font-bold text-slate-700">छात्र खोजें और चुनें *</label>
              <input
                type="text"
                value={addStudentSearch}
                onChange={(e) => setAddStudentSearch(e.target.value)}
                placeholder="नाम, पिता का नाम, मोबाइल या ID लिखकर छांटें..."
                className="w-full px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs outline-none focus:border-blue-900 focus:bg-white"
              />
              <select
                required
                value={addStudentId}
                onChange={(e) => {
                  const sid = e.target.value;
                  setAddStudentId(sid);
                  const d = getStudentDue(sid);
                  if (d > 0) setAddAmount(String(d));
                }}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-semibold outline-none focus:border-blue-900"
              >
                <option value="">-- छात्र चुनें ({selectableStudents.length}) --</option>
                {selectableStudents.map((st) => {
                  const d = getStudentDue(st.Student_ID);
                  return (
                    <option key={st.Student_ID} value={st.Student_ID}>
                      {st.Student_Name} ({getClassName(st.Class)} · पिता: {st.Father_Name || '—'}) —{' '}
                      {d > 0 ? `बकाया ₹${d.toLocaleString('en-IN')}` : '₹0 बकाया'}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">वादा तारीख *</label>
              <input
                type="date"
                required
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-bold outline-none focus:border-blue-900"
              />
              <div className="flex flex-wrap gap-1">
                {[
                  { label: 'आज', ymd: todayYmd },
                  { label: 'कल', ymd: addDaysYmd(todayYmd, 1) },
                  { label: '3 दिन', ymd: addDaysYmd(todayYmd, 3) },
                  { label: '7 दिन', ymd: addDaysYmd(todayYmd, 7) },
                  { label: '1 ता.', ymd: getNextMonthDayYmd(1) },
                  { label: '10 ता.', ymd: getNextMonthDayYmd(10) },
                ].map((dOpt) => (
                  <button
                    key={dOpt.label}
                    type="button"
                    onClick={() => setAddDate(dOpt.ymd)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border cursor-pointer ${
                      addDate === dOpt.ymd
                        ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {dOpt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">वादा राशि (₹) *</label>
              <input
                type="number"
                min="1"
                required
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-black text-emerald-800 outline-none focus:border-blue-900"
              />
              <div className="flex flex-wrap gap-1">
                {selectedStudentDue > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setAddAmount(String(selectedStudentDue))}
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 cursor-pointer"
                    >
                      पूरा ₹{selectedStudentDue.toLocaleString('en-IN')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddAmount(String(Math.max(100, Math.round(selectedStudentDue / 2))))}
                      className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer"
                    >
                      50%
                    </button>
                  </>
                )}
                {[500, 1000].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAddAmount(String(v))}
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold border bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 cursor-pointer"
                  >
                    ₹{v}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
            <input
              type="text"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="नोट / विवरण (जैसे: कॉल पर 5 तारीख को देने को कहा)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 outline-none focus:border-blue-900"
            />
            <button
              type="submit"
              disabled={savingAdd}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black cursor-pointer shrink-0"
            >
              {savingAdd ? 'सेव हो रहा...' : '✓ वादा सेव करें'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Tabs + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(
            [
              { id: 'all', label: `सभी (${enriched.length})` },
              { id: 'due_today', label: `🔔 आज के (${counts.dueToday})` },
              { id: 'overdue', label: `⚠️ बीते (${counts.overdue})` },
              { id: 'upcoming', label: `📅 आने वाले (${counts.upcoming})` },
              { id: 'fulfilled', label: `✅ पूरे हुए (${counts.fulfilled})` },
            ] as Array<{ id: PromiseFilter; label: string }>
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-xl font-bold border cursor-pointer transition-colors ${
                filter === f.id
                  ? 'bg-[#0c2340] text-amber-300 border-[#0c2340]'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="छात्र नाम, कक्षा या मोबाइल से खोजें..."
          className="px-3 py-2 rounded-xl border border-slate-300 text-xs w-full sm:w-64 outline-none focus:border-blue-900"
        />
      </div>

      {/* Promises List */}
      {filteredList.length === 0 ? (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-10 text-center text-slate-500 text-xs">
          <i className="fa-solid fa-handshake text-3xl text-slate-300 mb-2"></i>
          <p className="font-bold text-slate-700">इस श्रेणी में कोई फीस वादा दर्ज नहीं है।</p>
          <p className="mt-1">अभिभावक Parent Portal से या मैनेजर "+ नया वादा जोड़ें" से तारीख दर्ज कर सकते हैं।</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredList.map(({ promise: p, liveDue, effective }) => {
            const isSent = Boolean(sentIds[p.id]);
            return (
              <div
                key={p.id}
                className={`bg-white rounded-2xl border p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-all ${
                  effective === 'due_today'
                    ? 'border-amber-400 bg-amber-50/40 shadow-xs'
                    : effective === 'overdue'
                    ? 'border-rose-300 bg-rose-50/30'
                    : effective === 'fulfilled'
                    ? 'border-emerald-200 bg-emerald-50/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-sm text-slate-900">{p.studentName}</span>
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold">
                      {p.className || 'Class'}
                    </span>
                    {effective === 'due_today' && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black">
                        🔔 आज देय (Due Today)
                      </span>
                    )}
                    {effective === 'overdue' && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-black">
                        ⚠️ वादा तारीख निकल गई
                      </span>
                    )}
                    {effective === 'upcoming' && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">
                        📅 आगामी वादा
                      </span>
                    )}
                    {effective === 'fulfilled' && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 text-[10px] font-black">
                        ✓ पूरा हुआ (Fulfilled)
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 tabular-nums">
                    <span>
                      📅 <strong>वादा तारीख:</strong> {formatPromiseDateDisplay(p.promisedDate)}
                    </span>
                    <span className="text-emerald-800 font-black">
                      🤝 वादा राशि: ₹{p.promisedAmount.toLocaleString('en-IN')}
                    </span>
                    <span className={liveDue > 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                      💰 वर्तमान बकाया: ₹{liveDue.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    {p.fatherName && <span>पिता: {p.fatherName}</span>}
                    {p.parentMobile && <span>• 📱 {p.parentMobile}</span>}
                    <span>• दर्ज: {p.createdBy}</span>
                    {p.notes && <span className="text-slate-700 italic">• 📝 {p.notes}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {effective !== 'fulfilled' && (
                    <button
                      type="button"
                      onClick={() => {
                        const msg = buildFeePromiseReminderMessage({
                          studentName: p.studentName,
                          className: p.className,
                          studentId: p.studentId,
                          fatherName: p.fatherName,
                          promisedAmount: p.promisedAmount,
                          promisedDate: p.promisedDate,
                          pendingAmount: liveDue > 0 ? liveDue : p.promisedAmount,
                          isOverdue: effective === 'overdue',
                        });
                        openWhatsappAlert(p.parentMobile, msg, {
                          alertType: 'Fee Promise Reminder',
                          recipientType: 'Parent',
                          recipientId: p.studentId,
                          recipientName: p.studentName,
                          classOrRole: p.className,
                          amount: p.promisedAmount,
                          sentBy: managerName,
                        });
                        setSentIds((prev) => ({ ...prev, [p.id]: true }));
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer ${
                        isSent
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      <i className="fa-brands fa-whatsapp"></i>
                      <span>{isSent ? 'भेजा गया ✓' : 'WhatsApp रिमाइंडर'}</span>
                    </button>
                  )}

                  {p.parentMobile && (
                    <a
                      href={`tel:${p.parentMobile}`}
                      className="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 text-xs font-bold flex items-center gap-1"
                    >
                      <i className="fa-solid fa-phone text-[10px]"></i>
                      <span>कॉल</span>
                    </a>
                  )}

                  {liveDue > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenAddFeeModal(p.studentId)}
                      className="px-2.5 py-1.5 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 text-xs font-bold cursor-pointer"
                    >
                      ₹ जमा करें
                    </button>
                  )}

                  {effective !== 'fulfilled' && (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await updateFeePromiseStatusOnServer(p.id, 'Fulfilled');
                        onPromisesUpdated(res.promises);
                        showToast(`✓ ${p.studentName} का वादा पूर्ण मार्क हो गया!`);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-bold cursor-pointer"
                      title="वादा पूरा (Fulfilled) मार्क करें"
                    >
                      ✓ पूर्ण
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      const res = await deleteFeePromiseOnServer(p.id);
                      onPromisesUpdated(res.promises);
                      showToast('🗑️ वादा रिकॉर्ड हटाया गया');
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer"
                    title="वादा हटाएं"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
