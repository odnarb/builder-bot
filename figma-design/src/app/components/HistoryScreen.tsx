import { useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Zap, Brain, ChevronRight, Clock, BarChart2 } from 'lucide-react';
import { BuildRecord } from './types';

const MOCK_HISTORY: BuildRecord[] = [
  { id: 'h1', prompt: 'Build a 5x5 stone house with a wooden door', status: 'success', source: 'local',    blocksPlanned: 47,  attempts: 1, replans: 1, timestamp: new Date(Date.now() - 3600000),   duration: 18200 },
  { id: 'h2', prompt: 'Create an ornate castle tower with battlements', status: 'failed', source: 'ai',   blocksPlanned: 312, attempts: 2, replans: 3, failureReason: 'Inventory missing cobblestone. Needed 200, had 12.', timestamp: new Date(Date.now() - 7200000),  duration: 45000 },
  { id: 'h3', prompt: 'Place a 3x3x3 cube of oak wood',               status: 'success', source: 'local',  blocksPlanned: 27,  attempts: 1, replans: 0, timestamp: new Date(Date.now() - 86400000),  duration: 4100 },
  { id: 'h4', prompt: 'Build a bridge across the ravine',              status: 'success', source: 'ai-patch', blocksPlanned: 90, attempts: 2, replans: 2, timestamp: new Date(Date.now() - 172800000), duration: 31000 },
  { id: 'h5', prompt: 'Create a simple nether portal frame',           status: 'cancelled', source: 'local', blocksPlanned: 14, attempts: 1, replans: 0, timestamp: new Date(Date.now() - 259200000), duration: 0 },
];

function formatDuration(ms: number) {
  if (ms === 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(d: Date) {
  const diff = Date.now() - d.getTime();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

interface HistoryScreenProps {
  builds?: BuildRecord[];
}

export function HistoryScreen({ builds = [] }: HistoryScreenProps) {
  const [selected, setSelected] = useState<BuildRecord | null>(null);
  const [showJson, setShowJson] = useState(false);

  const allBuilds = [...builds, ...MOCK_HISTORY].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const totalLocal   = allBuilds.filter(b => b.source === 'local').length;
  const totalAi      = allBuilds.filter(b => b.source !== 'local').length;
  const totalSuccess = allBuilds.filter(b => b.status === 'success').length;
  const successRate  = allBuilds.length ? Math.round((totalSuccess / allBuilds.length) * 100) : 0;

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
      {/* Left: list */}
      <div className="flex flex-col w-80 border-r overflow-hidden shrink-0" style={{ borderColor: 'var(--bb-border)' }}>
        {/* Aggregate */}
        <div className="p-3 border-b grid grid-cols-2 gap-2 shrink-0" style={{ borderColor: 'var(--bb-border)' }}>
          {[
            { label: 'Success Rate', value: `${successRate}%`, accent: 'text-green-500' },
            { label: 'AI Avoided',   value: totalLocal, accent: '' },
            { label: 'Local Plans',  value: totalLocal, accent: '' },
            { label: 'AI Plans',     value: totalAi,    accent: '' },
          ].map(m => (
            <div key={m.label} className="rounded-md p-2 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
              <p className="text-[10px]" style={{ color: 'var(--bb-text4)' }}>{m.label}</p>
              <p className={`text-base font-semibold ${m.accent}`} style={m.accent ? {} : { color: 'var(--bb-text1)' }}>{m.value}</p>
            </div>
          ))}
        </div>

        {/* Build list */}
        <div className="flex-1 overflow-auto">
          {allBuilds.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs" style={{ color: 'var(--bb-text4)' }}>No build history yet.</p>
            </div>
          ) : allBuilds.map(build => (
            <button
              key={build.id}
              onClick={() => setSelected(build)}
              className="w-full text-left px-3 py-2.5 border-b transition-colors"
              style={{
                borderColor: 'var(--bb-divider)',
                background: selected?.id === build.id ? 'var(--bb-selected)' : 'transparent',
                borderLeft: selected?.id === build.id ? '2px solid #3b82f6' : '2px solid transparent',
              }}
              onMouseEnter={e => { if (selected?.id !== build.id) e.currentTarget.style.background = 'var(--bb-raised)'; }}
              onMouseLeave={e => { if (selected?.id !== build.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <div className="flex items-start gap-2">
                {build.status === 'success'   && <CheckCircle2 size={13} className="text-green-500 shrink-0 mt-0.5" />}
                {build.status === 'failed'    && <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />}
                {build.status === 'cancelled' && <MinusCircle size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--bb-text4)' }} />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--bb-text1)' }}>{build.prompt}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] flex items-center gap-0.5 ${build.source === 'local' ? 'text-green-500' : 'text-blue-500'}`}>
                      {build.source === 'local' ? <Zap size={9} /> : <Brain size={9} />}
                      {build.source}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--bb-text4)' }}>{formatDate(build.timestamp)}</span>
                  </div>
                </div>
                <ChevronRight size={12} className="shrink-0 mt-1" style={{ color: 'var(--bb-text4)' }} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-auto p-4">
        {!selected ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs" style={{ color: 'var(--bb-text4)' }}>Select a build to view details.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 max-w-lg">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>{selected.prompt}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  selected.status === 'success'   ? 'bg-green-900/30 text-green-500' :
                  selected.status === 'failed'    ? 'bg-red-900/30 text-red-500' :
                  ''
                }`} style={selected.status === 'cancelled' ? { background: 'var(--bb-raised)', color: 'var(--bb-text3)' } : {}}>
                  {selected.status.toUpperCase()}
                </span>
                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--bb-text4)' }}>
                  <Clock size={10} /> {selected.timestamp.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="rounded-md p-3 grid grid-cols-3 gap-3 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
              {[
                { label: 'Source',         value: selected.source,                       accent: selected.source === 'local' ? 'text-green-500' : 'text-blue-500' },
                { label: 'Blocks Planned', value: selected.blocksPlanned,                accent: '' },
                { label: 'Duration',       value: formatDuration(selected.duration),     accent: '' },
                { label: 'Attempts',       value: selected.attempts,                     accent: '' },
                { label: 'Replans',        value: selected.replans,                      accent: '' },
                { label: 'Time',           value: selected.timestamp.toLocaleTimeString(), accent: '' },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-[11px]" style={{ color: 'var(--bb-text4)' }}>{item.label}</p>
                  <p className={`text-xs font-medium mt-0.5 capitalize ${item.accent}`} style={item.accent ? {} : { color: 'var(--bb-text2)' }}>{item.value}</p>
                </div>
              ))}
            </div>

            {selected.failureReason && (
              <div className="px-3 py-2.5 bg-red-950/20 border border-red-600/30 rounded-md">
                <p className="text-[11px] text-red-500 font-medium mb-1">Failure Reason</p>
                <p className="text-xs text-red-400">{selected.failureReason}</p>
              </div>
            )}

            <div className="rounded-md border overflow-hidden" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
              <button onClick={() => setShowJson(v => !v)} className="w-full flex items-center justify-between px-3 py-2 text-xs transition-colors" style={{ color: 'var(--bb-text3)' }}>
                <span>Raw record (JSON)</span>
                <BarChart2 size={12} />
              </button>
              {showJson && (
                <pre className="px-3 pb-3 text-[11px] font-mono overflow-auto border-t pt-2 max-h-48" style={{ borderColor: 'var(--bb-border)', color: 'var(--bb-text3)' }}>
                  {JSON.stringify(selected, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
