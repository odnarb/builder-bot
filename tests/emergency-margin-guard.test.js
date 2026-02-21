import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateEmergencyMarginGuard,
    setEmergencyMarginGuardManualOverride,
    shouldForceThinSnapshots,
    shouldThrottleFreeTier,
    resetEmergencyMarginGuardState,
} from '../apps/api/utils/emergency-margin-guard.js';

test('guard activates when monthly margin drops below threshold', async () => {
    resetEmergencyMarginGuardState();

    const evaluated = await evaluateEmergencyMarginGuard({
        marginPercent: 20,
        tokenBurnLastHourUsd: 0.5,
        marginThresholdPercent: 30,
        burnRateThresholdUsdPerHour: 5,
        force: true,
        now: new Date('2026-02-21T00:00:00Z'),
    });

    assert.equal(evaluated.state.active, true);
    assert.deepEqual(evaluated.state.reasonCodes, ['margin_below_threshold']);
    assert.equal(evaluated.transition?.activated, true);
    assert.equal(shouldThrottleFreeTier({ tier: 'free', guardState: evaluated.state }), true);
    assert.equal(shouldThrottleFreeTier({ tier: 'starter', guardState: evaluated.state }), false);
    assert.equal(shouldForceThinSnapshots({ guardState: evaluated.state }), true);
});

test('guard keeps cooldown window active and then deactivates', async () => {
    resetEmergencyMarginGuardState();

    await evaluateEmergencyMarginGuard({
        marginPercent: 60,
        tokenBurnLastHourUsd: 8,
        burnRateThresholdUsdPerHour: 5,
        force: true,
        now: new Date('2026-02-21T00:00:00Z'),
    });

    const cooldownEvaluation = await evaluateEmergencyMarginGuard({
        marginPercent: 60,
        tokenBurnLastHourUsd: 0.2,
        burnRateThresholdUsdPerHour: 5,
        force: true,
        now: new Date('2026-02-21T00:05:00Z'),
    });
    assert.equal(cooldownEvaluation.state.active, true);
    assert.deepEqual(cooldownEvaluation.state.reasonCodes, ['cooldown', 'recovery_pending']);
    assert.equal(cooldownEvaluation.transition, null);

    await evaluateEmergencyMarginGuard({
        marginPercent: 60,
        tokenBurnLastHourUsd: 0.2,
        burnRateThresholdUsdPerHour: 5,
        force: true,
        now: new Date('2026-02-21T00:15:00Z'),
    });

    const deactivated = await evaluateEmergencyMarginGuard({
        marginPercent: 60,
        tokenBurnLastHourUsd: 0.2,
        burnRateThresholdUsdPerHour: 5,
        force: true,
        now: new Date('2026-02-21T00:25:00Z'),
    });
    assert.equal(deactivated.state.active, false);
    assert.equal(deactivated.transition?.deactivated, true);
});

test('force_off manual override suppresses auto activation until cleared', async () => {
    resetEmergencyMarginGuardState();

    await setEmergencyMarginGuardManualOverride({
        mode: 'force_off',
        actor: 'test-suite',
        reason: 'maintenance',
        now: new Date('2026-02-21T00:00:00Z'),
    });
    const suppressed = await evaluateEmergencyMarginGuard({
        marginPercent: 10,
        tokenBurnLastHourUsd: 12,
        force: true,
        now: new Date('2026-02-21T00:01:00Z'),
    });
    assert.equal(suppressed.state.active, false);
    assert.equal(suppressed.state.source, 'manual_off');

    await setEmergencyMarginGuardManualOverride({
        mode: 'clear',
        now: new Date('2026-02-21T00:02:00Z'),
    });
    const reenabled = await evaluateEmergencyMarginGuard({
        marginPercent: 10,
        tokenBurnLastHourUsd: 12,
        force: true,
        now: new Date('2026-02-21T00:03:00Z'),
    });
    assert.equal(reenabled.state.active, true);
    assert.equal(reenabled.state.source, 'auto');
});

test('force_on manual override expires when duration elapses', async () => {
    resetEmergencyMarginGuardState();

    await setEmergencyMarginGuardManualOverride({
        mode: 'force_on',
        actor: 'test-suite',
        reason: 'incident drill',
        durationMinutes: 30,
        now: new Date('2026-02-21T00:00:00Z'),
    });

    const active = await evaluateEmergencyMarginGuard({
        marginPercent: 80,
        tokenBurnLastHourUsd: 0.1,
        force: true,
        now: new Date('2026-02-21T00:00:30Z'),
    });
    assert.equal(active.state.active, true);
    assert.deepEqual(active.state.reasonCodes, ['manual_override']);
    assert.equal(active.state.source, 'manual');

    const expired = await evaluateEmergencyMarginGuard({
        marginPercent: 80,
        tokenBurnLastHourUsd: 0.1,
        force: true,
        now: new Date('2026-02-21T00:31:00Z'),
    });
    assert.equal(expired.state.active, false);
    assert.equal(expired.state.manualOverride, null);
    assert.equal(expired.transition?.deactivated, true);
});

test('manual override duration is clamped to safe range', async () => {
    resetEmergencyMarginGuardState();

    const short = await setEmergencyMarginGuardManualOverride({
        mode: 'force_on',
        actor: 'test-suite',
        reason: 'short duration clamp',
        durationMinutes: 1,
        now: new Date('2026-02-21T00:00:00Z'),
    });
    const shortExpiryMinutes = Math.round(
        (new Date(short.manualOverride.expiresAt).getTime() - new Date(short.manualOverride.setAt).getTime()) / 60000,
    );
    assert.equal(shortExpiryMinutes, 30);

    const long = await setEmergencyMarginGuardManualOverride({
        mode: 'force_on',
        actor: 'test-suite',
        reason: 'long duration clamp',
        durationMinutes: 999,
        now: new Date('2026-02-21T01:00:00Z'),
    });
    const longExpiryMinutes = Math.round(
        (new Date(long.manualOverride.expiresAt).getTime() - new Date(long.manualOverride.setAt).getTime()) / 60000,
    );
    assert.equal(longExpiryMinutes, 120);
});
