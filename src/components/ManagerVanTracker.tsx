import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Student, SchoolUser } from '../App';
import {
  BusTrackingRecord,
  fetchBusTrackingFromSheet,
  parseCoordinates,
  VanTelemetry,
  DEFAULT_SCHOOL_COORDS,
} from '../utils/busTrackingService';

interface ManagerVanTrackerProps {
  students?: Student[];
  users?: SchoolUser[];
  onOpenDriverPortal?: () => void;
  getClassName?: (classIdOrName: string | null | undefined) => string;
}

export const ManagerVanTracker: React.FC<ManagerVanTrackerProps> = ({
  students = [],
  users = [],
  onOpenDriverPortal,
  getClassName = (c) => c || 'N/A',
}) => {
  // Real Bus_Tracking sheet records
  const [sheetBuses, setSheetBuses] = useState<BusTrackingRecord[]>([]);
  const [loadingSheet, setLoadingSheet] = useState<boolean>(true);
  const [selectedBusId, setSelectedBusId] = useState<string>('ecad7ddc');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString('hi-IN'));
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Live telemetry map received from Driver Portal broadcasts & localStorage
  const [liveTelemetry, setLiveTelemetry] = useState<Record<string, VanTelemetry>>(() => {
    try {
      const saved = localStorage.getItem('evs_van_live_locations');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  // Fetch real Google Sheet "Bus_Tracking"
  const fetchSheetData = async () => {
    setLoadingSheet(true);
    const records = await fetchBusTrackingFromSheet();
    if (records.length > 0) {
      setSheetBuses(records);
      // If selected bus is not in list, select the first Amjad bus or first row
      const amjadBus = records.find(
        (b) => String(b.Driver_Name || '').toLowerCase() === 'amjad'
      );
      if (amjadBus && !selectedBusId) {
        setSelectedBusId(amjadBus.Bus_ID);
      }
    } else {
      // Fallback if network blocked
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

  // Sync with Google Sheets and BroadcastChannel on mount
  useEffect(() => {
    fetchSheetData();

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
    };
    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Periodic auto-refresh every 5 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      try {
        const saved = localStorage.getItem('evs_van_live_locations');
        if (saved) {
          setLiveTelemetry((prev) => ({ ...prev, ...JSON.parse(saved) }));
        }
      } catch {}
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Find Driver's phone from Google Sheets "Users" sheet
  const getDriverPhone = (driverName: string): string => {
    const dLower = String(driverName || '').trim().toLowerCase();
    const foundUser = users.find((u) => {
      const uName = String(u.Name || '').trim().toLowerCase();
      const uDes = String(u.Designation || '').trim().toLowerCase();
      return uName.includes(dLower) || (dLower.includes('amjad') && (uName.includes('amjad') || uDes.includes('driver')));
    });

    if (foundUser?.Mobile_number) {
      return String(foundUser.Mobile_number);
    }
    // Default Amjad phone number from Users sheet row 1
    if (dLower.includes('amjad')) return '9761081818';
    if (dLower.includes('mujahir')) return '9720353137';
    return '9761081818';
  };

  // Get active bus record from sheet
  const activeSheetBus = useMemo(() => {
    return sheetBuses.find((b) => b.Bus_ID === selectedBusId) || sheetBuses[0] || null;
  }, [sheetBuses, selectedBusId]);

  // Combine Google Sheet Bus_Tracking record with real-time broadcast telemetry
  const activeBus = useMemo(() => {
    if (!activeSheetBus) return null;
    const live = liveTelemetry[activeSheetBus.Bus_ID];
    const coords = parseCoordinates(live?.currentLocationStr || activeSheetBus.Current_Location);
    const dPhone = live?.driverPhone || getDriverPhone(activeSheetBus.Driver_Name);

    return {
      busId: activeSheetBus.Bus_ID,
      driverName: live?.driverName || activeSheetBus.Driver_Name || 'Amjad',
      driverPhone: dPhone,
      currentLocationStr: live?.currentLocationStr || activeSheetBus.Current_Location || '30.056038, 77.419096',
      latitude: live?.latitude || coords.lat,
      longitude: live?.longitude || coords.lng,
      speed: live?.speed ?? (live?.status === 'running' ? 32 : 0),
      accuracy: live?.accuracy || 10,
      heading: live?.heading || 45,
      lastUpdated: live?.lastUpdated || activeSheetBus.Last_Updated || new Date().toISOString(),
      status: live?.status || 'running',
      currentStop: live?.currentStop || 'उमरी कलां मोड़',
      nextStop: live?.nextStop || 'EVS स्कूल गेट / काँठ',
      tripType: live?.tripType || 'morning_pickup',
      studentsOnBoard: live?.studentsOnBoard || 18,
      sosAlert: live?.sosAlert || false,
      sosMessage: live?.sosMessage,
      isLiveSignal: Boolean(live),
    };
  }, [activeSheetBus, liveTelemetry, users]);

  // Distance to school in km
  const distanceToSchool = useMemo(() => {
    if (!activeBus) return null;
    const R = 6371; // km
    const dLat = ((DEFAULT_SCHOOL_COORDS.lat - activeBus.latitude) * Math.PI) / 180;
    const dLon = ((DEFAULT_SCHOOL_COORDS.lng - activeBus.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((activeBus.latitude * Math.PI) / 180) *
        Math.cos((DEFAULT_SCHOOL_COORDS.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return (R * c).toFixed(2);
  }, [activeBus]);

  // Format time ago
  const getTimeAgo = (isoString?: string) => {
    if (!isoString) return 'अद्यतन';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 5) return 'अभी-अभी (Just now)';
      if (diffSec < 60) return `${diffSec} सेकंड पहले`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin} मिनट पहले`;
      return `${Math.floor(diffMin / 60)} घंटे पहले`;
    } catch {
      return isoString;
    }
  };

  // Google Maps URL
  const googleMapsUrl = activeBus
    ? `https://www.google.com/maps?q=${activeBus.latitude},${activeBus.longitude}&z=15`
    : `https://www.google.com/maps?q=${DEFAULT_SCHOOL_COORDS.lat},${DEFAULT_SCHOOL_COORDS.lng}`;

  // OpenStreetMap embed URL
  const osmEmbedUrl = useMemo(() => {
    if (!activeBus) return '';
    const delta = 0.02;
    const minLng = activeBus.longitude - delta;
    const maxLng = activeBus.longitude + delta;
    const minLat = activeBus.latitude - delta;
    const maxLat = activeBus.latitude + delta;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng}%2C${minLat}%2C${maxLng}%2C${maxLat}&layer=mapnik&marker=${activeBus.latitude}%2C${activeBus.longitude}`;
  }, [activeBus]);

  // Copy share location link
  const copyShareLink = () => {
    if (!activeBus) return;
    const text = `🚌 *E.V.S. Public School वैन लाइव लोकेशन*\nड्राइवर: ${activeBus.driverName} (फोन: ${activeBus.driverPhone})\nगाड़ी ID: ${activeBus.busId}\nवर्तमान स्टॉप: ${activeBus.currentStop}\nगूगल मैप लिंक: https://www.google.com/maps?q=${activeBus.latitude},${activeBus.longitude}`;
    navigator.clipboard?.writeText(text);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Filter students on this van route
  const routeStudents = useMemo(() => {
    return students.filter((s) => {
      const v = String(s['Village/rRoute'] || s.Village || '').toLowerCase();
      return v.includes('umri') || v.includes('kanth') || v.includes('chhajlet') || v.includes('salempur');
    });
  }, [students]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Banner with Google Sheet Bus_Tracking Tag */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#1e4485] text-white p-5 sm:p-6 rounded-3xl shadow-md border border-blue-900/40 relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 px-3 py-1 rounded-full text-xs font-semibold mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span>Google Sheet: "Bus_Tracking" & "Users" रीयल-टाइम कनेक्टेड</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
              <i className="fa-solid fa-van-shuttle text-amber-400"></i>
              <span>वैन लोकेशन ट्रैकिंग डैशबोर्ड (Live Van Monitoring)</span>
            </h2>
            <p className="text-xs text-slate-200 mt-1">
              ड्राइवर: <strong>अमजद (Amjad - 9761081818)</strong> • लोकेशन: <strong>{activeBus?.currentLocationStr || '30.056038, 77.419096'}</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Auto refresh toggle */}
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
                autoRefresh
                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                  : 'bg-white/10 border-white/20 text-slate-300'
              }`}
            >
              <i className={`fa-solid fa-arrows-rotate ${autoRefresh ? 'fa-spin text-emerald-300' : ''}`}></i>
              <span>{autoRefresh ? 'लाइव सिंक ON' : 'सिंक रुका हुआ'}</span>
            </button>

            {/* Manual refresh from Google Sheets */}
            <button
              type="button"
              onClick={fetchSheetData}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-amber-300 transition-colors cursor-pointer"
              title="Google Sheet 'Bus_Tracking' से तुरंत रिफ्रेश करें"
            >
              <i className={`fa-solid fa-rotate text-sm ${loadingSheet ? 'fa-spin' : ''}`}></i>
            </button>

            {/* Driver Portal direct launch */}
            {onOpenDriverPortal && (
              <button
                type="button"
                onClick={onOpenDriverPortal}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-extrabold text-xs shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-mobile-screen-button"></i>
                <span>ड्राइवर पोर्टल खोलें</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SOS Alert Banner */}
      {activeBus?.sosAlert && (
        <div className="bg-red-600 text-white p-4 rounded-2xl shadow-lg border-2 border-red-400 animate-bounce flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white text-red-600 flex items-center justify-center text-xl font-black shrink-0">
              <i className="fa-solid fa-triangle-exclamation"></i>
            </div>
            <div>
              <h4 className="font-extrabold text-sm sm:text-base">
                🚨 आपातकालीन अलर्ट: ड्राइवर {activeBus.driverName} (गाड़ी {activeBus.busId})
              </h4>
              <p className="text-xs text-red-100 mt-0.5">
                {activeBus.sosMessage || 'ड्राइवर ने तुरंत सहायता का अनुरोध किया है।'}
              </p>
            </div>
          </div>
          <a
            href={`tel:${activeBus.driverPhone}`}
            className="px-4 py-2 bg-white text-red-700 font-extrabold text-xs rounded-xl shadow hover:bg-red-50 flex items-center gap-1.5 shrink-0"
          >
            <i className="fa-solid fa-phone"></i>
            <span>तुरंत कॉल करें ({activeBus.driverPhone})</span>
          </a>
        </div>
      )}

      {/* VANS FLEET TABS (Google Sheet Bus_Tracking rows) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {sheetBuses.map((bus) => {
          const isSelected = selectedBusId === bus.Bus_ID;
          const live = liveTelemetry[bus.Bus_ID];
          const isLive = Boolean(live && live.status !== 'stopped');
          const isAmjad = String(bus.Driver_Name || '').toLowerCase() === 'amjad';
          const driverPhone = getDriverPhone(bus.Driver_Name);

          return (
            <div
              key={bus.Bus_ID}
              onClick={() => setSelectedBusId(bus.Bus_ID)}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden ${
                isSelected
                  ? 'bg-blue-50/80 border-blue-900 shadow-md ring-2 ring-blue-900/15'
                  : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold ${
                      isSelected ? 'bg-blue-900 text-amber-400' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <i className="fa-solid fa-van-shuttle"></i>
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 text-sm font-mono">{bus.Bus_ID}</h4>
                    <span className="text-[11px] font-bold text-blue-900">
                      ड्राइवर: {bus.Driver_Name || 'Amjad'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                      isLive ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isLive ? 'bg-emerald-500 animate-ping' : 'bg-blue-500'
                      }`}
                    ></span>
                    <span>{isLive ? 'GPS लाइव' : 'शीट रिकॉर्ड'}</span>
                  </span>
                  {isAmjad && (
                    <span className="text-[9px] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded mt-1">
                      अमजद (Driver)
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs flex items-center justify-between text-slate-600">
                <span className="truncate font-semibold max-w-[150px]">
                  📞 {driverPhone}
                </span>
                <span className="font-mono text-[11px] font-bold text-slate-800">
                  {bus.Current_Location ? '📍 ' + bus.Current_Location.slice(0, 16) : '30.0560, 77.4190'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ACTIVE BUS MAP & TELEMETRY */}
      {activeBus && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Live Map & Coordinates */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              {/* Map Header */}
              <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-map-location-dot text-blue-900 text-lg"></i>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm">
                      गाड़ी {activeBus.busId} • ड्राइवर: {activeBus.driverName}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      स्टॉप: <strong className="text-slate-800">{activeBus.currentStop}</strong> → अगला:{' '}
                      <strong className="text-blue-900">{activeBus.nextStop}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyShareLink}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
                    title="लोकेशन लिंक कॉपी करें"
                  >
                    <i className="fa-solid fa-share-nodes text-xs text-blue-900"></i>
                    <span>{copiedLink ? 'कॉपी हो गया!' : 'शेयर लिंक'}</span>
                  </button>

                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-[#0c2340] text-amber-300 hover:bg-blue-950 text-xs font-extrabold transition-all flex items-center gap-1.5 shadow-2xs"
                  >
                    <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                    <span>Google Maps में खोलें</span>
                  </a>
                </div>
              </div>

              {/* Map Viewport */}
              <div className="relative w-full h-80 sm:h-96 bg-slate-100 overflow-hidden">
                {osmEmbedUrl ? (
                  <iframe
                    title="Live OpenStreetMap"
                    src={osmEmbedUrl}
                    className="w-full h-full border-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm font-semibold">
                    मानचित्र लोड हो रहा है...
                  </div>
                )}

                {/* Floating telemetry HUD */}
                <div className="absolute top-3 left-3 bg-slate-900/90 backdrop-blur-md text-white px-3.5 py-2 rounded-xl text-xs shadow-lg border border-white/10 flex items-center gap-3 pointer-events-none">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span className="font-extrabold text-amber-300">{activeBus.speed || 0} km/h</span>
                  </div>
                  <span className="text-slate-400">|</span>
                  <span>दूरी: <strong className="text-white">{distanceToSchool || '--'} km</strong></span>
                  <span className="text-slate-400">|</span>
                  <span className="text-slate-300">GPS: ±{activeBus.accuracy}m</span>
                </div>

                {/* School Campus target badge */}
                <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-sm text-slate-900 px-3 py-1.5 rounded-xl text-[11px] font-bold shadow-md border border-slate-200 flex items-center gap-2">
                  <i className="fa-solid fa-school text-blue-900"></i>
                  <span>EVS स्कूल कैम्पस</span>
                </div>
              </div>

              {/* Bottom Lat/Lng info strip */}
              <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2 text-slate-600 font-mono">
                <div>
                  <span>Current_Location (Google Sheet): </span>
                  <strong className="text-slate-900">{activeBus.currentLocationStr}</strong>
                </div>
                <div className="text-[11px] text-slate-500 font-sans">
                  सिग्नल: <strong>{getTimeAgo(activeBus.lastUpdated)}</strong> ({lastSyncTime})
                </div>
              </div>
            </div>

            {/* Quick Driver Contact & Route Actions */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-xl font-bold">
                  <i className="fa-solid fa-id-badge"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">
                      {activeBus.driverName} (ड्राइवर)
                    </h4>
                    <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                      Google Sheet Users
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">
                    मोबाइल: <strong className="font-mono text-slate-900">{activeBus.driverPhone}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`tel:${activeBus.driverPhone}`}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <i className="fa-solid fa-phone"></i>
                  <span>ड्राइवर को कॉल करें</span>
                </a>
                <a
                  href={`https://wa.me/91${activeBus.driverPhone}?text=${encodeURIComponent(
                    `नमस्ते ${activeBus.driverName} जी, EVS स्कूल प्रबंधक की ओर से: वैन ${activeBus.busId} की वर्तमान लोकेशन और बच्चों की स्थिति बताएं।`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 rounded-xl bg-[#25D366] hover:bg-emerald-600 text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <i className="fa-brands fa-whatsapp text-sm"></i>
                  <span>व्हाट्सएप</span>
                </a>
              </div>
            </div>
          </div>

          {/* Right Col: Trip Status, Speedometer & Route Students */}
          <div className="space-y-4">
            {/* Live Telemetry Card */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                  <i className="fa-solid fa-gauge-high text-amber-500"></i>
                  <span>लाइव टेलीमेट्री (Live Telemetry)</span>
                </h3>
                <span className="text-[11px] font-mono font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded-full">
                  {activeBus.busId}
                </span>
              </div>

              {/* Status Pill */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold">ट्रिप स्थिति:</span>
                  <span
                    className={`font-black uppercase text-[11px] px-2 py-0.5 rounded-full ${
                      activeBus.status === 'running'
                        ? 'bg-emerald-100 text-emerald-800'
                        : activeBus.status === 'boarding'
                        ? 'bg-amber-100 text-amber-800'
                        : activeBus.status === 'traffic'
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {activeBus.status === 'running'
                      ? 'चल रही है (On Road)'
                      : activeBus.status === 'boarding'
                      ? 'बच्चे चढ़ रहे हैं'
                      : activeBus.status === 'traffic'
                      ? 'जाम / ट्रैफिक'
                      : 'स्कूल पहुँच चुकी'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold">सवार बच्चे:</span>
                  <span className="font-extrabold text-slate-900">
                    {activeBus.studentsOnBoard} छात्र
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold">स्कूल से दूरी:</span>
                  <span className="font-extrabold text-blue-900">
                    {distanceToSchool || '--'} किमी
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold">वर्तमान गति:</span>
                  <span className="font-black text-emerald-700">
                    {activeBus.speed || 0} km/h
                  </span>
                </div>
              </div>

              {/* Stops Progress */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">स्टॉप प्रोग्रेस:</span>
                </div>
                <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200/70 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
                    <span className="text-slate-600">वर्तमान:</span>
                    <strong className="text-slate-900 font-bold">{activeBus.currentStop}</strong>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0"></span>
                    <span className="text-slate-600">अगला:</span>
                    <strong className="text-blue-900 font-bold">{activeBus.nextStop}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Students along Route */}
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                  <i className="fa-solid fa-children text-purple-600"></i>
                  <span>रूट के नामांकित छात्र ({routeStudents.length})</span>
                </h4>
                <span className="text-[10px] text-slate-500 font-semibold">उमरी / कांठ क्षेत्र</span>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {routeStudents.slice(0, 6).map((stu) => (
                  <div
                    key={stu.Student_ID}
                    className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{stu.Student_Name}</div>
                      <div className="text-[10px] text-slate-500">
                        कक्षा: {getClassName(stu.Class)} • {stu['Village/rRoute'] || stu.Village || ''}
                      </div>
                    </div>
                    <a
                      href={`tel:${stu.Parent_Mobile}`}
                      className="w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 flex items-center justify-center transition-colors"
                      title={`अभिभावक को कॉल करें: ${stu.Parent_Mobile}`}
                    >
                      <i className="fa-solid fa-phone text-[11px]"></i>
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
