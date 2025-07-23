import React, { useState } from 'react';

export default function LaunchBotModal({ onClose, onLaunch, authToken, userId }) {
    const [form, setForm] = useState({
        commanderUUID: 'd32f0358-7604-3be7-b35b-6f8e6ec02e05',
        mcHostIp: '127.0.0.1',
        mcHostPort: 25565,
        mcHostVersion: '1.20.4',
        botName: 'BuilderBot',
    });

    const updateField = (field, value) =>
        setForm(prev => ({ ...prev, [field]: value }));

    const handleLaunch = async () => {
        onLaunch({
            ...form,
            authToken,
            userId
        });
        onClose();
    };

    const fields = [
        {
            key: 'commanderUUID',
            label: 'Your Minecraft UUID',
            description: 'The UUID of the player issuing commands.',
        },
        {
            key: 'mcHostIp',
            label: 'Minecraft Server IP',
            description: 'Defaults to 127.0.0.1 for local testing.',
        },
        {
            key: 'mcHostPort',
            label: 'Minecraft Server Port',
            description: 'Typically 25565 unless changed.',
        },
        {
            key: 'mcHostVersion',
            label: 'Minecraft Version',
            description: 'Ensure it matches your server (e.g., 1.21).',
        },
        {
            key: 'botName',
            label: 'Bot Name',
            description: 'The name that will appear in-game.',
        },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-gray-800 text-white p-6 rounded w-full max-w-md shadow-lg">
                <h2 className="text-xl font-bold mb-4">🚀 Launch BuilderBot</h2>

                {fields.map(({ key, label, description }) => (
                    <div className="mb-4" key={key}>
                        <label className="block text-sm font-medium mb-1">{label}</label>
                        <input
                            type="text"
                            value={form[key]}
                            onChange={e => updateField(key, e.target.value)}
                            className="w-full bg-gray-700 text-white p-2 rounded"
                        />
                        <p className="text-xs text-gray-400 mt-1">{description}</p>
                    </div>
                ))}

                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onClose} className="text-gray-300 hover:underline">Cancel</button>
                    <button onClick={handleLaunch} className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded text-white">Launch</button>
                </div>
            </div>
        </div>
    );
}
