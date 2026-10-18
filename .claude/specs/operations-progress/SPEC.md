# Operations — staged progress for every long-running flow — #895

Status: **done (2026-10-18)** — revision 3.1, approved by the maintainer on
2026-10-15; amended in D23 on 2026-10-17 and 2026-10-18. Delivery and the
success-criteria evidence: [PLAN.md](./PLAN.md).
- Revision 1 came from the kickoff interview.
- Revision 2 applied an independent Codex (`gpt-6-astra`) review (round 1:
  rework).
- Revision 3 applies the round-2 review (rework; 8 of 19 round-1 findings
  resolved, 12 new). It **simplifies** the design per that review: one
  install-state lock plus two global resources, children only for repair,
  complete-view events, and cancel only before the first mutation.
- Every decision that changed was re-decided with the maintainer.
- Revision 3.1 applies the round-3 review (**approve with changes**: "a
  sequenced implementation plan can now be written"): contract corrections
  only, no decision changes.

Reviewed base: `68f4857e9` (main). Branch: `feat/operations-progress`.
Issue: [#895](https://github.com/markhayden/bakin/issues/895).
Implementation plan and commit checkpoints: [PLAN.md](./PLAN.md) (next).

## Objective

On the 2026-09-21 margo incident, the `media.sharp` repair and the Extend
capability installs showed "Applying and verifying…" for minutes while a
download had hung. **Any process that can take more than a few seconds must
show what is working, what is not, and what has hung.**

The single user (this machine) must be able to answer four questions about any
install, upgrade, remove, restore, link, repair, sync, onboarding step,
runtime switch, search reset or reindex, from the browser or the CLI:

1. **What is it doing right now?** The current stage, item x of y, bytes of a
   total or "size unknown", and what it is waiting for.
2. **What is left?** The full stage plan, known before the work starts; for
   repairs, each selected repair's own plan.
3. **Is it stuck?** Measurable progress is tracked separately from "the
   process is alive", so output never hides a stall. Retries show attempt N of
   M and the reason.
4. **What happened?** An explicit outcome (with the server's own response
   body, partial results and verification), the failing stage, an activity
   log, and an honest distinction between finished, expired, "server
   restarted — outcome unknown" and unreachable.

The user can cancel an operation **until it first changes anything outside
staging**. After that, the UI says plainly that the operation will finish.
Nothing claims "cancelled" while work is still settling.

There are no external users. Nothing is kept for backwards compatibility.

## Decisions

| # | Decision |
|---|---|
| D1 | **Scope: every long-running flow.** Health repair apply (UI, CLI, approval-resolved, auto-escalated); runtime-hub one-click; install, upgrade, remove, restore and link for packages, agent packages, plugins and skills; skill-map preview; Team adopt and sync; pack sync and repair; onboarding components; every CLI install/sync/fix verb; the runtime switch (including dry-run); search reset; reindex; and the transfer primitives under them. |
| D2 | **One generic operations primitive.** Public leaf types are owned by the SDK (`packages/sdk/src/types/operations.ts`) and re-exported by core. The registry lives in `packages/core/src/operations/`. It replaces `src/core/agent-packages/install-progress.ts` entirely. |
| D3 | **In-memory and boot-aware.** Identity comes from `src/core/boot-id.ts`. Start responses, snapshots, lists and 404s carry `bootId`. Clients distinguish finished, expired (same boot, record gone), restarted (boot changed) and unreachable (transport failure, keep retrying). No durable operation storage. |
| D4 | **Two clocks; only progress resets stuck.** `lastProgressAt` moves only on measurable advancement (bytes up, an item or stage completing, a declared counter rising). `lastLivenessAt` moves on output and heartbeats and is displayed, but never resets quiet or stuck. Stalls and retries are explicit milestones. |
| D5 | **Cancel only before the first mutation.** Each plan's `pointOfNoReturn` is the first stage that changes anything outside staging. Cancel is allowed while waiting, preparing, downloading and extracting into staging; it is refused afterwards with the reason shown. Runtime switch, search reset and reindex are **not cancellable**, and the UI says so before starting. Existing transaction orders are kept as they are; the boundary is placed before their first live change rather than redesigning them. One consequence: plugin builds run inside the renamed live dir, so a hung build isn't cancellable. It shows as stuck and fails through Whiskit's existing `DEFAULT_BUILD_TIMEOUT_MS`. A **parent latches non-cancellable** as soon as any child passes its point of no return; after that its remaining children run to completion. Cancel goes `cancelling` → `cancelled` only after `run` and every child have settled. No new rollback machinery. |
| D6 | **Always async.** Converted routes validate synchronously, then return `202 { operationId, bootId }` (or `200 … attached: true`). The blocking mode and `?async` are deleted everywhere, including `request-handler.ts` reindex. |
| D7 | **Attach the same request, queue others.** Each operation has a request **fingerprint** (kind + normalized inputs). A live operation with the same fingerprint → attach. A different request on a busy resource → a new operation shown as waiting (with the holder's title and elapsed time), cancellable while it waits. Fingerprint lookup and claim happen atomically **before** any consuming validation (repair plans are consumed only by the operation that claims them). Mutable preconditions are re-validated after a wait. |
| D8 | **A fixed set of stage kinds plus a declared plan.** Kinds: `preparing, downloading, extracting, building, installing, verifying, committing, cleanup`. Waiting is an **overlay** on the operation (`waitingFor`), not a stage. |
| D9 | **Every event carries the complete operation view.** `operation.updated` carries the full snapshot (log trimmed to the tail), with a per-operation monotonic `rev`. Milestones (start, stage change, item done, attempt, stall, waiting change, cancelling, finish) go through `broadcast()` immediately. Tick-only changes go through `broadcastEphemeral()`, throttled to ≤2/s/op. Because every update is complete, keeping the highest `rev` is always safe. Updates and responses from an older `bootId` than the client holds are ignored. Clients reconcile from `GET /api/operations/:id` on `bakin.reconcile` and retry failed reads with bounded backoff while live. |
| D10 | **Repair apply is a parent operation, with one child per selected repair action.** `HealthRepairActionDefinition` gains a required `operationPlan(items): OperationPlan` and an optional `resources: CoreResource[] \| string[]` declaration, both used before execution, and `apply(items, op)` receives the child's `OperationContext`. Core resources are authorized only for repairs registered by core plugins (`isCorePlugin(ownerId)`); user plugins may declare only their own `<pluginId>:<name>` resources. The parent's own plan is the children plus `verifying`. These are the only children in the system (D21). |
| D11 | **CLI targeting from the lock file, with a local secret.** Any explicit `BAKIN_URL` means server-only, and unreachable is an error. With no `BAKIN_URL`, the CLI reads `server.lock` in its own `BAKIN_HOME`: a live pid means use that lock's port; no lock or a dead pid means in-process. The CLI resolves prompts locally and sends explicit options (shared zod schema). The server honours `allowServiceClaim` only with the `X-Bakin-Cli-Secret` header matching the `cliSecret` that the server writes into `server.lock` (written `0600`, never served over HTTP). It never falls back to in-process after a request was sent. |
| D12 | **Model pulls: antfly's stderr protocol plus the staging `.part` size** (settled by the T0 spike, `tasks/evidence-antfly-pull.md`). One item per model. Its `total` is the running sum of file sizes announced on stderr (`[i/N] <path> (<size>)...`), so it grows as files start; pinned bytes are not a total (a pull fetches ~2× the pinned weights). Bytes come from the 16 MiB stderr lines plus polling the current `<path>.part` in `<owner>/.<name>.antfly-download-staging/`. `runPull` always passes `--models-dir <inferenceModelsRoot()>` (the pull ignores `ANTFLY_HOME`). **No point of no return:** publication is an atomic rename at the end and an interrupted pull resumes at byte level, so cancel (SIGTERM) is allowed throughout and keeps the staging dir for the resume. Completion is decided only by the existing completeness and pin checks. |
| D13 | **New public SDK pattern (approved system extension).** `OperationProgress` in `@makinbakin/sdk/patterns` (composing Timeline with nesting, Progress, Alert and Button, with no new tokens) and `useOperation(id)` in `@makinbakin/sdk/hooks`. A public Storybook contract under `Feedback/`. The three private copies are deleted. |
| D14 | **Header tray plus attention.** A host-owned indicator in the header, shown only while something is running or has just finished. Compact rows with Cancel (when allowed) and an `href` link. One `OperationsAttentionProvider` toasts and sends an OS notification on finish, fail and stuck, keyed on `origin ∈ {web, cli, discord}`. |
| D15 | **Runtime switch, search reset and reindex become operations**, all non-cancellable. The private `EventSource`, `runtime:switch*` events, `ProgressSteps`, `startReindexJob`, `getReindexJobStatus`, `rebuildRegisteredTables`' attach-to-any-pass coalescing and the CLI pollers are deleted. A reindex shows its tables as concurrent items. Reset is stop → wipe → start → reindex as stages of one operation. `search.rebuild.*` stays only as telemetry for background migrations. |
| D16 | **Previews are operations.** Plugin install/upgrade and skill previews start a `fetch` operation whose result is the consent preview plus token. Fingerprints come from the requested source/ref. |
| D17 | **Fixed per-stage quiet thresholds** in one table, with per-stage overrides set by the operation. No user settings. "Stuck" notifies once per stage. |
| D18 | **An activity log plus an audit record.** A bounded log of the last 100 lines per operation, shown under collapsed Details with copy. One `operation.*` audit record per finished top-level operation. The same lines go to `server.log` keyed by operation id. |
| D19 | **Plugins get `ctx.operations` in this pass.** Kinds and fingerprints are prefixed with `<pluginId>:`, and `owner: 'plugin:<id>'` is separate from `origin`. User plugins can use only plugin-private resources (`<pluginId>:<name>`). The three core resources are available only to core plugins (`isCorePlugin`), which is the same rule as repair resource declarations (D10). The SDK testing harness gets a fake. |
| D20 | **Delivery as sequenced PRs**, each green and shippable on its own (see PLAN.md). |
| D21 | **Children only where work owns its own boundary and outcome**, which in this pass means repair actions. Requirements (bins, models, npm), reindex tables, model pulls and Whiskit steps are **items** with per-item status inside a stage. A parent waits for every child with `allSettled` semantics. |
| D22 | **Outcomes come from an explicit decision table** (see "Outcome mapping"). `run` returns `OperationOutcome`. A throw → `failed` / `unexpected`. Cancel is an `OperationCancelledError` raised only by context methods and the signal before the point of no return. |
| D23 | **Resources: the one install-state lock plus two globals, in a fixed order.** `install-state` (the existing `~/.bakin/install.lock`: packs, plugins, plugin assets, skills; they share `~/.bakin/bin`. The synchronous writers, plugin unlink and skill-map apply, take it with a non-blocking try and answer 409 `install_busy` naming the holder), `media-store` and `search-engine` (engine install, model pulls, reset, reindex, **and** every background search mutator: the migration pump, boot migration resumption in `search-startup.ts:51`, and the wedge watchdog's rebuild in `search-registry-core.ts:570`; background callers try without blocking and defer to their next tick when it is held; amended 2026-10-17: the wedge watchdog bounces on behalf of a holder that is running migrations in this process — a background pass or a reindex, whose wedge it exists to heal — and defers only for other holders such as an engine install, a model pull or a reset's stop/wipe; amended 2026-10-18: table provisioning — `ensureRegisteredTables` behind boot, live plugin activation and hot reload — is a background mutator too, since it creates tables and migrates changed layouts: a caller that owns search-engine (a reindex, a reset) provisions in its pass, anyone else takes the non-blocking pass or defers to the next pump tick; the try is never a wait, so a plugin install holding install-state stays within the canonical order). The agent `search` exec tool's reindex (`exec-tools/tools/search-tools.ts:238`) starts a normal reindex operation with `origin: 'system'`. Acquisition order is install-state → media-store → search-engine; an operation acquires everything it needs once at start, in that order, and there are no nested acquisitions. The lock file records holder `{ pid, bootId, operationId, title, acquiredAt }`. Waiting is abortable. Holder liveness is checked (dead pid or unknown operation → stale, reclaimed, and the waiting overlay names it). Locks are never shared across an operation tree: a repair parent holds nothing, and its children acquire in sequence, one child at a time. |
| D24 | **Approval-resolved repairs: decision first, outcome after.** (1) `onResolve` validates synchronously, starts the repair parent and returns its id without waiting. (2) The approval service saves the decision, updates the card ("Approved by … — applying", operation id) and publishes. (3) A new kind hook, `afterResolve`, runs strictly after step 2: it waits for the operation, updates the task and verification state, and delivers the outcome through a new optional `channels.postApprovalOutcome(approvalId, outcome)` (a Discord follow-up; runtimes feature-detect it). Restart recovery: at boot, approval rehydration marks `applying` records with no live operation as "outcome unknown — re-check Health", with a task log entry and a channel follow-up. |

Defaults (correctable in review):
- Finished top-level operations stay listed for 1 hour, with at most 50 kept.
  Children live with their parent.
- Performance ceiling changes come back for approval with measured deltas.

## Current evidence (base `68f4857e9`)

| Concern | Today | Gap |
|---|---|---|
| Job registry | `src/core/agent-packages/install-progress.ts`: `startInstallJob` (8-char id, 15-min TTL, 50 entries), kinds `package/agent-package/plugin`, `packages.install_*` over `broadcast()`, preserves HTTP `resultStatus` (:143) | Install-only, types outside the SDK, no stall/retry/cancel/plan/bootId/rev, byte ticks evict replay slots |
| Transfer primitive | `packages/core/src/net/download.ts` `downloadToFile`: `onProgress`, 30s no-bytes stall guard (:77), attempt deadline, 1 retry | Retry and stall only go to `log.warn`; no abort signal |
| Bypassing transfers | `adapter-antfly/src/installer.ts:224` buffers via `arrayBuffer()`. `src/core/whiskit/download.ts` (node:http, 30s socket-inactivity timeout, no retry or progress) provides `downloadToFile` (`consumer-install.ts`, plugin `resolve-source.ts`) and `downloadText` (`whiskit/resolver.ts:59`, `plugins/upgrade-artifact.ts:54`) | No progress, no retry |
| Silent installers | `media/installer.ts` (6 pinned tarballs per platform; PID-based staging deleted before use, :107), `whiskit/managed-bun.ts`, antfly models (`spawn … inference pull`, output discarded), `sync.ts`, `onboarding/plugin-assets.ts`, `onboarding/agent-sync.ts`, `skill-trust.ts confirmSkillInstall`, `plugins/link.ts:274` (runs a build) | No structured progress; media can collide across entry points |
| Install lock | `src/core/install-core/install-lock.ts`: the one lock shared by packs, plugins and the plugin-assets repair (shared `~/.bakin/bin`, :2-7); `acquireInstallLock()` throws `InstallLockBusyError` on contention (:91); `bin-owners.ts:75` reads both ledgers | Not abortable, no waiting, no holder visibility |
| Antfly sharing | binaries and models live under `~/.antfly`, outside Bakin home (`adapter-antfly/src/paths.ts:5`), with the existing service locking in the installer | Must be preserved, not replaced |
| Migration pump | parked migrations resume on the pump's 5-min tick (`packages/core/src/search/tables.ts`, wired from `search-startup.ts` / `search-registry-core.ts`) | Can run concurrently with reset or reindex |
| Repair contract | `sdk/src/types/health.ts:326` `plan(target)` returns items, `apply(items)` takes no context; strict schemas (`health-contract.ts:120`) and forwarding (`health-check-registry.ts:82`); `doctor-repair.ts:236` turns action failures into rows; `doctor-repair-plans.ts:127` consumes the plan on validation | No plan up front, no progress, and repeated requests are rejected |
| Repair callers | UI (`use-repair-plan.ts:172`), CLI `doctor --fix` (`doctor.ts:382`), approvals (`doctor-approvals.ts:372` awaits apply inside `onResolve`; verification can fail after every row applied, :382), auto-escalation (`doctor-escalation.ts:113` awaits apply) | Each assumes the work completes inside the call |
| Approval service | `approvals/service.ts:132`: awaits `onResolve`, then saves the decision, calls `channels.resolveApproval` (decision only, `channels.ts:106`) and publishes | No outcome delivery path |
| Onboarding contract | `onboarding/types.ts:53` string `onProgress`, ignored by long components; `/api/runtime/onboarding/install` synchronous, auto-approving, unable to claim the service, 7 whitelisted components (`request-handler.ts:249-264`); the CLI passes `allowServiceClaim` locally (`onboarding.ts:197`) | No progress; server and CLI semantics differ |
| CLI targeting | `cli/http.ts:13` `BAKIN_URL` (may be remote or a tunnel); `server-lock.ts` `{pid, port, startedAt, bootId}`, written with default mode (:65) | No home or port verification, no authority proof |
| Plugin build | Whiskit `onStage` reports only `ok\|error` after each step (`whiskit/types.ts:47`, `build.ts:179`) | A hung step can't be named |
| Lifecycle mutations | plugin remove runs teardown (`remove.ts:124`); restore deletes/copies files, writes runtime skills, then the ledger (`uninstall-snapshot.ts:414`); runtime switch deprovisions **before** the flip (`runtime-switch.ts:372`); package projection discards its restoration log (`projector.ts:523`, `installer.ts:668`) | Their first mutations come early, so cancel boundaries sit before them (D5) |
| Consent preview | returns HTTP 200 `{ ok:false, awaitingConsent:true, … }` (`consent-gate.ts:69`) | Needs an explicit outcome mapping |
| Parallel progress systems | runtime switch `EventSource` (`runtimes-tab.tsx:268`) and `runtime:switch` events; reindex single-slot job, `?async=1` (`request-handler.ts:398`), concurrent tables (`search-registry-core.ts:354`), attach-to-any-pass (`:246`); search reset fire-and-forget (`request-handler.ts:424`, `search-reset.ts:40`) | Two more systems |
| Other EventSources | `use-schedule.ts:91,304`, `dev-client/client.ts:60` | Out of scope; allowlisted (schedule is separate debt) |

## Design

### Operation model (`packages/sdk/src/types/operations.ts`)

```ts
export const OPERATION_STAGE_KINDS = [
  'preparing', 'downloading', 'extracting', 'building',
  'installing', 'verifying', 'committing', 'cleanup',
] as const
export type OperationStageKind = typeof OPERATION_STAGE_KINDS[number]

export type OperationStatus = 'running' | 'cancelling' | 'succeeded' | 'failed' | 'cancelled'
export type OperationStageStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped'
export type OperationOrigin = 'web' | 'cli' | 'discord' | 'system'
export type OperationOwner = 'core' | `plugin:${string}`
export type CoreResource = 'install-state' | 'media-store' | 'search-engine'

export interface OperationStagePlan {
  id: string
  kind: OperationStageKind
  label: string
  quiet?: { quietMs: number; stuckMs: number }
}

export interface OperationPlan {
  stages: OperationStagePlan[]
  pointOfNoReturn: string | 'start'   // 'start' = not cancellable at all
}

export interface OperationItem {
  id: string
  label: string
  status: OperationStageStatus
  bytes?: { received: number; total: number | null }
  message?: string
}

export interface OperationView<B = unknown> {
  id: string
  parentId?: string
  children: string[]
  rev: number
  bootId: string
  kind: string
  owner: OperationOwner
  origin: OperationOrigin
  title: string
  href?: string
  fingerprint: string
  resources: string[]
  status: OperationStatus
  plan: OperationPlan
  stages: Array<OperationStagePlan & {
    status: OperationStageStatus
    startedAt?: string; endedAt?: string
    message?: string
    items?: OperationItem[]        // per-item status, concurrent items allowed
    bytes?: { received: number; total: number | null }
    attempt?: { n: number; of: number; reason: 'stalled' | 'deadline' | 'http' | 'network'; detail?: string }
    skippedReason?: string
  }>
  waitingFor?: { holderTitle: string; holderOperationId?: string; since: string; stale?: boolean }
  cancellable: boolean
  startedAt: string
  lastProgressAt: string           // parent: max over its own stages and children
  lastLivenessAt: string
  lastOutput?: string
  endedAt?: string
  outcome?: { code: string; message?: string; partiallyApplied?: boolean }
  result?: { httpStatus: number; body: B }
  log: Array<{ at: string; level: 'info' | 'warn' | 'error'; stageId?: string; text: string }>
}

export interface OperationContext {
  readonly id: string
  readonly signal: AbortSignal
  stage(stageId: string, message?: string): void
  item(stageId: string, item: Omit<OperationItem, 'status'> & { status?: OperationStageStatus }): void
  bytes(stageId: string, bytes: { received: number; total: number | null }, itemId?: string): void
  attempt(stageId: string, attempt: NonNullable<OperationView['stages'][number]['attempt']>): void
  output(line: string): void           // liveness + log only
  log(text: string, level?: 'info' | 'warn' | 'error'): void
  skip(stageId: string, reason: string): void
  throwIfCancelled(): void             // raises OperationCancelledError before the point of no return only
}

export interface OperationOutcome<B = unknown> {
  status: 'succeeded' | 'failed'
  code: string                        // 'ok' | 'verification_failed' | 'partially_applied' | …
  message?: string
  httpStatus: number
  body: B
}
```

The shape is the contract; names may be refined in implementation.

### Registry (`packages/core/src/operations/registry.ts`)

- `startOperation({ kind, owner, origin, title, href?, fingerprint, resources, plan, validate?, run })`:
  1. Atomically: look up a live operation with the same `fingerprint`; if one
     exists, return `{ operationId, bootId, attached: true }`.
  2. Otherwise register the operation.
  3. Run `validate` (synchronous rejections still map to today's 4xx; a
     validation failure unregisters the operation).
  4. Return 202, then acquire `resources` in canonical order (showing
     `waitingFor` while blocked; abortable), re-validate mutable
     preconditions, and run.
- `run(op)` returns `OperationOutcome` (D22).
- `cancelOperation(id)` returns `cancelling | not_cancellable | not_found |
  already_finished`. It aborts the signal and cascades to children that are
  still cancellable. Terminal status is published only after `run` **and**
  every child have settled.
- `awaitOperation(id)` for in-process callers (approvals, escalation, the
  local CLI).
- `getOperation(id)`, `listOperations()` (top-level: active plus finished
  within 1 hour, at most 50).
- `quietState(view, now)` is pure, shared by server and client, and computed
  from `lastProgressAt` and the threshold table. When an operation is waiting,
  `quiet`/`stuck` apply only if the holder is stale.
- On a top-level finish: one audit record (`operation.succeeded|failed|cancelled`
  with kind, owner, origin, duration, outcome code and child summary) and a
  `server.log` line. Each log line is logged with `{ operationId }`.

### Children (D10, D21)

- Only `startChildOperation(parent, { title, plan, fingerprint, resources, run })`,
  which is used by repair apply. Children acquire their own declared
  resources at start; the parent holds none.
- The repair parent runs children **sequentially** (each child acquires its
  own resources, for example media → `media-store`), then runs `verifying`.
  "Sequentially" is the deliberate choice: repairs touch shared state and
  the old path was serial too.
- Parent outcome precedence, first match wins (rows are always kept):
  1. Cancelled while no child has passed its point of no return →
     `cancelled`.
  2. Some children applied and others failed or were cancelled → `failed` /
     `partially_applied`.
  3. Every non-skipped child failed → `failed` / `apply_failed`.
  4. Every child skipped (nothing needed) → `succeeded` / `nothing_applied`,
     then verification still runs.
  5. Applied (any mix with skipped) and verification failed → `failed` /
     `verification_failed`.
  6. Applied (any mix with skipped) and verified → `succeeded` / `ok`.

### Resources (D23)

- `packages/core/src/operations/resources.ts`:
  `acquire(resources, { signal, holder, onWait }): Promise<Lease>`.
  - Sorts the requested resources into the canonical order and acquires each
    lock file with `O_EXCL` (the existing algorithm), polling with backoff
    while held.
  - Abortable. A lease obtained after abort is released immediately.
  - Stale holders (dead pid, or same boot with an unknown operation id) are
    reclaimed, and the reclaim is logged.
- `install-state` **is** the existing `~/.bakin/install.lock`; its module is
  rewritten as this resource. Non-operation callers (none should remain;
  enforced by an architecture test) are migrated. The old in-process
  reentrancy rule for inner writers is kept as a `heldBy(operationId)`
  assertion for code running inside the holding operation, never as tree
  sharing.
- `media-store` and `search-engine` are new lock files under `~/.bakin/locks/`.
  - The background migration pump attempts a non-blocking `search-engine`
    acquire per tick and skips the tick if it is held.
  - Reset and reindex therefore wait for an in-flight pump pass, shown as
    "Waiting for background index migration".
- Antfly's own service locking and its `~/.antfly` paths are kept as they are,
  inside the `search-engine` resource.

### Quiet thresholds (D17, D4)

| Stage kind | Quiet after | Stuck after | Notes |
|---|---|---|---|
| downloading | 10s | 30s | matches the primitive's 30s stall guard |
| preparing | 10s | 30s | |
| extracting, verifying, committing, cleanup | 15s | 45s | |
| building, installing | 30s | 120s | often no measurable counter |

- Waiting is never quiet or stuck unless the holder is stale.
- Model pulls override `downloading` to 30s/120s.

### Events and HTTP (D9, D6)

- One event, `operation.updated { view }`, carrying the complete view inside
  the `plugin-event` envelope. Milestones are replayable, ticks are
  ephemeral, and clients keep the highest `rev` within the current `bootId`.
- `GET /api/operations` → `{ bootId, operations }`.
- `GET /api/operations/:id[?children=1]` → the view (children inlined on
  request), or 404 `{ bootId }`.
- `POST /api/operations/:id/cancel` → 202 `cancelling` · 409
  `not_cancellable` / `already_finished` · 404 `{ bootId }`.

Converted routes (validate → 202/200 `{ operationId, bootId }`):

| Route | kind | Resources | Point of no return |
|---|---|---|---|
| `POST /api/packages/install`, `/api/agent-packages/install` | install | install-state | first projection write |
| `DELETE /api/packages/:id`, `/api/agent-packages/:id` | remove | install-state | first runtime deletion or file removal |
| `POST /api/packages/:id/sync`, `/api/agent-packages/:id/sync` | sync | install-state | first requirement install or managed-block write, whichever comes first |
| team-wide sync (`plugins/team/lib/routes/teams.ts`) | team:sync | install-state | first agent's managed-block write |
| `POST /api/plugins/install` (preview) | fetch | — | none (always cancellable) |
| `POST /api/plugins/install` (commit), `/api/plugins/upgrade` (commit) | install / upgrade | install-state | the replace transaction's journal-first rename of the live dir (`replace-transaction.ts:296`); placement and the build follow it in place, so they're not cancellable |
| `POST /api/plugins/upgrade` (preview) | fetch | — | none |
| `POST /api/plugins/remove` | remove | install-state | teardown (`start`, effectively) |
| `POST /api/plugins/restore` | restore | install-state | first file deletion **or copy** (non-force restores start by copying, `uninstall-snapshot.ts:414`) |
| `POST /api/plugins/link` | link | install-state | before `--force`'s unlink of the prior entry, or else before `buildUserPlugin(real)` writes into the source tree (`link.ts:234`, `:274`); only validation is cancellable |
| `POST /api/skills/preview` / `/install` | fetch / install | — / install-state | none / skill dir placement |
| `POST /api/skills/map/preview` | skill-map | — | none |
| `POST /api/plugins/health/doctor/repair/apply` (and approval resolve) | repair (parent) | per child | per child |
| `POST /api/runtime/onboarding/install` | onboarding | the component's | the component's |
| `POST /api/runtime/switch` (including dry-run) | runtime-switch | install-state | `start` (not cancellable); dry-run is read-only |
| `POST /api/search/reset` | search-reset | search-engine | `start` |
| `POST /api/reindex` | reindex | search-engine | `start` |

Deliberate synchronous exclusions. Each is bounded; any missing bound is
added in this work:
- repair `plan`: bounded local scans (for example, Team's `scanAgentSync()`)
  with no network. It keeps the 15s client limit.
- skill-map **apply**: local writes under a non-blocking `install-state` try
  (409 `install_busy`).
- lesson toggle: a non-blocking `install-state` try taken **before** the
  ledger write and held through its local `syncAgent` recompose
  (409 `install_busy`).
- plugin unlink: symlink and ledger removal under a non-blocking
  `install-state` try.
- secret saves.
- extension allow/revoke: runtime discovery. **This work adds a 15s deadline
  around Pi's extension discovery** (`adapter-pi/src/extensions.ts:63`), which
  has none today.
- capability readiness and other reads: runtime calls under their existing
  request timeouts.

Architecture tests pin both lists and the resource each writer takes. Moving
a route between the lists is an ordinary reviewed change, not an approval
checkpoint.

### Outcome mapping (D22)

| Flow | Condition | status / code | httpStatus + body |
|---|---|---|---|
| Plugin/upgrade preview | consent required | succeeded / `awaiting_consent` | 200 + today's `{ ok:false, awaitingConsent:true, … }` |
| Plugin/upgrade preview | nothing new to consent | succeeded / `ok` | 200 + today's body |
| Any install/upgrade/remove/restore/link/sync | today's success response | succeeded / `ok` | today's status + body |
| Same | today's error response (4xx/5xx after validation) | failed / today's error code | today's status + body |
| Repair parent | see the precedence under "Children" | ok / nothing_applied / partially_applied / apply_failed / verification_failed / cancelled | 200 + today's `DoctorRepairReport` (rows always present) |
| Antfly engine | `status: 'failed'` result | failed / `engine_install_failed` | onboarding body |
| Onboarding component | `InstallResult.status` `installed`/`skipped` vs `failed` | succeeded / `ok` or `skipped` vs failed / `component_failed` | 200 + `{ result }` |
| Reindex | every table converged | succeeded / `ok` | 200 + per-table results |
| Reindex | any table failed or parked | failed / `tables_parked` | 200 + per-table results (rows kept) |
| Search reset | complete | succeeded / `ok` | 200 + reset result (**intentional change:** the old embedded `ReindexJobStatus` becomes the reindex stage's items) |
| Search reset | `SearchResetResult.ok === false` (`search-reset.ts:25`) | failed / `reset_failed` | 200 + reset result |
| Runtime switch | report `ok` vs failed phase | succeeded / failed `switch_failed` | 200 + today's switch report |
| Any | thrown error | failed / `unexpected` | 500 + `{ error }` |
| Any | cancelled before the point of no return | cancelled / `cancelled` | — |

Clients read `result.body` exactly as they read the old response.

### Transfer primitive (`packages/core/src/net/download.ts`)

- Scope: artifact transfers (archives, tarballs, binaries, model files,
  release indexes). JSON API calls are out of scope.
- `downloadToFile(…, { onEvent, signal })` where
  `DownloadEvent = { type: 'attempt', n, of } | { type: 'bytes', received, total }
  | { type: 'stalled', afterMs } | { type: 'retry', n, of, reason, detail }`.
  `onProgress` is removed.
- `signal` aborts the read, skips retry and deletes the partial file.
- `downloadText` moves here with the same semantics.
- `opTransfer(op, stageId, itemId)` maps events onto `op.bytes` / `op.attempt`.
- Migrations onto the primitive:
  - antfly engine (streams instead of `arrayBuffer()`)
  - `consumer-install.ts`, `resolve-source.ts`, `whiskit/resolver.ts`,
    `upgrade-artifact.ts`
- `src/core/whiskit/download.ts` is deleted.
- `extractTarball` / `extractTarMember` take `signal`, and their stderr goes
  to `op.output`.

### Installer adoption (all items, no children)

| Installer | Plan (**point of no return**) |
|---|---|
| `installMediaStore` (`media-store`) | downloading (6 tarballs as items) → extracting → building → verifying (probe) → **committing (store rename)** → cleanup; receipt match → all stages skipped, "already installed" |
| antfly engine (`search-engine`) | preparing → downloading → verifying (sha256) → extracting → verifying (version) → **committing (service stop + swap)** → cleanup (data dir on version change) → verifying (readyz) |
| antfly models (`search-engine`) | downloading (one item per model: stderr-announced sizes plus staging `.part` growth, D12) → verifying (completeness + pins). No point of no return: cancel is allowed throughout and keeps the resumable staging dir. |
| requirements (inside packs/plugins, `install-state` held by the caller) | installing: items per bin/model/npm requirement (managed bun appears as an item with its own bytes); point of no return is the first item whose install writes to `~/.bakin/bin` or the model dir |
| replace transaction / Whiskit (`install-state`) | preparing (fetch/stage source and consent re-check) → **committing (journal-first rename of the live dir; existing order unchanged)** → committing (place files) → building in place (Whiskit items entered **before** each step with new `status: 'start'`; output → `op.output`; bounded by `DEFAULT_BUILD_TIMEOUT_MS`) → installing (bins) → committing (ledger, journal commit). Failures still roll back through the existing transaction. |
| pack sync / repair, agent-sync, plugin-assets (`install-state`) | preparing → **installing (first requirement install or managed-block write, whichever comes first)** → committing → verifying (the same boundary as the HTTP table) |
| `confirmSkillInstall` (`install-state`) | verifying (trust gate) → **committing (placement)** |
| onboarding components | `install(opts, op)`, each exporting its `OperationPlan`; `OnboardingOptions.onProgress` is deleted; `runOnboard`'s Ink UI renders operation updates |

### Health repair (D10, D24)

- **SDK contract:** `HealthRepairActionDefinition` gains
  `operationPlan(items): OperationPlan` and `apply(items, op)`.
  - Updated: `health-contract.ts` schemas, `health-check-registry.ts`
    forwarding, both context tiers, and every in-tree registration (health,
    tasks, team, models, spend, schedule, workflows, assets).
  - The `@makinbakin/sdk/testing` fake.
  - A runtime contract test applies every registered action against fixtures
    and asserts that it reports through `op` and follows its declared plan,
    since a one-argument callback still type-checks.
- **Apply:**
  - `applyDoctorRepair` claims by fingerprint (`repair:<planId>:<sorted itemIds>`)
    **before** consuming the plan.
  - It starts a parent with one child per selected action (each child's plan
    comes from `operationPlan(items)`).
  - It runs `verifying` with the targeted diagnostics.
  - Rows are kept on every outcome.
- **Approvals:** follow D24.
  - `doctor-approvals.ts` gives up the in-`onResolve` wait.
  - The approval kind registry gains `afterResolve`.
  - `RuntimeChannels` gains optional `postApprovalOutcome`, implemented by
    the Discord bridge.
  - Approval rehydration handles `applying` records with no live operation.
- **Auto-escalation** (`doctor-escalation.ts:113`): starts the parent with
  `origin: 'system'` and waits via `awaitOperation`.
- **UI:** `RepairDialog` drops `HEALTH_REPAIR_APPLY_TIMEOUT_MS` and
  `HealthRepairOutcomeUnknownError`, renders `OperationProgress` with nested
  children, renders rows and verification from `result.body`, and can be
  closed mid-repair.
- **CLI:** `bakin doctor --fix` follows the operation.

### CLI (D11)

- **Renderer:** `src/cli/operation-renderer.ts`.
  - TTY: a checklist with nested children and items, bytes or "size unknown",
    the quiet clock plus liveness line, attempt N/M, and waiting-for.
  - Non-TTY: one line per milestone. `--json`: JSON lines.
  - On failure it prints the log tail.
- **Mode:** `src/cli/operation-mode.ts` implements D11's selection.
  - The server writes `server.lock` with mode `0600` and a fresh `cliSecret`
    per boot.
  - The CLI sends `X-Bakin-Cli-Secret` only when it read the secret from the
    lock it is targeting.
- **Interruption:**
  - Server mode: the first Ctrl-C requests cancel (or reports "Can't stop now
    — finishing safely" past the point of no return). A second Ctrl-C
    detaches and prints the operation id.
  - In-process mode: the first Ctrl-C cancels and waits for settle (or
    reports "Can't stop now"). A second Ctrl-C force-exits with a warning
    that boot recovery checks the install transactions.
- `/api/runtime/onboarding/install` accepts every installable component
  (adding `recommended-*` and `capabilities`) with explicit options, and no
  longer auto-approves. The web hub sends the same explicit options.
- **Verbs:** `bakin install *`, `bakin onboard`,
  `bakin packages|agents|plugins|skills install|upgrade|remove|restore`,
  `bakin plugins link`, `bakin agents sync`, `bakin packages sync`,
  `bakin doctor --fix`, `bakin runtime use [--dry-run]`, `bakin reindex` /
  `bakin search reindex`, `bakin search reset`.

### Plugin API (D19)

- `ctx.operations.start({ kind, title, href?, fingerprint, resources?, plan, run })`.
  - Prefixed with `<pluginId>:`, with `owner: 'plugin:<id>'`. `origin` is
    passed through from the triggering route.
  - Resources are restricted to plugin-private names.
- Typed in the SDK and in `core/plugin-types.ts`, with a fake in
  `@makinbakin/sdk/testing`.
- Core plugins use it for operations they own.

### Browser UI (D13, D14)

- **`OperationProgress`** (`packages/ui/src/patterns/operation-progress.tsx`,
  exported from `@makinbakin/sdk/patterns`):
  - Props: `{ operation, children?, variant?: 'full' | 'compact', onCancel?, onRecheck? }`.
  - Renders: a nested `Timeline` (stages, items with their own status,
    children); on the active stage, a `Progress` bar (indeterminate when the
    total is unknown), elapsed time, the quiet clock plus liveness line,
    attempt notes and the waiting overlay; an `Alert` for stuck, failed,
    partially applied, verification failed, cancelling/cancelled, expired,
    restarted and unreachable; Cancel (or "Will finish — past the point of no
    return", or "Can't be cancelled" for `start`); and collapsed Details with
    copy.
  - Compact variant: title, current stage, bar and Cancel.
- **`useOperation(id, { bootId })`** (`src/hooks/use-operation.ts` →
  `@makinbakin/sdk/hooks`):
  - Applies the D9 rev/boot guards and reconcile retries.
  - Returns `{ operation, children, phase: 'loading' | 'live' | 'finished' | 'expired' | 'restarted' | 'unreachable', cancel() }`.
  - Also provides the `startOperation(fetcher)` helper.
- **Storybook:** `storybook/public/feedback/operation-progress.stories.tsx`.
  - Stories: `CanonicalUsage`, Planned, Downloading, UnknownTotal, Retrying,
    QuietButAlive, Stuck, Waiting, StaleHolder, ConcurrentItems (reindex),
    RepairWithChildren, PartiallyApplied, VerificationFailed, Cancelling,
    PastPointOfNoReturn, NotCancellable, Failed, Cancelled, Expired,
    RestartedOutcomeUnknown, Unreachable, Compact.
  - Each with play assertions. `bakinCoverage` axes are spread across
    representative stories (every axis covered at least once, not every
    axis on every story). A new visual baseline needs explicit approval at
    that time, and the pattern is registered in `public-api.json`.
- **Header tray and attention:**
  - Tray: `packages/host/src/components/operations/operations-tray.tsx`.
  - Attention: `OperationsAttentionProvider` (the `ApprovalsAttentionProvider`
    pattern), keyed on origin.
  - The closest Overlays/Popover and Feedback stories are checked first, and
    any mismatch is raised as a deviation.
- **Migrated surfaces:**
  - Explore: install, consent and hub-skills (including skill-map preview).
  - Health: repair dialog and plan hook, plus the system search section and
    system data hook (reindex, reset).
  - Runtime: overview tab (setup repair; media becomes fixable) and runtimes
    tab (switch and dry-run).
  - Team: adopt dialog, package card, team detail, diagnostics tab.

### Deleted (no shims)

- `install-progress.ts` and its types
- `/api/install-jobs`
- `packages.install_*`
- `?async` everywhere
- `startReindexJob`, `getReindexJobStatus`, `ReindexJobStatus`, and
  `rebuildRegisteredTables`' any-pass attach
- The CLI reindex and reset pollers
- `runtime:switch*` events, the `runtimes-tab` EventSource, `ProgressSteps`,
  `reduceSwitchProgress`
- Explore's `InstallProgressPanel` and its wiring
- `src/core/whiskit/download.ts`
- `downloadToFile`'s `onProgress`
- `OnboardingOptions.onProgress`
- The onboarding route's auto-approve
- `HEALTH_REPAIR_APPLY_TIMEOUT_MS`, `HealthRepairOutcomeUnknownError`,
  hub-skills `INSTALL_TIMEOUT_MS`
- `acquireInstallLock()` / `InstallLockBusyError` as a throw-on-contention API
  (replaced by the `install-state` resource)
- `doctor-approvals.ts`'s wait for apply inside `onResolve`

## Commands

```sh
bun install
bun run typecheck
bun run lint
bun run check:cycles
bun run test
bun test tests/core/operations/registry.test.ts --isolate
bun run ui:conformance --quick        # every UI-affecting commit
bun run ui:conformance --full         # each UI PR before handoff
bun run ui:test:stories               # needs playwright browsers
bun run build:css && bun run build:vendors && bun run build:plugins   # before SDK/UI commits
bun run build                         # full chain before SDK/vendor PRs
```

## Project structure

```text
packages/sdk/src/types/operations.ts   public leaf types (core re-exports)
packages/core/src/operations/          registry, resources and quiet-state modules; split
                                       further only where implementation shows a real seam
packages/core/src/net/download.ts      DownloadEvent, signal, downloadText, opTransfer
packages/sdk/src/testing/              fake OperationContext + ctx.operations
packages/ui/src/patterns/operation-progress.tsx
src/hooks/use-operation.ts
packages/host/src/api/operations.ts
packages/host/src/components/operations/  operations-tray.tsx, operations-attention-provider.tsx
src/cli/operation-renderer.ts, src/cli/operation-mode.ts
storybook/public/feedback/operation-progress.stories.tsx
tests/core/operations/, tests/architecture/operations-*.test.ts
.claude/knowledge/operations.md
```

## Code style

Follow CLAUDE.md conventions. An installer reports through its context and
never broadcasts. Resources are acquired by the registry from the declared
list, never by the installer mid-run:

```ts
export const MEDIA_PLAN: OperationPlan = {
  stages: [
    { id: 'download', kind: 'downloading', label: 'Download sharp packages' },
    { id: 'extract', kind: 'extracting', label: 'Unpack into staging' },
    { id: 'build', kind: 'building', label: 'Bundle the media runtime' },
    { id: 'verify', kind: 'verifying', label: 'Probe a real resize' },
    { id: 'commit', kind: 'committing', label: 'Switch to the new store' },
    { id: 'cleanup', kind: 'cleanup', label: 'Remove old versions' },
  ],
  pointOfNoReturn: 'commit',
}
export const MEDIA_RESOURCES: CoreResource[] = ['media-store']

export async function installMediaStore(op: OperationContext, options: MediaInstallOptions = {}): Promise<OperationOutcome<MediaInstallResult>> {
  if (await receiptMatches(options)) {
    for (const stage of MEDIA_PLAN.stages) op.skip(stage.id, 'already installed')
    return succeeded({ status: 'current' })
  }
  op.stage('download')
  const pins = pinnedTarballsFor(platform)
  for (const pin of pins) op.item('download', { id: pin.name, label: pin.name })
  for (const pin of pins) {
    await downloadToFile(pin.url, staged(pin), {
      sha256: pin.sha256,
      signal: op.signal,
      onEvent: opTransfer(op, 'download', pin.name),
    })
  }
  op.stage('build')
  // …
  op.stage('commit')   // past here, cancel is refused
  // …
}
```

## Testing strategy

Use `bun test` with `--isolate`, CLAUDE.md mock rules (both content-dir
resolvers with `db`/`media` keys, OpenClaw home, logger, watcher), RTL via
`rtl-settle` / `actRender`, and `waitUntil` / `settleFor`.

Highest priority first:

| Level | Coverage |
|---|---|
| Concurrency | repair + onboarding + CLI media at once → one runs, the others wait with `waitingFor`, never sharing staging; same-fingerprint attach; different request queues; cancel while waiting (before and racing acquisition; a late lease is released); stale-holder reclaim; canonical ordering (no AB/BA possible: a test asserts every declared resource list is acquired sorted); migration pump skips its tick while `search-engine` is held, and reset waits for an in-flight pump pass; a plugin install and a pack install contend on `install-state` |
| Cancel | for each flow: cancel before the point of no return → `cancelled` only after settle, with no live-state change (plugin dir, media store, bin dir untouched); cancel after it → 409 and normal completion; non-cancellable flows refuse at start; repair parent precedence (cancelled vs partially_applied); `allSettled` (a rejected child doesn't publish terminal state early) |
| Reconnect and identity | complete-view rev guard (a delayed older GET or event never regresses, and a missed stage transition is recovered by the next complete update or reconcile); an older-boot response ignored after restart detection; failed reconcile retried; restarted / expired / unreachable |
| Stall | output without progress still goes quiet then stuck; a fake stalled fetch → `stalled` + `retry` milestones that replay; the margo replay (success criterion 2) |
| Outcomes | every row of the outcome table, including consent-required, verification_failed and tables_parked; converted-route parity (`result.body` equals the old response for the same fixture) |
| Approvals | ordering: decision saved, card updated and published **before** `afterResolve`; exactly one outcome follow-up; restart between steps → "outcome unknown" via rehydration |
| CLI | mode matrix (explicit URL incl. loopback, live lock with a non-default port, dead lock, refused-before-send, failed-after-send → error); secret required for service claim (missing or wrong → claim refused); `server.lock` written `0600`; renderer TTY/non-TTY/JSON; Ctrl-C semantics in both modes |
| Units | registry lifecycle, eviction and audit; quiet table; event throttle; download primitive event order (success, stall, deadline, checksum no-retry, abort no-retry) |
| Installers | each declares plan, point of no return and resources, and emits the expected stages and items through injected seams (media, antfly fetch, models spawn fake plus disk growth, Whiskit start/finish) |
| Repair contract | runtime test over every registered action |
| UI | story play assertions for every state; `useOperation`; migrated surfaces' RTL tests (progress, close-while-running, cancel); tray; attention keyed on origin |
| Architecture | no `?async` in `packages/host/src/api` or `request-handler.ts`; no `packages.install_` or `runtime:switch`; `new EventSource` only in the three allowlisted files; no `arrayBuffer()` / raw-fetch artifact downloads in installer modules; converted and synchronous route lists pinned; no `acquireInstallLock` callers; every stage kind has a threshold row; user-plugin `ctx.operations` and repair declarations can't name core resources (core plugins can); every `install-state` writer (including unlink and skill-map apply) and every background search mutator (pump, boot resumption, wedge watchdog) goes through the resource module |
| Conformance | `ui:conformance --quick` per UI commit, `--full` per UI PR; baselines only with explicit approval |

Cancellation-safety is proven **behaviorally** (state untouched after cancel)
rather than by a syntactic "catch blocks rethrow" scanner.

## Boundaries

- **Always:**
  - Report through `OperationContext`.
  - Declare plan, point of no return and resources up front.
  - Acquire resources only through the registry, in canonical order.
  - Map outcomes through the table.
  - Send artifact transfers through the primitive.
  - Complete views only, with rev and boot guards.
  - Focused tests plus `typecheck` before each commit, and the full build
    chain before SDK/UI commits.
  - Update `.claude/knowledge` and docs in the same PR.
  - Never `git add -A` after a local build.
- **Ask first:**
  - Visual baselines.
  - Performance ceilings.
  - New tokens.
  - UI deviations.
  - New dependencies.
  - CI changes.
  - The execution ledger.
  - Reordering PRs.
  - Adding a fourth core resource.
  - Redesigning any existing transaction order to widen cancellation.
- **Never:**
  - Shims, aliases, or dual modes.
  - Parallel progress systems or new private `EventSource`s.
  - Client timeouts that guess outcomes.
  - Treating output as progress.
  - Cancelling past a point of no return.
  - Sharing locks across an operation tree.
  - In-process fallback after a sent request.
  - Real `~/.bakin` / `~/.openclaw` in tests.
  - Isolated boots without guest-URL antfly settings.
  - Regenerating baselines or ceilings to pass.

## Success criteria

1. Every converted route returns 202/200 with `{ operationId, bootId }`
   within 500ms. Invalid requests fail synchronously with today's codes.
2. **The margo replay** (automated). A fake fetch stalls a sharp tarball. The
   repair dialog shows: the parent and its media child plan; "Download sharp
   packages" item *k*/*N* (N from `pinnedTarballsFor(platform)`) with bytes;
   "No progress for 10s"; "This step looks stuck" at 30s even while output
   continues; "Retrying (attempt 2 of 2) — stalled"; then a failed stage with
   a log tail, and a failed parent with rows.
3. Cancel from the dialog, the tray and Ctrl-C works before each flow's first
   mutation, leaves live state untouched, and reports "cancelled" only after
   settle. Past that point, or for non-cancellable flows, the UI says the
   operation will finish.
4. A restart while following an operation shows "Server restarted — outcome
   unknown". Expired and unreachable show their own states. No endless
   spinners.
5. `bakin install media|search|search-models|plugin-assets|agent-sync`
   renders the same stages with and without a server, can claim the service
   only with the local secret, and never runs locally after a sent request.
   The tray shows CLI-started operations.
6. Media started from a repair, the hub and the CLI at once runs one at a
   time with visible waiting, and never shares staging. Identical requests
   attach.
7. An approval from Discord updates the card with the decision first, then
   posts exactly one outcome follow-up. A restart mid-repair yields "outcome
   unknown".
8. Model pulls show per-model bytes against the sizes antfly announces
   (the total grows as files start, D12), with stub-binary tests for stall
   and cancel.
9. The deleted list is gone (`rg` returns nothing) and the architecture tests
   pin it.
10. `bun run test`, `typecheck`, `lint`, `check:cycles` and
    `ui:conformance --full` are green; CI is green on every PR.
11. Docs are updated:
    - New `.claude/knowledge/operations.md`.
    - Knowledge updates: media-pipeline, capability-packs, agent-packages,
      plugin-lifecycle, plugin-system, doctor-and-health-checks, approvals,
      delivery-bridge, explore-plugin, skill-hub-interop, search-system,
      runtime-capabilities.
    - CLAUDE.md Key Patterns entry.
    - Docs site `extending/plugins` and `extending/ui`.
    - README, where the CLI install output is described.

## Open questions and spikes

1. **Antfly pull (resolved 2026-10-16, T0):** staging dir with `.part`
   files, byte-level resume after SIGTERM/SIGKILL, atomic publish, so no
   point of no return; see D12 and `tasks/evidence-antfly-pull.md`.
2. **Performance ceilings:** measured deltas from moving the panel into the
   SDK patterns bundle and adding the tray come back for approval.
3. **Discord-resolved repairs (resolved 2026-10-15):** `origin: 'discord'`,
   shown in the tray with attention, plus one outcome follow-up (D24).
4. **Schedule hooks' private EventSources:** existing debt, allowlisted; to
   be ticketed separately.
