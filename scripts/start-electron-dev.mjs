import net from 'node:net';
import { spawn } from 'node:child_process';

const WEBUI_PORT = Number(process.env.WEBUI_PORT || 5173);
const WEBUI_URL = `http://localhost:${WEBUI_PORT}`;
const children = new Set();

/**
 * Check whether a local TCP port is accepting connections.
 * @param {number} port Port number to test.
 * @param {string} host Hostname or IP address to test.
 * @returns {Promise<boolean>} True when the port accepts connections.
 */
export function isPortOpen(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = net.createConnection({ host, port });

        socket.setTimeout(500);
        socket.once('connect', () => {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', () => {
            resolve(false);
        });
    });
}

/**
 * Wait for a local port to become ready.
 * @param {{ port: number, timeoutMs?: number }} params Wait options.
 * @returns {Promise<void>} Resolves when the port is open.
 * @throws {Error} When the timeout is reached.
 */
export async function waitForPort({ port, timeoutMs = 15000 }) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (await isPortOpen(port)) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for ${WEBUI_URL}.`);
}

/**
 * Spawn a child process and track it for cleanup.
 * @param {string} command Command to run.
 * @param {string[]} args Command arguments.
 * @param {import('node:child_process').SpawnOptions} options Spawn options.
 * @returns {import('node:child_process').ChildProcess} Spawned child process.
 */
function spawnTracked(command, args, options = {}) {
    const child = spawn(command, args, {
        stdio: 'inherit',
        shell: process.platform === 'win32',
        ...options,
    });

    children.add(child);
    child.once('exit', () => {
        children.delete(child);
    });
    child.once('error', (error) => {
        console.error(error.message);
    });

    return child;
}

/**
 * Stop tracked child processes.
 * @returns {void}
 */
function cleanup() {
    for (const child of children) {
        if (!child.killed) {
            child.kill('SIGINT');
        }
    }
}

/**
 * Start the Web UI when needed, then launch Electron.
 * @returns {Promise<void>} Resolves after Electron exits.
 */
export async function startElectronDev() {
    if (await isPortOpen(WEBUI_PORT)) {
        console.log(`Web UI already running at ${WEBUI_URL}.`);
    } else {
        console.log(`Starting Web UI at ${WEBUI_URL}...`);
        spawnTracked('npm', ['--prefix', 'apps/webui', 'run', 'dev'], {
            cwd: process.cwd(),
        });
        await waitForPort({ port: WEBUI_PORT });
    }

    console.log('Starting Electron...');
    const electron = spawnTracked('electron', ['apps/electron/main.js'], {
        cwd: process.cwd(),
    });

    await new Promise((resolve, reject) => {
        electron.once('exit', (code) => {
            cleanup();
            if (code && code !== 0) {
                reject(new Error(`Electron exited with code ${code}.`));
                return;
            }
            resolve();
        });
    });
}

process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
});

process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
});

if (import.meta.url === `file://${process.argv[1]}`) {
    startElectronDev().catch((error) => {
        cleanup();
        console.error(error.message);
        process.exitCode = 1;
    });
}
