# SPEC — Workflows: UI CRUD, Pluggable Workflows, Plugin Skill Installs

**Status:** Draft awaiting approval
**Owner:** main-operator@example.com
**Date:** 2026-04-19
**Next step:** `/agent-skills:plan` (must include commit/checkpoint strategy) → `/agent-skills:build` → `/agent-skills:test`

---

## 1. Problem & Framing

The workflows plugin is the core orchestration spine of Bakin. The runtime
(`plugins/workflows/lib/runtime.ts`, ~1200 LOC) works well — gates, parallel,
nested workflows, output validation, Discord approval, agent dispatch are all
proven in production.

What's missing is everything **around** the runtime:

1. **No UI CRUD.** Workflows are authored by hand-editing YAML in
   `~/.bakin/workflows/definitions/*.yaml`. The canvas at `/workflows/[id]`
   is read-only.
2. **Hardcoded node types.** The five step kinds (`agent | gate | parallel |
   output | workflow`) live in `plugins/workflows/types.ts`. There is no
   registry — adding a new kind means edits in 4+ places (types, parser,
   runtime switch, canvas component, schema validator).
3. **Workflows can't be shipped by other plugins.** All 7 live definitions
   sit loose in `~/.bakin/workflows/definitions/`. There is no install/upgrade
   pipeline. A future "SDR" or "image-creation" plugin has nowhere to put its
   workflows.
4. **Skill files are not bundled with the plugins that need them.** Skills
   live partly in `plugins/workflows/defaults/skills/` (4 markdowns, never
   wired to OpenClaw) and partly in `~/.openclaw/skills/` (synced by hand).
   When a new plugin needs a skill, there's no path to land it in
   `~/.openclaw/skills/{skill-name}/SKILL.md`.

This spec defines the architecture shift to fix all four, in priority order,
without breaking the running runtime.

---

## 2. Goals

In the user's priority order:

| # | Goal | Acceptance signal |
|---|------|-------------------|
| G1 | Create / edit / delete workflows from the UI | A user can build `video-script.yaml` end-to-end without touching the filesystem |
| G2 | Definitive pattern for node types (closed MVP set, extensible later) | Adding a new node type touches a single registry + one renderer; documented in `.claude/knowledge/workflows-plugin.md` |
| G3 | Plugins ship workflows; explicit upgrade flow | A new dummy `plugins/sdr-demo/` ships 2 workflow YAMLs that load at startup, show in the picker, and survive plugin upgrades without losing user state |
| G4 | Plugins ship skills; install pipeline syncs them to `~/.openclaw/skills/` | A new dummy plugin ships `defaults/skills/foo.md`, runs `bakin install plugin-assets`, and `~/.openclaw/skills/foo/SKILL.md` appears with idempotent re-runs |

---

## 3. Non-Goals (in scope of this work)

- Visual drag-and-drop workflow editing on the xyflow canvas → file as GitHub issue, defer to Phase 2.
- Plugin-registered custom node types (e.g. plugin defines a new "approval-via-slack" kind) → file as GitHub issue, design the registry in such a way that this is a straightforward future addition.
- Auto-upgrade of plugins. Upgrades are explicit user actions.
- Distribution / marketplace for plugins. Out of scope.
- Backwards-compat shims or migration of existing user workflow files. Single-machine, single-user — clean changes only.
- OpenClaw agent-internal files (`agents/{id}/agent/auth-profiles.json`, `models.json`, soul, rules). Those remain owned by team plugin / OpenClaw.
- A separate `~/.bakin/plugins/` user-installed plugin path (already supported by `loadUserPlugins`). We will reuse it; we will not redesign it.

---

## 4. User Stories

1. **Author a new workflow without leaving the browser.** From `/workflows`, click "New", pick a name, add steps from a typed form (agent + skill picker, gate with description, parallel container, nested workflow reference, output step), validate, save. The new YAML lands at `~/.bakin/workflows/definitions/{slug}.yaml`.
2. **Edit a user-owned workflow.** Open detail view → Edit → form prefilled → Save. YAML is rewritten atomically. Search index updates within 300 ms via the existing watcher path.
3. **Delete a workflow.** Confirm dialog warns if the definition is referenced as a sub-workflow by other definitions. On confirm, delete file, remove from search index.
4. **Use a plugin-shipped workflow.** A plugin (e.g. `plugins/sdr-demo`) ships `defaults/workflows/sdr-outreach.yaml`. After plugin activation, the workflow appears in `/workflows` tagged "Provided by sdr-demo (read-only)". Running it works exactly as a user-owned workflow does today.
5. **Fork a plugin-shipped workflow to edit it.** Click "Edit" on a plugin-owned workflow → confirm "Create a local copy and edit?" → a copy lands in `~/.bakin/workflows/definitions/{id}.yaml` with the same id and shadows the plugin version. The user copy is editable; the plugin copy is untouched.
6. **Plugin ships a skill.** `plugins/sdr-demo/defaults/skills/cold-email.md` exists. Running `bakin install plugin-assets` (or the aggregated `bakin onboard`) creates `~/.openclaw/skills/cold-email/SKILL.md`, owned by `plugin:sdr-demo`. Re-running is a no-op.
7. **Detect drift after plugin upgrade.** User pulls a new plugin version. `bakin doctor` reports: "plugin-assets: 2 skills updated upstream, 1 workflow updated upstream — run `bakin install plugin-assets` to apply." Nothing is changed without the user's explicit command.

---

## 5. MVP Scope vs Deferred

### In MVP

- Form-based UI editor for the closed node-type set.
- `WorkflowSource` registry that holds **plugin-shipped (read-only)** + **user-owned (editable)** definitions in one queryable view; user copy with the same id wins.
- `ctx.registerWorkflow(def)` plugin context API.
- `defaults/workflows/*.yaml` and `defaults/skills/*.md` convention for plugins.
- New `plugin-assets` onboarding component (modeled after `src/core/onboarding/models.ts`) that:
  - Inventories what plugins ship vs what's installed.
  - In `check()` mode: reports drift only.
  - In `install()` mode: copies skills to `~/.openclaw/skills/{name}/SKILL.md`, idempotent, with a `.userEdited` sentinel that protects user-modified skills (warn + skip).
- New CLI surface: `bakin install plugin-assets`, `bakin check plugin-assets`, integrated into `bakin onboard`.
- `bakin doctor` gains a `plugin-assets` section that surfaces drift.
- Update `.claude/knowledge/workflows-plugin.md` (new file) and `plugin-system.md` (existing).
- Move the 7 currently-loose live definitions into `plugins/workflows/defaults/workflows/` (the workflows plugin becomes a "provider" of its own historically-shipped workflows). `~/.bakin/workflows/definitions/` becomes user-owned only.

### Deferred (track via GitHub issues created during /build)

- **Phase 2A — Pluggable node types.** Pattern: `ctx.registerNodeType({ kind, runtime, renderer, zodSchema })`. The MVP node-type registry is built so adding this is a strict superset, not a refactor.
- **Phase 2B — Visual drag-and-drop workflow editor.** Replaces the form editor with canvas-native editing.
- **Phase 2C — Plugin distribution / marketplace.** Pulling plugins from a registry, signature verification, etc.
- **Phase 2D — User-edited skill rebase tooling.** Currently we just warn-and-skip; later we want a 3-way merge or "show me the diff" UX.

---

## 6. Locked Architecture Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| AD1 | Node types are a closed set in MVP: `agent`, `gate`, `parallel`, `output`, `workflow`. Held in a `NodeTypeRegistry` in the workflows plugin. | Reduces MVP surface; registry shape is forward-compat with plugin-registered types (Phase 2A). |
| AD2 | Plugin workflows are **registered in memory** via `ctx.registerWorkflow(def)`. They are **not copied** to `~/.bakin/`. | OpenClaw adapter principle — Bakin reads, never duplicates state into its own copy. Makes plugin upgrades trivial: ship new YAML in plugin repo, restart, done. |
| AD3 | Editing a plugin-owned workflow **forks** to `~/.bakin/workflows/definitions/{id}.yaml`. User copy with same id shadows plugin copy. | Keeps managed copy pristine; clean upgrade path. |
| AD4 | Skills live in plugin repos under `defaults/skills/*.md`. A `plugin-assets` onboarding component installs them into `~/.openclaw/skills/{name}/SKILL.md`. | Matches existing onboarding pattern; idempotent; user explicitly invokes. |
| AD5 | UI editor is **form-based** in MVP. | Ships fastest; testable with normal form/Zod patterns; visual editor is a Phase 2B issue. |
| AD6 | Upgrades are **explicit only**. `bakin doctor` reports drift; `bakin install plugin-assets` and (later) `bakin plugin upgrade <id>` apply. No background sync. | User does not want a moving target. |

---

## 7. Surface Area Changes

### New / changed types (`packages/core/src/plugin-types.ts`)

```ts
// New: workflow registration via PluginContext
interface PluginContext {
  // … existing fields …
  registerWorkflow(definition: WorkflowDefinition, opts?: { readOnly?: boolean }): void
  // (Phase 2A note) future: registerNodeType(...)
}
```

### New module (`plugins/workflows/lib/source-registry.ts`)

Holds the merged view of plugin-shipped + user-owned definitions. Exposes:

- `listAll(): { id, source: 'plugin'|'user', pluginId?, definition }[]`
- `get(id): merged definition (user wins)`
- `isReadOnly(id): boolean`
- `forkToUser(id): writes user copy and returns new path`

### New module (`plugins/workflows/lib/node-type-registry.ts`)

Closed for MVP, open shape:

```ts
interface NodeTypeDef<T = unknown> {
  kind: string
  zodSchema: z.ZodType<T>            // validated on save
  runtime: 'builtin'                 // MVP: builtin only
  renderer: ComponentType            // referenced by canvas
  formFields: FormField[]            // drives the editor
}
```

The 5 builtin node types register themselves at module load. Plugin-side registration API is added in Phase 2A.

### New module (`src/core/onboarding/plugin-assets.ts`)

Implements `OnboardingComponent`. `check()` walks loaded plugins, finds `defaults/skills/*.md` and `defaults/workflows/*.yaml`, compares to `~/.openclaw/skills/` and the workflow source registry, returns drift report. `install()` syncs skills to OpenClaw (idempotent, `.userEdited` sentinel respected).

### New routes (under `/api/plugins/workflows/`)

- `POST /definitions` — create user workflow (Zod-validated body, writes file, indexes search)
- `PUT /definitions/:name` — update user workflow
- `DELETE /definitions/:name` — delete user workflow (warns on inbound `workflow_id` refs)
- `POST /definitions/:name/fork` — fork plugin-owned to user copy

### New CLI subcommands

- `bakin install plugin-assets [--yes]`
- `bakin check plugin-assets`
- Both integrated into `bakin onboard` (added to the fixed dependency order in `src/core/onboarding/index.ts`)

### Knowledge docs

- **New:** `.claude/knowledge/workflows-plugin.md` — covers source registry, node-type registry, plugin authoring contract, install pipeline, fork-to-edit, drift detection.
- **Update:** `.claude/knowledge/plugin-system.md` — add `registerWorkflow` and the `defaults/workflows/`, `defaults/skills/` conventions.
- **Update:** `README.md` — short "Plugins can ship workflows and skills" paragraph + link to the knowledge doc.
- **Update:** `CLAUDE.md` — add a one-liner under "Plugin System" pointing at the new knowledge doc.

### Tests (separate file per concern, all mocking `getContentDir` per testing rules)

- `tests/plugins/workflows/source-registry.test.ts` — plugin/user precedence, fork, list shape.
- `tests/plugins/workflows/crud-routes.test.ts` — POST/PUT/DELETE/fork, Zod validation, index update, dependency-warning on delete.
- `tests/plugins/workflows/node-type-registry.test.ts` — registry shape, all 5 builtins resolvable, schema validation rejects bad inputs.
- `tests/core/onboarding/plugin-assets.test.ts` — drift detection, idempotent install, `.userEdited` skip.
- `tests/cli/install-plugin-assets.test.ts` — CLI smoke.
- E2E manual smoke (documented in `/test`): create → edit → fork → delete in browser; install dummy plugin; observe doctor drift; run install.

---

## 8. Boundaries

### Always do
- Mock `getContentDir` and `OPENCLAW_HOME` in every test that touches the filesystem.
- Validate at boundaries with Zod (route bodies, YAML parses, `registerWorkflow` arg).
- Use hooks (`workflows.*`) for cross-plugin runtime calls; never import across plugin packages.
- Resolve OpenClaw paths via `getOpenClawPath()`; never hardcode `~/.openclaw/`.
- Use `useQueryState` / `useQueryArrayState` for any new filter/view UI state.
- Use `Skeleton` and `EmptyState` for new lists/loads (per shared UI patterns).
- Update knowledge docs in the same commit that introduces the surface they describe.

### Ask first
- Any change that breaks an existing live workflow file in `~/.bakin/workflows/definitions/`.
- Any change that requires editing OpenClaw beyond writing to `~/.openclaw/skills/{name}/`.
- Adding a new permission key or settings field to existing plugins.
- Adding a new top-level `~/.bakin/` directory.

### Never do
- Copy plugin-shipped workflows into `~/.bakin/` automatically.
- Auto-upgrade or background-sync plugin assets.
- Add a parallel stat-tracking system; reuse `recordUsage`.
- Touch agent-internal files under `~/.openclaw/agents/{id}/`.
- Add backwards-compatibility shims; this is a single-machine install.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Refactoring around `runtime.ts` accidentally breaks running workflows | `runtime.ts` is read-only in this work. Source registry is consumed by the loader (`parser.ts`/`loadDefinition`), not by runtime. Smoke test the existing `video-script` end-to-end after every checkpoint. |
| Plugin fork creates phantom shadowing that confuses agents (running an old plugin def while UI shows new one) | `loadDefinition` always resolves through the source registry (user wins). Add a `definition.source` field to API responses so the UI labels which copy is in use. |
| `plugin-assets` installer overwrites user-edited skills | `.userEdited` sentinel is a sibling file written when the user edits a managed skill; installer respects it and warns. |
| Form editor diverges from YAML schema (UI lets you save invalid workflows) | Both share the **same Zod schema** from the node-type registry. The route handler validates with the same schema before write. |
| Plugin ships workflow that references a sub-workflow_id from another plugin → load order bug | Source registry's `get(id)` is lazy. Validation runs on first use, not at registration. Errors surface in the UI on save and at workflow start, not at server boot. |
| Doctor drift report becomes noisy (every plugin upgrade screams) | `check()` is silent if there's no drift; only flags when a hash differs. |

---

## 10. Open Questions

These do not block the spec but should be resolved during planning:

1. **Workflow id collisions across plugins.** If two plugins ship `image-generation.yaml`, who wins? Proposal: error at activation, log loudly, neither registers. Defer to plan.
Definitely an error at activation

2. **Fork rename.** When forking a plugin workflow, do we keep the same id (so existing references resolve) or auto-rename to `{id}-local`? Proposal: keep the id (shadowing semantics) — the whole point is to override.
Are you talking when a user manually wants to fork or are we forking somewhere automatically? If manual we dont need to support a formal "fork" pattern

3. **Should plugin-shipped workflows have a settings page entry?** Probably not in MVP — they're surfaced in `/workflows`. Confirm.
No I dont think so. No new settings that don't already exist? I guess if we have some already we'll need a way to support htat and keep the settings.

4. **Discord gate config for plugin workflows.** Workflows-plugin settings own this today (`discordGateAlerts`, `discordGateChannel`). Plugin-shipped workflows should still use those settings; no per-plugin gate channel in MVP.
Correct. I think some of the gates will become global and not a thing you can easily add.

---

## 11. Follow-ups (GitHub issues to file in /build)

- **Issue: "Phase 2A — Plugin-registered workflow node types"** — design `ctx.registerNodeType({ kind, runtime, renderer, zodSchema, formFields })`. Lay out the ID-namespacing rule (`{pluginId}.{kind}`), the SSR/client renderer split, and the runtime dispatch hook (`workflows.executeNode.{kind}`).
- **Issue: "Phase 2B — Visual drag-and-drop workflow editor"** — replace the form editor with on-canvas editing. Inline node config drawers, edge connection rules per node type, snap-to-grid. Reuse the same node-type registry + Zod schemas, so saved YAML stays interchangeable with the form editor.
- **Issue: "Phase 2C — Plugin distribution"** — pull plugins from registry/git, signature verification, `bakin plugin install <name>` end-to-end.
- **Issue: "Phase 2D — Skill rebase UX"** — replace warn-and-skip with a 3-way merge or diff view when a managed skill is locally modified.

---

## 12. Done When

- All G1–G4 acceptance signals pass on the live machine.
- New tests added; full suite green.
- `.claude/knowledge/workflows-plugin.md` exists; `plugin-system.md`, `README.md`, `CLAUDE.md` updated.
- Four follow-up GitHub issues filed.
- Existing live workflows (`video-script`, `clip-creation`, `image-generation`, `image-social-post`, `text-social-post`, `video-social-post`, `assemble-video`) all still run end-to-end.
