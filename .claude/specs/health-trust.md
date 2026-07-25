# SPEC: Health Trust Overhaul

> The dashboard lights up only for things the user can and should act on. Health earns trust by being quiet when things are fine, specific when they aren't, and resolvable in one click wherever the fix is deterministic.

Single-user machine. No backwards compatibility, no shims. Tech-debt reduction is a priority.

## 1. Objective

Three user-visible failures today, all trust-killers:

1. **Standing states masquerade as alerts.** "Premium model on cheap work," enrichment counts, and fossil spend gaps re-announce unchanged facts on every check cycle. The badge is permanently lit; a permanently lit badge trains the user to ignore it.
2. **No memory of what the user has seen.** Stable incident IDs exist (built for repairs) but nothing consumes them for acknowledgement — the 4 failed enrichments ping identically forever.
3. **Standing cards without buttons.** If a card can stay lit for days it must carry its own resolution; several don't.

Deliverables (locked in stakeholder interview 2026-07-24):

### D1 — Acknowledge/snooze (the "I know" verb)
- Per-incident **ack** (silent until material change) and **snooze** (24h / 7d), keyed on the stable incident `id`.
- **Tiered semantics:** advisory/watch/unknown incidents → ack AND snooze. `action_required` → **snooze only, max 7 days**, re-fires on **any** evidence change; never permanently silenceable. Money and outages cannot be forever-muted.
- **Re-fire rule (escalation-only)** for acks: an acked incident auto-un-acks when (a) its effective tier escalates past the tier it was acked at, or (b) its resource set changes (sorted resource-id fingerprint). Counts drifting within the same tier stay silent.
- Suppression is total but transparent: acked/snoozed incidents leave the nav badge, Fix first, the notices popover, and the agent-relay escalation — and collapse into an always-visible **"Acknowledged (N)"** strip on the Health overview with un-ack controls. Nothing is ever hidden; it is quiet.
- CLI parity: `bakin doctor acks`, `bakin doctor ack <incidentId>`, `bakin doctor snooze <incidentId> [--for 24h|7d]`, `bakin doctor unack <incidentId>`.

### D2 — Right-sized producers
- **Enrichment (reframe, per stakeholder):** one coverage stat, never a per-asset nag. The three current observations (`enrichment-failed`, `enrichment-incomplete`, `enrichment-engine`) merge into ONE coverage observation: healthy/info with evidence `{coveragePct, missing, stale, failed, total}`; a single **advisory** only when coverage drops below threshold (default 60%, constant `ENRICHMENT_COVERAGE_ADVISORY_BELOW`); the missing-engine state stays a small advisory config callout with a configure pointer. **Self-healing:** a slow background retry pass (daily tick, re-enqueue failed/missing/stale — no `force`, so nothing re-bills and the done+forVersion skip guard keeps it cheap). Enrichment is a nice-to-have; it is never watch-tier.
- **Premium-on-cheap:** `watch` → **advisory** with a one-click **"Apply recommended routes"** repair on the card (existing `apply-recommended-routes` action — the deterministic subset repair already exists; today only the `unrouted-system-classes` incident carries it). Escalates to watch only when estimated premium-run spend in the 7-day window exceeds a dollar threshold (default $5, constant; estimate via catalog pricing where known — never fabricated).
- **Spend fossils:** permanently-unattributable observed usage (old sessions, no billing-lane evidence) gets a one-click **"Accept unattributed history"** repair recording a durable cutoff day (`acceptUnattributedBefore` on `BudgetPolicy`, persisted through the existing models-plugin budget settings path). `assembleBudgetSpend` excludes pre-cutoff rows from both evidence-gap recording and the unattributed delta; caps compute from the cutoff forward. **No auto-aging — money never silences itself.** Repair safety tier: requires confirmation.

### D3 — Badge honesty (corrected scope)
Recon finding: the badge/notices already read `effectiveDisposition` — there is **no projection bypass**. The lit badge is over-tiered content (D2) plus missing ack filtering (D1). Remaining work: every consumer (badge, Fix first, notices, escalation relay) additionally filters acked/snoozed incidents; the projection carries `ackState` so consumers never re-derive it.

## 2. Architecture (follows existing ONE-engine patterns)

- **Ack store:** new core module `src/core/health-acks.ts` — JSON file at `~/.bakin/health/acks.json` (engine-watch.json read/merge/write pattern: sync fs, ENOENT→empty, validated shape, corrupt file surfaces as evidence_gap, never crashes). Records: `{ incidentId, mode: 'ack'|'snooze', at, until?, tierAtAck, resourceFingerprint, evidenceFingerprint? }`.
- **ONE projection point:** ack state joins in `getHealthReport` (src/core/doctor-report-cache.ts) immediately after `projectEffectiveDispositions` — new `ackState?: 'acked' | 'snoozed'` field on `HealthIncident` (SDK type + producer-facing docs). Expiry/re-fire evaluated at projection time. `ackState` joins `semanticProjectionKey` so ack writes republish live (`bump()`), no doctor re-run. Wire mirror `plugins/health/lib/route-schemas.ts` updated **in lockstep** (rc.25 lesson — a lagging mirror makes the client reject the whole report).
- **Consumers filter, never re-derive:** `useHealthSummary` (badge), `buildHealthOverviewViewModel` (Fix first/notices/new acknowledged bucket), `doctor-escalation.ts` (relay), CLI doctor report.
- **REST:** `POST /doctor/ack`, `POST /doctor/snooze`, `POST /doctor/unack`, `GET /doctor/acks` in plugins/health/index.ts alongside the existing `/doctor/*` group; handlers call the core module; zod schemas both sides.
- **Repairs reuse the existing registry:** premium-on-cheap resolution points at existing `apply-recommended-routes`; new `accept-unattributed-history` repair registered by the health plugin (writes the cutoff via the models budget settings path, affectedCheckIds `['budget']`).
- **Enrichment self-heal:** timer in assets plugin `activate` (24h interval, unref'd), calls `enqueueEnrichmentBackfill` over failed/missing/stale ids without `force`; sweeps are logged, never silent.

## 3. Commands

- Dev loop: `bun run dev` (server code not watched — manual restart). Verification against an isolated server per `.claude/skills/verify` (guest search URL, port 3799).
- Gates before every push: `bun run typecheck` && `bun run lint` (errors block; 6 pre-existing warnings are known) && `bun run test` (full suite, `--isolate`).
- Single file: `bun test tests/path/foo.test.ts --isolate`.

## 4. Project structure (files touched)

- `src/core/health-acks.ts` (new), `src/core/doctor-report-cache.ts`, `src/core/doctor-escalation.ts`
- `packages/sdk/src/types/health.ts` (+ `ackState`), `plugins/health/lib/route-schemas.ts` (mirror, lockstep)
- `plugins/health/index.ts` (routes), `plugins/health/hooks/use-health-summary.ts`, `plugins/health/lib/health-view-model.ts`, `plugins/health/components/overview-alerts.tsx` + incident card controls + Acknowledged strip component
- `plugins/assets/lib/health-checks.ts` (coverage reframe), `plugins/assets/index.ts` (self-heal timer), `plugins/assets/lib/enrichment/queue.ts` (backfill selector only if needed)
- `plugins/models/lib/health-checks.ts` (premium-on-cheap tier + button + dollar threshold)
- `src/core/budget.ts` (+ `acceptUnattributedBefore` on BudgetPolicy + schema), `src/core/budget-spend.ts` (cutoff filters), `plugins/health/lib/system-checks/budget.ts` (card + repair)
- `src/cli/commands/doctor.ts`, `src/core/cli/registry.ts` (CLI verbs)
- Docs: `.claude/knowledge/doctor-and-health-checks.md` (ack system + tier philosophy), `models-plugin.md` (premium threshold, cutoff), `assets-versioning.md` (coverage model + self-heal). README untouched unless health docs are referenced there (verify).

## 5. Code style

Repo conventions apply unchanged: TS strict, zod at boundaries, `createLogger`, no empty catches, kebab-case files, conventional commits with scope. Health-specific rules that bind this work: producers stamp identity (ids/resources/class) — **no consumer parses copy**; observations only through the clamped builders; missing/failed evidence is Unknown, never healthy; the sensitivity/ack projection lives in exactly one place.

## 6. Testing strategy

- Unit: ack store (CRUD, expiry, corrupt file → evidence_gap); re-fire matrix (tier escalation un-acks; same-tier count drift stays acked; resource-set change un-acks; action_required snooze re-fires on any evidence change; snooze expiry); projection (ackState on wire, projection-key includes it, republish on ack write); wire-mirror round-trip (rc.25 regression class).
- Consumers: badge excludes acked; view-model buckets acked into the strip (never dropped); escalation relay skips acked/snoozed.
- Producers: enrichment coverage math + threshold + single-observation output; self-heal pass enqueues without force; premium-on-cheap advisory default + dollar-threshold escalation + repair resolution attached; budget cutoff excludes pre-cutoff rows from gaps AND delta (both windows), repair writes policy.
- CLI: ack/snooze/unack/acks verbs against mocked HTTP.
- All tests follow the isolation rules (content-dir mocks, temp dirs, cleanup). Full suite + typecheck + lint green before each push.

## 7. Boundaries

**Always:** ack suppression is visible somewhere (the strip) — suppressed ≠ deleted; every new severity default errs quiet for nice-to-haves and loud for money/outages; evidence and thresholds ride structured fields.
**Ask first:** any new `action_required` producer; changing snooze max; anything that weakens fail-closed budget behavior beyond the explicit cutoff.
**Never:** auto-age money evidence; make `action_required` permanently ackable; parse incident copy anywhere; a second ack store or projection point; per-asset enrichment CTAs.

**Simplicity mandate (stakeholder, 2026-07-24):** health over-alerting is itself the product of over-engineering — do not fix it with more machinery than needed. Every piece of this build gets the "would a staff engineer ask why didn't you just…" test: the ack store is one flat JSON file, the re-fire rule is one comparison, thresholds are constants (not settings surfaces) until real usage demands otherwise, and no new abstractions/registries/config systems are introduced. When a simpler shape covers the locked decisions, take it.

## 8. Commit strategy (checkpoints for rollback)

Single branch `feat/health-trust-overhaul`, one commit per checkpoint, each independently green (typecheck+lint+targeted tests):

1. `feat(health): ack store + projection ackState + wire mirror` — core module, SDK type, projection join, republish, mirror + round-trip tests. (System works end-to-end via curl; no UI yet.)
2. `feat(health): consumers respect ackState` — badge, view-model + Acknowledged strip UI, notices, escalation relay, card controls.
3. `feat(health): REST + CLI ack verbs`.
4. `feat(assets): enrichment as self-healing coverage` — check reframe + retry pass.
5. `feat(models): premium-on-cheap advisory + one-click routes + dollar escalation`.
6. `feat(budget): accept-unattributed-history cutoff + repair`.
7. `docs(knowledge): health trust model` — knowledge docs + SPEC removal/archival.

Each commit is a rollback point; 4–6 are independent of each other (any can revert alone); 2–3 depend on 1.
