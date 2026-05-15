# CPU Scheduling Animation

An interactive browser-based visualizer for nine CPU scheduling algorithms, built with vanilla JS and ES Modules. Runs entirely client-side — no build step required.

[![Live Demo](https://img.shields.io/badge/demo-live-5E81AC?style=flat-square)](https://jason9075.github.io/scheduling_animation/) ![Nord theme · Canvas Gantt · KaTeX math](https://img.shields.io/badge/theme-Nord-88C0D0?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-A3BE8C?style=flat-square)

## Algorithms

| Category | Algorithm | Key characteristic |
|---|---|---|
| Basic | **FCFS** | Arrival order; convoy effect |
| Basic | **SJF** | Shortest burst wins; non-preemptive |
| Basic | **RR** | Fixed time quantum; configurable |
| Advanced | **SRTF** | Preemptive SJF; theoretically optimal avg-wait |
| Advanced | **Priority** | Lowest priority number runs first |
| Advanced | **MLFQ** | 3-level feedback queue (q=1 s / 2 s / FCFS) |
| Advanced | **HRRN** | Highest response ratio $R=(W+B)/B$; starvation-free |
| Special | **Lottery** | Ticket-proportional random dispatch |
| Special | **EDF** | Earliest deadline first; preemptive real-time |

## Features

- **Live producer** — generates tasks at a configurable arrival rate (0.2–3 tasks/s); spawn button re-activates after the 12-task cap
- **Current Queue panel** — MLFQ mode expands into Q0 / Q1 / Q2 sub-groups; each task shows:
  - Burst time and progress overlay
  - **Wait** (total since arrival) and **Idle** (since last CPU dispatch) — starvation warning fires when Idle ≥ 15 s
  - Algorithm-specific info: response ratio (HRRN), ticket count (Lottery), deadline (EDF)
- **CPU Core** — circular slot with progress bar and context-switch counter
- **Execution Timeline** — Canvas 2D Gantt chart with 30 s sliding window; scroll-wheel and drag to pan through history; pulsing Live button to snap back
- **Starvation monitor** — tasks idle > 15 s get a red `!` badge; hover shows exact idle time and threshold
- **EDF deadline tracking** — dashed red border + MISSED label for overdue tasks; missed-deadline counter in footer
- **Math modal** — per-algorithm explanation with KaTeX-rendered formulas in English and Traditional Chinese
- **Stats footer** — completed count, average wait time, CPU utilisation, throughput, missed deadlines (EDF only)

## Getting Started

### Prerequisites

[Nix](https://nixos.org/) with flakes enabled, or manually install `live-server` and `just`.

### With Nix (recommended)

```sh
nix develop        # enter dev shell (provides live-server + just)
just dev           # start server on http://localhost:8080
```

### Without Nix

```sh
npm i -g live-server
live-server --port 8080 .
```

Open `http://localhost:8080` in your browser.

## Project Structure

```
.
├── index.html          # Single-page app shell, CSS, layout
├── src/
│   ├── scheduler.js    # Task model + all 9 scheduler classes + factory
│   ├── gantt.js        # Canvas Gantt renderer + ResizeObserver
│   └── main.js         # UI rendering, animation loop, controls
├── flake.nix           # Nix dev shell (live-server, just)
├── Justfile            # Task runner (just dev / refresh / check)
└── guidelines          # Original design specification (Traditional Chinese)
```

## Controls

| Control | Action |
|---|---|
| Algorithm selector | Switch algorithm; resets simulation and Gantt view |
| Speed buttons | 0.5× / 1× / 2× / 4× simulation speed |
| Step | Advance 0.5 sim-seconds while paused |
| Arrival Rate slider | Tasks per sim-second (0.2–3.0) |
| Quantum slider | RR time quantum (0.5–5 s); visible for RR only |
| Reset | Restart current algorithm from zero |
| ＋ Spawn | Produce 12 more tasks after cap is reached |
| 💡 | Open math modal for the active algorithm |
| Gantt scroll / drag | Pan execution history |
| ● Live | Snap Gantt view back to current time |

## Implementation Notes

- **`waitTime`** accumulates for the entire lifetime of a task in the ready queue — used for average-wait statistics.
- **`idleTime`** resets to 0 each time a task is dispatched to the CPU — used for starvation detection. In preemptive algorithms a task that receives regular CPU slices will never trigger the warning even if its total wait is large.
- The Gantt chart renders only the visible 30 s window; historical segments are stored in `ganttLog` on the scheduler instance.
- All nine schedulers inherit from `BaseScheduler` and override `_dispatch()` and optionally `tick()` / `_preemptCheck()`.

## License

MIT
