import React, { useContext, useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { WebSocketContext } from './WebSocketProvider';
import LaunchBotModal from './LaunchBotModal';

export default function ControlPanel() {
  const { sendMessage } = useContext(WebSocketContext);
  const { user, getAccessTokenSilently } = useAuth0();
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [authToken, setAuthToken] = useState(null);
  const [botStatus, setBotStatus] = useState('offline');

  const isBotRunning = botStatus === 'running';
  const isBotLaunching = botStatus === 'launching';
  const isBotIdle = botStatus === 'idle';

  const statusLabel = isBotRunning
    ? 'Online'
    : isBotLaunching
      ? 'Launching'
      : 'Offline';

  const statusColor = isBotRunning
    ? 'bg-green-500'
    : isBotLaunching
      ? 'bg-yellow-400'
      : 'bg-gray-500';

  const handleLaunchBot = (envVars) => {
    window.electronAPI?.launchBot?.(envVars);
  };

  const handleStopBot = () => {
    window.electronAPI?.stopBot?.()
  }

  useEffect(() => {
    window.electronAPI?.onBotStatus?.(({ status, code }) => {
      console.log('⚙️ Bot status:', status);
      setBotStatus(status); // update your UI button state here
    });
  }, []);

  const openModal = async () => {
    try {
      const token = await getAccessTokenSilently();

      setAuthToken(token);
      setShowLaunchModal(true);
    } catch (e) {
      console.error('🔒 Failed to fetch token:', e);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div>
        <button
          onClick={openModal}
          disabled={isBotRunning || isBotLaunching}
          className={`px-4 py-2 rounded text-white font-semibold transition ${isBotRunning
              ? 'bg-green-700 cursor-not-allowed'
              : isBotLaunching
                ? 'bg-yellow-600 cursor-wait'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
        >
          {isBotRunning
            ? '✅ BuilderBot Online'
            : isBotLaunching
              ? '🚀 Launching...'
              : '🧠 Launch BuilderBot'}
        </button>

        <button
          onClick={handleStopBot}
          disabled={!isBotRunning}
          className={`ml-2 px-4 py-2 rounded text-white font-semibold transition ${!isBotRunning
            ? 'bg-gray-700 cursor-not-allowed'
            : 'bg-red-600 hover:bg-red-700'
            }`}
        >
          🛑 Stop BuilderBot
        </button>
      </div>

      <div className="flex items-center space-x-2">
        <div className={`w-3 h-3 rounded-full ${statusColor}`} />
        <span className="text-sm text-gray-300">Status: {statusLabel}</span>
      </div>

      <div className="space-x-2">
        <button
          onClick={() => sendMessage({ type: "get_position" })}
          disabled={!isBotRunning}
          className={`px-3 py-1 rounded text-white ${isBotRunning
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-blue-900 cursor-not-allowed opacity-50'
            }`}
        >
          Get Position
        </button>

        <button
          onClick={() => sendMessage({ type: 'chat_command', message: "build cube" })}
          disabled={!isBotRunning}
          className={`px-3 py-1 rounded text-white ${isBotRunning
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-blue-900 cursor-not-allowed opacity-50'
            }`}
        >
          Build Cube
        </button>

        <button
          onClick={() => sendMessage({ type: "get_inventory" })}
          disabled={!isBotRunning}
          className={`px-3 py-1 rounded text-white ${isBotRunning
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-blue-900 cursor-not-allowed opacity-50'
            }`}
        >
          Inventory
        </button>

        <button
          onClick={() => sendMessage({ type: "get_nearby_blocks" })}
          disabled={!isBotRunning}
          className={`px-3 py-1 rounded text-white ${isBotRunning
            ? 'bg-blue-600 hover:bg-blue-700'
            : 'bg-blue-900 cursor-not-allowed opacity-50'
            }`}
        >
          Nearby Blocks
        </button>
      </div>

      {showLaunchModal && (
        <LaunchBotModal
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunchBot}
          authToken={authToken}
          userId={user?.sub}
        />
      )}
    </div>
  );
}
