import { InstrumentEngine, INST_CONFIG } from './engine.js';
import { GestureDetector }               from './gesture.js';
import { NoteMapper }                    from './mapper.js';
import { ObjectDetector }                from './objectdetector.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const loadingScreen  = document.getElementById('loading-screen');
const loadingStatus  = document.getElementById('loading-status');
const progressFill   = document.getElementById('progress-fill');
const appEl          = document.getElementById('app');
const instBtns       = document.querySelectorAll('.inst-btn');
const instEmoji      = document.getElementById('inst-emoji');
const instName       = document.getElementById('inst-name');
const gestureLabel   = document.getElementById('gesture-label');
const aiBadge        = document.getElementById('ai-badge');
const scaleSelect    = document.getElementById('scale-select');
const rootSelect     = document.getElementById('root-select');
const aiBtn          = document.getElementById('ai-btn');
const recordBtn      = document.getElementById('record-btn');
const autoBtn        = document.getElementById('auto-btn');
const scaleLabel     = document.getElementById('scale-label');
const vizCanvas      = document.getElementById('visualizer');
const webcamEl       = document.getElementById('webcam');
const overlayEl      = document.getElementById('overlay');

// ── Core objects ──────────────────────────────────────────────────────────────
const engine      = new InstrumentEngine();
const mapper      = new NoteMapper();
const objDetector = new ObjectDetector();
let detector      = null;

// ── State ─────────────────────────────────────────────────────────────────────
let aiActive    = false;
let aiTimer     = null;
let autoMode    = false;
let isRecording = false;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  loadingStatus.textContent = 'Loading instruments…';

  await engine.init(pct => {
    progressFill.style.width = pct + '%';
    if (pct < 50)  loadingStatus.textContent = 'Loading instruments…';
    else           loadingStatus.textContent = 'Almost ready…';
  });

  loadingStatus.textContent = 'Loading object detection model…';
  try {
    await objDetector.init();
  } catch (e) {
    console.warn('Object detection unavailable:', e);
  }

  loadingStatus.textContent = 'Starting camera…';

  detector = new GestureDetector(webcamEl, overlayEl);
  detector.addEventListener('gesture', onGesture);
  detector.addEventListener('idle',    onIdle);

  try {
    await detector.start();
    objDetector.start(webcamEl);
  } catch (e) {
    loadingStatus.textContent = 'Camera unavailable – click to start audio only';
  }

  loadingScreen.style.opacity = '0';
  setTimeout(() => { loadingScreen.style.display = 'none'; appEl.classList.remove('hidden'); }, 420);

  initViz();
  updateScaleLabel();
  updateObjectBadge();
}

// ── Object detection badge ────────────────────────────────────────────────────
const camHint = document.getElementById('cam-hint');
function updateObjectBadge() {
  const label   = objDetector.getLabel();
  const lm      = detector?.history.at(-1)?.landmarks;
  const pose    = lm ? detector.getPose(lm) : null;
  const holding = pose && pose !== 'open' && pose !== 'spread' && pose !== 'unknown';

  if (label) {
    camHint.textContent = `🎵 ${label} detected — play!`;
    camHint.style.color = '#06b6d4';
  } else if (holding) {
    camHint.textContent = `✊ Grip detected (${pose}) — play!`;
    camHint.style.color = '#10b981';
  } else {
    camHint.textContent = 'Pick up any object to play';
    camHint.style.color = '';
  }
  requestAnimationFrame(updateObjectBadge);
}

// Returns true if sound should be allowed given current detection state
function canPlay(gesture) {
  // Primary: COCO-SSD found a known object near the hand
  if (objDetector.isObjectPresent() && objDetector.isHandNear(gesture.x, gesture.y)) return true;
  // Fallback: hand is in a gripping/holding pose (handles cans, pens, etc.)
  const lm   = detector?.history.at(-1)?.landmarks;
  const pose = lm ? detector.getPose(lm) : 'unknown';
  return pose !== 'open' && pose !== 'spread' && pose !== 'unknown';
}

// ── Gesture handler ───────────────────────────────────────────────────────────
function onGesture(e) {
  const gesture = e.detail;
  const isDrum  = engine.current === 'drums';

  if (Tone.context.state !== 'running') return;
  if (!canPlay(gesture))                return;

  gestureLabel.textContent = gesture.type;

  const notes = mapper.gestureToMidi(gesture, isDrum);
  notes.forEach(({ note, velocity, delay }) => {
    engine.playNote(note, velocity, delay);
  });

  if (autoMode) maybeAutoSwitch(gesture);
}

function onIdle() {
  gestureLabel.textContent = 'Ready';
}

// ── Auto instrument switch ────────────────────────────────────────────────────
function maybeAutoSwitch(gesture) {
  const pose = detector.getPose(detector.history.at(-1)?.landmarks);
  const map  = { fist: 'drums', open: 'piano', pinch: 'guitar', peace: 'flute', spread: 'synth' };
  const next = map[pose];
  if (next && next !== engine.current) switchInstrument(next);
}

// ── Instrument switching ──────────────────────────────────────────────────────
function switchInstrument(name) {
  engine.setInstrument(name);
  const cfg = INST_CONFIG[name];
  instEmoji.textContent = cfg.emoji;
  instName.textContent  = cfg.name + ' Mode';
  instBtns.forEach(b => b.classList.toggle('active', b.dataset.inst === name));
}

instBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    if (Tone.context.state !== 'running') await Tone.start();
    switchInstrument(btn.dataset.inst);
  });
});

// ── Scale / root selects ──────────────────────────────────────────────────────
scaleSelect.addEventListener('change', () => {
  mapper.setScale(scaleSelect.value);
  updateScaleLabel();
});
rootSelect.addEventListener('change', () => {
  mapper.setRoot(rootSelect.value);
  updateScaleLabel();
});
function updateScaleLabel() {
  const rootName = rootSelect.options[rootSelect.selectedIndex].text;
  scaleLabel.textContent = `${rootName} ${scaleSelect.value}`;
}

// ── AI Takeover ───────────────────────────────────────────────────────────────
aiBtn.addEventListener('click', async () => {
  if (Tone.context.state !== 'running') await Tone.start();
  aiActive = !aiActive;
  aiBtn.classList.toggle('active', aiActive);
  aiBadge.classList.toggle('hidden', !aiActive);
  if (aiActive) scheduleAiNote();
  else          clearTimeout(aiTimer);
});

function scheduleAiNote() {
  if (!aiActive) return;
  const log = engine.getMidiLog();
  let note, velocity;

  if (log.length >= 4) {
    // Replay a note from recent history with slight variation
    const src = log[Math.floor(Math.random() * log.length)];
    note     = src.note + [-2, -1, 0, 1, 2][Math.floor(Math.random() * 5)];
    velocity = Math.max(40, Math.min(127, src.velocity + Math.round((Math.random() - 0.5) * 20)));
  } else {
    note     = mapper.xToNote(Math.random(), engine.current === 'drums');
    velocity = 70 + Math.round(Math.random() * 40);
  }

  engine.playNote(note, velocity, 0, 350);

  const bpm   = 120;
  const beat  = 60000 / bpm;
  const delay = beat * [0.5, 1, 1, 1.5, 2][Math.floor(Math.random() * 5)];
  aiTimer = setTimeout(scheduleAiNote, delay);
}

// ── Record ────────────────────────────────────────────────────────────────────
recordBtn.addEventListener('click', async () => {
  if (Tone.context.state !== 'running') Tone.start();
  if (!isRecording) {
    await engine.startRecording();
    isRecording = true;
    recordBtn.textContent = '⏹ Stop';
    recordBtn.classList.add('recording');
  } else {
    const blob = await engine.stopRecording();
    isRecording = false;
    recordBtn.textContent = '⏺ Record';
    recordBtn.classList.remove('recording');
    if (blob) downloadBlob(blob, 'gesturejam-recording.webm');
  }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Auto instrument toggle ────────────────────────────────────────────────────
autoBtn.addEventListener('click', () => {
  autoMode = !autoMode;
  autoBtn.classList.toggle('active', autoMode);
  autoBtn.textContent = 'Auto Instrument: ' + (autoMode ? 'ON' : 'OFF');
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const map = { '1':'guitar', '2':'piano', '3':'flute', '4':'drums', '5':'synth' };
  if (map[e.key]) switchInstrument(map[e.key]);
});

// ── Audio visualizer ──────────────────────────────────────────────────────────
let analyser, vizCtx, vizAnim;

function initViz() {
  analyser = new Tone.Analyser('waveform', 256);
  Tone.getDestination().connect(analyser);
  vizCtx = vizCanvas.getContext('2d');
  drawViz();
}

function drawViz() {
  vizAnim = requestAnimationFrame(drawViz);
  const w = vizCanvas.offsetWidth, h = vizCanvas.offsetHeight;
  if (vizCanvas.width !== w || vizCanvas.height !== h) {
    vizCanvas.width = w; vizCanvas.height = h;
  }
  vizCtx.clearRect(0, 0, w, h);

  const data  = analyser.getValue();
  const color = INST_CONFIG[engine.current]?.color ?? '#7c3aed';
  const step  = w / data.length;

  vizCtx.beginPath();
  vizCtx.strokeStyle = color;
  vizCtx.lineWidth   = 2;
  vizCtx.shadowColor = color;
  vizCtx.shadowBlur  = 8;

  data.forEach((v, i) => {
    const x = i * step;
    const y = ((v + 1) / 2) * h;
    i === 0 ? vizCtx.moveTo(x, y) : vizCtx.lineTo(x, y);
  });
  vizCtx.stroke();
}

// ── Audio context unlock (browsers require a user gesture) ───────────────────
document.addEventListener('pointerdown', async () => {
  if (Tone.context.state !== 'running') await Tone.start();
}, { once: true });

// ── Start ─────────────────────────────────────────────────────────────────────
boot();
