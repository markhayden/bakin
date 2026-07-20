# TODO — Same-Agent Concurrency

Spec: `.claude/specs/same-agent-concurrency.md` (r4) · Plan: `tasks/plan-same-agent-concurrency.md`
Branch: `feat/same-agent-concurrency`
Rule: every commit builds green + full suite passes (`bun run test`). TDD RED→GREEN per task.

## Phase 1 — Gate integrity (live bugs)
- [ ] T1.1 `fix(dispatch): registry keyed by threadId; supersede aborts; force-release settles ledger`
- [ ] T1.2 `fix(dispatch): workflow gate honors cycle reserved counts`
- [ ] ✅ Checkpoint 1: suite green; 3737 dispatch behavior unchanged through one cron cycle

## Phase 2 — Capability contract
- [ ] T2.1 `feat(core): CapabilitySet.concurrency + MessageArgs.runWorkspace; all adapters declare; conformance + teeth`
- [ ] ✅ Checkpoint 2: conformance green all legs; zero behavior change

## Phase 3 — Pi adapter isolation
- [ ] T3.1 `feat(adapter-pi): honor runWorkspace cwd; context/skills/memory channels; threads.json queue; declare isolated`
- [ ] ✅ Checkpoint 3: Pi isolation conformance green; production unchanged (core doesn't pass runWorkspace yet)

## Phase 4 — Core allocation + clamp + assets
- [ ] T4.1 `feat(core): run-workspace module (allocation, sidecar, encoding) + watcher exclusions`
- [ ] T4.2 `feat(dispatch): post-claim out-of-lock allocation + capability clamp + prompt template`
- [ ] T4.3 `feat(assets): run-aware identity + staleness gate`
- [ ] ✅ Checkpoint 4: manual cap-2 live validation on 3737 (two tasks, one agent, distinct dirs, context/skills present) — Mark gate; revert setting after

## Phase 5 — GC + doctor
- [ ] T5.1 `feat(dispatch): sweep — classifier, retention, size budget, single-flight, lazy stamp`
- [ ] T5.2 `feat(health): dispatch.run-dirs check + sweep-now repair`
- [ ] ✅ Checkpoint 5: closed-loop lifecycle; doctor visibility

## Phase 6 — Worktrees
- [ ] T6.1 `feat(projects): repoPath binding + getRepo hook + task override`
- [ ] T6.2 `feat(core): git-worktree module (global mutex, --force settle-death) + plugin reconciliation + allowlist default fix`
- [ ] T6.3 `fix(workflows): default video workflows pass assetIds`
- [ ] ✅ Checkpoint 6: bound task end-to-end live on 3737 (branch commits, no double-checkout, worktree removed, branch survives) — Mark gate

## Phase 7 — Surfaces + flip
- [ ] T7.1 `feat(team): status chip from in-flight registry; heartbeat = liveness only`
- [ ] T7.2 `feat(settings): dispatch caps + run-dir fields in System & Alerts (#447)`
- [ ] T7.3 `feat(runtime): switch in-flight guard; default maxTurnsPerAgent → 2`
- [ ] ✅ Checkpoint 7: #447 acceptance live; overnight normal-workload soak at cap 2 — Mark gate before merge

## Phase 8 — Docs + close-out
- [ ] T8.1 `docs(knowledge): same-agent-concurrency doc + sweep (CLAUDE.md, 10 knowledge/docs files, spec → FINAL)`
- [ ] T8.2 Rig experiment (OpenClaw concurrent-run observation) + file 3 upstream + 5 follow-up issues

## Standing rules
- Never commit `generated-version.ts` or `packages/host/src/api/_embedded-assets-static.ts` (pre-existing modified, not ours)
- Tests: both content-dir mocks, `getBakinPaths` incl. `db`, `closeDb()` before rmSync, `--isolate`, rtl-settle for RTL, PI_HOME env before imports
- Live verify on 3737 BEFORE merge (Mark tests; server restart per server-code change)
- Nothing seeded inside repo checkouts; watcher exclusions land with allocation (same commit)
