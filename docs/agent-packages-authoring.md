# Authoring a Bakin agent package

This guide walks through writing a Bakin **agent package** end-to-end:
shape, manifest, knowledge files, dependencies, install flow, and
publishing. Agent packages are a separate primitive from plugins —
plugins ship behavior (routes, UI, MCP tools), agent packages ship
content (identity, persona, skills, workflows, knowledge).

If you want runnable code that adds a new MCP tool or UI page, you want
[`docs/plugin-authoring.md`](./plugin-authoring.md). If you want a
versioned, distributable, lockfile-tracked agent persona — you're in
the right place.

## Prerequisites

- **Bun >= 1.2.0** — `curl -fsSL https://bun.sh/install | bash`
- A running Bakin (the compiled binary or `bun run dev`)
- The `bakin` CLI on your PATH
- A working OpenClaw install (agent packages of `kind: "agent"` create
  or adopt OpenClaw agents)

## Package kinds

Every package declares one `kind`:

| Kind | What it ships | Lockfile key | Typical layout |
|------|---------------|--------------|----------------|
| `agent` | persona files, optional skills/workflows/knowledge/assets, dispatch perms | bare id (`pixel`) | `workspace/` + `knowledge/` + `assets/` |
| `skill-pack` | reusable OpenClaw skills used by multiple agents | `<id>@<version>` | `skills/<name>/` |
| `workflow-pack` | reusable workflow definitions + step instructions | `<id>@<version>` | `workflows/` + `workflow-skills/` |
| `knowledge-pack` | cross-agent knowledge lessons | `<id>@<version>` | `knowledge/` |

The agent-kind uses a bare-id lockfile key because there is exactly one
OpenClaw agent per id — two versions cannot coexist. Non-agent kinds
use a compound `<id>@<version>` key so an update can stage the new
version alongside the old one before flipping the pointer.

This guide focuses on `kind: "agent"` because it is the richest case;
the other three are subsets. References to skill / workflow / knowledge
packs are called out where they differ.

## Directory layout (agent kind)

```
my-agent/
├── bakin-package.json        ← manifest (id, kind, name, version, agent stanza)
├── README.md                 ← package description, install hints, choices
├── workspace/                ← seeded into the OpenClaw workspace on fresh install
│   ├── SOUL.md               ← persona + knowledge marker placeholders
│   ├── IDENTITY.md           ← structured identity card
│   ├── AGENTS.md             ← agent-specific operational rules
│   └── TOOLS.md              ← per-install local notes (template)
├── knowledge/                ← lessons, with frontmatter
│   ├── core-style.md         ← defaultEnabled: true
│   └── advanced-tactics.md   ← defaultEnabled: false (opt-in)
├── workflow-skills/          ← (optional) step instructions resolved by the workflows plugin
│   └── do-the-thing.md
├── workflows/                ← (optional) workflow YAML definitions
│   └── thing-flow.yaml
├── skills/                   ← (optional) per-agent OpenClaw skills
│   └── my-tool/
│       ├── SKILL.md
│       └── scripts/
└── assets/                   ← (optional) avatar + UI assets
    ├── avatar.jpg
    └── avatar-full.png
```

Cross-cutting rule: a package source tree contains **only files Bakin
projects on install**. No build outputs, no `dist/`, no `node_modules/`.
Agent packages are content packages, not compiled code.

For other kinds: `kind: "skill-pack"` drops the workspace/knowledge
directories and centers on `skills/`; `kind: "workflow-pack"` centers on
`workflows/` + `workflow-skills/`; `kind: "knowledge-pack"` centers on
`knowledge/`. The manifest's `contributions` map enforces that.

## Manifest (`bakin-package.json`)

Full agent example:

```json
{
  "id": "my-agent",
  "kind": "agent",
  "name": "My Agent",
  "version": "0.1.0",
  "description": "One-line description shown in the Teams UI",
  "bakin": "^1.0.0",
  "author": "Your Name <you@example.com>",
  "agent": {
    "identity": {
      "name": "My Agent",
      "emoji": "🤖"
    },
    "role": "Short role description",
    "defaultModel": "anthropic/claude-sonnet-4-6",
    "dispatchableBy": ["main"],
    "tags": ["research", "writing"],
    "allowedTools": [
      "bakin_exec_tasks_*",
      "bakin_exec_get_paths",
      "bakin_exec_log",
      "bakin_exec_heartbeat"
    ],
    "allowedSkills": []
  },
  "install": {
    "createIfMissing": true,
    "adoptIfExists": true,
    "writeWorkspaceFiles": true,
    "installSkills": true,
    "installWorkflows": true,
    "enableKnowledge": ["core-style"]
  },
  "contributions": {
    "workspaceFiles": [
      "workspace/SOUL.md",
      "workspace/IDENTITY.md",
      "workspace/AGENTS.md",
      "workspace/TOOLS.md"
    ],
    "knowledge": [
      "knowledge/core-style.md",
      "knowledge/advanced-tactics.md"
    ],
    "assets": ["assets/avatar.jpg", "assets/avatar-full.png"]
  },
  "dependencies": {
    "skills": [
      {
        "source": "github:madeinwyo/bakin-skills-visual",
        "ref": "v0.3.1",
        "items": ["image-generation"]
      }
    ]
  }
}
```

Field rules:

- `id` — `/^[a-z0-9][a-z0-9-_]{0,39}$/i`. Same constraint as plugin ids.
- `kind` — discriminator; one of `agent | skill-pack | workflow-pack | knowledge-pack`.
- `version` — semver string. Bump on every meaningful change to package
  contents; the lockfile records the version + commitSha for drift
  detection.
- `bakin` — semver range of compatible Bakin versions.
- `agent` (agent kind only) — identity, role, optional `defaultModel`,
  `dispatchableBy[]`, `tags[]`, declarative `allowedTools[]` /
  `allowedSkills[]`. The two `allowed*` lists are documentation in V1
  and become enforced at the dispatch-routing layer in a later release
  (issue #42).
- `install` (agent kind only) — install-flow knobs:
  - `createIfMissing` — call `addAgent` on OpenClaw when the agent doesn't exist
  - `adoptIfExists` — allow `--adopt` mode when the agent already exists
  - `writeWorkspaceFiles` — project SOUL/IDENTITY/AGENTS/TOOLS on fresh install
  - `installSkills` / `installWorkflows` — toggle those projection passes
  - `enableKnowledge[]` — lesson ids enabled by default after install
- `contributions` — exhaustive list of paths the projector reads. The
  shape is enforced per-kind: `skill-pack` requires non-empty `skills`,
  `workflow-pack` requires at least one of `workflows` /
  `workflowSkills`, `knowledge-pack` requires non-empty `knowledge`.
- `dependencies` — see [Dependencies](#dependencies) below.

The manifest is zod-validated at install time. Errors print the offending
path (e.g., `agent.identity.emoji: Required`) so you can fix the file
without reading the schema source.

## Workspace files

The four workspace files have a specific contract:

- **SOUL.md** — persona, voice, values. Must contain a knowledge-catalog
  marker pair somewhere in the body:
  ```markdown
  <!-- bakin:knowledge-catalog:start -->
  <!-- bakin:knowledge-catalog:end -->
  ```
  The projector injects the per-lesson catalog inside that pair on
  install. Per-lesson body blocks (`<!-- bakin:knowledge:<agent>:<lesson>:start -->`)
  are added wherever the projector chooses to place them — author-controlled
  placement is V1.5.

- **IDENTITY.md** — structured identity card. Free-form markdown; no
  required markers.

- **AGENTS.md** — agent-specific operational rules. **Do not** ship the
  cross-agent default blocks (`bakin:mission-control`,
  `bakin:hard-rules`, `bakin:dependency-pattern`,
  `bakin:media-delegation`, `bakin:workflow-rules`, `bakin:asset-rules`,
  `bakin:scheduling-rules`) — `bakin doctor` injects those after install
  and keeps them current as Bakin's defaults evolve. Your `AGENTS.md`
  should contain only the rules that are unique to your agent.

- **TOOLS.md** — boilerplate template the user customizes per-install.

### `templateOnly` carve-out

After install, an agent can edit any of the four workspace files freely
and Bakin will **not** flag drift. The projector records workspace
files with `templateOnly: true` in the lockfile, which exempts them
from sha-based drift checks. `bakin agents update` skips them by
default; pass `--refresh-template` only when you've made a backwards-
compatible template change you genuinely want to push out.

This is the core ergonomic reason workspace files exist as a separate
projection class — agents are personalities, and the user owning their
voice is more important than maintaining template fidelity.

## Knowledge files

Knowledge is *taste, perspective, doctrine* — non-executable markdown
the agent reads as context. Each file has zod-validated frontmatter:

```markdown
---
title: Prompt Style System
tags: [core, prompting, style]
defaultEnabled: true
---

# Prompt Style System

How <agent> writes prompts. This is taste, not a checklist.

## Anatomy of a good prompt
...
```

Frontmatter fields:

- `title` (required) — display name shown in the Teams UI knowledge
  toggle list. The lesson id is the filename without `.md` (so
  `prompt-style-system.md` → lesson id `prompt-style-system`).
- `tags[]` (optional) — facets used for search filtering and UI
  grouping.
- `defaultEnabled` (optional, default `false`) — whether this lesson is
  toggled on after a fresh install. `manifest.install.enableKnowledge[]`
  is the authoritative source for fresh-install enablement; this field
  is a per-lesson hint the manifest can override.

Body content is plain markdown. Aim for concrete, opinionated guidance
— knowledge is the place for the "how this agent thinks" voice that
doesn't fit in `SOUL.md` because it's domain-specific.

When a lesson is enabled, the projector injects two managed blocks:

1. A line into the SOUL.md catalog: `- prompt-style-system — Prompt Style System`
2. A body block somewhere in SOUL.md: `<!-- bakin:knowledge:<agent>:prompt-style-system:start -->\n<lesson body>\n<!-- bakin:knowledge:<agent>:prompt-style-system:end -->`

Toggling a lesson off via `bakin agents knowledge disable` removes both
blocks. The lesson file in `~/.bakin/packages/agents/<id>@<version>/knowledge/`
stays put, ready to be re-enabled.

V1 limitation: knowledge is statically injected. V2 (issue #157) will
do dispatch-time semantic retrieval; the data model is unchanged.

## Skills, workflows, workflow-skills

Three optional contribution surfaces, all keyed off paths declared in
the manifest:

- **`contributions.skills`** — directories containing OpenClaw skills.
  For `kind: "agent"`, these install per-agent into
  `~/.openclaw/workspaces/<agentId>/skills/<name>/`. For
  `kind: "skill-pack"`, they install globally into
  `~/.openclaw/skills/<name>/` and trigger collision detection if a
  different package already owns the same target.

- **`contributions.workflows`** — YAML workflow definitions, registered
  with the workflows plugin's source registry under the
  `agent-package` tier. User files in `~/.bakin/workflows/definitions/`
  override; plugin-registered workflows fall through. Same id
  collisions across packages refuse without an explicit aliasing.

- **`contributions.workflowSkills`** — markdown step instructions for
  the workflows plugin. Same three-tier resolution
  (user > agent-package > plugin).

Skills, workflow definitions, and workflow-skills all have
`.installedBy` provenance sidecars after install. See
[Marker semantics](#marker-semantics) below.

## Assets

`contributions.assets` is the place for per-agent UI files — avatars,
logos. They project to `~/.bakin/agents/<agentId>/<file>` with a
sibling `.installedBy` sidecar. Avatars at the canonical paths
`avatar.jpg` and `avatar-full.png` are picked up automatically by the
Teams UI and the agent-detail viewer.

Image format: any browser-native (jpg/png/webp). Keep `avatar.jpg`
under 200 KB and square-cropped (the UI center-crops at smaller sizes);
`avatar-full.png` can be larger / non-square.

## Marker semantics

Every projected file gets two sidecars in
`packages/core/src/agent-packages/markers.ts`:

- **`<target>.installedBy`** — JSON sidecar recording
  `{package, version, ref, commitSha, sha256, installedAt}`. The
  installer uses this to detect collisions (a different package trying
  to install at the same target) and the doctor uses it to detect drift
  (file sha changed since install).

- **`<target>.userEdited`** — empty sentinel. **When this file exists,
  the projector NEVER overwrites the target** — not on update, not on
  `--fix`, not on `--refresh-template`. Use this when you've manually
  edited a projected file and want to take ownership of it.

For directory targets (skills), both sidecars live INSIDE the directory
(`<target>/.installedBy`), matching the existing plugin-assets
convention.

The takeaway for package authors: don't bake hashes or paths into your
package source. The projector handles all sidecar bookkeeping based on
what it actually wrote.

## Dependencies

Cross-package composition. Lets multiple agents share a skill-pack
without each one duplicating the skill source.

```json
"dependencies": {
  "skills": [
    {
      "source": "github:madeinwyo/bakin-skills-visual",
      "ref": "v0.3.1",
      "items": ["image-generation", "prompt-refinement"],
      "installAs": "shared-visual-v031"
    }
  ],
  "workflows": [
    {
      "source": "github:madeinwyo/bakin-workflows-creative",
      "ref": "v0.2.0"
    }
  ],
  "knowledge": []
}
```

Per dependency:

- `source` (required) — `github:user/repo` or local path (`./...`,
  `../...`, `/...`, `~/...`). Bare names refuse — there is no hosted
  registry in V1.
- `ref` (required) — git tag, branch, or commit SHA. Tag/SHA is
  reproducible; branch is "live edge" and not recommended for
  packages you publish.
- `items[]` (optional) — subset of contributions to project. Without
  it, all of the dep's contributions install.
- `installAs` (optional) — alias for the lockfile key. Useful when two
  packages depend on different versions of the same dep. **V1
  limitation:** aliases only the lockfile key, NOT the projection
  target. Per-skill rename to avoid on-disk collisions is V1.5 work;
  for V1, use `--replace` or version-pin one side.

The dependency resolver walks recursively (max-depth=8) with cycle
detection. Diamond dependencies short-circuit on `<source>@<ref>`, so
A→B→D and A→C→D resolve D once. The lockfile records each transitive
dep's IMMEDIATE parent as the dependent, so cascade-uninstall (removing
A) decrements B and C correctly without orphaning D prematurely.

Use `installAs` carefully — same-package-different-target is a real
divergence story, and V1's lockfile-only aliasing is the safer default
than letting on-disk collisions happen silently.

## Install flow

```sh
# Local — copies source into ~/.bakin/packages/agents/<id>@<version>/
bakin agents install ./my-agent

# GitHub — clones at the given ref + commitSha
bakin agents install github:your-user/bakin-agent-my-agent@v0.1.0

# Adopt an existing OpenClaw agent (preserves their workspace files)
bakin agents install ./my-agent --adopt my-agent

# Force collision resolution
bakin agents install ./my-agent --replace
```

What happens under the hood:

1. **Acquire** the install lock at `~/.bakin/packages/.lock` (PID-tagged
   advisory file lock with stale-detection).
2. **Fetch source** to a staging directory + record commitSha. github:
   sources clone with `--depth 1 --branch <ref>` first, falling back to
   a deeper clone + `git checkout` for commit-SHA refs.
3. **Parse + validate** the manifest via the zod schema.
4. **Compute install mode**:
   - `mode=fresh` — agent absent, no `--adopt`. Calls `addAgent` on
     OpenClaw later. Workspace files projected.
   - `mode=adopt` — agent unmanaged in OpenClaw, `--adopt` set. Workspace
     files NOT projected; only markers, assets, and the catalog block.
   - Already managed/adopted: refuse with "use update".
5. **Resolve dependencies** recursively, leaves-first.
6. **Project** each contribution. Skills/assets get sidecars; workspace
   files get sidecars but with `templateOnly: true`. Knowledge markers
   inject into SOUL.md. The whole package projection is atomic — any
   error rolls every prior write back.
7. **Update the lockfile** atomically (tmp + rename). Records the agent's
   immediate dependents on each transitive dep.
8. **For fresh agent installs:** call OpenClaw `addAgent` +
   `addToAllowLists`. `defaultModel` and `dispatchableBy` propagate to
   `openclaw.json` here — and only here. Updates do NOT re-apply them
   (the user owns the model choice via the Models UI post-install).
9. **Commit staging → install dirs** via `renameSync` (atomic on same fs).
10. **Audit log** the operation.
11. **Release lock** in finally.

If anything fails: the WriteLog rolls back every projection in reverse,
any committed install dirs are removed, staging is cleaned up, the
lockfile is untouched, and the lock is released.

## Updating

```sh
# Update one package
bakin agents update my-agent

# Update everything managed/adopted
bakin agents update

# Force re-projection of workspace files (skips templateOnly carve-out)
bakin agents update my-agent --refresh-template
```

Update re-fetches the source at the SAME `source` + `ref`. If the
fetched commitSha matches what's in the lockfile, it's a no-op. If
it changed, the projector re-runs in `update` mode:

- Skills + assets: re-projected (collision check still runs).
- Knowledge markers: re-injected in-place via `injectBlock`.
- Workspace files: skipped unless `--refresh-template`.

After a successful update, the lockfile entry's `commitSha` and
projection shas are refreshed; `installedAt` is preserved as the
original install timestamp.

## Removing

```sh
# Untrack the package; preserve the OpenClaw agent
bakin agents remove my-agent

# Remove the agent from OpenClaw too
bakin agents remove my-agent --delete-agent

# Keep knowledge blocks in SOUL.md after removal (rare)
bakin agents remove my-agent --keep-blocks

# Force removal even if other packages depend on it (only for non-agent kinds)
bakin packages remove visual@0.3.1 --force
```

Removal cascades: each declared dependency has its refCount decremented
against THIS package as the dependent. Any dep whose refCount hits 0
gets unprojected + its install dir removed + ITS deps recursed against
the orphan. N-level chains cascade correctly because each level
decrements its own immediate parent.

`--force` is a non-agent-only escape hatch for breaking dependency
graphs deliberately; the agent kind never has dependents (it's always
a leaf in the package graph).

## Knowledge toggles

Per-lesson runtime control:

```sh
bakin agents knowledge list my-agent
bakin agents knowledge enable my-agent advanced-tactics
bakin agents knowledge disable my-agent core-style
```

Each enable/disable rewrites the SOUL.md catalog block + injects or
removes the per-lesson body block. The lockfile's `knowledgeEnabled[]`
is the authoritative state.

The Teams UI exposes the same operations as toggle switches with
optimistic updates — see `plugins/team/components/knowledge-toggle-list.tsx`.

## Testing locally

The fastest iteration loop is install-from-disk:

```sh
# Initial install
bakin agents install ./my-agent

# Iterate on the package source
$EDITOR ./my-agent/knowledge/core-style.md

# Bump the version in bakin-package.json (e.g., 0.1.0 → 0.1.1)

# Re-install — wipes + re-projects
bakin agents remove my-agent && bakin agents install ./my-agent
```

For non-agent kinds (you're not destroying an OpenClaw agent on each
cycle), the loop is just remove + install:

```sh
bakin packages remove my-pack@0.1.0 && bakin packages install ./my-pack
```

Validation without installing: there's a script in
`scripts/migration/validate-package.ts` that runs the manifest schema
against a candidate directory and prints the validation result. Useful
in CI for package repos:

```sh
bun run scripts/migration/validate-package.ts ./my-agent
```

## Drift + repair

```sh
# Report drift across all installed packages
bakin check agent-assets

# Auto-repair drifted projections (re-runs the update flow)
bakin install agent-assets

# Doctor catches drift in its standard check
bakin doctor
```

Drift means a projected file's content sha no longer matches what the
lockfile recorded — typically because a user (or another tool) edited
the file directly. The repair flow re-projects everything except
`templateOnly` workspace files and `.userEdited`-marked files.

If you genuinely want a manual edit to stick, drop a `.userEdited`
sentinel next to the file:

```sh
touch ~/.bakin/agents/my-agent/avatar.jpg.userEdited
```

The next update / repair will leave that file alone.

## Publishing to GitHub

Agent packages are plain git repositories. Naming convention:
`bakin-agent-<id>`, `bakin-skills-<name>`, `bakin-workflows-<name>`,
`bakin-knowledge-<topic>`. The convention is purely social —
`bakin agents install github:user/anything` works as long as the repo
contains a valid `bakin-package.json` at the root.

Recommended repo layout:

```
bakin-agent-my-agent/
├── bakin-package.json
├── README.md                ← description + install instructions
├── workspace/
├── knowledge/
├── assets/
├── .github/workflows/
│   └── validate.yml         ← CI: bun run scripts/.../validate-package.ts
└── LICENSE
```

Tag releases with `v<version>` matching the manifest's `version`
field. `bakin agents install github:user/repo@v0.1.0` resolves the
tag; without a tag, the install pulls the default branch HEAD (which
is fine for development but not reproducible — pin tags in
production).

Once you tag a release, anyone with Bakin and access to the repo can:

```sh
bakin agents install github:your-user/bakin-agent-my-agent@v0.1.0
```

…and end up with a fully provisioned OpenClaw agent, knowledge files,
optional skills/workflows, and a lockfile entry tracking the package
back to the exact commitSha you tagged.

## Curated catalog

`packages/host/src/data/curated-agents.json` is a static catalog of
suggested agent packages bundled into the Bakin binary. The Teams UI
"Browse curated" view reads it and surfaces one-click install. There
is no hosted registry in V1 — bare-name install (`bakin agents install
my-agent`) errors out. The catalog is a UX shortcut; users can still
install any GitHub repo or local path.

To get your package into the curated catalog, send a PR to
`bakin/packages/host/src/data/curated-agents.json` with an entry like:

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "emoji": "🤖",
  "description": "One-line description",
  "tags": ["research", "writing"],
  "source": "github:your-user/bakin-agent-my-agent",
  "ref": "v0.1.0",
  "trust": "community"
}
```

`trust` is display-only in V1 (`official | verified | community`). A
hosted registry + signed-package trust enforcement is future work.

## From the UI

The Teams plugin surfaces a small but useful slice of the agent-package model in the browser. Everything else is CLI today.

**Surfaced in the UI:**

- **Package state badge** on every agent card in the team grid — only renders for `unmanaged`, `drifted`, or `update-available` (healthy states stay clean). Color-coded.
- **Package card** at the top of the agent-detail Profile tab — read-only display of state, source, ref, commit (short SHA), installed-at, and dependencies for managed/adopted agents.
- **Adopt button** in the Package card on unmanaged agents — opens a dialog, asks for the package source, and `POST`s `/api/agent-packages/install` with `{ source, adopt: agentId }`. The Teams page updates without a reload.
- **Knowledge tab** on agent-detail — for managed/adopted agents, renders per-lesson on/off toggles backed by `/api/agent-packages/:id/knowledge`. Optimistic UI, revert on error.

**Still CLI-only:**

- **Install fresh agent** → `bakin agents install <source>`
- **Browse curated catalog** → `bakin agents install` from the curated list (no in-app browser yet)
- **Install non-agent kinds** (skill-pack / workflow-pack / knowledge-pack) → `bakin packages install <source>`
- **List installed packages** of any kind → `bakin packages list`
- **Update a package** → `bakin agents update <id>` or `bakin packages update <id>`
- **Remove a package** → `bakin agents remove <id>` or `bakin packages remove <id>`
- **Reset workspace** (re-template from package source) → `bakin agents update <id> --refresh-template`
- **Release a `.userEdited` lock** → `rm <file>.userEdited`
- **Drift repair** → `bakin install agent-assets` (CLI hint surfaced inside the Package card on `drifted` state)

A future "Workshop" page will bring install / browse / curated / non-agent management into the UI. Until then the CLI remains the canonical surface for those flows; the UI is sugar on top.

## Future work (not yet supported)

- **Per-skill rename via `installAs`.** V1 aliases the lockfile key only;
  on-disk projection collisions still need `--replace` or version-pinning.
- **Dispatch-time knowledge retrieval (issue #157).** All enabled
  lessons inject statically in V1; V2 will do semantic retrieval at
  dispatch time. Data model unchanged.
- **MCP-tool / skill scoping enforcement (issue #42).** `agent.allowedTools`
  and `agent.allowedSkills` are documentation-only in V1; the routing
  layer will enforce them in a later release.
- **Hosted registry / bare-name install.** `bakin agents install my-agent`
  errors out today; resolving that to a registry-tracked package is
  future work.
- **Bundles.** `bakin install creative-team` (one command bundling
  multiple agents + shared skill packs) is a future possibility, not V1.
- **Knowledge-pack search indexing.** The team plugin indexes
  `agents/*/knowledge/*.md` for full-text search; standalone knowledge
  packs are not indexed yet.

## Related docs

- [`./plugin-authoring.md`](./plugin-authoring.md) — companion guide for the OTHER kind of package (code, not content)
- [`../CLAUDE.md`](../CLAUDE.md) — architecture overview, build pipeline, testing rules
- [`../.claude/knowledge/agent-packages.md`](../.claude/knowledge/agent-packages.md) — internals reference for the agent-packages system
- [`../.claude/knowledge/team-plugin.md`](../.claude/knowledge/team-plugin.md) — how the Teams UI surfaces packages, adoption, and knowledge toggles
- [`../.claude/knowledge/workflows-plugin.md`](../.claude/knowledge/workflows-plugin.md) — how workflow definitions and workflow-skills resolve across plugin / agent-package / user tiers
