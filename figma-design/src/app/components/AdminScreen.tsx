import { useState } from 'react';
import { Shield, TrendingUp, AlertTriangle, Users, DollarSign, Activity, ChevronDown, ChevronRight, Lock } from 'lucide-react';

function MetricCard({ label, value, sub, accent, icon }: { label: string; value: string; sub?: string; accent?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md p-3 flex flex-col gap-1 border" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--bb-text3)' }}>{label}</span>
        <span style={{ color: 'var(--bb-text4)' }}>{icon}</span>
      </div>
      <span className={`text-xl font-semibold ${accent ?? ''}`} style={accent ? {} : { color: 'var(--bb-text1)' }}>{value}</span>
      {sub && <span className="text-[11px]" style={{ color: 'var(--bb-text4)' }}>{sub}</span>}
    </div>
  );
}

interface AlertRow {
  id: string; level: 'critical' | 'warn' | 'info'; message: string; timestamp: Date; resolved: boolean;
}

const MOCK_ALERTS: AlertRow[] = [
  { id: '1', level: 'warn',     message: 'Build failure rate spiked to 34% in the last hour (baseline: 12%)',            timestamp: new Date(Date.now() - 3600000),  resolved: false },
  { id: '2', level: 'critical', message: 'Emergency guard triggered: 4 users hit global rate limit within 2 minutes',  timestamp: new Date(Date.now() - 7200000),  resolved: true },
  { id: '3', level: 'info',     message: 'Pre-scale telemetry: 78% CPU on API node. Auto-scaling threshold at 80%.',   timestamp: new Date(Date.now() - 10800000), resolved: false },
  { id: '4', level: 'warn',     message: 'Potential abuse: user abc-123 submitted 9 AI builds in 6 minutes',           timestamp: new Date(Date.now() - 14400000), resolved: false },
];

function JsonDetail({ label, data }: { label: string; data: object }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border overflow-hidden" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors" style={{ color: 'var(--bb-text3)' }}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {label}
      </button>
      {open && (
        <pre className="px-3 pb-3 text-[11px] font-mono overflow-auto border-t pt-2 max-h-48" style={{ borderColor: 'var(--bb-border)', color: 'var(--bb-text3)' }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AdminScreen() {
  return (
    <div className="flex flex-col h-full overflow-auto p-4 gap-4" style={{ background: 'var(--bb-bg)' }}>
      <div className="flex items-center gap-2">
        <Shield size={15} className="text-purple-500" />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--bb-text1)' }}>Admin — Operations Dashboard</h2>
        <span className="ml-auto text-[11px] flex items-center gap-1" style={{ color: 'var(--bb-text4)' }}>
          <Lock size={10} /> Read-only
        </span>
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 bg-purple-950/10 border border-purple-600/20 rounded-md">
        <AlertTriangle size={13} className="text-purple-500 shrink-0 mt-0.5" />
        <p className="text-xs text-purple-500">
          High-risk actions (emergency guard override, pre-scale triggers, data migration) are disabled in this view. Contact infrastructure team for manual execution.
        </p>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--bb-text4)' }}>Usage</p>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="DAU"          value="142"   sub="Daily Active Users"  icon={<Users size={13} />} />
          <MetricCard label="MAU"          value="1,204" icon={<Users size={13} />} />
          <MetricCard label="Total Builds" value="8,941" icon={<Activity size={13} />} />
          <MetricCard label="Success Rate" value="78%"   accent="text-green-500" icon={<TrendingUp size={13} />} />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--bb-text4)' }}>Costs & Revenue</p>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Revenue Today" value="$47.20" accent="text-green-500" icon={<DollarSign size={13} />} />
          <MetricCard label="Margin"        value="62%"    icon={<TrendingUp size={13} />} />
          <MetricCard label="Overage Cost"  value="$3.10"  accent="text-yellow-500" icon={<DollarSign size={13} />} />
          <MetricCard label="AI Savings"    value="70%"    sub="local vs AI calls" accent="text-blue-500" icon={<Activity size={13} />} />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--bb-text4)' }}>AI Call Breakdown (Today)</p>
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="AI Calls"        value="213"    accent="text-blue-500"   icon={<Activity size={13} />} />
          <MetricCard label="Local Calls"     value="501"    accent="text-green-500"  icon={<Activity size={13} />} />
          <MetricCard label="Emergency Guard" value="Active" accent="text-yellow-500" sub="Read-only state" icon={<Shield size={13} />} />
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--bb-text4)' }}>
          Alerts & Incidents
          <span className="ml-2 px-1.5 py-0.5 bg-red-600 text-white text-[10px] rounded">2 open</span>
        </p>
        <div className="rounded-md border overflow-hidden" style={{ background: 'var(--bb-surface)', borderColor: 'var(--bb-border)' }}>
          {MOCK_ALERTS.map((alert, i) => (
            <div key={alert.id} className={`flex items-start gap-3 px-3 py-2.5 ${alert.resolved ? 'opacity-40' : ''} ${i < MOCK_ALERTS.length - 1 ? 'border-b' : ''}`} style={{ borderColor: 'var(--bb-divider)' }}>
              <span className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${alert.level === 'critical' ? 'bg-red-500' : alert.level === 'warn' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
              <div className="flex-1">
                <p className="text-xs" style={{ color: 'var(--bb-text2)' }}>{alert.message}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--bb-text4)' }}>{alert.timestamp.toLocaleString()}{alert.resolved ? ' · Resolved' : ''}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--bb-text4)' }}>Data Drilldowns</p>
        <div className="flex flex-col gap-2">
          <JsonDetail label="Abuse / Security Audit Snapshot"  data={{ flaggedUsers: 3, blockedIPs: 0, rateLimitHits: 14, reviewQueue: 2 }} />
          <JsonDetail label="Pre-scale Telemetry"              data={{ cpuP90: '78%', memP90: '61%', reqPerMin: 342, queueDepth: 0, scaleThreshold: '80%' }} />
          <JsonDetail label="Conversion / Attribution"         data={{ trialConversions: 4, referrals: 11, topSource: 'discord', churnThisMonth: 2 }} />
        </div>
      </div>
    </div>
  );
}
