# PLAN — Workflows Plugin Overhaul

**Status:** Draft awaiting approval
**Source spec:** `.claude/specs/workflows-plugin-architecture.md`
**Owner:** roscoe@madeinwyo.com
**Date:** 2026-04-19
**Next step:** `/agent-skills:build` task-by-task → `/agent-skills:test`

---

## 0. Open-question resolutions (from spec §10)

| Q | Spec answer | Plan resolution |
|---|-------------|-----------------|
| Q1 — id collisions across plugins | "Definitely an error at activation" | `registerWorkflow` throws if id is already registered by another plugin. Activation continues for other plugins; the offending one is marked failed in the registry snapshot (already shown on the health page). User-owned (`~/.bakin/`) copies always shadow, so they never trigger collision. |
| Q2 — fork pattern | "If manual we don't need a formal fork pattern" | **No "Fork" UI button. No `/fork` route. No `forkToUser()` registry method.** Plugin workflows are read-only in the UI. To customize: user clicks "Save as new" (creates a separate id with the form prefilled), or manually drops a YAML at `~/.bakin/workflows/definitions/{same-id}.yaml` (advanced; shadowing semantics still work but undocumented). |
| Q3 — per-plugin settings page | "No new settings that don't already exist" | No per-workflow or per-plugin workflow settings. Existing workflows-plugin settings (`gateTimeout`, `maxConcurrentSteps`, `notifyOnGate`, Discord) remain global and apply to all workflows regardless of source. |
| Q4 — Discord gate config | "Some gates will become global" | No change in this work. Discord gate alerts remain workflows-plugin settings. Note as future direction in Phase 2A issue. |

**Two skill systems — confirmed split (S-A in-memory Bakin, S-B installable OpenClaw):**

The spec conflated two distinct "skill" systems:

- **(S-A) Workflow step skills** — `.md` instruction docs that **Bakin's workflow runtime** injects into agent prompts when a step says `skill: <name>`. Loaded via `plugins/workflows/lib/skill-loader.ts` from in-memory `getPluginSkills()` (populated by `ctx.registerSkill()`) or `~/.bakin/workflows/skills/`. Agents in OpenClaw **never read these from disk** — they receive the instructions baked into the dispatched step prompt. `ctx.registerSkill()` is Bakin-only, in-memory.
- **(S-B) OpenClaw runtime skills** — full skill packages at `~/.openclaw/skills/{name}/SKILL.md` (+ `scripts/`, frontmatter with env requirements). Invoked by OpenClaw agents directly at runtime, not by Bakin's workflow runtime. Examples already on disk: `runway`, `elevenlabs-audio`, `stitch`.

**The split this plan implements:**

- **S-A handled in-memory.** Plugins put `.md` files in `plugins/{id}/defaults/workflow-skills/`. The plugin loader auto-calls `ctx.registerSkill()` for each at activation. **No filesystem install.** No drift detection needed — they're rebuilt on every server boot.
- **S-B handled by `plugin-assets` installer.** Plugins put a directory at `plugins/{id}/defaults/openclaw-skills/{skill-name}/SKILL.md` (+ optional `scripts/`). The installer copies to `~/.openclaw/skills/{name}/`. This is the path that needs `.userEdited` sentinel + `bakin doctor` drift detection (per spec).

**No dummy plugin shipped in this work** — the workflows plugin itself is the first real consumer of `ctx.registerWorkflow` (its 7 historical YAMLs). The plugin-assets installer ships with no payload to install in MVP; the first plugin to ship `defaults/openclaw-skills/` will be the first real exercise. Tests use synthetic in-memory plugin fixtures (temp dirs), not a real plugin checked into the repo.

---

## 1. Architecture Recap

```
   Plugin authoring contract (any plugin):
   plugins/{id}/
     defaults/workflows/*.yaml         ← registered via ctx.registerWorkflow (S-A in-memory)
     defaults/workflow-skills/*.md     ← registered via ctx.registerSkill   (S-A in-memory)
     defaults/openclaw-skills/{name}/  ← installed to ~/.openclaw/skills/{name}/ (S-B disk)
                                         by `bakin install plugin-assets`

   Phase A/B real consumers in this work: the workflows plugin itself ships its 7
   historical YAMLs through this path. No dummy plugin is added to the repo.

                          ▼ activate() ▼
plugins/workflows/lib/source-registry.ts ←─── merges plugin defs + ~/.bakin/ user defs
                  │ user copy with same id wins
                  │
                  ▼
plugins/workflows/lib/parser.ts (loadDefinition)  ← unchanged callers everywhere
plugins/workflows/lib/runtime.ts                  ← UNCHANGED — behavior preserved

plugins/workflows/lib/node-type-registry.ts (NEW)
  └─ holds Zod schemas + form-field metadata for the 5 builtins
     used by both: route validation AND form editor

plugins/workflows/components/
  workflow-editor.tsx (NEW)   ← form-driven CRUD (page wrappers under src/app/workflows/)

src/core/onboarding/plugin-assets.ts (NEW)
  └─ check() + install() for S-B OpenClaw skill packages
     (no payload in MVP — first plugin to ship defaults/openclaw-skills/ exercises it)

cli/bakin.ts
  ├─ bakin install plugin-assets [--yes]
  └─ bakin check plugin-assets

src/core/doctor.ts
  └─ surfaces plugin-assets drift (read-only; never auto-syncs)
```

---

## 2. Dependency Graph (what blocks what)

```
T1 (node-type registry)
  └─→ T2 (source registry) ─┐
        └─→ T3 (loader rewire — parser + index.ts use registry)
              ├─→ T4 (registerWorkflow API + plugin-types update)
              │     └─→ T5 (move 7 live defs into workflows plugin defaults)
              │           └─→ T6 (UI list shows source label)
              ├─→ T7 (CRUD routes: POST/PUT/DELETE) ─→ T8 (form editor UI)
              └─→ T9 (workflow-skills auto-register)
                    └─→ T10 (plugin-assets onboarding component — S-B only)
                          ├─→ T11 (CLI: bakin install/check plugin-assets)
                          └─→ T12 (doctor surface)

T13 (knowledge docs + README + CLAUDE.md)        ← runs in parallel; commits glued to features
T14 (file 4 GitHub issues)                       ← end of work
T15 (final verification — 7 live workflows still run; full test suite green)
```

Vertical slicing: each task ships one **complete path** (data + API + UI + tests + docs where applicable), not a horizontal layer.

---

## 3. Tasks

Each task = one commit. Each commit must build green and leave existing workflows running. **Bold = "stop and verify on the live machine" gate.**

### Phase A — Foundation (refactor, no behavior change)

#### T1 · `feat(workflows): add node-type registry with Zod schemas for the 5 builtins`
- New: `plugins/workflows/lib/node-type-registry.ts` exporting `NodeTypeDef<T>`, `registerNodeType()`, `getNodeType()`, `listNodeTypes()`.
- Schemas: `agentStepSchema`, `gateStepSchema`, `parallelStepSchema`, `outputStepSchema`, `nestedWorkflowStepSchema` (Zod, all 5 builtins). Builtins self-register at module load.
- Add a discriminated-union `workflowDefinitionSchema` that delegates per-step via the registry — single source of truth.
- New: `tests/plugins/workflows/node-type-registry.test.ts` — registry shape, all 5 builtins resolvable, schema rejects bad inputs (e.g. `agent` step missing `agent` field).
- **Does NOT modify `parser.ts` or `runtime.ts` yet** — purely additive.
- Acceptance: `npm test -- node-type-registry` passes; existing tests untouched.

#### T2 · `feat(workflows): add source registry (plugin + user definitions, user wins)`
- New: `plugins/workflows/lib/source-registry.ts` with `registerPluginDefinition(pluginId, def)`, `unregisterPluginDefinitions(pluginId)`, `listAll()`, `get(id)`, `isReadOnly(id)`, `getSource(id)`.
- Backed by `globalThis.__bakinWorkflowSources` Map (per `feedback_globalthis_sse` memory) so Next.js webpack re-evaluation doesn't lose state.
- **Activation-time collision rule:** if id already registered by a different plugin, `registerPluginDefinition` throws with a clear message; caller (plugin loader / index.ts) logs but doesn't abort.
- New: `tests/plugins/workflows/source-registry.test.ts` — precedence, collision throws, list shape with mixed sources.
- **Does NOT replace `loadDefinition` yet** — additive.
- Acceptance: new tests pass; existing tests untouched.

#### T3 · `refactor(workflows): route loader through source registry; move existing user defs out of code path`
- `plugins/workflows/lib/parser.ts::loadDefinition()` and `listDefinitions()` both consult source registry first, fall back to disk read of `~/.bakin/workflows/definitions/`.
- Returned shape gains a `source: 'plugin' | 'user'` and optional `pluginId` field — callers that don't care can ignore it.
- Update the 4 hooks (`workflows.loadDefinition`, `workflows.listDefinitions`) and `GET /definitions`, `GET /definitions/:name` routes to surface `source`/`pluginId`.
- Update `tests/plugins/workflows/parser.test.ts` to cover the registry-source path.
- Acceptance: full test suite green. **GATE → Live smoke: load `/workflows`, click `video-script`, observe canvas renders identically. No regressions to `runtime.test.ts` or `routes.test.ts`.**

### Phase B — Plugin-shipped workflows

#### T4 · `feat(core): add ctx.registerWorkflow to PluginContext`
- `packages/core/src/plugin-types.ts`: add `registerWorkflow(def: WorkflowDefinition, opts?: { readOnly?: boolean }): void` to `PluginContext`.
- `src/lib/plugin-registry.ts::buildContext`: implement; calls source-registry's `registerPluginDefinition`. Wraps the throw so a colliding plugin logs an error but does not crash startup.
- Update `.claude/knowledge/plugin-system.md` — add `registerWorkflow` row to the context table; mention `defaults/workflows/`, `defaults/workflow-skills/`, `defaults/openclaw-skills/` conventions.
- New: `tests/lib/plugin-registry.test.ts` (or extend existing) — collision throws and is contained.
- Acceptance: new tests pass; existing plugin-loader tests untouched.

#### T5 · `refactor(workflows): move 7 live YAMLs into plugins/workflows/defaults/workflows/, register on activate`
- Copy the 7 user-owned YAMLs from `~/.bakin/workflows/definitions/` into `plugins/workflows/defaults/workflows/` (the workflows plugin becomes the provider of its own historical workflows).
- `plugins/workflows/index.ts::activate()` reads `defaults/workflows/*.yaml` at startup and calls `ctx.registerWorkflow(def, { readOnly: true })` for each.
- The user's `~/.bakin/workflows/definitions/` keeps any existing files; if any happen to shadow a moved one, user wins (already covered by T2/T3).
- Update `bakin-plugin.json::contentFiles` — drop `workflows/definitions/` from the list (no longer required).
- Update `plugins/workflows/defaults/definitions/video-script.yaml` location: move to `defaults/workflows/` (rename folder for consistency); delete the now-empty `defaults/definitions/`.
- Acceptance: server start logs "Workflows plugin: registered 7 workflows from defaults". `GET /api/plugins/workflows/definitions` returns same templates with `source: 'plugin'` for each. **GATE → Live smoke: existing workflows on the board still run; pick one with active state and confirm next step dispatches.**

#### T6 · `feat(workflows): show source badge on workflow cards + read-only banner on detail page`
- `plugins/workflows/components/workflow-card.tsx`: add a small badge: "Provided by {pluginId}" when `source === 'plugin'`, or no badge for user.
- `plugins/workflows/components/workflow-detail.tsx`: read-only banner ("Provided by {pluginId} — read-only. Use 'Save as new' to customize.") when plugin-owned.
- `tests/plugins/workflows/workflows-page.test.tsx`: extend to verify badge appears for plugin source. Use synthetic plugin fixture (in-memory `registerPluginDefinition` call) for the test, not a checked-in plugin.
- Acceptance: visual smoke — the 7 workflows-plugin-shipped definitions show "Provided by workflows" badge; any user-created ones don't.

### Phase C — UI CRUD

#### T7 · `feat(workflows): add CRUD routes (POST/PUT/DELETE definitions) — user definitions only`
- New routes in `plugins/workflows/index.ts`:
  - `POST /definitions` — body validated against `workflowDefinitionSchema` (T1); writes `~/.bakin/workflows/definitions/{slug}.yaml`; 409 if slug already exists in user dir; 400 if schema invalid.
  - `PUT /definitions/:name` — same validation; 403 if `isReadOnly(name)` (i.e., the route resolved to a plugin-owned id and there's no user copy yet); 404 if not found.
  - `DELETE /definitions/:name` — 403 on plugin-owned; 200 on user; warning payload includes any other definitions whose `workflow_id` points at this id.
- Watcher already syncs YAML → search index within 300 ms (per CLAUDE.md). No additional indexing call needed; verify in test.
- New: `tests/plugins/workflows/crud-routes.test.ts` — happy paths + edge cases (Zod rejection, slug collision, plugin shadow handling, dependency warning).
- Acceptance: `curl -XPOST` from terminal can create a workflow visible in `/workflows`.

#### T8 · `feat(workflows): add form-based workflow editor UI (create + edit + save-as-new + delete)`
- New: `app/workflows/new/page.tsx` and `app/workflows/[id]/edit/page.tsx`.
- New: `plugins/workflows/components/workflow-editor.tsx` — form-driven editor:
  - Top-level fields: name, description, version, inputs (key→type/desc/required).
  - Steps list with add/remove/reorder buttons.
  - Per-step: dropdown of node types (from `listNodeTypes()`), then a typed sub-form rendered from the node type's `formFields` metadata. Agent picker (existing `AgentSelect`), skill picker (fetched from `/api/plugins/workflows/skills` — new tiny route or computed client-side from registered skills).
  - Save → `POST` (new) or `PUT` (edit). Save-as-new on a plugin workflow → `POST` with a new id.
  - Delete button on user workflows → confirm dialog → `DELETE`.
- Use shadcn `dialog`, `select`, `input`, `textarea`, `button`. Use `Skeleton` while loading; `EmptyState` for empty steps.
- URL state for editor mode if relevant (probably not — editor is a separate page, not a filter).
- New: `tests/plugins/workflows/workflow-editor.test.tsx` — render, add step, validate, save (mock fetch).
- Acceptance: **GATE → Live smoke: rebuild `video-script` from scratch in the browser as a new user workflow, save, run it, gates approve normally. Save-as-new from `clip-creation`, modify a description, re-save, re-run.**

### Phase D — Plugin assets installer

#### T9 · `feat(workflows): auto-register plugin workflow-skills from defaults/workflow-skills/*.md`
- New helper invoked by the plugin loader (in `src/lib/plugin-registry.ts` or a small `lib/plugin-defaults-loader.ts`) — when any plugin activates, scan its `defaults/workflow-skills/*.md`, parse frontmatter + body, register via `ctx.registerSkill()`. Generic across all plugins, not workflows-specific.
- Move the 4 existing `.md` files from `plugins/workflows/defaults/skills/` into `plugins/workflows/defaults/workflow-skills/` (rename folder for clarity vs new `defaults/openclaw-skills/`).
- New: `tests/lib/plugin-registry.test.ts` extension — auto-register works using a synthetic in-memory plugin fixture; collision behavior matches `registerSkill` first-wins rule.
- Acceptance: `bakin_exec_get_step` for a workflow that uses `skill: write-copy` resolves identically before/after.

#### T10 · `feat(core): add plugin-assets onboarding component (OpenClaw skill install + drift)`
- New: `src/core/onboarding/plugin-assets.ts` implementing `OnboardingComponent`:
  - `check()`: walk `pluginRegistry.getPluginIds()`, find each plugin's source dir on disk, look for `defaults/openclaw-skills/{name}/SKILL.md`, compare hashes against `~/.openclaw/skills/{name}/SKILL.md`. Returns drift report (`{installed, updated, missing}`). Status `ok` if no drift; `warn` if drift; `missing` if any plugin skill not yet installed.
  - `install(opts)`: for each missing/updated entry, copy the directory tree to `~/.openclaw/skills/{name}/`, **respecting `.userEdited` sentinel** (skip + warn if present). Records ownership by writing `.installedBy` with `pluginId` and source hash.
  - Idempotent — second `install()` is a noop.
- Use `getOpenClawPath()` for OpenClaw paths (CLAUDE.md rule).
- **MVP payload:** zero — no plugin currently ships `defaults/openclaw-skills/`. Component is plumbing only; ready for the first plugin that needs it. The check returns "0 plugin assets to install" in the happy path on the live machine.
- New: `tests/core/onboarding/plugin-assets.test.ts` — drift detection, idempotent install, `.userEdited` skip, hash comparison. All scenarios use a synthetic plugin fixture under a temp dir (no checked-in plugin needed).
- Acceptance: synthetic fixture test: a plugin under temp dir with a `defaults/openclaw-skills/foo/SKILL.md` triggers drift; `install()` materializes it; second `install()` is noop. On the live machine: `check()` returns `ok` with "0 to install".

#### T11 · `feat(cli): add bakin install plugin-assets and bakin check plugin-assets; wire into bakin onboard`
- `cli/bakin.ts`: extend `case 'install'` and `case 'check'` to accept `plugin-assets`; reuse `cmdOnboardingInstallSingle` / `cmdOnboardingCheckSingle` helpers.
- Add `pluginAssetsComponent` to `COMPONENT_ORDER` in `src/core/onboarding/index.ts` after `mcporter` (depends on plugins being loadable — it doesn't require the server running, just the plugin source on disk).
- New: `tests/cli/install-plugin-assets.test.ts` — CLI smoke (mocking the component).
- Update `--help` output and any onboarding-printed status table.
- Acceptance: `bakin install plugin-assets --yes` runs cleanly on the live machine and reports "0 plugin assets to install".

#### T12 · `feat(doctor): surface plugin-assets drift in bakin doctor output`
- `src/core/doctor.ts`: add a section that calls `pluginAssetsComponent.check()` and prints the drift report. Status icon matches existing convention.
- No auto-install. Just a reminder line: "Run `bakin install plugin-assets` to apply."
- Update `tests/core/doctor.test.ts` (or new file) to assert the new section appears when drift exists; uses synthetic plugin fixture.
- Acceptance: **GATE → Live smoke: `bakin doctor` runs cleanly and shows the new (empty) plugin-assets section without errors. Synthetic-fixture test proves the drift line surfaces correctly when drift exists.**

### Phase E — Docs + issues + final verification

#### T13 · `docs(workflows): add knowledge doc, update plugin-system / README / CLAUDE.md`
- New: `.claude/knowledge/workflows-plugin.md` — covers source registry, node-type registry, plugin authoring contract (`defaults/workflows/`, `defaults/workflow-skills/`, `defaults/openclaw-skills/`), CRUD routes, install pipeline, drift detection, the no-fork rule, the global Discord settings note, the S-A vs S-B skill distinction.
- Update `.claude/knowledge/plugin-system.md` — add `registerWorkflow` to the `PluginContext` table; expand the conventions section with the three `defaults/` directory names.
- Update `README.md` — short paragraph "Plugins can ship workflows and skills" pointing at the new knowledge doc.
- Update `CLAUDE.md` — one-liner under "Plugin System" pointing at the new knowledge doc; one-liner under "Directory Map → defaults/" describing the three `defaults/` subdirs.
- Acceptance: docs build green; cross-links resolve.

#### T14 · `chore: file Phase 2 GitHub issues (2A pluggable nodes, 2B visual editor, 2C distribution, 2D skill rebase)`
- Use `gh issue create` (CLI is authorized per recent history). Bodies derived from spec §11.
- Acceptance: 4 issue URLs returned to the user.

#### T15 · `test: full sweep + live workflow smoke` *(verification, no commit)*
- `npm test` full pass.
- `npm run lint` (or whatever the repo uses) — no new errors.
- Manually run all 7 live workflows end-to-end: `video-script`, `clip-creation`, `image-generation`, `image-social-post`, `text-social-post`, `video-social-post`, `assemble-video`.
- Confirm each passes its first gate; full execution not required for non-trivial workflows but the dispatch + first-gate path must work.
- If anything regressed, file as a hotfix task before declaring done.

---

## 4. Commit Strategy

### 4.1 Per-commit invariants (non-negotiable)

Every commit in this work MUST satisfy all of these. If any fails, fix before pushing the commit — never `--amend`, never `--no-verify`.

| # | Invariant | How verified |
|---|-----------|--------------|
| C1 | **Atomic.** One task per commit. Reverting the commit cleanly removes that task without breaking anything earlier in history. | `git revert <sha>` on a scratch branch leaves a green build. |
| C2 | **Build green.** TypeScript compiles, no new lint errors. | `npx tsc --noEmit` + project's lint command run before commit. |
| C3 | **Tests green.** New tests for the task pass. Full existing suite still passes (no regressions). | `npx vitest run` (or scoped to changed files first, then full sweep). |
| C4 | **Existing workflows still load.** The 7 production YAMLs in `~/.bakin/workflows/definitions/` still parse via `loadDefinition()`. | A small in-suite assertion or a manual `bakin search --table workflows` on the live machine at each gate. |
| C5 | **Conventional-commit message** with scope: `<type>(<scope>): <imperative summary>`. Body explains *why*, references task ID (T1…T15) and spec section, and notes any deviation from the plan. | Commit-msg template below. |
| C6 | **Co-author trailer.** Every commit ends with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`. | HEREDOC template below. |
| C7 | **Docs ride along.** Knowledge-doc snippets land in the same commit that introduces the surface they describe. T13 is a backstop, not the primary doc commit. | Code-review check during build. |
| C8 | **runtime.ts untouched.** `git diff HEAD plugins/workflows/lib/runtime.ts` is empty for the entire work. | Pre-commit check. |
| C9 | **No `~/.bakin/` writes from tests.** Every new test mocks `getContentDir` and `getOpenClawHome` to a tmp dir. | Code review + test path assertions. |

### 4.2 Allowed conventional-commit types and scopes

```
<type>(<scope>): <imperative summary, ≤72 chars>

<body — why this change, what tradeoffs, deviations from plan>

Refs: T<N> · spec §<section>
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

| Type | When |
|------|------|
| `feat` | New user-visible behavior or new public API |
| `refactor` | Internal restructure with no behavior change |
| `fix` | Bug fix |
| `test` | Test-only addition |
| `docs` | Doc-only change |
| `chore` | Tooling, config, repo hygiene (issue filing in T14) |

| Scope | Used for |
|-------|----------|
| `workflows` | The workflows plugin (`plugins/workflows/`) |
| `core` | `src/core/`, `src/lib/`, `packages/core/` |
| `cli` | `cli/bakin.ts` |
| `doctor` | `src/core/doctor.ts` |
| `plugins` | Cross-plugin or new plugin (n/a in this work; sdr-demo dropped) |

### 4.3 Phase checkpoints

| Phase | Commits | Live-machine gate |
|-------|---------|-----------|
| A — Foundation | T1, T2, T3 | After T3: existing workflows still load + run |
| B — Plugin workflows | T4, T5, T6 | After T5: workflows-plugin-shipped defs resolve. After T6: UI badges visible. |
| C — UI CRUD | T7, T8 | After T8: build + edit a workflow end-to-end in browser |
| D — Plugin assets | T9, T10, T11, T12 | After T12: `bakin doctor` runs cleanly with empty plugin-assets section |
| E — Docs + ship | T13, T14, T15 | Final verification gate |

### 4.4 Rollback strategy

- **Single-task rollback:** `git revert <sha>` on the offending task. Because each task is atomic (C1) and later tasks list their dependencies, the operator knows immediately whether dependent tasks must also be reverted.
- **Whole-phase rollback:** revert each task in the phase in reverse order. Phase boundaries are designed as natural rollback points.
- **No history rewriting** of commits already on `main`. If a mistake is caught after push, it's a new revert commit, not a rebase.
- **Branch hygiene:** all work happens directly on `main` (single-machine, single-user — no PRs). Worktree branches from §5 below are merged via fast-forward and the source branch is deleted immediately after merge.

---

## 5. Parallelism Strategy

Maximize wall-clock throughput by exploiting the dependency graph in §2. Two parallelism mechanisms are in play:

### 5.1 Independent task groups (the ones that can actually overlap)

| Group | Tasks | Dependency |
|-------|-------|-----------|
| **G-α** | T1, T2 | Both purely additive, no shared files. Can be drafted in parallel; commits can land in either order. |
| **G-β** | T4, T7, T9 | All gated only on T3 landing. T4 touches `packages/core/` + `src/lib/plugin-registry.ts`; T7 touches `plugins/workflows/index.ts` (route registration); T9 touches `src/lib/plugin-registry.ts` again. **T4 and T9 will conflict in `plugin-registry.ts`** — schedule them sequential within the group, but T7 can run in parallel with either. |
| **G-γ** | T11, T12 | Both gated on T10. Different files (`cli/bakin.ts` vs `src/core/doctor.ts`). Trivially parallel. |
| **G-δ** | T13 doc snippets | Each phase's doc snippet rides with its feature commit (per C7). The remaining "knowledge doc shell + cross-link audit" lands as T13. |

### 5.2 Mechanisms

**Worktree-isolated subagents (the heavy lifting).** For task groups with ≥2 tasks of nontrivial size, spawn `Agent` calls with `isolation: "worktree"` so each agent works on an isolated git copy. The main agent merges completed worktrees back to `main`.

| Group | Heavy enough for worktrees? | Strategy |
|-------|-----------------------------|----------|
| G-α (T1, T2) | Borderline — small files | Single agent, sequential. Worktree overhead not worth it. |
| G-β (T4, T7, T9) | **Yes — T7 is ~200 LOC of routes + tests** | Two parallel worktrees: (1) T4 then T9 (sequential because they share `plugin-registry.ts`), (2) T7 (independent). |
| G-γ (T11, T12) | Marginal | Single agent, sequential. Both small. |

**Explore subagents (context loading).** Before any task that touches multiple existing files (T3, T7, T8, T10), fire a quick `Agent(subagent_type=Explore, thoroughness=quick)` to map current callers / patterns / test conventions. Runs concurrently with the test-writing step. Costs ~30s, saves 5+ min of grepping.

**Doc snippets in parallel with feature commits.** When committing T1, the same commit also touches the relevant section of `.claude/knowledge/workflows-plugin.md` (creating it if needed). T13 becomes a thin "stitch the doc together + audit cross-links" pass at the end, not a giant doc dump.

### 5.3 Parallel-execution rules

| # | Rule | Reason |
|---|------|--------|
| P1 | Worktree subagents never share a file with each other. The dependency-graph table in §5.1 is authoritative — if two parallel tasks both touch `plugin-registry.ts`, they go sequential. | Eliminates merge conflicts entirely. |
| P2 | Each worktree subagent commits its work in the worktree before signaling done. The main agent merges via `git merge --ff-only` (or rebases the worktree branch onto current main and fast-forwards). | Preserves atomic per-task commits; no merge commits in the history. |
| P3 | If two parallel branches both pass tests in isolation but the merged result fails, the SECOND merge is reverted and re-attempted serially after a quick re-test on top of the first. | Catches the rare semantic conflict (e.g. shared global registry collision) that file-level disjointness misses. |
| P4 | The main agent runs the live-machine gate on `main` after all worktree merges in a phase have landed, not per-worktree. | A gate verifies the integrated state, not each branch individually. |
| P5 | Don't parallelize doc commits. T13's "stitch + cross-link audit" must be the last commit of phase E so it can see the final shape of every other change. | Avoids doc-rewrite churn from later commits invalidating earlier doc passes. |
| P6 | The user can interrupt at any phase boundary; in-flight worktree subagents are allowed to complete their current task before the main agent stops, so no half-work is left on the floor. | Clean handoff. |

### 5.4 Updated execution timeline (with parallelism applied)

```
Phase A:  T1 → T2 → T3                           (sequential, small tasks; G-α not worth worktrees)
   gate
Phase B:  T4 → T5 → T6                           (sequential — T5 depends on T4, T6 depends on T5)
   gate
Phase C:  ┌─ T7 (worktree #1) ─┐
          └─ T8 PREP only      ┘                 (T8 depends on T7's routes; can't fully parallelize)
   T7 lands → main → T8 starts                   (T8 needs T7 routes to wire to)
   gate
Phase D:  ┌─ T9 (worktree #2) ─┐
          └─ T10 (worktree #3, no shared files)  (T9 and T10 both gated on T3, not on each other)
   T9 + T10 land → main → T11 + T12 in parallel  (both gated on T10)
   gate
Phase E:  T13 → T14 → T15                        (sequential by design; T13 is the stitch pass)
```

Estimated wall-clock saved by parallelism: ~25-35% versus pure sequential. Realized only if the user invokes the build skill with the parallelism mechanism (worktree subagents) actually enabled — pure single-thread execution remains correct, just slower.

---

## 5. Risk Register (per phase)

| Phase | Top risk | Mitigation |
|-------|---------|-----------|
| A | T3 silently changes `loadDefinition()` resolution and a workflow loads stale data | Source registry returns the same shape; existing tests catch regressions. The live smoke after T3 is the explicit gate. |
| B | T5 moves YAMLs and a previously edited user copy is lost | Plan does not delete from `~/.bakin/`. The 7 YAMLs in `~/.bakin/workflows/definitions/` are left in place; if user edits exist, they win via shadowing. We can `git diff --stat` the source vs ~/.bakin/ before the move and call out any divergence in the commit message. |
| C | Form editor saves YAML the runtime can't load | Same Zod schema (`workflowDefinitionSchema` from T1) drives both the route validation AND the form's per-step subform. Tests assert: any form-saveable workflow is loadable by `parser.ts`. |
| D | `plugin-assets` overwrites a user-edited OpenClaw skill | `.userEdited` sentinel respected; if absent, hash comparison still gates overwrite (skip-if-no-diff-from-last-installed-hash to catch the "user edited but didn't write the sentinel" case). |
| D | Doctor noise — every plugin upgrade screams | `check()` is silent on `ok`; only prints when drift exists. |
| E | Spec drift between code and `.claude/knowledge/workflows-plugin.md` | Knowledge doc is part of T14, lands together with the surface it describes. Future doc updates piggy-back on the conventional-commit `docs(workflows)` scope. |

---

## 6. Test Inventory (added in this work)

All mock `getContentDir` and `OPENCLAW_HOME` per CLAUDE.md non-negotiable rule. Each test file scoped to one concern.

- `tests/plugins/workflows/node-type-registry.test.ts` — T1
- `tests/plugins/workflows/source-registry.test.ts` — T2
- `tests/plugins/workflows/parser.test.ts` (extension) — T3
- `tests/lib/plugin-registry.test.ts` (extension or new) — T4 + T9 (synthetic in-memory plugin fixtures)
- `tests/plugins/workflows/workflows-page.test.tsx` (extension) — T6
- `tests/plugins/workflows/crud-routes.test.ts` — T7
- `tests/plugins/workflows/workflow-editor.test.tsx` — T8
- `tests/core/onboarding/plugin-assets.test.ts` — T10 (synthetic plugin under temp dir)
- `tests/cli/install-plugin-assets.test.ts` — T11
- `tests/core/doctor.test.ts` (extension or new) — T12

E2E manual smoke documented in `/agent-skills:test` step at the very end (browser create → edit → delete; install dummy plugin; `bakin doctor`; `bakin install plugin-assets`).

---

## 7. GitHub Issues to File at T14

Bodies are derived from spec §11; each will reference back to `.claude/specs/workflows-plugin-architecture.md`.

1. **Phase 2A — Plugin-registered workflow node types**
   - Design `ctx.registerNodeType({ kind, runtime, renderer, zodSchema, formFields })`
   - Namespace rule `{pluginId}.{kind}`
   - SSR/client renderer split
   - Runtime dispatch hook `workflows.executeNode.{kind}`
   - Forward-compat with the closed-set node-type registry from this work

2. **Phase 2B — Visual drag-and-drop workflow editor**
   - Replace form editor with on-canvas editing
   - Inline node config drawers, edge connection rules per node type, snap-to-grid
   - Reuse the same Zod schemas so saved YAML stays interchangeable with the form editor

3. **Phase 2C — Plugin distribution**
   - Pull plugins from registry/git
   - Signature verification
   - `bakin plugin install <name>` end-to-end
   - Companion: `bakin plugin upgrade <name>` that runs `plugin-assets install` automatically

4. **Phase 2D — Skill rebase UX**
   - Replace `.userEdited` warn-and-skip with a 3-way merge or diff view
   - UI surface in `/health` or `/settings` for resolving conflicts
   - Tooling to mark a custom skill back as managed

---

## 8. Verification Per Phase

Before declaring a phase done:

1. `npm test` (or repo equivalent) — green.
2. `npm run lint` — no new errors.
3. **Live machine smoke** at every gate above:
   - `pnpm dev` (or current dev command) starts without errors.
   - `/workflows` page loads.
   - At least one existing workflow (`video-script` is the canonical) loads in the canvas.
   - Audit log shows no new errors during the smoke.
4. Knowledge docs touched by the phase are updated in the same commit.

---

## 9. Done When

Mirrors spec §12, with concrete commit checkpoints:

- All 15 tasks committed; build green at every commit.
- 7 existing live workflows still run end-to-end.
- New tests added; full suite green.
- `.claude/knowledge/workflows-plugin.md` exists; `plugin-system.md`, `README.md`, `CLAUDE.md` updated.
- 4 follow-up GitHub issues filed.
- One short note in this plan or the spec marking the plan as complete.
