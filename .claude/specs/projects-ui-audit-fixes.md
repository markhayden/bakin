# Projects UI audit fixes — specification

Status: approved by the user ("do it", after the specification approval request);
implementation plan and local checkpoint commits subsequently approved ("approve").
Source: `../bakin-bits-official/plugins/projects/UI-AUDIT.md` (2026-09-23).

## Objective and scope

Resolve all seven audit findings and the control-inventory recommendations for
the single-user Projects experience. Prioritize reliable writes, preserved
drafts, accessible interactions, and correct Markdown over cosmetic changes.
Fix shared behavior in its SDK owner when the defect belongs there. Use the
existing design system; remove obsolete overrides instead of adding shims.

The spacing fix is already merged and must remain covered. Baselines for this
discovery are Bakin `ecf7e1b24051f8c965715b3a72aa4739c74bc47a` and Bits
`abd94c03e9d69ab9ef77d522654d8927e440e4f0`. Both active checkouts are on main.
Prior local SDK/embedded-assets edits are preserved in the named Git stash
`pre-projects-audit-kickoff: preserve local SDK and embedded assets changes`.

## Findings and acceptance criteria

### 1. Safe project editing

- Title, plan, owner, and status form one staged draft with one shared
  Save/Discard boundary (approved Q2). Remove immediate owner/status writes;
  entering Edit exposes the project fields, while read mode displays saved data.
- Checklist operations, asset actions, and brainstorm sends stay independent of
  the project draft and cannot implicitly save or discard it.
- Failed HTTP/network saves retain the draft and edit mode, expose actionable
  errors, and permit retry. Busy state prevents duplicate writes.
- Cancel resets title, body, owner, and status together. Successful saves clear
  only the submitted draft snapshot, preserving edits made during the request.
- Navigation and explicit exits use the shared unsaved-changes guard; project
  identity changes cannot reuse another project's draft or late response.
- Background refreshes must not replace drafts or make an untouched field look
  locally edited. Save baselines and current server data need distinct roles.
- Concurrent human/agent updates preserve the local draft, accept server changes
  to untouched fields, and require an explicit decision for overlapping field
  changes (approved Q1). A field converging to the same value is not a conflict.
- Enforce conflict checks at the server write boundary under the existing project
  lock; a client preflight alone leaves a race. An explicit overwrite decision
  must apply to the version reviewed, not silently overwrite a newer update.

### 2. Reliable checklist writes

- Add, description edit, toggle, remove, and promote validate responses and
  show pending/error states. Clear/close drafts only after confirmed success.
- Refresh from confirmed state without stale responses undoing newer changes.
- Use Form/InputGroup composition, label the description field, and name
  repeated actions with their task. Preserve drafts on failure and guarded exit.
- Leaving with project or checklist drafts offers Save all and leave, Discard
  and leave, or Stay (approved Q7). Save all explicitly adds a typed new task
  and saves changed descriptions; validation, conflicts, or failures stop exit.
  Successful operations are not repeated when retrying unfinished saves.
- Repeated clicks, concurrent promotion requests, and a retry after a lost
  response must not create duplicate checklist/board tasks. Use operation
  identity/reconciliation at the service boundary; disabling a button is not
  sufficient. The plan must vet the create-and-link failure window before build.

### 3. Detail accessibility

- Reproduce and trace each of the six diagnostic findings before assigning it
  to Projects or the shared conversation/layout components.
- Correct heading hierarchy, visible composer focus, keyboard access to scroll
  regions, and complete tab traversal without suppressing scanner findings.
- Add a maintained real-SDK detail fixture to CI; cover controls, errors, empty
  and populated conversations, long content, and overlays.

### 4. Responsive layout

- At 320px and 200% text, the plan toolbar exposes every action without clipping.
- On mobile, an empty brainstorm starts collapsed behind Brainstorm with an
  agent. Existing conversations, unsent drafts, and active turns start expanded.
  Desktop starts expanded (approved Q3).
- Layout changes preserve the conversation draft, selected agent, active turn,
  and scroll position. Check keyboard access through the plan/chat split.

### 5. Honest loading and recovery

- Distinguish loading, true 404, empty history, and retryable HTTP/network errors.
- Ignore stale project/history responses after navigation or newer requests.
- History load/restore rejects visibly; retain snapshot identity checks and the
  existing server snapshot-before-restore protection.

### 6. Labels and orientation

- Rename sidebar metadata to Project info and progress to Checklist progress.
- Keep lifecycle status independent of checklist completion; expose the selected
  lifecycle through checked/radio menu semantics.
- Remove automatic active-to-completed transitions and the server rejection of
  explicit Completed with unchecked items (approved Q8). Apply the same rule
  to browser, agent tools, plan application, and linked-task synchronization.
  Continue syncing linked-task completion to checklist progress, but never
  infer project lifecycle status. Do not rewrite existing stored statuses.
- Assets empty copy describes Attach, the action actually available.
- Completed tasks remain visible by default so progress remains apparent.
  Provide an explicit Show/Hide completed (N) toggle and remember the preference
  per project. Checking a task does not automatically hide it unless the user
  has explicitly enabled Hide completed. Progress/counts always include all
  items (approved Q4).

### 7. Markdown fidelity

- Show changes on/off must preserve the meaning of the complete document,
  including reference links, loose/nested lists, blockquotes, fences, and tables.
- Preserve additions, edits, and pure-deletion annotations and history diff.
- Investigate document-aware annotation within the canonical Markdown pipeline;
  do not introduce a parallel renderer or rewrite user Markdown to hide symptoms.
- Any new public rendering capability needs a concrete Storybook contract and
  explicit approval before implementation. The screenshot's literal emphasis
  cannot establish a source defect; use reproducible Markdown fixtures.

### Approved Markdown comparison extension (Q6)

- Closest contract: `storybook/public/content/markdown-content.stories.tsx` —
  `CanonicalUsage` and `ReadingAndCode`, through `/content`.
- Exact mismatch: MarkdownContent accepts content and internal-link rendering
  but no change annotations. Projects splits the source on blank lines and
  renders each fragment independently, losing document-level Markdown context.
  The shared renderer also segments managed sections before parsing, which the
  fidelity work must account for rather than perpetuate in a new comparison path.
- Proposed public API: optional `compareTo?: string` on MarkdownContent.
  `content` remains the current complete source; `compareTo` is the complete
  previous source. Omitted means plain reading; an empty string is a real empty
  baseline. The consumer owns loading/history selection and Show changes.
- Preserve the current readable presentation: mark added/edited semantic blocks
  with the existing green gutter treatment; mark pure deletions at their position
  with an accessible removal indicator. Lists, tables, quotes, and fenced code
  stay intact. Whole-block indication is intentional; exact line edits remain
  in Projects' existing Diff view. Do not add inline red/green prose diffs.
- Parse with complete document context and annotate the canonical rendering
  pipeline. Do not expose arbitrary plugins, duplicate the renderer, rewrite
  stored Markdown, or add wrappers that invalidate list/table HTML.
- Preserve managed-section presentation, cross-section reference resolution,
  code copy, media behavior, safe URLs, and consumer-owned internal navigation.
  Non-color descriptions explain additions/edits/removals to assistive technology.
- A reusable system extension is necessary: fragment composition cannot restore
  missing Markdown context, and DOM-only overlays would couple Projects to
  private renderer structure. Define comparison and fidelity stories before
  use, cover normal/annotated parity, and measure large-document performance.
- Review condition: retire Projects' blank-line splitting/rendering path once
  parity, deletion positions, spacing, accessibility, and package/browser checks
  pass. No new token or baseline replacement is approved by this proposal.

### Control inventory

Keep new-title md/outlined, task InputGroup, search, and specialized editors.
Use the shared lg/outlined edit-title control instead of heading-like overrides.
Use a labeled sm/outlined bounded-auto-grow checklist description, initially
two rows and bounded at six rows before scrolling. Match snapshot chooser and
restore button sizes. AgentSelect size/variant support follows approved Q5.
Filled/ghost are not blanket defaults for primary data entry.

### Approved AgentSelect public extension (Q5)

- Closest contract: `storybook/public/agents/agent-select.stories.tsx` —
  `CanonicalUsage`, using `@makinbakin/sdk/patterns`.
- Mismatch: AgentSelectProps exposes className but no size/variant. Its underlying
  SelectTrigger already supports both. Projects currently overrides height and
  surface classes, bypassing the shared appearance contract.
- Proposal: add `size: sm | md | lg` and `variant: outlined | filled | ghost`
  as optional props defaulting to md/outlined, forwarding the canonical styles.
  Use the existing 32/36/44px control sizes and borderless filled treatment.
  Ensure avatar/name alignment fits each size without clipping.
- Projects: md/outlined owner in the staged form; sm/filled brainstorm selector.
- Composition limit: class overrides cannot supply the documented, coordinated
  size/variant contract or demonstrate all states in Storybook. Replacing the
  whole selector would duplicate its agent/team semantics.
- Reusable system extension, not a Projects exception. Add Storybook size/variant
  coverage, public prop documentation, API checks, and focused browser tests
  before consumption. Review exact visual candidates before replacing baselines.
- Preserve accessible names, keyboard selection, focus/error/disabled treatment,
  narrow and 200%-text behavior, and existing team/agent options. This presentation
  component keeps fetching, persistence, routing, and plugin state consumer-owned.
- Completion condition: Projects removes the corresponding appearance overrides
  and the shared contract passes conformance; no temporary shim remains.

## Existing Storybook contracts

| Need | Story and export | Focused SDK entry |
| --- | --- | --- |
| Submissions | `forms/form-composition.stories.tsx` — `SubmissionWorkflow` | `/ui` |
| Staged project draft | `forms/save-bar.stories.tsx` — `CanonicalUsage` | `/patterns` |
| Dirty exit | `forms/unsaved-changes-dialog.stories.tsx` — `CanonicalUsage`, `UnsavedExitDecision` | `/navigation`, `/patterns` |
| Owner/agent | `agents/agent-select.stories.tsx` — `CanonicalUsage` | `/patterns` |
| Read-only plan | `content/markdown-content.stories.tsx` — `CanonicalUsage`, `ReadingAndCode` | `/content` |
| Recovery | `feedback/system-state.stories.tsx` — `ScopeAndRecovery` | `/ui` |
| Section rhythm | `layout/section.stories.tsx` — `CanonicalUsage` | `/layout` |
| Optional supporting panel | `primitives/collapsible.stories.tsx` — `CanonicalUsage` | `/ui` |
| Page and scroll ownership | `pages/page.stories.tsx` — `AsideLayout`, `ContainedScroll`, `BodyReplacedState` | `/patterns` |
| Embedded brainstorm | `conversation/panel-and-drawer.stories.tsx` — `CanonicalUsage`, `DocumentDividerPanel` | `/conversation` |
| Conflict decision | `overlays/dialog.stories.tsx` — `CanonicalUsage` | `/ui` |
| Description growth | `primitives/textarea.stories.tsx` — `BoundedGrowth` | `/ui` |

Paths above are relative to `storybook/public/`. Compose existing patterns for
project-specific flows. Q5, Q6, and Q9 are the three approved public extensions;
additional extensions or exceptions require a concrete proposal before build.

## Behavior details

### Draft ownership and save outcomes

Keep the original edit baseline, local draft, and latest confirmed server record
distinct. Save only locally changed fields. A background change to an untouched
field advances its displayed value/baseline without dirtying it. Equal final
values converge without prompting. Treat the plan body as a whole field;
automatic merging of prose is outside scope.

For an overlapping change, show the field name and both values in a bounded
dialog, with Keep my value, Use latest value, and a way back to editing. Long
Markdown remains readable/scrollable, with stacked presentation on narrow
screens. Do not resolve conflicts by default. Revalidate the reviewed server
value under the project lock before writing: another intervening update must
produce a fresh decision rather than be silently overwritten. No part of a
conflicted project save should commit before resolution.

The project SaveBar saves only title/body/owner/status. Its Discard discards only
that draft and restores the latest confirmed server values. Clean edit mode can
exit without a dirty warning. Successful save may return to read mode only if no
later local edits remain. Validation and save errors remain adjacent to the draft
and are announced; a refresh failure after a confirmed write must not masquerade
as a failed write or trigger duplicate submission.

Checklist descriptions keep independent drafts, with conflict protection when
their saved values change externally. Removing an item with an unsaved local
description must not silently discard that description. A task removed remotely
while being edited presents an explicit unavailable/conflict state. Do not
resurrect it through a stale update.

### Leaving the page

In-app Back, internal links, browser history, and controlled route exits share
the existing `/navigation` guard. Identify which drafts will be saved/discarded.
Save all validates the captured drafts before starting, coordinates independent
operations, records each confirmed success, and leaves only when no unsaved work
remains. A failed operation keeps its draft and the user on the page. Retrying
must not repeat already-confirmed creates/promotions; partial success must be
visible. Discard and leave discards pending edits, not earlier confirmed writes.

Do not create nested HTML forms when composing project and checklist forms.
Focus returns to the originating control after cancelling an exit/conflict
decision. Project identity changes remount isolated state; edit/read routing
within a project must not lose unrelated checklist or conversation drafts.

Hard refresh/tab-close uses the browser's native beforeunload warning; browsers
do not support the custom three-action dialog there. This scope does not add a
new offline draft store. Existing composer text persistence remains in force:
Save all never sends a brainstorm message. Browser storage unavailability must
degrade honestly rather than break the page.

### Responsive conversation and completed tasks

Initial mobile disclosure follows Q3. User-driven collapse stays under user
control during rerenders; viewport changes must not reset content, agent choice,
or scroll. Collapsed content must leave no hidden keyboard stops. Keep active
turn status, Stop, and errors reachable; new background activity must not steal
focus. Preserve the existing desktop resize behavior where it conforms to the
shared pattern; validate it at 200% text and by keyboard.

Completed tasks retain their existing order and checked appearance by default.
Hide completed is optional and keyed per project, with an honest visible count.
If everything is hidden, say how many completed tasks are hidden and offer Show;
do not claim the checklist is empty. Hide/collapse cannot discard an open draft.

### History and rendering

The latest valid snapshot remains the Show changes baseline. Diff retains its
snapshot chooser and guarded restore. Share history loading state where useful
instead of issuing inconsistent duplicate requests. If annotations cannot load,
keep the current plan readable and explicitly report unavailable change history
with Retry. Do not present unavailable data as no changes/no versions.

Keep reference definitions in whole-document context, including across managed
sections. Pure deletions before/after the entire document and an empty current
document must still have an accessible marker when comparison is enabled.
Repeated/moved blocks must not corrupt the rendered document. Establish a bounded
comparison strategy during planning; expensive annotation must never prevent
plain reading. Any unavailable comparison must be explicit, not a false no-change
result. Measure package/payload impact before requesting any ceiling adjustment.

## Structure and code style

Bits owns `plugins/projects/components/`, `lib/`, `index.ts`, `types.ts`, and
`tests/`. Bakin owns public stories, SDK/UI implementations, public API inventory,
canonical styles, browser tests, and design-system governance. Use strict
TypeScript, typed operation/state contracts, existing services, and focused SDK
imports. Keep network handling out of presentation-only components where possible.
Example established response validation:

```ts
const response = await fetch(url, request)
if (!response.ok) throw new Error('The project could not be saved.')
```

Actual implementation must retain useful typed server errors and distinguish
confirmed writes from refresh failures; the example is not a full API design.

## Verification commands and strategy

Bits root:

```sh
bun install
bun run test plugins/projects
bun run typecheck
bun run lint
bun run test
bun run build
BAKIN_SDK_PACKAGE_DIR=/absolute/path/to/assembled-sdk bun run ui:conformance
```

Bakin root for shared contracts:

```sh
bun run ui:conformance --quick
bun run ui:conformance --full
bun run docs:check
```

The plan will name focused story/browser/unit commands by actual affected files.
Prove draft preservation, HTTP/network failure, duplicate submission, stale
response ordering, concurrent updates, retry, and all exit paths. Run real-SDK
desktop/mobile and 200%-text checks, keyboard traces, accessibility checks, and
Markdown parity fixtures. Retain the spacing regression's negative controls.
Use synthetic data and mocked runtime adapters only.

## Documentation

Review/update `.claude/knowledge/{style-guide,shared-ui-patterns,conversation-kit,
url-state-deep-linking,design-system}.md` where the supported behavior changes.
Update public UI guidance, relevant story descriptions and API inventory, plus
Projects README/UI-AUDIT with finding-by-finding evidence. Do not leave the audit
claiming unresolved findings after they have been verified fixed.
Correct the stale AgentSelect section in shared-ui-patterns (removed
`src/components/agent-select.tsx`, obsolete `agentIds` prop) against the actual
focused SDK contract. Update Projects tool descriptions/tests that currently
prohibit Completed with unchecked tasks. Check README and generated docs for
affected server contracts; preserve the existing docs generation workflow.

## Required evidence before completion

| Area | Acceptance evidence |
| --- | --- |
| Project draft | Failure retains all four fields; duplicate submit blocked; background refresh preserves changes; every conflict choice tested, including a second intervening update |
| Exit | Each in-app exit, discard scope, save-all partial success/retry, invalid fields, browser unload warning, identity isolation |
| Checklist | Add/edit/toggle/remove/promote errors and busy states; lost response/concurrent promotion; remote edits/removal; task-specific labels; visible progress with hidden completed items |
| Lifecycle | REST/tool/service and linked-task tests prove no automatic status change and permit explicit Completed with unfinished work |
| Data states | Loading/404/empty/network/HTTP error/retry and out-of-order responses for detail/history/restore |
| Detail accessibility | All six original diagnostics closed with browser evidence; keyboard traversal, focus, headings, accessible scrolling, modal focus return |
| Layout | 320px, ordinary desktop, 200% text, long names/content, collapsed/expanded conversation, persisted drafts, active/error/Stop access |
| Markdown | Semantic parity with hints on/off, nested/loose lists, tables, fences, references, managed sections, empty/pure deletion/moved blocks, code copy/link/media behavior |
| Shared contracts | AgentSelect size/variant/state stories; Markdown comparison stories; API/docs checks; package/browser regression; measured payload and canonical screenshots |
| Fleet | Required quick/full conformance and installed-SDK official-plugin suite pass against documented exact core/Bits revisions; no new undocumented migration debt |

No implementation tests were run for this specification-only interview. Earlier
audit evidence establishes the defects; execution will reproduce them against
the implementation baseline before claiming fixes.

## Boundaries and delivery

- Always: Storybook first for shared changes; preserve source data and drafts;
  remove unnecessary overrides; keep each vertical slice tested and revertible.
- Approval checkpoints: completed spec, detailed implementation plan, exact
  public-system extensions, and any actual visual-baseline replacement.
- Never: compatibility shims, speculative rewrites of stored Markdown, live
  agent calls/data changes, silent a11y suppression, or automatic baseline and
  performance-ceiling updates to hide failures.
- No implementation until spec and plan approval. The plan must include file
  tasks, dependencies, tests, docs, small checkpoint commits, rollback boundaries,
  cross-repository merge ordering, SDK pin updates, and release/version handling.
- No release, production install, or merge is authorized by this kickoff alone.

## Interview decisions

Q1 approved: protect overlapping edits and require a choice. Preserve the draft,
accept updates to untouched fields, and require explicit resolution when the
same field changes differently on both sides. The plan body is a field; no
automatic prose merge is implied by this decision.

Q2 approved: one staged project draft for title, plan, owner, and status with
shared Save/Discard. This follows the existing SaveBar contract and style-guide
section 5. Checklist actions remain separate operations.

Q3 approved: mobile brainstorm starts compact when there is no conversation,
composer draft, or active turn; an explicit Brainstorm with an agent control
expands it. Existing conversations start expanded, with an explicit collapse
action. Desktop remains expanded by default. Preserve draft/scroll/turn state
through collapse and viewport changes; never hide active/error status or Stop.

Q4 approved: completed checklist items remain visible initially, with an explicit
Show/Hide completed (N) toggle whose preference is remembered per project.
Checking an item does not hide it under the default setting. Total checklist
progress continues to include all items even when the user enables hiding.
User rationale: seeing completed work makes progress visible.

Q5 approved: AgentSelect size/variant extension and Projects usages specified
above. This approves that public contract, not implementation-plan or visual
baseline replacement.

Q6 approved: optional full-document MarkdownContent comparison contract above,
retaining block highlights and the separate precise Diff view. Public story and
contract work precede product consumption; visual baseline replacement remains
a separate approval.

Q7 approved: when navigating away with project edits and/or unfinished checklist
title/description drafts, offer Save all and leave, Discard and leave, or Stay.
Decision: Save all explicitly submits each valid pending edit, including
adding a typed checklist task, and leaves only after all succeed. Failed,
conflicting, or invalid edits retain their drafts and keep the page open;
successful operations are not repeated on retry. This coordinates independent
operations without claiming an atomic transaction. The normal project SaveBar
still saves only project fields. Unsent brainstorm text is never sent by this
action; it remains governed by the composer's existing draft persistence.

Q8 approved — audit clarification from source: checklist completion currently
changes active projects to completed, and updateProject/applyProjectPlan reject
explicit completed status with unchecked items. The audit's independence claim
is therefore not already true. Decision: lifecycle is explicitly chosen,
not inferred from checklist progress; remove automatic transitions and allow
explicit Completed independently of unchecked items, which remain visible and
counted honestly. User approved the behavior change.

All eight product decisions and the Q9 planning addendum are resolved. The implementation plan must vet:
atomic expected-value checks and conflict response types; operation identity and
create/link reconciliation; shared conversation finding ownership; semantic
Markdown annotation and bounded comparison; exact SDK/CI/CSS coordination. These
are code/design investigations, not unresolved user preferences. If investigation
requires another public-system extension, return with its concrete contract.


## Approved planning addendum — Q9

The user explicitly approved optional `composerHandleRef?: Ref<ComposerHandle>`
on ConversationPanel, forwarding the existing Composer handle (`isEmpty`,
`setText`, `focus`). This lets Projects inspect a restored draft after mount to
apply the approved mobile initial-expansion rule. No new handle methods, storage
format, auto-send behavior, or URL ownership are added.

Closest pattern: `storybook/public/conversation/panel-and-drawer.stories.tsx` —
`CanonicalUsage`. It owns the embedded panel composition but currently hides the
Composer handle. Rebuilding it from primitives would duplicate the shared
scroll/resize/turn behavior; reading private storage keys would couple Projects
to an implementation detail. Extend the reusable shared contract first, with
ref lifecycle, read-only, restored-draft, focus, narrow and keyboard coverage.
Keep collapsed content mounted through the supported disclosure contract and
preserve its state without hidden tab stops. Update API inventory and docs.
Exact visual baseline replacement remains a separate approval.

The implementation plan also reuses Core’s existing atomicWriteText in scoped
plugin storage writes, because operation receipts and items share one project
file. This is implementation of the approved retry-safety requirement, not a new
storage API or a guarantee of cross-file/power-loss transactions. The later
runtime rollout must include the Core fix; updating the SDK package alone does
not update host storage.
