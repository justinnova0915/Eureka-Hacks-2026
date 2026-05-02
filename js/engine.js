// Tone.js audio engine – loads SoundFont samplers + built-in synths.

const SF_BASE = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite';

export const INST_CONFIG = {
  guitar: {
    name: 'Guitar', emoji: '', color: '#f59e0b',
    urls: { E2:'E2.mp3', A2:'A2.mp3', D3:'D3.mp3', G3:'G3.mp3',
            B3:'B3.mp3', E4:'E4.mp3', A4:'A4.mp3', D5:'D5.mp3' },
    base: `${SF_BASE}/acoustic_guitar_nylon-mp3/`,
  },
  piano: {
    name: 'Piano', emoji: '', color: '#3b82f6',
    urls: { A2:'A2.mp3', C3:'C3.mp3', E3:'E3.mp3', G3:'G3.mp3',
            A3:'A3.mp3', C4:'C4.mp3', E4:'E4.mp3', G4:'G4.mp3',
            A4:'A4.mp3', C5:'C5.mp3' },
    base: `${SF_BASE}/acoustic_grand_piano-mp3/`,
  },
  flute: {
    name: 'Flute', emoji: '', color: '#10b981',
    urls: { C4:'C4.mp3', E4:'E4.mp3', G4:'G4.mp3', A4:'A4.mp3',
            C5:'C5.mp3', E5:'E5.mp3', G5:'G5.mp3' },
    base: `${SF_BASE}/flute-mp3/`,
  },
  drums: { name: 'Drums', emoji: '', color: '#ef4444', urls: null },
  synth: { name: 'Synth', emoji: '', color: '#8b5cf6', urls: null },
};

export class InstrumentEngine {
  constructor() {
    this.current   = 'guitar';
    this.samplers  = {};
    this.builtins  = {};
    this.midiLog   = [];   // [{note, velocity, time, instrument}]
    this._recorder = null;
  }

  async init(onProgress) {
    // Effects chain: light reverb only (no delay = lower latency)
    this._vol   = new Tone.Volume(-2).toDestination();
    this._reverb= new Tone.Reverb({ decay: 1.0, wet: 0.08 }).connect(this._vol);

    // Built-in synths (instant, no loading) – faster attack for responsiveness
    this.builtins.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth4' },
      envelope: { attack: 0.008, decay: 0.35, sustain: 0.25, release: 0.6 },
      maxNotes: 12,
    }).connect(this._reverb);

    this.builtins.kick = new Tone.MembraneSynth({
      pitchDecay: 0.05, octaves: 9,
      envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.08 },
    }).connect(this._vol);

    this.builtins.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 },
    }).connect(this._vol);

    this.builtins.hihat = new Tone.MetalSynth({
      frequency: 550, envelope: { attack: 0.001, decay: 0.08, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 32, resonance: 4000,
    }).connect(this._vol);

    // Load SoundFont samplers
    const sfInsts = ['guitar', 'piano', 'flute'];
    let loaded = 0;

    for (const name of sfInsts) {
      const cfg = INST_CONFIG[name];
      this.samplers[name] = new Tone.Sampler({
        urls: cfg.urls,
        baseUrl: cfg.base,
        onload: () => { loaded++; onProgress?.(Math.round((loaded / sfInsts.length) * 90)); },
        onerror: () => {
          // Fallback: use PolySynth if sampler fails
          this.samplers[name] = null;
          loaded++;
          onProgress?.(Math.round((loaded / sfInsts.length) * 90));
        },
      }).connect(this._reverb);
    }

    await Tone.loaded().catch(() => {});
    onProgress?.(100);
  }

  setInstrument(name) { this.current = name; }

  playNote(midiNote, velocity = 100, delayMs = 0, durationMs = 380) {
    if (Tone.context.state !== 'running') return;

    const freq     = Tone.Frequency(midiNote, 'midi');
    const noteName = freq.toNote();
    const normVel  = Math.max(0.01, velocity / 127);
    // Use Tone.immediate for zero-latency scheduling
    const t        = delayMs === 0 ? Tone.immediate : `+${(delayMs / 1000).toFixed(3)}`;
    const dur      = `${(durationMs / 1000).toFixed(3)}`;

    // Log for AI continuation
    this.midiLog.push({ note: midiNote, velocity, time: Tone.now() + delayMs / 1000,
                        instrument: this.current });
    if (this.midiLog.length > 300) this.midiLog.shift();

    try {
      switch (this.current) {
        case 'synth':
          this.builtins.synth.triggerAttackRelease(noteName, dur, t, normVel);
          break;

        case 'drums':
          this._playDrum(midiNote, normVel, t);
          break;

        default: {
          const s = this.samplers[this.current];
          if (s) {
            s.triggerAttackRelease(noteName, dur, t, normVel);
          } else {
            // Sampler didn't load – fall back to built-in synth
            this.builtins.synth.triggerAttackRelease(noteName, dur, t, normVel);
          }
          break;
        }
      }
    } catch (e) {
      // Swallow scheduling errors (note out of range, etc.)
    }
  }

  _playDrum(midiNote, normVel, t) {
    // GM drum mapping
    if (midiNote === 36 || midiNote === 35) {
      this.builtins.kick.triggerAttackRelease(
        Tone.Frequency(midiNote, 'midi').toFrequency(), '8n', t, normVel);
    } else if (midiNote === 38 || midiNote === 40) {
      this.builtins.snare.triggerAttackRelease('16n', t, normVel);
    } else {
      this.builtins.hihat.triggerAttackRelease(
        Tone.Frequency(midiNote, 'midi').toFrequency(), '32n', t, normVel);
    }
  }

  getMidiLog()   { return [...this.midiLog]; }
  clearMidiLog() { this.midiLog = []; }

  // Audio recording via Tone.Recorder
  async startRecording() {
    this._recorder = new Tone.Recorder();
    this._vol.connect(this._recorder);
    await this._recorder.start();
  }

  async stopRecording() {
    if (!this._recorder) return null;
    const blob = await this._recorder.stop();
    this._vol.disconnect(this._recorder);
    this._recorder.dispose();
    this._recorder = null;
    return blob;
  }
}
