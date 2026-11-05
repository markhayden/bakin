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
- [x] Checkpoint 2 (2026-11-05 00:02 MST): gates green; bits browser conformance green (all projects fixtures + 6 detail scenarios); live on 3737: S1 vague idea → 7 cards with recommendations, brief filled, title set (over-asked details → assume-don't-ask rule added); S2 'just write it' second message → draft + 4 steps + labelled assumptions + open questions kept; S3 first message 'just write it' → immediate draft, no card; S4 fully specified → first run asked one card; after the assume + draft-in-the-same-turn rules (b738acf, +1) it drafted with four steps and no card; S5 Start dialog → advisory + Continue shaping → Conversation tab — known-good sha 8ce217b (+ fixes 1a5e146, b738acf)

## Phase 3 — docs, review, coverage
- [x] T9 README / UI-AUDIT / CHANGELOG / 0.14.0 / bakin docs / spec FINAL — f5dbe30, 6768040 (bits); 8d0631d4a, bc1be3575, 246f241fa (bakin)
- [x] T10 coverage pass — a0af459; full suite green (1563 pass)
- [x] T11 Codex review: round 1 (2 findings → 1a5e146), round 2 (2 findings → 56e73f1), round 3 APPROVE (2026-11-05 00:12 MST)
- [x] T11b Mark's live test (2026-11-05 14:00 MST): submit sat on "Sending…" — root cause `crypto.randomUUID` undefined on the plain-http Tailscale origin (reproduced in Playwright against http://100.91.112.69:3737: TypeError before fetch); fixed with `newRequestId()` + mint inside the try, reproduction test — ff23f8f; gates green (1567 pass); installed on 3737 (client v6); chip → Enter on the Tailscale origin opened the project and the lead asked its first card
- [x] T11c Codex round 1 on ff23f8f: 3 findings (hooks still used randomUUID; pre-request throw lost the text; throw path untested) → ce203a8 (one `lib/request-id.ts` helper at all four mints, unconditional restore before the request leaves, throw-path + hook + deterministic-byte tests); gates green (1572 pass); installed on 3737 (client v7)
- [x] T11d Codex round 2 on ce203a8: 1 finding (`sent` flipped before the request options were built) → 0419caa (options first, regression test); gates green (1573 pass); installed on 3737 (client v8); live on the Tailscale origin: typed message → Enter opened the project, checklist add + toggle landed
- [ ] Checkpoint 3: handed to Mark 2026-11-05 — branch tip 0419caa installed on 3737; no push/merge until asked
- [ ] T12 ship: push, PRs, file the D1g host follow-up issue
