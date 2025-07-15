import React from 'react';
import WebSocketProvider from './components/WebSocketProvider';
import BotConsole from './components/BotConsole';
import ControlPanel from './components/ControlPanel';

export default function App() {
  return (
    <WebSocketProvider>
      <div className="min-h-screen bg-gray-950 text-white p-6 space-y-4">
        <h1 className="text-2xl font-bold text-green-400">🧠 Minecraft AI Dashboard</h1>
        <ControlPanel />
        <BotConsole />
      </div>
    </WebSocketProvider>
  );
}
