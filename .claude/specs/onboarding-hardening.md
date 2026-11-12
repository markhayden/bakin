# Spec: Onboarding hardening

Status: revision 4, awaiting approval (2026-11-11)
Follow-on (separate spec, not this one): browser onboarding wizard.

- Revision 1 came from the kickoff interview.
- Revision 2 applies an independent Codex (`gpt-6-astra`, high) review,
  round 1: **REVISE**, 8 P1 / 4 P2, six factual corrections. Every finding is
  folded in (see "Review log"). Two findings overturned interview decisions
  and were re-decided with the maintainer (D1/D10 Pi home, D11 no-login).
- Revision 3 applies round 2: **REVISE**, 6 P1 / 3 P2 / 1 P3 new, five
  factual corrections; 5 of 12 round-1 findings confirmed resolved, 7
  partial. All folded in. No maintainer decision changed; one flag design
  got smaller (`--no-recommended` replaces three selection flags).

## Objective

`bakin onboard` is the first thing a new operator runs, and it has never been
exercised end to end against a fresh home in an automated way. Its unit tests
are heavily mocked, a fresh home silently lands on OpenClaw, some copy is
OpenClaw-only, and the run is not write-free under `--check`.

This project makes the CLI onboarding provably sound and current:

1. A repeatable harness that runs the real CLI against throwaway homes through
   a scenario matrix, in CI on every PR, plus a local rig for clicking through
   the interactive wizard by hand.
2. Fixes for every onboarding-owned bug the harness and a real-home pass find.
3. Flow changes: runtime detection and choice, declared per-step
   dependencies instead of hand-written cascades, runtime-aware messages, a
   guided credentials step, a setup checklist behind the finish screen, CLI
   target drift, docs.

The user is the single operator installing Bakin on a Mac (minis in
production, this dev Mac for the work). No backwards-compatibility effort and
no shims.

### What is true today (verified against the code)

- Onboarding uses the configured adapter and already handles Pi (empty-roster
  provisioning, adapter-gated `openclaw-integration`), Discord readiness,
  capability packs and the model plan. The gaps are the default adapter on a
  fresh home and copy that reads `DEFAULT_RUNTIME_ADAPTER_SUPPORT`.
- The `runtime` check calls `ping()`. OpenClaw's `ping()` is gateway HTTP
  health; Pi's is "initialized and at least one credential in auth.json".
  Neither proves a turn works. On Pi, no login therefore reads as "runtime
  missing" and skips every later step.
- OpenClaw reads its roster from local config, so the roster can be read
  with the gateway down. Its `provisionToolAccess()` writes MCP entries
  only; Pi's also seeds the main agent.
- `createAppServices()` migrates secrets and provisions search.
  `createReadOnlyAppServices()` does neither, but leaves the runtime
  adapter uninitialized. The model-plan evidence read opens the usage
  database through an opener that creates the file.
- The `settings` component declares no resources, so its write is not
  serialized against other installs.
- `initBakinHome` seeds `settings.json` as `{}`, so "no settings file" is not
  a usable fresh-home signal.
- `runOnboard` writes the marker under `--check`, clears it under
  `--check --force`, and provisions an empty roster during a check run.
- Not-applicable components emit no JSON line and still push the exit code
  to 2.
- `bakin start` is marker-gated (bypass: `--skip-onboarding-check`,
  `BAKIN_SKIP_ONBOARDING_CHECK=1`); `bakin serve` is not gated.
- Channel checks already send non-native delivery to Settings → Channels;
  only the `manualSetup` strings are stale.
- `plugin-assets` reads and writes `runtime.skills`; capability readiness
  reads it and capability installs write it; plugin installs project skills
  into the runtime.

### Decisions

| # | Decision |
|---|---|
| D1 | This Mac's stale `~/.bakin`, the `io.bakin.antfly` launchd unit and `~/.antfly` are disposable, no backup. `~/.pi` and `~/.openclaw` are never written by anything in this project. |
| D2 | Runtime pick when the home has no stored adapter: detect both. Either found → ask on a terminal. None found → Pi, no question. |
| D3 | No terminal: exactly one found → use it and say so; none → Pi; both found and no `--runtime` → exit 1 before any write. |
| D4 | Credentials: guide and recheck. Bakin never handles the LLM secret. |
| D5 | Harness: integration suite in `bun run test:ci` + `bun run onboard:rig`. No compiled-binary container job here. |
| D6 | Newer features are covered by a finish-screen checklist, not new install steps. Spend limits and brands are never listed. |
| D7 | One setup checklist engine feeds the CLI finish screen and `bakin onboard --check`. **Narrowed in rev 2:** the HTTP route and dismissals move to the UI wizard spec, which is their first consumer. |
| D8 | Steps declare what they need; a step is skipped only when a declared requirement did not succeed. A runtime that is not reachable blocks completion (no marker). |
| D9 | Five stacked PRs, harness first. Bugs owned by other subsystems get a GitHub issue unless they block a scenario. |
| D10 | Real-home pass on this Mac: wipe all Bakin state, onboard on Pi from source against the real `~/.bakin` and real search service, with Pi pointed at a throwaway home holding a copy of `auth.json`; tear everything down afterwards. |
| D11 | Runtime reachable but no LLM credentials: everything installs, onboarding finishes with a warning, `bakin start` works. Same rule on both runtimes. |

### Out of scope

- Browser wizard, setup mode for `bakin start`, sidebar card, checklist page,
  checklist HTTP route and dismissals, Terminal-plugin handoff for `/login`
  (UI spec; recorded there: "open a prepopulated Terminal session when that
  plugin is installed, otherwise a copyable instruction card").
- A Discord setup step, a compiled-binary CI job, Homebrew/notarization
  checks, onboarding against a Pi home that already holds the operator's own
  agents.
- Changing `ping()` semantics on either adapter.

## Tech Stack

Bun 1.4.3, TypeScript strict, Ink (CLI screens), zod at boundaries, the
operations primitive for every mutation. No new dependencies.

## Commands

```
Harness (CI):      bun test tests/integration/onboarding --isolate
One scenario:      bun test tests/integration/onboarding/scenarios/<file>.test.ts --isolate
Local rig:         bun run onboard:rig [--runtime pi|openclaw|none] [--auth] [--keep] [-- <onboard args>]
Unit tests:        bun test tests/core/onboarding tests/cli --isolate
Full suite:        bun run test
Gates (run bare):  bun run typecheck
                   bun run lint
                   bun run check:cycles
                   bun run docs:check
Debug one file:    BAKIN_CONSOLE_FORMAT=pretty bun test <file> --isolate
```

`onboard:rig` reuses the harness's home builder (and `scripts/instance/*`
helpers where they fit): it mints a throwaway home under the gitignored
`dev/` tree, applies the same environment the harness uses, and runs
`bakin onboard` from source in the foreground. `--auth` copies the operator's
Pi `auth.json` into the throwaway Pi home (a copy; `~/.pi` is only read).
`--keep` leaves the home for inspection; default removes it.

New `bakin onboard` flags: `--runtime pi|openclaw`, and `--no-recommended`,
which marks `recommended-plugins`, `recommended-agents` and `capabilities`
as declined without running them (no install-request change). Arbitrary id
lists are deferred.

## Project Structure

```
src/core/onboarding/
  index.ts              orchestrator: phased run, declared requirements, complete JSON, write-free check
  types.ts              `requires`, typed skip reasons, outcome model
  runtime-choice.ts     NEW  D2/D3 decision table (pure)
  runtime.ts            becomes installable: install = provision an empty roster
  credentials.ts        llm guided step; copy from the ACTIVE adapter's support entry
  settings.ts           install persists the chosen adapter
  install-request.ts    `runtimeAdapter` option on the settings install
  setup-checklist.ts    NEW  the one checklist engine (D7)
packages/adapter-pi/src/, packages/adapter-openclaw/src/
                        each exports a read-only presence probe
src/core/runtime-adapter-factory.ts   `detectRuntimes()`; per-adapter setup/login copy
src/core/cli/onboarding-interactive.tsx   runtime screen, credentials wait screen, phased prompts
src/core/cli/ui/onboarding.tsx            finish screen renders the checklist
src/cli/commands/onboarding.ts            new flags; check/install targets derived from COMPONENT_ORDER
scripts/onboard-rig.ts                    NEW  local rig entry
tests/integration/onboarding/             NEW
  harness.ts                              home builder, env allowlist, spawn, JSON parsing, cleanup
  harness.test.ts                         teeth: the isolation guarantees bite
  scenarios/*.test.ts
tests/core/onboarding/                    unit tests for new pure modules
docs/src/content/docs/start/first-time-setup.mdx, README.md
.claude/knowledge/onboarding.md           NEW  deep reference; CLAUDE.md Onboarding bullet updated
```

## Design

### 1. Outcome model

Every component produces exactly one outcome and, under `--json`, exactly
one line. A final `{"summary": …}` line carries `exitCode`, `markerWritten`
and `runtime: { adapter, source }`.

```
status: 'ok' | 'warn' | 'skipped' | 'error'
reason (when skipped): 'not_applicable' | 'declined' | 'requires' | 'check_only' | 'unavailable'
requires (when reason = 'requires'): the component name that was not satisfied
code   (when reason = 'unavailable'): a typed detail, e.g. 'no_runnable_model', 'no_proven_model'
```

`unavailable` means the step has nothing it can do right now and it is
nobody's refusal (today's model-plan skips). It counts like a warning.

- Exit code: 1 when any outcome is `error` or skipped for `requires`;
  otherwise 2 when any is `warn`, or skipped for
  `declined`/`check_only`/`unavailable`; otherwise 0. `not_applicable` never affects the exit code.
- Marker: written iff exit code is not 1 and the run is not `--check`.
- `ONBOARDING_VERSION` is not bumped (a bump would un-onboard every existing
  home on upgrade); the marker's `components` record simply gains names.
- Consumers read `status`/`reason`, never message text.
- A runtime refusal (§2) emits no component lines, only the summary:
  `{"summary":{"exitCode":1,"markerWritten":false,"runtime":{"refused":"<code>","found":[…]}}}`.

### 2. Runtime choice (D2, D3)

"Stored adapter" means the settings override file contains a supported
`runtime.adapter`. An absent file, a zero-byte file, `{}` and a file
without that key are all "undecided" (the zero-byte file is reseeded by the
settings install, as today). A file that is not JSON, fails the settings
schema, or stores an unsupported adapter value is the `settings`
component's `broken` state: the run stops before any choice (exit 1,
nothing written).

Flag and environment validation run before the already-onboarded shortcut,
so `--runtime` that conflicts with a stored adapter refuses even on an
onboarded home; without a conflict the shortcut answers as today.

Detection is read-only and adapter-owned: each adapter package exports a
presence probe (Pi: its agent directory exists; OpenClaw: its home holds a
config file), composed by `detectRuntimes()` in the factory. Result order is
fixed: `['openclaw', 'pi']`. "Interactive" means stdin and stdout are both
terminals and none of `--yes`, `--json`, `--check` is set.

`decideRuntime` is pure and evaluated in this order:

| # | Condition | Result |
|---|---|---|
| 1 | `--runtime` or `BAKIN_RUNTIME_ADAPTER` value is not a supported adapter | refuse `invalid_runtime` (the env value is no longer silently ignored here) |
| 2 | `BAKIN_RUNTIME_ADAPTER` set, `--runtime` absent or equal | that adapter, source `env`, **never persisted** |
| 3 | `BAKIN_RUNTIME_ADAPTER` set, `--runtime` differs | refuse `runtime_conflict` |
| 4 | Stored adapter, `--runtime` absent or equal | stored, source `existing` |
| 5 | Stored adapter, `--runtime` differs | refuse `runtime_already_set` (message names `bakin runtime use`) |
| 6 | `--runtime` given | that adapter, source `flag` |
| 7 | Nothing found | `pi`, source `default` |
| 8 | Interactive, one or both found | `ask` (choices: every supported adapter, found ones marked, the first found preselected) |
| 9 | Not interactive, exactly one found | that adapter, source `detected` |
| 10 | Not interactive, both found | refuse `ambiguous_runtime` (message names `--runtime`) |

Every refusal exits 1 before any write. The function returns `ask` as its
own result; it never picks on the operator's behalf.

Persistence: sources `flag`, `default`, `asked`, `detected` are written
once, by the `settings` component's install, which gains a `runtimeAdapter`
option in the shared install request (so server-mode and in-process installs
carry the same value). The settings check reports `missing` with
`details.runtimeUndecided` when the file lacks the key, so an `initBakinHome`
`{}` scaffold still triggers the install. This is first-time configuration,
never a runtime switch.

The decision made before the install is a proposal; the commit is inside
the settings operation. The `settings` component now owns `install-state`,
and `runtimeAdapter` is part of the operation's identity. Inside the
operation it rereads the stored adapter and the live server's adapter (via
this home's `server.lock`): an adapter stored meanwhile that differs fails
the operation `runtime_already_set`; a live server on a different adapter
fails it `server_running_other_runtime`. Services are composed only after
the commit, from the committed value. Two concurrent undecided runs
therefore produce one winner and one refusal.

Every run whose decision has `persist: true` enters this operation, even
when the `settings` check is already `ok` (the generic "check ok, skip the
install" rule does not apply to a pending runtime proposal). A stored value
equal to the proposal is a no-op; a different one fails as above.

Under `--check` the decision is computed and reported but never persisted.
A resolvable decision is applied process-scoped for the checks (the same
mechanism as the env override); a refusal is reported as the `runtime`
outcome and runtime-dependent checks are skipped for `requires`. The
`settings` outcome then reports `check_only` with
`details.runtimeUndecided`, which does not block its dependents (§4).

### 3. Runtime and credentials are two facts (D8, D11)

- **`runtime`** = the adapter initializes, the roster is readable, and
  roster integrity passes. It becomes an installable component: its install
  (one stage, owns `install-state`) calls `provisionToolAccess()` when the
  roster is empty. That replaces `runRuntimeInline` and the wizard's direct
  provisioning call. `bakin check runtime` stays read-only.
- **`llm`** = `credentialStatus().llmProviders` is non-empty. Check-only,
  warn-only, requires `runtime`.
- **Reachability** is part of `runtime` and is decided by the adapter's
  declared tool-access style, an existing contract fact
  (`describeToolAccess().style`): an `in-process` runtime is reachable once
  it initializes; any other style must answer `ping()`. So a stopped
  OpenClaw gateway always fails `runtime`, with or without credentials, and
  Pi without a login does not. No contract change.
- Empty roster: the install provisions, then re-validates. A roster that is
  still empty or fails integrity afterwards is an `error` with the active
  adapter's remediation (on OpenClaw provisioning creates no agents, so an
  empty OpenClaw roster stays the operator's to fix).

All copy (setup URL, docs URL, login instructions) comes from the ACTIVE
adapter's `RUNTIME_ADAPTER_SUPPORT` entry. An architecture test bans
`DEFAULT_RUNTIME_ADAPTER_SUPPORT` under `src/core/onboarding/` and the CLI
onboarding UI. "No OpenClaw wording on Pi" excludes stable identifiers such
as the `openclaw-integration` component name.

### 4. Declared requirements (D8)

`requires` lists component names. A requirement is satisfied when that
component finished `ok` or `warn`, or was skipped as `not_applicable`.
Otherwise the dependent is skipped with `reason: 'requires'`. This replaces
both hand-written cascades.

Under `--check` nothing is installed, so a second rule applies: `mkdir` and
`settings` declare `usableWhenMissing`, because built-in defaults plus the
process-scoped runtime decision make their dependents checkable before
anything is written. A `missing` check on such a component satisfies its
dependents; `broken`/`error` never does. Every other component must check
`ok` or `warn` to satisfy a dependent under `--check`.

| Component | Kind | Requires | Why |
|---|---|---|---|
| mkdir | install | — | |
| settings | install | mkdir | |
| runtime | install | settings | adapter choice lives in settings |
| llm | check | runtime | reads `credentialStatus()` |
| search | install | settings | |
| search-models | install | search | pulls with the engine |
| media | install | mkdir | |
| openclaw-integration | install | runtime | OpenClaw only; `verifyToolAccess` |
| plugin-assets | install | runtime | reads/writes `runtime.skills` |
| agent-sync | install | runtime | composes workspace files |
| models | install | runtime | runtime catalog; self-skips with zero candidates |
| budget | check | settings | |
| channels | check | runtime | native delivery reads runtime channel config |
| recommended-plugins | install | runtime | plugin installs project skills into the runtime |
| recommended-agents | install | runtime | creates/adopts runtime agents |
| capabilities | install | runtime | readiness reads `runtime.skills`; installs write it |

The order in `COMPONENT_ORDER` changes so `llm` follows `runtime`. An
architecture test asserts every `requires` entry names an earlier component.
The plan re-confirms `models` and `channels` by reading each component; a
row that turns out not to need the runtime is relaxed to `settings`.

### 5. Run phases

The interactive run is phased so the credentials wait sits between
operations and never holds a lock:

1. Decide the runtime (ask if the table says `ask`).
2. Run `mkdir`, `settings`, `runtime` (operations).
3. Check `llm`. Interactive and not ok: show the runtime's login
   instructions; Enter rechecks, `s` skips (outcome `warn`). No operation is
   open and `install-state` is not held while waiting.
4. Collect the remaining approvals (search, models, media, model plan,
   plugins, agents) from fresh checks.
5. Run the remaining components.
6. Finish screen: outcomes + checklist.

Non-interactive runs do the same without steps 3's wait and 4's prompts.
`--force` clears the marker and replays every check; components stay
idempotent (it re-installs nothing that checks ok).

### 6. Write-free `--check`

`bakin onboard --check` performs no mutation: no marker write, no marker
clear, no provisioning, no settings write, no install. `--check --force` is
a usage error (exit 1).

Normal composition is not changed: `createAppServices()` keeps migrating
secrets and provisioning search for the server and for installs. Checks get
their own composition, built on `createReadOnlyAppServices()`: the runtime
adapter is initialized (its `initialize()` is write-free by conformance
pin), search is constructed and never initialized, no secret migration, no
health registration. Evidence reads in a check never create a store: an
absent usage database reads as "no evidence", not as a new file. `bakin
check <x>` uses the same composition.

The harness proves it by snapshotting `BAKIN_HOME`, the Pi home, the
OpenClaw home and `HOME` before and after (excluding `logs/`), including on
a home with no usage database and on one with legacy un-migrated secret
settings. The existing unit test that expects a marker write under check is
rewritten.

### 7. Setup checklist (D7)

`getSetupChecklist()` projects existing readiness engines; it adds no
probing of its own. Item state is `done | todo | unknown` (`unknown` when
the source engine throws or cannot answer without a server).

| Item | Source | done | todo | unknown | omitted |
|---|---|---|---|---|---|
| Log in to the runtime | `credentialStatus()` | at least one LLM provider | none | the call throws | — |
| Search | the search adapter's own service-access projection (ownership stays adapter-owned) + engine check | engine present and this home owns the service | engine missing; service unclaimed or owned by another home (command: `bakin install search`) | unknown owner; a service change is in progress | external endpoint or temporary home |
| Channels | channel readiness projection | connected, or configured and waiting for the server | Discord disabled, missing token or missing server ID (href: Settings → Channels) | readiness needs a server and none runs | the runtime delivers natively |
| Capability keys (one per installed capability) | capability readiness, key leg | key present | key missing | manifest invalid or readiness throws | capability declares no key |
| Model plan | `models` component check | plan persisted and its check is ok | no plan and candidates exist; persisted plan whose check is `warn` or `missing` (unusable lane, or nothing in it can run any more) | the check errors | no plan and no candidates (covered by the login item) |

Two static lines are appended and carry no state: "Run `bakin start`" (when
no server runs for this home) and "Browse Explore for agents and plugins".
The CLI finish screen and `bakin onboard --check` render the same list.

### 8. CLI targets

`bakin check <x>` accepts every component; `bakin install <x>` every
installable one. Both lists and their unknown-subcommand hints derive from
`COMPONENT_ORDER`; an architecture test fails when they diverge.

### 9. Harness

Each scenario spawns `bun cli/bakin.ts onboard …` as a child process. This
is a documented exception to the mock-the-resolvers rule, on the same
footing as `tests/sdk-testing/`: the test process imports no app module and
isolation is the child's environment.

**Environment allowlist.** Every Bun process is spawned with
`--no-env-file`, so dotenv files in the checkout cannot re-inject
variables. The child gets only: `PATH` (prefixed with a shim directory,
below), `TMPDIR`, `HOME`, `BAKIN_HOME`, `PI_HOME`, `PI_CODING_AGENT_DIR`,
`OPENCLAW_HOME`, the proxy and git variables below, and per-scenario
additions. Nothing is inherited, so `BAKIN_URL` (injected by the test
preload), `BAKIN_RUNTIME_ADAPTER`, `ANTFLY_HOME`, `ANTFLY_PATH` and any
operator runtime override cannot leak in.

The guarantee is resolver isolation: every path Bakin resolves through its
home resolvers lands in the temp tree. The harness does not sandbox the
filesystem and does not claim to detect a read of an arbitrary absolute
path.

**Search isolation.** The scaffold `settings.json` carries a guest search
URL and no `runtime` key, so the engine is treated as external and the
runtime is still undecided. The guest URL is the effective protection:
service access returns before any native-supervisor inspection.
(`BAKIN_SEARCH_SERVICE_MODE=child` is not used; it does not suppress that
inspection.) A shim directory first on `PATH` provides
`launchctl` and `systemctl` stand-ins that record their arguments and exit
non-zero; every scenario asserts the record is empty.

**Process hygiene.** Dynamic ports for scenarios that boot a server; the
`server.lock` lives in the temp home; each child has a deadline; the harness
kills the child's process group and waits for exit before removing
directories.

**Network.** Scenarios pass `--no-recommended` unless they exercise the
recommended installs. The harness runs a recording deny proxy: a local
listener that logs every request or CONNECT and answers 403. The child gets
`HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy` (git's HTTP
transport reads the lowercase form) pointing at it, `NO_PROXY`/`no_proxy`
listing only the scenario's own fixture endpoints, and git restricted with
`GIT_ALLOW_PROTOCOL=file`, `GIT_CONFIG_GLOBAL=/dev/null`,
`GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0` (so ssh/git transports
are refused, not bypassed). A scenario fails when the proxy recorded
anything, whatever the child's exit status.

**Coverage limits (stated, not hidden).** With a guest search URL the
engine and model steps are external no-ops, and a source run skips the media
install. Those paths are covered by the real-home pass (engine, models,
service claim) and the existing compiled-binary media test.

**Teeth** (`harness.test.ts`): a child that calls `launchctl`, fetches an
outside URL, or runs a git clone over https or ssh is detected; an injected
`BAKIN_URL` and a variable planted in a checkout `.env` do not reach the
child; the home resolvers inside the child answer inside the temp tree.

Scenario matrix (minimum):

| Scenario | Expect |
|---|---|
| Fresh home, nothing found | Pi, source `default`, persisted; `llm` warn; marker written; exit 2 |
| Fresh, Pi found + auth | Pi, `detected`; marker; exit 0 or 2 by declined steps |
| Fresh, Pi found, no auth | `runtime` ok, `llm` warn with Pi instructions; no OpenClaw wording; marker |
| Fresh, OpenClaw found, gateway up (mock) | OpenClaw, `detected`; marker |
| Fresh, OpenClaw found, gateway down | `runtime` error; dependents skipped `requires: runtime`; `search`/`media` still run; exit 1; no marker |
| Both found, `--yes` | exit 1 `ambiguous_runtime`; homes byte-identical |
| Both found, `--runtime pi` | Pi, `flag` |
| `--runtime bogus` | exit 1 `invalid_runtime`; nothing written |
| Stored adapter, `--runtime` differs | exit 1 `runtime_already_set` |
| `BAKIN_RUNTIME_ADAPTER` set | used, not persisted |
| Settings absent / `{}` / zero-byte / not JSON / unsupported stored adapter | choice persisted for the first three; the last two → exit 1, untouched |
| `BAKIN_RUNTIME_ADAPTER=bogus` | exit 1 `invalid_runtime` |
| Onboarded home, `--runtime` differs from stored | exit 1 `runtime_already_set` (before the already-onboarded shortcut) |
| Two concurrent undecided runs with different `--runtime` | one commits, the other fails `runtime_already_set`; one adapter on disk |
| OpenClaw found, gateway down, no credentials | `runtime` error (not an `llm` warning) |
| OpenClaw found, empty roster | provisioned, still empty → `runtime` error |
| No runnable model | `models` skipped `unavailable` / `no_runnable_model`; exit 2; marker written |
| `--no-recommended` | the three components skipped `declined`; proxy log empty |
| Broken roster (duplicate ids) vs empty roster | broken → error, never provisioned; empty → provisioned |
| `--check` on fresh and on onboarded homes | zero writes |
| `--check --force` | usage error |
| Rerun after success | `already_onboarded`, exit 0 |
| `--force` | marker cleared, full replay, idempotent |
| Old-version marker, corrupt marker | treated as not onboarded; rerun completes |
| A component install fails | that outcome `error`, later independent steps still run, exit 1, no marker, rerun resumes |
| Interrupt (in-process, and detached from a server run) then rerun | exit 130, then completes |
| Stale `install.lock` / concurrent second `bakin onboard` | waits visibly or refuses with `install_busy`; never corrupts |
| Server running vs not | same outcomes through both operation modes |
| `BAKIN_URL` set | refused with the existing message |
| JSON completeness | one line per component incl. not-applicable, plus summary |

In PR 1, scenarios that today's code fails are committed as `test.failing`
with a comment naming the PR that flips them, so the harness lands green.

## Code Style

Repo conventions (CLAUDE.md): pure functions, zod at boundaries, typed
reasons never message parsing, `createLogger`, no empty catches.

```typescript
export type RuntimeDecision =
  | { kind: 'use'; adapter: RuntimeAdapterName; source: 'env' | 'existing' | 'flag' | 'default' | 'detected'; persist: boolean }
  | { kind: 'ask'; choices: readonly RuntimeChoice[]; preselected: RuntimeAdapterName }
  | { kind: 'refuse'; code: 'invalid_runtime' | 'runtime_conflict' | 'runtime_already_set' | 'ambiguous_runtime' }

export function decideRuntime(input: RuntimeDecisionInput): RuntimeDecision
```

## Testing Strategy

- **Unit** (`tests/core/onboarding/`): the decision table (every row),
  requirement skipping, exit-code and marker rules, checklist projections,
  per-adapter copy. Repo mock rules apply.
- **Integration** (`tests/integration/onboarding/`): the matrix and the
  harness teeth.
- **Adapter**: presence probes in each adapter's own test directory.
- **Render tests** (`tests/cli/`): runtime screen, credentials wait screen,
  finish checklist.
- **Architecture**: CLI targets derive from `COMPONENT_ORDER`; `requires`
  names earlier components; no default-adapter copy in onboarding.
- **Real-home pass** (manual, this Mac, PR 5): wipe → onboard on Pi from
  source with a throwaway Pi home → `bakin install search` (real claim) →
  `bakin start` → doctor → teardown (home, launchd unit, `~/.antfly`,
  throwaway Pi home). Evidence in `tasks/evidence-onboarding-real-home.md`.
- Every bug fix lands with the scenario or unit test that failed first.

## Boundaries

- **Always:** throwaway homes and the env allowlist for anything automated;
  gates run bare (never piped); full build chain before a commit that
  touches built artifacts; docs and knowledge updated in the PR that changes
  behaviour.
- **Ask first:** deleting `~/.bakin`, the launchd unit or `~/.antfly` (once,
  at the real-home pass, even though D1/D10 approve it in principle); any
  new dependency; changing CI workflow files; raising a perf ceiling by more
  than a few KB; changing the runtime adapter contract.
- **Never:** write to `~/.pi` or `~/.openclaw`; let a test reach the real
  home, the machine-global search unit or the network; hold `install-state`
  while waiting on the operator; classify by message text; add browser UI.

## Commit / PR strategy

Stacked branches off `main`, each PR green and revertable alone:

1. `test(onboarding): fresh-home scenario harness and local rig`
2. `fix(onboarding): …` one commit per bug with its test (write-free
   `--check`, complete JSON, exit-code rule, others the harness finds)
3. `feat(onboarding): runtime detection, choice and declared requirements`
4. `feat(onboarding): guided credentials step with runtime-aware copy`
5. `feat(onboarding): setup checklist, finish screen, CLI targets, docs`

The per-commit breakdown comes with the plan.

## Success Criteria

- `bun test tests/integration/onboarding --isolate` passes with zero
  `test.failing` left, inside `bun run test:ci`.
- A fresh home with no runtime onboards onto Pi, installs everything, writes
  the marker and ends with one clear "log in" action.
- An unreachable runtime installs only the runtime-free steps and exits 1
  with no marker.
- Both runtimes present and no flag under `--yes` changes nothing on disk.
- `bakin onboard --check` leaves every home byte-identical (logs excluded).
- Under `--json`, every component has exactly one line plus a summary.
- No onboarding output on Pi mentions OpenClaw outside component ids.
- Every component has a `bakin check` target.
- The real-home pass completes and this Mac is clean afterwards.
- `first-time-setup.mdx`, README, CLAUDE.md and
  `.claude/knowledge/onboarding.md` describe the shipped behaviour;
  `bun run docs:check` passes.

## Open Questions

- Is there an existing verb to remove the search OS service, or is teardown
  a documented `launchctl bootout` (resolved before the real-home pass).

## Review log

Round 1 (Codex `gpt-6-astra`, high, 2026-11-11): REVISE.

| # | Finding | Resolution |
|---|---|---|
| 1 | Fresh-home bootstrap contradicts itself (`{}` scaffold, prewritten settings) | §2: "undecided" = no stored `runtime.adapter`; settings install persists it; scaffold carries no runtime key |
| 2 | Precedence contradictory/incomplete | §2 ten-row table incl. env, conflicts, invalid flag, fixed order, TTY rule, explicit `ask` |
| 3 | Credentials cannot repair their own prerequisite | §3 split facts; §5 phases |
| 4 | Dependency list wrong and coarse | §4 full table |
| 5 | Read-only check needs a design | §6 |
| 6 | New mutations lack an operation contract | §2 persistence via settings install option; §3 runtime install; §5 no lock while waiting |
| 7 | Harness isolation under-specified | §9 allowlist, shims, hygiene, teeth, documented exception |
| 8 | Real-home pass violates D1 | D10 re-decided: throwaway Pi home, copied login |
| 9 | Network paths uncovered | §9 selection flags, dead proxy, stated limits |
| 10 | Detection crosses the adapter boundary | §2 adapter-exported probes |
| 11 | Checklist not implementable consistently | §7 projections and states; route + dismissals cut to the UI spec |
| 12 | Matrix omits outcome/recovery cases | §9 matrix; §1 exit/JSON/marker rules, no version bump |

Round 2 (Codex `gpt-6-astra`, high, 2026-11-11): REVISE. Round-1 status:
1, 4, 8, 10, 12 resolved; 2, 3, 5, 6, 7, 9, 11 partial (closed by the rows
below).

| # | Finding | Resolution |
|---|---|---|
| N1 (P1) | Runtime success conflates adapter semantics | §3 reachability by tool-access style; provision then re-validate |
| N2 (P1) | Write-free composition would change server boot | §6 dedicated check composition; non-creating evidence reads |
| N3 (P1) | First-time choice not protected against concurrent runs | §2 commit inside the settings operation under `install-state` |
| N4 (P1) | Fresh `--check` cannot run runtime checks | §4 `usableWhenMissing`; §2 `--check` paragraph |
| N5 (P1) | Child environment not closed | §9 `--no-env-file`; claim narrowed to resolver isolation |
| N6 (P1) | Dead proxy neither blocks nor detects | §9 recording deny proxy, lowercase vars, git restrictions |
| N7 (P2) | Decision-table edge cases | §2 zero-byte/invalid classification, refusal JSON (§1), shortcut precedence |
| N8 (P2) | Checklist can report false completion | §7 full state mapping |
| N9 (P2) | Skip taxonomy cannot represent model outcomes | §1 `unavailable` with typed codes |
| N10 (P3) | Cut arbitrary selection lists | `--no-recommended` only |

Round 3 (Codex `gpt-6-astra`, high, 2026-11-11, confirmation pass): REVISE
on one point. N1, N2, N4-N7, N9, N10 resolved. N3 partial: a settings
check that is already `ok` skipped the commit guard → §2 now sends every
persistent proposal through the locked operation (revision 4). N8 partial:
persisted plan with zero candidates → §7 row extended (revision 4).

Round-2 corrections applied: Pi `ping()` is initialization plus credentials;
capability readiness reads `runtime.skills`; plugin installs need skill
projection; the guest URL (not child mode) is the search protection; Bun
honours uppercase proxy variables, git HTTP needs lowercase.
