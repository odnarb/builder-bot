import {
    addLogEntryToUsersSession,
    addLogsToUsersBuild,
    addStepsToUsersBuild,
    createUser,
    createUsersBuild,
    createUsersSession,
    getUserByEmail,
    getUserById,
    getUsersBuildById,
    getUsersBuilds,
    nowTimestamp,
    updateUsersBuild,
    updateUsersSession,
    updateUserTier,
} from '../core/firestore/users.js';
import { createAiGetStructureHandler } from '../core/logic/ai-get-structure.js';
import {
    getTierAiPolicy,
    getTierFeaturePolicy,
    getTierModelRoute,
    isInCanaryRollout,
    resolveTier,
} from '../config/tier-policy.js';
import {
    getSkuCatalog,
    resolveCheckoutSku,
} from '../config/sku-catalog.js';
import {
    buildContextSnapshot,
    estimateAiInputTokens,
    estimateTokenCountFromText,
    prepareContextForSnapshot,
} from '../utils/ai-context.js';
import {
    finalizeUsage,
    getUsageSnapshot,
    migrateInMemoryUsageBucketsToPersistentStore,
    releaseInFlightSlot,
    reserveUsage,
} from '../utils/token-governor.js';
import {
    getBuildUsageSnapshot,
    recordBuildFailure,
    reserveBuildQuota,
} from '../utils/build-governor.js';
import { validateInstructionPlan } from '../utils/build-validator.js';
import {
    evaluateBreakEvenAlerts,
    getBuildCostSnapshots,
    getBreakEvenAlerts,
    getMonthlyMarginReport,
    getUsageMeteringRows,
    migrateInMemoryUsageMeteringToPersistentStore,
    recordBuildCostSnapshot,
    recordUsageMetering,
} from '../utils/margin-metering.js';
import {
    getPreScalePerformanceProfile,
    getPreScaleTelemetryDashboard,
    migrateInMemoryPreScaleTelemetryToPersistentStore,
    recordPreScaleBuildSuccess,
    recordPreScaleRequestFailure,
    recordPreScaleRequestStart,
} from '../utils/pre-scale-telemetry.js';
import {
    getPreScaleSimulationRuns,
    runPreScaleSimulation,
} from '../utils/pre-scale-simulation.js';
import {
    getConversionFunnelReport,
    recordCheckoutStarted,
    recordFeatureUsageSignal,
    recordSignupLifecycle,
    recordTierUpgrade,
} from '../utils/conversion-funnel.js';
import {
    getSecurityAuditEvents,
    recordSecurityAuditEvent,
} from '../utils/security-audit.js';
import {
    evaluateOpsAlerts,
    getOpsDashboardSnapshot,
    recordAiRequestEnd,
    recordAiRequestStart,
    recordBlockedPlacement,
    recordCrash,
    recordInstallation,
    recordTokenBurn,
    setActiveSessions,
    setQueueDepth,
} from '../utils/ops-metrics.js';
import {
    evaluateEmergencyMarginGuard,
    getEmergencyMarginGuardState,
    setEmergencyMarginGuardManualOverride,
    shouldForceThinSnapshots,
    shouldThrottleFreeTier,
} from '../utils/emergency-margin-guard.js';
import {
    acceptPolicyDocuments,
    createMarketplaceListing,
    createSubscriptionTicket,
    getAttributionEvents,
    getLinkedCommunityAccounts,
    getMarketplaceListings,
    getParentalControls,
    getPhrasePacks,
    getPolicyAcceptance,
    getReactionEvents,
    getRewardBalance,
    linkCommunityAccount,
    recordAttributionEvent,
    recordBuildReaction,
    savePhrasePack,
    setParentalControls,
} from '../utils/platform-features.js';
import {
    createReferralCode,
    getReferralEvents,
    getReferralSummary,
    getUserEntitlements,
    redeemReferralCode,
} from '../utils/referrals.js';
import {
    getOverageRateUsdPer1k,
    getOverageReport,
    getUserOverageSnapshot,
    recordOverageUsage,
    supportsMeteredOverage,
} from '../utils/overage-billing.js';
import {
    evaluateIncidentNotifications,
    getIncidentPlaybooks,
    getIncidents,
    resolveIncident,
} from '../utils/incident-manager.js';
import {
    getEvaluationReport,
    recordEvaluationRun,
} from '../utils/evaluation-harness.js';
import {
    getAbuseAnalytics,
    recordAbuseSignal,
} from '../utils/abuse-analytics.js';
import {
    evaluateRefundEligibility,
    getRenewalPreference,
    setRenewalPreference,
} from '../utils/billing-policy.js';
import logger from '../utils/logger.js';
import { toLegacyBlocksAndTags } from '../shared-utils/instruction-schema.js';
import { exportInstructionPlanToSchematic } from '../shared-utils/schematic-export.js';

export const EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE = 'DISABLE_GUARD_TEMPORARILY';

export const staticRouteDeps = {
    // shared db + config
    nowTimestamp,
    getUserById,
    getUserByEmail,
    createUser,
    createUsersBuild,
    updateUsersBuild,
    addStepsToUsersBuild,
    addLogsToUsersBuild,
    createUsersSession,
    updateUsersSession,
    addLogEntryToUsersSession,
    getUsersBuilds,
    getUsersBuildById,
    updateUserTier,
    getTierFeaturePolicy,
    getTierAiPolicy,
    getTierModelRoute,
    resolveTier,
    isInCanaryRollout,
    getSkuCatalog,
    resolveCheckoutSku,

    // ai/context/token flows
    buildContextSnapshot,
    prepareContextForSnapshot,
    estimateAiInputTokens,
    estimateTokenCountFromText,
    reserveUsage,
    finalizeUsage,
    releaseInFlightSlot,
    getUsageSnapshot,
    reserveBuildQuota,
    getBuildUsageSnapshot,
    recordBuildFailure,
    validateInstructionPlan,
    toLegacyBlocksAndTags,
    exportInstructionPlanToSchematic,

    // economics + telemetry + ops
    recordUsageMetering,
    getUsageMeteringRows,
    getMonthlyMarginReport,
    getBreakEvenAlerts,
    evaluateBreakEvenAlerts,
    recordBuildCostSnapshot,
    getBuildCostSnapshots,
    migrateInMemoryUsageMeteringToPersistentStore,
    recordPreScaleRequestStart,
    recordPreScaleRequestFailure,
    recordPreScaleBuildSuccess,
    getPreScaleTelemetryDashboard,
    getPreScalePerformanceProfile,
    migrateInMemoryPreScaleTelemetryToPersistentStore,
    runPreScaleSimulation,
    getPreScaleSimulationRuns,
    recordCheckoutStarted,
    recordFeatureUsageSignal,
    recordSignupLifecycle,
    recordTierUpgrade,
    evaluateOpsAlerts,
    getOpsDashboardSnapshot,
    setActiveSessions,
    setQueueDepth,
    recordAiRequestStart,
    recordAiRequestEnd,
    recordBlockedPlacement,
    recordCrash,
    recordInstallation,
    recordTokenBurn,

    // guard + security + policy
    evaluateEmergencyMarginGuard,
    getEmergencyMarginGuardState,
    shouldThrottleFreeTier,
    shouldForceThinSnapshots,
    setEmergencyMarginGuardManualOverride,
    recordSecurityAuditEvent,
    getSecurityAuditEvents,
    recordAbuseSignal,
    getAbuseAnalytics,
    evaluateIncidentNotifications,
    getIncidents,
    resolveIncident,
    getIncidentPlaybooks,
    evaluateRefundEligibility,
    getRenewalPreference,
    setRenewalPreference,

    // community platform/revenue
    getPolicyAcceptance,
    acceptPolicyDocuments,
    linkCommunityAccount,
    getLinkedCommunityAccounts,
    recordBuildReaction,
    getRewardBalance,
    getReactionEvents,
    savePhrasePack,
    getPhrasePacks,
    createMarketplaceListing,
    getMarketplaceListings,
    createSubscriptionTicket,
    setParentalControls,
    getParentalControls,
    recordAttributionEvent,
    getAttributionEvents,
    createReferralCode,
    redeemReferralCode,
    getReferralSummary,
    getUserEntitlements,
    getReferralEvents,
    getOverageRateUsdPer1k,
    supportsMeteredOverage,
    recordOverageUsage,
    getUserOverageSnapshot,
    getOverageReport,
    recordEvaluationRun,
    getEvaluationReport,

    // local helpers/constants from context
    createAiGetStructureHandler,
    EMERGENCY_GUARD_FORCE_OFF_CONFIRMATION_CODE,

    // migration + logger
    migrateInMemoryUsageBucketsToPersistentStore,
    logger,
};
