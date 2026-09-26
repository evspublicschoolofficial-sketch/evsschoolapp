import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Student } from '../App';

export interface NewStudentData {
  Student_ID: string;
  Admission_Number: string;
  Roll_Number: string;
  Student_Name: string;
  Class: string;
  Father_Name: string;
  Mother_Name: string;
  Parent_Mobile: string;
  'Village/rRoute'?: string;
  Balance_Amount?: number | string;
  Student_Photo?: string;
}

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStudentAdded: (student: Student, sendWhatsApp: boolean) => Promise<any> | void;
  existingStudents: Student[];
  classMap?: Record<string, string>;
  getClassName?: (c: string | undefined | null) => string;
  onOpenSyncSettings?: () => void;
}

export const AddStudentModal: React.FC<AddStudentModalProps> = ({
  isOpen,
  onClose,
  onStudentAdded,
  existingStudents,
  classMap = {},
  getClassName = (c) => c || 'N/A',
  onOpenSyncSettings,
}) => {
  // Form Fields
  const [studentId, setStudentId] = useState<string>('');
  const [admissionNumber, setAdmissionNumber] = useState<string>('');
  const [rollNumber, setRollNumber] = useState<string>('');
  const [studentName, setStudentName] = useState<string>('');
  const [selectedClass, setSelectedClass] = useState<string>('C5');
  const [fatherName, setFatherName] = useState<string>('');
  const [motherName, setMotherName] = useState<string>('');
  const [parentMobile, setParentMobile] = useState<string>('');
  const [villageRoute, setVillageRoute] = useState<string>('');
  const [openingBalance, setOpeningBalance] = useState<string>('0');
  const [studentPhotoUrl, setStudentPhotoUrl] = useState<string>('');
  const [sendWelcomeWhatsApp, setSendWelcomeWhatsApp] = useState<boolean>(true);

  const [qrPreviewUrl, setQrPreviewUrl] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedRow, setCopiedRow] = useState<boolean>(false);

  // Copy row formatted for direct paste into Google Sheet as a zero-downtime backup
  const handleCopyRowForSheet = () => {
    const qrFormula = `=IMAGE(CONCATENATE("https://api.qrserver.com/v1/create-qr-code/?data=", "${studentId.trim()}", "&size=250x250"))`;
    const rowValues = [
      studentId.trim(),
      admissionNumber.trim(),
      rollNumber.trim(),
      studentName.trim(),
      selectedClass,
      fatherName.trim(),
      motherName.trim(),
      parentMobile.trim(),
      studentPhotoUrl.trim(),
      villageRoute.trim(),
      '', // Adhar_Card
      '', // Adhar_Photo
      '', // Col 13
      openingBalance ? String(openingBalance) : '0',
      qrFormula,
    ];
    const tsv = rowValues.join('\t');
    try {
      navigator.clipboard.writeText(tsv).then(() => {
        setCopiedRow(true);
        setTimeout(() => setCopiedRow(false), 3000);
      });
    } catch {
      const ta = document.createElement('textarea');
      ta.value = tsv;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedRow(true);
      setTimeout(() => setCopiedRow(false), 3000);
    }
  };

  // Available classes list
  const classKeys = Object.keys(classMap).length > 0
    ? Object.keys(classMap)
    : ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'];

  // Initialize and auto-generate unique Student ID & Roll Number when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setIsSubmitting(false);

      // Auto-generate unique Student ID (e.g. S-1082)
      let maxNum = 1000;
      let maxAdm = 100;
      let maxRollInClass = 0;

      existingStudents.forEach((s) => {
        // Parse ID
        const sidStr = String(s.Student_ID || '').replace(/\D/g, '');
        if (sidStr) {
          const num = parseInt(sidStr, 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }

        // Parse Admission Number
        const admStr = String(s.Admission_Number || '').replace(/\D/g, '');
        if (admStr) {
          const admNum = parseInt(admStr, 10);
          if (!isNaN(admNum) && admNum > maxAdm) maxAdm = admNum;
        }

        // Parse Roll in same class
        if (s.Class === selectedClass) {
          const rNum = parseInt(String(s.Roll_Number || '0'), 10);
          if (!isNaN(rNum) && rNum > maxRollInClass) maxRollInClass = rNum;
        }
      });

      const nextId = `S-${maxNum + 1}`;
      const nextAdm = String(maxAdm + 1);
      const nextRoll = String(maxRollInClass + 1);

      setStudentId(nextId);
      setAdmissionNumber(nextAdm);
      setRollNumber(nextRoll);
      setStudentName('');
      setFatherName('');
      setMotherName('');
      setParentMobile('');
      setVillageRoute('');
      setOpeningBalance('0');
      setStudentPhotoUrl('');
      setSendWelcomeWhatsApp(true);
    }
  }, [isOpen]);

  // Recalculate suggested roll number when class changes
  const handleClassChange = (newCls: string) => {
    setSelectedClass(newCls);
    let maxRoll = 0;
    existingStudents.forEach((s) => {
      if (s.Class === newCls) {
        const rNum = parseInt(String(s.Roll_Number || '0'), 10);
        if (!isNaN(rNum) && rNum > maxRoll) maxRoll = rNum;
      }
    });
    setRollNumber(String(maxRoll + 1));
  };

  // Generate QR Code preview for Student_ID
  useEffect(() => {
    let active = true;
    if (studentId.trim()) {
      QRCode.toDataURL(studentId.trim(), {
        width: 180,
        margin: 1.5,
        color: {
          dark: '#0c2340',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'H',
      })
        .then((url) => {
          if (active) setQrPreviewUrl(url);
        })
        .catch(() => {});
    } else {
      setQrPreviewUrl('');
    }
    return () => {
      active = false;
    };
  }, [studentId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const sName = studentName.trim();
    const sId = studentId.trim();
    const admNo = admissionNumber.trim();
    const rollNo = rollNumber.trim();
    const mobile = parentMobile.replace(/\D/g, '');

    if (!sName) {
      setErrorMsg('कृपया छात्र का पूरा नाम दर्ज करें।');
      return;
    }
    if (!sId) {
      setErrorMsg('कृपया वैध Student ID दर्ज करें।');
      return;
    }
    if (mobile.length > 0 && mobile.length < 10) {
      setErrorMsg('मोबाइल नंबर कम से कम 10 अंकों का होना चाहिए।');
      return;
    }

    // Check ID duplicate in current memory
    const isDuplicate = existingStudents.some(
      (s) => String(s.Student_ID || '').toLowerCase().trim() === sId.toLowerCase()
    );
    if (isDuplicate) {
      setErrorMsg(`Student ID "${sId}" पहले से किसी छात्र के पास है। कृपया दूसरा ID दें।`);
      return;
    }

    setIsSubmitting(true);

    try {
      const generatedQrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(sId)}&size=250x250`;

      const newStudent: Student = {
        Student_ID: sId,
        Admission_Number: admNo || String(Date.now().toString().slice(-4)),
        Roll_Number: rollNo || '1',
        Student_Name: sName,
        Class: selectedClass,
        Father_Name: fatherName.trim(),
        Mother_Name: motherName.trim(),
        Parent_Mobile: mobile || parentMobile.trim(),
        'Village/rRoute': villageRoute.trim(),
        Village: villageRoute.trim(),
        Balance_Amount: openingBalance ? parseFloat(openingBalance) || 0 : 0,
        Student_Photo: studentPhotoUrl.trim(),
        'QR code': generatedQrUrl,
        'QR_code': generatedQrUrl,
        QRCode: generatedQrUrl,
      };

      await onStudentAdded(newStudent, sendWelcomeWhatsApp);
      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setErrorMsg(err.message || 'छात्र रिकॉर्ड जोड़ने में त्रुटि हुई।');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white p-5 px-6 flex items-center justify-between shrink-0 border-b-2 border-amber-400">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-xl font-black shadow-md border-2 border-amber-200">
              <i className="fa-solid fa-user-plus"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider font-extrabold bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full">
                  स्कूल प्रबंधक (Manager Portal)
                </span>
                <span className="text-xs text-amber-200 font-medium">New Admission</span>
              </div>
              <h3 className="text-lg font-extrabold text-white mt-0.5">
                नया छात्र जोड़ें (Add New Student)
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 sm:p-6 space-y-4 flex-1">
          {/* Google Sheets Sync Diagnostic Banner */}
          <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 animate-pulse"></span>
              <span className="font-semibold">
                छात्र सेव होते ही पोर्टल व Google Sheet (Students शीट) में तुरंत दर्ज होगा।
              </span>
            </div>
            {onOpenSyncSettings && (
              <button
                type="button"
                onClick={onOpenSyncSettings}
                className="text-xs font-bold text-blue-700 hover:text-blue-900 underline flex items-center gap-1 self-start sm:self-auto cursor-pointer"
              >
                <i className="fa-solid fa-gear text-[11px]"></i>
                <span>Google Sheet Sync सेटिंग्स</span>
              </button>
            )}
          </div>

          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
              <i className="fa-solid fa-triangle-exclamation text-rose-600 text-sm mt-0.5 shrink-0"></i>
              <div className="flex-1 font-semibold">{errorMsg}</div>
            </div>
          )}

          {/* Top Quick Bar: Student ID & QR Preview */}
          <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
            {qrPreviewUrl ? (
              <div className="p-1 bg-white rounded-xl border border-slate-300 shadow-2xs shrink-0 text-center">
                <img src={qrPreviewUrl} alt="QR" className="w-20 h-20 rounded-lg mx-auto" />
                <span className="text-[9px] font-mono text-slate-500 font-bold block mt-0.5">
                  {studentId || 'STUDENT QR'}
                </span>
              </div>
            ) : (
              <div className="w-20 h-20 bg-slate-200 rounded-xl flex items-center justify-center text-slate-400 text-2xl shrink-0">
                <i className="fa-solid fa-qrcode"></i>
              </div>
            )}

            <div className="flex-1 w-full space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Student ID <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    required
                    placeholder="उदा. S-1083"
                    className="w-full px-3 py-2 text-xs font-mono font-bold rounded-lg border border-slate-300 focus:border-blue-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Admission No (प्रवेश सं.)
                  </label>
                  <input
                    type="text"
                    value={admissionNumber}
                    onChange={(e) => setAdmissionNumber(e.target.value)}
                    placeholder="उदा. 450"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:border-blue-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Roll No (अनुक्रमांक)
                  </label>
                  <input
                    type="text"
                    value={rollNumber}
                    onChange={(e) => setRollNumber(e.target.value)}
                    placeholder="उदा. 12"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:border-blue-900 bg-white"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">
                ✨ यह QR कोड छात्र के गेट पास और पहचान पत्र (Student ID Card) के लिए अपने आप उत्पन्न हो जाएगा।
              </p>
            </div>
          </div>

          {/* Student Name & Class */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                छात्र का नाम (Student Name) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                  <i className="fa-solid fa-user-graduate"></i>
                </span>
                <input
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  required
                  placeholder="उदा. आरव शर्मा / Aarav Sharma"
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-900/10 text-xs font-semibold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                कक्षा (Class) <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedClass}
                onChange={(e) => handleClassChange(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs font-bold bg-white"
              >
                {classKeys.map((cKey) => (
                  <option key={cKey} value={cKey}>
                    Class {getClassName(cKey)} ({cKey})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Parents Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                पिता का नाम (Father's Name)
              </label>
              <input
                type="text"
                value={fatherName}
                onChange={(e) => setFatherName(e.target.value)}
                placeholder="उदा. श्री राहुल शर्मा"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                माता का नाम (Mother's Name)
              </label>
              <input
                type="text"
                value={motherName}
                onChange={(e) => setMotherName(e.target.value)}
                placeholder="उदा. श्रीमती सुनीता शर्मा"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs"
              />
            </div>
          </div>

          {/* Mobile & Route/Village */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                अभिभावक मोबाइल (Parent Mobile)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                  <i className="fa-solid fa-phone"></i>
                </span>
                <input
                  type="tel"
                  value={parentMobile}
                  onChange={(e) => setParentMobile(e.target.value)}
                  placeholder="उदा. 9876543210"
                  maxLength={13}
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs font-mono"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                पेरेंट पोर्टल लॉगिन और WhatsApp सूचना इसी नंबर पर भेजी जाएगी।
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                गांव / बस रूट (Village / Bus Route)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-400 text-xs pointer-events-none">
                  <i className="fa-solid fa-location-dot"></i>
                </span>
                <input
                  type="text"
                  value={villageRoute}
                  onChange={(e) => setVillageRoute(e.target.value)}
                  placeholder="उदा. रामपुर / वैन रूट #2"
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Opening Balance & Photo URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                प्रारंभिक बकाया फीस (Opening Fee Due) ₹
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 text-xs font-bold pointer-events-none">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0"
                  className="w-full pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs font-mono font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                छात्र फोटो लिंक (Student Photo URL)
              </label>
              <input
                type="url"
                value={studentPhotoUrl}
                onChange={(e) => setStudentPhotoUrl(e.target.value)}
                placeholder="https://... या Google Drive फोटो लिंक"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-blue-900 text-xs"
              />
            </div>
          </div>

          {/* WhatsApp Notification Toggle */}
          <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-sm shrink-0">
                <i className="fa-brands fa-whatsapp"></i>
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-950">
                  प्रवेश के बाद अभिभावक को WhatsApp सूचना भेजें
                </div>
                <div className="text-[11px] text-emerald-800">
                  Student ID, कक्षा, और पोर्टल लॉगिन लिंक का स्वागत संदेश तैयार करेगा।
                </div>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={sendWelcomeWhatsApp}
                onChange={(e) => setSendWelcomeWhatsApp(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {/* Buttons */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleCopyRowForSheet}
              className="px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Copy row to paste directly into Google Sheet"
            >
              <i className="fa-solid fa-copy text-slate-500"></i>
              <span>{copiedRow ? '✓ पंक्ति कॉपी हो गई!' : 'Sheet पंक्ति कॉपी करें'}</span>
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold cursor-pointer transition-colors"
              >
                रद्द करें (Cancel)
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] hover:brightness-110 text-amber-300 text-xs font-extrabold rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin"></i>
                    <span>जोड़ा जा रहा है...</span>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-user-check"></i>
                    <span>छात्र सुरक्षित करें (Save Student)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
