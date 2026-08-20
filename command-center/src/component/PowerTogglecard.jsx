import { useState } from "react";

/**
 * PowerToggleCard
 * Reusable "superpower" control for the Command Center dashboard.
 *
 * Fully controlled — Dashboard.jsx owns the state and passes it down,
 * driven by the backend's power:sync broadcast. `status` is the
 * authoritative word from ProcessManager: stopped / starting /
 * awaiting_qr / running / stopping / crashed.
 *
 * Props:
 *  - label        string   e.g. "WHATSAPP_FORWARDER"
 *  - description  string   short one-liner of what the power does
 *  - icon         Component  any icon component (lucide-react etc), rendered at 20px
 *  - accent       "cyan" | "purple" | "green"
 *  - isActive     boolean  true only when status === "running"
 *  - status       string   full backend status (optional, falls back to isActive-derived)
 *  - qr           string|null  base64 PNG data URL, present while status === "awaiting_qr"
 *  - onToggle     (nextState: boolean) => void
 *  - statusText   string   optional override, otherwise derived from status
 */

const ACCENTS = {
  cyan: {
    ring: "ring-cyan-400/50",
    border: "border-cyan-500/40",
    borderIdle: "border-cyan-500/10",
    text: "text-cyan-300",
    dot: "bg-cyan-400",
    glow: "shadow-[0_0_25px_-5px_rgba(34,211,238,0.5)]",
    trackOn: "bg-cyan-500/90",
    knobGlow: "shadow-[0_0_10px_2px_rgba(34,211,238,0.8)]",
    scan: "via-cyan-400/60",
  },
  purple: {
    ring: "ring-purple-400/50",
    border: "border-purple-500/40",
    borderIdle: "border-purple-500/10",
    text: "text-purple-300",
    dot: "bg-purple-400",
    glow: "shadow-[0_0_25px_-5px_rgba(168,85,247,0.5)]",
    trackOn: "bg-purple-500/90",
    knobGlow: "shadow-[0_0_10px_2px_rgba(168,85,247,0.8)]",
    scan: "via-purple-400/60",
  },
  green: {
    ring: "ring-emerald-400/50",
    border: "border-emerald-500/40",
    borderIdle: "border-emerald-500/10",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    glow: "shadow-[0_0_25px_-5px_rgba(74,222,128,0.5)]",
    trackOn: "bg-emerald-500/90",
    knobGlow: "shadow-[0_0_10px_2px_rgba(74,222,128,0.8)]",
    scan: "via-emerald-400/60",
  },
};

const STATUS_TEXT = {
  stopped: "STANDBY",
  starting: "INITIALIZING",
  awaiting_qr: "AWAITING SCAN",
  running: "ACTIVE",
  stopping: "STOPPING",
  crashed: "CRASHED",
};

export default function PowerToggleCard({
  label = "UNTITLED_POWER",
  description = "No description provided.",
  icon: Icon,
  accent = "cyan",
  isActive = false,
  status,
  qr = null,
  onToggle = () => {},
  statusText,
  onTest,
  testLabel = "SEND_TEST",
}) {
  const [pressed, setPressed] = useState(false);
  const c = ACCENTS[accent] ?? ACCENTS.cyan;

  // fall back to a derived status if the backend snapshot hasn't caught up yet
  const resolvedStatus = status ?? (isActive ? "running" : "stopped");
  const isAwaitingQR = resolvedStatus === "awaiting_qr";
  const isPending = resolvedStatus === "starting" || resolvedStatus === "stopping";
  const isCrashed = resolvedStatus === "crashed";

  // card chrome: crashed and awaiting-QR both need to grab attention regardless
  // of the power's own accent color, so they get dedicated treatments
  const chrome = isCrashed
    ? {
        border: "border-red-500/50",
        glow: "shadow-[0_0_25px_-5px_rgba(248,113,113,0.5)]",
        bracket: "border-red-400/80",
      }
    : isAwaitingQR
    ? {
        border: "border-amber-500/50",
        glow: "shadow-[0_0_25px_-5px_rgba(251,191,36,0.5)]",
        bracket: "border-amber-400/80",
      }
    : isActive
    ? {
        border: c.border,
        glow: c.glow,
        bracket: c.border.replace("/40", "/80"),
      }
    : {
        border: `${c.borderIdle} hover:border-white/10`,
        glow: "",
        bracket: "border-white/10",
      };

  const dotClass = isCrashed
    ? "bg-red-400"
    : isAwaitingQR
    ? "bg-amber-400"
    : isActive
    ? c.dot
    : "bg-white/20";

  const dotPulse = isActive || isAwaitingQR || isPending ? "animate-pulse" : "";

  const textClass = isCrashed ? "text-red-300" : isAwaitingQR ? "text-amber-300" : isActive ? c.text : "text-white/30";

  const displayStatusText = statusText ?? STATUS_TEXT[resolvedStatus] ?? resolvedStatus.toUpperCase();

  // clicking the switch means different things depending on state:
  //  - awaiting QR: cancel the pending auth (stop)
  //  - mid-transition (starting/stopping): no-op, let it resolve
  //  - otherwise: normal on/off flip
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
      className={`relative overflow-hidden rounded-lg bg-[#0d1117] border transition-all duration-300 ${chrome.border} ${chrome.glow}`}
    >
      {/* corner brackets — HUD signature element */}
      <span className={`pointer-events-none absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 rounded-tl-sm transition-colors duration-300 ${chrome.bracket}`} />
      <span className={`pointer-events-none absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 rounded-tr-sm transition-colors duration-300 ${chrome.bracket}`} />
      <span className={`pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 rounded-bl-sm transition-colors duration-300 ${chrome.bracket}`} />
      <span className={`pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 rounded-br-sm transition-colors duration-300 ${chrome.bracket}`} />

      {/* scanline sweep — only runs while genuinely live */}
      {isActive && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className={`absolute inset-x-0 h-8 bg-gradient-to-b from-transparent ${c.scan} to-transparent animate-[scan_3s_linear_infinite]`}
          />
        </div>
      )}

      <div className="relative p-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`shrink-0 mt-0.5 w-9 h-9 rounded-md flex items-center justify-center border transition-colors duration-300 ${
              isActive ? `${c.border} bg-white/5 ${c.text}` : "border-white/10 text-white/30"
            }`}
          >
            {Icon ? <Icon size={18} strokeWidth={2} /> : <span className="text-xs font-mono">--</span>}
          </div>

          <div className="min-w-0">
            <h3 className="font-mono text-[13px] tracking-wider text-white/90 truncate">
              {label}
            </h3>
            <p className="mt-1 text-[12px] leading-snug text-white/40 line-clamp-2">
              {description}
            </p>

            <div className="mt-2 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${dotClass} ${dotPulse}`} />
              <span className={`font-mono text-[10px] tracking-widest ${textClass}`}>
                {displayStatusText}
              </span>
            </div>

            {isActive && onTest && (
              <button
                type="button"
                onClick={onTest}
                className={`mt-2 inline-flex items-center gap-1 rounded border ${c.border} px-2 py-1 font-mono text-[10px] tracking-widest ${c.text} bg-white/[0.03] hover:bg-white/[0.08] transition-colors duration-200`}
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
          aria-label={isAwaitingQR ? `Cancel ${label} authentication` : `Toggle ${label}`}
          disabled={isPending}
          onClick={handleToggleClick}
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          className={`shrink-0 relative w-11 h-6 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 ${c.ring} ${
            isPending ? "opacity-40 cursor-not-allowed" : ""
          } ${isActive ? c.trackOn : isAwaitingQR ? "bg-amber-500/70" : "bg-white/10"} ${
            pressed ? "scale-95" : "scale-100"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-300 ${
              isActive
                ? `translate-x-5 ${c.knobGlow}`
                : isAwaitingQR
                ? "translate-x-5 shadow-[0_0_10px_2px_rgba(251,191,36,0.8)]"
                : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* QR auth panel — height-animates open/closed via CSS grid, no JS measuring needed */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          isAwaitingQR ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="relative mx-4 mb-4 rounded-md border border-amber-500/30 bg-amber-500/[0.04] p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-mono text-[10px] tracking-widest text-amber-300">
                SCAN_TO_AUTHENTICATE
              </span>
            </div>

            <div className="flex justify-center">
              {qr ? (
                <img
                  src={qr}
                  alt={`${label} QR authentication code`}
                  className="w-36 h-36 rounded-sm border border-amber-500/20 bg-white p-1.5"
                />
              ) : (
                <div className="w-36 h-36 rounded-sm border border-amber-500/20 flex items-center justify-center">
                  <span className="font-mono text-[10px] text-amber-300/50">
                    generating...
                  </span>
                </div>
              )}
            </div>

            <p className="mt-2 text-center font-mono text-[10px] text-white/30 leading-snug">
              Open WhatsApp → Linked Devices → Scan
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scan {
          0% { top: -2rem; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}