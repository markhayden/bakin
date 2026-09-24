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
reason as the option's `description` (secondary text under the name,
exposed via `aria-describedby` — the name stays the name) and
`tone: 'danger'` (a dead option that is the CURRENT value renders the
trigger in the danger tone, `data-tone="danger"`) — D23, approved
2026-09-23; `unknown` ⇒ selectable. The read-only Model catalog panel badges No
credentials / Rejected by account / Unavailable / Not in catalog /
Unverified (choices are made in the lanes, never from the catalog);
`?probe=1` skips runtime-unavailable rows (a billed call that cannot
succeed).

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

**Routing-shape migration** now lives in core (`src/core/routing-migration.ts`: `isLegacyRouting` / `migrateLegacyRouting`) so onboarding reads routing honestly without the plugin; the plugin's activation one-shot + read guards import it from there.

**Snapshots** (`snapshot: 'reset'`) are FULL STATE files under
`plugin-settings/models/snapshots/` (bounded 5); `bakin models restore
<file>` diffs one against the CURRENT selections and submits under the
current revision (one 409 retry) — valid right after a Reset and after
later edits. `bakin models plan --apply` rides the same path with the
plan's revision.

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

## The Models page — Simple / Advanced (spec §3.4, D4/D24; PR 3 of the overhaul)

`/models` is one page (`plugins/models/components/models-page.tsx`,
enrolled **conformant**: `bakin.ui-test.ts` + `tests/ui.fixture.tsx`). Two
reads (`GET /selections` — states + revision + eligibility + proposals +
pending + `support`; `GET /plan`) and ONE write (`POST /selections`) sit
behind `use-selections.ts`; the catalog read (`GET /available`, refresh,
probe) behind `use-catalog.ts`.

- **Mode** = the persisted `ui:mode` when set, else classified from the
  states by `lib/mode.ts` (`classifyMode`/`listCustomizations`): Advanced
  if ANY customization Simple cannot express exists — agent pins other than
  the default, subagent pins, dispatch-class or `send` routes, any route
  thinking, tag overrides, fallbacks, aliases, chores routes naming
  different models. Persisted once on first visit through a `ui:mode` op
  (a VIEW preference, never configuration). The header `SegmentedControl`
  switches + persists. `?ref=<selection ref>` LANDS on the owning control:
  the row takes the kit's selected tint (`DataTable rowSelected` /
  `ListRow selected`) and focus moves to the control
  (`use-deep-link-focus.ts` over `data-selection-ref`, called by every
  view — only the owner finds a host); when the ref lives in an
  Advanced-only layer (`refLayer(ref, states)` — a chores route carrying a
  thinking level counts, so a clamp link never lands in Simple) the VIEW
  flips without writing. A view the operator picks by hand is keyed to the
  ref it was chosen under, so a NEW `?ref=` flips again.
- **Draft** (`lib/draft.ts`, pure): every edit stages an op keyed by ref;
  staging the persisted value back unstages, so a save carries ONLY the
  refs the user changed (S5, pinned by the 200-seed property test
  `tests/plugins/models/simple-save-minimality.test.ts`). ONE `SaveBar`
  posts the draft through `submit` — the hook's ONE client write: the
  revision the page holds (loaded, then ADOPTED from every write's answer —
  the hash covers every ref, so the page's own first-visit `ui:mode`
  persist moves it too), one stale-revision re-fetch + re-post, and the
  view persist and Reset go through the same function. Failed refs stay
  staged for Retry while applied + pending refs leave; refusals render with
  the server's proposal; the SDK `useUnsavedChangesGuard` covers
  routes/anchors/unload. The bar speaks for the DRAFT only (the kit's
  clean-save state is a bare "Saved ✓"); writes the runtime has not
  confirmed are the header badge's story (`PendingSummary` reads them back
  after every load) and `PendingChip` marks each ref. A save re-reads the
  catalog so its Default/Configured flags follow the new selection.
- **Simple** (`simple-mode.tsx`, `lib/simple.ts`): the Agent-model lane
  (`policy:defaultModel`) and the Background-chores lane (the five chores
  routes). Chores show ONE value only when all five resolve to the same
  model and none sets thinking, else "Mixed (N models)" + "Set all to…"
  (five model ops, thinking untouched). "Use recommended plan" shows the
  plan's ops in a ConfirmDialog and STAGES them. The customizations line
  lists what Simple cannot express and links into Advanced. **Reset to
  this plan** (`reset-dialog.tsx`, `buildResetOps` in
  `src/core/model-selections.ts`): consequence-first section → ConfirmDialog
  gated on typing `reset` listing every change BY LABEL with its
  before-value ("Fallback 1 — anthropic/claude-opus-4-6 → cleared", never a
  ref) and every clear the runtime cannot do (Pi: subagent pins /
  fallbacks / default subagent / aliases are SKIPPED and disclosed) →
  immediate `submit(ops, { snapshot: 'reset' })`; refused while a draft is
  unsaved; the mutation result
  carries the snapshot path and the page shows `bakin models restore
  <file>` as the undo handle.
- **Advanced** (`advanced-mode.tsx` + `advanced-{overview,agents,routing}.tsx`,
  `advanced-shared.tsx` for `StagedMark`/`ThinkingSelect` (the opener is
  the SDK `GuideCard`),
  `lib/advanced.ts` draft readers): three TABS on `?tab=overview|agents|routing`
  (a `?ref=` deep link picks the owning tab; the panel is a hand-rendered
  `role="tabpanel"` like Spend's — Base UI's `TabsContent` is a focusable
  panel without a ring and fails the keyboard-focus gate). **Overview** =
  two cards (Default model picker; Recommended plan with the why + "Use
  recommended plan" / "On the recommended plan"), an "In use today"
  `StatGroup` (agents on the default / with their own model / chores model
  or Mixed / routes set / tag overrides) + a `CompositionBar` of agents by
  model, and a "More defaults" `DisclosurePanel` for the runtime-gated
  extras (default subagent model, fallbacks, aliases — ONLY when `support`
  persists them, else one muted "doesn't support …" line; hidden, not
  disabled, D11). This is where future recommendations / model news land.
  **Agents** = a `GuideCard` (why most agents stay on the default; pin up for
  hard work, down for volume; subagents are a separate dial) then ONE
  sortable DataTable (Agent | Team | Model | Subagents when supported —
  headers once, like Work routing; Agent and Team sort, the main agent
  leads by default, then roster team order, then name) (`useAgentStore` teams + `displaySettings
  [id].teamId`; "Not on a team" last), soft `default`/`own model` chips,
  subagent column when supported. **Work routing** = a `GuideCard` (agent
  work vs background chores, thinking, tags) then two DataTables — Agent
  work: 5 dispatch + `send`; Background chores: 5 — with model + thinking
  selects filtered to `supportedThinkingLevels` (a persisted-unsupported
  level surfaces as "· unsupported by this runtime"), tag overrides with an
  add form that requires a model, "Use recommended routes" staging
  `routeProposals` from `GET /plan`. `perTurnModel === false` ⇒ Alert +
  read-only routing. Chips everywhere are `variant="soft"`.
- **Callouts** (`selection-callout.tsx`): a dead selection shows its
  eligibility detail and, when the server proposed a repair, one "Use
  <model>" that STAGES it; `unknown` is information only; a ref the user
  already changed hides its callout.
- The **Model catalog** (`catalog-panel.tsx`) is an always-visible read-only
  section at the foot of the page (both modes): search, provider facets,
  sort, pagination, Refresh, Verify availability.
- Every catalog-changing route emits `models.catalog_changed`; the SDK
  `useAvailableModels` (Team's pickers) refetches on it and never caches
  across mounts.

**Review-round hardening (2026-09-23, #912 round 4 — six P2s, don't regress):**
- **A save settles by VALUE, not by ref.** `save` remembers the draft it
  submitted (`inFlightRef`); `retainFailed(prev, outcome, submitted)` drops
  an applied/pending ref only while the draft still holds the submitted
  value. Staging DURING a save compares against `withInFlight(states,
  submitted)` — the states the save will leave — so an edit back to the
  pre-save value stays staged and re-picking the submitted one unstages.
  An edit made while its previous save ran is never silently lost.
- **Positional fallback ops carry the list they are relative to.** The
  draft is REF-authoritative (`updateDraft` writes `draftRef`
  synchronously and mirrors to state — an async reload must never read a
  render-time copy React has not re-rendered yet). `fallbackContextRef`
  holds the fallback list the draft's `policy:fallback:<n>` ops were
  compared against (set on the first positional stage, from the staging
  base). `adoptLoaded` is the ONE way fresh states enter the hook (first
  load, every reload — mode switch, save, pending poll — and the
  stale-revision re-read): while the draft holds positional ops it accepts
  an incoming list equal to that context, or — while a save is in flight —
  the list the save was made for (`inFlight.context`) or the list it
  leaves (`inFlight.expected` = `applyFallbackOps`, the server's
  assign-then-compact rule); anything else is an external change ⇒
  `dropPositional` (named ops stay, `FALLBACK_LIST_MOVED` shown). A save's
  own reload is therefore never mistaken for a conflict, and an edit staged
  during the save (against `withInFlight`, whose fallback states ARE the
  expected list) survives it. `submit` captures the list a positional
  request is made for at POST time and, on `stale_revision`, re-posts only
  when the fresh list is THAT list — never the page's current one, which a
  mid-save reload may already have moved. A failed positional write keeps
  its ops relative to the pre-save list and drops any staged against the
  expected list that never came to be. Never adopt states with a bare
  `setSelections`. With nothing staged the save bar cannot show the
  message (`SaveBar` returns null when not dirty), so the page renders a
  `Banner` (`save-notice`, Dismiss = `discard`) for a save error with an
  empty draft; the first fresh edit onto an empty draft clears the old
  error so its Save is not a "Retry".
- **Reset keeps the FIRST snapshot of THIS reset.** `ResetToPlan` stores
  the handle the first attempt returned; a retry after a partial reset
  posts WITHOUT `snapshot: 'reset'` (a second snapshot would capture the
  half-cleared state and bury the real undo point), the failure text names
  the original handle, and the section re-reads so the retry lists only
  what is left. The handle is CLEARED on success and on cancel (cancel
  after a partial keeps it visible as "Reset partially applied"), so a new
  reset mints its own snapshot instead of advertising an older undo point.
- **"More defaults" summary meta is a count** (`3 settings`), not the
  extras' names — the names squeezed the summary to a letter per line at
  320px.
- **Pending writes settle without a reload.** While any `pending` row is
  `unsettled`, `useSelections` re-reads on `pendingPollMs` (default 5 s;
  the server reconciles pending writes on every GET /selections, so the
  read IS the settle signal) and stops when none remain.
- **Deep links reveal their controls.** `useDeepLinkFocus` opens every
  enclosing `<details>` (the Overview's "More defaults") before scrolling;
  fallback rows carry `data-selection-ref="policy:fallback:<n>"` and alias
  rows `policy:alias:<name>` so `?ref=` lands on them.
- **Onboarding never calls unusable enrichment healthy.** `assess()` flags
  an UNROUTED enrichment that inherits a text-only default (inheritance is
  not a bypass of the vision check) and a plan whose recommender left
  enrichment `unset` (nothing eligible can see); `check()` returns `warn`
  for those even when the recommendation diff is empty, and `install()`'s
  noop message carries the caveat.

## Pending restart (#878 Models half, D30)

`src/core/pending-restart.ts` persists WHICH change kinds still wait on a
restart (`plugin-settings/models/pending-restart.json`). The adapter's
OPTIONAL `restartAdvice(kind)` decides: Pi ⇒ `needed:false` for everything
(it re-reads its stores per turn — pinned by
`tests/integration/pi/model-change-no-restart.test.ts`); OpenClaw ⇒ only
`roster` (per-agent MCP servers attach at gateway start; model pins and
`agents.defaults.*` hot-reload). Adapters without the member get generic
advice. `applySelections` (`plugins/models/lib/selections.ts` — the ONE
write behind `POST /selections` AND the dead-selections + recommended-routes
repairs) notes `model-config` / `routing-policy` kinds, drops the catalog
cache and emits `models.catalog_changed` for runtime-config refs only
(`agent:*` / `policy:*`); route, tag and `ui:mode` writes are silent. Team
notes `roster` when a restart is skipped or fails. A successful
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

The OpenClaw adapter surfaces per-turn `usage` from the **gateway response payload** (`result.meta.agentMeta.usage` — input/output/total **+ cacheRead/cacheWrite**), falling back to the trajectory `model.completed` event. Reading from the payload works for unthreaded sends too and carries cache tokens the trajectory omits. **Every** Bakin-side agent send is metered through the shared `meterAgentTurn` (`src/core/agent-cost.ts`) — dispatch task turns (keyed by the ledger `run_id`) AND non-dispatch sends (watchdog/doctor/orchestrator/agent-to-agent, synthetic id + null `task_id`), so a budget cap bounds true total spend. Every caller names its **work class** (`meterAgentTurn`'s `workClass` is required — compile-time forcing function; optional `routeSource` records how the model was chosen), and the work-class pass closed the remaining attribution gaps: interactive chat turns (`chat:<id>:turn:<uuid>`, usage from the stream's done chunk), chat auto-titles (`chat:<id>:title`), enrichment sends, and `startAgent` kick-offs ('send') all meter now — including the DIRECT-key enrichment path since #747 (agent `system`, transport-reported usage; previously invisible to the ledger). It writes a durable `run_costs` row and feeds the usage recorder. Pricing is delegated to `spend.priceTurn` (core stays pricing-agnostic); cost = input + output + cacheRead + cacheWrite (cache rates default to a multiple of input — see above; a cache-only turn is still priced). `agent-cost` imports its ledger/usage/hook deps dynamically so metering doesn't drag the ledger into every caller's static graph.

**Image generation** is a separate billed path (not chat tokens): `persistImageResult` meters each generate/edit via `meterImageTurn` → `spend.priceImage` (flat `imagePerUsd` × count; provider-priced models record the run unpriced) → a `run_costs` image event (`image:` runId) that also counts toward the cap.

**Billing lanes, spend surfacing, limits, pricing** moved to the `spend` core plugin (ownership cutover, 2026-09-22): `spend.resolveBilling` / `spend.priceTurn` / `spend.priceImage` / `spend.getBudgetPolicy` / `spend.updateBudgetPolicy`, the `/spend` page and `/api/plugins/spend/*` routes, `spend.json`. Models keeps only "which model" — and serves the roster (`models.listAgentModels`) + effective model (`models.getEffectiveModel`) the spend plugin prices against. Deep reference: `.claude/knowledge/spend-plugin.md`.

### Routing (per-turn model + thinking) — the work-class matrix

Bakin-owned policy resolved per turn (`src/core/model-routing.ts`, pure functions); the runtime serves it (`model`/`thinking` per-turn args). Distinct from the RUNTIME-owned routing policy (defaults/fallbacks/aliases + per-agent assignments), which lives in the runtime's native store behind `models.routingPolicy()/setRoutingPolicy()/routingSupport()` and `agents.update` (runtime-capabilities P2.3 — see `.claude/knowledge/runtime-capabilities.md`).

Routing key = the turn's **work class** (`WorkClass`): 5 dispatch classes (`scheduled|workflow|adhoc|recovery|decomposition`, classified deterministically from task shape by `classifyDispatchWorkClass` — recovery is a dispatch-context signal, precedence recovery → workflow → scheduled → decomposition → adhoc) + 6 system classes declared by their call site, never inferred (`auto-title|enrichment|relay|team-routing|send|chat`). `WORK_CLASSES` is the metadata table (label/description/kind/routable/recommendedTier — `'cheap'` for auto-title/relay/team-routing, `'cheap-vision'` for enrichment); `chat` is the single metered-only class (`routable: false` — interactive model choice stays with the operator; spend is still attributed). Config = `RoutingConfig { routes: WorkClassRoute[], tagOverrides }`, stored in `settings.routing`, exposed via `models.getRoutingConfig`. `resolveWorkClassRoute(config, workClass, tags?)` is the general resolver — model and thinking resolve INDEPENDENTLY, each taking the first layer that specifies it: tag override → class route → inherit (nothing resolved = the agent's configured model, unchanged behavior); `resolveTurnModel` is the dispatch wrapper; `resolveSystemRoute(workClass)` (`src/core/system-route.ts`, hook-fed, never throws into the send path) + `routeSendArgs` serve the system call sites: chat auto-title, asset enrichment (DOCUMENT jobs only — attachment turns stay override-free per bakin#584), doctor-escalation/watchdog/budget-notify/task-service relays (all `'relay'`), `agents.ts` `sendMessageToAgent` (`'send'`), and team assignment (`'team-routing'` — the route's full `provider/model` id rides an ephemeral runtime turn as a per-turn override, so ANY runtime-servable model routes; see `.claude/knowledge/team-aware-assignment.md`).

`ResolvedTurn` carries `source: 'tag:<name>'|'class'|'inherit'` — stamped as `route_source` on the `run_costs` row and on the `task.routed` audit, so the dimension that routes IS the dimension spend reports on. Thinking clamps to the runtime's declared support (`clampThinkingLevel` / `applyRoutingCapabilities` against `runtime.models.routingSupport().supportedThinkingLevels` — the same function also drops routed models when `perTurnModel` is false, #880): unsupported ordinal levels clamp DOWN the ladder (`'max'`→`'xhigh'`→…), `'adaptive'` clamps to inherit — clamp-and-warn, never a silent drop or failed turn. The Advanced view's **Work routing** section renders the two groups from `WORK_CLASSES`, filters thinking dropdowns to supported levels, and offers "Use recommended routes" behind a ConfirmDialog diff that stages ops.

**The model plan** (`src/core/model-plan.ts`, spec §3.4 — the ONE recommender behind the Models page's "Use recommended plan", onboarding's `models` step, `bakin models plan`, and the routing health check): two lanes — the AGENT model (chat, `send`, the five dispatch classes = the runtime default) and the CHORES model (`auto-title`, `enrichment`, `relay`, `team-routing`, `skill-mapping`). PURE over a `PlanInput` the caller assembles (arch-pinned by `tests/architecture/model-plan-purity.test.ts`: no vision list, catalog, ledger or services import): `plugins/models/lib/plan.ts` (`buildPlanInput`) builds candidates from the eligibility-overlaid catalog (ineligible/rejected/image rows never enter), `tier` runtime-merged, `lane` per PROVIDER via `spend.resolveBilling` (metered when the hook is absent), `pricePer1M` from catalog pricing, `vision` from runtime `input` modalities (Pi) → curated `VISION_MODELS` (only ever says yes) → `null` = unknown, and `enrichmentEnabled` via the `assets.enrichmentEnabled` hook (on when absent). Ranking is within-lane (subscription sorts before metered): subscription tier asc → context desc → id; metered price asc (unknown price LAST) → tier → id. Agent pick = current default if eligible else strongest (`PlanCandidate.tier` is REQUIRED — the assembler always resolves one, so an unknown tier can never rank strongest). Chores pick = lightest candidate LIGHTER than the agent model — not heavier by tier AND ranked before it, so a paid same-tier model never displaces a free subscription agent model (nothing lighter ⇒ the agent model takes the chores and routes read `null` = inherit): known-capable first, unknown after and disclosed in `notes`, nothing lighter sees but the agent model does ⇒ `enrichment: 'agent'` (the enrichment route stays UNROUTED — it inherits the agent model and follows the default wherever it moves; `recommendForRef` resolves it to the agent lane), nobody sees ⇒ `'unset'` (route cleared, "enrichment will fail…"), enrichment off ⇒ `'disabled'`. The result carries `routes[]` (desired model-or-inherit per chores class with a reason) and the `ops` diff against the current state (`policy:defaultModel` + `route:*`) — NEVER applied by the recommender; `GET /plan` returns `{ revision, current, recommended, routeProposals, candidates }`, `bakin models plan [--apply] [--json]` posts the ops through `POST /selections` under that revision only on the explicit flag. **Onboarding** (`src/core/onboarding/models.ts`, after `llm`, `ONBOARDING_VERSION` 6) runs the same recommender WITHOUT plugins loaded — `listPlanCatalogRows` (runtime catalog folded through eligibility) + the models/spend/assets settings files + `createSelectionMutator` directly: `missing` (no persisted plan = no chores routes and no `ui.mode`) ⇒ the TUI shows the plan with reasons and applies on confirm / `--yes` (the ONE permitted auto-apply). A WORKING default is never moved — the recommender keeps an eligible current default — so the only default `--yes` ever touches is a dead one, where nothing dispatches until it is repaired (Mark's call 2026-09-22, reversing a review-round hold: "will users expect it to clean up the defaults?" — yes). Every onboarding write is audited like the plugin path; a dead default is ONE problem, not one per inheriting chore. `warn` when a persisted plan has a dead or blind lane (remediation → `bakin models plan`; never auto-applied); `ok` when the persisted lanes are eligible + suitable or the install already matches. `bakin check models` runs the check alone. `choresLaneState` (core) and `choresLane`/`setAllChoresOps` (`plugins/models/lib/simple.ts`) back Simple's chores lane ("Mixed (N models)" + "Set all to…").

**Routing health** (`plugins/models/lib/health-checks.ts`, check id `models.routing`): `recommendRoutes(deps)` is now a derivation — `routeProposals(plan, routing)` lists the plan's route for every UNROUTED chores class (routed classes are the operator's choice; the Simple view's "Use recommended plan" shows the full diff instead), skipping with the plan's reason when a class cannot be carried — and skipping a row that names the AGENT model (enrichment when only the agent model can see): unrouted already inherits it, and proposing it was a standing false "unrouted" finding whose repair routed background work to the premium model. The doctor check warns on unrouted chores classes (with per-class 7d spend evidence) and the `apply-recommended-routes` repair applies exactly those proposals through `applySelections` (the same mutate + post-write side effects as `POST /selections`; never a direct settings write); the Advanced view's "Use recommended routes" dialog reads the same `routeProposals` off `GET /plan`. It also warns on standing thinking clamps and on premium-tier models observed on cheap-recommended classes (7d) — misrouting is detected, not discovered on the bill. (Routes pointing at models that cannot run are the `models.dead-selections` check's job.)

**Migration** (`src/core/routing-migration.ts`): one-shot at plugin activation folds the retired origin-shaped config (`{policies:[{origin,…}]}`) into work-class routes 1:1 (unknown origins dropped, never guessed), plus a migrate-on-READ guard (a restored legacy settings file must never make dispatch silently ignore routes the operator believes exist). (The team plugin's legacy-settings seed migration and its `models.seedWorkClassRoute` hook are deleted — the migration ran; team routing now rides the runtime with no plugin-local model settings.)

### Budget gating — see spend-plugin.md

The limits policy, incidents, the milestone ladder, the coverage-aware suggestion and the CLI all live with the spend plugin now; the gate itself (`budgetGate` in `src/core/dispatch-turns.ts`) reads `spend.getBudgetPolicy` and FAILS CLOSED (`budget_policy_unavailable`) when that hook is absent. Nothing in this plugin reads or writes budget settings.

## How to extend

- **Add a model:** PR an entry in `known-models.ts` (include `pricing` for cloud LLMs; bump `PRICING_AS_OF` on price edits).
- **Add a brand logo:** inline the SVG path in `brand-icon.tsx`.
- **Never:** fabricate model metadata, pricing, or cost — render plain / "$ unavailable" instead.
