# SPEC — Plugin Architecture v2: Extraction + Hot-Reload

**Status:** Draft for review (kickoff phase, pre-plan)
**Owner:** @markhayden
**Bundles:** Plugin extraction (messaging, projects → `bakin-bits-official`), monorepo install (`#subpath`), `bakin plugins link`, server-side hot-reload, onboard suggest flow
**Companion plan:** `.claude/specs/plugin-extraction-and-hotreload-plan.md` (next phase)
**Related issues:** #174 (architectural inversion follow-ups), #175 (lint rule for top-level side effects)

---

## 1. Objective

Make Bakin's plugin architecture **load-bearing for third parties**. Today the plugin lifecycle (install, upgrade, remove, settings) ships and works in tests, but **no plugin maintained by the bakin team actually exercises the third-party install path.** The contract is theoretical.

This work makes it concrete:

1. **Establish a clear feature-module / plugin distinction.** Eight `plugins/*` directories are structurally part of Bakin (core can import from them, they're always present, they aren't optional). Two — `messaging` and `projects` — are bundled-but-optional. Extract those two to `markhayden/bakin-bits-official` and turn them into the first real third-party plugins.

2. **Build the developer experience that makes plugin authoring viable.** A `bakin plugins link <source>` command that symlinks a plugin directory into `~/.bakin/plugins/`, watches it, and hot-reloads the server-side and client-side independently when the source changes. No restart-required loop. This dogfoods the install/upgrade/remove path and forces every gap to surface.

3. **Surface official plugins through onboarding.** A curated list lives in bakin source (`src/core/onboarding/recommended-plugins.ts`). During `bakin onboard`, the user sees an interactive prompt (Ink-based TUI) to select which official plugins to install. No discovery, no marketplace — just the curated list maintained by the bakin team.

4. **Lock in a layering policy.** Document the rule: core may import from `plugins/*` (named feature modules); core MUST NOT import from `~/.bakin/plugins/*` (third-party plugins). Add a fitness test that fails if the rule is broken.

**Single user, this machine.** Bakin runs macOS-only (CLAUDE.md). No backwards-compatibility shims; we own every consumer of the surface we're changing. Reduce tech debt is the priority.

---

## 2. Out of Scope (cut from this PR series — follow-up issues filed/exist)

| Cut | Reason | Follow-up |
|-----|--------|-----------|
| Plugin marketplace / search / discovery | Curated list in bakin source covers official plugins. Community marketplace is its own design tree (auth, ratings, security review, etc.). | New issue: "feat(plugins): community marketplace" |
| Auto-update of installed plugins | Already shipped (`bakin plugins upgrade`). No change here. | None |
| Worker-isolated plugin runtime | Considered (Q3.2 option C). Rejected — months of context-API rewrite for a feature that's primarily about dev experience. | None planned |
| Plugin version pinning by ref (`#tag`, `#sha`) on install | Existing `bakin plugins install` already supports `--ref` (per #170). Confirm + document; no new work. | Confirm existing |
| Cross-plugin hook contract during reload (avoid `undefined` window) | Hook returning `undefined` during teardown window is already a thing in install/uninstall. Hot reload makes it more frequent in dev only. Document, don't engineer around. | Documented in plugin authoring docs |
| Antfly schema migration during dev hot-reload | Schema changes require server restart in v1. Most plugin iteration is on handlers/UI, not schemas. | New issue if real users hit this |
| Mandatory `onShutdown` enforcement at the type level | Q3.7 — plugins without side effects shouldn't have to ship empty stubs. Documented contract + lint rule are sufficient. | #175 (lint rule) |

---

## 3. Architecture: feature modules vs plugins

### 3.1 The category clarification

Today every `plugins/*` directory is treated as "a plugin." After this work, the codebase distinguishes:

- **Core feature modules** — directories under `plugins/` that ship with Bakin, are always activated, and that core code MAY import from. These are **structurally part of Bakin**:
  - `team`, `tasks`, `workflows`, `health`, `memory`, `assets`, `schedule`, `models` (8 modules)
  - Core can import from them. They aren't optional. Layering rule: ✅
  - **Naming nit:** keep them in `plugins/` for now. Renaming the directory is a much bigger refactor (build pipeline, docs, all import paths). Document the policy instead.

- **Third-party plugins** — directories under `~/.bakin/plugins/<id>/` that the user installed via `bakin plugins install`. Optional. Replaceable. Core MUST NOT import from these:
  - Today: zero (the path is theoretical).
  - After this work: `messaging`, `projects` (extracted from current `plugins/` to `bakin-bits-official`), plus any future user-installed plugins.

### 3.2 The "always import via the SDK" rule for plugins

Every plugin (feature module OR third-party) imports its plugin-author surface from `@bakin/sdk` (re-exports through `@bakin/sdk/types`, `@bakin/sdk/components`, etc.). The path-aliased imports (`@/core/...`, `@bakin/team/...`) are reserved for core feature modules that have core-coupling needs documented in CLAUDE.md.

Third-party plugin authors clone NEITHER bakin nor bakin-bits-official; they `bun add @bakin/sdk` and go.

### 3.3 The four remaining `core → plugin` couplings (issue #174)

Out of scope for this work, but worth listing here for clarity. After the messaging+projects extraction:
- `src/core/agents.ts:10` → `plugins/tasks/lib/flow-store` (core agent listing reads taskboard)
- `src/core/agent-packages/installer.ts:72` → `plugins/team/lib/openclaw-adapter` (installer adds OpenClaw agents via team)
- `src/core/agent-packages/uninstaller.ts:32` → `plugins/team/lib/openclaw-adapter`
- `cli/bakin.ts:586,633` → `plugins/health/lib/managed-blocks` (CLI agent-rules subcommand)

These all import from feature modules that this spec declares "core may import from." So they're documented contracts, not violations. Issue #174 tracks whether we'd ever want to lift the registries to core for cleaner layering.

---

## 4. Hot-reload contract

Per the kickoff conversation (Q3.1–Q3.7). This section is the durable definition.

### 4.1 Atomicity: independent server + client reload

Server-side and client-side reload trigger independently:
- Server-side reloads when `index.ts`, `lib/**/*.ts`, `defaults/**`, `bakin-plugin.json`, or `package.json` changes.
- Client-side reloads when `client.tsx`, `components/**/*.{ts,tsx}` change.

Cross-cutting saves (one save touches both server and client) are handled by **build version-stamping**: each plugin rebuild gets a monotonic version; server emits its version in response headers (`X-Bakin-Plugin-Version: <pluginId>:<version>`); client tracks its bundle version; on mismatch, client triggers its own re-mount of that plugin's tree. Auto-recovery is sub-100ms.

### 4.2 Re-import mechanism: cache-bust via query string

```ts
const fresh = await import('/abs/path/dist/index.js?v=' + buildVersion)
const newPlugin = fresh.default as BakinPlugin
```

Bun loads each unique URL as a separate module. Old module is dropped from our handles; GC reclaims it within a few cycles. Memory cost per reload: ~20-200 KB (compiled plugin code).

**The contract this forces on plugin authors:**

> All side effects with lifetime — timers (`setInterval`/`setTimeout`), signal listeners (`process.on`), network connections, file watchers — MUST be set up inside `activate(ctx)` and torn down inside `onShutdown(ctx)`. Side effects at module load time will leak across hot reloads. The system cannot detect or clean these up automatically.

Enforced via lint rule (#175) ships before launch.

### 4.3 Reload pipeline (server-side)

```
file change fires
  ↓
debounced rebuild via Bun.spawn (off-thread; old plugin unaffected)
  ↓
build result?
  ├─ FAILS              → emit dev:error, old plugin keeps running
  └─ OK
      ↓
      try import('/abs/path/dist/index.js?v=N')
        ├─ THROWS         → emit dev:error, old plugin keeps running
        └─ loaded
            ↓
            tear down old:
              call old.onShutdown?.(ctx)  [errors logged-not-thrown]
              sweep registries by pluginId  [hooks, exec tools, search, health, etc.]
            ↓
            try await new.activate(ctx)
              ├─ THROWS    → sweep again (clear partial registrations)
              │             plugin enters "disabled" state
              │             emit dev:error
              │             user fixes + saves → pipeline retries from scratch
              └─ succeeds  → broadcast version-bump SSE event
                             clients reconcile via version-stamping
```

### 4.4 State across reload

| State | Behavior on reload |
|---|---|
| In-flight HTTP requests | Closure on old module; runs to completion. |
| HTTP requests during the swap window | 404 for the route. ~10-50ms window. Accept and document. |
| In-flight MCP tool calls | Closure on old module; runs to completion. |
| SSE broadcasts | Core-owned (`broadcast()` in `src/core/sse.ts`, globalThis-backed). Plugin reload doesn't sever connections. |
| Plugin-held timers | Cleared via `onShutdown(ctx)`. Author responsibility. Lint rule catches top-level violations. |
| Antfly content types | Re-registered on reload; same-schema is idempotent. **Schema changes require server restart in v1.** |
| Workflow node types | Re-registered. In-flight workflow instances finish on old code. New instances use new shape. |
| Cross-plugin hook calls during the swap window | Brief (`<50ms`) window where `invoke()` may return `undefined`. Plugins consuming cross-plugin hooks must handle this gracefully — same contract as install/uninstall transitions. |
| Plugin's module-scope state (variables, closures from `activate`) | Lives on old module; new module starts fresh. Persistence via `~/.bakin/` or `getSettings()`. |

### 4.5 Watcher specifics

**Watch:** `index.ts`, `client.tsx`, `types.ts`, `lib/**`, `components/**`, `defaults/**`, `bakin-plugin.json`, `package.json`. `bakin-plugin.json#devWatch` globs override defaults if specified.

**Exclude:** `node_modules/**`, `dist/**`, `.git/**`, `coverage/**`, `.DS_Store`, `*.swp`, `*~`.

**Symlink resolution:** chokidar follows symlinks via fsevents on macOS / inotify on Linux. Confirmed working in our use case.

**Debounce:** ~200ms within chokidar (eats editor temp+rename writes). Per-plugin pipeline mutex covers build + swap as one atomic unit. If a save fires during in-flight pipeline, plugin marked `pending`; re-runs after current pipeline completes. Inherits the existing `inFlight` + `pending` pattern at `scripts/dev.ts:122-136`. Cross-plugin parallelism allowed.

**Out-of-dir imports** (`import { foo } from '../../shared/util'`) are NOT watched. Plugins should be self-contained.

### 4.6 Failure model summary

| Failure | Old plugin state | New plugin state | User sees |
|---|---|---|---|
| Build fails | running | not loaded | error overlay; old plugin keeps working |
| Module eval throws on import | running | not loaded | error overlay; old plugin keeps working |
| Old `onShutdown` throws | torn down (forced) | activated successfully | warning in console; plugin works |
| New `activate` throws | torn down | partially loaded → swept clean | error overlay; plugin disabled until fix |

**No rollback.** When `activate` throws, the plugin enters disabled state. User fixes + saves → pipeline retries from scratch.

---

## 5. Command surfaces

### 5.1 `bakin plugins install` — extended for monorepo subpath

```sh
bakin plugins install <source> [--yes] [--ref <ref>]

# Existing:
bakin plugins install /local/path
bakin plugins install github:user/repo

# NEW:
bakin plugins install github:markhayden/bakin-bits-official#plugins/messaging
bakin plugins install github:markhayden/bakin-bits-official#plugins/projects --ref messaging-v1.2.0
```

**Source string format:** `github:<user>/<repo>[#<subpath>]`. The `#subpath` is parsed off and points the installer at a subdirectory of the cloned repo. If absent, the install expects the manifest at the repo root (existing behavior — unchanged).

**Implementation:** `src/core/plugins/upgrade.ts:354` (the source parser) extends to recognize `#`. After `git clone`, the installer `cd`s to the subpath and runs `buildUserPlugin` against that directory. The lockfile records the full source string including `#subpath`; upgrades re-fetch and rebuild from the same path.

### 5.2 `bakin plugins link` — NEW: linked-source dev mode

```sh
bakin plugins link <local-path> [--name <id>]
bakin plugins unlink <id>
```

Symlinks `~/.bakin/plugins/<id>/` → `<local-path>`. Reads the manifest at the symlink target. Records in the lockfile with `linked: true` and `source: <abs-path>`. Sets up the file watcher.

**Subsequent edits to source files trigger the hot-reload pipeline (§4).** No rebuild step required from the user — saves are picked up by the watcher.

`bakin plugins list` shows linked plugins distinctly:
```
ID         VERSION   SOURCE                         STATUS
messaging  1.0.0     /Users/dev/dev/bakin-bits   linked
team       2.0.0     core                           built-in
```

`bakin plugins unlink <id>` removes the symlink + lockfile entry. No tarball backup (linked installs aren't real installs).

### 5.3 `bakin onboard` — extended with recommended-plugins prompt

A new step in the onboard flow, after the existing setup:

```
? Install recommended official plugins?  Use ↑↓ to navigate, space to toggle, enter to confirm
  ◉ messaging  Cross-agent chat sessions, brainstorm threads, planning layouts
  ◉ projects   Project tracking with subtasks and asset linkage
> ◯ <future plugin>
```

**Implementation:** Ink (https://github.com/vadimdemedes/ink) for the TUI. Curated list lives at `src/core/onboarding/recommended-plugins.ts`:

```ts
export const RECOMMENDED_PLUGINS: RecommendedPlugin[] = [
  {
    id: 'messaging',
    source: 'github:markhayden/bakin-bits-official#plugins/messaging',
    name: 'Messaging',
    description: 'Cross-agent chat sessions, brainstorm threads, planning layouts',
    defaultSelected: true,
  },
  {
    id: 'projects',
    source: 'github:markhayden/bakin-bits-official#plugins/projects',
    name: 'Projects',
    description: 'Project tracking with subtasks and asset linkage',
    defaultSelected: true,
  },
]
```

Selected plugins install via existing `bakin plugins install <source>` after onboard's other steps complete. No discovery, no marketplace.

### 5.4 `bakin plugins list --linked`

Filter to only linked plugins. Convenience for dev workflow.

---

## 6. Repo structure

### 6.1 `bakin-bits-official` (new repo)

```
bakin-bits-official/
├── README.md                       ← "Official Bakin plugins + agents"
├── package.json                    ← workspace root, depends on @bakin/sdk
├── tsconfig.json
├── .github/workflows/ci.yml        ← runs `bun test` + tsc per plugin
├── plugins/
│   ├── messaging/
│   │   ├── bakin-plugin.json       ← manifest
│   │   ├── package.json            ← per-plugin deps
│   │   ├── index.ts                ← server entry
│   │   ├── client.tsx              ← client entry
│   │   ├── components/
│   │   ├── lib/
│   │   ├── defaults/               ← shipped skills, workflows, knowledge
│   │   ├── tests/
│   │   └── README.md
│   └── projects/
│       └── ...same shape...
└── agents/                         ← future agent packages (placeholder)
    └── (e.g. social/trainer/, etc. — out of scope here)
```

**Each plugin is independent.** Its own `package.json`, its own tests, its own README, its own Ink-rendered usage docs. Workspace root provides shared CI + tsc + eslint coordination but plugins don't share code.

**Per-plugin `package.json` shape:**

```json
{
  "name": "@bakin/plugin-messaging",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@bakin/sdk": "^X.Y.Z"
  },
  "devDependencies": {
    "typescript": "...",
    "eslint": "...",
    "@bakin/eslint-config-plugin": "..." ← future from #175
  }
}
```

`@bakin/sdk` is npm-published from the bakin repo's release pipeline. Plugin authors don't need bakin source.

### 6.2 Bakin repo changes

- `plugins/messaging/` and `plugins/projects/` directories deleted.
- `tests/plugins/messaging/`, `tests/plugins/projects/` deleted (tests move with plugins).
- `src/lib/plugin-static-imports.ts:21,25` lines deleted (loaders for messaging + projects).
- `bakin.config.ts` `registerCorePlugins` table loses messaging + projects entries.
- `.claude/knowledge/messaging-plugin.md` and similar — moved to `bakin-bits-official` OR kept as historical reference (decide during Phase 6).
- Build pipeline (`scripts/build-plugins.ts`) — no change; it loops `plugins/*` which no longer contains messaging/projects.
- Embedded assets (`packages/host/src/api/_embedded-assets-static.ts`) — regenerated to drop messaging/projects bundles. They install via the user-plugin path now.

---

## 7. Code style + plugin author conventions

Inherits from CLAUDE.md and existing plugin conventions. Net-new for this work:

- **Side effects in `activate`, cleanup in `onShutdown`.** Loud doc callout. Lint rule (#175) enforces.
- **Plugin authors import from `@bakin/sdk` only.** Never from `@/core/...` or `@bakin/core/...` (those are core-feature-module privileges).
- **Manifest's `devWatch` is the contract** for watcher scope. If a plugin needs files outside the default watch glob considered, declare them.
- **Schema changes require server restart in v1.** If you change a content-type schema, restart bakin to pick it up.

---

## 8. Testing strategy

### 8.1 Per-plugin tests (in `bakin-bits-official`)

Each plugin owns its tests. `bun test` runs them in the plugin's directory. CI runs `bun test` across all plugins in the monorepo.

Tests use `@bakin/sdk` for types + a mocked `PluginContext`. The same test scaffold pattern from `tests/plugins/team/health-checks.test.ts` (for example) — set env vars before imports, mock content-dir + openclaw-home, declare a minimal mock ctx.

### 8.2 Round-trip tests (in bakin)

Bakin's CI gains an integration test:

1. Clones `bakin-bits-official` into a temp dir.
2. Runs `bakin plugins install /tmp/bakin-bits-official#plugins/messaging` against a test bakin home.
3. Runs `bakin plugins list` and confirms messaging installed at expected version.
4. Verifies plugin's `/api/plugins/messaging/*` routes return 200 for a known endpoint.
5. Runs `bakin plugins remove messaging` and confirms cleanup.

This catches "the integration with the running bakin server still works" regressions when bakin itself changes.

### 8.3 Hot-reload tests (in bakin)

New test file: `tests/integration/plugin-hot-reload.test.ts`. Spins up a test bakin process, writes a fixture plugin, links it, modifies a file, asserts the new code is in effect within ~1s. Covers:
- Server-side reload (route handler change → request hits new code)
- Client-side reload (SSE event fires with version bump)
- Build error → error broadcast → recovery on fix
- activate throws → plugin disabled → recovery on fix
- onShutdown throws → warning logged, reload completes
- Cross-cutting save → version mismatch → client reconciles

---

## 9. Boundaries

### Always do
- Treat all 8 named feature modules (`team`, `tasks`, `workflows`, `health`, `memory`, `assets`, `schedule`, `models`) as core-required. Core may import from them.
- Audit `messaging` and `projects` for top-level side effects BEFORE extraction. If found, fix in `activate(ctx)` + `onShutdown(ctx)`.
- Use `@bakin/sdk` as the only entry point for plugin author surface in extracted plugins.
- Honor `bakin-plugin.json#devWatch` overrides if a plugin declares them.
- Test the round-trip (clone → install → run → remove) in bakin CI.

### Ask first about
- Adding a new entry to `RECOMMENDED_PLUGINS`. Curation is editorial — every addition is a deliberate choice.
- Promoting a plugin from "extracted" back to "core feature module." This reverses architectural direction.
- Any change to the hot-reload pipeline contract (§4) that affects plugin author observable behavior (e.g., changing the version-stamping header name).

### Never do
- **Never have core import from `~/.bakin/plugins/*`.** That's the third-party path; it's user-controlled. Core depending on user-installed code = data loss waiting to happen.
- **Never auto-rollback on `activate()` failure.** Plugin disabled is the right state; rollback semantics are bug-prone (Q3.3).
- **Never block reload on draining in-flight requests.** Closures complete on old code; that's the contract (Q3.4).
- **Never silently retry a failed build or activation.** Surface the error; let the user fix + save.
- **Never change a marker constant or content-type table name during extraction.** User state in `~/.bakin/plugin-settings/<id>.json` and Antfly tables continues to work because plugin id is preserved.
- **Never publish a plugin to npm.** Plugins ship as git repos (or local paths); bakin's installer clones + builds. The `package.json` in plugin source is for `bun install` of deps only — `name` is private convention, not registry publication.

---

## 10. Phase sequence

Each phase is a separate PR. Each leaves the codebase shippable.

### Phase 0 — Foundations (in bakin)
- Audit `plugins/messaging/` and `plugins/projects/` for top-level side effects. Fix any found.
- Confirm `@bakin/sdk` published from release.yml; bump if needed.
- Confirm `bakin plugins install --ref` works end-to-end.

**Acceptance:** No top-level side effects in either plugin. SDK installable from npm. CLI's `--ref` flag tested.

### Phase 1 — Monorepo subpath install (in bakin)
- Extend `src/core/plugins/upgrade.ts:354` source parser to recognize `#subpath`.
- Update install flow to `cd` into the subpath after clone.
- Lockfile records the full source string.
- Tests for `github:user/repo#subpath` parsing + install.
- Documentation update for the install command.

**Acceptance:** `bakin plugins install github:markhayden/bakin-bits-official#plugins/messaging` works (against a fixture repo). Roundtrip with upgrade + remove.

### Phase 2 — Plugin link + hot-reload (in bakin)
The biggest phase. Bundle these because they're useless apart:
- `bakin plugins link <path>` command (CLI + API endpoint).
- `bakin plugins unlink <id>`.
- Watcher infrastructure for linked plugins (chokidar; reuses dev.ts patterns).
- Per-plugin pipeline mutex (build + swap as one atomic unit).
- Server-side hot-reload: cache-bust import + teardown + activate cycle.
- Client-side reload: SSE event `dev:plugin:reload` with version + reload coordination via version-stamping headers.
- Error overlay integration for plugin-scoped builds.
- Lint rule (#175) ships in this phase too.

**Acceptance:** `tests/integration/plugin-hot-reload.test.ts` passes. Manual test: link a fixture plugin, edit a route handler, observe response change without restart. Build error → recovery loop works.

### Phase 3 — `bakin-bits-official` repo skeleton
Outside bakin repo:
- New `markhayden/bakin-bits-official` repo created.
- Top-level `package.json`, `tsconfig.json`, `.github/workflows/ci.yml`, README.
- Empty `plugins/` directory.
- Empty `agents/` directory (placeholder for future).
- Plugin authoring template (`plugins/_template/`?) so new plugins start from a known shape.
- Documentation: how to develop locally (`bakin plugins link ./plugins/<name>`); how to contribute.

**Acceptance:** Repo exists, CI passes against the empty state, README explains the contribution flow.

### Phase 4 — Extract messaging
- Copy `bakin/plugins/messaging/` to `bakin-bits-official/plugins/messaging/`.
- Update import paths to use `@bakin/sdk` everywhere instead of `@/core/...` / `../../src/core/...`.
- Move `tests/plugins/messaging/` to `bakin-bits-official/plugins/messaging/tests/`.
- Add `bakin-plugin.json#version` (semver, starts at `1.0.0`).
- Tag `messaging-v1.0.0` in bakin-bits-official.
- In bakin repo:
  - Delete `plugins/messaging/`.
  - Delete `tests/plugins/messaging/`.
  - Delete the messaging line in `src/lib/plugin-static-imports.ts`.
  - Delete the messaging entry in `bakin.config.ts`.
  - Regenerate `_embedded-assets-static.ts`.
- Add `messaging` to `RECOMMENDED_PLUGINS` array.
- Add round-trip integration test in bakin: install messaging from local checkout, verify routes work, remove.

**Acceptance:** Bakin builds and runs without messaging in source. `bakin plugins install /local/bakin-bits-official#plugins/messaging` works end-to-end. Settings + Antfly tables persist (verified by spot-check on a populated test home). Round-trip test passes.

### Phase 5 — Extract projects
Repeat Phase 4 for projects. Should be smoother.

**Acceptance:** Same as Phase 4, applied to projects.

### Phase 6 — Onboard suggest flow
- Implement `RECOMMENDED_PLUGINS` array at `src/core/onboarding/recommended-plugins.ts`.
- Add Ink dependency to bakin (or vendor the relevant pieces if dep weight matters).
- Build the TUI prompt (arrow up/down + space to toggle + enter to confirm).
- Wire into existing `bakin onboard` flow as a new step.
- Tests: prompt rendering, selection state, install dispatch.

**Acceptance:** Fresh `bakin onboard` shows the prompt. Selected plugins install. Skipped plugins don't install. Re-running `bakin onboard` doesn't re-prompt for already-installed plugins.

### Phase 7 — Formalize core layering policy
- Update CLAUDE.md with the "feature module vs plugin" rule (§3 of this spec).
- Update `.claude/knowledge/plugin-system.md` with the same.
- Add a fitness test (lint or tsc-based) that fails if any file under `src/core/`, `src/lib/`, `cli/`, `packages/core/` imports from `~/.bakin/plugins/*` (which it can't, because those are runtime-installed; the test catches the spirit by failing on `import.*\.bakin/plugins`).
- Tackle issue #174 if its time has come.

**Acceptance:** Layering rule documented. Fitness test added and passing.

---

## 11. Follow-up issues to file (during phases)

| Phase | Issue |
|---|---|
| 2 | Lint rule (#175 — already filed) |
| 6 | Community plugin marketplace (deferred from Q on community discovery) |
| 7 | Architectural-fitness test for CLI hermetic-import safety (#174 already covers) |
| TBD | Antfly schema migration during dev hot-reload (only if real users hit it) |

---

## 12. Acceptance (whole work, post-Phase 7)

- [ ] `bakin-bits-official` exists with `messaging` + `projects` plugins.
- [ ] `bakin plugins install github:markhayden/bakin-bits-official#plugins/messaging` works.
- [ ] `bakin plugins link /local/bakin-bits-official/plugins/messaging` works.
- [ ] Editing a file in the linked plugin updates the running bakin within ~1s, no restart.
- [ ] Build errors surface in dev overlay; old plugin keeps working until fix.
- [ ] `bakin onboard` prompts for recommended plugins.
- [ ] `grep -rn "from .*~/.bakin/plugins" src/ cli/ packages/` returns 0 matches.
- [ ] Plugin authoring docs document the side-effects-in-activate contract.
- [ ] Lint rule (#175) flags top-level lifetime side effects.
- [ ] CLAUDE.md documents the feature-module / plugin rule.
- [ ] Fitness test prevents future drift.
- [ ] Round-trip integration test (clone → install → run → remove) passes in CI.

---

## 13. Open Micro-Decisions (settle during build)

These are too small for spec-level interview. Default decisions are reasonable; revisit if friction surfaces:

- **Versioning convention.** `<plugin>-v<semver>` git tag style: `messaging-v1.2.0`, `projects-v0.5.0`. Tags live in `bakin-bits-official`. Plugin's `bakin-plugin.json#version` matches the tag's semver portion. Same convention for agent packages later: `<agent>-v<semver>`.

- **Knowledge doc relocation.** `.claude/knowledge/messaging-plugin.md` etc. — move to `bakin-bits-official/plugins/messaging/docs/architecture.md`? Or keep as historical reference in bakin? Default: move.

- **Eslint config sharing.** Plugin authors get a preset (`@bakin/eslint-config-plugin`) that includes the lint rule (#175) + standard TypeScript rules. Ships from bakin. Default: build it during Phase 2.

- **Templates / scaffolding.** `bakin plugins scaffold <name>` already exists per CLI registry. After Phase 3, scaffolds should produce a structure ready to drop into `bakin-bits-official` or a standalone repo.

- **The dev loop "auto-link when bakin-bits-official is cloned alongside" affordance.** When developing both repos at once, can we automate the `bakin plugins link` step? Default: no, explicit is fine; revisit if the friction is real.

- **Embedded assets transition.** Messaging+projects currently bundle `defaults/` into the binary via `_embedded-assets-static.ts`. After extraction those install via the existing `plugin-assets` lifecycle. Verify the lifecycle handles a freshly-installed plugin's `defaults/` correctly during install — it should (lifecycle was hardened for user plugins in #170), but spot-check during Phase 4.

- **Hot-reload for dev across both repos.** When developing in bakin AND a linked plugin simultaneously, two watchers coexist. They don't conflict (one watches `packages/host/`, the other watches the symlinked plugin source). Verify during Phase 2.

- **Lockfile entry shape for linked plugins.** `linked: true`, `source: '/abs/path/to/dir'`, `commitSha: ''`, `installedAt: ISO8601`. Treat upgrade ops on linked plugins as no-ops with a warning.

- **What happens when the user `bakin plugins install`s an already-linked plugin.** Probably error out: "plugin <id> is currently linked; unlink first."

- **Cross-cutting save when client and server changes are in different files but in the same git commit.** Each watcher fires independently; each pipeline runs independently; version-stamping handles reconciliation. No coordination needed.
