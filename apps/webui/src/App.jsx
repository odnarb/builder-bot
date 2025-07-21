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
    if (isAuthenticated) {
      getAccessTokenSilently()
        .then(token =>
          fetch('/api/user/tier', {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          })
        )
        .then(res => res?.json())
        .then(data => setTier(data?.tier || 'free'))
        .catch(() => setTier('free'));
    }
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