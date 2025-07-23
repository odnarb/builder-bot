import { spawn } from 'child_process';
import { ipcMain } from 'electron';
import path from 'path';

ipcMain.on('launch-bot', (event, env) => {
    const envVars = {
        ...process.env,
        AUTH_TOKEN: env.authToken,
        USER_ID: env.userId,
        COMMANDER_UUID: env.commanderUUID,
        MC_HOST_IP: env.mcHostIp,
        MC_HOST_PORT: env.mcHostPort,
        MC_HOST_VERSION: env.mcHostVersion,
        BOT_NAME: env.botName
    };

    const botPath = path.resolve(__dirname, '../apps/bot/index.js');

    const botProcess = spawn('node', [botPath], {
        env: envVars,
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit'
    });

    botProcess.on('exit', code => {
        console.log(`👋 Bot process exited with code ${code}`);
    });
});
