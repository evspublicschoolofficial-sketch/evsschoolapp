// Web Audio API & Speech Synthesis based School Announcement, Loud QR Scanner & Chime Sound Generator
// Fully optimized for iOS Safari (iPhone/iPad), Android Chrome, and Desktop browsers.
// Uses a single shared AudioContext + DynamicsCompressorNode to prevent browser AudioContext exhaustion
// and deliver loud, clear audio without clipping across unlimited scans.

let activeAudioCtx: AudioContext | null = null;
let sharedCompressor: DynamicsCompressorNode | null = null;
let activeChimeGain: GainNode | null = null;
let announcementIntervalTimer: any = null;
let isPlaying = false;

export type ScannerAudioMode = 'voice_and_chime' | 'chime_only' | 'mute';

export const EVS_SEEN_ANNOUNCEMENTS_KEY = 'evs_seen_announcements_v1';
export const EVS_ANNOUNCEMENT_SEEN_EVENT = 'evs_announcement_seen';

// Global utterance tracker to permanently prevent iOS Safari WebKit Garbage Collection bug
declare global {
  interface Window {
    __evs_utterances?: SpeechSynthesisUtterance[];
    __evs_silent_audio?: HTMLAudioElement | null;
  }
}

if (typeof window !== 'undefined') {
  window.__evs_utterances = window.__evs_utterances || [];
}

/**
 * Detects if the current device is Apple iOS (iPhone, iPad, iPod)
 */
export const isIOSDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return (
    /iphone|ipad|ipod/.test(ua) ||
    (window.navigator.maxTouchPoints > 1 && /macintosh/.test(ua))
  );
};

// Cached voices list
let cachedVoices: SpeechSynthesisVoice[] = [];
export const getAvailableVoices = (): SpeechSynthesisVoice[] => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      cachedVoices = voices;
    }
  } catch {}
  return cachedVoices;
};

// Eagerly populate voices
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  try {
    getAvailableVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      getAvailableVoices();
    };
  } catch {}
}

/**
 * Check if the device has a native Hindi TTS voice installed
 */
export const hasNativeHindiVoice = (): boolean => {
  const voices = getAvailableVoices();
  return voices.some(
    (v) =>
      v.lang.toLowerCase().startsWith('hi') ||
      v.name.toLowerCase().includes('hindi') ||
      v.name.toLowerCase().includes('lekha')
  );
};

/**
 * Create or resume single shared AudioContext safely
 */
export const getAudioContext = (): AudioContext => {
  if (!activeAudioCtx || activeAudioCtx.state === 'closed') {
    const AudioCtxClass =
      window.AudioContext || (window as any).webkitAudioContext;
    activeAudioCtx = new AudioCtxClass();
    sharedCompressor = null;
  }
  if (activeAudioCtx.state === 'suspended') {
    activeAudioCtx.resume().catch(() => {});
  }
  return activeAudioCtx;
};

/**
 * Shared DynamicsCompressorNode connected to destination so loud multi-oscillator chimes
 * punch cleanly at high speaker volume without clipping or distorting.
 */
const getLoudOutputNode = (ctx: AudioContext): AudioNode => {
  try {
    if (!sharedCompressor || sharedCompressor.context !== ctx) {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.setValueAtTime(-16, ctx.currentTime);
      comp.knee.setValueAtTime(12, ctx.currentTime);
      comp.ratio.setValueAtTime(10, ctx.currentTime);
      comp.attack.setValueAtTime(0.002, ctx.currentTime);
      comp.release.setValueAtTime(0.12, ctx.currentTime);
      comp.connect(ctx.destination);
      sharedCompressor = comp;
    }
    return sharedCompressor;
  } catch {
    return ctx.destination;
  }
};

/**
 * Comprehensive iOS Audio & Speech Unlocker
 * MUST be called directly inside a user touch or click event.
 */
export const unlockAudioContext = async (): Promise<boolean> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // 1. Play 1 sample silent buffer through Web Audio to awaken audio pipeline
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {}

    // 2. Play silent micro-audio element (bypasses iOS media mute lock)
    try {
      if (!window.__evs_silent_audio) {
        const audio = document.createElement('audio');
        audio.src =
          'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');
        window.__evs_silent_audio = audio;
      }
      window.__evs_silent_audio.play().catch(() => {});
    } catch {}

    // 3. Prime iOS Safari Speech Synthesis queue synchronously
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch {}
    }

    return ctx.state === 'running';
  } catch {
    return false;
  }
};

export interface LoudNoteSpec {
  freq: number;
  offset: number;
  dur: number;
  type?: OscillatorType;
  level?: number;
  harmonic?: boolean;
}

/**
 * Shared high-volume chime/beep player using single AudioContext + Compressor
 */
export const playLoudChime = (notes: LoudNoteSpec[], masterLevel = 0.95): void => {
  try {
    const ctx = getAudioContext();
    const outNode = getLoudOutputNode(ctx);
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(Math.max(0.05, Math.min(1.5, masterLevel)), now);
    masterGain.connect(outNode);

    notes.forEach((n) => {
      const startTime = now + Math.max(0, n.offset);
      const endTime = startTime + Math.max(0.04, n.dur);
      const level = n.level ?? 0.72;

      const osc = ctx.createOscillator();
      osc.type = n.type || 'triangle';
      osc.frequency.setValueAtTime(n.freq, startTime);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, startTime);
      noteGain.gain.linearRampToValueAtTime(level, startTime + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      osc.connect(noteGain);
      noteGain.connect(masterGain);

      osc.start(startTime);
      osc.stop(endTime);

      if (n.harmonic !== false) {
        const oscHarm = ctx.createOscillator();
        oscHarm.type = 'sine';
        oscHarm.frequency.setValueAtTime(n.freq * 2, startTime);
        const harmGain = ctx.createGain();
        harmGain.gain.setValueAtTime(0.0001, startTime);
        harmGain.gain.linearRampToValueAtTime(level * 0.42, startTime + 0.01);
        harmGain.gain.exponentialRampToValueAtTime(0.0001, endTime);
        oscHarm.connect(harmGain);
        harmGain.connect(masterGain);
        oscHarm.start(startTime);
        oscHarm.stop(endTime);
      }
    });
  } catch {}
};

/**
 * Native Text-To-Speech announcement for parents and school broadcast.
 * Specially adapted for iPhone/iOS Safari so it never remains silent!
 */
export interface SpeakAnnouncementOptions {
  forceLanguage?: 'hi' | 'en';
  englishFallback?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: () => void;
}

export const speakAnnouncement = (
  customText?: string,
  options: SpeakAnnouncementOptions = {}
): void => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const voices = getAvailableVoices();
    const isIOS = isIOSDevice();

    const hiVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().startsWith('hi') ||
        v.name.toLowerCase().includes('hindi') ||
        v.name.toLowerCase().includes('lekha')
    );

    const inVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().includes('en-in') ||
        v.name.toLowerCase().includes('india') ||
        v.name.toLowerCase().includes('rishi') ||
        v.name.toLowerCase().includes('sangeeta')
    );

    const defaultVoice =
      voices.find((v) => v.default) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
      voices[0];

    let targetVoice: SpeechSynthesisVoice | undefined;
    let targetLang = 'hi-IN';
    let textToSpeak = '';

    const wantsEnglish = options.forceLanguage === 'en';
    const hasHindi = !!hiVoice;

    if (wantsEnglish || (!hasHindi && isIOS)) {
      targetVoice = inVoice || defaultVoice;
      targetLang = targetVoice ? targetVoice.lang : 'en-US';

      if (options.englishFallback) {
        textToSpeak = options.englishFallback;
      } else if (customText) {
        const cleanTitle = customText.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
        textToSpeak = `Attention please. Important school announcement from E.V.S. Public School: ${cleanTitle}`;
      } else {
        textToSpeak =
          'Attention please. Important school notice from E.V.S. Public School.';
      }
    } else {
      targetVoice = hiVoice || inVoice || defaultVoice;
      targetLang = hiVoice ? hiVoice.lang : inVoice ? inVoice.lang : 'hi-IN';
      textToSpeak =
        customText?.trim() ||
        'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से महत्वपूर्ण सूचना।';
    }

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    if (targetVoice) {
      utterance.voice = targetVoice;
    }
    utterance.lang = targetLang;

    utterance.rate = options.rate ?? (isIOS ? 0.95 : 0.92);
    utterance.pitch = options.pitch ?? 1.05;
    utterance.volume = options.volume ?? 1.0;

    window.__evs_utterances = window.__evs_utterances || [];
    window.__evs_utterances.push(utterance);

    let started = false;
    const cleanup = () => {
      if (window.__evs_utterances) {
        const idx = window.__evs_utterances.indexOf(utterance);
        if (idx > -1) {
          window.__evs_utterances.splice(idx, 1);
        }
      }
    };

    utterance.onstart = () => {
      started = true;
      if (options.onStart) options.onStart();
    };

    utterance.onend = () => {
      cleanup();
      if (started && options.onEnd) options.onEnd();
    };

    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      cleanup();
      if (options.onError) options.onError();
    };

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('Speech synthesis warning:', e);
  }
};

export const stopSpeechAnnouncement = (): void => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      if (window.__evs_utterances) {
        window.__evs_utterances.length = 0;
      }
    } catch {}
  }
};

let scannerSpeechTimer: any = null;

/**
 * Loud classroom/assembly-grade QR & Attendance scanner sound feedback.
 * Uses shared compressor-boosted AudioContext (never leaks) + clear loud voice confirmation.
 */
export const playLoudScannerSound = (
  kind: 'marked' | 'already_present' | 'unmatched',
  options?: {
    studentName?: string;
    mode?: ScannerAudioMode;
  }
): void => {
  const mode = options?.mode || 'voice_and_chime';
  if (mode === 'mute') return;

  unlockAudioContext();

  if (kind === 'marked') {
    playLoudChime(
      [
        { freq: 880, offset: 0.0, dur: 0.12, type: 'triangle', level: 0.85 },
        { freq: 1174.66, offset: 0.07, dur: 0.14, type: 'triangle', level: 0.9 },
        { freq: 1567.98, offset: 0.14, dur: 0.24, type: 'sine', level: 0.92 },
      ],
      1.15
    );
    try {
      if (navigator.vibrate) navigator.vibrate([80, 35, 80]);
    } catch {}

    if (mode === 'voice_and_chime') {
      const cleanName = String(options?.studentName || '').trim();
      const hiText = cleanName ? `${cleanName}, उपस्थित` : 'उपस्थित दर्ज';
      const enText = cleanName ? `${cleanName}, Present` : 'Marked Present';
      if (scannerSpeechTimer) clearTimeout(scannerSpeechTimer);
      scannerSpeechTimer = setTimeout(() => {
        speakAnnouncement(hiText, {
          englishFallback: enText,
          rate: 1.04,
          pitch: 1.06,
          volume: 1.0,
        });
      }, isIOSDevice() ? 140 : 210);
    }
  } else if (kind === 'already_present') {
    playLoudChime(
      [
        { freq: 659.25, offset: 0.0, dur: 0.11, type: 'triangle', level: 0.8 },
        { freq: 659.25, offset: 0.13, dur: 0.14, type: 'triangle', level: 0.8 },
      ],
      1.05
    );
    try {
      if (navigator.vibrate) navigator.vibrate([45, 30, 45]);
    } catch {}

    if (mode === 'voice_and_chime') {
      const cleanName = String(options?.studentName || '').trim();
      const hiText = cleanName ? `${cleanName}, पहले से उपस्थित` : 'पहले से उपस्थित';
      const enText = cleanName ? `${cleanName}, already present` : 'Already marked present';
      if (scannerSpeechTimer) clearTimeout(scannerSpeechTimer);
      scannerSpeechTimer = setTimeout(() => {
        speakAnnouncement(hiText, {
          englishFallback: enText,
          rate: 1.05,
          pitch: 1.0,
          volume: 1.0,
        });
      }, isIOSDevice() ? 140 : 210);
    }
  } else {
    playLoudChime(
      [
        { freq: 260, offset: 0.0, dur: 0.14, type: 'sawtooth', level: 0.72, harmonic: false },
        { freq: 195, offset: 0.13, dur: 0.22, type: 'sawtooth', level: 0.78, harmonic: false },
      ],
      1.0
    );
    try {
      if (navigator.vibrate) navigator.vibrate([180, 60, 180]);
    } catch {}

    if (mode === 'voice_and_chime') {
      if (scannerSpeechTimer) clearTimeout(scannerSpeechTimer);
      scannerSpeechTimer = setTimeout(() => {
        speakAnnouncement('अमान्य क्यूआर कोड', {
          englishFallback: 'Invalid QR code',
          rate: 1.02,
          pitch: 0.95,
          volume: 1.0,
        });
      }, isIOSDevice() ? 150 : 220);
    }
  }
};

/**
 * Plays a warm, loud, 4-tone melodious public announcement chime (Ding-Dong / Airport Chime)
 */
export const playAnnouncementChime = (): void => {
  try {
    const ctx = getAudioContext();
    const outNode = getLoudOutputNode(ctx);
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.65, now);
    masterGain.connect(outNode);
    activeChimeGain = masterGain;

    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(3600, now);
    lowPass.connect(masterGain);

    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.55 }, // C5
      { freq: 659.25, time: 0.18, dur: 0.55 }, // E5
      { freq: 783.99, time: 0.36, dur: 0.55 }, // G5
      { freq: 1046.5, time: 0.56, dur: 0.9 }, // C6
    ];

    notes.forEach((n) => {
      const startTime = now + n.time;
      const endTime = startTime + n.dur;

      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(n.freq, startTime);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(n.freq * 2, startTime);

      const osc3 = ctx.createOscillator();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(n.freq, startTime);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, startTime);
      noteGain.gain.linearRampToValueAtTime(0.38, startTime + 0.015);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.11, startTime);

      const triangleGain = ctx.createGain();
      triangleGain.gain.setValueAtTime(0.08, startTime);

      osc1.connect(noteGain);
      osc2.connect(harmonicGain);
      harmonicGain.connect(noteGain);
      osc3.connect(triangleGain);
      triangleGain.connect(noteGain);

      noteGain.connect(lowPass);

      osc1.start(startTime);
      osc2.start(startTime);
      osc3.start(startTime);

      osc1.stop(endTime);
      osc2.stop(endTime);
      osc3.stop(endTime);
    });
  } catch (err) {
    console.warn('Unable to play announcement chime:', err);
  }
};

/**
 * Start announcement alert:
 * Plays chime followed by clear voice broadcast. Supports explicit language ('hi' | 'en')
 * and invokes onCycleComplete once a full voice broadcast finishes so seen-once tracking works cleanly.
 */
export const startAnnouncementAlert = (
  noticeTitle?: string,
  includeVoice = true,
  forceLanguage?: 'hi' | 'en',
  onCycleComplete?: () => void
): (() => void) => {
  if (isPlaying) {
    stopAnnouncementAlert();
  }

  isPlaying = true;
  unlockAudioContext();

  const runAnnouncementCycle = () => {
    playAnnouncementChime();

    if (includeVoice) {
      const spokenText = noticeTitle
        ? `कृपया ध्यान दें। स्कूल आवश्यक सूचना: ${noticeTitle}`
        : 'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से महत्वपूर्ण सूचना।';
      const englishText = noticeTitle
        ? `Attention please. Important school announcement: ${noticeTitle}`
        : 'Attention please. Important announcement from EVS Public School.';

      const delayMs = isIOSDevice() ? 300 : 700;
      setTimeout(() => {
        if (isPlaying) {
          speakAnnouncement(spokenText, {
            forceLanguage,
            englishFallback: englishText,
            onEnd: () => {
              if (onCycleComplete) onCycleComplete();
            },
          });
        }
      }, delayMs);
    }
  };

  runAnnouncementCycle();

  if (announcementIntervalTimer) clearInterval(announcementIntervalTimer);
  announcementIntervalTimer = setInterval(() => {
    if (isPlaying) {
      runAnnouncementCycle();
    }
  }, 22000);

  return stopAnnouncementAlert;
};

/**
 * Stop announcement sound and voice broadcast cleanly
 */
export const stopAnnouncementAlert = (): void => {
  isPlaying = false;
  if (announcementIntervalTimer) {
    clearInterval(announcementIntervalTimer);
    announcementIntervalTimer = null;
  }

  stopSpeechAnnouncement();

  try {
    if (activeChimeGain && activeAudioCtx && activeAudioCtx.state === 'running') {
      const now = activeAudioCtx.currentTime;
      activeChimeGain.gain.setValueAtTime(activeChimeGain.gain.value, now);
      activeChimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    }
  } catch {}
};

/**
 * Play a quick one-shot announcement preview (chime + voice)
 */
export const playAnnouncementPreview = (
  title?: string,
  withVoice = true,
  preferredLanguage?: 'hi' | 'en',
  onComplete?: () => void
): void => {
  unlockAudioContext();
  playAnnouncementChime();

  if (withVoice) {
    const hindiText = title
      ? `कृपया ध्यान दें। स्कूल सूचना: ${title}`
      : 'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से आवश्यक सूचना।';
    const englishText = title
      ? `Attention please. Important school notice: ${title}`
      : 'Attention please. Important school notice from EVS Public School.';

    const delay = isIOSDevice() ? 350 : 650;
    setTimeout(() => {
      speakAnnouncement(hindiText, {
        forceLanguage: preferredLanguage,
        englishFallback: englishText,
        onEnd: onComplete,
      });
    }, delay);
  }
};

// Persistent Seen-Once Helpers for Suchna Announcements (localStorage across reloads/sessions)
export interface AnnouncementNoticeRef {
  id?: string | number;
  title?: string;
  date?: string;
  description?: string;
}

export const getAnnouncementSignature = (notice: AnnouncementNoticeRef | null | undefined): string => {
  if (!notice) return '';
  const idPart = String(notice.id ?? '').trim();
  const titlePart = String(notice.title ?? '').trim();
  const datePart = String(notice.date ?? '').trim();
  const descPart = String(notice.description ?? '').trim().slice(0, 80);
  return `${idPart}::${titlePart}::${datePart}::${descPart}`;
};

const readSeenMap = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EVS_SEEN_ANNOUNCEMENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {}
  return {};
};

export const isAnnouncementSeen = (notice: AnnouncementNoticeRef | null | undefined): boolean => {
  if (!notice || !notice.id) return false;
  const key = String(notice.id).trim();
  const sig = getAnnouncementSignature(notice);
  const map = readSeenMap();
  return Boolean(map[key] && map[key] === sig);
};

export const markAnnouncementSeen = (
  notice: AnnouncementNoticeRef | null | undefined,
  options?: { dispatchEvent?: boolean }
): void => {
  if (typeof window === 'undefined' || !notice || !notice.id) return;
  const key = String(notice.id).trim();
  const sig = getAnnouncementSignature(notice);
  try {
    const map = readSeenMap();
    map[key] = sig;
    // Keep only last 60 seen notices to avoid bloating localStorage
    const keys = Object.keys(map);
    if (keys.length > 60) {
      keys.slice(0, keys.length - 60).forEach((oldKey) => {
        delete map[oldKey];
      });
    }
    localStorage.setItem(EVS_SEEN_ANNOUNCEMENTS_KEY, JSON.stringify(map));
  } catch {}

  if (options?.dispatchEvent !== false) {
    try {
      window.dispatchEvent(
        new CustomEvent(EVS_ANNOUNCEMENT_SEEN_EVENT, { detail: { id: key, sig } })
      );
    } catch {}
  }
};

// Aliases for full backwards-compatibility
export const startEmergencySiren = (
  noticeTitle?: string,
  includeVoice = true,
  forceLanguage?: 'hi' | 'en',
  onCycleComplete?: () => void
): (() => void) => startAnnouncementAlert(noticeTitle, includeVoice, forceLanguage, onCycleComplete);

export const stopEmergencySiren = (): void => stopAnnouncementAlert();

export const playEmergencyChime = (): void =>
  playAnnouncementPreview(undefined, false);

export const playSirenPreview = (_durationSeconds = 4): void =>
  playAnnouncementPreview(undefined, true);

export const isEmergencySirenPlaying = (): boolean => isPlaying;
export const isAnnouncementPlaying = (): boolean => isPlaying;
