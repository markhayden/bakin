# TODO — Bakin-Owned Scheduler

Branch: `feat/bakin-owned-scheduler` off `main`. One commit per task; each ends green. See `tasks/plan.md` for detail.

## Phase 0 — Engine primitives
- [x] **T1** `cron-eval.ts` isolating cron-parser (+ tests: next-run, occurrences, DST, invalid expr) — `feat(schedule): add cron-eval module isolating cron-parser` ✅ 8615138a
- [x] **T2** schedule store model: `schedule` expr + `enabled`, Bakin-owned id (+tests; file rename deferred) — `refactor(schedule): make the sidecar the canonical schedule store` ✅ f5808d7c
- [x] **— CHECKPOINT A** — primitives in place, no behavior change, full suite green (4741 pass)

## Phase 1 — The switch (fixes the double-fire)
- [x] **T3** scheduler engine, fake-clock testable, not yet activated — `feat(schedule): add the Bakin scheduler engine` ✅ 904e4fc7
- [ ] **T4** SWITCH — re-sliced into 3 independently-green commits (reader rewrite + 2 health checks must move in; discovered the reader's stale-sidecar cleanup would delete every Bakin job post-cutover, and scheduleSyncRepair could re-create OpenClaw crons):
  - [x] **T4a** `lib/cutover.ts` idempotent migration fn (+tests) — `feat(schedule): add idempotent cutover migration off OpenClaw cron` ✅ 79a8c9f9
  - [x] **T4b** `jobs-reader` unions store-only Bakin jobs + drop the storage-mutating stale-delete (+tests) — `refactor(schedule): surface store-owned schedules in the merged reader` ✅ 5bee2f49
  - [x] **T4c** atomic flip: create/update/pause/run_now/adopt/ensureBakinJob write the store (no OpenClaw cron) + activate runs cutover + startScheduler + drop reconcile-start + removed legacy-wake cluster (T7 absorbed) + 2 health checks + test updates — `feat(schedule): fire schedules from Bakin's own scheduler; cut over off OpenClaw cron` ✅ dba04986
- [x] **— CHECKPOINT B** — double-fire eliminated; one fire path; full suite 4757 pass ✅
- [x] **T5** remove bridge webhook + secret + reconcile remnants; settings (`catchUpWindowMinutes`+`tickIntervalSeconds` in UI); heal folded into scheduler tick — `refactor(schedule): remove dead bridge webhook + reconcile-poll machinery` ✅ 5f90bbe0
- [ ] **— CHECKPOINT B** — double-fire eliminated; one fire path; OpenClaw fires no Bakin schedules ✅ core bug fixed

## Phase 2 — Downtime handling
- [x] **T6** catch-up: most-recent missed → todo within window / blocked when stale, coalesce older; `createTaskWithEffects`+`updateTask` gain `blockedReason` (core touch) — `feat(schedule): catch-up policy with a safety window` ✅ fe19d797
- [x] **— CHECKPOINT C** — downtime handling correct + visible

## Phase 3 — Dead-code removal
- [~] **T7** legacy main-session-wake repair cluster + its 2 health checks — **absorbed into T4c** (lint forced their removal once activate stopped calling them). Remaining for T5: bridge webhook + `reconcileScheduleRuns` + `seedCronFireLedgerFromSidecar`.
- [x] **T8** adapter: strip Bakin-cron payload shaping (keep generic CRUD/list/runs) — `refactor(adapter-openclaw): remove Bakin-specific cron payload shaping` ✅ b119d63f
- [x] **— CHECKPOINT D** — wrangling gone; adapter generic; full suite 4737 pass

## Phase 4 — Visibility
- [x] **T9** runtime-cron read-only (reader already unions both; added 403 mutation guards on PUT/pause/skip/delete route+exec) — `feat(schedule): next-run column + read-only guards for native crons` ✅ 40e33a0f
- [x] **T10** next-run column (reader computes via cron-eval.nextRun; row + drawer) — same commit ✅ 40e33a0f
- [x] **T11** schedule-cutover doctor check + repair = end-user migration command (`bakin check/install schedule-cutover`, shares the cutover fn) — `feat(schedule): doctor check + repair for schedules not cut over` ✅ 5357d7fc
- [~] **T12** delivery-error surfacing — **DEFERRED** (decide together). Turn-killing delivery failures already surface via dispatch audit; the incident's *recovered/repaired* failures (agent posts via its message tool INSIDE OpenClaw) need trajectory tool-error introspection — a separate, larger session-forensics effort, not observable at Bakin's `channels.sendMessage` (only the watchdog calls that). T13's prompt-guard already attacks the root cause.
- [x] **T13** schedule prompt danger-zone guard (live form warning + API warnings) — `feat(schedule): warn on prompts that risk the transport danger zone` ✅ 2b68443c
- [x] **— CHECKPOINT E** — visibility shipped (T9/T10/T11/T13); T12 deferred w/ rationale; suite green

## Phase 5 — Docs & close-out
- [ ] **T14** docs: CLAUDE.md boundary re-draw + `.claude/knowledge` schedule/cron + adapter note + README; record follow-ups — `docs(schedule): document Bakin-owned scheduling`
- [ ] **— CHECKPOINT F** — full test + lint + build green; ready for `/agent-skills:test` + `/agent-skills:review`

## Phase 6 — Gold-standard E2E (MUST pass before "complete")
- [ ] **T15** bulletproof E2E vs dockerized OpenClaw rig — 9 scenarios (no OpenClaw cron created · exactly-once · upgrade migration gap-free · doctor repair · downtime catch-up todo/blocked · pause/skip/overlap · read-only surfacing · delivery-error visibility · restart idempotency) — `test(schedule): gold-standard E2E validation against dockerized OpenClaw rig`
- [ ] **— CHECKPOINT G — DONE** — bug provably gone E2E on real OpenClaw; migration (auto + doctor) + visibility verified

## Out of scope (follow-ups for the user)
- [ ] Agent workspace prompt edit: 9am `<1900, do not split` → align to the safe `<900, split deliberately` shape (Bakin adds the *warning* in T13; content edit is yours)
- [ ] Fix stale job-id in `workspace/docs/bakin-daily-release-summary.md:5`
