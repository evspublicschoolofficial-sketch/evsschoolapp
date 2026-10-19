import React, { useState, useEffect } from 'react';
import {
  getActiveSchoolLocation,
  updateSchoolLocation,
  getPrewarmedLocation,
  calculateDistanceMeters,
  SchoolLocationConfig,
  LiveUserLocation,
} from '../utils/schoolLocationService';

interface SchoolLocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  isManager?: boolean;
  onLocationUpdated?: (config: SchoolLocationConfig) => void;
}

export const SchoolLocationModal: React.FC<SchoolLocationModalProps> = ({
  isOpen,
  onClose,
  isManager = false,
  onLocationUpdated,
}) => {
  const [currentConfig, setCurrentConfig] = useState<SchoolLocationConfig>(getActiveSchoolLocation());
  const [liveLocation, setLiveLocation] = useState<LiveUserLocation | null>(getPrewarmedLocation());
  const [isFetchingGps, setIsFetchingGps] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [customLat, setCustomLat] = useState<string>(String(currentConfig.lat));
  const [customLng, setCustomLng] = useState<string>(String(currentConfig.lng));
  const [selectedRadius, setSelectedRadius] = useState<number>(currentConfig.radiusMeters || 2500);
  const [geofenceEnabled, setGeofenceEnabled] = useState<boolean>(currentConfig.geofenceEnabled !== false);
  const [managerPin, setManagerPin] = useState<string>('');
  const [isUnlocked, setIsUnlocked] = useState<boolean>(isManager);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Sync state on open
  useEffect(() => {
    if (isOpen) {
      const active = getActiveSchoolLocation();
      setCurrentConfig(active);
      setCustomLat(String(active.lat));
      setCustomLng(String(active.lng));
      setSelectedRadius(active.radiusMeters || 2500);
      setGeofenceEnabled(active.geofenceEnabled !== false);
      setIsUnlocked(isManager);
      setSaveSuccess(false);
      fetchLiveDeviceGps();
    }
  }, [isOpen, isManager]);

  const fetchLiveDeviceGps = () => {
    if (!('geolocation' in navigator)) {
      setGpsError('डिवाइस में GPS समर्थित नहीं है');
      return;
    }
    setIsFetchingGps(true);
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsFetchingGps(false);
        const live: LiveUserLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy || 10),
          timestamp: Date.now(),
        };
        setLiveLocation(live);
      },
      (err) => {
        setIsFetchingGps(false);
        setGpsError(err.message || 'GPS लोकेशन प्राप्त करने में विफल');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const handleSetCurrentAsSchool = async () => {
    if (!liveLocation) {
      setIsFetchingGps(true);
      fetchLiveDeviceGps();
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateSchoolLocation({
        lat: liveLocation.lat,
        lng: liveLocation.lng,
        radiusMeters: selectedRadius,
        geofenceEnabled,
        name: 'E.V.S. Public School (Campus Verified)',
      }, isManager ? 'School Manager' : 'Staff GPS Calibration');

      setCurrentConfig(updated);
      setCustomLat(String(updated.lat));
      setCustomLng(String(updated.lng));
      setSaveSuccess(true);
      onLocationUpdated?.(updated);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1500);
    } catch (e) {
      alert('लोकेशन सेव करने में त्रुटि आई।');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCustomCoords = async () => {
    const lat = parseFloat(customLat);
    const lng = parseFloat(customLng);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('कृपया सही Latitude और Longitude दर्ज करें।');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateSchoolLocation({
        lat,
        lng,
        radiusMeters: selectedRadius,
        geofenceEnabled,
        name: 'E.V.S. Public School (Campus)',
      }, isManager ? 'School Manager' : 'Manager PIN Approved');

      setCurrentConfig(updated);
      setSaveSuccess(true);
      onLocationUpdated?.(updated);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 1500);
    } catch (e) {
      alert('लोकेशन सेव करने में त्रुटि आई।');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnlockWithPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (managerPin.trim() === '1234' || managerPin.trim().toLowerCase() === 'manager') {
      setIsUnlocked(true);
    } else {
      alert('गलत पिन! डिफ़ॉल्ट मैनेजर पिन 1234 है।');
    }
  };

  if (!isOpen) return null;

  // Calculate live distance from current school location
  const liveDistance = liveLocation
    ? calculateDistanceMeters(liveLocation.lat, liveLocation.lng, currentConfig.lat, currentConfig.lng)
    : null;

  const isInside = liveDistance !== null ? liveDistance <= (currentConfig.radiusMeters || 2500) : false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden w-full max-w-lg transition-all animate-fadeIn">
        {/* Header */}
        <div className="bg-[#0c2340] text-white p-4 sm:p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-lg shadow-md">
              <i className="fa-solid fa-location-dot"></i>
            </div>
            <div>
              <h3 className="font-black text-base sm:text-lg text-amber-300 flex items-center gap-2">
                <span>स्कूल GPS लोकेशन सेटिंग्स</span>
                <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/40">
                  कैंपस जियो-फेंस
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                स्टाफ अटेंडेंस व बस ट्रैकिंग के लिए स्कूल की लोकेशन
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-rose-600 text-white transition-colors cursor-pointer"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-4 max-h-[82vh] overflow-y-auto text-xs sm:text-sm">
          {/* Live Device Location Status Banner */}
          <div className={`p-4 rounded-2xl border-2 transition-all ${
            liveLocation
              ? isInside
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-slate-50 border-slate-300 text-slate-800'
          }`}>
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="font-black flex items-center gap-1.5 text-sm">
                  <i className={`fa-solid ${
                    isFetchingGps
                      ? 'fa-circle-notch fa-spin text-blue-600'
                      : liveLocation
                      ? isInside
                        ? 'fa-circle-check text-emerald-600'
                        : 'fa-triangle-exclamation text-amber-600'
                      : 'fa-location-crosshairs text-slate-500'
                  }`}></i>
                  <span>
                    {isFetchingGps
                      ? 'लाइव GPS प्राप्त किया जा रहा है...'
                      : liveLocation
                      ? isInside
                        ? '✅ आप स्कूल कैंपस के अंदर हैं'
                        : `⚠️ वर्तमान में स्कूल से ${liveDistance! > 1000 ? `${(liveDistance! / 1000).toFixed(2)} km` : `${liveDistance}m`} दूर`
                      : 'GPS स्थिति अज्ञात'}
                  </span>
                </div>
                {liveLocation && (
                  <div className="text-[11px] font-mono opacity-90 space-y-0.5">
                    <div>आपकी स्थिति: {liveLocation.lat.toFixed(6)}, {liveLocation.lng.toFixed(6)}</div>
                    <div>GPS सटीकता: ±{liveLocation.accuracy}m</div>
                  </div>
                )}
                {gpsError && (
                  <div className="text-[11px] text-rose-700 font-bold">{gpsError}</div>
                )}
              </div>

              <button
                type="button"
                onClick={fetchLiveDeviceGps}
                disabled={isFetchingGps}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-xs font-bold shrink-0 shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <i className={`fa-solid fa-arrows-rotate ${isFetchingGps ? 'fa-spin' : ''}`}></i>
                <span>रिफ्रेश</span>
              </button>
            </div>
          </div>

          {/* QUICK 1-CLICK SETTING: "SET CURRENT LOCATION AS SCHOOL GPS" */}
          <div className="bg-gradient-to-br from-blue-900 to-[#0c2340] text-white p-4 sm:p-5 rounded-2xl shadow-lg space-y-3">
            <div className="flex items-center gap-2 text-amber-300 font-black text-sm">
              <i className="fa-solid fa-crosshairs text-base"></i>
              <span>1-क्लिक में स्कूल लोकेशन सेट करें</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed">
              यदि आप इस समय स्कूल परिसर (School Gate/Campus) में उपस्थित हैं, तो नीचे का बटन दबाएं। आपकी वर्तमान लोकेशन तुरंत आधिकारिक स्कूल लोकेशन बन जाएगी और सभी स्टाफ की हाजिरी तुरंत चालू हो जाएगी!
            </p>

            <button
              type="button"
              onClick={handleSetCurrentAsSchool}
              disabled={isSaving || isFetchingGps}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-black text-sm shadow-xl flex items-center justify-center gap-2 cursor-pointer transition-all transform active:scale-98"
            >
              <i className="fa-solid fa-location-dot text-base"></i>
              <span>
                {isSaving ? 'सेव हो रहा है...' : '📍 मेरी वर्तमान लोकेशन को स्कूल लोकेशन सेट करें'}
              </span>
            </button>
          </div>

          {saveSuccess && (
            <div className="p-3 bg-emerald-100 border border-emerald-400 text-emerald-950 rounded-xl font-bold text-center text-xs animate-bounce">
              ✓ स्कूल GPS लोकेशन सफलतापूर्वक अपडेट हो गई!
            </div>
          )}

          {/* MANAGER PIN UNLOCK SECTION (FOR TEACHERS/STAFF IF LOCKED) */}
          {!isUnlocked && (
            <form onSubmit={handleUnlockWithPin} className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <div className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                <i className="fa-solid fa-lock text-amber-600"></i>
                <span>अग्रिम सेटिंग्स अनलॉक करने के लिए मैनेजर पिन दर्ज करें:</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  placeholder="मैनेजर पिन (डिफ़ॉल्ट: 1234)"
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  अनलॉक
                </button>
              </div>
            </form>
          )}

          {/* ADVANCED SETTINGS (Radius & Coordinates) */}
          {isUnlocked && (
            <div className="space-y-4 pt-2 border-t border-slate-200">
              {/* Allowed Radius Selector */}
              <div className="space-y-2">
                <label className="font-black text-slate-900 block text-xs">
                  हाजिरी हेतु मान्य कैंपस दायरा (Allowed Radius):
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {[500, 1000, 2500, 6000, 10000].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRadius(r)}
                      className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                        selectedRadius === r
                          ? 'bg-[#0c2340] text-amber-300 border-[#0c2340] shadow-sm'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">
                  सुझाव: स्कूल कैंपस और GPS इनडोर ड्रिफ्ट के लिए <strong>2.5 km या 6 km</strong> सबसे उपयुक्त है।
                </p>
              </div>

              {/* Strict Geofence Check Toggle */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900 text-xs">कैंपस लोकेशन अनिवार्यता (Geofence Enforced)</div>
                  <div className="text-[11px] text-slate-500">
                    {geofenceEnabled ? 'केवल स्कूल कैंपस के अंदर ही हाजिरी लगेगी' : 'लोकेशन जांच शिथिल (कमजोर GPS में भी हाजिरी मान्य)'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setGeofenceEnabled(!geofenceEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer p-0.5 ${
                    geofenceEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${
                      geofenceEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  ></div>
                </button>
              </div>

              {/* Manual Lat/Lng Coordinates Form */}
              <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
                <div className="font-bold text-slate-900 text-xs flex items-center justify-between">
                  <span>मैन्युअल निर्देशांक (Manual GPS Coordinates):</span>
                  <a
                    href={`https://www.google.com/maps?q=${currentConfig.lat},${currentConfig.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-[11px] flex items-center gap-1"
                  >
                    <i className="fa-solid fa-map-location-dot"></i>
                    <span>Maps पर देखें</span>
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-slate-600 block mb-1">Latitude (अक्षांश):</label>
                    <input
                      type="text"
                      value={customLat}
                      onChange={(e) => setCustomLat(e.target.value)}
                      placeholder="e.g. 30.056038"
                      className="w-full px-3 py-2 bg-white rounded-xl border border-slate-300 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-600 block mb-1">Longitude (देशांतर):</label>
                    <input
                      type="text"
                      value={customLng}
                      onChange={(e) => setCustomLng(e.target.value)}
                      placeholder="e.g. 77.419096"
                      className="w-full px-3 py-2 bg-white rounded-xl border border-slate-300 font-mono text-xs"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveCustomCoords}
                  disabled={isSaving}
                  className="w-full py-2.5 rounded-xl bg-[#0c2340] hover:bg-slate-900 text-white font-bold text-xs shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>{isSaving ? 'सहेजा जा रहा है...' : 'सेटिंग्स सुरक्षित करें (Save Config)'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>E.V.S. Public School Campus GPS System</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl font-bold cursor-pointer"
          >
            बंद करें
          </button>
        </div>
      </div>
    </div>
  );
};
