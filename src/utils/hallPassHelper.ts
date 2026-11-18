import { ExamTermType, FeeCollectionRecord, HallPassConfig, Student } from '../types';
import { calculateStudentSummary, isStudentFeeExempt, normalizeStudentId } from './feeCalculation';
import { saveToPhoneMemory } from './phoneMemoryCache';

export const HALL_PASS_CONFIG_STORAGE_KEY = 'evs_hall_pass_config_v1';

export const DEFAULT_HALL_PASS_CONFIG: HallPassConfig = {
  examType: 'Half-Yearly',
  session: '2026-27',
  customExamTitle: '',
  examScheduleLine: 'Timing: 09:00 AM - 12:00 PM',
  instructionLine: 'Bring Hall Pass & School ID daily. Report 15 min prior.',
  publishedToParent: true,
  allowedOverrides: {},
  updatedAt: '',
};

export const EXAM_TYPE_TITLES: Record<ExamTermType, { en: string; hi: string }> = {
  Quarterly: { en: 'QUARTERLY EXAMINATION', hi: 'तिमाही परीक्षा' },
  'Half-Yearly': { en: 'HALF-YEARLY EXAMINATION', hi: 'छमाही परीक्षा' },
  Annual: { en: 'ANNUAL EXAMINATION', hi: 'सालाना परीक्षा' },
};

export function getExamDisplayTitle(examType: ExamTermType, customTitle?: string): string {
  const custom = String(customTitle || '').trim();
  if (custom) return custom.toUpperCase();
  return EXAM_TYPE_TITLES[examType]?.en || 'HALF-YEARLY EXAMINATION';
}

export type HallPassEligibilityStatus = 'CLEARED' | 'WAIVED' | 'OVERRIDE_ALLOWED' | 'FEE_HOLD';

export interface StudentHallPassEligibility {
  student: Student;
  status: HallPassEligibilityStatus;
  isEligible: boolean;
  isFeeWaived: boolean;
  isManagerAllowed: boolean;
  dueAmount: number;
  advanceAmount: number;
  statusLabel: string;
  overrideNote?: string;
}

export function computeStudentHallPassEligibility(
  student: Student,
  feeRecords: FeeCollectionRecord[],
  config: HallPassConfig
): StudentHallPassEligibility {
  const normId = normalizeStudentId(student.Student_ID);
  const summary = calculateStudentSummary(student.Student_ID, feeRecords, student);
  const isFeeWaived = isStudentFeeExempt(student);
  const dueAmount = Math.max(0, Number(summary.currentDues || 0));
  const advanceAmount = Math.max(0, Number(summary.advanceAmount || 0));
  const overrideEntry = config?.allowedOverrides?.[normId];
  const isManagerAllowed = Boolean(overrideEntry?.allowed);

  let status: HallPassEligibilityStatus = 'FEE_HOLD';
  let statusLabel = `Due ₹${dueAmount.toLocaleString('en-IN')}`;

  if (dueAmount <= 0) {
    if (isFeeWaived) {
      status = 'WAIVED';
      statusLabel = 'FEE WAIVED';
    } else {
      status = 'CLEARED';
      statusLabel = 'FEE CLEARED';
    }
  } else if (isManagerAllowed) {
    status = 'OVERRIDE_ALLOWED';
    statusLabel = 'PROVISIONAL';
  }

  return {
    student,
    status,
    isEligible: dueAmount <= 0 || isManagerAllowed,
    isFeeWaived,
    isManagerAllowed,
    dueAmount,
    advanceAmount,
    statusLabel,
    overrideNote: overrideEntry?.note,
  };
}

export function chunkIntoPages<T>(items: T[], perPage: number = 9): T[][] {
  if (!items || items.length === 0) return [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}

export function loadLocalHallPassConfig(): HallPassConfig {
  try {
    const raw = localStorage.getItem(HALL_PASS_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_HALL_PASS_CONFIG,
          ...parsed,
          allowedOverrides:
            parsed.allowedOverrides && typeof parsed.allowedOverrides === 'object'
              ? parsed.allowedOverrides
              : {},
        };
      }
    }
  } catch {}
  return { ...DEFAULT_HALL_PASS_CONFIG };
}

export async function fetchHallPassConfigFromServer(): Promise<HallPassConfig> {
  try {
    const res = await fetch('/api/hall-pass-config', { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const json = await res.json();
      if (json?.config && typeof json.config === 'object') {
        const merged: HallPassConfig = {
          ...DEFAULT_HALL_PASS_CONFIG,
          ...json.config,
          allowedOverrides:
            json.config.allowedOverrides && typeof json.config.allowedOverrides === 'object'
              ? json.config.allowedOverrides
              : {},
        };
        saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, merged);
        return merged;
      }
    }
  } catch {}
  return loadLocalHallPassConfig();
}

export async function saveHallPassConfigToServer(config: HallPassConfig): Promise<HallPassConfig> {
  saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, config);
  try {
    const res = await fetch('/api/hall-pass-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json?.config) {
        const merged: HallPassConfig = {
          ...DEFAULT_HALL_PASS_CONFIG,
          ...json.config,
          allowedOverrides:
            json.config.allowedOverrides && typeof json.config.allowedOverrides === 'object'
              ? json.config.allowedOverrides
              : {},
        };
        saveToPhoneMemory(HALL_PASS_CONFIG_STORAGE_KEY, merged);
        return merged;
      }
    }
  } catch {}
  return config;
}
