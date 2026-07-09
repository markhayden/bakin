# Plan: Cost Control v2 (#464 close-out)

Spec: `.claude/specs/cost-control-v2.md`. Branch: `feat/464-cost-control-v2` off `main`.
Every commit green on `bun run test` + `bun run typecheck`; UI-touching commits also `bun run build:plugins` (or full `bun run build` — never commit `generated-version.ts`). TDD (RED→GREEN) per task. `/verify` smoke at checkpoints B and E.

---

## §11 open items — RESOLVED against the codebase

1. **Auth-profile schema** — three shapes already normalized by `src/core/onboarding/credentials.ts:48-128` (bare array / `{profiles: []}` / `{profiles: {}}`); entries are `{provider, apiKey|api_key|token|access|refresh, label}` (crab fixture confirms). **Lane heuristic per (agent, provider) entry:** `apiKey`/`api_key` present → `metered`; only `token`/`access`/`refresh` → `subscription`; no entry → `metered` (conservative default). Detection lives in the **models plugin** behind a new `models.getBillingContext` hook; reads via the already-allowlisted `agents.<id>.authProfiles` raw-config key (`src/core/runtime-config-raw.ts:27`) with a new reason. Extract the shape-normalization out of credentials.ts into a shared helper (it already exports `_internals`). Manual per-(agent|provider) override in models settings wins over detection.
2. **Quota windows** — `openclaw` binary not reachable from Bakin's environment for a catalog probe and the adapter exposes zero quota surface. **DROPPED from this round** (spec's if-unavailable path). Not a blocker for anything.
3. **usage.db verbs** — existing rollups (`usageByAgentDaySince`) lack the model dimension. **Add `usageByAgentModelDaySince(sinceDay)`** (GROUP BY agent, day, model — table already stores `model`, `''` when unknown) in `packages/core/src/usage-history/store.ts`. Attributed counterpart: new ledger verb `runCostFacetsSince(sinceMs)` (per agent/day/provider/lane token+cost sums) beside `spendByAgent`.
4. **Legacy `{global, perAgent}` settings** — **one-shot migration at models-plugin `activate()`**: map to rules (`global` → one `scope:'global', lane:'metered'` rule; each `perAgent` entry → `scope:'agent'` metered rule), write back, delete the old key. No dual-read; the mapper + its test are the only trace.
5. **Pace projection** — server-side pure helper `paceProjection()` in `src/core/budget-spend.ts`, surfaced in `/spend` and `/budget/status` payloads. No client math.
6. **Poll cadence** — reuse the `use-gate-status` pattern: 15 s `setInterval` (`plugins/tasks/hooks/use-gate-status.ts:48`).
7. **Kill-switch banner** — `packages/host/src/components/layout/header.tsx`, driven by the same `/api/plugins/models/budget/status` poll (small host-side hook; SSE `budget.*` events trigger immediate refetch).
8. **Media-gate placement** — shared `gateBilledMediaCall()` exported from `src/core/agent-cost.ts` (the images plugin already imports `meterImageTurn` from there); called by `plugins/images/lib/tools.ts` before the provider call.
9. **Provider normalization** — catalog first (`getKnownModel` — ids are `provider/model`), else `normalizeModelId` + `providerFromId` (`plugins/models/lib/model-id.ts:18-25`), else `'other'`. Provider ids follow the models plugin's PROVIDERS table (note: `openai-codex` is a distinct provider id — useful for lane separation). usage.db bare model ids take the same path. Backfill of `run_costs.provider` in SQL for `model LIKE '%/%'` rows; the rest resolve at read time.

**Discovered ordering constraint (not in spec):** `deferForBudget` runs BEFORE routing resolution today (`dispatch-cycle.ts:211` vs `resolveDispatchRouting` inside the fire path). Provider-scoped rules need the turn's model at gate time → **move/duplicate `resolveDispatchRouting(task, isRecovery)` ahead of the budget gate** in all three paths and pass `{model?}` into the gate; when inherit, the gate resolves the agent's effective model via the existing `models.getEffectiveModel` hook. Resolution is pure/cheap (config lookup), safe to run pre-claim; the resolved value is reused for the fire (no double-resolve drift — pass it through).

---

## Dependency graph

```
T1 ledger columns+facets ─┬─→ T4 spend engine ─→ T5 consumers refactor ─→ CHECKPOINT A
T2 usage.db verb ─────────┤
T3 billing context (lanes)┘
T5 ─→ T6 rule policy + gate provider resolution ─→ T7 incidents table ─→ T8 gate opens incidents ─→ T9 pause-at-cap
T6 ─→ T10 kill switch (independent of T7–T9)
T8 ─→ T11 media gate            (CHECKPOINT B after T9–T11)
T8 ─→ T12 notify engine ─→ T13 browser notification
T6 ─→ T14 onboarding + nag      (CHECKPOINT C after T12–T14)
T5..T9 ─→ T15 routes ─→ T16 spend tab / T17 health+banner / T18 task badges / T19 CLI  (CHECKPOINT D)
all ─→ T20 docs (CHECKPOINT E: /verify + PR)
```

---

## Phase 1 — Spend engine: lanes, providers, total-observed basis

### T1 — `feat(core): run_costs provider + lane columns + cost facets verb`
- **Files:** `packages/core/src/execution/ledger.ts` (new MIGRATIONS entry: `ALTER TABLE run_costs ADD COLUMN provider TEXT; ADD COLUMN lane TEXT`; SQL backfill `provider = substr(model,1,instr(model,'/')-1)` where `model LIKE '%_/_%'`), `recordRunCost` gains provider/lane params; new verb `runCostFacetsSince(sinceMs): Array<{agent, day, provider, lane, tokens, costUsdMicros|null, runs}>`; `src/core/execution-ledger.ts` facade.
- **RED:** migration test (pre-existing v3 rows get provider backfilled, lane NULL); facet verb truth table; recordRunCost idempotency with new fields.
- **Accept:** old rows readable, new rows carry provider+lane, facets group correctly, `bun test tests/core/execution-ledger*.test.ts --isolate` green.

### T2 — `feat(core): usage-history per-model day rollup verb`
- **Files:** `packages/core/src/usage-history/store.ts` — `usageByAgentModelDaySince(sinceDay)`.
- **RED:** rollup test incl. `model: ''` bucket and NULL-cost groups.
- **Accept:** sums match `usageByAgentDaySince` when re-aggregated (cross-check test).

### T3 — `feat(models): billing context — lane detection + provider resolution`
- **Files:** extract auth-profile normalization from `src/core/onboarding/credentials.ts` into `src/core/runtime-auth-profiles.ts` (credentials.ts consumes it — no behavior change, its tests keep passing); `plugins/models/lib/billing.ts` (NEW): `detectLane(entry)`, `providerForModel(modelId)` (catalog → normalize → 'other'), settings override `billing.overrides: Record<agentId|'provider:<id>', lane>`; register `models.getBillingContext` hook (per-agent per-provider lanes + effective models); `src/core/agent-cost.ts` — `recordSpend`/`meterAgentTurn`/`meterImageTurn` resolve + persist provider/lane via the hook (absent plugin → provider from model id, lane `'metered'`).
- **RED:** detection truth table (apiKey→metered; token/access/refresh-only→subscription; absent→metered; override wins); provider resolution incl. bare ids and unknowns; recordSpend persists both.
- **Accept:** a metered and a subscription fixture agent produce differently-laned `run_costs` rows.

### T4 — `feat(core): assembleBudgetSpend — faceted total-observed spend engine`
- **Files:** `src/core/budget-spend.ts` (NEW): `assembleBudgetSpend(now)` → `{daily, monthly} × {global, byAgent, byProvider} × {metered: {usdMicros, tokens}, subscription: {tokens}, unpricedMeteredTokens}`; attributed from T1 facets; unattributed delta = `max(0, observed − attributed)` per (agent, day) from T2, provider via model→provider, lane via agent context, dollars only where runtime-reported; `paceProjection(spent, windowStartMs, windowEndMs, now)`; legacy 4-number summary emitter (temporary, for T5's unchanged evaluator — deleted in T6).
- **RED:** spec §8 truth table — NULL-cost contributes tokens not $, negative-delta clamp, day-alignment, month summation, lane separation (no $ ever computed for subscription facets).
- **Accept:** deterministic given injected clock + fixture rows.

### T5 — `refactor(core): gate + health check + /spend consume the shared engine`
- **Files:** `src/core/dispatch-turns.ts` (`budgetGate` reads engine's legacy summary; per-cycle `budgetSpendCache` becomes an engine-result memo), `plugins/health/lib/system-checks/budget.ts`, `plugins/models/lib/routes.ts` `/spend`.
- **RED first:** parity test — same fixture ⇒ gate, check, and route report identical spend.
- **Accept:** all existing budget/gate/spend tests pass unmodified in behavior (updated only for call shape); zero-unattributed fixtures produce identical numbers to pre-refactor (regression pin).

**CHECKPOINT A** — cap basis + lanes live under the old policy shape. Full suite green. Rollback = revert Phase 1 commits cleanly (no schema consumed outside ledger verbs).

## Phase 2 — Cap rules, incidents, enforcement modes

### T6 — `feat(core): BudgetRule policy + rule-based evaluator + gate provider resolution`
- **Files:** `src/core/budget.ts` rewrite (`BudgetRule`/`BudgetPolicy{rules}`, unit-per-lane evaluation, worst-breach selection, `'model'` scope accepted); delete the legacy summary emitter from T4; `plugins/models/` — settings one-shot migration at `activate()` (old shape → rules, write back, delete key), `route-schemas.ts` rule-list schema, `models.getBudgetPolicy` returns rules; dispatch paths — hoist `resolveDispatchRouting` above `deferForBudget` in `dispatch-cycle.ts` / `dispatch-single.ts` / `dispatch-workflow.ts`, thread resolved model into the gate and onward to the fire (single resolution), `models.getEffectiveModel` fallback inside the gate.
- **RED:** evaluator truth table (scope × lane × window × unit; metered USD vs subscription tokens; provider rule matches only matching-provider turns; empty rules allow; `'model'` scope tolerated); migration mapper; gate defers a Gemini-bound dispatch under an exhausted `provider:google` rule while an Anthropic dispatch proceeds.
- **Accept:** old-shape settings migrate once and are gone; no-rules behavior identical to today.

### T7 — `feat(core): budget_incidents ledger table + verbs`
- **Files:** ledger MIGRATIONS entry (spec §4.3 schema — `unit`/`cap_value`/`spent_value`, UNIQUE(scope, scope_id, lane, window, window_start_ms, kind)); verbs `openBudgetIncident` (INSERT OR IGNORE, returns opened|existing), `resolveBudgetIncident`, `listBudgetIncidents`; facade.
- **RED:** idempotent open across "restart" (fresh module state, same DB); resolve transitions; list filters.

### T8 — `feat(core): gate opens incidents; rollover auto-resolve; delete in-memory debounce`
- **Files:** `dispatch-turns.ts` — `auditBudgetOnce`/`budgetAuditedWindows` DELETED; warn/defer paths call `openBudgetIncident`, audit (`budget.warn`/`budget.deferred` + incident id) only when the open was fresh; lazy rollover sweep at gate time (open defer-mode incidents with `window_start_ms <` current window → `resolveBudgetIncident('window_rollover')`).
- **RED:** one incident + one audit per (rule, window) across restart; rollover resolves and re-breach opens a NEW incident for the new window.
- **Accept:** grep confirms `budgetAuditedWindows` is gone.

### T9 — `feat(core): atCap pause mode`
- **Files:** gate pre-check: open unresolved `kind='cap'` incident for a pause-mode rule blocks regardless of current spend/window; resolution paths (T7 verbs) unblock.
- **RED:** pause-mode blocks past simulated rollover until resolved; defer-mode regression (auto-resumes).

### T10 — `feat(core): dispatch kill switch`
- **Files:** `packages/core/src/settings.ts` `dispatch.paused` (default false); shared `dispatchPaused()` check at top of the three dispatch defer sites + exported for the media gate; `dispatch_paused` audit once per activation (in-ledger incident NOT used — a switch, not a breach; a module-level latch on the settings value transition is fine since re-audit on restart is harmless and honest).
- **RED:** all three paths defer when paused; settings round-trip; unpause resumes.

**CHECKPOINT B** — enforcement complete. Run `/verify`: isolated server, seed a tiny cap via `PUT /budget`, drive a dispatch, assert defer + incident row + audit. Rollback = revert T6–T10 (Phase 1 stands alone).

## Phase 3 — Media gating

### T11 — `feat(images): per-call billed-media gate with typed budget_exceeded error`
- **Files:** `src/core/agent-cost.ts` `gateBilledMediaCall({agent, model})` → `{allowed: true} | {allowed: false, error: {code, scope, scopeId?, lane, window, unit, capValue, spentValue}}` (kill switch → engine → evaluator, provider/lane from the image model); `plugins/images/lib/tools.ts` calls it before generate/edit billing (before idempotency row creation); incident open + audit on refusal.
- **RED:** exhausted `provider:google` metered rule → generate returns typed error, no provider call, no idempotency row; other providers unaffected; warn does not block; kill switch blocks with `dispatch_paused`.

## Phase 4 — Alerting + onboarding

### T12 — `feat(core): budget-notify — SSE event + main-agent relay on incident open`
- **Files:** `src/core/budget-notify.ts` (NEW): on fresh incident open (T8/T11 call it) → `broadcast` plugin-event `budget.incident_opened` (scope/lane/unit/values/window in payload; `_resolved` on resolution) + one `runtime.messaging.send` to the main agent (metered; failure logged, never blocks the gate).
- **RED:** one SSE + one message per fresh open; nothing on `existing`; nothing on resolve except the resolve event.

### T13 — `feat(host): browser notification for budget incidents`
- **Files:** `src/hooks/use-sse.ts` — `budget.incident_opened` → `sendBrowserNotification('Budget alert', <human reason>)` (mirrors the `workflow.gate_reached` block at line ~119); synthesize audit/activity entries like workflow events.
- **Verify:** unit test on the handler mapping; manual check in `bun run dev:mock`.

### T14 — `feat(core): onboarding budget component + unset-budget doctor notice`
- **Files:** `src/core/onboarding/budget.ts` (NEW; `check()` = ≥1 rule via models settings; `install()` = interactive prompt building a global metered rule; `--yes` skips with warning) appended to `COMPONENT_ORDER` after `llmComponent`; `plugins/health/lib/system-checks/budget.ts` notice-level "Spend is uncapped" row when no rules.
- **RED:** component check/install truth table; notice appears with zero rules, clears with one.

**CHECKPOINT C** — a fresh install cannot end up silently uncapped; breaches reach the operator. Suite + typecheck green.

## Phase 5 — Surfaces

### T15 — `feat(models): budget/status + incidents routes; rule-list PUT`
- **Files:** `plugins/models/lib/{routes,route-schemas}.ts` — `PUT /budget` (full rule list, zod), `GET /budget/status` (`{paused, perAgent, deferredProviders, openIncidents, pace}` from engine), `GET /budget/incidents`, `POST /budget/incidents/:id/resolve` (`raise` validates new cap > spent in the rule's unit; `ack`); `/spend` gains lane/provider facets + pace.
- **RED:** route tests via `tests/plugins/test-helpers.ts` incl. the perAgent-drop regression (full list round-trips) and raise-validation failure path.

### T16 — `feat(models): Spend tab — lane split, utilization, pace, rule editor, incident banner`
- **Files:** `plugins/models/components/spend-tab.tsx` (+ `use-models-data.ts` full-policy save). Per spec §4.9: lane-split tables (subscription rows tokens-only), per-rule utilization bars in the rule's unit, pace line, rule editor (scope/lane/window/warnPct/atCap), incident banner with resolve actions, cap-window-aligned utilization regardless of browse window, unattributed coverage note.
- **Verify:** component tests for save round-trip + unit labeling; visual pass in `dev:mock`.

### T17 — `feat(health): rule-aware check + attention chips + spend card + kill-switch banner`
- **Files:** `plugins/health/lib/system-checks/budget.ts` (evaluate every rule with faceted spend; attach `data.rules` + `data.agents`; kill-switch state), `plugins/health/components/supervision-sections.tsx` (chip kind `'budget'` in `deriveAttentionChips`), health spend card utilization/pace, `packages/host/src/components/layout/header.tsx` + small status hook — persistent "Dispatch paused" banner.
- **RED:** check emits structured rows (never message-parsing); chip derivation; banner renders on `paused: true`.

### T18 — `feat(tasks): budget-deferred task badges`
- **Files:** `plugins/tasks/hooks/use-budget-status.ts` (NEW, 15 s poll of `/budget/status`), badge on `task-card.tsx` for todo tasks whose agent (or global/provider state) is deferred, reason + resume line in `task-detail-dialog.tsx`.
- **RED:** hook + badge rendering tests with mocked status.

### T19 — `feat(cli): bakin spend + bakin budget command group`
- **Files:** `src/cli/commands/budget.ts` (NEW; spec §4.9 surface — `spend`, `budget show|set|rm|pause|resume|incidents`), wiring in `cli/bakin.ts`, help entries in `src/core/cli/registry.ts`. Unit echoed per lane; `process.exit` convention.
- **RED:** command tests against a mocked server (exit codes, unit rendering).

**CHECKPOINT D** — every surface live. Full suite + `bun run build` green (revert `generated-version.ts`).

## Phase 6 — Docs + close-out

### T20 — `docs(knowledge): cost-control v2 across knowledge docs + CLAUDE.md`
- **Files:** `.claude/knowledge/models-plugin.md` (lanes, rules, billing context, incidents UX), `execution-ledger.md` (run_costs columns, budget_incidents), `usage-recording.md` (engine consumes usage.db for unattributed gating), `dispatch.md` (gate order: routing → budget → claim; kill switch), `doctor-and-health-checks.md` (budget check semantics + notice), `agent-health-diagnostics.md` (burn vs budget relationship), `tasks-plugin.md` (deferred badges); CLAUDE.md Key Patterns budget line; spec status → IMPLEMENTED (+ as-built addendum if deviations); README checked for spend/budget claims; `tasks/{plan,todo}-cost-control-v2.md` marked complete.
- **PR:** `feat(core,models,health,tasks,cli): cost control v2 — lanes, provider caps, incidents, kill switch (#464)` with `Closes #464`.

**CHECKPOINT E** — `/verify` full pass (isolated boot: onboard-skip warning, set rules via CLI against the isolated server, breach → incident → status → resolve). PR up.

---

## Rollback strategy

Phases are strictly ordered rollback units; within a phase each task is one revertable commit. Ledger migrations are additive (new columns/table) — a revert leaves harmless unused columns, never breaks old code paths. The only destructive change is T6's settings migration; its mapper is pure and tested, and the pre-migration settings shape survives in git history + `~/.bakin` file backups are the operator's norm. The in-memory debounce deletion (T8) is behavior-replacing, not data-destructive.

## Risks

- **T6 is the widest commit** (evaluator + schema + migration + gate reorder). Mitigation: the gate reorder lands behind identical no-rules behavior, pinned by regression tests before the refactor starts (write pins in T5).
- **Unattributed gating surprises** ("why am I capped? I ran two tasks") — mitigated in-product by the Spend tab coverage note (T16) and the incident payload carrying lane/source split (T7/T12).
- **Auth-profile heuristic wrong for exotic setups** → manual override (T3) is the escape hatch; detection failure defaults to `metered` (over-protective, never under).
- **happy-dom fetch** — any test doing real HTTP uses `Bun.fetch` (repo rule); CLI tests mock at the http-client layer instead.
