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

## Phases

A run has two phases (`runOnboard` in `index.ts`):

1. **Bootstrap**: `mkdir`, `settings`, `runtime` (`BOOTSTRAP_COMPONENTS`).
   They need no answers from the operator. An empty roster is provisioned
   here.
2. **The rest**, in `COMPONENT_ORDER`.

Between them the orchestrator calls `phases.afterBootstrap(outcomes)` once.
The CLI uses it to run the wizard: the questions are asked from fresh
checks, on a home that exists and a runtime that is already provisioned,
and the answers (`OnboardingSelections`) apply to the rest of the run. The
wizard never checks or provisions the runtime itself; when the bootstrap
phase could not get one ready it asks nothing and the run reports why. A
throw from the boundary (the operator left the wizard with Ctrl-C) stops
onboarding there: nothing after the bootstrap runs, no marker is written,
exit 130.

## Choosing the runtime

A home that stores no runtime decides one before anything else runs
(`src/cli/onboard-runtime.ts` → `decideRuntime` in
`src/core/onboarding/runtime-choice.ts`, a pure table over four facts):

| # | Situation | Result |
|---|---|---|
| 1 | `--runtime` or `BAKIN_RUNTIME_ADAPTER` names an unsupported runtime | refuse `invalid_runtime` |
| 2 | `BAKIN_RUNTIME_ADAPTER` set (flag absent or equal) | that runtime, source `env`, never stored |
| 3 | `BAKIN_RUNTIME_ADAPTER` set, `--runtime` differs | refuse `runtime_conflict` |
| 4 | A runtime is stored (flag absent or equal) | the stored one, source `existing` |
| 5 | A runtime is stored, `--runtime` differs | refuse `runtime_already_set` |
| 6 | `--runtime` given | that runtime, source `flag`, stored |
| 7 | Nothing found on the machine | Pi, source `default`, stored |
| 8 | A person is at the terminal and something was found | ask (source `asked`, stored) |
| 9 | Scripted, exactly one found | that runtime, source `detected`, stored |
| 10 | Scripted, more than one found | refuse `ambiguous_runtime` |

- "Found" is each adapter's own read-only presence probe (Pi: its agent
  directory exists; OpenClaw: its home holds a config file), composed by
  `detectRuntimes()` in the factory, always in the order `openclaw`, `pi`.
- "A person is at the terminal" means stdin and stdout are terminals and
  none of `--yes`, `--json`, `--check` was given.
- A refusal exits 1 before any write, and before the already-onboarded
  shortcut. Under `--json` it prints only
  `{"summary":{"exitCode":1,"markerWritten":false,"runtime":{"refused":"<code>","found":[…]}}}`.
- A choice that is not already stored or in the environment is applied to
  the process (the same mechanism as the environment override), so every
  check and install composes the chosen runtime. When it is to be stored,
  it is handed to the run as `runtimeProposal` and committed by the
  settings step (below) — even when the settings check is already ok.
- Nothing is chosen on top of a settings file that cannot be trusted; the
  settings step reports the file and the run stops there.
- Onboarding never switches a stored runtime. That is `bakin runtime use`.

Upgrade note: a home onboarded before this stored no runtime and ran on
the built-in default (OpenClaw). `bakin onboard` on it still answers
"already onboarded". `bakin onboard --force` now decides like a first run,
so on a machine with both runtimes set up a scripted `--force` needs
`--runtime openclaw`.

## The settings step

`settings.ts` gates everything that reads `getSettings()` and is where a
first-run runtime choice is committed.

- `inspectSettingsFile()` reads the file strictly (the file as it is, not
  the merged defaults): `absent`, `empty` (zero bytes), `readable` (with the
  supported runtime it stores, if any) or `untrustworthy` (unreadable, not
  JSON, not an object, or naming a runtime Bakin does not support).
- **It never writes over a file it cannot trust.** `untrustworthy` is a
  check `error` and an install failure (`settings_untrustworthy`); the
  bytes are left alone. Before this, an unparseable file was silently
  reseeded. A zero-byte file is still reseeded.
- **The runtime commit.** The install takes an optional `runtimeAdapter`
  (part of the operation's identity) and owns `install-state`. Inside the
  operation it re-reads what is stored: nothing stored → the proposal is
  written; the same value → nothing to do; a different one → fails
  `runtime_already_set`. In a server process it also compares the adapter
  that server bound at boot and fails `server_running_other_runtime` when
  they differ. So two runs deciding at once produce one winner and one
  refusal, and onboarding never switches a runtime.

## Runtime and credentials are two facts

- **`runtime`** (`runtime.ts`): the adapter initializes, is reachable, and
  its roster passes integrity. Reachability follows how the runtime's
  agents reach Bakin's tools (`describeToolAccess().style`): an in-process
  runtime (Pi) is reachable once it initializes; any other (OpenClaw's
  gateway) must answer `ping()`. Credentials play no part. So Pi without a
  login is a working runtime, and a stopped gateway is a broken one with or
  without credentials.
- **`llm`** (`credentials.ts`): at least one provider has usable
  credentials. Check-only, warn-only, requires `runtime`, and runs right
  after it.

`runtime` is installable. Its check reports `error` for everything the
operator has to fix outside Bakin (cannot initialize, cannot be reached,
roster unreadable or inconsistent) and `missing` for the one thing
onboarding sets up: a runtime with no agents yet. The install provisions
(adapter-owned: Pi seeds its main agent; OpenClaw only writes tool access,
so an empty OpenClaw roster stays the operator's to fix), validates again,
and fails if the roster is still empty or inconsistent. It owns
`install-state` and settles `runtime_not_ready` on failure. Nothing else in
onboarding provisions the runtime.

A home with a reachable runtime and no login therefore finishes onboarding
with a warning (exit 2, marker written) and `bakin start` works.

## Declining the extras

`bakin onboard --no-recommended` declines the three steps that fetch from
outside (`RECOMMENDED_COMPONENTS`: recommended plugins, recommended agents,
capability packs). The orchestrator applies a decline before it looks at
the component: nothing is checked, fetched or installed, even under `--yes`
and even when the component is already installed, and the outcome is
`skipped` / `declined`. `bakin onboard --yes --no-recommended` is the
scripted run that sets up Bakin itself and touches nothing external.

## What onboarding says

Every word about setting up or logging in to a runtime comes from the
ACTIVE runtime's entry in `RUNTIME_ADAPTER_SUPPORT`
(`src/core/runtime-adapter-factory.ts`): `label`, `summary`, `setupHint`,
`setupUrl`, `docsUrl` and `loginSteps`. `runtime.ts` and `credentials.ts`
read it when a message is built, never at module load, and there is no
"default runtime" copy to reach for (the old
`DEFAULT_RUNTIME_ADAPTER_SUPPORT` is gone). So a home on Pi is told to run
`pi` and type `/login`, and a home on OpenClaw is pointed at OpenClaw.

`tests/architecture/onboarding-runtime-copy.test.ts` keeps it that way: no
default-runtime copy anywhere onboarding can speak from, and no runtime
name inside a string literal in those two components. Adding a runtime
means adding its entry, not editing messages.

## The guided credentials step

Interactive runs only. After the bootstrap phase, when the runtime is ok
and no provider is logged in, the wizard shows the active runtime's
`loginSteps` and waits (`waitForCredentials` in
`src/core/cli/onboarding-interactive.tsx`, screen
`OnboardingCredentialsPrompt`):

- **Enter** checks again. A login that appeared (made in another terminal)
  ends the step; otherwise the screen says it is still not there.
- **s** skips. The run finishes with the `llm` warning (exit 2, marker
  written) and `bakin start` works without a login.
- Ctrl-C cancels onboarding (exit 130).

Bakin never handles the secret: the operator logs in inside the runtime.
The wait sits at the phase boundary, so no operation is open and
`install-state` is not held while the operator is away. Scripted runs
(`--yes`, `--json`, no terminal) never wait: they warn and continue.

Screens are tested two ways: `tests/cli/onboarding-ui.test.tsx` renders
them to a string (what they say), and `tests/cli/onboarding-keys.test.tsx`
presses real keys through Ink's input handling (what the keys do). Add a
key test for any screen that takes input: the runtime screen once rendered
correctly while Enter on its preselected entry did nothing.

## The setup checklist

`src/core/onboarding/setup-checklist.ts`. What is still worth doing after
onboarding, in the order someone would do it. It adds no probing of its
own: every item projects something an existing engine already answers,
never message text.

| Item | Source | done | todo | unknown | left out |
|---|---|---|---|---|---|
| Log in to the runtime | `llm` check | a provider is logged in | none is (detail: the runtime's login steps) | the check throws or errors | never |
| Search | `search` check and its `applicable` flag | check ok | missing, broken or warn (`bakin install search`) | throws or errors | nothing on this machine to set up (external endpoint, temporary home) |
| Channels | `channels` check's reported state | connected, or configured and waiting for the server | disabled, missing token or guild, failed (Settings → Channels) | throws, errors, or reports no state | the runtime delivers natively |
| `<capability>` key, one per installed capability | capability readiness, secrets | every required key present | a required key is missing (Settings → Integrations & Keys) | manifest invalid; readiness throws | no required key |
| Model plan | `models` check | ok | no plan and something can run, or a plan that needs attention (`bakin models plan --apply`) | throws or errors | nothing can run yet (the login item covers it) |

Two notes carry no state: "Start Bakin" (only when no server runs for the
home) and "Browse Explore". Spend limits and brands are never listed; both
are opt-in.

Where it shows: the finish screen (`OnboardingChecklist` inside
`OnboardingSummary`, things to do before things done), plain lines for
output that is not a terminal (`checklistLines`), and `checklist` on the
`--json` summary line. `bakin onboard --check` shows the same list and still
writes nothing. A blocked run (exit 1) shows its blocker and no checklist.
If the checklist cannot be built the run's result stands and it is simply
not shown.

`buildSetupChecklist(sources)` is pure and unit-tested per item and state;
`getSetupChecklist()` asks the engines. Adding an item means adding a
source and a projection, not a probe.

## CLI targets

`bakin check <x>` accepts every onboarding component (and `all`);
`bakin install <x>` every one that has an install. Both lists, their
unknown-subcommand hints, the help text in `src/core/cli/registry.ts` and
the install request schema derive from ONE leaf,
`src/core/onboarding/component-names.ts` (`COMPONENT_NAMES`,
`INSTALLABLE_COMPONENT_NAMES`). A unit test pins the leaf to
`COMPONENT_ORDER`, and `tests/architecture/onboarding-cli-targets.test.ts`
forbids a second list kept by hand in the command module or the registry.
Adding a component means adding it to `COMPONENT_ORDER` and the leaf; the
CLI follows.

`bakin check <x>` goes through `checkComponent` (in `index.ts`): a
component that does not apply to the active runtime says so instead of
being checked. Under `--json`, `check` and `install` keep runtime logs off
stdout so the output parses (`--verbose` keeps them).

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

One requirement is strict (`requiresOk`): `search-models` needs `search`
to be fully `ok`. A search step that only warns is an engine this home does
not run (a temporary home, a service another home owns), so there is
nothing to pull models with; left to run, the models check would report the
missing engine as an error and fail the whole run.

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
same harness. Flags: `--runtime none|pi|openclaw|both` (what is set up on
the "machine"), `--auth none|fake|copy`, `--stored <adapter>` (a home that
already decided), `--keep`, `--home <dir>`, `--network`; everything after
`--` goes to `bakin onboard`. Try `--runtime none` (Pi by default, no
question), `--runtime pi` and `--runtime both` (the runtime question). It prints what
the run wrote, any refused supervisor call or denied request, and confirms
that the real `~/.bakin`, `~/.pi`, `~/.openclaw`, `~/.antfly` and the search
service unit are unchanged. `--auth copy` only reads `~/.pi/agent/auth.json`.
