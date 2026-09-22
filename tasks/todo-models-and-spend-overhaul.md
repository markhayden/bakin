# TODO — Models & Spend Overhaul

Plan: `tasks/plan-models-and-spend-overhaul.md` (v2) · Spec: `.claude/specs/models-and-spend-overhaul.md` (v3.1)

## Approvals
- [x] Q3: `scan_days` table in usage.db — APPROVED 2026-09-21 (strictly necessary for honest coverage; single write path)
- [ ] D23: `ModelSelectOption.description/tone` — checkpoint at T3.1

## PR 1 — feat/907-model-trust
- [ ] T1.1 contract members (optional) + mocks + conformance pins (knobs 'absent') + teeth + arch secret-ban
- [ ] T1.2 adapter-pi impl (runner → 'present')
- [ ] T1.3 adapter-openclaw impl, partial-evidence honest (runner → 'present'); record Q2 answer
- [ ] T1.4 eligibility engine + truth table (explicit runtime/agentId/epoch)
- [ ] T1.5 /available eligibility + suffix-disabled options in models + team pickers
- [ ] T1.6 selections, revision, proposals; same-id helper moved from roster-reconcile
- [ ] T1.7 mutateSelections tri-state + per-DOCUMENT reservations (released only on settle / prior-boot classification) + GET/POST /selections (additive) + `bakin models restore` (full-state snapshot → diff → current revision); tests: timeout→GET→retry 409→settle with write spy, two refs one document, restart classification, restore after Reset and after an edit
- [ ] T1.8 all writers → /selections; DELETE old write routes  **[PoNR]**
- [ ] T1.9 models.dead-selections check + apply-model-proposal repair
- [ ] T1.10a preDispatchGate + effective-selection model hold (5 callers)
- [ ] T1.10b GET /holds + tasks use-model-holds + task-card "Model can't run" → /models?ref=
- [ ] T1.10c error translation (dispatch-failures + enrichment)
- [ ] T1.11 rig verify #907 item 5 (record in spec §11 Q1)
- [ ] T1.12 pending-restart.json + restartAdvice banner + delete dirty markers (models + team)
- [ ] T1.13 runtime-switch reconcile-selections + epoch-guarded resetModelsCache (+ stale-fetch test)
- [ ] T1.14 docs (models-plugin, runtime-capabilities, doctor, adapter-architecture, dispatch, CLAUDE.md, README check)
- [ ] CHECKPOINT A: gates + ui:conformance --full + /verify S1(fixture-written) S2 S3 S10(late-settle) S15 S16 + live test → merge

## PR 2 — feat/spend-plugin
- [ ] T2.1 bits grep gate
- [ ] T2.2 atomic plugin-settings writes
- [ ] T2.3 curated catalog → packages/core/src/llm/model-catalog.ts
- [ ] T2.4 spend scaffold (ids, static imports ×3, config, enrollment, route, router, route-shadow, nav-placement, census) — page shell only
- [ ] T2.5 pure moves into plugins/spend (billing, budget routes/schemas, health check, overview components); Models still owns hooks/routes; delete legacy budget-migration
- [ ] T2.6 ledger v10: budget_milestones + incident episode/event_id/notified_at + reopen set incl. rule_removed; mark verbs take (id, eventId); evaluateBudget.crossed; warn incidents removed; consumers updated (S14 test; stale-eventId mark changes 0 rows)
- [ ] T2.7 CUTOVER (XL exception, one commit): upgrade+backup, spend.* hooks, fail-closed budget_policy_unavailable, health-owned spend.policy-available, PUT/GET /limits + Limits list, delete Models budget surface, repoint every caller + CLI endpoints, regen docs  **[PoNR]**
- [ ] T2.9a scan_days receipts (complete-coverage only, 90-day prune)
- [ ] T2.9b assembleSpendForDays — day-set variant of the ONE spend engine (behaviour-neutral refactor of assembleBudgetSpend)
- [ ] T2.9c coverage summary via the engine + limit dialog + normalized suggestion (tests: unavailable roster, partial, zero-use covered day, backfill excluded, 14d@$10 ⇒ ~$450, prune, same-$10-in-both-stores counts once, suggestion == Overview)
- [ ] T2.8 Overview tab live (lane-honest tiles, pace line with observed-days basis) — after T2.9
- [ ] T2.10 spend observer (coalesced, generation-keyed memo) + incident at 100 + single-worker deliverPending marking (id, event_id) + hook points (recordSpend, scan, watchdog, boot); tests incl. reopen-during-in-flight-delivery and concurrent boot+watchdog callers
- [ ] T2.11 ladder: badge provider (eager), header banners with computed offsets (90 yellow ack / 100 red actions), status milestones, Resume 409 still_over_limit
- [ ] T2.12 remove nags; CLI --at-cap wait|pause, no --warn, milestones, pace basis; onboarding budget → note; ONBOARDING_VERSION bump
- [ ] T2.13 spend UI fixture → conformant (inspect test-results/bakin-ui/index.html)
- [ ] T2.14 docs: spend-plugin.md (new, behaviour table), models-plugin, execution-ledger, doctor, cost-control-v2 status, CLAUDE.md (14 plugins, spend.json, pending files)
- [ ] CHECKPOINT B: gates + ui:conformance --full + ui:test:conformance + /verify S8 S9 S12 S13 S14 + upgrade crash matrix + live test → merge

## PR 3 — feat/models-plan-page
- [ ] T3.1 D23 approval → sdk contract + DisabledWithReason story + public-api (or record fallback)
- [ ] T3.2 recommender (absorbs recommendRoutes) + GET /plan + bakin models plan [--apply] (restore already shipped in PR 1)
- [ ] T3.3 onboarding models step + ONBOARDING_VERSION bump
- [ ] T3.4 page shell: mode toggle, catalog panel, ?ref, classification, pending chips (old tabs still mounted)
- [ ] T3.5 draft/op model + one SaveBar + partial-failure/pending UI + dirty-exit guard
- [ ] T3.6 Simple view + save-minimality property test
- [ ] T3.7 Reset: buildResetOps, dialog, snapshot, refused-with-dirty-draft
- [ ] T3.8 Advanced sections support-gated
- [ ] T3.9 selection callouts (stage-into-draft)
- [ ] T3.10 Team shared options hook + models.catalog_changed
- [ ] T3.11 delete tabs, dead Settings field, stale hooks  **[PoNR]**
- [ ] T3.12 docs: models-plugin, onboarding, CLI, CLAUDE.md routing paragraph, README
- [ ] CHECKPOINT C: gates + ui:conformance --full + ui:test:conformance (models) + /verify S4 S5 S6 S7 S10 S11 + live test → merge

## Close-out
- [ ] #907 closed with rig note; #378 comment (model slice shipped); #878 comment (Models half shipped)
- [ ] Memory note updated to COMPLETE
