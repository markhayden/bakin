# Projects — instant start + grill-me interview: todo

Branch (bits): `feat/projects-grill-start` · Branch (bakin): `docs/projects-grill-start`
Spec: `.claude/specs/projects-grill-start.md` · Plan: `tasks/projects-grill-start/plan.md`

## Phase 1 — instant start
- [ ] T1 lock bodies synchronous (NotPromise + asset lookups before the lock) — commit
- [ ] T2a receipt fields + fenced receipt helpers — commit
- [ ] T2b fenced `startKickoff` + create answers after write + `/ask` 409 — commit
- [ ] T3 `POST /:projectId/kickoff` + pump + independent boot dispatch — commit
- [ ] T4 start screen timeout/retry, complete chips, dead hook deleted — commit
- [ ] T5 project page starting state (notice, disabled composer, Retry, 20 s) — commit
- [ ] Checkpoint 1: gates green; reinstall on 3737; chip → Enter live; sha recorded

## Phase 2 — interview
- [ ] T6 brief skeleton + `briefOpenQuestions` + detail `brief` — commit
- [ ] T7 shaping interview prompt + stopping rule; steward excerpt Plan-first — commit
- [ ] T8 Start advisory + "Continue shaping" — commit
- [ ] Checkpoint 2: gates + browser fixtures + live interview acceptance; sha recorded

## Phase 3 — docs, review, coverage
- [ ] T9 README / UI-AUDIT / CHANGELOG / 0.14.0 / bakin docs / spec FINAL — commits
- [ ] T10 /agent-skills:test coverage pass; full suite — commits
- [ ] T11 Codex review round 1 → fixes → round 2 (→ until clean)
- [ ] Checkpoint 3: handoff to Mark for the live test; no push/merge until asked
- [ ] T12 ship: push, PRs, file the D1g host follow-up issue
