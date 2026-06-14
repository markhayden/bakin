# Plan: WS1 — refactor/contract-types

Spec: `SPEC.md` + `.claude/specs/audit-2026-06/REPORT.md` (triage-approved 2026-06-11).
Branch: `refactor/contract-types` off `main`. One revertable commit per finding/file; every
commit green on `bun run test` + `bun run typecheck`. PR gate: `bun run build` + lint + boot
smoke + doc sweep. No shims, no compat re-export layers — dead declarations are deleted in the
commit that obsoletes them.

## The crux decision — RESOLVED BY HARD CONSTRAINT (not a judgment call)

The report is internally contradictory on source-of-truth direction: the **contract-types
finding** says *SDK is home, core re-exports*; the **Task finding** says *core is home, SDK
re-exports*. This is settled by a documented, publish-enforced constraint:

> `packages/sdk/src/types/index.ts` header: *"This module is intentionally self-contained.
> External plugins must be able to typecheck against `@makinbakin/sdk/types` without resolving
> `@bakin/core`, Bakin source aliases, adapter packages, or another plugin's internals."*

Enforced by `scripts/build-sdk-package.ts` → `assertNoForbiddenImports`, which fails the publish
if any emitted `.js`/`.d.ts` references `@bakin/core` or `/src/`. Therefore the SDK types module
**physically cannot** re-export from core. Since plugins reach `Task` (and every contract type)
through `ctx` typed against the self-contained SDK, those types **must** be declared in the SDK.

**Decision (forced): the SDK types module is the single canonical home for every shared plugin
contract type. `packages/core/src/plugin-types.ts` re-exports them from `@makinbakin/sdk/types`;
plugin-local copies are deleted in favor of the SDK declaration.** This matches what core
*already* does (`plugins/manifest.ts`, `plugins/signatures.ts` import types from the SDK) and the
zero-dep DAG (`plugins → sdk`, `core → sdk`). Drifted SDK declarations are reconciled UP to the
real runtime/wire shape (add `updatedAt`/`version` to `Task`, fix `instanceId` on
`WorkflowInstance`, reconcile `AvailableModel` required-ness) — the SDK type becomes the superset,
never a downgrade.

`@bakin/core/plugin-types` stays as core's API surface (it re-exports the SDK contract + keeps
core-internal-only types) — that is the layered public surface, **not** a compat shim. The 38
in-repo plugin files importing from `@bakin/core/plugin-types` are **not** mass-migrated this
workstream (no correctness benefit once the declaration is single-homed; opportunistic later).

The one pre-existing inverted edge (`sdk/utils` → `@bakin/core/format`, the P2 package cycle) is
**out of scope** here — WS1 adds no new inverted edges; the formatter relocation is WS3.

## Dependency graph & sequencing

```
Phase A  unify each type family (SDK canonical → core re-exports → drop plugin dups)
  A0 dead files            ── independent, lands first (noise reduction)
  A1 health family         ── verbatim-identical, lowest risk
  A2 exec-tool types       ──┐ verbatim / near-verbatim
  A3 search API types      ──┤  each: reconcile in SDK, core re-exports, typecheck gate
  A4 manifest types        ──┤  (core's PluginManifest is STALE — SDK is superset)
  A5 PluginContext+BakinPlugin ─ RISKY: pulls in runtime-adapter surface; dedicated commit
  A6 Task / TaskLogEntry   ──┤  add updatedAt/version to SDK; core/task-store + plugins re-export
  A7 AvailableModel        ──┤
  A8 WorkflowInstance/Def  ──┤  fix instanceId
  A9 AgentUsage            ──┘  + fix the plugin-dir-escaping import
  A10 src/types residue    ── delete 12 dead, keep 3 live (Heartbeat/ActivityEvent/ContentState)
        │
        ▼  (single source of truth now established — drift killed)
Phase B  split the two now-canonical god-files (pure reorg, types-only, zero runtime risk)
  B1 split packages/sdk/src/types/index.ts → primitives/manifest/runtime/services/registration/context (+ barrel)
  B2 split packages/core/src/plugin-types.ts → plugin-contract/{search-api,services,registrations} (+ slimmed core)
```

Phase A lands the correctness win (drift eliminated) and is independently valuable; Phase B is
organization. If we stop after A, the workstream's primary goal is already met.

## Tasks

> Each Phase-A unify commit follows the same recipe: (1) ensure the SDK declaration is the correct
> superset (reconcile any drift), (2) delete the duplicate declaration(s) in core/plugins and
> replace with `export type { X } from '@makinbakin/sdk/types'` (core) or direct SDK import
> (plugins), (3) `bun run typecheck` is the proof — a shape mismatch fails compilation. No new
> tests needed for pure type re-homing; typecheck IS the test. Where a runtime shape changes
> (Task gaining fields is additive/safe), the existing suite is the guard.

### A0 — Delete verified-dead files
`plugins/tasks/components/new-task-dialog.tsx`, `plugins/team/components/curated-browser.tsx`,
`src/components/calendar/calendar-view.tsx`, `src/lib/parsers/calendar.ts`,
`src/components/plugin-slot.tsx`, `src/core/cli/ui/panel.tsx`,
`packages/host/src/components/layout/skeleton-loader.tsx`.
- Re-verify deadness at HEAD before deleting (grep every alias/dynamic-import form; new-task-dialog
  only referenced by a docs screenshot id, which captures by route — safe).
- **Accept:** `bun run test` + `bun run typecheck` + `bun run build:plugins` green; grep finds no
  importers.
- Commit: `chore: delete seven verified-dead files (~620 LOC)`

### A1 — Health check contract family
`HealthCheckResult`, `HealthRepairSafety/Change/PlanItem/ApplyResult/Handler`,
`PluginHealthCheckInput`. Verbatim-identical (SDK adds doc comments only).
- SDK keeps canonical; `packages/core/src/plugin-types.ts` re-exports from `@makinbakin/sdk/types`.
- **Accept:** typecheck green; 17 health-check consumers compile unchanged.
- Commit: `refactor(types): single-home the health-check contract in the SDK`

### A2 — Exec-tool types
`ExecToolDefinition`, `ExecToolResult` (+ context types). SDK canonical, core re-exports.
- Commit: `refactor(types): single-home exec-tool contract types in the SDK`

### A3 — Search API contract
`SearchAPI`, `SearchQueryParams`, `SearchIndexDefinition`, `SearchContentTypeDefinition`,
`SearchSchemaField`, result/aggregation shapes. Reconcile, SDK canonical, core re-exports.
- Commit: `refactor(types): single-home the search API contract in the SDK`

### A4 — Manifest contract
`PluginManifest`, `PluginManifestSignature`, `SecretDeclaration`, `PluginPermission`,
`RuntimeCapability`, `PluginEntry…`. **Core's `PluginManifest` is STALE** (missing
`runtimeCapabilities`/`contributes`/`devWatch`) — the SDK copy is the superset; core's manifest
parser already imports from the SDK. Delete core's stale declaration, re-export from SDK.
- **Accept:** typecheck green; `manifest.ts`/`signatures.ts` already-SDK imports unaffected.
- Commit: `refactor(types): drop stale core PluginManifest, re-export the SDK manifest contract`

### A5 — REVISED: two-tier types are deliberate, not drift (decision 2026-06-12)
**Finding that overturned the original A5:** the audit called `PluginContext`/`BakinPlugin`
"duplicated verbatim," but core and the SDK are an *intentional two-tier contract*, not a fork:
- core's `PluginContext.runtime` is the **full** `AgentRuntimeAdapter` (`adapters/runtime/concepts.ts`
  — agents×11, tools, sessions, memory, config, images, media, restart). 6 core plugins use 15+
  full-only methods (`memory.statEntry`, `agents.writeWorkspaceFile`, `config.replace`,
  `images.generate`, `cron.getRaw`…). The SDK's adapter is a deliberate narrow published subset.
- core's `ctx.tasks` returns its `PluginTask` projection (`PluginTaskService`); the SDK returns
  `Task` (`TaskService`). core's `BakinPlugin` is a superset (`routes?: DeclarativeAPIRoute[]`).
  `StorageAdapter`/`NavItem`/`APIRoute`/`HookAPI`/`SkillDefinition` are all core-fuller.

A blind re-export would break the 6 plugins (narrowing) or leak `concepts.ts` into the
self-contained SDK (impossible). **Decision (Mark, approved):** accept the split; do NOT force-unify.
Collapsing the boundary (making core plugins use the narrow surface) is WS2 (adapter-boundary) work.

A5 deliverable: (1) a clear header comment in BOTH type files documenting the two-tier design so
nobody "fixes" it later; (2) single-home the genuinely-identical, non-two-tier leaf services that
`PluginContext` composes — `EventBus`, `ActivityAPI`, `PluginLogger` (primitives, verified identical),
and `AssetsAPI` if its dependency types are SDK-resident + identical. The two-tier types
(`PluginContext`, `PluginToolContext`, `ExecToolDefinition`'s ctx, `BakinPlugin`, the full adapter,
`PluginTask*`, `StorageAdapter`, `NavItem`, `APIRoute`, `HookAPI`, `SkillDefinition`,
`UISlotRegistration`) stay core-local by design.
- **Accept:** typecheck green; comment present; no behavior change.
- Commit: `refactor(types): single-home identical leaf services; document the two-tier split`

### A6 — REVISED: TaskLogEntry single-homed; internal Task deduped (two-tier respected)
`TaskLogEntry` is byte-identical in 6 places → single-home in the SDK; core (`task-store`,
`tasks/store`, `plugin-types`'s `PluginTask.log`) and `plugins/tasks/types` re-export it.
For `Task`: respect the two-tier split — the SDK keeps its published `Task` projection; the
**internal storage `Task`** duplicated across `src/core/task-store.ts` and
`packages/core/src/tasks/store.ts` collapses to one internal home (the `src/types` copy is deleted in
A10). Do NOT merge the SDK's published `Task` with the internal storage shape. Reconcile the SDK
`Task`/`PluginTask` only for genuine published-contract bugs (e.g. missing fields a plugin needs).
- **Accept:** typecheck + task-store/tasks-route tests green; TaskLogEntry single-declared.
- Commit: `refactor(types): single-home TaskLogEntry in the SDK; dedupe the internal storage Task`

### A7 — AvailableModel
`plugins/models/types.ts` vs SDK, drifted (required-ness, `source?`). Reconcile to the real route
payload; SDK canonical; `plugins/models/types.ts` re-exports.
- Commit: `refactor(types): single-home AvailableModel in the SDK`

### A8 — WorkflowInstance / WorkflowDefinition
SDK shape uses `id`; the wire shape is `instanceId` (`plugins/workflows/types.ts:240`). Fix the SDK
declaration to the real wire shape; reconcile `plugins/tasks` consumers and the workflows plugin.
- **Accept:** typecheck green; tasks-plugin workflow dialogs compile against the corrected type.
- Commit: `refactor(types): fix WorkflowInstance wire shape and single-home it in the SDK`

### A9 — AgentUsage
`src/core/agent-usage.ts` + verbatim copy in `plugins/health/components/health-page.tsx` + a
plugin-dir-escaping relative import in `plugins/team/components/overview-tab.tsx`. Export
type-only `AgentUsage` from the SDK; import it in health + team; delete the copies and the escaping
import.
- Commit: `refactor(types): single-home AgentUsage in the SDK, drop the plugin-dir-escaping import`

### A10 — src/types residue
Shrink `src/types/index.ts` to the 3 live exports (`Heartbeat`, `ActivityEvent`, `ContentState`);
delete the 12 dead (Calendar*, Memory*, ProjectMeta, OfficeData, TaskBoard, ColumnId, the now-moved
Task/TaskLogEntry/TaskColumns). Verify the 6 importers only use the live 3.
- **Accept:** typecheck + test green; grep confirms no importer references a deleted export.
- Commit: `refactor(types): strip the Next.js-era src/types residue to its 3 live types`

### B1 — Split the SDK types file
`packages/sdk/src/types/index.ts` (1401) → `primitives.ts` / `manifest.ts` / `runtime.ts` /
`services.ts` / `registration.ts` / `context.ts`, per the cohesion plan; `index.ts` becomes a
barrel (`export *`). The barrel path is the vendor-bundle entrypoint
(`scripts/build-sdk-package.ts` `SDK_EXPORTS`) and `@makinbakin/sdk/types` — **must stay**.
- **Accept:** typecheck + `bun run build:vendors` + full `bun run build` green; SDK publish dry-run
  (`assertNoForbiddenImports`) clean — no module references `@bakin/core`/`/src/`.
- Commit: `refactor(sdk): split types/index.ts into focused contract modules`

### B2 — Split the core plugin-types file
`packages/core/src/plugin-types.ts` (1129) → `plugin-contract/{search-api,services,registrations}.ts`
+ slimmed `plugin-types.ts` (PluginContext/BakinPlugin/manifest + the re-exports). Pure types, zero
runtime side effects (cohesion plan: lowest-risk split in the repo).
- **Accept:** typecheck + full build green; all 38 `@bakin/core/plugin-types` importers compile.
- Commit: `refactor(core): split plugin-types.ts into plugin-contract modules`

### PR gate (checkpoint)
- `bun run test` + `bun run typecheck` + `bun run lint` green.
- `bun run build` succeeds (all binaries) — **no `git add -A`** after (build-stamp trap: revert
  `packages/core/src/generated-version.ts` + `packages/host/src/api/_embedded-assets-static.ts`).
- SDK publish guard: run the publish build (or `findForbiddenPackageImports`) to prove the split
  SDK still has no forbidden imports.
- Boot smoke in an isolated `BAKIN_HOME` (BAKIN_SKIP_ONBOARDING_CHECK=1) — server serves 200.
- Doc sweep: `.claude/knowledge/{plugin-system,repo-architecture,adapter-architecture}.md`,
  `docs/plugin-authoring.md`, CLAUDE.md (the plugin-contract/SDK descriptions). Update the
  `repo-architecture.md` type-ownership note + `plugin-system.md` if either names the old layout.
- Open PR `refactor/contract-types` → main; Mark reviews/merges.

## Risks & mitigations

- **A5 PluginContext blast radius** — the broadest type; a wrong reconciliation breaks all 10
  plugins + host at compile. Mitigation: do it as its own commit, typecheck is exhaustive, revert
  is clean. If the SDK runtime surface ≠ core's full adapter, keep the internal split (public
  shape in SDK, internal `PluginContextLite`/adapter local to core).
- **SDK self-containment** — any accidental `@bakin/core`/`/src/` import in an SDK types module
  fails publish. Mitigation: the publish guard runs in the PR gate; B1's acceptance includes it.
- **Hidden runtime coupling on Task fields** — `version`/`updatedAt` feed optimistic concurrency.
  Mitigation: additive only (SDK gains the fields it lacked); existing task tests are the guard.
- **Dead-file staleness** — audit ran a few commits back. Mitigation: A0 re-verifies at HEAD.

## Rollback

Every commit is an independent checkpoint (typecheck + suite green). Phase B reverts cleanly to the
unified-but-unsplit state; Phase A commits revert per type family. A0 and A10 are independent of the
unification chain. If review prefers smaller units, Phase A and Phase B can split into two PRs
(`refactor/contract-types-unify`, `-split`) — B depends on A, not vice-versa.
