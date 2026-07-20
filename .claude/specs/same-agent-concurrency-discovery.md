# Same-Agent Concurrency — Discovery Report

Date: 2026-07-19. Companion spec: `same-agent-concurrency.md`. Origin: #447 kickoff, expanded
into a full concurrency discovery (dispatch internals, both runtime adapters, competitor landscape).

## 1. Current state — what actually prevents same-agent parallelism

**One mechanism, nothing else:** `maxTurnsPerAgent: 1` enforced by `concurrencyGate`
(`src/core/dispatch-turns.ts:461-471`). All three dispatch paths (cycle `dispatch-cycle.ts:211-218`,
single/kick `dispatch-single.ts:171-182`, workflow step `dispatch-workflow.ts:140-143`) consult the
gate before claiming; gate-check + `registerTurn` run inside the shared `withStateLock`, so
check-then-register is atomic. A capped task is skipped with no failure recorded.

- Defaults: `maxConcurrentTurns: 3`, `maxTurnsPerAgent: 1` (`packages/core/src/settings.ts:362-363`).
  The per-agent default carries the comment "until the rig validates provider-gateway per-agent
  concurrency" — a deliberate guard on unvalidated behavior, not a discovered limit.
- In-flight registry (`src/core/dispatch-registry.ts`): keyed by marker (taskId or taskId:stepId);
  per-agent counting is a scan over entries. Advisory only — the ledger run-claim is the real
  double-dispatch lock.
- Thread IDs: `task:<taskId>:d<seq>` per attempt, minted atomically with the ledger run claim.
  Fresh threadId per attempt ⇒ fresh provider session ⇒ conversation state is already isolated
  per task. **Sessions are safe; the filesystem is not.**

**The collision surface: one workspace directory per agent.**
- Pi: cwd is ALWAYS `~/.pi/agent/agents/<id>/workspace` (`packages/adapter-pi/src/sessions.ts:103-116`,
  `home.ts:45-51`).
- OpenClaw: `getWorkspacePath(agentId)` — static per-agent config in `openclaw.json`
  (`packages/adapter-openclaw/src/agent-config.ts:193-208`).

Neither adapter serializes same-agent turns across threads. Pi's `withThreadLock`
(`sessions.ts:118-129`) is per-`(agent, thread)` — independent threads run freely, and two tasks
always have different threads. OpenClaw's adapter has no lock at all; its only cross-turn interlock
is the gateway's ~5-min idempotency dedup on identical prompts.

**What collides if the cap is lifted (no other change):**
1. Shared cwd: file create/edit/delete races, git index corruption, half-written reads.
2. Identity/memory files (SOUL/IDENTITY/AGENTS/TOOLS, memory/*.md): lost updates; Pi re-reads them
   into the system prompt every turn, so turn A's edits mutate turn B's prompt assembly mid-flight.
3. Pi `bakin-threads.json`: unguarded read-modify-write (`sessions.ts:89-100`) — two same-agent
   turns settling near-simultaneously can drop a thread mapping (last-writer-wins on the whole
   file ⇒ silent loss of session continuity). **Real latent bug; becomes live at cap > 1.**
4. Pi ephemeral turns (no threadId — team routing, auto-titles, relays) bypass the thread lock
   entirely (`sessions.ts:123`).
5. Pi abort subtlety: an aborted first turn of a new thread skips `persistThreadMapping` — orphan
   JSONL, next turn starts fresh.

**Chat bypasses the dispatch gate today** — a chat turn and a dispatch turn on one agent can
already overlap in the shared workspace. Chat's own guard is one-in-flight-per-chat (409), not
per-agent.

**Team routing does not load-balance** (#189 by design): existence is the only hard filter;
busyness is a soft prompt hint. Team dispatch can pile tasks on one member, which then serialize
behind the per-agent cap while capable teammates idle.

## 2. OpenClaw gateway verdict — per-run isolation structurally impossible today

The `agent` RPC param block (`packages/adapter-openclaw/src/runtime.ts:1778-1809`) carries no
cwd/workspace/workdir param, and transport headers carry none. Workspace is resolved purely from
static per-agent config (`agents.list[].workspace` in `openclaw.json`). The Imitation Crab mock
(protocol-shaped from real recordings) reads no directory field either.

Additional structural blocker: session forensics assumes **one live run per trajectory file** —
the death-watch captures a byte offset before the turn and scans forward
(`runtime.ts:1811-1815`). Concurrent same-agent runs would interleave events past a shared offset
and corrupt per-attempt post-mortem attribution.

How the real gateway handles two simultaneous runs for one agent (queue? parallel? reject?) is
**unknowable from this repo** — the mock runs them fully parallel but is explicitly
non-authoritative. A dev-rig experiment is the only way to observe it.

**Upstream asks for isolated same-agent concurrency on OpenClaw** (to be filed as issues,
strengthened by rig observations):
1. Per-call working-directory param on the `agent` RPC.
2. Per-run execution isolation server-side (multiple simultaneous live runs per agent without
   cross-contamination).
3. Per-run trajectory files (or run-scoped event tagging) so forensics can demultiplex.

Until then OpenClaw is honestly `serialized` and the capability clamp keeps it at 1.

## 3. Competitor landscape (researched 2026-07-18)

Four dominant industry patterns:

1. **Clone-per-unit compute** (VM/container per task, seeded from snapshot): Devin (fresh VM from
   snapshot per session, 10-concurrent cap, coordinator-Devin partitions work), Jules (VM per task,
   hard tier gates, no queue), Codex cloud (container per task, 12h cache, best-of-N first-class),
   Cursor cloud, Claude Code on the web, OpenHands (Docker per conversation), Sculptor/Container
   Use (containers *instead of* worktrees). Only pattern that also solves env/dependency collisions.
2. **Git worktree per unit on a shared machine**: Claude Code (subagent `isolation: worktree`,
   `--worktree` sessions, auto-worktree background sessions — with hard cwd enforcement added after
   real escape bugs), Cursor in-editor (8 agents/prompt, `/best-of-n`), and the whole fleet-tool
   ecosystem (vibe-kanban, Conductor, claude-squad, uzi, CCManager). Pushes env bootstrap, port
   collisions, and enforcement onto tooling.
3. **Git as the reconciliation layer**: branch-per-task → PR, human or coordinator-agent merges.
   Near-universal. Nobody attempts multi-writer file merging (LangGraph's reducers are the only
   formal in-memory merge contract, and it has no filesystem model at all).
4. **Shared filesystem survives only with explicit partitioning + narrow locks**: Claude Code agent
   teams (file-ownership partitioning + file-locked task claiming), OpenHands
   `tool_concurrency_limit: 1` default with race warnings, CrewAI/AutoGen leave it to the operator.

**Universal invariants relevant to Bakin:**
- Agent *identity* (auth, knowledge, config) is shared **read-only** across concurrent units;
  mutable working state is cloned per run. No product clones identity; no product merges
  multi-writer files.
- Concurrency governance is unit-count/budget-based (session caps, tier gates), not
  filesystem-level.
- Structurally, Bakin already makes the right split: coordination facts in the execution ledger,
  content elsewhere. The missing piece is per-run working state.

## 4. Bugs & gaps inventory (feed into spec phases)

| # | Item | Severity | Where |
|---|------|----------|-------|
| 1 | `bakin-threads.json` RMW race | Prerequisite fix | `adapter-pi/src/sessions.ts:89-100` |
| 2 | Ephemeral turns unlocked | Prerequisite decision | `adapter-pi/src/sessions.ts:123` |
| 3 | No concurrency modeling in `CapabilitySet` | Core design gap | `packages/core/src/adapters/runtime/concepts.ts:537-544` |
| 4 | One workspace dir per agent (both adapters) | Core design gap | Pi `home.ts:45`, OC `agent-config.ts:193` |
| 5 | Chat-vs-dispatch overlap ungated | Resolved by isolation | chat plugin / dispatch gate |
| 6 | Team routing ignores real load | Prompt-signal improvement | `plugins/team/lib/assignment-resolver.ts` |
| 7 | OpenClaw gateway concurrency unvalidated | Rig experiment | dev rig |
| 8 | Dispatch caps not in Settings UI (#447) | Fold in | `src/components/system-settings.ts` |
| 9 | Pi aborted-first-turn orphan session file | Note/fix opportunistically | `adapter-pi/src/messaging.ts:644-647` |

## 5. Scenario audit (2026-07-19, spec r2)

Adversarial pass over spec r1: longevity scenarios on an always-on Mac mini, crash safety,
overcomplication. Five findings changed the spec; three held as designed.

**Changed the spec:**

1. **Run dirs moved out of the agent workspace** (r1: `<workspace>/runs/`; r2:
   `~/.bakin/run-workspaces/<agentId>/<runId>/`). Two independent reasons: (a) core GC sweeping
   inside `~/.pi` violates the adapter boundary (runtime providers own workspace data); (b) the
   in-workspace placement required excluding `runs/` from four surfaces (memory scans, workspace
   carry, workspaceFileStats, agent-sync verify) — all four exclusions vanish when the dirs live
   in Bakin territory. Net simpler. Cost: Pi's AGENTS.md cwd auto-discovery no longer finds the
   workspace root — promoted to an explicit requirement (adapter seeds a symlink; test-pinned).
2. **Unbounded failed-run retention was a machine-killer.** r1 retained failed runs "until task
   deleted" — tasks are rarely deleted, and one misconfigured recurring cron produces up to 5
   failed attempts per fire (retry ladder), each potentially holding a full repo worktree
   (gigabytes). Over months: unbounded disk. r2 bounds it: 30-day failed retention, only the
   LATEST failed attempt per task gets the long window (the ladder salvages at diagnosis time,
   not months later), task deletion sweeps immediately.
3. **Crash safety: sidecar at creation, not settle.** r1 wrote `.bakin-run.json` on settle — a
   server crash mid-turn left unclassifiable limbo dirs. r2 writes `status: 'running'` + bootId
   at allocation; the sweep classifies stale-bootId `running` dirs as aborted.
4. **Assets upsert regression.** `upsertFromSource` dedupes on absolute `source.path`
   (`.claude/knowledge/assets-versioning.md:210-223`). Per-run paths ⇒ every corrective
   re-dispatch mints a NEW asset instead of versioning the previous attempt's. r2 normalizes
   run-workspace paths to a task-stable dedup key before upsert (translateAgentPath-style prefix
   logic). Regression-tested.
5. **Worktree mechanics under abort/concurrency:** aborted turns leave dirty/locked worktrees —
   sweep needs `remove --force` + `prune`; concurrent `git worktree add` on one repo contends on
   `.git` locks — adds serialized per repo; cwd for bound tasks became the worktree itself
   (agent starts where the code is; repo AGENTS.md naturally in scope).

**Held as designed:**

- **Pi SDK extension cache is churn, not leak.** It's keyed by path+cwd but flushed by another
  cwd's turn (`pi-adapter.md:112-116`) — per-run cwds re-instantiate extensions per turn rather
  than accumulating entries in the long-lived server process. Build verifies memory over N runs.
- **LWW memory model** — no scenario produced a failure worse than the documented trade-off;
  memory writes cluster at turn end and per-agent write volume is low.
- **Chat ungated** — with dispatch turns in run dirs, overlap collisions require the chat turn
  and dispatch turn to both write the same absolute workspace path deliberately.
- **Branch accumulation** (never-delete) is refs-only — cheap; surfaced as a doctor advisory
  count rather than any auto-delete. (Partially reversed by §6: zero-commit branches may sweep.)

## 6. Silo audit (2026-07-19, spec r3)

Second adversarial pass: three independent reviewers with zero shared context, lenses =
resource-exhaustion/longevity, integration contracts, races. 26 distinct findings; every one
verified against code with file:line evidence before adoption. All folded into spec r3.

**Blockers (would have broken the machine or the product):**

1. **Watcher ingestion of run dirs** (both the longevity and integration reviewers found it
   independently): `~/.bakin` is chokidar-watched (`src/core/watcher.ts:264`) with an ignore
   list that doesn't know `run-workspaces/` — one worktree + `bun install` = ~150k kqueue fds
   (macOS supervised default: 256) plus the exact event-storm pattern that wedged the server in
   the antfly incident (`watcher.ts:148-154`). The r2 audit traded four adapter-side exclusions
   for one it missed. The git plugin's `~/.bakin/git-worktrees/` has the same latent bug today.
2. **Retention math bounded the wrong axis:** r2 bounded failed-run retention but left
   SUCCESSFUL worktree runs on a 7-day window — an hourly repo-bound cron ≈ 118 GB steady state
   on this repo (15-min cadence ≈ 470 GB; with installed deps ~2 TB), with an ENOSPC cascade
   into bakin.db/usage.db/antfly WAL on the shared volume. Fix: worktrees die at successful
   settle (the branch is the deliverable), failed worktrees keep 48h, plus a global size budget
   with oldest-first eviction.
3. **Registry marker-key corruption at cap 2** (races reviewer): supersede never
   unregisters/aborts; refire overwrites the map entry; the zombie's settle then deletes the
   LIVE turn's entry — uncounted, unabortable, untapped. Latent today (cap 1 blocks refire),
   live the moment cap 2 ships. Fix: threadId keying + supersede-aborts + conditional
   unregister.
4. **Existing git plugin worktree system** (integration reviewer): `bakin_exec_git_prepare_worktree`
   + `allowedRepoRoots` allowlist + `~/.bakin/git-worktrees/` already exist, and the standing
   layered-context defaults INSTRUCT agents to start with prepare_worktree — an unreconciled D6
   yields double checkouts with deliverable commits on the wrong branch, and task-level
   `repoPath` would bypass the operator's repo allowlist. r2 never mentioned the plugin.

**High-value majors:** workflow dispatch gate ignores the cycle's reserved counts (cap bypass
LIVE TODAY at cap 1 — up to 2× both caps; would breach the serialized clamp); Pi's cwd carries
skills discovery (`<cwd>/.pi/skills` — agent packages + capability packs silently vanish) and
memory writes (nothing routes them back to the workspace; the LWW model never engages) — r2
seeded only AGENTS.md, one of three; superseded zombies' asset saves advance `currentVersion`
over the corrective attempt's (staleness gate added); allocation ordering was unsatisfiable as
written (threadId doesn't exist pre-claim; worktree add inside `withStateLock` stalls all
dispatch); sweep states missing/torn-sidecar and force-released were unclassified (limbo
forever); sweep needed single-flight + batching (watchdog `setInterval` has no overlap guard);
doctor sizing must read sidecar aggregates, never walk; heartbeat status chip is single-slot
(turn A's settle shows the agent idle while turn B runs); shipped video workflows hand absolute
cwd paths across steps; runtime switch shuts the adapter down under live turns; salvage-from-run-dir
had no consumer (made real: diagnosis-time asset import); dedup-key derivation moved from path
parsing to sidecar read.

**Corrections to §5 (the silo audit cut both ways):**

- The `bakin-threads.json` "race" is overstated: the read-modify-write is fully synchronous on
  one event loop, so no interleaving exists today. The D3 write queue survives as
  belt-and-braces for future await-insertion, not as a live-bug fix.
- "Branches are refs-only cheap" partially reversed: commit-bearing abandoned branches pin
  packfile objects forever and tens of thousands of refs degrade git operations; r3 lets the
  sweep delete provably-empty branches (tip == fork point) and keeps the rest advisory.

**Held under attack (all three reviewers):** (see end of §6)

## 7. Final round (2026-07-19, spec r4) — convergence

Round 4 = two silos with opposite mandates: attack ONLY r3's new fix machinery; and a
simplification/consistency pass forbidden from bug-hunting. Convergence signal achieved: the
round removed more than it added, and no new failure classes emerged — only mechanics of the
r3 fixes themselves.

**Machinery findings (all verified, several empirically in scratch git repos):**

1. **r3's symlink seeding was itself a blocker.** Seeded symlinks inside a bound worktree show
   as untracked files → committable into the deliverable branch/PR as mode-120000 blobs
   pointing at `~/.pi` paths — and `git worktree remove` WITHOUT `--force` fails on ANY
   untracked file, so r3's "remove at successful settle" failed on every bound run. r4:
   AGENTS.md seeds at the run-dir ROOT (the Pi SDK's project-context loader walks ancestors —
   verified in the SDK dist), skills inject via the SDK's explicit `skillsOverride`/`skillPaths`
   surface (no symlinks in cwd), memory symlinks sit at the run-dir root with a settle-time
   severed-symlink recovery (rename-style writes replace symlinks with regular files), and ALL
   worktree removals use `--force`.
2. **Staleness gate had wrong defaults in unenumerated states:** ledger rows are
   running|settled|superseded|lost; task deletion PURGES rows (missing row fell through), and
   force-release leaves rows `running` forever (zombie saves passed the gate). r4: missing row
   ⇒ suppress; ledger unreadable ⇒ fail-closed; force-release settles the row as `lost` — one
   mechanism also serving the sweep classifier and the doctor count.
3. Supersede-abort's clean `aborted` settle skips diagnosis, so r3's diagnosis-time salvage
   never ran for the runs most likely to hold half-finished work. r4 (merged with the
   simplifier's cut): corrective prompts carry the prior run-dir path; salvage-import deferred.
4. Size-budget eviction could evict a LIVE turn's cwd (precedence unstated) and its aggregate
   was blind to never-settled dirs (sizeBytes stamped only at settle). r4: eviction domain =
   evictable classes only; sweep lazy-stamps missing sizes.
5. `allowedRepoRoots` defaults to a hardcoded personal path (`~/go/src/github.com/markhayden`),
   not empty — fresh installs inherit it silently; and the git plugin accepts arbitrary
   explicit `branch` params, so agents could mint `bakin/run/*` names. r4: empty default +
   explicit config; plugin rejects `bakin/run/` branches. (Verified held: `release_worktree`
   is registry-scoped and cannot touch core worktrees.)
6. Zero-commit branch deletion had no reliable predicate (`--fork-point` decays with reflog
   expiry; `branch -d` semantics depend on the user's current HEAD; refuses while the worktree
   exists — all verified empirically) → deferred, with the sidecar-SHA predicate recorded for
   the follow-up.
7. Watcher mechanics confirmed (prefix entry stops chokidar descent; no other prod chokidar
   instances), but the git plugin's worktree root is settings-configurable — the exclusion must
   derive from the setting.

**Simplifier verdict: r3 was not right-sized.** Cuts adopted in r4, none reopening §5/§6
findings: seven-row sidecar classification collapsed to registry+grace+settled (bootId and
force-released stamping deleted); per-(task,step) failed retention → flat 30d (post-worktree-
death it bounded kilobytes); per-repo git queues → one global mutex (1-3 bound repos exist);
salvage asset-import → prior-run-dir path in the corrective prompt; zero-commit branch deletion
→ advisory + documented one-liner. Deferred as scope creep: router load numbers (routing
correctness never depended on them), context-report bound-repo entry, orphan-JSONL fix. KEPT
deliberately: the size budget — Mark runs quiet sensitivity where `cleanup_backlog` advisories
are calmed, so a hard bound is the only self-protection that works unseen. Six contradictions
fixed (boundaries-vs-branch-deletion, decision-8 wording, phantom `runDirFailedRetentionDays`
setting, size-aggregate self-contradiction, retention-rule drift, runId/threadId naming); the
10-commit plan was provably unbuildable as sliced (commit 5 read sidecars commit 6 introduced;
commit 6 swept worktrees commit 7 created; required capability member couldn't typecheck with
adapters undeclared) → re-sliced to 8.

**Why this counts as convergence:** round 1 found 6 issues, round 2 found 26 (not converging),
round 4 found zero new failure classes — every finding was a mechanic of round 2's own fixes or
excess mass, and the spec SHRANK. Remaining risk lives where only the build can reach it:
SDK-behavior pins (ancestor walk, skillsOverride), the rig experiment, and the conformance
teeth. ledger claim transactionality + seq uniqueness;
cross-path gate atomicity under `withStateLock` at cap 2 (kicks vs cycle); team pre-pass
stickiness outside the lock; single-event-loop atomicity of task-store/audit/heartbeat/usage/SSE
writes; burn buckets/timeline/usage.db under concurrent sessions (all session/marker-keyed);
MessageArgs non-leakage into chat/system sends; session forensics path independence; workspace
carry/agent-sync invisibility of run dirs; assets import/search scoping; Pi extension cache
churn-not-leak (upgraded to a concurrent-verification requirement).
