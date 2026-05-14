// Nord task palette — 8 distinct colours cycling per task ID
const COLORS = [
  '#88C0D0', // Nord8  — blue
  '#A3BE8C', // Nord14 — green
  '#EBCB8B', // Nord13 — yellow
  '#D08770', // Nord12 — orange
  '#B48EAD', // Nord15 — purple
  '#8FBCBB', // Nord7  — teal
  '#81A1C1', // Nord9  — slate-blue
  '#BF616A', // Nord11 — red
];

// Tasks waiting longer than this (sim-seconds) turn red
const STARVATION_LIMIT = 15;

// ── Data model ────────────────────────────────────────────────────────────────

class Task {
  /** @param {number} id @param {number} simTime */
  constructor(id, simTime) {
    this.id = id;
    this.burstTime = +(Math.random() * 8 + 2).toFixed(1); // 2.0 – 10.0 s
    this.remainingTime = this.burstTime;
    this.arrivalTime = simTime;
    this.waitTime = 0;
    this.color = COLORS[(id - 1) % COLORS.length];
  }
}

// ── Scheduler (FCFS — Phase 1) ────────────────────────────────────────────────

class FCFSScheduler {
  constructor() {
    this.readyQueue    = /** @type {Task[]}      */ ([]);
    this.currentTask   = /** @type {Task|null}   */ (null);
    this.completedTasks = /** @type {Task[]}     */ ([]);
    this.contextSwitches = 0;
    this.simTime   = 0;
    this.busyTime  = 0;
    this.nextId    = 1;
    this._prodAccum = 0;
    this.arrivalRate = 1; // tasks / sim-second
  }

  /** Advance simulation by `dt` sim-seconds. */
  tick(dt) {
    this.simTime += dt;

    // Producer: emit tasks at configured rate
    this._prodAccum += dt;
    const interval = 1 / this.arrivalRate;
    while (this._prodAccum >= interval) {
      this._prodAccum -= interval;
      this.readyQueue.push(new Task(this.nextId++, this.simTime));
    }

    // Accrue wait time for every queued task
    for (const t of this.readyQueue) t.waitTime += dt;

    // FCFS: non-preemptive — dispatch only when CPU is free
    if (!this.currentTask && this.readyQueue.length > 0) {
      this.currentTask = this.readyQueue.shift();
      this.contextSwitches++;
    }

    // Execute current task
    if (this.currentTask) {
      this.currentTask.remainingTime -= dt;
      this.busyTime += dt;
      if (this.currentTask.remainingTime <= 0) {
        this.currentTask.remainingTime = 0;
        this.completedTasks.push(this.currentTask);
        this.currentTask = null;
      }
    }
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = /** @param {string} id */ (id) => document.getElementById(id);

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
const mathModal      = $('math-modal');
const mathContent    = $('math-content');

// ── Simulation state ──────────────────────────────────────────────────────────

const sched = new FCFSScheduler();
let speed  = 1;
let paused = false;
let lastTs = /** @type {number|null} */ (null);

// ── UI renderers ──────────────────────────────────────────────────────────────

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
    cpuTaskIdEl.style.color   = 'rgba(0,0,0,0.8)';
    cpuTaskIdEl.textContent   = `T${t.id}`;
    cpuRemainingEl.style.color = 'rgba(0,0,0,0.55)';
    cpuRemainingEl.textContent = `${t.remainingTime.toFixed(1)} s left`;
    const pct = (t.burstTime - t.remainingTime) / t.burstTime * 100;
    cpuBarEl.style.width = `${pct.toFixed(1)}%`;
  } else {
    cpuSlotEl.classList.remove('busy');
    cpuSlotEl.style.backgroundColor = '';
    cpuTaskIdEl.style.color   = 'var(--nord4)';
    cpuTaskIdEl.textContent   = 'Idle';
    cpuRemainingEl.style.color = 'var(--nord3)';
    cpuRemainingEl.textContent = '—';
    cpuBarEl.style.width = '0%';
  }
  ctxEl.textContent = `Context Switches: ${sched.contextSwitches}`;
}

function renderStats() {
  const { completedTasks, simTime, busyTime, nextId } = sched;

  sDone.textContent    = completedTasks.length;
  simClockEl.textContent = `T = ${simTime.toFixed(1)} s`;
  factoryTotal.textContent = `Generated: ${nextId - 1}`;

  if (completedTasks.length > 0) {
    const totalWait = completedTasks.reduce((s, t) => s + t.waitTime, 0);
    sWait.textContent = `${(totalWait / completedTasks.length).toFixed(1)} s`;
  } else {
    sWait.textContent = '—';
  }

  sUtil.textContent = simTime > 0 ? `${(busyTime / simTime * 100).toFixed(0)}%` : '—';
  sTput.textContent = simTime > 0 ? `${(completedTasks.length / simTime).toFixed(2)}/s` : '—';

  // Spin the factory icon proportional to speed
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
}

// ── Animation loop ────────────────────────────────────────────────────────────

function loop(now) {
  requestAnimationFrame(loop);
  if (!lastTs) { lastTs = now; return; }
  const realDt = Math.min((now - lastTs) / 1000, 0.1); // cap to avoid huge jumps
  lastTs = now;
  if (!paused) sched.tick(realDt * speed);
  updateUI();
}

// ── Controls ──────────────────────────────────────────────────────────────────

$('btn-pause').addEventListener('click', (e) => {
  paused = !paused;
  /** @type {HTMLButtonElement} */ (e.target).textContent = paused ? 'Resume' : 'Pause';
});

// Step always advances 0.5 sim-seconds; most useful when paused
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

$('btn-reset').addEventListener('click', () => {
  const rate = sched.arrivalRate;
  Object.assign(sched, new FCFSScheduler());
  sched.arrivalRate = rate; // preserve the slider value
  paused = false;
  /** @type {HTMLButtonElement} */ ($('btn-pause')).textContent = 'Pause';
  lastTs = null;
  updateUI();
});

// ── Math modal ────────────────────────────────────────────────────────────────

let modalLang = 'en';

const MODAL = {
  en: `
<p><strong>FCFS — First Come, First Served</strong></p>
<p>Tasks are dispatched in arrival order. The wait time of the $i$-th task equals the total burst time of all tasks that arrived before it:</p>
<p>$$W_i = \\sum_{j=1}^{i-1} B_j$$</p>
<p>Average wait time across $n$ completed tasks:</p>
<p>$$\\bar{W} = \\frac{1}{n}\\sum_{i=1}^{n} W_i$$</p>
<p><strong>Convoy Effect</strong> — one long task with large $B_j$ forces every shorter task behind it to wait, inflating $\\bar{W}$ significantly. This is FCFS's primary weakness.</p>
<p>CPU utilisation measures the fraction of elapsed time the CPU spent executing:</p>
<p>$$U = \\frac{T_{\\text{busy}}}{T_{\\text{elapsed}}}$$</p>
  `,
  zhTW: `
<p><strong>FCFS — 先來先服務</strong></p>
<p>任務依照抵達順序執行。第 $i$ 個任務的等待時間等於排在它前面所有任務的執行時間總和：</p>
<p>$$W_i = \\sum_{j=1}^{i-1} B_j$$</p>
<p>$n$ 個已完成任務的平均等待時間：</p>
<p>$$\\bar{W} = \\frac{1}{n}\\sum_{i=1}^{n} W_i$$</p>
<p><strong>護送效應（Convoy Effect）</strong>——一個執行時間很長的任務（$B_j \\gg 0$）會把後面所有較短的任務全部擋住，大幅拉高 $\\bar{W}$，這是 FCFS 最主要的缺點。</p>
<p>CPU 利用率代表模擬期間 CPU 實際忙碌的時間比例：</p>
<p>$$U = \\frac{T_{\\text{忙碌}}}{T_{\\text{已過}}}$$</p>
  `,
};

function renderModal() {
  mathContent.innerHTML = MODAL[modalLang];
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
