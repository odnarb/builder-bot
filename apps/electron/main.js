import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { endSession } from '../bot/apiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let botProcess = null;

function createWindow() {
    const win = new BrowserWindow({
        autoHideMenuBar: true,
        width: 1200,
        height: 800,
        frame: false,
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
    if (botProcess) {
        console.log('🤖 Bot is already running');
        return;
    }

    const envVars = {
        //TODO: UPDATE THIS TO PROD VS DEV
        API_URL: 'http://localhost:3001',
        // when launching, create an env var as the session id to save builds and chats to
        SESSION_ID: crypto.randomUUID(),
        AUTH_TOKEN: env.authToken,
        USER_ID: env.userId,
        COMMANDER_UUID: env.commanderUUID,
        MC_HOST_IP: env.mcHostIp,
        MC_HOST_PORT: env.mcHostPort,
        MC_HOST_VERSION: env.mcHostVersion,
        BOT_NAME: env.botName,
    }

    event.sender.send('bot-status', { status: 'launching' });

    console.log(`auth token: `, envVars.AUTH_TOKEN)

    const botProcess = spawn('node', ['bot/index.js'], {
        env: envVars,
        LANG: 'en_US.UTF-8',
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
    });

    botProcess.on('spawn', () => {
        event.sender.send('bot-status', { status: 'running' });
    });

    botProcess.on('close', async (code) => {
        console.log(`👋 Bot process exited with code ${code}`);
        await endSession({ envVars, session: { exit_code: code } })
        event.sender.send('bot-status', { status: 'exited', code });
        botProcess = null;
    });

    botProcess.on('error', async (err) => {
        console.log(`❌ Bot process error ${err.stack}`);
        //record session end and timestamp
        const session = {
            error: err.stack,
            error_message: error.message,
            exit_code: -1
        }
        await endSession({ sessionId: SESSION_ID, session })

        event.sender.send('bot-status', { status: 'exited', code: -1 });
        botProcess = null;
    });
});
