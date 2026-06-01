import React, { useState, useContext } from 'react';
import { WebSocketContext } from './WebSocketProvider';
import { useLocalization } from './LocalizationProvider';

export default function PromptInput() {
  const { sendMessage } = useContext(WebSocketContext);
  const { t } = useLocalization();
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('build ') || trimmed.startsWith('move ') || trimmed.startsWith('come') || trimmed.startsWith('follow') || trimmed.startsWith('stop')) {
      sendMessage({ type: 'chat_command', message: trimmed });
    } else {
      // fallback for unknown command format
      sendMessage({ type: 'raw_prompt', prompt: trimmed });
    }

    setInput('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center space-x-2">
      <input
        type="text"
        className="flex-grow px-3 py-1 rounded bg-gray-800 text-white placeholder-gray-500"
        placeholder={t('prompt.placeholder')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        type="submit"
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1 rounded"
      >
        {t('prompt.send')}
      </button>
    </form>
  );
}
