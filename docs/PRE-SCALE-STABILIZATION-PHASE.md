# Pre-Scale Stabilization Phase
## Minecraft AI Agent – Execution Order Plan

Purpose: Stabilize economics, reliability, and operational visibility before aggressive marketing or scale push.

---

## Phase 1: Persistent Economics & Usage Integrity (P0)

### 1. Persistent Usage & Margin Storage
- Move token metering from in-memory state to persistent storage (Firestore or Postgres).
- Store per-user monthly counters (input_tokens, output_tokens, requests).
- Store per-tier margin snapshots.
- Store cost per build.
- Store planner vs executor token split.
- Ensure restart-safe monthly rollovers.
- Add migration path for existing in-memory metrics.

Goal: Make economics real and restart-safe.

---

## Phase 2: Real-World Telemetry & Visibility (P0)

### 2. Production Usage Telemetry Dashboards
Add dashboards tracking:
- Avg tokens per build (planner vs executor)
- Avg context injection size
- Thick snapshot trigger frequency %
- Delta compression savings %
- Cap hit rate per tier
- Overage frequency
- Concurrency rejection rate
- Avg cost per active user
- Revenue vs cost per tier (live)

Goal: Replace theoretical unit economics with observed economics.

---

## Phase 3: Stress & Abuse Hardening (P0)

### 3. Load & Abuse Simulation
Simulate:
- 100+ concurrent users
- Max-cap users
- Rapid build loops
- Thick-snapshot spam attempts
- Command-block abuse attempts
- Overage abuse patterns

Measure:
- Latency spikes
- Queue depth
- Retry loops
- Token burn spikes
- Failure rates

Goal: Break the system before users do.

---

## Phase 4: Performance & Latency Profiling (P1)

### 4. Cold-Start & Latency Profiling
Measure:
- P50 / P95 / P99 latency
- Planner cold-start time
- Executor throughput
- Memory usage under concurrency
- Queue wait time by tier

Goal: Ensure interactive responsiveness under real usage.

---

## Phase 5: Conversion Instrumentation (P1)

### 5. Funnel & Upgrade Tracking
Instrument:
- Free → Lite conversion %
- Lite → Pro conversion %
- Pro → Server License conversion %
- Mega Build Pass purchase %
- Upgrade time-to-conversion
- Feature usage before upgrade

Goal: Understand monetization mechanics before scaling traffic.

---

## Phase 6: Server License Packaging Definition (P1)

### 6. Server License SKU Hardening
Define clearly:
- Multi-user rights
- Priority inference pool access
- Higher concurrency limits
- Shared build library access
- Persistent world memo features
- Automation/batch job unlocks
- Admin dashboard capabilities

Goal: Position Server License as infrastructure, not just a subscription.

---

## Phase 7: Marketing Amplification (P2)

### 7. Developer-Focused Marketing Site Upgrade
Add:
- Architecture diagram (planner/executor + compression + token governor)
- Tier comparison matrix
- Real build demo GIFs
- Live screenshots
- Server-owner landing page
- Clear AI authority ladder explanation

Goal: Market defensibility and engineering rigor, not just features.

---

## Strategic Framing

This phase transitions the product from:

“Feature complete”  
to  
“Scale ready.”

Do not add major new features during this phase.

Focus on:
- Economic stability
- Operational durability
- Signal clarity
- Monetization visibility
- Performance reliability

---

## Completion Criteria

Pre-scale stabilization is complete when:

- Economics persist across restarts
- Live telemetry validates margin assumptions
- System survives synthetic abuse testing
- Latency meets target thresholds
- Conversion funnel is measurable
- Server license positioning is clearly defined

Only then should large-scale marketing expansion begin.
