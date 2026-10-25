import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Student, SchoolUser } from '../App';
import {
  BusTrackingRecord,
  fetchBusTrackingFromSheet,
  parseCoordinates,
  VanTelemetry,
  DEFAULT_SCHOOL_COORDS,
  calculateDistanceKm,
  fetchTelemetryFromSharedApi,
  subscribeToBusUpdates,
} from '../utils/busTrackingService';
import { GoogleSheetSyncModal } from './GoogleSheetSyncModal';
import {
  RouteStoppage,
  RouteConfig,
  GpsPoint,
} from '../types/routeTracking';
import {
  DEFAULT_ROUTE_STOPPAGES,
  DEFAULT_ROUTE_CONFIG,
  calculateStoppageEtas,
} from '../utils/etaEngine';
import { InteractiveRouteMap } from './InteractiveRouteMap';
import { StoppageTimelineSidebar } from './StoppageTimelineSidebar';
import { StopCreationModal } from './StopCreationModal';

const STORAGE_KEY_STOPPAGES = 'evs_van_route_stoppages';

interface ManagerVanTrackerProps {
  students?: Student[];
  users?: SchoolUser[];
  onOpenDriverPortal?: () => void;
  getClassName?: (classIdOrName: string | null | undefined) => string;
}

export const ManagerVanTracker: React.FC<ManagerVanTrackerProps> = ({
  users = [],
  onOpenDriverPortal,
}) => {
  // Real Bus_Tracking sheet records
  const [sheetBuses, setSheetBuses] = useState<BusTrackingRecord[]>([]);
  const [loadingSheet, setLoadingSheet] = useState<boolean>(true);
  const [selectedBusId, setSelectedBusId] = useState<string>('ecad7ddc');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('hi-IN'));
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // 15-second sheet sync countdown
  const [countdown, setCountdown] = useState<number>(15);
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);

  // Live telemetry map received from Driver Portal broadcasts, server API & localStorage
  const [liveTelemetry, setLiveTelemetry] = useState<Record<string, VanTelemetry>>(() => {
    try {
      const saved = localStorage.getItem('evs_van_live_locations');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // =========================================================================
  // ROUTE & STOPPAGES STATE (Stored & Interactive - Starts Clean for Real Route)
  // =========================================================================
  const [stoppages, setStoppages] = useState<RouteStoppage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STOPPAGES);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Purge old mock seed if present
        const hasOldSeed = Array.isArray(parsed) && parsed.some((s: any) => s.id === 'stop-01' || s.id === 'stop-02' || s.id === 'stop-03');
        if (!hasOldSeed && Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Error reading stored stoppages:', e);
    }
    return [];
  });

  const [routeConfig, setRouteConfig] = useState<RouteConfig>(() => ({
    ...DEFAULT_ROUTE_CONFIG,
    stoppages,
  }));

  // Pin-drop interactive creation states
  const [isPinDropActive, setIsPinDropActive] = useState<boolean>(false);
  const [tempPinCoords, setTempPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isCreationModalOpen, setIsCreationModalOpen] = useState<boolean>(false);
  const [focusedStoppage, setFocusedStoppage] = useState<RouteStoppage | null>(null);

  // Persist stoppages to localStorage and update routeConfig
  const saveStoppages = useCallback((newStoppages: RouteStoppage[]) => {
    setStoppages(newStoppages);
    setRouteConfig((prev) => ({
      ...prev,
      stoppages: newStoppages,
    }));
    try {
      localStorage.setItem(STORAGE_KEY_STOPPAGES, JSON.stringify(newStoppages));
    } catch (e) {
      console.warn('Could not save stoppages:', e);
    }
  }, []);

  // Fetch real Google Sheet "Bus_Tracking"
  const fetchSheetData = async () => {
    setLoadingSheet(true);
    const records = await fetchBusTrackingFromSheet();
    if (records.length > 0) {
      setSheetBuses(records);
      const amjadBus = records.find(
        (b) => String(b.Driver_Name || '').toLowerCase() === 'amjad'
      );
      if (amjadBus && !selectedBusId) {
        setSelectedBusId(amjadBus.Bus_ID);
      }
    } else {
      setSheetBuses([
        {
          Bus_ID: 'ecad7ddc',
          Driver_Name: 'Amjad',
          Current_Location: '30.056038, 77.419096',
          Last_Updated: new Date().toLocaleString('hi-IN'),
        },
        {
          Bus_ID: '756cedc0',
          Driver_Name: 'Amjad',
          Current_Location: '30.056038, 77.419096',
          Last_Updated: new Date().toLocaleString('hi-IN'),
        },
      ]);
    }
    setLastSyncTime(new Date().toLocaleTimeString('hi-IN'));
    setLoadingSheet(false);
  };

  // Sync with Google Sheets, BroadcastChannel and server API on mount
  useEffect(() => {
    fetchSheetData();

    // Real-time WebSocket subscription for instant location updates
    const unsubscribeWs = subscribeToBusUpdates((msg) => {
      if (msg.type === 'BUS_UPDATE' && msg.telemetry) {
        const loc: VanTelemetry = msg.telemetry;
        setLiveTelemetry((prev) => ({
          ...prev,
          [loc.busId]: loc,
        }));
        setLastSyncTime(new Date().toLocaleTimeString('hi-IN'));
      } else if (msg.type === 'SNAPSHOT' && msg.data) {
        setLiveTelemetry((prev) => ({
          ...prev,
          ...msg.data,
        }));
      }
    });

    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('evs_school_van_tracking');
        broadcastChannelRef.current = bc;
        bc.onmessage = (event) => {
          if (event.data?.type === 'VAN_LOCATION_UPDATE' && event.data.payload) {
            const loc: VanTelemetry = event.data.payload;
            setLiveTelemetry((prev) => ({
              ...prev,
              [loc.busId]: loc,
            }));
            setLastSyncTime(new Date().toLocaleTimeString('hi-IN'));
          }
        };
      }
    } catch (e) {
      console.warn('BroadcastChannel error', e);
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'evs_van_live_locations' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setLiveTelemetry((prev) => ({ ...prev, ...parsed }));
          setLastSyncTime(new Date().toLocaleTimeString('hi-IN'));
        } catch {}
      }
      if (e.key === STORAGE_KEY_STOPPAGES && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            setStoppages(parsed);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      unsubscribeWs();
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // 15-Second Google Sheet & Telemetry refresh loop with countdown
  useEffect(() => {
    if (!autoRefresh) return;

    // 1-second interval to update countdown
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    // Fast 3-second poll for cross-device live telemetry from server API
    const fastApiPoll = setInterval(async () => {
      try {
        const serverData = await fetchTelemetryFromSharedApi();
        if (serverData && Object.keys(serverData).length > 0) {
          setLiveTelemetry((prev) => ({ ...prev, ...serverData }));
        }
      } catch (e) {}

      try {
        const saved = localStorage.getItem('evs_van_live_locations');
        if (saved) {
          setLiveTelemetry((prev) => ({ ...prev, ...JSON.parse(saved) }));
        }
      } catch {}
    }, 3000);

    // 15-second Google Sheet re-fetch
    const sheetSyncTimer = setInterval(() => {
      fetchSheetData();
      setCountdown(15);
    }, 15000);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(fastApiPoll);
      clearInterval(sheetSyncTimer);
    };
  }, [autoRefresh]);

  // Find Driver's phone from Google Sheets "Users" sheet
  const getDriverPhone = (driverName: string): string => {
    const dLower = String(driverName || '').trim().toLowerCase();
    const userMatch = users.find(
      (u) =>
        String(u.Name || '').toLowerCase().includes(dLower) ||
        (dLower.includes('amjad') && String(u.Name || '').toLowerCase().includes('amjad'))
    );
    if (userMatch?.Mobile_number) {
      return String(userMatch.Mobile_number).trim();
    }
    return '9761081818'; // Registered Amjad phone in Users sheet
  };

  // Active bus record from sheet
  const activeBus = useMemo(() => {
    return sheetBuses.find((b) => b.Bus_ID === selectedBusId) || sheetBuses[0];
  }, [sheetBuses, selectedBusId]);

  // Active live telemetry from driver or sheet
  const activeTelemetry: VanTelemetry = useMemo(() => {
    const busId = activeBus?.Bus_ID || 'ecad7ddc';
    const driverName = activeBus?.Driver_Name || 'Amjad';
    const driverPhone = getDriverPhone(driverName);

    // 1. Check if driver actively pushed telemetry
    if (liveTelemetry[busId]) {
      return liveTelemetry[busId];
    }

    // 2. Otherwise parse from Google Sheet "Current_Location"
    const parsed = parseCoordinates(activeBus?.Current_Location);
    return {
      busId,
      driverName,
      driverPhone,
      currentLocationStr: activeBus?.Current_Location || '30.056038, 77.419096',
      latitude: parsed.lat,
      longitude: parsed.lng,
      accuracy: 8,
      speed: 0,
      heading: 0,
      lastUpdated: activeBus?.Last_Updated || new Date().toLocaleString('hi-IN'),
      status: 'running',
      isLiveFromSheet: true,
    };
  }, [activeBus, liveTelemetry, users]);

  // Current GPS point for the ETA engine
  const currentGpsPoint: GpsPoint = useMemo(
    () => ({
      lat: activeTelemetry.latitude,
      lng: activeTelemetry.longitude,
      speed: activeTelemetry.speed,
      heading: activeTelemetry.heading,
      accuracy: activeTelemetry.accuracy,
      timestamp: activeTelemetry.lastUpdated,
    }),
    [activeTelemetry]
  );

  // =========================================================================
  // DYNAMIC ETA ENGINE EXECUTION
  // =========================================================================
  const etaCalculation = useMemo(() => {
    return calculateStoppageEtas(
      currentGpsPoint,
      {
        ...routeConfig,
        stoppages,
      },
      new Date()
    );
  }, [currentGpsPoint, routeConfig, stoppages]);

  // Distance from school campus
  const distanceFromSchool = useMemo(() => {
    return calculateDistanceKm(
      activeTelemetry.latitude,
      activeTelemetry.longitude,
      DEFAULT_SCHOOL_COORDS.lat,
      DEFAULT_SCHOOL_COORDS.lng
    );
  }, [activeTelemetry.latitude, activeTelemetry.longitude]);

  // Copy tracking link for WhatsApp
  const handleCopyTrackingLink = () => {
    const url = `https://www.google.com/maps?q=${activeTelemetry.latitude},${activeTelemetry.longitude}`;
    navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // =========================================================================
  // STOPPAGE MODIFICATION HANDLERS (Pin-drop, Drag, Delete, Reset)
  // =========================================================================
  const handleTogglePinDrop = useCallback(() => {
    setIsPinDropActive((prev) => !prev);
  }, []);

  const handleMapClickDropPin = useCallback((lat: number, lng: number) => {
    setTempPinCoords({ lat, lng });
    setIsCreationModalOpen(true);
  }, []);

  const handleSaveNewStop = useCallback(
    (newStopData: Omit<RouteStoppage, 'id'>) => {
      const newStop: RouteStoppage = {
        ...newStopData,
        id: `stop-${Date.now().toString().slice(-6)}`,
        sequence: stoppages.length + 1,
      };
      const updated = [...stoppages, newStop];
      saveStoppages(updated);
      setIsPinDropActive(false);
      setTempPinCoords(null);
    },
    [stoppages, saveStoppages]
  );

  const handleUpdateStoppageCoords = useCallback(
    (stopId: string, lat: number, lng: number) => {
      const updated = stoppages.map((s) =>
        s.id === stopId ? { ...s, lat, lng } : s
      );
      saveStoppages(updated);
    },
    [stoppages, saveStoppages]
  );

  const handleDeleteStoppage = useCallback(
    (stopId: string) => {
      const filtered = stoppages.filter((s) => s.id !== stopId);
      // Re-sequence 1, 2, 3...
      const resequenced = filtered.map((s, idx) => ({
        ...s,
        sequence: idx + 1,
      }));
      saveStoppages(resequenced);
      if (focusedStoppage?.id === stopId) {
        setFocusedStoppage(null);
      }
    },
    [stoppages, saveStoppages, focusedStoppage]
  );

  // One-click: capture vehicle's current GPS location to add a new stoppage
  const handleAddStopAtCurrentGps = useCallback(() => {
    setTempPinCoords({
      lat: activeTelemetry.latitude,
      lng: activeTelemetry.longitude,
    });
    setIsCreationModalOpen(true);
  }, [activeTelemetry.latitude, activeTelemetry.longitude]);

  // Clear all stoppages for starting completely fresh
  const handleClearAllStoppages = useCallback(() => {
    if (window.confirm('क्या आप सभी स्टॉपेज हटाकर नया खाली रूट शुरू करना चाहते हैं?')) {
      saveStoppages([]);
      setFocusedStoppage(null);
      setIsPinDropActive(false);
    }
  }, [saveStoppages]);

  const handleResetToDefault = useCallback(() => {
    handleClearAllStoppages();
  }, [handleClearAllStoppages]);

  // Next upcoming or active stoppage
  const upcomingStoppage = useMemo(() => {
    return (
      etaCalculation.stoppages.find(
        (s) => s.status === 'at_stop' || s.status === 'approaching'
      ) ||
      etaCalculation.stoppages.find((s) => s.status === 'upcoming') ||
      etaCalculation.stoppages[0]
    );
  }, [etaCalculation.stoppages]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-fadeIn">
      {/* 1. HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-teal-950 rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black tracking-wide uppercase border border-emerald-400/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>लाइव GPS रूट व स्टॉपेज ट्रैकर (Leaflet OSM)</span>
              </span>
              <span className="text-xs text-amber-300 font-bold bg-amber-400/20 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
                ⏱️ हर 15 सेकंड में ऑटो-रिफ्रेश
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
              <i className="fa-solid fa-van-shuttle text-amber-400"></i>
              <span>स्कूल बस / वैन लाइव रूट व ETA</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              चालक: <strong>{activeTelemetry.driverName}</strong> (फ़ोन: {activeTelemetry.driverPhone}) • 
              क्रमबद्ध स्टॉपेज, पॉलीलाइन रूट और वास्तविक समय पर पहुंचने का समय (ETA)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* ONE-TAP: ADD STOP AT CURRENT VEHICLE GPS */}
            <button
              type="button"
              onClick={handleAddStopAtCurrentGps}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-xs font-black transition-all flex items-center gap-1.5 shadow-md cursor-pointer border border-emerald-400 active:scale-95"
              title="जहाँ ऑटो खड़ा है, उसी स्थान को स्टॉपेज के रूप में जोड़ें"
            >
              <i className="fa-solid fa-location-crosshairs text-amber-300"></i>
              <span>📍 वाहन की लोकेशन पर स्टॉप जोड़ें</span>
            </button>

            {/* PIN DROP QUICK ACTION BUTTON */}
            <button
              type="button"
              onClick={handleTogglePinDrop}
              className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-md cursor-pointer ${
                isPinDropActive
                  ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-400/40'
                  : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
              }`}
            >
              <i className={`fa-solid ${isPinDropActive ? 'fa-xmark' : 'fa-map-pin'}`}></i>
              <span>{isPinDropActive ? 'पिन रद्द करें' : '📌 नया स्टॉप पिन गिराएं'}</span>
            </button>

            {/* Google Sheet Apps Script Setup Button */}
            <button
              type="button"
              onClick={() => setShowScriptModal(true)}
              className="px-3.5 py-2 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-xs font-bold transition-all border border-amber-400/40 flex items-center gap-1.5 cursor-pointer backdrop-blur-xs shadow-xs"
              title="गूगल शीट 'Bus_Tracking' में लोकेशन ऑटो-अपडेट करने हेतु Apps Script कोड"
            >
              <i className="fa-solid fa-code"></i>
              <span>शीट सिंक कोड</span>
            </button>

            {/* Countdown badge & manual sync button */}
            <button
              type="button"
              onClick={() => {
                fetchSheetData();
                setCountdown(15);
              }}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all border border-white/20 flex items-center gap-1.5 cursor-pointer backdrop-blur-xs shadow-xs"
              title="अभी तुरंत गूगल शीट से लोकेशन प्राप्त करें"
            >
              <i className={`fa-solid fa-rotate ${loadingSheet ? 'animate-spin' : ''}`}></i>
              <span>रिफ्रेश ({countdown}s)</span>
            </button>

            {/* Link to Driver Portal */}
            {onOpenDriverPortal && (
              <button
                type="button"
                onClick={onOpenDriverPortal}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all shadow-md flex items-center gap-2 cursor-pointer active:scale-95"
              >
                <i className="fa-solid fa-satellite-dish"></i>
                <span>ड्राइवर GPS खोलें</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. EMERGENCY SOS ALERT BANNER (If Active) */}
      {activeTelemetry.sosAlert && (
        <div className="p-4 bg-red-600 text-white rounded-3xl shadow-xl flex items-center justify-between gap-4 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white text-red-600 flex items-center justify-center text-2xl font-black shrink-0">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div>
              <h3 className="text-base font-black tracking-wide">
                🚨 आपातकालीन अलर्ट: ड्राइवर {activeTelemetry.driverName} ने SOS भेजा है!
              </h3>
              <p className="text-xs text-red-100 font-medium">
                संदेश: {activeTelemetry.sosMessage || 'तुरंत सहायता की आवश्यकता है!'} • संपर्क: {activeTelemetry.driverPhone}
              </p>
            </div>
          </div>
          <a
            href={`tel:${activeTelemetry.driverPhone}`}
            className="px-4 py-2 rounded-xl bg-white text-red-700 font-black text-xs hover:bg-red-50 transition-colors shadow-md shrink-0 flex items-center gap-1.5"
          >
            <i className="fa-solid fa-phone"></i>
            <span>ड्राइवर को कॉल करें</span>
          </a>
        </div>
      )}

      {/* 3. CONTROL PANEL & LIVE ROUTE METRICS */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#0c2340] text-amber-300 flex items-center justify-center text-xl font-bold shadow-md shadow-blue-900/20">
              <i className="fa-solid fa-location-crosshairs"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">वाहन ID:</span>
                <select
                  value={selectedBusId}
                  onChange={(e) => setSelectedBusId(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-300 font-mono text-xs font-extrabold text-slate-900 focus:ring-2 focus:ring-blue-900 focus:outline-none"
                >
                  {sheetBuses.map((b) => (
                    <option key={b.Bus_ID} value={b.Bus_ID}>
                      {b.Bus_ID} ({b.Driver_Name || 'Amjad'})
                    </option>
                  ))}
                </select>
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase">
                  ✓ गूगल शीट कनेक्टेड
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                चालक: <strong className="text-slate-900">{activeTelemetry.driverName}</strong> • फ़ोन: <strong className="text-slate-900">{activeTelemetry.driverPhone}</strong>
              </p>
            </div>
          </div>

          {/* Quick Driver Contact Buttons */}
          <div className="flex items-center gap-2">
            <a
              href={`tel:${activeTelemetry.driverPhone}`}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all flex items-center gap-1.5 border border-slate-300"
            >
              <i className="fa-solid fa-phone text-emerald-600"></i>
              <span>कॉल करें</span>
            </a>

            <a
              href={`https://wa.me/91${activeTelemetry.driverPhone}?text=${encodeURIComponent(
                `नमस्ते अमजद जी, EVS स्कूल वैन (${selectedBusId}) की लाइव लोकेशन की जानकारी चाहिए।`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
            >
              <i className="fa-brands fa-whatsapp text-sm"></i>
              <span>WhatsApp</span>
            </a>

            <button
              type="button"
              onClick={handleCopyTrackingLink}
              className="px-3.5 py-2 rounded-xl bg-[#0c2340] hover:bg-slate-900 text-amber-300 text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="अभिभावकों के साथ लोकेशन लिंक शेयर करें"
            >
              <i className={`fa-solid ${copiedLink ? 'fa-check' : 'fa-share-nodes'}`}></i>
              <span>{copiedLink ? 'कॉपी हुआ!' : 'शेयर लिंक'}</span>
            </button>
          </div>
        </div>

        {/* 4 DYNAMIC ETA & TELEMETRY CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-center">
          {/* Card 1: Next Stoppage & ETA */}
          <div className="p-3.5 bg-gradient-to-br from-amber-50 to-amber-100/60 rounded-2xl border border-amber-300 text-left">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-amber-800 uppercase">
                अगला स्टॉपेज (Next Stop)
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            </div>
            <div className="text-xs font-black text-slate-950 mt-1 truncate">
              {upcomingStoppage ? `#${upcomingStoppage.sequence}. ${upcomingStoppage.name}` : 'कैंपस वापसी'}
            </div>
            <div className="text-sm font-extrabold text-amber-900 mt-0.5">
              ETA: {upcomingStoppage?.etaFormatted || 'पहुँच रही है'}
            </div>
          </div>

          {/* Card 2: Speed & Bearing */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-left">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">
              गति व दिशा (Speed & Heading)
            </span>
            <div className="text-sm font-black text-slate-900 mt-1 flex items-center gap-2">
              <span>{activeTelemetry.speed ? `${Math.round(activeTelemetry.speed)} km/h` : '0 km/h'}</span>
              <span className="text-xs font-bold text-slate-500">
                • {activeTelemetry.heading !== null ? `${Math.round(activeTelemetry.heading)}°` : '0°'}
              </span>
            </div>
            <div className="text-[11px] text-emerald-700 font-bold mt-0.5">
              औसत रूट गति: {etaCalculation.effectiveSpeedKmH} km/h
            </div>
          </div>

          {/* Card 3: School Distance & Remaining Route */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-left">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">
              स्कूल से दूरी / शेष रूट
            </span>
            <div className="text-sm font-black text-[#0c2340] mt-1">
              {distanceFromSchool} किमी
            </div>
            <div className="text-[11px] text-slate-600 font-bold mt-0.5">
              शेष रूट: ~{etaCalculation.totalRemainingDistanceKm} km (~{etaCalculation.totalRemainingMinutes} min)
            </div>
          </div>

          {/* Card 4: GPS Health & Last Sync */}
          <div className={`p-3.5 rounded-2xl border text-left ${
            etaCalculation.isStaleSignal
              ? 'bg-rose-50 border-rose-300'
              : 'bg-emerald-50/70 border-emerald-200'
          }`}>
            <span className={`text-[10px] font-black uppercase block ${
              etaCalculation.isStaleSignal ? 'text-rose-700' : 'text-emerald-700'
            }`}>
              {etaCalculation.isStaleSignal ? '⚠️ विलंबित सिग्नल' : '✓ जीपीएस सिग्नल सक्रिय'}
            </span>
            <div className={`text-sm font-black mt-1 font-mono ${
              etaCalculation.isStaleSignal ? 'text-rose-900' : 'text-emerald-950'
            }`}>
              {activeTelemetry.lastUpdated ? activeTelemetry.lastUpdated.split(' ')[1] || activeTelemetry.lastUpdated : lastSyncTime}
            </div>
            <div className={`text-[11px] font-bold mt-0.5 ${
              etaCalculation.isStaleSignal ? 'text-rose-600' : 'text-emerald-700'
            }`}>
              {etaCalculation.isStaleSignal
                ? `${etaCalculation.staleSeconds}s पूर्व अपडेट`
                : 'रीयल-टाइम कनेक्टेड'}
            </div>
          </div>
        </div>
      </div>

      {/* 4. MAIN INTERACTIVE MAP & TIMELINE SIDEBAR GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* MAP COLUMN (2 Cols on lg) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-map-location-dot text-blue-900"></i>
                  <span>इंटरैक्टिव रूट मैप (OpenStreetMap + Leaflet)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  क्रमबद्ध स्टॉपेज (#), गतिशील वैन मार्कर, और रूट पॉलीलाइन। किसी भी स्टॉप को खींचकर स्थान बदलें।
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    autoRefresh
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  {autoRefresh ? '🟢 15s ऑटो-रिफ्रेश On' : '⚪ ऑटो-रिफ्रेश Off'}
                </button>
              </div>
            </div>

            {/* Interactive Leaflet Map Component */}
            <InteractiveRouteMap
              currentGps={currentGpsPoint}
              routeConfig={routeConfig}
              stoppages={etaCalculation.stoppages}
              isStaleSignal={etaCalculation.isStaleSignal}
              staleSeconds={etaCalculation.staleSeconds}
              isPinDropActive={isPinDropActive}
              onTogglePinDrop={handleTogglePinDrop}
              onMapClickDropPin={handleMapClickDropPin}
              onAddStopAtCurrentGps={handleAddStopAtCurrentGps}
              onUpdateStoppageCoords={handleUpdateStoppageCoords}
              onDeleteStoppage={handleDeleteStoppage}
              focusedStoppage={focusedStoppage}
              driverName={activeTelemetry.driverName}
              driverPhone={activeTelemetry.driverPhone}
            />
          </div>
        </div>

        {/* TIMELINE SIDEBAR COLUMN (1 Col on lg) */}
        <div className="lg:col-span-1">
          <StoppageTimelineSidebar
            routeConfig={routeConfig}
            stoppages={etaCalculation.stoppages}
            passedCount={etaCalculation.passedCount}
            totalStudents={etaCalculation.totalStudents}
            isPinDropActive={isPinDropActive}
            onTogglePinDrop={handleTogglePinDrop}
            onResetToDefault={handleResetToDefault}
            onClearAllStoppages={handleClearAllStoppages}
            onAddStopAtCurrentGps={handleAddStopAtCurrentGps}
            onSelectStoppage={(stoppage) => setFocusedStoppage(stoppage)}
            onDeleteStoppage={handleDeleteStoppage}
            activeStoppageId={focusedStoppage?.id}
            selectedBusName={`वैन ${selectedBusId} (${activeTelemetry.driverName})`}
          />
        </div>
      </div>

      {/* 5. GOOGLE SHEET "BUS_TRACKING" VERIFICATION TABLE (Preserved 100%) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <i className="fa-solid fa-table text-blue-900"></i>
              <span>Google Sheet 'Bus_Tracking' रिकॉर्ड्स</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              आपकी स्प्रेडशीट (ID: 1AHQowKTK_...) के Bus_Tracking टैब से सीधे प्राप्त डेटा
            </p>
          </div>

          <button
            type="button"
            onClick={fetchSheetData}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
          >
            <i className={`fa-solid fa-rotate ${loadingSheet ? 'animate-spin' : ''}`}></i>
            <span>शीट पुनः लोड करें</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                <th className="py-2.5 px-4">Bus_ID</th>
                <th className="py-2.5 px-4">Driver_Name</th>
                <th className="py-2.5 px-4">Current_Location</th>
                <th className="py-2.5 px-4">Last_Updated</th>
                <th className="py-2.5 px-4 text-right">कार्रवाई</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
              {sheetBuses.map((b) => {
                const isCurrent = b.Bus_ID === selectedBusId;
                return (
                  <tr
                    key={b.Bus_ID}
                    className={`hover:bg-slate-50 transition-colors ${
                      isCurrent ? 'bg-blue-50/60 font-bold' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      {b.Bus_ID}
                      {isCurrent && (
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-black">
                          चयनित
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {b.Driver_Name}
                      {String(b.Driver_Name || '').toLowerCase().includes('amjad') && (
                        <span className="ml-1.5 text-[10px] text-emerald-600 font-bold">
                          (मुख्य चालक)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">
                      {b.Current_Location}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {b.Last_Updated}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedBusId(b.Bus_ID)}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-blue-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {isCurrent ? 'ट्रैक हो रहा है' : 'मैप पर देखें'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* STOP CREATION MODAL */}
      {tempPinCoords && (
        <StopCreationModal
          isOpen={isCreationModalOpen}
          onClose={() => {
            setIsCreationModalOpen(false);
            setTempPinCoords(null);
            setIsPinDropActive(false);
          }}
          lat={tempPinCoords.lat}
          lng={tempPinCoords.lng}
          suggestedSequence={stoppages.length + 1}
          onSaveStop={handleSaveNewStop}
        />
      )}

      {/* GOOGLE APPS SCRIPT SETUP MODAL */}
      <GoogleSheetSyncModal
        isOpen={showScriptModal}
        onClose={() => setShowScriptModal(false)}
      />
    </div>
  );
};
