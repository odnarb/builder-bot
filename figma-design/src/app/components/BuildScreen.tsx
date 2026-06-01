import { useState } from 'react';
import { Hammer, Zap, Brain, AlertTriangle, CheckCircle2, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { BotStatus, BuildRecord } from './types';

const SAMPLE_PROMPTS = [
  'Build a 5x5 stone house with a roof',
  'Place a 3x3x3 cube of oak wood',
  'Create a simple bridge 10 blocks long',
];

interface BuildProgress {
  phase: 'idle' | 'planning' | 'executing' | 'done' | 'failed';
  blocksPlanned: number;
  blocksPlaced: number;
  source: 'local' | 'ai' | 'ai-patch';
  replans: number;
  attempts: number;
  failureReason?: string;
}

interface BuildScreenProps {
  botStatus: BotStatus;
  onBuildComplete: (record: BuildRecord) => void;
}

export function BuildScreen({ botStatus, onBuildComplete }: BuildScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [progress, setProgress] = useState<BuildProgress>({
    phase: 'idle', blocksPlanned: 0, blocksPlaced: 0, source: 'local', replans: 0, attempts: 0,
  });

  const isReady = botStatus === 'connected';
  const canSubmit = isReady && prompt.trim().length > 0 && progress.phase === 'idle';
  const isLocalEligible = prompt.length < 60 && !prompt.toLowerCase().includes('design');

  function handleSubmit() {
    if (!canSubmit) return;
    const start = Date.now();
    const source = isLocalEligible ? 'local' : 'ai';
    const blocksPlanned = Math.floor(Math.random() * 200) + 10;

    setProgress({ phase: 'planning', blocksPlanned: 0, blocksPlaced: 0, source, replans: 0, attempts: 1 });

    setTimeout(() => {
      setProgress(p => ({ ...p, phase: 'executing', blocksPlanned }));
      const interval = setInterval(() => {
        setProgress(p => {
          if (p.blocksPlaced >= blocksPlanned - 1) {
            clearInterval(interval);
            const success = Math.random() > 0.2;
            const record: BuildRecord = {
              id: crypto.randomUUID(),
              prompt,
              status: success ? 'success' : 'failed',
              source: p.source,
              blocksPlanned,
              attempts: p.attempts,
              replans: p.replans,
              failureReason: success ? undefined : 'Path obstructed at block 47. Replan limit reached.',
              timestamp: new Date(start),
              duration: Date.now() - start,
            };
            onBuildComplete(record);
            return { ...p, phase: success ? 'done' : 'failed', blocksPlaced: success ? blocksPlanned : p.blocksPlaced, failureReason: record.failureReason };
          }
          return { ...p, blocksPlaced: p.blocksPlaced + Math.floor(Math.random() * 5) + 1 };
        });
      }, 120);
    }, 1800);
  }

  function handleReset() {
    setProgress({ phase: 'idle', blocksPlanned: 0, blocksPlaced: 0, source: 'local', replans: 0, attempts: 0 });
    setPrompt('');
  }

  const pct = progress.blocksPlanned > 0 ? Math.min(100, Math.round((progress.blocksPlaced / progress.blocksPlanned) * 100)) : 0;

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
      {/* Left */}
      <div className="flex flex-col flex-1 p-4 gap-4 overflow-auto border-r max-w-xl" style={{ borderColor: 'var(--bb-border)' }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Build</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--bb-text3)' }}>Describe what you want the bot to build.</p>
        </div>

        {botStatus !== 'connected' && botStatus !== 'building' && (
          <div className="flex items-center gap-2 px-3 py-2.5 border rounded-md" style={{ background: 'var(--bb-raised)', borderColor: 'var(--bb-border)' }}>
            <AlertTriangle size={13} style={{ color: 'var(--bb-text3)' }} className="shrink-0" />
            <span className="text-xs" style={{ color: 'var(--bb-text3)' }}>Bot must be connected to submit builds.</span>
          </div>
        )}

        <div className="rounded-md p-3 flex flex-col gap-3 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Build Prompt</p>
            <div className="text-[11px]">
              {isLocalEligible
                ? <span className="flex items-center gap-1 text-green-500"><Zap size={11} />Local planner eligible</span>
                : <span className="flex items-center gap-1 text-blue-500"><Brain size={11} />AI likely needed</span>}
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={progress.phase !== 'idle'}
            placeholder="Build a 5x5 stone house with a wooden door..."
            rows={4}
            className="px-2.5 py-2 border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-zinc-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--bb-input)', borderColor: 'var(--bb-border2)', color: 'var(--bb-text1)' }}
          />

          <div className="flex flex-col gap-1">
            <p className="text-[10px]" style={{ color: 'var(--bb-text4)' }}>Quick prompts</p>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => setPrompt(p)}
                  disabled={progress.phase !== 'idle'}
                  className="px-2 py-1 border rounded text-[11px] transition-colors disabled:opacity-40"
                  style={{ background: 'var(--bb-raised)', borderColor: 'var(--bb-border2)', color: 'var(--bb-text3)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bb-hover)'; e.currentTarget.style.color = 'var(--bb-text1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bb-raised)'; e.currentTarget.style.color = 'var(--bb-text3)'; }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--bb-text4)' }}>
              <span>Tier limit: 10 builds/day</span>
              <span style={{ color: 'var(--bb-border2)' }}>·</span>
              <span className="text-green-500">8 remaining</span>
            </div>
            <div className="flex gap-2">
              {progress.phase !== 'idle' && (
                <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors" style={{ background: 'var(--bb-raised)', color: 'var(--bb-text2)' }}>
                  <RefreshCw size={11} /> Reset
                </button>
              )}
              <button onClick={handleSubmit} disabled={!canSubmit} className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-md transition-colors">
                <Hammer size={13} /> Submit Build
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right: progress */}
      <div className="w-72 shrink-0 p-4 flex flex-col gap-4 overflow-auto">
        <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Build Output</p>

        {progress.phase === 'idle' && (
          <div className="flex-1 flex items-center justify-center py-12">
            <p className="text-xs text-center" style={{ color: 'var(--bb-text4)' }}>Submit a prompt to begin building.</p>
          </div>
        )}

        {progress.phase !== 'idle' && (
          <div className="flex flex-col gap-3">
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-xs font-medium ${
              progress.phase === 'planning'  ? 'bg-yellow-950/20 border-yellow-600/30 text-yellow-500' :
              progress.phase === 'executing' ? 'bg-blue-950/20 border-blue-600/30 text-blue-500' :
              progress.phase === 'done'      ? 'bg-green-950/20 border-green-600/30 text-green-500' :
              'bg-red-950/20 border-red-600/30 text-red-500'
            }`}>
              {(progress.phase === 'planning' || progress.phase === 'executing') && <Loader2 size={13} className="animate-spin shrink-0" />}
              {progress.phase === 'done'   && <CheckCircle2 size={13} className="shrink-0" />}
              {progress.phase === 'failed' && <XCircle size={13} className="shrink-0" />}
              <span>
                {progress.phase === 'planning'  && 'Planning build...'}
                {progress.phase === 'executing' && 'Executing build...'}
                {progress.phase === 'done'      && 'Build complete'}
                {progress.phase === 'failed'    && 'Build failed'}
              </span>
            </div>

            <div className="rounded-md p-3 grid grid-cols-2 gap-y-2.5 gap-x-4 text-[11px] border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
              {[['Plan source', progress.source], ['Blocks planned', progress.blocksPlanned || '—'], ['Blocks placed', progress.blocksPlaced], ['Replans', progress.replans], ['Attempts', progress.attempts]].map(([k, v]) => (
                <div key={k as string}>
                  <p style={{ color: 'var(--bb-text4)' }}>{k}</p>
                  <p className="font-medium capitalize" style={{ color: 'var(--bb-text1)' }}>{v}</p>
                </div>
              ))}
            </div>

            {(progress.phase === 'executing' || progress.phase === 'done') && (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[11px]">
                  <span style={{ color: 'var(--bb-text3)' }}>Progress</span>
                  <span className="font-medium" style={{ color: 'var(--bb-text2)' }}>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bb-raised)' }}>
                  <div
                    className={`h-full rounded-full transition-all ${progress.phase === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {progress.phase === 'failed' && progress.failureReason && (
              <div className="px-3 py-2.5 bg-red-950/20 border border-red-600/30 rounded-md text-xs text-red-500">
                <p className="font-medium mb-0.5">Failure reason</p>
                <p>{progress.failureReason}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
