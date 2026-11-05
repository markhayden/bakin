# Projects — instant start + grill-me interview: todo

Branch (bits): `feat/projects-grill-start` · Branch (bakin): `docs/projects-grill-start`
Spec: `.claude/specs/projects-grill-start.md` · Plan: `tasks/projects-grill-start/plan.md`

## Phase 1 — instant start
- [x] T1 lock bodies synchronous (NotPromise + asset lookups before the lock) — 014d5d1
- [x] T2a receipt fields + fenced receipt helpers — 4caf5db
- [x] T2b fenced `startKickoff` + create answers after write + `/ask` 409 — f2a6499
- [x] T3 `POST /:projectId/kickoff` + pump + independent boot dispatch — 01f02ff
- [x] T4 start screen timeout/retry, complete chips, dead hook deleted — 873b1ab
- [x] T5 project page starting state (read-only panel + notice, Retry, 20 s) — b2a2669
- [x] Checkpoint 1 (2026-11-04 23:38 MST): gates green; installed on 3737; chip → Enter opened the page at once, reply streamed, Stop settled clean — known-good sha b2a2669

## Phase 2 — interview
- [x] T6 brief skeleton + `briefOpenQuestions` + detail `brief` — 06ea742
- [x] T7 shaping interview prompt + stopping rule; steward excerpt Plan-first — 1cc6759
- [x] T8 Start advisory + "Continue shaping" — 8ce217b
- [ ] Checkpoint 2: gates + browser fixtures + live interview acceptance; sha recorded

## Phase 3 — docs, review, coverage
- [ ] T9 README / UI-AUDIT / CHANGELOG / 0.14.0 / bakin docs / spec FINAL — commits
- [ ] T10 /agent-skills:test coverage pass; full suite — commits
- [ ] T11 Codex review round 1 → fixes → round 2 (→ until clean)
- [ ] Checkpoint 3: handoff to Mark for the live test; no push/merge until asked
- [ ] T12 ship: push, PRs, file the D1g host follow-up issue
