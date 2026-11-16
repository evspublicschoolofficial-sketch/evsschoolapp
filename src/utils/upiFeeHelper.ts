import { UpiSettings, UpiPaymentRequest } from '../types';

const UPI_SETTINGS_KEY = 'evs_upi_settings_v1';
const UPI_PAYMENTS_KEY = 'evs_upi_payments_v1';
const UPI_UPDATED_EVENT = 'evs-upi-data-updated';

export const DEFAULT_UPI_SETTINGS: UpiSettings = {
  upiId: '',
  payeeName: 'E.V.S. Public School',
  bankName: '',
  instructions: 'QR स्कैन या UPI ऐप से भुगतान करने के बाद 12 अंकों का UTR / Reference No नीचे दर्ज करें।',
};

export const loadLocalUpiSettings = (): UpiSettings => {
  try {
    const raw = localStorage.getItem(UPI_SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_UPI_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_UPI_SETTINGS };
};

export const saveLocalUpiSettings = (settings: UpiSettings) => {
  try {
    localStorage.setItem(UPI_SETTINGS_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent(UPI_UPDATED_EVENT, { detail: { type: 'settings', settings } }));
  } catch {}
};

export const loadLocalUpiPayments = (): UpiPaymentRequest[] => {
  try {
    const raw = localStorage.getItem(UPI_PAYMENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

export const saveLocalUpiPayments = (payments: UpiPaymentRequest[]) => {
  try {
    localStorage.setItem(UPI_PAYMENTS_KEY, JSON.stringify(payments));
    window.dispatchEvent(new CustomEvent(UPI_UPDATED_EVENT, { detail: { type: 'payments', payments } }));
  } catch {}
};

export const fetchUpiSettingsFromServer = async (): Promise<UpiSettings> => {
  const local = loadLocalUpiSettings();
  try {
    const res = await fetch(`/api/upi-settings?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data?.settings) {
        const merged = { ...DEFAULT_UPI_SETTINGS, ...data.settings };
        saveLocalUpiSettings(merged);
        return merged;
      }
    }
  } catch {}
  return local;
};

export const saveUpiSettingsToServer = async (settings: UpiSettings): Promise<UpiSettings> => {
  const payload: UpiSettings = {
    ...DEFAULT_UPI_SETTINGS,
    ...settings,
    upiId: String(settings.upiId || '').trim(),
    payeeName: String(settings.payeeName || 'E.V.S. Public School').trim(),
    bankName: String(settings.bankName || '').trim(),
    instructions: String(settings.instructions || DEFAULT_UPI_SETTINGS.instructions).trim(),
    updatedAt: new Date().toISOString(),
  };
  saveLocalUpiSettings(payload);

  try {
    const res = await fetch('/api/upi-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: payload }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.settings) {
        saveLocalUpiSettings(data.settings);
        return data.settings;
      }
    }
  } catch {}
  return payload;
};

export const fetchUpiPaymentsFromServer = async (studentId?: string): Promise<UpiPaymentRequest[]> => {
  const filterByStudent = (list: UpiPaymentRequest[]) => {
    if (!studentId) return list;
    const clean = studentId.trim().toLowerCase();
    return list.filter((item) => String(item.studentId || '').trim().toLowerCase() === clean);
  };

  try {
    const url = studentId
      ? `/api/upi-payments?studentId=${encodeURIComponent(studentId)}&_t=${Date.now()}`
      : `/api/upi-payments?_t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.payments)) {
        if (!studentId) {
          saveLocalUpiPayments(data.payments);
        }
        return data.payments;
      }
    }
  } catch {}
  return filterByStudent(loadLocalUpiPayments());
};

export const submitUpiPaymentToServer = async (
  payload: Omit<UpiPaymentRequest, 'id' | 'status' | 'createdAt'>
): Promise<{ success: boolean; payment?: UpiPaymentRequest; error?: string }> => {
  const optimistic: UpiPaymentRequest = {
    ...payload,
    id: `upi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };

  try {
    const res = await fetch('/api/upi-payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(optimistic),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || 'भुगतान विवरण सेव नहीं हो सका।' };
    }
    const saved: UpiPaymentRequest = data.payment || optimistic;
    const prev = loadLocalUpiPayments().filter((p) => p.id !== saved.id);
    saveLocalUpiPayments([saved, ...prev]);
    return { success: true, payment: saved };
  } catch (err: any) {
    return { success: false, error: err?.message || 'सर्वर से संपर्क नहीं हो सका।' };
  }
};

export const verifyUpiPaymentOnServer = async (params: {
  id: string;
  status: 'Approved' | 'Rejected';
  receiptNumber?: string;
  managerNote?: string;
  verifiedBy?: string;
}): Promise<{ success: boolean; payment?: UpiPaymentRequest; error?: string }> => {
  try {
    const res = await fetch(`/api/upi-payments/${encodeURIComponent(params.id)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || 'सत्यापन अपडेट विफल रहा।' };
    }
    if (Array.isArray(data.payments)) {
      saveLocalUpiPayments(data.payments);
    }
    return { success: true, payment: data.payment };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error' };
  }
};

export const subscribeUpiUpdates = (onUpdate: (kind: 'settings' | 'payments' | 'all') => void): (() => void) => {
  const handleCustom = (e: any) => {
    const t = e?.detail?.type;
    if (t === 'settings') onUpdate('settings');
    else if (t === 'payments') onUpdate('payments');
    else onUpdate('all');
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === UPI_SETTINGS_KEY) onUpdate('settings');
    if (e.key === UPI_PAYMENTS_KEY) onUpdate('payments');
  };

  window.addEventListener(UPI_UPDATED_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);

  let ws: WebSocket | null = null;
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/location`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg?.type === 'APP_DATA_UPDATED') {
          if (msg.entity === 'upi_settings') onUpdate('settings');
          else if (msg.entity === 'upi_payments') onUpdate('payments');
        }
      } catch {}
    };
  } catch {}

  return () => {
    window.removeEventListener(UPI_UPDATED_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
    try {
      ws?.close();
    } catch {}
  };
};

export const buildUpiIntentUri = (params: {
  upiId: string;
  payeeName?: string;
  amount?: number;
  note?: string;
}): string => {
  const pa = encodeURIComponent(String(params.upiId || '').trim());
  const pn = encodeURIComponent(String(params.payeeName || 'E.V.S. Public School').trim());
  const tn = encodeURIComponent(String(params.note || 'School Fee Payment').trim().slice(0, 60));
  const am = params.amount && params.amount > 0 ? `&am=${Number(params.amount).toFixed(2)}` : '';
  return `upi://pay?pa=${pa}&pn=${pn}${am}&cu=INR&tn=${tn}`;
};

export const compressReceiptImageFile = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Image read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const maxDim = 920;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
};
