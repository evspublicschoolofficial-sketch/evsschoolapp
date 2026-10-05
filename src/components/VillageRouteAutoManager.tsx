import React, { useState, useMemo, useEffect } from 'react';
import { Student } from '../types';

export interface VillageRouteConfig {
  villageName: string;
  monthlyAutoFee: number;
  driverName?: string;
  vehicleNo?: string;
  notes?: string;
}

export interface StudentAutoRecord {
  studentId: string;
  isAutoCommuter: boolean;
  village: string;
  customRate?: number;
}

interface VillageRouteAutoManagerProps {
  students: Student[];
  getClassName?: (classIdOrName: string | null | undefined) => string;
}

export const VillageRouteAutoManager: React.FC<VillageRouteAutoManagerProps> = ({
  students = [],
  getClassName = (c) => c || 'N/A',
}) => {
  // 1. Village Route configurations (Village Name -> Monthly Rate)
  const [villageConfigs, setVillageConfigs] = useState<Record<string, VillageRouteConfig>>(() => {
    try {
      const saved = localStorage.getItem('evs_village_auto_config');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      'nayabans': { villageName: 'Nayabans', monthlyAutoFee: 400, driverName: 'Amjad' },
      'chaura khurd': { villageName: 'Chaura Khurd', monthlyAutoFee: 450, driverName: 'Amjad' },
      'ibrahimpura': { villageName: 'Ibrahimpura', monthlyAutoFee: 350, driverName: 'Amjad' },
      'majhar hasan chilkana': { villageName: 'Majhar Hasan chilkana', monthlyAutoFee: 500, driverName: 'Amjad' },
    };
  });

  // 2. Student Auto Opt-In Map (StudentID -> { isAutoCommuter: boolean, village: string, customRate?: number })
  const [studentAutoMap, setStudentAutoMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('evs_auto_students_map');
      if (saved) return JSON.parse(saved);
    } catch {}
    // Seed default: if student has a village that is not local/school village, or empty
    return {};
  });

  // Save to localStorage whenever state changes
  useEffect(() => {
    try {
      localStorage.setItem('evs_village_auto_config', JSON.stringify(villageConfigs));
    } catch {}
  }, [villageConfigs]);

  useEffect(() => {
    try {
      localStorage.setItem('evs_auto_students_map', JSON.stringify(studentAutoMap));
    } catch {}
  }, [studentAutoMap]);

  // View state
  const [activeTab, setActiveTab] = useState<'routes' | 'students'>('routes');
  const [searchStudent, setSearchStudent] = useState<string>('');
  const [filterVillage, setFilterVillage] = useState<string>('all');
  const [autoOnlyFilter, setAutoOnlyFilter] = useState<'all' | 'auto' | 'self'>('all');
  const [newVillageName, setNewVillageName] = useState<string>('');
  const [newVillageFee, setNewVillageFee] = useState<string>('400');
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Helper to extract student village safely
  const getStudentVillage = (s: Student): string => {
    const raw = String(s['Village/rRoute'] || s.Village || s.village || s.Route || s.route || '').trim();
    return raw || 'स्थानीय (Local)';
  };

  // Discover all distinct villages present in the students database
  const detectedVillages = useMemo(() => {
    const villageSet = new Set<string>();
    students.forEach((s) => {
      const v = getStudentVillage(s);
      if (v && v !== 'स्थानीय (Local)') {
        villageSet.add(v);
      }
    });
    // Add existing configured villages as well
    Object.values(villageConfigs).forEach((cfg: VillageRouteConfig) => {
      if (cfg && cfg.villageName) villageSet.add(cfg.villageName);
    });
    return Array.from(villageSet).sort();
  }, [students, villageConfigs]);

  // Handle Village Rate Change
  const handleUpdateVillageRate = (vKey: string, newRate: number) => {
    setVillageConfigs((prev) => {
      const existing = prev[vKey.toLowerCase()] || { villageName: vKey, monthlyAutoFee: 400 };
      return {
        ...prev,
        [vKey.toLowerCase()]: {
          ...existing,
          monthlyAutoFee: Math.max(0, newRate),
        },
      };
    });
    setSaveToast(`✅ ${vKey} की मासिक दर ₹${newRate} अपडेट हो गई!`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  // Add new village
  const handleAddVillage = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newVillageName.trim();
    const rate = Number(newVillageFee) || 0;
    if (!name) return;
    const key = name.toLowerCase();
    setVillageConfigs((prev) => ({
      ...prev,
      [key]: {
        villageName: name,
        monthlyAutoFee: rate,
        driverName: 'Amjad',
      },
    }));
    setNewVillageName('');
    setNewVillageFee('400');
    setSaveToast(`✅ नया गांव '${name}' सफलतापूर्वक जुड़ गया!`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  // Toggle single student auto status
  const handleToggleStudentAuto = (studentId: string) => {
    const sId = String(studentId).toLowerCase().trim();
    setStudentAutoMap((prev) => {
      const cur = !!prev[sId];
      return {
        ...prev,
        [sId]: !cur,
      };
    });
  };

  // Bulk mark all students from a village as Auto Commuters
  const handleBulkVillageAuto = (villageName: string, enable: boolean) => {
    setStudentAutoMap((prev) => {
      const updated = { ...prev };
      students.forEach((s) => {
        if (getStudentVillage(s).toLowerCase() === villageName.toLowerCase()) {
          const sId = String(s.Student_ID).toLowerCase().trim();
          updated[sId] = enable;
        }
      });
      return updated;
    });
    setSaveToast(`✅ ${villageName} के सभी छात्रों के लिए ऑटो सुविधा ${enable ? 'शुरू' : 'बंद'} कर दी गई!`);
    setTimeout(() => setSaveToast(null), 2500);
  };

  // Statistics
  const autoStats = useMemo(() => {
    let totalAuto = 0;
    let totalSelf = 0;
    let totalExpectedMonthlyFee = 0;

    students.forEach((s) => {
      const sId = String(s.Student_ID).toLowerCase().trim();
      const isAuto = !!studentAutoMap[sId];
      if (isAuto) {
        totalAuto++;
        const v = getStudentVillage(s);
        const vKey = v.toLowerCase();
        const rate = villageConfigs[vKey]?.monthlyAutoFee ?? 400;
        totalExpectedMonthlyFee += rate;
      } else {
        totalSelf++;
      }
    });

    return {
      totalStudents: students.length,
      totalAuto,
      totalSelf,
      totalVillages: detectedVillages.length,
      totalExpectedMonthlyFee,
    };
  }, [students, studentAutoMap, villageConfigs, detectedVillages]);

  // Filtered Students List
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const sId = String(s.Student_ID).toLowerCase().trim();
      const isAuto = !!studentAutoMap[sId];
      const v = getStudentVillage(s);

      // Search filter
      const q = searchStudent.toLowerCase().trim();
      const matchSearch =
        q === '' ||
        String(s.Student_Name || '').toLowerCase().includes(q) ||
        String(s.Student_ID || '').toLowerCase().includes(q) ||
        String(s.Father_Name || '').toLowerCase().includes(q) ||
        String(s.Parent_Mobile || '').toLowerCase().includes(q) ||
        v.toLowerCase().includes(q);

      // Village filter
      const matchVillage = filterVillage === 'all' || v.toLowerCase() === filterVillage.toLowerCase();

      // Auto status filter
      const matchAuto =
        autoOnlyFilter === 'all' ||
        (autoOnlyFilter === 'auto' && isAuto) ||
        (autoOnlyFilter === 'self' && !isAuto);

      return matchSearch && matchVillage && matchAuto;
    });
  }, [students, searchStudent, filterVillage, autoOnlyFilter, studentAutoMap]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Toast Notification */}
      {saveToast && (
        <div className="fixed top-16 right-4 z-50 bg-emerald-700 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-emerald-400 text-xs font-bold flex items-center gap-2 animate-bounce">
          <i className="fa-solid fa-circle-check text-base"></i>
          <span>{saveToast}</span>
        </div>
      )}

      {/* Main Header Card */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] rounded-3xl p-5 sm:p-6 text-white shadow-xl border border-blue-900/50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-2xl font-black shadow-md shrink-0">
              <i className="fa-solid fa-van-shuttle"></i>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black text-amber-300">
                  ऑटो व वाहन रूट फीस प्रबंधन (Auto / Transport System)
                </h2>
                <span className="text-[10px] bg-amber-400/20 text-amber-300 border border-amber-400/40 px-2.5 py-0.5 rounded-full font-bold">
                  गांव-वार रूट दरें
                </span>
              </div>
              <p className="text-xs text-blue-200 mt-1 max-w-2xl">
                कौन सा बच्चा ऑटो वाला है और किस गांव से आता है — गांव के हिसाब से अलग-अलग मासिक ऑटो दरें निर्धारित करें।
              </p>
            </div>
          </div>

          {/* Quick Stats Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-white/10 px-3.5 py-2 rounded-2xl border border-white/20 text-center">
              <div className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">कुल ऑटो छात्र</div>
              <div className="text-lg font-black text-white">{autoStats.totalAuto} / {autoStats.totalStudents}</div>
            </div>
            <div className="bg-white/10 px-3.5 py-2 rounded-2xl border border-white/20 text-center">
              <div className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">मासिक ऑटो आय</div>
              <div className="text-lg font-black text-emerald-300">₹{autoStats.totalExpectedMonthlyFee.toLocaleString('en-IN')}</div>
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="mt-5 pt-4 border-t border-white/10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('routes')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
              activeTab === 'routes'
                ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <i className="fa-solid fa-map-location-dot"></i>
            <span>1. गांव व रूट अनुसार ऑटो दरें ({detectedVillages.length} गांव)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('students')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
              activeTab === 'students'
                ? 'bg-amber-400 text-slate-950 shadow-md font-black'
                : 'bg-white/10 text-white hover:bg-white/20'
            }`}
          >
            <i className="fa-solid fa-users-line"></i>
            <span>2. ऑटो वाले छात्र सूची ({autoStats.totalAuto} ऑटो / {autoStats.totalSelf} पैदल)</span>
          </button>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: VILLAGE / ROUTE RATES CONFIGURATION                           */}
      {/* ==================================================================== */}
      {activeTab === 'routes' && (
        <div className="space-y-6">
          {/* Add New Village / Route Form */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-2xs">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
              <i className="fa-solid fa-plus-circle text-amber-600"></i>
              <span>नया गांव अथवा ऑटो रूट जोड़ें (Add New Village Route)</span>
            </h3>
            <form onSubmit={handleAddVillage} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={newVillageName}
                  onChange={(e) => setNewVillageName(e.target.value)}
                  placeholder="गांव का नाम दर्ज करें (उदा. Nayabans, Ibrahimpura, Chilkana)..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold focus:border-blue-900 outline-none"
                  required
                />
              </div>
              <div className="w-full sm:w-48 flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600 shrink-0">मासिक दर: ₹</span>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={newVillageFee}
                  onChange={(e) => setNewVillageFee(e.target.value)}
                  placeholder="उदा. 450"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-blue-950 focus:border-blue-900 outline-none"
                  required
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 bg-blue-950 hover:bg-blue-900 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm cursor-pointer shrink-0 transition-colors"
              >
                <i className="fa-solid fa-check"></i>
                <span>रूट सुरक्षित करें</span>
              </button>
            </form>
          </div>

          {/* Villages Grid Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {detectedVillages.map((vName) => {
              const vKey = vName.toLowerCase();
              const cfg = villageConfigs[vKey] || { villageName: vName, monthlyAutoFee: 400 };

              // Count students from this village
              const villageStudents = students.filter(
                (s) => getStudentVillage(s).toLowerCase() === vKey
              );
              const villageAutoCount = villageStudents.filter(
                (s) => !!studentAutoMap[String(s.Student_ID).toLowerCase().trim()]
              ).length;
              const villageMonthlyTotal = villageAutoCount * cfg.monthlyAutoFee;

              return (
                <div
                  key={vName}
                  className="bg-white rounded-3xl p-5 border border-slate-200 shadow-2xs hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center text-lg font-bold shrink-0">
                          <i className="fa-solid fa-location-dot"></i>
                        </div>
                        <div>
                          <h4 className="font-extrabold text-slate-900 text-sm">{vName}</h4>
                          <span className="text-[11px] text-slate-500 font-semibold">
                            कुल छात्र: {villageStudents.length}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                          villageAutoCount > 0
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }`}
                      >
                        {villageAutoCount} ऑटो में
                      </span>
                    </div>

                    {/* Rate Input */}
                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-3">
                      <span className="text-xs font-bold text-slate-700">मासिक ऑटो शुल्क:</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-500">₹</span>
                        <input
                          type="number"
                          min="0"
                          step="50"
                          value={cfg.monthlyAutoFee}
                          onChange={(e) => handleUpdateVillageRate(vName, Number(e.target.value) || 0)}
                          className="w-24 px-2.5 py-1 text-right rounded-lg border border-slate-300 font-black text-blue-950 focus:border-blue-900 outline-none text-xs bg-white"
                        />
                        <span className="text-[11px] text-slate-500">/माह</span>
                      </div>
                    </div>

                    {/* Sub-total */}
                    <div className="flex items-center justify-between text-xs px-1 text-slate-600">
                      <span>अपेक्षित मासिक आय:</span>
                      <span className="font-black text-emerald-700">₹{villageMonthlyTotal.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  {/* Village Actions */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleBulkVillageAuto(vName, true)}
                      className="text-[11px] font-bold text-blue-900 hover:text-blue-950 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-xl cursor-pointer transition-colors"
                      title="इस गांव के सभी छात्रों को ऑटो में शामिल करें"
                    >
                      ✓ सभी को ऑटो दें
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setFilterVillage(vName);
                        setActiveTab('students');
                      }}
                      className="text-[11px] font-bold text-amber-800 hover:text-amber-950 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-xl cursor-pointer transition-colors"
                    >
                      छात्र देखें ({villageStudents.length}) →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: DETAILED STUDENTS AUTO ROSTER (कौन बच्चा ऑटो वाला है)          */}
      {/* ==================================================================== */}
      {activeTab === 'students' && (
        <div className="space-y-4">
          {/* Filters & Search Toolbar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-3 text-slate-400 text-xs"></i>
              <input
                type="text"
                value={searchStudent}
                onChange={(e) => setSearchStudent(e.target.value)}
                placeholder="छात्र का नाम, पिता का नाम, मोबाइल अथवा गांव खोजें..."
                className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:border-blue-900 outline-none"
              />
            </div>

            {/* Village Filter Dropdown */}
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={filterVillage}
                onChange={(e) => setFilterVillage(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold bg-white text-slate-700 outline-none"
              >
                <option value="all">सभी गांव / रूट ({detectedVillages.length})</option>
                {detectedVillages.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>

              {/* Status Filter */}
              <div className="flex items-center p-1 bg-slate-100 rounded-xl">
                {(['all', 'auto', 'self'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAutoOnlyFilter(mode)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      autoOnlyFilter === mode
                        ? 'bg-blue-950 text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {mode === 'all' ? 'सभी' : mode === 'auto' ? '🚌 सिर्फ ऑटो वाले' : '🚶 पैदल / स्वयं'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Students Table */}
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3.5">छात्र विवरण (Student Info)</th>
                    <th className="px-4 py-3.5">कक्षा (Class)</th>
                    <th className="px-4 py-3.5">गांव / रूट (Village/Route)</th>
                    <th className="px-4 py-3.5 text-center">ऑटो सुविधा (Auto Commuter?)</th>
                    <th className="px-4 py-3.5 text-right">मासिक ऑटो शुल्क</th>
                    <th className="px-4 py-3.5 text-center">अभिभावक संपर्क</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-semibold">
                        कोई छात्र रिकॉर्ड नहीं मिला।
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((s) => {
                      const sId = String(s.Student_ID).toLowerCase().trim();
                      const isAuto = !!studentAutoMap[sId];
                      const v = getStudentVillage(s);
                      const vKey = v.toLowerCase();
                      const rate = villageConfigs[vKey]?.monthlyAutoFee ?? 400;

                      return (
                        <tr
                          key={s.Student_ID}
                          className={`hover:bg-slate-50 transition-colors ${
                            isAuto ? 'bg-amber-50/20' : ''
                          }`}
                        >
                          {/* Student Info */}
                          <td className="px-4 py-3">
                            <div className="font-extrabold text-slate-900 text-sm">{s.Student_Name}</div>
                            <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-2">
                              <span>ID: {s.Student_ID}</span>
                              {s.Father_Name && <span>• पिता: {s.Father_Name}</span>}
                            </div>
                          </td>

                          {/* Class */}
                          <td className="px-4 py-3">
                            <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">
                              {getClassName(s.Class)}
                            </span>
                          </td>

                          {/* Village / Route */}
                          <td className="px-4 py-3">
                            <div className="font-bold text-slate-800 flex items-center gap-1.5">
                              <i className="fa-solid fa-map-pin text-amber-600 text-xs"></i>
                              <span>{v}</span>
                            </div>
                          </td>

                          {/* Auto Toggle Button */}
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleStudentAuto(s.Student_ID)}
                              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer shadow-xs ${
                                isAuto
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300'
                              }`}
                            >
                              <i className={`fa-solid ${isAuto ? 'fa-van-shuttle' : 'fa-person-walking'}`}></i>
                              <span>{isAuto ? '✓ हाँ (ऑटो वाला है)' : '✗ नहीं (पैदल/स्वयं)'}</span>
                            </button>
                          </td>

                          {/* Monthly Auto Fee */}
                          <td className="px-4 py-3 text-right">
                            {isAuto ? (
                              <div className="font-black text-sm text-emerald-800">
                                ₹{rate} <span className="text-[10px] text-slate-500 font-normal">/माह</span>
                              </div>
                            ) : (
                              <div className="text-slate-400 text-xs italic">
                                ₹0 (लागू नहीं)
                              </div>
                            )}
                          </td>

                          {/* Contact */}
                          <td className="px-4 py-3 text-center">
                            {s.Parent_Mobile ? (
                              <a
                                href={`https://wa.me/91${String(s.Parent_Mobile).replace(/\D/g, '')}?text=${encodeURIComponent(
                                  `आदरणीय अभिभावक, ई.वी.एस. पब्लिक स्कूल वैन/ऑटो सेवा: आपके पाल्य ${s.Student_Name} (गांव: ${v}) का ऑटो शुल्क विवरण।`
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-bold cursor-pointer"
                                title="WhatsApp पर संदेश भेजें"
                              >
                                <i className="fa-brands fa-whatsapp text-emerald-600"></i>
                                <span>{s.Parent_Mobile}</span>
                              </a>
                            ) : (
                              <span className="text-slate-400 text-[11px]">N/A</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
