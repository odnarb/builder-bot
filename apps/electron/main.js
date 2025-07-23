const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'), // ✅ Point here
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    win.loadURL('http://localhost:5173'); // or loadFile for production
}

app.whenReady().then(createWindow);

// ✅ Listen for bot launch from UI
ipcMain.on('launch-bot', (event, env) => {
    const botProcess = spawn('node', ['apps/bot/index.js'], {
        env: {
            ...process.env,
            AUTH_TOKEN: env.authToken,
            USER_ID: env.userId,
            COMMANDER_UUID: env.commanderUUID,
            MC_HOST_IP: env.mcHostIp,
            MC_HOST_PORT: env.mcHostPort,
            MC_HOST_VERSION: env.mcHostVersion,
            BOT_NAME: env.botName,
        },
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
    });

    botProcess.on('close', code => {
        console.log(`👋 Bot process exited with code ${code}`);
    });
});
