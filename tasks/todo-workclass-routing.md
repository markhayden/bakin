# TODO — Work-Class Model Routing & Cost Confidence

Spec: `SPEC.md` (root) · Plan: `tasks/plan-workclass-routing.md` · Branch: `feat/workclass-routing`
Rule: every commit builds green + full suite passes (`bun run test`). TDD RED→GREEN per task.

## Phase 1 — Taxonomy + ledger foundation
- [ ] T1.1 `refactor(core): WorkClass taxonomy replaces Origin` — enum + WORK_CLASSES metadata + classifyDispatchWorkClass + resolveSystemRoute; rename-through; `Origin` gone
- [ ] T1.2 `feat(core): run_costs work_class + route_source columns (migration v8 + backfill)` — required `RunCostInput.workClass`; meterAgentTurn/recordSpend threading; 6 callers classed
- [ ] T1.3 `feat(models): settings.routing one-shot migration to work-class routes` — routing-migration.ts mirror; schemas; GET/PUT round-trip
- [ ] ✅ Checkpoint 1: behavior identical, old shapes gone

## Phase 2 — Full attribution + evidence
- [ ] T2.1 `feat(core,adapters): stream usage on done chunk + conformance pin` — ChatChunk done.usage; Pi + OpenClaw populate; teeth
- [ ] T2.2 `feat(chat): meter chat turns + auto-titles into run_costs` — stream-bridge + auto-title metering; startAgent metered; delete dead restartAgent/deliverTaskToAgent
- [ ] T2.3 `feat(team,lib): route evidence surfaces` — route_source on cost rows; task.routed humanizer + timeline; run rows "via <source>"
- [ ] ✅ Checkpoint 2: every Bakin send attributed; evidence visible

## Phase 3 — System-send routing
- [ ] T3.1 `feat(core): system call sites honor the matrix` — auto-title/enrichment(#584 guard)/relays/sendMessageToAgent consult resolveSystemRoute
- [ ] T3.2 `feat(team): team-routing folds into the matrix` — matrix-driven model; seed-migrate + delete orphan settings
- [ ] ✅ Checkpoint 3: matrix controls every routable class

## Phase 4 — Reporting
- [ ] T4.1 `feat(core): byWorkClass spend facet` — engine rollup, NULL bucket, avg cost/run
- [ ] T4.2 `feat(models): Spend tab work-class table + legacy rollup deletion` — spendTotal/spendByAgent/spendByModel deleted; tables re-read engine
- [ ] T4.3 `feat(cli): bakin spend by-work-class block`
- [ ] ✅ Checkpoint 4: per-class spend everywhere; $0 fabrication gone

## Phase 5 — Health + recommendations + capability honesty
- [ ] T5.1 `feat(core,adapters): supportedThinkingLevels on RuntimeRoutingSupport + clamp-and-warn` — conformance thinkingLevelHonesty + teeth
- [ ] T5.2 `feat(models): routing tab matrix redesign` — dispatch + system sections; supported-levels filter
- [ ] T5.3 `feat(models): routing health check + recommended routes` — models.routing check; /routing/recommend; apply-recommended repair + ConfirmDialog
- [ ] ✅ Checkpoint 5: misrouting detectable; one-click good state

## Phase 6 — Docs + close-out
- [ ] T6.1 `docs(knowledge): work-class routing sweep` — 7 knowledge docs + CLAUDE.md + README check + SPEC.md as-built addendum + archive spec to .claude/specs/workclass-routing.md

## Standing rules
- Never commit `generated-version.ts` or `packages/host/src/api/_embedded-assets-static.ts` (pre-existing modified, not ours)
- Tests: both content-dir mocks, `getBakinPaths` incl. `db`, `closeDb()` before rmSync, `--isolate`, rtl-settle for RTL
- Live verify on 3737 happens BEFORE merge (Mark tests; server restart needed for server code)
