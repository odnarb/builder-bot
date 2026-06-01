import React, { useState } from 'react';
import { useLocalization } from './LocalizationProvider';

export default function LaunchBotModal({ onClose, onLaunch, authToken, userId }) {
    const { t } = useLocalization();
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
            label: t('launch.commanderUuid'),
            description: t('launch.commanderUuidHelp'),
        },
        {
            key: 'mcHostIp',
            label: t('launch.minecraftIp'),
            description: t('launch.minecraftIpHelp'),
        },
        {
            key: 'mcHostPort',
            label: t('launch.minecraftPort'),
            description: t('launch.minecraftPortHelp'),
        },
        {
            key: 'mcHostVersion',
            label: t('launch.minecraftVersion'),
            description: t('launch.minecraftVersionHelp'),
        },
        {
            key: 'botName',
            label: t('launch.botName'),
            description: t('launch.botNameHelp'),
        },
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-gray-800 text-white p-6 rounded w-full max-w-md shadow-lg">
                <h2 className="text-xl font-bold mb-4">{t('launch.title')}</h2>

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
                    <button onClick={onClose} className="text-gray-300 hover:underline">{t('common.cancel')}</button>
                    <button onClick={handleLaunch} className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded text-white">{t('launch.launch')}</button>
                </div>
            </div>
        </div>
    );
}
