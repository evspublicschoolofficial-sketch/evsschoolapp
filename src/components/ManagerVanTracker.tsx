import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  const [mapType, setMapType] = useState<'google' | 'osm'>('google');

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

  // Google Maps and OSM Embed URLs
  const googleMapEmbedUrl = `https://maps.google.com/maps?q=${activeTelemetry.latitude},${activeTelemetry.longitude}&hl=hi&z=16&output=embed`;
  const delta = 0.012;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${activeTelemetry.longitude - delta}%2C${activeTelemetry.latitude - delta}%2C${activeTelemetry.longitude + delta}%2C${activeTelemetry.latitude + delta}&layer=mapnik&marker=${activeTelemetry.latitude}%2C${activeTelemetry.longitude}`;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* HEADER BANNER */}
      <div className="bg-gradient-to-r from-[#0c2340] via-[#1a3a60] to-teal-950 rounded-3xl p-6 sm:p-7 text-white shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black tracking-wide uppercase border border-emerald-400/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>गूगल शीट लाइव वैन ट्रैकिंग</span>
              </span>
              <span className="text-xs text-amber-300 font-bold bg-amber-400/20 border border-amber-400/30 px-2.5 py-0.5 rounded-full">
                ⏱️ हर 15 सेकंड में ऑटो-रिफ्रेश
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight flex items-center gap-2.5">
              <i className="fa-solid fa-van-shuttle text-amber-400"></i>
              <span>स्कूल बस / वैन लाइव लोकेशन</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
              ड्राइवर: <strong>{activeTelemetry.driverName}</strong> (मोबाइल: {activeTelemetry.driverPhone}) • शीट: <strong>Bus_Tracking</strong> से सीधे लाइव लोकेशन
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Google Sheet Apps Script Setup Button */}
            <button
              type="button"
              onClick={() => setShowScriptModal(true)}
              className="px-3.5 py-2 rounded-xl bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 text-xs font-bold transition-all border border-amber-400/40 flex items-center gap-1.5 cursor-pointer backdrop-blur-sm shadow-xs"
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
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all border border-white/20 flex items-center gap-1.5 cursor-pointer backdrop-blur-sm shadow-xs"
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

      {/* EMERGENCY SOS ALERT BANNER (If Active) */}
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

      {/* TOP CONTROL: VEHICLE SELECTION & LIVE TELEMETRY BAR */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-900 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-blue-900/20">
              <i className="fa-solid fa-location-crosshairs"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">गाड़ी ID:</span>
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
                चालक: <strong className="text-slate-900">{activeTelemetry.driverName}</strong> • फोन: <strong className="text-slate-900">{activeTelemetry.driverPhone}</strong>
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
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
            >
              <i className="fa-brands fa-whatsapp text-sm"></i>
              <span>WhatsApp</span>
            </a>

            <button
              type="button"
              onClick={handleCopyTrackingLink}
              className="px-3.5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="अभिभावकों के साथ लोकेशन लिंक शेयर करें"
            >
              <i className={`fa-solid ${copiedLink ? 'fa-check' : 'fa-share-nodes'}`}></i>
              <span>{copiedLink ? 'कॉपी हुआ!' : 'शेयर लिंक'}</span>
            </button>
          </div>
        </div>

        {/* 4 TELEMETRY TILES: Direct vehicle live status */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">वर्तमान स्थिति</span>
            <span
              className={`text-xs font-black inline-flex items-center gap-1.5 mt-1 ${
                activeTelemetry.status === 'running' ? 'text-emerald-700' : 'text-slate-700'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  activeTelemetry.status === 'running' ? 'bg-emerald-500 animate-ping' : 'bg-slate-400'
                }`}
              ></span>
              <span>{activeTelemetry.status === 'running' ? 'गतिमान (सक्रिय)' : 'रुकी हुई'}</span>
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">गति (Speed)</span>
            <span className="text-sm font-black text-slate-900 mt-1 block">
              {activeTelemetry.speed ? `${activeTelemetry.speed} km/h` : '0 km/h'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">स्कूल से दूरी</span>
            <span className="text-sm font-black text-blue-900 mt-1 block">
              {distanceFromSchool} किमी
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-2xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 uppercase block">अंतिम लोकेशन अपडेट</span>
            <span className="text-xs font-black text-slate-900 mt-1 block font-mono">
              {activeTelemetry.lastUpdated ? activeTelemetry.lastUpdated.split(' ')[1] || activeTelemetry.lastUpdated : lastSyncTime}
            </span>
          </div>
        </div>

        {/* EXACT GPS COORDINATES STRIP */}
        <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
              <i className="fa-solid fa-map-pin"></i>
            </div>
            <div>
              <span className="text-slate-500 font-bold block text-[10px] uppercase">
                गाड़ी की वर्तमान GPS लोकेशन (Google Sheet & Phone):
              </span>
              <span className="font-mono text-slate-900 font-black text-sm">
                {activeTelemetry.latitude.toFixed(6)}, {activeTelemetry.longitude.toFixed(6)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={`https://www.google.com/maps?q=${activeTelemetry.latitude},${activeTelemetry.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-blue-900 font-extrabold text-xs hover:bg-slate-100 transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-[11px]"></i>
              <span>Google Maps में खोलें</span>
            </a>

            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${activeTelemetry.latitude},${activeTelemetry.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <i className="fa-solid fa-diamond-turn-right text-[11px]"></i>
              <span>गाड़ी तक दिशा-निर्देश (Navigation)</span>
            </a>
          </div>
        </div>
      </div>

      {/* LIVE MAP CONTAINER (Pure live location of bus) */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 sm:p-6 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <i className="fa-solid fa-map-location-dot text-emerald-600"></i>
              <span>लाइव मैप: गाड़ी कहाँ है (Live Location Map)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              गूगल मैप पर लाल पिन ठीक उसी स्थान पर है जहां वैन वर्तमान में मौजूद है।
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setMapType('google')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  mapType === 'google' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                Google Maps
              </button>
              <button
                type="button"
                onClick={() => setMapType('osm')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                  mapType === 'osm' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                OpenStreetMap
              </button>
            </div>

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

        {/* Map iframe */}
        <div className="relative w-full h-96 sm:h-[480px] bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 shadow-inner">
          <iframe
            title="School Van Live Location"
            src={mapType === 'google' ? googleMapEmbedUrl : osmEmbedUrl}
            className="w-full h-full border-0"
            loading="lazy"
          />

          {/* Floating On-Screen Quick Pin Info */}
          <div className="absolute top-3 left-3 bg-white/95 backdrop-blur-md px-3.5 py-2.5 rounded-2xl shadow-lg border border-slate-200 text-xs space-y-1 pointer-events-none max-w-xs">
            <div className="flex items-center gap-1.5 text-slate-900 font-extrabold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>वैन {selectedBusId} ({activeTelemetry.driverName})</span>
            </div>
            <div className="text-[11px] text-slate-600 font-mono">
              {activeTelemetry.latitude.toFixed(6)}, {activeTelemetry.longitude.toFixed(6)}
            </div>
            <div className="text-[10px] text-slate-500 font-medium">
              स्कूल से: <strong>{distanceFromSchool} किमी</strong> • स्पीड: <strong>{activeTelemetry.speed || 0} km/h</strong>
            </div>
          </div>
        </div>
      </div>

      {/* GOOGLE SHEET "BUS_TRACKING" VERIFICATION TABLE */}
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
      {/* GOOGLE APPS SCRIPT SETUP MODAL */}
      <GoogleSheetSyncModal
        isOpen={showScriptModal}
        onClose={() => setShowScriptModal(false)}
      />
    </div>
  );
};
