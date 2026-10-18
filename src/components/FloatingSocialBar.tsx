import React, { useState, useEffect } from 'react';

interface SocialLinkConfig {
  whatsappNumber: string;
  whatsappMessage: string;
  instagramUrl: string;
  facebookUrl: string;
  youtubeUrl?: string;
  phoneNumber: string;
}

const DEFAULT_CONFIG: SocialLinkConfig = {
  whatsappNumber: '9759762837',
  whatsappMessage: 'नमस्ते, मुझे E.V.S. पब्लिक स्कूल के बारे में जानकारी चाहिए।',
  instagramUrl: 'https://www.instagram.com/evspublicschool',
  facebookUrl: 'https://www.facebook.com/evspublicschool',
  youtubeUrl: 'https://www.youtube.com',
  phoneNumber: '9759762837',
};

const STORAGE_KEY = 'evs_floating_social_config';

interface FloatingSocialBarProps {
  isManager?: boolean;
  spreadsheetId?: string;
}

export const FloatingSocialBar: React.FC<FloatingSocialBarProps> = ({
  isManager = false,
  spreadsheetId,
}) => {
  const [config, setConfig] = useState<SocialLinkConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_CONFIG;
  });

  // State: expanded/minimized
  const [isMinimized, setIsMinimized] = useState<boolean>(() => {
    try {
      return localStorage.getItem('evs_social_minimized') === 'true';
    } catch {
      return false;
    }
  });

  // State: position 'right' | 'left'
  const [position, setPosition] = useState<'right' | 'left'>(() => {
    try {
      return (localStorage.getItem('evs_social_position') as 'right' | 'left') || 'right';
    } catch {
      return 'right';
    }
  });

  // Settings modal open (restricted strictly to manager)
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [activeModalTab, setActiveModalTab] = useState<'form' | 'sheet_guide'>('form');
  const [editConfig, setEditConfig] = useState<SocialLinkConfig>(config);

  // Auto-fetch from Google Sheets 'Social_Links' sheet if available
  useEffect(() => {
    if (!spreadsheetId) return;
    const fetchSocialLinksFromSheet = async () => {
      try {
        const encoded = encodeURIComponent('Social_Links');
        const res = await fetch(
          `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encoded}&_t=${Date.now()}`
        );
        if (!res.ok) return;
        const text = await res.text();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return;
        const data = JSON.parse(text.slice(start, end + 1));
        const rows = data.table?.rows || [];
        if (rows.length === 0) return;

        const newCfg: Partial<SocialLinkConfig> = {};

        for (const r of rows) {
          const cells = (r.c || []).map((c: any) =>
            c ? (c.f !== undefined && c.f !== null ? c.f : c.v) : ''
          );
          const col0 = String(cells[0] || '').trim().toLowerCase();
          const col1 = String(cells[1] || '').trim();
          const col2 = String(cells[2] || '').trim();

          // Key-Value row matching
          if (col0.includes('whatsapp') && !col0.includes('message')) {
            if (col1) newCfg.whatsappNumber = col1.replace(/\D/g, '');
            if (col2) newCfg.whatsappMessage = col2;
          } else if (col0.includes('whatsapp_message') || col0.includes('message')) {
            if (col1) newCfg.whatsappMessage = col1;
          } else if (col0.includes('instagram') || col0.includes('insta')) {
            if (col1) {
              newCfg.instagramUrl = col1.startsWith('http')
                ? col1
                : `https://instagram.com/${col1.replace('@', '')}`;
            }
          } else if (col0.includes('facebook') || col0.includes('fb')) {
            if (col1) {
              newCfg.facebookUrl = col1.startsWith('http')
                ? col1
                : `https://facebook.com/${col1}`;
            }
          } else if (col0.includes('phone') || col0.includes('call') || col0.includes('mobile')) {
            if (col1) newCfg.phoneNumber = col1;
          } else if (col0.includes('youtube') || col0.includes('yt')) {
            if (col1) newCfg.youtubeUrl = col1;
          }
        }

        if (Object.keys(newCfg).length > 0) {
          setConfig((prev) => {
            const merged = { ...prev, ...newCfg };
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            } catch {}
            return merged;
          });
        }
      } catch (err) {
        // Non-blocking fallback to local/default configuration
      }
    };

    fetchSocialLinksFromSheet();
  }, [spreadsheetId]);

  const toggleMinimized = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('evs_social_minimized', String(next));
      } catch {}
      return next;
    });
  };

  const togglePosition = () => {
    setPosition((prev) => {
      const next = prev === 'right' ? 'left' : 'right';
      try {
        localStorage.setItem('evs_social_position', next);
      } catch {}
      return next;
    });
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    setConfig(editConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(editConfig));
    } catch {}
    setIsSettingsOpen(false);
  };

  const whatsappHref = `https://wa.me/91${config.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(
    config.whatsappMessage
  )}`;

  return (
    <>
      {/* Floating Container (Fixed on screen) */}
      <div
        className={`fixed z-40 transition-all duration-300 pointer-events-auto flex flex-col items-center gap-3 select-none ${
          position === 'right' ? 'right-4 sm:right-6' : 'left-4 sm:left-6'
        } bottom-20 sm:bottom-8`}
        style={{ perspective: 1000 }}
      >
        {/* Minimized Pill Toggle */}
        {isMinimized ? (
          <button
            type="button"
            onClick={toggleMinimized}
            className="group relative flex items-center gap-2 px-3 py-2 rounded-full bg-gradient-to-r from-emerald-600 via-[#833ab4] to-[#1877F2] text-white shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer animate-float-1 border-2 border-white/40"
            title="सोशल मीडिया फ्लोटिंग मेन्यू खोलें"
          >
            <div className="flex -space-x-1.5 items-center">
              <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] shadow-xs">
                <i className="fa-brands fa-whatsapp"></i>
              </span>
              <span className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#fd1d1d] to-[#833ab4] text-white flex items-center justify-center text-[10px] shadow-xs">
                <i className="fa-brands fa-instagram"></i>
              </span>
              <span className="w-5 h-5 rounded-full bg-[#1877F2] text-white flex items-center justify-center text-[10px] shadow-xs">
                <i className="fa-brands fa-facebook-f"></i>
              </span>
            </div>
            <span className="text-xs font-black tracking-wide pr-1">Social</span>
            <i className="fa-solid fa-angles-up text-xs text-amber-300 group-hover:-translate-y-0.5 transition-transform"></i>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-3.5 animate-fadeIn">
            {/* Top Toolbar (Mini buttons to move or minimize; Gear icon STRICTLY FOR MANAGER) */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/85 backdrop-blur-md text-white/70 border border-white/20 shadow-md text-[10px]">
              <button
                type="button"
                onClick={togglePosition}
                className="hover:text-amber-300 transition-colors cursor-pointer px-1"
                title={position === 'right' ? 'बाएं (Left) शिफ्ट करें' : 'दाएं (Right) शिफ्ट करें'}
              >
                <i className={`fa-solid ${position === 'right' ? 'fa-arrow-left' : 'fa-arrow-right'}`}></i>
              </button>

              {/* SETTINGS GEAR: ONLY VISIBLE IF MANAGER IS LOGGED IN */}
              {isManager && (
                <>
                  <span className="text-white/30">•</span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditConfig(config);
                      setActiveModalTab('form');
                      setIsSettingsOpen(true);
                    }}
                    className="hover:text-amber-300 transition-colors cursor-pointer px-1 text-amber-400 font-bold"
                    title="सोशल मीडिया लिंक सेटिंग्स (केवल प्रबंधक हेतु)"
                  >
                    <i className="fa-solid fa-gear"></i>
                  </button>
                </>
              )}

              <span className="text-white/30">•</span>
              <button
                type="button"
                onClick={toggleMinimized}
                className="hover:text-rose-400 transition-colors cursor-pointer px-1"
                title="मिनीमाइज़ करें"
              >
                <i className="fa-solid fa-minus"></i>
              </button>
            </div>

            {/* 1. WHATSAPP FLOATING BUBBLE */}
            <div className="relative group flex items-center justify-center animate-float-1">
              {/* Outer Pulse Ring */}
              <div className="absolute inset-0 rounded-full bg-emerald-500/30 animate-pulse-ring pointer-events-none"></div>

              {/* Tooltip on hover */}
              <div
                className={`absolute ${
                  position === 'right' ? 'right-full mr-3' : 'left-full ml-3'
                } hidden group-hover:flex items-center px-3 py-1.5 rounded-xl bg-slate-950 text-white text-xs font-bold whitespace-nowrap shadow-xl border border-emerald-500/30 backdrop-blur-md pointer-events-none transition-all z-50`}
              >
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <i className="fa-brands fa-whatsapp text-sm"></i>
                  <span>WhatsApp पर चैट करें</span>
                </span>
              </div>

              {/* Button */}
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 w-13 h-13 sm:w-14 sm:h-14 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-green-400 text-white flex items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-emerald-600/40 hover:scale-115 active:scale-95 transition-all duration-300 cursor-pointer border-2 border-white/50 group-hover:rotate-6"
                aria-label="WhatsApp School Chat"
              >
                <i className="fa-brands fa-whatsapp drop-shadow-md"></i>
                {/* Live Online Badge */}
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-white flex items-center justify-center shadow-xs">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                </span>
              </a>

              {/* Floating Shadow Below */}
              <div className="absolute -bottom-2 w-10 h-2 bg-emerald-950/40 rounded-full blur-xs animate-float-shadow pointer-events-none"></div>
            </div>

            {/* 2. INSTAGRAM FLOATING BUBBLE */}
            <div className="relative group flex items-center justify-center animate-float-2">
              {/* Outer Pulse Ring */}
              <div
                className="absolute inset-0 rounded-full bg-pink-500/20 animate-pulse-ring pointer-events-none"
                style={{ animationDelay: '0.8s' }}
              ></div>

              {/* Tooltip */}
              <div
                className={`absolute ${
                  position === 'right' ? 'right-full mr-3' : 'left-full ml-3'
                } hidden group-hover:flex items-center px-3 py-1.5 rounded-xl bg-slate-950 text-white text-xs font-bold whitespace-nowrap shadow-xl border border-pink-500/30 backdrop-blur-md pointer-events-none transition-all z-50`}
              >
                <span className="flex items-center gap-1.5 text-pink-400">
                  <i className="fa-brands fa-instagram text-sm"></i>
                  <span>Instagram पेज फॉलो करें</span>
                </span>
              </div>

              {/* Button */}
              <a
                href={config.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 w-13 h-13 sm:w-14 sm:h-14 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-[#f09433] via-[#e6683c] via-[#dc2743] via-[#cc2366] to-[#bc1888] text-white flex items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-pink-600/40 hover:scale-115 active:scale-95 transition-all duration-300 cursor-pointer border-2 border-white/50 group-hover:-rotate-6"
                aria-label="Instagram School Page"
              >
                <i className="fa-brands fa-instagram drop-shadow-md"></i>
              </a>

              {/* Floating Shadow */}
              <div
                className="absolute -bottom-2 w-10 h-2 bg-pink-950/40 rounded-full blur-xs animate-float-shadow pointer-events-none"
                style={{ animationDelay: '0.8s' }}
              ></div>
            </div>

            {/* 3. FACEBOOK FLOATING BUBBLE */}
            <div className="relative group flex items-center justify-center animate-float-3">
              {/* Outer Pulse Ring */}
              <div
                className="absolute inset-0 rounded-full bg-blue-500/20 animate-pulse-ring pointer-events-none"
                style={{ animationDelay: '1.4s' }}
              ></div>

              {/* Tooltip */}
              <div
                className={`absolute ${
                  position === 'right' ? 'right-full mr-3' : 'left-full ml-3'
                } hidden group-hover:flex items-center px-3 py-1.5 rounded-xl bg-slate-950 text-white text-xs font-bold whitespace-nowrap shadow-xl border border-blue-500/30 backdrop-blur-md pointer-events-none transition-all z-50`}
              >
                <span className="flex items-center gap-1.5 text-blue-400">
                  <i className="fa-brands fa-facebook-f text-sm"></i>
                  <span>Facebook पेज देखें</span>
                </span>
              </div>

              {/* Button */}
              <a
                href={config.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative z-10 w-13 h-13 sm:w-14 sm:h-14 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-[#1877F2] via-[#166fe5] to-[#0d65d9] text-white flex items-center justify-center text-2xl sm:text-3xl shadow-xl shadow-blue-600/40 hover:scale-115 active:scale-95 transition-all duration-300 cursor-pointer border-2 border-white/50 group-hover:rotate-6"
                aria-label="Facebook School Page"
              >
                <i className="fa-brands fa-facebook-f drop-shadow-md"></i>
              </a>

              {/* Floating Shadow */}
              <div
                className="absolute -bottom-2 w-10 h-2 bg-blue-950/40 rounded-full blur-xs animate-float-shadow pointer-events-none"
                style={{ animationDelay: '1.4s' }}
              ></div>
            </div>

            {/* 4. CALL DIRECT BUBBLE */}
            <div
              className="relative group flex items-center justify-center animate-float-1"
              style={{ animationDelay: '0.4s' }}
            >
              {/* Tooltip */}
              <div
                className={`absolute ${
                  position === 'right' ? 'right-full mr-3' : 'left-full ml-3'
                } hidden group-hover:flex items-center px-3 py-1.5 rounded-xl bg-slate-950 text-white text-xs font-bold whitespace-nowrap shadow-xl border border-amber-500/30 backdrop-blur-md pointer-events-none transition-all z-50`}
              >
                <span className="flex items-center gap-1.5 text-amber-300">
                  <i className="fa-solid fa-phone text-xs"></i>
                  <span>कॉल करें ({config.phoneNumber})</span>
                </span>
              </div>

              {/* Button */}
              <a
                href={`tel:${config.phoneNumber}`}
                className="relative z-10 w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 flex items-center justify-center text-lg sm:text-xl shadow-lg shadow-amber-500/30 hover:scale-115 active:scale-95 transition-all duration-300 cursor-pointer border-2 border-white/40"
                aria-label="Call School"
              >
                <i className="fa-solid fa-phone"></i>
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal (STRICTLY FOR MANAGER ONLY) */}
      {isSettingsOpen && isManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#0c2340] text-amber-300 flex items-center justify-center font-bold text-lg">
                  <i className="fa-solid fa-share-nodes"></i>
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                    <span>सोशल मीडिया लिंक सेटिंग्स</span>
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase">
                      केवल मैनेजर
                    </span>
                  </h3>
                  <span className="text-xs text-slate-500">
                    फ्लोटिंग सोशल आइकन्स के URL व गूगल शीट सेटअप
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Manager Privacy Notice */}
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] text-amber-900 flex items-start gap-2">
              <i className="fa-solid fa-shield-halved text-amber-600 mt-0.5 text-xs"></i>
              <span>
                <strong>गोपनीयता सुरक्षा:</strong> यह सेटिंग्स बटन और कॉन्फ़िगरेशन केवल स्कूल मैनेजर के लॉगिन में ही दिखाई देता है। किसी भी छात्र, अभिभावक या आगंतुक को यह सेटिंग नहीं दिखती।
              </span>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setActiveModalTab('form')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeModalTab === 'form'
                    ? 'bg-[#0c2340] text-amber-300 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-sliders mr-1.5"></i>
                <span>त्वरित लिंक बदलें (Direct Edit)</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveModalTab('sheet_guide')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeModalTab === 'sheet_guide'
                    ? 'bg-[#0c2340] text-amber-300 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <i className="fa-solid fa-table mr-1.5 text-emerald-600"></i>
                <span>Google Sheet टैब व कॉलम्स गाइड</span>
              </button>
            </div>

            {/* TAB 1: DIRECT EDIT FORM */}
            {activeModalTab === 'form' && (
              <form onSubmit={handleSaveSettings} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <i className="fa-brands fa-whatsapp text-emerald-600 text-sm"></i>
                    <span>WhatsApp नंबर (10 अंक):</span>
                  </label>
                  <input
                    type="text"
                    value={editConfig.whatsappNumber}
                    onChange={(e) => setEditConfig({ ...editConfig, whatsappNumber: e.target.value })}
                    placeholder="9759762837"
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    WhatsApp डिफ़ॉल्ट संदेश (Pre-filled Message):
                  </label>
                  <input
                    type="text"
                    value={editConfig.whatsappMessage}
                    onChange={(e) => setEditConfig({ ...editConfig, whatsappMessage: e.target.value })}
                    placeholder="नमस्ते, मुझे स्कूल के बारे में जानकारी चाहिए।"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <i className="fa-brands fa-instagram text-pink-600 text-sm"></i>
                    <span>Instagram प्रोफाइल URL:</span>
                  </label>
                  <input
                    type="url"
                    value={editConfig.instagramUrl}
                    onChange={(e) => setEditConfig({ ...editConfig, instagramUrl: e.target.value })}
                    placeholder="https://instagram.com/evspublicschool"
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <i className="fa-brands fa-facebook text-blue-600 text-sm"></i>
                    <span>Facebook पेज URL:</span>
                  </label>
                  <input
                    type="url"
                    value={editConfig.facebookUrl}
                    onChange={(e) => setEditConfig({ ...editConfig, facebookUrl: e.target.value })}
                    placeholder="https://facebook.com/evspublicschool"
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono text-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1.5">
                    <i className="fa-solid fa-phone text-amber-600 text-xs"></i>
                    <span>कॉल हेल्पलाइन नंबर (Phone):</span>
                  </label>
                  <input
                    type="text"
                    value={editConfig.phoneNumber}
                    onChange={(e) => setEditConfig({ ...editConfig, phoneNumber: e.target.value })}
                    placeholder="9759762837"
                    required
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-300 font-mono font-bold text-slate-800"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 cursor-pointer"
                  >
                    रद्द करें
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-[#0c2340] hover:bg-slate-800 text-amber-300 font-bold cursor-pointer shadow-md"
                  >
                    सहेजें (Save Changes)
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: GOOGLE SHEET GUIDE */}
            {activeModalTab === 'sheet_guide' && (
              <div className="space-y-3.5 text-xs text-slate-700 max-h-96 overflow-y-auto pr-1">
                <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-900">
                  <span className="font-bold block text-sm mb-1">
                    Google Sheet में नया टैब: <span className="font-mono text-emerald-800">Social_Links</span>
                  </span>
                  <span>
                    आप अपनी स्कूल गूगल स्प्रेडशीट में एक नया टैब बनाकर उसका नाम <b>Social_Links</b> रख लें।
                  </span>
                </div>

                <div>
                  <span className="font-bold text-slate-900 block mb-1.5">
                    कॉलम्स के नाम (Row 1 Header):
                  </span>
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-100 font-bold text-slate-800">
                        <tr>
                          <th className="p-2">कॉलम</th>
                          <th className="p-2">हेडर नाम (Column Name)</th>
                          <th className="p-2">उदाहरण (Sample Value)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        <tr>
                          <td className="p-2 font-bold text-slate-600">A</td>
                          <td className="p-2 font-bold text-blue-900">Platform</td>
                          <td className="p-2 text-slate-700">WhatsApp</td>
                        </tr>
                        <tr>
                          <td className="p-2 font-bold text-slate-600">B</td>
                          <td className="p-2 font-bold text-blue-900">URL_or_Number</td>
                          <td className="p-2 text-slate-700">9759762837</td>
                        </tr>
                        <tr>
                          <td className="p-2 font-bold text-slate-600">C</td>
                          <td className="p-2 font-bold text-blue-900">Title_Hindi</td>
                          <td className="p-2 text-slate-700">WhatsApp पर चैट करें</td>
                        </tr>
                        <tr>
                          <td className="p-2 font-bold text-slate-600">D</td>
                          <td className="p-2 font-bold text-blue-900">Is_Active</td>
                          <td className="p-2 text-slate-700">TRUE</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200 space-y-1 text-[11px]">
                  <span className="font-bold text-slate-900 block">Row 2 से Row 5 में क्या भरें:</span>
                  <div>• <b>Row 2:</b> Platform = <code className="font-bold">WhatsApp</code> | URL = <code className="font-bold">9759762837</code> | Title = WhatsApp चैट | Is_Active = TRUE</div>
                  <div>• <b>Row 3:</b> Platform = <code className="font-bold">Instagram</code> | URL = <code className="font-bold">https://instagram.com/evspublicschool</code> | Title = इंस्टाग्राम | Is_Active = TRUE</div>
                  <div>• <b>Row 4:</b> Platform = <code className="font-bold">Facebook</code> | URL = <code className="font-bold">https://facebook.com/evspublicschool</code> | Title = फेसबुक पेज | Is_Active = TRUE</div>
                  <div>• <b>Row 5:</b> Platform = <code className="font-bold">Phone</code> | URL = <code className="font-bold">9759762837</code> | Title = कॉल करें | Is_Active = TRUE</div>
                </div>

                <div className="pt-2 text-right">
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-4 py-2 rounded-xl bg-[#0c2340] text-amber-300 font-bold text-xs"
                  >
                    समझ गया (Done)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
