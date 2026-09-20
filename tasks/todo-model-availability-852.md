# TODO: #852 Model Availability (spec: .claude/specs/model-availability-852.md, plan: tasks/plan-model-availability-852.md)

Branch: `feat/852-model-availability` (main checkout; Mark live-tests before merge)

## Phase 1 — Typed signal
- [ ] T1: `model_not_supported` kind + dispatch switches + non-retryable policy — commit 1
- [ ] T2: Pi classification branch + stream chunk `{kind, model}` + carrier attribution — commit 2

## Phase 2 — Durable evidence
- [ ] T3: `model_rejections` migration v9 + ledger verbs + facade re-exports — commit 3
- [ ] T4: facade recording wrapper (`src/core/model-availability.ts`) — commit 4
- [ ] CHECKPOINT A: `bun run lint` + `bun run test` full green

## Phase 3 — Consumption
- [ ] T5: availability overlay (flip, never cached, fail-open) + /refresh ordering — commit 5
- [ ] T6: health evidence sharpening + recommender regression test — commit 6
- [ ] T7: UI rejected badge (load bakin-ui-conformance first; `ui:conformance --quick`) — commit 7
- [ ] CHECKPOINT B: full gate green; Mark live-test window

## Phase 4 — Probe
- [ ] T8: optional `models.probe` contract + Pi impl + conformance feature-detect — commit 8
- [ ] T9: `/refresh { probe }` + verdicts + "Verify availability" UI action — commit 9

## Phase 5 — Carrier ladder
- [ ] T10: two-rung codex carrier ladder (rejection-only fallthrough) — commit 10

## Phase 6 — Docs + gate
- [ ] T11: knowledge docs + CLAUDE.md touch-ups + README confirm-no-impact — commit 11
- [ ] T12: final gate (lint/test/conformance) + PR for #852 + live-test checklist
