import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSecurityAuditEvents,
  recordSecurityAuditEvent,
  resetSecurityAuditEvents,
} from '../apps/api/utils/security-audit.js';

test('recordSecurityAuditEvent stores and filters audit events', () => {
  resetSecurityAuditEvents();

  recordSecurityAuditEvent({
    type: 'command_block_denied',
    severity: 'warning',
    userKey: 'auth:user-a',
    tier: 'starter',
    message: 'Rejected command block',
  });
  recordSecurityAuditEvent({
    type: 'blocked_block',
    severity: 'error',
    userKey: 'auth:user-a',
    tier: 'starter',
    message: 'Blocked barrier block',
  });

  const warningEvents = getSecurityAuditEvents({ severity: 'warning' });
  const commandEvents = getSecurityAuditEvents({ type: 'command_block_denied' });

  assert.equal(warningEvents.length, 1);
  assert.equal(commandEvents.length, 1);
  assert.equal(commandEvents[0].type, 'command_block_denied');
});
