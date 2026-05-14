/**
 * Single-row execution timeline renderer.
 * Pass `viewEnd` (sim-seconds) to control which time window is displayed.
 * When viewEnd === sched.simTime the view is "live" (auto-following).
 */

export const WINDOW_SECS = 30;
const ROW_Y  = 4;
const ROW_H  = 26;
const AXIS_Y = ROW_Y + ROW_H + 3;
const SB_H   = 4; // mini scrollbar height at very bottom

/**
 * @param {HTMLCanvasElement} canvas
 * @param {import('./scheduler.js').BaseScheduler} sched
 * @param {number} viewEnd  — right edge of the displayed window in sim-seconds
 */
export function renderGantt(canvas, sched, viewEnd) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  if (W === 0 || H === 0) return;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#434C5E'; // Nord2
  ctx.fillRect(0, 0, W, H);

  const { ganttLog, currentTask, _segStart, simTime } = sched;
  const t0    = Math.max(0, viewEnd - WINDOW_SECS);
  const scale = W / WINDOW_SECS;
  const isLive = Math.abs(viewEnd - simTime) < 0.1;

  // ── Segments ────────────────────────────────────────────────────────────────
  /** @type {{ taskId:number, color:string, start:number, end:number, active?:boolean }[]} */
  const segs = ganttLog.filter((s) => s.end > t0 && s.start < viewEnd);

  // Ongoing segment: only visible in live mode (or if it started before viewEnd)
  if (currentTask && _segStart !== null && _segStart < viewEnd) {
    segs.push({
      taskId: currentTask.id,
      color:  currentTask.color,
      start:  _segStart,
      end:    Math.min(simTime, viewEnd),
      active: isLive,
    });
  }

  for (const seg of segs) {
    const x1 = Math.max(0, (seg.start - t0) * scale);
    const x2 = Math.min(W, (seg.end   - t0) * scale);
    const w  = x2 - x1;
    if (w < 0.5) continue;

    if (seg.active) {
      const grad = ctx.createLinearGradient(x1, 0, x2, 0);
      grad.addColorStop(0,   seg.color);
      grad.addColorStop(0.7, seg.color);
      grad.addColorStop(1,   seg.color + 'AA');
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = seg.color;
    }
    ctx.fillRect(x1, ROW_Y, w, ROW_H);

    ctx.fillStyle = '#2E3440';
    ctx.fillRect(Math.min(x2 - 1, W - 1), ROW_Y, 1, ROW_H);

    if (w >= 18) {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`T${seg.taskId}`, x1 + w / 2, ROW_Y + ROW_H / 2);
    }
  }

  // ── Time axis ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#4C566A';
  ctx.fillRect(0, AXIS_Y, W, 1);

  const tickStep  = viewEnd > WINDOW_SECS ? 5 : 2;
  const firstTick = Math.ceil(t0 / tickStep) * tickStep;

  ctx.font = '9px monospace';
  ctx.textBaseline = 'top';

  for (let t = firstTick; t <= viewEnd + tickStep; t += tickStep) {
    const x = (t - t0) * scale;
    if (x < 0 || x > W) continue;
    ctx.fillStyle = '#4C566A';
    ctx.fillRect(x, AXIS_Y, 1, 4);
    ctx.fillStyle = '#D8DEE9';
    ctx.textAlign = 'center';
    ctx.fillText(`${t}s`, x, AXIS_Y + 5);
  }

  // ── Mini scrollbar (only when there's history to scroll through) ──────────
  if (simTime > WINDOW_SECS) {
    const sbY = H - SB_H;
    ctx.fillStyle = '#3B4252'; // Nord1 track
    ctx.fillRect(0, sbY, W, SB_H);

    const thumbX = Math.max(0, (t0 / simTime) * W);
    const thumbW = Math.max(6, (WINDOW_SECS / simTime) * W);
    ctx.fillStyle = isLive ? '#88C0D0' : '#81A1C1'; // Nord8 live, Nord9 history
    ctx.fillRect(thumbX, sbY, Math.min(thumbW, W - thumbX), SB_H);
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
