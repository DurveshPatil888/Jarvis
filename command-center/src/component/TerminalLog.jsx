import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';

const LEVEL_STYLES = {
  info: 'text-cyan-400 drop-shadow-[0_0_2px_rgba(34,211,238,0.3)]',
  success: 'text-emerald-400 drop-shadow-[0_0_2px_rgba(52,211,153,0.3)]',
  warn: 'text-amber-400 drop-shadow-[0_0_2px_rgba(251,191,36,0.3)]',
  error: 'text-red-400 drop-shadow-[0_0_2px_rgba(248,113,113,0.3)]',
};

const LEVEL_PREFIX = {
  info: 'INFO',
  success: ' OK ',
  warn: 'WARN',
  error: 'ERR ',
};

function formatTime(date) {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
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
  const watchdogRef = useRef(null); // setInterval handle for freeze-detection
  const lastSpeechTimeRef = useRef(Date.now()); // updated on every onresult
  const manualStopRef = useRef(false);
  const isAwakeRef = useRef(false); // TRUE JARVIS GATING

  // ---------------------------------------------------------------------------
  // STT Homophone Correction
  // ---------------------------------------------------------------------------
  const STT_CORRECTIONS = [
    [/\bclothes\b/gi, 'close'],
    [/\bplea\b/gi, 'play'],
    [/\bfore\b/gi, 'for'],
    [/\btern\b/gi, 'turn'],
    [/\bpaws\b/gi, 'pause'],
    [/\boven\b/gi, 'open'],
    [/\bnext\s+rack\b/gi, 'next track'],
    [/\bwi\s+fi\b/gi, 'wifi'],
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
        try {
          recognitionRef.current.abort();
        } catch {}
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
            .replace(
              /(hey|jarvis|friday|system|deamon|diamond|demon|dam on)/g,
              ''
            )
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
    const WATCHDOG_SILENCE_MS = 15_000;
    watchdogRef.current = setInterval(() => {
      if (Date.now() - lastSpeechTimeRef.current > WATCHDOG_SILENCE_MS) {
        console.warn(
          'STT WATCHDOG: Deep sleep detected. Re-instantiating SpeechRecognition...'
        );
        lastSpeechTimeRef.current = Date.now();
        setupRecognition();
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (watchdogRef.current) clearInterval(watchdogRef.current);
      manualStopRef.current = true;
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.stop();
        } catch {}
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
      ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
      : connectionStatus === 'connecting'
        ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-pulse'
        : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]';

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !onSubmitCommand) return;
    onSubmitCommand(trimmed);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-full bg-[#08090e]">
      {/* Terminal Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#13141c] border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500/80 border border-red-500/50 hover:bg-red-500 transition-colors cursor-pointer" />
          <span className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-500/50 hover:bg-amber-500 transition-colors cursor-pointer" />
          <span className="w-3 h-3 rounded-full bg-emerald-500/80 border border-emerald-500/50 hover:bg-emerald-500 transition-colors cursor-pointer" />
        </div>
        <span className="font-mono text-[11px] font-bold tracking-widest text-cyan-600/60 uppercase">
          root@jarvis-core:~
        </span>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="font-mono text-[10px] tracking-wider text-gray-500 uppercase font-bold">
            {connectionStatus}
          </span>
        </div>
      </div>

      {/* Terminal Body */}
      <div
        ref={scrollRef}
        className="terminal-scroll flex-1 overflow-y-auto px-5 py-4 font-mono text-[13px] leading-relaxed"
      >
        {logs.length === 0 && (
          <p className="text-gray-600 italic">
            SYSTEM_READY :: Awaiting transmission...
          </p>
        )}
        {logs.map((log) => (
          <div
            key={log.id}
            className="flex gap-3 whitespace-pre-wrap break-words mb-1 hover:bg-white/[0.02] p-1 rounded transition-colors"
          >
            <span className="shrink-0 text-gray-600">
              {formatTime(log.timestamp)}
            </span>
            <span
              className={`shrink-0 font-bold ${LEVEL_STYLES[log.level] ?? 'text-gray-400'}`}
            >
              [{LEVEL_PREFIX[log.level] ?? log.level.toUpperCase()}]
            </span>
            <span className="text-gray-300">{log.message}</span>
          </div>
        ))}
      </div>

      {/* Terminal Input Footer */}
      {onSubmitCommand && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-3 px-4 py-3 border-t border-gray-800 bg-black/40"
        >
          <span className="text-cyan-400 font-mono text-[14px] shrink-0 font-bold drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">
            {'>_'}
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              isListening
                ? isAwakeRef.current
                  ? 'Listening to command...'
                  : 'Waiting for wake word...'
                : 'Type a manual command...'
            }
            className="flex-1 bg-transparent font-mono text-[13px] text-cyan-200 placeholder:text-gray-600 outline-none focus:ring-0"
            disabled={connectionStatus !== 'online' || isListening}
            autoComplete="off"
            spellCheck={false}
          />

          {SpeechRecognitionAPI && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={connectionStatus !== 'online'}
              className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed border ${
                isListening
                  ? 'border-red-500/50 bg-red-500/20 text-red-400 shadow-[0_0_10px_-1px_rgba(248,113,113,0.7)] animate-pulse'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-cyan-400 hover:border-cyan-500/50 hover:bg-cyan-500/10'
              }`}
            >
              {isListening ? <Mic size={15} /> : <MicOff size={15} />}
            </button>
          )}
          {/* Cyberpunk Blinking Cursor Block */}
          <span className="w-2.5 h-4 bg-cyan-400/80 animate-pulse shrink-0 shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
        </form>
      )}

      {/* Custom Scrollbar CSS for Terminal */}
      <style>{`
        .terminal-scroll::-webkit-scrollbar { width: 6px; }
        .terminal-scroll::-webkit-scrollbar-track { background: transparent; }
        .terminal-scroll::-webkit-scrollbar-thumb { background: rgba(34, 211, 238, 0.2); border-radius: 4px; }
        .terminal-scroll::-webkit-scrollbar-thumb:hover { background: rgba(34, 211, 238, 0.5); }
      `}</style>
    </div>
  );
}
