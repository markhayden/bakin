# TODO — Work-Class Model Routing & Cost Confidence

Spec: `SPEC.md` (root) · Plan: `tasks/plan-workclass-routing.md` · Branch: `feat/workclass-routing`
Rule: every commit builds green + full suite passes (`bun run test`). TDD RED→GREEN per task.

## Phase 1 — Taxonomy + ledger foundation
- [x] T1.1 `refactor(core): WorkClass taxonomy replaces Origin` — enum + WORK_CLASSES metadata + classifyDispatchWorkClass + resolveWorkClassRoute; rename-through; `Origin` gone (453bc109e; resolveSystemRoute deferred to T3.1 where it's first consumed)
- [x] T1.2 `feat(core): run_costs work_class + route_source columns (migration v8 + backfill)` — required `RunCostInput.workClass`; meterAgentTurn/recordSpend threading; 6 callers classed (0c7c5d2e8)
- [x] T1.3 `feat(models): settings.routing one-shot migration to work-class routes` — routing-migration.ts mirror; schemas; GET/PUT round-trip (6d81d3234)
- [x] ✅ Checkpoint 1: behavior identical, old shapes gone (suite 7759 pass, bundles build)

## Phase 2 — Full attribution + evidence
- [x] T2.1 `feat(core,adapters): stream usage on done chunk + conformance pin` — ChatChunk done.usage; Pi + OpenClaw populate; teeth (6a83ab445)
- [x] T2.2 `feat(chat): meter chat turns + auto-titles into run_costs` — stream-bridge + auto-title metering; startAgent metered; deleted dead deliverTaskToAgent (restartAgent KEPT — host API calls it) (9640518f4)
- [x] T2.3 `feat(team,lib): route evidence surfaces` — route_source on cost rows; task.routed humanizer + timeline; run rows "via <source>" (26b4bf60d)
- [x] ✅ Checkpoint 2: every Bakin send attributed; evidence visible (suite green; onboarding-adapter-gating 45s timeout = known pre-existing under-load flake, passes isolated)

## Phase 3 — System-send routing
- [x] T3.1 `feat(core): system call sites honor the matrix` — auto-title/enrichment(#584 guard, doc jobs only)/relays/sendMessageToAgent consult resolveSystemRoute; enrichment sends now metered too (88853c3c6)
- [x] T3.2 `feat(team): team-routing folds into the matrix` — matrix-driven model via models.seedWorkClassRoute; orphan settings deleted (e869b5336)
- [x] ✅ Checkpoint 3: matrix controls every routable class (suite 7772 pass)

## Phase 4 — Reporting
- [x] T4.1 `feat(core): byWorkClass spend facet` — engine rollup, media+unclassified buckets, runs (642be6f6f)
- [x] T4.2 `feat(models): Spend tab work-class table + legacy rollup deletion` — verbs deleted; NULL-honest rollupSpend; arch scanner (b54930fda)
- [x] T4.3 `feat(cli): bakin spend by-work-class block` (7627498c7)
- [x] ✅ Checkpoint 4: per-class spend everywhere; $0 fabrication gone (suite 7778 pass; only the known onboarding flake)

## Phase 5 — Health + recommendations + capability honesty
- [x] T5.1 `feat(core,adapters): supportedThinkingLevels on RuntimeRoutingSupport + clamp-and-warn` — conformance thinkingLevelHonesty + teeth (7cc8026fd)
- [x] T5.2 `feat(models): routing tab matrix redesign` — dispatch + system sections; supported-levels filter; clamping option surfaced (7792ab439)
- [x] T5.3 `feat(models): routing health check + recommended routes` — models.routing check; /routing/recommend; apply-recommended repair + ConfirmDialog; VISION_MODELS moved to @bakin/core/llm (1cf0ed15a)
- [x] ✅ Checkpoint 5: misrouting detectable; one-click good state (suite 7801 pass)

## Phase 6 — Docs + close-out
- [ ] T6.1 `docs(knowledge): work-class routing sweep` — 7 knowledge docs + CLAUDE.md + README check + SPEC.md as-built addendum + archive spec to .claude/specs/workclass-routing.md

## Standing rules
- Never commit `generated-version.ts` or `packages/host/src/api/_embedded-assets-static.ts` (pre-existing modified, not ours)
- Tests: both content-dir mocks, `getBakinPaths` incl. `db`, `closeDb()` before rmSync, `--isolate`, rtl-settle for RTL
- Live verify on 3737 happens BEFORE merge (Mark tests; server restart needed for server code)
