import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';

const LEVEL_STYLES = {
  info: 'text-cyan-300/70',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

const LEVEL_PREFIX = {
  info: 'INFO',
  success: ' OK ',
  warn: 'WARN',
  error: 'ERR ',
};

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

const SpeechRecognitionAPI = null; // 🚀 BROWSER MIC DISABLED (USING PYTHON NOW)

export default function TerminalLog({
  logs = [],
  connectionStatus = 'connecting',
  onSubmitCommand,
}) {
  const scrollRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState(null);

  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);
  const watchdogRef = useRef(null);     // setInterval handle for freeze-detection
  const lastSpeechTimeRef = useRef(Date.now()); // updated on every onresult
  const manualStopRef = useRef(false);
  const isAwakeRef = useRef(false); // TRUE JARVIS GATING

  // ---------------------------------------------------------------------------
  // STT Homophone Correction
  // Word-boundary replacements applied to the final transcript BEFORE the LLM
  // sees it. Add pairs here as you discover recurring STT mishearings.
  // ---------------------------------------------------------------------------
  const STT_CORRECTIONS = [
    [/\bclothes\b/gi, 'close'],
    [/\bplea\b/gi,    'play'],
    [/\bfore\b/gi,    'for'],
    [/\btern\b/gi,    'turn'],
    [/\bpaws\b/gi,    'pause'],
    [/\boven\b/gi,    'open'],
    [/\bnext\s+rack\b/gi, 'next track'],
    [/\bwi\s+fi\b/gi,    'wifi'],
    [/\bblue\s+tooth\b/gi, 'bluetooth'],
  ];

  function applySttCorrections(text) {
    let out = text;
    for (const [pattern, replacement] of STT_CORRECTIONS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!SpeechRecognitionAPI) return;

    const setupRecognition = () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }

      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        if (window.speechSynthesis?.speaking) return;
        lastSpeechTimeRef.current = Date.now();

        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }

        const lowerText = transcript.toLowerCase();

        if (!isAwakeRef.current) {
          if (lowerText.match(/(jarvis|friday|system)/)) {
            isAwakeRef.current = true;
            setDraft('Yes Sir? (Listening...)');
            console.log('WOKE UP! Clearing buffer...');
            recognition.stop();
          }
          return;
        }

        setDraft(transcript);

        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
          const stripped = transcript
            .toLowerCase()
            .replace(/(hey|jarvis|friday|system|deamon|diamond|demon|dam on)/g, '')
            .trim();

          const cleanedCommand = applySttCorrections(stripped);

          if (cleanedCommand && onSubmitCommand) {
            onSubmitCommand(cleanedCommand);
          }

          isAwakeRef.current = false;
          setDraft('');
          recognition.stop();
        }, 2500);
      };

      recognition.onerror = (event) => {
        setMicError(event.error);
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        if (manualStopRef.current) {
          manualStopRef.current = false;
          setIsListening(false);
          return;
        }
        try {
          recognition.start();
          setIsListening(true);
        } catch {
          // ignore
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
        setIsListening(true);
      } catch {
        // ignore
      }
    };

    setupRecognition();

    const WATCHDOG_INTERVAL_MS = 5_000;
    const WATCHDOG_SILENCE_MS  = 15_000;
    watchdogRef.current = setInterval(() => {
      if (Date.now() - lastSpeechTimeRef.current > WATCHDOG_SILENCE_MS) {
        console.warn('STT WATCHDOG: Deep sleep detected. Re-instantiating SpeechRecognition...');
        lastSpeechTimeRef.current = Date.now();
        setupRecognition();
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      if (timeoutRef.current)  clearTimeout(timeoutRef.current);
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      manualStopRef.current = true;
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, [onSubmitCommand]);

  const toggleListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening) {
      manualStopRef.current = true;
      recognition.stop();
      setIsListening(false);
      return;
    }

    setMicError(null);
    setDraft('');
    try {
      recognition.start();
      setIsListening(true);
    } catch {}
  }, [isListening]);

  const statusDot =
    connectionStatus === 'online'
      ? 'bg-emerald-400'
      : connectionStatus === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-red-400';

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !onSubmitCommand) return;
    onSubmitCommand(trimmed);
    setDraft('');
  };

  return (
    <div className="flex flex-col rounded-lg border border-white/10 bg-[#0a0e14] overflow-hidden h-full">
      <div className="flex items-center justify-between px-3 py-2 bg-white/[0.03] border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        </div>
        <span className="font-mono text-[11px] tracking-widest text-white/40">
          root@command-center:~
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
          <span className="font-mono text-[10px] tracking-wider text-white/40 uppercase">
            {connectionStatus}
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="terminal-scroll flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-relaxed"
      >
        {logs.length === 0 && (
          <p className="text-white/20">// awaiting transmission...</p>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex gap-2 whitespace-pre-wrap break-words"
          >
            <span className="shrink-0 text-white/25">
              {formatTime(log.timestamp)}
            </span>
            <span
              className={`shrink-0 ${LEVEL_STYLES[log.level] ?? 'text-white/60'}`}
            >
              [{LEVEL_PREFIX[log.level] ?? log.level.toUpperCase()}]
            </span>
            <span className="text-white/70">{log.message}</span>
          </div>
        ))}
      </div>

      {onSubmitCommand && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-4 py-2.5 border-t border-white/10 bg-white/[0.02]"
        >
          <span className="text-emerald-400/80 font-mono text-[12px] shrink-0">
            $
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isListening
                ? isAwakeRef.current
                  ? 'listening to command...'
                  : 'waiting for wake word...'
                : 'type a command...'
            }
            className="flex-1 bg-transparent font-mono text-[12px] text-white/80 placeholder:text-white/20 outline-none"
            disabled={connectionStatus !== 'online' || isListening}
            autoComplete="off"
            spellCheck={false}
          />
          {SpeechRecognitionAPI && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={connectionStatus !== 'online'}
              className={`shrink-0 w-6 h-6 rounded flex items-center justify-center transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${
                isListening
                  ? 'bg-red-500/20 text-red-400 shadow-[0_0_10px_-1px_rgba(248,113,113,0.7)] animate-pulse'
                  : 'text-white/30 hover:text-cyan-300 hover:bg-white/5'
              }`}
            >
              {isListening ? <Mic size={13} /> : <MicOff size={13} />}
            </button>
          )}
          <span className="w-2 h-3.5 bg-emerald-400/80 animate-pulse shrink-0" />
        </form>
      )}
      <style>{`
        .terminal-scroll::-webkit-scrollbar { width: 6px; }
        .terminal-scroll::-webkit-scrollbar-track { background: transparent; }
        .terminal-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        .terminal-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
      `}</style>
    </div>
  );
}
