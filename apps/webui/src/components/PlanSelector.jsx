import React from 'react';

export default function PlanSelector({ onSelect }) {
    const choosePlan = async (tier) => {
        if (tier === 'free') {
            onSelect('free');
        } else {
            const res = await fetch('/api/create-checkout-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tier })
            });

            const { url } = await res.json();
            window.location.href = url;
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <h2 className="text-3xl font-bold mb-6 text-green-400">Choose Your Plan</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                    { name: 'Free', tier: 'free', price: '$0', desc: 'Limited to 50-block builds builds' },
                    { name: 'Starter', tier: 'starter', price: '$4.99/mo', desc: '500-block builds' },
                    { name: 'Pro', tier: 'pro', price: '$9.99/mo', desc: '2,000-block builds + AI chat' },
                    { name: 'Admin', tier: 'admin', price: '$19.99/mo', desc: 'Unlimited builds, full access' }
                ].map(plan => (
                    <div key={plan.tier} className="bg-gray-800 p-6 rounded shadow">
                        <h3 className="text-xl font-semibold">{plan.name}</h3>
                        <p className="text-green-300">{plan.price}</p>
                        <p className="text-sm text-gray-400 mb-4">{plan.desc}</p>
                        <button
                            onClick={() => choosePlan(plan.tier)}
                            className="bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded"
                        >
                            {plan.tier === 'free' ? 'Continue Free' : 'Upgrade'}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
