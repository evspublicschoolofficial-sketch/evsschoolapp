// Web Audio API based Emergency Siren Sound Generator
// Generates realistic dual-tone emergency police/ambulance siren and alert chime without any external audio file dependency

let activeAudioCtx: AudioContext | null = null;
let sirenOscillator: OscillatorNode | null = null;
let sirenHarmonicOsc: OscillatorNode | null = null;
let sirenGainNode: GainNode | null = null;
let sirenLfo: OscillatorNode | null = null;
let sirenLfoGain: GainNode | null = null;
let sirenHarmonicLfoGain: GainNode | null = null;
let isPlaying = false;
let autoStopTimer: any = null;

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
 * Start continuous emergency siren sound (dual-tone urgent oscillating siren)
 */
export const startEmergencySiren = (): (() => void) => {
  try {
    if (isPlaying) {
      return stopEmergencySiren;
    }

    const ctx = getAudioContext();

    // 1. Primary Wailing Oscillator (Sawtooth: 600Hz - 1100Hz)
    sirenOscillator = ctx.createOscillator();
    sirenOscillator.type = 'sawtooth';
    sirenOscillator.frequency.value = 850; // Center frequency

    // 2. Secondary Harmonic Oscillator (Square tone an octave/fifth higher for piercing urgency)
    sirenHarmonicOsc = ctx.createOscillator();
    sirenHarmonicOsc.type = 'triangle';
    sirenHarmonicOsc.frequency.value = 1275; // 1.5x harmonic

    // 3. LFO (Low Frequency Oscillator) to modulate pitch up and down (1.3Hz cycles)
    sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 1.3; // 1.3 wails per second

    sirenLfoGain = ctx.createGain();
    sirenLfoGain.gain.value = 280; // +/- 280 Hz range (570Hz to 1130Hz)

    sirenHarmonicLfoGain = ctx.createGain();
    sirenHarmonicLfoGain.gain.value = 420; // 1.5x depth

    // Connect LFO modulation to frequencies
    sirenLfo.connect(sirenLfoGain);
    sirenLfoGain.connect(sirenOscillator.frequency);

    sirenLfo.connect(sirenHarmonicLfoGain);
    sirenHarmonicLfoGain.connect(sirenHarmonicOsc.frequency);

    // 4. Volume Output Gain with smooth attack
    sirenGainNode = ctx.createGain();
    const now = ctx.currentTime;
    sirenGainNode.gain.setValueAtTime(0.001, now);
    sirenGainNode.gain.exponentialRampToValueAtTime(0.4, now + 0.25);

    // Sub-mix harmonic slightly quieter than main
    const harmonicGain = ctx.createGain();
    harmonicGain.gain.value = 0.35;
    sirenHarmonicOsc.connect(harmonicGain);
    harmonicGain.connect(sirenGainNode);

    // Main osc to gain
    sirenOscillator.connect(sirenGainNode);
    sirenGainNode.connect(ctx.destination);

    // Start all nodes
    sirenLfo.start(now);
    sirenOscillator.start(now);
    sirenHarmonicOsc.start(now);

    isPlaying = true;
  } catch (err) {
    console.warn('Unable to start siren audio context:', err);
  }

  return stopEmergencySiren;
};

/**
 * Stop emergency siren sound with smooth release
 */
export const stopEmergencySiren = (): void => {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }

  try {
    if (sirenGainNode && activeAudioCtx && activeAudioCtx.state === 'running') {
      const now = activeAudioCtx.currentTime;
      sirenGainNode.gain.setValueAtTime(sirenGainNode.gain.value, now);
      sirenGainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    }

    setTimeout(() => {
      try {
        if (sirenOscillator) {
          sirenOscillator.stop();
          sirenOscillator.disconnect();
          sirenOscillator = null;
        }
        if (sirenHarmonicOsc) {
          sirenHarmonicOsc.stop();
          sirenHarmonicOsc.disconnect();
          sirenHarmonicOsc = null;
        }
        if (sirenLfo) {
          sirenLfo.stop();
          sirenLfo.disconnect();
          sirenLfo = null;
        }
        if (sirenLfoGain) {
          sirenLfoGain.disconnect();
          sirenLfoGain = null;
        }
        if (sirenHarmonicLfoGain) {
          sirenHarmonicLfoGain.disconnect();
          sirenHarmonicLfoGain = null;
        }
        if (sirenGainNode) {
          sirenGainNode.disconnect();
          sirenGainNode = null;
        }
      } catch (e) {}
      isPlaying = false;
    }, 220);
  } catch (e) {
    isPlaying = false;
  }
};

/**
 * Play a quick 3-beep emergency alert chime (useful for previewing or testing)
 */
export const playEmergencyChime = (): void => {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const beep = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    // 3 urgent piercing beeps
    beep(880, now, 0.14);
    beep(1046, now + 0.16, 0.14);
    beep(1318, now + 0.32, 0.28);
  } catch (err) {
    console.warn('Unable to play emergency chime:', err);
  }
};

/**
 * Play siren preview for given duration in seconds (defaults to 4 seconds)
 */
export const playSirenPreview = (durationSeconds = 4): void => {
  startEmergencySiren();
  if (autoStopTimer) clearTimeout(autoStopTimer);
  autoStopTimer = setTimeout(() => {
    stopEmergencySiren();
  }, durationSeconds * 1000);
};

export const isEmergencySirenPlaying = (): boolean => isPlaying;
