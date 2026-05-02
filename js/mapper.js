// Maps gesture events to MIDI note arrays.
// Gestures carry {type, x, y, velocity, direction?, dx?}

export const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  blues:      [0, 3, 5, 6, 7, 10],
};

// Drum MIDI map: screen x-position (0–7) → GM drum note
const DRUM_MAP = [36, 38, 42, 46, 45, 48, 49, 51];
//                kick snare hh-c hh-o lo-t mid-t crash ride

export class NoteMapper {
  constructor() {
    this.scaleName = 'pentatonic';
    this.rootMidi  = 60;   // C4
    this.octaves   = 2;
    this._lastNote = null;
  }

  setScale(name)  { this.scaleName = name; }
  setRoot(midi)   { this.rootMidi  = parseInt(midi, 10); }

  // Map x ∈ [0,1] to a MIDI note number
  xToNote(x, isDrum = false) {
    if (isDrum) {
      return DRUM_MAP[Math.min(7, Math.floor(x * 8))];
    }
    const intervals = SCALES[this.scaleName];
    const total     = intervals.length * this.octaves;
    const idx       = Math.min(total - 1, Math.floor(x * total));
    const octave    = Math.floor(idx / intervals.length);
    const pos       = idx % intervals.length;
    return this.rootMidi + octave * 12 + intervals[pos];
  }

  // Velocity float [0,1] → MIDI int [45,127]
  velToMidi(v) { return Math.round(45 + v * 82); }

  // Returns [{note, velocity, delay}] for a gesture
  gestureToMidi(gesture, isDrum = false) {
    const { type, x, y, velocity = 0.7 } = gesture;
    const mVel = this.velToMidi(velocity);
    const note = this.xToNote(x, isDrum);

    switch (type) {
      case 'tap':
      case 'pluck':
        this._lastNote = note;
        return [{ note, velocity: mVel, delay: 0 }];

      case 'strum': {
        if (isDrum) return [{ note, velocity: mVel, delay: 0 }];
        // Quick arpeggio of 4 notes around current position
        const ints  = SCALES[this.scaleName];
        const total = ints.length * this.octaves;
        const base  = Math.min(total - 4, Math.max(0, Math.floor(x * total)));
        const notes = [0, 1, 2, 3].map(i => {
          const idx = (base + i * 2) % (ints.length * this.octaves);
          const oct = Math.floor(idx / ints.length);
          const pos = idx % ints.length;
          return this.rootMidi + oct * 12 + ints[pos];
        });
        if (gesture.direction === 'left') notes.reverse();
        return notes.map((n, i) => ({
          note: n, velocity: Math.max(40, mVel - i * 10), delay: i * 45
        }));
      }

      case 'airpress':
        this._lastNote = note;
        return [{ note, velocity: mVel, delay: 0 }];

      case 'slide': {
        if (note === this._lastNote) return [];
        this._lastNote = note;
        return [{ note, velocity: 62, delay: 0 }];
      }

      default:
        return [];
    }
  }
}
