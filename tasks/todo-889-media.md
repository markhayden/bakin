# TODO: #889 media zero-install (plan: tasks/plan-889-media.md)

Branch: `feat/889-media-zero-install` (main checkout — 3737 serves it)

## Phase 1 — Foundation
- [ ] T1  Shared download-verify-commit primitive + loopback tests (C1)
- [ ] T2  Refit bin-installer, zero test edits (C2)
- [ ] T3  Refit requirements-installer, zero test edits (C3)
- [ ] CP-A lint + typecheck + agent-packages area green

## Phase 2 — Media store
- [ ] T4  Sharp pin + generate-media-pin script (C4)
- [ ] T5  Store installer: download→stage→bundle→place→probe→commit (C5)
- [ ] T6  Loader disk fallback + re-probe + sharp compile external (C6)
- [ ] T7  Compile-and-run regression + teeth test (C7)
- [ ] CP-B compiled test green darwin; push; linux CI leg green

## Phase 3 — Surfaces
- [ ] T8  Onboarding component media (order 16, version 4, allowlists, FIXABLE) (C8)
- [ ] T9  Doctor media.sharp + one-click repair (C9)
- [ ] T10 Remediation-aware error messages (C10)
- [ ] CP-C full suite + lint + typecheck green

## Phase 4 — Docs + ship
- [ ] T11 media-pipeline.md + stale-doc sweep + antfly-refit follow-up issue (C11)
- [ ] CP-D live test on 3737 (doctor repair + >2MB enrichment), PR, Mark approves, merge
