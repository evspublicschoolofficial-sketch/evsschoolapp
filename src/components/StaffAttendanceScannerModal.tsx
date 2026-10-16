import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { SchoolUser, StaffAttendanceRecord } from '../types';
import { SCHOOL_CHECKIN_CODE } from './SchoolQRCodeModal';
import { speakAnnouncement, unlockAudioContext } from '../utils/sirenAudio';

interface StaffAttendanceScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: SchoolUser;
  todayRecord?: StaffAttendanceRecord | null;
  onCheckInSuccess: (record: Partial<StaffAttendanceRecord>, isCheckOut?: boolean) => void;
}

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const speakConfirmation = (text: string) => {
    try {
      unlockAudioContext();
      speakAnnouncement(text, {
        englishFallback: `Attendance marked successfully for ${currentUser.Name}. Thank you.`,
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
          ? 'कैमरा अनुमति अस्वीकार कर दी गई है। कृपया ब्राउज़र सेटिंग में कैमरा चालू करें, या नीचे फोटो अपलोड द्वारा QR स्कैन करें।'
          : 'कैमरा शुरू करने में समस्या आई। कृपया पुनः प्रयास करें या फोटो द्वारा स्कैन करें।'
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

  // Handle scanned raw payload
  const handleScannedData = (rawText: string) => {
    playBeep();
    stopCamera();

    if (isSchoolQR(rawText)) {
      setDetectedCode(rawText);
      setConfirmationInput('YES');
    } else {
      // Invalid QR code scanned
      alert('यह स्कूल का आधिकारिक उपस्थिति QR कोड नहीं है। कृपया स्कूल गेट या रिसेप्शन पर लगा सही QR कोड स्कैन करें।');
      startCamera();
    }
  };

  // Handle file picker upload QR image
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            handleScannedData(code.data);
          } else {
            alert('इस फोटो में कोई QR कोड नहीं मिला। कृपया स्पष्ट फोटो चुनें या कैमरे से स्कैन करें।');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Modal Open / Close lifecycle
  useEffect(() => {
    if (isOpen) {
      setDetectedCode(null);
      setConfirmationInput('YES');
      setSuccessStatus(null);
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  // Handle YES confirmation check-in
  const handleConfirmCheckIn = async (isCheckOut = false) => {
    const trimmedInput = confirmationInput.trim().toUpperCase();
    if (trimmedInput !== 'YES' && trimmedInput !== 'Y' && trimmedInput !== 'हाँ' && trimmedInput !== 'HAAN') {
      alert("कृपया चेक-इन करने के लिए 'YES' दर्ज करें या नीचे बटन पर क्लिक करें।");
      return;
    }

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
      location: 'School Campus Gate',
      school_code: SCHOOL_CHECKIN_CODE,
      timestamp: Date.now(),
    };

    if (isCheckOut) {
      attendancePayload.check_out_time = timeStr;
    } else {
      attendancePayload.check_in_time = timeStr;
    }

    try {
      await onCheckInSuccess(attendancePayload, isCheckOut);
      setSuccessStatus({
        time: timeStr,
        type: isCheckOut ? 'checkout' : 'checkin',
      });
      speakConfirmation(
        isCheckOut
          ? `धन्यवाद ${currentUser.Name} जी, आपका चेक-आउट समय ${timeStr} दर्ज हो गया है।`
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden w-full max-w-lg transition-all">
        {/* Header */}
        <div className="bg-[#0c2340] text-white p-4 sm:p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shadow-md">
              <i className="fa-solid fa-camera text-lg"></i>
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg text-amber-300">
                स्कूल QR हाजिरी स्कैनर (Staff Check-In)
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

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-4">
          {/* STEP 1: SCANNING MODE (Live Camera or File Pick) */}
          {!detectedCode && !successStatus && (
            <div className="space-y-4">
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

                    <div className="text-[11px] font-medium bg-black/70 text-amber-300 px-3 py-1 rounded-full border border-amber-400/30">
                      स्कूल क्यूआर को फ्रेम के बीच रखें
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

              {/* Alternative file upload option */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 px-3 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <i className="fa-solid fa-image text-blue-600"></i>
                  <span>गैलरी / फोटो से QR कोड चुनें</span>
                </button>
              </div>

              {/* Status Note for Staff */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
                <i className="fa-solid fa-lightbulb text-amber-600 mt-0.5"></i>
                <div>
                  <strong>त्वरित हाजिरी:</strong> जैसे ही स्कूल गेट का QR स्कैन होगा, स्क्रीन पर स्वतः उपस्थिति विंडो खुलेगी और 'YES' क्लिक करते ही आपकी चेक-इन हाजिरी दर्ज हो जाएगी।
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: CONFIRMATION PROMPT (The requested "YES" prompt) */}
          {detectedCode && !successStatus && (
            <div className="space-y-4 animate-fadeIn">
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto text-xl mb-2 shadow-md">
                  <i className="fa-solid fa-check"></i>
                </div>
                <h4 className="text-base font-bold text-emerald-900">
                  स्कूल क्यूआर कोड सफलतापूर्वक पहचाना गया!
                </h4>
                <p className="text-xs text-emerald-700 mt-0.5">
                  E.V.S. Public School • उपस्थिति सत्यापन केंद्र
                </p>
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
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">चेक-इन समय (Live Time):</span>
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

              {/* Already Checked-in Warning if applicable */}
              {todayRecord?.check_in_time && !todayRecord?.check_out_time && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 flex items-center justify-between">
                  <div>
                    <span className="font-bold block">आप आज पहले ही चेक-इन कर चुके हैं:</span>
                    <span className="text-blue-700">सुबह {todayRecord.check_in_time}</span>
                  </div>
                  <span className="px-2 py-1 rounded bg-blue-200 text-blue-800 text-[10px] font-bold">
                    चेक-इन एक्टिव
                  </span>
                </div>
              )}

              {/* The "YES" Confirmation Input as explicitly requested by user */}
              <div className="space-y-2 bg-amber-50/60 p-4 rounded-xl border border-amber-300">
                <label className="block text-xs font-bold text-amber-950">
                  हाजिरी दर्ज करने हेतु पुष्टि करें (Type 'YES' to confirm):
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
                  (डिफ़ॉल्ट 'YES' लिखा हुआ है, आप सीधे नीचे हरे बटन पर क्लिक करके हाजिरी लगा सकते हैं)
                </p>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleConfirmCheckIn(false)}
                  className="w-full py-3.5 px-4 rounded-xl font-black text-sm sm:text-base bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg hover:shadow-emerald-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <i className="fa-solid fa-clipboard-check text-lg"></i>
                  <span>
                    {isSubmitting ? 'हाजिरी दर्ज हो रही है...' : '✅ YES, स्कूल चेक-इन दर्ज करें'}
                  </span>
                </button>

                {/* If already checked in earlier today, offer Check-Out option */}
                {todayRecord?.check_in_time && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleConfirmCheckIn(true)}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm bg-[#0c2340] hover:bg-slate-800 text-amber-300 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket"></i>
                    <span>🚪 स्कूल से प्रस्थान / चेक-आउट दर्ज करें (Check-Out)</span>
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
                    ? 'चेक-आउट दर्ज हुआ!'
                    : 'हाजिरी सफलतापूर्वक लग गई! 🎉'}
                </h4>
                <p className="text-sm font-semibold text-emerald-700 mt-1">
                  समय: {successStatus.time} • E.V.S. Public School
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {currentUser.Name} ({currentUser.Designation || 'Teacher'})
                </p>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900">
                आपकी स्कूल उपस्थिति सिस्टम व Google Sheets रिकॉर्ड में स्वतः अपडेट हो गई है।
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
