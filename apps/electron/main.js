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

    win.webContents.on('did-fail-load', () => {
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
            <!doctype html>
            <html>
                <head>
                    <title>BuilderBot</title>
                    <style>
                        body {
                            margin: 0;
                            min-height: 100vh;
                            display: grid;
                            place-items: center;
                            background: #101418;
                            color: #f4f7f9;
                            font-family: Arial, sans-serif;
                        }
                        main {
                            max-width: 520px;
                            padding: 32px;
                            line-height: 1.5;
                        }
                        code {
                            background: #202832;
                            padding: 2px 6px;
                            border-radius: 4px;
                        }
                    </style>
                </head>
                <body>
                    <main>
                        <h1>BuilderBot Web UI is not running</h1>
                        <p>Start the Web UI, then restart Electron.</p>
                        <p><code>npm --prefix apps/webui run dev</code></p>
                    </main>
                </body>
            </html>
        `)}`);
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

async function safeEndSession(session, context = 'unknown') {
    try {
        await endSession({ envVars, session });
    } catch (error) {
        console.warn(`⚠️ Could not persist end session (${context}): ${error.message}`);
    }
}

// ✅ Listen for bot launch from UI
ipcMain.on('launch-bot', (event, env) => {
    if (botProcess) {
        console.log('🤖 Bot is already running');
        return;
    }

    //TODO: UPDATE THIS TO PROD VS DEV
    envVars.API_URL = 'http://localhost:3001'

    // when launching, create an env var as the session id to save builds and chats to
    envVars.SESSION_ID = randomUUID()

    envVars.AUTH_TOKEN = env.authToken
    envVars.USER_ID = env.userId
    envVars.COMMANDER_UUID = env.commanderUUID
    envVars.MC_HOST_IP = env.mcHostIp
    envVars.MC_HOST_PORT = env.mcHostPort
    envVars.MC_HOST_VERSION = env.mcHostVersion
    envVars.BOT_NAME = env.botName

    event.sender.send('bot-status', { status: 'launching' });

    botProcess = spawn('node', ['bot/index.js'], {
        env: { ...process.env, ...envVars, LANG: 'en_US.UTF-8' },
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
    });

    botProcess.on('spawn', () => {
        event.sender.send('bot-status', { status: 'running' });
    });

    botProcess.on('close', async (code) => {
        console.log(`👋 Bot process exited with code ${code}`);
        await safeEndSession({ exit_code: code }, 'child_process.close');
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
            error_message: err.message,
            exit_code: -1
        }
        await safeEndSession(session, 'child_process.error');

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
        await safeEndSession(session, 'ipc.stop-bot');
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
    await safeEndSession(session, 'ipc.window-close');
    BrowserWindow.getFocusedWindow()?.close();
});
