# MINECRAFT BUILDER BOT PRICING PROMPT

PROMPT START

You are acting as a SaaS AI pricing architect.

Generate a detailed token-economics and margin analysis table for my AI platform with world-context injection.

Assume:

Lower-cost scaled models only (mini-tier models)

Server-side world-context injection per request

Context includes identity, feature flags, billing state, RAG snippets, SLA rules, and usage counters

Create a structured table including:

Tier (Free / Starter $4.99 / Pro $9.99 / Admin $19.99)

Model used per tier

Input price ($ per 1M tokens)

Output price ($ per 1M tokens)

Average context injection size (tokens per request)

Average user prompt size (tokens per request)

Max input per request

Max requests per month

Max input tokens per month

Monthly output cap (as JSON object)

Concurrency limit per tier

Tool access level (none / basic / advanced / full)

SLA class per tier

Estimated total API cost to me per tier

Infrastructure overhead estimate per tier

Total cost to me per tier

Subscription price per tier

Raw profit per tier

Profit margin %

Break-even token usage per tier

Abuse-risk level per tier

Recommended overage policy per tier

Then:

Provide a short explanation of how the cost math was calculated.

Identify which tier is most profitable.

Identify which tier carries the most risk.

Suggest one optimization strategy to improve margins without hurting user value.

Suggest one pricing alternative based on value rather than tokens.

Assume realistic but conservative pricing numbers.
Round cleanly.
Show all calculations clearly.

Output the main table first.
Then analysis.
Keep it concise but strategic.

TABLE PROMPT END

I want to build a rich set of context to pass to the server as well in terms of mineflayer for surroundings, and inventory. Write a plan that includes the pricing considerations