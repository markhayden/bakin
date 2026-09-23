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
