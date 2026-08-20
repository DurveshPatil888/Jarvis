import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import { rm } from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Real installed Brave, not the Puppeteer-bundled Chromium. Configurable
// via env for portability -- hardcoding it is fine for a single-machine
// local project, but an env override costs nothing.
const BRAVE_PATH =
  process.env.BRAVE_EXECUTABLE_PATH ||
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

// DEDICATED automation profile -- deliberately NOT the user's real, live
// Brave profile. Chromium profiles lock via a SingletonLock file the
// moment a browser opens them, and the real profile carries every real
// logged-in session the user has -- a much bigger blast radius than a
// profile that only ever holds a YouTube session. Add this folder to
// .gitignore, same as .wwebjs_auth/.
const AUTOMATION_PROFILE_DIR = path.join(
  __dirname,
  '../../.brave-automation-profile'
);

/**
 * youtube.worker.js
 * -----------------------------------------------------------------
 * Real Puppeteer automation, running Brave via executablePath, against
 * a dedicated automation profile. Runs as an isolated child process
 * (see ProcessManager#start) for the same reason whatsapp.worker.js
 * does -- if the browser crashes or hangs here, Express/Socket.io and
 * every other power keep running.
 *
 * LAZY INIT: the browser does NOT launch when this worker starts. It
 * only launches on the first actual command. "ready" is sent
 * immediately at boot -- that reflects "this process is alive and can
 * accept commands," which is true even before any browser exists.
 * That distinction (process ready vs. browser open) is what makes
 * silent background operation possible.
 *
 * IPC CONTRACT (same shape as whatsapp.worker.js):
 *   process.send({ type: "ready" })                  -> worker process alive, NOT "browser open"
 *   process.send({ type: "log", level, message })     -> any log line
 *   process.on("message", { type: "command", ... })   -> see COMMAND_HANDLERS
 *   process.on("SIGTERM", ...) -> clean up, then process.exit(0)
 */

let browser = null;
let page = null;
let launchPromise = null; // in-flight launch guard, see ensureBrowser()

process.send?.({
  type: 'log',
  level: 'info',
  message: 'worker idle -- browser launches on first command',
});
process.send?.({ type: 'ready' });

async function clearProfileLock() {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const file of lockFiles) {
    try {
      await rm(path.join(AUTOMATION_PROFILE_DIR, file), { force: true });
    } catch {
      // best effort -- file may not exist, that's fine
    }
  }
}

async function launch(isRetry = false) {
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath: BRAVE_PATH,
      userDataDir: AUTOMATION_PROFILE_DIR,
      defaultViewport: null,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  } catch (err) {
    const looksLocked = /already running|SingletonLock/i.test(
      err?.message || ''
    );
    if (looksLocked && !isRetry) {
      // most likely a zombie process from an improper prior shutdown
      // holding a stale lock, not a genuinely live conflicting instance
      // (ensureBrowser's health check already ruled that out before
      // calling launch() at all). Clear it and retry exactly once.
      process.send?.({
        type: 'log',
        level: 'warn',
        message:
          'profile appears locked by a stale process -- clearing lock files and retrying...',
      });
      await clearProfileLock();
      await launch(true);
      return;
    }
    throw err;
  }

  const pages = await browser.pages();
  page = pages[0] ?? (await browser.newPage());
  await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });

  process.send?.({
    type: 'log',
    level: 'success',
    message: 'Brave launched, YouTube loaded',
  });
}

// Ensures concurrent commands arriving before the browser exists share
// ONE launch instead of racing separate puppeteer.launch() calls against
// the same profile -- a real risk specifically because launch is now
// lazy/deferred instead of happening once eagerly at worker startup.
function launchOnce() {
  if (!launchPromise) {
    launchPromise = launch().finally(() => {
      launchPromise = null;
    });
  }
  return launchPromise;
}

/**
 * Enforces single-tab discipline: reuses an existing YouTube tab if one
 * exists, closes stray about:blank tabs, and never opens a new tab just
 * because a command was issued. Run on every ensureBrowser() call, not
 * just at launch, so it also cleans up drift between commands (Brave's
 * own startup behavior, or stray tabs opened any other way).
 */
async function consolidateTabs() {
  const pages = await browser.pages();
  let youtubeTab = null;
  const strays = [];

  for (const p of pages) {
    let url = '';
    try {
      url = p.url();
    } catch {
      continue; // page may have closed mid-iteration
    }
    if (url.includes('youtube.com') && !youtubeTab) {
      youtubeTab = p;
    } else if (url === 'about:blank') {
      strays.push(p);
    }
  }

  if (!youtubeTab) {
    youtubeTab = pages[0] ?? (await browser.newPage());
  }

  for (const stray of strays) {
    if (stray !== youtubeTab) {
      try {
        await stray.close();
      } catch {
        // ignore -- best effort cleanup
      }
    }
  }

  page = youtubeTab;
}

async function safeGoto(url, options = { waitUntil: 'domcontentloaded' }) {
  try {
    await page.goto(url, options);
  } catch (err) {
    // net::ERR_ABORTED here is usually benign -- YouTube's own SPA
    // routing frequently interrupts Puppeteer's navigation lifecycle
    // event even though content loads fine. Log and continue instead
    // of hard-failing the command.
    process.send?.({
      type: 'log',
      level: 'warn',
      message: `navigation to ${url} reported "${err.message}" -- continuing`,
    });
  }
}

async function ensureBrowser() {
  let healthy = false;
  try {
    if (browser && page && !page.isClosed()) {
      // the only reliable, version-agnostic health check: an actual
      // round-trip. Introspecting browser.process()/isConnected()
      // internals proved unreliable across launch modes.
      await page.evaluate(() => true);
      healthy = true;
    }
  } catch {
    healthy = false;
  }

  if (!healthy) {
    process.send?.({
      type: 'log',
      level: 'warn',
      message: 'browser unavailable, launching...',
    });
    await launchOnce();
  }

  await consolidateTabs();

  if (!page.url().includes('youtube.com')) {
    await safeGoto('https://www.youtube.com');
  }
}

const COMMAND_HANDLERS = {
  open: async () => {
    await ensureBrowser();
    await safeGoto('https://www.youtube.com');
  },

  play: async ({ query }) => {
    await ensureBrowser();
    if (!query || typeof query !== 'string') {
      throw new Error('query is required');
    }

    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await safeGoto(searchUrl);

    let videoElement;
    try {
      videoElement = await page.waitForSelector(
        'ytd-video-renderer a#video-title',
        {
          visible: true,
          timeout: 15000,
        }
      );
    } catch (err) {
      throw new Error(
        `search results never rendered for "${query}": ${err.message}`
      );
    }
    if (!videoElement) {
      throw new Error('no video result found for query');
    }

    try {
      // DOM-level click inside page context -- avoids Puppeteer's own
      // synthetic mouse-event click racing the SPA navigation it triggers
      await page.evaluate((el) => el.click(), videoElement);
    } catch (err) {
      throw new Error(`failed to click video result: ${err.message}`);
    }

    try {
      await page.waitForSelector('video', { visible: true, timeout: 15000 });
    } catch (err) {
      throw new Error(`watch page player never mounted: ${err.message}`);
    }

    await page.evaluate(() => {
      document
        .querySelector('video')
        ?.play()
        .catch(() => {});
    });
    process.send?.({ type: 'ai_speak', text: 'Playing song' });
  },

  pause: async () => {
    await ensureBrowser();
    await page.evaluate(() => {
      document.querySelector('video')?.pause();
    });
  },

  resume: async () => {
    await ensureBrowser();
    await page.evaluate(() => {
      document.querySelector('video')?.play();
    });
  },
};

process.on('message', async (msg) => {
  if (msg?.type !== 'command') return;

  const handler = COMMAND_HANDLERS[msg.command];
  if (!handler) {
    process.send?.({
      type: 'log',
      level: 'error',
      message: `unknown command "${msg.command}"`,
    });
    return;
  }

  try {
    await handler(msg.payload ?? {});
    process.send?.({
      type: 'log',
      level: 'success',
      message: `command "${msg.command}" completed`,
    });
  } catch (err) {
    const detail =
      err instanceof Error ? err.stack || err.message : String(err);
    process.send?.({
      type: 'log',
      level: 'error',
      message: `command "${msg.command}" failed: ${detail}`,
    });
  }
});

const SHUTDOWN_TIMEOUT_MS = 6000;

process.on('SIGTERM', async () => {
  process.send?.({
    type: 'log',
    level: 'warn',
    message: 'received SIGTERM, closing browser...',
  });

  // lazy init means browser may legitimately never have launched at all
  if (!browser) {
    process.send?.({
      type: 'log',
      level: 'info',
      message: 'no browser was open, nothing to clean up',
    });
    process.exit(0);
    return;
  }

  const browserProcess = browser?.process?.() ?? null;

  const closePromise = browser.close().catch((err) => {
    process.send?.({
      type: 'log',
      level: 'error',
      message: `browser.close() threw: ${err.message}`,
    });
  });

  const timedOut = await Promise.race([
    closePromise.then(() => false),
    new Promise((resolve) =>
      setTimeout(() => resolve(true), SHUTDOWN_TIMEOUT_MS)
    ),
  ]);

  if (timedOut) {
    process.send?.({
      type: 'log',
      level: 'warn',
      message: `browser.close() did not resolve within ${SHUTDOWN_TIMEOUT_MS}ms, forcing shutdown...`,
    });
  }

  if (
    browserProcess &&
    browserProcess.exitCode === null &&
    !browserProcess.killed
  ) {
    process.send?.({
      type: 'log',
      level: 'warn',
      message: 'force-killing lingering Chromium process...',
    });
    browserProcess.kill('SIGKILL');
  }

  process.exit(0);
});
