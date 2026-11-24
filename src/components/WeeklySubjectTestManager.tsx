import React, { useState, useEffect, useMemo } from 'react';
import { getLocalDateYMD, getLocalTimestamp } from '../utils/localTime';
import { SchoolUser, Student, WeeklyTestRecord } from '../types';
import { ACADEMIC_MONTHS, getDefaultAcademicMonth } from '../utils/teacherPerformanceEngine';
import { getAppsScriptUrl } from '../utils/busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from '../utils/sheetDirectSync';

interface WeeklySubjectTestManagerProps {
  currentUser?: SchoolUser | null;
  allTeachers?: SchoolUser[];
  students?: Student[];
  classMap?: Record<string, string>;
  isManager?: boolean;
  onClose?: () => void;
  onTestsUpdated?: (tests: WeeklyTestRecord[]) => void;
}

export const WEEKLY_TESTS_STORAGE_KEY = 'evs_weekly_subject_tests_v1';

const COMMON_SUBJECTS = [
  'हिन्दी (Hindi)',
  'अंग्रेज़ी (English)',
  'गणित (Mathematics)',
  'विज्ञान (Science)',
  'पर्यावरण अध्ययन (EVS)',
  'सामाजिक विज्ञान (Social Studies)',
  'उर्दू / अरबी (Urdu / Arabic)',
  'कंप्यूटर (Computer)',
  'सामान्य ज्ञान (GK)',
];

export const loadLocalWeeklyTests = (): WeeklyTestRecord[] => {
  try {
    const raw = localStorage.getItem(WEEKLY_TESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

export const saveLocalWeeklyTests = (tests: WeeklyTestRecord[]) => {
  try {
    localStorage.setItem(WEEKLY_TESTS_STORAGE_KEY, JSON.stringify(tests));
  } catch {}
};

const normalizeClassName = (raw: any, classMap?: Record<string, string>): string => {
  if (raw === undefined || raw === null) return '';
  let s = String(raw).trim();
  if (!s) return '';
  if (classMap && classMap[s]) s = String(classMap[s]).trim();
  return s;
};

const normalizeClassKey = (raw: any, classMap?: Record<string, string>): string => {
  return normalizeClassName(raw, classMap)
    .toLowerCase()
    .replace(/^class\s+/i, '')
    .replace(/^कक्षा\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

export const WeeklySubjectTestManager: React.FC<WeeklySubjectTestManagerProps> = ({
  currentUser,
  allTeachers = [],
  students = [],
  classMap,
  isManager = false,
  onClose,
  onTestsUpdated,
}) => {
  const teachers = useMemo(() => {
    const filtered = allTeachers.filter((u) => {
      const desig = String(u.Designation || '').toLowerCase();
      if (/driver|van|bus|conductor|guard|peon|parent|student/i.test(desig)) return false;
      return !desig || /teacher|शिक्षक|faculty|instructor|principal|staff/i.test(desig);
    });
    if (currentUser && !filtered.some((t) => String(t.User_ID) === String(currentUser.User_ID))) {
      return [currentUser, ...filtered];
    }
    return filtered;
  }, [allTeachers, currentUser]);

  const [tests, setTests] = useState<WeeklyTestRecord[]>(() => loadLocalWeeklyTests());
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getDefaultAcademicMonth());
  const [selectedWeek, setSelectedWeek] = useState<number>(0);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(() => {
    if (!isManager && currentUser) return currentUser.User_ID || currentUser.Username || '';
    return 'all';
  });
  const [filterClass, setFilterClass] = useState<string>('all');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  // New Weekly Test Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [formTeacherId, setFormTeacherId] = useState<string>(
    currentUser?.User_ID || currentUser?.Username || teachers[0]?.User_ID || ''
  );
  const [formMonth, setFormMonth] = useState<string>(() => getDefaultAcademicMonth());
  const [formWeek, setFormWeek] = useState<number>(1);
  const [formTestDate, setFormTestDate] = useState<string>(() => getLocalDateYMD());
  const [formClass, setFormClass] = useState<string>('');
  const [formSubject, setFormSubject] = useState<string>(COMMON_SUBJECTS[0]);
  const [formCustomSubject, setFormCustomSubject] = useState<string>('');
  const [formTopic, setFormTopic] = useState<string>('');
  const [formMaxMarks, setFormMaxMarks] = useState<number>(20);
  const [studentInputs, setStudentInputs] = useState<
    Record<string, { marks: string; status: 'Present' | 'Absent'; remarks: string }>
  >({});
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Unique available classes from students list
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((st) => {
      const c = normalizeClassName(st.Class, classMap);
      if (c) set.add(c);
    });
    teachers.forEach((t) => {
      String(t.Assigned_Class || '')
        .split(/[,;|]+/)
        .map((p) => normalizeClassName(p, classMap))
        .filter(Boolean)
        .forEach((c) => set.add(c));
    });
    tests.forEach((t) => {
      const c = normalizeClassName(t.class_name, classMap);
      if (c) set.add(c);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students, teachers, tests, classMap]);

  // Students belonging to selected formClass
  const classStudents = useMemo(() => {
    if (!formClass) return [];
    const targetKey = normalizeClassKey(formClass, classMap);
    return students
      .filter((st) => {
        const stKey = normalizeClassKey(st.Class, classMap);
        return stKey === targetKey && String(st.Status || 'Active').toLowerCase() !== 'deleted';
      })
      .sort((a, b) => String(a.Student_Name || '').localeCompare(String(b.Student_Name || '')));
  }, [students, formClass, classMap]);

  // Keep parent notified when tests state changes
  const updateTestsState = (next: WeeklyTestRecord[]) => {
    setTests(next);
    saveLocalWeeklyTests(next);
    if (onTestsUpdated) onTestsUpdated(next);
  };

  // Load fresh Weekly Tests from Server / Google Sheet on mount & WS broadcast
  const fetchFreshTests = async (forceRefresh = false) => {
    const activeUrl = getAppsScriptUrl();
    try {
      const res = await fetch(`/api/weekly-tests${forceRefresh ? '?refresh=1' : ''}`, {
        headers: { 'x-apps-script-url': activeUrl },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          updateTestsState(data);
          return data;
        }
      }
    } catch {}

    // Direct Sheet read fallback
    try {
      const direct = await directGetFromSheet('getWeeklyTests', activeUrl);
      if (direct.ok && direct.json) {
        const arr = Array.isArray(direct.json)
          ? direct.json
          : Array.isArray(direct.json?.tests)
          ? direct.json.tests
          : Array.isArray(direct.json?.records)
          ? direct.json.records
          : [];
        const clean = arr.filter((r: any) => r && !Array.isArray(r) && (r.student_id || r.student_name));
        if (clean.length > 0) {
          updateTestsState(clean);
          return clean;
        }
      }
    } catch {}
    return tests;
  };

  useEffect(() => {
    fetchFreshTests(true);

    const onStorage = (ev: StorageEvent) => {
      if (ev.key === WEEKLY_TESTS_STORAGE_KEY) {
        const local = loadLocalWeeklyTests();
        setTests(local);
        if (onTestsUpdated) onTestsUpdated(local);
      }
    };
    window.addEventListener('storage', onStorage);

    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws/location`);
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg?.type === 'APP_DATA_UPDATED' && msg.entity === 'weekly_tests') {
            fetchFreshTests(true);
          }
        } catch {}
      };
    } catch {}

    return () => {
      window.removeEventListener('storage', onStorage);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, []);

  // Auto-select teacher's first assigned class when opening New Test Modal
  const handleOpenNewTestModal = () => {
    const defaultTid =
      (!isManager && currentUser ? currentUser.User_ID || currentUser.Username : '') ||
      (selectedTeacherId !== 'all' ? selectedTeacherId : teachers[0]?.User_ID || '');
    const tObj = teachers.find((t) => String(t.User_ID) === String(defaultTid) || String(t.Username) === String(defaultTid));
    const assignedFirst = String(tObj?.Assigned_Class || '')
      .split(/[,;|]+/)
      .map((p) => normalizeClassName(p, classMap))
      .filter(Boolean)[0];

    setFormTeacherId(defaultTid);
    setFormMonth(selectedMonth);
    setFormWeek(selectedWeek > 0 ? selectedWeek : 1);
    setFormTestDate(getLocalDateYMD());
    setFormClass(assignedFirst || availableClasses[0] || '');
    setFormSubject(COMMON_SUBJECTS[0]);
    setFormCustomSubject('');
    setFormTopic('');
    setFormMaxMarks(20);
    setStudentInputs({});
    setIsModalOpen(true);
  };

  // Pre-seed studentInputs state when classStudents changes in modal
  useEffect(() => {
    if (!isModalOpen) return;
    setStudentInputs((prev) => {
      const next: Record<string, { marks: string; status: 'Present' | 'Absent'; remarks: string }> = { ...prev };
      classStudents.forEach((st) => {
        const sid = String(st.Student_ID);
        if (!next[sid]) {
          next[sid] = { marks: '', status: 'Present', remarks: '' };
        }
      });
      return next;
    });
  }, [isModalOpen, classStudents]);

  // Update formClass when formTeacherId changes in modal (if assigned class exists)
  const handleFormTeacherChange = (tid: string) => {
    setFormTeacherId(tid);
    const tObj = teachers.find((t) => String(t.User_ID) === String(tid) || String(t.Username) === String(tid));
    const assignedFirst = String(tObj?.Assigned_Class || '')
      .split(/[,;|]+/)
      .map((p) => normalizeClassName(p, classMap))
      .filter(Boolean)[0];
    if (assignedFirst) {
      setFormClass(assignedFirst);
      setStudentInputs({});
    }
  };

  // Filtered entries for view
  const filteredTests = useMemo(() => {
    return tests.filter((t) => {
      if (!t) return false;
      const m = (t.month || String(t.test_date || '').slice(0, 7)).trim();
      if (selectedMonth && m !== selectedMonth) return false;
      if (selectedWeek > 0 && Number(t.week_number) !== selectedWeek) return false;
      if (selectedTeacherId !== 'all') {
        const tObj = teachers.find(
          (u) => String(u.User_ID) === String(selectedTeacherId) || String(u.Username) === String(selectedTeacherId)
        );
        const matchId =
          String(t.teacher_id || '').toLowerCase() === String(selectedTeacherId).toLowerCase() ||
          (tObj?.Username && String(t.teacher_id || '').toLowerCase() === String(tObj.Username).toLowerCase()) ||
          (tObj?.Name && String(t.teacher_name || '').toLowerCase() === String(tObj.Name).toLowerCase());
        if (!matchId) return false;
      }
      if (filterClass !== 'all' && normalizeClassKey(t.class_name, classMap) !== normalizeClassKey(filterClass, classMap)) {
        return false;
      }
      return true;
    });
  }, [tests, selectedMonth, selectedWeek, selectedTeacherId, filterClass, teachers, classMap]);

  // Group into Test Sessions for display
  const groupedSessions = useMemo(() => {
    const map = new Map<
      string,
      {
        sessionId: string;
        teacher_id: string;
        teacher_name: string;
        class_name: string;
        subject: string;
        month: string;
        week_number: number;
        test_date: string;
        topic_name: string;
        max_marks: number;
        entries: WeeklyTestRecord[];
        presentCount: number;
        absentCount: number;
        avgPercent: number;
        topperName: string;
        topperMarks: number;
      }
    >();

    for (const rec of filteredTests) {
      const sid =
        rec.test_session_id ||
        `${rec.test_date}_${normalizeClassKey(rec.class_name, classMap)}_${rec.subject}_${rec.teacher_id}`;
      if (!map.has(sid)) {
        map.set(sid, {
          sessionId: sid,
          teacher_id: rec.teacher_id,
          teacher_name: rec.teacher_name,
          class_name: rec.class_name,
          subject: rec.subject,
          month: rec.month,
          week_number: Number(rec.week_number) || 1,
          test_date: rec.test_date,
          topic_name: rec.topic_name,
          max_marks: Number(rec.max_marks) || 20,
          entries: [],
          presentCount: 0,
          absentCount: 0,
          avgPercent: 0,
          topperName: '-',
          topperMarks: 0,
        });
      }
      map.get(sid)!.entries.push(rec);
    }

    const list = Array.from(map.values());
    list.forEach((s) => {
      const present = s.entries.filter((e) => e.attendance_status !== 'Absent');
      s.presentCount = present.length;
      s.absentCount = s.entries.length - present.length;
      if (present.length > 0) {
        let sumOb = 0;
        let sumMx = 0;
        let top = present[0];
        present.forEach((e) => {
          const mx = Math.max(1, Number(e.max_marks) || s.max_marks || 20);
          const ob = Math.max(0, Math.min(mx, Number(e.marks_obtained) || 0));
          sumOb += ob;
          sumMx += mx;
          if (ob >= (Number(top.marks_obtained) || 0)) top = e;
        });
        s.avgPercent = sumMx > 0 ? Math.min(100, Math.round((sumOb / sumMx) * 100)) : 0;
        s.topperName = top.student_name;
        s.topperMarks = Number(top.marks_obtained) || 0;
      }
    });

    return list.sort((a, b) => String(b.test_date).localeCompare(String(a.test_date)));
  }, [filteredTests, classMap]);

  // Overall KPI metrics for current filter
  const kpiStats = useMemo(() => {
    const present = filteredTests.filter((t) => t.attendance_status !== 'Absent');
    let sumOb = 0;
    let sumMx = 0;
    present.forEach((e) => {
      const mx = Math.max(1, Number(e.max_marks) || 20);
      const ob = Math.max(0, Math.min(mx, Number(e.marks_obtained) || 0));
      sumOb += ob;
      sumMx += mx;
    });
    const avgPercent = sumMx > 0 ? Math.min(100, Math.round((sumOb / sumMx) * 100)) : 0;
    const scoreOutOf25 = Math.min(25, Math.round(((avgPercent / 100) * 25) * 10) / 10);
    return {
      sessionsCount: groupedSessions.length,
      evaluatedCount: present.length,
      avgPercent,
      scoreOutOf25,
    };
  }, [filteredTests, groupedSessions]);

  // Save a whole Weekly Test Session
  const handleSaveWeeklyTest = async (e: React.FormEvent) => {
    e.preventDefault();
    const subjectFinal = formSubject === '__CUSTOM__' ? formCustomSubject.trim() : formSubject;
    if (!formClass || !subjectFinal) {
      setSyncStatus('⚠️ कृपया कक्षा और विषय चुनें।');
      setTimeout(() => setSyncStatus(null), 4000);
      return;
    }

    const teacherObj =
      teachers.find((t) => String(t.User_ID) === String(formTeacherId) || String(t.Username) === String(formTeacherId)) ||
      currentUser ||
      teachers[0];
    const teacherId = String(teacherObj?.User_ID || teacherObj?.Username || formTeacherId || 'teacher').trim();
    const teacherName = String(teacherObj?.Name || 'शिक्षक').trim();
    const sessionId = `wt_${formMonth.replace('-', '_')}_w${formWeek}_${Date.now()}`;
    const maxM = Math.max(1, Number(formMaxMarks) || 20);

    const newEntries: WeeklyTestRecord[] = [];
    for (const st of classStudents) {
      const sid = String(st.Student_ID);
      const inp = studentInputs[sid];
      if (!inp) continue;
      if (inp.status === 'Absent') {
        newEntries.push({
          id: `${sessionId}_${sid}`,
          test_session_id: sessionId,
          teacher_id: teacherId,
          teacher_name: teacherName,
          class_name: formClass,
          subject: subjectFinal,
          month: formMonth,
          week_number: Number(formWeek) || 1,
          test_date: formTestDate,
          topic_name: formTopic.trim() || `${subjectFinal} साप्ताहिक टेस्ट`,
          student_id: sid,
          student_name: st.Student_Name,
          max_marks: maxM,
          marks_obtained: 0,
          attendance_status: 'Absent',
          remarks: inp.remarks || 'अनुपस्थित',
          timestamp: getLocalTimestamp(),
        });
      } else if (inp.marks !== '' && !isNaN(Number(inp.marks))) {
        const clamped = Math.max(0, Math.min(maxM, Number(inp.marks)));
        newEntries.push({
          id: `${sessionId}_${sid}`,
          test_session_id: sessionId,
          teacher_id: teacherId,
          teacher_name: teacherName,
          class_name: formClass,
          subject: subjectFinal,
          month: formMonth,
          week_number: Number(formWeek) || 1,
          test_date: formTestDate,
          topic_name: formTopic.trim() || `${subjectFinal} साप्ताहिक टेस्ट`,
          student_id: sid,
          student_name: st.Student_Name,
          max_marks: maxM,
          marks_obtained: clamped,
          attendance_status: 'Present',
          remarks: inp.remarks || '',
          timestamp: getLocalTimestamp(),
        });
      }
    }

    if (newEntries.length === 0) {
      setSyncStatus('⚠️ कृपया कम से कम 1 छात्र के टेस्ट अंक दर्ज करें (या अनुपस्थित चुनें)।');
      setTimeout(() => setSyncStatus(null), 5000);
      return;
    }

    setIsSaving(true);
    setSyncStatus(`🔄 ${newEntries.length} छात्रों का साप्ताहिक टेस्ट Google Sheet (Weekly_Tests) में सेव हो रहा है...`);

    const mergedAll = [...newEntries, ...tests];
    updateTestsState(mergedAll);

    const activeUrl = getAppsScriptUrl();
    const res = await dualSyncWriteToSheet({
      apiPath: '/api/weekly-tests',
      method: 'POST',
      apiBody: { records: newEntries },
      directPayload: {
        action: 'saveWeeklyTestsBatch',
        records: JSON.stringify(newEntries),
      },
      overrideUrl: activeUrl,
    });

    setIsSaving(false);
    setIsModalOpen(false);
    setExpandedSessionId(sessionId);

    if (res.sheetSynced) {
      setSyncStatus(`✅ शाबाश! ${newEntries.length} छात्रों का साप्ताहिक टेस्ट Google Sheet 'Weekly_Tests' में सुरक्षित हो गया!`);
      setTimeout(() => setSyncStatus(null), 5000);
    } else {
      setSyncStatus(
        `✅ ऐप में ${newEntries.length} छात्रों का टेस्ट सुरक्षित हो गया (Sheet सिंक लंबित: ${res.sheetError || 'Code.gs अपडेट करें'})`
      );
      setTimeout(() => setSyncStatus(null), 8000);
    }
  };

  // Delete whole test session
  const handleDeleteSession = async (sessionId: string) => {
    const toRemove = tests.filter(
      (t) =>
        (t.test_session_id || `${t.test_date}_${normalizeClassKey(t.class_name, classMap)}_${t.subject}_${t.teacher_id}`) ===
        sessionId
    );
    const remaining = tests.filter(
      (t) =>
        (t.test_session_id || `${t.test_date}_${normalizeClassKey(t.class_name, classMap)}_${t.subject}_${t.teacher_id}`) !==
        sessionId
    );
    updateTestsState(remaining);

    const activeUrl = getAppsScriptUrl();
    setSyncStatus('🔄 टेस्ट रिकॉर्ड Google Sheet से हटाया जा रहा है...');
    try {
      await fetch(`/api/weekly-tests/${encodeURIComponent(`session:${sessionId}`)}`, {
        method: 'DELETE',
        headers: { 'x-apps-script-url': activeUrl },
      });
      for (const r of toRemove) {
        await dualSyncWriteToSheet({
          apiPath: `/api/weekly-tests/${encodeURIComponent(r.id)}`,
          method: 'DELETE',
          directPayload: { action: 'deleteWeeklyTest', id: r.id, session_id: sessionId },
          overrideUrl: activeUrl,
        });
      }
      setSyncStatus('✅ साप्ताहिक टेस्ट रिकॉर्ड सफलतापूर्वक हटाया गया।');
    } catch {
      setSyncStatus('✅ ऐप से हटाया गया।');
    }
    setTimeout(() => setSyncStatus(null), 4000);
  };

  // 2-Way Manual Sheet Sync
  const handleSyncSheet = async () => {
    setIsSyncing(true);
    setSyncStatus('🔄 Google Sheet (Weekly_Tests) से 2-Way सिंक हो रहा है...');
    const activeUrl = getAppsScriptUrl();

    try {
      const direct = await directGetFromSheet('getWeeklyTests', activeUrl);
      if (!direct.ok) {
        setSyncStatus(`⚠️ ${direct.error || 'Apps Script में getWeeklyTests नहीं मिला — Code.gs अपडेट करें'}`);
        setIsSyncing(false);
        setTimeout(() => setSyncStatus(null), 8000);
        return;
      }

      const rawRows: any[] = Array.isArray(direct.json)
        ? direct.json
        : Array.isArray(direct.json?.tests)
        ? direct.json.tests
        : Array.isArray(direct.json?.records)
        ? direct.json.records
        : [];
      const sheetIds = new Set(rawRows.filter((r) => r && !Array.isArray(r)).map((r) => String(r.id || '').trim()));
      const pending = tests.filter((t) => t && t.id && !sheetIds.has(String(t.id).trim()));

      let pushed = 0;
      let failed = 0;
      let lastErr = '';

      if (pending.length > 0) {
        // Chunk in batches of 15 for fast reliable Apps Script writes
        for (let i = 0; i < pending.length; i += 15) {
          const chunk = pending.slice(i, i + 15);
          setSyncStatus(`🔄 लंबित टेस्ट अंक Sheet में भेजे जा रहे हैं (${Math.min(i + chunk.length, pending.length)}/${pending.length})...`);
          const wr = await dualSyncWriteToSheet({
            apiPath: '/api/weekly-tests',
            method: 'POST',
            apiBody: { records: chunk },
            directPayload: { action: 'saveWeeklyTestsBatch', records: JSON.stringify(chunk) },
            overrideUrl: activeUrl,
          });
          if (wr.sheetSynced) pushed += chunk.length;
          else {
            failed += chunk.length;
            if (!lastErr && wr.sheetError) lastErr = wr.sheetError;
          }
        }
      }

      await fetchFreshTests(true);

      if (failed > 0) {
        setSyncStatus(`⚠️ ${pushed} रिकॉर्ड गए, ${failed} में त्रुटि: ${lastErr || 'Code.gs जांचें'}`);
        setTimeout(() => setSyncStatus(null), 8000);
      } else if (pushed > 0) {
        setSyncStatus(`✅ 2-Way सिंक पूर्ण! ${pushed} टेस्ट प्रविष्टियाँ Google Sheet में सुरक्षित हो गईं!`);
        setTimeout(() => setSyncStatus(null), 5000);
      } else {
        setSyncStatus(`✅ Google Sheet 'Weekly_Tests' पहले से पूरी तरह सिंक है (${rawRows.length} प्रविष्टियाँ)!`);
        setTimeout(() => setSyncStatus(null), 4000);
      }
    } catch {
      setSyncStatus('⚠️ नेटवर्क त्रुटि: Sheet सिंक विफल रहा।');
      setTimeout(() => setSyncStatus(null), 5000);
    }
    setIsSyncing(false);
  };

  // Live preview while entering marks in modal
  const modalLivePreview = useMemo(() => {
    let entered = 0;
    let sumOb = 0;
    let sumMx = 0;
    const maxM = Math.max(1, Number(formMaxMarks) || 20);
    classStudents.forEach((st) => {
      const inp = studentInputs[String(st.Student_ID)];
      if (!inp || inp.status === 'Absent') return;
      if (inp.marks !== '' && !isNaN(Number(inp.marks))) {
        entered++;
        sumOb += Math.max(0, Math.min(maxM, Number(inp.marks)));
        sumMx += maxM;
      }
    });
    const avgPct = sumMx > 0 ? Math.min(100, Math.round((sumOb / sumMx) * 100)) : 0;
    const pts25 = Math.min(25, Math.round(((avgPct / 100) * 25) * 10) / 10);
    return { entered, avgPct, pts25 };
  }, [classStudents, studentInputs, formMaxMarks]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* 1. HEADER & KPI SUMMARY */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#133365] to-[#0c2340] rounded-3xl p-6 text-white shadow-xl border-2 border-amber-400/40">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider mb-2">
              <i className="fa-solid fa-file-pen"></i>
              <span>Weekly Subject Test Tracker (Max 25 Points)</span>
            </span>
            <h3 className="text-xl sm:text-2xl font-black text-white">
              📝 साप्ताहिक विषय टेस्ट ट्रैकर (Weekly Subject Test)
            </h3>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-2xl">
              हर सप्ताह अपनी कक्षा के विषय-वार टेस्ट और छात्रों के अंक दर्ज करें। लीडरबोर्ड में{' '}
              <strong className="text-amber-300">टेस्ट (25 अंक)</strong> केवल इन्हीं वास्तविक टेस्ट परिणामों से जुड़ता है।
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={handleSyncSheet}
              disabled={isSyncing}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm rounded-xl border border-white/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-60"
            >
              <i className={`fa-solid fa-arrows-rotate ${isSyncing ? 'fa-spin' : 'text-emerald-300'}`}></i>
              <span>{isSyncing ? 'सिंक...' : 'Sheet सिंक'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenNewTestModal}
              className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-lg flex items-center gap-2 cursor-pointer transition active:scale-95"
            >
              <i className="fa-solid fa-plus-circle"></i>
              <span>+ नया साप्ताहिक टेस्ट दर्ज करें</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/20 cursor-pointer"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            )}
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/15">
          <div className="bg-white/10 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block">कुल आयोजित टेस्ट</span>
            <strong className="text-xl font-black text-white">{kpiStats.sessionsCount} टेस्ट</strong>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block">मूल्यांकित छात्र प्रविष्टियाँ</span>
            <strong className="text-xl font-black text-emerald-300">{kpiStats.evaluatedCount} छात्र</strong>
          </div>
          <div className="bg-white/10 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block">कक्षा औसत अंक (%)</span>
            <strong className="text-xl font-black text-amber-300">{kpiStats.avgPercent}%</strong>
          </div>
          <div className="bg-amber-400 text-slate-950 rounded-2xl p-3 shadow-md">
            <span className="text-[11px] font-bold block">लीडरबोर्ड टेस्ट स्कोर</span>
            <strong className="text-xl font-black">
              {kpiStats.scoreOutOf25} <span className="text-xs font-bold">/ 25 अंक</span>
            </strong>
          </div>
        </div>
      </div>

      {/* Sync Banner */}
      {syncStatus && (
        <div
          className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center gap-2.5 animate-fadeIn ${
            syncStatus.includes('⚠️')
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          <i className={`fa-solid ${syncStatus.includes('⚠️') ? 'fa-triangle-exclamation text-amber-600' : 'fa-circle-check text-emerald-600'}`}></i>
          <span>{syncStatus}</span>
        </div>
      )}

      {/* 2. FILTERS */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {isManager && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">शिक्षक चुनें:</label>
              <select
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
              >
                <option value="all">सभी शिक्षक (All Teachers)</option>
                {teachers.map((t) => (
                  <option key={t.User_ID} value={t.User_ID}>
                    {t.Name} ({t.Assigned_Class || 'शिक्षक'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">माह (Month):</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
            >
              {ACADEMIC_MONTHS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">सप्ताह (Week):</label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
            >
              <option value={0}>समस्त सप्ताह (All Weeks)</option>
              <option value={1}>सप्ताह 1 (Week 1)</option>
              <option value={2}>सप्ताह 2 (Week 2)</option>
              <option value={3}>सप्ताह 3 (Week 3)</option>
              <option value={4}>सप्ताह 4 (Week 4)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">कक्षा (Class):</label>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 cursor-pointer"
            >
              <option value="all">सभी कक्षाएँ (All Classes)</option>
              {availableClasses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs font-bold text-slate-500">
          कुल <strong className="text-slate-900">{groupedSessions.length}</strong> टेस्ट सत्र प्रदर्शित
        </div>
      </div>

      {/* 3. TEST SESSIONS LIST */}
      {groupedSessions.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-300 p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-2xl mx-auto">
            <i className="fa-solid fa-clipboard-question"></i>
          </div>
          <h4 className="text-base font-black text-slate-800">इस माह अभी कोई साप्ताहिक विषय टेस्ट दर्ज नहीं है</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            जब तक कोई वास्तविक साप्ताहिक विषय टेस्ट और छात्रों के अंक दर्ज नहीं होंगे, तब तक शिक्षक का{' '}
            <strong>टेस्ट स्कोर (25 में से)</strong> शून्य (<strong>0</strong>) रहेगा।
          </p>
          <button
            type="button"
            onClick={handleOpenNewTestModal}
            className="px-5 py-2.5 bg-[#0c2340] hover:bg-blue-900 text-amber-300 font-black text-xs rounded-xl shadow-md cursor-pointer transition inline-flex items-center gap-2"
          >
            <i className="fa-solid fa-plus"></i>
            <span>पहला साप्ताहिक टेस्ट जोड़ें</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedSessions.map((sess) => {
            const isExpanded = expandedSessionId === sess.sessionId;
            return (
              <div
                key={sess.sessionId}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden hover:border-blue-300 transition"
              >
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 font-black text-[11px]">
                        {sess.class_name} • {sess.subject}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[11px]">
                        सप्ताह {sess.week_number}
                      </span>
                      <span className="text-xs text-slate-500 font-semibold">
                        📅 {sess.test_date} • 👨‍🏫 {sess.teacher_name}
                      </span>
                    </div>
                    <h4 className="text-sm sm:text-base font-black text-slate-900">{sess.topic_name}</h4>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span>
                        उपस्थित छात्र: <strong className="text-emerald-700">{sess.presentCount}</strong>
                      </span>
                      {sess.absentCount > 0 && (
                        <span>
                          अनुपस्थित: <strong className="text-rose-600">{sess.absentCount}</strong>
                        </span>
                      )}
                      <span>
                        पूर्णांक: <strong>{sess.max_marks}</strong>
                      </span>
                      <span>
                        🥇 टॉपर: <strong className="text-amber-700">{sess.topperName}</strong> ({sess.topperMarks}/{sess.max_marks})
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                      <span className="text-[10px] font-bold text-emerald-700 block">कक्षा औसत</span>
                      <strong className="text-base font-black text-emerald-900">{sess.avgPercent}%</strong>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedSessionId(isExpanded ? null : sess.sessionId)}
                      className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold cursor-pointer transition flex items-center gap-1.5"
                    >
                      <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-list-ol'}`}></i>
                      <span>{isExpanded ? 'छुपाएं' : `अंक देखें (${sess.entries.length})`}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeleteSession(sess.sessionId)}
                      className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs cursor-pointer transition"
                      title="यह टेस्ट हटाएं"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50/70 p-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-2">#</th>
                          <th className="py-2 px-2">छात्र का नाम</th>
                          <th className="py-2 px-2 text-center">स्थिति</th>
                          <th className="py-2 px-2 text-center">प्राप्तांक</th>
                          <th className="py-2 px-2 text-center">प्रतिशत</th>
                          <th className="py-2 px-2">रिमार्क</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sess.entries.map((entry, idx) => {
                          const mx = Math.max(1, Number(entry.max_marks) || sess.max_marks);
                          const ob = Number(entry.marks_obtained) || 0;
                          const pct = entry.attendance_status === 'Absent' ? 0 : Math.round((ob / mx) * 100);
                          return (
                            <tr key={entry.id} className="hover:bg-white">
                              <td className="py-2 px-2 font-mono text-slate-500">{idx + 1}</td>
                              <td className="py-2 px-2 font-bold text-slate-800">{entry.student_name}</td>
                              <td className="py-2 px-2 text-center">
                                {entry.attendance_status === 'Absent' ? (
                                  <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold text-[10px]">
                                    अनुपस्थित
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                                    उपस्थित
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center font-mono font-black text-slate-900">
                                {entry.attendance_status === 'Absent' ? '-' : `${ob} / ${mx}`}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-blue-900">
                                {entry.attendance_status === 'Absent' ? '-' : `${pct}%`}
                              </td>
                              <td className="py-2 px-2 text-slate-600">{entry.remarks || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. NEW WEEKLY SUBJECT TEST ENTRY MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-start justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full shadow-2xl border-2 border-amber-400 overflow-hidden my-auto flex flex-col max-h-[92vh]">
            <div className="bg-gradient-to-r from-[#0c2340] to-[#163a6f] text-white p-5 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                  Weekly Subject Test Entry
                </span>
                <h3 className="text-lg font-black">📝 नया साप्ताहिक विषय टेस्ट एवं छात्र अंक दर्ज करें</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveWeeklyTest} className="p-5 overflow-y-auto space-y-4">
              {/* Top Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">शिक्षक (Teacher):</label>
                  <select
                    value={formTeacherId}
                    onChange={(e) => handleFormTeacherChange(e.target.value)}
                    disabled={!isManager && Boolean(currentUser)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  >
                    {teachers.map((t) => (
                      <option key={t.User_ID} value={t.User_ID}>
                        {t.Name} ({t.Assigned_Class || 'शिक्षक'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">माह (Month):</label>
                  <select
                    value={formMonth}
                    onChange={(e) => setFormMonth(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  >
                    {ACADEMIC_MONTHS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">सप्ताह व तिथि:</label>
                  <div className="flex gap-2">
                    <select
                      value={formWeek}
                      onChange={(e) => setFormWeek(Number(e.target.value))}
                      className="w-1/2 px-2 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold"
                    >
                      <option value={1}>सप्ताह 1</option>
                      <option value={2}>सप्ताह 2</option>
                      <option value={3}>सप्ताह 3</option>
                      <option value={4}>सप्ताह 4</option>
                    </select>
                    <input
                      type="date"
                      value={formTestDate}
                      onChange={(e) => {
                        setFormTestDate(e.target.value);
                        if (e.target.value) setFormMonth(e.target.value.slice(0, 7));
                      }}
                      className="w-1/2 px-2 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">कक्षा चुनें (Class):</label>
                  <select
                    value={formClass}
                    onChange={(e) => {
                      setFormClass(e.target.value);
                      setStudentInputs({});
                    }}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  >
                    <option value="">-- कक्षा चुनें --</option>
                    {availableClasses.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">विषय (Subject):</label>
                  <select
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  >
                    {COMMON_SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    <option value="__CUSTOM__">अन्य विषय लिखें...</option>
                  </select>
                  {formSubject === '__CUSTOM__' && (
                    <input
                      type="text"
                      value={formCustomSubject}
                      onChange={(e) => setFormCustomSubject(e.target.value)}
                      placeholder="विषय का नाम लिखें"
                      className="mt-1.5 w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                      required
                    />
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">पूर्णांक (Max Marks):</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={formMaxMarks}
                      onChange={(e) => setFormMaxMarks(Math.max(1, Number(e.target.value) || 20))}
                      className="w-20 px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-black text-center"
                      required
                    />
                    {[10, 20, 25, 50].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setFormMaxMarks(preset)}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer border ${
                          formMaxMarks === preset
                            ? 'bg-blue-900 text-white border-blue-900'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1">
                  टेस्ट का अध्याय / टॉपिक (Topic / Chapter):
                </label>
                <input
                  type="text"
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                  placeholder="उदा. पाठ 3: भिन्न व दशमलव टेस्ट / Grammar Test"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-medium"
                />
              </div>

              {/* Class Students Marks Entry Table */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <div className="bg-slate-100 px-4 py-2.5 flex items-center justify-between text-xs font-black text-slate-800">
                  <span>
                    👨‍🎓 कक्षा {formClass || '-'} के छात्र ({classStudents.length})
                  </span>
                  <span className="text-[11px] font-bold text-blue-900">
                    प्रविष्ट छात्र: {modalLivePreview.entered} | औसत: {modalLivePreview.avgPct}% ({modalLivePreview.pts25}/25 अंक)
                  </span>
                </div>

                {classStudents.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    इस कक्षा में कोई सक्रिय छात्र नहीं मिला। कृपया सही कक्षा चुनें।
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-200">
                    {classStudents.map((st, idx) => {
                      const sid = String(st.Student_ID);
                      const inp = studentInputs[sid] || { marks: '', status: 'Present', remarks: '' };
                      const isAbs = inp.status === 'Absent';
                      return (
                        <div key={sid} className="px-3 py-2 flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs bg-white hover:bg-slate-50">
                          <span className="w-6 text-slate-400 font-mono text-[11px]">{idx + 1}.</span>
                          <div className="flex-1 min-w-[140px]">
                            <strong className="text-slate-900 block leading-tight">{st.Student_Name}</strong>
                            <span className="text-[10px] text-slate-400">ID: {st.Student_ID}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setStudentInputs((prev) => ({
                                ...prev,
                                [sid]: { ...inp, status: isAbs ? 'Present' : 'Absent' },
                              }))
                            }
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border shrink-0 ${
                              isAbs
                                ? 'bg-rose-100 text-rose-800 border-rose-300'
                                : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            }`}
                          >
                            {isAbs ? '❌ अनुपस्थित' : '✅ उपस्थित'}
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <input
                              type="number"
                              min={0}
                              max={formMaxMarks}
                              step="0.5"
                              disabled={isAbs}
                              placeholder={isAbs ? '-' : 'अंक'}
                              value={isAbs ? '' : inp.marks}
                              onChange={(e) =>
                                setStudentInputs((prev) => ({
                                  ...prev,
                                  [sid]: { ...inp, marks: e.target.value },
                                }))
                              }
                              className="w-20 px-2.5 py-1 rounded-lg border border-slate-300 text-center font-mono font-black disabled:bg-slate-100"
                            />
                            <span className="text-[11px] text-slate-400">/ {formMaxMarks}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                >
                  रद्द करें
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-2 disabled:opacity-60"
                >
                  <i className={`fa-solid ${isSaving ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'}`}></i>
                  <span>{isSaving ? 'सेव हो रहा...' : 'टेस्ट व अंक सुरक्षित करें (Sheet Sync)'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WeeklySubjectTestManager;
