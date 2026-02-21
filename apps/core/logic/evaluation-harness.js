const evaluationRuns = [];

const DEFAULT_REGRESSION_THRESHOLD = -2.5;

/**
 * Record a periodic evaluation run.
 * @param {{
 *   suite: string,
 *   modelVariant: string,
 *   qualityScore: number,
 *   latencyScore: number,
 *   safetyScore: number,
 *   notes?: string,
 *   now?: Date,
 * }} params
 * @returns {{
 *   id: string,
 *   suite: string,
 *   modelVariant: string,
 *   qualityScore: number,
 *   latencyScore: number,
 *   safetyScore: number,
 *   compositeScore: number,
 *   regressionDelta: number | null,
 *   regressed: boolean,
 *   notes: string | null,
 *   recordedAt: string,
 * }}
 */
export function recordEvaluationRun({
    suite,
    modelVariant,
    qualityScore,
    latencyScore,
    safetyScore,
    notes,
    now = new Date(),
}) {
    const safeSuite = String(suite || '').trim();
    const safeVariant = String(modelVariant || '').trim();

    if (!safeSuite || !safeVariant) {
        throw new Error('suite and modelVariant are required.');
    }

    const safeQualityScore = Number(qualityScore);
    const safeLatencyScore = Number(latencyScore);
    const safeSafetyScore = Number(safetyScore);

    if (![safeQualityScore, safeLatencyScore, safeSafetyScore].every(Number.isFinite)) {
        throw new Error('qualityScore, latencyScore, and safetyScore must be finite numbers.');
    }

    const compositeScore = Number(((safeQualityScore * 0.5) + (safeLatencyScore * 0.2) + (safeSafetyScore * 0.3)).toFixed(2));
    const previous = evaluationRuns.find((run) => run.suite === safeSuite);
    const regressionDelta = previous
        ? Number((compositeScore - previous.compositeScore).toFixed(2))
        : null;

    const run = {
        id: `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        suite: safeSuite,
        modelVariant: safeVariant,
        qualityScore: safeQualityScore,
        latencyScore: safeLatencyScore,
        safetyScore: safeSafetyScore,
        compositeScore,
        regressionDelta,
        regressed: typeof regressionDelta === 'number' && regressionDelta <= DEFAULT_REGRESSION_THRESHOLD,
        notes: typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null,
        recordedAt: new Date(now).toISOString(),
    };

    evaluationRuns.unshift(run);
    return run;
}

/**
 * Return evaluation history and regression summary.
 * @param {{ suite?: string, limit?: number }} [params]
 * @returns {{
 *   runs: Array<Record<string, unknown>>,
 *   summary: {
 *     totalRuns: number,
 *     regressedRuns: number,
 *     latestCompositeScore: number | null,
 *     latestRegressionDelta: number | null,
 *   },
 * }}
 */
export function getEvaluationReport(params = {}) {
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 100));
    const suite = typeof params.suite === 'string' ? params.suite.trim() : '';

    const scopedRuns = evaluationRuns
        .filter((run) => (suite ? run.suite === suite : true))
        .slice(0, limit);

    return {
        runs: scopedRuns,
        summary: {
            totalRuns: scopedRuns.length,
            regressedRuns: scopedRuns.filter((run) => run.regressed).length,
            latestCompositeScore: scopedRuns[0]?.compositeScore ?? null,
            latestRegressionDelta: scopedRuns[0]?.regressionDelta ?? null,
        },
    };
}

/**
 * Reset evaluation run state. Intended for tests.
 */
export function resetEvaluationState() {
    evaluationRuns.length = 0;
}
