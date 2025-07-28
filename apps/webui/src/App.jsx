import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';

import WebSocketProvider from './components/WebSocketProvider';
import BotConsole from './components/BotConsole';
import ControlPanel from './components/ControlPanel';
import PromptInput from './components/PromptInput';
import PlanSelector from './components/PlanSelector';
import CheckoutSuccess from './components/CheckoutSuccess';
import Spinner from './components/Spinner';
import TitleBar from './components/TitleBar';

function Dashboard({ user, logout, tier }) {
  const tierColor = {
    free: 'bg-gray-600',
    starter: 'bg-blue-600',
    pro: 'bg-purple-600',
    admin: 'bg-red-600',
  }[tier] || 'bg-gray-600';

  return (
    <WebSocketProvider>
      <div className="min-h-screen bg-gray-950 text-white">
        <TitleBar />
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h1 className="flex items-center text-2xl font-bold text-green-400 gap-2">
              <img src='src/logo.png' width={64} alt='BuilderBot' /> BuilderBot Dashboard
            </h1>
            <div>
              <span className="mr-4">
                👤 {user?.name}
                <span className={`ml-2 px-2 py-0.5 text-xs rounded uppercase ${tierColor}`}>{tier}</span>
              </span>
              <button onClick={() => logout({ returnTo: window.location.origin })} className="text-red-400 hover:underline">
                Log Out
              </button>
            </div>
          </div>
          <PromptInput />
          <ControlPanel />
          <BotConsole />
        </div>
      </div>
    </WebSocketProvider>
  );
}

export default function App() {
  const { loginWithRedirect, logout, isAuthenticated, isLoading, user, getAccessTokenSilently } = useAuth0();
  const [tier, setTier] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const syncUserAndGetTier = async () => {
      try {
        const token = await getAccessTokenSilently();
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

        const res = await fetch(`/api/user/tier`, {
          headers: { Authorization: `Bearer ${token}` },
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

  if (isLoading) return <Spinner text="Loading..." />;

  if (!isAuthenticated) {
    loginWithRedirect();
    return <Spinner text="Loading..." />;
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/"
          element={
            !tier ? (
              <Spinner text="Loading..." />
            ) : tier === 'pending' ? (
              <PlanSelector onSelect={setTier} />
            ) : (
              <Dashboard user={user} logout={logout} tier={tier} />
            )
          }
        />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
      </Routes>
    </Router>
  );
}
