import { useState } from 'react';
import { Save, RotateCcw, CheckCircle2 } from 'lucide-react';

const SECTIONS = [
  { id: 'minecraft',   label: 'Minecraft Defaults' },
  { id: 'bot',         label: 'Bot Defaults' },
  { id: 'api',         label: 'API / Backend' },
  { id: 'auth',        label: 'Auth / Session' },
  { id: 'safety',      label: 'Safety & Tier Limits' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

function Field({ label, value, onChange, type = 'text', placeholder, disabled, description }: {
  label: string; value: string; onChange?: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean; description?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium" style={{ color: 'var(--bb-text3)' }}>{label}</label>
      {description && <p className="text-[11px]" style={{ color: 'var(--bb-text4)' }}>{description}</p>}
      <input
        type={type} value={value} onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder} disabled={disabled}
        className="px-2.5 py-2 border rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: 'var(--bb-input)', borderColor: 'var(--bb-border2)', color: 'var(--bb-text1)' }}
      />
    </div>
  );
}

function Toggle({ label, value, onChange, description }: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <p className="text-xs" style={{ color: 'var(--bb-text1)' }}>{label}</p>
        {description && <p className="text-[11px] mt-0.5" style={{ color: 'var(--bb-text4)' }}>{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${value ? 'bg-blue-600' : ''}`}
        style={value ? {} : { background: 'var(--bb-border2)' }}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm ${value ? 'left-4' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

const DEFAULT_SETTINGS = {
  defaultServer: 'play.example.com', defaultPort: '25565', defaultVersion: '1.20.1',
  defaultBotName: 'BuilderBot', defaultAuth: 'offline', commandTimeout: '60',
  pathfindingTimeout: '30', apiUrl: 'http://localhost:3000', wsOrigin: 'http://localhost:3000',
  apiKey: '', sessionPersist: true, autoReconnect: false, maxBuildsPerDay: '10',
  maxBlocksPerBuild: '500', requireApproval: false, debugMode: false, verboseLogs: false, logRetention: '7',
};

type Settings = typeof DEFAULT_SETTINGS;
type SettingsKey = keyof Settings;

export function SettingsScreen() {
  const [activeSection, setActiveSection] = useState('minecraft');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  function update(key: SettingsKey, value: string | boolean) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    localStorage.setItem('appSettings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const panelStyle = { background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bb-bg)' }}>
      {/* Left nav */}
      <div className="w-48 shrink-0 border-r py-2 flex flex-col gap-0.5 px-2" style={{ borderColor: 'var(--bb-border)', background: 'var(--bb-bar)' }}>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className="w-full text-left px-2.5 py-2 rounded text-xs transition-colors"
            style={{
              background: activeSection === s.id ? 'var(--bb-raised)' : 'transparent',
              color: activeSection === s.id ? 'var(--bb-text1)' : 'var(--bb-text3)',
              fontWeight: activeSection === s.id ? 500 : 400,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {activeSection === 'minecraft' && (
          <>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Minecraft Defaults</h3>
            <div className="rounded-md p-3 flex flex-col gap-3 border" style={panelStyle}>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><Field label="Default Server IP" value={settings.defaultServer} onChange={v => update('defaultServer', v)} placeholder="play.example.com" /></div>
                <Field label="Default Port"       value={settings.defaultPort}    onChange={v => update('defaultPort', v)}    placeholder="25565" />
                <Field label="Minecraft Version"  value={settings.defaultVersion} onChange={v => update('defaultVersion', v)} placeholder="1.20.1" />
              </div>
            </div>
          </>
        )}

        {activeSection === 'bot' && (
          <>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Bot Defaults</h3>
            <div className="rounded-md p-3 flex flex-col gap-3 border" style={panelStyle}>
              <Field label="Default Bot Name" value={settings.defaultBotName} onChange={v => update('defaultBotName', v)} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Command Timeout (s)"     value={settings.commandTimeout}     onChange={v => update('commandTimeout', v)}     type="number" />
                <Field label="Pathfinding Timeout (s)" value={settings.pathfindingTimeout} onChange={v => update('pathfindingTimeout', v)} type="number" />
              </div>
              <div className="border-t pt-3" style={{ borderColor: 'var(--bb-border)' }}>
                <Toggle label="Auto-reconnect on disconnect" value={settings.autoReconnect} onChange={v => update('autoReconnect', v)} description="Attempt to reconnect if Minecraft connection drops." />
              </div>
            </div>
          </>
        )}

        {activeSection === 'api' && (
          <>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>API / Backend</h3>
            <div className="rounded-md p-3 flex flex-col gap-3 border" style={panelStyle}>
              <Field label="API URL"              value={settings.apiUrl}   onChange={v => update('apiUrl', v)}   placeholder="http://localhost:3000" />
              <Field label="WebSocket Origin"     value={settings.wsOrigin} onChange={v => update('wsOrigin', v)} placeholder="http://localhost:3000" />
              <Field label="API Key (optional)"   value={settings.apiKey}   onChange={v => update('apiKey', v)}   type="password" placeholder="sk-..." />
            </div>
          </>
        )}

        {activeSection === 'auth' && (
          <>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Auth / Session</h3>
            <div className="rounded-md p-3 border" style={panelStyle}>
              <Toggle label="Persist session across restarts" value={settings.sessionPersist} onChange={v => update('sessionPersist', v)} description="Store session token in local storage." />
            </div>
            <div className="rounded-md px-3 py-2.5 border" style={{ background: 'var(--bb-raised)', borderColor: 'var(--bb-border)' }}>
              <p className="text-xs" style={{ color: 'var(--bb-text3)' }}>Auth tokens are stored in memory only and cleared on bot stop. Session IDs use secure storage when Electron keychain is available.</p>
            </div>
          </>
        )}

        {activeSection === 'safety' && (
          <>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Safety & Tier Limits</h3>
            <div className="rounded-md p-3 flex flex-col gap-3 border" style={panelStyle}>
              <Field label="Max builds per day"   value={settings.maxBuildsPerDay}   onChange={v => update('maxBuildsPerDay', v)}   type="number" description="Leave empty for tier default." />
              <Field label="Max blocks per build" value={settings.maxBlocksPerBuild} onChange={v => update('maxBlocksPerBuild', v)} type="number" />
              <div className="border-t pt-3" style={{ borderColor: 'var(--bb-border)' }}>
                <Toggle label="Require approval before each build" value={settings.requireApproval} onChange={v => update('requireApproval', v)} description="Prompt confirmation before submitting to bot." />
              </div>
            </div>
          </>
        )}

        {activeSection === 'diagnostics' && (
          <>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Diagnostics</h3>
            <div className="rounded-md p-3 flex flex-col border" style={panelStyle}>
              <Toggle label="Debug mode"    value={settings.debugMode}    onChange={v => update('debugMode', v)}    description="Emit verbose debug output to console." />
              <div className="border-t pt-1" style={{ borderColor: 'var(--bb-border)' }}>
                <Toggle label="Verbose logs" value={settings.verboseLogs} onChange={v => update('verboseLogs', v)} description="Show all API requests and responses." />
              </div>
            </div>
            <div className="rounded-md p-3 flex flex-col gap-3 border" style={panelStyle}>
              <Field label="Log retention (days)" value={settings.logRetention} onChange={v => update('logRetention', v)} type="number" />
              <div className="flex gap-2">
                {['Open log folder', 'Export diagnostics'].map(lbl => (
                  <button key={lbl} className="px-3 py-1.5 rounded-md text-xs transition-colors" style={{ background: 'var(--bb-raised)', color: 'var(--bb-text2)' }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 pt-2">
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white text-xs font-medium rounded-md transition-colors">
            {saved ? <CheckCircle2 size={13} /> : <Save size={13} />}
            {saved ? 'Saved' : 'Save Settings'}
          </button>
          <button onClick={() => setSettings(DEFAULT_SETTINGS)} className="flex items-center gap-1.5 px-3 py-2 border rounded-md text-xs transition-colors" style={{ background: 'var(--bb-raised)', borderColor: 'var(--bb-border)', color: 'var(--bb-text3)' }}>
            <RotateCcw size={12} /> Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
