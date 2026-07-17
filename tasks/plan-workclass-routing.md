# Plan — Work-Class Model Routing & Cost Confidence

## Context

Bakin's origin routing (5 dispatch origins + tag overrides) is live but dispatch-only: system call sites (auto-titles, enrichment, doctor/watchdog/budget relays, orchestrator notify, generic sends) run unrouted on agent-default models; team assignment uses an orphaned hardcoded-haiku config; auto-title/chat spend is never attributed; no surface proves a routing decision happened (`task.routed` audit is write-only); two headline Spend-tab tables still use legacy `$0`-fabricating rollups. The operator wants cheap work on cheap models, provably. Spec: `SPEC.md` (approved 2026-07-16, decisions W1–W8). Single-user machine — old shapes are replaced outright, no shims.

Branch: `feat/workclass-routing` in this checkout (test-live-before-merge: Mark verifies on 3737 before merge). After approval, this plan is saved to `tasks/plan-workclass-routing.md` + `tasks/todo-workclass-routing.md`.

## §12 open-item resolutions (probed against real code)

1. **Chat metering — requires an adapter contract change.** `messaging.stream()` surfaces NO usage on either adapter (Pi ends `{type:'done'}` at `adapter-pi/src/messaging.ts:711`; OpenClaw at `stream-events.ts:217`; the `ChatChunk` done variant has no usage field, `concepts.ts:224`; `createTurnRecorder` discards done chunks). Usage exists only on the `send()` paths (Pi `usageDelta` `:395`, OpenClaw `extractOpenClawAgentUsage`). **Resolution:** add optional `usage?: MessageUsage` to the `done` chunk; populate in both adapters from their existing helpers; meter in `stream-bridge.ts` `runTurn` right before `chat.done` emit (`plugins/chat/lib/stream-bridge.ts:231` — agentId/threadId/turnId in scope); conformance-pin stream-usage parity.
2. **`cheap-vision` recommendation source:** no modality flag in the catalog (display-only by design). Reuse `VISION_MODELS` (`plugins/assets/lib/enrichment/providers.ts:32-38`) ∩ available models, ranked by catalog `pricing` then `tier` (precedent: `resolveEnrichmentModel` + `TIER_ORDER`, `providers.ts:40,68-98`). No cheap vision model → proposal skips with reason, never blind.
3. **`send` breadth:** `sendMessageToAgent` (`src/core/agents.ts:71`, already metered) = real interactive turns → routable `send` class. `src/lib/agents.ts` `startAgent` is a real unmetered turn → metered-only `send` (fixed kick-off prompt, routing it is noise). `restartAgent`/`deliverTaskToAgent` have **zero callers** → **delete** (tech-debt priority). `stopAgent` sends nothing.
4. **Thinking-level declaration lives on `RuntimeRoutingSupport`** (not CapabilitySet): it's a routing knob; `routingSupport()` is sync/static and already drives UI knob-hiding via `/config` (`plugins/models/lib/routes.ts:129`). Deviation from the spec §7 touch-map wording — convention wins; record in as-built addendum.
5. **Backfill verdict: `turn:` → NULL, not `relay`.** `turn:${uuid}` is the synthetic fallback for EVERY `meterAgentTurn` without a runId (`agent-cost.ts:131`) — relays AND generic operator sends share it, and run_costs stores no discriminator. Mapping to `relay` would mislabel history → violates never-guess. Backfill: `chat:%:title` → `auto-title` (safe unique prefix, currently unproduced); everything else → NULL "unclassified (pre-migration)".
6. **Premium-on-cheap warn threshold:** catalog `tier` (`known-models.ts:52`) — warn when a cheap-recommended class ran on a `premium`-tier model in 7d. Untiered models skipped.
7. **CLI:** extend `cmdSpend` in `src/cli/commands/budget.ts` — new "By work class" `printTable` block after "By model" (`:166`), from a new `byWorkClass` array on `SpendPayload`. No new module.

## Key reuse (found, not built)

- Settings migration: mirror `plugins/models/lib/budget-migration.ts` (type-guard + one-shot activation write-back + read-guard in `register-hooks.ts:127-131`).
- Ledger column+backfill: `usage_kind` migration precedent (`ledger.ts:224-225`, ADD COLUMN + `UPDATE … WHERE run_id LIKE`). New migration is **version 8** (array ends at 7).
- Health check + repair: `plugins/schedule/lib/health-checks.ts` + `schedule/index.ts:137-174` (repair registered first; observations carry structured `evidence`; `resolution: {type:'repair', actionId}`).
- Conformance: `capabilitiesAreHonest` (`conformance.ts:394-428`) + per-lie teeth adapters (`teeth.conformance.test.ts:145-283`).
- Spend engine: extend `assembleBudgetSpend` (`src/core/budget-spend.ts`) with `byWorkClass` — never fork.
- Metering chokepoint: `meterAgentTurn`/`recordSpend` (`src/core/agent-cost.ts:97/38`) → `recordRunCost` (`ledger.ts:976`, INSERT OR IGNORE) — one writer, add `workClass`/`routeSource` once.

## Dependency graph

```
P1 taxonomy+ledger  ──►  P2 attribution+evidence  ──►  P4 reporting
        │                        │
        └──►  P3 system routing ─┘
P5 health/recommend/capability needs P1 (types) + P3 (routes exist to check) + P4 (spend evidence)
P6 docs last
```

## Tasks (commit = rollback checkpoint; every commit builds green + full suite passes; TDD RED→GREEN per task)

### Phase 1 — Taxonomy + ledger foundation

**T1.1 `refactor(core): WorkClass taxonomy replaces Origin`**
- `src/core/model-routing.ts`: `WorkClass` union (5 dispatch + `auto-title|enrichment|relay|team-routing|send|chat`), `WORK_CLASSES` metadata table (`{id,label,description,routable,kind,recommendedTier?}`; `chat` routable:false), `classifyDispatchWorkClass` (rename of `classifyOrigin`, same precedence), `resolveTurnModel(config, workClass, tags)`, new `resolveSystemRoute(workClass)` helper reading the `models.getRoutingConfig` hook. `RoutingConfig` → `{routes: WorkClassRoute[]; tagOverrides}`.
- Rename-through consumers: `dispatch-turns.ts`, `plugins/models/lib/route-schemas.ts` (imports ORIGINS), `types.ts`. `Origin` identifier gone (grep-verified).
- Tests: `tests/core/model-routing.test.ts` + `routing-types.test.ts` updated — dispatch classification 1:1 regression table; `chat` unroutable assertion.
- ✓ Verify: full suite; `grep -r "Origin" src/core/model-routing.ts` clean.

**T1.2 `feat(core): run_costs work_class + route_source columns (migration v8 + backfill)`**
- `ledger.ts`: migration 8 — ADD COLUMN ×2 + backfill (`chat:%:title`→`auto-title`; all else NULL). `RunCostInput` gains **required** `workClass: WorkClass|null` + optional `routeSource`; INSERT columns/params extended; facade `src/core/execution-ledger.ts` types lockstep.
- `agent-cost.ts`: `recordSpend` + `meterAgentTurn` take `workClass` (required) / `routeSource`; `meterImageTurn` passes `workClass: null` (media excluded per spec). All 6 existing callers updated: dispatch (its dispatch class + route_source), doctor/watchdog/task-service/budget-notify → `relay`, agents.ts → `send`.
- Tests: `ledger-run-costs-migration`-style migration test (v8 + backfill truth table incl. `turn:`→NULL); `ledger-migration-seq`; compile-level required-field check.
- ✓ Verify: suite; fresh + migrated DB both work.

**T1.3 `feat(models): settings.routing one-shot migration to work-class routes`**
- New `plugins/models/lib/routing-migration.ts` (mirror budget-migration): `isLegacyRouting` (`'policies' in x && !('routes' in x)`), `migrateLegacyRouting` (origin→workClass 1:1). One-shot at activation with write-back + read-guard in `models.getRoutingConfig`.
- `route-schemas.ts`: `WorkClassRouteSchema`/`RoutingConfigSchema` new shape; GET/PUT `/routing` round-trip.
- Tests: mirror `budget-migration.test.ts` (idempotent, old key deleted).
- **Checkpoint 1:** behavior identical (no routes → inherit everywhere); old shapes gone.

### Phase 2 — Full attribution + evidence

**T2.1 `feat(core,adapters): stream usage on done chunk + conformance pin`**
- `concepts.ts:224`: `done` ChatChunk variant gains `usage?: MessageUsage`. Pi: reuse `usageDelta` on the stream path (`messaging.ts:711` + abort path). OpenClaw: reuse usage extraction on stream terminal (`stream-events.ts:217`).
- Conformance: stream turn reports usage where send does; teeth adapter that omits it.
- ✓ Verify: conformance suite vs mock/Pi/OpenClaw-mock.

**T2.2 `feat(chat): meter chat turns + auto-titles into run_costs`**
- `stream-bridge.ts` `runTurn`: capture `done.usage` → `meterAgentTurn({agent, activityClass:'user', workClass:'chat', result:{...usage}, name:'turn'})` before `chat.done` emit; aborted turns metered with whatever usage arrived.
- `auto-title.ts`: meter the send result (`workClass:'auto-title'`).
- `src/lib/agents.ts`: meter `startAgent` (`send`); **delete dead `restartAgent`/`deliverTaskToAgent`**.
- Tests: `auto-title.test.ts` metering assertion; new stream-bridge metering test (mock runtime emits usage on done); run_costs rows appear with class+lane.

**T2.3 `feat(team,lib): route evidence surfaces`**
- `dispatch-turns.ts`: record `route_source` (`tag:<name>|class|inherit`) + applied thinking on the cost row.
- `map-audit-message.ts`: `task.routed` humanizer; `timeline.ts` adds it to `TIMELINE_AUDIT_KINDS`; run rows render `model · tokens · $ · via <source>` (`diagnostics-tab.tsx`).
- Tests: route_source truth table (tag/class/inherit); RTL timeline render.
- **Checkpoint 2:** every Bakin send attributed; per-run evidence visible in Team Diagnostics.

### Phase 3 — System-send routing

**T3.1 `feat(core): system call sites honor the matrix`**
- `resolveSystemRoute` consumed by: `auto-title.ts`, `enrichment/runtime.ts` (note: keep the #584 gateway-attachment guard — route only when the runtime engine path permits a model override; otherwise metered-only, documented), `doctor-escalation.ts`, `watchdog.ts`, `budget-notify.ts`, `task-service.ts` (relay), `agents.ts` `sendMessageToAgent` (send). Resolved `{model, thinking}` → `messaging.send` args; route_source onto their meter calls.
- Tests: per-site mock-runtime assertion that routed model/thinking reach `send`; no-route = today's behavior byte-identical.

**T3.2 `feat(team): team-routing folds into the matrix`**
- `assignment-resolver.ts`: model comes from the `team-routing` matrix route; fallback `DEFAULT_ROUTING_MODEL` unchanged when unrouted. Seed-migrate old `settings.routingModel`/`routingProvider` into a matrix route if set + no route exists; delete the settings keys + their UI field.
- Tests: matrix-driven model selection; seed migration; provider derivation from model id.
- **Checkpoint 3:** matrix controls every routable class.

### Phase 4 — Reporting

**T4.1 `feat(core): byWorkClass spend facet`**
- `budget-spend.ts`: `byWorkClass` rollup (attributed-only, lane-aware, tokens + micros + runs; NULL bucket = "unclassified"). Server-side avg cost/run.
- Tests: facet truth table in `budget-spend.test.ts`; engine↔route parity.

**T4.2 `feat(models): Spend tab work-class table + legacy rollup deletion`**
- Spend route returns `byWorkClass`; **delete `spendTotal`/`spendByAgent`/`spendByModel`** (`ledger.ts:1012-1051`) — byAgent/byModel tables re-read engine facets. `spend-tab.tsx`: "By work class" table (class|runs|tokens|est.$|avg $/run, lane-aware); `use-models-data.ts` shapes.
- Tests: no fabricated $0 for unpriced runs (regression); no callers of deleted verbs (grep assertion in an architecture-style test); RTL table render.

**T4.3 `feat(cli): bakin spend by-work-class block`**
- `budget.ts` `cmdSpend`: block after By model; `SpendPayload.byWorkClass`.
- Tests: `budget-command.test.ts` output path.
- **Checkpoint 4:** per-class spend everywhere; $0 fabrication gone.

### Phase 5 — Health + recommendations + capability honesty

**T5.1 `feat(core,adapters): supportedThinkingLevels on RuntimeRoutingSupport + clamp-and-warn`**
- `concepts.ts`: `RuntimeRoutingSupport.supportedThinkingLevels: ThinkingLevel[]`. Pi declares `off..xhigh`; OpenClaw all; mocks a subset.
- Clamp at resolution (`model-routing.ts` or dispatch/system resolve layer): unsupported → nearest lower (`max`→`xhigh`; `adaptive`→inherit), recorded on receipt (`route_source` detail / applied-thinking field) + audit. Pi's silent drop replaced by honoring the clamped value.
- Conformance `thinkingLevelHonesty` check + per-lie teeth adapter.
- Tests: clamp table; conformance teeth.

**T5.2 `feat(models): routing tab matrix redesign`**
- `routing-tab.tsx`: dispatch + system sections from `WORK_CLASSES` metadata (chat excluded); thinking dropdowns filtered by `supportedThinkingLevels` from `/config`; per-row resolved display ("inherit → agent default").
- Tests: RTL — sections render, unsupported levels absent, edit round-trip.

**T5.3 `feat(models): routing health check + recommended routes`**
- New `plugins/models/lib/health-checks.ts`: `models.routing` check — warn unrouted routable system classes (evidence: recent per-class spend), error route→unavailable model, error/warn standing clamp on active runtime, warn premium-tier model on cheap class (7d). Structured `evidence` rows.
- `POST /routing/recommend`: proposals (cheapest available per class; `cheap-vision` via VISION_MODELS ∩ available; skip-with-reason). Repair action `apply-recommended-routes` (registered first, schedule pattern). Routing tab "Apply recommended routes" → ConfirmDialog diff preview → PUT.
- Tests: check states; recommend picks (incl. vision + skip case); repair applies; RTL ConfirmDialog flow.
- **Checkpoint 5:** misrouting detectable; one-click good state.

### Phase 6 — Docs + close-out

**T6.1 `docs(knowledge): work-class routing sweep`**
- Update `.claude/knowledge/{models-plugin,dispatch,execution-ledger,usage-recording,chat-plugin,doctor-and-health-checks,runtime-capabilities}.md`; CLAUDE.md Cost Control + key-patterns lines; README model-routing claims check; SPEC.md as-built addendum (§12 resolutions incl. RuntimeRoutingSupport deviation + turn:→NULL verdict); archive spec to `.claude/specs/workclass-routing.md`.

## Testing strategy notes

CLAUDE.md rules mandatory everywhere (both content-dir mocks, `getBakinPaths` incl. `db`, `closeDb()` before rm, `--isolate`, rtl-settle for RTL files, logger/watcher/AppServices mocks). Regression surface enumerated: `tests/core/{model-routing,routing-types,budget-spend,budget-gate,budget,execution-ledger*,ledger-*}.test.ts`, `tests/adapter-openclaw/model-routing.test.ts`, `tests/plugins/models/budget-migration.test.ts`, `tests/plugins/chat/auto-title.test.ts`, `tests/plugins/assets/enrichment-*.test.ts`, `tests/cli/budget-command.test.ts`, `tests/integration/runtime-conformance/*`. Net-new: routing-tab/spend-tab RTL, models health-check, byWorkClass facet, stream-usage conformance, routing-migration.

## Verification (end-to-end)

1. Full suite green after every commit (`bun run test`).
2. `/verify` skill (isolated boot): PUT a route `auto-title → <cheap model>` → trigger a chat + title via HTTP → assert run_costs rows carry `work_class` + `route_source` + routed model; GET `/spend` shows byWorkClass rows; health check warns before routes, clears after apply-recommended.
3. Live on 3737 (Mark): restart server on branch; set routes via Routing tab; watch Spend tab by-work-class populate; Team Diagnostics shows "via class"; `bakin spend` matches.
4. Conformance suite passes for mock + Pi + OpenClaw-mock (stream usage, thinking honesty).

## Risks / watch items

- **Adapter stream-usage (T2.1)** is the riskiest slice — touches both adapters' stream plumbing; do it TDD against the conformance harness first.
- Enrichment routing must respect the #584 gateway-attachment gate (runtime engine sends no per-turn model when attachments ride) — route only where legal, else metered-only.
- Ledger migration v8 runs against the production `~/.bakin/bakin.db` on first boot of the branch — backfill statements are additive UPDATEs, rollback = git revert (columns are nullable, old code ignores them) — but don't downgrade-boot after new rows exist (required `workClass` is app-level only).
- `budget-migration` read-guard precedent means the routing read-guard is acceptable transitional cleanup, not a dual-read shim (matches existing convention).
