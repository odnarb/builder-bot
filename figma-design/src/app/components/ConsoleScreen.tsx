import { useState, useEffect, useRef } from 'react';
import { Copy, Trash2, Filter } from 'lucide-react';
import { LogEntry } from './types';

type FilterCategory = 'all' | 'bot' | 'build' | 'error' | 'api' | 'minecraft';

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  info:  'text-[--bb-text3]',
  warn:  'text-yellow-500',
  error: 'text-red-500',
  debug: 'text-[--bb-text4]',
};

const CAT_COLORS: Record<LogEntry['category'], string> = {
  bot:       'text-green-500',
  build:     'text-blue-500',
  api:       'text-purple-500',
  minecraft: 'text-orange-500',
  system:    'text-[--bb-text4]',
};

const MOCK_LOGS: LogEntry[] = [
  { id: '1',  timestamp: new Date(Date.now() - 62000), level: 'info',  category: 'system',    message: 'BuilderBot v2.1.0 starting...' },
  { id: '2',  timestamp: new Date(Date.now() - 61000), level: 'info',  category: 'api',       message: 'Connecting to API at http://localhost:3000' },
  { id: '3',  timestamp: new Date(Date.now() - 60000), level: 'info',  category: 'api',       message: 'API connection established. Session token acquired.' },
  { id: '4',  timestamp: new Date(Date.now() - 58000), level: 'info',  category: 'bot',       message: 'Spawning Mineflayer bot "BuilderBot" → play.example.com:25565' },
  { id: '5',  timestamp: new Date(Date.now() - 56000), level: 'info',  category: 'minecraft', message: 'Connected to Minecraft server (1.20.1)' },
  { id: '6',  timestamp: new Date(Date.now() - 55000), level: 'info',  category: 'bot',       message: 'Bot logged in. Position: x=0, y=64, z=0' },
  { id: '7',  timestamp: new Date(Date.now() - 54000), level: 'info',  category: 'api',       message: 'WebSocket handshake complete. Ready for commands.' },
  { id: '8',  timestamp: new Date(Date.now() - 30000), level: 'info',  category: 'build',     message: 'Build command received: "Build a 5x5 stone house"' },
  { id: '9',  timestamp: new Date(Date.now() - 29000), level: 'info',  category: 'build',     message: 'Local planner selected. Planning 47 blocks...' },
  { id: '10', timestamp: new Date(Date.now() - 28500), level: 'info',  category: 'build',     message: 'Plan generated in 312ms. Starting execution.' },
  { id: '11', timestamp: new Date(Date.now() - 20000), level: 'warn',  category: 'build',     message: 'Block obstruction at (2, 64, 3). Initiating replan.' },
  { id: '12', timestamp: new Date(Date.now() - 19500), level: 'info',  category: 'build',     message: 'Replan #1 complete. Resuming from block 18.' },
  { id: '13', timestamp: new Date(Date.now() - 5000),  level: 'info',  category: 'build',     message: 'Build complete. 47/47 blocks placed successfully.' },
  { id: '14', timestamp: new Date(Date.now() - 1000),  level: 'debug', category: 'api',       message: 'Heartbeat ping → 8ms' },
];

const FILTERS: { id: FilterCategory; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'bot', label: 'Bot' }, { id: 'build', label: 'Build' },
  { id: 'error', label: 'Error' }, { id: 'api', label: 'API' }, { id: 'minecraft', label: 'Minecraft' },
];

interface ConsoleScreenProps {
  externalLogs?: LogEntry[];
}

export function ConsoleScreen({ externalLogs = [] }: ConsoleScreenProps) {
  const [filter, setFilter] = useState<FilterCategory>('all');
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (externalLogs.length > 0) setLogs(prev => [...prev, ...externalLogs]);
  }, [externalLogs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const filtered = filter === 'all'
    ? logs
    : filter === 'error'
    ? logs.filter(l => l.level === 'error' || l.level === 'warn')
    : logs.filter(l => l.category === filter);

  function copyLogs() {
    const text = filtered.map(l => `[${l.timestamp.toISOString()}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
  }

  const errorCount = logs.filter(l => l.level === 'error').length;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0" style={{ borderColor: 'var(--bb-border)', background: 'var(--bb-surface)' }}>
        <div className="flex items-center gap-1.5">
          <Filter size={12} style={{ color: 'var(--bb-text4)' }} />
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
              style={{
                background: filter === f.id ? 'var(--bb-raised)' : 'transparent',
                color: filter === f.id ? 'var(--bb-text1)' : 'var(--bb-text3)',
              }}
            >
              {f.label}
              {f.id === 'error' && errorCount > 0 && (
                <span className="ml-1.5 px-1 py-0.5 rounded bg-red-600 text-white text-[9px]">{errorCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={copyLogs} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors" style={{ color: 'var(--bb-text3)' }}>
            <Copy size={11} /> Copy
          </button>
          <button onClick={() => setLogs([])} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors" style={{ color: 'var(--bb-text3)' }}>
            <Trash2 size={11} /> Clear
          </button>
        </div>
      </div>

      {/* Log table */}
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p style={{ color: 'var(--bb-text4)' }}>No log entries to display.</p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {filtered.map(log => (
                <tr
                  key={log.id}
                  className={`border-b ${log.level === 'error' ? 'bg-red-950/10' : log.level === 'warn' ? 'bg-yellow-950/5' : ''}`}
                  style={{ borderColor: 'var(--bb-divider)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bb-raised)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '')}
                >
                  <td className="px-3 py-1 whitespace-nowrap w-32 shrink-0" style={{ color: 'var(--bb-text4)' }}>
                    {log.timestamp.toLocaleTimeString()}
                  </td>
                  <td className="px-2 py-1 w-14 shrink-0">
                    <span className={`${LEVEL_COLORS[log.level]} uppercase text-[10px] font-semibold`}>{log.level}</span>
                  </td>
                  <td className="px-2 py-1 w-20 shrink-0">
                    <span className={`${CAT_COLORS[log.category]} text-[10px]`}>{log.category}</span>
                  </td>
                  <td className="px-2 py-1 break-all" style={{ color: 'var(--bb-text2)' }}>{log.message}</td>
                </tr>
              ))}
              <tr><td colSpan={4} ref={bottomRef as React.RefObject<HTMLTableCellElement>} /></tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Status strip */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t shrink-0" style={{ borderColor: 'var(--bb-border)', background: 'var(--bb-bar)' }}>
        <span className="text-[10px]" style={{ color: 'var(--bb-text4)' }}>{filtered.length} entries</span>
        <span className="text-[10px]" style={{ color: 'var(--bb-text4)' }}>Live · stdout/stderr from bot process</span>
      </div>
    </div>
  );
}
