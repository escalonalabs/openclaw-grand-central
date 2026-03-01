# OpenClaw Grand Central: 3D Telemetry Architecture

**Status:** Proposed  
**Owner:** OMNIA / Leandro Escalona  
**Date:** 2026-02-28  

## 1. Requirements Summary

### 1.1 Functional Requirements (Metaphor: Train Station)

- **Live Agent Monitoring:** Visualize active OpenClaw agents (Runtimes) as "Trains".
- **Workspace Navigation:** Visualize physical and logical agent environments (`workspace-omnia`, `workspace-dr-house`, etc.) as "Stations".
- **Task Routing & Lanes:** Visualize execution lanes and sessions as "Tracks" (Rieles).
- **Exec Approvals:** Visualize pending user commands and security prompts as "Traffic Lights" (Semáforos).
- **Interactivity:** Clicking a station (Workspace) opens the agent's context or opens the terminal in that directory. Right-clicking a train (Agent) shows its active prompt, model used, and current execution state.

### 1.2 Non-Functional Requirements (NFRs)

- **Real-Time Responsiveness:** < 100ms latency from OpenClaw Gateway event to 3D visual update.
- **Resource Efficiency:** 3D rendering must not block or starve the OpenClaw Gateway process. Must be lightweight (runs on WebGL with optimized geometries).
- **Platform Agnostic:** The dashboard must be accessible via any modern browser connecting to the local host.
- **Security:** Requires connection to the authenticated OpenClaw Gateway API or secure log parsing.

---

## 2. High-Level Architecture Diagram

```mermaid
graph TD
    subgraph OpenClaw Gateway (Core)
        Lanes[Execution Lanes]
        Diagnostic[Diagnostic Event Emitter]
        Terminal[CLI / PTY Execs]
    end

    subgraph Telemetry Bridge (Node.js/WS)
        Parser[Event Parser]
        WSServer[WebSocket Server: port 3000]
    end

    subgraph 3D Command Center (Browser)
        ThreeJS[Three.js Renderer]
        Zustand[State Manager]
        UI[React UI Overlay]
    end

    Lanes -->|State changes| Diagnostic
    Diagnostic -->|Tail / API Hooks| Parser
    Parser -->|JSON payloads| WSServer
    WSServer <-->|Real-time events| Zustand
    Zustand -->|Update Props| ThreeJS
    ThreeJS --> UI
```

---

## 3. Key Decisions & Trade-Offs (ADR)

### ADR 001: Telemetry Data Source

**Context:** How to get real-time state from OpenClaw agents.
**Options considered:**

1. Poll `.hypernovum-status.json` written by a cron/hook.
2. Tail the raw `/tmp/openclaw/openclaw.log` file directly.
3. Build a native OpenClaw plugin hook to broadcast WebSockets.
**Decision:** Option 3 (Native Plugin Hook) with a fallback to Option 2 (Log Tailing).
**Rationale:** A native plugin hook (like the `mission-control` hook) provides structured JSON telemetry (`lane enqueue`, `embedded run tool start`, etc.) without disk I/O bottlenecks. It is cleaner and scales better.
**Trade-offs:** Requires writing a custom OpenClaw Hook/Plugin instead of just an external script.

### ADR 002: Rendering Engine

**Context:** Visualizing the train station in 3D in the browser.
**Decision:** `Three.js` + `React Three Fiber (R3F)`.
**Rationale:** Matches the proven stack of Hypernovum. R3F allows declarative construction of trains, stations, and tracks bound directly to a `Zustand` state store fed by WebSockets.
**Trade-offs:** High initial learning curve if custom shaders/geometries are required, but performance is exceptional for thousands of objects.

### ADR 003: Event Schema Versioning + QoS

**Context:** Multiple event inputs (native hook and fallback log parser) require a stable contract and delivery priorities.
**Decision:** Use a canonical versioned event envelope with explicit QoS classes (`best_effort`, `stateful`, `critical`).
**Rationale:** Reduces schema drift risk and protects critical security/approval events under load.
**Trade-offs:** Adds parser/version compatibility maintenance and QoS-aware testing.

### ADR 004: Security Model

**Context:** Telemetry and control flows can expose sensitive data and mutating actions.
**Decision:** Enforce token authn, scope-based authz, bridge-side redaction, and default-deny action gates.
**Rationale:** Establishes minimum guardrails before full control-plane integration.
**Trade-offs:** Increases policy and middleware complexity in early prototype stages.

---

## 4. Technology Recommendations

- **Frontend:** React 18 + Vite (Fast build, modern ecosystem).
- **3D Engine:** React Three Fiber (R3F) + Drei (Pre-built helpers for camera, orbit controls, text rendering).
- **State Management:** Zustand (Perfect for fast-moving WebSocket data without React context re-render hell).
- **Backend Bridge:** Express + `ws` (WebSocket) running as a standalone script or embedded OpenClaw plugin.
- **Styling:** TailwindCSS (For the 2D overlays, HUD, and context menus).

---

## 5. Risks and Mitigation Strategies

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Event Spam / Performance** | High | Throttle state updates in Zustand. Use instanced meshes (`InstancedMesh`) in Three.js for rendering bullets/data packets (tokens) on the tracks. |
| **OpenClaw API Changes** | Medium | Abstract the event parser. Map raw OpenClaw logs to a generic "Station Event Schema" so changes in OpenClaw core only require parser updates. |
| **Visual Clutter** | Medium | Implement dynamic LOD (Level of Detail) and filters. Allow the user to isolate a specific track (Session) and dim the rest. |
