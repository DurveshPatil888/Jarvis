import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * POWERS_REGISTRY
 * -----------------------------------------------------------------
 * This is the SECURITY BOUNDARY for the entire process manager.
 * ProcessManager.start(id) / .stop(id) only ever accept an `id` that
 * exists in this array -- there is no path where client-supplied
 * strings get turned into a filesystem path or shell command. This
 * is what makes it safe to expose `power:toggle` over a socket that
 * (eventually) accepts input from a UI: the attack surface is
 * "which of these 3 known scripts runs", never "run whatever string
 * you send me."
 *
 * `scriptPath` is resolved from disk at boot, not from client input.
 */
export const POWERS_REGISTRY = [
  {
    id: 'whatsapp',
    label: 'WHATSAPP_FORWARDER',
    description: 'Auto-forwards flagged messages via whatsapp-web.js',
    accent: 'cyan',
    scriptPath: path.join(__dirname, '../workers/whatsapp.worker.js'),
  },
  {
    id: 'youtube',
    label: 'YOUTUBE_CONTROL',
    description: 'Puppeteer-driven playback and queue control',
    accent: 'purple',
    scriptPath: path.join(__dirname, '../workers/youtube.worker.js'),
  },
  {
    id: 'system',
    label: 'SYSTEM_CONTROL',
    description:
      'OS-level automation: launch apps, lock screen, volume control',
    accent: 'green',
    scriptPath: path.join(__dirname, '../workers/system.worker.js'),
  },
];
