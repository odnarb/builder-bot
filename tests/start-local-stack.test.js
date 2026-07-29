import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildTerminalArgs,
  findGitBashExecutable,
  findTerminalLauncher,
  isDirectExecution,
  openServiceTerminal,
  resolveWslContext,
  toWindowsExecutablePath,
} from '../scripts/start-local-stack.mjs';

/**
 * Create fake Windows Terminal and Git Bash executables for launcher tests.
 *
 * @returns {{
 *   gitBashPath: string,
 *   gitCmdDir: string,
 *   windowsTerminalDir: string,
 *   windowsTerminalPath: string,
 * }} Fake executable paths.
 */
function createFakeWindowsLaunchers() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-terminal-test-'));
  const windowsTerminalDir = path.join(tempDir, 'WindowsApps');
  const gitCmdDir = path.join(tempDir, 'Git', 'cmd');
  const gitBinDir = path.join(tempDir, 'Git', 'bin');
  const windowsTerminalPath = path.join(windowsTerminalDir, 'wt.exe');
  const gitBashPath = path.join(gitBinDir, 'bash.exe');

  fs.mkdirSync(windowsTerminalDir, { recursive: true });
  fs.mkdirSync(gitCmdDir, { recursive: true });
  fs.mkdirSync(gitBinDir, { recursive: true });
  fs.writeFileSync(windowsTerminalPath, '');
  fs.writeFileSync(path.join(gitCmdDir, 'git.exe'), '');
  fs.writeFileSync(gitBashPath, '');

  return {
    gitBashPath,
    gitCmdDir,
    windowsTerminalDir,
    windowsTerminalPath,
  };
}

test('findTerminalLauncher resolves Windows Terminal and Git Bash from PATH', () => {
  const fake = createFakeWindowsLaunchers();
  const launcher = findTerminalLauncher({
    env: {
      PATH: [fake.windowsTerminalDir, fake.gitCmdDir].join(path.delimiter),
    },
  });

  assert.deepEqual(launcher, {
    command: fake.windowsTerminalPath,
    gitBashCommand: fake.gitBashPath,
    kind: 'windows-terminal',
  });
});

test('findTerminalLauncher supports Windows Terminal Store app aliases', () => {
  const fake = createFakeWindowsLaunchers();
  fs.rmSync(fake.windowsTerminalPath);

  const launcher = findTerminalLauncher({
    env: {
      PATH: [fake.windowsTerminalDir, fake.gitCmdDir].join(path.delimiter),
    },
    platform: 'win32',
    commandLookup: (command) => command === 'wt.exe',
  });

  assert.deepEqual(launcher, {
    command: 'wt.exe',
    gitBashCommand: fake.gitBashPath,
    kind: 'windows-terminal',
  });
});

test('findGitBashExecutable does not accept the Windows WSL bash shim', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-bash-shim-test-'));
  fs.writeFileSync(path.join(tempDir, 'bash.exe'), '');

  assert.equal(
    findGitBashExecutable({
      env: { PATH: tempDir },
      pathEntries: [tempDir],
    }),
    null,
  );
});

test('findTerminalLauncher returns null when Git Bash is unavailable', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-wt-only-test-'));
  fs.writeFileSync(path.join(tempDir, 'wt.exe'), '');

  assert.equal(findTerminalLauncher({ env: { PATH: tempDir } }), null);
});

test('toWindowsExecutablePath converts a WSL-mounted executable path', () => {
  assert.equal(
    toWindowsExecutablePath('/mnt/c/Program Files/Git/bin/bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
  );
});

test('isDirectExecution handles URL-encoded entrypoint paths', () => {
  const entryPath = path.join(os.tmpdir(), 'Builder Bot', 'start local stack.mjs');
  const moduleUrl = new URL(`file://${entryPath}`).href;

  assert.equal(isDirectExecution(moduleUrl, entryPath), true);
  assert.equal(isDirectExecution(moduleUrl, ''), false);
});

test('resolveWslContext supports WSL and Windows UNC workspaces', () => {
  assert.deepEqual(
    resolveWslContext({
      root: '/home/builder/Builder Bot',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
    }),
    {
      distro: 'Ubuntu',
      root: '/home/builder/Builder Bot',
    },
  );

  assert.deepEqual(
    resolveWslContext({
      root: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\builder\\Builder Bot',
      env: {},
    }),
    {
      distro: 'Ubuntu-24.04',
      root: '/home/builder/Builder Bot',
    },
  );

  assert.deepEqual(
    resolveWslContext({
      root: '\\\\wsl$\\Ubuntu\\home\\builder\\Builder Bot',
      env: {},
    }),
    {
      distro: 'Ubuntu',
      root: '/home/builder/Builder Bot',
    },
  );
});

test('buildTerminalArgs opens Git Bash and delegates the service back to WSL', () => {
  const args = buildTerminalArgs(
    {
      command: 'wt.exe',
      gitBashCommand: 'C:\\Program Files\\Git\\bin\\bash.exe',
      kind: 'windows-terminal',
    },
    { name: 'api', title: 'BuilderBot API' },
    {
      root: "/home/builder/Builder Bot's",
      env: { WSL_DISTRO_NAME: 'Ubuntu Dev' },
    },
  );

  assert.deepEqual(args.slice(0, 4), [
    'new-tab',
    '--title',
    'BuilderBot API',
    'C:\\Program Files\\Git\\bin\\bash.exe',
  ]);
  assert.deepEqual(args.slice(4, 8), ['--login', '-i', '-c', args.at(-1)]);

  const gitBashCommand = args.at(-1);
  assert.match(gitBashCommand, /MSYS2_ARG_CONV_EXCL='\*'/);
  assert.match(gitBashCommand, /wsl\.exe --distribution 'Ubuntu Dev'/);
  assert.match(gitBashCommand, /--cd '\/home\/builder\/Builder Bot'\\''s'/);
  assert.match(gitBashCommand, /--exec bash -lc 'npm run dev:local-stack -- api'/);
  assert.match(gitBashCommand, /\|\| exec bash --login -i$/);
  assert.doesNotMatch(gitBashCommand, /;/);
  assert.doesNotMatch(gitBashCommand, /pwsh|powershell/i);
});

test('openServiceTerminal reports a safe error when Windows Terminal cannot spawn', async () => {
  const child = new EventEmitter();
  child.unref = () => {};

  const launchPromise = openServiceTerminal(
    {
      command: 'wt.exe',
      gitBashCommand: 'C:\\Program Files\\Git\\bin\\bash.exe',
      kind: 'windows-terminal',
    },
    { name: 'api', title: 'BuilderBot API' },
    {
      root: '/home/builder/builder-bot',
      env: { WSL_DISTRO_NAME: 'Ubuntu' },
      isDryRun: false,
      spawnProcess: () => {
        queueMicrotask(() => child.emit('error', new Error('private system detail')));
        return child;
      },
    },
  );

  await assert.rejects(
    launchPromise,
    /^Error: Could not open BuilderBot API in Git Bash\. Verify Windows Terminal and Git for Windows are installed\.$/,
  );
});
