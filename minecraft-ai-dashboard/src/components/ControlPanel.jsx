import React, { useContext } from 'react';
import { WebSocketContext } from './WebSocketProvider';

const predefinedBuild = "build a cube";

export default function ControlPanel() {
  const { sendMessage } = useContext(WebSocketContext);

  const handleSendBuild = () => {
    sendMessage([
      { type: "move_to", x: 10, y: 70, z: 10 },
      { block: "cobblestone", x: 10, y: 70, z: 10 },
      { block: "cobblestone", x: 11, y: 70, z: 10 },
      { block: "cobblestone", x: 12, y: 70, z: 10 }
    ]);
  };

  return (
    <div className="space-x-2 mt-4">
      <button
        onClick={() => sendMessage({ type: "get_position" })}
        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded"
      >
        Get Position
      </button>

      <button
        onClick={handleSendBuild}
        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
      >
        Build Test
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
  );
}
