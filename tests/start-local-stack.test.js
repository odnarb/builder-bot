import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildTerminalArgs,
  findTerminalLauncher,
} from '../scripts/start-local-stack.mjs';

/**
 * Create a fake Windows Terminal executable for dry-run tests.
 *
 * @returns {string} Directory containing the fake executable.
 */
function createFakeWindowsTerminalDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'builderbot-wt-test-'));
  fs.writeFileSync(path.join(tempDir, 'wt.exe'), '');
  return tempDir;
}

test('findTerminalLauncher resolves wt.exe from PATH', () => {
  const fakeTerminalDir = createFakeWindowsTerminalDir();
  const launcher = findTerminalLauncher({ env: { PATH: fakeTerminalDir } });

  assert.deepEqual(launcher, {
    command: path.join(fakeTerminalDir, 'wt.exe'),
    kind: 'windows-terminal',
  });
});

test('buildTerminalArgs opens the requested service in a Windows Terminal tab', () => {
  const args = buildTerminalArgs(
    { command: 'wt.exe', kind: 'windows-terminal' },
    { name: 'api', title: 'BuilderBot API' },
  );

  assert.deepEqual(args.slice(0, 5), ['new-tab', '--title', 'BuilderBot API', 'wsl.exe', '--cd']);
  assert.equal(args.includes('npm run dev:local-stack -- api'), false);
  assert.match(args.at(-1), /npm run dev:local-stack -- api/);
});
