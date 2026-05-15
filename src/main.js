import { createScheduler, RRScheduler, MLFQScheduler, STARVATION_LIMIT, MAX_TASKS } from './scheduler.js';
import { renderGantt, watchGanttSize, WINDOW_SECS } from './gantt.js';

// ── State ─────────────────────────────────────────────────────────────────────
let sched          = createScheduler('FCFS');
let speed          = 1;
let paused         = false;
let lastTs         = /** @type {number|null} */ (null);
let currentAlgo    = 'FCFS';
let ganttViewEnd   = /** @type {number|null} */ (null); // null = live (auto-follow)
let ganttDragStart = /** @type {{ x:number, ve:number }|null} */ (null);

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const queueListEl    = $('queue-list');
const queueCountEl   = $('queue-count');
const cpuSlotEl      = $('cpu-slot');
const cpuTaskIdEl    = $('cpu-task-id');
const cpuRemainingEl = $('cpu-remaining');
const cpuBarEl       = $('cpu-bar');
const ctxEl          = $('ctx-switches');
const simClockEl     = $('sim-clock');
const sDone          = $('s-done');
const sWait          = $('s-wait');
const sUtil          = $('s-util');
const sTput          = $('s-tput');
const factoryIconEl  = $('factory-icon');
const factoryLabelEl = $('factory-label');
const factoryTotal   = $('factory-total');
const btnSpawn       = $('btn-spawn');
const btnProdOne     = $('btn-prod-one');
const btnProdAuto    = $('btn-prod-auto');
const btnProdStop    = $('btn-prod-stop');
const intervalSlider = /** @type {HTMLInputElement} */ ($('interval-slider'));
const intervalVal    = $('interval-val');
const ganttCanvas     = /** @type {HTMLCanvasElement} */ ($('gantt-canvas'));
const btnGanttLive    = $('btn-gantt-live');
const mathModal      = $('math-modal');
const mathContent    = $('math-content');
const logModal       = $('log-modal');
const logSummary     = $('log-summary');
const logContent     = $('log-content');
const sMissedEl      = $('s-missed');
const sMissedCountEl = $('s-missed-count');
const tooltipEl      = $('tooltip');

// ── Gantt canvas ──────────────────────────────────────────────────────────────
watchGanttSize(ganttCanvas);

// ── Rendering ─────────────────────────────────────────────────────────────────
/** Build a task block element with progress overlay. */
function makeTaskEl(t, extraClass = '') {
  const isCurrent  = extraClass.includes('current');
  const isStarving = extraClass.includes('starving');
  const pct = ((t.burstTime - t.remainingTime) / t.burstTime * 100).toFixed(1);

  // Priority badge (Priority algo only)
  const showPriority = currentAlgo === 'Priority';
  const priorityBadge = showPriority
    ? `<span class="priority-badge p${t.priority}" title="Priority ${t.priority}">${t.priority}</span>`
    : '';

  // MLFQ level tag on current task
  const levelTag = (currentAlgo === 'MLFQ' && isCurrent && t.level != null)
    ? ` <span class="mlfq-level-tag">Q${t.level}</span>`
    : '';

  // Meta lines vary by algorithm
  let metaLine1, metaLine2;
  if (currentAlgo === 'EDF') {
    // EDF: left/wait + deadline (no idle line — deadline is the relevant urgency signal)
    metaLine1 = isCurrent
      ? `Left  ${t.remainingTime.toFixed(1)} s`
      : `Wait  ${t.waitTime.toFixed(1)} s`;
    if (t._deadlineMissed) {
      const overdue = Math.max(0, sched.simTime - t.deadline).toFixed(1);
      const tip = `截止時間：${t.deadline.toFixed(1)} s\n已逾期 ${overdue} s`;
      metaLine2 = `<span style="color:var(--nord11);font-weight:700" data-tooltip="${tip}">MISSED</span>`;
    } else {
      metaLine2 = `DL: ${t.deadline.toFixed(1)} s`;
    }
  } else {
    metaLine1 = `Burst ${t.burstTime.toFixed(1)} s`;
    if (isCurrent) {
      metaLine2 = `Left  ${t.remainingTime.toFixed(1)} s`;
    } else if (currentAlgo === 'HRRN') {
      const r = (t.waitTime + t.burstTime) / t.burstTime;
      metaLine2 = `R: ${r.toFixed(2)}  Idle ${t.idleTime.toFixed(1)} s`;
    } else if (currentAlgo === 'Lottery') {
      metaLine2 = `🎟 ${t.tickets}  Idle ${t.idleTime.toFixed(1)} s`;
    } else {
      metaLine2 = `W ${t.waitTime.toFixed(1)}  I ${t.idleTime.toFixed(1)} s`;
    }
  }

  const div = document.createElement('div');
  div.className = ('task-block ' + extraClass).trim();
  div.style.backgroundColor = t.color;
  div.innerHTML =
    `<div class="task-bar" style="width:${pct}%"></div>` +
    `${priorityBadge}` +
    `<div class="task-id">${isCurrent ? '▶ ' : ''}T${t.id}${levelTag}</div>` +
    `<div class="task-meta">` +
      `<span>${metaLine1}</span>` +
      `<span>${metaLine2}</span>` +
    `</div>` +
    (isStarving && currentAlgo !== 'EDF'
      ? `<span class="starve-icon" data-tooltip="上次執行後空閒 ${t.idleTime.toFixed(1)} s\n飢餓警戒線：${STARVATION_LIMIT} s">!</span>`
      : '');
  return div;
}

const MLFQ_LABELS = ['Q0 · q=1 s', 'Q1 · q=2 s', 'Q2 · FCFS'];

function appendDivider() {
  const sep = document.createElement('div');
  sep.className = 'queue-divider';
  queueListEl.appendChild(sep);
}

function appendQueueHeader(label) {
  const h = document.createElement('div');
  h.className = 'mlfq-header';
  h.textContent = label;
  queueListEl.appendChild(h);
}

function renderQueue() {
  queueListEl.innerHTML = '';

  // ── Currently executing task (always at top, highlighted) ─────────────────
  if (sched.currentTask) {
    queueListEl.appendChild(makeTaskEl(sched.currentTask, 'current'));
    if (sched.readyQueue.length > 0) appendDivider();
  }

  // ── Waiting tasks ──────────────────────────────────────────────────────────
  if (sched instanceof MLFQScheduler) {
    // Group by MLFQ level (Q0 → Q1 → Q2)
    for (let lvl = 0; lvl < 3; lvl++) {
      const tasks = sched.readyQueue.filter((t) => t.level === lvl);
      if (tasks.length === 0) continue;
      appendQueueHeader(MLFQ_LABELS[lvl]);
      for (const t of tasks) {
        queueListEl.appendChild(makeTaskEl(t, t.idleTime >= STARVATION_LIMIT ? 'starving' : ''));
      }
    }
  } else {
    for (const t of sched.readyQueue) {
      let extra = '';
      if (currentAlgo === 'EDF') {
        extra = t._deadlineMissed ? 'deadline-missed' : '';
      } else {
        extra = t.idleTime >= STARVATION_LIMIT ? 'starving' : '';
      }
      queueListEl.appendChild(makeTaskEl(t, extra));
    }
  }

  const total = (sched.currentTask ? 1 : 0) + sched.readyQueue.length;
  queueCountEl.textContent = `(${total})`;
}

function renderCPU() {
  const t = sched.currentTask;
  if (t) {
    cpuSlotEl.classList.add('busy');
    cpuSlotEl.style.backgroundColor = t.color;
    cpuTaskIdEl.style.color    = 'rgba(0,0,0,0.8)';
    cpuTaskIdEl.textContent    = `T${t.id}`;
    cpuRemainingEl.style.color = 'rgba(0,0,0,0.55)';
    cpuRemainingEl.textContent = `${t.remainingTime.toFixed(1)} s left`;
    const pct = (t.burstTime - t.remainingTime) / t.burstTime * 100;
    cpuBarEl.style.width = `${pct.toFixed(1)}%`;
  } else {
    cpuSlotEl.classList.remove('busy');
    cpuSlotEl.style.backgroundColor = '';
    cpuTaskIdEl.style.color    = 'var(--nord4)';
    cpuTaskIdEl.textContent    = 'Idle';
    cpuRemainingEl.style.color = 'var(--nord3)';
    cpuRemainingEl.textContent = '—';
    cpuBarEl.style.width = '0%';
  }
  ctxEl.textContent = `Context Switches: ${sched.contextSwitches}`;
}

function renderStats() {
  const { completedTasks, simTime, busyTime } = sched;
  const live    = sched.readyQueue.length + (sched.currentTask ? 1 : 0);
  const atLimit = live >= MAX_TASKS;

  sDone.textContent        = completedTasks.length;
  simClockEl.textContent   = `T = ${simTime.toFixed(1)} s`;
  factoryTotal.textContent = `${live} / ${MAX_TASKS}`;
  btnSpawn.hidden  = true; // no longer needed with concurrent cap
  btnProdOne.disabled = atLimit;

  if (atLimit) {
    factoryLabelEl.textContent = 'Waiting';
    factoryLabelEl.style.color = 'var(--nord13)';
  } else if (sched.producerStopped) {
    factoryLabelEl.textContent = 'Paused';
    factoryLabelEl.style.color = 'var(--nord13)';
  } else {
    factoryLabelEl.textContent = 'Running';
    factoryLabelEl.style.color = 'var(--nord14)';
  }

  if (completedTasks.length > 0) {
    const totalWait = completedTasks.reduce((s, t) => s + t.waitTime, 0);
    sWait.textContent = `${(totalWait / completedTasks.length).toFixed(1)} s`;
  } else {
    sWait.textContent = '—';
  }
  sUtil.textContent = simTime > 0 ? `${(busyTime / simTime * 100).toFixed(0)}%` : '—';
  sTput.textContent = simTime > 0 ? `${(completedTasks.length / simTime).toFixed(2)}/s` : '—';

  const missed = sched.missedDeadlines;
  sMissedEl.hidden = missed == null;
  if (missed != null) sMissedCountEl.textContent = missed;

  if (!paused && !atLimit && !sched.producerStopped) { // atLimit now = concurrent cap full
    factoryIconEl.classList.add('spinning');
    factoryIconEl.style.animationDuration = `${Math.max(0.2, 1 / speed).toFixed(2)}s`;
  } else {
    factoryIconEl.classList.remove('spinning');
  }
}

function renderLog() {
  if (logModal.hidden) return;

  const entries = sched.completionLog;
  if (entries.length === 0) {
    logSummary.innerHTML = '';
    logContent.innerHTML = '<p class="log-empty">No tasks completed yet.</p>';
    return;
  }

  // Summary bar
  const avgTA   = entries.reduce((s, e) => s + e.turnaround, 0) / entries.length;
  const avgWait = entries.reduce((s, e) => s + e.totalWait, 0) / entries.length;
  const maxIdleEver = Math.max(...entries.map((e) => e.maxIdle));
  logSummary.innerHTML =
    `<span>Completed: <b>${entries.length}</b></span>` +
    `<span>Avg turnaround: <b>${avgTA.toFixed(1)} s</b></span>` +
    `<span>Avg wait: <b>${avgWait.toFixed(1)} s</b></span>` +
    `<span>Peak idle: <b class="${maxIdleEver >= STARVATION_LIMIT ? 'log-warn' : ''}">${maxIdleEver.toFixed(1)} s</b></span>`;

  // Table rows (newest first)
  const rows = [...entries].reverse().map((e) => {
    const idleClass = e.maxIdle >= STARVATION_LIMIT ? ' class="log-warn"' : '';
    return `<tr>
      <td><span class="task-chip" style="background:${e.color}">T${e.id}</span></td>
      <td>${e.arrivedAt.toFixed(1)} s</td>
      <td>${e.completedAt.toFixed(1)} s</td>
      <td>${e.turnaround.toFixed(1)} s</td>
      <td>${e.burstTime.toFixed(1)} s</td>
      <td>${e.totalWait.toFixed(1)} s</td>
      <td${idleClass}>${e.maxIdle.toFixed(1)} s</td>
    </tr>`;
  }).join('');

  logContent.innerHTML =
    `<table class="log-table">
      <thead><tr>
        <th>Task</th>
        <th>Arrived</th>
        <th>Done</th>
        <th>Turnaround</th>
        <th>Burst</th>
        <th>Total Wait</th>
        <th>Max Idle</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function updateUI() {
  renderQueue();
  renderCPU();
  renderStats();
  renderLog();
  const ve = ganttViewEnd ?? sched.simTime;
  renderGantt(ganttCanvas, sched, ve);
}

// ── Gantt scroll / drag ───────────────────────────────────────────────────────

function clampGanttView(ve) {
  return Math.max(1, Math.min(ve, sched.simTime));
}

function setGanttView(ve) {
  const clamped = clampGanttView(ve);
  const isLive  = Math.abs(clamped - sched.simTime) < 0.1;
  ganttViewEnd  = isLive ? null : clamped;
  btnGanttLive.hidden = ganttViewEnd === null;
  ganttCanvas.style.cursor = ganttViewEnd === null ? 'default' : 'grab';
}

// Mouse wheel: scroll left = earlier history, scroll right = toward live
ganttCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const simPerPx = WINDOW_SECS / ganttCanvas.width;
  const delta    = e.deltaX !== 0 ? e.deltaX : e.deltaY;
  const current  = ganttViewEnd ?? sched.simTime;
  setGanttView(current - delta * simPerPx);
}, { passive: false });

// Drag-to-pan
ganttCanvas.addEventListener('mousedown', (e) => {
  ganttDragStart = { x: e.clientX, ve: ganttViewEnd ?? sched.simTime };
  ganttCanvas.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!ganttDragStart) return;
  const dx       = e.clientX - ganttDragStart.x;
  const simPerPx = WINDOW_SECS / ganttCanvas.width;
  setGanttView(ganttDragStart.ve - dx * simPerPx); // drag right = see earlier
});

window.addEventListener('mouseup', () => {
  if (!ganttDragStart) return;
  ganttDragStart = null;
  ganttCanvas.style.cursor = ganttViewEnd === null ? 'default' : 'grab';
});

// ── Global tooltip ────────────────────────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  const el = /** @type {Element|null} */ (document.elementFromPoint(e.clientX, e.clientY))
    ?.closest('[data-tooltip]');
  tooltipEl.hidden = !el;
  if (el) {
    tooltipEl.textContent = /** @type {HTMLElement} */ (el).dataset.tooltip ?? '';
    tooltipEl.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 250)}px`;
    tooltipEl.style.top  = `${Math.max(4, e.clientY - 40)}px`;
  }
});

// ── Animation loop ────────────────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);
  if (!lastTs) { lastTs = now; return; }
  const realDt = Math.min((now - lastTs) / 1000, 0.1);
  lastTs = now;
  if (!paused) sched.tick(realDt * speed);
  updateUI();
}

btnSpawn.addEventListener('click', () => {
  sched.taskCap += MAX_TASKS;
});

btnGanttLive.addEventListener('click', () => {
  ganttViewEnd = null;
  btnGanttLive.hidden = true;
  ganttCanvas.style.cursor = 'default';
});

// ── Algorithm switching ───────────────────────────────────────────────────────
function syncIntervalDisplay() {
  const interval = 1 / sched.arrivalRate;
  intervalSlider.value = String(Math.min(5, Math.max(0.3, interval)));
  intervalVal.textContent = `${interval.toFixed(1)} s`;
}

function switchAlgo(algo) {
  currentAlgo = algo;
  const opts = {
    arrivalRate: sched.arrivalRate,
    timeQuantum: sched instanceof RRScheduler
      ? sched.timeQuantum
      : parseFloat($('quantum-slider').value),
  };
  sched  = createScheduler(algo, opts);
  lastTs = null;
  ganttViewEnd = null;
  btnGanttLive.hidden = true;
  ganttCanvas.style.cursor = 'default';
  $('quantum-group').hidden = algo !== 'RR';
  // Reset producer buttons to Auto
  btnProdAuto.classList.add('active');
  btnProdStop.classList.remove('active');
  syncIntervalDisplay();
}

// ── Controls ──────────────────────────────────────────────────────────────────
$('algo-select').addEventListener('change', (e) => {
  switchAlgo(/** @type {HTMLSelectElement} */ (e.target).value);
});

$('btn-pause').addEventListener('click', (e) => {
  paused = !paused;
  /** @type {HTMLButtonElement} */ (e.target).textContent = paused ? 'Resume' : 'Pause';
});

$('btn-step').addEventListener('click', () => {
  sched.tick(0.5);
  updateUI();
});

document.querySelectorAll('.speed-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.speed-btn').forEach((b) => b.classList.remove('active'));
    const el = /** @type {HTMLElement} */ (e.target);
    el.classList.add('active');
    speed = parseFloat(el.dataset.spd);
  });
});

intervalSlider.addEventListener('input', () => {
  const interval = parseFloat(intervalSlider.value);
  sched.arrivalRate = 1 / interval;
  intervalVal.textContent = `${interval.toFixed(1)} s`;
});

btnProdOne.addEventListener('click', () => {
  sched.spawnOne();
  updateUI();
});

btnProdAuto.addEventListener('click', () => {
  sched.producerStopped = false;
  btnProdAuto.classList.add('active');
  btnProdStop.classList.remove('active');
});

btnProdStop.addEventListener('click', () => {
  sched.producerStopped = true;
  btnProdStop.classList.add('active');
  btnProdAuto.classList.remove('active');
});

$('quantum-slider').addEventListener('input', (e) => {
  const v = parseFloat(/** @type {HTMLInputElement} */ (e.target).value);
  if (sched instanceof RRScheduler) sched.timeQuantum = v;
  $('quantum-val').textContent = `${v.toFixed(1)} s`;
});

$('btn-reset').addEventListener('click', () => {
  switchAlgo(currentAlgo); // recreates scheduler, preserving rate/quantum
  ganttViewEnd = null;
  btnGanttLive.hidden = true;
  paused = false;
  /** @type {HTMLButtonElement} */ ($('btn-pause')).textContent = 'Pause';
  updateUI();
});

// Sync interval display once on load
syncIntervalDisplay();

// ── Math modal ────────────────────────────────────────────────────────────────
let modalLang = 'en';

const MODAL = {
  FCFS: {
    en: `
<p><strong>FCFS — First Come, First Served</strong></p>
<p>Tasks are dispatched in arrival order. The wait time of the $i$-th task equals the total burst of all earlier tasks:</p>
<p>$$W_i = \\sum_{j=1}^{i-1} B_j$$</p>
<p>Average: $\\bar{W} = \\frac{1}{n}\\sum_{i=1}^{n} W_i$</p>
<p><strong>Convoy Effect</strong> — one long task ($B_j \\gg 0$) forces every shorter task to wait, inflating $\\bar{W}$.</p>
    `,
    zhTW: `
<p><strong>FCFS — 先來先服務</strong></p>
<p>任務依照抵達順序執行。第 $i$ 個任務的等待時間等於前面所有任務的執行時間總和：</p>
<p>$$W_i = \\sum_{j=1}^{i-1} B_j$$</p>
<p>平均：$\\bar{W} = \\frac{1}{n}\\sum_{i=1}^{n} W_i$</p>
<p><strong>護送效應</strong>——一個長任務（$B_j \\gg 0$）會擋住後面所有短任務，大幅拉高 $\\bar{W}$。</p>
    `,
  },
  SJF: {
    en: `
<p><strong>SJF — Shortest Job First (non-preemptive)</strong></p>
<p>When the CPU becomes free, select the task with the minimum burst time:</p>
<p>$$\\text{next} = \\arg\\min_{i \\in \\text{queue}}\\, B_i$$</p>
<p>SJF achieves the minimum average wait time among all non-preemptive policies:</p>
<p>$$\\bar{W}_{\\text{SJF}} \\le \\bar{W}_{\\text{FCFS}}$$</p>
<p><strong>Starvation risk</strong> — long tasks may never run if short tasks keep arriving. This visualiser highlights them in red after ${15} s of waiting.</p>
    `,
    zhTW: `
<p><strong>SJF — 最短工作優先（非搶佔）</strong></p>
<p>CPU 空閒時，選擇佇列中執行時間最短的任務：</p>
<p>$$\\text{next} = \\arg\\min_{i \\in \\text{queue}}\\, B_i$$</p>
<p>在所有非搶佔策略中，SJF 的平均等待時間最低：</p>
<p>$$\\bar{W}_{\\text{SJF}} \\le \\bar{W}_{\\text{FCFS}}$$</p>
<p><strong>飢餓風險</strong>——若短任務持續湧入，長任務可能永遠等不到 CPU。本模擬器在等待超過 ${15} s 後會以紅色標示。</p>
    `,
  },
  RR: {
    en: `
<p><strong>Round Robin</strong></p>
<p>Each task gets a fixed time quantum $q$. If it does not finish within $q$, it is preempted and placed at the back of the queue.</p>
<p>Context switches per task: $\\left\\lceil B_i / q \\right\\rceil$</p>
<p>Maximum response time (first CPU access) for $n$ queued tasks:</p>
<p>$$R_{\\max} = (n - 1) \\cdot q$$</p>
<p>Trade-off: smaller $q$ → better response but higher context-switch overhead. Larger $q$ → approaches FCFS behaviour.</p>
    `,
    zhTW: `
<p><strong>Round Robin（輪轉排程）</strong></p>
<p>每個任務最多連續使用 CPU 時間量子 $q$，未完成則被搶佔並移到佇列尾端。</p>
<p>每個任務的 context switch 次數：$\\left\\lceil B_i / q \\right\\rceil$</p>
<p>佇列有 $n$ 個任務時，最長首次響應時間為：</p>
<p>$$R_{\\max} = (n - 1) \\cdot q$$</p>
<p>取捨：$q$ 越小響應越快，但 context switch 開銷越大；$q$ 越大則行為趨近 FCFS。</p>
    `,
  },
  SRTF: {
    en: `
<p><strong>SRTF — Shortest Remaining Time First (preemptive SJF)</strong></p>
<p>Whenever a new task arrives, compare its burst time against the current task's remaining time. If the newcomer is shorter, preempt immediately:</p>
<p>$$\\text{preempt if } \\exists\\, j \\in \\text{queue}: R_j < R_{\\text{running}}$$</p>
<p>SRTF achieves the theoretical minimum average wait time across <em>all</em> scheduling policies:</p>
<p>$$\\bar{W}_{\\text{SRTF}} \\le \\bar{W}_{\\text{any policy}}$$</p>
<p><strong>Cost</strong> — every preemption is a context switch, so total switches can be high. Long tasks face starvation if a stream of short tasks keeps arriving.</p>
    `,
    zhTW: `
<p><strong>SRTF — 最短剩餘時間優先（搶佔式 SJF）</strong></p>
<p>每當新任務抵達，比較其執行時間與當前任務的剩餘時間。若新任務更短，則立即搶佔：</p>
<p>$$\\text{若 } \\exists\\, j \\in \\text{queue}: R_j < R_{\\text{running}} \\text{，則搶佔}$$</p>
<p>SRTF 在所有排程策略中達到理論上最低的平均等待時間：</p>
<p>$$\\bar{W}_{\\text{SRTF}} \\le \\bar{W}_{\\text{任意策略}}$$</p>
<p><strong>代價</strong>——每次搶佔都是一次 context switch，總次數可能很高。若短任務持續湧入，長任務仍會飢餓。</p>
    `,
  },
  Priority: {
    en: `
<p><strong>Priority Scheduling (non-preemptive)</strong></p>
<p>When the CPU is free, select the task with the <em>lowest priority number</em> (1 = most urgent, 5 = least urgent):</p>
<p>$$\\text{next} = \\arg\\min_{i \\in \\text{queue}}\\, P_i$$</p>
<p>Ties are broken by arrival order (FCFS). The coloured badge on each task card shows its priority level: <span style="color:var(--nord11)">●</span> P1 → <span style="color:var(--nord12)">●</span> P2 → <span style="color:var(--nord13)">●</span> P3 → <span style="color:var(--nord14)">●</span> P4 → <span style="color:var(--nord9)">●</span> P5.</p>
<p><strong>Starvation</strong> — low-priority tasks (P4, P5) may wait indefinitely. The classic fix is <em>aging</em>: gradually raise a task's priority the longer it waits.</p>
    `,
    zhTW: `
<p><strong>優先權排程（非搶佔）</strong></p>
<p>CPU 空閒時，選擇優先權數字最小的任務（1 = 最緊急，5 = 最低優先）：</p>
<p>$$\\text{next} = \\arg\\min_{i \\in \\text{queue}}\\, P_i$$</p>
<p>優先權相同時依抵達順序（FCFS）決定。每張任務卡上的彩色數字徽章顯示其優先級：<span style="color:var(--nord11)">●</span> P1 → <span style="color:var(--nord12)">●</span> P2 → <span style="color:var(--nord13)">●</span> P3 → <span style="color:var(--nord14)">●</span> P4 → <span style="color:var(--nord9)">●</span> P5。</p>
<p><strong>飢餓問題</strong>——低優先權任務（P4、P5）可能永遠等不到 CPU。經典解法是 <em>老化（Aging）</em>：等待越久則自動調高優先權。</p>
    `,
  },
  HRRN: {
    en: `
<p><strong>HRRN — Highest Response Ratio Next</strong></p>
<p>Each time the CPU becomes free, compute the response ratio for every waiting task:</p>
<p>$$R_i = \\frac{W_i + B_i}{B_i}$$</p>
<p>where $W_i$ is accumulated wait time and $B_i$ is burst time. The task with the highest $R_i$ runs next.</p>
<p>When $W_i = 0$, $R_i = 1$ — pure SJF ordering. As a task waits longer its $R_i$ grows, so long tasks eventually win. <strong>Starvation is impossible.</strong></p>
<p>The live $R$ value is shown on each waiting task card so you can see why the scheduler picks its next victim.</p>
    `,
    zhTW: `
<p><strong>HRRN — 最高反應比優先</strong></p>
<p>每次 CPU 空閒時，計算佇列中每個任務的反應比：</p>
<p>$$R_i = \\frac{W_i + B_i}{B_i}$$</p>
<p>其中 $W_i$ 為已等待時間，$B_i$ 為執行時間。選取 $R_i$ 最高者執行。</p>
<p>當 $W_i = 0$ 時 $R_i = 1$，此時等同 SJF 排序。隨著等待時間增加，$R_i$ 持續上升，長任務最終必然獲得 CPU，<strong>不會發生飢餓</strong>。</p>
<p>每張等待中的任務卡上會即時顯示 $R$ 值，可直觀看出下一個被選中的原因。</p>
    `,
  },
  Lottery: {
    en: `
<p><strong>Lottery Scheduling</strong></p>
<p>Each task holds $k_i$ tickets. At each dispatch, one ticket is drawn at random:</p>
<p>$$P(\\text{task } i \\text{ wins}) = \\frac{k_i}{\\displaystyle\\sum_j k_j}$$</p>
<p>In this simulation each task is assigned 1–10 tickets randomly (shown on its card as 🎟). Transferring tickets between tasks lets you express proportional resource shares without strict determinism.</p>
<p><strong>Trade-off</strong> — the distribution converges to the ticket ratio over time, but short-run variance can cause jitter. A task with zero tickets never runs; otherwise starvation is probabilistically impossible.</p>
    `,
    zhTW: `
<p><strong>彩票排程</strong></p>
<p>每個任務持有 $k_i$ 張彩票。每次排程時隨機抽一張：</p>
<p>$$P(\\text{任務 } i \\text{ 中獎}) = \\frac{k_i}{\\displaystyle\\sum_j k_j}$$</p>
<p>本模擬中每個任務隨機分配 1–10 張彩票（顯示在任務卡的 🎟 圖示旁）。透過增減彩票可以直覺地表達比例化的資源分配。</p>
<p><strong>取捨</strong>——長期而言資源分配趨近彩票比例，但短期內有隨機波動。彩票為零的任務永遠不會執行；否則飢餓的機率趨近於零。</p>
    `,
  },
  MLFQ: {
    en: `
<p><strong>MLFQ — Multi-Level Feedback Queue</strong></p>
<p>Tasks start at queue level 0 (highest priority) and are demoted one level each time they exhaust their quantum:</p>
<p>$$\\text{level}_{i} \\leftarrow \\min(\\text{level}_{i} + 1,\\; 2) \\quad \\text{on quantum expiry}$$</p>
<table style="border-collapse:collapse;width:100%;margin:0.5rem 0;font-size:0.8rem">
  <tr style="color:var(--nord8)"><th style="text-align:left;padding:2px 6px">Level</th><th style="text-align:left;padding:2px 6px">Quantum</th><th style="text-align:left;padding:2px 6px">Policy</th></tr>
  <tr><td style="padding:2px 6px">Q0</td><td style="padding:2px 6px">1 s</td><td style="padding:2px 6px">Preemptive RR</td></tr>
  <tr><td style="padding:2px 6px">Q1</td><td style="padding:2px 6px">2 s</td><td style="padding:2px 6px">Preemptive RR</td></tr>
  <tr><td style="padding:2px 6px">Q2</td><td style="padding:2px 6px">∞</td><td style="padding:2px 6px">FCFS</td></tr>
</table>
<p>The scheduler always runs from the highest non-empty queue. Short/interactive tasks stay near Q0 for fast response; CPU-bound tasks sink to Q2 for efficiency — without any prior knowledge of burst times.</p>
    `,
    zhTW: `
<p><strong>MLFQ — 多級回饋佇列</strong></p>
<p>所有任務從 Q0（最高優先）進入。每次用完時間量子後降一級：</p>
<p>$$\\text{level}_{i} \\leftarrow \\min(\\text{level}_{i} + 1,\\; 2) \\quad \\text{（量子耗盡時）}$$</p>
<table style="border-collapse:collapse;width:100%;margin:0.5rem 0;font-size:0.8rem">
  <tr style="color:var(--nord8)"><th style="text-align:left;padding:2px 6px">層級</th><th style="text-align:left;padding:2px 6px">量子</th><th style="text-align:left;padding:2px 6px">策略</th></tr>
  <tr><td style="padding:2px 6px">Q0</td><td style="padding:2px 6px">1 s</td><td style="padding:2px 6px">搶佔式 RR</td></tr>
  <tr><td style="padding:2px 6px">Q1</td><td style="padding:2px 6px">2 s</td><td style="padding:2px 6px">搶佔式 RR</td></tr>
  <tr><td style="padding:2px 6px">Q2</td><td style="padding:2px 6px">∞</td><td style="padding:2px 6px">FCFS</td></tr>
</table>
<p>排程器永遠從最高層非空佇列取任務。短任務／互動型任務停在 Q0 享有快速響應；CPU 密集型任務沉降至 Q2 以減少切換開銷——無需預先知道執行時間。</p>
    `,
  },
  EDF: {
    en: `
<p><strong>EDF — Earliest Deadline First (preemptive)</strong></p>
<p>Each task has an absolute deadline $d_i$ assigned at arrival. The CPU always runs the task with the earliest deadline:</p>
<p>$$\\text{next} = \\arg\\min_{i}\\, d_i$$</p>
<p>EDF is preemptive: if a new task arrives with $d_j < d_{\\text{running}}$, it immediately takes the CPU.</p>
<p>In this simulation $d_i = A_i + B_i \\cdot (1 + U[0,2])$, giving each task a slack window of 0–2× its burst time. The deadline is shown on every task card; tasks that miss it get a dashed red border and a <strong style="color:var(--nord11)">MISSED</strong> label.</p>
<p><strong>Overload</strong> — once the system is overloaded ($\\sum B_i / (d_i - A_i) > 1$), EDF degrades ungracefully and a cascade of misses occurs. Watch the footer counter.</p>
    `,
    zhTW: `
<p><strong>EDF — 最早截止日優先（搶佔式）</strong></p>
<p>每個任務在抵達時被指定一個絕對截止時間 $d_i$。CPU 永遠執行截止時間最早的任務：</p>
<p>$$\\text{next} = \\arg\\min_{i}\\, d_i$$</p>
<p>EDF 為搶佔式：若新任務抵達且 $d_j < d_{\\text{running}}$，立即奪走 CPU。</p>
<p>本模擬中 $d_i = A_i + B_i \\cdot (1 + U[0,2])$，即每個任務有 0–2 倍執行時間的寬裕。截止時間顯示在任務卡上；錯過截止日的任務會顯示紅色虛線邊框與 <strong style="color:var(--nord11)">MISSED</strong> 標籤。</p>
<p><strong>過載</strong>——一旦系統超載（$\\sum B_i / (d_i - A_i) > 1$），EDF 會急劇惡化，引發連鎖截止失敗。可在頁面底部的計數器觀察。</p>
    `,
  },
};

function renderModal() {
  const copy = MODAL[currentAlgo] ?? MODAL['FCFS'];
  mathContent.innerHTML = copy[modalLang];
  if (window.renderMathInElement) {
    window.renderMathInElement(mathContent, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$',  right: '$',  display: false },
      ],
    });
  }
}

$('btn-math').addEventListener('click', () => { renderModal(); mathModal.hidden = false; });
$('close-modal').addEventListener('click', () => { mathModal.hidden = true; });
$('lang-toggle').addEventListener('click', () => {
  modalLang = modalLang === 'en' ? 'zhTW' : 'en';
  renderModal();
});

$('btn-log').addEventListener('click', () => { logModal.hidden = false; renderLog(); });
$('close-log-modal').addEventListener('click', () => { logModal.hidden = true; });
logModal.addEventListener('click', (e) => { if (e.target === logModal) logModal.hidden = true; });
mathModal.addEventListener('click', (e) => { if (e.target === mathModal) mathModal.hidden = true; });

// ── Kick off ──────────────────────────────────────────────────────────────────
requestAnimationFrame(loop);
