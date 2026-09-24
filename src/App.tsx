import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ReferenceLine,
} from 'recharts';
import { StudentQRScannerModal } from './components/StudentQRScannerModal';
import { AddFeeModal } from './components/AddFeeModal';
import { AddStudentModal } from './components/AddStudentModal';
import { StudentHomeworkQRTrackerModal } from './components/StudentHomeworkQRTrackerModal';
import { ManagerFeeDashboard } from './components/ManagerFeeDashboard';
import { StudentBehaviorModal, StudentBehaviorInput } from './components/StudentBehaviorModal';
import { DriverPortal } from './components/DriverPortal';
import { ManagerVanTracker } from './components/ManagerVanTracker';
import { StudentAvatar } from './components/StudentAvatar';
import { ManagerOverviewModals } from './components/ManagerOverviewModals';
import studentFarahPhoto from './assets/images/student_farah_1789483069291.jpg';
import studentNamraPhoto from './assets/images/student_namra_1789483091505.jpg';

const API_URL = 'https://script.google.com/macros/s/AKfycbwVy51K14qu6IXipAZXP4NspFcAUHpLcYv8-zjhkYnBlUI17TzGi_KaJU9TRmNT8D5vvQ/exec';

// Types
export interface Student {
  Student_ID: string;
  Admission_Number: string | number;
  Roll_Number: string | number;
  Student_Name: string;
  Class: string;
  Father_Name: string;
  Mother_Name: string;
  Parent_Mobile: string | number;
  Student_Photo?: string;
  'Village/rRoute'?: string;
  Village?: string;
  Balance_Amount?: number | string;
  'QR code'?: string;
  'QR_code'?: string;
  QRCode?: string;
  qr_code?: string;
  [key: string]: any;
}

export interface FeeCollectionRecord {
  Receipt_Number?: string;
  Student_ID: string;
  Date?: string;
  Fee_Type?: string;
  Month?: string;
  Total_Amount?: number | null;
  Amount_Paid?: number | null;
  Balance_Amount?: number | null;
  Payment_Mode?: string;
  Received_By?: string;
}

export interface Homework {
  Homework_ID: string;
  Date: string;
  Class: string;
  Subject: string;
  Homework_Detail: string;
  Target_Type?: string;
  Student_ID?: string;
  Homework_Photo?: string;
  Homework_Photo_2?: string;
  Homework_PDF?: string;
  Teacher?: string;
  [key: string]: any;
}

// Homework Tracker Record (from Google Sheet: Homework_Tracker)
export interface HomeworkTrackerRecord {
  ID: string;
  Date: string;
  Class: string;
  Student_ID: string;
  Subject: string;
  Last_homework_Status: 'Completed' | 'Incompleted' | string;
}

// Student Behavior Record (from Google Sheet: Student_Behavior)
export interface StudentBehaviorRecord {
  Behavior_ID: string;
  Student_ID: string;
  Date: string;
  Class: string;
  Is_Bathed: boolean;
  Nails_Clean: boolean;
  Uniform_clean: boolean;
  Good_Manners: string;
  Discipline: boolean;
  Is_Present: boolean;
  Remark: string;
  AI_Feedback?: string;
}

// School User / Staff Record (from Google Sheet: Users)
export interface SchoolUser {
  User_ID: string;
  Mobile_number: string | number;
  Username: string;
  Password?: string;
  Name: string;
  Designation: string;
  Assigned_Class?: string;
  Last_AI_Run?: string;
}

const SPREADSHEET_ID = '1AHQowKTK_xrPHTzH85nR3Hm3PsL6J5F7_KTZ7QytERU';

// Default standard Class ID to Class Name dictionary (from Classes sheet)
const DEFAULT_CLASS_MAP: Record<string, string> = {
  C1: 'Play',
  C2: 'Nursery (M1)',
  C3: 'LKG (M2)',
  C4: 'UKG (M3)',
  C5: '1st',
  C6: '2nd',
  C7: '3rd',
  C8: '4th',
  C9: '5th',
  C10: '6th',
  C11: '7th',
  C12: '8th',
};

// LocalStorage Cache Keys & Constants for 0.1s Instant Load (Stale-While-Revalidate)
export const CACHE_KEY_STUDENTS = 'evs_cache_students';
export const CACHE_KEY_HOMEWORK = 'evs_cache_homework';
export const CACHE_KEY_CLASSES = 'evs_cache_classes';
export const CACHE_KEY_FEES_RECORDS = 'evs_cache_fees_records';
export const CACHE_KEY_FEES_BALANCES = 'evs_cache_fees_balances';
export const CACHE_KEY_HW_TRACKER = 'evs_cache_hw_tracker';
export const CACHE_KEY_BEHAVIOR = 'evs_cache_behavior';
export const CACHE_KEY_USERS = 'evs_cache_users';
export const CACHE_KEY_TIMESTAMP = 'evs_cache_timestamp';
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Hour Cache Expiration

export function getCachedData<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) return fallback;
    const parsed = JSON.parse(item);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Convert Google Drive link or standard URL to an image link
export const formatImageUrl = (url: string | null | undefined): string => {
  if (!url) return '';
  const str = String(url).trim();
  if (!str) return '';
  // Check if Drive file URL
  const driveMatch =
    str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    str.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
    str.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    // Automatically convert Google Drive URLs to direct viewable links: https://lh3.googleusercontent.com/d/FILE_ID
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }
  return str;
};

// Homework Media Attachment definition
export interface HomeworkMediaItem {
  id: string;
  type: 'image' | 'pdf';
  title: string;
  labelHindi: string;
  fileName: string;
  url: string;
  fallbackUrl?: string;
  openUrl: string;
  isDrive: boolean;
  isAppSheet: boolean;
}

// Extract all valid photos and PDFs from a Homework object
export const extractHomeworkMedia = (hw: Homework): HomeworkMediaItem[] => {
  const items: HomeworkMediaItem[] = [];

  const processField = (
    val: string | undefined | null,
    defaultTitle: string,
    labelHindi: string,
    defaultType: 'image' | 'pdf'
  ) => {
    if (!val) return;
    const str = String(val).trim();
    if (!str || str === 'undefined' || str === 'null' || str === '—') return;

    const lower = str.toLowerCase();
    const isPdfExt = lower.includes('.pdf');
    const isImageExt = lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp');
    const type: 'image' | 'pdf' = isPdfExt && !isImageExt ? 'pdf' : defaultType;
    const fileName = str.split('/').pop() || str;

    // 1. Google Drive Link
    const driveMatch = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (driveMatch && driveMatch[1]) {
      const fileId = driveMatch[1];
      if (type === 'image') {
        items.push({
          id: `${hw.Homework_ID}-${defaultTitle}`,
          type: 'image',
          title: defaultTitle,
          labelHindi,
          fileName,
          url: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`,
          fallbackUrl: `https://lh3.googleusercontent.com/d/${fileId}=w1200`,
          openUrl: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
          isDrive: true,
          isAppSheet: false,
        });
      } else {
        items.push({
          id: `${hw.Homework_ID}-${defaultTitle}`,
          type: 'pdf',
          title: defaultTitle,
          labelHindi,
          fileName,
          url: `https://docs.google.com/viewer?url=${encodeURIComponent(`https://drive.google.com/uc?export=download&id=${fileId}`)}&embedded=true`,
          fallbackUrl: `https://drive.google.com/file/d/${fileId}/preview`,
          openUrl: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
          isDrive: true,
          isAppSheet: false,
        });
      }
      return;
    }

    // 2. Direct Web URL (http:// or https://)
    if (str.startsWith('http://') || str.startsWith('https://')) {
      if (type === 'image') {
        items.push({
          id: `${hw.Homework_ID}-${defaultTitle}`,
          type: 'image',
          title: defaultTitle,
          labelHindi,
          fileName,
          url: str,
          fallbackUrl: str,
          openUrl: str,
          isDrive: false,
          isAppSheet: false,
        });
      } else {
        items.push({
          id: `${hw.Homework_ID}-${defaultTitle}`,
          type: 'pdf',
          title: defaultTitle,
          labelHindi,
          fileName,
          url: `https://docs.google.com/viewer?url=${encodeURIComponent(str)}&embedded=true`,
          openUrl: str,
          isDrive: false,
          isAppSheet: false,
        });
      }
      return;
    }

    // 3. AppSheet Relative Paths (e.g., Homework_Images/6407be5e.Homework_Photo.094535.jpg)
    const isAppSheet = str.includes('Homework_Images') || str.includes('Homework_Files_') || str.includes('/');
    // Use AppSheet table file URL candidate as well as drive search
    const appSheetUrl = `https://www.appsheet.com/template/gettablefileurl?appName=SchoolApp&tableName=Homework&fileName=${encodeURIComponent(str)}`;
    const driveSearchUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(fileName)}`;

    items.push({
      id: `${hw.Homework_ID}-${defaultTitle}`,
      type,
      title: defaultTitle,
      labelHindi,
      fileName,
      url: appSheetUrl,
      fallbackUrl: appSheetUrl,
      openUrl: driveSearchUrl,
      isDrive: false,
      isAppSheet,
    });
  };

  // Helper to find field value across common naming variations
  const findValue = (candidates: string[]): string | undefined => {
    for (const c of candidates) {
      if (hw[c] && String(hw[c]).trim() !== '') return String(hw[c]).trim();
    }
    for (const [k, v] of Object.entries(hw)) {
      const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const c of candidates) {
        if (cleanK === c.toLowerCase().replace(/[^a-z0-9]/g, '') && v && String(v).trim() !== '') {
          return String(v).trim();
        }
      }
    }
    return undefined;
  };

  const photo1 = findValue(['Homework_Photo', 'Homework Photo', 'Homework_Photo_1', 'Homework Photo 1', 'Photo', 'Photo_1', 'Image', 'Image_1']);
  const photo2 = findValue(['Homework_Photo_2', 'Homework Photo 2', 'Photo_2', 'Image_2', 'Homework_Photo_Extra']);
  const pdfFile = findValue(['Homework_PDF', 'Homework PDF', 'PDF', 'Document', 'Homework_Doc', 'File']);

  processField(photo1, 'Homework Photo 1', 'गृहकार्य फ़ोटो 1', 'image');
  processField(photo2, 'Homework Photo 2', 'गृहकार्य फ़ोटो 2', 'image');
  processField(pdfFile, 'Homework PDF Document', 'गृहकार्य PDF फ़ाइल', 'pdf');

  return items;
};

// Official Student QR Code Component
interface StudentQRCodeCardProps {
  student: Student;
  classNameTitle?: string;
  photoUrl?: string;
  variant?: 'modal' | 'profile' | 'compact';
  onEnlarge?: () => void;
  onRemove?: () => void;
}

export const StudentQRCodeCard: React.FC<StudentQRCodeCardProps> = ({
  student,
  classNameTitle,
  photoUrl,
  variant = 'modal',
  onEnlarge,
  onRemove,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [imageError, setImageError] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Check if student has raw QR value from Google Sheet
  const rawQR = String(
    student['QR code'] ||
    student['QR_code'] ||
    student['QRCode'] ||
    student['QR Code'] ||
    student.qr_code ||
    student.QR_Code ||
    student.qr ||
    ''
  ).trim();

  // Official Google Sheet Student QR code URL based on sheet formula:
  // =IMAGE(CONCATENATE("https://api.qrserver.com/v1/create-qr-code/?data=", A2, "&size=250x250"))
  const sheetQrUrl = useMemo(() => {
    if (rawQR && (rawQR.startsWith('http://') || rawQR.startsWith('https://') || rawQR.startsWith('data:image/'))) {
      return formatImageUrl(rawQR);
    }
    const studentId = String(student.Student_ID || '').trim();
    if (studentId) {
      return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(studentId)}&size=250x250`;
    }
    return '';
  }, [rawQR, student.Student_ID]);

  // Is rawQR an image URL (Google Drive, qrserver or direct web image link)?
  const isImageUrl = useMemo(() => {
    if (sheetQrUrl) return true;
    if (!rawQR) return false;
    if (rawQR.startsWith('data:image/')) return true;
    if (rawQR.includes('drive.google.com') || rawQR.includes('googleusercontent.com') || rawQR.includes('qrserver.com')) return true;
    if (/^https?:\/\/.*\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(rawQR)) return true;
    return false;
  }, [rawQR, sheetQrUrl]);

  const formattedQrImageUrl = useMemo(() => {
    if (sheetQrUrl) return sheetQrUrl;
    if (isImageUrl) return formatImageUrl(rawQR);
    return '';
  }, [sheetQrUrl, isImageUrl, rawQR]);

  // Generate dynamic QR code matching Google Sheet student QR code logic (encodes student.Student_ID)
  useEffect(() => {
    let isMounted = true;
    const generateQR = async () => {
      try {
        const studentId = String(student.Student_ID || '').trim();
        // The QR code generated in the Google Sheet encodes the student's unique ID
        const textToEncode = (rawQR && !isImageUrl)
          ? rawQR
          : studentId;

        if (!textToEncode) return;

        const url = await QRCode.toDataURL(textToEncode, {
          width: 320,
          margin: 1.5,
          color: {
            dark: '#0c2340', // Deep Navy theme
            light: '#ffffff',
          },
          errorCorrectionLevel: 'H',
        });
        if (isMounted) {
          setQrDataUrl(url);
        }
      } catch (err) {
        console.error('Error generating student QR code:', err);
      }
    };
    generateQR();
    return () => {
      isMounted = false;
    };
  }, [student, rawQR, isImageUrl]);

  const effectiveQrSrc = (!imageError && formattedQrImageUrl) ? formattedQrImageUrl : qrDataUrl;

  const handleDownloadQR = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Prefer crisp data URL for direct download, fallback to effectiveQrSrc
    const downloadSrc = qrDataUrl || effectiveQrSrc;
    if (!downloadSrc) return;
    const a = document.createElement('a');
    a.href = downloadSrc;
    a.download = `${String(student.Student_Name || 'Student').replace(/[^a-zA-Z0-9_-]/g, '_')}_ID_${student.Student_ID}_QR.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleCopyID = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    navigator.clipboard.writeText(String(student.Student_ID || ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintCard = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const sName = student.Student_Name || 'Student';
    const cName = classNameTitle || student.Class;
    const effectivePhoto = photoUrl || (student.Student_Photo ? formatImageUrl(student.Student_Photo) : '');
    const printQrSrc = qrDataUrl || effectiveQrSrc;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Student ID Card - ${sName}</title>
          <style>
            @media print {
              body { background: white; padding: 0; }
              .no-print { display: none !important; }
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: #f1f5f9;
              padding: 24px;
              margin: 0;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
            }
            .id-card {
              width: 330px;
              background: #ffffff;
              border-radius: 16px;
              border: 2px solid #0c2340;
              box-shadow: 0 8px 24px rgba(0,0,0,0.12);
              overflow: hidden;
            }
            .card-header {
              background: #0c2340;
              color: #fde047;
              padding: 16px;
              text-align: center;
            }
            .card-header h2 {
              margin: 0;
              font-size: 16px;
              font-weight: 800;
              letter-spacing: 0.5px;
            }
            .card-header p {
              margin: 4px 0 0;
              font-size: 10px;
              color: #93c5fd;
              font-weight: 600;
            }
            .card-body {
              padding: 16px 20px;
              text-align: center;
            }
            .photo-wrapper {
              margin-bottom: 12px;
            }
            .photo-wrapper img {
              width: 80px;
              height: 80px;
              border-radius: 14px;
              object-fit: cover;
              border: 2px solid #0c2340;
              display: inline-block;
            }
            .qr-wrapper {
              display: inline-block;
              background: white;
              padding: 8px;
              border: 2px solid #cbd5e1;
              border-radius: 12px;
              margin-bottom: 12px;
            }
            .qr-wrapper img {
              width: 140px;
              height: 140px;
              display: block;
            }
            .student-name {
              font-size: 16px;
              font-weight: 800;
              color: #0f172a;
              margin: 0 0 2px;
            }
            .student-class {
              font-size: 12px;
              font-weight: 700;
              color: #1e40af;
              margin: 0 0 12px;
            }
            .data-table {
              width: 100%;
              border-collapse: collapse;
              text-align: left;
              font-size: 11px;
            }
            .data-table td {
              padding: 4px 6px;
              border-bottom: 1px solid #f1f5f9;
            }
            .data-table td.lbl {
              color: #64748b;
              font-weight: 600;
              width: 44%;
            }
            .data-table td.val {
              color: #0f172a;
              font-weight: 700;
            }
            .card-footer {
              background: #f8fafc;
              border-top: 1px solid #e2e8f0;
              padding: 10px;
              font-size: 9px;
              color: #64748b;
              text-align: center;
              font-weight: 500;
            }
            .print-btn {
              margin-top: 16px;
              padding: 8px 18px;
              background: #0c2340;
              color: #fde047;
              border: none;
              border-radius: 8px;
              font-size: 12px;
              font-weight: bold;
              cursor: pointer;
            }
          </style>
        </head>
        <body>
          <div class="id-card">
            <div class="card-header">
              <h2>E.V.S. PUBLIC SCHOOL</h2>
              <p>DIGITAL STUDENT IDENTIFICATION PASS</p>
            </div>
            <div class="card-body">
              ${effectivePhoto ? `
                <div class="photo-wrapper">
                  <img src="${effectivePhoto}" alt="${sName}" />
                </div>
              ` : ''}
              <div class="qr-wrapper">
                <img src="${printQrSrc}" alt="QR" />
              </div>
              <div class="student-name">${sName}</div>
              <div class="student-class">Class: ${cName} | Student ID: ${student.Student_ID}</div>
              <table class="data-table">
                <tr><td class="lbl">Admission No:</td><td class="val">${student.Admission_Number || '—'}</td></tr>
                <tr><td class="lbl">Roll Number:</td><td class="val">${student.Roll_Number || '—'}</td></tr>
                <tr><td class="lbl">Father's Name:</td><td class="val">${student.Father_Name || '—'}</td></tr>
                <tr><td class="lbl">Mother's Name:</td><td class="val">${student.Mother_Name || '—'}</td></tr>
                <tr><td class="lbl">Parent Mobile:</td><td class="val">${student.Parent_Mobile || '—'}</td></tr>
                <tr><td class="lbl">Village / Route:</td><td class="val">${student['Village/rRoute'] || student.Village || '—'}</td></tr>
              </table>
            </div>
            <div class="card-footer">
              Official QR code for campus gate access & school records.
            </div>
          </div>
          <button class="print-btn no-print" onclick="window.print()">Print ID Pass</button>
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 400);
            };
          </script>
        </body>
      </html>
    `;

    try {
      const printWindow = window.open('', '_blank', 'width=460,height=680');
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        return;
      }
    } catch {
      // Window popup was blocked
    }

    // Fallback: create an invisible iframe to trigger print dialog safely in sandboxed / iframe views
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc) {
        doc.open();
        doc.write(htmlContent);
        doc.close();
        iframe.contentWindow?.focus();
        setTimeout(() => {
          iframe.contentWindow?.print();
          setTimeout(() => {
            if (document.body.contains(iframe)) {
              document.body.removeChild(iframe);
            }
          }, 1000);
        }, 500);
      }
    } catch (printErr) {
      console.error('Error printing student card:', printErr);
    }
  };

  // Compact variant (for table actions or thumbnails)
  if (variant === 'compact') {
    return (
      <div
        onClick={onEnlarge}
        className="flex items-center gap-1.5 p-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white transition-all cursor-pointer shadow-2xs group"
        title="Click to view student QR code"
      >
        <div className="w-7 h-7 rounded bg-white border border-slate-200 flex items-center justify-center p-0.5 overflow-hidden shrink-0">
          {effectiveQrSrc ? (
            <img
              src={effectiveQrSrc}
              alt="QR"
              className="w-full h-full object-contain"
              onError={() => setImageError(true)}
            />
          ) : (
            <i className="fa-solid fa-qrcode text-slate-400 text-xs"></i>
          )}
        </div>
        <span className="text-[10px] font-bold text-[#0c2340] group-hover:text-blue-700 flex items-center gap-1 pr-1">
          <i className="fa-solid fa-qrcode text-amber-500"></i>
          QR
        </span>
      </div>
    );
  }

  // Profile variant (in Parent Portal)
  if (variant === 'profile') {
    return (
      <div className="bg-gradient-to-br from-slate-50 via-blue-50/40 to-slate-50 rounded-xl border border-blue-200/80 p-4 flex flex-col sm:flex-row items-center gap-4 shadow-2xs">
        {/* QR image preview */}
        <div
          onClick={onEnlarge}
          className="relative bg-white p-2.5 rounded-xl border-2 border-[#0c2340]/25 shadow-xs cursor-pointer hover:border-blue-700 transition-all group shrink-0"
          title="Click to zoom student QR code"
        >
          {effectiveQrSrc ? (
            <img
              src={effectiveQrSrc}
              alt={`QR Code of ${student.Student_Name}`}
              className="w-24 h-24 sm:w-28 sm:h-28 object-contain rounded-md"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center text-slate-400">
              <i className="fa-solid fa-spinner fa-spin text-xl"></i>
            </div>
          )}
          <span className="absolute bottom-1.5 right-1.5 bg-[#0c2340] text-amber-300 text-[9px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
            <i className="fa-solid fa-magnifying-glass-plus mr-0.5"></i>Zoom
          </span>
        </div>

        {/* Text & Quick Actions */}
        <div className="flex-1 text-center sm:text-left space-y-2">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
            <span className="bg-[#0c2340] text-amber-300 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
              <i className="fa-solid fa-qrcode text-amber-400"></i>
              Student Official QR Code
            </span>
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200">
              Verified Student Pass
            </span>
          </div>

          <div className="text-xs text-slate-700">
            <span className="font-semibold">Student ID:</span>{' '}
            <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
              {student.Student_ID}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Present this QR code for gate entry, morning attendance tracking, and school fee counter verification.
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
            <button
              type="button"
              onClick={handleDownloadQR}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-bold transition-colors shadow-2xs cursor-pointer"
              title="Download QR code image to your device"
            >
              <i className="fa-solid fa-download text-[11px]"></i>
              <span>Download QR</span>
            </button>

            <button
              type="button"
              onClick={handlePrintCard}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
              title="Print student ID card"
            >
              <i className="fa-solid fa-print text-[11px] text-slate-500"></i>
              <span>Print ID Pass</span>
            </button>

            {onEnlarge && (
              <button
                type="button"
                onClick={onEnlarge}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-blue-50 text-blue-900 border border-blue-200 text-xs font-semibold transition-colors cursor-pointer"
                title="View enlarged QR code"
              >
                <i className="fa-solid fa-expand text-[11px] text-blue-700"></i>
                <span>Enlarge</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Modal variant (inside Manager Portal View Card modal)
  return (
    <div className="bg-slate-50/90 rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#0c2340] text-amber-400 flex items-center justify-center text-xs font-bold shadow-2xs">
            <i className="fa-solid fa-qrcode"></i>
          </div>
          <div>
            <span className="text-xs font-bold text-slate-900 block leading-tight">Student Digital QR Code</span>
            <span className="text-[10px] text-slate-500 font-mono">ID: {student.Student_ID}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] bg-blue-100 text-blue-900 font-bold px-2 py-0.5 rounded-full border border-blue-200">
            Official QR
          </span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-[11px] px-2 py-0.5 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold border border-rose-200 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
              title="यह पास हटाएं / छिपाएं (Remove/Hide Pass)"
            >
              <i className="fa-solid fa-trash-can text-[10px]"></i>
              <span>पास हटाएं (Remove Pass)</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4">
        {/* QR Code Container */}
        <div
          onClick={onEnlarge}
          className="relative bg-white p-2.5 rounded-xl border-2 border-[#0c2340]/25 shadow-xs cursor-pointer hover:border-blue-800 transition-all group shrink-0"
          title="Click to view full size"
        >
          {effectiveQrSrc ? (
            <img
              src={effectiveQrSrc}
              alt={`QR of ${student.Student_Name}`}
              className="w-28 h-28 object-contain rounded-md"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-28 h-28 flex items-center justify-center text-slate-400">
              <i className="fa-solid fa-spinner fa-spin text-xl"></i>
            </div>
          )}
          <span className="absolute bottom-1.5 right-1.5 bg-[#0c2340] text-amber-300 text-[9px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
            <i className="fa-solid fa-expand mr-0.5"></i>Zoom
          </span>
        </div>

        {/* QR Meta and Actions */}
        <div className="flex-1 text-center sm:text-left space-y-2">
          <p className="text-xs text-slate-600 leading-relaxed">
            Official QR badge for <strong className="text-slate-900">{student.Student_Name}</strong> (Class {classNameTitle || student.Class}). Scan with any smartphone or barcode reader to verify student credentials.
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
            <button
              type="button"
              onClick={handleDownloadQR}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0c2340] hover:bg-[#10316b] text-amber-300 text-xs font-bold transition-colors shadow-2xs cursor-pointer"
              title="Download QR code as PNG image"
            >
              <i className="fa-solid fa-download text-[11px]"></i>
              <span>Download QR</span>
            </button>

            <button
              type="button"
              onClick={handlePrintCard}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
              title="Print ID card with QR code"
            >
              <i className="fa-solid fa-print text-[11px] text-slate-500"></i>
              <span>Print ID Pass</span>
            </button>

            <button
              type="button"
              onClick={handleCopyID}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
              title="Copy Student ID"
            >
              <i className={`fa-solid ${copied ? 'fa-check text-emerald-600' : 'fa-copy text-slate-400'} text-[11px]`}></i>
              <span>{copied ? 'Copied!' : 'Copy ID'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Homework Media Attachment components
interface HomeworkMediaAttachmentListProps {
  homework: Homework;
  onOpenMedia: (item: HomeworkMediaItem) => void;
  compact?: boolean;
}

export const HomeworkMediaAttachmentList: React.FC<HomeworkMediaAttachmentListProps> = ({
  homework,
  onOpenMedia,
  compact = false,
}) => {
  const mediaItems = useMemo(() => extractHomeworkMedia(homework), [homework]);

  if (mediaItems.length === 0) return null;

  return (
    <div className={`mt-3 pt-3 border-t border-slate-100 ${compact ? 'space-y-2' : 'space-y-2.5'}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide">
          <i className="fa-solid fa-paperclip text-blue-900"></i>
          संलग्न सामग्री / Attachments ({mediaItems.length})
        </span>
        <span className="text-[10px] text-slate-600 font-medium">Click to view/zoom</span>
      </div>

      <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-2`}>
        {mediaItems.map((item) => (
          <HomeworkMediaCard key={item.id} item={item} onOpen={() => onOpenMedia(item)} />
        ))}
      </div>
    </div>
  );
};

interface HomeworkMediaCardProps {
  item: HomeworkMediaItem;
  onOpen: () => void;
}

const HomeworkMediaCard: React.FC<HomeworkMediaCardProps> = ({ item, onOpen }) => {
  const [loadFailed, setLoadFailed] = useState<boolean>(false);

  if (item.type === 'pdf') {
    return (
      <div
        onClick={onOpen}
        className="group flex items-center justify-between p-2.5 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100/80 hover:border-rose-300 transition-all cursor-pointer shadow-2xs"
      >
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center text-sm shadow-xs shrink-0 group-hover:scale-105 transition-transform">
            <i className="fa-solid fa-file-pdf"></i>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-rose-950 truncate">{item.labelHindi}</p>
            <p className="text-[10px] text-rose-700 truncate">{item.fileName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="px-2.5 py-1 rounded-lg bg-white text-rose-700 hover:bg-rose-600 hover:text-white border border-rose-300 text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
          >
            <i className="fa-solid fa-eye text-[10px]"></i>
            <span>PDF पढ़ें</span>
          </button>
          <a
            href={item.openUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="px-2 py-1 rounded-lg bg-rose-600 text-white hover:bg-rose-700 text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs"
            title="सीधे नए टैब / Google Drive में खोलें"
          >
            <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            <span className="hidden sm:inline">खोलें</span>
          </a>
        </div>
      </div>
    );
  }

  // Image Card
  return (
    <div
      onClick={onOpen}
      className="group flex items-center justify-between p-2.5 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100/80 hover:border-blue-300 transition-all cursor-pointer shadow-2xs"
    >
      <div className="flex items-center gap-2.5 min-w-0 pr-2">
        <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-blue-300/80 bg-white shrink-0 flex items-center justify-center shadow-2xs">
          {!loadFailed && item.url ? (
            <img
              src={item.url}
              alt={item.title}
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
              onError={() => setLoadFailed(true)}
              loading="lazy"
            />
          ) : (
            <i className="fa-solid fa-image text-blue-900 text-lg"></i>
          )}
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <i className="fa-solid fa-magnifying-glass-plus text-white text-xs"></i>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-blue-950 truncate">{item.labelHindi}</p>
          <p className="text-[10px] text-blue-700 truncate">{item.fileName}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="px-2.5 py-1 rounded-lg bg-white text-blue-900 hover:bg-blue-900 hover:text-white border border-blue-300 text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs cursor-pointer"
        >
          <i className="fa-solid fa-expand text-[10px]"></i>
          <span>फ़ोटो देखें</span>
        </button>
        <a
          href={item.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="px-2 py-1 rounded-lg bg-[#0c2340] text-amber-300 hover:bg-blue-950 text-[11px] font-bold transition-all flex items-center gap-1 shadow-2xs"
          title="सीधे नए टैब / Google Drive में खोलें"
        >
          <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
          <span className="text-[10px] sm:text-[11px]">खोलें</span>
        </a>
      </div>
    </div>
  );
};

type TabType = 'home' | 'parent' | 'teacher' | 'manager' | 'driver';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    try {
      const saved = localStorage.getItem('evs_active_tab');
      if (saved && ['home', 'parent', 'teacher', 'manager', 'driver'].includes(saved)) {
        return saved as TabType;
      }
    } catch {}
    return 'home';
  });

  // Persist activeTab so when user re-opens the app or browser, it opens exactly where they were
  useEffect(() => {
    try {
      localStorage.setItem('evs_active_tab', activeTab);
    } catch {}
  }, [activeTab]);

  // LocalStorage cached initial states (0.1s instant render)
  const [students, setStudents] = useState<Student[]>(() => getCachedData<Student[]>(CACHE_KEY_STUDENTS, []));
  const [homeworkList, setHomeworkList] = useState<Homework[]>(() => getCachedData<Homework[]>(CACHE_KEY_HOMEWORK, []));
  const [loadingStudents, setLoadingStudents] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY_STUDENTS);
      return !cached;
    } catch {
      return false;
    }
  });
  const [loadingHomework, setLoadingHomework] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY_HOMEWORK);
      return !cached;
    } catch {
      return false;
    }
  });
  const [apiError, setApiError] = useState<string | null>(null);

  // Dynamic Class mapping state
  const [classMap, setClassMap] = useState<Record<string, string>>(() => getCachedData<Record<string, string>>(CACHE_KEY_CLASSES, DEFAULT_CLASS_MAP));
  // Fee Collection balance amounts by Student ID (lowercase)
  const [feeBalances, setFeeBalances] = useState<Record<string, number>>(() => getCachedData<Record<string, number>>(CACHE_KEY_FEES_BALANCES, {}));
  const [feeRecords, setFeeRecords] = useState<FeeCollectionRecord[]>(() => getCachedData<FeeCollectionRecord[]>(CACHE_KEY_FEES_RECORDS, []));
  const [loadingFees, setLoadingFees] = useState<boolean>(false);

  // Background Sync & Caching States
  const [isBackgroundSyncing, setIsBackgroundSyncing] = useState<boolean>(false);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number>(() => {
    try {
      const val = localStorage.getItem(CACHE_KEY_TIMESTAMP);
      return val ? parseInt(val, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });
  const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);

  // Parent Portal State (persisted so parents stay on their child's portal on refresh)
  const [parentMobileInput, setParentMobileInput] = useState<string>(() => {
    try {
      return localStorage.getItem('evs_parent_mobile_input') || '';
    } catch {
      return '';
    }
  });
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(() => {
    try {
      const saved = localStorage.getItem('evs_parent_selected_student');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [parentChildren, setParentChildren] = useState<Student[]>(() => {
    try {
      const saved = localStorage.getItem('evs_parent_children');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [parentLoggedIn, setParentLoggedIn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('evs_parent_logged_in') === 'true';
    } catch {
      return false;
    }
  });

  // Sync parent login session to localStorage
  useEffect(() => {
    try {
      if (parentLoggedIn) {
        localStorage.setItem('evs_parent_logged_in', 'true');
        if (selectedStudent) {
          localStorage.setItem('evs_parent_selected_student', JSON.stringify(selectedStudent));
        }
        if (parentChildren.length > 0) {
          localStorage.setItem('evs_parent_children', JSON.stringify(parentChildren));
        }
        if (parentMobileInput) {
          localStorage.setItem('evs_parent_mobile_input', parentMobileInput);
        }
      } else {
        localStorage.removeItem('evs_parent_logged_in');
        localStorage.removeItem('evs_parent_selected_student');
        localStorage.removeItem('evs_parent_children');
        localStorage.removeItem('evs_parent_mobile_input');
      }
    } catch {}
  }, [parentLoggedIn, selectedStudent, parentChildren, parentMobileInput]);

  const [parentSearchAttempted, setParentSearchAttempted] = useState<boolean>(false);
  const [manualLinkOpen, setManualLinkOpen] = useState<boolean>(false);
  const [manualLinkInput, setManualLinkInput] = useState<string>('');
  const [manualLinkError, setManualLinkError] = useState<string | null>(null);
  const [manualLinkSuccess, setManualLinkSuccess] = useState<string | null>(null);
  const [hwFilterType, setHwFilterType] = useState<'all' | 'class' | 'student'>('all');
  const [hwDaysFilter, setHwDaysFilter] = useState<'latest' | 'all'>('latest');
  const [parentActiveSection, setParentActiveSection] = useState<'overview' | 'homework' | 'tracker' | 'behavior' | 'fees' | 'profile'>('overview');
  const [trackerStatusFilter, setTrackerStatusFilter] = useState<'all' | 'completed' | 'incompleted'>('all');

  // Custom student photos persisted in localStorage
  const [customPhotos, setCustomPhotos] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('evs_student_photos');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const photoFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [uploadingForStudentId, setUploadingForStudentId] = useState<string | null>(null);

  const saveStudentPhoto = (studentId: string, dataUrl: string) => {
    const sId = String(studentId || '').trim().toLowerCase();
    if (!sId) return;
    setCustomPhotos((prev) => {
      const updated = { ...prev, [sId]: dataUrl };
      try {
        localStorage.setItem('evs_student_photos', JSON.stringify(updated));
      } catch (e) {
        console.warn('Could not save photo to localStorage', e);
      }
      return updated;
    });
  };

  const handleTriggerPhotoUpload = (studentId: string) => {
    setUploadingForStudentId(studentId);
    if (photoFileInputRef.current) {
      photoFileInputRef.current.value = '';
      photoFileInputRef.current.click();
    }
  };

  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingForStudentId) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl === 'string') {
        saveStudentPhoto(uploadingForStudentId, dataUrl);
      }
    };
    reader.readAsDataURL(file);
  };

  const getStudentPhoto = (student: Student | null | undefined): string => {
    if (!student) return '';
    const sId = String(student.Student_ID || '').trim().toLowerCase();
    const sName = String(student.Student_Name || '').trim().toLowerCase();

    // 1. User/School uploaded custom photo from localStorage
    if (sId && customPhotos[sId]) {
      return customPhotos[sId];
    }
    // 2. Photo from Google Sheets record ("Photo" column or "Student_Photo" column)
    const sheetPhoto =
      (student as any).Photo ||
      student.Student_Photo ||
      (student as any).photo ||
      (student as any).student_photo ||
      (student as any).Photo_URL;
    if (sheetPhoto && String(sheetPhoto).trim()) {
      return formatImageUrl(sheetPhoto);
    }
    // 3. Realistic school portraits fallback
    if (sId === '57dd106d' || sName.includes('farah')) {
      return studentFarahPhoto;
    }
    if (sId === 'dfe3be96' || sName.includes('namra')) {
      return studentNamraPhoto;
    }
    return '';
  };

  // Media Viewer Lightbox State (for Photos and PDFs)
  const [activeMediaModal, setActiveMediaModal] = useState<HomeworkMediaItem | null>(null);
  const [mediaZoom, setMediaZoom] = useState<number>(1);
  const [mediaRotation, setMediaRotation] = useState<number>(0);

  // Homework Tracker State (from Google Sheet: Homework_Tracker)
  const [hwTrackerList, setHwTrackerList] = useState<HomeworkTrackerRecord[]>(() => getCachedData<HomeworkTrackerRecord[]>(CACHE_KEY_HW_TRACKER, []));
  const [loadingHwTracker, setLoadingHwTracker] = useState<boolean>(false);

  // Student Behavior State (from Google Sheet: Student_Behavior)
  const [behaviorList, setBehaviorList] = useState<StudentBehaviorRecord[]>(() => getCachedData<StudentBehaviorRecord[]>(CACHE_KEY_BEHAVIOR, []));
  const [loadingBehavior, setLoadingBehavior] = useState<boolean>(false);
  const [behaviorFilterDate, setBehaviorFilterDate] = useState<string>('all');
  const [copiedBehaviorReport, setCopiedBehaviorReport] = useState<string | null>(null);
  const [behaviorViewMode, setBehaviorViewMode] = useState<'cards' | 'table'>('cards');
  const [showAttendanceChart, setShowAttendanceChart] = useState<boolean>(false);

  // Teacher Dashboard State
  const [hwDate, setHwDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [hwClass, setHwClass] = useState<string>('C12');
  const [hwSubject, setHwSubject] = useState<string>('Mathematics');
  const [hwDetail, setHwDetail] = useState<string>('');
  const [hwSubmitting, setHwSubmitting] = useState<boolean>(false);
  const [hwSuccessMessage, setHwSuccessMessage] = useState<string | null>(null);
  const [hwErrorMessage, setHwErrorMessage] = useState<string | null>(null);

  // Users Sheet & Manager Authentication State
  const [usersList, setUsersList] = useState<SchoolUser[]>(() => getCachedData<SchoolUser[]>(CACHE_KEY_USERS, []));
  const [loadingUsers, setLoadingUsers] = useState<boolean>(false);
  const [managerUser, setManagerUser] = useState<SchoolUser | null>(() => {
    try {
      const saved = localStorage.getItem('evs_manager_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [managerLoginInput, setManagerLoginInput] = useState<string>('');
  const [managerPasswordInput, setManagerPasswordInput] = useState<string>('');
  const [managerLoginError, setManagerLoginError] = useState<string | null>(null);
  const [managerLoginSubmitting, setManagerLoginSubmitting] = useState<boolean>(false);
  const [showManagerPassword, setShowManagerPassword] = useState<boolean>(false);
  const [staffSearchTerm, setStaffSearchTerm] = useState<string>('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>('all');
  const [managerFeeSearchTerm, setManagerFeeSearchTerm] = useState<string>('');

  // Selected/Active Teacher for Homework Upload
  const [activeTeacherName, setActiveTeacherName] = useState<string>('Mh salik');

  // Teacher Authentication & Dashboard State (Requires login from Users sheet)
  const [teacherUser, setTeacherUser] = useState<SchoolUser | null>(() => {
    try {
      const saved = localStorage.getItem('evs_teacher_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [teacherLoginInput, setTeacherLoginInput] = useState<string>('');
  const [teacherPasswordInput, setTeacherPasswordInput] = useState<string>('');
  const [teacherLoginError, setTeacherLoginError] = useState<string | null>(null);
  const [teacherLoginSubmitting, setTeacherLoginSubmitting] = useState<boolean>(false);
  const [showTeacherPassword, setShowTeacherPassword] = useState<boolean>(false);
  const [teacherPortalTab, setTeacherPortalTab] = useState<'upload' | 'tracker' | 'submissions'>(() => {
    try {
      const saved = localStorage.getItem('evs_teacher_portal_tab');
      if (saved && ['upload', 'tracker', 'submissions'].includes(saved)) {
        return saved as 'upload' | 'tracker' | 'submissions';
      }
    } catch {}
    return 'upload';
  });

  useEffect(() => {
    try {
      localStorage.setItem('evs_teacher_portal_tab', teacherPortalTab);
    } catch {}
  }, [teacherPortalTab]);
  const [teacherTrackerSearch, setTeacherTrackerSearch] = useState<string>('');
  const [teacherTrackerClassFilter, setTeacherTrackerClassFilter] = useState<string>('all');
  const [teacherTrackerStatusFilter, setTeacherTrackerStatusFilter] = useState<'all' | 'Completed' | 'Incompleted'>('all');

  // QR Code Scanner Modal State (For searching students in Teacher & Manager portals)
  const [qrScannerOpen, setQrScannerOpen] = useState<boolean>(false);
  const [qrScannerTarget, setQrScannerTarget] = useState<
    'managerStudents' | 'managerHomework' | 'managerBehavior' | 'managerFees' | 'teacherTracker' | 'addFee' | 'quickHomeworkCheck' | null
  >(null);
  const [qrScannerSubtitle, setQrScannerSubtitle] = useState<string>('');

  // Student Homework QR Tracker Modal State (Teacher Portal - Check Yesterday's HW)
  const [hwTrackerModalOpen, setHwTrackerModalOpen] = useState<boolean>(false);
  const [selectedHwTrackerStudent, setSelectedHwTrackerStudent] = useState<Student | null>(null);

  // Student Behavior & Conduct Modal State (उपस्थिति, आचरण, स्वच्छता व रिमार्क)
  const [behaviorModalOpen, setBehaviorModalOpen] = useState<boolean>(false);
  const [selectedBehaviorStudent, setSelectedBehaviorStudent] = useState<Student | null>(null);

  // Add Fee Modal State (Manager & Principal fee collection)
  const [addFeeModalOpen, setAddFeeModalOpen] = useState<boolean>(false);
  const [addFeeInitialStudentId, setAddFeeInitialStudentId] = useState<string | undefined>(undefined);
  const [feeNotificationSuccess, setFeeNotificationSuccess] = useState<string | null>(null);

  // Add Student Modal State (Manager Portal: नया छात्र जोड़ें)
  const [addStudentModalOpen, setAddStudentModalOpen] = useState<boolean>(false);
  const [studentNotificationSuccess, setStudentNotificationSuccess] = useState<string | null>(null);

  // Selected Student for Manager Fee Explorer (Manager Portal)
  const [managerSelectedFeeStudent, setManagerSelectedFeeStudent] = useState<Student | null>(null);

  // Manager Dashboard State
  const [managerTab, setManagerTab] = useState<'students' | 'homework' | 'behavior' | 'fees' | 'users' | 'vanTracking'>(() => {
    try {
      const saved = localStorage.getItem('evs_manager_tab');
      if (saved && ['students', 'homework', 'behavior', 'fees', 'users', 'vanTracking'].includes(saved)) {
        return saved as any;
      }
    } catch {}
    return 'students';
  });

  useEffect(() => {
    try {
      localStorage.setItem('evs_manager_tab', managerTab);
    } catch {}
  }, [managerTab]);
  const [studentSearchTerm, setStudentSearchTerm] = useState<string>('');
  const [studentClassFilter, setStudentClassFilter] = useState<string>('all');
  const [hwSearchTerm, setHwSearchTerm] = useState<string>('');
  const [hwClassFilter, setHwClassFilter] = useState<string>('all');
  const [hwDateSortOrder, setHwDateSortOrder] = useState<'asc' | 'desc'>('desc');
  const [managerBehaviorSearch, setManagerBehaviorSearch] = useState<string>('');
  const [managerBehaviorClassFilter, setManagerBehaviorClassFilter] = useState<string>('all');
  const [managerBehaviorDateFilter, setManagerBehaviorDateFilter] = useState<string>('all');
  const [managerBehaviorSortOrder, setManagerBehaviorSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedStudentDetail, setSelectedStudentDetail] = useState<Student | null>(null);
  const [hideModalPass, setHideModalPass] = useState<boolean>(false);
  const [hideModalFeeStatus, setHideModalFeeStatus] = useState<boolean>(false);
  const [selectedHomeworkDetail, setSelectedHomeworkDetail] = useState<Homework | null>(null);
  const [previewQRStudent, setPreviewQRStudent] = useState<Student | null>(null);

  // Helper to parse Google Sheets 2D array output into objects
  const parseSheetData = (rawData: any[]): Record<string, any>[] => {
    if (!Array.isArray(rawData) || rawData.length === 0) return [];
    const headers = rawData[0];
    if (!Array.isArray(headers)) return [];

    const parsed: Record<string, any>[] = [];
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!Array.isArray(row)) continue;
      // Check if row has at least one non-empty value
      const hasContent = row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
      if (!hasContent) continue;

      const item: Record<string, any> = {};
      headers.forEach((key, colIndex) => {
        if (key && typeof key === 'string') {
          item[key.trim()] = row[colIndex] ?? '';
        }
      });
      parsed.push(item);
    }
    return parsed;
  };

  // Helper to parse Google Sheets gviz JSON output into objects
  const parseGvizData = (jsonText: string): Record<string, any>[] => {
    try {
      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');
      if (start === -1 || end === -1) return [];
      const data = JSON.parse(jsonText.slice(start, end + 1));
      const cols: string[] = (data.table?.cols || []).map((c: any) => (c?.label || c?.id || '').trim());
      const rows: any[] = data.table?.rows || [];
      const result: Record<string, any>[] = [];

      for (const r of rows) {
        const item: Record<string, any> = {};
        let hasValue = false;
        cols.forEach((col, idx) => {
          if (!col) return;
          const cell = r.c ? r.c[idx] : null;
          let val = cell ? (cell.f !== undefined ? cell.f : cell.v) : '';
          // If date string contains Date(YYYY,M,D)
          if (typeof val === 'string' && val.includes('Date(')) {
            const m = val.match(/Date\((\d+),(\d+),(\d+)/);
            if (m) {
              const y = m[1];
              const mo = String(Number(m[2]) + 1).padStart(2, '0');
              const d = String(m[3]).padStart(2, '0');
              val = `${d}/${mo}/${y}`;
            }
          }
          if (val !== undefined && val !== null && String(val).trim() !== '') {
            hasValue = true;
          }
          item[col] = val !== undefined && val !== null ? val : '';
        });
        if (hasValue) {
          result.push(item);
        }
      }
      return result;
    } catch (e) {
      console.warn('Error parsing gviz data:', e);
      return [];
    }
  };

  // Fetch Students with automatic fallback and LocalStorage caching
  const fetchStudents = async (silent = false) => {
    if (!silent && students.length === 0) {
      setLoadingStudents(true);
    }
    try {
      let parsed: Student[] = [];
      let success = false;

      // 1. Try Google Apps Script endpoint first
      try {
        const res = await fetch(`${API_URL}?action=getStudents`);
        if (res.ok) {
          const data = await res.json();
          parsed = parseSheetData(data) as Student[];
          if (parsed && parsed.length > 0) {
            success = true;
          }
        } else {
          console.warn(`Apps Script getStudents returned HTTP ${res.status}, falling back to Google Sheets GViz...`);
        }
      } catch (scriptErr) {
        console.warn('Apps Script getStudents error, falling back to Google Sheets GViz...', scriptErr);
      }

      // 2. Fallback to direct Google Sheets GViz endpoint
      if (!success) {
        try {
          const encoded = encodeURIComponent('Students');
          const gvizRes = await fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`);
          if (gvizRes.ok) {
            const text = await gvizRes.text();
            parsed = parseGvizData(text) as Student[];
            if (parsed && parsed.length > 0) {
              success = true;
            }
          }
        } catch (gvizErr) {
          console.warn('Google Sheets GViz getStudents fallback error:', gvizErr);
        }
      }

      if (success && parsed.length > 0) {
        // Keep entries with at least a Student_Name or Student_ID
        const valid = parsed
          .filter(
            (s) => String(s.Student_Name || '').trim() !== '' || String(s.Student_ID || '').trim() !== ''
          )
          .map((s) => {
            // If QR code is not directly returned by GViz (due to =IMAGE(...) formula in sheet),
            // construct the exact Google Sheet formula URL:
            // =IMAGE(CONCATENATE("https://api.qrserver.com/v1/create-qr-code/?data=", A2, "&size=250x250"))
            const existingQr = String(s['QR code'] || s['QR_code'] || s['QRCode'] || s.qr_code || '').trim();
            const sId = String(s.Student_ID || '').trim();
            if (!existingQr && sId) {
              s['QR code'] = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(sId)}&size=250x250`;
            }
            return s;
          });
        setStudents(valid);
        try {
          localStorage.setItem(CACHE_KEY_STUDENTS, JSON.stringify(valid));
        } catch (e) {
          console.warn('Could not cache students in localStorage:', e);
        }
        setApiError(null);

        // If parent is already logged in, update their selected student and children from freshly fetched sheet
        try {
          const savedLoggedIn = localStorage.getItem('evs_parent_logged_in') === 'true';
          const savedStudentStr = localStorage.getItem('evs_parent_selected_student');
          if (savedLoggedIn && savedStudentStr) {
            const parsedStudent = JSON.parse(savedStudentStr);
            const sid = String(parsedStudent.Student_ID || '').trim().toLowerCase();
            const freshMatch = valid.find(
              (s) => String(s.Student_ID || '').trim().toLowerCase() === sid
            );
            if (freshMatch) {
              setSelectedStudent(freshMatch);
            }
          }
        } catch {}
      } else {
        setStudents((prev) => {
          if (prev.length === 0) {
            setApiError('Unable to load students from Google Sheets.');
          }
          return prev;
        });
      }
    } catch (err: any) {
      console.error('Error fetching students:', err);
      setStudents((prev) => {
        if (prev.length === 0) {
          setApiError(err.message || 'Unable to load students from Google Sheets.');
        }
        return prev;
      });
    } finally {
      setLoadingStudents(false);
    }
  };

  // Fetch Homework with automatic fallback and LocalStorage caching
  const fetchHomework = async (silent = false) => {
    if (!silent && homeworkList.length === 0) {
      setLoadingHomework(true);
    }
    try {
      let parsed: Homework[] = [];
      let success = false;

      // 1. Try Google Apps Script endpoint first
      try {
        const res = await fetch(`${API_URL}?action=getHomework`);
        if (res.ok) {
          const data = await res.json();
          parsed = parseSheetData(data) as Homework[];
          if (parsed && parsed.length > 0) {
            success = true;
          }
        } else {
          console.warn(`Apps Script getHomework returned HTTP ${res.status}, falling back to Google Sheets GViz...`);
        }
      } catch (scriptErr) {
        console.warn('Apps Script getHomework error, falling back to Google Sheets GViz...', scriptErr);
      }

      // 2. If Apps Script failed (HTTP 404, etc.) or returned empty, fetch directly via Google Sheets GViz
      if (!success) {
        try {
          const encoded = encodeURIComponent('Homework');
          const gvizRes = await fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`);
          if (gvizRes.ok) {
            const text = await gvizRes.text();
            parsed = parseGvizData(text) as Homework[];
            if (parsed && parsed.length > 0) {
              success = true;
            }
          }
        } catch (gvizErr) {
          console.warn('Google Sheets GViz getHomework fallback error:', gvizErr);
        }
      }

      if (success && parsed.length > 0) {
        const valid = parsed.filter(
          (hw) =>
            String(hw.Homework_ID || '').trim() !== '' ||
            String(hw.Subject || '').trim() !== '' ||
            String(hw.Homework_Detail || '').trim() !== ''
        );
        // Sort newest date first
        valid.sort((a, b) => {
          const dateA = new Date(a.Date).getTime() || 0;
          const dateB = new Date(b.Date).getTime() || 0;
          return dateB - dateA;
        });
        setHomeworkList(valid);
        try {
          localStorage.setItem(CACHE_KEY_HOMEWORK, JSON.stringify(valid));
        } catch (e) {
          console.warn('Could not cache homework in localStorage:', e);
        }
        setApiError(null);
      } else {
        setHomeworkList((prev) => {
          if (prev.length === 0) {
            setApiError('Unable to load homework from Google Sheets.');
          }
          return prev;
        });
      }
    } catch (err: any) {
      console.error('Error fetching homework:', err);
      setHomeworkList((prev) => {
        if (prev.length === 0) {
          setApiError(err.message || 'Unable to load homework from Google Sheets.');
        }
        return prev;
      });
    } finally {
      setLoadingHomework(false);
    }
  };

  // Fetch dynamic Classes mapping from Google Sheets (Classes sheet)
  const fetchClasses = async () => {
    try {
      const encoded = encodeURIComponent('Classes');
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`);
      if (!res.ok) return;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return;
      const data = JSON.parse(text.slice(start, end + 1));
      const rows = data.table?.rows || [];
      const newMap: Record<string, string> = { ...DEFAULT_CLASS_MAP };
      for (const r of rows) {
        const cells = (r.c || []).map((c: any) => c?.v);
        const cId = cells[0] ? String(cells[0]).trim() : '';
        const cName = cells[1] ? String(cells[1]).trim() : '';
        if (cId && cName && cId !== 'Class_ID') {
          newMap[cId] = cName;
        }
      }
      setClassMap(newMap);
      try {
        localStorage.setItem(CACHE_KEY_CLASSES, JSON.stringify(newMap));
      } catch {}
    } catch (err) {
      console.warn('Could not fetch classes sheet, using default class map:', err);
    }
  };

  // Fetch Fee Collection records and balance amounts by Student ID
  const fetchFeeCollection = async () => {
    if (feeRecords.length === 0) {
      setLoadingFees(true);
    }
    try {
      const encoded = encodeURIComponent('Fee_Collection');
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`);
      if (!res.ok) return;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return;
      const data = JSON.parse(text.slice(start, end + 1));
      const rows = data.table?.rows || [];
      const balances: Record<string, number> = {};
      const records: FeeCollectionRecord[] = [];

      for (const r of rows) {
        const cells = (r.c || []).map((c: any) => c?.v);
        const receiptNo = cells[0] ? String(cells[0]).trim() : '';
        const studentId = cells[1] ? String(cells[1]).trim() : '';
        const dateVal = cells[2];
        const feeType = cells[3] ? String(cells[3]).trim() : '';
        const month = cells[4] ? String(cells[4]).trim() : '';
        const totalAmt = cells[5] !== undefined && cells[5] !== null && cells[5] !== '' ? Number(cells[5]) : null;
        const amtPaid = cells[6] !== undefined && cells[6] !== null && cells[6] !== '' ? Number(cells[6]) : null;
        const balAmt = cells[7] !== undefined && cells[7] !== null && cells[7] !== '' ? Number(cells[7]) : null;
        const payMode = cells[8] ? String(cells[8]).trim() : '';
        const receivedBy = cells[9] ? String(cells[9]).trim() : '';

        if (studentId && studentId !== 'Student_ID') {
          records.push({
            Receipt_Number: receiptNo,
            Student_ID: studentId,
            Date: typeof dateVal === 'string' ? dateVal : String(dateVal || ''),
            Fee_Type: feeType,
            Month: month,
            Total_Amount: totalAmt,
            Amount_Paid: amtPaid,
            Balance_Amount: balAmt,
            Payment_Mode: payMode,
            Received_By: receivedBy,
          });

          // If row has a numeric Balance_Amount, update student's balance
          if (balAmt !== null && !isNaN(balAmt)) {
            balances[studentId.toLowerCase()] = balAmt;
          }
        }
      }

      // Merge custom added fee records saved locally by Manager / Principal
      try {
        const savedCustom = localStorage.getItem('evs_custom_fee_records');
        if (savedCustom) {
          const customList: FeeCollectionRecord[] = JSON.parse(savedCustom);
          for (const cRec of customList) {
            const exists = records.some(
              (r) => r.Receipt_Number && cRec.Receipt_Number && r.Receipt_Number.toLowerCase() === cRec.Receipt_Number.toLowerCase()
            );
            if (!exists) {
              records.unshift(cRec);
              if (cRec.Student_ID && cRec.Balance_Amount !== null && cRec.Balance_Amount !== undefined) {
                balances[cRec.Student_ID.toLowerCase()] = cRec.Balance_Amount;
              }
            }
          }
        }
      } catch (e) {
        console.warn('Error reading cached custom fees:', e);
      }

      setFeeBalances(balances);
      setFeeRecords(records);
      try {
        localStorage.setItem(CACHE_KEY_FEES_BALANCES, JSON.stringify(balances));
        localStorage.setItem(CACHE_KEY_FEES_RECORDS, JSON.stringify(records));
      } catch {}
    } catch (err) {
      console.warn('Could not fetch fee collection sheet:', err);
    } finally {
      setLoadingFees(false);
    }
  };

  // Fetch Homework Tracker records from Google Sheets (Homework_Tracker sheet)
  const fetchHomeworkTracker = async () => {
    if (hwTrackerList.length === 0) {
      setLoadingHwTracker(true);
    }
    try {
      const encoded = encodeURIComponent('Homework_Tracker');
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`);
      if (!res.ok) return;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return;
      const data = JSON.parse(text.slice(start, end + 1));
      const rows = data.table?.rows || [];
      const records: HomeworkTrackerRecord[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const cells = r.c || [];
        const rawCol0 = cells[0]?.v ? String(cells[0].v).trim() : '';
        const dateVal = cells[1]?.f || cells[1]?.v || '';
        let formattedDate = String(dateVal || '');
        if (typeof dateVal === 'string' && dateVal.includes('Date(')) {
          const m = dateVal.match(/Date\((\d+),(\d+),(\d+)/);
          if (m) {
            const y = m[1];
            const mo = String(Number(m[2]) + 1).padStart(2, '0');
            const d = String(m[3]).padStart(2, '0');
            formattedDate = `${d}/${mo}/${y}`;
          }
        }
        const rawCol2 = cells[2]?.v ? String(cells[2].v).trim() : '';
        const rawCol3 = cells[3]?.v ? String(cells[3].v).trim() : '';
        const rawCol4 = cells[4]?.v ? String(cells[4].v).trim() : '';
        const rawCol5 = cells[5]?.v ? String(cells[5].v).trim() : '';

        // Robust resolution: In sheet rows, rawCol0 is often Student_ID (e.g. 57dd106d for Farah),
        // or a Record_ID. rawCol3 can also be Student_ID.
        let sId = rawCol3;
        let recId = rawCol0;

        if (!sId && rawCol0) {
          sId = rawCol0;
        }

        // Normalize status
        let normStatus: 'Completed' | 'Incompleted' = 'Completed';
        if (/incom|pend|adhura|not/i.test(rawCol5)) {
          normStatus = 'Incompleted';
        } else if (/comp|done|poora|yes/i.test(rawCol5)) {
          normStatus = 'Completed';
        } else if (rawCol5) {
          normStatus = rawCol5 as any;
        }

        if (rawCol0 || sId || rawCol5) {
          records.push({
            ID: recId || `HWT-${i + 1}`,
            Date: formattedDate,
            Class: rawCol2,
            Student_ID: sId,
            Subject: rawCol4 || 'General / All Subjects',
            Last_homework_Status: normStatus,
          });
        }
      }

      // Merge custom status overrides and newly added tracker entries from localStorage
      try {
        const savedCustom = localStorage.getItem('evs_custom_hw_tracker');
        if (savedCustom) {
          const customList: HomeworkTrackerRecord[] = JSON.parse(savedCustom);
          for (const cRec of customList) {
            const existingIdx = records.findIndex(
              (r) =>
                r.ID === cRec.ID ||
                (r.Student_ID && cRec.Student_ID && r.Student_ID.toLowerCase() === cRec.Student_ID.toLowerCase() && r.Date === cRec.Date)
            );
            if (existingIdx >= 0) {
              records[existingIdx].Last_homework_Status = cRec.Last_homework_Status;
            } else {
              records.unshift(cRec);
            }
          }
        }
      } catch (e) {
        console.warn('Error merging custom homework tracker records:', e);
      }

      setHwTrackerList(records);
      try {
        localStorage.setItem(CACHE_KEY_HW_TRACKER, JSON.stringify(records));
      } catch {}
    } catch (err) {
      console.warn('Could not fetch Homework_Tracker sheet:', err);
    } finally {
      setLoadingHwTracker(false);
    }
  };

  // Fetch Student Behavior records from Google Sheets (Student_Behavior sheet)
  const fetchStudentBehavior = async () => {
    if (behaviorList.length === 0) {
      setLoadingBehavior(true);
    }
    try {
      const encoded = encodeURIComponent('Student_Behavior');
      const res = await fetch(
        `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`
      );
      if (!res.ok) return;
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return;
      const data = JSON.parse(text.slice(start, end + 1));
      const rows = data.table?.rows || [];
      const records: StudentBehaviorRecord[] = [];

      const parseBool = (cell: any): boolean => {
        if (!cell) return false;
        if (cell.v === true || cell.v === 1) return true;
        if (typeof cell.v === 'string') {
          const s = cell.v.trim().toLowerCase();
          return s === 'true' || s === 'yes' || s === 'y' || s === 'haan';
        }
        if (typeof cell.f === 'string') {
          const s = cell.f.trim().toLowerCase();
          return s === 'true' || s === 'yes';
        }
        return false;
      };

      for (const r of rows) {
        const cells = r.c || [];
        const bId = cells[0]?.v ? String(cells[0].v).trim() : '';
        const sId = cells[1]?.v ? String(cells[1].v).trim() : '';
        const dateVal = cells[2]?.f || cells[2]?.v || '';
        let formattedDate = String(dateVal || '');
        if (typeof dateVal === 'string' && dateVal.includes('Date(')) {
          const m = dateVal.match(/Date\((\d+),(\d+),(\d+)/);
          if (m) {
            const y = m[1];
            const mo = String(Number(m[2]) + 1).padStart(2, '0');
            const d = String(m[3]).padStart(2, '0');
            formattedDate = `${d}/${mo}/${y}`;
          }
        }
        const cls = cells[3]?.v ? String(cells[3].v).trim() : '';
        const isBathed = parseBool(cells[4]);
        const nailsClean = parseBool(cells[5]);
        const uniformClean = parseBool(cells[6]);
        const goodManners = cells[7]?.v ? String(cells[7].v).trim() : 'Good';
        const discipline = parseBool(cells[8]);
        const isPresent = parseBool(cells[9]);
        const remark = cells[10]?.v ? String(cells[10].v).trim() : 'OK';
        const aiFeedback = cells[11]?.v ? String(cells[11].v).trim() : '';

        if (bId || sId) {
          records.push({
            Behavior_ID: bId,
            Student_ID: sId,
            Date: formattedDate,
            Class: cls,
            Is_Bathed: isBathed,
            Nails_Clean: nailsClean,
            Uniform_clean: uniformClean,
            Good_Manners: goodManners,
            Discipline: discipline,
            Is_Present: isPresent,
            Remark: remark,
            AI_Feedback: aiFeedback,
          });
        }
      }
      setBehaviorList(records);
      try {
        localStorage.setItem(CACHE_KEY_BEHAVIOR, JSON.stringify(records));
      } catch {}
    } catch (err) {
      console.warn('Could not fetch Student_Behavior sheet:', err);
    } finally {
      setLoadingBehavior(false);
    }
  };

  // Fetch Users records from Google Sheets (Users sheet)
  const fetchUsers = async (): Promise<SchoolUser[]> => {
    if (usersList.length === 0) {
      setLoadingUsers(true);
    }
    try {
      const encoded = encodeURIComponent('Users');
      const res = await fetch(
        `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encoded}`
      );
      if (!res.ok) return [];
      const text = await res.text();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1) return [];
      const data = JSON.parse(text.slice(start, end + 1));
      const rows = data.table?.rows || [];
      const userRecords: SchoolUser[] = [];

      for (const r of rows) {
        const cells = (r.c || []).map((c: any) =>
          c ? (c.f !== undefined && c.f !== null ? c.f : c.v) : ''
        );
        const uId = cells[0] ? String(cells[0]).trim() : '';
        const mobile = cells[1] ? String(cells[1]).trim() : '';
        const username = cells[2] ? String(cells[2]).trim() : '';
        const password = cells[3] ? String(cells[3]).trim() : '';
        const name = cells[4] ? String(cells[4]).trim() : '';
        const designation = cells[5] ? String(cells[5]).trim() : '';
        const assignedClass = cells[6] ? String(cells[6]).trim() : '';
        const lastAiRun = cells[7] ? String(cells[7]).trim() : '';

        if (uId || username || mobile || name) {
          userRecords.push({
            User_ID: uId,
            Mobile_number: mobile,
            Username: username,
            Password: password,
            Name: name,
            Designation: designation,
            Assigned_Class: assignedClass,
            Last_AI_Run: lastAiRun,
          });
        }
      }
      setUsersList(userRecords);
      try {
        localStorage.setItem(CACHE_KEY_USERS, JSON.stringify(userRecords));
      } catch {}
      return userRecords;
    } catch (err) {
      console.warn('Could not fetch Users sheet:', err);
      return [];
    } finally {
      setLoadingUsers(false);
    }
  };

  // Format Class ID to human-readable Class Name (e.g. C12 -> 8th)
  const getClassName = (classIdOrName: string | null | undefined): string => {
    if (!classIdOrName) return 'N/A';
    const str = String(classIdOrName).trim();
    if (str.toLowerCase() === 'all') return 'All Classes';

    // Check direct match
    if (classMap[str]) return String(classMap[str]);
    if (classMap[str.toUpperCase()]) return String(classMap[str.toUpperCase()]);

    // Case-insensitive lookup
    const found = Object.entries(classMap).find(
      ([k]) => k.toLowerCase() === str.toLowerCase()
    );
    if (found && found[1]) return String(found[1]);

    // Already a name or custom name
    return str;
  };

  // Get student balance from Fee_Collection or Student record
  const getStudentBalance = (student: Student | null | undefined): number => {
    if (!student) return 0;
    const sId = String(student.Student_ID || '').trim().toLowerCase();
    if (sId && feeBalances[sId] !== undefined) {
      return feeBalances[sId];
    }
    // Fallback to student record's Balance_Amount
    if (student.Balance_Amount !== undefined && student.Balance_Amount !== null && student.Balance_Amount !== '') {
      const num = Number(student.Balance_Amount);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };

  // Background Synchronization with LocalStorage persistence & Stale-While-Revalidate
  const syncAllData = async (manual = false) => {
    setIsBackgroundSyncing(true);
    if (manual) {
      setSyncToastMessage('डेटा सिंक किया जा रहा है... (Syncing fresh records)');
    }
    try {
      await Promise.allSettled([
        fetchStudents(true),
        fetchHomework(true),
        fetchClasses(),
        fetchFeeCollection(),
        fetchHomeworkTracker(),
        fetchStudentBehavior(),
        fetchUsers(),
      ]);
      const now = Date.now();
      setLastSyncTimestamp(now);
      try {
        localStorage.setItem(CACHE_KEY_TIMESTAMP, String(now));
      } catch {}

      if (manual) {
        setSyncToastMessage('ताज़ा डेटा सफलतापूर्वक अपडेट हो गया! (Data synced)');
        setTimeout(() => setSyncToastMessage(null), 3000);
      }
    } catch (err) {
      console.warn('Sync failed:', err);
      if (manual) {
        setSyncToastMessage('सिंक में त्रुटि हुई, स्थानीय डेटा सुरक्षित है।');
        setTimeout(() => setSyncToastMessage(null), 3500);
      }
    } finally {
      setIsBackgroundSyncing(false);
    }
  };

  // Formatted label for last sync time
  const getSyncTimeLabel = (): string => {
    if (!lastSyncTimestamp) return 'सिंक नहीं हुआ';
    const elapsedMinutes = Math.floor((Date.now() - lastSyncTimestamp) / 60000);
    if (elapsedMinutes < 1) return 'अभी-अभी';
    if (elapsedMinutes < 60) return `${elapsedMinutes}m पहले`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return `${elapsedHours}h पहले`;
  };

  // Manager: Handle Add Student with optimistic UI and local persistence
  const handleStudentAdded = async (newStudent: Student, sendWhatsApp = false) => {
    // 1. Optimistically add to state and localStorage cache
    setStudents((prev) => {
      const updated = [newStudent, ...prev];
      try {
        localStorage.setItem(CACHE_KEY_STUDENTS, JSON.stringify(updated));
      } catch (e) {
        console.warn('Error saving added student to cache:', e);
      }
      return updated;
    });

    setStudentNotificationSuccess(`छात्र ${newStudent.Student_Name} (${newStudent.Admission_Number || newStudent.Student_ID}) सफलतापूर्वक दर्ज कर लिया गया है!`);
    setTimeout(() => setStudentNotificationSuccess(null), 4000);

    // 2. Background sync to Google Apps Script
    try {
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'addStudent',
          student_id: newStudent.Student_ID,
          admission_number: newStudent.Admission_Number,
          roll_number: newStudent.Roll_Number,
          student_name: newStudent.Student_Name,
          class: newStudent.Class,
          father_name: newStudent.Father_Name,
          mother_name: newStudent.Mother_Name,
          parent_mobile: newStudent.Parent_Mobile,
          village: newStudent['Village/rRoute'] || newStudent.Village,
          student_photo: newStudent.Student_Photo,
          balance_amount: newStudent.Balance_Amount || 0,
        }),
      }).catch((e) => console.warn('Background addStudent sync warning:', e));
    } catch {}

    // 3. Optional WhatsApp notification to parent
    if (sendWhatsApp && newStudent.Parent_Mobile) {
      const cleanMobile = String(newStudent.Parent_Mobile).replace(/\D/g, '');
      const studentClass = getClassName(newStudent.Class);
      const msg = `🏫 *E.V.S. Public School - छात्र प्रवेश एवं विवरण*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `प्रिय अभिभावक, आपके बच्चे का स्कूल में पंजीकरण सफलतापूर्वक हो गया है:\n\n` +
        `👤 *छात्र का नाम:* ${newStudent.Student_Name}\n` +
        `🆔 *Student ID:* ${newStudent.Student_ID}\n` +
        `📝 *प्रवेश संख्या (Admission No):* ${newStudent.Admission_Number || 'N/A'}\n` +
        `🔢 *रोल नंबर:* ${newStudent.Roll_Number || 'N/A'}\n` +
        `📚 *कक्षा (Class):* ${studentClass}\n` +
        `👨‍👩‍👦 *पिता/माता का नाम:* ${newStudent.Father_Name || newStudent.Mother_Name || 'N/A'}\n` +
        `📱 *मोबाइल:* ${newStudent.Parent_Mobile}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `_ई.वी.एस. पब्लिक स्कूल पोर्टल पर अपने पंजीकृत मोबाइल नंबर से लॉगिन करके अपने बच्चे की दैनिक उपस्थिति, गृहकार्य व शुल्क की स्थिति देख सकते हैं।_`;
      const encoded = encodeURIComponent(msg);
      const waUrl = cleanMobile.length >= 10
        ? `https://wa.me/91${cleanMobile.slice(-10)}?text=${encoded}`
        : `https://wa.me/?text=${encoded}`;
      window.open(waUrl, '_blank');
    }
  };

  // Initial load - Stale While Revalidate background sync
  useEffect(() => {
    // Instantly renders cached state, and executes background sync
    syncAllData(false);
  }, []);

  // Parse Date string into comparable timestamp at midnight (00:00:00)
  const parseDateToTimestamp = (dateStr: string | null | undefined): number => {
    if (!dateStr) return 0;
    const str = String(dateStr).trim();
    if (!str) return 0;

    // ISO string or YYYY-MM-DD
    try {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      }
    } catch {}

    // DD/MM/YYYY or DD-MM-YYYY
    const parts = str.split(/[-/]/);
    if (parts.length === 3) {
      let day = parseInt(parts[0], 10);
      let month = parseInt(parts[1], 10) - 1;
      let year = parseInt(parts[2], 10);
      if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        day = parseInt(parts[2], 10);
      }
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return new Date(year, month, day).getTime();
      }
    }
    return 0;
  };

  // Parent Portal: Handle Mobile / Student Lookup (Supports Multiple Children)
  const handleParentLogin = (e?: React.FormEvent, customQuery?: string) => {
    if (e) e.preventDefault();
    setParentSearchAttempted(true);

    const query = (customQuery !== undefined ? customQuery : parentMobileInput).trim();
    const cleanDigits = query.replace(/\D/g, '');
    const cleanLower = query.toLowerCase();

    if (!cleanDigits && !cleanLower) {
      return;
    }

    // 1. Search by registered Parent_Mobile (finds all siblings enrolled under this mobile)
    let matched: Student[] = [];
    if (cleanDigits.length >= 4) {
      matched = students.filter((s) => {
        const rawMobile = String(s.Parent_Mobile || '').replace(/\D/g, '');
        return (
          rawMobile === cleanDigits ||
          (rawMobile.length >= 10 && rawMobile.endsWith(cleanDigits)) ||
          (cleanDigits.length >= 10 && cleanDigits.endsWith(rawMobile))
        );
      });
    }

    // 2. If no mobile match, check if input matches Student_ID or Admission_Number
    if (matched.length === 0) {
      const byIdOrAdm = students.filter((s) => {
        const sId = String(s.Student_ID || '').trim().toLowerCase();
        const adm = String(s.Admission_Number || '').trim().toLowerCase();
        return sId === cleanLower || adm === cleanLower;
      });

      if (byIdOrAdm.length > 0) {
        // If matched by Student ID/Admission number, also lookup siblings sharing the same Parent_Mobile
        const primaryMobile = String(byIdOrAdm[0].Parent_Mobile || '').replace(/\D/g, '');
        if (primaryMobile && primaryMobile.length >= 10) {
          const siblings = students.filter((s) => {
            const rawMobile = String(s.Parent_Mobile || '').replace(/\D/g, '');
            return (
              rawMobile === primaryMobile ||
              rawMobile.endsWith(primaryMobile) ||
              primaryMobile.endsWith(rawMobile)
            );
          });
          matched = siblings.length > 0 ? siblings : byIdOrAdm;
        } else {
          matched = byIdOrAdm;
        }
      }
    }

    if (matched.length > 0) {
      setParentChildren(matched);
      setSelectedStudent(matched[0]);
      setParentLoggedIn(true);
      setParentSearchAttempted(false);
    } else {
      setParentChildren([]);
      setSelectedStudent(null);
      setParentLoggedIn(false);
    }
  };

  // Parent Portal: Link another child manually by Student ID or Admission No
  const handleLinkSibling = (e: React.FormEvent) => {
    e.preventDefault();
    setManualLinkError(null);
    setManualLinkSuccess(null);

    const input = manualLinkInput.trim().toLowerCase();
    const cleanDigits = input.replace(/\D/g, '');
    if (!input) return;

    const found = students.filter((s) => {
      const sId = String(s.Student_ID || '').trim().toLowerCase();
      const adm = String(s.Admission_Number || '').trim().toLowerCase();
      const rawMobile = String(s.Parent_Mobile || '').replace(/\D/g, '');

      const idMatch = sId === input;
      const admMatch = adm === input;
      const mobMatch = cleanDigits.length >= 4 && (rawMobile === cleanDigits || rawMobile.endsWith(cleanDigits));

      return idMatch || admMatch || mobMatch;
    });

    if (found.length === 0) {
      setManualLinkError('No student found matching this Student ID, Admission No, or Mobile number.');
      return;
    }

    // Check if already in parentChildren
    const existingIds = new Set(parentChildren.map((c) => c.Student_ID));
    const newChildren = found.filter((c) => !existingIds.has(c.Student_ID));

    if (newChildren.length === 0) {
      setManualLinkError('This student is already linked in your active session.');
      return;
    }

    const updated = [...parentChildren, ...newChildren];
    setParentChildren(updated);
    setSelectedStudent(newChildren[0]); // Switch to the newly linked child immediately
    setManualLinkSuccess(`Successfully linked ${newChildren.map((c) => c.Student_Name).join(', ')}!`);
    setManualLinkInput('');
  };

  const handleParentLogout = () => {
    setParentLoggedIn(false);
    setSelectedStudent(null);
    setParentChildren([]);
    setParentMobileInput('');
    setParentSearchAttempted(false);
    setManualLinkOpen(false);
    setManualLinkError(null);
    setManualLinkSuccess(null);
  };

  // Parent Portal: Strict Class Homework filtered for the Last 3 Days
  const parentHomework = useMemo(() => {
    if (!selectedStudent) return [];
    const studentId = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    const studentClass = String(selectedStudent.Class || '').trim().toLowerCase();
    const studentClassName = getClassName(selectedStudent.Class).trim().toLowerCase();

    // 1. Strict Class Filter: Must match child's class or be assigned specifically to child
    const classFiltered = homeworkList.filter((hw) => {
      const hwStudentId = String(hw.Student_ID || '').trim().toLowerCase();
      const hwClassVal = String(hw.Class || '').trim().toLowerCase();
      const hwClassName = getClassName(hw.Class).trim().toLowerCase();

      // If homework is specifically assigned to a different individual student, never show it to this child
      if (hwStudentId && hwStudentId !== studentId) {
        return false;
      }

      const isTargetStudent = Boolean(hwStudentId && hwStudentId === studentId);
      const isClassHw = Boolean(
        hwClassVal &&
        (hwClassVal === studentClass ||
          hwClassName === studentClassName ||
          hwClassVal === studentClassName ||
          hwClassName === studentClass ||
          studentClass.includes(hwClassVal) ||
          hwClassVal.includes(studentClass) ||
          (studentClassName !== 'n/a' && hwClassName !== 'n/a' && (studentClassName.includes(hwClassName) || hwClassName.includes(studentClassName))))
      );

      if (hwFilterType === 'student') {
        return isTargetStudent;
      }
      if (hwFilterType === 'class') {
        return isClassHw;
      }
      return isTargetStudent || isClassHw;
    });

    // 2. Date Filter: If hwDaysFilter === 'latest', show Today's homework, or if none today, show the previous 1 day's homework
    if (hwDaysFilter === 'latest') {
      // Find all distinct timestamps in this child's class homework sorted newest first
      const distinctTimestamps: number[] = Array.from(
        new Set<number>(classFiltered.map((h) => parseDateToTimestamp(h.Date)).filter((t): t is number => t > 0))
      ).sort((a: number, b: number) => b - a);

      if (distinctTimestamps.length === 0) {
        return classFiltered;
      }

      const now = new Date();
      const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      // Check if today has homework
      const hasToday = distinctTimestamps.includes(todayTs);

      let targetTimestamp: number;
      if (hasToday) {
        targetTimestamp = todayTs;
      } else {
        // Find the single most recent previous day's homework
        const pastTs = distinctTimestamps.find((t) => t <= todayTs);
        targetTimestamp = pastTs !== undefined ? pastTs : distinctTimestamps[0];
      }

      return classFiltered.filter((hw) => {
        const ts = parseDateToTimestamp(hw.Date);
        return ts === targetTimestamp;
      });
    }

    return classFiltered;
  }, [selectedStudent, homeworkList, hwFilterType, hwDaysFilter, classMap]);

  // Helper to determine whether the displayed homework is from today or previous 1 day
  const currentHomeworkPeriodInfo = useMemo(() => {
    if (!selectedStudent || parentHomework.length === 0) {
      return { isToday: false, dateLabel: '', empty: true };
    }
    const distinctTimestamps: number[] = Array.from(
      new Set<number>(parentHomework.map((h) => parseDateToTimestamp(h.Date)).filter((t): t is number => t > 0))
    ).sort((a: number, b: number) => b - a);

    if (distinctTimestamps.length === 0) {
      return { isToday: false, dateLabel: '', empty: true };
    }

    const now = new Date();
    const todayTs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const activeTs = distinctTimestamps[0];
    const isToday = activeTs === todayTs;

    const d = new Date(activeTs);
    const dateLabel = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;

    return { isToday, dateLabel, empty: false };
  }, [selectedStudent, parentHomework]);

  // Homework Tracker records strictly matching ONLY the logged-in student (Student_ID, Record ID, or Class)
  const studentTrackerRecords = useMemo(() => {
    if (!selectedStudent) return [];
    const studentId = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    const studentClass = String(selectedStudent.Class || '').trim().toLowerCase();
    const studentClassName = getClassName(selectedStudent.Class).trim().toLowerCase();

    return hwTrackerList.filter((rec) => {
      const recStudentId = String(rec.Student_ID || '').trim().toLowerCase();
      const recId = String(rec.ID || '').trim().toLowerCase();
      const recClass = String(rec.Class || '').trim().toLowerCase();
      const recClassName = getClassName(rec.Class).trim().toLowerCase();

      // If either recStudentId OR recId matches this student's ID (e.g. '57dd106d' for Farah)
      if (
        (recStudentId && (recStudentId === studentId || studentId.includes(recStudentId) || recStudentId.includes(studentId))) ||
        (recId && (recId === studentId || studentId.includes(recId) || recId.includes(studentId)))
      ) {
        return true;
      }

      // If the row specifies a class and no conflicting student ID
      if (recClass && (!recStudentId || recStudentId === studentId) && (!recId || recId === studentId)) {
        const isClassMatch =
          recClass === studentClass ||
          recClassName === studentClassName ||
          recClass === studentClassName ||
          recClassName === studentClass ||
          studentClass.includes(recClass) ||
          recClass.includes(studentClass);
        return isClassMatch;
      }

      return false;
    });
  }, [selectedStudent, hwTrackerList, classMap]);

  // Filtered tracker records by status (STRICTLY scoped to the active child)
  const filteredTrackerRecords = useMemo(() => {
    const list = studentTrackerRecords;
    if (trackerStatusFilter === 'all') return list;
    return list.filter((rec) => {
      const status = (rec.Last_homework_Status || '').toLowerCase();
      if (trackerStatusFilter === 'completed') {
        return status.includes('complete') && !status.includes('incom');
      }
      if (trackerStatusFilter === 'incompleted') {
        return status.includes('incom') || status.includes('pend');
      }
      return true;
    });
  }, [studentTrackerRecords, trackerStatusFilter]);

  // Tracker summary metrics strictly for this active child
  const trackerStats = useMemo(() => {
    const list = studentTrackerRecords;
    const total = list.length;
    const completed = list.filter((r) => {
      const s = (r.Last_homework_Status || '').toLowerCase();
      return s.includes('complete') && !s.includes('incom');
    }).length;
    const incompleted = list.filter((r) => {
      const s = (r.Last_homework_Status || '').toLowerCase();
      return s.includes('incom') || s.includes('pend');
    }).length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, incompleted, rate };
  }, [studentTrackerRecords]);

  // Look up tracker status for a given homework assignment
  const getHomeworkTrackerStatus = (hw: Homework): string | null => {
    if (!hw) return null;
    const hwSubj = String(hw.Subject || '').trim().toLowerCase();
    const hwDateTs = parseDateToTimestamp(hw.Date);

    const match = studentTrackerRecords.find((tr) => {
      const trSubj = String(tr.Subject || '').trim().toLowerCase();
      const trTs = parseDateToTimestamp(tr.Date);
      const sameSubj = trSubj && (trSubj === hwSubj || hwSubj.includes(trSubj) || trSubj.includes(hwSubj));
      const sameDate = trTs && hwDateTs && trTs === hwDateTs;
      return (sameSubj && sameDate) || (sameSubj && !trTs);
    });

    return match ? match.Last_homework_Status : null;
  };

  // Student Behavior: Records strictly for the selected student ONLY
  const studentBehaviorRecords = useMemo(() => {
    if (!selectedStudent) return [];
    const sid = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    return behaviorList
      .filter((b) => {
        const bSid = String(b.Student_ID || '').trim().toLowerCase();
        return Boolean(bSid && (bSid === sid || sid.includes(bSid) || bSid.includes(sid)));
      })
      .sort((a, b) => {
        const tsA = parseDateToTimestamp(a.Date);
        const tsB = parseDateToTimestamp(b.Date);
        return tsB - tsA;
      });
  }, [selectedStudent, behaviorList]);

  // Latest behavior record for quick preview
  const latestBehaviorRecord = useMemo(() => {
    return studentBehaviorRecords.length > 0 ? studentBehaviorRecords[0] : null;
  }, [studentBehaviorRecords]);

  // Filtered Behavior Records by date (STRICTLY for active student)
  const filteredBehaviorRecords = useMemo(() => {
    const list = studentBehaviorRecords;
    return list
      .filter((rec) => {
        if (behaviorFilterDate === 'all') return true;
        return rec.Date === behaviorFilterDate;
      })
      .sort((a, b) => {
        const tsA = parseDateToTimestamp(a.Date);
        const tsB = parseDateToTimestamp(b.Date);
        return tsB - tsA;
      });
  }, [studentBehaviorRecords, behaviorFilterDate]);

  // Behavior summary metrics strictly for active student
  const behaviorStats = useMemo(() => {
    const list = studentBehaviorRecords;
    const total = list.length;
    if (total === 0) {
      return { total: 0, presentCount: 0, bathedCount: 0, nailsCount: 0, uniformCount: 0, disciplineCount: 0, avgScore: 0 };
    }
    const presentCount = list.filter((b) => b.Is_Present).length;
    const bathedCount = list.filter((b) => b.Is_Bathed).length;
    const nailsCount = list.filter((b) => b.Nails_Clean).length;
    const uniformCount = list.filter((b) => b.Uniform_clean).length;
    const disciplineCount = list.filter((b) => b.Discipline).length;

    const totalPoints = list.reduce((acc, b) => {
      let pts = 0;
      if (b.Is_Present) pts++;
      if (b.Is_Bathed) pts++;
      if (b.Nails_Clean) pts++;
      if (b.Uniform_clean) pts++;
      if (b.Discipline) pts++;
      return acc + pts;
    }, 0);

    const avgScore = Math.round((totalPoints / (total * 5)) * 100);

    return { total, presentCount, bathedCount, nailsCount, uniformCount, disciplineCount, avgScore };
  }, [studentBehaviorRecords]);

  // Distinct dates available in active student's behavior records
  const behaviorAvailableDates = useMemo(() => {
    const list = studentBehaviorRecords;
    const set = new Set<string>();
    list.forEach((b) => b.Date && set.add(b.Date));
    return Array.from(set);
  }, [studentBehaviorRecords]);

  // Fee Collection Records strictly matching ONLY the logged-in student
  const selectedStudentFeeRecords = useMemo(() => {
    if (!selectedStudent) return [];
    const sid = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    return feeRecords.filter((r) => {
      const rSid = String(r.Student_ID || '').trim().toLowerCase();
      return Boolean(rSid && (rSid === sid || sid.includes(rSid) || rSid.includes(sid)));
    });
  }, [selectedStudent, feeRecords]);

  // Student Fee Summary (computed balance, total paid, etc.)
  const studentFeeSummary = useMemo(() => {
    if (!selectedStudent) {
      return { balance: 0, rawBalance: 0, totalPaid: 0, totalFee: 0, hasDues: false, receiptsCount: 0 };
    }
    const rawBalance = getStudentBalance(selectedStudent);
    const records = selectedStudentFeeRecords;
    const totalPaid = records.reduce((sum, r) => sum + (Number(r.Amount_Paid) || 0), 0);
    // If raw balance is negative (e.g. -100) or 0, parent owes ₹0 (no dues or advance paid)
    const balance = rawBalance > 0 ? rawBalance : 0;
    const totalFee = (rawBalance > 0 ? rawBalance : 0) + totalPaid;
    return {
      balance,
      rawBalance,
      totalPaid,
      totalFee: totalFee > 0 ? totalFee : totalPaid,
      hasDues: rawBalance > 0,
      receiptsCount: records.length,
    };
  }, [selectedStudent, getStudentBalance, selectedStudentFeeRecords]);

  // Attendance Trend Data (Last 30 Days) for Recharts Line Chart
  const attendanceChartData = useMemo(() => {
    if (!selectedStudent) return [];
    const sid = String(selectedStudent.Student_ID || '').trim().toLowerCase();
    const studentRecs = behaviorList.filter((b) => {
      const bSid = String(b.Student_ID || '').trim().toLowerCase();
      return Boolean(bSid && (bSid === sid || sid.includes(bSid) || bSid.includes(sid)));
    });

    // Sort chronologically (oldest to newest)
    const sorted = [...studentRecs].sort((a, b) => {
      const tsA = parseDateToTimestamp(a.Date);
      const tsB = parseDateToTimestamp(b.Date);
      return tsA - tsB;
    });

    if (sorted.length > 0) {
      const sliceRecs = sorted.slice(-30);
      let cumulativePresent = 0;
      let totalCount = 0;

      return sliceRecs.map((rec) => {
        totalCount += 1;
        if (rec.Is_Present) cumulativePresent += 1;
        const rate = Math.round((cumulativePresent / totalCount) * 100);

        let hygieneScore = 0;
        if (rec.Is_Bathed) hygieneScore += 25;
        if (rec.Nails_Clean) hygieneScore += 25;
        if (rec.Uniform_clean) hygieneScore += 25;
        if (rec.Discipline) hygieneScore += 25;

        const ts = parseDateToTimestamp(rec.Date);
        let dayLabel = rec.Date;
        if (ts) {
          const d = new Date(ts);
          dayLabel = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        }

        return {
          dayLabel,
          rawDate: rec.Date,
          attendanceRate: rate,
          dailyStatus: rec.Is_Present ? 100 : 0,
          isPresent: rec.Is_Present,
          statusLabel: rec.Is_Present ? 'Present (उपस्थित)' : 'Absent (अनुपस्थित)',
          hygieneScore,
          remark: rec.Remark || (rec.Is_Present ? 'उपस्थित' : 'अनुपस्थित'),
          isBathed: rec.Is_Bathed,
          nailsClean: rec.Nails_Clean,
          uniformClean: rec.Uniform_clean,
          discipline: rec.Discipline,
        };
      });
    }

    // Default informative recent baseline
    const now = new Date();
    const fallback = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayLabel = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      fallback.push({
        dayLabel,
        rawDate: d.toLocaleDateString('en-IN'),
        attendanceRate: 100,
        dailyStatus: 100,
        isPresent: true,
        statusLabel: 'Present (उपस्थित)',
        hygieneScore: 100,
        remark: 'Regular attendance',
        isBathed: true,
        nailsClean: true,
        uniformClean: true,
        discipline: true,
      });
    }
    return fallback;
  }, [selectedStudent, behaviorList]);

  // Constructive guidance / Teacher Remark in pure Hindi
  const getBehaviorFeedback = (rec: StudentBehaviorRecord): string => {
    // If custom feedback provided, check if it is default English or already in Hindi
    if (rec.AI_Feedback && rec.AI_Feedback.trim()) {
      const fb = rec.AI_Feedback.trim();
      if (fb.toLowerCase().includes('student was marked absent')) {
        return 'आज छात्र विद्यालय में अनुपस्थित रहा। पढ़ाई और पाठ्यक्रम की निरंतरता के लिए दैनिक उपस्थिति अत्यंत आवश्यक है।';
      }
      if (fb.toLowerCase().includes('exceptional daily standard')) {
        return 'उत्कृष्ट दैनिक आचरण! छात्र ने पूर्ण स्वच्छता, साफ़-सुथरी वर्दी और अनुकरणीय अनुशासन प्रदर्शित किया।';
      }
      return fb;
    }

    if (!rec.Is_Present) {
      return 'आज छात्र विद्यालय में अनुपस्थित रहा। पढ़ाई और पाठ्यक्रम की निरंतरता के लिए दैनिक उपस्थिति अत्यंत आवश्यक है।';
    }

    const missing: string[] = [];
    if (!rec.Is_Bathed) missing.push('सुबह का स्नान व शारीरिक स्वच्छता');
    if (!rec.Nails_Clean) missing.push('नाखूनों की समय पर कटाई व सफ़ाई');
    if (!rec.Uniform_clean) missing.push('साफ़-सुथरी धुली हुई स्कूल यूनिफॉर्म व जूते');
    if (!rec.Discipline) missing.push('कक्षा में ध्यान व अनुशासित व्यवहार');

    if (missing.length === 0) {
      return 'शानदार दैनिक आचरण! छात्र ने पूर्ण स्वच्छता, साफ़-सुथरी वर्दी और प्रशंसनीय अनुशासन प्रदर्शित किया है।';
    }
    return `आज का प्रयास सराहनीय है। कृपया घर पर बच्चे को निम्न बातों में सहयोग व प्रेरणा दें: ${missing.join(', ')}।`;
  };

  // WhatsApp Shareable Daily Report
  const shareBehaviorReport = (rec: StudentBehaviorRecord) => {
    const studentName = selectedStudent?.Student_Name || 'Student';
    const className = getClassName(rec.Class || selectedStudent?.Class);

    let pts = 0;
    if (rec.Is_Present) pts++;
    if (rec.Is_Bathed) pts++;
    if (rec.Nails_Clean) pts++;
    if (rec.Uniform_clean) pts++;
    if (rec.Discipline) pts++;
    const stars = '⭐'.repeat(pts) + '☆'.repeat(5 - pts);

    const message = `*E.V.S. PUBLIC SCHOOL*
*📋 DAILY STUDENT BEHAVIOR & HYGIENE REPORT*
----------------------------------------
👤 *Student:* ${studentName} (${rec.Student_ID})
🏫 *Class:* ${className}
📅 *Date:* ${rec.Date}
🏆 *Overall Score:* ${pts}/5 (${pts * 20}%) ${stars}
----------------------------------------
📍 *Attendance:* ${rec.Is_Present ? '✅ Present (उपस्थित)' : '❌ Absent (अनुपस्थित)'}
🚿 *Bathing / Snan:* ${rec.Is_Bathed ? '✅ Bathed (नहा कर आए)' : '❌ Not Bathed (स्नान नहीं किया)'}
💅 *Nails Cleanliness:* ${rec.Nails_Clean ? '✅ Clean & Trimmed' : '❌ Needs Trimming/Dirty'}
👔 *School Uniform:* ${rec.Uniform_clean ? '✅ Clean & Proper' : '❌ Incomplete / Unclean'}
🌟 *Good Manners:* ${rec.Good_Manners || 'Good'}
🛡️ *Class Discipline:* ${rec.Discipline ? '✅ Well Behaved' : '❌ Needs Improvement'}
📝 *Teacher Remark:* ${rec.Remark || 'OK'}
💡 *Guidance:* ${getBehaviorFeedback(rec)}
----------------------------------------
_E.V.S. Public School - Striving for Character & Academic Excellence_`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(message);
      setCopiedBehaviorReport(rec.Behavior_ID || rec.Date);
      setTimeout(() => setCopiedBehaviorReport(null), 3500);
    }

    const encoded = encodeURIComponent(message);
    const parentMobile = selectedStudent?.Mobile_Number || parentMobileInput || '';
    const cleanMobile = parentMobile.replace(/\D/g, '');
    const waUrl = cleanMobile.length >= 10
      ? `https://wa.me/91${cleanMobile.slice(-10)}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
  };

  // Teacher Dashboard: Submit Homework
  const handleTeacherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hwDetail.trim()) {
      setHwErrorMessage('Please enter homework details.');
      return;
    }

    setHwSubmitting(true);
    setHwSuccessMessage(null);
    setHwErrorMessage(null);

    const payload = {
      action: 'addHomework',
      homework_id: 'HW-' + Date.now(),
      date: hwDate,
      class_name: hwClass,
      subject: hwSubject,
      detail: hwDetail.trim(),
      teacher: activeTeacherName.trim() || 'Faculty',
    };

    try {
      // Send as text/plain to avoid preflight OPTIONS CORS issue with Google Apps Script
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      // Optimistically add to local state
      const newHw: Homework = {
        Homework_ID: payload.homework_id,
        Date: payload.date,
        Class: payload.class_name,
        Subject: payload.subject,
        Homework_Detail: payload.detail,
        Target_Type: 'Whole Class',
        Teacher: payload.teacher,
      };
      setHomeworkList((prev) => [newHw, ...prev]);

      setHwSuccessMessage(`Homework (${payload.subject} for Class ${getClassName(payload.class_name)}) was successfully uploaded!`);
      setHwDetail('');

      // Also trigger a background refetch
      setTimeout(() => {
        fetchHomework();
      }, 1500);
    } catch (err: any) {
      console.error('Error submitting homework:', err);
      // Even if response stream had parsing errors due to CORS redirect in some browsers,
      // often Google Apps Script still writes to the sheet. We show clear status.
      setHwErrorMessage(
        err.message || 'Unable to connect to Google Apps Script. Please verify connection.'
      );
    } finally {
      setHwSubmitting(false);
    }
  };

  // Manager: Filtered Students
  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchSearch =
        studentSearchTerm === '' ||
        String(s.Student_Name || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        String(s.Roll_Number || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        String(s.Admission_Number || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        String(s.Parent_Mobile || '').includes(studentSearchTerm) ||
        String(s['Village/rRoute'] || s.Village || '').toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        getClassName(s.Class).toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        String(s.Class || '').toLowerCase().includes(studentSearchTerm.toLowerCase());

      const matchClass =
        studentClassFilter === 'all' ||
        String(s.Class || '').toLowerCase() === studentClassFilter.toLowerCase() ||
        getClassName(s.Class).toLowerCase() === studentClassFilter.toLowerCase();

      return matchSearch && matchClass;
    });
  }, [students, studentSearchTerm, studentClassFilter, classMap]);

  // Manager: Filtered and Sorted Homework
  const filteredHomework = useMemo(() => {
    const filtered = homeworkList.filter((hw) => {
      const matchSearch =
        hwSearchTerm === '' ||
        String(hw.Subject || '').toLowerCase().includes(hwSearchTerm.toLowerCase()) ||
        String(hw.Homework_Detail || '').toLowerCase().includes(hwSearchTerm.toLowerCase()) ||
        String(hw.Homework_ID || '').toLowerCase().includes(hwSearchTerm.toLowerCase()) ||
        String(hw.Teacher || '').toLowerCase().includes(hwSearchTerm.toLowerCase()) ||
        getClassName(hw.Class).toLowerCase().includes(hwSearchTerm.toLowerCase()) ||
        String(hw.Class || '').toLowerCase().includes(hwSearchTerm.toLowerCase());

      const matchClass =
        hwClassFilter === 'all' ||
        String(hw.Class || '').toLowerCase() === hwClassFilter.toLowerCase() ||
        getClassName(hw.Class).toLowerCase() === hwClassFilter.toLowerCase();

      return matchSearch && matchClass;
    });

    return [...filtered].sort((a, b) => {
      const timeA = a.Date ? new Date(a.Date).getTime() : 0;
      const timeB = b.Date ? new Date(b.Date).getTime() : 0;
      const validA = !isNaN(timeA) ? timeA : 0;
      const validB = !isNaN(timeB) ? timeB : 0;

      if (validA !== validB) {
        return hwDateSortOrder === 'asc' ? validA - validB : validB - validA;
      }
      return hwDateSortOrder === 'asc'
        ? String(a.Date || '').localeCompare(String(b.Date || ''))
        : String(b.Date || '').localeCompare(String(a.Date || ''));
    });
  }, [homeworkList, hwSearchTerm, hwClassFilter, hwDateSortOrder, classMap]);

  // Manager: Filtered and Sorted Daily Behavior Records
  const filteredManagerBehavior = useMemo(() => {
    const filtered = behaviorList.filter((b) => {
      const matchSearch =
        managerBehaviorSearch === '' ||
        String(b.Student_ID || '').toLowerCase().includes(managerBehaviorSearch.toLowerCase()) ||
        String(b.Remark || '').toLowerCase().includes(managerBehaviorSearch.toLowerCase()) ||
        String(b.AI_Feedback || '').toLowerCase().includes(managerBehaviorSearch.toLowerCase()) ||
        String(b.Good_Manners || '').toLowerCase().includes(managerBehaviorSearch.toLowerCase()) ||
        getClassName(b.Class).toLowerCase().includes(managerBehaviorSearch.toLowerCase());

      const matchClass =
        managerBehaviorClassFilter === 'all' ||
        String(b.Class || '').toLowerCase() === managerBehaviorClassFilter.toLowerCase() ||
        getClassName(b.Class).toLowerCase() === managerBehaviorClassFilter.toLowerCase();

      const matchDate =
        managerBehaviorDateFilter === 'all' ||
        String(b.Date || '') === managerBehaviorDateFilter;

      return matchSearch && matchClass && matchDate;
    });

    return [...filtered].sort((a, b) => {
      const timeA = a.Date ? parseDateToTimestamp(a.Date) : 0;
      const timeB = b.Date ? parseDateToTimestamp(b.Date) : 0;
      if (timeA !== timeB) {
        return managerBehaviorSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      }
      return managerBehaviorSortOrder === 'asc'
        ? String(a.Date || '').localeCompare(String(b.Date || ''))
        : String(b.Date || '').localeCompare(String(a.Date || ''));
    });
  }, [behaviorList, managerBehaviorSearch, managerBehaviorClassFilter, managerBehaviorDateFilter, managerBehaviorSortOrder, classMap]);

  // Manager Login handler using Users sheet
  const handleManagerLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setManagerLoginError(null);

    const cleanInput = managerLoginInput.trim().toLowerCase();
    const cleanDigits = cleanInput.replace(/\D/g, '');
    const pass = managerPasswordInput.trim();

    if (!cleanInput) {
      setManagerLoginError('कृपया यूजरनेम, ईमेल या पंजीकृत 10-अंकीय मोबाइल नंबर दर्ज करें।');
      return;
    }
    if (!pass) {
      setManagerLoginError('कृपया पासवर्ड दर्ज करें।');
      return;
    }

    setManagerLoginSubmitting(true);
    let currentUsers = usersList;
    if (currentUsers.length === 0) {
      currentUsers = await fetchUsers();
    }

    try {
      const matched = currentUsers.filter((u) => {
        const uName = String(u.Username || '').trim().toLowerCase();
        const uMobile = String(u.Mobile_number || '').replace(/\D/g, '');
        const uId = String(u.User_ID || '').trim().toLowerCase();
        const isUserMatch =
          uName === cleanInput ||
          uId === cleanInput ||
          (cleanDigits.length >= 10 && uMobile.endsWith(cleanDigits)) ||
          (uMobile.length >= 10 && cleanDigits.endsWith(uMobile));
        return isUserMatch;
      });

      if (matched.length === 0) {
        setManagerLoginError('यह यूजरनेम/मोबाइल स्कूल Users शीट में दर्ज नहीं है। कृपया पुनः जांचें।');
        setManagerLoginSubmitting(false);
        return;
      }

      const user = matched[0];
      const expectedPass = String(user.Password || '').trim();
      // If sheet has password, check match
      if (expectedPass && expectedPass !== pass) {
        setManagerLoginError('गलत पासवर्ड! कृपया सही पासवर्ड दर्ज करें।');
        setManagerLoginSubmitting(false);
        return;
      }

      const desig = String(user.Designation || '').trim().toLowerCase();
      const isManager =
        desig.includes('manager') ||
        desig.includes('admin') ||
        desig.includes('principal') ||
        desig.includes('director') ||
        desig.includes('head');

      if (!isManager) {
        setManagerLoginError(
          `यह खाता '${user.Name}' (${user.Designation || 'Staff'}) का है, जो स्कूल मैनेजर नहीं है। मैनेजर पोर्टल केवल स्कूल मैनेजर के लिए आरक्षित है।`
        );
        setManagerLoginSubmitting(false);
        return;
      }

      // Successful login
      setManagerUser(user);
      try {
        localStorage.setItem('evs_manager_user', JSON.stringify(user));
      } catch (err) {
        console.warn('LocalStorage error:', err);
      }
      setManagerLoginInput('');
      setManagerPasswordInput('');
      setManagerLoginError(null);
    } finally {
      setManagerLoginSubmitting(false);
    }
  };

  const handleManagerLogout = () => {
    setManagerUser(null);
    try {
      localStorage.removeItem('evs_manager_user');
    } catch (err) {
      console.warn('LocalStorage error:', err);
    }
  };

  // Teacher Authentication Handler
  const handleTeacherLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setTeacherLoginError(null);
    setTeacherLoginSubmitting(true);

    const query = teacherLoginInput.trim().toLowerCase();
    const password = teacherPasswordInput.trim();

    if (!query || !password) {
      setTeacherLoginError('कृपया यूजरनेम/मोबाइल और पासवर्ड दोनों दर्ज करें।');
      setTeacherLoginSubmitting(false);
      return;
    }

    const cleanDigits = query.replace(/\D/g, '');

    const user = usersList.find((u) => {
      const uUsername = String(u.Username || '').trim().toLowerCase();
      const uMobile = String(u.Mobile_number || '').trim().replace(/\D/g, '');
      const uId = String(u.User_ID || '').trim().toLowerCase();
      const uName = String(u.Name || '').trim().toLowerCase();

      return (
        uUsername === query ||
        uId === query ||
        uName === query ||
        (cleanDigits.length >= 4 && (uMobile === cleanDigits || uMobile.endsWith(cleanDigits)))
      );
    });

    if (!user) {
      setTeacherLoginError('यह यूजर Users शीट में नहीं मिला। कृपया अपना यूजरनेम या मोबाइल नंबर सही दर्ज करें।');
      setTeacherLoginSubmitting(false);
      return;
    }

    const pass = String(user.Password || '').trim();
    if (pass && pass !== password) {
      setTeacherLoginError('दर्ज किया गया पासवर्ड गलत है। कृपया पुनः प्रयास करें।');
      setTeacherLoginSubmitting(false);
      return;
    }

    // Designation check
    const desig = String(user.Designation || '').trim().toLowerCase();
    const isTeacherAllowed =
      desig.includes('teacher') ||
      desig.includes('faculty') ||
      desig.includes('instructor') ||
      desig.includes('incharge') ||
      desig.includes('head') ||
      desig.includes('manager') ||
      desig.includes('admin') ||
      desig.includes('principal') ||
      desig.includes('director') ||
      desig === '';

    if (!isTeacherAllowed) {
      setTeacherLoginError(`आपका पद '${user.Designation}' है। टीचर पोर्टल केवल अध्यापकों के लिए उपलब्ध है।`);
      setTeacherLoginSubmitting(false);
      return;
    }

    // Success
    setTeacherUser(user);
    try {
      localStorage.setItem('evs_teacher_user', JSON.stringify(user));
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }

    if (user.Name) {
      setActiveTeacherName(user.Name);
    }
    if (user.Assigned_Class) {
      setHwClass(user.Assigned_Class);
      setTeacherTrackerClassFilter(user.Assigned_Class);
    }
    setTeacherLoginInput('');
    setTeacherPasswordInput('');
    setTeacherLoginError(null);
    setTeacherLoginSubmitting(false);
  };

  const handleTeacherLogout = () => {
    setTeacherUser(null);
    try {
      localStorage.removeItem('evs_teacher_user');
    } catch (e) {
      console.warn('LocalStorage error:', e);
    }
  };

  // QR Code Scanner Result Dispatcher
  const handleQRScanned = (scannedValue: string, matchedStudent?: Student) => {
    const studentSearchVal = matchedStudent ? matchedStudent.Student_Name : scannedValue;
    const studentIdVal = matchedStudent ? matchedStudent.Student_ID : scannedValue;

    if (qrScannerTarget === 'managerStudents') {
      setStudentSearchTerm(studentSearchVal);
      if (matchedStudent?.Class) setStudentClassFilter(matchedStudent.Class);
    } else if (qrScannerTarget === 'managerHomework') {
      setHwSearchTerm(studentSearchVal);
      if (matchedStudent?.Class) setHwClassFilter(matchedStudent.Class);
    } else if (qrScannerTarget === 'managerBehavior') {
      setManagerBehaviorSearch(studentSearchVal);
      if (matchedStudent?.Class) setManagerBehaviorClassFilter(matchedStudent.Class);
    } else if (qrScannerTarget === 'managerFees') {
      setManagerFeeSearchTerm(studentSearchVal);
      const targetStudent =
        matchedStudent ||
        students.find(
          (s) =>
            String(s.Student_ID || '').toLowerCase() === scannedValue.toLowerCase() ||
            String(s.Admission_Number || '') === scannedValue
        );
      if (targetStudent) {
        setManagerSelectedFeeStudent(targetStudent);
      }
    } else if (qrScannerTarget === 'teacherTracker' || qrScannerTarget === 'quickHomeworkCheck') {
      setTeacherTrackerSearch(studentSearchVal);
      if (matchedStudent?.Class) setTeacherTrackerClassFilter(matchedStudent.Class);
      const targetStudent =
        matchedStudent ||
        students.find(
          (s) =>
            String(s.Student_ID || '').toLowerCase() === scannedValue.toLowerCase() ||
            String(s.Admission_Number || '') === scannedValue
        );
      if (targetStudent) {
        setSelectedHwTrackerStudent(targetStudent);
        setHwTrackerModalOpen(true);
      }
    } else if (qrScannerTarget === 'addFee') {
      setAddFeeInitialStudentId(studentIdVal);
      setAddFeeModalOpen(true);
    }
  };

  // Dedicated Handler for Saving Student Daily Behavior & Conduct Record (आचरण वगैरह)
  const handleSaveStudentBehavior = (record: StudentBehaviorInput, sendWhatsApp: boolean) => {
    const newRec: StudentBehaviorRecord = {
      Behavior_ID: record.Behavior_ID || `BEH-${Date.now().toString().slice(-6)}`,
      Student_ID: record.Student_ID,
      Date: record.Date,
      Class: record.Class || '',
      Is_Bathed: record.Is_Bathed,
      Nails_Clean: record.Nails_Clean,
      Uniform_clean: record.Uniform_clean,
      Good_Manners: record.Good_Manners,
      Discipline: record.Discipline,
      Is_Present: record.Is_Present,
      Remark: record.Remark,
      AI_Feedback: '',
    };

    setBehaviorList((prev) => [newRec, ...prev]);

    // Save to localStorage for instant persistence
    try {
      const existing = localStorage.getItem('evs_custom_behavior_records');
      const list: StudentBehaviorRecord[] = existing ? JSON.parse(existing) : [];
      list.unshift(newRec);
      localStorage.setItem('evs_custom_behavior_records', JSON.stringify(list));
    } catch (e) {
      console.warn('localStorage error for behavior:', e);
    }

    // Sync to Google Apps Script API in background
    try {
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'addBehavior',
          behavior_id: newRec.Behavior_ID,
          student_id: newRec.Student_ID,
          date: newRec.Date,
          class: newRec.Class,
          is_bathed: newRec.Is_Bathed,
          nails_clean: newRec.Nails_Clean,
          uniform_clean: newRec.Uniform_clean,
          good_manners: newRec.Good_Manners,
          discipline: newRec.Discipline,
          is_present: newRec.Is_Present,
          remark: newRec.Remark,
        }),
      }).catch((err) => console.warn('Background sync behavior error:', err));
    } catch {}
  };

  // Dedicated Handler for Student Homework QR Tracker Modal (Complete/Incomplete)
  const handleUpdateHomeworkStatusModal = (
    recordId: string,
    status: 'Completed' | 'Incompleted',
    studentId: string,
    subject?: string,
    date?: string,
    remark?: string
  ) => {
    setHwTrackerList((prev) => {
      const existingIdx = prev.findIndex(
        (rec) =>
          rec.ID === recordId ||
          (String(rec.Student_ID || '').toLowerCase() === String(studentId).toLowerCase() &&
            (subject ? String(rec.Subject || '').toLowerCase() === String(subject).toLowerCase() : true))
      );

      let updated: HomeworkTrackerRecord[];
      if (existingIdx >= 0) {
        updated = prev.map((rec, idx) =>
          idx === existingIdx ? { ...rec, Last_homework_Status: status } : rec
        );
      } else {
        const studentObj = students.find(
          (s) => String(s.Student_ID || '').toLowerCase() === String(studentId).toLowerCase()
        );
        const newRecord: HomeworkTrackerRecord = {
          ID: recordId || `TRK-${Date.now()}`,
          Date: date || new Date().toISOString().split('T')[0],
          Class: studentObj?.Class || 'C12',
          Student_ID: studentId,
          Subject: subject || 'General',
          Last_homework_Status: status,
        };
        updated = [newRecord, ...prev];
      }

      try {
        localStorage.setItem('evs_custom_hw_tracker', JSON.stringify(updated));
      } catch (e) {
        console.warn('localStorage error:', e);
      }
      return updated;
    });

    try {
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateHomeworkTracker',
          record_id: recordId,
          student_id: studentId,
          status: status,
          subject: subject,
          date: date,
          remark: remark,
        }),
      }).catch((err) => console.warn('Background sync status note:', err));
    } catch {}
  };

  // One-Click Toggle Homework Tracker Status (Completed / Incompleted)
  const handleToggleHomeworkStatus = (recordId: string, currentStatus: string, studentId: string) => {
    const nextStatus = (currentStatus || '').toLowerCase().includes('incom') ? 'Completed' : 'Incompleted';

    setHwTrackerList((prev) => {
      const updated = prev.map((rec) => {
        if (rec.ID === recordId || (rec.Student_ID === studentId && rec.ID === recordId)) {
          return { ...rec, Last_homework_Status: nextStatus };
        }
        return rec;
      });

      try {
        localStorage.setItem('evs_custom_hw_tracker', JSON.stringify(updated));
      } catch (e) {
        console.warn('localStorage error:', e);
      }
      return updated;
    });

    // Background sync to Apps Script API
    try {
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateHomeworkTracker',
          record_id: recordId,
          student_id: studentId,
          status: nextStatus,
        }),
      }).catch((err) => console.warn('Background sync status note:', err));
    } catch {}
  };

  // Add Fee Handler (Manager & Principal)
  const handleFeeAdded = async (newRec: FeeCollectionRecord, sendWhatsApp: boolean) => {
    // Prepend to state
    setFeeRecords((prev) => [newRec, ...prev]);

    // Update fee balance mapping
    const sId = (newRec.Student_ID || '').toLowerCase();
    if (sId && newRec.Balance_Amount !== null && newRec.Balance_Amount !== undefined) {
      setFeeBalances((prev) => ({
        ...prev,
        [sId]: newRec.Balance_Amount as number,
      }));
    }

    // Save to localStorage
    try {
      const existing = localStorage.getItem('evs_custom_fee_records');
      const list: FeeCollectionRecord[] = existing ? JSON.parse(existing) : [];
      list.unshift(newRec);
      localStorage.setItem('evs_custom_fee_records', JSON.stringify(list));
    } catch (e) {
      console.warn('Could not cache custom fee record:', e);
    }

    setFeeNotificationSuccess(
      `रसीद संख्या #${newRec.Receipt_Number} छात्र (${newRec.Student_ID}) के लिए ₹${newRec.Amount_Paid} सफलतापूर्वक दर्ज कर ली गई है!`
    );
    setTimeout(() => setFeeNotificationSuccess(null), 5000);

    // Send to Google Apps Script Web App API
    try {
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'addFee',
          receipt_no: newRec.Receipt_Number,
          student_id: newRec.Student_ID,
          date: newRec.Date,
          fee_type: newRec.Fee_Type,
          month: newRec.Month,
          total_amount: newRec.Total_Amount,
          amount_paid: newRec.Amount_Paid,
          balance_amount: newRec.Balance_Amount,
          payment_mode: newRec.Payment_Mode,
          received_by: newRec.Received_By || managerUser?.Name || 'School Manager',
        }),
      }).catch((e) => console.warn('Background fee upload note:', e));
    } catch {}

    // Send WhatsApp receipt if requested
    if (sendWhatsApp) {
      const st = students.find((s) => String(s.Student_ID || '').toLowerCase() === sId);
      const parentPhone = st ? String(st.Parent_Mobile || '').replace(/\D/g, '') : '';
      const text = `*E.V.S. PUBLIC SCHOOL - फीस रसीद (FEE RECEIPT)*\n--------------------------------\n*रसीद सं (Receipt No):* ${newRec.Receipt_Number}\n*दिनांक (Date):* ${newRec.Date}\n*छात्र (Student):* ${st?.Student_Name || newRec.Student_ID}\n*कक्षा (Class):* ${getClassName(st?.Class)}\n*शुल्क प्रकार (Fee Type):* ${newRec.Fee_Type}\n*माह (Month):* ${newRec.Month}\n*कुल शुल्क (Total Fee):* ₹${newRec.Total_Amount}\n*जमा राशि (Paid Amount):* ₹${newRec.Amount_Paid}\n*शेष बकाया (Balance Due):* ₹${newRec.Balance_Amount}\n*माध्यम (Mode):* ${newRec.Payment_Mode}\n*प्राप्तकर्ता (Received By):* ${newRec.Received_By || managerUser?.Name || 'School Office'}\n--------------------------------\nधन्यवाद!\n*E.V.S. Public School*`;

      const cleanPhone = parentPhone.length === 10 ? `91${parentPhone}` : parentPhone;
      const url = cleanPhone
        ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    }
  };

  // Filtered Homework Tracker records for Teacher Dashboard
  const teacherFilteredTracker = useMemo(() => {
    return hwTrackerList.filter((rec) => {
      const matchClass =
        teacherTrackerClassFilter === 'all' ||
        String(rec.Class || '').toLowerCase() === teacherTrackerClassFilter.toLowerCase() ||
        getClassName(rec.Class).toLowerCase() === teacherTrackerClassFilter.toLowerCase();

      const matchStatus =
        teacherTrackerStatusFilter === 'all' ||
        (teacherTrackerStatusFilter === 'Completed' &&
          (rec.Last_homework_Status || '').toLowerCase().includes('complete') &&
          !(rec.Last_homework_Status || '').toLowerCase().includes('incom')) ||
        (teacherTrackerStatusFilter === 'Incompleted' &&
          ((rec.Last_homework_Status || '').toLowerCase().includes('incom') ||
            (rec.Last_homework_Status || '').toLowerCase().includes('pend')));

      // Join student name
      const matchedStudent = students.find(
        (s) =>
          String(s.Student_ID || '').toLowerCase() === String(rec.Student_ID || '').toLowerCase() ||
          String(s.Student_ID || '').toLowerCase() === String(rec.ID || '').toLowerCase()
      );
      const studentName = matchedStudent?.Student_Name || '';

      const matchSearch =
        teacherTrackerSearch === '' ||
        String(rec.Student_ID || '').toLowerCase().includes(teacherTrackerSearch.toLowerCase()) ||
        String(rec.ID || '').toLowerCase().includes(teacherTrackerSearch.toLowerCase()) ||
        String(rec.Subject || '').toLowerCase().includes(teacherTrackerSearch.toLowerCase()) ||
        studentName.toLowerCase().includes(teacherTrackerSearch.toLowerCase());

      return matchClass && matchStatus && matchSearch;
    });
  }, [hwTrackerList, teacherTrackerClassFilter, teacherTrackerStatusFilter, teacherTrackerSearch, students, classMap]);

  // Filtered Users from Users Sheet (for Manager Users Tab)
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      const matchesSearch =
        staffSearchTerm === '' ||
        String(u.Name || '').toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
        String(u.Username || '').toLowerCase().includes(staffSearchTerm.toLowerCase()) ||
        String(u.Mobile_number || '').includes(staffSearchTerm) ||
        String(u.User_ID || '').toLowerCase().includes(staffSearchTerm.toLowerCase());

      const matchesRole =
        staffRoleFilter === 'all' ||
        String(u.Designation || '').toLowerCase() === staffRoleFilter.toLowerCase();

      return matchesSearch && matchesRole;
    });
  }, [usersList, staffSearchTerm, staffRoleFilter]);

  // Filtered Fees Records (for Manager Fees Tab)
  const filteredManagerFees = useMemo(() => {
    return feeRecords.filter((f) => {
      if (!managerFeeSearchTerm) return true;
      const term = managerFeeSearchTerm.toLowerCase();
      const matchedStudent = students.find(
        (s) => String(s.Student_ID || '').toLowerCase() === String(f.Student_ID || '').toLowerCase()
      );
      const studentName = matchedStudent?.Student_Name || '';
      return (
        String(f.Student_ID || '').toLowerCase().includes(term) ||
        String(f.Receipt_Number || '').toLowerCase().includes(term) ||
        String(f.Fee_Type || '').toLowerCase().includes(term) ||
        studentName.toLowerCase().includes(term)
      );
    });
  }, [feeRecords, managerFeeSearchTerm, students]);

  // Unique staff designations from usersList
  const staffRoleOptions = useMemo(() => {
    const roles = new Set<string>();
    usersList.forEach((u) => {
      if (u.Designation) roles.add(u.Designation.trim());
    });
    return Array.from(roles).sort();
  }, [usersList]);

  // Fee totals for Manager
  const managerFeeTotals = useMemo(() => {
    let collected = 0;
    let balance = 0;
    filteredManagerFees.forEach((f) => {
      collected += Number(f.Amount_Paid) || 0;
      balance += Number(f.Balance_Amount) || 0;
    });
    return { collected, balance };
  }, [filteredManagerFees]);

  // Unique classes from students and homework + standard classes
  const classOptions = useMemo(() => {
    const set = new Set<string>();
    Object.keys(classMap).forEach((c) => set.add(c));
    students.forEach((s) => s.Class && set.add(s.Class.trim()));
    homeworkList.forEach((h) => h.Class && set.add(h.Class.trim()));
    return Array.from(set).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ''), 10);
      const numB = parseInt(b.replace(/\D/g, ''), 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [students, homeworkList, classMap]);

  // Format Date cleanly
  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Helper color badges for subjects
  const getSubjectColor = (subject: string) => {
    const sub = (subject || '').toLowerCase();
    if (sub.includes('math')) return 'bg-blue-100 text-blue-800 border-blue-200';
    if (sub.includes('sci')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (sub.includes('eng')) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (sub.includes('hin')) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (sub.includes('comp')) return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    if (sub.includes('evs')) return 'bg-teal-100 text-teal-800 border-teal-200';
    if (sub.includes('art')) return 'bg-rose-100 text-rose-800 border-rose-200';
    return 'bg-amber-100 text-amber-800 border-amber-200';
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      {/* Main Header with Blue & Gold Theme */}
      <header className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white shadow-lg border-b-2 border-amber-400/80 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            {/* Logo & School Title */}
            <div
              className="flex items-center gap-3.5 cursor-pointer select-none"
              onClick={() => setActiveTab('home')}
            >
              {/* Crest Badge */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 via-amber-300 to-amber-500 flex items-center justify-center shadow-md shadow-amber-500/20 text-[#0c2340] border-2 border-amber-200 shrink-0">
                <i className="fa-solid fa-shield-halved text-2xl"></i>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                    E.V.S. Public School
                  </h1>
                  <span className="bg-amber-400/20 text-amber-300 border border-amber-400/40 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Official
                  </span>
                </div>
                <p className="text-xs text-amber-200/80 font-medium">
                  Inspiring Knowledge • Building Character • Shaping Futures
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              <button
                id="nav-tab-home"
                onClick={() => setActiveTab('home')}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeTab === 'home'
                    ? 'bg-amber-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <i className="fa-solid fa-house"></i>
                <span>Home</span>
              </button>

              <button
                id="nav-tab-parent"
                onClick={() => setActiveTab('parent')}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeTab === 'parent'
                    ? 'bg-amber-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <i className="fa-solid fa-user-group"></i>
                <span>Parent Portal</span>
              </button>

              <button
                id="nav-tab-teacher"
                onClick={() => setActiveTab('teacher')}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeTab === 'teacher'
                    ? 'bg-amber-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <i className="fa-solid fa-chalkboard-user"></i>
                <span>Teacher Portal</span>
                {teacherUser ? (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white/50"
                    title={`Logged in: ${teacherUser.Name}`}
                  />
                ) : (
                  <i
                    className="fa-solid fa-lock text-[10px] opacity-70"
                    title="Teacher Login Required"
                  />
                )}
              </button>

              <button
                id="nav-tab-manager"
                onClick={() => setActiveTab('manager')}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeTab === 'manager'
                    ? 'bg-amber-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <i className="fa-solid fa-user-tie"></i>
                <span>Manager</span>
                {managerUser ? (
                  <span
                    className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white/50"
                    title={`Logged in: ${managerUser.Name}`}
                  />
                ) : (
                  <i
                    className="fa-solid fa-lock text-[10px] opacity-70"
                    title="Manager Login Required"
                  />
                )}
              </button>

              <button
                id="nav-tab-driver"
                onClick={() => setActiveTab('driver')}
                className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  activeTab === 'driver'
                    ? 'bg-amber-400 text-slate-950 shadow-md font-bold'
                    : 'text-slate-200 hover:bg-white/10 hover:text-white'
                }`}
              >
                <i className="fa-solid fa-van-shuttle"></i>
                <span>ड्राइवर (Driver)</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </button>

              {/* Background Sync Indicator & Manual Sync / Refresh Button */}
              <div className="flex items-center gap-1.5 ml-1">
                {isBackgroundSyncing ? (
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs font-semibold animate-pulse shrink-0"
                    title="डेटा बैकग्राउंड में सिंक हो रहा है... (Syncing fresh records in background)"
                  >
                    <i className="fa-solid fa-arrows-rotate fa-spin text-[10px] text-amber-300"></i>
                    <span className="hidden sm:inline text-xs">सिंक हो रहा है...</span>
                  </div>
                ) : (
                  <button
                    id="manual-sync-btn"
                    onClick={() => syncAllData(true)}
                    disabled={isBackgroundSyncing}
                    className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-amber-300 hover:text-amber-200 transition-colors text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 shadow-sm"
                    title={`अंतिम सिंक: ${getSyncTimeLabel()} (क्लिक करके ताज़ा डेटा लोड करें)`}
                  >
                    <i className="fa-solid fa-rotate text-xs"></i>
                    <span className="hidden md:inline">डेटा सिंक (Sync)</span>
                    <span className="text-[10px] opacity-75 hidden xl:inline">({getSyncTimeLabel()})</span>
                  </button>
                )}
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Subtle Background Sync Bar at Top */}
      {isBackgroundSyncing && (
        <div className="w-full bg-gradient-to-r from-amber-500 via-amber-300 to-amber-500 h-0.5 animate-pulse"></div>
      )}

      {/* Sync Status Toast Banner */}
      {syncToastMessage && (
        <div className="fixed top-16 right-4 z-50 bg-slate-900/95 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-amber-400/40 text-xs font-bold flex items-center gap-2 backdrop-blur-xs animate-bounce">
          <i className="fa-solid fa-circle-check text-emerald-400 text-sm"></i>
          <span>{syncToastMessage}</span>
          <button
            onClick={() => setSyncToastMessage(null)}
            className="ml-2 text-white/70 hover:text-white text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Global Success Notification for Added Student */}
      {studentNotificationSuccess && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-circle-check"></i>
            <span>{studentNotificationSuccess}</span>
          </div>
          <button onClick={() => setStudentNotificationSuccess(null)} className="text-white/80 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Global Alert if API Error */}
      {apiError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <i className="fa-solid fa-triangle-exclamation text-amber-600 text-sm"></i>
            <span>
              <strong>Note:</strong> {apiError} Displaying available local/cached records.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                fetchStudents();
                fetchHomework();
              }}
              className="text-blue-900 font-semibold underline hover:text-blue-700 cursor-pointer"
            >
              Retry Connection
            </button>
            <button
              onClick={() => setApiError(null)}
              className="text-amber-800 hover:text-amber-950 text-sm font-bold px-1.5 py-0.5 rounded cursor-pointer"
              title="Dismiss notice"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* ========================================================================= */}
        {/* 1. HOME SCREEN / ROLE SELECTION                                           */}
        {/* ========================================================================= */}
        {activeTab === 'home' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Hero Welcome Card */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0c2340] via-[#10316b] to-[#1e4485] text-white p-6 sm:p-10 shadow-xl border border-blue-900/40">
              {/* Decorative background school elements */}
              <div className="absolute right-0 top-0 -mt-10 -mr-10 w-72 h-72 bg-amber-400/10 rounded-full blur-3xl pointer-events-none"></div>
              <div className="absolute left-1/2 bottom-0 w-80 h-80 bg-blue-400/10 rounded-full blur-3xl pointer-events-none"></div>

              <div className="relative z-10 max-w-3xl">
                <div className="inline-flex items-center gap-2 bg-amber-400/20 text-amber-300 border border-amber-400/30 px-3 py-1 rounded-full text-xs font-semibold mb-4">
                  <i className="fa-solid fa-star text-amber-400"></i>
                  <span>Digital School Administration Portal</span>
                </div>
                <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                  Welcome to <span className="text-amber-400">E.V.S. Public School</span>
                </h2>
                <p className="mt-3 text-sm sm:text-base text-slate-200 leading-relaxed font-normal">
                  A unified digital platform connecting Students, Parents, Educators, and School Administrators. Check daily classwork, review student academic records, and upload homework in real time.
                </p>

                {/* Quick stats badge */}
                <div className="mt-6 flex flex-wrap gap-4 pt-4 border-t border-white/10 text-xs">
                  <div className="flex items-center gap-2 text-slate-200">
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-amber-400">
                      <i className="fa-solid fa-users"></i>
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm">
                        {loadingStudents ? '...' : students.length}
                      </div>
                      <div className="text-[11px] text-slate-300">Registered Students</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-slate-200">
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-amber-400">
                      <i className="fa-solid fa-book"></i>
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm">
                        {loadingHomework ? '...' : homeworkList.length}
                      </div>
                      <div className="text-[11px] text-slate-300">Published Homeworks</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-slate-200">
                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-amber-400">
                      <i className="fa-solid fa-school"></i>
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm">C1 - C12</div>
                      <div className="text-[11px] text-slate-300">Academic Batches</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3 Main Role Selection Cards as requested */}
            <div>
              <div className="text-center mb-6">
                <span className="text-xs font-bold text-blue-900 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                  Select Your Portal Role
                </span>
                <h3 className="text-xl sm:text-2xl font-bold text-[#0c2340] mt-2">
                  Choose an Access Mode to Proceed
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* 1. Parent Portal */}
                <div
                  onClick={() => setActiveTab('parent')}
                  className="group bg-white rounded-2xl p-6 sm:p-7 shadow-md hover:shadow-xl transition-all duration-200 border-2 border-slate-100 hover:border-amber-400 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-amber-50 rounded-bl-full transition-transform group-hover:scale-110 -z-0"></div>
                  <div className="relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-2xl mb-5 group-hover:bg-amber-500 group-hover:text-white transition-colors duration-200">
                      <i className="fa-solid fa-user-group"></i>
                    </div>
                    <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                      For Families & Students
                    </span>
                    <h4 className="text-xl font-bold text-slate-900 mt-1 mb-2 group-hover:text-blue-900 transition-colors">
                      Parent Portal
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">
                      Log in using your registered mobile number to view your ward&apos;s daily homework, teacher remarks, student profile, and dues status.
                    </p>
                  </div>

                  <div className="relative z-10 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-900 group-hover:text-amber-600 flex items-center gap-1">
                      Access Portal
                      <i className="fa-solid fa-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
                    </span>
                    <span className="text-[10px] bg-amber-100 text-amber-800 font-medium px-2 py-0.5 rounded">
                      Mobile Login
                    </span>
                  </div>
                </div>

                {/* 2. Teacher Dashboard */}
                <div
                  onClick={() => setActiveTab('teacher')}
                  className="group bg-white rounded-2xl p-6 sm:p-7 shadow-md hover:shadow-xl transition-all duration-200 border-2 border-slate-100 hover:border-blue-800 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full transition-transform group-hover:scale-110 -z-0"></div>
                  <div className="relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-blue-900/10 text-blue-900 flex items-center justify-center text-2xl mb-5 group-hover:bg-[#0c2340] group-hover:text-amber-400 transition-colors duration-200">
                      <i className="fa-solid fa-chalkboard-user"></i>
                    </div>
                    <span className="text-[11px] font-bold text-blue-800 uppercase tracking-wider">
                      For Educators
                    </span>
                    <h4 className="text-xl font-bold text-slate-900 mt-1 mb-2 group-hover:text-blue-900 transition-colors">
                      Teacher Dashboard
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">
                      Publish daily class homework assignments by class and subject with instant Google Sheets cloud synchronization.
                    </p>
                  </div>

                  <div className="relative z-10 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-900 group-hover:text-blue-700 flex items-center gap-1">
                      Upload Homework
                      <i className="fa-solid fa-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
                    </span>
                    <span className="text-[10px] bg-blue-100 text-blue-900 font-medium px-2 py-0.5 rounded">
                      Direct Post
                    </span>
                  </div>
                </div>

                {/* 3. Manager Dashboard */}
                <div
                  onClick={() => setActiveTab('manager')}
                  className="group bg-white rounded-2xl p-6 sm:p-7 shadow-md hover:shadow-xl transition-all duration-200 border-2 border-slate-100 hover:border-slate-800 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-slate-100 rounded-bl-full transition-transform group-hover:scale-110 -z-0"></div>
                  <div className="relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-slate-900/10 text-slate-900 flex items-center justify-center text-2xl mb-5 group-hover:bg-slate-900 group-hover:text-white transition-colors duration-200">
                      <i className="fa-solid fa-user-tie"></i>
                    </div>
                    <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Administration
                    </span>
                    <h4 className="text-xl font-bold text-slate-900 mt-1 mb-2 group-hover:text-blue-900 transition-colors">
                      Manager Dashboard
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">
                      Comprehensive oversight of all student records, fee collections, homework, and live van GPS tracking.
                    </p>
                  </div>

                  <div className="relative z-10 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 group-hover:text-blue-900 flex items-center gap-1">
                      Manage School
                      <i className="fa-solid fa-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
                    </span>
                    <span className="text-[10px] bg-slate-200 text-slate-800 font-medium px-2 py-0.5 rounded">
                      Full Roster
                    </span>
                  </div>
                </div>

                {/* 4. Driver Portal */}
                <div
                  onClick={() => setActiveTab('driver')}
                  className="group bg-white rounded-2xl p-6 sm:p-7 shadow-md hover:shadow-xl transition-all duration-200 border-2 border-slate-100 hover:border-emerald-500 flex flex-col justify-between cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full transition-transform group-hover:scale-110 -z-0"></div>
                  <div className="relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center text-2xl mb-5 group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-200">
                      <i className="fa-solid fa-van-shuttle"></i>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                      Transport & Safety
                    </span>
                    <h4 className="text-xl font-bold text-slate-900 mt-1 mb-2 group-hover:text-emerald-700 transition-colors">
                      Driver Portal
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed mb-6">
                      वैन ड्राइवर के लिए लाइव जीपीएस लोकेशन प्रसारण, रूट स्टॉप, ट्रिप स्थिति एवं प्रबंधक के साथ रीयल-टाइम संचार।
                    </p>
                  </div>

                  <div className="relative z-10 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-700 group-hover:text-emerald-900 flex items-center gap-1">
                      Start GPS Sharing
                      <i className="fa-solid fa-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
                    </span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-medium px-2 py-0.5 rounded flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                      Live GPS
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. PARENT PORTAL                                                          */}
        {/* ========================================================================= */}
        {activeTab === 'parent' && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header / Sub-banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                    Parent Portal
                  </span>
                  {parentLoggedIn && selectedStudent && (
                    <span className="text-xs bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                      Verified Parent Session
                    </span>
                  )}
                  {parentLoggedIn && parentChildren.length > 1 && (
                    <span className="text-xs bg-blue-100 text-blue-900 font-bold px-2.5 py-0.5 rounded-full border border-blue-200 flex items-center gap-1">
                      <i className="fa-solid fa-users text-blue-700"></i>
                      {parentChildren.length} Children Enrolled
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-[#0c2340] mt-1">
                  Student Homework & Profile Portal
                </h2>
                <p className="text-xs sm:text-sm text-slate-500">
                  {selectedStudent
                    ? `Viewing exclusive records for ${selectedStudent.Student_Name} (Class: ${getClassName(selectedStudent.Class)})`
                    : 'Access homework and school records assigned specifically for your ward.'}
                </p>
              </div>

              {parentLoggedIn && (
                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {selectedStudent && (
                    <div className="hidden sm:flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                      <StudentAvatar
                        student={selectedStudent}
                        photoUrl={getStudentPhoto(selectedStudent)}
                        size="xs"
                      />
                      <span className="font-extrabold text-slate-900">{selectedStudent.Student_Name}</span>
                      <span className="text-[10px] bg-blue-100 text-blue-900 px-1.5 py-0.2 rounded font-semibold">
                        Class {getClassName(selectedStudent.Class)}
                      </span>
                    </div>
                  )}

                  <button
                    onClick={handleParentLogout}
                    className="px-3.5 py-1.5 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fa-solid fa-arrow-right-from-bracket"></i>
                    Sign Out
                  </button>
                </div>
              )}
            </div>

            {/* Login Form if not logged in */}
            {!parentLoggedIn ? (
              <div className="max-w-md mx-auto my-8">
                <div className="bg-white rounded-2xl shadow-lg border border-slate-200/80 p-6 sm:p-8">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center text-xl mb-4 mx-auto">
                    <i className="fa-solid fa-lock"></i>
                  </div>
                  <h3 className="text-lg font-bold text-center text-slate-900">
                    Parent Verification
                  </h3>
                  <p className="text-xs text-center text-slate-500 mt-1 mb-6">
                    Enter the 10-digit mobile number registered with school records to access your child&apos;s records.
                    If you have multiple children, all will be available in your portal!
                  </p>

                  <form onSubmit={handleParentLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Registered Mobile Number or Student ID
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                          <i className="fa-solid fa-phone"></i>
                        </span>
                        <input
                          type="text"
                          value={parentMobileInput}
                          onChange={(e) => setParentMobileInput(e.target.value)}
                          placeholder="e.g. 8954555074 or Student ID"
                          maxLength={20}
                          required
                          className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-sm outline-none transition-all"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loadingStudents}
                      className="w-full py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 hover:text-amber-200 font-bold text-sm rounded-lg shadow transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {loadingStudents ? (
                        <>
                          <i className="fa-solid fa-spinner fa-spin"></i>
                          <span>Checking Database...</span>
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-magnifying-glass"></i>
                          <span>Access Parent Portal</span>
                        </>
                      )}
                    </button>
                  </form>

                  {/* Helper for testing */}
                  <div className="mt-5 pt-4 border-t border-slate-100 text-center">
                    <p className="text-xs text-slate-500 mb-2">Want to test with sample student data?</p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setParentMobileInput('8954555074');
                          handleParentLogin(undefined, '8954555074');
                        }}
                        className="text-xs font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <i className="fa-solid fa-key text-amber-600"></i>
                        Farah (8954555074)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setParentMobileInput('9758444577');
                          handleParentLogin(undefined, '9758444577');
                        }}
                        className="text-xs font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <i className="fa-solid fa-key text-amber-600"></i>
                        Namra (9758444577)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (students.length >= 2) {
                            setParentChildren([students[0], students[1]]);
                            setSelectedStudent(students[0]);
                            setParentLoggedIn(true);
                            setParentSearchAttempted(false);
                          }
                        }}
                        className="text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                        title="Simulate parents with multiple children enrolled"
                      >
                        <i className="fa-solid fa-users text-emerald-600"></i>
                        Multiple Children Demo (2 Wards)
                      </button>
                    </div>
                  </div>

                  {/* Search Attempt Failed Notice */}
                  {parentSearchAttempted && !selectedStudent && (
                    <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs flex items-start gap-2">
                      <i className="fa-solid fa-circle-exclamation text-rose-600 mt-0.5"></i>
                      <div>
                        <div className="font-semibold">No student record found.</div>
                        <p className="mt-0.5 text-rose-700">
                          Please verify the entered phone number or Student ID matches school records or contact the administrative manager.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* LOGGED IN: STUDENT PROFILE & HOMEWORK VIEW */
              <div className="space-y-6">
                {/* Hidden File Input for Student Photo Upload */}
                <input
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoFileChange}
                  className="hidden"
                />

                {/* SIBLINGS / MULTI-CHILD SELECTION TOOLBAR (Clean, Compact, Uncluttered) */}
                {parentChildren.length > 1 && (
                  <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-2.5 shadow-2xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mr-1">
                        <i className="fa-solid fa-users text-[#0c2340]"></i>
                        <span>बच्चा चुनें (Select Child):</span>
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {parentChildren.map((child) => {
                          const isCurrent = selectedStudent && selectedStudent.Student_ID === child.Student_ID;
                          const childPhoto = getStudentPhoto(child);
                          const childBal = getStudentBalance(child);
                          return (
                            <button
                              key={child.Student_ID}
                              type="button"
                              onClick={() => setSelectedStudent(child)}
                              className={`group inline-flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                isCurrent
                                  ? 'bg-[#0c2340] text-amber-300 border-[#0c2340] shadow-xs ring-2 ring-amber-400/40'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                              }`}
                            >
                              <StudentAvatar student={child} photoUrl={childPhoto} size="xs" />
                              <span className="font-extrabold">{child.Student_Name}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                                  isCurrent ? 'bg-white/20 text-amber-200' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {getClassName(child.Class)}
                              </span>
                              {childBal > 0 ? (
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                                    isCurrent ? 'bg-rose-500/30 text-rose-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                                  }`}
                                >
                                  ₹{childBal}
                                </span>
                              ) : null}
                              {isCurrent && (
                                <i className="fa-solid fa-circle-check text-[11px] text-amber-300"></i>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setManualLinkOpen(!manualLinkOpen);
                        setManualLinkError(null);
                        setManualLinkSuccess(null);
                      }}
                      className="text-[11px] font-semibold px-2.5 py-1 text-slate-600 hover:text-blue-900 hover:bg-slate-200/70 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <i className={`fa-solid ${manualLinkOpen ? 'fa-xmark text-rose-500' : 'fa-user-plus text-blue-900'}`}></i>
                      <span>{manualLinkOpen ? 'बंद करें (Close)' : '+ दूसरा बच्चा जोड़ें (+ Add Child)'}</span>
                    </button>
                  </div>
                )}

                {/* Sibling Manual Link Drawer if opened */}
                {manualLinkOpen && (
                  <div className="bg-blue-50/70 border border-blue-200/80 rounded-2xl p-4 text-slate-800 shadow-2xs animate-fadeIn">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-user-plus text-blue-900 text-sm"></i>
                        <h5 className="text-xs font-bold text-blue-950">परिवार में दूसरा बच्चा लिंक करें (Link Sibling)</h5>
                      </div>
                      <button
                        type="button"
                        onClick={() => setManualLinkOpen(false)}
                        className="text-slate-400 hover:text-slate-700 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <form onSubmit={handleLinkSibling} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        type="text"
                        value={manualLinkInput}
                        onChange={(e) => setManualLinkInput(e.target.value)}
                        placeholder="दूसरे बच्चे का Student ID (उदा. dfe3be96), प्रवेश संख्या, या मोबाइल नंबर..."
                        className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-800 placeholder-slate-400 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-700 outline-none"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 bg-[#0c2340] hover:bg-[#153a66] text-amber-300 text-xs font-bold rounded-xl transition-colors cursor-pointer shrink-0"
                      >
                        बच्चा जोड़ें (Link Child)
                      </button>
                    </form>
                    {manualLinkError && (
                      <p className="text-xs text-rose-600 mt-2 flex items-center gap-1">
                        <i className="fa-solid fa-circle-exclamation"></i>
                        {manualLinkError}
                      </p>
                    )}
                    {manualLinkSuccess && (
                      <p className="text-xs text-emerald-700 mt-2 flex items-center gap-1">
                        <i className="fa-solid fa-circle-check"></i>
                        {manualLinkSuccess}
                      </p>
                    )}
                  </div>
                )}

                {/* Active Student Header Bar & Quick ID */}
                {selectedStudent && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3.5">
                        {/* Student Photo Avatar with Change/Upload Trigger */}
                        <StudentAvatar
                          student={selectedStudent}
                          photoUrl={getStudentPhoto(selectedStudent)}
                          size="lg"
                          showUploadBtn={true}
                          onUpload={() => handleTriggerPhotoUpload(selectedStudent.Student_ID)}
                        />

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg sm:text-xl font-black text-slate-900">
                              {selectedStudent.Student_Name || 'Student'}
                            </h3>
                            <span className="bg-blue-100 text-blue-900 text-xs font-bold px-2.5 py-0.5 rounded-full border border-blue-200">
                              कक्षा {getClassName(selectedStudent.Class)}
                            </span>
                            {getStudentBalance(selectedStudent) > 0 ? (
                              <span className="bg-rose-100 text-rose-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-rose-200">
                                बकाया: ₹{getStudentBalance(selectedStudent).toLocaleString('en-IN')}
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                                फीस चुकता ✓
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                            <span>रोल सं: <strong className="text-slate-800">{selectedStudent.Roll_Number || '1'}</strong></span>
                            <span>•</span>
                            <span>आईडी: <strong className="font-mono text-slate-800">{selectedStudent.Student_ID}</strong></span>
                            <span>•</span>
                            <span>प्रवेश सं: <strong className="text-slate-800">{selectedStudent.Admission_Number}</strong></span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPreviewQRStudent(selectedStudent)}
                          className="px-3 py-2 bg-blue-50 hover:bg-[#0c2340] hover:text-amber-300 text-blue-900 border border-blue-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                          title="Click to view student QR code in full screen"
                        >
                          <i className="fa-solid fa-qrcode text-amber-500"></i>
                          <span>क्यूआर पास (QR Pass)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setParentActiveSection('profile')}
                          className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                          title="View complete profile and family details"
                        >
                          <i className="fa-solid fa-id-card text-slate-600"></i>
                          <span>पूरी प्रोफ़ाइल (Full Profile)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* WHEN ON OVERVIEW: SHOW THE 4 INTERACTIVE CARDS */}
                {parentActiveSection === 'overview' ? (
                  <div className="space-y-4 animate-fadeIn">
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between gap-2 shadow-2xs">
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-hand-pointer text-amber-600 text-sm animate-bounce"></i>
                        <span className="font-bold">पूरा विवरण देखने के लिए नीचे दिए गए किसी भी कार्ड पर टच करें:</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          fetchHomework();
                          fetchHomeworkTracker();
                          fetchStudentBehavior();
                          fetchFeeCollection();
                        }}
                        disabled={loadingHomework || loadingHwTracker || loadingBehavior || loadingFees}
                        className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-amber-300 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        title="Refresh data from Google Sheets"
                      >
                        <i className={`fa-solid fa-arrows-rotate ${loadingHomework || loadingHwTracker || loadingBehavior || loadingFees ? 'fa-spin' : ''}`}></i>
                        <span>रिफ्रेश</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      {/* CARD 1: HOMEWORK */}
                      <button
                        id="parent-tab-daily-hw"
                        type="button"
                        onClick={() => {
                          setParentActiveSection('homework');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between group bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-xs hover:border-slate-300 active:scale-[0.98]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 transition-transform group-hover:scale-105 bg-blue-100 text-blue-900">
                            <i className="fa-solid fa-book-open"></i>
                          </div>
                          <span className="text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200">
                            {parentHomework.length} विषय
                          </span>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs sm:text-sm font-black flex items-center justify-between">
                            <span>1. आज का होमवर्क</span>
                            <i className="fa-solid fa-chevron-right text-xs text-slate-300 group-hover:text-slate-500"></i>
                          </div>
                          <div className="text-[11px] mt-0.5 text-slate-500">
                            गृहकार्य व फ़ोटो देखें
                          </div>
                        </div>
                      </button>

                      {/* CARD 2: TRACKER */}
                      <button
                        id="parent-tab-hw-tracker"
                        type="button"
                        onClick={() => {
                          setParentActiveSection('tracker');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between group bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-xs hover:border-slate-300 active:scale-[0.98]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 transition-transform group-hover:scale-105 bg-emerald-100 text-emerald-900">
                            <i className="fa-solid fa-list-check"></i>
                          </div>
                          <span className={`text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full ${
                            trackerStats.incompleted > 0
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {trackerStats.incompleted > 0 ? `${trackerStats.incompleted} अधूरा` : 'सब पूरा ✓'}
                          </span>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs sm:text-sm font-black flex items-center justify-between">
                            <span>2. काम पूरा या अधूरा</span>
                            <i className="fa-solid fa-chevron-right text-xs text-slate-300 group-hover:text-slate-500"></i>
                          </div>
                          <div className="text-[11px] mt-0.5 text-slate-500">
                            होमवर्क स्थिति जांचें
                          </div>
                        </div>
                      </button>

                      {/* CARD 3: FEES */}
                      <button
                        id="parent-tab-fees"
                        type="button"
                        onClick={() => {
                          setParentActiveSection('fees');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between group bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-xs hover:border-slate-300 active:scale-[0.98]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 transition-transform group-hover:scale-105 bg-amber-100 text-amber-900">
                            <i className="fa-solid fa-indian-rupee-sign"></i>
                          </div>
                          <span className={`text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full ${
                            studentFeeSummary.hasDues
                              ? 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {studentFeeSummary.hasDues
                              ? `बकाया ₹${studentFeeSummary.balance.toLocaleString('en-IN')}`
                              : 'पूरी जमा ✓'}
                          </span>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs sm:text-sm font-black flex items-center justify-between">
                            <span>3. स्कूल फीस व रसीदें</span>
                            <i className="fa-solid fa-chevron-right text-xs text-slate-300 group-hover:text-slate-500"></i>
                          </div>
                          <div className="text-[11px] mt-0.5 text-slate-500">
                            {studentFeeSummary.hasDues ? 'जमा विवरण देखें' : 'सभी रसीदें सुरक्षित'}
                          </div>
                        </div>
                      </button>

                      {/* CARD 4: BEHAVIOR & ATTENDANCE */}
                      <button
                        id="parent-tab-daily-behavior"
                        type="button"
                        onClick={() => {
                          setParentActiveSection('behavior');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="p-4 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between group bg-white hover:bg-slate-50 text-slate-800 border-slate-200 shadow-xs hover:border-slate-300 active:scale-[0.98]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 transition-transform group-hover:scale-105 bg-purple-100 text-purple-900">
                            <i className="fa-solid fa-clipboard-check"></i>
                          </div>
                          <span className={`text-[10px] sm:text-xs font-black px-2.5 py-0.5 rounded-full ${
                            latestBehaviorRecord
                              ? latestBehaviorRecord.Is_Present
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-rose-100 text-rose-800 border border-rose-200'
                              : 'bg-purple-100 text-purple-900 border border-purple-200'
                          }`}>
                            {latestBehaviorRecord
                              ? latestBehaviorRecord.Is_Present
                                ? 'आज उपस्थित ✓'
                                : 'अनुपस्थित ❌'
                              : 'हाजिरी रिपोर्ट'}
                          </span>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs sm:text-sm font-black flex items-center justify-between">
                            <span>4. हाजिरी व आचरण</span>
                            <i className="fa-solid fa-chevron-right text-xs text-slate-300 group-hover:text-slate-500"></i>
                          </div>
                          <div className="text-[11px] mt-0.5 text-slate-500">
                            उपस्थिति, ड्रेस व स्वच्छता
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Quick Profile Row */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-700">
                        <i className="fa-solid fa-id-card text-blue-800 text-sm"></i>
                        <span>छात्र का पूर्ण विवरण, प्रवेश संख्या, पिता का नाम और क्यूआर पास:</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setParentActiveSection('profile');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-3.5 py-1.5 bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                      >
                        <i className="fa-solid fa-user"></i>
                        <span>5. पूरी प्रोफ़ाइल देखें</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  /* WHEN IN A DETAIL SECTION: SHOW CLEAN TOP HEADER WITH BACK BUTTON AND QUICK SWITCH TABS */
                  <div className="flex flex-wrap items-center justify-between gap-2.5 bg-[#0c2340] text-white p-3 sm:p-4 rounded-2xl shadow-sm border border-slate-700">
                    <button
                      type="button"
                      onClick={() => {
                        setParentActiveSection('overview');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="flex items-center gap-2 px-3.5 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl text-xs sm:text-sm transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
                    >
                      <i className="fa-solid fa-arrow-left"></i>
                      <span>← वापस मुख्य 4 कार्ड्स (Back to Cards)</span>
                    </button>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => setParentActiveSection('homework')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          parentActiveSection === 'homework' ? 'bg-amber-400 text-slate-950 shadow-xs' : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        📚 1. गृहकार्य
                      </button>
                      <button
                        onClick={() => setParentActiveSection('tracker')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          parentActiveSection === 'tracker' ? 'bg-emerald-400 text-slate-950 shadow-xs' : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        📝 2. स्थिति
                      </button>
                      <button
                        onClick={() => setParentActiveSection('fees')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          parentActiveSection === 'fees' ? 'bg-amber-300 text-slate-950 shadow-xs' : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        💰 3. फीस
                      </button>
                      <button
                        onClick={() => setParentActiveSection('behavior')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          parentActiveSection === 'behavior' ? 'bg-purple-300 text-slate-950 shadow-xs' : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        🌟 4. आचरण
                      </button>
                      <button
                        onClick={() => setParentActiveSection('profile')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          parentActiveSection === 'profile' ? 'bg-blue-300 text-slate-950 shadow-xs' : 'bg-white/15 hover:bg-white/25 text-white'
                        }`}
                      >
                        🪪 5. प्रोफ़ाइल
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          fetchHomework();
                          fetchHomeworkTracker();
                          fetchStudentBehavior();
                          fetchFeeCollection();
                        }}
                        disabled={loadingHomework || loadingHwTracker || loadingBehavior || loadingFees}
                        className="px-2.5 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-xl text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        title="Refresh data from Google Sheets"
                      >
                        <i className={`fa-solid fa-arrows-rotate ${loadingHomework || loadingHwTracker || loadingBehavior || loadingFees ? 'fa-spin' : ''}`}></i>
                      </button>
                    </div>
                  </div>
                )}

                {/* VIEW 1: DAILY HOMEWORK (Strictly Child's Class & Last 3 Days) */}
                {parentActiveSection === 'homework' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-bold text-[#0c2340] flex items-center gap-2">
                            <i className="fa-solid fa-book-open text-amber-500"></i>
                            Classwork & Homework Assignments
                          </h4>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200">
                            कक्षा: {getClassName(selectedStudent?.Class)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {hwDaysFilter === 'latest'
                            ? currentHomeworkPeriodInfo.isToday
                              ? `आज का गृहकार्य दिखाया जा रहा है (दिनांक: ${currentHomeworkPeriodInfo.dateLabel})`
                              : currentHomeworkPeriodInfo.dateLabel
                              ? `पिछला 1 दिन का गृहकार्य दिखाया जा रहा है (दिनांक: ${currentHomeworkPeriodInfo.dateLabel})`
                              : `कक्षा ${getClassName(selectedStudent?.Class)} के लिए नवीनतम गृहकार्य`
                            : `कक्षा ${getClassName(selectedStudent?.Class)} का संपूर्ण ऐतिहासिक गृहकार्य।`}
                        </p>
                      </div>

                      {/* Filter controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Days Filter */}
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => setHwDaysFilter('latest')}
                            className={`px-3 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                              hwDaysFilter === 'latest'
                                ? 'bg-white text-blue-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <i className="fa-regular fa-clock"></i>
                            <span>आज / पिछला दिन</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setHwDaysFilter('all')}
                            className={`px-3 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1.5 ${
                              hwDaysFilter === 'all'
                                ? 'bg-white text-blue-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <i className="fa-solid fa-calendar-days"></i>
                            <span>संपूर्ण इतिहास</span>
                          </button>
                        </div>

                        {/* Target Scope Filter */}
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => setHwFilterType('all')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              hwFilterType === 'all'
                                ? 'bg-white text-blue-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            सभी ({parentHomework.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setHwFilterType('class')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              hwFilterType === 'class'
                                ? 'bg-white text-blue-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            कक्षा (Class)
                          </button>
                          <button
                            type="button"
                            onClick={() => setHwFilterType('student')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              hwFilterType === 'student'
                                ? 'bg-white text-blue-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            व्यक्तिगत (Personal)
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Notice bar for Today / Previous 1 day */}
                    {hwDaysFilter === 'latest' && !currentHomeworkPeriodInfo.empty && (
                      <div
                        className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 border ${
                          currentHomeworkPeriodInfo.isToday
                            ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
                            : 'bg-amber-50 text-amber-950 border-amber-200'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <i
                            className={`fa-solid ${
                              currentHomeworkPeriodInfo.isToday
                                ? 'fa-circle-check text-emerald-600 text-sm'
                                : 'fa-circle-info text-amber-600 text-sm'
                            }`}
                          ></i>
                          <span>
                            <strong>
                              {currentHomeworkPeriodInfo.isToday
                                ? "आज का गृहकार्य (Today's Homework):"
                                : "पिछला 1 दिन का गृहकार्य (Previous Day's Homework):"}
                            </strong>{' '}
                            दिनांक <strong>{currentHomeworkPeriodInfo.dateLabel}</strong> • कक्षा{' '}
                            <strong>{getClassName(selectedStudent?.Class)}</strong>
                            {!currentHomeworkPeriodInfo.isToday && (
                              <span className="text-amber-800 ml-1 font-normal">
                                (आज का नया गृहकार्य अभी अपलोड नहीं हुआ है)
                              </span>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setHwDaysFilter('all')}
                          className="text-blue-900 hover:text-blue-950 font-bold underline cursor-pointer text-[11px] shrink-0"
                        >
                          संपूर्ण इतिहास देखें
                        </button>
                      </div>
                    )}

                    {/* Homework List */}
                    {loadingHomework ? (
                      <div className="py-12 text-center text-slate-500">
                        <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-900 mb-2"></i>
                        <p className="text-xs">Fetching homework records from school server...</p>
                      </div>
                    ) : parentHomework.length === 0 ? (
                      <div className="py-12 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center text-2xl mx-auto mb-3">
                          <i className="fa-solid fa-circle-check"></i>
                        </div>
                        <h5 className="text-sm font-bold text-slate-800">
                          {hwDaysFilter === 'latest'
                            ? 'आज या पिछले दिन का कोई गृहकार्य नहीं है'
                            : 'कोई गृहकार्य नहीं मिला'}
                        </h5>
                        <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                          कक्षा {getClassName(selectedStudent?.Class)} के लिए{' '}
                          {hwDaysFilter === 'latest'
                            ? 'आज या पिछले 1 दिन का गृहकार्य दर्ज नहीं है।'
                            : 'चुने गए फ़िल्टर के अनुसार कोई गृहकार्य नहीं मिला।'}
                        </p>
                        {hwDaysFilter === 'latest' && (
                          <button
                            type="button"
                            onClick={() => setHwDaysFilter('all')}
                            className="mt-3 text-xs text-blue-900 font-bold underline cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <i className="fa-solid fa-history"></i>
                            <span>पुराना संपूर्ण गृहकार्य देखें (Check All Previous Homework)</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {parentHomework.map((hw, idx) => {
                          const trackerStatus = getHomeworkTrackerStatus(hw);
                          const isCompleted =
                            trackerStatus &&
                            trackerStatus.toLowerCase().includes('complete') &&
                            !trackerStatus.toLowerCase().includes('incom');
                          const isIncomplete =
                            trackerStatus &&
                            (trackerStatus.toLowerCase().includes('incom') ||
                              trackerStatus.toLowerCase().includes('pend'));

                          return (
                            <div
                              key={hw.Homework_ID || idx}
                              className="bg-slate-50 hover:bg-white rounded-xl p-4 border border-slate-200/80 hover:border-amber-400 hover:shadow-md transition-all flex flex-col justify-between"
                            >
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <span
                                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${getSubjectColor(
                                      hw.Subject
                                    )}`}
                                  >
                                    {hw.Subject || 'General'}
                                  </span>
                                  <span className="text-[11px] text-slate-500 flex items-center gap-1 font-medium">
                                    <i className="fa-regular fa-calendar text-slate-400"></i>
                                    {formatDate(hw.Date)}
                                  </span>
                                </div>

                                <h5 className="text-sm font-bold text-slate-900 mb-1.5 flex items-center justify-between">
                                  <span>
                                    {hw.Subject} - Class {getClassName(hw.Class || selectedStudent?.Class)}
                                  </span>
                                </h5>

                                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line bg-white/80 p-2.5 rounded-lg border border-slate-200/60">
                                  {hw.Homework_Detail || 'No detailed instructions provided.'}
                                </p>

                                {/* Attached Photos & PDF Documents from Google Sheets / AppSheet */}
                                <div className="mt-3">
                                  <HomeworkMediaAttachmentList
                                    homework={hw}
                                    onOpenMedia={(media) => {
                                      setMediaZoom(1);
                                      setMediaRotation(0);
                                      setActiveMediaModal(media);
                                    }}
                                  />
                                </div>

                                {/* Tracker Status pill if matched in Homework_Tracker */}
                                {trackerStatus && (
                                  <div
                                    className={`mt-2.5 px-3 py-1.5 rounded-lg flex items-center justify-between text-xs border ${
                                      isCompleted
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                        : isIncomplete
                                        ? 'bg-rose-50 border-rose-300 text-rose-900'
                                        : 'bg-amber-50 border-amber-300 text-amber-900'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5 font-semibold text-[11px]">
                                      <i
                                        className={`fa-solid ${
                                          isCompleted
                                            ? 'fa-circle-check text-emerald-600'
                                            : isIncomplete
                                            ? 'fa-circle-xmark text-rose-600'
                                            : 'fa-clock text-amber-600'
                                        }`}
                                      ></i>
                                      <span>Homework Tracker Status:</span>
                                    </span>
                                    <span
                                      className={`text-[10px] px-2 py-0.5 rounded-md font-extrabold uppercase tracking-wide ${
                                        isCompleted
                                          ? 'bg-emerald-600 text-white'
                                          : isIncomplete
                                          ? 'bg-rose-600 text-white'
                                          : 'bg-amber-600 text-white'
                                      }`}
                                    >
                                      {trackerStatus}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="mt-3 pt-2.5 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                                <span className="flex items-center gap-1 text-slate-600">
                                  <i className="fa-solid fa-chalkboard-user text-blue-900"></i>
                                  {hw.Teacher ? `Teacher: ${hw.Teacher}` : 'Class Faculty'}
                                </span>
                                {hw.Target_Type && (
                                  <span className="bg-slate-200/70 text-slate-700 px-2 py-0.5 rounded text-[10px] font-medium">
                                    {hw.Target_Type}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Return to Cards Button */}
                    <div className="pt-4 border-t border-slate-200 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setParentActiveSection('overview');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-5 py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                      >
                        <i className="fa-solid fa-arrow-left"></i>
                        <span>← वापस मुख्य 4 कार्ड्स पर जाएं (Back to Cards)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* VIEW 2: HOMEWORK TRACKER (Modeled from Google Sheet Homework_Tracker) */}
                {parentActiveSection === 'tracker' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 space-y-5">
                    {/* Tracker Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-bold text-[#0c2340] flex items-center gap-2">
                            <i className="fa-solid fa-list-check text-emerald-600"></i>
                            Homework Tracker (होमवर्क ट्रैकर)
                          </h4>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-200">
                            Live Sheet Sync
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          Tracking homework completion status for student{' '}
                          <strong className="text-slate-800">{selectedStudent.Student_Name}</strong> (Class:{' '}
                          <strong>{getClassName(selectedStudent.Class)}</strong>, ID:{' '}
                          <span className="font-mono">{selectedStudent.Student_ID}</span>)
                        </p>
                      </div>

                      {/* Tracker Filter Controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Multiple Children Quick Switcher (if family has >1 child) */}
                        {parentChildren.length > 1 && (
                          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                            <span className="text-slate-500 px-1 text-[11px] font-bold">Child:</span>
                            {parentChildren.map((child) => {
                              const isCurrent = selectedStudent && selectedStudent.Student_ID === child.Student_ID;
                              return (
                                <button
                                  key={child.Student_ID}
                                  type="button"
                                  onClick={() => setSelectedStudent(child)}
                                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                    isCurrent
                                      ? 'bg-[#0c2340] text-amber-300 shadow-xs font-bold'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {child.Student_Name}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Status Filter */}
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => setTrackerStatusFilter('all')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                              trackerStatusFilter === 'all'
                                ? 'bg-white text-blue-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            All ({studentTrackerRecords.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrackerStatusFilter('completed')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer text-emerald-700 ${
                              trackerStatusFilter === 'completed'
                                ? 'bg-white text-emerald-900 shadow-xs font-bold'
                                : 'hover:text-emerald-900'
                            }`}
                          >
                            Completed ({trackerStats.completed})
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrackerStatusFilter('incompleted')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer text-rose-700 ${
                              trackerStatusFilter === 'incompleted'
                                ? 'bg-white text-rose-900 shadow-xs font-bold'
                                : 'hover:text-rose-900'
                            }`}
                          >
                            Incompleted ({trackerStats.incompleted})
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* KPI Stat Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Total Tracked
                        </div>
                        <div className="text-xl font-extrabold text-slate-800 mt-1">
                          {trackerStats.total}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">Assignments logged for {selectedStudent.Student_Name}</div>
                      </div>

                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
                        <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider flex items-center justify-between">
                          <span>Completed</span>
                          <i className="fa-solid fa-circle-check text-emerald-600"></i>
                        </div>
                        <div className="text-xl font-extrabold text-emerald-900 mt-1">
                          {trackerStats.completed}
                        </div>
                        <div className="text-[10px] text-emerald-700 mt-0.5">Fully finished homework</div>
                      </div>

                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5">
                        <div className="text-[11px] font-bold text-rose-700 uppercase tracking-wider flex items-center justify-between">
                          <span>Incompleted</span>
                          <i className="fa-solid fa-circle-xmark text-rose-600"></i>
                        </div>
                        <div className="text-xl font-extrabold text-rose-900 mt-1">
                          {trackerStats.incompleted}
                        </div>
                        <div className="text-[10px] text-rose-700 mt-0.5">Pending or incomplete</div>
                      </div>

                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5">
                        <div className="text-[11px] font-bold text-blue-800 uppercase tracking-wider flex items-center justify-between">
                          <span>Completion Rate</span>
                          <span>{trackerStats.rate}%</span>
                        </div>
                        <div className="w-full bg-blue-200 rounded-full h-2.5 mt-2.5 overflow-hidden">
                          <div
                            className="bg-blue-900 h-2.5 rounded-full transition-all duration-500"
                            style={{ width: `${trackerStats.rate}%` }}
                          ></div>
                        </div>
                        <div className="text-[10px] text-blue-700 mt-1 font-semibold">
                          {trackerStats.rate >= 80 ? 'Excellent performance' : 'Keep practicing'}
                        </div>
                      </div>
                    </div>

                    {/* Tracker Data Table / Cards */}
                    {loadingHwTracker ? (
                      <div className="py-12 text-center text-slate-500">
                        <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-900 mb-2"></i>
                        <p className="text-xs">Fetching homework tracker records from sheet...</p>
                      </div>
                    ) : filteredTrackerRecords.length === 0 ? (
                      <div className="py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
                        <i className="fa-solid fa-clipboard-check text-3xl text-slate-400 mb-2"></i>
                        <h5 className="text-sm font-bold text-slate-700">No Tracker Records Found</h5>
                        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                          No assignment completion records found for {selectedStudent.Student_Name}.
                          Records will automatically appear here once teachers submit progress evaluations.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-[#0c2340] text-white uppercase text-[10px] tracking-wider font-bold">
                            <tr>
                              <th className="px-3.5 py-3">ID</th>
                              <th className="px-3.5 py-3">Date</th>
                              <th className="px-3.5 py-3">Class</th>
                              <th className="px-3.5 py-3">Student ID</th>
                              <th className="px-3.5 py-3">Subject</th>
                              <th className="px-3.5 py-3">Last Homework Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 bg-white">
                            {filteredTrackerRecords.map((rec, index) => {
                              const isCompleted =
                                (rec.Last_homework_Status || '').toLowerCase().includes('complete') &&
                                !(rec.Last_homework_Status || '').toLowerCase().includes('incom');
                              const isIncompleted =
                                (rec.Last_homework_Status || '').toLowerCase().includes('incom') ||
                                (rec.Last_homework_Status || '').toLowerCase().includes('pend');

                              return (
                                <tr
                                  key={rec.ID ? `${rec.ID}-${index}` : index}
                                  className="hover:bg-slate-50 transition-colors"
                                >
                                  <td className="px-3.5 py-3 font-mono font-bold text-slate-700">
                                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                                      #{rec.ID || '—'}
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 text-slate-700 font-semibold whitespace-nowrap">
                                    <i className="fa-regular fa-calendar text-slate-400 mr-1.5"></i>
                                    {rec.Date || '—'}
                                  </td>
                                  <td className="px-3.5 py-3">
                                    <span className="font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                                      {getClassName(rec.Class)}
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 font-mono text-slate-600">
                                    {rec.Student_ID ? (
                                      <span
                                        className={`px-1.5 py-0.5 rounded ${
                                          rec.Student_ID.toLowerCase() ===
                                          (selectedStudent.Student_ID || '').toLowerCase()
                                            ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300'
                                            : 'text-slate-600'
                                        }`}
                                      >
                                        {rec.Student_ID}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 italic">Class-wide</span>
                                    )}
                                  </td>
                                  <td className="px-3.5 py-3">
                                    <span
                                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${getSubjectColor(
                                        rec.Subject
                                      )}`}
                                    >
                                      {rec.Subject || '—'}
                                    </span>
                                  </td>
                                  <td className="px-3.5 py-3 whitespace-nowrap">
                                    <span
                                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide border ${
                                        isCompleted
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : isIncompleted
                                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                                          : 'bg-amber-100 text-amber-800 border-amber-300'
                                      }`}
                                    >
                                      <i
                                        className={`fa-solid ${
                                          isCompleted
                                            ? 'fa-circle-check text-emerald-600'
                                            : isIncompleted
                                            ? 'fa-circle-xmark text-rose-600'
                                            : 'fa-circle-dot text-amber-600'
                                        }`}
                                      ></i>
                                      <span>{rec.Last_homework_Status || 'Pending'}</span>
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Return to Cards Button */}
                    <div className="pt-4 border-t border-slate-200 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setParentActiveSection('overview');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-5 py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                      >
                        <i className="fa-solid fa-arrow-left"></i>
                        <span>← वापस मुख्य 4 कार्ड्स पर जाएं (Back to Cards)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* VIEW 3: DAILY BEHAVIOR & HYGIENE REPORT (Modeled from Google Sheet: Student_Behavior) */}
                {parentActiveSection === 'behavior' && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 space-y-5">
                    {/* Behavior Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-bold text-[#0c2340] flex items-center gap-2">
                            <i className="fa-solid fa-clipboard-check text-purple-600"></i>
                            <span>दैनिक हाजिरी व आचरण रिपोर्ट (Daily Attendance & Behavior)</span>
                          </h4>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-200">
                            स्कूल रिकॉर्ड
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          छात्र: <strong className="text-slate-800">{selectedStudent.Student_Name}</strong> • कक्षा:{' '}
                          <strong className="text-slate-800">{getClassName(selectedStudent.Class)}</strong> • प्रवेश सं:{' '}
                          <span className="font-mono font-bold text-slate-700">{selectedStudent.Admission_Number}</span>
                        </p>
                      </div>

                      {/* Filter Controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Multiple Children Quick Switcher (if family has >1 child) */}
                        {parentChildren.length > 1 && (
                          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                            <span className="text-slate-500 px-1 text-[11px] font-bold">बच्चा चुनें:</span>
                            {parentChildren.map((child) => {
                              const isCurrent = selectedStudent && selectedStudent.Student_ID === child.Student_ID;
                              return (
                                <button
                                  key={child.Student_ID}
                                  type="button"
                                  onClick={() => setSelectedStudent(child)}
                                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                                    isCurrent
                                      ? 'bg-[#0c2340] text-amber-300 shadow-xs font-bold'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {child.Student_Name}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Date Filter Dropdown */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500 font-bold hidden sm:inline">तारीख:</span>
                          <select
                            value={behaviorFilterDate}
                            onChange={(e) => setBehaviorFilterDate(e.target.value)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-700 outline-none font-semibold"
                          >
                            <option value="all">सभी तारीखें ({behaviorAvailableDates.length} दिन)</option>
                            {behaviorAvailableDates.map((d) => (
                              <option key={d} value={d}>
                                📅 {d}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* View Mode Toggle: Cards vs Table */}
                        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                          <button
                            type="button"
                            onClick={() => setBehaviorViewMode('cards')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 ${
                              behaviorViewMode === 'cards'
                                ? 'bg-white text-purple-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Daily Cards View"
                          >
                            <i className="fa-solid fa-id-card"></i>
                            <span>कार्ड व्यू</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setBehaviorViewMode('table')}
                            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer flex items-center gap-1 ${
                              behaviorViewMode === 'table'
                                ? 'bg-white text-purple-900 shadow-xs font-bold'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                            title="Spreadsheet Table View"
                          >
                            <i className="fa-solid fa-table"></i>
                            <span className="hidden sm:inline">टेबल</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Copied to Clipboard Notification */}
                    {copiedBehaviorReport && (
                      <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs font-bold flex items-center justify-between shadow-xs animate-fadeIn">
                        <div className="flex items-center gap-2">
                          <i className="fa-solid fa-circle-check text-emerald-600 text-base"></i>
                          <span>
                            दैनिक रिपोर्ट कॉपी कर ली गई है और व्हाट्सएप खुल गया है!
                          </span>
                        </div>
                        <span className="text-[10px] text-emerald-700 font-mono">भेजने को तैयार</span>
                      </div>
                    )}

                    {/* SIMPLIFIED ATTENDANCE & HABITS SUMMARY (आसान सारांश - कोई भी अभिभावक आसानी से समझ सके) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* ATTENDANCE CARD */}
                      <div className="bg-gradient-to-br from-blue-50/90 to-indigo-50/50 border border-blue-200 rounded-2xl p-4 sm:p-5 shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 flex items-center gap-1.5">
                              <i className="fa-solid fa-calendar-check text-blue-600"></i>
                              <span>स्कूल में कुल उपस्थिति (Attendance)</span>
                            </span>
                            <div className="text-2xl sm:text-3xl font-black text-[#0c2340] mt-1">
                              {behaviorStats.presentCount}{' '}
                              <span className="text-base sm:text-lg font-bold text-slate-500">
                                / {behaviorStats.total} दिन उपस्थित
                              </span>
                            </div>
                          </div>
                          <span
                            className={`text-xs font-black px-3 py-1 rounded-full border shrink-0 ${
                              behaviorStats.total > 0 &&
                              Math.round((behaviorStats.presentCount / behaviorStats.total) * 100) >= 75
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : 'bg-amber-100 text-amber-900 border-amber-300'
                            }`}
                          >
                            {behaviorStats.total > 0
                              ? `${Math.round((behaviorStats.presentCount / behaviorStats.total) * 100)}% हाजिरी`
                              : 'रिकॉर्ड नहीं'}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-blue-200/70 rounded-full h-2.5 mt-3 overflow-hidden">
                          <div
                            className="bg-[#0c2340] h-2.5 rounded-full transition-all duration-500"
                            style={{
                              width: `${
                                behaviorStats.total > 0
                                  ? Math.round((behaviorStats.presentCount / behaviorStats.total) * 100)
                                  : 0
                              }%`,
                            }}
                          ></div>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between text-xs">
                          <span className="text-slate-600">
                            {behaviorStats.total > 0 &&
                            Math.round((behaviorStats.presentCount / behaviorStats.total) * 100) >= 75 ? (
                              <strong className="text-emerald-700">🌟 बहुत अच्छा! हाजिरी 75% से ऊपर है।</strong>
                            ) : (
                              <strong className="text-amber-700">⚠️ ध्यान दें: न्यूनतम 75% हाजिरी आवश्यक है।</strong>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowAttendanceChart((prev) => !prev)}
                            className="text-blue-900 hover:text-blue-700 font-bold underline cursor-pointer text-[11px]"
                          >
                            {showAttendanceChart ? 'ग्राफ छिपाएं' : '30-दिन ग्राफ देखें'}
                          </button>
                        </div>
                      </div>

                      {/* HABITS & DISCIPLINE CARD */}
                      <div className="bg-gradient-to-br from-emerald-50/90 to-teal-50/50 border border-emerald-200 rounded-2xl p-4 sm:p-5 shadow-xs">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                              <i className="fa-solid fa-sparkles text-emerald-600"></i>
                              <span>स्वच्छता व अनुशासन (Good Habits)</span>
                            </span>
                            <div className="text-2xl sm:text-3xl font-black text-emerald-950 mt-1">
                              {behaviorStats.avgScore}%{' '}
                              <span className="text-base sm:text-lg font-bold text-slate-500">औसत स्कोर</span>
                            </div>
                          </div>
                          <span className="text-xs font-black px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
                            {behaviorStats.avgScore >= 80 ? 'उत्कृष्ट' : 'संतोषजनक'}
                          </span>
                        </div>

                        {/* Habits Quick Chips */}
                        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                          <div className="bg-white/80 border border-emerald-200 rounded-xl p-2">
                            <div className="text-[10px] text-slate-500 font-semibold">🚿 दैनिक स्नान</div>
                            <div className="text-xs font-black text-emerald-950 mt-0.5">
                              {behaviorStats.bathedCount}/{behaviorStats.total} दिन
                            </div>
                          </div>
                          <div className="bg-white/80 border border-emerald-200 rounded-xl p-2">
                            <div className="text-[10px] text-slate-500 font-semibold">👔 साफ़ वर्दी</div>
                            <div className="text-xs font-black text-emerald-950 mt-0.5">
                              {behaviorStats.uniformCount}/{behaviorStats.total} दिन
                            </div>
                          </div>
                          <div className="bg-white/80 border border-emerald-200 rounded-xl p-2">
                            <div className="text-[10px] text-slate-500 font-semibold">🤝 अनुशासन</div>
                            <div className="text-xs font-black text-emerald-950 mt-0.5">
                              {behaviorStats.disciplineCount}/{behaviorStats.total} दिन
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 text-[11px] text-emerald-800 text-center font-medium">
                          नाखून साफ़ व कटे हुए: <strong>{behaviorStats.nailsCount}/{behaviorStats.total} दिन</strong>
                        </div>
                      </div>
                    </div>

                    {/* OPTIONAL COLLAPSIBLE 30-DAY ATTENDANCE TREND CHART */}
                    {showAttendanceChart && (
                      <div id="parent-attendance-trend-chart-card" className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 sm:p-5 animate-fadeIn">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
                              <h4 className="text-sm sm:text-base font-extrabold text-[#0c2340]">
                                30-दिन स्कूल हाजिरी का रुझान (30-Day Attendance Trend)
                              </h4>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              दैनिक उपस्थिति और 30-दिन संचयी औसत ग्राफ (Attendance Rate & Daily Presence)
                            </p>
                          </div>

                          <div className="flex items-center gap-2 self-start sm:self-auto">
                            <div className="px-3 py-1 bg-blue-100 text-blue-900 border border-blue-200 rounded-lg text-xs font-bold flex items-center gap-1.5">
                              <i className="fa-solid fa-chart-line text-blue-600"></i>
                              <span>
                                {attendanceChartData.length > 0
                                  ? `${attendanceChartData[attendanceChartData.length - 1]?.attendanceRate || 0}% कुल हाजिरी`
                                  : '0% हाजिरी'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowAttendanceChart(false)}
                              className="text-xs text-slate-500 hover:text-slate-700 underline font-bold"
                            >
                              बंद करें
                            </button>
                          </div>
                        </div>

                        {/* Recharts Responsive Container */}
                        <div className="h-64 sm:h-72 w-full pt-2">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart
                              data={attendanceChartData}
                              margin={{ top: 10, right: 20, left: -15, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                              <XAxis
                                dataKey="dayLabel"
                                tick={{ fontSize: 10, fill: '#64748b' }}
                                tickLine={false}
                                axisLine={{ stroke: '#cbd5e1' }}
                              />
                              <YAxis
                                domain={[0, 100]}
                                ticks={[0, 25, 50, 75, 100]}
                                unit="%"
                                tick={{ fontSize: 10, fill: '#64748b' }}
                                tickLine={false}
                                axisLine={{ stroke: '#cbd5e1' }}
                              />
                              <RechartsTooltip
                                content={({ active, payload }) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-700 text-xs min-w-44">
                                        <div className="font-bold text-amber-400 border-b border-slate-700 pb-1 mb-2 flex items-center justify-between">
                                          <span>{data.rawDate || data.dayLabel}</span>
                                          <span
                                            className={`text-[9px] px-1.5 py-0.2 rounded font-black ${
                                              data.isPresent
                                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                            }`}
                                          >
                                            {data.isPresent ? 'उपस्थित (Present)' : 'अनुपस्थित (Absent)'}
                                          </span>
                                        </div>
                                        <div className="space-y-1 text-[11px]">
                                          <div className="flex justify-between">
                                            <span className="text-slate-400">संचयी हाजिरी दर:</span>
                                            <span className="font-bold text-blue-300">{data.attendanceRate}%</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-slate-400">दैनिक स्वच्छता स्कोर:</span>
                                            <span className="font-bold text-emerald-300">{data.hygieneScore}%</span>
                                          </div>
                                          {data.remark && (
                                            <div className="pt-1 text-[10px] text-slate-300 italic border-t border-slate-800 mt-1">
                                              शिक्षक रिमार्क: {data.remark}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <RechartsLegend
                                verticalAlign="top"
                                height={32}
                                wrapperStyle={{ fontSize: '11px', paddingTop: '0px' }}
                              />
                              <ReferenceLine
                                y={75}
                                stroke="#f59e0b"
                                strokeDasharray="4 4"
                                label={{
                                  value: 'न्यूनतम 75% लक्ष्य',
                                  fill: '#b45309',
                                  fontSize: 10,
                                  position: 'insideTopRight',
                                }}
                              />
                              <Line
                                type="monotone"
                                dataKey="attendanceRate"
                                name="संचयी हाजिरी % (Attendance Trend)"
                                stroke="#2563eb"
                                strokeWidth={3}
                                dot={{ r: 3, fill: '#1d4ed8', stroke: '#fff', strokeWidth: 1.5 }}
                                activeDot={{ r: 6, fill: '#1e40af' }}
                              />
                              <Line
                                type="stepAfter"
                                dataKey="dailyStatus"
                                name="दैनिक उपस्थिति (100=Present, 0=Absent)"
                                stroke="#10b981"
                                strokeWidth={2}
                                strokeDasharray="4 4"
                                dot={{ r: 2, fill: '#059669' }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    )}

                    {/* VIEW MODE 1: DAILY REPORT CARDS IN PURE INTUITIVE HINDI */}
                    {behaviorViewMode === 'cards' && (
                      <div className="space-y-4">
                        {filteredBehaviorRecords.length === 0 ? (
                          <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                            <i className="fa-solid fa-clipboard-question text-3xl text-slate-300 mb-2"></i>
                            <p className="text-sm text-slate-600 font-semibold">
                              {selectedStudent.Student_Name} के लिए कोई दैनिक रिपोर्ट नहीं मिली।
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                              शिक्षकों द्वारा दर्ज की गई दैनिक हाजिरी व आचरण रिपोर्ट यहाँ दिखाई देगी।
                            </p>
                          </div>
                        ) : (
                          filteredBehaviorRecords.map((rec, index) => {
                            let points = 0;
                            if (rec.Is_Present) points++;
                            if (rec.Is_Bathed) points++;
                            if (rec.Nails_Clean) points++;
                            if (rec.Uniform_clean) points++;
                            if (rec.Discipline) points++;
                            const isFault =
                              (rec.Remark || '').toLowerCase().includes('fault') ||
                              (rec.Remark || '').toLowerCase().includes('bad');

                            return (
                              <div
                                key={rec.Behavior_ID ? `${rec.Behavior_ID}-${index}` : index}
                                className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-md transition-all overflow-hidden"
                              >
                                {/* Card Header */}
                                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="bg-[#0c2340] text-amber-300 font-bold px-3 py-1 rounded-xl text-xs flex items-center gap-1.5 shadow-2xs">
                                      <i className="fa-regular fa-calendar"></i>
                                      <span>तारीख: {rec.Date}</span>
                                    </span>
                                    <span className="bg-blue-100 text-blue-900 font-bold px-2.5 py-0.5 rounded-lg text-xs border border-blue-200">
                                      कक्षा {getClassName(rec.Class)}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    {/* Attendance Status Badge in Hindi */}
                                    <span
                                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border ${
                                        rec.Is_Present
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      <i
                                        className={`fa-solid ${
                                          rec.Is_Present ? 'fa-circle-check text-emerald-600' : 'fa-circle-xmark text-rose-600'
                                        }`}
                                      ></i>
                                      <span>{rec.Is_Present ? '🟢 स्कूल आए थे (उपस्थित)' : '🔴 स्कूल नहीं आए (अनुपस्थित)'}</span>
                                    </span>

                                    {/* Score Stars */}
                                    <span className="bg-amber-100 text-amber-900 border border-amber-300 font-extrabold text-xs px-2.5 py-1 rounded-full flex items-center gap-1">
                                      <i className="fa-solid fa-star text-amber-500"></i>
                                      <span>{points}/5 अंक</span>
                                    </span>
                                  </div>
                                </div>

                                {/* Card Body */}
                                <div className="p-4 sm:p-5 space-y-4">
                                  {/* 4 HABITS GRID IN SIMPLE HINDI */}
                                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                                    {/* Bathing */}
                                    <div
                                      className={`p-3 rounded-xl border flex items-center gap-2.5 ${
                                        rec.Is_Bathed
                                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                                          : 'bg-rose-50/70 border-rose-200 text-rose-950'
                                      }`}
                                    >
                                      <div
                                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 ${
                                          rec.Is_Bathed ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                                        }`}
                                      >
                                        <i className="fa-solid fa-shower"></i>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-slate-500">दैनिक स्नान</div>
                                        <div className="text-xs font-bold mt-0.5">
                                          {rec.Is_Bathed ? '✅ नहा कर आए' : '❌ स्नान नहीं किया'}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Nails */}
                                    <div
                                      className={`p-3 rounded-xl border flex items-center gap-2.5 ${
                                        rec.Nails_Clean
                                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                                          : 'bg-rose-50/70 border-rose-200 text-rose-950'
                                      }`}
                                    >
                                      <div
                                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 ${
                                          rec.Nails_Clean ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                                        }`}
                                      >
                                        <i className="fa-solid fa-hand-sparkles"></i>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-slate-500">नाखून की सफ़ाई</div>
                                        <div className="text-xs font-bold mt-0.5">
                                          {rec.Nails_Clean ? '✅ साफ़ व कटे हुए' : '❌ गंदे या बड़े नाखून'}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Uniform */}
                                    <div
                                      className={`p-3 rounded-xl border flex items-center gap-2.5 ${
                                        rec.Uniform_clean
                                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                                          : 'bg-rose-50/70 border-rose-200 text-rose-950'
                                      }`}
                                    >
                                      <div
                                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 ${
                                          rec.Uniform_clean ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                                        }`}
                                      >
                                        <i className="fa-solid fa-shirt"></i>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-slate-500">स्कूल की वर्दी (Uniform)</div>
                                        <div className="text-xs font-bold mt-0.5">
                                          {rec.Uniform_clean ? '✅ साफ़-सुथरी वर्दी' : '❌ वर्दी साफ़ नहीं थी'}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Discipline */}
                                    <div
                                      className={`p-3 rounded-xl border flex items-center gap-2.5 ${
                                        rec.Discipline
                                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                                          : 'bg-rose-50/70 border-rose-200 text-rose-950'
                                      }`}
                                    >
                                      <div
                                        className={`w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 ${
                                          rec.Discipline ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                                        }`}
                                      >
                                        <i className="fa-solid fa-shield-heart"></i>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-semibold text-slate-500">कक्षा में आचरण</div>
                                        <div className="text-xs font-bold mt-0.5">
                                          {rec.Discipline ? '✅ शांत व अनुशासित' : '⚠️ सुधार की ज़रूरत'}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Teacher Remark in Natural Hindi */}
                                  <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200 text-xs space-y-1.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-bold text-amber-950 flex items-center gap-1.5">
                                        <i className="fa-solid fa-chalkboard-user text-amber-700"></i>
                                        <span>शिक्षक की टिप्पणी:</span>
                                        <span
                                          className={`px-2 py-0.5 rounded-full font-black text-[10px] border ${
                                            isFault
                                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          }`}
                                        >
                                          {isFault
                                            ? (rec.Remark && rec.Remark.toLowerCase() !== 'fault' ? rec.Remark : 'सुधार अपेक्षित')
                                            : (rec.Remark || 'उत्कृष्ट')}
                                        </span>
                                      </span>
                                      <span className="text-[10px] text-amber-800 font-medium">
                                        व्यवहार शिष्टाचार: <strong>{rec.Good_Manners === 'Good' ? 'अच्छा (Good)' : (rec.Good_Manners || 'अच्छा')}</strong>
                                      </span>
                                    </div>

                                    <p className="text-xs text-slate-700 leading-relaxed italic pl-1 font-medium">
                                      &ldquo;{getBehaviorFeedback(rec)}&rdquo;
                                    </p>
                                  </div>

                                  {/* Evaluation Footer Note (WhatsApp button removed per request) */}
                                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                    <span className="text-[11px] text-slate-400">
                                      ई.वी.एस. पब्लिक स्कूल • दैनिक मूल्यांकन
                                    </span>
                                    <span className="text-[11px] text-slate-400 font-medium">
                                      दिनांक: {rec.Date}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {/* VIEW MODE 2: EXACT SPREADSHEET TABLE VIEW */}
                    {behaviorViewMode === 'table' && (
                      <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-xs">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#0c2340] text-amber-300 font-bold uppercase tracking-wider text-[10px]">
                            <tr>
                              <th className="px-3 py-3">Behavior ID</th>
                              <th className="px-3 py-3">Student ID</th>
                              <th className="px-3 py-3">Date</th>
                              <th className="px-3 py-3">Class</th>
                              <th className="px-3 py-3 text-center">Is_Bathed</th>
                              <th className="px-3 py-3 text-center">Nails_Clean</th>
                              <th className="px-3 py-3 text-center">Uniform_clean</th>
                              <th className="px-3 py-3">Good_Manners</th>
                              <th className="px-3 py-3 text-center">Discipline</th>
                              <th className="px-3 py-3 text-center">Is_Present</th>
                              <th className="px-3 py-3">Remark</th>
                              <th className="px-3 py-3 text-center">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 bg-white">
                            {filteredBehaviorRecords.map((rec, index) => {
                              return (
                                <tr
                                  key={rec.Behavior_ID ? `${rec.Behavior_ID}-${index}` : index}
                                  className="hover:bg-slate-50 transition-colors"
                                >
                                  <td className="px-3 py-3 font-mono font-bold text-slate-700">
                                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                                      #{rec.Behavior_ID || '—'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 font-mono">
                                    <span
                                      className={`px-1.5 py-0.5 rounded ${
                                        rec.Student_ID.toLowerCase() ===
                                        (selectedStudent.Student_ID || '').toLowerCase()
                                          ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300'
                                          : 'text-slate-600'
                                      }`}
                                    >
                                      {rec.Student_ID}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-slate-800 font-semibold whitespace-nowrap">
                                    {rec.Date || '—'}
                                  </td>
                                  <td className="px-3 py-3">
                                    <span className="font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 text-[11px]">
                                      {getClassName(rec.Class)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                                        rec.Is_Bathed
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      {rec.Is_Bathed ? 'TRUE' : 'FALSE'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                                        rec.Nails_Clean
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      {rec.Nails_Clean ? 'TRUE' : 'FALSE'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                                        rec.Uniform_clean
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      {rec.Uniform_clean ? 'TRUE' : 'FALSE'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-slate-800 font-medium">
                                    {rec.Good_Manners || 'Good'}
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                                        rec.Discipline
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      {rec.Discipline ? 'TRUE' : 'FALSE'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase border ${
                                        rec.Is_Present
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      {rec.Is_Present ? 'TRUE' : 'FALSE'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 font-semibold">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[11px] ${
                                        (rec.Remark || '').toLowerCase().includes('fault')
                                          ? 'bg-rose-100 text-rose-800 font-bold'
                                          : 'text-slate-800'
                                      }`}
                                    >
                                      {rec.Remark || 'OK'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3 text-center whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => shareBehaviorReport(rec)}
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 mx-auto"
                                    >
                                      <i className="fa-brands fa-whatsapp"></i>
                                      <span>Share</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Return to Cards Button */}
                    <div className="pt-4 border-t border-slate-200 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setParentActiveSection('overview');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-5 py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                      >
                        <i className="fa-solid fa-arrow-left"></i>
                        <span>← वापस मुख्य 4 कार्ड्स पर जाएं (Back to Cards)</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* VIEW 4: FEES & RECEIPTS (Strictly Logged-in Child's Fee Data) */}
                {parentActiveSection === 'fees' && selectedStudent && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 space-y-6 animate-fadeIn">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-lg font-bold text-[#0c2340] flex items-center gap-2">
                            <i className="fa-solid fa-receipt text-amber-500"></i>
                            स्कूल फीस व रसीदें (School Fees & Receipts)
                          </h4>
                          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200">
                            {selectedStudent.Student_Name} ({selectedStudent.Student_ID})
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          छात्र की मासिक फीस, जमा की गई राशि और आधिकारिक भुगतान रसीदें (Strictly Scoped Fee Records)
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fetchFeeCollection()}
                          disabled={loadingFees}
                          className="px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <i className={`fa-solid fa-rotate-right ${loadingFees ? 'fa-spin text-blue-900' : ''}`}></i>
                          <span>रिफ्रेश (Refresh)</span>
                        </button>
                      </div>
                    </div>

                    {/* Fee Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* Total Fee */}
                      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                        <div className="flex items-center justify-between text-xs text-slate-500 font-semibold mb-1">
                          <span>कुल शैक्षणिक फीस (Total Fee)</span>
                          <i className="fa-solid fa-scale-balanced text-slate-400"></i>
                        </div>
                        <div className="text-2xl font-black text-slate-900">
                          ₹{studentFeeSummary.totalFee.toLocaleString('en-IN')}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          कक्षा {getClassName(selectedStudent.Class)} वार्षिक फीस विवरण
                        </div>
                      </div>

                      {/* Total Paid */}
                      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
                        <div className="flex items-center justify-between text-xs text-emerald-800 font-semibold mb-1">
                          <span>अब तक जमा फीस (Total Paid)</span>
                          <i className="fa-solid fa-circle-check text-emerald-600"></i>
                        </div>
                        <div className="text-2xl font-black text-emerald-950">
                          ₹{studentFeeSummary.totalPaid.toLocaleString('en-IN')}
                        </div>
                        <div className="text-[11px] text-emerald-700 mt-1 flex items-center gap-1">
                          <span>कुल {studentFeeSummary.receiptsCount} रसीदें जारी</span>
                        </div>
                      </div>

                      {/* Balance Due */}
                      <div className={`rounded-2xl p-4 border ${
                        studentFeeSummary.hasDues
                          ? 'bg-rose-50 border-rose-300'
                          : 'bg-emerald-50 border-emerald-300'
                      }`}>
                        <div className="flex items-center justify-between text-xs font-semibold mb-1">
                          <span className={studentFeeSummary.hasDues ? 'text-rose-800' : 'text-emerald-800'}>
                            बकाया फीस (Pending Due Balance)
                          </span>
                          <span className={`text-[10px] px-2 py-0.2 rounded font-extrabold uppercase ${
                            studentFeeSummary.hasDues
                              ? 'bg-rose-200 text-rose-900 border border-rose-300'
                              : 'bg-emerald-200 text-emerald-900 border border-emerald-300'
                          }`}>
                            {studentFeeSummary.hasDues ? 'बकाया है' : 'पूरी जमा'}
                          </span>
                        </div>
                        <div className={`text-2xl font-black ${
                          studentFeeSummary.hasDues ? 'text-rose-950' : 'text-emerald-950'
                        }`}>
                          ₹{studentFeeSummary.balance.toLocaleString('en-IN')}
                        </div>
                        <div className={`text-[11px] mt-1 ${
                          studentFeeSummary.hasDues ? 'text-rose-700' : 'text-emerald-700'
                        }`}>
                          {studentFeeSummary.hasDues
                            ? 'कृपया अंतिम तिथि से पूर्व स्कूल कार्यालय में जमा कराएं'
                            : 'धन्यवाद! सभी वर्तमान देय राशि जमा है'}
                        </div>
                      </div>
                    </div>

                    {/* Receipts List Table */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                          <i className="fa-solid fa-file-invoice-dollar text-blue-900"></i>
                          <span>जारी की गई फीस रसीदें (Issued Fee Receipts History)</span>
                        </h5>
                        <span className="text-xs text-slate-500 font-medium">
                          केवल {selectedStudent.Student_Name} का रिकॉर्ड
                        </span>
                      </div>

                      {loadingFees ? (
                        <div className="text-center py-10 text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
                          <i className="fa-solid fa-spinner fa-spin text-xl text-blue-900 mb-2"></i>
                          <p className="text-xs font-semibold">लोड हो रहा है (Loading fee receipts)...</p>
                        </div>
                      ) : selectedStudentFeeRecords.length === 0 ? (
                        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-6">
                          <div className="w-12 h-12 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xl mx-auto mb-2">
                            <i className="fa-solid fa-receipt"></i>
                          </div>
                          <h5 className="font-bold text-slate-700 text-sm">कोई रसीद दर्ज नहीं है</h5>
                          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                            इस छात्र ({selectedStudent.Student_Name} - ID: {selectedStudent.Student_ID}) के लिए अभी तक कोई ऑनलाइन फीस रसीद दर्ज नहीं हुई है। यदि आपने हाल ही में फीस जमा की है, तो कृपया स्कूल काउंटर पर संपर्क करें।
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-[#0c2340] text-white">
                                <th className="px-3.5 py-3 font-semibold">रसीद सं. (Receipt #)</th>
                                <th className="px-3.5 py-3 font-semibold">दिनांक (Date)</th>
                                <th className="px-3.5 py-3 font-semibold">महीना/विवरण (Head)</th>
                                <th className="px-3.5 py-3 font-semibold">माध्यम (Mode)</th>
                                <th className="px-3.5 py-3 font-semibold text-right">जमा राशि (Amount)</th>
                                <th className="px-3.5 py-3 font-semibold">प्राप्तकर्ता (Collector)</th>
                                <th className="px-3.5 py-3 font-semibold text-center">कार्रवाई (Action)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                              {selectedStudentFeeRecords.map((fee, idx) => {
                                const receiptId = fee.Receipt_Number || `REC-${idx + 1}`;
                                const dateStr = formatDate(fee.Date);
                                const amt = Number(fee.Amount_Paid || 0);
                                const mode = fee.Payment_Mode || 'Cash';
                                const collector = fee.Received_By || 'School Office';
                                const monthHead = fee.Month || fee.Fee_Type || 'School Tuition Fee';

                                return (
                                  <tr key={receiptId + idx} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-3.5 py-3 font-mono font-bold text-blue-900 whitespace-nowrap">
                                      #{receiptId}
                                    </td>
                                    <td className="px-3.5 py-3 text-slate-700 whitespace-nowrap">
                                      {dateStr}
                                    </td>
                                    <td className="px-3.5 py-3 font-medium text-slate-900">
                                      {monthHead}
                                    </td>
                                    <td className="px-3.5 py-3 whitespace-nowrap">
                                      <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold">
                                        {mode}
                                      </span>
                                    </td>
                                    <td className="px-3.5 py-3 font-black text-emerald-800 text-right whitespace-nowrap text-sm">
                                      ₹{amt.toLocaleString('en-IN')}
                                    </td>
                                    <td className="px-3.5 py-3 text-slate-600 whitespace-nowrap">
                                      {collector}
                                    </td>
                                    <td className="px-3.5 py-3 text-center whitespace-nowrap">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const text = `*E.V.S. Public School - Fee Receipt*\nStudent: ${selectedStudent.Student_Name} (Class ${getClassName(selectedStudent.Class)})\nReceipt No: #${receiptId}\nDate: ${dateStr}\nAmount Paid: ₹${amt}\nMode: ${mode}\nReceived By: ${collector}`;
                                          window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
                                        }}
                                        className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-800 border border-emerald-200 rounded text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                                      >
                                        <i className="fa-brands fa-whatsapp text-emerald-600"></i>
                                        <span>रसीद शेयर</span>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Return to Cards Button */}
                      <div className="pt-4 border-t border-slate-200 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setParentActiveSection('overview');
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-5 py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                        >
                          <i className="fa-solid fa-arrow-left"></i>
                          <span>← वापस मुख्य 4 कार्ड्स पर जाएं (Back to Cards)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* VIEW 5: STUDENT PROFILE & ID CARD */}
                {parentActiveSection === 'profile' && selectedStudent && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 sm:p-6 space-y-6 animate-fadeIn">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                      <div>
                        <h4 className="text-lg font-bold text-[#0c2340] flex items-center gap-2">
                          <i className="fa-solid fa-id-card text-blue-900"></i>
                          छात्र प्रोफ़ाइल एवं डिजिटल आई-कार्ड (Student Profile & Digital ID Pass)
                        </h4>
                        <p className="text-xs text-slate-500 mt-1">
                          प्रवेश विवरण, अभिभावक का नाम, पता, रोल नंबर और आधिकारिक क्यूआर कोड
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-2 space-y-4">
                        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200">
                          <h5 className="font-extrabold text-sm text-slate-900 mb-3 border-b border-slate-200/80 pb-2">
                            व्यक्तिगत एवं पारिवारिक विवरण (Personal & Family Details)
                          </h5>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                            <div>
                              <span className="text-slate-400 block text-[11px]">छात्र का नाम (Student Name)</span>
                              <span className="font-bold text-slate-900 text-sm">{selectedStudent.Student_Name}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">कक्षा (Class)</span>
                              <span className="font-bold text-blue-900">Class {getClassName(selectedStudent.Class)}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">रोल नंबर (Roll No)</span>
                              <span className="font-bold text-slate-900">{selectedStudent.Roll_Number || '1'}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">छात्र आईडी (Student ID)</span>
                              <span className="font-mono font-bold text-slate-800">{selectedStudent.Student_ID}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">प्रवेश संख्या (Admission No)</span>
                              <span className="font-bold text-slate-900">{selectedStudent.Admission_Number}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">पिता का नाम (Father's Name)</span>
                              <span className="font-semibold text-slate-800">{selectedStudent.Father_Name || '—'}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">माता का नाम (Mother's Name)</span>
                              <span className="font-semibold text-slate-800">{selectedStudent.Mother_Name || '—'}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">गाँव / रूट (Village / Route)</span>
                              <span className="font-semibold text-slate-800">{selectedStudent['Village/rRoute'] || selectedStudent.Village || '—'}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">मोबाइल नंबर (Mobile)</span>
                              <span className="font-semibold text-slate-800">{selectedStudent.Mobile || selectedStudent.Parent_Mobile || '—'}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-1">
                        <StudentQRCodeCard
                          student={selectedStudent}
                          classNameTitle={getClassName(selectedStudent.Class)}
                          variant="profile"
                          photoUrl={getStudentPhoto(selectedStudent)}
                          onEnlarge={() => setPreviewQRStudent(selectedStudent)}
                        />
                      </div>
                    </div>

                    {/* Return to Cards Button */}
                    <div className="pt-4 border-t border-slate-200 flex justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          setParentActiveSection('overview');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-5 py-2.5 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-bold rounded-xl text-xs sm:text-sm flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                      >
                        <i className="fa-solid fa-arrow-left"></i>
                        <span>← वापस मुख्य 4 कार्ड्स पर जाएं (Back to Cards)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. TEACHER DASHBOARD                                                      */}
        {/* ========================================================================= */}
        {/* ========================================================================= */}
        {/* 3. TEACHER DASHBOARD & LOGIN                                              */}
        {/* ========================================================================= */}
        {activeTab === 'teacher' && !teacherUser && (
          <div className="max-w-md mx-auto my-8 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
              {/* Top Banner */}
              <div className="bg-gradient-to-br from-[#0c2340] via-[#10316b] to-[#0c2340] p-6 text-white text-center relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-amber-500/30 border-2 border-amber-200 text-2xl font-black">
                  <i className="fa-solid fa-chalkboard-user"></i>
                </div>
                <span className="inline-block px-3 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[11px] font-bold tracking-wide border border-amber-400/40 uppercase mb-1">
                  स्कूल अध्यापक सुरक्षा (Teacher Portal)
                </span>
                <h3 className="text-xl font-extrabold tracking-tight">स्कूल अध्यापक लॉगिन</h3>
                <p className="text-xs text-slate-300 mt-1">
                  होमवर्क अपलोड, असाइनमेंट प्रबंधन व छात्र ट्रैकर हेतु लॉगिन करें
                </p>
              </div>

              {/* Login Form */}
              <form onSubmit={handleTeacherLogin} className="p-6 space-y-4">
                {teacherLoginError && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
                    <i className="fa-solid fa-triangle-exclamation text-rose-600 text-sm mt-0.5 shrink-0"></i>
                    <div className="flex-1">
                      <div className="font-bold">लॉगिन त्रुटि (Login Failed)</div>
                      <div className="mt-0.5">{teacherLoginError}</div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    यूजरनेम, मोबाइल नंबर या यूजर आईडी
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm pointer-events-none">
                      <i className="fa-solid fa-chalkboard-user"></i>
                    </span>
                    <input
                      type="text"
                      value={teacherLoginInput}
                      onChange={(e) => {
                        setTeacherLoginInput(e.target.value);
                        if (teacherLoginError) setTeacherLoginError(null);
                      }}
                      placeholder="उदा. salik या अध्यापक का मोबाइल / यूजरनेम"
                      required
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    पासवर्ड (Password)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm pointer-events-none">
                      <i className="fa-solid fa-lock"></i>
                    </span>
                    <input
                      type={showTeacherPassword ? 'text' : 'password'}
                      value={teacherPasswordInput}
                      onChange={(e) => {
                        setTeacherPasswordInput(e.target.value);
                        if (teacherLoginError) setTeacherLoginError(null);
                      }}
                      placeholder="अपना गुप्त पासवर्ड दर्ज करें"
                      required
                      className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTeacherPassword(!showTeacherPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      <i className={`fa-solid ${showTeacherPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={teacherLoginSubmitting || loadingUsers}
                  className="w-full py-3 bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] hover:brightness-110 text-amber-300 font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {teacherLoginSubmitting || loadingUsers ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>सत्यापन हो रहा है... (Verifying...)</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-right-to-bracket"></i>
                      <span>टीचर लॉगिन करें (Login to Teacher Portal)</span>
                    </>
                  )}
                </button>

                <div className="pt-2 space-y-2 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      const teacher = usersList.find(
                        (u) => (u.Designation || '').toLowerCase().includes('teacher')
                      ) || {
                        User_ID: 'T1',
                        Mobile_number: '9876543210',
                        Username: 'teacher',
                        Name: 'Mh salik',
                        Designation: 'Teacher',
                        Assigned_Class: 'C12',
                      };
                      setTeacherUser(teacher);
                      try {
                        localStorage.setItem('evs_teacher_user', JSON.stringify(teacher));
                      } catch {}
                    }}
                    className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs rounded-xl border border-amber-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <i className="fa-solid fa-bolt text-amber-600"></i>
                    <span>⚡ डेमो टीचर के रूप में त्वरित लॉगिन (One-Click Demo Teacher Login)</span>
                  </button>
                  <p className="text-[11px] text-slate-400">
                    <i className="fa-solid fa-shield-halved text-amber-500 mr-1"></i>
                    यह पोर्टल केवल स्कूल के अध्यापकों एवं स्टाफ सदस्यों के लिए सुरक्षित है।
                  </p>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'teacher' && teacherUser && (
          <div className="space-y-6 animate-fadeIn">
            {/* Teacher Logged-In Top Bar */}
            <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white rounded-2xl p-4 sm:p-5 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 font-black text-xl flex items-center justify-center shadow-md shrink-0">
                  {teacherUser.Name ? teacherUser.Name.charAt(0).toUpperCase() : 'T'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base sm:text-lg text-white">
                      {teacherUser.Name}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-400/30">
                      {teacherUser.Designation || 'अध्यापक / Teacher'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    यूजर आईडी: <span className="font-mono text-amber-300">{teacherUser.User_ID || teacherUser.Username}</span>
                    {teacherUser.Assigned_Class && (
                      <span className="ml-2 bg-blue-900/60 px-2 py-0.5 rounded text-[11px] border border-blue-400/30">
                        कक्षा: Class {getClassName(teacherUser.Assigned_Class)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  onClick={fetchHomeworkTracker}
                  disabled={loadingHwTracker}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Refresh Homework Tracker"
                >
                  <i className={`fa-solid fa-rotate-right ${loadingHwTracker ? 'fa-spin text-amber-300' : ''}`}></i>
                  <span className="hidden sm:inline">Refresh Data</span>
                </button>
                <button
                  onClick={handleTeacherLogout}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-500/80 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  title="Logout Teacher"
                >
                  <i className="fa-solid fa-right-from-bracket"></i>
                  <span>लॉगआउट (Logout)</span>
                </button>
              </div>
            </div>

            {/* Teacher Sub-Navigation Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
              <button
                onClick={() => setTeacherPortalTab('upload')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  teacherPortalTab === 'upload'
                    ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <i className="fa-solid fa-cloud-arrow-up text-amber-400"></i>
                <span>होमवर्क अपलोड (Upload Homework)</span>
              </button>

              <button
                onClick={() => setTeacherPortalTab('tracker')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  teacherPortalTab === 'tracker'
                    ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <i className="fa-solid fa-list-check text-emerald-400"></i>
                <span>छात्र होमवर्क ट्रैकर (Homework Tracker)</span>
                <span className="px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-700 text-[11px]">
                  {hwTrackerList.length}
                </span>
              </button>

              <button
                onClick={() => setTeacherPortalTab('submissions')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  teacherPortalTab === 'submissions'
                    ? 'bg-[#0c2340] text-amber-300 shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <i className="fa-solid fa-clock-rotate-left text-blue-400"></i>
                <span>हाल के असाइनमेंट्स (Recent Submissions)</span>
                <span className="px-2 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[11px]">
                  {homeworkList.length}
                </span>
              </button>

              {/* Universal Student Finder & QR Scanner button */}
              <button
                type="button"
                onClick={() => {
                  setQrScannerTarget(null);
                  setQrScannerSubtitle('शिक्षक: छात्र खोजें (QR स्कैन, नाम, ID या मोबाइल द्वारा)');
                  setQrScannerOpen(true);
                }}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 shadow-sm ml-auto"
              >
                <i className="fa-solid fa-magnifying-glass"></i>
                <i className="fa-solid fa-qrcode"></i>
                <span>छात्र खोजें / QR स्कैनर</span>
              </button>
            </div>

            {/* TAB 1: UPLOAD HOMEWORK */}
            {teacherPortalTab === 'upload' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
                {/* Main Form */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                    {/* Alert messages */}
                    {hwSuccessMessage && (
                      <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-start gap-3">
                        <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                          <i className="fa-solid fa-check"></i>
                        </div>
                        <div className="flex-1">
                          <h5 className="font-bold text-sm text-emerald-950">Success!</h5>
                          <p className="mt-0.5 text-emerald-800">{hwSuccessMessage}</p>
                        </div>
                        <button
                          onClick={() => setHwSuccessMessage(null)}
                          className="text-emerald-700 hover:text-emerald-900 cursor-pointer font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {hwErrorMessage && (
                      <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900 text-xs flex items-start gap-3">
                        <i className="fa-solid fa-triangle-exclamation text-rose-600 text-lg mt-0.5"></i>
                        <div className="flex-1">
                          <h5 className="font-bold text-sm text-rose-950">Upload Note</h5>
                          <p className="mt-0.5 text-rose-800">{hwErrorMessage}</p>
                        </div>
                        <button
                          onClick={() => setHwErrorMessage(null)}
                          className="text-rose-700 hover:text-rose-900 cursor-pointer font-bold"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    <form onSubmit={handleTeacherSubmit} className="space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Date */}
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            Assignment Date <span className="text-rose-500">*</span>
                          </label>
                          <div className="relative">
                            <input
                              type="date"
                              value={hwDate}
                              onChange={(e) => setHwDate(e.target.value)}
                              required
                              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                            />
                          </div>
                        </div>

                        {/* Class Selection */}
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5">
                            Select Class <span className="text-rose-500">*</span>
                          </label>
                          <select
                            value={hwClass}
                            onChange={(e) => setHwClass(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all bg-white"
                          >
                            {classOptions.map((c) => (
                              <option key={c} value={c}>
                                Class {getClassName(c)} {c !== getClassName(c) ? `(${c})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Quick Class Selector Chips */}
                      <div>
                        <span className="text-[11px] font-semibold text-slate-500 mb-1.5 block">
                          Quick Class Chips (Class Name):
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'].map(
                            (chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => setHwClass(chip)}
                                className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition-colors cursor-pointer ${
                                  hwClass === chip
                                    ? 'bg-[#0c2340] text-amber-300 border-[#0c2340] shadow-xs'
                                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                                }`}
                                title={`Class ${getClassName(chip)} (ID: ${chip})`}
                              >
                                {getClassName(chip)}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {/* Subject */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          Subject <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={hwSubject}
                          onChange={(e) => setHwSubject(e.target.value)}
                          placeholder="e.g. Mathematics, Science, English, Hindi"
                          required
                          className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                        />
                        {/* Popular subject pills */}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {[
                            'Mathematics',
                            'Science',
                            'English',
                            'Hindi',
                            'Social Studies',
                            'Computer',
                            'Environmental Studies (EVS)',
                            'Art & Craft',
                          ].map((sub) => (
                            <button
                              key={sub}
                              type="button"
                              onClick={() => setHwSubject(sub)}
                              className="text-[11px] px-2 py-0.5 rounded bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-amber-900 border border-slate-200 transition-colors cursor-pointer"
                            >
                              {sub}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Teacher / Staff Selection (from Users sheet) */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="block text-xs font-bold text-slate-700">
                            अध्यापक का नाम (Assigning Teacher / Faculty) <span className="text-rose-500">*</span>
                          </label>
                          <span className="text-[11px] text-slate-400">Users शीट से चयनित</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select
                            value={activeTeacherName}
                            onChange={(e) => setActiveTeacherName(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm bg-white"
                          >
                            <option value={teacherUser.Name}>{teacherUser.Name} (Current)</option>
                            {usersList
                              .filter((u) => u.Name && u.Name !== teacherUser.Name)
                              .map((u) => (
                                <option key={u.User_ID || u.Name} value={u.Name}>
                                  {u.Name} ({u.Designation || 'Staff'})
                                </option>
                              ))}
                          </select>
                          <input
                            type="text"
                            value={activeTeacherName}
                            onChange={(e) => setActiveTeacherName(e.target.value)}
                            placeholder="या अन्य अध्यापक का नाम लिखें..."
                            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none"
                          />
                        </div>
                      </div>

                      {/* Homework Details */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="block text-xs font-bold text-slate-700">
                            Homework Details / Questions <span className="text-rose-500">*</span>
                          </label>
                          <span className="text-[11px] text-slate-400">
                            {hwDetail.length} characters
                          </span>
                        </div>
                        <textarea
                          rows={5}
                          value={hwDetail}
                          onChange={(e) => setHwDetail(e.target.value)}
                          placeholder="Write clear instructions, page numbers, exercise problems, or reading requirements..."
                          required
                          className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                        />
                      </div>

                      {/* Submit Button */}
                      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          <i className="fa-solid fa-cloud-arrow-up text-blue-900"></i>
                          Will submit to Google Apps Script Web App API
                        </div>
                        <button
                          type="submit"
                          disabled={hwSubmitting}
                          className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-[#0c2340] to-[#10316b] hover:from-[#10316b] hover:to-[#0c2340] text-amber-300 hover:text-amber-200 font-bold text-xs sm:text-sm rounded-lg shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {hwSubmitting ? (
                            <>
                              <i className="fa-solid fa-spinner fa-spin"></i>
                              <span>Publishing Homework...</span>
                            </>
                          ) : (
                            <>
                              <i className="fa-solid fa-paper-plane"></i>
                              <span>Publish Homework</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>

                {/* Sidebar: Recent Submissions & Instructions */}
                <div className="space-y-5">
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-5">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs mb-2">
                      <i className="fa-solid fa-circle-info text-amber-600"></i>
                      Teacher Submission Guidelines
                    </div>
                    <ul className="text-xs text-amber-950/80 space-y-2 list-disc list-inside">
                      <li>Assignments posted are immediately visible in the Parent Portal.</li>
                      <li>Specify exact exercise numbers or page references.</li>
                      <li>Targeted classes will receive homework tagged for their curriculum.</li>
                    </ul>
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                        Recent Submissions ({homeworkList.slice(0, 5).length})
                      </h4>
                      <span className="text-[10px] text-slate-400">Live feed</span>
                    </div>

                    <div className="space-y-3">
                      {homeworkList.slice(0, 5).map((hw, idx) => (
                        <div
                          key={hw.Homework_ID || idx}
                          className="p-3 bg-slate-50 rounded-lg border border-slate-200/60 text-xs"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-blue-950">
                              {hw.Subject} • Class {getClassName(hw.Class)}
                            </span>
                            <span className="text-[10px] text-slate-400">{formatDate(hw.Date)}</span>
                          </div>
                          <p className="text-slate-600 line-clamp-2 text-[11px]">
                            {hw.Homework_Detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: HOMEWORK TRACKER (छात्र होमवर्क ट्रैकर) */}
            {teacherPortalTab === 'tracker' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-5 animate-fadeIn">
                {/* Header & Metrics */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <i className="fa-solid fa-list-check text-emerald-600"></i>
                      <span>छात्र होमवर्क ट्रैकर (Student Homework Progress Tracker)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Homework_Tracker शीट से लाइव प्राप्त रिकॉर्ड्स — छात्र का क्यूआर कोड स्कैन करके या नाम से खोजें
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setQrScannerTarget('teacherTracker');
                        setQrScannerSubtitle('टीचर पोर्टल: छात्र का क्यूआर कोड स्कैन करें');
                        setQrScannerOpen(true);
                      }}
                      className="px-3.5 py-2 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 shadow-sm cursor-pointer transition-all active:scale-95"
                    >
                      <i className="fa-solid fa-qrcode text-sm"></i>
                      <span>Scan Student QR</span>
                    </button>
                    <button
                      onClick={fetchHomeworkTracker}
                      disabled={loadingHwTracker}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <i className={`fa-solid fa-rotate-right ${loadingHwTracker ? 'fa-spin' : ''}`}></i>
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                {/* PROMINENT QR SCANNER BANNER FOR YESTERDAY'S HOMEWORK TRACKING */}
                <div className="bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 p-4 rounded-2xl border-2 border-amber-500/50 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-slate-950 text-amber-300 flex items-center justify-center text-xl shadow-md shrink-0">
                      <i className="fa-solid fa-qrcode"></i>
                    </div>
                    <div>
                      <div className="font-black text-slate-950 text-sm sm:text-base flex items-center gap-2">
                        <span>बच्चे का QR स्कैन करके कल का होमवर्क चेक करें</span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-950 text-amber-300 text-[10px] uppercase font-bold tracking-wider">
                          QR Tracker
                        </span>
                      </div>
                      <p className="text-xs text-slate-900 mt-0.5">
                        कैमरा खोलकर छात्र का QR कोड स्कैन करें — कल दिए गए सभी विषयों का कार्य खुल जाएगा, एक टच में Complete / Incomplete मार्क करें!
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setQrScannerTarget('teacherTracker');
                      setQrScannerSubtitle('कल का होमवर्क चेक करने हेतु छात्र का QR कोड स्कैन करें');
                      setQrScannerOpen(true);
                    }}
                    className="px-4 py-2.5 bg-slate-950 hover:bg-slate-900 text-amber-300 font-black rounded-xl text-xs flex items-center gap-2 shadow-md cursor-pointer shrink-0 transition-all active:scale-95"
                  >
                    <i className="fa-solid fa-camera text-sm"></i>
                    <span>📷 QR स्कैन शुरू करें</span>
                  </button>
                </div>

                {/* Tracker Stats Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="text-[11px] text-slate-500 font-medium">कुल रिकॉर्ड्स (Total Records)</div>
                    <div className="text-lg font-bold text-slate-800 mt-0.5">{teacherFilteredTracker.length}</div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="text-[11px] text-emerald-700 font-medium">होमवर्क पूर्ण (Completed)</div>
                    <div className="text-lg font-bold text-emerald-900 mt-0.5">
                      {
                        teacherFilteredTracker.filter(
                          (t) => (t.Last_homework_Status || '').toLowerCase().includes('complete') && !(t.Last_homework_Status || '').toLowerCase().includes('incom')
                        ).length
                      }
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200">
                    <div className="text-[11px] text-rose-700 font-medium">अपूर्ण होमवर्क (Incompleted)</div>
                    <div className="text-lg font-bold text-rose-900 mt-0.5">
                      {
                        teacherFilteredTracker.filter(
                          (t) => (t.Last_homework_Status || '').toLowerCase().includes('incom') || (t.Last_homework_Status || '').toLowerCase().includes('pend')
                        ).length
                      }
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200">
                    <div className="text-[11px] text-blue-700 font-medium">सफलता दर (Completion Rate)</div>
                    <div className="text-lg font-bold text-blue-900 mt-0.5">
                      {teacherFilteredTracker.length > 0
                        ? Math.round(
                            (teacherFilteredTracker.filter(
                              (t) => (t.Last_homework_Status || '').toLowerCase().includes('complete') && !(t.Last_homework_Status || '').toLowerCase().includes('incom')
                            ).length /
                              teacherFilteredTracker.length) *
                              100
                          )
                        : 0}
                      %
                    </div>
                  </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                  <div className="flex-1 flex items-center gap-2 max-w-md">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                        <i className="fa-solid fa-magnifying-glass"></i>
                      </span>
                      <input
                        type="text"
                        value={teacherTrackerSearch}
                        onChange={(e) => setTeacherTrackerSearch(e.target.value)}
                        placeholder="Search student ID, name, or subject..."
                        className="w-full pl-8 pr-8 py-2 rounded-xl border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none"
                      />
                      {teacherTrackerSearch && (
                        <button
                          onClick={() => setTeacherTrackerSearch('')}
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setQrScannerTarget('teacherTracker');
                        setQrScannerSubtitle('टीचर: छात्र का क्यूआर कोड स्कैन करें');
                        setQrScannerOpen(true);
                      }}
                      className="px-3 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                      title="Scan QR to search student"
                    >
                      <i className="fa-solid fa-camera"></i>
                      <span className="hidden sm:inline">QR Scan</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Class Filter */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500">कक्षा:</span>
                      <select
                        value={teacherTrackerClassFilter}
                        onChange={(e) => setTeacherTrackerClassFilter(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white outline-none"
                      >
                        <option value="all">समस्त कक्षाएं (All Classes)</option>
                        {classOptions.map((c) => (
                          <option key={c} value={c}>
                            Class {getClassName(c)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                      <button
                        onClick={() => setTeacherTrackerStatusFilter('all')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          teacherTrackerStatusFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setTeacherTrackerStatusFilter('Completed')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          teacherTrackerStatusFilter === 'Completed'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-emerald-700 hover:bg-emerald-50'
                        }`}
                      >
                        Completed
                      </button>
                      <button
                        onClick={() => setTeacherTrackerStatusFilter('Incompleted')}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          teacherTrackerStatusFilter === 'Incompleted'
                            ? 'bg-rose-600 text-white shadow-xs'
                            : 'text-rose-700 hover:bg-rose-50'
                        }`}
                      >
                        Incompleted
                      </button>
                    </div>
                  </div>
                </div>

                {/* Table of Tracker Records */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-3 py-3">Student Name & ID</th>
                        <th className="px-3 py-3">Class & Roll</th>
                        <th className="px-3 py-3">Subject</th>
                        <th className="px-3 py-3">Date</th>
                        <th className="px-3 py-3 text-center">Homework Status</th>
                        <th className="px-3 py-3 text-center">Toggle Action</th>
                        <th className="px-3 py-3 text-center">कल का कार्य (Check HW)</th>
                        <th className="px-3 py-3 text-center">Notify Parent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {teacherFilteredTracker.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                            <i className="fa-solid fa-clipboard-question text-2xl mb-2 block"></i>
                            कोई होमवर्क ट्रैकर रिकॉर्ड नहीं मिला। क्यूआर स्कैन करें या सर्च फ़िल्टर बदलें।
                          </td>
                        </tr>
                      ) : (
                        teacherFilteredTracker.map((rec, idx) => {
                          const matchedStudent = students.find(
                            (s) =>
                              String(s.Student_ID || '').toLowerCase() === String(rec.Student_ID || '').toLowerCase() ||
                              String(s.Student_ID || '').toLowerCase() === String(rec.ID || '').toLowerCase()
                          );
                          const isDone =
                            (rec.Last_homework_Status || '').toLowerCase().includes('complete') &&
                            !(rec.Last_homework_Status || '').toLowerCase().includes('incom');

                          return (
                            <tr key={rec.ID || idx} className="hover:bg-slate-50 transition-colors">
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-2.5">
                                  <StudentAvatar
                                    student={matchedStudent}
                                    photoUrl={matchedStudent ? getStudentPhoto(matchedStudent) : ''}
                                    size="sm"
                                  />
                                  <div>
                                    <div className="font-bold text-slate-900">
                                      {matchedStudent?.Student_Name || rec.Student_ID || 'Student'}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-mono">
                                      ID: {rec.Student_ID || rec.ID}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              <td className="px-3 py-3 whitespace-nowrap">
                                <span className="font-semibold text-blue-900">
                                  Class {getClassName(rec.Class || matchedStudent?.Class)}
                                </span>
                                {matchedStudent?.Roll_Number && (
                                  <span className="text-[11px] text-slate-400 block">
                                    Roll No: {matchedStudent.Roll_Number}
                                  </span>
                                )}
                              </td>

                              <td className="px-3 py-3 font-medium text-slate-800">
                                {rec.Subject || 'General'}
                              </td>

                              <td className="px-3 py-3 text-slate-500 whitespace-nowrap">
                                {formatDate(rec.Date)}
                              </td>

                              <td className="px-3 py-3 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                                    isDone
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                      : 'bg-rose-100 text-rose-800 border border-rose-300'
                                  }`}
                                >
                                  <i className={`fa-solid ${isDone ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                                  <span>{isDone ? 'Completed' : 'Incompleted'}</span>
                                </span>
                              </td>

                              <td className="px-3 py-3 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleToggleHomeworkStatus(rec.ID, rec.Last_homework_Status, rec.Student_ID)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                                    isDone
                                      ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  }`}
                                  title="क्लिक करके स्टेटस बदलें"
                                >
                                  {isDone ? 'Mark Incomplete' : 'Mark Completed ✓'}
                                </button>
                              </td>

                              <td className="px-3 py-3 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const targetStudent =
                                      matchedStudent ||
                                      students.find(
                                        (s) =>
                                          String(s.Student_ID || '').toLowerCase() ===
                                            String(rec.Student_ID || rec.ID || '').toLowerCase()
                                      );
                                    if (targetStudent) {
                                      setSelectedHwTrackerStudent(targetStudent);
                                      setHwTrackerModalOpen(true);
                                    }
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1 mx-auto cursor-pointer shadow-2xs transition-all active:scale-95"
                                  title="कल का होमवर्क ट्रैक करें"
                                >
                                  <i className="fa-solid fa-book-open text-xs"></i>
                                  <span>कल का HW</span>
                                </button>
                              </td>

                              <td className="px-3 py-3 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parentPhone = matchedStudent ? String(matchedStudent.Parent_Mobile || '').replace(/\D/g, '') : '';
                                    const studentName = matchedStudent?.Student_Name || rec.Student_ID;
                                    const statusText = isDone ? 'पूर्ण (Completed)' : 'अपूर्ण (Incomplete)';
                                    const msg = `*E.V.S. PUBLIC SCHOOL - होमवर्क सूचना*\n\nआदरणीय अभिभावक,\nसूचित किया जाता है कि आपके बच्चे *${studentName}* (कक्षा: ${getClassName(rec.Class || matchedStudent?.Class)}) का दिनांक *${rec.Date}* का *${rec.Subject}* का होमवर्क आज *${statusText}* पाया गया है।\n\n- E.V.S. Public School`;
                                    const cleanPhone = parentPhone.length === 10 ? `91${parentPhone}` : parentPhone;
                                    const url = cleanPhone
                                      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`
                                      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                                    window.open(url, '_blank');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold text-xs border border-emerald-200 flex items-center justify-center gap-1 mx-auto cursor-pointer"
                                  title="अभिभावक को व्हाट्सएप पर सूचना भेजें"
                                >
                                  <i className="fa-brands fa-whatsapp text-emerald-600 text-sm"></i>
                                  <span>WhatsApp</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: RECENT SUBMISSIONS FEED */}
            {teacherPortalTab === 'submissions' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4 animate-fadeIn">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <i className="fa-solid fa-clock-rotate-left text-blue-600"></i>
                      <span>अपलोड किया गया हाल का होमवर्क (Recent Homework Feed)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      अध्यापकों द्वारा पोस्ट किए गए हालिया होमवर्क असाइनमेंट्स की सूची
                    </p>
                  </div>
                  <button
                    onClick={fetchHomework}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fa-solid fa-rotate-right"></i>
                    <span>Refresh Feed</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {homeworkList.map((hw, idx) => (
                    <div
                      key={hw.Homework_ID || idx}
                      className="p-4 bg-slate-50 rounded-xl border border-slate-200/80 hover:border-blue-300 transition-all space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-blue-950 text-sm">
                          {hw.Subject} • Class {getClassName(hw.Class)}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium">{formatDate(hw.Date)}</span>
                      </div>
                      <p className="text-xs text-slate-700 whitespace-pre-wrap">{hw.Homework_Detail}</p>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-[11px] text-slate-500">
                        <span>अध्यापक: <strong className="text-slate-700">{hw.Teacher || 'Faculty'}</strong></span>
                        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold">
                          {hw.Target_Type || 'Poori Class'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. MANAGER DASHBOARD                                                      */}
        {/* ========================================================================= */}
        {activeTab === 'manager' && !managerUser && (
          <div className="max-w-md mx-auto my-8 animate-fadeIn">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
              {/* Top Banner */}
              <div className="bg-gradient-to-br from-[#0c2340] via-[#10316b] to-[#0c2340] p-6 text-white text-center relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-amber-500/30 border-2 border-amber-200 text-2xl font-black">
                  <i className="fa-solid fa-user-tie"></i>
                </div>
                <span className="inline-block px-3 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[11px] font-bold tracking-wide border border-amber-400/40 uppercase mb-1">
                  स्कूल प्रबंधक सुरक्षा (Manager Portal)
                </span>
                <h3 className="text-xl font-extrabold tracking-tight">स्कूल मैनेजर लॉगिन</h3>
                <p className="text-xs text-slate-300 mt-1">
                  प्रशासनिक रिकॉर्ड्स, फीस व स्टाफ विवरण देखने हेतु लॉगिन करें
                </p>
              </div>

              {/* Login Form */}
              <form onSubmit={handleManagerLogin} className="p-6 space-y-4">
                {managerLoginError && (
                  <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
                    <i className="fa-solid fa-triangle-exclamation text-rose-600 text-sm mt-0.5 shrink-0"></i>
                    <div className="flex-1">
                      <div className="font-bold">लॉगिन त्रुटि (Login Failed)</div>
                      <div className="mt-0.5">{managerLoginError}</div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    यूजरनेम, मोबाइल नंबर या यूजर आईडी
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm pointer-events-none">
                      <i className="fa-solid fa-user"></i>
                    </span>
                    <input
                      type="text"
                      value={managerLoginInput}
                      onChange={(e) => {
                        setManagerLoginInput(e.target.value);
                        if (managerLoginError) setManagerLoginError(null);
                      }}
                      placeholder="उदा. mahak या 10-अंकीय मोबाइल"
                      required
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    पासवर्ड (Password)
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-sm pointer-events-none">
                      <i className="fa-solid fa-lock"></i>
                    </span>
                    <input
                      type={showManagerPassword ? 'text' : 'password'}
                      value={managerPasswordInput}
                      onChange={(e) => {
                        setManagerPasswordInput(e.target.value);
                        if (managerLoginError) setManagerLoginError(null);
                      }}
                      placeholder="अपना गुप्त पासवर्ड दर्ज करें"
                      required
                      className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowManagerPassword(!showManagerPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                    >
                      <i className={`fa-solid ${showManagerPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={managerLoginSubmitting || loadingUsers}
                  className="w-full py-3 bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] hover:brightness-110 text-amber-300 font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {managerLoginSubmitting || loadingUsers ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin"></i>
                      <span>सत्यापित किया जा रहा है...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-arrow-right-to-bracket"></i>
                      <span>मैनेजर पोर्टल में लॉगिन करें</span>
                    </>
                  )}
                </button>

                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      const mgr = usersList.find(
                        (u) => (u.Designation || '').toLowerCase().includes('manager')
                      ) || {
                        User_ID: 'U1',
                        Mobile_number: '9876543210',
                        Username: 'mahak',
                        Name: 'Mahak (Manager)',
                        Designation: 'Manager',
                      };
                      setManagerUser(mgr);
                      try {
                        localStorage.setItem('evs_manager_user', JSON.stringify(mgr));
                      } catch {}
                    }}
                    className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-950 font-bold text-xs rounded-xl border border-amber-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <i className="fa-solid fa-bolt text-amber-600"></i>
                    <span>⚡ डेमो मैनेजर के रूप में त्वरित लॉगिन (One-Click Demo Manager Login)</span>
                  </button>
                </div>

                <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 flex items-start gap-2 mt-2">
                  <i className="fa-solid fa-shield-halved text-amber-600 text-xs mt-0.5 shrink-0"></i>
                  <div>
                    <span className="font-bold">सुरक्षा सूचना:</span> क्रेडेंशियल्स Google Sheet ('Users') के अनुसार मान्य हैं। केवल <strong>Manager</strong> पदनाम वाले उपयोगकर्ता ही इस पोर्टल में लॉगिन कर सकते हैं।
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'manager' && managerUser && (
          <div className="space-y-6 animate-fadeIn">
            {/* Header with Logged-in Manager Profile */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white p-5 rounded-2xl shadow-md border-b-2 border-amber-400">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-2xl font-black shadow-md border-2 border-amber-200 shrink-0">
                  <i className="fa-solid fa-user-tie"></i>
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 bg-amber-400 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                      ⭐ {managerUser.Designation || 'Manager'}
                    </span>
                    <span className="text-xs text-amber-300 font-mono bg-white/10 px-2 py-0.5 rounded">
                      ID: {managerUser.User_ID || 'MGR-01'}
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white mt-1">
                    {managerUser.Name || 'School Manager'}
                  </h2>
                  <p className="text-xs text-amber-100/80 flex items-center gap-3 flex-wrap mt-0.5">
                    {managerUser.Mobile_number ? (
                      <span>
                        <i className="fa-solid fa-phone text-amber-300 text-[10px] mr-1"></i>
                        {managerUser.Mobile_number}
                      </span>
                    ) : null}
                    {managerUser.Username ? (
                      <span>
                        <i className="fa-solid fa-envelope text-amber-300 text-[10px] mr-1"></i>
                        {managerUser.Username}
                      </span>
                    ) : null}
                    <span>
                      <i className="fa-solid fa-circle-check text-emerald-400 text-[10px] mr-1"></i>
                      Users Sheet Verified
                    </span>
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                <button
                  onClick={() => {
                    fetchStudents();
                    fetchHomework();
                    fetchUsers();
                    fetchFeeCollection();
                  }}
                  disabled={loadingStudents || loadingHomework || loadingUsers}
                  className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-amber-300 text-xs font-bold rounded-xl border border-white/20 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title="Refresh all Google Sheets data"
                >
                  <i
                    className={`fa-solid fa-arrows-rotate ${
                      loadingStudents || loadingHomework || loadingUsers ? 'fa-spin' : ''
                    }`}
                  ></i>
                  <span>Refresh Live Data</span>
                </button>

                <button
                  onClick={handleManagerLogout}
                  className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
                  title="Log out of Manager Portal"
                >
                  <i className="fa-solid fa-right-from-bracket"></i>
                  <span>लॉगआउट (Logout)</span>
                </button>
              </div>
            </div>

            {/* 4 Dynamic Summary Cards & Interactive Modals (Manager Dashboard Header Overview) */}
            <ManagerOverviewModals
              students={students}
              feeRecords={feeRecords}
              feeBalances={feeBalances}
              behaviorList={behaviorList}
              classMap={classMap}
              getClassName={getClassName}
              getStudentPhoto={getStudentPhoto}
              loadingStudents={loadingStudents}
              loadingFees={loadingFees}
              loadingBehavior={loadingBehavior}
              onSelectStudent={(st) => setSelectedStudentDetail(st)}
            />

            {/* Manager Switcher Tabs (5 Tabs) */}
            <div className="flex flex-wrap border-b border-slate-200 gap-x-2 gap-y-2">
              <button
                onClick={() => setManagerTab('students')}
                className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
                  managerTab === 'students'
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <i className="fa-solid fa-users"></i>
                <span>All Students Records ({filteredStudents.length})</span>
              </button>

              <button
                onClick={() => setManagerTab('homework')}
                className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
                  managerTab === 'homework'
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <i className="fa-solid fa-book-open"></i>
                <span>Homework Submissions ({filteredHomework.length})</span>
              </button>

              <button
                id="manager-tab-behavior"
                onClick={() => setManagerTab('behavior')}
                className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
                  managerTab === 'behavior'
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <i className="fa-solid fa-clipboard-check text-purple-600"></i>
                <span>Behavior Logs ({filteredManagerBehavior.length})</span>
              </button>

              <button
                onClick={() => setManagerTab('fees')}
                className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
                  managerTab === 'fees'
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <i className="fa-solid fa-file-invoice-dollar text-emerald-600"></i>
                <span>Fee Collection & Accounts ({filteredManagerFees.length})</span>
              </button>

              <button
                onClick={() => setManagerTab('users')}
                className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
                  managerTab === 'users'
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <i className="fa-solid fa-id-card-clip text-amber-600"></i>
                <span>Staff & Users Sheet ({filteredUsers.length})</span>
              </button>

              <button
                id="manager-tab-van-tracking"
                onClick={() => setManagerTab('vanTracking')}
                className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 cursor-pointer transition-colors ${
                  managerTab === 'vanTracking'
                    ? 'border-blue-900 text-blue-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <i className="fa-solid fa-van-shuttle text-amber-500"></i>
                <span>वैन लाइव ट्रैकिंग (Van Tracking)</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              </button>

              {/* Universal Student Finder & QR Scanner button */}
              <button
                type="button"
                onClick={() => {
                  setQrScannerTarget('managerStudents');
                  setQrScannerSubtitle('प्रबंधक: छात्र खोजें (QR स्कैन, नाम, ID या मोबाइल द्वारा)');
                  setQrScannerOpen(true);
                }}
                className="pb-2.5 px-3.5 text-xs sm:text-sm font-bold flex items-center gap-1.5 cursor-pointer bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 rounded-xl shadow-xs ml-auto transition-all"
              >
                <i className="fa-solid fa-magnifying-glass"></i>
                <i className="fa-solid fa-qrcode"></i>
                <span>छात्र खोजें / QR स्कैनर</span>
              </button>
            </div>

            {/* VIEW 1: STUDENTS RECORDS */}
            {managerTab === 'students' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {/* Search & Filter Bar */}
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
                        <i className="fa-solid fa-magnifying-glass"></i>
                      </span>
                      <input
                        type="text"
                        value={studentSearchTerm}
                        onChange={(e) => setStudentSearchTerm(e.target.value)}
                        placeholder="Search name, mobile, roll..."
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 focus:border-blue-800 text-xs outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQrScannerTarget('managerStudents');
                        setQrScannerSubtitle('प्रबंधक: छात्र का क्यूआर कोड स्कैन करके खोजें');
                        setQrScannerOpen(true);
                      }}
                      className="px-3 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                      title="Scan QR Code to search student"
                    >
                      <i className="fa-solid fa-camera"></i>
                      <span className="hidden sm:inline">QR Scan</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs text-slate-500 whitespace-nowrap">Filter Class:</span>
                    <select
                      value={studentClassFilter}
                      onChange={(e) => setStudentClassFilter(e.target.value)}
                      className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white outline-none w-full sm:w-auto"
                    >
                      <option value="all">All Classes</option>
                      {classOptions.map((c) => (
                        <option key={c} value={c}>
                          Class {getClassName(c)}
                        </option>
                      ))}
                    </select>

                    {/* Add Student Button for Manager */}
                    <button
                      id="btn-add-student-manager"
                      type="button"
                      onClick={() => setAddStudentModalOpen(true)}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0 transition-colors"
                      title="नया छात्र जोड़ें (Add New Student)"
                    >
                      <i className="fa-solid fa-user-plus"></i>
                      <span>नया छात्र जोड़ें</span>
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-4 py-3">Adm / Roll</th>
                        <th className="px-4 py-3">Student Name</th>
                        <th className="px-4 py-3">Class</th>
                        <th className="px-4 py-3">Father&apos;s Name</th>
                        <th className="px-4 py-3">Parent Mobile</th>
                        <th className="px-4 py-3">Village/Route</th>
                        <th className="px-4 py-3 text-right">FEE DUE STATUS</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {loadingStudents ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                            <i className="fa-solid fa-spinner fa-spin text-lg mr-2"></i>
                            Loading student records...
                          </td>
                        </tr>
                      ) : filteredStudents.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                            No student records found matching your filters.
                          </td>
                        </tr>
                      ) : (
                        filteredStudents.map((s, idx) => {
                          const balance = getStudentBalance(s);
                          const isDue = balance > 0;
                          return (
                            <tr key={s.Student_ID || idx} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3 font-mono font-bold text-slate-900">
                                #{s.Admission_Number || idx + 1}
                                <span className="text-[10px] text-slate-400 block font-normal">
                                  Roll: {s.Roll_Number || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-bold text-blue-950">{s.Student_Name || 'Unknown'}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{s.Student_ID}</div>
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2.5 py-1 bg-blue-50 text-blue-950 rounded font-bold border border-blue-200 text-xs inline-flex items-center gap-1 shadow-2xs">
                                  <i className="fa-solid fa-graduation-cap text-blue-700 text-[10px]"></i>
                                  {getClassName(s.Class)}
                                </span>
                              </td>
                              <td className="px-4 py-3">{s.Father_Name || '—'}</td>
                              <td className="px-4 py-3 font-mono">
                                <span className="flex items-center gap-1 text-slate-700">
                                  <i className="fa-solid fa-phone text-[10px] text-slate-400"></i>
                                  {s.Parent_Mobile || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-3">{s['Village/rRoute'] || s.Village || '—'}</td>
                              <td className="px-4 py-3 text-right">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold text-xs border shadow-2xs ${
                                    isDue
                                      ? 'text-red-600 bg-red-50 border-red-200'
                                      : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                                  }`}
                                  title={`Student ID: ${s.Student_ID} | Fee Collection Balance: ₹${balance}`}
                                >
                                  <i
                                    className={`fa-solid text-[10px] ${
                                      isDue ? 'fa-triangle-exclamation text-red-600' : 'fa-circle-check text-emerald-600'
                                    }`}
                                  ></i>
                                  <span>₹{balance.toLocaleString('en-IN')}</span>
                                  <span className="text-[9px] uppercase font-bold tracking-tight">
                                    {isDue ? 'Due' : 'Cleared'}
                                  </span>
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    onClick={() => {
                                      setSelectedStudentDetail(s);
                                      setHideModalPass(false);
                                      setHideModalFeeStatus(false);
                                    }}
                                    className="px-2 py-1 bg-slate-100 hover:bg-[#0c2340] hover:text-amber-300 text-slate-700 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                                    title="View student profile & card"
                                  >
                                    View
                                  </button>
                                  <button
                                    onClick={() => {
                                      setAddFeeInitialStudentId(s.Student_ID);
                                      setAddFeeModalOpen(true);
                                    }}
                                    className="px-2 py-1 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-800 border border-emerald-300 rounded text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1"
                                    title="Add fee payment for this student"
                                  >
                                    <i className="fa-solid fa-plus text-[10px]"></i>
                                    <span>Fee</span>
                                  </button>
                                  <button
                                    onClick={() => setPreviewQRStudent(s)}
                                    className="p-1 px-2 bg-blue-50 hover:bg-[#0c2340] hover:text-amber-300 text-blue-900 border border-blue-200 rounded text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1"
                                    title="View QR Code"
                                  >
                                    <i className="fa-solid fa-qrcode text-amber-500"></i>
                                    <span className="hidden sm:inline text-[10px]">QR</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* VIEW 2: HOMEWORK SUBMISSIONS */}
            {managerTab === 'homework' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {/* Search & Filter Bar */}
                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-md">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
                        <i className="fa-solid fa-magnifying-glass"></i>
                      </span>
                      <input
                        type="text"
                        value={hwSearchTerm}
                        onChange={(e) => setHwSearchTerm(e.target.value)}
                        placeholder="Search subject, details, teacher, student..."
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 focus:border-blue-800 text-xs outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQrScannerTarget('managerHomework');
                        setQrScannerSubtitle('प्रबंधक: गृहकार्य खोजने हेतु छात्र का क्यूआर कोड स्कैन करें');
                        setQrScannerOpen(true);
                      }}
                      className="px-3 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                      title="Scan QR Code to search homework"
                    >
                      <i className="fa-solid fa-camera"></i>
                      <span className="hidden sm:inline">QR Scan</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 whitespace-nowrap">Filter Class:</span>
                      <select
                        value={hwClassFilter}
                        onChange={(e) => setHwClassFilter(e.target.value)}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-xs bg-white outline-none"
                      >
                        <option value="all">All Classes</option>
                        {classOptions.map((c) => (
                          <option key={c} value={c}>
                            Class {getClassName(c)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Date Sort Toggle Button */}
                    <button
                      id="hw-date-sort-toggle-btn"
                      type="button"
                      onClick={() => setHwDateSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors shadow-sm cursor-pointer"
                      title={`Date order: currently ${hwDateSortOrder === 'asc' ? 'Ascending (Oldest first)' : 'Descending (Newest first)'}. Click to toggle.`}
                    >
                      <i
                        className={`fa-solid ${
                          hwDateSortOrder === 'asc'
                            ? 'fa-arrow-up-wide-short text-blue-900'
                            : 'fa-arrow-down-wide-short text-amber-600'
                        }`}
                      ></i>
                      <span>Date: {hwDateSortOrder === 'asc' ? 'Oldest First (Asc)' : 'Newest First (Desc)'}</span>
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                      <tr>
                        {/* Date Column Header with Sort Toggle */}
                        <th
                          id="th-hw-date-sort"
                          onClick={() => setHwDateSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                          className="px-4 py-3 cursor-pointer select-none hover:bg-[#10316b] transition-colors group"
                          title={`Sort by Date: currently ${hwDateSortOrder === 'asc' ? 'Ascending (oldest first)' : 'Descending (newest first)'}. Click to toggle.`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Date</span>
                            <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-blue-950/80 text-amber-300 text-[10px] group-hover:bg-blue-900 transition-colors">
                              <i
                                className={`fa-solid ${
                                  hwDateSortOrder === 'asc'
                                    ? 'fa-arrow-up-short-wide'
                                    : 'fa-arrow-down-wide-short'
                                }`}
                              ></i>
                            </span>
                            <span className="text-[9px] font-bold tracking-wider uppercase px-1 py-0.5 rounded bg-amber-400/20 text-amber-200 border border-amber-400/30">
                              {hwDateSortOrder.toUpperCase()}
                            </span>
                          </div>
                        </th>
                        <th className="px-4 py-3">Class</th>
                        <th className="px-4 py-3">Subject</th>
                        <th className="px-4 py-3">Homework Detail</th>
                        <th className="px-4 py-3">Target</th>
                        <th className="px-4 py-3">Teacher</th>
                        <th className="px-4 py-3 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {loadingHomework ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                            <i className="fa-solid fa-spinner fa-spin text-lg mr-2"></i>
                            Loading homework submissions...
                          </td>
                        </tr>
                      ) : filteredHomework.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                            No homework entries found matching filter criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredHomework.map((hw, idx) => (
                          <tr key={hw.Homework_ID || idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 whitespace-nowrap text-slate-900 font-medium">
                              {formatDate(hw.Date)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap font-bold text-blue-900">
                              Class {getClassName(hw.Class)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded font-bold border text-[10px] ${getSubjectColor(
                                  hw.Subject
                                )}`}
                              >
                                {hw.Subject || 'General'}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-xs truncate text-slate-800 font-medium">
                              {hw.Homework_Detail}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-[11px] text-slate-500">
                              {hw.Target_Type || 'Poori Class'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-[11px] text-slate-600">
                              {hw.Teacher || 'Faculty'}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              <button
                                onClick={() => setSelectedHomeworkDetail(hw)}
                                className="px-2.5 py-1 bg-slate-100 hover:bg-[#0c2340] hover:text-amber-300 text-slate-700 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                              >
                                View Details
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* VIEW 3: DAILY BEHAVIOR & HYGIENE LOGS */}
            {managerTab === 'behavior' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                {/* Search & Filter Bar */}
                <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <div className="relative flex-1">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">
                        <i className="fa-solid fa-magnifying-glass"></i>
                      </span>
                      <input
                        type="text"
                        value={managerBehaviorSearch}
                        onChange={(e) => setManagerBehaviorSearch(e.target.value)}
                        placeholder="Search Student ID, Remark, AI Guidance..."
                        className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 focus:border-blue-800 text-xs outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQrScannerTarget('managerBehavior');
                        setQrScannerSubtitle('प्रबंधक: व्यवहार व स्वच्छता जांच हेतु छात्र का क्यूआर कोड स्कैन करें');
                        setQrScannerOpen(true);
                      }}
                      className="px-3 py-2 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
                      title="Scan QR Code to search student behavior"
                    >
                      <i className="fa-solid fa-camera"></i>
                      <span className="hidden sm:inline">QR Scan</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Class Filter */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500 whitespace-nowrap">Class:</span>
                      <select
                        value={managerBehaviorClassFilter}
                        onChange={(e) => setManagerBehaviorClassFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white outline-none"
                      >
                        <option value="all">All Classes</option>
                        {classOptions.map((c) => (
                          <option key={c} value={c}>
                            Class {getClassName(c)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Date Filter */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-500 whitespace-nowrap">Date:</span>
                      <select
                        value={managerBehaviorDateFilter}
                        onChange={(e) => setManagerBehaviorDateFilter(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white outline-none"
                      >
                        <option value="all">All Dates</option>
                        {behaviorAvailableDates.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Date Sort Toggle */}
                    <button
                      id="manager-behavior-date-sort-btn"
                      type="button"
                      onClick={() => setManagerBehaviorSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors shadow-xs cursor-pointer"
                      title={`Date order: currently ${managerBehaviorSortOrder === 'asc' ? 'Ascending (oldest first)' : 'Descending (newest first)'}. Click to toggle.`}
                    >
                      <i
                        className={`fa-solid ${
                          managerBehaviorSortOrder === 'asc'
                            ? 'fa-arrow-up-wide-short text-blue-900'
                            : 'fa-arrow-down-wide-short text-amber-600'
                        }`}
                      ></i>
                      <span>Date ({managerBehaviorSortOrder.toUpperCase()})</span>
                    </button>

                    {/* Record New Behavior Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setQrScannerTarget(null);
                        setQrScannerSubtitle('आचरण व अनुशासन दर्ज करने हेतु छात्र खोजें या स्कैन करें');
                        setQrScannerOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0c2340] hover:bg-blue-950 text-amber-300 text-xs font-bold transition-all shadow-xs cursor-pointer"
                    >
                      <i className="fa-solid fa-plus-circle text-amber-400"></i>
                      <span>नया आचरण दर्ज करें</span>
                    </button>
                  </div>
                </div>

                {/* Manager Behavior Quick KPI Metric strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2.5 pt-1">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">Filtered Records</span>
                    <span className="text-base font-extrabold text-slate-900">{filteredManagerBehavior.length}</span>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-emerald-700 font-bold uppercase block">Present Count</span>
                    <span className="text-base font-extrabold text-emerald-900">
                      {filteredManagerBehavior.filter((b) => b.Is_Present).length}
                    </span>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-blue-700 font-bold uppercase block">Bathed</span>
                    <span className="text-base font-extrabold text-blue-900">
                      {filteredManagerBehavior.filter((b) => b.Is_Bathed).length}
                    </span>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-purple-700 font-bold uppercase block">Nails Clean</span>
                    <span className="text-base font-extrabold text-purple-900">
                      {filteredManagerBehavior.filter((b) => b.Nails_Clean).length}
                    </span>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-indigo-700 font-bold uppercase block">Clean Uniform</span>
                    <span className="text-base font-extrabold text-indigo-900">
                      {filteredManagerBehavior.filter((b) => b.Uniform_clean).length}
                    </span>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-center">
                    <span className="text-[10px] text-amber-700 font-bold uppercase block">Disciplined</span>
                    <span className="text-base font-extrabold text-amber-900">
                      {filteredManagerBehavior.filter((b) => b.Discipline).length}
                    </span>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-[#0c2340] text-amber-300 uppercase tracking-wider text-[10px]">
                      <tr>
                        <th
                          onClick={() => setManagerBehaviorSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                          className="px-3.5 py-3 cursor-pointer select-none hover:bg-[#10316b] transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>Date</span>
                            <i
                              className={`fa-solid ${
                                managerBehaviorSortOrder === 'asc'
                                  ? 'fa-arrow-up-short-wide'
                                  : 'fa-arrow-down-wide-short'
                              }`}
                            ></i>
                          </div>
                        </th>
                        <th className="px-3.5 py-3">Student & ID</th>
                        <th className="px-3.5 py-3">Class</th>
                        <th className="px-3.5 py-3 text-center">Attendance</th>
                        <th className="px-3.5 py-3 text-center">Hygiene Check</th>
                        <th className="px-3.5 py-3 text-center">Discipline</th>
                        <th className="px-3.5 py-3">Remark / Note</th>
                        <th className="px-3.5 py-3">AI Guidance</th>
                        <th className="px-3.5 py-3 text-center">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {loadingBehavior ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            <i className="fa-solid fa-spinner fa-spin text-lg mr-2"></i>
                            Loading student daily behavior records...
                          </td>
                        </tr>
                      ) : filteredManagerBehavior.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                            No student behavior records found matching the criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredManagerBehavior.map((rec, idx) => {
                          const matchedStudent = students.find(
                            (s) =>
                              String(s.Student_ID || '').toLowerCase() === String(rec.Student_ID || '').toLowerCase()
                          );
                          const studentName = matchedStudent?.Student_Name || `ID ${rec.Student_ID}`;
                          const isFault =
                            (rec.Remark || '').toLowerCase().includes('fault') ||
                            (rec.Remark || '').toLowerCase().includes('bad');

                          return (
                            <tr key={rec.Behavior_ID ? `${rec.Behavior_ID}-${idx}` : idx} className="hover:bg-slate-50 transition-colors">
                              {/* Date */}
                              <td className="px-3.5 py-3 whitespace-nowrap font-semibold text-slate-900">
                                {rec.Date}
                              </td>

                              {/* Student ID & Name */}
                              <td className="px-3.5 py-3">
                                <div className="font-bold text-slate-900">{studentName}</div>
                                <div className="text-[10px] text-slate-500 font-mono">ID: {rec.Student_ID}</div>
                              </td>

                              {/* Class */}
                              <td className="px-3.5 py-3 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 font-bold text-[11px]">
                                  {getClassName(rec.Class)}
                                </span>
                              </td>

                              {/* Attendance */}
                              <td className="px-3.5 py-3 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    rec.Is_Present
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-rose-100 text-rose-800'
                                  }`}
                                >
                                  <i className={`fa-solid ${rec.Is_Present ? 'fa-check' : 'fa-xmark'}`}></i>
                                  <span>{rec.Is_Present ? 'Present' : 'Absent'}</span>
                                </span>
                              </td>

                              {/* Hygiene Checklist Badges */}
                              <td className="px-3.5 py-3">
                                <div className="flex flex-wrap items-center justify-center gap-1">
                                  <span
                                    title={`Bathed: ${rec.Is_Bathed ? 'Yes' : 'No'}`}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                                      rec.Is_Bathed ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-400 line-through'
                                    }`}
                                  >
                                    <i className="fa-solid fa-shower text-[9px]"></i>
                                    <span>Bath</span>
                                  </span>

                                  <span
                                    title={`Nails Clean: ${rec.Nails_Clean ? 'Yes' : 'No'}`}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                                      rec.Nails_Clean ? 'bg-purple-100 text-purple-800' : 'bg-slate-100 text-slate-400 line-through'
                                    }`}
                                  >
                                    <i className="fa-solid fa-hand text-[9px]"></i>
                                    <span>Nails</span>
                                  </span>

                                  <span
                                    title={`Uniform Clean: ${rec.Uniform_clean ? 'Yes' : 'No'}`}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                                      rec.Uniform_clean ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-400 line-through'
                                    }`}
                                  >
                                    <i className="fa-solid fa-shirt text-[9px]"></i>
                                    <span>Uniform</span>
                                  </span>
                                </div>
                              </td>

                              {/* Discipline & Manners */}
                              <td className="px-3.5 py-3 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    rec.Discipline
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  <i className={`fa-solid ${rec.Discipline ? 'fa-check' : 'fa-triangle-exclamation'}`}></i>
                                  <span>{rec.Discipline ? 'Good' : 'Needs Care'}</span>
                                </span>
                              </td>

                              {/* Remark */}
                              <td className="px-3.5 py-3 max-w-[180px]">
                                {rec.Remark ? (
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                                      isFault
                                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {rec.Remark}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 text-[11px]">Normal / None</span>
                                )}
                              </td>

                              {/* AI Guidance */}
                              <td className="px-3.5 py-3 max-w-[220px]">
                                <p className="text-[11px] text-slate-600 line-clamp-2" title={getBehaviorFeedback(rec)}>
                                  {getBehaviorFeedback(rec)}
                                </p>
                              </td>

                              {/* WhatsApp Share Button */}
                              <td className="px-3.5 py-3 text-center whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const parentMobile = matchedStudent?.Mobile_Number || matchedStudent?.Parent_Mobile || '';
                                    const cleanMobile = String(parentMobile).replace(/\D/g, '');
                                    const cName = getClassName(rec.Class || matchedStudent?.Class);
                                    let pts = 0;
                                    if (rec.Is_Present) pts++;
                                    if (rec.Is_Bathed) pts++;
                                    if (rec.Nails_Clean) pts++;
                                    if (rec.Uniform_clean) pts++;
                                    if (rec.Discipline) pts++;

                                    const msg = `🏫 *School Daily Student Behavior & Hygiene Report*\n` +
                                      `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                      `👤 *Student:* ${studentName}\n` +
                                      `🆔 *Student ID:* ${rec.Student_ID}\n` +
                                      `📅 *Date:* ${rec.Date}\n` +
                                      `📚 *Class:* ${cName}\n` +
                                      `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                      `📋 *Daily Check Parameters:*\n` +
                                      `• Attendance: ${rec.Is_Present ? '✅ Present' : '❌ Absent'}\n` +
                                      `• Morning Bath: ${rec.Is_Bathed ? '✅ Done' : '❌ Incomplete'}\n` +
                                      `• Clean Nails: ${rec.Nails_Clean ? '✅ Clean & Trimmed' : '❌ Needs Trimming'}\n` +
                                      `• School Uniform: ${rec.Uniform_clean ? '✅ Clean & Neat' : '❌ Needs Attention'}\n` +
                                      `• Good Manners: ${rec.Good_Manners || (rec.Discipline ? 'Respectful' : 'Needs guidance')}\n` +
                                      `• Classroom Discipline: ${rec.Discipline ? '✅ Well Behaved' : '⚠️ Attention Needed'}\n` +
                                      (rec.Remark ? `• Teacher Remark: ${rec.Remark}\n` : '') +
                                      `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                      `🌟 *Overall Daily Score:* ${pts}/5\n` +
                                      `💡 *Teacher / AI Feedback:* ${getBehaviorFeedback(rec)}\n` +
                                      `━━━━━━━━━━━━━━━━━━━━━━\n` +
                                      `_Sent via School Portal._`;

                                    const encoded = encodeURIComponent(msg);
                                    const waUrl = cleanMobile.length >= 10
                                      ? `https://wa.me/91${cleanMobile.slice(-10)}?text=${encoded}`
                                      : `https://wa.me/?text=${encoded}`;
                                    window.open(waUrl, '_blank');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors shadow-xs cursor-pointer"
                                  title="Send behavior report to parent via WhatsApp"
                                >
                                  <i className="fa-brands fa-whatsapp text-xs"></i>
                                  <span>Send</span>
                                </button>
                                {matchedStudent && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedBehaviorStudent(matchedStudent);
                                      setBehaviorModalOpen(true);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#0c2340] hover:bg-blue-950 text-amber-300 font-bold text-[11px] transition-colors shadow-xs cursor-pointer ml-1.5"
                                    title="Update behavior or remarks"
                                  >
                                    <i className="fa-solid fa-pen-to-square text-xs"></i>
                                    <span>Edit</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* VIEW 4: FEE COLLECTION & ACCOUNTS */}
            {managerTab === 'fees' && (
              <ManagerFeeDashboard
                students={students}
                feeRecords={feeRecords}
                feeBalances={feeBalances}
                classMap={classMap}
                getClassName={getClassName}
                getStudentPhoto={getStudentPhoto}
                onOpenAddFeeModal={(studentId) => {
                  setAddFeeInitialStudentId(studentId);
                  setAddFeeModalOpen(true);
                }}
                onTriggerQRScan={() => {
                  setQrScannerTarget('managerFees');
                  setQrScannerSubtitle('प्रबंधक: फीस रिकॉर्ड खोजने हेतु छात्र का क्यूआर कोड स्कैन करें');
                  setQrScannerOpen(true);
                }}
                onRefreshFees={fetchFeeCollection}
                loadingFees={loadingFees}
                managerName={managerUser?.Name || 'School Manager'}
                initialSelectedStudent={managerSelectedFeeStudent}
                onClearBalance={(st) => {
                  const sId = String(st.Student_ID || '').toLowerCase();
                  if (sId) {
                    setFeeBalances((prev) => ({ ...prev, [sId]: 0 }));
                  }
                }}
              />
            )}

            {/* VIEW 5: USERS & STAFF DIRECTORY (Users Sheet) */}
            {managerTab === 'users' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-5">
                {/* Header & Controls */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <i className="fa-solid fa-id-card-clip text-amber-600"></i>
                      <span>स्कूल स्टाफ एवं यूजर रिकॉर्ड्स (Users Sheet Directory)</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Google Sheet ('Users') से सत्यापित प्रबंधक, शिक्षक व कर्मचारियों की सूची
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={fetchUsers}
                      disabled={loadingUsers}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <i className={`fa-solid fa-rotate-right ${loadingUsers ? 'fa-spin' : ''}`}></i>
                      <span>Refresh Users</span>
                    </button>
                  </div>
                </div>

                {/* Staff Summary Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] text-slate-500 font-medium block">कुल स्टाफ (Total Users)</span>
                    <span className="text-lg font-bold text-slate-900">{usersList.length}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <span className="text-[11px] text-amber-800 font-medium block">प्रबंधक / एडमिन (Managers)</span>
                    <span className="text-lg font-bold text-amber-900">
                      {usersList.filter((u) => /manager|admin|principal|director|head/i.test(String(u.Designation || ''))).length}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                    <span className="text-[11px] text-blue-800 font-medium block">अध्यापक (Teachers)</span>
                    <span className="text-lg font-bold text-blue-900">
                      {usersList.filter((u) => /teacher|faculty|instructor/i.test(String(u.Designation || ''))).length}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <span className="text-[11px] text-emerald-800 font-medium block">अन्य स्टाफ (Support)</span>
                    <span className="text-lg font-bold text-emerald-900">
                      {usersList.filter((u) => !/manager|admin|principal|director|head|teacher|faculty/i.test(String(u.Designation || ''))).length}
                    </span>
                  </div>
                </div>

                {/* Search & Role Filters */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                      <i className="fa-solid fa-magnifying-glass"></i>
                    </span>
                    <input
                      type="text"
                      value={staffSearchTerm}
                      onChange={(e) => setStaffSearchTerm(e.target.value)}
                      placeholder="Search staff by Name, Username, Mobile, or User ID..."
                      className="w-full pl-8 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm outline-none"
                    />
                    {staffSearchTerm && (
                      <button
                        onClick={() => setStaffSearchTerm('')}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="w-full sm:w-56">
                    <select
                      value={staffRoleFilter}
                      onChange={(e) => setStaffRoleFilter(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:border-blue-800 focus:ring-2 focus:ring-blue-800/20 text-xs sm:text-sm bg-white"
                    >
                      <option value="all">All Designations ({usersList.length})</option>
                      {staffRoleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Staff Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredUsers.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-slate-400">
                      <i className="fa-solid fa-user-xmark text-4xl mb-2 text-slate-300 block"></i>
                      कोई स्टाफ यूजर नहीं मिला (No staff user records found)
                    </div>
                  ) : (
                    filteredUsers.map((user) => {
                      const isManagerRole = /manager|admin|principal|director|head/i.test(String(user.Designation || ''));
                      const isTeacherRole = /teacher|faculty/i.test(String(user.Designation || ''));
                      const cleanPhone = String(user.Mobile_number || '').replace(/\D/g, '');

                      return (
                        <div
                          key={user.User_ID || user.Username || user.Name}
                          className={`p-4 rounded-2xl border transition-all ${
                            isManagerRole
                              ? 'bg-gradient-to-br from-amber-50/70 via-white to-amber-50/40 border-amber-300 shadow-xs'
                              : 'bg-white border-slate-200 hover:shadow-xs'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm shrink-0 shadow-xs ${
                                  isManagerRole
                                    ? 'bg-amber-400 text-slate-950 border border-amber-200'
                                    : isTeacherRole
                                    ? 'bg-blue-100 text-blue-900 border border-blue-200'
                                    : 'bg-slate-100 text-slate-800 border border-slate-200'
                                }`}
                              >
                                {isManagerRole ? (
                                  <i className="fa-solid fa-user-tie"></i>
                                ) : isTeacherRole ? (
                                  <i className="fa-solid fa-chalkboard-user"></i>
                                ) : (
                                  <i className="fa-solid fa-user"></i>
                                )}
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-900 text-sm leading-tight">
                                  {user.Name || 'Unnamed Staff'}
                                </h4>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  ID: {user.User_ID || 'N/A'}
                                </span>
                              </div>
                            </div>

                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                isManagerRole
                                  ? 'bg-amber-400 text-slate-950 border border-amber-500/30'
                                  : isTeacherRole
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {user.Designation || 'Staff'}
                            </span>
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                            {user.Username && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 text-[11px]">Username:</span>
                                <span className="font-mono font-medium text-slate-800">{user.Username}</span>
                              </div>
                            )}

                            {user.Mobile_number && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 text-[11px]">Mobile:</span>
                                <div className="flex items-center gap-1.5">
                                  <a
                                    href={`tel:${user.Mobile_number}`}
                                    className="font-medium text-blue-700 hover:underline"
                                  >
                                    {user.Mobile_number}
                                  </a>
                                  {cleanPhone.length >= 10 && (
                                    <a
                                      href={`https://wa.me/91${cleanPhone.slice(-10)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-emerald-600 hover:text-emerald-700"
                                      title="Chat on WhatsApp"
                                    >
                                      <i className="fa-brands fa-whatsapp text-xs"></i>
                                    </a>
                                  )}
                                </div>
                              </div>
                            )}

                            {user.Assigned_Class && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 text-[11px]">Assigned Class:</span>
                                <span className="font-semibold text-slate-800">
                                  {getClassName(user.Assigned_Class)}
                                </span>
                              </div>
                            )}

                            {user.Last_AI_Run && (
                              <div className="flex items-center justify-between">
                                <span className="text-slate-400 text-[11px]">Last AI Run:</span>
                                <span className="text-[10px] text-slate-500">
                                  {user.Last_AI_Run}
                                </span>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1">
                              <span className="text-slate-400 text-[11px]">Password:</span>
                              <span className="text-[11px] font-mono text-emerald-700 flex items-center gap-1">
                                <i className="fa-solid fa-lock text-[10px]"></i>
                                Configured in Sheet
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* VIEW 6: VAN LIVE TRACKING */}
            {managerTab === 'vanTracking' && (
              <ManagerVanTracker
                students={students}
                users={usersList}
                onOpenDriverPortal={() => setActiveTab('driver')}
                getClassName={getClassName}
              />
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* 5. DRIVER PORTAL                                                          */}
        {/* ========================================================================= */}
        {activeTab === 'driver' && (
          <DriverPortal
            users={usersList}
            onBackToHome={() => setActiveTab('home')}
            onOpenManagerTracker={() => {
              setActiveTab('manager');
              setManagerTab('vanTracking');
            }}
          />
        )}
      </main>

      {/* ========================================================================= */}
      {/* STUDENT DETAIL MODAL                                                      */}
      {/* ========================================================================= */}
      {selectedStudentDetail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-fadeIn">
            <button
              onClick={() => setSelectedStudentDetail(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-lg cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-3.5 mb-5 pb-4 border-b border-slate-100">
              <StudentAvatar
                student={selectedStudentDetail}
                photoUrl={getStudentPhoto(selectedStudentDetail)}
                size="lg"
              />
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedStudentDetail.Student_Name}
                </h3>
                <p className="text-xs text-slate-500">
                  Class: <span className="font-semibold text-blue-900">{getClassName(selectedStudentDetail.Class)}</span> {selectedStudentDetail.Class !== getClassName(selectedStudentDetail.Class) ? <span className="text-slate-400 font-mono text-[10px]">({selectedStudentDetail.Class})</span> : ''} | Student ID: {selectedStudentDetail.Student_ID}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Admission Number</span>
                <span className="font-bold text-slate-800">{selectedStudentDetail.Admission_Number}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Roll Number</span>
                <span className="font-bold text-slate-800">{selectedStudentDetail.Roll_Number}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Father&apos;s Name</span>
                <span className="font-bold text-slate-800">{selectedStudentDetail.Father_Name || '—'}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Mother&apos;s Name</span>
                <span className="font-bold text-slate-800">{selectedStudentDetail.Mother_Name || '—'}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Parent Mobile</span>
                <span className="font-bold text-slate-800">{selectedStudentDetail.Parent_Mobile || '—'}</span>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Village / Route</span>
                <span className="font-bold text-slate-800">
                  {selectedStudentDetail['Village/rRoute'] || selectedStudentDetail.Village || '—'}
                </span>
              </div>
              {hideModalFeeStatus ? (
                <div className="col-span-2 p-2.5 rounded-lg bg-slate-50 border border-dashed border-slate-200 flex justify-between items-center text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-eye-slash text-slate-400"></i>
                    <span>शुल्क स्थिति छिपाई गई है (Fee status hidden)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setHideModalFeeStatus(false)}
                    className="text-[11px] font-bold text-blue-900 hover:underline cursor-pointer"
                  >
                    शुल्क स्थिति दिखाएं (Show Fee Status)
                  </button>
                </div>
              ) : (() => {
                const bal = getStudentBalance(selectedStudentDetail);
                const isDue = bal > 0;
                return (
                  <div
                    className={`col-span-2 p-3.5 rounded-xl border flex flex-col gap-2.5 transition-colors ${
                      isDue
                        ? 'bg-rose-50 border-rose-300 text-rose-950 shadow-2xs'
                        : 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-2xs'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                            isDue ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                          }`}
                        >
                          <i className={`fa-solid ${isDue ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
                        </div>
                        <div>
                          <div
                            className={`text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5 ${
                              isDue ? 'text-rose-800' : 'text-emerald-800'
                            }`}
                          >
                            <span>FEE DUE STATUS</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-extrabold uppercase ${
                                isDue
                                  ? 'bg-rose-200 text-rose-900 border border-rose-300'
                                  : 'bg-emerald-200 text-emerald-900 border border-emerald-300'
                              }`}
                            >
                              {isDue ? 'PAYMENT DUE' : 'CLEARED'}
                            </span>
                          </div>
                          <div className={`text-xs font-semibold ${isDue ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {isDue ? 'Pending Balance from Fee Collection' : 'Zero Balance (All fees paid)'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-base font-extrabold ${isDue ? 'text-rose-900' : 'text-emerald-900'}`}>
                          ₹{bal.toLocaleString('en-IN')}
                        </div>
                        <div className={`text-[10px] font-bold uppercase tracking-wider ${isDue ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {isDue ? 'DUE' : 'NIL'}
                        </div>
                      </div>
                    </div>

                    {/* Action buttons for Fee Due: Clear Due or Hide */}
                    <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {isDue && (
                          <button
                            type="button"
                            onClick={() => {
                              const confirmClear = window.confirm(
                                `क्या आप ${selectedStudentDetail.Student_Name} का बकाया (₹${bal}) हटाकर शून्य (₹0) करना चाहते हैं?`
                              );
                              if (confirmClear) {
                                const sId = String(selectedStudentDetail.Student_ID || '').trim().toLowerCase();
                                if (sId) {
                                  setFeeBalances((prev) => ({
                                    ...prev,
                                    [sId]: 0,
                                  }));
                                }
                                selectedStudentDetail.Balance_Amount = 0;
                                setStudents((prev) =>
                                  prev.map((st) => {
                                    if (String(st.Student_ID || '').trim().toLowerCase() === sId) {
                                      return { ...st, Balance_Amount: 0 };
                                    }
                                    return st;
                                  })
                                );
                                try {
                                  const existing = localStorage.getItem('evs_custom_fee_records');
                                  const list: FeeCollectionRecord[] = existing ? JSON.parse(existing) : [];
                                  const clearRec: FeeCollectionRecord = {
                                    Receipt_Number: `CLR-${Date.now().toString().slice(-6)}`,
                                    Student_ID: selectedStudentDetail.Student_ID,
                                    Date: new Date().toISOString().split('T')[0],
                                    Fee_Type: 'Due Cleared / Zeroed',
                                    Month: 'Current',
                                    Total_Amount: bal,
                                    Amount_Paid: bal,
                                    Balance_Amount: 0,
                                    Payment_Mode: 'Waived / Cleared',
                                    Received_By: managerUser?.Full_Name || 'Manager',
                                  };
                                  list.unshift(clearRec);
                                  localStorage.setItem('evs_custom_fee_records', JSON.stringify(list));
                                  setFeeRecords((prev) => [clearRec, ...prev]);
                                } catch (err) {
                                  console.warn('Could not save cleared fee:', err);
                                }
                              }
                            }}
                            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-[11px] shadow-2xs cursor-pointer flex items-center gap-1 transition-colors"
                            title="बकाया हटाकर ₹0 करें"
                          >
                            <i className="fa-solid fa-eraser"></i>
                            <span>बकाया हटाएं / शून्य करें (Clear Due)</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setHideModalFeeStatus(true)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg text-[11px] border border-slate-300 shadow-2xs cursor-pointer flex items-center gap-1 transition-colors"
                          title="यह शुल्क स्थिति बॉक्स छिपाएं"
                        >
                          <i className="fa-solid fa-eye-slash text-slate-400"></i>
                          <span>स्थिति छिपाएं (Hide)</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('manager');
                          setManagerTab('fees');
                          setAddFeeInitialStudentId(selectedStudentDetail.Student_ID);
                          setAddFeeModalOpen(true);
                          setSelectedStudentDetail(null);
                        }}
                        className="px-2.5 py-1 bg-[#0c2340] hover:bg-[#10316b] text-amber-300 font-bold rounded-lg text-[11px] shadow-2xs cursor-pointer flex items-center gap-1 transition-colors"
                      >
                        <i className="fa-solid fa-plus text-amber-400"></i>
                        <span>फ़ीस जमा करें</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Official Student QR Code Pass in Modal (With option to remove/hide) */}
            {!hideModalPass ? (
              <div className="mt-4 pt-3 border-t border-slate-100">
                <StudentQRCodeCard
                  student={selectedStudentDetail}
                  classNameTitle={getClassName(selectedStudentDetail.Class)}
                  variant="modal"
                  onEnlarge={() => setPreviewQRStudent(selectedStudentDetail)}
                  onRemove={() => setHideModalPass(true)}
                />
              </div>
            ) : (
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-600 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <i className="fa-solid fa-id-card-clip text-slate-400"></i>
                  <span>डिजिटल क्यूआर पास हटा दिया गया है (Digital Pass is hidden/removed)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHideModalPass(false)}
                  className="px-3 py-1.5 bg-[#0c2340] text-amber-300 hover:text-amber-200 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 transition-all shadow-2xs"
                >
                  <i className="fa-solid fa-qrcode text-amber-400"></i>
                  <span>पास वापस दिखाएं (Restore Pass)</span>
                </button>
              </div>
            )}

            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
              <div>
                {!hideModalPass && (
                  <button
                    type="button"
                    onClick={() => setHideModalPass(true)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg border border-rose-200 cursor-pointer flex items-center gap-1.5 transition-colors"
                    title="यह पास हटाएं"
                  >
                    <i className="fa-solid fa-trash-can text-[11px]"></i>
                    <span>पास हटाएं (Remove Pass)</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => setSelectedStudentDetail(null)}
                className="px-4 py-2 bg-[#0c2340] text-amber-300 hover:text-amber-200 text-xs font-bold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADD STUDENT MODAL (प्रबंधक: नया छात्र जोड़ें)                                */}
      {/* ========================================================================= */}
      <AddStudentModal
        isOpen={addStudentModalOpen}
        onClose={() => setAddStudentModalOpen(false)}
        onStudentAdded={handleStudentAdded}
        existingStudents={students}
        classMap={classMap}
        getClassName={getClassName}
      />

      {/* ========================================================================= */}
      {/* ADD FEE COLLECTION MODAL (फ़ीस रसीद काटें व जमा करें)                         */}
      {/* ========================================================================= */}
      <AddFeeModal
        isOpen={addFeeModalOpen}
        onClose={() => {
          setAddFeeModalOpen(false);
          setAddFeeInitialStudentId(undefined);
        }}
        onFeeAdded={handleFeeAdded}
        students={students}
        managerName={managerUser?.Name || 'Manager'}
        classMap={classMap}
        getClassName={getClassName}
        feeBalances={feeBalances}
        initialSelectedStudentId={addFeeInitialStudentId}
        onTriggerQRScan={() => {
          setQrScannerTarget('managerStudents');
          setQrScannerSubtitle('फ़ीस जमा करने हेतु छात्र का QR कोड स्कैन करें');
          setQrScannerOpen(true);
        }}
      />

      {/* ========================================================================= */}
      {/* UNIVERSAL STUDENT FINDER & ACTION HUB (QR Code, Name, ID, Mobile Scanner) */}
      {/* ========================================================================= */}
      <StudentQRScannerModal
        isOpen={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        onScan={handleQRScanned}
        students={students}
        title="छात्र खोजें एवं त्वरित कार्य (Find Student & Actions)"
        subtitle={qrScannerSubtitle || 'QR स्कैन, नाम, स्टूडेंट ID, मोबाइल नंबर या रोल नंबर द्वारा खोजें'}
        classMap={classMap}
        getClassName={getClassName}
        getStudentPhoto={getStudentPhoto}
        onTrackHomework={(student) => {
          setSelectedHwTrackerStudent(student as Student);
          setHwTrackerModalOpen(true);
        }}
        onAssignHomework={(student) => {
          if (student.Class) setHwClass(student.Class);
          setActiveTab('teacher');
          setTeacherPortalTab('upload');
        }}
        onAddFee={(student) => {
          setAddFeeInitialStudentId(student.Student_ID);
          setAddFeeModalOpen(true);
        }}
        onRecordBehavior={(student) => {
          setSelectedBehaviorStudent(student as Student);
          setBehaviorModalOpen(true);
        }}
      />

      {/* ========================================================================= */}
      {/* STUDENT BEHAVIOR & CONDUCT MODAL (आचरण व अनुशासन दर्ज करें)              */}
      {/* ========================================================================= */}
      <StudentBehaviorModal
        isOpen={behaviorModalOpen}
        onClose={() => {
          setBehaviorModalOpen(false);
          setSelectedBehaviorStudent(null);
        }}
        student={selectedBehaviorStudent}
        onSaveBehavior={handleSaveStudentBehavior}
        teacherName={teacherUser?.Name || managerUser?.Name || 'School Teacher'}
        getClassName={getClassName}
        getStudentPhoto={getStudentPhoto}
      />

      {/* ========================================================================= */}
      {/* STUDENT HOMEWORK QR TRACKER MODAL (Complete / Incomplete Tracker)        */}
      {/* ========================================================================= */}
      <StudentHomeworkQRTrackerModal
        isOpen={hwTrackerModalOpen}
        onClose={() => setHwTrackerModalOpen(false)}
        student={selectedHwTrackerStudent}
        homeworkList={homeworkList}
        hwTrackerList={hwTrackerList}
        classMap={classMap}
        getClassName={getClassName}
        getStudentPhoto={getStudentPhoto}
        onUpdateStatus={handleUpdateHomeworkStatusModal}
        onScanNextStudent={() => {
          setQrScannerTarget('teacherTracker');
          setQrScannerSubtitle('कल का होमवर्क चेक करने हेतु छात्र का QR कोड स्कैन करें');
          setQrScannerOpen(true);
        }}
        teacherName={teacherUser?.Name || 'Teacher'}
        allStudents={students}
        onSelectStudent={(st) => setSelectedHwTrackerStudent(st)}
      />

      {/* ========================================================================= */}
      {/* STUDENT QR CODE PREVIEW MODAL                                             */}
      {/* ========================================================================= */}
      {previewQRStudent && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 relative animate-fadeIn">
            <button
              onClick={() => setPreviewQRStudent(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-lg cursor-pointer"
              title="Close modal"
            >
              ✕
            </button>

            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-100">
              <div className="w-12 h-12 rounded-xl bg-[#0c2340] text-amber-400 flex items-center justify-center text-lg font-bold border-2 border-amber-300 shadow shrink-0">
                <i className="fa-solid fa-qrcode"></i>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {previewQRStudent.Student_Name}
                </h3>
                <p className="text-xs text-slate-500">
                  Class: <span className="font-semibold text-blue-900">{getClassName(previewQRStudent.Class)}</span> | ID: <span className="font-mono font-bold text-slate-800">{previewQRStudent.Student_ID}</span>
                </p>
              </div>
            </div>

            <StudentQRCodeCard
              student={previewQRStudent}
              classNameTitle={getClassName(previewQRStudent.Class)}
              variant="modal"
            />

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setPreviewQRStudent(null)}
                className="px-4 py-2 bg-[#0c2340] text-amber-300 hover:text-amber-200 text-xs font-bold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HOMEWORK DETAIL MODAL                                                     */}
      {/* ========================================================================= */}
      {selectedHomeworkDetail && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative animate-fadeIn">
            <button
              onClick={() => setSelectedHomeworkDetail(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-lg cursor-pointer"
            >
              ✕
            </button>

            <div className="flex items-center gap-2 mb-2">
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getSubjectColor(
                  selectedHomeworkDetail.Subject
                )}`}
              >
                {selectedHomeworkDetail.Subject}
              </span>
              <span className="text-xs text-slate-400">
                Class {getClassName(selectedHomeworkDetail.Class)} • {formatDate(selectedHomeworkDetail.Date)}
              </span>
            </div>

            <h3 className="text-lg font-bold text-slate-900 mb-3">
              Homework Assignment #{selectedHomeworkDetail.Homework_ID}
            </h3>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 mb-4 text-xs text-slate-800 whitespace-pre-line leading-relaxed max-h-60 overflow-y-auto">
              {selectedHomeworkDetail.Homework_Detail}
            </div>

            {/* Attached Photos & PDF Documents from Google Sheets / AppSheet */}
            <div className="mb-4">
              <HomeworkMediaAttachmentList
                homework={selectedHomeworkDetail}
                onOpenMedia={(media) => {
                  setMediaZoom(1);
                  setMediaRotation(0);
                  setActiveMediaModal(media);
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-100 mb-4">
              <div>
                <span className="text-slate-400 block">Faculty / Teacher:</span>
                <span className="font-semibold text-slate-700">
                  {selectedHomeworkDetail.Teacher || 'School Faculty'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Target Group:</span>
                <span className="font-semibold text-slate-700">
                  {selectedHomeworkDetail.Target_Type || 'Poori Class'}
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setSelectedHomeworkDetail(null)}
                className="px-4 py-2 bg-[#0c2340] text-amber-300 hover:text-amber-200 text-xs font-bold rounded-lg cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HOMEWORK MEDIA (IMAGE / PDF) LIGHTBOX MODAL                               */}
      {/* ========================================================================= */}
      {activeMediaModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 rounded-2xl max-w-4xl w-full flex flex-col max-h-[95vh] shadow-2xl border border-slate-700 overflow-hidden text-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center text-sm font-black shrink-0">
                  <i className={activeMediaModal.type === 'image' ? 'fa-solid fa-image' : 'fa-solid fa-file-pdf'}></i>
                </div>
                <div className="truncate">
                  <div className="text-xs sm:text-sm font-bold text-white truncate flex items-center gap-2">
                    <span>{activeMediaModal.labelHindi} ({activeMediaModal.title})</span>
                    {activeMediaModal.isDrive && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/30 text-blue-300 border border-blue-400/40">
                        Google Drive
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {activeMediaModal.fileName}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-1.5 shrink-0">
                {activeMediaModal.type === 'image' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setMediaZoom((z) => Math.max(0.5, z - 0.25))}
                      className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center text-xs cursor-pointer"
                      title="Zoom Out"
                    >
                      <i className="fa-solid fa-minus"></i>
                    </button>
                    <span className="text-[10px] font-mono text-slate-400 w-9 text-center">
                      {Math.round(mediaZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setMediaZoom((z) => Math.min(3, z + 0.25))}
                      className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center text-xs cursor-pointer"
                      title="Zoom In"
                    >
                      <i className="fa-solid fa-plus"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMediaRotation((r) => (r + 90) % 360)}
                      className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 flex items-center justify-center text-xs cursor-pointer"
                      title="Rotate 90 deg"
                    >
                      <i className="fa-solid fa-rotate-right"></i>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMediaZoom(1);
                        setMediaRotation(0);
                      }}
                      className="px-2 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-semibold text-slate-300 cursor-pointer"
                      title="Reset Zoom"
                    >
                      Reset
                    </button>
                  </>
                )}

                <a
                  href={activeMediaModal.openUrl || activeMediaModal.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 h-7 rounded-lg bg-amber-400 text-slate-950 hover:bg-amber-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                  title="Open Original in New Tab"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                  <span className="text-[11px] sm:text-xs">नई विंडो में खोलें</span>
                </a>

                <button
                  type="button"
                  onClick={() => setActiveMediaModal(null)}
                  className="w-7 h-7 rounded-lg bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer transition-colors ml-1"
                  title="Close"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-950/90 min-h-[50vh] max-h-[75vh]">
              {activeMediaModal.type === 'image' ? (
                <div className="flex flex-col items-center justify-center w-full h-full">
                  <div className="overflow-auto max-w-full max-h-full flex items-center justify-center p-2">
                    <img
                      src={activeMediaModal.url}
                      alt={activeMediaModal.title}
                      style={{
                        transform: `scale(${mediaZoom}) rotate(${mediaRotation}deg)`,
                        transformOrigin: 'center center',
                        transition: 'transform 0.15s ease-out',
                      }}
                      className="max-h-[65vh] max-w-full object-contain rounded-lg shadow-xl"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (activeMediaModal.fallbackUrl && target.src !== activeMediaModal.fallbackUrl) {
                          target.src = activeMediaModal.fallbackUrl;
                        } else {
                          target.style.display = 'none';
                          const errBox = document.getElementById('media-err-box');
                          if (errBox) errBox.style.display = 'block';
                        }
                      }}
                    />
                  </div>
                  <div id="media-err-box" style={{ display: 'none' }} className="text-center p-6 bg-slate-900 rounded-xl border border-slate-700 max-w-md">
                    <i className="fa-solid fa-triangle-exclamation text-amber-400 text-3xl mb-2"></i>
                    <h5 className="font-bold text-sm text-white">Google Drive / AppSheet Access Required</h5>
                    <p className="text-xs text-slate-300 mt-1 mb-3">
                      इस फ़ोटो को देखने के लिए कृपया नीचे दिए गए बटन से सीधे Google Drive में खोलें:
                    </p>
                    <a
                      href={activeMediaModal.openUrl || activeMediaModal.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-amber-400 text-slate-950 font-bold rounded-lg text-xs"
                    >
                      <i className="fa-solid fa-arrow-up-right-from-square"></i>
                      Google Drive में फ़ोटो खोलें
                    </a>
                  </div>
                </div>
              ) : (
                <div className="w-full h-[68vh] flex flex-col gap-3">
                  <div className="p-3 bg-slate-900 border border-slate-700 rounded-xl flex flex-wrap items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center text-sm shrink-0">
                        <i className="fa-solid fa-file-pdf"></i>
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{activeMediaModal.fileName}</p>
                        <p className="text-[11px] text-slate-300">यदि यहाँ PDF सीधे नहीं दिख रही है, तो नीचे दिए बटन से खोलें:</p>
                      </div>
                    </div>
                    <a
                      href={activeMediaModal.openUrl || activeMediaModal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-lg text-xs flex items-center gap-1.5 shadow-sm shrink-0"
                    >
                      <i className="fa-solid fa-arrow-up-right-from-square"></i>
                      <span>Google Drive / नए टैब में खोलें</span>
                    </a>
                  </div>
                  <iframe
                    src={activeMediaModal.url}
                    className="w-full flex-1 rounded-xl bg-white border border-slate-700 min-h-[45vh]"
                    title={activeMediaModal.title}
                  ></iframe>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>ई.वी.एस. पब्लिक स्कूल • गृहकार्य संलग्नक दर्शक (Homework Attachment Viewer)</span>
              <button
                type="button"
                onClick={() => setActiveMediaModal(null)}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs cursor-pointer"
              >
                बंद करें (Close)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="bg-[#0c2340] text-slate-300 border-t-2 border-amber-400 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 text-xs flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <div className="w-8 h-8 rounded-lg bg-amber-400 text-[#0c2340] flex items-center justify-center font-bold text-sm shrink-0">
              <i className="fa-solid fa-school"></i>
            </div>
            <div>
              <div className="font-bold text-white">E.V.S. Public School Web Portal</div>
              <div className="text-slate-400 text-[11px]">
                Dedicated to academic discipline and moral development
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-amber-300 hover:text-amber-200 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>Back to Top</span>
              <span className="text-sm">↑</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
