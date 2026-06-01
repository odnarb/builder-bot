import { useState, useEffect } from 'react';
import { Rocket, ChevronDown, ChevronRight, CheckCircle2, Loader2, Circle, AlertTriangle } from 'lucide-react';
import { BotStatus, LaunchConfig } from './types';

const LAUNCH_STEPS = [
  { key: 'prepare', label: 'Preparing environment' },
  { key: 'spawn',   label: 'Starting bot process' },
  { key: 'connect', label: 'Connecting to Minecraft server' },
  { key: 'login',   label: 'Logged in' },
  { key: 'ws',      label: 'WebSocket ready' },
  { key: 'ready',   label: 'Ready' },
];

type StepStatus = 'pending' | 'active' | 'done' | 'error';

const DEFAULT_CONFIG: LaunchConfig = {
  serverIp: 'play.example.com',
  port: '25565',
  version: '1.20.1',
  botName: 'BuilderBot',
  commanderUuid: '',
  authMode: 'offline',
  apiUrl: 'http://localhost:3000',
};

function loadConfig(): LaunchConfig {
  try {
    const saved = localStorage.getItem('launchConfig');
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CONFIG;
}

interface LaunchScreenProps {
  botStatus: BotStatus;
  isElectron: boolean;
  onLaunch: (config: LaunchConfig) => void;
  onStop: () => void;
}

export function LaunchScreen({ botStatus, isElectron, onLaunch, onStop }: LaunchScreenProps) {
  const [config, setConfig] = useState<LaunchConfig>(loadConfig);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof LaunchConfig, string>>>({});
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({});

  const isLaunching = botStatus === 'launching';
  const isRunning = botStatus === 'connected' || botStatus === 'building';

  useEffect(() => {
    if (botStatus === 'launching') {
      const steps = LAUNCH_STEPS.map(s => s.key);
      let i = 0;
      setStepStatuses({ [steps[0]]: 'active' });
      const interval = setInterval(() => {
        i++;
        if (i >= steps.length) { clearInterval(interval); return; }
        setStepStatuses(prev => ({ ...prev, [steps[i - 1]]: 'done', [steps[i]]: 'active' }));
      }, 900);
      return () => clearInterval(interval);
    }
    if (botStatus === 'connected') {
      const all: Record<string, StepStatus> = {};
      LAUNCH_STEPS.forEach(s => { all[s.key] = 'done'; });
      setStepStatuses(all);
    }
    if (botStatus === 'offline' || botStatus === 'stopped') {
      setStepStatuses({});
    }
  }, [botStatus]);

  function setField<K extends keyof LaunchConfig>(key: K, value: LaunchConfig[K]) {
    setConfig(prev => {
      const next = { ...prev, [key]: value };
      localStorage.setItem('launchConfig', JSON.stringify(next));
      return next;
    });
    setErrors(prev => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const newErrors: typeof errors = {};
    if (!config.serverIp.trim()) newErrors.serverIp = 'Required';
    const portNum = parseInt(config.port);
    if (!config.port || isNaN(portNum) || portNum < 1 || portNum > 65535) newErrors.port = 'Must be 1–65535';
    if (!config.botName.trim()) newErrors.botName = 'Required';
    if (!config.commanderUuid.trim()) newErrors.commanderUuid = 'Required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  const inputStyle = {
    background: 'var(--bb-input)',
    borderColor: 'var(--bb-border2)',
    color: 'var(--bb-text1)',
  };

  function Field({ label, fieldKey, placeholder, type = 'text', disabled }: {
    label: string; fieldKey: keyof LaunchConfig; placeholder?: string; type?: string; disabled?: boolean;
  }) {
    const err = errors[fieldKey];
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[11px] font-medium" style={{ color: 'var(--bb-text3)' }}>{label}</label>
        <input
          type={type}
          value={config[fieldKey] as string}
          onChange={e => setField(fieldKey, e.target.value)}
          placeholder={placeholder}
          disabled={disabled || isLaunching || isRunning}
          className="px-2.5 py-2 border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed placeholder-[--bb-text4]"
          style={{ ...inputStyle, borderColor: err ? '#dc2626' : 'var(--bb-border2)' }}
        />
        {err && <p className="text-[11px] text-red-500">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
      {/* Left: form */}
      <div className="flex flex-col flex-1 overflow-auto p-4 gap-4 max-w-xl border-r" style={{ borderColor: 'var(--bb-border)' }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Launch Bot</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--bb-text3)' }}>Configure the Minecraft bot and start it.</p>
        </div>

        {!isElectron && (
          <div className="flex items-center gap-2 px-3 py-2.5 bg-yellow-950/20 border border-yellow-600/30 rounded-md">
            <AlertTriangle size={13} className="text-yellow-500 shrink-0" />
            <span className="text-xs text-yellow-600">Electron runtime required to launch the bot process.</span>
          </div>
        )}

        <div className="rounded-md p-3 flex flex-col gap-3 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
          <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Minecraft Server</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2"><Field label="Server IP" fieldKey="serverIp" placeholder="play.example.com" /></div>
            <Field label="Port" fieldKey="port" placeholder="25565" />
          </div>
          <Field label="Minecraft Version" fieldKey="version" placeholder="1.20.1" />
        </div>

        <div className="rounded-md p-3 flex flex-col gap-3 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
          <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Bot Identity</p>
          <Field label="Bot Name" fieldKey="botName" placeholder="BuilderBot" />
          <Field label="Commander UUID" fieldKey="commanderUuid" placeholder="your-player-uuid" />
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium" style={{ color: 'var(--bb-text3)' }}>Auth Mode</label>
            <select
              value={config.authMode}
              onChange={e => setField('authMode', e.target.value as LaunchConfig['authMode'])}
              disabled={isLaunching || isRunning}
              className="px-2.5 py-2 border rounded-md text-xs focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={inputStyle}
            >
              <option value="offline">Offline (no auth)</option>
              <option value="microsoft">Microsoft</option>
              <option value="mojang">Mojang</option>
            </select>
          </div>
        </div>

        {/* Advanced */}
        <div className="rounded-md border overflow-hidden" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs transition-colors"
            style={{ color: 'var(--bb-text3)' }}
          >
            {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Advanced options
          </button>
          {showAdvanced && (
            <div className="px-3 pb-3 flex flex-col gap-3 border-t pt-3" style={{ borderColor: 'var(--bb-border)' }}>
              <Field label="API URL" fieldKey="apiUrl" placeholder="http://localhost:3000" />
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium" style={{ color: 'var(--bb-text3)' }}>WebSocket Status</label>
                <div className="px-2.5 py-2 border rounded-md text-xs font-mono" style={{ background: 'var(--bb-bg)', borderColor: 'var(--bb-border)', color: 'var(--bb-text4)' }}>
                  Read-only — configured by API server
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {!isRunning ? (
            <button
              onClick={() => { if (validate()) onLaunch(config); }}
              disabled={!isElectron || isLaunching}
              className="flex items-center gap-2 px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-md transition-colors"
            >
              {isLaunching ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
              {isLaunching ? 'Launching...' : 'Launch Bot'}
            </button>
          ) : (
            <button
              onClick={onStop}
              className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded-md transition-colors"
            >
              Stop Bot
            </button>
          )}
        </div>
      </div>

      {/* Right: progress */}
      <div className="w-64 shrink-0 p-4 flex flex-col gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--bb-text4)' }}>Launch Progress</p>
        <div className="flex flex-col gap-1">
          {LAUNCH_STEPS.map((step) => {
            const state = stepStatuses[step.key] ?? 'pending';
            return (
              <div key={step.key} className="flex items-center gap-2.5 py-1.5">
                {state === 'done'    && <CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                {state === 'active'  && <Loader2 size={14} className="text-yellow-500 animate-spin shrink-0" />}
                {state === 'error'   && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                {state === 'pending' && <Circle size={14} className="shrink-0" style={{ color: 'var(--bb-border2)' }} />}
                <span className="text-xs" style={{
                  color: state === 'done' ? 'var(--bb-text2)' :
                         state === 'active' ? '#eab308' :
                         state === 'error' ? '#ef4444' :
                         'var(--bb-text4)',
                  fontWeight: state === 'active' ? 500 : 400,
                }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {botStatus === 'connected' && (
          <div className="mt-2 px-3 py-2.5 bg-green-950/20 border border-green-600/30 rounded-md">
            <p className="text-xs text-green-600 font-medium">Bot is connected and ready.</p>
          </div>
        )}

        <div className="mt-auto">
          <p className="text-[11px]" style={{ color: 'var(--bb-text4)' }}>Settings are saved automatically for next launch.</p>
        </div>
      </div>
    </div>
  );
}
