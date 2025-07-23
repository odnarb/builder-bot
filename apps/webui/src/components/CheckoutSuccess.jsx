// src/pages/CheckoutSuccess.jsx
import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function CheckoutSuccess() {
    const [params] = useSearchParams();
    const { getAccessTokenSilently } = useAuth0();
    const navigate = useNavigate();

    useEffect(() => {
        const processCheckout = async () => {
            const sessionId = params.get('session_id');
            if (!sessionId) return;

            const token = await getAccessTokenSilently();

            await fetch('/api/stripe/confirm-checkout', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId }),
            });

            navigate('/'); // ✅ Go back to main app
            window.location.reload();
        };

        processCheckout();
    }, [params, navigate, getAccessTokenSilently]);

    return (
        <div className="text-white p-6">
            🎉 Payment successful! Updating your account...
        </div>
    );
}
