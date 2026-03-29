# Phase 0: Core Variables & Identity

**Status:** Pending
**Dependencies:** Phase 1 (complete first so .claude structure exists)

## Purpose

Create a single source of truth for all identity/branding values so that renaming the project (Beacon → Bakin, or anything else in the future) is a one-file change. Additionally, decouple the main agent identity from the source code so it's fully instance-specific.

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

Every file that currently hardcodes "beacon", "Beacon", "mission-control", "MC", "BEACON_HOME", etc. imports from this file instead.

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
  // This is already done in cli/beacon.ts getCliAgent() — extract and share
}
```

- `getMainAgentId()` replaces all hardcoded "main-operator" references that mean "the orchestrator"
- Agent persona data (name, headshot, role description) remains in agent definition files keyed by the runtime ID
- `~/.bakin/settings.json` stores `{ mainAgentId: "main-operator" }` — set during `bakin init` by auto-detecting from OpenClaw

### 3. Rename audit

Full grep audit for every variant that needs replacement:

| Pattern | Replacement |
|---------|-------------|
| `beacon` (lowercase) | `APP_SLUG` or literal `bakin` |
| `Beacon` (capitalized) | `APP_NAME` or literal `Bakin` |
| `BEACON_HOME` | `${ENV_PREFIX}_HOME` |
| `BEACON_URL` | `${ENV_PREFIX}_URL` |
| `mission-control` | `APP_SLUG` |
| `Mission Control` | `APP_NAME` |
| `mc.config.ts` | `CONFIG_FILE` |
| `MCPlugin` | `BakinPlugin` |
| `MCConfig` | `BakinConfig` |
| `MCEventBus` | `BakinEventBus` |
| `@mc/*` tsconfig paths | `@bakin/*` |
| `beacon-plugin.json` | `PLUGIN_MANIFEST_FILE` |
| `main-operator` (as orchestrator role) | `getMainAgentId()` |
| `main-operator` (as persona data) | stays — it's agent-specific data |

### 4. File/directory renames

| Current | New |
|---------|-----|
| `~/.beacon/` | `~/.bakin/` (direct rename, no fallback) |
| `mc.config.ts` | `bakin.config.ts` |
| `beacon-plugin.json` (in each plugin) | `bakin-plugin.json` |
| `cli/beacon.ts` | `cli/bakin.ts` |
| `package.json` name: `mission-control` | `bakin` |
| `package.json` bin: `beacon` | `bakin` |
| GitHub repo: `beacon` | `bakin` |

### 5. Content directory update (`src/core/content-dir.ts`)

- `BEACON_HOME_DEFAULT` → use `APP_HOME_DEFAULT` from constants
- `BEACON_HOME` env var → `BAKIN_HOME` env var
- `isUsingBeaconHome()` → `isUsingBakinHome()`
- `getBeaconPaths()` → `getBakinPaths()`
- `initBeaconHome()` → `initBakinHome()`
- `.beacon/settings.json` nested dir → `settings.json` at root of `~/.bakin/`

### 6. Update all .claude files

All specs, knowledge files, skills, and CLAUDE.md updated to reference new names.

## Execution Strategy

1. Create `src/lib/core-constants.ts` and `src/core/main-agent.ts`
2. Update `src/core/content-dir.ts` to use constants
3. Rename `mc.config.ts` → `bakin.config.ts`, update import in `server.ts`
4. Rename `beacon-plugin.json` → `bakin-plugin.json` in all 9 plugins
5. Update `package.json` (name, bin)
6. Update `cli/beacon.ts` → `cli/bakin.ts`
7. Global find-replace on remaining string literals (careful, manual review)
8. Rename types: `MCPlugin` → `BakinPlugin`, `MCConfig` → `BakinConfig`, etc.
9. Update tsconfig paths: `@mc/*` → `@bakin/*`
10. Update all import statements referencing old paths
11. Rename `~/.beacon/` → `~/.bakin/` on disk
12. Update `.claude/` files
13. Rename GitHub repo

## Verification

- [ ] `grep -ri 'beacon\|mission.control\|MCPlugin\|MCConfig\|@mc/' src/ plugins/ scripts/ cli/` — zero hits outside constants and migration code
- [ ] `npm run dev` starts cleanly
- [ ] `npm test` passes
- [ ] CLI works as `bakin status`
- [ ] All plugin manifests are `bakin-plugin.json`
- [ ] Content directory resolves to `~/.bakin/`
- [ ] `getMainAgentId()` returns correct agent from OpenClaw config
- [ ] Changing `APP_NAME` in constants.ts produces a rebranded header/title
