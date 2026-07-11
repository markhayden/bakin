# TODO — Search Trust & Speed

Plan: `tasks/plan-search-trust-and-speed.md` · Spec: `.claude/specs/search-trust-and-speed.md`

## P0
- [x] T1 fix(host): ⌘K debug-toggle bug + RTL test

## P1 — engine upgrade (live ops)
- [x] T2 chore(search): pin antfly v0.2.0-rc.18 (+ delete tasks/antfly-main-local-patches.diff)
- [ ] T3 ops: backup settings.json + search.db + version note (rollback point)
- [ ] T4 ops: bakin install search → rc.18 live, tables queryable
- [ ] T5 fix(search): orphan registry-row sweep + team-migration restart + projects rebuild + full clean rebuild
- [ ] **GATE A:** all legs ready, CPU ≤5% idle 10 min, registry==engine, #319 verdict recorded

## P2 — shims
- [ ] T6 canary sweep vs rc.18 → **GATE B** per-shim verdicts in evidence file
- [ ] T7 refactor(adapter-antfly): sort → order_by (if landed)
- [ ] T8 refactor(adapter-antfly): server-side query deadlines (if landed)
- [ ] T9 refactor(adapter-antfly): totals count-twin delete-or-concurrent
- [ ] T10 refactor(adapter-antfly): lookup body / filter_query removals (if flipped)
- [ ] T11 refactor(assets): WebP EMBED_SAFE_RE removal (if #338 covers)

## P3 — latency contract
- [ ] T12 feat(search): queryBudgetMs + per-table degrade/omit + metadata + telemetry
- [ ] T13 feat(host): ⌘K progress stages + partial-results chip (SDK-shared)

## P4 — observability
- [ ] T14 feat(health): backfill-spin watchdog + one-click rebuild repair
- [ ] T15 feat(search): lastIndexedAt/lastRebuildAt + numeric backlog (type+UI+CLI)

## P5 — surface trust
- [ ] T16 fix(plugins): D11 engine-down states — memory, tasks, schedule, workflows
- [ ] T17 feat(search): matched-field debug explanations

## P6 — prove + ship
- [ ] T18 stress test: seed content, 20-query p50/p95, chaos drills, UX sweep → evidence
- [ ] T19 docs(knowledge): search-system.md, search-plugin-guide.md, CLAUDE.md bullet
- [ ] T20 PR → merge → deploy to ../bakin-wt-pi → restart 3737 → live spot-check → ports clean
