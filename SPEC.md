# SPEC — Bakin-Owned Scheduler (kill the cron double-fire)

> Status: draft for approval · Owner: Mark · Date: 2026-06-07
> Skill flow: spec → plan → build → test. This is the spec.

## 1. Objective

### The problem (verified, source-grounded)

A single Bakin schedule fires **twice** every time, because scheduling is delegated to OpenClaw cron and that delegation produces two independent executions from one cron fire:

1. **Rogue fire (invisible to Bakin).** Bakin creates the OpenClaw cron job with `command: "bakin:schedule:<name>"` (`plugins/schedule/index.ts:957`), and the adapter forces the payload to `{ kind: 'agentTurn', message: command }` for `bakinSchedule` jobs (`packages/adapter-openclaw/src/runtime.ts:2063-2064`). At fire time OpenClaw's own runner *delivers that string to the agent as a real turn*. The job is armed with the agent's **full default toolset** because the adapter passes `--clear-tools` (→ `toolsAllow = null` → all tools; `runtime.ts:1988-1998`, mock `dev/imitation-crab/cli-shim.ts:157-158`) and `--no-deliver` does **not** disable the message tool (`/tmp/openclaw-src/.../run.ts:319-327`: under delivery mode `none`, `messageToolEnabled: true`). So the agent improvises on the cryptic string and posts to the channel (~09:01). Bakin never created a task or claimed a ledger fire → **the UI cannot see this execution.**
2. **Real Bakin task.** `reconcileScheduleRuns` polls `cron.listRuns()` every 60s (`index.ts:809`, `:909`), sees OpenClaw recorded a succeeded run, claims the fire in the ledger, and creates the real board task (~09:03). It dispatches, the agent runs *again*, finds the work already posted, and spends the run repairing/deleting duplicates (`task.completion_suppressed`).

This is **systemic to every Bakin schedule**, not one job. OpenClaw cron is agent-execution-first: there is **no webhook fire** (`--webhook` only POSTs the finished payload *after* the agent runs) and **no no-op fire** — every cron fire runs a tool-capable isolated LLM turn.

### The decision

**Bakin owns scheduling for Bakin schedules.** Bakin evaluates cron expressions itself, fires on time straight into the existing ledger + task path, and **never creates an OpenClaw cron job for a Bakin schedule**. OpenClaw's *own* native crons (agent/user-created) are surfaced **read-only** in the UI. This eliminates the double-fire *structurally* (one fire path), makes every fire a native, observable Bakin event, and deletes ~500 lines of cross-process wrangling.

Rationale: it is the only option where "visibility when things go wrong" is a property of the design rather than a bolt-on; it matches the project priorities (reduce tech debt, single user, no backwards-compat/shims, keep clean). It is roughly LOC-neutral — the payoff is **complexity, correctness, and observability**, not line count.

### Goals
- A Bakin schedule fires **exactly once** per occurrence; no rogue/duplicate executions; no duplicate channel posts.
- Bakin is the source of truth for Bakin schedules (cron expr, tz, enabled, prompt, owner…).
- Missed fires during downtime are handled with a **user-controllable safety window** (below), never silently dropped.
- Native OpenClaw crons are visible read-only ("show both").
- Failures — including channel-delivery failures — are visible to the user.
- Net reduction in moving parts: delete the reconcile-poll, the bridge webhook, the legacy-wake repair, and the adapter's Bakin-cron payload code.

### Non-goals
- No cross-system "cron backend" adapter (speculative; re-adds the indirection we are removing). The engine is kept modular internally instead (see §4).
- No change to OpenClaw source.
- No change to how *native* OpenClaw crons execute — they are surfaced read-only only.
- Not replacing the execution ledger, dispatch loop, or task board — we reuse them.

### Acceptance criteria
1. Creating a Bakin schedule creates **no** OpenClaw cron job; `~/.openclaw/cron/jobs.json` gains no `bakin:schedule:*` entry.
2. A schedule due at minute *M* produces exactly one `cron_fires` claim (runId deterministic per occurrence) and exactly one task; re-evaluation of the same minute is a no-op (ledger PK dedup).
3. Pause / skip-next-N / overlap-guard / failure-auto-pause behave exactly as today (carried over unchanged from `runClaimedFire`).
4. After Bakin is down across a fire time: on boot, the most recent missed occurrence within the safety window fires into **todo**; if older than the window it is created in **blocked** with reason `missed-window`; occurrences older than the most recent are coalesced (one task max per job). Window is editable in the schedule UI (default 1h).
5. The schedule UI shows two groups: **Bakin schedules** (owned/editable) and **Runtime cron** (OpenClaw-native, read-only). Each Bakin schedule shows a computed **next-run** time. The schedule UI exposes the catch-up window and tick interval as editable settings, applied without a server restart.
6. A doctor/health check reports any Bakin schedule still backed by a lingering OpenClaw cron job (incomplete cutover / rogue-fire risk).
7. A channel-delivery failure (e.g. Discord "Invalid Form Body") surfaces in the activity/audit feed and on the originating task.
8. Creating/editing a schedule prompt that risks the channel transport danger zone (e.g. "do not split" with a high char cap) surfaces a warning.
9. Cutover migrates existing Bakin schedules: cron expr/tz copied from the OpenClaw job into the sidecar, then the OpenClaw cron job is deleted. Idempotent.
10. Dead code removed: reconcile-poll, bridge webhook + secret, legacy-wake repair + its health check, `seedCronFireLedgerFromSidecar`, adapter Bakin-cron payload/create/update code. Full suite green.

## 2. Commands

No new top-level binary commands. Existing surfaces, adjusted:

- **Schedule REST** (`/api/plugins/schedule/*`) — `POST /` (create), `PUT /:jobId`, `GET /`, `GET /:jobId`, pause/skip/etc. remain; they now write the Bakin schedule store and drive the Bakin scheduler. The **bridge route is removed**.
- **Exec tools** — `bakin_exec_schedule_*` create/update behave as before from the caller's view (no OpenClaw cron side effect).
- **CLI** — `bakin schedule …` HTTP-client commands unchanged in shape.
- **Dev/test** — `bun run test`, `bun test <file> --isolate`, `bun run dev:mock`. Scheduler engine tests use a **fake clock** (no real timers).
- **Settings** — schedule plugin settings gain `catchUpWindowMinutes` (default 60) and `tickIntervalSeconds` (default 30, floor-clamped to a safe minimum e.g. 5s); both editable in the schedule UI. `bridgeEnabled`/`bridgeSecret` removed; `reconcileLookbackHours` removed or repurposed as the catch-up horizon. The scheduler re-reads these each cycle (or restarts its timer on settings change) so neither requires a server restart.

## 3. Project structure

Changes concentrated in `plugins/schedule/`. Two areas legitimately fall outside it (delivery-error surfacing requires the adapter+core; dead-code deletion is in the adapter).

```
plugins/schedule/
  index.ts                         EDIT  — remove bridge/reconcile/legacy-repair; wire the scheduler engine; cutover-on-activate
  types.ts                         EDIT  — BakinJobMeta gains `schedule` (cron expr+kind) + `enabled`; Bakin-owned id
  lib/
    scheduler.ts                   NEW   — the tick loop + fire orchestration (fake-clock injectable); claim→fire→todo|blocked
    cron-eval.ts                   NEW   — thin wrapper over cron-parser: nextRun(expr,tz,after), occurrencesBetween(expr,tz,a,b), isDue
    schedule-store.ts              NEW   — canonical Bakin schedule store (was sidecar.ts); CRUD on BakinJobMeta incl. schedule/enabled
    sidecar.ts                     EDIT/RENAME → schedule-store.ts
    jobs-reader.ts                 EDIT  — split owned (Bakin store) vs runtime-cron (read-only adapter list); compute nextRun
    cron-parser.ts                 KEEP  — NL→cron parsing (unchanged)
    cutover.ts                     NEW   — one-time migration: copy expr/tz from OpenClaw job → store, delete OpenClaw cron job
    health-checks.ts               EDIT  — drop legacy-wake check; add orphan-cron check
    prompt-guard.ts                NEW   — transport danger-zone validation/warning for schedule prompts
  components/
    schedule-page.tsx              EDIT  — Bakin-schedules vs Runtime-cron grouping
    job-list.tsx / job-row.tsx     EDIT  — next-run column; read-only rendering for runtime crons
    run-history.tsx                EDIT  — surface delivery failures per run
    job-form.tsx                   EDIT  — catch-up window control; prompt-guard warning

packages/adapter-openclaw/src/runtime.ts   EDIT  — DELETE cronPayloadForCommand/appendCronPayloadArgs/cronCreateArgs/cronUpdateArgs/isBakinCron for Bakin path; KEEP cron.list/listRuns for read-only; add delivery-error propagation
src/core/ (audit/sse) + src/components/tasks/activity-feed.tsx   EDIT  — carry + render channel-delivery failure events
```

### Engine sketch
- **`cron-eval.ts`** isolates `cron-parser` (already a dependency, `package.json:75`): `nextRun`, `occurrencesBetween`, all tz-aware (job `meta.tz`, DST handled by cron-parser).
- **`scheduler.ts`**: a `Scheduler` with an injectable clock (`now()`), started on plugin activate. Tick every 30s. Each tick, for every enabled Bakin schedule, compute occurrences in `(now - tickWindow, now]`; for each, `claimCronFire(jobId, runId)` where `runId = \`${jobId}:${occurrenceEpochUTC}\``; on a fresh claim, `runClaimedFire(...)`. Occurrence time = the scheduled instant (not wall-clock fire time), so retries/catch-up dedupe.
- **Catch-up (startup)**: compute missed occurrences since the catch-up horizon; take the **most recent** per job → fire to `todo` if within `catchUpWindowMinutes`, else create in `blocked` (reason `missed-window`); `markCronFireSkipped` the older ones (consumed, not resurrected).
- **Reuse**: `claimCronFire`/`runClaimedFire`/`createTaskWithEffects`(+`column`/`blockedReason`)/`attachCronTask`/`healPendingCronClaims`/pause-skip-overlap logic all carry over. Ledger schema unchanged (`runId` is origin-agnostic; `packages/core/src/execution/ledger.ts:464-489`).

## 4. Code style

Follow `CLAUDE.md`. Specifics:
- TypeScript strict; Zod at boundaries (schedule create/update inputs, store parsing, settings).
- Functional/pure where practical; `const` over `let`. `kebab-case.ts`, `PascalCase` types, `UPPER_SNAKE_CASE` constants.
- `cron-parser` imported **only** in `cron-eval.ts` (single seam — the "modular engine, no cross-system adapter" decision).
- Scheduler clock injected (`() => number`) so tests use a fake clock — never real `setInterval`/`Date.now()` in unit tests.
- `const log = createLogger('schedule')`; no empty catches; every fire emits an audit event.
- Import order per CLAUDE.md. Plugin code uses `@makinbakin/sdk` surface; never `@/*` from the plugin.

## 5. Testing strategy

Per CLAUDE.md testing rules: mock **both** content-dir resolvers + the OpenClaw home resolver; set `BAKIN_HOME`/`OPENCLAW_HOME` before imports; mock logger + watcher; ledger tests `closeDb()` before `rmSync`. Use `tests/plugins/test-helpers.ts` (`activatePlugin`, `callRoute`, `callTool`). Run with `bun run test`; single file with `--isolate`.

Coverage:
1. **cron-eval** — nextRun/occurrencesBetween correctness incl. tz + a DST boundary; empty/invalid expr handling.
2. **scheduler (fake clock)** — single fire per occurrence; tick idempotency (same minute re-evaluated → no second task, via ledger); pause/skip/overlap honored; multiple jobs.
3. **catch-up / missed-fire (Prove-It)** — down across a fire → recent missed fires to `todo`; stale missed → `blocked` with `missed-window`; long outage coalesces to one task; window boundary (just-inside vs just-outside) exact.
4. **exactly-once** — concurrent/duplicate claim attempts → one task (reuse/extend `tests/plugins/schedule/cron-dedup.test.ts`).
5. **cutover** — existing OpenClaw-backed Bakin job → expr/tz copied to store + OpenClaw job removed; idempotent on second activate; no OpenClaw cron created on new schedule.
6. **runtime-cron surfacing** — native crons appear read-only; Bakin schedules appear owned; mutation routes reject runtime-cron ids.
7. **orphan-cron doctor check** — flags a Bakin schedule with a lingering OpenClaw cron job; ok when clean.
8. **delivery-error surfacing** — adapter delivery failure → audit event + task log entry (mock adapter).
9. **prompt-guard** — danger-zone prompt → warning; safe prompt → none.
10. **regression** — full suite green after dead-code deletion (no dangling imports/routes/health checks).

## 6. Boundaries

**Always do**
- Keep changes inside `plugins/schedule/` except the two unavoidable areas (delivery-error surfacing in adapter+core; dead-code deletion in the adapter).
- Reuse the execution ledger and `createTaskWithEffects`; keep exactly-once via deterministic per-occurrence `runId`.
- Inject the clock; isolate `cron-parser` behind `cron-eval.ts`.
- Update docs alongside code: `.claude/knowledge/` (schedule/cron + adapter-architecture boundary note), `CLAUDE.md` (re-draw the cron ownership boundary: *runtime owns crons it/agents create; Bakin owns scheduling of Bakin tasks*), schedule plugin README/authoring notes if impacted.
- Delete dead code outright (no shims, no compat layer) — single user, no backwards-compat requirement.

**Ask first**
- Any change beyond the listed files in `src/core/` or the adapter (especially anything touching dispatch or the ledger schema).
- Adding a new runtime dependency (none expected — `cron-parser` already present).
- Any change to *native* OpenClaw cron behavior (read-only only).
- Touching the user's live `~/.bakin` / `~/.openclaw` data (the user manages the live Daily Scramble job themselves).

**Never do**
- Never create or keep an OpenClaw cron job for a Bakin schedule.
- Never build a cross-system cron-backend adapter.
- Never let tests read/write real `~/.bakin` or `~/.openclaw`.
- Never reintroduce the bridge webhook or reconcile-poll as the primary fire path.
- Never silently drop a missed fire — it must fire (todo) or be visible (blocked).

## Open follow-ups (out of this effort)
- Agent/workspace **content** fixes the user owns: the 9am prompt's `<1900, do not split` danger-zone wording, and the stale job-id in `workspace/docs/bakin-daily-release-summary.md:5`. (This spec adds Bakin-side prompt-guard *tooling*; the actual prompt edits are the user's.)
- Possible later: push delivery (OpenClaw `--webhook` on native crons) — not needed for Bakin schedules under this design.
