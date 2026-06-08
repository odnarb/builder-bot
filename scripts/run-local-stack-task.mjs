import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const repoRoot = process.cwd();

const services = Object.freeze({
  minecraft: {
    label: 'Minecraft server',
    port: Number(process.env.MC_HOST_PORT || 25565),
    cwd: path.join(repoRoot, '.local-minecraft-server'),
    command: 'java',
    args: ['-Xmx2G', '-jar', 'paper-1.20.4-499.jar', 'nogui'],
    beforeStart: ensureMinecraftServerReady,
  },
  api: {
    label: 'API server',
    port: Number(process.env.PORT || 3001),
    cwd: repoRoot,
    command: 'npm',
    args: ['--prefix', 'apps/api', 'run', 'dev'],
  },
  webui: {
    label: 'Web UI',
    port: Number(process.env.WEBUI_PORT || 5173),
    cwd: repoRoot,
    command: 'npm',
    args: ['--prefix', 'apps/webui', 'run', 'dev'],
  },
  bot: {
    label: 'Minecraft bot WebSocket server',
    port: Number(process.env.BOT_WS_PORT || 3002),
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'dev:bot'],
  },
});

/**
 * Check whether a local TCP port is accepting connections.
 *
 * @param {number} port Port number to test.
 * @param {string} host Hostname or IP address to test.
 * @returns {Promise<boolean>} True when a connection succeeds.
 */
function isPortOpen(port, host = '127.0.0.1') {
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
 * Validate local Paper server files before starting Minecraft.
 *
 * @param {{ cwd: string }} service Service definition.
 * @returns {Promise<void>} Resolves when startup can continue.
 * @throws {Error} When the Paper jar is missing or the EULA is not accepted.
 */
async function ensureMinecraftServerReady(service) {
  const jarPath = path.join(service.cwd, 'paper-1.20.4-499.jar');
  const eulaPath = path.join(service.cwd, 'eula.txt');

  if (!existsSync(jarPath)) {
    throw new Error(`Minecraft server jar is missing at ${jarPath}.`);
  }

  if (!existsSync(eulaPath)) {
    throw new Error(`Minecraft EULA file is missing at ${eulaPath}. Start the server once to generate it.`);
  }

  const eulaText = readFileSync(eulaPath, 'utf8');
  if (!/^eula=true$/m.test(eulaText)) {
    throw new Error('Minecraft EULA is not accepted yet. Edit .local-minecraft-server/eula.txt and set eula=true if you agree to it.');
  }
}

/**
 * Start a long-running service in the current terminal.
 *
 * @param {{ label: string, cwd: string, command: string, args: string[] }} service Service definition.
 * @returns {Promise<void>} Resolves after the child process exits.
 */
function startService(service) {
  return new Promise((resolve, reject) => {
    const child = spawn(service.command, service.args, {
      cwd: service.cwd,
      env: process.env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${service.label} stopped from signal ${signal}.`));
        return;
      }

      if (code && code !== 0) {
        reject(new Error(`${service.label} exited with code ${code}.`));
        return;
      }

      resolve();
    });
  });
}

/**
 * Run one local development stack task after checking for duplicates.
 *
 * @param {string} serviceName Name from the service registry.
 * @returns {Promise<void>} Resolves when the task is skipped or the service exits.
 * @throws {Error} When the service name is unknown or startup validation fails.
 */
export async function runLocalStackTask(serviceName) {
  const service = services[serviceName];
  if (!service) {
    const names = Object.keys(services).join(', ');
    throw new Error(`Unknown local stack service "${serviceName}". Use one of: ${names}.`);
  }

  if (await isPortOpen(service.port)) {
    console.log(`${service.label} already appears to be running on port ${service.port}. Skipping.`);
    return;
  }

  if (service.beforeStart) {
    await service.beforeStart(service);
  }

  console.log(`Starting ${service.label} on port ${service.port}...`);
  await startService(service);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const serviceName = process.argv[2];

  runLocalStackTask(serviceName).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
