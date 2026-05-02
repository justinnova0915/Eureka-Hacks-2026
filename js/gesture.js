// Wraps MediaPipe Hands, detects gestures, emits CustomEvents.
// Events: 'gesture' {detail: GestureEvent}, 'hand' {detail: {landmarks}}, 'idle'

export class GestureDetector extends EventTarget {
  constructor(videoEl, canvasEl) {
    super();
    this.video  = videoEl;
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');

    this.history     = [];   // [{landmarks, ts}]
    this.MAX_HIST    = 12;
    this.idleTimer   = null;
    this.IDLE_MS     = 1200;

    this.lastStrumDir  = null;
    this.lastGestureTs = 0;
    this.lastTapTs     = 0;
    this.prevPinchDist = null;
    
    this.particles = [];
    this.latestResults = null;

    this._initHands();
    this._renderLoop();
  }

  _initHands() {
    this.hands = new Hands({
      locateFile: f =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`
    });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });
    this.hands.onResults(r => this._onResults(r));
  }

  async start() {
    this.camera = new Camera(this.video, {
      onFrame: async () => { await this.hands.send({ image: this.video }); },
      width: 640, height: 480,
    });
    await this.camera.start();
  }

  // ── Results handler ──────────────────────────────────────────────────────

  _onResults(results) {
    this.latestResults = results;

    if (!results.multiHandLandmarks?.length) {
      this._scheduleIdle();
      return;
    }

    this._cancelIdle();
    const lm = results.multiHandLandmarks[0];
    const ts = performance.now();

    this.history.push({ landmarks: lm, ts });
    if (this.history.length > this.MAX_HIST) this.history.shift();

    const gesture = this._detect(lm, ts);
    if (gesture) this.dispatchEvent(new CustomEvent('gesture', { detail: gesture }));

    this.dispatchEvent(new CustomEvent('hand', { detail: { landmarks: lm } }));
  }

  // ── Particles ────────────────────────────────────────────────────────────
  spawnParticle(nx, ny, noteName) {
    // Map note base class (e.g. "C", "D#") to a color
    const base = noteName.replace(/[0-9]/g, '').replace('#', '');
    const hues = { 'C':185, 'D':205, 'E':225, 'F':245, 'G':265, 'A':285, 'B':305 };
    const h = hues[base] || 200;
    const color = `hsl(${h}, 80%, 60%)`;

    const cx = nx * this.canvas.width;
    const cy = ny * this.canvas.height;

    for (let i = 0; i < 3; i++) {
      this.particles.push({
        x: cx, y: cy,
        vx: (Math.random() - 0.5) * 5,
        vy: -1.5 - Math.random() * 3,
        life: 1.0,
        size: 4 + Math.random() * 7,
        color: color,
        label: i === 0 ? noteName : null
      });
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────
  
  _renderLoop() {
    requestAnimationFrame(() => this._renderLoop());
    const { canvas, ctx } = this;

    const dw = canvas.offsetWidth;
    const dh = canvas.offsetHeight;
    if (dw && dh && (canvas.width !== dw || canvas.height !== dh)) {
      canvas.width  = dw;
      canvas.height = dh;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.latestResults && this.latestResults.multiHandLandmarks?.length) {
      for (const lm of this.latestResults.multiHandLandmarks) {
        drawConnectors(ctx, lm, HAND_CONNECTIONS, { color: '#7c3aed55', lineWidth: 2 });
        drawLandmarks(ctx, lm, { color: '#06b6d4cc', lineWidth: 1, radius: 3 });
      }
      const tips = [4, 8, 12, 16, 20];
      for (const lm of this.latestResults.multiHandLandmarks) {
        for (const idx of tips) {
          const p = lm[idx];
          ctx.beginPath();
          ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#06b6d4';
          ctx.fill();
        }
      }
    }

    // Draw particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.022;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      
      if (p.label) {
        ctx.font = 'bold 16px Inter, sans-serif';
        // Needs horizontal flip back because canvas is scaleX(-1) mirrored
        ctx.translate(p.x, p.y);
        ctx.scale(-1, 1);
        ctx.fillText(p.label, -10, 5);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── Idle ─────────────────────────────────────────────────────────────────

  _scheduleIdle() {
    if (!this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.dispatchEvent(new CustomEvent('idle'));
      }, this.IDLE_MS);
    }
  }

  _cancelIdle() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  // ── Velocity ─────────────────────────────────────────────────────────────

  _vel() {
    if (this.history.length < 2) return { x: 0, y: 0, mag: 0 };
    const a = this.history[this.history.length - 2];
    const b = this.history[this.history.length - 1];
    const dt = Math.max(8, b.ts - a.ts) / 1000;
    const vx = (b.landmarks[0].x - a.landmarks[0].x) / dt;
    const vy = (b.landmarks[0].y - a.landmarks[0].y) / dt;
    return { x: vx, y: vy, mag: Math.hypot(vx, vy) };
  }

  // ── Finger helpers ───────────────────────────────────────────────────────

  _extended(lm, tipIdx, mcpIdx) {
    const w = lm[0], m = lm[mcpIdx], t = lm[tipIdx];
    const dw_m = Math.hypot(m.x - w.x, m.y - w.y);
    const dw_t = Math.hypot(t.x - w.x, t.y - w.y);
    return dw_t > dw_m * 1.18;
  }

  _countExtended(lm) {
    return [[8,5],[12,9],[16,13],[20,17]]
      .filter(([t,m]) => this._extended(lm, t, m)).length;
  }

  _thumbOut(lm) {
    return Math.hypot(lm[4].x - lm[5].x, lm[4].y - lm[5].y) > 0.09;
  }

  // ── Gesture detection ────────────────────────────────────────────────────

  _detect(lm, ts) {
    const vel  = this._vel();
    const ext  = this._countExtended(lm);
    const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);

    // Pluck: pinch releases quickly
    if (this.prevPinchDist !== null) {
      const delta = pinch - this.prevPinchDist;
      if (this.prevPinchDist < 0.06 && delta > 0.03 && ts - this.lastTapTs > 300) {
        this.prevPinchDist = pinch;
        this.lastTapTs = ts;
        return { type: 'pluck', x: lm[0].x, y: lm[0].y,
                 velocity: Math.min(1, delta / 0.08) };
      }
    }
    this.prevPinchDist = pinch;

    // Strum: fast horizontal sweep, 3+ fingers open
    if (ext >= 3 && Math.abs(vel.x) > 0.75) {
      const dir = vel.x > 0 ? 'right' : 'left';
      if (dir !== this.lastStrumDir || ts - this.lastGestureTs > 350) {
        this.lastStrumDir  = dir;
        this.lastGestureTs = ts;
        return { type: 'strum', direction: dir,
                 x: lm[0].x, y: lm[0].y,
                 velocity: Math.min(1, Math.abs(vel.x) / 2.5) };
      }
    }

    // Tap: single-finger fast downward jab
    if (this.history.length >= 3 && ext >= 1 && ext <= 2) {
      const old = this.history[this.history.length - 3];
      const cur = this.history[this.history.length - 1];
      const dt  = Math.max(8, cur.ts - old.ts) / 1000;
      const tipVY = (cur.landmarks[8].y - old.landmarks[8].y) / dt;
      if (tipVY > 0.9 && ts - this.lastTapTs > 320) {
        this.lastTapTs = ts;
        return { type: 'tap', x: lm[8].x, y: lm[8].y,
                 velocity: Math.min(1, tipVY / 3) };
      }
    }

    // Hit: whole-hand downward strike (works with gripped/closed fist)
    if (this.history.length >= 3) {
      const old3 = this.history[this.history.length - 3];
      const cur3 = this.history[this.history.length - 1];
      const dt3  = Math.max(8, cur3.ts - old3.ts) / 1000;
      const wristVY = (cur3.landmarks[0].y - old3.landmarks[0].y) / dt3;
      if (wristVY > 0.9 && ts - this.lastTapTs > 320) {
        this.lastTapTs = ts;
        return { type: 'hit', x: lm[0].x, y: lm[0].y,
                 velocity: Math.min(1, wristVY / 3) };
      }
    }

    // Air-press: open palm pushing down
    if (ext === 4 && this._thumbOut(lm) && vel.y > 0.75 && vel.mag < 1.8) {
      if (ts - this.lastGestureTs > 500) {
        this.lastGestureTs = ts;
        return { type: 'airpress', x: lm[0].x, y: lm[0].y,
                 velocity: Math.min(1, vel.y / 1.5) };
      }
    }

    // Slide: gentle horizontal drift — throttled so it doesn't flood notes
    if (ext >= 2 && Math.abs(vel.x) > 0.25 && Math.abs(vel.x) < 1.1) {
      if (ts - this.lastGestureTs > 180) {
        this.lastGestureTs = ts;
        return { type: 'slide', x: lm[0].x, y: lm[0].y, velocity: 0.55, dx: vel.x };
      }
    }

    return null;
  }

  // ── Pose classification (used by classifier.js) ──────────────────────────

  getPose(lm) {
    if (!lm) return 'unknown';
    const ext   = this._countExtended(lm);
    const thumb = this._thumbOut(lm);
    const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) < 0.05;

    if (pinch)                             return 'pinch';
    if (ext === 0 && !thumb)               return 'fist';
    if (ext === 4 && thumb)                return 'open';
    if (ext === 1)                         return 'point';
    if (ext === 2)                         return 'peace';
    if (ext >= 3)                          return 'spread';
    return 'curl';
  }
}
