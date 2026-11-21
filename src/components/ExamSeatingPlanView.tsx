import React, { useEffect, useMemo, useState } from 'react';
import { HallPassConfig, Student } from '../types';
import {
  DEFAULT_ROOM_META,
  fetchExamSeatingPlanRoomMeta,
  generateExamSeatingPlanPdf,
  generateSixRoomSeatingPlan,
  loadSavedRoomMeta,
  RoomCustomMeta,
  saveExamSeatingPlanToSheet,
  saveRoomMeta,
  SeatingDistributionMode,
} from '../utils/seatingPlanHelper';

interface ExamSeatingPlanViewProps {
  students: Student[];
  config: HallPassConfig;
  getClassName: (cls?: string | null) => string;
  onOpenSheetSetup?: () => void;
}

export const ExamSeatingPlanView: React.FC<ExamSeatingPlanViewProps> = ({
  students,
  config,
  getClassName,
  onOpenSheetSetup,
}) => {
  const [roomMeta, setRoomMeta] = useState<Record<string, RoomCustomMeta>>(() => loadSavedRoomMeta());
  const [mode, setMode] = useState<SeatingDistributionMode>('anti_cheating_mixed');
  const [seatsPerBench, setSeatsPerBench] = useState<number>(3);
  const [selectedRoomKey, setSelectedRoomKey] = useState<string>('ALL');
  const [savingToSheet, setSavingToSheet] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetWarning, setSheetWarning] = useState<string | null>(null);

  useEffect(() => {
    fetchExamSeatingPlanRoomMeta()
      .then((serverMeta) => {
        if (serverMeta) setRoomMeta(serverMeta);
      })
      .catch(() => {});
  }, []);

  const seatingPlan = useMemo(
    () =>
      generateSixRoomSeatingPlan({
        students,
        getClassName,
        roomMeta,
        seatsPerBench,
        mode,
      }),
    [students, getClassName, roomMeta, seatsPerBench, mode]
  );

  const visibleRooms = useMemo(() => {
    if (selectedRoomKey === 'ALL') return seatingPlan.rooms;
    return seatingPlan.rooms.filter((r) => r.slotKey === selectedRoomKey);
  }, [seatingPlan.rooms, selectedRoomKey]);

  const handleRoomMetaChange = (
    slotKey: string,
    field: keyof RoomCustomMeta,
    value: string
  ) => {
    setRoomMeta((prev) => {
      const next: Record<string, RoomCustomMeta> = {
        ...prev,
        [slotKey]: {
          ...(prev[slotKey] || DEFAULT_ROOM_META[slotKey] || { roomNumber: slotKey, invigilator: '' }),
          [field]: value,
        },
      };
      saveRoomMeta(next);
      return next;
    });
  };

  const handleDownloadPdf = (roomKey: string = selectedRoomKey) => {
    const filename = generateExamSeatingPlanPdf({
      plan: seatingPlan,
      config,
      selectedRoomKey: roomKey,
    });
    setNotice(`✓ PDF डाउनलोड हो गई: ${filename} — कमरे के दरवाज़े व कक्ष निरीक्षक के लिए प्रिंट करें।`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleResetRooms = () => {
    setRoomMeta({ ...DEFAULT_ROOM_META });
    saveRoomMeta({ ...DEFAULT_ROOM_META });
    setNotice('कमरे के नाम डिफ़ॉल्ट (Room 1 – Room 6) पर रीसेट हो गए।');
    setTimeout(() => setNotice(null), 3500);
  };

  const handleSaveSeatingToSheet = async () => {
    if (savingToSheet) return;
    setSavingToSheet(true);
    setNotice(null);
    setSheetWarning(null);
    try {
      const res = await saveExamSeatingPlanToSheet(seatingPlan, config, roomMeta);
      if (res.sheetSynced) {
        setNotice(
          `✓ सभी ${res.savedCount} छात्रों का 6-रूम सीटिंग प्लान Google Sheet की "Exam_Seating_Plan" शीट में सेव हो गया है।`
        );
      } else {
        setNotice(`✓ सीटिंग प्लान व कमरों के नाम ऐप में सेव हो गए हैं (${res.savedCount} छात्र)।`);
        setSheetWarning(
          'Google Sheet में "Exam_Seating_Plan" टैब में सेव करने के लिए एक बार नया Apps Script कोड ("शीट टैब सेटअप") अपडेट करें।'
        );
      }
    } catch {
      setNotice('✓ कमरों के नाम ऐप में सेव हैं।');
    } finally {
      setSavingToSheet(false);
      setTimeout(() => setNotice(null), 6000);
    }
  };

  const gridColsClass =
    seatsPerBench === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : seatsPerBench === 4
      ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
      : 'grid-cols-1 md:grid-cols-3';

  return (
    <div className="space-y-4">
      {/* TOP CONTROL & SUMMARY CARD */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              परीक्षा सीटिंग प्लान — 6 कमरे (1 बेंच = {seatsPerBench} बच्चे)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Play से UKG (M3) के बच्चे <strong>2 कमरों</strong> में और Class 1 से 8 के बच्चे <strong>4 कमरों</strong> में व्यवस्थित। कमरे का नंबर नीचे कभी भी बदल सकते हैं।
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSaveSeatingToSheet}
              disabled={savingToSheet}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <i className={`fa-solid ${savingToSheet ? 'fa-circle-notch fa-spin' : 'fa-cloud-arrow-up'}`}></i>
              <span>{savingToSheet ? 'Sheet में सेव हो रहा है...' : 'Google Sheet में सेव करें'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleDownloadPdf('ALL')}
              className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <i className="fa-solid fa-file-pdf"></i>
              <span>सभी 6 कमरों की PDF डाउनलोड</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <i className="fa-solid fa-print"></i>
              <span>प्रिंट करें</span>
            </button>
          </div>
        </div>

        {/* 4 SUMMARY KPI BOXES */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-bold text-slate-500">कुल छात्र (Total Students)</div>
            <div className="text-xl font-black text-slate-900 tabular-nums mt-0.5">
              {seatingPlan.totalStudents}
            </div>
            <div className="text-[11px] text-slate-600 font-semibold mt-0.5 tabular-nums">
              कुल {seatingPlan.totalBenches} बेंच ({seatsPerBench}/बेंच)
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
            <div className="text-[11px] font-bold text-blue-900">ग्रुप A: Play – UKG (M3)</div>
            <div className="text-xl font-black text-blue-950 tabular-nums mt-0.5">
              {seatingPlan.prePrimaryCount} छात्र · 2 कमरे
            </div>
            <div className="text-[11px] text-blue-800 font-semibold mt-0.5 tabular-nums">
              {seatingPlan.rooms
                .filter((r) => r.group === 'pre_primary')
                .map((r) => `${r.roomNumber}: ${r.totalStudents}`)
                .join(' · ')}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <div className="text-[11px] font-bold text-amber-900">ग्रुप B: Class 1 – 8</div>
            <div className="text-xl font-black text-amber-950 tabular-nums mt-0.5">
              {seatingPlan.upperCount} छात्र · 4 कमरे
            </div>
            <div className="text-[11px] text-amber-900 font-semibold mt-0.5 tabular-nums">
              {seatingPlan.rooms
                .filter((r) => r.group === 'upper_1_to_8')
                .map((r) => `${r.roomNumber}: ${r.totalStudents}`)
                .join(' · ')}
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
            <div className="text-[11px] font-bold text-emerald-900">एंटी-चीटिंग व्यवस्था</div>
            <div className="text-xl font-black text-emerald-800 tabular-nums mt-0.5">
              {seatingPlan.totalSameClassConflicts === 0
                ? '0 पास-पास नकल'
                : `${seatingPlan.totalSameClassConflicts} जोड़े`}
            </div>
            <div className="text-[11px] text-emerald-800 font-semibold mt-0.5">
              {mode === 'anti_cheating_mixed'
                ? 'हर बेंच पर अलग-अलग कक्षा के बच्चे'
                : 'एक कक्षा के बच्चे क्रमवार साथ'}
            </div>
          </div>
        </div>

        {/* FILTER + MODE + SEATS CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedRoomKey}
              onChange={(e) => setSelectedRoomKey(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
            >
              <option value="ALL">सभी 6 कमरे दिखाएं ({seatingPlan.totalStudents} छात्र)</option>
              {seatingPlan.rooms.map((r) => (
                <option key={r.slotKey} value={r.slotKey}>
                  {r.roomNumber} — {r.group === 'pre_primary' ? 'Play-M3' : 'Class 1-8'} ({r.totalStudents} छात्र · {r.benches.length} बेंच)
                </option>
              ))}
            </select>

            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setMode('anti_cheating_mixed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  mode === 'anti_cheating_mixed'
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                एंटी-चीटिंग मिक्स्ड (बिना नकल)
              </button>
              <button
                type="button"
                onClick={() => setMode('class_grouped')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                  mode === 'class_grouped'
                    ? 'bg-[#0c2340] text-amber-300'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                कक्षा-वार क्रम से
              </button>
            </div>

            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs">
              <span className="font-bold text-slate-700">1 बेंच पर:</span>
              {[2, 3, 4].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setSeatsPerBench(cnt)}
                  className={`px-2 py-0.5 rounded-md font-black cursor-pointer tabular-nums ${
                    seatsPerBench === cnt
                      ? 'bg-[#0c2340] text-amber-300'
                      : 'bg-white text-slate-700 border border-slate-300'
                  }`}
                >
                  {cnt}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleResetRooms}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer"
          >
            रूम नाम रीसेट करें
          </button>
        </div>

        {/* EDITABLE 6 ROOM NAMES / INVIGILATOR BAR */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2.5">
          <div className="text-xs font-black text-slate-800">
            कमरे के नंबर व कक्ष निरीक्षक (Room Numbers &amp; Invigilators — कभी भी बदलें, स्वतः सेव होगा):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {seatingPlan.rooms.map((room) => (
              <div
                key={`edit-${room.slotKey}`}
                className="bg-white border border-slate-200 rounded-xl p-2.5 space-y-1.5"
              >
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span
                    className={
                      room.group === 'pre_primary' ? 'text-blue-800' : 'text-amber-800'
                    }
                  >
                    {room.group === 'pre_primary' ? 'Pre-Primary (Play–M3)' : 'Class 1st–8th'}
                  </span>
                  <span className="text-slate-600 tabular-nums">
                    {room.totalStudents} छात्र · {room.benches.length} बेंच
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    value={roomMeta[room.slotKey]?.roomNumber ?? room.defaultRoomName}
                    onChange={(e) => handleRoomMetaChange(room.slotKey, 'roomNumber', e.target.value)}
                    placeholder="Room No. (जैसे Room 101)"
                    className="px-2 py-1 rounded-lg border border-slate-300 text-xs font-black text-slate-900"
                  />
                  <input
                    type="text"
                    value={roomMeta[room.slotKey]?.invigilator ?? ''}
                    onChange={(e) => handleRoomMetaChange(room.slotKey, 'invigilator', e.target.value)}
                    placeholder="टीचर का नाम"
                    className="px-2 py-1 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {notice && (
          <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            {notice}
          </div>
        )}

        {sheetWarning && (
          <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{sheetWarning}</span>
            {onOpenSheetSetup && (
              <button
                type="button"
                onClick={onOpenSheetSetup}
                className="px-3 py-1 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-[11px] font-bold cursor-pointer"
              >
                शीट सेटअप कोड देखें
              </button>
            )}
          </div>
        )}
      </div>

      {/* ROOM-BY-ROOM BENCH SEATING CARDS (PRINTABLE) */}
      <div className="space-y-5">
        {visibleRooms.map((room) => (
          <div
            key={room.slotKey}
            className="bg-white border-2 border-[#0c2340] rounded-2xl overflow-hidden shadow-xs break-inside-avoid print:break-after-page print:rounded-none"
          >
            {/* Room Header */}
            <div className="bg-[#0c2340] text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b-[3px] border-amber-400">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base sm:text-lg font-black tracking-wide">
                    {room.roomNumber}
                  </h3>
                  <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-black">
                    {room.group === 'pre_primary' ? 'Play – UKG (M3)' : 'Class 1st – 8th'}
                  </span>
                </div>
                <p className="text-xs text-blue-100 font-semibold mt-0.5">
                  {room.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join('  ·  ')}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="text-right tabular-nums">
                  <div className="font-black text-amber-300">
                    {room.totalStudents} छात्र · {room.benches.length} बेंच
                  </div>
                  <div className="text-[11px] text-blue-100">
                    निरीक्षक: {room.invigilator || '—'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(room.slotKey)}
                  className="no-print px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-black cursor-pointer inline-flex items-center gap-1"
                >
                  <i className="fa-solid fa-file-arrow-down"></i>
                  <span>PDF</span>
                </button>
              </div>
            </div>

            {/* Bench-by-Bench Grid */}
            <div className="p-3 sm:p-4 space-y-2.5">
              {room.benches.length === 0 ? (
                <div className="py-6 text-center text-xs font-bold text-slate-500">
                  इस कमरे में कोई छात्र आवंटित नहीं है।
                </div>
              ) : (
                room.benches.map((bench) => (
                  <div
                    key={`${room.slotKey}-b-${bench.benchNumber}`}
                    className="flex flex-col sm:flex-row border border-slate-300 rounded-xl overflow-hidden bg-slate-50/40"
                  >
                    <div className="sm:w-24 shrink-0 bg-slate-100 border-b sm:border-b-0 sm:border-r border-slate-300 px-3 py-2 flex sm:flex-col items-center justify-between sm:justify-center text-center">
                      <span className="text-xs font-black text-[#0c2340] tabular-nums">
                        Bench {bench.benchNumber}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                        {bench.seats.length}/{seatsPerBench} सीट
                      </span>
                    </div>

                    <div className={`flex-1 grid ${gridColsClass} divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white`}>
                      {Array.from({ length: seatsPerBench }, (_, sIdx) => {
                        const seat = bench.seats[sIdx];
                        if (!seat) {
                          return (
                            <div
                              key={`empty-${sIdx}`}
                              className="p-2.5 flex items-center justify-center text-xs text-slate-400 font-semibold"
                            >
                              — खाली सीट —
                            </div>
                          );
                        }
                        return (
                          <div key={seat.student.Student_ID} className="p-2.5 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                                {seat.seatPosition}
                              </div>
                              <div className="text-sm font-black text-slate-900 truncate">
                                {seat.student.Student_Name}
                              </div>
                              <div className="text-[11px] font-bold text-[#0c2340] tabular-nums">
                                Roll: {seat.student.Roll_Number || '—'} · ID: {seat.student.Student_ID}
                              </div>
                            </div>
                            <span className="shrink-0 px-2 py-0.5 rounded bg-slate-100 border border-slate-300 text-slate-900 text-[11px] font-black">
                              {seat.classLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
