# Models Plugin — Deep Reference

Two layers fix the cold-start problem where `openclaw models list --all --json` takes 15–20 s and would otherwise force the UI to show fake data (issue #129).

## Layer 1: Persistent disk cache

Path: `~/.bakin/plugin-settings/models/available.json`. Owned by `plugins/models/lib/models-cache.ts`.

- Atomic tmp+rename writes
- Zod-validated reads; silent drop on corruption / schema drift
- Two-level read: in-memory hit → disk hydrate → live fetch → honest empty-with-error (**never** falls back to fabricated data)

`fetchAvailableModels` returns `{ models, stale: boolean, error? }`. The client surfaces cached data immediately and kicks off a background `POST /api/plugins/models/refresh` when `stale` is true.

`POST /api/plugins/models/runtime/restart` calls `resetModelsCache()` — every layer (memory + disk + in-flight) plus a **runtime epoch** bump (#907, D29): a fetch captures the epoch when it starts and publishes to the caches only if it is unchanged when it completes, so a catalog fetch that straddles a runtime switch cannot repopulate the caches with the OLD runtime's models. The runtime switch invokes the same reset through the `models.resetCatalogCache` hook.

## Layer 2: Curated catalog

Path: `packages/core/src/llm/model-catalog.ts` (moved from the models plugin so the spend plugin can price from the same data). Bakin-maintained lookup of ~22 popular models — frontier + OSS, LLM + image + video — with descriptions, tier, cost range, and brand-icon slugs.

Merged into each runtime-sourced `AvailableModel` server-side via `getKnownModel()` / `getKnownProvider()`. Unknown models render plain — **no fabrication**.

## Layer 3: Eligibility overlay (#907; subsumes the #852 rejection overlay)

The runtime catalog LIES about callability (Pi stamps `available` from
provider-level auth over a static SDK catalog — a retired model stayed
"available" for 10 days while four subsystems failed; an agent pinned to
`openai/…` on a box that only has `openai-codex` credentials failed with
"add an API key" advice, #907). Truth is assembled from four INDEPENDENT
facts by the ONE eligibility engine (`src/core/model-eligibility.ts`):

- **inCatalog / runtimeAvailable** — from `listAvailable({ includeUnavailable: true })`.
  The runtime's own `unavailableReason` (Pi: `no_credentials`) is the ONLY
  per-model reason source; `available:false` without one reads
  `runtime_unavailable` — never an invented "retired".
- **credentialed** — from the OPTIONAL `credentials.providers()` inventory
  (status only; `evidence: 'partial'` when OpenClaw's CLI probe failed ⇒
  absent providers are UNKNOWN, never credential-less). `authFree`/`local`
  models need none.
- **notRejected** — from the ledger's `model_rejections` (the #852 signal:
  adapters classify the provider verdict as `model_not_supported`; the
  facade wrapper `src/core/model-availability.ts` records/auto-resolves).

`eligible` iff every fact is known-true; `ineligible` with the FIRST
known-false fact's reason (`not_in_catalog | runtime_unavailable |
no_credentials | account_rejected`); `unknown` when nothing is false but
evidence is missing. A failed lookup never erases an independently known
fact. `applyEligibilityOverlay` runs on EVERY read of the model list
(cache-served included — the `withFreshTiers` posture) and stamps
`eligibility` + `available` (+ `rejection` facts) on the SDK row. Flip-not-
filter: unavailable rows now stay LISTED so pickers can show them disabled
with the reason. NEVER persisted into `available.json`. The credential
inventory is memoised 30 s per (runtime, agent) — OpenClaw shells its CLI.

**Every picker consumes it:** `toModelSelectOptions` (`@makinbakin/sdk/hooks`)
maps rows to `ModelSelectOption`s — `ineligible` ⇒ `disabled` with the
reason as a label suffix ("GPT-5.6 Luna — no credentials for openai"; the
documented composition until D23 gives the option a description field),
`unknown` ⇒ selectable. The Available Models tab badges No credentials /
Rejected by account / Unavailable / Not in catalog / Unverified; "Set
default" is disabled on ineligible rows; `?probe=1` skips runtime-
unavailable rows (a billed call that cannot succeed).

- **Probe (opt-in, manual-only):** `POST /refresh?probe=1` fires the
  runtime's OPTIONAL `models.probe(modelId)` per fetched model (concurrency
  3) and reports per-model verdicts `verified | rejected | skipped` (a
  transport failure proves nothing — honest skip, never a fake verdict).
  Outcomes ride the same evidence pipeline (probe success resolves an open
  rejection). The default refresh, the stale auto-refresh, and the
  `models.refreshAvailableModels` hook are provably probe-free; there is NO
  scheduled probing.

## Selections — the ONE write path (#907, D25/D29)

Every persisted model reference is a **selection** with a stable ref
(`src/core/model-selections.ts`): `policy:defaultModel`,
`policy:defaultSubagentModel`, `policy:fallback:<n>`, `policy:alias:<name>`
(runtime routing policy), `agent:<id>:model` / `agent:<id>:subagentModel`
(roster pins), `route:<workClass>` / `tag:<tag>` (plugin routing settings),
`ui:mode` (page mode). `enumerateSelections(runtime, { routing, uiMode })`
walks all of them; `computeRevision` hashes every (ref, model, thinking) so
any change a mutation can make moves it; `proposeRepairs` offers, per dead
selection, the same model id under a credentialed provider
(`mapModelToCatalog` — the SAME helper the runtime switch's roster carry
uses), else the lane recommender's pick, else `to: null`.

`POST /api/plugins/models/selections` (`src/core/model-mutations.ts`,
composed in `plugins/models/lib/selections.ts`) is the only writer — the
old `POST /config`, `/defaults`, `/aliases` and `PUT /routing` are GONE.
It is serialized process-wide, revision-checked under the lock
(`409 stale_revision { current }`), validates every op (`400
model_not_eligible { reason, proposal? }`; `unknown` passes with
`warnings[]`; `400 unsupported_by_runtime` for knobs the runtime cannot
persist — Pi rejects per-agent subagent pins even to clear), and folds ops
per DOCUMENT (`policy` / `agent:<id>` / `routing`) into one adapter write
each, in fixed order. **Outcomes are tri-state**: `applied`, `failed`, or
`pending` when the adapter has not settled within 10 s — the record lands
in `plugin-settings/models/pending-writes.json` and the document stays
RESERVED until the promise settles in this process (a read never releases
it; a retry is `409 write_pending`). Prior-boot records are classified by
re-read (intended ⇒ resolved; previous ⇒ failed "not confirmed before
restart"; else conflict, reserved until acknowledged). `GET /selections`
returns states + revision + per-selection eligibility + proposals +
pending. Client intents become ops through the pure builders in
`plugins/models/lib/selection-ops.ts` — only refs that changed are sent
(D24). Team's agent-model picker and agent create validate through the
same engine.

**Snapshots** (`snapshot: 'reset'`) are FULL STATE files under
`plugin-settings/models/snapshots/` (bounded 5); `bakin models restore
<file>` diffs one against the CURRENT selections and submits under the
current revision (one 409 retry) — valid right after a Reset and after
later edits.

**Review-round hardening (2026-09-22, #909):**
- **Id resolution is the RUNTIME's.** The report is keyed by the id as
  asked; an `extraIds` entry the catalog does not list verbatim is judged by
  the row the adapter's own `models.resolveId?(ref)` returns (Pi: the SAME
  `findPiModel` rule its turn path uses — exact `provider/id`, else the
  first registry model with that bare id; an ambiguous bare id is therefore
  the runtime's call, and `wrongprovider/real-id` never resolves by bare
  name) and carries `resolvedTo`. A runtime without the member (OpenClaw,
  the mock) runs exactly what its catalog lists, so a non-verbatim id is
  `not_in_catalog` there. `resolveCatalogId(runtime, id)` is the ONE
  feature-detecting helper (engine + dispatch gate); `mapModelToCatalog`
  survives only as the catalog-MIGRATION proposal rule (same-id-under-a-
  credentialed-provider, roster carry) — never a verdict. Round 3 (2026-09-23)
  replaced the round-2 catalog-shape guess that made `gpt-5.5` under two
  providers `not_in_catalog` on Pi (Pi runs it) and `wrongprovider/gpt-5.5`
  eligible (Pi refuses it). Conformance pins the member per adapter
  (`resolveId: 'present' | 'absent'` + honesty: a listed id resolves
  verbatim, an unknown reference to null) with teeth.
- **Agent-scoped credentials.** `evaluateSelections(runtime, states)`
  (`model-selections.ts`) judges every `agent:<id>:*` ref under THAT agent's
  credential inventory (OpenClaw keys them per agent) and everything else
  unscoped; `proposeRepairs` takes its `reportFor`. The mutation plan, the
  selections inventory, doctor proposals and the runtime switch all go
  through it — an unscoped read condemned pins the agent could run.
- **Pending-write race.** Every write to `pending-writes.json` re-reads it
  first — including the pre-write cleanup that drops replaced failures: the
  record list a mutation read on entry is stale by the time `plan()` (async
  eligibility) returns, and a document that settles during planning or while
  a LATER write awaits its deadline must never be resurrected (it would be
  reserved until restart). Pinned by two tests: settle-during-later-timeout
  and settle-during-planning (`hangNextListAvailable` fixture gate).
- **Revision ↔ snapshot pairing (page).** `revisionRef` in
  `use-models-data.ts` is refreshed ONLY by `loadConfig` (the defaults
  snapshot, incl. positional fallbacks). The alias and routing tabs load
  their own snapshots without touching it — a fresher revision paired with
  a stale fallback list would let the server ACCEPT a positional
  `policy:fallback:n` op built against the wrong list. A save adopts the
  returned revision; a stale refusal reloads all three.
- **Doctor repair identity.** `apply-model-proposal` plan items are keyed by
  the exact proposal they displayed (`apply-model-proposal:<sha16 of
  ref|from|to|revision>:<ref>`): a second preview after the configuration
  moved yields different item ids, so applying the first preview applies
  what IT showed (then 409s honestly) — never the newer target. The planned
  map is bounded (256, oldest out).
- **Agent-scoped pickers.** `GET /available?agentId=<id>` overlays
  eligibility under THAT agent's credentials (same `applyEligibilityOverlay`,
  `CatalogScope`); the live load is deduped RAW and overlaid per caller so
  two concurrent scopes never share a verdict. `useAvailableModels(agentId?)`
  caches per scope (Team's agent detail passes its id; the create form stays
  unscoped); the Models page reads one scoped catalog per roster agent
  (`agentModelSelectOptions(agentId)`, unscoped list as the stand-in) so an
  agent row can only stage what the write path would accept for that agent.
- **Conflict recovery.** `POST /selections/pending/acknowledge { document }`
  (404 `no_conflict` when nothing to acknowledge, audited
  `pending_write_acknowledged`) and `bakin models pending [--ack
  <document>]` — the operator's path out of a conflict record, which
  otherwise reserves its document across restarts.
- **Full-state restore.** `buildRestoreOps` restores `ui:mode` and clears a
  thinking-only tag added since the snapshot.
- **Batched repairs.** The dead-selections repair applies every planned
  proposal in ONE mutation under their shared revision (one call per
  selection made the second stale).
- **Team-routing holds.** `/holds` gates an UNRESOLVED team task on the
  `team-routing` model first, as dispatch does (`routingCallGated`), naming
  `route:team-routing`; `PreDispatchProspect.workClass` widened to any
  `WorkClass` for that ref.
- **Clients never re-post blind.** A save goes out under the revision its
  editor snapshot loaded (fallback refs are positional — re-posting against
  a moved state removed the wrong entry); a stale refusal reloads and asks
  the operator to look again. Team's picker inspects the tri-state result
  (`failed` ⇒ the adapter's reason, `pending` ⇒ "waiting for the runtime";
  the kit `FieldError` needs `match` to show next to a non-Field control).

## Dead selections: hold, explain, repair (#907)

- **Pre-claim hold** (`preDispatchGate` → `modelHoldFor`, `src/core/dispatch-turns.ts`):
  the EFFECTIVE model a turn would run on (route/tag → agent pin → runtime
  default) is checked in the agent's credential context before any claim;
  a dead result holds the task (`task.deferred` reason `model_not_eligible`,
  audited once per task+model), independent of budget status.
  `GET /api/plugins/models/holds` serves the per-task holds; the Tasks board
  picks ONE hold per card (kill switch > dead model > budget cap) and
  renders "Model can't run" linking to `/models?ref=<ref>`.
- **Translation** (`explainDeadSelectionFailure`): a `provider_cooldown`
  with `authProfileUnavailable` or a `model_not_supported` on a dead
  selection becomes "The 'enrich' agent uses openai/gpt-5.6-luna, but this
  install has no credentials for openai. Use openai-codex/gpt-5.6-luna
  instead? Fix in Models." — by structured fields only. Dispatch failures
  and the enrichment queue use it.
- **Doctor** `models.dead-selections` (`plugins/models/lib/dead-selections.ts`):
  one action_required finding per dead selection (class `service_failure`,
  resource `{ kind: 'model_selection', id: <ref> }`), repair
  `apply-model-proposal` applies EXACTLY the planned `{ref, from, to,
  revision}` through the mutator (stale ⇒ refused). Failed/partial evidence
  ⇒ ONE unknown finding per source (class `evidence_gap`), never per-
  selection noise. `models.routing` keeps clamp / unrouted / premium-on-
  cheap only.
- **Runtime switch** (`reconcile-selections` phase, real + dry-run):
  evaluates every selection against the TARGET and reports the dead ones
  with proposals in `result.deadSelections` — REPORT ONLY, never rewrites
  (roster carry remains the one approved write).

## Pending restart (#878 Models half, D30)

`src/core/pending-restart.ts` persists WHICH change kinds still wait on a
restart (`plugin-settings/models/pending-restart.json`). The adapter's
OPTIONAL `restartAdvice(kind)` decides: Pi ⇒ `needed:false` for everything
(it re-reads its stores per turn — pinned by
`tests/integration/pi/model-change-no-restart.test.ts`); OpenClaw ⇒ only
`roster` (per-agent MCP servers attach at gateway start; model pins and
`agents.defaults.*` hot-reload). Adapters without the member get generic
advice. `POST /selections` notes `model-config` / `routing-policy` kinds;
Team notes `roster` when a restart is skipped or fails. A successful
`restart()` is the ONLY thing that clears it; a failed attempt is recorded
and shown. `GET /runtime/status` returns `{ pending, kinds, advice, generic,
lastAttempt }` and `useRuntimeStatus` renders the adapter's words — the
old `markConfigDirty` cell and hooks are gone.

## Brand icons

`<BrandIcon>` inlines SVG paths from simple-icons.org (CC0) for the 5 brands we have logos for. Unknown slugs render a first-letter chip in the provider's brand color.

## Cost optimization (metering → routing → gating)

Issue #464, widened from budget gating to the full cost story. Deep spec/plan: `.claude/specs/models-cost-optimization.md` (+ `-plan.md`); round 2 (billing lanes, provider caps, incidents, kill switch, alerting): `.claude/specs/cost-control-v2.md`.

### Structured pricing

`KnownModel.pricing` (`{ inputPer1M, outputPer1M, cachedReadPer1M?, updatedAt }`) is the cost source of truth for cloud LLMs; the display string is **derived** via `formatCostRange`. `costRange` survives only as a literal for non-token models (image/video/local). `computeCostUsdMicros(usage, pricing)` returns **null** when pricing or token counts are absent — never a fabricated zero. Cache tokens ARE priced (read + write); rates default to `DEFAULT_CACHE_READ_MULTIPLIER` (0.1×) / `DEFAULT_CACHE_WRITE_MULTIPLIER` (1.25×) of input — exact for Anthropic, approximate (typically low) for OpenAI/Google unless a model declares explicit `cachedReadPer1M`/`cacheWritePer1M`.

### Metering

The OpenClaw adapter surfaces per-turn `usage` from the **gateway response payload** (`result.meta.agentMeta.usage` — input/output/total **+ cacheRead/cacheWrite**), falling back to the trajectory `model.completed` event. Reading from the payload works for unthreaded sends too and carries cache tokens the trajectory omits. **Every** Bakin-side agent send is metered through the shared `meterAgentTurn` (`src/core/agent-cost.ts`) — dispatch task turns (keyed by the ledger `run_id`) AND non-dispatch sends (watchdog/doctor/orchestrator/agent-to-agent, synthetic id + null `task_id`), so a budget cap bounds true total spend. Every caller names its **work class** (`meterAgentTurn`'s `workClass` is required — compile-time forcing function; optional `routeSource` records how the model was chosen), and the work-class pass closed the remaining attribution gaps: interactive chat turns (`chat:<id>:turn:<uuid>`, usage from the stream's done chunk), chat auto-titles (`chat:<id>:title`), enrichment sends, and `startAgent` kick-offs ('send') all meter now — including the DIRECT-key enrichment path since #747 (agent `system`, transport-reported usage; previously invisible to the ledger). It writes a durable `run_costs` row and feeds the usage recorder. Pricing is delegated to `models.priceTurn` (core stays pricing-agnostic); cost = input + output + cacheRead + cacheWrite (cache rates default to a multiple of input — see above; a cache-only turn is still priced). `agent-cost` imports its ledger/usage/hook deps dynamically so metering doesn't drag the ledger into every caller's static graph.

**Image generation** is a separate billed path (not chat tokens): `persistImageResult` meters each generate/edit via `meterImageTurn` → `models.priceImage` (flat `imagePerUsd` × count; provider-priced models record the run unpriced) → a `run_costs` image event (`image:` runId) that also counts toward the cap.

**Billing lanes (cost-control v2, unit-per-lane):** every spend row carries `provider` + `lane`. Lane detection reads the credential SHAPE of `agents.<id>.authProfiles` through the allowlisted raw-config gate (`plugins/models/lib/billing.ts`): `apiKey`/`api_key` → **metered** (pay-per-token dollars); OAuth-only (`token`/`access`/`refresh`) → **subscription** (plan quota — tokens are the unit; the dollar estimate is SUPPRESSED, a subscription $ figure would be fiction). Manual `settings.billing.overrides` win (agent+provider → agent → provider); unknown defaults to metered (conservative) **for dispatch-side pricing only** — the spend engine's OBSERVED path (usage.db rows) trusts a lane only when `models.resolveBilling` resolved a real provider: provider `'other'` (the could-not-resolve bucket) routes to the `lane_unknown` evidence-gap path with zero dollars booked, never default-metered theoretical costs (#689 — a false dollar alert is the worse failure) — EXCEPT when `laneSource: 'override'` says an operator override decided the lane (operator truth beats the guess-refusal), and empty-model rows never invoke the hook at all (it would substitute the agent's CURRENT effective model — a guess about the past). Since usage.db v4 the transcripts' own sibling `provider` field is re-joined at scan time (`openai-codex/gpt-5.5`), so unresolvable is a true edge case (empty/missing fields). `models.resolveBilling` exposes prospective attribution (falls back to the agent's effective model) for the dispatch + billed-media gates; `priceTurn`/`priceImage` return `{model, provider, lane, costUsdMicros}`. **Billed images are provider-keyed**: `priceImage` and the media gate resolve lane WITHOUT the agent's chat-auth detection (provider-level overrides only) — an agent's subscription login must never null out real image-key dollars. Manual overrides edit via `PUT /billing/overrides` (UI: the Spend tab's Billing-lanes card).

**Surfacing:** the **Spend** page at `/spend` (the `spend` core plugin's Overview + Limits tabs — moved out of Models in the spend ownership series; the page's data hook still reads the models-plugin routes below until the ownership cutover) + a **Bakin Metered Spend** card on the Health dashboard (distinct from the pre-existing runtime-reported "Runtime Cost Estimate" card, which reads `agent-usage.ts`/session JSONL — see `.claude/knowledge/usage-recording.md`). `GET /spend?window=24h|7d|30d|all` returns rollups (total/by-agent/by-model) PLUS cap-window `facets` (the engine's lane/provider split) and `pace` (linear projections) — utilization always computes on calendar cap windows regardless of the browse selector. Rollups come from the NULL-honest `rollupSpend` (`plugins/models/lib/spend-rollup.ts`) over `listRunCostsSince`: byAgent/byModel rows carry `costUsdMicros: number | null` (null = unpriced, never $0). The old ledger GROUP-BY verbs (`spendTotal`/`spendByAgent`/`spendByModel`) are DELETED — their `COALESCE(SUM,0)` fabricated $0 for unpriced rows; `tests/architecture/no-legacy-spend-rollups.test.ts` bans them. The spend engine's `WindowSpend.byWorkClass` facet (attributed-only; special buckets `media` = classless image rows, `unclassified` = pre-migration token rows) feeds the "By work class" tables on the Spend page and `bakin spend` (runs, tokens, est. $, subscription tokens, avg $/run). The **Spend** page also renders the incident banner (raise & resume / ack / resume-a-pause), per-rule utilization cards, the cap-rule editor, a lane-split month summary with the unattributed coverage note, and "$ unavailable" for unmetered rows.

### Routing (per-turn model + thinking) — the work-class matrix

Bakin-owned policy resolved per turn (`src/core/model-routing.ts`, pure functions); the runtime serves it (`model`/`thinking` per-turn args). Distinct from the RUNTIME-owned routing policy (defaults/fallbacks/aliases + per-agent assignments), which lives in the runtime's native store behind `models.routingPolicy()/setRoutingPolicy()/routingSupport()` and `agents.update` (runtime-capabilities P2.3 — see `.claude/knowledge/runtime-capabilities.md`).

Routing key = the turn's **work class** (`WorkClass`): 5 dispatch classes (`scheduled|workflow|adhoc|recovery|decomposition`, classified deterministically from task shape by `classifyDispatchWorkClass` — recovery is a dispatch-context signal, precedence recovery → workflow → scheduled → decomposition → adhoc) + 6 system classes declared by their call site, never inferred (`auto-title|enrichment|relay|team-routing|send|chat`). `WORK_CLASSES` is the metadata table (label/description/kind/routable/recommendedTier — `'cheap'` for auto-title/relay/team-routing, `'cheap-vision'` for enrichment); `chat` is the single metered-only class (`routable: false` — interactive model choice stays with the operator; spend is still attributed). Config = `RoutingConfig { routes: WorkClassRoute[], tagOverrides }`, stored in `settings.routing`, exposed via `models.getRoutingConfig`. `resolveWorkClassRoute(config, workClass, tags?)` is the general resolver — model and thinking resolve INDEPENDENTLY, each taking the first layer that specifies it: tag override → class route → inherit (nothing resolved = the agent's configured model, unchanged behavior); `resolveTurnModel` is the dispatch wrapper; `resolveSystemRoute(workClass)` (`src/core/system-route.ts`, hook-fed, never throws into the send path) + `routeSendArgs` serve the system call sites: chat auto-title, asset enrichment (DOCUMENT jobs only — attachment turns stay override-free per bakin#584), doctor-escalation/watchdog/budget-notify/task-service relays (all `'relay'`), `agents.ts` `sendMessageToAgent` (`'send'`), and team assignment (`'team-routing'` — the route's full `provider/model` id rides an ephemeral runtime turn as a per-turn override, so ANY runtime-servable model routes; see `.claude/knowledge/team-aware-assignment.md`).

`ResolvedTurn` carries `source: 'tag:<name>'|'class'|'inherit'` — stamped as `route_source` on the `run_costs` row and on the `task.routed` audit, so the dimension that routes IS the dimension spend reports on. Thinking clamps to the runtime's declared support (`clampThinkingLevel` / `applyRoutingCapabilities` against `runtime.models.routingSupport().supportedThinkingLevels` — the same function also drops routed models when `perTurnModel` is false, #880): unsupported ordinal levels clamp DOWN the ladder (`'max'`→`'xhigh'`→…), `'adaptive'` clamps to inherit — clamp-and-warn, never a silent drop or failed turn. The **Routing** tab renders dispatch + system sections from `WORK_CLASSES`, filters thinking dropdowns to supported levels, and offers "Apply recommended routes" behind a ConfirmDialog diff preview.

**Recommendations + health** (`plugins/models/lib/health-checks.ts`, check id `models.routing`): ONE recommendation engine (`recommendRoutes` — cheapest available model by catalog pricing; `cheap-vision` intersects the authoritative `VISION_MODELS`, which MOVED to `packages/core/src/llm/vision-models.ts` — the enrichment providers module re-exports it; no candidate = skip-with-reason) behind three surfaces: the doctor check's warn evidence, `POST /routing/recommend` (the Routing tab's diff), and the `apply-recommended-routes` repair action. The check warns on unrouted recommended system classes (with per-class 7d spend evidence), errors on routes pointing at unavailable models — since #852 firing on EITHER signal (absent from catalog OR an open `model_rejections` row) with evidence that says which: "rejected by your account (N failures, last <ts>)" vs the not-in-catalog wording (`RoutingHealthDeps.listOpenModelRejections`, empty on ledger failure) — warns on standing thinking clamps and on premium-tier models observed on cheap-recommended classes (7d) — misrouting is detected, not discovered on the bill.

**Migration** (`plugins/models/lib/routing-migration.ts`): one-shot at plugin activation folds the retired origin-shaped config (`{policies:[{origin,…}]}`) into work-class routes 1:1 (unknown origins dropped, never guessed), plus a migrate-on-READ guard (a restored legacy settings file must never make dispatch silently ignore routes the operator believes exist). (The team plugin's legacy-settings seed migration and its `models.seedWorkClassRoute` hook are deleted — the migration ran; team routing now rides the runtime with no plugin-local model settings.)

### Budget gating (#464, rules since cost-control v2)

`settings.budget` is a **rule list** (`BudgetPolicy.rules`: `BudgetRule` = scope `global|agent|provider` — `model` accepted by evaluator+schema, UI ships through provider — × lane, `dailyCap`/`monthlyCap` in the lane's unit, `atCap: defer|pause`, `id` uuid — assigned by the spend upgrade, keys milestone rows), exposed via `models.getBudgetPolicy`. (The PR #500 `{global, perAgent}` shape and its one-shot migration are gone — the migration ran on the only install; the v2 rule list is the sole shape read anywhere.) `dispatch.budgetGate` consults it against the shared spend engine (total-observed: attributed + unattributed delta) before claiming: **defer** at 100% (there is no warn action — approach is the fixed 50/75/90/100 milestone ladder recorded in `budget_milestones`, see execution-ledger.md) (task stays in todo — badged by the Tasks UI — and resumes at window rollover; `atCap: 'pause'` holds until a human resolves the incident). **Fail-closed**: an unreadable ledger defers. Breaches open durable `budget_incidents` (the restart-safe debounce) and fan out via `budget-notify` (browser notification + main-agent relay). **Spend fossils (health trust overhaul):** `BudgetPolicy.acceptUnattributedBefore` (local day key) writes off pre-cutoff observed usage that can never attribute — excluded from evidence gaps and the unattributed delta so caps compute forward. Written ONLY by the doctor's `accept-unattributed-history` repair (destructive tier) through the narrow `models.updateBudgetPolicy` hook; there is no auto-aging. The routing check's premium-on-cheap incidents are ADVISORY with the `apply-recommended-routes` repair attached, escalating to watch past $5 of known attributed spend per 7d (unpriced rows never fabricate an escalation); `models.refreshAvailableModels` (rpc) force-refreshes the catalog for the spend card's pricing repair.

Routes: `GET/PUT /budget` (rule list, zod; PUT normalizes model-scope ids, WARNS on unknown agent/provider ids — a typo'd id is fake safety — and auto-resolves live incidents whose rule was deleted), `GET /budget/status` (poll behind task badges + the header banner: kill-switch state, per-agent ok|warn|deferred, **perTask holds computed with the gate's own routing resolution + main-agent fallback**, detected billing lanes + overrides, deferred providers, open incidents; `?lite=1` returns only `{paused}` for the header), `GET /budget/incidents` (runs the rollover sweep on read), `POST /budget/incidents/:id/resolve` (`raise` validates the new cap above current spend in the rule's unit, updates the rule, and kicks an immediate dispatch cycle so 'resume' visibly resumes; `ack`; `resume`/dismiss), `PUT /billing/overrides`. CLI: `bakin spend`, `bakin budget {show,set,rm,pause,resume,incidents}`. Onboarding has a `budget` component (prompted, skippable — NO silent default caps); no rules = a standing doctor warn.

## How to extend

- **Add a model:** PR an entry in `known-models.ts` (include `pricing` for cloud LLMs; bump `PRICING_AS_OF` on price edits).
- **Add a brand logo:** inline the SVG path in `brand-icon.tsx`.
- **Never:** fabricate model metadata, pricing, or cost — render plain / "$ unavailable" instead.
