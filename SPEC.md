# SPEC — Agent Packages

**Status:** Draft for review (kickoff phase, pre-plan)
**Owner:** @markhayden
**Tracks:** New primitive. Companion follow-up issue: [#157 — V2 dispatch-time knowledge retrieval](https://github.com/markhayden/bakin/issues/157)

---

## Objective

Introduce **Agent Packages** as a new primitive in Bakin, distinct from plugins. Plugins ship code (routes, UI, MCP tools); agent packages ship **content** — identity, skills, workflows, knowledge — that personifies an agent in OpenClaw and gives it domain perspective.

### Why now

Every agent on this machine (Pixel, Rolo, Jessica, Explorer, Coach, Trainer) has been built ad-hoc:
- Workspace files (`SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `TOOLS.md`) hand-edited directly under `~/.openclaw/workspaces/`.
- Skills installed globally to `~/.openclaw/skills/` with no per-agent ownership and no provenance.
- Knowledge baked opaquely into SOUL.md prose — no toggling, no inspection, no diffing.
- No install/update/drift story, no way to share an agent across machines, no separation between content and customization.

With **no production users**, this is the moment to formalize the model cleanly. Once we ship an initial release, the data model becomes load-bearing. So: full refactor now, no compatibility shims later.

### Outcome

- `bakin agents install github:markhayden/bakin-bits-official` produces a fully personified Pixel: workspace files seeded, skills projected to her workspace, workflows registered, knowledge available to enable per-lesson.
- `bakin doctor` detects drift, missing projection, broken markers, and update-available status.
- Teams UI surfaces install state per agent (`unmanaged | adopted | managed | drifted | update-available`), an Adopt flow for existing OpenClaw agents, knowledge toggles, and a curated catalog of suggested agents (ships as static JSON in the binary).
- Existing OpenClaw agents (`main-operator`, etc.) can be **adopted** non-destructively — Bakin only injects managed blocks, never overwrites their files.
- Tests cannot touch real `~/.bakin/` or `~/.openclaw/` — both directories must be mocked.

---

## Scope

### V1 ships (this spec)

- **Four package kinds, full composition from day one:**
  `agent` | `skill-pack` | `workflow-pack` | `knowledge-pack`
- **Single manifest:** `bakin-package.json` with zod-validated schema. `kind` field discriminates.
- **Sources:** local path or `github:user/repo[@ref]`. No registry, no bare-name resolution. Bare names error with `use github:user/repo or a local path`.
- **Lockfile:** `~/.bakin/packages/lock.json` — resolved commit SHAs, transitive deps, ref-counts, adoption records, projection list w/ sha256.
- **Three agent states:** `unmanaged` (in OpenClaw but no Bakin tracking), `adopted` (Bakin tracks managed-blocks-only attachments), `managed` (Bakin owns the package + projected files).
- **SOUL.md template seeding** — written once on fresh install, agent owns the file from then on. Bakin owns only the markers within it (`<!-- bakin:knowledge-catalog:start -->` and per-lesson `<!-- bakin:knowledge:<package>:<lesson-id>:start -->`). Doctor never overwrites the template; surfaces `template-update-available` instead. `bakin agents update <id> --refresh-template` forces rewrite.
- **Provenance markers:** `.installedBy` sidecar on every projected file (skills, avatars, workspace files) carrying `{package, version, ref, commitSha, sha256, installedAt}`. Mirrors the existing `plugin-assets.ts` pattern.
- **`.userEdited` sentinel** locks any projected file from overwrites — including `--fix` and `--refresh-template`.
- **Skill projection scopes** (settled rule, no exceptions):
  - **Agent-package skills** (whether bundled in `contributions.skills` or pulled via the agent's `dependencies.skills`) → **per-agent** at `{workspace}/skills/<name>/` (OpenClaw's `workspaceSkills` tier — confirmed in `/opt/homebrew/lib/node_modules/openclaw/dist/skills-B5qdBn1G.js:584-592`). They live in *that* agent's workspace.
  - **Standalone `kind: "skill-pack"` skills** (installed via `bakin packages install`) → **global** at `~/.openclaw/skills/<name>/`. Matches the plugin-shipped skill convention.
  - **Plugin-shipped skills** (existing `defaults/openclaw-skills/*` pattern) → **global** at `~/.openclaw/skills/<name>/`. Unchanged.
- **Workflows + workflow-skills projection** — agent packages do **not** register through the plugin registry. The workflows plugin's source registry gains a new `agent-package` source kind that resolves workflows from `~/.bakin/packages/agents/<id>/workflows/*.yaml` and workflow-skills from the same package's `workflow-skills/*.md`. Skill-loader (`plugins/workflows/lib/skill-loader.ts`) gains a parallel resolution tier between in-memory plugin skills and user files. Removing a package = lockfile entry deleted = source registry stops resolving the package's contributions. No fake plugin id, no restart-on-remove.
- **Collision policy:**
  - Same projection target + same sha256 → no-op.
  - Same target + different sha → refuse install. Resolve via `installAs` (declarative in `dependencies[].installAs` for intra-package-graph collisions, OR imperative `--install-as` CLI flag for user-resolved collisions at install time — both feed the same resolved-id path in the installer).
  - `--replace` overrides collision with explicit confirmation. Never automatic.
  - `.userEdited` → never overwrite, always.
- **CLI surface** (full list in **Commands** section).
- **Curated install browser:** Teams UI reads a static `packages/host/src/data/curated-agents.json` baked into the binary. One-click install of suggested packages without committing to a hosted registry.
- **Doctor checks** under `agent-assets`: drift (sha mismatch), missing projection, broken markers, template-update-available, lockfile vs filesystem desync.
- **Migration:** rebuild Pixel, Rolo, Jessica, Explorer, Coach, Trainer, Chef, Patch as packages in `agents/<id>/` in the monorepo. Main Operator and `main` (the orchestrator) stay unmanaged.
- **Test isolation:** every test that touches agent-package code MUST mock both content-dir AND OpenClaw home. Mandatory rule, equal weight to the existing content-dir rule.

### V1 explicitly does NOT ship

- Hosted registry (curated JSON only)
- Trust levels / signature verification
- Dispatch-time knowledge retrieval (issue #157)
- Hard tool/skill scoping enforcement (#42 — `agent.allowedTools` / `agent.allowedSkills` are declarative-only in V1; the dispatch-routing layer that reads and enforces them is its own feature)
- Bundles (e.g. `bakin install creative-team`)
- Live remote fetch at agent runtime (only at install/update time)

---

## Commands

### Lifecycle (CLI)

```text
# Agent packages
bakin agents install <path|github:user/repo[@ref]>
bakin agents install <path|github:user/repo[@ref]> --adopt <agent-id>
bakin agents list                              # all agents w/ state badges
bakin agents update [<id>]                     # update one or all
bakin agents update <id> --refresh-template    # overwrite SOUL.md template
bakin agents remove <id>                       # remove tracking; keep agent
bakin agents remove <id> --keep-blocks         # keep managed blocks
bakin agents remove <id> --delete-agent        # also delete OpenClaw agent

# Knowledge toggles
bakin agents knowledge list <agent-id>
bakin agents knowledge enable <agent-id> <lesson-id>
bakin agents knowledge disable <agent-id> <lesson-id>

# Standalone packs (skill-pack / workflow-pack / knowledge-pack)
bakin packages list
bakin packages install <path|github:user/repo[@ref]>
bakin packages update [<id>]
bakin packages remove <id>                     # blocked if refCount > 0

# Doctor integration (mirrors plugin-assets)
bakin check agent-assets
bakin install agent-assets
bakin doctor [--fix]                           # umbrella
```

### REST

Top-level routes (not nested under `/api/plugins/team/...` — agent install lifecycle is its own primitive, not owned by the team plugin):

```text
# Agent-package surface
GET    /api/agents                                     # all agents w/ state badges
POST   /api/agents/install                             # body: { source, type, adopt?, replace?, installAs? }
POST   /api/agents/{agentId}/adopt                     # body: { source }
DELETE /api/agents/{agentId}                           # body: { keepBlocks?, deleteAgent? }
POST   /api/agents/{agentId}/update                    # body: { refreshTemplate? }
GET    /api/agents/{agentId}/knowledge                 # list + enabled state
POST   /api/agents/{agentId}/knowledge/{lessonId}      # body: { enabled }

# Standalone pack surface (skill-pack/workflow-pack/knowledge-pack)
GET    /api/packages                                   # list all installed packages
POST   /api/packages/install                           # body: { source, type }
DELETE /api/packages/{pkgId}                           # refuses w/ refCount > 0
POST   /api/packages/{pkgId}/update

# Catalog
GET    /api/curated                                    # static curated catalog
```

---

## Project Structure

### In-repo (development)

```text
agents/                                # dev location for reference packages
├── pixel/                             # canonical first package — drives schema
│   ├── bakin-package.json
│   ├── workspace/                     # template files seeded on install
│   │   ├── SOUL.md                    # includes knowledge markers
│   │   ├── IDENTITY.md
│   │   ├── AGENTS.md
│   │   └── TOOLS.md
│   ├── skills/                        # → {workspace}/skills/
│   │   └── image-generation/
│   │       ├── SKILL.md
│   │       └── scripts/
│   ├── workflow-skills/               # → in-memory via workflows plugin
│   ├── workflows/                     # → registered via workflows plugin
│   ├── knowledge/                     # markdown w/ frontmatter (title, tags, defaultEnabled)
│   │   ├── product-photography.md
│   │   ├── editorial-photography.md
│   │   └── prompt-style-system.md
│   ├── assets/                        # → ~/.bakin/agents/{id}/
│   │   ├── avatar.jpg
│   │   └── avatar-full.png
│   └── tests/
├── rolo/                              # backfilled
├── jessica-fetcher/
├── explorer/
├── coach/
└── trainer/

packages/core/src/agent-packages/      # types + zod schemas (pure, no fs)
├── manifest.ts                        # bakin-package.json zod schema
├── lockfile.ts                        # lock.json schema + reader/writer
├── markers.ts                         # .installedBy + .userEdited helpers
├── managed-blocks.ts                  # SOUL.md marker insertion/extraction
└── types.ts

src/core/agent-packages/               # server-side install/projection logic
├── installer.ts                       # fetch → validate → resolve deps → project
├── projector.ts                       # writes to ~/.openclaw/* and ~/.bakin/agents/{id}/
├── source-fetcher.ts                  # local + github (git clone --depth 1)
├── dependency-resolver.ts             # transitive resolution + SHA pinning
├── adoption.ts                        # attach to existing OpenClaw agent
├── doctor-checks.ts                   # drift/missing/update-available
└── curated.ts                         # reads curated-agents.json

packages/host/src/api/agents/          # REST handlers
├── install.ts | list.ts | remove.ts | update.ts | adopt.ts
└── knowledge/{list,toggle}.ts

packages/host/src/api/packages/        # standalone packs
└── install.ts | list.ts | remove.ts | update.ts

packages/host/src/data/
└── curated-agents.json                # static catalog for UI install browser

src/core/onboarding/agent-assets.ts    # `bakin {check,install} agent-assets`

plugins/team/                          # extended with state UI
└── components/
    ├── package-state-badge.tsx
    ├── adopt-dialog.tsx
    ├── knowledge-toggle-list.tsx
    └── curated-browser.tsx
```

### Runtime data (`~/.bakin/`)

```text
~/.bakin/
├── packages/
│   ├── lock.json                                # canonical install ledger
│   ├── agents/
│   │   └── pixel@0.1.0/                         # immutable installed package source
│   ├── skill-packs/
│   │   └── markhayden.bakin-skills-visual@0.3.1/
│   ├── workflow-packs/
│   └── knowledge-packs/
└── agents/                                      # per-agent UI state (existing role)
    └── pixel/
        ├── avatar.jpg                           # projected from package
        ├── avatar.jpg.installedBy               # provenance sidecar
        ├── avatar-full.png
        ├── avatar-full.png.installedBy
        └── adoption.json                        # { state, package, agentId, ... }
```

---

## Manifest Schema (target shape)

```jsonc
{
  "id": "pixel",
  "kind": "agent",                                 // "agent" | "skill-pack" | "workflow-pack" | "knowledge-pack"
  "name": "Pixel",
  "version": "0.1.0",
  "description": "Creative image and design agent.",
  "bakin": "^1.0.0",
  "author": "Bakin Test Fixtures",

  // Present iff kind === "agent"
  "agent": {
    "identity": { "name": "Pixel", "emoji": "🎨" },
    "role": "Creative content and design",
    "defaultModel": "anthropic/claude-sonnet-4-20250514",
    "dispatchableBy": ["main"],
    "tags": ["creative", "image", "design", "brand"],
    "allowedTools": ["bakin_exec_assets_*"],       // V1 doc-only; #42 enforces later
    "allowedSkills": ["image-generation"]
  },

  // Present iff kind === "agent"
  "install": {
    "createIfMissing": true,
    "adoptIfExists": true,
    "writeWorkspaceFiles": true,
    "installSkills": true,
    "installWorkflows": true,
    "enableKnowledge": ["prompt-style-system"]
  },

  // What the package contributes — paths are relative to package root
  "contributions": {
    "workspaceFiles": ["workspace/SOUL.md", "workspace/IDENTITY.md", "workspace/AGENTS.md", "workspace/TOOLS.md"],
    "skills":         ["skills/image-generation"],
    "workflows":      ["workflows/image-generation.yaml"],
    "workflowSkills": ["workflow-skills/generate-image.md"],
    "knowledge":      ["knowledge/product-photography.md", "knowledge/editorial-photography.md", "knowledge/prompt-style-system.md"],
    "assets":         ["assets/avatar.jpg", "assets/avatar-full.png"]
  },

  // External dependencies — any kind can declare these
  "dependencies": {
    "skills":    [{ "source": "github:markhayden/bakin-skills-visual",   "ref": "v0.3.1", "items": ["image-generation"], "installAs": null }],
    "workflows": [{ "source": "github:markhayden/bakin-workflows-creative", "ref": "v0.2.0", "items": ["image-generation"], "installAs": null }]
  }
}
```

**Knowledge file frontmatter** (per D6 — metadata lives in the file, not the manifest):

```markdown
---
title: Product Photography
tags: [product, commerce, lighting]
defaultEnabled: false
---

# Product Photography

Pixel's lens for product work...
```

The manifest's `contributions.knowledge` only lists paths.

---

## Lockfile Schema

```jsonc
{
  "version": 1,
  "packages": {
    "pixel": {
      "kind": "agent",
      "version": "0.1.0",
      "source": "github:markhayden/bakin-bits-official",
      "ref": "v0.1.0",
      "commitSha": "abc123...",
      "installedAt": "2026-04-24T12:34:56Z",
      "state": "managed",                                // "managed" | "adopted"
      "agentId": "pixel",                                // OpenClaw agent id
      "projections": [
        { "kind": "skill",             "target": "/Users/.../workspaces/pixel/skills/image-generation/", "sha256": "..." },
        { "kind": "asset",             "target": "/Users/.../bakin/agents/pixel/avatar.jpg",             "sha256": "..." },
        { "kind": "workspace-file",    "target": "/Users/.../workspaces/pixel/IDENTITY.md",              "sha256": "...", "templateOnly": true },
        { "kind": "knowledge-marker",  "target": "/Users/.../workspaces/pixel/SOUL.md",                  "blockId": "knowledge:pixel:product-photography" }
      ],
      "knowledgeEnabled": ["prompt-style-system"],
      "dependencies": ["markhayden.bakin-skills-visual@0.3.1"]
    },
    "markhayden.bakin-skills-visual@0.3.1": {
      "kind": "skill-pack",
      "version": "0.3.1",
      "source": "github:markhayden/bakin-skills-visual",
      "ref": "v0.3.1",
      "commitSha": "def456...",
      "refCount": 2,
      "dependents": ["pixel", "rolo"]
    }
  }
}
```

---

## Code Style

- TypeScript strict. No `any` across module boundaries.
- Zod schemas at every I/O boundary: manifest, lockfile, install request body, adoption.json, `.installedBy` sidecar.
- Functional preference: pure resolvers/validators in `packages/core/src/agent-packages/`, side-effecting installers/projectors in `src/core/agent-packages/`.
- `createLogger('agent-pkg:<phase>')` for logging; phases: `manifest`, `fetch`, `resolve`, `project`, `lockfile`, `doctor`, `adopt`.
- Atomic writes for the lockfile and any projected file (tmp + rename).
- Staging-directory pattern for installs (mirrors `packages/host/src/api/plugins/install.ts`): clone/copy to `~/.bakin/packages/.staging-{ts}/` → validate → atomic rename to final location → cleanup staging on failure.
- File naming: `kebab-case.ts` / `kebab-case.tsx`. Types `PascalCase`. Constants `UPPER_SNAKE_CASE`.

---

## Testing Strategy

### Mandatory mocks (every test in this feature)

```typescript
const testBakinDir = join(tmpdir(), `bakin-test-${Date.now()}-${randomUUID()}`)
const testOpenClawDir = join(tmpdir(), `openclaw-test-${Date.now()}-${randomUUID()}`)

// Existing rule (still required)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testBakinDir,
  getBakinPaths: () => bakinPathsUnder(testBakinDir),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testBakinDir,
  getBakinPaths: () => bakinPathsUnder(testBakinDir),
}))

// NEW — mandatory for any agent-package test
mock.module('../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => testOpenClawDir,
  getOpenClawPath: (...parts: string[]) => join(testOpenClawDir, ...parts),
}))

// When testing agent runtime behavior, install a runtime adapter mock via
// globalThis.__bakinFallbackRuntimeAdapter or the plugin test context.

afterAll(() => {
  rmSync(testBakinDir, { recursive: true, force: true })
  rmSync(testOpenClawDir, { recursive: true, force: true })
})
```

A test that writes to a real `~/.openclaw/` is a P0 failure regardless of whether it crashes — same severity as a leak to `~/.bakin/`.

### Pyramid

- **Unit:** zod schemas, lockfile read/write, marker parse/inject, sha hashing, manifest validation. Pure functions, no fs.
- **Integration:** install pipeline against fixtures in `tests/fixtures/agent-packages/`. Each gets temp content-dir + temp openclaw-home. Verify lockfile entries, projected files, sha markers, adoption.json, idempotency on re-install.
- **E2E (manual smoke):** `bakin agents install ./agents/pixel` against temp homes; verify roundtrip works against the real Pixel package the user actually uses.
- **Drift simulation:** mutate a projected file mid-test → assert doctor reports drift → assert `--fix` repairs → assert `.userEdited` blocks repair.
- **Adoption:** pre-seed an OpenClaw agent → install with `--adopt` → assert only managed blocks written, existing files untouched, adoption.json recorded.
- **Composition:** install agent w/ skill-pack dep → assert `refCount: 1` → install second agent w/ same dep → `refCount: 2` → remove first agent → `refCount: 1`, pack stays.
- **Collision:** install two packages with same skill name + different sha → assert refusal → install with `installAs` alias → assert both projected, no overlap.

CI: `bun test --isolate` (existing convention).

---

## Boundaries

### Always do

- Validate manifests with zod **before** any filesystem mutation.
- Stage installs in a temp dir; atomic rename to final location only after success.
- Write `.installedBy` sidecar with `{package, version, ref, commitSha, sha256, installedAt}` for **every** projected file.
- Resolve `github:user/repo[@ref]` to a commit SHA at install time; record both source ref and SHA in the lockfile.
- Topologically sort dependencies before install; install leaves first.
- Refuse install on collision (same projection target, different sha) unless an `installAs` alias resolves it or `--replace` is passed.
- Honor `.userEdited` always — never overwrite, even on `--fix` or `--refresh-template`.
- Log every package mutation through `appendAudit()`.
- Use `getOpenClawPath()` and `getContentDir()` everywhere — never hardcode `~/.openclaw/` or `~/.bakin/`.

### Always ask first (UI confirm or CLI requires explicit flag)

- `--delete-agent` (destructive — removes OpenClaw workspace).
- `--refresh-template` (overwrites user-mutable SOUL.md template after install).
- `--replace` for collision override.
- Transitive github fetches when the dependency tree exceeds 5 packages or 25 MB total.

### Never do

- Write to real `~/.bakin/` or `~/.openclaw/` from any test.
- Fetch a remote package at agent runtime — only at install/update.
- Overwrite a `.userEdited` file.
- Silently choose between competing package owners on collision.
- Run skill scripts at install time — scripts execute only inside OpenClaw at agent runtime.
- Hardcode `~/.openclaw/` or `~/.bakin/`.
- Inline knowledge metadata (`title`, `tags`, `defaultEnabled`) in the manifest — must live in the knowledge file's frontmatter.
- Bundle agent packages into the binary (no core agents — curated browser handles discovery).

---

## Migration Plan (within V1)

Each numbered step is a **commit checkpoint**. The plan-phase output will detail file-level changes per step.

1. **Manifest schema.** Zod schema for `bakin-package.json` + types in `packages/core/src/agent-packages/manifest.ts`. Unit tests against fixture manifests covering all four kinds. **Checkpoint commit.**
2. **Lockfile + markers.** Zod schema for `lock.json`, atomic read/write, `.installedBy` and `.userEdited` helpers, managed-block marker injection/extraction (lifted/refactored from `src/core/doctor.ts:898`). **Checkpoint commit.**
3. **Pixel as first package.** Restructure current Pixel workspace into `agents/pixel/` with full package shape. Knowledge files extracted from her current SOUL.md. Forces the schema to match reality, not a designed-from-scratch fantasy. **Checkpoint commit.**
4. **Source fetcher + installer + projector.** Core install pipeline — local source path + github: cloning, manifest validation, dependency resolution (single-level for now), projection to `~/.openclaw/workspaces/pixel/` + `~/.bakin/agents/pixel/`, lockfile updates. End-to-end against real Pixel. **Checkpoint commit.**
5. **CLI surface.** `bakin agents {install,list,remove,update,knowledge {list,enable,disable}}` and `bakin packages {install,list,remove,update}`. Wired through `cli/bakin.ts` (HTTP) and `src/core/cli.ts` (binary dispatcher). Doctor integration (`bakin check agent-assets` / `bakin install agent-assets`) added to `src/core/onboarding/agent-assets.ts`. **Checkpoint commit.**
6. **Backfill agents.** Repackage Rolo, Jessica-fetcher, Explorer, Coach, Trainer as `agents/<id>/` packages. Each becomes a checkpoint commit (5 commits — one per agent — so any single agent's regression rolls back independently). Main Operator stays unmanaged. Chef/patch decision deferred to plan phase.
7. **Teams UI.** State badges, adopt dialog, knowledge toggle list, curated install browser. New `package-state-badge.tsx`, `adopt-dialog.tsx`, `knowledge-toggle-list.tsx`, `curated-browser.tsx`. **Checkpoint commit.**
8. **Doctor checks + drift simulation.** Drift detection, `--fix` repair, template-update-available reporting, lockfile/filesystem desync detection. **Checkpoint commit.**
9. **Composition.** Skill-pack / workflow-pack / knowledge-pack standalone install. Transitive dependency resolution. Lockfile ref-counting. `installAs` aliases. Cross-package collision tests. **Checkpoint commit.**
10. **Curated catalog.** Populate `packages/host/src/data/curated-agents.json` with Pixel, Rolo, Jessica entries pointing at (eventual) standalone github repos. UI install browser hooked up. **Checkpoint commit.**
11. **Documentation.** Update `CLAUDE.md` (Architecture + Plugin System sections), `.claude/knowledge/agent-system.md` (full overhaul), `docs/` with an `agent-packages-authoring.md` walkthrough mirroring `docs/plugin-authoring.md`. **Checkpoint commit.**
12. **Final test pass.** `bun test --isolate` clean; manual smoke against real OpenClaw home (after backing it up); `bakin doctor` run. **Final commit.**

Each checkpoint is independently revertable. The plan phase will turn each step into a task list with acceptance criteria, file-level changes, and explicit commit boundaries.

---

## Settled design decisions

These were open during spec refinement; landed values are below for traceability.

1. **chef / patch / main / main-operator** — Chef and Patch get repackaged like the rest. `main` (orchestrator) and `main-operator` stay unmanaged. Total backfill: 8 packages (pixel, rolo, jessica-fetcher, explorer, coach, trainer, chef, patch).
2. **Workflow projection** — Extend the workflows plugin source registry with an `agent-package` source kind. Skill-loader gains a parallel tier. No synthetic plugin id, no plugin-registry mutation. Removal is natural — lockfile entry deleted, source stops resolving. Same plumbing serves `kind: "workflow-pack"` standalone packages.
3. **`installAs` aliasing** — Both surfaces ship in V1. Declarative `dependencies[].installAs` is the canonical form (resolves intra-package-graph collisions at design time). Imperative `--install-as` CLI flag handles the rarer user-encounters-collision-at-install-time case. They share the resolved-id computation in the installer.
4. **Adoption block scope** — Adoption writes only (a) the knowledge catalog block and (b) the lessons listed in `manifest.install.enableKnowledge`. All other lessons remain opt-in via UI/CLI toggle. Conservative — adopting an existing agent should not flood their SOUL.md with unsolicited content.
5. **Update refresh of `defaultModel` / `dispatchableBy`** — Only on fresh install. `bakin agents update` does not re-write these into `openclaw.json`. The user controls models through the Models UI; respect that.

---

## Companion future work (not in this spec)

- **#157** — V2 dispatch-time knowledge retrieval. V1 injects all enabled lessons statically; V2 picks 1–3 most relevant per task at dispatch time. Data model unchanged; only the injection path differs.
- **#42** — Per-agent MCP tool scoping enforcement. Agent package manifests already declare `agent.allowedTools` / `agent.allowedSkills` in V1; #42's dispatch-routing layer reads them and enforces hard scoping.
