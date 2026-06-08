import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const repoRoot = process.cwd();
const dryRun = process.env.BUILDERBOT_LOCAL_STACK_DRY_RUN === '1';

const services = Object.freeze([
  {
    name: 'minecraft',
    title: 'BuilderBot Minecraft',
    port: Number(process.env.MC_HOST_PORT || 25565),
  },
  {
    name: 'api',
    title: 'BuilderBot API',
    port: Number(process.env.PORT || 3001),
  },
  {
    name: 'webui',
    title: 'BuilderBot Web UI',
    port: Number(process.env.WEBUI_PORT || 5173),
  },
  {
    name: 'bot',
    title: 'BuilderBot Bot',
    port: Number(process.env.BOT_WS_PORT || 3002),
  },
]);

/**
 * Check whether a local TCP port is accepting connections.
 *
 * @param {number} port Port number to check.
 * @param {string} host Hostname or IP address to check.
 * @returns {Promise<boolean>} True when the port accepts a connection.
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
 * Find the command used to open a terminal window.
 *
 * @returns {{ command: string, kind: 'windows-terminal' } | null} Terminal command details.
 */
export function findTerminalLauncher({ env = process.env } = {}) {
  const pathEntries = String(env.PATH || '').split(path.delimiter);
  const windowsTerminal = pathEntries
    .map((entry) => path.join(entry, 'wt.exe'))
    .find((candidate) => existsSync(candidate));

  if (windowsTerminal) {
    return { command: windowsTerminal, kind: 'windows-terminal' };
  }

  return null;
}

/**
 * Build command arguments for opening a service in a new terminal.
 *
 * @param {{ command: string, kind: 'windows-terminal' }} launcher Terminal launcher details.
 * @param {{ name: string, title: string }} service Service details.
 * @returns {string[]} Arguments for the launcher command.
 * @throws {Error} When the launcher kind is unsupported.
 */
export function buildTerminalArgs(launcher, service) {
  const shellCommand = [
    `cd ${shellQuote(repoRoot)}`,
    `npm run dev:local-stack -- ${service.name}`,
    'exec bash',
  ].join('; ');

  if (launcher.kind === 'windows-terminal') {
    return [
      'new-tab',
      '--title',
      service.title,
      'wsl.exe',
      '--cd',
      repoRoot,
      'bash',
      '-lc',
      shellCommand,
    ];
  }

  throw new Error(`Unsupported terminal launcher "${launcher.kind}".`);
}

/**
 * Quote a value for a POSIX shell command.
 *
 * @param {string} value Raw shell value.
 * @returns {string} Safely quoted shell value.
 */
function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * Spawn one detached terminal for a service.
 *
 * @param {{ command: string, kind: 'windows-terminal' }} launcher Terminal launcher details.
 * @param {{ name: string, title: string }} service Service details.
 * @returns {void}
 */
function openServiceTerminal(launcher, service) {
  const args = buildTerminalArgs(launcher, service);

  if (dryRun) {
    console.log(`[dry-run] ${launcher.command} ${args.join(' ')}`);
    return;
  }

  const child = spawn(launcher.command, args, {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
}

/**
 * Start all local stack services in separate terminals when needed.
 *
 * @returns {Promise<void>} Resolves after terminal launch attempts finish.
 * @throws {Error} When no supported terminal launcher exists.
 */
export async function startLocalStack() {
  const launcher = findTerminalLauncher();
  if (!launcher) {
    throw new Error('No supported terminal launcher found. Install Windows Terminal or run services manually from the README.');
  }

  for (const service of services) {
    if (await isPortOpen(service.port)) {
      console.log(`${service.title} already appears to be running on port ${service.port}. Skipping.`);
      continue;
    }

    console.log(`Opening ${service.title} terminal...`);
    openServiceTerminal(launcher, service);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startLocalStack().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
