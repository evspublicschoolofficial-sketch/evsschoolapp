import jsPDF from 'jspdf';
import { HallPassConfig, Student } from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { getExamDisplayTitle } from './hallPassHelper';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';

export interface RoomCustomMeta {
  roomNumber: string;
  invigilator: string;
  invigilatorId?: string;
}

export interface SeatingRoomConfig {
  slotKey: string;
  roomNumber: string;
  invigilator: string;
  invigilatorId?: string;
  /** Canonical classCode -> count of students assigned to this room */
  classCounts: Record<string, number>;
}

export type SeatingDistributionMode = 'anti_cheating_mixed' | 'class_grouped';

export type SeatingPlanApprovalStatus = 'draft' | 'pending_approval' | 'approved';

export interface SeatingPlanConfigPayload {
  rooms: SeatingRoomConfig[];
  seatsPerBench: number;
  mode: SeatingDistributionMode;
  status: SeatingPlanApprovalStatus;
  examDate?: string;
  examShift?: string;
  submittedBy?: string;
  submittedById?: string;
  submittedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  teacherNote?: string;
  managerNote?: string;
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

export interface ClassAllocationSummary {
  classCode: string;
  classLabel: string;
  totalStudents: number;
  allocatedCount: number;
  remainingCount: number;
  requestedCount: number;
  overAllocatedBy: number;
}

export interface ExamRoomPlan {
  slotKey: string;
  group: 'pre_primary' | 'upper_1_to_8' | 'mixed';
  groupLabelHi: string;
  defaultRoomName: string;
  roomNumber: string;
  invigilator: string;
  invigilatorId?: string;
  benches: SeatingBench[];
  totalStudents: number;
  adjacentSameClassPairs: number;
  classBreakdown: Array<{ classCode: string; classLabel: string; count: number }>;
}

export interface FullExamSeatingPlan {
  rooms: ExamRoomPlan[];
  totalStudents: number;
  allocatedStudentsCount: number;
  unassignedCount: number;
  unassignedStudents: Array<{ student: Student; classCode: string; classLabel: string }>;
  classSummaries: ClassAllocationSummary[];
  prePrimaryCount: number;
  upperCount: number;
  totalBenches: number;
  totalSameClassConflicts: number;
}

export const SEATING_PLAN_META_STORAGE_KEY = 'evs_exam_seating_rooms_v1';
export const SEATING_PLAN_WORKFLOW_STORAGE_KEY = 'evs_exam_seating_workflow_v2';
export const SEATING_PLAN_HISTORY_STORAGE_KEY = 'evs_exam_seating_history_v1';

export function getTodayIstDateKey(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function formatExamDateDisplay(isoDate?: string | null): string {
  const clean = String(isoDate || '').trim();
  const m = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return clean || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function normalizeExamDateKey(raw?: string | null): string {
  const s = String(raw || '').trim();
  if (!s) return getTodayIstDateKey();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return s.slice(0, 10);
}

export function buildSeatingArchiveKey(examDate?: string | null, examShift?: string | null): string {
  const datePart = normalizeExamDateKey(examDate);
  const shiftClean = String(examShift || '')
    .trim()
    .replace(/\s+/g, ' ');
  return shiftClean ? `${datePart}::${shiftClean.toUpperCase()}` : `${datePart}::MAIN`;
}

export const DEFAULT_ROOM_META: Record<string, RoomCustomMeta> = {
  pre_1: { roomNumber: 'Room 1', invigilator: '' },
  pre_2: { roomNumber: 'Room 2', invigilator: '' },
  upper_1: { roomNumber: 'Room 3', invigilator: '' },
  upper_2: { roomNumber: 'Room 4', invigilator: '' },
  upper_3: { roomNumber: 'Room 5', invigilator: '' },
  upper_4: { roomNumber: 'Room 6', invigilator: '' },
};

const PRE_PRIMARY_ORDER = ['C1', 'C2', 'C3', 'C4'];
const UPPER_ORDER = ['C5', 'C6', 'C7', 'C8', 'C9', 'C10', 'C11', 'C12'];
export const CANONICAL_CLASS_ORDER = [...PRE_PRIMARY_ORDER, ...UPPER_ORDER];

export const DEFAULT_CLASS_NAMES: Record<string, string> = {
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

export function loadLocalSeatingWorkflow(): SeatingPlanConfigPayload | null {
  try {
    const raw = localStorage.getItem(SEATING_PLAN_WORKFLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rooms) && parsed.rooms.length > 0) {
      return {
        rooms: parsed.rooms.map((r: any, idx: number) => ({
          slotKey: String(r?.slotKey || `room_${idx + 1}`),
          roomNumber: String(r?.roomNumber || `Room ${idx + 1}`),
          invigilator: String(r?.invigilator || ''),
          invigilatorId: r?.invigilatorId ? String(r.invigilatorId) : undefined,
          classCounts: r?.classCounts && typeof r.classCounts === 'object' ? { ...r.classCounts } : {},
        })),
        seatsPerBench: [2, 3, 4].includes(Number(parsed.seatsPerBench)) ? Number(parsed.seatsPerBench) : 3,
        mode: parsed.mode === 'class_grouped' ? 'class_grouped' : 'anti_cheating_mixed',
        status:
          parsed.status === 'pending_approval' || parsed.status === 'approved'
            ? parsed.status
            : 'draft',
        examDate: parsed.examDate ? normalizeExamDateKey(parsed.examDate) : getTodayIstDateKey(),
        examShift: parsed.examShift ? String(parsed.examShift) : '',
        submittedBy: parsed.submittedBy ? String(parsed.submittedBy) : undefined,
        submittedById: parsed.submittedById ? String(parsed.submittedById) : undefined,
        submittedAt: parsed.submittedAt ? String(parsed.submittedAt) : undefined,
        approvedBy: parsed.approvedBy ? String(parsed.approvedBy) : undefined,
        approvedAt: parsed.approvedAt ? String(parsed.approvedAt) : undefined,
        teacherNote: parsed.teacherNote ? String(parsed.teacherNote) : undefined,
        managerNote: parsed.managerNote ? String(parsed.managerNote) : undefined,
      };
    }
  } catch {}
  return null;
}

export function saveLocalSeatingWorkflow(payload: SeatingPlanConfigPayload): void {
  try {
    localStorage.setItem(SEATING_PLAN_WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

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

function sortClassCodes(codes: Iterable<string>): string[] {
  return Array.from(new Set(codes)).sort((a, b) => {
    const idxA = CANONICAL_CLASS_ORDER.indexOf(a);
    const idxB = CANONICAL_CLASS_ORDER.indexOf(b);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

/**
 * Generates an anti-cheating balanced 6-room allocation matrix
 * (Rooms 1-2 for Play-M3, Rooms 3-6 for 1st-8th) or distributes across custom rooms.
 */
export function buildAutoBalancedRoomConfigs(opts: {
  students: Student[];
  getClassName: (cls?: string | null) => string;
  existingRooms?: SeatingRoomConfig[];
}): SeatingRoomConfig[] {
  const { students, getClassName, existingRooms } = opts;

  const baseRooms: SeatingRoomConfig[] =
    existingRooms && existingRooms.length > 0
      ? existingRooms.map((r, idx) => ({
          slotKey: r.slotKey || `room_${idx + 1}`,
          roomNumber: String(r.roomNumber || `Room ${idx + 1}`),
          invigilator: String(r.invigilator || ''),
          invigilatorId: r.invigilatorId,
          classCounts: {},
        }))
      : [
          { slotKey: 'pre_1', roomNumber: 'Room 1', invigilator: '', classCounts: {} },
          { slotKey: 'pre_2', roomNumber: 'Room 2', invigilator: '', classCounts: {} },
          { slotKey: 'upper_1', roomNumber: 'Room 3', invigilator: '', classCounts: {} },
          { slotKey: 'upper_2', roomNumber: 'Room 4', invigilator: '', classCounts: {} },
          { slotKey: 'upper_3', roomNumber: 'Room 5', invigilator: '', classCounts: {} },
          { slotKey: 'upper_4', roomNumber: 'Room 6', invigilator: '', classCounts: {} },
        ];

  const validStudents = students.filter((s) => Boolean(String(s.Student_ID || '').trim()));
  const countsByClass = new Map<string, number>();

  for (const s of validStudents) {
    const code = normalizeCanonicalClassCode(s.Class, getClassName(s.Class));
    countsByClass.set(code, (countsByClass.get(code) || 0) + 1);
  }

  const orderedClasses = sortClassCodes(countsByClass.keys());

  // If 6+ rooms and default structure (or >=6 rooms), split Pre-Primary (Play-M3) across first 2 rooms
  // and Classes 1-8 across the remaining rooms so primary kids & senior kids stay in their wings.
  if (baseRooms.length >= 6) {
    const preRooms = baseRooms.slice(0, 2);
    const upperRooms = baseRooms.slice(2);

    const distributeEvenly = (targetClasses: string[], targetRooms: SeatingRoomConfig[]) => {
      if (targetRooms.length === 0) return;
      let cursor = 0;
      for (const cls of targetClasses) {
        const total = countsByClass.get(cls) || 0;
        if (total <= 0) continue;
        const base = Math.floor(total / targetRooms.length);
        const rem = total % targetRooms.length;
        for (let i = 0; i < targetRooms.length; i++) {
          const rIdx = (cursor + i) % targetRooms.length;
          const cnt = base + (i < rem ? 1 : 0);
          if (cnt > 0) {
            targetRooms[rIdx].classCounts[cls] = (targetRooms[rIdx].classCounts[cls] || 0) + cnt;
          }
        }
        cursor = (cursor + rem) % targetRooms.length;
      }
    };

    distributeEvenly(
      orderedClasses.filter((c) => PRE_PRIMARY_ORDER.includes(c)),
      preRooms
    );
    distributeEvenly(
      orderedClasses.filter((c) => !PRE_PRIMARY_ORDER.includes(c)),
      upperRooms
    );
  } else {
    let cursor = 0;
    for (const cls of orderedClasses) {
      const total = countsByClass.get(cls) || 0;
      if (total <= 0) continue;
      const base = Math.floor(total / baseRooms.length);
      const rem = total % baseRooms.length;
      for (let i = 0; i < baseRooms.length; i++) {
        const rIdx = (cursor + i) % baseRooms.length;
        const cnt = base + (i < rem ? 1 : 0);
        if (cnt > 0) {
          baseRooms[rIdx].classCounts[cls] = (baseRooms[rIdx].classCounts[cls] || 0) + cnt;
        }
      }
      cursor = (cursor + rem) % baseRooms.length;
    }
  }

  return baseRooms;
}

export function clearRoomAllocations(rooms: SeatingRoomConfig[]): SeatingRoomConfig[] {
  return rooms.map((r) => ({
    ...r,
    classCounts: {},
  }));
}

interface StudentPoolItem {
  student: Student;
  classCode: string;
  classLabel: string;
}

function getNormalizedSeatX(seatIdx: number, benchCap: number): number {
  if (benchCap <= 1) return 0.5;
  return seatIdx / (benchCap - 1);
}

function computeSameClassPairPenalty(opts: {
  b1: number;
  s1: number;
  cap1: number;
  b2: number;
  s2: number;
  cap2: number;
  spreadWeight: number;
}): number {
  const { b1, s1, cap1, b2, s2, cap2, spreadWeight } = opts;
  const db = Math.abs(b1 - b2);

  if (db === 0) {
    const ds = Math.abs(s1 - s2);
    if (ds === 1) return 50_000_000; // Directly side-by-side on the same bench
    if (ds === 2) return 5_000_000;  // Same bench with 1 seat between
    return 2_500_000;                // Same bench with 2+ seats between
  }

  const x1 = getNormalizedSeatX(s1, cap1);
  const x2 = getNormalizedSeatX(s2, cap2);
  const dx = Math.abs(x1 - x2);

  // Strictly convex inverse-square vertical distance + strong front-to-back neighbor avoidance + opposite-side preference
  const baseDbPenalty = 100_000 / (db * db);
  const nearRowPenalty =
    db === 1
      ? 50_000 * (1.2 - 0.4 * dx)
      : db === 2
      ? 4_000 * (1.1 - 0.25 * dx)
      : 0;
  const colPenalty = (1 - dx) * (2_500 / (db + 0.5));

  return spreadWeight * (baseDbPenalty + nearRowPenalty + colPenalty);
}

function computeSingleClassSpatialCost(
  positions: Array<{ b: number; s: number }>,
  benchCaps: number[],
  spreadWeight: number
): number {
  let total = 0;
  for (let i = 0; i < positions.length; i++) {
    const p1 = positions[i];
    for (let j = i + 1; j < positions.length; j++) {
      const p2 = positions[j];
      total += computeSameClassPairPenalty({
        b1: p1.b,
        s1: p1.s,
        cap1: benchCaps[p1.b],
        b2: p2.b,
        s2: p2.s,
        cap2: benchCaps[p2.b],
        spreadWeight,
      });
    }
  }
  return total;
}

/**
 * Anti-cheating mixed bench allocator for a single room given its exact class pools:
 * 1. Computes bench layout (B benches x seatsPerBench).
 * 2. Places small classes (2 <= k <= B) first on maximally spaced anchor benches
 *    (e.g., 2 students -> Bench 1 Left & Last Bench Right; 3 students -> Bench 1, Middle, Last Bench),
 *    then spreads larger classes evenly across benches, then fills singletons.
 * 3. Runs exhaustive best-improving 2-opt swaps across all (bench, seat) positions to eliminate
 *    horizontal adjacency, avoid consecutive front-to-back stacking, and maximize inter-student distance.
 */
function arrangeRoomStudentsIntoBenches(opts: {
  roomItemsByClass: Array<{ classCode: string; classLabel: string; items: StudentPoolItem[] }>;
  seatsPerBench: number;
  mode: SeatingDistributionMode;
}): SeatingBench[] {
  const { roomItemsByClass, seatsPerBench, mode } = opts;
  const totalInRoom = roomItemsByClass.reduce((s, p) => s + p.items.length, 0);
  if (totalInRoom === 0) return [];

  if (mode === 'class_grouped') {
    const flat: StudentPoolItem[] = [];
    for (const pool of roomItemsByClass) {
      flat.push(...pool.items);
    }
    const benches: SeatingBench[] = [];
    for (let i = 0; i < flat.length; i += seatsPerBench) {
      const slice = flat.slice(i, i + seatsPerBench);
      benches.push({
        benchNumber: benches.length + 1,
        seats: slice.map((item, sIdx) => ({
          ...item,
          seatPosition: getSeatPositionName(sIdx, slice.length),
        })),
      });
    }
    return benches;
  }

  // Anti-cheating mixed spatial allocation
  const B = Math.ceil(totalInRoom / seatsPerBench);
  const benchCaps: number[] = [];
  let rem = totalInRoom;
  for (let b = 0; b < B; b++) {
    const cap = Math.min(seatsPerBench, rem);
    benchCaps.push(cap);
    rem -= cap;
  }

  const benchGrid: Array<Array<StudentPoolItem | null>> = benchCaps.map((cap) =>
    Array.from({ length: cap }, () => null)
  );

  // Per-class spread weight (normalized by pair count k*(k-1)/2):
  // - Small classes (2 <= k <= B) get priority proportional to 1 / (k * (k - 1)) so 2-student classes
  //   reliably claim Bench 1 & Last Bench, and 3-4 student classes spread evenly without crowding them out.
  // - Oversized classes (k > B) already occupy every bench, so their vertical tie-break weight is 0.02
  //   while full Tier 1 (50M) and Tier 2 (5M) same-bench anti-adjacency penalties remain active.
  const classCountMap = new Map<string, number>();
  const classWeightMap = new Map<string, number>();
  for (const pool of roomItemsByClass) {
    const k = pool.items.length;
    classCountMap.set(pool.classCode, k);
    const weight =
      k >= 2 && k <= B && B >= 2
        ? Math.max(0.5, Math.min(20, (B * 3) / (k * (k - 1))))
        : k > B
        ? 0.02
        : 1;
    classWeightMap.set(pool.classCode, weight);
  }

  // Order pools:
  // 1) Small classes (2 <= k <= B) ascending by size (so 2-student classes claim Bench 1 & Bench B opposite corners)
  // 2) Large classes (k > B) descending by size
  // 3) Singletons (k === 1)
  const smallPools = roomItemsByClass
    .filter((p) => p.items.length >= 2 && p.items.length <= B)
    .sort((a, b) => a.items.length - b.items.length);
  const largePools = roomItemsByClass
    .filter((p) => p.items.length > B)
    .sort((a, b) => b.items.length - a.items.length);
  const singletonPools = roomItemsByClass.filter((p) => p.items.length === 1);
  const orderedPools = [...smallPools, ...largePools, ...singletonPools];

  const placedByClass = new Map<string, Array<{ b: number; s: number }>>();

  for (let pIdx = 0; pIdx < orderedPools.length; pIdx++) {
    const pool = orderedPools[pIdx];
    const k = pool.items.length;
    const weight = classWeightMap.get(pool.classCode) || 1;
    const existing = placedByClass.get(pool.classCode) || [];
    const flipSide = pIdx % 2 === 1;

    for (let i = 0; i < k; i++) {
      const targetB =
        k === 1 || B <= 1
          ? Math.floor((B - 1) / 2)
          : Math.round(((i % B) * (B - 1)) / (Math.min(k, B) - 1));
      const preferRight = flipSide ? i % 2 === 0 : i % 2 === 1;

      let bestB = -1;
      let bestS = -1;
      let bestScore = Infinity;

      for (let b = 0; b < B; b++) {
        const cap = benchCaps[b];
        for (let s = 0; s < cap; s++) {
          if (benchGrid[b][s] !== null) continue;

          let score = 0;
          for (const prev of existing) {
            score += computeSameClassPairPenalty({
              b1: b,
              s1: s,
              cap1: cap,
              b2: prev.b,
              s2: prev.s,
              cap2: benchCaps[prev.b],
              spreadWeight: weight,
            });
          }

          // Guide tie-breaker toward ideal evenly spaced anchor bench & alternating outer seat
          score += Math.abs(b - targetB) * 60;
          const x = getNormalizedSeatX(s, cap);
          const targetX = k === 1 ? 0.5 : preferRight ? 1 : 0;
          score += Math.abs(x - targetX) * 20;

          if (score < bestScore) {
            bestScore = score;
            bestB = b;
            bestS = s;
          }
        }
      }

      if (bestB !== -1 && bestS !== -1) {
        benchGrid[bestB][bestS] = pool.items[i];
        existing.push({ b: bestB, s: bestS });
      }
    }

    placedByClass.set(pool.classCode, existing);
  }

  // Flatten occupied slots for 2-opt global spatial optimization
  const slots: Array<{ b: number; s: number; item: StudentPoolItem }> = [];
  for (let b = 0; b < B; b++) {
    for (let s = 0; s < benchCaps[b]; s++) {
      const item = benchGrid[b][s];
      if (item) slots.push({ b, s, item });
    }
  }

  // Build position index per class for fast exact delta evaluation
  const classSlotIndices = new Map<string, number[]>();
  slots.forEach((slot, idx) => {
    const arr = classSlotIndices.get(slot.item.classCode) || [];
    arr.push(idx);
    classSlotIndices.set(slot.item.classCode, arr);
  });

  const getClassCost = (classCode: string): number => {
    const indices = classSlotIndices.get(classCode);
    if (!indices || indices.length <= 1) return 0;
    const weight = classWeightMap.get(classCode) || 1;
    const positions = indices.map((idx) => ({ b: slots[idx].b, s: slots[idx].s }));
    return computeSingleClassSpatialCost(positions, benchCaps, weight);
  };

  // Exhaustive best-improving 2-opt swap pass (converges to global/near-global optimum in <2ms)
  const MAX_SWAPS = 250;
  for (let iter = 0; iter < MAX_SWAPS; iter++) {
    let bestDelta = -1e-6;
    let bestI = -1;
    let bestJ = -1;

    for (let i = 0; i < slots.length; i++) {
      const codeA = slots[i].item.classCode;
      for (let j = i + 1; j < slots.length; j++) {
        const codeB = slots[j].item.classCode;
        if (codeA === codeB) continue;

        const beforeCost = getClassCost(codeA) + getClassCost(codeB);

        // Temporarily swap items between slot i and slot j
        const itemA = slots[i].item;
        const itemB = slots[j].item;
        slots[i].item = itemB;
        slots[j].item = itemA;

        const idxListA = classSlotIndices.get(codeA)!;
        const idxListB = classSlotIndices.get(codeB)!;
        const posInA = idxListA.indexOf(i);
        const posInB = idxListB.indexOf(j);
        idxListA[posInA] = j;
        idxListB[posInB] = i;

        const afterCost = getClassCost(codeA) + getClassCost(codeB);
        const delta = afterCost - beforeCost;

        // Revert temporary swap
        slots[i].item = itemA;
        slots[j].item = itemB;
        idxListA[posInA] = i;
        idxListB[posInB] = j;

        if (delta < bestDelta) {
          bestDelta = delta;
          bestI = i;
          bestJ = j;
        }
      }
    }

    if (bestI === -1 || bestJ === -1) break;

    // Commit the best swap
    const itemA = slots[bestI].item;
    const itemB = slots[bestJ].item;
    const codeA = itemA.classCode;
    const codeB = itemB.classCode;
    slots[bestI].item = itemB;
    slots[bestJ].item = itemA;
    const idxListA = classSlotIndices.get(codeA)!;
    const idxListB = classSlotIndices.get(codeB)!;
    idxListA[idxListA.indexOf(bestI)] = bestJ;
    idxListB[idxListB.indexOf(bestJ)] = bestI;
  }

  // Reconstruct concrete benches in exact (b, s) order
  const finalGrid: StudentPoolItem[][] = benchCaps.map(() => []);
  slots.forEach((slot) => {
    finalGrid[slot.b][slot.s] = slot.item;
  });

  return finalGrid.map((row, bIdx) => ({
    benchNumber: bIdx + 1,
    seats: row.map((item, sIdx) => ({
      ...item,
      seatPosition: getSeatPositionName(sIdx, row.length),
    })),
  }));
}

/**
 * Generates full exam seating plan from custom Teacher Room x Class counts!
 */
export function generateCustomSeatingPlan(opts: {
  students: Student[];
  getClassName: (cls?: string | null) => string;
  roomConfigs: SeatingRoomConfig[];
  seatsPerBench?: number;
  mode?: SeatingDistributionMode;
}): FullExamSeatingPlan {
  const {
    students,
    getClassName,
    roomConfigs,
    seatsPerBench = 3,
    mode = 'anti_cheating_mixed',
  } = opts;

  const sortedAll = sortStudentsForExam(
    students.filter((s) => Boolean(String(s.Student_ID || '').trim()))
  );

  const classQueues = new Map<string, StudentPoolItem[]>();
  const classLabels = new Map<string, string>();
  const totalByClass = new Map<string, number>();

  for (const s of sortedAll) {
    const mappedLabel = getClassName(s.Class);
    const canonCode = normalizeCanonicalClassCode(s.Class, mappedLabel);
    const cleanLabel = DEFAULT_CLASS_NAMES[canonCode] || mappedLabel || s.Class || canonCode;
    classLabels.set(canonCode, cleanLabel);
    totalByClass.set(canonCode, (totalByClass.get(canonCode) || 0) + 1);
    const queue = classQueues.get(canonCode) || [];
    queue.push({ student: s, classCode: canonCode, classLabel: cleanLabel });
    classQueues.set(canonCode, queue);
  }

  // Track requested totals per class across all rooms
  const requestedByClass = new Map<string, number>();
  for (const roomCfg of roomConfigs) {
    for (const [rawCode, rawCount] of Object.entries(roomCfg.classCounts || {})) {
      const code = normalizeCanonicalClassCode(rawCode, DEFAULT_CLASS_NAMES[rawCode]);
      const cnt = Math.max(0, Math.floor(Number(rawCount) || 0));
      if (cnt > 0) {
        requestedByClass.set(code, (requestedByClass.get(code) || 0) + cnt);
        if (!classLabels.has(code)) {
          classLabels.set(code, DEFAULT_CLASS_NAMES[code] || code);
        }
      }
    }
  }

  const allClassCodes = sortClassCodes([
    ...Array.from(totalByClass.keys()),
    ...Array.from(requestedByClass.keys()),
  ]);

  const allocatedByClass = new Map<string, number>();
  const rooms: ExamRoomPlan[] = [];

  for (let rIdx = 0; rIdx < roomConfigs.length; rIdx++) {
    const cfg = roomConfigs[rIdx];
    const roomClassPools: Array<{ classCode: string; classLabel: string; items: StudentPoolItem[] }> = [];

    const roomClassKeys = sortClassCodes(
      Object.keys(cfg.classCounts || {}).filter((k) => (Number(cfg.classCounts[k]) || 0) > 0)
    );

    for (const code of roomClassKeys) {
      const want = Math.max(0, Math.floor(Number(cfg.classCounts[code]) || 0));
      if (want <= 0) continue;
      const queue = classQueues.get(code) || [];
      const takeCount = Math.min(want, queue.length);
      const picked = queue.splice(0, takeCount);
      if (picked.length > 0) {
        allocatedByClass.set(code, (allocatedByClass.get(code) || 0) + picked.length);
        roomClassPools.push({
          classCode: code,
          classLabel: classLabels.get(code) || DEFAULT_CLASS_NAMES[code] || code,
          items: picked,
        });
      }
    }

    const benches = arrangeRoomStudentsIntoBenches({
      roomItemsByClass: roomClassPools,
      seatsPerBench,
      mode,
    });

    let adjacentPairs = 0;
    let totalInRoom = 0;
    for (const b of benches) {
      for (let i = 0; i < b.seats.length; i++) {
        totalInRoom++;
        if (i < b.seats.length - 1 && b.seats[i].classCode === b.seats[i + 1].classCode) {
          adjacentPairs++;
        }
      }
    }

    const classBreakdown = roomClassPools
      .map((p) => ({ classCode: p.classCode, classLabel: p.classLabel, count: p.items.length }))
      .sort((a, b) => {
        const idxA = CANONICAL_CLASS_ORDER.indexOf(a.classCode);
        const idxB = CANONICAL_CLASS_ORDER.indexOf(b.classCode);
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
      });

    const hasPre = classBreakdown.some((c) => PRE_PRIMARY_ORDER.includes(c.classCode));
    const hasUpper = classBreakdown.some((c) => !PRE_PRIMARY_ORDER.includes(c.classCode));
    const group: ExamRoomPlan['group'] =
      hasPre && !hasUpper ? 'pre_primary' : !hasPre && hasUpper ? 'upper_1_to_8' : 'mixed';
    const groupLabelHi =
      group === 'pre_primary'
        ? 'Pre-Primary (Play – M3)'
        : group === 'upper_1_to_8'
        ? 'Class 1st – 8th'
        : classBreakdown.length > 0
        ? `मिक्स्ड (${classBreakdown.map((c) => c.classLabel).slice(0, 3).join(', ')}${
            classBreakdown.length > 3 ? '...' : ''
          })`
        : 'खाली कमरा';

    rooms.push({
      slotKey: cfg.slotKey || `room_${rIdx + 1}`,
      group,
      groupLabelHi,
      defaultRoomName: `Room ${rIdx + 1}`,
      roomNumber: String(cfg.roomNumber || `Room ${rIdx + 1}`).trim(),
      invigilator: String(cfg.invigilator || '').trim(),
      invigilatorId: cfg.invigilatorId ? String(cfg.invigilatorId).trim() : undefined,
      benches,
      totalStudents: totalInRoom,
      adjacentSameClassPairs: adjacentPairs,
      classBreakdown,
    });
  }

  // Remaining unassigned students
  const unassignedStudents: StudentPoolItem[] = [];
  for (const code of allClassCodes) {
    const remQueue = classQueues.get(code) || [];
    unassignedStudents.push(...remQueue);
  }

  const classSummaries: ClassAllocationSummary[] = allClassCodes.map((code) => {
    const totalStudents = totalByClass.get(code) || 0;
    const allocatedCount = allocatedByClass.get(code) || 0;
    const requestedCount = requestedByClass.get(code) || 0;
    return {
      classCode: code,
      classLabel: classLabels.get(code) || DEFAULT_CLASS_NAMES[code] || code,
      totalStudents,
      allocatedCount,
      remainingCount: Math.max(0, totalStudents - allocatedCount),
      requestedCount,
      overAllocatedBy: Math.max(0, requestedCount - totalStudents),
    };
  });

  const prePrimaryCount = sortedAll.filter((s) =>
    PRE_PRIMARY_ORDER.includes(normalizeCanonicalClassCode(s.Class, getClassName(s.Class)))
  ).length;
  const upperCount = sortedAll.length - prePrimaryCount;
  const allocatedStudentsCount = rooms.reduce((sum, r) => sum + r.totalStudents, 0);
  const totalBenches = rooms.reduce((sum, r) => sum + r.benches.length, 0);
  const totalSameClassConflicts = rooms.reduce((sum, r) => sum + r.adjacentSameClassPairs, 0);

  return {
    rooms,
    totalStudents: sortedAll.length,
    allocatedStudentsCount,
    unassignedCount: unassignedStudents.length,
    unassignedStudents,
    classSummaries,
    prePrimaryCount,
    upperCount,
    totalBenches,
    totalSameClassConflicts,
  };
}

/**
 * Legacy-compatible wrapper for fixed 6-room generation
 */
export function generateSixRoomSeatingPlan(opts: {
  students: Student[];
  getClassName: (cls?: string | null) => string;
  roomMeta?: Record<string, RoomCustomMeta>;
  seatsPerBench?: number;
  mode?: SeatingDistributionMode;
}): FullExamSeatingPlan {
  const { students, getClassName, roomMeta = DEFAULT_ROOM_META, seatsPerBench = 3, mode = 'anti_cheating_mixed' } =
    opts;
  const existingRooms: SeatingRoomConfig[] = [
    'pre_1',
    'pre_2',
    'upper_1',
    'upper_2',
    'upper_3',
    'upper_4',
  ].map((slotKey, idx) => ({
    slotKey,
    roomNumber: roomMeta[slotKey]?.roomNumber || DEFAULT_ROOM_META[slotKey]?.roomNumber || `Room ${idx + 1}`,
    invigilator: roomMeta[slotKey]?.invigilator || '',
    classCounts: {},
  }));
  const autoRooms = buildAutoBalancedRoomConfigs({ students, getClassName, existingRooms });
  return generateCustomSeatingPlan({
    students,
    getClassName,
    roomConfigs: autoRooms,
    seatsPerBench,
    mode,
  });
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
  seatsPerBench?: number;
  examDate?: string;
  examShift?: string;
}): string {
  const { plan, config, selectedRoomKey, seatsPerBench = 3, examDate, examShift } = opts;
  const dateSuffix = examDate ? ` · Date: ${formatExamDateDisplay(examDate)}` : '';
  const shiftSuffix = examShift && examShift.trim() ? ` · ${examShift.trim()}` : '';
  const examTitle = getExamDisplayTitle(config.examType, config.customExamTitle);
  const examMetaLine = `${examTitle} (${config.session})${dateSuffix}${shiftSuffix}`;
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
    doc.setFontSize(9.5);
    doc.text(
      fitPdfText(
        doc,
        `${examMetaLine} · Seated: ${plan.allocatedStudentsCount}/${plan.totalStudents} · ${plan.rooms.length} Rooms`,
        184
      ),
      105,
      26.5,
      { align: 'center' }
    );

    doc.setFillColor(...SLATE_100);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.4);
    doc.rect(10, 37, 190, 14, 'FD');
    doc.setTextColor(...BLACK);
    doc.setFontSize(9);
    doc.text(
      `Total Seated: ${plan.allocatedStudentsCount} / ${plan.totalStudents} Students  |  Anti-Cheating Same-Class Pairs: ${plan.totalSameClassConflicts}`,
      14,
      43
    );
    doc.text(`Active Rooms: ${plan.rooms.length}`, 14, 48.5);
    doc.text(`Total Benches: ${plan.totalBenches}`, 196, 45.8, { align: 'right' });

    let y = 57;
    const cols = [26, 36, 22, 20, 86];
    doc.setFillColor(...NAVY);
    doc.rect(10, y, 190, 9, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    let cx = 10;
    ['ROOM NO.', 'INVIGILATOR', 'STUDENTS', 'BENCHES', 'CLASS-WISE COUNT'].forEach((h, i) => {
      doc.text(h, cx + 2, y + 6);
      cx += cols[i];
    });
    y += 9;

    plan.rooms.forEach((room, idx) => {
      if (y > 270) {
        doc.addPage('a4', 'portrait');
        y = 14;
      }
      const rowH = 14;
      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y, 190, rowH, 'F');
      }
      doc.setDrawColor(...SLATE_300);
      doc.setLineWidth(0.3);
      doc.rect(10, y, 190, rowH, 'S');

      const clsSummary = room.classBreakdown.map((c) => `${c.classLabel}: ${c.count}`).join(' · ');

      doc.setTextColor(...BLACK);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(fitPdfText(doc, room.roomNumber, cols[0] - 4), 12, y + 8.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(fitPdfText(doc, room.invigilator || '—', cols[1] - 4), 10 + cols[0] + 2, y + 8.5);

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
    if (y < 280) {
      doc.setTextColor(...SLATE_600);
      doc.setFontSize(8.5);
      doc.text(
        'Note: Print Room-wise pages and paste each sheet on the respective classroom door & hand over a copy to the Room Invigilator.',
        10,
        y
      );
    }
  }

  // Room-wise Door Charts
  roomsToExport.forEach((room) => {
    if (pageStarted) doc.addPage('a4', 'portrait');
    pageStarted = true;

    doc.setFillColor(...NAVY);
    doc.rect(10, 10, 190, 21, 'F');
    doc.setFillColor(...AMBER);
    doc.rect(10, 30, 190, 1.3, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.text(`E.V.S. PUBLIC SCHOOL — ${room.roomNumber.toUpperCase()}`, 14, 18.5);

    doc.setTextColor(...AMBER);
    doc.setFontSize(9);
    doc.text(fitPdfText(doc, examMetaLine, 118), 14, 25.5);

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.text(`Total Students: ${room.totalStudents}  |  Benches: ${room.benches.length}`, 196, 18.5, {
      align: 'right',
    });
    doc.text(`Invigilator: ${room.invigilator || '____________________'}`, 196, 25.5, { align: 'right' });

    doc.setFillColor(...SLATE_100);
    doc.setDrawColor(...NAVY);
    doc.setLineWidth(0.35);
    doc.rect(10, 34, 190, 10, 'FD');
    doc.setTextColor(...NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.3);
    const clsLine =
      'Classes: ' +
      (room.classBreakdown.length > 0
        ? room.classBreakdown.map((c) => `${c.classLabel} (${c.count})`).join('  |  ')
        : 'Empty');
    doc.text(fitPdfText(doc, clsLine, 184), 13, 40.3);

    const benchColsCount = Math.max(2, Math.min(4, seatsPerBench));
    let y = 48;
    const colBench = 18;
    const colSeat = (190 - colBench) / benchColsCount;

    const drawTableHeader = (topY: number) => {
      doc.setFillColor(...NAVY);
      doc.rect(10, topY, 190, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.2);
      doc.text('BENCH', 10 + colBench / 2, topY + 5.4, { align: 'center' });
      const labels =
        benchColsCount === 2
          ? ['SEAT 1 (LEFT)', 'SEAT 2 (RIGHT)']
          : benchColsCount === 4
          ? ['SEAT 1', 'SEAT 2', 'SEAT 3', 'SEAT 4']
          : ['SEAT 1 (LEFT)', 'SEAT 2 (MIDDLE)', 'SEAT 3 (RIGHT)'];
      labels.forEach((lbl, i) => {
        doc.text(lbl, 10 + colBench + colSeat * i + 2, topY + 5.4);
      });
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
      for (let s = 0; s < benchColsCount; s++) {
        doc.rect(10 + colBench + s * colSeat, y, colSeat, rowH, 'S');
      }

      doc.setTextColor(...NAVY);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(`B-${bench.benchNumber}`, 10 + colBench / 2, y + rowH / 2 + 1.5, { align: 'center' });

      for (let s = 0; s < benchColsCount; s++) {
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
        doc.setFontSize(benchColsCount >= 4 ? 8.4 : 9.4);
        doc.text(
          fitPdfText(doc, String(seat.student.Student_Name || '').toUpperCase(), colSeat - 4),
          sx + 2.2,
          y + 5.6
        );

        doc.setTextColor(...NAVY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(benchColsCount >= 4 ? 7.2 : 8.0);
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
        doc.setFontSize(7.0);
        doc.text(
          fitPdfText(doc, `ID: ${seat.student.Student_ID}   [  ] Present`, colSeat - 4),
          sx + 2.2,
          y + 14.2
        );
      }

      y += rowH;
    });

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
      : `EVS_${safeExam}_Seating_Plan_${plan.rooms.length}_Rooms.pdf`;
  doc.save(filename);
  return filename;
}

export type RoomStudentCheckInStatus = 'Pending' | 'Sent to Room' | 'Absent';

export interface SheetSeatingRow {
  archiveKey?: string;
  examDate?: string;
  examShift?: string;
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
  invigilatorId?: string;
  examType: string;
  session: string;
  updatedAt?: string;
  confirmedBy?: string;
  status?: string;
  roomCheckInStatus?: RoomStudentCheckInStatus;
  checkedInAt?: string;
  checkedInBy?: string;
}

export interface ExamSeatingHistoryRoomSummary {
  slotKey: string;
  roomNumber: string;
  invigilator: string;
  invigilatorId?: string;
  totalStudents: number;
  benchesCount: number;
  sentCount?: number;
  absentCount?: number;
  pendingCount?: number;
  dispatchedAt?: string;
  dispatchedBy?: string;
  roomNote?: string;
  classBreakdown: Array<{ classLabel: string; count: number }>;
}

export interface ExamSeatingHistoryEntry {
  archiveKey: string;
  examDate: string;
  examShift: string;
  examType: string;
  session: string;
  confirmedBy: string;
  savedAt: string;
  totalStudents: number;
  totalBenches: number;
  roomsSummary: ExamSeatingHistoryRoomSummary[];
  rows: SheetSeatingRow[];
}

export interface ExamRoomDispatchRecord {
  archiveKey: string;
  slotKey: string;
  roomNumber: string;
  invigilator: string;
  invigilatorId?: string;
  examDate: string;
  examShift: string;
  totalStudents: number;
  sentCount: number;
  absentCount: number;
  pendingCount: number;
  dispatchedBy: string;
  dispatchedById?: string;
  dispatchedAt: string;
  note?: string;
  studentStatuses: Record<string, { status: RoomStudentCheckInStatus; checkedInAt?: string; checkedInBy?: string }>;
}

export function normalizeRoomCheckInStatus(raw?: string | null): RoomStudentCheckInStatus {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'sent to room' || s === 'sent' || s === 'seated' || s === 'present' || s === 'dispatched') {
    return 'Sent to Room';
  }
  if (s === 'absent') return 'Absent';
  return 'Pending';
}

export function flattenSeatingPlanForSheet(
  plan: FullExamSeatingPlan,
  config: HallPassConfig,
  confirmedBy?: string,
  meta?: { examDate?: string; examShift?: string }
): SheetSeatingRow[] {
  const examDate = normalizeExamDateKey(meta?.examDate);
  const examShift = String(meta?.examShift || '').trim();
  const archiveKey = buildSeatingArchiveKey(examDate, examShift);
  const out: SheetSeatingRow[] = [];
  for (const room of plan.rooms) {
    const wing = room.groupLabelHi || (room.group === 'pre_primary' ? 'Play - UKG (M3)' : 'Class 1st - 8th');
    for (const bench of room.benches) {
      for (const seat of bench.seats) {
        out.push({
          archiveKey,
          examDate,
          examShift,
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
          invigilatorId: room.invigilatorId || '',
          examType: config.examType || 'Half-Yearly',
          session: config.session || '2026-27',
          confirmedBy: confirmedBy || '',
          status: 'Approved',
          roomCheckInStatus: 'Pending',
        });
      }
    }
  }
  return out;
}

export function buildHistoryEntriesFromRows(rows: SheetSeatingRow[]): ExamSeatingHistoryEntry[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const grouped = new Map<string, SheetSeatingRow[]>();

  for (const row of rows) {
    if (!row || (!row.studentId && !row.studentName && !row.roomNo)) continue;
    const examDate = normalizeExamDateKey(row.examDate || (row.updatedAt ? String(row.updatedAt).slice(0, 10) : ''));
    const examShift = String(row.examShift || '').trim();
    const archiveKey = String(row.archiveKey || '').trim() || buildSeatingArchiveKey(examDate, examShift);
    const normalizedRow: SheetSeatingRow = {
      ...row,
      archiveKey,
      examDate,
      examShift,
      roomCheckInStatus: normalizeRoomCheckInStatus(row.roomCheckInStatus),
    };
    const arr = grouped.get(archiveKey) || [];
    arr.push(normalizedRow);
    grouped.set(archiveKey, arr);
  }

  const entries: ExamSeatingHistoryEntry[] = [];
  for (const [archiveKey, grpRows] of grouped.entries()) {
    const first = grpRows[0];
    const roomMap = new Map<
      string,
      {
        slotKey: string;
        roomNumber: string;
        invigilator: string;
        invigilatorId: string;
        totalStudents: number;
        sentCount: number;
        absentCount: number;
        pendingCount: number;
        dispatchedAt: string;
        dispatchedBy: string;
        benchesSet: Set<number>;
        classCounts: Map<string, number>;
      }
    >();

    for (const r of grpRows) {
      const rKey = r.slotKey || r.roomNo || 'Room';
      let rm = roomMap.get(rKey);
      if (!rm) {
        rm = {
          slotKey: r.slotKey || rKey,
          roomNumber: r.roomNo || rKey,
          invigilator: r.invigilator || '',
          invigilatorId: r.invigilatorId || '',
          totalStudents: 0,
          sentCount: 0,
          absentCount: 0,
          pendingCount: 0,
          dispatchedAt: '',
          dispatchedBy: '',
          benchesSet: new Set<number>(),
          classCounts: new Map<string, number>(),
        };
        roomMap.set(rKey, rm);
      }
      if (!rm.invigilator && r.invigilator) rm.invigilator = r.invigilator;
      if (!rm.invigilatorId && r.invigilatorId) rm.invigilatorId = r.invigilatorId;
      rm.totalStudents++;
      const checkStatus = normalizeRoomCheckInStatus(r.roomCheckInStatus);
      if (checkStatus === 'Sent to Room') rm.sentCount++;
      else if (checkStatus === 'Absent') rm.absentCount++;
      else rm.pendingCount++;
      if (r.checkedInAt && (!rm.dispatchedAt || r.checkedInAt > rm.dispatchedAt)) {
        rm.dispatchedAt = r.checkedInAt;
      }
      if (r.checkedInBy && !rm.dispatchedBy) rm.dispatchedBy = r.checkedInBy;
      if (r.benchNo) rm.benchesSet.add(Number(r.benchNo));
      const cls = r.className || 'Class';
      rm.classCounts.set(cls, (rm.classCounts.get(cls) || 0) + 1);
    }

    const roomsSummary: ExamSeatingHistoryRoomSummary[] = Array.from(roomMap.values()).map((rm) => ({
      slotKey: rm.slotKey,
      roomNumber: rm.roomNumber,
      invigilator: rm.invigilator,
      invigilatorId: rm.invigilatorId || undefined,
      totalStudents: rm.totalStudents,
      benchesCount: rm.benchesSet.size || 1,
      sentCount: rm.sentCount,
      absentCount: rm.absentCount,
      pendingCount: rm.pendingCount,
      dispatchedAt: rm.dispatchedAt || undefined,
      dispatchedBy: rm.dispatchedBy || undefined,
      classBreakdown: Array.from(rm.classCounts.entries()).map(([classLabel, count]) => ({
        classLabel,
        count,
      })),
    }));

    const totalBenches = roomsSummary.reduce((s, r) => s + r.benchesCount, 0);
    entries.push({
      archiveKey,
      examDate: first.examDate || getTodayIstDateKey(),
      examShift: first.examShift || '',
      examType: first.examType || 'Exam',
      session: first.session || '2026-27',
      confirmedBy: first.confirmedBy || 'Manager',
      savedAt: first.updatedAt || `${first.examDate || ''} 09:00:00`,
      totalStudents: grpRows.length,
      totalBenches,
      roomsSummary,
      rows: grpRows,
    });
  }

  return entries.sort((a, b) => {
    const dCmp = b.examDate.localeCompare(a.examDate);
    if (dCmp !== 0) return dCmp;
    return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
  });
}

export function buildExamSeatingPlanFromHistoryEntry(
  entry: ExamSeatingHistoryEntry
): { plan: FullExamSeatingPlan; seatsPerBench: number } {
  const roomsByKey = new Map<string, SheetSeatingRow[]>();
  const roomOrder: string[] = [];

  for (const r of entry.rows || []) {
    const rKey = r.slotKey || r.roomNo || 'Room';
    if (!roomsByKey.has(rKey)) {
      roomsByKey.set(rKey, []);
      roomOrder.push(rKey);
    }
    roomsByKey.get(rKey)!.push(r);
  }

  let detectedSeatsPerBench = 2;
  const rooms: ExamRoomPlan[] = roomOrder.map((rKey, rIdx) => {
    const rRows = roomsByKey.get(rKey) || [];
    const benchesMap = new Map<number, SheetSeatingRow[]>();
    for (const r of rRows) {
      const bNo = Math.max(1, Number(r.benchNo) || 1);
      const list = benchesMap.get(bNo) || [];
      list.push(r);
      benchesMap.set(bNo, list);
    }

    const posRank = (pos: string): number => {
      const p = String(pos || '').toLowerCase();
      if (p.includes('left')) return 0;
      if (p.includes('middle')) return 1;
      if (p.includes('right')) return 2;
      if (p.includes('4')) return 3;
      return 4;
    };

    const sortedBenchNos = Array.from(benchesMap.keys()).sort((a, b) => a - b);
    const benches: SeatingBench[] = sortedBenchNos.map((bNo) => {
      const seatRows = [...(benchesMap.get(bNo) || [])].sort(
        (a, b) => posRank(a.seatPosition) - posRank(b.seatPosition)
      );
      if (seatRows.length > detectedSeatsPerBench) {
        detectedSeatsPerBench = Math.min(4, seatRows.length);
      }
      return {
        benchNumber: bNo,
        seats: seatRows.map((sr, sIdx) => {
          const canonCode = normalizeCanonicalClassCode(sr.className, sr.className);
          const posName: SeatingBenchSeat['seatPosition'] =
            sr.seatPosition === 'Left' ||
            sr.seatPosition === 'Middle' ||
            sr.seatPosition === 'Right' ||
            sr.seatPosition === 'Seat 4'
              ? sr.seatPosition
              : getSeatPositionName(sIdx, seatRows.length);
          return {
            student: {
              Student_ID: sr.studentId || `HIS-${bNo}-${sIdx}`,
              Admission_Number: '',
              Roll_Number: sr.rollNumber || '',
              Student_Name: sr.studentName || 'Student',
              Class: canonCode,
              Father_Name: '',
              Mother_Name: '',
              Parent_Mobile: '',
            },
            classCode: canonCode,
            classLabel: sr.className || DEFAULT_CLASS_NAMES[canonCode] || canonCode,
            seatPosition: posName,
          };
        }),
      };
    });

    const classMap = new Map<string, { classCode: string; classLabel: string; count: number }>();
    let adjacentSameClassPairs = 0;
    for (const b of benches) {
      for (let i = 0; i < b.seats.length; i++) {
        const s = b.seats[i];
        const prev = classMap.get(s.classCode);
        if (prev) prev.count++;
        else classMap.set(s.classCode, { classCode: s.classCode, classLabel: s.classLabel, count: 1 });
        if (i < b.seats.length - 1 && s.classCode === b.seats[i + 1].classCode) {
          adjacentSameClassPairs++;
        }
      }
    }

    const firstRow = rRows[0];
    const classBreakdown = Array.from(classMap.values()).map((c) => ({
      classCode: c.classCode,
      classLabel: c.classLabel,
      count: c.count,
    }));

    return {
      slotKey: firstRow?.slotKey || rKey,
      group: 'mixed' as const,
      groupLabelHi: firstRow?.wing || 'Exam Room',
      defaultRoomName: `Room ${rIdx + 1}`,
      roomNumber: firstRow?.roomNo || rKey,
      invigilator: firstRow?.invigilator || '',
      benches,
      totalStudents: rRows.length,
      adjacentSameClassPairs,
      classBreakdown,
    };
  });

  const totalStudents = rooms.reduce((s, r) => s + r.totalStudents, 0);
  const totalBenches = rooms.reduce((s, r) => s + r.benches.length, 0);
  const totalSameClassConflicts = rooms.reduce((s, r) => s + r.adjacentSameClassPairs, 0);

  return {
    seatsPerBench: detectedSeatsPerBench,
    plan: {
      rooms,
      totalStudents,
      allocatedStudentsCount: totalStudents,
      unassignedCount: 0,
      unassignedStudents: [],
      classSummaries: [],
      prePrimaryCount: 0,
      upperCount: totalStudents,
      totalBenches,
      totalSameClassConflicts,
    },
  };
}

export function loadLocalSeatingHistory(): ExamSeatingHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SEATING_PLAN_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalSeatingHistory(entries: ExamSeatingHistoryEntry[]): void {
  try {
    localStorage.setItem(SEATING_PLAN_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, 60)));
  } catch {}
}

export function mergeSeatingHistoryLists(
  primary: ExamSeatingHistoryEntry[],
  secondary: ExamSeatingHistoryEntry[]
): ExamSeatingHistoryEntry[] {
  const byKey = new Map<string, ExamSeatingHistoryEntry>();
  for (const item of secondary) {
    if (item?.archiveKey) byKey.set(item.archiveKey, item);
  }
  for (const item of primary) {
    if (item?.archiveKey) byKey.set(item.archiveKey, item);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const dCmp = String(b.examDate || '').localeCompare(String(a.examDate || ''));
    if (dCmp !== 0) return dCmp;
    return String(b.savedAt || '').localeCompare(String(a.savedAt || ''));
  });
}

export interface ExamSeatingSnapshot {
  rows: SheetSeatingRow[];
  roomMeta: Record<string, RoomCustomMeta>;
  draftConfig: SeatingPlanConfigPayload | null;
  approvedConfig: SeatingPlanConfigPayload | null;
  roomDispatches?: Record<string, ExamRoomDispatchRecord>;
  updatedAt?: string;
}

export async function fetchExamSeatingPlanSnapshot(forceRefresh = false): Promise<ExamSeatingSnapshot | null> {
  const activeUrl = getAppsScriptUrl();
  const buildSnapshot = (json: any): ExamSeatingSnapshot => {
    const draftConfig = json?.draftConfig && Array.isArray(json.draftConfig.rooms) ? json.draftConfig : null;
    const approvedConfig =
      json?.approvedConfig && Array.isArray(json.approvedConfig.rooms) ? json.approvedConfig : null;
    const roomMeta: Record<string, RoomCustomMeta> = { ...loadSavedRoomMeta() };
    if (json?.roomMeta && typeof json.roomMeta === 'object') {
      for (const [k, v] of Object.entries<any>(json.roomMeta)) {
        if (v && typeof v === 'object') {
          roomMeta[k] = {
            roomNumber: String(v.roomNumber || k),
            invigilator: String(v.invigilator || ''),
            invigilatorId: v.invigilatorId ? String(v.invigilatorId) : undefined,
          };
        }
      }
      saveRoomMeta(roomMeta);
    }
    const roomDispatches: Record<string, ExamRoomDispatchRecord> =
      json?.roomDispatches && typeof json.roomDispatches === 'object' ? json.roomDispatches : {};
    return {
      rows: Array.isArray(json?.rows) ? json.rows : [],
      roomMeta,
      draftConfig,
      approvedConfig,
      roomDispatches,
      updatedAt: json?.updatedAt,
    };
  };

  let apiSnap: ExamSeatingSnapshot | null = null;
  try {
    const res = await fetch(`/api/exam-seating-plan${forceRefresh ? '?refresh=1&' : '?'}_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': activeUrl },
      cache: 'no-store',
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      const json = await res.json();
      apiSnap = buildSnapshot(json);
      if (json?.sheetSynced) {
        return apiSnap;
      }
    }
  } catch {}

  // Direct Google Apps Script fallback (essential on Vercel / static hosting or when server cache is stale)
  try {
    const direct = await directGetFromSheet('getExamSeatingPlan', activeUrl);
    if (direct.ok && direct.json) {
      return buildSnapshot(direct.json);
    }
  } catch {}

  return apiSnap;
}

export async function fetchExamSeatingHistory(forceRefresh = false): Promise<{
  entries: ExamSeatingHistoryEntry[];
  sheetSynced: boolean;
}> {
  const activeUrl = getAppsScriptUrl();
  const localEntries = loadLocalSeatingHistory();
  let serverEntries: ExamSeatingHistoryEntry[] = [];
  let sheetSynced = false;

  try {
    const res = await fetch(`/api/exam-seating-history${forceRefresh ? '?refresh=1&' : '?'}_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': activeUrl },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
      const json = await res.json();
      if (Array.isArray(json?.entries)) {
        serverEntries = json.entries;
      } else if (Array.isArray(json?.rows)) {
        serverEntries = buildHistoryEntriesFromRows(json.rows);
      }
      sheetSynced = Boolean(json?.sheetSynced);
    }
  } catch {}

  if (!sheetSynced) {
    try {
      const direct = await directGetFromSheet('getExamSeatingHistory', activeUrl);
      if (direct.ok && direct.json) {
        const sheetEntries = Array.isArray(direct.json.entries)
          ? direct.json.entries
          : Array.isArray(direct.json.rows)
          ? buildHistoryEntriesFromRows(direct.json.rows)
          : [];
        if (sheetEntries.length > 0 || direct.json.status === 'success') {
          sheetSynced = true;
          const merged = mergeSeatingHistoryLists(sheetEntries, mergeSeatingHistoryLists(serverEntries, localEntries));
          saveLocalSeatingHistory(merged);
          return { entries: merged, sheetSynced };
        }
      }
    } catch {}
  }

  const merged = mergeSeatingHistoryLists(serverEntries, localEntries);
  if (merged.length > 0) saveLocalSeatingHistory(merged);
  return { entries: merged, sheetSynced };
}

export async function deleteExamSeatingHistoryEntry(
  archiveKey: string
): Promise<{ serverOk: boolean; sheetSynced: boolean }> {
  const nextLocal = loadLocalSeatingHistory().filter((e) => e.archiveKey !== archiveKey);
  saveLocalSeatingHistory(nextLocal);
  const syncRes = await dualSyncWriteToSheet({
    apiPath: `/api/exam-seating-history/${encodeURIComponent(archiveKey)}`,
    method: 'DELETE',
    apiBody: { archiveKey },
    directPayload: {
      action: 'deleteExamSeatingHistory',
      archiveKey,
    },
  });
  return { serverOk: syncRes.serverOk, sheetSynced: syncRes.sheetSynced };
}

export async function fetchExamSeatingPlanRoomMeta(): Promise<Record<string, RoomCustomMeta> | null> {
  const snap = await fetchExamSeatingPlanSnapshot();
  return snap ? snap.roomMeta : null;
}

const compactSeatingDraftPayload = (draft: SeatingPlanConfigPayload): SeatingPlanConfigPayload => ({
  ...draft,
  rooms: (draft.rooms || []).map((r) => {
    const compactCounts: Record<string, number> = {};
    for (const [cls, cnt] of Object.entries(r.classCounts || {})) {
      const num = Number(cnt) || 0;
      if (num > 0) compactCounts[cls] = num;
    }
    return {
      ...r,
      classCounts: compactCounts,
    };
  }),
});

/**
 * Teacher saves or submits Room x Class allocation draft for Manager confirmation.
 * Does NOT overwrite Exam_Seating_Plan Sheet tab until Manager approves!
 */
export async function saveTeacherSeatingDraft(
  draftConfig: SeatingPlanConfigPayload
): Promise<{ serverOk: boolean; sheetSynced: boolean; sheetError?: string }> {
  const compacted = compactSeatingDraftPayload(draftConfig);
  saveLocalSeatingWorkflow(compacted);
  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-seating-plan/draft',
    apiBody: { draftConfig: compacted },
    directPayload: {
      action: 'saveExamSeatingDraft',
      draftConfig: JSON.stringify(compacted),
    },
  });
  return {
    serverOk: syncRes.serverOk,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
}

/**
 * Manager confirms the Seating Plan and saves all seats permanently to Google Sheet:
 * 1) "Exam_Seating_Plan" tab (active/latest display)
 * 2) "Exam_Seating_History" tab (date + shift permanent searchable archive)
 */
export async function saveExamSeatingPlanToSheet(
  plan: FullExamSeatingPlan,
  config: HallPassConfig,
  roomMeta: Record<string, RoomCustomMeta>,
  approvedConfig?: SeatingPlanConfigPayload
): Promise<{ savedCount: number; sheetSynced: boolean; historySaved?: boolean; sheetError?: string }> {
  saveRoomMeta(roomMeta);
  if (approvedConfig) {
    saveLocalSeatingWorkflow(approvedConfig);
  }
  const examDate = normalizeExamDateKey(approvedConfig?.examDate);
  const examShift = String(approvedConfig?.examShift || '').trim();
  const rows = flattenSeatingPlanForSheet(plan, config, approvedConfig?.approvedBy, {
    examDate,
    examShift,
  });

  // Immediately persist to local browser history archive so history search works instantaneously
  const historyBatch = buildHistoryEntriesFromRows(rows);
  if (historyBatch.length > 0) {
    const mergedLocal = mergeSeatingHistoryLists(historyBatch, loadLocalSeatingHistory());
    saveLocalSeatingHistory(mergedLocal);
  }

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-seating-plan',
    apiBody: { rows, roomMeta, approvedConfig, examDate, examShift },
    directPayload: {
      action: 'saveExamSeatingPlan',
      rows: JSON.stringify(rows),
      examDate,
      examShift,
      approvedConfig: approvedConfig ? JSON.stringify(approvedConfig) : '',
    },
  });
  return {
    savedCount: rows.length,
    sheetSynced: syncRes.sheetSynced,
    historySaved: syncRes.serverOk || syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
}

export interface TeacherAssignedRoomStudent {
  studentId: string;
  rollNumber: string;
  studentName: string;
  classCode: string;
  classLabel: string;
  benchNumber: number;
  seatPosition: SeatingBenchSeat['seatPosition'];
  roomCheckInStatus: RoomStudentCheckInStatus;
  checkedInAt?: string;
  checkedInBy?: string;
}

export interface TeacherAssignedRoomView {
  archiveKey: string;
  examDate: string;
  examShift: string;
  examType: string;
  session: string;
  slotKey: string;
  roomNumber: string;
  wing: string;
  invigilator: string;
  invigilatorId?: string;
  benches: SeatingBench[];
  totalStudents: number;
  classBreakdown: Array<{ classCode: string; classLabel: string; count: number }>;
  studentsList: TeacherAssignedRoomStudent[];
  sentCount: number;
  absentCount: number;
  pendingCount: number;
  dispatchedAt?: string;
  dispatchedBy?: string;
  note?: string;
  sourceStatus: 'approved' | 'draft' | 'history';
  plan: FullExamSeatingPlan;
  seatsPerBench: number;
}

const cleanTeacherNameToken = (name?: string | null): string =>
  String(name || '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|shri|smt|dr|prof|sir|mam|ma'am|maam|ji)\b\.?/gi, ' ')
    .replace(/[^a-z0-9\u0900-\u097f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function doesRoomBelongToTeacher(opts: {
  roomInvigilator?: string | null;
  roomInvigilatorId?: string | null;
  teacherId?: string | null;
  teacherName?: string | null;
  teacherUsername?: string | null;
}): boolean {
  const { roomInvigilator, roomInvigilatorId, teacherId, teacherName, teacherUsername } = opts;
  const rId = String(roomInvigilatorId || '').trim().toLowerCase();
  const tId = String(teacherId || '').trim().toLowerCase();
  if (rId && tId && rId === tId) return true;

  const rawInvig = String(roomInvigilator || '').trim().toLowerCase();
  if (!rawInvig) return false;
  if (tId && rawInvig === tId) return true;

  const rawTName = String(teacherName || '').trim().toLowerCase();
  const rawTUser = String(teacherUsername || '').trim().toLowerCase();
  if (rawTName && rawInvig === rawTName) return true;
  if (rawTUser && rawInvig === rawTUser) return true;

  const cleanInvig = cleanTeacherNameToken(roomInvigilator);
  const cleanTName = cleanTeacherNameToken(teacherName);
  if (!cleanInvig || !cleanTName) return false;
  if (cleanInvig === cleanTName) return true;

  // Allow matching when one contains the full first+last or single name token (>= 3 chars)
  const invigWords = cleanInvig.split(' ').filter((w) => w.length >= 3);
  const teacherWords = cleanTName.split(' ').filter((w) => w.length >= 3);
  if (invigWords.length === 1 && teacherWords.length > 0 && invigWords[0] === teacherWords[0]) {
    return true;
  }
  if (teacherWords.length === 1 && invigWords.length > 0 && teacherWords[0] === invigWords[0]) {
    return true;
  }
  return false;
}

export function findTeacherAssignedRooms(opts: {
  snapshot: ExamSeatingSnapshot | null;
  historyEntries: ExamSeatingHistoryEntry[];
  students: Student[];
  getClassName: (cls?: string | null) => string;
  config: HallPassConfig;
  teacherId?: string;
  teacherName?: string;
  teacherUsername?: string;
}): TeacherAssignedRoomView[] {
  const {
    snapshot,
    historyEntries,
    students,
    getClassName,
    config,
    teacherId,
    teacherName,
    teacherUsername,
  } = opts;

  if (!teacherId && !teacherName && !teacherUsername) return [];

  const todayKey = getTodayIstDateKey();
  const activeConfig =
    snapshot?.approvedConfig && snapshot.approvedConfig.rooms?.length
      ? snapshot.approvedConfig
      : snapshot?.draftConfig && snapshot.draftConfig.rooms?.length
      ? snapshot.draftConfig
      : null;

  const dispatchesMap = snapshot?.roomDispatches || {};
  const results: TeacherAssignedRoomView[] = [];
  const seenRoomKey = new Set<string>();

  const buildStudentDispatchMapForRoom = (archiveKey: string, slotKey: string, roomNo: string) => {
    const map = new Map<
      string,
      { status: RoomStudentCheckInStatus; checkedInAt?: string; checkedInBy?: string }
    >();
    let roomDispatchedAt = '';
    let roomDispatchedBy = '';
    let roomNote = '';

    const exactHist = historyEntries.find((h) => h.archiveKey === archiveKey);
    const rowSources = [
      ...(exactHist?.rows || []),
      ...(snapshot?.rows || []).filter((r) => {
        const rKey =
          String(r.archiveKey || '').trim() ||
          buildSeatingArchiveKey(r.examDate || todayKey, r.examShift || '');
        return rKey === archiveKey || !r.archiveKey;
      }),
    ];

    for (const r of rowSources) {
      if (r.slotKey !== slotKey && r.roomNo !== roomNo) continue;
      const st = normalizeRoomCheckInStatus(r.roomCheckInStatus);
      const sId = String(r.studentId || '').trim();
      if (!sId) continue;
      const existing = map.get(sId);
      if (!existing || st !== 'Pending') {
        map.set(sId, {
          status: st,
          checkedInAt: r.checkedInAt,
          checkedInBy: r.checkedInBy,
        });
      }
      if (r.checkedInAt && (!roomDispatchedAt || r.checkedInAt > roomDispatchedAt)) {
        roomDispatchedAt = r.checkedInAt;
      }
      if (r.checkedInBy && !roomDispatchedBy) roomDispatchedBy = r.checkedInBy;
    }

    const dispatchKey = `${archiveKey}::${slotKey}`;
    const disp = dispatchesMap[dispatchKey] || dispatchesMap[`${archiveKey}::${roomNo}`];
    if (disp) {
      if (disp.dispatchedAt) roomDispatchedAt = disp.dispatchedAt;
      if (disp.dispatchedBy) roomDispatchedBy = disp.dispatchedBy;
      if (disp.note) roomNote = disp.note;
      if (disp.studentStatuses) {
        for (const [sId, stInfo] of Object.entries(disp.studentStatuses)) {
          map.set(sId, {
            status: normalizeRoomCheckInStatus(stInfo.status),
            checkedInAt: stInfo.checkedInAt || disp.dispatchedAt,
            checkedInBy: stInfo.checkedInBy || disp.dispatchedBy,
          });
        }
      }
    }

    return { map, roomDispatchedAt, roomDispatchedBy, roomNote };
  };

  if (activeConfig) {
    const examDate = normalizeExamDateKey(activeConfig.examDate || todayKey);
    const examShift = String(activeConfig.examShift || '').trim();
    const archiveKey = buildSeatingArchiveKey(examDate, examShift);

    const matchingRoomsCfg = activeConfig.rooms.filter((r) =>
      doesRoomBelongToTeacher({
        roomInvigilator: r.invigilator,
        roomInvigilatorId: r.invigilatorId,
        teacherId,
        teacherName,
        teacherUsername,
      })
    );

    if (matchingRoomsCfg.length > 0) {
      const fullPlan = generateCustomSeatingPlan({
        students,
        getClassName,
        roomConfigs: activeConfig.rooms,
        seatsPerBench: activeConfig.seatsPerBench || 3,
        mode: activeConfig.mode || 'anti_cheating_mixed',
      });

      for (const roomPlan of fullPlan.rooms) {
        const matches = doesRoomBelongToTeacher({
          roomInvigilator: roomPlan.invigilator,
          roomInvigilatorId: roomPlan.invigilatorId,
          teacherId,
          teacherName,
          teacherUsername,
        });
        if (!matches || roomPlan.totalStudents === 0) continue;

        const uniq = `${archiveKey}::${roomPlan.slotKey}`;
        if (seenRoomKey.has(uniq)) continue;
        seenRoomKey.add(uniq);

        const { map, roomDispatchedAt, roomDispatchedBy, roomNote } = buildStudentDispatchMapForRoom(
          archiveKey,
          roomPlan.slotKey,
          roomPlan.roomNumber
        );

        const studentsList: TeacherAssignedRoomStudent[] = [];
        let sentCount = 0;
        let absentCount = 0;
        let pendingCount = 0;

        for (const bench of roomPlan.benches) {
          for (const seat of bench.seats) {
            const sId = String(seat.student.Student_ID || '').trim();
            const saved = map.get(sId);
            const checkStatus: RoomStudentCheckInStatus = saved ? saved.status : 'Pending';
            if (checkStatus === 'Sent to Room') sentCount++;
            else if (checkStatus === 'Absent') absentCount++;
            else pendingCount++;
            studentsList.push({
              studentId: sId,
              rollNumber: String(seat.student.Roll_Number || ''),
              studentName: String(seat.student.Student_Name || ''),
              classCode: seat.classCode,
              classLabel: seat.classLabel,
              benchNumber: bench.benchNumber,
              seatPosition: seat.seatPosition,
              roomCheckInStatus: checkStatus,
              checkedInAt: saved?.checkedInAt,
              checkedInBy: saved?.checkedInBy,
            });
          }
        }

        results.push({
          archiveKey,
          examDate,
          examShift,
          examType: String(config.examType || 'Half-Yearly'),
          session: String(config.session || '2026-27'),
          slotKey: roomPlan.slotKey,
          roomNumber: roomPlan.roomNumber,
          wing: roomPlan.groupLabelHi,
          invigilator: roomPlan.invigilator,
          invigilatorId: roomPlan.invigilatorId,
          benches: roomPlan.benches,
          totalStudents: roomPlan.totalStudents,
          classBreakdown: roomPlan.classBreakdown,
          studentsList,
          sentCount,
          absentCount,
          pendingCount,
          dispatchedAt: roomDispatchedAt || undefined,
          dispatchedBy: roomDispatchedBy || undefined,
          note: roomNote || undefined,
          sourceStatus: activeConfig.status === 'approved' ? 'approved' : 'draft',
          plan: {
            ...fullPlan,
            rooms: [roomPlan],
            allocatedStudentsCount: roomPlan.totalStudents,
            totalBenches: roomPlan.benches.length,
          },
          seatsPerBench: activeConfig.seatsPerBench || 3,
        });
      }
    }
  }

  // Fallback / additional rooms from Today's saved Exam_Seating_History if not already present
  for (const entry of historyEntries) {
    if (entry.examDate !== todayKey && results.length > 0) continue;
    if (results.length > 0 && entry.examDate !== results[0]?.examDate) continue;
    const rebuilt = buildExamSeatingPlanFromHistoryEntry(entry);
    for (const roomPlan of rebuilt.plan.rooms) {
      const uniq = `${entry.archiveKey}::${roomPlan.slotKey}`;
      if (seenRoomKey.has(uniq)) continue;
      const roomRows = entry.rows.filter(
        (r) => r.slotKey === roomPlan.slotKey || r.roomNo === roomPlan.roomNumber
      );
      const invigId = roomRows.find((r) => r.invigilatorId)?.invigilatorId;
      if (
        !doesRoomBelongToTeacher({
          roomInvigilator: roomPlan.invigilator,
          roomInvigilatorId: invigId,
          teacherId,
          teacherName,
          teacherUsername,
        })
      ) {
        continue;
      }
      seenRoomKey.add(uniq);

      const { map, roomDispatchedAt, roomDispatchedBy, roomNote } = buildStudentDispatchMapForRoom(
        entry.archiveKey,
        roomPlan.slotKey,
        roomPlan.roomNumber
      );

      const studentsList: TeacherAssignedRoomStudent[] = [];
      let sentCount = 0;
      let absentCount = 0;
      let pendingCount = 0;
      for (const bench of roomPlan.benches) {
        for (const seat of bench.seats) {
          const sId = String(seat.student.Student_ID || '').trim();
          const saved = map.get(sId);
          const checkStatus: RoomStudentCheckInStatus = saved ? saved.status : 'Pending';
          if (checkStatus === 'Sent to Room') sentCount++;
          else if (checkStatus === 'Absent') absentCount++;
          else pendingCount++;
          studentsList.push({
            studentId: sId,
            rollNumber: String(seat.student.Roll_Number || ''),
            studentName: String(seat.student.Student_Name || ''),
            classCode: seat.classCode,
            classLabel: seat.classLabel,
            benchNumber: bench.benchNumber,
            seatPosition: seat.seatPosition,
            roomCheckInStatus: checkStatus,
            checkedInAt: saved?.checkedInAt,
            checkedInBy: saved?.checkedInBy,
          });
        }
      }

      results.push({
        archiveKey: entry.archiveKey,
        examDate: entry.examDate,
        examShift: entry.examShift,
        examType: entry.examType,
        session: entry.session,
        slotKey: roomPlan.slotKey,
        roomNumber: roomPlan.roomNumber,
        wing: roomPlan.groupLabelHi,
        invigilator: roomPlan.invigilator,
        invigilatorId: invigId,
        benches: roomPlan.benches,
        totalStudents: roomPlan.totalStudents,
        classBreakdown: roomPlan.classBreakdown,
        studentsList,
        sentCount,
        absentCount,
        pendingCount,
        dispatchedAt: roomDispatchedAt || undefined,
        dispatchedBy: roomDispatchedBy || undefined,
        note: roomNote || undefined,
        sourceStatus: 'history',
        plan: {
          ...rebuilt.plan,
          rooms: [roomPlan],
          allocatedStudentsCount: roomPlan.totalStudents,
          totalBenches: roomPlan.benches.length,
        },
        seatsPerBench: rebuilt.seatsPerBench,
      });
    }
  }

  return results;
}

/**
 * Teacher saves/confirms sending assigned students to their Exam Room.
 * Permanently updates server store, Exam_Seating_History, local cache & Google Sheet!
 */
export async function saveExamSeatingRoomDispatch(opts: {
  room: TeacherAssignedRoomView;
  studentStatuses: Record<string, RoomStudentCheckInStatus>;
  dispatchedBy: string;
  dispatchedById?: string;
  dispatchedAt: string;
  note?: string;
}): Promise<{
  serverOk: boolean;
  sheetSynced: boolean;
  sentCount: number;
  absentCount: number;
  pendingCount: number;
  sheetError?: string;
}> {
  const { room, studentStatuses, dispatchedBy, dispatchedById, dispatchedAt, note } = opts;

  let sentCount = 0;
  let absentCount = 0;
  let pendingCount = 0;
  const dispatchStatusMap: Record<
    string,
    { status: RoomStudentCheckInStatus; checkedInAt?: string; checkedInBy?: string }
  > = {};

  const roomRows: SheetSeatingRow[] = room.studentsList.map((st) => {
    const checkStatus = normalizeRoomCheckInStatus(
      studentStatuses[st.studentId] ?? st.roomCheckInStatus
    );
    if (checkStatus === 'Sent to Room') sentCount++;
    else if (checkStatus === 'Absent') absentCount++;
    else pendingCount++;

    dispatchStatusMap[st.studentId] = {
      status: checkStatus,
      checkedInAt: checkStatus === 'Pending' ? undefined : dispatchedAt,
      checkedInBy: checkStatus === 'Pending' ? undefined : dispatchedBy,
    };

    return {
      archiveKey: room.archiveKey,
      examDate: room.examDate,
      examShift: room.examShift,
      slotKey: room.slotKey,
      roomNo: room.roomNumber,
      wing: room.wing,
      benchNo: st.benchNumber,
      seatPosition: st.seatPosition,
      studentId: st.studentId,
      rollNumber: st.rollNumber,
      studentName: st.studentName,
      className: st.classLabel,
      invigilator: room.invigilator || dispatchedBy,
      invigilatorId: room.invigilatorId || dispatchedById || '',
      examType: room.examType,
      session: room.session,
      updatedAt: dispatchedAt,
      confirmedBy: dispatchedBy,
      status: sentCount > 0 ? 'Room Dispatched' : 'Approved',
      roomCheckInStatus: checkStatus,
      checkedInAt: checkStatus === 'Pending' ? '' : dispatchedAt,
      checkedInBy: checkStatus === 'Pending' ? '' : dispatchedBy,
    };
  });

  const dispatchRecord: ExamRoomDispatchRecord = {
    archiveKey: room.archiveKey,
    slotKey: room.slotKey,
    roomNumber: room.roomNumber,
    invigilator: room.invigilator || dispatchedBy,
    invigilatorId: room.invigilatorId || dispatchedById,
    examDate: room.examDate,
    examShift: room.examShift,
    totalStudents: roomRows.length,
    sentCount,
    absentCount,
    pendingCount,
    dispatchedBy,
    dispatchedById,
    dispatchedAt,
    note: note?.trim() || undefined,
    studentStatuses: dispatchStatusMap,
  };

  // Immediately update local history archive so search & history view reflect room dispatch instantaneously
  try {
    const existingLocal = loadLocalSeatingHistory();
    const existingEntry = existingLocal.find((e) => e.archiveKey === room.archiveKey);
    const otherRows = (existingEntry?.rows || []).filter(
      (r) => r.slotKey !== room.slotKey && r.roomNo !== room.roomNumber
    );
    const combinedRows = [...otherRows, ...roomRows];
    const updatedBatch = buildHistoryEntriesFromRows(combinedRows);
    if (updatedBatch.length > 0) {
      saveLocalSeatingHistory(mergeSeatingHistoryLists(updatedBatch, existingLocal));
    }
  } catch {}

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-seating-room-dispatch',
    apiBody: {
      dispatch: dispatchRecord,
      rows: roomRows,
    },
    directPayload: {
      action: 'saveExamSeatingRoomDispatch',
      dispatch: JSON.stringify(dispatchRecord),
      rows: JSON.stringify(roomRows),
    },
  });

  return {
    serverOk: syncRes.serverOk,
    sheetSynced: syncRes.sheetSynced,
    sentCount,
    absentCount,
    pendingCount,
    sheetError: syncRes.sheetError,
  };
}

