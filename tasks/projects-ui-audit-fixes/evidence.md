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
