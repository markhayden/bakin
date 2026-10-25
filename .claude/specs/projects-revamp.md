# Spec: Projects Revamp — guided start, brainstorm buddy, active-project steward

Status: APPROVED · 2026-10-25 · spans two repos
(`bakin` core/SDK, `bakin-bits-official/plugins/projects`).
Mocks: https://claude.ai/artifact/3PuJho8mfGKbzK6QP48e9g (artboards 1, A1–A3 are
the chosen direction; B and C are rejected alternatives).

## Objective

Projects today is an expert's form: a "New project" modal that only asks for a
title, then a detail page that stacks a title input, owner picker, 4-option
status radio, a raw-markdown plan textarea, an empty brainstorm, and a right
rail of progress/tasks/assets/info. A non-expert cannot tell what to do first,
and once a project is "active" nothing moves it forward — projects stall.

We are building three things:

1. **Structured questions in the conversation kit (P1, Bakin core).** Agents can
   pose ONE question with options and a recommendation; the kit renders an
   answerable card. Reusable by every conversation surface.
2. **A guided, conversation-first Projects UX (P2, Bits).** You start with
   "What kind of project is on your mind?"; the lead agent acts as a
   brainstorm buddy that grills you one question at a time, pokes holes, and
   drafts the plan as it firms up. The plan, steps and files are secondary
   destinations, not a crammed page.
3. **An active-project steward loop (P3, both repos).** Starting a project
   hands it to the lead agent, which keeps work moving — promotes and
   delegates steps, notices blocked/idle/missing work, adds follow-on tasks —
   until it is complete or a human decision/sign-off is needed.

**User:** one person running Bakin on their own machine; not assumed to be a
project-management or agent expert. Interface goals: guided, dead simple, no
prior expertise required. Everything that exists today stays reachable — the
layout and flow change, not the capability set.

**Priority rule:** reduce tech debt. Single user; no backwards compatibility,
no shims, no migrations for old UI state. Delete what is replaced.

## Decisions (from the 2026-10-25 interview)

### P1 — Structured questions (Bakin core + SDK)

- **D1. Core exec tool `bakin_exec_ask_user`.** Args:
  `{ question: string, options: {label, description?}[] (2–5), recommended?: number (option index), allowOther?: boolean (default true) }`.
  zod-validated (question ≤ 200 chars, label ≤ 60, description ≤ 160, AND the
  serialized question ≤ 2 KB — field caps alone do not bound escaped JSON).
  The handler mints `questionId` (`q_<random>`), stores the validated question
  in the core **question registry** (`packages/core/src/conversation/questions.ts`,
  in-memory, TTL 10 min — enrichment happens in-process within the same turn),
  and returns the SHORT text `Question posted (bakin-question:<questionId>). End your turn and wait for the user's answer.`
  — short enough to survive Pi's one-line `summary` and OpenClaw's 500-char
  preview clip. Registered via `addExecTool` in
  `src/core/exec-tools/tools/ask-user.ts`; available on every runtime.
- **D2. Structured side channel, never the transport preview.** Neither
  transport carries structured tool output (Pi emits only a redacted
  `summary` — `packages/adapter-pi/src/messaging.ts:502`; OpenClaw clips at
  `OPENCLAW_ACTIVITY_PREVIEW_CHARS = 500`). The **turn engine**
  (`packages/core/src/conversation/turns.ts`, which sees every chunk for chat,
  brands and bits brainstorms) enriches a tool result chunk whose summary or
  output contains a `bakin-question:<id>` token: it looks the id up in the
  registry and sets `data.metadata.bakinQuestion = <full validated question + id>`
  BEFORE emitting the live chunk and persisting the row (the recorder already
  copies `metadata`, unclipped). The fold reads ONLY `metadata.bakinQuestion`
  (tool-name-agnostic; no parsing of `mcp__…` names). Unknown/expired id →
  normal activity row. Calls outside a conversation turn (dispatch runs) are
  never enriched and render as ordinary tool rows — inert, never a broken card.
- **D2a. Validator home.** The zod schema + `parseBakinQuestion` live in
  `packages/core/src/conversation/questions.ts` and are re-exported from
  `@makinbakin/sdk/utils` (server use: tool, engine, Bits `request_input`). The
  dependency-free UI package keeps a structural `BakinQuestion` type + a
  cheap structural guard, pinned against the SDK type by the existing private
  message-contract module (same pattern as `ConversationMessage`).
- **D3. `QuestionCard` kit component** (`packages/ui/src/conversation/question-card.tsx`,
  exported via `@makinbakin/sdk/conversation`). Options as a radio list; the
  recommended option is **labelled "Recommended" but never preselected**;
  "Something else…" (free text, when `allowOther`) and "Not sure — help me
  choose" are always last; optional note field; explicit **Answer** button
  (keyboard: arrows select, Enter submits). Reflows at narrow widths (docked
  panel ≥ 320px) via container queries.
- **D4. Answering sends a normal user message** through the surface's existing
  `onSend` — format: `**{question}** → {label}` + `\n\n{note}` when present;
  "Not sure" sends `**{question}** → Not sure — help me choose`. No special
  parsing by the agent; transcripts stay readable.
- **D5. Card states are derived by the fold, not stored.** `open` (no later
  user row), `answered` (the next user row starts with the card's
  `**{question}** →` prefix → collapsed one-liner "Question → Answer"),
  `skipped` (the next user row is anything else → collapsed "Skipped"), and
  read-only while the turn streams. Answered cards are read-only; to change an
  answer the user says so in chat. One open question per turn: a second
  `ask_user` call in the same turn renders, but only the LAST open card in the
  thread is answerable. The SAME lifecycle governs the steward's input gate
  (D25) — there is one definition of "answered", not two.
- **D6. Tool posture text** (tool description): use only in a live
  conversation with the user, ask ONE question per turn, include a
  recommendation when you have one, keep options mutually exclusive, end the
  turn after calling. No runtime refusal is needed: outside a conversation the
  call is inert (D2). Dispatch prompts are not changed to mention it.
- **D6a. Attention.** A turn that ends on an open question card counts as an
  attention-worthy reply. Today tool-only turns produce no preview (the engine
  derives it from assistant text only, `turns.ts:679`) and attention listens
  only to `done` (`use-conversation-attention.tsx:95`). Changes: the engine's
  done payload preview falls back to "{agent} asked: {question}" for
  question-ending turns; `appended` events carry an optional
  `notice: { preview, agentId }` and `useConversationAttention` subscribes to
  the consumer's `appended` event too (P1 adds the option; P3's out-of-turn
  rows use it); the Bits unread parser counts question rows. A collapsed dock
  shows the unread dot.

### P2 — Projects UX (Bits `plugins/projects`)

- **D7. No modal.** `new-project-dialog.tsx` is deleted. "New project" routes
  to `/projects/new`, the **start screen**: heading "What kind of project is on
  your mind?", sub-copy "A rough idea is enough — we'll shape it together.",
  six static starter chips (a plugin constant), a lead-agent picker (default:
  main agent), and the composer. A chip **pre-fills** the composer with an
  editable sentence and focuses it; nothing is created until send.
- **D8. First send creates the project — idempotently.** The client mints a
  `requestId` (uuid) when the user presses send and `POST /` with
  `{ requestId, title: <first message trimmed to 60 chars on a word boundary>, owner, titleSource: 'fallback', firstMessage }`.
  The server writes the project with a **kickoff receipt** in frontmatter —
  `kickoff: { requestId, message, agentId, state: 'pending' | 'started' }` —
  then starts the first brainstorm turn itself (same code path as `/ask`) and
  flips `state` to `started` once the engine accepts the turn. A repeat
  `POST /` with a known `requestId` returns the existing project and, if
  `state === 'pending'`, starts the turn (never twice: `started` is written
  under the project lock before returning). A boot sweep starts any
  `pending` kickoff left by a crash. The receipt is cleared after the first
  turn settles. Client navigates to `/projects/:id` (Conversation
  tab), where the thread hydrates mid-stream. The kit composer clears its draft
  before send (`composer.tsx:290`), so on failure the start screen restores the
  text via `ComposerHandle.setText` and shows the error inline; retry reuses
  the same `requestId`.
- **D9. Agent-set titles.** New frontmatter `titleSource: 'fallback' | 'agent' | 'user'`.
  Kickoff instructions tell the lead to set a short title once it understands
  the project. Enforcement lives in ONE mutation chokepoint (see D9a): an agent
  title write when `titleSource === 'user'` is refused with a clear tool error;
  a user rename sets `'user'`.
- **D9a. One authority chokepoint for agent mutations.** Every agent-reachable
  write (`bakin_exec_projects_update`, `_apply_plan`, item tools) passes
  through one service-level guard with the caller kind (`agent | user`):
  agents can NEVER change `status` (the `status` param is removed from both
  agent tools — lifecycle is human or approval-driven only, D11/D26), never
  overwrite a `'user'` title (applies to `applyProjectPlan`'s title write too,
  `project-service.ts:236`), and never delete steps. The remaining D23 limits
  (scope changes, spend beyond plan) are advisory, stated in the steward
  instructions — documented as such, not claimed as enforced.
- **D10. Detail layout = tabs + docked chat.** `PageHeader` (title, status
  badge, next-step button, ⋯ menu) over a `Conversation · Plan · Steps · Files`
  tab bar (URL state `?tab=`, default omitted). One content column; the right
  rail, `useHorizontalResize` divider and "Project information" block are
  deleted.
  - **Conversation tab:** full-width `ConversationPanel` (no dock).
  - **Plan / Steps / Files:** content + a **docked chat panel** on the SAME
    thread (one `useConversationThread` owned by the page). Exactly one
    `ConversationPanel` is mounted at a time — the page renders it EITHER in the
    Conversation tab OR in the dock (conditional mount keyed on tab, collapse
    and breakpoint), never both; the shared `storageKey` carries the draft
    across the remount. Collapsible to a slim rail (agent avatar +
    unread/working dot); expanded/collapsed is one remembered preference
    (localStorage, try/catch). Composition: `PageAside` collapsible aside
    (`storybook/public/Pages/collapsible-aside.stories.tsx` — CollapseRoundtrip)
    containing an embedded `ConversationPanel`. Width: see Open Question 1
    (UI-conformance approval needed for a conversation-width aside).
  - **Mobile (< lg):** no dock; a floating "Ask {agent}" button switches to the
    Conversation tab.
  - **Default tab by stage** when `?tab` is absent: draft → Conversation,
    active → Steps, completed → Files, archived → Plan.
- **D11. Status = one next-step button.** No status picker anywhere. Header
  shows `StatusBadge` + one primary action: draft → **Start project**,
  active → **Mark complete**, completed → **Reopen** (→ active), archived →
  **Unarchive** (→ previous status, recorded as `archivedFrom`). ⋯ menu:
  Pause/Resume check-ins (active only, P3), Archive, Details, Delete.
- **D12. Editing in place.** Title: click the header title to rename inline
  (Enter saves with expected-value check, Esc cancels). Lead agent: ⋯ →
  Details dialog (lead picker + created/updated/ID). Plan: "Edit plan" on the
  Plan tab swaps the rendered plan for the editor + `SaveBar`, keeping today's
  body conflict handling (Use latest / Keep mine). Draft state lives at page
  level so tab switches never lose it; `useUnsavedChangesGuard` covers leaving.
  The `/projects/:id/edit` route, `ProjectDraftForm`, and the 4-field draft
  model are deleted; plan edit mode is `?tab=plan&edit=1`.
- **D13. "Lead agent".** UI label for the stored `owner` field (field name
  unchanged). Set by the start-screen picker; default brainstorm agent and the
  P3 steward. The composer's agent switcher stays for one-off consults.
- **D14. Brainstorm-buddy posture** replaces `PROJECT_BRAINSTORM_INSTRUCTIONS`
  (still ONE constant shared by `/ask` and `bakin_exec_projects_ask`), staged
  by status:
  - **Shaping (draft):** each turn = brief reflection + at most one challenge
    ("you said X — but Y?") + ONE `bakin_exec_ask_user` card with a
    recommendation. Ask only questions that materially change the plan. Once
    goal, scope and done-criteria are answered (typically 3–5 questions), draft
    the plan body + checklist via `apply_plan`, say so ("Draft plan is ready in
    the Plan tab"), label assumptions, and keep refining. "Just write it" /
    "draft with what we know" skips ahead.
  - **Active:** progress-buddy — what's blocked, what's next, re-scoping; no
    interviewing unless the user asks.
  - **Completed/archived:** retrospective/answers only.
- **D15. Plan revision + "Plan updated" notice (not a transcript row).** New
  frontmatter `planRevision: number`, incremented on every COMMITTED body
  change (no-op writes don't bump; restores do), with `planUpdatedBy: 'agent' | 'user'`
  and `planUpdatedAt`. The seen sidecar records `planSeenRevision`. When
  `planRevision > planSeenRevision` and the last writer was an agent: the Plan
  tab shows a dot, and the Conversation tab/dock shows a one-line notice above
  the composer — "Plan updated {age} · Review changes" (→ `?tab=plan&view=changes`,
  comparing against the snapshot at `planSeenRevision`). `PlanSnapshot` gains
  `revision` (the revision it captured). Retention: the newest 20 snapshots
  PLUS the snapshot pinned at `planSeenRevision` (never evicted while it is
  the baseline). Opening the Plan tab captures the comparison baseline for
  that view first, then marks the current revision seen; seen-sidecar writes
  merge fields (brainstorm-seen and plan-seen share the file). Nothing is injected into the transcript (the agent's
  own `apply_plan` tool activity already shows in-turn), so steward edits
  outside chat surface the same way.
- **D16. Steps tab** = today's checklist (independent row drafts, durable
  promotion receipts, hide-completed) restyled to one column: progress bar +
  "n of m steps done", rows show board state in words ("In progress ·
  Roscoe", "Done · board"), "Send to board" replaces the ambiguous link icon,
  "Open task" links. Empty state: "Steps appear once the plan takes shape —
  or add one."
- **D16a. Linked-step completion is DERIVED, not synced.** For a step with a
  `taskId`, `checked` is computed at read time from the board task's column
  (done/archived ⇒ checked; any other column ⇒ unchecked; task missing ⇒
  unlinked + unchecked, existing `autoUnlinkTask`). The stored `checked` is
  only authoritative for standalone steps; the checkbox on a linked step is
  read-only. `autoCheckLinkedItem` and the done-only `tasks.statusChanged`
  write are deleted. ONE helper (`deriveChecklist(project, tasksById)` in
  `project-service.ts`) is the only source of `checked`/`progress` for every
  projection: detail GET, list summaries, `buildProjectBrainstormContext`,
  `tasks.enrichDetails`, the steward digest, and the return value of
  `markChecklistItem` / `bakin_exec_projects_mark_item|toggle_item`. Those
  write paths REJECT linked steps (409 / tool error `linked_step` — "this step
  completes from its board task"). Board transitions emit
  `projects.changed` for the owning project (no write) so open pages refetch.
- **D17. Files tab** = two groups: **From this project's work** (derived live
  via `ctx.hooks.invoke('assets.listByTask', { taskId })` — permitted for
  external plugins (`plugin-context-factory.ts:213`), ONE task per call,
  returns `{assetId, description, type}[]`; the server route fans out over the
  project's linked task ids incl. steward tasks with bounded concurrency (8)
  and dedupes by assetId; nothing persisted) and **Attached** (today's
  attach/relink/detach + preview).
  The composer paperclip attaches to the project.
- **D18. List page refresh.** Keep separated `ListRows`, search, filters. Each
  row: title, status, and ONE resume signal by priority: Waiting for you (open
  question card or open request) › Needs approval (P3) › Stuck (P3) ›
  {Agent} is working › Plan updated › "n of m steps done". Archived hidden by
  default (filter). Zero projects → the list renders the start screen. "New
  project" → `/projects/new`.
- **D19. Dead config removed:** `autoPromoteThreshold` setting (declared,
  never read).

### P3 — Steward loop (Bakin core + Bits)

- **D20. Cheap scan → steward task.** A plugin timer started in `activate()`
  (cleared in `onShutdown`, per `bakin/no-plugin-top-level-side-effects`)
  scans Active, non-paused, non-waiting projects every `stewardScanMinutes`
  (default 15). The scan is deterministic (no LLM): reads the project +
  `ctx.tasks.list({ projectId })` and produces a **digest** of signals. Steward
  tasks (`source.entityType === 'steward'`) are EXCLUDED from every work
  signal. Signals: `blocked` linked tasks · `review` tasks idle >
  `stewardStuckAfterHours` (default 24) · unpromoted steps with nothing in
  flight · a work task reached done since the last steward run (follow-on
  judgement) · all steps done · **stalled**: no work-task movement for
  `stewardStuckAfterHours` while the project has unfinished steps.
  Run-level stuckness (stale inProgress) is the watchdog's job and is NOT
  re-detected.
- **D20a. Fingerprint + backoff (no loops).** The digest has a stable
  canonical fingerprint over: signal kinds; work-task ids + columns; checklist
  step `instanceId`s with their derived checked/linked state; and
  `planRevision`. It excludes steward bookkeeping, timestamps and steward
  tasks. A steward task is created
  only when the fingerprint differs from `steward.lastFingerprint`, OR the same
  unresolved fingerprint has persisted for `stewardStuckAfterHours` since the
  last run (one re-raise per window). A project whose work is progressing, or
  whose only signals were already handled, creates nothing.
- **D21. Event trigger.** The `tasks.statusChanged` hook also schedules an
  immediate (debounced 30s, per project) scan for WORK-task transitions into
  done/blocked/review. Steward-task transitions never trigger a scan. **Core
  fix (P3):** today the hook fires only from the effects-based move path
  (`task-service.ts:284`); blocking (`:357`) and SDK `update/move`
  (`plugin-context-services.ts:96`) skip it. Emission moves to ONE chokepoint
  — the task-store column write — and the per-path emissions are deleted, so
  every transition notifies exactly once. The timer scan remains the
  reconciliation backstop for anything missed.
- **D22. Steward task — reserved, idempotent, capped.** Reuses the promotion
  reservation pattern (`project-service.ts:495`): under the project lock,
  write `steward: { openTaskId, reservedAt, fingerprint }` with a pre-minted
  task id, THEN `ctx.tasks.create({ id: openTaskId, … })` outside the lock; a
  reservation freezes the create inputs (title, assignee, description) so a
  recovery creates the identical task. "Open" = any column except
  done/archived (backlog, blocked, review count as open). **Reconcile before
  every scan** (single-flight per project, under the lock), BEFORE the cap and
  fingerprint checks:
  | reservation state | board task | action |
  |---|---|---|
  | `openTaskId` set | missing, `phase: 'reserved'` | create from frozen inputs; a duplicate-id rejection (`store.ts:374`) means it exists → `phase: 'created'` |
  | `openTaskId` set | missing, `phase: 'created'` | task was deleted → finalize as abandoned |
  | `openTaskId` set | open column | nothing (one steward at a time) |
  | `openTaskId` set | done/archived | finalize: clear `openTaskId`, record `lastStewardAt` + `lastFingerprint` |
  The task must carry `source.entityType 'steward'` + this project id or the
  reservation is treated as foreign and cleared with an audit event.
  Finalization never depends on the agent calling checkin or on the hook
  arriving. A reservation counts toward the daily cap once, when written.
  Task: assignee = lead, `projectId`, `tags: ['project-steward']` (D30),
  `source: { pluginId: 'projects', entityType: 'steward', entityId: projectId }`,
  title "Check in: {project}", description = digest + plan excerpt (byte-capped,
  visible omission marker) + last 10 conversation rows + steward instructions.
  Gets budget gating, watchdog, metering (dispatch work class) and board
  visibility for free. Daily cap `stewardMaxRunsPerDay` (default 6) counted per
  project per LOCAL calendar day (server tz) in `steward.runs: {date, count}`,
  incremented at reservation; cap hit → skip + one audit event per day +
  list signal "Check-ins paused for today".
- **D23. Steward authority.** Autonomous: promote existing steps (choosing the
  assignee — keep for itself or delegate), add steps/tasks that follow from the
  agreed plan, re-describe/reassign blocked tasks, nudge idle reviews,
  incremental plan edits (snapshotted). Needs the human: scope changes,
  deleting/abandoning steps, spend beyond the plan, deliverable sign-off,
  completion. ENFORCED (D9a): no status changes, no step deletion, no
  overwriting a user title. ADVISORY (instructions only): scope and spend.
- **D24. Receipts.** Each steward run should call
  `bakin_exec_projects_checkin({ projectId, taskId, summary, actions[] })`.
  **Steward identity:** every steward tool takes the `taskId` from its task
  prompt; the server accepts it only if `taskId === project.steward.openTaskId`
  and the task's source is this project's steward (else tool error
  `not_steward`). Attribution is frozen to the reserved task's assignee, not
  the project's current lead. The row is appended with
  `turnId: steward:<taskId>` and `agentId: <task assignee>` ("Checked in: sent
  2 steps to the board, flagged X as stuck"). Bookkeeping never depends on it
  (D22).
- **D24a. Out-of-turn transcript appends.** Rows appended outside a brainstorm
  turn (checkin, request_input) carry their own `turnId`/`agentId` so the fold
  renders them as a separate agent turn with the lead's identity
  (`fold.ts:285` splits only when both turn ids exist). They are announced by a
  new plugin event `projects.brainstorm.appended` that makes
  `useConversationThread` refetch WITHOUT settling an in-flight turn (reusing
  `done` would clear a live stream — `use-conversation-thread.ts:200`).
  **Append contract (core, P3):** the turn service gains
  `appendExternal(key, rows, notice?)` sharing the engine's admission state:
  with no turn in flight it appends + emits `appended` immediately; with a
  turn in flight it QUEUES the rows and flushes them at slot release BEFORE
  the next admission (no awaiting inside a tool call, so no circular wait;
  `waitFor` is not used). Steward tools (`checkin`, `request_input`,
  `request_signoff`) refuse when called from inside a brainstorm turn for the
  same project (tool error `use_ask_user` — conversations use
  `bakin_exec_ask_user`); identity per D24 makes that check exact. The kit
  gains a generic `events.appended` option on `useConversationThread` (P1)
  and `ctx.conversations` exposes `appendExternal` (P3).
- **D25. Input gate (questions).** `bakin_exec_projects_request_input({ projectId, question, options, recommended?, allowOther?, context })`
  validates with the shared `parseBakinQuestion` (D2a), appends a tool row with
  `metadata.bakinQuestion` (D24a) to the project conversation, sets
  frontmatter `waitingOn: { kind: 'input', questionId, question, context, since }`
  (`context` = the steward's bounded reasoning, ≤ 1 KB), fires attention
  (D6a), and suppresses scans for the project. **Lifecycle (one definition,
  shared with D5):** the gate ends when the NEXT user message lands in the
  thread — answered (prefix match) or responded-otherwise (any other text) —
  or is superseded by a newer `request_input` (which replaces `waitingOn`).
  **Ordering:** `/ask` reads `waitingOn` and embeds "Pending question from
  your last check-in: {question} · options · {context}" in that turn's
  `runtimeContent`; only after the engine ACCEPTS the turn (not busy) does it
  compare-and-set `waitingOn` (matching `questionId`) → `replyPending:
  { questionId }`. Busy leaves the gate untouched. `replyPending` clears when
  that turn settles (done, error or abort) and scans resume; a boot sweep
  clears a `replyPending` with no turn in flight.
- **D26. Sign-off gate (approvals).** Core changes:
  - Owner union gains `plugin-gate`:
    `{ kind: 'plugin-gate', pluginId, gateKind, entityId, taskId }` — `taskId`
    is REQUIRED (board association; approval filtering keys on
    `owner.taskId`, `store.ts:100`).
  - ONE core kind handler for `plugin-gate` dispatches to plugin-scoped
    handlers keyed `(pluginId, gateKind)` registered via
    `ctx.approvals.registerGate(gateKind, { onResolve, ownerState })` in
    `activate()`, auto-removed on deactivate/hot-reload; rehydration resolves
    handlers lazily and reports `ApprovalKindUnavailableError` honestly when a
    plugin is absent.
  - `ctx.approvals.request({ gateKind, entityId, taskId, title, summary, options })`,
    `cancel(id)`, `listPending({ entityId? })`; plugin-namespaced, provenance
    and the one decision path (`POST /api/approvals/:id/resolve`) unchanged —
    agents still cannot resolve.
  - `ApprovalPanel` gets an explicit `plugin-gate` renderer (title, summary,
    options from the record) instead of falling through to health navigation
    (`approval-panel.tsx:290`).
  - **Identity:** approval ids are deterministic and caller-supplied —
    `projects:<projectId>:<gateKind>:<subject>:<generation>` (core requires an
    explicit id for idempotency, `store.ts:55`). Frontmatter
    `gates[<gateKind>:<subject>] = { approvalId, generation, state }`; at most
    one pending per gateKind+subject; re-requesting after a rejection bumps
    `generation`; re-requesting while pending is a no-op returning the same id.
  - **Agent tool:** `bakin_exec_projects_request_signoff({ projectId, taskId, gateKind: 'complete' | 'signoff', subjectTaskId?, summary })`
    (steward identity per D24). Requesting moves the steward's own task to
    `review` so the board's Review column shows it with "Needs approval"; the
    approval's `taskId` anchor is that steward task (`complete`) or the
    deliverable task (`signoff`, which is also moved to `review`).
  - **Effects:** `complete` approve ⇒ status completed (D28 cleanup) and the
    steward task → done; reject ⇒ reason appended (D24a), steward task → done,
    loop resumes. `signoff` approve ⇒ deliverable task → done; reject ⇒
    reason to the task log + conversation, task → todo with the reason in its
    description. Scans are suppressed while a `complete` gate is pending.
  - **ownerState:** pending stays valid while the project exists, is active
    and the gate's generation matches; project completed/archived/deleted or a
    newer generation ⇒ stale → core cancels it on rehydration. A pending
    `complete` gate whose anchor task is already done remains valid (the
    approval, not the task column, is the source of truth).
- **D27. Start project** = hand-off `ConfirmDialog`: "{Lead} takes it from
  here — sends steps to the board, assigns each to the right agent or keeps
  it, and checks in as work moves. You'll be asked when a decision or sign-off
  is needed." Shows step count + "Review steps first" link. Confirm → status
  active + immediate steward reservation (D22, bypasses the fingerprint gate
  once; zero steps → the steward breaks the plan down first).
- **D28. Completion cleanup ordering.** Completing a project (manual Mark
  complete, or the `complete` gate's `onResolve`) cancels open steward tasks
  and pending `plugin-gate` approvals for the project EXCEPT the approval
  currently resolving (core calls `onResolve` before persisting the approved
  record, `service.ts:191`; cancelling it would fail the compare-and-set).
  Cleanup is idempotent so a retry after partial failure converges. Manual
  Mark complete with unfinished steps → confirm listing them ("3 steps aren't
  done — complete anyway?").
- **D29. Controls.** ⋯ → Pause check-ins / Resume (frontmatter
  `stewardPaused: boolean`; badge "Paused"; status stays active). Plugin
  settings: `stewardEnabled` (default true), `stewardScanMinutes` (15),
  `stewardStuckAfterHours` (24), `stewardMaxRunsPerDay` (6). Budget limits apply
  through the dispatch gate. No new status value.
- **D30. No new work class; tags reach the task.** Steward tasks classify as
  dispatch work. Core threads `tags` through EVERY layer that drops them
  today: SDK `ctx.tasks` create/update types (`services.ts:69`), the facade
  (`plugin-context-services.ts:74`), `createTaskWithEffects`
  (`task-service.ts:453`), the task-store facade (`task-store.ts:283`), and the
  `toPluginTask` readback, so existing tag-override
  routing (`model-routing.ts:206`) can send `project-steward` to a cheaper
  model. Tested end to end (create → stored tags → routing resolution).

### Frontmatter additions (Bits)

`titleSource`, `kickoff?: { requestId, message, agentId, state }`,
`archivedFrom?`, `planRevision`, `planUpdatedBy?`, `planUpdatedAt?`,
`stewardPaused?`, `waitingOn?`, `replyPending?`,
`steward?: { openTaskId?, phase?, frozen?, reservedAt?, fingerprint?, lastFingerprint?, lastStewardAt?, runs? }`,
`gates?: Record<string, { approvalId, generation, state }>`.
Seen sidecar gains `planSeenRevision`. All optional; absent = defaults
(`planRevision` 0). Stored `checked` on linked steps is ignored (D16a). No
migration.

## Tech Stack

Bun 1.4.3; TypeScript strict; React 19; TanStack Router (host);
`@makinbakin/sdk` focused entrypoints (`/conversation`, `/patterns`, `/ui`,
`/navigation`, `/hooks`); zod 4.6 at boundaries; Storybook (public stories =
the UI contract); bun:test + RTL + happy-dom; Playwright via
`bakin-plugin-test-ui` for Bits browser fixtures. No new dependencies.

## Commands

Bakin (`/Users/markhayden/go/src/github.com/markhayden/bakin`):
```
bun run typecheck
bun run lint                                  # zero-warning
bun run test                                  # full suite
bun test tests/<path>.test.ts --isolate       # single file
bun run ui:conformance --quick                # every UI change
bun run ui:conformance                        # merge-ready
bun run ui:story-compliance:check && bun run ui:kit-coverage:check
bun run build                                 # full chain before commit (css+vendors+plugins+host)
```
Bits (`/Users/markhayden/go/src/github.com/markhayden/bakin-bits-official`):
```
bun install                                   # after any test-sdk change
bun run typecheck && bun run lint && bun run test
cd plugins/projects && bun run test:ui && bun run test:ui:collections   # real-SDK browser fixtures
```

## Project Structure

Bakin:
```
src/core/exec-tools/tools/ask-user.ts          P1 tool (+ registration import)
packages/core/src/conversation/questions.ts    zod schema, parseBakinQuestion, in-memory registry
packages/core/src/conversation/turns.ts        enrichment of question tool chunks
packages/sdk/src/types/conversation.ts         BakinQuestion type; utils re-export of the parser
packages/sdk/src/conversation/use-conversation-thread.ts   events.appended refetch
packages/ui/src/conversation/question-card.tsx P1 card
packages/ui/src/conversation/fold.ts           question item + derived state
packages/ui/src/conversation/agent-turn.tsx    renders question items
storybook/public/conversation/question-card.stories.tsx
packages/core/src/approvals/schema.ts          P3 plugin-gate owner kind
src/core/approvals/*, src/lib/plugin-context-*  P3 ctx.approvals + plugin-gate dispatcher
packages/sdk/src/types/{context,services}.ts   P3 ctx.approvals contract; tags on ctx.tasks
plugins/tasks/components/approval-panel.tsx    P3 plugin-gate renderer
packages/core/src/conversation/turns.ts        P1 question preview fallback; P3 appendExternal
packages/sdk/src/conversation/use-conversation-attention.tsx   P1 appended notices
src/lib/plugin-context-factory.ts              P3 ctx.conversations.appendExternal, ctx.approvals
src/core/task-service.ts, src/core/task-store.ts   P3 tags threading; ONE statusChanged chokepoint
packages/core/src/tasks/store.ts               P3 statusChanged emission at the column write
tests/{components,sdk,core}/…                  tests
.claude/knowledge/{conversation-kit,approvals,plugin-system}.md   docs
```
Bits `plugins/projects`:
```
components/start-screen.tsx (new) · project-detail.tsx (rewritten) ·
project-tabs/{conversation,plan,steps,files}-tab.tsx (new) · chat-dock.tsx (new) ·
project-header.tsx (new) · start-project-dialog.tsx (new) · project-list.tsx
lib/steward/{scan,digest,prompt}.ts (new) · lib/project-service.ts · index.ts
types.ts · bakin-plugin.json · README.md · UI-AUDIT.md
deleted: new-project-dialog.tsx, project-draft-form.tsx, project-editor.tsx (if unused), use-project-draft 4-field model
test-sdk/                                       stub new SDK exports
```

## Code Style

Match surrounding code: functional components, `kebab-case.tsx`, focused SDK
imports, kit patterns over hand-rolled UI, comments only for non-obvious WHY.
```tsx
// Card state is derived from the transcript — never stored (D5).
export function questionStateFor(card: BakinQuestion, nextUser?: string): QuestionState {
  if (nextUser === undefined) return 'open'
  return nextUser.startsWith(answerPrefix(card)) ? 'answered' : 'skipped'
}
```

## Testing Strategy

- **P1:** unit — schema caps incl. serialized-size rejection, tool handler
  short result + registry put/TTL, engine enrichment (token in Pi `summary`
  and in OpenClaw-clipped output; unknown/expired id → plain row; non-question
  tool rows untouched), `appended` refetch without settling a live turn, fold
  detection from `metadata.bakinQuestion` and derived state
  (open/answered/skipped/last-open-only), attention on card-ending turns;
  adapter-level — real Pi/OpenClaw chunk conversion through the engine to a
  persisted row and back through the fold; RTL — card keyboard, recommended not
  preselected, Something else / Not sure / note formatting, read-only while
  streaming, narrow reflow; Storybook — `CanonicalUsage` + states +
  play functions; story/kit-coverage gates.
- **P2:** RTL — start screen (chip prefill, no create until send, create-fail
  preserves text, no duplicate on retry), tabs + default-by-stage + URL state,
  dock single-composer/shared draft/collapse persistence, next-step button
  transitions, inline rename + `titleSource`, plan edit conflict flow, list
  signals priority; route tests — create with `titleSource`, agent title refusal
  when user-set, archive/unarchive `archivedFrom`; browser fixtures — start
  screen + detail tabs desktop/mobile replacing the deleted edit fixtures.
- **P3:** unit — scan digest per signal, debounce, one-open-steward-task
  idempotency, daily cap, pause/waitingOn suppress; route/tool — checkin,
  request_input (envelope, waitingOn, attention), completion cancels open
  steward/approvals; core — `plugin-gate` owner kind, ctx.approvals
  request/resolve/cancel, provenance refusal for agents, board surfacing;
  conformance of the timer lifecycle (activate/onShutdown).
- Every test mocks content-dir (both paths), OpenClaw home, logger, watcher
  per CLAUDE.md; RTL files import `rtl-settle`; waits via `waitUntil`/`settleFor`.

## Boundaries

- **Always:** load `bakin-ui-conformance` before UI work and use defined
  patterns; run the full build chain before Bakin commits; update
  `.claude/knowledge` + Bits README/UI-AUDIT in the same phase; conventional
  commits with scope; one checkpoint commit per task; stub new SDK exports in
  Bits `test-sdk/`.
- **Ask first:** any UI pattern deviation (per conformance skill); any new
  dependency; perf-ceiling jumps that are large/unexplained; releasing/tagging
  either repo; the exact `ctx.approvals` surface if it diverges from D26.
- **Never:** compat shims or old-route redirects beyond `/projects/new`;
  parallel progress/approval/spend systems; parsing tool-name strings or
  message copy for identity (except the D5 answer prefix, which is our own
  envelope-derived text); writing to `~/.bakin` in tests; `git add -A` after a
  local build.

## Success Criteria

1. Creating a project never shows a form: start screen → one send →
   Conversation tab with the agent replying; a lost create response + retry
   yields exactly one project AND exactly one first turn; a crash between
   create and turn start is resumed by the boot sweep; a failed create
   restores the composer text; the
   agent sets a title within the first exchanges; a user rename is never
   overwritten through ANY agent tool (update or apply_plan).
2. In shaping, an agent turn that calls `ask_user` renders exactly one
   answerable `QuestionCard` — proven through the REAL adapter chunk
   conversion for Pi and OpenClaw (tool result → engine enrichment → persisted
   row → reload/replay), not hand-built rows. Answering produces a readable
   user message; the card collapses to "Question → Answer"; a turn ending on an
   open card raises attention.
3. The detail page has no right rail and no status picker; agents cannot change
   status through any tool; the four tabs and the dock work on desktop with
   exactly one mounted composer in every tab/collapse/breakpoint combination
   and the draft preserved across switches; mobile has tabs + Ask button;
   `ui:conformance` passes with no unapproved exceptions.
4. Plan writes bump `planRevision` only when the body changes; the Plan dot +
   "Plan updated" notice appear for agent writes (chat or steward) and clear on
   viewing the Plan tab; multiple edits and restores compare against the last
   seen revision.
5. Linked-step completion follows the board task both ways (done → checked,
   reopened → unchecked) in every projection (detail, list, brainstorm context,
   task enrichment, digest, tool returns); toggling a linked step through the
   UI, REST or tools is rejected with `linked_step`. Every task column change
   (move, block, SDK update) emits `tasks.statusChanged` exactly once.
6. Files tab shows assets produced by linked tasks without any persisted copy.
7. Steward: a blocked task, idle review, finished work task or stalled project
   produces exactly one steward task within one scan interval (~30s for
   events); an unchanged digest across N intervals produces no further tasks
   until the re-raise window; steward-task completion never triggers another
   steward; simultaneous timer + event + Start triggers and a crash between
   reservation and create still yield one task; the daily cap holds.
8. A steward needing input produces a question card in the project chat
   attributed to the lead, "Waiting for you" on the list, an attention
   notification, and no scans until the user responds; the reply turn sees the
   pending question context. Completion sign-off appears as "Needs approval" on
   the steward task with a plugin-gate renderer; approving completes the
   project without failing its own resolution; agents cannot resolve it.
9. Deleted: modal, 4-field draft form, `/edit` route, right rail, resize
   divider, `autoPromoteThreshold`, `autoCheckLinkedItem`, agent `status`
   params. Docs updated in both repos.

## Resolved Questions (2026-10-25)

1. **Dock width — APPROVED extension.** Add a public `width="conversation"`
   (360px) variant to `PageAside` with story + coverage + conformance run; the
   chat dock (D10) uses it. Approved by the user per the conformance skill.
2. **Release sequencing — one release at the end.** Bits phases develop against
   a locally assembled SDK tarball of the in-progress Bakin branch; Bakin and
   Bits release once, after P3. Phase boundaries remain commit/PR checkpoints,
   not releases.
3. `assets.listByTask` is reachable by external plugins (one task per call).
4. ask_user outside conversations is inert by construction (D2).
5. Validator home: core + SDK re-export with a structural UI guard (D2a).
6. Plan-seen state uses the existing seen sidecar, merged writes (D15).

Spec reviewed by Codex CLI twice (2026-10-25); all 27 findings incorporated.
