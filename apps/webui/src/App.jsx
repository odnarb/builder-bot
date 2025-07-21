import React, { useState, useEffect } from 'react';
import WebSocketProvider from './components/WebSocketProvider';
import BotConsole from './components/BotConsole';
import ControlPanel from './components/ControlPanel';
import PromptInput from './components/PromptInput';
import PlanSelector from './components/PlanSelector';

export default function App() {
  const [tier, setTier] = useState(null);

  useEffect(() => {
    // ✅ Fetch tier from session or Firestore-backed API
    fetch('/api/user/tier')
      .then(res => res.json())
      .then(data => setTier(data.tier || 'free'))
      .catch(() => setTier('free'));
  }, []);

  if (!tier) return <div className="text-white p-6">Loading...</div>;

  if (tier === 'pending') {
    return <PlanSelector onSelect={setTier} />;
  }

  return (
    <WebSocketProvider>
      <div className="min-h-screen bg-gray-950 text-white p-6 space-y-4">
        <h1 className="text-2xl font-bold text-green-400">🧠 Minecraft AI Agent Dashboard</h1>
        <PromptInput />
        <ControlPanel />
        <BotConsole />
      </div>
    </WebSocketProvider>
  );
}
