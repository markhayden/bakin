# Spec — Models & Spend Overhaul: trust the picker, one plan by default, spend you learn from

**Status:** DRAFT v3.1 (stands alone; third review folded in) — awaiting approval of the plan, then `/agent-skills:build`.
**Origin:** Issue #907 (agent pinned to a credential-less provider silently breaks enrichment with a misleading fix) plus the operator's standing complaints: "super low default spend settings", a Models page that is "so heavy with select menus and tabs it's hard to figure out what's going on", and "if you switch provider you're really screwed."
**Also closes / absorbs:** #378 (model-domain slice only), #878 (Models-page restart banner half).
**Related but OUT of scope:** #855, #583/#584.
**Design records superseded in part:** `.claude/specs/cost-control-v2.md` (§1 items 1 and 8 reversed; enforcement design stands), `.claude/specs/models-cost-optimization.md` (matrix stays; presentation changes).
**Review history:** v1–v3 and the plan reviewed by a second agent 2026-09-21; every factual claim verified against source before acceptance. §12 records decisions and revisions.
**Branch strategy:** three sequential PRs to `main`, each branched in the main checkout so 3737 serves it for live testing before merge (`test-live-before-merge`).

---

## 1. Objective

A single-operator Bakin install where:

1. **You cannot select, and the system never silently keeps, a model that cannot run.** "Cannot run" = provider has no credentials here (#907), account rejected it (#852), runtime reports it unavailable, or it is absent from the catalog. Each dead selection is called out where it was made, once in Health, and in the failing turn's error — always with the TRUE reason and, when one exists, a concrete proposal the user applies. **Nothing is auto-applied.** When evidence is unavailable the UI says "couldn't verify" and offers nothing destructive.
2. **Choosing models is one decision by default, with full granularity one toggle away.** Simple: an agent model and a background-chores model, recommended with reasons, approved by the user. Advanced: today's granularity rebuilt clean. Runtime-unsupported controls are hidden. The mode is a **view**; a Simple save changes only what the user touched; clearing customizations is an explicit, snapshotted Reset.
3. **Spend is something you learn from before you guard against it.** No limits and no nagging by default. A Spend page shows observed and projected spend; setting a limit is an opt-in "here's what you spend — set a cap based on that" flow; limits notify at fixed 50/75/90/100% milestones. Thresholds are evaluated over recorded spend; in-flight work can finish past the line, and the copy says so.

**Who:** the operator (single user). No shims; persisted data gets ONE-SHOT, crash-safe upgrades (§10).

### 1.1 Success criteria (testable)

| # | Criterion | Verified by |
|---|---|---|
| S1 | Pi credentialed only for `openai-codex`: `openai/gpt-5.6-luna` is disabled in every `ModelSelect` with reason **"no credentials for openai"**; if persisted (fixture written directly to the runtime store — the API refuses it), Health flags it within one doctor run with a one-click repair carrying `{ref, from, to, revision}`, refused if stale. | rig integration + unit |
| S2 | Enrichment failing with `provider_cooldown` + `authProfileUnavailable` on a dead selection yields the translated message; classification by structured fields only. | unit |
| S3 | `bakin runtime use <other> --dry-run` lists every selection the TARGET cannot run, with proposals; the live switch writes none of them (roster carry excepted); Health shows one finding per dead selection after the switch. | switch integration |
| S4 | Simple renders two lane controls + a customizations line; Advanced renders no control `routingSupport()` marks unsupported. | RTL, Pi + OpenClaw fixtures |
| S5 | A Simple save that changed only the agent model emits exactly one `set` op; every other route/thinking/pin/override is byte-identical after save. | route + property test |
| S6 | Reset clears customizations ONLY via its `ConfirmDialog` listing each removed setting with before-values, writes a snapshot first, is capability-aware, and is refused while the page has an unsaved draft. | RTL + route |
| S7 | Fresh `bakin onboard --yes` on a credentialed runtime ends with an eligible, suitable plan and no "unrouted" / "uncapped" findings; on a Codex-only box the chores lane is a vision-capable Codex model or the plan states the gap. | onboarding integration |
| S8 | Empty limits ⇒ zero budget Health findings, no "uncapped" CLI lines, Limits tab shows the opt-in CTA. | doctor + CLI + RTL |
| S9 | `$100` monthly metered limit: 49%→101% in one pass records four milestone rows, marks 50/75/90 `covered_by=100`, opens the cap incident (episode 1) and delivers exactly ONE user-visible event; a raise then re-breach in the same window reopens the incident as episode 2 with a new `event_id` and delivers once more; **an incident that reopens while episode 1's delivery is still in flight: episode 1's completion marks only `(id, event_id₁)`, episode 2 stays pending and is delivered by the next pass**; a crash between send and mark re-delivers with the same `event_id` and consumers de-duplicate; a crash between incident insert and send is recovered by reconciliation; restart re-fires nothing already marked. | ledger-backed unit tests |
| S10 | Mutation with a stale `revision` ⇒ 409; two concurrent mutations ⇒ one succeeds, one 409; partial failure ⇒ `{applied, failed, pending, revision}` and Retry re-sends only failed ops with the new revision. **Late-settle sequence:** adapter write exceeds the deadline → response lists it `pending` → an intervening `GET /selections` (value still equals `previous`) does NOT enable Retry and a retry attempt on the same document ⇒ `409 write_pending` → the write settles → state shows the intended value; at no point do two writes to that document overlap. After a simulated restart the record is classified by re-read and labelled accordingly. | route + RTL |
| S11 | `perTurnModel === false` ⇒ Simple shows the chores lane as saved-but-not-applied. | RTL |
| S12 | "Resume without raising" is offered only when current spend < limit; otherwise the action is "Raise limit to resume". | route + RTL |
| S13 | If the spend plugin failed to activate or its policy hook is unregistered/throwing, the dispatch gate defers fail-closed (`budget_policy_unavailable`) and a HEALTH-owned check reports it — an existing limit is never silently dropped. | unit + integration |
| S14 | Delete an over-limit `pause` rule → recreate same scope in the same window → breach → rollover: the new breach alerts and the new pause hold survives rollover. | ledger-backed unit |
| S15 | A task whose EFFECTIVE model (route → agent pin → runtime default, in the agent's credential context) is dead is held pre-claim with reason `model_not_eligible`, badged on the board with a link to `/models?ref=…` — including on an install with zero limits. | dispatch unit + RTL |
| S16 | OpenClaw: save → banner "restart gateway" → successful restart → banner cleared; failed restart → banner retained; Pi: save → no banner. | unit |
| S17 | `test`, `lint`, `typecheck`, `check:cycles`, `ui:conformance --full` green; knowledge docs + CLAUDE.md updated per PR. | CI |

---

## 2. Ground truth (verified 2026-09-21)

**Models page today (`/models`, 5 tabs):** Agent Config = `2 + N + 2A` model selects (22 live). Routing = 22 (11 routable work classes × model + thinking) + 2 per tag override. Aliases = 1. Spend = 5 per rule + 1 per agent. Default model written from three places incl. a **dead** Settings-page select (`plugins/models/index.ts:32-36`).

**Work classes:** 5 dispatch + 7 system; `chat` non-routable ⇒ 11 routable. `send` = operator/UI messages straight to an agent (`src/core/agents.ts:77`).

**Pickers ignore availability.** `ModelSelectOption = { id, name, provider?, disabled? }` (`picker-patterns.tsx:307-312`); nobody sets `disabled`. `available:false` only from the #852 overlay.

**Runtime `available` semantics differ.** Pi: `available = registry.hasConfiguredAuth(m)` (`adapter-pi/src/models.ts:99`) — **auth**, not catalog membership. Both adapters expose only an `input` modality string (Pi `,`-joined, OpenClaw `+`-joined); vision = `inputs.includes('image')`. No tool-calling metadata exists on either.

**Credentials:** `runtime.credentialStatus({agentId?})`. **OpenClaw merges** auth-profiles JSON + CLI probe (`adapter-openclaw/src/runtime.ts:1141-1170`); a CLI failure is swallowed and the JSON subset returned — PARTIAL without saying so.

**Error kinds:** no `auth_unavailable`. Pi: `provider_cooldown` + `providerInfo.authProfileUnavailable` (`adapter-pi/src/errors.ts:74`); OpenClaw same flag (`errors.ts:33`); `src/core/dispatch-failures.ts:75-90` branches on it.

**Runtime support:** Pi rejects NON-EMPTY `fallbackModels`/`defaultSubagentModel`/`aliases` and accepts clears (`adapter-pi/src/models.ts:170-183`); rejects per-agent `subagentModel` outright incl. clears (`agents.ts:122-124`). OpenClaw `perTurnModel` is dynamic (#880).

**Runtime switch:** `reconcileRoster` maps carried pins via unique-bare-id (`roster-reconcile.ts:56-61`) and writes them; `settings.routing` untouched/unreported. Model cache: hot (`globalThis.__bakinModelsCache`, 1h) + disk (`plugin-settings/models/available.json`) + `inflightFetch` dedupe (`available-models.ts:101`); none cleared on switch; nulling `inflightFetch` does NOT stop the old promise from repopulating the caches.

**Restart banner:** `markConfigDirty()` (`config-io.ts:26-30`) on every write incl. Team via `models.markConfigDirty`/`markRuntimeRestarted` hooks (`plugins/team/lib/routes/agents.ts:194-261`, `index.ts:597,683`). Pi re-reads pins/default from disk per turn — false alarm there; contradicts #907 item 5 (verify §3.2 1i).

**Spend:** fresh install has ZERO rules. Four nags; loudest is unclassified `action_required` (`system-checks/budget.ts:190-213`). Enforcement handles zero rules (`dispatch-turns.ts:225`). **Hook failure currently ⇒ allow** (`:205-213`). `/budget/status` returns `perTask: {}` when no rules exist (`budget-routes.ts:147-157`).

**Budget rules & incidents:** `BudgetRule` has no id. `budget_incidents` UNIQUE `(scope, scope_id, lane, win, window_start_ms, kind)`; `at_cap` enum `defer|pause`, rollover SQL matches `'defer'` (`ledger.ts:1325`); pause lookup needs `kind='cap'` (`:1455`); `openBudgetIncident` REOPENS only `raised`/`window_rollover`-resolved rows (`:1268-1276`) — a `rule_removed`-resolved row never reopens, so delete→recreate→breach in one window loses the alert AND the pause hold. `recordBudgetBreach` inserts, then notifies only when `opened === true` (`dispatch-turns.ts:365-393`) — a crash between the two loses the notification forever. Reopen keeps the row id. Milestone/warn evaluation happens only inside the dispatch gate. `deferForBudget` returns a boolean with FIVE callers (`dispatch-cycle.ts:238`, `dispatch-single.ts:189`, `dispatch-workflow.ts:161`, `dispatch-team.ts:251`, plus `media-gate.ts` via `budgetGate`).

**Usage scanner:** `scanUsageHistory` (`src/core/usage-history.ts:173`) returns `failed: 0` with `coverage.status: 'unavailable'` when the session tier is missing or the roster can't be listed — `failed === 0` is NOT coverage evidence; `coverage.status === 'complete'` is. usage.db has per-session mtime/size state, no per-day receipts. Timer owned by the health plugin (5-min default; first sweep one interval after activation).

**Hook consumers (`models.*`):** `getBudgetPolicy` ← `dispatch-turns.ts:210`, `budget-spend.ts:490`, `system-checks/budget.ts:172`; `resolveBilling` ← `budget-spend.ts:309`; `priceTurn`/`priceImage` ← `agent-cost.ts:144,200`; `getRoutingConfig` ← `dispatch-turns.ts:434`, `system-route.ts:91`, `adapter-openclaw/health-checks.ts:55`; `markConfigDirty`/`markRuntimeRestarted` ← team; `configChanged` ← models routes.

**REST callers of spend/budget:** header (`/budget/status?lite=1` 15s), tasks hook, `use-sse.ts` deep link, health check + links, CLI, `budget-notify` copy, generated API docs, possibly bits.

**Plugin settings writes** are non-atomic `writeFileSync` (`settings-store.ts:35-39`).

---

## 3. Design

### 3.1 Vocabulary

- **Model plan** — `agentModel` (chat, `send`, five dispatch classes) and `choresModel` (`auto-title`, `enrichment`, `relay`, `team-routing`, `skill-mapping`).
- **Eligibility facts** (independent, each `known | unknown`, all phrased so that TRUE means "fine"): `inCatalog`, `runtimeAvailable` (+ optional runtime `unavailableReason`), `credentialed`, `notRejected`. **Eligibility** = `eligible` iff every fact is known-true; `ineligible` with the FIRST known-false fact's reason — `not_in_catalog`, `runtime_unavailable` (or `no_credentials` when the runtime says so), `no_credentials`, `account_rejected`; `unknown` if no fact is known-false and any is unknown. A failed lookup never erases an independently known fact.
- **Effective selection** of a turn = route/tag model → agent pin → runtime default, evaluated in the target agent's credential context (`opts.agentId`).
- **Suitability** — per-lane requirements (§3.4). Missing metadata never disqualifies; it lowers rank and is disclosed.
- **Selection ref** — `agent:<id>:model`, `agent:<id>:subagentModel`, `policy:defaultModel`, `policy:fallback:<n>`, `policy:alias:<name>`, `route:<workClass>`, `tag:<tag>`, `ui:mode`.
- **Selection state** — `{ ref, model: string | null, thinking?: ThinkingSetting }`.
- **Revision** — stable hash over ALL selection states + fallback order + alias map + `ui.mode`.
- **Mutation op** — `{ ref, set: { model?: string | null; thinking?: ThinkingSetting | null } }`.
- **Proposal** — `{ ref, from, to: string | null, reason, source: 'same-id-credentialed-provider' | 'recommender' | 'none', revision }`.
- **Limit** = `BudgetRule` (gains `id`). **Milestone** = 50/75/90/100 crossing rows. **Reaction** at 100%: `defer` (UI/CLI word "Wait for the next period") or `pause`; the persisted/ledger enum stays `defer|pause`.
- **Incident episode** — each open/reopen of a cap incident increments `episode` and mints a new `event_id`; the row id alone never identifies an alert.

### 3.2 PR 1 — Trust foundation (#907 all five items + #378 slice)

**1a. Eligibility engine** `src/core/model-eligibility.ts`: `getModelEligibility(runtime, opts?: { agentId?, epoch? }) → EligibilityReport { byModel, evidence: { catalog, runtimeAvailability, credentials, rejections }: 'ok'|'partial'|'failed', epoch }`. Rules per §3.1. Runtime is an explicit argument. Results are memoised per request only.

**Contract additions (all OPTIONAL members, `channels?`-style; absence = omission, consumers feature-detect):** `RuntimeAvailableModel.unavailableReason?: 'no_credentials' | 'not_configured' | 'other'`; `credentials?: { providers(opts?): Promise<ProviderCredentialInventory> }` where `ProviderCredentialInventory = { providers: { providerId, configured, authFree?, source? }[]; evidence: 'complete' | 'partial'; detail? }`; `restartAdvice?(change: 'model-config' | 'roster' | 'routing-policy'): RestartAdvice | undefined`. Pi: `unavailableReason:'no_credentials'` when `!hasConfiguredAuth`; providers from the registry; `restartAdvice ⇒ { needed:false }`. OpenClaw: providers from the merged JSON+CLI resolution with `evidence:'partial'` when the CLI probe failed; `restartAdvice('model-config'|'roster') ⇒ needed:true` with gateway-restart action. Status only; arch test bans secret-looking fields; conformance pins + teeth; mock factories `mockCredentials()`/`mockRestartAdvice()`.

**1b. Selections, revision, proposals, mutation (one engine)** `src/core/model-selections.ts`:
- `enumerateSelections(runtime)`, `computeRevision(...)`, `proposeRepairs(...)` (same-id-under-credentialed-provider — the helper extracted from `roster-reconcile.ts`, which imports it — then recommender, then `to:null`; `unknown` ⇒ none).
- `mutateSelections(runtime, { revision, ops, snapshot?: 'reset' }) → { applied: ref[]; failed: { ref, error }[]; pending: { ref, intended }[]; revision }`.
  - **Serialized** through a process-wide async mutex.
  - Revision recomputed under the lock; `409 stale_revision { current }`.
  - Per-op validation: eligibility (`400 model_not_eligible { reason, proposal? }`; `unknown` ⇒ `warnings[]`), runtime support (`400 unsupported_by_runtime`), and **`409 write_pending`** if any op targets a **document** with an unsettled or unreconciled write. Documents are the real write boundaries: `policy` (runtime routing policy — default, fallbacks, subagent default, aliases), `agent:<id>` (one roster entry — model + subagentModel), `routing` (plugin routes + tag overrides + ui mode). A ref maps to exactly one document.
  - Fixed order policy → routes/tags → agents; one adapter write per document per mutation (ops on the same document are folded into one write).
  - **Write outcomes are tri-state:** settled-ok, settled-error, or **unsettled** (the adapter promise has not settled within the per-op deadline, 10 s). Unsettled does NOT count as failed. It is recorded in `~/.bakin/plugin-settings/models/pending-writes.json` as `{ document, refs[], previous, intended, startedAt, revision, bootId }`, listed in the response under `pending`, and the promise keeps running detached. The mutex is released once every write has settled or been recorded; the document stays **reserved**.
  - **Reservation rule:** while the original promise is unsettled IN THIS PROCESS, nothing releases the reservation — not a read, not a matching value (the value equalling `previous` only means the adapter has not written yet; equalling `intended` may be a coincidental earlier state). When the promise settles, the record is cleared (ok) or marked `failed` (error), and only then does Retry become available. **After a process restart** (record `bootId` ≠ current), the prior process's adapter writes are terminal by construction (in-process file writes, or child CLI processes reaped by the shutdown handler) — reconciliation classifies by re-read: equals `intended` ⇒ resolved; equals `previous` ⇒ failed (Retry offered, labelled "not confirmed before restart"); anything else ⇒ `conflict` ("changed outside Bakin"). `reconcilePendingWrites(runtime)` runs on `GET /selections`, boot, and the watchdog tick, but its only in-process effect is to REPORT state; it releases reservations solely on settle (in-process) or on classification of a prior-boot record.
  - `snapshot:'reset'` writes `~/.bakin/plugin-settings/models/snapshots/<ts>.json` BEFORE applying. **Snapshot format = full selection state** (`{ takenAt, revision, states: SelectionState[], policy: { fallbackModels, aliases }, uiMode }`), NOT a request body. Restore (`bakin models restore <file>`, shipped in PR 1) fetches the CURRENT state + revision, diffs snapshot → current into ops, and submits through the normal validated mutation with the current revision; a stale revision during that window is an ordinary 409 and the CLI retries once. Bounded to 5 snapshots. Audit `models.selections_mutated`.
- ONE write path: `POST /api/plugins/models/selections`; `/config`, `/defaults`, `/aliases`, `PUT /routing` deleted; `/routing/recommend` becomes GET proposal-only. Team's agent-detail model change and onboarding/CLI use it; Team `agents.create({model})` validates via 1a.

**1c. Doctor check `models.dead-selections`**: one finding PER dead selection, class `service_failure`, `action_required`, resource `{ kind:'model-selection', ref }`; repair `apply-model-proposal { ref, from, to, revision }` (refused if stale) when `to !== null`, else navigate `/models?ref=`. Evidence `partial|failed` ⇒ ONE `healthUnknown` per failed source; known rejections still report. `checkModelRouting` keeps clamp / unrouted / premium-on-cheap only.

**1d. Error translation.** On `RuntimeError` `kind:'provider_cooldown' && providerInfo.authProfileUnavailable` or `kind:'model_not_supported'`, when the turn's effective selection is dead: *"The 'enrich' agent uses `openai/gpt-5.6-luna`, but this install has no credentials for `openai`. Use `openai-codex/gpt-5.6-luna` instead? Fix in Models."* Structured fields only. Live Activity links `/models?ref=`.

**1e. Pre-claim model hold (S15).** The three dispatch paths + team pre-pass replace `deferForBudget` with `preDispatchGate(...) → { hold: null | { reason: 'kill_switch' | 'budget' | 'model_not_eligible' | 'budget_policy_unavailable'; ref?; detail } }` (all FIVE callers updated; the media gate keeps `budgetGate`). The model check resolves the **effective selection** for the agent (`routing.model ?? agent pin ?? runtime default`) and evaluates eligibility with `agentId`; a dead result holds the task pre-claim (no claim to release), audits `task.deferred { reason:'model_not_eligible', ref }`, and is surfaced by a NEW models-owned endpoint `GET /api/plugins/models/holds` (`perTask: Record<taskId, { ref, reason }>`) — independent of budget status so it works on zero-limit installs. Task cards render a distinct signal (Cpu icon, "Model can't run", link `/models?ref=<ref>`).

**1f. Refuse ineligible writes** — built into 1b; regression test "a repoint never lands a provider the target lacks".

**1g. Runtime switch honesty.** Phase `reconcile-selections` after `reconcile-roster`: enumerate against the TARGET adapter (dry-run uses the secondary target from `createSecondaryTargetRuntime`), compute proposals, `report.deadSelections[]`; live switch writes nothing for them. Consent boundary: approving the switch approves roster CARRY only. **Cache epoch:** `runtimeEpoch` (module counter) increments on switch; every catalog fetch captures the epoch at start and publishes to hot/disk caches only if unchanged at completion; `resetModelsCache()` bumps the epoch, clears hot + disk, and drops `inflightFetch` (the stale promise then finishes without publishing).

**1h. Adapter-owned restart advice with pending-change state (S16).** Persisted `~/.bakin/plugin-settings/models/pending-restart.json` `{ kinds: string[]; since: number; lastAttempt?: { at, ok, error? } }`. After a successful mutation, for each change kind touched, if `runtime.restartAdvice?.(kind)?.needed` the kind is added; `GET /runtime/status` returns `{ pending: boolean, kinds, advice: RestartAdvice | fallback }`; `POST /runtime/restart` calls `runtime.restart()`, clears the file on success, records the failure on error (banner retained with the error). Pi never records (advice `needed:false`). Adapters without the member: generic fallback advice, and pending is recorded (conservative). The `__bakinRuntimeSync` cell, `markConfigDirty`, `markRuntimeRestarted`, their hooks and Team's calls are deleted.

**1i. Verify #907 item 5** on the Pi rig before deleting the dirty-marker code; record the outcome in §11.

**Picker presentation in PR 1:** disabled options use the documented label-suffix composition ("GPT-5.6 Luna — no credentials for openai") with `disabled: true`. The `ModelSelectOption` contract change is a separate approval checkpoint at PR 3 start (D23).

### 3.3 PR 2 — Spend page

**New core plugin `spend`** (nav "Spend" under Operations; `/spend`; `?tab=overview|limits`, `?window=`, `?by=`). **Ownership:** spend owns limits, billing lanes AND pricing — hooks `spend.getBudgetPolicy`, `spend.resolveBilling`, `spend.priceTurn`, `spend.priceImage`, `spend.updateBudgetPolicy` (narrow, repair-only). Storage `~/.bakin/plugin-settings/spend.json` `{ limits: { rules: BudgetRule[] (with id), acceptUnattributedBefore? }, billing: { overrides } }`. Curated catalog data moves to `packages/core/src/llm/model-catalog.ts` so neither plugin imports the other.

**Cutover is ONE commit** (D26): the settings upgrade, the hook switch, the replacement editing surface (`PUT/GET /limits`, Limits tab in at least its list form), consumer/caller repointing, and deletion of the Models budget routes/UI land together. Pure code moves (billing, health check, schemas, overview components) precede it as behaviour-neutral commits while Models still owns the hooks. No intermediate commit has two writable policy stores.

**Boot ordering & fail-closed (S13):** plugins activate before the dispatch loop starts (`server.ts:156` vs `startup-recovery.ts:56`). `budgetGate` treats a MISSING or THROWING `spend.getBudgetPolicy` as fail-closed (`budget_policy_unavailable`, audited once, board label "Spend policy couldn't be loaded"). A **health-plugin-owned** check `spend.policy-available` (in `plugins/health/lib/system-checks/`) verifies the hook is registered and answers — a plugin cannot report its own activation failure. Empty `rules` from a healthy hook ⇒ allow.

**Tab "Overview":** window `SegmentedControl`; lane-honest `StatGroup` (a "not metered" tile state instead of "$ unavailable" when a lane has no metered rows); **pace line** with basis ("based on N observed days"; `paceProjection` null ⇒ "not enough of the month has passed"); `AreaChart` + metric toggle; `SpendBreakdown` (Agents/Providers/Models/Work types). Archetype `recipes/settings-dashboard-pages — DashboardOverview`.

**Tab "Limits":** no rules → informational `SystemState` ("No spending limits. Bakin records everything; set a limit once you know what normal looks like.") + `[Set a spending limit]`; rules → `ListRows` (scope · lane · window · `$42 of $100 (42%)` `Progress` with 50/75/90 ticks · reaction badge · next reset · edit/remove via `recipes/destructive-settings-flow — SettingsFlow`); "Add a limit for…" (agent/provider/model); `DisclosurePanel` "Billing lanes"; `DisclosurePanel` "This period's milestones"; header actions: kill switch Pause/Resume dispatch (the global red bar stays in the shell). Archetype `SettingsCategories`.

**Guided setup (`Overlays/Dialog`, two sections):**
1. *What you spend* — per lane: observed total on covered days, "N of the last 30 days observed", normalized monthly rate, projection. Lane radio when both lanes have rows.
2. *Set a limit* — monthly `Input`. **Coverage (D27):** a day counts as covered only when a usage scan completed with `coverage.status === 'complete'` on that day (recorded in the `scan_days` table in usage.db — approved, §11 Q3); zero-usage covered days count. **Suggestion:** requires ≥ 14 covered days in the last 30 AND no `spend_evidence_*` gaps on those days AND non-zero spend; numerator = spend on covered days ONLY (historical backfill on uncovered days is excluded from the rate but shown as "plus $X on unobserved days"); suggestion = `roundToNice(1.5 × coveredSpend / coveredDays × 30)`; copy shows the basis. **Aggregation contract (D32):** covered and uncovered totals come from the ONE spend engine — `assembleBudgetSpend` gains a day-set variant (`assembleSpendForDays(days, now)` in `src/core/budget-spend.ts`) that applies the same attribution, observed-minus-attributed overlap reconciliation, lane classification and evidence-gap rules to a selected set of days. The spend plugin performs no spend arithmetic of its own; the suggestion agrees with the Overview numbers by construction. Otherwise empty field + "Not enough observed history yet — enter a number, or come back in N days." Optional daily `Switch`. Reaction `RadioGroup`: **Wait for the next period** (persists `defer`, default) / **Pause matching work until I raise or resume** (`pause`). Fixed line: "You'll be notified at 50%, 75%, 90% and when the limit is reached. Limits are checked against recorded spend; work already running can finish past the line." Subscription-only: "No metered spend was recorded in this period. A dollar limit would only apply if metered usage appears. You can limit subscription tokens instead — that caps Bakin's usage, it is not your provider's allowance." Save → `PUT /api/plugins/spend/limits` (zod: unit-per-lane, monthly required, `atCap: 'defer'|'pause'`, server-assigned `id`, no `warnPct`).

**Enforcement behaviour table (authoritative for copy, tests, docs):**

| Situation | What is blocked | In-flight work | Auto-resets | Operator actions |
|---|---|---|---|---|
| `defer` ("Wait") limit at 100% | New dispatch + billed media matching the rule's scope × lane | finishes | at window rollover | Raise limit (resumes now); Acknowledge (silence, keep waiting) |
| `pause` limit at 100% | Same scope × lane, AND stays blocked after rollover until resolved | finishes | never | Raise limit to resume (raise + resolve); Resume without raising — offered ONLY when current spend < limit |
| Several limits match one task | Union: any blocking limit blocks | — | each on its own terms | each incident lists the others: "also blocked by …" |
| Spend evidence incomplete/unavailable | Gate defers fail-closed | — | when evidence returns | Board badge "Spend couldn't be verified"; Health `unknown` |
| Spend policy hook missing/throwing | Gate defers fail-closed | — | when the hook answers | Board badge "Spend policy couldn't be loaded"; health-owned check |
| Kill switch | Everything Bakin-initiated | finishes | never | Resume (header / Spend / CLI) |
| Agent-scoped limit | Only that agent's matching work | — | per above | — |
| Effective model dead (PR 1) | That task, pre-claim | — | when the selection is repaired | Board badge "Model can't run" → `/models?ref=` |

**Incident lifecycle (D28):** `budget_incidents` gains additive columns `episode INTEGER NOT NULL DEFAULT 1`, `event_id TEXT`, `notified_at INTEGER NULL`; UNIQUE and blocking semantics unchanged. `openBudgetIncident` on a fresh insert sets `episode=1, event_id=uuid, notified_at=NULL`; on reopen it increments `episode`, mints a new `event_id`, nulls `notified_at`, and updates `at_cap` (so a recreated rule's reaction applies). **Reopen set becomes `raised | window_rollover | rule_removed`** (acknowledged stays suppressed) — this is what makes S14 hold. Deleting a rule still resolves its incidents `rule_removed`.

**Milestones & delivery (D19, D22, D29):**
- `BudgetRule.id` (uuid; assigned by the upgrade). Table `budget_milestones (id, rule_id, win, window_start_ms, milestone, spent_value, cap_value, unit, crossed_at, covered_by INTEGER NULL, event_id TEXT UNIQUE, notified_at NULL, acknowledged_at NULL)` UNIQUE `(rule_id, win, window_start_ms, milestone)`.
- **Authoritative sources:** blocking + red banner = open cap incident; 50/75/90 badges/yellow banner + history = milestone rows.
- **Spend observer** `observeSpend(now)` runs after every `recordSpend`, after each successful usage scan, and on the watchdog tick, coalesced (one in flight; a request arriving during a pass schedules exactly one follow-up pass). Its facet memo is keyed on `(dayStart, rulesRevision, spendGeneration)` where `spendGeneration` increments in `recordSpend` and after each scan — a post-write pass never reuses pre-write totals. Per rule × window: insert missing milestone rows ≤ the highest reached; rows below the highest NEW one get `covered_by=highest, notified_at=now`; **at 100 the observer opens/reopens the cap incident** and marks the 100 row `covered_by=100, notified_at=now` (the incident is the ONE alert for that level).
- **Delivery is at-least-once with stable ids for BOTH tables:** `deliverPending()` selects milestone rows (`< 100`) and cap incidents (open/acknowledged) with `notified_at IS NULL`, sends (SSE `spend.milestone { eventId, … }` / SSE `budget.incident_opened { eventId, episode, … }` + OS notification + relay for incidents), then marks **`SET notified_at = ? WHERE id = ? AND event_id = ?`** — the mark names the exact event it delivered, so a slow episode-1 delivery completing after a reopen leaves episode 2 (new `event_id`) still pending. **One delivery worker:** `deliverPending` is single-flight behind its own mutex with coalescing (a call during a pass schedules exactly one follow-up), shared by the observer, boot, and watchdog callers. It runs at the end of every observer pass, on boot, and on the watchdog tick, so a crash at ANY boundary (milestone insert → incident insert → send → mark) is recovered. Consumers de-duplicate on `eventId` (client seen-set; relay message carries the id). Milestone notifications are aggregated per pass (highest new crossing + count).
- Lowering a limit below spend ⇒ next pass records the newly crossed rows; raising never un-records; `acknowledged_at` on the 90 row = "dismiss for this window".

**Ladder (D9):** 50/75 toast + OS + nav badge (from unacknowledged rows); 90 yellow header `Banner` (dismiss ⇒ `acknowledged_at`); 100 red header `Banner` from the open cap incident (persistent; actions per table) + relay. Task-card labels: "Limit reached" / "Spend couldn't be verified" / "Spend policy couldn't be loaded" / "Dispatch paused" / "Model can't run".

**Nags removed (S8):** Health `policy-missing`; onboarding budget `warn` (component becomes a one-line note, `check()` always ok); `bakin spend` / `bakin budget show` "uncapped" lines; Spend empty-state deficiency framing.

**Caller migration (complete):** header poll → `/api/plugins/spend/status?lite=1`; tasks hook → `/api/plugins/spend/status` (+ `/api/plugins/models/holds`); `use-sse.ts` deep link → `/spend?tab=limits`; health links → `/spend…`; CLI → spend routes; `budget-notify` copy → "Spend → Limits"; generated API docs; bits grep (`../bakin-bits-official`) BEFORE the cutover commit.

**CLI:** `bakin budget set --monthly N [--daily N] [--at-cap wait|pause] [--scope …]` (`wait`→`defer` internally; `--warn` removed); `bakin budget show` prints milestone state; `bakin spend` prints the pace line with basis; group name `budget` stays.

### 3.4 PR 3 — Models page

**Approval checkpoint first (D23):** `ModelSelectOption` gains `description?: string` and `tone?: 'default'|'danger'`; disabled options render the description as secondary text exposed via `aria-describedby`; selected dead value renders danger. Story `forms/model-select.stories.tsx` + `DisabledWithReason`; `design-system/public-api.json` review. Declined ⇒ keep the label-suffix composition.

**Shell:** `/models`, no tabs; `PageHeader` + mode `SegmentedControl`; `?ref=` highlights and, if the ref is in a layer Simple doesn't show, flips the VIEW to Advanced (no write). "Model catalog" `DisclosurePanel` (no "Set default"). States: loading; catalog unavailable; eligibility `unknown`/`partial` info `Alert`; all options disabled; long exceptions list (bounded overflow); narrow (lanes stack); dirty deep-link exit (`/navigation` guard); pending writes (per-ref "saving…" chip until reconciled). Archetype `recipes/settings-dashboard-pages — SettingsCategories`.

**Mode classification without `ui.mode`:** Advanced if any customization exists (below); else Simple; persisted on first visit via a `set` op on `ui:mode`.

**Simple mode (view) — representation & save contract (D24):**
- **Agent lane** = `policy:defaultModel`. "Chat, direct messages, and every task your agents run."
- **Chores lane** shows ONE value only when all five chores routes name the same model and none sets thinking; otherwise **"Mixed (3 models)"** with `[Set all to…]` staging five `set {model}` ops (thinking untouched).
- **Customizations line** = everything Simple cannot express: agent pins ≠ default, subagent pins, dispatch-class routes, `route:send`, any route thinking, tag overrides, fallbacks, aliases, per-chore differences. "N customizations active (…) [View in Advanced] [Reset to this plan…]".
- **Save emits ONLY ops for controls the user changed** (S5). `route:send` is never touched by Simple.
- **Use recommended plan** stages the recommender's ops (may include `route:enrichment → agentModel`) after a diff `ConfirmDialog`.
- **Repairs** stage `set` ops into the draft; Health's one-click repair is immediate with `{from,to,revision}`.
- **Reset to this plan** — immediate from its `ConfirmDialog` via the same `POST /selections` with `snapshot:'reset'`; refused while the page has an unsaved draft. Ops: clear every agent `model`; when supported: clear `subagentModel` per agent, `fallbackModels: []`, `defaultSubagentModel: null`, `aliases: {}` (Pi accepts these; per-agent subagent clears are skipped and disclosed); clear dispatch-class routes, `route:send`, all tag overrides, chores-route thinking; set the five chores routes to the chores value. Undo = `bakin models restore <snapshot>` (PR 1 command: fetch current state + revision → diff → validated mutation; works immediately after a Reset AND after intervening edits, because the diff is computed against the current state).

**Advanced mode:** three `Section`s on one page:
1. **Defaults** — Default model; Fallbacks / Default subagent model / Aliases only when `routingSupport()` supports them (else one muted line "Pi doesn't support fallbacks, aliases or subagent models.").
2. **Agents** — `ListRows`: avatar, name, effective-model badge, "Override" `ModelSelect` defaulting to "Use default model"; subagent column when supported; dead rows carry a danger `StatusMarker` + inline proposal.
3. **Work routing** — `DataTable` of the 11 routable classes grouped "Agent work" (5 dispatch + send) / "Background chores" (5), Model + Thinking selects (options from `supportedThinkingLevels`), collapsible "Tag overrides", "Use recommended routes" (diff dialog, stages ops). `perTurnModel === false` ⇒ `Alert` + read-only columns.
One `SaveBar`; every edit becomes an op; one endpoint; partial-failure UI with Retry; pending chips.

**Recommender (`src/core/model-plan.ts`, absorbs `recommendRoutes`):**
- Candidates = eligible models. Lane requirements: agent lane — none hard (no tool-calling metadata exists); chores lane — vision when enrichment is enabled, from `input` modalities (runtime) then curated catalog, else `unknown`. Unknown never disqualifies; it ranks below known-suitable and is disclosed.
- Ranking: subscription lane — tier asc, known-suitable before unknown, context desc, id; metered lane — `inputPer1M+outputPer1M` asc (unknown price LAST), tier, id.
- Agent pick: current runtime default if eligible; else highest-tier eligible model.
- Chores pick: lightest suitable candidate not heavier than the agent model; no vision-capable candidate in that set but the AGENT model has vision ⇒ `route:enrichment → agentModel` with copy; no eligible model has vision ⇒ "enrichment will fail until a vision-capable model is available", `route:enrichment` unset. Manual chores picks validated the same way.
- "Why" copy: subscription ⇒ "included in your plan · lightest tier that can do these jobs"; metered ⇒ "~$X per 1M tokens vs ~$Y for <agentModel>".
- `bakin models plan [--apply] [--json]` and onboarding call the same function; writes go through `POST /selections`. (`bakin models restore <file>` ships in PR 1 with the snapshot format.)

**Team plugin:** `agent-form.tsx` / `overview-tab.tsx` / `agent-detail.tsx` use the shared model-options hook (eligibility-mapped, refreshed by a `models.catalog_changed` plugin-event; the module-level `useAvailableModels` cache is deleted).

**Onboarding (S7):** `models` component after `llm`: `check()` ok when a persisted plan exists and both lanes are eligible+suitable; interactive shows the plan with reasons → approve/change; `--yes` applies the recommendation (the one permitted auto-apply: fresh install, no plan); none eligible ⇒ `skipped`. `ONBOARDING_VERSION` bump.

**Deletions:** the five tab components, dead Settings `defaultModel` field + `settingsSchema` entry, "Set default", `?tab=`, `models.configChanged` if unused, stale comments.

### 3.5 Cross-cutting

- **Never auto-apply** a persisted model change without a user action. Carve-outs: onboarding `--yes` on a fresh install; roster CARRY on an approved runtime switch.
- **One engine per concern:** eligibility; selections/mutation; recommender; spend assembly (`assembleBudgetSpend`, unchanged); spend observer + delivery; pricing (spend-owned).
- **Runtime-awareness comes from adapters** (`routingSupport`, `credentials.providers`, `restartAdvice`, `unavailableReason`); UI renders results with generic fallbacks; no adapter-id branching upstream of adapters (curated catalog data excepted).
- **Copy discipline:** Simple uses no "lane / route / work class / scope".

---

## 4. Tech stack

Bun 1.3.13 (pinned), TypeScript strict, React 19 + TanStack Router, Zod at boundaries, `bun:sqlite` via `packages/core/src/storage/db.ts` only, `@makinbakin/sdk/{ui,layout,patterns,charts,navigation}` for all UI, public Storybook as the UI contract. No new runtime dependencies expected; adding one is ask-first.

## 5. Commands

```
Dev server (watch):      bun run dev                 (server code not watched — restart manually)
Isolated verify:         /verify skill (temp-home server; never touches ~/.bakin or 3737)
Dev rig (Pi):            bun run instance up --runtime pi
Tests:                   bun run test                (one file: bun test tests/path/x.test.ts --isolate)
CI-equivalent:           bun run test:ci
Typecheck / lint / cycles: bun run typecheck && bun run lint && bun run check:cycles
UI conformance:          bun run ui:conformance --quick (iterating) / --full (merge-ready)
Plugin UI fixture:       bun run ui:test:conformance   (enrollment in scripts/ui/verify-plugin-conformance.ts; report test-results/bakin-ui/index.html)
Stories:                 bun run ui:test:stories
Census / public API:     bun run ui:census:generate --core-only ; bun run ui:public-api:check
Build sanity (never commit generated-version.ts): bun run build:host
```

## 6. Project structure (touched / new)

```
src/core/model-eligibility.ts          NEW  facts → eligibility; explicit runtime + epoch
src/core/model-selections.ts           NEW  enumerate, revision, proposals, serialized tri-state mutate, pending-writes reconcile, same-id helper
src/core/model-plan.ts                 NEW  ONE recommender + plan read/write (absorbs recommendRoutes)
src/core/spend-observer.ts             NEW  crossings + incident-at-100 + deliverPending (coalesced, generation-keyed memo)
src/core/model-availability.ts         KEEP #852 observation
src/core/roster-reconcile.ts           EDIT import shared same-id helper
src/core/runtime-switch.ts, switch-report.ts   EDIT reconcile-selections phase; epoch bump + resetModelsCache
src/core/budget.ts, budget-notify.ts   EDIT crossed; delivery from durable rows; warnPct gone
src/core/dispatch-turns.ts + dispatch-{cycle,single,workflow,team}.ts + media-gate.ts   EDIT preDispatchGate; hook names; new causes
src/core/agent-cost.ts, budget-spend.ts   EDIT hook rename; spendGeneration; observer call
src/core/usage-history.ts              EDIT scan_days write on complete coverage
src/core/dispatch-failures.ts          EDIT translation
src/core/onboarding/{models.ts NEW, budget.ts → note, index.ts, state.ts}
packages/core/src/adapters/runtime/{concepts.ts, testing.ts}   EDIT three optional members + mocks
packages/core/src/execution/ledger.ts  EDIT v10: budget_milestones + incident episode/event_id/notified_at columns + reopen set
packages/core/src/usage-history/store.ts   EDIT scan_days table (approved, Q3)
src/core/budget-spend.ts               EDIT assembleSpendForDays(days, now) — same engine, day-set variant (D32)
packages/core/src/plugins/settings-store.ts   EDIT atomic write
packages/core/src/llm/model-catalog.ts NEW  curated catalog data (moved)
packages/adapter-pi/src/*, packages/adapter-openclaw/src/*   EDIT implement the three members
tests/integration/runtime-conformance/*   EDIT pins + teeth + runner knobs
plugins/spend/                         NEW  core plugin (14th): index, client, overview-tab, limits-tab, limit-dialog, spend-badge-provider, lib/{routes,limit-routes,billing,pricing,register-hooks,settings-upgrade,health-checks}
plugins/health/lib/system-checks/spend-policy.ts   NEW  health-owned hook-availability check
plugins/models/                        REBUILD components (simple-mode, plan-lane, customizations-line, reset-dialog, advanced-mode, defaults/agents/routing sections, selection-callout, catalog-panel); routes /selections /plan /holds /runtime/status; health: models.dead-selections; DELETE budget/spend/billing + old write routes + tabs
plugins/team/{lib/routes/agents.ts, index.ts, components/*}   EDIT drop dirty-marker hooks; shared options hook; /selections
plugins/tasks/hooks/use-budget-status.ts (+ new use-model-holds.ts), task-card.tsx   EDIT hold reasons + links
packages/host/src/components/layout/header.tsx   EDIT computed banner offsets; 90/100 banners
packages/host/src/{routes/spend.tsx NEW, router.ts, lib/route-shadow.ts, components/layout/nav-placement.ts}
src/lib/{core-plugin-ids.ts, plugin-static-imports.ts}, bakin.config.ts, scripts/ui/verify-plugin-conformance.ts, design-system/census.json (regenerated)
src/hooks/{use-model-options.ts NEW, use-available-models.ts, use-runtime-status.ts, use-sse.ts}
src/cli/commands/{budget.ts, models.ts NEW (restore in PR 1; plan in PR 3)}, cli/bakin.ts, src/core/cli/registry.ts
packages/sdk/src/patterns/picker-patterns.tsx + storybook/public/forms/model-select.stories.tsx   EDIT (D23, approval)
.claude/knowledge/{models-plugin, doctor-and-health-checks, runtime-capabilities, adapter-architecture, execution-ledger, dispatch}.md, NEW spend-plugin.md
.claude/specs/cost-control-v2.md       EDIT status pointer
CLAUDE.md                              EDIT Work-Class Routing + Cost Control + Models Cache paragraphs; plugin count 13→14; runtime data dir (spend.json, pending-writes/pending-restart/snapshots)
README.md                              CHECK
```

## 7. Code style

CLAUDE.md conventions apply. Representative snippet:

```typescript
// src/core/model-eligibility.ts
export type EligibilityFact = { known: true; value: boolean } | { known: false }
export interface EligibilityFacts {
  // Every fact reads TRUE = fine, so "eligible iff all known-true" has one polarity.
  inCatalog: EligibilityFact
  runtimeAvailable: EligibilityFact
  credentialed: EligibilityFact
  notRejected: EligibilityFact
  runtimeReason?: 'no_credentials' | 'not_configured' | 'other'
}
export type Eligibility =
  | { status: 'eligible' }
  | { status: 'ineligible'; reason: 'no_credentials' | 'account_rejected' | 'runtime_unavailable' | 'not_in_catalog'; detail: string }
  | { status: 'unknown'; detail: string }

// derive(): first known-false fact wins; runtimeAvailable=false + runtimeReason 'no_credentials' ⇒ no_credentials;
// no known-false + any unknown ⇒ unknown. A failed credential read never clears a known rejection.
```

Conventions that bite: classify runtime failures by `kind`/structured fields only; `getBakinPaths` mocks include `db` (and `media` where the sharp loader is reachable); every new health incident carries a `class`; ledger tests `closeDb()` before `rmSync`; `const` over `let`; no empty catches; `waitUntil`/`settleFor` from `tests/helpers/wait.ts`, never sleeps.

## 8. Testing strategy

- **Unit:** eligibility facts (Pi auth-false ⇒ `no_credentials`; OpenClaw `partial` ⇒ `unknown` for undiscovered providers with known rejections still `ineligible`; runtime false w/o reason ⇒ `runtime_unavailable`; authFree); proposals + stale refusal; revision coverage (thinking, fallback order, aliases, mode); **mutate tri-state** (settled/failed/pending; **timeout → intervening GET → retry refused `write_pending` → late settle → intended value, no overlap**; two refs on one document share one reservation; prior-boot record classified by re-read; concurrent ⇒ one 409; partial + retry-of-failed with new revision; capability refusal; snapshot before reset; Pi skips subagent clears); **restore** (immediately after Reset; after an intervening edit; stale-revision retry); **cache epoch** (stale fetch completing after a switch does not publish); **observer + delivery** (49→101 four rows + covered_by; incident opened w/o dispatch; raise + re-breach ⇒ episode 2 + new event_id; **reopen during in-flight delivery marks only `(id, event_id₁)`, episode 2 stays pending**; single delivery worker coalesces boot/watchdog/observer callers; delete→recreate→breach→rollover pause survives (S14); generation-keyed memo never serves pre-write totals; deliverPending recovers a crash between insert and send and between send and mark); **coverage** (unavailable roster with `failed:0` ⇒ not covered; zero-use complete day ⇒ covered; backfill on uncovered days excluded from the rate; < 14 ⇒ no prefill; 14 days at $10/day ⇒ ~$450; **the same $10 present in both `run_costs` and usage.db counts once and the suggestion equals the Overview figure**); **pre-dispatch gate** (inherited dead pin, inherited dead default, healthy uncapped dispatch, uncapped model hold with `/models?ref=` link); **restart advice pending state** (S16 matrix); recommender ranking + Codex-only vision + no-vision branches; onboarding `models` (interactive/`--yes`/none eligible); CLI parsing.
- **Route tests (`tests/plugins/test-helpers.ts`):** `400 model_not_eligible` on every write surface; `unknown` passes with warning; `/selections` 409s; `/holds` shape on zero-limit installs; `PUT /limits` unit-per-lane; spend `status` shape parity; settings-upgrade crash matrix (each step interrupted, idempotent resume, backup never overwritten).
- **RTL (`actRender`, `rtl-settle`):** Simple = two selects + customizations line; mode classification; `?ref=` flips view; Reset dialog lists every removed setting; Advanced hides/shows per support fixture; `perTurnModel=false` notice; disabled options expose reasons; header banners 0–3 stacked; Resume not offered while over limit; task-card hold labels incl. "Model can't run"; pending chips; all named states.
- **Runtime conformance:** three optional-member pins + secret ban + `restartAdvice` shape; teeth for each.
- **Integration (rig / `/verify`):** S1 (dead pin written directly to the Pi registry fixture), S3, S7, S9 (synthetic `run_costs`), S13 (hook missing), S16.
- **Architecture:** provider-status type field ban; no adapter-id literal in `plugins/models`/`plugins/spend` outside data; `no-hard-navigation` unchanged; `VISION_MODELS` not imported by `model-plan.ts`; core-plugin-ids lockstep; route-shadow; official-plugin-conformance enrollment.
- **UI conformance:** `--quick` per iteration; `--full` before each PR is merge-ready; `ui:test:conformance` fixture + `test-results/bakin-ui/index.html` inspection for `plugins/spend` (PR 2) and `plugins/models` (PR 3); `ModelSelect` story + public-api review (PR 3, on approval); no baseline regeneration without before/after evidence and explicit approval.
- All filesystem tests mock both content-dir resolvers + OpenClaw home; ledger tests `closeDb()` before `rmSync`.

## 9. Boundaries

**Always** — `lint && typecheck && test` before every commit; `ui:conformance --quick` for UI commits; branch in the main checkout and live-test the final tip before merge; keep "never auto-apply"; update knowledge docs + CLAUDE.md in the same PR; kill any dev server you started; every commit leaves a working system (no intermediate dual policy stores).

**Ask first** — `ModelSelectOption` contract change (D23, PR 3 start); any data addition beyond `scan_days` (approved, Q3); ledger changes beyond `budget_milestones` + the three additive incident columns + `BudgetRule.id`; new dependency; touching `bakin-bits-official`; repinning bun/antfly; any new public token/archetype/baseline/exception.

**Never** — auto-apply outside the two carve-outs; let secret values cross the runtime boundary; classify failures by message text; add a parallel spend engine / recommender / routing config / stat tracker; ship dual-shape readers or feature flags for removed surfaces; serve a compiled binary with a throwaway `BAKIN_HOME`; commit `generated-version.ts`; regenerate a baseline/freeze/allowance to make a check pass; release the mutation mutex while an adapter write's outcome is unknown without recording it pending.

## 10. Data upgrades, commit & rollback

**One-shot, crash-safe upgrade (PR 2 cutover commit), idempotent:**
1. If `spend.json` has `limits` ⇒ done (destination validity is the completion marker).
2. If `models.json` has `budget`/`billing`: write `models.json.pre-spend.bak` **only if absent**.
3. Build the spend document (assign `id` per rule; drop `warnPct`; `atCap` unchanged), validate (zod), write `spend.json` via tmp+rename.
4. Then remove `budget`/`billing` from `models.json` (tmp+rename). A crash between 3 and 4 leaves both; step 1 short-circuits and a "source keys still present" check retries step 4.
5. Ledger v10: `CREATE TABLE budget_milestones …`; `ALTER TABLE budget_incidents ADD COLUMN episode … DEFAULT 1`, `ADD COLUMN event_id TEXT`, `ADD COLUMN notified_at INTEGER`; backfill `event_id` for existing open rows; UNIQUE untouched.
6. usage.db: `CREATE TABLE scan_days …` (Q3, approved).
The gate is fail-closed until the spend hooks answer (S13), so a mid-upgrade crash never runs uncapped.

**PR 1 data:** none persisted beyond the new `pending-writes.json` / `pending-restart.json` files (created lazily). **PR 3:** derive `ui.mode` if absent.

**Rollback (honest):** code revert restores behaviour, not data.
- PR 1: revert-merge; the pending files are inert to older code.
- PR 2: revert-merge + restore `models.json.pre-spend.bak`; the additive ledger columns are ignored by older code (documented in the PR body).
- PR 3: revert-merge. A regretted Reset is undone with `bakin models restore <snapshot>`, which ships in PR 1 and therefore still exists on a version that has reverted PR 3; it diffs the snapshot against the CURRENT state and submits with the current revision, so it is valid immediately after the Reset and after later edits alike.
- Supported downgrade boundary = previous merged PR.

**Commit chains** — see the plan (`tasks/plan-models-and-spend-overhaul.md`), which marks each PR's point of no return.

## 11. Open questions

1. Pi "cached roster" (#907 item 5) — verify on rig before deleting the dirty-marker code.
2. OpenClaw `restartAdvice('routing-policy')`: does the gateway need a restart for `agents.defaults.model.*` changes, or does its mtime-cached config suffice? Confirm in the adapter task.
3. **`scan_days` table in usage.db — APPROVED 2026-09-21** ("fine if strictly necessary"). Necessity: usage rows exist only when tokens were spent and scan state is per session, so no existing data distinguishes "zero usage that day" from "not observed that day"; a per-day receipt is required for an honest coverage basis, and a table in the DB the scanner already writes is the single-write-path form of it. Scope is fixed: `scan_days(day TEXT PRIMARY KEY, first_scan_at INTEGER, last_scan_at INTEGER)`, written only when `coverage.status === 'complete'`, pruned to 90 days.
4. `ModelSelectOption` contract change — D23 checkpoint at PR 3 start.
5. Bits consumers of `models/{spend,budget,billing}` — grep before the PR 2 cutover commit.

---

## 12. Decisions log

| # | Decision |
|---|---|
| D1–D3 | One initiative, three PRs; two-lane recommended plan; Simple/Advanced toggle. |
| D4 | Simple is a view; customizations disclosed; Reset is explicit, snapshotted, immediate from its dialog. |
| D5 | Dead selections: propose, never auto-apply (carve-outs §3.5). |
| D6–D7 | Spend is its own page; limits off by default; guided setup from observed history. |
| D8–D9 | Fixed milestones; ladder 50/75 toast, 90 yellow, 100 red (the cap incident). |
| D10–D16 | Onboarding plan step; hide unsupported controls; CLI follows data + `bakin models plan`; adapters own runtime-awareness; recommender picks; disabled-with-reason; delete don't shim (one-shot upgrades with backups). |
| D17 | PR order: trust → Spend → Models. |
| D18 | Spend owns limits, billing lanes AND pricing hooks; curated catalog data moves to `packages/core`. |
| D19 (revised) | `budget_milestones` keyed by `rule_id`; `budget_incidents` gains ADDITIVE `episode`/`event_id`/`notified_at`; UNIQUE + blocking semantics unchanged; observer opens the cap incident at 100%. |
| D20 | `send` rides the agent lane. |
| D21 | Persisted/ledger reaction enum stays `defer|pause`; "Wait" is UI/CLI vocabulary. |
| D22 (revised) | Delivery is at-least-once from durable rows for BOTH milestones and incidents (`deliverPending`), stable `event_id`, consumer de-dupe; lower milestones `covered_by` at record time. |
| D23 | `ModelSelectOption` contract change is an approval checkpoint at PR 3 start; PR 1 uses label-suffix composition. |
| D24 | Simple save writes ONLY ops for controls the user changed; mixed chores render as "Mixed (N)". |
| D25 | ONE write route (`POST /selections`, serialized, revision-checked, capability-checked). |
| **D26 (new)** | PR 2 ownership cutover is ONE commit (upgrade + hooks + replacement edit surface + repoint + delete old writes); pure moves precede it. A health-owned `spend.policy-available` check reports Spend's own activation failure. |
| **D27 (new)** | Coverage = days with a `coverage.status:'complete'` scan receipt; suggestions use spend on covered days only, ≥ 14 covered days, basis shown. |
| **D28 (new)** | `openBudgetIncident` reopen set = `raised | window_rollover | rule_removed`; reopen bumps episode, mints `event_id`, updates `at_cap`. |
| **D29 (new)** | Mutation writes are tri-state (ok / failed / pending-unknown); pending refs are persisted, block conflicting mutations (`409 write_pending`), and reconcile on read/boot/tick. Catalog fetches publish only under an unchanged runtime epoch. Observer memo keyed on spend generation. |
| **D30 (new)** | Restart advice pairs with persisted pending-change state (`pending-restart.json`), cleared only by a successful `restart()`. |
| **D31 (new)** | Pre-dispatch model hold evaluates the EFFECTIVE selection in the agent's credential context and is surfaced by models-owned `GET /holds`, independent of budget status. |
| **D32 (new)** | Reservations are per DOCUMENT (policy / agent:<id> / routing) and are released only on in-process settle or prior-boot classification — never by a read. Delivery marks `(id, event_id)` through one coalesced worker. Coverage spend comes from a day-set variant of the ONE spend engine. Snapshots are full state; `bakin models restore` (PR 1) diffs against current state under the current revision. |
