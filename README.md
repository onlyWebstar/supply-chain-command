# Supply Chain Command
### Agent-Based Bullwhip Effect Simulator

A production-grade, interactive supply chain simulation built in React. Models a three-tier chain (Retailer → Wholesaler → Factory) using autonomous agents and four swappable inventory ordering policies. Demonstrates the **Bullwhip Effect** — how small fluctuations in consumer demand cause increasingly severe order amplification upstream — and tests which policies dampen it.

Built as a portfolio project across five development phases, progressing from a pure simulation engine to a full analytical platform with persistent run history, sensitivity analysis, and auto-generated intelligence reports.

---

## Live Demo

> Open https://supply-chain-command.vercel.app/
---

## Project Structure



> **Start here:** `src/App.jsx` is the complete, final artifact containing all five phases. 

---

## Architecture

I divided the simulation into 5 phases in a single file(App.jsx) and App.css for styling 

### Internal Module Layout

```
supply-chain-sim-v3.jsx
│
├── PHASE 1: Core Engine
│   ├── class Pipeline          — FIFO queue modelling physical lead-time delay
│   └── class Agent             — Autonomous supply chain tier (inventory, backlog,
│                                 pipeline, policy execution, service-level tracking)
│
├── PHASE 2: Policy Modules
│   └── const POLICIES          — Four interchangeable strategy objects (Strategy Pattern):
│                                 NAIVE | FIXED_REORDER | BASE_STOCK | COLLABORATIVE
│
├── Simulation Runtime
│   ├── generateDemand()        — Demand pattern generator (step shock, seasonal,
│   │                             stable, stochastic)
│   ├── coefVar()               — Coefficient of variation (CV) helper
│   ├── computeBullwhip()       — Live bullwhip ratio: CV(orders) ÷ CV(demand)
│   ├── tickSim()               — Advances all agents one discrete time step
│   └── runFullSim()            — Runs a complete 100-tick simulation synchronously
│                                 (used by comparison, sensitivity, and report tabs)
│
├── PHASE 4: Insight Report
│   └── generateReport()        — Produces a six-section written analysis from
│                                 live simulation results (no hard-coded text)
│
├── State Management
│   ├── INIT_CFG / buildAgents()
│   ├── simReducer()            — Pure reducer: TICK | SET_RUNNING | RESET | UPDATE_CONFIG
│   └── useReducer(simReducer)
│
├── Shared UI Components
│   ├── StatCard                — Metric display tile with accent colour
│   ├── BullwhipBar             — Animated progress bar with severity colouring
│   ├── PolicySelect            — Radio group for policy selection
│   ├── SliderControl           — Labelled range input
│   ├── CustomTooltip           — Recharts tooltip override
│   └── ChartPanel              — Recharts LineChart wrapper
│
├── FlowDiagram                 — SVG animated flow: particles travel between
│                                 tiers via animateMotion, shock state reflected
│                                 in node border colour
│
├── PHASE 4: RunHistoryPanel    — Reads/writes window.storage (persistent across
│                                 sessions); auto-saves completed runs at tick 100
│
├── PHASE 5: SensitivityPanel   — Two sub-modes:
│   ├── Sensitivity Analysis    — Sweeps shock magnitude ×1.1→×4.0, 9 steps × 4
│   │                             policies = 36 full simulations
│   └── Heatmap                 — 4×4 policy × scenario matrix, 16 simulations,
│                                 semantically colour-coded bullwhip cells
│
├── ReportPanel                 — Runs all 4 policies → generateReport() →
│                                 renders 6-section written analysis + TXT export
│
├── ComparisonPanel             — Runs all 4 policies on chosen scenario;
│                                 renders metrics table, radar chart, bar chart,
│                                 overlay order chart, CSV export
│
└── App (main)                  — Five-tab shell:
                                  LIVE SIM | COMPARE | SENSITIVITY & HEATMAP |
                                  RUN HISTORY | INTELLIGENCE REPORT
```

---

## The Four Inventory Policies

| Policy | Logic | Bullwhip Behaviour |
|---|---|---|
| **Naïve Reactive** | Order = last period's sales | Maximum amplification — pure reactive |
| **Fixed Reorder Point** | Order batch Q when stock < threshold S | Moderate — batch ordering creates oscillation cycles |
| **Base-Stock** | Order = target position T − (inventory + pipeline − backlog) | Low — accounts for in-transit goods, avoids double-ordering |
| **Collaborative** | All tiers receive real customer demand signal | Near-zero — information distortion eliminated at source |

The policies are implemented as a **Strategy Pattern**: each is a pure function `compute(state, params, sharedDemand?) → orderQty` swappable at runtime per tier with no engine changes.

---

## The Bullwhip Effect: What's Being Modelled

The bullwhip ratio is computed as:

```
Bullwhip Ratio = CV(orders placed) ÷ CV(customer demand)
```

Where CV = coefficient of variation (standard deviation ÷ mean). A ratio of **1.0** means orders are no more volatile than demand. Values above **2.0** represent economically significant instability.

Under a ×2.5 demand shock (COVID scenario) with Naïve policy and factory lead time of 6 periods, the factory bullwhip ratio typically reaches **3.5–5.0×** — the factory is ordering 350–500% more volatile quantities than actual customer demand warrants. Switching to Collaborative policy collapses this to near **1.0×** with zero structural changes.

---

## Features by Phase

### Phase 1+2 — Engine & Policies 
- `Pipeline` class: FIFO queue representing physical lead-time delay
- `Agent` class: autonomous state machine with inventory, backlog, and policy execution
- Correct tick sequencing: goods received → demand fulfilled → order decided → pipeline advanced
- Four pluggable policies implementing Strategy Pattern
- Live bullwhip ratio computed via coefficient of variation
- Three Recharts panels: inventory levels, orders placed, backlog pressure

### Phase 3 — Dashboard
- Animated SVG flow diagram with `animateMotion` particles between tiers
- Policy Comparison tab: runs all four policies simultaneously on any scenario
- Radar chart, bullwhip bar chart, overlay order chart
- Four scenario presets: COVID Shock ⚡, Seasonal Ramp 🌊, Stable Baseline —, Noise Storm 〜
- CSV export for both live simulation data and comparison results

### Phase 4 — Analysis & Persistence 
- **Run History**: `window.storage` persistence — all completed simulations auto-saved at tick 100, survive page reloads, viewable and deletable
- **Intelligence Report**: six-section written analysis generated entirely from live simulation numbers — Executive Summary, Bullwhip Mechanics, Policy Findings, Quantified Value of Information Sharing, Managerial Recommendations, Methodology — exportable as `.txt`

### Phase 5 — Sensitivity & Heatmap 
- **Sensitivity Analysis**: sweeps shock magnitude ×1.1 → ×4.0 in nine steps across all four policies (36 total simulation runs); visualises nonlinear bullwhip scaling
- **Policy × Scenario Heatmap**: full 4×4 matrix (16 simulations); each cell shows factory bullwhip ratio with semantic colour coding (green → red)
- Staggered page-load animation; tab transitions with `fadeIn`

---

## Dependencies

```json
{
  "react": "^18",
  "recharts": "^2"
}
```

Fonts loaded from Google Fonts at runtime (no installation required):
- **Bebas Neue** — display headers
- **IBM Plex Mono** — all data readouts and body text



---

## Run Locally

###Vite + React
```bash
git clone https://github.com/onlyWebstar/supply-chain-command.git
cd supply-chain-command
npm install 
npm run dev
```

---

## Key Design Decisions

**Why a single file?** Keeping everything self-contained makes the simulation trivially portable and easy to setup.

**Why `useReducer` over `useState`?** The simulation state has multiple interdependent fields (agents, history, tick, running state, bullwhip metrics) that all update together on each tick. A reducer enforces that all state transitions are explicit, pure, and debuggable.

**Why synchronous `runFullSim()` for comparison/analysis?** Running 16 simulations × 100 ticks each completes in under 150ms in a browser JS thread. The simplicity of synchronous code outweighs the minor UI freeze (mitigated with `setTimeout` to allow the "COMPUTING…" state to render first).

**Why Strategy Pattern for policies?** Policies need to be swappable per-tier at runtime, comparable across tiers, and extensible without touching the engine. A plain object map of pure functions achieves this with zero ceremony.

---

## Simulation Assumptions

- All unfilled demand becomes **backlog** (no lost sales) — demand is fully captured and fulfilled in subsequent periods
- Starting inventory: **60 units** per tier
- Lead times are **deterministic** (no variance) — stochasticity is in demand only
- Policy parameters (reorder point, target stock, safety buffer) are fixed per tier and not optimised
- Simulation runs for exactly **100 ticks** per run

---

## Concepts Demonstrated

- **Agent-Based Modelling** — autonomous agents with local state and decision rules producing emergent system behaviour
- **Complex Adaptive Systems** — small demand perturbations propagate and amplify nonlinearly through the chain
- **Strategy Design Pattern** — pluggable policy modules with a consistent interface
- **Discrete-Event Simulation** — FIFO pipeline queues, tick-based time advancement, state carried forward across ticks
- **Information Economics** — quantifying the monetary value of upstream demand signal sharing
- **React Architecture** — `useReducer` for complex state, `useMemo` for expensive derived data, `useCallback` for stable event handlers

---

## Development Phases

| Phase | Focus |
|---|---|
| 1+2 | Core engine, pipeline queues, agent state machines, four policy modules, bullwhip metric |
| 3 | Animated SVG flow, policy comparison tab, scenario presets, CSV export |
| 4 | Persistent run history (`window.storage`), auto-generated intelligence report |
| 5 | Sensitivity sweep, policy×scenario heatmap, staggered animations, complete polish |

---


