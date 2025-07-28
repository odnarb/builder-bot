// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    launchBot: (env) => ipcRenderer.send('launch-bot', env),
    stopBot: () => ipcRenderer.send('stop-bot'),
    onBotStatus: (callback) => ipcRenderer.on('bot-status', (_, data) => callback(data)),
    window: {
        minimize: () => ipcRenderer.send('window:minimize'),
        maximize: () => ipcRenderer.send('window:toggle-maximize'),
        close: () => ipcRenderer.send('window:close'),
    }
});
