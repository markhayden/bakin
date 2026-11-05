# Implementation Plan: Projects — instant start + the "grill me" interview

Spec: `.claude/specs/projects-grill-start.md` (rev 6, Codex-approved
2026-11-04). Plan rev 4 (after Codex plan review rounds 1–3). Code: `bakin-bits-official/plugins/projects`
(0.13.1 → 0.14.0). Bakin host: docs + spec only.

## Overview

Two vertical slices on one branch. **Slice A (instant start):** the create
answers after the file write, the first turn starts detached behind one
fenced `startKickoff` protocol with a retry route and an in-process pump, the
start screen times out honestly, and the project page owns the "starting"
state. **Slice B (the interview):** the create seeds a brief skeleton, the
draft-stage prompt becomes a shaping interview with a stopping rule, the
detail reports whether the brief still lists open questions, and the Start
dialog turns that into an advisory line with "Continue shaping". Dead code
and the async-lock hazard go in the first commit.

## Architecture decisions (from the spec; here for the builder)

- ONE `startKickoff(id)` for every starter (create, Retry, pump, boot sweep):
  in-process ownership set → lock section A (sync: mint `attempt` token,
  `attempts += 1`) → bounded context build (15 s, timeout/rejection is
  terminal: token retired, `lastError`) → lock section B (sync, read-only
  fence check) → `await brainstormTurns.start(...)` OUTSIDE the lock →
  lock section C (sync: fenced `started`, or `lastError`). Ownership released
  in `finally`. Every receipt write emits `projects.changed {action:'kickoff'}`.
- `withProjectLock<T>(fn: () => NotPromise<T>)` — lock bodies are synchronous
  by type. The two asset lookups move before the lock.
- The retry route schedules and answers at once (`202 starting` / `200
  in-flight` / `409 kickoff_not_pending`). The pump and the boot sweep
  dispatch per project with `.catch`, never sequentially awaited.
- `/ask` on a `pending` receipt ⇒ `409 kickoff_pending`; the page's composer
  is disabled while pending (independent of the streaming flag).
- The brief is the plan body; `brief.openQuestions: boolean | null` is
  computed server-side by ONE tolerant parser; the Start dialog relabels
  cancel to "Continue shaping" (no third `ConfirmDialog` action).
- Timers are injectable (`now()` + interval/timer factories in the module's
  options) so unit tests never sleep; the browser 20 s rule is one client
  timer keyed on `created` or the last Retry click.

## Dependency graph

```
T1 lock hygiene (sync lock bodies)
 └─ T2a receipt fields + fenced receipt helpers (pure service + parser round-trip)
     └─ T2b startKickoff protocol + create answers after write + /ask 409
         ├─ T3 retry route + pump + boot sweep dispatch
         │    └─ T5 project page: starting notice, disabled composer, Retry, 20 s rule
         ├─ T4 start screen: timeout + same-requestId retry, complete chips, dead transport removed
         └─ T6 brief skeleton + parser + detail `brief`
              ├─ T7 interview prompt + stopping rule; steward excerpt Plan-first
              └─ T8 Start dialog advisory + "Continue shaping"
T9 docs + version + changelog (after T1–T8)
T10 coverage pass (/agent-skills:test) → T11 Codex code-review rounds (≥2) + fixes → T12 ship
```

## Branch and commit strategy (rollback checkpoints)

- Bits: branch `feat/projects-grill-start` from `main` (8f35416) in the main
  checkout `/Users/roscoe/go/src/github.com/markhayden/bakin-bits-official`
  (the user asked for no worktree so 3737 can test it). Bakin: branch
  `docs/projects-grill-start` from `main` for the spec, this plan and the
  user docs.
- **One commit per task, each green** (`bun run test`, `bun run typecheck`,
  `bun run lint` in bits). Commits inside a phase are dependent increments,
  NOT independently shippable: nothing is installed on 3737 or pushed
  mid-phase, so the detached start (T2b) is never exposed without the
  pending-state UI (T5). The **rollback unit is the phase**: Phase 1 =
  T1–T5, Phase 2 = T6–T8, Phase 3 = T9–T12.
- **Rollback procedure.** Reverts are new commits; history is never rewritten.
  The smallest thing that can be rolled back is a PHASE — a single task is
  never reverted alone, because the tasks of a phase only make sense
  together (T2b's detached start without T5's pending-state UI is exactly
  the combination this plan forbids exposing). To roll back a phase: (1)
  select every commit of that phase; (2) add every later-phase commit that
  depends on it per the graph above (rolling back Phase 1 takes Phase 2 with
  it; rolling back Phase 2 alone is possible); (3) add every coverage or
  review-fix commit whose BEHAVIOUR belongs to the dropped phases (judged by
  what the commit changes, not by file overlap — a fix to the start screen
  belongs to Phase 1 even if it touched `types.ts`); (4) revert them one by
  one, newest first, by explicit sha (`git revert --no-edit <sha>`); (5)
  update the docs commit so README/docs describe the retained behaviour;
  (6) re-run the gates. Unrelated commits stay. `git reset --hard` is NOT
  used. Checkpoint shas are recorded in `todo.md` as the known-good states to
  compare against.
- Conventional commits with the `projects` scope, e.g.
  `fix(projects): lock bodies are synchronous — asset lookups move before the lock`,
  `feat(projects): kickoff receipt attempts, fence token and last error`,
  `feat(projects): the create answers after the write; one fenced start protocol`,
  `feat(projects): kickoff retry route + in-process pump`,
  `feat(projects): the start screen times out honestly; complete starter prompts`,
  `feat(projects): the project page owns the starting state`,
  `feat(projects): the brief skeleton + open-questions parser`,
  `feat(projects): the shaping interview + stopping rule`,
  `feat(projects): Start shows an advisory when the brief lists open questions`,
  `docs(projects): README, UI-AUDIT, changelog for 0.14.0` + `chore(projects): 0.14.0`.
- Coverage-pass and review-fix commits land as
  `test(projects): coverage pass — …` and `fix(projects): review round N — …`,
  never squashed into the feature commits (the audit trail). Review (T11)
  runs AFTER the coverage pass (T10) so the reviewed diff is final; any fix
  that touches a browser surface or the start/interview flow re-runs the
  affected fixture and the live acceptance line before the next round.
- No push, no PR, no merge before Mark's live test on 3737.
- Live install only at checkpoints:
  `bakin plugins install /Users/roscoe/go/src/github.com/markhayden/bakin-bits-official/plugins/projects`
  (copies the source; the lock already records this kind of local install).

## Task list

### Phase 1 — instant start (Slice A)

#### Task 1: Lock bodies are synchronous
**Description:** Make `withProjectLock` reject async bodies at the type level
and move the two `await ctx.assets.getAsset(...)` calls (attach / relink)
before the lock. Foundation for every receipt write in T2.
**Acceptance:**
- [ ] `withProjectLock<T>(fn: () => NotPromise<T>): Promise<T>`; an async body
      fails `bun run typecheck` (pinned by a `// @ts-expect-error` line in
      `tests/service.test.ts`).
- [ ] `attachAsset` / `relinkAsset` resolve the asset first, then take the
      lock for the write; behaviour and errors unchanged (existing tests).
**Verification:** `bun test plugins/projects/tests/service.test.ts plugins/projects/tests/project-conflicts.test.ts`; `bun run typecheck`.
**Dependencies:** none. **Files:** `lib/project-service.ts`, `tests/service.test.ts`. **Size:** S.

#### Task 2a: Kickoff receipt — attempts, fence token, last error
**Description:** `ProjectKickoff` gains `attempts: number` (default 0),
`attempt?: string`, `lastError?: string`; zod schema + serialization
round-trip; the fenced receipt helpers in `project-service.ts` (all
synchronous lock bodies): `beginKickoffAttempt(id)` (section A: `attempts +=
1`, mint `attempt`, return the token or `null` when not pending),
`kickoffOwner(id)` (section B read), `markKickoffStarted(id, requestId,
attempt)` (section C compare-and-set on BOTH), `failKickoffAttempt(id,
attempt, error, { retire })` (token-checked `lastError`, trimmed to 200
chars, optional token retirement), and `resetKickoffAttempts(id)` for Retry.
`advanceKickoff` stays for `started → settled`.
**Acceptance:**
- [ ] All three fields round-trip through `parseProject`/`serializeProject`;
      a receipt without them parses with `attempts: 0`.
- [ ] Each helper is a compare-and-set: a stale token writes nothing and
      returns `false`; `lastError` is trimmed to 200 chars; every helper
      write emits `projects.changed { projectId, action: 'kickoff' }`.
**Verification:** `bun test plugins/projects/tests/service.test.ts plugins/projects/tests/parser.test.ts`; typecheck.
**Dependencies:** T1. **Files:** `types.ts`, `lib/parser.ts`, `lib/project-service.ts`, `tests/service.test.ts`, `tests/parser.test.ts`. **Size:** S.

#### Task 2b: The create answers after the write; one fenced start protocol
**Description:** `startKickoff` becomes the spec's eight-step protocol with
injectable `now`/`timeout`; the create route writes, answers `200`, then
calls `startKickoff` detached with `.catch`; `/ask` answers `409
kickoff_pending` while pending. The `kickoff_pending` 503 on create is removed.
**Acceptance:**
- [ ] `POST /` answers `200 { id, created }` in under 100 ms (asserted) with a
      turn service whose `start` never resolves; the receipt is `pending`,
      `attempts: 1`, `attempt` set.
- [ ] Happy path flips `pending → started → settled` with exactly one engine
      call and `started` written only after `accepted`; a retried create
      (same requestId) returns the same id and never a second turn.
- [ ] A refused (`not_found`/`busy`/`closed`) or thrown admission persists
      `lastError` (trimmed) and `pending`; a failed `started` write after an
      accepted admission is repaired by the next attempt from the transcript
      (one user row, no second engine call).
- [ ] Context build timeout and immediate `derive` rejection (through
      create) record `lastError`, retire the token, release ownership, and
      the next attempt admits; A-resumes-before-any-B and A-resumes-after-B
      both make no engine call; one user row.
- [ ] A hung admission does not block creating another project; `/ask` on a
      pending receipt ⇒ 409; every receipt transition emitted
      `projects.changed`.
**Verification:** `bun test plugins/projects/tests/routes.test.ts`; typecheck; lint.
**Dependencies:** T2a. **Files:** `index.ts`, `tests/routes.test.ts`. **Size:** M.

#### Task 3: Retry route + in-process pump + independent boot dispatch
**Description:** `POST /:projectId/kickoff` (manifest `apiRoutes` entry) that
schedules and answers at once; a 30 s pump (injectable interval) retrying
`pending` receipts with `attempts < 3` older than 10 s, per-project
fire-and-forget; the boot sweep uses the same dispatch.
**Acceptance:**
- [ ] Route answers `409 kickoff_not_pending` / `200 in-flight` / `202
      starting`; `202` resets `attempts` and clears `lastError`; answers in
      under 100 ms (asserted) even when the scheduled admission hangs; an
      immediate `derive` rejection through Retry leaves a visible
      `lastError`, released ownership, and the next Retry admits.
- [ ] Pump: retries up to three times then stops; A's admission never
      resolves while B is started by the same tick and the next tick still
      runs; timer starts in `activate`, stops in `onShutdown`; boot sweep
      uses the same per-project dispatch (A hung, B still resumed).
- [ ] `tests/manifest-contract.test.ts` still passes (route declared).
**Verification:** `bun test plugins/projects/tests/routes.test.ts plugins/projects/tests/manifest-contract.test.ts`; typecheck; lint.
**Dependencies:** T2b. **Files:** `index.ts`, `bakin-plugin.json`, `tests/routes.test.ts`. **Size:** M.

#### Task 4: Start screen — honest timeout, complete chips, dead transport removed
**Description:** `AbortSignal.timeout(10_000)` on the create; inline error
with retry on the SAME requestId; the six starters become complete prompts;
`hooks/use-conversation-stream.ts` deleted together with every type that
existed only for it (its own `ConversationStreamOptions`/`ConversationStream`
interfaces and any stream-only type left in `types.ts`).
**Acceptance:**
- [ ] A chip fills its complete prompt; Enter creates and `router.push`es on
      200 without any other wait.
- [ ] A create that never answers shows the inline error after the timeout,
      keeps the text, and the retry sends the SAME `requestId`.
- [ ] `use-conversation-stream.ts` is gone, nothing imports it, and no
      type that served only that transport remains (grep `ConversationStream`).
**Verification:** `bun test plugins/projects/tests/start-screen.test.tsx`; typecheck; lint.
**Dependencies:** T2b (contract). **Files:** `components/start-screen.tsx`, `lib/start.ts`, `hooks/use-conversation-stream.ts` (deleted), `types.ts`, `tests/start-screen.test.tsx`. **Size:** S.

#### Task 5: The project page owns the starting state
**Description:** While `kickoff.state === 'pending'`: composer disabled with
the status line; the notice bar (Plan-updated composition) shows "Starting
the conversation…" with a working marker, or "The conversation hasn't started
yet" + Retry when `lastError` is set or 20 s passed since `created` / the
last Retry click; Retry posts T3's route and handles `202` / `in-flight`.
**Acceptance:**
- [ ] Pending ⇒ disabled composer + starting notice; `lastError` ⇒ Retry
      notice (composer still disabled); 20 s rule via injectable `now`.
- [ ] Retry `202` restarts the timer and shows "Starting…" again;
      `in-flight` shows "Still starting — the first attempt is running".
- [ ] `started` ⇒ nothing extra; a streaming started turn offers Stop.
**Verification:** `bun test plugins/projects/tests/project-detail.test.tsx`; typecheck; lint.
**Dependencies:** T3. **Files:** `components/project-detail.tsx`, `types.ts`, `tests/project-detail.test.tsx`. **Size:** S–M.

### Checkpoint 1 — instant start
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` green (bits).
- [ ] Reinstall on 3737; chip → Enter opens the page in < 1 s; the notice
      shows then clears; the lead replies; Stop the reply settles a turn.
- [ ] Commit sha recorded as the Phase 1 rollback point.

### Phase 2 — the interview (Slice B)

#### Task 6: Brief skeleton, open-questions parser, `brief` on the detail
**Description:** `BRIEF_SKELETON` constant; `kickoffProject` seeds it as the
initial body (revision 0, no snapshot); `lib/brief.ts` with
`briefOpenQuestions(body): boolean | null`; `GET /:projectId` adds
`brief: { openQuestions }`; `ProjectDetailData.brief`.
**Acceptance:**
- [ ] A kickoff-created project's body is the skeleton; a title-only create
      and `bakin_exec_projects_create` keep an empty body; `planRevision`
      stays 0 and history is empty after seeding.
- [ ] Parser: seeded ⇒ true; blank section ⇒ false; `-`/`*`/`+`/`1.`/`1)`
      lists ⇒ true; prose, mixed, sub-headed ⇒ null; no heading ⇒ null.
- [ ] Detail carries `brief.openQuestions` matching the parser.
**Verification:** `bun test plugins/projects/tests/brief.test.ts plugins/projects/tests/service.test.ts plugins/projects/tests/routes.test.ts`.
**Dependencies:** T2b. **Files:** `lib/start.ts`, `lib/brief.ts` (new), `lib/project-service.ts`, `index.ts`, `types.ts`, `tests/brief.test.ts` (new), `tests/service.test.ts`, `tests/routes.test.ts`. **Size:** M.

#### Task 7: The shaping interview + stopping rule; steward reads the plan first
**Description:** Rewrite the draft-stage posture in `lib/brainstorm-prompt.ts`
(five areas in order, at-most-one card with a recommendation, simplify
tangled answers, checkpointed brief updates keeping every heading, the four
blocking gaps, convergence after the draft, "just write it"); the steward's
plan excerpt renders `## Plan` first under the same cap.
**Acceptance:**
- [ ] Prompt tests pin: the five areas in order; "at most one" card; the
      recommendation rule; the four blocking gaps; the convergence rule; the
      "just write it" rule (blockers stay under Open questions); labelled
      assumptions; steps via `checklistItems`; the kept headings; `live:
      false` ⇒ no card tool; every stage keeps the authority line; the
      active/completed/archived postures are byte-for-byte unchanged (pinned)
      and the steward's instruction block is unchanged (only the excerpt
      order moves).
- [ ] Steward test: a body whose Plan section sits last still puts it first
      in the excerpt; cap + omission marker unchanged.
**Verification:** `bun test plugins/projects/tests/brainstorm-prompt.test.ts plugins/projects/tests/steward-*.test.ts`.
**Dependencies:** T6 (headings). **Files:** `lib/brainstorm-prompt.ts`, `lib/steward/prompt.ts`, `tests/brainstorm-prompt.test.ts`, a steward test. **Size:** S.

#### Task 8: Start dialog advisory + "Continue shaping"
**Description:** `nextStepFor` adds the advisory line when
`brief.openQuestions === true` and relabels cancel to "Continue shaping";
`ProjectHeader` gets `onContinueShaping`, wired by `ProjectDetail` to
`selectTab('conversation')`. Null/false ⇒ today's dialog.
**Acceptance:**
- [ ] Advisory + "Continue shaping" only when `openQuestions === true`;
      "No steps yet" stays its own line.
- [ ] "Continue shaping" closes the dialog, launches no turn and the
      Conversation tab is selected.
**Verification:** `bun test plugins/projects/tests/project-header.test.tsx plugins/projects/tests/project-detail.test.tsx`.
**Dependencies:** T6. **Files:** `components/project-header.tsx`, `components/project-detail.tsx`, `tests/project-header.test.tsx`. **Size:** S.

### Checkpoint 2 — interview
- [ ] bits `bun run test` / `typecheck` / `lint` / `build` green.
- [ ] Bits browser fixtures under the real SDK (`PROJECTS_UI_SURFACE=start|conversation`, desktop + mobile) and bakin `bun run ui:conformance --quick`.
- [ ] Reinstall on 3737; live acceptance matrix (each a fresh project):
      1. Vague idea ("Help me plan a trip.") — the Plan tab shows the seeded
         brief; the lead orients + reflects + ONE card with a recommendation;
         the brief fills as decisions land; after the four blockers close it
         drafts (Plan section + steps appear), labels assumptions, and asks
         again only for a material change (convergence).
      2. "Just write it" as the second message — immediate draft (Plan
         section + checklist steps created); unresolved blockers remain under
         Open questions; assumptions labelled.
      3. A fresh project whose FIRST message is "Plan a trip — just write
         it." — immediate draft, no question card; unresolved blockers under
         Open questions; assumptions labelled; steps created.
      4. A first message that already answers all four blockers — a draft,
         no card.
      5. Start on a project with open questions — the advisory line +
         "Continue shaping" returns to the Conversation tab; Start on a
         project whose Open questions section is blank — no advisory.
- [ ] Commit sha recorded as the Phase 2 rollback point.

### Phase 3 — docs, version, review, coverage

#### Task 9: Docs + version + changelog
**Description:** README (Starting a project, Working with the lead, Plan,
Tests), UI-AUDIT (start screen + notice + dialog rows), CHANGELOG
`[Unreleased]` entry, manifest `0.14.0`; bakin `docs/using/projects.md`
("Starting a project", "Shaping it with the lead"), `projects-revamp.md`
D7/D8/D14 marked superseded, spec status → FINAL.
**Acceptance:** every behaviour in the spec's decisions is described once in
README/docs; no stale "kickoff_pending on create" or "3–5 questions" copy remains.
**Verification:** `grep` for the retired phrases; bits `bun run lint`; bakin docs build if cheap (`bun run docs:build` or skip with a note).
**Dependencies:** T1–T8. **Files:** bits README/UI-AUDIT/CHANGELOG/manifest; bakin docs + specs. **Size:** M.

#### Task 10: Coverage pass (`/agent-skills:test`)
**Description:** Walk the spec's Testing strategy and success criteria against
the suite; add missing cases (especially the fence orderings, the pump
isolation and the parser matrix); run the full bits suite once more. Lands
as `test(projects): coverage pass — …` commits BEFORE review so the reviewed
diff is final.

#### Task 11: Codex code review (two rounds minimum)
**Description:** `codex exec` reviews of the full bits diff against the spec;
fix every real finding in-batch as `fix(projects): review round N — …`
commits; repeat until a clean round. A fix touching a browser surface or the
start/interview flow re-runs the affected fixture and live acceptance line.
**Verification:** round outputs saved under the scratchpad; all gates green after fixes.

#### Task 12: Ship
**Description:** When Mark's live test passes: push the bits branch, open the
PR (spec link, acceptance evidence), file the Bakin follow-up issue for the
host-side stuck-turn watchdog / cancellable admission (spec D1g — the spec
requires it filed when this ships), and open the bakin docs PR.

### Checkpoint 3 — handoff
- [ ] All gates green; Mark's live test on 3737; then T12.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Timers in tests (pump, 20 s rule) flake or sleep | Med | Injectable `now`/interval; no real waits; `waitUntil`-style polling only on state |
| The bounded context build leaves a stale `derive` running in tests | Low | Tests await the stale promise through a captured resolver; fence asserted by engine call count |
| `ConfirmDialog` stub in `test-sdk` lacks `cancelLabel` wiring | Low | Stub already renders `cancelLabel`; verified |
| Prompt wording tests pin strings, not behaviour | Med | Checkpoint 2's live matrix covers the vague first message, "just write it" as first AND second message, and a fully specified first message |
| Reinstalling on 3737 disturbs Mark's running state | Low | Install is a replace transaction with rollback; done only at checkpoints |
| Brief skeleton surprises the steward's excerpt | Low | T7 puts `## Plan` first; test |

## Open questions

None for the user. Builder decisions left to implementation: exact helper
names in `project-service.ts`; whether the pump and the 20 s rule share one
tiny `timers` option type.
