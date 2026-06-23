# Plan: WS5 — refactor/core-splits

Spec: `.claude/specs/audit-2026-06/REPORT.md` + `APPENDIX-cohesion.md`. Branch: `refactor/core-splits`
off `main`. The big core/server/adapter files. One revertable commit per finding/file; every commit
green on `bun run test` + `bun run typecheck` + (for anything in the binary graph) `bun run build`.

## Items (REPORT §WS5)

- **search-registry.ts** (1,134 → 4 modules) + **fix the pluginTables 1:1 wrong-table bug**.
- `dispatch.ts` (2,079 → 11; dedupe dispatchTasks/dispatchSingleTask; singleton placement is the risk).
- `src/lib/plugin-registry.ts` (1,608 → 7; unify dup topo-sorts + activation pipelines; move out of src/lib).
- `server.ts` (837 → declarative route table + boot/recovery modules; dead dispatch-state write already
  removed in the incidental-bugs PR #505).
- `src/core/plugins/upgrade.ts` (926 → 6; delete dead checkUpgradeAvailable; consolidate two dir hashers).
- `packages/adapter-openclaw/src/runtime.ts` (3,069 → 13 capability factories; dedupe deepMerge).

## Sequencing decision

The pluginTables fix is the highest-value correctness item and is **fully unit-testable** (it's purely
about which table name reaches the adapter — a mock adapter verifies routing; Antfly behavior is
irrelevant). So it's done FIRST as a focused, behavior-isolated change, ahead of the mechanical 4-module
split (which is pure relocation and lands next, no behavior change).

The big splits (dispatch singleton, plugin-registry, runtime) are fragile and several want the dockerized
rig to E2E-verify behavior — they're sequenced after the search work and may be split into focused PRs
(mirroring WS4's part-1/part-2 cadence).

## Incidental correctness bug #3 (workflow start-validation) — ☑

The REST `POST /instances/start` path used a weak `validateWorkflowForStart` that only validated the
top-level definition — no nested-workflow recursion or cycle detection — while the hook + exec-tool
paths used a strong recursive validator. So a cyclic/invalid nested workflow could be started via REST.
Upgraded the module-level validator to the strong recursive form (per-def validation + path-tracking
cycle detection) while keeping its explicit assignee-param check (a true superset). Regression test:
REST start with a mutually-nested cycle → 400 "cycle detected". (The local strong copy remains a
pre-existing duplicate — WS6 workflows-split dedup territory; noted there.)

## Status

- **search.fix — ☑ pluginTables wrong-table bug.** Team registers a direct primary (`agents`, indexed
  via `ctx.search.index`) + a file-backed secondary (`agent-lessons`); last-write-wins routed agent docs
  into the lessons table and made `getTableForPlugin('team')` throw (breaking team's `/search` + MCP).
  Fix: a "primary table" model — `registerContentType` records the primary (one direct per plugin,
  enforced; a second throws early), file-backed types register as **secondary** and index/remove/reconcile
  into their **own** table directly (not the primary resolver); `getTableForPlugin` returns the primary
  (no longer throws). No public SearchAPI/SDK type change (internal `registerContentTypeInternal`). Regression
  test added (direct→primary + file-backed→own-table). Chosen over the audit's handle-API option because it
  fixes the real cases with zero API/two-tier churn; the only residual (a hypothetical plugin with two
  DIRECT content types) now errors early instead of silently misrouting.
  - **OPERATIONAL (for Mark):** existing instances have stale agent docs already written to
    `bakin_agent-lessons` (and missing from `bakin_agent`). After deploying, run a one-time
    `bakin reindex` (re-runs generators into the correct tables) and purge the mis-routed rows from
    `bakin_agent-lessons`. The code fix prevents recurrence; it can't retro-move already-written rows.
- search.split — ☑ search-registry.ts (1,154) → 16-line barrel + 4 modules (search-registry-core 444 /
  search-plugin-api 413 / search-reindex 268 / search-query 102). Barrel strategy = every consumer
  import, all 11 test files (incl. the 7 that mock.module the path), and server.ts dynamic-imports
  unchanged; feature modules import core only (no cycle); logger allowlist extended. Verified: 149/0
  across the 11 search test files, full binary build, and an isolated-home boot smoke against real
  Antfly (tables register, team /search resolves the primary table with no throw). The smaller cleanups
  (transform() $inc/$push narrow, pendingReconciles swap idiom, crossTableSearch recursion, getSearchAdapter
  export) remain as follow-ups inside the now-smaller modules.
- upgrade.cleanup — ☑ deleted dead `checkUpgradeAvailable` (zero callers; superseded by `runChecks`;
  stale doc claimed `--check` used it). **Hasher consolidation DEFERRED (behavior-sensitive):** the
  "two directory hashers" — `computeSourceTreeSha` (upgrade.ts: skips node_modules/dist/.git, hashes
  concatenated rel+bytes) and `hashSourceTree` (whiskit/source-hash.ts: skips NON_RUNTIME_DIRS+dotfiles,
  hashes joined rel+filehash lines) — have DIFFERENT skip-sets and formulas, so they produce different
  hashes. Consolidating changes output for one caller and invalidates stored sourceTreeSha values
  (spurious "source changed" on existing installs); needs a deliberate canonical-pick + one-time reset,
  best done with the full upgrade.ts split + a migration step.
- dispatch.split — ◧ **split by RISK, not all at once** (dispatch is the audit's most dangerous file:
  6 module-level singletons where a misplaced one silently breaks the .dispatch-state.json mutex →
  duplicate fires; an import cycle (handleSessionDeath ⇄ dispatchSingleTask) needing DI surgery; a
  cross-package ledger contract on the state file).
  - ☑ Pure module #1: `dispatch-failures.ts` (error classification over RuntimeError/RuntimeTurnError —
    zero state, zero fire-path). dispatch.ts 2,240 → 2,096, re-exports the public classify* surface so
    `@/core/dispatch` consumers + the test are unchanged. typecheck/lint/61-dispatch-tests/full-suite/binary green.
  - ☑ Phase A safe modules: `dispatch-types.ts` (14 shared types — the leaf that unblocks the rest),
    `dispatch-prompts.ts` (pure builders), `dispatch-board.ts` (reads + task-store wrappers),
    `dispatch-context-blocks.ts` (lessonBlockCache sole owner + lesson/asset blocks). dispatch.ts
    2,096 → 1,652; re-exports the public surface so consumers + the 3 mock-the-path tests are unchanged;
    no cycles (modules → dispatch-types only). typecheck/lint/96-tests/full-suite/binary + boot-smoke
    (Dispatch started clean) green. Fire-path/singleton/cycle core untouched.
  - ☑ Phase B fire-core: `dispatch-state.ts` (sole `stateQueue` mutex owner), `dispatch-turns.ts`
    (inFlightTurns/pendingLadderRedispatches/fireDispatchTurn/concurrencyGate/budget), `dispatch-session-death.ts`
    (the recovery ladder; re-dispatches via a LAZY `import('./dispatch-single')` — no barrel-wiring footgun),
    `dispatch-cycle.ts` (dispatching/timer + dispatchTasks), `dispatch-single.ts`, `dispatch-workflow.ts`.
    dispatch.ts → 29-line barrel. Single mutex confirmed (stateQueue only in dispatch-state); each singleton
    in one module; turns↔session-death is a runtime-only cycle. typecheck/lint/full-suite 5106/0/binary +
    docker create-task smoke (fire-core runs, no wiring crash). **LIVE exactly-once gate:** the bare-metal
    OpenClaw stress plan in `tasks/dispatch-phase-b-handoff.md` (burst concurrency / session-death ladder /
    restart recovery / soak, all checked for exactly-once via ledger+audit) is the authoritative sign-off.
  - ☑ Behavior-touching dedup: `prepareRegularDispatch` (the dispatchTasks/dispatchSingleTask
    copy-paste) — done by Mark (#516), live-verified. dispatch.ts split is now COMPLETE end-to-end
    (Phase A #513 + Phase B fire-core #514 + dedup #516).
- plugin-registry.split — ◧ **split by RISK** (boot-critical; the hook-registry-singleton seam was already
  done — WS2/#499). Barrel-preserving: `src/lib/plugin-registry.ts` stays the public module (55 importers +
  ~40 test `mock.module` overlays target that path), pulling extracted helpers from siblings.
  - ☑ Phase A: extracted `plugin-registry-types.ts` (PluginState/FailureState/LoadEntry/CorePluginRegistration),
    `plugin-console-capture.ts` (withCapturedPluginConsole + createPluginScopedLogger), `plugin-activation-audit.ts`
    (logPluginActivation), and **unified the two duplicate topo-sorts** into `plugin-topo-sort.ts` — one Kahn's
    impl parameterized by `{source, failOnMissingDep, logCycle}` (the only 3 ways the core/user copies differed);
    always-filter is a no-op for the user pass (cycle entries already excluded), preserving its behavior exactly.
    plugin-registry.ts 1,512 → ~1,000. Public surface unchanged (re-exports CorePluginRegistration). Verified:
    typecheck/lint/registry-test 52-0/full-suite 5115-0/binary build + isolated-home boot smoke (9 plugins activate
    in correct topo order through the refactored loadPlugin→buildContext path; the 1 failure is schedule's
    openclaw-cron ENOENT, environmental). New direct unit test for the unified sort (6-0).
  - ☐ Phase B (DEFERRED, behavior-touching): unify the two activation pipelines (`loadPlugin` /
    `activateUserPluginEntry` share a ~60-line tail but diverge on import mechanism, console-capture wrapping,
    migrations, core/user id bookkeeping, and logPluginActivation ordering — merging normalizes boot-path
    ordering, so it gets its own commit + boot smoke, mirroring the dispatch dedup cadence). Plus the physical
    **move out of src/lib** (churns 55 importers + 40 mock paths — mechanical, separate).
- server.split — ☐ (router-table + boot.ts; search-startup/recovery already extracted; HOLD until the dispatch
  live-test passes — it stresses the same boot/router surface)   runtime.split — ☐ (adapter, 3,188 lines)

## WS7 — tooling

- docs-generate.split — ◧ IN PROGRESS: `scripts/docs/generate.ts` (2,585) → ~12 lib/ modules + a thin
  invocation-only entry; delete the dead legacy OpenAPI generator (~215 lines). Pure relocation, byte-for-byte
  output preserved (gate: `docs:check` + the post-`docs:generate` diff is date-stamp-only). Escaper-consolidation
  / plugin-list-derivation / CLI-metadata redesigns DEFERRED (output-risk).
- externals + CORE_PLUGINS consolidation — ☑ New `src/lib/core-plugin-ids.ts` is the single canonical
  core-plugin id list; `scripts/build-plugins.ts` + `scripts/dev.ts` import it (the two hand-maintained,
  differently-ordered copies — the source of the dropped-`images` class of bug — are gone). `scripts/dev.ts`
  + `packages/host/build.ts` now import `PLUGIN_CLIENT_EXTERNALS` instead of inlining byte-identical externals
  arrays. A pure-scanner architecture test (`tests/architecture/core-plugin-ids.test.ts`) pins the canonical
  list to BOTH the on-disk `plugins/` dirs AND the `CORE_PLUGIN_IMPORTS` embed-map keys, so the single source
  can't silently drift from the real set. Verified: typecheck/lint/new-test green + full `build-plugins.ts`
  (10 plugins) + host `build.ts` smoke.
- Remaining WS7: shared dir-walker.

## WS6 — plugin god-files

- team/index — ☑ **DONE** (2,312 → 693, a 70% reduction across 5 lib modules over 3 PRs).
  - ☑ Phase A (#520): `lib/runtime-agents.ts` (~270-line runtime-adapter agent wrapper layer, every fn takes
    the adapter explicitly) + `lib/agent-lessons.ts` (agent-package lesson path-parse + fs-read helpers for the
    `bakin_agent-lessons` content type). index 2,312 → 1,914.
  - ☑ Phase B-helpers: `lib/team-settings.ts` (display/teams settings I/O + reportsTo normalize/degrade +
    mergeDisplayDefaults — the most route-referenced group: readTeams ×13, readDisplaySettings ×8) and
    `lib/agent-status.ts` (status resolution + org structure; `staleSettingsCtx` is now a `setStaleSettingsContext`
    setter called from activate). index 1,914 → 1,685. Both are pure/param/store-backed — no plugin-registry
    coupling. Verified: typecheck/lint/team suite 183-0/full-suite/binary build/boot smoke.
  - ☑ Phase B-routes: extracted the ~970-line `populateTeamRoutes` into `lib/team-routes.ts`. Single injected
    dep (`indexAgentStatic`) — the routes' only residual module-scope coupling; `pluginCtx`/`batchIndexAgents`
    turned out to be activate-only, not route-used. index 1,685 → 693. Verified: typecheck/lint/team suite
    183-0/full-suite/binary build/boot smoke (GET /api/plugins/team/ + /teams return 200 through the moved
    handlers). index.ts is now just activate()/onReady/onShutdown + the search-indexing wiring + exec tools.
- tasks/index — ☑ **DONE** (1,089 → 138, the memory-plugin thin-index shape, across 2 PRs).
  - ☑ Routes (#523): `lib/routes.ts` (full declarative route array) + `lib/task-schemas.ts` (COLUMNS + zod
    schemas) + `lib/edit-guard.ts` (taskEditGuard/guardResponse) + `lib/search-doc.ts` (taskToSearchDoc/indexTask).
    1,089 → 539.
  - ☑ Exec-tools + maintenance: `lib/exec-tools.ts` (registerTaskExecTools — all 11 MCP tools + buildChecklistNudge)
    + `lib/maintenance.ts` (startMaintenance/stopMaintenance, clear-before-start re-entrancy preserved). activate()
    now just registers the search content type, calls registerTaskExecTools + startMaintenance, and the 4 health
    checks. 539 → 138. Behavior-preserving; the optional behavioral "redesign opportunities" (REST/MCP guard
    inconsistency, identifier-fallback dedup, dead .catch noise, postJson helper) are NOT taken — noted for follow-up.
    Verified: typecheck/lint/tasks suite 206-0/full-suite/binary build/boot smoke.
- asset-service — ◧ **media + trash extracted** (835 → 682). `lib/asset-media.ts` (lazy sharp loader +
  imageDimensions + generateThumbnail — the only module-level mutable state, the sharpModule cache) and
  `lib/asset-trash.ts` (soft-delete/list/restore/purge — self-contained, deliberately bypasses the
  manifest-write choke point so it evicts/relinks the task-asset index explicitly). `assetDirAbs` moved to
  its natural home `asset-id.ts` (both service + trash import it — no cycle). The 2 route/index consumers +
  4 test files repointed to `asset-trash`; the two fragile importers (plugin-context-services dynamic import,
  post-channel path-alias) use only create/read fns and are untouched. Verified: typecheck/lint/assets suite
  242-0/full-suite/binary build. DEFERRED: asset-mutations + asset-upsert split + the optional redesigns
  (mutateManifest combinator, iterateStoreManifests walker, images-plugin sharp-dedup).
- health-page — ◧ **types + formatters extracted** (1,155 → 996). `plugins/health/types.ts` (the 14 wire-format
  interfaces + UsageKind — fixes the missing-types.ts convention violation; health/index.ts can now type its
  route payloads against them) and `plugins/health/lib/format.ts` (formatUptime/formatTokenCount/formatRuntimeCost/
  formatDateShort/searchStatsDocumentCount/extractErrorMessage/formatActivity). formatAge was already on the SDK.
  Pure relocation (types erased at build; formatters pure). Verified: typecheck/lint/health suite 98-0/full-suite/
  binary build/boot smoke. DEFERRED: the section-component split (usage/plugins/search/agent-usage sections) +
  the per-section-fetch redesign + SearchHealthData promotion — the involved React-state work.
- workflows/lib/runtime — ☑ **DONE** (1,634 → 45-line barrel + 6 seam modules). Barrel-preserving split of the
  runtime engine into `instance-store.ts` (JSON-on-disk persistence + gate-notified tracking), `task-bridge.ts`
  (the single task-store/task-service crossing: moves/logs/completion/child-board-tasks), `step-context.ts`
  (read-only info-gating query surface: resolveAgent/getCurrentStep/authorizeWorkflowToolUse/getActiveAgents),
  `node-dispatch.ts` (system/plugin node execution + reopened-step re-dispatch), `engine.ts` (the deliberately-kept-
  together mutual-recursion knot: createInstance↔advanceWorkflow↔propagateChildCompletion↔completeStep + cancelInstance),
  and `gates.ts` (approve/reject/reopen). The three pure traversal helpers (flattenSteps/findStep/getTopLevelIndex)
  moved into the existing `parser.ts`. runtime.ts is now a pure re-export barrel of the exact 26-name public surface,
  so index.ts/approval-rehydration.ts/health-checks.ts + the 6+ test files that mock.module `…/lib/runtime` are
  untouched. Only static back-edge avoided: node-dispatch→engine.completeStep stays a dynamic `import('./engine')`
  inside dispatchCreateTaskNode's async IIFE (DAG: gates→engine→node-dispatch→{step-context,task-bridge,instance-store};
  engine exports advanceWorkflow/propagateChildCompletion for gates but they're NOT in the barrel — public surface
  byte-identical). Pure relocation; redesign opportunities (decideGate-style dedup, atomic withInstance writes,
  contentDir-param drop, require→import, discriminated getCurrentStep union) NOT taken — noted for follow-up.
  Verified: typecheck/lint/workflows suite 419-0/full-suite 5123-0/binary build/isolated-home boot smoke (workflows
  activates + Ready; GET /definitions + /instances → 200; schedule ENOENT is the environmental openclaw-cron miss).
- workflows/index — ◧ **split by RISK** (2,146; the cluster's most entangled plugin file: module-load side
  effects — populateWorkflowRoutes runs at import; a mutable `pluginCtx` module global written in activate and
  read by route closures; and the triple-scope duplicate-helper pattern — module-scope copies feed the route
  closures while activate-scope copies feed hooks/exec-tools). The meaningful route/search/validation/gate
  extractions are inseparable from deduping those copies + replacing the pluginCtx global with ctx injection
  (behavior-touching, per the appendix), so it's tiered like dispatch/plugin-registry rather than one mega-PR.
  - ☑ Phase A (pure, zero behavior change): `lib/step-format.ts` (formatSchema/formatStepContext — pure
    presentation-for-agents) + `lib/template-list.ts` (resolveSubWorkflows/buildTemplateList/workflowSkillDrift*/
    collectWorkflowSkillRefs/countSteps — pure definition+drift aggregation). 2,146 → ~1,950. No pluginCtx
    coupling, no module-load concerns. Verified: typecheck/lint/workflows suite 419-0/full-suite 5123-0/binary
    build/isolated-home boot smoke (Workflows Ready; GET /definitions [buildTemplateList path] + /node-types → 200).
  - ☑ Phase B — the #510 validator dedup: `lib/start-validation.ts` collapses the two copies of
    getRuntimeAgentNames/collectNestedWorkflowIds/validateWorkflowForStart/createValidatedInstance (a module-scope
    set reading the `pluginCtx` global for routes + an activate-scope set closing over `ctx` for hooks/exec-tools)
    into ONE ctx-injected module. The two copies had DIVERGED — only the route copy carried the trailing
    `assignee not a known runtime agent` superset check — so the unified validator keeps the superset (REST already
    enforced it; hooks/exec-tools now do too, the intentional tightening toward one strong validator). The runtime-
    agent dep is injected as a `PluginContext | null` (null → empty agent set, matching the old module-scope guard);
    routes pass the `pluginCtx` global, hooks/exec-tools pass `ctx`. index.ts now imports only `createValidatedInstance`
    and dropped its now-unused `createInstance` import. Regression: new gate-hooks test proves the createInstance
    HOOK rejects a nested-workflow cycle (parity with the existing REST cycle test) — i.e. all three start paths
    share the recursive validator. 2,146(pre-A) → ~1,760. Verified: typecheck/lint/workflows suite 420-0/full-suite
    5124-0/binary build/boot smoke (POST /instances/start → 400 from createValidatedInstance, not 5xx).
  - Phase C (Mark approved the pluginCtx→ctx-accessor design) — focused PRs, each with a boot smoke:
    - ☑ C1 — accessor + search-sync dedup: new `lib/plugin-context.ts` (setWorkflowPluginContext/getWorkflowPluginContext)
      REPLACES the mutable `pluginCtx` module global outright, and new `lib/search-sync.ts` collapses the module-scope
      vs activate-scope copies of instanceToSearchDoc/definitionToSearchDoc/indexInstance into one ctx-injected set
      (reads the accessor; null-before-activate → no-op, matching the old guard) + adds indexDefinition for the
      availability route. index.ts no longer declares `pluginCtx` at all: the start route reads getWorkflowPluginContext(),
      activate calls setWorkflowPluginContext(ctx), the registerFileBackedContentType block imports the search docs.
      ~1,770 → ~1,700. Verified: typecheck/lint/workflows 420-0/full-suite 5124-0/binary build/boot smoke (bakin_workflows
      content type registers; GET /definitions + /search → 200).
    - ☑ C2a — definition routes: `lib/route-schemas.ts` (the shared passthroughWf/errorResponseWf/htmlResponseWf/
      repairSkillBodyWf zod consts) + `lib/routes/definitions.ts` exporting a typed `defineRoute[]` (notification-channels,
      /definitions GET/POST/PUT/DELETE/:name GET, /skills/:name/repair, availability PATCH, /node-types) with the
      user-YAML CRUD helpers (getDefinitionsDir/writeUserDefinition/findExistingUserDefinitionPath) folded in. definePlugin
      now spreads `[...definitionRoutes, ...workflowRoutes]`; populateWorkflowRoutes shrank to instances+gates. index.ts
      shed ~10 now-unused imports. 2,146(pre-A) → ~1,400. Verified: typecheck/lint/workflows 420-0/full-suite 5124-0/binary
      build/boot smoke (GET /definitions + /node-types + /notification-channels → 200, POST /definitions bad body → 400).
    - ☑ C2b — instance/step routes: `lib/trigger-dispatch.ts` (triggerDispatch extracted — shared by step/gate routes
      + activate exec-tools) + `lib/routes/instances.ts` exporting `instanceRoutes` (/steps/:taskId GET, /steps/:taskId/
      complete POST, /instances GET, /instances/:taskId GET, /instances/start POST). populateWorkflowRoutes is now
      gate-routes-only; definePlugin spreads `[...definitionRoutes, ...instanceRoutes, ...workflowRoutes]`. index.ts
      dropped the now-unused getWorkflowPluginContext import (its only reader, startHandler, moved). ~1,386 → ~940.
      Verified: typecheck/lint/workflows 420-0/full-suite 5124-0/binary build/boot smoke (GET /instances → 200,
      GET /steps/x → 404, POST /instances/start bad workflow → 400, /definitions still 200).
    - ☑ C2c — gate routes + their helpers: `lib/gate-audit.ts` (getGateDescription + buildGateAuditPayload, deduped
      from the module/route/activate triple-scope), `lib/gate-html.ts` (formValue/gateDecisionHtmlResponse/escapeHtml —
      the durable approval fallback page), `lib/gate-settings.ts` (the gateNotificationSettings seed/fallback accessor:
      setGateSettings/getGateSettings/activeGateSettings — activeGateSettings still prefers the live notifications store,
      onSettingsChange still updates the store only, so behavior is identical), and `lib/routes/gates.ts` exporting
      `gateRoutes` (approve/reject/decision GET+POST/pending/status + webApprover). populateWorkflowRoutes is DELETED;
      definePlugin spreads `[...definitionRoutes, ...instanceRoutes, ...gateRoutes]` — every route now lives in a
      lib/routes/ module. index.ts shed ~9 now-unused imports. ~1,245 → 755. Verified: typecheck/lint/workflows 420-0/
      full-suite 5124-0/binary build/boot smoke (GET /gates/pending + /gates/status → 200; /gates/x/decision missing
      params + POST /gates/x/approve bad body → 400; /instances + /definitions still 200).
    - ☑ C3a — exec-tools: `lib/exec-tools.ts` exporting `registerWorkflowExecTools(ctx)` — all 10 workflow exec tools
      (list/get_definition/start/list_instances/get_instance/get_step/complete_step + the migrated get_step/submit_step/
      check_gates formatters). activate() now calls registerWorkflowExecTools(ctx) instead of inlining ~280 lines.
      index.ts shed buildTemplateList/resolveSubWorkflows/formatStepContext/getTask/updateTask/z imports. ~755 → 472.
      Verified: typecheck/lint/workflows 420-0 (incl. exec-tools.test.ts callTool coverage)/full-suite 5124-0/binary
      build/boot smoke (plugin Ready; /definitions + /instances + /gates/pending → 200).
    - ☑ C3b — register-hooks + channel-approvals: `lib/register-hooks.ts` (registerWorkflowHooks(ctx) — all 21
      ctx.hooks.register RPC/event registrations) + `lib/channel-approvals.ts` (wireChannelApprovals(ctx) →
      rehydratePendingApprovals + the subscribeApprovalResponses handler driving approve/rejectGate from a channel,
      returns the unsubscribe handle for onShutdown). activate() now reads as orchestration: setWorkflowPluginContext →
      registerFileBackedContentType → loadDefaultWorkflows → notification wiring → wireChannelApprovals →
      registerWorkflowHooks → health checks → registerWorkflowExecTools. index.ts shed ~28 now-unused imports.
      472 → 288. Verified: typecheck/lint/workflows 420-0/full-suite 5124-0/binary build/boot smoke (plugin Ready,
      hooks+channel wiring active, all route groups 200).
    - ☑ C3c — search registration: folded the inline registerFileBackedContentType block into
      `search-sync.ts` as `registerWorkflowSearch(ctx)` (definitions+instances file patterns, onUnlink shadow-fallback,
      reindex generator, verifyExists). index.ts shed the fs/yaml/path/getManagedDefinition/loadDefinition/type imports
      the block solely used. 288 → **169 — pure activate-orchestration + lifecycle**. Verified: typecheck/lint/workflows
      420-0/full-suite 5124-0/binary build/boot smoke (bakin_workflows content type registers; /definitions + /instances
      + /gates/pending + /search → 200).
  - **WS6 workflows cluster — ☑ DONE.** runtime.ts (1,634) + index.ts (2,146) ≈ 3,780 lines of god-file decomposed into
    ~22 cohesive lib modules across 10 sequential PRs (#527 runtime split; #528 step-format+template-list; #529 #510
    validator dedup; #530 ctx-accessor+search-sync; #531 routes/definitions; #532 routes/instances; #533 routes/gates;
    #534 exec-tools; #535 hooks+channel-approvals; C3c search-reg) — every PR green on full suite + binary build + boot
    smoke. index.ts: 2,146 → 169 (92% reduction). Deferred redesigns (decideGate 6-block collapse, stdJsonResponses
    const, typed-route casts, submit_step error-message classification, gate-settings dual-source-of-truth) noted as
    follow-ups, not taken.
- models-page — ◧ **data hook extracted** (1,205 → 804 shell + 458-line hook). Phase 1 of the React split: the
  canonical extract-custom-hook refactor. `use-models-data.ts` exports `useModelsData()` holding ALL state (the ~60
  interlocking pieces), every fetcher (config/available/refresh/aliases/spend/budget/routing), the 4 effects (mount +
  spend-tab + routing-tab + the stale-auto-refresh whose deliberate partial dep-array + eslint-disable are preserved),
  every action handler (saveAgent/saveAll/saveDefaults/setAsDefault, alias CRUD, routing editors, saveBudget), and all
  derived values (modelOptions/modelsReady/availableProviders/effective*/fallbackCandidates/displayRouting/hasPending/
  defaultsDirty). The local interfaces (Routing*/Budget*/Spend*) moved with it. models-page.tsx shell destructures the
  one object so the entire return(...) JSX is byte-identical; behavior-preserving (same hook-call order). The ModelsPage
  export stays put (client.tsx slot + the 416-line test unchanged). Verified: typecheck/lint/models-page.test 10-0/
  models+components suites 341-0/full-suite 5124-0/binary build/boot smoke (Models plugin loads, rebuilt client.js → 200;
  /config 500 is environmental — runtime adapter absent in isolated home, not a regression). DEFERRED to phase 2+: the
  per-tab component extraction (agents/available/aliases/routing/spend each consume the hook) + the redesigns (3-way
  sentinel cleanup, postJson, batch saveAll, formatAge/RuntimeRestartBanner/TableSkeleton SDK extractions).
  - ☑ Phase 2a — routing + spend tabs: `routing-tab.tsx` (RoutingTab) + `spend-tab.tsx` (SpendTab), each
    `({ m }: { m: ModelsData })` destructuring from the hook (new `ModelsData = ReturnType<typeof useModelsData>` export).
    ROUTING_ORIGINS/THINKING_LEVELS moved into routing-tab; SPEND_WINDOWS + formatUsdMicros into spend-tab. Shell switched
    to `const m = useModelsData()` + slimmer destructure for the still-inline tabs, renders `<RoutingTab m={m}/>` /
    `<SpendTab m={m}/>`. models-page.tsx 804 → 561. Verified: typecheck/lint/models-page.test 10-0/full-suite 5124-0/
    binary build/boot smoke (Models loads, client.js → 200).
  - ☑ Phase 2b — agents + available + aliases tabs + shared helpers: `agents-tab.tsx` (AgentsTab — global defaults +
    fallback editor + per-agent table), `available-models-tab.tsx` (AvailableModelsTab — owns TIER_STYLES +
    formatRelativeTime), `aliases-tab.tsx` (AliasesTab), and `models-page-shared.tsx` (TableSkeleton + InlineEmpty,
    shared by agents + aliases). models-page.tsx is now a **76-line shell**: header, error/restart banners, tab bar, and
    the five `<XTab m={m}/>` renders. Verified: typecheck/lint/models-page.test 10-0/full-suite 5124-0/binary build/boot
    smoke (Models loads, client.js → 200).
  - **models-page — ☑ DONE.** 1,205 → 76-line shell across 8 cohesive files (use-models-data hook + 5 tab components +
    shared helpers), 4 PRs (#537 hook, #538 routing+spend, 2b agents+available+aliases). 94% reduction. Deferred
    redesigns (3-way sentinel cleanup, postJson, batch saveAll, formatAge/RuntimeRestartBanner/TableSkeleton SDK
    extractions) noted as follow-ups, not taken.
- workflow-canvas-editor — ◧ **pure state model extracted** (1,803 → 1,564 + 264-line lib). Phase 1: the safest cut —
  `lib/canvas-editor-state.ts` holds the pure graph/state model (layout constants NODE_WIDTH/HEIGHT/Y_SPACING/
  STANDARD_NODE_STYLE/TRIGGER+APPEND_NODE_ID/RESERVED_STEP_IDS, BUILTIN_STEP_LABELS, EditorState, stepNodeData/nextStepId/
  defaultStepBody/cloneStep, the legacy-layout heuristics, seedEdges/seedState/deriveNodes/autoArrangeState, samePosition/
  sameMeasurement). All pure over EditorState + WorkflowDefinition + xyflow types + lib/dagre-layout; zero JSX — now
  unit-testable without jsdom (follows the lib/dagre-layout precedent). The component imports them back; shed the
  now-component-unused Edge/layoutNodes/NodePosition imports. RESERVED_STEP_IDS (a test-asserted contract passed to
  NodeConfigDrawer) preserved. Verified: typecheck/lint/canvas-editor.test 29-0/workflows 420-0/full-suite 5124-0/binary
  build/boot smoke (Workflows loads, client.js → 200). DEFERRED: the dead-renderer deletion (Editor*Node shadowed by the
  registry — behavior-touching, its OWN step) + canvas-editor-nodes.tsx, workflow-details-drawer.tsx, use-workflow-copy-form,
  use-unsaved-changes-guard, and the redesigns (slugify consolidation, setIsDirty-in-updater fix, WorkflowStepPatch typing,
  postOrPut helper, key-remount reset). 
  - ☑ Phase 2 — details drawer: `workflow-details-drawer.tsx` (WorkflowDetailsDrawer) — the self-contained controlled
    name/description drawer (own draft state, props-only, no editor-state closure). Component sheds the now-unused
    Input/Label/Textarea/X imports. 1,564 → 1,469. Verified: typecheck/lint/canvas-editor.test 29-0/full-suite 5124-0/
    binary build/boot smoke (Workflows loads, client.js → 200).
  - ☑ Phase 3 — dead-renderer deletion (BEHAVIOR-TOUCHING, isolated): deleted EditorNodeShell + the 8 shadowed
    Editor*Node renderers (agent/gate/output/parallel/workflow/createTask/trigger/subflowGroup) + EditorNodeData/
    EditorNodeShellProps. They never rendered in the running app — nodeTypes = {...BUILTIN_NODE_TYPES, ...registry} and
    the registry (populated by client.tsx) won for every kind; only 'appendStep' (registry never provides it) is live.
    BUILTIN_NODE_TYPES is now just { appendStep: EditorAppendStepNode } — the editor consumes the registry exclusively
    like the workflow-canvas.tsx viewer already does. Shed AgentAssignmentLabel/UserRound/CheckCircle2/Radio/GitBranch?-no/
    ClipboardPlus/NodeProps imports + the dead `export type { ReactNode }` strict-build hack. TEST UPDATED: the smoke test
    used the real (empty-in-test) registry and relied on BUILTIN for the 'agent' nodeTypes key; now it registers stub
    renderers for the 8 client.tsx kinds in beforeEach/unregisters in afterEach, so data-node-types carries 'agent'
    (registry) + 'appendStep' (builtin) — mirroring reality. HMR note: during a registry sweep the canvas briefly has no
    renderer for swept kinds (same as the viewer already), re-populated on plugin re-activate. 1,469 → 1,306. Verified:
    typecheck/lint/canvas-editor.test 29-0/workflows 420-0/full-suite 5124-0/binary build/boot smoke (Workflows loads,
    client.js + /definitions → 200).
- Remaining: workflow-canvas-editor phases 4+ (use-workflow-copy-form, use-unsaved-changes-guard hooks — both need the
  key-remount redesign first to decouple from the props-change reset effect; flagged), schedule/index (1,443) + test splits.
