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
} from '../core/contracts/tier-policy.js';
import {
    getSkuCatalog,
    resolveCheckoutSku,
} from '../core/contracts/sku-catalog.js';
import {
    buildContextSnapshot,
    estimateAiInputTokens,
    estimateTokenCountFromText,
    prepareContextForSnapshot,
} from '../core/logic/ai-context.js';
import {
    finalizeUsage,
    getUsageSnapshot,
    migrateInMemoryUsageBucketsToPersistentStore,
    releaseInFlightSlot,
    reserveUsage,
} from '../core/logic/token-governor.js';
import {
    getBuildUsageSnapshot,
    recordBuildFailure,
    reserveBuildQuota,
} from '../core/logic/build-governor.js';
import { validateInstructionPlan } from '../core/logic/build-validator.js';
import {
    evaluateBreakEvenAlerts,
    getBuildCostSnapshots,
    getBreakEvenAlerts,
    getMonthlyMarginReport,
    getUsageMeteringRows,
    migrateInMemoryUsageMeteringToPersistentStore,
    recordBuildCostSnapshot,
    recordUsageMetering,
} from '../core/logic/margin-metering.js';
import {
    getPreScalePerformanceProfile,
    getPreScaleTelemetryDashboard,
    migrateInMemoryPreScaleTelemetryToPersistentStore,
    recordPreScaleBuildSuccess,
    recordPreScaleRequestFailure,
    recordPreScaleRequestStart,
} from '../core/logic/pre-scale-telemetry.js';
import {
    getPreScaleSimulationRuns,
    runPreScaleSimulation,
} from '../core/logic/pre-scale-simulation.js';
import {
    getConversionFunnelReport,
    recordCheckoutStarted,
    recordFeatureUsageSignal,
    recordSignupLifecycle,
    recordTierUpgrade,
} from '../core/logic/conversion-funnel.js';
import {
    getSecurityAuditEvents,
    recordSecurityAuditEvent,
} from '../core/logic/security-audit.js';
import { claimCheckoutConfirmationSession } from '../core/logic/checkout-confirmation-idempotency.js';
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
} from '../core/logic/ops-metrics.js';
import {
    evaluateEmergencyMarginGuard,
    getEmergencyMarginGuardState,
    setEmergencyMarginGuardManualOverride,
    shouldForceThinSnapshots,
    shouldThrottleFreeTier,
} from '../core/logic/emergency-margin-guard.js';
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
} from '../core/logic/platform-features.js';
import {
    createReferralCode,
    getReferralEvents,
    getReferralSummary,
    getUserEntitlements,
    redeemReferralCode,
} from '../core/logic/referrals.js';
import {
    getOverageRateUsdPer1k,
    getOverageReport,
    getUserOverageSnapshot,
    recordOverageUsage,
    supportsMeteredOverage,
} from '../core/logic/overage-billing.js';
import {
    evaluateIncidentNotifications,
    getIncidentPlaybooks,
    getIncidents,
    resolveIncident,
} from '../core/logic/incident-manager.js';
import {
    getEvaluationReport,
    recordEvaluationRun,
} from '../core/logic/evaluation-harness.js';
import {
    getAbuseAnalytics,
    recordAbuseSignal,
} from '../core/logic/abuse-analytics.js';
import {
    evaluateRefundEligibility,
    getRenewalPreference,
    setRenewalPreference,
} from '../core/logic/billing-policy.js';
import logger from '../core/platform/logger.js';
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
    claimCheckoutConfirmationSession,
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
