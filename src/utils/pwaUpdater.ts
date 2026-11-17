// PWA Live Update Manager for E.V.S. Public School
// Detects GitHub/Server builds both via Service Worker waiting state AND live version.json / /api/app-version checks.

export interface PWAUpdateState {
  updateAvailable: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  justUpdated: boolean;
  checkFeedback: { type: 'latest' | 'update' | 'error'; text: string } | null;
  currentVersion: string;
  latestVersion: string | null;
  lastCheckedAt: string | null;
}

type Listener = (state: PWAUpdateState) => void;

const BUNDLED_BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== 'undefined' && __APP_BUILD_ID__ ? String(__APP_BUILD_ID__) : 'dev';

const IS_PROD = typeof import.meta !== 'undefined' && Boolean((import.meta as any).env?.PROD);

const JUST_UPDATED_KEY = 'evs_pwa_just_updated';

let swRegistration: ServiceWorkerRegistration | null = null;
let bootServerVersion: string | null = null;
let initialized = false;
let lastCheckTimestamp = 0;
let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

let state: PWAUpdateState = {
  updateAvailable: false,
  isChecking: false,
  isUpdating: false,
  justUpdated: false,
  checkFeedback: null,
  currentVersion: BUNDLED_BUILD_ID,
  latestVersion: null,
  lastCheckedAt: null,
};

const listeners = new Set<Listener>();

function emit() {
  const snapshot: PWAUpdateState = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {}
  });
}

function setState(partial: Partial<PWAUpdateState>) {
  state = { ...state, ...partial };
  emit();
}

function showTemporaryFeedback(type: 'latest' | 'update' | 'error', text: string, durationMs = 4500) {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  setState({ checkFeedback: { type, text } });
  feedbackTimer = setTimeout(() => {
    setState({ checkFeedback: null });
  }, durationMs);
}

interface LiveVersionInfo {
  version: string;
  hasGitHubUpdate?: boolean;
  githubLatestSha?: string | null;
}

async function fetchLiveServerVersion(): Promise<LiveVersionInfo | null> {
  const cacheBust = `?_t=${Date.now()}`;
  const endpoints = IS_PROD
    ? [`/version.json${cacheBust}`, `/api/app-version${cacheBust}`]
    : [`/api/app-version${cacheBust}`, `/version.json${cacheBust}`];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        const ver = data?.version ? String(data.version).trim() : '';
        if (ver && ver !== 'dev') {
          return {
            version: ver,
            hasGitHubUpdate: Boolean(data?.hasGitHubUpdate),
            githubLatestSha: data?.githubLatestSha ? String(data.githubLatestSha) : null,
          };
        }
      }
    } catch {
      // Try fallback endpoint
    }
  }
  return null;
}

function attachRegistrationListeners(reg: ServiceWorkerRegistration) {
  swRegistration = reg;

  if (reg.waiting && navigator.serviceWorker.controller) {
    setState({ updateAvailable: true });
  }

  reg.addEventListener('updatefound', () => {
    const newWorker = reg.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        setState({ updateAvailable: true });
      }
    });
  });
}

export function initPWAUpdater() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  // Check if page just reloaded after clicking "Update App"
  try {
    if (sessionStorage.getItem(JUST_UPDATED_KEY) === '1') {
      sessionStorage.removeItem(JUST_UPDATED_KEY);
      setState({ justUpdated: true });
      setTimeout(() => {
        setState({ justUpdated: false });
      }, 6500);
    }
  } catch {}

  // Capture initial server version in dev mode so we never show false positives on boot
  if (!IS_PROD || BUNDLED_BUILD_ID === 'dev') {
    fetchLiveServerVersion().then((info) => {
      if (info?.version) {
        bootServerVersion = info.version;
        setState({ currentVersion: info.version });
      }
    });
  }

  // Register Service Worker with updateViaCache: 'none' so mobile browsers always check fresh sw.js
  if ('serviceWorker' in navigator) {
    const registerSW = () => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          attachRegistrationListeners(reg);
          // Defer initial update check slightly so main school data loads instantaneously first
          setTimeout(() => {
            checkForAppUpdate(false);
          }, 4000);
        })
        .catch((err) => {
          console.warn('ServiceWorker registration error:', err);
        });
    };

    if (document.readyState === 'complete') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW, { once: true });
    }
  } else {
    setTimeout(() => {
      checkForAppUpdate(false);
    }, 4000);
  }

  // Re-check whenever user resumes/switches back to the installed PWA on phone
  const handleResumeCheck = () => {
    const now = Date.now();
    if (now - lastCheckTimestamp < 10_000) return;
    if (document.visibilityState === 'visible') {
      checkForAppUpdate(false);
    }
  };

  document.addEventListener('visibilitychange', handleResumeCheck);
  window.addEventListener('focus', handleResumeCheck);
  window.addEventListener('online', () => checkForAppUpdate(false));

  // Periodic background check every 60 seconds while open
  setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdate(false);
    }
  }, 60_000);
}

export async function checkForAppUpdate(isManual = false): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  lastCheckTimestamp = Date.now();

  if (isManual) {
    setState({ isChecking: true, checkFeedback: null });
  }

  let foundUpdate = false;

  try {
    // 1. Check Service Worker update & waiting worker
    if ('serviceWorker' in navigator) {
      const reg = swRegistration || (await navigator.serviceWorker.getRegistration('/'));
      if (reg) {
        attachRegistrationListeners(reg);
        try {
          await reg.update();
        } catch {}
        if (reg.waiting && navigator.serviceWorker.controller) {
          foundUpdate = true;
        }
      }
    }

    // 2. Check live server build version & GitHub commit updates
    const serverInfo = await fetchLiveServerVersion();
    if (serverInfo?.version) {
      if (serverInfo.hasGitHubUpdate) {
        foundUpdate = true;
        setState({ latestVersion: serverInfo.githubLatestSha || serverInfo.version });
      } else if (IS_PROD && BUNDLED_BUILD_ID !== 'dev') {
        if (serverInfo.version !== BUNDLED_BUILD_ID) {
          foundUpdate = true;
          setState({ latestVersion: serverInfo.version });
        }
      } else {
        if (!bootServerVersion) {
          bootServerVersion = serverInfo.version;
          setState({ currentVersion: serverInfo.version });
        } else if (serverInfo.version !== bootServerVersion) {
          foundUpdate = true;
          setState({ latestVersion: serverInfo.version });
        }
      }
    }

    setState({
      isChecking: false,
      updateAvailable: state.updateAvailable || foundUpdate,
      lastCheckedAt: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    });

    const effectiveUpdate = state.updateAvailable || foundUpdate;
    if (isManual) {
      if (effectiveUpdate) {
        showTemporaryFeedback('update', '🆕 नया अपडेट उपलब्ध है! ऊपर "अभी अपडेट करें" बटन दबाएं।', 6000);
      } else {
        showTemporaryFeedback('latest', '✅ आपका ऐप पहले से ही नवीनतम वर्ज़न पर है!', 4500);
      }
    }

    return effectiveUpdate;
  } catch {
    setState({ isChecking: false });
    if (isManual) {
      showTemporaryFeedback('error', '⚠️ इंटरनेट या सर्वर से अपडेट जांचने में समस्या आई। पुनः प्रयास करें।', 4500);
    }
    return false;
  }
}

export async function applyPWAUpdate(): Promise<void> {
  if (typeof window === 'undefined' || state.isUpdating) return;
  setState({ isUpdating: true, checkFeedback: null });

  try {
    // Remember to display friendly "Updated!" banner after reload (NEVER touch localStorage!)
    try {
      sessionStorage.setItem(JUST_UPDATED_KEY, '1');
    } catch {}

    // 1. Activate any waiting Service Worker
    if ('serviceWorker' in navigator) {
      const reg = swRegistration || (await navigator.serviceWorker.getRegistration('/'));
      if (reg) {
        try {
          await reg.update();
        } catch {}

        if (reg.waiting) {
          const controllerChanged = new Promise<void>((resolve) => {
            const onController = () => {
              navigator.serviceWorker.removeEventListener('controllerchange', onController);
              resolve();
            };
            navigator.serviceWorker.addEventListener('controllerchange', onController);
            setTimeout(resolve, 900);
          });
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          await controllerChanged;
        }
      }

      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_ALL_CACHES' });
      }
    }

    // 2. Purge all CacheStorage entries so old JS/CSS/HTML is completely gone
    if ('caches' in window) {
      const cacheKeys = await window.caches.keys();
      await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
    }

    // 3. Force browser HTTP cache to fetch fresh HTML index
    try {
      await fetch('/index.html', { cache: 'reload' });
    } catch {}

    // 4. Reload cleanly into the new app version (localStorage student/teacher/manager data stays intact!)
    window.location.reload();
  } catch {
    window.location.reload();
  }
}

export function getPWAUpdateState(): PWAUpdateState {
  return { ...state };
}

export function subscribePWAUpdate(listener: Listener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}
