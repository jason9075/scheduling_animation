import { createScheduler, RRScheduler, STARVATION_LIMIT } from './scheduler.js';
import { renderGantt, watchGanttSize } from './gantt.js';

// ── State ─────────────────────────────────────────────────────────────────────
let sched       = createScheduler('FCFS');
let speed       = 1;
let paused      = false;
let lastTs      = /** @type {number|null} */ (null);
let currentAlgo = 'FCFS';

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
const factoryTotal   = $('factory-total');
const ganttCanvas    = /** @type {HTMLCanvasElement} */ ($('gantt-canvas'));
const mathModal      = $('math-modal');
const mathContent    = $('math-content');

// ── Gantt canvas ──────────────────────────────────────────────────────────────
watchGanttSize(ganttCanvas);

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderQueue() {
  queueListEl.innerHTML = '';
  for (const t of sched.readyQueue) {
    const div = document.createElement('div');
    div.className = 'task-block' + (t.waitTime >= STARVATION_LIMIT ? ' starving' : '');
    div.style.backgroundColor = t.color;
    div.innerHTML =
      `<div class="task-id">T${t.id}</div>` +
      `<div class="task-meta">` +
        `<span>Burst ${t.burstTime.toFixed(1)} s</span>` +
        `<span>Wait  ${t.waitTime.toFixed(1)} s</span>` +
      `</div>`;
    queueListEl.appendChild(div);
  }
  queueCountEl.textContent = `(${sched.readyQueue.length})`;
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
  const { completedTasks, simTime, busyTime, nextId } = sched;
  sDone.textContent          = completedTasks.length;
  simClockEl.textContent     = `T = ${simTime.toFixed(1)} s`;
  factoryTotal.textContent   = `Generated: ${nextId - 1}`;

  if (completedTasks.length > 0) {
    const totalWait = completedTasks.reduce((s, t) => s + t.waitTime, 0);
    sWait.textContent = `${(totalWait / completedTasks.length).toFixed(1)} s`;
  } else {
    sWait.textContent = '—';
  }
  sUtil.textContent = simTime > 0 ? `${(busyTime / simTime * 100).toFixed(0)}%` : '—';
  sTput.textContent = simTime > 0 ? `${(completedTasks.length / simTime).toFixed(2)}/s` : '—';

  if (!paused) {
    factoryIconEl.classList.add('spinning');
    factoryIconEl.style.animationDuration = `${Math.max(0.2, 1 / speed).toFixed(2)}s`;
  } else {
    factoryIconEl.classList.remove('spinning');
  }
}

function updateUI() {
  renderQueue();
  renderCPU();
  renderStats();
  renderGantt(ganttCanvas, sched);
}

// ── Animation loop ────────────────────────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);
  if (!lastTs) { lastTs = now; return; }
  const realDt = Math.min((now - lastTs) / 1000, 0.1);
  lastTs = now;
  if (!paused) sched.tick(realDt * speed);
  updateUI();
}

// ── Algorithm switching ───────────────────────────────────────────────────────
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
  $('quantum-group').hidden = algo !== 'RR';
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

$('arrival-slider').addEventListener('input', (e) => {
  const v = parseFloat(/** @type {HTMLInputElement} */ (e.target).value);
  sched.arrivalRate = v;
  $('arrival-val').textContent = `${v.toFixed(1)}/s`;
});

$('quantum-slider').addEventListener('input', (e) => {
  const v = parseFloat(/** @type {HTMLInputElement} */ (e.target).value);
  if (sched instanceof RRScheduler) sched.timeQuantum = v;
  $('quantum-val').textContent = `${v.toFixed(1)} s`;
});

$('btn-reset').addEventListener('click', () => {
  switchAlgo(currentAlgo); // recreates scheduler, preserving rate/quantum
  paused = false;
  /** @type {HTMLButtonElement} */ ($('btn-pause')).textContent = 'Pause';
  updateUI();
});

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

// ── Kick off ──────────────────────────────────────────────────────────────────
requestAnimationFrame(loop);
