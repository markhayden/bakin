# Implementation Plan: Onboarding hardening

Spec: [onboarding-hardening.md](./onboarding-hardening.md) (revision 4).
Status: revision 4, awaiting approval (2026-11-11).

- Revision 1 followed spec approval.
- Revision 2 applies a Codex (`gpt-6-astra`, high) review: **REVISE**, 7 P1 /
  4 P2, all folded in (see "Review log"). No persisted-state rollback
  problem was found.
- Revision 3 applies Codex round 2: **REVISE**, 3 P1 plus one partial, all
  folded in.
- Revision 4 applies Codex round 3: **REVISE**, 2 P1 (round-2 findings all
  resolved), both folded in.

## Overview

Five stacked PRs. PR 1 builds a child-process harness that runs the real
`bakin onboard` against throwaway homes and pins today's gaps as expected
failures. PRs 2-5 turn those failures into passes: bug fixes, runtime
choice with declared requirements, a guided credentials step, then the
setup checklist, CLI targets, final docs and a real-home pass on this Mac.

## Architecture decisions (restated for build order)

- The harness lands first; nothing in the orchestrator changes before it.
- Typed outcomes land before anything asserts on reasons or exit rules.
- Non-mutating evidence reads land before `--check` claims to be write-free.
- The phased bootstrap (decide → `mkdir`/`settings`/`runtime` → selections →
  the rest) lands in PR 3, before the runtime split removes the wizard's
  own provisioning. PR 4 only adds the credentials wait into that slot.
- `decideRuntime` proposes; the settings operation commits under
  `install-state`. In server mode the operation runs inside the server,
  which compares the proposal with the adapter that process bound at boot,
  so no lock-file change and no extra HTTP lookup is needed. With no server
  there is no live adapter to compare.
- A component install can return a typed `code`; the operation builder
  propagates it (`result.code ?? component.failureCode ?? 'component_failed'`)
  and the CLI reads it from the followed operation.
- Checks use their own composition on `createReadOnlyAppServices()`.
- The checklist engine only projects existing readiness engines.

## Dependency graph

```
PR1 harness
 └─ PR2 typed outcomes ─> non-mutating evidence reads ─> write-free --check ─> JSON/exit contract ─> findings
     └─ PR3 requires execution ─> phased bootstrap ─> runtime/llm split
                 presence probes ─┐
                 decision table ──┴─> locked settings contract ─> CLI integration ─> runtime screen ─> --no-recommended
         └─ PR4 active-runtime copy ─> credentials wait
             └─ PR5 checklist ─> finish screen ─> CLI targets ─> docs sweep ─> real-home pass ─> coverage + UI seed
```

## Branch and commit strategy

| PR | Branch (stacked on the previous) | Base |
|---|---|---|
| 1 | `test/onboarding-harness` | `main` |
| 2 | `fix/onboarding-harness-findings` | PR 1 |
| 3 | `feat/onboarding-runtime-choice` | PR 2 |
| 4 | `feat/onboarding-credentials-step` | PR 3 |
| 5 | `feat/onboarding-setup-checklist` | PR 4 |

- One commit per task (titles given). Each commit is green on its own for
  the gate set, so any commit is a rollback point inside its PR.
- Bug-fix and feature commits flip their pinned scenarios from
  `test.failing` to `test` in the same commit.
- Each behaviour commit that changes flags, targets or routes also updates
  `src/core/cli/registry.ts` and the generated references
  (`bun run docs:generate`) and the relevant paragraph of
  `.claude/knowledge/onboarding.md`. PR 5's docs task is the user-facing
  sweep, not the first time docs are touched.
- Merge order 1 → 5. After a merge the next branch is rebased onto `main`
  and its PR retargeted. Building continues on top while a PR is in review.
- Rollback: revert the PR's merge commit, in reverse order. An explicit
  `runtime.adapter` in settings and an unbumped marker stay readable by
  older code.
- Conventional commit messages ending with the session's `Co-Authored-By`
  line. PR bodies link the spec section they implement.
- Never `git add -A` after a local build; stage paths explicitly.

**Gates.**

| When | What (run bare, never piped) |
|---|---|
| Every commit | `bun run typecheck`, `bun run lint`, `bun run check:cycles`, the touched test files with `--isolate` |
| Commits that change a server route (3.3, 3.6) | `/verify` as well |
| Flag/target/route changes | `bun run docs:generate` and commit the result |
| Each checkpoint | `bun run test:ci` (the CI invocation) and `bun run docs:check` |
| If a commit touches shipped defaults or browser assets (not expected) | full build chain + embedded-assets manifest; stop and report any perf-ceiling change |

`/verify` boots a preconfigured server, so it cannot prove fresh-home choice
or the credentials wait. Those are proven by harness scenarios, render
tests, and a rig transcript pasted into the PR body.

## Matrix inventory (PR 1 partition)

"Baseline" rows are expected to pass on today's code and land as plain
tests. "Pinned" rows land as `test.failing` and are flipped by the named
task. If a baseline row fails at build time it is a finding for task 2.5;
if a pinned row unexpectedly passes it moves to baseline. Isolation
assertions (shim record, proxy record, cleanup) run in an `afterEach`
outside the test body, so an isolation breach can never be absorbed by an
expected failure.

| # | Row | PR 1 | Flipped by |
|---|---|---|---|
| 1 | Stored adapter (Pi + auth; OpenClaw fixture) run to a marker | baseline | — |
| 2 | Rerun → `already_onboarded` | baseline | — |
| 3 | `--force` replay, idempotent | baseline | — |
| 4 | Old-version marker / corrupt marker → not onboarded | baseline | — |
| 5 | Broken roster (duplicate ids) → error, not provisioned | baseline | — |
| 6 | `BAKIN_RUNTIME_ADAPTER` used, not persisted | baseline | — |
| 7 | `BAKIN_URL` set → refused | baseline | — |
| 8 | Server running vs not → same outcomes | baseline | — |
| 9 | A component install fails → exit 1, no marker, rerun resumes | baseline | — |
| 10 | Interrupt (in-process; detached from a server run) then rerun | baseline | — |
| 11 | Stale `install.lock` / concurrent second `bakin onboard` | baseline | — |
| 12 | No runnable model → `unavailable` / `no_runnable_model` | pinned | 2.1 |
| 13 | `--check` zero writes (fresh, onboarded, no usage db, existing usage db, legacy secrets) | pinned | 2.3 |
| 14 | `--check --force` → usage error | pinned | 2.3 |
| 15 | JSON completeness + summary; not-applicable does not affect exit | pinned | 2.4 |
| 16 | Runtime unreachable → independent steps still run, dependents `requires` | pinned | 3.1 |
| 17 | Stored Pi, no auth → `runtime` ok, `llm` warn, marker | pinned | 3.3 |
| 18 | OpenClaw gateway down, with and without credentials → `runtime` error | baseline | — (must stay green through 3.3) |
| 19 | OpenClaw empty roster → provisioned, still empty → error | baseline | — (must stay green through 3.3) |
| 20 | Two concurrent undecided CLI runs → one winner, one `runtime_already_set` | pinned | 3.7 |
| 21 | Fresh, nothing found → Pi `default`, persisted | pinned | 3.7 |
| 22 | Fresh, Pi found (+auth / no auth) → `detected` | pinned | 3.7 |
| 23 | Fresh, OpenClaw found, gateway up → `detected` | pinned | 3.7 |
| 24 | Both found, `--json` (non-interactive) → `ambiguous_runtime`, homes byte-identical | pinned | 3.7 |
| 25 | Both found `--runtime pi` → `flag` | pinned | 3.7 |
| 26 | `--runtime bogus` / `BAKIN_RUNTIME_ADAPTER=bogus` → `invalid_runtime` | pinned | 3.7 |
| 27 | Stored adapter, `--runtime` differs (fresh and onboarded) → `runtime_already_set` | pinned | 3.7 |
| 28 | Settings absent / `{}` / zero-byte persisted; not JSON / unsupported adapter → exit 1 untouched | pinned | 3.7 |
| 29 | `--yes --no-recommended` → three components `declined`, proxy empty | not in PR 1 | added as a plain test in 3.9 |
| 30 | Pi, no auth → Pi instructions, no OpenClaw wording | pinned | 4.1 |

PR 1 scenarios use only flags that exist today. Every scenario that lands
before 3.9, baseline or pinned, runs with `--json` and **without `--yes`**:
`--json` alone is non-interactive, and without `--yes` the recommended
installs are not approved, so the proxy record stays empty on today's code
and on every intermediate commit. The `--yes` spelling of row 24 is a
mocked unit test in 3.7 (`tests/cli/onboard-command.test.ts`). Row 29 needs
`--yes` and a flag that does not exist yet, so it is not pinned; it lands
with its implementation in 3.9. Task 1.4 confirms the "no `--yes` ⇒ nothing
approved" premise with a baseline assertion (three recommended components
not installed, proxy empty); if it does not hold, that is a PR 2 finding
and the affected pins wait for its fix.

---

## PR 1 — Harness and local rig

### Task 1.1: Child-process harness core
`test(onboarding): child-process harness with a closed environment`

Home builder (temp `BAKIN_HOME`, Pi home, OpenClaw home, `HOME`, scaffold
`settings.json` with a guest search URL and no `runtime` key), env
allowlist, `bun --no-env-file cli/bakin.ts …` spawn with a deadline,
process-group kill and wait, JSON-line parsing, home snapshot/diff helper
(excludes `logs/`). The documented subprocess exception lands here: one
line in CLAUDE.md's Testing Rules and the mock-checker hook handling for
`tests/integration/onboarding/`.

- Acceptance: a `bakin onboard --check --json` run returns parsed lines and
  an exit code; the temp tree is removed after the child exits; teeth prove
  the preload's `BAKIN_URL` and a `.env`-planted variable do not reach the
  child, and a resolver probe (`probe-resolvers.ts`, spawned the same way
  as the CLI, importing the real Bakin content-dir, Pi home and OpenClaw
  home resolvers and printing what they return) answers only paths under
  the temp tree. `bakin paths` is not used: it is an HTTP call that reports
  the server's Bakin paths.
- Verify: `bun test tests/integration/onboarding/harness.test.ts --isolate`
- Files: `tests/integration/onboarding/harness.ts`, `probe-resolvers.ts`, `harness.test.ts`, `CLAUDE.md`, the mock-checker hook config
- Size: M. Depends on: none.

### Task 1.2: Shims, deny proxy, teeth
`test(onboarding): supervisor shims, recording deny proxy and harness teeth`

`launchctl`/`systemctl` recording shims first on `PATH`; recording deny
proxy with upper- and lowercase proxy variables; git restricted to local
files; the `afterEach` isolation assertions.

- Acceptance: teeth prove detection of a `launchctl` call, an outside
  `fetch`, and an https and an ssh `git clone`; a breach inside a
  `test.failing` body still fails the run.
- Verify: same file as 1.1.
- Files: `harness.ts`, `harness.test.ts`, `tests/integration/onboarding/shims/`
- Size: M. Depends on: 1.1.

### Task 1.3: Runtime fixtures and baseline scenarios
`test(onboarding): runtime fixtures and baseline scenarios`

Fixtures: a Pi home with and without a fake `auth.json`; an OpenClaw home
with a valid config and roster, explicit gateway settings pointing at a
local health endpoint, and a deterministic `openclaw` CLI shim on `PATH`
(answers `models list --all --json` and the credential fallback) so
nothing depends on a developer's installed OpenClaw; broken and empty
roster variants. Scenarios: inventory rows 1-11, 18 and 19.

- Acceptance: rows 1-11, 18 and 19 green on both fixtures where applicable.
- Verify: `bun test tests/integration/onboarding --isolate`
- Files: `tests/integration/onboarding/fixtures.ts`, `shims/openclaw`, `scenarios/baseline.test.ts`, `scenarios/recovery.test.ts`, `scenarios/server-mode.test.ts`
- Size: M (split fixtures from scenarios if the diff is large). Depends on: 1.2.

### Task 1.4: Pin known gaps
`test(onboarding): pin known gaps as expected failures`

Inventory rows 12-17, 20-28 and 30 as `test.failing`, each with a comment
naming the flipping task, all without `--yes`. Plus the baseline assertion
that a run without `--yes` approves no recommended install.

- Acceptance: suite green; the inventory table reproduced in the PR body
  with any row that moved between columns called out.
- Verify: `bun test tests/integration/onboarding --isolate`
- Files: `scenarios/runtime-choice.test.ts`, `check-readonly.test.ts`, `json-contract.test.ts`, `requirements.test.ts`, `copy.test.ts`
- Size: M. Depends on: 1.3.

### Task 1.5: Local rig
`feat(dev): onboard:rig runs onboarding against a throwaway home`

- Acceptance: `bun run onboard:rig --runtime pi` opens the interactive
  wizard against a temp home; real `~/.bakin`, `~/.pi` and the launchd unit
  are unchanged (mtime check before and after).
- Verify: manual run; typecheck; lint.
- Files: `scripts/onboard-rig.ts`, `package.json`, `.claude/knowledge/dev-rig.md`
- Size: S. Depends on: 1.1.

### Checkpoint 1
- [ ] `bun run test:ci` green; the onboarding directory adds < 90 s to its shard.
- [ ] PR 1 opened. Report: the inventory as built + baseline findings.

---

## PR 2 — Fixes

### Task 2.1: Typed outcomes
`refactor(onboarding): typed skip reasons and outcome codes`

`reason` (`not_applicable | declined | requires | check_only | unavailable`)
and `code` on outcomes and install results; the two model-plan skips
become `unavailable` with codes; the operation builder propagates
`result.code`. No dependency behaviour changes: the existing cascades stay
and simply emit `reason: 'requires'`.

- Acceptance: row 12 passes; existing onboarding unit tests updated only
  where they asserted message text.
- Verify: `bun test tests/core/onboarding tests/cli --isolate`
- Files: `src/core/onboarding/types.ts`, `index.ts`, `models.ts`, `operation.ts`, tests
- Size: M. Depends on: PR 1.

### Task 2.2: Non-mutating evidence reads
`fix(models): a plan check never creates or migrates a store`

Read-only access for every store read a component check can reach: the
usage history, and in the execution ledger both the probe evidence and the
model rejections (`listModelRejections`, reached through
`getModelEligibility`). An absent store reads as no evidence; an existing
store is opened without migrations or WAL writes. `storage/db.ts` stays
the sole `bun:sqlite` importer. The task starts with a sweep of every
store opener reachable from a component `check()` and lists what it found
in the commit body, so a fourth reader is caught here and not by row 13.

- Acceptance: focused unit tests for absent and existing usage store and
  ledger, covering usage, probe evidence and rejections (file set and
  bytes unchanged after each read; existing rejections are still returned).
- Verify: `bun test tests/core/model-plan-input.test.ts tests/core/onboarding/models-plan.test.ts --isolate` (create the first file if absent)
- Files: `src/core/model-plan-input.ts`, `src/core/model-eligibility.ts`, the usage-store reader, `packages/core/src/execution/ledger.ts`, `packages/core/src/storage/db.ts`, tests
- Size: M. Depends on: none.

### Task 2.3: Write-free `--check`
`fix(onboarding): --check performs no writes`

Check composition on `createReadOnlyAppServices()` with an initialized
runtime adapter; no marker write/clear, provisioning or install under
`--check`; `--check --force` is a usage error; `bakin check <x>` uses the
same composition. Rewrite the unit test that expects a marker.

The check composition passes the OpenClaw adapter a non-creating
tool-access credential reader (`src/core/mcp-credentials.ts`: reads
`mcp-secret`, never creates it). With no secret on disk, tool access
cannot be current, so `openclaw-integration` reports `missing` (needs
provisioning) and nothing is written. Normal composition keeps the
creating reader.

- Acceptance: rows 13-14 pass, with row 13 run on the OpenClaw fixture
  too; unit tests: missing secret → `missing` and no file created; a
  correctly provisioned OpenClaw home with its secret → `ok` under the
  check composition.
- Verify: `bun test tests/integration/onboarding/scenarios/check-readonly.test.ts tests/core/onboarding/index.test.ts tests/cli/onboarding-component-commands.test.ts --isolate`
- Files: `src/core/onboarding/index.ts`, `src/core/app-services.ts`, `src/core/mcp-credentials.ts`, `src/cli/commands/onboarding.ts`, `src/core/cli/registry.ts`, tests
- Size: M. Depends on: 2.2.

### Task 2.4: JSON contract and exit rule
`fix(onboarding): one JSON line per component, a summary line, honest exit code`

- Acceptance: row 15 passes; `tests/cli/onboarding-check-json.test.ts` updated.
- Verify: those files with `--isolate`
- Files: `src/core/onboarding/index.ts`, `src/cli/commands/onboarding.ts`, tests
- Size: S. Depends on: 2.1.

### Task 2.5: Harness findings loop
`fix(onboarding): <one commit per bug>`

Each further failure: reproduce in isolation, add or un-pin the scenario,
fix, commit. Bugs owned by another subsystem that do not block a scenario
become GitHub issues listed in the PR body. Timeboxed per finding.

- Acceptance: no unexplained failing scenario outside rows owned by PRs 3-5.
- Verify: `bun test tests/integration/onboarding --isolate`

### Checkpoint 2
- [ ] `bun run test:ci` and `bun run docs:check` green. PR 2 opened with
      the findings list (fixed / ticketed).
- [ ] Maintainer sees the list before PR 3 changes the flow.

---

## PR 3 — Runtime choice and declared requirements

### Task 3.1: Requirements drive execution
`feat(onboarding): steps declare what they need`

`requires` + `usableWhenMissing` on every component, generic skipping in
the orchestrator, both hand-written cascades deleted, architecture test
(requirements name earlier components). Re-confirm the `models` and
`channels` rows by reading them. This is a behaviour change: when the
runtime is not ready, `search`, `search-models`, `media` and `budget` now
run. Assertions that change: the "runtime missing skips everything" unit
tests in `tests/core/onboarding/index.test.ts` and
`tests/core/onboarding-adapter-gating.test.ts`.

- Acceptance: row 16 passes; marker `components` gains names, version unchanged.
- Verify: `bun test tests/core/onboarding tests/core/onboarding-adapter-gating.test.ts tests/architecture tests/integration/onboarding --isolate`
- Files: `src/core/onboarding/types.ts`, `index.ts`, each component file (one-line `requires`), tests, new arch test
- Size: M (component one-liners are mechanical). Depends on: PR 2.

### Task 3.2: Phased bootstrap
`refactor(onboarding): run in phases so setup precedes the questions`

Orchestrator exposes the bootstrap phase (`mkdir`, `settings`, `runtime`)
and the remainder separately; the CLI runs bootstrap, then collects
selections from fresh checks, then runs the rest. The wizard stops
checking and provisioning the runtime itself; until 3.3 the bootstrap
phase keeps today's inline provisioning in the orchestrator, so nothing is
ownerless between commits.

- Acceptance: baseline and server-mode scenarios unchanged; interactive
  render tests updated for the new order; a unit test proves selections
  are collected after bootstrap.
- Verify: `bun test tests/core/cli/onboarding-interactive.test.ts tests/cli/onboard-command.test.ts tests/cli/onboarding-ui.test.tsx tests/integration/onboarding --isolate`; rig run
- Files: `src/core/onboarding/index.ts`, `src/cli/commands/onboarding.ts`, `src/core/cli/onboarding-interactive.tsx`, tests
- Size: M. Depends on: 3.1.

### Task 3.3: Runtime and credentials as two facts
`feat(onboarding): runtime reachability and credentials are separate facts`

`runtime` check = initialize + reachability by tool-access style + roster
integrity; `runtime` becomes installable (provision an empty roster, then
re-validate) and owns provisioning; `runRuntimeInline` deleted; `llm`
moves after `runtime`; install-request enum, operation title, core-route
description, registry, generated API docs.

- Acceptance: row 17 passes; rows 18-19 stay green.
- Verify: `bun test tests/core/onboarding/runtime.test.ts tests/core/onboarding/credentials.test.ts tests/api/onboarding-install-route.test.ts tests/integration/onboarding --isolate`; `/verify`; `bun run docs:check`
- Files: `src/core/onboarding/runtime.ts`, `credentials.ts`, `index.ts`, `install-request.ts`, `operation.ts`, `packages/host/src/core-routes/index.ts`, tests
- Size: M. Depends on: 3.2.

### Task 3.4: Adapter presence probes
`feat(runtime): read-only presence probes per adapter`

- Acceptance: each probe reads only its own home; `detectRuntimes()`
  returns results in `['openclaw','pi']` order; boundary arch tests green.
- Verify: `bun test tests/adapter-pi tests/adapter-openclaw tests/architecture --isolate`
- Files: `packages/adapter-pi/src/*`, `packages/adapter-openclaw/src/*`, `src/core/runtime-adapter-factory.ts`, tests
- Size: S. Depends on: none.

### Task 3.5: Decision table
`feat(onboarding): runtime decision table`

- Acceptance: one unit test per table row plus invalid env; no I/O.
- Verify: `bun test tests/core/onboarding/runtime-choice.test.ts --isolate`
- Files: `src/core/onboarding/runtime-choice.ts`, test
- Size: S. Depends on: none.

### Task 3.6: Locked settings contract
`feat(onboarding): the settings operation commits the runtime choice`

`runtimeAdapter` install option (part of identity); settings owns
`install-state`; inside the operation it rereads the stored adapter and,
in the server process, the adapter bound at boot; equal is a no-op,
different fails with typed code `runtime_already_set` /
`server_running_other_runtime`; every persistent proposal enters the
operation even when the settings check is ok.

- Acceptance: operation-level tests (no CLI flag needed): two concurrent
  settings operations proposing different adapters → one commits, one
  fails `runtime_already_set`; same-adapter no-op; different stored
  adapter; server on the same and on a different adapter; code propagation
  through both operation modes (no fallback after send). Row 20 stays
  pinned until 3.7.
- Verify: `bun test tests/core/onboarding/settings.test.ts tests/core/onboarding/install-request.test.ts tests/core/onboarding/operation.test.ts tests/api/onboarding-install-route.test.ts --isolate`; `/verify`
- Files: `src/core/onboarding/settings.ts`, `install-request.ts`, `operation.ts`, `types.ts`, `src/cli/component-install.ts`, tests
- Size: M. Depends on: 3.3.

### Task 3.7: CLI integration of the choice
`feat(onboarding): detect, decide and persist the runtime on first run`

`--runtime` flag; detection + decision before bootstrap; refusal
summaries; validation before the already-onboarded shortcut;
process-scoped decision under `--check`; registry and generated CLI
reference.

- Acceptance: rows 20-28 pass; mocked unit test for both-found `--yes`.
- Verify: `bun test tests/cli/onboard-command.test.ts tests/integration/onboarding --isolate`; `bun run docs:check`
- Files: `src/cli/commands/onboarding.ts`, `src/core/onboarding/index.ts`, `src/core/cli/registry.ts`, generated docs, tests
- Size: M. Depends on: 3.4, 3.5, 3.6.

### Task 3.8: Runtime selection screen
`feat(onboarding): runtime selection screen`

- Acceptance: render test (found markers, preselection, every supported
  adapter offered); rig transcript for nothing found, Pi only, both.
- Verify: `bun test tests/cli/onboarding-ui.test.tsx tests/core/cli/onboarding-interactive.test.ts --isolate`
- Files: `src/core/cli/onboarding-interactive.tsx`, `src/core/cli/ui/onboarding.tsx`, tests
- Size: S. Depends on: 3.7.

### Task 3.9: `--no-recommended`
`feat(onboarding): --no-recommended declines the recommended installs`

The orchestrator takes explicit declines and applies them before a
component's check or install is dispatched, so `capabilities` no longer
installs just because `autoApprove` is true.

- Acceptance: row 29 added and passing (`--yes --no-recommended`, proxy
  empty) for all three components, with nothing-installed and
  already-installed variants (still `declined`, nothing run).
- Verify: `bun test tests/core/onboarding/index.test.ts tests/integration/onboarding --isolate`
- Files: `src/core/onboarding/index.ts`, `types.ts`, `src/cli/commands/onboarding.ts`, `src/core/cli/registry.ts`, generated docs, tests
- Size: S. Depends on: 3.1.

### Checkpoint 3
- [ ] `bun run test:ci` and `bun run docs:check` green.
- [ ] Rig transcripts in the PR body. PR 3 opened; maintainer review of the
      flow change before PR 4.

---

## PR 4 — Credentials step

### Task 4.1: Messages name the active runtime
`fix(onboarding): messages come from the active runtime's support entry`

- Acceptance: row 30 passes; architecture test bans
  `DEFAULT_RUNTIME_ADAPTER_SUPPORT` in onboarding code.
- Verify: `bun test tests/core/onboarding/credentials.test.ts tests/architecture tests/integration/onboarding --isolate`
- Files: `src/core/runtime-adapter-factory.ts`, `src/core/onboarding/runtime.ts`, `credentials.ts`, tests, arch test
- Size: S. Depends on: PR 3.

### Task 4.2: Credentials wait
`feat(onboarding): guided credentials step`

A wait screen in the slot between bootstrap and selections: Enter
rechecks, `s` skips (`warn`). No operation open while waiting.

- Acceptance: render tests for the screen and both exits; a unit test
  proves no operation is running and `install-state` is free during the
  wait; scripted runs warn and continue.
- Verify: `bun test tests/cli/onboarding-ui.test.tsx tests/core/cli/onboarding-interactive.test.ts tests/cli/onboard-command.test.ts --isolate`; rig transcript (no auth → log in from a second terminal → Enter)
- Files: `src/core/cli/onboarding-interactive.tsx`, `src/core/cli/ui/onboarding.tsx`, `src/cli/commands/onboarding.ts`, tests
- Size: M. Depends on: 4.1.

### Checkpoint 4
- [ ] `bun run test:ci` green. PR 4 opened.

---

## PR 5 — Checklist, CLI targets, docs, real-home pass

### Task 5.1: Checklist engine
`feat(onboarding): setup checklist engine`

Projections per spec §7. The search row reads the search adapter's
service-access projection through a neutral surface; if none exists
upstream of the adapter, add a neutral status member (the architecture
test bans engine identifiers in core).

- Acceptance: a unit test per item covering done / todo / unknown / omitted.
- Verify: `bun test tests/core/onboarding/setup-checklist.test.ts tests/architecture --isolate`
- Files: `src/core/onboarding/setup-checklist.ts`, neutral search surface if needed, tests
- Size: M. Depends on: PR 4.

### Task 5.2: Finish screen and `--check` rendering
`feat(onboarding): finish screen shows what is left to set up`

- Acceptance: render test; non-TTY output lists the same items; the
  `--json` summary carries the checklist.
- Verify: `bun test tests/cli/onboarding-ui.test.tsx tests/cli/onboarding-check-json.test.ts --isolate`
- Files: `src/core/cli/ui/onboarding.tsx`, `src/cli/commands/onboarding.ts`, tests
- Size: S. Depends on: 5.1.

### Task 5.3: CLI targets derive from the component list
`fix(cli): check and install targets derive from the component list`

- Acceptance: every component has a `bakin check` target, every
  installable one a `bakin install` target; hints and the registry usage
  strings match; architecture test.
- Verify: `bun test tests/cli/onboarding-component-commands.test.ts tests/architecture --isolate`; `bun run docs:check`
- Files: `src/cli/commands/onboarding.ts`, `src/core/cli/registry.ts`, generated docs, tests, arch test
- Size: S. Depends on: PR 3.

### Task 5.4: User docs sweep
`docs(onboarding): first run on Pi or OpenClaw`

`first-time-setup.mdx`, `README.md`, CLAUDE.md Onboarding bullet, final
pass over `.claude/knowledge/onboarding.md`.

- Acceptance: `bun run docs:check` green; no doc says OpenClaw is required.
- Size: M. Depends on: 5.1-5.3.

### Task 5.5: Real-home pass on this Mac
`docs(onboarding): real-home first-run evidence`

**Stops and asks before deleting anything.** Then: remove `~/.bakin`, the
`io.bakin.antfly` unit (`launchctl bootout` + plist; no CLI verb removes it
today, which gets a GitHub issue) and `~/.antfly` → onboard on Pi from
source with a throwaway Pi home holding a copy of `auth.json` →
`bakin install search` → `bakin start` → doctor → teardown of all of it.
Each defect becomes a 2.5-style fix commit in this PR.

- Acceptance: evidence file with commands, outputs and timings; machine
  clean afterwards; `~/.pi` and `~/.openclaw` mtimes unchanged.
- Files: `tasks/evidence-onboarding-real-home.md`
- Size: M. Depends on: 5.1-5.4.

### Task 5.6: Coverage review and UI handoff
`test(onboarding): close coverage gaps` /
`docs(specs): seed the browser onboarding wizard spec`

Run `/agent-skills:test` over the changed modules. Seed
`.claude/specs/onboarding-ui-wizard.md` with the inputs already decided;
the full spec is its own interview.

- Acceptance: zero `test.failing` in `tests/integration/onboarding`; every
  spec success criterion listed with its evidence in the PR body.
- Size: S.

### Checkpoint 5 (complete)
- [ ] `bun run test:ci`, `bun run docs:check` green. PR 5 opened.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Child-process scenarios slow or flaky in CI | Med | Deadline per child, poll state instead of sleeping, budget check at Checkpoint 1, two server-mode scenarios only |
| OpenClaw fixture drifts from the real CLI | Med | Shim answers only the two commands the adapter runs; the dev rig remains the real-runtime check |
| Harness finds more bugs than expected | Med | Timebox per finding; non-blocking ones become issues; list reviewed at Checkpoint 2 |
| Requirements change behaviour beyond row 16 | High | Lands after the harness; changed assertions are named in 3.1 |
| Settings operation taking `install-state` blocks a nested install | Med | Settings runs as its own bootstrap step; concurrency scenario covers it |
| Read-only store access needs a second opener | Med | Kept inside `storage/db.ts` so the sole-importer arch test holds |
| Check composition diverges from real composition | Med | One builder for `onboard --check` and `bakin check <x>`; five home shapes snapshotted |
| Real-home pass damages the operator's Pi | High | Throwaway Pi home, copy-only; explicit ask before the wipe; mtime checks |

## Open questions

- None blocking.

## Review log

Codex `gpt-6-astra`, high, 2026-11-11: REVISE.

| # | Finding | Resolution |
|---|---|---|
| 1 (P1) | Baseline/failure partition invalid | Matrix inventory; PR 1 uses existing flags and stored, authenticated runtimes |
| 2 (P1) | OpenClaw fixture incomplete | 1.3: `openclaw` CLI shim, valid roster, explicit gateway settings |
| 3 (P1) | Write-free check before its prerequisites; ledger read missed | 2.2 (usage store + ledger, absent and existing) before 2.3 |
| 4 (P1) | PR 3 intermediate behaviour contradictory | 2.1 typed outcomes (no behaviour change) split from 3.1 (behaviour change, assertions named) |
| 5 (P1) | Bootstrap phasing must precede runtime integration | 3.2 in PR 3; PR 4 keeps only the wait |
| 6 (P1) | Locked refusal lacks a transport contract | In-server adapter comparison; typed `code` through the operation builder; 3.6 files and tests |
| 7 (P1) | `--no-recommended` omits execution-layer changes | 3.9 lists `index.ts`/`types.ts`, declines before dispatch |
| 8 (P2) | Isolation acceptance incomplete, documented late | 1.1 containment teeth + docs/hook; `afterEach` assertions |
| 9 (P2) | Generated help stale | Registry + generated docs in each behaviour commit |
| 10 (P2) | Tasks need splits | 2.1/3.1, 3.6/3.7, 3.2/4.2 |
| 11 (P2) | Gate applicability | Gates table; `/verify` limits stated; `test:ci` at checkpoints |

Codex round 2, 2026-11-11: REVISE (round-1 findings: 9 resolved, 2 partial).

| # | Finding | Resolution |
|---|---|---|
| R1 partial | Rows 18-19 already pass today | Moved to baseline; 3.3 must keep them green |
| 1 (P1) | `bakin paths` cannot prove resolver containment | 1.1 uses a child resolver probe importing the three real resolvers |
| 2 (P1) | Row 20 flipped before `--runtime` exists | Operation-level concurrency in 3.6; row 20 flips in 3.7 |
| 3 (P1) | Early `--yes` pins would trip the network assertion | No `--yes` before 3.9; row 24 uses `--json`; row 29 lands with 3.9; premise asserted in 1.4 |

Codex round 3, 2026-11-11: REVISE (round-2 findings all resolved).

| # | Finding | Resolution |
|---|---|---|
| 1 (P1) | Model rejections read still opens the migrating ledger | 2.2 covers rejections and starts with a sweep of every store opener reachable from a check |
| 2 (P1) | Check composition creates `mcp-secret` through the OpenClaw credential callback | 2.3 adds a non-creating reader; missing secret → `missing`, no write; tests for both cases |

Codex round 4, 2026-11-11: **APPROVE**. Round-3 findings resolved; no new P1/HIGH.
