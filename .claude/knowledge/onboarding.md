# Onboarding

`bakin onboard` takes a machine from nothing to a home Bakin can start on.
Code: `src/core/onboarding/` (components and the orchestrator),
`src/cli/commands/onboarding.ts` (the command), `src/core/cli/onboarding-interactive.tsx`
and `src/core/cli/ui/onboarding.tsx` (the terminal wizard). Spec and plan for
the current hardening work: `.claude/specs/onboarding-hardening.md`,
`.claude/specs/onboarding-hardening-plan.md`.

## Outcomes

Every component ends as `ok`, `warn`, `skipped` or `error`. A skip always
carries a typed `reason`; consumers read it (and `code`), never the message:

| `reason` | Meaning |
|---|---|
| `not_applicable` | The step does not exist on the active runtime |
| `declined` | Not approved (the operator said no, or there was no `--yes`) |
| `requires` | A step it needs did not finish; `requires` names it |
| `check_only` | `--check` found work and did not do it |
| `unavailable` | Nothing the step can do right now and nobody refused it; `code` says what is missing (`no_runnable_model`, `no_proven_model`, `existing_plan`, `no_prebuilds`) |

Under `--json` every component prints exactly one line, including one that
does not apply (`not_applicable`), and the last line is
`{"summary":{"exitCode":…,"markerWritten":…,"runtime":{"adapter":…,"source":…}}}`
(`src/core/onboarding/summary.ts`; `source` is `env`, `existing` or
`default`).

Exit code (`exitCodeFor` in `index.ts`): 1 when any step is `error`; else 2
when any step is `warn` or skipped for a reason other than `not_applicable`;
else 0. A `requires` skip never decides the code by itself: its cause is
upstream. The marker is written when the code is not 1 and the run is not
`--check`.

An install returns `reason` (`declined` or `unavailable`) with its skip; one
that gives none is treated as `declined`. An install that fails for a reason
a caller must tell apart sets `code`, and the operation settles with it
(`result.code ?? component.failureCode ?? 'component_failed'`).

## What stops what

Each component declares `requires`: the components it cannot run without
(`src/core/onboarding/types.ts`; the table is pinned by
`tests/core/onboarding/requirements.test.ts`). A requirement is satisfied
when that component ended `ok` or `warn`, or does not apply to the active
runtime. Otherwise the dependent is skipped with reason `requires`, names
what it was waiting for, and is never checked or installed.

| Component | Requires |
|---|---|
| mkdir | — |
| settings | mkdir |
| runtime | settings |
| search | settings |
| search-models | search |
| media | mkdir |
| budget | settings |
| llm, openclaw-integration, plugin-assets, agent-sync, models, channels, recommended-plugins, recommended-agents, capabilities | runtime |

So a runtime that cannot be reached skips only the steps that need one;
search, its models, media and the spend check still run. There are no
hand-written cascades left.

Under `--check` nothing is installed, so `mkdir` and `settings` also declare
`usableWhenMissing`: a check that merely finds them `missing` does not block
what comes after (built-in defaults make the rest checkable). A `broken`
one still does.

## Checks change nothing

`bakin onboard --check` and `bakin check <x>` create no file, run no
migration, write no marker and provision nothing. `--check --force` is a
usage error. The harness proves it by snapshotting the Bakin, Pi and
OpenClaw homes and `HOME` around a check on five home shapes
(`scenarios/check-readonly.test.ts`).

How it holds:

- The CLI composes `createCheckAppServices()` (`src/core/app-services.ts`)
  before any component runs. Components reuse whatever services exist, so
  none of them reaches for the normal composition, which migrates a legacy
  search password and provisions search.
- That composition puts every SQLite store in the process into read-only
  mode (`setStorageReadOnly`, `packages/core/src/storage/db.ts`). An absent
  store raises `StorageAbsentError`; evidence readers that mean "nothing
  recorded yet" wrap themselves in `emptyWhenAbsent` (usage history, probe
  successes, model rejections). An existing store is opened immutable when
  it has no pending write-ahead log, and read through the log otherwise
  (SQLite then maintains the `-shm` index; the database and log are never
  written). A reader nobody listed shows up as a check error, not a write.
- The runtime adapter is initialized with `readOnly: true`
  (`AdapterInitOpts`). Pi uses a stand-in catalog store, because the SDK's
  file-backed one creates `models-store.json` on first read.
- OpenClaw tool access is verified with `readMcpCredential`, which never
  creates `mcp-secret`. With no secret, tool access reads as not provisioned.
- The orchestrator never writes or clears the marker under `checkOnly`, and
  an empty roster is reported as `skipped` / `check_only`, not provisioned.

The server never uses the check composition: read-only storage is a
process-wide switch, and health checks inside a server run on the normal
services.

## Testing onboarding

Onboarding is tested by running the real CLI in a child process against a
throwaway home. Nothing is mocked; isolation is the child's environment.

### The harness (`tests/integration/onboarding/`)

| File | What it is |
|---|---|
| `harness.ts` | Builds a home, runs `bun --no-env-file cli/bakin.ts …` (or the server) under a closed environment, snapshots trees, asserts isolation |
| `fixtures.ts` | What a Pi home and an OpenClaw home look like on disk, plus the OpenClaw gateway and CLI stand-ins |
| `probe-resolvers.ts` | Run as a child: prints where every home resolver points |
| `harness.test.ts` | The teeth: each isolation claim is shown to bite |
| `scenarios/kit.ts` | `onboard()`, `outcomes()`, `summary()`, `readMarker()` |
| `scenarios/*.test.ts` | The scenario matrix |

One home is one temp tree holding the Bakin home, the Pi home, the OpenClaw
home, the search engine's home and `HOME`. The child's environment is an
allowlist built from nothing, so the suite preload's `BAKIN_URL`, a dotenv
file, and a developer's shell cannot reach it.

The scaffold `settings.json` pins a guest search URL (a non-default URL
keeps the search adapter from ever inspecting or provisioning the machine's
search service) and a dead OpenClaw gateway port (the default, 18789, may be
a real gateway on a developer machine). It stores no `runtime.adapter`.

Two recorders watch every child and a scenario fails when either holds
anything:

- `launchctl` / `systemctl` stand-ins, first on `PATH`, record the call and refuse.
- A deny proxy receives every HTTP(S) request to anything but the
  scenario's own declared endpoints (`home.allowEndpoint`), logs it and
  answers 403. There is no blanket localhost exemption. Git is confined to
  local files, so ssh and git transports are refused by git itself.

Rules for adding a scenario:

- Create homes through `trackHomes()` and call `homes.finish()` in
  `afterEach`. That is where isolation is asserted.
- Run with `--json` and without `--yes` unless the scenario is about the
  recommended installs: `--json` alone is non-interactive and approves
  nothing, so nothing is fetched.
- A scenario that pins a known gap uses `expectedGap(homes, body)` as the
  test function of a plain `test`, and names the task that will fix it in
  its title. Never use `test.failing` here: under bun 1.4.3 an `afterEach`
  that throws after a `test.failing` body counts as a pass, so an isolation
  breach would go green. When the gap is fixed, the scenario becomes a plain
  test in the same commit (a pinned gap whose body passes fails on purpose).
- `ONBOARDING_GAP_REASONS=1 bun test tests/integration/onboarding --isolate`
  prints why each pinned gap fails. Check it after writing one: a pinned gap
  must fail for the reason it pins, not for a typo.
- A scenario that starts without the scaffold (absent, empty or unreadable
  settings) runs on the product's default endpoints. Call
  `home.blackholeProductDefaults()`: those requests are still denied by the
  proxy but are not counted as a breach.
- Server-mode scenarios boot the real server with `startServer(home)`. That
  needs the built browser assets (`bun run build:host && bun run
  build:plugins && bun run build:assets-manifest`), as CI does before tests.

What the harness does not cover, by design: with a guest search URL the
engine and model steps are external no-ops, and a source run never installs
the media bundle. Those paths belong to the real-home pass and the
compiled-binary media test. The OpenClaw adapter also falls back to
`/opt/homebrew/bin/openclaw` and `/usr/local/bin/openclaw` when nothing else
resolves; the harness sets `OPENCLAW_PATH` to a stand-in inside the tree,
which wins.

### The local rig (`bun run onboard:rig`)

Runs the real wizard in your terminal against a throwaway home built by the
same harness. Flags: `--runtime none|pi|openclaw|both`, `--auth
none|fake|copy`, `--stored <adapter>`, `--keep`, `--home <dir>`,
`--network`; everything after `--` goes to `bakin onboard`. It prints what
the run wrote, any refused supervisor call or denied request, and confirms
that the real `~/.bakin`, `~/.pi`, `~/.openclaw`, `~/.antfly` and the search
service unit are unchanged. `--auth copy` only reads `~/.pi/agent/auth.json`.
