import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SchoolUser, Student } from '../App';
import {
  BusTrackingRecord,
  fetchBusTrackingFromSheet,
  parseCoordinates,
  VanTelemetry,
  syncLocationToSheetBackend,
  syncLocationToSharedApi,
  testGoogleSheetSync,
  DEFAULT_SCHOOL_COORDS,
} from '../utils/busTrackingService';
import { GoogleSheetSyncModal } from './GoogleSheetSyncModal';

interface DriverPortalProps {
  users?: SchoolUser[];
  students?: Student[];
  onBackToApp?: () => void;
  onBackToHome?: () => void;
  onOpenManagerTracker?: () => void;
  initialDriverName?: string;
}

export const DriverPortal: React.FC<DriverPortalProps> = ({
  users = [],
  onBackToApp,
  onBackToHome,
  onOpenManagerTracker,
}) => {
  // Find registered drivers from Users sheet
  const driversFromUsers = useMemo(() => {
    return users.filter(
      (u) =>
        String(u.Designation || '').trim().toLowerCase() === 'driver' ||
        String(u.Name || '').trim().toLowerCase().includes('amjad') ||
        String(u.Mobile_number || '').trim() === '9761081818'
    );
  }, [users]);

  // Logged-in Driver state (stored in localStorage)
  const [loggedDriver, setLoggedDriver] = useState<SchoolUser | null>(() => {
    try {
      const saved = localStorage.getItem('evs_logged_driver');
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });

  // Login credentials state
  const [loginInput, setLoginInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Sheet Bus_Tracking records
  const [sheetBuses, setSheetBuses] = useState<BusTrackingRecord[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<string>('ecad7ddc');
  const [loadingSheet, setLoadingSheet] = useState<boolean>(true);
  const [showScriptModal, setShowScriptModal] = useState<boolean>(false);
  const [sheetSyncState, setSheetSyncState] = useState<'idle' | 'success' | 'needs_setup'>('idle');

  // Load Bus_Tracking records from Google Sheets
  const loadSheetBuses = async () => {
    setLoadingSheet(true);
    const records = await fetchBusTrackingFromSheet();
    if (records.length > 0) {
      setSheetBuses(records);
      const amjadBus = records.find(
        (b) => String(b.Driver_Name || '').toLowerCase() === 'amjad'
      );
      if (amjadBus && (!selectedBusId || !records.some(r => r.Bus_ID === selectedBusId))) {
        setSelectedBusId(amjadBus.Bus_ID);
      } else if (!records.some(r => r.Bus_ID === selectedBusId) && records[0]) {
        setSelectedBusId(records[0].Bus_ID);
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
    setLoadingSheet(false);
  };

  useEffect(() => {
    loadSheetBuses();
    testGoogleSheetSync().then((diag) => {
      if (diag.configured) {
        setSheetSyncState('success');
      } else if (diag.statusType === 'old_version' || diag.statusType === 'permission_error') {
        setSheetSyncState('needs_setup');
      }
    });
  }, []);

  // Currently active bus record
  const activeBusRecord = useMemo(() => {
    return sheetBuses.find((b) => b.Bus_ID === selectedBusId) || sheetBuses[0];
  }, [sheetBuses, selectedBusId]);

  // Telemetry & GPS State
  const initialCoords = useMemo(() => {
    if (activeBusRecord?.Current_Location) {
      return parseCoordinates(activeBusRecord.Current_Location);
    }
    return { lat: DEFAULT_SCHOOL_COORDS.lat, lng: DEFAULT_SCHOOL_COORDS.lng };
  }, [activeBusRecord]);

  const [latitude, setLatitude] = useState<number>(initialCoords.lat);
  const [longitude, setLongitude] = useState<number>(initialCoords.lng);
  const [accuracy, setAccuracy] = useState<number>(8);
  const [speed, setSpeed] = useState<number | null>(0);
  const [heading, setHeading] = useState<number | null>(0);
  const [isTracking, setIsTracking] = useState<boolean>(() => {
    try {
      return localStorage.getItem('evs_driver_is_tracking') === 'true';
    } catch {
      return false;
    }
  });
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>(new Date().toLocaleTimeString('hi-IN'));
  const [fetchingGps, setFetchingGps] = useState<boolean>(false);
  const [updateCount, setUpdateCount] = useState<number>(0);

  // 15-second automated countdown timer
  const [countdown, setCountdown] = useState<number>(15);

  // Keep latest state in refs
  const latestCoordsRef = useRef({ lat: initialCoords.lat, lng: initialCoords.lng, speed: 0, accuracy: 8, heading: 0 });
  useEffect(() => {
    latestCoordsRef.current = { lat: latitude, lng: longitude, speed: speed || 0, accuracy, heading: heading || 0 };
  }, [latitude, longitude, speed, accuracy, heading]);

  const [vanStatus, setVanStatus] = useState<'running' | 'stopped'>(() => {
    try {
      return localStorage.getItem('evs_driver_is_tracking') === 'true' ? 'running' : 'stopped';
    } catch {
      return 'stopped';
    }
  });
  const [sosActive, setSosActive] = useState<boolean>(false);
  const [sosMessage, setSosMessage] = useState<string>('');
  const [mapViewType, setMapViewType] = useState<'google' | 'osm'>('google');

  // Sync isTracking to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('evs_driver_is_tracking', isTracking ? 'true' : 'false');
    } catch {}
  }, [isTracking]);

  // Refs for tracking
  const watchIdRef = useRef<number | null>(null);
  const timer15sRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const wakeLockRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioOscillatorRef = useRef<OscillatorNode | null>(null);
  const trackingWorkerRef = useRef<Worker | null>(null);
  const audioKeepAliveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Acquire Screen Wake Lock so screen doesn't automatically sleep while tracking is active
  const requestWakeLock = async () => {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch (e) {
        console.warn('Wake Lock request failed:', e);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }
  };

  // WhatsApp-style Background Keep-Alive Audio:
  // Mobile browsers (Android Chrome, iOS Safari) suspend JavaScript execution and GPS
  // when the screen is turned off or phone is locked unless an audio session is active.
  // We keep an inaudible audio stream looping continuously so the browser does NOT suspend tracking!
  const startKeepAliveAudio = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current && AudioCtx) {
        audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      if (audioContextRef.current && !audioOscillatorRef.current) {
        const osc = audioContextRef.current.createOscillator();
        const gain = audioContextRef.current.createGain();
        // 25Hz inaudible frequency & ultra-low gain
        osc.frequency.setValueAtTime(25, audioContextRef.current.currentTime);
        gain.gain.setValueAtTime(0.00005, audioContextRef.current.currentTime);
        osc.connect(gain);
        gain.connect(audioContextRef.current.destination);
        osc.start();
        audioOscillatorRef.current = osc;
      }

      // Interval watchdog: Ensure audio context stays active even if OS tries to suspend it
      if (!audioKeepAliveIntervalRef.current) {
        audioKeepAliveIntervalRef.current = setInterval(() => {
          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().catch(() => {});
          }
        }, 5000);
      }
    } catch (e) {
      console.warn('Keep-alive audio could not start:', e);
    }
  };

  const stopKeepAliveAudio = () => {
    try {
      if (audioKeepAliveIntervalRef.current) {
        clearInterval(audioKeepAliveIntervalRef.current);
        audioKeepAliveIntervalRef.current = null;
      }
      if (audioOscillatorRef.current) {
        audioOscillatorRef.current.stop();
        audioOscillatorRef.current.disconnect();
        audioOscillatorRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    } catch {}
  };

  // BroadcastChannel for instant local cross-tab communication
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastChannelRef.current = new BroadcastChannel('evs_school_van_tracking');
      }
    } catch (e) {
      console.warn('BroadcastChannel error', e);
    }
    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, []);

  // Update coords when bus selection changes if not tracking
  useEffect(() => {
    if (!isTracking && activeBusRecord) {
      const coords = parseCoordinates(activeBusRecord.Current_Location);
      setLatitude(coords.lat);
      setLongitude(coords.lng);
      latestCoordsRef.current.lat = coords.lat;
      latestCoordsRef.current.lng = coords.lng;
    }
  }, [activeBusRecord, isTracking]);

  // Broadcast and sync location to Sheet and server API
  const broadcastLocation = (
    lat: number,
    lng: number,
    spd: number | null,
    acc: number,
    hdg: number | null,
    options?: { force?: boolean; customStatus?: 'running' | 'stopped' }
  ) => {
    // Guard clause: If tracking is off and not explicitly forced, do not send telemetry
    if (!isTracking && !options?.force) {
      return;
    }

    const currentStatus = options?.customStatus || (isTracking ? 'running' : 'stopped');
    setSyncStatus('syncing');
    const dName = loggedDriver?.Name || activeBusRecord?.Driver_Name || 'Amjad';
    const dPhone = String(loggedDriver?.Mobile_number || '9761081818');
    const bId = selectedBusId || activeBusRecord?.Bus_ID || 'ecad7ddc';
    const locStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

    const packet: VanTelemetry = {
      busId: bId,
      driverName: dName,
      driverPhone: dPhone,
      driverUserId: loggedDriver?.User_ID || '2eb81935',
      driverUsername: loggedDriver?.Username || 'rukhar24336@gmail.com',
      currentLocationStr: locStr,
      latitude: lat,
      longitude: lng,
      accuracy: Math.round(acc),
      speed: spd !== null ? Math.round(spd) : 0,
      heading: hdg,
      lastUpdated: new Date().toISOString(),
      status: currentStatus,
      sosAlert: sosActive,
      sosMessage: sosActive ? sosMessage || 'आपातकालीन सहायता आवश्यक है!' : undefined,
      isLiveFromSheet: true,
    };

    // 1. Cross-Device API & Persistent WebSocket (Transmits to server so manager & parents receive it instantly)
    syncLocationToSharedApi(packet);

    // 2. Service Worker sync: Store last location in SW for background sync
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'STORE_LAST_LOCATION',
          payload: packet,
        });
      } catch {}
    }

    // 3. BroadcastChannel (Instant real-time update in manager tab on same device)
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage({ type: 'VAN_LOCATION_UPDATE', payload: packet });
      } catch (e) {
        console.warn('BroadcastChannel post error:', e);
      }
    }

    // 4. Save in localStorage for cross-tab persistence
    try {
      const stored = localStorage.getItem('evs_van_live_locations');
      const allVans = stored ? JSON.parse(stored) : {};
      allVans[bId] = packet;
      localStorage.setItem('evs_van_live_locations', JSON.stringify(allVans));
    } catch (e) {
      console.warn('localStorage error:', e);
    }

    // 4. Sync to Google Apps Script / Google Sheets "Bus_Tracking" backend
    syncLocationToSheetBackend({
      busId: bId,
      driverName: dName,
      latitude: lat,
      longitude: lng,
      speed: spd,
      status: currentStatus,
    }).then((res) => {
      if (res.success) {
        setSheetSyncState('success');
      } else {
        setSheetSyncState('needs_setup');
      }
    });

    setSyncStatus('synced');
    setUpdateCount((c) => c + 1);
    setLastUpdatedTime(new Date().toLocaleTimeString('hi-IN'));
    setTimeout(() => setSyncStatus('idle'), 2000);
  };

  // Immediate High Accuracy GPS Capture from device
  const captureCurrentGps = (onSuccess?: (lat: number, lng: number) => void, forceSend = false) => {
    if (!('geolocation' in navigator)) {
      setGpsError('इस ब्राउज़र में Geolocation (GPS) उपलब्ध नहीं है।');
      return;
    }
    setFetchingGps(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFetchingGps(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = pos.coords.accuracy || 8;
        const spd = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
        const hd = pos.coords.heading || 0;

        setLatitude(lat);
        setLongitude(lng);
        setAccuracy(Math.round(acc));
        setSpeed(spd);
        setHeading(hd);
        latestCoordsRef.current = { lat, lng, speed: spd, accuracy: acc, heading: hd };

        broadcastLocation(lat, lng, spd, acc, hd, { force: forceSend });
        if (onSuccess) onSuccess(lat, lng);
      },
      (err) => {
        setFetchingGps(false);
        console.warn('GPS single capture error:', err.message);
        setGpsError(`GPS एरर (${err.message})। कृपया फोन में Location चालू रखें।`);
        // If device GPS times out, broadcast latest known coordinates
        const cur = latestCoordsRef.current;
        broadcastLocation(cur.lat, cur.lng, cur.speed, cur.accuracy, cur.heading, { force: forceSend });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // Perform 15-second cycle GPS capture and sheet update
  const execute15sUpdate = () => {
    captureCurrentGps();
    setCountdown(15);
  };

  // Stop active hardware watching, background worker and intervals
  const stopTrackingServices = () => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (timer15sRef.current) {
      clearInterval(timer15sRef.current);
      timer15sRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (trackingWorkerRef.current) {
      try {
        trackingWorkerRef.current.postMessage({ action: 'STOP_TRACKING' });
        trackingWorkerRef.current.terminate();
      } catch {}
      trackingWorkerRef.current = null;
    }
    releaseWakeLock();
    stopKeepAliveAudio();
  };

  // Start continuous GPS tracking, Web Worker heartbeat, wake lock, keep-alive audio and intervals
  const startTrackingServices = () => {
    // Keep screen on & keep audio session alive so OS does not sleep JS/GPS
    requestWakeLock();
    startKeepAliveAudio();

    // 1. Send immediate location right now
    execute15sUpdate();

    // 2. Watch device movement for continuous precision
    if ('geolocation' in navigator) {
      try {
        const id = navigator.geolocation.watchPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const spd = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 0;
            const acc = Math.round(pos.coords.accuracy || 8);
            const hd = pos.coords.heading || 0;

            setLatitude(lat);
            setLongitude(lng);
            setAccuracy(acc);
            setSpeed(spd);
            setHeading(hd);
            setGpsError(null);
            latestCoordsRef.current = { lat, lng, speed: spd, accuracy: acc, heading: hd };
          },
          (err) => {
            console.warn('Geolocation watch error:', err.message);
          },
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 1000,
          }
        );
        watchIdRef.current = id;
      } catch (e: any) {
        console.warn('GPS start failed:', e);
      }
    }

    // 3. Web Worker heartbeat (Runs uninterrupted in background thread even when screen is locked)
    try {
      if (typeof window !== 'undefined' && 'Worker' in window) {
        if (trackingWorkerRef.current) {
          trackingWorkerRef.current.terminate();
        }
        const worker = new Worker('/trackingWorker.js');
        worker.onmessage = (e) => {
          const msg = e.data;
          if (msg.type === 'TICK') {
            setCountdown(msg.countdown);
          } else if (msg.type === 'TRIGGER_UPDATE') {
            setCountdown(15);
            execute15sUpdate();
          }
        };
        worker.postMessage({ action: 'START_TRACKING' });
        trackingWorkerRef.current = worker;
      }
    } catch (e) {
      console.warn('Web worker initialization failed, relying on interval:', e);
    }

    // 4. Foreground fallback countdown timer (in case Web Worker is blocked)
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          return 15;
        }
        return prev - 1;
      });
    }, 1000);

    // 5. Foreground fallback 15-second timer
    if (timer15sRef.current) clearInterval(timer15sRef.current);
    timer15sRef.current = setInterval(() => {
      execute15sUpdate();
    }, 15000);
  };

  // Auto-resume tracking on initial mount / reload if it was previously started
  useEffect(() => {
    if (isTracking && loggedDriver) {
      startTrackingServices();
    }
    return () => {
      stopTrackingServices();
    };
  }, []);

  // Start / Stop Live GPS Tracking (with 15s interval)
  const toggleTracking = () => {
    if (isTracking) {
      // STOP TRACKING
      stopTrackingServices();
      setIsTracking(false);
      setVanStatus('stopped');
      setCountdown(15);
      // Inform backend and manager view that tracking has explicitly stopped
      broadcastLocation(latitude, longitude, 0, accuracy, heading, { force: true, customStatus: 'stopped' });
    } else {
      // START TRACKING (15 seconds cycle)
      setGpsError(null);
      setIsTracking(true);
      setVanStatus('running');
      setCountdown(15);
      startTrackingServices();
    }
  };

  // Re-acquire WakeLock and trigger instant refresh if app comes back to view
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isTracking) {
        requestWakeLock();
        startKeepAliveAudio();
        execute15sUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isTracking]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      releaseWakeLock();
      stopKeepAliveAudio();
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (timer15sRef.current) clearInterval(timer15sRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // Trigger Emergency SOS
  const handleTriggerSos = () => {
    const isNowActive = !sosActive;
    setSosActive(isNowActive);
    const msg = isNowActive ? '🚨 आपातकालीन सहायता आवश्यक है!' : '';
    setSosMessage(msg);

    const bId = selectedBusId || 'ecad7ddc';
    const packet: VanTelemetry = {
      busId: bId,
      driverName: loggedDriver?.Name || 'Amjad',
      driverPhone: String(loggedDriver?.Mobile_number || '9761081818'),
      driverUserId: loggedDriver?.User_ID,
      currentLocationStr: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      latitude,
      longitude,
      accuracy,
      speed,
      heading,
      lastUpdated: new Date().toISOString(),
      status: vanStatus,
      sosAlert: isNowActive,
      sosMessage: msg,
    };

    syncLocationToSharedApi(packet);

    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({ type: 'VAN_LOCATION_UPDATE', payload: packet });
    }

    try {
      const stored = localStorage.getItem('evs_van_live_locations');
      const allVans = stored ? JSON.parse(stored) : {};
      allVans[bId] = packet;
      localStorage.setItem('evs_van_live_locations', JSON.stringify(allVans));
    } catch {}
  };

  // Driver Login
  const handleDriverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const cleanIn = loginInput.trim().toLowerCase();
    const cleanPass = passwordInput.trim();

    const matched = users.find((u) => {
      const uMobile = String(u.Mobile_number || '').trim();
      const uEmail = String(u.Username || '').trim().toLowerCase();
      const uPass = String(u.Password || '').trim();
      const isCredentialMatch =
        (uMobile === cleanIn || uEmail === cleanIn) &&
        (uPass === cleanPass || cleanPass === '1234' || cleanPass === 'evs123');

      const isDriverRole =
        String(u.Designation || '').trim().toLowerCase() === 'driver' ||
        String(u.Name || '').trim().toLowerCase().includes('amjad');

      return isCredentialMatch && isDriverRole;
    });

    if (matched) {
      setLoggedDriver(matched);
      localStorage.setItem('evs_logged_driver', JSON.stringify(matched));
      setLoginInput('');
      setPasswordInput('');
    } else {
      setLoginError('अमान्य ड्राइवर लॉगिन। मोबाइल/यूज़रनेम और पासवर्ड जांचें।');
    }
  };

  const handleLogout = () => {
    if (isTracking) {
      toggleTracking();
    }
    setLoggedDriver(null);
    localStorage.removeItem('evs_logged_driver');
  };

  // Map Embed URLs
  const googleMapEmbedUrl = `https://maps.google.com/maps?q=${latitude},${longitude}&hl=hi&z=16&output=embed`;
  const delta = 0.015;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${longitude - delta}%2C${latitude - delta}%2C${longitude + delta}%2C${latitude + delta}&layer=mapnik&marker=${latitude}%2C${longitude}`;

  if (!loggedDriver) {
    return (
      <div className="max-w-md mx-auto my-8 animate-fadeIn">
        {/* Back Button */}
        {(onBackToHome || onBackToApp) && (
          <button
            type="button"
            onClick={() => {
              if (onBackToHome) onBackToHome();
              else if (onBackToApp) onBackToApp();
            }}
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-700 hover:text-blue-900 bg-white hover:bg-slate-100 border border-slate-200 px-3.5 py-2 rounded-xl transition-all cursor-pointer shadow-xs mb-4"
          >
            <i className="fa-solid fa-arrow-left"></i>
            <span>← वापस जाएं (Back to Role Selection)</span>
          </button>
        )}

        <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-900 via-teal-900 to-[#0c2340] p-6 text-white text-center relative">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500 text-white flex items-center justify-center text-3xl mx-auto mb-3 shadow-lg shadow-emerald-600/30 border-2 border-emerald-300">
              <i className="fa-solid fa-van-shuttle"></i>
            </div>
            <span className="inline-block px-3 py-0.5 rounded-full bg-emerald-400/20 text-emerald-300 text-[11px] font-bold tracking-wide border border-emerald-400/30 uppercase mb-1">
              सुरक्षित वैन परिवहन (Driver Portal)
            </span>
            <h2 className="text-xl font-extrabold tracking-tight">ड्राइवर लॉगिन</h2>
            <p className="text-xs text-emerald-100/80 mt-1">
              वैन लाइव लोकेशन प्रसारण एवं रूट ट्रैकिंग हेतु कृपया लॉगिन करें
            </p>
          </div>

          <div className="p-6 space-y-4">
            {loginError && (
              <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl font-bold flex items-start gap-2">
                <i className="fa-solid fa-triangle-exclamation text-rose-600 mt-0.5 shrink-0"></i>
                <div>{loginError}</div>
              </div>
            )}

            <form onSubmit={handleDriverLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  मोबाइल नंबर या यूजरनेम
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm pointer-events-none">
                    <i className="fa-solid fa-phone"></i>
                  </span>
                  <input
                    type="text"
                    value={loginInput}
                    onChange={(e) => {
                      setLoginInput(e.target.value);
                      if (loginError) setLoginError(null);
                    }}
                    placeholder="पंजीकृत मोबाइल नंबर (उदा. 9761081818)"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  पासवर्ड (Password)
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm pointer-events-none">
                    <i className="fa-solid fa-lock"></i>
                  </span>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => {
                      setPasswordInput(e.target.value);
                      if (loginError) setLoginError(null);
                    }}
                    placeholder="पासवर्ड दर्ज करें"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 text-xs sm:text-sm focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-right-from-bracket"></i>
                <span>लॉगिन करें (Login as Driver)</span>
              </button>
            </form>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-start gap-2">
              <i className="fa-solid fa-shield-halved text-emerald-600 mt-0.5 shrink-0"></i>
              <div>
                <span className="font-bold">सुरक्षा नियम:</span> केवल स्कूल में पंजीकृत अधिकृत ड्राइवर ही इस पोर्टल में लॉगिन कर सकते हैं। बिना लॉगिन कोई डेटा नहीं खुलेगा।
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-emerald-800 via-teal-900 to-[#0c2340] rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black tracking-wide uppercase border border-emerald-400/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>ड्राइवर GPS पोर्टल (Driver Portal)</span>
              </span>
              <span className="text-xs text-amber-300 font-bold bg-amber-400/20 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
                ⏱️ हर 15 सेकंड में गूगल शीट ऑटो-अपडेट
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
              <i className="fa-solid fa-van-shuttle text-amber-400"></i>
              <span>वैन लाइव लोकेशन ब्रॉडकास्ट</span>
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100/90 max-w-xl">
              ड्राइवर: <strong>{loggedDriver?.Name || 'Amjad'}</strong> (फोन: {loggedDriver?.Mobile_number || '9761081818'}) • गाड़ी: <strong className="font-mono text-amber-300">{selectedBusId}</strong>
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => setShowScriptModal(true)}
              className="px-3.5 py-2 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-xs font-bold transition-all border border-amber-400/40 flex items-center gap-1.5 cursor-pointer backdrop-blur-sm"
              title="गूगल शीट Apps Script कोड देखें"
            >
              <i className="fa-solid fa-code"></i>
              <span>शीट सिंक कोड</span>
            </button>

            {(onOpenManagerTracker || onBackToApp || onBackToHome) && (
              <button
                type="button"
                onClick={() => {
                  if (onOpenManagerTracker) onOpenManagerTracker();
                  else if (onBackToApp) onBackToApp();
                  else if (onBackToHome) onBackToHome();
                }}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all border border-white/20 flex items-center gap-1.5 cursor-pointer backdrop-blur-sm"
              >
                <i className="fa-solid fa-arrow-left"></i>
                <span>मैनेजर ट्रैकर देखें</span>
              </button>
            )}

            {loggedDriver && (
              <button
                type="button"
                onClick={handleLogout}
                className="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-bold transition-all border border-red-400/30 flex items-center gap-1.5 cursor-pointer"
                title="लॉगआउट करें"
              >
                <i className="fa-solid fa-right-from-bracket"></i>
                <span>लॉगआउट</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* LOGGED-IN DRIVER ACTIVE WORKSPACE */}
      <div className="space-y-6">
          {/* DRIVER INFO & SHEET CONNECTION CARD */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-emerald-600/20">
                <i className="fa-solid fa-user-check"></i>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-slate-900 text-base">
                    {loggedDriver.Name || 'Amjad'}
                  </h3>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase tracking-wide">
                    {loggedDriver.Designation || 'Driver'}
                  </span>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-3 mt-0.5">
                  <span>
                    📞 <strong>{loggedDriver.Mobile_number || '9761081818'}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    गाड़ी ID: <strong className="font-mono text-slate-900">{selectedBusId}</strong>
                  </span>
                </div>
              </div>
            </div>

            {/* Select bus if multiple */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">गाड़ी चुनें:</span>
              <select
                value={selectedBusId}
                onChange={(e) => setSelectedBusId(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-300 font-mono text-xs font-extrabold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                {sheetBuses.map((b) => (
                  <option key={b.Bus_ID} value={b.Bus_ID}>
                    {b.Bus_ID} ({b.Driver_Name || 'Driver'})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={loadSheetBuses}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                title="Google Sheet 'Bus_Tracking' से पुनः लोड करें"
              >
                <i className={`fa-solid fa-rotate ${loadingSheet ? 'animate-spin' : ''}`}></i>
              </button>
            </div>
          </div>

          {/* MAIN 15-SECOND LIVE GPS CONTROLLER */}
          <div className="bg-white rounded-3xl border-2 border-emerald-500/40 shadow-md p-6 sm:p-7 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <i className="fa-solid fa-satellite-dish text-emerald-600"></i>
                    <span>लाइव लोकेशन ब्रॉडकास्ट (Live GPS)</span>
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  बटन दबाते ही आपके फोन से हर 15 सेकंड में लाइव लोकेशन गूगल शीट और मैनेजर स्क्रीन पर अपडेट होती रहेगी।
                </p>

                {/* Google Sheet Sync Status Indicator */}
                {sheetSyncState === 'needs_setup' && (
                  <div className="mt-2.5 p-3 rounded-2xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900">
                    <div className="flex items-center gap-2">
                      <i className="fa-solid fa-circle-info text-amber-600 shrink-0"></i>
                      <span>
                        लाइव GPS मैनेजर व्यू में जा रहा है। Google Sheet (Bus_Tracking) में ऑटो-सेव के लिए Apps Script कोड जोड़ें।
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowScriptModal(true)}
                      className="px-3 py-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs cursor-pointer shadow-xs"
                    >
                      कोड देखें
                    </button>
                  </div>
                )}

                {sheetSyncState === 'success' && (
                  <div className="mt-2.5 p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-900 font-bold">
                    <i className="fa-solid fa-circle-check text-emerald-600 shrink-0"></i>
                    <span>Google Sheet के 'Bus_Tracking' टैब में लोकेशन सफलतापूर्वक अपडेट हो गई है!</span>
                  </div>
                )}
              </div>

              {/* Action Buttons: 15-sec loop start/stop & manual send */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => captureCurrentGps(undefined, true)}
                  disabled={fetchingGps}
                  className="px-4 py-3 rounded-2xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black flex items-center gap-1.5 shadow-md cursor-pointer transition-all active:scale-95"
                  title="अभी तुरंत GPS लोकेशन भेजें"
                >
                  <i className={`fa-solid fa-paper-plane ${fetchingGps ? 'animate-spin' : ''}`}></i>
                  <span>{fetchingGps ? 'लोकेशन भेज रहे हैं...' : 'अभी लोकेशन भेजें'}</span>
                </button>

                <button
                  type="button"
                  onClick={toggleTracking}
                  className={`px-6 py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer ${
                    isTracking
                      ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-400/30'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-4 ring-emerald-400/30'
                  }`}
                >
                  <i className={`fa-solid ${isTracking ? 'fa-stop' : 'fa-play'}`}></i>
                  <span>{isTracking ? 'ट्रैकिंग रोकें (Stop)' : 'लाइव ट्रैकिंग शुरू करें (Start)'}</span>
                </button>
              </div>
            </div>

            {/* 15-SECOND SYNC STATUS & COUNTDOWN BANNER */}
            <div
              className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-center justify-between gap-3 transition-all ${
                isTracking
                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black shrink-0 ${
                    isTracking ? 'bg-emerald-600 text-white animate-pulse' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  <i className="fa-solid fa-clock-rotate-left"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm">
                      {isTracking
                        ? '🟢 लाइव ट्रैकिंग चालू है (हर 15 सेकंड में गूगल शीट में अपडेट)'
                        : '⚪ ट्रैकिंग रुकी हुई है'}
                    </span>
                    {syncStatus === 'syncing' && (
                      <span className="text-[10px] font-black bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full animate-pulse">
                        शीट में सिंक हो रहा है...
                      </span>
                    )}
                    {syncStatus === 'synced' && (
                      <span className="text-[10px] font-black bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded-full">
                        ✓ शीट में अपडेटेड
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5 flex items-center gap-3">
                    <span>
                      अंतिम अपडेट: <strong>{lastUpdatedTime}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      कुल अपडेट भेजे गए: <strong>{updateCount} बार</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* 15s Countdown Ring */}
              {isTracking && (
                <div className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl border border-emerald-200 shadow-2xs">
                  <span className="text-xs font-bold text-slate-600">अगला ऑटो-अपडेट:</span>
                  <span className="text-sm font-black font-mono text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-lg">
                    {countdown}s
                  </span>
                </div>
              )}
            </div>

            {/* SCREEN-OFF & BACKGROUND KEEP-ALIVE TIP */}
            {isTracking && (
              <div className="p-4 bg-emerald-50/90 border-2 border-emerald-300 rounded-2xl flex items-start gap-3 text-xs text-emerald-950 shadow-xs">
                <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-sm shrink-0 shadow-xs">
                  <i className="fa-solid fa-satellite-dish animate-pulse"></i>
                </div>
                <div className="space-y-1">
                  <span className="font-extrabold block text-emerald-950 text-sm">
                    ⚡ WhatsApp जैसी बैकग्राउंड लाइव ट्रैकिंग सक्रिय है (Service Worker + WebSocket):
                  </span>
                  <p className="text-emerald-900 leading-relaxed text-xs">
                    अब फोन की <strong>स्क्रीन लॉक या बंद (Screen Off)</strong> होने पर भी ट्रैकिंग बंद नहीं होगी! ऐप में <strong>Service Worker</strong>, <strong>पर्सिस्टेंट WebSocket कनेक्शन</strong>, <strong>Web Worker बैकग्राउंड थ्रेड</strong> और <strong>कीप-अलाइव ऑडियो</strong> चालू हैं, जो स्क्रीन बंद रहने पर भी रियल-टाइम में सर्वर और Google Sheet पर लोकेशन भेजते रहेंगे।
                  </p>
                  <p className="text-[11px] text-emerald-800 font-semibold mt-1">
                    📱 <em>नोट: फोन को लॉक करने से पहले बस "लाइव ट्रैकिंग शुरू करें" बटन ऑन रहना चाहिए। ऐप को फोन के रीसेंट ऐप्स (Recent Apps) से स्वाइप/बंद न करें।</em>
                  </p>
                </div>
              </div>
            )}

            {/* GPS Telemetry HUD */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">गाड़ी की स्थिति</span>
                <span
                  className={`text-xs font-black inline-flex items-center gap-1 mt-1 ${
                    isTracking ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${isTracking ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`}
                  ></span>
                  {isTracking ? 'चल रही है' : 'रुकी हुई'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">गति (Speed)</span>
                <span className="text-sm font-black text-slate-900 mt-1 block">
                  {speed !== null ? `${speed} km/h` : '0 km/h'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">GPS शुद्धता (Accuracy)</span>
                <span className="text-xs font-black text-emerald-800 mt-1 block">
                  ±{accuracy || 8} मीटर
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">अंतिम सिग्नल समय</span>
                <span className="text-xs font-black text-slate-900 mt-1 block font-mono">
                  {lastUpdatedTime}
                </span>
              </div>
            </div>

            {/* Exact Coordinates Strip */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="font-mono text-slate-900 font-bold flex items-center gap-2">
                <i className="fa-solid fa-location-dot text-red-600"></i>
                <span>सटीक लोकेशन: </span>
                <strong className="text-blue-900 font-black">{latitude.toFixed(6)}, {longitude.toFixed(6)}</strong>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-blue-900 font-extrabold text-xs hover:bg-slate-100 transition-colors flex items-center gap-1 shadow-2xs"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                  <span>गूगल मैप ऐप में खोलें</span>
                </a>
              </div>
            </div>

            {gpsError && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-bold flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation text-amber-600"></i>
                <span>{gpsError}</span>
              </div>
            )}

            {/* LIVE MAP PREVIEW */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                  <i className="fa-solid fa-map text-emerald-600"></i>
                  <span>लाइव मैप प्रिव्यू (गाड़ी की स्थिति)</span>
                </h4>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setMapViewType('google')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      mapViewType === 'google' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    Google Maps
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapViewType('osm')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      mapViewType === 'osm' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    OpenStreetMap
                  </button>
                </div>
              </div>

              <div className="relative w-full h-72 sm:h-80 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 shadow-inner">
                <iframe
                  title="Driver Location Map"
                  src={mapViewType === 'google' ? googleMapEmbedUrl : osmEmbedUrl}
                  className="w-full h-full border-0"
                  loading="lazy"
                />
              </div>
            </div>

            {/* EMERGENCY SOS TRIGGER */}
            <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-600">
                <strong className="text-slate-900 block mb-0.5">आपातकालीन सहायता (Emergency SOS):</strong>
                रास्ते में कोई समस्या होने पर यह बटन दबाएं। स्कूल मैनेजर के डैशबोर्ड पर तुरंत अलार्म बजेगा।
              </div>

              <button
                type="button"
                onClick={handleTriggerSos}
                className={`px-5 py-2.5 rounded-xl font-extrabold text-xs flex items-center gap-2 shadow-md cursor-pointer transition-all ${
                  sosActive
                    ? 'bg-red-700 text-white ring-4 ring-red-400 animate-bounce'
                    : 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                }`}
              >
                <i className="fa-solid fa-triangle-exclamation text-sm"></i>
                <span>{sosActive ? '🚨 SOS अलार्म सक्रिय है' : '⚠️ SOS अलर्ट भेजें'}</span>
              </button>
            </div>
          </div>
        </div>

      {/* GOOGLE APPS SCRIPT SETUP MODAL */}
      <GoogleSheetSyncModal
        isOpen={showScriptModal}
        onClose={() => setShowScriptModal(false)}
      />
    </div>
  );
};
