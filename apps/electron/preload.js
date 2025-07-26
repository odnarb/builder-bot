// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    launchBot: (env) => ipcRenderer.send('launch-bot', env),
    onBotStatus: (callback) => ipcRenderer.on('bot-status', (_, data) => callback(data)),
});
