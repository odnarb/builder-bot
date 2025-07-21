import React, { useContext, useState } from 'react';
import { WebSocketContext } from './WebSocketProvider';

export default function BotConsole() {
  const { messages, sendMessage } = useContext(WebSocketContext);
  const [chatControlEnabled, setChatControlEnabled] = useState(true);
  const [showMoveToModal, setShowMoveToModal] = useState(false);
  const [coords, setCoords] = useState({ x: '', y: '', z: '' });

  const handleMoveTo = () => {
    sendMessage({
      type: 'move_to',
      x: parseInt(coords.x),
      y: parseInt(coords.y),
      z: parseInt(coords.z),
    });
    setShowMoveToModal(false);
    setCoords({ x: '', y: '', z: '' });
  };

  const handleCommand = (cmd) => {
    if (!chatControlEnabled) return;
    sendMessage({ type: 'chat_command', message: cmd });
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex justify-between items-center">
        <label className="text-white text-sm flex items-center gap-2">
          <input
            type="checkbox"
            checked={chatControlEnabled}
            onChange={() => setChatControlEnabled(!chatControlEnabled)}
            className="form-checkbox"
          />
          Enable Chat Control
        </label>
        <div className="flex gap-2">
          <button
            className="bg-blue-700 hover:bg-blue-800 px-3 py-1 text-white text-xs rounded"
            onClick={() => handleCommand('come here')}
          >
            👣 Follow
          </button>
          <button
            className="bg-yellow-600 hover:bg-yellow-700 px-3 py-1 text-white text-xs rounded"
            onClick={() => handleCommand('stop')}
          >
            ✋ Stop
          </button>
          <button
            className="bg-indigo-700 hover:bg-indigo-800 px-3 py-1 text-white text-xs rounded"
            onClick={() => setShowMoveToModal(true)}
          >
            🧭 Move To
          </button>
        </div>
      </div>

      {/* Chat Feed */}
      <div className="bg-gray-900 text-green-300 font-mono p-4 rounded h-64 overflow-y-auto text-sm shadow-inner">
        {messages.length === 0 && <div className="text-gray-500">No bot activity yet.</div>}
        {messages.map((msg, idx) => {
          console.log('message rendering', msg);
          switch (msg.type) {
            case 'chat_feed': {
              const time = new Date(msg.timestamp).toLocaleTimeString();
              return (
                <div key={idx}>
                  🕒 <span className="text-gray-400">{time}</span> 💬 <strong>{msg.from}</strong>: {msg.text}
                </div>
              );
            }
            case 'moving_to':
              return <div key={idx}>🚶 Moving to ({msg.x}, {msg.y}, {msg.z})</div>;

            case 'move_to': {
              const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
              return (
                <div key={idx}>
                  🕒 <span className="text-gray-400">{time}</span> 🚶 Move to <code>({msg.x}, {msg.y}, {msg.z})</code>
                </div>
              );
            }

            case 'goal_reached':
              return <div key={idx}>✅ Reached goal at ({msg.x}, {msg.y}, {msg.z})</div>;

            case 'block_placed':
              return <div key={idx}>🧱 Placed {msg.block} at ({msg.x}, {msg.y}, {msg.z})</div>;

            case 'bot_position':
              return (
                <div key={idx} className="text-blue-300">
                  📍 Bot position: ({msg.position.x}, {msg.position.y}, {msg.position.z})
                </div>
              );

            case 'bot_inventory': {
              const counts = msg.items.reduce((acc, name) => {
                acc[name] = (acc[name] || 0) + 1;
                return acc;
              }, {});
              return (
                <div key={idx} className="text-yellow-300">
                  🎒 Inventory:
                  <ul className="ml-2 list-disc list-inside">
                    {Object.entries(counts).map(([block, count]) => (
                      <li key={block}>
                        {block}: {count}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }

            case 'nearby_blocks': {
              return (
                <div key={idx} className="text-cyan-300">
                  🌍 Nearby Blocks:
                  <ul className="ml-2 list-disc list-inside">
                    {msg.blocks.map((block, i) => (
                      <li key={i}>
                        {block.name} at ({block.x}, {block.y}, {block.z})
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }

            case 'error':
              return <div key={idx} className="text-red-400">❌ {msg.error}</div>;

            default:
              return <div key={idx} className="text-gray-500">📦 {JSON.stringify(msg)}</div>;
          }
        })}
      </div>

      {/* Move To Modal */}
      {showMoveToModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white text-black p-4 rounded shadow-lg w-64 space-y-2">
            <h3 className="text-lg font-bold">Enter Coordinates</h3>
            <input
              type="number"
              placeholder="X"
              value={coords.x}
              onChange={(e) => setCoords({ ...coords, x: e.target.value })}
              className="w-full p-1 border rounded"
            />
            <input
              type="number"
              placeholder="Y"
              value={coords.y}
              onChange={(e) => setCoords({ ...coords, y: e.target.value })}
              className="w-full p-1 border rounded"
            />
            <input
              type="number"
              placeholder="Z"
              value={coords.z}
              onChange={(e) => setCoords({ ...coords, z: e.target.value })}
              className="w-full p-1 border rounded"
            />
            <div className="flex justify-between">
              <button
                onClick={handleMoveTo}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
              >
                Go
              </button>
              <button
                onClick={() => setShowMoveToModal(false)}
                className="bg-gray-400 hover:bg-gray-500 text-black px-3 py-1 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
