import React, { useContext, useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { WebSocketContext } from './WebSocketProvider';
import LaunchBotModal from './LaunchBotModal';
import { useLocalization } from './LocalizationProvider';

export default function ControlPanel() {
  const { sendMessage } = useContext(WebSocketContext);
  const { user, getAccessTokenSilently } = useAuth0();
  const { t } = useLocalization();
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [authToken, setAuthToken] = useState(null);
  const [botStatus, setBotStatus] = useState('offline');
  const [launchError, setLaunchError] = useState('');
  const [isElectronRuntime, setIsElectronRuntime] = useState(false);

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
    if (!window.electronAPI?.launchBot) {
      setLaunchError('Launch is only available from the Electron app. Run `npm run dev:electron` or launch the bot from terminal.');
      return;
    }

    setLaunchError('');
    window.electronAPI.launchBot(envVars);
  };

  const handleStopBot = () => {
    if (!window.electronAPI?.stopBot) {
      setLaunchError('Stop is only available from the Electron app.');
      return;
    }

    window.electronAPI.stopBot();
  }

  useEffect(() => {
    const hasElectron = Boolean(window.electronAPI?.launchBot);
    setIsElectronRuntime(hasElectron);

    if (!hasElectron) {
      return;
    }

    window.electronAPI.onBotStatus(({ status }) => {
      console.log('⚙️ Bot status:', status);
      setBotStatus(status); // update your UI button state here
    });
  }, []);

  const openModal = async () => {
    if (!window.electronAPI?.launchBot) {
      setLaunchError('Launch is only available from the Electron app. Run `npm run dev:electron`, then launch from there.');
      return;
    }

    try {
      const token = await getAccessTokenSilently();

      setAuthToken(token);
      setLaunchError('');
      setShowLaunchModal(true);
    } catch (e) {
      setLaunchError('Could not get an Auth0 token. Log in again and retry.');
      console.error('🔒 Failed to fetch token:', e);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      {!isElectronRuntime && (
        <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
          Launch/Stop controls require Electron IPC and are disabled in plain browser mode.
          Start Electron with <code>npm run dev:electron</code>, or run the bot directly via <code>npm run dev:bot</code>.
        </div>
      )}

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

      {launchError && (
        <p className="text-sm text-red-300">{launchError}</p>
      )}

      <div className="flex items-center space-x-2">
        <div className={`w-3 h-3 rounded-full ${statusColor}`} />
        <span className="text-sm text-gray-300">{t('control.status')}: {statusLabel}</span>
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
