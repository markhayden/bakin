# TODO — Housekeeping & Upgrade Batch (2026-10)

Spec `.claude/specs/housekeeping-batch-2026-10.md` · Plan `.claude/specs/housekeeping-batch-2026-10-plan.md`. Tick a task only when its acceptance criteria and verify step both passed. PR rows close when squash-merged.

## Gate (every PR)
- [ ] slice commits gated (`typecheck && lint` + slice tests `--isolate`)
- [ ] per-PR gate (`check:cycles`, `lint:home-bypasses`, `test`, `build:host && ui:conformance --quick|--full`, `docs:check` where generated)
- [ ] Codex round 1 → fixes → Codex round 2 → fixes (≥2 rounds, all findings fixed in-batch)
- [ ] CI green → squash-merge → issue closed with evidence

## PR 1 — #945 `chore/945-approvals-upgrade-deletion`
- [x] 1.1 delete upgrade modules + boot call + `importApprovalRecord`
- [x] 1.2 boolean-only `doctor.escalation` + settings test + fixture fix
- [x] 1.3 retire compat defaults in `doctorRepairRequestSchema`; repoint validation scripts
- [x] docs (approvals.md, doctor-and-health-checks.md, CLAUDE.md, spec status lines, gate-discord runbook)
- [x] PR 1 merged, #945 closed

## PR 2 — #883 `fix/883-openclaw-tools-mode`
- [x] 2.1 adapter stops emitting `toolsMode`; warn once per agent; tests flipped
- [x] 2.2 `perTurnToolsMode` on the tool-access descriptor (Pi true / OpenClaw false / mock false); prompts untouched
- [x] 2.3 Imitation Crab closed-schema validation + test
- [x] 2.4 conformance `toolPolicyAcceptance` + teeth
- [x] docs (adapter-architecture, runtime-capabilities, messaging-plugin, validate.ts comment, #880 spec status)
- [x] PR 2 merged, #883 closed

## PR 3 — #896 `fix/896-repair-reservation`
- [x] 3.1 reservation primitive + unit tests
- [x] 3.2 `startDoctorRepair` reserves by fingerprint; attach test still green
- [x] 3.3 escalation reserves/transfers/holds; delegation handoff via `reservation`; interleaving tests (internal)
- [x] 3.4 `repair_in_flight` end to end: refusal + 409 + CLI `expect` transport + three renderers + tests (no browser delegate surface exists)
- [x] 3.5 `operator-review` kind + `failure` receipt (schema, coverage, resurfacing, auto-close, tests)
- [x] 3.6 partition: failed/unplannable/no-report safe repairs → operator
- [x] 3.7 single-winner stale-lock reclaim + cross-process test; Bun repro + issue text; docs
- [x] PR 3 merged (#1012 → bb7ab909b, 8 Codex rounds), #896 closed; repro handed to Mark in the batch report

## PR 4 — #966a `chore/966-react-lint`
- [x] 4.1 plugin + preset + `--max-warnings 0` (rules with findings off) + the 3 pre-existing hook warnings fixed
- [x] 4.2 context API modernization (51)
- [x] 4.3 ref as prop (5) + ListRow AND Card parity tests
- [x] 4.4 static components (9) + purity (6)
- [x] 4.5 leaked fetch (11)
- [x] 4.6 use-state (8) + innerHTML audit (2)
- [x] 4.7 singles + scoped `cloneElement` exception
- [x] 4.8 flip on; reasoned offs; style-guide, dependency-sweeps (TS row re-dated), CLAUDE.md
- [x] `ui:conformance --full` green
- [x] PR 4 merged

## PR 5 — #966b `refactor/966-set-state-in-effect`
- [x] 5.1 sdk/ui/host shells/chat/tasks/storybook (18)
- [x] 5.2 host runtime tabs, sidebar, header, notification toggle, PluginHost (14)
- [x] 5.3 health (8)
- [x] 5.4 spend (13)
- [x] 5.5 schedule (16)
- [x] 5.6 assets (16)
- [x] 5.7 explore (19)
- [x] 5.8 brands (5)
- [x] 5.9 team (31)
- [x] 5.10 workflows (24)
- [x] 5.11 rule on; lint clean; conformance full; screenshots ×3
- [x] PR 5 merged, #966 closed

## PR 6 — #948 `feat/948-zod-vendor`
- [x] 6.1 build contract in ONE commit: externals v2 + `/vendor/zod.js` + import map + four tests + embedded manifest + perf baseline + compiled-binary vendor test + Playwright smoke/screenshots
- [x] 6.2 SDK zod peer; published JS externalizes; tarball check; reference-plugin consumer green
- [x] 6.3 docs (plugin-system, author docs, binary-size, scaffold comment)
- [x] PR 6 merged
- [ ] Bits companion `chore/zod-4.6-externals` opened (CLIENT_EXTERNAL + contract v2 + ~4.6.5 + patch bumps + SDK pin + bundle assertion); #948 closed when merged

## PR 7 — #1007 A `feat/1007-updates-engine`
- [x] 7.1 SDK types (exported, public-api regenerated) + store + fingerprints + engine core + read barrier + tests
- [x] 7.2 scheduler + `settings.updates` + normalizer + System & Alerts + tests
- [x] 7.3 search setup contract: applicability, structural identity, per-model remediation, `signal`, child reaping + tests
- [x] 7.4 required sources + `runtime.compatibility()` + conformance pin + tests
- [x] 7.5 `bakin` + `plugin` sources (ETag/backoff/async git) + fake-transport tests
- [x] 7.6 read/check/skip routes + engine wiring + `updates.changed` + doctor-refresh mapping + route tests
- [x] 7.7 apply-preview/apply routes + operations inventory + apply service (covering-approval full scope + scopeHash, 409s, 403, engine-reinstall one-operation) + tests
- [x] 7.8a server.lock under install-state (bounded retry) + verification helpers (SDK hook exported, CLI twin) + tests
- [x] 7.8b self-update cutover in ONE commit: operation + `bakin update` routing/guards + header banner + old `/api/update/*` deleted + tests (contention, live-but-not-listening, paused-updater interleaving, arch)
- [x] 7.9 Updates tab + count + skip toggle + System row + explicit check → engine + Overview links + Health updates fixture/test:ui + screenshots + perf check (ask Mark if > ceiling)
- [x] 7.10 `bakin updates` CLI + registry + generated docs + tests
- [x] 7.11 docs: updates.md, CLAUDE.md Updates bullet + reversed upstream-fetch rule, release-pipeline, doctor refresh
- [ ] PR 7 merged

## PR 8 — #1007 B `feat/1007-updates-packages`
- [x] 8.1 `package` + `hub-skill` sources; `trackingSource` persisted; policy tests
- [ ] 8.2 manifest projection reads the engine; upgrade writers (artifact, github, local `lastSourceTreeSha`) stop writing markers
- [ ] 8.3 Team store joins engine records; Explore reads engine; list.ts/explore probes + checker imports removed; screenshots
- [ ] 8.4 sync/CLI `--check` on the shared observer; CLI stale rendering on `observedAt`
- [ ] 8.5 Health `plugin-artifacts` consumes observations; private probe + cache deleted; doc
- [ ] 8.6 deletions: `checker.ts`, `upgrade-check.ts` + re-export, lockfile markers, `computeUpgradeAvailable`, `staleHintDays`; perf check; docs incl. layered-context.md:96
- [ ] PR 8 merged

## PR 9 — #1007 C `chore/1007-updates-docs`
- [ ] 9.1 `quiet` removed everywhere + fallback test + generated settings docs
- [ ] 9.2 editorial reconciliation (CLAUDE.md doctor sensitivity, doctor-and-health-checks sensitivity, README, cross-links)
- [ ] PR 9 merged, #1007 closed

## Batch close
- [ ] #964 ledger row re-dated (landed in PR 4)
- [ ] memory updated; Mark's manual sweep requested
