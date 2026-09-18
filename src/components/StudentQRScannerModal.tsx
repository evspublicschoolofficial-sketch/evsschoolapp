import React, { useEffect, useRef, useState, useMemo } from 'react';
import jsQR from 'jsqr';

export interface StudentRecordForScan {
  Student_ID?: string;
  Student_Name?: string;
  Admission_Number?: number | string;
  Roll_Number?: number | string;
  Class?: string;
  Parent_Mobile?: number | string;
  Father_Name?: string;
  Mother_Name?: string;
  Address?: string;
  Student_Photo?: string;
  [key: string]: any;
}

interface StudentQRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (scannedValue: string, matchedStudent?: StudentRecordForScan) => void;
  students: StudentRecordForScan[];
  title?: string;
  subtitle?: string;
  classMap?: Record<string, string>;
  getClassName?: (c?: string) => string;
  getStudentPhoto?: (s: StudentRecordForScan) => string;
  // Direct Action Callbacks (4 key operations requested by user)
  onTrackHomework?: (student: StudentRecordForScan) => void;
  onAssignHomework?: (student: StudentRecordForScan) => void;
  onAddFee?: (student: StudentRecordForScan) => void;
  onRecordBehavior?: (student: StudentRecordForScan) => void;
}

export const StudentQRScannerModal: React.FC<StudentQRScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
  students,
  title = 'छात्र खोजें एवं त्वरित कार्य (Find Student & Quick Actions)',
  subtitle = 'QR स्कैन, नाम, स्टूडेंट ID, मोबाइल नंबर या रोल नंबर द्वारा खोजें',
  classMap = {},
  getClassName = (c) => (c ? classMap[c] || `Class ${c}` : 'N/A'),
  getStudentPhoto = (_s?: any) => '',
  onTrackHomework,
  onAssignHomework,
  onAddFee,
  onRecordBehavior,
}) => {
  // Navigation Tabs: 'search' (default friendly mode) | 'camera' (live QR scan) | 'directory'
  const [activeTab, setActiveTab] = useState<'search' | 'camera' | 'directory'>('search');

  // Search Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedClassFilter, setSelectedClassFilter] = useState<string>('all');

  // Currently Focused / Selected Student
  const [selectedStudent, setSelectedStudent] = useState<StudentRecordForScan | null>(null);

  // Camera & QR Scanner refs and states
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameId = useRef<number | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanSuccessMessage, setScanSuccessMessage] = useState<string | null>(null);

  // Play audio/vibrate feedback on successful scan
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    } catch {}
    try {
      if (navigator.vibrate) {
        navigator.vibrate(80);
      }
    } catch {}
  };

  // Find matching student from QR content or search text
  const matchStudent = (text: string): StudentRecordForScan | undefined => {
    if (!text) return undefined;
    const clean = text.trim().toLowerCase();

    // 1. Check for EVS-STUDENT:ID format
    const evsMatch = text.match(/EVS-STUDENT:\s*([a-zA-Z0-9_-]+)/i);
    if (evsMatch && evsMatch[1]) {
      const id = evsMatch[1].trim().toLowerCase();
      const found = students.find((s) => String(s.Student_ID || '').toLowerCase() === id);
      if (found) return found;
    }

    // 1b. Check if scanned text is a QR server URL containing data or chl parameter (e.g. api.qrserver.com/?data=57dd106d)
    const urlDataMatch = text.match(/[?&](?:data|chl)=([^&]+)/i);
    if (urlDataMatch && urlDataMatch[1]) {
      const decodedParam = decodeURIComponent(urlDataMatch[1]).trim().toLowerCase();
      const byParam = students.find(
        (s) => String(s.Student_ID || '').trim().toLowerCase() === decodedParam
      );
      if (byParam) return byParam;
    }

    // 2. Exact Student_ID match
    const byId = students.find(
      (s) => String(s.Student_ID || '').trim().toLowerCase() === clean
    );
    if (byId) return byId;

    // 3. Mobile Number match (last 10 digits)
    const cleanDigits = clean.replace(/[^0-9]/g, '');
    if (cleanDigits.length >= 6) {
      const byMobile = students.find((s) => {
        const sMob = String(s.Parent_Mobile || '').replace(/[^0-9]/g, '');
        return sMob && (sMob === cleanDigits || sMob.endsWith(cleanDigits) || cleanDigits.endsWith(sMob));
      });
      if (byMobile) return byMobile;
    }

    // 4. Admission Number match
    const byAdm = students.find(
      (s) => String(s.Admission_Number || '').trim().toLowerCase() === clean
    );
    if (byAdm) return byAdm;

    // 5. Name match
    const byName = students.find(
      (s) => String(s.Student_Name || '').trim().toLowerCase() === clean
    );
    if (byName) return byName;

    // 6. Contains Student_ID
    const containedId = students.find((s) => {
      const sId = String(s.Student_ID || '').trim().toLowerCase();
      return sId && clean.includes(sId);
    });
    if (containedId) return containedId;

    // 7. Contains Student_Name
    const containedName = students.find((s) => {
      const sName = String(s.Student_Name || '').trim().toLowerCase();
      return sName.length >= 3 && clean.includes(sName);
    });
    if (containedName) return containedName;

    return undefined;
  };

  // Distinct classes for filtering
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.Class) set.add(s.Class.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // Filtered Students list based on Search and Class
  const filteredStudents = useMemo(() => {
    let result = [...students];

    if (selectedClassFilter !== 'all') {
      result = result.filter((s) => (s.Class || '').toLowerCase() === selectedClassFilter.toLowerCase());
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const qDigits = q.replace(/[^0-9]/g, '');
      result = result.filter((s) => {
        const nameMatch = String(s.Student_Name || '').toLowerCase().includes(q);
        const idMatch = String(s.Student_ID || '').toLowerCase().includes(q);
        const fatherMatch = String(s.Father_Name || '').toLowerCase().includes(q);
        const rollMatch = String(s.Roll_Number || '').toLowerCase() === q;
        const admMatch = String(s.Admission_Number || '').toLowerCase().includes(q);
        const mobStr = String(s.Parent_Mobile || '').replace(/[^0-9]/g, '');
        const mobMatch = qDigits && mobStr.includes(qDigits);

        return nameMatch || idMatch || fatherMatch || rollMatch || admMatch || mobMatch;
      });
    }

    return result;
  }, [students, selectedClassFilter, searchQuery]);

  // Handle scanned/decoded QR code
  const handleDecodedCode = (code: string) => {
    if (!code || isScanning === false) return;
    setIsScanning(false);
    playBeep();

    const matched = matchStudent(code);
    if (matched) {
      setSelectedStudent(matched);
      setScanSuccessMessage(`छात्र मिल गया: ${matched.Student_Name} (${matched.Student_ID})`);
    } else {
      setScanSuccessMessage(`QR कोड पढ़ा गया: ${code}`);
    }

    // Switch to search tab to show selected student action card
    setTimeout(() => {
      setActiveTab('search');
    }, 500);
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
    setIsScanning(false);
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
        throw new Error('इस ब्राउज़र में कैमरा उपलब्ध नहीं है। कृपया QR फोटो अपलोड करें या नाम/ID से खोजें।');
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
        msg += 'कृपया ब्राउज़र में कैमरा अनुमति (Camera Permission) दें या नीचे दिए गए गैलरी फोटो अपलोड विकल्प का प्रयोग करें।';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg += 'कोई कैमरा उपकरण नहीं मिला।';
      } else {
        msg += err.message || 'कृपया नाम/आईडी/मोबाइल से खोजें या फोटो अपलोड करें।';
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
            setCameraError('इस फोटो में QR कोड नहीं पढ़ा जा सका। कृपया स्पष्ट फोटो अपलोड करें या सीधे नाम/आईडी से खोजें।');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  useEffect(() => {
    if (isOpen) {
      setScanSuccessMessage(null);
      if (activeTab === 'camera') {
        startCamera();
      } else {
        stopCamera();
      }
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, activeTab, facingMode]);

  if (!isOpen) return null;

  // Final confirmation to select student for original target
  const handleConfirmSelect = (st: StudentRecordForScan) => {
    onScan(st.Student_ID || st.Student_Name || '', st);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Top Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-4 py-3.5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-base shadow-xs shrink-0">
              <i className="fa-solid fa-user-check"></i>
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-300 leading-tight">{title}</h3>
              <p className="text-[11px] text-slate-300">{subtitle}</p>
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

        {/* Mode Navigation Tabs */}
        <div className="bg-slate-100 border-b border-slate-200 px-3 pt-2 flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setActiveTab('search');
            }}
            className={`px-3.5 py-2 rounded-t-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer border-t-2 transition-all ${
              activeTab === 'search'
                ? 'bg-white text-blue-950 border-amber-400 shadow-xs'
                : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <i className="fa-solid fa-magnifying-glass text-blue-600"></i>
            <span>नाम / ID / मोबाइल से खोजें</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('camera');
            }}
            className={`px-3.5 py-2 rounded-t-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer border-t-2 transition-all ${
              activeTab === 'camera'
                ? 'bg-white text-blue-950 border-amber-400 shadow-xs'
                : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <i className="fa-solid fa-qrcode text-amber-600"></i>
            <span>QR कोड स्कैनर</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              setActiveTab('directory');
            }}
            className={`px-3.5 py-2 rounded-t-lg font-bold text-xs flex items-center gap-1.5 cursor-pointer border-t-2 transition-all ${
              activeTab === 'directory'
                ? 'bg-white text-blue-950 border-amber-400 shadow-xs'
                : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <i className="fa-solid fa-users text-emerald-600"></i>
            <span>कक्षावार सूची ({students.length})</span>
          </button>
        </div>

        {/* SUCCESS / SCAN BANNER */}
        {scanSuccessMessage && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2 text-xs text-emerald-800 font-semibold flex items-center justify-between shrink-0">
            <span className="flex items-center gap-1.5">
              <i className="fa-solid fa-circle-check text-emerald-600"></i>
              {scanSuccessMessage}
            </span>
            <button
              onClick={() => setScanSuccessMessage(null)}
              className="text-emerald-700 hover:text-emerald-950 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* SELECTED STUDENT ACTION CARD (If any student is selected) */}
        {selectedStudent && (
          <div className="bg-gradient-to-r from-amber-50/90 via-blue-50/80 to-amber-50/90 border-b-2 border-amber-300 p-3.5 shrink-0 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {getStudentPhoto(selectedStudent) ? (
                  <img
                    src={getStudentPhoto(selectedStudent)}
                    alt={selectedStudent.Student_Name}
                    className="w-12 h-12 rounded-xl object-cover border-2 border-amber-400 shadow-xs shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-base border-2 border-amber-400 shadow-xs shrink-0">
                    {(selectedStudent.Student_Name || 'S').slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-bold text-slate-900">
                      {selectedStudent.Student_Name}
                    </h4>
                    <span className="bg-[#0c2340] text-amber-300 text-[10px] font-mono px-2 py-0.5 rounded font-bold">
                      {selectedStudent.Student_ID}
                    </span>
                    <span className="bg-blue-100 text-blue-900 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200">
                      Class: {getClassName(selectedStudent.Class)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {selectedStudent.Father_Name && (
                      <span>पिता: <strong>{selectedStudent.Father_Name}</strong></span>
                    )}
                    {selectedStudent.Roll_Number && (
                      <span>Roll: <strong>#{selectedStudent.Roll_Number}</strong></span>
                    )}
                    {selectedStudent.Parent_Mobile && (
                      <span className="text-emerald-700 font-mono">
                        <i className="fa-solid fa-phone text-[10px] mr-1"></i>
                        {selectedStudent.Parent_Mobile}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => setSelectedStudent(null)}
                  className="px-2.5 py-1 text-[11px] text-slate-500 hover:text-slate-800 bg-white/80 hover:bg-white rounded-lg border border-slate-200 font-semibold cursor-pointer"
                >
                  अन्य छात्र चुनें
                </button>
              </div>
            </div>

            {/* 4 PRIMARY ACTION BUTTONS (चार प्रमुख कार्य) */}
            <div className="mt-3 pt-2.5 border-t border-amber-200/80">
              <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>इस छात्र के लिए कार्य चुनें (Select Action):</span>
                <button
                  type="button"
                  onClick={() => handleConfirmSelect(selectedStudent)}
                  className="text-blue-700 hover:text-blue-900 font-bold underline cursor-pointer text-[11px]"
                >
                  ✓ वर्तमान सर्च में चुनें
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* 1. कल का होमवर्क चेक करें */}
                <button
                  type="button"
                  onClick={() => {
                    if (onTrackHomework) {
                      onTrackHomework(selectedStudent);
                    } else {
                      handleConfirmSelect(selectedStudent);
                    }
                    onClose();
                  }}
                  className="p-2.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-left transition-all shadow-xs hover:shadow-md cursor-pointer flex flex-col justify-between group"
                >
                  <div className="w-7 h-7 rounded-lg bg-blue-800/80 text-amber-300 flex items-center justify-center text-xs mb-1.5 group-hover:scale-110 transition-transform">
                    <i className="fa-solid fa-list-check"></i>
                  </div>
                  <div>
                    <span className="text-xs font-bold block leading-tight">कल का HW चेक</span>
                    <span className="text-[10px] text-blue-200 block mt-0.5">Complete / Incomplete</span>
                  </div>
                </button>

                {/* 2. नया होमवर्क दें */}
                <button
                  type="button"
                  onClick={() => {
                    if (onAssignHomework) {
                      onAssignHomework(selectedStudent);
                    } else {
                      handleConfirmSelect(selectedStudent);
                    }
                    onClose();
                  }}
                  className="p-2.5 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white text-left transition-all shadow-xs hover:shadow-md cursor-pointer flex flex-col justify-between group"
                >
                  <div className="w-7 h-7 rounded-lg bg-indigo-800/80 text-amber-300 flex items-center justify-center text-xs mb-1.5 group-hover:scale-110 transition-transform">
                    <i className="fa-solid fa-cloud-arrow-up"></i>
                  </div>
                  <div>
                    <span className="text-xs font-bold block leading-tight">नया होमवर्क दें</span>
                    <span className="text-[10px] text-indigo-200 block mt-0.5">कक्षा {getClassName(selectedStudent.Class)}</span>
                  </div>
                </button>

                {/* 3. फीस जमा करें */}
                <button
                  type="button"
                  onClick={() => {
                    if (onAddFee) {
                      onAddFee(selectedStudent);
                    } else {
                      handleConfirmSelect(selectedStudent);
                    }
                    onClose();
                  }}
                  className="p-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-left transition-all shadow-xs hover:shadow-md cursor-pointer flex flex-col justify-between group"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-800/80 text-amber-300 flex items-center justify-center text-xs mb-1.5 group-hover:scale-110 transition-transform">
                    <i className="fa-solid fa-indian-rupee-sign"></i>
                  </div>
                  <div>
                    <span className="text-xs font-bold block leading-tight">फीस जमा करें</span>
                    <span className="text-[10px] text-emerald-200 block mt-0.5">रसीद व WhatsApp</span>
                  </div>
                </button>

                {/* 4. आचरण व व्यवहार दर्ज करें */}
                <button
                  type="button"
                  onClick={() => {
                    if (onRecordBehavior) {
                      onRecordBehavior(selectedStudent);
                    } else {
                      handleConfirmSelect(selectedStudent);
                    }
                    onClose();
                  }}
                  className="p-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-slate-950 text-left transition-all shadow-xs hover:shadow-md cursor-pointer flex flex-col justify-between group"
                >
                  <div className="w-7 h-7 rounded-lg bg-amber-700/80 text-white flex items-center justify-center text-xs mb-1.5 group-hover:scale-110 transition-transform">
                    <i className="fa-solid fa-star"></i>
                  </div>
                  <div>
                    <span className="text-xs font-extrabold block leading-tight text-slate-950">आचरण व व्यवहार</span>
                    <span className="text-[10px] text-slate-900/80 block mt-0.5 font-semibold">हाजिरी, सफाई, रिमार्क</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: INSTANT SEARCH (नाम, स्टूडेंट आईडी, मोबाइल, रोल नंबर) */}
        {activeTab === 'search' && (
          <div className="p-3 sm:p-4 overflow-y-auto flex-1 flex flex-col space-y-3">
            {/* Search Input and Filters */}
            <div className="space-y-2">
              <div className="relative">
                <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-3 text-slate-400 text-xs"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="छात्र का नाम, ID (जैसे STU-101), मोबाइल नंबर या Roll No लिखें..."
                  className="w-full pl-9 pr-8 py-2 rounded-xl border border-slate-300 text-xs outline-none focus:ring-2 focus:ring-blue-800 bg-white"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-2 text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Class Filter Bar */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                  कक्षा:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedClassFilter('all')}
                  className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                    selectedClassFilter === 'all'
                      ? 'bg-[#0c2340] text-amber-300'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  सभी ({students.length})
                </button>
                {availableClasses.map((cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setSelectedClassFilter(cls)}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold cursor-pointer whitespace-nowrap transition-colors ${
                      selectedClassFilter === cls
                        ? 'bg-blue-800 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {getClassName(cls)}
                  </button>
                ))}
              </div>
            </div>

            {/* Students List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[160px]">
              {filteredStudents.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <i className="fa-solid fa-user-slash text-2xl text-slate-400"></i>
                  <p className="text-xs text-slate-600 font-semibold">
                    कोई छात्र नहीं मिला &ldquo;{searchQuery}&rdquo;
                  </p>
                  <p className="text-[11px] text-slate-400">
                    कृपया सही नाम, ID (जैसे STU-101) या मोबाइल नंबर दर्ज करें या QR स्कैनर का उपयोग करें।
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('camera')}
                    className="mt-2 px-3 py-1.5 rounded-lg bg-[#0c2340] text-amber-300 text-xs font-bold hover:bg-blue-950 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <i className="fa-solid fa-qrcode"></i>
                    <span>QR कोड स्कैन करें</span>
                  </button>
                </div>
              ) : (
                filteredStudents.slice(0, 30).map((st) => {
                  const isCurSelected = selectedStudent?.Student_ID === st.Student_ID;
                  return (
                    <div
                      key={st.Student_ID || `${st.Student_Name}-${st.Class}`}
                      onClick={() => setSelectedStudent(st)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isCurSelected
                          ? 'bg-amber-50/80 border-amber-400 shadow-xs ring-2 ring-amber-300'
                          : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {getStudentPhoto(st) ? (
                          <img
                            src={getStudentPhoto(st)}
                            alt={st.Student_Name}
                            className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-100 text-[#0c2340] flex items-center justify-center font-bold text-xs shrink-0 border border-slate-200">
                            {(st.Student_Name || 'S').slice(0, 1)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-900 truncate">
                              {st.Student_Name}
                            </span>
                            <span className="text-[10px] font-mono font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                              {st.Student_ID}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                            <span>कक्षा: <strong className="text-blue-900">{getClassName(st.Class)}</strong></span>
                            {st.Father_Name && (
                              <span className="truncate">• पिता: {st.Father_Name}</span>
                            )}
                            {st.Parent_Mobile && (
                              <span className="text-emerald-700 hidden sm:inline">• {st.Parent_Mobile}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStudent(st);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                            isCurSelected
                              ? 'bg-amber-500 text-slate-950 font-extrabold'
                              : 'bg-slate-100 hover:bg-amber-100 text-slate-800'
                          }`}
                        >
                          {isCurSelected ? 'चयनित ✓' : 'चुनें'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE QR SCANNER VIEWPORT */}
        {activeTab === 'camera' && (
          <div className="flex-1 flex flex-col min-h-[300px]">
            <div className="relative bg-black flex-1 min-h-[260px] flex items-center justify-center overflow-hidden">
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
                      onClick={() => setActiveTab('search')}
                      className="px-3 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fa-solid fa-magnifying-glass"></i>
                      <span>नाम / ID से खोजें</span>
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
                    <div className="w-56 h-56 border-2 border-amber-400 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] flex flex-col justify-between p-2">
                      {/* Corners */}
                      <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-amber-300 rounded-tl-lg"></div>
                      <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-amber-300 rounded-tr-lg"></div>
                      <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-amber-300 rounded-bl-lg"></div>
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-amber-300 rounded-br-lg"></div>

                      {/* Laser line animation */}
                      <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_8px_#f59e0b] animate-bounce my-auto"></div>

                      <span className="text-[10px] text-amber-200 text-center font-bold tracking-wider uppercase bg-black/60 py-0.5 px-2 rounded mx-auto backdrop-blur-xs">
                        QR कोड कैमरे के सामने रखें
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
                      <span>{facingMode === 'environment' ? 'Rear Cam' : 'Front Cam'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Gallery Upload & Fallback footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
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
                className="py-2 px-3 rounded-xl border border-slate-300 hover:bg-white bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer flex-1"
              >
                <i className="fa-solid fa-file-image text-blue-600"></i>
                <span>गैलरी से QR फोटो चुनें</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setActiveTab('search');
                }}
                className="py-2 px-3 rounded-xl bg-blue-50 text-blue-900 hover:bg-blue-100 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-blue-200"
              >
                <i className="fa-solid fa-magnifying-glass"></i>
                <span>नाम / ID से खोजें</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: CLASS-WISE DIRECTORY */}
        {activeTab === 'directory' && (
          <div className="p-4 overflow-y-auto flex-1 space-y-4">
            <p className="text-xs text-slate-500">
              कक्षा का चयन करें और किसी भी छात्र पर क्लिक करके होमवर्क, फीस या आचरण दर्ज करें:
            </p>
            <div className="space-y-4">
              {availableClasses.map((cls) => {
                const classStudents = students.filter((s) => s.Class === cls);
                return (
                  <div key={cls} className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-xs text-blue-950 flex items-center gap-1.5">
                        <i className="fa-solid fa-graduation-cap text-amber-500"></i>
                        कक्षा: {getClassName(cls)}
                      </h4>
                      <span className="text-[10px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                        {classStudents.length} छात्र
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {classStudents.map((st) => (
                        <button
                          key={st.Student_ID}
                          type="button"
                          onClick={() => {
                            setSelectedStudent(st);
                            setActiveTab('search');
                          }}
                          className="p-2 bg-white rounded-lg border border-slate-200 hover:border-amber-400 hover:bg-amber-50/50 text-left transition-all cursor-pointer flex items-center gap-2"
                        >
                          <div className="w-7 h-7 rounded-full bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-[10px] shrink-0">
                            {(st.Student_Name || 'S').slice(0, 1)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-xs text-slate-900 truncate">
                              {st.Student_Name}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              ID: {st.Student_ID} {st.Roll_Number ? `• Roll #${st.Roll_Number}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-4 py-2.5 bg-slate-100 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span className="text-[11px]">
            कुल छात्र: <strong className="text-slate-800">{students.length}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold transition-colors cursor-pointer text-xs"
          >
            बंद करें
          </button>
        </div>
      </div>
    </div>
  );
};
