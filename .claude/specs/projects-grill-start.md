# Spec: Projects — instant start + the "grill me" interview

Status: FINAL rev 7 (2026-11-04; Codex-approved at rev 6 after six review
rounds; rev 7 records the as-built notes below). Owner: Mark.
Builds on `projects-revamp.md` (D7–D18 start screen + staged posture). Code
lives in the external `bakin-bits-official` repo, `plugins/projects`
(0.13.1 → 0.14.0); no Bakin host code changes are expected (see Assumptions).

## Objective

Two user complaints about starting a project:

1. **"I click a starter and hit Enter and it spins forever."** The start
   screen's create request does not answer until the server has written the
   project AND the turn engine has admitted the lead's first turn. Admission
   waits on a global in-process project lock and on the runtime; the client
   has no timeout. Any stall anywhere pins the start screen on a spinner with
   no error and no way out. (A live reproduction on the current build worked
   end to end in ~20 s; the historical failure is a pre-release build whose
   turn never settled and logged nothing. The structural risk is real either
   way: the user's first impression must never depend on model latency.)
2. **"After the idea, grill me."** The lead's draft-stage posture asks a
   question card per turn and drafts after three to five questions. It
   should run a real shaping interview — the way the repo's `/kickoff`
   command interviews: one question at a time with a recommended answer, walk
   dependent decisions in order, reframe complicated things into simple
   choices, and close the gaps in the goal and the plan before drafting.

Success for the user:

- Enter on the start screen opens the project page immediately; the
  conversation visibly starts there. A failure to start is shown in-page with
  a retry — never a spinner that outlives the request.
- The lead interviews toward a plan: the Plan tab shows a brief taking shape
  while the questions land, drafting happens once the blocking gaps are
  closed, assumptions are labelled, and "just write it" always works.
- Less code, not more: dead compatibility code goes, and no new tools,
  schema or UI surfaces are added for the interview.

## Decisions (from the 2026-11-04 interview; each question was run past Codex)

### Part 1 — the start flow

- **D1. Enter opens the project at once; the first turn starts detached.**
  `POST /` with `requestId` + `firstMessage` writes the project and its
  kickoff receipt (milliseconds) and answers `200 { id, created }`. It then
  calls `startKickoff(id)` WITHOUT awaiting it. The `kickoff_pending` 503 on
  create is gone.
- **D1a. The client never spins forever.** The create request carries
  `AbortSignal.timeout(10_000)`. On timeout or failure the start screen shows
  the inline error ("Projects did not answer. Retry — your text is kept.") and
  the retry re-sends the SAME `requestId` (a timeout does not prove the create
  failed; the receipt dedupes). The `sessionStorage` pending record stays as
  today.
- **D1b. One start protocol, exactly once.** All starters — the detached
  launch, the pump (D1d), the page's Retry (D1c) and the boot sweep — call
  ONE `startKickoff(id)`:
  1. In-process ownership: a `startingKickoffs` set; a second caller while
     one runs returns `'in-flight'` (as today).
  2. Lock section A (synchronous, the lock is released before any await):
     read the receipt; not `pending` ⇒ `'started'` (nothing to do). A
     transcript with ≥1 row is proof the engine already accepted an earlier
     attempt ⇒ write `started`, return (as today). Otherwise write
     `attempts += 1` and mint `attempt: <uuid>` on the receipt — this
     attempt's fence token.
  3. Outside the lock, build the turn context (`derive` reads the board) under
     a **15 s bound** (`Promise.race`). Timed out OR rejected ⇒ TERMINAL for
     this attempt: under the lock (token-checked) write `lastError`
     ('context build timed out' / the error message) and clear `attempt`
     (the token is retired, so NO attempt owns the kickoff), release
     `startingKickoffs` (ownership is released in a `finally` on every path,
     including throws), return `'pending'`. A stale build that is still
     running after a timeout has only step 4 as its continuation, which
     refuses it:
  4. Lock section B (synchronous, read-only): re-read the receipt;
     `state !== 'pending'` or `attempt !== <my token>` ⇒ `'superseded'` —
     return without touching the engine. A retired token (step 3) and a
     successor's token both fail this check, so a timed-out attempt can never
     reach admission whether it resumes before or after another attempt
     (both orderings are tested). The lock is released here.
  5. OUTSIDE the lock, `await brainstormTurns.start(...)` — NOT bounded: the
     engine reserves the thread slot and appends the user row synchronously
     after its own awaits (`resolveThread`, pending flushes), and a hang in
     there is a host-level outage this spec does not paper over (D1g). The
     `startingKickoffs` ownership is held until this settles, so every other
     caller gets `'in-flight'` meanwhile, and no project write waits on it
     (tested: another project is created while an admission hangs).
  6. Lock section C (synchronous): `'accepted'` ⇒ write `started`
     (compare-and-set on requestId AND `attempt`; a failed or skipped write is
     repaired by step 2 next time). Refused or thrown ⇒ write `lastError`
     (message trimmed to 200 chars) and return `'pending'`.
  7. Every receipt write emits `projects.changed { projectId, action: 'kickoff' }`
     so an open page refetches.
  8. `startKickoff` never rejects for a reason it can record (steps 3 and 6
     persist it); every detached caller — the create route, the Retry route,
     the pump, the boot sweep — still attaches a `.catch` that logs, so no
     launch can become an unhandled rejection. Tested through create and
     Retry: `derive` rejects immediately ⇒ `lastError` visible, ownership
     released, the next attempt succeeds.
  Sequential duplicates are impossible: an attempt that resumes after its
  context-build bound finds a different `attempt` token (step 4) and stops;
  two attempts never reach step 5 for the same token; in-process ownership
  (step 1) means only one attempt is ever between steps 4 and 6; the engine
  refuses an overlapping turn (`busy`). Tested explicitly: A times out in the
  context build, B runs the turn to completion, A resumes ⇒ no engine call,
  one user row.
  While the receipt is `pending`, `POST /:projectId/ask` answers `409
  kickoff_pending` (server-side exclusion) and the page's composer is
  disabled with the reason (D1e) — there is no competing `/ask`, so no
  supersession protocol exists. The receipt keeps the first message until the
  turn settles, as today.
- **D1c. Retry route — schedules, never waits.** `POST /:projectId/kickoff`:
  `409 kickoff_not_pending` when the receipt is not `pending`; `200 { state:
  'in-flight' }` when an attempt already owns it (`startingKickoffs`);
  otherwise it resets `attempts` to 0, clears `lastError`, calls
  `startKickoff` WITHOUT awaiting it and answers `202 { state: 'starting' }`
  at once. The outcome reaches the page through the receipt's
  `projects.changed` refetches (D1e) — a Retry whose admission hangs still
  answers in milliseconds (tested). No operator declaration is required (it
  starts the user's own first message; it mutates no content).
- **D1d. In-process recovery.** A kickoff pump — a 30 s interval timer
  started in `activate`, stopped in `onShutdown`, independent of the steward
  loop — runs `startKickoff` for every `pending` receipt with `attempts < 3`
  whose `created` is older than 10 s. Attempts are dispatched
  INDEPENDENTLY (fire-and-forget per project, each with its own rejection
  handler that logs; never `await`ed in sequence and never collected with
  `Promise.all`), so one project's hung admission blocks neither the other
  projects in the tick nor the next tick (the timer never waits on a tick's
  attempts). The boot sweep adopts the same independent dispatch. Past three
  attempts only the page's Retry tries again. Tested: A's admission never
  resolves, B is still started by the same tick and stays eligible on later
  ticks.
- **D1e. The project page owns the starting state.** The receipt gains
  `attempts: number` (default 0), `attempt?: string` (the fence token) and
  `lastError?: string`; `GET /:projectId` already exposes `kickoff`. The
  page derives, from the loaded project plus `projects.changed` refetches:
  - `kickoff.state === 'pending'` → **starting**: the composer is
    `disabled` (the kit's existing disabled state) with the status line
    "Starting the conversation…" — independent of the streaming flag, which
    stays whatever the server reports. The notice bar above the composer (the
    "Plan updated" composition: `StatusMarker` + `Text` + ghost `Button`)
    shows "Starting the conversation…" with a working marker, and swaps to
    "The conversation hasn't started yet" + **Retry** when `lastError` is set
    or when 20 s have passed since `created` or since the last Retry click
    (one client timer; re-evaluated on every refetch). Retry posts D1c and
    always works, however many attempts ran: `202` restarts the 20 s timer
    and shows "Starting the conversation…" again; `in-flight` shows "Still
    starting — the first attempt is running"; a later `lastError` on the
    refetch brings Retry back.
  - `started` → the server's `brainstormStreaming` governs, as today (a turn
    that errors writes an error row and the done/error events settle the
    thread; a crash is settled by the boot sweep and shows the user's row
    with no reply, composer enabled).
  - `settled` → nothing; today's behaviour.
- **D1f. Lock hygiene.** `withProjectLock` bodies become synchronous: the
  two asset-attach paths that `await ctx.assets.getAsset(...)` inside the lock
  resolve the asset BEFORE taking it. The signature becomes
  `withProjectLock<T>(fn: () => NotPromise<T>): Promise<T>` with
  `type NotPromise<T> = T extends PromiseLike<unknown> ? never : T` — an
  async body infers `T = Promise<…>`, the parameter collapses to `() => never`
  and the call fails to type-check; a `// @ts-expect-error` test pins it. (A
  hung assets/search call inside the lock was the one way every project
  write — including create — could wedge silently.)
- **D1g. A turn that never settles (execution, not admission).** Once the
  receipt is `started` the first turn is an ordinary conversation turn: the
  composer shows **Stop the reply** (the engine's `abort` → the runtime's
  session abort → the turn settles clean with an aborted row) and the
  composer re-enables. The host has no execution deadline for conversation
  turns (verified: none in `turns.ts`), and the Pi runtime honours abort only
  between steps — a tool call that never returns cannot be interrupted from
  the plugin. That is host work and OUT OF SCOPE here; it is recorded as a
  follow-up issue ("bounded conversation turns / stuck-turn watchdog") rather
  than hidden. The live acceptance test verifies Stop settles a running turn.
- **D2. Chips stay pre-fill, as complete prompts.** Each starter is a full
  editable sentence that works as-is on Enter; the lead's interview draws out
  specifics. One submission rule: chips fill, Enter creates and opens. The six:
  "Help me clean up my email inbox." · "Help me plan and ship a new feature
  for my app." · "Help me plan a trip." · "Help me launch a newsletter." ·
  "Help me get my files organized." · "Help me research a big purchase."
  The fallback title stays the first message trimmed to 60 chars.
- **D2a. Dead code goes.** `hooks/use-conversation-stream.ts` (the
  per-request SSE "compatibility transport", unused since bakin#703) is
  deleted with its types.

### Part 2 — the interview

- **D3. The interview lives in the prompt; the brief lives in the plan body.**
  The draft-stage posture in `lib/brainstorm-prompt.ts` becomes a shaping
  interview. The lead keeps the plan document itself as a structured brief it
  fills through the existing `bakin_exec_projects_apply_plan` tool. No new
  tools, frontmatter or UI for the interview. Every brief edit is an ordinary
  plan revision (snapshot, diff, "Plan updated" dot) — the Plan tab IS the
  progress indicator.
- **D4. Interview protocol (the prompt).** Five areas, in order, skipping
  what the user already answered and following dependencies between
  decisions:
  1. **Goal** — what they want and why (one sentence they would agree with).
  2. **What success looks like** — concrete and observable; this IS the
     definition of done (one section, one gap).
  3. **Scope** — in and out; the smallest version that still counts.
  4. **Constraints and dependencies** — time, money, people, tools, what has
     to be true first.
  5. **Risks and open questions** — what could make this fail; what's unknown.
  Rules: AT MOST one `bakin_exec_ask_user` card per turn (none when nothing
  material is open, or when the user said "just write it"); 2–5 mutually
  exclusive options; ALWAYS mark the recommended one and say why in a clause;
  when the user's answer is tangled, reflect it back as two or three simpler
  choices; ask only what would materially change the plan; never ask two
  things at once; prefer the question whose answer unlocks the most other
  decisions. The first reply orients in one line ("I'll ask one question at a
  time; say 'just write it' whenever you want the plan drafted.").
- **D4a. Brief updates are checkpointed.** The lead updates the brief after a
  decision lands (a resolved section, not every reply), rewriting the body
  with `apply_plan.body` while keeping every heading. Answered questions move
  out of "Open questions"; new unknowns move in.
- **D4b. Stopping rule.** The blocking gaps are the first four areas: goal,
  what success looks like, the scope boundary, and hard constraints /
  dependencies. Once they are closed the lead drafts: fills "Plan" (approach,
  phases) and adds the steps via `checklistItems`, says "Draft plan is ready
  in the Plan tab", and lists the assumptions it carried. Non-blocking
  unknowns ride into the draft under "Constraints and assumptions" as
  labelled assumptions. After the draft the lead asks again ONLY if the
  answer could change scope, feasibility, sequencing or success criteria;
  otherwise it says the plan is ready and summarises the assumptions —
  interviewing is never an obligation to keep generating questions.
  "Just write it" / "draft with what we know" drafts at once, keeping
  unresolved blockers under "Open questions" rather than inventing answers.
- **D5. Start stays the user's call; the dialog gets an advisory line.** The
  detail carries `brief: { openQuestions: boolean | null }`, computed on the
  server by ONE tolerant parser over the body's `## Open questions` section
  (text up to the next `## ` heading): `null` when the heading is absent;
  `false` when the section is blank; `true` when every non-blank line is a
  markdown list item (`-`, `*`, `+`, `1.`, `1)`); `null` when any non-blank
  line is not a list item (prose, a sub-heading — unrecognised content is
  "unknown", never "resolved"). The seeded placeholder is a list item and
  therefore counts — it is unresolved until the lead rewrites it. `null` shows
  nothing: parsing doubt never adds a claim. No count is ever shown. When
  `openQuestions === true` the Start confirm adds "The brief still lists open
  questions. Start anyway?" and relabels cancel **Continue shaping**
  (`cancelLabel`); choosing it closes the dialog and selects the Conversation
  tab (no turn is launched). `null`/`false` ⇒ today's dialog. "No steps yet"
  stays its own line. `ConfirmDialog` has no third action and none is added.
- **D6. The create seeds the brief skeleton.** `kickoffProject` writes this
  body (revision 0, no snapshot — it is the initial content):

  ```markdown
  # Brief

  ## Goal
  _Not yet discussed._

  ## What success looks like
  _Not yet discussed._

  ## Scope
  ### In
  _Not yet discussed._
  ### Out
  _Not yet discussed._

  ## Constraints and assumptions
  _Not yet discussed._

  ## Open questions
  - Goals, scope and constraints still need clarification.

  ## Plan
  _Drafted once the open questions are settled._
  ```

  The plain `POST /` (title-only create, CLI/tool path) and
  `bakin_exec_projects_create` keep an empty body — only the start-screen
  kickoff seeds the brief. The prompt names the headings the lead must keep;
  the parser tolerates drift (missing heading ⇒ `null`).
- **D7. The steward reads the plan first.** The steward's plan excerpt
  (4 000 bytes, `lib/steward/prompt.ts`) renders the `## Plan` section first
  and the rest of the body after it, under the same cap with the same
  omission marker — so a long brief never crowds the actionable plan out of
  a check-in. Active/completed/archived postures are otherwise unchanged.
  Relayed (`live: false`) asks keep plain-text questions, no card tool.

## As built (rev 7 notes)

- **D1e composition.** The kit's `ConversationPanel` exposes no composer
  `disabled` pass-through, so the starting state composes the panel's own
  read-only state: `readOnly` while the receipt is pending, with the status
  (`StatusMarker` + `Text` + ghost `Button` Retry) as the `readOnlyNotice` in
  the composer's slot. No composer is mounted until the turn is admitted;
  `/ask` is refused server-side meanwhile (409). A kickoff receipt change
  (`projects.changed { action: 'kickoff' }`) refetches the project AND the
  conversation thread, so the user's first message and the working state
  appear the moment the turn is admitted.
- **Receipt fields.** `attempts` is optional on the type (absent reads as 0)
  so a settled receipt keeps only its dedupe identity, as before.
- **Brief module.** The skeleton and the parser live together in
  `lib/brief.ts`; the steward's plan-first excerpt is `planFirst()` in
  `lib/steward/prompt.ts`.
- **Interview prompt.** The draft stage uses its own ask line (at most one,
  always with a recommendation and why); the active stage keeps the previous
  ask line byte for byte, pinned by test.
- **Retry is atomic (Codex code review round 1).** The route checks
  ownership and `pending` and dispatches in one synchronous block; the
  attempt resets the count and drops `lastError` inside lock section A
  (`beginKickoffAttempt(id, { reset: true })`), so two Retries at once launch
  one attempt and the other answers `in-flight`. The boot sweep skips a
  pending receipt at three attempts — a restart is not a Retry.
- **Assume, don't ask (live acceptance).** The interviewed lead asked for the
  travel year, exact dates and which days count as travel days; the prompt
  now prefers a labelled assumption to a question whenever the plan would
  have the same shape either way, and a first message that already covers
  the four blocking areas drafts in that same turn (a feasibility risk goes
  into the draft as an open question). Verified live: the fully specified
  first message then produced a draft with four steps and no card.
- **The cap lives in the protocol (Codex code review round 2).** The
  three-attempt cap is checked inside `startKickoff` after the transcript
  repair, so a capped receipt whose turn ran is still repaired, and a
  replayed create, the pump and the boot sweep all stop at the cap; only
  Retry (`reset`) passes it.
- **Timers.** `kickoffTiming` (context build 15 s, pump 30 s, min age 10 s,
  three attempts) is an exported mutable object tests shorten; the page's
  stale window is a `kickoffStaleMs` prop (default 20 s); the start screen's
  timeout is a `createTimeoutMs` prop (default 10 s).

## Assumptions (correct me before build)

1. No Bakin host change is needed: `ctx.conversations` turn service (start /
   waitFor / abort), `bakin_exec_ask_user`, `ConfirmDialog.cancelLabel`,
   `StatusMarker`, the notice-bar composition and `useConversationThread`'s
   `streaming` seed all exist today (checked in source). The 15 s bound
   covers the plugin's own context build only; admission is never bounded or
   cancelled from the plugin.
2. The installed plugin on 3737 is a local copy from the `bakin-bits-wt-b0m`
   worktree; testing live means reinstalling from the main bits checkout
   (`bakin plugins install <path>`). The bits checkout is `main` at
   `8f35416` (fast-forwarded today).
3. The plugin version bumps to **0.14.0** (substantial behaviour change) in
   the same PR; `package.json`'s version is vestigial.
4. Residual, accepted and visible: a hang INSIDE the engine's admission
   (`resolveThread` → the runtime's agent list, or a pending transcript
   flush) is a host-level outage; the page shows "Still starting" and Retry
   answers `in-flight`. A hang in the plugin's own context build is bounded
   and fenced (D1b). A turn that never settles after admission is D1g.

## Tech stack

Bun 1.4.3 · TypeScript strict · React 19 · `@makinbakin/sdk` focused
entrypoints (`/ui`, `/patterns`, `/conversation`, `/navigation`, `/hooks`,
`/utils`) · zod at boundaries · `bun:test` with the `test-sdk/` stubs.

## Commands

```sh
# bits repo: /Users/roscoe/go/src/github.com/markhayden/bakin-bits-official
bun install                      # after pulling; refreshes the test-sdk copy
bun run test                     # NOT bare `bun test` (preloads test/setup-dom.ts)
bun test plugins/projects/tests/routes.test.ts            # one file
bun run typecheck
bun run lint
bun run build                    # compile check
# browser conformance (real SDK):
BAKIN_SDK_PACKAGE_DIR=<assembled sdk> bun run ui:conformance
# bakin repo (docs + quick UI gate): /Users/roscoe/go/src/github.com/markhayden/bakin
bun run ui:conformance --quick
# live test on 3737 (the only user's instance):
bakin plugins install /Users/roscoe/go/src/github.com/markhayden/bakin-bits-official/plugins/projects
```

## Project structure (files this spec touches)

```
bakin-bits-official/plugins/projects/
  bakin-plugin.json              version 0.14.0; new apiRoute POST /:projectId/kickoff
  index.ts                       create answers after the write; detached bounded start; kickoff
                                 pump; POST /:projectId/kickoff; brief.openQuestions on the detail
  lib/start.ts                   complete starter prompts; BRIEF_SKELETON
  lib/brief.ts                   NEW: briefOpenQuestions(body): boolean | null (pure, tolerant)
  lib/brainstorm-prompt.ts       the shaping interview + stopping rule
  lib/project-service.ts         kickoffProject seeds the brief; receipt attempts/lastError;
                                 synchronous lock bodies (assets resolved outside)
  lib/parser.ts                  kickoff schema gains attempts/attempt/lastError (all round-trip)
  lib/steward/prompt.ts          plan excerpt renders ## Plan first
  types.ts                       ProjectKickoff + ProjectDetailData.brief
  components/start-screen.tsx    timeout + inline retry (same requestId)
  components/project-detail.tsx  starting / hasn't-started notice; Retry; Continue shaping
  components/project-header.tsx  advisory line + cancelLabel
  hooks/use-conversation-stream.ts   DELETED
  tests/…                        see Testing
  README.md, UI-AUDIT.md         updated
bakin/docs/src/content/docs/using/projects.md   "Starting a project" + "Shaping it" rewritten
bakin/.claude/specs/projects-revamp.md          D7/D8/D14 marked superseded by this spec
```

## Code style

Existing plugin conventions (kebab-case files, `const`, typed errors by
`code`, comments that say why). One representative snippet — the tolerant
brief parser:

```ts
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/

/**
 * Whether the brief still lists open questions. null = unknown: no heading, or
 * content the parser does not recognise (prose, a sub-heading) — doubt never
 * reads as "resolved".
 */
export function briefOpenQuestions(body: string): boolean | null {
  const section = sectionUnder(body, 'Open questions')   // text up to the next "## "
  if (section === null) return null
  const lines = section.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return false
  return lines.every(line => LIST_ITEM.test(line)) ? true : null
}
```

## Testing strategy

`bun:test` against `test-sdk/` stubs (unit) + browser fixtures under the real
SDK (`ui:conformance`). New/changed coverage:

- `tests/routes.test.ts` (kickoff): create answers before the turn is admitted
  (a `start` that never resolves); the detached start flips `pending →
  started`; a refused start records `attempts`/`lastError` and emits
  `projects.changed`; the context-build bound records `lastError`, retires
  the token and releases ownership; the fence orderings (A times out and
  resumes BEFORE any B ⇒ no engine call; A times out, B completes the turn,
  A resumes ⇒ no engine call, one user row); a hung admission blocks no other
  project write (a second project is created meanwhile) and no other
  project's recovery (the pump starts B while A's admission never resolves,
  and the next tick still runs); `/ask` on a pending kickoff ⇒ 409; the
  pump retries up to three times then stops; the retry route's
  three answers (409 / 200 in-flight / 202 starting) answer at once even when
  the admission it scheduled hangs, and its `attempts` reset; the boot sweep
  unchanged; `brief.openQuestions` on the detail (seeded ⇒ true, blank ⇒
  false, prose or mixed ⇒ null, heading missing ⇒ null).
- `tests/brief.test.ts` (NEW): the parser over seeded, edited, blank,
  prose-only, numbered/`+` lists, MIXED list-plus-prose (⇒ null), sub-headed
  and heading-less bodies.
- `tests/brainstorm-prompt.test.ts`: the five areas in order, "at most one"
  card with a recommendation, the four blocking gaps, the convergence rule,
  the "just write it" rule, the kept headings, no card tool when `live: false`.
- `tests/service.test.ts`: `kickoffProject` seeds the skeleton; title-only
  create does not; all three receipt fields round-trip through the parser
  (a dropped `attempt` would fail every fence check); the lock rejects an
  async body at the type level (`// @ts-expect-error` pin).
- `tests/steward-*.test.ts`: the excerpt puts `## Plan` first under the cap.
- `tests/start-screen.test.tsx`: chips fill complete prompts; Enter navigates
  on 200 without waiting for anything else; a timed-out create shows the
  error, keeps the text and retries with the SAME requestId.
- `tests/project-detail.test.tsx`: starting notice + disabled composer while
  pending (also with `lastError` set); "hasn't started" + Retry after
  `lastError` and after the 20 s rule; Retry's `in-flight` answer; nothing
  once `started`; Stop the reply is offered while a started turn streams.
- `tests/project-header.test.tsx`: advisory line + "Continue shaping" only
  when `brief.openQuestions === true`; choosing it selects the Conversation
  tab.
- Browser: the start fixture + detail conversation fixture re-run under the
  real SDK (`PROJECTS_UI_SURFACE=start|conversation`), desktop + mobile.
- Live acceptance on 3737 after reinstall (the behavioural evidence prompt
  tests cannot give): chip → Enter → page opens in < 1 s; notice shows then
  clears; the lead orients, reflects and asks ONE card with a recommendation;
  the brief fills as decisions land; "just write it" drafts; Start shows the
  advisory and "Continue shaping" returns to the conversation.

## Boundaries

- **Always:** keep `bun run test`, `typecheck`, `lint` green per commit; bump
  the manifest version in the feature PR; declare the operator on UI
  mutations; compose public Storybook patterns (no new kit components or
  tokens); update README/UI-AUDIT/docs with the behaviour.
- **Ask first:** any Bakin host change; any new frontmatter beyond the three
  receipt fields (`attempts`, `attempt`, `lastError`); a UI composition the public stories don't cover; changing
  the steward's instructions (D7 only reorders its excerpt).
- **Never:** write to `~/.bakin` from tests (mock content-dir); add a parallel
  progress/streaming transport; let an agent change lifecycle status; parse
  copy to derive state in the UI (the detail carries `brief.openQuestions`
  and `kickoff`).

## Success criteria

1. `POST /` with a kickoff answers in under 100 ms in tests with a turn
   service whose `start` never resolves; the page then shows "Starting the
   conversation…" with a disabled composer and, after the 20 s rule, Retry.
2. A refused start, or a context build that hangs, is recorded as
   `attempts`/`lastError`, retried by the pump up to three times, visible on
   the page, and fenced so a resumed stale attempt never calls the engine;
   Retry always works; no second user row is ever written.
3. A new project's Plan tab shows the seeded brief; the lead's first reply is
   one orientation line + a reflection + AT MOST one card with a
   recommendation — and no card at all when the first message says "just
   write it" or already answers the blocking gaps (then it drafts). Both
   conversations are part of the live acceptance.
4. The lead drafts only after the four blocking gaps are closed (prompt text
   pinned by tests; behaviour by the live acceptance) and "just write it"
   drafts immediately.
5. Start shows the advisory + "Continue shaping" exactly when
   `brief.openQuestions === true`; "Continue shaping" returns to the
   conversation.
6. `use-conversation-stream.ts` is gone; no lock body is async (type-pinned).
7. README, UI-AUDIT, docs/using/projects.md and this spec agree with the code.

## Open questions

None blocking. Deferred (not in this change): a visible "n decided · m open"
indicator (rejected as new schema, D3); a per-chip "start now" affordance (D2);
host work — a bounded conversation turn / stuck-turn watchdog and cancellable
admission (D1g, filed as a follow-up issue when this ships).
