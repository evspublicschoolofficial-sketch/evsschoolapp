import { FeeCollectionRecord, Student } from '../types';
import {
  computeStudentFeeMetrics,
  normalizeStudentId,
  StudentFeeMetrics,
} from './feeCalculation';

export interface FamilyMemberFeeSummary {
  student: Student;
  metrics: StudentFeeMetrics;
  dueAmount: number;
  advanceAmount: number;
}

export interface FamilyFeeSummary {
  mobileKey: string;
  displayMobile: string;
  fatherName: string;
  members: FamilyMemberFeeSummary[];
  totalBilled: number;
  totalPaid: number;
  totalDiscount: number;
  totalDue: number;
  totalAdvance: number;
  netBalance: number;
  totalMonthlyTuition: number;
}

/**
 * Normalizes a phone/mobile string to its last 10 digits for reliable family grouping
 */
export const normalizeMobile10 = (mobile?: string | null): string => {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

/**
 * Finds all students sharing the given mobile number (full 10-digit or >=4-digit suffix)
 */
export const findFamilyStudentsByMobile = (students: Student[], mobileQuery: string): Student[] => {
  const digits = String(mobileQuery || '').replace(/\D/g, '');
  if (digits.length < 4) return [];
  const normQuery = digits.length >= 10 ? digits.slice(-10) : digits;

  return students.filter((s) => {
    const rawMob = normalizeMobile10(s.Parent_Mobile || (s as any).Mobile_Number);
    if (!rawMob) return false;
    if (normQuery.length >= 10) {
      return rawMob === normQuery;
    }
    return rawMob.includes(normQuery) || rawMob.endsWith(normQuery);
  });
};

/**
 * Returns all students belonging to the same family mobile as the target student
 */
export const findSiblingsForStudent = (
  students: Student[],
  target: Student | null | undefined
): Student[] => {
  if (!target) return [];
  const targetMob = normalizeMobile10(target.Parent_Mobile || (target as any).Mobile_Number);
  if (!targetMob || targetMob.length < 6) return [target];
  const matched = students.filter(
    (s) => normalizeMobile10(s.Parent_Mobile || (s as any).Mobile_Number) === targetMob
  );
  return matched.length > 0 ? matched : [target];
};

/**
 * Computes combined fee summary across a list of family children
 */
export const computeFamilyFeeSummary = (
  familyStudents: Student[],
  feeRecords: FeeCollectionRecord[]
): FamilyFeeSummary => {
  // Deduplicate by Student_ID while preserving order
  const seen = new Set<string>();
  const uniqueStudents: Student[] = [];
  familyStudents.forEach((s) => {
    const key = normalizeStudentId(s.Student_ID);
    if (key && !seen.has(key)) {
      seen.add(key);
      uniqueStudents.push(s);
    }
  });

  const members: FamilyMemberFeeSummary[] = uniqueStudents.map((student) => {
    const metrics = computeStudentFeeMetrics(student, feeRecords);
    return {
      student,
      metrics,
      dueAmount: metrics.dueBalance > 0 ? metrics.dueBalance : 0,
      advanceAmount: metrics.isAdvance ? metrics.advanceAmount : 0,
    };
  });

  const first = uniqueStudents[0];
  const rawMobile = String(first?.Parent_Mobile || (first as any)?.Mobile_Number || '').trim();
  const mobileKey = normalizeMobile10(rawMobile) || `no-mobile-${normalizeStudentId(first?.Student_ID)}`;
  const fatherName =
    uniqueStudents.map((s) => String(s.Father_Name || '').trim()).find(Boolean) || 'अभिभावक (Parent)';

  let totalBilled = 0;
  let totalPaid = 0;
  let totalDiscount = 0;
  let totalDue = 0;
  let totalAdvance = 0;
  let totalMonthlyTuition = 0;

  members.forEach((m) => {
    totalBilled += m.metrics.totalSessionFee || 0;
    totalPaid += m.metrics.totalPaid || 0;
    totalDiscount += m.metrics.totalDiscount || 0;
    totalMonthlyTuition += m.metrics.monthlyTuition || 0;
    if (m.metrics.dueBalance > 0) {
      totalDue += m.metrics.dueBalance;
    } else if (m.metrics.dueBalance < 0) {
      totalAdvance += Math.abs(m.metrics.dueBalance);
    }
  });

  return {
    mobileKey,
    displayMobile: mobileKey.length === 10 && /^\d+$/.test(mobileKey) ? mobileKey : rawMobile || 'N/A',
    fatherName,
    members,
    totalBilled,
    totalPaid,
    totalDiscount,
    totalDue,
    totalAdvance,
    netBalance: totalDue - totalAdvance,
    totalMonthlyTuition,
  };
};

/**
 * Groups all students into Family groups keyed by 10-digit Parent Mobile
 * (Students without valid mobile are kept as single-member families keyed by ID)
 */
export const buildFamilyGroups = (
  students: Student[],
  feeRecords: FeeCollectionRecord[],
  query?: string
): FamilyFeeSummary[] => {
  const map = new Map<string, Student[]>();

  students.forEach((st) => {
    const mob = normalizeMobile10(st.Parent_Mobile || (st as any).Mobile_Number);
    const key = mob.length >= 6 ? mob : `single::${normalizeStudentId(st.Student_ID)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(st);
  });

  const allFamilies: FamilyFeeSummary[] = [];
  map.forEach((groupStudents) => {
    if (groupStudents.length > 0) {
      allFamilies.push(computeFamilyFeeSummary(groupStudents, feeRecords));
    }
  });

  // Sort: Multi-child families first, then by highest pending due descending
  allFamilies.sort((a, b) => {
    if (b.members.length !== a.members.length) {
      return b.members.length - a.members.length;
    }
    return b.totalDue - a.totalDue;
  });

  const q = String(query || '').trim().toLowerCase();
  if (!q) return allFamilies;

  const qDigits = q.replace(/\D/g, '');
  return allFamilies.filter((fam) => {
    if (qDigits.length >= 3 && fam.mobileKey.includes(qDigits)) return true;
    if (fam.fatherName.toLowerCase().includes(q)) return true;
    if (fam.displayMobile.toLowerCase().includes(q)) return true;
    return fam.members.some(
      (m) =>
        String(m.student.Student_Name || '').toLowerCase().includes(q) ||
        String(m.student.Student_ID || '').toLowerCase().includes(q) ||
        String(m.student.Roll_Number || '').toLowerCase().includes(q) ||
        String(m.student.Admission_Number || '').toLowerCase().includes(q)
    );
  });
};

/**
 * Fairly allocates a lump-sum payment across family children in order of pending due.
 * If excess remains after settling all children's dues, adds remaining to first child as advance.
 */
export const distributeLumpSumAcrossFamily = (
  members: FamilyMemberFeeSummary[],
  lumpSumAmount: number
): Record<string, number> => {
  const allocation: Record<string, number> = {};
  let remaining = Math.max(0, Math.round(Number(lumpSumAmount) || 0));

  members.forEach((m) => {
    const sId = m.student.Student_ID;
    const due = Math.max(0, m.dueAmount || 0);
    if (remaining <= 0 || due <= 0) {
      allocation[sId] = 0;
      return;
    }
    const payForChild = Math.min(due, remaining);
    allocation[sId] = payForChild;
    remaining -= payForChild;
  });

  // If money still remains after clearing all dues, put into the first child as advance
  if (remaining > 0 && members.length > 0) {
    const firstId = members[0].student.Student_ID;
    allocation[firstId] = (allocation[firstId] || 0) + remaining;
  }

  return allocation;
};

/**
 * Builds one combined WhatsApp due reminder covering all children of a family
 */
export const buildFamilyWhatsappDueReminder = (
  family: FamilyFeeSummary,
  getClassName: (c?: string | null) => string
): string => {
  const childLines = family.members
    .map((m, idx) => {
      const cls = getClassName(m.student.Class);
      const dueStr =
        m.dueAmount > 0
          ? `बकाया ₹${m.dueAmount.toLocaleString('en-IN')}`
          : m.advanceAmount > 0
          ? `अग्रिम -₹${m.advanceAmount.toLocaleString('en-IN')}`
          : `पूरी जमा ✓`;
      return `${idx + 1}. *${m.student.Student_Name}* (${cls}) — *${dueStr}*`;
    })
    .join('\n');

  return (
    `*ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)*\n` +
    `*पारिवारिक स्कूल फीस विवरण (${family.members.length} बच्चे)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👨‍👧‍👦 *अभिभावक:* ${family.fatherName}\n` +
    `📱 *मोबाइल नं:* ${family.displayMobile}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${childLines}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 *कुल सत्र फीस:* ₹${family.totalBilled.toLocaleString('en-IN')}\n` +
    `✅ *अब तक कुल जमा:* ₹${family.totalPaid.toLocaleString('en-IN')}\n` +
    `⚠️ *पूरे परिवार का कुल शेष बकाया:* *₹${family.totalDue.toLocaleString('en-IN')}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `कृपया विद्यालय कार्यालय में या पेरेंट पोर्टल UPI से उपरोक्त बकाया शुल्क समय पर जमा कराएँ। धन्यवाद!`
  );
};

/**
 * Builds one combined WhatsApp receipt after multi-child fee payment
 */
export const buildFamilyWhatsappPaymentReceipt = (params: {
  family: FamilyFeeSummary;
  date: string;
  paymentMode: string;
  receivedBy: string;
  paidItems: Array<{
    student: Student;
    feeType: string;
    month: string;
    receiptNumber: string;
    amountPaid: number;
    discount: number;
    remainingBalance: number;
  }>;
  getClassName: (c?: string | null) => string;
}): string => {
  const totalPaidNow = params.paidItems.reduce((s, it) => s + it.amountPaid, 0);
  const totalDiscNow = params.paidItems.reduce((s, it) => s + it.discount, 0);
  const lines = params.paidItems
    .map(
      (it, idx) =>
        `${idx + 1}. *${it.student.Student_Name}* (${params.getClassName(it.student.Class)})\n` +
        `   रसीद: #${it.receiptNumber} | जमा: *₹${it.amountPaid.toLocaleString('en-IN')}*` +
        (it.discount > 0 ? ` | छूट: ₹${it.discount.toLocaleString('en-IN')}` : '') +
        ` | शेष: ₹${Math.max(0, it.remainingBalance).toLocaleString('en-IN')}`
    )
    .join('\n');

  return (
    `*ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)*\n` +
    `*संयुक्त पारिवारिक फीस रसीद (Combined Receipt)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📅 *दिनांक:* ${params.date}\n` +
    `👨‍👧‍👦 *अभिभावक:* ${params.family.fatherName} (${params.family.displayMobile})\n` +
    `💳 *भुगतान माध्यम:* ${params.paymentMode}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `${lines}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `✅ *आज की कुल जमा राशि:* *₹${totalPaidNow.toLocaleString('en-IN')}*\n` +
    (totalDiscNow > 0 ? `🎁 *कुल छूट:* ₹${totalDiscNow.toLocaleString('en-IN')}\n` : '') +
    `✍️ *प्राप्तकर्ता:* ${params.receivedBy}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_शुल्क भुगतान के लिए धन्यवाद। E.V.S. Public School_`
  );
};
