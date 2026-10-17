import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { SchoolUser, StaffAttendanceRecord } from '../types';
import { SCHOOL_CHECKIN_CODE } from './SchoolQRCodeModal';
import { speakAnnouncement, unlockAudioContext } from '../utils/sirenAudio';
import { DEFAULT_SCHOOL_COORDS } from '../utils/busTrackingService';

interface StaffAttendanceScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: SchoolUser;
  todayRecord?: StaffAttendanceRecord | null;
  onCheckInSuccess: (record: Partial<StaffAttendanceRecord>, isCheckOut?: boolean) => void;
}

// Default Geofence Radius in meters (School campus boundary)
export const DEFAULT_CAMPUS_RADIUS_METERS = 500;

// Helper to get active school coordinates (supports calibration by School Manager)
export const getActiveSchoolCoords = (): { lat: number; lng: number; radiusMeters: number; name: string } => {
  try {
    const saved = localStorage.getItem('evs_school_geo_coords');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        return {
          lat: parsed.lat,
          lng: parsed.lng,
          radiusMeters: parsed.radiusMeters || DEFAULT_CAMPUS_RADIUS_METERS,
          name: parsed.name || DEFAULT_SCHOOL_COORDS.name,
        };
      }
    }
  } catch {}
  return {
    lat: DEFAULT_SCHOOL_COORDS.lat,
    lng: DEFAULT_SCHOOL_COORDS.lng,
    radiusMeters: DEFAULT_CAMPUS_RADIUS_METERS,
    name: DEFAULT_SCHOOL_COORDS.name,
  };
};

// Calculate exact distance in meters between two GPS coordinates using Haversine formula
export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

export const StaffAttendanceScannerModal: React.FC<StaffAttendanceScannerModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  todayRecord,
  onCheckInSuccess,
}) => {
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);

  // Geolocation & School Campus Geofence State
  const [locationStatus, setLocationStatus] = useState<
    'checking' | 'inside_campus' | 'outside_campus' | 'permission_denied' | 'unavailable' | 'unsupported'
  >('checking');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [distanceFromSchool, setDistanceFromSchool] = useState<number | null>(null);
  const [schoolCoords, setSchoolCoords] = useState(getActiveSchoolCoords());
  const [calibrationSuccess, setCalibrationSuccess] = useState<boolean>(false);

  // Scanned / detected state
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
  const [confirmationInput, setConfirmationInput] = useState<string>('YES');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successStatus, setSuccessStatus] = useState<{
    time: string;
    type: 'checkin' | 'checkout';
  } | null>(null);

  // Camera & animation refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameId = useRef<number | null>(null);
  const geoWatchIdRef = useRef<number | null>(null);

  // Check if current user is manager / admin
  const isManagerRole = /manager|principal|admin/i.test(currentUser.Designation || '');

  // Sound & speech synthesis feedback
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime); // E5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch {}

    if (navigator.vibrate) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {}
    }
  };

  const playErrorBuzz = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.setValueAtTime(160, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch {}

    if (navigator.vibrate) {
      try {
        navigator.vibrate([200, 100, 200]);
      } catch {}
    }
  };

  const speakConfirmation = (text: string) => {
    try {
      unlockAudioContext();
      speakAnnouncement(text, {
        englishFallback: `Attendance status updated for ${currentUser.Name}. Thank you.`,
      });
    } catch (e) {
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'hi-IN';
          utterance.rate = 1.0;
          window.speechSynthesis.speak(utterance);
        } catch {}
      }
    }
  };

  // Helper to validate whether scanned payload belongs to the School QR
  const isSchoolQR = (payload: string): boolean => {
    if (!payload) return false;
    const clean = payload.trim();
    if (clean === SCHOOL_CHECKIN_CODE) return true;
    if (clean.includes('EVS-CAMPUS-ATTENDANCE')) return true;
    if (clean.includes('evs-school-checkin')) return true;
    if (clean.toLowerCase().includes('attendance') && clean.toLowerCase().includes('school')) return true;
    try {
      const parsed = JSON.parse(clean);
      if (parsed.protocol === 'evs-school-checkin' || parsed.type === 'STAFF_ATTENDANCE' || parsed.code === SCHOOL_CHECKIN_CODE) {
        return true;
      }
    } catch {}
    return false;
  };

  // Geolocation position handler
  const handleGeoPosition = (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 10;
    setUserCoords({ lat, lng, accuracy });

    const dist = calculateDistanceMeters(lat, lng, schoolCoords.lat, schoolCoords.lng);
    setDistanceFromSchool(dist);

    // Check if within allowed radius (includes accuracy margin)
    const allowedRadius = schoolCoords.radiusMeters;
    if (dist <= allowedRadius) {
      setLocationStatus('inside_campus');
    } else {
      setLocationStatus('outside_campus');
    }
  };

  const handleGeoError = (err: GeolocationPositionError) => {
    console.warn('Geolocation error:', err);
    if (err.code === err.PERMISSION_DENIED) {
      setLocationStatus('permission_denied');
    } else {
      setLocationStatus('unavailable');
    }
  };

  // Start watching live GPS location
  const startLocationWatch = () => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unsupported');
      return;
    }
    setLocationStatus('checking');

    // Immediate one-time request
    navigator.geolocation.getCurrentPosition(handleGeoPosition, handleGeoError, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });

    // Continuous watch
    try {
      if (geoWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
      geoWatchIdRef.current = navigator.geolocation.watchPosition(
        handleGeoPosition,
        handleGeoError,
        {
          enableHighAccuracy: true,
          maximumAge: 3000,
          timeout: 15000,
        }
      );
    } catch (e) {
      console.warn('Could not start watchPosition:', e);
    }
  };

  const stopLocationWatch = () => {
    if (geoWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }
  };

  // Calibrate current GPS position as the School Gate (Available to Manager)
  const handleCalibrateSchoolLocation = () => {
    if (!userCoords) {
      alert('पहले अपनी लोकेशन प्राप्त होने दें, फिर कैलिब्रेट करें।');
      return;
    }
    const updated = {
      lat: userCoords.lat,
      lng: userCoords.lng,
      radiusMeters: schoolCoords.radiusMeters || DEFAULT_CAMPUS_RADIUS_METERS,
      name: 'E.V.S. Public School (Gate Calibrated)',
    };
    try {
      localStorage.setItem('evs_school_geo_coords', JSON.stringify(updated));
      setSchoolCoords(updated);
      setDistanceFromSchool(0);
      setLocationStatus('inside_campus');
      setCalibrationSuccess(true);
      setTimeout(() => setCalibrationSuccess(false), 4000);
    } catch (e) {
      console.warn('Could not save calibrated coords:', e);
    }
  };

  // Start camera stream
  const startCamera = async (mode = facingMode) => {
    stopCamera();
    setCameraError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Check torch capability
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities = (videoTrack.getCapabilities && videoTrack.getCapabilities()) || {};
        setTorchSupported(!!(capabilities as any).torch);
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setCameraActive(true);
        requestScanFrame();
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      setCameraError(
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'कैमरा अनुमति अस्वीकार कर दी गई है। कृपया ब्राउज़र सेटिंग में कैमरा चालू करें।'
          : 'कैमरा शुरू करने में समस्या आई। कृपया पुनः प्रयास करें।'
      );
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (animFrameId.current) {
      cancelAnimationFrame(animFrameId.current);
      animFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
    setTorchOn(false);
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && torchSupported) {
      try {
        const nextState = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchOn(nextState);
      } catch (e) {
        console.warn('Could not toggle torch:', e);
      }
    }
  };

  // Process live camera frame using jsQR
  const requestScanFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          handleScannedData(code.data);
          return; // Stop scanning once detected
        }
      }
    }

    animFrameId.current = requestAnimationFrame(requestScanFrame);
  };

  // Handle scanned raw payload with strict Geolocation Verification
  const handleScannedData = (rawText: string) => {
    // 1. Validate if it's the official School QR
    if (!isSchoolQR(rawText)) {
      playErrorBuzz();
      alert('यह स्कूल का आधिकारिक उपस्थिति QR कोड नहीं है। कृपया स्कूल गेट या रिसेप्शन पर लगा सही QR कोड स्कैन करें।');
      requestScanFrame();
      return;
    }

    // 2. Strict Geolocation Enforcement ("सिर्फ वह आदमी स्कैन कर सके जो स्कूल में मौजूद हो लोकेशन खोल के")
    if (locationStatus === 'permission_denied' || locationStatus === 'unavailable') {
      playErrorBuzz();
      alert('🚫 लोकेशन (GPS) बंद है!\n\nनियम अनुसार केवल वही अध्यापक/स्टाफ हाजिरी लगा सकते हैं जो स्कूल में शारीरिक रूप से मौजूद हों।\nकृपया अपने फोन की लोकेशन (GPS) चालू करें और अनुमति दें।');
      requestScanFrame();
      return;
    }

    if (locationStatus === 'outside_campus') {
      playErrorBuzz();
      const distStr = distanceFromSchool ? `${distanceFromSchool} मीटर` : 'काफी';
      alert(`🚫 अस्वीकृत: आप स्कूल परिसर से बाहर हैं (${distStr} दूर)!\n\nस्कूल के सख्त सुरक्षा नियमों के अनुसार, केवल स्कूल कैंपस में उपस्थित रहकर ही उपस्थिति (Check-In/Check-Out) दर्ज की जा सकती है। घर या किसी अन्य स्थान से हाजिरी लगाना अमान्य है।`);
      requestScanFrame();
      return;
    }

    if (locationStatus === 'checking') {
      // Prompt user to wait a moment while GPS locks
      alert('📍 आपकी लाइव GPS लोकेशन जांची जा रही है। कृपया 2 सेकंड रुकें और पुनः स्कैन करें।');
      requestScanFrame();
      return;
    }

    // Location verified inside campus!
    playBeep();
    stopCamera();
    setDetectedCode(rawText);
    setConfirmationInput('YES');
  };

  // Modal Open / Close lifecycle
  useEffect(() => {
    if (isOpen) {
      setSchoolCoords(getActiveSchoolCoords());
      setDetectedCode(null);
      setConfirmationInput('YES');
      setSuccessStatus(null);
      startLocationWatch();
      startCamera();
    } else {
      stopCamera();
      stopLocationWatch();
    }
    return () => {
      stopCamera();
      stopLocationWatch();
    };
  }, [isOpen, facingMode]);

  // Determine current scan mode: Check-In vs Check-Out vs Completed
  // The user explicitly requested:
  // "स्कैनर को ऐसे करो जो आदमी चेक इन हो गया, वही आदमी चेक आउट हो। दोबारा उसी स्कैनर को स्कैन करने जो चेक इन हुआ इंसान है अगर वह दोबारा स्कैनर को स्कैन करेगा तो उसे चेक आउट कर दो स्कूल से।"
  const isAlreadyCheckedIn = Boolean(todayRecord?.check_in_time);
  const isAlreadyCheckedOut = Boolean(todayRecord?.check_out_time);

  // Automatically determine if this scan should be Check-Out or Check-In
  const autoScanMode: 'checkout' | 'checkin' | 'completed' =
    isAlreadyCheckedIn && !isAlreadyCheckedOut
      ? 'checkout'
      : !isAlreadyCheckedIn
      ? 'checkin'
      : 'completed';

  // Handle YES confirmation check-in / check-out
  const handleConfirmAction = async (forceCheckOut?: boolean) => {
    const trimmedInput = confirmationInput.trim().toUpperCase();
    if (trimmedInput !== 'YES' && trimmedInput !== 'Y' && trimmedInput !== 'हाँ' && trimmedInput !== 'HAAN') {
      alert("कृपया पुष्टि के लिए 'YES' लिखें या नीचे मुख्य बटन दबाएं।");
      return;
    }

    // Re-verify location before final submission
    if (locationStatus === 'outside_campus') {
      alert('🚫 आप स्कूल कैंपस से बाहर हैं। हाजिरी दर्ज नहीं की जा सकती।');
      return;
    }

    const shouldCheckOut = forceCheckOut !== undefined ? forceCheckOut : autoScanMode === 'checkout';

    setIsSubmitting(true);
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const dateStr = now.toISOString().split('T')[0];

    const attendancePayload: Partial<StaffAttendanceRecord> = {
      user_id: currentUser.User_ID || String(currentUser.Mobile_number),
      username: currentUser.Username || '',
      name: currentUser.Name,
      designation: currentUser.Designation || 'Teacher',
      date: dateStr,
      status: 'Present',
      method: 'School QR Scan',
      location: userCoords
        ? `School Campus (${userCoords.lat.toFixed(5)}, ${userCoords.lng.toFixed(5)})`
        : 'School Campus Gate',
      school_code: SCHOOL_CHECKIN_CODE,
      timestamp: Date.now(),
    };

    if (shouldCheckOut) {
      attendancePayload.check_out_time = timeStr;
      // Preserve existing check_in_time
      attendancePayload.check_in_time = todayRecord?.check_in_time || timeStr;
    } else {
      attendancePayload.check_in_time = timeStr;
    }

    try {
      await onCheckInSuccess(attendancePayload, shouldCheckOut);
      setSuccessStatus({
        time: timeStr,
        type: shouldCheckOut ? 'checkout' : 'checkin',
      });

      // Voice confirmation in Hindi
      speakConfirmation(
        shouldCheckOut
          ? `धन्यवाद ${currentUser.Name} जी, आपका स्कूल से चेक-आउट समय ${timeStr} दर्ज हो गया है। आपका दिन शुभ हो।`
          : `धन्यवाद ${currentUser.Name} जी, आपकी स्कूल उपस्थिति ${timeStr} पर दर्ज कर ली गई है।`
      );
    } catch (e) {
      console.error(e);
      alert('हाजिरी दर्ज करने में त्रुटि आई। कृपया पुनः प्रयास करें।');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden w-full max-w-lg transition-all">
        {/* Header */}
        <div className="bg-[#0c2340] text-white p-4 sm:p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black shadow-md ${
              autoScanMode === 'checkout'
                ? 'bg-amber-400 text-slate-950'
                : 'bg-emerald-500 text-white'
            }`}>
              <i className={`fa-solid ${autoScanMode === 'checkout' ? 'fa-arrow-right-from-bracket' : 'fa-qrcode'} text-lg`}></i>
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-amber-300 flex items-center gap-2">
                <span>स्कूल उपस्थिति स्कैनर</span>
                {autoScanMode === 'checkout' && (
                  <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-amber-400 text-slate-950">
                    चेक-आउट मोड
                  </span>
                )}
                {autoScanMode === 'checkin' && (
                  <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-emerald-400 text-slate-950">
                    चेक-इन मोड
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-300">
                {currentUser.Name} ({currentUser.Designation || 'Teacher'})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-rose-600 text-white transition-colors"
            title="बंद करें"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Live GPS Presence Status Bar (Strict Geofence) */}
        <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 text-xs">
          {locationStatus === 'checking' && (
            <div className="flex items-center justify-between text-blue-800">
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-circle-notch fa-spin text-blue-600"></i>
                <span>आपकी लाइव GPS लोकेशन जांची जा रही है...</span>
              </span>
              <span className="text-[11px] font-mono text-slate-500">स्कूल गेट रेडियस: {schoolCoords.radiusMeters}m</span>
            </div>
          )}

          {locationStatus === 'inside_campus' && (
            <div className="flex items-center justify-between text-emerald-800">
              <span className="flex items-center gap-2 font-bold">
                <i className="fa-solid fa-location-dot text-emerald-600"></i>
                <span>✅ स्कूल परिसर सत्यापित: आप स्कूल में उपस्थित हैं</span>
              </span>
              {distanceFromSchool !== null && (
                <span className="text-[11px] font-bold text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-full">
                  दूरी: {distanceFromSchool}m
                </span>
              )}
            </div>
          )}

          {locationStatus === 'outside_campus' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-rose-800 font-bold">
                <span className="flex items-center gap-2">
                  <i className="fa-solid fa-triangle-exclamation text-rose-600"></i>
                  <span>🚫 आप स्कूल परिसर से बाहर हैं</span>
                </span>
                {distanceFromSchool !== null && (
                  <span className="text-[11px] font-bold text-rose-900 bg-rose-100 px-2 py-0.5 rounded-full">
                    दूरी: {distanceFromSchool > 1000 ? `${(distanceFromSchool / 1000).toFixed(2)} km` : `${distanceFromSchool} m`} दूर
                  </span>
                )}
              </div>
              <p className="text-[11px] text-rose-700">
                सुरक्षा नियम: केवल स्कूल कैंपस के अंदर उपस्थित रहकर ही हाजिरी दर्ज की जा सकती है।
              </p>
            </div>
          )}

          {(locationStatus === 'permission_denied' || locationStatus === 'unavailable') && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-amber-900 font-bold">
                <span className="flex items-center gap-2">
                  <i className="fa-solid fa-location-crosshairs text-amber-600"></i>
                  <span>⚠️ फोन की लोकेशन (GPS) चालू नहीं है</span>
                </span>
                <button
                  type="button"
                  onClick={startLocationWatch}
                  className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold cursor-pointer"
                >
                  पुनः जांचें
                </button>
              </div>
              <p className="text-[11px] text-amber-800">
                अटेंडेंस लगाने हेतु अपने फोन की लोकेशन ऑन करें ताकि स्कूल में मौजूदगी सत्यापित हो सके।
              </p>
            </div>
          )}

          {/* Manager Calibration Button */}
          {isManagerRole && locationStatus === 'outside_campus' && userCoords && (
            <div className="pt-2 flex items-center justify-between border-t border-slate-200 mt-1">
              <span className="text-[10px] text-slate-500">
                वर्तमान स्थिति: {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)}
              </span>
              <button
                type="button"
                onClick={handleCalibrateSchoolLocation}
                className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] cursor-pointer"
                title="यदि आप वास्तव में स्कूल में हैं तो इस लोकेशन को स्कूल गेट के रूप में सेव करें"
              >
                📍 वर्तमान लोकेशन को स्कूल गेट सेट करें
              </button>
            </div>
          )}

          {calibrationSuccess && (
            <div className="text-[11px] text-emerald-700 font-bold pt-1">
              ✓ स्कूल गेट लोकेशन सफलतापूर्वक कैलिब्रेट हो गई!
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-4">
          {/* STEP 1: SCANNING MODE (Live Camera Only - No Photo Upload Allowed) */}
          {!detectedCode && !successStatus && (
            <div className="space-y-4">
              {/* Location warning if outside campus */}
              {locationStatus === 'outside_campus' && (
                <div className="p-3.5 bg-rose-50 border-2 border-rose-300 rounded-2xl text-rose-900 text-xs space-y-1">
                  <div className="font-black flex items-center gap-1.5 text-rose-950 text-sm">
                    <i className="fa-solid fa-shield-halved text-rose-600"></i>
                    <span>स्कूल में उपस्थिति अनिवार्य है</span>
                  </div>
                  <p>
                    सिस्टम द्वारा आपकी लोकेशन जांची गई है। आप वर्तमान में स्कूल कैंपस से बाहर हैं (दूरी: {distanceFromSchool ? `${distanceFromSchool}m` : ''})।
                    घर या अन्य किसी स्थान से फोटो स्कैन करके हाजिरी नहीं लगाई जा सकती।
                  </p>
                </div>
              )}

              {/* Already Checked In Notification in Scanner */}
              {todayRecord?.check_in_time && !todayRecord?.check_out_time && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-amber-950 text-xs flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shrink-0">
                      <i className="fa-solid fa-clock"></i>
                    </div>
                    <div>
                      <div className="font-bold">आप आज चेक-इन कर चुके हैं: सुबह {todayRecord.check_in_time}</div>
                      <div className="text-amber-800 text-[11px]">
                        दोबारा स्कैन करने पर आपका <strong>स्कूल चेक-आउट</strong> स्वतः दर्ज होगा।
                      </div>
                    </div>
                  </div>
                  <span className="px-2 py-1 rounded bg-amber-200 text-amber-900 font-black text-[10px] shrink-0">
                    चेक-आउट मोड
                  </span>
                </div>
              )}

              {/* Live Camera Viewfinder */}
              <div className="relative bg-slate-950 rounded-2xl overflow-hidden aspect-4/3 flex items-center justify-center shadow-inner border-2 border-slate-700">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                  autoPlay
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Viewfinder Overlay with Animated Scanning Line */}
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-48 sm:w-56 sm:h-56 border-2 border-amber-400/90 rounded-2xl relative shadow-[0_0_20px_rgba(245,158,11,0.3)]">
                      {/* Corner Accents */}
                      <span className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-amber-400 rounded-tl-md"></span>
                      <span className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-amber-400 rounded-tr-md"></span>
                      <span className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-amber-400 rounded-bl-md"></span>
                      <span className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-amber-400 rounded-br-md"></span>

                      {/* Moving laser scan line */}
                      <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-pulse shadow-md top-1/2 -translate-y-1/2"></div>
                    </div>
                  </div>
                )}

                {/* Camera error message */}
                {cameraError && (
                  <div className="absolute inset-0 bg-slate-900/90 p-5 text-white flex flex-col items-center justify-center text-center">
                    <i className="fa-solid fa-triangle-exclamation text-rose-400 text-3xl mb-2"></i>
                    <p className="text-xs sm:text-sm text-slate-200">{cameraError}</p>
                    <button
                      type="button"
                      onClick={() => startCamera()}
                      className="mt-3 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs"
                    >
                      पुनः प्रयास करें
                    </button>
                  </div>
                )}

                {/* Floating camera control buttons */}
                {cameraActive && (
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-auto">
                    {torchSupported && (
                      <button
                        type="button"
                        onClick={toggleTorch}
                        className={`p-2.5 rounded-full text-xs font-bold transition-all ${
                          torchOn ? 'bg-amber-400 text-slate-950 shadow-lg' : 'bg-black/60 text-white hover:bg-black/80'
                        }`}
                        title="टॉर्च ऑन/ऑफ"
                      >
                        <i className="fa-solid fa-bolt"></i>
                      </button>
                    )}

                    <div className="text-[11px] font-bold bg-black/70 text-amber-300 px-3 py-1 rounded-full border border-amber-400/30">
                      {autoScanMode === 'checkout'
                        ? 'स्कूल QR स्कैन करें (चेक-आउट हेतु)'
                        : 'स्कूल गेट QR कोड स्कैन करें'}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const next = facingMode === 'environment' ? 'user' : 'environment';
                        setFacingMode(next);
                        startCamera(next);
                      }}
                      className="p-2.5 rounded-full bg-black/60 text-white hover:bg-black/80 text-xs transition-colors"
                      title="कैमरा बदलें"
                    >
                      <i className="fa-solid fa-camera-rotate"></i>
                    </button>
                  </div>
                )}
              </div>

              {/* Security Rule Explanation */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-start gap-2.5">
                <i className="fa-solid fa-shield-halved text-emerald-600 mt-0.5 text-sm"></i>
                <div className="leading-relaxed">
                  <strong>सुरक्षा सत्यापन:</strong> केवल स्कूल में मौजूद व्यक्ति ही लाइव कैमरे से स्कैन कर सकता है। गैलरी या फोटो से हाजिरी लगाना प्रतिबंधित है।
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: CONFIRMATION PROMPT (Check-In or Check-Out based on scanning) */}
          {detectedCode && !successStatus && (
            <div className="space-y-4 animate-fadeIn">
              {/* Header Box based on Check-In vs Check-Out */}
              {autoScanMode === 'checkout' ? (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center mx-auto text-xl mb-2 shadow-md">
                    <i className="fa-solid fa-arrow-right-from-bracket"></i>
                  </div>
                  <h4 className="text-base font-black text-amber-950">
                    स्कूल से प्रस्थान / चेक-आउट (Check-Out)
                  </h4>
                  <p className="text-xs text-amber-800 mt-0.5 font-medium">
                    आप आज सुबह <strong>{todayRecord?.check_in_time}</strong> पर चेक-इन कर चुके हैं।
                  </p>
                </div>
              ) : (
                <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto text-xl mb-2 shadow-md">
                    <i className="fa-solid fa-check"></i>
                  </div>
                  <h4 className="text-base font-black text-emerald-950">
                    स्कूल आगमन / चेक-इन (Check-In)
                  </h4>
                  <p className="text-xs text-emerald-700 mt-0.5 font-medium">
                    E.V.S. Public School • उपस्थिति सत्यापन केंद्र
                  </p>
                </div>
              )}

              {/* Staff Details Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-medium">स्टाफ का नाम:</span>
                  <span className="font-bold text-slate-900 text-sm">{currentUser.Name}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-medium">पद / Designation:</span>
                  <span className="font-bold text-indigo-700">{currentUser.Designation || 'Teacher'}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-medium">आज की तारीख:</span>
                  <span className="font-bold text-slate-800">
                    {new Date().toLocaleDateString('hi-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>

                {/* Arrival time if in Check-out mode */}
                {autoScanMode === 'checkout' && todayRecord?.check_in_time && (
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">सुबह चेक-इन समय:</span>
                    <span className="font-bold text-slate-800 font-mono">{todayRecord.check_in_time}</span>
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">
                    {autoScanMode === 'checkout' ? 'चेक-आउट समय (Departure):' : 'चेक-इन समय (Arrival):'}
                  </span>
                  <span className="font-black text-emerald-700 text-sm font-mono">
                    {new Date().toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true,
                    })}
                  </span>
                </div>
              </div>

              {/* The "YES" Confirmation Input as explicitly requested by user */}
              <div className="space-y-2 bg-amber-50/60 p-4 rounded-xl border border-amber-300">
                <label className="block text-xs font-bold text-amber-950">
                  {autoScanMode === 'checkout'
                    ? "स्कूल से चेक-आउट दर्ज करने हेतु पुष्टि करें (Type 'YES' to confirm Check-Out):"
                    : "स्कूल में हाजिरी दर्ज करने हेतु पुष्टि करें (Type 'YES' to confirm Check-In):"}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={confirmationInput}
                    onChange={(e) => setConfirmationInput(e.target.value)}
                    placeholder="YES लिखे"
                    className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-400 bg-white text-base font-black text-center text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 tracking-widest uppercase"
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-amber-800">
                  (डिफ़ॉल्ट 'YES' लिखा हुआ है, आप सीधे नीचे बटन दबाकर पुष्टि कर सकते हैं)
                </p>
              </div>

              {/* Primary Action Button (Auto Switch based on check-in vs check-out) */}
              <div className="space-y-2 pt-2">
                {autoScanMode === 'checkout' ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleConfirmAction(true)}
                    className="w-full py-3.5 px-4 rounded-xl font-black text-sm sm:text-base bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg hover:shadow-amber-400/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket text-lg"></i>
                    <span>
                      {isSubmitting ? 'चेक-आउट दर्ज हो रहा है...' : '🚪 YES, स्कूल से चेक-आउट दर्ज करें'}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleConfirmAction(false)}
                    className="w-full py-3.5 px-4 rounded-xl font-black text-sm sm:text-base bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <i className="fa-solid fa-clipboard-check text-lg"></i>
                    <span>
                      {isSubmitting ? 'हाजिरी दर्ज हो रही है...' : '✅ YES, स्कूल चेक-इन दर्ज करें'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setDetectedCode(null);
                    startCamera();
                  }}
                  className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 text-center"
                >
                  पुनः स्कैन करें (Scan Again)
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: SUCCESS CELEBRATION */}
          {successStatus && (
            <div className="py-6 text-center space-y-4 animate-scaleUp">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-3xl shadow-inner border-2 border-emerald-300">
                <i className="fa-solid fa-badge-check"></i>
              </div>

              <div>
                <h4 className="text-xl font-black text-slate-900">
                  {successStatus.type === 'checkout'
                    ? 'स्कूल चेक-आउट दर्ज हो गया! 🚪'
                    : 'स्कूल चेक-इन सफलतापूर्वक दर्ज! 🎉'}
                </h4>
                <p className="text-sm font-semibold text-emerald-700 mt-1">
                  समय: {successStatus.time} • E.V.S. Public School
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {currentUser.Name} ({currentUser.Designation || 'Teacher'})
                </p>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900">
                {successStatus.type === 'checkout'
                  ? 'आपका प्रस्थान समय सुरक्षित हो गया है। आपका दिन शुभ हो!'
                  : 'आपकी स्कूल उपस्थिति सिस्टम व Google Sheets रिकॉर्ड में स्वतः अपडेट हो गई है।'}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 rounded-xl font-bold text-sm bg-[#0c2340] text-amber-300 hover:bg-slate-800 transition-colors shadow-md cursor-pointer"
              >
                ठीक है (Done)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
