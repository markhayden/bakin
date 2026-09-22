# Plan: Models & Spend Overhaul (v2)

Spec: `.claude/specs/models-and-spend-overhaul.md` (v3.1). Three PRs, in order: **PR 1 trust foundation → PR 2 Spend → PR 3 Models**. Branches in the MAIN checkout (`feat/907-model-trust`, `feat/spend-plugin`, `feat/models-plan-page`) so 3737 serves them; Mark live-tests the final tip of each before merge (`test-live-before-merge`).

**Every commit:** `bun run lint && bun run typecheck && bun run test` green; docs matching code; **the system works end-to-end at that commit** (no intermediate dual policy stores, no dangling callers). UI commits add `bun run ui:conformance --quick`; merge-ready tips add `--full` + the plugin UI fixture. TDD per task. Never commit `generated-version.ts`. Kill any dev server you started before ending a turn.

Sizes: S = 1–2 files, M = 3–5, L = 6–8 (an L is listed with its sub-steps; sub-steps land as separate commits when each is independently green, otherwise as one commit — stated per task). **One explicit exception:** T2.7, the ownership cutover, touches ~20 files by necessity (D26 forbids intermediate commits with two writable policy stores). It is labelled XL-cutover, pre-staged by the behaviour-neutral moves in T2.5 so the diff is mostly wiring, and reviewed as a unit.

---

## §11 open questions — RESOLVED against the codebase

1. **Pi "cached roster" (#907 item 5)** — no cache in code; rig verification T1.11 precedes the dirty-marker deletion in T1.12.
2. **Vision/tool metadata** — only the `input` modality string exists on both adapters; vision = `inputs.includes('image')`; no tool-calling metadata ⇒ the agent lane has no hard requirement.
3. **Per-day scan receipts** — none exist. `scan_days` in usage.db **APPROVED 2026-09-21** (necessary: existing data cannot tell "zero usage" from "not observed"). Migration lives in `packages/core/src/usage-history/store.ts`; written by `scanUsageHistory` only on `coverage.status === 'complete'`; pruned to 90 days.
4. **`ModelSelectOption` contract change** — approval checkpoint T3.1.
5. **Bits consumers** — T2.1 (first task of PR 2) greps `../bakin-bits-official`.

**Constraints discovered (drive the task shape):**
- `deferForBudget` has FIVE callers (`dispatch-cycle.ts:238`, `dispatch-single.ts:189`, `dispatch-workflow.ts:161`, `dispatch-team.ts:251`, and `media-gate.ts` via `budgetGate`); its boolean return is replaced by `preDispatchGate() → { hold }` and every caller updated in the same commit.
- `/budget/status` returns `perTask: {}` when no rules exist ⇒ model holds get their own models-owned endpoint `GET /api/plugins/models/holds`.
- New `BudgetDecision` causes touch four switch sites: `dispatch-turns.ts:298-302`, `media-gate.ts:50/69`, `budget-routes.ts:79`, `system-checks/budget.ts:480+`.
- `writePluginSettings` is non-atomic — hardened first (T2.2).
- The usage scanner timer is health-owned; the observer is called from core after a successful scan.
- Team writes models only via `agents.create({model})` on create and via `agent-detail.tsx` → `models/config`.
- A 14th core plugin = `core-plugin-ids.ts`, `plugin-static-imports.ts` ×3, `bakin.config.ts`, `verify-plugin-conformance.ts` enrollment, `routes/spend.tsx`, `router.ts`, `route-shadow.ts`, `nav-placement.ts` `OFFICIAL_ORDER.operations`, `ui:census:generate --core-only`.
- Onboarding component add = `COMPONENT_ORDER` + `ONBOARDING_VERSION` bump.
- Ledger head is v9 ⇒ v10 holds `budget_milestones` + the three additive incident columns.
- Conformance knobs default to `'absent'`; each adapter's runner flips to `'present'` in the adapter's own commit, so T1.1 is green before adapters implement.

---

## Dependency graph (edges = "must land before")

```
PR 1
T1.1 contract+mocks+pins(absent) ─┬─ T1.2 Pi (present) ──┐
                                  └─ T1.3 OpenClaw (present) ─┴─ T1.4 eligibility engine
T1.4 ─ T1.5 /available + suffix options (models+team pickers)
T1.4 ─ T1.6 selections/revision/proposals + same-id helper
T1.6 ─ T1.7 mutate (tri-state, per-document reservations, reconcile) + GET/POST /selections + bakin models restore   [no deletions yet]
T1.7 ─ T1.8 repoint ALL writers (use-models-data, team agent-detail, team create validation) + DELETE old write routes   [PoNR]
T1.7 ─ T1.9 dead-selections check + repair
T1.4 ─ T1.10 preDispatchGate (5 callers) + effective selection + /holds + task-card signal + error translation
T1.7 ─ T1.11 rig verify (no code)
T1.11 ─ T1.12 pending-restart state + restartAdvice banner + delete dirty markers (models+team)
T1.6 ─ T1.13 runtime-switch reconcile-selections + epoch-guarded cache reset
all ─ T1.14 docs → CHECKPOINT A

PR 2
T2.1 bits grep (gate) ─ T2.2 atomic settings write ─ T2.3 catalog data → core
T2.3 ─ T2.4 plugin scaffold (server-only page shell, no writes)
T2.4 ─ T2.5 pure moves into spend/lib (billing, budget routes, schemas, health check, overview+breakdown components) — Models still owns hooks & routes
T2.5 ─ T2.6 ledger v10 (milestones + incident columns + reopen set) + evaluateBudget.crossed + warn-incident removal   [consumers updated in same commit]
T2.6 ─ T2.7 CUTOVER: upgrade + spend hooks + fail-closed cause + health-owned policy check + PUT/GET /limits + Limits list + delete Models budget/spend routes+UI + repoint every caller + CLI endpoints   [PoNR, one commit]
T2.7 ─ T2.9 scan_days receipts + coverage + limit dialog + suggestion
T2.9 ─ T2.8 Overview tab live at /spend (pace line with observed-days basis)
T2.7 ─ T2.10 spend observer + deliverPending (both tables) + hook points
T2.10 ─ T2.11 ladder: badge provider, header banners (computed offsets), status milestones, Resume rule
T2.7 ─ T2.12 remove nags (health policy-missing, onboarding note, CLI lines) + CLI flags
T2.11,T2.9 ─ T2.13 spend UI fixture enrollment → conformant
all ─ T2.14 docs → CHECKPOINT B

PR 3
T3.1 D23 approval → sdk contract (or documented fallback)
T3.1 ─ T3.2 recommender + GET /plan + bakin models plan
T3.2 ─ T3.3 onboarding models step
T3.2 ─ T3.4 page shell + mode + catalog panel + ?ref + pending chips
T3.4 ─ T3.5 draft/op model + one SaveBar + partial-failure UI (shared state, built FIRST)
T3.5 ─ T3.6 Simple view (lanes, Mixed, customizations, recommended-plan diff, perTurnModel notice)
T3.6 ─ T3.7 Reset (buildResetOps, dialog, snapshot, --restore)
T3.5 ─ T3.8 Advanced sections (support-gated)
T3.5 ─ T3.9 selection callouts
T3.2 ─ T3.10 Team shared options hook + catalog_changed
T3.6,T3.7,T3.8,T3.9 ─ T3.11 deletions   [PoNR]
all ─ T3.12 docs → CHECKPOINT C
```

**Parallel-safe (disjoint files AND contracts):** PR 1 — T1.2 ∥ T1.3; T1.9 ∥ T1.10 ∥ T1.13 (after T1.7/T1.6). PR 2 — T2.9 ∥ T2.10 ∥ T2.12 after T2.7 (T2.8 after T2.9; T2.11 after T2.10). PR 3 — T3.3 ∥ T3.4 after T3.2; T3.8 ∥ T3.9 ∥ T3.10 after T3.5. Everything else is sequential.

---

# PR 1 — `feat(models): trust foundation for model selection (#907, #378 slice)`

Branch `feat/907-model-trust`.

## T1.1 — `feat(runtime): three optional contract members + mocks + conformance pins` (M)
- Files: `packages/core/src/adapters/runtime/concepts.ts` (`RuntimeAvailableModel.unavailableReason?`; `credentials?: { providers() }` after `credentialStatus` :932; `restartAdvice?()` after `restart()` :771 — all optional, `channels?`-style docs), `packages/core/src/adapters/runtime/testing.ts` (`mockCredentials()`, `mockRestartAdvice()` beside `mockChannels` :15; default mock omits both), `tests/integration/runtime-conformance/conformance.ts` (pins copied from `cronMemberMatchesDeclaration` :159 + secret-field check; knobs in `RuntimeConformanceSuiteOptions` :112 defaulting `undefined` = don't check), three runners set `'absent'`, `teeth.conformance.test.ts` (throwing-stub + secret-leak liars), `tests/architecture/provider-inventory-shape.test.ts` (bans `apiKey|token|secret|key` fields).
- Acceptance: suite green on all three runners with `'absent'`; teeth prove both pins bite.
- Verify: `bun test tests/integration/runtime-conformance tests/architecture --isolate`.

## T1.2 — `feat(adapter-pi): unavailableReason, credentials.providers, restartAdvice` (S)
- Files: `packages/adapter-pi/src/models.ts:99` (+`unavailableReason:'no_credentials'`), `packages/adapter-pi/src/runtime.ts` (providers from registry × `hasConfiguredAuth`, `evidence:'complete'`; `restartAdvice` ⇒ `{needed:false}`), `pi.conformance.test.ts` → `'present'`.
- Verify: `bun test packages/adapter-pi tests/integration/runtime-conformance/pi.conformance.test.ts --isolate`.

## T1.3 — `feat(adapter-openclaw): credentials.providers (partial-evidence honest), restartAdvice` (S)
- Files: `packages/adapter-openclaw/src/runtime.ts:1141-1170` (extract `resolveLlmCredentials() → { creds, cliFailed }`; `providers()` sets `evidence:'partial'` on `cliFailed`; `restartAdvice`: `'model-config'|'roster'` ⇒ needed with gateway action; `'routing-policy'` ⇒ decided by inspecting whether the gateway re-reads `agents.defaults.model.*` live — record the answer in spec §11 Q2), `openclaw.conformance.test.ts` → `'present'`.
- Acceptance: CLI forced to throw + one JSON provider ⇒ that provider + `partial`; `credentialStatus()` unchanged.
- Verify: `bun test packages/adapter-openclaw tests/integration/runtime-conformance/openclaw.conformance.test.ts --isolate`.

## T1.4 — `feat(core): model eligibility engine` (S)
- Files: NEW `src/core/model-eligibility.ts`, NEW `tests/core/model-eligibility.test.ts`.
- Acceptance truth table (spec §3.1): Pi auth-false ⇒ `no_credentials`; runtime false w/o reason ⇒ `runtime_unavailable`; provider absent + complete ⇒ `no_credentials`; partial + absent ⇒ `unknown`; known rejection + credentials failed ⇒ `account_rejected`; `authFree` ⇒ eligible; `credentials` member missing ⇒ evidence `failed`, models `unknown`; explicit `runtime` + `agentId` args honoured; result carries `epoch`.
- Verify: `bun test tests/core/model-eligibility.test.ts --isolate`.

## T1.5 — `feat(models): eligibility on /available; disabled-with-reason options in every picker` (M)
- Files: `plugins/models/lib/available-models.ts` (engine replaces `applyRejectionOverlay`; wire `eligibility`), `plugins/models/lib/routes.ts` (`GET /available`), NEW `src/hooks/use-model-options.ts` (eligibility → `ModelSelectOption` with label suffix + `disabled`; currently-selected dead value stays selectable-as-current), consumers `plugins/models/components/{agents-tab,routing-tab,aliases-tab,available-models-tab}.tsx`, `plugins/team/components/{agent-form,overview-tab}.tsx`.
- Acceptance: S1 picker half; `unknown` enabled + info line.
- Verify: `bun test tests/plugins/models tests/plugins/team --isolate`; `bun run ui:conformance --quick`.

## T1.6 — `feat(core): selections, revision, proposals; shared same-id helper` (M)
- Files: NEW `src/core/model-selections.ts` (`enumerateSelections`, `computeRevision`, `proposeRepairs`, `mapModelToCatalog` moved here), `src/core/roster-reconcile.ts:56-61` (import), NEW `tests/core/model-selections.test.ts`; `src/core/model-plan.ts` stub `recommendForLane()` wrapping today's `recommendRoutes` (full recommender T3.2).
- Acceptance: refs cover every persisted reference incl. thinking + `ui:mode`; revision stable/changing per spec; proposal precedence; roster-reconcile tests green.
- Verify: `bun test tests/core/model-selections.test.ts tests/core/roster-reconcile*.test.ts --isolate`.

## T1.7 — `feat(models): mutateSelections (tri-state, document reservations, reconcile) + GET/POST /selections + bakin models restore` (L — sub-steps land as ONE commit; the route is additive so old writers keep working)
1. `mutateSelections()`: mutex; revision check under lock (409); ops folded per **document** (`policy` / `agent:<id>` / `routing`); per-op eligibility / support checks; `409 write_pending` if any target document is reserved; ordered writes with a 10 s deadline per document → `ok | failed | pending`; pending recorded to `plugin-settings/models/pending-writes.json` `{document, refs, previous, intended, startedAt, revision, bootId}`; the detached promise clears/marks the record on settle and ONLY THEN releases the reservation; mutex released once every write is settled-or-recorded; `snapshot:'reset'` writes the full-state snapshot file; audit.
2. `reconcilePendingWrites(runtime)`: in-process records with an unsettled promise are REPORTED as pending regardless of the re-read value (no release, no Retry); records whose `bootId` ≠ current are classified by re-read (intended ⇒ resolved; previous ⇒ failed, "not confirmed before restart"; else conflict). Called from `GET /selections`, boot, watchdog tick.
3. Routes `GET /selections` (states, revision, eligibility, proposals, pending, conflicts) + `POST /selections`; zod in `route-schemas.ts`.
4. NEW `src/cli/commands/models.ts` with `bakin models restore <snapshot.json>` (GET current → diff snapshot states vs current into ops → POST with current revision; one retry on 409); `cli/bakin.ts` case + `registry.ts` entry. (`plan` subcommand arrives in T3.2.)
- Acceptance: S10 **exact sequence**: write exceeds deadline → `pending` → intervening `GET /selections` while value still equals `previous` → Retry NOT offered, POST on the same document ⇒ `409 write_pending` → adapter settles → state equals `intended`, exactly one adapter write observed (spy). Two refs on one document share one reservation. Simulated restart (`bootId` change) classifies by re-read. Concurrent ⇒ one 409; partial + retry-of-failed with new revision; Pi subagent clears ⇒ `failed unsupported_by_runtime`. Restore: after Reset; after an intervening edit; stale-revision retry succeeds.
- Verify: `bun test tests/core/model-selections.test.ts tests/plugins/models tests/cli --isolate`.

## T1.8 — `refactor(models): all model writers via /selections; delete old write routes` (M) **[PR 1 point of no return]**
- Files: `plugins/models/components/use-models-data.ts` (`saveDefaults/saveConfig/saveRouting/aliases/applyRecommendedRoutes` → ops), `plugins/team/components/agent-detail.tsx:117-134` (ops), `plugins/team/lib/routes/agents.ts:158` (validate `body.model` via engine → 400), `plugins/models/lib/routes.ts` (DELETE `POST /config`, `POST /defaults`, `POST /aliases`, `PUT /routing`; `/routing/recommend` → GET proposal-only), tests.
- Acceptance: `rg "plugins/models/(config|defaults|aliases)\b|PUT.*routing"` outside git empty; regression "a repoint never lands a provider the target lacks".
- Verify: `bun run test`.

## T1.9 — `feat(models): models.dead-selections check + apply-model-proposal repair` (M)
- Files: `plugins/models/lib/health-checks.ts` (new check; drop `route-model-missing-*`), `plugins/models/index.ts` (repair before check), tests.
- Acceptance: per-selection findings with `class`; repair `{ref,from,to,revision}` refused stale; `partial` evidence ⇒ one `healthUnknown` per source.
- Verify: `bun test tests/plugins/models --isolate`.

## T1.10 — `feat(core): preDispatchGate — effective-selection model hold + /holds + error translation` (L — sub-steps as separate commits, each green)
1. `dispatch-turns.ts`: `preDispatchGate(agentId, contentDir, memo, prospect) → { hold: null | { reason, ref?, detail } }` wrapping kill switch + `budgetGate`; NEW `modelHoldFor(agentId, routing)` resolving the EFFECTIVE selection (`routing.model ?? agent pin ?? runtime default`, via `enumerateSelections`) and evaluating eligibility with `agentId`; update the five callers (`dispatch-cycle.ts:238`, `dispatch-single.ts:189`, `dispatch-workflow.ts:161`, `dispatch-team.ts:251`; `media-gate.ts` keeps `budgetGate`); audit `task.deferred { reason:'model_not_eligible', ref }`.
2. `GET /api/plugins/models/holds` (`perTask: Record<taskId, { reason:'model_not_eligible', ref, detail }>` over `columns.todo`, reusing the same routing resolution), NEW `plugins/tasks/hooks/use-model-holds.ts`, `task-card.tsx` signal (Cpu icon, "Model can't run", `PluginLink` `/models?ref=<ref>`), `use-budget-status.ts` untouched.
3. `src/core/dispatch-failures.ts:75-90` + `plugins/assets/lib/enrichment/runtime.ts`: translated message when the effective selection is dead (structured fields only).
- Acceptance: S15 (inherited dead pin; inherited dead default; healthy uncapped dispatch not held; uncapped install shows the hold with the Models link); S2 text.
- Verify: `bun test tests/core/dispatch* tests/plugins/{tasks,assets,models} --isolate`.

## T1.11 — Rig verification: #907 item 5 (no code)
- `bun run instance up --runtime pi`; repoint via `POST /selections`; fire enrichment; confirm the model used. Record in spec §11 Q1. If a cache IS observed, T1.12 adds its reset instead of relying on advice alone.

## T1.12 — `feat(models): pending-restart state + adapter restartAdvice banner; delete dirty markers` (M)
- Files: NEW `plugins/models/lib/pending-restart.ts` (file `plugin-settings/models/pending-restart.json`; `notePendingChange(kinds)`, `clearPendingRestart()`, `recordRestartFailure(err)`), `plugins/models/lib/routes.ts` (`GET /runtime/status` → `{pending, kinds, advice|fallback, lastAttempt}`; `POST /runtime/restart` clears on success / records on failure), `mutateSelections` calls `notePendingChange` for touched kinds when `restartAdvice?.(kind)?.needed`, DELETE `config-io.ts` sync cell + `models.markConfigDirty`/`markRuntimeRestarted` hooks + Team calls (`agents.ts:194-205,256-261`, `index.ts:597,683` — keep `runtime.restart()` where `restartAdvice('roster').needed`), `src/hooks/use-runtime-status.ts` (drop `markDirty`), `models-page.tsx:204-220` renders advice.
- Acceptance: S16 matrix; mock without member ⇒ fallback advice + pending recorded.
- Verify: `bun test tests/plugins/{models,team} --isolate`; conformance suite.

## T1.13 — `feat(core): runtime-switch reconcile-selections + epoch-guarded cache reset` (M)
- Files: `src/core/runtime-switch.ts` (phase in union :66 + real/dry-run emits; `enumerateSelections(target)` + proposals against the TARGET's eligibility at dry-run :621-626 and after `reconcile-roster` :437; `result.deadSelections`), `src/core/switch-report.ts`, `plugins/models/lib/available-models.ts` (`runtimeEpoch`; fetches capture epoch and publish only if unchanged; `resetModelsCache()` bumps epoch + clears hot/disk + drops `inflightFetch`), header notice "N model settings need review", `src/cli/commands/runtime.ts`.
- Acceptance: S3; **stale fetch test**: a fetch started before `resetModelsCache()` completes afterwards and publishes nothing.
- Verify: `bun test tests/core/runtime-switch* tests/plugins/models --isolate`.

## T1.14 — `docs(knowledge): models-plugin, runtime-capabilities, doctor, adapter-architecture, dispatch; CLAUDE.md`

### CHECKPOINT A — PR 1 merge-ready
- Gates + `ui:conformance --full`.
- `/verify` (temp home): S1 with the dead pin written **directly into the Pi registry fixture** (the API must refuse it — verify the 400 separately), S2, S3 dry-run, S10 incl. late-settling write, S15, S16.
- Live on 3737: Mark views the picker (dead options disabled with reasons), Health (no findings on a healthy box), the restart banner absent on Pi. Merge after approval.

---

# PR 2 — `feat(spend): Spend page, opt-in limits, milestone ladder`

Branch `feat/spend-plugin`.

## T2.1 — Bits gate (no code unless hit)
- `rg "plugins/models/(spend|budget|billing)" ../bakin-bits-official`; if hit, plan the repoint + bump before T2.7.

## T2.2 — `fix(core): atomic plugin-settings writes` (S)
- `packages/core/src/plugins/settings-store.ts:35-39` tmp+rename; test.

## T2.3 — `refactor(core): curated model catalog → packages/core/src/llm/model-catalog.ts` (M)
- Move `plugins/models/data/known-models.ts`; update imports; `check:cycles`.

## T2.4 — `feat(spend): plugin scaffold, nav, route, enrollment (page shell only)` (M)
- Files: NEW `plugins/spend/{bakin-plugin.json,package.json,index.ts,client.tsx,types.ts}` (template `plugins/explore`; `contributes.eager:true` reserved for T2.11), `src/lib/core-plugin-ids.ts`, `src/lib/plugin-static-imports.ts` ×3, `bakin.config.ts`, `scripts/ui/verify-plugin-conformance.ts` (`migration-pending`), `packages/host/src/routes/spend.tsx`, `router.ts`, `lib/route-shadow.ts`, `layout/nav-placement.ts:32`, `bun run ui:census:generate --core-only`.
- Acceptance: `/spend` renders a `PageHeader` with two empty tabs; architecture + census + host tests green.
- Verify: `bun test tests/architecture tests/host tests/ui/architecture --isolate && bun run ui:census:check`.

## T2.5 — `refactor(spend): pure moves — billing, budget routes/schemas, health check, overview components` (L — ONE commit; behaviour-neutral)
- Move `plugins/models/lib/{billing.ts,budget-routes.ts}` + budget parts of `route-schemas.ts` → `plugins/spend/lib/`; `plugins/health/lib/system-checks/budget.ts` → `plugins/spend/lib/health-checks.ts`; `plugins/models/components/{spend-tab,spend-breakdown,spend-budget-controls}.tsx` → `plugins/spend/components/`. **Models plugin still imports and mounts them** (path-only changes; `@bakin/spend/*` alias inside app code) and still registers the hooks and routes. Delete `plugins/models/lib/budget-migration.ts` (legacy PR#500 shape) + its activate call.
- Acceptance: zero behaviour change; full suite green.
- Verify: `bun run test && bun run check:cycles`.

## T2.6 — `feat(core): ledger v10 — budget_milestones, incident episodes, reopen set; evaluateBudget.crossed` (M)
- Files: `packages/core/src/execution/ledger.ts` (v10 migration; verbs `recordMilestoneCrossings`, `listMilestones`, `listUnnotified{Milestones,Incidents}` (return `{id, eventId, …}`), `markMilestoneNotified(id, eventId)` / `markIncidentNotified(id, eventId)` (`WHERE id = ? AND event_id = ?`, return changed-row count), `acknowledgeMilestone`; `openBudgetIncident` reopen set `raised|window_rollover|rule_removed`, episode++/new `event_id`/`notified_at=NULL`/`at_cap` update), `src/core/execution-ledger.ts` facade, `src/core/budget.ts` (`evaluateBudget → { decision, crossed }`; `warnPct`/`DEFAULT_WARN_PCT` removed; **all consumers updated in this commit**: `dispatch-turns.ts` (warn incidents no longer opened), `media-gate.ts`, `plugins/spend/lib/budget-routes.ts:79`, `plugins/spend/lib/health-checks.ts`), `tests/core/task-service.test.ts` in-memory ledger fake extended.
- Acceptance: S14 lifecycle test; UNIQUE by `rule_id`; recreate ⇒ fresh milestone rows; `markIncidentNotified(id, staleEventId)` changes zero rows after a reopen; existing incident tests green.
- Verify: `bun test tests/core/execution-ledger* tests/core/budget* tests/core/dispatch* --isolate`.

## T2.7 — `feat(spend): ownership cutover — upgrade, hooks, fail-closed gate, /limits, callers, delete Models budget surface` (**XL-cutover exception** — ONE commit, ~20 files, pre-staged by T2.5) **[PR 2 point of no return]**
1. `plugins/spend/lib/settings-upgrade.ts` (pure; spec §10 steps 1–4, `BudgetRule.id` assignment, `warnPct` drop) + `plugins/spend/index.ts activate()` runs it BEFORE registering hooks.
2. Hooks `spend.getBudgetPolicy|resolveBilling|priceTurn|priceImage|updateBudgetPolicy` in `plugins/spend/lib/register-hooks.ts`; delete the `models.*` five from `plugins/models/lib/register-hooks.ts`; repoint `dispatch-turns.ts:210,232`, `budget-spend.ts:309,490`, `agent-cost.ts:144,200`, `media-gate.ts`, `spend/lib/health-checks.ts`, `src/core/onboarding/budget.ts:21-26`.
3. Gate: missing/throwing hook ⇒ `FAIL_CLOSED_DECISION` cause `budget_policy_unavailable` (union member; four switch sites; board label). NEW health-owned `plugins/health/lib/system-checks/spend-policy.ts` (`spend.policy-available`: hook registered + answers within 2 s ⇒ healthy, else `unknown`/error with class), registered in `plugins/health/index.ts`.
4. Replacement edit surface: `PUT/GET /api/plugins/spend/limits` (zod per spec; server ids; delete ⇒ `rule_removed`), `GET /status` (+`/status?lite=1`), `/incidents…`, `/billing/overrides`, `/spend` — mounted from `plugins/spend/index.ts routes`; Limits tab list form (`ListRows`) + billing-lanes panel using the moved components; Spend health check + repairs registered by spend.
5. Delete from Models: budget/spend/billing routes (`routes.ts:353-471`, `budgetStatusRoutes` spread), Spend tab + header controls in `models-page.tsx`, `types.ts` budget/billing keys; deregister the health `budget` check/repairs from `plugins/health/index.ts:1027-1034,1125-1126`.
6. Repoint callers: `header.tsx:61`, `use-budget-status.ts:29`, `use-sse.ts:156-160` (`/spend?tab=limits`), health links, `budget-notify.ts` copy, `src/cli/commands/budget.ts` endpoints, regenerate docs.
- Acceptance: S13 (hook missing ⇒ fail-closed + health-owned finding); upgrade crash matrix (interrupt after each step; resume idempotent; backup never overwritten; `models.json` ends without budget keys; live rules preserved with ids); `rg "plugins/models/(spend|budget|billing)"` empty; a limit saved in the Limits tab is enforced by the gate on the same commit.
- Verify: `bun run test`; `/verify` boot with a seeded legacy `models.json`.

## T2.8 — `feat(spend): Overview tab — relocated analytics, lane-honest tiles, pace line with basis` (M)
- Files: `plugins/spend/components/overview-tab.tsx` (from moved `spend-tab` overview parts), `spend-breakdown.tsx`, `GET /spend` payload (+`observedDays` from `coveredDaysSince`). Lands AFTER T2.9 (sequential; no fallback variant).
- Verify: RTL; `ui:conformance --quick`.

## T2.9 — `feat(spend): scan_days coverage receipts + day-set spend engine variant + guided limit dialog` (L — sub-steps as separate commits, each green)
1. `packages/core/src/usage-history/store.ts` (migration `scan_days(day TEXT PRIMARY KEY, first_scan_at, last_scan_at)`; `recordScanDay(day, now)` upsert + 90-day prune; `coveredDaysSince(days)`), `src/core/usage-history.ts` (call `recordScanDay` only when `report.coverage.status === 'complete'`).
2. `src/core/budget-spend.ts`: extract the per-day attribution + observed-minus-attributed reconciliation into `assembleSpendForDays(days: string[], now)` returning the same lane-honest facet shape + evidence gaps; `assembleBudgetSpend` calls it for its windows (refactor, behaviour-neutral, pinned by existing tests). **No spend arithmetic in the plugin.**
3. NEW `plugins/spend/lib/coverage.ts` (`coverageSummary(30) → { coveredDays, covered: facets, uncovered: facets }` = `coveredDaysSince` + two `assembleSpendForDays` calls), NEW `plugins/spend/components/limit-dialog.tsx` (two sections; suggestion only when `covered ≥ 14 && no gaps on covered days && coveredSpend > 0`; `roundToNice(1.5 × coveredSpend / coveredDays × 30)`; basis copy; "plus $X on unobserved days"; subscription-only copy; reaction radio persisting `defer|pause`), "Add a limit for…".
- Acceptance: unavailable roster (`failed:0`, coverage `unavailable`) ⇒ day NOT recorded; partial ⇒ not recorded; zero-use complete day ⇒ covered; backfilled spend on uncovered days excluded from the rate and shown separately; 14 covered days at $10/day ⇒ ~$450; < 14 ⇒ no prefill + copy; prune keeps 90 days; **the same $10 present in both `run_costs` and usage.db counts once and the suggestion basis equals the Overview's figure for those days**; `assembleBudgetSpend` outputs unchanged by the refactor.
- Verify: `bun test tests/plugins/spend tests/core/budget-spend* tests/core/usage-history* packages/core/src/usage-history --isolate`.

## T2.10 — `feat(core): spend observer + single-worker deliverPending (milestones AND incidents)` (M)
- Files: NEW `src/core/spend-observer.ts` (`observeSpend(now)` coalesced; memo keyed `(dayStart, rulesRevision, spendGeneration)`; crossings + `covered_by`; incident open/reopen at 100 via `recordBudgetBreach` refactored to NOT notify; `deliverPending()` behind its OWN single-flight mutex with coalescing, shared by observer/boot/watchdog callers: select unnotified milestone rows `<100` + unnotified open incidents capturing `(id, event_id)` per row, send (SSE with `eventId`/`episode`, OS, relay for incidents), then mark `SET notified_at WHERE id = ? AND event_id = ?`), ledger verbs `markMilestoneNotified(id, eventId)` / `markIncidentNotified(id, eventId)` (T2.6 adds them with that signature), hook points `agent-cost.ts:103` (+`bumpSpendGeneration()`), `usage-history.ts` (after successful scan), `watchdog.ts:165-170`, boot (`startup-recovery.ts` after `dispatch.start`), `budget-notify.ts` (payloads carry `eventId`).
- Acceptance: S9 full matrix incl. **reopen during in-flight delivery** (episode 1 completes → marks only `(id, event_id₁)` → episode 2 still unnotified → next pass delivers it once), crash between incident insert and send (recovered), crash between send and mark (re-sent, same id), post-write pass never reuses pre-write totals, observer coalescing AND delivery coalescing each schedule exactly one follow-up, concurrent boot + watchdog delivery calls produce one send.
- Verify: `bun test tests/core/spend-observer.test.ts tests/core/budget-notify* --isolate`.

## T2.11 — `feat(spend): notification ladder — badge provider, stacked header banners, status, Resume rule` (M)
- Files: NEW `plugins/spend/components/spend-badge-provider.tsx` (`nav-badge-providers`; `eager:true`; toast/OS for 50/75 via attention rules; badge from unacknowledged rows; `eventId` seen-set), `packages/host/src/components/layout/header.tsx` (generalize `top-*` at :97/:164 to computed offsets; yellow 90 with dismiss → `POST /limits/milestones/:id/ack`; red 100 from open incident with inline actions), `GET /status` (+`milestones`, `openIncidents` with `episode`), `POST /incidents/:id/resolve` (S12 rule: `resume` refused with `409 still_over_limit` when spend ≥ cap; client renders "Raise limit to resume").
- Acceptance: banners derive from rows on reload with no SSE; 0–3 banner stacking RTL; S12.
- Verify: RTL; `bun test tests/plugins/spend --isolate`; `ui:conformance --quick`.

## T2.12 — `feat(spend): remove uncapped nags; CLI flags/copy; onboarding note` (M)
- Files: `plugins/spend/lib/health-checks.ts` (drop `policy-missing`; `budget_policy_unavailable` ⇒ `unknown`), `src/cli/commands/budget.ts` (`--at-cap wait|pause` ↔ `defer|pause`; `--warn` removed; milestones in `show`; pace basis; no uncapped lines), `src/core/cli/registry.ts:176-177`, `src/core/onboarding/budget.ts` (note-only, `check()` ok), `state.ts` `ONBOARDING_VERSION` bump.
- Acceptance: S8.

## T2.13 — `chore(ui): spend plugin UI fixture → conformant` (S)
- `bakin.ui-test.ts` at `plugins/spend`, enrollment flipped, `bun run ui:test:conformance`, inspect `test-results/bakin-ui/index.html`.

## T2.14 — `docs(knowledge): spend-plugin.md (new; behaviour table verbatim), models-plugin, execution-ledger, doctor, cost-control-v2 status; CLAUDE.md`

### CHECKPOINT B — PR 2 merge-ready
- Gates + `ui:conformance --full` + `ui:test:conformance` (spend fixture, report inspected).
- `/verify`: S8, S9, S12, S13, S14, upgrade crash matrix (seeded legacy `models.json`).
- Live on 3737: Mark's real `models.json` upgrades (backup present, keys removed); Spend Overview shows subscription tokens with "not metered" tiles; his 1e9 rule renders as a limit with an id he can delete; Health shows no uncapped finding and `spend.policy-available` healthy. Merge after approval.

---

# PR 3 — `feat(models): Simple/Advanced model plan page`

Branch `feat/models-plan-page`.

## T3.1 — **D23 APPROVAL CHECKPOINT** → `feat(sdk): ModelSelectOption.description/tone + DisabledWithReason story` (M) or documented fallback
- Present the deviation template (closest `forms/model-select.stories.tsx — UnavailableModelCatalog`). On yes: `picker-patterns.tsx:307-393`, story + play + coverage, `ui:public-api:generate` (review diff), `use-model-options.ts` switches suffix → `description`. On no: no-op commit recording the decision in the spec.
- Verify: `ui:test:stories`, `ui:public-api:check`, `ui:conformance --full`.

## T3.2 — `feat(core): model-plan recommender; GET /plan; bakin models plan` (M)
- Files: `src/core/model-plan.ts` (full; absorbs `recommendRoutes`; `unrouted-system-classes` check uses it), `src/cli/commands/models.ts` (add `plan [--apply] [--json]` beside the PR 1 `restore`), `registry.ts`, `GET /api/plugins/models/plan` (current + recommended + ops diff + why).
- Acceptance: deterministic ranking; Codex-only vision via `input`; enrichment→agent and no-vision branches; unknown metadata ranks lower; `VISION_MODELS` not imported (arch test).
- Verify: `bun test tests/core/model-plan.test.ts tests/cli tests/architecture --isolate`.

## T3.3 — `feat(onboarding): models plan step` (S)
- NEW `src/core/onboarding/models.ts`; `COMPONENT_ORDER` after `llm`; `ONBOARDING_VERSION` bump; S7 tests.

## T3.4 — `feat(models): page shell — mode toggle, catalog panel, ?ref, mode classification, pending chips` (M)
- Files: `models-page.tsx` rewrite (tabs kept mounted behind the new shell until T3.6/T3.8 replace them — the page stays usable at this commit), `use-models-data.ts` (`GET /selections` + `/plan`; `ui:mode` via op), catalog `DisclosurePanel` (from `available-models-tab.tsx`, minus "Set default").
- Acceptance: states list; `?ref=` flips view; classification rule.

## T3.5 — `feat(models): draft/op model, one SaveBar, partial-failure + pending UI` (M)
- Files: `use-models-data.ts` (draft = op list; save → `POST /selections`; render `applied/failed/pending`; Retry failed only; dirty-exit guard via `/navigation`), `models-page.tsx` `SaveBar`.
- Acceptance: S10 UI half.

## T3.6 — `feat(models): Simple view` (M)
- Files: NEW `plugins/models/components/{simple-mode,plan-lane,customizations-line}.tsx`; NEW `tests/plugins/models/simple-save-minimality.test.ts` (property test: random baseline + one control change ⇒ exactly the expected ops).
- Acceptance: S4 Simple, S5, S11, Mixed + "Set all to…", recommended-plan diff stages ops, `send` untouched.

## T3.7 — `feat(models): Reset to this plan` (S)
- Files: `reset-dialog.tsx` (`recipes/destructive-settings-flow — SettingsFlow`), `buildResetOps(states, support, plan)` in `model-selections.ts`.
- Acceptance: S6; Pi subagent clears skipped + disclosed; refused with a dirty draft.

## T3.8 — `feat(models): Advanced sections (support-gated)` (M)
- Files: NEW `{advanced-mode,defaults-section,agents-section,routing-section}.tsx` (from tab content; 11 classes grouped; `perTurnModel=false` read-only notice).
- Acceptance: S4 Advanced against Pi + OpenClaw support fixtures.

## T3.9 — `feat(models): selection callouts (stage-into-draft)` (S)
- NEW `selection-callout.tsx`; wired into lanes/agent rows/routing rows; `unknown` ⇒ info only.

## T3.10 — `feat(team): shared model-options hook + models.catalog_changed` (S)
- `src/hooks/use-available-models.ts` (delete module cache; subscribe to `models.catalog_changed` emitted by `POST /refresh` + `resetModelsCache`), Team components.

## T3.11 — `refactor(models): delete tabs, dead Settings field, stale hooks` (M) **[PR 3 point of no return]**
- Delete `agents-tab/routing-tab/aliases-tab/available-models-tab.tsx`, `index.ts:32-36` `settingsSchema.defaultModel`, `models.configChanged` if unused, stale comments.

## T3.12 — `docs(knowledge): models-plugin (Simple/Advanced, plan, reset, snapshots, pending writes), onboarding, CLI; CLAUDE.md; README`

### CHECKPOINT C — PR 3 merge-ready
- Gates + `ui:conformance --full` + `ui:test:conformance` (models fixture, report inspected) + stories.
- `/verify`: S4, S5, S6, S7 (`bakin onboard --yes` temp home), S10, S11.
- Live on 3737: Mark opens `/models` (expect Advanced classification given existing pins), reviews the customizations line, "Use recommended plan" diff, Reset in dialog, `bakin models plan --restore`. Merge after approval.

---

## Commit & rollback summary

| PR | Point of no return | Pre-PoNR safety | Rollback |
|---|---|---|---|
| 1 | T1.8 (old write routes deleted) | none needed | revert-merge; `pending-*.json` inert to older code |
| 2 | T2.7 (keys move models.json → spend.json; hooks switch) | `models.json.pre-spend.bak` written once | revert-merge + restore backup; additive ledger columns ignored by older code |
| 3 | T3.11 (old tabs deleted) | Reset snapshots (`plugin-settings/models/snapshots/`, full-state format) | revert-merge; a regretted Reset is undone with `bakin models restore <snapshot>` (ships in PR 1, so it exists after a PR 3 revert; diffs against current state under the current revision) |

Before a PoNR every commit is independently `git revert`-able; after it, revert from the tail backwards.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Adapter write settles after the mutation deadline | High — retry overwrites newer state | Per-DOCUMENT reservation released only on in-process settle (reads never release); prior-boot records classified by re-read; timeout→GET→retry→settle test with a write spy (T1.7) |
| Crash between incident insert and notification / reopen during in-flight delivery | High — silent 100% or skipped episode | `deliverPending` over BOTH tables, single coalesced worker, marks `(id, event_id)`; boot + tick reconciliation (T2.6, T2.10) |
| Coverage double-counts spend present in both stores | Med — inflated suggestion | day-set variant of the ONE spend engine; plugin does no arithmetic; same-$10-twice test (T2.9) |
| Snapshot restore stale-revision | Med | snapshot = full state; restore diffs against current state under current revision with one 409 retry (T1.7) |
| Delete→recreate rule loses pause hold | High | reopen set includes `rule_removed`; `at_cap` updated on reopen; S14 test (T2.6) |
| Intermediate commit with two policy stores | High | T2.5 is behaviour-neutral moves; T2.7 is the single cutover (D26) |
| Coverage over-counts (`failed:0` but unavailable) | Med | `scan_days` written only on `coverage.status:'complete'`; numerator restricted to covered days (T2.9) |
| Stale catalog fetch repopulates caches after a switch | Med | runtime epoch captured/checked before publish (T1.13) |
| Observer reuses pre-write totals | Med | memo keyed on `spendGeneration` bumped in `recordSpend` + after scan (T2.10) |
| OpenClaw banner permanent or missing | Med | persisted pending-restart state cleared only on successful `restart()`; S16 matrix (T1.12) |
| Header banner stacking regression | Low | computed offsets; 0–3 banner RTL (T2.11) |
| Story flake class (#904) | Med | one new story; canonical baseline tooling; approval before baseline update |
| `scan_days` prune or write adds cost to the 5-min scan | Low | one upsert + one delete per scan; measured in T2.9's test |
