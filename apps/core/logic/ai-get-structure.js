/**
 * Create the AI build-generation orchestration handler.
 * The returned handler is framework-agnostic and returns HTTP-friendly envelopes.
 *
 * @param {Record<string, any>} deps
 * @returns {(params: {
 *   message?: string,
 *   rawTier?: 'free' | 'starter' | 'pro' | 'admin' | string,
 *   context?: Record<string, any>,
 *   includeSchematic?: boolean,
 *   usageKey?: string,
 *   authUserId?: string | null,
 * }) => Promise<{ status: number, body: Record<string, any>, headers?: Record<string, string> }>}
 */
export function createAiGetStructureHandler(deps) {
    const {
        detectModerationViolation,
        resolveTier,
        getTierAiPolicy,
        getTierFeaturePolicy,
        getTierModelRoute,
        isInCanaryRollout,
        recordPreScaleRequestStart,
        recordAbuseSignal,
        evaluateCurrentEmergencyMarginGuard,
        shouldThrottleFreeTier,
        resolveFreeTierThrottleRetryAfterSeconds,
        FREE_TIER_THROTTLE_ERROR_CODE,
        shouldForceThinSnapshots,
        recordPreScaleRequestFailure,
        recordSecurityAuditEvent,
        recordAiRequestStart,
        setActiveSessions,
        getOpsDashboardSnapshot,
        reserveBuildQuota,
        recordAiRequestEnd,
        prepareContextForSnapshot,
        buildContextSnapshot,
        estimateAiInputTokens,
        reserveUsage,
        getUsageSnapshot,
        setQueueDepth,
        createCompletionWithFallback,
        sleep,
        parseAndValidateExecutorPlan,
        recordBlockedPlacement,
        buildFallbackPlan,
        validateInstructionPlan,
        toLegacyBlocksAndTags,
        finalizeUsage,
        supportsMeteredOverage,
        recordOverageUsage,
        recordUsageMetering,
        recordTokenBurn,
        getOverageRateUsdPer1k,
        INFRA_COST_PER_REQUEST_USD,
        recordBuildCostSnapshot,
        estimateTokenCountFromText,
        recordPreScaleBuildSuccess,
        recordFeatureUsageSignal,
        evaluateBreakEvenAlerts,
        exportInstructionPlanToSchematic,
        getBuildUsageSnapshot,
        releaseInFlightSlot,
        recordBuildFailure,
        recordCrash,
        logger,
    } = deps;

    /**
     * @param {number} status
     * @param {Record<string, any>} body
     * @param {Record<string, string>} [headers]
     */
    function response(status, body, headers) {
        if (headers && Object.keys(headers).length > 0) {
            return { status, body, headers };
        }
        return { status, body };
    }

    return async function handleAiGetStructure({
        message,
        rawTier,
        context = {},
        includeSchematic = false,
        usageKey,
        authUserId = null,
    } = {}) {
        const requestStartedAtMs = Date.now();

        if (typeof message !== 'string' || message.trim().length === 0) {
            return response(400, { error: 'message is required' });
        }

        const moderationViolation = detectModerationViolation(message);
        const tier = resolveTier(rawTier);
        const tierPolicy = getTierAiPolicy(tier);
        const tierFeaturePolicy = getTierFeaturePolicy(tier);
        const modelRoute = getTierModelRoute(tier);
        const resolvedUsageKey = typeof usageKey === 'string' && usageKey.trim().length > 0
            ? usageKey
            : `anon:${tier}:unknown`;
        const canaryVariantEnabled = isInCanaryRollout({ usageKey: resolvedUsageKey });

        await recordPreScaleRequestStart({
            userKey: resolvedUsageKey,
            tier,
        });

        recordAbuseSignal({
            userKey: resolvedUsageKey,
            channel: 'build',
            signal: 'build_request',
            severity: 'low',
            metadata: { tier },
        });

        const contextPreparationStartedAtMs = Date.now();
        const emergencyGuardEvaluation = await evaluateCurrentEmergencyMarginGuard();
        const emergencyGuardState = emergencyGuardEvaluation.state;

        if (shouldThrottleFreeTier({ tier, guardState: emergencyGuardState })) {
            const retryAfterSeconds = resolveFreeTierThrottleRetryAfterSeconds(emergencyGuardState);
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: true,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs: Date.now() - contextPreparationStartedAtMs,
            });
            recordAbuseSignal({
                userKey: resolvedUsageKey,
                channel: 'api',
                signal: 'emergency_guard_free_tier_throttle',
                severity: 'medium',
                metadata: {
                    tier,
                    reasonCodes: emergencyGuardState.reasonCodes,
                },
            });

            return response(
                429,
                {
                    code: FREE_TIER_THROTTLE_ERROR_CODE,
                    error: 'Free tier is temporarily throttled due to emergency capacity protection. Upgrade to Starter, Pro, or Admin for continued access.',
                    retryAfterSeconds,
                    upgradeSuggested: true,
                    emergencyGuard: {
                        active: emergencyGuardState.active,
                        reason: emergencyGuardState.reason,
                        reasonCodes: emergencyGuardState.reasonCodes,
                    },
                },
                {
                    'Retry-After': String(retryAfterSeconds),
                },
            );
        }

        if (!tierFeaturePolicy.allowBuilds) {
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: false,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs: Date.now() - contextPreparationStartedAtMs,
            });
            return response(403, {
                error: `Build generation is not available for tier "${tier}".`,
            });
        }

        if (moderationViolation) {
            recordSecurityAuditEvent({
                type: 'moderation_block',
                severity: 'warning',
                userKey: resolvedUsageKey,
                tier,
                message: 'Prompt blocked by moderation filter.',
                context: {
                    moderationViolation,
                },
            });
            recordAbuseSignal({
                userKey: resolvedUsageKey,
                channel: 'chat',
                signal: 'moderation_block',
                severity: 'high',
                metadata: { moderationViolation },
            });
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: false,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs: Date.now() - contextPreparationStartedAtMs,
            });
            return response(400, {
                error: 'Prompt could not be processed due to safety policy.',
            });
        }

        recordAiRequestStart();
        setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });

        try {
            reserveBuildQuota({
                userKey: resolvedUsageKey,
                tierFeaturePolicy,
            });
        } catch (quotaError) {
            recordAbuseSignal({
                userKey: resolvedUsageKey,
                channel: 'build',
                signal: 'build_quota_rejected',
                severity: 'medium',
                metadata: { tier },
            });
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: true,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs: Date.now() - contextPreparationStartedAtMs,
            });
            recordAiRequestEnd({
                success: false,
                queueRejected: true,
                latencyMs: Date.now() - requestStartedAtMs,
            });
            setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
            return response(429, { error: quotaError.message });
        }

        const {
            identity: _callerIdentity,
            billingState: _callerBillingState,
            decisionPolicy: _callerDecisionPolicy,
            usageCounters: _callerUsageCounters,
            ...observationalContext
        } = context && typeof context === 'object' ? context : {};
        const safeContext = {
            ...observationalContext,
            capabilities: {
                tier,
                allowCommandBlocks: tierFeaturePolicy.allowCommandBlocks === true,
                maxBlocksPerBuild: tierFeaturePolicy.maxBlocksPerBuild,
                maxBuildVolume: tierFeaturePolicy.maxBuildVolume,
            },
        };
        const {
            contextForSnapshot,
            diagnostics: contextDiagnostics,
        } = prepareContextForSnapshot({
            usageKey: resolvedUsageKey,
            context: safeContext,
            forceThinSnapshot: shouldForceThinSnapshots({ guardState: emergencyGuardState }),
        });
        const contextSnapshot = buildContextSnapshot({
            context: contextForSnapshot,
            tierPolicy,
        });
        const estimatedInputTokens = estimateAiInputTokens({
            message,
            contextSnapshot,
            tier,
        });

        if (estimatedInputTokens > tierPolicy.maxInputTokensPerRequest) {
            recordAbuseSignal({
                userKey: resolvedUsageKey,
                channel: 'api',
                signal: 'request_input_too_large',
                severity: 'medium',
                metadata: { estimatedInputTokens, tier },
            });
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: true,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs: Date.now() - contextPreparationStartedAtMs,
            });
            recordAiRequestEnd({
                success: false,
                blockedPlan: true,
                latencyMs: Date.now() - requestStartedAtMs,
            });
            setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
            return response(400, {
                error: `Input too large for tier "${tier}". Reduce prompt/context size.`,
            });
        }

        let usageReserved = false;
        let usageFinalized = false;
        let executorAttempts = 0;
        let planValidationHadFailures = false;
        let overageReservation = { requestOverage: 0, inputOverageTokens: 0, outputOverageTokens: 0 };
        let overageFinalization = { requestOverage: 0, inputOverageTokens: 0, outputOverageTokens: 0 };
        let overageLedger = null;
        let suspiciousUsage = false;
        let queueWaitMs = 0;
        let plannerInputTokens = 0;
        let plannerOutputTokens = 0;
        let plannerDurationMs = 0;
        let executorInputTokens = 0;
        let executorOutputTokens = 0;
        let executorDurationMs = 0;
        let executorActionCount = 0;

        try {
            overageReservation = await reserveUsage({
                userKey: resolvedUsageKey,
                estimatedInputTokens,
                tierPolicy,
            });
            queueWaitMs = Date.now() - contextPreparationStartedAtMs;
            setQueueDepth({ depth: (await getUsageSnapshot(resolvedUsageKey)).inFlight });
            usageReserved = true;
        } catch (usageError) {
            const concurrencyRejected = /concurrency limit reached/i.test(String(usageError?.message || ''));
            recordAbuseSignal({
                userKey: resolvedUsageKey,
                channel: 'api',
                signal: 'usage_quota_rejected',
                severity: 'medium',
                metadata: { tier },
            });
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: true,
                concurrencyRejected,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs: Date.now() - contextPreparationStartedAtMs,
            });
            recordAiRequestEnd({
                success: false,
                queueRejected: true,
                latencyMs: Date.now() - requestStartedAtMs,
            });
            setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
            return response(429, { error: usageError.message });
        }

        try {
            const isPatchReplanRequest = Boolean(
                contextSnapshot?.taskState?.patchPlan ||
                Number(contextSnapshot?.taskState?.replanAttempt || 0) > 0 ||
                contextDiagnostics.triggerReason === 'build_failure' ||
                contextDiagnostics.triggerReason === 'pathfinding_failure',
            );
            const requestMode = isPatchReplanRequest ? 'patch_replan' : 'initial_plan';
            const plannerSystemPrompt = `You are a Minecraft structure planner.
Output JSON only with keys:
{
  "intent": string,
  "constraints": { "maxBlocks": number, "allowCommandBlocks": boolean, "notes": string[] },
  "materials": string[],
  "phases": string[],
  "targetStyleTags": string[]
}
Keep concise and executable.
${isPatchReplanRequest ? 'Patch replan mode: prioritize corrective edits near the failure area and avoid rebuilding everything.' : ''}
${canaryVariantEnabled ? 'Prefer explicit movement risk notes and compact deterministic phases.' : ''}`;
            const plannerUserPayload = JSON.stringify({
                tier,
                prompt: message,
                requestMode,
                context: contextSnapshot,
            });
            const plannerRequestStartedAtMs = Date.now();
            const plannerCompletion = await createCompletionWithFallback({
                primaryModel: modelRoute.plannerModel,
                fallbackModel: modelRoute.fallbackModel,
                messages: [
                    {
                        role: 'system',
                        content: plannerSystemPrompt,
                    },
                    {
                        role: 'user',
                        content: plannerUserPayload,
                    },
                ],
                maxTokens: Math.min(900, tierPolicy.maxOutputTokensPerRequest),
            });
            plannerDurationMs = Date.now() - plannerRequestStartedAtMs;
            plannerInputTokens = estimateTokenCountFromText(plannerSystemPrompt) + estimateTokenCountFromText(plannerUserPayload);
            plannerOutputTokens = estimateTokenCountFromText(plannerCompletion.text);

            const maxExecutorAttempts = (
                contextDiagnostics.triggerReason === 'pathfinding_failure' ||
                contextDiagnostics.triggerReason === 'build_failure'
            )
                ? 3
                : 2;
            const executorSystemPrompt = `You are a Minecraft building assistant.
Generate ONLY raw JSON in this shape:
{
  "actions": [
    { "type": "prepare_site", "label": "foundation" },
    { "type": "flatten_area", "x": 0, "y": 0, "z": 0, "width": 8, "length": 8, "targetY": 0, "fillBlock": "minecraft:dirt" },
    { "type": "clear_volume", "x": 0, "y": 1, "z": 0, "width": 8, "height": 4, "length": 8 },
    { "type": "ensure_access", "x": 0, "y": 0, "z": 0, "radius": 2 },
    { "type": "move_to", "x": 0, "y": 0, "z": 0 },
    { "type": "place_block", "x": 0, "y": 0, "z": 0, "block": "minecraft:oak_planks" }
  ],
  "tags": ["house", "wood"]
}
Rules:
- Relative coordinates only.
- Keep movement minimal and avoid micro-step loops.
- Prefer placement actions; movement should be coarse navigation only.
- Site prep actions are allowed: prepare_site, flatten_area, clear_volume, ensure_access.
- If context terrain flatness is low or obstruction/hazard ratios are high, include prep actions before placement actions.
- Keep prep bounded and proportional to structure size.
- If requestMode is patch_replan, output a minimal corrective plan and avoid full restarts.
- No markdown or explanations.
- No illegal blocks.
- Do not exceed tier constraints in planner notes.
${canaryVariantEnabled ? '- Add one explicit high-level safety tag in `tags`.' : ''}`;

            let finalPlan = null;
            let finalValidation = null;
            let executorCompletion = null;

            for (let attempt = 1; attempt <= maxExecutorAttempts; attempt += 1) {
                executorAttempts = attempt;
                const executorUserPayload = JSON.stringify({
                    prompt: message,
                    tier,
                    requestMode,
                    context: contextSnapshot,
                    plan: plannerCompletion.text,
                    previousValidationError: finalValidation?.errors?.[0]?.message || null,
                    attempt,
                    maxExecutorAttempts,
                });
                const executorRequestStartedAtMs = Date.now();
                executorCompletion = await createCompletionWithFallback({
                    primaryModel: modelRoute.executorModel,
                    fallbackModel: modelRoute.fallbackModel,
                    messages: [
                        {
                            role: 'system',
                            content: executorSystemPrompt,
                        },
                        {
                            role: 'user',
                            content: executorUserPayload,
                        },
                    ],
                    maxTokens: tierPolicy.maxOutputTokensPerRequest,
                });
                executorDurationMs += Date.now() - executorRequestStartedAtMs;
                executorInputTokens += estimateTokenCountFromText(executorSystemPrompt) + estimateTokenCountFromText(executorUserPayload);
                executorOutputTokens += estimateTokenCountFromText(executorCompletion.text);

                try {
                    const result = parseAndValidateExecutorPlan({
                        rawExecutorText: executorCompletion.text,
                        tier,
                        tierFeaturePolicy,
                    });

                    finalValidation = result.validation;

                    if (finalValidation.valid) {
                        finalPlan = result.normalizedPlan;
                        break;
                    }

                    planValidationHadFailures = true;
                    recordBlockedPlacement({
                        count: Math.max(1, finalValidation.errors?.length || 1),
                    });
                    recordAbuseSignal({
                        userKey: resolvedUsageKey,
                        channel: 'build',
                        signal: 'plan_validation_failed',
                        severity: 'medium',
                        metadata: {
                            tier,
                            errorCount: finalValidation.errors?.length || 0,
                        },
                    });
                    for (const auditEvent of finalValidation.audits) {
                        recordSecurityAuditEvent({
                            type: auditEvent.type,
                            severity: auditEvent.severity === 'error' ? 'error' : 'warning',
                            userKey: resolvedUsageKey,
                            tier,
                            message: auditEvent.message,
                            context: auditEvent.context,
                        });
                    }

                    if (attempt < maxExecutorAttempts) {
                        await sleep(120 * attempt);
                    }
                } catch (parseError) {
                    planValidationHadFailures = true;
                    recordAbuseSignal({
                        userKey: resolvedUsageKey,
                        channel: 'build',
                        signal: 'executor_json_parse_failed',
                        severity: 'medium',
                        metadata: { tier },
                    });
                    if (attempt < maxExecutorAttempts) {
                        await sleep(120 * attempt);
                        continue;
                    }
                    throw parseError;
                }
            }

            let fallbackPlanUsed = false;
            if (!finalPlan) {
                const fallbackPlan = buildFallbackPlan(message);
                const fallbackValidation = validateInstructionPlan({
                    planPayload: fallbackPlan,
                    tier,
                    tierFeaturePolicy,
                });

                if (!fallbackValidation.valid) {
                    throw new Error(fallbackValidation.errors[0]?.message || 'Failed to build a valid instruction plan.');
                }

                finalPlan = fallbackPlan;
                finalValidation = fallbackValidation;
                fallbackPlanUsed = true;
            }
            executorActionCount = Array.isArray(finalPlan?.actions) ? finalPlan.actions.length : 0;

            const legacyBlocksAndTags = toLegacyBlocksAndTags(finalPlan);
            const normalizedBlocksAndTags = JSON.stringify(legacyBlocksAndTags);
            const estimatedOutputTokens = estimateTokenCountFromText(normalizedBlocksAndTags);

            try {
                overageFinalization = await finalizeUsage({
                    userKey: resolvedUsageKey,
                    estimatedOutputTokens,
                    tierPolicy,
                });
                usageFinalized = true;
                setQueueDepth({ depth: (await getUsageSnapshot(resolvedUsageKey)).inFlight });
            } catch (usageError) {
                recordAbuseSignal({
                    userKey: resolvedUsageKey,
                    channel: 'api',
                    signal: 'usage_output_rejected',
                    severity: 'medium',
                    metadata: { tier },
                });
                await recordPreScaleRequestFailure({
                    userKey: resolvedUsageKey,
                    tier,
                    capHit: true,
                    concurrencyRejected: false,
                    latencyMs: Date.now() - requestStartedAtMs,
                    queueWaitMs,
                });
                recordAiRequestEnd({
                    success: false,
                    queueRejected: true,
                    latencyMs: Date.now() - requestStartedAtMs,
                    retried: Math.max(0, executorAttempts - 1),
                    blockedPlan: planValidationHadFailures,
                });
                setQueueDepth({ depth: (await getUsageSnapshot(resolvedUsageKey)).inFlight });
                setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
                return response(429, { error: usageError.message });
            }

            const totalOverageInputTokens = overageReservation.inputOverageTokens + overageFinalization.inputOverageTokens;
            const totalOverageOutputTokens = overageReservation.outputOverageTokens + overageFinalization.outputOverageTokens;
            const totalOverageRequests = overageReservation.requestOverage + overageFinalization.requestOverage;
            if (supportsMeteredOverage(tierPolicy) && (
                totalOverageInputTokens > 0 ||
                totalOverageOutputTokens > 0 ||
                totalOverageRequests > 0
            )) {
                overageLedger = recordOverageUsage({
                    userKey: resolvedUsageKey,
                    tier,
                    inputOverageTokens: totalOverageInputTokens,
                    outputOverageTokens: totalOverageOutputTokens,
                    overageRequests: totalOverageRequests,
                });
                suspiciousUsage = totalOverageInputTokens + totalOverageOutputTokens >= 200000;
                recordAbuseSignal({
                    userKey: resolvedUsageKey,
                    channel: 'api',
                    signal: 'metered_overage_usage',
                    severity: suspiciousUsage ? 'high' : 'medium',
                    metadata: {
                        tier,
                        totalOverageInputTokens,
                        totalOverageOutputTokens,
                        totalOverageRequests,
                    },
                });
            }

            const metering = await recordUsageMetering({
                userKey: resolvedUsageKey,
                tier,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
            });
            const estimatedTokenBurnUsd = (
                (estimatedInputTokens * 0.30) +
                (estimatedOutputTokens * 0.60)
            ) / 1_000_000;
            recordTokenBurn({ usd: estimatedTokenBurnUsd });
            const overageCostUsd = ((totalOverageInputTokens + totalOverageOutputTokens) / 1000) * getOverageRateUsdPer1k(tier);
            const infraCostUsd = INFRA_COST_PER_REQUEST_USD[tier] || 0;
            const totalCostUsd = estimatedTokenBurnUsd + infraCostUsd + overageCostUsd;
            const buildId = `build_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const contextInjectionTokens = estimateTokenCountFromText(JSON.stringify(contextSnapshot || {}));
            const contextBaselineTokens = estimateTokenCountFromText(JSON.stringify(contextForSnapshot || {}));
            await recordBuildCostSnapshot({
                buildId,
                month: metering.month,
                userKey: resolvedUsageKey,
                tier,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                plannerInputTokens,
                plannerOutputTokens,
                executorInputTokens,
                executorOutputTokens,
                apiCostUsd: estimatedTokenBurnUsd,
                infraCostUsd,
                overageCostUsd,
            });
            await recordPreScaleBuildSuccess({
                userKey: resolvedUsageKey,
                tier,
                month: metering.month,
                plannerInputTokens,
                plannerOutputTokens,
                executorInputTokens,
                executorOutputTokens,
                contextInjectionTokens,
                contextBaselineTokens,
                snapshotMode: contextDiagnostics.snapshotMode,
                overageUsed: totalOverageInputTokens + totalOverageOutputTokens + totalOverageRequests > 0,
                totalCostUsd,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs,
                plannerModel: plannerCompletion.modelUsed,
                plannerDurationMs,
                executorActions: executorActionCount,
                executorDurationMs,
            });
            if (authUserId) {
                await recordFeatureUsageSignal({
                    userId: authUserId,
                    tier,
                    feature: 'build_generation',
                });
            }

            const marginAlerts = await evaluateBreakEvenAlerts({ month: metering.month });
            const schematic = includeSchematic === true
                ? exportInstructionPlanToSchematic({
                    name: `${tier}-build-${Date.now()}`,
                    plan: finalPlan,
                })
                : null;

            recordAiRequestEnd({
                success: true,
                retried: Math.max(0, executorAttempts - 1),
                latencyMs: Date.now() - requestStartedAtMs,
                blockedPlan: planValidationHadFailures,
                suspiciousUsage,
            });
            setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });

            return response(200, {
                blocksAndTags: normalizedBlocksAndTags,
                instructionPlan: finalPlan,
                ...(schematic ? { schematic } : {}),
                meta: {
                    tier,
                    modelRoute: {
                        planner: plannerCompletion.modelUsed,
                        executor: executorCompletion.modelUsed,
                        inferencePool: modelRoute.inferencePool,
                    },
                    fallbackUsed: plannerCompletion.fallbackUsed || executorCompletion.fallbackUsed,
                    fallbackPlanUsed,
                    canaryVariantEnabled,
                    executorAttempts,
                    estimatedInputTokens,
                    estimatedOutputTokens,
                    buildId,
                    tokenSplit: {
                        plannerInputTokens,
                        plannerOutputTokens,
                        executorInputTokens,
                        executorOutputTokens,
                    },
                    usage: await getUsageSnapshot(resolvedUsageKey),
                    buildUsage: getBuildUsageSnapshot(resolvedUsageKey),
                    metering,
                    overage: overageLedger,
                    validation: {
                        stats: finalValidation.stats,
                        warnings: finalValidation.warnings,
                    },
                    marginAlertsTriggered: marginAlerts.triggered.length,
                    contextDiagnostics,
                    requestMode,
                    emergencyGuard: {
                        active: emergencyGuardState.active,
                        reason: emergencyGuardState.reason,
                        reasonCodes: emergencyGuardState.reasonCodes,
                        source: emergencyGuardState.source,
                        throttleFreeTier: emergencyGuardState.throttleFreeTier,
                        forceThinSnapshots: emergencyGuardState.forceThinSnapshots,
                        lastEvaluatedAt: emergencyGuardState.lastEvaluatedAt,
                    },
                },
            });
        } catch (err) {
            if (usageReserved && !usageFinalized) {
                await releaseInFlightSlot(resolvedUsageKey);
                setQueueDepth({ depth: (await getUsageSnapshot(resolvedUsageKey)).inFlight });
            }
            await recordPreScaleRequestFailure({
                userKey: resolvedUsageKey,
                tier,
                capHit: false,
                concurrencyRejected: false,
                latencyMs: Date.now() - requestStartedAtMs,
                queueWaitMs,
            });
            recordBuildFailure({ userKey: resolvedUsageKey });
            recordCrash();
            recordAbuseSignal({
                userKey: resolvedUsageKey,
                channel: 'api',
                signal: 'ai_request_failed',
                severity: 'high',
                metadata: { tier },
            });
            recordAiRequestEnd({
                success: false,
                retried: Math.max(0, executorAttempts - 1),
                latencyMs: Date.now() - requestStartedAtMs,
                blockedPlan: planValidationHadFailures,
                suspiciousUsage,
            });
            setActiveSessions({ count: getOpsDashboardSnapshot().activeAiRequests });
            logger.error(`Failed to generate structure for tier ${tier}. ${(err && err.stack) || err}`, {
                tier,
                usageKey: resolvedUsageKey,
                estimatedInputTokens,
                contextDiagnostics,
                executorAttempts,
                planValidationHadFailures,
            });
            return response(500, { error: 'Failed to generate structure. Please try again.' });
        }
    };
}
