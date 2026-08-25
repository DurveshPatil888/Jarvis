import { fork } from 'child_process';
import { EventEmitter } from 'events';
import { POWERS_REGISTRY } from './src/powers.config.js';
import { COMMAND_REGISTRY } from './commandRegistry.js';
import { rememberFact } from "./src/utils/memoryStore.js";

const STATUS = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  AWAITING_QR: 'awaiting_qr', // worker is up but blocked on a QR scan (e.g. whatsapp-web.js)
  RUNNING: 'running',
  STOPPING: 'stopping',
  CRASHED: 'crashed',
};

const MAX_RESTARTS = 3; // cap auto-restarts so a broken worker doesn't infinite-loop

// Must stay comfortably ABOVE any worker's own internal shutdown timeout
// (e.g. whatsapp.worker.js's SHUTDOWN_TIMEOUT_MS = 6000). If this fires
// first, we SIGKILL the worker mid-cleanup, which is exactly how a
// graceful client.destroy() + Chromium force-kill sequence gets cut off
// and turns back into the zombie-process/session-lock bug it exists to fix.
const KILL_GRACE_MS = 9000;

/**
 * ProcessManager
 * -----------------------------------------------------------------
 * Owns the lifecycle of every "superpower" (whatsapp-web.js session,
 * Puppeteer browser, system exec worker) as an isolated child process
 * via child_process.fork(). This is the whole point of the isolation
 * decision: if whatsapp-web.js's Chromium instance segfaults, THIS
 * process catches the `exit` event, logs it, and can auto-restart --
 * the Express/Socket.io server and every other running power are
 * completely unaffected.
 *
 * This class is transport-agnostic on purpose. It extends EventEmitter
 * and emits "log" / "power:sync" events. socketHandler.js is the only
 * thing that knows Socket.io exists -- if you swap sockets for SSE, or
 * add a CLI, or add a second UI, none of this file changes.
 */
class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.children = new Map(); // id -> ChildProcess instance
    this.state = new Map(); // id -> { status, pid, restartCount, qr }

    POWERS_REGISTRY.forEach((power) => {
      this.state.set(power.id, {
        status: STATUS.STOPPED,
        pid: null,
        restartCount: 0,
        qr: null, // base64 PNG data URL while AWAITING_QR, null otherwise
      });
    });
  }

  /** Full current state, shaped exactly like the frontend's `powers` array. */
  getSnapshot() {
    return POWERS_REGISTRY.map((power) => {
      const s = this.state.get(power.id);
      return {
        id: power.id,
        label: power.label,
        description: power.description,
        accent: power.accent,
        isActive: s.status === STATUS.RUNNING,
        status: s.status, // extra detail the UI can use (spinner, "awaiting_qr" panel, etc.)
        qr: s.qr, // null unless status is "awaiting_qr" -- ready to drop straight into <img src>
        pid: s.pid,
      };
    });
  }

  log(level, message) {
    this.emit('log', { level, message, timestamp: new Date().toISOString() });
  }

  /** For same-process callers (AIRouter) -- workers use process.send({type:"ai_speak"}) instead. */
  speak(text) {
    this.emit('ai_speak', { text });
  }

  /** Same-process callers to save facts directly to SQLite */
  remember(key, value) {
    try {
      rememberFact(key, value);
    } catch (err) {
      this.log('error', `MEMORY :: direct remember failed - ${err.message}`);
    }
  }

  broadcastState() {
    this.emit('power:sync', this.getSnapshot());
  }

  /** Look up a power by id, but ONLY from the whitelist. Never trust raw input beyond this. */
  #resolvePower(id) {
    return POWERS_REGISTRY.find((p) => p.id === id) ?? null;
  }

  start(id) {
    const power = this.#resolvePower(id);
    if (!power) {
      this.log('error', `PROCESS_MANAGER :: rejected unknown power id "${id}"`);
      return;
    }

    const current = this.state.get(id);
    if (
      current.status === STATUS.RUNNING ||
      current.status === STATUS.STARTING ||
      current.status === STATUS.AWAITING_QR ||
      current.status === STATUS.STOPPING
    ) {
      this.log(
        'warn',
        `${power.label} :: start ignored, still ${current.status} -- wait for it to fully stop first`
      );
      return;
    }

    current.status = STATUS.STARTING;
    current.qr = null; // clear any leftover QR from a previous run
    this.broadcastState();
    this.log('info', `${power.label} :: forking child process...`);

    const child = fork(power.scriptPath, [], {
      // stdout/stderr piped (not inherited) so we can capture + relay every line to the
      // frontend terminal instead of it only appearing in the backend's own console.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        POWER_ID: id, // scoped context, nothing secret leaks beyond what the parent already has
      },
    });

    this.children.set(id, child);
    current.pid = child.pid;

    child.stdout?.on('data', (chunk) => {
      this.log('info', `${power.label} :: ${chunk.toString().trim()}`);
    });

    child.stderr?.on('data', (chunk) => {
      this.log('error', `${power.label} :: ${chunk.toString().trim()}`);
    });

    // structured IPC contract every worker must follow (see workers/*.worker.js):
    //   { type: "ready" }                     -> worker finished init, mark RUNNING
    //   { type: "qr", qr }                     -> worker needs a QR scanned, qr is a data URL
    //   { type: "log", level, message }        -> worker wants a specific log level
    //   { type: "ai_speak", text }             -> worker wants to TTS a message
    //   { type: "remember", key, value }       -> worker wants to save a fact to memory
    child.on('message', (msg) => {
      if (msg?.type === 'ready') {
        current.status = STATUS.RUNNING;
        current.qr = null; // scan is done (or was never needed), clear it
        current.restartCount = 0; // clean start resets the crash-loop counter
        this.log('success', `${power.label} :: ONLINE (pid ${child.pid})`);
        this.broadcastState();
      } else if (msg?.type === 'qr') {
        current.status = STATUS.AWAITING_QR;
        current.qr = msg.qr;
        this.log('warn', `${power.label} :: QR code ready, awaiting scan`);
        this.broadcastState();
      } else if (msg?.type === 'log') {
        this.log(msg.level ?? 'info', `${power.label} :: ${msg.message}`);
      } else if (msg?.type === 'ai_speak') {
        this.emit('ai_speak', { text: msg.text });
      } else if (msg?.type === 'remember') {
        // 🧠 THE MEMORY BRIDGE FOR WORKERS
        try {
          rememberFact(msg.key, msg.value);
          this.log('success', `MEMORY :: Remembered fact via ${power.label} ("${msg.key}")`);
        } catch (err) {
          this.log('error', `MEMORY :: failed to remember "${msg.key}" - ${err.message}`);
        }
      }
    });

    child.on('error', (err) => {
      // fork() itself failing (e.g. bad script path) lands here
      this.log('error', `${power.label} :: process error - ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      const wasIntentional = current.status === STATUS.STOPPING;
      this.children.delete(id);
      current.pid = null;

      if (wasIntentional) {
        current.status = STATUS.STOPPED;
        this.log('warn', `${power.label} :: OFFLINE (stopped cleanly)`);
      } else {
        current.status = STATUS.CRASHED;
        this.log(
          'error',
          `${power.label} :: CRASHED (code ${code}, signal ${signal})`
        );
        this.#maybeRestart(id);
      }
      this.broadcastState();
    });
  }

  stop(id) {
    const power = this.#resolvePower(id);
    const child = this.children.get(id);
    const current = this.state.get(id);

    const stoppable =
      current.status === STATUS.RUNNING ||
      current.status === STATUS.AWAITING_QR;
    if (!power || !child || !stoppable) {
      this.log(
        'warn',
        `${power?.label ?? id} :: stop ignored, not currently running`
      );
      return;
    }

    current.status = STATUS.STOPPING;
    current.qr = null; // cancelling mid-scan, clear the stale code
    this.broadcastState();
    this.log('info', `${power.label} :: sending SIGTERM...`);
    child.kill('SIGTERM');

    // if the worker doesn't clean up and exit within the grace period
    // (e.g. Puppeteer's browser.close() hangs), force it.
    setTimeout(() => {
      if (this.children.has(id)) {
        this.log(
          'warn',
          `${power.label} :: force killing (SIGKILL) after grace period`
        );
        child.kill('SIGKILL');
      }
    }, KILL_GRACE_MS);
  }

  /** Exponential-ish backoff auto-restart, capped so a broken worker can't crash-loop forever. */
  #maybeRestart(id) {
    const power = this.#resolvePower(id);
    const current = this.state.get(id);

    if (current.restartCount >= MAX_RESTARTS) {
      this.log(
        'error',
        `${power.label} :: restart limit reached (${MAX_RESTARTS}), holding at CRASHED. Manual restart required.`
      );
      return;
    }

    current.restartCount += 1;
    const delay = 1000 * current.restartCount;
    this.log(
      'warn',
      `${power.label} :: auto-restart attempt ${current.restartCount}/${MAX_RESTARTS} in ${delay}ms`
    );
    setTimeout(() => this.start(id), delay);
  }

  /**
   * Sends a structured command DOWN into a running worker's IPC channel.
   * Only works while status is RUNNING -- a worker that's still starting,
   * awaiting a QR scan, or crashed has no business receiving commands yet.
   */
  sendCommand(id, command, payload = {}) {
    const power = this.#resolvePower(id);
    const child = this.children.get(id);
    const current = this.state.get(id);

    if (!power || !child || current.status !== STATUS.RUNNING) {
      this.log(
        'warn',
        `${power?.label ?? id} :: command "${command}" ignored, power is ${current?.status ?? 'unknown'} not RUNNING`
      );
      return;
    }

    // whitelist check -- this is the boundary that matters once an LLM
    // (not just a fixed UI button) can be the thing generating `command`.
    // Refuse anything not explicitly declared in COMMAND_REGISTRY,
    // full stop, no exceptions for "looks safe."
    const allowed = COMMAND_REGISTRY[id]?.commands?.[command];
    if (!allowed) {
      this.log(
        'error',
        `${power.label} :: rejected unknown command "${command}" -- not in COMMAND_REGISTRY`
      );
      return;
    }

    this.log('info', `${power.label} :: dispatching command "${command}"`);
    child.send({ type: 'command', command, payload });
  }

  /** Called on process SIGINT/SIGTERM so nothing orphans when the backend itself shuts down. */
  shutdownAll() {
    this.log('info', 'PROCESS_MANAGER :: shutting down all children...');
    for (const child of this.children.values()) {
      child.kill('SIGTERM');
    }
  }
}

// singleton -- one process manager for the whole server's lifetime
export default new ProcessManager();