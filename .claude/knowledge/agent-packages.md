# Agent Packages — Deep Reference

> **For:** future Claude sessions or human contributors needing to understand the agent-packages internals end-to-end. The author-facing surface lives in `docs/agent-packages-authoring.md`; this doc covers what's INSIDE the system.

## Why this primitive exists

Plugins ship code (routes, UI, MCP tools). Before agent-packages, every agent
was hand-edited directly in the runtime workspace — no install/update/drift
story, no way to share an agent across machines, no separation between content
and customization. Agent-packages formalize that as a versioned,
distributable, lockfile-tracked content unit projected through the active
runtime adapter.

Conceptual split:
- **Plugin** = behavior. Code that runs.
- **Agent-package** = identity + perspective. Files that personify and teach.

A package might depend on plugins (the workflows plugin to register its workflows; the team plugin's search system to index its knowledge), but plugins never depend on agent-packages.

## Package kinds

Four `kind` values discriminate what a manifest can contain:

| Kind | What it ships | Lockfile key |
|---|---|---|
| `agent` | persona files, optional skills/workflows/knowledge/assets, dispatch perms | bare id (`pixel`) |
| `skill-pack` | reusable runtime skills used by multiple agents | compound (`visual@0.3.1`) |
| `workflow-pack` | reusable workflow definitions + workflow-skills | compound |
| `knowledge-pack` | cross-agent knowledge lessons | compound |

**Why agents use plain ids:** one runtime agent per id, no two-versions-coexist
semantics. **Why non-agents use compound:** during `bakin packages update`, the
new version installs alongside the old one, then the lockfile pointer flips
atomically.

## Manifest schema

`packages/core/src/agent-packages/manifest.ts` — zod-validated. The schema is a discriminated union on `kind`. Common base fields (`id`, `name`, `version`, `description`, `bakin`, `author`) plus kind-specific stanzas:

- `agent` only: `agent: { identity, role, defaultModel?, dispatchableBy[], allowedTools[], allowedSkills[] }` and `install: { createIfMissing, adoptIfExists, writeWorkspaceFiles, installSkills, installWorkflows, enableKnowledge[] }`
- `contributions`: shape per kind. agent has all six (workspaceFiles/skills/workflows/workflowSkills/knowledge/assets); skill-pack requires `skills` non-empty; workflow-pack requires at least one of workflows/workflowSkills; knowledge-pack requires `knowledge` non-empty.
- `dependencies`: cross-kind. `{skills?: Dependency[], workflows?: Dependency[], knowledge?: Dependency[]}` where each `Dependency = {source, ref, items?, installAs?}`.

ID rule: `/^[a-z0-9][a-z0-9-_]{0,39}$/i` — same as plugin install. Source rule: `github:user/repo` or local path (`./` `../` `/` `~/`); bare names refuse with a clear error.

## Lockfile

`~/.bakin/packages/lock.json`. zod-validated, atomic IO (`tmp + rename`). Schema in `packages/core/src/agent-packages/lockfile.ts`:

```jsonc
{
  "version": 1,
  "packages": {
    "pixel": {
      "kind": "agent",
      "version": "0.1.0",
      "source": "github:madeinwyo/bakin-agent-pixel",
      "ref": "v0.1.0",
      "commitSha": "abc123...",
      "installedAt": "2026-04-24T...Z",
      "state": "managed",          // agent only — managed | adopted
      "agentId": "pixel",          // agent only
      "knowledgeEnabled": ["prompt-style-system"],
      "projections": [
        { "kind": "skill", "target": "...", "sha256": "..." },
        { "kind": "asset", "target": "...", "sha256": "..." },
        { "kind": "workspace-file", "target": "...", "sha256": "...", "templateOnly": true },
        { "kind": "knowledge-marker", "target": "...", "blockId": "knowledge:pixel:..." }
      ],
      "dependencies": ["visual@0.3.1"]
    },
    "visual@0.3.1": {
      "kind": "skill-pack",
      "version": "0.3.1",
      "source": "github:madeinwyo/bakin-skills-visual",
      "ref": "v0.3.1",
      "commitSha": "def456...",
      "refCount": 2,
      "dependents": ["pixel", "rolo"]
    }
  }
}
```

Pure mutators in `lockfile.ts`: `addPackage / removePackage / incrementRefCount / decrementRefCount / getOrphanedPacks / hasDependents / findAgentPackage`. They take + return `Lockfile` values, never mutate input.

## Provenance markers

Every projected file gets two sidecars (`packages/core/src/agent-packages/markers.ts`):

- `<target>.installedBy` — JSON: `{package, version, ref, commitSha, sha256, installedAt}`. zod-validated on read; malformed sidecars return `null` so the doctor flags them as drift instead of throwing.
- `<target>.userEdited` — empty sentinel. When present, the projector NEVER overwrites — even on `--fix` or `--refresh-template`.

For directory targets (skills): sidecars land **inside** the directory (`<target>/.installedBy`), matching the existing `plugin-assets.ts` convention.

`computeFileSha(path)` is content-deterministic. `computeDirSha(path)` is a recursive Merkle-style hash that ignores `.installedBy` / `.userEdited` so writing a sidecar doesn't change the recorded sha.

## Managed blocks

`packages/core/src/agent-packages/managed-blocks.ts` — primitive operations on `<!-- bakin:<blockId>:start --> ... <!-- bakin:<blockId>:end -->` regions in markdown files. Used by:
- The agent-package projector (knowledge-catalog + per-lesson blocks in SOUL.md)
- The AGENTS.md managed-context projector (`src/core/agent-rules/managed-blocks.ts`), which uses one physical `managed-context` block per agent and tracks logical rule sections inside it

Functions: `injectBlock`, `extractBlock`, `removeBlock`, `listBlocks`, `hasBlock`, `getBlockState`, `isValidBlockId`. Pure — string-in, string-out, no fs.

`getBlockState` distinguishes `'absent' | 'present' | 'orphan-start' | 'orphan-end'` so the doctor can refuse to silently rewrite malformed marker pairs (the user's intent isn't clear; fail loud instead). For AGENTS.md, malformed compact markers or malformed legacy per-rule markers both stop auto-fix until the marker pair is corrected manually.

## Install flow

`src/core/agent-packages/installer.ts` — `installPackage(options)`:

1. **Acquire `~/.bakin/packages/.lock`** via `install-lock.ts` (PID-tagged advisory file lock with stale-detection)
2. **Fetch source** via `source-fetcher.ts` → staging dir + commitSha. github: clones with `--depth 1 --branch <ref>` first; on failure (commit SHAs not accepted by `--branch`), falls back to deeper clone + `git checkout`. Local sources copy with `dereference:false`. Bare names refuse.
3. **Parse + validate manifest** via the zod schema
4. **Compute install mode** for `kind: "agent"`:
   - state=`absent` + no `--adopt`: `mode=fresh` (creates the runtime agent later)
   - state=`unmanaged` + `--adopt`: `mode=adopt` (preserves existing workspace files, only writes markers)
   - state=`managed`/`adopted`: refuse with "use update" message
5. **Resolve dependencies** via `dependency-resolver.ts` — recursive walk, cycle detection, max-depth=8, leaves-first topological order
6. **Project** via `projector.ts`:
   - Workspace files (fresh + update --refresh-template only; never adopt; never .userEdited)
   - Skills (per-agent for kind:agent / global for kind:skill-pack; collision check refuses different-package targets unless `--replace`)
   - Assets (`~/.bakin/agents/<id>/<file>` with sidecars; collision check)
   - Knowledge markers (catalog block + per-lesson blocks per `enableKnowledge`)
   - Atomic at the package level via in-memory `WriteLog`; any error rolls back every prior write
7. **Update lockfile** atomically. Builds two id→key maps (`idToLockKey` for `incrementRefCount`, `sourceToLockKey` for `listImmediateDeps`) so each transitive dep records its IMMEDIATE parent (not the top-level invocation root) as the dependent — critical for cascade-removal correctness.
8. **For kind:"agent" + fresh:** call `getAppServices().runtime.agents.create()`
   and update runtime allowlists. `defaultModel` + `dispatchableBy` propagate
   through the runtime adapter on fresh install only (per settled D5 — user owns
   models post-install via the Models UI).
9. **Commit staging → install dirs** via `renameSync` (atomic on same fs)
10. **Audit** via `appendAudit()` — events: `agent_pkg.{installed,adopted,updated,removed,knowledge_enabled,knowledge_disabled}` and `pkg.{installed,removed}` for non-agent kinds
11. **Release lock** in finally — survives any error path

On failure: rollback every projection in reverse via `unprojectPackage()`; remove any committed install dirs; clean up staging; lockfile untouched; lock released.

## Cascade uninstall

`removePackageById(options)` in `uninstaller.ts`:

1. Read lockfile entry
2. Refuse if `refCount > 0` and no `--force`
3. Unproject each projection (skipping `.userEdited`, optionally `keepBlocks` for knowledge markers)
4. Remove the install dir
5. **Recursive cascade:** for each entry in `entry.dependencies`, decrement that dep's refCount against THIS package as the dependent. If the dep's refCount hits 0, recursively unproject + remove its install dir + recurse into ITS deps with the orphan as the dependent. N-level deep chains cascade correctly because each level decrements its OWN immediate parent.
6. Optionally `removeAgent` + `removeFromAllowLists` for `kind:"agent"` + `--delete-agent`
7. Audit

## Update flow

`updatePackageById(options)` in `updater.ts`:

1. Read lockfile entry
2. Re-fetch source at the SAME `source` + `ref` (compares new commitSha to recorded; identical = no-op)
3. Re-project in `mode: 'update'`:
   - Workspace files: skipped unless `--refresh-template` (templateOnly carve-out — agent owns the file post-install)
   - Skills + assets: re-projected (collision check still runs)
   - Knowledge markers: re-injected in-place via `injectBlock`
4. Update lockfile entry's commitSha + projection shas (preserves original installedAt)
5. Audit `agent_pkg.updated`

`defaultModel` and `dispatchableBy` are NOT re-applied on update — they only propagate on fresh install per D5.

## Workflow + skill source registry tiers

`plugins/workflows/lib/source-registry.ts` and `plugins/workflows/lib/agent-package-skill-registry.ts` each carry three tiers:

- `plugin` — populated by `ctx.registerWorkflow()` / `ctx.registerSkill()` during plugin activation
- `agent-package` — populated at boot by `src/core/agent-packages/load-sources.ts` walking the lockfile and reading each managed agent / workflow-pack package's source dir
- `user` — populated from `~/.bakin/workflows/{definitions,skills}/*` on disk

Resolution order: **user > agent-package > plugin**. User files always win; agent-package can override plugin defaults; plugin is the fallback. Same precedence for workflow definitions and workflow-skills.

Server.ts boot: plugin registry initializes → `loadAgentPackageSources()` runs → user files load. Order matters; the load-sources call sits between plugin init and the Antfly initialization (line ~136 of server.ts).

## Search indexing and retrieval for knowledge files

The team plugin (`plugins/team/index.ts`) registers a `agent-knowledge` content type via `ctx.search.registerFileBackedContentType()`:
- Glob: `packages/agents/*/knowledge/*.md`
- Schema: `title`, `body`, `package_id`, `agent_id`, `lesson_id`, `tags[]`, `default_enabled`, `updated_at`
- Searchable: `title` + `body`. Facets: `package_id`, `agent_id`, `tags`. Chunker enabled (250 token target / 30 overlap).

Retrieval in `src/core/agent-packages/knowledge-retrieval.ts` is dispatch-time:
- `retrieveAgentPackageKnowledge()` finds the target agent's package via the lockfile, queries `agent-knowledge`, filters results down to the package's enabled `knowledgeEnabled` lessons, dedupes repeated chunk hits by `lesson_id`, hydrates full lesson bodies from the installed package source, and returns the top configured lessons.
- `dispatch.ts` injects the formatted top lessons into regular task dispatch and workflow step dispatch. Retrieval failures are audited and do not block dispatch.
- The team plugin exposes `bakin_exec_knowledge_search`, scoped to the calling agent, for follow-up lookup over the same enabled lesson set.
- Settings live under `settings.agentPackages.knowledgeRetrieval`: `enabled`, `injectIntoDispatch`, `mcpTool`, `maxLessons`, `maxCharacters`, `minScore`.

Current limitation: `enabled` is NOT indexed — the lockfile remains the source of truth for per-agent enabled state. Searching hits all available lessons; consumers cross-reference the lockfile to filter.

V1 limitation: knowledge-pack lessons aren't indexed (glob targets `packages/agents/*` only). Adding a parallel `knowledge-pack-knowledge` content type or extending the glob is V1.5 work.

## Three states for an agent

`src/core/agent-packages/agent-state.ts:getAgentState(agentId)` cross-references
the runtime roster + lockfile:

- `absent` — neither side knows the agent
- `unmanaged` — in the runtime roster, no lockfile entry (the historical default for hand-built agents)
- `adopted` — both sides know it; lockfile state="adopted"; Bakin only manages markers + assets, never workspace files
- `managed` — both sides know it; lockfile state="managed"; Bakin owns the package + projected files

Critical correctness rule: a runtime agent without a lockfile entry MUST surface
as `unmanaged` (NOT `absent`). Mis-classifying lets the installer create a
fresh runtime agent with the same id, risking the user's existing setup.

## Doctor integration

`plugins/team/lib/health-checks.ts:checkAgentAssets()` surfaces drift in the
team-owned health checks. It delegates to
`src/core/onboarding/agent-assets.ts`; with auto-fix enabled, drift triggers the
standard install/update projection flow (workspace files stay
templateOnly-protected; everything else re-projects through runtime adapters).

## CLI surface

Two-file pattern (`cli/bakin.ts` is HTTP-client; `src/core/cli.ts` is binary dispatcher delegating unknowns to it):

- `bakin agents install <source> [--adopt] [--install-as <id>] [--replace]`
- `bakin agents list [--packages]` — `--packages` switches from runtime view to package state view
- `bakin agents remove <id> [--keep-blocks] [--delete-agent] [--force]`
- `bakin agents update [<id>] [--refresh-template]` — no id = update all managed/adopted
- `bakin agents knowledge {list,enable,disable} <id> [<lesson-id>]`
- `bakin packages {list,install,remove,update}` — for non-agent kinds; refuses remove on refCount > 0 unless `--force`
- `bakin check agent-assets` / `bakin install agent-assets` — drift report + repair via the onboarding component

Function-name collision avoided: package-management functions are prefixed `cmdAgentPackages*` to coexist with the existing runtime `cmdAgents*` family (status/tasks/send).

## REST surface

Top-level (NOT under `/api/agents/*` which is the runtime surface):

```
GET    /api/agent-packages
POST   /api/agent-packages/install
DELETE /api/agent-packages/{agentId}
POST   /api/agent-packages/{agentId}/update
GET    /api/agent-packages/{agentId}/knowledge
POST   /api/agent-packages/{agentId}/knowledge/{lessonId}

GET    /api/packages
POST   /api/packages/install
DELETE /api/packages/{packageId}
POST   /api/packages/{packageId}/update

GET    /api/curated  — static catalog from packages/host/src/data/curated-agents.json
```

Static-path routes are individual handler files (`install.ts` / `list.ts`); dynamic-path routes share one `dynamic.ts` handler that parses the path and dispatches internally. All bodies validated with zod; status codes follow obvious mapping (collisions + already-installed = 409, unknown = 404, otherwise 500).

## Settled design decisions (worth knowing)

These came up during spec/plan and the answers shape the system. From SPEC.md:

1. **basil/patch repackaged like the rest.** main + roscoe stay unmanaged.
2. **Workflow projection** — extends the existing source-registry with an `agent-package` tier, not a synthetic plugin id. Removal = lockfile entry deleted = source stops resolving.
3. **`installAs` aliasing** — both surfaces ship: declarative `dependencies[].installAs` (canonical, intra-package-graph collisions) AND imperative `--install-as` CLI flag (user-resolved at install time). They share the resolved-id path. **V1 limitation**: aliases the lockfile key only, NOT the projection target — per-skill rename is V1.5.
4. **Adoption block scope** — adopting writes only the catalog block + lessons listed in `manifest.install.enableKnowledge`. All other lessons stay opt-in via UI/CLI toggle.
5. **Update refresh of `defaultModel` / `dispatchableBy`** — only on fresh install. User controls models via the Models UI from then on.

## MCP tool policy

Agent-package `agent.allowedTools` is enforced by Bakin's MCP server, not by the
runtime provider. `src/core/mcp-tool-policy.ts` reads the lockfile entry,
loads the installed package's `bakin-package.json`, and resolves policy for the
session agent:

- No lockfile entry means an unmanaged legacy agent and remains unrestricted.
- A managed package agent with no readable, non-empty `allowedTools` policy
  fails closed.
- An adopted package agent with `allowedTools` is scoped by that list; an adopted
  package agent without a policy remains unrestricted until configured.
- Allow entries are MCP tool-name patterns. Exact names and `*` wildcards are
  supported, e.g. `bakin_exec_assets_get` or `bakin_exec_assets_*`.

The MCP server hides disallowed tools from `tools/list`, denies forged direct
calls at `tools/call`, records denied usage, and appends
`exec.<tool>.denied` audit events.

Do not confuse this with:

- `workflow deny_tools`: prompt-level workflow step guidance, not hard routing.
- OpenClaw cron `toolsAllow`: native runtime cron policy for isolated agent-turn
  jobs, not Bakin MCP routing.
- `allowedSkills`: still declarative/documentation-only until skill routing is
  implemented.

## V1 explicit non-goals

- **No hosted registry.** Curated catalog is a static JSON file shipped in the binary; bare-name install errors out.
- **No trust levels enforcement.** The catalog has a `trust: "official"|"verified"|"community"` field but it's display-only.
- **No knowledge-pack lesson retrieval.** Dispatch-time retrieval covers installed agent-package lessons only. Knowledge-pack lessons are not indexed yet.
- **No skill scoping enforcement.** Manifests declare `allowedSkills`, but the
  skill-routing layer does not enforce it yet.
- **No bundles.** `bakin install creative-team` (bundle of pixel + rolo + jessica + shared visual skills) is a future possibility, not V1.

## File layout

```
packages/core/src/agent-packages/
├── manifest.ts             zod schemas for all 4 kinds; parseManifest, formatManifestError
├── types.ts                public type re-exports
├── lockfile.ts             schema + atomic IO + pure mutators
├── markers.ts              .installedBy + .userEdited + sha helpers
├── managed-blocks.ts       inject/extract/list/remove + getBlockState
└── package-paths.ts        getPackageSourceDir, getStagingDir, getInstallLockFile

src/core/agent-packages/
├── source-fetcher.ts       fetchSource(local + github)
├── agent-state.ts          getAgentState, listAllAgentStates
├── projector.ts            projectPackage (rollback) + unprojectPackage
├── dependency-resolver.ts  recursive resolveDependencies
├── installer.ts            public installPackage entry point
├── install-lock.ts         advisory lock at packages/.lock
├── uninstaller.ts          removePackageById with cascade
├── updater.ts              updatePackageById with sha-based no-op
├── knowledge-toggle.ts     setKnowledgeEnabled (single-lesson SOUL.md mutator)
└── load-sources.ts         boot-time lockfile → source-registry

packages/host/src/api/
├── agent-packages/
│   ├── install.ts          POST handler
│   ├── list.ts             GET handler
│   └── dynamic.ts          DELETE/PUT/knowledge dispatcher
├── packages/
│   ├── install.ts
│   ├── list.ts
│   └── dynamic.ts
└── curated/
    └── list.ts             GET /api/curated

packages/host/src/data/
└── curated-agents.json     binary-embedded catalog

plugins/team/components/
├── package-state-badge.tsx
├── install-dialog.tsx
├── adopt-dialog.tsx
├── knowledge-toggle-list.tsx
└── curated-browser.tsx

plugins/workflows/lib/
├── source-registry.ts      extended with agent-package tier
├── skill-loader.ts         extended with agent-package tier
└── agent-package-skill-registry.ts  in-memory registry (parallel to plugin skills)

scripts/migration/
└── validate-package.ts     zod-validate a candidate package directory

agents/                      In-repo reference packages (8 backfilled). NOT bundled
└── <id>/                    in the binary — install via `bakin agents install ./agents/<id>`.
    ├── bakin-package.json
    ├── workspace/
    ├── knowledge/
    ├── assets/
    └── README.md
```

## Companion future work (issues)

- **#157** — V2 dispatch-time knowledge retrieval. Implemented for installed agent-package lessons via `agent-knowledge` search + lockfile filtering. Remaining follow-up: doctor/analytics reporting for indexed lessons that are never retrieved.
