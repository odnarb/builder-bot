import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateIncidentNotifications,
  getIncidents,
  getIncidentPlaybooks,
  resetIncidentState,
  resolveIncident,
} from '../apps/api/utils/incident-manager.js';

test('incident manager creates incidents from alerts and resolves them', () => {
  resetIncidentState();

  evaluateIncidentNotifications({
    alerts: [
      { code: 'high_failure_rate', level: 'error', message: 'Failure rate too high', value: 42 },
    ],
  });

  const active = getIncidents({ status: 'active' });
  assert.equal(active.length, 1);
  assert.equal(active[0].code, 'high_failure_rate');
  assert.equal(Boolean(getIncidentPlaybooks().high_failure_rate), true);

  const resolved = resolveIncident({ incidentId: active[0].id });
  assert.equal(resolved.status, 'resolved');
  assert.equal(getIncidents({ status: 'resolved' }).length, 1);
});
