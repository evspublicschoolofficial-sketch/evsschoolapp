import { StaffSalaryConfig } from '../types';
import { StaffMonthlyReport } from './staffAttendanceMetrics';

const SALARY_STORAGE_KEY = 'evs_staff_salary_config_v1';
const SALARY_EVENT = 'evs-staff-salary-updated';

export const DEFAULT_SALARY_VALUES: Omit<StaffSalaryConfig, 'userId'> = {
  baseSalary: 8000,
  paidLeaveDays: 1,
  lateThresholdDays: 2,
  latePenaltyPerDay: 100,
  lateDeductionPerMinute: 0,
  halfDayFactor: 0.5,
  overtimeHourlyRate: 80,
  extraDutyDayBonus: 350,
  allowances: 0,
  manualDeduction: 0,
};

export const getDefaultStaffSalaryConfig = (userId: string, name?: string): StaffSalaryConfig => ({
  userId,
  name,
  ...DEFAULT_SALARY_VALUES,
});

export const loadLocalSalaryConfigs = (): Record<string, StaffSalaryConfig> => {
  try {
    const raw = localStorage.getItem(SALARY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
};

export const saveLocalSalaryConfigs = (configs: Record<string, StaffSalaryConfig>) => {
  try {
    localStorage.setItem(SALARY_STORAGE_KEY, JSON.stringify(configs));
    window.dispatchEvent(new CustomEvent(SALARY_EVENT, { detail: configs }));
  } catch {}
};

export const fetchSalaryConfigsFromServer = async (): Promise<Record<string, StaffSalaryConfig>> => {
  const local = loadLocalSalaryConfigs();
  try {
    const res = await fetch(`/api/staff-salary-config?_t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.configs && typeof data.configs === 'object') {
        const merged = { ...local, ...data.configs };
        saveLocalSalaryConfigs(merged);
        return merged;
      }
    }
  } catch {}
  return local;
};

export const saveStaffSalaryConfigToServer = async (
  config: StaffSalaryConfig
): Promise<Record<string, StaffSalaryConfig>> => {
  const key = String(config.userId || '').trim();
  const payload: StaffSalaryConfig = {
    ...config,
    userId: key,
    updatedAt: new Date().toISOString(),
  };

  const current = loadLocalSalaryConfigs();
  const nextLocal = { ...current, [key]: payload };
  saveLocalSalaryConfigs(nextLocal);

  try {
    const res = await fetch('/api/staff-salary-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: payload }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.configs && typeof data.configs === 'object') {
        saveLocalSalaryConfigs(data.configs);
        return data.configs;
      }
    }
  } catch {}
  return nextLocal;
};

export const subscribeSalaryConfigUpdates = (
  callback: (configs: Record<string, StaffSalaryConfig>) => void
): (() => void) => {
  const handleCustom = (e: any) => {
    if (e?.detail) callback(e.detail);
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === SALARY_STORAGE_KEY && e.newValue) {
      try {
        callback(JSON.parse(e.newValue));
      } catch {}
    }
  };
  window.addEventListener(SALARY_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  let ws: WebSocket | null = null;
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/location`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === 'APP_DATA_UPDATED' && msg.entity === 'staff_salary_config') {
          fetchSalaryConfigsFromServer().then(callback).catch(() => {});
        }
      } catch {}
    };
  } catch {}

  return () => {
    window.removeEventListener(SALARY_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
    try {
      ws?.close();
    } catch {}
  };
};

export interface StaffSalaryCalculation {
  config: StaffSalaryConfig;
  perDaySalary: number;
  baseSalary: number;
  chargeableAbsentDays: number;
  paidLeaveApplied: number;
  absentDeduction: number;
  halfDayDeduction: number;
  chargeableLateDays: number;
  lateDeduction: number;
  overtimePay: number;
  extraDutyBonusPay: number;
  allowances: number;
  manualDeduction: number;
  totalAdditions: number;
  totalDeductions: number;
  grossEarnings: number;
  netPayable: number;
}

export const calculateStaffMonthlySalary = (
  report: StaffMonthlyReport,
  rawConfig?: Partial<StaffSalaryConfig>
): StaffSalaryCalculation => {
  const config: StaffSalaryConfig = {
    userId: report.userId,
    name: report.name,
    ...DEFAULT_SALARY_VALUES,
    ...(rawConfig || {}),
  };

  const baseSalary = Math.max(0, Number(config.baseSalary) || 0);
  const paidLeaveDays = Math.max(0, Number(config.paidLeaveDays) || 0);
  const lateThresholdDays = Math.max(0, Number(config.lateThresholdDays) || 0);
  const latePenaltyPerDay = Math.max(0, Number(config.latePenaltyPerDay) || 0);
  const lateDeductionPerMinute = Math.max(0, Number(config.lateDeductionPerMinute) || 0);
  const halfDayFactor = Math.min(1, Math.max(0, Number(config.halfDayFactor ?? 0.5)));
  const overtimeHourlyRate = Math.max(0, Number(config.overtimeHourlyRate) || 0);
  const extraDutyDayBonus = Math.max(0, Number(config.extraDutyDayBonus) || 0);
  const allowances = Math.max(0, Number(config.allowances) || 0);
  const manualDeduction = Math.max(0, Number(config.manualDeduction) || 0);

  const denomDays = Math.max(report.workingDays, 1);
  const perDaySalary = Math.round(baseSalary / denomDays);

  // Absent deduction after free paid leave allowance
  const totalAbsent = Math.max(0, report.absentDays);
  const paidLeaveApplied = Math.min(totalAbsent, paidLeaveDays);
  const chargeableAbsentDays = Math.max(0, totalAbsent - paidLeaveDays);
  const absentDeduction = Math.round(chargeableAbsentDays * perDaySalary);

  // Half-day deduction
  const halfDayDeduction = Math.round(Math.max(0, report.halfDays) * halfDayFactor * perDaySalary);

  // Late deduction (excess late days + per-minute rate if configured)
  const chargeableLateDays = Math.max(0, report.lateDays - lateThresholdDays);
  const lateDayCut = chargeableLateDays * latePenaltyPerDay;
  const lateMinCut =
    lateThresholdDays === 0 || report.lateDays > lateThresholdDays
      ? Math.round(report.totalLateMinutes * lateDeductionPerMinute)
      : 0;
  const lateDeduction = Math.round(lateDayCut + lateMinCut);

  // Overtime & Extra Holiday Duty bonus
  const overtimePay = Math.round(Math.max(0, report.extraOvertimeHours) * overtimeHourlyRate);
  const extraDutyBonusPay = Math.round(Math.max(0, report.extraDutyDays) * extraDutyDayBonus);

  const totalAdditions = overtimePay + extraDutyBonusPay + allowances;
  const grossEarnings = baseSalary + totalAdditions;
  const totalDeductions = absentDeduction + halfDayDeduction + lateDeduction + manualDeduction;
  const netPayable = Math.max(0, Math.round(grossEarnings - totalDeductions));

  return {
    config,
    perDaySalary,
    baseSalary,
    chargeableAbsentDays,
    paidLeaveApplied,
    absentDeduction,
    halfDayDeduction,
    chargeableLateDays,
    lateDeduction,
    overtimePay,
    extraDutyBonusPay,
    allowances,
    manualDeduction,
    totalAdditions,
    totalDeductions,
    grossEarnings,
    netPayable,
  };
};
