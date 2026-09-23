# Projects audit fixes — execution evidence

## Authorization and baseline

Spec, implementation plan, local commits, and all three public extensions approved.
Core branch `feat/projects-audit-sdk` from `ecf7e1b24051f8c965715b3a72aa4739c74bc47a`.
Bits branch `feat/projects-audit-fixes` from `abd94c03e9d69ab9ef77d522654d8927e440e4f0`.
Bun 1.3.13; frozen installs passed in both repos. Existing stash preserved.
No dev server or production state was modified.

- Bits Projects baseline: 213 passed, zero failed (635 assertions).
- Bits baseline typecheck/lint: passed.
- Core quick baseline: tokens/API pass; census stops at pre-existing compatibility
  drift (Projects 0.10.7 vs recorded 0.10.6). No matrix replacement performed.
- Installed-SDK baseline browser run started using the previously verified package
  assembled from prerequisite SHA 949da83f539ecb5c1eb4f0d71d88d159644d9254; all eight fixtures passed with zero findings.

Logs: `/private/tmp/projects-audit-{core,bits}-baseline*.log`.
Further checks are recorded with each checkpoint; baseline failures are not fixes.

## C0b — Atomic scoped plugin replacement (T02b)

Three new tests failed before the fix: open readers observed replacement bytes,
an interrupted write corrupted the target, and rename failure was not exercised.
The existing atomicWriteText helper now owns replacement; append is unchanged.
All six scoped-storage tests pass, along with 22 watcher/search sync tests.
Focused lint and Core typecheck pass. Red log: `/private/tmp/projects-audit-storage-red.log`.
No power-loss or cross-file transactional guarantee is claimed.

## Detail diagnostic (Bits 2b2ccaf)

The real-SDK synthetic detail fixture reproduces six findings across desktop/mobile:
heading order, composer focus, unreachable controls, and unfocusable contained scroll.
The diagnostic remains separate from required passing fixtures until fixes land.
Report: `/private/tmp/bakin-projects-spacing-consumer/test-results/bakin-ui-detail/index.html`.

## C1 — AgentSelect appearance (T03)

Pattern: `storybook/public/agents/agent-select.stories.tsx` — CanonicalUsage,
SizesAndVariants. Contract: `@makinbakin/sdk/patterns`. Approved extension, no deviation.
Three new appearance tests failed first; all 11 identity tests and four stories pass.
Browser verifies 32/36/44px geometry, avatar containment, borderless filled controls,
keyboard popup/escape and 320px layout at 200% text. Typecheck and focused lint pass.
Quick conformance still reports the recorded pre-existing fleet census drift.
Visual baselines remain untouched; aggregate contract docs and candidates follow in T08.

## C4a — Composer focus (T06)

Pattern: `storybook/public/conversation/composer.stories.tsx` — CanonicalUsage.
The new desktop/mobile browser tests failed on the missing focus outline before
the fix and pass with a token-colored inset outline. Existing composer behavior
tests pass, including IME, attachments, drafts and queue mode. Screenshots/traces
are under `/private/tmp/projects-audit-browser-results/`; baselines unchanged.

## C4b — Contained transcript scrolling (T07)

Pattern: `storybook/public/conversation/panel-and-drawer.stories.tsx` — CanonicalUsage.
The contained transcript has a named region, tab stop and inset focus outline;
document mode keeps its parent-owned scrolling and gains no tab stop. Regression
failed first; all conversation/composer unit tests and four desktop/mobile browser
checks pass, including real Page Down scrolling and Tab exit. Projects heading and
detail traversal findings still await consumer fixes; no suppressions added.

## C4c — Composer handle forwarding (T07b)

Approved `composerHandleRef` forwards the existing `handleRef` methods with no
storage-key coupling. Lifecycle regression failed first, then all nine panel tests
passed (empty/restored, identity changes, read-only, focus and unmount). Nine shared
conversation/composer stories pass including axe; transcript names derive from
panel titles to distinguish multiple sessions. Typecheck and focused lint pass.
Quick conformance still stops only at the recorded fleet compatibility drift.

## C2 — Whole-document Markdown parsing (T04)

Pattern: `storybook/public/content/markdown-content.stories.tsx` —
ManagedDocumentContext. Regression fixtures first reproduced broken cross-section
references and code-fence marker handling. Managed-section presentation now runs
on the parsed full document. Ten Markdown tests, three browser stories (including
axe), typecheck and lint pass. Shared parser dependencies are declared directly.
Packed-SDK consumer verification is included in T08/T26; no baseline replacement.

## C3 — Bounded Markdown comparison (T05)

Approved `compareTo` parses full documents, fingerprints semantic blocks and their
resolved references, and preserves whole lists/tables/code. Replacements receive a
green edge plus non-color accessible text; surplus deletions receive positioned
text markers, including an empty current document. At the one-million-step ceiling,
the complete document remains visible with an explicit unavailable notice.
Focused comparison/Markdown tests and five public stories pass. Desktop/320px
browser checks pass for flow geometry, semantics, copy action and 200% text.
Typecheck/lint pass. An initial Storybook dependency-cache reload required one rerun.

## C6/C7a — Projects loading and history

Bits `cd14c02`: three history regressions failed before the fix; 161 repository,
route and service tests now pass. Missing history is empty; malformed data and
storage failures are errors; failed reads/restores never rewrite corrupt history.
Bits `2bffb47`: the typed detail hook rejects invalid payloads, aborts obsolete
loads, enforces request generation/identity, and retains valid data on failed refresh.
Canonical SystemState loading/error/retry composition is used. Four focused
deferred-response tests plus all 220 Projects tests, types and lint pass.

## Foundation integration in progress (T08)

The owner-generated compatibility matrix now records actual Projects 0.10.7 and
the tested repository refs; no census scope or allowance changed. Quick gates
pass after enrolling the new visual file. Full verification reached 9,790 passing
tests and four SDK packaging failures: declaration-only `mdast` must resolve to
the explicitly declared `@types/mdast`. The package builder now handles that case;
all six focused packaging tests (161 assertions) pass and a dry-run package built.
All eight official plugin fixtures pass against `/private/tmp/projects-audit-sdk-package`.
No SDK publication occurred. Canonical screenshots exposed a nonexistent inherited
success token; comparison now uses the actual green action token, verified by
computed-color browser assertions. The exact 12 images in `visual-review/manifest.json` were approved on 2026-09-23.
SHA-256 verified before installation; all 12 canonical Linux desktop/mobile checks
pass with snapshot writes disabled. Normal visual runs refuse baseline writes.


## Atomic edits, lifecycle and checklist receipts (T12/T13/T15)

Bits `03494af` implements atomic expected-field writes, structured conflicts and
converged retries; `70ec65a` separates explicit project lifecycle from checklist
progress. 144 focused service/route/sync tests pass with types and lint.
Checklist creation now writes a durable receipt alongside its item, using stable
item identity across deletion/display-ID reuse. Four regressions failed first;
168 parser/service/route/recovery tests pass, as do typecheck and lint. Tests cover
lost responses, concurrent retries, process reconstruction, write failure, deleted
results, mismatched request content, corrupt metadata and retained receipt growth.
Private operation records are excluded from detail responses. Host scoped storage
propagates actual read failures (missing files alone return null).

## Foundation verification update

Second full unit run: 9,794 passed, 18 skipped, zero failures. Full conformance
stops at measured payload increases, which still require a concrete ceiling review
and separate approval. SDK package assembly and all eight official plugin fixtures
pass; all 359 Storybook interactions pass (114 files, five internal specimen files skipped). No package was published.


## Promotion recovery (T14)

Bits `9378828`: seven recovery regressions cover concurrent requests, reentrant
hooks, reservation/write failures, lost link writes across service reconstruction,
downstream create failure, foreign task identity, deleted/reused checklist targets,
and deleted projects/tasks. One reserved board-task ID and verified provenance
survive retries; the global project lock is released for external task APIs.
All 239 Projects tests pass. Typecheck/lint pass. Add receipts checkpoint: `0e2cd28`.


## Shared history and rendered comparison (T11/T24)

Bits `0015163` owns one abortable/versioned history request for both views, with
inline SystemState retry feedback and a ConfirmDialog that retains errors and the
exact reviewed snapshot. Oversized line diffs say unavailable and retain keyboard
scrolling. Focused failure/restore tests pass. Bits `5a8cdba` removes the blank-line
renderer and passes full documents through MarkdownContent/compareTo. The actual
packed SDK desktop/mobile plan fixture passes (report
`/private/tmp/projects-audit-live-consumer-v2/test-results/bakin-ui-plan/index.html`),
including visible spacing, axe, keyboard, overflow and console checks. Reviewed the
mobile screenshot. The geometry assertion excludes the SDK's screen-reader-only
change hint, not visible content. Core quick conformance passes (228 tests/types).

## Staged draft model (T16)

Bits `cb8cd64`: six pure/hook tests cover untouched-field merge, explicit overlap
resolution, a second race, convergence, title validation, failed writes and typing
during an in-flight save. The subsequent form integration passes nine focused
form/detail tests; title/owner/status/body use one expected-field patch and SaveBar.
T17/T18 remain in progress until actual consumer browser verification.

## Integrated detail and required browser coverage (T02/T08/T17–T25)

Bits checkpoints `b119695`, `ae0d7b4`, `d7ee9d2`, `ef842b2` and `884af39`
complete checklist ownership, the staged form, protected route transitions,
mobile disclosure, and required installed-SDK detail coverage. Durable service and
file-watcher changes emit `projects.changed` through the plugin event bus, allowing
the draft model to reconcile agent updates. Read/edit routes share the same
mounted project owner. An actual router test exposed a duplicate exit prompt;
the controlled exit now navigates only after the dirty guard has cleaned up.

The final assembled SDK (`/private/tmp/projects-audit-sdk-final`, dry run only)
passed all ten official Bits UI fixtures: template, terminal, four Messaging
surfaces, and Projects list/plan/read/edit. The seven required Projects interaction
scenarios prove overlapping-edit decisions, mounted drafts across read/edit,
lost-response add replay, partial Save All, retained mobile draft and conversation
scroll, 200% text, completed-filter persistence, native unload protection,
Cancel/Discard, and honest retryable history failure. No composer send occurs on
exit. Reports are retained under the Bits checkout's
`test-results/plugin-ui-conformance/`; desktop read and mobile edit screenshots
were visually inspected. No accessibility suppressions were added.

All 643 Bits unit tests pass (8 intentionally skipped), with typecheck and lint.
The final Core run passed 9,794 tests (18 skipped), types, lint, architecture,
payload, and deterministic Storybook build; remaining full gates are still running.
Initial final-gate failures were corrected: enrollment still expected only the plan
fixture, the stub lacked the fixture-only draft writer export, and two conflict
regions used raw heights. Conflict values now use canonical read-only Textarea;
retired migration allowances remove ten raw-scale findings and two paths.

## Approved payload ceilings

The user approved the exact four entries in `payload-review.md` on 2026-09-23.
Only those numeric fields changed. The 2,048-byte review threshold and every other
ceiling remain unchanged. The payload gate passes. Subsequent canonical conflict
composition reduces Projects JavaScript; it does not require a further increase.

## Documentation and release boundary (T27)

Projects README and UI-AUDIT now explain staged edits, conflicts, independent
lifecycle, retries, shared patterns, browser coverage, and coordinated rollback.
Projects is staged at 0.11.0. Shared author guidance uses the current conversation
API, and generated tool/hook documentation reflects the new lifecycle contract.
The exact fetchable Core prerequisite will be pinned in Bits CI before PR handoff.
No runtime data, release tag, published SDK, or production installation changed.


## Final independent review and corrections

A separate read-only code review covered durable operations, concurrency, stale
identity, and draft ownership. Two confirmed findings were reproduced by failing
regressions, then fixed: a deleted add receipt could let Save All exit successfully,
and a legacy item without a UUID could transfer its draft to a replacement using
the same display ID. Deleted receipts now retain an unresolved draft with an
explicit discard action; every instance-identity transition preserves the old draft
as removed/replaced. Neither path silently recreates or overwrites an item.

All 645 Bits tests pass (8 skipped), and all eight detail browser scenarios pass,
including the deleted-receipt Save All decision. Typecheck/lint and payload gates
pass. The promotion reservation/recovery review found no further confirmed defect.
The exact published Core prerequisite pinned by Bits CI is
`d361de367a69ea1887adffa4abaee0f979b090c2`; it contains the complete host/SDK/CSS
implementation. Later Core evidence/census commits do not change that SDK package.

## Linked review branches

- Core foundation: https://github.com/markhayden/bakin/pull/919
- Projects consumer: https://github.com/markhayden/bakin-bits-official/pull/108
- Reviewed consumer checkpoint: `454f66c` (Core compatibility matrix pins its full SHA).
- Merge Core first. Bits CI pins `d361de367a69ea1887adffa4abaee0f979b090c2`;
  subsequent Core commits contain review records and companion pin updates only.
- Final quick conformance passes (228 architecture tests plus types); Bits build
  compiles Projects, Terminal and Messaging. Required CI remains in progress.


## Completed validation and handoff — 2026-09-23

Main advanced during implementation. Merge `dc047ffa3990f748d96e3d922a769f793e652f77`
incorporates Spend and the isolated CI runner fixes. Generated census, migration
ledger and canonical CSS conflicts were resolved through their owning generators.
Relative to current main, the payload diff remains exactly the four approved
numeric ceilings. No extra ceiling, snapshot, suppression or exception was added.

Final Core implementation CI: [run 35921296006](https://github.com/markhayden/bakin/actions/runs/35921296006).
All 17 required jobs passed: standard checks/docs/build/payload, six normal and
stamped-host unit shards, completeness, deterministic catalog/conformance runner,
both Storybook shards, all canonical visual baselines, Chromium/Firefox/WebKit
behavior, and the aggregate UI gate. Local merged verification also passed quick
conformance (228 architecture tests/types), lint, 9,896 unit tests (19 skipped),
production builds, payload, and deterministic Storybook. `ui:conformance --full`
was invoked locally; its redundant Storybook rerun was stopped after the complete
canonical CI matrix passed. The passing CI lanes provide the remaining full-suite
evidence rather than claiming an interrupted local wrapper completed.

Final Projects CI: [run 35921387976](https://github.com/markhayden/bakin-bits-official/actions/runs/35921387976).
Both required jobs passed at `568601a`. CI pins the exact merged Core prerequisite
`dc047ffa3990f748d96e3d922a769f793e652f77`. All ten installed-SDK UI fixtures and
all eight Projects interaction scenarios also passed locally against that merged
package. Bits unit/type/lint/build checks passed (645 tests, 8 opt-in skips).

The final code review findings are resolved, every audit finding has closure in
Projects UI-AUDIT, and all 30 planned tasks are complete. Merge Core #919 first,
then Bits #108. No merge, release, package publication or live installation was
performed. Roll back the consumer first and preserve receipt metadata before any
older-writer downgrade. The pre-kickoff stash and maintainer Storybook are intact.

## Resize affordance follow-up review — 2026-09-23

The desktop Brainstorm heading is removed. Embedded conversation and Projects
sidebar dividers show faint centered grips and highlight their full length in pink
on hover, keyboard focus, and drag. Shared Drawer uses the same private grip and
resize mechanics. Existing mobile disclosure, saved sizes, and size limits remain.
The exact two corrected desktop snapshots and shared-payload relocation were
explicitly approved; see `resize-review/full-divider/README.md` and its manifest.

An independent review found two related cleanup defects: closing a drawer during
a captured drag could strand body cursor/selection overrides, and a second touch
pointer could overwrite the active drag's original body styles. Both were
reproduced by failing regressions and corrected with centralized finalization,
disabled/lost-capture cleanup, and an active-pointer guard. The follow-up review
found no remaining actionable issue. Obsolete Drawer storage readers were removed;
consumer-level hydration/clamping tests cover the shared behavior instead.

Focused regression verification: 19 tests pass, including the new close/reopen
and overlapping-pointer cases. The browser suite also exercises Escape during a
captured drag. Quick conformance passes (228 architecture tests and TypeScript).
All 645 Bits tests pass (8 existing skips), with lint/types passing. Final shared
SDK package, cross-repository pins, complete UI checks, and PR CI are being updated.

The final SDK implementation is `351bd0e64291f40e1453e12081311871f69c58bf`,
including deterministic removal of an unused responsive CSS rule. Bits pins that
revision; Core pins companion `dd4a01cfeca12251fe158b78ab22a5f868437bea`.
[Bits run 35932076978](https://github.com/markhayden/bakin-bits-official/actions/runs/35932076978)
passes both required jobs. All ten installed-package fixtures and eight Projects
browser scenarios also pass locally against that exact SDK.

Local full conformance passed 10,018 unit tests (19 skips), quick checks, lint,
builds, payload, deterministic Storybook, and all Storybook interactions. The
first final Core CI run passed the complete visual baseline suite, both story
shards, Firefox, and the unit/build/docs gates (one unchanged task-menu test
passed its rerun and five local repetitions). Chromium exposed an existing clock
pause race in the async-selection test; WebKit exposed an incorrect assumption
that an unset inline `userSelect` property always reads as an empty string.
The clock now starts before its pause target, and drag cleanup compares the
original inline styles. All 42 checks across the two affected browser files pass
with two repetitions per engine. Quick conformance and lint pass again. These
test-only corrections do not change the SDK pin, approved images, or budgets.
The updated PR checks provide the final merge-gate result.
