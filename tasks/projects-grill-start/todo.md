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
- [x] T11e Codex round 3 on 0419caa: 2 findings on the reload-retry contract (empty composer hid the pending retry; pending had no owner) → c20b361 (owner in the pending record, message + lead restored on mount, retry sends the recorded owner; 2 tests); gates green (1575 pass); installed on 3737 (client v9)
- [x] T11f Codex round 4 on c20b361: 2 findings (an edit before a retry lost on reload; a saved composer draft hid the pending send) → pending record carries `edited`, the composer shows the latest text after a reload, and an "unconfirmed send" notice stays until a create succeeds; test composer restores saved drafts; 2 tests; gates green (1577 pass)
- [x] T11g Codex round 5 on 68313e1: 1 finding (notice hidden behind a retry error; set only on remount) → fa74f32 (notice renders on its own below the error; `unconfirmed` follows the pending record after every attempt; 2 tests); gates green (1579 pass); installed on 3737 (client v11)
- [x] T11h Codex round 6 on fa74f32: APPROVE, no findings (2026-11-05 14:40 MST)
- [ ] Checkpoint 3: handed to Mark 2026-11-05 14:40 MST — branch tip fa74f32 (Codex-approved) installed on 3737 (client v11); Mark re-tests on the Tailscale origin; no push/merge until asked
- [ ] T12 ship: push, PRs, file the D1g host follow-up issue

- [x] T11i — one text field on the question card (bakin 9ce2604aa on
  `fix/question-card-one-field`, bits e578691): Codex 2 rounds (r1 two
  findings fixed, r2 APPROVE); live on 3737 (vendor rebuilt, projects
  client v12); the `ask_user` description change needs a server restart.
- [x] T11j — resizable conversation dock + one Files empty state (bakin
  a9bfcb5bb, bits f984bc8): Codex 5 rounds, round 5 APPROVE; live on 3737
  (vendors rebuilt, projects client v14).
- [x] T11k — live round 2 (2026-11-11, Mark: "only asked like 7 questions… turn all
  stones"; raw markdown in user bubbles; "stuck… not triggering more questions";
  question and answer duplicated; cards flash off and on at settle; "two turns in a
  row its stuck"): bits c2f983b (depth prompt: six areas, every decision asked and
  tested, 15–30 questions, a request for more questions re-opens the interview with
  a card that turn; `renderText` → MarkdownContent) + bakin 0058b9f2d (UserMessage
  renderText), f00ac334b/99abab358 (card keeps the question, bubble keeps the
  answer via `displayContent`), c9f77bea8 (settle keeps the live turn until its
  rows arrive; `agent-<n>` key), 51f09309b + e14df3323 (an empty completion is
  nudged once inside the turn, twice → `empty_reply` error row; billed usage
  metered on the error path — root cause: two empty model completions in the Pi
  session, `stop=stop out=4`). Codex: bits r1 (4 findings → 3a0ba7c: the re-open
  rule follows the transport, settled-decision rule, stub honours renderText), r2
  APPROVE; bakin r1 (8 findings → 5d59a1284: nudge keeps its session on ephemeral
  threads, retained live turn scoped to one settle, one reply answers one card,
  QuestionCards story renders the folded exchange, actRender), r2 (4 findings →
  settle refetch owed + replacement load, optimistic rows reconciled, meter once,
  the stale-load test rejects), r3 pending. Also ea4292b32: `max-w-1/2` for the
  unmeasured aside cap (legacy ratchet) + two exception reviews renewed to
  2027-01-31 (dnd-card expired 2026-11-09, reactflow 2026-11-12 — main fails the
  quick gate without it).

