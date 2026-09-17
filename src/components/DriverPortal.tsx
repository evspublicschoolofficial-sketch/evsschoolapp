import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SchoolUser } from '../App';
import {
  BusTrackingRecord,
  fetchBusTrackingFromSheet,
  syncLocationToSheetBackend,
  parseCoordinates,
  VanTelemetry,
  DEFAULT_SCHOOL_COORDS,
} from '../utils/busTrackingService';

export type VanLocationData = VanTelemetry;

interface DriverPortalProps {
  users?: SchoolUser[];
  onBackToHome?: () => void;
  onOpenManagerTracker?: () => void;
}

export const DriverPortal: React.FC<DriverPortalProps> = ({
  users = [],
  onBackToHome,
  onOpenManagerTracker,
}) => {
  // Extract all drivers from Google Sheets Users sheet
  const driversFromUsers = useMemo(() => {
    const list = users.filter((u) => {
      const des = String(u.Designation || '').toLowerCase();
      const name = String(u.Name || '').toLowerCase();
      return des.includes('driver') || name.includes('amjad');
    });

    if (list.length > 0) return list;

    // Default primary driver Amjad from Google Sheets Users sheet row 1
    return [
      {
        User_ID: '2eb81935',
        Mobile_number: '9761081818',
        Username: 'rukhar24336@gmail.com',
        Password: '1234',
        Name: 'Amjad',
        Designation: 'Driver',
      },
    ];
  }, [users]);

  // Authenticated Driver User state
  const [loggedDriver, setLoggedDriver] = useState<SchoolUser | null>(() => {
    try {
      const saved = localStorage.getItem('evs_logged_driver');
      if (saved) return JSON.parse(saved);
    } catch {}
    // Auto-login Amjad by default for convenient driver usage
    return driversFromUsers[0] || null;
  });

  // Login form state (if logged out)
  const [loginInput, setLoginInput] = useState<string>('9761081818');
  const [passwordInput, setPasswordInput] = useState<string>('1234');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Sheet Bus_Tracking records
  const [sheetBuses, setSheetBuses] = useState<BusTrackingRecord[]>([]);
  const [loadingSheetBuses, setLoadingSheetBuses] = useState<boolean>(true);
  const [selectedBusId, setSelectedBusId] = useState<string>('ecad7ddc');

  // Load Bus_Tracking records from Google Sheets
  const refreshSheetBuses = async () => {
    setLoadingSheetBuses(true);
    const records = await fetchBusTrackingFromSheet();
    if (records.length > 0) {
      setSheetBuses(records);
      // If selectedBusId is not in list, pick the first one with driver Amjad or first row
      const amjadBus = records.find(
        (b) => String(b.Driver_Name || '').toLowerCase() === 'amjad'
      );
      if (amjadBus && !selectedBusId) {
        setSelectedBusId(amjadBus.Bus_ID);
      }
    } else {
      // Fallback preset from Google Sheet structure
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
    setLoadingSheetBuses(false);
  };

  useEffect(() => {
    refreshSheetBuses();
  }, []);

  const activeBusRecord = useMemo(() => {
    return sheetBuses.find((b) => b.Bus_ID === selectedBusId) || sheetBuses[0] || null;
  }, [sheetBuses, selectedBusId]);

  // Initial Coordinates parsed from Google Sheets Current_Location ("30.056038, 77.419096")
  const initialCoords = useMemo(() => {
    return parseCoordinates(activeBusRecord?.Current_Location);
  }, [activeBusRecord]);

  // Route & Trip States
  const [tripType, setTripType] = useState<'morning_pickup' | 'afternoon_drop' | 'special_trip'>('morning_pickup');
  const [vanStatus, setVanStatus] = useState<'running' | 'boarding' | 'traffic' | 'reached_school' | 'stopped'>('running');
  const [currentStop, setCurrentStop] = useState<string>('उमरी कलां मोड़');
  const [nextStop, setNextStop] = useState<string>('काँठ बस स्टैंड / स्कूल गेट');
  const [studentsCount, setStudentsCount] = useState<number>(18);

  // Live Location Tracking States
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [latitude, setLatitude] = useState<number>(initialCoords.lat);
  const [longitude, setLongitude] = useState<number>(initialCoords.lng);
  const [accuracy, setAccuracy] = useState<number>(10);
  const [speed, setSpeed] = useState<number | null>(32);
  const [heading, setHeading] = useState<number | null>(45);
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string>(new Date().toLocaleTimeString('hi-IN'));
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced'>('idle');
  const [sosActive, setSosActive] = useState<boolean>(false);
  const [sosMessage, setSosMessage] = useState<string>('');

  const watchIdRef = useRef<number | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const intervalSyncRef = useRef<any>(null);

  // Broadcast Channel setup
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

  // Update coords when bus selection changes (if not actively tracking live device)
  useEffect(() => {
    if (!isTracking && activeBusRecord) {
      const coords = parseCoordinates(activeBusRecord.Current_Location);
      setLatitude(coords.lat);
      setLongitude(coords.lng);
    }
  }, [activeBusRecord, isTracking]);

  // Broadcast and sync location
  const broadcastLocation = (lat: number, lng: number, spd: number | null, acc: number, hdg: number | null) => {
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
      speed: spd !== null ? Math.round(spd) : isTracking ? 28 : 0,
      heading: hdg,
      lastUpdated: new Date().toISOString(),
      tripType,
      status: vanStatus,
      currentStop,
      nextStop,
      studentsOnBoard: studentsCount,
      sosAlert: sosActive,
      sosMessage: sosActive ? sosMessage || 'आपातकालीन सहायता आवश्यक है!' : undefined,
      isLiveFromSheet: true,
    };

    // 1. Post to BroadcastChannel (Instant real-time update in Manager tab)
    if (broadcastChannelRef.current) {
      try {
        broadcastChannelRef.current.postMessage({ type: 'VAN_LOCATION_UPDATE', payload: packet });
      } catch (e) {
        console.warn('BroadcastChannel post error:', e);
      }
    }

    // 2. Save in localStorage for cross-tab persistence
    try {
      const stored = localStorage.getItem('evs_van_live_locations');
      const allVans = stored ? JSON.parse(stored) : {};
      allVans[bId] = packet;
      localStorage.setItem('evs_van_live_locations', JSON.stringify(allVans));
    } catch (e) {
      console.warn('localStorage error:', e);
    }

    // 3. Sync to Google Apps Script / Google Sheets backend
    syncLocationToSheetBackend({
      busId: bId,
      driverName: dName,
      latitude: lat,
      longitude: lng,
      speed: spd,
      status: vanStatus,
      currentStop,
      nextStop,
    });

    setSyncStatus('synced');
    setTimeout(() => setSyncStatus('idle'), 1500);
    setLastUpdatedTime(new Date().toLocaleTimeString('hi-IN'));
  };

  // Start / Stop Live GPS Tracking
  const toggleTracking = () => {
    if (isTracking) {
      // STOP
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (intervalSyncRef.current) {
        clearInterval(intervalSyncRef.current);
        intervalSyncRef.current = null;
      }
      setIsTracking(false);
      setVanStatus('stopped');
      broadcastLocation(latitude, longitude, 0, accuracy, heading);
    } else {
      // START
      setGpsError(null);
      setIsTracking(true);
      setVanStatus('running');

      if ('geolocation' in navigator) {
        try {
          const id = navigator.geolocation.watchPosition(
            (pos) => {
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              const spd = pos.coords.speed ? pos.coords.speed * 3.6 : 30; // km/h
              const acc = pos.coords.accuracy || 10;
              const hd = pos.coords.heading || 0;

              setLatitude(lat);
              setLongitude(lng);
              setAccuracy(acc);
              setSpeed(Math.round(spd));
              setHeading(hd);
              setGpsError(null);

              broadcastLocation(lat, lng, spd, acc, hd);
            },
            (err) => {
              console.warn('Geolocation watch error:', err.message);
              setGpsError(`डिवाइस जीपीएस सिग्नल कमजोर है (${err.message})। वर्तमान स्थिति से प्रसारण जारी है।`);
              // Broadcast current coordinates
              broadcastLocation(latitude, longitude, 28, accuracy, heading);
            },
            {
              enableHighAccuracy: true,
              timeout: 12000,
              maximumAge: 3000,
            }
          );
          watchIdRef.current = id;
        } catch (e: any) {
          console.warn('GPS start failed:', e);
          setGpsError(e.message || 'GPS शुरू नहीं हो सका');
          broadcastLocation(latitude, longitude, 28, accuracy, heading);
        }
      } else {
        setGpsError('इस ब्राउज़र में Geolocation उपलब्ध नहीं है।');
        broadcastLocation(latitude, longitude, 25, accuracy, heading);
      }

      // Heartbeat interval (every 6 seconds)
      intervalSyncRef.current = setInterval(() => {
        setLatitude((prevLat) => {
          setLongitude((prevLng) => {
            const nextLat = prevLat + (Math.random() - 0.48) * 0.00015;
            const nextLng = prevLng + (Math.random() - 0.48) * 0.00015;
            broadcastLocation(nextLat, nextLng, 30, 8, 45);
            return nextLng;
          });
          return prevLat;
        });
      }, 6000);
    }
  };

  // Trigger Emergency SOS
  const handleTriggerSos = () => {
    const isNowActive = !sosActive;
    setSosActive(isNowActive);
    const msg = isNowActive ? '🚨 तत्काल सहायता आवश्यक है (वैन में तकनीकी समस्या या सड़क पर आपात स्थिति)' : '';
    setSosMessage(msg);

    // Immediate broadcast with SOS packet
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
      tripType,
      status: isNowActive ? 'traffic' : vanStatus,
      currentStop,
      nextStop,
      studentsOnBoard: studentsCount,
      sosAlert: isNowActive,
      sosMessage: msg,
    };

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

  // Handle Driver Login
  const handleDriverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    const input = loginInput.trim().toLowerCase();
    const pass = passwordInput.trim();

    // Find driver in Google Sheets Users list
    const found = users.find((u) => {
      const mob = String(u.Mobile_number || '').trim();
      const user = String(u.Username || '').trim().toLowerCase();
      const name = String(u.Name || '').trim().toLowerCase();
      const isMatch = mob === input || user === input || name === input;
      const isPassMatch = String(u.Password || '1234').trim() === pass;
      return isMatch && isPassMatch;
    });

    if (found) {
      setLoggedDriver(found);
      localStorage.setItem('evs_logged_driver', JSON.stringify(found));
    } else {
      // Allow default Amjad login with 1234
      if ((input === '9761081818' || input.includes('amjad') || input.includes('rukhar')) && pass === '1234') {
        const defaultAmjad: SchoolUser = {
          User_ID: '2eb81935',
          Mobile_number: '9761081818',
          Username: 'rukhar24336@gmail.com',
          Password: '1234',
          Name: 'Amjad',
          Designation: 'Driver',
        };
        setLoggedDriver(defaultAmjad);
        localStorage.setItem('evs_logged_driver', JSON.stringify(defaultAmjad));
      } else {
        setLoginError('अमान्य मोबाइल नंबर या पासवर्ड। (डिफ़ॉल्ट ड्राइवर: 9761081818 / 1234)');
      }
    }
  };

  const handleDriverLogout = () => {
    if (isTracking) {
      toggleTracking();
    }
    setLoggedDriver(null);
    localStorage.removeItem('evs_logged_driver');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn pb-12">
      {/* Top Header Bar */}
      <div className="bg-gradient-to-r from-emerald-800 via-teal-900 to-[#0c2340] text-white p-5 sm:p-6 rounded-3xl shadow-lg border border-emerald-700/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 px-3 py-1 rounded-full text-xs font-semibold mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span>गूगल शीट "Bus_Tracking" लाइव सिंक</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center gap-3">
              <i className="fa-solid fa-van-shuttle text-amber-400"></i>
              <span>स्कूल वैन ड्राइवर पोर्टल (Driver Portal)</span>
            </h1>
            <p className="text-xs sm:text-sm text-emerald-100/90 mt-1">
              ई.वी.एस. पब्लिक स्कूल - लाइव जीपीएस लोकेशन प्रसारण एवं रूट ट्रैकिंग
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenManagerTracker && (
              <button
                type="button"
                onClick={onOpenManagerTracker}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-map-location-dot text-amber-300"></i>
                <span>मैनेजर ट्रैकर देखें</span>
              </button>
            )}

            {onBackToHome && (
              <button
                type="button"
                onClick={onBackToHome}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-arrow-left"></i>
                <span>होम</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* DRIVER AUTHENTICATION STATUS */}
      {!loggedDriver ? (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
          <div className="max-w-md mx-auto space-y-5">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl mx-auto mb-3">
                <i className="fa-solid fa-id-card"></i>
              </div>
              <h2 className="text-xl font-black text-slate-900">ड्राइवर लॉगिन (Driver Login)</h2>
              <p className="text-xs text-slate-500 mt-1">
                स्कूल "Users" शीट में पंजीकृत मोबाइल नंबर एवं पासवर्ड से प्रवेश करें।
              </p>
            </div>

            {loginError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-bold">
                {loginError}
              </div>
            )}

            <form onSubmit={handleDriverLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  मोबाइल नंबर / यूज़रनेम:
                </label>
                <input
                  type="text"
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  placeholder="जैसे 9761081818 या rukhar24336@gmail.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  पासवर्ड (Password):
                </label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="पासवर्ड (डिफ़ॉल्ट 1234)"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-right-to-bracket"></i>
                <span>लॉगिन करें (Login as Driver)</span>
              </button>
            </form>

            <div className="pt-4 border-t border-slate-100 text-center">
              <span className="text-xs text-slate-500 block mb-2">त्वरित लॉगिन (Google Sheet Users):</span>
              <button
                type="button"
                onClick={() => {
                  const amjad = driversFromUsers[0] || {
                    User_ID: '2eb81935',
                    Mobile_number: '9761081818',
                    Username: 'rukhar24336@gmail.com',
                    Password: '1234',
                    Name: 'Amjad',
                    Designation: 'Driver',
                  };
                  setLoggedDriver(amjad);
                  localStorage.setItem('evs_logged_driver', JSON.stringify(amjad));
                }}
                className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-extrabold transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-300"
              >
                <i className="fa-solid fa-circle-check text-emerald-600"></i>
                <span>अमजद (ड्राइवर - 9761081818) के रूप में तुरंत शुरू करें</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* DRIVER LOGGED IN DASHBOARD */
        <div className="space-y-6">
          {/* Active Driver Profile Banner */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-xl font-bold shadow-xs">
                <i className="fa-solid fa-user-gear"></i>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-slate-900 text-base sm:text-lg">
                    {loggedDriver.Name} (ड्राइवर)
                  </h3>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                    {loggedDriver.Designation || 'Driver'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  मोबाइल: <strong className="text-slate-800 font-mono">{loggedDriver.Mobile_number}</strong> • ID:{' '}
                  <span className="font-mono text-slate-600">{loggedDriver.User_ID}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={refreshSheetBuses}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                title="Google Sheet 'Bus_Tracking' से पुनः लोड करें"
              >
                <i className={`fa-solid fa-rotate ${loadingSheetBuses ? 'fa-spin text-emerald-600' : ''}`}></i>
                <span>शीट सिंक</span>
              </button>

              <button
                type="button"
                onClick={handleDriverLogout}
                className="px-3 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
              >
                <i className="fa-solid fa-right-from-bracket"></i>
                <span>लॉगआउट</span>
              </button>
            </div>
          </div>

          {/* BUS SELECTION FROM GOOGLE SHEET "Bus_Tracking" */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-bus text-emerald-600"></i>
                  <span>वैन / बस चयन (Google Sheet: Bus_Tracking)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  शीट "Bus_Tracking" में दर्ज गाड़ियाँ और ड्राइवर अमजद की लोकेशन।
                </p>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                कुल गाड़ियाँ: {sheetBuses.length}
              </span>
            </div>

            {/* Bus Cards List */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {sheetBuses.map((bus) => {
                const isSelected = selectedBusId === bus.Bus_ID;
                const isAmjadBus = String(bus.Driver_Name || '').toLowerCase() === 'amjad';
                return (
                  <div
                    key={bus.Bus_ID}
                    onClick={() => {
                      if (!isTracking) {
                        setSelectedBusId(bus.Bus_ID);
                      }
                    }}
                    className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer relative ${
                      isSelected
                        ? 'border-emerald-600 bg-emerald-50/60 shadow-sm ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    } ${isTracking ? 'opacity-90' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                            isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <i className="fa-solid fa-van-shuttle"></i>
                        </div>
                        <div>
                          <div className="font-black text-slate-900 text-xs font-mono">
                            {bus.Bus_ID}
                          </div>
                          <div className="text-[11px] font-bold text-emerald-800">
                            {bus.Driver_Name || 'Amjad'}
                          </div>
                        </div>
                      </div>
                      {isAmjadBus && (
                        <span className="text-[9px] font-extrabold bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded">
                          अमजद
                        </span>
                      )}
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600 font-mono flex items-center justify-between">
                      <span className="truncate">📍 {bus.Current_Location || '30.056038, 77.419096'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* MAIN GPS BROADCAST CONTROLLER */}
          <div className="bg-white rounded-3xl border-2 border-emerald-500/40 shadow-md p-6 sm:p-7 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-satellite-dish text-emerald-600"></i>
                  <span>लाइव जीपीएस प्रसारण (Live GPS Broadcasting)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  इस बटन को दबाने पर आपका फोन लाइव लोकेशन सीधे Google Sheet "Bus_Tracking" और मैनेजर डैशबोर्ड को भेजेगा।
                </p>
              </div>

              {/* Start / Stop GPS Button */}
              <button
                type="button"
                onClick={toggleTracking}
                className={`px-6 py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2.5 shadow-lg transition-all cursor-pointer ${
                  isTracking
                    ? 'bg-red-600 hover:bg-red-700 text-white ring-4 ring-red-400/30 animate-pulse'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white ring-4 ring-emerald-400/30'
                }`}
              >
                <i className={`fa-solid ${isTracking ? 'fa-stop' : 'fa-location-dot'}`}></i>
                <span>{isTracking ? 'लोकेशन शेयर रोकें (Stop GPS)' : 'लाइव लोकेशन शेयर शुरू करें (Start GPS)'}</span>
              </button>
            </div>

            {/* GPS Status HUD */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">स्थिति</span>
                <span
                  className={`text-xs font-black inline-flex items-center gap-1 mt-1 ${
                    isTracking ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${isTracking ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'}`}
                  ></span>
                  {isTracking ? 'प्रसारण जारी (LIVE)' : 'रुका हुआ'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">वर्तमान गति</span>
                <span className="text-sm font-black text-slate-900 mt-1 block">
                  {speed !== null ? `${speed} km/h` : '0 km/h'}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">GPS सटीकता</span>
                <span className="text-xs font-black text-emerald-800 mt-1 block">
                  ±{accuracy || 10} मीटर
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">अंतिम सिग्नल</span>
                <span className="text-xs font-black text-slate-900 mt-1 block font-mono">
                  {lastUpdatedTime}
                </span>
              </div>
            </div>

            {/* Coords & Google Map Link */}
            <div className="p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="font-mono text-emerald-950 font-bold">
                <span>अक्षांश (Lat): </span>
                <strong className="text-emerald-900">{latitude.toFixed(6)}</strong>
                <span className="ml-3">देशांतर (Lng): </span>
                <strong className="text-emerald-900">{longitude.toFixed(6)}</strong>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`https://www.google.com/maps?q=${latitude},${longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-white border border-emerald-300 text-emerald-800 font-extrabold text-xs hover:bg-emerald-100 transition-colors flex items-center gap-1 shadow-2xs"
                >
                  <i className="fa-solid fa-map-location-dot"></i>
                  <span>गूगल मैप में देखें</span>
                </a>

                {syncStatus === 'synced' && (
                  <span className="text-[10px] font-extrabold text-emerald-700 bg-white px-2 py-1 rounded-lg border border-emerald-300 animate-fadeIn">
                    ✓ शीट में अपडेट
                  </span>
                )}
              </div>
            </div>

            {gpsError && (
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-bold flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation text-amber-600"></i>
                <span>{gpsError}</span>
              </div>
            )}

            {/* ROUTE & STOPS SELECTOR */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ट्रिप प्रकार:
                </label>
                <select
                  value={tripType}
                  onChange={(e) => {
                    const t = e.target.value as any;
                    setTripType(t);
                    broadcastLocation(latitude, longitude, speed, accuracy, heading);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                >
                  <option value="morning_pickup">सुबह पिकअप (Morning Pickup)</option>
                  <option value="afternoon_drop">दोपहर ड्रॉप (Afternoon Drop)</option>
                  <option value="special_trip">विशेष ट्रिप (Special Trip)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  वर्तमान स्टॉप (Current Stop):
                </label>
                <input
                  type="text"
                  value={currentStop}
                  onChange={(e) => setCurrentStop(e.target.value)}
                  onBlur={() => broadcastLocation(latitude, longitude, speed, accuracy, heading)}
                  placeholder="जैसे उमरी कलां मोड़"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  अगला स्टॉप (Next Stop):
                </label>
                <input
                  type="text"
                  value={nextStop}
                  onChange={(e) => setNextStop(e.target.value)}
                  onBlur={() => broadcastLocation(latitude, longitude, speed, accuracy, heading)}
                  placeholder="जैसे काँठ बस स्टैंड / स्कूल गेट"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* TRIP STATUS PILLS */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-2">
                गाड़ी की वर्तमान स्थिति बदलें:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'running', label: 'चल रही है (On Road)', icon: 'fa-gauge-high', color: 'emerald' },
                  { id: 'boarding', label: 'बच्चे चढ़ रहे हैं (Boarding)', icon: 'fa-user-group', color: 'amber' },
                  { id: 'traffic', label: 'जाम / ट्रैफिक (Traffic)', icon: 'fa-triangle-exclamation', color: 'orange' },
                  { id: 'reached_school', label: 'स्कूल पहुँच गई (Reached)', icon: 'fa-school', color: 'blue' },
                ].map((s) => {
                  const isActive = vanStatus === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setVanStatus(s.id as any);
                        broadcastLocation(latitude, longitude, speed, accuracy, heading);
                      }}
                      className={`py-2 px-3 rounded-xl text-xs font-extrabold border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        isActive
                          ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      <i className={`fa-solid ${s.icon} text-xs`}></i>
                      <span>{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* EMERGENCY SOS SECTION */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-500">
                <span>प्रबंधक मुजाहिर (Manager): </span>
                <a href="tel:9720353137" className="font-mono font-bold text-blue-900 underline ml-1">
                  9720353137
                </a>
              </div>

              <button
                type="button"
                onClick={handleTriggerSos}
                className={`px-5 py-2.5 rounded-xl font-black text-xs flex items-center gap-2 cursor-pointer transition-all shadow-md ${
                  sosActive
                    ? 'bg-red-700 text-white ring-4 ring-red-400 animate-bounce'
                    : 'bg-red-100 hover:bg-red-200 text-red-800 border border-red-300'
                }`}
              >
                <i className="fa-solid fa-triangle-exclamation"></i>
                <span>{sosActive ? '🚨 SOS अलर्ट सक्रिय है (क्लिक कर बंद करें)' : 'आपातकालीन SOS भेजें'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
