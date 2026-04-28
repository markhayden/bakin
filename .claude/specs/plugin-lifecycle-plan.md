# Execution Plan — Plugin Lifecycle Hardening

Companion to `.claude/specs/plugin-lifecycle.md`. Read the spec first for the *what* and *why*; this is the *how* — exact files, signatures, dependency graph, per-checkpoint verification, rollback story.

## Refresher

13 commits across one branch (`feat/plugin-lifecycle`) bundling #151 (`bakin plugins upgrade`), #119 (per-plugin uninstall teardown), and #142 (permissions enforcement layers 1+2). The unifying primitive is `~/.bakin/plugins/lock.json` — modeled exactly after `packages/core/src/agent-packages/lockfile.ts`.

**State of main on branch creation:**
- `install.ts` clones/copies + builds and walks away — **no lockfile entry written today**
- `remove.ts` deletes plugin dir only; the docblock claims a core guard but no code enforces it. The CLI (`cmdPluginsRemove`) already checks `res.core`, so the response shape is forward-compatible — we just need the API to actually populate it
- `cmdPluginsList` prints 3 columns; no source/type/status surface
- No `cmdPluginsUpgrade` exists
- `corePluginTable` is set during boot (`registerCorePlugins(table)` in `server.ts`) and consulted in `plugin-registry.ts:338` — but no `isCorePlugin(id)` predicate is exposed
- Hook registry has `register/call/callAll/invoke/has/clearAll` but no plugin-scoped tracking
- `addExecTool` keys by tool name; tools follow `bakin_exec_<pluginId>_<action>` — ownership derivable from prefix
- Workflow-node / notification-channel / health-check registries already have `unregisterPluginX(id)` APIs but they're only called when a user plugin overrides a core one (`plugin-registry.ts:427-429`)
- No `ctx.search.purgeContentType` exists; `ctx.search` exposes `index/remove/transform/registerContentType`
- `manifest.permissions` is parsed and discarded — zero readers
- 4 distinct permission strings appear across all current manifests: `events.emit`, `openclaw.read`, `storage.read`, `storage.write`
- Agent-packages lockfile (`packages/core/src/agent-packages/lockfile.ts`) is the canonical pattern: Zod schema + atomic tmp+rename IO + pure mutators + `getOrphanedPacks` style helpers. Mirror the docblock voice and export ordering.

**Per-commit verification adds `bunx tsc --noEmit -p tsconfig.app.json`** alongside `bun test --isolate` — Bun's runtime test runner doesn't catch TS-only errors that CI does.

## Critical Files

| # | Path | Role | Rough edit surface |
|---|---|---|---|
| 1 | `packages/core/src/plugins/lockfile.ts` | **New.** Lockfile schema (Zod) + atomic IO + pure mutators (`addPlugin`, `removePlugin`, `updatePlugin`). Mirror agent-packages `lockfile.ts` style. | ~200 lines. |
| 2 | `packages/core/src/plugins/permissions.ts` | **New.** `PermissionSchema` Zod enum + `PERMISSION_DESCRIPTIONS` map + `newPermissions(prev, next)` pure diff. | ~80 lines. |
| 3 | `packages/core/src/plugin-types.ts` | Add `onUninstall?(ctx)` to `BakinPlugin`. Re-export `Permission` type. | +5 lines, no breaking change. |
| 4 | `packages/core/src/hooks/hook-registry.ts` | Add `unregisterByPlugin(pluginId): number`. Each handler now stored alongside its `pluginId`. | ~30 line addition. |
| 5 | `src/lib/plugin-registry.ts` | Add `isCorePlugin(id)` predicate + `corePluginIds` Set. Populate during init. Wire `register` to capture `pluginId` for hook tracking. Wire activation log (#142 layer 1). | ~40 line addition; one new export. |
| 6 | `scripts/lib/registry.ts` | Add `removeExecToolsByPlugin(pluginId): number` — filters by `bakin_exec_<pluginId>_*` name prefix. | +15 lines. |
| 7 | `src/core/search-registry.ts` | Add `purgeContentType(name): Promise<number>` — atomic delete of all rows in `bakin_<name>` table; no-op if antfly disabled. | ~30 line addition. |
| 8 | `src/core/onboarding/plugin-assets.ts` | Add `removePluginAssets(pluginId): Promise<{ removed, kept }>` — uses the runtime adapter to remove skills whose `.installedBy.pluginId` matches and `.userEdited` is absent. | ~50 line addition. |
| 9 | `src/core/plugins/uninstall-snapshot.ts` | **New.** `snapshotUninstall({ pluginId, pluginDir, settingsFile, removedSkillDirs })` — builds `<id>-<ISO>.tar.gz` atomically into `~/.bakin/.uninstalled/`. | ~80 lines. |
| 10 | `src/core/plugins/install.ts` | **New.** Extracted install flow (Zod manifest validation, lockfile write, consent prompt orchestration). Re-used by both `/api/plugins/install` and the (future) hot-reload path. | ~150 lines. |
| 11 | `src/core/plugins/upgrade.ts` | **New.** `upgradePlugin(id, opts)` — git fetch / fast-forward + local re-cpSync, no-op detection, lockfile update, consent prompt for widened permissions. | ~200 lines. |
| 12 | `src/core/plugins/consent-prompt.ts` | **New.** Pure-ish TTY prompt — takes `stdin/stdout` as parameters so tests inject fakes. Renders permission diff. Honors `--yes`. | ~70 lines. |
| 13 | `packages/host/src/api/plugins/install.ts` | Refactor to delegate to `src/core/plugins/install.ts`. Keep the path-traversal guard + manifest-id derivation in the API layer. Wire lockfile write + consent prompt. | ~30 line edit. |
| 14 | `packages/host/src/api/plugins/upgrade.ts` | **New.** POST endpoint that validates body, calls `upgradePlugin`, returns lockfile entry shape. | ~60 lines. |
| 15 | `packages/host/src/api/plugins/remove.ts` | Major restructure — add core guard (returns `{ core: true }` per existing CLI expectation), call `onUninstall`, run registry sweep, snapshot, fs deletes, lockfile entry removal. | ~100 line rewrite. |
| 16 | `packages/host/src/api/plugins/manifest.ts` | Extend response to include `source: 'core'\|'github'\|'local'`, `installed: PluginLockEntry \| null`, `lastChecked: string \| null`, `upgradeAvailable: boolean`. CLI uses these for the new list output. | ~30 line addition. |
| 17 | `src/core/cli.ts` | Update `cmdPluginsList` for new column layout. Add `cmdPluginsUpgrade(id, opts)`. Add `--yes` flag plumbing for install/upgrade. Add `--check` flag for list. Update `USAGE` text. Update remove handler to surface tarball path + skill counts from new response shape. | ~120 line addition. |
| 18 | `tests/plugins/lifecycle/lockfile.test.ts` | **New.** Layer A — Zod accept/reject, atomic IO, pure mutators, core-plugin reject. | ~250 lines. |
| 19 | `tests/plugins/lifecycle/permissions.test.ts` | **New.** Layer A — enum accept/reject, `newPermissions` diff, did-you-mean suggestion. | ~120 lines. |
| 20 | `tests/plugins/lifecycle/uninstall-snapshot.test.ts` | **New.** Layer A — snapshot+extract+verify, missing settings, atomic temp cleanup. | ~120 lines. |
| 21 | `tests/plugins/lifecycle/consent-prompt.test.ts` | **New.** Layer A — `--yes` short-circuits, `n`/empty rejects, diff display. | ~100 lines. |
| 22 | `tests/plugins/lifecycle/is-core-plugin.test.ts` | **New.** Layer A — predicate stable across init calls. | ~50 lines. |
| 23 | `tests/plugins/lifecycle/hook-unregister-by-plugin.test.ts` | **New.** Layer B — sweep removes only matching plugin's handlers. | ~80 lines. |
| 24 | `tests/plugins/lifecycle/exec-tools-remove-by-plugin.test.ts` | **New.** Layer B — prefix filter correctness, idempotent. | ~60 lines. |
| 25 | `tests/plugins/lifecycle/search-purge-content-type.test.ts` | **New.** Layer B — purge against in-memory antfly stub. | ~100 lines. |
| 26 | `tests/plugins/lifecycle/install-flow.integration.test.ts` | **New.** Layer C — local + hermetic-github install → lockfile shape correct. | ~200 lines. |
| 27 | `tests/plugins/lifecycle/upgrade-flow.integration.test.ts` | **New.** Layer C — github push+upgrade, no-op short-circuit, force-push error, local resync, missing-source error, widened-permissions prompt. | ~300 lines. |
| 28 | `tests/plugins/lifecycle/remove-flow.integration.test.ts` | **New.** Layer C — full teardown sweep + tarball + `.userEdited` honored + `onUninstall` error survives. | ~250 lines. |
| 29 | `tests/plugins/lifecycle/core-plugin-guard.test.ts` | **New.** Layer C — both endpoints return 400 + lockfile mutators throw for core ids. | ~80 lines. |
| 30 | `tests/plugins/lifecycle/github-smoke.e2e.test.ts` | **New.** Layer C — gated behind `BAKIN_E2E_GITHUB=1`; points at public read-only fixture repo. | ~100 lines. |
| 31 | `tests/fixtures/plugins/hermetic-git.ts` | **New.** Helpers — `createBareRepo(fixturePath)`, `pushCommit(workdir, files)`, `forcePushRewind(workdir, sha)`. | ~120 lines. |
| 32 | `tests/fixtures/plugins/fixture-plugins/{minimal,with-permissions,with-skills}/` | **New.** Three fixture plugins for integration tests. | ~6 small files each. |
| 33 | `.claude/knowledge/plugin-system.md` | Add "Lifecycle" section: lockfile contract, `onUninstall` hook, registry teardown, permissions taxonomy, list output schema. | ~120 line addition. |
| 34 | `docs/plugin-authoring.md` | Add: `onUninstall` hook authoring guidance, permissions field documentation, lockfile reference (read-only — authors don't touch it but should know it exists). | ~80 line addition. |
| 35 | `CLAUDE.md` | Update §Plugin System with lifecycle commands surface. Update §Key Patterns to reference the new lockfile primitive. | ~15 line edit. |

**Not touched:**

- `packages/host/src/plugin-host/user-plugin-builder.ts` — `buildUserPlugin` signature stays. Both install + upgrade call it the same way.
- `packages/host/src/api/plugins/manifest.ts` (the registry-snapshot reader) gets one extension; no rewrite.
- `plugins/*/bakin-plugin.json` — existing core manifests stay as-is. Their permissions arrays are already valid against the new Zod enum.
- `src/core/onboarding/plugin-assets.ts` install side — only adding `removePluginAssets`; install path untouched.
- Cron / schedule plugin — no plugin-registered cron jobs exist; nothing to clean.
- `packages/sdk/*` — `unregisterPlugin` SDK helper already exists; not affected.

## Pre-flight Checklist

Verify before commit #1:

- [ ] On a fresh branch from `main`: `git checkout -b feat/plugin-lifecycle`
- [ ] `bun install` clean (no peer-dep warnings introduced by current state)
- [ ] `bun test --isolate` baseline green — capture pass count to compare against later
- [ ] `bunx tsc --noEmit -p tsconfig.app.json` clean
- [ ] Confirm `git --version` ≥ 2.20 on the dev machine (needed for `git ls-remote --symref`)
- [ ] Confirm `~/.bakin/` is writable + healthy on dev machine; `~/.bakin/plugins/` may or may not exist
- [ ] Audit `packages/core/src/agent-packages/lockfile.ts` — bookmark the docblock voice and export ordering for visual matching
- [ ] If the `madeinwyo/bakin-plugin-fixture-readonly` repo doesn't exist yet, create it (single commit with a minimal `bakin-plugin.json` + trivial `index.ts`); only blocks C10 (e2e smoke), not C1

## Dependency Graph

```
C1 (lockfile)             ─▶ C2 (isCore + remove guard)         ─┐
                                                                  │
C1 ─▶ C3 (list rework — type/source/status columns) ─▶ C5 (--check)
│                                                                 │
└─▶ C4 (upgrade command) ─────────────────────────────────────────┤
                                                                  │
C6 (registry teardown APIs — hook/exec/search) ─▶ C7 (remove flow rewrite)
                                                                  │
C1 ─▶ C8 (permissions enum + audit log on activate)               │
                                                                  │
C8 ─▶ C9 (consent prompt for install/upgrade)                     │
                                                                  │
                       (all of C1-C9)                             │
                              │                                   │
                              ▼                                   │
                       C10 (test pass)                            │
                              │                                   │
                              ▼                                   │
                       C11 (docs)                                 │
                                                                  ▼
                                                   PR with all 11 commits
```

- **C1 (lockfile) gates everything else** — every read/write of plugin install state flows through it.
- **C2 (core guard) ships before C4 (upgrade) and C7 (remove rewrite)** — both endpoints must reject core ids, and the predicate must exist before the API can call it.
- **C3 (list output) reads from the lockfile written by C1** — depends on C1 for the new columns to populate, but doesn't require C2 (it just *displays* `[core]`, doesn't enforce).
- **C5 (--check) layers atop C3** — adds the network/local check + persists `lastChecked`.
- **C6 (registry APIs) is pure infra** — no behavior change visible to users until C7 wires them.
- **C7 (remove rewrite) depends on C1 (lockfile remove), C2 (core guard), C6 (registry APIs)** — the heaviest commit; everything must be in place.
- **C8 (permissions enum + audit log)** depends on C1 only (the lockfile records permissions as part of the `PluginLockEntry`).
- **C9 (consent prompt) depends on C1 + C8** — needs lockfile to read prior `permissions`, needs enum to display descriptions.
- **C10 (tests) lands in one commit** — by spec design decision; build incremental test files inline if you wish during build, but the canonical commit is the test pass.
- **C11 (docs) lands last** — reflects the landed state, not the planned state.

## Per-Commit Plan

### C1 — `feat(plugins): install lockfile + Zod schema`

**Files:** `packages/core/src/plugins/lockfile.ts` (new), `packages/host/src/api/plugins/install.ts` (write entry), inline tests for the API write call (kept minimal here; full lockfile coverage in C10).

**Changes:**

New module `packages/core/src/plugins/lockfile.ts`. Mirror agent-packages `lockfile.ts` line-for-line in style (docblock voice, section comments `// ─── Schemas ───`, atomic IO via tmp+rename). Exports per spec §3.1:

```ts
export const PluginLockfileSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), PluginLockEntrySchema),
})

export function getPluginLockfilePath(): string
export function readPluginLockfile(path?: string): PluginLockfile
export function writePluginLockfile(lock: PluginLockfile, path?: string): void

// Pure mutators
export function addPlugin(lock: PluginLockfile, id: string, entry: PluginLockEntry): PluginLockfile
export function removePlugin(lock: PluginLockfile, id: string): PluginLockfile
export function updatePlugin(lock: PluginLockfile, id: string, patch: Partial<PluginLockEntry>): PluginLockfile

// Core-plugin defense (throws). Imported lazily to avoid circular dep with plugin-registry.
function assertNotCore(id: string): void
```

`PluginLockEntrySchema` per spec §3.1. The `permissions` array uses `z.array(z.string())` here (Zod-enum lock comes in C8 — at C1 we're write-only and the enum module doesn't exist yet; C8 will tighten this). Lockfile path: `join(getContentDir(), 'plugins', 'lock.json')`.

`packages/host/src/api/plugins/install.ts` extension:
- After successful `buildUserPlugin(targetDir)`, compute `manifestSha = sha256(readFileSync(manifestPath))`
- Resolve `commitSha` via `execFileSync('git', ['rev-parse', 'HEAD'], { cwd: targetDir })` for github installs; empty string for local
- Resolve `ref` via `execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: targetDir })` for github; empty string for local
- Build `entry: PluginLockEntry` with `installedAt: new Date().toISOString()`, `version: manifest.version`, `permissions: manifest.permissions ?? []`
- Read lockfile, `addPlugin(lock, id, entry)`, write back

**Tests:** Smoke unit test inline (`tests/plugins/lifecycle/lockfile-smoke.test.ts`) — write+read round-trip + one happy mutator path. Full coverage in C10.

**Acceptance:**
- [ ] `~/.bakin/plugins/lock.json` is created on first install
- [ ] Subsequent install adds entry without clobbering prior entries
- [ ] Lockfile passes `PluginLockfileSchema.parse` after every write
- [ ] Atomic write: kill -9 simulation (test only) doesn't leave a half-written file
- [ ] Mirror of agent-packages style verified by visual diff

**Verification:**
```bash
bun test --isolate tests/plugins/lifecycle/lockfile-smoke.test.ts
bunx tsc --noEmit -p tsconfig.app.json
# Manual smoke: install a fixture plugin, cat ~/.bakin/plugins/lock.json
```

**Complexity:** **M.** Lockfile module is ~200 lines but mostly mechanical mirroring. Install endpoint extension is small.

**Risk:** Low. New file + additive change to install endpoint. If lockfile write fails, install still succeeds (we wrap the write in try/catch and log + continue — don't block install on lockfile errors at C1; C7 cares about consistency for remove).

**Rollback:** Revert two files. Lockfile file remains on disk for users who installed during the experiment but is harmless — never read until C3.

---

### C2 — `feat(plugins): isCorePlugin predicate + remove guard`

**Files:** `src/lib/plugin-registry.ts`, `packages/host/src/api/plugins/remove.ts`, `packages/core/src/plugins/lockfile.ts` (wire `assertNotCore`)

**Changes:**

`src/lib/plugin-registry.ts`:
- Add `const corePluginIds: Set<string> = (globalThis as any).__bakinCorePluginIds ??= new Set<string>()`
- Export `isCorePlugin(pluginId: string): boolean`
- During `pluginRegistry.initialize()`, after each core plugin's manifest is loaded, call `corePluginIds.add(manifest.id)`. The activation loop walks `corePluginTable` keyed by path; the manifest is read in the same place (line ~340). Add the id capture there.

`packages/host/src/api/plugins/remove.ts`:
- After body validation, before the existsSync check, add:
  ```ts
  if (isCorePlugin(pluginId)) {
    return Response.json({
      ok: false,
      core: true,
      error: `cannot remove core plugin: ${pluginId}. Core plugins ship with Bakin and are managed via the binary itself.`,
    }, { status: 400 })
  }
  ```
- The `core: true` flag matches what `cmdPluginsRemove` already expects (the CLI scaffolding is forward-compatible — it currently never receives `core: true` because the API never emits it)

`packages/core/src/plugins/lockfile.ts`:
- Wire `assertNotCore(id)` (lazy-imports `isCorePlugin` to avoid circular dep) into `addPlugin`, `removePlugin`, `updatePlugin`. Throw with the exact message: `"refusing to mutate lockfile entry for core plugin: <id>"`. Defense-in-depth.

**Tests:** None at this commit — `core-plugin-guard.test.ts` lands in C10 covering all enforcement points together.

**Acceptance:**
- [ ] `bakin plugins remove <core-id>` exits 2 with the standard error message (CLI already handles `res.core === true`)
- [ ] Lockfile mutators throw for core ids
- [ ] `isCorePlugin('tasks')` returns true after server boot; `isCorePlugin('nonexistent')` returns false
- [ ] No core plugin id ever appears in `~/.bakin/plugins/lock.json`

**Verification:**
```bash
bun test --isolate                      # nothing should regress
bunx tsc --noEmit -p tsconfig.app.json
# Manual: bun run dev:mock; bakin plugins remove tasks → should refuse with new message
```

**Complexity:** **S.** ~30 lines across three files.

**Risk:** Low. The CLI already handles `res.core` so no new client work needed.

**Rollback:** Three files revert. `corePluginIds` Set sits unused in memory (harmless).

---

### C3 — `feat(plugins): list output rework — type, source, status columns`

**Files:** `packages/host/src/api/plugins/manifest.ts`, `src/core/cli.ts`

**Changes:**

`packages/host/src/api/plugins/manifest.ts`:
- Existing GET handler returns `{ plugins: ManifestPlugin[] }`. Extend `ManifestPlugin` with:
  ```ts
  source: 'core' | 'github' | 'local'
  installed: PluginLockEntry | null      // null for core; populated for user plugins
  upgradeAvailable: boolean              // false until C5; always false at C3
  staleHintDays: number | null           // null until C5
  ```
- Read lockfile, look up each plugin's id, populate `source` from `isCorePlugin(id)` ? `'core'` : `installed.type`, populate `installed` from the lockfile entry

`src/core/cli.ts` `cmdPluginsList`:
- Update fetched type
- Render the new column layout from spec §4.4. Use `padEnd` for column alignment; widths: id=14, name=18, version=11, source=14, status=remainder
- Header row printed once
- For core plugins, populate SOURCE=`[core]`, STATUS empty
- For user plugins, populate SOURCE = `'github'` | `'local'` (lowercase, no brackets), STATUS = `'up to date'` for now (C5 will add staleness/upgrade-available logic; C3 just shows neutral status)
- `(no plugins registered)` empty-state message preserved

**Tests:** Inline smoke test for the manifest endpoint shape; full list-rendering coverage in C10.

**Acceptance:**
- [ ] `bakin plugins list` renders the new 5-column layout
- [ ] Core plugins show `[core]` in SOURCE; STATUS is blank
- [ ] User plugins (if any installed) show `github` or `local` in SOURCE
- [ ] Existing `(no plugins registered)` message still shows when both core+user are empty

**Verification:**
```bash
bun test --isolate tests/plugins
bunx tsc --noEmit -p tsconfig.app.json
# Manual: bun run dev:mock; bakin plugins list → new layout
```

**Complexity:** **M.** Mostly type/render plumbing. ~80 lines total.

**Risk:** Low. Purely additive in the API response (existing CLI clients of older versions ignore the extra fields).

**Rollback:** Two files revert. Lockfile entries remain.

---

### C4 — `feat(plugins): upgrade command (no-op detection + git/local rebuild)`

**Files:** `src/core/plugins/upgrade.ts` (new), `packages/host/src/api/plugins/upgrade.ts` (new), `src/core/cli.ts` (`cmdPluginsUpgrade`), inline smoke tests

**Changes:**

`src/core/plugins/upgrade.ts`:
```ts
export interface UpgradeOptions { yes?: boolean }
export interface UpgradeResult {
  id: string
  before: { version: string; commitSha: string }
  after: { version: string; commitSha: string }
  noop: boolean
  permissionsWidened: boolean
  awaitingConsent: boolean   // true if widened && !opts.yes && no TTY
}

export async function upgradePlugin(id: string, opts: UpgradeOptions = {}): Promise<UpgradeResult>
```

Internal flow per spec §4.2 (github + local branches). Helpers:
- `computeSourceTreeSha(dir): Promise<string>` — walks dir, skips `node_modules/dist/.git`, hashes file paths + contents in sorted order (stable Merkle)
- `gitFetchAndFastForward(dir, ref): Promise<{ from: string; to: string }>` — throws on divergence
- `readManifestSha(dir): string` — sha256 of `bakin-plugin.json`

`packages/host/src/api/plugins/upgrade.ts`:
- POST handler validates `{ pluginId, yes? }`, delegates to `upgradePlugin`, surfaces result. Core guard via `isCorePlugin` (C2).

`src/core/cli.ts` `cmdPluginsUpgrade(id, opts)`:
- POSTs to `/api/plugins/upgrade` with `{ pluginId: id, yes: opts.yes }`
- If `awaitingConsent`, the API returns `{ needsConsent: true, newPermissions: Permission[], from: string, to: string }` — CLI then runs the consent prompt locally (consent prompt module itself lands in C9; at C4, surface a placeholder message `"Permission diff: <list>. Re-run with --yes to confirm."` and exit non-zero. C9 wires the actual prompt)
- On success: print spec §4.2 success message
- On no-op: print "already up to date"
- Plumb `--yes` flag in CLI arg parser

`USAGE` text update (in `cli.ts`) — add `plugins upgrade <id> [--yes]` line.

**Tests:** Inline smoke (`tests/plugins/lifecycle/upgrade-smoke.test.ts`) — local-path no-op detection + happy path. Full integration in C10.

**Acceptance:**
- [ ] `bakin plugins upgrade <github-plugin>` against a hermetic bare repo with no new commits prints "already up to date"
- [ ] After pushing a commit to that bare repo, upgrade detects sha drift, fast-forwards, rebuilds, updates lockfile (`upgradedAt`, new `commitSha`, new `version`, new `manifestSha`)
- [ ] Local-path upgrade with unchanged source dir → no-op
- [ ] Local-path upgrade with missing source dir → CLI exits with the spec's exact error message
- [ ] Force-pushed remote → fast-forward fails with the exact spec error
- [ ] Core plugin upgrade refused (relies on C2)

**Verification:**
```bash
bun test --isolate tests/plugins/lifecycle/upgrade-smoke.test.ts
bunx tsc --noEmit -p tsconfig.app.json
```

**Complexity:** **L.** ~200 lines new code + non-trivial git interaction. Largest single feature commit.

**Risk:** Medium. Git error paths are subtle (force-push detection via `git merge-base --is-ancestor`). Local source-tree hashing must be deterministic across platforms.

**OPEN QUESTION:** Should the source-tree sha use file mtimes? **Resolution: NO.** Mtimes vary across copies; use only path+content. Captured here so build doesn't re-decide.

**Rollback:** Three files revert + USAGE text revert. Lockfile entries written by upgrade keep their `upgradedAt` field — harmless (it's optional in the schema).

---

### C5 — `feat(plugins): list --check + lastChecked staleness hint`

**Files:** `src/core/plugins/upgrade.ts` (export `checkUpgradeAvailable`), `packages/host/src/api/plugins/manifest.ts`, `src/core/cli.ts` (`--check` flag)

**Changes:**

`src/core/plugins/upgrade.ts` — add:
```ts
export async function checkUpgradeAvailable(id: string): Promise<{
  upgradeAvailable: boolean
  remoteHeadSha?: string
  sourceTreeSha?: string
  lastChecked: string
}>
```
- Github: `git ls-remote <remote> <ref>` → compare to lockfile `commitSha`
- Local: walk source dir, compute tree sha → compare to lockfile `sourceTreeSha`
- Persist `remoteHeadSha`/`sourceTreeSha` + `lastChecked` to lockfile via `updatePlugin`

`packages/host/src/api/plugins/manifest.ts`:
- `manifest()` (existing GET) — populate `upgradeAvailable` and `staleHintDays` from current lockfile values (no network call here)
- New: `manifestCheck()` (GET handler at `/api/plugins/manifest?check=1`) — runs `checkUpgradeAvailable` for every user plugin in parallel, returns the same shape

`src/core/cli.ts` `cmdPluginsList`:
- Parse `--check` flag
- If set, call `/api/plugins/manifest?check=1`
- STATUS column rendering (per spec §4.4):
  - `installed.commitSha === installed.remoteHeadSha` → `"up to date (checked <relative>)"`
  - `installed.commitSha !== installed.remoteHeadSha` → `"upgrade available"` (we don't have remote `version` cheaply; per spec, we mark availability without showing target version. Sub-decision below.)
  - `lastChecked > 7 days ago` → `"(last checked N days ago — run with --check)"`
  - `lastChecked` absent → `"(never checked — run with --check)"`

**OPEN QUESTION:** Spec §4.4 example shows `"upgrade available (1.3.0)"`. To get that target version we need to read the remote manifest, not just `git ls-remote`. **Resolution: drop the version from the marker** in plain `list`; it's only known after the actual upgrade run. Show `"upgrade available"` without the version. Rationale: cheaper detection (`git ls-remote` only); the user runs `bakin plugins upgrade <id>` to see the version diff. If the user wants to know the target version cheaply, future ticket adds `--check --verbose` that does fetch the remote manifest.

**Tests:** Inline smoke for `checkUpgradeAvailable` against a hermetic bare repo. Full coverage in C10.

**Acceptance:**
- [ ] `bakin plugins list --check` updates `lastChecked` + `remoteHeadSha`/`sourceTreeSha` in the lockfile
- [ ] After a remote commit, `--check` flips STATUS to `upgrade available`
- [ ] Plain `bakin plugins list` shows the staleness hint when `lastChecked` is older than 7 days

**Verification:**
```bash
bun test --isolate tests/plugins/lifecycle
bunx tsc --noEmit -p tsconfig.app.json
```

**Complexity:** **M.** ~100 lines across 3 files.

**Risk:** Low. Network errors during `--check` should surface per-plugin (one plugin's network failure shouldn't blank the whole list). Wrap each `checkUpgradeAvailable` in `try { ... } catch { return { upgradeAvailable: false, error: e.message } }` and let the CLI display the error inline.

**Rollback:** Three files revert. Lockfile entries' new fields (`lastChecked`, `remoteHeadSha`, `sourceTreeSha`) sit unused — harmless.

---

### C6 — `feat(plugins): hook + exec-tool unregister-by-plugin APIs + search purgeContentType`

**Files:** `packages/core/src/hooks/hook-registry.ts`, `scripts/lib/registry.ts`, `src/core/search-registry.ts`, `src/lib/plugin-registry.ts` (wire pluginId capture into `ctx.hooks.register`)

**Changes:**

`packages/core/src/hooks/hook-registry.ts`:
- Internal storage moves from `Map<string, HookHandler[]>` to `Map<string, Array<{ handler: HookHandler; pluginId: string | null }>>`
- `register(name, handler)` — keeps existing signature; stores `pluginId: null` for direct callers (core modules)
- New: `register(name, handler, pluginId)` overload for plugin-context registration
- New: `unregisterByPlugin(pluginId: string): number` — sweeps all handlers where `pluginId` matches, returns count
- Existing `call/callAll/invoke/has/clearAll` operate on the new shape (extract `.handler` to invoke)

`src/lib/plugin-registry.ts`:
- The per-plugin `ctx.hooks.register` wrapper (created during plugin activation) now captures the plugin's `id` and forwards: `(name, handler) => hookRegistry.register(name, handler, plugin.id)`

`scripts/lib/registry.ts`:
- New: `removeExecToolsByPlugin(pluginId: string): number`
  ```ts
  const prefix = `bakin_exec_${pluginId}_`
  let removed = 0
  for (const name of [...execTools.keys()]) {
    if (name.startsWith(prefix)) { execTools.delete(name); removed++ }
  }
  return removed
  ```

`src/core/search-registry.ts`:
- New: `purgeContentType(name: string): Promise<number>` — calls Antfly's bulk delete (`db.exec(\`DELETE FROM bakin_${name}\`)`); when antfly disabled, return 0. Drop the registration from the in-memory content-type map. Returns row count.

**Tests:** Three smoke tests inline:
- `tests/plugins/lifecycle/hook-unregister-smoke.test.ts` — register from two pluginIds, sweep one
- `tests/plugins/lifecycle/exec-tool-prefix-smoke.test.ts` — prefix filter
- `tests/plugins/lifecycle/search-purge-smoke.test.ts` — register content type, insert rows (against in-memory antfly stub), purge

Full coverage in C10.

**Acceptance:**
- [ ] `hookRegistry.unregisterByPlugin('plugin-a')` removes only `plugin-a`'s handlers; `plugin-b`'s handlers still fire on `call(...)`
- [ ] `removeExecToolsByPlugin('foo')` removes `bakin_exec_foo_*` only
- [ ] `purgeContentType('mytype')` returns row count and `bakin_mytype` is empty afterward
- [ ] No regressions in existing hook/search tests

**Verification:**
```bash
bun test --isolate
bunx tsc --noEmit -p tsconfig.app.json
```

**Complexity:** **M.** Hook registry refactor is the trickiest piece (must preserve backward compat with the existing `register(name, handler)` two-arg call sites everywhere in core).

**Risk:** Medium. Hook handler shape change touches every existing caller. Mitigation: `register` keeps two-arg signature working (third arg defaults to `null`); only the per-plugin wrapper passes the third arg.

**Rollback:** Four files revert. Hook handlers still fire (the new internal shape is backward-compatible).

---

### C7 — `feat(plugins): onUninstall hook + full teardown sweep`

**Files:** `packages/core/src/plugin-types.ts`, `packages/host/src/api/plugins/remove.ts`, `src/core/onboarding/plugin-assets.ts` (`removePluginAssets`), `src/core/plugins/uninstall-snapshot.ts` (new)

**Changes:**

`packages/core/src/plugin-types.ts`:
- Add `onUninstall?(ctx: PluginContext): void | Promise<void>` to `BakinPlugin` per spec §3.2

`src/core/onboarding/plugin-assets.ts`:
- Add `removePluginAssets(pluginId: string): Promise<{ removed: number; kept: number; removedDirs: string[] }>` per spec §3.6
- Uses the runtime adapter skill API, reads each `.installedBy`, filters by `pluginId`, checks for `.userEdited` sentinel, removes or keeps accordingly

`src/core/plugins/uninstall-snapshot.ts` (new):
- Implements `snapshotUninstall` per spec §3.7
- Uses Bun's `Bun.spawn(['tar', '-czf', ...])` (or Node's `tar` package — pick whichever is already in deps; check `package.json`)
- Writes to `<final>.tmp-<pid>-<ts>` then renames

**OPEN QUESTION:** What tar implementation? **Resolution: shell out to `tar` via `Bun.spawn`** — already a system dependency, no new npm dep. Linux/macOS both have it. Documented in spec §3.7 boundary.

`packages/host/src/api/plugins/remove.ts` rewrite:
- Body validation (existing)
- Core guard (already there from C2)
- Look up plugin in registry → call `plugin.onUninstall(ctx)` if defined; wrap in try/catch that logs `log.error('plugin onUninstall failed', err, { pluginId })` + `appendAudit({ kind: 'plugin.uninstall.error', pluginId, error: msg })`
- Compute target paths (plugin dir, optional settings file)
- `const skillResult = await removePluginAssets(pluginId)` — but defer the actual `rm` until after snapshot. Refactor `removePluginAssets` to return *plans* (`{ toRemove: string[], toKeep: string[] }`) so we can snapshot the to-remove dirs before deleting.
- Snapshot via `snapshotUninstall({ pluginId, pluginDir, settingsFile, removedSkillDirs: plan.toRemove })` → returns final tarball path
- Registry sweep:
  ```ts
  const ctx = pluginRegistry.getContext(pluginId)
  hookRegistry.unregisterByPlugin(pluginId)
  removeExecToolsByPlugin(pluginId)
  unregisterPluginNodeTypes(pluginId)
  unregisterPluginNotificationChannels(pluginId)
  unregisterPluginHealthChecks(pluginId)
  for (const ct of pluginRegistry.getContentTypes(pluginId)) {
    await ctx.search.purgeContentType(ct.name)
  }
  ```
- Filesystem deletes: skills (now safe — snapshotted), settings file, plugin dir
- Lockfile: `removePlugin(lock, id)` + write
- Response shape:
  ```ts
  {
    ok: true,
    id,
    skills: { removed: number; kept: number },
    snapshot: string,           // absolute path to tarball
    message: 'Removed ...; restart to release modules.'
  }
  ```

`src/core/cli.ts` `cmdPluginsRemove`:
- Update to consume the new response shape; render the spec §4.3 multi-line output

**Tests:** Inline smoke (`tests/plugins/lifecycle/remove-smoke.test.ts`) — happy path teardown + onUninstall error survives. Full coverage in C10.

**Acceptance:**
- [ ] Removing a fixture plugin invokes `plugin.onUninstall(ctx)`
- [ ] Tarball lands at `~/.bakin/.uninstalled/<id>-<ISO>.tar.gz` and contains plugin dir + settings + filtered skills
- [ ] Plugin dir gone from `~/.bakin/plugins/`
- [ ] Settings JSON gone from `~/.bakin/plugin-settings/`
- [ ] runtime skills owned by plugin are gone (except `.userEdited` ones — assert kept count)
- [ ] Lockfile entry gone
- [ ] Hook handlers, exec tools, workflow nodes, channels, health checks, search content types all unregistered (assert via post-state inspection)
- [ ] `onUninstall` throwing does NOT block any cleanup step

**Verification:**
```bash
bun test --isolate tests/plugins/lifecycle/remove-smoke.test.ts
bunx tsc --noEmit -p tsconfig.app.json
# Manual: install fixture, remove, inspect ~/.bakin/.uninstalled/, untar to verify contents
```

**Complexity:** **L.** Heaviest commit. Touches the most surfaces. Orchestration order matters.

**Risk:** Medium-High. Each registry unregister API has its own quirks. If `pluginRegistry.getContext(pluginId)` returns null (plugin never activated successfully), we still need to clean lockfile + dir — guard this case.

**Rollback:** Four files revert. New tarball file in `~/.bakin/.uninstalled/` from any test run is harmless leftover.

---

### C8 — `feat(plugins): permissions Zod enum + audit log on activate`

**Files:** `packages/core/src/plugins/permissions.ts` (new), `packages/core/src/plugins/lockfile.ts` (tighten `permissions` field to use enum), `src/lib/plugin-registry.ts` (audit log on activate), `packages/host/src/api/plugins/install.ts` and `src/core/plugins/upgrade.ts` (validate manifest permissions)

**Changes:**

`packages/core/src/plugins/permissions.ts`:
- Implements spec §3.3 — `PermissionSchema` (Zod enum), `PERMISSION_DESCRIPTIONS`, `newPermissions(prev, next)`
- Add `suggestPermission(unknown: string): string | null` — Levenshtein within edit-distance ≤ 2 against the enum values; for "did you mean…" suggestions

`packages/core/src/plugins/lockfile.ts`:
- Replace `permissions: z.array(z.string())` with `permissions: z.array(PermissionSchema)` — now strict

`src/lib/plugin-registry.ts`:
- After `plugin.activate(ctx)` succeeds, append audit + log line per spec §4.5:
  ```ts
  appendAudit({ kind: 'plugin.activate', pluginId, version, permissions, source })
  log.info('plugin activated', { pluginId, version, permissions, source })
  ```
- `source` derived from: `isCorePlugin(id)` ? `'core'` : `lockfile.plugins[id].type`

`packages/host/src/api/plugins/install.ts` and `src/core/plugins/upgrade.ts`:
- Manifest parse extended with `permissions: z.array(PermissionSchema).default([])`
- On Zod failure, before returning the generic "Invalid bakin-plugin.json", catch the permissions issue and produce a helpful message: `"Unknown permission '<x>' in bakin-plugin.json. Did you mean '<suggestion>'?"` — uses `suggestPermission`

**Tests:** Inline smoke (`tests/plugins/lifecycle/permissions-smoke.test.ts`) — enum accept/reject + diff. Full coverage in C10.

**Acceptance:**
- [ ] `audit.jsonl` gets a `plugin.activate` entry per plugin per boot, with permissions list
- [ ] `server.log` shows the same info-level line
- [ ] Installing a plugin whose manifest has an unknown permission fails with a "did you mean" suggestion when within edit-distance 2
- [ ] Existing core plugins activate successfully — their manifests already use only the 4 valid permissions
- [ ] Empty/missing `permissions` normalized to `[]`; audit line shows `(requests: none)` rendering

**Verification:**
```bash
bun test --isolate
bunx tsc --noEmit -p tsconfig.app.json
# Manual: bun run dev:mock; tail -f ~/.bakin/audit.jsonl | jq 'select(.kind=="plugin.activate")'
```

**Complexity:** **M.** ~100 lines new code + a few targeted edits.

**Risk:** Low — only failure mode is rejecting a manifest with a typo'd permission, and that's the desired behavior. Audit logging is fire-and-forget.

**Rollback:** Four files revert. Audit log lines that landed during the experiment stay (harmless append-only).

---

### C9 — `feat(plugins): install/upgrade consent prompt`

**Files:** `src/core/plugins/consent-prompt.ts` (new), `src/core/cli.ts` (wire prompt into `cmdPluginsInstall` and `cmdPluginsUpgrade`), `packages/host/src/api/plugins/install.ts` and `src/core/plugins/upgrade.ts` (return `needsConsent` shape so CLI can prompt locally)

**Changes:**

`src/core/plugins/consent-prompt.ts`:
```ts
export interface PromptIO {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
}

export interface InstallConsentInput {
  pluginId: string
  version: string
  permissions: Permission[]
  io?: PromptIO       // defaults to process.stdin/stdout; tests inject fakes
  yes?: boolean       // short-circuits to true
}

export interface UpgradeConsentInput {
  pluginId: string
  fromVersion: string
  toVersion: string
  newPermissions: Permission[]   // computed via newPermissions() — only the added ones
  io?: PromptIO
  yes?: boolean
}

export async function promptInstallConsent(input: InstallConsentInput): Promise<boolean>
export async function promptUpgradeConsent(input: UpgradeConsentInput): Promise<boolean>
```

Internal: render the spec §4.1 / §4.2 exact text. Read one line from stdin, accept `y`/`Y` only; everything else returns false.

`src/core/cli.ts`:
- `cmdPluginsInstall` — before sending to API, fetch the manifest first (the API can return a `dryRun` flag that returns the parsed manifest without writing). Or simpler: change install API to two-phase — `POST /api/plugins/install/preflight { source, type } → { manifest, needsConsent: true }`; CLI runs prompt; if accepted, `POST /api/plugins/install { source, type, accepted: true }`.

  **OPEN QUESTION:** Two-phase API vs CLI-fetches-manifest-first vs server-side-prompt-via-SSE? **Resolution: two-phase API.** Cleanest separation; API stays HTTP-pure; CLI handles all interactive concerns. Adds one new endpoint (`/api/plugins/install/preflight`) but keeps the existing one's contract clean. Captured here so build doesn't re-decide.

- `cmdPluginsUpgrade` — call `/api/plugins/upgrade/preflight` first, get `{ needsConsent, fromVersion, toVersion, newPermissions }`, run prompt locally, then call the actual upgrade endpoint with `accepted: true`

`packages/host/src/api/plugins/install.ts`:
- Split into `preflight` and `commit` handlers (export `preflight` and `post`); existing path becomes `commit` semantically

`packages/host/src/api/plugins/upgrade.ts`:
- Same split

**Tests:** Inline smoke for `consent-prompt.ts` (fake stdio). Full coverage in C10.

**Acceptance:**
- [ ] `bakin plugins install <fixture-with-permissions>` shows the consent prompt with all permissions; pressing `n` aborts cleanly with no lockfile entry
- [ ] `bakin plugins install --yes <fixture>` skips prompt
- [ ] `bakin plugins upgrade <fixture>` with unchanged permissions shows no prompt
- [ ] `bakin plugins upgrade <fixture>` after author adds a new permission shows the diff prompt with only the added permissions
- [ ] `bakin plugins upgrade --yes` skips prompt
- [ ] Aborted install/upgrade: lockfile not mutated, plugin dir not changed, no orphan files

**Verification:**
```bash
bun test --isolate
bunx tsc --noEmit -p tsconfig.app.json
# Manual: install a fixture plugin requesting storage.write + events.emit; verify prompt copy matches spec exactly
```

**Complexity:** **L.** ~150 lines new code + non-trivial endpoint split.

**Risk:** Medium. Two-phase install/upgrade endpoints introduce a "preflight then commit" pattern that has its own failure modes (preflight succeeds, user takes 5 minutes to decide, commit fails because source changed). For now, accept that: the user can re-run.

**Rollback:** Four files revert (consent-prompt.ts, cli.ts, install.ts, upgrade.ts). Install/upgrade revert to non-prompting flow.

---

### C10 — `test(plugins): lifecycle integration + unit coverage`

**Files:** Everything under `tests/plugins/lifecycle/` per the Critical Files table (#18-#30) + `tests/fixtures/plugins/` (#31-#32)

**Changes:**

This commit replaces the smoke tests scattered across C1-C9 with the full layered test suite from spec §7.

Key infrastructure:
- `tests/fixtures/plugins/hermetic-git.ts` — git helpers using `execFileSync('git', [...], { cwd })`. Skip with clear message if `git` not on PATH (`which git` fails)
- `tests/fixtures/plugins/fixture-plugins/minimal/` — `bakin-plugin.json` (`{ id: 'fixture-minimal', name: 'Minimal', version: '0.1.0', entry: { server: 'index.ts' }, permissions: [] }`) + `index.ts` (`export default { activate() {} } as BakinPlugin`)
- `tests/fixtures/plugins/fixture-plugins/with-permissions/` — same shape, `permissions: ['storage.write', 'events.emit']`
- `tests/fixtures/plugins/fixture-plugins/with-skills/` — same shape, plus `defaults/runtime-skills/example/SKILL.md`

Each test file follows CLAUDE.md isolation:
- Mock `getContentDir` (both paths) → temp dir
- Mock `getOpenClawHome` → temp dir
- Mock logger (no-op)
- Mock watcher (no-op)
- Mock the active runtime boundary (`ctx.runtime` or `src/core/runtime-registry`) with in-memory state
- `process.env.BAKIN_HOME` + `OPENCLAW_HOME` set BEFORE imports
- `afterAll(() => rmSync(testDir, { recursive: true, force: true }))`

Coverage matrix per spec §7:

| Layer | Test file | Covers |
|---|---|---|
| A | `lockfile.test.ts` | Schema accept/reject, atomic IO, all mutators, core-plugin reject |
| A | `permissions.test.ts` | Enum accept/reject, `newPermissions` diff, `suggestPermission` edit-distance |
| A | `uninstall-snapshot.test.ts` | Snapshot+extract verify, atomic temp cleanup, missing-settings handled |
| A | `consent-prompt.test.ts` | `--yes` short-circuit, `n`/empty rejects, exact prompt text |
| A | `is-core-plugin.test.ts` | Predicate stable across init |
| B | `hook-unregister-by-plugin.test.ts` | Plugin-scoped sweep correctness |
| B | `exec-tools-remove-by-plugin.test.ts` | Prefix filter, idempotent |
| B | `search-purge-content-type.test.ts` | Bulk delete + content-type unregister; antfly-disabled no-op |
| C | `install-flow.integration.test.ts` | Local + hermetic-github → lockfile shape correct |
| C | `upgrade-flow.integration.test.ts` | Push+upgrade, no-op short-circuit, force-push error, local resync, missing-source error, widened-perms prompt |
| C | `remove-flow.integration.test.ts` | Full teardown, tarball, `.userEdited` honored, `onUninstall` error survives |
| C | `core-plugin-guard.test.ts` | Both endpoints + lockfile mutators reject |
| C (gated) | `github-smoke.e2e.test.ts` | `BAKIN_E2E_GITHUB=1` against public read-only fixture |

Smoke tests from C1-C9 are deleted in this commit (their coverage is subsumed by the full files).

**Acceptance:**
- [ ] Full `bun test --isolate` passes
- [ ] Every new public function from C1-C9 has at least 1 happy + 1 error test
- [ ] No test touches real `~/.bakin/` or `~/.openclaw/`
- [ ] `BAKIN_E2E_GITHUB=1 bun test --isolate tests/plugins/lifecycle/github-smoke.e2e.test.ts` passes (manual verification before merge)
- [ ] Test runtime stays under ~30s for the lifecycle suite (hermetic git is fast)

**Verification:**
```bash
bun test --isolate                                                      # full suite
bun test --isolate tests/plugins/lifecycle                              # this PR's tests
BAKIN_E2E_GITHUB=1 bun test --isolate tests/plugins/lifecycle/github-smoke.e2e.test.ts
bunx tsc --noEmit -p tsconfig.app.json
```

**Complexity:** **L.** ~1,500 lines of test code across 13 files.

**Risk:** Low — purely additive. The risk is in *not* having tests; this commit removes that risk.

**Rollback:** All test files revert. The smoke tests deleted in this commit must be restored if rolling back.

---

### C11 — `docs(plugins): update knowledge + plugin-authoring + follow-up issues`

**Files:** `.claude/knowledge/plugin-system.md`, `docs/plugin-authoring.md`, `CLAUDE.md`

**Changes:**

`.claude/knowledge/plugin-system.md`:
- New section "Lifecycle" covering: lockfile contract (`~/.bakin/plugins/lock.json` with full schema reference), `onUninstall` hook semantics, registry teardown ordering, permissions enforcement layers (current state: 1+2 active, 3 deferred), consent prompt flow, list output schema with column meanings
- Cross-link to spec + plan files

`docs/plugin-authoring.md`:
- New subsection on `onUninstall(ctx)` — when to use it, error policy, what to clean (data outside plugin dir), what NOT to clean (Bakin handles plugin dir + settings + registry rows)
- Permissions taxonomy reference — list the 4 current values + descriptions; note that new permissions ship with the capability that needs them
- Brief note on the lockfile (read-only — authors don't touch it but should know it exists for debugging)

`CLAUDE.md`:
- §Plugin System — update to mention the upgrade command and the lifecycle commands surface
- §Key Patterns — add a one-liner on the install lockfile primitive
- Don't bloat — these are pointers to the knowledge doc

**Filing follow-up issues:** at this commit, file the 6 follow-up issues from spec §10 via `gh issue create`. Capture the URLs and inline them in the PR description (which gets composed at the PR-open step, not as a commit). Keep the issue titles + bodies aligned with the spec text.

**Tests:** None.

**Acceptance:**
- [ ] `.claude/knowledge/plugin-system.md` Lifecycle section reads accurately against landed code
- [ ] `docs/plugin-authoring.md` has working examples that match the actual interfaces
- [ ] CLAUDE.md updates are minimal and accurate
- [ ] All 6 follow-up issues exist on GitHub with accurate titles/bodies
- [ ] PR description (drafted in this commit's accompanying notes, not committed) lists the 6 follow-ups + closes #151, #119, #142

**Verification:**
- Read all three docs end-to-end against the landed code
- Open each created GitHub issue and verify the body
- Confirm CLAUDE.md still under its current line budget (no bloat)

**Complexity:** **S.** Mechanical doc work + 6 issue creations.

**Risk:** Low. Stale docs are the only failure mode; mitigated by reading against landed code.

**Rollback:** Three files revert. Filed follow-up issues stay open (delete manually if rollback is full-PR).

---

## Verification Across All Commits

After each commit:
```bash
bun test --isolate                                  # full suite, no regressions
bunx tsc --noEmit -p tsconfig.app.json              # type-check
```

After C10 specifically:
```bash
bun test --isolate tests/plugins/lifecycle          # focused suite
BAKIN_E2E_GITHUB=1 bun test --isolate tests/plugins/lifecycle/github-smoke.e2e.test.ts
```

Before opening the PR:
```bash
bun run typecheck                                   # confirm exact name in package.json
bun run build                                       # full binary build clean
bun run dev:mock                                    # full visual sweep
# Manual checklist:
#   - bakin plugins install <fixture-from-tests/fixtures>  → consent prompt fires
#   - bakin plugins list                                   → new column layout
#   - bakin plugins list --check                           → lastChecked populated
#   - bakin plugins upgrade <id>                           → success message
#   - bakin plugins remove <id>                            → multi-line output with skill counts + tarball path
#   - bakin plugins remove tasks                           → refused with core-plugin error
#   - cat ~/.bakin/audit.jsonl | jq 'select(.kind=="plugin.activate")'  → activation entries present
#   - ls ~/.bakin/.uninstalled/                            → tarball lands
```

## Definition of Done

- [ ] All 11 commits on `feat/plugin-lifecycle` (C1-C9 features + C10 tests + C11 docs)
- [ ] Each commit individually compiles, type-checks, and passes `bun test --isolate`
- [ ] Full test suite passes — including the new lifecycle tests
- [ ] Manual smoke against `bun run dev:mock` for all CLI surfaces (install/upgrade/list/remove)
- [ ] `~/.bakin/plugins/lock.json` round-trips through install→list→upgrade→remove
- [ ] `BAKIN_E2E_GITHUB=1` smoke test passes against the public read-only fixture repo
- [ ] `.claude/knowledge/plugin-system.md` updated; `docs/plugin-authoring.md` updated; `CLAUDE.md` updated
- [ ] 6 follow-up issues filed: signature verification, tarball retention, perms layer 3, ref-pinning, import/export, hot-reload
- [ ] PR description references #151, #119, #142 (closes) + lists the 6 follow-ups
- [ ] PR description includes a "what changed from a user's perspective" section + the new CLI surface table
- [ ] No new dependencies in `package.json` (we shell out to `git` and `tar`)
- [ ] No env var additions
- [ ] No schema migrations to existing `~/.bakin/` files (only the new `plugins/lock.json` is introduced)

## Rollback Story

| Revert | Result |
|---|---|
| Just C11 | Code identical; only the new doc sections + filed issues remain. Issues can be closed manually. |
| Just C10 | Tests vanish; smoke tests from C1-C9 are gone. Code still works but coverage drops. **Don't ship without C10.** |
| Just C9 | Consent prompt absent. Install/upgrade work without prompting; permissions still recorded in lockfile. Audit logging from C8 still active. |
| Just C8 | Permissions enum gone — lockfile field reverts to `z.array(z.string())` (need to revert the C1 schema tightening too if you want strict validation off). Audit log on activate gone. |
| Just C7 | Remove flow reverts to "delete plugin dir only" — orphans return. Tarballs not produced. C6 APIs sit unused. |
| Just C6 | Hook unregister-by-plugin gone, exec-tool prefix removal gone, search purge gone. C7 fails because it depends on these — paired revert. |
| Just C5 | `--check` flag gone; lockfile fields `lastChecked`/`remoteHeadSha`/`sourceTreeSha` sit unused (harmless). Plain `list` still works (status column shows neutral). |
| Just C4 | `bakin plugins upgrade` gone — exit `cmd not found`. Install/remove still work. List shows STATUS column but every entry stays at "up to date" forever. |
| Just C3 | List reverts to 3-column output. Other commands work. |
| Just C2 | Core guard gone — `bakin plugins remove tasks` would actually delete the core plugin source! **Critical safety commit.** Don't revert without also reverting C4 and C7. |
| Just C1 | Lockfile module gone; install/upgrade/remove all break (each tries to read/write the lockfile). Full chain revert needed. |
| Full revert (C1-C11) | Codebase identical to pre-PR state. `~/.bakin/plugins/lock.json` and `~/.bakin/.uninstalled/*` files left in user dirs as harmless leftovers. |

**No destructive operations** in any commit:
- No file deletions outside the plugin's own dirs
- No schema migrations
- No env var additions or removals
- No new npm dependencies (shell out to `git` and `tar`)
- No build pipeline changes
- No removal of any existing API endpoint

## Open Micro-Decisions (settle during build)

1. **Tar implementation choice** — use `Bun.spawn(['tar', '-czf', ...])`. **(Resolved here, not deferred.)**
2. **`upgrade --check` showing target version** — drop from plain `list`; only the upgrade run knows the version. **(Resolved in C5 OPEN QUESTION.)**
3. **Two-phase install/upgrade endpoints** — preflight + commit. **(Resolved in C9 OPEN QUESTION.)**
4. **Source-tree sha includes mtimes?** — No. Path + content only. **(Resolved in C4 OPEN QUESTION.)**
5. **Consent prompt rendering style** — match the exact spec text verbatim; no color codes (terminals vary). Settle column alignment during C9 build by visual feel.
6. **Audit log line format** — JSON line via `appendAudit`; rendered string in `server.log` per existing logger pattern. No new format invention.
7. **Fixture repo creation timing** — set up `madeinwyo/bakin-plugin-fixture-readonly` before C10 tests. Single commit, no future changes.

None block C1.

## Notes for the Build Phase

- Build commits in **strict order**. Do not merge C7 before C6 even if "you have time" — the dependency graph is real.
- Each commit should land with its **smoke test** (where called out) so bisect remains useful. The full test commit (C10) replaces those smokes with comprehensive coverage.
- When mirroring `agent-packages/lockfile.ts` style, copy the **docblock voice** — terse, directive, focused on *why* the IO pattern is what it is. Don't restate the schema in prose.
- The two-phase install/upgrade endpoints are the most novel architectural change. Land C9 with a clear commit message explaining the preflight pattern.
- Manual smoke testing (`bun run dev:mock`) is required before opening the PR — the CLI surfaces have visual rendering that no automated test verifies.
