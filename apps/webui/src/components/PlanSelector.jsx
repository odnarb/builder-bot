import React from 'react';

export default function PlanSelector({ onSelect }) {
    const choosePlan = async (tier) => {
        if (tier === 'free') {
            const token = await getAccessTokenSilently();
            await fetch('/api/user/plan', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tier }),
            });

            onSelect('free');
            return;
        }

        const res = await fetch('/api/create-checkout-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tier }),
        });

        const { url } = await res.json();
        window.location.href = url;
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
            <h2 className="text-3xl font-bold mb-6 text-green-400 text-center">
                Welcome to BuilderBot! Choose Your Plan
            </h2>

            <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { name: 'Starter', tier: 'starter', price: '$4.99/mo', desc: '500-block builds + templates' },
                    { name: 'Pro', tier: 'pro', price: '$9.99/mo', desc: '2,000-block builds + AI chat', highlight: true },
                    { name: 'Admin', tier: 'admin', price: '$19.99/mo', desc: 'Unlimited builds, full access' },
                    { name: 'Free', tier: 'free', price: '$0', desc: 'Limited to 50-block builds' },
                ].map(plan => {
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
                                    ⭐ Best Value
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
                                {plan.tier === 'free' ? 'Continue Free' : 'Upgrade'}
                            </button>
                        </div>
                    );
                })}

            </div>
        </div>
    );
}
