# Spec: Search service home ownership (#826)

Status: revised after source review and independent review; ready for approval.
Implementation awaits plan approval. Created 2026-10-03 against `566c7a229`.

Plan: [search-service-home-ownership-plan.md](search-service-home-ownership-plan.md).

Issue: https://github.com/markhayden/bakin/issues/826

## Objective

A Bakin server booted with a temporary or foreign `BAKIN_HOME` must not
repoint, bootstrap, restart, or otherwise take control of the OS-supervised
Antfly service belonging to another home. Ordinary owner-home boots must
retain configuration reconciliation and unloaded-unit recovery. Deliberate
service ownership changes belong to the explicit search installation path.

This protects the single operator's production search while agents verify
changes in disposable homes. Priorities: reduce technical debt, use one
ownership policy, preserve source data, and avoid compatibility shims.

## Assumptions and scope

- Cover both supported OS supervisors: launchd and systemd user services.
  The shared service belongs to the OS user; its identity is not scoped to
  `BAKIN_HOME`.
- The service unit's recorded data directory is the existing ownership
  evidence. A custom permanent home can legitimately own the service;
  ownership cannot simply mean the literal default `~/.bakin` path.
- Keep provider-specific ownership inside `packages/adapter-antfly`.
- Use existing unavailable-search behavior and durable outbox semantics.
  Browser components, layout, and public SDK UI contracts are not proposed
  for change.
- Verification uses fake supervisors and isolated files; production search
  is never an experimental reproduction target.
- Confirmed by Mark: temporary or otherwise unclaimed homes using the
  default search URL start with search unavailable until explicitly
  configured with an isolated endpoint. The refused adapter makes zero HTTP
  requests to the shared engine; queued writes remain local.
- Confirmed by Mark: even explicit `bakin install search` must refuse to
  claim the shared service from a temporary home. Permanent custom homes
  retain a deliberate claim path through explicit installation.
- Confirmed by Mark: keep this change focused on service ownership. Record
  migration recovery findings for a separate follow-up; do not modify the
  migration engine in this change.

## Confirmed current behavior

1. `service.ts:ensureProvisioned` computes paths from `getBakinPaths()`,
   creates data/log directories, and compares the rendered unit with the
   shared on-disk unit. `warnOnDataDirRepoint` logs a different data directory
   but permits rewriting and restarting it.
2. The unchanged-unit path introduced for #859 performs a supervisor probe
   and bootstraps/starts an unloaded unit. Ownership must be checked before
   this recovery path as well as before rewriting.
3. `detectServiceMode` protects non-default URLs and test environments, but
   an ordinary source-server process with a temporary home and default
   settings selects the real OS supervisor.
4. `adapter.ts:initialize` provisions, but every search operation delegates
   to an HTTP client configured with the default `127.0.0.1:3738` endpoint.
   Ignoring a refusal result would leave production index writes possible.
5. Automatically selecting the current child mode does not isolate search:
   its argv also uses port 3738, and the client could reach an existing
   production listener if the child cannot bind.
6. `startService`, `stopService`, `restartService`, and `removeService` can
   mutate supervisor state directly. Runtime restart is exposed through the
   adapter, including automated recovery callers in `search-registry-core.ts`.
7. The explicit installer and engine reset call the same provisioning and
   control functions. The installer uses default service settings; setup
   currently passes configured settings only to model setup. Ownership and
   guest-mode enforcement must not be bypassed by these paths.
   `src/core/onboarding/search.ts` also constructs setup with defaults at
   module load, so it must pass the current search settings through.
8. The existing data-dir parser does not decode XML entities or correctly
   parse quoted systemd paths with spaces. It is diagnostic code today;
   making it an authorization boundary requires stronger parsing and tests.
9. Onboarding checks only the binary version. Its runner skips installation
   for `ok`, `warn`, and `error`; only `missing`/`broken` trigger installation.
   A current binary with no unit would therefore strand the new boot policy.
10. Provisioning writes the new unit before stopping the old owner and ignores
    some supervisor failures. Installation can accept the old engine's
    successful `/readyz` as proof that the new home is ready. Upgrades also
    stop only a ready engine, and stop it before downloading the replacement.
11. Health checks the binary before ownership and later adds connection and
    index incidents. A supervision-only change would still offer conflicting
    install/reset instructions to a refused home.

These are code-inspection findings, not a live reproduction of the incident.

## Ownership behavior

The minimum issue contract is a loud `action: 'refused-foreign-home'` result
when an existing unit records another data directory, with no unit rewrite,
bootstrap, start, stop, restart, or removal. Normal reconciliation remains
available to the owning home. The explicit installer remains the deliberate
claim path.

The ownership boundary is:

- One ownership decision shared by provisioning, service controls, and
  adapter availability. No environment escape hatch that silently defeats
  an existing owner's protection.
- Compare canonical home identities, including whole-home symlink aliases
  and macOS `/tmp` versus `/private/tmp`. Resolving only the `antfly` leaf
  must not make two different homes with shared engine data the same owner:
  their search metadata/outboxes differ. Treat malformed, ambiguous, or
  unreadable evidence as indeterminate and refuse implicit mutation.
  Derive the recorded home from the supported `<home>/antfly` argument
  before resolving the leaf. Independently redirected data-directory
  symlinks are refused for managed access/claims/reset; use a whole-home
  alias instead, so derived indexes and home metadata stay together.
- Ordinary boot maintains a service only when its existing unit identifies
  the current home as the owner. A missing unit means ownership is unclaimed;
  explicit installation establishes ownership. Apply this consistently to
  default and custom permanent homes, following Decision 1's unavailable
  behavior for unclaimed homes.
- Explicit install may establish or transfer ownership to a permanent home.
  It must refuse temporary homes before stopping the service, changing the
  shared binary, writing a unit, clearing data, or probing the shared engine.
  `--yes`, `--force`, and service-mode environment overrides do not bypass
  the temporary-home restriction. Engine reset is not an ownership claim.
- For refused/unclaimed homes (confirmed): continue Bakin startup with search
  unavailable, retain queued writes, make zero requests to the default
  engine, and offer an explicit isolated endpoint. Known temporary homes
  require that endpoint; permanent homes can also recover through deliberate
  installation followed by restarting the current Bakin process.
- Preserve the existing rig's explicit non-default endpoint behavior.

Temporary-home classification covers system temporary roots (`/tmp`,
`/private/tmp`, `/var/tmp`, and the resolved `TMPDIR`/`os.tmpdir()` location),
including symlink aliases and path-segment boundaries. Do not infer lifecycle
from a directory's name: a permanent `tmp.project123` must not be rejected.
An arbitrary disposable directory outside known temporary roots cannot be
identified as temporary from its path alone; the unclaimed/foreign-home rule
still protects ordinary boot. Document that such directories must use guest
endpoints and must not deliberately claim the shared service. A home under a
known temporary root remains ineligible even if an old unit points at it.

The existing non-default-URL guest contract remains explicit endpoint
configuration. The fix introduces no automatic child fallback for a refused
home. Existing container/rig child behavior must be checked separately from
host OS-service ownership, and a host-side child-mode override must not become
a way to silently connect a refused home to the shared default engine.

### Decision table

| Situation | Ordinary boot / search | Explicit managed-service installation |
|---|---|---|
| Explicit non-default search endpoint | Existing guest behavior; no OS-service control | Do not manage or replace the shared local engine |
| Temporary home, default endpoint | Refuse lifecycle and HTTP access; search unavailable | Refuse before shared side effects |
| Permanent home, unit records another data dir | `refused-foreign-home`; no lifecycle or HTTP access | Deliberate claim allowed; name old and new homes in the result/log |
| Permanent home, matching owner | Reconcile drift and recover unloaded service | Maintain/update installation with existing readiness gate |
| Permanent home, no unit | Unavailable; explicit install required | Create service, start, and verify readiness |
| Unit exists but ownership cannot be established | Refuse implicit lifecycle and HTTP access | Explicit install may replace malformed config; unreadable files must produce honest failure |
| No OS supervisor, permanent home | Preserve strict-child behavior | Preserve local child installation behavior |

Classify the managed loopback endpoint by parsed URL origin, not raw string
equality. Equivalent spellings (including a trailing slash, hostname case,
and a path/query on the same managed origin) do not grant guest privileges.
Retain the recognized `localhost` and `127.0.0.1` default-port aliases; do not
add DNS resolution or remote endpoint identity discovery. Other configured
origins are intentional external access; the policy does not prove isolation
of an operator-supplied endpoint.
No new service-mode enum, automatic port allocator, namespace detector,
ownership sidecar, or provisioning environment override is needed.

### Installation and onboarding must complete the recovery

- Resolve settings when checks/install/reset run. An existing binary alone
  does not make a managed installation complete. A permanent missing-unit
  home reports `missing`/`broken` so ordinary onboarding can install it.
  Owner-home binary upgrades also remain installable through onboarding.
- Foreign, temporary, and indeterminate ownership report an actionable
  warning before binary checks. Generic onboarding, including `--yes`, must
  not accidentally transfer a service; explicit `bakin install search` is
  the deliberate permanent-home claim path.
- Guest checks explain that the endpoint is externally managed. Neither
  search nor search-models setup requires/downloads local binaries/models
  or touches the shared service. Health checks the configured guest endpoint.
- Normalize only the already-supported exact legacy URLs in memory before
  mode selection. Route a needed correction through installation, then
  persist only the URL after success, preserving the current correction
  contract and other settings. Do not create another compatibility layer.
- Verify the executable the service will actually launch. A current-version
  `ANTFLY_PATH` cannot hide a missing/stale managed executable and produce a
  successful installation. Inconsistent overrides fail with clear guidance.
- Stage and verify any replacement binary before stopping the old service.
  Stop/unload the managed service before replacing its unit/binary or clearing
  target data, even if its readiness probe fails. Confirm that it is stopped;
  a failed command is not proof of an already-stopped service.
- On transfer, stop the previous owner successfully **before publishing the
  new owner's unit**. Use the existing atomic-write utility. Preserve the old
  home's data; a version upgrade may clear only safe target-home derived data.
- Fresh, already-current, and upgrade installations all start the intended
  service and pass bounded readiness checks. Propagate failed supervisor
  commands; another process answering `/readyz` cannot override a lifecycle
  failure. Before starting a replacement, confirm the managed API/health
  ports are released, including by an unready listener. Port conflict means
  failure with guidance, never killing or adopting an unrelated listener.
- Failures after the stop are reported as failures with retry guidance;
  search remains unavailable until repaired. A refused/failed initialize
  leaves managed adapter access blocked until successful reinitialize; this
  makes restarting Bakin after installation an explicit recovery step.
  No automatic ownership rollback, transaction journal, or cross-home data
  deletion is introduced.

### Serialize service changes, without a new service framework

An ordinary owner boot can otherwise pass its check, pause during a transfer,
then overwrite the new owner's unit. One short, cross-process service-operation
lock must coordinate all homes, keyed beside the canonical per-user unit.
Existing `BAKIN_HOME`-scoped install/server locks cannot provide this guarantee.

Refuse obvious foreign/temp callers before creating a lock. Authorized
mutations acquire it, re-read ownership, and hold it through the complete
stop/write/reset/start sequence. Stage downloads first. Boot and control
contention return an honest busy/unavailable result, without a fallback.
Keep the lock private to this adapter and reentrant only within the same
operation; unrelated requests in one process must also contend.

Always release in `finally`, and only if still held by that operation. Treat
empty/malformed lock contents as occupied, since creation and metadata writes
are not simultaneous. Do not build a lease/reaper framework: after an abrupt
crash, report the lock path/holder and document clearing it only after all
service-changing processes have stopped. Tests cover contention and release.

HTTP does not acquire a mutation lock. Deny new default-engine requests while
a service change is in progress; re-evaluate ownership on later requests.
Requests already authorized/in flight when a transfer begins cannot be
revoked by a local file guard. Document stopping the old Bakin process before
an intentional cross-home transfer. Eliminating that race for independently
running clients would require engine-side credentials or fencing and is
outside this focused fix; the zero-HTTP guarantee for refused temp/foreign
boots remains unconditional.

### Diagnostics and operator behavior

- Log refusal with the unit path, requested home/data dir, known owner, and
  reason. A failed/refused ensure must not produce a success message.
- Recheck ownership before service-control operations and HTTP requests so
  an already-running server loses access after an intentional ownership
  transfer. Availability caching must not bypass that check.
- The readonly service-status result must not mark a foreign unit as this
  home's healthy provisioned service. Expose structured refusal information
  through the existing adapter-neutral factory boundary.
- Health consumes that information through its existing instruction
  resolution. Temporary homes get isolated-endpoint guidance, without an
  install command that is guaranteed to be refused. Permanent homes may be
  told how to deliberately install/claim, including the ownership consequence.
- Evaluate ownership before binary/connection/index checks. A denied home
  gets one policy explanation plus local outbox information, without a second
  engine-down incident, reset/reindex advice, foreign log paths, or engine
  probes. Guest Health does not require the managed local binary.
- Engine process/CPU probes and reset/restart operations cannot observe and
  manage another home's engine as though it belonged to the caller.

## Migration hardening review

The issue also describes engine loss during blue/green backfill. Initial
inspection found existing protection and two concerns worth separate tests:

- `packages/core/src/search/tables.ts:resumeMigrations` resumes the persisted
  `migrating_to` and fingerprint. Existing tests prove nonce preservation.
- `stageMigration` persists the target before backfill, but a thrown batch
  failure propagates through `runMigration` without explicitly marking the
  phase parked. The periodic migration pump selects parked rows.
- `src/core/search-registry-core.ts:repairOneTable` converts a thrown stats
  read into `null` and then forces a fresh generation. In contrast, the
  migration pump uses a successful table listing to establish absence.

Decision: separate follow-up. These findings do not block the ownership fix
and require separate fault-injection tests and rollback boundaries. This
section records the follow-up without creating or commenting on an external
issue. No migration behavior changes belong to this implementation.

## Tech stack and project structure

TypeScript strict; Bun 1.3.13 (local version matches `.bun-version`); existing
Node-compatible filesystem/path utilities; injected `ServiceIo` supervisors.
No new dependency or database schema is proposed.

Primary source files:

- `packages/adapter-antfly/src/service.ts`: unit rendering, ownership,
  provisioning, process controls.
- `packages/adapter-antfly/src/adapter.ts`: lifecycle and adapter delegation.
- `packages/adapter-antfly/src/client.ts`: single HTTP request boundary;
  enforcement seam for the confirmed zero-network refusal.
- `packages/adapter-antfly/src/{installer,setup}.ts`: deliberate install and
  reset integration.
- `src/core/onboarding/search.ts` and search-model setup: settings-aware
  dependency classification and the existing legacy URL correction.
- `src/core/search-adapter-factory.ts` and
  `plugins/health/lib/system-checks/search.ts`: neutral status and existing
  Health instruction resolution.

Primary existing test locations:

- `tests/adapter-antfly/service.test.ts`
- `tests/adapter-antfly/{client,adapter-delegation,engine-status}.test.ts`
- `tests/core/onboarding/antfly.test.ts`
- `tests/core/{search-tables,search-registry,search-outbox-pump}.test.ts`

## Code style

Use scoped conventional commits, kebab-case file names, typed results, and
the existing `ServiceIo` seam. Keep policy, control, and transport boundaries
small; early mode returns must not bypass temporary/default-endpoint checks.

Ownership refusal must occur before side effects. Reuse the existing
`SearchEngineUnavailableError` classification for refused data-plane work;
do not classify failures by parsing log text.

## Commands and validation

Commands verified against the repository scripts:

```sh
bun test tests/adapter-antfly/service.test.ts --isolate
bun test tests/adapter-antfly/ tests/core/onboarding/antfly.test.ts --isolate
bun test tests/core/search-tables.test.ts tests/core/search-registry.test.ts tests/core/search-outbox-pump.test.ts --isolate
bun run lint
bun run typecheck
bun run test
bun run build
bun run docs:validate
bun run docs:check
bun run ui:conformance --quick
bun run ui:conformance --full
bun run --cwd plugins/health test:ui
```

Baseline on 2026-10-03: service suite **20 passed, 0 failed**, 61 assertions.
The cross-home regression is not covered by that suite. No new tests or
production changes have been made during discovery.

## Testing strategy and acceptance criteria

Use regression tests that fail before the fix. All supervisor commands must
be recorded fakes; all home, binary, model, unit, and data paths must be
isolated. Follow `CLAUDE.md` resolver mocks, including both content-dir
facades and the OpenClaw-home resolver, and clean up after tests.

Required ownership matrix:

- launchd and systemd, foreign unit loaded or unloaded: refusal; original
  bytes intact; zero mutating supervisor commands and zero created data dirs.
- Same owner, matching configuration: unchanged when loaded, recovery when
  unloaded. Same owner with settings drift: existing reconciliation works.
- Paths with spaces, XML escaping, symlink aliases, relative components,
  missing paths, and malformed or unreadable unit evidence. A whole-home
  alias remains the same owner; linking only engine data does not.
- Deterministically interleave owner maintenance and another home's install:
  only one mutates the service; a waiting/retried caller rechecks ownership.
  Busy/empty locks fail closed; errors release the caller's own lock.
- Temporary-root boundaries and permanent names resembling mktemp names;
  equivalent default URL spellings do not bypass ownership.
- Missing unit: ordinary boot leaves search unavailable without silently
  claiming the shared service, including from the default home.
- Runtime repair/control paths obey the same ownership decision.
- Explicit install from a permanent home can deliberately claim the service
  and keeps the existing bounded readiness checks. A temporary-home install
  fails before shared engine probes, supervisor calls, binary/unit writes,
  or data deletion, including already-installed and upgrade paths.
- A failed download leaves the old service running. An unready but live
  service is stopped before swap/reset. A failed stop leaves its unit and
  data intact. A healthy old listener cannot make failed transfer/start pass;
  an unrelated unready listener also causes a clear port-conflict failure.
- Onboarding with a current binary but missing unit actually installs the
  service; foreign/temp checks never trigger takeover; guests need no local
  binary/models. Verify the real runner's status branching, not just helpers.
- Correct-version `ANTFLY_PATH` with missing/stale managed binary does not
  report success. Existing legacy URL correction still happens only after
  successful managed installation and preserves unrelated settings.
- Guest endpoint and existing rig isolation remain functional.
- A loaded service that is intentionally claimed by another permanent home
  revokes the old adapter's subsequent HTTP/control access, including when
  its availability cache previously said healthy.
- Health reports the refusal honestly and does not offer a prohibited
  temporary-home install or contradictory engine/reset incident, even when
  the binary is absent; existing unavailable-search presentation is used.

For the confirmed unavailable-until-configured policy, additionally prove that
availability probes, queries, table operations, indexing/deletion, reranking,
and scans send zero HTTP requests after refusal; Bakin remains usable and
pending outbox records are retained. Verify reinitialization cannot retain
stale authorization or an availability cache from the prior client.

## Documentation coverage

- `.claude/knowledge/search-system.md`: replace warning-only ownership
  guidance and clarify provisioning versus explicit claiming.
- `.claude/knowledge/dev-rig.md`: explain the structural boot protection
  alongside the rig's existing separate-port engine.
- `.claude/skills/verify/SKILL.md`: update the reason for the isolated URL
  recipe once the structural guard exists; retain explicit verification
  isolation.
- `docs/src/content/docs/start/operation.md`: document custom-home ownership,
  unavailable search, deliberate installation, temporary-root limits, and
  honest recovery after a failed transfer. Include stopping the prior Bakin
  process before transfer and recovery from a lock left by an abrupt crash.
- `CLAUDE.md`: adjust the service summary if the finalized policy changes
  the boot/install contract.
- `README.md`: reviewed; its current default-home setup instructions do not
  need changing. They already run onboarding before starting the server.

## UI conformance

This is a server ownership change with existing Health instruction content
and existing unavailable-search states. No new markup, styles, navigation,
SDK exports, or design-system exceptions are proposed.

Selected public patterns (inspected):

- `storybook/public/feedback/search-trust.stories.tsx` — `CanonicalUsage`,
  `AvailabilityAndEvidence`; `SearchUnavailable` from
  `@makinbakin/sdk/patterns`.
- `storybook/public/lists/list-rows.stories.tsx` — `CanonicalUsage`;
  `ListRow`/`ListRows` from `@makinbakin/sdk/patterns` for existing incidents.
- `storybook/public/feedback/status-badge.stories.tsx` — `CanonicalUsage`;
  `StatusBadge` from `@makinbakin/sdk/patterns` for existing status language.

The existing incident instruction resolution already supports steps without
a command and retains its keyboard-accessible disclosure. No public story
or style-guide change is needed because the supported contract is unchanged.
Verify refusal content through existing Health tests and the plugin's browser
conformance fixture, including narrow/long-path content. Run quick conformance
while iterating and full conformance before the merge-ready handoff, as required
by the UI conformance skill. Its full runner also covers lint, typecheck, the
repository suite, frontend builds, browser checks, and `docs:check`.

## Boundaries

- Always: preserve existing owned-home supervision recovery; one policy;
  isolated regression tests; accurate source and operational docs; atomic
  green commits with rollback checkpoints in the subsequent plan.
- Before implementation: review this spec and the dependency-ordered plan.
- Never: real service mutations or production engine HTTP during tests;
  silently reuse production search from a refused home; new compatibility
  shims; unrelated UI work; silently claim a service on ordinary boot from
  an unapproved foreign home.

## Interview and next gate

Decision 1 (confirmed): unavailable search until an isolated endpoint is
configured. No automatically provisioned isolated child is needed for this fix.

Decision 2 (confirmed): refuse temporary-home claims even during explicit
`bakin install search`; preserve deliberate claiming from permanent custom
homes.

Decision 3 (confirmed): complete the service ownership fix and document the
migration review findings for a separate fix. Separate changes are appropriate
because the fixes exercise different failure paths and have different rollback
consequences.

Requirements are resolved. The linked plan defines acceptance checks,
documentation tasks, and commit/rollback checkpoints. Implementation starts
after approval of that concrete plan; there are no remaining interview
questions about product scope.
