import React, { useEffect, useMemo, useState } from 'react';
import { HallPassConfig, Student } from '../types';
import { getLocalTimestamp } from '../utils/localTime';
import {
  buildAutoBalancedRoomConfigs,
  clearRoomAllocations,
  fetchExamSeatingPlanSnapshot,
  generateCustomSeatingPlan,
  generateExamSeatingPlanPdf,
  loadLocalSeatingWorkflow,
  saveExamSeatingPlanToSheet,
  saveLocalSeatingWorkflow,
  saveTeacherSeatingDraft,
  SeatingDistributionMode,
  SeatingPlanApprovalStatus,
  SeatingPlanConfigPayload,
  SeatingRoomConfig,
} from '../utils/seatingPlanHelper';

interface ExamSeatingPlanViewProps {
  students: Student[];
  config: HallPassConfig;
  getClassName: (cls?: string | null) => string;
  onOpenSheetSetup?: () => void;
  userRole?: 'teacher' | 'manager';
  currentUserName?: string;
  currentUserId?: string;
}

const CLASS_BADGE_COLORS: Record<string, string> = {
  C1: 'bg-pink-50 text-pink-900 border-pink-200',
  C2: 'bg-sky-50 text-sky-900 border-sky-200',
  C3: 'bg-indigo-50 text-indigo-900 border-indigo-200',
  C4: 'bg-violet-50 text-violet-900 border-violet-200',
  C5: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  C6: 'bg-amber-50 text-amber-900 border-amber-200',
  C7: 'bg-cyan-50 text-cyan-900 border-cyan-200',
  C8: 'bg-rose-50 text-rose-900 border-rose-200',
  C9: 'bg-teal-50 text-teal-900 border-teal-200',
  C10: 'bg-orange-50 text-orange-900 border-orange-200',
  C11: 'bg-lime-50 text-lime-900 border-lime-200',
  C12: 'bg-purple-50 text-purple-900 border-purple-200',
};

export const ExamSeatingPlanView: React.FC<ExamSeatingPlanViewProps> = ({
  students,
  config,
  getClassName,
  onOpenSheetSetup,
  userRole = 'manager',
  currentUserName = '',
  currentUserId = '',
}) => {
  const [initialBoot] = useState(() => {
    const local = loadLocalSeatingWorkflow();
    if (local && local.rooms.length > 0) return local;
    return null;
  });

  const [roomConfigs, setRoomConfigs] = useState<SeatingRoomConfig[]>(() => {
    if (initialBoot) return initialBoot.rooms;
    return buildAutoBalancedRoomConfigs({ students, getClassName });
  });
  const [seatsPerBench, setSeatsPerBench] = useState<number>(() => initialBoot?.seatsPerBench ?? 3);
  const [mode, setMode] = useState<SeatingDistributionMode>(() => initialBoot?.mode ?? 'anti_cheating_mixed');
  const [workflowStatus, setWorkflowStatus] = useState<SeatingPlanApprovalStatus>(
    () => initialBoot?.status ?? 'draft'
  );
  const [submittedBy, setSubmittedBy] = useState<string>(() => initialBoot?.submittedBy ?? '');
  const [submittedAt, setSubmittedAt] = useState<string>(() => initialBoot?.submittedAt ?? '');
  const [approvedBy, setApprovedBy] = useState<string>(() => initialBoot?.approvedBy ?? '');
  const [approvedAt, setApprovedAt] = useState<string>(() => initialBoot?.approvedAt ?? '');
  const [teacherNote, setTeacherNote] = useState<string>(() => initialBoot?.teacherNote ?? '');
  const [managerNote, setManagerNote] = useState<string>(() => initialBoot?.managerNote ?? '');

  const [selectedRoomKey, setSelectedRoomKey] = useState<string>('ALL');
  const [showMatrixEditor, setShowMatrixEditor] = useState<boolean>(true);
  const [refreshingSnapshot, setRefreshingSnapshot] = useState<boolean>(false);
  const [submittingDraft, setSubmittingDraft] = useState<boolean>(false);
  const [savingToSheet, setSavingToSheet] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sheetWarning, setSheetWarning] = useState<string | null>(null);
  const [hasLoadedServerOnce, setHasLoadedServerOnce] = useState<boolean>(false);

  // If initial students arrived after first render and local storage was empty & allocations are all 0, auto-seed once
  useEffect(() => {
    if (initialBoot || hasLoadedServerOnce || students.length === 0) return;
    const totalAllocated = roomConfigs.reduce<number>(
      (sum, r) => sum + Object.values(r.classCounts || {}).reduce<number>((s, v) => s + (Number(v) || 0), 0),
      0
    );
    if (totalAllocated === 0) {
      setRoomConfigs(buildAutoBalancedRoomConfigs({ students, getClassName, existingRooms: roomConfigs }));
    }
  }, [students.length]);

  const applyServerPayload = (payload: SeatingPlanConfigPayload) => {
    setRoomConfigs(payload.rooms);
    setSeatsPerBench([2, 3, 4].includes(payload.seatsPerBench) ? payload.seatsPerBench : 3);
    setMode(payload.mode === 'class_grouped' ? 'class_grouped' : 'anti_cheating_mixed');
    setWorkflowStatus(payload.status || 'draft');
    setSubmittedBy(payload.submittedBy || '');
    setSubmittedAt(payload.submittedAt || '');
    setApprovedBy(payload.approvedBy || '');
    setApprovedAt(payload.approvedAt || '');
    setTeacherNote(payload.teacherNote || '');
    setManagerNote(payload.managerNote || '');
    saveLocalSeatingWorkflow(payload);
  };

  const loadFromServer = async (showFeedback = false) => {
    setRefreshingSnapshot(true);
    try {
      const snap = await fetchExamSeatingPlanSnapshot();
      setHasLoadedServerOnce(true);
      if (snap) {
        const chosen = snap.draftConfig || snap.approvedConfig;
        if (chosen && Array.isArray(chosen.rooms) && chosen.rooms.length > 0) {
          applyServerPayload(chosen);
          if (showFeedback) {
            setNotice(
              chosen.status === 'pending_approval'
                ? `✓ टीचर (${chosen.submittedBy || 'Teacher'}) द्वारा भेजा गया नया प्लान लोड हो गया है।`
                : '✓ सर्वर व Google Sheet से ताज़ा सीटिंग प्लान लोड हो गया है।'
            );
            setTimeout(() => setNotice(null), 4500);
          }
        } else if (showFeedback) {
          setNotice('सर्वर पर अभी कोई नया सबमिट किया गया ड्राफ्ट नहीं मिला।');
          setTimeout(() => setNotice(null), 3500);
        }
      }
    } catch {
      if (showFeedback) setErrorMsg('सर्वर से ताज़ा डेटा लाने में समस्या हुई।');
    } finally {
      setRefreshingSnapshot(false);
    }
  };

  useEffect(() => {
    loadFromServer(false);
  }, []);

  const seatingPlan = useMemo(
    () =>
      generateCustomSeatingPlan({
        students,
        getClassName,
        roomConfigs,
        seatsPerBench,
        mode,
      }),
    [students, getClassName, roomConfigs, seatsPerBench, mode]
  );

  const visibleRooms = useMemo(() => {
    if (selectedRoomKey === 'ALL') return seatingPlan.rooms;
    return seatingPlan.rooms.filter((r) => r.slotKey === selectedRoomKey);
  }, [seatingPlan.rooms, selectedRoomKey]);

  const overAllocatedClasses = useMemo(
    () => seatingPlan.classSummaries.filter((c) => c.overAllocatedBy > 0),
    [seatingPlan.classSummaries]
  );

  const persistLocalSnapshot = (
    nextRooms: SeatingRoomConfig[],
    nextSeats = seatsPerBench,
    nextMode = mode,
    nextStatus: SeatingPlanApprovalStatus = workflowStatus === 'approved' ? 'draft' : workflowStatus
  ) => {
    saveLocalSeatingWorkflow({
      rooms: nextRooms,
      seatsPerBench: nextSeats,
      mode: nextMode,
      status: nextStatus,
      submittedBy,
      submittedAt,
      approvedBy,
      approvedAt,
      teacherNote,
      managerNote,
    });
  };

  const markModifiedIfApproved = () => {
    if (workflowStatus === 'approved') {
      setWorkflowStatus('draft');
    }
  };

  const handleRoomFieldChange = (slotKey: string, field: 'roomNumber' | 'invigilator', value: string) => {
    markModifiedIfApproved();
    setRoomConfigs((prev) => {
      const next = prev.map((r) => (r.slotKey === slotKey ? { ...r, [field]: value } : r));
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleClassCountChange = (slotKey: string, classCode: string, rawVal: string) => {
    const num = Math.max(0, Math.min(500, Math.floor(Number(rawVal) || 0)));
    markModifiedIfApproved();
    setErrorMsg(null);
    setRoomConfigs((prev) => {
      const next = prev.map((r) => {
        if (r.slotKey !== slotKey) return r;
        const nextCounts = { ...(r.classCounts || {}) };
        if (num <= 0) delete nextCounts[classCode];
        else nextCounts[classCode] = num;
        return { ...r, classCounts: nextCounts };
      });
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleFillRemainingIntoRoom = (slotKey: string, classCode: string, remaining: number) => {
    if (remaining <= 0) return;
    markModifiedIfApproved();
    setErrorMsg(null);
    setRoomConfigs((prev) => {
      const next = prev.map((r) => {
        if (r.slotKey !== slotKey) return r;
        const curr = Number(r.classCounts?.[classCode] || 0);
        return {
          ...r,
          classCounts: {
            ...(r.classCounts || {}),
            [classCode]: curr + remaining,
          },
        };
      });
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleAddRoom = () => {
    markModifiedIfApproved();
    setRoomConfigs((prev) => {
      const idx = prev.length + 1;
      const next = [
        ...prev,
        {
          slotKey: `room_${Date.now()}_${idx}`,
          roomNumber: `Room ${idx}`,
          invigilator: '',
          classCounts: {},
        },
      ];
      persistLocalSnapshot(next);
      return next;
    });
  };

  const handleRemoveRoom = (slotKey: string) => {
    if (roomConfigs.length <= 1) return;
    markModifiedIfApproved();
    setRoomConfigs((prev) => {
      const next = prev.filter((r) => r.slotKey !== slotKey);
      persistLocalSnapshot(next);
      return next;
    });
    if (selectedRoomKey === slotKey) setSelectedRoomKey('ALL');
  };

  const handleAutoFillCounts = () => {
    markModifiedIfApproved();
    setErrorMsg(null);
    const filled = buildAutoBalancedRoomConfigs({
      students,
      getClassName,
      existingRooms: roomConfigs,
    });
    setRoomConfigs(filled);
    persistLocalSnapshot(filled);
    setNotice('✓ सभी कक्षाओं के बच्चे उपलब्ध कमरों में संतुलित (Anti-Cheating) तरीके से भर दिए गए हैं। आप चाहें तो संख्या बदल सकते हैं।');
    setTimeout(() => setNotice(null), 4500);
  };

  const handleClearAllCounts = () => {
    markModifiedIfApproved();
    setErrorMsg(null);
    const cleared = clearRoomAllocations(roomConfigs);
    setRoomConfigs(cleared);
    persistLocalSnapshot(cleared);
    setNotice('सभी कमरों की संख्या 0 कर दी गई है — अब अपनी पसंद से हर कमरे में कक्षा-वार बच्चे चुनें।');
    setTimeout(() => setNotice(null), 4000);
  };

  const buildCurrentPayload = (status: SeatingPlanApprovalStatus): SeatingPlanConfigPayload => ({
    rooms: roomConfigs,
    seatsPerBench,
    mode,
    status,
    submittedBy:
      userRole === 'teacher'
        ? currentUserName || submittedBy || 'Teacher'
        : submittedBy || currentUserName || 'Manager',
    submittedById: userRole === 'teacher' ? currentUserId : undefined,
    submittedAt: status === 'pending_approval' ? getLocalTimestamp() : submittedAt || getLocalTimestamp(),
    approvedBy: status === 'approved' ? currentUserName || 'Manager' : undefined,
    approvedAt: status === 'approved' ? getLocalTimestamp() : undefined,
    teacherNote: teacherNote.trim() || undefined,
    managerNote: managerNote.trim() || undefined,
  });

  // TEACHER ACTION: Submit draft for Manager confirmation (does NOT write to Sheet yet)
  const handleTeacherSubmitForApproval = async (asDraftOnly = false) => {
    if (submittingDraft) return;
    setErrorMsg(null);
    setNotice(null);

    if (seatingPlan.allocatedStudentsCount === 0) {
      setErrorMsg('कृपया पहले कम से कम 1 कमरे में कुछ बच्चों की संख्या चुनें।');
      return;
    }
    if (overAllocatedClasses.length > 0) {
      setErrorMsg(
        `इन कक्षाओं में कुल बच्चों से ज्यादा संख्या भर दी गई है: ${overAllocatedClasses
          .map((c) => `${c.classLabel} (+${c.overAllocatedBy})`)
          .join(', ')}। कृपया सही करें।`
      );
      return;
    }

    setSubmittingDraft(true);
    try {
      const nextStatus: SeatingPlanApprovalStatus = asDraftOnly ? 'draft' : 'pending_approval';
      const payload = buildCurrentPayload(nextStatus);
      const res = await saveTeacherSeatingDraft(payload);
      setWorkflowStatus(nextStatus);
      setSubmittedBy(payload.submittedBy || '');
      setSubmittedAt(payload.submittedAt || '');

      if (asDraftOnly) {
        setNotice(
          res.serverOk || res.sheetSynced
            ? '✓ ड्राफ्ट सुरक्षित सेव हो गया है।'
            : '✓ ड्राफ्ट इस डिवाइस में सेव हो गया है।'
        );
      } else {
        setNotice(
          `✅ सीटिंग प्लान (${seatingPlan.allocatedStudentsCount} छात्र · ${seatingPlan.rooms.length} कमरे) मैनेजर की पुष्टि (Confirmation) के लिए भेज दिया गया है! मैनेजर कन्फर्म करते ही यह Google Sheet में सेव हो जाएगा।`
        );
      }
    } catch {
      setErrorMsg('ड्राफ्ट भेजने में समस्या आई, कृपया पुनः प्रयास करें।');
    } finally {
      setSubmittingDraft(false);
    }
  };

  // MANAGER ACTION: Confirm & Permanently Save to Google Sheet ("Exam_Seating_Plan" tab)
  const handleManagerConfirmAndSaveToSheet = async () => {
    if (savingToSheet) return;
    setErrorMsg(null);
    setNotice(null);
    setSheetWarning(null);

    if (seatingPlan.allocatedStudentsCount === 0) {
      setErrorMsg('कन्फर्म करने के लिए कम से कम 1 कमरे में छात्र आवंटित होने चाहिए।');
      return;
    }
    if (overAllocatedClasses.length > 0) {
      setErrorMsg(
        `कृपया पहले इन कक्षाओं की अतिरिक्त संख्या ठीक करें: ${overAllocatedClasses
          .map((c) => `${c.classLabel} (+${c.overAllocatedBy})`)
          .join(', ')}`
      );
      return;
    }

    setSavingToSheet(true);
    try {
      const approvedPayload = buildCurrentPayload('approved');
      const roomMetaCompat: Record<string, { roomNumber: string; invigilator: string }> = {};
      roomConfigs.forEach((r) => {
        roomMetaCompat[r.slotKey] = { roomNumber: r.roomNumber, invigilator: r.invigilator };
      });

      const res = await saveExamSeatingPlanToSheet(seatingPlan, config, roomMetaCompat, approvedPayload);
      setWorkflowStatus('approved');
      setApprovedBy(approvedPayload.approvedBy || 'Manager');
      setApprovedAt(approvedPayload.approvedAt || getLocalTimestamp());

      if (res.sheetSynced) {
        setNotice(
          `✅ कन्फर्म हो गया! सभी ${res.savedCount} छात्रों का एंटी-चीटिंग सीटिंग प्लान Google Sheet की "Exam_Seating_Plan" टैब में स्थायी रूप से सेव हो गया है।`
        );
      } else {
        setNotice(`✓ प्लान ऐप में कन्फर्म हो गया है (${res.savedCount} छात्र)।`);
        setSheetWarning(
          'Google Sheet में "Exam_Seating_Plan" टैब में सेव करने के लिए Apps Script अपडेट की आवश्यकता हो सकती है।'
        );
      }
    } catch {
      setErrorMsg('Google Sheet में सेव करते समय त्रुटि हुई।');
    } finally {
      setSavingToSheet(false);
    }
  };

  const handleManagerReturnToDraft = async () => {
    if (submittingDraft) return;
    setSubmittingDraft(true);
    setErrorMsg(null);
    try {
      const payload = buildCurrentPayload('draft');
      await saveTeacherSeatingDraft(payload);
      setWorkflowStatus('draft');
      setNotice('↩️ प्लान ड्राफ्ट में वापस कर दिया गया है — टीचर या आप इसमें बदलाव कर सकते हैं।');
    } finally {
      setSubmittingDraft(false);
    }
  };

  const handleDownloadPdf = (roomKey: string = selectedRoomKey) => {
    const filename = generateExamSeatingPlanPdf({
      plan: seatingPlan,
      config,
      selectedRoomKey: roomKey,
      seatsPerBench,
    });
    setNotice(`✓ PDF डाउनलोड हो गई: ${filename}`);
    setTimeout(() => setNotice(null), 5000);
  };

  const gridColsClass =
    seatsPerBench === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : seatsPerBench === 4
      ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
      : 'grid-cols-1 md:grid-cols-3';

  return (
    <div className="space-y-4">
      {/* WORKFLOW STATUS BANNER */}
      <div
        className={`no-print rounded-2xl border p-3.5 sm:p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
          workflowStatus === 'approved'
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : workflowStatus === 'pending_approval'
            ? 'bg-amber-50 border-amber-300 text-amber-950'
            : 'bg-slate-50 border-slate-200 text-slate-900'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${
              workflowStatus === 'approved'
                ? 'bg-emerald-600 text-white'
                : workflowStatus === 'pending_approval'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-[#0c2340] text-amber-300'
            }`}
          >
            <i
              className={`fa-solid ${
                workflowStatus === 'approved'
                  ? 'fa-circle-check'
                  : workflowStatus === 'pending_approval'
                  ? 'fa-hourglass-half'
                  : 'fa-chair'
              }`}
            ></i>
          </div>
          <div className="text-xs space-y-0.5">
            <div className="font-black text-sm flex flex-wrap items-center gap-2">
              {workflowStatus === 'approved' && (
                <span>✅ कन्फर्म और Google Sheet में सेव (Confirmed)</span>
              )}
              {workflowStatus === 'pending_approval' && (
                <span>⏳ मैनेजर कन्फर्मेशन के लिए प्रतीक्षारत (Pending Manager Approval)</span>
              )}
              {workflowStatus === 'draft' && (
                <span>📝 ड्राफ्ट सीटिंग प्लान (Teacher Room × Class Setup)</span>
              )}
              <span className="px-2 py-0.5 rounded-full bg-white/80 border border-black/10 text-[10px] font-bold">
                {userRole === 'teacher' ? 'Teacher View' : 'Manager View'}
              </span>
            </div>
            <p className="text-[11px] font-semibold opacity-90">
              {workflowStatus === 'approved'
                ? `कन्फर्म किया: ${approvedBy || 'Manager'} ${approvedAt ? `· ${approvedAt}` : ''} — Sheet की "Exam_Seating_Plan" टैब में सेव है।`
                : workflowStatus === 'pending_approval'
                ? `टीचर (${submittedBy || 'Teacher'})${
                    submittedAt ? ` · ${submittedAt}` : ''
                  } ने यह प्लान भेजा है। ${
                    userRole === 'manager'
                      ? 'जांचें और नीचे "कन्फर्म व Google Sheet में सेव करें" दबाएं।'
                      : 'मैनेजर द्वारा कन्फर्म होने पर यह Google Sheet में सेव हो जाएगा।'
                  }`
                : userRole === 'teacher'
                ? 'हर कमरे के नीचे कक्षा-वार बच्चों की संख्या डालें → ऐप अपने-आप Anti-Cheating सीटिंग बना देगा → फिर "मैनेजर को कन्फर्मेशन के लिए भेजें" दबाएं।'
                : 'टीचर द्वारा भेजे गए प्लान को देखने के लिए "रिफ्रेश करें" दबाएं, या आप स्वयं कमरे तय करके सीधे Google Sheet में कन्फर्म कर सकते हैं।'}
            </p>
            {teacherNote && (
              <p className="text-[11px] font-bold text-indigo-900 bg-white/70 px-2 py-0.5 rounded inline-block mt-1">
                टीचर नोट: {teacherNote}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => loadFromServer(true)}
            disabled={refreshingSnapshot}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <i className={`fa-solid fa-rotate ${refreshingSnapshot ? 'fa-spin' : ''}`}></i>
            <span>ताज़ा प्लान लाएं</span>
          </button>

          {userRole === 'teacher' ? (
            <>
              <button
                type="button"
                onClick={() => handleTeacherSubmitForApproval(true)}
                disabled={submittingDraft}
                className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <i className="fa-solid fa-floppy-disk"></i>
                <span>ड्राफ्ट सेव</span>
              </button>
              <button
                type="button"
                onClick={() => handleTeacherSubmitForApproval(false)}
                disabled={submittingDraft || seatingPlan.allocatedStudentsCount === 0}
                className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-50 text-amber-300 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i className={`fa-solid ${submittingDraft ? 'fa-circle-notch fa-spin' : 'fa-paper-plane'}`}></i>
                <span>
                  {submittingDraft ? 'भेजा जा रहा है...' : 'मैनेजर को कन्फर्मेशन के लिए भेजें'}
                </span>
              </button>
            </>
          ) : (
            <>
              {workflowStatus === 'pending_approval' && (
                <button
                  type="button"
                  onClick={handleManagerReturnToDraft}
                  disabled={submittingDraft}
                  className="px-3 py-2 rounded-xl border border-rose-300 bg-white hover:bg-rose-50 text-rose-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fa-solid fa-rotate-left"></i>
                  <span>वापस भेजें</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleManagerConfirmAndSaveToSheet}
                disabled={savingToSheet || seatingPlan.allocatedStudentsCount === 0}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <i className={`fa-solid ${savingToSheet ? 'fa-circle-notch fa-spin' : 'fa-check-double'}`}></i>
                <span>
                  {savingToSheet
                    ? 'Sheet में सेव हो रहा है...'
                    : 'कन्फर्म करें और Google Sheet में सेव करें'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* TOP CONTROL & SUMMARY CARD */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-base sm:text-lg font-black text-slate-900">
              स्मार्ट परीक्षा सीटिंग प्लान — रूम व क्लास चयन + ऑटो एंटी-चीटिंग
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              तय करें कि किस कमरे में किस कक्षा के कितने बच्चे बैठेंगे — ऐप अपने आप हर बेंच पर अलग-अलग कक्षा के बच्चे (0 नकल) बैठा देगा।
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleDownloadPdf('ALL')}
              disabled={seatingPlan.allocatedStudentsCount === 0}
              className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-blue-950 disabled:opacity-50 text-amber-300 text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <i className="fa-solid fa-file-pdf"></i>
              <span>सभी कमरों की PDF डाउनलोड</span>
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
            <div className="text-[11px] font-bold text-slate-500">आवंटित छात्र (Seated)</div>
            <div className="text-xl font-black text-slate-900 tabular-nums mt-0.5">
              {seatingPlan.allocatedStudentsCount}{' '}
              <span className="text-sm font-bold text-slate-500">/ {seatingPlan.totalStudents}</span>
            </div>
            <div className="text-[11px] text-slate-600 font-semibold mt-0.5 tabular-nums">
              कुल {seatingPlan.totalBenches} बेंच ({seatsPerBench}/बेंच)
            </div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
            <div className="text-[11px] font-bold text-blue-900">सक्रिय कमरे (Rooms)</div>
            <div className="text-xl font-black text-blue-950 tabular-nums mt-0.5">
              {seatingPlan.rooms.filter((r) => r.totalStudents > 0).length} / {seatingPlan.rooms.length} कमरे
            </div>
            <div className="text-[11px] text-blue-800 font-semibold mt-0.5 truncate">
              {seatingPlan.rooms
                .filter((r) => r.totalStudents > 0)
                .map((r) => `${r.roomNumber}: ${r.totalStudents}`)
                .join(' · ') || 'अभी किसी रूम में बच्चे नहीं'}
            </div>
          </div>

          <div
            className={`rounded-xl border p-3 ${
              seatingPlan.unassignedCount > 0 || overAllocatedClasses.length > 0
                ? 'border-amber-300 bg-amber-50/80'
                : 'border-indigo-200 bg-indigo-50/60'
            }`}
          >
            <div className="text-[11px] font-bold text-slate-700">बाकी बचे छात्र (Unassigned)</div>
            <div className="text-xl font-black text-slate-900 tabular-nums mt-0.5">
              {seatingPlan.unassignedCount} छात्र
            </div>
            <div className="text-[11px] font-semibold text-slate-600 mt-0.5">
              {seatingPlan.unassignedCount === 0
                ? '✓ सभी बच्चे कमरों में बैठ गए हैं'
                : 'नीचे तालिका में पीले बैज से भरें'}
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
                ? 'हर बेंच पर अलग-अलग कक्षा + आगे-पीछे बदलाव'
                : 'एक कक्षा के बच्चे क्रमवार साथ'}
            </div>
          </div>
        </div>

        {/* ROOM x CLASS ALLOCATION MATRIX HEADER CONTROLS */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-table-cells text-[#0c2340]"></i>
                <span>स्टेप 1: चुनें किस कमरे में किस कक्षा के कितने बच्चे बैठेंगे</span>
              </h3>
              <p className="text-[11px] text-slate-600">
                हर बॉक्स में संख्या लिखें (या <span className="font-bold text-amber-800">+बाकी</span> बटन दबाकर बचे हुए सभी छात्र उस कमरे में डालें)।
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleAddRoom}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-plus"></i>
                <span>रूम जोड़ें</span>
              </button>
              <button
                type="button"
                onClick={handleAutoFillCounts}
                className="px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-300 hover:bg-blue-100 text-blue-900 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
                title="सभी कमरों में अपने-आप संतुलित संख्या भरें"
              >
                <i className="fa-solid fa-wand-magic-sparkles"></i>
                <span>ऑटो-बांटें</span>
              </button>
              <button
                type="button"
                onClick={handleClearAllCounts}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-bold cursor-pointer inline-flex items-center gap-1"
              >
                <i className="fa-solid fa-eraser"></i>
                <span>सब 0 करें</span>
              </button>
              <button
                type="button"
                onClick={() => setShowMatrixEditor((v) => !v)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-200/80 hover:bg-slate-300 text-slate-800 text-xs font-bold cursor-pointer"
              >
                {showMatrixEditor ? 'तालिका छुपाएं' : 'तालिका दिखाएं'}
              </button>
            </div>
          </div>

          {showMatrixEditor && (
            <>
              <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#0c2340] text-white">
                      <th className="sticky left-0 z-10 bg-[#0c2340] text-left p-2.5 min-w-[165px] border-r border-white/15">
                        <div className="font-black text-amber-300">कक्षा (Class)</div>
                        <div className="text-[10px] font-medium text-blue-100">कुल छात्र · बाकी सीट</div>
                      </th>
                      {roomConfigs.map((room, rIdx) => {
                        const roomStats = seatingPlan.rooms[rIdx];
                        return (
                          <th
                            key={room.slotKey}
                            className="p-2 min-w-[148px] border-r border-white/15 align-top text-left"
                          >
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <input
                                type="text"
                                value={room.roomNumber}
                                onChange={(e) =>
                                  handleRoomFieldChange(room.slotKey, 'roomNumber', e.target.value)
                                }
                                placeholder={`Room ${rIdx + 1}`}
                                className="w-full px-2 py-1 rounded bg-white text-slate-950 text-xs font-black border border-amber-300"
                              />
                              {roomConfigs.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRoom(room.slotKey)}
                                  className="p-1 text-rose-300 hover:text-rose-100 cursor-pointer"
                                  title="यह रूम हटाएं"
                                >
                                  <i className="fa-solid fa-xmark"></i>
                                </button>
                              )}
                            </div>
                            <input
                              type="text"
                              value={room.invigilator}
                              onChange={(e) =>
                                handleRoomFieldChange(room.slotKey, 'invigilator', e.target.value)
                              }
                              placeholder="निरीक्षक / टीचर"
                              className="w-full px-2 py-1 rounded bg-white/10 text-white placeholder:text-blue-200/70 text-[11px] font-semibold border border-white/20"
                            />
                            <div className="mt-1 text-[10px] font-bold text-amber-300 tabular-nums">
                              {roomStats?.totalStudents || 0} छात्र · {roomStats?.benches.length || 0} बेंच
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {seatingPlan.classSummaries.map((cls) => {
                      const isOver = cls.overAllocatedBy > 0;
                      const isDone = !isOver && cls.remainingCount === 0;
                      return (
                        <tr key={cls.classCode} className="hover:bg-slate-50/80">
                          <td className="sticky left-0 z-10 bg-white border-r border-slate-200 p-2">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-black text-slate-900">{cls.classLabel}</span>
                              <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                                ({cls.totalStudents})
                              </span>
                            </div>
                            <div className="mt-0.5">
                              {isOver ? (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-black tabular-nums">
                                  अधिक: +{cls.overAllocatedBy}!
                                </span>
                              ) : isDone ? (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-black">
                                  ✓ पूरे {cls.totalStudents} सेट
                                </span>
                              ) : (
                                <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-black tabular-nums">
                                  बाकी: {cls.remainingCount}
                                </span>
                              )}
                            </div>
                          </td>
                          {roomConfigs.map((room) => {
                            const val = Number(room.classCounts?.[cls.classCode] || 0);
                            return (
                              <td
                                key={`${cls.classCode}-${room.slotKey}`}
                                className={`p-1.5 border-r border-slate-200 ${
                                  val > 0 ? 'bg-blue-50/40' : ''
                                }`}
                              >
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    max={cls.totalStudents}
                                    value={val === 0 ? '' : val}
                                    placeholder="0"
                                    onChange={(e) =>
                                      handleClassCountChange(room.slotKey, cls.classCode, e.target.value)
                                    }
                                    className={`w-14 px-2 py-1 rounded-lg border text-center text-xs font-black tabular-nums ${
                                      isOver && val > 0
                                        ? 'border-rose-400 bg-rose-50 text-rose-900'
                                        : val > 0
                                        ? 'border-blue-400 bg-white text-[#0c2340]'
                                        : 'border-slate-300 bg-white text-slate-600'
                                    }`}
                                  />
                                  {cls.remainingCount > 0 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleFillRemainingIntoRoom(
                                          room.slotKey,
                                          cls.classCode,
                                          cls.remainingCount
                                        )
                                      }
                                      className="px-1.5 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-950 text-[10px] font-black cursor-pointer shrink-0 tabular-nums"
                                      title={`बचे हुए ${cls.remainingCount} बच्चे इस कमरे में जोड़ें`}
                                    >
                                      +{cls.remainingCount}
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100 border-t-2 border-slate-300 font-black text-slate-900">
                      <td className="sticky left-0 z-10 bg-slate-100 p-2.5 border-r border-slate-300">
                        कमरे का कुल योग
                      </td>
                      {seatingPlan.rooms.map((room) => (
                        <td
                          key={`tot-${room.slotKey}`}
                          className="p-2.5 border-r border-slate-300 tabular-nums text-xs"
                        >
                          <div className="text-[#0c2340] font-black">
                            {room.totalStudents} छात्र · {room.benches.length} बेंच
                          </div>
                          <div className="text-[10px] font-semibold text-slate-600 truncate">
                            {room.adjacentSameClassPairs === 0
                              ? '✓ 0 नकल जोड़े'
                              : `${room.adjacentSameClassPairs} पास-पास जोड़े`}
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Optional note field for Teacher */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label className="text-xs font-bold text-slate-700 shrink-0">
                  {userRole === 'teacher' ? 'टीचर नोट (वैकल्पिक):' : 'टीचर/मैनेजर नोट:'}
                </label>
                <input
                  type="text"
                  value={teacherNote}
                  onChange={(e) => setTeacherNote(e.target.value)}
                  placeholder="जैसे: 5वीं और 6वीं को हॉल 1 में रखा है, छोटे बच्चे नीचे के कमरों में..."
                  className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900"
                />
              </div>
            </>
          )}
        </div>

        {/* FILTER + MODE + SEATS CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedRoomKey}
              onChange={(e) => setSelectedRoomKey(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-bold text-slate-900"
            >
              <option value="ALL">
                सभी {seatingPlan.rooms.length} कमरे दिखाएं ({seatingPlan.allocatedStudentsCount} छात्र)
              </option>
              {seatingPlan.rooms.map((r) => (
                <option key={r.slotKey} value={r.slotKey}>
                  {r.roomNumber} ({r.totalStudents} छात्र · {r.benches.length} बेंच)
                </option>
              ))}
            </select>

            <div className="inline-flex items-center p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  markModifiedIfApproved();
                  setMode('anti_cheating_mixed');
                  persistLocalSnapshot(roomConfigs, seatsPerBench, 'anti_cheating_mixed');
                }}
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
                onClick={() => {
                  markModifiedIfApproved();
                  setMode('class_grouped');
                  persistLocalSnapshot(roomConfigs, seatsPerBench, 'class_grouped');
                }}
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
                  onClick={() => {
                    markModifiedIfApproved();
                    setSeatsPerBench(cnt);
                    persistLocalSnapshot(roomConfigs, cnt, mode);
                  }}
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
        </div>

        {/* ALERTS & NOTICES */}
        {overAllocatedClasses.length > 0 && (
          <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold">
            ⚠️ चेतावनी: इन कक्षाओं में वास्तविक छात्रों से ज्यादा संख्या डाली गई है —{' '}
            {overAllocatedClasses.map((c) => `${c.classLabel} (+${c.overAllocatedBy})`).join(', ')}। कृपया सही करें।
          </div>
        )}

        {errorMsg && (
          <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {errorMsg}
          </div>
        )}

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
                  <h3 className="text-base sm:text-lg font-black tracking-wide">{room.roomNumber}</h3>
                  <span className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-black">
                    {room.groupLabelHi}
                  </span>
                  {room.adjacentSameClassPairs === 0 && room.totalStudents > 0 && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-[10px] font-black">
                      ✓ 0 नकल जोड़े
                    </span>
                  )}
                </div>
                <p className="text-xs text-blue-100 font-semibold mt-0.5">
                  {room.classBreakdown.length > 0
                    ? room.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join('  ·  ')
                    : 'अभी इस कमरे में कोई कक्षा नहीं चुनी गई है'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="text-right tabular-nums">
                  <div className="font-black text-amber-300">
                    {room.totalStudents} छात्र · {room.benches.length} बेंच
                  </div>
                  <div className="text-[11px] text-blue-100">निरीक्षक: {room.invigilator || '—'}</div>
                </div>
                {room.totalStudents > 0 && (
                  <button
                    type="button"
                    onClick={() => handleDownloadPdf(room.slotKey)}
                    className="no-print px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[11px] font-black cursor-pointer inline-flex items-center gap-1"
                  >
                    <i className="fa-solid fa-file-arrow-down"></i>
                    <span>PDF</span>
                  </button>
                )}
              </div>
            </div>

            {/* Bench-by-Bench Grid */}
            <div className="p-3 sm:p-4 space-y-2.5">
              {room.benches.length === 0 ? (
                <div className="py-6 text-center text-xs font-bold text-slate-500">
                  इस कमरे में कोई छात्र आवंटित नहीं है। ऊपर की तालिका में संख्या भरें।
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

                    <div
                      className={`flex-1 grid ${gridColsClass} divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white`}
                    >
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
                        const badgeClass =
                          CLASS_BADGE_COLORS[seat.classCode] || 'bg-slate-100 text-slate-900 border-slate-300';
                        return (
                          <div
                            key={seat.student.Student_ID}
                            className="p-2.5 flex items-start justify-between gap-2"
                          >
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
                            <span
                              className={`shrink-0 px-2 py-0.5 rounded border text-[11px] font-black ${badgeClass}`}
                            >
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
