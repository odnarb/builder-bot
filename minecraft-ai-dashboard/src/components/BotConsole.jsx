import React, { useContext } from 'react';
import { WebSocketContext } from './WebSocketProvider';

export default function BotConsole() {
  const { messages } = useContext(WebSocketContext);

  return (
    <div className="bg-gray-900 text-green-300 font-mono p-4 rounded h-64 overflow-y-auto text-sm shadow-inner">
      {messages.length === 0 && <div className="text-gray-500">No bot activity yet.</div>}
      {messages.map((msg, idx) => {
        console.log('message rendering', msg)
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
            return <div key={idx} className="text-blue-300">📍 Bot position: ({msg.position.x}, {msg.position.y}, {msg.position.z})</div>

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
                    <li key={block}>{block}: {count}</li>
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
  );
}
