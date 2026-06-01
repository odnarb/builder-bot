import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocalization } from './LocalizationProvider';
import { ErrorBanner, JsonDetails, Panel, SecondaryButton, StatTile } from './DashboardPrimitives';
import { fetchAuthorizedJson, fetchJson } from './apiFetch';

function countItems(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countRecords(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).length
    : countItems(value);
}

export default function CommunityPanel() {
  const { getAccessTokenSilently } = useAuth0();
  const { t } = useLocalization();
  const [redeemCode, setRedeemCode] = useState('');
  const [phraseForm, setPhraseForm] = useState({ name: '', phrases: '' });
  const [listingForm, setListingForm] = useState({ title: '', description: '', priceUsd: '' });
  const [data, setData] = useState({
    links: [],
    rewards: null,
    referral: null,
    phrasePacks: [],
    listings: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchCommunity = async () => {
    setLoading(true);
    setError('');
    try {
      const [links, rewards, referral, phrasePacks, listings] = await Promise.all([
        fetchAuthorizedJson(getAccessTokenSilently, '/api/community/link'),
        fetchAuthorizedJson(getAccessTokenSilently, '/api/community/rewards?limit=5'),
        fetchAuthorizedJson(getAccessTokenSilently, '/api/community/referral/summary'),
        fetchAuthorizedJson(getAccessTokenSilently, '/api/community/phrase-packs'),
        fetchJson('/api/community/marketplace/listings?limit=5'),
      ]);

      setData({
        links: links.links || [],
        rewards,
        referral,
        phrasePacks: phrasePacks.packs || [],
        listings: listings.listings || [],
      });
    } catch (fetchError) {
      setError(fetchError?.message || 'Failed to fetch community data.');
    } finally {
      setLoading(false);
    }
  };

  const createReferralCode = async () => {
    setError('');
    try {
      await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/referral/code', {
        method: 'POST',
      });

      await fetchCommunity();
    } catch (createError) {
      setError(createError?.message || 'Failed to create referral code.');
    }
  };

  const redeemReferralCode = async () => {
    const code = redeemCode.trim();
    if (!code) {
      return;
    }

    setError('');
    try {
      await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/referral/redeem', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setRedeemCode('');
      await fetchCommunity();
    } catch (redeemError) {
      setError(redeemError?.message || 'Failed to redeem referral code.');
    }
  };

  const savePhrasePack = async () => {
    const name = phraseForm.name.trim();
    const phrases = phraseForm.phrases.split('\n').map((phrase) => phrase.trim()).filter(Boolean);
    if (!name || phrases.length === 0) {
      return;
    }

    setError('');
    try {
      await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/phrase-pack', {
        method: 'POST',
        body: JSON.stringify({ name, phrases }),
      });
      setPhraseForm({ name: '', phrases: '' });
      await fetchCommunity();
    } catch (phraseError) {
      setError(phraseError?.message || 'Failed to save phrase pack.');
    }
  };

  const createListing = async () => {
    const title = listingForm.title.trim();
    if (!title) {
      return;
    }

    setError('');
    try {
      await fetchAuthorizedJson(getAccessTokenSilently, '/api/community/marketplace/listing', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: listingForm.description,
          priceUsd: Number(listingForm.priceUsd) || 0,
        }),
      });
      setListingForm({ title: '', description: '', priceUsd: '' });
      await fetchCommunity();
    } catch (listingError) {
      setError(listingError?.message || 'Failed to create listing.');
    }
  };

  useEffect(() => {
    fetchCommunity();
  }, []);

  return (
    <Panel
      title={t('community.community')}
      actions={(
        <div className="flex gap-2">
          <SecondaryButton
            onClick={createReferralCode}
          >
            {t('community.referralCode')}
          </SecondaryButton>
          <SecondaryButton
            onClick={fetchCommunity}
          >
            {t('common.refresh')}
          </SecondaryButton>
        </div>
      )}
    >
      <ErrorBanner message={error} />

      {loading ? (
        <div className="text-sm text-gray-400">{t('community.loading')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <StatTile tone="nested" label={t('community.linked')} value={countRecords(data.links)} />
            <StatTile tone="nested" label={t('community.rewards')} value={data.rewards?.balance?.rewardPoints || 0} />
            <StatTile tone="nested" label={t('community.referral')} value={data.referral?.summary?.code || 'None'} />
            <StatTile tone="nested" label={t('community.entitlements')} value={countItems(data.referral?.entitlements || data.referral?.summary?.entitlements)} />
            <StatTile tone="nested" label={t('community.phrasePacks')} value={countItems(data.phrasePacks)} />
            <StatTile tone="nested" label={t('community.listings')} value={countItems(data.listings)} />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <div className="rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {t('community.redeemCode')}
              </div>
              <input
                value={redeemCode}
                onChange={(event) => setRedeemCode(event.target.value)}
                className="mb-2 w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                placeholder={t('community.referralCode')}
              />
              <SecondaryButton onClick={redeemReferralCode}>{t('community.redeem')}</SecondaryButton>
            </div>

            <div className="rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {t('community.createPhrasePack')}
              </div>
              <input
                value={phraseForm.name}
                onChange={(event) => setPhraseForm({ ...phraseForm, name: event.target.value })}
                className="mb-2 w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                placeholder={t('community.phrasePackName')}
              />
              <textarea
                value={phraseForm.phrases}
                onChange={(event) => setPhraseForm({ ...phraseForm, phrases: event.target.value })}
                className="mb-2 h-20 w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                placeholder={t('community.phrases')}
              />
              <SecondaryButton onClick={savePhrasePack}>{t('community.save')}</SecondaryButton>
            </div>

            <div className="rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {t('community.createListing')}
              </div>
              <input
                value={listingForm.title}
                onChange={(event) => setListingForm({ ...listingForm, title: event.target.value })}
                className="mb-2 w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                placeholder={t('community.listingTitle')}
              />
              <input
                value={listingForm.priceUsd}
                onChange={(event) => setListingForm({ ...listingForm, priceUsd: event.target.value })}
                className="mb-2 w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                placeholder={t('community.priceUsd')}
                type="number"
                min="0"
                step="0.01"
              />
              <textarea
                value={listingForm.description}
                onChange={(event) => setListingForm({ ...listingForm, description: event.target.value })}
                className="mb-2 h-16 w-full rounded bg-gray-900 px-2 py-1 text-sm text-gray-100"
                placeholder={t('community.description')}
              />
              <SecondaryButton onClick={createListing}>{t('community.createListing')}</SecondaryButton>
            </div>
          </div>

          {data.listings.length > 0 && (
            <div className="mt-3 rounded border border-gray-800 bg-gray-950 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {t('community.listings')}
              </div>
              <div className="space-y-2">
                {data.listings.map((listing) => (
                  <div key={listing.id} className="rounded border border-gray-800 bg-gray-900 p-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">
                          {listing.title || listing.id}
                        </div>
                        {listing.description && (
                          <div className="mt-1 text-xs text-gray-400">
                            {listing.description}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-xs font-medium text-green-300">
                        ${Number(listing.priceUsd || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <JsonDetails title="Marketplace JSON" value={data.listings} maxHeightClass="max-h-40" />
            <JsonDetails
              title="Rewards JSON"
              value={{
                rewards: data.rewards,
                referral: data.referral,
                phrasePacks: data.phrasePacks,
                links: data.links,
              }}
              maxHeightClass="max-h-40"
            />
          </div>
        </>
      )}
    </Panel>
  );
}
