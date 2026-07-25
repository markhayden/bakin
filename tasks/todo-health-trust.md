# Health Trust Overhaul — Task List

Plan: `tasks/plan-health-trust.md` · Spec: `SPEC.md` (root, approved 2026-07-24)
Branch: `feat/health-trust-overhaul` (main checkout; Mark tests live on 3737 before merge).

## CP1 — ack core
- [x] `src/core/health-acks.ts`: store (ENOENT→empty, validated, corrupt→typed error) + `resolveAckState` one-comparison re-fire
- [x] Projection join in `getHealthReport` (before status derivation); acked/snoozed excluded from attention in `deriveHealthReportStatus`
- [x] `semanticProjectionKey` gains ackState; ack writes trigger `bump()`
- [x] SDK `HealthIncident.ackState?` + wire mirror lockstep + round-trip test
- [x] Tests: store CRUD/expiry/corrupt; re-fire matrix (tier-escalation, same-tier drift, resource change, action_required any-evidence, snooze expiry); projection + republish
- [x] Gate: typecheck, lint, targeted tests → commit 1

## CP2 — consumers
- [x] Badge (`use-health-summary`) excludes acked/snoozed
- [x] View-model `acknowledged` bucket + "Acknowledged (N)" collapsed section + un-ack
- [x] Notices exclude; escalation relay excludes snoozed
- [x] Card controls: Ack (not on action_required) / Snooze 24h·7d / Un-ack
- [x] Tests extended; gate → commit 2

## CP3 — REST + CLI
- [x] `POST /doctor/ack` (single endpoint, action=ack|snooze|clear; server-side tier rules) + `GET /doctor/acks` + zod both sides
- [x] CLI: `bakin doctor acks|ack|snooze|unack` + registry usage
- [x] Tests; gate → commit 3

## CP4 — enrichment coverage (independent)
- [x] ONE `enrichment-coverage` observation; threshold 60%; tiny-store guard; engine-missing folded as config pointer
- [x] 24h self-heal backfill pass (no force), logged
- [x] Tests; gate → commit 4

## CP5 — premium-on-cheap (independent)
- [x] Advisory + `apply-recommended-routes` resolution
- [x] Honest $ estimate from catalog pricing (null when unpriceable → never escalates); watch above $5/7d
- [x] Tests; gate → commit 5

## CP6 — budget cutoff (independent)
- [x] `BudgetPolicy.acceptUnattributedBefore` + schema
- [x] `assembleBudgetSpend` pre-cutoff exclusion (gap loop + delta)
- [x] `accept-unattributed-history` repair (confirmation-tier) + card resolution when fossil-only
- [x] Tests incl. fail-closed-after-cutoff; gate → commit 6

## CP7 — docs
- [x] Knowledge docs (doctor-and-health-checks, models-plugin, assets-versioning)
- [x] README staleness check; SPEC.md → `.claude/specs/health-trust.md` DONE; plan/todo stay per repo convention
- [x] Full suite + lint + typecheck → commit 7 → push → PR

## Final
- [x] Full `bun run test` green, lint 0 errors, typecheck clean
- [ ] Isolated-server curl validation (CP1/CP3) via verify recipe
- [ ] PR with per-checkpoint summary; Mark live-tests on 3737
