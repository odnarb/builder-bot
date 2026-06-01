import React, { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useLocalization } from './LocalizationProvider';

export default function PlanSelector({ onSelect }) {
    const { getAccessTokenSilently } = useAuth0();
    const { t } = useLocalization();
    const [acceptedPolicies, setAcceptedPolicies] = useState(false);
    const [error, setError] = useState('');

    const termsVersion = '2026-02';
    const privacyVersion = '2026-02';

    const choosePlan = async (tier) => {
        try {
            setError('');
            if (!acceptedPolicies) {
                setError(t('plan.policyRequired'));
                return;
            }

            const token = await getAccessTokenSilently();
            await fetch('/api/user/policy/accept', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    termsVersion,
                    privacyVersion,
                }),
            });

            if (tier === 'free') {
                await fetch('/api/user/plan', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ tier }),
                });

                onSelect('free');
                return;
            }

            const res = await fetch('/api/stripe/create-checkout-session', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tier,
                    termsVersion,
                    privacyVersion,
                }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body?.error || t('plan.startCheckoutFailed'));
                return;
            }

            const { url } = await res.json();
            window.location.href = url;
        } catch (requestError) {
            setError(requestError?.message || t('plan.chooseFailed'));
        }
    };

    const plans = [
        { name: 'Starter', tier: 'starter', price: '$4.99/mo', desc: t('plan.starterDescription') },
        { name: 'Pro', tier: 'pro', price: '$12.99/mo', desc: t('plan.proDescription') },
        { name: 'Admin', tier: 'admin', price: '$24.99/mo', desc: t('plan.adminDescription') },
        { name: 'Free', tier: 'free', price: '$0', desc: t('plan.freeDescription') },
    ];

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
            <h2 className="text-3xl font-bold mb-6 text-green-400 text-center">
                {t('plan.choosePlan')}
            </h2>

            <label className="mb-4 flex max-w-2xl items-start gap-2 rounded border border-gray-700 bg-gray-800/60 p-3 text-sm text-gray-200">
                <input
                    type="checkbox"
                    checked={acceptedPolicies}
                    onChange={(event) => setAcceptedPolicies(event.target.checked)}
                    className="mt-1"
                />
                <span>
                    {t('plan.acceptPolicies')} ({termsVersion}).
                </span>
            </label>
            {error && <div className="mb-4 text-sm text-red-300">{error}</div>}

            <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {plans.map(plan => {
                    const isHighlight = plan.tier === 'pro';

                    return (
                        <div
                            key={plan.tier}
                            className={`relative p-6 rounded shadow transition transform hover:scale-105 ${isHighlight
                                ? 'bg-green-800 border-2 border-yellow-400'
                                : 'bg-gray-800'
                                }`}
                        >
                            {isHighlight && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-black px-2 py-1 text-xs font-bold rounded shadow">
                                    {t('plan.bestValue')}
                                </div>
                            )}

                            <h3 className="text-xl font-semibold">{plan.name}</h3>
                            <p className="text-green-300">{plan.price}</p>
                            <p className="text-sm text-gray-300 mb-4">{plan.desc}</p>

                            <button
                                onClick={() => choosePlan(plan.tier)}
                                className={`py-2 px-4 rounded w-full ${isHighlight
                                    ? 'bg-yellow-400 hover:bg-yellow-500 text-black'
                                    : 'bg-green-500 hover:bg-green-600 text-white'
                                    }`}
                            >
                                {plan.tier === 'free' ? t('plan.continueFree') : t('plan.upgrade')}
                            </button>
                        </div>
                    );
                })}

            </div>
        </div>
    );
}
