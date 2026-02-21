import {
    evaluateEmergencyMarginGuard,
    resetEmergencyMarginGuardState,
} from '../utils/emergency-margin-guard.js';
import {
    resetPreScaleSimulationRuns,
    runPreScaleSimulation,
} from '../utils/pre-scale-simulation.js';

/**
 * Build a compact scenario snapshot.
 * @param {{
 *   name: string,
 *   evaluation: Awaited<ReturnType<typeof evaluateEmergencyMarginGuard>>,
 *   simulation: ReturnType<typeof runPreScaleSimulation>,
 * }} params
 * @returns {Record<string, unknown>}
 */
function toScenarioSnapshot({ name, evaluation, simulation }) {
    return {
        name,
        guard: {
            active: evaluation.state.active,
            source: evaluation.state.source,
            reason: evaluation.state.reason,
            reasonCodes: evaluation.state.reasonCodes,
            cooldownUntil: evaluation.state.cooldownUntil,
            recoveryStreak: evaluation.state.recoveryStreak,
        },
        simulationTotals: {
            requests: simulation.totals.requests,
            failureRatePercent: simulation.totals.failureRatePercent,
            queueRejectionRatePercent: simulation.totals.queueRejectionRatePercent,
            tokenBurnUsd: simulation.totals.tokenBurnUsd,
            freeTierThrottles: simulation.totals.freeTierThrottles,
            forcedThinSnapshots: simulation.totals.forcedThinSnapshots,
            guardActive: simulation.totals.guardActive,
            latencyP95Ms: simulation.totals.latencyP95Ms,
        },
    };
}

async function runShakeout() {
    resetEmergencyMarginGuardState();
    resetPreScaleSimulationRuns();

    const normalEvaluation = await evaluateEmergencyMarginGuard({
        marginPercent: 62,
        tokenBurnLastHourUsd: 0.35,
        force: true,
        now: new Date('2026-02-21T00:00:00Z'),
    });
    const normalSimulation = runPreScaleSimulation({
        seed: 1101,
        concurrentUsers: 140,
        requestsPerUser: 6,
        tiers: ['free', 'starter', 'pro', 'admin'],
        guardState: normalEvaluation.state,
    });

    const activeEvaluation = await evaluateEmergencyMarginGuard({
        marginPercent: 18,
        tokenBurnLastHourUsd: 8.2,
        force: true,
        now: new Date('2026-02-21T00:05:00Z'),
    });
    const activeSimulation = runPreScaleSimulation({
        seed: 2202,
        concurrentUsers: 140,
        requestsPerUser: 6,
        tiers: ['free', 'starter', 'pro', 'admin'],
        guardState: activeEvaluation.state,
    });

    await evaluateEmergencyMarginGuard({
        marginPercent: 66,
        tokenBurnLastHourUsd: 0.25,
        force: true,
        now: new Date('2026-02-21T00:10:00Z'),
    });
    await evaluateEmergencyMarginGuard({
        marginPercent: 66,
        tokenBurnLastHourUsd: 0.25,
        force: true,
        now: new Date('2026-02-21T00:20:00Z'),
    });
    const recoveredEvaluation = await evaluateEmergencyMarginGuard({
        marginPercent: 66,
        tokenBurnLastHourUsd: 0.25,
        force: true,
        now: new Date('2026-02-21T00:30:30Z'),
    });
    const recoveredSimulation = runPreScaleSimulation({
        seed: 3303,
        concurrentUsers: 140,
        requestsPerUser: 6,
        tiers: ['free', 'starter', 'pro', 'admin'],
        guardState: recoveredEvaluation.state,
    });

    const validations = {
        normalScenarioHealthy: normalEvaluation.state.active === false &&
            normalSimulation.totals.freeTierThrottles === 0 &&
            normalSimulation.totals.forcedThinSnapshots === 0,
        activeScenarioEnforced: activeEvaluation.state.active === true &&
            activeSimulation.totals.freeTierThrottles > 0 &&
            activeSimulation.totals.forcedThinSnapshots > 0,
        recoveryScenarioRecovered: recoveredEvaluation.state.active === false &&
            recoveredSimulation.totals.freeTierThrottles === 0 &&
            recoveredSimulation.totals.forcedThinSnapshots === 0,
    };

    if (!Object.values(validations).every(Boolean)) {
        throw new Error(`Emergency guard shakeout failed validation checks: ${JSON.stringify(validations)}`);
    }

    return {
        generatedAt: new Date().toISOString(),
        validations,
        scenarios: [
            toScenarioSnapshot({
                name: 'normal',
                evaluation: normalEvaluation,
                simulation: normalSimulation,
            }),
            toScenarioSnapshot({
                name: 'active_guard',
                evaluation: activeEvaluation,
                simulation: activeSimulation,
            }),
            toScenarioSnapshot({
                name: 'recovery',
                evaluation: recoveredEvaluation,
                simulation: recoveredSimulation,
            }),
        ],
    };
}

runShakeout()
    .then((summary) => {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
        process.stderr.write(`Shakeout failed: ${error?.message || error}\n`);
        process.exitCode = 1;
    });
