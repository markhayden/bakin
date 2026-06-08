# PLAN — Bakin-Owned Scheduler

> Derived from `SPEC.md`. Plan-mode artifact: ordering, vertical slices, acceptance + verification, checkpoints, and the commit/rollback strategy.
> Branch: `feat/bakin-owned-scheduler` off `main`. One commit per task; each task ends green (suite + lint).

## Dependency graph

```
cron-eval (T1) ─────────────┐
                            ├─► scheduler engine (T3) ─► SWITCH: cutover+routes+activate (T4) ─► remove reconcile/bridge (T5)
schedule-store model (T2) ──┘                                        │
                                                                     ├─► catch-up / missed-fire → todo|blocked (T6)
                                                                     ├─► legacy-repair + seeding removal (T7)
                                                                     ├─► adapter Bakin-cron payload removal (T8)
                                                                     ├─► runtime-cron read-only split + UI (T9) ─► next-run column (T10)
                                                                     ├─► orphan-cron doctor check (T11)
                                                                     ├─► delivery-error surfacing (T12)  [adapter+core+UI; independent]
                                                                     └─► prompt-guard (T13)
docs alignment (T14) — last
```

Critical path: **T1/T2 → T3 → T4** (the switch that fixes the double-fire) → everything else fans out.
T12 (delivery-error surfacing) is independent and could be done any time after T4; sequenced into the visibility phase.

## Slicing principle

Each task is a vertical slice that compiles, tests, and commits on its own. The risky moment — Bakin starting to fire while OpenClaw still fires — is collapsed into a **single atomic task (T4)**: it stops creating OpenClaw crons, deletes existing Bakin-owned OpenClaw crons (cutover), neutralizes the reconcile path, and activates the engine together. No intermediate double-fire window.

---

## Phase 0 — Engine primitives (no behavior change)

### T1 — `cron-eval.ts`: isolate cron-parser
- **Build:** `plugins/schedule/lib/cron-eval.ts` wrapping `cron-parser` (already in `package.json:75`). API: `nextRun(expr, tz, after)`, `occurrencesBetween(expr, tz, from, to)`, `isValidExpr(expr)`. All tz-aware via the job's `tz`.
- **Acceptance:** pure module, `cron-parser` imported nowhere else in the plugin.
- **Verify:** `bun test tests/plugins/schedule/cron-eval.test.ts --isolate` — next-run/occurrences correctness, a DST-boundary case, invalid-expr handling.
- **Commit:** `feat(schedule): add cron-eval module isolating cron-parser`

### T2 — Schedule store model
- **Build:** rename `lib/sidecar.ts` → `lib/schedule-store.ts`. Extend `BakinJobMeta` (`types.ts`) with `schedule: { kind: 'cron'|'every'|'at'; expr: string }` and `enabled: boolean`. Bakin-owned id minting (no OpenClaw-derived id). Zod parse on read.
- **Acceptance:** store CRUD round-trips the new fields; existing fields untouched; readers updated to the new module path.
- **Verify:** `bun test tests/plugins/schedule/schedule-store.test.ts --isolate`; full suite green (additive change).
- **Commit:** `refactor(schedule): make sidecar the canonical schedule store (schedule expr + enabled)`

> **CHECKPOINT A** — engine primitives + store model in place, no behavior change. Rollback point: revert to here keeps the old OpenClaw-cron path fully working.

---

## Phase 1 — The switch (fixes the double-fire)

### T3 — Scheduler engine (built, not yet activated)
- **Build:** `plugins/schedule/lib/scheduler.ts`. `Scheduler` with injected clock `now: () => number`. `tick()` iterates enabled store jobs, computes occurrences in `(now - window, now]` via cron-eval, mints `runId = \`${jobId}:${occurrenceEpochUTC}\``, calls `claimCronFire`; on fresh claim → `runClaimedFire(...)`. Reuses existing pause/skip/overlap/failure logic and `healPendingCronClaims`. Not wired into `activate()` yet (or wired but gated off `schedule` being unset, so a no-op).
- **Acceptance:** with a fake clock, a due occurrence fires once; re-ticking the same minute creates no second task; pause/skip/overlap honored.
- **Verify:** `bun test tests/plugins/schedule/scheduler.test.ts --isolate` (fake clock, no real timers).
- **Commit:** `feat(schedule): add Bakin scheduler engine (fake-clock testable)`

### T4 — SWITCH: cutover + routes + activate (atomic)
- **Build (one commit):**
  - `lib/cutover.ts`: a single idempotent `migrateBakinSchedulesOffOpenClawCron()` — for each Bakin job, read its current OpenClaw cron expr/tz (via `cron.get`) into the store's `schedule`, then `cron.remove` the OpenClaw job. Skip if already migrated / no runtime job. **Called automatically on activate** (closes the upgrade gap: the new scheduler only fires jobs whose store has a `schedule` expr, so migration must populate it before the reconcile-poll is gone — otherwise an un-migrated job would rogue-fire via OpenClaw with no Bakin task). The **same function is reused by the doctor auto-fix in T11** as the bulletproof repair path when OpenClaw was unreachable at activate.
  - Create/update routes + exec tools (`index.ts:139,141,251,954,1013,1111,1433,1490`) write the store and **stop calling `cron.create/update`** for Bakin schedules.
  - Pause/resume (`index.ts:1211,1222,1231,1524,1533,1542`) flip the store `enabled`/`paused` flag instead of `cron.update({enabled})`.
  - Activate the scheduler in `activate()`; **remove the reconcile-poll** (`startReconciler`, `reconcileScheduleRuns`) wiring so the old path no longer creates tasks.
- **Acceptance:** creating a Bakin schedule writes no OpenClaw cron job; an existing job is migrated + its OpenClaw cron removed; a due schedule fires exactly once (Bakin), zero OpenClaw fires.
- **Verify:** `bun test tests/plugins/schedule/ --isolate` incl. an extended exactly-once test (reuse `cron-dedup.test.ts`); manual: create schedule via route in test → assert mock OpenClaw `jobs.json` unchanged.
- **Commit:** `feat(schedule): fire schedules from Bakin's own scheduler; cut over off OpenClaw cron`

### T5 — Remove bridge webhook + reconcile remnants
- **Build:** delete `handleBridge`, `processScheduledRun` (bridge entry), `getOrCreateBridgeSecret`, the bridge route, `seedCronFireLedgerFromSidecar` call sites that only served the old path; remove `bridgeEnabled`/`bridgeSecret` settings; add `catchUpWindowMinutes`/`tickIntervalSeconds` settings. Keep `runClaimedFire`, `claimCronFire`, `healPendingCronClaims`.
- **Acceptance:** no references to the bridge remain; settings schema updated; suite green.
- **Verify:** `grep -rn "bridge\|reconcileScheduleRuns" plugins/schedule` clean; full suite.
- **Commit:** `refactor(schedule): remove bridge webhook + reconcile-poll (dead after cutover)`

> **CHECKPOINT B** — **double-fire eliminated.** Bakin fires exactly once; OpenClaw fires no Bakin schedules. This is the milestone that resolves the reported bug. Rollback point.

---

## Phase 2 — Downtime handling

### T6 — Catch-up / missed-fire → todo | blocked
- **Build:** startup catch-up in scheduler: compute missed occurrences since the catch-up horizon; take the **most recent** per job → fire to `todo` if within `catchUpWindowMinutes`, else `createTaskWithEffects({ column: 'blocked', blockedReason: 'missed-window', ... })`; `markCronFireSkipped` the older occurrences. Tiny core addition: `createTaskWithEffects` accepts `blockedReason` passthrough (`src/core/task-service.ts` — small, flagged as the one core touch).
- **Acceptance:** AC#4 in SPEC — recent→todo, stale→blocked w/ reason, long outage coalesces to one, window boundary exact.
- **Verify:** Prove-It test `tests/plugins/schedule/catch-up.test.ts --isolate` (fake clock; just-inside vs just-outside window; 3-day outage → 1 task).
- **Commit:** `feat(schedule): catch-up policy with safety window (todo within window, blocked when stale)`

> **CHECKPOINT C** — downtime handling correct and visible.

---

## Phase 3 — Dead-code removal

### T7 — Remove legacy main-session-wake repair + seeding
- **Build:** delete `needsBakinCronWakeRepair`, `repairMainSessionBakinCronPayloads`, `runLegacyCronRepair`, `scheduleLegacyCronRepairRetry`, `checkLegacyBakinCronPayloads`, `legacyCronWakeRepair`, related constants/timers, and `seedCronFireLedgerFromSidecar` (the legacy `processedRunIds` migration — no longer relevant under the new model).
- **Acceptance:** no legacy-repair references; suite green.
- **Verify:** `grep -rn "needsBakinCronWakeRepair\|legacyCronRepair\|seedCronFireLedger" plugins/schedule` clean.
- **Commit:** `refactor(schedule): drop legacy main-session-wake repair + sidecar seeding`

### T8 — Adapter cleanup (strip Bakin-cron special-casing)
- **Build:** in `packages/adapter-openclaw/src/runtime.ts` remove `isBakinCron`, `cronPayloadForCommand`, the bakin branch of `appendCronPayloadArgs`, and the `bakinSchedule` toolsAllow special-casing. **Keep** generic `cron.list/get/listRuns/create/update/remove` (create/update lose only the Bakin branch; `remove` needed by cutover; `list`/`listRuns` needed for read-only). Verify no non-schedule callers depend on the removed bits.
- **Acceptance:** adapter has no `bakin:`/`bakinSchedule` awareness; `tests/adapter-openclaw/runtime-cron.test.ts` updated to drop Bakin-cron cases.
- **Verify:** `bun test tests/adapter-openclaw/ --isolate`; `grep -rn "bakinSchedule\|isBakinCron\|cronPayloadForCommand" packages/adapter-openclaw` clean.
- **Commit:** `refactor(adapter-openclaw): remove Bakin-specific cron payload shaping`

> **CHECKPOINT D** — ~500 lines of cross-process wrangling gone; adapter generic again; suite green.

---

## Phase 4 — Visibility (the user's adjacent asks)

### T9 — Runtime-cron read-only surfacing
- **Build:** `jobs-reader.ts` splits into **owned** (Bakin store) vs **runtime** (adapter `cron.list`, read-only). UI (`schedule-page.tsx`, `job-list.tsx`, `job-row.tsx`) renders two groups; mutation routes reject runtime-cron ids with a clear error.
- **Acceptance:** AC#5 — native crons read-only; Bakin schedules editable; mutating a runtime id is rejected.
- **Verify:** `bun test tests/plugins/schedule/jobs-reader.test.ts --isolate`; route test asserts rejection.
- **Commit:** `feat(schedule): surface OpenClaw native crons read-only alongside Bakin schedules`

### T10 — Next-run column
- **Build:** compute next-run per Bakin schedule via cron-eval in jobs-reader; render column in UI.
- **Acceptance:** next-run shown and correct for cron + tz.
- **Verify:** unit test on the computed field; UI smoke via `bun run dev:mock`.
- **Commit:** `feat(schedule): show computed next-run per schedule`

### T11 — Orphan-cron doctor check (= the end-user migration command)
- **Build:** `health-checks.ts` adds a check: any Bakin store schedule that still has a matching OpenClaw cron job (via `cron.list`) → warn (incomplete cutover / rogue-fire risk). **Auto-fix calls the shared `migrateBakinSchedulesOffOpenClawCron()` from T4** (import expr if missing, then remove the orphan) — so this is the canonical end-user migration/repair path via `bakin check schedule-cutover` / `bakin install schedule-cutover`, identical logic to the automatic on-activate cutover.
- **Acceptance:** AC#6 — flags orphan; ok when clean; auto-fix completes the migration (job still scheduled in Bakin, OpenClaw cron gone); idempotent.
- **Verify:** `bun test tests/plugins/schedule/health-checks.test.ts --isolate` (orphan present → fixed → clean on re-run).
- **Commit:** `feat(schedule): doctor check + repair for orphaned OpenClaw crons behind Bakin schedules`

### T12 — Delivery-error surfacing (adapter + core + UI)
- **Build:** OpenClaw adapter propagates channel-delivery failures (e.g. "Invalid Form Body") as a typed event/audit; core audit/SSE carries it; `activity-feed.tsx` + task log render it. Link to the originating task where available.
- **Acceptance:** AC#7 — a delivery failure appears in the activity feed and on the task.
- **Verify:** `bun test` with a mock adapter emitting a delivery failure → audit + task-log assertions.
- **Commit:** `feat(delivery): surface channel-delivery failures in activity feed and task log`

### T13 — Schedule prompt danger-zone guard
- **Build:** `lib/prompt-guard.ts` — on create/edit, warn when a schedule prompt risks the channel transport danger zone (e.g. "do not split" + high char cap). Surface in `job-form.tsx`.
- **Acceptance:** AC#8 — danger-zone prompt warns; safe prompt does not.
- **Verify:** `bun test tests/plugins/schedule/prompt-guard.test.ts --isolate`.
- **Commit:** `feat(schedule): warn on schedule prompts that risk the channel transport danger zone`

> **CHECKPOINT E** — all visibility features in; suite green.

---

## Phase 5 — Docs & close-out

### T14 — Docs alignment
- **Build:** update `CLAUDE.md` (re-draw the cron ownership boundary: *runtime owns crons it/agents create; Bakin owns scheduling of Bakin tasks*); `.claude/knowledge/` schedule/cron deep-dive + `adapter-architecture.md` note; schedule plugin README/authoring if impacted. Record the out-of-scope follow-ups (prompt content edit, stale doc job-id).
- **Acceptance:** docs match the shipped behavior; no stale references to bridge/reconcile/OpenClaw-cron-for-Bakin.
- **Verify:** manual read; `grep` for stale terms across docs.
- **Commit:** `docs(schedule): document Bakin-owned scheduling + re-draw cron ownership boundary`

> **CHECKPOINT F** — full `bun run test` + lint + `bun run build` green. Ready for `/agent-skills:test` coverage pass and `/agent-skills:review`.

---

## Phase 6 — Gold-standard E2E validation (MUST pass before "complete")

### T15 — Bulletproof E2E against the dockerized OpenClaw rig
Real OpenClaw in Docker, not the mock — `bun run instance up` / `instance dev` (`scripts/instance.ts`, `.claude/knowledge/dockerized-openclaw-rig.md`). Does **not** touch `~/.openclaw` or `~/.bakin`. This is the acceptance gate; the work is not complete until every check passes.

- **Scenarios (each asserted against real runtime state — `cron/jobs.json`, cron run logs, the task board, channel/delivery records):**
  1. **No OpenClaw cron created:** create a Bakin schedule → assert the rig's `cron/jobs.json` gains **no** `bakin:schedule:*` entry.
  2. **Exactly-once fire:** drive a schedule to its fire minute → exactly one Bakin task; **zero** OpenClaw-originated agent turns; no duplicate channel post. (This is the original bug — must be provably gone.)
  3. **Upgrade migration (gap-free):** seed the rig with a *legacy* Bakin-owned OpenClaw cron (agentTurn payload, like today's Daily Scramble) → start the new server → assert auto-cutover imported the expr into the store, removed the OpenClaw cron, and the next fire is single-path Bakin with no rogue turn.
  4. **Doctor repair:** simulate OpenClaw unreachable at activate (leave an orphan cron) → `bakin check schedule-cutover` flags it → `bakin install schedule-cutover` completes migration → re-check clean.
  5. **Downtime catch-up:** stop the server across a fire time, restart within the window → fires to `todo`; restart outside the window → lands in `blocked` (`missed-window`); long outage → one coalesced task.
  6. **Pause/skip/overlap:** verified end-to-end against the rig (no fire while paused; skip-N honored; overlap guard blocks concurrent task).
  7. **Read-only surfacing:** create a *native* OpenClaw cron directly in the rig → appears read-only in the schedule view; mutation attempt rejected; Bakin schedules remain editable.
  8. **Delivery-error visibility:** induce a channel-delivery failure → appears in the activity feed + on the task.
  9. **Idempotency/durability:** restart the server twice → no re-fire of past occurrences, no duplicate migration, no orphan.
- **Acceptance:** all 9 scenarios pass against real OpenClaw; `cron/jobs.json` holds no Bakin entries; the original double-post is unreproducible across repeated runs.
- **Verify:** scripted E2E run on the rig (capture transcript/artifacts); document results in the PR.
- **Commit:** `test(schedule): gold-standard E2E validation against dockerized OpenClaw rig`

> **CHECKPOINT G — DONE.** Bug provably gone end-to-end on real OpenClaw; migration (auto + doctor) verified; visibility verified. Only now is the work "complete."

---

## Commit / rollback strategy

- **Branch:** `feat/bakin-owned-scheduler` off `main`. PR at the end (per repo norm — squash-merge style history shows merge PRs).
- **One commit per task**, conventional + scoped (messages above). Every commit is green (suite + lint) so any commit is a safe `git revert` / reset point.
- **Checkpoints A–F are the rollback anchors:**
  - **A** — safe baseline; old path intact.
  - **B** — the bug is fixed; if anything later regresses, reset to B keeps the double-fire fix with old dead code still present (acceptable interim).
  - **D** — clean architecture; the natural "good state" if visibility work needs to pause.
  - **F** — ship-ready.
- **Riskiest commit is T4** (the switch). It is self-contained and reversible: `git revert` of T4 restores OpenClaw-cron firing (T5+ not yet applied at that point, so reconcile/bridge still exist). Validate T4 hard before proceeding.
- **No shims / no dual-run:** per project rule, we do not keep both fire paths alive across commits — T4 switches atomically. The "rollback" mechanism is git, not a runtime flag.
- **Build-stamp trap:** do **not** `git add -A` after a local `bun run build` (it rewrites a tracked version-stamp file). Stage explicit paths per commit.

## Risks & mitigations
- **Missed fires / DST** (new surface): concentrated tests in T1 (DST) + T6 (window/coalesce, Prove-It). Mitigated by cron-parser handling tz/DST and Bakin already being the always-on singleton.
- **Cutover correctness** (T4): idempotent; reads expr from OpenClaw before deleting; doctor check (T11) catches any orphan left behind.
- **One core touch** (`createTaskWithEffects` `blockedReason`, T6): minimal, additive; flagged for review.
- **Delivery-error scope creep** (T12): bounded to propagate+render an existing failure; no change to delivery logic itself.
