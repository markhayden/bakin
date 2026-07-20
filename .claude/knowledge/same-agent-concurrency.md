# Same-Agent Concurrency — Per-Run Workspace Isolation + Worktrees

One agent can run multiple dispatch turns in parallel. Spec (FINAL):
`.claude/specs/same-agent-concurrency.md`; audit trail in
`.claude/specs/same-agent-concurrency-discovery.md` (§5-7). Closes #447.

## The capability contract

`CapabilitySet.concurrency.sameAgentTurns: 'isolated' | 'serialized'` (REQUIRED member).
- **Pi: `isolated`** — honors `MessageArgs.runWorkspace` (per-turn cwd).
- **OpenClaw: `serialized`** — the gateway protocol cannot express per-run cwd (discovery §2;
  three upstream asks pending).
- Dev mock: `serialized` (minimal shape); `withMockIsolation()` opts in (drops
  `MOCK_ISOLATION_PROBE` into the handed dir).

`concurrencyGate` (dispatch-turns) clamps the effective per-agent cap to 1 on serialized
runtimes regardless of `settings.dispatch.maxTurnsPerAgent` (default 2), with a once-per-boot
`dispatch.concurrency_clamped` audit — never silent. The mode is process-cached
(`getSameAgentTurnsMode`; fail-safe to serialized, uncached); a runtime switch requires restart
anyway. Conformance: `sameAgentIsolationHonesty` — a declared-isolated adapter must place two
CONCURRENT same-agent turns in the two distinct dirs handed to it (probe-verified; a probeless
isolated declaration FAILS) + teeth.

## Run workspaces (core-owned)

`src/core/run-workspace.ts` is the SOLE owner: `~/.bakin/run-workspaces/<agentId>/<encodedRunId>/`
(encoding = flatten + 8-char hash of the raw threadId — collision-proof). Allocation happens in
`fireDispatchTurn`'s settle chain: strictly post-claim (threadId == ledger runId), strictly after
the fire-time existence check, effectively outside `withStateLock` (the chain runs after the lock
releases). `mkdir` + `.bakin-run.json` sidecar in ONE synchronous block; all sidecar updates
atomic tmp+rename; torn reads == missing. Every settle branch stamps the sidecar
(ok / `aborted: <reason>` / `lost: session-death` / `failed: …`).

**Watcher exclusions (BLOCKER class):** `run-workspaces/` and `git-worktrees/` (plus a
settings-configured custom git worktree root) are ignored by `shouldIgnoreContentWatcherPath` —
one repo worktree is thousands of kqueue fds; a `bun install` inside is ~150k against macOS's
256-fd supervised default (the antfly-incident event-storm class).

## Pi adapter mechanics (the load-bearing simplification)

`runWorkspace` moves ONLY the session's tool-execution cwd (`createAgentSession({cwd})`). The
resource loader (AGENTS.md project context, skills, extensions), settings manager, session store,
and prompt assembly ALL stay pinned to the agent workspace — SDK-verified: context/skills
discovery rides the LOADER's own cwd, not the session cwd. An isolated turn's prompt is
byte-identical to a workspace turn's, with zero context seeding.

What IS seeded (`adapter-pi/src/run-workspace.ts`): workspace-root `*.md` files symlink into the
run dir so cwd-relative reads/writes of the agent's own identity/memory files flow to the real
workspace (LWW, decision 4). Settle-time recovery copies back rename-severed links (temp+mv
replaces a symlink with a regular file). **Git checkouts are NEVER seeded** (`.git` guard) —
symlinks inside a worktree would be committable untracked files. Chat/ephemeral turns never carry
`runWorkspace` (workspace-root cwd, unchanged).

## GC (sweep) + doctor

`sweepRunWorkspaces` rides the watchdog tick (deps injected: registry liveness, task existence).
Collapsed classifier: live registry → keep; sidecar `settled` → outcome window (`ok` =
`runDirRetentionDays`, default 7d; everything else = flat 30d salvage); anything else
(running-unregistered, missing/torn sidecar) → grace (2× watchdog interval, mtime) then ages out
as aborted. Task deletion sweeps immediately, ordered after settle/force-release via the liveness
check. Bounded (≤25 removals, ≤10 lazy size-stamps per tick) + single-flight. Size budget
(`runDirMaxTotalBytes`, default 4 GB): oldest-first eviction over SETTLED dirs only — live and
in-grace dirs are never evicted.

Doctor `dispatch.run-dirs` (class `cleanup_backlog`): evidence is the sidecar-summed aggregate
ONLY — never a tree walk at check time; Unknown before the first sweep; over-budget-after-drain
escalates `action_required`; sweep-now repair runs the same engine.

## Worktrees for repo-bound tasks

Binding mirrors brandId: task-level `repoPath` metadata wins, else `projects.getRepo`
(feature-detected hook — installed projects plugin registers it). Validation is core-owned and
never bypassable (`src/core/repo-binding.ts`): inside the git plugin's `allowedRepoRoots`
(default now EMPTY — explicit operator decision) and a real git repo. A bound task never fires
without its checkout (failure takes the dispatch ladder).

`src/core/git-worktree.ts`: ONE global mutex serializes every git mutation (add/remove/prune).
Materialization in the fire chain: `git worktree add <runDir>/repo -b bakin/run/task-<id>-d<seq>`;
**cwd = the checkout** (scratch one level up). The `bakin/run/` namespace is reserved — the git
PLUGIN rejects explicit branches under it, and its agent-driven flow
(`bakin_exec_git_prepare_worktree`) survives for unbound tasks; the layered-context instruction
is conditional (already-in-a-run-worktree ⇒ never prepare_worktree).

**Worktrees die at successful settle** (`--force` — untracked artifacts block plain remove); the
BRANCH is the deliverable and is never auto-deleted (`countRunBranches` = doctor advisory).
Failed runs keep the checkout 48h (salvage window; sidecar records `repoPath`), scratch 30d.
Repo gone/moved → plain recursive delete; ENOTEMPTY → retry next tick. Serialized runtimes run
bound tasks without worktrees (workspace cwd).

## Assets under concurrency

Run-workspace saves dedup on `run:task:<taskId>/<relpath>` (derived by READING the sidecar,
never path parsing) so corrective attempts version ONE asset. Staleness gate: origin run not
`running` in the ledger (superseded/lost/settled/purged/unreadable — fail-closed) ⇒ version
recorded WITHOUT advancing `currentVersion` + `asset.stale_run_write_suppressed` audit. Ledger
verb: `getRunStatus(runId)`. Force-release settles the run row as `lost` (watchdog) — one
mechanism serving the gate, the sweep, and the doctor count.

## Registry + status truth

The in-flight registry is keyed by **threadId** (marker is a lookup field): supersede-refire
under one marker holds two independent entries and a zombie settle can only release itself.
Supersede aborts the old turn at supersede time. Aborted-but-unsettled entries still count
toward the gate (documented transient). The Team status chip reads the registry FIRST (heartbeat
is single-slot and lies at cap 2), heartbeat demotes to liveness. `switchRuntime` refuses (except
dry-run) while turns are in flight.

## Follow-ups (filed at close-out)

Salvage asset-import from dead run dirs; zero-commit branch auto-deletion (sidecar-SHA
predicate); team-router load numbers; context-report bound-repo entry; Pi orphan-JSONL cleanup;
projects-plugin (bits) `projects.getRepo` registration; 3 upstream OpenClaw issues (per-call
cwd, per-run isolation, per-run trajectories) with rig observations.
