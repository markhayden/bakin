# TODO — Same-Agent Concurrency

Spec: `.claude/specs/same-agent-concurrency.md` (r4) · Plan: `tasks/plan-same-agent-concurrency.md`
Branch: `feat/same-agent-concurrency`
Rule: every commit builds green + full suite passes (`bun run test`). TDD RED→GREEN per task.

## Phase 1 — Gate integrity (live bugs)
- [x] T1.1 `fix(dispatch): registry keyed by threadId; supersede aborts; force-release settles ledger` (2709019f6)
- [x] T1.2 `fix(dispatch): workflow gate honors cycle reserved counts` (7a27d0afc)
- [x] ✅ Checkpoint 1: suite green (7927 pass, 0 fail); live 3737 validation pending Mark's next server restart (server code isn't hot-reloaded — passive checkpoint)

## Phase 2 — Capability contract
- [x] T2.1 `feat(core): CapabilitySet.concurrency + MessageArgs.runWorkspace; all adapters declare; conformance + teeth` (2d04a1fb6)
- [x] ✅ Checkpoint 2: conformance green all 4 legs (84 tests); full suite 7934 pass; zero behavior change

## Phase 3 — Pi adapter isolation
- [x] T3.1 `feat(adapter-pi): honor runWorkspace cwd; declare isolated` (21a466120) — AS-BUILT: context/skills need NO seeding (SDK discovery rides the workspace-pinned loader, not session cwd); only root *.md symlinks seeded + severed-link recovery; threads.json queue replaced by a sync-invariant comment pin (RMW is single-event-loop atomic); git checkouts never seeded (.git guard)
- [x] ✅ Checkpoint 3: Pi isolation conformance green (real bash probe, concurrent turns); full suite 7940 pass; production unchanged (core doesn't pass runWorkspace yet)

## Phase 4 — Core allocation + clamp + assets
- [x] T4.1 `feat(core): run-workspace module + watcher exclusions` (6d007fa24)
- [x] T4.2 `feat(dispatch): capability clamp + run-dir allocation + runWorkspace sends` (351ea8126) — AS-BUILT: allocation lives in the fire settle-chain (post-claim, runs after the lock releases — no pre-lock restructuring needed); failed runs KEEP dirs (eager removal only pre-send); prompt scratch line is static text (no per-run paths in fixtures)
- [x] T4.3 `feat(assets): run-aware identity + staleness gate` (3f7a6ad67) — new ledger verb getRunStatus; virtual dedup key read from sidecar
- [ ] ✅ Checkpoint 4: manual cap-2 live validation on 3737 (two tasks, one agent, distinct dirs, context/skills present) — MARK GATE, pending (needs server restart onto this branch; suite green: 7957 tests)

## Phase 5 — GC + doctor
- [x] T5.1+T5.2 `feat(dispatch): sweep + doctor check` (6357c4c1e) — one commit (check is thin over the sweep engine); collapsed classifier per r4; deps injected from watchdog
- [x] ✅ Checkpoint 5: closed-loop lifecycle; suite green (known onboarding flake only, passes isolated)

## Phase 6 — Worktrees
- [x] T6.1–T6.3 (bcdb78c9c) — AS-BUILT: no in-tree projects plugin exists (it's an installed bits plugin) — binding = task-level repoPath + feature-detected projects.getRepo hook contract (brandId architecture); bits-side hook registration is a follow-up. Materialization in the fire settle-chain (this turn waits, dispatch doesn't). Corrective prompts point at the dead attempt's retained run dir via SessionDeathState.lastRunId (added with the docs commit).
- [ ] ✅ Checkpoint 6: bound task end-to-end live on 3737 — MARK GATE, pending (covered by integration tests meanwhile)

## Phase 7 — Surfaces + flip
- [x] T7.1–T7.3 (0f651899a) — chip registry-first with heartbeat fallback for non-dispatch work; switch guard allows dry-run; default flipped to 2
- [ ] ✅ Checkpoint 7: #447 acceptance live + overnight soak at cap 2 — MARK GATE, pending (needs server restart onto this branch)

## Phase 8 — Docs + close-out
- [x] T8.1 `docs(knowledge)` — new same-agent-concurrency.md; dispatch/pi-adapter/runtime-capabilities/assets-versioning + CLAUDE.md updated; spec → FINAL; README unaffected (no cap claims)
- [ ] T8.2 Rig experiment (OpenClaw concurrent-run observation) + file 3 upstream + 6 follow-up issues — HELD for the Mark validation session (rig runs Docker on this box; upstream reports want the observations; standing rule: no background dev instances)

## As-built deviations from spec r4 (addendum)
1. Pi needs NO context/skills seeding — SDK discovery rides the workspace-pinned resource loader, not the session cwd (r4's D2 channels 1-2 collapsed; only root-*.md memory symlinks + severed-link recovery remain). Bound-task memory writes land in the worktree (documented; layered-context guidance covers).
2. threads.json write queue → synchronous-RMW invariant comment pin (the RMW is single-event-loop atomic; a queue would guard nothing today).
3. Failed sends KEEP their run dir (salvage classes own it) — r4's "send throw removes eagerly" applies only pre-send (allocation sits after the existence check).
4. Ephemeral-dirless is enforced structurally (only sendDispatchMessage sets runWorkspace) + serialized-mode send assertions; no separate conformance case.
5. Allocation+materialization live in the fire settle-chain (naturally post-claim/out-of-lock) — no pre-lock pass restructuring was needed.
6. Clamp audit is once-per-boot (standing condition, not an event stream).

## Standing rules
- Never commit `generated-version.ts` or `packages/host/src/api/_embedded-assets-static.ts` (pre-existing modified, not ours)
- Tests: both content-dir mocks, `getBakinPaths` incl. `db`, `closeDb()` before rmSync, `--isolate`, rtl-settle for RTL, PI_HOME env before imports
- Live verify on 3737 BEFORE merge (Mark tests; server restart per server-code change)
- Nothing seeded inside repo checkouts; watcher exclusions land with allocation (same commit)
