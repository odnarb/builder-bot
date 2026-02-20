# AI SaaS Token Economics & Margin Analysis
## Minecraft AI Agent with World-Context Injection

---

## Assumptions

- Model class: Mini-tier scaled models
- Input cost: **$0.30 per 1M tokens**
- Output cost: **$0.60 per 1M tokens**
- Avg output ratio: **60% of input**
- All tiers modeled at full monthly cap usage (worst-case margin scenario)
- Server-side world-context injection per request
- Context includes:
  - Identity
  - Feature flags
  - Billing state
  - RAG snippets
  - SLA rules
  - Usage counters

---

# Token Economics & Margin Table

| Tier | Model | Input $/1M | Output $/1M | Avg Context Inject (tokens) | Avg User Prompt (tokens) | Max Input / Req | Max Req / Mo | Max Input / Mo | Monthly Output Cap (JSON) | Concurrency | Tools | SLA | API Cost | Infra Cost | Total Cost | Price | Raw Profit | Margin % | Break-Even Input (M tokens) | Abuse Risk | Overage Policy |
|------|--------|------------|-------------|-----------------------------|--------------------------|----------------|--------------|----------------|---------------------------|------------|--------|------|----------|------------|-----------|-------|------------|----------|-----------------------------|------------|----------------|
| Free | mini-low | 0.30 | 0.60 | 700 | 300 | 4k | 100 | 0.2M | {"max_output_tokens":120000} | 1 | none | best-effort | $0.13 | $0.05 | $0.18 | $0 | -$0.18 | — | N/A | High | Hard cap |
| Starter | mini | 0.30 | 0.60 | 800 | 400 | 8k | 1,000 | 1M | {"max_output_tokens":600000} | 2 | basic | 99% | $0.66 | $0.30 | $0.96 | $4.99 | $4.03 | 81% | 5.3M | Medium | $0.002 / 1k |
| Pro | mini-high | 0.30 | 0.60 | 1,000 | 600 | 16k | 5,000 | 5M | {"max_output_tokens":3000000} | 4 | advanced | 99.5% | $3.30 | $1.20 | $4.50 | $9.99 | $5.49 | 55% | 11.1M | Medium | $0.0025 / 1k |
| Admin | mini-high+tools | 0.30 | 0.60 | 1,500 | 800 | 32k | 15,000 | 15M | {"max_output_tokens":9000000} | 8 | full | 99.9% | $9.90 | $3.00 | $12.90 | $19.99 | $7.09 | 35% | 21.2M | High | Metered overage |

---

# Cost Calculation Method

Formula per tier:

Input Cost = (Max Input Tokens ÷ 1,000,000) × $0.30  
Output Cost = (Output Cap ÷ 1,000,000) × $0.60  
API Cost = Input Cost + Output Cost  
Total Cost = API Cost + Infrastructure Cost  

Example (Starter):

- Input: 1M × $0.30 = $0.30  
- Output: 0.6M × $0.60 = $0.36  
- API Cost = $0.66  
- Infrastructure = $0.30  
- Total Cost = $0.96  
- Profit = $4.99 − $0.96 = $4.03  
- Margin = 81%

---

# Profitability Insights

## Most Profitable Tier

**Starter (81% margin)**

- Strong balance of value and limits
- Low abuse exposure
- Ideal volume tier

This should be the primary growth engine.

---

## Highest Risk Tier

**Admin**

Risk factors:

- High concurrency
- Full tool access
- Larger context injection
- 15M input token cap
- Only 35% margin

Admin can become margin-negative under heavy automation workloads.

---

# Where Profit Is Too Low

### Admin Tier (35% margin)

Recommended adjustments:

1. Increase price to $24.99  
2. Reduce input cap to 12M  
3. Charge aggressive overages  
4. Limit tool concurrency  
5. Implement compute-weighted pricing for large scans  

---

# Minecraft-Specific Risk Considerations

High token burn scenarios:

- Large-radius block scans
- LLM-driven micro-movement
- Frequent planning loops
- Full chunk serialization
- Deep NBT injection

Mitigation strategy:

- Batch movement decisions
- Summarize surroundings
- Cache RAG results
- Gate deep scans to paid tiers

---

# Optimization Strategy (Without Reducing User Value)

Move micro-decisions out of the LLM.

Let:

- Mineflayer handle deterministic movement
- LLM handle high-level planning only

This reduces token burn by 3–10x without degrading experience.

---

# Alternative Value-Based Pricing Model

Instead of pricing by tokens, price by AI authority level:

Free → AI suggestions only  
Starter → AI planning + small builds  
Pro → AI autonomous builds  
Admin → Full automation + batch jobs  

Users think in power, not tokens.

Value-based pricing increases perceived value while maintaining cost control.

---

# Long-Term Scaling Notes

If scaling to 10k+ users, you will need:

- Dynamic token throttling
- Abuse scoring
- Real-time margin monitoring
- Context compression tiers
- Token governor middleware
- Automated cap enforcement

---

# Strategic Tier Positioning

Free → Acquisition funnel  
Starter → Profit engine  
Pro → Scale tier  
Admin → Authority tier  

Starter is the economic backbone.  
Admin must be tightly controlled.

---