import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { endSession } from '../bot/apiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let botProcess = null;
let tray = null;

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

function createTray() {
    const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'logo.ico' : 'logo.png');
    const icon = nativeImage.createFromPath(iconPath);

    tray = new Tray(icon); // Must be called AFTER app is ready

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App', click: () => {
                const win = BrowserWindow.getAllWindows()[0];
                if (win) win.show();
            }
        },
        { label: 'Quit', click: () => app.quit() }
    ]);

    tray.setToolTip('BuilderBot');
    tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
    createTray();
    createWindow();
});

const envVars = {}

// ✅ Listen for bot launch from UI
ipcMain.on('launch-bot', (event, env) => {
    if (botProcess) {
        console.log('🤖 Bot is already running');
        return;
    }

    //TODO: UPDATE THIS TO PROD VS DEV
    envVars.API_URL = 'http://localhost:3001'

    // when launching, create an env var as the session id to save builds and chats to
    envVars.SESSION_ID = crypto.randomUUID()

    envVars.AUTH_TOKEN = env.authToken
    envVars.USER_ID = env.userId
    envVars.COMMANDER_UUID = env.commanderUUID
    envVars.MC_HOST_IP = env.mcHostIp
    envVars.MC_HOST_PORT = env.mcHostPort
    envVars.MC_HOST_VERSION = env.mcHostVersion
    envVars.BOT_NAME = env.botName

    event.sender.send('bot-status', { status: 'launching' });

    botProcess = spawn('node', ['bot/index.js'], {
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
            error_timestamp: new Date().toISOString(),
            exit_location: 'electron',
            error: err.stack,
            error_message: error.message,
            exit_code: -1
        }
        await endSession({ sessionId: envVars.SESSION_ID, session })

        event.sender.send('bot-status', { status: 'exited', code: -1 });
        botProcess = null;
    });
});

ipcMain.on('stop-bot', async (event) => {
    if (botProcess) {
        console.log('🛑 Stopping bot process...');
        botProcess.kill('SIGINT'); // or 'SIGTERM' for softer shutdown
        botProcess = null

        const session = {
            exit_reason: 'process stopped manually',
            exit_code: 0
        }
        await endSession({ envVars, session })
    } else {
        console.log('⚠️ No bot process to stop.');
    }
});

ipcMain.on('window:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
});

ipcMain.on('window:close', async () => {
    const session = {
        exit_reason: 'process stopped manually',
        exit_code: 0
    }
    await endSession({ envVars, session })
    BrowserWindow.getFocusedWindow()?.close();
});