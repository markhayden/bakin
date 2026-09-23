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
