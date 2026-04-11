# Phase 0: Core Variables & Identity

**Status:** Pending
**Dependencies:** Phase 1 (complete first so .claude structure exists)

## Purpose

Create a single source of truth for all identity/branding values so that renaming the project (Bakin → Bakin, or anything else in the future) is a one-file change. Additionally, decouple the main agent identity from the source code so it's fully instance-specific.

## Deliverables

### 1. `src/lib/core-constants.ts` — Compile-time branding

```typescript
// Change these values to rebrand the entire application.
export const APP_NAME = 'Bakin'
export const APP_SLUG = 'bakin'
export const APP_HOME_DEFAULT = '~/.bakin'
export const CONFIG_FILE = 'bakin.config.ts'
export const PLUGIN_MANIFEST_FILE = 'bakin-plugin.json'
export const MAIN_AGENT_ROLE = 'orchestrator'
export const DEFAULT_PORT = 3737
export const ENV_PREFIX = 'BAKIN'   // env vars: BAKIN_HOME, BAKIN_URL, etc.
```

Every file that currently hardcodes "bakin", "Bakin", "mission-control", "MC", "BAKIN_HOME", etc. imports from this file instead.

### 2. Runtime main agent ID

The main/orchestrator agent name is NOT in source code. It's resolved at runtime:

```typescript
// src/core/main-agent.ts
export function getMainAgentId(): string {
  const settings = getSettings()
  return settings.mainAgentId || detectFromOpenClaw() || 'main'
}

function detectFromOpenClaw(): string | null {
  // Read ~/.openclaw/openclaw.json → agents.list → find id='main' → identity.name
  // This is already done in cli/bakin.ts getCliAgent() — extract and share
}
```

- `getMainAgentId()` replaces all hardcoded "roscoe" references that mean "the orchestrator"
- Agent persona data (name, headshot, role description) remains in agent definition files keyed by the runtime ID
- `~/.bakin/settings.json` stores `{ mainAgentId: "roscoe" }` — set during `bakin init` by auto-detecting from OpenClaw

### 3. Rename audit

Full grep audit for every variant that needs replacement:

| Pattern | Replacement |
|---------|-------------|
| `bakin` (lowercase) | `APP_SLUG` or literal `bakin` |
| `Bakin` (capitalized) | `APP_NAME` or literal `Bakin` |
| `BAKIN_HOME` | `${ENV_PREFIX}_HOME` |
| `BAKIN_URL` | `${ENV_PREFIX}_URL` |
| `mission-control` | `APP_SLUG` |
| `Mission Control` | `APP_NAME` |
| `bakin.config.ts` | `CONFIG_FILE` |
| `BakinPlugin` | `BakinPlugin` |
| `BakinConfig` | `BakinConfig` |
| `BakinEventBus` | `BakinEventBus` |
| `@bakin/*` tsconfig paths | `@bakin/*` |
| `bakin-plugin.json` | `PLUGIN_MANIFEST_FILE` |
| `roscoe` (as orchestrator role) | `getMainAgentId()` |
| `roscoe` (as persona data) | stays — it's agent-specific data |

### 4. File/directory renames

| Current | New |
|---------|-----|
| `~/.bakin/` | `~/.bakin/` (direct rename, no fallback) |
| `bakin.config.ts` | `bakin.config.ts` |
| `bakin-plugin.json` (in each plugin) | `bakin-plugin.json` |
| `cli/bakin.ts` | `cli/bakin.ts` |
| `package.json` name: `mission-control` | `bakin` |
| `package.json` bin: `bakin` | `bakin` |
| GitHub repo: `bakin` | `bakin` |

### 5. Content directory update (`src/core/content-dir.ts`)

- `BAKIN_HOME_DEFAULT` → use `APP_HOME_DEFAULT` from constants
- `BAKIN_HOME` env var → `BAKIN_HOME` env var
- `isUsingBakinHome()` → `isUsingBakinHome()`
- `getBakinPaths()` → `getBakinPaths()`
- `initBakinHome()` → `initBakinHome()`
- `.bakin/settings.json` nested dir → `settings.json` at root of `~/.bakin/`

### 6. Update all .claude files

All specs, knowledge files, skills, and CLAUDE.md updated to reference new names.

## Execution Strategy

1. Create `src/lib/core-constants.ts` and `src/core/main-agent.ts`
2. Update `src/core/content-dir.ts` to use constants
3. Rename `bakin.config.ts` → `bakin.config.ts`, update import in `server.ts`
4. Rename `bakin-plugin.json` → `bakin-plugin.json` in all 9 plugins
5. Update `package.json` (name, bin)
6. Update `cli/bakin.ts` → `cli/bakin.ts`
7. Global find-replace on remaining string literals (careful, manual review)
8. Rename types: `BakinPlugin` → `BakinPlugin`, `BakinConfig` → `BakinConfig`, etc.
9. Update tsconfig paths: `@bakin/*` → `@bakin/*`
10. Update all import statements referencing old paths
11. Rename `~/.bakin/` → `~/.bakin/` on disk
12. Update `.claude/` files
13. Rename GitHub repo

## Verification

- [ ] `grep -ri 'bakin\|mission.control\|BakinPlugin\|BakinConfig\|@bakin/' src/ plugins/ scripts/ cli/` — zero hits outside constants and migration code
- [ ] `npm run dev` starts cleanly
- [ ] `npm test` passes
- [ ] CLI works as `bakin status`
- [ ] All plugin manifests are `bakin-plugin.json`
- [ ] Content directory resolves to `~/.bakin/`
- [ ] `getMainAgentId()` returns correct agent from OpenClaw config
- [ ] Changing `APP_NAME` in constants.ts produces a rebranded header/title
