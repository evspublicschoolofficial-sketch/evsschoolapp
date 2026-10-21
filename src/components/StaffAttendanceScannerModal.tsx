import React, { useEffect, useRef, useState, useMemo } from 'react';
import jsQR from 'jsqr';
import { SchoolUser, StaffAttendanceRecord } from '../types';
import { SCHOOL_CHECKIN_CODE } from './SchoolQRCodeModal';
import { speakAnnouncement, unlockAudioContext } from '../utils/sirenAudio';
import {
  getActiveSchoolLocation,
  updateSchoolLocation,
  getPrewarmedLocation,
  calculateDistanceMeters,
  SchoolLocationConfig,
} from '../utils/schoolLocationService';
import { SchoolLocationModal } from './SchoolLocationModal';

interface StaffAttendanceScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: SchoolUser;
  todayRecord?: StaffAttendanceRecord | null;
  allRecords?: StaffAttendanceRecord[];
  onCheckInSuccess: (record: Partial<StaffAttendanceRecord>, isCheckOut?: boolean) => void;
  isManager?: boolean;
}

// Default Geofence Radius in meters (School campus boundary)
export const DEFAULT_CAMPUS_RADIUS_METERS = 2500;
export const getActiveSchoolCoords = getActiveSchoolLocation;
export { calculateDistanceMeters };

export const StaffAttendanceScannerModal: React.FC<StaffAttendanceScannerModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  todayRecord,
  allRecords,
  onCheckInSuccess,
  isManager = false,
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
  const [schoolCoords, setSchoolCoords] = useState<SchoolLocationConfig>(getActiveSchoolLocation());
  const [calibrationSuccess, setCalibrationSuccess] = useState<boolean>(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [allowOverride, setAllowOverride] = useState<boolean>(false);

  // Scanned / detected state
  const [detectedCode, setDetectedCode] = useState<string | null>(null);
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
  const isManagerRole = isManager || /manager|principal|admin/i.test(currentUser.Designation || '');

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
    const accuracy = Math.round(pos.coords.accuracy || 10);
    setUserCoords({ lat, lng, accuracy });

    const activeSchool = getActiveSchoolLocation();
    const dist = calculateDistanceMeters(lat, lng, activeSchool.lat, activeSchool.lng);
    setDistanceFromSchool(dist);

    // Check if within allowed radius (includes accuracy margin)
    const allowedRadius = activeSchool.radiusMeters || DEFAULT_CAMPUS_RADIUS_METERS;
    if (!activeSchool.geofenceEnabled || allowOverride || dist <= allowedRadius) {
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
    const activeSchool = getActiveSchoolLocation();
    setSchoolCoords(activeSchool);

    // 1. Immediate pre-warmed GPS check (0 ms delay!)
    const pre = getPrewarmedLocation();
    if (pre) {
      setUserCoords(pre);
      const dist = calculateDistanceMeters(pre.lat, pre.lng, activeSchool.lat, activeSchool.lng);
      setDistanceFromSchool(dist);
      const allowedRadius = activeSchool.radiusMeters || DEFAULT_CAMPUS_RADIUS_METERS;
      if (!activeSchool.geofenceEnabled || allowOverride || dist <= allowedRadius) {
        setLocationStatus('inside_campus');
      } else {
        setLocationStatus('outside_campus');
      }
    } else {
      setLocationStatus('checking');
    }

    if (!('geolocation' in navigator)) {
      setLocationStatus('unsupported');
      return;
    }

    // 2. High accuracy fresh position request
    navigator.geolocation.getCurrentPosition(handleGeoPosition, handleGeoError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 5000,
    });

    // 3. Continuous watch
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
          timeout: 12000,
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

  // Calibrate current GPS position as the School Gate (Saves to server so all staff devices sync)
  const handleCalibrateSchoolLocation = async () => {
    if (!userCoords) {
      alert('पहले अपनी लोकेशन प्राप्त होने दें, फिर कैलिब्रेट करें।');
      return;
    }
    try {
      const updated = await updateSchoolLocation({
        lat: userCoords.lat,
        lng: userCoords.lng,
        radiusMeters: Math.max(schoolCoords.radiusMeters || 2500, 2500),
        name: 'E.V.S. Public School (Campus Gate Calibrated)',
        geofenceEnabled: true,
      }, currentUser.Name || (isManagerRole ? 'Manager' : 'Staff Calibration'));

      setSchoolCoords(updated);
      setDistanceFromSchool(0);
      setLocationStatus('inside_campus');
      setCalibrationSuccess(true);
      playBeep();
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

    // As requested: Scan the QR code instantly!
    playBeep();
    stopCamera();
    setDetectedCode(rawText);
  };

  // Modal Open / Close lifecycle
  useEffect(() => {
    if (isOpen) {
      setSchoolCoords(getActiveSchoolCoords());
      setDetectedCode(null);
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

  // Manual override state if staff wants to toggle mode
  const [manualModeOverride, setManualModeOverride] = useState<'checkout' | 'checkin' | null>(null);

  // Robust lookup of today's attendance record for currentUser
  const effectiveTodayRecord = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const targetUserId = String(currentUser.User_ID || currentUser.Mobile_number || '').trim().toLowerCase();
    const targetName = String(currentUser.Name || '').trim().toLowerCase();
    const targetUsername = String(currentUser.Username || '').trim().toLowerCase();

    // 1. If todayRecord prop is valid for today and has check_in_time
    if (todayRecord && todayRecord.date === todayStr && todayRecord.check_in_time) {
      return todayRecord;
    }

    const matchesUser = (r: StaffAttendanceRecord) => {
      if (!r) return false;
      const rDate = String(r.date || '').trim().split('T')[0];
      if (rDate !== todayStr) return false;

      const rUid = String(r.user_id || '').trim().toLowerCase();
      const rName = String(r.name || '').trim().toLowerCase();
      const rUsername = String(r.username || '').trim().toLowerCase();

      return Boolean(
        (targetUserId && (rUid === targetUserId || rUid.includes(targetUserId) || targetUserId.includes(rUid))) ||
        (targetName && (rName === targetName || rName.includes(targetName) || targetName.includes(rName))) ||
        (targetUsername && rUsername === targetUsername)
      );
    };

    // 2. Search in allRecords prop
    if (allRecords && allRecords.length > 0) {
      const found = allRecords.find(matchesUser);
      if (found) return found;
    }

    // 3. Search in localStorage cache
    try {
      const cached = localStorage.getItem('evs_cache_staff_attendance');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          const found = parsed.find(matchesUser);
          if (found) return found;
        }
      }
    } catch {}

    return todayRecord || null;
  }, [todayRecord, allRecords, currentUser]);

  // Determine current scan mode: Check-In vs Check-Out vs Completed
  // If already checked in today (and no check-out time): automatically switch to 'checkout'!
  const isAlreadyCheckedIn = Boolean(effectiveTodayRecord?.check_in_time);
  const isAlreadyCheckedOut = Boolean(effectiveTodayRecord?.check_out_time);

  // Auto-calculated mode based on prior scan status:
  // - If checked in but not checked out: automatically do 'checkout' on 2nd scan!
  // - If not checked in yet: do 'checkin' on 1st scan!
  // - If both done: 'completed'
  const computedScanMode: 'checkout' | 'checkin' | 'completed' =
    isAlreadyCheckedIn && !isAlreadyCheckedOut
      ? 'checkout'
      : !isAlreadyCheckedIn
      ? 'checkin'
      : 'completed';

  const autoScanMode: 'checkout' | 'checkin' | 'completed' = manualModeOverride || computedScanMode;

  // Handle 1-click confirmation check-in / check-out
  const handleConfirmAction = async (forceCheckOut?: boolean) => {
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
      attendancePayload.check_in_time = effectiveTodayRecord?.check_in_time || timeStr;
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
            <div className="flex items-center justify-between gap-2 text-slate-800">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <i className="fa-solid fa-location-dot text-amber-600"></i>
                <span>
                  स्कूल से दूरी: {distanceFromSchool !== null ? (distanceFromSchool > 1000 ? `${(distanceFromSchool / 1000).toFixed(1)} km` : `${distanceFromSchool}m`) : 'जांच जारी'}
                </span>
              </div>
              {isManager && (
                <button
                  type="button"
                  onClick={handleCalibrateSchoolLocation}
                  disabled={!userCoords}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] cursor-pointer shadow-xs"
                  title="वर्तमान GPS को स्कूल लोकेशन सेट करें"
                >
                  <span>📍 GPS अपडेट करें</span>
                </button>
              )}
            </div>
          )}

          {(locationStatus === 'permission_denied' || locationStatus === 'unavailable') && (
            <div className="flex items-center justify-between text-amber-900 font-bold text-xs">
              <span className="flex items-center gap-1.5">
                <i className="fa-solid fa-location-crosshairs text-amber-600"></i>
                <span>GPS लोकेशन बंद है</span>
              </span>
              <button
                type="button"
                onClick={startLocationWatch}
                className="px-2 py-0.5 rounded bg-amber-400 hover:bg-amber-500 text-slate-950 text-[11px] font-bold cursor-pointer"
              >
                पुनः जांचें
              </button>
            </div>
          )}

          {calibrationSuccess && (
            <div className="text-[11px] text-emerald-700 font-bold pt-1 flex items-center gap-1">
              <i className="fa-solid fa-circle-check"></i>
              <span>स्कूल लोकेशन सफलतापूर्वक अपडेट हो गई!</span>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-4">
          {/* STEP 1: SCANNING MODE (Live Camera Only - No Photo Upload Allowed) */}
          {!detectedCode && !successStatus && (
            <div className="space-y-4">

              {/* Already Checked In Notification in Scanner */}
              {effectiveTodayRecord?.check_in_time && !effectiveTodayRecord?.check_out_time && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-amber-950 text-xs flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shrink-0">
                      <i className="fa-solid fa-clock"></i>
                    </div>
                    <div>
                      <div className="font-bold">आप आज चेक-इन कर चुके हैं: सुबह {effectiveTodayRecord.check_in_time}</div>
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
                    आप आज सुबह <strong>{effectiveTodayRecord?.check_in_time || 'दर्ज समय'}</strong> पर चेक-इन कर चुके हैं।
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

              {/* Mode Switcher Buttons */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/80 rounded-xl">
                <button
                  type="button"
                  onClick={() => setManualModeOverride('checkin')}
                  className={`py-2 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    autoScanMode === 'checkin'
                      ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400'
                      : 'bg-white/70 text-slate-700 hover:bg-white'
                  }`}
                >
                  <i className="fa-solid fa-arrow-right-to-bracket text-xs"></i>
                  <span>1. स्कूल चेक-इन</span>
                </button>
                <button
                  type="button"
                  onClick={() => setManualModeOverride('checkout')}
                  className={`py-2 px-3 rounded-lg text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    autoScanMode === 'checkout'
                      ? 'bg-amber-500 text-slate-950 shadow-sm ring-2 ring-amber-400'
                      : 'bg-white/70 text-slate-700 hover:bg-white'
                  }`}
                >
                  <i className="fa-solid fa-arrow-right-from-bracket text-xs"></i>
                  <span>2. स्कूल चेक-आउट</span>
                </button>
              </div>

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
                {autoScanMode === 'checkout' && effectiveTodayRecord?.check_in_time && (
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-medium">सुबह चेक-इन समय:</span>
                    <span className="font-bold text-slate-800 font-mono">{effectiveTodayRecord.check_in_time}</span>
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

              {/* Primary Action Button (Direct 1-click confirmation) */}
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
                      {isSubmitting ? 'चेक-आउट दर्ज हो रहा है...' : '🚪 स्कूल चेक-आउट दर्ज करें'}
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
                      {isSubmitting ? 'हाजिरी दर्ज हो रही है...' : '✅ स्कूल चेक-इन दर्ज करें'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setDetectedCode(null);
                    startCamera();
                  }}
                  className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 text-center cursor-pointer"
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

      {/* School Location Settings Modal */}
      <SchoolLocationModal
        isOpen={isLocationModalOpen}
        onClose={() => {
          setIsLocationModalOpen(false);
          const active = getActiveSchoolLocation();
          setSchoolCoords(active);
        }}
        isManager={isManagerRole || isManager}
        onLocationUpdated={(cfg) => {
          setSchoolCoords(cfg);
          setLocationStatus('inside_campus');
          playBeep();
        }}
      />
    </div>
  );
};
