const MODERATION_BLOCKLIST = Object.freeze([
    'self harm',
    'kill yourself',
    'sexual content involving minors',
    'terrorism',
    'hate crime',
]);

export const INFRA_COST_PER_REQUEST_USD = Object.freeze({
    free: 0.0005,
    starter: 0.0003,
    pro: 0.00024,
    admin: 0.0002,
});

export const FREE_TIER_THROTTLE_ERROR_CODE = 'FREE_TIER_THROTTLED_GUARD_ACTIVE';

/**
 * Create runtime AI helper functions bound to provider + parser dependencies.
 *
 * @param {{
 *   openai: import('openai').OpenAI | null,
 *   parsePrompt: (prompt: string) => Array<Record<string, any>>,
 *   normalizeInstructionPlan: (payload: any) => { schemaVersion: string, actions: Array<Record<string, any>>, tags: string[] },
 *   optimizeInstructionPlan: (payload: { schemaVersion: string, actions: Array<Record<string, any>>, tags: string[] }) => { schemaVersion: string, actions: Array<Record<string, any>>, tags: string[] },
 *   validateInstructionPlan: (params: {
 *     planPayload: { schemaVersion: string, actions: Array<Record<string, any>>, tags: string[] },
 *     tier: 'free' | 'starter' | 'pro' | 'admin',
 *     tierFeaturePolicy: Record<string, any>,
 *   }) => Record<string, any>,
 * }} deps
 * @returns {Record<string, Function>} AI runtime helper functions bound to the supplied dependencies.
 */
export function createAiRuntimeHelpers({
    openai,
    parsePrompt,
    normalizeInstructionPlan,
    optimizeInstructionPlan,
    validateInstructionPlan,
}) {
    /**
     * Execute a chat completion with automatic fallback model retry.
     * @param {{
     *   primaryModel: string,
     *   fallbackModel: string,
     *   messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }>,
     *   maxTokens?: number,
     * }} params
     * @returns {Promise<{ text: string, modelUsed: string, fallbackUsed: boolean }>}
     * @throws {Error} When OpenAI is not configured or both model requests fail.
     */
    async function createCompletionWithFallback({ primaryModel, fallbackModel, messages, maxTokens }) {
        if (!openai) {
            throw new Error('OpenAI is not configured. Set OPENAI_API_KEY before using AI build generation.');
        }

        const callModel = async (model) => openai.chat.completions.create({
            model,
            messages,
            ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
        });

        try {
            const chat = await callModel(primaryModel);
            return {
                text: chat.choices?.[0]?.message?.content?.trim() || '',
                modelUsed: primaryModel,
                fallbackUsed: false,
            };
        } catch (primaryError) {
            if (primaryModel === fallbackModel) {
                throw primaryError;
            }

            const fallbackChat = await callModel(fallbackModel);
            return {
                text: fallbackChat.choices?.[0]?.message?.content?.trim() || '',
                modelUsed: fallbackModel,
                fallbackUsed: true,
            };
        }
    }

    /**
     * Delay execution for retry backoff.
     * @param {number} ms
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Build fallback instruction plan from the deterministic prompt parser.
     * @param {string} prompt
     * @returns {{ schemaVersion: string, actions: Array<Record<string, unknown>>, tags: string[] }}
     */
    function buildFallbackPlan(prompt) {
        const fallbackBlocks = parsePrompt(prompt)
            .map((block) => ({
                type: 'place_block',
                x: Number(block.x || 0),
                y: Number(block.y || 0),
                z: Number(block.z || 0),
                block: String(block.block || 'stone').startsWith('minecraft:')
                    ? String(block.block)
                    : `minecraft:${String(block.block || 'stone')}`,
            }));

        return {
            schemaVersion: '1.0',
            actions: fallbackBlocks,
            tags: ['fallback'],
        };
    }

    /**
     * Parse executor output into normalized plan and validate policy constraints.
     * @param {{
     *   rawExecutorText: string,
     *   tier: 'free' | 'starter' | 'pro' | 'admin',
     *   tierFeaturePolicy: Record<string, any>,
     * }} params
     * @returns {{
     *   normalizedPlan: { schemaVersion: string, actions: Array<Record<string, unknown>>, tags: string[] },
     *   validation: Record<string, any>,
     * }}
     */
    function parseAndValidateExecutorPlan({ rawExecutorText, tier, tierFeaturePolicy }) {
        let parsed;
        try {
            parsed = JSON.parse(rawExecutorText);
        } catch {
            throw new Error('Executor response was not valid JSON.');
        }

        const normalizedPlan = optimizeInstructionPlan(normalizeInstructionPlan(parsed));
        const validation = validateInstructionPlan({
            planPayload: normalizedPlan,
            tier,
            tierFeaturePolicy,
        });

        return { normalizedPlan, validation };
    }

    /**
     * Basic moderation filter for user prompts.
     * @param {string} prompt
     * @returns {string | null}
     */
    function detectModerationViolation(prompt) {
        const lower = String(prompt || '').toLowerCase();
        for (const blockedPhrase of MODERATION_BLOCKLIST) {
            if (lower.includes(blockedPhrase)) {
                return blockedPhrase;
            }
        }
        return null;
    }

    return {
        createCompletionWithFallback,
        sleep,
        buildFallbackPlan,
        parseAndValidateExecutorPlan,
        detectModerationViolation,
    };
}
