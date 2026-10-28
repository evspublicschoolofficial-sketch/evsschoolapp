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
  fetchRouteStopsFromApi,
  saveRouteStopsToApi,
} from '../utils/busTrackingService';
import { GoogleSheetSyncModal } from './GoogleSheetSyncModal';
import {
  RouteStoppage,
  RouteConfig,
  GpsPoint,
  RouteShift,
} from '../types/routeTracking';
import {
  DEFAULT_ROUTE_STOPPAGES,
  DEFAULT_ROUTE_CONFIG,
  calculateStoppageEtas,
} from '../utils/etaEngine';
import {
  SCHOOL_ROUTES_CONFIG,
  getRouteStorageKey,
  DEFAULT_ROUTE_1_STOPPAGES,
  DEFAULT_ROUTE_2_STOPPAGES,
} from '../utils/roadRoutingService';
import { InteractiveRouteMap } from './InteractiveRouteMap';
import { StoppageTimelineSidebar } from './StoppageTimelineSidebar';
import { StopCreationModal } from './StopCreationModal';

const loadStoppagesForRoute = (routeId: string): RouteStoppage[] => {
  try {
    const saved = localStorage.getItem(getRouteStorageKey(routeId));
    if (saved) {
      const parsed = JSON.parse(saved);
      // Purge old mock seed if present
      const hasOldSeed = Array.isArray(parsed) && parsed.some((s: any) => s.id === 'stop-01' || s.id === 'stop-02' || s.id === 'stop-03');
      if (!hasOldSeed && Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading stored stoppages:', e);
  }
  return routeId === 'route-2' ? DEFAULT_ROUTE_2_STOPPAGES : DEFAULT_ROUTE_1_STOPPAGES;
};

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
  const [selectedBusId, setSelectedBusId] = useState<string>('121212');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('hi-IN'));
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // 6-second fast sheet sync countdown
  const [countdown, setCountdown] = useState<number>(6);
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);

  // =========================================================================
  // 2 INDEPENDENT ROUTES & SHIFT (MORNING PICKUP / EVENING DROP) STATE
  // =========================================================================
  const [activeRouteId, setActiveRouteId] = useState<string>(() => {
    try {
      return localStorage.getItem('evs_active_route_id') || 'route-1';
    } catch {
      return 'route-1';
    }
  });

  const [activeShift, setActiveShift] = useState<RouteShift>(() => {
    try {
      const saved = localStorage.getItem('evs_active_shift');
      if (saved === 'morning' || saved === 'evening') return saved;
    } catch {}
    return 'morning';
  });

  // Metro-style Voice & Audio Announcement State
  const [voiceAnnouncementEnabled, setVoiceAnnouncementEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('evs_metro_voice_enabled') !== 'false';
    } catch {
      return true;
    }
  });
  const [sheetSyncingStops, setSheetSyncingStops] = useState<boolean>(false);
  const [sheetStopsSyncSuccess, setSheetStopsSyncSuccess] = useState<boolean>(false);
  const lastAnnouncedStopKeyRef = useRef<string | null>(null);

  // Play authentic 2-tone Delhi Metro arrival chime using Web Audio API
  const playMetroChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Tone 1: E5 (659 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.3);

      // Tone 2: C5 (523 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(523.25, now + 0.22);
      gain2.gain.setValueAtTime(0.22, now + 0.22);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.22);
      osc2.stop(now + 0.6);
    } catch (e) {
      console.warn('Could not play metro chime:', e);
    }
  }, []);

  // Announce next station / arrival using Web Speech API in Hindi + English
  const announceStationVoice = useCallback(
    (stopName: string, isAtStop: boolean = false) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        playMetroChime();
        window.speechSynthesis.cancel();

        const cleanName = stopName.split('(')[0].trim();
        const textToSpeak = isAtStop
          ? `वाहन ${cleanName} स्टॉप पर पहुंच गया है। Arrived at ${cleanName}.`
          : `अगला स्टॉप ${cleanName} है। Next stop is ${cleanName}.`;

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = 0.92;
        utterance.pitch = 1.05;

        const voices = window.speechSynthesis.getVoices();
        const preferredVoice =
          voices.find((v) => v.lang.includes('hi') || v.lang.includes('HI')) ||
          voices.find((v) => v.lang.includes('en-IN') || v.name.includes('India')) ||
          voices[0];
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        setTimeout(() => {
          window.speechSynthesis.speak(utterance);
        }, 380);
      } catch (e) {
        console.warn('Speech synthesis error:', e);
      }
    },
    [playMetroChime]
  );

  // Live telemetry map received from Driver Portal broadcasts, server API & localStorage
  const [liveTelemetry, setLiveTelemetry] = useState<Record<string, VanTelemetry>>(() => {
    try {
      const saved = localStorage.getItem('evs_van_live_locations');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Stoppages for active route
  const [stoppages, setStoppages] = useState<RouteStoppage[]>(() => {
    return loadStoppagesForRoute(activeRouteId);
  });

  const routeConfig = useMemo<RouteConfig>(() => {
    const base = SCHOOL_ROUTES_CONFIG[activeRouteId] || SCHOOL_ROUTES_CONFIG['route-1'];
    return {
      ...base,
      shift: activeShift,
      stoppages,
    };
  }, [activeRouteId, activeShift, stoppages]);

  // Pin-drop interactive creation & edit states
  const [isPinDropActive, setIsPinDropActive] = useState<boolean>(false);
  const [tempPinCoords, setTempPinCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isCreationModalOpen, setIsCreationModalOpen] = useState<boolean>(false);
  const [editingStoppage, setEditingStoppage] = useState<RouteStoppage | null>(null);
  const [focusedStoppage, setFocusedStoppage] = useState<RouteStoppage | null>(null);

  // Persist stoppages to localStorage & Server / Google Sheet
  const saveStoppages = useCallback(
    (newStoppages: RouteStoppage[]) => {
      setStoppages(newStoppages);
      saveRouteStopsToApi(activeRouteId, newStoppages);
    },
    [activeRouteId]
  );

  // Sync stoppages to Google Sheets button handler
  const handleSyncStoppagesToSheet = async () => {
    setSheetSyncingStops(true);
    try {
      await saveRouteStopsToApi(activeRouteId, stoppages);
      setSheetStopsSyncSuccess(true);
      setTimeout(() => setSheetStopsSyncSuccess(false), 3500);
    } catch (e) {
      console.warn('Error syncing stoppages to sheet:', e);
    } finally {
      setSheetSyncingStops(false);
    }
  };

  // Route selector switch handler
  const handleSelectRoute = useCallback((routeId: string) => {
    setActiveRouteId(routeId);
    try {
      localStorage.setItem('evs_active_route_id', routeId);
    } catch {}
    const loaded = loadStoppagesForRoute(routeId);
    setStoppages(loaded);
    setFocusedStoppage(null);
    setIsPinDropActive(false);

    // Auto-select corresponding bus ID
    const assignedBus = SCHOOL_ROUTES_CONFIG[routeId]?.assignedBusId;
    if (assignedBus) {
      setSelectedBusId(assignedBus);
    }

    // Refresh route stops from server API
    fetchRouteStopsFromApi(routeId).then((serverStops) => {
      if (serverStops && serverStops.length > 0) {
        setStoppages(serverStops);
      }
    });
  }, []);

  // Shift selector switch handler (Morning Pickup vs Evening Drop)
  const handleSelectShift = useCallback((shift: RouteShift) => {
    setActiveShift(shift);
    try {
      localStorage.setItem('evs_active_shift', shift);
    } catch {}
  }, []);

  // Fetch real Google Sheet "Bus_Tracking"
  const fetchSheetData = async () => {
    setLoadingSheet(true);
    const records = await fetchBusTrackingFromSheet();
    if (records.length > 0) {
      setSheetBuses(records);
      const amjadBus = records.find(
        (b) => String(b.Driver_Name || '').toLowerCase().includes('amjad')
      );
      // If current selected bus is not present in records, select Amjad's bus or first row
      if (!records.some((r) => r.Bus_ID === selectedBusId)) {
        if (amjadBus) {
          setSelectedBusId(amjadBus.Bus_ID);
        } else if (records[0]) {
          setSelectedBusId(records[0].Bus_ID);
        }
      }
    } else {
      setSheetBuses([
        {
          Bus_ID: '121212',
          Driver_Name: 'Amjad',
          Current_Location: '30.078676, 77.469929',
          Last_Updated: new Date().toLocaleString('hi-IN'),
        },
        {
          Bus_ID: '123556',
          Driver_Name: 'Mh salik',
          Current_Location: '30.071803, 77.473013',
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

    // Fetch initial route stops from server
    fetchRouteStopsFromApi(activeRouteId).then((serverStops) => {
      if (serverStops && serverStops.length > 0) {
        setStoppages(serverStops);
      }
    });

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
      } else if (msg.type === 'APP_DATA_UPDATED' && msg.entity === 'route_stops') {
        fetchRouteStopsFromApi(activeRouteId).then((stops) => {
          if (stops && stops.length > 0) setStoppages(stops);
        });
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
      if (e.key && e.key.startsWith('evs_van_route_stoppages_') && e.newValue) {
        if (e.key === getRouteStorageKey(activeRouteId)) {
          try {
            const parsed = JSON.parse(e.newValue);
            if (Array.isArray(parsed)) {
              setStoppages(parsed);
            }
          } catch {}
        }
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
  }, [activeRouteId]);

  // Fast 6-Second Google Sheet & 2.5-Second Telemetry refresh loop
  useEffect(() => {
    if (!autoRefresh) return;

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 6;
        }
        return prev - 1;
      });
    }, 1000);

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
    }, 2500);

    const sheetSyncTimer = setInterval(() => {
      fetchSheetData();
      setCountdown(6);
    }, 6000);

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
    return (
      sheetBuses.find((b) => b.Bus_ID === selectedBusId) ||
      sheetBuses.find((b) => String(b.Driver_Name || '').toLowerCase().includes('amjad')) ||
      sheetBuses[0]
    );
  }, [sheetBuses, selectedBusId]);

  // Active live telemetry from driver or sheet (flexible lookup)
  const activeTelemetry: VanTelemetry = useMemo(() => {
    const busId = activeBus?.Bus_ID || selectedBusId || '121212';
    const driverName = activeBus?.Driver_Name || 'Amjad';
    const driverPhone = getDriverPhone(driverName);

    // 1. Flexible lookup in live telemetry (by exact id, string id, or driver name)
    const live =
      liveTelemetry[busId] ||
      liveTelemetry[String(busId)] ||
      (Object.values(liveTelemetry) as VanTelemetry[]).find(
        (t: VanTelemetry) =>
          t.busId === busId ||
          String(t.busId) === String(busId) ||
          (t.driverName && driverName && t.driverName.toLowerCase().includes(driverName.toLowerCase()))
      );

    if (live) {
      return live;
    }

    // 2. Otherwise parse from Google Sheet "Current_Location"
    const parsed = parseCoordinates(activeBus?.Current_Location);
    return {
      busId,
      driverName,
      driverPhone,
      currentLocationStr: activeBus?.Current_Location || '30.078676, 77.469929',
      latitude: parsed.lat,
      longitude: parsed.lng,
      accuracy: 8,
      speed: 0,
      heading: 0,
      lastUpdated: activeBus?.Last_Updated || new Date().toLocaleString('hi-IN'),
      status: 'running',
      isLiveFromSheet: true,
    };
  }, [activeBus, selectedBusId, liveTelemetry, users]);

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
    setEditingStoppage(null);
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
      setEditingStoppage(null);
    },
    [stoppages, saveStoppages]
  );

  // Open modal in edit mode for an existing stoppage
  const handleOpenEditStop = useCallback((stop: RouteStoppage) => {
    setEditingStoppage(stop);
    setTempPinCoords({ lat: stop.lat, lng: stop.lng });
    setIsCreationModalOpen(true);
  }, []);

  // Update details of an existing stoppage (including sequence reordering)
  const handleUpdateStopDetails = useCallback(
    (stopId: string, updatedFields: Partial<RouteStoppage>) => {
      let updated = stoppages.map((s) => {
        if (s.id === stopId) {
          const morningTime = updatedFields.morningTime ?? s.morningTime ?? s.scheduledTime;
          const eveningTime = updatedFields.eveningTime ?? s.eveningTime ?? s.scheduledTime;
          const scheduledTime = activeShift === 'morning' ? morningTime : eveningTime;
          return {
            ...s,
            ...updatedFields,
            morningTime,
            eveningTime,
            scheduledTime,
          };
        }
        return s;
      });

      // Handle sequence re-ordering if sequence changed
      if (updatedFields.sequence !== undefined) {
        const targetStop = updated.find((s) => s.id === stopId);
        if (targetStop) {
          const withoutTarget = updated.filter((s) => s.id !== stopId);
          const targetSeq = Math.max(1, Math.min(updatedFields.sequence, updated.length));
          withoutTarget.splice(targetSeq - 1, 0, targetStop);
          updated = withoutTarget.map((s, idx) => ({
            ...s,
            sequence: idx + 1,
          }));
        }
      }

      saveStoppages(updated);
      setEditingStoppage(null);
      setIsCreationModalOpen(false);
      setTempPinCoords(null);
    },
    [stoppages, activeShift, saveStoppages]
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
      if (editingStoppage?.id === stopId) {
        setEditingStoppage(null);
        setIsCreationModalOpen(false);
      }
    },
    [stoppages, saveStoppages, focusedStoppage, editingStoppage]
  );

  // One-click: capture vehicle's current GPS location to add a new stoppage
  const handleAddStopAtCurrentGps = useCallback(() => {
    setEditingStoppage(null);
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

  // Distance in meters to upcoming/active stoppage
  const activeDistanceMeters = useMemo(() => {
    if (!upcomingStoppage) return 0;
    if (typeof upcomingStoppage.distanceFromVanKm === 'number' && upcomingStoppage.distanceFromVanKm > 0) {
      return Math.round(upcomingStoppage.distanceFromVanKm * 1000);
    }
    if (typeof upcomingStoppage.straightLineDistanceKm === 'number') {
      return Math.round(upcomingStoppage.straightLineDistanceKm * 1000);
    }
    return 0;
  }, [upcomingStoppage]);

  // Automatic Delhi-Metro style voice and chime announcement effect
  useEffect(() => {
    if (!voiceAnnouncementEnabled || !upcomingStoppage) return;
    const status = upcomingStoppage.status;
    const stopKey = `${upcomingStoppage.id}_${status}`;

    // Announce when approaching or when arriving at a stop
    if ((status === 'approaching' || status === 'at_stop') && lastAnnouncedStopKeyRef.current !== stopKey) {
      lastAnnouncedStopKeyRef.current = stopKey;
      announceStationVoice(upcomingStoppage.name, status === 'at_stop');
    }
  }, [upcomingStoppage, voiceAnnouncementEnabled, announceStationVoice]);

  const handleTestAnnouncement = () => {
    const name = upcomingStoppage?.name || 'कतला खुर्द (Katla Khurd)';
    announceStationVoice(name, upcomingStoppage?.status === 'at_stop');
  };

  const handleToggleVoice = () => {
    setVoiceAnnouncementEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('evs_metro_voice_enabled', String(next));
      } catch {}
      return next;
    });
  };

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

      {/* 2.5 MASTER ROUTE & SHIFT SWITCHER BAR */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Route Selector (Route 1 vs Route 2) */}
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              रूट चयन (Select Route):
            </span>
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 text-[10px] font-extrabold">
              {activeRouteId === 'route-1' ? 'रूट #1' : 'रूट #2'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <button
              type="button"
              onClick={() => handleSelectRoute('route-1')}
              className={`p-2.5 rounded-2xl text-left border transition-all cursor-pointer ${
                activeRouteId === 'route-1'
                  ? 'bg-[#0c2340] text-white border-blue-900 shadow-md ring-2 ring-blue-900/30'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black">🚐 रूट #1</span>
                {activeRouteId === 'route-1' && <span className="text-[10px] text-amber-300 font-bold">✓ सक्रिय</span>}
              </div>
              <p className={`text-[11px] mt-0.5 truncate ${activeRouteId === 'route-1' ? 'text-slate-300' : 'text-slate-500'}`}>
                चिलकाना - सुल्तानपुर - रामपुर
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleSelectRoute('route-2')}
              className={`p-2.5 rounded-2xl text-left border transition-all cursor-pointer ${
                activeRouteId === 'route-2'
                  ? 'bg-[#0c2340] text-white border-blue-900 shadow-md ring-2 ring-blue-900/30'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-black">🚐 रूट #2</span>
                {activeRouteId === 'route-2' && <span className="text-[10px] text-amber-300 font-bold">✓ सक्रिय</span>}
              </div>
              <p className={`text-[11px] mt-0.5 truncate ${activeRouteId === 'route-2' ? 'text-slate-300' : 'text-slate-500'}`}>
                पटनी - दुमझेड़ा - देहात
              </p>
            </button>
          </div>
        </div>

        {/* Shift Selector (Morning Pickup vs Evening Drop) */}
        <div className="space-y-1.5 md:border-l md:border-slate-200 md:pl-5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
              दैनिक शिफ्ट (Daily Shift):
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
              activeShift === 'morning' ? 'bg-emerald-100 text-emerald-800' : 'bg-orange-100 text-orange-800'
            }`}>
              {activeShift === 'morning' ? '🌅 सुबह पिकअप' : '🌇 शाम ड्रॉप'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectShift('morning')}
              className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer border ${
                activeShift === 'morning'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-md ring-2 ring-emerald-500/30'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <span className="text-sm">🌅</span>
              <div className="text-left">
                <div className="leading-tight">सुबह पिकअप</div>
                <div className={`text-[10px] ${activeShift === 'morning' ? 'text-emerald-100' : 'text-slate-400'}`}>
                  घर से स्कूल
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectShift('evening')}
              className={`px-3.5 py-2 rounded-2xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer border ${
                activeShift === 'evening'
                  ? 'bg-orange-600 text-white border-orange-500 shadow-md ring-2 ring-orange-500/30'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              <span className="text-sm">🌇</span>
              <div className="text-left">
                <div className="leading-tight">शाम ड्रॉप</div>
                <div className={`text-[10px] ${activeShift === 'evening' ? 'text-orange-100' : 'text-slate-400'}`}>
                  स्कूल से घर
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* 2.8 DELHI-METRO STYLE TRANSIT ANNOUNCEMENT HUD & LIVE STATION STRIP */}
      <div className="bg-gradient-to-br from-slate-950 via-[#071527] to-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-2xl border border-slate-800 space-y-5 relative overflow-hidden">
        {/* Subtle Metro train car ambient top strip */}
        <div className={`absolute top-0 left-0 right-0 h-1.5 ${activeRouteId === 'route-1' ? 'bg-amber-400' : 'bg-blue-500'}`}></div>

        {/* HUD Top Control Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase flex items-center gap-1.5 shadow-sm ${
              activeRouteId === 'route-1'
                ? 'bg-amber-400 text-slate-950 font-black'
                : 'bg-blue-500 text-white font-black'
            }`}>
              <i className="fa-solid fa-train-subway"></i>
              <span>{activeRouteId === 'route-1' ? 'येलो लाइन (रूट #1: चिलकाना - सुल्तानपुर)' : 'ब्लू लाइन (रूट #2: पटनी - देहात)'}</span>
            </span>

            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/30 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span>लाइव जीपीएस सक्रिय</span>
            </span>

            <span className="text-slate-400 text-xs font-medium hidden sm:inline">
              गति: <strong className="text-white">{activeTelemetry.speed ? `${Math.round(activeTelemetry.speed)} km/h` : '0 km/h'}</strong>
            </span>
          </div>

          {/* Voice Toggle, Test Audio & Sheet Sync Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Voice Announcement Toggle */}
            <button
              type="button"
              onClick={handleToggleVoice}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                voiceAnnouncementEnabled
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 border-emerald-400 shadow-md font-black'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title="मेट्रो जैसी ऑडियो उद्घोषणा चालू या बंद करें"
            >
              <i className={`fa-solid ${voiceAnnouncementEnabled ? 'fa-volume-high' : 'fa-volume-xmark'}`}></i>
              <span>{voiceAnnouncementEnabled ? '🔊 मेट्रो उद्घोषणा ON' : '🔇 म्यूट'}</span>
            </button>

            {/* Test Voice Chime Button */}
            <button
              type="button"
              onClick={handleTestAnnouncement}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all flex items-center gap-1.5 border border-slate-700 cursor-pointer active:scale-95"
              title="मेट्रो घंटी व आवाज़ टेस्ट करें"
            >
              <i className="fa-solid fa-bullhorn text-amber-400"></i>
              <span>टेस्ट वॉइस</span>
            </button>

            {/* Sync Route_Stops to Google Sheets button */}
            <button
              type="button"
              onClick={handleSyncStoppagesToSheet}
              disabled={sheetSyncingStops}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border cursor-pointer active:scale-95 ${
                sheetStopsSyncSuccess
                  ? 'bg-emerald-600 text-white border-emerald-500 font-black'
                  : 'bg-[#0c2340] hover:bg-slate-800 text-amber-300 border-amber-400/40'
              }`}
              title="गूगल शीट 'Route_Stops' टैब में सभी स्टॉपेज सुरक्षित करें"
            >
              <i className={`fa-solid ${sheetSyncingStops ? 'fa-spinner fa-spin' : sheetStopsSyncSuccess ? 'fa-check' : 'fa-cloud-arrow-up'}`}></i>
              <span>{sheetSyncingStops ? 'शीट में सिंक हो रहा...' : sheetStopsSyncSuccess ? 'शीट में सुरक्षित!' : "शीट 'Route_Stops' सिंक"}</span>
            </button>
          </div>
        </div>

        {/* Central Metro High-Visibility Digital Display Board */}
        <div className={`p-4 sm:p-5 rounded-2xl border transition-all ${
          upcomingStoppage?.status === 'at_stop'
            ? 'bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-950 border-emerald-400/60 shadow-lg shadow-emerald-950/50'
            : upcomingStoppage?.status === 'approaching'
            ? 'bg-gradient-to-r from-amber-950 via-amber-900/90 to-yellow-950 border-amber-400/70 shadow-lg shadow-amber-950/50 animate-pulse'
            : 'bg-slate-900/90 border-slate-700/80'
        }`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {upcomingStoppage?.status === 'at_stop' ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-black text-[11px] tracking-wide uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                    <span>🟢 स्टॉपेज पर मौजूद (At Station)</span>
                  </span>
                ) : upcomingStoppage?.status === 'approaching' ? (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 font-black text-[11px] tracking-wide uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-950 animate-bounce"></span>
                    <span>📢 अगला स्टॉप निकट है (&lt; 500m)</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-[11px] tracking-wide uppercase border border-blue-400/30 flex items-center gap-1.5">
                    <i className="fa-solid fa-angles-right text-xs"></i>
                    <span>🚆 अगला स्टेशन / स्टॉपेज (Next Stop)</span>
                  </span>
                )}
                <span className="text-slate-400 text-xs font-medium">
                  {activeShift === 'morning' ? 'पिकअप समय:' : 'ड्रॉप समय:'} <strong className="text-white">{upcomingStoppage?.scheduledTime || '07:30 AM'}</strong>
                </span>
              </div>

              {/* Station Name Heading */}
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2.5 pt-1">
                <span className="text-amber-400">#{upcomingStoppage?.sequence || 1}.</span>
                <span>{upcomingStoppage?.name || 'ई.वी.एस. पब्लिक स्कूल'}</span>
              </h2>

              <p className="text-xs sm:text-sm text-slate-300 font-medium">
                {upcomingStoppage?.status === 'at_stop' ? (
                  <span>विद्यार्थी वाहन में चढ़/उतर रहे हैं • अनुमानित ठहराव: <strong>60 सेकंड</strong></span>
                ) : (
                  <span>
                    वाहन से दूरी: <strong className="text-amber-300">{activeDistanceMeters > 1000 ? `${(activeDistanceMeters / 1000).toFixed(1)} km` : `${activeDistanceMeters} मीटर`}</strong>
                    {' '}• अनुमानित आगमन: <strong className="text-emerald-300">{upcomingStoppage?.etaFormatted || 'पहुँच रही है'}</strong>
                    {upcomingStoppage?.studentCount ? ` • 🎒 ${upcomingStoppage.studentCount} छात्र` : ''}
                  </span>
                )}
              </p>
            </div>

            {/* Quick action buttons for this stoppage */}
            <div className="flex items-center gap-2 shrink-0 self-start md:self-center">
              {upcomingStoppage && (
                <button
                  type="button"
                  onClick={() => setFocusedStoppage(upcomingStoppage)}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all border border-white/20 flex items-center gap-1.5 cursor-pointer"
                  title="मैप को इस स्टॉप पर फोकस करें"
                >
                  <i className="fa-solid fa-crosshairs text-amber-400"></i>
                  <span>मैप पर देखें</span>
                </button>
              )}

              <a
                href={`tel:${activeTelemetry.driverPhone}`}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition-all flex items-center gap-1.5 shadow-md"
              >
                <i className="fa-solid fa-phone"></i>
                <span>ड्राइवर कॉल</span>
              </a>
            </div>
          </div>
        </div>

        {/* DELHI METRO TRAIN-CAR HORIZONTAL STATION TIMELINE STRIP */}
        <div className="bg-black/40 rounded-2xl p-4 border border-white/10 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-300 px-1">
            <span className="flex items-center gap-2">
              <i className="fa-solid fa-route text-amber-400"></i>
              <span>मेट्रो स्टेशन लाइन (Station Route Map - किसी भी स्टॉप पर क्लिक करें):</span>
            </span>
            <span className="text-[11px] text-slate-400">
              कुल {stoppages.length} स्टॉप • {etaCalculation.passedCount} पूरे
            </span>
          </div>

          <div className="overflow-x-auto pb-3 pt-2 scrollbar-thin">
            <div className="flex items-center min-w-max px-2">
              {etaCalculation.stoppages.map((stop, idx) => {
                const isPassed = stop.status === 'passed';
                const isAt = stop.status === 'at_stop';
                const isApproaching = stop.status === 'approaching';
                const isFocused = focusedStoppage?.id === stop.id;
                const isLast = idx === etaCalculation.stoppages.length - 1;

                return (
                  <React.Fragment key={stop.id}>
                    {/* Station Node Box */}
                    <div
                      onClick={() => setFocusedStoppage(stop)}
                      className={`flex flex-col items-center cursor-pointer group transition-all p-2 rounded-xl ${
                        isFocused
                          ? 'bg-white/15 ring-2 ring-amber-400'
                          : isAt
                          ? 'bg-emerald-950/60 ring-2 ring-emerald-400'
                          : isApproaching
                          ? 'bg-amber-950/60 ring-2 ring-amber-400'
                          : 'hover:bg-white/5'
                      }`}
                      style={{ minWidth: '120px', maxWidth: '150px' }}
                    >
                      {/* Top Label Tag */}
                      <div className="h-5 flex items-center justify-center">
                        {isAt ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[9px] font-black uppercase tracking-wider animate-pulse">
                            स्टॉप पर
                          </span>
                        ) : isApproaching ? (
                          <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black uppercase tracking-wider animate-bounce">
                            अगला स्टॉप
                          </span>
                        ) : isPassed ? (
                          <span className="text-[10px] text-emerald-400 font-bold">✓ निकला</span>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-bold">#{stop.sequence}</span>
                        )}
                      </div>

                      {/* Station Circular Icon Indicator */}
                      <div className="my-1.5 relative">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-black transition-all shadow-md ${
                            isAt
                              ? 'bg-emerald-500 text-slate-950 ring-4 ring-emerald-400/40 animate-pulse scale-110'
                              : isApproaching
                              ? 'bg-amber-400 text-slate-950 ring-4 ring-amber-300/40 animate-pulse scale-110'
                              : isPassed
                              ? 'bg-emerald-700 text-white ring-2 ring-emerald-500/50'
                              : 'bg-slate-800 text-slate-300 border-2 border-slate-600'
                          }`}
                        >
                          {isAt ? (
                            <i className="fa-solid fa-van-shuttle"></i>
                          ) : isApproaching ? (
                            <i className="fa-solid fa-bullhorn text-xs"></i>
                          ) : isPassed ? (
                            <i className="fa-solid fa-check"></i>
                          ) : (
                            stop.sequence
                          )}
                        </div>
                      </div>

                      {/* Station Name */}
                      <div className="text-center w-full">
                        <div className={`text-xs font-black truncate leading-tight ${
                          isAt ? 'text-emerald-300' : isApproaching ? 'text-amber-300' : isPassed ? 'text-slate-300' : 'text-white'
                        }`} title={stop.name}>
                          {stop.name.split('(')[0].trim()}
                        </div>
                        <div className="text-[10px] text-slate-400 font-medium truncate mt-0.5">
                          {stop.scheduledTime || stop.morningTime || '07:30 AM'}
                          {stop.studentCount ? ` • 🎒${stop.studentCount}` : ''}
                        </div>
                      </div>
                    </div>

                    {/* Connecting Route Track Line */}
                    {!isLast && (
                      <div className="w-8 sm:w-12 h-1 relative self-center mb-6">
                        <div className={`h-full w-full rounded-full ${
                          isPassed
                            ? 'bg-emerald-500'
                            : isApproaching || isAt
                            ? 'bg-gradient-to-r from-emerald-500 to-amber-400'
                            : 'bg-slate-700'
                        }`}></div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>

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
              onEditStoppage={handleOpenEditStop}
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
            onEditStoppage={handleOpenEditStop}
            onDeleteStoppage={handleDeleteStoppage}
            activeStoppageId={focusedStoppage?.id}
            selectedBusName={`वैन ${selectedBusId} (${activeTelemetry.driverName})`}
            activeRouteId={activeRouteId}
            onSelectRoute={handleSelectRoute}
            activeShift={activeShift}
            onSelectShift={handleSelectShift}
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

      {/* STOP CREATION & EDIT MODAL */}
      {tempPinCoords && (
        <StopCreationModal
          isOpen={isCreationModalOpen}
          onClose={() => {
            setIsCreationModalOpen(false);
            setTempPinCoords(null);
            setIsPinDropActive(false);
            setEditingStoppage(null);
          }}
          lat={tempPinCoords.lat}
          lng={tempPinCoords.lng}
          suggestedSequence={editingStoppage ? editingStoppage.sequence : stoppages.length + 1}
          activeShift={activeShift}
          editingStop={editingStoppage}
          totalStoppagesCount={stoppages.length}
          onSaveStop={handleSaveNewStop}
          onUpdateStop={handleUpdateStopDetails}
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
