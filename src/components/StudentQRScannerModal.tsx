import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

export interface StudentRecordForScan {
  Student_ID?: string;
  Student_Name?: string;
  Admission_Number?: number | string;
  Roll_Number?: number | string;
  Class?: string;
  Parent_Mobile?: number | string;
  [key: string]: any;
}

interface StudentQRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedValue: string, matchedStudent?: StudentRecordForScan) => void;
  students: StudentRecordForScan[];
  title?: string;
  subtitle?: string;
}

export const StudentQRScannerModal: React.FC<StudentQRScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  students,
  title = 'छात्र QR कोड स्कैन करें (Scan Student QR)',
  subtitle = 'छात्र के आई-कार्ड या रजिस्टर का QR कोड कैमरे के सामने रखें',
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannedResult, setScannedResult] = useState<{ code: string; student?: StudentRecordForScan } | null>(null);
  const [manualInput, setManualInput] = useState<string>('');

  // Audio feedback on successful scan
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {
      // AudioContext may be blocked before gesture
    }
    try {
      if (navigator.vibrate) {
        navigator.vibrate(80);
      }
    } catch {}
  };

  // Find matching student from QR content
  const matchStudent = (text: string): StudentRecordForScan | undefined => {
    if (!text) return undefined;
    const clean = text.trim();

    // 1. Check for EVS-STUDENT:ID format
    const evsMatch = clean.match(/EVS-STUDENT:\s*([a-zA-Z0-9_-]+)/i);
    if (evsMatch && evsMatch[1]) {
      const id = evsMatch[1].trim().toLowerCase();
      const found = students.find((s) => String(s.Student_ID || '').toLowerCase() === id);
      if (found) return found;
    }

    // 2. Direct Student_ID match (case-insensitive)
    const byId = students.find(
      (s) => String(s.Student_ID || '').trim().toLowerCase() === clean.toLowerCase()
    );
    if (byId) return byId;

    // 3. Admission Number match
    const byAdm = students.find(
      (s) => String(s.Admission_Number || '').trim() === clean
    );
    if (byAdm) return byAdm;

    // 4. Check if text contains Student_ID
    const contained = students.find((s) => {
      const sId = String(s.Student_ID || '').trim().toLowerCase();
      return sId && clean.toLowerCase().includes(sId);
    });
    if (contained) return contained;

    // 5. Name match if string contains student name
    const byName = students.find((s) => {
      const sName = String(s.Student_Name || '').trim().toLowerCase();
      return sName.length >= 3 && clean.toLowerCase().includes(sName);
    });
    if (byName) return byName;

    return undefined;
  };

  // Process detected QR code
  const handleDecodedCode = (code: string) => {
    if (!code || isScanning === false) return;
    setIsScanning(false);
    playBeep();

    const matched = matchStudent(code);
    setScannedResult({ code, student: matched });

    // Give visual feedback then trigger onScan callback
    setTimeout(() => {
      const finalValue = matched ? (matched.Student_ID || matched.Student_Name || code) : code;
      onScan(finalValue, matched);
      onClose();
    }, 700);
  };

  // Stop camera stream safely
  const stopCamera = () => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Scan frame from video element using jsQR
  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationFrameId.current = requestAnimationFrame(scanFrame);
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) {
      animationFrameId.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      animationFrameId.current = requestAnimationFrame(scanFrame);
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      handleDecodedCode(code.data);
      return;
    }

    animationFrameId.current = requestAnimationFrame(scanFrame);
  };

  // Start camera stream
  const startCamera = async () => {
    setCameraError(null);
    stopCamera();
    setIsScanning(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('इस ब्राउज़र में कैमरा समर्थित नहीं है। कृपया QR फोटो अपलोड विकल्प का उपयोग करें।');
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        animationFrameId.current = requestAnimationFrame(scanFrame);
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      let msg = 'कैमरा शुरू नहीं हो सका। ';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg += 'कृपया ब्राउज़र में कैमरा अनुमति (Camera Permission) प्रदान करें या नीचे दिए गए फोटो अपलोड बटन का प्रयोग करें।';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg += 'कोई कैमरा उपकरण नहीं मिला।';
      } else {
        msg += err.message || 'कृपया नीचे दी गई QR फोटो अपलोड का विकल्प चुनें।';
      }
      setCameraError(msg);
      setIsScanning(false);
    }
  };

  // Handle uploaded image file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            handleDecodedCode(code.data);
          } else {
            setCameraError('इस फोटो में QR कोड नहीं पढ़ा जा सका। कृपया स्पष्ट फोटो अपलोड करें।');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Manual fallback search submit
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    const matched = matchStudent(manualInput.trim());
    onScan(matched ? (matched.Student_ID || manualInput.trim()) : manualInput.trim(), matched);
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      setScannedResult(null);
      setManualInput('');
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#0c2340] px-4 py-3 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-bold">
              <i className="fa-solid fa-qrcode"></i>
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-300 leading-tight">{title}</h3>
              <p className="text-[10px] text-slate-300">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Video / Camera Viewport */}
        <div className="relative bg-black flex-1 min-h-[260px] max-h-[340px] flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className="p-6 text-center text-white space-y-3">
              <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-500 text-rose-400 flex items-center justify-center text-xl mx-auto">
                <i className="fa-solid fa-camera-rotate"></i>
              </div>
              <p className="text-xs text-rose-200 leading-relaxed max-w-xs mx-auto">
                {cameraError}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-image"></i>
                  <span>QR फोटो अपलोड करें</span>
                </button>
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <i className="fa-solid fa-rotate-right"></i>
                  <span>पुनः प्रयास करें</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Scanning Target Box with animated laser */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6">
                <div className="w-56 h-56 border-2 border-amber-400 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] flex flex-col justify-between p-2">
                  {/* Target Corners */}
                  <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-amber-300 rounded-tl-lg"></div>
                  <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-amber-300 rounded-tr-lg"></div>
                  <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-amber-300 rounded-bl-lg"></div>
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-amber-300 rounded-br-lg"></div>

                  {/* Laser line animation */}
                  <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_#f59e0b] animate-bounce my-auto"></div>

                  <span className="text-[10px] text-amber-200 text-center font-bold tracking-wider uppercase bg-black/60 py-0.5 px-2 rounded mx-auto backdrop-blur-xs">
                    Scan Student QR
                  </span>
                </div>
              </div>

              {/* Camera Switch Button */}
              <div className="absolute top-3 right-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                  className="px-2.5 py-1 rounded-full bg-black/60 hover:bg-black/80 text-white text-[11px] font-semibold border border-white/20 flex items-center gap-1.5 backdrop-blur-xs cursor-pointer shadow-xs"
                  title="Switch Front / Rear Camera"
                >
                  <i className="fa-solid fa-camera-rotate"></i>
                  <span>{facingMode === 'environment' ? 'Rear' : 'Front'}</span>
                </button>
              </div>
            </>
          )}

          {/* Success Overlay */}
          {scannedResult && (
            <div className="absolute inset-0 bg-emerald-950/90 flex flex-col items-center justify-center p-4 text-white text-center animate-fadeIn z-10">
              <div className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center text-2xl mb-2 shadow-lg animate-bounce">
                <i className="fa-solid fa-check"></i>
              </div>
              <h4 className="text-base font-bold text-emerald-300">QR कोड सफलता से स्कैन हुआ!</h4>
              {scannedResult.student ? (
                <div className="mt-2 p-2 bg-white/10 rounded-xl max-w-xs w-full text-xs">
                  <div className="font-bold text-sm text-white">{scannedResult.student.Student_Name}</div>
                  <div className="text-slate-300 text-[11px] mt-0.5">
                    कक्षा: {scannedResult.student.Class || 'N/A'} • ID: {scannedResult.student.Student_ID}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-200 mt-1 font-mono break-all max-w-xs">
                  {scannedResult.code}
                </div>
              )}
              <span className="text-[10px] text-emerald-400 mt-2 font-semibold">खोज की जा रही है...</span>
            </div>
          )}
        </div>

        {/* Action Controls & Alternative Options */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
          {/* File Upload Button */}
          <div className="flex items-center justify-between gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 py-2 px-3 rounded-xl border border-slate-300 hover:bg-white bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <i className="fa-solid fa-file-image text-blue-600"></i>
              <span>गैलरी से QR फोटो चुनें</span>
            </button>
          </div>

          {/* Manual ID / Roll Number Search Input */}
          <form onSubmit={handleManualSubmit} className="pt-2 border-t border-slate-200 flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="या छात्र का ID / नाम / Roll No दर्ज करें..."
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs outline-none focus:border-blue-800 bg-white"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded-lg bg-[#0c2340] text-amber-300 text-xs font-bold hover:bg-blue-950 transition-colors cursor-pointer shrink-0"
            >
              खोजें
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
