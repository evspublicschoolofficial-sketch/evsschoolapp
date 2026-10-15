// Web Audio API based School Announcement & Chime Sound Generator
// Replaces harsh emergency siren with a pleasant, melodious airport/school PA announcement chime and voice notification

let activeAudioCtx: AudioContext | null = null;
let activeChimeGain: GainNode | null = null;
let announcementIntervalTimer: any = null;
let isPlaying = false;

// Create or resume AudioContext safely
export const getAudioContext = (): AudioContext => {
  if (!activeAudioCtx || activeAudioCtx.state === 'closed') {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    activeAudioCtx = new AudioCtxClass();
  }
  if (activeAudioCtx.state === 'suspended') {
    activeAudioCtx.resume().catch(() => {});
  }
  return activeAudioCtx;
};

export const unlockAudioContext = async (): Promise<boolean> => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state === 'running';
  } catch {
    return false;
  }
};

/**
 * Native Text-To-Speech announcement for parents
 * Speaks a courteous Hindi / English school broadcast
 */
export const speakAnnouncement = (customText?: string): void => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();

    const textToSpeak =
      customText?.trim() ||
      'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से महत्वपूर्ण सूचना।';

    const utterance = new SpeechSynthesisUtterance(textToSpeak);

    // Pick Hindi or Indian English voice if available
    const voices = window.speechSynthesis.getVoices();
    const hiVoice = voices.find(
      (v) =>
        v.lang.toLowerCase().includes('hi-in') ||
        v.lang.toLowerCase().includes('hi')
    );
    const inVoice = voices.find((v) =>
      v.lang.toLowerCase().includes('en-in')
    );

    if (hiVoice) {
      utterance.voice = hiVoice;
      utterance.lang = hiVoice.lang;
    } else if (inVoice) {
      utterance.voice = inVoice;
      utterance.lang = inVoice.lang;
    } else {
      utterance.lang = 'hi-IN';
    }

    utterance.rate = 0.92; // Slightly calm and measured pace
    utterance.pitch = 1.05; // Polite, friendly tone
    utterance.volume = 0.95;

    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('Speech synthesis warning:', e);
  }
};

export const stopSpeechAnnouncement = (): void => {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
};

/**
 * Plays a warm, sweet, 4-tone melodious public announcement chime (Ding-Dong / Airport Chime)
 * Notes: C5 (523.25Hz) -> E5 (659.25Hz) -> G5 (783.99Hz) -> C6 (1046.50Hz)
 * Uses harmonic synthesis + low-pass filter for a smooth, warm acoustic resonance.
 */
export const playAnnouncementChime = (): void => {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // Master chime gain
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.connect(ctx.destination);
    activeChimeGain = masterGain;

    // Filter to eliminate any harsh high frequencies
    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(3200, now);
    lowPass.connect(masterGain);

    // 4 Melodic Chime Notes (PA system / Airport Chime)
    const notes = [
      { freq: 523.25, time: 0.0, dur: 0.65 }, // C5
      { freq: 659.25, time: 0.22, dur: 0.65 }, // E5
      { freq: 783.99, time: 0.44, dur: 0.65 }, // G5
      { freq: 1046.5, time: 0.68, dur: 1.1 }, // C6
    ];

    notes.forEach((n) => {
      const startTime = now + n.time;
      const endTime = startTime + n.dur;

      // 1. Fundamental tone (sine)
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(n.freq, startTime);

      // 2. Harmonic overtone (2nd harmonic) for bell-like chime warmth
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(n.freq * 2, startTime);

      // 3. Subtle triangle wave for body
      const osc3 = ctx.createOscillator();
      osc3.type = 'triangle';
      osc3.frequency.setValueAtTime(n.freq, startTime);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0.0001, startTime);
      // Soft fast attack (no clicking)
      noteGain.gain.linearRampToValueAtTime(0.3, startTime + 0.015);
      // Gentle exponential decay
      noteGain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.08, startTime);

      const triangleGain = ctx.createGain();
      triangleGain.gain.setValueAtTime(0.06, startTime);

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
 * Plays sweet melodic chime followed by pleasant voice broadcast, repeating gently every 16 seconds.
 */
export const startAnnouncementAlert = (
  noticeTitle?: string,
  includeVoice = true
): (() => void) => {
  if (isPlaying) {
    return stopAnnouncementAlert;
  }

  isPlaying = true;

  const runAnnouncementCycle = () => {
    // 1. Play sweet melodic chime
    playAnnouncementChime();

    // 2. Play polite voice announcement after chime ends
    if (includeVoice) {
      setTimeout(() => {
        if (isPlaying) {
          const spokenText = noticeTitle
            ? `कृपया ध्यान दें। स्कूल आवश्यक सूचना: ${noticeTitle}`
            : 'कृपया ध्यान दें, ई.वी.एस. पब्लिक स्कूल की ओर से महत्वपूर्ण सूचना।';
          speakAnnouncement(spokenText);
        }
      }, 1100);
    }
  };

  // Immediate cycle
  runAnnouncementCycle();

  // Gentle repeat every 16 seconds (comfortable, not annoying like a wailing siren)
  if (announcementIntervalTimer) clearInterval(announcementIntervalTimer);
  announcementIntervalTimer = setInterval(() => {
    if (isPlaying) {
      runAnnouncementCycle();
    }
  }, 16000);

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
 * Play a quick one-shot announcement preview (chime + optional voice)
 */
export const playAnnouncementPreview = (
  title?: string,
  withVoice = true
): void => {
  unlockAudioContext().then(() => {
    playAnnouncementChime();
    if (withVoice) {
      setTimeout(() => {
        const text = title
          ? `कृपया ध्यान दें। स्कूल सूचना: ${title}`
          : 'कृपया ध्यान दें, स्कूल की ओर से आवश्यक सूचना।';
        speakAnnouncement(text);
      }, 1100);
    }
  });
};

// Aliases for full backwards-compatibility with previous siren function names
export const startEmergencySiren = (noticeTitle?: string): (() => void) =>
  startAnnouncementAlert(noticeTitle);

export const stopEmergencySiren = (): void =>
  stopAnnouncementAlert();

export const playEmergencyChime = (): void =>
  playAnnouncementPreview(undefined, false);

export const playSirenPreview = (_durationSeconds = 4): void =>
  playAnnouncementPreview(undefined, true);

export const isEmergencySirenPlaying = (): boolean => isPlaying;
export const isAnnouncementPlaying = (): boolean => isPlaying;
