import { Rocket, Square, Hammer, MapPin, Package, Terminal, AlertTriangle, CheckCircle2, Clock, Zap } from 'lucide-react';
import { BotStatus, NavItem, UserTier, BuildRecord } from './types';

const STATUS_BORDER: Record<BotStatus, { border: string; bg: string }> = {
  offline:   { border: 'border-[--bb-border]',       bg: '' },
  launching: { border: 'border-yellow-600/40',        bg: 'bg-yellow-950/10' },
  connected: { border: 'border-green-600/40',         bg: 'bg-green-950/10' },
  building:  { border: 'border-blue-600/40',          bg: 'bg-blue-950/10' },
  error:     { border: 'border-red-600/40',           bg: 'bg-red-950/10' },
  stopped:   { border: 'border-[--bb-border]',        bg: '' },
};

const STATUS_LABEL: Record<BotStatus, { text: string; color: string; desc: string }> = {
  offline:   { text: 'Offline',   color: 'text-[--bb-text3]', desc: 'Bot is not running. Launch to begin.' },
  launching: { text: 'Launching', color: 'text-yellow-500',   desc: 'Bot process is starting up...' },
  connected: { text: 'Connected', color: 'text-green-500',    desc: 'Bot is connected and ready for commands.' },
  building:  { text: 'Building',  color: 'text-blue-500',     desc: 'Build is in progress.' },
  error:     { text: 'Error',     color: 'text-red-500',      desc: 'Bot encountered an error. Check Console.' },
  stopped:   { text: 'Stopped',   color: 'text-[--bb-text3]', desc: 'Bot was stopped.' },
};

function MetricTile({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string; icon?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-md p-3 flex flex-col gap-1 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium" style={{ color: 'var(--bb-text3)' }}>{label}</span>
        {icon && <span style={{ color: 'var(--bb-text4)' }}>{icon}</span>}
      </div>
      <span className={`text-xl font-semibold ${accent ?? ''}`} style={accent ? {} : { color: 'var(--bb-text1)' }}>{value}</span>
      {sub && <span className="text-[11px]" style={{ color: 'var(--bb-text4)' }}>{sub}</span>}
    </div>
  );
}

function QuickAction({ label, icon, onClick, disabled, primary }: {
  label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        primary ? 'bg-green-700 hover:bg-green-600 text-white' : ''
      }`}
      style={primary ? {} : {
        background: 'var(--bb-raised)',
        border: '1px solid var(--bb-border2)',
        color: 'var(--bb-text2)',
      }}
      onMouseEnter={e => { if (!primary && !disabled) e.currentTarget.style.background = 'var(--bb-hover)'; }}
      onMouseLeave={e => { if (!primary && !disabled) e.currentTarget.style.background = 'var(--bb-raised)'; }}
    >
      {icon}
      {label}
    </button>
  );
}

interface DashboardProps {
  botStatus: BotStatus;
  serverTarget: string;
  userTier: UserTier;
  isElectron: boolean;
  recentBuilds: BuildRecord[];
  onNavigate: (item: NavItem) => void;
  onLaunch: () => void;
  onStop: () => void;
}

export function Dashboard({ botStatus, serverTarget, userTier, isElectron, recentBuilds, onNavigate, onLaunch, onStop }: DashboardProps) {
  const statusInfo = STATUS_LABEL[botStatus];
  const statusStyle = STATUS_BORDER[botStatus];
  const lastBuild = recentBuilds[0];
  const isRunning = botStatus === 'connected' || botStatus === 'building';
  const successBuilds = recentBuilds.filter(b => b.status === 'success').length;
  const aiBuilds = recentBuilds.filter(b => b.source !== 'local').length;

  return (
    <div className="flex flex-col h-full overflow-auto" style={{ background: 'var(--bb-bg)' }}>
      {!isElectron && (
        <div className="mx-4 mt-4 flex items-center gap-2 px-3 py-2.5 rounded-md bg-yellow-950/20 border border-yellow-600/30">
          <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
          <span className="text-xs text-yellow-600">Desktop controls require Electron. Some features are disabled in browser mode.</span>
        </div>
      )}

      <div className="p-4 flex flex-col gap-4">
        {/* Status panel */}
        <div className={`border rounded-md p-4 ${statusStyle.border} ${statusStyle.bg}`} style={{ borderColor: undefined }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Bot Status</p>
              <p className={`text-2xl font-semibold ${statusInfo.color}`}>{statusInfo.text}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--bb-text3)' }}>{statusInfo.desc}</p>
              {serverTarget && <p className="text-xs font-mono mt-1" style={{ color: 'var(--bb-text2)' }}>{serverTarget}</p>}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {!isRunning ? (
                <QuickAction label="Launch Bot" icon={<Rocket size={13} />} onClick={() => onNavigate('launch')} primary disabled={!isElectron} />
              ) : (
                <QuickAction label="Stop Bot" icon={<Square size={13} />} onClick={onStop} disabled={!isElectron} />
              )}
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-4 gap-3">
          <MetricTile label="Total Builds" value={recentBuilds.length} icon={<Hammer size={13} />} />
          <MetricTile label="Success Rate" value={recentBuilds.length ? `${Math.round((successBuilds / recentBuilds.length) * 100)}%` : '—'} accent="text-green-500" icon={<CheckCircle2 size={13} />} />
          <MetricTile label="AI Calls" value={aiBuilds} sub="vs local planner" icon={<Zap size={13} />} />
          <MetricTile
            label="Tier"
            value={userTier.toUpperCase()}
            sub={userTier === 'free' ? '10 builds/day' : userTier === 'pro' ? '100 builds/day' : 'Unlimited'}
            icon={<Package size={13} />}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Quick actions */}
          <div className="rounded-md p-3 flex flex-col gap-2 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
            <p className="text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--bb-text4)' }}>Quick Actions</p>
            <QuickAction label="Build Test Cube" icon={<Hammer size={13} />} onClick={() => onNavigate('build')} disabled={!isRunning} />
            <QuickAction label="Get Position"    icon={<MapPin size={13} />}  onClick={() => {}} disabled={!isRunning} />
            <QuickAction label="Check Inventory" icon={<Package size={13} />} onClick={() => {}} disabled={!isRunning} />
            <QuickAction label="Open Console"    icon={<Terminal size={13} />} onClick={() => onNavigate('console')} />
          </div>

          {/* Last build */}
          <div className="col-span-2 rounded-md p-3 flex flex-col gap-2 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
            <p className="text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--bb-text4)' }}>Last Build</p>
            {lastBuild ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--bb-text1)' }}>{lastBuild.prompt}</span>
                  <span className={`ml-2 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    lastBuild.status === 'success' ? 'bg-green-900/40 text-green-400' :
                    lastBuild.status === 'failed'  ? 'bg-red-900/40 text-red-400' :
                    'text-[--bb-text3]'
                  }`} style={lastBuild.status === 'cancelled' ? { background: 'var(--bb-raised)' } : {}}>
                    {lastBuild.status.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-[11px]">
                  {[['Source', lastBuild.source], ['Blocks', lastBuild.blocksPlanned], ['Attempts', lastBuild.attempts], ['Replans', lastBuild.replans]].map(([k, v]) => (
                    <div key={k as string}>
                      <p style={{ color: 'var(--bb-text4)' }}>{k}</p>
                      <p className="font-medium" style={{ color: 'var(--bb-text2)' }}>{v}</p>
                    </div>
                  ))}
                </div>
                {lastBuild.failureReason && (
                  <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-950/20 border border-red-700/30 rounded text-xs text-red-400">
                    <AlertTriangle size={11} />
                    {lastBuild.failureReason}
                  </div>
                )}
                <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--bb-text4)' }}>
                  <Clock size={10} />
                  {lastBuild.timestamp.toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center py-4">
                <p className="text-xs" style={{ color: 'var(--bb-text4)' }}>No builds yet. Launch the bot and submit a build prompt.</p>
              </div>
            )}
          </div>
        </div>

        {/* Warnings */}
        <div className="rounded-md p-3 flex flex-col gap-2 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
          <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Recent Warnings</p>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--bb-text3)' }}>
            <CheckCircle2 size={12} className="text-green-500" />
            No recent errors or warnings.
          </div>
        </div>
      </div>
    </div>
  );
}
