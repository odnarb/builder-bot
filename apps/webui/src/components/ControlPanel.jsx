import React, { useContext, useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { WebSocketContext } from './WebSocketProvider';
import LaunchBotModal from './LaunchBotModal';

export default function ControlPanel() {
  const { sendMessage } = useContext(WebSocketContext);
  const { user, getAccessTokenSilently } = useAuth0();
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [authToken, setAuthToken] = useState(null);
  const [botStatus, setBotStatus] = useState('idle'); // e.g. 'idle', 'launching', 'running', 'exited'

  const isBotRunning = botStatus === 'running';
  const isBotLaunching = botStatus === 'launching';

  const handleLaunchBot = (envVars) => {
    window.electronAPI?.launchBot?.(envVars);
  };

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
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
        >
          🧠 Launch BuilderBot
        </button>
      </div>

      <div className="space-x-2">
        <button
          onClick={() => sendMessage({ type: "get_position" })}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
        >
          Get Position
        </button>

        <button
          onClick={() => sendMessage({ type: 'chat_command', message: "build cube" })}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
        >
          Build Cube
        </button>

        <button
          onClick={() => sendMessage({ type: "get_inventory" })}
          className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded"
        >
          Inventory
        </button>

        <button
          onClick={() => sendMessage({ type: "get_nearby_blocks" })}
          className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded"
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
