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
let autoMode    = false;
let isRecording = false;

let phraseBuffer = [];
let conversationHistory = []; // Tracks user and AI turns
let lastNoteTime = 0;
let idleTimer    = null;
let isThinking   = false;
const apiKeyEl   = document.getElementById('api-key');

// ── Object to Instrument Map ──────────────────────────────────────────────────
const OBJ_MAP = {
  'person': 'synth', 'bicycle': 'synth', 'car': 'drums', 'motorcycle': 'drums', 'airplane': 'synth',
  'bus': 'drums', 'train': 'drums', 'truck': 'drums', 'boat': 'flute', 'traffic light': 'synth',
  'fire hydrant': 'drums', 'stop sign': 'drums', 'parking meter': 'synth', 'bench': 'piano',
  'bird': 'flute', 'cat': 'flute', 'dog': 'synth', 'horse': 'drums', 'sheep': 'flute', 'cow': 'drums',
  'elephant': 'drums', 'bear': 'drums', 'zebra': 'drums', 'giraffe': 'flute', 'backpack': 'drums',
  'umbrella': 'synth', 'handbag': 'piano', 'tie': 'guitar', 'suitcase': 'piano', 'frisbee': 'synth',
  'skis': 'guitar', 'snowboard': 'guitar', 'sports ball': 'drums', 'kite': 'flute', 'baseball bat': 'guitar',
  'baseball glove': 'piano', 'skateboard': 'synth', 'surfboard': 'piano', 'tennis racket': 'guitar',
  'bottle': 'flute', 'wine glass': 'flute', 'cup': 'drums', 'fork': 'guitar', 'knife': 'guitar',
  'spoon': 'guitar', 'bowl': 'drums', 'banana': 'guitar', 'apple': 'drums', 'sandwich': 'piano',
  'orange': 'drums', 'broccoli': 'drums', 'carrot': 'flute', 'hot dog': 'guitar', 'pizza': 'piano',
  'donut': 'drums', 'cake': 'piano', 'chair': 'piano', 'couch': 'piano', 'potted plant': 'flute',
  'bed': 'piano', 'dining table': 'piano', 'toilet': 'drums', 'tv': 'synth', 'laptop': 'piano',
  'mouse': 'synth', 'remote': 'synth', 'keyboard': 'piano', 'cell phone': 'synth', 'microwave': 'synth',
  'oven': 'synth', 'toaster': 'synth', 'sink': 'drums', 'refrigerator': 'drums', 'book': 'piano',
  'clock': 'drums', 'vase': 'flute', 'scissors': 'synth', 'teddy bear': 'synth', 'hair drier': 'synth',
  'toothbrush': 'guitar'
};

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
    if (autoMode) {
      const inst = OBJ_MAP[label];
      if (inst && inst !== engine.current) switchInstrument(inst);
    }
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
  const now = performance.now();
  
  notes.forEach(({ note, velocity, delay }) => {
    engine.playNote(note, velocity, delay);
    detector.spawnParticle(gesture.x, gesture.y, Tone.Frequency(note, "midi").toNote());
  });

  // Throttle recording to phrase buffer (e.g. 1 per 160ms)
  if (now - lastNoteTime > 160 && !isThinking) {
    notes.forEach(({ note, velocity }) => {
      phraseBuffer.push({ note, velocity, timestamp: now });
      if (phraseBuffer.length > 20) phraseBuffer.shift();
    });
    lastNoteTime = now;
    resetIdleTimer();
  }

  if (autoMode) maybeAutoSwitch(gesture);
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!aiActive) return;
  idleTimer = setTimeout(() => {
    if (phraseBuffer.length >= 4 && !isThinking) triggerGemini();
  }, 2000);
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
  
  if (aiActive) {
    aiBadge.innerHTML = '<span class="pulse-dot"></span> AI Listening';
    phraseBuffer = [];
    resetIdleTimer();
  } else {
    clearTimeout(idleTimer);
  }
});

async function triggerGemini() {
  const apiKey = apiKeyEl.value.trim();
  if (!apiKey) {
    console.warn("Please enter a Gemini API Key!");
    aiActive = false;
    aiBtn.classList.remove('active');
    aiBadge.classList.add('hidden');
    return;
  }
  
  isThinking = true;
  aiBadge.textContent = "AI Thinking...";
  
  const baseTime = phraseBuffer[0].timestamp;
  const promptData = phraseBuffer.map(p => ({
    note: p.note, velocity: p.velocity, timeMs: Math.round(p.timestamp - baseTime)
  }));
  
  conversationHistory.push({ role: "user", notes: promptData });
  
  // Include conversation history up to last 4 turns
  const historyContext = conversationHistory.slice(-4).map(turn => 
    `${turn.role === 'user' ? 'Human' : 'AI'} played: ${JSON.stringify(turn.notes)}`
  ).join("\n");
  
  const prompt = `Here is the conversation history of the duet:\n${historyContext}\n\nRespond with a logical musical continuation (up to 8 notes) using exactly this JSON format: [{"note": 60, "velocity": 80, "timeMs": 500}]. Do not include markdown formatting or backticks, just the raw JSON array.`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 }
      })
    });
    
    const data = await res.json();
    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const continuation = JSON.parse(text);
    conversationHistory.push({ role: "ai", notes: continuation });
    
    playContinuation(continuation);
  } catch (e) {
    console.error("Gemini AI error:", e);
    isThinking = false;
    aiBadge.innerHTML = '<span class="pulse-dot"></span> AI Listening';
  }
}

function playContinuation(notes) {
  aiBadge.textContent = "AI Playing...";
  // Clear buffer so we don't infinitely trigger on AI's own notes if they get picked up
  phraseBuffer = [];
  
  notes.forEach(n => {
    setTimeout(() => {
      engine.playNote(n.note, n.velocity, 0, 350);
      detector.spawnParticle(0.5, 0.5, Tone.Frequency(n.note).toNote());
    }, n.timeMs || 0);
  });
  
  const maxTime = notes.length ? Math.max(...notes.map(n => n.timeMs || 0)) : 0;
  setTimeout(() => {
    isThinking = false;
    if (aiActive) aiBadge.innerHTML = '<span class="pulse-dot"></span> AI Listening';
  }, maxTime + 500);
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
  
  if (e.key.toLowerCase() === 'd') {
    runDemoSequence();
  }
});

async function runDemoSequence() {
  if (Tone.context.state !== 'running') await Tone.start();
  
  // Step 1: Display "HOLD ANY OBJECT"
  camHint.textContent = "HOLD ANY OBJECT";
  camHint.style.color = "var(--text)";
  
  // Step 2: Pretend to detect banana
  setTimeout(() => {
    camHint.textContent = "🎵 banana detected — play!";
    camHint.style.color = "#06b6d4";
    if (engine.current !== 'guitar') switchInstrument('guitar');
  }, 2000);
  
  // Step 3: Play canned riff
  setTimeout(() => {
    const riff = [
      { n: 60, d: 0 }, { n: 63, d: 200 }, { n: 65, d: 400 }, 
      { n: 67, d: 600 }, { n: 65, d: 800 }, { n: 63, d: 1000 }, 
      { n: 60, d: 1200 }, { n: 67, d: 1600 }
    ];
    riff.forEach(note => {
      setTimeout(() => {
        engine.playNote(note.n, 80, 0, 300);
        detector.spawnParticle(0.5, 0.5, Tone.Frequency(note.n, "midi").toNote());
        
        // Add to phrase buffer so AI can continue it
        phraseBuffer.push({ note: note.n, velocity: 80, timestamp: performance.now() + note.d });
        if (phraseBuffer.length > 20) phraseBuffer.shift();
      }, note.d);
    });
  }, 3500);
  
  // Step 4: Trigger AI continuation
  setTimeout(() => {
    if (!aiActive) aiBtn.click(); // Enable AI mode if not enabled
    triggerGemini();
  }, 6000);
  
  // Step 5: Show DUET MODE ACTIVE
  setTimeout(() => {
    camHint.textContent = "🎸 DUET MODE ACTIVE";
    camHint.style.color = "var(--purple)";
  }, 8000);
}

// ── Audio visualizer ──────────────────────────────────────────────────────────
let analyser, volMeter, vizCtx, vizAnim;
let volBars = [];

function initViz() {
  analyser = new Tone.Analyser('waveform', 256);
  volMeter = new Tone.Meter();
  Tone.getDestination().connect(analyser);
  Tone.getDestination().connect(volMeter);
  vizCtx = vizCanvas.getContext('2d');
  volBars = document.querySelectorAll('.vol-bar');
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

  // Draw volume bars
  const db = volMeter.getValue();
  const vol = Math.max(0, Math.min(1, (db + 60) / 60)); // normalized 0 to 1
  volBars.forEach((bar, i) => {
    const threshold = (i + 1) * 0.2; // 0.2, 0.4, 0.6, 0.8, 1.0
    const hPct = vol >= threshold ? 100 : (vol >= threshold - 0.2 ? ((vol - (threshold - 0.2)) / 0.2) * 100 : 10);
    bar.style.height = `${Math.max(10, hPct)}%`;
    if (vol > 0.75) bar.style.background = 'var(--red)';
    else if (vol > 0.5) bar.style.background = 'var(--amber)';
    else bar.style.background = 'var(--green)';
  });
}

// ── Audio context unlock (browsers require a user gesture) ───────────────────
document.addEventListener('pointerdown', async () => {
  if (Tone.context.state !== 'running') await Tone.start();
}, { once: true });

// ── Start ─────────────────────────────────────────────────────────────────────
boot();
