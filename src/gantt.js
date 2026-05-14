/**
 * Single-row execution timeline renderer.
 * Draws the last WINDOW_SECS of simulation history onto a canvas.
 */

const WINDOW_SECS = 30;
const ROW_Y  = 4;
const ROW_H  = 26;
const AXIS_Y = ROW_Y + ROW_H + 3; // y-baseline for time ticks

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('./scheduler.js').BaseScheduler} sched
 */
export function renderGantt(canvas, sched) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  if (W === 0 || H === 0) return;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#434C5E'; // Nord2
  ctx.fillRect(0, 0, W, H);

  const { ganttLog, currentTask, _segStart, simTime } = sched;
  const t0    = Math.max(0, simTime - WINDOW_SECS);
  const scale = W / WINDOW_SECS; // pixels per sim-second

  // ── Segments ──────────────────────────────────────────────────────────────
  /** @type {{ taskId:number, color:string, start:number, end:number, active?:boolean }[]} */
  const segs = ganttLog.filter((s) => s.end > t0);

  // Append the ongoing segment (not yet in ganttLog)
  if (currentTask && _segStart !== null) {
    segs.push({
      taskId: currentTask.id,
      color:  currentTask.color,
      start:  _segStart,
      end:    simTime,
      active: true,
    });
  }

  for (const seg of segs) {
    const x1 = Math.max(0, (seg.start - t0) * scale);
    const x2 = Math.min(W, (seg.end   - t0) * scale);
    const w  = x2 - x1;
    if (w < 0.5) continue;

    if (seg.active) {
      // Fade the right edge of the active segment to indicate it's ongoing
      const grad = ctx.createLinearGradient(x1, 0, x2, 0);
      grad.addColorStop(0,   seg.color);
      grad.addColorStop(0.7, seg.color);
      grad.addColorStop(1,   seg.color + 'AA');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = seg.color;
    }
    ctx.fillRect(x1, ROW_Y, w, ROW_H);

    // Right-border separator between segments
    ctx.fillStyle = '#2E3440';
    ctx.fillRect(Math.min(x2 - 1, W - 1), ROW_Y, 1, ROW_H);

    // Task label (only if wide enough)
    if (w >= 18) {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`T${seg.taskId}`, x1 + w / 2, ROW_Y + ROW_H / 2);
    }
  }

  // ── Time axis ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#4C566A'; // Nord3
  ctx.fillRect(0, AXIS_Y, W, 1);

  const tickStep  = simTime > WINDOW_SECS ? 5 : 2;
  const firstTick = Math.ceil(t0 / tickStep) * tickStep;

  ctx.font = '9px monospace';
  ctx.textBaseline = 'top';

  for (let t = firstTick; t <= simTime + tickStep; t += tickStep) {
    const x = (t - t0) * scale;
    if (x < 0 || x > W) continue;

    ctx.fillStyle = '#4C566A';
    ctx.fillRect(x, AXIS_Y, 1, 4);

    ctx.fillStyle = '#D8DEE9';
    ctx.textAlign = 'center';
    ctx.fillText(`${t}s`, x, AXIS_Y + 5);
  }
}

/**
 * Sync canvas pixel buffer dimensions to its container via ResizeObserver.
 * @param {HTMLCanvasElement} canvas
 */
export function watchGanttSize(canvas) {
  const container = canvas.parentElement;
  const sync = () => {
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;
  };
  new ResizeObserver(sync).observe(container);
  sync();
}
