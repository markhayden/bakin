# PLAN — Schedule: blocked tasks must not suppress real fires

> Derived from `SPEC.md`. Branch: `fix/schedule-blocked-overlap` off `main`.
> One commit per task; each task ends green (`bun run test` + `bun run lint` + `bun run typecheck`).
> TDD / Prove-It: write the failing test first, then the minimal change.

## Surface area

All behavior lives in **`plugins/schedule/index.ts`**:

- `runClaimedFire` (363) — overlap guard (404–413), failure tracking (416–428), title/date (433).
- fire callback (≈558) — currently `_occurrence` (discarded).
- `runClaimedFire` call sites: `fireScheduledRun` (322, has `firedAtMs`), auto-resume run (532), fire callback (559).

Supporting facts (verified read-only):
- `readTaskboard()` returns a typed `TaskBoard`; tasks already carry `blockedReason` (`src/core/task-store.ts:38,139`). Current code casts it down to `{ id }` — FR2 just needs a typed read, **no schema change**.
- Dispatch-failure block reasons (`src/core/dispatch.ts:778,1142`) are all distinct from `'missed schedule window'`, so an owned-constant compare cleanly separates triage vs failure.

## Dependency graph

```
T1 extract MISSED_WINDOW_REASON ──┐
   (no behavior change)           │
                                  ▼
T2 FR1 overlap excludes blocked   T3 FR2 triage ≠ failure  (needs T1 constant + typed board read)
   (independent)                  │
            └───────────┬─────────┘
                        ▼
            T4 FR3 occurrence-dated label + FR4 cascade regression
                        ▼
            T5 docs: bakin-owned-scheduler.md
```

T2 is independent of T1; T3 needs T1. T4's FR4 regression exercises T2+T3+T3 together, so it lands last. T5 documents the final behavior.

---

## Tasks

### T1 — Extract `MISSED_WINDOW_REASON` constant (refactor, no behavior change)
- **Change:** add `export const MISSED_WINDOW_REASON = 'missed schedule window'` near the top of `plugins/schedule/index.ts`; use it at line 561 (and the notification string at 497 if it shares the literal).
- **Acceptance:** literal `'missed schedule window'` appears once (the constant); blocked task still created with identical `blockedReason`.
- **Verify:** `bun run test tests/plugins/schedule/ --isolate` (all still green — no behavior change); `grep -n "missed schedule window" plugins/schedule/index.ts` shows only the constant decl.
- **Commit:** `refactor(schedule): extract MISSED_WINDOW_REASON constant`

### T2 — FR1: overlap guard excludes `blocked`
- **Test first** (`tests/plugins/schedule/`): drive a fire when the job's last task sits in `blocked` → assert a NEW task is created (not `skipped: 'overlap'`). Add/confirm the inverse: last task in `inProgress`/`review`/`todo` → still `skipped: 'overlap'`; `allowOverlap:true` bypasses.
- **Change:** `activeColumns` (406) → `['todo', 'inProgress', 'review'] as const`.
- **Acceptance:** AC1.1, AC1.2, AC1.3.
- **Verify:** the new test fails before, passes after; full suite green.
- **Commit:** `fix(schedule): exclude blocked from overlap guard`

### T3 — FR2: triage blocks don't count toward auto-pause
- **Test first:** last task blocked with reason `MISSED_WINDOW_REASON` → next fire does NOT increment `consecutiveFailures` / does NOT auto-pause; last task blocked with a dispatch-failure reason → DOES `recordFailure` (and auto-pauses at `maxFailures`); last task done/archived → `recordSuccess` (unchanged).
- **Change:** in the outcome check (416–428) read the board with a type that includes `blockedReason` (replace the `{ id }` cast with the real `TaskBoard`/`Task` shape); when the matched blocked task's `blockedReason === MISSED_WINDOW_REASON`, skip `recordFailure` (treat as neither success nor failure).
- **Acceptance:** AC2.1–AC2.4.
- **Verify:** new tests red→green; full suite green.
- **Commit:** `fix(schedule): don't count triage blocks toward auto-pause`

### T4 — FR3 + FR4: occurrence-dated label, and cascade regression
- **Test first:**
  - FR3: a catch-up fire for an occurrence dated day *D* (with `now` = D+1) → created task `title`/`date` reflect *D*, not D+1. On-time fire (occurrence ≈ now) → unchanged.
  - FR4 (cascade e2e): seed a `blocked` triage task as the job's last task → fire the next occurrence → assert a new task is created+dispatched AND `consecutiveFailures` unchanged.
- **Change:** add `firedAtMs?: number` (or `occurrence?: Date`) to `runClaimedFire`; derive `templateVars.date` + default title from it (fallback to `Date.now()` when absent). Fire callback (559) passes `occurrence.getTime()`; `fireScheduledRun` (322) passes its `firedAtMs`; auto-resume site (532) passes its fired time or omits.
- **Acceptance:** AC3.1–AC3.3, AC4.1.
- **Verify:** new tests red→green; full suite green; manual sanity in `bun run dev:mock` optional.
- **Commit:** `fix(schedule): label catch-up tasks by occurrence date`

### T5 — Docs
- **Change:** update `.claude/knowledge/bakin-owned-scheduler.md`: overlap ignores `blocked`; triage blocks (`missed schedule window`) don't penalize job health; catch-up tasks are labeled by occurrence date. Verify `README.md`/`CLAUDE.md` need no change.
- **Acceptance:** doc matches shipped behavior; `bun run docs:check` (if present) green.
- **Commit:** `docs(schedule): update bakin-owned-scheduler knowledge for blocked semantics`

---

## Checkpoints (rollback boundaries)
- **CP-A** after T1 — refactor only, suite green, zero behavior change (safe baseline).
- **CP-B** after T2+T3 — core bug fixed (blocked no longer suppresses fires; triage ≠ failure).
- **CP-C** after T4 — labels correct + cascade regression locked.
- **CP-D** after T5 — docs in sync; ready for `/agent-skills:test` review + `/agent-skills:review`.

Each task is a single revertable commit. Any task can be reverted without breaking the prior checkpoint.

## Risks / watch-items
- Threading the fire time must not break the manual/auto-resume `runClaimedFire` paths (322, 532) — default to now when no occurrence. Confirm line 532 context during build.
- The typed board read in T3 must use the canonical `TaskBoard` type (avoid re-introducing an `any`/narrow cast).
- Keep the fix inside `plugins/schedule/`; do not touch `src/core/dispatch.ts` (boundary in SPEC §9).

## Docker gold-standard verification (isolated mode)

Confirms the fix against a real OpenClaw + Bakin server, not the mock. Needs
1Password auth (`OP_SERVICE_ACCOUNT_TOKEN`) for `instance up` to resolve rig
secrets — that's why it's a human-run / token-gated step.

```bash
export OP_SERVICE_ACCOUNT_TOKEN=…              # 1Password service-account token
bun run instance up   --mode isolated          # OpenClaw container + disposable BAKIN_HOME under dev/
bun run instance status                         # gateway reachable
bun run instance dev  --mode isolated &         # Bakin server on :3737 (foreground; bg or separate shell)

# --- drive the blocked-overlap repro (FR1/FR4) via the CLI client ---
JOB=$(bun run instance run --mode isolated -- schedule add "Overlap Probe" "every day at 9am" --prompt "reply ok" | sed -n 's/.*\(sch_[0-9a-f-]*\).*/\1/p')
bun run instance run --mode isolated -- schedule run "$JOB"        # → task A in todo
A=… # task A id from the output / `tasks list`
bun run instance run --mode isolated -- tasks block "$A"          # move A → blocked
bun run instance run --mode isolated -- schedule run "$JOB"        # → must create task B (NOT skipped:overlap)
bun run instance run --mode isolated -- schedule runs "$JOB"       # both fires 'created'; none 'skipped:overlap'

bun run instance down                            # teardown (reset to wipe)
```

**Pass criteria (specific to this fix):**
- The second `schedule run` while task A sits in `blocked` returns a new `taskId`
  (pre-fix it returned `skipped: 'overlap'`).
- `schedule runs` shows both fires as `created` — no `overlap` skip.
- (FR3 visual) A catch-up task created after a downtime that spans a fire is
  titled with the missed occurrence's date, not today's.

Also re-run the existing runbook scenarios 5 (downtime catch-up) & 6 (pause/
skip/overlap) from `tasks/t15-e2e-runbook.md` to confirm no regression.

## Task checklist
- [x] T1 — extract `MISSED_WINDOW_REASON` (CP-A) ✅ 25887fc9
- [x] T2 — FR1 overlap excludes blocked ✅ 00047741
- [x] T3 — FR2 triage ≠ failure (CP-B) ✅ af75c222
- [x] T4 — FR3 occurrence-dated label + FR4 cascade regression (CP-C) ✅ 7483e25e
- [x] T5 — docs (CP-D)
