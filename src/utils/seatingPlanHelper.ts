import jsPDF from 'jspdf';
import { HallPassConfig, Student } from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { getExamDisplayTitle } from './hallPassHelper';
import { dualSyncWriteToSheet } from './sheetDirectSync';

export interface RoomCustomMeta {
  roomNumber: string;
  invigilator: string;
}

export interface SeatingRoomConfig {
  slotKey: string;
  roomNumber: string;
  invigilator: string;
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
          classCounts: r?.classCounts && typeof r.classCounts === 'object' ? { ...r.classCounts } : {},
        })),
        seatsPerBench: [2, 3, 4].includes(Number(parsed.seatsPerBench)) ? Number(parsed.seatsPerBench) : 3,
        mode: parsed.mode === 'class_grouped' ? 'class_grouped' : 'anti_cheating_mixed',
        status:
          parsed.status === 'pending_approval' || parsed.status === 'approved'
            ? parsed.status
            : 'draft',
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

function countAdjacentConflictsOnBench(seats: StudentPoolItem[]): number {
  let c = 0;
  for (let i = 0; i < seats.length - 1; i++) {
    if (seats[i].classCode === seats[i + 1].classCode) c++;
  }
  return c;
}

/**
 * Anti-cheating mixed bench allocator for a single room given its exact class pools:
 * 1. Spreads each class across benches using column-major pass (Left -> Right -> Middle)
 *    so students of the same class avoid sitting next to each other.
 * 2. Performs intra-bench reorder (places singleton different-class student in the Middle).
 * 3. Performs cross-bench conflict-reduction swaps if any adjacent pairs remain.
 * 4. Staggers benches with all-distinct classes front-to-back so the same class isn't stacked in one column.
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

  // Anti-cheating mixed allocation
  const B = Math.ceil(totalInRoom / seatsPerBench);
  const benchCaps: number[] = [];
  let rem = totalInRoom;
  for (let b = 0; b < B; b++) {
    const cap = Math.min(seatsPerBench, rem);
    benchCaps.push(cap);
    rem -= cap;
  }

  // Largest class pools first so they spread cleanly across the outer columns of all benches
  const sortedPools = [...roomItemsByClass].sort((a, b) => b.items.length - a.items.length);
  const flatItems: StudentPoolItem[] = [];
  for (const pool of sortedPools) {
    flatItems.push(...pool.items);
  }

  const benchGrid: Array<Array<StudentPoolItem | null>> = benchCaps.map((cap) =>
    Array.from({ length: cap }, () => null)
  );

  // Build non-adjacent column fill order:
  // Seat 0 (Left) on all benches -> Last seat on benches with 3+ seats (Right) -> Inner/middle seats
  const slotOrder: Array<{ b: number; s: number }> = [];
  const usedSlot = new Set<string>();
  const pushSlot = (b: number, s: number) => {
    const key = `${b}:${s}`;
    if (!usedSlot.has(key) && s >= 0 && s < benchCaps[b]) {
      usedSlot.add(key);
      slotOrder.push({ b, s });
    }
  };

  for (let b = 0; b < B; b++) pushSlot(b, 0);
  if (seatsPerBench >= 3) {
    for (let b = 0; b < B; b++) {
      if (benchCaps[b] >= 3) pushSlot(b, benchCaps[b] - 1);
    }
  }
  for (let s = 1; s < seatsPerBench; s++) {
    for (let b = 0; b < B; b++) {
      pushSlot(b, s);
    }
  }

  flatItems.forEach((item, idx) => {
    const slot = slotOrder[idx];
    if (slot) benchGrid[slot.b][slot.s] = item;
  });

  const concreteBenches: StudentPoolItem[][] = benchGrid.map((row) =>
    row.filter((x): x is StudentPoolItem => x !== null)
  );

  // Step A: Reorder within each 3-seat or 4-seat bench to minimize adjacent same-class pairs
  const optimizeBenchOrder = (row: StudentPoolItem[]) => {
    if (row.length === 3) {
      if (row[0].classCode === row[1].classCode && row[2].classCode !== row[0].classCode) {
        [row[1], row[2]] = [row[2], row[1]];
      } else if (row[1].classCode === row[2].classCode && row[0].classCode !== row[1].classCode) {
        [row[0], row[1]] = [row[1], row[0]];
      }
    } else if (row.length === 4) {
      // Try swapping inner seats if adjacent conflict exists
      let best = [...row];
      let bestScore = countAdjacentConflictsOnBench(best);
      if (bestScore > 0) {
        const perms = [
          [0, 2, 1, 3],
          [0, 3, 1, 2],
          [1, 3, 0, 2],
          [0, 1, 3, 2],
        ];
        for (const p of perms) {
          const cand = p.map((i) => row[i]);
          const sc = countAdjacentConflictsOnBench(cand);
          if (sc < bestScore) {
            best = cand;
            bestScore = sc;
            if (sc === 0) break;
          }
        }
        for (let i = 0; i < 4; i++) row[i] = best[i];
      }
    }
  };

  concreteBenches.forEach(optimizeBenchOrder);

  // Step B: Cross-bench local swap pass to eliminate remaining adjacent conflicts if possible
  for (let pass = 0; pass < 2; pass++) {
    for (let b1 = 0; b1 < concreteBenches.length; b1++) {
      const r1 = concreteBenches[b1];
      if (countAdjacentConflictsOnBench(r1) === 0) continue;
      for (let i = 0; i < r1.length; i++) {
        const hasLocalConflict =
          (i > 0 && r1[i].classCode === r1[i - 1].classCode) ||
          (i < r1.length - 1 && r1[i].classCode === r1[i + 1].classCode);
        if (!hasLocalConflict) continue;

        let swapped = false;
        for (let b2 = 0; b2 < concreteBenches.length && !swapped; b2++) {
          if (b1 === b2) continue;
          const r2 = concreteBenches[b2];
          for (let j = 0; j < r2.length && !swapped; j++) {
            if (r1[i].classCode === r2[j].classCode) continue;
            const beforeTotal = countAdjacentConflictsOnBench(r1) + countAdjacentConflictsOnBench(r2);
            const test1 = [...r1];
            const test2 = [...r2];
            [test1[i], test2[j]] = [test2[j], test1[i]];
            optimizeBenchOrder(test1);
            optimizeBenchOrder(test2);
            const afterTotal = countAdjacentConflictsOnBench(test1) + countAdjacentConflictsOnBench(test2);
            if (afterTotal < beforeTotal) {
              concreteBenches[b1] = test1;
              concreteBenches[b2] = test2;
              swapped = true;
            }
          }
        }
      }
    }
  }

  // Step C: Stagger all-distinct benches front-to-back so the same class doesn't stack down the same column
  concreteBenches.forEach((row, bIdx) => {
    if (row.length >= 2) {
      const distinctCount = new Set(row.map((s) => s.classCode)).size;
      if (distinctCount === row.length) {
        const shift = bIdx % row.length;
        if (shift > 0) {
          const rotated = [...row.slice(shift), ...row.slice(0, shift)];
          concreteBenches[bIdx] = rotated;
        }
      }
    }
  });

  return concreteBenches.map((row, bIdx) => ({
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
}): string {
  const { plan, config, selectedRoomKey, seatsPerBench = 3 } = opts;
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
    doc.text(
      `${examTitle} (${config.session}) · Seated: ${plan.allocatedStudentsCount}/${plan.totalStudents} · ${plan.rooms.length} Rooms · ${seatsPerBench} Seats/Bench`,
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
    doc.setFontSize(9.5);
    doc.text(`${examTitle} (${config.session})`, 14, 25.5);

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
  confirmedBy?: string;
  status?: string;
}

export function flattenSeatingPlanForSheet(
  plan: FullExamSeatingPlan,
  config: HallPassConfig,
  confirmedBy?: string
): SheetSeatingRow[] {
  const out: SheetSeatingRow[] = [];
  for (const room of plan.rooms) {
    const wing = room.groupLabelHi || (room.group === 'pre_primary' ? 'Play - UKG (M3)' : 'Class 1st - 8th');
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
          confirmedBy: confirmedBy || '',
          status: 'Approved',
        });
      }
    }
  }
  return out;
}

export interface ExamSeatingSnapshot {
  rows: SheetSeatingRow[];
  roomMeta: Record<string, RoomCustomMeta>;
  draftConfig: SeatingPlanConfigPayload | null;
  approvedConfig: SeatingPlanConfigPayload | null;
  updatedAt?: string;
}

export async function fetchExamSeatingPlanSnapshot(): Promise<ExamSeatingSnapshot | null> {
  try {
    const res = await fetch(`/api/exam-seating-plan?_t=${Date.now()}`, {
      headers: { 'x-apps-script-url': getAppsScriptUrl() },
      cache: 'no-store',
      signal: AbortSignal.timeout(9000),
    });
    if (res.ok) {
      const json = await res.json();
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
            };
          }
        }
        saveRoomMeta(roomMeta);
      }
      return {
        rows: Array.isArray(json?.rows) ? json.rows : [],
        roomMeta,
        draftConfig,
        approvedConfig,
        updatedAt: json?.updatedAt,
      };
    }
  } catch {}
  return null;
}

export async function fetchExamSeatingPlanRoomMeta(): Promise<Record<string, RoomCustomMeta> | null> {
  const snap = await fetchExamSeatingPlanSnapshot();
  return snap ? snap.roomMeta : null;
}

/**
 * Teacher saves or submits Room x Class allocation draft for Manager confirmation.
 * Does NOT overwrite Exam_Seating_Plan Sheet tab until Manager approves!
 */
export async function saveTeacherSeatingDraft(
  draftConfig: SeatingPlanConfigPayload
): Promise<{ serverOk: boolean; sheetSynced: boolean; sheetError?: string }> {
  saveLocalSeatingWorkflow(draftConfig);
  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-seating-plan/draft',
    apiBody: { draftConfig },
    directPayload: {
      action: 'saveExamSeatingDraft',
      draftConfig: JSON.stringify(draftConfig),
    },
  });
  return {
    serverOk: syncRes.serverOk,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
}

/**
 * Manager confirms the Seating Plan and saves all seats permanently to Google Sheet ("Exam_Seating_Plan" tab).
 */
export async function saveExamSeatingPlanToSheet(
  plan: FullExamSeatingPlan,
  config: HallPassConfig,
  roomMeta: Record<string, RoomCustomMeta>,
  approvedConfig?: SeatingPlanConfigPayload
): Promise<{ savedCount: number; sheetSynced: boolean; sheetError?: string }> {
  saveRoomMeta(roomMeta);
  if (approvedConfig) {
    saveLocalSeatingWorkflow(approvedConfig);
  }
  const rows = flattenSeatingPlanForSheet(plan, config, approvedConfig?.approvedBy);
  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/exam-seating-plan',
    apiBody: { rows, roomMeta, approvedConfig },
    directPayload: {
      action: 'saveExamSeatingPlan',
      rows: JSON.stringify(rows),
      approvedConfig: approvedConfig ? JSON.stringify(approvedConfig) : '',
    },
  });
  return {
    savedCount: rows.length,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
  };
}
