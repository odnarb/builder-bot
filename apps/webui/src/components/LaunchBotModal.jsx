import React, { useState } from 'react';

export default function LaunchBotModal({ onClose, onLaunch }) {
    const [form, setForm] = useState({
        authToken: '',
        userId: '',
        commanderUUID: '',
        mcHostIp: '127.0.0.1',
        mcHostPort: 25565,
        mcHostVersion: '1.21',
        botName: 'BuilderBot',
    });

    const updateField = (field, value) =>
        setForm(prev => ({ ...prev, [field]: value }));

    const handleLaunch = () => {
        onLaunch(form); // 🚀 Trigger the launch process
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-gray-800 text-white p-6 rounded w-full max-w-md shadow-lg">
                <h2 className="text-xl font-bold mb-4">🚀 Launch BuilderBot</h2>

                {Object.entries(form).map(([key, value]) => (
                    <div className="mb-3" key={key}>
                        <label className="block text-sm mb-1 capitalize">{key}</label>
                        <input
                            type="text"
                            value={value}
                            onChange={e => updateField(key, e.target.value)}
                            className="w-full bg-gray-700 text-white p-2 rounded"
                        />
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
