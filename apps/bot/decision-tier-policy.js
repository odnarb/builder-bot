import {
  getTierAiPolicy,
  getTierFeaturePolicy,
  resolveTier,
} from '../api/config/tier-policy.js';

const BASELINE_BY_TIER = Object.freeze({
  free: Object.freeze({
    maxScanRadius: 8,
    maxAnchorCandidates: 2,
    maxPrepEdits: 64,
    maxPrepVolume: 512,
    maxReplanAttempts: 1,
    maxLocalRetries: 1,
    maxPathRetriesPerStep: 2,
    allowAggressiveRecovery: false,
    pathfinderThinkTimeoutMs: 2500,
    pathfinderTickTimeoutMs: 25,
    pathfinderSearchRadius: 48,
    pathProbeTimeoutMs: 650,
    minAnchorScore: 45,
  }),
  starter: Object.freeze({
    maxScanRadius: 12,
    maxAnchorCandidates: 4,
    maxPrepEdits: 256,
    maxPrepVolume: 2000,
    maxReplanAttempts: 2,
    maxLocalRetries: 1,
    maxPathRetriesPerStep: 3,
    allowAggressiveRecovery: false,
    pathfinderThinkTimeoutMs: 3200,
    pathfinderTickTimeoutMs: 30,
    pathfinderSearchRadius: 64,
    pathProbeTimeoutMs: 900,
    minAnchorScore: 45,
  }),
  pro: Object.freeze({
    maxScanRadius: 16,
    maxAnchorCandidates: 6,
    maxPrepEdits: 1000,
    maxPrepVolume: 8000,
    maxReplanAttempts: 3,
    maxLocalRetries: 1,
    maxPathRetriesPerStep: 4,
    allowAggressiveRecovery: true,
    pathfinderThinkTimeoutMs: 4200,
    pathfinderTickTimeoutMs: 35,
    pathfinderSearchRadius: 96,
    pathProbeTimeoutMs: 1200,
    minAnchorScore: 45,
  }),
  admin: Object.freeze({
    maxScanRadius: 24,
    maxAnchorCandidates: 8,
    maxPrepEdits: 3000,
    maxPrepVolume: 20000,
    maxReplanAttempts: 4,
    maxLocalRetries: 1,
    maxPathRetriesPerStep: 5,
    allowAggressiveRecovery: true,
    pathfinderThinkTimeoutMs: 5200,
    pathfinderTickTimeoutMs: 40,
    pathfinderSearchRadius: 128,
    pathProbeTimeoutMs: 1500,
    minAnchorScore: 45,
  }),
});

function clampInt(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

/**
 * Resolve tier-scoped execution budgets for the decision engine.
 * @param {string | undefined | null} rawTier
 * @returns {{
 *   tier: 'free' | 'starter' | 'pro' | 'admin',
 *   maxScanRadius: number,
 *   maxAnchorCandidates: number,
 *   maxPrepEdits: number,
 *   maxPrepVolume: number,
 *   maxBlocksPerBuild: number,
 *   maxBuildVolume: number,
 *   maxReplanAttempts: number,
 *   maxLocalRetries: number,
 *   maxPathRetriesPerStep: number,
 *   allowAggressiveRecovery: boolean,
 *   pathfinderThinkTimeoutMs: number,
 *   pathfinderTickTimeoutMs: number,
 *   pathfinderSearchRadius: number,
 *   pathProbeTimeoutMs: number,
 *   minAnchorScore: number,
 *   contextTokenBudget: number,
 * }}
 */
export function resolveDecisionTierPolicy(rawTier) {
  const tier = resolveTier(rawTier);
  const base = BASELINE_BY_TIER[tier] || BASELINE_BY_TIER.free;
  const aiPolicy = getTierAiPolicy(tier);
  const featurePolicy = getTierFeaturePolicy(tier);

  const maxBlocksPerBuild = clampInt(featurePolicy?.maxBlocksPerBuild, 32, 20000);
  const maxBuildVolume = clampInt(featurePolicy?.maxBuildVolume, 128, 200000);
  const prepVolumeCapFromFeature = Math.max(64, Math.floor(maxBuildVolume * 0.5));

  return {
    tier,
    maxScanRadius: clampInt(base.maxScanRadius, 4, 32),
    maxAnchorCandidates: clampInt(base.maxAnchorCandidates, 1, 12),
    maxPrepEdits: clampInt(Math.min(base.maxPrepEdits, maxBlocksPerBuild), 8, maxBlocksPerBuild),
    maxPrepVolume: clampInt(Math.min(base.maxPrepVolume, prepVolumeCapFromFeature), 64, maxBuildVolume),
    maxBlocksPerBuild,
    maxBuildVolume,
    maxReplanAttempts: clampInt(base.maxReplanAttempts, 1, 8),
    maxLocalRetries: clampInt(base.maxLocalRetries, 0, 2),
    maxPathRetriesPerStep: clampInt(base.maxPathRetriesPerStep, 1, 8),
    allowAggressiveRecovery: Boolean(base.allowAggressiveRecovery),
    pathfinderThinkTimeoutMs: clampInt(base.pathfinderThinkTimeoutMs, 500, 10_000),
    pathfinderTickTimeoutMs: clampInt(base.pathfinderTickTimeoutMs, 10, 50),
    pathfinderSearchRadius: clampInt(base.pathfinderSearchRadius, 16, 192),
    pathProbeTimeoutMs: clampInt(base.pathProbeTimeoutMs, 200, 3000),
    minAnchorScore: clampInt(base.minAnchorScore, 0, 100),
    contextTokenBudget: Math.max(400, Math.floor(Number(aiPolicy?.maxInputTokensPerRequest || 4000) * 0.35)),
  };
}

export { BASELINE_BY_TIER };
