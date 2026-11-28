import { FeePromiseRecord, FeePromiseStatus } from '../types';
import { getLocalDateYMD, getLocalTimestamp } from './localTime';
import { saveToPhoneMemory } from './phoneMemoryCache';
import { realtimeSync } from './realtimeSync';
import { getAppsScriptUrl } from './busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';

export const FEE_PROMISES_STORAGE_KEY = 'evs_fee_promises_v1';
export const FEE_PROMISES_UPDATED_EVENT = 'evs-fee-promises-updated';
const DEVICE_PROMISE_REMINDED_KEY = 'evs_fee_promise_device_reminded_v1';

let cachedPromises: FeePromiseRecord[] | null = null;

export const normalizeFeePromise = (raw: any): FeePromiseRecord | null => {
  if (!raw || typeof raw !== 'object') return null;
  const studentId = String(raw.studentId || raw.Student_ID || '').trim();
  const promisedDate = String(raw.promisedDate || raw.Promised_Date || '').trim().slice(0, 10);
  if (!studentId || !promisedDate) return null;

  const rawStatus = String(raw.status || raw.Status || 'Pending').trim();
  const status: FeePromiseStatus =
    rawStatus === 'Fulfilled' || rawStatus === 'Overdue' || rawStatus === 'Cancelled'
      ? rawStatus
      : 'Pending';

  return {
    id: String(raw.id || raw.Promise_ID || `PRM-${studentId}-${Date.now()}`).trim(),
    studentId,
    studentName: String(raw.studentName || raw.Student_Name || studentId).trim(),
    className: String(raw.className || raw.Class || '').trim(),
    fatherName: String(raw.fatherName || raw.Father_Name || '').trim(),
    parentMobile: String(raw.parentMobile || raw.Parent_Mobile || '').trim(),
    totalDueAtPromise: Math.max(0, Number(raw.totalDueAtPromise ?? raw.Total_Due_At_Promise ?? 0) || 0),
    promisedAmount: Math.max(1, Number(raw.promisedAmount ?? raw.Promised_Amount ?? 0) || 0),
    promisedDate,
    notes: String(raw.notes || raw.Notes || '').trim(),
    status,
    createdBy: String(raw.createdBy || raw.Created_By || 'Parent').trim(),
    createdAt: String(raw.createdAt || raw.Created_At || getLocalTimestamp()).trim(),
    updatedAt: String(raw.updatedAt || raw.Updated_At || getLocalTimestamp()).trim(),
    fulfilledAt: raw.fulfilledAt || raw.Fulfilled_At ? String(raw.fulfilledAt || raw.Fulfilled_At).trim() : undefined,
    lastRemindedDate: raw.lastRemindedDate || raw.Last_Reminded_Date ? String(raw.lastRemindedDate || raw.Last_Reminded_Date).trim() : undefined,
  };
};

export const normalizeFeePromiseList = (list: any): FeePromiseRecord[] => {
  if (!Array.isArray(list)) return [];
  const out: FeePromiseRecord[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const norm = normalizeFeePromise(item);
    if (norm && !seen.has(norm.id)) {
      seen.add(norm.id);
      out.push(norm);
    }
  }
  return out.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
};

export const loadLocalFeePromises = (): FeePromiseRecord[] => {
  if (cachedPromises) return cachedPromises;
  try {
    const raw = localStorage.getItem(FEE_PROMISES_STORAGE_KEY);
    if (raw) {
      const parsed = normalizeFeePromiseList(JSON.parse(raw));
      cachedPromises = parsed;
      return parsed;
    }
  } catch {}
  return [];
};

export const saveLocalFeePromises = (list: FeePromiseRecord[]): FeePromiseRecord[] => {
  const normalized = normalizeFeePromiseList(list);
  cachedPromises = normalized;
  try {
    saveToPhoneMemory(FEE_PROMISES_STORAGE_KEY, normalized);
    window.dispatchEvent(new CustomEvent(FEE_PROMISES_UPDATED_EVENT, { detail: normalized }));
  } catch {}
  return normalized;
};

export const invalidateFeePromisesCache = () => {
  cachedPromises = null;
};

export const fetchFeePromisesFromServer = async (
  forceRefresh = false
): Promise<{ promises: FeePromiseRecord[]; sheetSynced: boolean }> => {
  const local = loadLocalFeePromises();
  if (!forceRefresh && cachedPromises && cachedPromises.length > 0) {
    return { promises: cachedPromises, sheetSynced: false };
  }
  const activeUrl = (getAppsScriptUrl() || '').trim();
  try {
    const res = await fetch(
      forceRefresh ? '/api/fee-promises?refresh=1' : '/api/fee-promises',
      {
        headers: activeUrl ? { 'x-apps-script-url': activeUrl } : undefined,
        signal: AbortSignal.timeout(9000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.promises)) {
        const saved = saveLocalFeePromises(data.promises);
        return { promises: saved, sheetSynced: Boolean(data?.sheetSynced) };
      }
    }
  } catch {}

  if (activeUrl) {
    try {
      const directRes = await directGetFromSheet('getFeePromises', activeUrl);
      if (directRes.ok && Array.isArray(directRes.json?.promises)) {
        const saved = saveLocalFeePromises(directRes.json.promises);
        return { promises: saved, sheetSynced: true };
      }
    } catch {}
  }

  return { promises: local, sheetSynced: false };
};

export const saveFeePromiseToServer = async (
  promiseInput: Omit<FeePromiseRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'> & {
    id?: string;
    status?: FeePromiseStatus;
  }
): Promise<{
  success: boolean;
  sheetSynced: boolean;
  sheetError?: string;
  promise: FeePromiseRecord;
  promises: FeePromiseRecord[];
}> => {
  const now = getLocalTimestamp();
  const activeUrl = (getAppsScriptUrl() || '').trim();
  const newRecord: FeePromiseRecord = {
    id: promiseInput.id || `PRM-${promiseInput.studentId}-${Date.now().toString(36)}`,
    studentId: String(promiseInput.studentId).trim(),
    studentName: String(promiseInput.studentName || promiseInput.studentId).trim(),
    className: String(promiseInput.className || '').trim(),
    fatherName: String(promiseInput.fatherName || '').trim(),
    parentMobile: String(promiseInput.parentMobile || '').trim(),
    totalDueAtPromise: Math.max(0, Number(promiseInput.totalDueAtPromise || 0)),
    promisedAmount: Math.max(1, Number(promiseInput.promisedAmount || 0)),
    promisedDate: String(promiseInput.promisedDate).trim().slice(0, 10),
    notes: String(promiseInput.notes || '').trim(),
    status: promiseInput.status || 'Pending',
    createdBy: String(promiseInput.createdBy || 'Parent').trim(),
    createdAt: now,
    updatedAt: now,
  };

  // Mark any older Pending promise for the same student as Cancelled locally for instant UI clarity
  const existing = loadLocalFeePromises();
  const updatedLocal = saveLocalFeePromises([
    newRecord,
    ...existing.map((p) =>
      p.id !== newRecord.id &&
      p.studentId.toLowerCase() === newRecord.studentId.toLowerCase() &&
      p.status === 'Pending'
        ? { ...p, status: 'Cancelled' as FeePromiseStatus, updatedAt: now }
        : p
    ),
  ]);

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/fee-promises',
    apiBody: { promise: newRecord },
    directPayload: {
      action: 'saveFeePromise',
      promise: newRecord,
    },
    overrideUrl: activeUrl,
  });

  const resolvedList = Array.isArray(syncRes.data?.promises)
    ? saveLocalFeePromises(syncRes.data.promises)
    : updatedLocal;

  realtimeSync.broadcastUpdate('fee_promises', 'saveFeePromise', {
    studentId: newRecord.studentId,
    promisedDate: newRecord.promisedDate,
  });

  return {
    success: true,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
    promise: newRecord,
    promises: resolvedList,
  };
};

export const updateFeePromiseStatusOnServer = async (
  promiseId: string,
  status: FeePromiseStatus,
  notes?: string
): Promise<{
  success: boolean;
  sheetSynced: boolean;
  promises: FeePromiseRecord[];
}> => {
  const now = getLocalTimestamp();
  const activeUrl = (getAppsScriptUrl() || '').trim();
  const existing = loadLocalFeePromises();
  const updatedLocal = saveLocalFeePromises(
    existing.map((p) =>
      p.id === promiseId
        ? {
            ...p,
            status,
            notes: notes !== undefined ? notes : p.notes,
            updatedAt: now,
            fulfilledAt: status === 'Fulfilled' ? now : p.fulfilledAt,
          }
        : p
    )
  );

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/fee-promises/status',
    apiBody: { id: promiseId, status, notes },
    directPayload: {
      action: 'updateFeePromiseStatus',
      id: promiseId,
      status,
      notes,
    },
    overrideUrl: activeUrl,
  });

  const resolvedList = Array.isArray(syncRes.data?.promises)
    ? saveLocalFeePromises(syncRes.data.promises)
    : updatedLocal;

  realtimeSync.broadcastUpdate('fee_promises', 'updateFeePromiseStatus', { id: promiseId, status });

  return {
    success: true,
    sheetSynced: syncRes.sheetSynced,
    promises: resolvedList,
  };
};

export const deleteFeePromiseOnServer = async (
  promiseId: string
): Promise<{
  success: boolean;
  sheetSynced: boolean;
  promises: FeePromiseRecord[];
}> => {
  const activeUrl = (getAppsScriptUrl() || '').trim();
  const existing = loadLocalFeePromises();
  const updatedLocal = saveLocalFeePromises(existing.filter((p) => p.id !== promiseId));

  const syncRes = await dualSyncWriteToSheet({
    apiPath: `/api/fee-promises/${encodeURIComponent(promiseId)}`,
    method: 'DELETE',
    directPayload: {
      action: 'deleteFeePromise',
      id: promiseId,
    },
    overrideUrl: activeUrl,
  });

  const resolvedList = Array.isArray(syncRes.data?.promises)
    ? saveLocalFeePromises(syncRes.data.promises)
    : updatedLocal;

  realtimeSync.broadcastUpdate('fee_promises', 'deleteFeePromise', { id: promiseId });

  return {
    success: true,
    sheetSynced: syncRes.sheetSynced,
    promises: resolvedList,
  };
};

export type EffectivePromiseState = 'fulfilled' | 'due_today' | 'overdue' | 'upcoming' | 'cancelled';

export const getEffectivePromiseState = (
  promise: FeePromiseRecord,
  currentPendingDue: number,
  todayYmd = getLocalDateYMD()
): EffectivePromiseState => {
  if (promise.status === 'Cancelled') return 'cancelled';
  if (promise.status === 'Fulfilled' || currentPendingDue <= 0) return 'fulfilled';
  if (promise.promisedDate === todayYmd) return 'due_today';
  if (promise.promisedDate < todayYmd || promise.status === 'Overdue') return 'overdue';
  return 'upcoming';
};

export const formatPromiseDateDisplay = (ymd?: string): string => {
  if (!ymd) return '';
  const parts = String(ymd).trim().slice(0, 10).split('-');
  if (parts.length !== 3) return ymd;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

export const wasDeviceNotifiedTodayForPromise = (
  promiseId: string,
  todayYmd = getLocalDateYMD()
): boolean => {
  try {
    const raw = localStorage.getItem(DEVICE_PROMISE_REMINDED_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw);
    return map?.[promiseId] === todayYmd;
  } catch {
    return false;
  }
};

export const markDeviceNotifiedTodayForPromise = (
  promiseId: string,
  todayYmd = getLocalDateYMD()
) => {
  try {
    const raw = localStorage.getItem(DEVICE_PROMISE_REMINDED_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[promiseId] = todayYmd;
    localStorage.setItem(DEVICE_PROMISE_REMINDED_KEY, JSON.stringify(map));
  } catch {}
};

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const ensureWebPushSubscribed = async (meta: {
  role: 'parent' | 'manager' | 'teacher';
  studentId?: string;
  studentIds?: string[];
  mobile?: string;
  name?: string;
}): Promise<boolean> => {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    Notification.permission !== 'granted'
  ) {
    return false;
  }

  try {
    const keyRes = await fetch('/api/push/vapid-public-key', {
      signal: AbortSignal.timeout(5000),
    });
    if (!keyRes.ok) return false;
    const keyJson = await keyRes.json();
    const publicKey = String(keyJson?.publicKey || '').trim();
    if (!publicKey) return false;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      });
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        ...meta,
      }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
};
