# Updates — one engine for "is there something newer / required" (#1007)

Every probe that used to live in a consumer (the header's release poll, the
manifest's `?check=1`, Team/Explore's per-load `--check`, the Health artifact
check's private index fetch) is ONE engine in core. It observes every tracked
subject on a schedule, persists records with two clocks, and broadcasts the
change; Health renders, Explore/Team/the header/the CLI read it over HTTP,
and in-process callers call the same observer functions. Nothing re-derives
an update from a lockfile marker, a cached probe or a message string.

Spec: `.claude/specs/housekeeping-batch-2026-10.md` § D7 (decisions
D7.1–D7.15); plan + commit strategy in the `-plan.md` beside it. This PR (A)
ships the engine, the required sources (search engine, search models, runtime
gateway), the Bakin + plugin sources, the apply service, the self-update
operation, Health → Updates and the CLI. PR B adds the package/hub-skill
sources and folds the legacy consumer probes; PR C the remaining deletions.

## Map

| Piece | Where |
|---|---|
| Record + snapshot types, `updateIdentityKey`, `isUpdateSkipped`, `countAvailableUpdates` | `packages/sdk/src/types/updates.ts` (`@makinbakin/sdk/types`) |
| Source contract (`UpdateSource`, `UpdateObservation`, inventory entries) | `src/core/updates/types.ts` |
| zod schemas (file + wire) | `src/core/updates/schema.ts` |
| Store (`~/.bakin/updates.json`, atomic, validated on read) | `src/core/updates/store.ts` |
| Inventory + fingerprints | `src/core/updates/inventory.ts` |
| Engine (observe, reconcile, skip, snapshot, `updates.changed`) | `src/core/updates/engine.ts` |
| Scheduler (due times, backoff, concurrency, coalescing, deadlines) | `src/core/updates/timer.ts` |
| Process-wide service (`registerUpdateSource`, `startUpdates`, `getUpdatesEngine`, `getUpdatesTimer`) | `src/core/updates/service.ts`; started from `src/core/server/startup-recovery.ts`, stopped in `lifecycle.ts` |
| Conditional requests (ETag / If-Modified-Since, Retry-After) | `src/core/updates/net.ts` |
| Sources: `search-engine`, `search-models`, `gateway`, `bakin`, `plugin` (+ `registerCoreUpdateSources`) | `src/core/updates/sources/*.ts` |
| Apply service (preview + confirm, covering approvals, engine reinstall operation) | `src/core/updates/apply.ts` |
| Self-update as an operation; `bakin update` | `src/core/updates/self-update-operation.ts`, `src/core/updates/self-update-cli.ts`, `src/core/self-update.ts`, `src/core/server-restart.ts` |
| Verification (browser hook + CLI twin) | `src/lib/self-update-verify.ts`, `src/hooks/use-self-update-verification.ts` (`@makinbakin/sdk/hooks`), `src/cli/self-update-verify.ts` |
| HTTP | `packages/host/src/api/updates.ts` (declared in `core-routes/index.ts`) |
| Settings | `settings.updates { enabled, intervalMs }` — `packages/core/src/settings.ts` (`normalizeUpdatesSettings`), System & Alerts fields in `src/components/system-settings.ts` |
| Doctor invalidation | `src/core/doctor-refresh.ts` (`updates.changed` → `plugin-artifacts` / `search` re-run) |
| Health UI | `plugins/health/components/updates-tab.tsx`, `hooks/use-updates.ts`, `lib/updates-route-schema.ts`, `lib/plugin-upgrade-result.ts`; the page reads the engine once in `health-page.tsx` and threads it to Overview (`health-view-model.ts` → `IncidentRow`), System (`system-view-model.ts`, `use-system-data.ts`) and the tab |
| Header banner | `packages/host/src/components/layout/header.tsx` (the `bakin:bakin` record only) |
| CLI | `src/cli/commands/updates.ts` (`bakin updates [--check] [--source] [--json] \| skip \| apply`), `src/core/cli.ts` (`bakin update`) |
| Search contract additions (applicability, identity, per-model remediation, `signal`) | `packages/core/src/adapters/search/index.ts`; antfly in `packages/adapter-antfly/src/{installer,models,identity}.ts` |
| Runtime contract addition (`compatibility()`) | `packages/core/src/adapters/runtime/concepts.ts`; OpenClaw answers from the last gateway handshake, Pi omits it; conformance pins presence |
| Tests | `tests/core/updates/**`, `tests/core/self-update*.test.ts`, `tests/cli/update{,s}-command.test.ts`, `tests/plugins/health/{updates-tab,use-updates}.test.tsx`, `tests/api/updates*.test.ts`, `tests/architecture/{self-update-callers,operations-routes}.test.ts` |

## The record

`UpdateRecord` (SDK): `id = <kind>:<subjectId>`, `group` (`required` — the
installation cannot work as configured until it is applied; `available` —
newer, optional), `subject {kind, id, label}`, `installed` / `available`
identities (`{ version?, sha?, digest?, display }` — at least one comparable
part; `display` is for people), `reason` (`newer-version | newer-commit |
compatible-rebuild | pin-mismatch | below-floor`), `outcome` (`current |
update-available | blocked | unsupported | unknown`), `source {kind, endpoint,
ref}`, `fingerprint`, `action`, `blockedReason`, `notesUrl`, `skipped`.

**Two clocks.** `observedAt` is the last SUCCESSFUL observation; `attempt
{at, error?}` is the last attempt. A failed attempt never overwrites a good
observation; a subject with no success yet is `unknown` with the error on
`attempt`. UIs say "Could not check: <error>" from those fields — never from
a message string.

**Skip is an identity, not a flag.** `skipped` holds the full available
identity (version + sha + digest; artifact offers carry the index entry's
sha256 as `digest`); `isUpdateSkipped` compares it with the current
`available`, so two successive same-version commits are two distinct skips
and the row returns on its own when the source moves. A REQUIRED update
cannot be skipped — the engine refuses (`409 required` over HTTP) and a skip
persisted before the group moved lapses at reconcile. The tab count is
`countAvailableUpdates` (update-available, not skipped — required rows count
too).

**Fingerprints retire observations.** Each subject's fingerprint hashes its
installed identity plus everything its eligibility depends on (plugin: lock
entry + `APP_VERSION` + platform + `EXTERNALS_CONTRACT`; search engine /
models: the adapter-reported STRUCTURAL identity + required pin + normalized
search settings; gateway: runtime id + required protocol; bakin: version +
platform). At boot the engine reconciles persisted records against the
current inventory BEFORE serving them: a stale record is served as `unknown`
with `attempt.error = 'inventory changed'` and is due immediately. A late
observation carrying a stale fingerprint is dropped.

## Sources and scheduling

A source implements `inventory()` (the subjects it knows) and
`observe(entry, { signal, conditional })` (one subject → an observation).
Network policy (D7.6): only the source a subject was installed from; GitHub
REST only for the Bakin release, with `If-None-Match` from the persisted ETag
(304 ⇒ unchanged; 403/429 ⇒ backoff honouring `Retry-After`); artifact
indexes with conditional headers; git refs via async `git ls-remote` through
`gitArgs` + `Bun.spawn` (never the synchronous upgrade-gate wrapper). The
antfly version probe runs under the observe signal and kills + reaps its
child on abort.

The timer (D7.5) runs an independent tick: per-subject due times
(`settings.updates.intervalMs`, default 6 h, clamped [15 min, 7 d]), overdue
subjects ~60 s after boot, two subjects in flight at a time, 20 s per
subject with cancellation propagated through fetch/git/adapter checks,
failure backoff 15 min doubling to 24 h per subject (a source's
`retryAfterMs` wins). "Check now" (`POST /api/updates/check[?source=|?id=]`)
coalesces into a running pass and queues the subjects it has not reached;
`wait=1` answers with the records after the pass. `settings.updates.enabled`
is re-read each tick; disabling lets the running subject finish. The interval
is read at scheduling time too: a successfully checked subject is due one
CURRENT interval after it ran (shortening the setting reschedules everything
without a restart); a failed one keeps its recorded backoff.

**The inventory is refreshed** at the start of every pass and every explicit
check (pass startup is serialized, so a tick and a check never run two
worker pools), and at once on `plugin:manifest-changed` / `settings.changed`
(the service observes server events) — an installed plugin joins, a removed
one leaves, a changed setting retires the affected fingerprints. A source
whose ENUMERATION fails (a hung probe, a dead remote) keeps its known
subjects with a failed attempt — unknown is not absent — at boot too, where
the persisted record is the known subject. An explicit check for a subject
id re-observes it even when the running pass already reached it (the caller
knows it changed), is observed even when scheduled work was disabled
mid-pass, and rejects (`UpdatesStoppedError`) once the timer is stopped —
a check never answers "done" without having looked. Checks enter through ONE
admission path, `timer.admit()`: the inventory is refreshed once, inside the
serialized pass startup (concurrent requests never fan out probes — a
search-engine enumeration runs the binary version probe), ids are validated
against THAT inventory (a plugin installed a moment ago is known; an unknown
id rejects with not-found before anything runs), and the admission answers
with the accepted ids plus a `done` promise. `POST /api/updates/check` is a
thin client: 404 for an id outside the refreshed inventory, 503 when the
engine stopped during the admission (re-checked after the refresh — never
an accepted check nobody will run), 202 with the admitted ids, or
(`wait=1`) the records once `done` settles. The pass queue holds ATTEMPTS
(`{ id, waiters }`): a request rides the queued attempt for its id or
appends its own, and a subject that is gone when that attempt's turn comes
(removed after admission; or removed during a non-cooperative observer's
grace, where the deadline has nowhere to land) is marked on THAT attempt's
waiters only — the request that named it rejects with not-found (404 in
wait mode), never a successful check that never looked; a broad request
simply no longer has it; a later attempt for a reinstalled subject is its
own, untouched by the earlier miss. Engine refusals never escape an
attempt and the pass keeps `running` until every worker has settled
(`Promise.allSettled`) — one subject's disappearance never rejects the
pass or releases its ownership under a worker still observing. Inventory
refreshes are serialized INSIDE the engine (`refreshInventory` chains), so
the timer's admissions and the service's plugin/settings events never
enumerate at once and a slow enumeration started under old facts can never
reconcile after a newer one. A repeated id in one request is ONE attempt.
The git-ref plugin source asks `ls-remote` for `<ref>` AND `<ref>^{}` (git
filters the peeled row against the patterns too) and resolves ONLY an
exact candidate (`pickLsRemoteSha`): for a bare name the branch first,
then the tag; for a `refs/...` name that ref — and for an annotated tag
the PEELED commit, what the clone's `HEAD` is and what the lanes hold the
identity to, never the tag object (an unchanged annotated tag is
`current`, a moved one a real offer). A suffix match, a remote-tracking
row or "the first row" is never an answer: a tracked ref that is gone
yields null and the subject is `blocked`.

**One attempt, one result.** On the deadline the signal fires; a cooperative
observer settles through the engine and records the deadline as its ONE
failure. An observer that ignores its signal gets a bounded grace
(`UPDATES_CANCEL_GRACE_MS`), then the slot is released and
`engine.recordFailure` retires THAT attempt (the timer names it with a
token; a newer attempt is left alone) — a result that lands later is
dropped, never counted twice. The antfly version probe propagates an
interruption (`CommandInterruptedError`) instead of answering `null`, so a
probe that did not finish is a failed attempt, never a "wrong version"
observation.

Every observation publishes `updates.changed { ids }` on the shared SSE bus
as a PLUGIN-EVENT envelope (`{ type: 'plugin-event', event: 'updates.changed',
ids }`) — the only shape the shell fans out to `usePluginEvent`; the doctor
refresh coordinator reads the inner name and re-runs the checks that consume
records (`plugin-artifacts` for plugin subjects, `search` for engine/model
subjects).

## Actions and apply

An action is `{ kind: 'operation', start: { route, body? }, impact:
('server-restart' | 'search-interruption' | 'reindex' | 'download')[],
downloadBytes? }` or `{ kind: 'manual', pointer }`. A record is never
authorization: the server re-validates at apply time.

ONE apply service (`src/core/updates/apply.ts`) behind `GET
/api/updates/:id/apply-preview` + `POST /api/updates/:id/apply` and the CLI:

1. **Preview.** If a pending `health-repair` approval's frozen proposal
   covers the subject's observations, the preview returns that approval's
   COMPLETE scope (every item, incident and subject it executes, plus a
   `scopeHash`); more than one covering approval ⇒ `409
   multiple_covering_approvals` with a pointer to Health.
2. **Confirm.** `assertOperatorDecision` first (agents, in-process agent
   tool calls and undeclared callers are refused `403` — #898 provenance
   comes from the transport, never the body). The body names the available
   identity the operator REVIEWED (`target: { version?, sha?, digest? }` —
   the preview's record): missing ⇒ `400 target_required`, moved since the
   preview ⇒ `409 target_changed` with the current offer — a background
   observation can never change what gets installed. With `{ approvalId, scopeHash }`
   the service resolves the approval through the one approval path (`409
   scope_changed` when the hash moved or it is no longer pending); with a
   covering approval and no scope ⇒ `409 approval_required`. Otherwise it
   runs the subject's own flow: plugin upgrade preview → consent token →
   commit (`consentToken` in the body); search engine = ONE operation
   holding `search-engine` from install through the repair reindex
   (`searchEngineReinstallOperation`); search models install; Bakin = the
   self-update operation. `409 nothing_to_apply` / `manual_action` /
   `unsupported_subject` otherwise. Every route that starts an operation is
   listed in `tests/architecture/operations-routes.test.ts`. Once the
   operation SUCCEEDS — started or attached, including a resolved approval's
   repair — the subjects it changed are re-observed (every subject in an
   approval's scope); a failure re-observes nothing. Watches live in
   `src/core/updates/apply-watch.ts`: ONE subscription per operation id
   (attachments merge their ids), dropped on any terminal state and disposed
   with the service — a stuck operation never accumulates listeners.
   The reviewed identity goes all the way down: EVERY plugin lane receives it
   as `UpgradeOptions.expected` and holds its candidate to it with
   `assertUpgradeTarget` — in-place github and subpath lanes the commit the
   ref resolves to (`{ version, sha }`), the artifact lane the published
   tarball's sha256 (`{ version, digest }`), the local lane the digest of a
   private SNAPSHOT of the source (`{ version, digest }` — the source is a
   live directory someone may be editing, so the lane resolves a symlinked
   root, copies it into `.upgrade-staging-*` and reads, verifies, records
   and installs exclusively from that snapshot: the digest the identity
   names is the digest of the bytes that land; a symlink INSIDE the tree is
   refused outright — the hasher ignores links, so no digest could vouch for
   what one points at — `runtimeSymlinksIn`, same skip set as the hasher) —
   refusing a ref that moved, a
   republished artifact or a moved tree even under an unchanged manifest (and
   so a still-valid consent token). A reviewed field the lane cannot report
   is itself a refusal: a lane that cannot prove the identity never installs
   on it. Every non-noop `UpgradeResult` carries that verified `identity`.
   Health's `upgrade-plugin-artifact` repair freezes it in its approved
   targets (`plugin:<id>@<version>#<manifestSha>!<artifactSha256>`) and
   commits with `expected: { version, digest }`, so a covering approval
   resolved through `confirmApply` is bound to the artifact bytes it showed —
   a republish under the same version and manifest is a different artifact
   and never rides an old approval. The upgrade operation's fingerprint hashes
   the FULL consent token and the canonical reviewed identity
   (`upgradeRequestKey`): identical requests attach, a request for another
   identity is its own operation and runs its own guard. The search-models
   install re-reads the live model set once it holds the resource and fails
   `target_changed` when it no longer matches the reviewed digest
   (`available.digest` = the sorted required model set).

## Self-update (D7.11)

`selfUpdateOperation` (download → verify → prepare-restart → swap [point of
no return] → restarting) is the ONLY caller of `selfUpdate(` (architecture
pinned). Staging files are keyed by operation id and the fingerprint carries
the approved version, so a request for another release never attaches. The
operation is BOUND to that release (`expectedVersion` from the reviewed
target): a newer release published between preview and execution fails the
update before any download ("Release changed … check for updates and apply
again") — the operator approves one identity, never "latest". While the
update is still reversible it is cancellable: the operation's signal reaches
the updater (`SelfUpdateOptions.signal`), the release fetch runs under a
30 s deadline composed with it, and both transfers ride the shared
`downloadToFile` primitive (stall window, 10 min attempt deadline, abort —
never a raw fetch piped to disk); a cancel aborts the transfer, removes the
staging files, leaves the binary untouched and ends the operation
`cancelled` (the updater's exit is mapped through `op.throwIfCancelled()`),
releasing `install-state` instead of stranding it behind a stalled body. The
`restarting` stage goes active only AFTER the restart is activated: a failed
activation is a terminal `restart_failed`, never a handoff — and so is a
deferred restart command that fails later (`RestartScheduleResult.settled`
reports the kick/signal's own outcome; the operation races it against the
process exit and releases `install-state` instead of waiting forever). The operation ends with the
OLD process: a follow that ends `restarted` (or the `restarting` stage) is
the honest terminal state and the handoff to verification. Verification is
client-side and explicit: `{ expectedVersion, oldBootId }` → poll `GET
/api/version` until `bootId !== oldBootId && version === expectedVersion &&
state === 'serving'` (90 s; every request and body read is bounded by what
is left of the deadline, composed with the caller's cancellation) →
`verified <v>` / `wrong version <v>` / `unreachable — verify by hand`. The
CLI hands off the moment the `restarting` stage goes active (it stops
following; a terminal outcome from a process that is ending never comes);
the browser does the same from the stage or a `restarted` settle, and every
other settle (failed, cancelled, expired) is reported in the dialog with
Update available again. The server publishes `server.lock` under
`install-state`, so a swap can never race a starting server.

`bakin update`: with this home's server running (`server.lock`) it waits for
it to listen (≤30 s; "Bakin is starting — retry" otherwise), reads the
`bakin:bakin` record, posts the apply with the CLI's identity headers and the
per-boot CLI secret, follows the operation to the restart and verifies. With
no server it runs the same operation in-process under `install-state` with
`restart: 'none'`, refusing if a server came alive meanwhile. Applying
through a server is an operator action: `bakin update --as human`; an
`undeclared` refusal is translated into exactly that hint. The header banner
(`bakin:bakin` only, D7.7) does the same through `startOperation` +
`useOperation` + `useSelfUpdateVerification`, then reloads.

## Surfaces

- **Health → Updates** (`?tab=updates`): Required and Available groups, every
  non-current record as a row with the state in words, skipped rows behind
  `?updates_skipped=1` (only an AVAILABLE update can be skipped — a required
  one is what the installation needs), `?update=<id>` reveals a row and
  focuses its first control; Check for updates runs a waited pass. The whole
  apply flow lives in one `ConfirmDialog` (impact + full approval scope →
  progress → consent / restart handoff → result); an apply that resolved a
  covering approval settles on the REPAIR's outcome, never decoded as the
  subject's own flow. The tab label carries the count. The nav badge stays
  incidents-only; no toasts.
- **System tab:** a plugin's "Update available" is the engine's verdict; its
  "Check for updates" runs the plugin pass. (The manifest's own
  `upgradeAvailable` projection migrates in PR B.)
- **Overview:** an incident whose resources name an offered update (plugin
  id, the search-engine service, the embedder setting, the active runtime)
  links "View update" to its row by record id — identity, never copy.
- **CLI:** `bakin updates [--check] [--source <kind>] [--json]` (serverless
  `--check` builds the engine in-process over this home), `updates skip <id>`,
  `updates apply <id> [--yes] --as human` (preview → confirm → follow; the
  plugin consent loop; `bakin:bakin` delegates to `bakin update`).

## Invariants

- The engine's record is the only source of "an update exists". No consumer
  probes a source itself (the header, Health, Explore, Team, the CLI read
  `/api/updates`; in-process callers use the observer functions).
- Missing, failed or stale evidence is `unknown` with the error — never
  "current", never hidden.
- No auto-update, no "Update all", release notes are a link only (D7.8).
- Applying re-validates; a record is never authorization; every apply is an
  operator decision under #898 provenance.
- The self-update never replaces the binary beside a live server, and no
  server-side binary replacement exists outside the operation.
- Search/runtime facts cross the adapter boundary as structured fields
  (`applicable`, `installed.identity`, `required`, per-model `state` +
  `remediation`, `compatibility()`); core never parses adapter messages or
  imports an adapter pin.
