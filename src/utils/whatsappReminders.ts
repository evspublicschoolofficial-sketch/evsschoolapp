// Clean 1-Click WhatsApp Reminder Helpers + Automatic Google Sheet Backup Logger
import { getAppsScriptUrl } from './busTrackingService';
import { dualSyncWriteToSheet } from './sheetDirectSync';
import { getLocalDateYMD } from './localTime';

export interface WhatsappAlertLog {
  id: string;
  date: string;
  time: string;
  alertType: 'Absent Alert' | 'Fee Due Reminder' | 'Staff Salary Slip' | 'WhatsApp Alert';
  recipientType: 'Parent' | 'Staff';
  recipientId: string;
  recipientName: string;
  classOrRole: string;
  mobile: string;
  amount: number;
  summary: string;
  sentBy: string;
}

const WA_LOG_STORAGE_KEY = 'evs_whatsapp_alert_logs_v1';

export const loadLocalWhatsappLogs = (): WhatsappAlertLog[] => {
  try {
    const raw = localStorage.getItem(WA_LOG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

export const saveLocalWhatsappLogs = (list: WhatsappAlertLog[]) => {
  try {
    localStorage.setItem(WA_LOG_STORAGE_KEY, JSON.stringify(list.slice(0, 300)));
  } catch {}
};

export const fetchWhatsappLogsFromServer = async (forceRefresh = false): Promise<WhatsappAlertLog[]> => {
  try {
    const res = await fetch(`/api/whatsapp-logs${forceRefresh ? '?refresh=1' : ''}`, {
      headers: { 'x-apps-script-url': getAppsScriptUrl() },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.logs)) {
        saveLocalWhatsappLogs(data.logs);
        return data.logs;
      }
    }
  } catch {}
  return loadLocalWhatsappLogs();
};

export const logWhatsappAlertBackup = async (
  meta: Partial<WhatsappAlertLog> & { mobile?: string; summary?: string }
): Promise<{ sheetSynced: boolean; sheetError?: string }> => {
  const now = new Date();
  const entry: WhatsappAlertLog = {
    id: `WA-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: getLocalDateYMD(now),
    time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    alertType: meta.alertType || 'WhatsApp Alert',
    recipientType: meta.recipientType || 'Parent',
    recipientId: String(meta.recipientId || '').trim(),
    recipientName: String(meta.recipientName || '').trim(),
    classOrRole: String(meta.classOrRole || '').trim(),
    mobile: normalizeWhatsappDigits(meta.mobile || '') || String(meta.mobile || '').trim(),
    amount: Number(meta.amount || 0),
    summary: String(meta.summary || '').trim().slice(0, 280),
    sentBy: String(meta.sentBy || 'Manager').trim(),
  };

  const prev = loadLocalWhatsappLogs();
  saveLocalWhatsappLogs([entry, ...prev]);

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/whatsapp-logs',
    apiBody: { log: entry },
    directPayload: {
      action: 'logWhatsappAlert',
      log: entry,
    },
  });

  return { sheetSynced: syncRes.sheetSynced, sheetError: syncRes.sheetError };
};

export const normalizeWhatsappDigits = (rawPhone?: string | number | null): string => {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length >= 12) return digits;
  return `91${digits.slice(-10)}`;
};

export const buildWhatsappUrl = (rawPhone: string | number | undefined | null, message: string): string => {
  const cleanPhone = normalizeWhatsappDigits(rawPhone);
  const encoded = encodeURIComponent(message);
  return cleanPhone.length >= 12
    ? `https://wa.me/${cleanPhone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
};

export const openWhatsappAlert = (
  rawPhone: string | number | undefined | null,
  message: string,
  backupMeta?: Partial<WhatsappAlertLog>
) => {
  const url = buildWhatsappUrl(rawPhone, message);
  window.open(url, '_blank', 'noopener,noreferrer');

  if (backupMeta) {
    logWhatsappAlertBackup({
      ...backupMeta,
      mobile: String(rawPhone || backupMeta.mobile || ''),
      summary: backupMeta.summary || message.replace(/\*/g, '').slice(0, 200),
    }).catch(() => {});
  }
};

export const buildAbsentAlertMessage = (params: {
  studentName: string;
  className: string;
  rollNumber?: string | number;
  dateStr: string;
  remark?: string;
}): string => {
  const { studentName, className, rollNumber, dateStr, remark } = params;
  const rollText = rollNumber ? ` (Roll No: ${rollNumber})` : '';
  const remarkLine =
    remark && remark.trim() && remark.trim().toUpperCase() !== 'OK'
      ? `\n📝 *टिप्पणी (Note):* ${remark.trim()}`
      : '';

  return (
    `*E.V.S. PUBLIC SCHOOL — अनुपस्थिति सूचना (Absent Alert)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `अस्सलाम वालेकुम / आदरणीय अभिभावक,\n\n` +
    `आपको सूचित किया जाता है कि आज दिनांक *${dateStr}* को आपका बच्चा *${studentName}* (कक्षा: *${className}*${rollText}) विद्यालय में *अनुपस्थित (Absent)* दर्ज हुआ है।${remarkLine}\n\n` +
    `कृपया यदि कोई विशेष कारण हो तो विद्यालय कार्यालय या कक्षाध्यापक को अवगत कराएं तथा आज का गृहकार्य (Homework) घर पर अवश्य कराएं।\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_सादर, प्रधानाचार्य / प्रबंधन कार्यालय_\n` +
    `_ई.वी.एस. पब्लिक स्कूल (E.V.S. Public School)_`
  );
};

export const buildFeeDueReminderMessage = (params: {
  studentName: string;
  className: string;
  studentId?: string;
  fatherName?: string;
  pendingAmount: number;
}): string => {
  const { studentName, className, studentId, fatherName, pendingAmount } = params;
  const formattedAmt = Number(pendingAmount || 0).toLocaleString('en-IN');
  const fatherLine = fatherName ? ` (पिता: श्री ${fatherName})` : '';
  const idLine = studentId ? ` · ID: ${studentId}` : '';

  return (
    `*E.V.S. PUBLIC SCHOOL — शुल्क बकाया स्मरण (Fee Reminder)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `अस्सलाम वालेकुम / आदरणीय अभिभावक,\n\n` +
    `आपके बच्चे *${studentName}*${fatherLine} (कक्षा: *${className}*${idLine}) का वर्तमान विद्यालय शुल्क बकाया निम्नानुसार है:\n\n` +
    `⚠️ *कुल शेष बकाया (Pending Due):* *₹${formattedAmt}*\n\n` +
    `आपसे विनम्र निवेदन है कि कृपया यह शुल्क शीघ्र विद्यालय कार्यालय में या *Parent Portal -> School Fees (UPI QR)* के माध्यम से ऑनलाइन जमा कर दें।\n` +
    `_(यदि आपने हाल ही में शुल्क जमा कर दिया है, तो कृपया इस संदेश को अनदेखा करें।)_\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `_धन्यवाद! शुल्क विभाग — ई.वी.एस. पब्लिक स्कूल_`
  );
};
