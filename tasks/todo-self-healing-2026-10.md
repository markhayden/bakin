# TODO — Self-healing Health & Updates (2026-10)

Spec `.claude/specs/self-healing-health-and-updates-2026-10.md` (rev 7, approved) · Plan `.claude/specs/self-healing-health-and-updates-2026-10-plan.md` (rev 9). Tick a task only when its acceptance criteria and verify step both passed. PR rows close when squash-merged.

## Gate (every PR)
- [ ] slice commits gated (`typecheck && lint` + slice tests `--isolate`, each on its exit status)
- [ ] per-PR gate (`check:cycles`, `lint:home-bypasses`, `test` alone, `build:host && build:plugins && ui:conformance --quick|--full`, `docs:check`, `ui:public-api:check` (regen inside the commit that changes a public contract: 1.5, 1.7, 2.5, 3.1, 3.3, 5.1, 6.4, 7.6), `ui:performance` without regeneration)
- [ ] Codex ≥2 rounds (cap ~5, stop at approve), findings fixed in-batch
- [ ] Mark's live test on 3737 → squash-merge

## PR 1 — `feat/health-three-outcomes`
- [x] 1.1 repairMode + authorizeMutation + SHARED_ENGINE_ACTIONS + health copy table [unactivated]
- [x] 1.2 updater fetch-at-sha + reinstall + packageSyncOperation/agentSyncOperation
- [x] 1.3a search actions + repointed incidents (old contract; observation rows keep their incident; upgrade-shaped actions `manual`)
- [x] 1.3b packages/plugins actions + repointed incidents (plugin-upgrade rename)
- [x] 1.3c core/adapters/channels actions + repointed incidents
- [x] 1.3d tasks/spend/git actions + repointed incidents
- [x] 1.4a assets + brands recover pages
- [x] 1.4b workflows/spend/team/tasks controls + card buttons (three commits; "Disable plugin" for an upstream-blocked artifact landed in the Codex r1 fold: ledger flag + loader skip + `/api/plugins/{disable,enable}` + Explore switch + `bakin plugins disable|enable` + the row-98 card choice)
- [x] 1.4c HandoffCard (gh, Pi install/login, OpenClaw, gateway below-floor) + Explore capability= + readiness legs + aliases field + Discord invite + runtime credentials highlight (OpenClaw grant row keeps its steps — no verified command)
- [x] 1.5 incident catalogs (finite families + declarationId) + validation + core.diagnose + brief builder [unactivated] (public API regen — no change: the freeze covers the browser entrypoints, not sdk/types)
- [x] 1.6 raw retirement of pending legacy health approvals (intent receipt first, resumed until done) [unactivated — `src/core/approvals/legacy-retire.ts`, wired from startup recovery + bridge reconnect in 1.7]
- [x] 1.7 THE CUTOVER (contract, catalogs for 206 rows, consumers, old engine adapted, authorizeMutation on every Health apply, legacy retirement at boot; public API freeze unchanged — browser entrypoints only)
- [x] 1.8 scoped pins (`tests/architecture/health-three-outcomes.test.ts`: retired vocabulary, shared engine actions registered before plugins, every table check declares a catalog) + knowledge (contract sections + re-homing deviations landed with 1.7)
- [x] Codex r1 (17 findings) folded: correctness fold 42ceddc73 (localId handles, report-resolved targets, `mutation` required, decision choices, page-owned handoff return, bounded legacy retirement) + scope fold (workflows/roster recover editors, asset/brand detach + usage facts, plugin disable containment, spend/models/health card choices, runtime credential/grant/gateway handoffs)
- [x] Codex r2 (12 new + 5 partial) folded: request choices declare `effects` + confirm when destructive + owner-route binding; the gate refuses one-click items unattended and allows `none` self-heal; streaming receipt journal + batch-drained retirement; non-destructive plugin suspend + the activation boundary honours `disabled`; bulk package repairs through the report; calm Notices surface for advisory/watch choices; targeted handoff rerun; `agents.registryLocation` + roster handoff; runtime credentials return verification + fresh gateway probe + OpenClaw credential incident; brand no-manifest recovery + effective-brand usage; roster/workflow unavailable vs verified-empty; real skill frontmatter validation; unsaved-changes guard on the raw editor; Pi/Discord/plugin-artifacts dispositions from facts
- [x] Codex r3 (8 findings) folded: canonical-pathname ownership for request choices; roster/workflow verified-empty requires a current successful relevant inspection; roster handoffs arm a targeted recheck on copy; duplicate main gets the registry handoff (deletion still refused); guard `isSameLocation` option protects query-identified recovery drafts (real-guard tests); brand copy says "could not be determined" when usage is unknown; Discord guild usage never presumed (family `never`); provider sign-in handoff selected by family identity + targeted recheck on return
- [x] Codex r4 (4 findings) folded: the runtime credentials return listener lives on the always-mounted group (a successful sign-in still verifies); roster handoff arming is module-level and survives the Terminal round trip; a refused roster recheck is shown in every evidence branch; dead tag overrides say usage is unknown when the board could not be read
- [x] Codex r5 (final): every ledger item RESOLVED; the one P2 (browser fixtures did not render the recovery surfaces) closed — team + workflows `test:ui` fixtures now render the roster recovery panel and the skill/definition recovery editors (reports inspected)
- [x] `ui:conformance --full`: payload ceiling regenerated with Mark's approval (2026-10-24); the two Docker browser failures (`form-controls.browser.pw.ts:95` forced-colors focus, chromium + firefox, passes locally, untouched surface) accepted by Mark as not this PR's
- [x] Mark's live test on 3737 (steps 1–4; six fixes folded, see PR body) → Mark authorized the merge on green CI
- [x] PR 1 merged — #1026 squash-merged 2026-10-24 as a88603c4e; Bits companion `bakin-bits-official#124` (terminal 0.3.5 + template catalog + CI SDK pin) open; rc.43 after it publishes

## PR 2 — `fix/search-and-companion-resilience`
- [ ] 2.1 adapter re-init + in-process re-init
- [ ] 2.2 port wait + unit never unloaded
- [ ] 2.3 engineStartedAt + wedge clock + table progress
- [ ] 2.4 outbox drain on reachable
- [ ] 2.5 CUTOVER: PluginManifest.data.schemaVersion + backup through verification + quarantine/rollback/contain (public API regen)
- [ ] 2.6 tests + knowledge
- [ ] PR 2 merged

## PR 3 — `feat/maintenance-coordinator`
- [ ] 3.1 CUTOVER: OperationWaitingFor kind (public API regen)
- [ ] 3.2 coordinator [unactivated]
- [ ] 3.3 shell dirty registry + poll route + reconnect/edit preservation [unactivated]
- [ ] 3.4 pending-restart row (header, Updates tab, `bakin maintenance status|request --dry`) [unactivated]
- [ ] 3.5 CUTOVER: admission ON (self-update stage/swap split, restart-class actions, dispatch hold, chat admission, Terminal-without-hook)
- [ ] 3.6 the twelve maintenance tests + knowledge
- [ ] Bits companion `feat/terminal-maintenance-blockers` (Terminal 0.3.5) opened
- [ ] PR 3 merged

## PR 4 — `feat/cli-agent-mode`
- [ ] 4.1 TTY guards
- [ ] 4.2 CUTOVER: agent mode (sanctioned --yes via authorizeMutation, async restart-class submission, route refusals)
- [ ] 4.3 agent-mode matrix + knowledge
- [ ] PR 4 merged

## PR 5 — `feat/health-repair-engine`
- [ ] 5.1 subject store + state machine + outcome watch + targeted reruns [unactivated] (public API regen)
- [ ] 5.2 inspection accounting + fold/unfold [unactivated]
- [ ] 5.3 settling + attentionOf + card projection [unactivated]
- [ ] 5.4 announcers (occurrence counter, toast, notifications.jsonl, Discord + receipt import, history.jsonl, History tab + ?history=, CLI) + publicUrl seed [unactivated]
- [ ] 5.5 new health-repair owner prepared BESIDE the incumbent + ConfirmDialog + approval-panel [unactivated]
- [ ] 5.6 persisted signing key + handbackToken + health_repair/health_handback tools (token + principal [+ run on Pi]) + tasks_complete (by task) + tasks_create refusal on Pi; OpenClaw principals refused by the fallback tools [unactivated]
- [ ] 5.7 fallback lane module (Pi; OpenClaw → immediate hand-back) + hand-back outcomes + containment [unactivated]
- [ ] follow-up issue filed: dedicated `repair` runtime agent for OpenClaw
- [ ] 5.8 legacy supersede module (dependency transfer to health-subject + Release) [unactivated]
- [ ] 5.8a Health UI subject cards + investigation panel + review Banner + Recent changes scaffold [unactivated]
- [ ] 5.9 CUTOVER: engine ON, approvals re-owned everywhere, fallback lane live, supersede at boot, deletions, doctor.repair settings, subjects routes
- [ ] 5.10 integration tests + knowledge
- [ ] PR 5 merged · Bits Terminal 0.3.5 tagged

## PR 6 — `feat/updates-autoapply`
- [ ] 6.1 consent records (signing key from 5.6) + delta + gate AUTO path (active: records written from now on)
- [ ] 6.2 recorded-commit reader + delta/eligibility inputs [unactivated]
- [ ] 6.3 settings autoApply/trustedSources/publicUrl + Updates section
- [ ] 6.4 CUTOVER: record fields, manual deleted, apply cases, previews, Update all sans Bakin, surfaces, refusal table, #1024 (public API regen)
- [ ] 6.5 recovery checkpoints for packs/hub skills/models/engine
- [ ] 6.6 CUTOVER: shared ownership startSubjectMutation (Health ↔ Updates)
- [ ] 6.7 auto-apply pass
- [ ] 6.8 first-boot review card + bootstrap notification
- [ ] 6.9 tests + knowledge
- [ ] PR 6 merged

## PR 7 — `feat/self-update-convergence`
- [ ] 7.1 bakin preflight (missing span = ineligible)
- [ ] 7.2 bakin rollback
- [ ] 7.3 bakin restart-watch [unactivated]
- [ ] 7.4 protectedSwap [unactivated]
- [ ] 7.5 release.json + span pipeline test + pack-manifest guard
- [ ] 7.6 CUTOVER: install-self AND self-update stage/swap through protectedSwap, span-gated auto rollback
- [ ] 7.7 convergeInstall (closes settling)
- [ ] 7.8 bakin auto-apply via admission + header toggle + Update all with Bakin last + notification producer
- [ ] 7.9 first-upgrade procedure in release notes + runbook
- [ ] 7.10 fixtures (rc.42 real binary incl. automatic recovery, out-of-span, convergence, Update all) + knowledge
- [ ] PR 7 merged

## PR 8 — `docs/self-healing`
- [ ] 8.1 knowledge rewrite
- [ ] 8.2 CLAUDE.md / README / docs site + rendered check / generated references / Bits README
- [ ] 8.3 scoped final sweep
- [ ] PR 8 merged

## Release & acceptance
- [ ] release prep + dispatch (retry by re-dispatch)
- [ ] margo first upgrade (operator-run): one review card, buttons, then zero-touch on the next Bits release; §9.3 scenarios; journal drains
