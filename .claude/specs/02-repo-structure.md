# Phase 2: Repository Structure

**Status:** Pending
**Dependencies:** Phase 0 (rename complete first)

## Purpose

Migrate from a single npm-managed Next.js app to a pnpm monorepo with scoped `@bakin/*` packages. This establishes clean package boundaries, enables proper plugin distribution, and sets up the foundation for addon plugins published as separate packages.

## Current State

- Single `package.json` at root, npm lockfile
- All code in one build: `src/`, `plugins/`, `scripts/`, `cli/`
- tsconfig `paths` aliases: `@/*` → `./src/*`, `@mc/*` → `./plugins/*`
- Plugins are directories, not packages — no individual `package.json`
- No workspace tooling

## Target Structure

```
bakin/                             ← repo root (workspace root)
  pnpm-workspace.yaml
  package.json                     ← workspace root config (scripts, devDeps)
  turbo.json                       ← optional: turborepo for build orchestration

  packages/
    core/                          ← @bakin/core
      package.json
      tsconfig.json
      src/
        constants.ts               ← APP_NAME, APP_SLUG, etc.
        main-agent.ts              ← getMainAgentId()
        plugin-types.ts            ← BakinPlugin, PluginContext, etc.
        plugin-registry.ts
        storage/
          markdown-adapter.ts
        events/
          event-bus.ts
        parsers/
        utils.ts

    app/                           ← @bakin/app
      package.json
      tsconfig.json
      next.config.ts
      server.ts
      src/
        app/                       ← Next.js App Router pages
        components/                ← UI components
        core/                      ← Server modules (mcp, dispatch, sse, etc.)
        lib/                       ← Client-safe utilities

    cli/                           ← @bakin/cli
      package.json
      tsconfig.json
      src/
        bakin.ts                   ← CLI entry point

    scripts/                       ← @bakin/scripts
      package.json
      tsconfig.json
      src/
        registry.ts
        save-asset.ts
        log-progress.ts
        ...

  plugins/
    tasks/                         ← @bakin/plugin-tasks
      package.json
      tsconfig.json
      bakin-plugin.json
      index.ts
      client.tsx
      components/
      lib/
      tests/

    workflows/                     ← @bakin/plugin-workflows
    assets/                        ← @bakin/plugin-assets
    projects/                      ← @bakin/plugin-projects
    schedule/                      ← @bakin/plugin-schedule
    memory/                        ← @bakin/plugin-memory
    calendar/                      ← @bakin/plugin-calendar
    models/                        ← @bakin/plugin-models
    health/                        ← @bakin/plugin-health
```

## Package Boundaries

### @bakin/core
**Exports:** All shared types, interfaces, utilities. Zero runtime dependencies on Next.js or React.
- `BakinPlugin`, `PluginContext`, `StorageAdapter`, `EventBus` interfaces
- `MarkdownStorageAdapter`, `BakinEventBus` implementations
- `constants.ts` (APP_NAME, APP_SLUG, etc.)
- `getMainAgentId()`, `getContentDir()`, `getBakinPaths()`
- `createLogger()`, settings loader, vault
- Parsers and format utilities

**Depends on:** Nothing (leaf package)

### @bakin/app
**Contains:** Next.js application, all UI components, server modules (dispatch, SSE, MCP, etc.)
**Depends on:** `@bakin/core`, all `@bakin/plugin-*` packages, `@bakin/scripts`

### @bakin/cli
**Contains:** CLI entry point. Thin HTTP client wrapper — no core imports needed.
**Depends on:** Nothing (uses fetch against the running server)

### @bakin/scripts
**Contains:** MCP exec tool registry and core script tools.
**Depends on:** `@bakin/core` (for types and utilities)

### @bakin/plugin-{name}
**Contains:** Plugin server entry, client entry, components, lib, tests.
**Depends on:** `@bakin/core` (for types). May depend on other plugins via manifest `dependencies`.

## pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
  - 'plugins/*'
```

## Migration Strategy

### Step 1: Add pnpm workspace config
- Create `pnpm-workspace.yaml`
- Convert root `package.json` to workspace root (move app-specific deps later)
- `rm package-lock.json`, `pnpm install`

### Step 2: Extract @bakin/core
- Create `packages/core/package.json` with `"name": "@bakin/core"`
- Move: `src/lib/plugin-types.ts`, `src/lib/storage/`, `src/lib/events/`, `src/lib/parsers/`, `src/lib/utils.ts`, `src/lib/core-constants.ts`
- Move: `src/core/logger.ts`, `src/core/content-dir.ts`, `src/core/settings.ts`, `src/core/vault.ts`, `src/core/main-agent.ts`
- Update all imports across the codebase

### Step 3: Give each plugin its own package.json
- Each plugin gets `"name": "@bakin/plugin-{id}"` and `"dependencies": { "@bakin/core": "workspace:*" }`
- Update imports from `../../src/lib/plugin-types` to `@bakin/core`
- Update imports from `../../src/core/logger` to `@bakin/core`

### Step 4: Extract @bakin/scripts
- Move `scripts/lib/` → `packages/scripts/src/`
- Depends on `@bakin/core` for types

### Step 5: Extract @bakin/cli
- Move `cli/bakin.ts` → `packages/cli/src/bakin.ts`
- Self-contained, no core dependency needed (HTTP only)

### Step 6: Remaining code becomes @bakin/app
- `packages/app/` gets Next.js config, server.ts, src/app/, src/components/, src/core/ (server modules)
- Depends on core + all plugins + scripts

### Step 7: Update build pipeline
- Root scripts: `pnpm -r build`, `pnpm -r test`
- `pnpm --filter @bakin/app dev` to start dev server
- Update tsconfig paths to use package imports instead of relative paths

## tsconfig Strategy

Each package gets its own `tsconfig.json` extending a shared base:

```json
// tsconfig.base.json (root)
{
  "compilerOptions": {
    "target": "ES2017",
    "strict": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

Plugin imports change from `@mc/tasks` → `@bakin/plugin-tasks` (real packages, not path aliases).

## Plugin Distribution

| Type | Location | Install method |
|------|----------|----------------|
| Core plugins | `plugins/` in monorepo | Ship with the app |
| Addon plugins | `~/.bakin/plugins/` | `bakin install <path-or-url>` |
| Published plugins | npm registry | `pnpm add @bakin/plugin-analytics` (future) |

Community plugins installed to `~/.bakin/plugins/` are loaded by `loadUserPlugins()` in the plugin registry (already implemented).

## Key Decisions

- **Build tool:** Use `tsc` for type checking, let Next.js handle bundling for the app. Plugins don't need separate builds — they're consumed by the app's bundler.
- **Turborepo:** Optional but helpful for caching and parallel builds. Add later if build times become a problem.
- **Plugin builds:** Core plugins don't need individual build steps — Next.js bundles them. Addon plugins (outside the monorepo) would need to be pre-built or use tsx.

## Verification

- [ ] `pnpm install` succeeds from clean state (no node_modules)
- [ ] `pnpm --filter @bakin/app dev` starts the dev server
- [ ] `pnpm -r build` builds all packages without errors
- [ ] `pnpm test` runs all tests across all packages
- [ ] `bakin status` works from CLI package
- [ ] All plugin imports resolve correctly
- [ ] No circular dependencies between packages
- [ ] Changing a plugin file doesn't trigger core rebuild
- [ ] User plugins in `~/.bakin/plugins/` still load correctly
