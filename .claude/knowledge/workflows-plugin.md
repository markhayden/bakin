# Workflows Plugin — Deep Reference

## Overview

The workflows plugin owns workflow **authoring**, **storage**, **resolution**, and the **canvas/editor UI**. The execution engine (`runtime.ts`) is treated as a black box — every change in the 2026-04 overhaul left it untouched.

Two registries make plugin-shipped workflows possible without breaking the existing user-owned YAML model:

- **Source registry** (`lib/source-registry.ts`) — in-memory index of every workflow definition the system knows about, keyed by id, with provenance (`plugin` vs `user`). User wins on collision.
- **Node-type registry** (`lib/node-type-registry.ts`) — single source of truth for the 5 builtin step types. The same Zod schemas drive both YAML parsing and the form editor — they cannot drift.

## Two Skill Systems (Don't Conflate)

The workflows surface uses the word "skill" in two different places. They are unrelated systems:

| | S-A — Workflow step skills | S-B — OpenClaw runtime skills |
|---|---|---|
| **Where it lives** | In-memory `pluginSkills` map + `~/.bakin/workflows/skills/*.md` | `~/.openclaw/skills/{name}/SKILL.md` (+ `scripts/`) |
| **Who reads it** | Bakin's workflow runtime (injects body into agent prompt) | OpenClaw agents at runtime |
| **How it ships** | `defaults/workflow-skills/*.md` → auto-registered by plugin loader at activation (`ctx.registerSkill`) | `defaults/openclaw-skills/{name}/` → installed to disk by `bakin install plugin-assets` |
| **Drift detection** | None — rebuilt every server boot | `.installedBy` JSON marker (sha256), `.userEdited` sentinel, `bakin doctor` surface |

**Rule of thumb:** if it's a workflow `step.skill: write-copy`, it's S-A. If it's something an agent invokes via `/skill foo` inside OpenClaw, it's S-B.

## Plugin Authoring Contract

A plugin that ships workflows + skills lays out three sibling directories under `defaults/`:

```
plugins/<id>/
  defaults/
    workflows/             # *.yaml — registered via ctx.registerWorkflow at activate()
    workflow-skills/       # *.md   — auto-registered via ctx.registerSkill at load (S-A, in-memory)
    openclaw-skills/       # {name}/SKILL.md (+ scripts/) — installed by `bakin install plugin-assets` (S-B, on disk)
```

None of the three are required. A plugin can ship any subset.

### How each gets loaded

| Directory | Loader | Trigger |
|-----------|--------|---------|
| `defaults/workflows/` | `plugins/workflows/lib/load-defaults.ts` (called from the workflows plugin's `activate()`) | Server boot, every startup |
| `defaults/workflow-skills/` | `src/lib/plugin-skill-loader.ts` (invoked by `src/lib/plugin-registry.ts` after every `activate()`) | Server boot, every startup, generic across all plugins |
| `defaults/openclaw-skills/` | `src/core/onboarding/plugin-assets.ts` (`scanPluginAssets` + `installPluginAssets`) | `bakin install plugin-assets` (manual), or surfaced by `bakin doctor` |

The first two paths are in-memory only — every reboot rebuilds them from disk. The third writes to the OpenClaw home and needs explicit drift management.

## Source Registry

`plugins/workflows/lib/source-registry.ts`. Backed by `globalThis.__bakinWorkflowSources` so state survives Next.js webpack re-evaluation.

```typescript
registerPluginDefinition(pluginId, id, definition)   // throws if a *different* plugin owns id; same plugin overwrite is allowed (hot reload)
unregisterPluginDefinitions(pluginId)                // wipes every entry for that plugin
registerUserDefinition(id, definition)               // user-owned (~/.bakin/workflows/definitions/) — silently shadows plugin entry
unregisterUserDefinition(id)
getDefinition(id) → SourceEntry | undefined          // user wins over plugin
listAll() → SourceEntry[]                            // resolved through user-wins rule
isReadOnly(id)                                       // true iff plugin-owned with no user shadow — CRUD routes refuse writes
```

`SourceEntry` carries `{ id, definition, source: 'plugin' | 'user', pluginId? }` so the UI can render badges and the routes can refuse plugin-owned writes.

### User-wins precedence

The user copy at `~/.bakin/workflows/definitions/{id}.yaml` always shadows a plugin copy with the same id. There is **no fork UI** — a user customizes a plugin workflow by either:

1. Clicking "Save as new" in the editor (creates a separate id with the form prefilled), OR
2. Manually dropping a YAML at `~/.bakin/workflows/definitions/{same-id}.yaml` (advanced; shadow happens automatically).

Cross-plugin id collisions are an activation-time error, but the loader catches the throw and continues with other plugins.

## Node-Type Registry

`plugins/workflows/lib/node-type-registry.ts`. 5 builtins self-register at module load:

| Kind | Schema | Purpose |
|------|--------|---------|
| `agent` | `agentStepSchema` | Dispatch to a single agent with skill + inputs |
| `gate` | `gateStepSchema` | Human (or auto-) approval before continuing |
| `parallel` | `parallelStepSchema` | Fan out to multiple steps; converge on completion |
| `output` | `outputStepSchema` | Final step that materializes workflow output |
| `workflow` | `nestedWorkflowStepSchema` | Invoke another workflow as a sub-step |

Each `NodeTypeDef<T>` carries:
- `kind` — string discriminator
- `runtime: 'builtin'` (forward-compat slot for plugin runtimes — see Phase 2A)
- `zodSchema` — validates step shape; aggregated by `workflowDefinitionSchema` into a discriminated union
- `formFields` — typed metadata that drives the per-step subform in the editor

The form editor uses `listNodeTypes()` to populate the type picker and `getNodeType(kind).formFields` to render the editor for the chosen type. The route validators (`POST /definitions`, `PUT /definitions/:name`) use the same `workflowDefinitionSchema` — saved YAML and form output are byte-equivalent.

`registerNodeType()` is the forward-compat hook for plugin-registered node types (Phase 2A in `.claude/specs/workflows-plugin-architecture.md`). It throws on duplicate `kind`.

## CRUD Routes

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/definitions` | List, including `source` and `pluginId` for plugin-owned entries |
| `GET` | `/definitions/:name` | Single definition with provenance |
| `POST` | `/definitions` | Validate against `workflowDefinitionSchema`, write to `~/.bakin/workflows/definitions/{slug}.yaml`. 409 on slug collision (user dir), 400 on Zod failure. |
| `PUT` | `/definitions/:name` | Same validation. **403 if `isReadOnly(name)`** — caller must POST a new id instead. |
| `DELETE` | `/definitions/:name` | **403 on plugin-owned**. 200 on user-owned; warning payload lists nested workflows pointing at the deleted id. |

The watcher syncs YAML → search index within ~300 ms, so no extra indexing call is needed in the routes.

## UI

| Page | Component |
|------|-----------|
| `/workflows` | `plugins/workflows/components/workflows-page.tsx` — grid of cards |
| `/workflows/:id` | `plugins/workflows/components/workflow-detail.tsx` — canvas + step drawer; read-only banner if `source === 'plugin'` |
| `/workflows/new` | wraps `workflow-editor.tsx` in create mode |
| `/workflows/:id/edit` | wraps `workflow-editor.tsx` in edit mode (refuses if plugin-owned without user shadow) |

`workflow-card.tsx` adds a "Provided by {pluginId}" badge when source is plugin. `workflow-editor.tsx` consumes the node-type registry's `formFields` to render per-step subforms — adding a new builtin (or, post-Phase 2A, a plugin-registered node type) makes it appear in the editor automatically.

## Plugin-Assets Install Pipeline (S-B)

```
~/.openclaw/skills/{name}/
  SKILL.md
  scripts/...
  .installedBy        ← {"pluginId": "<id>", "sha256": "<hex>"}
  .userEdited         ← optional empty sentinel — locks the dir from overwrite
```

`src/core/onboarding/plugin-assets.ts` exports:

```typescript
scanPluginAssets(plugins) → ScanReport       // {totalAvailable, missing, drifted, installed, userEdited}
installPluginAssets(plugins) → InstallReport // {installed, unchanged, skipped(userEdited)}
pluginAssetsComponent: OnboardingComponent   // .check() + .install() following the standard interface
```

`discoverPlugins()` reads `bakin.config.ts` (built-in plugins) and walks `~/.bakin/plugins/{id}/bakin-plugin.json` (user plugins). Every OpenClaw path resolves through `getOpenClawPath()` from `packages/core/src/openclaw-home.ts` — the installer never hardcodes `~/.openclaw/`.

Drift rules:
- **Missing** — no `SKILL.md` at the install path → `install` will copy.
- **Drifted** — install sha256 differs from source sha256 → `install` will overwrite.
- **`.userEdited` present** — `install` skips and reports under `skipped`. The sentinel is forever; user must delete it manually to opt back into managed updates. (Phase 2D issue tracks a 3-way merge UX.)

### CLI Surface

```bash
bakin install plugin-assets [--yes]    # apply pending installs
bakin check plugin-assets              # report drift, never write
```

Both are wired through `cmdOnboardingInstallSingle` / `cmdOnboardingCheckSingle` in `cli/bakin.ts`. `pluginAssetsComponent` is also part of `COMPONENT_ORDER` in `src/core/onboarding/index.ts`, so `bakin onboard --yes` covers it as a side effect on a fresh machine.

### Doctor Surface

`src/core/doctor.ts::checkPluginAssets()` calls `pluginAssetsComponent.check()` and renders one diagnostic line:

- `ok` — message echoes the component result (e.g. "0 plugin assets to install" or "All N plugin asset(s) installed").
- `warn` — message ends with the remediation reminder (`Run \`bakin install plugin-assets\` to apply.`). **Doctor never auto-installs.**

## Test Conventions

Same non-negotiable rules as the rest of the codebase:

- Every test mocks `getContentDir` to a temp dir.
- Every test that touches OpenClaw paths mocks `@bakin/core/openclaw-home` (`getOpenClawHome`, `getOpenClawPath`).
- The plugin-assets tests use a synthetic in-memory plugin under a temp dir — no checked-in fixture plugin.
- Source-registry tests call `clearSourceRegistry()` in `beforeEach`/`afterEach` so global state stays clean across cases.

## Key Files

| File | Purpose |
|------|---------|
| `plugins/workflows/lib/runtime.ts` | Workflow execution. **READ-ONLY in this overhaul.** |
| `plugins/workflows/lib/parser.ts` | `loadDefinition` + `listDefinitions` — consults the source registry first, falls back to disk |
| `plugins/workflows/lib/source-registry.ts` | Per-id source index with user-wins precedence |
| `plugins/workflows/lib/node-type-registry.ts` | Zod schemas + form metadata for the 5 builtins |
| `plugins/workflows/lib/load-defaults.ts` | Reads `defaults/workflows/*.yaml` and calls `ctx.registerWorkflow` per file |
| `plugins/workflows/lib/skill-loader.ts` | Resolves `step.skill` to in-memory body (S-A) |
| `plugins/workflows/components/workflow-editor.tsx` | Form-driven CRUD UI |
| `plugins/workflows/components/workflow-card.tsx` | Grid card with source badge |
| `plugins/workflows/components/workflow-detail.tsx` | Canvas + read-only banner |
| `src/lib/plugin-skill-loader.ts` | Generic auto-register for `defaults/workflow-skills/*.md` (called from plugin-registry) |
| `src/core/onboarding/plugin-assets.ts` | S-B install + drift |
| `src/core/onboarding/index.ts` | `COMPONENT_ORDER` includes `pluginAssetsComponent` |
| `src/core/doctor.ts::checkPluginAssets` | Drift surface in `bakin doctor` |
| `cli/bakin.ts` | `bakin install/check plugin-assets` dispatch |

## Future Work

Tracked as separate GitHub issues (Phase 2 follow-ups):

- **2A — Plugin-registered node types.** `ctx.registerNodeType({ kind, runtime, renderer, zodSchema, formFields })` with `{pluginId}.{kind}` namespacing.
- **2B — Visual drag-and-drop editor** on the canvas, replacing the form editor.
- **2C — Plugin distribution**: `bakin plugin install <name>` from a registry/git, signature verification, automatic `plugin-assets install` after upgrade.
- **2D — Skill rebase UX**: replace `.userEdited` warn-and-skip with 3-way merge and a UI for resolving conflicts.

See `.claude/specs/workflows-plugin-architecture.md` §11 and `.claude/specs/workflows-plugin-plan.md` §7 for full bodies.
