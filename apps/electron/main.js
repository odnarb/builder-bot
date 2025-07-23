import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
    const win = new BrowserWindow({
        autoHideMenuBar: true,
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
    const envVars = {
        //hard-code this for now until we split the AI call to the api
        OPENAI_API_KEY: 'xyz',
        AUTH_TOKEN: env.authToken,
        USER_ID: env.userId,
        COMMANDER_UUID: env.commanderUUID,
        MC_HOST_IP: env.mcHostIp,
        MC_HOST_PORT: env.mcHostPort,
        MC_HOST_VERSION: env.mcHostVersion,
        BOT_NAME: env.botName,
    }

    const botProcess = spawn('node', ['bot/index.js'], {
        env: envVars,
        LANG: 'en_US.UTF-8',
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
    });

    botProcess.on('close', code => {
        console.log(`👋 Bot process exited with code ${code}`);
    });
});
