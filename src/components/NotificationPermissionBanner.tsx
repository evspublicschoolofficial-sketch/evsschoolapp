import React, { useState, useEffect } from 'react';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestDeviceNotificationPermission,
  sendTestNotification,
} from '../utils/notificationService';

interface NotificationPermissionBannerProps {
  lang?: string;
}

export const NotificationPermissionBanner: React.FC<NotificationPermissionBannerProps> = ({
  lang = 'hi',
}) => {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isRequesting, setIsRequesting] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [testSent, setTestSent] = useState<boolean>(false);

  const isEn = lang === 'en';

  useEffect(() => {
    const supported = isNotificationSupported();
    setIsSupported(supported);
    if (supported) {
      setPermission(getNotificationPermission());
    }
  }, []);

  const handleEnable = async () => {
    setIsRequesting(true);
    const result = await requestDeviceNotificationPermission();
    setPermission(result);
    setIsRequesting(false);
    if (result === 'granted') {
      sendTestNotification(lang);
      setTestSent(true);
      setTimeout(() => setTestSent(false), 8000);
    }
  };

  const handleSendTest = async () => {
    await sendTestNotification(lang);
    setTestSent(true);
    setTimeout(() => setTestSent(false), 6000);
  };

  if (!isSupported || isDismissed) {
    return null;
  }

  // CASE 1: Permission Granted - show discreet pill with test option
  if (permission === 'granted') {
    return (
      <div className="bg-gradient-to-r from-emerald-900/90 via-slate-900 to-emerald-950 text-white rounded-2xl p-3 sm:p-3.5 border border-emerald-400/40 shadow-md flex flex-wrap items-center justify-between gap-2.5 text-xs animate-fadeIn">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0 border border-emerald-400/40">
            <i className="fa-solid fa-bell"></i>
          </span>
          <div>
            <div className="font-extrabold text-white text-xs sm:text-sm flex items-center gap-1.5">
              <span>{isEn ? 'Phone Push Notifications Active' : 'फोन स्टेटस बार नोटिफिकेशन सक्रिय है'}</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            </div>
            <p className="text-[11px] text-emerald-200 mt-0.5">
              {isEn
                ? 'School notices will alert you at the top of your phone screen just like WhatsApp.'
                : 'नए स्कूल नोटिस फोन की स्क्रीन बंद रहने पर भी WhatsApp की तरह ऊपर दिखेंगे।'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSendTest}
            className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-sm cursor-pointer transition active:scale-95"
            title={isEn ? 'Send a test notification to your phone' : 'फोन पर टेस्ट नोटिफिकेशन भेजें'}
          >
            <i className="fa-solid fa-paper-plane text-[10px]"></i>
            <span>{testSent ? (isEn ? '✓ Sent to Phone' : '✓ फोन पर भेजा गया') : (isEn ? 'Test Notification' : 'टेस्ट नोटिफिकेशन भेजें')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="text-slate-400 hover:text-white px-2 py-1 rounded-lg text-xs cursor-pointer font-bold"
            title={isEn ? 'Dismiss' : 'हटाएं'}
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // CASE 2: Permission Blocked / Denied - show guidance on how to unblock
  if (permission === 'denied') {
    return (
      <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 sm:p-4 text-xs text-amber-950 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-fadeIn">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-base shrink-0">
            <i className="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div>
            <div className="font-extrabold text-amber-900 text-xs sm:text-sm">
              {isEn ? 'Notifications Are Blocked in Browser' : 'ब्राउज़र में नोटिफिकेशन बंद (Block) है'}
            </div>
            <p className="text-[11px] text-amber-800 mt-0.5">
              {isEn
                ? 'To receive alerts like WhatsApp: Tap the lock icon 🔒 next to the web address -> Site settings -> Allow Notifications.'
                : 'WhatsApp की तरह अलर्ट पाने हेतु: ऊपर एड्रेस बार में ताले के निशान (🔒) पर क्लिक करें -> Permissions -> Notifications -> Allow करें।'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="self-end sm:self-auto text-xs text-amber-800 hover:text-amber-950 font-bold px-2 py-1 cursor-pointer"
        >
          {isEn ? 'Got it' : 'ठीक है'}
        </button>
      </div>
    );
  }

  // CASE 3: Permission Default - Show high-conversion invite card
  return (
    <div className="bg-gradient-to-r from-[#0c2340] via-[#10316b] to-[#0c2340] text-white rounded-2xl p-4 sm:p-5 shadow-lg border border-amber-400/40 relative overflow-hidden animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-slate-950 flex items-center justify-center text-2xl font-black shadow-md shrink-0 animate-bounce-short">
            <i className="fa-solid fa-bell"></i>
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 font-extrabold text-[10px] uppercase border border-amber-400/30 mb-1">
              <i className="fa-solid fa-bolt"></i>
              <span>{isEn ? 'WhatsApp-Style Status Bar Alert' : 'WhatsApp की तरह नोटिफिकेशन अलर्ट'}</span>
            </div>
            <h4 className="font-extrabold text-sm sm:text-base text-white">
              {isEn
                ? 'Get School Notices Directly on Your Phone (Even When Screen Is Off)'
                : 'स्कूल के नए नोटिस सीधे फोन के ऊपर नोटिफिकेशन बार में पाएं'}
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              {isEn
                ? 'Receive instant alerts on your lock screen when emergency notices, homework, or holidays are published.'
                : 'फोन लॉक या स्लीप मोड में रहने पर भी आपातकालीन सूचना, छुट्टी या होमवर्क का अलर्ट तुरंत ऊपर दिखाई देगा।'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={handleEnable}
            disabled={isRequesting}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs sm:text-sm shadow-md flex items-center gap-2 cursor-pointer transition active:scale-95 disabled:opacity-50"
          >
            <i className={`fa-solid ${isRequesting ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>
            <span>{isRequesting ? (isEn ? 'Allowing...' : 'चालू किया जा रहा है...') : (isEn ? '🔔 Enable Notifications' : '🔔 नोटिफिकेशन चालू करें')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="p-2 text-slate-400 hover:text-white rounded-lg text-sm cursor-pointer"
            title={isEn ? 'Later' : 'बाद में'}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};
