import React from 'react';
import { Student, FeeCollectionRecord } from '../types';

interface OfficialFeeReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  student: Student | null | undefined;
  feeRecord: FeeCollectionRecord | null | undefined;
  schoolName?: string;
  managerName?: string;
}

// Convert amount number to Hindi/English words for authentic receipt
function numberToWordsINR(amount: number): string {
  if (!amount || isNaN(amount) || amount <= 0) return 'शून्य रुपये मात्र (Zero Rupees Only)';
  
  const single = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const double = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const formatTens = (num: number): string => {
    if (num === 0) return '';
    if (num < 10) return single[num];
    if (num < 20) return double[num - 10];
    return tens[Math.floor(num / 10)] + (num % 10 !== 0 ? ' ' + single[num % 10] : '');
  };

  let num = Math.floor(amount);
  let words = '';

  if (num >= 10000000) {
    words += formatTens(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  if (num >= 100000) {
    words += formatTens(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  if (num >= 1000) {
    words += formatTens(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  if (num >= 100) {
    words += formatTens(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    words += (words !== '' ? 'and ' : '') + formatTens(num) + ' ';
  }

  return words.trim() + ' Rupees Only';
}

export const OfficialFeeReceiptModal: React.FC<OfficialFeeReceiptModalProps> = ({
  isOpen,
  onClose,
  student,
  feeRecord,
  schoolName = 'E.V.S. PUBLIC SCHOOL',
  managerName = 'School Office',
}) => {
  if (!isOpen || !student || !feeRecord) return null;

  const receiptNo = feeRecord.Receipt_Number || 'REC-' + Date.now().toString().slice(-6);
  const paidAmount = Number(feeRecord.Amount_Paid || 0);
  const totalAmount = Number(feeRecord.Total_Amount || paidAmount);
  const calculatedBal = totalAmount - paidAmount;
  const rawBalance = feeRecord.Balance_Amount !== null && feeRecord.Balance_Amount !== undefined
    ? Number(feeRecord.Balance_Amount)
    : calculatedBal;
  // If paid > total, true balance is negative (advance, e.g. 600 - 700 = -100)
  const balanceAmount = (paidAmount > totalAmount && rawBalance >= 0)
    ? calculatedBal
    : rawBalance;

  const receiptDate = feeRecord.Date || new Date().toISOString().slice(0, 10);
  const paymentMode = feeRecord.Payment_Mode || 'Cash';
  const feeHead = feeRecord.Fee_Type || feeRecord.Month || 'शैक्षणिक शुल्क (School Tuition Fee)';
  const receiver = feeRecord.Received_By || managerName;

  const amountInWords = numberToWordsINR(paidAmount);

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsAppShare = () => {
    const parentMobile = String(student.Parent_Mobile || '').replace(/\D/g, '');
    const message =
      `*🏛️ ${schoolName}*\n` +
      `*आधिकारिक डिजिटल फीस रसीद (Official Fee Receipt)*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📄 *रसीद सं (Receipt #):* #${receiptNo}\n` +
      `📅 *दिनांक (Date):* ${receiptDate}\n` +
      `👤 *विद्यार्थी:* ${student.Student_Name}\n` +
      `🆔 *छात्र आईडी:* ${student.Student_ID} | *कक्षा:* ${student.Class}\n` +
      `🔢 *रोल नंबर:* ${student.Roll_Number || '1'} | *प्रवेश सं:* ${student.Admission_Number || '—'}\n` +
      `👨‍👦 *पिता का नाम:* ${student.Father_Name || '—'}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ *शुल्क विवरण:* ${feeHead}\n` +
      `💵 *कुल देय शुल्क:* ₹${totalAmount.toLocaleString('en-IN')}\n` +
      `✅ *जमा की गई राशि:* ₹${paidAmount.toLocaleString('en-IN')}\n` +
      `⚠️ *शेष बकाया राशि:* ₹${balanceAmount.toLocaleString('en-IN')}\n` +
      `💳 *भुगतान माध्यम:* ${paymentMode}\n` +
      `✍️ *प्राप्तकर्ता:* ${receiver}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `_धन्यवाद! शुल्क जमा की आधिकारिक डिजिटल रसीद।_`;

    const encoded = encodeURIComponent(message);
    const waUrl = parentMobile.length >= 10
      ? `https://wa.me/91${parentMobile.slice(-10)}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-fadeIn">
      {/* Printable Receipt Container */}
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Top Control Bar (Hidden on print) */}
        <div className="print:hidden bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] px-5 py-3.5 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black text-sm shadow-md">
              <i className="fa-solid fa-receipt"></i>
            </span>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-amber-300">
                आधिकारिक फीस रसीद (Official Fee Receipt)
              </h3>
              <p className="text-[11px] text-blue-200">
                रसीद क्रमांक: #{receiptNo} • {receiptDate}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-transform active:scale-95"
            >
              <i className="fa-solid fa-print"></i>
              <span className="hidden sm:inline">प्रिंट / PDF</span>
            </button>
            <button
              type="button"
              onClick={handleWhatsAppShare}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-transform active:scale-95"
            >
              <i className="fa-brands fa-whatsapp text-sm"></i>
              <span className="hidden sm:inline">शेयर</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
              title="बंद करें"
            >
              ✕
            </button>
          </div>
        </div>

        {/* The Official Receipt Body (Print Target) */}
        <div id="school-official-receipt-print-area" className="p-6 sm:p-8 bg-white text-slate-900 font-sans relative">
          {/* Subtle Watermark Stamp */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-4 select-none">
            <div className="text-center transform -rotate-12 border-8 border-slate-900 rounded-3xl p-8">
              <span className="text-6xl sm:text-7xl font-black tracking-widest block">E.V.S.</span>
              <span className="text-2xl font-bold tracking-wider uppercase block">PAID & VERIFIED</span>
            </div>
          </div>

          {/* School Header */}
          <div className="text-center pb-5 border-b-2 border-slate-900">
            <div className="inline-block p-1 bg-amber-400 rounded-2xl mb-2 shadow-xs">
              <div className="w-12 h-12 bg-[#0c2340] rounded-xl flex items-center justify-center text-amber-300 font-black text-xl border border-amber-300">
                <i className="fa-solid fa-graduation-cap"></i>
              </div>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#0c2340] tracking-tight uppercase">
              {schoolName}
            </h1>
            <p className="text-xs sm:text-sm font-semibold text-slate-600 mt-0.5">
              Knowledge • Discipline • Character Building
            </p>
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-[11px] font-bold text-slate-700 border border-slate-300">
              <span>आधिकारिक छात्र फीस रसीद (STUDENT FEE RECEIPT)</span>
            </div>
          </div>

          {/* Receipt Meta & Student Info Grid */}
          <div className="mt-5 grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <div>
                <span className="text-slate-500 font-medium">रसीद सं. (Receipt No):</span>{' '}
                <strong className="font-mono text-blue-900 font-bold">#{receiptNo}</strong>
              </div>
              <div>
                <span className="text-slate-500 font-medium">दिनांक (Date):</span>{' '}
                <strong className="text-slate-900">{receiptDate}</strong>
              </div>
              <div>
                <span className="text-slate-500 font-medium">भुगतान माध्यम (Mode):</span>{' '}
                <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-800 border border-slate-300">
                  {paymentMode}
                </span>
              </div>
            </div>

            <div className="space-y-1.5 text-right sm:text-left">
              <div>
                <span className="text-slate-500 font-medium">छात्र का नाम (Student):</span>{' '}
                <strong className="text-slate-900 text-sm font-black">{student.Student_Name}</strong>
              </div>
              <div>
                <span className="text-slate-500 font-medium">कक्षा (Class):</span>{' '}
                <strong className="text-blue-900 font-bold">{student.Class}</strong>
                {student.Roll_Number && (
                  <span className="text-slate-600 ml-1">
                    • रोल नं: <strong>{student.Roll_Number}</strong>
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500 font-medium">छात्र आईडी (ID):</span>{' '}
                <strong className="font-mono text-slate-800">{student.Student_ID}</strong>
                {student.Admission_Number && (
                  <span className="text-slate-600 ml-1">
                    • प्रवेश सं: <strong>{student.Admission_Number}</strong>
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500 font-medium">पिता का नाम (Father):</span>{' '}
                <strong className="text-slate-800">{student.Father_Name || '—'}</strong>
              </div>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="mt-6 border border-slate-300 rounded-2xl overflow-hidden shadow-2xs">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#0c2340] text-white">
                <tr>
                  <th className="p-3 font-bold">क्र. (S.No.)</th>
                  <th className="p-3 font-bold">शुल्क विवरण (Fee Description / Head)</th>
                  <th className="p-3 font-bold">अवधि (Period)</th>
                  <th className="p-3 font-bold text-right">कुल शुल्क (Total)</th>
                  <th className="p-3 font-bold text-right">जमा राशि (Paid)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr className="bg-white">
                  <td className="p-3 font-medium text-slate-600">1.</td>
                  <td className="p-3 font-bold text-slate-900">
                    {feeHead}
                  </td>
                  <td className="p-3 text-slate-600">
                    {feeRecord.Month || 'Current Academic Session'}
                  </td>
                  <td className="p-3 text-right font-medium text-slate-700">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </td>
                  <td className="p-3 text-right font-black text-emerald-800 text-sm">
                    ₹{paidAmount.toLocaleString('en-IN')}
                  </td>
                </tr>
              </tbody>
              <tfoot className="bg-slate-50 divide-y divide-slate-200 font-bold">
                <tr>
                  <td colSpan={4} className="p-2.5 text-right text-slate-700">
                    जमा की गई राशि (Total Amount Paid):
                  </td>
                  <td className="p-2.5 text-right text-emerald-900 font-black text-base">
                    ₹{paidAmount.toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="p-2.5 text-right text-slate-700">
                    {balanceAmount < 0 ? 'अग्रिम जमा राशि (Advance Paid Balance):' : 'शेष बकाया राशि (Remaining Due Balance):'}
                  </td>
                  <td className={`p-2.5 text-right font-black text-sm ${balanceAmount < 0 ? 'text-purple-700' : balanceAmount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {balanceAmount < 0
                      ? `-₹${Math.abs(balanceAmount).toLocaleString('en-IN')}`
                      : `₹${balanceAmount.toLocaleString('en-IN')}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Amount In Words */}
          <div className="mt-4 p-3 bg-amber-50/80 rounded-xl border border-amber-200 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="font-bold text-amber-900">शब्दों में (Amount in words): </span>
              <span className="italic font-semibold">{amountInWords}</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-600 text-white font-extrabold text-[10px] uppercase shrink-0 self-start sm:self-auto">
              ✓ शुल्क प्राप्त (PAID)
            </span>
          </div>

          {/* Footer & Signature Box */}
          <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-slate-600">
            <div className="space-y-1 text-center sm:text-left">
              <p className="font-semibold text-slate-800">
                प्राप्तकर्ता: <span className="font-bold text-blue-900">{receiver}</span>
              </p>
              <p className="text-[10px] text-slate-500">
                यह एक कम्प्यूटरीकृत रसीद है। किसी भी प्रश्न के लिए स्कूल कार्यालय से संपर्क करें।
              </p>
            </div>

            <div className="text-center shrink-0">
              <div className="w-36 border-b border-dashed border-slate-400 mb-1"></div>
              <span className="font-bold text-[11px] text-slate-900 uppercase tracking-wider block">
                अधिकृत हस्ताक्षर
              </span>
              <span className="text-[9px] text-slate-500 block">
                (Authorized Signatory / Stamp)
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Actions Bar (Hidden on print) */}
        <div className="print:hidden bg-slate-50 px-6 py-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <i className="fa-solid fa-circle-info text-blue-900"></i>
            <span>प्रिंट बटन से आप इस रसीद को सीधे प्रिंट या PDF में सेव कर सकते हैं।</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleWhatsAppShare}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <i className="fa-brands fa-whatsapp text-sm"></i>
              <span>WhatsApp पर भेजें</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <i className="fa-solid fa-print"></i>
              <span>प्रिंट / PDF सेव करें</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold cursor-pointer"
            >
              बंद करें
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
