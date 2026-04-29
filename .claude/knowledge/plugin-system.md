# Plugin System — Deep Reference

## Overview

Bakin's plugin system is three things working in concert:

1. A **runtime contract** — every plugin exports a `BakinPlugin` with an
   `activate(ctx)` that runs once during server boot, and a client
   module that calls `registerPlugin({ id, navItems, slots })` during
   browser boot.
2. A **build pipeline** — every plugin builds to `dist/{index.js, client.js}`
   via `Bun.build()`. Core plugins build at repo-build time
   (`scripts/build-plugins.ts`); user plugins build in-binary
   (`packages/host/src/plugin-host/user-plugin-builder.ts`) on install.
3. A **shared runtime identity** — plugins mark `react` and
   `@bakin/sdk/*` as externals. The browser import map
   (`packages/host/public/index.html` + `scripts/build-vendors.ts`)
   points those specifiers at singleton vendor bundles, so every
   plugin shares one React and one SDK with the shell.

Cross-plugin communication never goes through direct imports. On the
server it goes through the HookRegistry
(`packages/core/src/hooks/hook-registry.ts`). On the client it goes
through `@bakin/sdk/hooks` (data hooks) and slots.

## Core vs user plugins

Structurally identical, different source locations and install paths:

| | Core plugins | User plugins |
|---|---|---|
| Source | `plugins/<id>/` in repo | `~/.bakin/plugins/<id>/` |
| Build timing | Build-time (`scripts/build-plugins.ts`) | Install-time (`buildUserPlugin()`) |
| Registration | `bakin.config.ts` enables them | Scanned from `~/.bakin/plugins/` at boot |
| Override | User plugins override cores of the same id | — |
| Dependencies | Share the repo's `node_modules` | Get their own `bun install` when declared |

The runtime plugin loader doesn't care which bucket a plugin came from.
Same manifest shape, same `dist/` layout, same `activate` contract.

## Plugin Lifecycle

```
Server boot (server.ts)
    ↓
bakin.config.ts → registerCorePlugins(CORE_PLUGIN_IMPORTS)
Scan ~/.bakin/plugins/ → merge user plugins (override cores by id)
    ↓
PluginRegistry.initialize():
  1. Read every bakin-plugin.json (pull dependencies list)
  2. Topological sort (Kahn's algorithm)
  3. Cycle detection → log error, skip cycle
  4. Missing dependency → log warning, load anyway (soft)
    ↓
For each plugin (in sorted order):
  dynamic import → extract BakinPlugin → run migrations →
    create PluginContext → call activate(ctx)
    ↓
All registrations stored in PluginState per plugin
    ↓
pluginRegistry.onAllReady() → calls plugin.onReady() on each plugin
    ↓
HTTP server begins accepting traffic
    ↓
On shutdown (SIGTERM): pluginRegistry.shutdownAll() →
  calls plugin.onShutdown() in reverse order

Browser boot (packages/host/src/main.tsx)
    ↓
ReactDOM renders <PluginHost><Shell/></PluginHost>
    ↓
PluginHost.useEffect:
  1. fetch('/api/plugins/manifest')
  2. Promise.all(manifest.plugins.map(loadPluginClient))
  3. loadPluginClient = dynamic import of /api/plugins/<id>/assets/client.js
  4. Each plugin's client.js runs registerPlugin({...}) as a side effect
  5. setReady(true) → shell re-renders, pulls nav items + slots from registry
```

## User Plugin Lifecycle (install / upgrade / remove)

User plugins (under `~/.bakin/plugins/<id>/`) have a full install ledger
+ teardown story. Core plugins do not — they ship with the binary and
refuse all lifecycle mutations via `isCorePlugin()`.

### Install ledger — `~/.bakin/plugins/lock.json`

Canonical install state for every user plugin. Atomic IO via tmp+rename
through `packages/core/src/plugins/lockfile.ts` (mirrors the agent-
packages lockfile pattern). Schema:

```ts
{ version: 1, plugins: Record<id, PluginLockEntry> }

PluginLockEntry {
  source         // git URL or absolute local path
  type           // 'github' | 'local'
  ref            // default branch name; '' for local
  commitSha      // resolved sha at install/upgrade; '' for local
  installedAt    // ISO 8601
  upgradedAt?    // ISO 8601, set on first upgrade
  version        // from bakin-plugin.json
  permissions    // string[], strict against PermissionSchema enum
  manifestSha    // sha256 of bakin-plugin.json
  lastChecked?   // ISO 8601, set by `plugins list --check`
  remoteHeadSha? // last seen remote sha (github only)
  sourceTreeSha? // install/upgrade time tree sha (local only)
  lastSourceTreeSha? // --check time tree sha (local only)
  installedSkills? // runtime skill names this plugin shipped — the
                  // authoritative allowlist for uninstall (defeats fake
                  // .installedBy markers per #119 hardening)
}
```

Pure mutators (`addPlugin`, `removePlugin`, `updatePlugin`) never touch
fs. `setCorePluginCheck(predicate)` wires defense-in-depth so mutators
throw for core ids. Set during `pluginRegistry.initialize()`.

### Install flow — `bakin plugins install <src> [--ref <ref>] [--yes]`

Two-phase with a HMAC-signed consent token binding to defend against a
source-swap-after-prompt attack (the prompt approves source A but the
commit submits source B):

1. CLI POSTs `/api/plugins/install` with `{ source, type, ref? }` (no
   `accepted`).
2. Server parses `@ref` for shorthand sources or accepts `--ref` as the
   request-body `ref`, rejects conflicts, clones to staging at that ref,
   validates manifest + permissions, parses the manifest version, and
   computes `manifestSha`.
   Before any target-dir copy/build, it also validates `dependencies`:
   each dependency must be a core plugin, an installed user plugin, or
   in the selected recommended-plugin install plan. Missing deps return
   HTTP 400 and the staging dir is removed.
3. If permissions are non-empty AND `accepted !== true`, server returns
   `{ awaitingConsent: true, id, version, permissions, consentToken }`
   and tears down staging. The token is HMAC-SHA256 over
   `{source identity, manifestSha, permissions, expiresAt}` with a
   process-lifetime key (5-minute TTL). The source identity includes
   the requested ref when one was supplied, so preflight and commit
   cannot silently swap refs.
4. CLI surfaces the consent prompt.
5. On accept, CLI re-POSTs with `{ source, type, ref?, accepted: true,
   consentToken }`. Server re-clones, recomputes `manifestSha`, then:
   - Verifies the token signature + expiry.
   - Asserts `token.source === source identity` (refuses on mismatch).
   - Asserts `token.manifestSha === fresh manifestSha` (if the manifest
     changed between preflight and commit, returns awaitingConsent
     again with `manifestChanged: true` + a fresh token + the new diff).
   - On full match, runs `buildUserPlugin()` and writes the lockfile
     entry.

Zero-permission plugins skip the consent gate (no token needed).
`--yes` short-circuits the prompt for scripted/CI installs but the
token round-trip still runs for the binding check.

### Dependency Validation

`dependencies` in `bakin-plugin.json` are Bakin plugin IDs, not npm
packages. npm packages are handled by `buildUserPlugin()` from the
plugin's `package.json`; plugin dependencies are runtime/load-order
contracts.

Validation surfaces:

- Generic copied installs (`bakin plugins install <source>`) refuse a
  plugin before copy/build if any declared dependency is missing.
- Dev installs (`bakin plugins install --dev <path>`) apply the same
  dependency check before linking.
- Recommended onboarding installs use the curated
  `RECOMMENDED_PLUGINS` list as the official dependency index, validate
  all selected plugins before installing, and topologically order selected
  plugins while preserving curated order for independent entries.

There is intentionally no implicit third-party network install from an
arbitrary manifest dependency. If a dependency is not core, installed, or
part of the selected official onboarding set, the user gets a clear error
and can choose what to install.

#### Monorepo `#subpath` syntax (Phase 1)

`bakin plugins install github:user/repo#plugins/foo` installs one
plugin from a multi-plugin repository. The shared parser at
`packages/core/src/plugins/source.ts` is the single source of truth for
both the install endpoint and the upgrade flow — they used to carry
their own copies of the same logic with a comment promising lockstep.

Behavior:

- Subpath is optional; without `#` the install/upgrade flows behave
  exactly as before.
- The install flow clones the parent repo to staging and copies only
  `<staging>/<subpath>/` to `~/.bakin/plugins/<id>/`. The cloned repo's
  `.git/` is dropped along with the rest.
- The lockfile records the full source string with `#subpath` so the
  upgrade flow can re-resolve it. Subpath upgrades take a different
  path (`upgradeGithubSubpath`): re-clone to staging, run the same
  consent gate against the subpath manifest, then replace the plugin
  dir with the subpath contents. The in-place `git fetch`+`git merge`
  flow used by non-subpath upgrades cannot apply here since there's no
  local `.git/` to fetch into.

#### Git ref pinning

Install supports both `bakin plugins install github:user/repo@v1.2.3`
and `bakin plugins install github:user/repo#plugins/foo --ref v1.2.3`.
Inline `@ref` parsing is intentionally limited to shorthand sources so
`git@github.com:owner/repo.git` remains unambiguous; full URL and
`file://` installs use `--ref`.

The lockfile records:

- `source`: the original install source string.
- `ref`: the requested ref when supplied, otherwise the cloned symbolic
  branch when available.
- `commitSha`: `git rev-parse HEAD` captured from the staging clone
  before subpath installs drop `.git/`.

Exact commit refs are supported. The installer first tries a shallow
`git clone --branch <ref>` for branch/tag refs, then falls back to a
full no-checkout clone plus detached checkout so raw commit shas work.
- Subpath validation is enforced at three layers: the lockfile schema
  (`SourceStringSchema` in `lockfile.ts`), the shared `parseGithubSource`
  parser, and a defensive `realpathSync` containment check after the
  clone. Each rejects empty subpaths, leading/trailing slashes, `..`/`.`
  segments, and multiple `#` delimiters.
- `#subpath` is **not** supported for `type: 'local'` installs — point
  the local path directly at the plugin dir instead.

### Upgrade flow — `bakin plugins upgrade <id> [--yes]`

`src/core/plugins/upgrade.ts`. Refuses core plugins. Reads the
lockfile entry to determine source type:

- **github**:
  1. `git remote set-url origin -- <lockfile.source>` — pins origin so
     a malicious in-place tampering of `.git/config` can't redirect the
     upgrade to attacker.com.
  2. `git fetch origin -- <ref>` (read-only on working tree).
  3. Compare local HEAD sha to remote — true noop if they match AND
     `lockfile.commitSha === remoteSha`.
  4. Read remote manifest via `git show origin/<ref>:bakin-plugin.json`
     (still read-only on working tree).
  5. **Asserts `manifest.id === id`** — refuses if the upgraded manifest
     declares a different id (anti-impersonation; otherwise a user
     plugin could rename to `tasks` and clobber a core plugin after
     restart).
  6. Compute permission diff. If widened AND `!opts.yes` → return
     `{ awaitingConsent: true, newPermissions }` WITHOUT mutating disk
     or lockfile.
  7. Force-push detection via `git merge-base --is-ancestor` then
     `git merge --ff-only`. Build. Write lockfile.

- **local**: re-resolve recorded source path; error if missing.
  Compute deterministic source-tree sha (skip `node_modules`/`dist`/
  `.git`, content + path only — no mtimes). No-op if unchanged.
  Read source manifest directly (no copy yet), assert manifest.id
  stable, compute permission diff, run consent gate. Only then wipe +
  cpSync + rebuild + write lockfile.

Permission widening: if the new manifest declares permissions not in
the lockfile entry AND `--yes` is unset, return
`{ awaitingConsent: true, newPermissions: [...] }` without updating
the lockfile. CLI runs the upgrade prompt; on accept, recursively
re-invokes with `yes: true` to commit.

Both branches read the manifest BEFORE any disk mutation so a
declined upgrade leaves the plugin dir + lockfile exactly as they
were.

### Upgrade-available detection — `bakin plugins list --check`

Plain `list` reads markers from the lockfile only — no network, no
fs walk. `--check` runs per-plugin probes in parallel:

- **github**: `git ls-remote <source> <ref>` → record `remoteHeadSha`
  + `lastChecked`. `upgradeAvailable = remoteHeadSha !== commitSha`.
- **local**: walk source dir, compute tree sha → record
  `lastSourceTreeSha` + `lastChecked`.
  `upgradeAvailable = lastSourceTreeSha !== sourceTreeSha` (split
  fields so `--check` doesn't clobber the install/upgrade-time value).

Plain `list` shows a 7-day staleness hint when `lastChecked` is older
than the threshold.

### Remove flow — `bakin plugins remove <id>` (#119)

Full teardown sweep through `packages/host/src/api/plugins/remove.ts`:

1. Refuse if `isCorePlugin(id)` (returns `{ core: true }` per CLI
   contract)
2. Call `plugin.onUninstall(ctx)` if defined — log + audit + continue
   on error (a buggy hook must not trap the user)
3. Plan runtime skill cleanup — partition by the lockfile entry's
   `installedSkills` allowlist (the authoritative record of what this
   plugin actually installed) intersected with on-disk
   `.installedBy.pluginId` markers,
   honor `.userEdited` sentinels
4. Snapshot Bakin-owned data via `snapshotUninstall` →
   `~/.bakin/.uninstalled/<id>-<ISO>.tar.gz` (atomic tmp+rename via
   `Bun.spawn(['tar', ...])` against a staging dir for clean tarball
   structure: `plugins/`, `plugin-settings/`, `runtime-skills/`)
5. Sweep registries:
   - `hookRegistry.unregisterByPlugin(id)` — sweeps every handler
     tagged with the plugin id during `ctx.hooks.register`
   - `removeExecToolsByPlugin(id)` — filters by `bakin_exec_<id>_*`
     name prefix
   - `unregisterPluginNodeTypes`, `unregisterPluginNotificationChannels`,
     `unregisterPluginHealthChecks` — existing per-plugin APIs, now
     called on remove
   - `purgeContentType(table)` for every content type the plugin
     registered — atomic Antfly `dropTable`
6. Filesystem deletes: skill dirs (per plan), `~/.bakin/plugin-
   settings/<id>.json`, plugin dir
7. Remove lockfile entry, drop in-memory plugin state
8. Audit log entry with sweep counts + snapshot path

Restart still required for the plugin's modules to be released from
the JS module cache; the registry sweep ensures no new invocations
land while in-memory state is being torn down.

**CLI surface details:**
- The response includes `skillsMissing: string[]` listing skill names
  the lockfile claimed but which weren't on disk (or whose marker
  disagreed). The CLI surfaces this as a `WARNING: lockfile claimed N
  skill(s) not present on disk: <list>` line. Silent drift becomes
  visible.
- Snapshot failures don't block the rest of the cleanup, but the CLI
  exits non-zero (status 1) when `snapshot === null` so scripted
  callers can react. The user sees a `WARNING: pre-removal snapshot
  failed` line.

### Audit log surface

Lifecycle events are append-only to `~/.bakin/audit.jsonl`. Events
worth grepping:

```bash
# Activations — what permissions did each plugin request?
jq 'select(.event == "plugin.activate")' ~/.bakin/audit.jsonl

# Security-relevant events from install/upgrade/remove —
# rejections, snapshot failures, onUninstall errors. All carry
# `data.kind === 'security'`.
jq 'select(.data.kind == "security")' ~/.bakin/audit.jsonl
```

Specific `plugin.install.rejected` reasons (`data.reason` field):
- `path_traversal` — local source outside trusted roots
- `invalid_github_url` — URL parser refused the source string
- `invalid_plugin_id` — manifest.id (or basename fallback) failed the
  regex `/^[a-z][a-z0-9-]{0,39}$/`
- `invalid_permissions` — Zod enum rejected one or more entries
- `manifest_too_large` — bakin-plugin.json exceeds 1 MB
- `core_id_collision` — install requested an id already used by a
  core plugin (without `overrideCore: true`)
- `consent_token_missing` — accepted=true commit had no token
- `consent_token_invalid` — token failed signature/expiry verification
- `consent_source_mismatch` — token bound to a different source than
  the commit body's source

Specific `plugin.upgrade.rejected` reasons (`data.reason` field):
- `core_plugin` — caller asked to upgrade a built-in
- `manifest_id_rename` — the upgraded manifest declared a different
  `id` than the lockfile entry (anti-impersonation)
- `force_push_detected` — local HEAD is not an ancestor of the remote
  ref's new HEAD (history was rewritten)

### Permissions (#142 layers 1+2)

`packages/core/src/plugins/permissions.ts` — Zod enum locked to the
4 currently-used strings:

```ts
PermissionSchema = z.enum([
  'events.emit',
  'runtime.read',
  'storage.read',
  'storage.write',
])
```

`PERMISSION_DESCRIPTIONS` provides human-readable strings for the
consent prompt UX. Adding a new permission = one enum entry + one
description entry, shipped alongside the capability that needs it.

**Layer 1 — audit on activate**: every plugin activation appends to
`audit.jsonl` and `server.log`:

```
{ event: 'plugin.activate', pluginId, version, permissions, source }
```

Source resolves to `'core' | 'github' | 'local'` (latter two via the
lockfile entry). User-grep target:

```bash
cat ~/.bakin/audit.jsonl | jq 'select(.event == "plugin.activate")'
```

**Layer 2 — install/upgrade consent prompt**: see install + upgrade
flows above. Prompt module: `src/core/cli/consent-prompt.ts` with
injected stdio for testability. Permissions removed at upgrade time
do NOT trigger a prompt (no security concern); permissions added
trigger the diff prompt.

**Layer 3** (runtime capability gating) is deferred — see follow-up
issue.

## Core Interfaces

### BakinPlugin (`packages/core/src/plugin-types.ts`)
```typescript
interface BakinPlugin {
  id: string
  name: string
  version: string
  activate(ctx: PluginContext): void | Promise<void>
  onReady?(): void | Promise<void>                      // after ALL plugins activated
  onShutdown?(): void | Promise<void>                   // graceful shutdown (reverse order)
  onUninstall?(ctx: PluginContext): void | Promise<void> // BEFORE Bakin's teardown sweep on `plugins remove`
  onSettingsChange?(settings: Record<string, unknown>): void | Promise<void>
  settingsSchema?: PluginSettingsSchema                  // auto-rendered settings UI
  navItems?: NavItem[]                                   // optional; typically set from client via registerPlugin
  contentFiles?: ContentFile[]
}
```

### PluginContext (`packages/core/src/plugin-types.ts`)
Provided to `activate()`. The plugin's only interface to the system:

| Method | Purpose |
|--------|---------|
| `storage: StorageAdapter` | Read/write markdown files in `~/.bakin/` |
| `events: EventBus` | Pub/sub with pattern matching |
| `pluginId: string` | This plugin's ID |
| `runtime: AgentRuntimeAdapter` | Adapter-backed runtime surface for agents, messaging, channels, cron, workspace files, skills, sessions, memory, models, and execution status. Plugins never import runtime provider packages directly. |
| `tasks: BakinTaskStore` | Bakin-owned task metadata store under `~/.bakin/tasks/`. Runtime execution ids are delivery refs only. |
| `registerNav(items)` | Add sidebar navigation items (server-side) |
| `registerRoute(route)` | Add HTTP API route at `/api/plugins/{id}/{path}` |
| `registerSlot(reg)` | Register React component for a named UI slot (server-side) |
| `registerExecTool(tool)` | Register MCP execution tool (agent-callable) |
| `registerSkill(skill)` | Register AI skill definition (S-A, in-memory) |
| `registerWorkflow(def, opts?)` | Register a plugin-shipped workflow definition. User definitions in `~/.bakin/workflows/definitions/` always win on collision; cross-plugin id collisions are logged but do not throw out of `activate()`. Same-plugin re-registration is idempotent. |
| `registerNodeType(def)` | Register a custom xyflow node kind for the workflow canvas (namespaced to `{pluginId}.{kind}`) |
| `registerNotificationChannel(def)` | Register a notification channel (namespaced to `{pluginId}.{id}`) |
| `registerHealthCheck(def)` | Register a doctor check (namespaced to `{pluginId}.{id}`). Picked up by `runPluginHealthChecks` in `src/core/doctor.ts`. Per-check try/catch lives in the orchestrator. Deep ref: `.claude/knowledge/doctor-and-health-checks.md`. |
| `watchFiles(patterns)` | Request file watcher notifications |
| `getSettings<T>()` | Read this plugin's persisted settings from `plugin-settings/{id}.json` |
| `updateSettings(patch)` | Merge partial update into settings, persist, notify `onSettingsChange` |
| `activity.log(agent, message, opts?)` | SSE activity feed broadcast |
| `activity.audit(event, agent, data?)` | Structured audit trail (`appendAudit` + SSE) |
| `hooks.register(name, handler)` | Register a hook handler (returns unsubscribe fn) |
| `hooks.has(name)` | Check if any handlers registered for a hook |
| `hooks.invoke<R>(name, data)` | Invoke a hook and get its result (RPC-style) |
| `search.registerContentType(def)` | Register a searchable content type. Non-filesystem-backed path — plugin owns its own sync. |
| `search.registerFileBackedContentType(def)` | File-backed variant: auto-wires watcher sync/unlink hooks AND schedules a startup mtime reconcile. |
| `search.index(key, doc)` | Upsert a document through the active search adapter (fire-and-forget safe) |
| `search.remove(key)` | Remove a document from the index |
| `search.transform(key, ops)` | Atomic metadata update without re-embedding |
| `search.query(params)` | Search this plugin's content type |

Both `search.registerContentType` and `search.registerFileBackedContentType`
auto-register a `GET /search` route on the plugin's router so callers can
hit `/api/plugins/{id}/search?q=...` without the plugin writing the
handler by hand.

### Plugins and adapters

Plugins see runtime/search/task services only through `PluginContext` and exec
tool context. They must not import `@bakin/adapter-openclaw`,
`@bakin/adapter-antfly`, OpenClaw home/config/client helpers, provider SQLite
files, or `@antfly/sdk`. If a plugin needs a new runtime/search capability, add
it to the adapter contract first; do not pierce the boundary from plugin code.

### PluginSettingsSchema
```typescript
interface SettingsField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  options?: { value: string; label: string }[]
  default?: unknown
}

interface PluginSettingsSchema {
  fields: SettingsField[]
}
```

All 10 core plugins define `settingsSchema`. The settings page at
`/settings` fetches schemas from `GET /api/plugin-settings/schemas` and
renders them via `PluginSettingsRenderer`. Values persist at
`~/.bakin/plugin-settings/{pluginId}.json` via
`GET/PUT /api/plugin-settings/{pluginId}`.

### PluginManifest (`bakin-plugin.json`)
```typescript
interface PluginManifest {
  id: string
  name: string
  version: string
  bakin: string                // semver range for compatibility
  description: string
  server: string               // path to server bundle (e.g. "dist/index.js")
  client?: string              // path to client bundle (e.g. "dist/client.js")
  contentFiles?: string[]
  secrets?: string[]           // vault keys this plugin needs
  tests?: string
  dependencies?: string[]      // other plugin IDs — drives topological sort
  permissions?: Permission[]   // strict Zod enum — see PermissionSchema. Empty/missing → []
}
```

## Runtime Plugin Loader (browser)

`packages/host/src/plugin-host/PluginHost.tsx` wraps the shell tree.
On mount:

```
1. GET /api/plugins/manifest
   → { plugins: [{ id, name, version, clientEntry }, ...] }
   → clientEntry = "/api/plugins/<id>/assets/client.js"
2. Promise.all(plugins.map(p => import(p.clientEntry)))
3. Each dynamic import evaluates the plugin's client.js, which runs
   `registerPlugin({...})` as a module side-effect.
4. `assertReactInstance(pluginId, module.React)` — optional runtime
   check that catches plugins that accidentally bundled their own
   React (broken hooks). Plugins aren't required to export React;
   the lack of an export is a non-event.
5. setReady(true) → the shell re-renders. AppSidebar reads
   `getAllNavItems()`; slot consumers re-evaluate.
```

Failures in one plugin are logged and skipped — they never block the
others. While plugins are loading, the sidebar is briefly empty and
slots return `null` for uncontributed names. Acceptable for a
single-user LAN app on cold boot.

Binary mode is identical at the loader level: the same
`/api/plugins/<id>/assets/client.js` URL, just served from embedded
bytes instead of disk.

## Build Pipeline

### Core plugins — `scripts/build-plugins.ts`

For each of the 10 core plugins:

```
bun build plugins/<id>/index.ts
  --outdir plugins/<id>/dist
  --target bun --format esm
  --entry-naming index.[ext]
  --packages external                ← keep node_modules out of the bundle
  --external react --external react-dom ...
  --external @bakin/sdk --external @bakin/sdk/ui ...

bun build plugins/<id>/client.tsx    (if it exists)
  --outdir plugins/<id>/dist
  --target browser --format esm
  --entry-naming client.[ext]
  --external react --external react-dom ...
  --external @bakin/sdk --external @bakin/sdk/ui ...
```

Server entries use `--packages=external` because the host has every
node_modules dep already installed — the plugin bundle is a thin
adapter, not a standalone binary. Client entries only externalize
react + sdk; everything else (lucide icons, zustand, shadcn primitives)
bundles in so the plugin is self-contained from the browser's POV.

### User plugins — `buildUserPlugin()`

`packages/host/src/plugin-host/user-plugin-builder.ts` runs the same
shape inside the Bakin binary when the user runs `bakin plugins install`:

1. Compare source mtimes to `dist/` mtimes — skip if up-to-date.
2. If `package.json` declares deps beyond `@bakin/sdk` / `react` peers,
   run `bun install` in the plugin dir.
3. `Bun.build()` server entry with `packages=external` + externals.
4. `Bun.build()` client entry with browser target + externals.

Portable subprocess wrapping uses Node's `child_process.spawn` (which
Bun implements API-compatibly) so the builder's subprocess behavior
is stable across Bun's evolving surface. The output layout is
identical to core plugins — the runtime loader reads from `dist/`
either way.

### Vendor bundles — `scripts/build-vendors.ts`

Produces the bundles that the browser import map points at:

```
packages/host/public/vendor/
  react.js, react-dom.js, react-dom-client.js
  jsx-runtime.js, jsx-dev-runtime.js
  sdk-index.js, sdk-ui.js, sdk-hooks.js, sdk-components.js,
  sdk-slots.js, sdk-types.js, sdk-utils.js
```

The `<script type="importmap">` in `packages/host/public/index.html`
maps `react`, `react-dom`, `@bakin/sdk`, `@bakin/sdk/ui`, etc. to those
files. Changes to either file must happen in lockstep — the
specifier list is duplicated because the map is static HTML and the
build script is the generator.

## @bakin/sdk Surface

Plugin authors import from `@bakin/sdk/*`. Full sub-path map:

| Path | What it exports |
|------|-----------------|
| `@bakin/sdk` | `registerPlugin`, `getAllNavItems`, `NavItem` type |
| `@bakin/sdk/ui` | shadcn primitives (Button, Card, Dialog, Input, Select, Table, Tabs, Tooltip, ...) |
| `@bakin/sdk/hooks` | React hooks (`useAgent`, `useAgentList`, `useSSE`, `useSearch`, `useQueryState`, `useQueryArrayState`, `useDebug`, `useNotificationChannels`, ...) |
| `@bakin/sdk/components` | Shared components (`PluginHeader`, `FacetFilter`, `AgentAvatar`, `AgentSelect`, `ChannelIcon`, `BakinDrawer`, ...) |
| `@bakin/sdk/slots` | `Slot`, `registerSlot`, `__clearSlot` |
| `@bakin/sdk/types` | Full type re-exports (`PluginContext`, `BakinPlugin`, `AssetMeta`, `Task`, `WorkflowDefinition`, ...) |
| `@bakin/sdk/utils` | `cn`, `formatAge`, `formatSize`, `isStale` |

Published to npm as `@bakin/sdk`. `scripts/publish-sdk.ts` pushes on the
release workflow. Lint rules block direct imports from `@/components/*`,
`@/hooks/*`, `@/lib/*`, and other plugins — the SDK is the only
surface plugin authors should see.

## Slot System

Slots are the named extension points plugins render into. The registry
backs them via a globalThis-backed `Map<name, Array<{Component, order}>>`
(survives HMR). Lower `order` wins; default is 100.

```ts
import { registerSlot, Slot } from '@bakin/sdk/slots'

// Contribute
registerSlot('asset-preview', MyRenderer, 50)

// Consume
<Slot name="asset-preview" asset={asset} />
```

Core-registered slots:

| Slot | Props | Registered by |
|------|-------|---------------|
| `asset-preview` | `{ asset: AssetMeta }` | assets plugin |
| `asset-detail-modal` | `{ filename?, assetPath?, onClose }` | assets plugin |
| `task-assets` | `{ taskId, readOnly? }` | assets plugin |
| `page:/<route>` | component-defined | per-plugin — mounted at that URL by TanStack Router |

The `page:/<route>` convention binds a slot to a router path. The host
shell's routes (`packages/host/src/routes/*.tsx`) render
`<Slot name="page:/xyz" />` at `/xyz`, and plugins contribute the
component by registering against that slot name.

## HookRegistry — Cross-Plugin Server Communication

`packages/core/src/hooks/hook-registry.ts` — singleton shared across all
plugins and core modules. Backed by `globalThis.__bakinHookRegistry` so
hot reload + Bun's module re-evaluation don't lose handler references.
Same pattern is used for the plugin registry
(`globalThis.__bakinPluginRegistry`), SSE broadcast
(`globalThis.__bakinBroadcast`), and settings cache
(`globalThis.__bakinSettingsCache`).

### How it works
1. Plugins register hooks in `activate()` via `ctx.hooks.register(name, handler)`.
2. Core modules and other plugins invoke hooks via
   `getHookRegistry().invoke<R>(name, data)`.
3. Hooks are RPC-style: one handler per hook name, returns a result.

### Hook naming convention
`{pluginId}.{operation}` — e.g., `workflows.loadInstance`,
`workflows.getCurrentStep`, `tasks.enrichDetails`.

### Current hook registrations

| Plugin | Hooks | Examples |
|--------|-------|---------|
| tasks | 0 task-metadata hooks | Task metadata is owned by `src/core/task-store.ts` and is not exposed through plugin hooks |
| workflows | 13 | `workflows.loadInstance`, `workflows.createInstance`, `workflows.getCurrentStep`, `workflows.completeStep`, `workflows.matchWorkflow`, `workflows.definitions.list`, `workflows.loadDefinition`, `workflows.getActiveAgents`, `workflows.saveInstance`, etc. |
| assets | 8 | `assets.validateSidecar`, `assets.getSidecarPath`, `assets.createStub`, `assets.detectVariant`, `assets.getAssetTypes`, `assets.trash.list`, `assets.restoreAsset`, `assets.emptyTrash` |
| team | 7 | `team.list`, `team.getAgent`, `team.getAgentIds`, `team.resolveProfile`, `team.getTeamMembers`, `team.getAgentTeam`, `team.getOrgStructure` |
| models | 5 | `models.configChanged`, `models.getEffectiveModel`, `models.getAvailableModels`, `models.markConfigDirty`, `models.markGatewayRestarted` |
| tasks extensions | 2 | `tasks.statusChanged`, `tasks.enrichDetails` |

### Invoking hooks from core
```typescript
import { getHookRegistry } from '@/lib/plugin-registry'
const hooks = getHookRegistry()
const instance = await hooks.invoke<WorkflowInstance>('workflows.loadInstance', { taskId })
```

**Critical:** No direct imports between plugins or from core → plugins.
All cross-boundary calls go through hooks. The sole exception is
`scripts/lib/generate-image.ts` which imports `saveAsset` from
`plugins/assets/lib/save-asset` directly — the asset pipeline is a
shared utility, not a plugin-to-plugin dependency.

## Exec Tool Registry

### How it works
1. `scripts/lib/registry.ts` — global `Map<string, ExecToolDefinition>`.
2. Core scripts self-register at import time (`scripts/lib/*.ts`).
3. Plugin tools register via `ctx.registerExecTool()` →
   `addExecTool()` with `source: 'plugin:{id}'`.
4. `src/core/mcp-server.ts` imports core tool files, then calls
   `getAllExecTools()` to register all tools with the MCP server at
   startup.

### PluginToolContext
When the MCP server executes a tool handler, it builds a
`PluginToolContext` via `getToolContext(toolName)`:

```typescript
interface PluginToolContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  hooks: HookAPI
  activity: ActivityAPI
  getSettings<T = Record<string, unknown>>(): T
}
```

Tool handlers receive it as an optional third argument:
```typescript
handler: (params, agent, ctx?) => Promise<ExecToolResult>
```

### ExecToolDefinition fields

```typescript
interface ExecToolDefinition {
  name: string                    // bakin_exec_{pluginId}_{action}
  description: string             // MCP tool description
  label?: string                  // Human-readable past-tense phrase for activity feed
  activityDuplicate?: boolean     // true = handler already emits a domain audit event
  parameters: ZodRawShape         // strict — every value must be a z.* schema
  handler: (params, agent, ctx?) => Promise<ExecToolResult>
  source?: string                 // 'plugin:{id}' or 'script'
}
```

- `label` — short past-tense phrase displayed as primary text in the
  activity feed. Without it, `humanizeExecName()` derives from the tool
  name. Every exec tool should have an explicit label.
- `activityDuplicate` — set `true` only when the handler (or an effect
  function it calls) already emits a meaningful domain event via
  `ctx.activity.audit()` or `appendAudit()`. The auto-audit event from
  `mcp-server.ts` is tagged `duplicate: true` and hidden by default in
  the activity feed.

### Activity event flow for exec tools

```
Agent calls MCP tool
  → mcp-server.ts runs handler
  → Handler may emit domain audit event (e.g., appendAudit('task.created', ...))
  → mcp-server.ts auto-appends audit: exec.{tool.name}.{ok|fail}
    with { label: tool.label, duplicate: tool.activityDuplicate }
  → SSE broadcasts both events
  → Activity feed shows label as primary text, raw event name as muted mono text
  → Duplicate events hidden by default (Bug icon toggle to show)
```

Handlers should NOT call `ctx.activity.log()` — the auto-audit from
`mcp-server.ts` with the tool's `label` replaces that pattern.

### Naming convention
`bakin_exec_{pluginId}_{action}` — e.g., `bakin_exec_project_list`,
`bakin_exec_schedule_fire`.

### Adding a new core tool
1. Create `scripts/lib/{tool-name}.ts`
2. Call `addExecTool()` at module scope
3. Add import in `src/core/mcp-server.ts`

## Route Handling

### Server-side registration
Plugins register routes in `activate()`. Handlers take a Web `Request`
and return a Web `Response`:

```typescript
ctx.registerRoute({
  path: '/',
  method: 'POST',
  handler: async (req) => {
    const body = await req.json()
    return Response.json({ ok: true })
  },
  description: 'Create a new item',
})

ctx.registerRoute({
  path: '/:taskId',
  method: 'DELETE',
  handler: async (req) => Response.json({ ok: true }),
  description: 'Delete an item by ID',
})
```

### Parameterized routes
Paths can include `:param` segments for RESTful naming. The catch-all
router extracts path params and injects them into the request URL's
`searchParams` so handlers read them the same way as query params.

### Catch-all dispatch
`packages/host/src/api/plugins/[pluginId]/[[...path]].ts` handles every
plugin API request. Server.ts dispatches to it via `dispatchWebHandler`.
The router's `matchRoute()` tries exact match first, then falls back to
segment-by-segment `:param` matching.

Request to `/api/plugins/workflows/definitions/my-workflow` → extracts
`pluginId=workflows`, `path=/definitions/my-workflow` → matches route
`/definitions/:name` → injects `name=my-workflow` into searchParams.

## Plugin `defaults/` Conventions

A plugin may ship three sibling directories under `defaults/`. The
plugin loader handles each one automatically — plugin code only needs
to drop files in place.

| Directory | Loader | Behavior |
|-----------|--------|----------|
| `defaults/workflows/*.yaml` | The owning plugin's `activate()` (workflows plugin uses `lib/load-defaults.ts`) | Each YAML is parsed and registered via `ctx.registerWorkflow(def, { readOnly: true })`. User copies under `~/.bakin/workflows/definitions/` always shadow these. |
| `defaults/workflow-skills/*.md` | `src/lib/plugin-skill-loader.ts`, invoked by the plugin loader after every `activate()` | Each `.md` is parsed (YAML frontmatter for `name` + `output_schema`; body is the instruction) and registered via `ctx.registerSkill()`. In-memory only — no filesystem install. |
| `defaults/runtime-skills/{name}/SKILL.md` (+ `scripts/`) | `src/core/onboarding/plugin-assets.ts` (`bakin install plugin-assets`) | Each skill dir is copied to `runtime skill store/` with a `.installedBy` marker (sha256). `.userEdited` sentinel locks a dir from overwrite. `bakin doctor` surfaces drift. |

The first two are S-A (workflow-step skills, in-memory). The third is
S-B (runtime skills, on disk). See
`.claude/knowledge/workflows-plugin.md` for the full breakdown.

## Storage Adapter

`packages/core/src/storage/markdown-adapter.ts` — `MarkdownStorageAdapter`:

| Method | Behavior |
|--------|----------|
| `read(path)` | Read file relative to content dir, returns null if missing |
| `write(path, content)` | Write file, creates directories as needed |
| `append(path, content)` | Append to file |
| `exists(path)` | Check file existence |
| `readAll()` | Read all files in content dir (flat) |

All paths relative to `~/.bakin/` (resolved via `getContentDir()`).

## Event Bus

`packages/core/src/events/event-bus.ts` — `BakinEventBus`:

- `emit(event, data)` — broadcast to all matching subscribers
- `on(pattern, handler)` — subscribe with exact match or prefix glob
  (`task.*` matches `task.created`)
- `once(pattern, handler)` — one-time subscription

Used by the workflows plugin for notifications. Most cross-plugin
communication goes through the HookRegistry instead.

## User Plugin Override

`~/.bakin/plugins/` is scanned after built-in plugins. If a user plugin
has the same id as a built-in, it replaces it. This lets users fork
and customize any core plugin without modifying the repo.

## Hot Reload (Phase 2)

`bakin plugins install --dev <localPath>` registers a developer-owned
source tree as a symlinked plugin. `bakin plugins link <localPath>`
still exists as the lower-level command, but `install --dev` is the
preferred authoring path. With `bakin dev` running (`BAKIN_DEV=1` and
`BAKIN_DEV_HOTRELOAD=1`), saves in the linked source tree trigger an
in-process build + module swap — no manual reinstall and no restart for
ordinary server/client edits.

Linked plugins are loaded from `~/.bakin/plugins/<id>`, which is a symlink
to the source checkout. Startup discovery follows symlinked directories, so
`bakin stop && bakin start` still loads a dev-installed plugin. Normal
`bakin start` activates it but does not watch source edits; run
`bakin dev` for rebuild/hot-swap behavior.

Collision rules:

- `install --dev` only accepts local paths.
- If the plugin id is already installed as a copied plugin, fail unless
  `--force` is passed.
- If the plugin id is already linked/dev-installed, fail even with
  `--force`; unlink it first.

### Architecture

```
File save in linked plugin
    ↓
chokidar watcher (per-plugin)
    ↓ debounce 80ms
Hot-reload coordinator
  - Per-plugin pipeline mutex
  - Inflight + pending: 3 saves while in-flight = 1 follow-up cycle
    ↓
buildUserPlugin(pluginDir) → dist/index.js + dist/client.js
    ↓ (success)             ↓ (fail)
                              broadcastPluginError → SSE → dev overlay
runReloadPipeline:
  1. import(`${dir}/dist/index.js?v=${attempt}`)  (cache-bust; old plugin stays active on import failure)
  2. plugin.onShutdown?.()                       (errors logged, never rethrow)
  3. Sweep: removeExecToolsByPlugin,
            HookRegistry.unregisterByPlugin,
            unregisterPluginNodeTypes,
            unregisterPluginNotificationChannels,
            unregisterPluginHealthChecks,
            unregisterContentTypesByPlugin (preserve search tables),
            removePluginSkillsByPlugin
  4. Clear state arrays (routes/slots/navItems/etc.)
  5. await newPlugin.activate(ctx)               (same ctx as before;
                                                  closures repopulate state)
  6. state.plugin = newPlugin
  7. bumpVersion(pluginId)
  8. broadcastPluginReload (+ broadcastPluginRecover if recovering
     from a prior error)
    ↓
SSE event: { type: 'dev:plugin:reload', pluginId, version }
    ↓
Browser dev client (packages/host/src/dev-client/client.ts)
    ↓
PluginHost.hotSwapPlugin:
  - unregisterPlugin(id)        (drops nav/slot contributions)
  - swapPluginCss               (cache-busted href)
  - import(`${clientEntry}?v=${version}`)  (re-runs registerPlugin
                                            as a side effect)
    ↓
React tree re-renders with the new contributions.
```

### Version stamping (the safety net)

Every response from `/api/plugins/<id>/*` carries an
`X-Bakin-Plugin-Version: <id>:<n>` header (set by
`stampPluginResponse` in `src/core/plugin-host/version-stamp.ts`).
The client wraps `fetch` (`packages/host/src/plugin-host/
version-mismatch-detector.ts`); on every plugin response it compares
the header to the last known version. Drift dispatches the same
hot-swap path as an SSE event would have.

This belt + suspenders coverage protects against missed SSE events
(browser tab in background, network blip): the next plugin-bound
fetch surfaces the drift and triggers reload.

The version is monotonic per plugin within a single server process.
A server restart resets to 0 — that's intentional. The first response
after restart either matches (0 = client default) or detects a
"version went down" regression, both of which trigger the same reload.

### Critical invariants

- **Cache-bust uses an always-incrementing `importAttemptCounter`**,
  separate from the success-only version registry. Without that, a
  failed reload would leave the version unchanged and the next retry
  would import the same `?v=N` URL Bun already cached as failing —
  the user couldn't recover even after fixing the code.
- **The same `ctx` is reused** across reloads. State arrays are
  cleared before re-activate so the new plugin's registrations land
  cleanly without piling on top of the swept ones.
- **`onShutdown` errors NEVER propagate.** A buggy onShutdown can't
  be allowed to brick the dev loop. Logged + ignored.
- **Build failures keep the watcher live.** No manual recovery —
  next save kicks off a fresh attempt.
- **Import failures keep the old plugin active.** The pipeline imports
  the new server module before calling `onShutdown` or sweeping old
  registrations. Syntax/top-level import mistakes therefore show a dev
  overlay without disabling the previous working plugin.
- **Plugin module import must stay free of lifetime side effects.**
  Timers, process listeners, file watchers, sockets, and event listeners
  must be created inside `activate(ctx)` or narrower handlers and cleaned
  in `onShutdown()`. `bakin/no-plugin-top-level-side-effects` enforces the
  direct import-time cases because old module instances stay alive after a
  cache-busted hot reload.
- **Search tables survive hot reload.** The reload path unregisters
  plugin-owned search wiring and pending reconciles, then recreates them
  on activate. Only remove/uninstall purges backing tables.
- **Chokidar v5 watches roots, not globs.** Linked plugins are watched at
  the source root and filtered against `devWatch` patterns in Bakin.
  Passing `components/**/*.tsx` directly to `chokidar.watch()` silently
  misses files.
- **Same-version client swaps are deduped.** Exact duplicate
  `clientEntry?v=version` swaps must no-op after the first success;
  otherwise a cached dynamic import can fail to re-run `registerPlugin()`
  after the old nav/slots were unregistered.

### Failure-recovery symmetry

Two distinct error sources, each with its own tracker:

- **Build errors** → coordinator broadcasts `dev:plugin:error`,
  records in `state.buildErrored`. Next successful build emits
  `dev:plugin:recover` BEFORE running the pipeline (so the client
  clears its overlay before the bundle swap lands).
- **Import / activate errors** → pipeline broadcasts
  `dev:plugin:error`, records in its own `erroredPlugins`. Next
  successful pipeline run emits `dev:plugin:recover` before
  `dev:plugin:reload`.

### Key files

| File | Purpose |
|---|---|
| `src/core/plugin-host/version-stamp.ts` | Per-plugin version registry + response stamping |
| `src/core/plugin-host/reload-pipeline.ts` | Server-side teardown + cache-bust import + activate |
| `src/core/plugin-host/hot-reload-coordinator.ts` | Watcher + per-plugin pipeline mutex |
| `packages/host/src/plugin-host/version-mismatch-detector.ts` | Client-side fetch wrapping + drift detection |
| `packages/host/src/dev-client/client.ts` | SSE event handlers (`dev:plugin:reload` etc.) |
| `packages/host/src/plugin-host/PluginHost.tsx` | `hotSwapPlugin` — re-fetch + re-mount mechanics |

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/plugin-types.ts` | All interfaces (BakinPlugin, PluginContext, HookAPI, SettingsSchema, ...) |
| `packages/core/src/hooks/hook-registry.ts` | HookRegistry class (register, invoke, has) |
| `packages/sdk/src/register.ts` | `registerPlugin`, `getAllNavItems` (browser-global registry) |
| `packages/sdk/src/slots/index.tsx` | Slot + registerSlot primitive |
| `packages/host/src/plugin-host/PluginHost.tsx` | Runtime plugin loader |
| `packages/host/src/plugin-host/user-plugin-builder.ts` | In-binary `bun install` + `Bun.build()` for user plugins |
| `packages/host/src/api/plugins/manifest.ts` | `GET /api/plugins/manifest` for the loader |
| `packages/host/src/api/plugins/assets.ts` | Serves the plugin `client.js` bundle |
| `packages/host/src/api/plugins/[pluginId]/[[...path]].ts` | Catch-all plugin API router |
| `src/lib/plugin-registry.ts` | Plugin loading singleton, topo sort, route/nav/slot lookups |
| `src/lib/plugin-static-imports.ts` | Core plugin import table consumed by server.ts |
| `bakin.config.ts` | Core plugin enable list |
| `scripts/build-plugins.ts` | Core plugin build pipeline |
| `scripts/build-vendors.ts` | Import-map vendor bundles |
| `scripts/lib/registry.ts` | Exec tool registry |
| `src/core/mcp-server.ts` | MCP server, tool registration |
