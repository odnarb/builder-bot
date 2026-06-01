import React, { useContext, useEffect, useMemo, useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';

import WebSocketProvider, { WebSocketContext } from './components/WebSocketProvider';
import { fetchAuthorizedJson, fetchJson } from './components/apiFetch';

const isElectronRuntime = () => Boolean(window.electronAPI?.launchBot);

const NAV_ITEMS = [
  ['dashboard', 'Dashboard', '▦'],
  ['launch', 'Launch', '↗'],
  ['build', 'Build', '◆'],
  ['console', 'Console', '▤'],
  ['history', 'History', '◷'],
  ['community', 'Community', '◇'],
  ['settings', 'Settings', '⚙'],
];

const DEFAULT_LAUNCH = {
  commanderUUID: 'd32f0358-7604-3be7-b35b-6f8e6ec02e05',
  mcHostIp: '127.0.0.1',
  mcHostPort: '25565',
  mcHostVersion: '1.20.4',
  botName: 'BuilderBot',
};

function loadLaunchDefaults() {
  try {
    return { ...DEFAULT_LAUNCH, ...JSON.parse(window.localStorage.getItem('builderbot.launch') || '{}') };
  } catch {
    return DEFAULT_LAUNCH;
  }
}

function saveLaunchDefaults(nextConfig) {
  window.localStorage.setItem('builderbot.launch', JSON.stringify(nextConfig));
}

function ShellButton({ children, tone = 'secondary', className = '', ...props }) {
  const toneClass = {
    primary: 'bb-button-primary',
    danger: 'bb-button-danger',
    secondary: 'bb-button-secondary',
    quiet: 'bb-button-quiet',
  }[tone];

  return (
    <button type="button" className={`bb-button ${toneClass} ${className}`} {...props}>
      {children}
    </button>
  );
}

function StatusPill({ label, status = 'neutral' }) {
  return (
    <span className={`bb-pill bb-pill-${status}`}>
      <span className="bb-dot" />
      {label}
    </span>
  );
}

function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`bb-panel ${className}`}>
      <div className="bb-panel-header">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div className="bb-metric">
      <div className="bb-muted-label">{label}</div>
      <div className="bb-metric-value">{value}</div>
      {sub && <div className="bb-subtle">{sub}</div>}
    </div>
  );
}

function TextInput({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <label className="bb-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder = '' }) {
  return (
    <label className="bb-field">
      <span>{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function JsonDetails({ title, value }) {
  return (
    <details className="bb-json">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value || {}, null, 2)}</pre>
    </details>
  );
}

function LoadingScreen({ text = 'Loading BuilderBot...' }) {
  return (
    <div className="bb-auth-screen">
      <div className="bb-logo-mark">B</div>
      <p>{text}</p>
    </div>
  );
}

function TitleBar({ botStatus, serverTarget, tier, wsConnected, user, onLogout }) {
  const statusTone = botStatus === 'running'
    ? 'success'
    : botStatus === 'launching'
      ? 'warning'
      : botStatus === 'error'
        ? 'danger'
        : 'neutral';

  return (
    <header className="bb-titlebar">
      <div className="bb-title-left">
        <div className="bb-logo-mark">B</div>
        <strong>BuilderBot</strong>
        <StatusPill label={botStatus} status={statusTone} />
      </div>
      <div className="bb-title-center">
        <span>{serverTarget || 'No server selected'}</span>
        <StatusPill label={wsConnected ? 'Bot WS' : 'No bot WS'} status={wsConnected ? 'success' : 'neutral'} />
        <span className="bb-tier">{tier || 'free'}</span>
      </div>
      <div className="bb-title-actions">
        <span className="bb-user-name">{user?.name || user?.email}</span>
        <ShellButton tone="quiet" onClick={onLogout}>Log out</ShellButton>
        <button type="button" aria-label="Minimize" onClick={() => window.electronAPI?.window?.minimize()}>−</button>
        <button type="button" aria-label="Maximize" onClick={() => window.electronAPI?.window?.maximize()}>□</button>
        <button type="button" aria-label="Close" onClick={() => window.electronAPI?.window?.close()}>×</button>
      </div>
    </header>
  );
}

function Sidebar({ active, tier, onNavigate }) {
  return (
    <aside className="bb-sidebar">
      <div className="bb-sidebar-label">Navigation</div>
      {NAV_ITEMS.map(([id, label, icon]) => (
        <button
          key={id}
          type="button"
          className={active === id ? 'active' : ''}
          onClick={() => onNavigate(id)}
        >
          <span>{icon}</span>
          {label}
        </button>
      ))}
      {tier === 'admin' && (
        <button
          type="button"
          className={active === 'admin' ? 'active' : ''}
          onClick={() => onNavigate('admin')}
        >
          <span>!</span>
          Admin
        </button>
      )}
    </aside>
  );
}

function DashboardScreen({ botStatus, tier, builds, isElectron, onNavigate, onStop, sendMessage }) {
  const isRunning = botStatus === 'running';
  const successCount = builds.filter((build) => build.success === true).length;
  const localCount = builds.filter((build) => build.planSource === 'local').length;
  const lastBuild = builds[0];

  return (
    <div className="bb-screen">
      {!isElectron && (
        <div className="bb-warning">
          Desktop controls require Electron. Launch/Stop will stay disabled in browser mode.
        </div>
      )}

      <Panel
        title="Bot Status"
        action={isRunning
          ? <ShellButton tone="danger" onClick={onStop}>Stop Bot</ShellButton>
          : <ShellButton tone="primary" disabled={!isElectron} onClick={() => onNavigate('launch')}>Launch Bot</ShellButton>}
      >
        <div className="bb-status-hero">
          <div>
            <div className="bb-muted-label">Current state</div>
            <div className={`bb-status-word bb-status-${botStatus}`}>{botStatus}</div>
            <p>{isRunning ? 'Bot is ready for commands.' : 'Launch the bot to connect to a Minecraft server.'}</p>
          </div>
          <div className="bb-action-row">
            <ShellButton disabled={!isRunning} onClick={() => onNavigate('build')}>Build</ShellButton>
            <ShellButton disabled={!isRunning} onClick={() => sendMessage({ type: 'get_position' })}>Get Position</ShellButton>
            <ShellButton disabled={!isRunning} onClick={() => sendMessage({ type: 'get_inventory' })}>Inventory</ShellButton>
            <ShellButton onClick={() => onNavigate('console')}>Console</ShellButton>
          </div>
        </div>
      </Panel>

      <div className="bb-grid-4">
        <Metric label="Tier" value={(tier || 'free').toUpperCase()} sub="Current account" />
        <Metric label="Total Builds" value={builds.length} sub="Recent history" />
        <Metric label="Success Rate" value={builds.length ? `${Math.round((successCount / builds.length) * 100)}%` : '—'} />
        <Metric label="Local Plans" value={localCount} sub="AI calls avoided" />
      </div>

      <div className="bb-grid-2">
        <Panel title="Last Build">
          {lastBuild ? (
            <div className="bb-list-item">
              <strong>{lastBuild.prompt || lastBuild.message || 'Build request'}</strong>
              <span>{lastBuild.success === false ? 'Failed' : 'Completed'} · {lastBuild.planSource || 'unknown source'}</span>
            </div>
          ) : (
            <p className="bb-empty">No builds yet.</p>
          )}
        </Panel>
        <Panel title="Warnings">
          <p className="bb-empty">No current warnings.</p>
        </Panel>
      </div>
    </div>
  );
}

function LaunchScreen({ botStatus, authToken, userId, onLaunch, onStop, isElectron }) {
  const [form, setForm] = useState(loadLaunchDefaults);
  const isRunning = botStatus === 'running';
  const isLaunching = botStatus === 'launching';

  const update = (key, value) => {
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      saveLaunchDefaults(next);
      return next;
    });
  };

  const submit = () => {
    onLaunch({ ...form, authToken, userId });
  };

  return (
    <div className="bb-screen bb-split-screen">
      <div className="bb-stack">
        <Panel title="Minecraft Server">
          <div className="bb-form-grid">
            <TextInput label="Server IP" value={form.mcHostIp} onChange={(value) => update('mcHostIp', value)} />
            <TextInput label="Port" value={form.mcHostPort} onChange={(value) => update('mcHostPort', value)} />
            <TextInput label="Minecraft Version" value={form.mcHostVersion} onChange={(value) => update('mcHostVersion', value)} />
          </div>
        </Panel>
        <Panel title="Bot Identity">
          <div className="bb-form-grid">
            <TextInput label="Bot Name" value={form.botName} onChange={(value) => update('botName', value)} />
            <TextInput label="Commander UUID" value={form.commanderUUID} onChange={(value) => update('commanderUUID', value)} />
          </div>
        </Panel>
        <div className="bb-action-row">
          {isRunning ? (
            <ShellButton tone="danger" onClick={onStop}>Stop Bot</ShellButton>
          ) : (
            <ShellButton tone="primary" disabled={!isElectron || isLaunching} onClick={submit}>
              {isLaunching ? 'Launching...' : 'Launch Bot'}
            </ShellButton>
          )}
        </div>
        {!isElectron && <div className="bb-warning">Electron runtime is required to spawn the bot process.</div>}
      </div>
      <Panel title="Launch Progress" className="bb-progress-panel">
        {['Preparing environment', 'Starting bot process', 'Connecting to Minecraft server', 'Logged in', 'WebSocket ready', 'Ready'].map((step, index) => (
          <div key={step} className={`bb-progress-step ${isRunning || (isLaunching && index < 3) ? 'done' : ''}`}>
            <span />
            {step}
          </div>
        ))}
      </Panel>
    </div>
  );
}

function BuildScreen({ botStatus, sendMessage }) {
  const [prompt, setPrompt] = useState('');
  const canBuild = botStatus === 'running';
  const localLikely = /\b(cube|box|floor|platform|bridge|road|path|wall|door|window|fence|pillar|tower|stairs|tunnel|arch|roof|farm|garden|room|house)\b/i.test(prompt);

  const submit = () => {
    if (!prompt.trim()) return;
    sendMessage({ type: 'chat_command', message: `build ${prompt.trim()}` });
    setPrompt('');
  };

  return (
    <div className="bb-screen">
      <Panel title="Build Command">
        <div className="bb-build-composer">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe what BuilderBot should build..."
          />
          <div className="bb-action-row">
            <StatusPill label={localLikely ? 'Local planner likely' : 'AI likely needed'} status={localLikely ? 'success' : 'warning'} />
            <ShellButton tone="primary" disabled={!canBuild || !prompt.trim()} onClick={submit}>Send Build</ShellButton>
          </div>
        </div>
      </Panel>
      <Panel title="Current Build">
        <p className="bb-empty">{canBuild ? 'Ready for a build prompt.' : 'Launch the bot before submitting builds.'}</p>
      </Panel>
    </div>
  );
}

function ConsoleScreen({ messages }) {
  return (
    <div className="bb-screen">
      <Panel title="Live Console">
        <div className="bb-console">
          {messages.length === 0 ? (
            <p>No bot activity yet.</p>
          ) : messages.map((message, index) => (
            <div key={`${index}-${message.type || 'message'}`} className={message.type === 'error' ? 'error' : ''}>
              <span>{new Date(message.timestamp || Date.now()).toLocaleTimeString()}</span>
              <code>{JSON.stringify(message)}</code>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function HistoryScreen({ builds, selectedBuild, setSelectedBuild, getAccessTokenSilently }) {
  const openBuild = async (build) => {
    setSelectedBuild(build);
    const buildId = build?.id || build?.buildId;
    if (!buildId) return;
    try {
      const detail = await fetchAuthorizedJson(getAccessTokenSilently, `/api/user/build/${buildId}`);
      setSelectedBuild({ ...build, detail });
    } catch {
      setSelectedBuild(build);
    }
  };

  return (
    <div className="bb-screen bb-history-grid">
      <Panel title="Build History">
        <div className="bb-list">
          {builds.length === 0 && <p className="bb-empty">No builds recorded yet.</p>}
          {builds.map((build, index) => (
            <button key={build.id || build.buildId || index} type="button" className="bb-list-item" onClick={() => openBuild(build)}>
              <strong>{build.prompt || build.message || `Build ${index + 1}`}</strong>
              <span>{build.planSource || 'unknown'} · {build.success === false ? 'failed' : 'complete'}</span>
            </button>
          ))}
        </div>
      </Panel>
      <Panel title="Details">
        {selectedBuild ? <JsonDetails title="Selected Build JSON" value={selectedBuild} /> : <p className="bb-empty">Select a build.</p>}
      </Panel>
    </div>
  );
}

function CommunityScreen({ getAccessTokenSilently }) {
  const [data, setData] = useState({ referral: null, phrasePacks: [], listings: [] });
  const [redeemCode, setRedeemCode] = useState('');
  const [phraseForm, setPhraseForm] = useState({ name: '', phrases: '' });
  const [listingForm, setListingForm] = useState({ title: '', description: '', priceUsd: '' });
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setError('');
      const [referral, phrasePacks, listings] = await Promise.all([
        fetchAuthorizedJson(getAccessTokenSilently, '/api/community/referral/summary'),
        fetchAuthorizedJson(getAccessTokenSilently, '/api/community/phrase-packs'),
        fetchJson('/api/community/marketplace/listings?limit=8'),
      ]);
      setData({ referral, phrasePacks: phrasePacks.packs || [], listings: listings.listings || [] });
    } catch (refreshError) {
      setError(refreshError?.message || 'Failed to load community data.');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const createReferralCode = async () => {
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/referral/code', { method: 'POST' });
    await refresh();
  };

  const redeemReferral = async () => {
    if (!redeemCode.trim()) return;
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/referral/redeem', {
      method: 'POST',
      body: JSON.stringify({ code: redeemCode.trim() }),
    });
    setRedeemCode('');
    await refresh();
  };

  const savePhrasePack = async () => {
    const phrases = phraseForm.phrases.split('\n').map((phrase) => phrase.trim()).filter(Boolean);
    if (!phraseForm.name.trim() || phrases.length === 0) return;
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/phrase-pack', {
      method: 'POST',
      body: JSON.stringify({ name: phraseForm.name, phrases }),
    });
    setPhraseForm({ name: '', phrases: '' });
    await refresh();
  };

  const createListing = async () => {
    if (!listingForm.title.trim()) return;
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/marketplace/listing', {
      method: 'POST',
      body: JSON.stringify({
        title: listingForm.title,
        description: listingForm.description,
        priceUsd: Number(listingForm.priceUsd) || 0,
      }),
    });
    setListingForm({ title: '', description: '', priceUsd: '' });
    await refresh();
  };

  return (
    <div className="bb-screen">
      {error && <div className="bb-error">{error}</div>}
      <div className="bb-grid-3">
        <Metric label="Referral Code" value={data.referral?.summary?.code || 'None'} />
        <Metric label="Phrase Packs" value={data.phrasePacks.length} />
        <Metric label="Listings" value={data.listings.length} />
      </div>
      <div className="bb-grid-3">
        <Panel title="Referral">
          <TextInput label="Redeem Code" value={redeemCode} onChange={setRedeemCode} />
          <div className="bb-action-row">
            <ShellButton onClick={createReferralCode}>Create Code</ShellButton>
            <ShellButton onClick={redeemReferral}>Redeem</ShellButton>
          </div>
        </Panel>
        <Panel title="Phrase Pack">
          <TextInput label="Name" value={phraseForm.name} onChange={(value) => setPhraseForm({ ...phraseForm, name: value })} />
          <TextArea label="Phrases" value={phraseForm.phrases} onChange={(value) => setPhraseForm({ ...phraseForm, phrases: value })} />
          <ShellButton onClick={savePhrasePack}>Save Pack</ShellButton>
        </Panel>
        <Panel title="Marketplace Listing">
          <TextInput label="Title" value={listingForm.title} onChange={(value) => setListingForm({ ...listingForm, title: value })} />
          <TextInput label="Price USD" type="number" value={listingForm.priceUsd} onChange={(value) => setListingForm({ ...listingForm, priceUsd: value })} />
          <TextArea label="Description" value={listingForm.description} onChange={(value) => setListingForm({ ...listingForm, description: value })} />
          <ShellButton onClick={createListing}>Create Listing</ShellButton>
        </Panel>
      </div>
      <Panel title="Marketplace">
        <div className="bb-list">
          {data.listings.length === 0 && <p className="bb-empty">No marketplace listings yet.</p>}
          {data.listings.map((listing) => (
            <div key={listing.id} className="bb-list-item">
              <strong>{listing.title}</strong>
              <span>{listing.description || 'No description'} · ${Number(listing.priceUsd || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function SettingsScreen({ getAccessTokenSilently }) {
  const [autoRenew, setAutoRenew] = useState(true);
  const [parentalControls, setParentalControls] = useState({ strictMode: false, blockedTopics: '' });
  const [ticket, setTicket] = useState({ type: 'cancel', reason: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [renewalPayload, controlsPayload] = await Promise.all([
          fetchAuthorizedJson(getAccessTokenSilently, '/api/user/subscription/renewal'),
          fetchAuthorizedJson(getAccessTokenSilently, '/api/user/parental-controls'),
        ]);
        setAutoRenew(renewalPayload.renewal?.autoRenew !== false);
        setParentalControls({
          strictMode: Boolean(controlsPayload.controls?.strictMode),
          blockedTopics: (controlsPayload.controls?.blockedTopics || []).join(', '),
        });
      } catch {
        // Keep local defaults when account settings are not available.
      }
    };
    loadSettings();
  }, [getAccessTokenSilently]);

  const saveRenewal = async () => {
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/subscription/renewal', {
      method: 'PUT',
      body: JSON.stringify({ autoRenew }),
    });
    setMessage('Renewal preference saved.');
  };

  const saveParentalControls = async () => {
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/parental-controls', {
      method: 'PUT',
      body: JSON.stringify({
        strictMode: parentalControls.strictMode,
        blockedTopics: parentalControls.blockedTopics.split(',').map((topic) => topic.trim()).filter(Boolean),
      }),
    });
    setMessage('Parental controls saved.');
  };

  const submitTicket = async () => {
    if (!ticket.reason.trim()) return;
    await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/subscription/ticket', {
      method: 'POST',
      body: JSON.stringify(ticket),
    });
    setTicket({ type: 'cancel', reason: '' });
    setMessage('Subscription ticket submitted.');
  };

  return (
    <div className="bb-screen">
      {message && <div className="bb-success">{message}</div>}
      <div className="bb-grid-2">
        <Panel title="Subscription">
          <label className="bb-field">
            <span>Renewal Preference</span>
            <select value={autoRenew ? 'auto_renew' : 'do_not_renew'} onChange={(event) => setAutoRenew(event.target.value === 'auto_renew')}>
              <option value="auto_renew">Auto renew</option>
              <option value="do_not_renew">Do not renew</option>
            </select>
          </label>
          <ShellButton onClick={saveRenewal}>Save Preference</ShellButton>
        </Panel>
        <Panel title="Cancel / Refund Ticket">
          <label className="bb-field">
            <span>Ticket Type</span>
            <select value={ticket.type} onChange={(event) => setTicket({ ...ticket, type: event.target.value })}>
              <option value="cancel">Cancel</option>
              <option value="refund">Refund</option>
            </select>
          </label>
          <TextArea label="Reason" value={ticket.reason} onChange={(reason) => setTicket({ ...ticket, reason })} />
          <ShellButton onClick={submitTicket}>Submit Ticket</ShellButton>
        </Panel>
        <Panel title="Parental Controls">
          <label className="bb-check-row">
            <input
              type="checkbox"
              checked={parentalControls.strictMode}
              onChange={(event) => setParentalControls({ ...parentalControls, strictMode: event.target.checked })}
            />
            Strict mode
          </label>
          <TextInput
            label="Blocked Topics"
            value={parentalControls.blockedTopics}
            onChange={(blockedTopics) => setParentalControls({ ...parentalControls, blockedTopics })}
            placeholder="comma-separated topics"
          />
          <ShellButton onClick={saveParentalControls}>Save Controls</ShellButton>
        </Panel>
      </div>
    </div>
  );
}

function AdminScreen({ getAccessTokenSilently }) {
  const endpoints = [
    ['ops', 'Ops', '/api/admin/ops-dashboard'],
    ['alerts', 'Alerts', '/api/admin/ops-alerts'],
    ['guard', 'Emergency Guard', '/api/admin/emergency-guard'],
    ['preScale', 'Pre-Scale', '/api/admin/pre-scale-telemetry'],
    ['margin', 'Margin', '/api/admin/margin-report'],
    ['incidents', 'Incidents', '/api/admin/incidents?limit=5'],
    ['abuse', 'Abuse', '/api/admin/abuse-analytics?limit=5'],
    ['security', 'Security', '/api/admin/security-audits?limit=5'],
  ];
  const [snapshots, setSnapshots] = useState({});
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setError('');
      const results = await Promise.all(endpoints.map(async ([key,, path]) => [
        key,
        await fetchAuthorizedJson(getAccessTokenSilently, path),
      ]));
      setSnapshots(Object.fromEntries(results));
    } catch (refreshError) {
      setError(refreshError?.message || 'Failed to load admin snapshots.');
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const resolveIncident = async (incidentId) => {
    if (!incidentId) return;
    try {
      await fetchAuthorizedJson(
        getAccessTokenSilently,
        `/api/admin/incidents/${encodeURIComponent(incidentId)}/resolve`,
        { method: 'POST' },
      );
      await refresh();
    } catch (resolveError) {
      setError(resolveError?.message || 'Failed to resolve incident.');
    }
  };

  const incidents = snapshots.incidents?.incidents || [];

  return (
    <div className="bb-screen">
      {error && <div className="bb-error">{error}</div>}
      <Panel title="Admin Operations" action={<ShellButton onClick={refresh}>Refresh</ShellButton>}>
        <div className="bb-grid-4">
          <Metric label="Sessions" value={snapshots.ops?.activeSessions ?? '—'} />
          <Metric label="Queue" value={snapshots.ops?.queueDepth ?? '—'} />
          <Metric label="Alerts" value={snapshots.alerts?.alerts?.length ?? 0} />
          <Metric label="Guard" value={snapshots.guard?.state?.active ? 'Active' : 'Normal'} />
        </div>
      </Panel>
      <Panel title="Incidents">
        <div className="bb-list">
          {incidents.length === 0 && <p className="bb-empty">No active incident records.</p>}
          {incidents.map((incident) => (
            <div key={incident.id} className="bb-list-item">
              <strong>{incident.code || incident.level || incident.id}</strong>
              <span>{incident.message || incident.status}</span>
              {incident.status !== 'resolved' && (
                <ShellButton onClick={() => resolveIncident(incident.id)}>Resolve</ShellButton>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <div className="bb-json-grid">
        {endpoints.map(([key, label]) => (
          <JsonDetails key={key} title={`${label} JSON`} value={snapshots[key]} />
        ))}
      </div>
    </div>
  );
}

function PlanChoice({ onSelect }) {
  const { getAccessTokenSilently } = useAuth0();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const plans = [
    ['starter', 'Starter', '$4.99/mo', '500-block builds + templates'],
    ['pro', 'Pro', '$12.99/mo', '2,000-block builds + AI chat'],
    ['admin', 'Admin', '$24.99/mo', 'Highest limits and admin tools'],
    ['free', 'Free', '$0', 'Limited 50-block builds'],
  ];

  const choose = async (tier) => {
    if (!accepted) {
      setError('Accept Terms and Privacy before choosing a plan.');
      return;
    }
    const token = await getAccessTokenSilently();
    await fetch('/api/user/policy/accept', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ termsVersion: '2026-02', privacyVersion: '2026-02' }),
    });
    if (tier === 'free') {
      await fetch('/api/user/plan', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      onSelect('free');
      return;
    }
    const response = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, termsVersion: '2026-02', privacyVersion: '2026-02' }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload?.error || 'Could not start checkout.');
      return;
    }
    window.location.href = payload.url;
  };

  return (
    <div className="bb-auth-screen bb-plan-screen">
      <div className="bb-logo-mark">B</div>
      <h1>Choose Your BuilderBot Plan</h1>
      <label className="bb-check-row">
        <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        I accept the Terms and Privacy policy.
      </label>
      {error && <div className="bb-error">{error}</div>}
      <div className="bb-grid-4">
        {plans.map(([tier, name, price, description]) => (
          <Panel key={tier} title={name}>
            <strong className="bb-plan-price">{price}</strong>
            <p>{description}</p>
            <ShellButton tone={tier === 'pro' ? 'primary' : 'secondary'} onClick={() => choose(tier)}>
              {tier === 'free' ? 'Continue Free' : 'Upgrade'}
            </ShellButton>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function CheckoutSuccessScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { getAccessTokenSilently } = useAuth0();

  useEffect(() => {
    const sessionId = params.get('session_id');
    if (!sessionId) return;
    const confirm = async () => {
      const token = await getAccessTokenSilently();
      await fetch('/api/stripe/confirm-checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      navigate('/');
      window.location.reload();
    };
    confirm();
  }, [params, navigate, getAccessTokenSilently]);

  return <LoadingScreen text="Processing payment..." />;
}

function AppWorkspace({ user, logout, tier, setTier, getAccessTokenSilently }) {
  const { messages, isConnected, sendMessage } = useContext(WebSocketContext);
  const [nav, setNav] = useState('dashboard');
  const [botStatus, setBotStatus] = useState('offline');
  const [serverTarget, setServerTarget] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [builds, setBuilds] = useState([]);
  const [selectedBuild, setSelectedBuild] = useState(null);
  const isElectron = isElectronRuntime();

  const refreshBuilds = async () => {
    try {
      const payload = await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/builds?limit=20');
      setBuilds(payload.builds || payload.rows || []);
    } catch {
      setBuilds([]);
    }
  };

  useEffect(() => {
    refreshBuilds();
  }, []);

  useEffect(() => {
    const loadToken = async () => {
      try {
        setAuthToken(await getAccessTokenSilently());
      } catch {
        setAuthToken('');
      }
    };
    loadToken();
  }, [getAccessTokenSilently]);

  useEffect(() => {
    if (!window.electronAPI?.onBotStatus) return;
    window.electronAPI.onBotStatus(({ status }) => {
      if (status === 'launching') setBotStatus('launching');
      if (status === 'running') setBotStatus('running');
      if (status === 'exited') setBotStatus('stopped');
    });
  }, []);

  const launchBot = (env) => {
    setServerTarget(`${env.mcHostIp}:${env.mcHostPort}`);
    setBotStatus('launching');
    window.electronAPI?.launchBot?.(env);
  };

  const stopBot = () => {
    window.electronAPI?.stopBot?.();
    setBotStatus('stopped');
  };

  const screen = useMemo(() => {
    if (nav === 'launch') {
      return <LaunchScreen botStatus={botStatus} authToken={authToken} userId={user?.sub} onLaunch={launchBot} onStop={stopBot} isElectron={isElectron} />;
    }
    if (nav === 'build') return <BuildScreen botStatus={botStatus} sendMessage={sendMessage} />;
    if (nav === 'console') return <ConsoleScreen messages={messages} />;
    if (nav === 'history') return <HistoryScreen builds={builds} selectedBuild={selectedBuild} setSelectedBuild={setSelectedBuild} getAccessTokenSilently={getAccessTokenSilently} />;
    if (nav === 'community') return <CommunityScreen getAccessTokenSilently={getAccessTokenSilently} />;
    if (nav === 'settings') return <SettingsScreen getAccessTokenSilently={getAccessTokenSilently} />;
    if (nav === 'admin' && tier === 'admin') return <AdminScreen getAccessTokenSilently={getAccessTokenSilently} />;
    return (
      <DashboardScreen
        botStatus={botStatus}
        tier={tier}
        builds={builds}
        isElectron={isElectron}
        onNavigate={setNav}
        onStop={stopBot}
        sendMessage={sendMessage}
      />
    );
  }, [nav, botStatus, authToken, user?.sub, isElectron, sendMessage, messages, builds, selectedBuild, getAccessTokenSilently, tier]);

  return (
    <div className="bb-app">
      <TitleBar
        botStatus={botStatus}
        serverTarget={serverTarget}
        tier={tier}
        wsConnected={isConnected}
        user={user}
        onLogout={() => logout({ logoutParams: { returnTo: window.location.origin } })}
      />
      <div className="bb-main">
        <Sidebar active={nav} tier={tier} onNavigate={setNav} />
        <main className="bb-content">{screen}</main>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { loginWithRedirect, logout, isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0();
  const [tier, setTier] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    const syncUserAndTier = async () => {
      try {
        const token = await getAccessTokenSilently();
        await fetch('/api/user/signup', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            name: user.name,
            auth0LoginId: user.sub,
            picture: user.picture,
          }),
        });
        const response = await fetch('/api/user/tier', { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json();
        setTier(payload?.tier || 'free');
      } catch {
        setTier('free');
      }
    };
    syncUserAndTier();
  }, [isAuthenticated, getAccessTokenSilently, user]);

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) {
    loginWithRedirect();
    return <LoadingScreen />;
  }
  if (!tier) return <LoadingScreen text="Loading account..." />;
  if (tier === 'pending') return <PlanChoice onSelect={setTier} />;

  return (
    <WebSocketProvider>
      <AppWorkspace
        user={user}
        logout={logout}
        tier={tier}
        setTier={setTier}
        getAccessTokenSilently={getAccessTokenSilently}
      />
    </WebSocketProvider>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/checkout/success" element={<CheckoutSuccessScreen />} />
        <Route path="*" element={<AuthenticatedApp />} />
      </Routes>
    </Router>
  );
}
