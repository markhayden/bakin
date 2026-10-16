# Operations — staged progress for long-running work (#895)

One primitive for every flow that can take more than a few seconds: installs,
upgrades, repairs, syncs, onboarding steps, the runtime switch, search reset
and reindex. It answers four questions from the browser or the CLI — what is
it doing now, what is left, is it stuck, and what happened — and replaces the
spinner-only and job-specific paths the 2026-09-21 margo incident exposed.

Spec: `.claude/specs/operations-progress/SPEC.md` (decisions D1–D24).
Plan and rollout order: `.claude/specs/operations-progress/PLAN.md`. PR1 ships
the primitive below; PR2 adds the browser hook, pattern, tray and attention
(§ Browser); PR3–PR6 convert
the flows (repair, installs, search, onboarding/runtime) and delete the legacy
job registry (`install-progress.ts`) and the throw-on-busy lock API.

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
| Legacy install-lock facade (deleted in PR4) | `src/core/install-core/install-lock.ts` |
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
  (pump, boot resumption, wedge watchdog: defer to the next tick) and the
  bounded synchronous writers (409 `install_busy`).
- **One ownership context** (AsyncLocalStorage: `runHolding`,
  `heldInContext`): acquisition is reentrant within one operation's call
  chain and never across siblings. The legacy `withInstallLock` /
  `assertInstallLockHeld` API is built on the same context, so inner writers
  keep working inside an operation that holds `install-state`, `runLocal`
  inside a `withInstallLock` body never waits on itself, and the two APIs
  exclude each other. Locks are never shared across an operation tree.
- Only `resources.ts` names `install.lock` or `locks/`
  (`tests/architecture/operations-resources.test.ts`). Antfly's own service
  lock under `~/.antfly` is a different lock and stays as it is.

## In-process: `runLocal`

`runLocal(input)` (app) / `runLocal(registry, input)` (core) runs the same
machinery and resolves with the terminal view instead of answering 202 —
same views, events, resources and audit. Validation failures reject. Used by
in-process callers (onboarding components until PR6, the CLI's in-process
mode, approvals/escalation) and by in-PR callers of `op`-taking helpers.

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
declarations (D10, PR3). Not permission-gated: a plugin only ever reaches its
own namespace and resources. `@makinbakin/sdk/testing` runs a real registry
with in-memory resources (`createMemoryResourceAcquirer`) so author tests
never touch a real Bakin home.

## Browser (PR2)

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
- `tests/architecture/operations-{resources,transfers}.test.ts`.
- `tests/hooks/use-operation.test.tsx` — rev/boot guards, reconcile, expired,
  restarted (late old-boot answer ignored), unreachable recovery,
  `startOperation`.
- `tests/ui/patterns/operation-progress.test.tsx` + the 23 play-asserted
  stories in `storybook/public/feedback/operation-progress.stories.tsx`
  (five visual baselines).
- `tests/host/operations-{tray,attention}.test.tsx`.
