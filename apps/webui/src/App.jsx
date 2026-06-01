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
import BuildHistoryPanel from './components/BuildHistoryPanel';
import AdminOpsPanel from './components/AdminOpsPanel';
import CommunityPanel from './components/CommunityPanel';
import AccountSettingsPanel from './components/AccountSettingsPanel';
import { LocalizationProvider, useLocalization } from './components/LocalizationProvider';

function Dashboard({ user, logout, tier }) {
  const { locale, setLocale, supportedLocales, t } = useLocalization();
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
        <div className="space-y-4 p-3 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="flex items-center gap-2 text-xl font-bold text-green-400 sm:text-2xl">
              <img src='src/logo.png' width={64} alt='BuilderBot' /> {t('app.dashboardTitle')}
            </h1>
            <div className="flex items-center justify-between sm:justify-end">
              <select
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
                className="mr-3 rounded bg-gray-900 px-2 py-1 text-xs text-gray-100"
                aria-label="Language"
              >
                {supportedLocales.map((supportedLocale) => (
                  <option key={supportedLocale} value={supportedLocale}>
                    {supportedLocale.toUpperCase()}
                  </option>
                ))}
              </select>
              <span className="mr-4">
                👤 {user?.name}
                <span className={`ml-2 px-2 py-0.5 text-xs rounded uppercase ${tierColor}`}>{tier}</span>
              </span>
              <button onClick={() => logout({ returnTo: window.location.origin })} className="text-red-400 hover:underline">
                {t('app.logout')}
              </button>
            </div>
          </div>
          {tier === 'admin' && <AdminOpsPanel />}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <PromptInput />
              <ControlPanel />
              <BotConsole />
              <AccountSettingsPanel />
              <CommunityPanel />
            </div>
            <BuildHistoryPanel />
          </div>
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
    <LocalizationProvider>
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
    </LocalizationProvider>
  );
}
