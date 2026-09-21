# TODO: #889 media zero-install (plan: tasks/plan-889-media.md)

Branch: `feat/889-media-zero-install` (main checkout — 3737 serves it)

## Phase 1 — Foundation
- [x] T1  Shared download-verify-commit primitive + loopback tests (C1)
- [x] T2  Refit bin-installer, zero test edits (C2)
- [x] T3  Refit requirements-installer, zero test edits (C3)
- [x] CP-A lint + typecheck + agent-packages area green

## Phase 2 — Media store
- [x] T4  Sharp pin + generate-media-pin script (C4)
- [x] T5  Store installer: download→stage→bundle→place→probe→commit (C5)
- [x] T6  Loader disk fallback + re-probe + sharp compile external (C6)
- [x] T7  Compile-and-run regression + teeth test (C7)
- [x] CP-B compiled test green darwin; pushed (CI is PR-triggered — linux leg verified at PR time)

## Phase 3 — Surfaces
- [x] T8  Onboarding component media (order 16, version 4, allowlists, FIXABLE) (C8)
- [x] T9  Doctor media.sharp + one-click repair (C9)
- [x] T10 Remediation-aware error messages (C10)
- [ ] CP-C full suite + lint + typecheck green

## Phase 4 — Docs + ship
- [x] T11 media-pipeline.md + stale-doc sweep + antfly-refit follow-up issue (C11)
- [ ] CP-D live test on 3737 (doctor repair + >2MB enrichment), PR, Mark approves, merge
