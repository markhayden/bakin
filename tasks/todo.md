# TODO — Completion-row invariant (#482) + rig fixes (#467)

Two branches off `main`: `fix/completion-row-invariant` then `fix/rig-scopes-agentdir`.
One commit per task; each ends green (`bun run test`). See `tasks/plan.md` for detail.

## WS1 — fix/completion-row-invariant (PR "Fixes #482")
- [x] **C1** extract `reopenIfLeavingDone` + `syncLedgerForStoreMove` helpers ✅ e6eb4b04
- [x] **C2** store `blockTask` enforces transitions, `blocked→blocked` idempotent, channel 4th param ✅ 0052ac0e
- [x] **C3** `blockTaskWithEffects` returns `{ alreadyComplete }`; move route 409; MCP soft response ✅ 99a8c960
- [x] **C4** `moveTaskInStore` ledger-symmetric via `syncLedgerForStoreMove` ✅ 523204c2
- [x] **C5** boot backfill + retire legacy `readTaskOutcome` done-fallback + `archiveOldTasks` purge ✅ 275900cb
- [x] **C6** `relativeTime` year + `useTaskRunHistory` reset/abort ✅ 2f14f991
- [x] **C7** knowledge docs (execution-ledger invariant, guards, exits-from-done inventory)
- [ ] **PR #482** opened (body flags watchdog review→blocked fail-soft edge)

## WS2 — fix/rig-scopes-agentdir (PR "Fixes #467")
- [ ] **C1** widen `OPERATOR_SCOPES` + `widenDeviceScopes` reused-state reconcile — `fix(rig): widen + reconcile pre-approved operator scopes`
- [ ] **C2** `normalizeAgentPaths` pure fn + wire into `up` pre-gateway — `fix(rig): normalize stored agent paths to container home on up`
- [ ] **C3** rig knowledge doc hard-won bullets — `docs(knowledge): rig hard-won list — scopes, agentDir normalization, BAKIN_URL`
- [ ] **PR #467** opened

## Rules (every commit)
- TDD: each new invariant test demonstrably fails against pre-commit code first
- Mock BOTH content-dir resolvers + OpenClaw home; `closeDb()` before temp-dir rm
- Stage explicit paths only — never `git add -A`
