import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAuthorizedWsClient,
  isAllowedWsOrigin,
  parseAllowedWsOrigins,
  resolveWsBuildPrompt,
  resolveWsInstructionPlanPayload,
} from '../apps/bot/ws-server.js';

test('resolveWsBuildPrompt routes chat_command payloads', () => {
  const prompt = resolveWsBuildPrompt({
    type: 'chat_command',
    message: 'follow 3',
  });

  assert.equal(prompt, 'follow 3');
});

test('resolveWsBuildPrompt converts raw_prompt into build command', () => {
  const prompt = resolveWsBuildPrompt({
    type: 'raw_prompt',
    prompt: 'castle with towers',
  });

  assert.equal(prompt, 'build castle with towers');
});

test('resolveWsInstructionPlanPayload extracts instruction plans from either field', () => {
  const fromPlan = resolveWsInstructionPlanPayload({
    type: 'instruction_plan',
    plan: { actions: [{ type: 'stop' }] },
  });
  const fromPayload = resolveWsInstructionPlanPayload({
    type: 'instruction_plan',
    payload: { actions: [{ type: 'move_to', x: 0, y: 0, z: 0 }] },
  });

  assert.deepEqual(fromPlan, { actions: [{ type: 'stop' }] });
  assert.deepEqual(fromPayload, { actions: [{ type: 'move_to', x: 0, y: 0, z: 0 }] });
});

test('isAuthorizedWsClient validates authToken query parameter', () => {
  const authorized = isAuthorizedWsClient({
    request: { url: '/?authToken=abc123' },
    expectedAuthToken: 'abc123',
  });
  const rejected = isAuthorizedWsClient({
    request: { url: '/?authToken=wrong' },
    expectedAuthToken: 'abc123',
  });

  assert.equal(authorized, true);
  assert.equal(rejected, false);
});

test('isAllowedWsOrigin allows configured local UI origins', () => {
  const allowed = isAllowedWsOrigin({
    request: {
      headers: {
        origin: 'http://localhost:5173',
      },
    },
    allowedOrigins: parseAllowedWsOrigins('http://localhost:5173,http://127.0.0.1:5173'),
  });

  assert.equal(allowed, true);
});

test('isAllowedWsOrigin rejects missing or unapproved origin headers', () => {
  const allowlist = parseAllowedWsOrigins('http://localhost:5173');

  const missingOrigin = isAllowedWsOrigin({
    request: { headers: {} },
    allowedOrigins: allowlist,
  });
  const unapprovedOrigin = isAllowedWsOrigin({
    request: {
      headers: {
        origin: 'http://malicious.example',
      },
    },
    allowedOrigins: allowlist,
  });

  assert.equal(missingOrigin, false);
  assert.equal(unapprovedOrigin, false);
});
