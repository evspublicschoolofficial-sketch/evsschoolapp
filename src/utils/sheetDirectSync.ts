import { getAppsScriptUrl } from './busTrackingService';

export interface DirectSheetResult {
  ok: boolean;
  error?: string;
  data?: any;
}

function parseGasText(text: string): { ok: boolean; error?: string; json?: any } {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, error: 'Google Apps Script से खाली जवाब मिला' };
  if (trimmed.startsWith('<')) {
    return {
      ok: false,
      error: 'Apps Script Deployment अनुमति (Who has access: Anyone) जाँचें',
    };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && (parsed.status === 'error' || parsed.error)) {
      return {
        ok: false,
        error: String(parsed.message || parsed.error || 'Apps Script error'),
        json: parsed,
      };
    }
    if (
      parsed &&
      (parsed.status === 'success' ||
        parsed.success === true ||
        parsed.updated ||
        parsed.created ||
        parsed.deleted)
    ) {
      return { ok: true, json: parsed };
    }
    return { ok: true, json: parsed };
  } catch {
    if (trimmed.toLowerCase().includes('success') || trimmed.toLowerCase().includes('updated')) {
      return { ok: true };
    }
    return { ok: false, error: trimmed.slice(0, 160) };
  }
}

export async function directPostToSheet(
  payload: Record<string, any>,
  overrideUrl?: string
): Promise<DirectSheetResult> {
  const targetUrl = (overrideUrl || getAppsScriptUrl() || '').trim();
  if (!targetUrl.startsWith('https://script.google.com/macros/s/')) {
    return { ok: false, error: 'अमान्य Google Apps Script URL' };
  }

  let lastError = '';

  // 1. Direct CORS-simple POST (text/plain;charset=utf-8 avoids preflight)
  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    const check = parseGasText(text);
    if (res.ok && check.ok) {
      return { ok: true, data: check.json };
    }
    lastError = check.error || `HTTP ${res.status}`;
  } catch (err: any) {
    lastError = err?.message || 'Direct POST network error';
  }

  // 2. Fallback via doGet for actions that also support GET query params
  try {
    const action = String(payload?.action || '').trim();
    let getUrl = '';
    if (action === 'saveTeacherPerformance') {
      const recStr = typeof payload.record === 'string' ? payload.record : JSON.stringify(payload);
      getUrl = `${targetUrl}?action=saveTeacherPerformance&record=${encodeURIComponent(recStr)}`;
    } else if (action === 'saveSyllabusTopic') {
      const topStr = typeof payload.topic === 'string' ? payload.topic : JSON.stringify(payload);
      getUrl = `${targetUrl}?action=saveSyllabusTopic&topic=${encodeURIComponent(topStr)}`;
    } else if (action === 'saveSchoolHoliday') {
      const holStr = typeof payload.holiday === 'string' ? payload.holiday : JSON.stringify(payload);
      getUrl = `${targetUrl}?action=saveSchoolHoliday&holiday=${encodeURIComponent(holStr)}`;
    } else if (action === 'deleteSyllabusTopic' || action === 'deleteSchoolHoliday' || action === 'deleteExamMark') {
      getUrl = `${targetUrl}?action=${encodeURIComponent(action)}&id=${encodeURIComponent(String(payload.id || ''))}`;
    } else if (action === 'saveReportCardMeta') {
      const metaStr = typeof payload.meta === 'string' ? payload.meta : JSON.stringify(payload.meta || payload);
      const candidate = `${targetUrl}?action=saveReportCardMeta&meta=${encodeURIComponent(metaStr)}`;
      if (candidate.length < 7500) getUrl = candidate;
    } else if (action === 'saveExamMarksBatch') {
      const recStr = typeof payload.records === 'string' ? payload.records : JSON.stringify(payload.records || []);
      const candidate = `${targetUrl}?action=saveExamMarksBatch&records=${encodeURIComponent(recStr)}`;
      if (candidate.length < 7500) getUrl = candidate;
    } else if (action === 'saveExamSeatingDraft') {
      const draftStr =
        typeof payload.draftConfig === 'string'
          ? payload.draftConfig
          : JSON.stringify(payload.draftConfig || {});
      const candidate = `${targetUrl}?action=saveExamSeatingDraft&draftConfig=${encodeURIComponent(draftStr)}`;
      if (candidate.length < 7500) getUrl = candidate;
    } else if (action === 'saveReportCardAccess') {
      const accStr =
        typeof payload.accessConfig === 'string'
          ? payload.accessConfig
          : JSON.stringify(payload.accessConfig || {});
      const candidate = `${targetUrl}?action=saveReportCardAccess&accessConfig=${encodeURIComponent(accStr)}`;
      if (candidate.length < 7500) getUrl = candidate;
    } else if (action === 'saveReportCardDraft') {
      const drStr =
        typeof payload.draft === 'string' ? payload.draft : JSON.stringify(payload.draft || {});
      const candidate = `${targetUrl}?action=saveReportCardDraft&draft=${encodeURIComponent(drStr)}`;
      if (candidate.length < 7500) getUrl = candidate;
    } else if (action === 'assignTeacherClass' || action === 'updateUserClass') {
      const params = new URLSearchParams({
        action: 'assignTeacherClass',
        user_id: String(payload.user_id || payload.userId || ''),
        assigned_class: String(payload.assigned_class || payload.assignedClass || ''),
      });
      if (payload.name || payload.userName) params.set('name', String(payload.name || payload.userName));
      if (payload.username) params.set('username', String(payload.username));
      const candidate = `${targetUrl}?${params.toString()}`;
      if (candidate.length < 7500) getUrl = candidate;
    }

    if (getUrl) {
      const gRes = await fetch(getUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      const gText = await gRes.text();
      const gCheck = parseGasText(gText);
      if (gRes.ok && gCheck.ok) {
        return { ok: true, data: gCheck.json };
      }
      lastError = gCheck.error || lastError || `HTTP ${gRes.status}`;
    }
  } catch (err: any) {
    lastError = lastError || err?.message || 'Direct GET fallback error';
  }

  if (/argument too large|maximum size|exceeded/i.test(lastError)) {
    lastError = 'डेटा आकार Apps Script की 9KB सीमा से अधिक है — कृपया Apps Script अपडेट करें या कम प्रविष्टियाँ एक साथ भेजें।';
  }

  return { ok: false, error: lastError || 'Google Sheet से कनेक्ट नहीं हो सका' };
}

export async function directGetFromSheet(
  action: string,
  overrideUrl?: string
): Promise<{ ok: boolean; json?: any; error?: string }> {
  const targetUrl = (overrideUrl || getAppsScriptUrl() || '').trim();
  if (!targetUrl.startsWith('https://script.google.com/macros/s/')) {
    return { ok: false, error: 'अमान्य Google Apps Script URL' };
  }
  try {
    const res = await fetch(`${targetUrl}?action=${encodeURIComponent(action)}&_t=${Date.now()}`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    const check = parseGasText(text);
    if (!res.ok || !check.ok) {
      return { ok: false, error: check.error || `HTTP ${res.status}` };
    }
    return { ok: true, json: check.json };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Google Sheet से डेटा नहीं मिल सका' };
  }
}

export async function dualSyncWriteToSheet(params: {
  apiPath: string;
  method?: 'POST' | 'DELETE';
  apiBody?: Record<string, any>;
  directPayload: Record<string, any>;
  overrideUrl?: string;
}): Promise<{
  serverOk: boolean;
  sheetSynced: boolean;
  sheetError?: string;
  data?: any;
}> {
  const activeUrl = (params.overrideUrl || getAppsScriptUrl() || '').trim();
  let serverOk = false;
  let serverData: any = null;
  let serverError = '';

  try {
    const res = await fetch(params.apiPath, {
      method: params.method || 'POST',
      headers: {
        ...(params.method !== 'DELETE' ? { 'Content-Type': 'application/json' } : {}),
        'x-apps-script-url': activeUrl,
      },
      body: params.method === 'DELETE' ? undefined : JSON.stringify({ ...(params.apiBody || {}), appsScriptUrl: activeUrl }),
      signal: AbortSignal.timeout(28000),
    });

    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        serverData = await res.json().catch(() => null);
        if (serverData) {
          serverOk = true;
          if (serverData.sheetSynced === true) {
            return {
              serverOk: true,
              sheetSynced: true,
              data: serverData,
            };
          }
          serverError = serverData.sheetError || '';
        }
      } else {
        serverError = 'सर्वर ने JSON के बजाय HTML उत्तर दिया';
      }
    } else {
      const errJson = await res.json().catch(() => null);
      serverError = errJson?.error || errJson?.sheetError || `सर्वर त्रुटि (${res.status})`;
    }
  } catch (err: any) {
    serverError = err?.message || 'सर्वर से कनेक्शन टाइमआउट';
  }

  // Fallback: direct browser -> Google Apps Script sync (works even on standalone / Shared tabs or server timeout)
  const directRes = await directPostToSheet(params.directPayload, activeUrl);
  if (directRes.ok) {
    return {
      serverOk,
      sheetSynced: true,
      data: serverData || directRes.data,
    };
  }

  return {
    serverOk,
    sheetSynced: false,
    sheetError: directRes.error || serverError || 'Google Sheet सिंक विफल',
    data: serverData,
  };
}
