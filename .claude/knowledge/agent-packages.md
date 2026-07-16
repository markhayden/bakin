# Agent Packages — Deep Reference

> **For:** future Claude sessions or human contributors needing to understand the agent-packages internals end-to-end. The author-facing surface lives in `docs/src/content/docs/extending/agents/packages.md`; this doc covers what's INSIDE the system.

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

A package might depend on plugins (the workflows plugin to register its workflows; the team plugin's search system to index its lessons), but plugins never depend on agent-packages.

## Package kinds

Four `kind` values discriminate what a manifest can contain:

| Kind | What it ships | Lockfile key |
|---|---|---|
| `agent` | persona files, optional skills/workflows/lessons/assets, dispatch perms | bare id (`pixel`) |
| `skill-pack` | reusable runtime skills used by multiple agents | compound (`visual@0.3.1`) |
| `workflow-pack` | reusable workflow definitions + workflow-skills | compound |
| `lesson-pack` | cross-agent lesson files | compound |

**Why agents use plain ids:** one runtime agent per id, no two-versions-coexist
semantics. **Why non-agents use compound:** during `bakin packages update`, the
new version installs alongside the old one, then the lockfile pointer flips
atomically.

## Manifest schema

`packages/core/src/agent-packages/manifest.ts` — zod-validated. The schema is a discriminated union on `kind`. Common base fields (`id`, `name`, `version`, `description`, `bakin`, `author`) plus kind-specific stanzas:

- `agent` only: `agent: { identity, role, defaultModel?, dispatchableBy[], allowedTools[], allowedSkills[] }` and `install: { createIfMissing, adoptIfExists, writeWorkspaceFiles, installSkills, installWorkflows, enableLessons[] }`
- `contributions`: shape per kind. agent has all six (workspaceFiles/skills/workflows/workflowSkills/lessons/assets) plus optional `persona` (single file seeded to `{contentDir}/team/personas/{agentId}.md` ONLY when missing — personas are user territory: never overwritten, never reclaimed, never removed on uninstall); skill-pack requires `skills` non-empty; workflow-pack requires at least one of workflows/workflowSkills; lesson-pack requires `lessons` non-empty.
- `dependencies`: cross-kind. `{skills?: Dependency[], workflows?: Dependency[], lessons?: Dependency[]}` where each `Dependency = {source, ref, items?, installAs?}`.
- `secrets`: shared top-level runtime requirements. Each declaration is `{name, description, required}` where `name` is a canonical env var name such as `RUNWAY_API_KEY`. Secret values never live in package manifests or lockfiles.

ID rule: `/^[a-z0-9][a-z0-9-_]{0,39}$/i` — same as plugin install. Source rule: `github:user/repo[@ref][#subpath]` or local path (`./` `../` `/` `~/`); bare names refuse with a clear error. GitHub `#subpath` installs stage only the package directory and reject empty, absolute, traversal, dot-segment, multi-`#`, and whitespace subpaths.

Contribution integrity rule: install/update preflights declared contributions before writing the lockfile or projections. Workspace files, assets, workflows, and workflow skills must be real files inside the package. Skills must be directories with a non-empty `SKILL.md`. Workflow files must be YAML definitions that pass workflow validation, and workflow-skill Markdown must have a non-empty instruction body. Lesson contributions must be real, non-empty Markdown files at `lessons/<lesson-id>.md`, with unique basename-derived ids. Agent `install.enableLessons[]` and update-preserved `lessonsEnabled[]` must reference contributed lesson ids.

## Lockfile

`~/.bakin/packages/lock.json`. zod-validated, atomic IO (`tmp + rename`). Schema in `packages/core/src/agent-packages/lockfile.ts`:

```jsonc
{
  "version": 1,
  "packages": {
    "pixel": {
      "kind": "agent",
      "version": "0.1.0",
      "source": "github:markhayden/bakin-bits-official#agents/pixel",
      "ref": "pixel-v0.1.0",
      "commitSha": "abc123...",
      "installedAt": "2026-04-24T...Z",
      "state": "managed",          // agent only — managed | adopted
      "agentId": "pixel",          // agent only
      "lessonsEnabled": ["prompt-style-system"],
      "projections": [
        { "kind": "skill", "target": "...", "sha256": "..." },
        { "kind": "asset", "target": "...", "sha256": "..." },
        { "kind": "workspace-file", "target": "...", "sha256": "...", "templateOnly": true },
        { "kind": "lesson-marker", "target": "...", "blockId": "lesson:pixel:..." }
      ],
      "dependencies": ["visual@0.3.1"]
    },
    "visual@0.3.1": {
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

Pure mutators in `lockfile.ts`: `addPackage / removePackage / incrementRefCount / decrementRefCount / getOrphanedPacks / hasDependents / findAgentPackage`. They take + return `Lockfile` values, never mutate input.

## Provenance markers

Every projected file gets two sidecars (`packages/core/src/agent-packages/markers.ts`):

- `<target>.installedBy` — JSON: `{package, version, ref, commitSha, sha256, installedAt}`. zod-validated on read; malformed sidecars return `null` so the doctor flags them as drift instead of throwing.
- `<target>.userEdited` — empty sentinel for SKILLS + ASSETS only (workspace files retired the concept under the block model). When present, sync skips the target loudly and the receipt carries a reclaim hint; the confirmed `--reclaim` path is the only way past it.

For directory targets (skills): sidecars land **inside** the directory (`<target>/.installedBy`), matching the existing `plugin-assets.ts` convention.

`computeFileSha(path)` is content-deterministic. `computeDirSha(path)` is a recursive Merkle-style hash that ignores `.installedBy` / `.userEdited` so writing a sidecar doesn't change the recorded sha.

## Managed blocks

`packages/core/src/agent-packages/managed-blocks.ts` — primitive operations on `<!-- bakin:<blockId>:start --> ... <!-- bakin:<blockId>:end -->` regions in markdown files. Used by:
- The agent-package projector — ONE composed `bakin:managed` block per workspace file (layered context + template + lessons; see `.claude/knowledge/layered-context.md`)
- The role context files (`~/.bakin/team/context/roles/*.md`), whose Bakin-shipped defaults live inside their own managed block

Functions: `injectBlock`, `extractBlock`, `removeBlock`, `listBlocks`, `hasBlock`, `getBlockState`, `isValidBlockId`. Pure — string-in, string-out, no fs.

`getBlockState` distinguishes `'absent' | 'present' | 'orphan-start' | 'orphan-end'` so the doctor can refuse to silently rewrite malformed marker pairs (the user's intent isn't clear; fail loud instead). For AGENTS.md, malformed compact markers or malformed legacy per-rule markers both stop auto-fix until the marker pair is corrected manually.

## Install flow

`src/core/agent-packages/installer.ts` — `installPackage(options)`:

1. **Acquire `~/.bakin/packages/.lock`** via `install-lock.ts` (PID-tagged advisory file lock with stale-detection)
2. **Fetch source** via `source-fetcher.ts` → staging dir + commitSha. github: clones with `--depth 1 --branch <ref>` first; on failure (commit SHAs not accepted by `--branch`), falls back to deeper clone + `git checkout`. Local sources copy with `dereference:false`. Bare names refuse.
3. **Parse + validate manifest** via the zod schema
4. **Compute install mode** for `kind: "agent"`:
   - state=`absent` + no `--adopt`: `mode=fresh` (creates the runtime agent later)
   - state=`unmanaged` + `--adopt`: `mode=adopt` (binds to the existing runtime agent; blocks inject non-destructively)
   - state=`managed`: refuse with "use sync" message
5. **Resolve dependencies** via `dependency-resolver.ts` — recursive walk, cycle detection, max-depth=8, leaves-first topological order
6. **Project** via `projector.ts`:
   - Composed managed blocks — one per workspace file, every mode, written in place via `injectBlock` (agent content outside markers untouched; lessons compose into the SOUL.md block)
   - Skills (per-agent for kind:agent / global for kind:skill-pack; collision check refuses different-package targets unless `--replace`)
   - Assets (`~/.bakin/agents/<id>/<file>` with sidecars; collision check)
   - Atomic at the package level via in-memory `WriteLog`; any error rolls back every prior write
7. **Update lockfile** atomically. Builds two id→key maps (`idToLockKey` for `incrementRefCount`, `sourceToLockKey` for `listImmediateDeps`) so each transitive dep records its IMMEDIATE parent (not the top-level invocation root) as the dependent — critical for cascade-removal correctness.
8. **For kind:"agent" + fresh:** call `getAppServices().runtime.agents.create()`
   and update runtime allowlists. `defaultModel` + `dispatchableBy` propagate
   through the runtime adapter on fresh install only (per settled D5 — user owns
   models post-install via the Models UI).
9. **Commit staging → install dirs** via `renameSync` (atomic on same fs)
10. **Audit** via `appendAudit()` — events: `agent_pkg.{installed,adopted,updated,removed,lessons_enabled,lessons_disabled}` and `pkg.{installed,removed}` for non-agent kinds
11. **Release lock** in finally — survives any error path

On failure: rollback every projection in reverse via `unprojectPackage()`; remove any committed install dirs; clean up staging; lockfile untouched; lock released.

## Cascade uninstall

`removePackageById(options)` in `uninstaller.ts`:

1. Read lockfile entry
2. Refuse if `refCount > 0` and no `--force`
3. Unproject each projection (skipping `.userEdited`, optionally `keepBlocks` for lesson markers)
4. Remove the install dir
5. **Recursive cascade:** for each entry in `entry.dependencies`, decrement that dep's refCount against THIS package as the dependent. If the dep's refCount hits 0, recursively unproject + remove its install dir + recurse into ITS deps with the orphan as the dependent. N-level deep chains cascade correctly because each level decrements its OWN immediate parent.
6. Optionally delete the runtime agent for `kind:"agent"` when requested.
   - `agents orphan <id>` / default `remove` behavior removes Bakin package tracking and managed projections, leaving the OpenClaw agent intact. This is the inverse of `--adopt`: Bakin detaches from an existing runtime agent.
   - `agents delete <id>` / `remove --delete-agent` asks the runtime adapter to fully remove the agent. The OpenClaw adapter deletes the config entry, removes allowlist references, removes OpenClaw-owned `agents/{id}` + `workspaces/{id}` state under `OPENCLAW_HOME`, and removes cron jobs tied to that agent.
7. Audit

## Update flow

`updatePackageById(options)` in `updater.ts` (the fetch step inside `syncAgent`):

1. Read lockfile entry
2. Re-fetch source at the SAME `source` + `ref` (compares new commitSha/version to recorded; identical = no-op)
3. Re-project: composed blocks rewritten in place; skills + assets re-projected (collision check still runs)
4. Update lockfile entry's commitSha + projection records (`composedSha` + per-input shas; preserves original installedAt)
5. Audit `agent_pkg.updated`

`syncAgent(agentId, opts)` in `sync.ts` is the user-facing verb wrapping it:
optional fetch → reclaim → ALWAYS local re-projection (context layers change
without the source moving) → verify via the drift scanner → receipt + audit.

`defaultModel` and `dispatchableBy` are NOT re-applied on update — they only propagate on fresh install per D5.

## Workflow + skill source registry tiers

`plugins/workflows/lib/source-registry.ts` and `plugins/workflows/lib/agent-package-skill-registry.ts` each carry three tiers:

- `plugin` — populated by `ctx.registerWorkflow()` / `ctx.registerSkill()` during plugin activation
- `agent-package` — populated at boot by `src/core/agent-packages/load-sources.ts` walking the lockfile and reading each managed agent / workflow-pack package's source dir
- `user` — populated from `~/.bakin/workflows/{definitions,skills}/*` on disk

Resolution order: **user > agent-package > plugin**. User files always win; agent-package can override plugin defaults; plugin is the fallback. Same precedence for workflow definitions and workflow-skills.

Server.ts boot: plugin registry initializes → `loadAgentPackageSources()` runs → user files load. Order matters; the load-sources call sits between plugin init and the Antfly initialization (line ~136 of server.ts).

## Search indexing and retrieval for lesson files

The team plugin (`plugins/team/index.ts`) registers a `agent-lessons` content type via `ctx.search.registerFileBackedContentType()`:
- Glob: `packages/agents/*/lessons/*.md`
- Schema: `title`, `body`, `package_id`, `agent_id`, `lesson_id`, `tags[]`, `default_enabled`, `updated_at`
- Searchable: `title` + `body`. Facets: `package_id`, `agent_id`, `tags`. Chunker enabled (250 token target / 30 overlap).

Retrieval in `src/core/agent-packages/lesson-retrieval.ts` is dispatch-time:
- `retrieveAgentPackageLessons()` finds the target agent's package via the lockfile, queries `agent-lessons`, filters results down to the package's enabled `lessonsEnabled` lessons, dedupes repeated chunk hits by `lesson_id`, hydrates full lesson bodies from the installed package source, and returns the top configured lessons. The installed source file is the source of truth; stale search hits with missing or empty source files are skipped.
- `dispatch.ts` injects the formatted top lessons into regular task dispatch and workflow step dispatch. Retrieval failures are audited and do not block dispatch.
- The team plugin exposes `bakin_exec_lesson_search`, scoped to the calling agent, for follow-up lookup over the same enabled lesson set.
- Settings live under `settings.agentPackages.lessonsRetrieval`: `enabled`, `injectIntoDispatch`, `mcpTool`, `maxLessons`, `maxCharacters`, `minScore`.

Current limitation: `enabled` is NOT indexed — the lockfile remains the source of truth for per-agent enabled state. Searching hits all available lessons; consumers cross-reference the lockfile to filter.

V1 limitation: lesson-pack lessons aren't indexed (glob targets `packages/agents/*` only). Adding a parallel lesson-pack content type or extending the glob is V1.5 work.

## Agent states

`src/core/agent-packages/agent-state.ts:getAgentState(agentId)` cross-references
the runtime roster + lockfile:

- `absent` — neither side knows the agent
- `unmanaged` — in the runtime roster, no lockfile entry (the historical default for hand-built agents). Still receives the global/role/team AGENTS.md block — unmanaged means no PACKAGE, not no Bakin context.
- `managed` — both sides know it; Bakin owns the package, projected files, and composed blocks. (`adopted` collapsed into `managed`; legacy lockfiles normalize on read.)

Critical correctness rule: a runtime agent without a lockfile entry MUST surface
as `unmanaged` (NOT `absent`). Mis-classifying lets the installer create a
fresh runtime agent with the same id, risking the user's existing setup.

Version reporting rule: managed agent package state includes a top-level
`version` copied from the lockfile entry. The team detail view and
`bakin agents list --packages` must render that lockfile/API version (falling
back to nested `entry.version` only for compatibility), not infer the version
from an install path, source ref, package id, or stale runtime state.

Update reporting rule: `GET /api/agent-packages?check=1` re-fetches the
recorded source and returns `updateStatus` alongside the installed lockfile
state. This check is read-only; it never mutates the installed version or
lockfile commit. The Team detail package card uses this status to show
`update-available` and offer Maintain-changes vs Reseed-package-templates
upgrade modes.

## Doctor integration

`plugins/team/lib/health-checks.ts:checkAgentSync()` wraps the drift scanner
(`src/core/agent-packages/sync-scanner.ts`) — block staleness with per-layer
attribution, skill/asset drift, role-context freshness, user-edited locks,
migration state. Local-only, every doctor cycle. The repair handler offers a
safe local-sync item plus a destructive confirm-required migration item.
CLI twins: `bakin check agent-sync` / `bakin install agent-sync`.

## CLI surface

Two-file pattern (`cli/bakin.ts` is HTTP-client; `src/core/cli.ts` is binary dispatcher delegating unknowns to it):

- `bakin agents install <source> [--adopt] [--install-as <id>] [--replace]`
- `bakin agents list [--packages]` — `--packages` switches from runtime view to package state view
- `bakin agents orphan <id> [--keep-blocks] [--force]`
- `bakin agents delete <id> [--keep-blocks] [--force]`
- `bakin agents remove <id> [--keep-blocks] [--delete-agent|--delete|--orphan] [--force]` — compatibility spelling; default is orphan
- `bakin agents sync [<id>] [--check] [--reclaim <target>|--reclaim-all] [--yes]` — no id = sync every agent (managed: fetch + recompose + verify + receipt; unmanaged: context block only). Prompts once for the one-time block migration on legacy installs.
- `bakin agents lessons {list,enable,disable} <id> [<lesson-id>]` — toggling = lockfile change + local sync (SOUL block recomposes)
- `bakin packages {list,install,remove,sync}` — for non-agent kinds; refuses remove on refCount > 0 unless `--force`
- `bakin check agent-sync` / `bakin install agent-sync` — drift report + local repair via the onboarding component

Function-name collision avoided: package-management functions are prefixed `cmdAgentPackages*` to coexist with the existing runtime `cmdAgents*` family (status/tasks/send).

## REST surface

Top-level (NOT under `/api/agents/*` which is the runtime surface):

```
GET    /api/agent-packages[?check=1]
POST   /api/agent-packages/install
DELETE /api/agent-packages/{agentId}
POST   /api/agent-packages/{agentId}/update
GET    /api/agent-packages/{agentId}/lessons
POST   /api/agent-packages/{agentId}/lessons/{lessonId}

GET    /api/packages
POST   /api/packages/install
DELETE /api/packages/{packageId}
POST   /api/packages/{packageId}/update

Curated browsing lives in the explore plugin: GET /api/plugins/explore/catalog
(unified catalog at packages/host/src/data/curated-catalog.json; the old
GET /api/curated host route was removed)
```

Static-path routes are individual handler files (`install.ts` / `list.ts`); dynamic-path routes share one `dynamic.ts` handler that parses the path and dispatches internally. All bodies validated with zod; status codes follow obvious mapping (collisions + already-installed = 409, unknown = 404, otherwise 500).

## Settled design decisions (worth knowing)

These came up during spec/plan and the answers shape the system. From SPEC.md:

1. **chef/patch repackaged like the rest.** main + main-operator stay unmanaged.
2. **Workflow projection** — extends the existing source-registry with an `agent-package` tier, not a synthetic plugin id. Removal = lockfile entry deleted = source stops resolving.
3. **`installAs` aliasing** — both surfaces ship: declarative `dependencies[].installAs` (canonical, intra-package-graph collisions) AND imperative `--install-as` CLI flag (user-resolved at install time). They share the resolved-id path. **V1 limitation**: aliases the lockfile key only, NOT the projection target — per-skill rename is V1.5.
4. **Adoption block scope** — adopting writes only the catalog block + lessons listed in `manifest.install.enableLessons`. All other lessons stay opt-in via UI/CLI toggle.
5. **Update refresh of `defaultModel` / `dispatchableBy`** — only on fresh install. User controls models via the Models UI from then on.

## MCP tool policy

Agent-package `agent.allowedTools` is enforced by Bakin's MCP server, not by the
runtime provider. `src/core/mcp-tool-policy.ts` reads the lockfile entry,
loads the installed package's `bakin-package.json`, and resolves policy for the
session agent:

- No lockfile entry means an unmanaged legacy agent and remains unrestricted.
- A managed or adopted package agent with missing or empty `allowedTools`
  remains unrestricted.
- A managed or adopted package agent with non-empty `allowedTools` is scoped by
  that list.
- Missing manifests, malformed manifests, and malformed lockfile entries still
  fail closed.
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
- **No lesson-pack retrieval.** Dispatch-time retrieval covers installed agent-package lessons only. Lesson-pack lessons are not indexed yet.
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
├── lesson-toggle.ts        setLessonEnabled (single-lesson SOUL.md mutator)
└── load-sources.ts         boot-time lockfile → source-registry

packages/host/src/api/
├── agent-packages/
│   ├── install.ts          POST handler
│   ├── list.ts             GET handler
│   └── dynamic.ts          DELETE/POST/lessons dispatcher
├── packages/
│   ├── install.ts
│   ├── list.ts
│   └── dynamic.ts
packages/host/src/data/
└── curated-catalog.json    binary-embedded unified catalog (v2 — agents,
                            plugins, packs; consumed by onboarding + the
                            explore plugin)

plugins/team/components/
├── package-state-badge.tsx
├── adopt-dialog.tsx
└── lesson-toggle-list.tsx

plugins/explore/            discovery storefront (browse + install UI;
                            see .claude/knowledge/explore-plugin.md)

plugins/workflows/lib/
├── source-registry.ts      extended with agent-package tier
├── skill-loader.ts         extended with agent-package tier
└── agent-package-skill-registry.ts  in-memory registry (parallel to plugin skills)

Agent packages now live outside the Bakin core repo:
- Public first-party agents: `github:markhayden/bakin-bits-official#agents/<id>`
- Private agents: `github:markhayden/bakin-bits-official-private#agents/<id>`
```

## Companion future work (issues)

- **#157** — V2 dispatch-time lesson retrieval. Implemented for installed agent-package lessons via `agent-lessons` search + lockfile filtering. Remaining follow-up: doctor/analytics reporting for indexed lessons that are never retrieved.

## Capability packs (pi-parity, 2026-07-13)

Skill-packs may declare `capability` (slug), `runtimes` (default `['*']`),
`requires.bins[]` (pinned sha256-verified per-platform downloads →
`~/.bakin/bin`), and enforced `secrets[]` (`secretSlot` + `help` drive the
guided key step and boot env injection). Install resolves bare catalog
names server-side; readiness is ONE engine
(`src/core/agent-packages/capability-readiness.ts`) behind REST, doctor,
`bakin check capabilities`, and the runtime hub. Full doc:
`.claude/knowledge/capability-packs.md` — including the plugin vs pack vs
agent taxonomy (coupling + composition rules) that keeps the lanes clean.
