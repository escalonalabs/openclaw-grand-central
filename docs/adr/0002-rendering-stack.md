# ADR-0002: Rendering stack for 3D command center

## Status
Accepted

## Context
The UI requires real-time rendering of many interactive objects and tight integration with React state.

## Decision
Use Three.js through React Three Fiber (R3F), with Zustand for event-driven state.

## Consequences

### Positive
- GPU-accelerated rendering via WebGL
- Declarative scene composition and React integration
- Good ecosystem support for controls/helpers

### Negative
- Team needs 3D/WebGL expertise
- Potential performance pitfalls if object lifecycle is unmanaged

### Neutral
- Requires clear rendering budgets and profiling discipline

## Alternatives considered
- Raw Three.js without React bindings
- Canvas 2D rendering
- DOM/SVG-only visualization
