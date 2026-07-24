# Plan: Health Trust Overhaul

Source of truth: `SPEC.md` (approved 2026-07-24). Simplicity mandate applies to every task: flat JSON, one comparison for re-fire, constants over settings, no new registries/abstractions.

## Over-engineering cuts made at planning (spec deltas, simpler shapes covering the same decisions)

1. **One ack endpoint, not four.** `POST /doctor/ack { incidentId, action: 'ack' | 'snooze' | 'clear', for?: '24h' | '7d' }` + `GET /doctor/acks`. Replaces spec's ack/snooze/unack trio. CLI verbs map onto it.
2. **No standalone Acknowledged-strip component.** The overview reuses the existing notices/advisories row rendering with an `Acked` chip and a collapsed "Acknowledged (N)" section in the same popover/area — zero new UI primitives.
3. **evidenceFingerprint exists only for `action_required` snoozes** (the "re-fires on any evidence change" rule needs it: a SHA of the linked observations' evidence at snooze time). Acks don't carry it — their re-fire is tier + resource fingerprint only.
4. **Premium-on-cheap dollar estimate** = run count × catalog per-token pricing over the rows already scanned — computed inline in the existing check, no new pricing plumbing. Unpriceable models simply can't escalate (stay advisory) — never fabricated.

## Dependency graph

```
CP1 ack core (store + projection + wire mirror)   ──► CP2 consumers (badge/view-model/escalation/UI)
                                                  ──► CP3 REST + CLI
CP4 enrichment reframe        (independent)
CP5 premium-on-cheap          (independent)
CP6 budget cutoff             (independent)
CP7 docs                      (after all)
```

CP2 and CP3 both depend only on CP1. CP4–CP6 touch disjoint files and can land/revert in any order.

## Checkpoint 1 — ack core (vertical: curl-testable end to end)

**Files:** `src/core/health-acks.ts` (new), `src/core/doctor-report-cache.ts`, `packages/sdk/src/types/health.ts`, `plugins/health/lib/route-schemas.ts`, tests.

Tasks:
1. `health-acks.ts`: flat store at `~/.bakin/health/acks.json` (engine-watch pattern: sync fs, ENOENT→`{}`, validated, corrupt→typed error the projection surfaces as evidence_gap—not a crash). API: `getAckRecords()`, `setAck(record)`, `clearAck(incidentId)`, `resolveAckState(incident, record, now)` — the ONE re-fire comparison: 
   - record expired (`until < now`) → none (record pruned lazily)
   - ack: effective tier order > `tierAtAck` OR sorted-resource-id fingerprint differs → none (pruned) ; else `'acked'`
   - snooze (`action_required`): any change in `{status, class, observationIds, evidenceSha}` → none ; else `'snoozed'`
2. Projection join in `getHealthReport`: after `projectEffectiveDispositions`, before `deriveSearchReadiness`/`deriveHealthReportStatus` — map incidents adding `ackState?: 'acked'|'snoozed'`. `deriveHealthReportStatus` treats acked/snoozed incidents as non-attention (an all-acked box shows calm overall). `semanticProjectionKey` incident tuple gains `ackState` (republish-on-ack + snooze-expiry resolves at next report access — document ±one-doctor-tick lag).
3. SDK `HealthIncident.ackState?` + **lockstep** wire-mirror update in `route-schemas.ts` (same commit, rc.25 regression class), + mirror round-trip test.
4. Ack writes call `bump()` (exported hook or via a small `onAcksChanged` callback registered by doctor-report-cache — whichever is fewer lines).

**Acceptance:** with server running, writing an ack record then GET `/doctor` shows `ackState: 'acked'` on the incident and overall status calm; corrupting acks.json yields an evidence_gap observation, never a crash.
**Verify:** typecheck+lint; `bun test tests/core/health-acks.test.ts tests/core/doctor-cache.test.ts tests/plugins/health/route-schemas.test.ts --isolate`.
**Rollback:** single commit revert; nothing else references the module yet.

## Checkpoint 2 — consumers respect ackState

**Files:** `plugins/health/hooks/use-health-summary.ts`, `plugins/health/lib/health-view-model.ts`, `plugins/health/components/overview-alerts.tsx` (+ card ack/snooze controls in the incident card component), `src/core/doctor-escalation.ts`.

Tasks: badge count excludes `ackState` set; view-model routes acked/snoozed into a new `acknowledged` bucket (rendered as collapsed "Acknowledged (N)" with un-ack button; never dropped); notices exclude them; escalation relay (`freshActionRequiredIncidents`) excludes snoozed; card controls: Ack (hidden on action_required) + Snooze 24h/7d menu + Un-ack, calling the CP3 endpoint (temporarily direct fetch if CP2 lands before CP3 — order CP3 before CP2 if cleaner; the graph allows either).
**Acceptance:** acking the premium card in the UI drops badge count immediately (SSE republish), card moves to Acknowledged (N), relay never pings for it.
**Verify:** `bun test tests/plugins/health/ --isolate` (view-model + summary + escalation tests extended).
**Rollback:** revert commit; CP1 wire field is optional so older UI ignores it.

## Checkpoint 3 — REST + CLI

**Files:** `plugins/health/index.ts`, `plugins/health/lib/route-schemas.ts` (request schemas), `src/cli/commands/doctor.ts`, `src/core/cli/registry.ts`.

Tasks: `POST /doctor/ack` (validates tier rules server-side: reject `action:'ack'` on action_required; snooze `for` capped 7d), `GET /doctor/acks`; CLI `bakin doctor acks | ack <id> | snooze <id> [--for 24h|7d] | unack <id>` following `cmdDoctorRepair` shape.
**Acceptance:** curl + CLI round-trips; invalid ack-on-action_required → 400 with honest message.
**Verify:** route tests + CLI test; lint/typecheck.

## Checkpoint 4 — enrichment as self-healing coverage (independent)

**Files:** `plugins/assets/lib/health-checks.ts`, `plugins/assets/index.ts`, tests.

Tasks: replace three observations with ONE `enrichment-coverage` observation: evidence `{coveragePct, total, missing, stale, failed, engineAvailable}`; healthy when coverage ≥ `ENRICHMENT_COVERAGE_ADVISORY_BELOW` (0.6) or total < 5 (tiny stores never alert); single advisory below threshold; engine-missing folds into the same observation's copy as a config pointer (advisory only when assets exist wanting enrichment). Self-heal: 24h unref'd interval in activate → `enqueueEnrichmentBackfill(failed+missing+stale ids, { force: false })` + one log line per pass.
**Acceptance:** 4 failed / 92 enriched → healthy line "96% enriched (4 failed — retried automatically)"; no incident. 50 missing of 60 → one advisory.
**Verify:** `bun test tests/plugins/assets/ --isolate`.
**Rollback:** independent revert.

## Checkpoint 5 — premium-on-cheap advisory + button + $ threshold (independent)

**Files:** `plugins/models/lib/health-checks.ts`, tests.

Tasks: disposition advisory; resolution → `{ type:'repair', actionId:'apply-recommended-routes' }`; inline estimate: `estimatedUsd` from catalog pricing × row token counts (rows already carry tokens? verify — else runs×avg is NOT acceptable: skip escalation without honest pricing); escalate to watch when `estimatedUsd > PREMIUM_ON_CHEAP_WATCH_USD (5)` over the window; evidence gains `estimatedUsdMicros | null`.
**Acceptance:** default field state (your 10 relay turns) renders advisory with working one-click; forcing estimate > $5 in test → watch.
**Verify:** `bun test tests/plugins/models/ --isolate`.

## Checkpoint 6 — accept-unattributed-history cutoff (independent)

**Files:** `src/core/budget.ts` (+schema), `src/core/budget-spend.ts`, `plugins/health/lib/system-checks/budget.ts`, `plugins/models/lib/route-schemas.ts` (BudgetPolicySchema), tests.

Tasks: `BudgetPolicy.acceptUnattributedBefore?: string` (local day key); `assembleBudgetSpend` skips pre-cutoff rows in BOTH the observed gap loop and the unattributed delta; new repair `accept-unattributed-history` (health plugin, confirmation-tier) writing cutoff = today via the models budget settings path; spend card resolution offers it when gaps are attribution-only AND older than the scan horizon; evidence includes the proposed cutoff date.
**Acceptance:** fossil rows (May/June) with cutoff set → no gaps, no card, caps compute clean; post-cutoff gaps still fail closed.
**Verify:** `bun test tests/plugins/health/budget.test.ts tests/core/budget* --isolate`.
**Boundary check:** never auto-ages — only the repair writes the cutoff.

## Checkpoint 7 — docs

`.claude/knowledge/doctor-and-health-checks.md` (ack system, tier philosophy, re-fire rules, simplicity mandate), `models-plugin.md` (premium threshold + cutoff field), `assets-versioning.md` (coverage model + self-heal). Verify README mentions nothing stale. Delete `SPEC.md` + `tasks/` (content absorbed into knowledge docs) or move spec to `.claude/specs/health-trust.md` per repo convention — decide at the checkpoint.

## Global gates

Every checkpoint: `bun run typecheck` + `bun run lint` (0 errors) + targeted tests. Before push: full `bun run test`. Live verification on 3737 (Mark) before merge per house rule; isolated-server curl checks (verify skill) for CP1/CP3.
