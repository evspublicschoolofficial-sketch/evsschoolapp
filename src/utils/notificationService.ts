// Web Push & Device Notification Service
// Allows notifications to appear on the phone status bar / lock screen like WhatsApp even when screen is sleeping

export interface DeviceNotificationPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  icon?: string;
  badge?: string;
  requireInteraction?: boolean;
  data?: any;
}

const STORAGE_KEY_NOTIFIED_IDS = 'evs_notified_notice_ids';
const STORAGE_KEY_PERMISSION_REQUESTED = 'evs_notification_prompt_shown';

// Check if device/browser supports Web Notifications & Service Worker
export const isNotificationSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  return 'Notification' in window && 'serviceWorker' in navigator;
};

// Get current permission state: 'granted' | 'denied' | 'default' | 'unsupported'
export const getNotificationPermission = (): NotificationPermission | 'unsupported' => {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
};

// Request permission from the user
export const requestDeviceNotificationPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
  if (!isNotificationSupported()) return 'unsupported';

  try {
    localStorage.setItem(STORAGE_KEY_PERMISSION_REQUESTED, 'true');
    const result = await Notification.requestPermission();
    return result;
  } catch (err) {
    console.warn('Error requesting notification permission:', err);
    return Notification.permission;
  }
};

// Play a pleasant chime tone to accompany the notification
export const playNotificationChime = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    // Two-tone bell chime: 880Hz -> 1320Hz
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch {}
};

// Dispatch a real notification to the phone's status bar / lock screen
export const showDeviceNotification = async (payload: DeviceNotificationPayload): Promise<boolean> => {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  playNotificationChime();

  const title = payload.title || '📢 E.V.S. PUBLIC SCHOOL';
  const options: any = {
    body: payload.body || 'नया स्कूल अपडेट जारी हुआ है।',
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/pwa-192x192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: payload.tag || `evs-${Date.now()}`,
    renotify: true,
    requireInteraction: payload.requireInteraction ?? true,
    data: payload.data || { url: payload.url || '/' },
  };

  try {
    // 1. Try displaying via Service Worker registration (Works even when app is minimized or phone asleep!)
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration && registration.showNotification) {
        await registration.showNotification(title, options);
        return true;
      }
    }

    // 2. Fallback to standard window Notification constructor
    new Notification(title, options);
    return true;
  } catch (err) {
    console.warn('Failed to display device notification:', err);
    return false;
  }
};

// Send a test notification so parent or school admin can verify it right now on their device
export const sendTestNotification = async (lang: string = 'hi'): Promise<boolean> => {
  const isEn = lang === 'en';
  return showDeviceNotification({
    title: isEn ? '🔔 E.V.S. Public School Alert' : '🔔 E.V.S. पब्लिक स्कूल सूचना',
    body: isEn
      ? 'Test Notification Successful! You will now receive school alerts at the top of your phone just like WhatsApp.'
      : 'परीक्षण सफल! अब आपको विद्यालय के नए नोटिस व्हाट्सएप की तरह फोन के ऊपर नोटिफिकेशन बार में मिलेंगे।',
    tag: 'test-notification',
    url: '/',
  });
};

// Automatically inspect incoming notices and trigger phone notification for any newly published notice
export const checkAndNotifyNewNotices = (
  notices: Array<{ id: string; title: string; description?: string; targetClass?: string; isEmergency?: boolean }>,
  lang: string = 'hi'
) => {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;
  if (!Array.isArray(notices) || notices.length === 0) return;

  try {
    const rawStored = localStorage.getItem(STORAGE_KEY_NOTIFIED_IDS);
    const notifiedIds = new Set<string>(rawStored ? JSON.parse(rawStored) : []);

    // First time running: mark existing notices as seen so we don't spam 20 past notices
    if (notifiedIds.size === 0) {
      notices.forEach((n) => notifiedIds.add(n.id));
      localStorage.setItem(STORAGE_KEY_NOTIFIED_IDS, JSON.stringify(Array.from(notifiedIds)));
      return;
    }

    // Find any newly published notice that was not yet notified
    const newNotices = notices.filter((n) => !notifiedIds.has(n.id));

    if (newNotices.length > 0) {
      const isEn = lang === 'en';
      // Notify the latest new notice
      const latest = newNotices[0];
      const classInfo = latest.targetClass ? ` (${latest.targetClass})` : '';
      const previewText = latest.description ? latest.description.slice(0, 100) : '';

      showDeviceNotification({
        title: `${latest.isEmergency ? '🚨 ' : '📢 '}${latest.title}${classInfo}`,
        body: previewText || (isEn ? 'Tap to view full notice in School Portal' : 'स्कूल पोर्टल में पूरा विवरण देखने के लिए टैप करें'),
        tag: `notice-${latest.id}`,
        url: '/',
      });

      // Update stored set
      newNotices.forEach((n) => notifiedIds.add(n.id));
      localStorage.setItem(STORAGE_KEY_NOTIFIED_IDS, JSON.stringify(Array.from(notifiedIds)));
    }
  } catch (e) {
    console.warn('Error in checkAndNotifyNewNotices:', e);
  }
};
