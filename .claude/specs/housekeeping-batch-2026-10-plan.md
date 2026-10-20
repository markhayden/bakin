# Implementation Plan: Housekeeping & Upgrade Batch (2026-10)

Spec: `housekeeping-batch-2026-10.md` (rev 6, Codex-approved after six rounds). Plan rev 4 (2026-10-19): rev 1 was reviewed read-only by Codex; its 18 findings are folded in and marked **(P#)**; round 2 closed 13 and narrowed P6/P10/P12/P17/P18, completed as **(P#′)**; round 3 closed all but one revert edge and the pre-swap restart-preparation case, completed here as **(P6″, P19)**. Round 4: "ready to build" (2026-10-19). Nine PRs, one branch each, cut sequentially from merged `main` in the main checkout (3737 keeps serving `main` between PRs). Build status: PR 1 in progress (2026-10-19).

## Overview

Nine PRs in a fixed order. Each PR is a set of vertical slices, each slice one conventional commit that leaves the tree green AND functional at that revision (a contract change lands with every consumer that would otherwise 404, mis-render or mis-report — **(P1, P2, P3, P4)**). Codex reviews each PR at least twice (`codex exec --sandbox read-only -o out.md - < prompt.md`), findings are fixed in-batch, CI must be green, then the PR is squash-merged (D0.2/D0.3). No live gate per PR; UI PRs commit Playwright screenshots under `.claude/specs/housekeeping-batch-2026-10-review/` and link them `?raw=true` in the PR body.

| # | Branch | Issue | Commits |
|---|--------|-------|---------|
| 1 | `chore/945-approvals-upgrade-deletion` | #945 | 3 |
| 2 | `fix/883-openclaw-tools-mode` | #883 | 4 |
| 3 | `fix/896-repair-reservation` | #896 | 7 |
| 4 | `chore/966-react-lint` | #966a | 8 |
| 5 | `refactor/966-set-state-in-effect` | #966b | 11 |
| 6 | `feat/948-zod-vendor` (+ Bits `chore/zod-4.6-externals`) | #948 | 3 |
| 7 | `feat/1007-updates-engine` | #1007 A | 12 |
| 8 | `feat/1007-updates-packages` | #1007 B | 6 |
| 9 | `chore/1007-updates-docs` | #1007 C | 2 |

## Architecture Decisions (spec, restated for the implementer)

- **Deletions carry their dead code** — every removed module takes its only-callers with it (`importApprovalRecord`, `upgrade.ts:60` re-export, compat defaults in the repair-request schema). Nothing is left "in case".
- **The neutral contract never learns a provider** — `toolsMode` stays; OpenClaw declares `perTurnToolsMode: false` on `RuntimeToolAccess`; the search setup checks grow structured identity + `signal`; the runtime gains optional `compatibility()`; core never imports an adapter pin.
- **Admission before ownership** — incident reservation is a synchronous in-process check-and-set keyed by owner token taken BEFORE `startOperation`; identical fingerprints attach; escalation holds what it is judging until each disposition is written and hands delegated incidents over by token.
- **One update engine, pure sources** — sources observe and never write; the engine persists (`~/.bakin/updates.json`), broadcasts, reconciles against per-kind fingerprints behind a read barrier (every `GET /api/updates` awaits `engine.ready`, which resolves after boot reconciliation — the timer starts from startup recovery, which runs after `listen`) **(P7)**; the apply service is the only thing that starts work, and it resolves a covering approval by full scope before anything else.
- **Every merged PR AND every commit is self-sufficient** (D0.7, P1–P4) — a consumer moves with the contract it consumes.
- **Lint is a binary gate** — `--max-warnings 0` from the first lint commit, so the three pre-existing `exhaustive-deps` warnings are fixed in that same commit **(P5)**.
- **Revert sets, not single reverts (P6, P6′)** — each commit table lists the TRANSITIVE consumer closure that must be reverted together for the tree to stay functional, evaluated at the owning branch's tip; "alone" means the commit has no dependents. PRs 7 and 8 are declared as dependency chains rather than per-row guesses.

## Dependency Graph

```
PR1 #945 ──► PR2 #883 ──► PR3 #896 ──► PR4 #966a ──► PR5 #966b ──► PR6 #948 ──► PR7 #1007A ──► PR8 #1007B ──► PR9 #1007C
 (independent)  (independent)  (independent)   gates 5–9      needs 4         needs 4,5     needs 3 (reservation,   needs 7       needs 7,8
                                                               (rule off→on)   (lint clean    operator-review kind,
                                                                                 on UI edits)   D3.5 reclaim), 4,5, 6 (bundle baseline)
Bits companion ─ after PR6 merges (SDK commit pin)
```
PRs 1–3 are independent of each other but run in order so each cuts from a green `main`. PR7 depends on PR3 for `reserveIncidents`/`operator-review` AND for the single-winner stale-lock reclaim (D3.5) that the boot-vs-updater exclusion relies on, and on PR6 for the perf-ratchet baseline its new tab is measured against.

## Commit Strategy (batch rules)

One conventional commit per slice, scope = the plugin/module touched. Gate before EVERY commit: `bun run typecheck && bun run lint` + the slice's test files with `--isolate`; slices that change CLI registry/manifest text also run `bun run docs:generate` and commit the output; slices that add SDK exports regenerate `design-system/public-api.json` (`bun run ui:public-api:generate`) and commit it **(P11)**; slices that change browser bundle size run `bun run ui:performance` against the EXISTING baseline first **(P18, P18′)**: an ordinary fluctuation within the gate changes nothing; a verified reduction (PR 6) regenerates the baseline with the deltas in the commit body; a growth above the 2 KB ceiling is never silently regenerated — the slice records measured attribution and the alternatives tried (`.agents/skills/bakin-ui-conformance/references/conformance-contract.md:58`) and the ceiling increase is put to Mark as an explicit ask before that PR merges (spec Boundaries: ask first). Never commit `generated-version.ts`; restore `packages/sdk/styles.css` if the dev tailwind watcher rewrote it. Per-PR gate before opening the PR: `bun run check:cycles && bun run lint:home-bypasses && bun run test`, then `bun run build:host && bun run ui:conformance --quick` (`--full` for PRs 4–8), `bun run build` for PR 6 and PR 7, `bun run docs:check` where docs were generated, and for plugin UI surfaces that changed, that plugin's own `bun run test:ui` with the report inspected **(P13)**. Feature-specific tests live in the slice that introduces the feature, never in a trailing "tests" commit **(P6)**. Each commit message ends with the attribution line in effect.

---

## PR 1 — #945 approvals one-shot upgrade deletion (`chore/945-approvals-upgrade-deletion`)

| # | Commit | Revert set |
|---|--------|------------|
| 1.1 | `chore(approvals): delete the one-shot settings/records upgrades` | alone |
| 1.2 | `refactor(settings): doctor.escalation is a boolean, no legacy coercion` | alone |
| 1.3 | `chore(doctor): retire the pre-#942 repair-request defaults and legacy approvals paths` | alone |

### Task 1.1: Delete the upgrade modules and their boot call
- Acceptance: `settings-upgrade.ts`, `records-upgrade.ts`, their two tests, `server.ts:115-126`, and `importApprovalRecord` (`packages/core/src/approvals/store.ts:90`) are gone; `grep -rn "settings-upgrade\|records-upgrade\|importApprovalRecord" --include=*.ts .` is empty outside `plugins/spend`; docs for this slice updated (`approvals.md` § one-shot upgrades, tests list, `importApprovalRecord`, `.pre-approvals.bak`; CLAUDE.md:237; spec status lines).
- Verify: `bun run typecheck`; `bun test tests/core/approvals tests/core/restart-recovery.test.ts --isolate`.
- Files: `server.ts`, `src/core/approvals/{settings,records}-upgrade.ts` (del), `tests/core/approvals/{settings,records}-upgrade.test.ts` (del), `packages/core/src/approvals/store.ts`, docs. Size: S.

### Task 1.2: Boolean-only `doctor.escalation`
- Acceptance: `normalizeDoctorSettings` keeps only the boolean branch; JSDoc at `settings.ts:279-281` and the sentence at `:324` deleted; `tests/core/doctor-repair.test.ts:17` `'off'` → `false`; new settings test: a non-boolean `escalation` (string, null) falls back to the default; `doctor-and-health-checks.md:295` updated.
- Verify: `bun test tests/core/settings.test.ts tests/core/doctor-repair.test.ts --isolate` (`tests/core/settings.test.ts` exists; the case is added there).
- Files: `packages/core/src/settings.ts`, `tests/core/settings.test.ts`, `tests/core/doctor-repair.test.ts`, docs. Size: XS.

### Task 1.3: Retire compat defaults and legacy paths (D1.4, D1.6)
- Acceptance: `.default('delegate')` / `.default([])` removed from `doctorRepairRequestSchema` (`doctor-repair-store.ts:100-103`) with the "retire with #945" comment; store test: a file lacking `kind`/`checkIds` is logged and ignored; `scripts/validate-gates.ts:37` and `scripts/validate-map-select.ts:39` point at `~/.bakin/approvals/`; `docs/validation/gate-discord-runbook.md:70,97` updated.
- Verify: `bun test tests/core/doctor-repair-store.test.ts --isolate`; `bun run typecheck`.
- Files: `src/core/doctor-repair-store.ts`, `tests/core/doctor-repair-store.test.ts`, `scripts/validate-gates.ts`, `scripts/validate-map-select.ts`, docs. Size: S.

### Checkpoint PR 1
- [ ] Per-PR gate; Codex ×2; CI; squash-merge; close #945 with the margo precondition evidence.

---

## PR 2 — #883 OpenClaw `toolsMode` (`fix/883-openclaw-tools-mode`)

| # | Commit | Revert set |
|---|--------|------------|
| 2.1 | `fix(adapter-openclaw): stop sending toolsMode; warn once per agent that tool policy is unenforceable` | {2.1, 2.3, 2.4} — a restored adapter emits `toolsMode`, which 2.3's closed schema rejects **(P6′)** |
| 2.2 | `feat(runtime): perTurnToolsMode on RuntimeToolAccess` | {2.2, 2.4} |
| 2.3 | `fix(imitation-crab): agent RPC params validate against the 2026.9.5 closed schema` | {2.3, 2.4} — 2.4's mock-rejection leg |
| 2.4 | `test(conformance): toolsMode acceptance + enforcement honesty, with teeth` | alone |

### Task 2.1: Adapter stops emitting `toolsMode`
- Acceptance: `applyRuntimeMessageToolPolicy` and `OpenClawAgentTurnOptions.toolsMode` deleted; `warnUnenforceableToolPolicy` warns once per agent for `toolsMode` too; the three `runtime-stream.test.ts` assertions (`:162`, `:367`, `:384`) assert the key is ABSENT; new unit test pins the warning dedupe; `scripts/instance/validate.ts:57-60` comment updated; docs `adapter-architecture.md:330-334`, `messaging-plugin.md:15-19`, `openclaw-override-scope-880.md` status line.
- Verify: `bun test tests/adapter-openclaw --isolate`.
- Files: `packages/adapter-openclaw/src/runtime.ts`, `tests/adapter-openclaw/runtime-stream.test.ts`, `scripts/instance/validate.ts`, docs. Size: S.

### Task 2.2: `perTurnToolsMode` on `RuntimeToolAccess` **(P8)**
- Acceptance: `RuntimeToolAccess` (`packages/core/src/adapters/runtime/concepts.ts:412`) and the SDK mirror (`packages/sdk/src/types/runtime.ts`) gain `perTurnToolsMode: boolean` (required); implementations: Pi `true`, OpenClaw `false`, the shared testing mock's TWO descriptor copies (`packages/core/src/adapters/runtime/testing.ts:494` and `:536`) `false`, the conformance mock runtime `false`; `src/core/dispatch-prompts.ts:33` reads the descriptor but the renderer (`src/core/tool-access.ts`) does not emit the new field — the dispatch-prompt byte fixtures are re-run and unchanged; the capability/switch report shows it; `runtime-capabilities.md:282-283` updated.
- Verify: `bun test tests/core/dispatch-prompts*.test.ts tests/core/tool-access*.test.ts tests/core/runtime-switch*.test.ts tests/adapter-pi --isolate` (names confirmed at build time; any missing one is declared new in the commit).
- Files: `concepts.ts`, `packages/sdk/src/types/runtime.ts`, `testing.ts`, `packages/adapter-pi/src/runtime.ts` (descriptor), `packages/adapter-openclaw/src/runtime.ts`, the shared mock in `packages/core/src/adapters/runtime/testing.ts` (imported by `tests/integration/runtime-conformance/mock.conformance.test.ts:35`) **(P12′)**, docs. Size: M.

### Task 2.3: Imitation Crab closed-schema validation
- Acceptance: `dev/imitation-crab/gateway.ts` `agent` branch validates against the 9.5 property list (`dev/imitation-crab/agent-params-schema.ts`, new); unknown key ⇒ `INVALID_REQUEST` "unexpected property"; new `tests/dev/gateway-agent-params.test.ts` sends `toolsMode` and asserts the rejection; existing `tests/dev` green.
- Verify: `bun test tests/dev --isolate`.
- Size: S.

### Task 2.4: Conformance check + teeth
- Acceptance: `conformance.ts` gains `toolPolicyAcceptance` (turn with `toolsMode:'none'` accepted on every adapter; a runtime declaring `perTurnToolsMode:true` withholds tools — Pi leg asserts no tool call); wired into `runRuntimeConformanceSuite`; teeth case with a lying mock; header comment (`:8-11`) updated.
- Verify: `bun test tests/integration/runtime-conformance --isolate`.
- Files: `tests/integration/runtime-conformance/{conformance,teeth.conformance.test,mock.conformance.test,openclaw.conformance.test,pi.conformance.test}.ts`. Size: M.

### Checkpoint PR 2
- [ ] Per-PR gate; Codex ×2; CI; merge; close #883.

---

## PR 3 — #896 repair reservation, operator partition, lock reclaim (`fix/896-repair-reservation`)

| # | Commit | Revert set |
|---|--------|------------|
| 3.1 | `feat(doctor): atomic incident reservation keyed by owner token` | {3.1–3.4} — everything below calls it |
| 3.2 | `fix(doctor): every repair start reserves its incidents; identical requests attach` | {3.2, 3.3, 3.4} |
| 3.3 | `fix(doctor): escalation reserves what it judges, transfers the safe subset, hands delegated incidents over by token` | {3.3, 3.4} |
| 3.4 | `feat(doctor): manual delegation refuses repair_in_flight end to end (409, CLI transport + renderers, UI dialog)` | alone **(P3: refusal production + HTTP mapping + transport + renderers + tests in ONE commit)** |
| 3.5 | `feat(doctor): operator-review requests + failure receipts on repair proposals` | {3.5, 3.6} |
| 3.6 | `fix(doctor): failed or unplannable safe repairs go to the operator, never an agent` | alone |
| 3.7 | `fix(operations): stale-lock reclaim is single-winner` | alone |

### Task 3.1: Reservation primitive
- Acceptance: `src/core/doctor-reservations.ts` (new): `reserveIncidents(ids, owner)` → granted / attached / refused `{ overlapping, heldBy }`; `transfer(ids, from, to)` atomic; `release(owner, ids?)`; `heldIncidentIds()`. New `tests/core/doctor-reservations.test.ts`: free, same-owner attach, cross-owner refusal, partial overlap, transfer, release-all.
- Verify: `bun test tests/core/doctor-reservations.test.ts --isolate`. Size: S.

### Task 3.2: `startDoctorRepair` reserves by fingerprint
- Acceptance: reservation with owner = repair fingerprint BEFORE `startOperation`; released on settle/failure/cancel/validate-rejection; `tests/core/doctor-repair.test.ts:205` (attach) still green; new test: a different plan over an overlapping incident is refused (internal result; no HTTP mapping yet — the Health apply route maps it to 409 `repair_in_flight` in THIS commit so the UI never sees a 200 for a refusal).
- Verify: `bun test tests/core/doctor-repair.test.ts tests/plugins/health --isolate`.
- Files: `src/core/doctor-repair.ts`, `plugins/health/index.ts` (apply route mapping), tests. Size: S.

### Task 3.3: Escalation reserves, transfers, hands over (internal only)
- Acceptance: `doctor-escalation.ts:240` filters held incidents, reserves `remaining` as `escalation:<cycleId>`, transfers the safe subset to the auto-apply fingerprint, calls `delegateDoctorRepair({ …, reservation })` for the delegated subset (delegate path transfers, keeps through request + task persistence, releases after the request file is written), releases each other subset when its disposition is written, releases all on throw. Interleaving tests: UI apply during planning ⇒ refused at `startDoctorRepair`; escalation during a validating UI repair ⇒ no second repair, no delegation; mixed safe/manual/delegated cycle CREATES its delegated task; identical concurrent applies attach. No externally visible result shape changes in this commit.
- Verify: `bun test tests/core/doctor-escalation*.test.ts tests/core/doctor-delegate*.test.ts --isolate`.
- Files: `src/core/doctor-escalation.ts`, `src/core/doctor-delegate.ts`, tests. Size: M.

### Task 3.4: `repair_in_flight` end to end **(P3, R10′)**
- Acceptance (one commit): `delegateOnce` without a reservation reserves fresh and returns `{ status:'repair_in_flight', overlapping, heldBy }` when refused; `POST /api/plugins/health/doctor/delegate` answers 409 with the union; `src/cli/http.ts` gains an `expect: { 409: schema }` variant (other statuses unchanged); the delegate command uses it; plain/TTY/JSON renderers handle a result with no `request`/task and exit 1; the Health delegate dialog shows the refusal inside the dialog. Tests: route 409; command-level with a mocked 409 for all three renderers incl. exit code (`tests/cli/doctor.test.ts`, `tests/cli/doctor-ui.test.tsx`, `tests/cli/doctor-repair-ui.test.tsx`); UI dialog test (`tests/plugins/health`).
- Verify: `bun test tests/core/doctor-delegate*.test.ts tests/plugins/health tests/cli/doctor*.test.ts tests/cli/doctor*.test.tsx tests/cli/api-error.test.ts --isolate`.
- Files: `src/core/doctor-delegate.ts`, `plugins/health/index.ts`, `src/cli/http.ts`, `src/cli/commands/doctor.ts`, `src/core/cli/ui/doctor-repair.tsx`, `plugins/health/components/repair-dialog.tsx`, tests. Size: M (one contract, all consumers).

### Task 3.5: `operator-review` request kind + `failure` receipt
- Acceptance: `doctorRepairRequestSchema.kind` gains `'operator-review'` and `failure?: { operationId, stage, error, at }`; `RepairProposal.failure?` (type + stripping schema + approval card rendering); `judgeCoverage` covers open operator-review requests; resurfacing escalates the same task with operator-review copy and never attaches a navigate approval; auto-close treats it like other kinds. Tests for coverage, resurfacing, auto-close, schema round-trip.
- Verify: `bun test tests/core/doctor-repair-store.test.ts tests/core/doctor-autoclose.test.ts tests/core/doctor-escalation*.test.ts tests/core/approvals --isolate`.
- Files: `src/core/doctor-repair-store.ts`, `packages/core/src/approvals/{types,schema}.ts`, `src/core/doctor-approvals.ts`, `src/core/doctor-escalation.ts`, `src/core/doctor-autoclose.ts`, tests. Size: M.

### Task 3.6: Partition change
- Acceptance: failed safe auto-repair ⇒ review task + `health-repair` approval carrying `failure`; planner throws / no item / no apply report (`:269` no longer throws) ⇒ `operator-review` request + task; delegation only for incidents without a repair action; tests per path; docs `doctor-and-health-checks.md` + `approvals.md` (reservation, partition, `repair_in_flight`, `failure`).
- Verify: `bun test tests/core/doctor-escalation*.test.ts --isolate`. Size: S.

### Task 3.7: Reclaim race + Bun repro
- Acceptance: `resources.ts:222-232` reclaims under an O_EXCL `<lock>.reclaim` marker (grace + sweep), re-reads, unlinks only the judged holder; cross-process test (two children race a dead-pid lock; exactly one wins) in `tests/core/operations/resources.test.ts`; `tasks/bun-write-abort-repro/{repro.ts,ISSUE.md}`; `operations.md` (reclaim), `media-pipeline.md` (part 1 citation + `TODO(#896): link once filed` at `:189`, mirrored at `download.ts:55`).
- Verify: `bun test tests/core/operations/resources.test.ts --isolate`. Size: S.

### Checkpoint PR 3
- [ ] Per-PR gate; Codex ×2; CI; merge; close #896 citing #895 for part 1; hand the repro to Mark.

---

## PR 4 — #966a React lint (`chore/966-react-lint`)

| # | Commit | Revert set |
|---|--------|------------|
| 4.1 | `chore(lint): @eslint-react recommended-typescript, zero-warning gate; fix the three exhaustive-deps warnings` | {4.1–4.8} — the gate and the plugin |
| 4.2 | `fix(ui): React 19 context API — use() and <Ctx> providers` | {4.2, 4.8} — 4.8 turns the rules on |
| 4.3 | `fix(ui): ref as a prop on ListRow, CalendarItem and callers; ListRow + Card parity tests` | {4.3, 4.8} |
| 4.4 | `fix(host): static sidebar nav components; pure render in calendar/spend/task cards` | {4.4, 4.8} |
| 4.5 | `fix(ui): abort leaked fetches on unmount` | {4.5, 4.8} |
| 4.6 | `fix(ui): useState conventions; dangerouslySetInnerHTML audited` | {4.6, 4.8} |
| 4.7 | `fix(lint): remaining singles; scoped cloneElement exception` | {4.7, 4.8} |
| 4.8 | `chore(lint): flip the fixed rules on; document the two reasoned offs` | alone |

Shape: 4.1 installs the plugin + preset with every rule that has findings set to `off` ("flipped on by 4.8" comments) and the gate at `--max-warnings 0`, which is honest only because 4.1 also fixes the three pre-existing `exhaustive-deps` warnings **(P5)**. 4.8 turns the fixed rules on.

### Task 4.1: Config + gate + the three hook warnings
- Acceptance: `@eslint-react/eslint-plugin ^5.28.2` devDep; `eslint.config.mjs` applies `recommended-typescript` to `**/*.tsx` + `disable-conflict-eslint-plugin-react-hooks`; rules with findings `off` (commented); `lint` script `--max-warnings 0`; `task-assets.tsx:46`, `brand-doc-brainstorm.tsx:75`, `workflow-canvas-editor.tsx:404` fixed properly; `bun run lint` exits 0.
- Verify: `bun run lint`; `bun test tests/eslint tests/plugins/assets tests/plugins/brands tests/plugins/workflows --isolate`.
- Files: `package.json`, `bun.lock`, `eslint.config.mjs`, the three components. Size: S.

### Task 4.2: Context API modernization (51 findings, 20 files)
- Acceptance: every `useContext(X)` → `use(X)`, every `<X.Provider>` → `<X>` in `packages/ui/src/{forms/fieldset,forms/form,patterns/agent-filter,patterns/inspector-panel,patterns/list-rows,patterns/page-controls,patterns/page-timeline,patterns/workspace-page,patterns/page,primitives/combobox,primitives/input-group,primitives/modal-context,primitives/portal-ownership,primitives/tabs,states/toast}.tsx`, `packages/sdk/src/{internal/plugin-ownership,testing/ui/plugin-ui-fixture-host}.tsx`, `packages/host/src/providers/Providers.tsx`, `src/context/{activity,sidebar}-context.tsx`, and the four tests; files clean under the (still off) rules.
- Verify: `bunx eslint --rule '@eslint-react/no-use-context: error' --rule '@eslint-react/no-context-provider: error' <files>`; `bun test tests/ui tests/components/{activity-feed,layout-shell-render,header-update-banner}.test.tsx tests/plugins/explore --isolate`; `bun run ui:test:stories -- --grep "ListRows|Tabs|Toast|InspectorPanel|PageControls|WorkspacePage"` **(P13)**.
- Size: L by count, mechanical; one commit.

### Task 4.3: `forwardRef` → ref prop + parity tests **(P15)**
- Acceptance: `packages/ui/src/patterns/{calendar-item,list-rows}.tsx`, `plugins/health/components/system-inventory.tsx`, `plugins/schedule/components/recurring-day-summary.tsx` take `ref` as a prop; NEW `tests/ui/patterns/list-rows-interactive.test.tsx` and `tests/ui/patterns/card-interactive.test.tsx` cover ref forwarding, routed overlay activation, nested controls and focus for ListRow AND Card (contract: `storybook/public/lists/list-rows.stories.tsx` InteractiveRows and the Card stories).
- Verify: `bun test tests/ui/patterns --isolate`; `bun run ui:test:stories -- --grep "ListRows|Card"`.
- Size: M.

### Task 4.4: static components + purity (15 findings)
- Acceptance: `sidebar-nav-item.tsx` defines no components inside render (9); the six `purity` hits (`calendar-grid`, three schedule calendars, `utilization-tiles`, `task-card`) move impure calls out of render.
- Verify: `bun test tests/components/{nav-placement,nav-badge,layout-shell-render,sidebar-promo}.test.* tests/plugins/schedule tests/plugins/spend tests/plugins/tasks --isolate` **(P12)**.
- Size: M.

### Task 4.5: leaked fetch (11 findings) **(P16 split)**
- Acceptance: `header.tsx` ×2, `AssetEditDrawer`, `AssetPreview`, `chat-badge-provider`, `agent-detail` ×5, `workflow-agent-identity` abort on unmount; each site's test asserts no state update after unmount.
- Verify: `bun test tests/components/header-update-banner.test.tsx tests/plugins/{assets,chat,team,workflows} --isolate`. Size: M.

### Task 4.6: useState conventions (8) + innerHTML audit (2)
- Acceptance: the 8 `use-state` sites follow `[x, setX]`; the two `dangerouslySetInnerHTML` sites in `workflow-canvas{,-editor}.tsx` are inspected — restructured if the content is not already sanitized, else a scoped reasoned exception with the sanitizer named.
- Verify: `bun test tests/plugins/workflows tests/plugins/health tests/plugins/memory tests/plugins/chat tests/ui/charts* tests/components/activity-feed.test.tsx --isolate`. Size: S.

### Task 4.7: singles + scoped exception
- Acceptance: `no-set-state-in-component-did-update` ×2, `naming-convention-context-name` ×2, `naming-convention-id-name` ×1, `no-unnecessary-use-prefix` ×1 fixed; `no-clone-element` in `interactive-surface.tsx:23` gets a scoped reasoned exception (public overlay API unchanged).
- Verify: touched test files `--isolate`. Size: S.

### Task 4.8: Flip on + docs
- Acceptance: all fixed rules on at preset severity; `no-array-index-key` and `naming-convention-ref-name` off with reasons; `set-state-in-effect` off with "flipped on by #966b"; `bun run lint` exit 0; `style-guide.md` React lint section; `dependency-sweeps.md § 3` (eslint-plugin-react row resolved; TypeScript row re-dated with the 2026-10-19 evidence); CLAUDE.md one-liner.
- Verify: `bun run lint`; per-PR gate incl. `bun run ui:conformance --full`. Size: XS.

### Checkpoint PR 4
- [ ] Per-PR gate incl. `ui:conformance --full`; Codex ×2; CI; merge.

---

## PR 5 — #966b `set-state-in-effect` (`refactor/966-set-state-in-effect`)

Eleven commits by plugin/area **(P16)**, smallest-risk first; the rule stays off until 5.11, so revert set for 5.1–5.10 is {self, 5.11}:

| # | Commit | Findings |
|---|--------|----------|
| 5.1 | `refactor(ui): derive state during render in sdk/ui/host shells` | packages/sdk 5, packages/ui 2, src 3, storybook 4, chat 1, tasks 3 (18) |
| 5.2 | `refactor(host): runtime overview/runtimes tabs, sidebar, header, notification toggle, PluginHost` | 14 |
| 5.3 | `refactor(health): activity tab, failure groups, repair dialog, search section` | 8 |
| 5.4 | `refactor(spend): limit dialog + budget controls` | 13 |
| 5.5 | `refactor(schedule): job form, run history, schedule input` | 16 |
| 5.6 | `refactor(assets): task assets, versioned grid/detail/drawer/preview, badge provider` | 16 |
| 5.7 | `refactor(explore): hub skills section, install dialog, explore page` | 19 |
| 5.8 | `refactor(brands): brand detail, task brand panel` | 5 |
| 5.9 | `refactor(team): agent detail/form, diagnostics, markdown edit, package card, dialogs` | 31 |
| 5.10 | `refactor(workflows): canvas editor, canvas, drawers` | 24 |
| 5.11 | `chore(lint): set-state-in-effect on` | — |

Each task: Acceptance = zero `set-state-in-effect` findings in the area (`bunx eslint --rule '@eslint-react/set-state-in-effect: error' <paths>`), behaviour parity by the area's RTL tests + `bun run ui:test:stories -- --grep "<area stories>"` + that plugin's `bun run test:ui` where it exists **(P13)**, and a new test wherever the changed effect had no coverage. Allowed shapes only: derived-during-render, `key` reset, event handler, `useSyncExternalStore`, `useMemo` projection. Verify per commit: the area's tests `--isolate`; at PR gate `bun run ui:conformance --full` + screenshots of the three most-changed pages (workflow editor, team agent detail, explore hub skills).

### Checkpoint PR 5
- [ ] `bun run lint` clean with the rule on; conformance full; Codex ×2; CI; merge; close #966.

---

## PR 6 — #948 zod vendor (`feat/948-zod-vendor`)

| # | Commit | Revert set |
|---|--------|------------|
| 6.1 | `feat(build): zod is host-provided in the browser — shared externals v2, /vendor/zod.js, import map, baselines` | alone **(P4: externals + vendor + import map + tests + embedded manifest + perf baseline in ONE commit)** |
| 6.2 | `feat(sdk): zod is a tilde-pinned peer; published JS externalizes it` | alone |
| 6.3 | `docs(plugins): zod joins react + SDK as host-provided; externals list for authors` | alone |

### Task 6.1: Build contract (one commit)
- Acceptance: `externals.ts` has `ZOD_EXTERNALS`, v2 contract; `build-vendors.ts` builds `zod.js` and uses the shared constants; `index.html` import map has `"zod": "/vendor/zod.js"`; `tests/ui/architecture/sdk-focused-entrypoints.test.ts:92`, `tests/core/whiskit/provenance.test.ts:111`, `tests/scripts/check-plugin-contract.test.ts`, `tests/scripts/sdk-vendor-bundles.test.ts` updated; `design-system/performance.json` regenerated (deltas in the commit body — every zod-carrying bundle smaller); `_embedded-assets-static.ts` regenerated; `grep -l "_zod.def" packages/host/public/vendor/*.js` = `zod.js` only and none in `plugins/*/dist/client.js`; NEW `tests/integration/host/compiled-vendor-assets.test.ts` (pattern: `tests/integration/media/compiled-sharp-store.test.ts`) compiles the binary, runs it against an isolated home WITHOUT the source asset tree, fetches `/vendor/zod.js` and `index.html`, and asserts the import map resolves **(P14)**; Playwright smoke: health + workflows pages load (screenshots committed).
- Verify: `bun run build:vendors && bun run build:plugins && bun run build:host-shell && bun run build:assets-manifest`; the four tests + `tests/api/host-static.test.ts` + the new integration test `--isolate`; `bun run ui:performance`; `bun run build`.
- Files: `src/core/whiskit/externals.ts`, `scripts/build-vendors.ts`, `packages/host/public/index.html`, `packages/host/src/api/_embedded-assets-static.ts`, `design-system/performance.json`, five tests. Size: L but a single contract; splitting it would leave a non-functional revision.

### Task 6.2: SDK peer
- Acceptance: `packages/sdk/package.json` `peerDependencies.zod = "~4.6.5"`; `scripts/build-sdk-package.ts` `EXTERNAL_JS_PEERS` includes zod and `buildDependencies` no longer injects it; `bun scripts/build-sdk-package.ts --version 0.0.0-test --out <scratch>` (flags confirmed against the script at build time) produces a package DIRECTORY (`build-sdk-package.ts:561`); `cd <scratch> && bun pm pack` then produces the tarball whose `package.json` lists zod under peers only **(P12, P12′)**; `tests/ui/architecture/sdk-focused-entrypoints.test.ts:99-104` extended; `examples/reference-plugin` typecheck + tests green (external consumer).
- Verify: `bun test tests/scripts/build-sdk-package*.test.ts tests/ui/architecture/sdk-focused-entrypoints.test.ts --isolate`; `cd examples/reference-plugin && bun run typecheck && bun test`.
- Size: S.

### Task 6.3: Docs
`plugin-system.md` (§ shared runtime identity, § client entries, § vendor bundles), `docs/.../extending/plugins/{overview,distribute}.md` externals list, `binary-size.md` if it lists vendor chunks, `plugin-scaffold.ts` comment.

### Bits companion (`bakin-bits-official`, branch `chore/zod-4.6-externals`, after PR 6 merges)
- `scripts/build-plugins.ts` `CLIENT_EXTERNAL` += `'zod'`, contract string `-v2`; root + every plugin `zod` → `~4.6.5`; patch bumps on touched manifests; bakin SDK pin → merged #948 sha; build assertion: no `_zod.def` in any `plugins/*/dist/client.js`.
- Verify: Bits `bun run build && bun run test`; CI (may stay red on the SDK-publish step until the next release — recorded in the PR).

### Checkpoint PR 6
- [ ] Per-PR gate incl. `bun run build` + `ui:conformance --full`; Codex ×2; CI; merge; Bits PR opened; close #948 once Bits merges.

---

## PR 7 — #1007 A: engine, required rows, Bakin, plugins, tab, CLI, banner (`feat/1007-updates-engine`)

| # | Commit | Revert set |
|---|--------|------------|
| 7.1 | `feat(updates): record types (SDK export), store, fingerprints, engine with two clocks, skip identity, read barrier` | chain |
| 7.2 | `feat(updates): scheduler with per-subject due times, backoff, coalescing; settings.updates + normalizer` | chain |
| 7.3 | `feat(search): setup checks carry applicability, structural identity, per-model remediation and a signal` | {7.3, 7.4} + 7.6's source registration of 7.4 |
| 7.4 | `feat(updates): required sources — search engine, search models, gateway (runtime.compatibility)` | {7.4} + its registration lines in 7.6 |
| 7.5 | `feat(updates): bakin + plugin sources with conditional requests and async git probes` | {7.5} + its registration lines in 7.6, 7.8b (bakin record), 7.9 (System row), 7.10 (`apply bakin:bakin`) **(P6″)** |
| 7.6 | `feat(updates): read/check/skip routes, engine wiring, updates.changed → doctor refresh` | chain |
| 7.7 | `feat(updates): apply-preview/apply routes + apply service with covering-approval scope; engine reinstall as one operation; operations inventory` | chain **(P4′: preview/apply registration + inventory entries live here, not in 7.6)** |
| 7.8a | `feat(server): server.lock publishes under install-state; self-update verification helpers (SDK hook + CLI twin)` | {7.8a, 7.8b, 7.10} |
| 7.8b | `feat(updates): self-update is an operation — bakin update routes through it, header banner follows it, old /api/update routes deleted` | {7.8b, 7.10} — 7.10's `apply bakin:bakin` needs the operation |
| 7.9 | `feat(health): Updates tab with count, skip toggle, confirm dialog; System row + explicit check read the engine` | alone |
| 7.10 | `feat(cli): bakin updates [--check\|skip\|apply]` | alone |
| 7.11 | `docs(updates): knowledge doc, CLAUDE.md Updates bullet + reversed upstream-fetch rule, release pipeline` | alone **(P17)** |

"chain" = PR 7's engine commits are a linear dependency chain: reverting 7.N at the branch tip requires reverting every later commit that imports from it (7.1 → all; 7.2 → 7.4–7.11; 7.6 → 7.7–7.11; 7.7 → 7.8b, 7.9, 7.10) **(P6′)**.

### Task 7.1: Types + store + engine core + read barrier
- Acceptance: `packages/sdk/src/types/updates.ts` (zod + TS per D7.2) exported from `packages/sdk/src/types/index.ts:25` barrel **(P11)**, `design-system/public-api.json` regenerated; `src/core/updates/{types,store,inventory,engine}.ts`; store = `~/.bakin/updates.json` via `atomicWriteJson`, schema-validated, invalid ⇒ logged + discarded; engine merges observations, two clocks, drops stale-fingerprint observations, skip identity cleared on identity change; `engine.ready` resolves after boot reconciliation (stale ⇒ `unknown`, due now) and every read awaits it **(P7)**. NEW tests: `tests/core/updates/{engine,store,inventory}.test.ts` incl. a request-during-startup case (read blocks until reconciliation, never serves a stale record).
- Verify: `bun test tests/core/updates --isolate`; `bun run ui:public-api:check`; `cd examples/reference-plugin && bun run typecheck` (external consumer sees the new types).
- Size: M.

### Task 7.2: Scheduler + settings
- Acceptance: `src/core/updates/timer.ts` started from startup recovery; per-subject due/backoff; global bound 2; per-subject 20 s with `signal`; completed observations survive a sibling timeout; `POST /check` coalescing contract (consumed in 7.6); `settings.updates` + `normalizeUpdatesSettings` (strict boolean, interval clamped [15 min, 7 d]) registered at `settings.ts:642`; System & Alerts fields; disable mid-pass semantics; NEW `tests/core/updates/timer.test.ts` incl. a hung subject releasing its slot; `tests/core/settings.test.ts` cases for file read + write + invalid values.
- Verify: `bun test tests/core/updates/timer.test.ts tests/core/settings.test.ts --isolate`.
- Files: `src/core/updates/timer.ts`, `packages/core/src/settings.ts`, `src/core/server/startup-recovery.ts`, `src/components/system-settings.ts`, generated settings docs. Size: M.

### Task 7.3: Search contract (D7.9)
- Acceptance: `SearchAdapterSetupCheckResult` gains `applicable`, `installed? { version, identity }` (engine = version+path+size+mtime; models = structural fingerprint of presence/size/mtime + manifest + variant marker + cached load verdict, never content hashes; `'absent'`), `required?`; models check returns per-model `{ id, required, installed?, state, remediation }`; both checks accept `{ signal }`; the antfly version probe runs under the signal with a deadline and reaps its child (hung-executable test: child gone, slot released); onboarding + offline doctor consumers behave as before.
- Verify: `bun test tests/adapter-antfly tests/core/onboarding --isolate`.
- Files: `packages/core/src/adapters/search/index.ts`, `packages/adapter-antfly/src/{installer,models,model-load,setup}.ts`, tests. Size: M.

### Task 7.4: Required sources + `runtime.compatibility()`
- Acceptance: `src/core/updates/sources/{search-engine,search-models,gateway}.ts`; optional `compatibility()` on the runtime contract (concepts.ts + SDK mirror + `testing.ts` mocks; OpenClaw answers from cached handshake evidence; Pi omits); conformance pins presence per adapter; NEW `tests/core/updates/sources/required.test.ts` (pin-mismatch, unloadable model with each remediation, below-floor, not-applicable ⇒ no row, partial model set, custom variant, offline replacement then boot).
- Verify: `bun test tests/core/updates/sources tests/integration/runtime-conformance --isolate`.
- Files: sources, `concepts.ts`, `packages/sdk/src/types/runtime.ts`, `testing.ts`, `packages/adapter-openclaw/src/{gateway-rpc,runtime}.ts`, conformance files. Size: M.

### Task 7.5: `bakin` + `plugin` sources
- Acceptance: `bakin` source (GitHub REST, per-endpoint ETag, 304 / 403 / 429 backoff with `Retry-After`/`X-RateLimit-Reset`, release-list fallback); `plugin` source implements the artifact-index, `git ls-remote` (`gitArgs` + `Bun.spawn` + signal) and local source-tree probes as async observers — `upgrade-check.ts` is NOT yet deleted (its consumers move in PR 8); `src/core/updates/net.ts` conditional-fetch helper over `packages/core/src/net`; NEW `tests/core/updates/sources/available.test.ts` with fake transports (two repositories, 304 after restart, rate limit, moved ref, fallback).
- Verify: `bun test tests/core/updates/sources --isolate`. Size: M.

### Task 7.6: Routes + wiring
- Acceptance: `GET /api/updates`, `POST /api/updates/check[?source=|?id=]`, `POST /api/updates/:id/skip` only (no apply surface yet — **P4′**: nothing unimplemented is exposed); registered in `packages/host/src/core-routes/index.ts` + `src/core/server/request-handler.ts`; `HOST_STATIC_ROUTE_PATHS` untouched (API routes only); `updates.changed` broadcast + `doctor-refresh.ts:55` mapping; NEW `tests/api/updates-routes.test.ts`.
- Verify: `bun test tests/api/updates-routes.test.ts tests/core/doctor-refresh*.test.ts --isolate`.
- Size: M.

### Task 7.7: Apply routes + service
- Acceptance: `GET /api/updates/:id/apply-preview` + `POST /api/updates/:id/apply` registered here with their operation-starting entries in `tests/architecture/operations-routes.test.ts` (resources declared); `src/core/updates/apply.ts` — preview returns the covering `health-repair` approval's FULL scope + `scopeHash` (multiple ⇒ 409 `multiple_covering_approvals`), confirm refuses `scope_changed` (409) / agents (403 via provenance) and resolves through the one approval path, else the subject's existing flow (plugin preview→consent→commit, hub-skill re-install token, engine/models install operations); engine reinstall = ONE operation holding `search-engine` through install + repair reindex (reset shape, `search-operations.ts:116`); NEW `tests/core/updates/apply.test.ts` (wider approval, multiple, scope changed, 403, `plan-changed`, concurrent Apply from Health and Updates, reinstall holds the lease throughout).
- Verify: `bun test tests/core/updates/apply.test.ts tests/api/updates-routes.test.ts tests/architecture/operations-routes.test.ts --isolate`. Size: M.

### Task 7.8a: Startup exclusion + verification helpers **(P16 split)**
- Acceptance: `server.ts` publishes `server.lock` under a bounded retry around `holdNow(['install-state'])` (≤60 s, then exit "an install is in progress"); NEW `packages/sdk/src/hooks/use-self-update-verification.ts` exported from `packages/sdk/src/hooks/index.ts` **(P11)** and a CLI twin `src/cli/self-update-verify.ts`, both polling `GET /api/version` for new `bootId` + expected version + `serving` (90 s) from a restart handoff; tests: verified / wrong version / unreachable / uninterrupted connection / draining successor (`tests/components/self-update-verification.test.tsx`, `tests/cli/self-update-verify.test.ts`, new) and a boot test that startup blocks then exits while another live pid holds `install-state` (`tests/core/server-lock-install-state.test.ts`, new); public-api regenerated.
- Verify: those tests `--isolate`; `bun run ui:public-api:check`. Size: M.

### Task 7.8b: Self-update cutover (one commit) **(P2, P9)**
- Acceptance: `src/core/updates/self-update-operation.ts` (install-state owned, staging `<exec>.<opId>.new`; stages `download` → `verify` → `prepare-restart` → `swap` (point of no return) → `restarting`): restart preparation (`src/core/server-restart.ts`) is split into a validating `prepareServerRestart()` that proves the restart path (launcher/service identity, permissions, successor command) WITHOUT arming termination (`server-restart.ts:90` arms immediately today) and an `activateServerRestart(prepared)` called only after the swap; a preparation failure fails the operation BEFORE the swap with the binary unchanged, no restart handoff and no client verification (regression test) **(P19)**; `bakin:bakin` apply starts it; `src/core/cli.ts` `cmdUpdate` (`:184-204`, plain AND TTY paths) routes HTTP through the apply service when `server.lock` names a live server (follow + verify), waits ≤30 s / errors when live-but-not-listening, otherwise runs the operation in-process via `operation-mode.ts` under `install-state` with the post-acquisition liveness re-check; `POST /api/update/apply` + `GET /api/update/status` handlers, router lines (`request-handler.ts:142-149`) and `tests/api/bakin-update-routes.test.ts` deleted; the header banner (`header.tsx:168-281`) reads the engine's `bakin` record, dismiss = skip, starts the operation and runs the SDK verification hook; `tests/components/header-update-banner.test.tsx` rewritten against the new endpoints; NEW `tests/cli/update-command.test.ts` (both output paths vs live server / live-but-not-listening / no server; CLI-vs-server contention never both swap; paused-updater-vs-startup interleaving); architecture test: `selfUpdate(` callers = operation + in-process operation-mode path only.
- Verify: `bun test tests/core/self-update*.test.ts tests/cli/update-command.test.ts tests/components/header-update-banner.test.tsx tests/architecture --isolate`; `bun run build` (compile externals unchanged but the binary swap path is exercised by the integration test).
- Files: `src/core/self-update.ts`, `src/core/updates/self-update-operation.ts`, `src/core/cli.ts`, `src/cli/operation-mode.ts`, `packages/host/src/api/update/{status,apply}.ts` (del), `src/core/server/request-handler.ts`, `packages/host/src/core-routes/index.ts`, `packages/host/src/components/layout/header.tsx`, tests. Size: L but one contract (endpoint + both clients); splitting it leaves 404s in production.

### Task 7.9: Updates tab + System row + perf baseline
- Acceptance: `HEALTH_TABS` gains `updates` (count badge of available non-skipped rows); `updates-tab.tsx` composes `ListRowGroup`×2 / `ListRow` / `StatusBadge` / `ListRowActions` / `OperationProgress` / `ConfirmDialog` (full scope + impact inside the dialog) / `SystemState`; "show skipped" via `useQueryState`; System row "Update available" reads the engine AND the tab's explicit "Check for updates" (`use-system-data.ts:121-133`) calls `POST /api/updates/check?source=plugin` instead of the manifest's `?check=1` (**P10′** — the row and its refresh move together; the manifest projection for other consumers migrates in PR 8), with a refresh test proving the row updates after an explicit check; Overview incidents whose fix is an update link to the row; NEW Health fixture `plugins/health/tests/updates.fixture.tsx` + `bakin.updates.ui-test.ts` config and `test:ui` script extended **(P13)**; `plugins/health/bakin.ui-test.ts`-pattern tests; Playwright screenshots (tab empty, required + available, confirm dialog, banner); `bun run ui:performance` run against the existing baseline: the tab is built lean first (no new dependencies, shared kit only); if Health's client still grows past the 2 KB ceiling, the commit records measured attribution + alternatives tried and the ceiling increase goes to Mark as an explicit ask before PR 7 merges **(P18′)**.
- Verify: `bun test tests/plugins/health --isolate`; `cd plugins/health && bun run test:ui` (report inspected); `bun run ui:performance`; `bun run ui:conformance --full` at the PR gate.
- Files: `plugins/health/components/{health-page,updates-tab,system-inventory}.tsx`, `plugins/health/hooks/use-updates.ts`, `plugins/health/lib/system-view-model.ts`, `plugins/health/tests/*`, `plugins/health/package.json`, `design-system/performance.json`, tests. Size: M.

### Task 7.10: CLI
- Acceptance: `bakin updates [--check] [--json]`, `updates skip <id>`, `updates apply <id>` (follows the operation; runs the CLI verification twin for `bakin:bakin`); registry entries; `docs:generate` output committed; serverless `--check` for the in-process path; NEW `tests/cli/updates-command.test.ts`.
- Verify: `bun test tests/cli/updates-command.test.ts --isolate`; `bun run docs:check`.
- Files: `src/cli/commands/updates.ts`, `cli/bakin.ts`, `src/core/cli/registry.ts`, generated docs. Size: S.

### Task 7.11: Docs (behaviour shipped in this PR) **(P17)**
`.claude/knowledge/updates.md` (engine, record, store, scheduler, apply, self-update, required sources); CLAUDE.md new Updates bullet + Onboarding/Layered-Context sentence "upstream fetches are user-initiated" reversed for update checks; `release-pipeline.md` self-update section; `doctor-and-health-checks.md` (`updates.changed` invalidation).

### Checkpoint PR 7
- [ ] Per-PR gate incl. `ui:conformance --full`, `docs:check`, `ui:performance`, Health `test:ui`; screenshots; Codex ×2; CI; merge.

---

## PR 8 — #1007 B: packages, hub skills, Team/Explore fold, deletions (`feat/1007-updates-packages`)

Order is consumer-first, deletion-last **(P1, P10)**:

| # | Commit | Revert set |
|---|--------|------------|
| 8.1 | `feat(updates): package + hub-skill sources; trackingSource preserved on reinstall` | {8.1–8.6} |
| 8.2 | `refactor(plugins,health): manifest projection reads the engine; upgrade writers stop writing check markers` | {8.2, 8.4, 8.6} — 8.4's `plugins list --check` assumes the engine-backed manifest **(P6′)** |
| 8.3 | `refactor(team,explore): join engine records; drop the per-load and ?check=1 probes` | {8.3, 8.6} |
| 8.4 | `refactor(agent-packages): sync --check and the CLI check verbs use the shared observer` | {8.4, 8.6} |
| 8.5 | `refactor(health): plugin-artifacts check consumes engine observations; private index probe + cache deleted` | {8.5, 8.6} |
| 8.6 | `chore(plugins,agent-packages): delete checker.ts, upgrade-check.ts + re-export, lockfile check markers, computeUpgradeAvailable, staleHintDays; docs` | alone |

### Task 8.1: Sources
- Acceptance: `package` source (`git ls-remote` against the pinned ref; clone only when moved, staged + removed); `hub-skill` source (partition by `upstream`; policy from lock `source`: tracking vs `@pinned`; hub latest vs `upstream.ref`; `blocked` when a pin vanished; never the frontmatter version); `confirmSkillInstall` (`skill-trust.ts:392`) / installer (`installer.ts:599`) gain `trackingSource` persisted as the lock `source` while the fetch ref targets the selected version; NEW `tests/core/updates/sources/packages.test.ts` (unpinned / pinned / frontmatter differs / moved ref / two successive updates to an unpinned skill); `tests/agent-packages` cases for `trackingSource`.
- Verify: `bun test tests/core/updates/sources tests/agent-packages --isolate` **(P12)**.
- Files: `src/core/updates/sources/{package,hub-skill}.ts`, `src/core/agent-packages/{skill-trust,installer}.ts`, tests. Size: M.

### Task 8.2: Manifest + Health explicit check + writers **(P10)**
- Acceptance: `packages/host/src/api/plugins/manifest.ts` projects `upgradeAvailable` from engine records (the `?check=1` branch triggers `POST /api/updates/check?source=plugin` semantics server-side and still answers synchronously with the refreshed projection); `plugins/health/hooks/use-system-data.ts:121-133` explicit refresh calls the engine check; `src/core/plugins/upgrade-artifact.ts:169-173`, `upgrade.ts:151` AND the local-upgrade writer at `upgrade.ts:164` stop writing `remoteArtifactVersion`/`remoteArtifactRebuild`/`lastChecked`/`lastSourceTreeSha` (keep `sourceTreeSha` + `sourceTreeShaAlgo`; the legacy-algorithm upgrade path is pinned by its test) **(P10′)**; fixtures updated; `tests/api/plugin-manifest-embedded.test.ts`, `tests/plugins/health` green.
- Verify: `bun test tests/api/plugin-manifest-embedded.test.ts tests/api/plugins-*.test.ts tests/plugins/health tests/core/plugins --isolate`.
- Size: M.

### Task 8.3: Team + Explore
- Acceptance: `packages/host/src/api/agent-packages/list.ts` drops `?check=1` and its checker import; `use-agent-store.ts` fetches ownership/state only, joins engine records by package id, subscribes to `updates.changed`; roster publishes without a network probe (test: load completes with the updates fetch pending); `plugins/explore/index.ts` drops its checker import and `runUpdateProbes`; `install-state.ts` reads engine records; Explore "check" → `POST /api/updates/check`; screenshots (Team badge, Explore status).
- Verify: `bun test tests/plugins/team tests/plugins/explore tests/api/agent-packages-routes.test.ts --isolate` **(P12)**; `cd plugins/team && bun run test:ui`; `cd plugins/explore && bun run test:ui` where present.
- Size: M.

### Task 8.4: Sync + CLI `--check`
- Acceptance: `sync.ts:328`/`:583` call the shared observer in-process (`src/core/updates/observe.ts`, the in-process entry); `bakin agents sync --check`, `bakin packages sync --check`, `bakin plugins list --check` go HTTP when a server runs, in-process otherwise; receipt shapes unchanged (existing tests green); CLI stale rendering (`reports/plugins.tsx:245`) now reads `observedAt`.
- Verify: `bun test tests/agent-packages tests/cli/agents-packages.test.ts tests/cli/bakin.test.ts --isolate`.
- Files: `src/core/agent-packages/sync.ts`, `src/core/updates/observe.ts`, `src/cli/commands/{agents,packages,plugins}.ts`, `src/core/cli/ui/reports/plugins.tsx`. Size: M.

### Task 8.5: Health `plugin-artifacts` consumer
- Acceptance: the private `publishedVersions` probe + TTL cache (`plugin-artifacts.ts:7-30`) deleted; the check reads engine observations (Unknown when none; freshness from `observedAt`); `doctor-and-health-checks.md` plugin-artifacts section updated **(P17)**.
- Verify: `bun test tests/plugins/health --isolate`. Size: S.

### Task 8.6: Deletions
- Acceptance: `checker.ts`, `upgrade-check.ts`, `upgrade.ts:60` re-export deleted; lockfile schema drops `lastChecked`, `remoteHeadSha`, `remoteArtifactVersion`, `remoteArtifactRebuild`, `lastSourceTreeSha`; `computeUpgradeAvailable` deleted; manifest `staleHintDays` + its REQUIRED schema field (`system-route-schemas.ts:185`) deleted; unknown keys strip on read, no write-on-read (test); `bun run ui:performance` against the existing baseline (reductions regenerate, growth follows the P18′ rule); docs `agent-packages.md`, `skill-hub-interop.md`, `plugin-lifecycle.md`, `explore-plugin.md`, `team-plugin.md`, `updates.md` sources section, and `layered-context.md:96` ("upstream checks are user-initiated" → the doctor/scanner stays local-only; scheduled package observations come from the update engine) **(P17′)**.
- Verify: `bun run typecheck`; `bun test tests/core/plugins tests/api/plugins-*.test.ts tests/api/plugin-manifest-embedded.test.ts tests/plugins/health --isolate`; `bun run ui:performance`.
- Size: M.

### Checkpoint PR 8
- [ ] Per-PR gate; screenshots; Codex ×2; CI; merge.

---

## PR 9 — #1007 C: `quiet` removal + editorial docs (`chore/1007-updates-docs`)

| # | Commit | Revert set |
|---|--------|------------|
| 9.1 | `refactor(health): doctor.sensitivity is developer | standard` | alone |
| 9.2 | `docs: final reconciliation of the updates/health knowledge docs and README` | alone |

### Task 9.1: Remove `quiet`
- Acceptance: settings type, normalizer, SDK `health.ts:62-67`, `system-settings.ts:126-133` label, `health-report.ts:142-144` comment; a file saying `quiet` falls back to `standard` (test); generated settings docs regenerated.
- Verify: `bun test tests/core/settings.test.ts tests/core/health-report*.test.ts --isolate`; `bun run docs:check`. Size: S.

### Task 9.2: Editorial reconciliation **(P17)**
Only what no earlier PR owned: CLAUDE.md Doctor bullet sensitivity values, `doctor-and-health-checks.md` sensitivity, README if it mentions the banner/Health, cross-links between `updates.md` and the plugin/package docs.

### Checkpoint PR 9 / Batch complete
- [ ] All success criteria in the spec verified on `main`; issues #945 #883 #896 #966 #948 #1007 closed with evidence; #964 ledger row re-dated; memory updated; Mark's manual sweep requested.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| PR 5's 164 effect rewrites change UI behaviour subtly | Med | per-plugin commits, parity tests for uncovered effects, story filters + plugin `test:ui`, conformance full, screenshots |
| zod externalization breaks a v1 artifact install on margo | Low | same family: v1 artifacts keep their private zod (D6.6); the compiled-binary integration test proves vendor delivery |
| Perf ratchet needs the Bits checkout | Low | present beside the repo; `BAKIN_DOCS_EXTERNAL_SOURCES` fallback |
| Reservation semantics regress the attach guarantee | Med | owner token = fingerprint; `doctor-repair.test.ts:205` is the canary; interleaving tests |
| Self-update verification races a fast restart | Med | verification starts on the handoff; `serving` state required; uninterrupted-connection test |
| Startup serves stale update records | Med | `engine.ready` read barrier + request-during-startup test **(P7)** |
| Scheduler leaks a hung child | Med | signal through adapter checks + reaped children; hung-executable test |
| `operator-review` requests confuse coverage/resurface code | Med | kind-aware coverage + resurfacing tests; auto-close unchanged path |
| Health client bundle growth trips the 2 KB ratchet | Low | measured + regenerated in 7.9 with the delta reviewed in the commit **(P18)** |
| New SDK exports trip the public-api ratchet | Low | regenerate `public-api.json` in the owning commit; external-consumer typecheck **(P11)** |
| Bits CI red after companion until SDK publish | Low | known pattern; recorded in the PR |
| Two full suites run concurrently by accident | High | run gates sequentially (`never-run-two-full-suites-at-once`) |

## Parallelization
None across PRs (sequential by design). Within a PR, Codex review of commit N can overlap building commit N+1 only when N+1 does not touch the same files; otherwise sequential.

## Open Questions
None blocking. Residuals are listed in the spec.
