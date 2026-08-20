import { execFile } from 'child_process';
import { promisify } from 'util';
import loudness from 'loudness';

const execFileAsync = promisify(execFile);

process.send?.({
  type: 'log',
  level: 'info',
  message: 'system worker starting...',
});
process.send?.({ type: 'ready' });

const POWERSHELL_SCRIPTS = {
  bluetooth_on: `
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
$radios = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$radioList = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$bluetooth = $radioList | Where-Object { $_.Kind -eq [Windows.Devices.Radios.RadioKind]::Bluetooth } | Select-Object -First 1
if ($null -eq $bluetooth) { Write-Error "No Bluetooth radio found."; exit 1 }
Await ($bluetooth.SetStateAsync([Windows.Devices.Radios.RadioState]::On)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
Write-Output "Bluetooth turned ON."
`,
  bluetooth_off: `
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
$radios = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$radioList = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$bluetooth = $radioList | Where-Object { $_.Kind -eq [Windows.Devices.Radios.RadioKind]::Bluetooth } | Select-Object -First 1
if ($null -eq $bluetooth) { Write-Error "No Bluetooth radio found."; exit 1 }
Await ($bluetooth.SetStateAsync([Windows.Devices.Radios.RadioState]::Off)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
Write-Output "Bluetooth turned OFF."
`,
  wifi_on: `
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
$radios = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$radioList = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$wifi = $radioList | Where-Object { $_.Kind -eq [Windows.Devices.Radios.RadioKind]::WiFi } | Select-Object -First 1
if ($null -eq $wifi) { Write-Error "No Wi-Fi radio found."; exit 1 }
Await ($wifi.SetStateAsync([Windows.Devices.Radios.RadioState]::On)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
Write-Output "Wi-Fi turned ON."
  `,
  wifi_off: `
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
$radios = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
$radioList = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$wifi = $radioList | Where-Object { $_.Kind -eq [Windows.Devices.Radios.RadioKind]::WiFi } | Select-Object -First 1
if ($null -eq $wifi) { Write-Error "No Wi-Fi radio found."; exit 1 }
Await ($wifi.SetStateAsync([Windows.Devices.Radios.RadioState]::Off)) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
Write-Output "Wi-Fi turned OFF."
  `,
};

async function runPS(script) {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    script,
  ]);
}

const COMMAND_HANDLERS = {
  open_app: async ({ app_name }) => {
    const name = String(app_name).trim().toLowerCase();
    if (!name) throw new Error('app_name cannot be empty');

    // 🚀 VIP WEB APPS INTERCEPT (Brave bypass for web apps)
    const VIP_WEB_APPS = {
      'spotify': 'https://open.spotify.com/',
      'yt music': 'https://music.youtube.com/',
      'youtube music': 'https://music.youtube.com/',
      'youtube': 'https://www.youtube.com/',
      'linkedin': 'https://www.linkedin.com/',
      'github': 'https://github.com/'
    };

    const vipKey = Object.keys(VIP_WEB_APPS).find(k => name.includes(k));
    if (vipKey) {
      const url = VIP_WEB_APPS[vipKey];
      await runPS(`Start-Process brave -ArgumentList "${url}"`);
      process.send?.({ type: 'ai_speak', text: `Opening ${name}` });
      return; // Stop here, don't run the .exe search below
    }

    // NATIVE OS APP FALLBACK (For .exe apps like Notepad, VLC, etc.)
    const script = `
$name = '${name.replace(/'/g, "''")}'
$launched = $false

try {
  $app = Get-StartApps | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1
  if ($app) {
    Start-Process "shell:AppsFolder\\$($app.AppID)"
    Write-Output "Launched via StartApps: $($app.Name)"
    $launched = $true
  }
} catch {}

if (-not $launched) {
  $regBase = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  $keys = Get-ChildItem $regBase -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -like "*$name*" } |
    Select-Object -First 1
  if ($keys) {
    $exe = (Get-ItemProperty $keys.PSPath).'(default)'
    if ($exe) {
      Start-Process $exe
      Write-Output "Launched via App Paths: $exe"
      $launched = $true
    }
  }
}

if (-not $launched) {
  $cmd = Get-Command "$name" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) {
    Start-Process $cmd.Source
    Write-Output "Launched via PATH: $($cmd.Source)"
    $launched = $true
  }
}

if (-not $launched) {
  Write-Error "Could not find an app matching '$name'"
  exit 1
}
`;
    await runPS(script);
    process.send?.({ type: 'ai_speak', text: `Opening ${name}` });
  },

  // 🚀 MISSING FUNCTION ADDED: Yeh line band karne ke liye zaroori thi!
  close_app: async ({ app_name }) => {
    const name = String(app_name).trim();
    if (!name) throw new Error('app_name cannot be empty');

    const script = `
$name = '${name.replace(/'/g, "''")}'
$procs = Get-Process | Where-Object { $_.Name -like "*$name*" -or $_.MainWindowTitle -like "*$name*" }
if ($procs) {
  $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Output "Killed $($procs.Count) process(es) matching '$name'"
} else {
  Write-Output "No running process matched '$name'"
}
`;
    await runPS(script);
    process.send?.({ type: 'ai_speak', text: `Closed ${name}` });
  },

  app_action: async ({ app_name, action, query = '' }) => {
    const app  = String(app_name).toLowerCase().trim();
    const act  = String(action).trim();
    const q    = String(query).trim();

    const speakText = act.replace('_', ' ') + " on " + app_name + (q ? ": " + q : "");

    // 1. Web/Browser Check
    const BROWSER_NAMES = ['brave', 'chrome', 'edge', 'firefox', 'opera'];
    const targetBrowser = BROWSER_NAMES.find(b => app.includes(b));
    
    if (targetBrowser) {
      let url = '';
      if (act === 'play_specific') {
        url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      } else if (act === 'search') {
        url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      }
      if (url) {
        // Explictly targeting the browser requested by the user
        await runPS(`Start-Process ${targetBrowser} -ArgumentList "${url}"`);
        process.send?.({ type: 'ai_speak', text: speakText });
        return;
      }
    }

    // Shared media_control fallback
    if (act === 'media_control') {
      const VK_MAP = { play_pause: '0xB3', next: '0xB0', previous: '0xB1' };
      const vk = VK_MAP[q];
      if (!vk) throw new Error(`media_control query must be play_pause|next|previous, got "${q}"`);
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
      process.send?.({ type: 'ai_speak', text: q.replace('_', '/') });
      return;
    }

    // 2. Specific App Check (VIP LOUNGE - STRICTLY BRAVE)
    const APP_ACTION_ROUTERS = {
      'spotify': {
        play_specific: (query) => `Start-Process brave -ArgumentList "https://open.spotify.com/search/${encodeURIComponent(query)}"`,
        search: (query) => `Start-Process brave -ArgumentList "https://open.spotify.com/search/${encodeURIComponent(query)}"`,
        open: () => `Start-Process brave -ArgumentList "https://open.spotify.com/"`
      },
      'yt music': {
        play_specific: (query) => `Start-Process brave -ArgumentList "https://music.youtube.com/search?q=${encodeURIComponent(query)}"`,
        search: (query) => `Start-Process brave -ArgumentList "https://music.youtube.com/search?q=${encodeURIComponent(query)}"`,
        open: () => `Start-Process brave -ArgumentList "https://music.youtube.com/"`
      },
      'linkedin': {
        search: (query) => `Start-Process brave -ArgumentList "https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}"`,
        open: () => `Start-Process brave -ArgumentList "https://www.linkedin.com/"`
      },
      'github': {
        search: (query) => `Start-Process brave -ArgumentList "https://github.com/search?q=${encodeURIComponent(query)}"`,
        open: () => `Start-Process brave -ArgumentList "https://github.com/"`
      },
      'vlc': {
        play_specific: (query) => `Start-Process vlc --ArgumentList "--one-instance","${query.replace(/"/g, '\\"')}"`,
        search: () => { throw new Error('VLC does not support in-app search'); },
      }
    };

    const routerKey = Object.keys(APP_ACTION_ROUTERS).find((k) => app.includes(k));
    if (routerKey) {
      const router    = APP_ACTION_ROUTERS[routerKey];
      const actionFn  = router[act] || router['open'];
      if (!actionFn) {
        throw new Error(`App "${routerKey}" does not support action "${act}".`);
      }
      const psLine = actionFn(q);
      await runPS(psLine);
      process.send?.({ type: 'ai_speak', text: speakText });
      return;
    }

    // 3. The OS Genius Fallback
    const fallbackScript = `
$name = '${app.replace(/'/g, "''")}'
$args = '${q.replace(/'/g, "''")}'
$launched = $false

try {
  $appItem = Get-StartApps | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1
  if ($appItem) {
    if ($args) { Start-Process "shell:AppsFolder\\$($appItem.AppID)" -ArgumentList $args } 
    else { Start-Process "shell:AppsFolder\\$($appItem.AppID)" }
    $launched = $true
  }
} catch {}

if (-not $launched) {
  $cmd = Get-Command "*$name*" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) {
    if ($args) { Start-Process $cmd.Source -ArgumentList $args } 
    else { Start-Process $cmd.Source }
    $launched = $true
  }
}

if (-not $launched) {
  if ($args) { Start-Process $name -ArgumentList $args -ErrorAction SilentlyContinue } 
  else { Start-Process $name -ErrorAction SilentlyContinue }
}
`;
    await runPS(fallbackScript);
    process.send?.({ type: 'ai_speak', text: speakText });
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

process.on('SIGTERM', () => {
  process.send?.({
    type: 'log',
    level: 'warn',
    message: 'received SIGTERM, shutting down...',
  });
  process.exit(0);
});