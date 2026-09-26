import React, { useState } from 'react';
import { StudentRecordForScan } from './StudentQRScannerModal';

export interface StudentBehaviorInput {
  Behavior_ID?: string;
  Student_ID: string;
  Student_Name?: string;
  Date: string;
  Class?: string;
  Is_Present: boolean;
  Is_Bathed: boolean;
  Nails_Clean: boolean;
  Uniform_clean: boolean;
  Good_Manners: string;
  Discipline: boolean;
  Remark: string;
  Teacher_Name?: string;
}

interface StudentBehaviorModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: StudentRecordForScan | null;
  onSaveBehavior: (record: StudentBehaviorInput, sendWhatsApp: boolean) => void;
  teacherName?: string;
  getClassName?: (c?: string) => string;
  getStudentPhoto?: (s: StudentRecordForScan) => string;
}

const QUICK_REMARKS = [
  'कक्षा में बहुत अच्छा आचरण व अनुशासन रहा।',
  'आज पढ़ाई में पूरा ध्यान दिया और सवाल पूछे।',
  'ड्रेस साफ़ व स्वच्छ थी, नाखून कटे हुए थे।',
  'समय पर गृहकार्य पूरा किया। शाबाश!',
  'कक्षा में ध्यान कम था, गृहकार्य अधूरा है।',
  'अनुशासन व समय की पाबंदी में सुधार आवश्यक है।',
  'यूनिफॉर्म व स्वच्छता पर विशेष ध्यान दें।',
];

const ABSENCE_QUICK_REMARKS = [
  'आज छात्र विद्यालय में अनुपस्थित रहा।',
  'बीमारी / अस्वस्थ होने के कारण अनुपस्थित।',
  'पारिवारिक कार्य हेतु अवकाश पर है।',
  'बिना पूर्व सूचना के अनुपस्थित रहा।',
  'अभिभावक द्वारा अवकाश आवेदन प्राप्त।',
];

export const StudentBehaviorModal: React.FC<StudentBehaviorModalProps> = ({
  isOpen,
  onClose,
  student,
  onSaveBehavior,
  teacherName = 'Teacher',
  getClassName = (c) => c || 'N/A',
  getStudentPhoto = (_s?: any) => '',
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState<string>(todayStr);
  const [isPresent, setIsPresent] = useState<boolean>(true);
  const [isBathed, setIsBathed] = useState<boolean>(true);
  const [nailsClean, setNailsClean] = useState<boolean>(true);
  const [uniformClean, setUniformClean] = useState<boolean>(true);
  const [goodManners, setGoodManners] = useState<string>('उत्कृष्ट (Excellent)');
  const [discipline, setDiscipline] = useState<boolean>(true);
  const [remark, setRemark] = useState<string>('कक्षा में बहुत अच्छा आचरण व अनुशासन रहा।');
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  if (!isOpen || !student) return null;

  const handleAttendanceChange = (present: boolean) => {
    setIsPresent(present);
    if (!present) {
      // If switching to Absent: clear conduct praise and set absent remark
      if (
        remark === 'कक्षा में बहुत अच्छा आचरण व अनुशासन रहा।' ||
        QUICK_REMARKS.includes(remark)
      ) {
        setRemark('आज छात्र विद्यालय में अनुपस्थित रहा।');
      }
    } else {
      // If switching back to Present: set back default conduct remark
      if (
        remark === 'आज छात्र विद्यालय में अनुपस्थित रहा।' ||
        ABSENCE_QUICK_REMARKS.includes(remark)
      ) {
        setRemark('कक्षा में बहुत अच्छा आचरण व अनुशासन रहा।');
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const record: StudentBehaviorInput = {
      Behavior_ID: `BEH-${Date.now().toString().slice(-6)}`,
      Student_ID: String(student.Student_ID || ''),
      Student_Name: student.Student_Name,
      Date: date,
      Class: student.Class,
      Is_Present: isPresent,
      // If student is absent, NO conduct is filled/saved
      Is_Bathed: isPresent ? isBathed : false,
      Nails_Clean: isPresent ? nailsClean : false,
      Uniform_clean: isPresent ? uniformClean : false,
      Good_Manners: isPresent ? goodManners : 'लागू नहीं (अनुपस्थित)',
      Discipline: isPresent ? discipline : false,
      Remark: remark.trim() || (isPresent ? 'सामान्य' : 'आज छात्र विद्यालय में अनुपस्थित रहा।'),
      Teacher_Name: teacherName,
    };

    onSaveBehavior(record, sendWhatsApp);

    // If WhatsApp requested, generate and trigger WhatsApp message
    if (sendWhatsApp && student.Parent_Mobile) {
      const cleanPhone = String(student.Parent_Mobile).replace(/[^0-9]/g, '');
      const phoneToUse = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

      let msg = '';
      if (!isPresent) {
        // WhatsApp message for Absent Student (No conduct details)
        msg = `🏫 *ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)*\n` +
          `📢 *दैनिक छात्र अनुपस्थिति सूचना (Daily Attendance Alert)*\n\n` +
          `👤 *छात्र:* ${student.Student_Name} (ID: ${student.Student_ID || '—'})\n` +
          `🎓 *कक्षा:* ${getClassName(student.Class)} | *तारीख:* ${date}\n\n` +
          `• *हाजिरी स्थिति:* ❌ अनुपस्थित (Absent)\n` +
          `• *विवरण:* छात्र आज विद्यालय में उपस्थित नहीं हुआ है। अतः विद्यालय आचरण व स्वच्छता मूल्यांकन लागू नहीं है।\n` +
          (remark.trim() ? `• *टिप्पणी/कारण:* ${remark.trim()}\n\n` : '\n') +
          `👨‍🏫 *दर्जकर्ता:* ${teacherName}\n` +
          `_ई.वी.एस. पब्लिक स्कूल_`;
      } else {
        // WhatsApp message for Present Student with Conduct Breakdown
        const attendanceText = 'उपस्थित (Present) ✅';
        const mannersText = goodManners;
        const hygieneText = `${isBathed ? 'स्नान: हाँ ✅' : 'स्नान: नहीं ❌'} | ${uniformClean ? 'ड्रेस: साफ़ ✅' : 'ड्रेस: गंदी ❌'} | ${nailsClean ? 'नाखून: कटे ✅' : 'नाखून: बड़े ❌'}`;

        msg = `🏫 *ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)*\n` +
          `📋 *दैनिक छात्र आचरण व अनुशासन रिपोर्ट (Daily Conduct Report)*\n\n` +
          `👤 *छात्र:* ${student.Student_Name} (ID: ${student.Student_ID || '—'})\n` +
          `🎓 *कक्षा:* ${getClassName(student.Class)} | *तारीख:* ${date}\n\n` +
          `• *हाजिरी:* ${attendanceText}\n` +
          `• *आचरण व शिष्टाचार:* ${mannersText}\n` +
          `• *अनुशासन:* ${discipline ? 'संतोषजनक व उत्तम (Good) 👍' : 'सुधार अपेक्षित (Needs Attention) ⚠️'}\n` +
          `• *दैनिक स्वच्छता:* ${hygieneText}\n` +
          (remark ? `• *शिक्षक टिप्पणी:* ${remark}\n\n` : '\n') +
          `👨‍🏫 *शिक्षक:* ${teacherName}\n` +
          `धन्यवाद!`;
      }

      const encoded = encodeURIComponent(msg);
      window.open(`https://wa.me/${phoneToUse}?text=${encoded}`, '_blank');
    }

    setSaveSuccess(true);
    setTimeout(() => {
      setIsSaving(false);
      setSaveSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-4 py-3.5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-base shadow-xs shrink-0">
              <i className="fa-solid fa-star"></i>
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber-300 leading-tight">
                छात्र आचरण व अनुशासन दर्ज करें (Student Behavior & Conduct)
              </h3>
              <p className="text-[11px] text-slate-300">
                उपस्थिति, शिष्टाचार, दैनिक स्वच्छता एवं शिक्षक रिमार्क
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Student Info Bar */}
        <div className="bg-amber-50/70 border-b border-amber-200/80 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {getStudentPhoto(student) ? (
              <img
                src={getStudentPhoto(student)}
                alt={student.Student_Name}
                className="w-10 h-10 rounded-full object-cover border border-amber-300 shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-sm shrink-0">
                {(student.Student_Name || 'S').slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <h4 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                {student.Student_Name}
              </h4>
              <p className="text-[11px] text-slate-600 truncate">
                Class: <span className="font-semibold text-blue-900">{getClassName(student.Class)}</span>
                {student.Roll_Number ? ` • Roll: ${student.Roll_Number}` : ''}
                {student.Student_ID ? ` • ID: ${student.Student_ID}` : ''}
              </p>
            </div>
          </div>
          {student.Parent_Mobile && (
            <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shrink-0">
              <i className="fa-solid fa-phone text-[10px] mr-1"></i>
              {student.Parent_Mobile}
            </span>
          )}
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-4 overflow-y-auto space-y-4 text-xs flex-1">
          {/* Date & Attendance */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">तारीख (Date):</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-blue-800 bg-white"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">हाजिरी (Attendance):</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-300">
                <button
                  type="button"
                  onClick={() => handleAttendanceChange(true)}
                  className={`flex-1 py-1.5 font-bold text-center cursor-pointer transition-colors ${
                    isPresent ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ✓ उपस्थित (Present)
                </button>
                <button
                  type="button"
                  onClick={() => handleAttendanceChange(false)}
                  className={`flex-1 py-1.5 font-bold text-center cursor-pointer transition-colors ${
                    !isPresent ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  ✕ अनुपस्थित (Absent)
                </button>
              </div>
            </div>
          </div>

          {/* IF ABSENT: NO conduct fields should be shown or filled */}
          {!isPresent ? (
            <div className="space-y-3.5 animate-fadeIn">
              <div className="bg-rose-50 border-2 border-rose-200 rounded-xl p-4 text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-full bg-rose-100 text-rose-600 flex items-center justify-center text-xl shadow-xs">
                  <i className="fa-solid fa-user-xmark"></i>
                </div>
                <div>
                  <h4 className="font-bold text-rose-950 text-sm">
                    छात्र आज अनुपस्थित (Absent) है
                  </h4>
                  <p className="text-xs text-rose-700 max-w-sm mx-auto mt-1 leading-relaxed">
                    छात्र अनुपस्थित होने के कारण विद्यालय आचरण, दैनिक स्वच्छता, ड्रेस, नाखून व अनुशासन का कोई भी विवरण नहीं भरा जाएगा। केवल अनुपस्थिति दर्ज की जाएगी।
                  </p>
                </div>
              </div>

              {/* Absence Reason / Remark (Optional) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    अनुपस्थिति की टिप्पणी / कारण (Reason / Remark - Optional):
                  </label>
                  <span className="text-[10px] text-slate-400">क्लिक करके सीधे जोड़ें</span>
                </div>
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="उदा. बुखार / बीमारी, पारिवारिक कार्य, बिना पूर्व सूचना अनुपस्थित..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-rose-800 bg-white outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {ABSENCE_QUICK_REMARKS.map((qr, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setRemark(qr)}
                      className="text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full border border-rose-200 transition-colors cursor-pointer text-left"
                    >
                      + {qr}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* IF PRESENT: Only then conduct, hygiene, uniform, manners and discipline are filled */
            <div className="space-y-4 animate-fadeIn">
              {/* Daily Hygiene Checkmarks */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                <h5 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fa-solid fa-sparkles text-amber-500"></i>
                  दैनिक स्वच्छता एवं वेशभूषा (Hygiene & Uniform)
                </h5>
                <div className="grid grid-cols-3 gap-2">
                  {/* Bathed */}
                  <button
                    type="button"
                    onClick={() => setIsBathed(!isBathed)}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      isBathed ? 'bg-blue-50 border-blue-400 text-blue-900 font-bold' : 'bg-white border-slate-300 text-slate-500'
                    }`}
                  >
                    <i className={`fa-solid ${isBathed ? 'fa-circle-check text-blue-600' : 'fa-circle-xmark text-slate-400'} block text-base mb-1`}></i>
                    <span>स्नान (Bathed)</span>
                  </button>

                  {/* Uniform */}
                  <button
                    type="button"
                    onClick={() => setUniformClean(!uniformClean)}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      uniformClean ? 'bg-emerald-50 border-emerald-400 text-emerald-900 font-bold' : 'bg-white border-slate-300 text-slate-500'
                    }`}
                  >
                    <i className={`fa-solid ${uniformClean ? 'fa-shirt text-emerald-600' : 'fa-circle-xmark text-slate-400'} block text-base mb-1`}></i>
                    <span>साफ़ ड्रेस (Uniform)</span>
                  </button>

                  {/* Nails */}
                  <button
                    type="button"
                    onClick={() => setNailsClean(!nailsClean)}
                    className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                      nailsClean ? 'bg-indigo-50 border-indigo-400 text-indigo-900 font-bold' : 'bg-white border-slate-300 text-slate-500'
                    }`}
                  >
                    <i className={`fa-solid ${nailsClean ? 'fa-hand text-indigo-600' : 'fa-circle-xmark text-slate-400'} block text-base mb-1`}></i>
                    <span>साफ़ नाखून (Nails)</span>
                  </button>
                </div>
              </div>

              {/* Conduct & Discipline */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">शिष्टाचार (Good Manners):</label>
                  <select
                    value={goodManners}
                    onChange={(e) => setGoodManners(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-blue-800 bg-white"
                  >
                    <option value="उत्कृष्ट (Excellent)">उत्कृष्ट (Excellent) ⭐⭐⭐</option>
                    <option value="अच्छा (Good)">अच्छा (Good) ⭐⭐</option>
                    <option value="संतोषजनक (Satisfactory)">संतोषजनक (Satisfactory)</option>
                    <option value="सुधार अपेक्षित (Needs Improvement)">सुधार अपेक्षित (Needs Improvement) ⚠️</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">अनुशासन (Discipline):</label>
                  <div className="flex rounded-lg overflow-hidden border border-slate-300">
                    <button
                      type="button"
                      onClick={() => setDiscipline(true)}
                      className={`flex-1 py-1.5 font-bold text-center cursor-pointer transition-colors ${
                        discipline ? 'bg-blue-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      ✓ अनुशासित (Good)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscipline(false)}
                      className={`flex-1 py-1.5 font-bold text-center cursor-pointer transition-colors ${
                        !discipline ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      ✕ अनियंत्रित (Fault)
                    </button>
                  </div>
                </div>
              </div>

              {/* Remark & Quick Chips */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">शिक्षक टिप्पणी / रिमार्क (Teacher Remark):</label>
                  <span className="text-[10px] text-slate-400">क्लिक करके सीधे जोड़ें</span>
                </div>
                <textarea
                  rows={2}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="छात्र के आचरण, पढ़ाई या अनुशासन पर अपनी टिप्पणी दर्ज करें..."
                  className="w-full p-2 rounded-lg border border-slate-300 text-xs focus:ring-1 focus:ring-blue-800 bg-white outline-none"
                />
                {/* Quick remark chips */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {QUICK_REMARKS.map((qr, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setRemark(qr)}
                      className="text-[10px] bg-slate-100 hover:bg-amber-100 text-slate-700 hover:text-slate-900 px-2 py-0.5 rounded-full border border-slate-200 transition-colors cursor-pointer text-left"
                    >
                      + {qr}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp Toggle */}
          {student.Parent_Mobile && (
            <div className={`p-2.5 rounded-xl flex items-center justify-between border ${
              !isPresent ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'
            }`}>
              <div className="flex items-center gap-2">
                <i className={`fa-brands fa-whatsapp text-base ${!isPresent ? 'text-rose-600' : 'text-emerald-600'}`}></i>
                <div>
                  <span className={`font-bold text-[11px] block ${!isPresent ? 'text-rose-950' : 'text-emerald-950'}`}>
                    {!isPresent ? 'अभिभावक को WhatsApp पर अनुपस्थिति की सूचना भेजें' : 'अभिभावक को WhatsApp पर आचरण रिपोर्ट भेजें'}
                  </span>
                  <span className={`text-[10px] ${!isPresent ? 'text-rose-800' : 'text-emerald-800'}`}>
                    मोबाइल: {student.Parent_Mobile} पर संदेश भेजा जाएगा
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                className={`w-4 h-4 rounded cursor-pointer ${!isPresent ? 'accent-rose-600' : 'text-emerald-600'}`}
              />
            </div>
          )}

          {/* Submit Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 cursor-pointer"
            >
              रद्द करें
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className={`px-5 py-2 rounded-lg font-bold shadow-md transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50 ${
                !isPresent
                  ? 'bg-rose-700 text-white hover:bg-rose-800'
                  : 'bg-[#0c2340] text-amber-300 hover:bg-blue-950'
              }`}
            >
              {saveSuccess ? (
                <>
                  <i className="fa-solid fa-circle-check text-emerald-300"></i>
                  <span>सफलतापूर्वक दर्ज हुआ!</span>
                </>
              ) : isSaving ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  <span>सहेज रहे हैं...</span>
                </>
              ) : !isPresent ? (
                <>
                  <i className="fa-solid fa-user-xmark"></i>
                  <span>अनुपस्थिति दर्ज करें</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-floppy-disk"></i>
                  <span>आचरण दर्ज करें</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
