import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:4000';

let logIdCounter = 0;
const toLogEntry = (raw) => ({
  id: `log-${Date.now()}-${logIdCounter++}`,
  level: raw.level,
  message: raw.message,
  timestamp: new Date(raw.timestamp), // server sends ISO string, TerminalLog wants a Date
});

/**
 * speakText
 * -----------------------------------------------------------------
 * Forces a male voice via name matching against whatever the browser
 * exposes ("David", "Male", "Google UK English Male" are common
 * matches on Windows/Chrome). Falls back to the browser default voice
 * if none match -- never blocks speech just because the search fails.
 *
 * getVoices() is often empty on the very first call (Chrome loads the
 * voice list asynchronously) -- retry once via onvoiceschanged if so,
 * rather than silently speaking with the wrong/default voice.
 */
function pickMaleVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => /david|male|google uk english male/i.test(v.name)) ??
    null
  );
}

function speakText(text) {
  if (!('speechSynthesis' in window) || !text) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;

  const existing = pickMaleVoice();
  if (existing) {
    utterance.voice = existing;
    window.speechSynthesis.speak(utterance);
    return;
  }

  // voice list not loaded yet -- wait once, then speak regardless
  const onVoicesReady = () => {
    const voice = pickMaleVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
    window.speechSynthesis.removeEventListener('voiceschanged', onVoicesReady);
  };
  window.speechSynthesis.addEventListener('voiceschanged', onVoicesReady);
}

/**
 * useCommandSocket
 * -----------------------------------------------------------------
 * Single source of truth for real-time backend comms. Dashboard.jsx
 * consumes { powers, logs, togglePower, connectionStatus } and never
 * touches the transport layer directly -- that contract hasn't
 * changed from the mocked version, which is why swapping the guts
 * below required zero edits to Dashboard.jsx or any card component.
 *
 * `powers` now comes straight from ProcessManager.getSnapshot() on
 * the backend, including a `status` field (stopped/starting/running/
 * stopping/crashed) -- that's the authoritative state. We no longer
 * guess client-side whether a toggle is "pending"; we just read it.
 */
export default function useCommandSocket() {
  const [powers, setPowers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState('connecting'); // connecting | online | offline

  // --- NAYA STATE: Python se aane wali volume ke liye ---
  const [audioLevel, setAudioLevel] = useState(0);

  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(WS_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('online');
    });

    socket.on('disconnect', () => {
      // fires on server restart, network drop, etc. Socket.io will keep
      // retrying in the background per the reconnection options above.
      setConnectionStatus('offline');
    });

    socket.on('connect_error', () => {
      setConnectionStatus('offline');
    });

    // real backend logs -- ambient heartbeats, crash reports, everything
    // ProcessManager.log() emits, relayed by socketHandler.js
    socket.on('log', (entry) => {
      setLogs((prev) => [...prev.slice(-99), toLogEntry(entry)]); // ring buffer cap stays at 100
    });

    // full state snapshot -- sent on initial connect AND after every
    // status change (start/stop/crash/restart)
    socket.on('power:sync', (snapshot) => {
      setPowers(snapshot);
    });

    // voice feedback -- workers and AIRouter both emit this for short,
    // spoken confirmations ("Message fired", "System locked", etc.)
    socket.on('ai_speak', ({ text }) => {
      speakText(text);
    });

    // --- NAYA EVENT LISTENER: Dashboard UI ko animate karne ke liye ---
    socket.on('audio_level', (level) => {
      setAudioLevel(level);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const togglePower = useCallback(
    (id, nextState) => {
      const socket = socketRef.current;
      if (!socket?.connected) return; // no point emitting into a dead socket

      const power = powers.find((p) => p.id === id);
      // status is the backend's word, not ours -- if it's mid-transition,
      // let the in-flight request resolve instead of firing a second one
      if (
        power &&
        (power.status === 'starting' || power.status === 'stopping')
      ) {
        return;
      }

      socket.emit('power:toggle', { id, nextState });
      // no optimistic setPowers() here -- we wait for the server's
      // power:sync broadcast to actually reflect the new state, exactly
      // like the mocked version did with its setTimeout delay.
    },
    [powers]
  );

  const sendCommand = useCallback((id, command, commandPayload = {}) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('power:command', { id, command, commandPayload });
  }, []);

  const sendRouterCommand = useCallback((text) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit('router:command', { text });
  }, []);

  return {
    powers,
    logs,
    togglePower,
    sendCommand,
    sendRouterCommand,
    connectionStatus,
    audioLevel, // Isko return karna zaroori tha UI ke liye
  };
}
