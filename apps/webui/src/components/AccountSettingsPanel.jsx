import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocalization } from './LocalizationProvider';
import { ErrorBanner, Panel, SecondaryButton, StatTile, SuccessBanner } from './DashboardPrimitives';
import { fetchAuthorizedJson } from './apiFetch';

function formatDate(value) {
  if (!value) {
    return 'None';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return date.toLocaleDateString();
}

export default function AccountSettingsPanel() {
  const { getAccessTokenSilently } = useAuth0();
  const { t } = useLocalization();
  const [policyAcceptance, setPolicyAcceptance] = useState(null);
  const [renewal, setRenewal] = useState(null);
  const [parentalControls, setParentalControls] = useState(null);
  const [strictMode, setStrictMode] = useState(false);
  const [blockedTopics, setBlockedTopics] = useState('');
  const [ticketType, setTicketType] = useState('cancel');
  const [ticketReason, setTicketReason] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const blockedTopicCount = Array.isArray(parentalControls?.blockedTopics)
    ? parentalControls.blockedTopics.length
    : 0;

  const fetchAccountState = async () => {
    setLoading(true);
    setError('');
    try {
      const [policyPayload, renewalPayload, controlsPayload] = await Promise.all([
        fetchAuthorizedJson(getAccessTokenSilently, '/api/user/policy/acceptance'),
        fetchAuthorizedJson(getAccessTokenSilently, '/api/user/subscription/renewal'),
        fetchAuthorizedJson(getAccessTokenSilently, '/api/user/parental-controls'),
      ]);

      setPolicyAcceptance(policyPayload.acceptance || null);
      setRenewal(renewalPayload.renewal || null);
      const controls = controlsPayload.controls || null;
      setParentalControls(controls);
      setStrictMode(Boolean(controls?.strictMode));
      setBlockedTopics(Array.isArray(controls?.blockedTopics) ? controls.blockedTopics.join(', ') : '');
    } catch (fetchError) {
      setError(fetchError?.message || 'Failed to fetch account settings.');
    } finally {
      setLoading(false);
    }
  };

  const updateRenewal = async (autoRenew) => {
    setError('');
    try {
      const payload = await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/subscription/renewal', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          autoRenew,
          currentPeriodEnd: renewal?.currentPeriodEnd || null,
        }),
      });
      setRenewal(payload.renewal || null);
    } catch (updateError) {
      setError(updateError?.message || 'Failed to update renewal preference.');
    }
  };

  const updateParentalControls = async () => {
    setError('');
    try {
      const payload = await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/parental-controls', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          strictMode,
          blockedTopics: blockedTopics.split(',').map((topic) => topic.trim()).filter(Boolean),
        }),
      });
      setParentalControls(payload.controls || null);
    } catch (updateError) {
      setError(updateError?.message || 'Failed to update parental controls.');
    }
  };

  const submitTicket = async () => {
    setError('');
    setTicketMessage('');
    try {
      const payload = await fetchAuthorizedJson(getAccessTokenSilently, '/api/user/subscription/ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: ticketType,
          reason: ticketReason,
          purchasedAt: renewal?.updatedAt || new Date().toISOString(),
          usagePercent: 0,
          previousRefundCount: 0,
        }),
      });
      setTicketReason('');
      setTicketMessage(`Ticket ${payload.ticket?.id || ''} opened.`.trim());
      await fetchAccountState();
    } catch (ticketError) {
      setError(ticketError?.message || 'Failed to submit subscription ticket.');
    }
  };

  useEffect(() => {
    fetchAccountState();
  }, []);

  return (
    <Panel
      title="Account"
      actions={(
        <SecondaryButton
          onClick={fetchAccountState}
        >
          {t('common.refresh')}
        </SecondaryButton>
      )}
    >
      <ErrorBanner message={error} />
      <SuccessBanner message={ticketMessage} />

      {loading ? (
        <div className="text-sm text-gray-400">Loading account settings...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile tone="nested" label="Terms" value={policyAcceptance?.termsVersion || 'None'} />
            <StatTile tone="nested" label="Privacy" value={policyAcceptance?.privacyVersion || 'None'} />
            <StatTile tone="nested" label="Auto Renew" value={renewal?.autoRenew ? t('common.yes') : t('common.no')} />
            <StatTile tone="nested" label="Period End" value={formatDate(renewal?.currentPeriodEnd)} />
            <StatTile tone="nested" label="Strict Mode" value={strictMode ? t('common.yes') : t('common.no')} />
            <StatTile tone="nested" label="Blocked Topics" value={blockedTopicCount} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Subscription</div>
              <div className="flex flex-wrap gap-2">
                <SecondaryButton
                  onClick={() => updateRenewal(true)}
                  className="px-3"
                >
                  Enable Renewal
                </SecondaryButton>
                <SecondaryButton
                  onClick={() => updateRenewal(false)}
                  className="px-3"
                >
                  Disable Renewal
                </SecondaryButton>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                <select
                  value={ticketType}
                  onChange={(event) => setTicketType(event.target.value)}
                  className="rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                >
                  <option value="cancel">Cancel</option>
                  <option value="refund">Refund</option>
                </select>
                <input
                  type="text"
                  value={ticketReason}
                  onChange={(event) => setTicketReason(event.target.value)}
                  className="rounded bg-gray-900 px-2 py-1 text-sm text-gray-100 placeholder-gray-500"
                  placeholder="Reason"
                />
              </div>
              <SecondaryButton
                onClick={submitTicket}
                className="mt-2 px-3"
              >
                Submit Ticket
              </SecondaryButton>
            </div>

            <div className="rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Parental Controls</div>
              <label className="mb-2 flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={strictMode}
                  onChange={(event) => setStrictMode(event.target.checked)}
                />
                Strict moderation
              </label>
              <input
                type="text"
                value={blockedTopics}
                onChange={(event) => setBlockedTopics(event.target.value)}
                className="w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100 placeholder-gray-500"
                placeholder="Blocked topics, comma separated"
              />
              <SecondaryButton
                onClick={updateParentalControls}
                className="mt-2 px-3"
              >
                Save Controls
              </SecondaryButton>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
