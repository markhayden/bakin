# Plan — Model Cost Metering, Routing & Budget Gating

**Spec:** `.claude/specs/models-cost-optimization.md` (decisions D1–D9 locked).
**Build order:** Metering → Routing → Gating → Docs. Each task is one vertical slice that builds + tests green on its own and maps to one commit.

**Conventions:** `bun run test` (CI) / `bun test <file> --isolate` (single). Every storage test mocks both content-dir resolvers + OpenClaw home (CLAUDE.md). Never commit `generated-version.ts`. Conventional commits, co-author trailer.

---

## Dependency graph

```
P0.1 delete taskProfiles ─────────────────────────────────┐ (independent; do first to clear the surface)
                                                           │
P1.1 adapter surfaces usage ──┐                            │
P1.2 structured pricing ──────┼─→ P1.4 record cost+recorder ─→ P1.5 Spend view
P1.3 run_costs ledger table ──┘        │                                 │
                                       │  (CHECKPOINT A: metering live)  │
                                       ▼
P2.0 confirm gateway RPC fields (BLOCKS P2.2/P2.3)
P2.1 classifyOrigin + policy types + cascade ──┐
P2.2 adapter passes model/thinking ────────────┼─→ P2.3 apply routing in dispatch ─→ P2.4 Routing UI
                                                │        (CHECKPOINT B: routing live)
                                                ▼
P3.1 BudgetPolicy + spend-window verbs ─→ P3.2 gate in claimDispatchRun ─→ P3.3 budget health/dashboard
                                                        (CHECKPOINT C: gating live)
                                                        ▼
P4.1 docs + close #464
```

Layers 1 and 3 do **not** depend on P2.0 (the RPC unknown). If P2.0 fails, Phase 2 parks; Phases 1/3 still ship.

---

## Phase 0 — Prep

### P0.1 — Delete dead `taskProfiles` + `showUsageMetrics`
- **Files:** `plugins/models/types.ts` (drop `TaskProfile`, `showUsageMetrics`, `taskProfiles`), `plugins/models/index.ts` (delete `DEFAULT_TASK_PROFILES`, `TaskProfileSchema`, `TaskProfilesUpdateSchema`, both `/profiles` routes), `plugins/models/components/*` (remove profiles tab + nav entry), any test referencing profiles.
- **Acceptance:** `grep -ri taskprofile plugins/models` returns nothing; `GET/PUT /api/plugins/models/profiles` → 404; models page renders without the tab.
- **Verify:** `bun test tests/plugins/models* --isolate`; build the plugin.
- **Commit:** `chore(models): delete dead taskProfiles + showUsageMetrics`

---

## Phase 1 — Metering

### P1.1 — Adapter surfaces per-turn token usage on success
- **Files:** `packages/core/src/adapters/runtime/concepts.ts` (add `usage?: { input?: number; output?: number; total?: number; model?: string }` to `MessageResult`); `packages/adapter-openclaw/src/runtime.ts` (`runOpenClawAgentGateway` returns usage; `messaging.send` attaches it); `packages/adapter-openclaw/src/trajectory-forensics.ts` (extract the existing `usage` parse into a shared exported helper — **reuse, don't duplicate**).
- **Acceptance:** a successful turn whose trajectory has a `usage` block returns `MessageResult.usage` with matching numbers; a turn with no usage block returns `MessageResult` with `usage` omitted (never zero-filled).
- **Verify:** adapter unit test with a fixture trajectory containing `usage`, and one without. `bun test tests/adapter-openclaw* --isolate`.
- **Commit:** `feat(adapter-openclaw): surface turn token usage on success`

### P1.2 — Structured pricing on the catalog
- **Files:** `plugins/models/data/known-models.ts` — add `pricing?: { inputPer1M: number; outputPer1M: number; cachedReadPer1M?: number; pricingUpdatedAt: string }` to `KnownModel`; **remove** `costRange` field; add a `formatCostRange(pricing)` helper so the existing display string is derived. Populate pricing for the catalogued frontier models; leave unknowns without `pricing`.
- **Acceptance:** every entry that had a `costRange` now has structured `pricing`; `formatCostRange` reproduces an equivalent display string; uncatalogued model → no pricing.
- **Verify:** unit test `formatCostRange`; a `computeCostUsd(usage, pricing)` pure fn returns null when pricing absent. `bun test tests/plugins/models* --isolate`.
- **Commit:** `feat(models): structured pricing on catalog, derive display string`

### P1.3 — `run_costs` ledger table + spend query verbs
- **Files:** `packages/core/src/execution/ledger.ts` — add `MIGRATIONS` version 2 creating `run_costs(run_id PK, task_id, agent_id, provider, model, input_tokens, output_tokens, cost_usd_micros, occurred_at)` (all token/cost cols nullable); verbs `recordRunCost(input)` (first-write-wins on `run_id` PK, mirrors `recordCompletion`), `spendByAgent(sinceMs)`, `spendByModel(sinceMs)`, `spendTotal({agent?, sinceMs})`. `src/core/execution-ledger.ts` — re-export the new verbs.
- **Decision (plan-level):** add as **execution-module migration v2** (cost is a per-run settle-time fact keyed by run_id; co-located with run lifecycle). *Alt considered:* separate module for domain purity — rejected as over-separation for a row that's 1:1 with `runs`.
- **Acceptance:** `recordRunCost` twice with same `run_id` → one row (idempotent); `spend*` verbs sum micro-dollars correctly over a window; null-cost rows counted as tokens-only ("unmetered"); verbs throw `LedgerUnavailableError` when db unavailable.
- **Verify:** ledger unit test (real db in temp dir; `closeDb()` before `rmSync`). `bun test tests/core/*ledger* --isolate`.
- **Commit:** `feat(core): run_costs ledger table + spend query verbs`

### P1.4 — Record per-run cost on settle + feed the usage recorder
- **Files:** `src/core/usage.ts` (add `tokensIn?/tokensOut?/costUsdMicros?` to `UsageEntry`); `src/core/dispatch.ts` — `sendDispatchMessage` returns `MessageResult`; in `fireDispatchTurn`'s success `.then()`, after `settleRun`, call `recordRunCost({ runId: opts.threadId, taskId, agentId, ...usage, costUsdMicros: computeCostUsd(...) })` and populate the `kind:'agent'` recorder entry with tokens/cost. (`opts.threadId` IS the ledger run id.)
- **Acceptance:** one dispatched turn → exactly one `run_costs` row keyed by its run id with correct tokens and cost-from-pricing; uncatalogued model → tokens recorded, cost null; recorder dashboard shows tokens within the session. No double-write on retries (run_id PK).
- **Verify:** dispatch test with a mock runtime returning a known `usage`; assert the ledger row + recorder entry. `bun test tests/core/dispatch* --isolate`.
- **Commit:** `feat(core): record per-run cost on settle + feed usage recorder`

### P1.5 — Spend view + `/spend` route
- **Files:** `plugins/models/index.ts` (`defineRoute` `GET /spend?window=` → `{ total, byAgent, byModel }` from the spend verbs); `plugins/models/components/*` (Spend view: totals, by-agent, by-model, "estimated" caveat, "$ unavailable" for unmetered).
- **Acceptance:** route returns real ledger sums; UI labels spend "estimated"; unmetered turns shown as tokens-only.
- **Verify:** `callRoute` plugin test asserts shape; render check. `bun test tests/plugins/models* --isolate`.
- **Commit:** `feat(models): Spend view + /spend route`

> **CHECKPOINT A — Metering live.** Cost is durable + visible. Routing/gating inactive. Safe stopping point; revert reverts only metering.

---

## Phase 2 — Routing  *(P2.0 gates P2.2/P2.3)*

### P2.0 — Confirm gateway `agent` RPC field names (BLOCKING for 2.2/2.3)
- **Action:** inspect OpenClaw gateway agent handler or one probe `openclaw gateway call agent --params '{"agentId":"<mock>","message":"hi","model":"<id>","thinking":"low"}' --expect-final` against `dev:mock`/instance. Record the exact param keys in the spec §2.3.
- **Acceptance:** confirmed param names (expected `model`, `thinking`) written to spec. If unsupported → mark Phase 2 blocked, proceed to Phase 3.
- **Commit:** `chore: confirm OpenClaw gateway agent model/thinking RPC params` (doc-only).

### P2.1 — Origin classifier + policy types + cascade resolver
- **Files:** new `src/core/model-routing.ts` — `classifyOrigin(task, dispatchContext): Origin` (`scheduleJobId`→scheduled, `workflowId`→workflow, recovery-ladder→recovery, `parentId`→decomposition, else adhoc); `resolveTurnModel({task, agent, policies, tagOverrides, agentDefault, globalDefault}): { model?, thinking? }` implementing **tag → origin → per-agent → global** cascade; `plugins/models/types.ts` adds `RoutingPolicy`, `TagOverride` (replace deleted profile types).
- **Acceptance:** `classifyOrigin` truth table passes for each signal; cascade precedence proven (tag beats origin beats agent beats global); empty policies → `{}` (inherit = unchanged behavior).
- **Verify:** pure-fn unit tests, no I/O. `bun test tests/core/model-routing* --isolate`.
- **Commit:** `feat(core): origin classifier + routing policy types + cascade resolver`

### P2.2 — Adapter passes per-turn model/thinking *(needs P2.0)*
- **Files:** `concepts.ts` (`MessageArgs` += `model?`, `thinking?`); `runtime.ts` (`OpenClawAgentTurnOptions` += fields; set on gateway `agent` params using confirmed keys).
- **Acceptance:** when `MessageArgs.model/thinking` set, the gateway params include them (spy assertion); when omitted, params unchanged from today.
- **Verify:** adapter test spying on the RPC request payload. `bun test tests/adapter-openclaw* --isolate`.
- **Commit:** `feat(adapter-openclaw): pass per-turn model/thinking to gateway`

### P2.3 — Apply resolved routing in dispatch *(needs P2.1, P2.2)*
- **Files:** `src/core/dispatch.ts` — load policies (from models plugin settings via hook/getSettings), call `resolveTurnModel`, pass `model/thinking` into `sendDispatchMessage`; record resolved model/thinking on the `run_costs` row + audit (`task.dispatch` meta).
- **Acceptance:** scheduled task dispatches with the scheduled policy's model/thinking; adhoc-with-no-policy dispatches unchanged (agent default); resolved model appears in gateway call + audit + run_costs. **Regression guard:** all policies empty ⇒ byte-identical dispatch behavior.
- **Verify:** dispatch tests across origins + the empty-policy regression. `bun test tests/core/dispatch* --isolate`.
- **Commit:** `feat(core): apply resolved model/thinking routing in dispatch`

### P2.4 — Routing config UI
- **Files:** `plugins/models/index.ts` (`GET/PUT /routing` over settings); `plugins/models/components/*` (origins table with model + thinking selectors from discovered models; tag-override list; show catalog pricing per choice).
- **Acceptance:** edits persist to plugin settings; selectors populated from live models; pricing delta visible; saved policies take effect on next dispatch (no restart).
- **Verify:** `callRoute` persistence test; render. `bun test tests/plugins/models* --isolate`.
- **Commit:** `feat(models): routing config UI (origins + tag overrides)`

> **CHECKPOINT B — Routing live.** Optimization active; empty-policy = no-op (guarded).

---

## Phase 3 — Budget Gating (#464)

### P3.1 — BudgetPolicy settings + spend-window verbs
- **Files:** `plugins/models/types.ts` (`BudgetPolicy { global:{dailyUsd?,monthlyUsd?,warnPct}, perAgent:{[id]:{dailyUsd?,monthlyUsd?}} }`); reuse P1.3 `spendTotal`/`spendByAgent` with day + calendar-month windows (add `spendForWindows(agent?)` returning `{dayUsd, monthUsd}`).
- **Acceptance:** verbs return correct day + month sums for global and a given agent; unset caps treated as unlimited.
- **Verify:** ledger unit test across day/month boundaries. `bun test tests/core/*ledger* --isolate`.
- **Commit:** `feat(core): budget policy settings + spend-window summation`

### P3.2 — Warn + defer-with-audit in `claimDispatchRun`
- **Files:** `src/core/dispatch.ts` — before claiming, evaluate caps; ≥`warnPct` → audited `budget.warn` (once per window, debounced); ≥100% → **do not claim**, leave task claimable, emit typed audited `budget.deferred` (cap, window, spend, limit); back off until next window boundary (no per-tick thrash). **Fail-closed:** ledger-unavailable ⇒ defer.
- **Acceptance:** tiny daily cap → first over-cap claim defers with typed reason, task not lost, dispatches after simulated window reset; warn fires once not per-poll; ledger-unavailable defers; caps unset ⇒ no gating (regression).
- **Verify:** dispatch/gating tests incl. fail-closed + window-reset. `bun test tests/core/dispatch* --isolate`.
- **Commit:** `feat(core): budget warn + defer-with-audit in claimDispatchRun (fail-closed)`

### P3.3 — Budget health check + dashboard
- **Files:** `plugins/health/lib/system-checks/` (budget check: spend vs caps, deferred-run count, warn-threshold breaches); dashboard spend-vs-budget gauge + deferred-runs surface.
- **Acceptance:** health check reports ok/warn/fail vs caps; deferred runs visible with reason.
- **Verify:** health-check unit test. `bun test tests/plugins/health* --isolate`.
- **Commit:** `feat(health): budget health check + spend-vs-budget dashboard`

> **CHECKPOINT C — Gating live.** Spend ceiling enforced; runaway loop capped by $.

---

## Phase 4 — Docs

### P4.1 — Knowledge + issue closeout
- **Files:** update `.claude/knowledge/{models-plugin,usage-recording,dispatch,execution-ledger}.md`; note metering/routing/gating, the run_costs table, the cascade, the estimate caveat, fail-closed gating. README if model/cost surface is user-facing. Close #464 with a summary.
- **Acceptance:** docs match shipped behavior; no stale `taskProfiles`/`costRange` references; `grep` for removed symbols across `.claude/knowledge` is clean.
- **Commit:** `docs(knowledge): cost metering + routing + budget gating; close #464`

---

## Open plan-phase items (resolve as encountered)
1. **P2.0** gateway RPC field names — only true blocker; Phase 2 only.
2. Recovery/decomposition origin default = **inherit** (quality-protective), not budget — confirm in P2.1.
3. Spend surface: detail in Models (P1.5), summary gauge in Health (P3.3) — both, as planned.
4. `warnPct` default = 0.8; per-agent warn uses the same global `warnPct` (no separate per-agent threshold) unless requested.

## Test-coverage rollup (for /agent-skills:test)
Parser reuse · pricing math + null path · run_costs idempotency + spend windows · recorder fields · classifyOrigin truth table · cascade precedence · empty-policy regression (×2) · gateway-param spy · defer/warn/window-reset/fail-closed · route persistence · deleted-route 404.
