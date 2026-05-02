#!/usr/bin/env python3
"""
Flask backend for YOLOv8 object detection.
Runs inference at ~15fps (vs 2.5fps browser ONNX).
Endpoints:
  POST /detect - expects base64 frame, returns {class, confidence, bbox}
  GET /health - health check
"""

import base64
import os
import sys
from io import BytesIO
import json
import time

import cv2
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image

# Suppress TensorFlow/YOLO warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import warnings
warnings.filterwarnings('ignore')

# Try to load YOLOv8 from Hugging Face Hub
try:
    from ultralytics import YOLO
    model = YOLO('yolov8n.pt')  # nano model for speed
    print("✓ YOLOv8 loaded from local pt file")
except Exception as e:
    try:
        # Fallback: load from Hugging Face if .pt not available
        from transformers import pipeline
        # Note: transformers doesn't have a direct YOLOv8 pipeline yet,
        # so we try ultralytics first
        print(f"⚠ Falling back to alternate loading: {e}")
        from ultralytics import YOLO
        model = YOLO('https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n.pt')
        print("✓ YOLOv8 loaded from Hugging Face CDN")
    except Exception as e2:
        print(f"✗ Failed to load YOLOv8: {e2}")
        print("   Install: pip install ultralytics opencv-python pillow")
        sys.exit(1)

# COCO class names
COCO_CLASSES = [
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
]

HOLDABLE = {
    'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl',
    'banana', 'apple', 'sandwich', 'orange', 'carrot', 'hot dog',
    'cell phone', 'remote', 'keyboard', 'mouse', 'book', 'scissors',
    'toothbrush', 'baseball bat', 'baseball glove', 'tennis racket',
    'sports ball', 'frisbee', 'skateboard', 'surfboard', 'kite',
    'umbrella', 'handbag', 'tie', 'suitcase', 'vase', 'clock',
}

app = Flask(__name__)
CORS(app)

# Performance tracking
last_inference_time = 0

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'model': 'YOLOv8n'})

@app.route('/detect', methods=['POST'])
def detect():
    """
    Detect objects in a base64-encoded frame.
    
    Request JSON:
    {
      "frame": "<base64-encoded image>",
      "confidence_threshold": 0.4  // optional
    }
    
    Response JSON:
    {
      "detected": true/false,
      "class": "cup",           // if detected
      "confidence": 0.92,       // if detected
      "bbox": [0.1, 0.2, 0.3, 0.4],  // [x, y, w, h] normalized to 0-1
      "inference_time_ms": 45,
      "timestamp": 1714589123.456
    }
    """
    global last_inference_time
    
    try:
        data = request.get_json()
        if not data or 'frame' not in data:
            return jsonify({'error': 'Missing "frame" in request'}), 400
        
        # Decode base64 frame
        frame_b64 = data['frame']
        try:
            frame_bytes = base64.b64decode(frame_b64)
            img = Image.open(BytesIO(frame_bytes))
            frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        except Exception as e:
            return jsonify({'error': f'Failed to decode frame: {str(e)}'}), 400
        
        conf_threshold = data.get('confidence_threshold', 0.4)
        
        # Run inference
        start = time.time()
        results = model.predict(frame, conf=conf_threshold, verbose=False)
        inference_time = (time.time() - start) * 1000
        last_inference_time = inference_time
        
        # Parse results – find best HOLDABLE object
        best_conf = 0
        best_class = None
        best_bbox = None
        
        if results and len(results) > 0:
            for result in results:
                if hasattr(result, 'boxes'):
                    for box in result.boxes:
                        conf = float(box.conf)
                        cls_id = int(box.cls)
                        if cls_id < len(COCO_CLASSES):
                            class_name = COCO_CLASSES[cls_id]
                            # Only track HOLDABLE objects
                            if class_name in HOLDABLE and conf > best_conf:
                                best_conf = conf
                                best_class = class_name
                                # Normalize bbox to 0-1 space
                                x1, y1, x2, y2 = box.xyxy[0]
                                h, w = frame.shape[:2]
                                cx = ((x1 + x2) / 2) / w
                                cy = ((y1 + y2) / 2) / h
                                bw = (x2 - x1) / w
                                bh = (y2 - y1) / h
                                best_bbox = [cx, cy, bw, bh]
        
        response = {
            'detected': best_class is not None,
            'inference_time_ms': round(inference_time, 2),
            'timestamp': time.time(),
        }
        
        if best_class:
            response['class'] = best_class
            response['confidence'] = round(best_conf, 3)
            response['bbox'] = best_bbox
        
        return jsonify(response)
    
    except Exception as e:
        print(f"Error in /detect: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    """Get server status and performance metrics."""
    return jsonify({
        'model': 'YOLOv8n',
        'last_inference_ms': last_inference_time,
        'status': 'ready'
    })

if __name__ == '__main__':
    print("🚀 YOLOv8 Detection Server")
    print("   Running on http://127.0.0.1:5000")
    print("   POST /detect - detect objects in frame")
    print("   GET /health - health check")
    print()
    
    # Run on localhost, allow requests from any origin (for dev)
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
