import React, { useContext } from 'react';
import { WebSocketContext } from './WebSocketProvider';

export default function BotConsole() {
  const { messages } = useContext(WebSocketContext);

  return (
    <div className="bg-gray-900 text-green-300 font-mono p-4 rounded h-64 overflow-y-auto text-sm shadow-inner">
      {messages.length === 0 && <div className="text-gray-500">No bot activity yet.</div>}
      {messages.map((msg, idx) => (
        <div key={idx}>
          {JSON.stringify(msg)}
        </div>
      ))}
    </div>
  );
}
