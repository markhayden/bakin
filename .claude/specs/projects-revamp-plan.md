# Implementation Plan: Projects Revamp

Spec: `.claude/specs/projects-revamp.md` (APPROVED 2026-10-25). Decision ids
(D1…D30) refer to it. Repos: **Bakin** = this repo; **Bits** =
`../bakin-bits-official` (`plugins/projects`).

## Overview

Three phases, four branches, one release at the end:

| Phase | Repo | Branch | Delivers |
|---|---|---|---|
| P1 | Bakin | `feat/projects-revamp-p1` | structured questions (tool + engine + kit card), `appended` events, PageAside conversation width |
| P2 | Bits | `feat/projects-revamp-p2` | start screen, tabs + dock, next-step status, buddy posture, derived steps, plan revisions, Files, list refresh |
| P3a | Bakin | `feat/projects-revamp-p3-core` | one `statusChanged` chokepoint, tags through `ctx.tasks`, `appendExternal`, plugin-gate approvals |
| P3b | Bits | `feat/projects-revamp-p3` | steward scan/reservation/tools/gates, hand-off Start, pause, list signals |

Bits phases build and run browser fixtures against a locally assembled SDK
(see "Local SDK loop"). Nothing is released until the final checkpoint.

## Architecture decisions carried into the plan

- **Risk first.** The two riskiest pieces go first in their phases: engine
  enrichment through REAL adapter chunk shapes (T3) and the `statusChanged`
  chokepoint move (T26). If either fails its acceptance, stop and re-spec.
- **Delete in the same task that replaces.** No task leaves a dead path behind
  (modal, draft form, `/edit` route, right rail, `autoCheckLinkedItem`,
  `autoPromoteThreshold`, agent `status` params, per-path hook emissions).
- **P2 ships without the steward.** In P2, "Start project" is a plain confirm
  that sets Active; P3b replaces it with the hand-off (D27). The P2 state is
  complete and coherent on its own (rollback target).
- **Test SDK parity.** Every new SDK export used by Bits gets a stub in Bits
  `test-sdk/` in the first task of that Bits phase, then `bun install`.

## Dependency graph

```
P1  T1 schema/registry ─► T2 tool ─► T3 engine enrichment ─┐
                         T4 fold item ◄────────────────────┘
                         T4 ─► T5 QuestionCard ─► T6 stories ─► T9 chat wiring
    T7 appended + attention (independent)    T8 PageAside width (independent)
    T10 docs ◄── all            ══► CHECKPOINT P1 + SDK tarball #1
P2  T11 test-sdk ─► T12 authority ─► T13 derived steps ─► T14 idempotent create
                  ─► T15 plan revisions ─► T16 posture
    T17 start screen ◄ T14,T16      T18 header ◄ T12      T19 tabs+dock ◄ T8,T18
    T20 plan tab ◄ T15,T19   T21 steps ◄ T13,T19   T22 files ◄ T19
    T23 list ◄ T13,T15,T17   T24 mobile+fixtures ◄ T17–T23   T25 docs
                                ══► CHECKPOINT P2
P3a T26 statusChanged chokepoint   T27 tags   T28 appendExternal
    T29 plugin-gate core ─► T30 ctx.approvals ─► T31 panel renderer   T32 docs
                                ══► CHECKPOINT P3a + SDK tarball #2
P3b T33 test-sdk ─► T34 scan/digest ─► T35 reservation+timer ─► T36 checkin+input gate
    ─► T37 sign-off gates ─► T38 UI (hand-off, pause, signals) ─► T39 settings+docs
                                ══► FINAL CHECKPOINT + release
```

## Commit strategy (applies to every phase)

- **One task = one commit** (occasionally two: an isolated, separately revertible
  prep refactor). Conventional commits with scope, e.g.
  `feat(conversation): render ask_user question cards (#projects-revamp T5)`.
  Body cites the decision ids. Attribution trailer per session settings.
- **A commit is made only when that task's verification is green**: its tests
  (`--isolate`), `bun run typecheck`, `bun run lint` (zero warnings), plus
  `bun run ui:conformance --quick` for UI tasks. Bakin UI/SDK tasks run the
  FULL build chain (css + vendors + plugins + host + perf) before committing,
  then revert the build stamp (`_embedded-assets-static.ts`) — never
  `git add -A` after a build; stage files by path. Run `/verify` right before
  each non-docs/test commit.
- **Every commit leaves the repo working**: no commit introduces a replacement
  without removing what it replaces, and no commit removes something without
  its replacement.
- **Checkpoint tags** (local, lightweight) at each checkpoint:
  `projects-revamp/p1`, `/p2`, `/p3a`, `/p3b`. They are the rollback anchors.
- **PR per phase**, merged with **rebase-merge** (no squash) so each task
  commit stays individually revertible on `main`. PR body links the spec and
  lists task → commit.
- **Rollback matrix**
  | Problem found in | Roll back | Keep |
  |---|---|---|
  | one task | `git revert <task commit>` (+ dependents in reverse order) | rest of phase |
  | P3b | revert P3b PR (Bits) | P1, P2, P3a (P3a core is additive and inert without a consumer) |
  | P3a | revert P3b first, then P3a | P1, P2 |
  | P2 | revert P3b, P2 (Bits) | P1 (kit card works in chat on its own) |
  | P1 | revert everything downstream first | — |
  Bits rolls back before Bakin, always (Bits pins Bakin's SDK).
- **No data migration exists to roll back**: all frontmatter additions are
  optional with defaults; reverted code ignores unknown keys.

## Local SDK loop (one release at the end)

```
# Bakin, after each Bakin checkpoint:
bun run scripts/publish-sdk.ts --dry-run --version 0.0.0-rc.1 \
  --package-dir /tmp/bakin-sdk-revamp --keep-package-dir
# Bits:
BAKIN_SDK_DIR=/tmp/bakin-sdk-revamp bun run build
# Bits browser fixtures (real SDK) per plugins/projects/README "Tests"
```
Unit tests keep using `test-sdk/` stubs (kept in parity in T11/T33).

---

## Phase P1 — Structured questions (Bakin)

### T1: Question schema, parser and registry (D1, D2a) — S
Zod schema with field + serialized-size caps, `parseBakinQuestion`,
`mintQuestionId`, in-memory registry (put/get, 10-min TTL); re-export the
parser + type from `@makinbakin/sdk/utils`/`types`.
- Accept: oversize serialized question rejected even when fields are in cap;
  registry expires; SDK export present in public-api schema.
- Verify: `bun test tests/core/conversation-questions.test.ts --isolate`;
  `bun run ui:public-api:check`.
- Files: `packages/core/src/conversation/questions.ts`, `packages/sdk/src/utils*.ts`,
  `packages/sdk/src/types/conversation.ts`, tests.

### T2: `bakin_exec_ask_user` tool (D1, D6) — S
- Accept: valid args → short `Question posted (bakin-question:<id>)…` text and a
  registry entry; invalid args → tool error naming the cap; tool listed by
  `getAllExecTools()`.
- Verify: `bun test tests/core/exec-tools/ask-user.test.ts --isolate`.
- Files: `src/core/exec-tools/tools/ask-user.ts`, registration import, test.

### T3: Engine enrichment + question preview fallback (D2, D6a) — M · HIGH RISK
In `turns.ts`, before emit and persist: tool result chunks containing the
token get `metadata.bakinQuestion` from the registry; turns ending on a
question get preview "{agent} asked: {question}".
- Accept: enrichment works for chunks produced by the REAL Pi chunk mapper
  (summary-only) and OpenClaw mapper (500-char clipped) fed a real tool result;
  persisted row reloads with metadata; unknown/expired id → untouched; non-question
  tools untouched; chat's frozen suite still green.
- Verify: `bun test tests/core/conversation-turns.test.ts tests/core/conversation-question-enrichment.test.ts --isolate`;
  chat suite `bun test tests/plugins/chat --isolate`.
- Files: `packages/core/src/conversation/turns.ts`, new test, adapter mappers
  imported read-only in the test.
- Gate: if real adapter shapes cannot carry the token, STOP and re-spec D2.

### T4: Fold question item + derived state (D5) — M
Structural `BakinQuestion` type + guard in `packages/ui`, pinned by the private
message-contract module; fold emits a `question` item from
`metadata.bakinQuestion`; state open/answered/skipped; only the last open card
answerable; answer-message formatter (`formatQuestionAnswer`).
- Accept: fold tests for each state, last-open-only, malformed metadata → activity
  row; contract module fails typecheck on drift.
- Verify: `bun test tests/sdk/conversation-fold.test.ts --isolate`; `bun run typecheck`.
- Files: `packages/ui/src/conversation/fold.ts`, contract module, test.

### T5: `QuestionCard` + AgentTurn/Conversation/Panel wiring (D3, D4) — M
Card (radio list, Recommended label not preselected, Something else, Not sure,
note, Answer; keyboard; container-query reflow ≥ 280px; read-only while
streaming; collapsed answered/skipped). `Conversation`/`ConversationPanel` route
answers through the existing `onSend`.
- Accept: RTL — not preselected, keyboard select+submit, message format for each
  choice, disabled while streaming, collapsed states.
- Verify: `bun test tests/components/conversation-kit.test.tsx tests/components/question-card.test.tsx --isolate`;
  `bun run ui:conformance --quick`.
- Files: `packages/ui/src/conversation/question-card.tsx`, `agent-turn.tsx`,
  `conversation.tsx`, `conversation-panel.tsx`, `index.ts`, test.

### T6: QuestionCard stories + coverage ledgers — S
`CanonicalUsage` first, then states (open, answered, skipped, streaming, narrow,
Not sure) with play functions.
- Verify: `bun run ui:test:stories` (story file), `bun run ui:story-compliance:check`,
  `bun run ui:kit-coverage:check`.
- Files: `storybook/public/conversation/question-card.stories.tsx`, ledgers.

### T7: `events.appended` + appended attention notices (D6a, D24a client side) — S
`useConversationThread` refetches on `appended` without settling a live turn;
`useConversationAttention` subscribes to an optional appended event carrying
`notice`.
- Accept: appended during a live stream keeps streaming state; notice triggers
  badge/toast per the pure rules.
- Verify: `bun test tests/sdk/use-conversation-thread.test.ts tests/sdk/use-conversation-attention.test.tsx --isolate`.
- Files: `packages/sdk/src/conversation/use-conversation-thread.ts`,
  `use-conversation-attention.tsx`, tests.

### T8: PageAside `width="conversation"` (approved extension) — S
- Accept: 360px variant, collapse roundtrip unchanged, story + coverage.
- Verify: page-aside tests, `ui:story-compliance:check`, `ui:conformance --quick`.
- Files: `packages/ui/src/patterns/page-aside.tsx`, `storybook/public/Pages/collapsible-aside.stories.tsx`, test.

### T9: Chat renders question cards end to end — S
Chat already composes the kit; confirm answers route through chat send, and
attention fires for question-ending turns.
- Accept: chat page test with a scripted turn calling `ask_user` shows a card;
  answering posts the formatted message.
- Verify: `bun test tests/plugins/chat --isolate`.
- Files: `plugins/chat/components/*` (only if wiring is needed), test.

### T10: P1 docs — S (docs commit, no /verify)
`conversation-kit.md` (questions: tool, registry, enrichment, card, appended,
attention), `shared-ui-patterns.md`/`design-system.md` (PageAside width),
`CLAUDE.md` Conversation Kit bullet (one clause), `README.md` only if it lists
kit capabilities.

### ✅ Checkpoint P1
- `bun run test`, `bun run typecheck`, `bun run lint`, `bun run ui:conformance` (full),
  `bun run build`; isolated boot smoke via `/verify` (chat turn with ask_user on
  the dev mock).
- Assemble SDK tarball #1. Tag `projects-revamp/p1`. Open P1 PR. **Human review.**

---

## Phase P2 — Projects UX (Bits)

### T11: test-sdk parity — XS
Stubs for the question fold exports (`formatQuestionAnswer`, `BakinQuestion`, `Conversation` `busy`/`onAnswerQuestion`), `parseBakinQuestion`, `events.appended`,
PageAside width; `bun install`.
- Verify: `bun run typecheck` in Bits.

### T12: Authority chokepoint + title source (D9, D9a, D19) — M
One service guard with caller kind; remove `status` from `projects_update` and
`apply_plan` tool schemas; `titleSource` handling in update + `applyProjectPlan`;
delete `autoPromoteThreshold` from the manifest/settings.
- Accept: agent title write over `'user'` refused via BOTH tools; agents cannot
  set status; user rename sets `'user'`.
- Verify: `bun test plugins/projects/tests/routes.test.ts plugins/projects/tests/service.test.ts`.
- Files: `lib/project-service.ts`, `index.ts`, `bakin-plugin.json`, `types.ts`, tests.

### T13: Derived checklist completion (D16a) — M
`deriveChecklist` as the single source for every projection; reject linked
toggles (`linked_step`); delete `autoCheckLinkedItem` + done-only write; emit
`projects.changed` on board transitions.
- Accept: done→checked, reopen→unchecked across detail/list/context/enrich/tool
  returns; linked toggle rejected via REST and both tools.
- Verify: `bun test plugins/projects/tests/service.test.ts plugins/projects/tests/routes.test.ts plugins/projects/tests/sync-hook.test.ts`.
- Files: `lib/project-service.ts`, `index.ts`, tests.

### T14: Idempotent create + kickoff receipt (D8) — M
`requestId` dedupe, `kickoff` receipt, server-started first turn, boot sweep for
`pending`.
- Accept: lost-response retry → one project + one turn; crash between create and
  turn → boot sweep starts it once; busy engine leaves `pending`.
- Verify: route tests (new cases).
- Files: `index.ts`, `lib/project-service.ts`, `types.ts`, tests.

### T15: Plan revisions + pinned baseline + seen merge (D15) — M
`planRevision`/`planUpdatedBy`/`planUpdatedAt`, snapshot `revision`, retention
keeps the pinned baseline, `planSeenRevision` in a merged seen sidecar, mark-seen
endpoint.
- Accept: no-op write doesn't bump; restore bumps; baseline survives 25 edits;
  seen writes don't clobber brainstorm-seen.
- Verify: `bun test plugins/projects/tests/plan-history.test.tsx plugins/projects/tests/service.test.ts`.
- Files: `lib/project-service.ts`, `lib/parser.ts`, `types.ts`, `index.ts`, tests.

### T16: Brainstorm-buddy posture (D14) — S
Replace `PROJECT_BRAINSTORM_INSTRUCTIONS` with the stage-aware constant (ask_user
usage, one question per turn, title instruction, draft-when-firm, active =
progress mode); context builder reads derived progress.
- Accept: prompt snapshot test per status; `/ask` and `_ask` tool share it.
- Verify: route tests.
- Files: `index.ts` (or `lib/brainstorm-prompt.ts`), tests.

### T17: Start screen + delete modal (D7, D8 client) — M
`/projects/new` start screen (chips prefill, lead picker, composer, failure
restore via `ComposerHandle.setText`, stable `requestId`); list "New project"
navigates there; zero-project list renders it; delete `new-project-dialog.tsx`.
- Accept: RTL — chip prefill no create; send → create → navigate; failure keeps
  text and retry reuses requestId.
- Verify: `bun test plugins/projects/tests/start-screen.test.tsx plugins/projects/tests/project-list.test.tsx`.
- Files: `components/start-screen.tsx`, `client.tsx`, `components/project-list.tsx`, delete dialog, tests.

### T18: Header, next-step button, Details, inline rename (D11, D12, D13) — M
`project-header.tsx`: badge + next-step (P2 Start = plain confirm → active;
Mark complete with unfinished-steps confirm; Reopen; Unarchive via
`archivedFrom`), ⋯ (Archive, Details, Delete), Details dialog (lead picker,
dates, ID), inline title rename with expected-value check.
- Verify: RTL header tests; route test for archive/unarchive.
- Files: `components/project-header.tsx`, `components/project-details-dialog.tsx`,
  `index.ts`/service (archivedFrom), tests.

### T19: Tabs + chat dock; delete rail, `/edit`, draft form (D10) — L→kept M by moving tab bodies to T20–T22
Rewrite `project-detail.tsx` as shell: header + tabs (`?tab`, default by
stage) + Conversation tab + dock (PageAside conversation width, single mounted
`ConversationPanel`, collapse preference, mobile Ask button). Delete right
rail, resize divider, `/projects/:id/edit` route, `ProjectDraftForm`,
4-field `use-project-draft`. Tabs Plan/Steps/Files render placeholders replaced
in T20–T22 within the same PR (each task commit still builds and passes).
- Accept: composer count = 1 in every tab/collapse/breakpoint combo; draft
  preserved across switches; default tab by stage.
- Verify: `bun test plugins/projects/tests/project-detail.test.tsx`; ui fixture run.
- Files: `components/project-detail.tsx`, `components/chat-dock.tsx`, `client.tsx`,
  delete `project-draft-form.tsx` + 4-field draft hook, tests.

### T20: Plan tab (D12 plan edit, D15 UI) — M
Rendered plan, Edit plan (`?edit=1`) with SaveBar + conflict handling (body-only
draft), Changes/History view, Plan dot + "Plan updated" notice above composer.
- Verify: RTL plan tab + notice tests; `project-conflicts.test.ts` updated.
- Files: `components/tabs/plan-tab.tsx`, body-only draft hook, `plan-history.tsx`, tests.

### T21: Steps tab (D16) — M
One-column checklist, progress, words for board state, Send to board, Open task,
read-only linked checkbox, empty state.
- Verify: `checklist-drafts`/`checklist-operations` tests + new steps-tab RTL.
- Files: `components/tabs/steps-tab.tsx`, `project-checklist.tsx`, tests.

### T22: Files tab (D17) — M
Server route `GET /:projectId/files` (bounded fan-out over `assets.listByTask`,
dedupe) + tab with Produced/Attached groups, attach/relink/detach, preview.
- Verify: route test with mocked hook; RTL files tab.
- Files: `index.ts`, `components/tabs/files-tab.tsx`, tests.

### T23: List refresh (D18, P2 subset) — S
Resume signal (Waiting for you, Working, Plan updated, n of m), archived hidden
by default.
- Verify: `project-list.test.tsx`.
- Files: `components/project-list.tsx`, `components/project-row.tsx`, list route summary fields, tests.

### T24: Mobile + real-SDK browser fixtures — M
Replace edit fixtures with start-screen + detail-tabs fixtures (desktop/mobile),
dock/composer-count/draft browser checks.
- Verify: `bun run test:ui && bun run test:ui:collections` with `BAKIN_SDK_DIR`.
- Files: `tests/*.ui-test.ts`, `tests/detail.browser-test.ts`, fixtures.

### T25: P2 docs (docs commit)
Bits `plugins/projects/README.md` (rewrite Editing/Collections/Tests sections),
`UI-AUDIT.md` (new pattern map), Bits root README if it describes Projects;
Bakin `.claude/knowledge/conversation-kit.md` consumers list.

### ✅ Checkpoint P2
- Bits `bun run typecheck && bun run lint && bun run test && bun run build`
  (with `BAKIN_SDK_DIR`), browser fixtures green; manual walk on the dev rig
  (isolated mode) against tarball #1: create → grill → plan → steps.
- Tag `projects-revamp/p2`. Open P2 PR. **Human review.**

---

## Phase P3a — Core for the steward (Bakin)

### T26: One `tasks.statusChanged` chokepoint (D21) — M · HIGH RISK
Emit from the task-store column write; delete per-path emissions in
`task-service.ts`; cover move, block, SDK update/move.
- Accept: each path emits exactly once; existing consumers (workflows, projects
  hooks, tasks plugin) green.
- Verify: `bun test tests/core/task-service.test.ts tests/core/task-status-hook.test.ts tests/plugins/workflows --isolate`.
- Files: `packages/core/src/tasks/store.ts`, `src/core/task-service.ts`, tests.
- Gate: any double-emission or ordering regression in workflows → stop.

### T27: `tags` through `ctx.tasks` (D30) — S
SDK types, facade, `createTaskWithEffects`, task-store facade, `toPluginTask`.
- Accept: create with tags → stored → readback → `resolveDispatchRouting` picks
  the tag route.
- Verify: `bun test tests/lib/plugin-context-services.test.ts tests/core/model-routing.test.ts --isolate`.

### T28: `appendExternal` on the turn service + `ctx.conversations` (D24a) — M
Append now when idle; queue and flush at slot release before next admission;
emits `appended` with optional notice.
- Accept: no interleaving with a live turn; flush precedes next admission;
  settle-shape matrix extended.
- Verify: `bun test tests/core/conversation-turns.test.ts --isolate`.
- Files: `turns.ts`, `plugin-context-factory.ts`, SDK context types, tests.

### T29: `plugin-gate` owner kind + core dispatcher (D26) — M
Owner union member with required `taskId`; one kind handler dispatching to
`(pluginId, gateKind)` handlers; rehydration with lazy lookup and honest
unavailability; provenance unchanged.
- Verify: `bun test tests/core/approvals*.test.ts --isolate`.
- Files: `packages/core/src/approvals/schema.ts`, `src/core/approvals/{kinds,service,rehydration}.ts`, tests.

### T30: `ctx.approvals` API (D26) — M
`registerGate`, `request({approvalId,…})`, `cancel`, `listPending`; namespaced;
auto-teardown on deactivate/hot reload; SDK types; SDK testing harness support.
- Verify: plugin-context tests + hot-reload sweep test.
- Files: `src/lib/plugin-context-factory.ts`, `packages/sdk/src/types/context.ts`,
  hot-reload sweep, `packages/sdk/src/testing/*`, tests.

### T31: ApprovalPanel `plugin-gate` renderer — S
- Verify: approval-panel tests + story; `ui:conformance --quick`.
- Files: `plugins/tasks/components/approval-panel.tsx`, story, test.

### T32: P3a docs (docs commit)
`approvals.md` (plugin-gate, ctx.approvals), `plugin-system.md` (ctx.approvals,
appendExternal, tags), `tasks-plugin.md` + `execution-ledger.md`/`dispatch.md`
if they describe statusChanged emission, `conversation-kit.md` (appendExternal),
CLAUDE.md Approvals bullet (owner union).

### ✅ Checkpoint P3a
Full Bakin gates + build + `/verify` boot smoke. Assemble SDK tarball #2. Tag
`projects-revamp/p3a`. Open P3a PR. **Human review.**

---

## Phase P3b — Steward (Bits)

### T33: test-sdk parity for P3a exports — XS

### T34: Scan, digest, fingerprint (D20, D20a) — M
Pure functions over (project, tasks): signals, steward exclusion, canonical
fingerprint, re-raise window.
- Verify: `bun test plugins/projects/tests/steward-scan.test.ts` (table-driven,
  unchanged-digest-across-N-intervals case).
- Files: `lib/steward/scan.ts`, `lib/steward/digest.ts`, test.

### T35: Reservation, reconcile, cap, timer + event trigger (D21, D22) — M
Reconcile table, frozen inputs, single-flight, daily cap, timer in
activate/onShutdown, 30s per-project debounce on `tasks.statusChanged`, steward
prompt assembly (byte-capped).
- Accept: simultaneous timer+event+manual triggers → one task; crash between
  reserve and create → recovered once; steward completion never re-triggers.
- Verify: `bun test plugins/projects/tests/steward-reservation.test.ts`.
- Files: `lib/steward/reservation.ts`, `lib/steward/prompt.ts`, `index.ts`, tests.

### T36: Checkin + input gate (D24, D25) — M
`checkin` and `request_input` tools with steward identity check, out-of-turn
appends via `appendExternal`, `waitingOn` → `replyPending` ordering in `/ask`,
boot sweep, same-turn refusal.
- Verify: route/tool tests for each transition incl. busy and abort.
- Files: `index.ts`, `lib/steward/tools.ts`, `lib/project-service.ts`, tests.

### T37: Sign-off gates + completion cleanup (D26, D28) — M
`request_signoff` tool, `registerGate('complete'|'signoff')`, deterministic ids
+ generations, effects, ownerState, cleanup excluding the resolving approval.
- Verify: gate lifecycle tests (approve, reject, re-request, stale, concurrent
  manual complete).
- Files: `lib/steward/gates.ts`, `index.ts`, tests.

### T38: UI — hand-off Start, Pause/Resume, signals — M
Replace P2 Start confirm with the hand-off dialog (D27); ⋯ Pause/Resume + Paused
badge; list signals Needs approval / Stuck / Check-ins paused for today.
- Verify: RTL header + list tests; browser fixture update.
- Files: `components/start-project-dialog.tsx`, `project-header.tsx`, `project-list.tsx`, tests.

### T39: Steward settings + docs (D29)
Settings schema; Bits README (Steward section: cadence, authority enforced vs
advisory, gates, pause, costs) + UI-AUDIT; Bakin knowledge cross-links.

### ✅ Final checkpoint
- Both repos: full gates, builds, browser fixtures, Bakin `ui:conformance` full.
- Dev rig (isolated) end to end on the mock runtime AND Pi: start → grill (cards)
  → draft plan → Start → steward promotes/delegates → block a task → steward
  check-in → request_input → answer → all done → completion approval → Completed
  lands on Files.
- Tag `projects-revamp/p3b`. Then the single release: Bakin rc (SDK publish) →
  bump Bits `@makinbakin/sdk` peer floor + compatibility pin → Projects tag.
  **Human approval before any tag/push.**

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Real adapters strip the question token | High | T3 tests real mappers first; stop-and-respec gate |
| statusChanged chokepoint double-fires / reorders workflows | High | T26 isolated early in P3a; workflows suite as gate; revertible alone |
| Single-mounted composer remount loses state mid-stream | Med | T19 browser check of composer count + draft; thread state lives in the page hook, not the panel |
| Steward cost runaway | Med | fingerprint gate, daily cap, budget gate, tag routing to cheap model |
| test-sdk stub drift hides real API mismatches | Med | browser fixtures run against the real assembled SDK at every Bits checkpoint |
| Long-lived unreleased branches drift from main | Med | rebase each branch onto main at every checkpoint; one release at the end is the user's call |
| Bits styles/census circular dependency (memory) | Low | run census/styles gates with Bits checked out at the branch under test |

## Open questions
None blocking. Release mechanics follow `.claude/knowledge/release-pipeline.md`
and Bits `RELEASE.md` at the final checkpoint.
