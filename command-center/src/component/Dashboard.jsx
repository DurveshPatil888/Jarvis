import { MessageSquare, Play, Terminal, Activity } from 'lucide-react';
import useCommandSocket from '../hooks/useCommandSocket';
import PowerToggleCard from './PowerToggleCard';
import TerminalLog from './TerminalLog';

// maps power.id -> icon component. Keeps the hook's data layer icon-agnostic.
const ICONS = {
  whatsapp: MessageSquare,
  youtube: Play,
  system: Terminal,
};

export default function Dashboard() {
  const {
    powers,
    logs,
    togglePower,
    sendCommand,
    sendRouterCommand,
    connectionStatus,
  } = useCommandSocket();

  const activeCount = powers.filter((p) => p.isActive).length;

  return (
    <div className="min-h-screen bg-[#05070a] text-white p-6 md:p-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-mono text-xl md:text-2xl tracking-widest text-white/90">
            COMMAND_CENTER
          </h1>
          <p className="font-mono text-[11px] text-white/30 mt-1 tracking-wide">
            {activeCount}/{powers.length} SUPERPOWERS ACTIVE
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px] tracking-wider text-white/40">
          <Activity
            size={14}
            className={
              connectionStatus === 'online'
                ? 'text-emerald-400'
                : connectionStatus === 'connecting'
                  ? 'text-amber-400 animate-pulse'
                  : 'text-red-400'
            }
          />
          {connectionStatus.toUpperCase()}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-6">
        {/* superpower grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 content-start">
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

        {/* live terminal feed */}
        <div className="h-[420px] lg:h-auto">
          <TerminalLog
            logs={logs}
            connectionStatus={connectionStatus}
            onSubmitCommand={sendRouterCommand}
          />
        </div>
      </div>
    </div>
  );
}
