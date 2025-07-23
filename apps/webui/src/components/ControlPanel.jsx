import React, { useContext, useState } from 'react';
import { WebSocketContext } from './WebSocketProvider';
import LaunchBotModal from './LaunchBotModal';

export default function ControlPanel() {
  const { sendMessage } = useContext(WebSocketContext);
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  const handleLaunchBot = (envVars) => {
    window.electronAPI?.launchBot?.(envVars);
  };

  return (
    <div className="space-y-4 mt-4">
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

      <div>
        <button
          onClick={() => setShowLaunchModal(true)}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
        >
          🧠 Launch BuilderBot
        </button>
      </div>

      {showLaunchModal && (
        <LaunchBotModal
          onClose={() => setShowLaunchModal(false)}
          onLaunch={handleLaunchBot}
        />
      )}
    </div>
  );
}
