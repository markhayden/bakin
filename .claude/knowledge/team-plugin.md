# Team Plugin — Deep Reference

## Purpose

The team plugin is Bakin's adapter layer over OpenClaw's agent roster. It derives the entire team page — every agent card, every edge, the full pyramid — from whatever `openclaw.json` reports at runtime, decorated with Bakin-owned UI data (avatars, display overrides, heartbeats). Bakin **never** copies OpenClaw state; identity, rules, tools, soul, and workspace files all stay in `{OPENCLAW_HOME}/`.

## Client Entry

`plugins/team/client.tsx` calls `registerPlugin({ id: 'team', navItems, slots: { 'page:/team': TeamGrid, 'page:/team/[id]': AgentDetail } })`. The shell mounts those components at `/team` and `/team/:id` respectively via TanStack Router route modules (`packages/host/src/routes/team.index.tsx` and `team.$id.tsx`), each rendering `<Slot name="page:/team..." />`.

## Canonical Main Agent Contract

The orchestrator id is always the literal string `"main"` on every OpenClaw install. Display names come from `identity.name` on that entry. No detection heuristic, no settings override, no rename logic.

- `packages/core/src/main-agent.ts` — `getMainAgentId()`, `tryGetMainAgentId()`, `getMainAgentName()`
- `packages/core/src/openclaw-config.ts` — single mtime-cached reader for `openclaw.json`. All three helpers above call through here. Live edits are picked up on the next call.
- `src/core/onboarding/openclaw.ts` — doctor check that flags missing `main`, duplicate ids, duplicate workspaces. Reports only, never auto-fixes. Run via `bakin check openclaw`.

`BakinSettings.agents` and `BakinSettings.mainAgentId` **do not exist**. If you find a reference to them in tests or production code, it's a bug — use `getAgentIds()` / `getMainAgentId()` instead.

## Read Path: openclaw-adapter → listAgents

`plugins/team/lib/openclaw-adapter.ts#listAgents()` is the single read entry point for "the full roster as Bakin wants to render it." It:

1. Reads `openclaw.json` via `readOpenClawConfig()` (mtime-cached).
2. **Validates:**
   - If no entry has `id: "main"` → returns `[]` and logs an error. The UI shows an empty team rather than a broken pyramid.
   - Duplicate ids → first-wins, logs an error with the discarded entry.
   - Duplicate **resolved workspaces** (explicit `workspace` field, falling back to `defaults.workspace`) → first-wins, logs an error.
3. Merges Bakin-owned display data (`~/.bakin/plugin-settings/team.json` → accent colors, display name overrides, teamId assignments).
4. Merges heartbeats from `~/.bakin/heartbeats/{id}.json`.
5. Returns `AgentWithStatus[]`.

The adapter's **read** path (`listAgents`, `getAgentProfile`, etc.) never writes to `openclaw.json`. Agent lifecycle **writes** (`addAgent`, `removeAgent`, `updateAgentIdentity`) shell out to the OpenClaw CLI (`openclaw agents add/delete/set-identity`) via the `openclawExec()` helper. The only remaining direct `openclaw.json` write is `setSubagentPermissions()` — isolated because no CLI command exists for it yet.

## Pyramid Builder: build-graph.ts

`plugins/team/lib/build-graph.ts#buildGraph()` is a pure function — identical inputs produce identical outputs, no React, no side effects. The team-grid component is a thin xyflow wrapper that calls it.

### Row layout

| Row | Contents |
|-----|----------|
| 0 | Founder card ("Mark") |
| 1 | Main agent card (row 1 derived from `mainAgentId`, not from `topAgentIds`) |
| 2 | Non-main team leaders (sub-orgs whose `reportsTo` points at a non-main agent) |
| 3+ | Team section headers + member cards, grouped per reporter |
| +1 | Unassigned bucket (agents never placed) |

### reportsTo resolution

`resolveReporter()` treats all of these as "reports to main":

- `reportsTo === null`
- `reportsTo === undefined`
- `reportsTo === ""` (empty string)
- `reportsTo === someUnknownAgentId` (graceful degradation — don't orphan, don't crash)

This runs at render time. Stored `team.json` values are never rewritten on read.

### Broken roster degraded state

If `listAgents()` returned `[]` (missing `main`), the builder renders founder only. No orphan subagents, no synthesized sections. This is the intentional signal that OpenClaw state is broken — the UI stays quiet and points the user at `bakin check openclaw`.

### Synthetic "All agents" section

When `teams.length === 0` and the main agent has subagents, the builder synthesizes a single "All agents" section under main. Fresh installs get a visible pyramid shape without requiring the user to define any teams.

## Write Path: POST/PUT /teams normalization

`plugins/team/index.ts` owns the `teams` route. Both create (POST) and update (PUT) call `normalizeReportsTo()` before persisting:

```
normalizeReportsTo(input):
  if input === undefined || null || ""       → null
  if input === getMainAgentId() (try/catch)  → null
  else                                       → input
```

`null` is the canonical on-disk representation for "reports to main". This keeps stored team.json tidy and avoids the "display name drift" bug where renaming the main agent orphans every team that stored the old name.

Read path degrades too: in the GET / handler, `degradeUnknownReportsTo()` rewrites any `reportsTo` string that isn't in the current roster to `null` with a warning log. Read-side degradation is non-mutating — the stored file is never rewritten on read.

`OrgTeam.reportsTo` in `plugins/team/types.ts` is typed `string | null` to match.

## CLI Adapter Layer

`plugins/team/lib/openclaw-adapter.ts` wraps OpenClaw CLI commands for agent lifecycle operations. The shared `openclawExec(args)` helper resolves the binary via `settings.openclaw.binaryPath` and uses `execFileAsync`.

### Write operations (shell out to CLI)
- `addAgent(input)` → `openclaw agents add` + `openclaw agents set-identity`, writes IDENTITY.md/SOUL.md/TOOLS.md
- `removeAgent(agentId)` → `openclaw agents delete --force --json`
- `updateAgentIdentity(agentId, fields)` → `openclaw agents set-identity` for name/emoji, re-synthesizes IDENTITY.md

### Dispatch permission helpers (direct openclaw.json write)
- `setSubagentPermissions(agentId, allowAgents)` — replaces `subagents.allowAgents` on one agent
- `addToAllowLists(newAgentId, dispatchable)` — adds a new agent to relevant `allowAgents` lists (`"main"`, `"all"`, or specific agents)
- `removeFromAllowLists(agentId)` — removes an agent from all `allowAgents` lists (called on delete)

### IDENTITY.md
Structured identity fields are synthesized into `IDENTITY.md` via `synthesizeIdentityMd()`. Fields: Name, Role, Emoji, Vibe, Primary Function, Default Mode. Only non-empty fields are included. `parseIdentityMd()` reads them back for merge-on-update.

## REST Routes (Lifecycle)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/` | Create agent (accepts role, vibe, primaryFunction, defaultMode, tools, teamId, dispatchable) |
| DELETE | `/:agentId` | Delete agent + clean up dispatch permissions |
| PUT | `/:agentId/identity` | Update identity fields and/or SOUL.md/TOOLS.md |
| PUT | `/:agentId/permissions` | Update dispatch permissions (allowAgents) |

## MCP Exec Tools (Lifecycle)

| Tool | Purpose |
|------|---------|
| `bakin_exec_team_create_agent` | Full agent creation: OpenClaw registration, persona files, dispatch permissions, team assignment |
| `bakin_exec_team_update_identity` | Update identity fields and workspace files |
| `bakin_exec_team_delete_agent` | Delete agent with safety guard (confirm=true required) |
| `bakin_exec_team_set_permissions` | Update which agents a given agent can dispatch to |

The REST routes and MCP tools share the same adapter layer underneath. UI uses REST; agents use MCP tools.

## Client Store

`plugins/team/hooks/use-agent-store.ts` — single Zustand store loaded on app init. Exposes:

- `useAgent(id)`, `useAgentList()`, `useAgentIds()`, `useAgentColor(id)`
- `useMainAgentId()` — reads the `mainAgentId` field the roster route returns (server-side `getMainAgentId()`). Used by `TeamGrid` to pass the canonical root into `buildGraph`.
- `usePackageState(id)` — reads the per-agent agent-package row sourced from `/api/agent-packages` (see "Agent-Package Surfaces" below).

Components never compute "who is the main agent" themselves — always read it from the store.

## Agent-Package Surfaces (#158)

The Teams UI exposes three contextual agent-package surfaces. Cross-agent operations (install, browse, curated) are intentionally CLI-only in this iteration; a future Workshop page will bring those into the UI.

### Data Plumbing

`useAgentStore.load()` issues `/api/plugins/team/` and `/api/agent-packages` in parallel and merges the package response into a `packageStates: Record<agentId, PackageStateRow>` map. A failed `/api/agent-packages` is non-fatal — the agent grid keeps working with no badges. The store also exposes `refreshPackageStates()` for post-Adopt invalidation; consumers call it after a write so the UI updates without a page reload.

`PackageStateRow.state` is typed as the badge component's 6-state union (`absent | unmanaged | adopted | managed | drifted | update-available`) for forward-compat. The server today emits only the 4-state subset; `drifted` and `update-available` code paths are wired but unreachable until the API starts returning them.

### Surface 1 — Badge on AgentCardNode (`team-grid.tsx`)

The compact `<PackageStateBadge state={...} compact />` renders inline next to the agent name, but **only when state is "attention-worthy"**: `unmanaged`, `drifted`, or `update-available`. Healthy states (`managed`, `adopted`) and missing data leave the card visually unchanged. Convention: *no badge means OK.*

The compact pill is purely visual — no text label, tooltip + aria-label preserved. Click on the agent card opens the detail page where the full Package card lives.

### Surface 2 — Package Card on Profile Tab (`agent-detail.tsx`)

A read-only `<PackageCard>` sits at the top of the Profile tab and adapts content per state:

| State | Render |
|---|---|
| `managed` / `adopted` | Full state badge + dl-style fields: source, ref, commit (sliced to 7 chars), installed-at, dependencies. No CLI hint. |
| `unmanaged` (default when no row exists) | State badge + Adopt button → opens `<AdoptDialog>`. |
| `drifted` | State badge + CLI hint: `bakin install agent-assets` with copy button. |
| `update-available` | State badge + CLI hint: `bakin agents update <id>` with copy button. |

Convention: **CLI hints render only when there is no UI affordance for the action.** Adopt is wired in-UI, so `unmanaged` shows no hint. Update / Reinstall / Remove / Reset workspace are all CLI-only and show hints in their respective state branches.

### Surface 3 — Knowledge Tab (`agent-detail.tsx`)

The "Knowledge" tab sits between Skills and Memory in the tab order — both are package-rooted concepts. Always visible, content adapts:

- **`managed` / `adopted`:** renders `<KnowledgeToggleList agentId={...}>` (existing component, optimistic UI, REST round-trip on toggle).
- **Anything else:** "Coming soon" placeholder pointing the user back at the Package card on the Profile tab to adopt first. Future work replaces this with adoption-value + knowledge-explainer copy.

### Adopt Round-Trip

```
PackageCard (unmanaged) → click "Adopt"
  → <AdoptDialog open={true} agentId={agentId}>
    → user enters source → submit
      → POST /api/agent-packages/install { source, adopt: agentId }
        → onAdopted callback
          → refreshPackageStates() invalidates the store slice
            → PackageCard re-renders with the new state (managed/adopted)
              → Badge on AgentCardNode disappears (state no longer attention-worthy)
```

No page reload, no manual refetch from the consumer side.

### What's Deferred (future Workshop ticket)

- Curated browser (`<CuratedBrowser>` exists, unwired)
- Generic install dialog (`<InstallDialog>` exists, unwired) — for installing fresh agents and non-agent kinds
- Per-package detail drawer for skill-pack / workflow-pack / knowledge-pack
- Update / Reinstall / Remove / Reset workspace as UI buttons
- `.userEdited` lock surfacing
- Drift-count widget in Health plugin

These all stay CLI-only until the Workshop page lands.

## Test Coverage Map

| Concern | Test file |
|---------|-----------|
| mtime-cached reader + helpers | `tests/core/openclaw-config.test.ts` |
| main-agent canonical resolver | `tests/core/main-agent.test.ts` |
| Adapter validation + dedupe | `tests/plugins/team/openclaw-adapter.test.ts` |
| Pyramid graph builder | `tests/plugins/team/build-graph.test.ts` |
| Write normalization + read degradation + lifecycle routes | `tests/plugins/team/routes.test.ts` |
| Agent lifecycle MCP exec tools | `tests/plugins/team/exec-tools.test.ts` |
| Doctor integrity check | `tests/core/onboarding/openclaw.test.ts` |

## Common Pitfalls

- **Don't add settings.agents back.** The field was deleted for a reason — having two sources of truth caused the original "duplicate main-operator + main" bug on production.
- **Don't cache openclaw.json in a new spot.** `openclaw-config.ts` is the single reader. Add helpers there; don't re-stat from another module.
- **Don't write to openclaw.json for agent add/delete.** Use the CLI adapter (`openclawExec`). The only approved direct write is `setSubagentPermissions()` for dispatch permissions.
- **Don't write to openclaw.json from validation code.** Integrity problems are the user's job to fix — surface them via the doctor, don't auto-heal.
- **Don't hard-code the main agent's display name** (e.g. "Main Operator"). It varies per install. Always resolve via `getMainAgentName()` server-side or `useMainAgentId()` + `useAgent(id)` client-side.
- **Don't skip the test mocks.** `tests/plugins/team/*` must mock `@bakin/core/openclaw-config`, `@bakin/core/openclaw-home`, and `src/core/content-dir` — leaking into `~/.openclaw/` has caused real incidents.
