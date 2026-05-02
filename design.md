# Design Guidelines

This document outlines the core design philosophy and rules for this project. All agents and developers must adhere to these guidelines when updating or creating new UI elements.

## 1. Iconography
- **NO EMOJIS**: Do not use emojis as icons anywhere in the application.
- Use clean, professional vector icons (e.g., SVG icons) if iconography is needed.

## 2. Button Design
- **Bubble-like**: Buttons should have fully rounded corners (e.g., `border-radius: 9999px` or similar) to give them a pill or bubble shape.
- **Slick and Mac-like**: 
  - Interfaces should feel premium, smooth, and native to macOS.
  - Use subtle drop shadows, smooth hover transitions, and glassmorphism effects (e.g., `backdrop-filter: blur()`) where appropriate.
  - Use smooth gradients or vibrant, solid colors that feel modern.
  - Micro-animations on click and hover (like slight scaling) should be included to make the interface feel responsive and alive.

## 3. General Aesthetics
- Typography should be modern, clean, and highly legible (e.g., system-ui, Inter, Roboto, San Francisco).
- Prioritize visual excellence and a cohesive, high-performance color palette.
