# Channel Readiness — TODO

Plan: `.claude/specs/channel-readiness/PLAN.md` · Spec: `SPEC.md` (v3)
Branch: `feat/channel-readiness` (main checkout; 3737 serves it for the live test)

## Phase 0
- [x] T0 Spec v3 amendments + PLAN/TODO (commit 1)

## Phase 1 — Foundations
- [x] T1 Core types, classifier, projector, DeliveryError, secret-slot registry, change subscriptions (commit 2 `a5191c74b`)
- [x] T2 Secrets API slots + known-slot rows + shared secret field (commit 3)
- [x] CHECKPOINT A: lint, typecheck, touched tests, conformance quick (architecture-contract freeze test flake noted below)

## Phase 2 — Bridge and readiness
- [x] T3 Bridge status model, reconciliation loop, per-guild cache, classification, ALL ChannelBridge fixtures migrated (commit 4)
- [x] T4 Readiness collector, /api/channels routes, SSE, fake transport gate (commit 5)
- [x] CHECKPOINT B: delivery + api suites; isolated boot flip `disabled` → `missing_token` without restart (verified 2026-10-06 on an isolated Pi boot: POST /api/settings flipped GET /api/channels from disabled/enable to missing_token/add_token live)

## Phase 3 — Consumers
- [x] T5 Health projection, readiness-aware channel checks, targeted reruns, two-mode onboarding check (commit 6)
- [x] T6 Post-channel memo-first retries, pre-flight, classified failures, outcome memo; alias resolver (commit 7)
- [x] T7 adapter-pi permanent surface, credential channels, conformance pin + teeth (commit 8)
- [x] T8 CLI `bakin channels` + `check --json` (commit 9)
- [x] T9 Switch report channels section + runtime page (commit 10)
- [x] CHECKPOINT C: all touched suites; lint; typecheck; cycles (2026-10-06)

## Phase 4 — Channels tab
- [x] T10 Channels settings tab, routing fields moved, browser fixture (commit 11)
      Decision (2026-10-06): a host fixture entry in `scripts/ui/verify-plugin-conformance.ts` (`host-channels-tab` → `packages/host/tests/channels-tab.ui.fixture.tsx`, framed like the /settings route so the page has its h1/h2) — the runner takes any fixture entry and uses pluginId only as a label; it passed clean (overflow / axe / keyboard / console, desktop + mobile). No Playwright fallback needed. `capabilities-tab.tsx`'s "Add the key in Settings" link stays on Integrations & Keys — it is about pack secrets, not Discord.

## Phase 5 — Proof and docs
- [ ] T12 Readiness-agreement integration test, deterministic fake transport (commit 12)
      Decision (verified 2026-10-06 during T3's isolated boot): the Pi adapter boots in a throwaway `PI_HOME` with no auth (`BAKIN_RUNTIME_ADAPTER=pi`, manifest 200, idle line logged) → the spawned-server approach stands; no fallback needed.
- [ ] T11 Docs sweep (commit 13)
- [ ] CHECKPOINT D: `bun run test` full → `bun run ui:conformance` full (sequential) → lint/typecheck/cycles
- [ ] Owner live runbook on 3737 (SPEC §10) → PR → merge after approval

## Deferred / noticed, not touching
- `tests/ui/architecture/sdk-public-api.test.ts` "matches the reviewed value and type inventory exactly" runs 4.5–5.3 s against a 5 s budget and fails ~2 of 3 `tests/ui/architecture` runs on this box (observed 2026-10-06 during T2's `ui:conformance --quick`; untouched by this branch). Pre-existing time bomb — needs its cost cut, not its timeout widened.
- discord-bridge TODO items not folded in: editApproval embed patch, idempotency-row GC, reply-relay image attachments
- Health repair task titles are generic ("Health repair: N incidents need attention") — separate issue candidate
