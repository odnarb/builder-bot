import pkg from 'mineflayer-pathfinder';
const { goals } = pkg;

import { offsetStructure } from '../shared-utils/offsetStructure.js';
import { normalizeInstructionPlan, toLegacyBlocksAndTags } from '../shared-utils/instruction-schema.js';
import {
  getTierAiPolicy,
  getTierFeaturePolicy,
  resolveTier,
} from '../api/config/tier-policy.js';
import { validateInstructionPlan } from '../core/logic/build-validator.js';
import { createExecutionLedger, executeCommands } from './execute-commands.js';
import { runDecisionEngineBuild } from './decision-engine.js';
import { createDecisionTelemetryScope } from './decision-telemetry.js';
import { resolveDecisionTierPolicy } from './decision-tier-policy.js';
import { createLocalBuildPlan } from './local-decision-planner.js';
import { buildDecisionWorldContext, ensurePathfinderTelemetry } from './world-context.js';
import { resolveCommanderUsername } from './player-identity.js';
import {
  createUserBuild,
  updateUserBuild,
  uploadBuildSteps,
  getStructureAndTagsFromAI,
  addLogEntry
} from './apiClient.js';

const BUILD_START_OFFSET = Object.freeze({ x: 2, y: 0, z: 2 });
let buildCommandInFlight = false;

function normalizeCommanderTier(commander) {
  return resolveTier(commander?.tier);
}

/**
 * Build a compact context snapshot for server-side AI injection.
 * @param {{
 *   bot: any,
 *   commander: { tier: string },
 *   prompt: string,
 *   decisionPolicy: ReturnType<typeof resolveDecisionTierPolicy>,
 *   triggerReason?: string | null,
 *   taskState?: Record<string, unknown>,
 *   patchPlan?: Record<string, unknown> | null,
 *   failureDigest?: Array<Record<string, unknown>> | null,
 * }} params
 * @returns {Record<string, unknown>}
 */
function buildAiContext({
  bot,
  commander,
  prompt,
  decisionPolicy,
  triggerReason = null,
  taskState = {},
  patchPlan = null,
  failureDigest = null,
}) {
  ensurePathfinderTelemetry(bot);
  const position = bot?.entity?.position;
  const inventoryItems = bot?.inventory?.items?.() || [];
  const resolvedDecisionPolicy = decisionPolicy || resolveDecisionTierPolicy(normalizeCommanderTier(commander));

  let nearbyBlockSummary = [];
  try {
    const nearby = bot.findBlocks({
      matching: block => block.name !== 'air',
      maxDistance: Math.max(4, Math.min(32, Number(resolvedDecisionPolicy.maxScanRadius || 8))),
      count: 30,
    });

    const blockCountByName = {};
    for (const pos of nearby) {
      const block = bot.blockAt(pos);
      const name = block?.name || 'unknown';
      blockCountByName[name] = (blockCountByName[name] || 0) + 1;
    }

    nearbyBlockSummary = Object.entries(blockCountByName)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  } catch {
    nearbyBlockSummary = [];
  }

  const nearbyEntities = Object.values(bot?.entities || {})
    .filter(entity => entity && entity.position && entity.name !== bot.entity?.username)
    .map(entity => ({
      name: entity.displayName || entity.name || 'unknown',
      type: entity.type || 'unknown',
      distance: Number(bot.entity.position.distanceTo(entity.position).toFixed(2)),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  const decisionWorldContext = buildDecisionWorldContext({
    bot,
    prompt,
    decisionPolicy: resolvedDecisionPolicy,
  });

  const baseTaskState = {
    task: 'build',
    promptChars: prompt.length,
    promptWords: prompt.trim().split(/\s+/).length,
    decisionPolicyTier: resolvedDecisionPolicy.tier,
    maxReplanAttempts: resolvedDecisionPolicy.maxReplanAttempts,
    maxLocalRetries: resolvedDecisionPolicy.maxLocalRetries,
    maxPathRetriesPerStep: resolvedDecisionPolicy.maxPathRetriesPerStep,
    maxPrepEdits: resolvedDecisionPolicy.maxPrepEdits,
    maxPrepVolume: resolvedDecisionPolicy.maxPrepVolume,
    ...(taskState && typeof taskState === 'object' ? taskState : {}),
  };

  if (patchPlan && typeof patchPlan === 'object') {
    baseTaskState.patchPlan = patchPlan;
  }

  return {
    bot: {
      position: position ? {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
      } : null,
      health: Number(bot?.health || 0),
      food: Number(bot?.food || 0),
      dimension: bot?.game?.dimension || null,
      biome: bot?.biome?.name || null,
    },
    inventory: inventoryItems.map(item => ({
      name: item.name,
      count: item.count,
      durabilityUsed: item.durabilityUsed,
      durability: item.durability,
    })),
    nearbyEntities,
    nearbyBlocks: nearbyBlockSummary,
    triggerReason: triggerReason || null,
    taskState: baseTaskState,
    usageCounters: {
      requestCount: 1,
    },
    decisionPolicy: {
      tier: resolvedDecisionPolicy.tier,
      maxScanRadius: resolvedDecisionPolicy.maxScanRadius,
      maxAnchorCandidates: resolvedDecisionPolicy.maxAnchorCandidates,
      maxPrepEdits: resolvedDecisionPolicy.maxPrepEdits,
      maxPrepVolume: resolvedDecisionPolicy.maxPrepVolume,
      maxReplanAttempts: resolvedDecisionPolicy.maxReplanAttempts,
      maxLocalRetries: resolvedDecisionPolicy.maxLocalRetries,
      maxPathRetriesPerStep: resolvedDecisionPolicy.maxPathRetriesPerStep,
      allowAggressiveRecovery: resolvedDecisionPolicy.allowAggressiveRecovery,
    },
    ...decisionWorldContext,
    failureDigest: Array.isArray(failureDigest) && failureDigest.length > 0
      ? failureDigest
      : decisionWorldContext.failureDigest,
  };
}

function estimatePromptTokens(prompt) {
  return Math.ceil(String(prompt || '').length / 4);
}

function overTierPromptLimit({ commander, prompt }) {
  const tier = normalizeCommanderTier(commander);
  const tierAiPolicy = getTierAiPolicy(tier);
  return estimatePromptTokens(prompt) > Number(tierAiPolicy.maxInputTokensPerRequest);
}

function collectRequiredBlockNames(commands) {
  if (!Array.isArray(commands)) {
    return [];
  }

  return [...new Set(commands
    .flatMap((step) => {
      const names = [];
      if (typeof step?.block === 'string') {
        names.push(step.block);
      }
      if (typeof step?.fillBlock === 'string') {
        names.push(step.fillBlock);
      }
      return names;
    })
    .map((block) => String(block).replace(/^minecraft:/, '').trim().toLowerCase())
    .filter(Boolean))];
}

/**
 * Provision and verify every material before the executor can mutate terrain.
 * @param {{ bot: any, commands: Array<Record<string, unknown>> }} params
 * @returns {Promise<void>}
 * @throws {Error} When a required block is unknown or remains unavailable.
 */
async function ensureCreativeMaterialsForCommands({ bot, commands }) {
  const needed = collectRequiredBlockNames(commands)
    .filter((name) => !bot.inventory.items().some((item) => item.name === name));

  if (needed.length === 0) {
    return;
  }

  bot.chat(`Giving self the materials needed for the build...`);
  const missing = [];

  for (const blockName of needed) {
    try {
      const itemId = bot?.registry?.itemsByName?.[blockName]?.id;
      if (itemId === undefined) {
        console.warn(`⚠️ Unknown block type: ${blockName}`);
        missing.push(blockName);
        continue;
      }

      if (bot?.creative?.give) {
        await bot.creative.give(itemId, 999);
      } else {
        bot.chat(`/give ${bot.username} minecraft:${blockName} 999`);
        await bot.waitForTicks(20);
      }
      if (bot.inventory.items().some((item) => item.name === blockName)) {
        console.log(`✅ Material ready: ${blockName}`);
      } else {
        missing.push(blockName);
      }
    } catch (error) {
      console.warn(`❌ Failed to give ${blockName}: ${error.message}`);
      missing.push(blockName);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Required build materials are unavailable: ${missing.join(', ')}.`);
  }
}

async function runBestEffortPersistence(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`⚠️ ${label} skipped: ${error.message}`);
    return null;
  }
}

function fireAndForgetLogEntry(log) {
  void addLogEntry(log).catch((error) => {
    console.warn(`⚠️ Log entry skipped: ${error.message}`);
  });
}

function resolveRuntimePlayerEntity({ bot, commander, username }) {
  const resolvedUsername = resolveCommanderUsername({
    bot,
    commander,
    preferredUsername: username,
  });

  if (!resolvedUsername) {
    return null;
  }

  return bot.players?.[resolvedUsername]?.entity || null;
}

function createCommandRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logCommandLifecycle({ runId, commandType, username, state, extra = {}, level = 0 }) {
  fireAndForgetLogEntry({
    type: 'command_lifecycle',
    message: state,
    data: {
      runId,
      commandType,
      username,
      ...extra,
    },
    level,
  });
}

export function isBuildCommandInFlight() {
  return buildCommandInFlight;
}

export async function runBuildCommandSingleFlight({
  bot,
  username = 'Commander',
  commandType = 'build',
  busyMessage = "⏳ I'm already handling another build command. Please wait.",
  run,
}) {
  const runId = createCommandRunId();
  logCommandLifecycle({ runId, commandType, username, state: 'queued' });

  if (buildCommandInFlight) {
    bot.chat(busyMessage);
    logCommandLifecycle({
      runId,
      commandType,
      username,
      state: 'rejected_busy',
      level: 1,
    });
    return false;
  }

  buildCommandInFlight = true;
  logCommandLifecycle({ runId, commandType, username, state: 'started' });

  try {
    await run({ runId });
    logCommandLifecycle({ runId, commandType, username, state: 'finished' });
    return true;
  } catch (error) {
    logCommandLifecycle({
      runId,
      commandType,
      username,
      state: 'failed',
      extra: { error: error?.message || String(error) },
      level: 2,
    });
    throw error;
  } finally {
    buildCommandInFlight = false;
  }
}

export async function handlePlayerCommand({ commander, bot, message, username = 'Commander' }) {
  console.log(`⚙️ Executing: ${message} from ${username}`);

  const rawMessage = String(message || '').trim();
  const msg = rawMessage.toLowerCase();

  if (msg.includes('come here')) {
    const playerEntity = resolveRuntimePlayerEntity({ bot, commander, username });

    //if a close entity found go there else try to check for coordinates in the message
    if (playerEntity) {
      const goal = new goals.GoalBlock(
        Math.floor(playerEntity.position.x),
        Math.floor(playerEntity.position.y),
        Math.floor(playerEntity.position.z)
      );
      bot.pathfinder.setGoal(goal);

      fireAndForgetLogEntry({ type: "command", message: "move to", data: JSON.stringify(goal), level: 0 })

      bot.chat("On my way!");
    } else {
      // Match "come here x:0,y:0,z:0" using regex
      const coordMatch = rawMessage.match(/x\s*:\s*(-?\d+)\s*,\s*y\s*:\s*(-?\d+)\s*,\s*z\s*:\s*(-?\d+)/i);

      if (coordMatch) {
        const [, x, y, z] = coordMatch.map(Number);

        if ([x, y, z].every(v => !isNaN(v))) {
          console.log(`🧭 ${username} requested bot to travel to: (${x}, ${y}, ${z})`);

          const goal = new goals.GoalBlock(Math.floor(x), Math.floor(y), Math.floor(z));
          bot.pathfinder.setGoal(goal);

          fireAndForgetLogEntry({ type: "command", message: "move to specific x,y,z", data: JSON.stringify(goal), level: 0 })

          bot.chat("On my way! This might take a while...");
        } else {
          bot.chat(`⚠️ Invalid coordinates given.`);
        }
      } else {
        bot.chat("Looks like you're too far away or I couldn't understand those coordinates. You need to use F3 to find your coordinates and tell me where to go. Like this: @Bot come here x:0,y:0,z:0");
      }
    }
    return;
  }

  if (msg.startsWith('follow')) {
    const playerEntity = resolveRuntimePlayerEntity({ bot, commander, username });
    const distanceMatch = rawMessage.match(/follow\s*(\d+)?/i);
    const followDistance = distanceMatch?.[1] ? Math.max(1, Math.min(12, Number(distanceMatch[1]))) : 3;

    if (!playerEntity) {
      bot.chat("I can't find you to follow right now.");
      return;
    }

    const goal = new goals.GoalFollow(playerEntity, followDistance);
    bot.pathfinder.setGoal(goal, true);
    fireAndForgetLogEntry({
      type: "command",
      message: "follow",
      data: { username, followDistance },
      level: 0
    });
    bot.chat(`Following ${username} at distance ${followDistance}.`);
    return;
  }

  if (msg === 'stop') {
    bot.pathfinder.setGoal(null);
    bot.chat("Okay, stopped.");

    fireAndForgetLogEntry({ type: "command", message: "stop", data: bot.entity.position.floored(), level: 0 })

    return;
  }

  if (msg.startsWith('build ')) {
    const prompt = rawMessage.slice(6).trim();
    const normalizedTier = normalizeCommanderTier(commander);
    const decisionPolicy = resolveDecisionTierPolicy(normalizedTier);

    if (!prompt) {
      bot.chat('❌ Please provide a build prompt.');
      return;
    }

    await runBuildCommandSingleFlight({
      bot,
      username,
      commandType: 'build',
      run: async () => {
        if (bot?.pathfinder) {
          bot.pathfinder.thinkTimeout = decisionPolicy.pathfinderThinkTimeoutMs;
          bot.pathfinder.tickTimeout = decisionPolicy.pathfinderTickTimeoutMs;
          bot.pathfinder.searchRadius = decisionPolicy.pathfinderSearchRadius;
        }

        //check prompt before submitting
        if (overTierPromptLimit({ commander, prompt })) {
          const promptTokens = estimatePromptTokens(prompt);
          const tierAiPolicy = getTierAiPolicy(normalizedTier);
          bot.chat(`❌ Prompt exceeds ${normalizedTier} tier request limits (${promptTokens}/${tierAiPolicy.maxInputTokensPerRequest} est. tokens).`);
          console.warn(`⚠️ Prompt exceeded limits for tier "${normalizedTier}". prompt length:${prompt.length} chars`);

          fireAndForgetLogEntry({
            type: "prompt_tier_limit",
            message: "user",
            data: {
              tier: normalizedTier,
              prompt,
              charCount: prompt.length,
              wordCount: prompt.trim().split(/\s+/).length,
              promptTokens,
              maxInputTokensPerRequest: tierAiPolicy.maxInputTokensPerRequest,
            },
            level: 1
          });
          return;
        }

        bot.chat(`📐 Planning build for: ${prompt}...`);
        console.log(`📐 Planning build for: ${prompt}...`);

        const build = {
          type: "build",
          commanderUUID: process.env.COMMANDER_UUID,
          message: prompt,
          level: 0
        };

        //start the build and log an id
        const buildId = await runBestEffortPersistence(
          'Create build record',
          () => createUserBuild({ build })
        );

        const buildOrigin = {
          x: bot.entity.position.x,
          y: bot.entity.position.y,
          z: bot.entity.position.z,
        };
        /**
         * Resolve and validate one local, AI, or patch plan in the shared schema.
         * @param {{
         *   replanAttempt?: number,
         *   failureDigest?: Array<Record<string, unknown>>,
         *   completedTargets?: Array<Record<string, unknown>>,
         *   remainingTargets?: Array<Record<string, unknown>>,
         *   remainingBudgets?: Record<string, unknown> | null,
         *   allowLocal?: boolean,
         * }} [options]
         * @returns {Promise<{
         *   steps: Array<Record<string, unknown>>,
         *   tags: string[],
         *   actionCount: number,
         *   source: string,
         * }>}
         * @throws {Error} When planning fails or the plan violates shared policy.
         */
        async function requestPlanSteps({
          replanAttempt = 0,
          failureDigest = [],
          completedTargets = [],
          remainingTargets = [],
          remainingBudgets = null,
          allowLocal = true,
        } = {}) {
          let plannedBuild = null;
          if (allowLocal && replanAttempt === 0) {
            plannedBuild = createLocalBuildPlan({
              prompt,
              bot,
              decisionPolicy,
              buildOrigin,
              buildStartOffset: BUILD_START_OFFSET,
            });

            if (plannedBuild) {
              console.log(`📐 Using local build planner for prompt: ${prompt}`);
            }
          }

          if (!plannedBuild) {
            bot.chat(`📐 Asking AI to generate build details...`);
            const aiPayload = await getStructureAndTagsFromAI({
              message: prompt,
              tier: normalizedTier,
              context: buildAiContext({
                bot,
                commander: { ...commander, tier: normalizedTier },
                prompt,
                decisionPolicy,
                triggerReason: replanAttempt > 0 ? 'build_failure' : null,
                taskState: replanAttempt > 0
                  ? {
                    phase: 'patch_replan',
                    buildFailure: true,
                    replanAttempt,
                    maxReplanAttempts: decisionPolicy.maxReplanAttempts,
                  }
                  : {
                    phase: 'initial_plan',
                  },
                patchPlan: replanAttempt > 0
                  ? {
                    mode: 'patch_replan',
                    replanAttempt,
                    maxReplanAttempts: decisionPolicy.maxReplanAttempts,
                    failureDigest: Array.isArray(failureDigest) ? failureDigest.slice(-6) : [],
                    completedTargets: Array.isArray(completedTargets) ? completedTargets.slice(0, 64) : [],
                    remainingTargets: Array.isArray(remainingTargets) ? remainingTargets.slice(0, 64) : [],
                    remainingBudgets,
                  }
                  : null,
                failureDigest,
              }),
            });

            const normalizedPlan = normalizeInstructionPlan(aiPayload);
            const { blocks, tags } = toLegacyBlocksAndTags(normalizedPlan);
            plannedBuild = {
              steps: blocks,
              tags,
              actionCount: normalizedPlan.actions.length,
              source: 'ai',
            };
          }

          const validation = validateInstructionPlan({
            planPayload: { actions: plannedBuild.steps, tags: plannedBuild.tags },
            tier: normalizedTier,
            tierFeaturePolicy: {
              ...getTierFeaturePolicy(normalizedTier),
              maxPrepVolume: decisionPolicy.maxPrepVolume,
            },
          });
          if (!validation.valid) {
            throw new Error(validation.errors[0]?.message || 'Build plan failed safety validation.');
          }

          const { blocks, tags } = toLegacyBlocksAndTags(validation.normalizedPlan);
          return {
            steps: blocks,
            tags,
            actionCount: validation.normalizedPlan.actions.length,
            source: plannedBuild.source || 'ai',
          };
        }

        let steps = [];
        let initialTags = [];
        let initialActionCount = 0;
        let initialPlanSource = 'ai';
        const decisionTelemetryScope = createDecisionTelemetryScope();

        try {
          const initialPlan = await requestPlanSteps();
          steps = initialPlan.steps;
          initialTags = initialPlan.tags;
          initialActionCount = initialPlan.actionCount;
          initialPlanSource = initialPlan.source || 'ai';
          decisionTelemetryScope.recordPlanSource(initialPlanSource);

          if (buildId) {
            await runBestEffortPersistence(
              'Update build with parsed steps metadata',
              () => updateUserBuild({
                buildId,
                build: {
                  event: "steps_parsed",
                  source: initialPlanSource,
                  blockCount: steps.length,
                  tags: initialTags,
                  actionCount: initialActionCount,
                }
              })
            );
          }
        } catch (error) {
          const safeMessage = error?.code === 'ERR_NO_SAFE_ANCHOR' || error instanceof RangeError
            ? error.message
            : 'Sorry, a safe and valid build plan could not be created. Please try again.';
          bot.chat(`❌ ${safeMessage}`);

          if (buildId) {
            await runBestEffortPersistence(
              'Update build with parsing error',
              () => updateUserBuild({
                buildId,
                build: {
                  error: true,
                  error_code: error?.code || 'ERR_PLAN_INVALID',
                  error_message: safeMessage,
                }
              })
            );
          }

          console.error(`❌ Could not create build plan: ${error.stack}`);
          return;
        }

        bot.chat(`💾 Saving build steps...`);
        if (buildId) {
          await runBestEffortPersistence(
            'Upload build steps',
            () => uploadBuildSteps({ buildId, steps })
          );
        }

        if (steps.length > 0) {
          bot.chat(`Attempting to build...`);
          const executionLedger = createExecutionLedger(decisionPolicy);

          const decisionResult = await runDecisionEngineBuild({
            prompt,
            decisionPolicy,
            initialCommands: steps,
            onStateChange: ({ state, ...stateData }) => {
              fireAndForgetLogEntry({
                type: 'decision_engine_state',
                message: state,
                data: {
                  tier: normalizedTier,
                  ...stateData,
                },
                level: state === 'FAILED' ? 1 : 0,
              });
            },
            executePlan: async ({ commands, attemptNumber }) => {
              if (attemptNumber > 1) {
                const totalAttempts = Number(decisionPolicy.maxReplanAttempts || 0) + 1;
                bot.chat(`🔁 Retrying build with patch plan (${attemptNumber}/${totalAttempts})...`);
              }

              const adjustedCommands = offsetStructure(
                commands,
                buildOrigin,
                BUILD_START_OFFSET,
              );
              await ensureCreativeMaterialsForCommands({
                bot,
                commands: adjustedCommands,
              });

              return executeCommands({
                bot,
                buildId,
                commands: adjustedCommands,
                relativeCommands: commands,
                username,
                decisionPolicy,
                executionLedger,
                suppressCompletionChat: true,
              });
            },
            requestPatchPlan: async ({
              replanAttempt,
              failureDigest,
              completedTargets,
              remainingTargets,
              remainingBudgets,
            }) => {
              const patchPlan = await requestPlanSteps({
                replanAttempt,
                failureDigest,
                completedTargets,
                remainingTargets,
                remainingBudgets,
                allowLocal: false,
              });
              decisionTelemetryScope.recordPlanSource(patchPlan.source || 'ai', { isPatch: true });

              if (buildId) {
                await runBestEffortPersistence(
                  'Update build with patch plan metadata',
                  () => updateUserBuild({
                    buildId,
                    build: {
                      event: 'patch_steps_parsed',
                      replanAttempt,
                      source: patchPlan.source || 'ai',
                      blockCount: patchPlan.steps.length,
                      actionCount: patchPlan.actionCount,
                      tags: patchPlan.tags,
                    },
                  })
                );
                await runBestEffortPersistence(
                  'Upload patch build steps',
                  () => uploadBuildSteps({ buildId, steps: patchPlan.steps })
                );
              }

              return {
                commands: patchPlan.steps,
                meta: {
                  replanAttempt,
                  actionCount: patchPlan.actionCount,
                  source: patchPlan.source || 'ai',
                },
              };
            },
          });

          if (decisionResult.success) {
            bot.chat(`📐 Build complete!`);
            console.log(`📐 Build complete!`);
          } else {
            bot.chat(`⚠️ Build failed after ${decisionResult.attempts.length} attempt(s).`);
            console.warn(`⚠️ Build failed after retries. reason=${decisionResult.failureReason || 'unknown'}`);
          }
          decisionTelemetryScope.recordBuildOutcome({
            source: initialPlanSource,
            success: decisionResult.success,
          });
          const decisionTelemetry = decisionTelemetryScope.getSnapshot();

          if (buildId) {
            await runBestEffortPersistence(
              'Update build with decision engine summary',
              () => updateUserBuild({
                buildId,
                build: {
                  event: 'decision_engine_finished',
                  success: decisionResult.success,
                  attempts: decisionResult.attempts.length,
                  replans: decisionResult.replanCount,
                  localRetries: decisionResult.localRetryCount,
                  failureReason: decisionResult.failureReason || null,
                  planSource: initialPlanSource,
                  decisionTelemetry,
                },
              })
            );
          }
        } else {
          bot.chat(`❌ I couldn't understand how to build that. This has been logged.`);
          console.log(`❌ No structure received from AI or failed to parse`);

          if (buildId) {
            await runBestEffortPersistence(
              'Mark empty build record error',
              () => updateUserBuild({ buildId, build: { error: "build steps array empty" } })
            );
          }
        }
      },
    });

    return;
  }

  bot.chat("❓ Unknown command.");
}
