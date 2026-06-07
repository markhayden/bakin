# SPEC: Execution Safety — Exactly-Once Task Firing, Completion, and Audit

**Status:** Draft for approval (rev 2 — storage seam, migration, edge cases, user stories, issue fold-ins)
**Driver:** Production double-executions — (1) morning release-notes cron job double-posted, (2) image-creation task double-billed. Double-firing on anything externally visible or money-costing is non-negotiable.
**Informed by:** Deep code exploration (4 parallel audits) + competitive research of `paperclipai/paperclip` (Postgres-backed exactly-once design; patterns ported, mechanism adapted to Bakin).

---

## 1. Objective

Make duplicate task execution **physically impossible**, not procedurally unlikely. Every guarantee anchors in a SQLite store with UNIQUE constraints — the self-hosted analog of paperclip's partial unique indexes. A second fire/completion/claim doesn't race a flag; it fails an INSERT, is suppressed, and is loudly audited.

**Target user:** Mark, single-user instance on a Mac mini — but released via homebrew tap, so migration must be automatic and zero-action. No backwards-compat shims. Tech-debt reduction is a priority — legacy coordination state (`.dispatch-state.json` dispatched-list/seq, schedule sidecar `processedRuns`) is *replaced*, not wrapped.

### Root causes being fixed (verified, file:line)

| # | Race | Location | Symptom it explains |
|---|------|----------|---------------------|
| 1 | Schedule TOCTOU: dedup check → slow `createTaskWithEffects()` (50–500ms) → `recordProcessedRun()` persisted **after** task creation; `reconcileRunning` is an in-memory flag | `plugins/schedule/index.ts:616-754, 773-808` | Release-notes double-post |
| 2 | No completion idempotency: `reportComplete()` double-fires orchestrator notify + continuation hooks; image idempotency cache is in-memory, 5-min TTL | `src/core/task-service.ts:342-377`, `plugins/images/lib/idempotency.ts` | Image double-bill |
| 3 | Watchdog recovers tasks whose agent is alive-but-quiet (60s `updatedAt` guard only) → overlapping runs | `src/core/watchdog.ts:30-35,181` | Double-bill amplifier |
| 4 | No inter-process exclusion: two server processes mint identical dispatch seqs; all mutexes are in-memory promise chains; orphaned half-dead generations observed in the wild (#459) | `src/core/dispatch.ts:429-435`, `server.ts:733` | Any duplicate under restart/HMR/dual-start |

---

## 2. User Stories

The build is done when every one of these is true and test-proven:

1. **Morning cron, once, always.** My 7am release-notes job posts exactly once — even if the server restarts, hot-reloads, or the reconciler overlaps the bridge webhook mid-window. The audit log shows one `schedule` fire for that runId, ever.
2. **Retries are free.** An agent generating an image hits a timeout and retries the call. I'm billed once. The dashboard shows one asset, one version — no matter how much later the retry lands (no 5-minute window).
3. **Recovery never double-posts.** The watchdog re-dispatches a task it thinks is dead; the original agent was actually alive and finishes. Exactly one deliverable goes out, one completion notification fires, and I can see `task.run_superseded` + `task.completion_suppressed` in the activity feed telling me the system caught it.
4. **Outages fail visibly, not weirdly.** The internet drops mid-run. The task settles with a clear failure reason and shows up recoverable on the board — and when it re-dispatches later, side effects that already happened (saved assets, billed images) are not repeated.
5. **Double-click is harmless.** I click "Complete" twice in the UI (or an agent's MCP retry re-sends it). One completion, one orchestrator notification; the second attempt tells me "already complete" instead of erroring or re-firing hooks.
6. **Deliberate repeats still work.** When I *intentionally* create the same image task twice, both bill (idempotency is task-scoped — my intent is respected). When I hit "Run now" on a schedule that already fired today, it runs (manual fires mint their own runId).
7. **Two servers can't happen.** I fat-finger `bakin start` while the server is running (or launchd respawns over a wedged process). The second process refuses with a clear message naming the live pid — no phantom UI, no duplicate dispatch loops, and a failed port-bind shuts down cleanly instead of orphaning children (#459).
8. **My edits don't vanish.** I edit a task description while its agent is finishing. Either my edit lands or I get a clear conflict telling me to refetch — never silent loss. A done task refuses edits until I explicitly reopen it (audited).
9. **I can prove it.** When I ask "did this fire twice?", `audit.jsonl` answers definitively: exactly one `task.completed` per task lifetime, and a suppression event for every duplicate the guards caught — with origin, runId, and timestamps.
10. **The system tells me when it saved me.** Doctor's `execution-safety` check is green when nothing was suppressed in 24h, and warns with counts when the guards fired — so a new upstream race announces itself instead of hiding behind working guards.

---

## 3. Interview Decisions (locked)

1. **Backbone:** SQLite via `bun:sqlite` (zero new deps), WAL mode. **Coordination facts only** — claims, runs, cron fires, completions, idempotency keys. Never content, never searchable text. No overlap with Antfly (external optional search process — no ACID, HTTP round-trips, optional; disqualified for coordination).
2. **Storage seam (rev 2):** No provider-style storage adapter — that's speculative generality (runtime/search adapters exist because providers actually swap). Instead: `packages/core/src/storage/db.ts` is the **only** file that imports `bun:sqlite` (connection, WAL, busy_timeout, migrations runner, HMR-safe globalThis singleton, ~100 lines). Domain modules own their tables and expose **domain verbs only** (`claimCronFire`, `recordCompletion`, `claimRun`, …) — no SQL or sqlite types cross the module boundary. Enforced by an architecture test (`bun:sqlite` import allowlist). Future non-file storage → new domain module on the same `db.ts`; future engine swap → rewrite two files, callers untouched.
3. **Scope:** All 4 safety layers in this build. Parity features → GitHub issues (§10). Fold-ins from the existing tracker: **#459's server-side defects** (EADDRINUSE error listener + graceful shutdown on bind failure — same code site as the singleton lock); **#436 items 4 & 6** are structurally resolved by run claims + the singleton (comment on issue, don't duplicate).
4. **Duplicate handling:** Suppress side effects + structured audit event + SSE + doctor `execution-safety` health check. Suppressions are never silent. Duplicate completion via MCP returns `ok: true, alreadyComplete: true` (agent retries of a timed-out success must not error).
5. **Edit safety:** Optimistic versioning (`version` int on task, `expectedVersion` → 409 on stale) + freeze-on-complete (reopen is explicit + audited) + every 409 audited. **No edit leases** (availability failure modes; paperclip doesn't use them either).
6. **Stale runs:** First-completion-wins; loser suppressed by the completions table. Durable idempotency keys (content-signature, **no TTL**) protect money ops across overlapping runs. Watchdog liveness upgrades to ledger run heartbeats. **No hard fencing** of superseded runs.
7. **Failure bias:** Cron claim **before** task creation — *rarely miss, never duplicate* — with a healing reconciler (claims that stay task-less > N minutes get their task created under the same claim).
8. **Prod debugging:** Non-blocking; optional 3-check forensics list (§9).

---

## 4. Design

### 4.1 Storage core + execution ledger

**Modules:**
- `packages/core/src/storage/db.ts` — shared SQLite core (see Decision 2). DB at `~/.bakin/bakin.db`, path via `getBakinPaths()` → existing test mocks of the content-dir resolvers isolate it for free.
- `packages/core/src/execution/ledger.ts` — first domain module; owns the four tables below; exposes domain verbs.
- `src/core/execution-ledger.ts` — app facade (content-dir pattern).

```sql
-- One live run per task, ever. The INSERT is the lock.
CREATE TABLE runs (
  run_id        TEXT PRIMARY KEY,        -- task:<id>:d<seq> (existing threadId shape)
  task_id       TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  agent         TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running','settled','superseded','lost')),
  boot_id       TEXT NOT NULL,           -- server boot generation (startup sweep)
  started_at    INTEGER NOT NULL,
  heartbeat_at  INTEGER NOT NULL,
  settled_at    INTEGER,
  settle_reason TEXT,
  UNIQUE (task_id, seq)
);
CREATE UNIQUE INDEX runs_one_live_per_task ON runs(task_id) WHERE status = 'running';

-- A cron run fires exactly once. Claim BEFORE task creation.
CREATE TABLE cron_fires (
  job_id   TEXT NOT NULL,
  run_id   TEXT NOT NULL,                -- runtime cron run id; manual fires mint manual-<uuid>
  fired_at INTEGER NOT NULL,
  task_id  TEXT,                         -- set after task creation; NULL = heal candidate
  PRIMARY KEY (job_id, run_id)
);

-- A task completes exactly once (per open lifetime). First write wins.
CREATE TABLE completions (
  task_id      TEXT PRIMARY KEY,
  run_id       TEXT,
  agent        TEXT NOT NULL,
  channel      TEXT,
  completed_at INTEGER NOT NULL
);

-- Durable idempotency (replaces the 5-min in-memory image cache).
CREATE TABLE idempotency (
  key         TEXT PRIMARY KEY,          -- e.g. existing image 9-tuple SHA256 signature (taskId-scoped)
  kind        TEXT NOT NULL,             -- 'image.generate' | 'image.edit' | ...
  result_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
```

**Fail-closed:** if the DB is unreachable (corruption, disk full), dispatch, cron firing, and completion **refuse to proceed** — never fall back to the unguarded path. Doctor errors loudly; the dashboard shows the failure. A safety system that fails open isn't one.

**Startup sweep:** on boot, all rows left `'running'` by a previous `boot_id` are marked `'lost'` *before* restart recovery runs — a crashed process must never leave a claim that blocks legitimate re-dispatch.

Ownership rule: the ledger answers "may this happen / did this happen"; markdown/JSON owns *what the task is*; Antfly owns search. No cross-references.

### 4.2 Layer 1 — Cron fire dedup (fixes release-notes double-post)

`plugins/schedule/index.ts` `processScheduledRun()` becomes claim-first:

1. `INSERT INTO cron_fires (job_id, run_id, fired_at)` — conflict → **suppressed**, audit `schedule.fire_suppressed {jobId, runId, existingTaskId, origin}`, return.
2. Create the task (`createTaskWithEffects`).
3. `UPDATE cron_fires SET task_id = ?`.

Sidecar `processedRuns` + `hasProcessedRun`/`recordProcessedRun` are **deleted** (`plugins/schedule/lib/sidecar.ts:72-80`). Manual "Run now" mints `manual-<uuid>` runIds — intentional re-runs are never blocked. **Healing reconciler:** claims with `task_id IS NULL AND fired_at < now - HEAL_AFTER_MS` get their task created under the same claim (audit `schedule.fire_healed`). `reconcileRunning` stays as a cheap short-circuit but is no longer load-bearing.

### 4.3 Layer 2 — Completion first-write-wins (fixes double side effects)

`src/core/task-service.ts`:

- `reportComplete()` and `moveTaskWithEffects(→done)` route through one gate: `INSERT INTO completions`. Conflict → **all side effects skipped** (no orchestrator notify, no `tasks.statusChanged` hooks, no continuation), audit `task.completion_suppressed`. Callers get `ok: true, alreadyComplete: true`.
- Success path emits a first-class `task.completed` audit event (missing today — only `task.moved` exists).
- **Reopen:** explicit `done → todo/inProgress` move deletes the completions row in the same transaction, audits `task.reopened`. Only this path unfreezes.
- **Images:** keep the existing 9-tuple signature; persist completed results to `idempotency` (durable, no TTL) instead of the in-memory TTL map. In-flight same-process dedup map stays. Cache hit returns the prior asset — $0.

### 4.4 Layer 3 — Execution claims (fixes overlap)

`src/core/dispatch.ts`:

- Before sending a turn: `INSERT INTO runs (status='running')`. Partial unique index rejects a second live run per task → suppressed + audit `task.dispatch_suppressed`. Replaces the `dispatched` array + `dispatchedSet` as the correctness mechanism (in-flight registry stays for caps/bookkeeping — its documented advisory role).
- `seq` minting moves to the ledger (transactional `MAX(seq)+1` per task). `.dispatch-state.json` loses its correctness duties (delete vs. retain for bookkeeping: decided in plan).
- Turn settle (success/failure/forensics diagnosis) → `'settled'` + reason; adapter-detected session death → `'lost'`. `bakin_log_progress` + adapter turn activity bump `heartbeat_at`.
- Trashing a task settles its live claim; purging a task cascades its ledger rows.

`src/core/watchdog.ts`:

- **Supersede-first recovery:** transactional `UPDATE runs SET status='superseded' WHERE task_id=? AND status='running' AND heartbeat_at < now - staleness`. Zero rows → another actor won or run is fresh → skip. Only after supersede may it move the task back to todo (audit `task.run_superseded`).
- Liveness input becomes `heartbeat_at`, not file `updatedAt` — fewer false supersedes. (Closes #436 item 4 structurally.)
- Overlap endgame: both runs may finish; completions picks the first; durable idempotency makes the loser's identical money-ops free. Non-identical drift can still double — rare, and now visible in audit.

### 4.5 Layer 4 — Server singleton + clean bind failure

`server.ts`:

- Acquire `~/.bakin/server.lock` (pid, port, started_at) before side effects. Live pid holding it → refuse with a clear message naming the pid. Stale (dead pid) → replace. Released on clean shutdown. (Closes #436 item 6 structurally.)
- **#459 fold-in:** attach `server.on('error')` — on `EADDRINUSE`, log the port + `lsof` remediation, run the graceful-shutdown path (so the antfly child is stopped, not orphaned), exit non-zero. Pre-flight the bind early in `main()` so failure happens before the watcher/dispatch/antfly side effects start.

### 4.6 Edit safety

- `version` int on task JSON, bumped on every task-store write (absent = 0, lazy-stamped).
- Mutating REST/MCP task endpoints accept optional `expectedVersion`; stale → 409 + audit `task.edit_conflict`.
- Freeze-on-complete: mutation of a task with a completions row → 409 `task is completed; reopen first` (move/reopen paths exempt). UI adoption of `expectedVersion` ticketed, not in scope.

### 4.7 Observability

- New audit events: `task.completed`, `task.completion_suppressed`, `task.dispatch_suppressed`, `task.run_superseded`, `task.reopened`, `task.edit_conflict`, `schedule.fire_suppressed`, `schedule.fire_healed`. All via existing `appendAudit()` → audit.jsonl + SSE + Antfly.
- Doctor `execution-safety` check (health plugin, plugin-owned pattern): warns on suppression/supersede counts > 0 in 24h (computed from audit, **not** a new stat recorder — usage-recording rule); errors on ledger integrity failure or fail-closed events.

---

## 5. Migration (automatic, zero-action, first boot)

1. `bakin.db` created via migrations runner on first open.
2. **Seed `cron_fires`** from every job sidecar's `processedRuns` — prevents refiring history. Then the old fields/helpers are deleted.
3. **Seed `runs` seq watermarks** from `.dispatch-state.json` per-task seqs — threadIds (`task:<id>:d<seq>`) must never collide with previously-used provider sessions.
4. Tasks without `version` → treated as 0, stamped on next write. No file rewrite pass.
5. In-progress tasks at upgrade: no live claims exist; startup sweep is a no-op for a fresh DB; restart recovery proceeds as today and the first re-dispatch claims normally.
6. **Rollback:** the DB is additive — old binaries ignore it. Rolling back after sidecar `processedRuns` removal loses cron dedup state (old behavior returns). Accepted; documented in the release notes.

## 6. Edge Cases (explicit)

| Case | Behavior |
|---|---|
| Ledger unreachable (disk full, corruption) | **Fail closed**: no dispatch, no cron fire, no completion side effects. Doctor errors. |
| Crash with claims held | Startup sweep marks prior-boot `'running'` rows `'lost'` before recovery. |
| Internet/provider outage mid-run | Turn fails typed → claim settles with reason → task visibly recoverable; durable idempotency prevents repeat side effects on re-dispatch. |
| Deliberate duplicate work | Idempotency keys are taskId-scoped; new task = new bill (intent respected). Manual schedule fires mint unique runIds. |
| Task trashed mid-run | Live claim settled (`settle_reason: 'trashed'`); purge cascades ledger rows. |
| Reopen → complete again | Legitimate: reopen deletes the completions row (audited); next completion is a fresh first-write. |
| Backup/restore drift (db older than task files) | Healing reconciler + doctor tolerate: task-less claims heal; a restored-away completion row just means the task can complete again (audited). No hard invariant between db and files. |
| Workflow tasks | `reportComplete` already rejects them; gate flows hit the same single completion chokepoint in `moveTaskWithEffects`. |
| Bun HMR / dev reload | db connection + singletons behind `globalThis` (same reason as `__bakinBroadcast`). |
| Clock changes | Timestamps are informational; no uniqueness or correctness decision is time-based. |

## 7. Commands

| Action | Command |
|---|---|
| Full test suite | `bun run test` |
| Single file | `bun test tests/path/foo.test.ts --isolate` |
| Dev loop | `bun run dev` (server-side changes need manual restart) |
| Mock runtime | `bun run dev:mock` |
| Build binary | `bun run build` (never `git add -A` after — generated version stamp) |

## 8. Project Structure / Code Style / Testing

### Structure (new/changed)
```
packages/core/src/storage/db.ts              NEW — sole bun:sqlite importer; WAL, migrations, HMR singleton
packages/core/src/execution/ledger.ts        NEW — runs/cron_fires/completions/idempotency; domain verbs
src/core/execution-ledger.ts                 NEW — app facade (content-dir pattern)
src/core/dispatch.ts                         CHANGED — claim-before-send, ledger seq, settle/supersede
src/core/watchdog.ts                         CHANGED — supersede-first, heartbeat liveness
src/core/task-service.ts                     CHANGED — completion gate, reopen, audit events
src/core/task-store.ts (+packages/core)      CHANGED — version counter
server.ts                                    CHANGED — singleton lock, EADDRINUSE handling (#459)
plugins/schedule/index.ts                    CHANGED — claim-before-create, healing
plugins/schedule/lib/sidecar.ts              CHANGED — processedRuns removed
plugins/images/lib/idempotency.ts            CHANGED — durable completed-cache via ledger
plugins/tasks/index.ts                       CHANGED — alreadyComplete, expectedVersion, freeze
plugins/health/lib/system-checks/            NEW — execution-safety check
tests/architecture/sqlite-boundary.test.ts   NEW — bun:sqlite import allowlist
.claude/knowledge/execution-ledger.md        NEW — deep reference
.claude/knowledge/{dispatch,session-forensics}.md  UPDATED
CLAUDE.md                                    UPDATED — Key Patterns entry; testing note
```

### Style
Repo conventions unchanged: TS strict, Zod at boundaries, `createLogger('execution-ledger')`, no empty catches, `const` over `let`, kebab-case files, conventional commits with scope.

### Testing
Standard rules mandatory (mock BOTH content-dir resolvers + OpenClaw home; temp dirs; cleanup; `--isolate`). DB path derives from `getBakinPaths()` → existing mocks isolate it; assert with an architecture test. Race tests (Prove-It — each reproduces today's bug first):

1. **Cron double-fire:** two concurrent `processScheduledRun()` for one runId → one task; second suppressed + audited. Crash-window variant: claim without task → healed to exactly one.
2. **Double completion:** concurrent + sequential `reportComplete()` ×2 → one notify, one continuation, one `task.completed`, one suppression; caller gets `alreadyComplete`.
3. **Dispatch overlap:** live claim → second cycle + manual kick suppressed; settle → re-dispatch with incremented seq.
4. **Watchdog supersede:** fresh heartbeat → no recovery; stale → supersede-then-recover; two racing supersedes → one winner.
5. **Late zombie completion:** superseded run completes first → wins; redispatched run suppressed; identical image signature → single bill across simulated restart.
6. **Versioning:** stale `expectedVersion` → 409 + audit; freeze-on-complete → 409; reopen unfreezes.
7. **Singleton:** live pid → refuse; stale pid → acquire. EADDRINUSE → graceful shutdown path runs.
8. **Migration:** sidecar `processedRuns` → `cron_fires` seeded once; seq watermarks honored (no threadId reuse).
9. **Fail-closed:** unreachable DB → dispatch/cron/completion refuse; doctor errors.
10. **Startup sweep:** prior-boot running rows → lost; current-boot rows untouched.

## 9. Optional Prod Forensics (non-blocking, read-only)

1. Release-notes incident: **two task records** (schedule race) or **one task completed twice** (completion race)? Grep task ids in `~/.bakin/tasks/` + `audit.jsonl` around the incident.
2. `ps aux | grep -i bakin` — more than one server process? (Cross-check #459 symptoms.)
3. `~/.bakin/logs/server.log` — restarts/crashes within ±5 min of either incident?

## 10. Roadmap Tickets (filed after spec approval)

1. **feat(schedule): per-job concurrencyPolicy + catchUpPolicy** — `skip_if_active | coalesce_if_active | always_enqueue`; `skip_missed | enqueue_missed_with_cap`. Builds on `cron_fires`.
2. **feat(core): run liveness classification** — productive vs planning-only vs blocked, from evidence Bakin already has; reduces false supersedes.
3. **feat(tasks): durable run history UI** — per-task run timeline (attempts, seq, settle reasons, suppressions) from the runs table.
4. **feat(core): cost/budget gating in dispatch** — per-run cost attribution; budget policy blocks dispatch when exceeded.

Plus tracker hygiene on merge: comment on #436 (items 4+6 resolved structurally), update #459 (server-side half shipped; dev.ts half remains).

## 11. Boundaries

**Always:**
- Ledger = coordination facts only; content in markdown/JSON; search in Antfly.
- Claim before side effect, in every path. Fail closed when the ledger is unavailable.
- Suppress-and-audit on duplicates; suppressions surface in doctor.
- Update `.claude/knowledge/` + CLAUDE.md alongside code (commit-level requirement in the plan).

**Ask first:**
- Any change to adapter-owned surfaces (runtime cron, channels, memory) — adapter boundary is architecture-test enforced.
- Deleting `.dispatch-state.json` entirely vs. retaining for non-correctness bookkeeping.

**Never:**
- Error an agent's retry of an already-succeeded completion (must return `alreadyComplete`).
- Block intentional duplicates (manual re-runs, deliberate same-work tasks).
- Add a parallel stat-tracking system — suppression counts come from audit.
- Import `bun:sqlite` outside `storage/db.ts` + `execution/ledger.ts` (architecture-test enforced).
- Backwards-compat shims. The one-time seeds (§5) are correctness migrations; old paths deleted after.
- Let any test touch `~/.bakin/` or `~/.openclaw/`.

## 12. Process

This spec (approve) → `/agent-skills:plan` (task breakdown + **detailed commit strategy** with rollback checkpoints, copied to `tasks/plan.md` + `tasks/todo.md`) → `/agent-skills:build` → `/agent-skills:test`. Branch: `feat/execution-safety-ledger`, PR to `main`. SPEC.md relocates to `.claude/specs/` in the final docs commit.
