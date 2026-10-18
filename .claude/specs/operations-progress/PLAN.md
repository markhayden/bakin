# Implementation plan — Operations (#895)

Status: **done (2026-10-18).** Revision 6, approved by the maintainer 2026-10-16;
delivered as PRs #976, #979, #982, #984, #988 and PR6 — the evidence table
is at the end.
- Revision 1 was reviewed by Codex (`gpt-6-astra`) with the verdict
  **rework**. Its 15 findings were spot-checked (26 repair registrations,
  8 install-lock callers, guest-mode reset refusal, Antfly's own `'wx'`
  service lock, the `performPluginUpgrade` and `skills map` consumers, the
  core-routes OpenAPI source: all confirmed) and are fully addressed here.
- The maintainer chose a disposable Linux container for real-engine search
  checks.
- Revision 3 applies the round-2 Codex review (11 of 15 first-round
  findings resolved, 3 new P1s). It fixes the remaining atomicity and
  ownership gaps and drops the legacy-bridge adapter.
- Revision 4 applies round 3 (all round-2 findings resolved; 2 new P1s plus
  the lock-ownership chain). `install-state` now **reuses the existing
  install-lock ownership context**, so no lock chain moves mid-PR.
- Revision 5 applies round 4 (every round-3 item resolved; 1 new P1): every
  `syncAgent`/`syncAllAgents` entry point holds `install-state`. The
  inventory found 8 call sites; Codex named 2.
- Revision 6 applies round 5 (round-4 item resolved; 2 new P1s): the
  managed-block migration route/CLI becomes a 4.2 operation that acquires
  before its first write, and the runtime-switch and onboarding agent-sync
  `runLocal` wrappers land in the same 4.2 commit that removes sync's inner
  lock. The maintainer pre-approved the plan conditional on this fix.

Spec: [SPEC.md](./SPEC.md), revision 3.1 (approved; commit `870032ab8`).
Decision references (D1–D24) point at the spec. Base: `68f4857e9`.

## Overview

The work replaces every blocking, spinner-only long-running flow with one
**operations** primitive. It ships as **six sequenced PRs** after a
read-only spike. Every PR is green, mergeable and shippable.

## Commit discipline (the core rule)

**Prepare additively, then switch each complete flow atomically.**

1. **Prepare commits** only *add* code: new modules, new optional fields,
   new exported plans, new helpers with their own tests. They change no
   existing behavior or signatures, so each one is green on its own.
2. **One switch commit per flow.** It converts a complete flow in one go:
   server route, installer signature (**with every caller**), browser
   client(s), CLI command(s), route metadata (`core-routes/index.ts`, the
   OpenAPI source), deletion of the old path, and the tests that pin it.
   No commit ever leaves a server/client mismatch, a dead caller or a
   half-converted signature.
3. **Shared helpers.** When a shared helper (for example the requirements
   installer) is used by flows that switch in different commits of the same
   PR, a prepare commit gives it an **optional** `op` beside its existing
   parameter. Each flow switch passes `op`. The PR's last switch commit
   removes the old parameter and makes `op` required, with no translation
   layer. In-process callers that have no operation yet use `runLocal`
   (Task 1.4), the real local runner. Nothing transitional is ever merged:
   each PR's final commit and its architecture test prove it.
4. Conventional commits with a scope. Each commit runs `bun run typecheck`
   plus its focused tests (`bun test <files> --isolate`). Commits that touch
   the SDK or UI first run `bun run build:css && bun run build:vendors &&
   bun run build:plugins`, and stage paths explicitly (never `git add -A`
   after a build). Run the full `bun run test` at every ◆.

**Branches:** one per PR, each cut from `main` after the previous PR
merges:
- PR1 `feat/operations-progress` (spec and plan commits plus PR1)
- PR2 `feat/operations-ui`
- PR3 `feat/operations-repair`
- PR4 `feat/operations-installs`
- PR5 `feat/operations-search`
- PR6 `feat/operations-onboarding-runtime`

**Rollback:**
- Reverts go in **reverse dependency order**.
- A switch commit reverts as a unit (it's self-contained).
- A prepare commit reverts only after the switch commits that use it.
- A merged PR reverts via `git revert -m 1 <merge>`, newest PR first.
- **Persisted-state compatibility:**
  - `install.lock` gains holder fields but stays O_EXCL-compatible; old
    readers ignore the extra fields.
  - `server.lock` gains `cliSecret` and mode `0600`; old readers ignore the
    field.
  - Approval records (PR3 D24) only **add** event types and keep the
    existing `status` values. A fixture test pins that records written by
    the new flow still satisfy the existing recovery reader's schema
    (`doctor-approvals.ts:455`).
  - There are no data migrations.
- **Shutdown:** on SIGTERM the registry logs "server stopping" to every
  live operation's log and audits nothing. On the next boot, D3 surfaces
  "restarted" to clients, and approval rehydration (D24) handles `applying`
  records. The existing install transactions recover at boot as they do
  today.

**Approval gates** (stop and ask): visual baselines and performance-ceiling
deltas (PR2), UI deviations, new dependencies, CI changes, a fourth core
resource, transaction-order redesigns.

## Dependency graph

```text
T0 spike ───────────────────────────────────────────────────┐
PR1 types → registry + resources + runLocal → transfer primitive → HTTP + ctx.operations
PR2 useOperation → OperationProgress (+story, inventory, approved baseline) → tray + attention
PR3 children + CLI renderer + CLI targeting → repair fields + authorization → 26 action preps → approval hooks (prep) → REPAIR + D24 SWITCH
PR4 install-path preps → PACKAGES SWITCH → PLUGINS SWITCH(es) → SKILLS SWITCH → lock-API deletion
PR5 background search-engine gating (prep) → engine + models preps (T0) → SEARCH SWITCH
PR6 onboarding preps + cliSecret + operation-mode → ONBOARDING SWITCH → RUNTIME-SWITCH SWITCH → sweep
```

---

## T0 — Spike: antfly model pull (read-only)

**Description:** Run against a **temporary `ANTFLY_HOME`** (the seam in
`adapter-antfly/src/paths.ts:14`), set and asserted *before* any import or
spawn, with the binary copied into it. Never the real `~/.antfly` or the
`io.bakin.antfly` unit. Find out:
- where in-flight bytes land;
- resume behavior after SIGTERM/SIGKILL;
- the partial state left behind and how to clean it;
- what stdout/stderr look like.

**Acceptance:**
- [ ] `tasks/evidence-antfly-pull.md` has reproducible steps and findings.
- [ ] SPEC D12 and Task 5.3 are updated with the decided disk-growth paths,
      models point of no return and cleanup.

**Verification:** the steps reproduce twice; `ANTFLY_HOME` is asserted in
the script. **Scope:** XS.

---

## PR 1 — Core, resources, local runner, transfer primitive, plugin API (no UI)

### 1.1 Prepare — SDK operation types
**Description:** Add `packages/sdk/src/types/operations.ts` (the spec
model) with SDK index exports and core re-exports. `OperationCancelledError`
lives in core.
**Acceptance:** [ ] types match the spec; the public API inventory is
updated if types are inventoried.
**Verification:** `typecheck`; `build:vendors`.
**Files:** `packages/sdk/src/types/{operations,index}.ts`,
`packages/core/src/operations/index.ts`. **Scope:** S.

### 1.2 Prepare — Registry (lifecycle, fingerprints, outcomes, quiet, events, audit)
**Description:** The registry, with the context and the two clocks, the
atomic fingerprint claim → validate → 202 → run sequence, the D22 outcome,
cancel (settle-before-terminal, refused past the point of no return),
`awaitOperation`, list and eviction, `quietState` plus the threshold table
(per-stage stuck dedupe), and `operation.updated` complete views with `rev`
(milestones via `broadcast`, ticks via `broadcastEphemeral` at ≤2/s), plus
the audit record. Also the **SIGTERM shutdown note**.
**Acceptance:**
- [ ] Unit tests: attach; validate failure unregisters; cancel before and
      after the point of no return; terminal only after settle; rev
      monotonic; throttle; eviction; one audit record.
- [ ] `quietState` table tests, including output without progress going
      stuck.
- [ ] A shutdown test: live operations get the log line.

**Files:** `packages/core/src/operations/{registry,quiet}.ts`, tests.
**Scope:** M (1.2a registry + outcome, 1.2b quiet + events).

### 1.3 Prepare — Resources module
**Description:** `resources.ts`:
- Canonical order (install-state → media-store → search-engine).
- O_EXCL lock files with holder metadata, written to the **existing**
  `~/.bakin/install.lock` path for `install-state` and to
  `~/.bakin/locks/` for the other two.
- Abortable polling `acquire`, immediate release of a late lease,
  stale-holder reclaim, non-blocking `tryAcquire`, and `heldBy(operationId)`.

**`install-state` is implemented by delegating to `install-lock.ts`**: the
same file, O_EXCL algorithm and `AsyncLocalStorage` ownership context
(`holdingOperation`, `install-lock.ts:50`). An operation holding
`install-state` runs inside that context, so every existing inner
`withInstallLock` (reentrant) and `assertInstallLockHeld` call is satisfied
unchanged: `sync.ts:200`, plugin-assets, `bin-installer.ts:220`, and
`upgrade.ts:75`. Reentrancy applies only within one async ownership context
(one operation's own call chain). Repair children run sequentially, so no
siblings share it. The old public API stays until 4.6 deletes it.
**Acceptance:**
- [ ] Concurrency tests: same-process and cross-process (spawned child),
      abort before and racing acquisition, stale reclaim, sorted order,
      **old-API holder blocks new-API acquire and vice versa**.
- [ ] Inside an operation holding `install-state`, `withInstallLock` is
      reentrant and `assertInstallLockHeld` passes; outside, they behave as
      today.
- [ ] `runLocal` invoked inside an existing `withInstallLock` holder is
      reentrant and never waits on itself.
- [ ] Architecture test scoped to **operation resources only**: no code
      outside `resources.ts` or `install-lock.ts` creates `install.lock` or
      files under `~/.bakin/locks/`. Antfly's `service-lock.ts`
      (`'wx'`, `:30`) is out of scope by construction.

**Files:** `packages/core/src/operations/resources.ts`, tests, architecture
test. **Scope:** S–M.

### 1.4 Prepare — Registry ↔ resources wiring and the local runner
**Description:**
- `startOperation` acquires the declared resources in canonical order
  after the 202, shows `waitingFor` while blocked, runs the operation's
  `revalidate` hook after a wait, and releases on settle.
- Context code can assert `op.holds(resource)`.
- `runLocal(input)`: the same registry semantics in-process, with no HTTP,
  returning the outcome. Used by in-process callers (onboarding components
  until PR6, the CLI's in-process mode) and by in-PR callers of
  `op`-taking helpers.

**Acceptance:**
- [ ] A different request on a held resource waits visibly and is
      cancellable while waiting.
- [ ] `revalidate` runs after the wait, and a failure maps to an outcome.
- [ ] `runLocal` produces the same view sequence as the server path.

**Files:** registry, `packages/core/src/operations/local.ts`, tests.
**Scope:** S.

### 1.5 Prepare/switch — Transfer primitive plus every artifact-download caller
**Description:**
- `downloadToFile` gains `onEvent` (attempt, bytes, stalled, retry) and
  `signal`, and drops `onProgress`.
- `downloadText` moves into the primitive.
- `opTransfer` helper.
- Extract helpers take `signal` plus an `onOutput` (stderr → `op.output`).
- **One commit** migrates all callers:
  - the 2 `onProgress` users: `requirements-installer`, `bin-installer`
  - `consumer-install.ts`, `resolve-source.ts`, `whiskit/resolver.ts`,
    `upgrade-artifact.ts`
  - the antfly engine installer, which now streams instead of
    `arrayBuffer()`
- Deletes `src/core/whiskit/download.ts`.
- Adds the G3 architecture test: no `arrayBuffer()`/raw-fetch artifact
  downloads in installer modules, and no import of the deleted module.

**Acceptance:**
- [ ] Event-order tests: success, stall, deadline, checksum no-retry,
      abort no-retry with the partial removed.
- [ ] Caller tests green; antfly streaming plus checksum plus retry.
- [ ] `rg whiskit/download` is empty.

**Files:** `download.ts`, the 7 callers, antfly installer, deletions,
tests. **Scope:** M (5a primitive with additive `onEvent` kept beside
`onProgress`; 5b the caller switch plus deletion of `onProgress` and the
old module).

### 1.6 Prepare — Operations HTTP surface plus route metadata
**Description:** `api/operations.ts` (list, get with optional children and
404 `{ bootId }`, cancel), wired in `request-handler.ts` and declared in
`core-routes/index.ts`.
**Acceptance:** [ ] route tests including the cancel matrix; the generated
OpenAPI includes the routes.
**Files:** `api/operations.ts`, `request-handler.ts`,
`core-routes/index.ts`, tests. **Scope:** S.

### 1.7 Prepare — `ctx.operations` plugin API (D19)
**Description:**
- SDK `context.ts` and core `plugin-types.ts` gain `operations.start`.
- `plugin-context-factory.ts:90` constructs it, prefixing kind and
  fingerprint with `<pluginId>:` and setting `owner`.
- `origin` is propagated from the triggering request through a route
  helper.
- Resource authorization: core resources only for `isCorePlugin`, plugin
  resources namespaced.
- `@makinbakin/sdk/testing` fake.

**Acceptance:**
- [ ] Tests: namespace enforcement; a user plugin naming
      `media-store` → rejected; a core plugin allowed; origin carried; the
      fake works in an `examples/*` style test.

**Files:** SDK context, `plugin-types.ts`, `plugin-context-factory.ts`,
the SDK testing harness, tests. **Scope:** M.

### 1.8 Docs
New `.claude/knowledge/operations.md` (model, registry, resources with
order, stale and old-API interop, `runLocal`, transfer primitive,
`ctx.operations`). CLAUDE.md Key Patterns entry. `media-pipeline.md`
(download events). Docs site `extending/plugins` (`ctx.operations`).
**Scope:** S.

**◆ PR1 checkpoint:**
- Full suite, `typecheck`, `lint`, `check:cycles`, `ui:conformance --quick`.
- Isolated boot smoke (guest-URL antfly settings): `GET /api/operations` →
  `{ bootId, operations: [] }`.
- **Success-criterion tests owned here:** a generic "accept under 500ms
  while run is blocked" harness (reused by every later switch);
  stale-old-boot guard on the server side (404 carries the new `bootId`).

---

## PR 2 — UI pattern, hook, tray, attention

### 2.1 Prepare — `useOperation` plus `startOperation`
**Description:** Rev and boot guards, reconcile and backoff, and the
phases.
**Acceptance:**
- [ ] A delayed older GET never regresses state.
- [ ] A missed stage is recovered on reconcile.
- [ ] A bootId change → restarted; a **response from the old boot arriving
      after restart detection is ignored**.
- [ ] Same boot plus 404 → expired; unreachable → recovery.

**Files:** hook, SDK hooks index, test. **Scope:** S.

### 2.2 Switch — `OperationProgress` public contract (one commit after approval)
**Description:**
- Build the component (composes Timeline, Progress, Alert and Button;
  full and compact).
- Build the story file (`CanonicalUsage` first plus the spec states, with
  coverage axes spread across them and play assertions), the visual test
  entry, the `public-api.json` registration and the kit-coverage entry.
- **Approval gate before committing:** show the maintainer the canonical
  screenshots and measured performance deltas. On approval, commit
  component, story, inventory, visual test and approved baseline
  **together**, so no intermediate red conformance state exists.

**Acceptance:**
- [ ] `ui:story-compliance:check`, `ui:kit-coverage:check`,
      `ui:test:stories` and `ui:conformance --full` are green.

**Files:** component, SDK patterns index, story, `public-api.json`,
visual-test entry, baseline. **Scope:** M.

### 2.3 Switch — Header tray plus `OperationsAttentionProvider`
**Description:**
- Check the Overlays/Popover and Feedback stories first; any mismatch →
  deviation template, then stop.
- Tray: compact rows, Cancel, `href` link.
- Attention: toast **and OS notification** on finish, fail and stuck;
  stuck deduped **per stage per operation**; keyed on
  `origin ∈ {web, cli, discord}`.
- Mounted beside `ApprovalsAttentionProvider`.

**Acceptance:**
- [ ] RTL: hidden when empty; rows; cancel; toast plus OS notification
      once per transition; stuck once per stage.
- [ ] The host page fixture at 320px and with keyboard.

**Files:** tray, provider, header mount, `Providers.tsx`, tests.
**Scope:** M.

### 2.4 Docs
Docs site `extending/ui`, `style-guide.md`, `operations.md` UI section.
**Scope:** S.

**◆ PR2 checkpoint:** full checks, `ui:conformance --full`, **`bun run
build` (full compiled chain)**, and a smoke run of the compiled binary in
an isolated home (vendor and import-map wiring for the new SDK exports).

---

## PR 3 — The margo path: repair, media, CLI renderer, approvals

### 3.1 Prepare — Children in the registry
**Description:** `startChildOperation` (with resources), sequential
children, the parent latch, `allSettled` join, the D21/D22 precedence
table, and parent `lastProgressAt` aggregation.
**Acceptance:** [ ] table tests per precedence row; latch; early rejection
doesn't publish terminal state. **Scope:** S.

### 3.2 Prepare — CLI operation renderer plus HTTP follow helper
**Description:** `src/cli/operation-renderer.ts` (TTY, non-TTY and JSON;
children and items; quiet and liveness; attempts; waiting; log tail;
server-mode Ctrl-C cancel then detach) and `followOperation()` in
`src/cli/http.ts` (SSE plus snapshot reconcile). Unused by commands until
3.5.
**Acceptance:** [ ] renderer output tests from scripted views; Ctrl-C tests.
**Scope:** M.

### 3.2b Switch — CLI targets its own home's server (every command)
**Description:** `src/cli/http.ts` resolves its base URL once:
- An explicit `BAKIN_URL` is used as given (server-only; unreachable is an
  error).
- Otherwise `server.lock` in the CLI's `BAKIN_HOME` gives a live pid and its
  port.
- Otherwise there is no server: server-only verbs fail with a clear "Bakin
  isn't running" message.

Initial requests, `followOperation` and cancel all use it. This applies to
**every** CLI command, so every operation verb converted later inherits D11
targeting. In-process fallback for `install`/`onboard` stays in PR6.
**Acceptance:**
- [ ] Tests: non-default lock port; absent lock; dead pid; explicit
      loopback URL pointing elsewhere.
- [ ] Every existing CLI test is green.

**Files:** `src/cli/http.ts`, `src/core/server-lock.ts` (read helper),
tests. **Scope:** S.

### 3.3 Prepare — Optional repair contract fields
**Description:** Add `operationPlan?`, `resources?` and
`apply(items, op?)` to the SDK `HealthRepairActionDefinition` and core
types. Accept them in `health-contract.ts` schemas and forward them in
`health-check-registry.ts`. Add the testing fake. These are **optional in
this commit only**; 3.5 makes them required.
Registration also **authorizes declared resources against the registering
owner** (`health-check-registry.ts:92`): core resources only for
`isCorePlugin` owners, other names must be `<ownerId>:*`, and anything else
is rejected at registration.
**Acceptance:**
- [ ] typecheck; schema tests accept and forward the new fields.
- [ ] Authorization tests: a user plugin declaring `media-store` or a
      foreign namespace → rejected; a core plugin → allowed.

**Scope:** S.

### 3.4 Prepare — Per-plugin repair action adoption (one commit per plugin group)
Each commit gives every action in the group a real `operationPlan`
(mutation boundary = the first stage that changes state), its `resources`,
and an `apply` that reports through `op` when provided. Each also adds
fixtures for the runtime contract test. Behavior without `op` is
unchanged.

| Commit | Actions (registration) | Notes |
|---|---|---|
| 3.4a schedule | cutover (`schedule/index.ts:137`), :158 action, unrunnable-jobs (:175) | |
| 3.4b tasks | consistency, order (`tasks/index.ts:115-116`) | |
| 3.4c health core | run-dirs sweep (`health/index.ts:1031`), sync-skill (:1147) | |
| 3.4d health search | outbox, consistency, spin, scar, canary, engine-burn, consistency-restart (`health/index.ts:1140-1146`; e.g. `search-consistency.ts:437`) | `resources: ['search-engine']` where they mutate the engine. **Planning becomes local-only:** `search-consistency`'s `all_actionable` plan (`:453`) stops listing engine tables and fetching per-table stats. It plans from the check's recorded evidence, and fresh engine validation moves into `apply` (with `revalidate`). A no-network test makes the fetch fake throw during `plan` for every search action |
| 3.4e media + plugin-assets | media store (`:1139`) via **installer adoption**: `installMediaStore(op, …)` with `MEDIA_PLAN`, `media-store`, 6 tarballs as items. Its onboarding caller (`onboarding/media.ts`) passes a `runLocal` context. Plugin-assets (`:1113`) threads `op` through `installPluginAssets` (items per plugin) and declares `resources: ['install-state']`. Its inner `withInstallLock` call is now reentrant under the shared ownership context, so it needs no change in PR3 | the **margo core replay test** lives here |
| 3.4f workflows | stale instances, skill drift (`workflows/index.ts:86-87`) | |
| 3.4g models | recommended routes (`models/index.ts:60`), dead selection (:73) | |
| 3.4h team | persona (`team/index.ts:734`), agent-sync (:735, which threads `op` into `repairPackLocally` items), agent-sync migration (:736); planning stays a bounded local scan (`team/lib/health-checks.ts:457-462`) | |
| 3.4i spend + assets | evidence, accept-unattributed (`spend/index.ts:55-56`); asset repair (`assets/index.ts:122`) | |

**Acceptance (each):** [ ] every action in the group passes the runtime
contract test (stages follow its plan; at least one `op` report); the
existing repair tests are green. **Scope:** S–M each.

◆ Full suite after 3.4i.

### 3.5a Prepare — Approval hooks and channel outcome method (additive)
**Description:**
- The approval kind registry gains an optional `afterResolve`, which the
  approval service invokes strictly after it saves, notifies the channel
  and publishes. No kind registers it yet.
- Optional `RuntimeChannels.postApprovalOutcome`, with the Discord bridge
  implementing it as a follow-up message.
- Ordering tests use a fake kind.

**Acceptance:** [ ] ordering test; Discord follow-up rendering test; no
behavior change for existing kinds. **Scope:** S–M.

### 3.5 Switch — Repair flow, including D24 approvals
**Description:** One commit:
- `operationPlan` and `apply(items, op)` become **required**.
- `applyDoctorRepair` becomes `startDoctorRepair` (parent operation;
  fingerprint claimed before the plan is consumed; children per action;
  `verifying`; `result.body` is the report).
- `/doctor/repair/apply` → 202/200, with route metadata in `core-routes`.
- `RepairDialog` and `use-repair-plan.ts` use `useOperation` and
  `OperationProgress`; the timeout and outcome-unknown error are deleted.
- `bakin doctor --fix` uses `followOperation` plus the renderer.
- `doctor-escalation.ts` calls `startDoctorRepair` + `awaitOperation`.
- **D24 lands in the same commit, because the Health apply route's
  approval-backed branch (`plugins/health/index.ts:681`) must return an
  operation too:**
  - `doctor-approvals.ts` `onResolve` starts the repair and returns its id
    without waiting.
  - The health-repair kind registers `afterResolve` (wait, update the task
    and verification state, then `postApprovalOutcome`).
  - Rehydration marks `applying` records with no live operation as
    "outcome unknown".
- The runtime contract test runs over all 26 actions.

**Acceptance:**
- [ ] Route parity (`result.body` equals the old response).
- [ ] Two tabs with the same selection → attach.
- [ ] Accept under 500ms with a blocked action.
- [ ] RTL: the margo scenario at UI level, close-while-running, cancel.
- [ ] CLI `doctor --fix` output test.
- [ ] The approval-backed apply returns an operation id.
- [ ] Decision saved, card updated and published before `afterResolve`;
      exactly one outcome follow-up.
- [ ] Restart → "outcome unknown".
- [ ] **Old-reader recovery:** the actual recovery function
      (`doctor-approvals.ts:455`) runs over records written by the new
      flow, mid-flight and terminal, and recovers them correctly.
- [ ] Escalation tests are green.

**Scope:** L (atomic; 3.1–3.5a carry the prepared pieces).

### 3.7 Docs
`operations.md` (children, repair), `doctor-and-health-checks.md`,
`approvals.md`, `delivery-bridge.md`, `media-pipeline.md`; docs site
`extending/plugins` (repair contract). **Scope:** S.

**◆ PR3 checkpoint:**
- Full checks, `--full` conformance, the **health plugin `test:ui`
  fixture** with its report inspected.
- **Manual margo check:** isolated boot (guest-URL antfly), with
  `HTTPS_PROXY` pointed at `scripts/dev/stall-proxy.ts`, a CONNECT proxy
  that relays N bytes of the registry response then stalls. Trigger the
  media repair and observe the plan, bytes, quiet → stuck with liveness,
  retry and failure in the browser and in `bakin doctor --fix`.
- **Success-criterion tests owned here:**
  - media exclusion (repair, plus an onboarding `runLocal` install, plus a
    second process, all at once → serialized, waiting visible, no shared
    staging);
  - cancel-boundary matrix for media and plugin-assets.

---

## PR 4 — Installs and lifecycle; retire the legacy job registry and lock API

### 4.1 Prepare — Shared install helpers accept an optional `op`; install-state moves to the registry
**Description:**
- `installManifestRequirements` and the bin, model and npm helpers take
  `op` (items; managed bun as an item with bytes; point of no return at
  the first write to `~/.bakin/bin` or the model dir).
- Whiskit `onStage` gains `status: 'start'` plus streamed output.
- `replacePluginDir` takes `op` (existing order; point of no return at the
  journal-first rename).
- These helpers gain an **optional** `op` next to the existing
  `progress?: InstallProgressFn`, which is unchanged for now; 4.6 removes
  it.
- **Callers inventoried and kept compiling:** package `installer.ts`,
  `sync.ts`, `updater.ts`; plugin `commit.ts`, `upgrade.ts`,
  `upgrade-github.ts:155`, `upgrade-gate.ts` (`UpgradeOptions`, :44, and
  asset upgrade :192), `upgrade-artifact.ts:124`; `onboarding/plugin-assets.ts:520`.
- No lock changes are needed: `install-state` already shares the
  install-lock ownership context (1.3), so the inner calls stay valid
  throughout PR4.

**Acceptance:**
- [ ] Item and byte tests.
- [ ] A hung fake build names its active item, goes stuck, and fails via
      `DEFAULT_BUILD_TIMEOUT_MS` with rollback.
- [ ] The replace-transaction crash/recovery suite is unchanged and green.
**Scope:** M–L (additive parameters plus caller compile fixes).

### 4.2 Switch — Package and agent-package flows
**Description:** One commit:
- Routes: install (both), `DELETE /api/packages/:id`,
  `DELETE /api/agent-packages/:id`, both `:id/sync` → operations
  (fingerprints, `install-state`, spec points of no return, outcome
  parity, `core-routes` metadata).
- **The team-wide sync route** (`plugins/team/lib/routes/teams.ts:217`,
  which loops `syncAgent` over members) becomes a sync operation
  (`install-state`; members as items). It is registered via
  `ctx.operations` by the team plugin, which is a core plugin.
- **Lesson toggle** (`agent-packages/lesson-toggle.ts:125-126`) takes a
  non-blocking `install-state` `tryAcquire` **before** the ledger write
  (409 `install_busy`) and holds it through the `syncAgent` recompose. It
  stays synchronous because the recompose is bounded and local
  (`fetch: false`).
- Clients: Team `adopt-dialog.tsx`, `package-card.tsx`, `team-detail.tsx`,
  `diagnostics-tab.tsx` (and the team-wide sync trigger), and the Explore
  install dialog's agent and package paths.
- CLI: `bakin packages|agents install|remove`, `agents|packages sync`.
- Delete those routes' `?async` branches.
- **Managed-block migration** (`POST /api/agent-packages/migrate`,
  `agent-packages/dynamic.ts:227`, plus the `bakin agents` CLI branch at
  `src/cli/commands/agents.ts:304`) becomes an operation (`install-state`,
  agents as items). The resource is acquired **before** the first workspace
  or ledger write (`migration.ts:108,119`), so the whole chain
  (rewrite → ledger → `syncAgent`) runs under one owner. It is not
  cancellable after the first workspace write.
- `sync.ts` internal lock acquisition → registry declaration plus
  `op.holds`. **In this same commit**, the two sync entry points whose own
  switches land later get explicit wrappers, so no caller is ever without
  an owner:
  - the runtime switch's sync step (`runtime-switch.ts:269`) runs inside
    `runLocal({ resources: ['install-state'] })` until 6.3;
  - the onboarding agent-sync component (`onboarding/agent-sync.ts:103`)
    wraps its `install()` in `runLocal({ resources: ['install-state'] })`
    until the 6.2 onboarding switch replaces it with declared resources.

**Acceptance:**
- [ ] Parity; accept under 500ms; a plugin install and a pack install
      contend → visible waiting.
- [ ] Cancel before projection leaves no trace; cancel after → 409.
- [ ] RTL for Team and Explore; CLI tests for each verb.
- [ ] Team-wide sync operation test; lesson toggle: busy → 409 with no
      ledger write, and success leaves the ledger and projection
      consistent.
- [ ] Migration: busy → waits visibly with **no** workspace or ledger
      write before acquisition; success runs rewrite → ledger → sync under
      one owner (route and CLI tests).
- [ ] Ownership tests in this commit for the runtime-switch and
      onboarding agent-sync wrappers: each drives a real sync and passes
      the inner `op.holds` assertion.

**Scope:** L (atomic flow).

### 4.3 Switch — Plugin preview, install and upgrade
**Description:** One commit:
- Previews → `fetch` operations (fingerprint from source/ref; result =
  consent preview, `awaiting_consent`).
- Install and upgrade commits → operations.
- Clients: Explore `install-dialog.tsx` plugin path,
  `consent-dialog.tsx`, **Health `use-system-data.ts`
  `performPluginUpgrade` (:232) and its caller (:376)**.
- **Onboarding's recommended plugins** (`onboarding/recommended-plugins.ts:62`,
  which reads `awaitingConsent`/`ok` from the install route) follow the
  preview and commit operations to terminal outcomes.
- CLI: `bakin plugins install|upgrade` **and `bakin plugins import`**
  (`installImportedPluginLegacy`, `src/cli/commands/plugins.ts:263`). Its
  preview → consent → commit sequence follows each operation to a
  terminal outcome before reporting "Installed".
- Route metadata (`core-routes` upgrade description updated).
- Delete the `?async` branches.

**Acceptance:**
- [ ] Preview → consent → commit end to end; parity; Health upgrade flow
      RTL.
- [ ] `plugins import` waits for terminal outcomes and handles consent (a
      test with a manifest of 2 plugins, one requiring consent).
- [ ] Recommended-plugin onboarding: preview → consent → terminal result
      test.
- [ ] Cancel during preview download and before the rename; refused after
      the rename.

**Scope:** L (atomic flow).

### 4.4 Switch — Plugin remove, restore, link and unlink
**Description:** One commit:
- Remove (not cancellable), restore (point of no return at the first
  delete or copy), link (point of no return before the force-unlink and
  the build) → operations.
- Unlink takes a non-blocking `install-state` try (409 `install_busy`).
- Clients and CLI: `bakin plugins remove|restore|link|unlink`.
- Metadata.

**Acceptance:** [ ] parity; restore's non-force copy boundary; link's
force boundary; unlink busy → 409. **Scope:** M.

### 4.5 Switch — Skills preview, install and map
**Description:** One commit:
- `/api/skills/preview`, `/install` and `/map/preview` → operations.
- **Synchronous validation is only input and token checks.** The trust
  assessment (hub verdicts with remote version and scan requests,
  `source-fetcher.ts:529`) runs inside the operation's `verifying` stage
  **before any mutation**, and still fails closed. A refusal becomes a
  failed outcome carrying today's refusal status and body.
- Skill-map **apply** takes a non-blocking `install-state` try.
- Clients: `hub-skills-section.tsx` (delete `INSTALL_TIMEOUT_MS`).
- CLI: `bakin skills install`, **`bakin skills map` (`cmdMap`, `skills.ts:275`)**.

**Acceptance:**
- [ ] A stalled hub fake: the route still accepts in under 500ms, the
      stall is visible, and a refusal is preserved.
- [ ] Parity; map preview/apply CLI test.

**Scope:** M.

### 4.6 Switch — Delete the legacy job system and lock API (G3)
**Description:**
- Delete `install-progress.ts` and its symbols, `api/install-jobs.ts` and
  its route, `packages.install_*`, Explore's `InstallProgressPanel` and
  its wiring, and the `install-lock.ts` throw-on-busy API
  (`acquireInstallLock`, `withInstallLock`, `InstallLockBusyError`). All 8
  callers have been converted by now.
- Remove every `progress?: InstallProgressFn` parameter added alongside
  `op` in 4.1, and make `op` required.
- Replace every inner `withInstallLock` with `op.holds('install-state')`
  assertions and `assertInstallLockHeld` with the resource-module
  equivalent, then delete the old public API in the same commit.
- **Entry-point inventory for the sync engine** (all must already hold
  `install-state` by this commit):
  - the sync route operation (`agent-packages/dynamic.ts:203`, 4.2)
  - the team-wide sync operation (`teams.ts:217`, 4.2)
  - lesson toggle (`lesson-toggle.ts:126`, 4.2)
  - the managed-block migration operation (`dynamic.ts:227` and CLI
    `agents.ts:304`, 4.2)
  - the agent-sync and migration repairs (`migration.ts:228,255`;
    `team/lib/health-checks.ts:487`; 3.4h)
  - the onboarding agent-sync component (`onboarding/agent-sync.ts:103`;
    `runLocal` wrapper from 4.2, declared resources from 6.2)
  - the runtime switch (`runtime-switch.ts:269`; `runLocal` wrapper from
    4.2, its own operation declaring `install-state` from 6.3)

  A test per entry point drives a real sync, which fails on the inner
  assertion if ownership is missing.
- Architecture tests:
  - no `?async` in `packages/host/src/api`;
  - no `packages.install_` and no `InstallProgressFn`;
  - no `acquireInstallLock`/`withInstallLock`;
  - **every `install-state` writer goes through the registry or
    `tryAcquire`**, including every caller of `syncAgent`/`syncAllAgents`;
  - the converted/synchronous route lists so far.

**Acceptance:** [ ] `rg` empty for every deleted symbol; architecture tests
with teeth proven by a fixture. **Scope:** S–M.

### 4.7 Docs
`agent-packages.md`, `capability-packs.md`, `plugin-lifecycle.md`,
`plugin-system.md`, `explore-plugin.md`, `skill-hub-interop.md`,
`operations.md`; README if it describes CLI install output. **Scope:** S.

**◆ PR4 checkpoint:**
- Full checks, `--full` conformance, `test:ui` fixtures for **explore,
  team and health** with reports inspected.
- Manual check: an isolated home with a local Bits plugin source; preview
  → consent → staged commit; cancel a second attempt during the stall
  proxy's download.
- **Success-criterion tests owned here:** a parameterized accept-under-500ms
  test and a cancel-boundary matrix across every PR4 route.

---

## PR 5 — Search

### 5.1 Prepare — Background mutators respect `search-engine`
**Description:** The migration pump, boot migration resumption
(`search-startup.ts:51`) and the wedge watchdog
(`search-registry-core.ts:570`) `tryAcquire('search-engine')` and defer to
their next tick when it is held. Foreground paths are unchanged in this
commit, so this is today's behavior plus deference.
**Acceptance:** [ ] tests: each background mutator skips while held.
**Scope:** S.

### 5.2 Prepare — Antfly engine and model installers take `op`
**Description:**
- `installAntflyDependency(op, …)` (spec plan; point of no return at
  service stop + swap; the service lock and `~/.antfly` paths unchanged)
  and `SearchAdapterSetupOptions.op`.
- Models (per T0, `tasks/evidence-antfly-pull.md`): parse the stderr
  protocol for file structure and announced sizes (the item `total` grows
  as files start), poll the current staging `.part` for bytes between the
  16 MiB lines, and send every line to `op.output`. `runPull` passes
  `--models-dir <inferenceModelsRoot()>`. Cancel sends SIGTERM and keeps
  the staging dir (the next pull resumes); there is no cleanup code.
- **Callers in this commit:** `onboarding/search.ts:57` and
  `onboarding/search-models.ts:37` pass `runLocal` contexts (they switch
  to the onboarding contract in PR6).

**Acceptance:**
- [ ] Plan and stage tests with fetch and spawn fakes.
- [ ] Cancel during the engine download leaves the old engine running.
- [ ] Models cancel (T0: staging plus atomic publish): cancel is allowed
      throughout the pull; the final model dir is untouched and the
      staging dir is kept; a re-run resumes (stub binary replaying the
      stderr protocol).
- [ ] Stall test with a stub `antfly` that prints the protocol and then
      stops (the real binary ignores proxy and base-URL overrides).
- [ ] `runPull` argv includes `--models-dir` set to
      `inferenceModelsRoot()`.

**Scope:** M.

### 5.3 Switch — Search reset and reindex
**Description:** One commit:
- Reindex and reset → non-cancellable operations (tables as concurrent
  items; reset = stop → wipe → start → reindex stages; outcomes
  `tables_parked`, `reset_failed`).
- **Every foreground entry point acquires `search-engine`**:
  `request-handler.ts:403` (reindex), `/api/search/reset`, the exec tool
  (`origin: 'system'`).
- Delete `rebuildRegisteredTables`' attach-to-any-pass coalescer,
  `startReindexJob`, `getReindexJobStatus` and `ReindexJobStatus`, and
  `?async` in `request-handler.ts`.
- Clients: Health `system-search-section.tsx` / `use-system-data.ts`
  search parts.
- CLI: `bakin reindex`, `bakin search reindex|reset`, with the pollers
  deleted.
- Metadata; the architecture test is extended to `request-handler.ts`.

**Acceptance:**
- [ ] Parity (the reset body change is the documented exception).
- [ ] Reset waits for an in-flight pump pass, visibly.
- [ ] Accept under 500ms; Health RTL; CLI tests.

**Scope:** L (atomic flow).

### 5.4 Docs
`search-system.md`, `operations.md`, link to the T0 evidence. **Scope:** S.

**◆ PR5 checkpoint:**
- Full checks.
- **Real-engine check in a disposable Linux container** (maintainer's
  choice): `scripts/dev/search-container-check.ts` builds a throwaway
  container with its own `BAKIN_HOME` and `ANTFLY_HOME`, with antfly in
  strict-child mode and an owned service (so reset is permitted). It runs
  `bakin install search`, `install search-models`, a reset, a reindex
  during a forced migration-pump pass (asserting visible waiting), and an
  engine install cancelled during download.
- It never touches this Mac's `io.bakin.antfly`. The script is
  developer-run, with no CI change.

---

## PR 6 — Onboarding, CLI mode, runtime hub, runtime switch; final sweep

### 6.1 Prepare — Component plans, cliSecret and operation-mode
**Description:** Additive only:
- Every onboarding component exports its `OperationPlan`.
- `server.lock` is written with mode `0600` and a per-boot `cliSecret`
  (old readers ignore the field).
- `src/cli/operation-mode.ts` implements D11 selection, with tests and no
  callers yet.
- The shared zod options schema for component installs.

**Acceptance:**
- [ ] Mode matrix tests (explicit URL including loopback; lock with a
      non-default port; dead or absent lock; refused-before-send;
      failed-after-send → error).
- [ ] Lock mode `0600`.

**Scope:** M.

### 6.2 Switch — Onboarding flow
**Description:** One commit:
- `OnboardingComponent.install(opts, op)` for **all 16 components**;
  delete `OnboardingOptions.onProgress`.
- `runOnboard`'s Ink UI renders views.
- `/api/runtime/onboarding/install` → operation with explicit options,
  every installable component, auto-approve deleted, and
  `allowServiceClaim` only with a matching `X-Bakin-Cli-Secret`.
- Runtime hub `overview-tab.tsx` (media now fixable).
- CLI `bakin install *` / `bakin onboard` via `operation-mode` (server or
  in-process with `runLocal`; local Ctrl-C semantics).
- Replace the PR3/PR4/PR5 `runLocal` call sites in the media, search and
  agent-sync components with the contract's `op` (agent-sync declares
  `install-state`). Metadata.

**Acceptance:**
- [ ] Each component emits its plan.
- [ ] Claim refused without the secret and with a wrong one.
- [ ] **Server/local parity for media, search, search-models,
      plugin-assets and agent-sync** (parameterized).
- [ ] The tray shows CLI-started operations.
- [ ] A local run serializes against a server started mid-run.
- [ ] Hub RTL.

**Scope:** L (atomic flow).

### 6.3 Switch — Runtime switch
**Description:** One commit:
- `switchRuntime` phases → stages (not cancellable; dry-run read-only).
  The operation declares `install-state`, replacing the 4.2 `runLocal`
  wrapper around its sync step.
- `POST /api/runtime/switch` → 202.
- `runtimes-tab.tsx` uses `useOperation`.
- Delete its `EventSource`, `runtime:switch*` events, `ProgressSteps` and
  `reduceSwitchProgress`.
- `bakin runtime use [--dry-run]` uses the renderer.
- Metadata.
- Architecture tests: no `runtime:switch`; `new EventSource` only in
  `use-sse.ts`, `use-schedule.ts` and `dev-client/client.ts`.

**Acceptance:** [ ] report parity (`switch_failed`); RTL; CLI; architecture
teeth. **Scope:** M.

### 6.4 Prepare/switch — Pi extension discovery deadline plus final route lists
**Description:** A 15s deadline around `adapter-pi/src/extensions.ts:63`;
the final converted/synchronous lists pinned with each writer's resource.
**Acceptance:** [ ] a hung-discovery fake test. **Scope:** XS.

### 6.5 Final sweep
**Description:**
- Knowledge: `runtime-capabilities.md`; `operations.md` (final, roadmap
  removed); any doc naming a deleted symbol.
- CLAUDE.md entry final; README CLI section; docs site.
- A full `rg` of the spec deletion list.
- Ticket the schedule-hooks EventSource debt.
- SPEC and PLAN status set to done, with the success-criteria evidence
  table (test files and CI run links).

**Scope:** S.

**◆ PR6 checkpoint (final):**
- Full checks, `--full` conformance, `test:ui` for the touched plugins, and
  `bun run build` plus a compiled-binary smoke run in an isolated home.
- The PR5 container script rerun with the final CLI mode (in-process and
  server).
- A walkthrough of success criteria 1–11, each linked to its owning test.

---

## Success-criteria ownership

| Criterion | Owning tests (PR) |
|---|---|
| 1 accept under 500ms | harness (PR1) parameterized per switch: repair (PR3), installs (PR4), search (PR5), onboarding and switch (PR6) |
| 2 margo replay | core (PR3 3.4e), UI (PR3 3.5), manual stall proxy (PR3 ◆) |
| 3 cancel boundaries | per-flow matrices in PR3 (media, plugin-assets), PR4 (every install route), PR5 (engine; models per T0), PR6 (components) |
| 4 restart/expired/unreachable | PR1 (server), PR2 (hook, including the stale old-boot response) |
| 5 CLI parity and authority | PR3 3.2b (targeting for every command); PR6 6.1 + 6.2 parameterized parity across the five verbs |
| 6 exclusion and attach | PR3 media three-way; PR4 install-state contention; PR5 pump vs reset |
| 7 Discord ordering | PR3 3.5a (fake kind) + 3.5 (health repair) |
| 8 model bytes | PR5 5.2 (per T0) |
| 9 deletions | architecture tests in PR1, PR4, PR5, PR6 |
| 10 green suites | every ◆ |
| 11 docs | per-PR docs tasks plus the 6.5 sweep |

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Lock interop between the old API and resources during PR1–PR4 | High | Same file and O_EXCL algorithm; cross-API exclusion tests (1.3); old API deleted only after all 8 callers convert (4.6) |
| 26-action repair migration | Med | Nine per-plugin prepare commits with fixtures; the switch only flips required-ness; the runtime contract test proves adoption |
| D24 ordering or recovery regressions | High | Prepared in 3.5a with a fake kind; the switch adds ordering, restart and real-recovery-function tests |
| Large atomic switch commits (3.5, 4.1–4.3, 5.3, 6.2) | Med | Every prepare is already landed and tested; switch diffs are wiring; full suite before each |
| T0 negative findings | Med | D12's `total: null` path; models cancel acceptance conditional on T0 |
| Performance ceilings | Med | The PR2 gate; Explore's panel deleted in PR4 offsets it |
| Real machine state (antfly service, `~/.bakin`) | High | Guest-URL settings for isolated boots; real-engine checks only in the disposable container; temp `ANTFLY_HOME` asserted in T0 |
| Mock breakage from new imports | Med | Full suite at every ◆; sweep mocks rather than debugging one by one |
| Build-stamp trap | Med | Explicit staging only |

## Open questions

None blocking. T0 may refine D12 and Task 5.2. The baseline and
performance approvals are scheduled for PR2.

## Success-criteria evidence (done 2026-10-18)

PRs: #976 (PR1), #979 (PR2), #982 (PR3), #984 (PR4), #988 (PR5), PR6
(onboarding, runtime switch, final sweep). CI was green on every merge.

| # | Criterion | Evidence |
|---|---|---|
| 1 | 202/200 within 500ms; invalid requests keep their codes | `tests/api/operations.test.ts` (the accept harness); per flow: `tests/core/doctor-repair.test.ts`, `tests/api/{package,skills}-operations.test.ts`, `tests/host/plugins/install-operations.test.ts`, `tests/api/search-maintenance-routes.test.ts`, `tests/api/onboarding-install-route.test.ts` (400s), `tests/core/runtime-switch-request.test.ts` |
| 2 | The margo replay | `tests/plugins/health/repair-dialog.test.tsx`, `tests/core/media/installer.test.ts`, `tests/core/net/download.test.ts` |
| 3 | Cancel before the first mutation, cancelled only after settle | `tests/api/package-operations.test.ts` + `tests/host/plugins/install-operations.test.ts` (route matrix), `tests/core/media/installer.test.ts`, `tests/core/onboarding/antfly.test.ts` (engine, already-at-pin, version probe), `tests/core/onboarding/models.test.ts` (pull cancel/resume), `tests/cli/component-install.test.ts` (in-process Ctrl-C), `tests/cli/operation-renderer.test.ts` |
| 4 | Restarted / expired / unreachable | `tests/hooks/use-operation.test.tsx`, `tests/api/operations.test.ts`, `tests/components/runtime-hub.test.tsx` |
| 5 | CLI parity, claim authority, no local run after send, tray | `tests/api/onboarding-install-route.test.ts` (parity for media, search, search-models, plugin-assets, agent-sync; 403 without/with a wrong secret; CLI origin), `tests/cli/operation-mode.test.ts`, `tests/core/server-singleton.test.ts`, `tests/core/onboarding/search-claim-intent.test.ts` |
| 6 | Exclusion and attach | `tests/core/media/installer.test.ts` (three-way), `tests/core/onboarding/operation.test.ts` (attach, settings identity, the lock a server waits on), `tests/core/search-registry.test.ts` (pump vs reset, provisioning), `tests/core/search-operations.test.ts`, `tests/integration/runtime-switch.test.ts` |
| 7 | Discord ordering and outcome-unknown | `tests/core/doctor-approvals.test.ts`, `tests/core/approvals/service.test.ts` |
| 8 | Model bytes | `tests/core/onboarding/models.test.ts`, `tests/adapter-antfly/pull-progress.test.ts` |
| 9 | Deletions | `tests/architecture/operations-{resources,transfers,install-state,search,onboarding,runtime-switch,routes}.test.ts` |
| 10 | Green suites | every ◆ checkpoint; CI on each PR |
| 11 | Docs | `.claude/knowledge/operations.md` (final) and the knowledge updates named in SPEC § Success criteria; CLAUDE.md; README; docs site `start/operation`, `extending/plugins`, `extending/ui` |

Follow-ups: #990 (schedule hooks' private `EventSource`).

