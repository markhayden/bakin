# TODO — Gate Approvals & Discord Validation (feat/gate-discord-validation)

Plan: tasks/gate-discord/plan.md · Spec: SPEC.md

## Phase A — Code hardening
- [x] T1 fix(workflows): resolve channel aliases in gate approval delivery (0c7859fa)
- [x] T2 feat(workflows): native channel approvals with default reject reason (95631fcd)
- [x] T3 feat(workflows): approval store GC for stale records (0b087eb5)
- [x] T4 feat(scripts): gate/Discord e2e validation harness + runbook (ca50a885)
- [x] T5 docs(knowledge): update gate approval semantics (3252ddc0) + generated-docs catch-up (83b5ac00)
- [x] Coverage review follow-up: stale-button guard + gap tests (d3093b97)
- [x] Checkpoint A: 5503 tests green, typecheck green, docs:validate green

## Phase B — Live validation (owner present)
- [x] T6 deploy branch + settings.json channelAliases.approvals — server restarted on branch;
      first boot GC pruned the 2 May approved records and cancelled the stuck orphan
- [x] T7 partial: US1 delivery ✓ (after channel:-prefix fixes), US2 button approve ✓ (8/9 harness
      run + later manual runs), US4 UI/REST approve ✓ (twice, incl. mirror), US6 publish ✓.
      US3 formal reject cycle NOT yet harness-run (informal reject exercised once).
- [ ] T8 US5 nested: partially exercised live (nested image run approved through gates);
      formal harness run outstanding
- [ ] T9 cleanup (runbook checklist) + validation report + PR/merge — PR prep in progress
- [ ] Checkpoint B: all SPEC ACs pass or filed with diagnosis

## Phase C — UX hardening shipped during validation (unplanned, owner-driven)
- [x] allowedDecisions (no Always-allow), pre-resolve fallback, stale-response guard
- [x] Companion context → threaded gate messaging (createThread/editMessage adapter caps)
- [x] Root card = pure header; thread = `Task Review Details` + buttons; receipt edits root
- [x] Human-readable output rendering (no JSON blobs), decision receipts, masked links
- [x] taskId deep-link race fix; sub-task badge id + hover highlight
- [x] Issues filed: #604 (ghost turns), #606 (approval reconcile after downtime)

## Follow-ups (out of branch)
- bakin-bits-official PR: remove on_approve keys + rewrite gate descriptions in ask-voice
- antfly agent-lessons query 400 (dispatch lesson retrieval)
- openclaw sessions cleanup --enforce (242MB orphaned artifacts)
