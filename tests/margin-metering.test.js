import assert from 'node:assert/strict';
import test from 'node:test';

import {
    evaluateBreakEvenAlerts,
    getMonthlyMarginReport,
    getUsageMeteringRows,
    recordUsageMetering,
    resetUsageMeteringState,
} from '../apps/api/utils/margin-metering.js';

test('recordUsageMetering tracks tokens, costs, and gross margin fields', async () => {
    resetUsageMeteringState();

    const row = await recordUsageMetering({
        userKey: 'auth:user-a',
        tier: 'starter',
        inputTokens: 1000,
        outputTokens: 500,
        now: new Date('2026-02-20T00:00:00Z'),
    });

    assert.equal(row.month, '2026-02');
    assert.equal(row.tier, 'starter');
    assert.equal(row.activeUsers, 1);
    assert.equal(row.requestCount, 1);
    assert.equal(row.inputTokens, 1000);
    assert.equal(row.outputTokens, 500);
    assert.equal(row.apiCost, 0.0006);
    assert.equal(row.infraCost, 0.0003);
    assert.equal(row.totalCost, 0.0009);
    assert.equal(row.grossMargin, 4.9891);
});

test('getMonthlyMarginReport returns revenue/cost/profit/margin by tier', async () => {
    resetUsageMeteringState();

    await recordUsageMetering({
        userKey: 'auth:user-starter',
        tier: 'starter',
        inputTokens: 0,
        outputTokens: 0,
        month: '2026-02',
    });

    await recordUsageMetering({
        userKey: 'auth:user-pro',
        tier: 'pro',
        inputTokens: 2000,
        outputTokens: 1000,
        month: '2026-02',
    });

    const report = await getMonthlyMarginReport({ month: '2026-02' });
    const starter = report.tiers.find((tierRow) => tierRow.tier === 'starter');
    const pro = report.tiers.find((tierRow) => tierRow.tier === 'pro');

    assert.equal(report.month, '2026-02');
    assert.equal(report.tiers.length, 4);
    assert.equal(starter.revenue, 4.99);
    assert.equal(starter.totalCost, 0.0003);
    assert.equal(starter.rawProfit, 4.9897);
    assert.equal(typeof starter.marginPercent, 'number');
    assert.equal(pro.revenue, 12.99);
    assert.equal(pro.requestCount, 1);
});

test('evaluateBreakEvenAlerts triggers and resolves threshold alerts', async () => {
    resetUsageMeteringState();

    await recordUsageMetering({
        userKey: 'auth:user-pro-expensive',
        tier: 'pro',
        inputTokens: 25000000,
        outputTokens: 25000000,
        month: '2026-02',
    });

    const firstCheck = await evaluateBreakEvenAlerts({ month: '2026-02', thresholdPercent: 35 });
    assert.equal(firstCheck.triggered.length, 1);
    assert.equal(firstCheck.triggered[0].tier, 'pro');
    assert.equal(firstCheck.active.length, 1);

    await recordUsageMetering({
        userKey: 'auth:user-pro-b',
        tier: 'pro',
        inputTokens: 0,
        outputTokens: 0,
        month: '2026-02',
    });
    await recordUsageMetering({
        userKey: 'auth:user-pro-c',
        tier: 'pro',
        inputTokens: 0,
        outputTokens: 0,
        month: '2026-02',
    });

    const secondCheck = await evaluateBreakEvenAlerts({ month: '2026-02', thresholdPercent: 35 });
    assert.equal(secondCheck.resolved.length, 1);
    assert.equal(secondCheck.active.length, 0);

    const rows = await getUsageMeteringRows({ month: '2026-02' });
    const pro = rows.find((row) => row.tier === 'pro');
    assert.equal(pro.activeUsers, 3);
});
