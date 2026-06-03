# Implementation Plan: Boot Health, Core Plugin Permissions, and Startup Readiness

## Overview

Implement this in two slices. Slice 1 fixes the confirmed rc.10 regression:
compiled installs statically load core plugin modules but lose core manifest
permissions because `plugins/*/bakin-plugin.json` is read from source paths that
do not exist in the installed binary context. Slice 2 adds startup timing and
readiness improvements after the warning storm is fixed.

This plan covers Slice 1 in detail and defines the Slice 2 discovery checkpoint.

## Architecture Decisions

- Core plugin registrations should carry both the plugin module and the parsed
  manifest.
  Rationale: the registry needs one source of truth for dependency order,
  description, audit, and runtime permission grants.

- JSON `bakin-plugin.json` files remain the source of truth.
  Rationale: duplicating permissions in TypeScript would reintroduce drift.

- User plugin behavior remains unchanged.
  Rationale: user plugins must continue using lockfile-accepted grants for
  runtime enforcement.

- Filesystem manifest loading remains as fallback for dynamic core-plugin tests
  and source-tree development.
  Rationale: existing tests use temp plugin directories and should not need the
  static core table.

- Startup readiness restructuring waits until after Slice 1.
  Rationale: permission warnings are confirmed and low-risk to fix; boot timing
  needs measured phase timings before moving work across readiness boundaries.

## Task List

### Phase 1: Core Manifest Permission Fix

#### Task 1: Add Failing Regression Coverage

**Description:** Add a registry test that simulates a compiled core plugin:
the plugin module is supplied through `registerCorePlugins`, the configured
plugin path has no readable `bakin-plugin.json`, and the static registration
also supplies the manifest permissions.

**Acceptance criteria:**

- The test proves core plugins can activate with manifest permissions even when
  source manifest files are absent.
- The test asserts no `plugin.permission_missing` audit is emitted for a core
  method that is granted by the static manifest.
- The test fails before the implementation change.

**Verification:**

```bash
bun test --isolate tests/core/plugin-registry.test.ts
```

**Dependencies:** None

**Files likely touched:**

- `tests/core/plugin-registry.test.ts`

**Estimated scope:** Small

#### Task 2: Carry Parsed Manifests in Static Core Plugin Registrations

**Description:** Change `registerCorePlugins` and `CORE_PLUGIN_IMPORTS` from
`Record<string, BakinPlugin>` to a typed registration object containing
`plugin` and `manifest`. Import each core `bakin-plugin.json`, parse it through
`readPluginManifestJson`, and pass the parsed manifest into the registry.

**Acceptance criteria:**

- Static core plugin registrations include non-empty manifest permissions.
- Core plugin ids are still seeded synchronously for lockfile guard behavior.
- Dynamic-import fallback for tests/source paths still works.
- No permission list is duplicated outside `bakin-plugin.json`.

**Verification:**

```bash
bun test --isolate tests/core/plugin-registry.test.ts
bun test --isolate tests/lib/plugin-permissions.test.ts
```

**Dependencies:** Task 1

**Files likely touched:**

- `src/lib/plugin-static-imports.ts`
- `src/lib/plugin-registry.ts`

**Estimated scope:** Medium

#### Task 3: Update Permission/Plugin System Docs

**Description:** Update `.claude/knowledge/plugin-system.md` to document that
compiled core plugins receive manifest grants from embedded static
registrations, while user plugins continue to use lockfile grants.

**Acceptance criteria:**

- Docs explain the compiled-install failure mode and the new invariant.
- Docs preserve the existing user-plugin lockfile grant description.

**Verification:**

```bash
rg -n "Built-in/core plugins|static|manifest permissions" .claude/knowledge/plugin-system.md
```

**Dependencies:** Task 2

**Files likely touched:**

- `.claude/knowledge/plugin-system.md`

**Estimated scope:** XS

### Checkpoint: Slice 1 Complete

- `bun test --isolate tests/core/plugin-registry.test.ts`
- `bun test --isolate tests/lib/plugin-permissions.test.ts`
- `bun run typecheck`
- `bun run build`
- Manual log expectation for installed binary: core `plugin.activate` audit
  entries include declared permissions, and granted core calls do not emit
  missing-permission warnings.

### Phase 2: Startup Timing and Readiness Discovery

#### Task 4: Add Boot Phase Timing

**Description:** Add structured timing logs around pre-listen startup stages:
app services, user plugin rebuild, plugin registry initialize, agent package
source load, search migration/bootstrap/reconcile, docs generation,
`mcporter.setup`, watcher start, `pluginRegistry.onAllReady`, and `server.listen`.

**Acceptance criteria:**

- Logs show duration per boot phase.
- Timing instrumentation has minimal logic and no behavior changes.
- The next slow affected-machine boot can identify the exact timeout source.

**Verification:**

```bash
bun run typecheck
bun run build
```

**Dependencies:** Slice 1 complete

**Files likely touched:**

- `server.ts`

**Estimated scope:** Small

#### Task 5: Decide Post-Ready Moves From Timing Data

**Description:** Use measured phase durations to decide which non-critical work
can safely move after `server.listen`.

**Acceptance criteria:**

- Each moved phase has a documented reason and fallback behavior.
- Critical readiness dependencies remain pre-listen.
- Doctor warnings and search reconcile remain visible after readiness.

**Verification:** To be defined after Task 4 data.

**Dependencies:** Task 4 and affected-machine timing logs

**Files likely touched:** TBD

**Estimated scope:** TBD

## Commit Strategy

1. `test(plugin-registry): cover embedded core manifest permissions`
   - Adds the failing regression test only.
   - Rollback checkpoint: removes only test coverage, no runtime behavior.

2. `fix(plugin-registry): embed core plugin manifests for compiled installs`
   - Changes static core registration shape and registry consumption.
   - Rollback checkpoint: reverts runtime behavior to previous manifest path
     lookup if needed.

3. `docs(plugin-system): document core manifest grant source`
   - Updates `.claude/knowledge`.
   - Rollback checkpoint: docs only.

4. `chore(server): log boot phase timings`
   - Slice 2 discovery instrumentation after Slice 1 is healthy.
   - Rollback checkpoint: instrumentation only.

Startup readiness restructuring should be its own commit after phase timing
identifies a specific blocking stage.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| JSON imports behave differently in Bun compile | High | Keep manifests statically imported from `server.ts` graph and validate with `bun run build`. |
| Registry tests depend on old `registerCorePlugins` shape | Medium | Update tests and provide a narrow typed registration helper. |
| Core plugin dependency ordering still uses missing manifest data | High | Ensure `initialize()` consults the static manifest before sorting. |
| Permission warnings are reduced but startup is still slow | Medium | Treat as expected; Slice 2 measures and optimizes boot separately. |
| User plugin lockfile grants regress | High | Keep user plugin path untouched and run permission/registry tests. |

## Open Questions

None for Slice 1.

Slice 2 will need affected-machine phase timing logs before moving startup work.
