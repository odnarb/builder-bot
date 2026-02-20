import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAbuseAnalytics,
  recordAbuseSignal,
  resetAbuseAnalyticsState,
} from '../apps/api/utils/abuse-analytics.js';

test('abuse analytics aggregates events by channel and severity', () => {
  resetAbuseAnalyticsState();

  recordAbuseSignal({
    userKey: 'auth:user-1',
    channel: 'chat',
    signal: 'moderation_block',
    severity: 'high',
  });
  recordAbuseSignal({
    userKey: 'auth:user-1',
    channel: 'build',
    signal: 'plan_validation_failed',
    severity: 'medium',
  });

  const analytics = getAbuseAnalytics({ hours: 24 });
  assert.equal(analytics.totalEvents, 2);
  assert.equal(analytics.byChannel.chat, 1);
  assert.equal(analytics.bySeverity.high, 1);
  assert.equal(analytics.topUsers[0].userKey, 'auth:user-1');
});
