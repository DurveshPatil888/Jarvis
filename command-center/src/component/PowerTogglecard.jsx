import { useState } from 'react';

/**
 * PowerToggleCard
 * Reusable "superpower" control for the Command Center dashboard.
 */

const ACCENTS = {
  cyan: {
    ring: 'ring-cyan-400/50',
    border: 'border-cyan-500/40',
    borderIdle: 'border-cyan-500/10',
    text: 'text-cyan-300',
    dot: 'bg-cyan-400',
    glow: 'shadow-[0_0_25px_-5px_rgba(34,211,238,0.25)] hover:shadow-[0_0_30px_-5px_rgba(34,211,238,0.4)]',
    trackOn: 'bg-cyan-500/90',
    knobGlow: 'shadow-[0_0_10px_2px_rgba(34,211,238,0.8)]',
    scan: 'via-cyan-400/30',
  },
  purple: {
    ring: 'ring-purple-400/50',
    border: 'border-purple-500/40',
    borderIdle: 'border-purple-500/10',
    text: 'text-purple-300',
    dot: 'bg-purple-400',
    glow: 'shadow-[0_0_25px_-5px_rgba(168,85,247,0.25)] hover:shadow-[0_0_30px_-5px_rgba(168,85,247,0.4)]',
    trackOn: 'bg-purple-500/90',
    knobGlow: 'shadow-[0_0_10px_2px_rgba(168,85,247,0.8)]',
    scan: 'via-purple-400/30',
  },
  green: {
    ring: 'ring-emerald-400/50',
    border: 'border-emerald-500/40',
    borderIdle: 'border-emerald-500/10',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
    glow: 'shadow-[0_0_25px_-5px_rgba(74,222,128,0.25)] hover:shadow-[0_0_30px_-5px_rgba(74,222,128,0.4)]',
    trackOn: 'bg-emerald-500/90',
    knobGlow: 'shadow-[0_0_10px_2px_rgba(74,222,128,0.8)]',
    scan: 'via-emerald-400/30',
  },
};

const STATUS_TEXT = {
  stopped: 'STANDBY',
  starting: 'INITIALIZING',
  awaiting_qr: 'AWAITING SCAN',
  running: 'ACTIVE',
  stopping: 'STOPPING',
  crashed: 'CRASHED',
};

export default function PowerToggleCard({
  label = 'UNTITLED_POWER',
  description = 'No description provided.',
  icon: Icon,
  accent = 'cyan',
  isActive = false,
  status,
  qr = null,
  onToggle = () => {},
  statusText,
  onTest,
  testLabel = 'SEND_TEST',
}) {
  const [pressed, setPressed] = useState(false);
  const c = ACCENTS[accent] ?? ACCENTS.cyan;

  const resolvedStatus = status ?? (isActive ? 'running' : 'stopped');
  const isAwaitingQR = resolvedStatus === 'awaiting_qr';
  const isPending =
    resolvedStatus === 'starting' || resolvedStatus === 'stopping';
  const isCrashed = resolvedStatus === 'crashed';

  const chrome = isCrashed
    ? {
        border: 'border-red-500/50',
        glow: 'shadow-[0_0_25px_-5px_rgba(248,113,113,0.3)]',
        bracket: 'border-red-400/80',
      }
    : isAwaitingQR
      ? {
          border: 'border-amber-500/50',
          glow: 'shadow-[0_0_25px_-5px_rgba(251,191,36,0.3)] animate-pulse',
          bracket: 'border-amber-400/80',
        }
      : isActive
        ? {
            border: c.border,
            glow: c.glow,
            bracket: c.border.replace('/40', '/80'),
          }
        : {
            border: `${c.borderIdle} hover:border-gray-600/50`,
            glow: 'shadow-lg',
            bracket: 'border-gray-700/50',
          };

  const dotClass = isCrashed
    ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]'
    : isAwaitingQR
      ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
      : isActive
        ? `${c.dot} shadow-[0_0_8px_currentColor]`
        : 'bg-gray-600';

  const dotPulse = isActive || isAwaitingQR || isPending ? 'animate-pulse' : '';

  const textClass = isCrashed
    ? 'text-red-400'
    : isAwaitingQR
      ? 'text-amber-400'
      : isActive
        ? c.text
        : 'text-gray-500';

  const displayStatusText =
    statusText ?? STATUS_TEXT[resolvedStatus] ?? resolvedStatus.toUpperCase();

  const handleToggleClick = () => {
    if (isAwaitingQR) {
      onToggle(false);
      return;
    }
    if (isPending) return;
    onToggle(!isActive);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-[#13141c] border transition-all duration-300 ${chrome.border} ${chrome.glow}`}
    >
      {/* corner brackets — HUD signature element */}
      <span
        className={`pointer-events-none absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 rounded-tl-xl transition-colors duration-300 ${chrome.bracket}`}
      />
      <span
        className={`pointer-events-none absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 rounded-tr-xl transition-colors duration-300 ${chrome.bracket}`}
      />
      <span
        className={`pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 rounded-bl-xl transition-colors duration-300 ${chrome.bracket}`}
      />
      <span
        className={`pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 rounded-br-xl transition-colors duration-300 ${chrome.bracket}`}
      />

      {/* scanline sweep — only runs while genuinely live */}
      {isActive && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className={`absolute inset-x-0 h-12 bg-gradient-to-b from-transparent ${c.scan} to-transparent animate-[scan_3s_linear_infinite]`}
          />
        </div>
      )}

      <div className="relative p-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={`shrink-0 mt-1 w-10 h-10 rounded-lg flex items-center justify-center border transition-all duration-300 ${
              isActive
                ? `${c.border} bg-white/5 ${c.text} shadow-inner`
                : 'border-gray-800 bg-gray-900/50 text-gray-500'
            }`}
          >
            {Icon ? (
              <Icon size={20} strokeWidth={isActive ? 2.5 : 1.5} />
            ) : (
              <span className="text-xs font-mono">--</span>
            )}
          </div>

          <div className="min-w-0">
            <h3 className="font-mono text-[14px] font-semibold tracking-wider text-gray-200 truncate drop-shadow-md">
              {label}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-400 line-clamp-2 pr-2">
              {description}
            </p>

            <div className="mt-3 flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${dotClass} ${dotPulse}`}
              />
              <span
                className={`font-mono text-[10px] font-bold tracking-widest ${textClass}`}
              >
                {displayStatusText}
              </span>
            </div>

            {isActive && onTest && (
              <button
                type="button"
                onClick={onTest}
                className={`mt-3 inline-flex items-center gap-1.5 rounded-md border ${c.border} px-3 py-1.5 font-mono text-[10px] font-bold tracking-widest ${c.text} bg-white/[0.02] hover:bg-white/[0.08] hover:shadow-[0_0_10px_rgba(255,255,255,0.1)] transition-all duration-200`}
              >
                ▶ {testLabel}
              </button>
            )}
          </div>
        </div>

        {/* toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          aria-label={
            isAwaitingQR ? `Cancel ${label} authentication` : `Toggle ${label}`
          }
          disabled={isPending}
          onClick={handleToggleClick}
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          className={`shrink-0 relative w-12 h-6 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#13141c] ${c.ring} ${
            isPending ? 'opacity-50 cursor-not-allowed' : ''
          } ${isActive ? c.trackOn : isAwaitingQR ? 'bg-amber-500/70' : 'bg-gray-800 border border-gray-700'} ${
            pressed ? 'scale-90' : 'scale-100'
          }`}
        >
          <span
            className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white transition-all duration-300 ${
              isActive
                ? `translate-x-6 ${c.knobGlow}`
                : isAwaitingQR
                  ? 'translate-x-6 shadow-[0_0_10px_2px_rgba(251,191,36,0.8)]'
                  : 'translate-x-0 bg-gray-400'
            }`}
          />
        </button>
      </div>

      {/* QR auth panel */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          isAwaitingQR
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="relative mx-5 mb-5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-4 shadow-inner">
            <div className="flex items-center gap-2 mb-3 justify-center">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.8)]" />
              <span className="font-mono text-[11px] font-bold tracking-widest text-amber-400">
                AUTH_REQUIRED
              </span>
            </div>

            <div className="flex justify-center">
              {qr ? (
                <img
                  src={qr}
                  alt={`${label} QR authentication code`}
                  className="w-40 h-40 rounded-md border-2 border-amber-500/40 bg-white p-2 shadow-[0_0_15px_rgba(245,158,11,0.2)]"
                />
              ) : (
                <div className="w-40 h-40 rounded-md border-2 border-amber-500/20 border-dashed flex items-center justify-center bg-black/20">
                  <span className="font-mono text-xs text-amber-400/50 animate-pulse">
                    generating_qr...
                  </span>
                </div>
              )}
            </div>

            <p className="mt-3 text-center font-mono text-[10px] text-amber-200/60 leading-snug tracking-wide">
              LINK DEVICE VIA WHATSAPP APP
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: -3rem; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
