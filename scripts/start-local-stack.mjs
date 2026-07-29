import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   platform?: NodeJS.Platform | string,
 *   commandLookup?: (
 *     command: string,
 *     options: { env: NodeJS.ProcessEnv | Record<string, string | undefined> },
 *   ) => boolean,
 * }} [options]
 * @returns {{
 *   command: string,
 *   gitBashCommand: string,
 *   kind: 'windows-terminal',
 * } | null} Terminal command details.
 */
export function findTerminalLauncher({
  env = process.env,
  platform = process.platform,
  commandLookup = isWindowsCommandAvailable,
} = {}) {
  const pathEntries = splitSearchPath(env.PATH);
  const windowsTerminal = pathEntries
    .map((entry) => path.join(entry, 'wt.exe'))
    .find((candidate) => existsSync(candidate))
    || (
      platform === 'win32'
      && commandLookup('wt.exe', { env })
      && 'wt.exe'
    );
  const gitBash = findGitBashExecutable({ env, pathEntries });

  if (windowsTerminal && gitBash) {
    return {
      command: windowsTerminal,
      gitBashCommand: toWindowsExecutablePath(gitBash),
      kind: 'windows-terminal',
    };
  }

  return null;
}

/**
 * Check whether Windows can resolve a command, including Store app aliases.
 *
 * @param {string} command Command name to resolve.
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 * }} [options]
 * @returns {boolean} True when where.exe resolves the command.
 */
function isWindowsCommandAvailable(command, { env = process.env } = {}) {
  try {
    const lookup = spawnSync('where.exe', [command], {
      encoding: 'utf8',
      env,
      windowsHide: true,
    });
    return lookup.status === 0 && Boolean(lookup.stdout.trim());
  } catch {
    return false;
  }
}

/**
 * Split the platform search path into normalized directory entries.
 *
 * @param {string | undefined} searchPath Raw PATH value.
 * @returns {string[]} Non-empty, unquoted PATH entries.
 */
function splitSearchPath(searchPath) {
  return String(searchPath || '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

/**
 * Find Git for Windows Bash without accepting the Windows WSL bash shim.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 *   pathEntries?: string[],
 * }} [options]
 * @returns {string | null} Git Bash executable path, or null when unavailable.
 */
export function findGitBashExecutable({
  env = process.env,
  pathEntries = splitSearchPath(env.PATH),
} = {}) {
  const candidates = [];

  for (const entry of pathEntries) {
    const directoryName = path.basename(entry).toLowerCase();
    const parentName = path.basename(path.dirname(entry)).toLowerCase();

    if (directoryName === 'bin' && parentName === 'git') {
      candidates.push(path.join(entry, 'bash.exe'));
    }

    if (directoryName === 'cmd' && parentName === 'git') {
      candidates.push(path.resolve(entry, '..', 'bin', 'bash.exe'));
    }
  }

  for (const programFiles of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (programFiles) {
      candidates.push(path.join(programFiles, 'Git', 'bin', 'bash.exe'));
    }
  }

  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  }

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/**
 * Convert a WSL-mounted Windows executable path for a native Windows process.
 *
 * @param {string} executablePath Executable path visible from the current runtime.
 * @returns {string} Native Windows path when the input is under /mnt/<drive>.
 */
export function toWindowsExecutablePath(executablePath) {
  const match = String(executablePath).match(/^\/mnt\/([a-z])\/(.+)$/i);
  if (!match) {
    return executablePath;
  }

  const [, drive, relativePath] = match;
  return `${drive.toUpperCase()}:\\${relativePath.replaceAll('/', '\\')}`;
}

/**
 * Resolve the originating WSL distro and Linux working directory.
 *
 * @param {{
 *   root?: string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 * }} [options]
 * @returns {{ distro: string, root: string } | null} WSL launch context.
 */
export function resolveWslContext({
  root = repoRoot,
  env = process.env,
} = {}) {
  const distro = String(env.WSL_DISTRO_NAME || '').trim();
  if (distro && path.posix.isAbsolute(root)) {
    return { distro, root };
  }

  const normalizedRoot = String(root).replaceAll('/', '\\');
  const uncMatch = normalizedRoot.match(/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\?(.*)$/i);
  if (!uncMatch) {
    return null;
  }

  const [, uncDistro, relativePath] = uncMatch;
  const linuxRoot = `/${relativePath.replaceAll('\\', '/')}`.replace(/\/+$/, '') || '/';
  return {
    distro: uncDistro,
    root: linuxRoot,
  };
}

/**
 * Build command arguments for opening a service in a new terminal.
 *
 * @param {{
 *   command: string,
 *   gitBashCommand: string,
 *   kind: 'windows-terminal',
 * }} launcher Terminal launcher details.
 * @param {{ name: string, title: string }} service Service details.
 * @param {{
 *   root?: string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 * }} [options] Launch context overrides.
 * @returns {string[]} Arguments for the launcher command.
 * @throws {Error} When the launcher kind or workspace context is unsupported.
 */
export function buildTerminalArgs(
  launcher,
  service,
  {
    root = repoRoot,
    env = process.env,
  } = {},
) {
  if (launcher.kind !== 'windows-terminal') {
    throw new Error(`Unsupported terminal launcher "${launcher.kind}".`);
  }

  const wslContext = resolveWslContext({ root, env });
  if (!wslContext) {
    throw new Error(
      'Git Bash stack launching requires BuilderBot to run from WSL or a \\\\wsl.localhost workspace.',
    );
  }

  const serviceCommand = `npm run dev:local-stack -- ${service.name}`;
  const shellCommand = [
    "MSYS2_ARG_CONV_EXCL='*'",
    'wsl.exe',
    '--distribution',
    shellQuote(wslContext.distro),
    '--cd',
    shellQuote(wslContext.root),
    '--exec',
    'bash',
    '-lc',
    shellQuote(serviceCommand),
    '|| exec bash --login -i',
  ].join(' ');

  return [
    'new-tab',
    '--title',
    service.title,
    launcher.gitBashCommand,
    '--login',
    '-i',
    '-c',
    shellCommand,
  ];
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
 * Determine whether a module was invoked as the Node.js entrypoint.
 *
 * @param {string} moduleUrl Module URL from import.meta.url.
 * @param {string | undefined} entryPath Entry path from process.argv[1].
 * @returns {boolean} True when the paths identify the same module.
 */
export function isDirectExecution(moduleUrl, entryPath = process.argv[1]) {
  if (!entryPath) {
    return false;
  }

  const modulePath = path.normalize(fileURLToPath(moduleUrl));
  const resolvedEntryPath = path.resolve(entryPath);

  if (process.platform === 'win32') {
    return modulePath.toLowerCase() === resolvedEntryPath.toLowerCase();
  }

  return modulePath === resolvedEntryPath;
}

/**
 * Spawn one detached terminal for a service.
 *
 * @param {{
 *   command: string,
 *   gitBashCommand: string,
 *   kind: 'windows-terminal',
 * }} launcher Terminal launcher details.
 * @param {{ name: string, title: string }} service Service details.
 * @param {{
 *   spawnProcess?: typeof spawn,
 *   isDryRun?: boolean,
 *   root?: string,
 *   env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
 * }} [options] Process and launch-context overrides.
 * @returns {Promise<void>} Resolves once Windows Terminal accepts the process spawn.
 * @throws {Error} When Windows Terminal cannot be spawned.
 */
export function openServiceTerminal(
  launcher,
  service,
  {
    spawnProcess = spawn,
    isDryRun = dryRun,
    root = repoRoot,
    env = process.env,
  } = {},
) {
  const args = buildTerminalArgs(launcher, service, { root, env });

  if (isDryRun) {
    console.log(`[dry-run] ${launcher.command} ${args.join(' ')}`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawnProcess(launcher.command, args, {
        cwd: root,
        detached: true,
        stdio: 'ignore',
      });
    } catch {
      reject(new Error(
        `Could not open ${service.title} in Git Bash. Verify Windows Terminal and Git for Windows are installed.`,
      ));
      return;
    }

    child.once('error', () => {
      reject(new Error(
        `Could not open ${service.title} in Git Bash. Verify Windows Terminal and Git for Windows are installed.`,
      ));
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
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
    throw new Error(
      'Windows Terminal and Git Bash are required for automatic stack launching. Install Git for Windows or run services manually from the README.',
    );
  }

  for (const service of services) {
    if (await isPortOpen(service.port)) {
      console.log(`${service.title} already appears to be running on port ${service.port}. Skipping.`);
      continue;
    }

    console.log(`Opening ${service.title} terminal...`);
    await openServiceTerminal(launcher, service);
  }
}

if (isDirectExecution(import.meta.url)) {
  startLocalStack().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
