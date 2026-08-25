import React, { useState } from 'react';
import {
  MessageSquare,
  Play,
  Terminal,
  Activity,
  BrainCircuit,
  Search,
  Settings,
  Mic,
} from 'lucide-react';
import useCommandSocket from '../hooks/useCommandSocket';
import PowerToggleCard from './PowerToggleCard';
import TerminalLog from './TerminalLog';

// Keeps the hook's data layer icon-agnostic
const ICONS = {
  whatsapp: MessageSquare,
  youtube: Play, // Note: I changed 'Video' back to 'youtube' if that was the original id, but match it to your backend
  system: Terminal,
};

export default function Dashboard() {
  // Yahan humne audioLevel extract kar liya hai jo Python -> Node -> React aa raha hai
  const {
    powers,
    logs,
    togglePower,
    sendCommand,
    sendRouterCommand,
    connectionStatus,
    audioLevel,
  } = useCommandSocket();

  // Local state for the mic toggle (visual UI flair)
  const [isListening, setIsListening] = useState(true);
  const activeCount = powers.filter((p) => p.isActive).length;

  return (
    <div className="h-screen w-screen bg-[#0a0a0f] text-gray-300 font-sans flex overflow-hidden selection:bg-cyan-500/30">
      {/* ================= SIDEBAR ================= */}
      <aside className="w-64 bg-[#0f1016] border-r border-gray-800 flex flex-col justify-between hidden md:flex">
        <div>
          {/* Logo Section */}
          <div className="p-6 flex items-center gap-3 mb-4">
            <BrainCircuit className="w-10 h-10 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" />
            <div>
              <h1 className="text-2xl font-bold text-cyan-400 tracking-wider drop-shadow-[0_0_5px_rgba(34,211,238,0.4)]">
                JARVIS
              </h1>
              <p className="text-xs text-cyan-600 font-semibold tracking-widest">
                CORE DASHBOARD
              </p>
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="flex flex-col gap-1 px-3">
            <div className="flex items-center gap-3 px-4 py-3 bg-green-500/10 border-l-4 border-green-500 text-green-400 rounded-r-md transition-colors cursor-pointer">
              <Activity className="w-5 h-5" />
              <span className="font-medium tracking-wide">SYSTEM STATUS</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded-md transition-colors cursor-pointer">
              <Terminal className="w-5 h-5" />
              <span className="font-medium tracking-wide">COMMAND LOGS</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 rounded-md transition-colors cursor-pointer">
              <Search className="w-5 h-5" />
              <span className="font-medium tracking-wide">RESEARCH MODULE</span>
            </div>
          </nav>
        </div>

        {/* Quick Control / Listen Toggle */}
        <div className="p-6">
          <p className="text-xs text-gray-500 font-semibold tracking-widest mb-3 uppercase text-center">
            Voice Interface
          </p>
          <button
            onClick={() => setIsListening(!isListening)}
            className={`w-full py-3 px-4 rounded-full border flex items-center justify-center gap-2 transition-all duration-300 ${
              isListening
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.15)]'
                : 'border-gray-700 bg-gray-800/50 text-gray-400'
            }`}
          >
            <span className="font-semibold tracking-wider text-sm">
              MIC [{isListening ? 'ACTIVE' : 'MUTED'}]
            </span>
            <div
              className={`w-2.5 h-2.5 rounded-full ${isListening ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse' : 'bg-gray-600'}`}
            ></div>
          </button>
        </div>
      </aside>

      {/* ================= MAIN DASHBOARD ================= */}
      <main className="flex-1 p-6 md:p-8 flex flex-col gap-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-900 via-[#0a0a0f] to-[#0a0a0f] overflow-y-auto">
        {/* Header & Connection Status */}
        <header className="flex items-center justify-between">
          <div>
            <h2 className="font-mono text-xl md:text-2xl tracking-widest text-white/90 drop-shadow-[0_0_5px_rgba(255,255,255,0.2)]">
              ACTIVE_MODULES
            </h2>
            <p className="font-mono text-xs text-cyan-500 mt-1 tracking-wide uppercase">
              {activeCount} of {powers.length} Superpowers Online
            </p>
          </div>

          <div
            className={`flex items-center gap-2 font-mono text-xs font-bold tracking-wider px-4 py-2 rounded-full border ${
              connectionStatus === 'online'
                ? 'border-green-500/50 bg-green-500/10 text-green-400 shadow-[0_0_10px_rgba(34,197,94,0.2)]'
                : connectionStatus === 'connecting'
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400 animate-pulse'
                  : 'border-red-500/50 bg-red-500/10 text-red-400'
            }`}
          >
            <Activity
              size={14}
              className={
                connectionStatus === 'connecting' ? 'animate-spin' : ''
              }
            />
            {connectionStatus.toUpperCase()}
          </div>
        </header>

        {/* 2-Column Grid for Powers and Terminal */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-6 flex-1 min-h-0">
          {/* LEFT: Superpower Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 content-start overflow-y-auto pb-4 pr-2 custom-scrollbar">
            {powers.map((power) => (
              <PowerToggleCard
                key={power.id}
                label={power.label}
                description={power.description}
                accent={power.accent}
                icon={ICONS[power.id]}
                isActive={power.isActive}
                status={power.status}
                qr={power.qr}
                onToggle={(next) => togglePower(power.id, next)}
                onTest={
                  power.id === 'whatsapp'
                    ? () => sendCommand('whatsapp', 'send_test_message')
                    : undefined
                }
                testLabel="SEND_TEST_MSG"
              />
            ))}
          </div>

          {/* RIGHT: Live Terminal Feed Wrapper */}
          <div className="h-[450px] lg:h-full bg-black/40 border border-gray-800 rounded-xl overflow-hidden flex flex-col shadow-2xl backdrop-blur-md">
            {/* Terminal Header */}
            <div className="px-4 py-3 bg-[#13141c] border-b border-gray-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold tracking-widest text-gray-400 uppercase">
                  Live Backend Stream
                </span>
                <div className="w-2 h-2 rounded-full bg-green-500/80 animate-pulse"></div>
              </div>
              <span className="text-[10px] text-gray-600 font-mono">
                CONSOLE
              </span>
            </div>

            {/* Actual Terminal Component */}
            <div className="flex-1 overflow-hidden relative">
              <TerminalLog
                logs={logs}
                connectionStatus={connectionStatus}
                onSubmitCommand={sendRouterCommand}
              />
            </div>
          </div>
        </div>

        {/* BOTTOM: Audio Visualizer (For Aesthetic) */}
        <div className="h-24 bg-[#13141c] border border-gray-800 rounded-xl p-4 flex items-center justify-between relative overflow-hidden group mt-auto shrink-0">
          <div className="relative z-10 flex flex-col">
            <p className="text-xs font-semibold tracking-widest text-gray-500 uppercase mb-1">
              Jarvis Audio Core
            </p>
            <p className="text-sm font-mono text-cyan-400">
              {isListening ? 'Listening for wake word...' : 'System Muted'}
            </p>
          </div>

          {/* Smart Simulated Wave - PC Safe! */}
          <div className="flex items-center gap-1.5 h-10 relative z-10">
            {[4, 8, 14, 20, 28, 20, 14, 8, 4, 12, 18, 12].map((height, i) => (
              <div
                key={i}
                className={`w-1.5 rounded-full ${isListening ? 'bg-cyan-400' : 'bg-gray-700'} transition-all duration-300`}
                style={{
                  // isListening true hone par CSS wave animate karegi, warna flat 4px rahegi
                  height: isListening
                    ? `${height + Math.random() * 10}px`
                    : '4px',
                  opacity: isListening ? 0.7 + Math.random() * 0.3 : 1,
                  animation: isListening
                    ? `pulse 1.${i}s infinite alternate`
                    : 'none',
                }}
              ></div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
