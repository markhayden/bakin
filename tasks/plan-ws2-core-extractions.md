# Plan: WS2 — refactor/core-extractions

Spec: `SPEC.md` + `.claude/specs/audit-2026-06/REPORT.md` (triage-approved 2026-06-11).
Branch: `refactor/core-extractions` off `main` (WS1 merged). One revertable commit per finding;
every commit green on `bun run test` + `bun run typecheck`. PR gate: `bun run build` + lint +
boot smoke + `madge` cycle check + docs. No shims; dead paths deleted in the commit that obsoletes
them. **Respect the WS1 two-tier type contract** (`.claude/knowledge/repo-architecture.md` §
two-tier) — core keeps its fuller internal surface; do not collapse it.

## Goal

Move runtime infrastructure to its correct layer and kill server-side duplication. **No behavior
change** except the two explicitly-flagged fixes (images→assets boundary; settings-notification
convergence). The headline win: break the 18-cycle circular-dependency cluster and the
core→plugin boundary violation, then lock both in with architecture-test guards.

## Confirmed state (recon, 2026-06-13)

- `madge` reports **18 cycles**; cycles 5–17 all route through `scripts/lib/registry.ts`, cycle 4
  through `plugins/workflows/lib/source-registry.ts`. (Cycle 18 is a benign type-only cycle from
  WS1's B1 split — `sdk/types/context.ts ↔ registration.ts`; erased at compile, left as-is.)
- **The hard back-edge:** `scripts/lib/registry.ts:11` imports `getHookRegistry` from
  `src/lib/plugin-registry`, which imports `addExecTool`/`removeExecToolsByPlugin` back from
  `registry.ts` (cycle 16). The hook-registry singleton (`__bakinHookRegistry`) is declared at
  `src/lib/plugin-registry.ts:239`; the catch-all route also reaches it via raw `globalThis`
  (`[[...path]].ts:114-139`).
- exec-tool registry importers (5): `src/core/mcp-server.ts`, `src/core/bakin-skill.ts`,
  `src/core/plugin-host/reload-pipeline.ts`, `src/lib/plugin-registry.ts`,
  `packages/host/src/api/exec-tools/[toolName].ts`.
- workflow-registry core importers: `src/lib/plugin-registry.ts:29-35`,
  `src/core/plugin-host/reload-pipeline.ts:40-41`, `src/core/agent-packages/load-sources.ts:43`.
- `config.get/replace` consumers (real, substantive): `plugins/models/index.ts:84,88`,
  `plugins/team/index.ts:216`, `src/core/openclaw-integration.ts:41,70,79`.

## Two decisions to resolve before building (see questions)

1. **Finding (8) — gate `runtime.config.get/replace`.** This is *adapter-API design* (the audit's
   own fix is "promote to typed adapter methods like `runtime.models.getAssignments()`"), not
   extraction/dedup. It touches the OpenClaw adapter's config-schema knowledge and 3 real
   consumers. **Recommendation: split it out** of WS2 into its own focused PR aligned with the
   adapter-boundary theme — keep WS2 about layering + dedup. The architecture guard for it (part
   of 9) moves with it.
2. **PR shape.** The structural keystones (cycle break + workflow-registry move + context factory +
   guards) are interdependent; the dedups (settings-store, atomic-write, frontmatter, health
   constructors) are independent and low-risk. **Recommendation: one PR** with checkpointed commits
   (matches the per-workstream model), structural first so the guards land on the fixed structure.

## Dependency graph & sequencing

```
Phase K — structural (break the cycle + the boundary)         ── interdependent, ordered
  K1 extract hook-registry singleton → leaf module            (removes registry→plugin-registry back-edge)
  K2 move scripts/lib/registry.ts → src/core/exec-tools/      (runtime code to its layer; 5 importers)
  K3 extract the ONE PluginContext factory (buildContext+buildCtx)
  K4 madge gate: confirm the scripts/lib cluster (cycles 5-17,16) is GONE
  K5 move workflow source/node-type/notification-channel registries → packages/core (breaks cycle 4 + boundary)
  K6 fix images→assets direct import (route via assets hooks)
        │
Phase D — dedup extractions (independent, low-risk, any order)
  D1 settings-store          (5 sites, converge notification)
  D2 atomic-write promotion  (JSON sites only — NOT log-rotation/binary renames)
  D3 frontmatter module      (regex ×11, parseSkillFile ×3, lesson parser ×4)
  D4 health constructors     (13+ sites, 2 signatures → one)
        │
Phase G — lock it in
  G1 architecture-test guards: packages/sdk in SCAN_ROOTS + cross-plugin-import rule
```

## Tasks

### K1 — Extract the hook-registry singleton to a leaf module
`getHookRegistry()` + the `__bakinHookRegistry` globalThis cell move from `src/lib/plugin-registry.ts:239-244`
to a dependency-free leaf (e.g. `packages/core/src/hooks/hook-registry-singleton.ts`, next to the
existing `hook-registry.ts`). `plugin-registry.ts`, the soon-moved exec-tool registry, and the
catch-all route (replace its raw `globalThis` reads at `[[...path]].ts:114-139`) all import from it.
- **Risk:** the singleton must live in exactly ONE module post-move or HMR/`resetHookRegistry` breaks.
- **Accept:** typecheck + suite green; `getHookRegistry` has one definition; catch-all no longer
  pokes `globalThis.__bakinHookRegistry` directly.
- Commit: `refactor(core): extract the hook-registry singleton to a leaf module`

### K2 — Move the exec-tool registry into src/core
`scripts/lib/registry.ts` → `src/core/exec-tools/registry.ts` (it's the production registry —
globalThis Map + `PluginToolContext` builder + `addExecTool`/`getAllExecTools`/`removeExecToolsByPlugin`;
not build tooling). Repoint the 5 importers. Its `getHookRegistry` import now resolves to K1's leaf
(no back-edge). Keep its other co-located `scripts/lib/*` peers (`heartbeat`, `log-progress`,
`search-tools`, `post-channel`, `npm-registry`, `get-paths`, `common`) — assess each: those that are
runtime exec-tool tools move with it; pure build helpers stay. (Audit also flagged moving
`scripts/lib/*` runtime tools out of `scripts/`; scope to the exec-tool registry + its runtime peers,
leave genuinely-build-only files.)
- **Risk:** `addExecTool` self-registration side effects on import; the binary embeds none of
  `scripts/` server code (#421) — verify the move doesn't change what's embedded.
- **Accept:** typecheck + suite green; no `scripts/lib/registry` importers remain; exec tools still
  register (mcp-server `getAllExecTools()` returns the same set — assert count in a test).
- Commit: `refactor(core): move the exec-tool registry from scripts/lib into src/core/exec-tools`

### K3 — Unify the PluginContext factory
`buildContext` (`src/lib/plugin-registry.ts:811-972`) and the per-request `buildCtx`
(`packages/host/src/api/plugins/[pluginId]/[[...path]].ts:46-151`) are duplicated and have **drifted
in `updateSettings`**. Extract one `buildPluginContext({pluginId, state, storage, events, services})`
(e.g. `src/lib/plugin-context-factory.ts`) that builds the shared dynamic surfaces (settings,
activity, hooks, search, storage, runtime/tasks facades) and takes the registration surfaces as a
parameter (real registrars at activate-time; no-op/throwing stubs for the per-request path). Both
sites call it. Converge `updateSettings` to one behavior (the registry's — fires the change
notification; the per-request copy had dropped it).
- **Depends on:** K1 (factory uses the hook singleton). Pairs with D1 (settings-store) — do D1
  first if convenient so the factory consumes it.
- **Accept:** typecheck + suite green; the two ctx surfaces are byte-identical (one factory); a test
  asserts per-request `updateSettings` now notifies.
- Commit: `refactor(core): unify the duplicated PluginContext factory`

### K4 — madge cycle gate (checkpoint, not a commit on its own)
After K1–K3, run `bunx madge --circular` over the same scope. The `scripts/lib/registry` cluster
(cycles 5–17 + 16) must be gone. If residual back-edges remain, extract the offending pure maps into
leaf modules per the audit rec ("pure registry maps with no src/core imports") until the cluster
clears. Fold those extractions into K1–K3's commits or a K3b commit.
- **Accept:** `madge --circular` shows only the benign type-only SDK cycle (and cycle 4 until K5).

### K5 — Move the workflow registries into core
`source-registry.ts`, `node-type-registry.ts`, `notification-channel-registry.ts` move from
`plugins/workflows/lib/` → `packages/core/src/workflows/` (core extension points the loader owns,
like `hook-registry`). Core importers (`plugin-registry:29-35`, `reload-pipeline:40-41`,
`agent-packages/load-sources:43`) import from core. The workflows plugin consumes them via the same
core module (no longer the source of truth). Breaks cycle 4 + the documented HookRegistry-only
boundary violation (core no longer needs the workflows plugin's source tree to boot).
- **Risk:** these registries self-seed at module load (notification-channel built-ins); the seed
  must run in exactly one place post-move. `WorkflowDefinition`/node-type types they reference are
  workflows-plugin types — move only the registry MACHINERY, keep the workflow domain types in the
  plugin (the registries can be generic over them, or take a minimal core-side type).
- **Accept:** typecheck + suite (incl. workflows runtime tests) green; madge cycle 4 gone; core boots
  without importing `plugins/workflows/*`.
- Commit: `refactor(core): move the workflow extension-point registries into packages/core`

### K6 — Fix the images→assets direct import
`plugins/images/lib/tools.ts:6-8` imports `getAsset`/`listAssets`/`upsertFromSource`/`resolveStoreFile`/
`isValidAssetId` + manifest types from `../../assets/lib/*`. Route through the assets plugin's hooks
(the assets plugin already registers `assets.*` hooks — verify coverage; add the missing
`assets.upsertFromSource`/`assets.resolveStoreFile` hooks if needed). Manifest TYPES come from the
SDK/core, not a cross-plugin import.
- **Risk:** hook calls are async + untyped-ish; ensure the images tools still get the manifest shape
  they need. If hooks can't cleanly cover it, the fallback (audit-sanctioned) is promoting
  asset-service into `packages/core` — flag if so.
- **Accept:** typecheck + images tests green; no `plugins/images → plugins/assets` import remains.
- Commit: `fix(images): reach assets through hooks, not a direct cross-plugin import`

### D1 — Plugin settings-store
`packages/core/src/plugins/settings-store.ts`: `readPluginSettings(pluginId)`,
`writePluginSettings(pluginId, value|patch)` + an injectable `onWrite` notifier. Replace the 5
hand-rolled copies (`plugin-registry` ctx getSettings/updateSettings, the catch-all ctx,
`plugin-settings/[pluginId].ts`, `agents/settings.ts`, `team/index.ts`). The host wires
`notifySettingsChange` + `broadcastPluginSettingsChanged` into it once — converging the diverging
notification behavior the audit flagged.
- **Accept:** typecheck + suite green; one settings read/write path; all sites notify consistently.
- Commit: `refactor(core): single settings-store for plugin settings read/write + notify`

### D2 — Promote atomicWriteJson
Move `atomicWriteJson` from `packages/core/src/install-core/atomic-write.ts` to a neutral
`packages/core/src/storage/atomic-write.ts` (+ a `writeTextAtomic` sibling), add an options bag
(`{mode, trailingNewline, suffix}`). Replace the hand-rolled tmp+rename **JSON** copies
(`memory/offsets`, `assets/manifest`, `workflows/approval-store`, `models/models-cache`,
`tasks/store`, …). **Do NOT touch** non-JSON atomic writers (log rotation in `logger.ts`,
`markdown-adapter`, `scoped-plugin-storage`, `self-update` binary, `secret-store` — already 0600)
unless they're trivially JSON. The 4 existing `install-core` consumers re-point to the new home.
- **Risk:** `memory/offsets` uses a fixed `.tmp` suffix (collision-prone) — the new util's
  per-pid/unique suffix is a strict improvement; verify offset persistence tests pass.
- **Accept:** typecheck + suite green; `atomicWriteJson` has one home; grep shows the JSON copies gone.
- Commit: `refactor(core): promote atomicWriteJson to storage/ and replace hand-rolled JSON writers`

### D3 — Frontmatter parsing module
`packages/core/src/format/frontmatter.ts`: `splitFrontmatter(raw)`, `parseYamlFrontmatter(raw)`,
`parseLessonFrontmatter(raw)` (superset of fields: title, tags, defaultEnabled). Replace the
`/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/` regex (×11 files), the verbatim `parseSkillFile` (×3:
`src/lib/plugin-skill-loader`, `plugins/workflows/lib/skill-loader`, …), and the hand-rolled lesson
parser (×4 agent-packages modules + `team/index.ts`).
- **Accept:** typecheck + suite green (skill-loader + lesson tests); regex defined once.
- Commit: `refactor(core): single frontmatter/skill/lesson parser module`

### D4 — Health-check result constructors
Export `healthOk`/`healthWarn`/`healthError(check, message, opts)` from `packages/core` (next to the
`HealthCheckResult` type) and re-export through `@makinbakin/sdk` so user plugins get them. Replace
the 13+ private `ok/warn/error` copies (two divergent signatures — `(check, message)` vs
`(check, message, extra)`) across the plugin health-checks.
- **Note:** `HealthCheckResult` is single-homed in the SDK (WS1) — put the *constructors* in core,
  SDK re-exports, matching the WS1 two-tier pattern (type in SDK, helpers reachable both ways).
- **Accept:** typecheck + suite green; constructors defined once; the 13+ sites use them.
- Commit: `refactor(core): shared healthOk/warn/error constructors`

### G1 — Architecture-test guards
Add to `tests/architecture/`: (a) `packages/sdk/src` in SCAN_ROOTS; (b) a rule failing any import
matching `from '../../<otherPluginId>/'` or `@bakin/<pluginId>` whose source file lives under
`plugins/<thisPluginId>/` (locks in K5/K6 — no cross-plugin imports). Config-surface governance
(finding 8's guard) ships with the (8) PR, not here.
- **Accept:** the new guards pass on the WS2 tree and FAIL on a deliberately-reintroduced violation
  (prove the guard bites).
- Commit: `test(architecture): guard cross-plugin imports + scan packages/sdk`

### PR gate
- `bun run test` + `typecheck` + `lint` green; `bun run build` (3 binaries, revert stamp files —
  build-stamp trap); `madge --circular` shows only the benign type-only SDK cycle; boot smoke in an
  isolated `BAKIN_HOME` (10 plugins load); optional dockerized-rig E2E re-run.
- Docs: `.claude/knowledge/{plugin-system,repo-architecture,adapter-architecture,workflows-plugin}.md`
  (registry homes moved; HookRegistry-boundary note); `CLAUDE.md` (the "exec-tool registry lives in
  scripts/" and "workflows registries" descriptions change). Update the plugin-communication +
  exec-tool-registration sections.
- Open PR `refactor/core-extractions`; Mark reviews/merges.

## Risks & mitigations
- **Cycle doesn't fully break (K4):** madge is the gate; iterate leaf extractions until clear. Don't
  declare done on typecheck alone.
- **globalThis singletons duplicated:** hook registry (K1), exec-tool registry (K2), workflow
  registries (K5) must each have exactly ONE module owning the globalThis cell + its reset; a second
  copy silently breaks HMR/`reset*`. Grep for the cell name after each move.
- **Module-load side effects:** registries self-seed on import; preserve seed-once semantics.
- **Test isolation:** new core modules touched by tests need the CLAUDE.md mocks (both content-dir
  resolvers, etc.); D1/D2 touch storage paths — mock accordingly.
- **Two-tier contract:** K3's factory and D4's constructors must not narrow core's fuller surface.

## Rollback
Each commit is an independent checkpoint (suite + typecheck green). Phase D commits are fully
independent of Phase K. K1→K2→K3→K5 have a forward dependency chain; revert in reverse. If review
prefers, Phase D can split into its own PR (`refactor/core-dedup`).
