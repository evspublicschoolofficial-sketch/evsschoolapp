import React, { useState, useEffect, useMemo } from 'react';
import { SchoolUser, SyllabusTopicRecord } from '../types';
import { ACADEMIC_MONTHS, getDefaultAcademicMonth } from '../utils/teacherPerformanceEngine';

interface TeacherSyllabusPlannerProps {
  currentUser?: SchoolUser | null;
  allTeachers?: SchoolUser[];
  isManager?: boolean;
  onClose?: () => void;
  onSyllabusUpdated?: (topics: SyllabusTopicRecord[]) => void;
}

const STORAGE_KEY = 'evs_syllabus_planner_records_v1';

export const DEFAULT_SEED_SYLLABUS_TOPICS: SyllabusTopicRecord[] = [
  {
    id: 'syl_2026_09_sunita_1',
    teacher_id: 'teacher_sunita',
    teacher_name: 'सुनीता शर्मा (Sunita Sharma)',
    class_name: 'Class 5',
    subject: 'गणित (Mathematics)',
    month: '2026-09',
    week_number: 1,
    week_label: 'सप्ताह 1 (1 से 7 सितंबर)',
    chapter_title: 'Chapter 4: भिन्न (Fractions)',
    topic_description: 'अभ्यास 4.1: सम और विषम भिन्नों की पहचान व चित्र निरूपण',
    planned_date: '2026-09-02',
    target_completion_date: '2026-09-07',
    completed_date: '2026-09-06',
    status: 'Completed',
    created_at: '2026-09-01',
  },
  {
    id: 'syl_2026_09_sunita_2',
    teacher_id: 'teacher_sunita',
    teacher_name: 'सुनीता शर्मा (Sunita Sharma)',
    class_name: 'Class 5',
    subject: 'गणित (Mathematics)',
    month: '2026-09',
    week_number: 2,
    week_label: 'सप्ताह 2 (8 से 14 सितंबर)',
    chapter_title: 'Chapter 4: भिन्न (Fractions)',
    topic_description: 'अभ्यास 4.2 व 4.3: समान हर वाले भिन्नों का जोड़ व घटाव',
    planned_date: '2026-09-09',
    target_completion_date: '2026-09-14',
    completed_date: '2026-09-13',
    status: 'Completed',
    created_at: '2026-09-08',
  },
  {
    id: 'syl_2026_09_sunita_3',
    teacher_id: 'teacher_sunita',
    teacher_name: 'सुनीता शर्मा (Sunita Sharma)',
    class_name: 'Class 5',
    subject: 'गणित (Mathematics)',
    month: '2026-09',
    week_number: 3,
    week_label: 'सप्ताह 3 (15 से 21 सितंबर)',
    chapter_title: 'Chapter 5: दशमलव संख्याएं (Decimals)',
    topic_description: 'अभ्यास 5.1: दशमलव का स्थानीय मान व सामान्य भिन्न में बदलना',
    planned_date: '2026-09-16',
    target_completion_date: '2026-09-21',
    completed_date: '2026-09-20',
    status: 'Completed',
    created_at: '2026-09-15',
  },
  {
    id: 'syl_2026_09_sunita_4',
    teacher_id: 'teacher_sunita',
    teacher_name: 'सुनीता शर्मा (Sunita Sharma)',
    class_name: 'Class 5',
    subject: 'गणित (Mathematics)',
    month: '2026-09',
    week_number: 4,
    week_label: 'सप्ताह 4 (22 से 30 सितंबर)',
    chapter_title: 'Chapter 5: दशमलव संख्याएं (Decimals)',
    topic_description: 'अभ्यास 5.2: दैनिक जीवन में दशमलव का प्रयोग व यूनिट टेस्ट अभ्यास',
    planned_date: '2026-09-23',
    target_completion_date: '2026-09-28',
    status: 'Completed',
    completed_date: '2026-09-27',
    created_at: '2026-09-22',
  },
];

export const loadLocalSyllabusTopics = (): SyllabusTopicRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_SEED_SYLLABUS_TOPICS;
};

export const saveLocalSyllabusTopics = (topics: SyllabusTopicRecord[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(topics));
  } catch {}
};

export const TeacherSyllabusPlanner: React.FC<TeacherSyllabusPlannerProps> = ({
  currentUser,
  allTeachers = [],
  isManager = false,
  onClose,
  onSyllabusUpdated,
}) => {
  const [topics, setTopics] = useState<SyllabusTopicRecord[]>(() => loadLocalSyllabusTopics());
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getDefaultAcademicMonth());
  const [selectedWeek, setSelectedWeek] = useState<number>(0); // 0 = All Weeks
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(
    currentUser?.User_ID || currentUser?.Username || allTeachers[0]?.User_ID || 'teacher_sunita'
  );
  const [filterStatus, setFilterStatus] = useState<'all' | 'Completed' | 'In_Progress' | 'Pending'>('all');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);

  // Form State for Adding / Editing Topic Goal
  const [formChapter, setFormChapter] = useState<string>('');
  const [formTopic, setFormTopic] = useState<string>('');
  const [formClass, setFormClass] = useState<string>(currentUser?.Assigned_Class || 'Class 5');
  const [formSubject, setFormSubject] = useState<string>('गणित (Mathematics)');
  const [formWeekNumber, setFormWeekNumber] = useState<number>(1);
  const [formPlannedDate, setFormPlannedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formTargetDate, setFormTargetDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);

  const [isRefreshingSheet, setIsRefreshingSheet] = useState<boolean>(false);

  // Keep selectedTeacherId synced when currentUser or allTeachers updates
  useEffect(() => {
    if (!isManager && (currentUser?.User_ID || currentUser?.Username)) {
      setSelectedTeacherId(currentUser.User_ID || currentUser.Username);
      if (currentUser.Assigned_Class) setFormClass(currentUser.Assigned_Class);
    } else if (isManager && !selectedTeacherId && allTeachers[0]?.User_ID) {
      setSelectedTeacherId(allTeachers[0].User_ID);
    }
  }, [isManager, currentUser?.User_ID, currentUser?.Username, currentUser?.Assigned_Class, allTeachers]);

  const handleSyncSyllabusFromSheet = async (showBanner = true) => {
    setIsRefreshingSheet(true);
    try {
      const res = await fetch('/api/syllabus-tracker?refresh=1');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setTopics(data);
          saveLocalSyllabusTopics(data);
          if (onSyllabusUpdated) onSyllabusUpdated(data);
        }
        if (showBanner) {
          setSyncStatus('🔄 Google Sheet "Syllabus_Tracker" से ताज़ा पाठ्यक्रम डेटा सिंक हो गया!');
          setTimeout(() => setSyncStatus(null), 3500);
        }
      }
    } catch {}
    setIsRefreshingSheet(false);
  };

  // Fetch topics from API on mount
  useEffect(() => {
    fetch('/api/syllabus-tracker')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setTopics(data);
          saveLocalSyllabusTopics(data);
        }
      })
      .catch(() => {});
  }, []);

  const targetTeacherObj = useMemo(() => {
    if (!isManager && currentUser) return currentUser;
    return allTeachers.find(
      (t) => String(t.User_ID || '').trim() === String(selectedTeacherId || '').trim() ||
             String(t.Username || '').trim() === String(selectedTeacherId || '').trim()
    ) || currentUser;
  }, [isManager, currentUser, allTeachers, selectedTeacherId]);

  const matchesActiveTeacher = (topic: SyllabusTopicRecord): boolean => {
    const tId = String(topic.teacher_id || '').trim().toLowerCase();
    const activeId = String((!isManager ? (currentUser?.User_ID || currentUser?.Username) : selectedTeacherId) || '').trim().toLowerCase();
    const activeUname = String(targetTeacherObj?.Username || '').trim().toLowerCase();
    const activeName = String(targetTeacherObj?.Name || '').trim().toLowerCase();
    const topicName = String(topic.teacher_name || '').trim().toLowerCase();

    if (activeId && tId === activeId) return true;
    if (activeUname && tId === activeUname) return true;
    if (activeName && topicName && topicName === activeName) return true;
    return false;
  };

  // Filtered Topics for current teacher and month
  const activeTeacherTopics = useMemo(() => {
    return topics.filter((t) => {
      const matchTeacher = isManager ? (selectedTeacherId ? matchesActiveTeacher(t) : true) : matchesActiveTeacher(t);
      const matchMonth = String(t.month || '').slice(0, 7) === selectedMonth;
      const matchWeek = selectedWeek === 0 || Number(t.week_number) === selectedWeek;
      const matchStatus = filterStatus === 'all' || t.status === filterStatus;
      return matchTeacher && matchMonth && matchWeek && matchStatus;
    });
  }, [topics, isManager, selectedTeacherId, currentUser, targetTeacherObj, selectedMonth, selectedWeek, filterStatus]);

  // Overall Monthly Metrics for Selected Teacher
  const monthlyMetrics = useMemo(() => {
    const teacherMonthTopics = topics.filter(
      (t) => matchesActiveTeacher(t) && String(t.month || '').slice(0, 7) === selectedMonth
    );
    const totalPlanned = teacherMonthTopics.length;
    const completed = teacherMonthTopics.filter((t) => t.status === 'Completed').length;
    const inProgress = teacherMonthTopics.filter((t) => t.status === 'In_Progress').length;
    const pending = teacherMonthTopics.filter((t) => t.status === 'Pending').length;

    const completionPercent = totalPlanned > 0 ? Math.round((completed / totalPlanned) * 100) : 0;
    // Score out of 30 points
    const syllabusScore = totalPlanned > 0 ? Math.min(30, Math.round(((completed / totalPlanned) * 30) * 10) / 10) : 0;

    return {
      totalPlanned,
      completed,
      inProgress,
      pending,
      completionPercent,
      syllabusScore,
    };
  }, [topics, isManager, selectedTeacherId, currentUser, targetTeacherObj, selectedMonth]);

  // Toggle status with 1-click
  const handleToggleStatus = async (topicId: string, nextStatus: 'Pending' | 'In_Progress' | 'Completed') => {
    const updated = topics.map((t) => {
      if (t.id === topicId) {
        return {
          ...t,
          status: nextStatus,
          completed_date: nextStatus === 'Completed' ? new Date().toISOString().split('T')[0] : undefined,
          timestamp: new Date().toISOString(),
        };
      }
      return t;
    });
    setTopics(updated);
    saveLocalSyllabusTopics(updated);
    if (onSyllabusUpdated) onSyllabusUpdated(updated);

    const changedItem = updated.find((t) => t.id === topicId);
    if (changedItem) {
      try {
        const res = await fetch('/api/syllabus-tracker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changedItem),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.sheetSynced === false) {
          setSyncStatus(`⚠️ स्थिति ऐप में बदली, पर Google Sheet में नहीं: ${data.sheetError || 'Code.gs doPost अपडेट करें'}`);
          setTimeout(() => setSyncStatus(null), 7000);
        } else {
          setSyncStatus(`स्थिति अपडेट: ${nextStatus === 'Completed' ? '✅ पूर्ण' : nextStatus === 'In_Progress' ? '🔄 प्रगति पर' : '⏳ लंबित'}`);
          setTimeout(() => setSyncStatus(null), 3000);
        }
      } catch (e) {
        console.warn('Sync error:', e);
      }
    }
  };

  // Add / Edit Topic Goal Submit
  const handleSaveTopicGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formChapter.trim() || !formTopic.trim()) return;

    setIsSubmitting(true);
    const teacherObj = targetTeacherObj || allTeachers.find((t) => t.User_ID === selectedTeacherId) || currentUser;
    const teacherName = teacherObj?.Name || teacherObj?.Username || 'शिक्षक';
    const resolvedTeacherId = (!isManager && (currentUser?.User_ID || currentUser?.Username))
      ? (currentUser.User_ID || currentUser.Username)
      : (teacherObj?.User_ID || teacherObj?.Username || selectedTeacherId);

    const newRecord: SyllabusTopicRecord = {
      id: editingTopicId || `syl_${selectedMonth.replace('-', '_')}_${resolvedTeacherId}_${Date.now()}`,
      teacher_id: resolvedTeacherId,
      teacher_name: teacherName,
      class_name: formClass,
      subject: formSubject,
      month: selectedMonth,
      week_number: formWeekNumber,
      week_label: `सप्ताह ${formWeekNumber}`,
      chapter_title: formChapter.trim(),
      topic_description: formTopic.trim(),
      planned_date: formPlannedDate,
      target_completion_date: formTargetDate,
      status: 'Pending',
      created_at: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
    };

    let updatedList: SyllabusTopicRecord[];
    if (editingTopicId) {
      updatedList = topics.map((t) => (t.id === editingTopicId ? { ...t, ...newRecord } : t));
    } else {
      updatedList = [newRecord, ...topics];
    }

    setTopics(updatedList);
    saveLocalSyllabusTopics(updatedList);
    if (onSyllabusUpdated) onSyllabusUpdated(updatedList);

    try {
      const res = await fetch('/api/syllabus-tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRecord),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.sheetSynced === false) {
        setSyncStatus(`⚠️ लक्ष्य ऐप में जुड़ा, लेकिन Google Sheet में नहीं गया (${data?.sheetError || 'Code.gs doPost में saveSyllabusTopic जोड़ें'})`);
        setTimeout(() => setSyncStatus(null), 8000);
      } else {
        setSyncStatus('✅ साप्ताहिक पाठ्यक्रम लक्ष्य Google Sheet "Syllabus_Tracker" में सुरक्षित!');
        setTimeout(() => setSyncStatus(null), 4000);
      }
    } catch {
      setSyncStatus('⚠️ नेटवर्क त्रुटि: केवल स्थानीय रूप से सुरक्षित');
      setTimeout(() => setSyncStatus(null), 5000);
    }

    // Reset Form
    setFormChapter('');
    setFormTopic('');
    setEditingTopicId(null);
    setShowAddModal(false);
    setIsSubmitting(false);
  };

  // Delete topic
  const handleDeleteTopic = async (id: string) => {
    if (!confirm('क्या आप इस पाठ्यक्रम लक्ष्य को हटाना चाहते हैं?')) return;
    const filtered = topics.filter((t) => t.id !== id);
    setTopics(filtered);
    saveLocalSyllabusTopics(filtered);
    if (onSyllabusUpdated) onSyllabusUpdated(filtered);

    try {
      const res = await fetch(`/api/syllabus-tracker/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (data?.sheetSynced === false) {
        setSyncStatus(`⚠️ लक्ष्य ऐप से हटा, पर Google Sheet से नहीं: ${data.sheetError || 'Code.gs अपडेट करें'}`);
        setTimeout(() => setSyncStatus(null), 7000);
      }
    } catch {}
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-6 animate-fadeIn">
      {/* 1. Header with Title & Action Button */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#163a6f] to-[#0c2340] text-white p-5 sm:p-6 rounded-2xl shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-black text-[10px] tracking-wider uppercase border border-amber-400/30">
                📚 पैरामीटर 1 • वेटेज 30 अंक
              </span>
              <span className="text-slate-300 text-xs font-semibold">Weekly Syllabus Goal Planner</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white mt-1 flex items-center gap-2">
              <i className="fa-solid fa-book-open-reader text-amber-400"></i>
              <span>साप्ताहिक पाठ्यक्रम प्रगति ट्रैकर (Syllabus Tracker)</span>
            </h2>
            <p className="text-slate-300 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
              शिक्षक प्रत्येक सप्ताह के निर्धारित पाठ (Chapters) व टॉपिक्स दर्ज करें और पूर्ण होने पर 1-क्लिक से स्थिति बदलें। 
              माह के अंत में पाठ्यक्रम पूर्णता प्रतिशत के आधार पर स्वतः <strong>30 में से अंक</strong> लीडरबोर्ड में जुड़ते हैं।
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => handleSyncSyllabusFromSheet(true)}
              disabled={isRefreshingSheet}
              className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold text-xs sm:text-sm rounded-xl border border-white/25 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
              title="Google Sheet (Syllabus_Tracker) से 2-Way सिंक करें"
            >
              <i className={`fa-solid fa-arrows-rotate ${isRefreshingSheet ? 'fa-spin' : ''}`}></i>
              <span>{isRefreshingSheet ? 'सिंक हो रहा है...' : 'Sheet सिंक'}</span>
            </button>

            <button
              onClick={() => {
                setEditingTopicId(null);
                setFormChapter('');
                setFormTopic('');
                setShowAddModal(true);
              }}
              className="px-4 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer transform active:scale-95"
            >
              <i className="fa-solid fa-plus-circle text-base"></i>
              <span>+ नया वीकली लक्ष्य जोड़ें</span>
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="p-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/20 transition-all cursor-pointer"
                title="बंद करें"
              >
                <i className="fa-solid fa-xmark text-lg"></i>
              </button>
            )}
          </div>
        </div>

        {/* 2. Monthly Summary Progress Meter (Out of 30 Points) */}
        <div className="mt-5 pt-5 border-t border-white/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-white/10 rounded-xl p-3 border border-white/10">
            <span className="text-slate-300 block text-[11px]">कुल नियोजित टॉपिक्स</span>
            <strong className="text-white text-lg font-black font-mono">
              {monthlyMetrics.totalPlanned} टॉपिक्स
            </strong>
          </div>

          <div className="bg-white/10 rounded-xl p-3 border border-white/10">
            <span className="text-slate-300 block text-[11px]">पूर्ण किए गए टॉपिक्स</span>
            <strong className="text-emerald-300 text-lg font-black font-mono">
              {monthlyMetrics.completed} पूर्ण ✅
            </strong>
          </div>

          <div className="bg-white/10 rounded-xl p-3 border border-white/10">
            <span className="text-slate-300 block text-[11px]">पाठ्यक्रम प्रगति दर</span>
            <strong className="text-amber-300 text-lg font-black font-mono">
              {monthlyMetrics.completionPercent}%
            </strong>
          </div>

          <div className="bg-amber-400 text-slate-950 rounded-xl p-3 shadow-md">
            <span className="text-slate-900 block text-[11px] font-bold">मासिक प्रदर्शन अंक (Score)</span>
            <strong className="text-xl font-black font-mono">
              {monthlyMetrics.syllabusScore} / 30 अंक
            </strong>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 bg-white/20 rounded-full h-3 overflow-hidden p-0.5">
          <div
            className="bg-gradient-to-r from-amber-400 via-emerald-400 to-emerald-300 h-full rounded-full transition-all duration-500"
            style={{ width: `${monthlyMetrics.completionPercent}%` }}
          ></div>
        </div>
      </div>

      {/* Sync Status Banner */}
      {syncStatus && (
        <div
          className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-fadeIn border ${
            syncStatus.includes('⚠️')
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}
        >
          <i className={`fa-solid ${syncStatus.includes('⚠️') ? 'fa-triangle-exclamation text-amber-600' : 'fa-circle-check text-emerald-600'}`}></i>
          <span>{syncStatus}</span>
        </div>
      )}

      {/* 3. Filter Controls: Month, Week & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-2.5">
          {isManager && (
            <div>
              <label className="block text-[10px] font-bold text-slate-500 mb-1">शिक्षक चुनें:</label>
              <select
                value={selectedTeacherId}
                onChange={(e) => setSelectedTeacherId(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 cursor-pointer"
              >
                {allTeachers.map((t) => (
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
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 cursor-pointer"
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
              onChange={(e) => setSelectedWeek(parseInt(e.target.value, 10))}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 cursor-pointer"
            >
              <option value={0}>समस्त सप्ताह (All Weeks)</option>
              <option value={1}>सप्ताह 1 (दिन 1 से 7)</option>
              <option value={2}>सप्ताह 2 (दिन 8 से 14)</option>
              <option value={3}>सप्ताह 3 (दिन 15 से 21)</option>
              <option value={4}>सप्ताह 4 (दिन 22 से 28)</option>
              <option value={5}>सप्ताह 5 (दिन 29 से 31)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">स्थिति (Status):</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-800 cursor-pointer"
            >
              <option value="all">सभी स्थितियाँ</option>
              <option value="Completed">✅ पूर्ण (Completed)</option>
              <option value="In_Progress">🔄 प्रगति पर (In Progress)</option>
              <option value="Pending">⏳ लंबित (Pending)</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-bold text-slate-500 text-right">
          कुल: <span className="text-blue-900 font-black">{activeTeacherTopics.length}</span> टॉपिक्स प्रदर्शित
        </div>
      </div>

      {/* 4. Weekly Topics List Table / Cards */}
      {activeTeacherTopics.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-6 space-y-3">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto text-xl">
            <i className="fa-solid fa-list-check"></i>
          </div>
          <h4 className="text-sm font-bold text-slate-700">इस माह/सप्ताह के लिए कोई पाठ्यक्रम लक्ष्य नहीं मिला</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            शिक्षक ऊपर दिए गए "+ नया वीकली लक्ष्य जोड़ें" बटन पर क्लिक करके अपने इस सप्ताह के पाठ व टॉपिक निर्धारित करें।
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-900 text-amber-300 text-xs font-bold rounded-xl shadow-xs cursor-pointer hover:bg-blue-800"
          >
            + पहला वीकली लक्ष्य जोड़ें
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {activeTeacherTopics.map((topic, index) => {
            const isCompleted = topic.status === 'Completed';
            const isInProgress = topic.status === 'In_Progress';

            return (
              <div
                key={topic.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                  isCompleted
                    ? 'bg-emerald-50/60 border-emerald-200'
                    : isInProgress
                    ? 'bg-amber-50/60 border-amber-200'
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 shadow-xs ${
                      isCompleted
                        ? 'bg-emerald-600 text-white'
                        : isInProgress
                        ? 'bg-amber-500 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isCompleted ? '✓' : topic.week_number}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-900">
                        {topic.class_name} • {topic.subject}
                      </span>
                      <span className="text-[11px] font-bold text-slate-500">
                        {topic.week_label || `सप्ताह ${topic.week_number}`}
                      </span>
                      {topic.target_completion_date && (
                        <span className="text-[10px] text-slate-500">
                          लक्ष्य तिथि: <strong>{topic.target_completion_date}</strong>
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-black text-slate-800 mt-1">
                      {topic.chapter_title}
                    </h4>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      {topic.topic_description}
                    </p>

                    {isCompleted && topic.completed_date && (
                      <span className="text-[10px] text-emerald-700 font-bold block mt-1">
                        🎯 पूर्णता तिथि: {topic.completed_date}
                      </span>
                    )}
                  </div>
                </div>

                {/* Status Switcher & Actions */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(topic.id, 'Pending')}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      topic.status === 'Pending'
                        ? 'bg-slate-800 text-white shadow-xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                    title="लंबित मार्क करें"
                  >
                    ⏳ लंबित
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleStatus(topic.id, 'In_Progress')}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      isInProgress
                        ? 'bg-amber-500 text-white shadow-xs'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                    }`}
                    title="प्रगति पर मार्क करें"
                  >
                    🔄 प्रगति पर
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleStatus(topic.id, 'Completed')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                      isCompleted
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-white text-emerald-700 border border-emerald-300 hover:bg-emerald-50'
                    }`}
                    title="पूर्ण मार्क करें (अंक सीधे बढ़ेंगे)"
                  >
                    <i className="fa-solid fa-check"></i>
                    <span>पूर्ण (Done)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteTopic(topic.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                    title="हटाएं"
                  >
                    <i className="fa-solid fa-trash-can text-xs"></i>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. ADD / EDIT SYLLABUS GOAL MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border-2 border-amber-400 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-[#0c2340] to-[#163a6f] text-white p-5 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-0.5">
                  📚 साप्ताहिक पाठ्यक्रम योजना
                </span>
                <h3 className="text-base sm:text-lg font-black text-white">
                  {editingTopicId ? 'पाठ्यक्रम लक्ष्य संशोधित करें' : 'नया साप्ताहिक लक्ष्य जोड़ें (Set Weekly Goal)'}
                </h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTopicGoal} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">कक्षा (Class):</label>
                  <select
                    value={formClass}
                    onChange={(e) => setFormClass(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  >
                    <option value="Class 1">Class 1</option>
                    <option value="Class 2">Class 2</option>
                    <option value="Class 3">Class 3</option>
                    <option value="Class 4">Class 4</option>
                    <option value="Class 5">Class 5</option>
                    <option value="Class 6">Class 6</option>
                    <option value="Class 7">Class 7</option>
                    <option value="Class 8">Class 8</option>
                    <option value="Class 9">Class 9</option>
                    <option value="Class 10">Class 10</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">विषय (Subject):</label>
                  <input
                    type="text"
                    value={formSubject}
                    onChange={(e) => setFormSubject(e.target.value)}
                    placeholder="उदा. गणित / विज्ञान / हिंदी"
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">सप्ताह का चयन (Week):</label>
                  <select
                    value={formWeekNumber}
                    onChange={(e) => setFormWeekNumber(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  >
                    <option value={1}>सप्ताह 1 (1 से 7 तारीख)</option>
                    <option value={2}>सप्ताह 2 (8 से 14 तारीख)</option>
                    <option value={3}>सप्ताह 3 (15 से 21 तारीख)</option>
                    <option value={4}>सप्ताह 4 (22 से 28 तारीख)</option>
                    <option value={5}>सप्ताह 5 (29 से 31 तारीख)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">लक्ष्य पूर्णता तिथि:</label>
                  <input
                    type="date"
                    value={formTargetDate}
                    onChange={(e) => setFormTargetDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  पाठ / चैप्टर का नाम (Chapter Title):
                </label>
                <input
                  type="text"
                  value={formChapter}
                  onChange={(e) => setFormChapter(e.target.value)}
                  placeholder="उदा. Chapter 4: भिन्न (Fractions)"
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs font-bold text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  टॉपिक / अभ्यास का विस्तृत विवरण (Topics to Cover):
                </label>
                <textarea
                  value={formTopic}
                  onChange={(e) => setFormTopic(e.target.value)}
                  placeholder="उदा. अभ्यास 4.1 और 4.2 - भिन्नों का परिचय, सम-विषम भिन्न पहचान और गृहकार्य अभ्यास"
                  rows={3}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-xs text-slate-800"
                ></textarea>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold text-xs hover:bg-slate-100 cursor-pointer"
                >
                  रद्द करें
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-gradient-to-r from-blue-900 to-indigo-900 hover:from-blue-800 hover:to-indigo-800 text-amber-300 font-black text-xs rounded-xl shadow-md cursor-pointer flex items-center gap-1.5"
                >
                  <i className="fa-solid fa-cloud-arrow-up"></i>
                  <span>{isSubmitting ? 'सुरक्षित हो रहा है...' : 'लक्ष्य सुरक्षित करें'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
