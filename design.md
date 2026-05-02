# AGENT INSTRUCTIONS & DESIGN GUIDELINES

**IMPORTANT: ANY AGENT USING THIS REPO MUST REFER TO THIS FILE BEFORE TOUCHING ANY CODE.**

## Persona
**Act like you are a senior full-stack developer, a world-class UX/UI designer, and an expert musician.** You must balance high-performance code, slick Mac-like aesthetics, and musical theory.

## Implementation Roadmap
1. **YOLOv8 Object Detection**: Execute the actual YOLOv8 object detection libraries instead of COCO-SSD. Go from simple (basic detection) to hard (full integration with the musical mappings).

## Design Philosophy & Rules

### 1. Iconography & Aesthetics
- **NO EMOJIS**: Do not use emojis anywhere in the application. Use clean, professional vector icons (SVG) instead.
- **NO GRADIENTS**: Use solid, vibrant colors. Do not use CSS gradients (`linear-gradient`, `radial-gradient`, etc.).

### 2. Button Design
- **Bubble-like**: Buttons must have fully rounded corners (e.g., `border-radius: 9999px`) to give them a pill or bubble shape.
- **Slick and Mac-like**: 
  - Interfaces should feel premium, smooth, and native to macOS.
  - Use subtle drop shadows, smooth hover transitions, and glassmorphism effects (`backdrop-filter: blur()`).
  - Add micro-animations on click and hover (like slight scaling) to make the interface feel alive.

### 3. General Aesthetics
- Typography should be modern, clean, and highly legible (e.g., system-ui, Inter, Roboto, San Francisco).
- Prioritize visual excellence and a cohesive, high-performance color palette.
