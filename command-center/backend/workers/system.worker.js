import { execFile } from 'child_process';
import { promisify } from 'util';
import loudness from 'loudness';

const execFileAsync = promisify(execFile);

const send = (payload) => process.send?.(payload);
const log = (level, message) => send({ type: 'log', level, message });
const speak = (text) => send({ type: 'ai_speak', text });

send({ type: 'log', level: 'info', message: 'system worker starting...' });
send({ type: 'ready' });

// ---------------------------------------------------------------
// Global safety nets
// ---------------------------------------------------------------
process.on('uncaughtException', (err) => {
  log('error', `uncaught exception: ${err?.stack || err}`);
});
process.on('unhandledRejection', (err) => {
  log('error', `unhandled rejection: ${err?.stack || err}`);
});

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function psEscape(str) {
  return String(str).replace(/'/g, "''");
}

async function runPS(script, { timeoutMs = 15000 } = {}) {
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: timeoutMs, killSignal: 'SIGKILL' }
  );
}

// ---------------------------------------------------------------
// Radio (Bluetooth / Wi-Fi) toggle
// ---------------------------------------------------------------
function radioToggleScript(radioKind, state) {
  return `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
    $asTaskSpecific = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTaskSpecific.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}
[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
$radioList = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$radio = $radioList | Where-Object { $_.Kind -eq [Windows.Devices.Radios.RadioKind]::${radioKind} } | Select-Object -First 1
if ($null -eq $radio) { Write-Error "No ${radioKind} radio found."; exit 1 }
Await ($radio.SetStateAsync([Windows.Devices.Radios.RadioState]::${state})) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
Write-Output "${radioKind} turned ${state}."
`;
}

async function setRadio(radioKind, on) {
  await runPS(radioToggleScript(radioKind, on ? 'On' : 'Off'));
  speak(`${radioKind === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} turned ${on ? 'on' : 'off'}`);
}

// Media & Volume keys
const MEDIA_VK = {
  play_pause: 0xb3,
  next: 0xb0,
  previous: 0xb1,
  volume_up: 0xaf,
  volume_down: 0xae,
  volume_mute: 0xad,
};

async function sendMediaKey(action) {
  const vk = MEDIA_VK[action];
  if (!vk) {
    throw new Error(`media action must be one of: ${Object.keys(MEDIA_VK).join(', ')} — got "${action}"`);
  }
  const script = `
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public class MediaKey2 {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    public const uint KEYEVENTF_KEYUP       = 0x0002;
    public static void PressKey(byte vk) {
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
    }
}
"@ -Language CSharp
[MediaKey2]::PressKey(${vk})
Write-Output "Media key ${vk} sent."
`;
  await runPS(script);
}

function openUrlInBrowser(browser, url) {
  return runPS(`Start-Process ${browser} -ArgumentList "${url}"`);
}

// ---------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------

const VIP_WEB_APPS = {
  spotify: 'https://open.spotify.com/',
  'yt music': 'https://music.youtube.com/',
  'youtube music': 'https://music.youtube.com/',
  youtube: 'https://www.youtube.com/',
  linkedin: 'https://www.linkedin.com/',
  github: 'https://github.com/',
};

const BROWSER_NAMES = ['brave', 'chrome', 'edge', 'firefox', 'opera'];

const APP_ACTION_ROUTERS = {
  spotify: {
    play_specific: (q) => `Start-Process brave -ArgumentList "https://open.spotify.com/search/${encodeURIComponent(q)}"`,
    search: (q) => `Start-Process brave -ArgumentList "https://open.spotify.com/search/${encodeURIComponent(q)}"`,
    open: () => `Start-Process brave -ArgumentList "https://open.spotify.com/"`,
  },
  'yt music': {
    play_specific: (q) => `Start-Process brave -ArgumentList "https://music.youtube.com/search?q=${encodeURIComponent(q)}"`,
    search: (q) => `Start-Process brave -ArgumentList "https://music.youtube.com/search?q=${encodeURIComponent(q)}"`,
    open: () => `Start-Process brave -ArgumentList "https://music.youtube.com/"`,
  },
  linkedin: {
    search: (q) => `Start-Process brave -ArgumentList "https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(q)}"`,
    open: () => `Start-Process brave -ArgumentList "https://www.linkedin.com/"`,
  },
  github: {
    search: (q) => `Start-Process brave -ArgumentList "https://github.com/search?q=${encodeURIComponent(q)}"`,
    open: () => `Start-Process brave -ArgumentList "https://github.com/"`,
  },
  vlc: {
    play_specific: (q) => `Start-Process vlc -ArgumentList '--one-instance "${psEscape(q)}"'`,
    search: () => { throw new Error('VLC does not support in-app search'); },
  },
};

const COMMAND_HANDLERS = {
  open_app: async ({ app_name }) => {
    const name = String(app_name || '').trim().toLowerCase();
    if (!name) throw new Error('app_name cannot be empty');

    const vipKey = Object.keys(VIP_WEB_APPS).find((k) => name.includes(k));
    if (vipKey) {
      await openUrlInBrowser('brave', VIP_WEB_APPS[vipKey]);
      speak(`Opening ${name}`);
      return;
    }

    const script = `
$name = '${psEscape(name)}'
$launched = $false
try {
  $app = Get-StartApps | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1
  if ($app) { Start-Process "shell:AppsFolder\\$($app.AppID)"; $launched = $true }
} catch {}
if (-not $launched) {
  $regBase = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  $keys = Get-ChildItem $regBase -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -like "*$name*" } | Select-Object -First 1
  if ($keys) { $exe = (Get-ItemProperty $keys.PSPath).'(default)'; if ($exe) { Start-Process $exe; $launched = $true } }
}
if (-not $launched) {
  $cmd = Get-Command "$name" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { Start-Process $cmd.Source; $launched = $true }
}
if (-not $launched) { Write-Error "Could not find an app matching '$name'"; exit 1 }
`;
    await runPS(script);
    speak(`Opening ${name}`);
  },

  close_app: async ({ app_name }) => {
    const name = String(app_name || '').trim();
    if (!name) throw new Error('app_name cannot be empty');
    const script = `
$name = '${psEscape(name)}'
$procs = Get-Process | Where-Object { $_.Name -like "*$name*" -or $_.MainWindowTitle -like "*$name*" }
if ($procs) { $procs | Stop-Process -Force -ErrorAction SilentlyContinue }
`;
    await runPS(script);
    speak(`Closed ${name}`);
  },

  app_action: async ({ app_name, action, query = '' }) => {
    const app = String(app_name || '').toLowerCase().trim();
    const act = String(action || '').trim();
    const q = String(query || '').trim();
    if (!app || !act) throw new Error('app_name and action cannot be empty');

    const speakText = act.replace('_', ' ') + ' on ' + app_name + (q ? ': ' + q : '');
    const targetBrowser = BROWSER_NAMES.find((b) => app.includes(b));
    if (targetBrowser) {
      let url = '';
      if (act === 'play_specific') url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      else if (act === 'search') url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      
      if (url) { await openUrlInBrowser(targetBrowser, url); speak(speakText); return; }
    }

    if (act === 'media_control') { await sendMediaKey(q); speak(q.replace('_', ' ')); return; }

    const routerKey = Object.keys(APP_ACTION_ROUTERS).find((k) => app.includes(k));
    if (routerKey) {
      const actionFn = APP_ACTION_ROUTERS[routerKey][act] || APP_ACTION_ROUTERS[routerKey].open;
      await runPS(actionFn(q));
      speak(speakText);
      return;
    }
  },

  // --- FIXED: THESE NOW MATCH commandRegistry.js EXACTLY ---
  set_bluetooth: ({ state }) => setRadio('Bluetooth', state === 'on'),
  set_wifi: ({ state }) => setRadio('WiFi', state === 'on'),
  
  lock_screen: async () => {
    await runPS('rundll32.exe user32.dll,LockWorkStation');
    speak('Screen locked');
  },

  media_control: async ({ action }) => {
    await sendMediaKey(action);
    speak(String(action).replace('_', ' '));
  },

  set_volume: async ({ action, percent }) => {
    if (action === 'up') {
      await sendMediaKey('volume_up');
      speak('Volume up');
    } else if (action === 'down') {
      await sendMediaKey('volume_down');
      speak('Volume down');
    } else if (action === 'mute') {
      await sendMediaKey('volume_mute');
      speak('Muted');
    } else if (action === 'set') {
      const pct = Number(percent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new Error(`percent must be 0-100, got "${percent}"`);
      }
      await loudness.setVolume(pct);
      speak(`Volume set to ${pct} percent`);
    }
  },
  
  get_status: async () => {
    log('success', 'System worker is running perfectly.');
  }
};

// ---------------------------------------------------------------
// Command Queue
// ---------------------------------------------------------------
let queue = Promise.resolve();

process.on('message', (msg) => {
  if (msg?.type !== 'command') return;
  queue = queue.then(async () => {
    const handler = COMMAND_HANDLERS[msg.command];
    if (!handler) {
      log('error', `unknown command "${msg.command}"`);
      return;
    }
    try {
      await handler(msg.payload ?? {});
      log('success', `command "${msg.command}" completed`);
    } catch (err) {
      const detail = err instanceof Error ? err.stack || err.message : String(err);
      log('error', `command "${msg.command}" failed: ${detail}`);
    }
  });
});

process.on('SIGTERM', () => {
  log('warn', 'received SIGTERM, shutting down...');
  process.exit(0);
});