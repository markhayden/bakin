# Spec — Model Cost Metering, Routing & Budget Gating

**Status:** Recommendation / spec phase. No code in this session.
**Origin:** Issue #464 (`feat(core): cost/budget gating in dispatch`) — widened from "budget gating" to the full cost-optimization picture the issue under-describes.
**Supersedes:** the dead `taskProfiles` feature in the Models plugin (deleted, not migrated).
**Related:** `.claude/specs/execution-safety-ledger.md` §10.4, `.claude/knowledge/usage-recording.md`, `.claude/knowledge/models-plugin.md`, `.claude/knowledge/dispatch.md`, `.claude/knowledge/adapter-architecture.md`.

---

## 1. Objective

Give the single operator real, durable visibility into agent **spend**, and two levers to **reduce** it:

1. **Metering (foundation):** record actual token usage per agent turn, convert to dollars, persist it durably, and surface it live.
2. **Routing (highest-value optimization):** assign a model + thinking-level per *dispatch origin*, with a per-task tag override — so cheap task types run on cheap models/low thinking and only hard work pays frontier prices.
3. **Gating (safety net, issue #464):** consult per-agent and global budgets inside `claimDispatchRun`; warn at a threshold, defer-with-audit at the cap. A runaway re-dispatch loop is capped by spend, not only by claim logic.

**Build order: Metering → Routing → Gating.** Each layer ships and proves value independently. Routing and gating both consume the metering foundation.

**Out of scope:** invoice-exact billing reconciliation; provider-side discounts/commitments; cached-token precision (trajectory `usage` gives input/output/total only — see §6); cross-machine aggregation (single-user, single-host).

---

## 2. Audit — what exists today (ground truth)

### 2.1 Models plugin: implemented vs. decoration

| Area | State | Evidence |
|---|---|---|
| Model **discovery** (runtime `models list`) + 2-layer cache (memory + `~/.bakin/plugin-settings/models/available.json`) | **Real, wired** | `plugins/models/lib/models-cache.ts`; `.claude/knowledge/models-plugin.md` |
| Per-agent model + global default | **Real, wired** — flows to OpenClaw agent config | `AgentModelConfig.model`; `runtime.ts:354,365,409` (`--model`/config write) |
| Model aliases, curated catalog (39 entries), brand icons | **Real, wired** (display metadata) | `plugins/models/data/known-models.ts` |
| **`taskProfiles`** (`{taskType, recommendedModel, notes}`) | **Decoration** — full CRUD UI + settings persistence, read by *nothing* at dispatch | `plugins/models/types.ts:70`, `index.ts:325` (`DEFAULT_TASK_PROFILES`) |
| `costRange` (`'$3 in / $15 out per 1M'`) | **Decoration** — display string, hand-typed, never computed against | `known-models.ts` (`costRange?: string`) |
| `showUsageMetrics` setting | **Dead** — declared, never read | `plugins/models/types.ts:76` |
| Token / dollar tracking, aggregation | **Absent** | `src/core/usage.ts` `UsageEntry` has no token/cost field |

### 2.2 Three findings that reframe the original ask

1. **Heartbeats are not LLM turns.** `bakin_exec_heartbeat` (`scripts/lib/heartbeat.ts`) is an MCP tool the agent calls to write a JSON status file to `~/.bakin/heartbeats/{agent}.json`. **Zero inference.** "Cheaper model for heartbeats" is a category error — there is no model to make cheaper. The cost-bearing unit is an **agent turn** dispatched through the OpenClaw gateway. (The dead `DEFAULT_TASK_PROFILES` even pairs "Heartbeat check" → haiku, reinforcing the misconception.)

2. **Model is fixed per-agent, not per-turn.** A turn's model = the agent's configured `model.primary`. The adapter's turn path (`runOpenClawAgentGateway`, `runtime.ts:1218`), its `OpenClawAgentTurnOptions` (`runtime.ts:119`), and its public `MessageArgs` interface (`concepts.ts:63`) carry **no model field**. There is no per-dispatch override today.

3. **Token usage already exists but is discarded on success.** OpenClaw trajectory files record `usage: { input, output, total }` per run; `trajectory-forensics.ts:47,88-92` already parses it — but **only** on the death/diagnosis path. The happy-path turn returns just the content string and throws usage away. Metering is feasible without new OpenClaw work — we just stop discarding the data.

### 2.3 Capability verification (OpenClaw 2026.6.5)

- `openclaw agent --model <id>` → **"Model override for this run"** (per-turn). ✅
- `openclaw agent --thinking <off|minimal|low|medium|high|xhigh|adaptive|max>` → per-turn thinking knob. ✅
- The CLI `agent` command runs **via the Gateway** (`agent` is a gateway RPC method; `gateway call --expect-final` references it). Bakin uses the RPC, not the CLI.
- **VERIFIED (P2.0, OpenClaw 2026.6.5):** the gateway `agent` RPC accepts both `model` (string, `provider/model` id) and `thinking` (string level) as **top-level params**, alongside the `agentId`/`message`/`sessionId`/`idempotencyKey`/`deliver`/`timeout` params Bakin's adapter already sends. Source: `dist/agent-via-gateway-*.js` — the `callGateway({ method: 'agent', params: { message, agentId, model, …, thinking, … } })` call site. Routing is unblocked; the only fallback (mutating agent config per dispatch) is not needed and stays rejected.

### 2.4 Dispatch-time signals available for routing

`BakinTask` (`packages/core/src/tasks/store.ts:5`) carries deterministic origin signals known before dispatch:
`source: { pluginId, entityType, entityId, purpose }`, `scheduleJobId`, `workflowId`, `parentId` (decomposition subtask), `tags[]`, `agent`. No classification/LLM call is needed to route.

### 2.5 Ledger & usage recorder shape

- Execution ledger (`packages/core/src/execution/ledger.ts`): per-module migrations, `runs` table keyed by `run_id`, `claimRun`/`claimDispatchRun` is the dispatch gate. Already stores durable billed-image idempotency rows (precedent for storing billing facts).
- Usage recorder (`src/core/usage.ts`): in-memory, per-session, `globalThis`-backed. `UsageEntry` = `{ts, kind, name, agent, durationMs, status, meta}`. **No tokens, no cost.** CLAUDE.md: *never add a parallel stat-tracking system.*

---

## 3. Competitor analysis — Paperclip

Paperclip (open-source agent control plane) is the closest analog and is referenced directly in #464.

**Cost events** — `POST /cost-events`: `{ agentId, issueId?, provider, model, inputTokens, outputTokens, costCents, occurredAt }`. `costCents` is **pre-calculated by the agent/adapter** — pricing source is *not* specified (same gap we face; see §6).

**Budget policies** — three tiers via `budgetMonthlyCents`: company-level (e.g. `1_000_000` = $10k) and agent-level (e.g. `200_000` = $2k/mo); task-level tracked via `issueId` but **not enforced in V1**. **Monthly** window; auto-reset 1st of month 00:00 UTC; paused agents not auto-resumed.

**Enforcement** — 80% = soft (high-priority activity event, board notified, agent continues); 100% = hard (agent `status=paused`, scheduler **skips heartbeats**, cannot checkout tasks, queued work cancelled). The community calls it the "pre-paid debit card" model.

**Reporting** — `/costs/summary`, `/costs/by-agent`, `/costs/by-project` with utilization %.

**What paperclip does NOT do:** per-task **model routing**. It only meters + caps. Industry consensus (multiple 2026 sources) is that **model routing is the single highest-impact cost lever** — a typical distribution is ~70% budget-tier / 20% mid / 10% premium. **This is where Bakin can exceed paperclip.**

### 3.1 Where we deliberately diverge from paperclip

| Dimension | Paperclip | Bakin (this spec) | Why |
|---|---|---|---|
| Enforcement | Pause the **agent**, cancel queued work | **Defer the run** (task stays claimable, resumes on window reset / cap raise) | No lost work; spend throttles rather than the agent going dark. Conservative for a single-operator system. |
| Window | Monthly only | **Daily + monthly** (either unset) | Daily catches a runaway night fast; monthly matches the provider invoice. |
| Heartbeats | Cost-bearing scheduler activity | Free disk writes (§2.2.1) | Bakin's heartbeats consume no tokens — nothing to cap or route. |
| Optimization | Metering + caps only | Metering + caps **+ origin-based model/thinking routing** | Routing is the highest-value lever; gating alone only observes/limits. |

**Schema validation:** paperclip's cost-event fields map almost 1:1 to our planned per-run cost row (§5.1), confirming the shape.

---

## 4. Design — resolved decision tree

All decisions below are **locked** (operator-confirmed during the interview).

| # | Decision | Choice |
|---|---|---|
| D1 | This session's deliverable | Hardened spec only; no code |
| D2 | Build order | **Metering → Routing → Gating** |
| D3 | Routing key | **Dispatch origin + per-task tag override** (cascade in §5.2) |
| D4 | Cost storage | **Durable in ledger (keyed by run_id) + feed live usage recorder** |
| D5 | Routing controls | **Model + thinking-level** per policy |
| D6 | Gating caps | **Global + per-agent**, **daily + monthly** windows |
| D7 | Gating enforcement | **Warn threshold + defer-with-audit at cap; fail-closed** if ledger unavailable |
| D8 | Dead `taskProfiles` | **Delete entirely**; new routing UI replaces it |
| D9 | Pricing source | **Hand-maintained structured numbers** in `known-models.ts`; honest gap for uncatalogued models |

---

## 5. Layer specs

### 5.1 Layer 1 — Cost Metering (foundation)

**Goal:** every agent turn yields `{inputTokens, outputTokens, totalTokens, costUsd?}` attributed to `run_id → task → agent → model`, persisted durably and surfaced live.

**Data flow:**
1. **Surface usage from the adapter on success.** Extend `MessageResult` (`concepts.ts:74`) with an optional `usage?: { input?: number; output?: number; total?: number; model?: string }`. In `runOpenClawAgentGateway`, parse the same trajectory `usage` block the forensics path already reads (`trajectory-forensics.ts`) and attach it to the success result. Reuse the existing parser — do not duplicate it. When the trajectory has no usage block, omit `usage` (honest absence; never zero-fill).
2. **Price it.** New structured pricing on the catalog: `pricing?: { inputPer1M: number; outputPer1M: number; cachedReadPer1M?: number }` on `KnownModel`, **replacing** the `costRange` display string (render the string *from* the numbers). Cost = `input/1e6*inputPer1M + output/1e6*outputPer1M`. Models with no catalog pricing → `costUsd` omitted (UI shows tokens + "$ unavailable"). **Never fabricate** (existing plugin rule).
3. **Persist durably.** New ledger module/table keyed by `run_id`: `run_costs(run_id PK, task_id, agent_id, provider, model, input_tokens, output_tokens, cost_usd_micros?, occurred_at)`. Use the existing per-module migration mechanism. `cost_usd_micros` (integer micro-dollars) avoids float drift; null when pricing unknown. Written once per settled run (idempotent — `run_id` PK; first-write-wins, mirrors `recordCompletion`).
4. **Feed the live recorder.** Add optional `tokensIn?/tokensOut?/costUsdMicros?` to `UsageEntry` and populate on the `kind:'agent'` turn record in `dispatch.ts`. This is the *one* live feed — the ledger is the durable *billing fact*. Not parallel systems: recorder = ephemeral dashboard feed, ledger = durable coordination/billing fact (same split as billed-image idempotency rows).

**Reporting reads:** ledger query verbs `spendByAgent(window)`, `spendByModel(window)`, `spendTotal(window)` over `run_costs`. Surfaced in the Models plugin (new "Spend" view) and the health dashboard.

**Acceptance:**
- A dispatched turn writes exactly one `run_costs` row with correct token counts (verified against the trajectory `usage` block) and a `cost_usd_micros` matching the pricing formula.
- A turn whose trajectory lacks usage writes a row with null tokens/cost and is reported as "unmetered" — not zero.
- An uncatalogued model records tokens but null cost; UI shows "$ unavailable".
- Recorder dashboard shows per-turn tokens within the same session; ledger survives restart.

### 5.2 Layer 2 — Model + Thinking Routing

**Goal:** resolve `{model?, thinking?}` per turn from a Bakin-owned policy, pass per-turn to the gateway. Bakin owns *policy*; OpenClaw owns *serving* (clean adapter boundary).

**Policy model** (replaces `taskProfiles`; stored in models plugin settings):
```
RoutingPolicy {
  origin: 'scheduled' | 'workflow' | 'adhoc' | 'memory-cleanup' | 'recovery' | 'decomposition'
  model?: string            // omit = inherit
  thinking?: ThinkingLevel  // 'inherit' | off..max
}
TagOverride { tag: string; model?: string; thinking?: ThinkingLevel }
```
Origin enum derives from §2.4 signals (e.g. `scheduleJobId` → scheduled, `workflowId` → workflow, recovery-ladder re-dispatch → recovery, `parentId` → decomposition, else adhoc). A single `classifyOrigin(task, dispatchContext)` pure function owns the mapping.

**Resolution cascade** (first match wins): **tag override → origin policy → per-agent model (existing) → global default.** A turn with no matching policy behaves exactly as today.

**Adapter wiring:** add `model?` and `thinking?` to `MessageArgs` → thread through `OpenClawAgentTurnOptions` → set on the gateway `agent` params (pending §2.3 RPC-field confirmation). Resolved model/thinking recorded on the `run_costs` row and audit so spend is attributable to the routing decision.

**UI:** new routing config in the Models plugin (the slot vacated by the deleted profiles tab) — a table of origins with model + thinking selectors (populated from discovered models), plus a tag-override list. Each row optionally shows the catalog `pricing` so the operator sees the cost delta of a choice.

**Acceptance:**
- A scheduled task dispatches with the scheduled-policy model/thinking; an adhoc task with no policy dispatches unchanged (agent default).
- A tag override beats the origin policy for a tagged task.
- The resolved model appears in the gateway call, the audit event, and the `run_costs` row.
- Removing all policies = behaviorally identical to pre-change dispatch (regression guard).

### 5.3 Layer 3 — Budget Gating (issue #464)

**Goal:** cap spend inside the dispatch claim.

**Policy** (settings): `{ global: { dailyUsd?, monthlyUsd?, warnPct (default 0.8) }, perAgent: { [agentId]: { dailyUsd?, monthlyUsd? } } }`. Any cap unset = unlimited on that dimension.

**Enforcement in `claimDispatchRun`:**
1. Before claiming, sum `run_costs` for the relevant window(s) (`spendTotal`/`spendByAgent` over today and this calendar month) for the agent and globally.
2. ≥ `warnPct` of any applicable cap → emit an audited warning (`budget.warn`), continue.
3. ≥ 100% of any applicable cap → **defer**: do not claim; leave the task claimable; emit typed audited `budget.deferred` with which cap, the window, spend, and cap. The task resumes when the window rolls over or the cap is raised.
4. **Fail-closed:** if the ledger is unavailable, defer (consistent with existing ledger-unavailable policy).

**Surfacing:** doctor `budget` health check (spend vs caps, deferred-run count); dashboard spend-vs-budget gauge; deferred runs visible with reason.

**Acceptance:**
- With a tiny daily cap, the first over-cap claim defers with a typed audit reason; the task is not lost and dispatches after a simulated window reset.
- Warn fires once crossing `warnPct`, not repeatedly per poll (debounced/idempotent on window).
- Ledger-unavailable defers (fail-closed), proven by test.
- Caps unset = no gating (regression guard).

---

## 6. Trade-offs, risks, known limits

- **Cost is an estimate, not an invoice.** Trajectory `usage` is input/output/total; it does **not** break out cached-input tokens (Anthropic prompt caching ~0.1× input) or separate thinking tokens. Our cost will read *high* vs. the real bill when caching is active. Present everything as **"estimated spend"** with a one-line caveat. Acceptable: relative comparison and runaway detection don't need invoice precision.
- **Pricing staleness.** Hand-maintained pricing drifts as providers change prices. Mitigation: structured numbers + a `pricingUpdatedAt` per entry; honest "$ unavailable" for unknowns; doctor note if catalog pricing is older than N months. (No live pricing API assumed; OpenClaw exposes none.)
- **Routing can degrade quality.** A too-cheap model on a mis-classified "adhoc" task could fail work. Mitigation: cascade defaults to *current behavior* (inherit) — routing is opt-in per origin; recovery/decomposition origins should default to inherit or premium, never budget.
- **§2.3 RPC unknown is the one true blocker** for Layer 2. Resolve first in the plan phase. Layers 1 and 3 do not depend on it.
- **Defer vs. pause divergence from paperclip** means a deferred task could thrash the dispatch loop (claim → defer → reclaim). Mitigation: deferred runs back off until the next window boundary, not retried every tick.

---

## 7. Value

- **Visibility:** first real answer to "what are my agents costing me," by agent and model, durable across restarts.
- **Routing (highest ROI):** industry data puts 60–80% savings on the table by moving routine turns to budget models; even a conservative origin split (scheduled/cleanup → cheap, adhoc/recovery → capable) captures most of it on this single-operator system.
- **Gating:** converts the execution-safety story from "can't double-fire" to "can't runaway-*spend*" — a real $ ceiling on a bad loop, which claim-logic alone can't provide.

---

## 8. Project structure (touch map)

```
packages/core/src/adapters/runtime/concepts.ts   MessageResult.usage; MessageArgs.model/thinking
packages/adapter-openclaw/src/runtime.ts          surface usage on success; pass model/thinking to gateway params
packages/adapter-openclaw/src/trajectory-forensics.ts  reuse usage parser (extract shared helper if needed)
packages/core/src/execution/ledger.ts             run_costs table + migration + spend* query verbs
src/core/execution-ledger.ts                       app facade for new verbs
src/core/usage.ts                                  UsageEntry tokens/cost fields
src/core/dispatch.ts                               classifyOrigin + resolve routing + record cost + budget gate in claimDispatchRun
plugins/models/data/known-models.ts                pricing{} replaces costRange string
plugins/models/types.ts                            delete TaskProfile/showUsageMetrics; add RoutingPolicy/TagOverride/BudgetPolicy
plugins/models/index.ts                            delete /profiles routes; add /routing, /budgets, /spend routes
plugins/models/components/*                         delete profiles tab; add Routing + Spend views
plugins/health/lib/system-checks/                  budget health check
.claude/knowledge/{models-plugin,usage-recording,dispatch,execution-ledger}.md   doc updates
```

---

## 9. Commands

- Build: `bun run build` (⚠ mutates `generated-version.ts` — do not commit it).
- Full test: `bun run test`. Single file: `bun test tests/<path> --isolate`.
- Dev: `bun run dev:mock` (Imitation Crab) for UI; real adapter via `bun run instance dev`.
- Verify RPC (§2.3): `openclaw gateway call agent --params '{...,"model":"..."}' --expect-final` (build-phase probe, mock/instance only).

---

## 10. Testing strategy

Per CLAUDE.md testing rules (mock both content-dir resolvers + OpenClaw home; mock logger/watcher/AppServices; ledger tests `closeDb()` before `rmSync`; `--isolate`).

- **Metering:** unit-test the trajectory→usage parse reuse; pricing math (incl. unknown-model null path, micro-dollar rounding); `run_costs` idempotency (double-settle → one row); recorder field population. Mock the adapter to return a known `usage` block.
- **Routing:** `classifyOrigin` truth table over each signal; cascade precedence (tag > origin > agent > global); "no policy = unchanged dispatch" regression; assert resolved model reaches the gateway params (spy on the RPC call).
- **Gating:** over-cap defers with typed reason; warn-once; window-reset resumes; fail-closed on ledger-unavailable; caps-unset regression.
- **Plugin:** use `tests/plugins/test-helpers.ts` (`activatePlugin`, `callRoute`) for the new routes; assert deleted `/profiles` routes 404.

---

## 11. Boundaries

**Always:** keep provider details behind the adapter (Bakin passes `model`/`thinking`; the adapter maps to gateway params); one live stat system (usage recorder) + one durable billing store (ledger); honest gaps (never fabricate pricing/usage); fail-closed gating.

**Ask first:** changing enforcement from defer → pause; adding a live pricing API/network dependency; any cap default that is non-empty (caps must default to unset/unlimited).

**Never:** route a model for "heartbeats" (not LLM turns); add a parallel cost/stat tracker; mutate agent config per-dispatch to fake per-turn model (§2.3 fallback is rejected); zero-fill missing usage; commit `generated-version.ts`; touch `~/.bakin`/`~/.openclaw` from tests.

---

## 12. Phased roadmap + commit strategy

Natural rollback checkpoints. Each commit builds + passes tests on its own. Conventional-commit scopes in parens.

**Phase 0 — Prep (no behavior change)**
- C0.1 `chore(models): delete dead taskProfiles + showUsageMetrics (type, routes, UI, defaults)` — isolates the removal; easy revert.

**Phase 1 — Metering**
- C1.1 `feat(adapter-openclaw): surface turn token usage on success` (MessageResult.usage + trajectory parser reuse).
- C1.2 `feat(models): structured pricing on catalog, derive costRange` (known-models.ts).
- C1.3 `feat(core): run_costs ledger table + spend query verbs` (migration + verbs + facade).
- C1.4 `feat(core): record per-run cost on settle + feed usage recorder` (dispatch wiring; UsageEntry fields).
- C1.5 `feat(models): Spend view + /spend route` (reporting UI).
- *Checkpoint: cost is visible and durable. Routing/gating not yet active.*

**Phase 2 — Routing** (gated on §2.3 RPC confirmation — C2.0)
- C2.0 `chore: confirm OpenClaw gateway agent model/thinking RPC params` (verification note in spec; no code if confirmed via probe).
- C2.1 `feat(core): classifyOrigin + RoutingPolicy/TagOverride types + cascade resolver`.
- C2.2 `feat(adapter-openclaw): pass per-turn model/thinking to gateway` (MessageArgs fields → params).
- C2.3 `feat(core): apply resolved routing in dispatch + record on run_costs/audit`.
- C2.4 `feat(models): Routing config UI (origins + tag overrides)`.
- *Checkpoint: optimization live; remove all policies = no-op (regression-guarded).*

**Phase 3 — Gating (#464)**
- C3.1 `feat(core): BudgetPolicy settings + spend-window summation verbs`.
- C3.2 `feat(core): warn + defer-with-audit in claimDispatchRun (fail-closed)`.
- C3.3 `feat(health): budget health check + dashboard spend-vs-budget`.
- *Checkpoint: spend ceiling enforced.*

**Phase 4 — Docs**
- C4.1 `docs(knowledge): cost metering + routing + budget gating; update models-plugin/usage-recording/dispatch/execution-ledger; close #464`.

---

## 13. Open items to resolve in the plan phase

1. **§2.3 — confirm gateway `agent` RPC field names** for per-turn model/thinking (blocking for Phase 2 only).
2. Recovery/decomposition origin defaults — inherit vs. premium (quality-protective default).
3. Whether the Spend view lives in the Models plugin, the Health dashboard, or both (lean: summary in Health, detail in Models).
4. Exact `warnPct` default and whether per-agent caps need their own warn threshold.
