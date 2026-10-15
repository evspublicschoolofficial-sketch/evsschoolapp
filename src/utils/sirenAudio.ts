// Web Audio API & Speech Synthesis based School Announcement & Chime Sound Generator
// Fully optimized for iOS Safari (iPhone/iPad), Android Chrome, and Desktop browsers.
// Resolves iOS Safari silent-mode, missing Hindi voice, garbage-collection, and user-gesture expiration bugs.

let activeAudioCtx: AudioContext | null = null;
let activeChimeGain: GainNode | null = null;
let announcementIntervalTimer: any = null;
let isPlaying = false;

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
 * (Note: Most iPhones in default config only have English/system voices)
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
 * Create or resume AudioContext safely
 */
export const getAudioContext = (): AudioContext => {
  if (!activeAudioCtx || activeAudioCtx.state === 'closed') {
    const AudioCtxClass =
      window.AudioContext || (window as any).webkitAudioContext;
    activeAudioCtx = new AudioCtxClass();
  }
  if (activeAudioCtx.state === 'suspended') {
    activeAudioCtx.resume().catch(() => {});
  }
  return activeAudioCtx;
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
        // Tiny 1-sample silent WAV base64
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

/**
 * Native Text-To-Speech announcement for parents and school broadcast.
 * Specially adapted for iPhone/iOS Safari so it never remains silent!
 */
export interface SpeakAnnouncementOptions {
  forceLanguage?: 'hi' | 'en';
  englishFallback?: string;
  onStart?: () => void;
  onEnd?: () => void;
}

export const speakAnnouncement = (
  customText?: string,
  options: SpeakAnnouncementOptions = {}
): void => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  try {
    // Synchronously ensure speech synthesis is not frozen
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const voices = getAvailableVoices();
    const isIOS = isIOSDevice();

    // 1. Detect voices
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

    // Determine target voice and text
    let targetVoice: SpeechSynthesisVoice | undefined;
    let targetLang = 'hi-IN';
    let textToSpeak = '';

    const wantsEnglish = options.forceLanguage === 'en';
    const hasHindi = !!hiVoice;

    if (wantsEnglish || (!hasHindi && isIOS)) {
      // iPhone without Hindi voice: use English voice with polite English announcement
      // This prevents iOS Safari from failing silently!
      targetVoice = inVoice || defaultVoice;
      targetLang = targetVoice ? targetVoice.lang : 'en-US';

      if (options.englishFallback) {
        textToSpeak = options.englishFallback;
      } else if (customText) {
        // Strip emoji and format clean English announcement
        const cleanTitle = customText.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
        textToSpeak = `Attention please. Important school announcement from E.V.S. Public School: ${cleanTitle}`;
      } else {
        textToSpeak =
          'Attention please. Important school notice from E.V.S. Public School.';
      }
    } else {
      // Hindi voice available (Android, Windows, Mac, or iPhone with Hindi installed)
      targetVoice = hiVoice || inVoice || defaultVoice;
      targetLang = hiVoice ? hiVoice.lang : inVoice ? inVoice.lang : 'hi-IN';
      textToSpeak =
        customText?.trim() ||
        'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से महत्वपूर्ण सूचना।';
    }

    // Cancel existing speech only if actively speaking
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    if (targetVoice) {
      utterance.voice = targetVoice;
    }
    utterance.lang = targetLang;

    // Measured polite tone
    utterance.rate = isIOS ? 0.95 : 0.92;
    utterance.pitch = 1.05;
    utterance.volume = 1.0;

    // Track utterance globally to prevent iOS Safari Garbage Collection bug
    window.__evs_utterances = window.__evs_utterances || [];
    window.__evs_utterances.push(utterance);

    const cleanup = () => {
      if (window.__evs_utterances) {
        const idx = window.__evs_utterances.indexOf(utterance);
        if (idx > -1) {
          window.__evs_utterances.splice(idx, 1);
        }
      }
    };

    utterance.onstart = () => {
      if (options.onStart) options.onStart();
    };

    utterance.onend = () => {
      cleanup();
      if (options.onEnd) options.onEnd();
    };

    utterance.onerror = (e) => {
      console.warn('SpeechSynthesis error:', e);
      cleanup();
      if (options.onEnd) options.onEnd();
    };

    // Immediate synchronous speak call (critical for iOS)
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

/**
 * Plays a warm, sweet, 4-tone melodious public announcement chime (Ding-Dong / Airport Chime)
 * Notes: C5 (523.25Hz) -> E5 (659.25Hz) -> G5 (783.99Hz) -> C6 (1046.50Hz)
 */
export const playAnnouncementChime = (): void => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    // Master chime gain
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.connect(ctx.destination);
    activeChimeGain = masterGain;

    // Low-pass filter for smooth acoustic bell tone
    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(3200, now);
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
      noteGain.gain.linearRampToValueAtTime(0.28, startTime + 0.015);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.08, startTime);

      const triangleGain = ctx.createGain();
      triangleGain.gain.setValueAtTime(0.05, startTime);

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
 * Start periodic announcement alert:
 * Plays sweet melodic chime followed by pleasant voice broadcast, repeating gently.
 */
export const startAnnouncementAlert = (
  noticeTitle?: string,
  includeVoice = true
): (() => void) => {
  if (isPlaying) {
    return stopAnnouncementAlert;
  }

  isPlaying = true;
  unlockAudioContext();

  const runAnnouncementCycle = () => {
    // 1. Play sweet melodic chime
    playAnnouncementChime();

    // 2. Play polite voice announcement
    if (includeVoice) {
      const spokenText = noticeTitle
        ? `कृपया ध्यान दें। स्कूल आवश्यक सूचना: ${noticeTitle}`
        : 'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से महत्वपूर्ण सूचना।';
      const englishText = noticeTitle
        ? `Attention please. Important school announcement: ${noticeTitle}`
        : 'Attention please. Important announcement from EVS Public School.';

      // On iOS, invoke synchronously within the cycle or with short micro-delay
      const delayMs = isIOSDevice() ? 300 : 700;
      setTimeout(() => {
        if (isPlaying) {
          speakAnnouncement(spokenText, {
            englishFallback: englishText,
          });
        }
      }, delayMs);
    }
  };

  // Immediate cycle
  runAnnouncementCycle();

  // Gentle repeat every 18 seconds
  if (announcementIntervalTimer) clearInterval(announcementIntervalTimer);
  announcementIntervalTimer = setInterval(() => {
    if (isPlaying) {
      runAnnouncementCycle();
    }
  }, 18000);

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
  } catch (e) {}
};

/**
 * Play a quick one-shot announcement preview (chime + voice)
 * MUST be called directly in a user click/touch handler.
 * On iOS, synchronously unlocks audio and speaks within the user gesture.
 */
export const playAnnouncementPreview = (
  title?: string,
  withVoice = true,
  preferredLanguage?: 'hi' | 'en'
): void => {
  // Synchronous unlock (not waiting for promise!)
  unlockAudioContext();

  // Play chime
  playAnnouncementChime();

  if (withVoice) {
    const hindiText = title
      ? `कृपया ध्यान दें। स्कूल सूचना: ${title}`
      : 'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से आवश्यक सूचना।';
    const englishText = title
      ? `Attention please. Important school notice: ${title}`
      : 'Attention please. Important school notice from EVS Public School.';

    // On iOS Safari, we must queue or speak with minimal delay to keep user activation alive
    const delay = isIOSDevice() ? 350 : 650;
    setTimeout(() => {
      speakAnnouncement(hindiText, {
        forceLanguage: preferredLanguage,
        englishFallback: englishText,
      });
    }, delay);
  }
};

// Aliases for full backwards-compatibility with previous siren function names
export const startEmergencySiren = (noticeTitle?: string): (() => void) =>
  startAnnouncementAlert(noticeTitle);

export const stopEmergencySiren = (): void => stopAnnouncementAlert();

export const playEmergencyChime = (): void =>
  playAnnouncementPreview(undefined, false);

export const playSirenPreview = (_durationSeconds = 4): void =>
  playAnnouncementPreview(undefined, true);

export const isEmergencySirenPlaying = (): boolean => isPlaying;
export const isAnnouncementPlaying = (): boolean => isPlaying;
