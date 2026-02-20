import React, { useEffect, useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

function formatBuildTitle(buildRow) {
  const payload = buildRow?.build || {};
  return payload.name || payload.prompt || payload.title || `Build ${buildRow?.id || ''}`.trim();
}

function formatBuildTimestamp(buildRow) {
  const payload = buildRow?.build || {};
  const createdAt = payload.createdAt?._seconds
    ? new Date(payload.createdAt._seconds * 1000)
    : (payload.createdAt ? new Date(payload.createdAt) : null);

  if (!createdAt || Number.isNaN(createdAt.getTime())) {
    return 'Unknown time';
  }

  return createdAt.toLocaleString();
}

export default function BuildHistoryPanel() {
  const { getAccessTokenSilently } = useAuth0();
  const [builds, setBuilds] = useState([]);
  const [selectedBuildId, setSelectedBuildId] = useState(null);
  const [selectedBuild, setSelectedBuild] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedBuildRow = useMemo(
    () => builds.find((build) => build.id === selectedBuildId) || null,
    [builds, selectedBuildId],
  );

  const fetchBuilds = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getAccessTokenSilently();
      const response = await fetch('/api/user/builds?limit=25', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch build history.');
      }

      const data = await response.json();
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
      const token = await getAccessTokenSilently();
      const response = await fetch(`/api/user/build/${buildId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch build details.');
      }

      const data = await response.json();
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
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Build History</h2>
        <button
          type="button"
          onClick={fetchBuilds}
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 hover:bg-gray-700"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-500/50 bg-red-950/50 p-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="max-h-72 overflow-y-auto rounded border border-gray-800">
          {loading ? (
            <div className="p-3 text-sm text-gray-400">Loading builds...</div>
          ) : builds.length === 0 ? (
            <div className="p-3 text-sm text-gray-400">No builds recorded yet.</div>
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
                  <div className="text-xs text-gray-400">{formatBuildTimestamp(buildRow)}</div>
                </button>
              );
            })
          )}
        </div>

        <div className="rounded border border-gray-800 bg-gray-950 p-3">
          {detailLoading ? (
            <div className="text-sm text-gray-400">Loading build details...</div>
          ) : selectedBuild ? (
            <>
              <div className="mb-2 text-xs uppercase tracking-wide text-gray-400">
                {formatBuildTitle(selectedBuildRow)}
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-green-200">
                {JSON.stringify(selectedBuild, null, 2)}
              </pre>
            </>
          ) : (
            <div className="text-sm text-gray-400">Select a build to view details.</div>
          )}
        </div>
      </div>
    </section>
  );
}
