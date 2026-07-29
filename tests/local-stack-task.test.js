import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { runLocalStackTask } from '../scripts/run-local-stack-task.mjs';

test('local stack task rejects unknown services with a clear message', async () => {
  await assert.rejects(
    () => runLocalStackTask('missing-service'),
    /Unknown local stack service "missing-service"/,
  );
});

test('VS Code local stack task bypasses PowerShell and defaults terminals to Git Bash', () => {
  const taskConfig = JSON.parse(fs.readFileSync('.vscode/tasks.json', 'utf8'));
  const workspaceSettings = JSON.parse(fs.readFileSync('.vscode/settings.json', 'utf8'));
  const localStackTasks = taskConfig.tasks.filter((task) => task.label.startsWith('local stack'));

  assert.equal(localStackTasks.length, 1);

  const [localStackTask] = localStackTasks;
  assert.equal(localStackTask.type, 'process');
  assert.equal(localStackTask.command, 'node');
  assert.deepEqual(localStackTask.args, ['scripts/start-local-stack.mjs']);
  assert.equal(localStackTask.options?.shell, undefined);
  assert.equal(localStackTask.windows, undefined);
  assert.doesNotMatch(JSON.stringify(localStackTask), /pwsh|powershell/i);
  assert.equal(
    workspaceSettings['terminal.integrated.defaultProfile.windows'],
    'Git Bash',
  );
  assert.equal(
    workspaceSettings['terminal.integrated.profiles.windows']?.['Git Bash']?.source,
    'Git Bash',
  );
  assert.doesNotMatch(JSON.stringify(workspaceSettings), /pwsh|powershell/i);
});
