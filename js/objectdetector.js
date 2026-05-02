// Object detection backend: Flask server with YOLOv8.
// Runs at ~10-15fps via Flask API (vs 2.5fps browser ONNX).
// Falls back to browser ONNX if server unavailable.

const YOLO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
  'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote',
  'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
  'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

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
    this.session  = null;
    this.detected = false;
    this.label    = null;
    this.bbox     = null;   // normalized {x,y,w,h} in 0-1 space
    this._running = false;
    this._video   = null;
    this.serverUrl = 'http://127.0.0.1:5000';
    this.serverAvailable = false;
    this.useServer = true;
  }

  async init(onProgress) {
    onProgress?.('Checking for Flask backend…');
    
    // Try to connect to Flask server
    try {
      const resp = await fetch(`${this.serverUrl}/health`, { timeout: 2000 });
      if (resp.ok) {
        this.serverAvailable = true;
        this.useServer = true;
        onProgress?.('✓ Flask server detected');
        console.log('✓ Using Flask YOLOv8 server');
      }
    } catch (e) {
      console.warn('Flask server unavailable, falling back to browser ONNX:', e);
      this.useServer = false;
    }
    
    // Fallback: load browser ONNX if server not available
    if (!this.useServer) {
      onProgress?.('Loading YOLOv8 ONNX (browser)…');
      try {
        this.session = await ort.InferenceSession.create('./yolov8n.onnx', 
          { executionProviders: ['wasm'] });
        console.log('✓ Using browser ONNX');
      } catch (e) {
        console.error("YOLOv8 ONNX init error:", e);
      }
    }
    
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
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 640;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    while (this._running) {
      if (this._video?.readyState >= 2) {
        try {
          if (this.useServer) {
            // Use Flask API for detection
            ctx.drawImage(this._video, 0, 0, 640, 640);
            // Convert canvas to base64 PNG
            canvas.toBlob(async (blob) => {
              const reader = new FileReader();
              reader.onload = async (e) => {
                const base64 = e.target.result.split(',')[1];
                try {
                  const resp = await fetch(`${this.serverUrl}/detect`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ frame: base64, confidence_threshold: 0.4 })
                  });
                  if (resp.ok) {
                    const result = await resp.json();
                    this.detected = result.detected;
                    if (result.detected) {
                      this.label = result.class;
                      const [cx, cy, bw, bh] = result.bbox;
                      this.bbox = { x: cx - bw/2, y: cy - bh/2, w: bw, h: bh };
                    } else {
                      this.label = null;
                      this.bbox = null;
                    }
                  }
                } catch (e) {
                  // Server error – fall back to ONNX if available
                  if (this.session) this.useServer = false;
                }
              };
              reader.readAsDataURL(blob);
            }, 'image/png');
          } else if (this.session) {
            // Fallback: use browser ONNX
            ctx.drawImage(this._video, 0, 0, 640, 640);
            const imgData = ctx.getImageData(0, 0, 640, 640).data;
            
            const float32Data = new Float32Array(3 * 640 * 640);
            for (let i = 0; i < 640 * 640; i++) {
              float32Data[i] = imgData[i * 4] / 255.0;
              float32Data[640 * 640 + i] = imgData[i * 4 + 1] / 255.0;
              float32Data[2 * 640 * 640 + i] = imgData[i * 4 + 2] / 255.0;
            }
            
            const tensor = new ort.Tensor('float32', float32Data, [1, 3, 640, 640]);
            const results = await this.session.run({ images: tensor });
            const output = results.output0.data;
            
            let bestConf = 0; let bestClass = -1; let bestBox = null;
            for (let col = 0; col < 8400; col++) {
              let maxProb = 0; let maxIdx = -1;
              for (let c = 0; c < 80; c++) {
                const prob = output[(4 + c) * 8400 + col];
                if (prob > maxProb) { maxProb = prob; maxIdx = c; }
              }
              if (maxProb > 0.4 && maxProb > bestConf) {
                const label = YOLO_CLASSES[maxIdx];
                if (HOLDABLE.has(label)) {
                  bestConf = maxProb; bestClass = maxIdx;
                  const cx = output[0 * 8400 + col];
                  const cy = output[1 * 8400 + col];
                  const bw = output[2 * 8400 + col];
                  const bh = output[3 * 8400 + col];
                  bestBox = [cx, cy, bw, bh];
                }
              }
            }
            
            this.detected = !!bestBox;
            this.label = bestBox ? YOLO_CLASSES[bestClass] : null;
            if (bestBox) {
              const [cx, cy, bw, bh] = bestBox;
              this.bbox = {
                x: (cx - bw/2) / 640,
                y: (cy - bh/2) / 640,
                w: bw / 640,
                h: bh / 640
              };
            } else {
              this.bbox = null;
            }
          }
        } catch (e) {
          console.error('Detection error:', e);
        }
      }
      
      // Sleep 50-100ms between frames (~10-20fps)
      await new Promise(r => setTimeout(r, this.useServer ? 100 : 400));
    }
  }
}
