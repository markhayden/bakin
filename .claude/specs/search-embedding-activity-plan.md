# Implementation Plan: Embedding-Activity Signals (#847)

Spec: `.claude/specs/search-embedding-activity.md` · Branch
`feat/search-embedding-activity-847` · Three commits.

## Grounding facts

- Spin check consumes `TableLegHealth` via `tables.health()`; detection is
  pure `detectSpins(prev, now, legs, windowMs)` over `SpinLegSnapshot`
  (`building && outboxPending===0 && count frozen across window`).
- Park paths in `packages/core/src/search/tables.ts` log
  `{logical, green, emitted, reason}`; the converge loop already polls
  `tables.health(green)` per tick — new leg fields are free evidence there.
- Wire: `WireIndexStatusEntry.status` needs `activity?`, `readiness?`,
  `publication?` objects + runtime `stall_reason?`,
  `active_progress_completed/total?`, `last_progress_ms?` (verified live).
- D17: adapter-neutral names on `TableLegHealth`: `phase?`, `stalled?`,
  `stallReason?`, `progress?: { completed: number; total: number }`,
  `pendingReasons?: string[]`.

## Tasks

- [ ] **T1 (S, commit 1): wire + translate + contract fields**
  - RED: translate matrix — fields mapped when present, absent otherwise;
    scar/error behavior byte-identical without them.
- [ ] **T2 (S, commit 2): spin watchdog stalled-trigger**
  - `SpinLegSnapshot.stalled?/stallReason?`; `detectSpins`: an engine-declared
    stalled building leg spins IMMEDIATELY (no window wait); count-frozen
    inference unchanged. Evidence/incident detail carries stallReason.
  - RED: stalled leg with MOVING counts fires; stalled=false behaves as today.
- [ ] **T3 (S, commit 3): park + health evidence, converge narration**
  - Park log/registry evidence gains the green's leg phase/progress/
    pendingReasons snapshot; `getSearchHealth` legs pass the new fields
    through (SDK `SearchHealthIndex` optional additions); converge
    `onProgress` includes engine phase when present. Knowledge notes.
  - RED: park fixture asserts evidence fields; flip tests unchanged.

## Checkpoint
Targeted suites (translate, spin/system-checks, search-tables) + typecheck +
lint green per commit; PR; live pass = `bakin reindex --table` on a small
table narrates phases and doctor evidence carries progress.

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| upstream `stalled` over-fires | Low | it only ACCELERATES an incident the count-window would confirm; disposition unchanged |
| evidence bloat in park logs | Low | one bounded snapshot per park |
