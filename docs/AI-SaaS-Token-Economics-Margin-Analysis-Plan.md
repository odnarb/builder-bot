
# AI SaaS Token Economics & Margin Analysis
## Minecraft AI Agent with World-Context Injection

---

## Assumptions

- Model class: Mini-tier scaled models
- Input cost: $0.30 per 1M tokens
- Output cost: $0.60 per 1M tokens
- Avg output ratio: 60% of input
- All tiers modeled at full monthly cap usage (worst-case margin scenario)
- Server-side world-context injection per request
- Context includes:
  - Identity
  - Feature flags
  - Billing state
  - RAG snippets
  - SLA rules
  - Usage counters
- All context passes through a formal Compression + Token Governor layer

---

# Token Economics & Margin Table

| Tier | Model | Input $/1M | Output $/1M | Avg Context Inject (tokens, compressed) | Avg User Prompt (tokens) | Max Input / Req | Max Req / Mo | Max Input / Mo | Monthly Output Cap (JSON) | Concurrency | Tools | SLA | API Cost | Infra Cost | Total Cost | Price | Raw Profit | Margin % | Break-Even Input (M tokens) | Abuse Risk | Overage Policy |
|------|--------|------------|-------------|------------------------------------------|--------------------------|----------------|--------------|----------------|---------------------------|------------|--------|------|----------|------------|-----------|-------|------------|----------|-----------------------------|------------|----------------|
| Free | mini-low | 0.30 | 0.60 | 700 | 300 | 4k | 100 | 0.2M | {"max_output_tokens":120000} | 1 | none | best-effort | $0.13 | $0.05 | $0.18 | $0 | -$0.18 | — | N/A | High | Hard cap |
| Starter | mini | 0.30 | 0.60 | 800 | 400 | 8k | 1,000 | 1M | {"max_output_tokens":600000} | 2 | basic | 99% | $0.66 | $0.30 | $0.96 | $4.99 | $4.03 | 81% | 5.3M | Medium | $0.002 / 1k |
| Pro | mini-high | 0.30 | 0.60 | 1,000 | 600 | 16k | 5,000 | 5M | {"max_output_tokens":3000000} | 4 | advanced | 99.5% | $3.30 | $1.20 | $4.50 | $9.99 | $5.49 | 55% | 11.1M | Medium | $0.0025 / 1k |
| Admin | mini-high+tools | 0.30 | 0.60 | 1,500 | 800 | 32k | 15,000 | 15M | {"max_output_tokens":9000000} | 8 | full | 99.9% | $9.90 | $3.00 | $12.90 | $19.99 | $7.09 | 35% | 21.2M | High | Metered overage |

---

# Context Compression Architecture

## Context Pipeline

Mineflayer State
→ ContextBuilder
→ Compression Layer
→ Tier Gate
→ Token Estimator
→ OpenAI API

---

## Compression Strategies

### Deterministic Compression

- Inventory summarized (top stacks + tool durability)
- Entities limited to top-K by relevance
- No raw chunk serialization
- Replace block matrices with environmental features
- Quantize floats
- Remove null/default fields
- Canonical key ordering

### Delta Encoding

Only send changes since last request to reduce repetition.

### Thin Snapshot (Default)

- Position
- Health/hunger
- Compact inventory summary
- Nearby entity summary
- Task state
- Short diff

Target: ≤ 1,200 tokens

### Thick Snapshot (Paid tiers)

Triggered by pathfinding failures, combat, builds, or explicit queries.
Includes expanded block features and deeper entity detail.

### World Memo Cache

Compressed persistent summary refreshed every 30–120 seconds.

---

# Minecraft-Specific Risk Controls

High burn sources:

- LLM-driven micro-movement
- Repeated planning loops
- Large-radius scans
- Raw NBT serialization
- Excessive concurrency

Mitigation:

- Mineflayer handles deterministic movement
- LLM handles high-level planning
- Batch decisions
- Cache results aggressively
- Enforce per-tier scan limits

---

# Strategic Tier Positioning

Free → Acquisition funnel
Starter → Profit engine
Pro → Scale tier
Admin → Authority tier

Starter is the backbone.
Admin must be tightly governed.
