export const TASK_COLORS = [
  '#88C0D0', // Nord8  — blue
  '#A3BE8C', // Nord14 — green
  '#EBCB8B', // Nord13 — yellow
  '#D08770', // Nord12 — orange
  '#B48EAD', // Nord15 — purple
  '#8FBCBB', // Nord7  — teal
  '#81A1C1', // Nord9  — slate-blue
  '#BF616A', // Nord11 — red
];

export const STARVATION_LIMIT = 15; // sim-seconds
export const MAX_TASKS = 12;       // producer hard stop

// ── Task model ────────────────────────────────────────────────────────────────

export class Task {
  /** @param {number} id @param {number} simTime */
  constructor(id, simTime) {
    this.id = id;
    this.burstTime = +(Math.random() * 8 + 2).toFixed(1); // 2.0 – 10.0 s
    this.remainingTime = this.burstTime;
    this.arrivalTime = simTime;
    this.waitTime = 0;
    this.color = TASK_COLORS[(id - 1) % TASK_COLORS.length];
    this.priority = Math.ceil(Math.random() * 5); // 1 = highest, 5 = lowest
    this.level = 0;                                // MLFQ queue level (0–2)
  }
}

// ── Base scheduler ────────────────────────────────────────────────────────────

export class BaseScheduler {
  constructor() {
    this.readyQueue      = /** @type {Task[]}    */ ([]);
    this.currentTask     = /** @type {Task|null} */ (null);
    this.completedTasks  = /** @type {Task[]}    */ ([]);
    this.contextSwitches = 0;
    this.simTime   = 0;
    this.busyTime  = 0;
    this.nextId    = 1;
    this.taskCap   = MAX_TASKS; // producer stops here; can be raised via spawn
    this._prodAccum = 0;
    this.arrivalRate = 1; // tasks / sim-second
    /** @type {{ taskId:number, color:string, start:number, end:number }[]} */
    this.ganttLog  = [];
    this._segStart = /** @type {number|null} */ (null);
  }

  /** Advance the simulation by `dt` sim-seconds. */
  tick(dt) {
    this.simTime += dt;
    this._runProducer(dt);
    this._accrueWait(dt);
    this._execute(dt);  // run current task first (may complete it)
    this._dispatch();   // pick next if CPU is free
  }

  _runProducer(dt) {
    if (this.nextId > this.taskCap) return;
    this._prodAccum += dt;
    const interval = 1 / this.arrivalRate;
    while (this._prodAccum >= interval && this.nextId <= this.taskCap) {
      this._prodAccum -= interval;
      this.readyQueue.push(new Task(this.nextId++, this.simTime));
    }
  }

  _accrueWait(dt) {
    for (const t of this.readyQueue) t.waitTime += dt;
  }

  /** Give the CPU to a task and record when the segment started. */
  _assignCPU(task) {
    this.currentTask = task;
    this._segStart   = this.simTime;
    this.contextSwitches++;
  }

  /**
   * Remove the current task from the CPU and log the completed segment.
   * The caller is responsible for pushing the task to the queue or completed list.
   */
  _evictCPU() {
    if (this.currentTask && this._segStart !== null) {
      this.ganttLog.push({
        taskId: this.currentTask.id,
        color:  this.currentTask.color,
        start:  this._segStart,
        end:    this.simTime,
      });
    }
    this.currentTask = null;
    this._segStart   = null;
  }

  _execute(dt) {
    if (!this.currentTask) return;
    this.currentTask.remainingTime -= dt;
    this.busyTime += dt;
    if (this.currentTask.remainingTime <= 0) {
      this.currentTask.remainingTime = 0;
      const done = this.currentTask;
      this._evictCPU(); // records gantt segment, clears currentTask
      this.completedTasks.push(done);
      this._onTaskComplete(done);
    }
  }

  /** Hook called when a task finishes. Override in subclasses if needed. */
  _onTaskComplete(_task) {}

  /** Default dispatch: FIFO. */
  _dispatch() {
    if (this.currentTask || this.readyQueue.length === 0) return;
    this._assignCPU(this.readyQueue.shift());
  }
}

// ── FCFS ──────────────────────────────────────────────────────────────────────

export class FCFSScheduler extends BaseScheduler {}

// ── SJF (non-preemptive) ──────────────────────────────────────────────────────

export class SJFScheduler extends BaseScheduler {
  /** Pick the task with the smallest burst time. */
  _dispatch() {
    if (this.currentTask || this.readyQueue.length === 0) return;
    let minIdx = 0;
    for (let i = 1; i < this.readyQueue.length; i++) {
      if (this.readyQueue[i].burstTime < this.readyQueue[minIdx].burstTime) minIdx = i;
    }
    this._assignCPU(this.readyQueue.splice(minIdx, 1)[0]);
  }
}

// ── Round Robin ───────────────────────────────────────────────────────────────

export class RRScheduler extends BaseScheduler {
  constructor() {
    super();
    this.timeQuantum   = 2.0;
    this._quantumAccum = 0;
  }

  tick(dt) {
    this.simTime += dt;
    this._runProducer(dt);
    this._accrueWait(dt);
    this._execute(dt);      // may complete the task
    this._checkQuantum(dt); // if still running, check quantum expiry
    this._dispatch();
  }

  _checkQuantum(dt) {
    if (!this.currentTask) return;
    this._quantumAccum += dt;
    if (this._quantumAccum >= this.timeQuantum) {
      const preempted = this.currentTask;
      this._evictCPU();
      this.readyQueue.push(preempted); // back to end of queue
      this.contextSwitches++;
      this._quantumAccum = 0;
    }
  }

  _onTaskComplete(_task) {
    this._quantumAccum = 0; // reset so the next task gets a fresh quantum
  }
}

// ── SRTF (Shortest Remaining Time First — preemptive SJF) ────────────────────

export class SRTFScheduler extends BaseScheduler {
  tick(dt) {
    this.simTime += dt;
    this._runProducer(dt);
    this._accrueWait(dt);
    this._execute(dt);
    this._preemptCheck(); // may evict current if a shorter task arrived
    this._dispatch();
  }

  _preemptCheck() {
    if (!this.currentTask || this.readyQueue.length === 0) return;
    let minRemaining = Infinity;
    for (const t of this.readyQueue) {
      if (t.remainingTime < minRemaining) minRemaining = t.remainingTime;
    }
    if (minRemaining < this.currentTask.remainingTime) {
      const task = this.currentTask;
      this._evictCPU();
      this.readyQueue.push(task);
      this.contextSwitches++;
    }
  }

  _dispatch() {
    if (this.currentTask || this.readyQueue.length === 0) return;
    let minIdx = 0;
    for (let i = 1; i < this.readyQueue.length; i++) {
      if (this.readyQueue[i].remainingTime < this.readyQueue[minIdx].remainingTime) minIdx = i;
    }
    this._assignCPU(this.readyQueue.splice(minIdx, 1)[0]);
  }
}

// ── Priority (non-preemptive) ─────────────────────────────────────────────────

export class PriorityScheduler extends BaseScheduler {
  /** Pick the task with the lowest priority number (1 = most urgent). */
  _dispatch() {
    if (this.currentTask || this.readyQueue.length === 0) return;
    let bestIdx = 0;
    for (let i = 1; i < this.readyQueue.length; i++) {
      if (this.readyQueue[i].priority < this.readyQueue[bestIdx].priority) bestIdx = i;
    }
    this._assignCPU(this.readyQueue.splice(bestIdx, 1)[0]);
  }
}

// ── MLFQ (Multi-Level Feedback Queue) ────────────────────────────────────────

export class MLFQScheduler extends BaseScheduler {
  constructor() {
    super();
    this.quantums      = [1.0, 2.0, Infinity]; // Q0 / Q1 / Q2 (FCFS)
    this._quantumAccum = 0;
    this._currentLevel = 0;
  }

  tick(dt) {
    this.simTime += dt;
    this._runProducer(dt);
    this._accrueWait(dt);
    this._execute(dt);
    this._checkQuantum(dt);
    this._dispatch();
  }

  _runProducer(dt) {
    if (this.nextId > this.taskCap) return;
    this._prodAccum += dt;
    const interval = 1 / this.arrivalRate;
    while (this._prodAccum >= interval && this.nextId <= this.taskCap) {
      this._prodAccum -= interval;
      const task = new Task(this.nextId++, this.simTime);
      task.level = 0; // every new task enters at Q0
      this.readyQueue.push(task);
    }
  }

  _checkQuantum(dt) {
    if (!this.currentTask) return;
    const q = this.quantums[this._currentLevel];
    if (!isFinite(q)) return; // Q2 is FCFS — no preemption
    this._quantumAccum += dt;
    if (this._quantumAccum >= q) {
      const task = this.currentTask;
      this._evictCPU();
      task.level = Math.min(task.level + 1, 2); // demote one level
      this.readyQueue.push(task);
      this.contextSwitches++;
      this._quantumAccum = 0;
    }
  }

  _onTaskComplete(_task) {
    this._quantumAccum = 0;
  }

  /** Always pick from the highest-priority (lowest-numbered) non-empty sub-queue. */
  _dispatch() {
    if (this.currentTask || this.readyQueue.length === 0) return;
    let bestIdx = 0;
    for (let i = 1; i < this.readyQueue.length; i++) {
      if (this.readyQueue[i].level < this.readyQueue[bestIdx].level) bestIdx = i;
    }
    this._currentLevel = this.readyQueue[bestIdx].level;
    this._quantumAccum = 0;
    this._assignCPU(this.readyQueue.splice(bestIdx, 1)[0]);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * @param {'FCFS'|'SJF'|'RR'|'SRTF'|'Priority'|'MLFQ'} algo
 * @param {{ arrivalRate?: number, timeQuantum?: number }} opts
 * @returns {BaseScheduler}
 */
export function createScheduler(algo, opts = {}) {
  let s;
  switch (algo) {
    case 'SJF':      s = new SJFScheduler();      break;
    case 'RR':       s = new RRScheduler();        break;
    case 'SRTF':     s = new SRTFScheduler();      break;
    case 'Priority': s = new PriorityScheduler();  break;
    case 'MLFQ':     s = new MLFQScheduler();      break;
    default:         s = new FCFSScheduler();       break;
  }
  if (opts.arrivalRate != null) s.arrivalRate = opts.arrivalRate;
  if (opts.timeQuantum != null && s instanceof RRScheduler) s.timeQuantum = opts.timeQuantum;
  return s;
}
