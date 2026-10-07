# Channel Readiness — TODO

Plan: `.claude/specs/channel-readiness/PLAN.md` · Spec: `SPEC.md` (v3)
Branch: `feat/channel-readiness` (main checkout; 3737 serves it for the live test)

## Phase 0
- [x] T0 Spec v3 amendments + PLAN/TODO (commit 1)

## Phase 1 — Foundations
- [x] T1 Core types, classifier, projector, DeliveryError, secret-slot registry, change subscriptions (commit 2 `a5191c74b`)
- [x] T2 Secrets API slots + known-slot rows + shared secret field (commit 3)
- [ ] CHECKPOINT A: lint, typecheck, touched tests, conformance quick

## Phase 2 — Bridge and readiness
- [ ] T3 Bridge status model, reconciliation loop, per-guild cache, classification, ALL ChannelBridge fixtures migrated (commit 4)
- [ ] T4 Readiness collector, /api/channels routes, SSE, fake transport gate (commit 5)
- [ ] CHECKPOINT B: delivery + api suites; isolated boot flip `disabled` → `missing_token` without restart

## Phase 3 — Consumers
- [ ] T5 Health projection, readiness-aware channel checks, targeted reruns, two-mode onboarding check (commit 6)
- [ ] T6 Post-channel memo-first retries, pre-flight, classified failures, outcome memo; alias resolver (commit 7)
- [ ] T7 adapter-pi permanent surface, credential channels, conformance pin + teeth (commit 8)
- [ ] T8 CLI `bakin channels` + `check --json` (commit 9)
- [ ] T9 Switch report channels section + runtime page (commit 10)
- [ ] CHECKPOINT C: all touched suites; lint; typecheck; cycles

## Phase 4 — Channels tab
- [ ] T10 Channels settings tab, routing fields moved, browser fixture (commit 11)
      Decision at task start: host fixture entry in the conformance runner, or Playwright fallback → record here.

## Phase 5 — Proof and docs
- [ ] T12 Readiness-agreement integration test, deterministic fake transport (commit 12)
      Decision at task start: Pi adapter in a throwaway home boots without auth? → record here.
- [ ] T11 Docs sweep (commit 13)
- [ ] CHECKPOINT D: `bun run test` full → `bun run ui:conformance` full (sequential) → lint/typecheck/cycles
- [ ] Owner live runbook on 3737 (SPEC §10) → PR → merge after approval

## Deferred / noticed, not touching
- `tests/ui/architecture/sdk-public-api.test.ts` "matches the reviewed value and type inventory exactly" runs 4.5–5.3 s against a 5 s budget and fails ~2 of 3 `tests/ui/architecture` runs on this box (observed 2026-10-06 during T2's `ui:conformance --quick`; untouched by this branch). Pre-existing time bomb — needs its cost cut, not its timeout widened.
- discord-bridge TODO items not folded in: editApproval embed patch, idempotency-row GC, reply-relay image attachments
- Health repair task titles are generic ("Health repair: N incidents need attention") — separate issue candidate
