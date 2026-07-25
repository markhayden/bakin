# Usage Attribution & Health Sensitivity

**Issues:** #689 (Codex subscription transcript costs misclassified as metered spend) · #691 (honest buckets for non-task usage) · #690 (Health sensitivity modes)
**Date:** 2026-07-17 · **Status:** Approved pending final review
**Branch:** `feat/usage-attribution-health-sensitivity` (single branch in the main checkout, sequenced #689 → #691 → #690, per-issue commit checkpoints)

## 1. Objective

Make Bakin's cost/health story *emotionally honest*: what the user sees and feels must match ground truth.

Today's failures, through the user's eyes:

- **#689** — A red "$5.49 of $5.00 daily cap" budget incident fired for Codex subscription usage that cost zero marginal dollars. The user feels billed behind their back; the number is fiction (runtime-reported theoretical cost on rows whose bare model IDs resolve to provider `other` → lane `metered`).
- **#691** — Health says *"main used 10.2M tokens outside Bakin-managed tasks — review its recent sessions."* The user hears "hidden runaway work." Ground truth: ~10M of it was the user's own long interactive Pi session. The check cannot tell benign from suspicious, so its wording is vague-scary for both.
- **#690** — Health mixes real outages, accounting-evidence gaps, housekeeping, guardrail denials, and unsupported-surface noise at similar visual weight. A normal user's first impression is "everything is on fire" when nothing user-impacting is wrong.

After this initiative:

- Subscription usage never books dollars anywhere. Unresolvable billing evidence shows as a calm, named evidence gap — never a confident false alarm.
- The non-task delta splits into **interactive sessions** (advisory: "this was you, or someone, chatting with the agent directly") vs **unexplained** (watch: "Bakin genuinely can't account for this — look"). Scary language ("possible runaway") appears only when a dedicated heuristic can back the claim — and then it is *loud* (action_required, pages in every mode).
- A `doctor.sensitivity` mode (`developer` | `standard` | `quiet`, default `standard`) applied **centrally** in the health-report projection gives every consumer (UI cards, nav badge, escalation/notifications, CLI) one consistent story. Every incident carries a class rendered as a plain-language category chip, so cards explain *what kind* of problem they are.

## 2. Root-cause facts (verified in code / on disk)

1. Pi **and** OpenClaw transcripts store `provider` and bare `model` as sibling fields on every assistant message (`"provider":"openai-codex","model":"gpt-5.5"`). The parser (`src/core/agent-usage.ts:159`) reads only `message.model` and **discards `message.provider`**.
2. `usage.db` (`session_usage_days_v2`, `packages/core/src/usage-history/store.ts`) stores that bare model verbatim; no provider/lane column. It **does** carry `session_id` per row (Pi: transcript filename; OpenClaw: session UUID), currently discarded by the burn/spend rollups.
3. `normalizeModelId` (`plugins/models/lib/model-id.ts:21`) qualifies only `claude-*`; every other bare ID → provider `other` (`plugins/models/lib/billing.ts:54`) → default lane `metered` (`billing.ts:73`) → theoretical transcript dollars enter `meteredUsdMicros` (`src/core/budget-spend.ts:526`, delta at :545-581).
4. `run_costs` already meters interactive Bakin chat (`work_class: 'chat'`), relay/enrichment/auto-title/send — all netted out of the burn delta. The remaining delta is **sessions Bakin never mediated** (Pi TUI, Claude Code driving the runtime, etc.).
5. Session provenance exists but is unexposed:
   - Pi: `<sessions-dir>/bakin-threads.json` maps every Bakin threadId → session file (`packages/adapter-pi/src/sessions.ts:21-89`). Sessions absent from the map are external/interactive.
   - OpenClaw: Bakin sessions use deterministic v5 UUIDs (`deterministicUuid('bakin:<agent>:<threadId>')`, `session-store.ts:88-117`) and `agent:<id>:explicit:<uuid>` keys; interactive/channel sessions carry distinct key shapes (`:main`, `:discord:*`, `:openai:*`) and `origin` metadata.
   - The `RuntimeMemoryEntry` contract has a free-form `metadata` bag (`packages/core/src/adapters/runtime/concepts.ts:426-434`) — origin labeling needs no contract change.
6. `tests/core/budget-spend.test.ts` pre-qualifies model IDs in fixtures (`openai-codex/gpt-5.5-codex`), hiding the production bug. A bare-ID regression fixture is mandatory.
7. Health has no audience/sensitivity notion anywhere; burn incidents render as amber "Watch" cards; only `action_required` incidents escalate/notify (`src/core/doctor-escalation.ts:31-35`).

## 3. Approved design decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Packaging | One branch, sequenced #689 → #691 → #690, commit checkpoints at issue boundaries |
| D2 | #689 fix site | Qualify at ingestion + one-time re-scan of derived usage.db; read paths stay dumb |
| D3 | #689 mechanism | Read the transcript's own `message.provider` (authoritative, per-message); **no** registry suffix-matching |
| D4 | Unresolvable observed IDs | Evidence gap (`lane_unknown`), never metered-by-default dollars; root-cause coverage makes this a true edge case (empty/missing provider or model fields only) |
| D5 | #690 mechanism | Sensitivity applied **centrally** in the health-report projection (class × mode → effective disposition); raw producer disposition preserved on the incident |
| D6 | #690 setting | `doctor.sensitivity: 'developer' \| 'standard' \| 'quiet'` in core `~/.bakin/settings.json`, System & Alerts dropdown, default `standard`; takes effect next doctor cycle, no restart |
| D7 | #690 taxonomy | Class enum stamped by producers on incidents only (Activity failure feed untouched); unclassified defaults to never-demoted; class renders as a plain-language chip |
| D8 | #691 approach | Real provenance split: adapters label session origin via entry `metadata`; usage.db stores provenance; burn splits interactive (advisory) vs unexplained (watch) |
| D9 | #691 runaway | Build the minimal heuristic **now** (autonomous-turn density + composition signals); `action_required` in **all** sensitivity modes |
| D10 | Quiet mode semantics | Quiet earns its slot at the notification layer: only `action_required` badges/escalates; watch items stay visible on the Health page but never notify (user-review round, 2026-07-18) |
| D11 | Runaway cron guard | Feature-detect the runtime's read-only cron surface; when the runtime reports scheduled jobs for the agent, runaway downgrades to watch with copy naming the jobs — the page never lies about legitimate autonomous work |
| D12 | Evidence-gap loudness | Producer-side split: a gap leaving a configured budget rule unevaluable stays raw **watch** (badges in standard — "your cap can't currently be verified"); gaps touching no rule are raw **advisory**. Projection does not cap `evidence_gap` at all |

## 4. Detailed design

### Phase 1 — #689: honest billing lanes for observed usage

**Parser** (`src/core/agent-usage.ts`): `parseSessionUsageMessages` reads `message.provider` alongside `message.model` and emits the qualified ID `provider/model` when provider is present; bare model kept only when provider is genuinely absent. Also parse per-message `role` counts (needed by Phase 2; do the schema work once).

**Store** (`packages/core/src/usage-history/store.ts`): migration **version 4** on the existing `session_usage_days` table (as built — v3 already existed as the wipe-and-rescan precedent; scan state is the `session_scan_state` table inside usage.db, there is no offsets file):
- `model` now holds the qualified ID (`openai-codex/gpt-5.5`), or bare/`''` only in the missing-provider edge case.
- New columns (Phase 2 uses them; created here to avoid two migrations): `origin TEXT NOT NULL DEFAULT 'unknown' CHECK(origin IN ('bakin','external','unknown'))`, `user_messages INTEGER` (each user message attributes to the next usage-bearing assistant message; trailing turns to the session's latest bucket). `message_count` already IS the token-bearing assistant-turn count, so no `assistant_messages` duplicate.
- Migration: drop/recreate `session_usage_days` + `DELETE FROM session_scan_state` so the next timer sweep performs a full re-scan (derived data; no back-compat shims — single-user machine). `origin` defaults `'unknown'` until Phase 2 lands adapter metadata.

**Budget spend** (`src/core/budget-spend.ts`): `resolveObservedLane` also reads `provider` from the `models.resolveBilling` result; `provider === 'other'` (unresolvable) → return `null` → existing `lane_unknown` evidence-gap path (no dollars, named model in the gap record). The `models.resolveBilling` hook contract is unchanged; the dispatch/`priceTurn` path is untouched (always qualified).

**No change** to `normalizeModelId`'s claude-only rule and no static bare-ID→codex map (bare `gpt-*` is ambiguous by design; the transcript provider is the disambiguator).

**Outcome check:** after re-scan, the open false `budget_incidents` row (global metered daily cap) must recompute below cap; verify it resolves (or ack it) during live testing. Codex days show under subscription token totals; metered image/API spend still books dollars.

### Phase 2 — #691: provenance buckets + runaway

**Adapters** — session-tier `listEntries`/`getEntry` attach entry `metadata`:
- Pi (`packages/adapter-pi/src/memory.ts`): reverse-index `bakin-threads.json` (session file → threadId); emit `origin: 'bakin', originThreadId` for mapped files, `origin: 'external'` otherwise; map unreadable → `origin: 'unknown'` (honest fallback, never guessed).
- OpenClaw (`packages/adapter-openclaw/src/memory.ts`): `origin: 'bakin'` when the session UUID is the deterministic v5 shape / `explicit` Bakin key; `origin: 'external'` for `:main`, channel, `:openai:*`, and v4-explicit sessions; enrich from `sessions.json` `origin` where present.
- Dev mock + runtime-conformance suite: a shared behavioral check pins the metadata convention (adapters that expose a `session_jsonl` tier must label origin or omit metadata honestly — never mislabel).

**Scanner** (`src/core/usage-history.ts`): persist `origin` + role counts onto v3 rows.

**Burn engine** (`src/core/agent-burn.ts`) — the one engine splits the delta:
- `interactiveTokens` = observed tokens from `origin='external'` sessions.
- `unexplainedTokens` = max(0, observed `origin∈{'bakin','unknown'}` − attributed) (null-honest throughout; unknown-origin never silently counts as interactive).
- Flag changes: retire the single `unattributed` flag kind. New kinds:
  - `interactive` (advisory, all modes): *"'main' used 10.2M tokens in interactive runtime sessions (direct chats/TUI) not tied to board tasks — normal if you were working with this agent directly."*
  - `unexplained` (watch): *"'main' used 1.1M tokens Bakin could not attribute to tasks, system sends, or interactive sessions — review its recent sessions."* Strengthened copy when the spike flag fires the same day (*"…and is well above its daily average — review soon"*).
  - `runaway` (action_required, all modes): fires only with real indicators — an external/unknown session accumulating ≥ `burn.runawayAssistantTurns` (default 20) token-bearing assistant turns and ≥ `burn.runawayFloorTokens` (default 1M) tokens with **zero** user turns in the window; OR `unexplained` ≥ floor AND spike ≥ multiplier the same day. Copy: *"'main' shows possible runaway usage: N autonomous turns / X tokens with no user interaction — investigate now."* Structural exclusions: sessions mapped to Bakin threads (they're attributed), zero-token sessions (heartbeats).
  - **Cron guard (D11):** before emitting `runaway` at action_required, feature-detect `runtime.cron` and list the agent's scheduled jobs (read-only). If any exist, downgrade to a watch-level flag with honest copy: *"'main' has high autonomous usage and also has N scheduled jobs (\<names\>) — review if unexpected."* Cron surface unavailable or errors → no downgrade (fail loud, not silent).
- New tunables in `settings.burn` + System & Alerts fields: `runawayAssistantTurns`, `runawayFloorTokens`.
- Health check (`plugins/health/lib/system-checks/agent-burn.ts`): emits distinct observations/incidents per bucket with stable keys (`interactive:<agent>`, `unexplained:<agent>`, `runaway:<agent>`), structured `evidence` (token figures, session counts — UIs never parse copy), `{kind:'agent'}` resources, navigate-resolution to Team Diagnostics. Runaway incidents ride the existing `action_required` escalation (agent notify / delegated task) unchanged.
- Team Diagnostics: existing surfaces read the new flag kinds via evidence; copy updated. (Per-session drill-in table deferred — not selected.)
- Coverage honesty preserved: no fabricated zeros; incomplete coverage still yields Unknown observations.

### Phase 3 — #690: sensitivity modes

**SDK** (`packages/sdk/src/types/health.ts`):
```ts
export type HealthIncidentClass =
  | 'service_failure' | 'data_integrity' | 'budget_block'
  | 'evidence_gap' | 'usage_anomaly' | 'unattributed_usage' | 'runaway_usage'
  | 'cleanup_backlog' | 'policy_denial' | 'unsupported_surface'
export type HealthSensitivity = 'developer' | 'standard' | 'quiet'
```
Incident gains `class?: HealthIncidentClass` (producer-stamped; absent ⇒ treated as `service_failure`, never demoted — a missing stamp can never hide an outage) and projected `effectiveDisposition: HealthDisposition` (raw `disposition` preserved). `HealthReport` gains `sensitivity` on the wire — the badge/CLI cannot apply the D10 quiet filter without it. *(Note: the interview approved 8 classes; `unattributed_usage` and `runaway_usage` were added as direct fallout of the D8/D9 decisions so each class has exactly one cap rule per mode.)*

*(As-built corrections: `plugins/health/lib/route-schemas.ts` (.strict() incident/report schemas + the summary superRefine) and `src/core/health-contract.ts` (incident-input zod, which doubles as the invalid-class-string guard — stronger than a text-scan architecture test) must change in the same commit or `/doctor` breaks; `semanticProjectionKey` in `doctor-report-cache.ts` must include sensitivity + effective dispositions or mode flips are swallowed by the projection-dedupe cache; the D11 cron guard executes in the health-check/route layer with cron evidence passed INTO the pure engine — and since CronJob carries no agent attribution, the guard is runtime-wide by design.)*

**Projection** (`src/core/health-report.ts`): one central table caps effective disposition per (class × sensitivity). Caps only ever lower, never raise; incidents with observation status `'error'` are never demoted (belt-and-braces on top of the uncapped classes):

| class | developer | standard | quiet |
|---|---|---|---|
| service_failure, data_integrity, budget_block, runaway_usage | raw | raw | raw |
| unattributed_usage | raw | raw (watch) | raw (watch) |
| usage_anomaly (spike, effort-no-outcome, interactive) | raw | ≤ advisory | ≤ advisory |
| evidence_gap | raw (producer-split per D12: rule-affecting = watch, informational = advisory) | raw | raw |
| cleanup_backlog, policy_denial, unsupported_surface | raw | ≤ advisory | ≤ advisory |

**Quiet's real behavior lives at the notification layer (D10), not the caps table:** in `developer`/`standard`, the nav badge and doctor escalation consider effective non-advisory incidents (today's behavior); in `quiet`, only `action_required` badges and escalates — watch items remain visible on the Health page but never tap the user on the shoulder. This is why quiet's caps column can equal standard's without being a placebo.

Overall report status, nav badge (`useHealthSummary`), and doctor escalation (`freshActionRequiredIncidents`) all read **effective** disposition (badge additionally applies the quiet filter) — one consistent story everywhere. Demoted unknown-status observations don't drive overall `unknown_stale` (a collapsed evidence gap must not badge the whole report); non-demoted unknowns keep today's precedence.

**Settings**: `doctor.sensitivity` (`packages/core/src/settings.ts`, default `'standard'`) + System & Alerts dropdown (`src/components/system-settings.ts`). Re-read each doctor cycle.

**Producers**: stamp classes on existing incidents — budget cap breach `budget_block`; budget evidence gap `evidence_gap` with the D12 raw-disposition split (rule-affecting = watch: *"your $X cap can't currently be verified"*; no rule affected = advisory); burn spike/effort/interactive `usage_anomaly`, unexplained `unattributed_usage`, runaway `runaway_usage`; search tombstones `cleanup_backlog`; search canary dark / engine down / plugin activation / ledger unavailable `service_failure` (or `data_integrity` where apt). Audit checks that report intentionally-absent runtime surfaces (e.g. channels on Pi) and convert them to `not_applicable` outcomes or `unsupported_surface` class — "runtime lacks this on purpose" must read as *not applicable*, not failure.

**UI** (`plugins/health/components/incident-row.tsx` + overview): render effective disposition; plain-language category chip per class ("cost accounting", "housekeeping", "guardrail worked", "usage", "not supported here"); in developer mode (or when raw ≠ effective) show the raw disposition subtly ("demoted from watch"). Sensitivity never deletes cards — demoted incidents remain visible as advisories on the Health page; they just stop badging/escalating.

## 5. Commit strategy (rollback checkpoints)

Each commit leaves the suite green (`bun run test`) and the app bootable; rollback = `git revert` from the tail. Conventional commits with scope:

1. `test(core): prove bare codex transcript rows book metered dollars` — failing-first regression fixtures (bare `gpt-5.5` + provider sibling field) for parser, budget-spend, billing. *(Prove-It checkpoint; committed together with 2 if CI-red intermediate commits are undesirable — decided at build time.)*
2. `feat(core): read transcript provider; usage.db v3 with qualified models + rescan` — closes the ingestion half of #689.
3. `fix(models): observed-lane evidence gap for unresolvable model ids` — closes #689. **Checkpoint: budget correctness standalone.**
4. `feat(adapters): session origin metadata (pi, openclaw, mock + conformance pin)`
5. `feat(core): burn provenance buckets — interactive/unexplained/runaway flags + health check + settings` — closes #691. **Checkpoint: honest buckets standalone.**
6. `feat(sdk,core): incident class + doctor.sensitivity + central effective-disposition projection`
7. `feat(health): sensitivity-aware UI, category chips, producer class stamps, unsupported-surface audit` — closes #690. **Checkpoint: presentation layer standalone.**
8. `docs(knowledge): usage attribution, burn buckets, health sensitivity`

Branch stays in the main checkout so 3737 serves it for live testing (test-live-before-merge); merge only after Mark approves live.

## 6. Testing strategy

All tests follow the CRITICAL testing rules (mock both content-dir resolvers, OpenClaw home, `getBakinPaths().db`, logger/watcher; temp dirs + cleanup; `--isolate`).

- **#689**: parser emits qualified IDs from provider-bearing fixtures (Pi + OpenClaw shapes); missing-provider → bare + evidence gap; v2→v3 migration drops/rescans; budget-spend with **bare-ID fixtures** (the gap that hid the bug): subscription rows book zero dollars, `other`-provider rows book zero dollars + named `lane_unknown` gap, metered rows still book; `run_costs` subscription suppression untouched.
- **#691**: Pi origin labeling (mapped/unmapped/corrupt `bakin-threads.json`); OpenClaw origin labeling (v5 explicit / `:main` / channel / v4-explicit); conformance pin for the metadata convention; burn bucket math (interactive vs unexplained vs unknown-origin, null-honesty); runaway trigger/non-trigger (threshold boundaries, zero-user-turn requirement, heartbeat exclusion, spike composition); cron guard (jobs present → watch downgrade with job names in evidence; cron surface absent → no downgrade; runtime without cron member → no downgrade); **wording/severity assertions for all four issue-required cases** (interactive, system, unknown, runaway) via evidence fields, not copy-parsing.
- **#690**: projection cap table (every class × mode); unclassified never demoted; error-status never demoted; badge/escalation/overall-status read effective disposition (at least one incident changes severity between developer and standard — issue acceptance); quiet notification filter (watch incident badges in standard, not in quiet; action_required badges in all modes); evidence-gap D12 split (rule-affecting gap badges in standard, informational gap does not); raw disposition preserved; settings default + re-read; architecture guard (`tests/architecture/health-contract.test.ts`) extended: producers stamping unknown class strings fail.
- **Live verification** (/verify skill or dev rig + real box): rescan produces qualified rows; false budget incident resolves; burn card shows interactive advisory; sensitivity dropdown flips the projection without restart.

## 7. Docs to update

- `.claude/knowledge/models-plugin.md` — observed-lane resolution, evidence-gap default, transcript provider qualification.
- `.claude/knowledge/usage-recording.md` — usage.db v3 schema (qualified model, origin, role counts).
- `.claude/knowledge/agent-health-diagnostics.md` — new flag kinds/buckets, runaway heuristic, class stamps.
- `.claude/knowledge/doctor-and-health-checks.md` — incident class, sensitivity, central effective-disposition projection, producer rules.
- `.claude/knowledge/runtime-capabilities.md` — session-entry origin metadata convention + conformance pin.
- `CLAUDE.md` — one-line updates to the Agent Health Diagnostics / Doctor bullets.
- `README.md` — check at build time; only touch if it describes Health/budget copy (likely unaffected).

## 8. Boundaries

**Always:** frame copy through user experience; keep one engine per concern (burn math in `agent-burn.ts`, spend math in `budget-spend.ts`, projection in `health-report.ts`); structured evidence over prose; null-honest, Unknown-never-healthy; stable incident IDs (copy edits never change identity); adapter boundary (origin determination lives in adapters; core reads neutral metadata).

**Ask first:** any new parallel spend/stat/routing config (banned by CLAUDE.md — none planned); changes to escalation cooldowns/channels beyond reading effective disposition; touching `~/.bakin` production data outside the rescan path.

**Never:** back-compat shims for v2 usage rows or old flag kinds (single-user machine — clean cutover); static bare-ID→provider maps; parsing copy for identity/attribution; demoting `action_required` runaway or error-status incidents; silent fabricated zeros.

## 9. Acceptance criteria (from the issues)

- [ ] Codex subscription turns contribute zero dollars to metered caps; the $5 cap does not fire from Codex text turns alone; subscription token totals still include them; metered image/API spend still counts. (#689)
- [ ] Unknown bare model IDs → named evidence gap, never confident false dollars. (#689, D4)
- [ ] Health distinguishes interactive session usage from truly unknown usage; interactive is advisory in standard mode; copy explains why non-task usage can be fine. (#691)
- [ ] "Runaway" language appears only when the heuristic backs it, and then pages in every mode; agents with runtime-scheduled jobs get the honest watch-level downgrade instead of a false page. (#691, D9/D11)
- [ ] Quiet mode has real behavior: only action_required notifies; watch stays visible but silent. (#690, D10)
- [ ] An unevaluable configured budget rule badges in standard mode — the tripwire never degrades silently. (D12)
- [ ] `doctor.sensitivity` exists; standard demotes policy denials/unsupported surfaces/housekeeping/evidence gaps to advisory; search-canary-dark class failures stay action-required; developer preserves the full view; at least one tested incident changes severity between modes. (#690)
- [ ] Incident cards state their category in plain language; developer mode exposes raw dispositions and full deltas. (#690/#691)
