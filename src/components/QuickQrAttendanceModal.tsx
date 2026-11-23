import React, { useEffect, useMemo, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Student, StudentBehaviorRecord } from '../types';
import { formatLocalTime, getLocalDateYMD } from '../utils/localTime';
import { StudentAvatar } from './StudentAvatar';

interface QuickQrAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  students: Student[];
  behaviorRecords: StudentBehaviorRecord[];
  getClassName?: (c?: string) => string;
  getStudentPhoto?: (s: Student) => string;
  onMarkPresent: (student: Student, dateISO: string) => Promise<void> | void;
}

interface ScanLogItem {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  rollNo: string;
  time: string;
  status: 'marked' | 'already_present';
}

interface FlashStatus {
  kind: 'marked' | 'already_present' | 'unmatched';
  student?: Student;
  rawCode?: string;
  message: string;
  time: string;
}

const normalizeDateToken = (val: any): string => {
  if (!val) return '';
  const s = String(val).trim();
  if (s.includes('Date(')) {
    const m = s.match(/Date\((\d+),(\d+),(\d+)/);
    if (m) {
      return `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
    }
  }
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return s;
};

const isPresentVal = (val: any): boolean => {
  if (val === false || val === 0) return false;
  if (val === true || val === 1) return true;
  const s = String(val ?? '').trim().toLowerCase();
  if (s === 'absent' || s === 'no' || s === 'false' || s === '0' || s === 'a' || s === 'anupasthit') return false;
  return true;
};

export const QuickQrAttendanceModal: React.FC<QuickQrAttendanceModalProps> = ({
  isOpen,
  onClose,
  students,
  behaviorRecords,
  getClassName = (c) => c || 'N/A',
  getStudentPhoto = (_s) => '',
  onMarkPresent,
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(() => getLocalDateYMD());
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraActive, setCameraActive] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);

  const [flashStatus, setFlashStatus] = useState<FlashStatus | null>(null);
  const [sessionLogs, setSessionLogs] = useState<ScanLogItem[]>([]);
  const [manualQuery, setManualQuery] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const barcodeDetectorRef = useRef<any>(null);
  const scanLockUntilRef = useRef<number>(0);
  const recentStudentCooldownRef = useRef<Record<string, number>>({});
  const sessionMarkedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        barcodeDetectorRef.current = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13'],
        });
      } catch {
        barcodeDetectorRef.current = null;
      }
    }
  }, []);

  // Reset session marked cache when attendance date changes
  useEffect(() => {
    sessionMarkedIdsRef.current = new Set();
    recentStudentCooldownRef.current = {};
    setFlashStatus(null);
  }, [selectedDate]);

  // Build set of Student_IDs already marked Present on selectedDate from behaviorRecords
  const alreadyPresentIds = useMemo(() => {
    const set = new Set<string>();
    behaviorRecords.forEach((b) => {
      if (normalizeDateToken(b.Date) !== selectedDate) return;
      const present = isPresentVal(b.Is_Present !== undefined ? b.Is_Present : (b as any).is_present);
      if (present && b.Student_ID) {
        set.add(String(b.Student_ID).trim().toLowerCase());
      }
    });
    return set;
  }, [behaviorRecords, selectedDate]);

  const playFeedbackSound = (kind: 'success' | 'info' | 'error') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'error' ? 'sawtooth' : 'sine';
      const now = ctx.currentTime;
      if (kind === 'success') {
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1174, now + 0.08);
        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
      } else if (kind === 'info') {
        osc.frequency.setValueAtTime(660, now);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
      } else {
        osc.frequency.setValueAtTime(280, now);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
      }
    } catch {}
    try {
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'success' ? [70, 30, 70] : 50);
      }
    } catch {}
  };

  const matchStudentFromCode = (text: string): Student | undefined => {
    if (!text) return undefined;
    const raw = text.trim();
    const clean = raw.toLowerCase();

    // 1. EVS-STUDENT:ID format
    const evsMatch = raw.match(/EVS-STUDENT:\s*([a-zA-Z0-9_-]+)/i);
    if (evsMatch?.[1]) {
      const id = evsMatch[1].trim().toLowerCase();
      const found = students.find((s) => String(s.Student_ID || '').trim().toLowerCase() === id);
      if (found) return found;
    }

    // 2. QR image URL ?data= or ?chl=
    const urlDataMatch = raw.match(/[?&](?:data|chl)=([^&]+)/i);
    if (urlDataMatch?.[1]) {
      const decodedParam = decodeURIComponent(urlDataMatch[1]).trim().toLowerCase();
      const byParam = students.find((s) => String(s.Student_ID || '').trim().toLowerCase() === decodedParam);
      if (byParam) return byParam;
    }

    // 3. Exact Student_ID or QR code field match
    const byId = students.find((s) => {
      const sid = String(s.Student_ID || '').trim().toLowerCase();
      const qr = String(s['QR code'] || s['QR_code'] || s.QRCode || s.qr_code || '').trim().toLowerCase();
      return (sid && sid === clean) || (qr && qr === clean);
    });
    if (byId) return byId;

    // 4. Admission Number match
    const byAdm = students.find((s) => String(s.Admission_Number || '').trim().toLowerCase() === clean);
    if (byAdm) return byAdm;

    // 5. Contained Student_ID inside QR string
    const containedId = students.find((s) => {
      const sId = String(s.Student_ID || '').trim().toLowerCase();
      return sId.length >= 3 && clean.includes(sId);
    });
    if (containedId) return containedId;

    // 6. Mobile number match
    const cleanDigits = clean.replace(/[^0-9]/g, '');
    if (cleanDigits.length >= 8) {
      const byMobile = students.find((s) => {
        const sMob = String(s.Parent_Mobile || '').replace(/[^0-9]/g, '');
        return sMob && (sMob === cleanDigits || sMob.endsWith(cleanDigits) || cleanDigits.endsWith(sMob));
      });
      if (byMobile) return byMobile;
    }

    // 7. Exact Name match
    const byName = students.find((s) => String(s.Student_Name || '').trim().toLowerCase() === clean);
    if (byName) return byName;

    return undefined;
  };

  const markStudentAttendanceInstant = async (student: Student) => {
    const sidNorm = String(student.Student_ID || '').trim().toLowerCase();
    const nowTime = formatLocalTime();
    const alreadyPresent = alreadyPresentIds.has(sidNorm) || sessionMarkedIdsRef.current.has(sidNorm);

    if (alreadyPresent) {
      playFeedbackSound('info');
      setFlashStatus({
        kind: 'already_present',
        student,
        message: 'पहले से उपस्थित (Already Marked Present)',
        time: nowTime,
      });
      setSessionLogs((prev) => {
        if (prev[0]?.studentId === student.Student_ID && prev[0]?.status === 'already_present') return prev;
        return [
          {
            id: `${student.Student_ID}-${Date.now()}`,
            studentId: student.Student_ID,
            studentName: student.Student_Name,
            className: getClassName(student.Class),
            rollNo: String(student.Roll_Number || '—'),
            time: nowTime,
            status: 'already_present',
          },
          ...prev.slice(0, 39),
        ];
      });
      return;
    }

    sessionMarkedIdsRef.current.add(sidNorm);
    playFeedbackSound('success');
    setFlashStatus({
      kind: 'marked',
      student,
      message: 'उपस्थित दर्ज हो गई (Marked Present ✓)',
      time: nowTime,
    });
    setSessionLogs((prev) => [
      {
        id: `${student.Student_ID}-${Date.now()}`,
        studentId: student.Student_ID,
        studentName: student.Student_Name,
        className: getClassName(student.Class),
        rollNo: String(student.Roll_Number || '—'),
        time: nowTime,
        status: 'marked',
      },
      ...prev.slice(0, 39),
    ]);

    try {
      await onMarkPresent(student, selectedDate);
    } catch {}
  };

  const handleDecodedCode = async (rawCode: string) => {
    const now = Date.now();
    if (now < scanLockUntilRef.current) return;

    const matched = matchStudentFromCode(rawCode);
    if (!matched) {
      scanLockUntilRef.current = now + 1300;
      playFeedbackSound('error');
      setFlashStatus({
        kind: 'unmatched',
        rawCode,
        message: 'यह QR किसी छात्र रिकॉर्ड से मेल नहीं खाया',
        time: formatLocalTime(),
      });
      return;
    }

    const sidNorm = String(matched.Student_ID || '').trim().toLowerCase();
    const lastScannedAt = recentStudentCooldownRef.current[sidNorm] || 0;
    if (now - lastScannedAt < 3000) {
      // Same card held in front of camera within 3 seconds — ignore silently
      return;
    }

    recentStudentCooldownRef.current[sidNorm] = now;
    scanLockUntilRef.current = now + 1100;
    await markStudentAttendanceInstant(matched);
  };

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
    setTorchOn(false);
  };

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextTorch = !torchOn;
      await (track as any).applyConstraints({ advanced: [{ torch: nextTorch }] });
      setTorchOn(nextTorch);
    } catch {}
  };

  const scanFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      animationFrameId.current = requestAnimationFrame(scanFrame);
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (width === 0 || height === 0) {
      animationFrameId.current = requestAnimationFrame(scanFrame);
      return;
    }

    if (Date.now() >= scanLockUntilRef.current) {
      if (barcodeDetectorRef.current) {
        try {
          const barcodes = await barcodeDetectorRef.current.detect(video);
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            await handleDecodedCode(barcodes[0].rawValue);
            animationFrameId.current = requestAnimationFrame(scanFrame);
            return;
          }
        } catch {}
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, width, height);
        const cropSize = Math.min(width, height) * 0.72;
        const cropX = (width - cropSize) / 2;
        const cropY = (height - cropSize) / 2;
        const cropData = ctx.getImageData(cropX, cropY, cropSize, cropSize);

        let code = jsQR(cropData.data, cropData.width, cropData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (!code || !code.data) {
          const fullData = ctx.getImageData(0, 0, width, height);
          code = jsQR(fullData.data, fullData.width, fullData.height, {
            inversionAttempts: 'attemptBoth',
          });
        }

        if (code && code.data) {
          await handleDecodedCode(code.data);
        }
      }
    }

    animationFrameId.current = requestAnimationFrame(scanFrame);
  };

  const startCamera = async () => {
    setCameraError(null);
    stopCamera();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('इस डिवाइस/ब्राउज़र में लाइव कैमरा उपलब्ध नहीं है। आप QR फोटो अपलोड या सर्च से भी तुरंत हाजिरी लगा सकते हैं।');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
          setTorchSupported(Boolean(capabilities.torch));
        } catch {
          setTorchSupported(false);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        animationFrameId.current = requestAnimationFrame(scanFrame);
      }
    } catch (err: any) {
      let msg = 'कैमरा शुरू नहीं हो सका। ';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg += 'कृपया ब्राउज़र में Camera Permission दें या नीचे QR फोटो अपलोड / त्वरित खोज का उपयोग करें।';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        msg += 'कैमरा उपकरण नहीं मिला।';
      } else {
        msg += err?.message || 'कृपया QR फोटो अपलोड या नाम/ID से हाजिरी लगाएँ।';
      }
      setCameraError(msg);
    }
  };

  useEffect(() => {
    if (isOpen && cameraActive) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, cameraActive, facingMode]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (event) => {
      img.onload = async () => {
        if (barcodeDetectorRef.current) {
          try {
            const barcodes = await barcodeDetectorRef.current.detect(img);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              scanLockUntilRef.current = 0;
              await handleDecodedCode(barcodes[0].rawValue);
              return;
            }
          } catch {}
        }
        const canvas = canvasRef.current || document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data) {
            scanLockUntilRef.current = 0;
            await handleDecodedCode(code.data);
          } else {
            playFeedbackSound('error');
            setFlashStatus({
              kind: 'unmatched',
              message: 'इस फोटो में कोई स्पष्ट QR कोड नहीं मिला',
              time: formatLocalTime(),
            });
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const quickSearchMatches = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          String(s.Student_Name || '').toLowerCase().includes(q) ||
          String(s.Student_ID || '').toLowerCase().includes(q) ||
          String(s.Roll_Number || '').toLowerCase() === q ||
          String(s.Admission_Number || '').toLowerCase() === q
      )
      .slice(0, 5);
  }, [students, manualQuery]);

  if (!isOpen) return null;

  const totalPresentSelectedDate = new Set([
    ...Array.from(alreadyPresentIds),
    ...Array.from(sessionMarkedIdsRef.current),
  ]).size;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2.5 sm:p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[94vh] overflow-hidden">
        {/* Top Manager Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-emerald-950 px-4 py-3 text-white flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center text-lg font-black shadow-xs shrink-0">
              <i className="fa-solid fa-qrcode"></i>
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-amber-300 leading-tight">
                तुरंत QR हाजिरी स्कैनर (Manager Only)
              </h3>
              <p className="text-[11px] text-slate-200">
                QR कोड स्कैन होते ही बिना किसी अतिरिक्त बटन के छात्र की उपस्थिति तुरंत लग जाएगी
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || getLocalDateYMD())}
              className="px-2.5 py-1 rounded-xl bg-white/15 border border-white/25 text-white text-xs font-bold outline-none cursor-pointer"
            />
            <button
              type="button"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              className="w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Live Stats Bar */}
        <div className="bg-slate-900 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-emerald-300 font-black">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{cameraActive ? 'लगातार स्कैन चालू (Continuous Scan)' : 'स्कैन रुका हुआ (Paused)'}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-black">
              दिनांक {selectedDate} उपस्थित: {totalPresentSelectedDate} / {students.length}
            </span>
          </div>
        </div>

        {/* Camera & Instant Confirmation Body */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          <div className="relative bg-slate-950 min-h-[250px] sm:min-h-[290px] flex items-center justify-center overflow-hidden">
            {cameraError ? (
              <div className="p-6 text-center text-white space-y-3">
                <div className="w-12 h-12 rounded-full bg-rose-500/20 border border-rose-400 text-rose-300 flex items-center justify-center text-xl mx-auto">
                  <i className="fa-solid fa-camera-slash"></i>
                </div>
                <p className="text-xs text-rose-200 max-w-sm mx-auto leading-relaxed">{cameraError}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => startCamera()}
                    className="px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-bold cursor-pointer"
                  >
                    <i className="fa-solid fa-rotate mr-1"></i> कैमरा पुनः प्रयास करें
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black cursor-pointer"
                  >
                    <i className="fa-solid fa-image mr-1"></i> QR फोटो अपलोड करें
                  </button>
                </div>
              </div>
            ) : !cameraActive ? (
              <div className="p-6 text-center text-white space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-400 text-amber-300 flex items-center justify-center text-xl mx-auto">
                  <i className="fa-solid fa-pause"></i>
                </div>
                <p className="text-xs text-slate-300 font-bold">कैमरा स्कैनर अस्थायी रूप से रुका हुआ है</p>
                <button
                  type="button"
                  onClick={() => setCameraActive(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-black cursor-pointer"
                >
                  <i className="fa-solid fa-play mr-1.5"></i> स्कैनर फिर से चालू करें
                </button>
              </div>
            ) : (
              <>
                <video ref={videoRef} className="w-full h-full max-h-[300px] object-cover" autoPlay playsInline muted />
                <canvas ref={canvasRef} className="hidden" />

                {/* Aim Box */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 sm:w-52 sm:h-52 border-2 border-amber-400 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] flex flex-col justify-between p-2">
                    <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg"></div>
                    <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg"></div>
                    <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg"></div>
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-lg"></div>
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] animate-bounce my-auto"></div>
                    <span className="text-[10px] text-amber-200 text-center font-black uppercase bg-black/65 py-0.5 px-2 rounded mx-auto">
                      ID कार्ड का QR सामने लाएँ
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Camera Control Pills */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              {torchSupported && cameraActive && !cameraError && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer ${
                    torchOn
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-black/65 text-white border-white/25 hover:bg-black/80'
                  }`}
                >
                  <i className={`fa-solid ${torchOn ? 'fa-lightbulb' : 'fa-bolt'} mr-1`}></i>
                  {torchOn ? 'Torch On' : 'Torch'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setFacingMode((p) => (p === 'environment' ? 'user' : 'environment'))}
                className="px-2.5 py-1 rounded-full bg-black/65 hover:bg-black/80 text-white text-[11px] font-bold border border-white/25 cursor-pointer"
              >
                <i className="fa-solid fa-camera-rotate mr-1"></i>
                {facingMode === 'environment' ? 'Rear' : 'Front'}
              </button>
              <button
                type="button"
                onClick={() => setCameraActive((p) => !p)}
                className="px-2.5 py-1 rounded-full bg-black/65 hover:bg-black/80 text-white text-[11px] font-bold border border-white/25 cursor-pointer"
              >
                <i className={`fa-solid ${cameraActive ? 'fa-pause' : 'fa-play'} mr-1`}></i>
                {cameraActive ? 'Pause' : 'Start'}
              </button>
            </div>
          </div>

          {/* Instant Scan Result Flash Banner */}
          {flashStatus && (
            <div
              className={`px-4 py-3 border-y flex items-center justify-between gap-3 animate-fadeIn ${
                flashStatus.kind === 'marked'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : flashStatus.kind === 'already_present'
                  ? 'bg-blue-50 border-blue-300 text-blue-950'
                  : 'bg-rose-50 border-rose-300 text-rose-950'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                {flashStatus.student ? (
                  <StudentAvatar
                    student={flashStatus.student as any}
                    photoUrl={getStudentPhoto(flashStatus.student)}
                    size="sm"
                  />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-rose-200 text-rose-800 flex items-center justify-center shrink-0">
                    <i className="fa-solid fa-triangle-exclamation"></i>
                  </span>
                )}
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-black truncate">
                    {flashStatus.student
                      ? `${flashStatus.student.Student_Name} (${getClassName(flashStatus.student.Class)} • #${
                          flashStatus.student.Roll_Number || flashStatus.student.Student_ID
                        })`
                      : flashStatus.message}
                  </div>
                  <div className="text-[11px] font-bold opacity-85 truncate">
                    {flashStatus.student ? `${flashStatus.message} • ${flashStatus.time}` : flashStatus.rawCode}
                  </div>
                </div>
              </div>

              <span
                className={`px-2.5 py-1 rounded-xl text-[10px] font-black shrink-0 ${
                  flashStatus.kind === 'marked'
                    ? 'bg-emerald-600 text-white'
                    : flashStatus.kind === 'already_present'
                    ? 'bg-blue-700 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {flashStatus.kind === 'marked'
                  ? '✓ PRESENT'
                  : flashStatus.kind === 'already_present'
                  ? 'ALREADY P'
                  : 'INVALID QR'}
              </span>
            </div>
          )}

          {/* Quick Fallback: Photo Upload + Manual 1-Tap Search */}
          <div className="p-3.5 bg-slate-50 border-b border-slate-200 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder="बिना QR तुरंत हाजिरी: Student ID, नाम या Roll No लिखें..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold outline-none focus:border-blue-800"
                />
              </div>

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
                className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-file-image text-blue-700"></i>
                <span>QR फोटो चुनें</span>
              </button>
            </div>

            {quickSearchMatches.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {quickSearchMatches.map((st) => {
                  const sidNorm = String(st.Student_ID || '').trim().toLowerCase();
                  const isP = alreadyPresentIds.has(sidNorm) || sessionMarkedIdsRef.current.has(sidNorm);
                  return (
                    <button
                      key={st.Student_ID}
                      type="button"
                      onClick={() => {
                        markStudentAttendanceInstant(st);
                        setManualQuery('');
                      }}
                      className="p-2 rounded-xl bg-white hover:bg-emerald-50 border border-slate-200 text-left flex items-center justify-between gap-2 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-black text-slate-900 truncate">{st.Student_Name}</div>
                        <div className="text-[10px] text-slate-500">
                          {getClassName(st.Class)} • {st.Student_ID}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black shrink-0 ${
                          isP ? 'bg-blue-100 text-blue-800' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {isP ? '✓ Present' : '+ Present'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Session Scan History */}
          <div className="p-3.5 space-y-2 bg-white">
            <div className="flex items-center justify-between text-xs font-black text-slate-800">
              <span>📋 अभी स्कैन किए गए छात्र ({sessionLogs.length})</span>
              {sessionLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSessionLogs([])}
                  className="text-[10px] font-bold text-slate-500 hover:text-rose-600 cursor-pointer"
                >
                  सूची साफ करें
                </button>
              )}
            </div>

            {sessionLogs.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 font-semibold border border-dashed border-slate-200 rounded-xl">
                कैमरे के सामने किसी भी छात्र का QR कोड दिखाएँ — तुरंत उपस्थिति दर्ज होकर यहाँ दिखेगी।
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {sessionLogs.map((item) => (
                  <div
                    key={item.id}
                    className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-black text-slate-900">{item.studentName}</span>
                      <span className="text-[10px] text-slate-500 ml-2">
                        {item.className} • #{item.rollNo}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-500 font-mono">{item.time}</span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                          item.status === 'marked'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {item.status === 'marked' ? '✓ Present' : 'Already P'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
