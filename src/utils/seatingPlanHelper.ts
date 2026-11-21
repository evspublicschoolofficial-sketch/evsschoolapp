import jsPDF from 'jspdf';
import { HallPassConfig, Student } from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { getExamDisplayTitle } from './hallPassHelper';
import { dualSyncWriteToSheet } from './sheetDirectSync';

export interface RoomCustomMeta {
  roomNumber: string;
  invigilator: string;
}

export interface SeatingBenchSeat {
  student: Student;
  classCode: string;
  classLabel: string;
  seatPosition: 'Left' | 'Middle' | 'Right' | 'Seat 4';
}

export interface SeatingBench {
  benchNumber: number;
  seats: SeatingBenchSeat[];
}

export interface ExamRoomPlan {
  slotKey: string; // 'pre_1', 'pre_2', 'upper_1'..'upper_4'
  group: 'pre_primary' | 'upper_1_to_8';
  groupLabelHi: string;
  defaultRoomName: string;
  roomNumber: string;
  invigilator: string;
  benches: SeatingBench[];
  totalStudents: number;
  adjacentSameClassPairs: number;
  classBreakdown: Array<{ classCode: string; classLabel: string; count: number }>;
}

export interface FullExamSeatingPlan {
  rooms: ExamRoomPlan[];
  totalStudents: number;
  prePrimaryCount: number;
  upperCount: number;
  totalBenches: number;
  totalSameClassConflicts: number;
}

export type SeatingDistributionMode = 'anti_cheating_mixed' | 'class_grouped';

export const SEATING_PLAN_META_STORAGE_KEY = 'evs_exam_seating_rooms_v1';

export const DEFAULT_ROOM_META: Record<string, RoomCustomMeta> = {
  pre_1: { roomNumber: 'Room 1', invigilator: '' },
  pre_2: { roomNumber: 'Room 2', invigilator: '' },
  upper_1: { roomNumber: 'Room 3', invigilator: '' },
  upper_2: { roomNumber: 'Room 4', invigilator: '' },
  upper_3: { roomNumber: 'Room 5', invigilator: '' },
  upper_4: { roomNumber: 'Room 6', invigilator: '' },
};

export function loadSavedRoomMeta(): Record<string, RoomCustomMeta> {
  try {
    const raw = localStorage.getItem(SEATING_PLAN_META_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const merged: Record<string, RoomCustomMeta> = { ...DEFAULT_ROOM_META };
        for (const key of Object.keys(DEFAULT_ROOM_META)) {
          if (parsed[key] && typeof parsed[key] === 'object') {
            merged[key] = {
              roomNumber: String(parsed[key].roomNumber || DEFAULT_ROOM_META[key].roomNumber),
              invigilator: String(parsed[key].invigilator || ''),
            };
          }
        }
        return merged;
      }
    }
  } catch {}
  return { ...DEFAULT_ROOM_META };
}

export function saveRoomMeta(meta: Record<string, RoomCustomMeta>): void {
  try {
    localStorage.setItem(SEATING_PLAN_META_STORAGE_KEY, JSON.stringify(meta));
  } catch {}
}

const PRE_PRIMARY_ORDER = ['C1', 'C2', 'C3', 'C4'];
const UPPER_ORDER = ['C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'];

const DEFAULT_CLASS_NAMES: Record<string, string> = {
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

export function normalizeCanonicalClassCode(rawClass?: string | null, mappedLabel?: string | null): string {
  const code = String(rawClass || '').trim().toUpperCase();
  if (/^C(1[0-2]|[1-9])$/.test(code)) return code;

  const text = `${String(rawClass || '').trim()} ${String(mappedLabel || '').trim()}`.toLowerCase();
  if (/\b(play|pg|play\s*group)\b/.test(text)) return 'C1';
  if (/\b(m1|nursery|nur)\b/.test(text)) return 'C2';
  if (/\b(m2|lkg|l\.k\.g)\b/.test(text)) return 'C3';
  if (/\b(m3|ukg|u\.k\.g)\b/.test(text)) return 'C4';
  if (/\b(1st|class\s*1)\b/.test(text) || /^1$/.test(code)) return 'C5';
  if (/\b(2nd|class\s*2)\b/.test(text) || /^2$/.test(code)) return 'C6';
  if (/\b(3rd|class\s*3)\b/.test(text) || /^3$/.test(code)) return 'C7';
  if (/\b(4th|class\s*4)\b/.test(text) || /^4$/.test(code)) return 'C8';
  if (/\b(5th|class\s*5)\b/.test(text) || /^5$/.test(code)) return 'C9';
  if (/\b(6th|class\s*6)\b/.test(text) || /^6$/.test(code)) return 'C10';
  if (/\b(7th|class\s*7)\b/.test(text) || /^7$/.test(code)) return 'C11';
  if (/\b(8th|class\s*8)\b/.test(text) || /^8$/.test(code)) return 'C12';
  return code || 'C5';
}

function getSeatPositionName(idx: number, totalOnBench: number): SeatingBenchSeat['seatPosition'] {
  if (totalOnBench <= 1 || idx === 0) return 'Left';
  if (totalOnBench === 2) return idx === 1 ? 'Right' : 'Left';
  if (idx === 1) return 'Middle';
  if (idx === 2) return 'Right';
  return 'Seat 4';
}

function sortStudentsForExam(list: Student[]): Student[] {
  return [...list].sort((a, b) => {
    const rA = Number(a.Roll_Number || 99999);
    const rB = Number(b.Roll_Number || 99999);
    if (rA !== rB) return rA - rB;
    return String(a.Student_Name || '').localeCompare(String(b.Student_Name || ''));
  });
}

function distributeGroupIntoRooms(opts: {
  groupStudents: Array<{ student: Student; classCode: string; classLabel: string }>;
  classOrder: string[];
  numRooms: number;
  seatsPerBench: number;
  mode: SeatingDistributionMode;
  group: 'pre_primary' | 'upper_1_to_8';
  groupLabelHi: string;
  slotKeys: string[];
  roomMeta: Record<string, RoomCustomMeta>;
}): ExamRoomPlan[] {
  const {
    groupStudents,
    classOrder,
    numRooms,
    seatsPerBench,
    mode,
    group,
    groupLabelHi,
    slotKeys,
    roomMeta,
  } = opts;

  const total = groupStudents.length;
  const base = Math.floor(total / numRooms);
  const rem = total % numRooms;
  const targets = Array.from({ length: numRooms }, (_, idx) => base + (idx < rem ? 1 : 0));

  const pools = classOrder
    .map((code) => {
      const members = groupStudents.filter((s) => s.classCode === code);
      return {
        code,
        label: members[0]?.classLabel || DEFAULT_CLASS_NAMES[code] || code,
        queue: [...members],
      };
    })
    .filter((p) => p.queue.length > 0);

  // Include any unexpected class code if present
  const knownCodes = new Set(classOrder);
  const extras = groupStudents.filter((s) => !knownCodes.has(s.classCode));
  if (extras.length > 0) {
    pools.push({
      code: 'OTHER',
      label: extras[0].classLabel || 'Other',
      queue: [...extras],
    });
  }

  const rooms: ExamRoomPlan[] = [];

  for (let rIdx = 0; rIdx < numRooms; rIdx++) {
    const slotKey = slotKeys[rIdx] || `${group}_${rIdx + 1}`;
    const meta = roomMeta[slotKey] || DEFAULT_ROOM_META[slotKey] || { roomNumber: `Room ${rIdx + 1}`, invigilator: '' };
    let remainingInRoom = targets[rIdx];
    const benches: SeatingBench[] = [];

    if (mode === 'class_grouped') {
      // Sequential class-by-class filling
      const roomItems: Array<{ student: Student; classCode: string; classLabel: string }> = [];
      for (const pool of pools) {
        while (pool.queue.length > 0 && roomItems.length < remainingInRoom) {
          const item = pool.queue.shift();
          if (item) roomItems.push(item);
        }
      }
      for (let i = 0; i < roomItems.length; i += seatsPerBench) {
        const slice = roomItems.slice(i, i + seatsPerBench);
        benches.push({
          benchNumber: benches.length + 1,
          seats: slice.map((item, sIdx) => ({
            ...item,
            seatPosition: getSeatPositionName(sIdx, slice.length),
          })),
        });
      }
    } else {
      // Anti-cheating mixed allocation: pick distinct classes per bench starting with largest remaining pools
      let benchNo = 1;
      while (remainingInRoom > 0) {
        const seatCount = Math.min(seatsPerBench, remainingInRoom);
        const rawBench: Array<{ student: Student; classCode: string; classLabel: string }> = [];
        const usedClassesOnBench = new Set<string>();

        for (let s = 0; s < seatCount; s++) {
          let candidates = pools.filter((p) => p.queue.length > 0 && !usedClassesOnBench.has(p.code));
          if (candidates.length === 0) {
            candidates = pools.filter((p) => p.queue.length > 0);
          }
          if (candidates.length === 0) break;
          candidates.sort((a, b) => b.queue.length - a.queue.length);
          const chosenPool = candidates[0];
          const picked = chosenPool.queue.shift();
          if (!picked) break;
          usedClassesOnBench.add(chosenPool.code);
          rawBench.push(picked);
        }

        // If a 3-seat bench happens to have 2 from the same class and 1 different, keep the different one in the Middle!
        if (rawBench.length === 3) {
          if (rawBench[0].classCode === rawBench[1].classCode && rawBench[2].classCode !== rawBench[0].classCode) {
            [rawBench[1], rawBench[2]] = [rawBench[2], rawBench[1]];
          } else if (
            rawBench[1].classCode === rawBench[2].classCode &&
            rawBench[0].classCode !== rawBench[1].classCode
          ) {
            [rawBench[0], rawBench[1]] = [rawBench[1], rawBench[0]];
          }
        }

        if (rawBench.length === 0) break;
        benches.push({
          benchNumber: benchNo++,
          seats: rawBench.map((item, sIdx) => ({
            ...item,
            seatPosition: getSeatPositionName(sIdx, rawBench.length),
          })),
        });
        remainingInRoom -= rawBench.length;
      }
    }

    // Count adjacent same-class pairs & class breakdown
    let adjacentPairs = 0;
    const countMap = new Map<string, { classCode: string; classLabel: string; count: number }>();
    let totalInRoom = 0;

    for (const b of benches) {
      for (let i = 0; i < b.seats.length; i++) {
        const seat = b.seats[i];
        totalInRoom++;
        if (i < b.seats.length - 1 && seat.classCode === b.seats[i + 1].classCode) {
          adjacentPairs++;
        }
        const prev = countMap.get(seat.classCode);
        if (prev) prev.count++;
        else countMap.set(seat.classCode, { classCode: seat.classCode, classLabel: seat.classLabel, count: 1 });
      }
    }

    const classBreakdown = Array.from(countMap.values()).sort((a, b) => {
      const idxA = classOrder.indexOf(a.classCode);
      const idxB = classOrder.indexOf(b.classCode);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    rooms.push({
      slotKey,
      group,
      groupLabelHi,
      defaultRoomName: DEFAULT_ROOM_META[slotKey]?.roomNumber || `Room ${rIdx + 1}`,
      roomNumber: String(meta.roomNumber || DEFAULT_ROOM_META[slotKey]?.roomNumber || `Room ${rIdx + 1}`).trim(),
      invigilator: String(meta.invigilator || '').trim(),
      benches,
      totalStudents: totalInRoom,
      adjacentSameClassPairs: adjacentPairs,
      classBreakdown,
    });
  }

  return rooms;
}

export function generateSixRoomSeatingPlan(opts: {
  students: Student[];
  getClassName: (cls?: string | null) => string;
  roomMeta?: Record<string, RoomCustomMeta>;
  seatsPerBench?: number;
  mode?: SeatingDistributionMode;
}): FullExamSeatingPlan {
  const {
    students,
    getClassName,
    roomMeta = DEFAULT_ROOM_META,
    seatsPerBench = 3,
    mode = 'anti_cheating_mixed',
  } = opts;

  const sortedAll = sortStudentsForExam(students.filter((s) => Boolean(String(s.Student_ID || '').trim())));
  const preStudents: Array<{ student: Student; classCode: string; classLabel: string }> = [];
  const upperStudents: Array<{ student: Student; classCode: string; classLabel: string }> = [];

  for (const s of sortedAll) {
    const mappedLabel = getClassName(s.Class);
    const canonCode = normalizeCanonicalClassCode(s.Class, mappedLabel);
    const cleanLabel = DEFAULT_CLASS_NAMES[canonCode] || mappedLabel || s.Class || canonCode;
    const item = { student: s, classCode: canonCode, classLabel: cleanLabel };
    if (PRE_PRIMARY_ORDER.includes(canonCode)) {
      preStudents.push(item);
    } else {
      upperStudents.push(item);
    }
  }

  const preRooms = distributeGroupIntoRooms({
    groupStudents: preStudents,
    classOrder: PRE_PRIMARY_ORDER,
    numRooms: 2,
    seatsPerBench,
    mode,
    group: 'pre_primary',
    groupLabelHi: 'Play – UKG (M3) · 2 कमरे',
    slotKeys: ['pre_1', 'pre_2'],
    roomMeta,
  });

  const upperRooms = distributeGroupIntoRooms({
    groupStudents: upperStudents,
    classOrder: UPPER_ORDER,
    numRooms: 4,
    seatsPerBench,
    mode,
    group: 'upper_1_to_8',
    groupLabelHi: 'Class 1st – 8th · 4 कमरे',
    slotKeys: ['upper_1', 'upper_2', 'upper_3', 'upper_4'],
    roomMeta,
  });

  const allRooms = [...preRooms, ...upperRooms];
  const totalBenches = allRooms.reduce((sum, r) => sum + r.benches.length, 0);
  const totalSameClassConflicts = allRooms.reduce((sum, r) => sum + r.adjacentSameClassPairs, 0);

  return {
    rooms: allRooms,
    totalStudents: preStudents.length + upperStudents.length,
    prePrimaryCount: preStudents.length,
    upperCount: upperStudents.length,
    totalBenches,
    totalSameClassConflicts,
  };
}

function fitPdfText(doc: jsPDF, text: string, maxW: number): string {
  const clean = String(text || '').trim();
  if (!clean || doc.getTextWidth(clean) <= maxW) return clean;
  let s = clean;
  while (s.length > 1 && doc.getTextWidth(s + '...') > maxW) {
    s = s.slice(0, -1);
  }
  return s + '...';
}

export function generateExamSeatingPlanPdf(opts: {
  plan: FullExamSeatingPlan;
  config: HallPassConfig;
  selectedRoomKey?: string;
}): string {
  const { plan, config, selectedRoomKey } = opts;
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const NAVY: [number, number, number] = [12, 35, 64];
  const AMBER: [number, number, number] = [251, 191, 36];
  const SLATE_100: [number, number, number] = [241, 245, 249];
  const SLATE_300: [number, number, number] = [203, 213, 225];
  const SLATE_600: [number, number, number] = [71, 85, 105];
  const BLACK: [number, number, number] = [0, 0, 0];

  const roomsToExport =
    selectedRoomKey && selectedRoomKey !== 'ALL'
      ? plan.rooms.filter((r) => r.slotKey === selectedRoomKey)
      : plan.rooms;

  let pageStarted = false;

  // Master Summary Page when exporting all rooms
  if (!selectedRoomKey || selectedRoomKey === 'ALL') {
    pageStarted = true;
    doc.setFillColor(...NAVY);
    doc.rect(10, 10, 190, 22, 'F');
    doc.setFillColor(...AMBER);
    doc.rect(10, 31, 190, 1.5, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('E.V.S. PUBLIC SCHOOL — EXAM SEATING PLAN MASTER CHART', 105, 19, { align: 'center' });
    doc.setTextColor(...AMBER);
    doc.setFontSize(10);
    doc.text(`${examTitle} (${config.session}) · Total Students: ${plan.totalStudents} · 6 Rooms · 3 Seats/Bench`, 105, 26.5, {
      align: 'center',
    });

    // Summary stats bar
    doc.setFillColor(...SLATE_100);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.4);
    doc.rect(10, 37, 190, 14, 'FD');
    doc.setTextColor(...BLACK);
    doc.setFontSize(9);
    doc.text(
      `Group A (Play, Nursery, LKG, UKG): ${plan.prePrimaryCount} Students -> 2 Rooms`,
      14,
      43
    );
    doc.text(
      `Group B (Class 1st to 8th): ${plan.upperCount} Students -> 4 Rooms`,
      14,
      48.5
    );
    doc.text(`Total Benches: ${plan.totalBenches}`, 196, 45.8, { align: 'right' });

    // Master table
    let y = 57;
    const cols = [26, 36, 22, 20, 86]; // Room, Wing, Students, Benches, Classes Breakdown
    doc.setFillColor(...NAVY);
    doc.rect(10, y, 190, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    let cx = 10;
    ['ROOM NO.', 'WING / GROUP', 'STUDENTS', 'BENCHES', 'CLASS-WISE COUNT'].forEach((h, i) => {
      doc.text(h, cx + 2, y + 6);
      cx += cols[i];
    });
    y += 9;

    plan.rooms.forEach((room, idx) => {
      const rowH = 14;
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y, 190, rowH, 'F');
      }
      doc.setDrawColor(...SLATE_300);
      doc.setLineWidth(0.3);
      doc.rect(10, y, 190, rowH, 'S');

      const clsSummary = room.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join(' · ');
      const wingText = room.group === 'pre_primary' ? 'Play - UKG (M3)' : 'Class 1st - 8th';

      doc.setTextColor(...BLACK);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(fitPdfText(doc, room.roomNumber, cols[0] - 4), 12, y + 8.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(wingText, 10 + cols[0] + 2, y + 8.5);

      doc.setFont('helvetica', 'bold');
      doc.text(String(room.totalStudents), 10 + cols[0] + cols[1] + 9, y + 8.5, { align: 'center' });
      doc.text(String(room.benches.length), 10 + cols[0] + cols[1] + cols[2] + 9, y + 8.5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const wrapped = doc.splitTextToSize(clsSummary || '—', cols[4] - 4);
      doc.text(wrapped.slice(0, 2), 10 + cols[0] + cols[1] + cols[2] + cols[3] + 2, y + 5.5);

      y += rowH;
    });

    y += 10;
    doc.setTextColor(...SLATE_600);
    doc.setFontSize(8.5);
    doc.text(
      'Note: Print Room-wise pages (Pages 2-7) and paste each sheet on the respective classroom door & give a copy to the Room Invigilator.',
      10,
      y
    );
  }

  // Room-wise Door Charts
  roomsToExport.forEach((room) => {
    if (pageStarted) doc.addPage('a4', 'portrait');
    pageStarted = true;

    // Header
    doc.setFillColor(...NAVY);
    doc.rect(10, 10, 190, 21, 'F');
    doc.setFillColor(...AMBER);
    doc.rect(10, 30, 190, 1.3, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.text(`E.V.S. PUBLIC SCHOOL — ${room.roomNumber.toUpperCase()}`, 14, 18.5);

    doc.setTextColor(...AMBER);
    doc.setFontSize(9.5);
    doc.text(`${examTitle} (${config.session})`, 14, 25.5);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.text(`Total Students: ${room.totalStudents}  |  Benches: ${room.benches.length}`, 196, 18.5, {
      align: 'right',
    });
    doc.text(
      `Invigilator: ${room.invigilator || '____________________'}`,
      196,
      25.5,
      { align: 'right' }
    );

    // Class Breakdown Bar
    doc.setFillColor(...SLATE_100);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.35);
    doc.rect(10, 34, 190, 10, 'FD');
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.3);
    const clsLine =
      (room.group === 'pre_primary' ? 'Pre-Primary Wing: ' : 'Class 1-8 Wing: ') +
      room.classBreakdown.map((c) => `${c.classLabel} (${c.count})`).join('  |  ');
    doc.text(fitPdfText(doc, clsLine, 184), 13, 40.3);

    // Bench Table Header
    let y = 48;
    const colBench = 18;
    const colSeat = (190 - colBench) / 3; // ~57.3mm per student seat!

    const drawTableHeader = (topY: number) => {
      doc.setFillColor(...NAVY);
      doc.rect(10, topY, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.text('BENCH', 10 + colBench / 2, topY + 5.4, { align: 'center' });
      doc.text('SEAT 1 (LEFT)', 10 + colBench + 2, topY + 5.4);
      doc.text('SEAT 2 (MIDDLE)', 10 + colBench + colSeat + 2, topY + 5.4);
      doc.text('SEAT 3 (RIGHT)', 10 + colBench + colSeat * 2 + 2, topY + 5.4);
      return topY + 8;
    };

    y = drawTableHeader(y);

    const availH = 278 - y;
    const rowH = Math.min(22, Math.max(15, availH / Math.max(room.benches.length, 1)));

    room.benches.forEach((bench, bIdx) => {
      if (y + rowH > 282) {
        doc.addPage('a4', 'portrait');
        y = drawTableHeader(14);
      }

      if (bIdx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y, 190, rowH, 'F');
      }

      doc.setDrawColor(...SLATE_300);
      doc.setLineWidth(0.35);
      doc.rect(10, y, colBench, rowH, 'S');
      for (let s = 0; s < 3; s++) {
        doc.rect(10 + colBench + s * colSeat, y, colSeat, rowH, 'S');
      }

      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`B-${bench.benchNumber}`, 10 + colBench / 2, y + rowH / 2 + 1.5, { align: 'center' });

      for (let s = 0; s < 3; s++) {
        const seat = bench.seats[s];
        const sx = 10 + colBench + s * colSeat;
        if (!seat) {
          doc.setTextColor(160, 160, 160);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.text('— Empty —', sx + colSeat / 2, y + rowH / 2 + 1, { align: 'center' });
          continue;
        }

        doc.setTextColor(...BLACK);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.4);
        doc.text(
          fitPdfText(doc, String(seat.student.Student_Name || '').toUpperCase(), colSeat - 4),
          sx + 2.2,
          y + 5.6
        );

        doc.setTextColor(...NAVY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.0);
        doc.text(
          fitPdfText(
            doc,
            `Class: ${seat.classLabel}  |  Roll: ${seat.student.Roll_Number || '—'}`,
            colSeat - 4
          ),
          sx + 2.2,
          y + 10.2
        );

        doc.setTextColor(...SLATE_600);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.text(
          fitTextSafe(`ID: ${seat.student.Student_ID}   [  ] Present`, colSeat - 4, doc),
          sx + 2.2,
          y + 14.2
        );
      }

      y += rowH;
    });

    // Footer Signature
    doc.setTextColor(...SLATE_600);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Invigilator Sign: ____________________', 14, 289);
    doc.text('Principal / Exam Controller Sign: ____________________', 196, 289, { align: 'right' });
  });

  const safeExam = String(config.examType || 'Exam').replace(/\s+/g, '_');
  const filename =
    selectedRoomKey && selectedRoomKey !== 'ALL' && roomsToExport[0]
      ? `EVS_${safeExam}_Seating_${roomsToExport[0].roomNumber.replace(/\s+/g, '_')}.pdf`
      : `EVS_${safeExam}_Seating_Plan_6_Rooms.pdf`;
  doc.save(filename);
  return filename;
}

function fitTextSafe(text: string, maxW: number, doc: jsPDF): string {
  return fitPdfText(doc, text, maxW);
}

export interface SheetSeatingRow {
  slotKey: string;
  roomNo: string;
  wing: string;
  benchNo: number;
  seatPosition: string;
  studentId: string;
  rollNumber: string;
  studentName: string;
  className: string;
  invigilator: string;
  examType: string;
  session: string;
}

export function flattenSeatingPlanForSheet(
  plan: FullExamSeatingPlan,
  config: HallPassConfig
): SheetSeatingRow[] {
  const out: SheetSeatingRow[] = [];
  for (const room of plan.rooms) {
    const wing = room.group === 'pre_primary' ? 'Play - UKG (M3)' : 'Class 1st - 8th';
    for (const bench of room.benches) {
      for (const seat of bench.seats) {
        out.push({
          slotKey: room.slotKey,
          roomNo: room.roomNumber,
          wing,
          benchNo: bench.benchNumber,
          seatPosition: seat.seatPosition,
          studentId: String(seat.student.Student_ID || ''),
          rollNumber: String(seat.student.Roll_Number || ''),
          studentName: String(seat.student.Student_Name || ''),
          className: seat.classLabel,
          invigilator: room.invigilator || '',
          examType: config.examType || 'Half-Yearly',
          session: config.session || '2026-27',
        });
      }
    }
  }
  return out;
}

export async function fetchExamSeatingPlanRoomMeta(): Promise<Record<string, RoomCustomMeta> | null> {
  try {
    const res = await fetch(`/api/exam-seating-plan?_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': getAppsScriptUrl() },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.roomMeta && typeof json.roomMeta === 'object' && Object.keys(json.roomMeta).length > 0) {
        const merged: Record<string, RoomCustomMeta> = { ...loadSavedRoomMeta() };
        for (const k of Object.keys(DEFAULT_ROOM_META)) {
          if (json.roomMeta[k]) {
            merged[k] = {
              roomNumber: String(json.roomMeta[k].roomNumber || DEFAULT_ROOM_META[k].roomNumber),
              invigilator: String(json.roomMeta[k].invigilator || ''),
            };
          }
        }
        saveRoomMeta(merged);
        return merged;
      }
    }
  } catch {}
  return null;
}

export async function saveExamSeatingPlanToSheet(
  plan: FullExamSeatingPlan,
  config: HallPassConfig,
  roomMeta: Record<string, RoomCustomMeta>
): Promise<{ savedCount: number; sheetSynced: boolean; sheetError?: string }> {
  saveRoomMeta(roomMeta);
  const rows = flattenSeatingPlanForSheet(plan, config);
  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-seating-plan',
    apiBody: { rows, roomMeta },
    directPayload: {
      action: 'saveExamSeatingPlan',
      rows: JSON.stringify(rows),
    },
  });
  return {
    savedCount: rows.length,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
}
