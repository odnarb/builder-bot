import { Minus, Square, X, Wifi, WifiOff, Sun, Moon } from 'lucide-react';
import { BotStatus, UserTier } from './types';

const STATUS_CONFIG: Record<BotStatus, { label: string; color: string; dot: string }> = {
  offline:   { label: 'Offline',   color: 'text-[--bb-text3]',  dot: 'bg-zinc-500' },
  launching: { label: 'Launching', color: 'text-yellow-500',    dot: 'bg-yellow-400 animate-pulse' },
  connected: { label: 'Connected', color: 'text-green-500',     dot: 'bg-green-400' },
  building:  { label: 'Building',  color: 'text-blue-500',      dot: 'bg-blue-400 animate-pulse' },
  error:     { label: 'Error',     color: 'text-red-500',       dot: 'bg-red-400' },
  stopped:   { label: 'Stopped',   color: 'text-[--bb-text3]',  dot: 'bg-zinc-500' },
};

interface TitleBarProps {
  botStatus: BotStatus;
  serverTarget: string;
  userTier: UserTier;
  wsConnected: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function TitleBar({ botStatus, serverTarget, userTier, wsConnected, theme, onToggleTheme }: TitleBarProps) {
  const status = STATUS_CONFIG[botStatus];

  return (
    <div
      className="flex items-center justify-between h-10 border-b px-3 shrink-0"
      style={{
        background: 'var(--bb-bar)',
        borderColor: 'var(--bb-border)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Left: identity + status */}
      <div className="flex items-center gap-2.5">
        <div className="w-4 h-4 rounded bg-green-500 flex items-center justify-center shrink-0">
          <span className="text-[8px] font-bold text-black">B</span>
        </div>
        <span className="text-xs font-semibold" style={{ color: 'var(--bb-text1)' }}>BuilderBot</span>
        <span style={{ color: 'var(--bb-border2)' }}>·</span>
        <div className={`flex items-center gap-1.5 text-xs font-medium ${status.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          {status.label}
        </div>
      </div>

      {/* Center: server + health */}
      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--bb-text3)' }}>
        {serverTarget && (
          <span className="font-mono" style={{ color: 'var(--bb-text2)' }}>{serverTarget}</span>
        )}
        <span style={{ color: 'var(--bb-border2)' }}>·</span>
        <div className="flex items-center gap-1">
          {wsConnected ? (
            <Wifi size={11} className="text-green-500" />
          ) : (
            <WifiOff size={11} style={{ color: 'var(--bb-text4)' }} />
          )}
          <span>{wsConnected ? 'API' : 'No API'}</span>
        </div>
        <span style={{ color: 'var(--bb-border2)' }}>·</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
          userTier === 'admin' ? 'bg-purple-900/30 text-purple-400' :
          userTier === 'pro'   ? 'bg-blue-900/30 text-blue-400' :
          'text-[--bb-text3]'
        }`} style={userTier === 'free' ? { background: 'var(--bb-raised)' } : {}}>
          {userTier}
        </span>
      </div>

      {/* Right: theme toggle + window controls */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-7 h-7 flex items-center justify-center rounded transition-colors mr-1"
          style={{ color: 'var(--bb-text3)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bb-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: 'var(--bb-text3)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bb-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => (window as any).electronAPI?.minimize?.()}
        >
          <Minus size={12} />
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: 'var(--bb-text3)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bb-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => (window as any).electronAPI?.maximize?.()}
        >
          <Square size={11} />
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center rounded transition-colors"
          style={{ color: 'var(--bb-text3)' }}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#dc2626';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--bb-text3)';
          }}
          onClick={() => (window as any).electronAPI?.close?.()}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
