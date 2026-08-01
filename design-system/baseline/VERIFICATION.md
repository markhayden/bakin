# Baseline verification

Verified on 2026-07-16 with the environment recorded in `current/report.json`.

- Two independent captures started from newly seeded temporary fixture homes.
- Both produced 8 scenarios, 16 desktop/mobile screenshots, 26 host route
  files, 13 core plugin manifests, and 3 Bits plugin manifests.
- Every capture loaded its intended page; no browser console errors, console
  warnings, or failed requests were recorded.
- All non-diagnostic surfaces differed by at most 0.013% of raw pixel channels
  between runs. Several were byte-identical.
- Health Activity retained its live call evidence and differed by 0.741% at
  desktop and 3.891% at mobile while preserving the same structure. Exact
  fixture-owned pixels move to the canonical component/story suite in T8.
- `ui:baseline:check` passed for both runs, including screenshot hashes and
  report portability. `size:report`, focused tests, lint, and typecheck passed.

The audit also found that official Bits Messaging currently declares the
removed `contributes.nav[].alwaysExpanded` field and is rejected by current
Bakin. Projects is therefore the valid Bits baseline specimen. T3 owns removal
of that field and the full Messaging/Projects/template compatibility matrix.
