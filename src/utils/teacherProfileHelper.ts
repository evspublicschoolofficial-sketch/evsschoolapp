import { TeacherProfileMeta } from '../types';
import { getAppsScriptUrl } from './busTrackingService';
import { directGetFromSheet, dualSyncWriteToSheet } from './sheetDirectSync';
import { realtimeSync } from './realtimeSync';

export const TEACHER_PROFILES_STORAGE_KEY = 'evs_teacher_profiles_v1';

export const TEACHER_SUBJECT_OPTIONS: string[] = [
  'Hindi',
  'English',
  'Mathematics',
  'Science',
  'EVS / Social Science',
  'Social Science',
  'Computer',
  'Drawing / Art',
  'Sanskrit',
  'GK / Moral Education',
];

export const TEACHER_DEPARTMENT_OPTIONS: string[] = [
  'Primary Wing',
  'Pre-Primary / Nursery',
  'Science & Mathematics',
  'Languages & Humanities',
  'Social Science & EVS',
  'Computer & Activity',
  'Administration',
];

export const parseAssignedSubjects = (val: string | string[] | null | undefined): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) {
    return Array.from(new Set(val.map((s) => String(s || '').trim()).filter(Boolean)));
  }
  const s = String(val).trim();
  if (!s) return [];
  return Array.from(
    new Set(
      s
        .split(/[,;|]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

export const loadLocalTeacherProfiles = (): Record<string, TeacherProfileMeta> => {
  try {
    const raw = localStorage.getItem(TEACHER_PROFILES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
};

export const saveLocalTeacherProfiles = (map: Record<string, TeacherProfileMeta>): void => {
  try {
    localStorage.setItem(TEACHER_PROFILES_STORAGE_KEY, JSON.stringify(map));
  } catch {}
};

export const findTeacherProfileInMap = (
  profilesMap: Record<string, TeacherProfileMeta>,
  keys: { userId?: string; username?: string; name?: string }
): TeacherProfileMeta | null => {
  const candidates = [
    keys.userId,
    keys.userId?.toLowerCase(),
    keys.username,
    keys.username?.toLowerCase(),
    keys.name,
    keys.name?.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const k of candidates) {
    if (profilesMap[k] && typeof profilesMap[k] === 'object') {
      return profilesMap[k];
    }
  }
  return null;
};

export const fetchTeacherProfilesFromServer = async (
  overrideUrl?: string,
  forceRefresh = false
): Promise<Record<string, TeacherProfileMeta>> => {
  let merged = loadLocalTeacherProfiles();
  const activeUrl = (overrideUrl || getAppsScriptUrl() || '').trim();

  try {
    const res = await fetch(
      forceRefresh ? '/api/teacher-profiles?refresh=1' : '/api/teacher-profiles',
      {
        headers: activeUrl ? { 'x-apps-script-url': activeUrl } : undefined,
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.profiles && typeof data.profiles === 'object') {
        merged = { ...merged, ...data.profiles };
      }
    }
  } catch {}

  if (activeUrl && (forceRefresh || Object.keys(merged).length === 0)) {
    try {
      const directRes = await directGetFromSheet('getTeacherProfiles', activeUrl);
      if (directRes.ok && directRes.json?.profiles && typeof directRes.json.profiles === 'object') {
        const sheetProfiles = directRes.json.profiles as Record<string, TeacherProfileMeta>;
        for (const [k, v] of Object.entries(sheetProfiles)) {
          const cur = merged[k];
          if (!cur || String(v?.updated_at || '') >= String(cur?.updated_at || '')) {
            merged[k] = v;
          }
        }
      }
    } catch {}
  }

  saveLocalTeacherProfiles(merged);
  return merged;
};

export const saveTeacherProfileDualSync = async (params: {
  userId: string;
  username?: string;
  userName?: string;
  assigned_subjects: string;
  department: string;
  teacher_photo: string;
  updated_by?: string;
  overrideUrl?: string;
}): Promise<{ serverOk: boolean; sheetSynced: boolean; sheetError?: string; profiles: Record<string, TeacherProfileMeta> }> => {
  const { userId, username, userName, assigned_subjects, department, teacher_photo, updated_by, overrideUrl } = params;
  const activeUrl = (overrideUrl || getAppsScriptUrl() || '').trim();

  const existingMap = loadLocalTeacherProfiles();
  const entry: TeacherProfileMeta = {
    assigned_subjects: String(assigned_subjects || '').trim(),
    department: String(department || '').trim(),
    teacher_photo: String(teacher_photo || '').trim(),
    updated_at: new Date().toISOString(),
    updated_by: updated_by || 'Manager',
  };

  const keys = [
    userId,
    userId?.toLowerCase(),
    username,
    username?.toLowerCase(),
    userName,
    userName?.toLowerCase(),
  ].filter(Boolean) as string[];

  for (const k of keys) {
    existingMap[k] = entry;
  }
  saveLocalTeacherProfiles(existingMap);

  const syncRes = await dualSyncWriteToSheet({
    apiPath: '/api/teacher-profile',
    apiBody: {
      userId,
      username,
      userName,
      assigned_subjects: entry.assigned_subjects,
      department: entry.department,
      teacher_photo: entry.teacher_photo,
      updated_by: entry.updated_by,
      appsScriptUrl: activeUrl,
    },
    directPayload: {
      action: 'saveTeacherProfile',
      user_id: userId,
      username: username || '',
      user_name: userName || '',
      assigned_subjects: entry.assigned_subjects,
      department: entry.department,
      teacher_photo: entry.teacher_photo,
      updated_by: entry.updated_by,
    },
    overrideUrl: activeUrl,
  });

  realtimeSync.broadcastUpdate('users', 'saveTeacherProfile', {
    userId,
    username,
    userName,
  });

  return {
    serverOk: syncRes.serverOk,
    sheetSynced: syncRes.sheetSynced,
    sheetError: syncRes.sheetError,
    profiles: existingMap,
  };
};

/**
 * Compresses an uploaded image file cleanly to max 220x220 JPEG (~6–12 KB)
 * so it persists reliably in Google Sheet workflow store, server, and localStorage.
 */
export const resizeTeacherPhotoToDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('फोटो पढ़ा नहीं जा सका'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('अमान्य इमेज फ़ाइल'));
      img.onload = () => {
        const maxSize = 220;
        let w = img.width || maxSize;
        let h = img.height || maxSize;
        if (w > h) {
          if (w > maxSize) {
            h = Math.round((h * maxSize) / w);
            w = maxSize;
          }
        } else {
          if (h > maxSize) {
            w = Math.round((w * maxSize) / h);
            h = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, w);
        canvas.height = Math.max(1, h);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context उपलब्ध नहीं'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
};
