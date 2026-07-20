# Spec: Same-Agent Concurrency — Per-Run Workspace Isolation + Worktrees

Status: DRAFT r4 — CONVERGED (round 4 removed mechanisms rather than adding; pending plan
approval). Discovery: `same-agent-concurrency-discovery.md` (§5 first audit, §6 silo audit,
§7 final round). Closes #447 (folded in). Single-user machine; no backwards compat, no shims.

## Objective

Let one agent safely run multiple dispatch turns in parallel. Today `maxTurnsPerAgent: 1` is the
only guard, because both adapters pin one shared workspace directory per agent. This initiative
makes parallelism safe by construction — per-RUN working directories (identity shared read-only,
the universal industry pattern), declared honestly through the capability system, with a
git-worktree layer for repo-bound tasks — then raises the default cap.

## Decision Record (kickoff 2026-07-18/19; ® r2, ®® r3, ®®® r4)

1. Deliverable: this spec + discovery doc; build/test follow plan approval.
2. Workload: general tasks first; worktrees layered for repo work.
3. Ownership: capability-declared. ® Core owns run-dir allocation + GC under
   `~/.bakin/run-workspaces/`; the adapter owns honoring the per-turn cwd and making its own
   context conventions reach it. Dispatch clamps unless the adapter declares isolation.
4. Memory model: snapshot-read at turn start; last-write-wins on shared root files. ®® The write
   path must actually reach the shared root. ®®® Guarded against silent symlink severing (D2).
5. Chat stays ungated — isolation makes chat-vs-dispatch overlap safe by construction.
6. OpenClaw: declares `serialized`; upstream issues + dev-rig experiment. No in-tree work.
7. Team: ®®® status chip derives from the in-flight registry (ground-truth rule); router load
   numbers DEFERRED to a follow-up — routing correctness doesn't depend on them (#189 design).
8. Run-dir GC: ®® worktrees die at settle (®®® `--force`, all paths); failed scratch keeps a
   flat 30d window; time windows are ceilings under a hard size budget; sweep single-flight +
   batched. ®®® Classifier collapsed to registry + grace + settled-outcome (no bootId, no
   force-released stamp — force-release settles the ledger row instead).
9. Defaults: `maxTurnsPerAgent` 1 → 2; #447 settings UI folds in.
10. Prerequisites first: registry re-key + workflow gate fix are live bugs today (D3).
11. Worktrees IN this build, reconciled with the EXISTING git plugin (D6); `allowedRepoRoots`
    honored, ®®® its hardcoded personal-path default fixed to explicit configuration.

## Design

### D1 — Capability: `concurrency` member on `CapabilitySet`

```ts
concurrency: {
  /** 'isolated' — adapter honors MessageArgs.runWorkspace (per-turn cwd); parallel-safe.
   *  'serialized' — cannot isolate runs; per-agent turns held to 1. */
  sameAgentTurns: 'isolated' | 'serialized'
}
```

Required member; every adapter + both mocks declare in the same commit (Pi declares `serialized`
until its D2 commit flips it). Conformance honesty (+ teeth): an `isolated` adapter runs two
CONCURRENT same-agent turns in the two distinct `runWorkspace` dirs handed to it, with
extensions exercised concurrently across different cwds; ephemeral turns never create run dirs.

### D2 — Per-run working directories (core-allocated, adapter-honored)

- **Location:** `~/.bakin/run-workspaces/<agentId>/<encodedRunId>/` (runId == threadId — the
  ledger run id). Encoding is collision-proof: `:` → `-` plus an 8-char hash suffix of the raw
  id. Core allocates at fire time — strictly AFTER the ledger claim (the id doesn't exist
  earlier) and strictly OUTSIDE `withStateLock` (worktree adds are multi-second; team-routing's
  pre-lock pass is the precedent). The `.bakin-run.json` sidecar is written synchronously in the
  same block as `mkdir` — a dir is never handed out without one. Passed as
  `MessageArgs.runWorkspace?: string`, set only for dispatch turns on isolated runtimes.
- **Watcher exclusion (BLOCKER-class):** `run-workspaces/` joins `shouldIgnoreContentWatcherPath`
  in the SAME commit that first allocates a dir, test-pinned (`~/.bakin` is chokidar-watched;
  an unexcluded worktree + `bun install` fd-exhausts/wedges the server — the antfly incident
  pattern). The git plugin's worktree root gets the same exclusion, derived from its SETTING
  (the root is configurable), not the literal default path.
- **Context reaching the isolated cwd — three channels, no symlinks inside repo checkouts**
  (round-4 finding: in-worktree symlinks leak into `git status`/commits/PRs and make plain
  `worktree remove` fail on every bound run):
  1. *AGENTS.md / layered context*: seeded at the RUN-DIR ROOT. The Pi SDK's project-context
     loader walks every ancestor of cwd (verified), so both shapes work — unbound (cwd = run
     dir) reads it directly; bound (cwd = `repo/`) picks it up from the parent, with the repo's
     own AGENTS.md nearest. Test-pinned in both shapes.
  2. *Skills*: injected explicitly through the SDK's skill-path surface
     (`skillsOverride`/`loadSkills({ skillPaths })` — verified available; the adapter already
     constructs the resource loader). No `.pi` symlink in cwd. Note (documented, accepted):
     bound tasks also load the target repo's own `.pi/skills` as project skills — content-only
     injection from repo material. Test-pinned: a projected skill + a capability pack are
     visible in an isolated turn.
  3. *Memory writes*: durable memory files (MEMORY-LOG.md, memory tier files) seeded as
     symlinks at the run-dir root so cwd-relative writes reach the workspace. Symlinks can be
     silently severed by rename-style atomic writes, so settle adds a verification: any seeded
     path that is no longer a symlink (or memory-named files stranded in the run dir/worktree
     root) is copied back to the workspace LWW + audited. Test-pinned: a memory write from an
     isolated turn is visible to the memory indexer; a rename-severed write is recovered at
     settle.
- **Assets: two rules in the save handler** (scoped to paths under `run-workspaces/` only;
  chat/workspace saves untouched):
  1. *Stable identity*: derive `{taskId, runId}` by READING the sidecar at the matched run-dir
     root — never by parsing path segments. Dedup key = `task:<taskId>/<relative-path>`;
     sidecar-derived origin wins for the key, agent-supplied `taskId` stays the linkage field.
     Regression test: save in d1, re-save in d2 → one asset, two versions.
  2. *Staleness gate*: advance `currentVersion` only if the origin run's ledger row exists AND
     is `running`. Missing row (task deleted) ⇒ suppress; superseded/lost/settled ⇒ suppress;
     ledger unreadable ⇒ fail-closed suppress. Every suppression records the version anyway +
     audits `asset.stale_run_write_suppressed`. (Force-released zombies are covered because
     force-release settles the ledger row — D3.)
- Pi: `sessionManagerForThread` sets cwd to `runWorkspace` when present; system-prompt assembly
  still reads the workspace ROOT. Verified non-issues, for the record: project-trust prompts
  can't block per-run cwds; extension trust is user-scope-only, so repo project-scope extensions
  cannot load.

### D3 — Prerequisite hardening (live bugs; lands first)

- **Registry re-key (live at cap 2):** supersede never unregisters/aborts; a refire overwrites
  the marker-keyed entry and the zombie's settle deletes the LIVE turn's entry. Fix: key by
  threadId (marker becomes an indexed field for `abortTurnsForTask`); unregister only your own
  entry; register-over-existing audits as a bug. The watchdog force-release path and its audit
  payload swap to the new key. Supersede aborts the old turn at supersede time — which also
  fixes today's double-dispatch hazard where a superseded zombie's late error re-runs the
  recovery ladder for an already-recovered task. Aborted-but-unsettled entries STILL count
  toward the gate (transient double-count until the zombie settles — self-resolving, and the
  safe choice on serialized runtimes where an open slot would mean shared-workspace overlap).
- **Force-release settles the ledger row** (as `lost`) instead of only dropping the registry
  entry — one mechanism serves the staleness gate, the sweep classifier, and the doctor's
  force-release count (no sidecar stamping needed).
- **Workflow gate reserved-count blindness (live TODAY):** `dispatch-workflow.ts` gates without
  the cycle's reserved counts — steps can breach both caps (2× at cap 1 now; would breach the
  serialized clamp). Fix: thread `{total, forAgent}` into the workflow gate call.
- `bakin-threads.json`: per-file write queue (belt-and-braces — the RMW is synchronous today;
  guards future await-insertion).
- Ephemeral turns: never receive `runWorkspace`; conformance-pinned dirless.

### D4 — Dispatch clamp + gate changes

- Effective per-agent cap = `isolated ? settings.dispatch.maxTurnsPerAgent : 1`; clamp-and-warn
  (receipt + `dispatch.concurrency_clamped` audit), never silent.
- Ordering: claim (in lock) → allocate dir+sidecar, materialize worktree (OUT of lock, global
  git mutex) → fire. EVERY post-claim failure path (prep failure, suppressed claim, state-save
  failure, task-deleted-mid-materialization, send throw) removes the dir / worktree eagerly.
- Prompt: OUTPUT DISCIPLINE names the scratch cwd via a TEMPLATED synthetic constant (the
  `SYNTHETIC_TASK_ID` fixture pattern); byte fixtures regenerated once. Corrective re-dispatch
  prompts carry the prior attempt's retained run-dir path (read-only) — the shared cwd used to
  make prior work re-findable; this replaces it (salvage-import machinery deferred, §Follow-ups).
- Defaults: `maxTurnsPerAgent: 2`, `maxConcurrentTurns: 3` (unchanged global).

### D5 — Run-dir lifecycle & GC (crash-safe, bounded, single-flight)

- **Sidecar:** `{ threadId, taskId, stepId?, agentId, createdAt, status: 'running'|'settled',
  outcome?, settledAt?, sizeBytes? }` — written with `mkdir` (D2), all updates atomic
  tmp+rename. Settle stamps outcome + one-time recursive size.
- **Classifier (one rule, exhaustive):** in live registry → keep; sidecar `settled` → outcome
  window; anything else (running-unregistered, missing/torn sidecar — torn == missing) →
  keep if younger than a grace window (2× watchdog interval, mtime-based), else classify
  aborted → failed window. No bootId: after a restart the registry is empty, so pre-crash
  `running` dirs age past grace into aborted — same terminal state. Never delete young
  sidecar-less dirs (allocation race); never retain them forever (ENOSPC self-amplification).
- **Worktrees die at settle — all paths use `--force`** (seeding-free checkouts still
  accumulate untracked build artifacts, which block plain remove): successful settle removes
  immediately (the branch is the deliverable); failed/aborted keep the worktree 48h; ENOTEMPTY
  or repo-missing ⇒ retry next tick / fall back to plain recursive dir delete, prune
  best-effort.
- **Retention:** success scratch 7d (`runDirRetentionDays`); failed scratch flat 30d (fixed, no
  setting, no per-task keying — post-worktree-death this bounds kilobytes). Task deletion sweeps
  its dirs immediately, ORDERED after settle-or-force-release (#604 grace) — abort doesn't
  guarantee subprocess exit.
- **Size budget:** `runDirMaxTotalBytes` (default a few GB) — oldest-first eviction over
  EVICTABLE classes only (settled/aborted windows); live-registry and within-grace dirs are
  never evicted; budget still exceeded after draining evictables ⇒ doctor `action_required`.
  Aggregate maintained from sidecar `sizeBytes`; the sweep lazy-stamps missing sizes (bounded
  per tick) so crashed/aborted dirs join the aggregate; the doctor NEVER walks the tree at
  check time, and its description notes the aggregate is blind to in-flight growth.
- **Sweep discipline:** single-flight (skip tick if prior sweep still running — the watchdog
  `setInterval` has no overlap guard) and bounded per tick; ALL git mutations (add, remove,
  prune) go through the ONE global git mutex (a per-repo queue is unneeded complexity at 1-3
  bound repos; upgrade only if contention is observed).
- **Branches:** never auto-deleted in v1 (zero-commit deletion deferred, §Follow-ups — it
  requires ref mutation outside `run-workspaces/`, which Boundaries forbids the sweep). Doctor
  advisory counts `bakin/run/*` branches; docs ship a manual cleanup one-liner.
- Doctor `dispatch.run-dirs`: aggregate size/count + ledger-derived force-release count +
  branch advisory; repair = sweep now. Incident class `cleanup_backlog`.

### D6 — Worktree layer for repo-bound tasks (reconciled with the git plugin)

- **The git plugin already ships agent-driven worktrees** (`bakin_exec_git_prepare_worktree`,
  registry, `allowedRepoRoots`, `~/.bakin/git-worktrees/`, branch `bakin/<slug>-<agent>`) and
  layered-context defaults INSTRUCT agents to use it. Resolution: **core worktrees supersede
  the plugin flow for bound tasks** — bound-task prompts say "you are already in an isolated
  worktree; do not call prepare_worktree"; `team-context-defaults.ts` makes the instruction
  conditional; the plugin flow remains for unbound tasks. Verified: `release_worktree` cannot
  touch core worktrees (registry-scoped). The plugin REJECTS explicit `branch` params under
  `bakin/run/` (it currently accepts arbitrary branch names, which would break namespace
  disambiguation).
- **`allowedRepoRoots`:** binding honors it, AND its default changes from the hardcoded
  personal path (`~/go/src/github.com/markhayden`) to EMPTY + explicit configuration (settings
  + onboarding note) — fresh installs currently inherit a stranger's path convention. Same
  phase.
- Binding: projects get optional `repoPath` (validated git repo inside allowed roots); tasks
  inherit via ancestry (`projects.getRepo` hook, brandId precedent); task-level override.
- Materialization: core, post-claim, out-of-lock, via the global git mutex:
  `git worktree add <runDir>/repo -b bakin/run/task-<id>-d<seq>`. Failure = typed transient
  dispatch failure; a bound task never fires without its checkout.
- cwd for bound tasks = the worktree; scratch one level up (D2 seeding sits there).
- Reconciliation: branch stays local; `gh` PR only when the task asks. No auto-merge/auto-PR.
- **Default video workflows updated to pass assetIds between steps** — cross-step absolute-path
  handoff is UNSUPPORTED under isolation and the shipped YAMLs do it today.
- v1 excludes env bootstrap; serialized runtimes run bound tasks without worktrees (documented).

### D7 — Status truth under concurrency

Team status chip derives working-state from the in-flight registry count — at cap 2, turn A's
settle writes `idle` to the single-slot heartbeat while turn B runs. Heartbeat demotes to
liveness-only. (Router load-number prompt signal: deferred, §Follow-ups.)

### D8 — Settings UI (#447 folded in)

`src/components/system-settings.ts` gains `dispatch.maxConcurrentTurns`,
`dispatch.maxTurnsPerAgent`, `dispatch.runDirRetentionDays`, `dispatch.runDirMaxTotalBytes`.
Descriptions: both gates apply together; per-agent clamps to 1 on non-isolated runtimes (names
the active runtime's mode). Round-trips via `/api/settings`, effective without restart. #447
acceptance inherited verbatim.

### D9 — OpenClaw honesty + upstream; runtime switch guard

- Adapter declares `serialized`. Dev-rig experiment observes real gateway behavior for two
  concurrent same-agent runs; findings → discovery + three upstream issues (per-call cwd;
  per-run server isolation; per-run trajectory files).
- Runtime switch refuses (or drains) while the in-flight registry is non-empty; the switch
  report lists surviving run dirs.

## Follow-ups (filed as issues at build end, NOT in this initiative)

1. Salvage asset-import from dead run dirs (corrective-prompt path covers the need; import if
   practice shows agents don't pick prior work up).
2. Zero-commit branch auto-deletion (predicate if ever built: record creation SHA in the
   sidecar at `worktree add`; delete iff `rev-parse` equals it; via the git mutex).
3. Team-router load numbers in the assignment prompt.
4. Context-report labeled entry for bound-repo prompt context.
5. Pi aborted-first-turn orphan JSONL cleanup.
6. Three OpenClaw upstream issues (D9).

## Commit strategy (natural rollback checkpoints)

Feature branch in the MAIN checkout (test-live-before-merge; Mark validates on 3737 first).
Each commit independently green + revertable; re-sliced in r4 so no commit references machinery
a later commit introduces:

1. `fix(dispatch): registry threadId re-key, supersede-abort, force-release settles ledger, workflow gate reserved counts` (D3 live bugs)
2. `feat(core): CapabilitySet.concurrency + MessageArgs.runWorkspace; all adapters + mocks declare; conformance checks` (D1 — Pi still `serialized`)
3. `feat(adapter-pi): honor runWorkspace cwd; context/skills/memory channels; threads.json queue; declare isolated` (D2 adapter side)
4. `feat(dispatch): post-claim out-of-lock allocation + sidecar, watcher exclusions, clamp, assets identity + staleness gate` (D4 + D2 core; defaults still 1; GC arrives next commit — acceptable at cap 1 on 3737)
5. `feat(dispatch): sweep (classifier, retention, size budget, lazy stamp, single-flight), doctor check` (D5 scratch half)
6. `feat(projects,git,dispatch): repo binding + allowlist default fix, worktree materialization + settle-death, plugin reconciliation, video workflow assetIds` (D6 + D5 git half)
7. `feat(team,settings,runtime): registry status chip, settings UI, switch guard; bump maxTurnsPerAgent to 2` (D7/D8/D9 + flip)
8. `docs(knowledge): concurrency knowledge doc + updates; file follow-up issues` (rig experiment rides along)

## Testing strategy

- Unit: registry re-key under supersede-refire interleavings; workflow gate reserved-count
  matrix; clamp matrix (isolated/serialized × 1/2/5); run-dir encoding collisions; sweep
  classifier (live / settled-outcomes / young-unregistered / aged-unregistered / missing-torn
  sidecar); size-budget eviction domain (never live/grace dirs) + lazy stamp; assets identity
  (sidecar-read) + staleness gate incl. missing-row and ledger-unreadable fail-closed;
  force-release-settles-ledger; repoPath allowlist + empty-default; plugin `bakin/run/` branch
  rejection.
- Conformance: concurrent isolated turns in handed dirs; concurrent different-cwd extension
  exercise; ephemeral turns dirless; teeth entries.
- Integration: two tasks/one agent/Pi/cap 2 → concurrent fire, distinct dirs+sessions; layered
  context + skills + capability pack + memory-write-visible in BOTH shapes (unbound + bound);
  rename-severed memory symlink recovered at settle; worktree end-to-end (branch, commits,
  settle `--force` removal succeeds WITH untracked artifacts present, branch survives, no
  plugin double-checkout); watcher fd count stable through worktree + `bun install`;
  dispatch-prompt byte fixtures deterministic.
- All tests follow the mandatory temp-dir mock rules.

## Docs coverage

New `.claude/knowledge/same-agent-concurrency.md`. Update: `dispatch.md`, `pi-adapter.md`,
`runtime-capabilities.md`, `team-aware-assignment.md` (chip source), `doctor-and-health-checks.md`,
`assets-versioning.md` (identity + staleness), `session-forensics.md` (corrective prompt carries
prior run dir), git plugin docs (allowlist default, branch guard, reconciliation),
`workflows-plugin.md` (assetId handoff), projects docs (repoPath), CLAUDE.md (Dispatch +
Runtime Capabilities bullets; directory map gains `run-workspaces/`). README: verify at build
end. Spec → FINAL on merge.

## Boundaries

- **Always:** capability honesty (conformance-proven); clamp-and-warn never silent; branches
  never auto-deleted; identity files stay at workspace root; core never writes inside
  `~/.pi`/`~/.openclaw`; watcher exclusions land with allocation; typed failure kinds; temp-dir
  test isolation.
- **Ask first:** auto-push/auto-PR defaults; hard load filtering; OpenClaw in-tree concurrency;
  env bootstrap for worktrees; any branch deletion; repo-side writes beyond worktree add/remove/
  prune.
- **Never:** parallel spend/stat/routing systems; task content in the ledger; chat cwd out of
  workspace root; sweep touching anything outside `run-workspaces/` (bound repos: worktree
  add/remove/prune only, via the git mutex); doctor walking the run-dir tree at check time;
  symlinks or seeded files inside repo checkouts; mock-free tests touching `~/.bakin`/`~/.pi`.

## Acceptance criteria

1. Pi: two tasks/one agent concurrent, distinct run dirs; layered context + skills + capability
   packs + memory writes verified in both shapes. OpenClaw: clamps to 1 with receipt + audit.
2. Supersede-refire leaves the registry correct (new turn counted/abortable/tapped); zombie
   settle cannot delete the live entry; stale-run and force-released-run asset saves never
   advance currentVersion; missing-row and ledger-down suppress fail-closed.
3. Workflow steps respect both caps under mid-cycle reserved counts (live-bug regression).
4. Repo-bound: commits on `bakin/run/task-<id>-d<seq>`; successful settle removes the worktree
   `--force` with untracked artifacts present; branch survives; no plugin double-checkout;
   allowlist enforced with empty default; nothing seeded inside the checkout.
5. Longevity: watcher fd count stable through worktree + `bun install`; steady-state disk
   bounded by the size budget under an hourly bound-cron simulation; sweep single-flight +
   batched; doctor reads aggregates only; eviction never touches live/grace dirs.
6. Crash matrix: every dir state classified by the collapsed rule; no limbo; task deletion
   ordered after settle/force-release; ENOTEMPTY retries; repo-missing falls back cleanly.
7. Re-dispatched attempts version the same asset; corrective prompts carry the prior run-dir
   path; default video workflows pass assetIds.
8. #447 acceptance + new fields; runtime switch refuses under in-flight turns; Team chip
   matches ground truth at cap 2.
9. Conformance green (mock/Pi/OpenClaw-mock + teeth); full suite green; docs updated;
   follow-ups + upstream issues filed with rig observations.
