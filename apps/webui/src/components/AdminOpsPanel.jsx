import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocalization } from './LocalizationProvider';
import { ErrorBanner, JsonDetails, Panel, SecondaryButton, StatTile } from './DashboardPrimitives';
import { fetchAuthorizedJson } from './apiFetch';

const SNAPSHOT_ENDPOINTS = [
  { key: 'ops', label: 'Ops', path: '/api/admin/ops-dashboard' },
  { key: 'alerts', label: 'Alerts', path: '/api/admin/ops-alerts' },
  { key: 'marginAlerts', label: 'Margin Alerts', path: '/api/admin/margin-alerts' },
  { key: 'margin', label: 'Margin', path: '/api/admin/margin-report' },
  { key: 'usage', label: 'Usage', path: '/api/admin/usage-metering' },
  { key: 'overage', label: 'Overage', path: '/api/admin/overage-report' },
  { key: 'buildCosts', label: 'Build Costs', path: '/api/admin/build-costs?limit=10' },
  { key: 'emergencyGuard', label: 'Emergency Guard', path: '/api/admin/emergency-guard' },
  { key: 'preScale', label: 'Pre-Scale', path: '/api/admin/pre-scale-telemetry' },
  { key: 'performance', label: 'Performance', path: '/api/admin/performance-profile' },
  { key: 'simulations', label: 'Simulations', path: '/api/admin/pre-scale/simulations?limit=5' },
  { key: 'conversion', label: 'Conversion', path: '/api/admin/conversion-funnel' },
  { key: 'attribution', label: 'Attribution', path: '/api/admin/analytics/attribution?limit=5' },
  { key: 'referrals', label: 'Referrals', path: '/api/admin/analytics/referrals?limit=5' },
  { key: 'incidents', label: 'Incidents', path: '/api/admin/incidents?limit=5' },
  { key: 'abuse', label: 'Abuse', path: '/api/admin/abuse-analytics?limit=5' },
  { key: 'security', label: 'Security', path: '/api/admin/security-audits?limit=5' },
];

function formatNumber(value, t, suffix = '') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return t('common.unknown');
  }

  return `${value}${suffix}`;
}

function formatMoney(value, t) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return t('common.unknown');
  }

  return `$${value.toFixed(2)}`;
}

export default function AdminOpsPanel() {
  const { getAccessTokenSilently } = useAuth0();
  const { t } = useLocalization();
  const [snapshots, setSnapshots] = useState({});
  const [loading, setLoading] = useState(false);
  const [resolvingIncidentId, setResolvingIncidentId] = useState('');
  const [incidentStatus, setIncidentStatus] = useState('active');
  const [error, setError] = useState('');

  const ops = snapshots.ops || {};
  const alerts = Array.isArray(snapshots.alerts?.alerts) ? snapshots.alerts.alerts : [];
  const incidents = Array.isArray(snapshots.incidents?.incidents) ? snapshots.incidents.incidents : [];
  const activeIncidents = incidents.filter((incident) => incident.status !== 'resolved');
  const visibleIncidents = incidentStatus === 'all'
    ? incidents
    : incidents.filter((incident) => incident.status === incidentStatus);
  const abuse = snapshots.abuse || {};
  const securityEvents = Array.isArray(snapshots.security?.events) ? snapshots.security.events : [];
  const marginTotals = snapshots.margin?.totals || {};
  const marginAlerts = Array.isArray(snapshots.marginAlerts?.active) ? snapshots.marginAlerts.active : [];
  const guardState = snapshots.emergencyGuard?.state || {};
  const preScaleGuard = snapshots.preScale?.guard_state_effective || {};
  const simulationRuns = Array.isArray(snapshots.simulations?.runs) ? snapshots.simulations.runs : [];
  const attributionEvents = Array.isArray(snapshots.attribution?.events) ? snapshots.attribution.events : [];
  const referralEvents = Array.isArray(snapshots.referrals?.events) ? snapshots.referrals.events : [];
  const usageRows = Array.isArray(snapshots.usage?.rows) ? snapshots.usage.rows : [];
  const overageRows = Array.isArray(snapshots.overage?.rows) ? snapshots.overage.rows : [];
  const buildCostRows = Array.isArray(snapshots.buildCosts?.rows) ? snapshots.buildCosts.rows : [];
  const overageChargeUsd = overageRows.reduce((sum, row) => sum + (Number(row.overageChargeUsd) || 0), 0);

  const fetchSnapshots = async () => {
    setLoading(true);
    setError('');
    try {
      const results = await Promise.all(
        SNAPSHOT_ENDPOINTS.map(async (endpoint) => [
          endpoint.key,
          await fetchAuthorizedJson(getAccessTokenSilently, endpoint.path),
        ]),
      );

      setSnapshots(Object.fromEntries(results));
    } catch (fetchError) {
      setError(fetchError?.message || 'Failed to fetch admin snapshots.');
    } finally {
      setLoading(false);
    }
  };

  const resolveActiveIncident = async (incidentId) => {
    if (!incidentId) {
      return;
    }

    setResolvingIncidentId(incidentId);
    setError('');
    try {
      await fetchAuthorizedJson(
        getAccessTokenSilently,
        `/api/admin/incidents/${encodeURIComponent(incidentId)}/resolve`,
        { method: 'POST' },
      );
      await fetchSnapshots();
    } catch (resolveError) {
      setError(resolveError?.message || 'Failed to resolve incident.');
    } finally {
      setResolvingIncidentId('');
    }
  };

  useEffect(() => {
    fetchSnapshots();
  }, []);

  return (
    <Panel
      title={t('admin.adminOperations')}
      actions={(
        <SecondaryButton
          onClick={fetchSnapshots}
        >
          {t('common.refresh')}
        </SecondaryButton>
      )}
    >
      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-sm text-gray-400">{t('admin.loading')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile tone="nested" label={t('admin.sessions')} value={formatNumber(ops.activeSessions, t)} />
            <StatTile tone="nested" label={t('admin.queue')} value={formatNumber(ops.queueDepth, t)} />
            <StatTile tone="nested" label={t('admin.failureRate')} value={formatNumber(ops.failureRatePercent, t, '%')} />
            <StatTile tone="nested" label={t('admin.tokenBurn')} value={formatMoney(ops.tokenBurnLastHourUsd, t)} />
            <StatTile tone="nested" label={t('admin.alerts')} value={formatNumber(alerts.length, t)} />
            <StatTile tone="nested" label={t('admin.incidents')} value={formatNumber(activeIncidents.length, t)} />
            <StatTile tone="nested" label={t('admin.margin')} value={formatNumber(marginTotals.marginPercent, t, '%')} />
            <StatTile tone="nested" label="Margin Alerts" value={formatNumber(marginAlerts.length, t)} />
            <StatTile tone="nested" label="Guard Active" value={guardState.active ? t('common.yes') : t('common.no')} />
            <StatTile tone="nested" label="Thin Mode" value={preScaleGuard.forceThinSnapshots ? t('common.yes') : t('common.no')} />
            <StatTile tone="nested" label={t('admin.abuseEvents')} value={formatNumber(abuse.totalEvents, t)} />
            <StatTile tone="nested" label={t('admin.security')} value={formatNumber(securityEvents.length, t)} />
            <StatTile tone="nested" label="Usage Rows" value={formatNumber(usageRows.length, t)} />
            <StatTile tone="nested" label="Overage" value={formatMoney(overageChargeUsd, t)} />
            <StatTile tone="nested" label="Build Costs" value={formatNumber(buildCostRows.length, t)} />
            <StatTile tone="nested" label="Simulations" value={formatNumber(simulationRuns.length, t)} />
            <StatTile tone="nested" label="Attribution" value={formatNumber(attributionEvents.length, t)} />
            <StatTile tone="nested" label="Referrals" value={formatNumber(referralEvents.length, t)} />
          </div>

          {incidents.length > 0 && (
            <div className="mt-3 rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Incidents
                </div>
                <select
                  value={incidentStatus}
                  onChange={(event) => setIncidentStatus(event.target.value)}
                  className="rounded bg-gray-900 px-2 py-1 text-xs text-gray-100"
                >
                  <option value="active">Active</option>
                  <option value="resolved">Resolved</option>
                  <option value="all">All</option>
                </select>
              </div>
              {visibleIncidents.length > 0 ? (
                <div className="space-y-2">
                  {visibleIncidents.map((incident) => (
                    <div
                      key={incident.id}
                      className="rounded border border-gray-800 bg-gray-900 p-2"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-100">
                            {incident.code || incident.level || incident.id}
                          </div>
                          <div className="truncate text-xs text-gray-400">
                            {incident.message || incident.id}
                          </div>
                        </div>
                        {incident.status !== 'resolved' && (
                          <SecondaryButton
                            onClick={() => resolveActiveIncident(incident.id)}
                            disabled={resolvingIncidentId === incident.id}
                            className="shrink-0 disabled:cursor-wait disabled:opacity-60"
                          >
                            {resolvingIncidentId === incident.id ? 'Resolving...' : 'Resolve'}
                          </SecondaryButton>
                        )}
                      </div>
                      {incident.playbook && (
                        <details className="mt-2 rounded border border-gray-800 bg-gray-950 p-2">
                          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-400">
                            {incident.playbook.title || 'Runbook'}
                          </summary>
                          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-gray-300">
                            {(incident.playbook.steps || []).map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded border border-gray-800 bg-gray-900 p-2 text-xs text-gray-400">
                  No incidents match this filter.
                </div>
              )}
            </div>
          )}

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {SNAPSHOT_ENDPOINTS.map((endpoint) => (
              <JsonDetails key={endpoint.key} title={`${endpoint.label} JSON`} value={snapshots[endpoint.key]} />
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
