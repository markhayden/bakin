# Health Trust Overhaul — Task List

Plan: `tasks/plan-health-trust.md` · Spec: `SPEC.md` (root, approved 2026-07-24)
Branch: `feat/health-trust-overhaul` (main checkout; Mark tests live on 3737 before merge).

## CP1 — ack core
- [ ] `src/core/health-acks.ts`: store (ENOENT→empty, validated, corrupt→typed error) + `resolveAckState` one-comparison re-fire
- [ ] Projection join in `getHealthReport` (before status derivation); acked/snoozed excluded from attention in `deriveHealthReportStatus`
- [ ] `semanticProjectionKey` gains ackState; ack writes trigger `bump()`
- [ ] SDK `HealthIncident.ackState?` + wire mirror lockstep + round-trip test
- [ ] Tests: store CRUD/expiry/corrupt; re-fire matrix (tier-escalation, same-tier drift, resource change, action_required any-evidence, snooze expiry); projection + republish
- [ ] Gate: typecheck, lint, targeted tests → commit 1

## CP2 — consumers
- [ ] Badge (`use-health-summary`) excludes acked/snoozed
- [ ] View-model `acknowledged` bucket + "Acknowledged (N)" collapsed section + un-ack
- [ ] Notices exclude; escalation relay excludes snoozed
- [ ] Card controls: Ack (not on action_required) / Snooze 24h·7d / Un-ack
- [ ] Tests extended; gate → commit 2

## CP3 — REST + CLI
- [ ] `POST /doctor/ack` (single endpoint, action=ack|snooze|clear; server-side tier rules) + `GET /doctor/acks` + zod both sides
- [ ] CLI: `bakin doctor acks|ack|snooze|unack` + registry usage
- [ ] Tests; gate → commit 3

## CP4 — enrichment coverage (independent)
- [ ] ONE `enrichment-coverage` observation; threshold 60%; tiny-store guard; engine-missing folded as config pointer
- [ ] 24h self-heal backfill pass (no force), logged
- [ ] Tests; gate → commit 4

## CP5 — premium-on-cheap (independent)
- [ ] Advisory + `apply-recommended-routes` resolution
- [ ] Honest $ estimate from catalog pricing (null when unpriceable → never escalates); watch above $5/7d
- [ ] Tests; gate → commit 5

## CP6 — budget cutoff (independent)
- [ ] `BudgetPolicy.acceptUnattributedBefore` + schema
- [ ] `assembleBudgetSpend` pre-cutoff exclusion (gap loop + delta)
- [ ] `accept-unattributed-history` repair (confirmation-tier) + card resolution when fossil-only
- [ ] Tests incl. fail-closed-after-cutoff; gate → commit 6

## CP7 — docs
- [ ] Knowledge docs (doctor-and-health-checks, models-plugin, assets-versioning)
- [ ] README staleness check; SPEC.md → `.claude/specs/health-trust.md`; prune tasks files
- [ ] Full suite + lint + typecheck → commit 7 → push → PR

## Final
- [ ] Full `bun run test` green, lint 0 errors, typecheck clean
- [ ] Isolated-server curl validation (CP1/CP3) via verify recipe
- [ ] PR with per-checkpoint summary; Mark live-tests on 3737
