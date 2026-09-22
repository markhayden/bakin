# TODO — Models & Spend Overhaul

Plan: `tasks/plan-models-and-spend-overhaul.md` (v2) · Spec: `.claude/specs/models-and-spend-overhaul.md` (v3.1)

## Approvals
- [x] Q3: `scan_days` table in usage.db — APPROVED 2026-09-21 (strictly necessary for honest coverage; single write path)
- [ ] D23: `ModelSelectOption.description/tone` — checkpoint at T3.1

## PR 1 — feat/907-model-trust
- [x] T1.1 contract members (optional) + mocks + conformance pins (knobs 'absent') + teeth + arch secret-ban — cbfa2d04e
- [x] T1.2 adapter-pi impl — 4f69b258d
- [x] T1.3 adapter-openclaw impl, partial-evidence honest; Q2 recorded — ec05d3212
- [x] T1.4 eligibility engine + truth table — see git log
- [x] T1.5 /available eligibility + suffix-disabled options in models + team pickers — see git log
- [x] T1.6 selections, revision, proposals; same-id helper — see git log
- [x] T1.7 mutateSelections tri-state + per-DOCUMENT reservations (released only on settle / prior-boot classification) + GET/POST /selections (additive) + `bakin models restore` (full-state snapshot → diff → current revision); tests: timeout→GET→retry 409→settle with write spy, two refs one document, restart classification, restore after Reset and after an edit
- [x] T1.8 all writers → /selections; DELETE old write routes  **[PoNR]** — see git log
- [x] T1.9 models.dead-selections check + apply-model-proposal repair — see git log
- [x] T1.10a preDispatchGate + effective-selection model hold (5 callers) — see git log
- [x] T1.10b GET /holds + tasks use-model-holds + task-card signal — see git log
- [x] T1.10c error translation (dispatch-failures + enrichment) — see git log
- [x] T1.11 #907 item 5 pinned in-process (no cache); live Pi-box confirmation at Checkpoint A — see git log
- [x] T1.12 pending-restart.json + restartAdvice banner + delete dirty markers — see git log
- [x] T1.13 runtime-switch reconcile-selections + epoch-guarded resetModelsCache — see git log
- [x] T1.14 docs — see git log (README unaffected)
- [~] CHECKPOINT A: gates green; /verify S1/S2/S10/S15/S16 passed on an isolated Pi boot (three findings fixed, 59853649f); OPEN: payload-ratchet raise needs Mark's approval (models +3.9 KB, tasks +2.5 KB); `ModelSelect › Grouped Catalog` story flake is pre-existing (#904 class); live test on 3737 by Mark → merge

## PR 2 — feat/spend-plugin
- [ ] T2.1 bits grep gate
- [ ] T2.2 atomic plugin-settings writes
- [ ] T2.3 curated catalog → packages/core/src/llm/model-catalog.ts
- [x] T2.4 spend scaffold (ids, static imports ×3, config, enrollment, route, router, route-shadow, nav-placement, census) — page shell only
- [x] T2.5 spend ownership series (4 commits: core hoists → health check to spend → legacy budget-migration deleted → Spend UI to /spend with use-spend-data); billing.ts/budget-routes.ts/hooks stay in Models until T2.7 (plugin-boundary rule)
- [x] T2.6 ledger v10: budget_milestones + incident episode/event_id/notified_at + reopen set incl. rule_removed; mark verbs take (id, eventId); evaluateBudget.crossed; warn incidents removed; consumers updated (S14 test; stale-eventId mark changes 0 rows)
- [x] T2.7 CUTOVER (XL exception, one commit): upgrade+backup, spend.* hooks, fail-closed budget_policy_unavailable, health-owned spend.policy-available, PUT/GET /limits + Limits list, delete Models budget surface, repoint every caller + CLI endpoints, regen docs  **[PoNR]**
- [x] T2.9a scan_days receipts (complete-coverage only, 90-day prune)
- [x] T2.9b assembleSpendForDays — day-set variant of the ONE spend engine (behaviour-neutral refactor of assembleBudgetSpend)
- [x] T2.9c coverage summary via the engine + limit dialog + normalized suggestion (tests: unavailable roster, partial, zero-use covered day, backfill excluded, 14d@$10 ⇒ ~$450, prune, same-$10-in-both-stores counts once, suggestion == Overview)
- [x] T2.8 Overview tab live (lane-honest tiles, pace line with observed-days basis) — after T2.9
- [x] T2.10 spend observer (coalesced, generation-keyed memo) + incident at 100 + single-worker deliverPending marking (id, event_id) + hook points (recordSpend, scan, watchdog, boot); tests incl. reopen-during-in-flight-delivery and concurrent boot+watchdog callers
- [x] T2.11 ladder: badge provider (eager), header banners with computed offsets (90 yellow ack / 100 red actions), status milestones, Resume 409 still_over_limit
- [x] T2.12 remove nags; CLI --at-cap wait|pause, no --warn, milestones, pace basis; onboarding budget → note; ONBOARDING_VERSION bump
- [x] T2.13 spend UI fixture → conformant (inspect test-results/bakin-ui/index.html)
- [x] T2.14 docs: spend-plugin.md (new, behaviour table), models-plugin, execution-ledger, doctor, cost-control-v2 status, CLAUDE.md (14 plugins, spend.json, pending files)
- [~] CHECKPOINT B (2026-09-22): gates green; ui:conformance --full green except the pre-existing #904 `ModelSelect › Grouped Catalog` story flake (Base UI focus-guard aria-hidden-focus; fails identically without this branch's changes); ui:test:conformance green (spend graduated); /verify on an isolated boot with a seeded legacy models.json: upgrade at activation (ids, no warnPct, backup, keys stripped) → boot pass recorded 50 (covered by 75) + 75 delivered → cap crossed ⇒ 90 covered by 100 + cap incident episode 1 delivered once → resume refused 409 still_over_limit (S12) → raise-through-incident updated the rule in place (same id) + resolved `raised` → `bakin budget show` milestones + `bakin spend` pace basis → doctor `health.spend.policy-available` healthy, `spend.budget` under spend ownership; unit suites cover S8/S9/S13/S14 + the upgrade crash matrix. REMAINING: Mark's live test on 3737 (needs a server restart) — then the stack merges bottom-up.

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
