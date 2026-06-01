import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocalization } from './LocalizationProvider';
import { ErrorBanner, Panel, SecondaryButton, StatTile } from './DashboardPrimitives';
import { fetchAuthorizedJson } from './apiFetch';

function formatBuildTitle(buildRow) {
  const payload = buildRow?.build || {};
  return payload.name || payload.prompt || payload.title || `Build ${buildRow?.id || ''}`.trim();
}

function formatBuildTimestamp(buildRow, t) {
  const payload = buildRow?.build || {};
  const createdAt = payload.createdAt?._seconds
    ? new Date(payload.createdAt._seconds * 1000)
    : (payload.createdAt ? new Date(payload.createdAt) : null);

  if (!createdAt || Number.isNaN(createdAt.getTime())) {
    return t('common.unknownTime');
  }

  return createdAt.toLocaleString();
}

function getBuildField(buildRow, fieldName, fallback = null) {
  if (!buildRow) {
    return fallback;
  }

  if (Object.prototype.hasOwnProperty.call(buildRow, fieldName)) {
    return buildRow[fieldName];
  }

  const payload = buildRow.build || {};
  if (Object.prototype.hasOwnProperty.call(payload, fieldName)) {
    return payload[fieldName];
  }

  return fallback;
}

function formatValue(value, t) {
  if (value === true) {
    return t('common.yes');
  }

  if (value === false) {
    return t('common.no');
  }

  if (value === null || value === undefined || value === '') {
    return t('common.unknown');
  }

  return String(value);
}

function formatRatio(value, t) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return t('common.unknown');
  }

  return `${Math.round(value * 100)}%`;
}

function getDecisionSummary(buildRow) {
  const telemetry = getBuildField(buildRow, 'decisionTelemetry', {}) || {};
  return {
    source: getBuildField(buildRow, 'planSource', getBuildField(buildRow, 'source', 'unknown')),
    success: getBuildField(buildRow, 'success', null),
    attempts: getBuildField(buildRow, 'attempts', null),
    replans: getBuildField(buildRow, 'replans', null),
    failureReason: getBuildField(buildRow, 'failureReason', null),
    localPlanCount: telemetry.localPlanCount,
    aiPlanCount: telemetry.aiPlanCount,
    aiPatchPlanCount: telemetry.aiPatchPlanCount,
    localPlanRatio: telemetry.localPlanRatio,
  };
}

function sumNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getDecisionRollup(buildRows) {
  const summaries = buildRows.map(getDecisionSummary);
  const totalBuilds = summaries.length;
  const localPlans = summaries.reduce((sum, summary) => {
    if (summary.source === 'local') {
      return sum + 1;
    }
    return sum + sumNumber(summary.localPlanCount);
  }, 0);
  const aiPlans = summaries.reduce((sum, summary) => {
    if (summary.source === 'ai') {
      return sum + 1;
    }
    return sum + sumNumber(summary.aiPlanCount);
  }, 0);
  const aiPatchPlans = summaries.reduce((sum, summary) => sum + sumNumber(summary.aiPatchPlanCount), 0);
  const replans = summaries.reduce((sum, summary) => sum + sumNumber(summary.replans), 0);
  const successCount = summaries.filter((summary) => summary.success === true).length;
  const completedCount = summaries.filter((summary) => typeof summary.success === 'boolean').length;
  const totalInitialPlans = localPlans + aiPlans;

  return {
    totalBuilds,
    localPlans,
    aiPlans,
    aiPatchPlans,
    replans,
    successRate: completedCount > 0 ? successCount / completedCount : null,
    localRatio: totalInitialPlans > 0 ? localPlans / totalInitialPlans : null,
    aiCallsAvoided: localPlans,
  };
}

export default function BuildHistoryPanel() {
  const { getAccessTokenSilently } = useAuth0();
  const { t } = useLocalization();
  const [builds, setBuilds] = useState([]);
  const [selectedBuildId, setSelectedBuildId] = useState(null);
  const [selectedBuild, setSelectedBuild] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedBuildRow = builds.find((build) => build.id === selectedBuildId) || null;
  const decisionSummary = getDecisionSummary(selectedBuild);
  const decisionRollup = getDecisionRollup(builds);

  const fetchBuilds = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/builds?limit=25');
      const rows = Array.isArray(data.builds) ? data.builds : [];
      setBuilds(rows);
      if (rows.length > 0 && !selectedBuildId) {
        setSelectedBuildId(rows[0].id);
      }
    } catch (fetchError) {
      setError(fetchError?.message || 'Failed to fetch build history.');
    } finally {
      setLoading(false);
    }
  };

  const fetchBuildDetail = async (buildId) => {
    if (!buildId) {
      setSelectedBuild(null);
      return;
    }

    setDetailLoading(true);
    setError('');
    try {
      const data = await fetchAuthorizedJson(getAccessTokenSilently, `/api/user/build/${buildId}`);
      setSelectedBuild(data.build || null);
    } catch (fetchError) {
      setError(fetchError?.message || 'Failed to fetch build details.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchBuilds();
  }, []);

  useEffect(() => {
    fetchBuildDetail(selectedBuildId);
  }, [selectedBuildId]);

  return (
    <Panel
      title={t('build.buildHistory')}
      actions={(
        <SecondaryButton
          onClick={fetchBuilds}
        >
          {t('common.refresh')}
        </SecondaryButton>
      )}
    >
      <ErrorBanner message={error} />

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatTile label={t('build.totalBuilds')} value={formatValue(decisionRollup.totalBuilds, t)} />
        <StatTile label={t('build.localPlans')} value={formatValue(decisionRollup.localPlans, t)} />
        <StatTile label={t('build.aiPlans')} value={formatValue(decisionRollup.aiPlans, t)} />
        <StatTile label={t('build.aiPatchPlans')} value={formatValue(decisionRollup.aiPatchPlans, t)} />
        <StatTile label={t('build.replans')} value={formatValue(decisionRollup.replans, t)} />
        <StatTile label={t('build.successRate')} value={formatRatio(decisionRollup.successRate, t)} />
        <StatTile label={t('build.localRatio')} value={formatRatio(decisionRollup.localRatio, t)} />
        <StatTile label={t('build.aiCallsAvoided')} value={formatValue(decisionRollup.aiCallsAvoided, t)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="max-h-72 overflow-y-auto rounded border border-gray-800">
          {loading ? (
            <div className="p-3 text-sm text-gray-400">{t('build.loadingBuilds')}</div>
          ) : builds.length === 0 ? (
            <div className="p-3 text-sm text-gray-400">{t('build.noBuilds')}</div>
          ) : (
            builds.map((buildRow) => {
              const selected = buildRow.id === selectedBuildId;
              return (
                <button
                  key={buildRow.id}
                  type="button"
                  onClick={() => setSelectedBuildId(buildRow.id)}
                  className={`w-full border-b border-gray-800 px-3 py-2 text-left transition last:border-b-0 ${
                    selected ? 'bg-green-900/30' : 'hover:bg-gray-800/60'
                  }`}
                >
                  <div className="truncate text-sm text-gray-100">{formatBuildTitle(buildRow)}</div>
                  <div className="text-xs text-gray-400">{formatBuildTimestamp(buildRow, t)}</div>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded border border-gray-800 bg-gray-950 p-3">
          {detailLoading ? (
            <div className="text-sm text-gray-400">{t('build.loadingBuildDetails')}</div>
          ) : selectedBuild ? (
            <>
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                {formatBuildTitle(selectedBuildRow)}
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <StatTile label={t('build.source')} value={formatValue(decisionSummary.source, t)} />
                <StatTile label={t('build.success')} value={formatValue(decisionSummary.success, t)} />
                <StatTile label={t('build.attempts')} value={formatValue(decisionSummary.attempts, t)} />
                <StatTile label={t('build.replans')} value={formatValue(decisionSummary.replans, t)} />
                <StatTile label={t('build.localPlans')} value={formatValue(decisionSummary.localPlanCount, t)} />
                <StatTile label={t('build.aiPlans')} value={formatValue(decisionSummary.aiPlanCount, t)} />
                <StatTile label={t('build.aiPatchPlans')} value={formatValue(decisionSummary.aiPatchPlanCount, t)} />
                <StatTile label={t('build.localRatio')} value={formatRatio(decisionSummary.localPlanRatio, t)} />
              </div>
              {decisionSummary.failureReason && (
                <div className="mb-3 rounded border border-red-500/40 bg-red-950/40 p-2 text-xs text-red-100">
                  {decisionSummary.failureReason}
                </div>
              )}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-green-200">
                {JSON.stringify(selectedBuild, null, 2)}
              </pre>
            </>
          ) : (
            <div className="text-sm text-gray-400">{t('build.selectBuild')}</div>
          )}
        </div>
      </div>
    </Panel>
  );
}
