import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Spinner from './Spinner';
import { useLocalization } from './LocalizationProvider';

export default function CheckoutSuccess() {
    const [params] = useSearchParams();
    const { getAccessTokenSilently } = useAuth0();
    const { t } = useLocalization();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const processCheckout = async () => {
            const sessionId = params.get('session_id');
            if (!sessionId) return;

            try {
                const token = await getAccessTokenSilently();

                await fetch('/api/stripe/confirm-checkout', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ sessionId }),
                });

                navigate('/'); // Navigate back to main app
                window.location.reload();
            } catch (error) {
                console.error('❌ Checkout confirmation failed:', error);
            } finally {
                setLoading(false);
            }
        };

        processCheckout();
    }, [params, navigate, getAccessTokenSilently]);

    return loading ? (
        <Spinner text={t('checkout.processing')} />
    ) : (
        <Spinner text={t('checkout.redirecting')} />
    );
}
