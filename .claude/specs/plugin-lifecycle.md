# SPEC — Plugin Lifecycle Hardening

**Status:** Draft for review (kickoff phase, pre-plan)
**Owner:** @markhayden
**Bundles:** [#151](https://github.com/madeinwyo/bakin/issues/151) (`bakin plugins upgrade`), [#119](https://github.com/madeinwyo/bakin/issues/119) (per-plugin uninstall teardown), [#142](https://github.com/madeinwyo/bakin/issues/142) (permissions enforcement layers 1+2)
**Companion plan:** `.claude/specs/plugin-lifecycle-plan.md` (next phase)

---

## 1. Objective

Complete the user-plugin lifecycle. Today, `bakin plugins install` ships end-to-end but:

- **No upgrade path** exists — users must `remove` then `install` to update
- **Remove orphans state** — plugin-settings JSON, search-index rows, hook handlers, exec tools, runtime skills, and registry entries all survive uninstall
- **Manifest permissions are aspirational** — declared but never read, surfaced, or enforced
- **No install-state ledger** — Bakin doesn't track *what* it installed, *from where*, *when*, or *with what permissions*; install/upgrade/list/remove all need this and there's no shared primitive

This work introduces the missing primitive (`~/.bakin/plugins/lock.json`, modeled on agent-packages' lockfile) and threads it through install/upgrade/list/remove. It also adds the `BakinPlugin.onUninstall` hook, runtime registry teardown APIs, and permissions enforcement layers 1 and 2.

**Single user, this machine.** No backwards-compatibility shims. Reduce tech debt is the priority.

---

## 2. Out of Scope (Cut from this PR — follow-up issues filed)

| Cut | Reason | Follow-up |
|-----|--------|-----------|
| Signature verification (`bakin-plugin.json.signature`, `settings.plugins.trustedSigners`, `settings.plugins.requireSignatures`) | No current need; trust-on-first-use stays the default. Schema is additive — no migration cost when added later. | New issue: "feat(plugins): signature verification + trusted signers" |
| Hot reload of user plugins after install/upgrade/remove | Touches plugin registry, route dispatcher, MCP tool registry, Bun module cache. Own design tree. Restart cost is ~2s. | New issue: "feat(plugins): hot reload for install/upgrade/remove" |
| Tarball retention / cleanup / `bakin plugins restore` | `.uninstalled/` tarballs accumulate without expiry in this PR. Punt to its own UX conversation. | New issue: "feat(plugins): .uninstalled tarball retention + restore command" |
| Permissions layer 3 (runtime capability gating) | Pervasive SDK surface change. Locks plugins out on enforcement bugs. Needs disable-toggle for rollout. | New sub-issue under #142: "feat(plugins): permissions layer 3 — runtime capability gating" |
| `@ref` syntax in install URL (`github:user/repo@v1.2.0`) | Different feature with its own UX surface. Lockfile field is already a string — additive when added. | New issue: "feat(plugins): pin install ref (tag/branch/commit)" |
| Reproducible install manifest (export/import all installed plugins at exact refs) | Depends on @ref pinning. | New issue: "feat(plugins): bakin plugins import/export" |

---

## 3. Contracts

### 3.1 Lockfile — `~/.bakin/plugins/lock.json`

Modeled exactly after `packages/core/src/agent-packages/lockfile.ts`. Atomic IO via tmp+rename. Pure mutators that never touch fs.

**Module:** `packages/core/src/plugins/lockfile.ts`

```ts
const PluginTypeSchema = z.enum(['github', 'local'])

const PluginLockEntrySchema = z.object({
  source: z.string().min(1),         // git URL or absolute local path
  type: PluginTypeSchema,
  ref: z.string(),                   // default branch name; '' for local (honest emptiness)
  commitSha: z.string(),             // resolved sha at install/upgrade; '' for local
  installedAt: z.string().min(1),    // ISO 8601
  upgradedAt: z.string().optional(), // ISO 8601, set on first upgrade
  version: z.string().min(1),        // from bakin-plugin.json
  permissions: z.array(PermissionSchema), // see §3.3
  manifestSha: z.string().min(1),    // sha256 of bakin-plugin.json — drives "permissions changed?"
  lastChecked: z.string().optional(),// ISO 8601, set by `list --check`
  remoteHeadSha: z.string().optional(),  // last seen remote HEAD sha (github only)
  sourceTreeSha: z.string().optional(),  // last seen local source tree sha (local only)
})

export const PluginLockfileSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), PluginLockEntrySchema),
})

// IO
export function getPluginLockfilePath(): string  // ~/.bakin/plugins/lock.json
export function readPluginLockfile(path?: string): PluginLockfile
export function writePluginLockfile(lock: PluginLockfile, path?: string): void

// Pure mutators (no fs)
export function addPlugin(lock: PluginLockfile, id: string, entry: PluginLockEntry): PluginLockfile
export function removePlugin(lock: PluginLockfile, id: string): PluginLockfile
export function updatePlugin(lock: PluginLockfile, id: string, patch: Partial<PluginLockEntry>): PluginLockfile
```

**Defense in depth:** mutators reject any id where `isCorePlugin(id) === true` (throw `Error("refusing to mutate lockfile entry for core plugin: <id>")`). API guards exist; this is a backstop.

**No `dependencies`/`refCount`.** Plugins don't compose like agent packs do.

### 3.2 `BakinPlugin.onUninstall`

**Module:** `packages/core/src/plugin-types.ts`

```ts
export interface BakinPlugin {
  activate(ctx: PluginContext): void | Promise<void>
  onUninstall?(ctx: PluginContext): void | Promise<void>  // NEW
}
```

**Contract:**
- Optional. If absent, Bakin proceeds directly to its own teardown sweep.
- Fires **before** any Bakin-side cleanup, with the same full `PluginContext` the plugin received at activation. No reduced surface.
- `void | Promise<void>` — sync OR async. Bakin awaits.
- Errors thrown are logged via `log.error('plugin onUninstall failed', err, { pluginId })` and appended to audit, but **cleanup continues**. A buggy `onUninstall` must not trap the user in a half-removed state.
- Plugin's responsibility: clean up any data it wrote *outside* its own dir (e.g., per-content-type rows in shared tables, files in user-owned dirs). Bakin handles its own bookkeeping (plugin dir, plugin-settings JSON, registry rows for this plugin's content types, runtime skills the plugin shipped).

### 3.3 Permission Schema

**Module:** `packages/core/src/plugins/permissions.ts`

```ts
export const PermissionSchema = z.enum([
  'events.emit',     // broadcast SSE events
  'openclaw.read',   // read agent identity/skills/state from ~/.openclaw/
  'storage.read',    // read files in ~/.bakin/
  'storage.write',   // write files in ~/.bakin/
])

export type Permission = z.infer<typeof PermissionSchema>

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'events.emit':   'Broadcast Server-Sent Events to connected browsers',
  'openclaw.read': 'Read agent identity, skills, and workspace state from ~/.openclaw/',
  'storage.read':  'Read files in ~/.bakin/',
  'storage.write': 'Write files in ~/.bakin/',
}

// Pure: returns the permissions newly requested in `next` that weren't in `prev`.
export function newPermissions(prev: Permission[], next: Permission[]): Permission[]
```

**Manifest validation:** `bakin-plugin.json.permissions` parsed via `z.array(PermissionSchema).default([])`. Unknown strings reject at install/upgrade with a "did you mean…" suggestion if a known permission is within edit-distance ≤ 2.

**Empty/missing permissions** normalized to `[]`. Audit log line for a zero-permission plugin: `Plugin activated: my-plugin (requests: none)`.

**Future expansion:** add a string to the enum + an entry to `PERMISSION_DESCRIPTIONS` in the same PR that introduces the capability needing it. No migration; existing manifests declare a subset.

### 3.4 Core-plugin guard

**Module:** `src/lib/plugin-registry.ts`

```ts
const corePluginIds = new Set<string>()

export function isCorePlugin(pluginId: string): boolean {
  return corePluginIds.has(pluginId)
}
```

Populated during `pluginRegistry.initialize()` by walking `corePluginTable` entries and adding each activated plugin's manifest id.

**Enforcement points:**
- `/api/plugins/remove` → returns 400 with `{ error: 'cannot remove core plugin: <id>. Core plugins ship with Bakin and are managed via the binary itself.' }`
- `/api/plugins/upgrade` → same shape
- Lockfile mutators (`addPlugin`, `updatePlugin`, `removePlugin`) → throw

### 3.5 Registry teardown APIs

| Module | New API | Behavior |
|--------|---------|----------|
| `packages/core/src/hooks/hook-registry.ts` | `unregisterByPlugin(pluginId: string): number` | Each handler stored alongside `pluginId` (added at register time via per-plugin `ctx.hooks.register` wrapper). Returns count removed. |
| `scripts/lib/registry.ts` | `removeExecToolsByPlugin(pluginId: string): number` | Filter by name prefix `bakin_exec_<pluginId>_`. |
| `src/core/search-registry.ts` | `purgeContentType(name: string): Promise<number>` | Atomic SQL-style `DELETE FROM bakin_<name>` against antfly. No-op + return 0 if antfly disabled. |
| `plugins/workflows/lib/node-type-registry.ts` | (existing) `unregisterPluginNodeTypes(pluginId)` | Now called from remove flow, not just override. |
| `src/core/notification-channels.ts` | (existing) `unregisterPluginNotificationChannels(pluginId)` | Same. |
| `src/core/health-checks.ts` | (existing) `unregisterPluginHealthChecks(pluginId)` | Same. |

**Cron:** no `ctx.cron` plugin surface today. Nothing to clean.

### 3.6 runtime skill cleanup

**Module:** `src/core/onboarding/plugin-assets.ts` — extend with:

```ts
// Returns { removed: count, kept: count } where 'kept' counts .userEdited locks left in place.
export async function removePluginAssets(pluginId: string): Promise<{ removed: number; kept: number }>
```

Walk the runtime skill store, find every skill whose `.installedBy` has `pluginId === <removed-plugin>`. For each:
- `.userEdited` sentinel present → skip, increment `kept`
- Else → `rm -rf` skill dir, increment `removed`

### 3.7 Tarball

**Module:** `src/core/plugins/uninstall-snapshot.ts` (new)

```ts
// Snapshots everything Bakin will remove (NOT what onUninstall removes — that's the plugin's responsibility).
// Writes to ~/.bakin/.uninstalled/<id>-<ISO>.tar.gz
export async function snapshotUninstall(args: {
  pluginId: string
  pluginDir: string                    // ~/.bakin/plugins/<id>/
  settingsFile?: string                // ~/.bakin/plugin-settings/<id>.json (if exists)
  removedSkillDirs: string[]           // paths captured from the runtime skill store
}): Promise<string>                    // returns final tarball path
```

Built atomically: write to `<final>.tmp-<pid>-<ts>`, rename on success. Failure → leave the tmp file for debugging, surface error.

No retention. Tarballs accumulate. Follow-up issue tracks expiry policy.

---

## 4. Command Surfaces

### 4.1 `bakin plugins install <source> [--yes]`

**Today:** copies/clones, builds, walks away.

**After this PR:**
1. Validate manifest (Zod, including permissions enum)
2. **Show consent prompt** (layer 2):
   ```
   Installing: my-pomodoro v1.2.0
   Permissions requested:
     storage.read    Read files in ~/.bakin/
     events.emit     Broadcast Server-Sent Events to connected browsers
   Continue? [y/N]
   ```
   `--yes` skips for scripted installs.
3. Copy/clone to `~/.bakin/plugins/<id>/`
4. Run `buildUserPlugin()` (unchanged)
5. **Write lockfile entry** (full `PluginLockEntry`)
6. Exit: `"Installed <id> v<version>. Restart Bakin to activate the change: bakin stop && bakin start"`

### 4.2 `bakin plugins upgrade <id> [--yes]`

**New command.**

- Refuse if `isCorePlugin(id)` → exit 1, error message
- Read lockfile entry; error if absent
- **Github plugins:**
  - `git fetch origin <ref>` in `~/.bakin/plugins/<id>/`
  - Compare local HEAD sha to remote → if equal: `"<id> v<version>: already up to date"`
  - Fast-forward; on failure: `"<id>: cannot fast-forward (remote history rewritten?). Remove and reinstall."`
  - Read new manifest; validate; compute permission diff
  - **If permissions widened**: prompt (unless `--yes`):
    ```
    Upgrading: my-pomodoro v1.2.0 → v1.3.0
    NEW permissions requested:
      + network.fetch  Make outbound HTTP requests
    Continue? [y/N]
    ```
  - Run `buildUserPlugin()`
  - Update lockfile (`upgradedAt`, `version`, `commitSha`, `manifestSha`, `permissions`)
  - Exit: `"Upgraded <id> v<old> → v<new> (sha <old8>...<new8>). Restart Bakin to activate the change: bakin stop && bakin start"`
- **Local plugins:**
  - Read recorded `source` path; missing → error: `"Original source path <path> no longer exists. Reinstall with: bakin plugins install <new-path>"`
  - Compute current source-tree sha (skip `node_modules`, `dist`, `.git`); if equal → `"<id> v<version>: already up to date"`
  - `cpSync` source → plugin dir (overwrites)
  - Validate, prompt (if widened), build, update lockfile, restart-required exit

### 4.3 `bakin plugins remove <id>`

**Today:** deletes plugin dir, comment claims core guard but doesn't enforce it.

**After this PR:**
1. Refuse if `isCorePlugin(id)` (the comment finally matches reality)
2. Look up plugin in registry → call `plugin.onUninstall(ctx)` if defined; log+continue on error
3. Snapshot to `<final>.tmp-...` tarball (plugin dir + plugin-settings JSON + filtered skills excluding `.userEdited`)
4. Run registry sweep:
   - `hookRegistry.unregisterByPlugin(id)`
   - `removeExecToolsByPlugin(id)`
   - `unregisterPluginNodeTypes(id)`
   - `unregisterPluginNotificationChannels(id)`
   - `unregisterPluginHealthChecks(id)`
   - For every content type the plugin registered: `await ctx.search.purgeContentType(name)`
5. Filesystem deletes:
   - `removePluginAssets(id)` — runtime skills (respecting `.userEdited`)
   - `rm ~/.bakin/plugin-settings/<id>.json` (if exists)
   - `rm -rf ~/.bakin/plugins/<id>/`
6. Move tarball tmp → `~/.bakin/.uninstalled/<id>-<ISO>.tar.gz`
7. Remove lockfile entry
8. Exit:
   ```
   Removed plugin: <id>
     Cleaned 4 runtime skills (created-by-<id>)
     Kept 2 user-edited runtime skills
     Snapshot saved: ~/.bakin/.uninstalled/<id>-2026-04-25T...tar.gz
   Restart Bakin to fully release the plugin's modules: bakin stop && bakin start
   ```

### 4.4 `bakin plugins list [--check]`

**Today:** 3-column output: id, name, (version).

**After this PR — plain `list`** reads lockfile + corePluginIds, renders:

```
ID            NAME              VERSION    SOURCE        STATUS
tasks         Tasks             1.0.0      [core]
schedule      Schedule          1.0.0      [core]
my-pomodoro   Pomodoro          1.2.0      github         upgrade available (1.3.0)
local-thing   Local Plugin      0.1.0      local          up to date (checked 2h ago)
stale-plugin  Stale Plugin      0.5.0      github         (last checked 12 days ago — run with --check)
```

- `[core]` for core plugins (no STATUS populated)
- `github` / `local` for user plugins
- STATUS comes from lockfile-stored `remoteHeadSha`/`sourceTreeSha` vs `commitSha`/recorded tree sha
- 7-day staleness hint when `lastChecked` > 7 days ago

**`bakin plugins list --check`:**
- For each user plugin:
  - **github**: `git ls-remote <remote> <ref>` → record `remoteHeadSha` + `lastChecked`
  - **local**: walk source dir, compute tree sha → record `sourceTreeSha` + `lastChecked`
- Persist via atomic write
- Render the same table with fresh STATUS info

### 4.5 Plugin activation logging (#142 layer 1)

Every plugin activation appends:
- To `audit.jsonl`: `{ ts, kind: 'plugin.activate', pluginId, version, permissions: string[], source: 'core'|'github'|'local' }`
- To `server.log` via `log.info('plugin activated', { pluginId, version, permissions, source })`

User-facing grep target: `cat ~/.bakin/audit.jsonl | jq 'select(.kind == "plugin.activate")'` — shows every plugin and what it was authorized for.

---

## 5. Project Structure

**New files:**

```
packages/core/src/plugins/
  lockfile.ts                    — Lockfile schema + IO + pure mutators
  permissions.ts                 — Zod enum + descriptions + diff helpers

src/core/plugins/
  uninstall-snapshot.ts          — Tarball builder for remove flow
  upgrade.ts                     — Upgrade flow (orchestrates git/local + lockfile + build)
  install.ts                     — Install flow refactor (extracted so upgrade can share)
  consent-prompt.ts              — TTY prompt for layer-2 consent (testable: takes io fns)

packages/host/src/api/plugins/
  upgrade.ts                     — POST /api/plugins/upgrade

src/core/cli/
  plugins-upgrade.ts             — cmdPluginsUpgrade

tests/plugins/lifecycle/
  lockfile.test.ts
  permissions.test.ts
  uninstall-snapshot.test.ts
  consent-prompt.test.ts
  is-core-plugin.test.ts
  hook-unregister-by-plugin.test.ts
  exec-tools-remove-by-plugin.test.ts
  search-purge-content-type.test.ts
  install-flow.integration.test.ts
  upgrade-flow.integration.test.ts
  remove-flow.integration.test.ts
  core-plugin-guard.test.ts
  github-smoke.e2e.test.ts        — Gated behind BAKIN_E2E_GITHUB=1

tests/fixtures/plugins/
  hermetic-git.ts                — Helpers to spin up bare git repos in tmp dirs
  fixture-plugins/
    minimal/                     — bakin-plugin.json + index.ts + client.tsx (no deps)
    with-permissions/            — declares storage.write + events.emit
    with-skills/                 — ships defaults/runtime-skills/X/SKILL.md
```

**Modified files:**

```
packages/core/src/plugin-types.ts          — Add onUninstall? to BakinPlugin
packages/core/src/hooks/hook-registry.ts   — unregisterByPlugin + per-handler pluginId tracking
src/lib/plugin-registry.ts                 — isCorePlugin, populate corePluginIds, wire activation log
scripts/lib/registry.ts                    — removeExecToolsByPlugin
src/core/search-registry.ts                — purgeContentType
src/core/onboarding/plugin-assets.ts       — removePluginAssets
src/core/cli.ts                            — wire cmdPluginsUpgrade, --yes flags
packages/host/src/api/plugins/install.ts   — write lockfile entry, run consent prompt
packages/host/src/api/plugins/remove.ts    — full teardown sweep (orchestration)

.claude/knowledge/plugin-system.md         — Lifecycle section update
docs/plugin-authoring.md                   — onUninstall + permissions taxonomy + lockfile contract
CLAUDE.md                                  — If lifecycle section becomes inaccurate
```

---

## 6. Code Style

Per CLAUDE.md (no deviations):

- TypeScript strict mode. No `any` across module boundaries.
- Zod at all system boundaries: lockfile parse, manifest parse, API request bodies.
- `kebab-case.ts` filenames. `PascalCase` types/interfaces. `UPPER_SNAKE_CASE` true constants.
- Functional preference. Pure mutators for the lockfile. No classes for the new modules.
- Import order: builtins → external → SDK → `@/*` internal → `@bakin/{plugin}/*` → relative.
- Logging: `const log = createLogger('plugins/lifecycle')` (or per-module name).
- No empty catch blocks. Every catch logs or rethrows.
- `const` over `let`. Never `var`.
- Conventional commit messages with scope (`feat(plugins): ...`).

Specific to this work:

- All path resolution via `getContentDir()` / `getOpenClawPath()` — never hardcode `~/.bakin/` or `~/.openclaw/`.
- Atomic writes via tmp+rename for any file Bakin owns as source of truth (lockfile, tarball).
- The lockfile module mirrors `agent-packages/lockfile.ts` line-for-line in style — same docblock voice, same export ordering, same pure-mutator pattern.

---

## 7. Testing Strategy

**Floor (CLAUDE.md, non-negotiable):**
- Mock `getContentDir` (both `src/core/content-dir.ts` AND `packages/core/src/content-dir.ts`)
- Mock `getOpenClawHome` (`@bakin/core/openclaw-home`)
- Mock the logger
- Mock the watcher
- Mock the active runtime boundary (`ctx.runtime` or `src/core/runtime-registry`)
- `bun test --isolate`
- `process.env.OPENCLAW_HOME` and `process.env.BAKIN_HOME` set BEFORE imports for any module reading these at load time
- `afterAll(() => rmSync(testDir, { recursive: true, force: true }))`

**Layer A — Pure unit (no I/O beyond temp dirs):**
- `lockfile.test.ts` — Zod schema accept/reject; atomic IO (write+read+verify; tmp file cleanup on simulated failure); every mutator (add/remove/update/idempotency); core-plugin reject in mutators
- `permissions.test.ts` — Enum accept/reject; `newPermissions` diff (identical, removed-only, added-only, both, empty); manifest validation produces "did you mean" within edit-distance 2
- `uninstall-snapshot.test.ts` — Snapshot fixture tree → extract → byte-equal verify; missing optional file (no settings JSON) handled; tarball lands at expected path
- `consent-prompt.test.ts` — Inject fake stdin/stdout; `--yes` short-circuits; `n`/`N`/empty reject; permission diff display matches exact expected string
- `is-core-plugin.test.ts` — Empty registry; populated; predicate stable across multiple init calls

**Layer B — Registry cleanup unit:**
- `hook-unregister-by-plugin.test.ts` — Register from plugin A and B, sweep A, B handlers still fire; double-sweep is no-op; sweep with no matches returns 0
- `exec-tools-remove-by-plugin.test.ts` — Prefix filtering correctness; tools without prefix unaffected; idempotent
- `search-purge-content-type.test.ts` — Against in-memory antfly stub: insert N rows, purge, count == N, table rebuilds clean; antfly-disabled mode → no-op returns 0

**Layer C — Integration (real fs, hermetic git in temp dirs):**
- `install-flow.integration.test.ts` — Local-path install → lockfile written with correct shape, manifestSha matches, permissions captured. Github install (against hermetic bare repo) → same plus commitSha + ref recorded.
- `upgrade-flow.integration.test.ts` — Github: push commit → upgrade detects sha drift → fast-forwards → lockfile updated. No-op short-circuit when shas equal. Permissions widened → prompt fires (consent-prompt mocked). Force-push scenario → fast-forward error surfaced. Local: modify source dir → upgrade re-syncs. Local source path missing → error message verbatim.
- `remove-flow.integration.test.ts` — Full teardown happy path: `onUninstall` called, all 7 cleanup APIs invoked (assert via per-registry post-state), tarball lands in `.uninstalled/`, plugin dir gone, settings JSON gone, runtime skills cleaned (with `.userEdited` honored — assert kept count). `onUninstall` throws → cleanup still completes, error logged.
- `core-plugin-guard.test.ts` — Both `/api/plugins/remove` and `/api/plugins/upgrade` return 400 for any core id. Lockfile mutators throw for core ids.

**Hybrid git substrate:**
- **Default: hermetic local bare repos.** `tests/fixtures/plugins/hermetic-git.ts` exposes `createBareRepo(fixturePath: string): Promise<string>` (returns `file://` URL) and `pushCommit(workdir: string, files: Record<string, string>): Promise<string>` (returns sha). `git init --bare` is fast (~50ms). Tests skip with a clear message if `git` not on PATH.
- **One e2e smoke:** `github-smoke.e2e.test.ts` gated behind `BAKIN_E2E_GITHUB=1`. Points at `madeinwyo/bakin-plugin-fixture-readonly` (public, single commit, never changes — set up as part of this work). Verifies: `github:user/repo` URL parser → real clone → default-branch detection → `git ls-remote` for upgrade-available check. Runs in CI on tagged release only.

**Coverage target:** every new public function has at least one happy-path + one error-case test.

**Explicitly NOT tested:**
- Permission prompt visual rendering (manual smoke test pre-merge)
- Audit log line formatting (covered indirectly via assertions on the recorded entry shape)
- Hot reload (not in scope per design decision 13)

---

## 8. Boundaries

**Always do:**
- Validate manifest with Zod at install/upgrade boundary
- Atomic IO (tmp+rename) for lockfile writes and tarball writes
- Resolve all paths via `getContentDir()` / `getOpenClawPath()`
- Honor `.userEdited` sentinel files when removing runtime skills
- Log every plugin activation's permission set to audit + server.log
- Continue cleanup after `onUninstall` errors (log+continue, never trap user)
- Refuse mutation of core plugins at API + lockfile + CLI layers (defense in depth)

**Ask first about:**
- Anything that would change the lockfile schema after merge — that's a v1→v2 bump and migration story
- Adding a new permission to the enum mid-PR — scope creep; new permissions ship with the capability that needs them
- Any deviation from the agent-packages lockfile module style — symmetry is the point

**Never do:**
- Hardcode `~/.bakin/` or `~/.openclaw/` paths anywhere (tests included)
- Silently hard-reset on git fast-forward failure (always error and tell user to remove+reinstall)
- Auto-clean retention from `~/.bakin/.uninstalled/` (out of scope; follow-up issue)
- Allow `bakin plugins remove` or `upgrade` to mutate state for core plugin ids
- Skip `--isolate` in test runs
- Touch real `~/.bakin/` or `~/.openclaw/` from any test
- Mock `getContentDir` from only one of its two import paths (must mock both to avoid leak surface)

---

## 9. Commit Checkpoint Sequence

13 commits total. Each is independently revertible; each compiles and passes existing tests.

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat(plugins): install lockfile + Zod schema` | New `packages/core/src/plugins/lockfile.ts`. Wire `install.ts` to write entry. No reads yet. |
| 2 | `feat(plugins): isCorePlugin predicate + remove guard` | New predicate; populate during init; fix the missing `remove.ts` core guard. |
| 3 | `feat(plugins): list output rework — type, source, status columns` | Read lockfile, render new columns, mark `[core]`. No `--check` yet. |
| 4 | `feat(plugins): upgrade command (no-op detection + git/local rebuild)` | `/api/plugins/upgrade`, `cmdPluginsUpgrade`. Lockfile updated. Restart-required exit. |
| 5 | `feat(plugins): list --check + lastChecked staleness hint` | Opt-in remote/local check; persists `remoteHeadSha`/`sourceTreeSha` + `lastChecked`. 7-day stale hint in plain `list`. |
| 6 | `feat(plugins): hook + exec-tool unregister-by-plugin APIs + search purgeContentType` | Pure infra. No remove-flow change yet. |
| 7 | `feat(plugins): onUninstall hook + full teardown sweep` | `BakinPlugin.onUninstall?`. Wire remove flow: hook → registry sweep (#6) → settings JSON → runtime skills (`.userEdited` honored) → tarball snapshot → fs delete → lockfile entry. The big one. |
| 8 | `feat(plugins): permissions Zod enum + audit log on activate` | Lock the 4-permission enum, descriptions map, log on every activation. Validate manifests at install/upgrade. (#142 layer 1) |
| 9 | `feat(plugins): install/upgrade consent prompt` | Interactive prompt at install; on upgrade only when widened. `--yes` flag. (#142 layer 2) |
| 10 | `test(plugins): lifecycle integration + unit coverage` | All Layer A/B/C tests. Hermetic local-git substrate. Optional `BAKIN_E2E_GITHUB=1` smoke. |
| 11 | `docs(plugins): update knowledge + plugin-authoring + follow-up issues` | `.claude/knowledge/plugin-system.md` lifecycle section; `docs/plugin-authoring.md` (`onUninstall`, permissions, lockfile); CLAUDE.md updates if needed. Follow-up issue links inline. |

**Rollback story:**
- Reverting any single commit leaves the tree compiling and tests passing
- Worst case (revert #4): list shows the column but every plugin shows "—" for upgrade status; no functional break in install/remove
- Critical safety commits: #2 (core guard) ships before any new endpoint that could be tricked into operating on core plugins; #6 ships before #7 because #7 depends on the new APIs

---

## 10. Follow-up Issues to File (at commit #11)

1. **feat(plugins): signature verification + trusted signers** — From #151 cut. Spec: `bakin-plugin.json.signature`, `settings.plugins.trustedSigners`, `settings.plugins.requireSignatures` (default false).
2. **feat(plugins): .uninstalled tarball retention + restore command** — From #119 cut. Spec: retention policy (e.g., 90 days or N most recent), `bakin plugins restore <id>` UX, `bakin trash` integration.
3. **feat(plugins): permissions layer 3 — runtime capability gating** — From #142. Spec: wrap `ctx.*` methods, throw `PermissionDenied` if undeclared. Needs disable-toggle for rollout.
4. **feat(plugins): pin install ref (tag/branch/commit)** — From #151. Spec: `github:user/repo@v1.2.0` syntax; lockfile `ref` field already supports it; upgrade UX (`--unpin`/`--ref=`).
5. **feat(plugins): bakin plugins import/export** — Depends on #4. Spec: export installed plugin set to a manifest file; `bakin plugins import <file>` to reproduce on another machine.
6. **feat(plugins): hot reload for install/upgrade/remove** — From cut. Documents design constraints (registry teardown APIs already shipped — #6 in this PR — make it tractable).

Existing #151, #119, #142 close on this PR's merge.

---

## 11. Acceptance

This spec is satisfied when:

- [ ] `~/.bakin/plugins/lock.json` exists and is the canonical install ledger; install/upgrade/remove all read+write it via the same atomic IO module
- [ ] `bakin plugins upgrade <id>` works for both github and local plugins per §4.2
- [ ] `bakin plugins list --check` populates `lastChecked` + `remoteHeadSha`/`sourceTreeSha`
- [ ] `bakin plugins remove <id>` runs the full teardown sweep per §4.3, snapshots to `~/.bakin/.uninstalled/`, honors `.userEdited`
- [ ] `BakinPlugin.onUninstall` is callable and survives errors (cleanup continues)
- [ ] Core plugins refuse `remove` and `upgrade` at API + lockfile + CLI layers
- [ ] Manifest permissions are validated against the Zod enum at install/upgrade
- [ ] Plugin activation logs requested permissions to audit + server.log
- [ ] Install (and upgrade-with-widened-permissions) prompts for consent; `--yes` skips
- [ ] All 13 commits land in order; each compiles + passes existing tests
- [ ] New tests cover happy + error paths for every new public function
- [ ] `.claude/knowledge/plugin-system.md` and `docs/plugin-authoring.md` reflect the new lifecycle
- [ ] 6 follow-up issues filed and linked in PR description
- [ ] #151, #119, #142 close on merge
