# Spec: Boot Health, Core Plugin Permissions, and Startup Readiness

## Objective

Diagnose and fix rc.10 boot slowdown and warning spam observed on an installed
Bakin machine. The affected machine runs:

- `bakin` at `/Users/margo/.local/bin/bakin`
- `bakin version` = `v0.0.1-rc.10`
- user plugins installed under `~/.bakin/plugins`: `messaging`, `projects`

Success means:

- Built-in/core plugins load with their declared manifest permissions in
  compiled installs.
- Startup logs no longer emit `plugin-permissions` warnings for core plugins
  whose manifests already grant the required capability.
- Bakin reaches HTTP readiness promptly and predictably after restart.
- Long-running startup work is either bounded, timed, or moved after readiness
  when it is not required to accept HTTP requests.
- Doctor warnings represent actual health issues, not permission-manifest drift.
- `doctor --full --json` stays clean for this issue; unrelated agent-context
  drift warnings are not treated as permission-gating failures.

## Assumptions

1. Priority is reducing tech debt over preserving old startup behavior.
2. This machine is the only user; no compatibility shim is needed for older
   malformed core plugin packaging.
3. User plugins should continue using lockfile-granted permissions.
4. Core plugins should use embedded/source-controlled manifest permissions,
   not filesystem paths that may not exist in compiled installs.
5. Runtime capability mode should remain `warn` by default, but the warning
   signal must be clean enough to trust.

## Evidence

Affected-machine logs show every core plugin activation recorded with an empty
permission set:

```text
plugin activated ... pluginId="team" permissions=[] source="core"
plugin activated ... pluginId="tasks" permissions=[] source="core"
plugin activated ... pluginId="memory" permissions=[] source="core"
...
```

The same boot then reports permission warnings such as:

```text
Plugin "team" used ctx.search.registerContentType without declaring "search.write"
Plugin "memory" used ctx.runtime.memory.watchPaths without declaring "runtime.read"
Plugin "health" used ctx.runtime.ping without declaring "runtime.read"
Plugin "git" used ctx.storage.read without declaring "storage.read"
```

Current repo source manifests already declare these permissions. Example:

- `plugins/team/bakin-plugin.json` declares `runtime.read`,
  `runtime.agents`, `search.read`, and `search.write`.
- `plugins/memory/bakin-plugin.json` declares `runtime.read`,
  `runtime.agents`, `search.read`, and `search.write`.
- `plugins/images/bakin-plugin.json` declares `runtime.images`.
- `plugins/health/bakin-plugin.json` declares `runtime.read`,
  `runtime.agents`, `runtime.channels`, `runtime.skills`, and `search.read`.
- `plugins/git/bakin-plugin.json` declares `storage.read` and
  `storage.write`.

Repo code currently reads core manifests from `join(entry.path,
'bakin-plugin.json')`. In a compiled install, that relative source path may not
exist, so core `PluginLoadEntry.manifest` becomes `undefined`. The registry then
wraps core plugin contexts with `manifestPermissions:
state.manifest?.permissions ?? []`, producing the exact affected-machine
symptom.

Startup timing from affected logs:

- App services / Antfly initialize before plugin loading.
- User plugins are rebuilt before registry import.
- Core and user plugins activate.
- Search tables and startup reconcile run before readiness.
- `pluginRegistry.onAllReady()` runs before `server.listen`.
- HTTP readiness appears at `2026-06-03T02:46:36.323Z`.
- Doctor and memory TTL prune continue after readiness.

The reported timeout is therefore most likely caused by readiness being gated
on one or more pre-listen boot stages: app service startup, user plugin
rebuild, plugin activation, search bootstrap/reconcile, `mcporter.setup()`, or
`onAllReady()`.

Additional affected-machine triage confirms:

- Updating to `0.0.1-rc.10` and restarting does not resolve the warnings.
- `bakin doctor --full --json` reports 0 errors.
- Doctor's 22 warnings are separate agent-context drift warnings, not
  `plugin.permission_missing` events.
- The installed user plugins (`projects`, `messaging`) declare permissions
  correctly, further isolating the descriptor bug to bundled core plugins.

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Server entry: `server.ts`
- Core plugin registry: `src/lib/plugin-registry.ts`
- Permission taxonomy: `packages/core/src/plugins/permissions.ts`
- Manifest parser: `packages/core/src/plugins/manifest.ts`
- Built-in plugin manifests: `plugins/*/bakin-plugin.json`
- Tests: Bun test

## Commands

Primary verification:

```bash
bun test --isolate tests/lib/plugin-permissions.test.ts
bun test --isolate tests/core/plugin-registry.test.ts
bun test --isolate tests/plugins/lifecycle/permissions-smoke.test.ts
bun run typecheck
bun run build
```

Incident/debug commands for affected machines:

```bash
which bakin
bakin version
ls -la ~/.bakin/plugins
cat ~/.bakin/audit.jsonl | jq 'select(.event == "plugin.activate") | {ts, pluginId: .data.pluginId, source: .data.source, permissions: .data.permissions}'
tail -n 300 ~/.bakin/logs/server.log
```

## Project Structure

- `server.ts` starts services, registers embedded core plugins, loads plugins,
  prepares search, starts watchers, and begins listening.
- `src/lib/plugin-registry.ts` discovers plugin manifests, computes activation
  order, builds plugin contexts, wraps runtime permissions, and loads user
  plugins.
- `src/lib/plugin-static-imports.ts` statically imports built-in plugin modules
  for compiled binaries.
- `packages/core/src/plugins/manifest.ts` parses `bakin-plugin.json`.
- `packages/core/src/plugins/permissions.ts` defines the permission enum and
  validation helpers.
- `.claude/knowledge/plugin-system.md` documents permission grant sources.
- `.claude/knowledge/search-system.md` documents startup reconcile and search
  boot behavior.
- `.claude/knowledge/doctor-and-health-checks.md` documents doctor timing and
  health-check ownership.

## Code Style

Keep the fix explicit and typed. Prefer carrying a parsed manifest alongside
the statically imported plugin over re-reading source paths.

Example shape:

```ts
interface CorePluginRegistration {
  plugin: BakinPlugin
  manifest: PublicPluginManifest
}

export const CORE_PLUGIN_IMPORTS: Readonly<Record<string, CorePluginRegistration>> = {
  'plugins/team': { plugin: teamPlugin, manifest: teamManifest },
}
```

The registry should consume the same manifest object for:

- dependency ordering
- description
- runtime permission grants
- activation audit

Do not duplicate permission lists in TypeScript if JSON manifests can be
imported or embedded directly.

## Testing Strategy

Use the Prove-It pattern:

1. Add a failing registry test that simulates a compiled core plugin where the
   plugin module is statically registered but `plugins/*/bakin-plugin.json`
   is not readable from the filesystem.
2. Assert the plugin activates with its manifest permissions and does not emit
   `plugin.permission_missing` for a granted core capability.
3. Add or update a release/packaging smoke test so at least one built-in plugin
   manifest permission survives the compiled/static registration path.
4. Add startup instrumentation tests only around pure orchestration helpers if
   the implementation extracts them; avoid slow process-level tests unless the
   behavior cannot be covered otherwise.

## Boundaries

- Always: preserve user-plugin lockfile permission checks.
- Always: keep runtime capability mode defaults unchanged.
- Always: keep core manifests as the source of truth.
- Always: update `.claude/knowledge` docs when the manifest-loading contract or
  startup ordering changes.
- Ask first: deleting or resetting `~/.antfly`, `~/.termite`, or `~/.bakin`
  data on the affected machine.
- Ask first: removing startup reconcile, doctor checks, or user plugin rebuilds
  entirely.
- Never: silence permission warnings globally as the primary fix.
- Never: hard-code grants in the permission wrapper.
- Never: require user plugin lockfile migration for a core-plugin packaging
  bug.

## Success Criteria

- Core plugin activation audit entries in compiled installs show non-empty
  manifest permissions.
- Existing core plugin calls that are already covered by manifests do not log
  missing-permission warnings.
- A test fails on the current rc.10-style path and passes after the fix.
- Startup logs include enough phase timing to identify slow boot stages without
  reading raw Antfly internals line-by-line.
- Bakin can begin listening before non-critical post-ready work, or every
  remaining pre-listen stage has a documented reason and bounded behavior.
- `bun run build` completes.
- Relevant docs in `.claude/knowledge` and the spec/plan are updated.

## Open Questions

1. Should the first implementation slice stop at the confirmed core-manifest
   permissions bug, or include startup readiness restructuring in the same
   change set?

Recommended answer: split them. First fix and test core manifest permissions
because the root cause is confirmed and low-risk. Then add startup phase timing
and move only clearly non-critical work after readiness based on measured data.
