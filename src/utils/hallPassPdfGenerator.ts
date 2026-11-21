import { jsPDF } from 'jspdf';
import { HallPassConfig } from '../types';
import {
  chunkIntoPages,
  getClassExamFee,
  getExamDisplayTitle,
  getStudentDatesheetSchedule,
  mapPageSlotsForBackside,
  resolveDatesheetClassKey,
  resolveHallPassLayout,
  StudentHallPassEligibility,
} from './hallPassHelper';

export type HallPassPdfMode = 'front' | 'back' | 'duplex';

interface GenerateHallPassPdfOptions {
  items: StudentHallPassEligibility[];
  config: HallPassConfig;
  mode: HallPassPdfMode;
  getClassName: (cls?: string | null) => string;
  getStudentPhoto: (student: StudentHallPassEligibility['student']) => string;
  qrMap: Record<string, string>;
  showCutBorder: boolean;
  showClassOnCard: boolean;
}

const NAVY: [number, number, number] = [12, 35, 64];
const AMBER: [number, number, number] = [251, 191, 36];
const AMBER_TEXT: [number, number, number] = [253, 224, 71];
const LIGHT_BLUE_TEXT: [number, number, number] = [219, 234, 254];
const SLATE_50: [number, number, number] = [248, 250, 252];
const SLATE_100: [number, number, number] = [241, 245, 249];
const SLATE_300: [number, number, number] = [203, 213, 225];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_700: [number, number, number] = [51, 65, 85];
const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];
const EMERALD_BG: [number, number, number] = [220, 252, 231];
const EMERALD_DARK: [number, number, number] = [6, 95, 70];

const getInitials = (name?: string): string => {
  const parts = String(name || 'EVS').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'S';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatShortDate = (d: string): string => {
  const clean = String(d || '').trim();
  const m = clean.match(/^(\d{2}\/\d{2})\/\d{4}$/);
  return m ? m[1] : clean;
};

const toWinAnsiSafe = (text: string): string =>
  String(text || '')
    .replace(/₹/g, 'Rs.')
    .replace(/[✓✔]/g, 'OK')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Truncates text cleanly with ellipsis so it never overflows card width inside jsPDF.
 */
const fitText = (doc: jsPDF, text: string, maxWidthMm: number): string => {
  const clean = toWinAnsiSafe(text);
  if (!clean) return '';
  if (doc.getTextWidth(clean) <= maxWidthMm) return clean;
  let lo = 0;
  let hi = clean.length;
  const ell = '...';
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(clean.slice(0, mid) + ell) <= maxWidthMm) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo > 0 ? clean.slice(0, lo) + ell : clean.slice(0, 1);
};

/**
 * Convert a photo URL / dataURL to a cropped 17:21 JPEG dataURL for fast crisp PDF embedding.
 * Fails gracefully to null if external host blocks CORS so PDF export never aborts.
 */
const loadPhotoAsJpegDataUrl = (url?: string): Promise<string | null> => {
  const clean = String(url || '').trim();
  if (!clean) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 2500);
    const img = new Image();
    if (!clean.startsWith('data:') && !clean.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      clearTimeout(timer);
      try {
        const targetW = 170;
        const targetH = 210;
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        // Object-cover center crop
        const srcRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
        const dstRatio = targetW / targetH;
        let sx = 0;
        let sy = 0;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        if (srcRatio > dstRatio) {
          sw = img.naturalHeight * dstRatio;
          sx = (img.naturalWidth - sw) / 2;
        } else {
          sh = img.naturalWidth / dstRatio;
          sy = (img.naturalHeight - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = clean;
  });
};

const drawExamPaidStatusBox = (
  doc: jsPDF,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  isPaid: boolean,
  isCompact: boolean = false
) => {
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.setFillColor(...(isPaid ? EMERALD_BG : WHITE));
  doc.rect(boxX, boxY, boxW, boxH, 'FD');

  if (isPaid) {
    doc.setTextColor(...SLATE_700);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isCompact ? 5.0 : 5.5);
    doc.text('Paid / Status:', boxX + 1.5, boxY + (isCompact ? 2.5 : 3.1));

    const cbSize = isCompact ? 3.2 : 3.8;
    const cbX = boxX + 1.6;
    const cbY = boxY + boxH - cbSize - (isCompact ? 0.8 : 1.3);
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...EMERALD_DARK);
    doc.setLineWidth(0.4);
    doc.rect(cbX, cbY, cbSize, cbSize, 'FD');

    // Vector checkmark inside checkbox (avoids WinAnsi glyph loss)
    doc.setDrawColor(...EMERALD_DARK);
    doc.setLineWidth(0.55);
    doc.line(cbX + cbSize * 0.2, cbY + cbSize * 0.54, cbX + cbSize * 0.43, cbY + cbSize * 0.78);
    doc.line(cbX + cbSize * 0.43, cbY + cbSize * 0.78, cbX + cbSize * 0.82, cbY + cbSize * 0.22);

    doc.setTextColor(...EMERALD_DARK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isCompact ? 7.6 : 8.8);
    doc.text('PAID', cbX + cbSize + 1.6, cbY + cbSize - (isCompact ? 0.35 : 0.45));
  } else {
    doc.setTextColor(...SLATE_500);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isCompact ? 5.0 : 5.5);
    doc.text('Paid / Status (Teacher):', boxX + 1.5, boxY + (isCompact ? 2.5 : 3.1));

    const cbSize = isCompact ? 2.9 : 3.4;
    const cbX = boxX + 1.6;
    const cbY = boxY + boxH - cbSize - (isCompact ? 0.8 : 1.3);
    doc.setFillColor(...WHITE);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.35);
    doc.rect(cbX, cbY, cbSize, cbSize, 'FD');

    doc.setTextColor(...SLATE_700);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isCompact ? 6.0 : 6.6);
    doc.text('Paid', cbX + cbSize + 1.1, cbY + cbSize - (isCompact ? 0.4 : 0.5));

    const lineStartX = cbX + cbSize + (isCompact ? 6.6 : 7.2);
    const lineEndX = boxX + boxW - 1.5;
    if (lineEndX > lineStartX + 3) {
      doc.setDrawColor(...SLATE_500);
      doc.setLineWidth(0.25);
      doc.line(lineStartX, boxY + boxH - (isCompact ? 0.9 : 1.4), lineEndX, boxY + boxH - (isCompact ? 0.9 : 1.4));
    }
  }
};

const drawFrontSlot = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  item: StudentHallPassEligibility,
  config: HallPassConfig,
  classNameLabel: string,
  photoDataUrl: string | null,
  qrDataUrl: string | undefined,
  showCutBorder: boolean,
  showClassOnCard: boolean
) => {
  const { student } = item;
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);

  if (showCutBorder) {
    doc.setDrawColor(...SLATE_500);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.rect(x, y, w, h, 'S');
    doc.setLineDashPattern([], 0);
  }

  const inset = showCutBorder ? 0.8 : 0.2;
  const cx = x + inset;
  const cy = y + inset;
  const cw = w - inset * 2;
  const ch = h - inset * 2;

  // White background + main navy card border
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.5);
  doc.rect(cx, cy, cw, ch, 'FD');

  // TOP HEADER BLOCK (Enlarged bold dark header)
  const headerH = 17.2;
  doc.setFillColor(...NAVY);
  doc.rect(cx, cy, cw, headerH, 'F');

  // Amber bottom accent strip under header
  doc.setFillColor(...AMBER);
  doc.rect(cx, cy + headerH - 0.9, cw, 0.9, 'F');

  // HALL PASS yellow badge (top-right)
  const badgeW = 16.5;
  const badgeH = 4.6;
  const badgeX = cx + cw - badgeW - 2.0;
  const badgeY = cy + 2.0;
  doc.setFillColor(...AMBER);
  doc.rect(badgeX, badgeY, badgeW, badgeH, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.0);
  doc.text('HALL PASS', badgeX + badgeW / 2, badgeY + 3.2, { align: 'center' });

  // School Name (larger)
  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.4);
  doc.text(fitText(doc, 'E.V.S. PUBLIC SCHOOL', cw - badgeW - 6.0), cx + 2.2, cy + 5.6);

  // Address (larger)
  doc.setTextColor(...LIGHT_BLUE_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text('Chilkana Sultanpur, Saharanpur (U.P.)', cx + 2.2, cy + 9.4);

  // Thin divider inside header
  doc.setDrawColor(90, 115, 145);
  doc.setLineWidth(0.2);
  doc.line(cx + 2.2, cy + 11.2, cx + cw - 2.2, cy + 11.2);

  // Exam title + session
  doc.setTextColor(...AMBER_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.text(fitText(doc, examTitle, cw - 17), cx + 2.2, cy + 14.8);

  doc.setTextColor(...WHITE);
  doc.setFontSize(7.8);
  doc.text(String(config.session || '2026-27'), cx + cw - 2.2, cy + 14.8, { align: 'right' });

  // BODY TOP: PHOTO + STUDENT DETAILS
  const padX = 2.3;
  const bodyX = cx + padX;
  const bodyW = cw - padX * 2;
  const photoY = cy + headerH + 2.2;
  const photoW = 18.0;
  const photoH = 23.0;

  doc.setFillColor(...SLATE_100);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(bodyX, photoY, photoW, photoH, 'FD');

  if (photoDataUrl) {
    try {
      doc.addImage(photoDataUrl, 'JPEG', bodyX + 0.3, photoY + 0.3, photoW - 0.6, photoH - 0.6);
    } catch {
      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(getInitials(student.Student_Name), bodyX + photoW / 2, photoY + photoH / 2 + 1.5, {
        align: 'center',
      });
    }
  } else {
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(getInitials(student.Student_Name), bodyX + photoW / 2, photoY + photoH / 2 + 1.5, {
      align: 'center',
    });
  }

  // Right Identity Column (Highlighted Student Name & Highlighted School ID)
  const infoX = bodyX + photoW + 2.2;
  const infoW = bodyW - photoW - 2.2;

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.2);
  const nameLines = doc.splitTextToSize(String(student.Student_Name || '').toUpperCase(), infoW).slice(0, 2);
  doc.text(nameLines, infoX, photoY + 3.8);

  const fatherY = photoY + (nameLines.length > 1 ? 10.6 : 7.4);
  doc.setTextColor(...SLATE_700);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text(fitText(doc, `S/o · D/o ${student.Father_Name || '—'}`, infoW), infoX, fatherY);

  // Highlighted SCHOOL ID (amber-100 + thick navy border) & ROLL NO Boxes
  const boxY = photoY + photoH - 9.8;
  const boxGap = 1.6;
  const idBoxW = infoW * 0.57;
  const rollBoxW = infoW - idBoxW - boxGap;
  const boxH = 9.4;

  // SCHOOL ID Highlighted Box
  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.55);
  doc.rect(infoX, boxY, idBoxW, boxH, 'FD');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.text('SCHOOL ID', infoX + 1.2, boxY + 2.7);
  doc.setTextColor(...BLACK);
  doc.setFontSize(11.0);
  doc.text(fitText(doc, String(student.Student_ID || '—'), idBoxW - 2.0), infoX + 1.2, boxY + 7.8);

  // ROLL NO Box
  const rollBoxX = infoX + idBoxW + boxGap;
  doc.setFillColor(...SLATE_50);
  doc.setLineWidth(0.38);
  doc.rect(rollBoxX, boxY, rollBoxW, boxH, 'FD');
  doc.setTextColor(...SLATE_500);
  doc.setFontSize(5.5);
  doc.text('ROLL NO.', rollBoxX + 1.1, boxY + 2.7);
  doc.setTextColor(...BLACK);
  doc.setFontSize(9.5);
  doc.text(fitText(doc, String(student.Roll_Number || '—'), rollBoxW - 1.8), rollBoxX + 1.1, boxY + 7.6);

  let nextY = photoY + photoH + 2.4;
  if (showClassOnCard) {
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);
    doc.text(fitText(doc, `Class: ${classNameLabel}`, bodyW), bodyX, nextY + 1.4);
    nextY += 4.0;
  }

  // EXAM FEE + TEACHER WRITE-IN PAID/STATUS BOX
  const feeBoxH = 10.2;
  const examFeeAmount =
    typeof item.examFee === 'number' && !isNaN(item.examFee)
      ? item.examFee
      : getClassExamFee(student.Class);
  const examFeeText = `Rs. ${examFeeAmount.toLocaleString('en-IN')}`;
  const feeLeftW = bodyW * 0.42;

  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(bodyX, nextY, feeLeftW, feeBoxH, 'FD');

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.text('EXAM FEE', bodyX + 1.5, nextY + 3.4);

  doc.setTextColor(...BLACK);
  doc.setFontSize(10.0);
  doc.text(fitText(doc, examFeeText, feeLeftW - 2.6), bodyX + 1.5, nextY + 8.1);

  // Right Box: Auto Paid Checkmark OR Empty Teacher Checkbox + Write-In Line
  drawExamPaidStatusBox(
    doc,
    bodyX + feeLeftW,
    nextY,
    bodyW - feeLeftW,
    feeBoxH,
    Boolean(item.isExamFeePaid),
    false
  );

  // Exam Timing Schedule line
  const schedY = nextY + feeBoxH + 4.4;
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text(
    fitText(doc, config.examScheduleLine || 'Exam: 09:30 AM - 12:00 PM (2.5 Hrs)', bodyW),
    bodyX,
    schedY
  );
  doc.setDrawColor(...SLATE_300);
  doc.setLineWidth(0.25);
  doc.line(bodyX, schedY + 1.6, bodyX + bodyW, schedY + 1.6);

  // BOTTOM ROW: LARGE QR CODE + INSTRUCTIONS + PRINCIPAL SIGN
  const qrSize = 22.0;
  const qrY = cy + ch - qrSize - 2.3;
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(bodyX, qrY, qrSize, qrSize, 'FD');

  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', bodyX + 0.6, qrY + 0.6, qrSize - 1.2, qrSize - 1.2);
    } catch {}
  }

  // Instructions next to QR
  const instX = bodyX + qrSize + 2.0;
  const signW = 19.5;
  const instW = bodyW - qrSize - signW - 3.5;
  doc.setTextColor(...SLATE_700);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  const instLines = doc.splitTextToSize(
    config.instructionLine || 'Bring Hall Pass, School ID & stationery daily.',
    Math.max(12, instW)
  );
  doc.text(instLines.slice(0, 4), instX, qrY + 4.5);

  // Principal Signature bottom-right
  const signX1 = cx + cw - padX - signW;
  const signX2 = cx + cw - padX;
  const signLineY = cy + ch - 5.2;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.line(signX1, signLineY, signX2, signLineY);
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text('Principal Sign.', (signX1 + signX2) / 2, signLineY + 2.8, { align: 'center' });
};

const drawBackDatesheetSlot = (
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  item: StudentHallPassEligibility,
  config: HallPassConfig,
  classNameLabel: string,
  showCutBorder: boolean
) => {
  const { student } = item;
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const classKey = resolveDatesheetClassKey(student.Class, classNameLabel);
  const rows = getStudentDatesheetSchedule(config, student.Class, classNameLabel);

  if (showCutBorder) {
    doc.setDrawColor(...SLATE_500);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.rect(x, y, w, h, 'S');
    doc.setLineDashPattern([], 0);
  }

  const inset = showCutBorder ? 0.8 : 0.2;
  const cx = x + inset;
  const cy = y + inset;
  const cw = w - inset * 2;
  const ch = h - inset * 2;

  doc.setFillColor(...WHITE);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.5);
  doc.rect(cx, cy, cw, ch, 'FD');

  // TOP HEADER
  const headerH = 12.4;
  doc.setFillColor(...NAVY);
  doc.rect(cx, cy, cw, headerH, 'F');
  doc.setFillColor(...AMBER);
  doc.rect(cx, cy + headerH - 0.8, cw, 0.8, 'F');

  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(fitText(doc, `DATESHEET · ${classKey}`, cw - 22), cx + 2.0, cy + 4.7);

  // ID Badge
  const idText = `ID: ${student.Student_ID}`;
  doc.setFontSize(7.2);
  const idW = Math.min(22, doc.getTextWidth(idText) + 3.6);
  const idX = cx + cw - idW - 1.8;
  doc.setFillColor(...AMBER);
  doc.rect(idX, cy + 1.5, idW, 4.0, 'F');
  doc.setTextColor(15, 23, 42);
  doc.text(idText, idX + idW / 2, cy + 4.3, { align: 'center' });

  // Student Name + Exam/Session row
  doc.setTextColor(...WHITE);
  doc.setFontSize(7.6);
  doc.text(
    fitText(doc, String(student.Student_Name || '').toUpperCase(), cw * 0.52),
    cx + 2.0,
    cy + 9.6
  );

  doc.setTextColor(...AMBER_TEXT);
  doc.setFontSize(6.9);
  const shortExam = `${examTitle.replace(' EXAMINATION', '')} (${config.session})`;
  doc.text(fitText(doc, shortExam, cw * 0.44), cx + cw - 2.0, cy + 9.6, { align: 'right' });

  // DATESHEET TABLE (Larger rows & readable fonts filling vertical space)
  const padX = 2.0;
  const tblX = cx + padX;
  const tblW = cw - padX * 2;
  const tblStartY = cy + headerH + 1.4;
  const footerH = 14.5;
  const maxTblH = ch - headerH - footerH - 2.6;

  // Table Header
  const thH = 5.2;
  doc.setFillColor(...SLATE_100);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.35);
  doc.rect(tblX, tblStartY, tblW, thH, 'F');
  doc.line(tblX, tblStartY + thH, tblX + tblW, tblStartY + thH);

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.4);
  doc.text('DATE & DAY', tblX + 1.2, tblStartY + 3.6);
  doc.text('SUBJECT', tblX + 22.0, tblStartY + 3.6);

  const count = Math.max(rows.length, 1);
  const rowH = Math.min(7.2, Math.max(4.6, (maxTblH - thH) / count));
  let curY = tblStartY + thH;

  rows.forEach((r, idx) => {
    if (curY + rowH > cy + ch - footerH - 0.6) return;
    if (idx % 2 === 1) {
      doc.setFillColor(...SLATE_50);
      doc.rect(tblX, curY, tblW, rowH, 'F');
    }
    doc.setDrawColor(...SLATE_300);
    doc.setLineWidth(0.18);
    doc.line(tblX, curY + rowH, tblX + tblW, curY + rowH);

    const baseTextY = curY + rowH * 0.68;
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.0);
    const dateDay = `${formatShortDate(r.date)} ${r.day}`.trim();
    doc.text(fitText(doc, dateDay, 19.5), tblX + 1.2, baseTextY);

    doc.setFontSize(8.8);
    doc.text(fitText(doc, r.subject, tblW - 23.0), tblX + 22.0, baseTextY);
    curY += rowH;
  });

  // FOOTER NOTES
  const footY = cy + ch - footerH;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.line(tblX, footY, tblX + tblW, footY);

  let noteY = footY + 1.2;
  if (config.datesheetHolidayNote) {
    doc.setFillColor(...SLATE_100);
    doc.rect(tblX, noteY, tblW, 4.0, 'F');
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.0);
    doc.text(fitText(doc, `Off: ${config.datesheetHolidayNote}`, tblW - 1.5), tblX + 0.8, noteY + 2.9);
    noteY += 4.6;
  }

  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.text(
    fitText(doc, config.datesheetArrivalLine || 'Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM', tblW),
    tblX + 0.5,
    noteY + 2.6
  );

  doc.setTextColor(...SLATE_700);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.9);
  doc.text(
    fitText(doc, 'Winter uniform & own stationery compulsory. No re-exam.', tblW),
    tblX + 0.5,
    noteY + 6.0
  );
};

const drawFrontLandscapeSlot = (
  doc: jsPDF,
  slotX: number,
  slotY: number,
  slotW: number,
  slotH: number,
  cardW: number,
  cardH: number,
  item: StudentHallPassEligibility,
  config: HallPassConfig,
  classNameLabel: string,
  photoDataUrl: string | null,
  qrDataUrl: string | undefined,
  showCutBorder: boolean,
  showClassOnCard: boolean
) => {
  const { student } = item;
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const x = slotX + (slotW - cardW) / 2;
  const y = slotY + (slotH - cardH) / 2;

  if (showCutBorder) {
    doc.setDrawColor(...SLATE_500);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.rect(x, y, cardW, cardH, 'S');
    doc.setLineDashPattern([], 0);
  }

  const inset = showCutBorder ? 0.65 : 0.2;
  const cx = x + inset;
  const cy = y + inset;
  const cw = cardW - inset * 2;
  const ch = cardH - inset * 2;

  doc.setFillColor(...WHITE);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(cx, cy, cw, ch, 'FD');

  // TOP HEADER STRIP (Doubled height ~16.5mm on full 67.5mm landscape & 13.5mm on 55mm polypack, larger bold school name)
  const isCompactH = cardH < 60;
  const headerH = isCompactH ? 13.5 : 16.5;
  doc.setFillColor(...NAVY);
  doc.rect(cx, cy, cw, headerH, 'F');
  doc.setFillColor(...AMBER);
  doc.rect(cx, cy + headerH - 0.9, cw, 0.9, 'F');

  const badgeW = isCompactH ? 15.5 : 18.0;
  const badgeH = isCompactH ? 4.0 : 4.6;
  const badgeX = cx + cw - badgeW - 1.8;
  const badgeY = cy + (isCompactH ? 1.4 : 1.7);
  doc.setFillColor(...AMBER);
  doc.rect(badgeX, badgeY, badgeW, badgeH, 'F');
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 6.5 : 7.4);
  doc.text('HALL PASS', badgeX + badgeW / 2, badgeY + (isCompactH ? 2.8 : 3.2), { align: 'center' });

  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 11.0 : 13.4);
  doc.text(
    fitText(doc, 'E.V.S. PUBLIC SCHOOL', cw - badgeW - 5.2),
    cx + 2.0,
    cy + (isCompactH ? 4.9 : 6.0)
  );

  doc.setTextColor(...LIGHT_BLUE_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 6.5 : 7.6);
  doc.text('Chilkana Sultanpur, Saharanpur (U.P.)', cx + 2.0, cy + (isCompactH ? 8.1 : 9.7));

  doc.setDrawColor(90, 115, 145);
  doc.setLineWidth(0.2);
  const divY = cy + (isCompactH ? 9.3 : 11.1);
  doc.line(cx + 2.0, divY, cx + cw - 2.0, divY);

  doc.setTextColor(...AMBER_TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 6.8 : 8.0);
  doc.text(fitText(doc, examTitle, cw - 24), cx + 2.0, cy + headerH - (isCompactH ? 1.8 : 2.1));

  doc.setTextColor(...WHITE);
  doc.setFontSize(isCompactH ? 6.8 : 7.8);
  doc.text(
    `Session: ${String(config.session || '2026-27')}`,
    cx + cw - 1.8,
    cy + headerH - (isCompactH ? 1.8 : 2.1),
    { align: 'right' }
  );

  // BOTTOM INSTRUCTION STRIP
  const footerH = isCompactH ? 3.8 : 4.2;
  const footerY = cy + ch - footerH;
  doc.setFillColor(...SLATE_50);
  doc.rect(cx + 0.2, footerY, cw - 0.4, footerH - 0.2, 'F');
  doc.setDrawColor(...SLATE_300);
  doc.setLineWidth(0.2);
  doc.line(cx, footerY, cx + cw, footerY);
  doc.setTextColor(...SLATE_700);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isCompactH ? 5.6 : 6.0);
  doc.text(
    fitText(doc, config.instructionLine || 'Bring Hall Pass, School ID & stationery daily.', cw - 3.6),
    cx + 1.8,
    footerY + (isCompactH ? 2.6 : 2.9)
  );

  // FULL-WIDTH EXAM FEE + TEACHER WRITE-IN PAID/STATUS BOX (Cleanly occupies lower zone)
  const padX = 2.0;
  const bodyX = cx + padX;
  const bodyW = cw - padX * 2;
  const feeH = isCompactH ? 7.2 : 9.0;
  const feeY = footerY - feeH - 1.3;
  const examFeeAmount =
    typeof item.examFee === 'number' && !isNaN(item.examFee)
      ? item.examFee
      : getClassExamFee(student.Class);
  const examFeeText = `Rs. ${examFeeAmount.toLocaleString('en-IN')}`;
  const feeLeftW = 34.0;

  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(bodyX, feeY, feeLeftW, feeH, 'FD');

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.text('EXAM FEE:', bodyX + 1.5, feeY + feeH * 0.62);
  doc.setTextColor(...BLACK);
  doc.setFontSize(9.5);
  doc.text(fitText(doc, examFeeText, feeLeftW - 15.5), bodyX + feeLeftW - 1.5, feeY + feeH * 0.65, {
    align: 'right',
  });

  // Right Box: Auto Paid Checkmark OR Empty Teacher Checkbox + Write-In Line
  drawExamPaidStatusBox(
    doc,
    bodyX + feeLeftW,
    feeY,
    bodyW - feeLeftW,
    feeH,
    Boolean(item.isExamFeePaid),
    isCompactH
  );

  // TOP 3-COLUMN IDENTITY BODY (Balanced vertical fit from header to fee bar)
  const bodyTop = cy + headerH + 1.6;
  const topZoneH = feeY - bodyTop - 1.4;

  // Left: Student Photo + Class
  const photoW = isCompactH ? 16.0 : 18.5;
  const photoH = Math.min(isCompactH ? 20.5 : 24.5, topZoneH - (showClassOnCard ? 4.2 : 0.8));
  doc.setFillColor(...SLATE_100);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(bodyX, bodyTop, photoW, photoH, 'FD');

  if (photoDataUrl) {
    try {
      doc.addImage(photoDataUrl, 'JPEG', bodyX + 0.3, bodyTop + 0.3, photoW - 0.6, photoH - 0.6);
    } catch {
      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(getInitials(student.Student_Name), bodyX + photoW / 2, bodyTop + photoH / 2 + 1.2, {
        align: 'center',
      });
    }
  } else {
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(getInitials(student.Student_Name), bodyX + photoW / 2, bodyTop + photoH / 2 + 1.2, {
      align: 'center',
    });
  }

  if (showClassOnCard) {
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.0);
    doc.text(fitText(doc, classNameLabel, photoW + 2), bodyX + photoW / 2, bodyTop + photoH + 3.4, {
      align: 'center',
    });
  }

  // Right: QR Code + Principal Sign
  const qrSize = isCompactH ? 17.5 : 20.5;
  const qrX = cx + cw - padX - qrSize;
  const qrY = bodyTop;
  doc.setFillColor(...WHITE);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(qrX, qrY, qrSize, qrSize, 'FD');
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', qrX + 0.5, qrY + 0.5, qrSize - 1.0, qrSize - 1.0);
    } catch {}
  }

  const signLineY = feeY - 4.0;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.35);
  doc.line(qrX, signLineY, qrX + qrSize, signLineY);
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.text('Principal Sign.', qrX + qrSize / 2, signLineY + 2.3, { align: 'center' });

  // Center: HIGHLIGHTED BIG Student Name + Highlighted Big SCHOOL ID + Roll + Timing
  const infoX = bodyX + photoW + 2.2;
  const infoW = qrX - infoX - 2.2;

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 10.8 : 11.8);
  doc.text(fitText(doc, String(student.Student_Name || '').toUpperCase(), infoW), infoX, bodyTop + 3.8);

  doc.setTextColor(...SLATE_700);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.0);
  doc.text(fitText(doc, `S/o · D/o ${student.Father_Name || '—'}`, infoW), infoX, bodyTop + 7.3);
  doc.setDrawColor(...SLATE_300);
  doc.setLineWidth(0.2);
  doc.line(infoX, bodyTop + 8.3, infoX + infoW, bodyTop + 8.3);

  // Highlighted SCHOOL ID + ROLL NO boxes
  const boxY = bodyTop + 9.4;
  const boxGap = 1.5;
  const idBoxW = infoW * 0.58;
  const rollBoxW = infoW - idBoxW - boxGap;
  const boxH = isCompactH ? 8.8 : 10.2;

  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.55);
  doc.rect(infoX, boxY, idBoxW, boxH, 'FD');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.text('SCHOOL ID', infoX + 1.2, boxY + 2.5);
  doc.setTextColor(...BLACK);
  doc.setFontSize(isCompactH ? 10.5 : 11.5);
  doc.text(fitText(doc, String(student.Student_ID || '—'), idBoxW - 2.0), infoX + 1.2, boxY + boxH - 1.7);

  const rollBoxX = infoX + idBoxW + boxGap;
  doc.setFillColor(...SLATE_50);
  doc.setLineWidth(0.38);
  doc.rect(rollBoxX, boxY, rollBoxW, boxH, 'FD');
  doc.setTextColor(...SLATE_500);
  doc.setFontSize(5.2);
  doc.text('ROLL NO.', rollBoxX + 1.0, boxY + 2.5);
  doc.setTextColor(...BLACK);
  doc.setFontSize(9.0);
  doc.text(fitText(doc, String(student.Roll_Number || '—'), rollBoxW - 1.8), rollBoxX + 1.0, boxY + boxH - 1.8);

  // Timing Line cleanly below boxes
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.6);
  doc.text(
    fitText(doc, config.examScheduleLine || 'Exam: 09:30 AM - 12:00 PM', infoW),
    infoX,
    boxY + boxH + 3.6
  );
};

const drawBackLandscapeDatesheetSlot = (
  doc: jsPDF,
  slotX: number,
  slotY: number,
  slotW: number,
  slotH: number,
  cardW: number,
  cardH: number,
  item: StudentHallPassEligibility,
  config: HallPassConfig,
  classNameLabel: string,
  showCutBorder: boolean
) => {
  const { student } = item;
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const classKey = resolveDatesheetClassKey(student.Class, classNameLabel);
  const rows = getStudentDatesheetSchedule(config, student.Class, classNameLabel);

  const x = slotX + (slotW - cardW) / 2;
  const y = slotY + (slotH - cardH) / 2;

  if (showCutBorder) {
    doc.setDrawColor(...SLATE_500);
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1.2, 1.2], 0);
    doc.rect(x, y, cardW, cardH, 'S');
    doc.setLineDashPattern([], 0);
  }

  const inset = showCutBorder ? 0.65 : 0.2;
  const cx = x + inset;
  const cy = y + inset;
  const cw = cardW - inset * 2;
  const ch = cardH - inset * 2;

  doc.setFillColor(...WHITE);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.45);
  doc.rect(cx, cy, cw, ch, 'FD');

  const isCompactH = cardH < 60;

  // HEADER (Slightly taller & sharper)
  const headerH = isCompactH ? 8.2 : 9.6;
  doc.setFillColor(...NAVY);
  doc.rect(cx, cy, cw, headerH, 'F');
  doc.setFillColor(...AMBER);
  doc.rect(cx, cy + headerH - 0.65, cw, 0.65, 'F');

  doc.setTextColor(...WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 7.8 : 8.8);
  doc.text(fitText(doc, `DATESHEET · ${classKey}`, 38), cx + 1.8, cy + (isCompactH ? 5.2 : 6.0));

  doc.setTextColor(...LIGHT_BLUE_TEXT);
  doc.setFontSize(isCompactH ? 6.8 : 7.6);
  doc.text(fitText(doc, String(student.Student_Name || '').toUpperCase(), 26), cx + 41, cy + (isCompactH ? 5.2 : 6.0));

  const idText = `ID: ${student.Student_ID}`;
  doc.setFontSize(isCompactH ? 6.5 : 7.0);
  const idW = Math.min(20, doc.getTextWidth(idText) + 3.4);
  const idX = cx + cw - idW - 1.6;
  doc.setFillColor(...AMBER);
  doc.rect(idX, cy + (isCompactH ? 1.8 : 2.1), idW, isCompactH ? 4.0 : 4.5, 'F');
  doc.setTextColor(15, 23, 42);
  doc.text(idText, idX + idW / 2, cy + (isCompactH ? 4.6 : 5.2), { align: 'center' });

  // FOOTER NOTES
  const footerH = isCompactH ? 7.8 : 8.8;
  const footY = cy + ch - footerH;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.35);
  doc.line(cx + 1.8, footY, cx + cw - 1.8, footY);

  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isCompactH ? 6.1 : 6.6);
  doc.text(
    fitText(doc, config.datesheetArrivalLine || 'Arrival: 08:45 AM · Exam: 09:30 AM – 12:00 PM', cw - 3.6),
    cx + 1.8,
    footY + 3.3
  );

  doc.setTextColor(...SLATE_700);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isCompactH ? 5.6 : 6.0);
  doc.text(
    fitText(
      doc,
      config.datesheetHolidayNote
        ? `Off: ${config.datesheetHolidayNote}`
        : `${examTitle} (${config.session}) · Bring own stationery.`,
      cw - 3.6
    ),
    cx + 1.8,
    footY + (isCompactH ? 6.4 : 6.9)
  );

  // 2-COLUMN SPLIT DATESHEET TABLE (Maximizes row height & font size to fill card cleanly)
  const padX = 1.8;
  const tblX = cx + padX;
  const tblW = cw - padX * 2;
  const colGap = 1.8;
  const colW = (tblW - colGap) / 2;
  const tblStartY = cy + headerH + 1.2;
  const maxTblH = footY - tblStartY - 0.8;

  const splitAt = Math.ceil(rows.length / 2);
  const columns = [rows.slice(0, splitAt), rows.slice(splitAt)];
  const thH = isCompactH ? 4.2 : 5.0;
  const maxRowsPerCol = Math.max(splitAt, 1);
  const rowH = Math.min(isCompactH ? 6.4 : 8.2, Math.max(3.8, (maxTblH - thH) / maxRowsPerCol));
  const subjOffsetX = isCompactH ? 15.2 : 16.5;

  columns.forEach((colRows, colIdx) => {
    const colX = tblX + colIdx * (colW + colGap);

    doc.setFillColor(...SLATE_100);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.32);
    doc.rect(colX, tblStartY, colW, thH, 'F');
    doc.line(colX, tblStartY + thH, colX + colW, tblStartY + thH);

    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isCompactH ? 6.4 : 7.2);
    doc.text('DATE', colX + 0.9, tblStartY + (isCompactH ? 3.0 : 3.5));
    doc.text('SUBJECT', colX + subjOffsetX, tblStartY + (isCompactH ? 3.0 : 3.5));

    let curY = tblStartY + thH;
    colRows.forEach((r, idx) => {
      if (curY + rowH > footY - 0.3) return;
      if (idx % 2 === 1) {
        doc.setFillColor(...SLATE_50);
        doc.rect(colX, curY, colW, rowH, 'F');
      }
      doc.setDrawColor(...SLATE_300);
      doc.setLineWidth(0.18);
      doc.line(colX, curY + rowH, colX + colW, curY + rowH);

      const baseY = curY + rowH * 0.66;
      doc.setTextColor(...BLACK);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(isCompactH ? 6.8 : 7.6);
      const dateDay = `${formatShortDate(r.date)} ${r.day}`.trim();
      doc.text(fitText(doc, dateDay, subjOffsetX - 1.4), colX + 0.8, baseY);

      doc.setFontSize(isCompactH ? 7.2 : 8.4);
      doc.text(fitText(doc, r.subject, colW - subjOffsetX - 0.8), colX + subjOffsetX, baseY);
      curY += rowH;
    });
  });
};

export async function generateAndDownloadHallPassPdf(
  opts: GenerateHallPassPdfOptions
): Promise<{ filename: string; pageCount: number }> {
  const { items, config, mode, getClassName, getStudentPhoto, qrMap, showCutBorder, showClassOnCard } = opts;
  const layoutSpec = resolveHallPassLayout(config.cardLayout);
  const isLandscape = layoutSpec.isLandscape;

  // Ensure QR data URLs exist for all printable students (even if preview hasn't finished yet)
  const resolvedQr: Record<string, string> = { ...qrMap };
  const missingQr = items.filter((i) => {
    const sid = String(i.student.Student_ID || '').trim();
    return sid && !resolvedQr[sid];
  });
  if (missingQr.length > 0) {
    try {
      const mod = await import('qrcode');
      const QRCodeLib = mod.default || mod;
      for (const item of missingQr) {
        const sid = String(item.student.Student_ID || '').trim();
        if (!sid) continue;
        resolvedQr[sid] = await QRCodeLib.toDataURL(sid, {
          width: 220,
          margin: 1,
          color: { dark: '#000000', light: '#ffffff' },
        });
      }
    } catch {}
  }

  // Preload photos when generating front or duplex
  const photoCache: Record<string, string | null> = {};
  if (mode === 'front' || mode === 'duplex') {
    await Promise.all(
      items.map(async (item) => {
        const sid = String(item.student.Student_ID || '').trim();
        if (!sid || sid in photoCache) return;
        const url = getStudentPhoto(item.student);
        photoCache[sid] = await loadPhotoAsJpegDataUrl(url);
      })
    );
  }

  const pdfOrientation = isLandscape ? 'landscape' : 'portrait';
  const doc = new jsPDF({
    orientation: pdfOrientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const a4Pages = chunkIntoPages(items, 9);
  const flipMode = config.backsideFlipMode === 'row_flip' ? 'row_flip' : 'book_flip';
  const margin = 2.5;
  const gap = 1.2;
  const pageW = isLandscape ? 297 : 210;
  const pageH = isLandscape ? 210 : 297;
  const cellW = (pageW - margin * 2 - gap * 2) / 3; // Portrait: ~67.53mm | Landscape: ~96.53mm
  const cellH = (pageH - margin * 2 - gap * 2) / 3; // Portrait: ~96.53mm | Landscape: ~67.53mm
  const cardW = layoutSpec.id === 'landscape_polypack_90x55' ? 90 : cellW;
  const cardH = layoutSpec.id === 'landscape_polypack_90x55' ? 55 : cellH;

  let totalPdfPages = 0;

  a4Pages.forEach((pageItems) => {
    const paddedSlots: Array<StudentHallPassEligibility | null> = [...pageItems];
    while (paddedSlots.length < 9) paddedSlots.push(null);

    if (mode === 'front' || mode === 'duplex') {
      if (totalPdfPages > 0) doc.addPage('a4', pdfOrientation);
      totalPdfPages++;
      paddedSlots.forEach((slotItem, slotIdx) => {
        const col = slotIdx % 3;
        const row = Math.floor(slotIdx / 3);
        const x = margin + col * (cellW + gap);
        const y = margin + row * (cellH + gap);
        if (slotItem) {
          const sid = String(slotItem.student.Student_ID || '').trim();
          if (isLandscape) {
            drawFrontLandscapeSlot(
              doc,
              x,
              y,
              cellW,
              cellH,
              cardW,
              cardH,
              slotItem,
              config,
              getClassName(slotItem.student.Class),
              photoCache[sid] || null,
              resolvedQr[sid],
              showCutBorder,
              showClassOnCard
            );
          } else {
            drawFrontSlot(
              doc,
              x,
              y,
              cellW,
              cellH,
              slotItem,
              config,
              getClassName(slotItem.student.Class),
              photoCache[sid] || null,
              resolvedQr[sid],
              showCutBorder,
              showClassOnCard
            );
          }
        } else if (showCutBorder) {
          doc.setDrawColor(...SLATE_300);
          doc.setLineWidth(0.18);
          doc.setLineDashPattern([1.2, 1.2], 0);
          doc.rect(x + (cellW - cardW) / 2, y + (cellH - cardH) / 2, cardW, cardH, 'S');
          doc.setLineDashPattern([], 0);
        }
      });
    }

    if (mode === 'back' || mode === 'duplex') {
      if (totalPdfPages > 0) doc.addPage('a4', pdfOrientation);
      totalPdfPages++;
      const backSlots = mapPageSlotsForBackside(paddedSlots, flipMode);
      backSlots.forEach((slotItem, slotIdx) => {
        const col = slotIdx % 3;
        const row = Math.floor(slotIdx / 3);
        const x = margin + col * (cellW + gap);
        const y = margin + row * (cellH + gap);
        if (slotItem) {
          if (isLandscape) {
            drawBackLandscapeDatesheetSlot(
              doc,
              x,
              y,
              cellW,
              cellH,
              cardW,
              cardH,
              slotItem,
              config,
              getClassName(slotItem.student.Class),
              showCutBorder
            );
          } else {
            drawBackDatesheetSlot(
              doc,
              x,
              y,
              cellW,
              cellH,
              slotItem,
              config,
              getClassName(slotItem.student.Class),
              showCutBorder
            );
          }
        } else if (showCutBorder) {
          doc.setDrawColor(...SLATE_300);
          doc.setLineWidth(0.18);
          doc.setLineDashPattern([1.2, 1.2], 0);
          doc.rect(x + (cellW - cardW) / 2, y + (cellH - cardH) / 2, cardW, cardH, 'S');
          doc.setLineDashPattern([], 0);
        }
      });
    }
  });

  const examSlug = String(config.examType || 'Exam').replace(/\s+/g, '_');
  const sideLabel = mode === 'front' ? 'Step1_Front_HallPass' : mode === 'back' ? 'Step2_Back_Datesheet' : 'Front_and_Back';
  const orientSlug = isLandscape ? (layoutSpec.id === 'landscape_polypack_90x55' ? '70x100_Polypack_' : 'Landscape_') : '';
  const filename = `EVS_${examSlug}_${orientSlug}${sideLabel}_${items.length}_Students.pdf`;
  doc.save(filename);

  return { filename, pageCount: totalPdfPages };
}

/**
 * Generates a single-student A4 PDF (Front Hall Pass + Back Class Datesheet)
 * for Parent Portal download matching the configured school card orientation.
 */
export async function generateParentSingleStudentPdf(opts: {
  item: StudentHallPassEligibility;
  config: HallPassConfig;
  classNameLabel: string;
  photoUrl?: string;
  qrDataUrl?: string;
}): Promise<string> {
  const { item, config, classNameLabel, photoUrl, qrDataUrl } = opts;
  const layoutSpec = resolveHallPassLayout(config.cardLayout);

  let finalQr = qrDataUrl;
  if (!finalQr) {
    try {
      const mod = await import('qrcode');
      const QRCodeLib = mod.default || mod;
      finalQr = await QRCodeLib.toDataURL(String(item.student.Student_ID || '').trim(), {
        width: 240,
        margin: 1,
        color: { dark: '#0c2340', light: '#ffffff' },
      });
    } catch {}
  }

  const photoDataUrl = await loadPhotoAsJpegDataUrl(photoUrl);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('E.V.S. PUBLIC SCHOOL — EXAM HALL PASS & DATESHEET', 105, 20, { align: 'center' });

  doc.setTextColor(...SLATE_500);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Cut along dotted lines & insert into lanyard pouch (Front + Back Datesheet)', 105, 26, {
    align: 'center',
  });

  if (layoutSpec.isLandscape) {
    const cardW = layoutSpec.widthMm;
    const cardH = layoutSpec.heightMm;
    const startX = (210 - cardW) / 2;
    drawFrontLandscapeSlot(doc, startX, 36, cardW, cardH, cardW, cardH, item, config, classNameLabel, photoDataUrl, finalQr, true, true);
    drawBackLandscapeDatesheetSlot(doc, startX, 36 + cardH + 10, cardW, cardH, cardW, cardH, item, config, classNameLabel, true);
  } else {
    const cardW = 67.5;
    const cardH = 96.5;
    const gap = 8;
    const startX = (210 - (cardW * 2 + gap)) / 2;
    const startY = 36;
    drawFrontSlot(doc, startX, startY, cardW, cardH, item, config, classNameLabel, photoDataUrl, finalQr, true, true);
    drawBackDatesheetSlot(doc, startX + cardW + gap, startY, cardW, cardH, item, config, classNameLabel, true);
  }

  const safeName = String(item.student.Student_Name || 'Student').replace(/[^a-zA-Z0-9]+/g, '_');
  const filename = `EVS_HallPass_${safeName}_${item.student.Student_ID}.pdf`;
  doc.save(filename);
  return filename;
}
