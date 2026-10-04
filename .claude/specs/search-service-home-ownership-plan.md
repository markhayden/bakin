# Implementation plan: Search service home ownership (#826)

Status: implemented, reviewed, and verified; all planned gates completed.
Base inspected: `566c7a229`. User authorized implementation with “do it”.
Spec: [search-service-home-ownership.md](search-service-home-ownership.md).
Branch: `fix/search-service-home-ownership-826`.

## Result and scope

Default-settings verification boots cannot take over, restart, or send search
requests to the operator's shared engine. A refused home starts with search
unavailable and preserves queued writes. Explicit installation can claim the
service for a permanent home; known temporary roots cannot claim it. Existing
owner-home reconciliation and unloaded-service recovery remain intact.

Migration recovery remains a separate follow-up, recorded in the spec. No new
dependency, compatibility layer, ownership sidecar, service-mode enum, port
allocator, generic transaction system, or service-management framework.

## Implementation choices

### One ownership decision

Use a small adapter-private `service-ownership.ts` for path identity and unit
evidence; `service.ts` supplies filesystem/service facts. Return typed owner,
foreign, missing, temporary, or indeterminate results with useful paths.
Busy is an operation/access result, not another service mode.

Derive the recorded home from supported `<home>/antfly` arguments before
resolving the leaf. Canonicalize homes through the nearest existing prefix,
appending missing suffixes. Whole-home aliases work; a symlink from one
home's data leaf to another home's data never grants ownership. Refuse
redirected data leaves for managed operations with whole-home-alias guidance.
Unreadable paths, symlink loops, or ambiguous unit evidence fail closed.

Classify temporary homes by canonical, segment-bounded system temp roots and
`TMPDIR`/`os.tmpdir()`, never `tmp.*` name guesses. Inject filesystem/temp-root
facts in tests, not a production policy-disable flag. Arbitrary disposable
directories elsewhere remain protected on ordinary boot by lack of ownership;
document that explicit claims there are an operator responsibility.

Parse only the launchd `ProgramArguments` and systemd `[Service]` `ExecStart`
formats Bakin supports. Require exactly one usable data-dir argument. Decode
XML entities and supported quoted arguments; reject duplicates, malformed
escapes, and unsupported expansions. Pair any necessary renderer correction
with parser round-trip tests (spaces, quotes, ampersands, escaping). Do not
build a general configuration parser.

Use parsed URL origins for the existing default loopback aliases, so trailing
slashes, casing, and paths/queries cannot turn the same engine into a guest.
Invalid URLs fail honestly before side effects. No DNS discovery.

### One serialized service operation

Maintenance requires ownership before directories, model checks, engine
probes, or supervisor mutations. Preserve `refused-foreign-home`; use equally
explicit reasons for other refusals. The installer alone supplies private
claim intent; boot/reset/restart/remove never acquire it.

Use one cross-process lock beside the canonical per-user unit. Perform a
read-only preflight first, acquire for authorized operations, then re-read
ownership under the lock. Hold through stop, unit/binary/data mutation, and
start/result. Nesting within the same operation is allowed; other operations
in the same process contend. Low-level helpers must not reacquire accidentally.
Stage downloads and checksum/version verification before taking this lock.

Keep locking adapter-private. Existing install/server locks are home-scoped
and cannot be reused directly; importing the host install framework would
also violate the adapter boundary. Prefer a small exclusive-create helper
over a generalized locking refactor. Release the holder's own lock in
`finally`; empty/unreadable/contended lock files are busy, never evidence of
staleness. No automatic stale-lock reaper. After an abrupt crash, diagnostics
name the holder/path and docs require stopping all service-changing processes
before manual cleanup.

Transfer must successfully stop/unload the prior managed service before
publishing the new unit, swapping the shared binary, or clearing target data.
This does not depend on `/readyz`: an unready service may still be running.
Use native service state to distinguish already stopped from a failed stop.
Use `@bakin/core/storage/atomic-write` for units. Propagate failed supervisor
commands; a healthy old or unrelated HTTP listener cannot turn them into
success. Confirm the managed API/health ports are released before starting a
replacement, including when an unrelated listener is unready. Refuse a port
conflict with clear guidance; never kill/adopt that listener. Preserve
prior-home data.

Fresh/current/upgrade installs all ensure/start the intended service and pass
bounded readiness checks. Download failures leave the old service running.
Failures after stop report failure and retry guidance, with no automatic
ownership rollback or journaling. Verify the actual service launch binary;
an `ANTFLY_PATH` override cannot hide a missing/stale managed executable.

### Setup that actually reaches a working service

Resolve active settings at invocation for dependency checks, install/reset,
and model setup. A pinned binary with a missing managed unit must report
`missing`/`broken`, because the onboarding runner only installs those states.
Owned-home upgrades remain installable. Foreign/temp/indeterminate ownership
reports `warn` before binary checks, with deliberate claim/isolated-endpoint
guidance; generic onboarding must not transfer service ownership even with
`--yes`.

Guests report external management and neither search nor search-models setup
checks/downloads local binaries/models. Explicit guest installation/reset
must not mutate the managed local engine. Reuse the setup boundary rather
than adding guest conditionals throughout onboarding.

Normalize only the existing exact legacy-default URLs in memory before
selecting service mode. A needed correction must still reach installation
instead of returning `ok` early. Persist only the URL after successful install,
preserving existing success-only correction tests and unrelated settings.

### HTTP access and recovery

Add one optional adapter-supplied guard at the client's single request
boundary, plus the check before cached availability. Denial throws existing
`SearchEngineUnavailableError` before fetch; availability returns false.
Keep standalone client tests transport-only. Do not add checks to every method.

The managed adapter enables access only after successful initialize; a
refusal/failure leaves it blocked until successful reinitialize. Rebuilding
the client retains the guard, invalidates deferred operations on the previous
client, and clears availability. Each guard authorizes its own transport's
settings. Strict-child initialization remains idempotent under the service
lock and recognizes its own running child. Document restarting the
current Bakin process after explicit installation if it started unavailable.
An enabled adapter still rechecks unit ownership and the mutation lock before
each fetch, revoking old-owner access after a transfer and refusing while a
service operation is active. These are bounded local reads only; no supervisor
or network probe per request, no log per document, no TTL authorization cache,
watcher, or speculative optimization. Review overhead during implementation.

Temporary/default-endpoint denial precedes child spawn. On a native host,
child-mode overrides cannot bypass foreign/missing OS-service ownership.
Preserve strict-child behavior for permanent homes without an OS supervisor
and the rig's explicit separate-origin guest URL; do not add a container
detector or auto child fallback. Failed supervised startup never silently
falls through to an HTTP client or child.

HTTP requests do not hold the mutation lock. Already authorized/in-flight
requests cannot be revoked by a file guard; operational transfer instructions
must stop the old Bakin process first. Engine-side credentials/fencing for
arbitrary concurrent clients remain outside scope.

### Accurate existing Health presentation

Project structured ownership/access reasons through the adapter-neutral
factory boundary. Health evaluates them before local binary/connection/index
checks: one policy-denial observation plus local outbox data, without remote
probes, an engine-down duplicate, or reset/reindex advice. Guest checks skip
local installation requirements and use the configured endpoint. Engine
process/CPU/log probes also avoid attributing foreign state to the caller.
The refusal uses error/action-required so normal sensitivity preserves the
existing instruction disclosure. Local journal counts describe retained
writes and offer no delivery/repair claims while access is refused.

Reuse existing instruction resolutions: temporary homes get isolated-endpoint
steps with no install command; permanent homes get deliberate claim guidance
that names the old/new homes and service consequence. No auto-claim repair.
The public Storybook patterns and UI contract are recorded in the spec; no
new components, styles, or exceptions are proposed.

## Ordered tasks and acceptance

Use failing behavioral regressions first, then the fix. Each code checkpoint
includes its tests. Keep green commits; no unused-helper-only checkpoint and
no regression tests postponed until a later test-only commit.

| Task | Work and principal files | Required evidence |
|---|---|---|
| T0 | Finalize these spec/plan documents | Agreed decisions, review findings, non-goals, and recovery limitations agree; obtain plan approval |
| T1 | Ownership evaluator, service lock, provisioning/controls, installer/setup and onboarding settings/checks; `packages/adapter-antfly/src/{service-ownership,service-lock,service,installer,setup}.ts`, `src/core/onboarding/search.ts` | Both supervisors deny foreign/temp/unknown/missing ordinary boots before side effects; preserve owned drift/unloaded recovery; serialized claims and working fresh/current/upgrade onboarding |
| T2 | Adapter/client access guard and contained-boot/outbox regression; `adapter.ts`, `client.ts` | Zero HTTP/child spawn for refused boots across all methods and cached availability; later transfer revokes access; reinitialize clears denial only on success; outbox remains pending |
| T3 | Neutral status, engine probes, existing Health instruction content/fixture; `service.ts`, `engine-status.ts`, `src/core/search-adapter-factory.ts`, `plugins/health/lib/system-checks/search.ts`, `plugins/health/tests/collection-report.ts` | No foreign process attribution, duplicate engine failures, or impossible recovery advice; guest/local-binary behavior correct; existing UI handles long paths and commandless instructions |
| T4 | Operational/public/agent docs and final verification | Docs match executable behavior, full checks pass, migration code unchanged |

T1 is one commit checkpoint, not one implementation step. Execute these
smaller steps in order, verifying each before expanding the change:

1. **Ownership and provisioning:** evaluator, URL/path classification, and
   early provisioning refusals; wire explicit installer intent so the
   deliberate install path remains available. Run ownership/service tests.
2. **Serialized controls:** the shared lock, ownership recheck under it, and
   start/stop/restart/remove/reset guards. Run lock, service, and reset tests,
   including a deterministic cross-home interleaving.
3. **Installer completion:** stage before stopping, propagate failures,
   validate the actual launch binary, and verify fresh/current/upgrade
   readiness. Run the installer suite with stop/start/download failures.
4. **Onboarding integration:** active settings, dependency status branching,
   guest model behavior, and existing legacy URL correction. Run onboarding
   tests, then the combined adapter/onboarding suites before committing T1.

The remaining dependencies are T0 → T1 → T2 → T3 → T4. Keep those checkpoints;
do not turn the smaller T1 steps into partially deployable fixes or extra
helper-only commits.

T1 tests use existing `tests/adapter-antfly/service.test.ts`,
`tests/core/onboarding/{antfly,search-url-correction,index,models}.test.ts`
where relevant and focused new ownership/lock/reset suites. Cover:

- launchd/systemd, loaded/unloaded foreign services, owner drift/recovery,
  temporary-root aliases, permanent mktemp-like names, missing/unreadable or
  malformed units, quoted/entity paths, whole-home versus data-leaf aliases;
- two deterministic competing service operations, including an owner boot
  paused while another home claims; fresh ownership recheck after acquisition;
  contention/empty-lock handling and release after success/error;
- failed download leaves the old service running; unready live engine stops
  before swap; failed stop leaves unit/data unchanged; failed start/reload
  cannot pass because an old engine remains ready; an unrelated unready
  listener also causes an honest port-conflict failure;
- pinned binary plus missing unit reaches installation through the real
  onboarding status branch; foreign/temp generic onboarding skips safely;
  guest with no local binary/models never installs them;
- current-version override versus missing/stale managed executable, and
  exact legacy URL correction ordered before mode selection and persisted
  only after successful installation.

T2 tests use `tests/adapter-antfly/{client,adapter-delegation}.test.ts` plus
focused adapter ownership/integrated isolation coverage. Exercise queries,
multiquery, scan, rerank, tables, documents, and availability using recording
fetch/ServiceIo/child fakes. Exercise the real outbox with isolated SQLite and
prove pending writes are neither lost nor quarantined. Preserve existing
`tests/scripts/instance/{throwaway-settings,antfly-child}.test.ts` behavior.

T3 tests use `tests/adapter-antfly/engine-status.test.ts`,
`tests/plugins/health/{system-checks,incident-row}.test.ts[x]` as applicable,
and the existing Health browser fixture. Verify policy denial even with a
missing binary, one actionable explanation, no engine probes, and responsive
instructions with long paths/no command. Inspect the browser report path
printed by `bun run --cwd plugins/health test:ui`.

T4 updates `.claude/knowledge/search-system.md`,
`.claude/knowledge/dev-rig.md`, `.claude/skills/verify/SKILL.md`, `CLAUDE.md`,
and `docs/src/content/docs/start/operation.md`. Explain missing-unit setup,
claims, stopping the previous Bakin process, temporary-root classification
limits, failed-install retry/restart, and abandoned-lock recovery. Remove
warning-only repoint instructions; preserve historical incident records.
README was reviewed: its onboarding-first setup remains correct once T1 fixes
the check/install flow. Update it only if the implemented workflow changes.

## Commit and rollback strategy

Create the branch after approval; stage only named files. Generated stamps
and build outputs are not automatically part of this change.

| Checkpoint | Proposed commit | Rollback boundary |
|---|---|---|
| T0 | `docs(search): specify service home ownership for #826` | Documentation only |
| T1 | `fix(search): guard and serialize managed service ownership` | Service policy/installer integration stay together; revert restores unsafe old behavior |
| T2 | `fix(search): block engine access from unclaimed homes` | Depends on T1; reverting reopens shared-index access |
| T3 | `fix(health): explain search service ownership refusals` | Can revert presentation while retaining enforcement |
| T4 | `docs(search): document service claims and recovery` | Docs and recorded validation |

These are development checkpoints, not independently deployable partial
fixes. T1 and T2 ship together. Repair a failing checkpoint before committing;
revert dependent commits in reverse order using reviewed `git revert`, never
reset shared history or delete runtime data. No data migration is involved.
Recover a correctly refused home through explicit installation from the
intended permanent home or an isolated endpoint, not by disabling the guards.

## Verification gates

No real launchctl/systemctl, production home access, or HTTP to the shared
3738/3739 engine in tests. Follow `CLAUDE.md`: mock both content-dir facades
and the OpenClaw resolver; isolate binary/model/unit/data paths, watchers and
logging/runtime as reachable. Close SQLite handles and clean up. Tests
inject temp-root facts; never weaken production classification for testing.
Use Bun 1.3.13, per-file isolation, and condition-based waits.

At code checkpoints, run the relevant scoped tests, lint, typecheck, and diff
checks. Use quick UI conformance while touching Health. At final handoff:

```sh
bun run --cwd plugins/health test:ui
bun run ui:conformance --full
bun run build
git diff --check
```

Full conformance includes quick conformance, lint, typecheck, the repository
test suite, frontend builds, Storybook/browser checks, and `docs:check`.
`bun run build` also validates embedded assets and the compiled binary.
Do not repeat green full checks without a relevant new edit/failure. Inspect
generated artifacts; never update baselines merely to force green results.

Baseline before implementation: service suite 20 passed, 0 failed, 61
assertions. This is existing coverage, not proof of the fix. Implementation
and validation evidence is recorded below.

## Review disposition

The second review added concrete customer cases that the initial plan missed:
onboarding with an existing binary, transfer failure ordering, unready live
engines, override consistency, legacy URL ordering, Health short-circuiting,
same-origin URL spellings, cross-home symlink aliases, and concurrent service
mutation. Each has an acceptance check above.

It also removed directory-name guessing and unnecessary helper/test-only
commits. One evaluator, one mutation lock, one request guard, and the existing
status/presentation boundaries are sufficient. Keep migration recovery,
generalized service orchestration, and engine-side client fencing out of this
change. Implementation was authorized after this review.

Final consistency pass: recovery instructions, concurrency limits, acceptance
coverage, and commit dependencies agree with the spec. T1 now has explicit
internal execution steps because its combined service/installer checkpoint
was too large to treat as a single coding task. No additional product scope
or architecture change is required before implementation.

## Implementation review and evidence

T0 and T1 are committed as `5f1ea2083` and `8fbe1a9c2`; T2 is `47b292a78`
and T3 is `c6055239c`. T2 includes the
review corrections to setup authority, canonical paths, and under-lock binary
revalidation, because they close access gaps discovered while integrating
the request guard. T3 keeps diagnostics and its existing browser fixture
together. T4 records operational guidance and the results below.
The final T3 consistency correction is `f0218c958`: inability to read service
access uses the same retained-journal reporting as an explicit refusal.

Independent implementation review found and verified fixes for eight cases:
native-host child overrides, version changes during staging, relative home
paths, generic setup racing a new owner, deferred clients after settings
changes, strict-child reinitialization, hidden Health instructions, and
misleading journal-drain copy. Final scoped review reported no remaining
findings. No migration implementation, dependency, public UI component,
visual baseline, or service framework was added.

Behavioral RED evidence was observed before fixes for foreign/missing/temp
service provisioning, relative-home identity, adapter isolation, stale-client
authorization, child reinitialization, Health sensitivity, and retained
journal reporting. Tests use fake supervisors/processes and isolated homes;
the adapter integration test uses a real isolated SQLite outbox and proves
transient retention with zero quarantined writes and zero engine HTTP.

The Health fixture passed desktop/mobile conformance after opening the
existing explanation and commandless instruction disclosures. Both generated
screenshots were inspected; the long home path and recovery steps fit.
Reports: `plugins/health/test-results/bakin-ui/index.html` and
`plugins/health/test-results/bakin-ui-agents/index.html` (generated, untracked).
Patterns: `storybook/public/feedback/search-trust.stories.tsx` —
`CanonicalUsage` / `AvailabilityAndEvidence`,
`storybook/public/lists/list-rows.stories.tsx` — `CanonicalUsage`, and
`storybook/public/feedback/status-badge.stories.tsx` — `CanonicalUsage`.
Contract: `@makinbakin/sdk/patterns`, existing `/ui` and `/layout` disclosures.
Story/style-guide update not needed; no deviation.

Final verification uses Bun 1.3.13. The repository suite passed with 10,422
passing, 19 skipped, zero failed tests across 1,088 files. Quick conformance,
typecheck, lint (six pre-existing warnings, zero errors), frontend builds,
payload limits, deterministic Storybook builds, and all 367 Storybook
accessibility/interaction tests passed. `bun run build` produced all three
supported binaries; the macOS ARM64 binary's `version` command passed with
isolated Bakin/engine/runtime homes. Generated version/asset-hash churn was
reviewed and excluded from the change. Full conformance passed, including
318 unchanged Chromium visual baselines, all 171 Chromium/Firefox/WebKit
behavior checks, plugin conformance checks (including seeded-failure checks),
49-page docs validation, route-contract validation, and the combined published
docs/catalog build (483 public UI stories). Generated docs date-only churn
was excluded. `git diff --check` passed. No production service was restarted
or repointed during this work.

The final ownership-read-error case was reproduced (56 passed / 1 failed),
fixed, and verified (57 Health tests passed / 0 failed), followed by another
passing quick conformance/typecheck, focused lint, and complete binary build.
Its independent review reported no findings. These targeted checks follow
the full runner's completed repository-test stage; browser contracts are
unchanged by this final server-side reporting correction.

T0–T4 are complete. Owner/claim behavior, request isolation, diagnostics,
tests, and operating guidance are committed together on the issue branch. No
unresolved findings remain from the scoped implementation reviews. The
migration follow-up and the documented in-flight-request/manual-lock-recovery
limitations remain as agreed in the spec.
