// Wraps COCO-SSD to detect holdable objects in the video feed.
// Runs at ~3fps independently of gesture processing.

const HOLDABLE = new Set([
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl',
  'banana', 'apple', 'sandwich', 'orange', 'carrot', 'hot dog',
  'cell phone', 'remote', 'keyboard', 'mouse', 'book', 'scissors',
  'toothbrush', 'baseball bat', 'baseball glove', 'tennis racket',
  'sports ball', 'frisbee', 'skateboard', 'surfboard', 'kite',
  'umbrella', 'handbag', 'tie', 'suitcase', 'vase', 'clock',
]);

export class ObjectDetector {
  constructor() {
    this.model    = null;
    this.detected = false;
    this.label    = null;
    this.bbox     = null;   // normalized {x,y,w,h} in 0-1 space
    this._running = false;
    this._video   = null;
  }

  async init(onProgress) {
    onProgress?.('Loading object detection model…');
    this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    onProgress?.(null);
  }

  start(videoEl) {
    this._video   = videoEl;
    this._running = true;
    this._loop();
  }

  stop() { this._running = false; }

  isObjectPresent() { return this.detected; }
  getLabel()        { return this.label; }

  // Returns true if normalized point (hx, hy) is within the object bbox
  // expanded by `margin` on each side (default 20% of frame).
  isHandNear(hx, hy, margin = 0.20) {
    if (!this.bbox) return false;
    const { x, y, w, h } = this.bbox;
    return hx >= x - margin && hx <= x + w + margin &&
           hy >= y - margin && hy <= y + h + margin;
  }

  async _loop() {
    while (this._running) {
      if (this.model && this._video?.readyState >= 2) {
        try {
          const preds = await this.model.detect(this._video, 10, 0.25);
          const match = preds.find(p => HOLDABLE.has(p.class));
          this.detected = !!match;
          this.label    = match ? match.class : null;

          if (match) {
            const [bx, by, bw, bh] = match.bbox;
            const vw = this._video.videoWidth  || 640;
            const vh = this._video.videoHeight || 480;
            this.bbox = { x: bx/vw, y: by/vh, w: bw/vw, h: bh/vh };
          } else {
            this.bbox = null;
          }
        } catch { /* ignore transient errors */ }
      }
      await new Promise(r => setTimeout(r, 350));
    }
  }
}
