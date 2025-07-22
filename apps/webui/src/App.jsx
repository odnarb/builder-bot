import React, { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

import WebSocketProvider from './components/WebSocketProvider';
import BotConsole from './components/BotConsole';
import ControlPanel from './components/ControlPanel';
import PromptInput from './components/PromptInput';
import PlanSelector from './components/PlanSelector';

export default function App() {
  const { loginWithRedirect, logout, isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0();
  const [tier, setTier] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return

    const syncUserAndGetTier = async () => {
      try {
        const token = await getAccessTokenSilently();
        // 1. Sync user on signup
        await fetch('/api/user/signup', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: user.email,
            name: user.name,
            auth0LoginId: user.sub,
            picture: user.picture,
          }),
        });

        // 2. Fetch user's tier
        const res = await fetch(`/api/user/tier?email=${user.email}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json();
        setTier(data?.tier || 'free');
      } catch (err) {
        console.error('❌ Auth + Tier Sync Error:', err);
        setTier('free');
      }
    };

    syncUserAndGetTier();
  }, [isAuthenticated, getAccessTokenSilently]);


  if (isLoading) return <div className="text-white p-6">🔐 Checking auth...</div>;

  if (!isAuthenticated) {
    loginWithRedirect(); // 🚨 Redirects to Auth0 login
    return <div className="text-white p-6">Redirecting to login...</div>;
  }

  if (!tier) return <div className="text-white p-6">Loading tier...</div>;
  if (tier === 'pending') return <PlanSelector onSelect={setTier} />;

  return (
    <WebSocketProvider>
      <div className="min-h-screen bg-gray-950 text-white p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-green-400">🧠 Minecraft AI Agent Dashboard</h1>
          <div>
            <span className="mr-4">👤 {user?.name}</span>
            <button onClick={() => logout({ returnTo: window.location.origin })} className="text-red-400 hover:underline">
              Log Out
            </button>
          </div>
        </div>
        <PromptInput />
        <ControlPanel />
        <BotConsole />
      </div>
    </WebSocketProvider>
  );
}