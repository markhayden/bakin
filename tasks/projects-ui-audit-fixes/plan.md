# Projects audit fixes — implementation plan

Status: approved by the user ("approve"); implementation and local checkpoint commits authorized.
Spec: [approved specification](../../.claude/specs/projects-ui-audit-fixes.md).
Execution checklist: [todo.md](todo.md).

## Outcome and scope

Close every finding in the Projects UI audit: protect staged edits and independent
checklist writes; provide reliable navigation/retry/conflict handling; correct
detail accessibility and narrow layout; distinguish missing/empty/failed data;
show meaningful progress and labels; and preserve complete Markdown structure
while highlighting changes. Implement the approved AgentSelect and MarkdownContent
extensions through Storybook before consuming them.

All eight product decisions in the spec are accepted. This plan adds the concrete
implementation and verification decisions, not another product interview.
No compatibility adapter, second renderer/router, or broad plugin framework rewrite.

Repositories (paths in tasks are relative to these roots):

- **Core:** `/Users/markhayden/go/src/github.com/markhayden/bakin`, current baseline
  `ecf7e1b24051f8c965715b3a72aa4739c74bc47a`.
- **Bits:** sibling `bakin-bits-official`, current baseline
  `abd94c03e9d69ab9ef77d522654d8927e440e4f0`.
- Existing dirty work remains in stash named `pre-projects-audit-kickoff`; never
  apply, drop, or overwrite it as part of this work. Both checkouts are on main.
- Use this task directory rather than overwrite `tasks/plan.md` and `tasks/todo.md`,
  which record the completed SDK cleanup work.

## Findings from plan validation

1. `fetchProject` preserves fields while editing but replaces the server record
   used as the dirty baseline. A refresh can therefore make an untouched field
   appear dirty. Fix the state model, not only the save handler.
2. Detail route wrappers are unkeyed; read/edit are distinct route components.
   Verify remount behavior with the real router, including independent drafts.
3. `promoteItemToTask` releases the project lock before task creation; two requests
   can both create. `ctx.tasks.create` already accepts `id` and `source`, and the
   task store rejects duplicate IDs. No new task SDK API is required.
4. `nextTaskItemId` can reuse the last deleted `tNNN` ID. Operation identity must
   not depend only on a checklist item's display ID.
5. History parsing currently returns an empty array for corrupt JSON, hiding a
   storage failure as an empty history. Fix repository-to-UI error propagation.
6. The composer removes its outline; the contained transcript scroll element has
   no keyboard target. Trace these in a real browser before claiming ownership
   of all six diagnostic findings. Do not loosen the keyboard scanner.
7. MarkdownContent itself parses managed sections separately. Merely replacing
   Projects' blank-line splitter with another splitter would still lose references.
8. Shared-ui-patterns describes a deleted AgentSelect adapter and `agentIds` prop.
   Update that section against the actual `/patterns` contract.
9. ScopedPluginStorageAdapter.write uses writeFileSync directly. Reuse Core’s
   existing atomicWriteText before relying on single-file item+receipt replacement.
   This protects against partial replacement, not a claimed fsync/power-loss
   transaction across files.
10. Composer has a public isEmpty/setText/focus handle, but ConversationPanel does
    not forward it. The forwarding-only public extension was explicitly approved in Q9.

## Technical decisions

### A. Draft and request ownership

Introduce a small Projects domain hook/reducer that owns baseline, draft, latest
server values, per-field conflicts, and submitted snapshots. Keep it independent
of React rendering for deterministic tests. The four project fields share one
Form and SaveBar. Checklist forms remain separate siblings, with draft descriptors
registered with the page's exit coordinator; no nested forms.

Use a typed Projects request helper with explicit HTTP failure and invalid-response
handling. Detail/history reads use AbortController plus request generation checks;
aborting is cleanup, and identity/generation checks enforce correctness. Separate
initial replacement errors from refresh errors that retain valid visible data.

Keep project state mounted across its read/edit routes where practical, or hoist
the session into a keyed project owner. Key isolation by project ID, not edit mode.
Do not maintain a second router or infer edit mode from ad hoc URL parsing.

### B. Conflict protocol

For browser project saves, send a typed patch and expected values for exactly the
fields being changed. Under the existing project lock, compare current values:
expected matches => apply; requested value already equals current => converged
success; otherwise => return structured HTTP 409 with conflicting field values.
Validate the whole patch before writing any field. Never key conflict detection
only on `updated`, since checklist/asset activity changes that timestamp too.

Keep My Value means retry against the latest value actually reviewed. It is not
an unrestricted force flag. A second update conflicts again. Use Latest changes
the local draft explicitly. The body is one field; no automatic prose merge.
Description writes use the same expected-value principle. Remote item deletion
is an unavailable item, never an implicit create. Typed errors distinguish 400
validation, 404 missing, 409 conflict, and 5xx storage/service failures.

Keep the ordinary agent update service as the domain write path, with shared
validation; browser preconditions are opt-in concurrency intent, not a legacy
compatibility layer. Agent writes that happen during a browser edit are detected
by the browser's expected-value check. Update all affected REST/tool descriptions.

### C. Retry-safe checklist creation and promotion

Persist narrow operation records with the project, not in a new global service.
An operation has a random request identity, kind, normalized payload identity,
target identity, phase, and confirmed result. Parser/serializer preserve this
metadata; API projections expose only the recovery information clients need.

- Add: write the new item and completed operation result together in the same
  project write under the lock. Repeating the same request returns the same item;
  reusing a key with different content returns a conflict. Deleting the item does
  not erase its receipt or let an old retry recreate it. Existing projects simply
  have no operation records until needed; do not rewrite the fleet.
- Promote: persist a reservation with a stable random board-task ID and source
  provenance before calling `ctx.tasks.create`. Coordinate concurrent calls for
  the same reservation; do not hold the global project lock across external task
  creation/hook awaits. On retry/restart, use `ctx.tasks.get(id)` and verify source
  ownership before creating/linking. If create succeeded but link failed, resume
  linking the exact task. Never allocate a replacement ID on an uncertain failure.
- If the item/project disappears or a reserved task has incompatible identity,
  show an actionable conflict; do not delete someone else's task or resurrect
  the project. A board task that exists after a failed downstream effect is not
  proof all effects succeeded: report the actual result and reconcile through
  existing task mechanisms, without replaying task creation blindly.
- Keep receipts for the project lifetime in this single-user scope; no TTL that
  would make an old request silently execute twice. Delete receipts with the
  project. Vet storage atomicity and fault injection before enabling UI retries.

This is scoped mutation bookkeeping for two operations, not a general job queue.
The implementation must prove create/link crash windows before claiming safety.

### D. Exit coordination and partial saves

Use `useUnsavedChangesGuard` for all in-app exits. Validate all captured drafts
before any write. Save the project draft first (including conflict resolution),
then description drafts in stable item order, then the pending new task. Mark
each successful snapshot clean and retain later local changes. On failure stay
put, report confirmed successes and the unresolved draft, and retry only pending
operations with their original request identities. Leave only when all drafts
are clean. Busy operations cannot be discarded halfway through an uncertain write.

The project SaveBar affects only the four project fields. Discard and Leave from
the exit dialog discards all unsaved project/checklist drafts, not confirmed work.
The composer retains its existing per-project persistence and is never submitted
by Save All. Browser refresh/tab-close uses native beforeunload, not custom copy.

### E. Canonical Markdown comparison

Add optional `compareTo?: string` to MarkdownContent. Use the existing remark/GFM
pipeline to parse each full document, including reference definitions, before
creating render annotations. Declare any directly imported parser packages as
direct dependencies (currently resolved `remark-parse@11.0.0`, `unified@11.0.5`);
never rely on transitive resolution or add a second Markdown implementation.

Build semantic block fingerprints and a bounded sequence comparison. Whole lists,
tables, blockquotes and fenced code remain intact; references contribute to the
comparison of affected rendered blocks. Attach metadata while retaining source
positions; consume it in the canonical renderer. Managed-section comments are
presentation metadata in the same parse, not a reason to split source. Keep raw
HTML disabled and URL handling intact. Wrap only legal flow containers; never
insert div children into table/list internals.

Budget comparison work explicitly (initial ceiling: 1,000,000 comparison steps;
verify/tune with representative large documents before finalizing). At the ceiling,
render the complete current document with an explicit comparison-unavailable
notice. Do not imply no changes. Parsing/plain reading remains available. Tests
assert bounded operations, not flaky elapsed-millisecond limits.

Pure deletions have positioned accessible markers, including start/end and an
empty current document. Moves may appear as removal/addition, while document
meaning remains unchanged. Exact line review stays in the existing Diff view.

### F. UI composition and state

- Owner/status are read-only metadata until Edit; form uses md/outlined owner,
  lg/outlined title, checked/radio status choices, specialized MarkdownEditor.
- AgentSelect forwards approved size/variant props to SelectTrigger; no duplicate
  variant CSS. Brainstorm uses sm/filled, with no filled border.
- Checklist description uses Field + sm/outlined Textarea, auto-grow 2–6 rows.
  Completed items are shown by default; hide preference is per-project. Counts
  and progress include hidden items. An edited item stays available until resolved.
- Use the Page archetype, its body/aside/scroll contracts, Section/Stack, wrapping
  command rows, and existing Collapsible for optional brainstorm. Preserve the
  project sidebar resize contract where supported; an unmet composition need
  requires a concrete proposal, not new local chrome.
- Keep collapsed conversation content mounted with supported `keepMounted`,
  hiding keyboard targets correctly. Approved Q9 adds optional
  `composerHandleRef?: Ref<ComposerHandle>` to ConversationPanel, forwarding
  Composer’s existing handleRef. Inspect isEmpty after draft hydration on initial
  mount/project change; reconcile storage-key effects and avoid briefly hiding a
  restored draft. Preserve explicit user collapse during ordinary rerenders. No
  new draft store, copied storage keys, or automatic send.
- Focus rings and scroll semantics belong to shared Composer/Conversation when
  reproduction confirms it. Projects owns section headings, wrapping, and labels.

## Task sequence

Every task below has at most five primary files; generated artifacts are called
out separately. A task that grows beyond that is split before implementation.
Work is sequential by default. Independent tracks are noted for scheduling, not
authorization to launch additional agents.

### T01 — Establish isolated baseline and execution records

**Depends:** plan approval. **Repo:** both. **Size:** S.
**Files:** this plan, todo, `tasks/projects-ui-audit-fixes/evidence.md` (new).
**Do:** create `feat/projects-audit-sdk` and `feat/projects-audit-fixes` from fresh
main; preserve the stash; record exact revisions and tool versions. Install the
pinned Bun dependencies in each repo. Keep the user's dev instance untouched.
**Accept:** clean attributable changes, reproducible baseline, existing audit and
spacing reports retained. Check current core/Bits census drift without rewriting
the matrix just to pass.
**Verify:** status/diff checks; Core quick conformance; Bits focused Projects tests,
typecheck/lint and existing installed-package fixtures. Record pre-existing failures.

### T02 — Reproduce detail diagnostics and risky write behavior

**Depends:** T01. **Repo:** Bits. **Size:** M.
**Files:** new `plugins/projects/tests/detail.fixture.tsx`, `detail.ui-test.ts`,
`detail-fixture-data.ts`, evidence.md (Core).
**Do:** build a synthetic real-SDK detail fixture with read/edit/error/history and
conversation states. Trace keyboard failures and request races; fault-inject
promotion's create/link boundary using existing mocks.
**Accept:** each original finding reproduced or explained with evidence; no live
requests/agents; no scanner suppression. Keep the known-failing diagnostic out of
the required CI command until fixed, labelled diagnostic rather than conformant.
**Verify:** run fixture desktop/mobile and manual keyboard/200%-text inspection.

### T02b — Make scoped plugin replacement writes atomic

**Depends:** T01. **Repo:** Core. **Size:** S; execute before T13.
**Files:** `packages/core/src/storage/scoped-plugin-storage.ts`,
`tests/core/scoped-plugin-storage.test.ts`.
**Accept:** scoped path resolution stays enforced; write uses existing
atomicWriteText; append stays unchanged. Failure before rename preserves the old
complete file; success replaces it wholly; failed temporary files are cleaned.
**Verify:** fault-injected write/rename tests, existing scoped storage contracts,
watcher/event behavior under rename-based replacement. Commit C0b.

### T03 — Implement AgentSelect's approved appearance contract

**Depends:** T01. **Repo:** Core. **Size:** M.
**Files:** `storybook/public/agents/agent-select.stories.tsx`,
`packages/sdk/src/patterns/agent-patterns.tsx`,
`tests/ui/patterns/agent-identity-patterns.test.tsx`,
new `tests/ui/browser/agent-select.browser.pw.ts`.
**Accept:** Storybook first; sm/md/lg and outlined/filled/ghost default md/outlined;
avatar/name alignment, error/disabled/empty/grouped options work at narrow/large text.
**Verify:** focused unit/story/browser tests, quick conformance. Capture candidate
visuals without replacing approved PNGs. Commit C1 when green.

### T04 — Preserve full Markdown context through managed sections

**Depends:** T01. **Repo:** Core. **Size:** M.
**Files:** `packages/sdk/src/content/markdown-content.tsx`, new
`packages/sdk/src/content/markdown-document.ts`,
`tests/ui/patterns/markdown-patterns.test.tsx`,
`storybook/public/content/markdown-content.stories.tsx`, `package.json` (+ lockfile).
**Accept:** red fixtures for references across sections/lists/fences; parse whole
documents; retain managed presentation, code/media/URL behavior and valid HTML.
**Verify:** focused Markdown unit/story tests and packed-content browser test.
Commit C2; no comparison API consumed until T05.

### T05 — Add bounded, accessible Markdown comparison

**Depends:** T04. **Repo:** Core. **Size:** M.
**Files:** MarkdownContent and its story; new `content/markdown-comparison.ts`,
`tests/ui/patterns/markdown-comparison.test.tsx`,
`tests/ui/browser/markdown-comparison.browser.pw.ts` (full paths as T04).
**Accept:** approved compareTo contract; semantic parity; additions/edits/deletions,
empty/identical/moved content, references and explicit budget-exhaustion behavior.
**Verify:** unit operation bounds; browser semantics, geometry, accessible hints,
code copy and links. Story interactions prove comparison state. Commit C3.

### T06 — Correct shared composer focus behavior

**Depends:** T02. **Repo:** Core. **Size:** M.
**Files:** `packages/ui/src/conversation/composer.tsx`,
`storybook/public/conversation/composer.stories.tsx`,
`tests/ui/conversation/composer.test.tsx`, new
`tests/ui/browser/conversation-accessibility.browser.pw.ts`.
**Accept:** reproduce and fix visible keyboard focus using established tokens;
preserve typing, IME, send/stop, attachments, and draft behavior.
**Verify:** focused tests and actual focus screenshots/keyboard trace. No harness
exception or visual baseline replacement. Commit C4a.

### T07 — Correct contained conversation keyboard scrolling

**Depends:** T02, T06. **Repo:** Core. **Size:** M.
**Files:** `packages/ui/src/conversation/conversation.tsx`,
`storybook/public/conversation/panel-and-drawer.stories.tsx`,
`tests/ui/browser/conversation-accessibility.browser.pw.ts`,
`tests/ui/conversation/conversation.test.tsx` (existing or new).
**Accept:** named keyboard-accessible scroll region in contained mode without
extra meaningless tab stops in document mode; complete traversal and preserved
pin-to-bottom/scroll behavior. Explain each remaining Projects diagnostic.
**Verify:** browser keyboard and axe at both widths, streaming/empty/populated
scenarios. Commit C4b.

### T07b — Forward the existing composer handle through ConversationPanel

**Depends:** T07; Q9 is explicitly approved. **Repo:** Core. **Size:** M.
**Files:** `packages/ui/src/conversation/conversation-panel.tsx`,
`storybook/public/conversation/panel-and-drawer.stories.tsx`,
`tests/ui/conversation/panel-drawer.test.tsx`,
`tests/ui/browser/conversation-accessibility.browser.pw.ts`.
**Accept:** optional composerHandleRef forwards ComposerHandle with no new
methods. Story demonstrates restored draft, empty check and focus. Read-only mode
has no live composer handle. Mount, storageKey change, disclosure and cleanup work.
**Verify:** ref lifecycle tests and browser restored-draft/empty/focus cases;
Projects never accesses private localStorage keys. Commit C4c.

### T08 — Publish shared contract evidence and docs

**Depends:** T02b, T03–T07, T07b. **Repo:** Core. **Size:** M plus generated artifacts.
**Files:** `.claude/knowledge/style-guide.md`, `shared-ui-patterns.md`,
`conversation-kit.md`, `docs/src/content/docs/extending/ui/overview.md`,
`tests/ui/visual/projects-foundation.visual.ts` (new).
**Accept:** corrected AgentSelect docs, comparison/focus guidance, public API
review and packed SDK types; candidate screenshot and payload report. Generate
canonical API/CSS/docs only by their owners; no freeze/ceiling bypass.
**Verify:** focused package tests, docs check, quick then full conformance. Obtain
exact visual-baseline approval if replacements/additions are required; run all
remaining checks while that review is pending. Commit C5 after approved artifacts.

### Checkpoint A — Shared foundation

T03–T08 must be green before final Bits consumption. Publish a reviewable Core PR
with exact tested SDK commit; assemble a dry-run package from that commit. Merge
requires user instruction. A fetched prerequisite commit can serve Bits CI before
merge, but prefer Core first. Do not repin Bits to an unpublished local hash.

### T09 — Centralize detail requests and honest load states

**Depends:** T01. **Repo:** Bits. **Size:** M.
**Files:** new `plugins/projects/lib/project-api.ts`,
`hooks/use-project-detail.ts`, `components/project-detail.tsx`,
`tests/project-loading.test.tsx`, `types.ts`.
**Accept:** distinguish loading/404/5xx/network/invalid payload; generation-safe
reads preserve valid data on refresh failure; remove duplicate ProjectData shape
that currently omits checklist descriptions.
**Verify:** deferred-response unit tests A→B navigation, retry, unmount and stale
refresh ordering; existing detail tests. Commit C6.

### T10 — Propagate corrupt/unavailable history honestly

**Depends:** T01. **Repo:** Bits. **Size:** M.
**Files:** `lib/parser.ts`, `index.ts`, `tests/parser.test.ts`, `tests/routes.test.ts`.
**Accept:** no history file means empty; malformed/storage failure means an error;
restore preserves existing expected snapshot identity and snapshot-before-write.
**Verify:** isolated repository/route failures, 404 vs empty, corrupt data never
rewritten by a read. Commit C7a.

### T11 — Unify history loading and retry presentation

**Depends:** T09, T10. **Repo:** Bits. **Size:** M.
**Files:** new `hooks/use-plan-history.ts`, `components/plan-history.tsx`,
`components/rendered-plan.tsx`, `components/project-detail.tsx`,
`tests/plan-history.test.tsx`.
**Accept:** one consistent history source; current plan remains visible on history
failure; retry/restore failures stay actionable; stale requests cannot replace
new project/history data. Snapshot chooser and restore button sizes align.
**Verify:** out-of-order loads, restore exceptions, no-history, unavailable history,
new-body refresh; existing spacing tests. Commit C7b.

### T12 — Implement atomic expected-value project writes

**Depends:** T09. **Repo:** Bits. **Size:** M.
**Files:** new `lib/project-mutations.ts`, `lib/project-service.ts`, `index.ts`,
new `tests/project-conflicts.test.ts`, `types.ts`.
**Accept:** typed validated expected-field patch, atomic conflicts, equal-value
convergence, structured errors, and a second-update race after user resolution.
**Verify:** pure state/route/service tests under real lock with isolated storage;
body snapshots emitted only for confirmed changes. Commit C8.

### T13 — Persist replay-safe checklist add operations

**Depends:** T02b, T12. **Repo:** Bits. **Size:** M.
**Files:** `lib/project-mutations.ts`, `lib/project-service.ts`, `lib/parser.ts`,
`types.ts`, new `tests/checklist-operation-recovery.test.ts`.
**Accept:** stable request identity; item+receipt in one project write; duplicate
key returns same result; mismatched payload conflicts; deletion/restart/reused
display IDs cannot recreate an old item. Receipts preserved by serialization.
**Verify:** fault-injected writes and restart/replay tests using temp storage;
inspect growth using a realistic long project. Commit C9a.

### T14 — Recover promotion without duplicate board tasks

**Depends:** T13. **Repo:** Bits. **Size:** M.
**Files:** `lib/project-service.ts`, `lib/project-mutations.ts`, `index.ts`,
`tests/checklist-operation-recovery.test.ts`, `tests/routes.test.ts`.
**Accept:** reservation before create, same stable task ID on retry, concurrent
requests coalesce/reconcile, verified ownership before linking, no lock-held hook
deadlock. Deleted target or partial downstream failure yields honest recovery.
**Verify:** fail before/after task creation/link, concurrent calls, process-state
reset, foreign ID collision, item removal during create. Test ctx.tasks mocks honor
real duplicate-ID behavior. Commit C9b.

### T15 — Decouple lifecycle from checklist progress

**Depends:** T12. **Repo:** Bits. **Size:** M.
**Files:** `lib/project-service.ts`, `index.ts`, `tests/service.test.ts`,
`tests/routes.test.ts`, `tests/sync-hook.test.ts`.
**Accept:** no auto-completion from user/linked-task checking; explicit Completed
allowed with unchecked/newly appended items; tool copy reflects behavior.
**Verify:** route/tool/service/sync assertions; existing stored statuses unchanged.
Commit C10.

### Checkpoint B — Reliable domain behavior

T09–T15 must pass the full Bits suite/typecheck/lint/build. Do not move into a
retrying UI while operation recovery is unproven. Document exact response schemas
and storage additions in evidence. No database migration or global engine added.

### T16 — Implement project draft state independently of rendering

**Depends:** T12. **Repo:** Bits. **Size:** M.
**Files:** new `lib/project-draft.ts`, `hooks/use-project-draft.ts`,
`tests/project-draft.test.ts`, `lib/project-api.ts`.
**Accept:** baseline/draft/latest separation, touched-field merge, equal-value
convergence, snapshot-safe save completion, cancel resets all four fields.
**Verify:** deterministic reducer/hook interleavings, including typing during save
and refresh failure after committed success. Commit C11a.

### T17 — Connect the staged project form

**Depends:** T03, T09, T15, T16. **Repo:** Bits. **Size:** M.
**Files:** `components/project-detail.tsx`, new `components/project-form.tsx`,
`tests/project-detail.test.tsx`, `test-sdk/patterns.js`, `test-sdk/ui.js`.
**Accept:** one Form/SaveBar; no immediate owner/status writes; appropriate shared
controls and checked status choices; persistent errors and clear saving/saved
feedback. Remove implementation-mirroring class assertions in affected tests.
**Verify:** behavioral form tests with minimal stubs; real SDK fixture verifies
actual controls, form associations and no nested forms. Commit C11b.

### T18 — Compose explicit field conflict resolution

**Depends:** T16, T17. **Repo:** Bits. **Size:** M.
**Files:** new `components/project-conflict-dialog.tsx`,
`hooks/use-project-draft.ts`, `components/project-form.tsx`,
new `tests/project-conflict-dialog.test.tsx`, `tests/detail.fixture.tsx`.
**Accept:** show named fields and both values; explicit Keep Mine/Use Latest;
continued editing loses nothing; reviewed-version retry conflicts again if needed.
**Verify:** unit/UI tests; real dialog keyboard/focus return, long Markdown and
narrow layout. Commit C12.

### T19 — Own independent checklist mutations and drafts

**Depends:** T13, T14, T16. **Repo:** Bits. **Size:** M.
**Files:** new `hooks/use-project-checklist.ts`, `lib/project-api.ts`,
`components/project-checklist.tsx`, `components/project-detail.tsx`,
new `tests/project-checklist.test.tsx`.
**Accept:** Promise-based mutation outcomes, per-item busy state, response checks,
expected-description conflict checks, durable request identities; never clear a
draft before success. Centralize writes instead of child fetch plus parent fetch.
**Verify:** all five operation failure/retry paths, rapid toggles, concurrent
refresh, item disappearance, saved-success/failed-refresh distinction. Commit C13a.

### T20 — Make checklist editing and progress accessible

**Depends:** T19. **Repo:** Bits. **Size:** M.
**Files:** `components/project-checklist.tsx`, optional extracted
`components/project-checklist-item.tsx`, `tests/project-checklist.test.tsx`,
`tests/detail.fixture.tsx`.
**Accept:** task-specific action names, labeled auto-grow description, actual
Form/InputGroup submission, completed visibility preference/counts, hidden-all
guidance, no implicit loss of an open description draft.
**Verify:** keyboard/Enter/IME, validation/error association, text growth, progress
while hiding completed, empty checklist and all-completed cases. Commit C13b.

### T21 — Coordinate all drafts with the shared exit guard

**Depends:** T18–T20. **Repo:** Bits. **Size:** M.
**Files:** new `hooks/use-project-exit.ts`, `client.tsx`,
`components/project-detail.tsx`, new `tests/project-exit.test.tsx`,
`test-sdk/navigation.js`.
**Accept:** stable per-project route ownership; Save All/Discard/Stay with correct
scope and partial success; failure/conflict keeps destination pending; native
beforeunload; composer never sent. New edits during save prevent premature exit.
**Verify:** real router/browser Back, internal link, read/edit transition, cross-
project navigation, partial failure and retry. Stub tests supplement, never replace,
real navigation verification. Commit C14.

### T22 — Compact optional mobile brainstorm without losing state

**Depends:** T06, T07, T07b, T21. **Repo:** Bits. **Size:** M.
**Files:** new `components/project-brainstorm.tsx`, `components/project-detail.tsx`,
new `tests/project-brainstorm.test.tsx`, `tests/detail.fixture.tsx`.
**Accept:** approved initial state rules; preserved composer/scroll/agent/turn;
hidden content removed from tab order; status/error/Stop accessible; no focus steal.
**Verify:** empty, stored text, populated, streaming and failed conversations;
collapse/reopen and desktop/mobile transitions. Use the approved forwarded handle for draft-based mobile defaults. Commit C15.

### T23 — Finish detail layout, headings, labels and asset feedback

**Depends:** T17, T20–T22. **Repo:** Bits. **Size:** M.
**Files:** `components/project-detail.tsx`, `components/project-form.tsx`,
`tests/project-detail.test.tsx`, `tests/detail.fixture.tsx`.
**Accept:** semantic headings, toolbar wrap, contained/keyboard scrolling and
sidebar resize; Project info/Checklist progress labels; Attach guidance. Check
attachment response failures so guidance leads to an honest operation.
**Verify:** 320px/200%-text/desktop geometry; long title/agent names; six original
diagnostics closed without suppressions. Commit C16.

### T24 — Consume canonical Markdown comparison in Projects

**Depends:** T05, T11. **Repo:** Bits. **Size:** M.
**Files:** `components/rendered-plan.tsx`, remove unused `lib/block-diff.ts`,
`tests/plan-history.test.tsx`, `tests/plan.fixture.tsx`, `test-sdk/content.js`.
**Accept:** one full-document MarkdownContent render, previous baseline passed
only when available/enabled; no blank-line split renderer. Keep line-diff/LCS
code used by the precise Diff view. Keep plain/empty/error states honest.
**Verify:** compare hints on/off with rich fixtures; existing geometry negative
controls still fail on restored min-height; semantic tests use real SDK. Commit C17.

### Checkpoint C — Complete Projects interaction flow

T16–T24 pass focused tests and a synthetic full journey: edit, agent conflict,
save retry, checklist add/description, Save All exit, reopen, collapse brainstorm,
read/diff/restore, complete lifecycle independently. Inspect desktop/mobile reports.
No product interaction depends on a test stub exposing behavior the SDK lacks.

### T25 — Make detail behavior a required browser gate

**Depends:** T02, T21–T24. **Repo:** Bits. **Size:** M.
**Files:** `tests/detail.fixture.tsx`, `tests/detail.ui-test.ts`, new
`tests/detail-behavior.ts`, `plugins/projects/package.json`,
`test/ui-conformance-contract.test.ts` (test paths under Projects except last).
**Accept:** required collections script executes plan and detail fixtures;
readiness means assertions completed, not merely page mounted; console failures
fail the harness. Real event-driven browser assertions cover save/conflict/retry,
keyboard/navigation, hidden focus, geometry and 200%-text fixtures.
**Verify:** deliberately reintroduce representative failure/spacing/late-response
bugs in disposable consumers; gates reject them. All fixtures green afterward.
Commit C18.

### T26 — Coordinate exact SDK package, canonical CSS and CI pin

**Depends:** Checkpoints A–C, T25. **Repo:** both. **Size:** M plus generated CSS.
**Files:** Bits `.github/workflows/ci.yml`, `plugins/projects/bakin-plugin.json`;
Core `design-system/compatibility.json`, `design-system/migrations.json`, evidence.
**Accept:** publish and verify exact prerequisite SDK commit; bump Projects minor
version (currently 0.10.7 → 0.11.0; recompute if main advanced); remove only proven
retired migration allowances. Coordinate canonical stylesheet using the intended
Bits checkout; don't add classes absent from the packaged canonical CSS.
**Verify:** dry-run assemble/pack/install, full official-plugin conformance from
the same published SHA, source CSS identity. No npm publish or release tags. Runtime rollout must include Core’s atomic
plugin-storage fix before the upgraded plugin; an SDK package alone cannot
change host storage behavior. Record that prerequisite for the later release.
Commit C19 in each affected repo with dependency links.

### T27 — Finish docs and finding-by-finding closure

**Depends:** T26. **Repo:** both. **Size:** M plus generated docs.
**Files:** Bits `plugins/projects/README.md`, `UI-AUDIT.md`; Core
`.claude/knowledge/url-state-deep-linking.md`, `design-system.md`, evidence.
**Accept:** each audit finding links tests/reports, stale API prose corrected in
T08, actual mutation/lifecycle contracts documented, real limitations stated.
Regenerate affected public SDK/API/plugin docs through the normal workflow;
review diffs rather than include unrelated generated churn.
**Verify:** docs check, link/path review, no unsupported all-page conformance claim.
Commit C20.

### T28 — Final review, conformance and PR handoff

**Depends:** all tasks. **Repo:** both. **Size:** verification.
**Accept:** full tests/build/lint/typecheck, Core full conformance, exact-package
official-plugin suite, canonical visuals and three-browser behavior green; all
audit acceptance rows traceable; no unresolved review finding hidden in docs.
**Verify:** independent review pass against approved spec, staged diff/secret check,
final exact-head CI. Prepare linked PRs and dependency order, never merge/release
without instruction. Record final heads, evidence and rollback commands.

## Verification commands

Use Bun pinned by each `.bun-version`. Do not start/restart the user's mock server.
Run browser fixtures against synthetic data only. Record command, SHA, outcome,
artifact location and inspected screenshot/keyboard result in evidence.md.

Core focused examples (new files become valid as their tasks land):

```sh
bun test tests/ui/patterns/agent-identity-patterns.test.tsx --isolate
bun test tests/ui/patterns/markdown-patterns.test.tsx tests/ui/patterns/markdown-comparison.test.tsx --isolate
bun test tests/scripts/build-sdk-package.test.ts --isolate
bun run ui:test:stories
bun run ui:conformance --quick
bun run ui:conformance --full
bun run docs:check
```

Bits:

```sh
bun install --frozen-lockfile
bun run test plugins/projects
bun run typecheck
bun run lint
bun run test
bun run build
./scripts/check-version-bump.sh origin/main
```

Build SDK without publishing, then verify the actual installed package:

```sh
# Core root; output is disposable and outside the checkout.
bun run scripts/publish-sdk.ts --dry-run --version 0.1.1-rc.1 --package-dir /private/tmp/projects-audit-sdk-package --keep-package-dir
# Bits root
BAKIN_SDK_PACKAGE_DIR=/private/tmp/projects-audit-sdk-package bun run ui:conformance
```

Do not mistake the Bits test-sdk stubs for installed package coverage. The browser
command installs into isolated consumers, including the projects collections
script. Review `test-results/plugin-ui-conformance/projects/{plan,detail}` reports.
Shared visual suites use canonical Linux Playwright tooling, never host-OS PNGs
as replacement baselines. Detailed fixture interaction failures surface as failed
readiness/console evidence, not an unasserted screenshot.

## Commit, PR and rollback strategy

After approval, C0 commits the spec/plan/todo/evidence setup on the Core feature
branch. Each named C commit is a green checkpoint; implementation and the test
proving its behavior travel together. T02's diagnostic is explicitly unrequired
until fixed. Avoid commits with a required red suite. Keep formatting-only changes
out of behavior commits. Update todo/evidence with the corresponding checkpoint.

| Boundary | Commits | Rollback scope |
| --- | --- | --- |
| Atomic plugin writes | C0b | Independently revertible before operation receipt consumption; preserve crash safety when reverting dependents |
| Shared selector | C1 | Revert selector props/stories/docs only after dependent Bits usage is reverted |
| Canonical Markdown | C2–C3 | Revert comparison before parser change; Bits C17 must be reverted first |
| Shared accessibility/handle | C4a–C4c | Revert handle after consumer C15; focus/scroll corrections otherwise independent |
| Foundation publication | C5 | Includes approved generated artifacts; package/CI pins move with the matching source |
| Loads/history | C6–C7b | Revert consumer hooks before repository error changes if contracts differ |
| Safe writes | C8–C9b | Revert dependent UI first; never restore duplicate-prone retries while new UI is active |
| Lifecycle | C10 | Revert policy code/tests/docs together; do not rewrite saved user-chosen statuses |
| Project draft/conflicts | C11a–C12 | Revert conflict UI then form then reducer; retain service preconditions until callers removed |
| Checklist/exit | C13a–C14 | Revert exit coordinator before checklist draft contract |
| Layout/Markdown consumer | C15–C17 | Revert individual UI slice plus its matching evidence expectations |
| CI/docs | C18–C20 | Keep scripts, fixture enrollments, version and exact SDK pin mutually consistent |

Use normal revert commits on published branches, not history rewriting. A rollback
may span dependent commits; verify the dependency graph before choosing a range.
Do not edit baseline PNGs to disguise the reverted UI. New operation metadata must
be backed up before a downgrade to code that drops unknown frontmatter fields;
prefer reverting only the behavior while retaining safe parsing until receipts
are intentionally retired. No runtime data is changed during this development.

Recommended PR grouping: one Core foundation PR (C0–C5 and canonical artifacts),
one Bits audit-fixes PR (C6–C20), with a small Core fleet/docs follow-up only if
final Bits identity/census needs it. Keep local checkpoints even if GitHub squash
merges. Publish a fetchable final Core commit before changing the Bits CI pin;
prefer merge Core then Bits, then any pure census/docs follow-up. A canonical CSS
update must precede the consumer classes it supplies, with the candidate Bits
checkout available to the build during review. Final fleet checks run against the
intended pair, not whichever sibling checkout happens to be present.

## Risk gates and approval boundaries

- Plan approval authorizes these local checkpoint commits and the two-repository
  implementation, including scoped mutation metadata and direct parser dependency
  declarations. It does not authorize merging, release tagging, or production writes.
- Exact visual baseline additions/replacements require before/after candidate
  review. New performance ceilings, accessibility suppressions, tokens, or a third
  public API extension need separate explicit approval. Continue independent work
  while a bounded approval is pending.
- Q9 has separate explicit public-contract approval, recorded in the spec.
  Closest story: `conversation/panel-and-drawer.stories.tsx` — `CanonicalUsage`.
  ConversationPanel hides the existing ComposerHandle; remaking the panel would
  duplicate its scroll/resize/turn composition. Forward it as composerHandleRef,
  keeping routing/transport/storage unchanged; verify ref/keyboard/readonly/narrow
  states and update API/docs. Further methods or persistence behavior would be a
  new extension; do not infer approval for them.
- The owned single-process project lock cannot serialize arbitrary external
  editors writing directly to files. Scope conflict guarantees to the supported
  service paths; document any direct-file race found rather than promise universal
  filesystem transactions.
- Never increase scanner limits to make tab traversal pass. Reproduce with a
  manual trace and fix ownership/semantics; a proven harness defect needs its own
  regression, not a suppression.
- Fail-fast checkpoints: promotion recovery before UI retries; full-document
  Markdown parity before annotated rendering; exact package build before Bits CI.

## Plan self-review

- Every audit finding maps to tasks: edits T09/T12/T16–T18/T21; checklist
  T13–T14/T19–T20; accessibility T02/T06–T07/T23/T25; narrow layout T22–T23;
  honest data T09–T11; labels/progress T15/T20/T23; Markdown T04–T05/T24.
- Control inventory maps to T03/T11/T17/T20/T22; unchanged search/new-title
  patterns retain their canonical defaults.
- Dependency ordering covers SDK before consumption and reliable writes before
  retrying UI. T09–T16 can advance while shared visual candidates await approval.
- No change to code was made during planning. All 30 tasks remain unstarted;
  exact implementation paths marked new are proposals, not existing files.
