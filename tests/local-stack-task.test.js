import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLocalStackTask } from '../scripts/run-local-stack-task.mjs';

test('local stack task rejects unknown services with a clear message', async () => {
  await assert.rejects(
    () => runLocalStackTask('missing-service'),
    /Unknown local stack service "missing-service"/,
  );
});
