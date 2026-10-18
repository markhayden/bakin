# Operations — staged progress for long-running work (#895)

One primitive for every flow that can take more than a few seconds: installs,
upgrades, repairs, syncs, onboarding steps, the runtime switch, search reset
and reindex. It answers four questions from the browser or the CLI — what is
it doing now, what is left, is it stuck, and what happened — and replaces the
spinner-only and job-specific paths the 2026-09-21 margo incident exposed.

Spec: `.claude/specs/operations-progress/SPEC.md` (decisions D1–D24); the
delivery plan and its success-criteria evidence: `PLAN.md` beside it. Every
flow below is converted; the legacy job registry, the throw-on-busy lock API,
the local-operation wrappers and the private progress streams are gone
(architecture-test pinned: `tests/architecture/operations-*.test.ts`).

## Map

| Piece | Where |
|---|---|
| Leaf types, quiet table, `operationQuietState`, plugin API types | `packages/sdk/src/types/operations.ts` (re-exported by `@bakin/core/operations`) |
| Registry: lifecycle, attach, cancel, outcomes, events, audit | `packages/core/src/operations/registry.ts` |
| Resources: lock files, canonical order, ownership context | `packages/core/src/operations/resources.ts` |
| In-process runner | `packages/core/src/operations/local.ts` (`runLocal`) |
| Plugin rules (namespacing, origin, resource authorization) | `packages/core/src/operations/plugin.ts`, `origin.ts` |
| In-memory resources (SDK harness) | `packages/core/src/operations/memory-resources.ts` |
| The process registry + SSE/audit wiring | `src/core/operations.ts` (`getOperationRegistry`, `runLocal`, `noteOperationsShutdown`) |
| HTTP surface + converted-route start | `packages/host/src/api/operations.ts` |
| Transfer primitive (events, abort, `opTransfer`) | `packages/core/src/net/download.ts` |
| Owning helpers for in-process callers | `src/core/operations.ts` (`runOwning`, `awaitOperationResponse`) |
| Install/lifecycle plans | `src/core/agent-packages/operation-plans.ts`, `src/core/plugins/operation-plans.ts` |
| Search reindex/reset operations + plans | `src/core/search-operations.ts`, `packages/host/src/api/search/maintenance.ts`; engine/model plans in `packages/adapter-antfly/src/{installer,models}.ts`, pull progress in `pull-progress.ts`, `ENGINE_RESET_STAGES` in `packages/core/src/adapters/search` |
| Route outcome helper | `packages/host/src/api/operations.ts` (`outcomeFromResponse`), `packages/core/src/operations/outcome.ts` (`responseOutcome`) |
| Children + the D22 precedence | `packages/core/src/operations/children.ts` (`parentOutcome`, `tallyChildren`, `CHILD_SKIPPED_CODE`); `registry.startChild` |
| CLI follow + renderer + targeting | `src/cli/http.ts` (`followOperation`, `resolveCliTarget`, `cliFetch`), `src/cli/operation-renderer.ts` |
| Health repair as an operation | `src/core/doctor-repair.ts` (`startDoctorRepair`, `awaitDoctorRepair`, `REPAIR_PARENT_PLAN`) |
| Converted-route start schema | `packages/core/src/operations/schema.ts` (`operationStartResponseSchema`) |
| Browser follow hook + start helper | `src/hooks/use-operation.ts` → `@makinbakin/sdk/hooks` (`useOperation`, `startOperation`, `OperationStartError`) |
| Progress pattern | `packages/sdk/src/patterns/operation-progress.tsx` → `@makinbakin/sdk/patterns` (story `Components/Feedback/OperationProgress`) |
| Header tray + live list | `packages/host/src/components/operations/{operations-tray.tsx,operations-list.ts}` |
| Attention (toast + OS notification) | `packages/host/src/components/attention/{operation-attention.ts,operations-attention-provider.tsx}` |

## The model

An operation has a **plan declared before it starts**: stages of fixed kinds
(`preparing, downloading, extracting, building, installing, verifying,
committing, cleanup`) and a `pointOfNoReturn` — the first stage that changes
anything outside staging. `'start'` means never cancellable; `null` means
cancellable throughout (previews, model pulls: nothing live changes until an
atomic publish at the end). Waiting for a resource is an **overlay**
(`waitingFor`), never a stage.

The installer reports only through its `OperationContext`:
`stage`, `item` (per-item status, concurrent items allowed), `bytes`
(`total: null` = size unknown), `attempt` (retry N of M with a reason),
`output` (liveness + log, **never progress**), `log`, `skip`,
`throwIfCancelled`, `holds(resource)`. It never broadcasts and never takes
locks; it returns an `OperationOutcome` (`status`, `code`, `httpStatus`,
`body`). A throw is `failed / unexpected` (500 `{ error }`).

**Two clocks (D4).** `lastProgressAt` moves only on measurable advancement —
bytes up, an item or stage completing, a skip. `lastLivenessAt` also moves on
output and retries. `operationQuietState(view, now)` (pure, shared by server,
CLI and UI) judges quiet/stuck from progress alone against
`OPERATION_QUIET_THRESHOLDS` (downloading/preparing 10s/30s;
extracting/verifying/committing/cleanup 15s/45s; building/installing
30s/120s; a stage's own `quiet` overrides). Waiting is never quiet unless the
holder is stale. The registry's stuck sweep logs "looks stuck" **once per
stage**.

## Registry

`createOperationRegistry(deps)` takes its side effects by injection
(`publish`, `audit`, `log`, `bootId`, `now`, `acquireResources`); the app
singleton in `src/core/operations.ts` wires SSE, `audit.jsonl` and the
server log, and is HMR-safe on `globalThis`.

- **Start** (`start(input)`): an identical live `fingerprint` (kind +
  normalized inputs) **attaches** — the caller gets the same id with
  `attached: true`, and if the original is still validating, the attacher
  waits for that and gets the same rejection. Otherwise the operation is
  registered, `validate` runs (a throw unregisters it and reaches the caller;
  throw `OperationRejectedError(httpStatus, body)` to keep today's 4xx), the
  caller gets `{ operationId, bootId }`, and the work runs.
- **Resources:** after the start answer the operation acquires its declared
  resources in canonical order, shows `waitingFor` (holder title + id) while
  blocked, stays cancellable while waiting, runs `revalidate` after a wait
  (returning an outcome ends the operation without running), runs inside the
  ownership context, and releases before the terminal view is published.
- **Cancel** (`cancel(id)` → `cancelling | not_cancellable | not_found |
  already_finished`): only before the point of no return. It aborts
  `op.signal`; a later `op.stage(...)` or `throwIfCancelled()` raises
  `OperationCancelledError`, so the run can never cross into the point of no
  return after a cancel request. `cancelled` is published only after `run`
  settles; a run that finishes anyway keeps its own outcome.
- **Events (D9):** every change bumps a monotonic `rev`; every event is the
  **complete view** (`operation.updated` in the plugin-event envelope, log
  trimmed to the last 20 lines; reads carry the full 100-line tail).
  Milestones (start, stage, item done, attempt, waiting, cancel, stuck,
  finish) go through the replayable `broadcast`; tick-only changes go through
  `broadcastEphemeral`, coalesced to one per 500ms per operation. Keeping the
  highest `rev` within one `bootId` is always safe.
- **Finish:** one `operation.<status>` audit record per top-level operation
  (kind, owner, origin, title, duration, code; channel from origin), a log
  line, waiters resolved. Finished top-level operations stay listed for 1
  hour, at most 50.
- **Shutdown:** SIGTERM notes "Server stopping" in every live log (no audit);
  the next boot answers with a new `bootId`, which clients report as
  "restarted — outcome unknown".

## Resources (D23)

Three core resources, always acquired in this order: **`install-state`**
(the historical `~/.bakin/install.lock` — packs, plugins, plugin assets and
skills share `~/.bakin/bin`), **`media-store`** and **`search-engine`**
(`~/.bakin/locks/<name>.lock`). Plugin-private resources
(`<pluginId>:<name>`) live under `~/.bakin/locks/<pluginId>/` and sort after
the core ones. Adding a fourth core resource is an approval checkpoint.

- O_EXCL lock files with holder metadata `{ pid, bootId, operationId,
  title, acquiredAt }`; old readers only look at `pid`/`acquiredAt`.
- Stale = dead pid, or this pid with no live holder here (a crashed
  in-process holder). Stale files are reclaimed and the reclaim is logged on
  the waiting operation.
- `acquireResources` waits abortably (a lease obtained after an abort is
  released at once); `tryAcquireResources` never waits — for background work
  (the search migration pump and boot resumption take `search-engine` this
  way for their whole pass as "Background index migration", or defer to the
  next tick; the wedge watchdog acts for a holder running migrations here —
  that holder keeps the resource until the bounce settles — and defers for
  any other).
  `holdNow(resources, identity, fn)` wraps it for the bounded synchronous
  writers (lesson toggle, plugin unlink, skill-map apply): it takes the
  resources inside the ownership context or throws `ResourceBusyError`,
  which the route answers 409 `{ ok: false, error: 'install_busy', message,
  holder: { title, operationId } }`. It never takes over a live foreign
  holder.
- **One ownership context** (AsyncLocalStorage: `runHolding`,
  `heldInContext`): acquisition is reentrant within one operation's call
  chain and never across siblings. Locks are never shared across an
  operation tree.
- **Writers assert, owners hold.** Every install-state writer calls
  `assertResourceHeld('install-state', '<writer>')`; outside an owner it
  throws `<writer> requires install-state — run it inside an operation that
  declares it (or holdNow for a bounded synchronous writer)`. The legacy
  throw-on-busy install-lock API and its job registry (`/api/install-jobs`,
  `packages.install_*` events, `?async=1`) are gone.
- Only `resources.ts` names `install.lock` or `locks/`
  (`tests/architecture/operations-resources.test.ts`). Antfly's own service
  lock under `~/.antfly` is a different lock and stays as it is.

## In-process: `runLocal`

`runLocal(input)` (app) / `runLocal(registry, input)` (core) runs the same
machinery and resolves with the terminal view instead of answering 202 —
same views, events, resources and audit. Validation failures reject. Used by
in-process callers (approvals/escalation) and by in-PR callers of
`op`-taking helpers. The CLI's in-process mode starts operations on the
process registry and renders them through `subscribeOperationUpdates`.

`runOwning({ kind, title, resources }, fn)` is the thin form for in-process
callers that only need ownership (the runtime switch's drift-gated sync): a one-stage,
non-cancellable local operation that returns `fn`'s value and rethrows its
error. `awaitOperationResponse(res)` lets an in-process caller of a
converted route await the 202 and read the old status + body.

## HTTP

| Route | Answer |
|---|---|
| `GET /api/operations` | `{ bootId, operations }` (top level, newest first) |
| `GET /api/operations/:id[?children=1]` | `{ bootId, operation, children? }` · 404 `{ bootId, error: 'not_found' }` |
| `POST /api/operations/:id/cancel` | 202 `cancelling` · 409 `not_cancellable` / `already_finished` · 404 — each `{ bootId, status }` |

Every answer carries the server's `bootId`: a client holding the same one
reads a 404 as **expired**, a different one as **restarted**. Converted
routes answer through `startOperationResponse(input)` — 202 within 500ms
even while the run is blocked or waiting (pinned in
`tests/api/operations.test.ts`), 200 `attached: true` for an identical live
request. `operationOriginFromRequest` reads the CLI's `X-Bakin-Origin: cli`
marker; everything else over HTTP is `web`. `discord` and `system` are
in-process only.

## Transfers

Every artifact transfer (archives, tarballs, binaries, model files, release
indexes) streams through `downloadToFile` / `downloadText` in
`packages/core/src/net/download.ts`: stall window, attempt deadline, fresh
retries (never on `DownloadChecksumError` or abort), partial removed on any
failure. `onEvent` reports `attempt` / `bytes` / `stalled` / `retry` (reason
`stalled | deadline | http | network`); `signal` aborts without retry and
rethrows the abort reason; `opTransfer(op, stageId, itemId)` maps the events
onto the operation. Tar helpers take `signal` + `onOutput` (stderr lines →
`op.output`). Installer modules never buffer or hand-roll a download
(`tests/architecture/operations-transfers.test.ts`). Details:
`.claude/knowledge/media-pipeline.md` § Download resilience.

**antfly model pulls** are a subprocess, not a transfer: `antfly inference
pull` writes into `<owner>/.<name>.antfly-download-staging/` with `.part`
files, publishes atomically, resumes at byte level after SIGTERM/SIGKILL and
reports structured progress on stderr — so model pulls have no point of no
return and cancel keeps the staging dir for the resume. The pull **ignores
`ANTFLY_HOME`**; pass `--models-dir`. Evidence:
`tasks/evidence-antfly-pull.md`.

## Plugins: `ctx.operations` (D19)

`ctx.operations.start({ kind, title, href?, fingerprint, resources?, plan,
request?, run })` and `ctx.operations.await(id)`, on the full context and on
route handlers' `PluginContextLite`. Rules (`toPluginOperationInput`, shared
by host and harness): kind and fingerprint are stored as `<pluginId>:…` and
the owner is `plugin:<id>` (separate from origin); origin comes from
`request` (web/cli), else `system`; any plugin may declare its own
`<pluginId>:<name>` resources, and the core resources are reserved for core
plugins (`OperationResourceDeniedError`) — the same rule as repair resource
declarations (D10). Not permission-gated: a plugin only ever reaches its
own namespace and resources. `@makinbakin/sdk/testing` runs a real registry
with in-memory resources (`createMemoryResourceAcquirer`) so author tests
never touch a real Bakin home.

## Browser

- **`useOperation(id, { bootId })`** follows one operation over the shell's
  single SSE connection (`operation.updated`) and reconciles from
  `GET /api/operations/:id?children=1` on `bakin.reconcile`. Guards: a view
  applies only with a higher `rev`; events from another boot never apply; a
  read answered by another boot latches `restarted` and nothing after it
  applies (not even a late old-boot answer); a same-boot 404 is `expired`
  (a finished view stays finished when it ages out); a failed read is
  `unreachable` and retries with backoff 1/2/4/8/15s, keeping the last view.
  The reducer is pure (`reduceOperationFollow`). `phase` is the SDK type
  `OperationPhase`.
- **`startOperation(fetcher)`** returns `{ operationId, bootId, attached? }`
  for a 202/200 and throws `OperationStartError { status, body }` for the
  route's own refusal (D22 keeps today's 4xx).
- **`OperationProgress`** is SDK-owned (beside the search patterns) because it
  renders SDK types and the private kit (`@bakin/ui`) may not depend on the
  SDK (`ui-package-boundary` test). Children nest under the parent's FIRST
  stage (a repair parent's plan is its children, then verifying). It ticks its
  own clock only while live; `now` pins it for stories/tests.
- **Tray** (`OperationsTray`, mounted in the header): visible only while
  something runs or finished in the last 2 minutes (`RECENTLY_FINISHED_MS`);
  top-level operations only (children roll up); a new boot replaces the list;
  a malformed list answer is ignored rather than crashing the header. Popover
  pattern — opening focuses the first row's Cancel, Escape returns focus to
  the trigger.
- **Attention** (`OperationsAttentionProvider`, beside
  `ApprovalsAttentionProvider`): pure rules in `nextOperationAttention`.
  Finished/failed once per operation (memo survives SSE milestone replay),
  stuck once per stage (judged with `operationQuietState` on the stuck
  milestone the registry's sweep publishes — never from log text), cancelled
  never. Only `origin ∈ {web, cli, discord}`; system work and children stay in
  the tray; nothing announces while the person is on the operation's `href`.

## Children (D10/D21)

`registry.startChild(parentId, input)` — repair actions are the only users.
A child inherits the parent's owner and origin, namespaces its fingerprint
under the parent's, acquires its OWN declared resources (the parent holds
none) and resolves with its terminal view. Children are fetchable by id,
never listed on their own, and evicted with the parent. The parent latches
non-cancellable once any child passes its point of no return; cancelling
the parent cascades to children that can still stop and refuses new ones;
the parent settles only after every child has settled (allSettled join).
Child progress and liveness move the parent's clocks; the top-level audit
carries the child tally. A child that found nothing to do finishes with
`CHILD_SKIPPED_CODE`; one that changed something before failing finishes
with `CHILD_PARTIAL_CODE` and tallies as applied AND failed. Work that
never got a child (a repair action unregistered after validation) is added
to `failed` by the caller. Precedence (first match wins): cancelled with
nothing applied → `cancelled`; applied + failed/cancelled →
`partially_applied`; nothing applied + failed → `apply_failed`; all skipped
→ `nothing_applied`; applied + verification failed → `verification_failed`;
else `ok`. A repair's verification is evidence, never absence: every
affected check must have run fresh (`checkEvaluatedFresh`) and no selected
observation may still be unhealthy — a check that vanished is not a pass.

## CLI (D11)

- **Targeting** (`resolveCliTarget`, resolved once): explicit `BAKIN_URL`
  as given (unreachable is an error) → the live `server.lock` of THIS
  `BAKIN_HOME` (`readLiveServerLock`: present and pid alive) → no target:
  server requests throw `BakinNotRunningError` ("Bakin isn't running for
  <home>") — never a guess at port 3737, which may belong to another home.
  Every request goes through `serverBaseUrl()` / `cliFetch` and carries
  `X-Bakin-Origin: cli`. Tests pin `BAKIN_URL` in the preload so no test
  reads this machine's real lock.
- **Mode** (`src/cli/operation-mode.ts`) for install-class verbs
  (`bakin install *`, `bakin mkdir`, `bakin settings init`, `bakin onboard`):
  explicit `BAKIN_URL` → server-only (refused = `ServerUnreachableError`);
  a live lock → that server, with the lock's `cliSecret` as
  `X-Bakin-Cli-Secret`; no lock → in-process. A lock-chosen server that
  refuses the connection BEFORE anything was sent (Bun's typed
  `ConnectionRefused`) has died since the lock was read → in-process; once
  any request reached a server nothing falls back. In-process Ctrl-C
  (`followLocalAndRender`): once cancels and waits for the settle (or says
  it can't stop now), twice force-exits 130 — boot recovery checks the
  install transactions on the next start.
- **`cliSecret`**: the server writes `server.lock` 0600 with a fresh
  per-boot secret (never served over HTTP); `cliSecretMatches` compares in
  constant time against the lock THIS server holds. It authorizes exactly
  one thing: `allowServiceClaim` on the onboarding install route.
- **`followOperation(start)`**: the SSE stream (`Last-Event-ID` resume,
  backoff) plus an immediate snapshot and one on a timer; phases `finished`
  / `expired` / `restarted` / `detached`.
- **Renderer** (`followAndRender`): `tty` live frame, `plain` transition
  lines (byte quarters, never a flood), `json` one document. Children
  render with their own active stage, attempt and per-item bytes (a repair's
  real transfer lives in its child) in both tty and plain. Ctrl-C once
  cancels when allowed (otherwise says why), twice detaches (exit 130) — in
  EVERY mode: a command printing its own JSON passes
  `silentOperationRenderer()` (notes to stderr) and keeps the handling.
  `operationExitCode`: 0 succeeded, 130 cancelled/detached, 1 otherwise;
  the JSON document's `exitCode` is the same number.

## Installs and lifecycle

Every install-state flow is an operation; the route's old JSON body is the
operation result (`outcomeFromResponse`), so clients read the same shapes
after following. Synchronous 4xx (invalid body, unknown id, core plugin)
stay synchronous via `OperationRejectedError`.

| Flow | Route | Plan | Owns install-state | Point of no return |
|---|---|---|---|---|
| Package / agent-package install | `POST /api/packages/install`, `/api/agent-packages/install` | `PACKAGE_INSTALL_PLAN` | yes | `install` |
| Package / agent remove | `DELETE /api/packages/:id`, `/api/agent-packages/:id` | `PACKAGE_REMOVE_PLAN` | yes | `remove` |
| Sync (agent, pack, team-wide; `teamId=global` = all) | `…/sync`, team routes | `PACKAGE_SYNC_PLAN` / `teamSyncPlan` | yes (`--check`: no) | `install` / `sync` (check: none) |
| Managed-block migration | `POST /api/agent-packages/migrate` | `MIGRATION_PLAN` | yes | `migrate` |
| Plugin install / upgrade preview | `POST /api/plugins/{install,upgrade}` | `PLUGIN_PREVIEW_PLAN` | no | none — ends `awaiting_consent` or `ready` |
| Plugin install / upgrade commit | same + `accepted` + token | `PLUGIN_COMMIT_PLAN` | yes | `replace` (journal-first rename) |
| Plugin remove / restore / link | `POST /api/plugins/{remove,restore,link}` | `PLUGIN_{REMOVE,RESTORE,LINK}_PLAN` | yes | `start` / `place` / `link` |
| Hub-skill preview / map preview | `POST /api/skills/{preview,map/preview}` | `SKILL_PREVIEW_PLAN` / `SKILL_MAP_PLAN` | no | none |
| Hub-skill install | `POST /api/skills/install` | `SKILL_INSTALL_PLAN` | yes | `install` |
| Lesson toggle, plugin unlink, skill-map apply | synchronous | — | `holdNow` (409 `install_busy`) | — |

Shared helpers report through an optional `op` (`RequirementOp { op,
stageId }` for bins/models/npm/managed bun — each download is an item with
byte progress via `opTransfer`; `buildUserPlugin` streams build output as
liveness; `replacePluginDir` maps transaction phases onto stages). `op`
stays optional on engine verbs whose callers have no stage to report into —
ownership is enforced by assertion, not by the parameter. Catch blocks
rethrow `OperationCancelledError`. A stalled hub never holds a request: the
hub verdict runs inside the preview's `fetch` stage, still fail-closed.

Clients: Team (`usePackageOperation`), Explore (`useInstallOperation`),
Health (`startPluginUpgrade` + hook following) and onboarding follow with
`startOperation`/`useOperation` (generation-guarded; `showProgress` hides
the progress once a result arrives so the surface's own result alert is the
only one) and render `OperationProgress`. The CLI's `startAndFollow` /
`operationBody` / `exitOnFailure` (`src/cli/operation-command.ts`) follow
packages, agents, plugins and skills commands (JSON → silent; piped →
plain progress on stderr; TTY → live).

`tests/architecture/operations-install-state.test.ts` pins it: deleted
symbols never return, no `?async` branch under `packages/host/src/api`,
every caller of an install-state writer owns it (or is an asserting engine
module), converted routes start operations, synchronous writers use
`holdNow`.

## Search (D12/D15/D23)

Everything that changes the engine or its tables owns `search-engine`.

| Flow | Entry points | Plan | Point of no return |
|---|---|---|---|
| Engine install | `bakin install search`, onboarding | `ANTFLY_ENGINE_PLAN` (the setup component's `plan`): prepare → download → checksum → extract → version → commit → cleanup → ready | `commit` (service stop + swap) |
| Model pulls | `bakin install search-models`, onboarding | `ANTFLY_MODELS_PLAN`: download (one item per model) → verify; download overrides quiet to 30s/120s | none — cancel keeps the resumable staging dir |
| Reindex | `POST /api/reindex`, `bakin reindex`, Health, `bakin_exec_search_reindex` (origin `system`) | `REINDEX_PLAN`: one `reindex` stage, a table per item, quiet 60s / stuck 10 min | `start` |
| Reset | `POST /api/search/reset`, `bakin search:reset` | `SEARCH_RESET_PLAN`: `ENGINE_RESET_STAGES` (stop → wipe → boot) → reindex | `start` |

- Installers take the op through `SearchAdapterSetupOptions.op` and assert
  `op.holds('search-engine')`; each setup component declares its `plan`, so
  core never names an antfly stage. They run as onboarding component
  operations (§ Onboarding). An installer's failure path rethrows an
  accepted cancel, so a cancel never surfaces as `engine_install_failed` /
  `models_install_failed`.
- Outcomes: reindex `ok` / `tables_parked` (rows kept); reset `ok` /
  `reset_failed` (a failed wipe, or a rebuild that did not converge — the
  `reindex` rows say which tables, or search turned disabled while the reset
  waited — it revalidates before stopping anything); engine `engine_install_failed`; models
  `models_install_failed`. The result body is `{ ok, errors, parked, total,
  tables }` (reindex) or `{ ok, message, reindex }` (reset).
- A boot resumption deferred by a busy engine is picked up by the next pump
  tick, which then resumes every in-flight row (not only parked ones). A
  clean engine start (install, reset) stamps the progress heartbeat so the
  wedge watchdog never bounces it on a stale pre-reset reading. A cancelled
  pull escalates SIGTERM → SIGKILL after 10s.
- Background mutators: see Resources above and
  `.claude/knowledge/search-system.md` § Blue/green.
- Pull progress and resume facts come from the T0 spike:
  `tasks/evidence-antfly-pull.md`.

`tests/architecture/operations-search.test.ts` pins it: the reindex job
registry, its status route, the any-pass coalescer and `search-reset.ts`
stay gone; no `?async` in the request router; the routes start operations
and the CLI follows them; the rebuild pass asserts ownership; the pump
timer, boot resumption and the watchdog go through the background pass.

## Onboarding (D11)

Every onboarding component install is ONE operation, built by
`componentInstallOperation(component, options, origin)`
(`src/core/onboarding/operation.ts`) — behind both
`POST /api/runtime/onboarding/install` and the CLI's in-process mode, so a
server run and a local run are the same operation (parity-tested for media,
search, search-models, plugin-assets and agent-sync).

- **Contract** (`onboarding/types.ts`): an `InstallableComponent` declares
  its `plan`, `resources` (canonical order), optional `identity()` (search:
  its settings) and `failureCode`, and `install(opts, op)` reports only
  through `op`. A `CheckOnlyComponent` (runtime, llm, channels, budget) has
  no install, only a `manualSetup` pointer the orchestrator records when
  its check is not ok. `isInstallable` tells them apart.
- **Options** are explicit (`OnboardingInstallRequestSchema` in
  `install-request.ts`, zod only, shared by the CLI, the web hub and the
  local path): `autoApprove`, `approvedComponents`, the wizard selections,
  `allowServiceClaim`. Nothing prompts inside an install — the CLI asks
  before it starts (`bakin install <x>` on a TTY without `--yes`) and the
  hub's confirm dialog is the approval. The route never auto-approves and
  honours `allowServiceClaim` only with a matching `X-Bakin-Cli-Secret`
  (403 otherwise).
- **Identity**: kind `onboarding:<name>`, fingerprint = name + options +
  `identity()`. An identical live request attaches. A request that waited
  rechecks `identity()` (`revalidate`) and settles `settings_changed`
  without running if it moved — it never runs under a fingerprint that no
  longer describes it (the A → B → A case is pinned).
- **Outcomes**: `{ ok, result }` (the `InstallResult`, JSON-safe); failed →
  the component's `failureCode` (`component_failed` by default;
  `engine_install_failed`, `models_install_failed`); skipped →
  succeeded/`skipped`.
- **Resources**: search and search-models `search-engine`, media
  `media-store`, plugin-assets / agent-sync / recommended agents and
  capability packs `install-state` (their writers run under the component's
  ownership — no inner `runOwning`). Recommended plugins hold nothing: each
  plugin installs as its own preview → commit operation, listed as items.
- **`bakin onboard`**: `runOnboard(opts, installComponent)` — checks run in
  the CLI process, installs through `runComponentInstall` in the mode D11
  picks; the Ink busy view shows each install's `operationStatusLine`
  (waiting-for included — no silent waits). Checks, provisioning and the
  `.onboarded` marker are this home's, so an explicit `BAKIN_URL` (another
  server) is refused; without it the installs go to this home's own server
  (its lock) or run in-process. Ctrl-C on an install (cancelled, or
  detached from a server run) throws `OnboardingInterruptedError`: nothing
  after it starts, no marker, exit 130.
- **Consent lives before the operation.** `bakin onboard`'s wizard
  (`collectOnboardingSelections`) asks for search, search models, media,
  the model plan and the recommended plugins/agents, seeding an empty
  first-run roster first so a fresh Pi home is asked too; its
  `approvedComponents` approve those installs just like `--yes`.
  `bakin install <x>` on a terminal without `--yes` asks when the check is
  not ok — or, with `BAKIN_URL`, always, naming that Bakin (this machine's
  check says nothing about it); declining starts nothing (not every
  installer gates on approval).
- **Cancel always wins**: `componentInstallOperation` rethrows an accepted
  cancel after the install returns, so a cancel never settles as a success
  or a failure even when the installer didn't check between steps.
- **Hub tabs** are busy from the moment a request is sent — a second click,
  a preview racing a switch, or dismissing the dialog can't race the
  acceptance.
- **Runtime hub**: the Overview tab's Repair (mkdir, settings, search,
  search-models, media, plugin-assets, agent-sync) starts the operation and
  keeps the dialog open on `OperationProgress` (Cancel while allowed) until
  it settles.

## Runtime switch

`runtimeSwitchOperation` (`src/core/runtime-switch.ts`): the phases are
stages (`RUNTIME_SWITCH_PLAN`; the preview declares only its read-only
stages), never cancellable, owning `install-state` — a second switch or a
preview waits visibly (no single-flight flag). The report is the result body
(`switch_failed` when not ok); a restore after a failure is logged against
the failed stage. `POST /api/runtime/switch` answers 202; `bakin runtime use`
follows with the renderer; the Runtimes tab with `useOperation` +
`OperationProgress`. Details: `.claude/knowledge/runtime-capabilities.md`.

## Health repair (D10/D24)

See `.claude/knowledge/doctor-and-health-checks.md` § Explicit repair
protocol (the parent/child run, the route, the dialog, the CLI) and
`.claude/knowledge/approvals.md` § Health decisions (decision first, outcome
after, `afterResolve`, outcome-unknown recovery).

## Tests

- `tests/core/operations/` — types, registry (lifecycle, attach, cancel,
  events, eviction, audit, quiet, shutdown), resources (order, waiting,
  abort, stale reclaim, cross-process, legacy interop), registry↔resources,
  app wiring, plugin rules.
- `tests/api/operations.test.ts` — HTTP matrix, 500ms accept harness, route
  metadata + OpenAPI.
- `tests/core/net/download.test.ts` — transfer events, abort, text, opTransfer,
  tar output.
- `tests/sdk-testing/operations.test.ts` — the published harness, author-style.
- `tests/architecture/operations-{resources,transfers,install-state,search,onboarding,runtime-switch,routes}.test.ts`
  — `operations-routes` is the final converted/synchronous route list with
  each route's resource.
- Install routes: `tests/api/{package-operations,skills-operations}.test.ts`,
  `tests/host/plugins/install-operations.test.ts`,
  `tests/core/plugins/replace-transaction-operation.test.ts`; helpers
  `tests/helpers/{operation-route,operation-fetch,plugin-routes,owning}.ts`
  (`owning`/`owned` run a writer under a test owner).
- `tests/core/operations/children.test.ts` — precedence rows, startChild,
  latch, cascade (parent settles last), clocks, audit tally, eviction.
- `tests/cli/operation-renderer.test.ts`, `tests/cli/cli-target.test.ts`.
- `tests/core/doctor-repair.test.ts` (attach, accept < 500 ms, rejections,
  parent/child, parity), `tests/core/doctor-approvals.test.ts` (decision
  first, old-reader recovery), `tests/plugins/health/repair-dialog.test.tsx`,
  `tests/cli/doctor-repair.test.ts`; every repair group runs
  `tests/helpers/repair-contract.ts`.
- `tests/hooks/use-operation.test.tsx` — rev/boot guards, reconcile, expired,
  restarted (late old-boot answer ignored), unreachable recovery,
  `startOperation`.
- Search: `tests/core/search-operations.test.ts`, `tests/api/search-maintenance-routes.test.ts`,
  the background-mutator block in `tests/core/search-registry.test.ts`,
  `tests/core/onboarding/{antfly,models}.test.ts`; the real-engine check
  `scripts/dev/search-container-check.ts` (developer-run, disposable container).
- Onboarding: `tests/core/onboarding/{operation,install-request,index}.test.ts`,
  `tests/api/onboarding-install-route.test.ts` (claim authority, CLI
  attribution, server/local parity), `tests/cli/{operation-mode,component-install}.test.ts`,
  `tests/core/server-singleton.test.ts` (cliSecret, 0600), the hub in
  `tests/components/runtime-hub.test.tsx`.
- Runtime switch: `tests/integration/runtime-switch*.test.ts` (via
  `tests/helpers/runtime-switch.ts`), `tests/cli/runtime-command.test.ts`.
- `tests/ui/patterns/operation-progress.test.tsx` + the 23 play-asserted
  stories in `storybook/public/feedback/operation-progress.stories.tsx`
  (five visual baselines).
- `tests/host/operations-{tray,attention}.test.tsx`.
