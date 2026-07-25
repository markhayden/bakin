# Plan — Same-Agent Concurrency: Per-Run Workspace Isolation + Worktrees

## Context

Today `maxTurnsPerAgent: 1` is the only thing preventing same-agent filesystem collisions — both
adapters pin one workspace dir per agent, and nothing else serializes. Spec r4 (CONVERGED after 4
audit rounds): `.claude/specs/same-agent-concurrency.md`; evidence + audit trail:
`.claude/specs/same-agent-concurrency-discovery.md` (§1-4 discovery, §5-7 audits). Closes #447.
Single-user machine — no compat, no shims; replace outright.

Branch: `feat/same-agent-concurrency` in this checkout (test-live-before-merge: Mark validates on
3737 before merge; server restart needed per server-code commit).

## Open-item resolutions (decided here, probed against real code)

1. **Who seeds run-dir-root context: the adapter.** D2 assigns "making context conventions reach
   the cwd" to the adapter; Pi's session open (`packages/adapter-pi/src/messaging.ts:311,369` +
   `sessions.ts:107-116`) is the one place that knows both the workspace root and the run dir.
   Seeds: `AGENTS.md` symlink + durable-memory symlinks at the RUN-DIR ROOT (never inside
   `repo/`); skills injected via the SDK's `skillsOverride`/`loadSkills({skillPaths})` (loader
   constructed at `messaging.ts:332-346` — verified surface, no filesystem seeding). The
   settle-time severed-symlink recovery runs in the adapter's turn `finally`
   (`messaging.ts:604-610`) — it knows the seeded set.
2. **Force-release settles the ledger row via the existing `loseRun` verb** (already used by
   prep-failure at `src/core/dispatch-prepare.ts:164-172`) — no new ledger verb. Watchdog
   force-release (`src/core/watchdog.ts:476`) gains the call.
3. **New core module `src/core/run-workspace.ts`** is the SOLE owner of: encoding
   (`:`→`-` + 8-char hash), allocation (`mkdir` + sidecar in one sync block), sidecar IO
   (atomic tmp+rename), classifier, aggregate size. Sweep + doctor + assets identity all import
   from it — no second sidecar reader/writer anywhere.
4. **New core module `src/core/git-worktree.ts`** owns the ONE global git mutex + add/remove/
   prune/branch-advisory helpers. Dispatch materialization and the sweep both use it; the git
   PLUGIN keeps its own flow (unbound tasks) untouched except the `bakin/run/` branch-param
   rejection and the allowlist-default fix.
5. **Repo binding rides the projects plugin** mirroring the brand pattern: `repoPath` on the
   project record, `projects.getRepo` hook (getBrand precedent per CLAUDE.md brands bullet),
   lazy ancestry resolution at dispatch. Task-level override field on task metadata like
   `brandId`.
6. **Conformance anchors:** shared checks in `tests/integration/runtime-conformance/` extend the
   `capabilitiesAreHonest` pattern (`conformance.ts:394-428`) with per-lie teeth
   (`teeth.conformance.test.ts` precedent); default mock stays MINIMAL (`serialized`).
7. **Assets touch points:** save handler `plugins/assets/lib/exec-tools.ts:149-164`;
   upsert/lock `plugins/assets/lib/asset-upsert.ts:59-144` (`withAssetLock` already serializes —
   the staleness gate slots inside it, one ledger read via the `src/core/execution-ledger`
   facade).
8. **Settings:** `dispatch.runDirRetentionDays` (7) + `dispatch.runDirMaxTotalBytes` (default
   4 GB) join `packages/core/src/settings.ts` dispatch defaults (`:355-366`); failed retention
   is a fixed 30d constant in `run-workspace.ts` (spec r4 — no knob).
9. **Sidecar `sizeBytes` uses a `du`-equivalent walk once per dir** (settle or lazy-stamp),
   never at doctor time; aggregate cached in-process, rebuilt by summing sidecars on first
   sweep after boot.

## Key reuse (found, not built)

- Pre-lock long-work pattern: team-routing pre-pass (`src/core/dispatch-team.ts:455-546`) — the
  shape for post-claim/out-of-lock allocation+materialization.
- Ledger idempotent claim/settle verbs (`packages/core/src/execution/ledger.ts:428-523`) — no
  new coordination facts; sidecars are content, not ledger rows.
- Clamp-and-warn: thinking-level clamp receipt+audit precedent (workclass initiative T5.1).
- Watcher ignore mechanics: `antfly/` entry in `shouldIgnoreContentWatcherPath`
  (`src/core/watcher.ts:131-168`).
- Health check + repair registration: `plugins/schedule/lib/health-checks.ts` pattern; incident
  class `cleanup_backlog` (#690 enum).
- Doctor/team chip data source: in-flight registry counts (`src/core/dispatch-registry.ts:37-44`)
  — same numbers D7 uses.
- `#604` orphan sweep ordering (`watchdog.ts:464-487`) — task-deletion dir sweep rides it.
- Byte-fixture templating: `SYNTHETIC_TASK_ID` (`src/core/context-report.ts:36`).

## Dependency graph

```
P1 gate integrity (live bugs) ─► independent, lands first
P2 capability+MessageArgs ─► P3 Pi adapter isolation ─► P4 core allocation+clamp ─► P5 sweep+doctor
                                                              │                        │
                                                              └────► P6 worktrees ◄────┘ (git half of GC)
P7 surfaces + default flip needs P3+P4 (isolation proven) ─► P8 docs/follow-ups/rig
```

Strictly linear except P5/P6 share P4; build order = commit order. Every commit: builds green,
full suite passes (`bun run test`), independently revertable.

## Tasks (commit = rollback checkpoint; TDD RED→GREEN per task)

### Phase 1 — Gate integrity (live bugs today)

**T1.1 `fix(dispatch): registry keyed by threadId; supersede aborts; force-release settles ledger`**
- `src/core/dispatch-registry.ts`: map key marker→threadId; `marker` becomes an indexed field
  (`abortTurnsForTask` scans by it — already a value-scan); `unregisterTurn(threadId)` deletes
  only its own entry; `registerTurn` over an existing threadId audits `dispatch.registry_clobber`.
- `src/core/watchdog.ts` supersede path (`:229-268`): call `abortTurnsForTask(taskId,
  'superseded')` at supersede time; force-release (`:476-483`) keys by threadId, audits the new
  key, and calls ledger `loseRun`.
- `src/core/dispatch-turns.ts:679` `.finally` unregisters by threadId.
- Gate policy pinned: aborted-but-unsettled entries STILL count (spec D3; test documents the
  transient double-count).
- Tests: supersede→refire interleaving (zombie settle cannot delete live entry; new turn counted/
  abortable); force-released row reads `lost`; superseded zombie takes the clean-abort branch
  (no recovery ladder — double-dispatch regression).
- ✓ Verify: full suite; targeted `bun test tests/core/dispatch-*.test.ts --isolate`.

**T1.2 `fix(dispatch): workflow gate honors cycle reserved counts`**
- `src/core/dispatch-cycle.ts:197-218`: pass `{total: pendingTurns.length, forAgent:
  pendingByAgent}` into `dispatchWorkflowTask`; `src/core/dispatch-workflow.ts:140` threads it
  to `concurrencyGate`.
- Tests: mid-cycle matrix — [regular, regular, workflow-step] for one agent at cap 1 and 2;
  breach regression (today's 2×-at-cap-1 reproduced RED first).
- **Checkpoint 1:** suite green; live on 3737 — normal dispatch behavior unchanged (caps still
  1/3); watch one cron cycle.

### Phase 2 — Capability contract

**T2.1 `feat(core): CapabilitySet.concurrency + MessageArgs.runWorkspace; all adapters declare`**
- `packages/core/src/adapters/runtime/concepts.ts:537-544`: required `concurrency:
  { sameAgentTurns: 'isolated'|'serialized' }`; `MessageArgs.runWorkspace?: string`.
- Declarations in the same commit (required member must typecheck everywhere): Pi `serialized`
  (temporary, flipped in T3), OpenClaw `serialized`, dev conformance mock `serialized`,
  Imitation-Crab-backed adapter path unchanged (declaration lives in the adapter).
- Conformance (`tests/integration/runtime-conformance/`): `sameAgentTurnsHonesty` — `isolated`
  adapters must place two CONCURRENT same-agent turns in the two distinct `runWorkspace` dirs
  handed to them; ephemeral turns (no threadId) never touch `runWorkspace`. Teeth: an adapter
  declaring isolated while ignoring `runWorkspace` fails.
- ✓ Verify: conformance suite all legs; full suite.
- **Checkpoint 2:** contract exists, zero behavior change (nobody passes `runWorkspace` yet).

### Phase 3 — Pi adapter isolation

**T3.1 `feat(adapter-pi): honor runWorkspace cwd + context/skills/memory channels`**
- `sessions.ts:107-116`: cwd = `args.runWorkspace ?? getAgentWorkspaceDir(agentId)`.
- Seeding at session open when `runWorkspace` set (resolution 1): `AGENTS.md` + durable-memory
  symlinks at run-dir root; skills via `skillsOverride`/`loadSkills({skillPaths})` pointing at
  the workspace skills root — NOTHING seeded under `repo/`.
- Turn `finally`: severed-symlink recovery — seeded path no longer a symlink (or memory-named
  files stranded at run-dir/worktree root) → copy back LWW + audit.
- `bakin-threads.json` per-file write queue (belt-and-braces).
- Flip Pi declaration → `isolated`.
- Tests (temp-dir mocked, PI_HOME-before-imports): layered context present in isolated prompt
  BOTH shapes (cwd = run dir; cwd = subdir simulating `repo/` — ancestor walk pin); projected
  skill + capability pack visible; memory write via symlink visible to the memory indexer;
  rename-severed write recovered at settle; ephemeral turn creates no dir.
- ✓ Verify: conformance Pi leg (now `isolated`) + full suite.
- **Checkpoint 3:** Pi passes isolation conformance; still zero production behavior change
  (core never sets `runWorkspace` until P4).

### Phase 4 — Core allocation + clamp + assets

**T4.1 `feat(core): run-workspace module (allocation, sidecar, encoding)`**
- New `src/core/run-workspace.ts` (resolution 3): encoding + collision test; `allocate(claim)`
  → mkdir + sidecar `{threadId,taskId,stepId?,agentId,createdAt,status:'running'}` sync block;
  `settle(threadId, outcome)` stamps `settled`+`sizeBytes`; `readSidecar` tolerant (torn ==
  missing).
- Watcher exclusions in the SAME commit: `run-workspaces/` + git plugin `worktreeRoot` (derived
  from its SETTING) in `shouldIgnoreContentWatcherPath` — test-pinned.
- Tests: encoding collisions (crafted ids); sidecar-with-mkdir atomicity; watcher ignore.

**T4.2 `feat(dispatch): post-claim out-of-lock allocation + capability clamp`**
- Fire path (`dispatch-turns.ts:582` region): claim (in lock) → allocate (OUT of lock, team-
  routing pre-pass precedent) → send with `runWorkspace` when isolated. Effective cap =
  `isolated ? maxTurnsPerAgent : 1`; clamp receipt + `dispatch.concurrency_clamped` audit.
- EVERY post-claim failure path removes the dir: prep failure (`dispatch-prepare.ts:164-172`),
  suppressed claim (`:85-88`), state-save failure (`dispatch-single.ts:223-232`,
  `dispatch-cycle.ts:274-286`), task-deleted-mid-allocation, send throw. Settle stamps sidecar
  in the settle branches (`dispatch-turns.ts:621-645` incl. aborted).
- OUTPUT DISCIPLINE names scratch cwd via templated synthetic constant; corrective re-dispatch
  prompt carries prior attempt's run-dir path (`dispatch-prompts.ts:100-152`); byte fixtures
  regenerated ONCE (`tests/fixtures/dispatch-prompts/`).
- Tests: clamp matrix (isolated/serialized × settings 1/2/5); failure-path dir cleanup
  (each path); prompt fixture determinism.

**T4.3 `feat(assets): run-aware identity + staleness gate`**
- `plugins/assets/lib/exec-tools.ts:149-164` + `asset-upsert.ts` (inside `withAssetLock`):
  paths under `run-workspaces/` → read sidecar at run-dir root → dedup key
  `task:<taskId>/<relpath>`; staleness gate — advance `currentVersion` iff origin run's ledger
  row exists AND `running`; missing/superseded/lost/settled/unreadable ⇒ record version, don't
  advance, audit `asset.stale_run_write_suppressed`. Scoped: non-run paths untouched.
- Tests: d1-save + d2-resave → one asset two versions; suppression truth table (each ledger
  state + missing row + ledger-down fail-closed); chat-path save unaffected.
- ✓ Verify: full suite.
- **Checkpoint 4:** defaults still 1/3 — zero parallelism yet. Live on 3737: set
  `maxTurnsPerAgent: 2` MANUALLY, run two tasks on one agent, verify distinct run dirs +
  clean settles + context/skills present (Mark validates); revert setting.

### Phase 5 — GC + doctor (scratch half)

**T5.1 `feat(dispatch): sweep — classifier, retention, size budget, single-flight`**
- In `run-workspace.ts` + watchdog wiring: classifier (live-registry keep → sidecar `settled` →
  outcome window → else grace(2× watchdog interval, mtime) → aborted); success 7d
  (`runDirRetentionDays`), failed flat 30d (constant); task-deletion sweep rides `#604` ordering
  (after settle-or-force-release); single-flight (skip tick if running) + bounded (N dirs/tick);
  lazy `sizeBytes` stamping (bounded/tick); `runDirMaxTotalBytes` oldest-first eviction over
  EVICTABLE classes only — never live/grace dirs; exceeded-after-drain ⇒ finding.
- Settings defaults + zod (`packages/core/src/settings.ts`).
- Tests: classifier matrix (live/settled-outcomes/young-unregistered/aged-unregistered/missing-
  torn); eviction domain; lazy stamp; single-flight; deletion ordering.

**T5.2 `feat(health): dispatch.run-dirs check + sweep-now repair`**
- Owner-registered check (schedule health-checks pattern): aggregate size/count (sidecar sums,
  NEVER a walk — description notes in-flight blindness), ledger-derived force-release count,
  `bakin/run/*` branch advisory; repair action = sweep now; class `cleanup_backlog`.
- Tests: check evidence from fixtures; repair invokes sweep; Unknown on unreadable state.
- ✓ Verify: full suite; `bakin check all` on a dev instance.
- **Checkpoint 5:** allocate/GC lifecycle closed-loop; doctor visibility live.

### Phase 6 — Worktrees (D6 + git half of GC)

**T6.1 `feat(projects): repoPath binding + getRepo hook`**
- Project record field + zod; `projects.getRepo` hook (getBrand mirror); task-level `repoPath`
  override; lazy ancestry resolution at dispatch; validation = git repo inside allowed roots.
- Tests: ancestry + override resolution; invalid/missing repo → typed failure pre-claim shape.

**T6.2 `feat(core): git-worktree module + materialization + settle-death`**
- New `src/core/git-worktree.ts` (resolution 4): global mutex; `add(runDir, repo, branch)` →
  `git worktree add <runDir>/repo -b bakin/run/task-<id>-d<seq>`; remove ALWAYS `--force` +
  prune; ENOTEMPTY/failed ⇒ retry next tick; repo-missing ⇒ plain recursive dir delete.
- Dispatch: bound task materializes post-claim out-of-lock; failure = typed transient (never
  fires without checkout); cwd for bound = `<runDir>/repo`; successful settle removes worktree
  immediately; failed/aborted keep 48h (constant).
- `plugins/git/index.ts`: allowlist default → EMPTY + explicit config (settings schema
  `:621-631` + resolution `:173-185`); reject explicit `branch` under `bakin/run/` (`:31-38`).
- `src/core/team-context-defaults.ts:149`: prepare_worktree instruction conditional on
  not-bound; bound-task prompt states "already isolated; do not call prepare_worktree".
- Tests: mutex serialization (concurrent add+remove same repo); settle removal WITH untracked
  artifacts present (RED with plain remove, GREEN with --force); 48h failed window; allowlist
  empty-default + override rejection; branch-param rejection; prompt conditional.

**T6.3 `fix(workflows): default video workflows pass assetIds`**
- `plugins/workflows/defaults/workflows/video-social-post.yaml:44-48` + `assemble-video.yaml`:
  producing steps save-as-asset, consumers take assetIds (image-workflow pattern).
- ✓ Verify: workflow defaults lint/tests; full suite.
- **Checkpoint 6:** live on 3737 — bound task end-to-end: commits on `bakin/run/…`, no plugin
  double-checkout, worktree gone after settle, branch survives (Mark validates).

### Phase 7 — Surfaces + default flip

**T7.1 `feat(team): status chip from in-flight registry`**
- `plugins/team/lib/agent-status.ts:96-127` (+ consumers `team/index.ts:365`,
  `routes/agents.ts:101`): working-state = registry count; heartbeat demotes to liveness-only.
- Tests: cap-2 scenario — turn A settles, chip still `working` while B runs.

**T7.2 `feat(settings): dispatch caps + run-dir fields in System & Alerts (#447)`**
- `src/components/system-settings.ts`: `maxConcurrentTurns`, `maxTurnsPerAgent`,
  `runDirRetentionDays`, `runDirMaxTotalBytes`; descriptions per #447 acceptance (both-gates +
  clamp naming the active runtime's mode).
- Tests: schema render + `/api/settings` round-trip (no restart).

**T7.3 `feat(runtime): switch refuses under in-flight turns; default maxTurnsPerAgent → 2`**
- `src/core/runtime-switch.ts` (`:214-248` guard region): refuse (report) while registry
  non-empty; switch report lists surviving run dirs. Default flip in
  `packages/core/src/settings.ts:363` + settings-comment rewrite.
- Tests: switch refusal; default pin.
- **Checkpoint 7:** #447 acceptance verified live; cap 2 is the shipped default; Mark runs
  normal workload overnight on 3737 before merge.

### Phase 8 — Docs, follow-ups, rig experiment

**T8.1 `docs(knowledge): same-agent-concurrency doc + sweep`**
- New `.claude/knowledge/same-agent-concurrency.md`; update `dispatch.md`, `pi-adapter.md`,
  `runtime-capabilities.md`, `team-aware-assignment.md`, `doctor-and-health-checks.md`,
  `assets-versioning.md`, `session-forensics.md`, git plugin docs, `workflows-plugin.md`,
  projects docs, CLAUDE.md (two pattern bullets + directory map `run-workspaces/`); README
  checked; spec → FINAL; as-built addendum for any deviations.

**T8.2 Rig experiment + issue filing (no tree changes)**
- Dev rig (isolated mode, Docker OpenClaw): two concurrent `agent` runs, one agent, distinct
  sessions — record queued/parallel/rejected + trajectory interleaving → discovery doc.
- File: 3 OpenClaw upstream issues (per-call cwd, per-run isolation, per-run trajectories) with
  rig observations; 5 follow-up Bakin issues (salvage import, zero-commit branch deletion w/
  sidecar-SHA predicate, router load numbers, context-report bound-repo entry, orphan JSONL).
- ✓ Final: full suite + conformance; Mark live validation; merge on approval.

## Risks & watchpoints

- **SDK behavior pins (P3):** ancestor-walk and `skillsOverride` were verified against the
  installed SDK dist — if either regresses on an SDK bump, the T3.1 pins catch it. If the walk
  does NOT reach the run-dir root in practice, fallback is copying AGENTS.md content (not
  symlink) into the run dir — decided at T3.1, recorded in the as-built addendum.
- **Two turns per agent doubles peak token burn** — budget gate already meters per-turn
  pre-claim; no change needed, but watch spend the first live week.
- **`_embedded-assets-static.ts` is pre-existing modified in the working tree** — never commit
  it (standing rule), same for `generated-version.ts`.
- **Checkpoint 4/6/7 live validations are Mark-gated** — schedule them; the branch holds
  mid-phase states safely (caps default 1 until T7.3).
