# Team Plugin — Deep Reference

## Purpose

The team plugin is Bakin's UI and route layer over the active runtime adapter's
agent roster. It derives the entire team page — every agent card, every edge,
the full pyramid — from `ctx.runtime.agents`, decorated with Bakin-owned UI
data (avatars, display overrides, teams, and heartbeat status). Bakin **never**
copies provider agent state into its own store; identity, rules, tools, soul,
skills, sessions, and workspace files stay behind the runtime adapter.

## Client Entry

`plugins/team/client.tsx` calls `registerPlugin({ id: 'team', navItems, slots: { 'page:/team': TeamGrid, 'page:/team/[id]': AgentDetail } })`. The shell mounts those components at `/team` and `/team/:id` respectively via TanStack Router route modules (`packages/host/src/routes/team.index.tsx` and `team.$id.tsx`), each rendering `<Slot name="page:/team..." />`.

## Canonical Main Agent Contract

The orchestrator id is resolved through the runtime adapter. With the current
OpenClaw runtime implementation it is the literal string `"main"`, but plugin
code treats that as adapter-owned knowledge. Display names come from the runtime
agent profile. No settings override or Bakin-side roster copy exists.

- `getRuntimeMainAgentId(ctx.runtime)` — canonical server-side resolver.
- `ctx.runtime.agents.list()` / `.get(id)` — roster and profile source.
- `packages/adapter-openclaw/src/main-agent.ts` and `config.ts` — current
  provider implementation details, imported only by the adapter package.
- `src/core/onboarding/runtime.ts` — doctor check that flags missing `main`, duplicate ids, duplicate workspaces. Reports only, never auto-fixes. Run via `bakin check runtime`.

`BakinSettings.agents` and `BakinSettings.mainAgentId` **do not exist**. If you find a reference to them in tests or production code, it's a bug — use `getAgentIds()` / `getMainAgentId()` instead.

## Read Path: runtime adapter → listAgents

`plugins/team/index.ts` builds the full roster from `ctx.runtime.agents.list()`
and helper functions that take an `AgentRuntimeAdapter`. The read path:

1. Reads runtime agents through `ctx.runtime.agents`.
2. Maps provider profiles into `AgentMeta`/`AgentWithStatus`.
3. Resolves the main agent through `getRuntimeMainAgentId(ctx.runtime)`.
4. Merges Bakin-owned display data (`~/.bakin/plugin-settings/team.json` →
   accent colors, display name overrides, team assignments).
5. Merges Bakin-owned heartbeat status from `~/.bakin/heartbeats/{id}.json`
   plus recent audit activity.
6. Returns `AgentWithStatus[]`.

Provider config parsing, duplicate detection, workspace resolution, and any
provider-specific cache invalidation happen inside the runtime adapter. The team
plugin must not read provider files or shell out to provider CLIs.

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

If `listAgents()` returned `[]` (missing `main`), the builder renders founder only. No orphan subagents, no synthesized sections. This is the intentional signal that runtime state is broken — the UI stays quiet and points the user at `bakin check runtime`.

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

## Runtime Agent Mutations

All lifecycle writes go through `ctx.runtime.agents` / `AgentRuntimeAdapter`.
The current OpenClaw adapter may shell out or edit provider config internally,
but that is adapter-private.

### Write operations
- `runtime.agents.create(input)` creates the runtime agent.
- `runtime.agents.remove(agentId)` removes the runtime agent.
- `runtime.agents.update(agentId, fields)` updates identity/model fields.
- `runtime.agents.writeWorkspaceFile(agentId, file)` writes SOUL/TOOLS/etc.

### Dispatch permission helpers
- `runtime.agents.updateAllowlist(agentId, { replace })` replaces an agent's
  dispatch allowlist.
- `addToRuntimeAllowlists(newAgentId, dispatchable)` adds a new agent to
  relevant allowlists (`"main"`, `"all"`, or specific agents).
- `removeFromRuntimeAllowlists(agentId)` removes an agent from all allowlists
  during delete.

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
| `bakin_exec_team_create_agent` | Full agent creation: runtime registration, persona files, dispatch permissions, team assignment |
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

### Surface 2 — Package Card on Overview Tab (`agent-detail.tsx`)

A read-only `<PackageCard>` is embedded inside the Overview tab (post-rework) and adapts content per state:

| State | Render |
|---|---|
| `managed` / `adopted` | Full state badge + dl-style fields: source, ref, commit (sliced to 7 chars), installed-at, dependencies. No CLI hint. |
| `unmanaged` (default when no row exists) | State badge + Adopt button → opens `<AdoptDialog>`. |
| `drifted` | State badge + CLI hint: `bakin install agent-assets` with copy button. |
| `update-available` | State badge + CLI hint: `bakin agents update <id>` with copy button. |

Convention: **CLI hints render only when there is no UI affordance for the action.** Adopt is wired in-UI, so `unmanaged` shows no hint. Update / Reinstall / Remove / Reset workspace are all CLI-only and show hints in their respective state branches.

### Surface 3 — Knowledge Tab (`agent-detail.tsx`)

The "Knowledge" tab sits between Skills and Active Context in the tab order. Always visible, content adapts:

- **`managed` / `adopted`:** renders `<KnowledgeToggleList agentId={...}>` — a responsive grid of cards with title + lessonId + tags + per-card package-source chip. Optimistic UI, REST round-trip on toggle.
- **Anything else:** shared `<EmptyState>` with "Knowledge requires a package" pointing the user back at the Package card on the Overview tab to adopt first.

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

## Agent Detail Tab Architecture

The `/team/:id` page (`agent-detail.tsx`) is a thin orchestrator: header + tab bar + dispatch. All meaningful content lives in per-tab components, each in its own file. Tab order:

| Tab | Component | Source |
|---|---|---|
| Overview | `<OverviewTab>` | `overview-tab.tsx` |
| Identity | `<MarkdownEditTab>` | workspace `IDENTITY.md` |
| Soul | `<MarkdownEditTab>` | workspace `SOUL.md` |
| Memory | `<MemoryTab>` (in `agent-detail.tsx`) | `ctx.runtime.memory` workspace-memory tier |
| Heartbeat | `<HeartbeatTab>` | `heartbeat-tab.tsx` (view-only) |
| Rules | `<MarkdownEditTab>` | workspace `AGENTS.md` |
| Tools | `<MarkdownEditTab>` | workspace `TOOLS.md` |
| Skills | `<SkillsTab>` (in `agent-detail.tsx`) | workspace `skills/<name>/SKILL.md` |
| Knowledge | `<KnowledgeToggleList>` | `/api/agent-packages/:id/knowledge` |
| Active Context | `<ActiveContextTab>` | latest transcript via `ctx.runtime.memory` |

URL state via `useQueryState('tab', 'overview')`. Unknown values fall back to `overview`.

### Header Contract

The header contains: back arrow, avatar (clickable for upload), name, role, gateway-restart banner (when dirty), delete button (suppressed on the main agent). It used to host the model picker, team selector, and subagent perms badge — all moved to OverviewTab so the header stays informational.

### OverviewTab Composition

Identity (name + role + workspace path) lives in the page header above the tab bar — OverviewTab itself does **not** repeat it.

Page sections, top to bottom:

- **Hero card** — accent-bordered, 2-col at lg (stacked at narrower). Two panels separated by a subtle divider:
  - Settings (no header label) — model selector + team selector with live save
  - Agent Package — embedded `<PackageCardBody>` (lives in `package-card.tsx`)
- **Metrics** — 4 color-coded tiles (Skills/violet, Knowledge/cyan, Tokens/blue, Cost/emerald). When a latest-session payload is present, a secondary 4-tile row appears (Model / Messages / Cache reads / Cache writes).
- **Activity** — 3 tiles tinted with the agent's accent color when count > 0, for 5m/1h/24h windows. Footer caption clarifies "since server start" (the recorder is in-memory and resets on restart).

OverviewTab fetches stats / recent-activity / skills / knowledge in parallel on mount. Each panel handles its own loading/empty state.

### MarkdownEditTab Pattern

Used by Soul / Rules / Tools — Assets-style view→edit toggle. Default state renders `<MarkdownContent>`. Pencil button in the absolute top-right corner switches to a textarea. Save (green check) + Cancel (X) replace the pencil while editing. Cmd+S saves when dirty; Esc cancels. Save POSTs to the existing `/api/plugins/team/:agentId/files/:filename` endpoint.

Layout uses `min-h-[calc(100vh-260px)]` so the markdown surface fills the viewport less header — replaces the prior FileEditorTab's cramped 500px container.

### Heartbeat: View-Only

`HeartbeatTab` renders `HEARTBEAT.md` via `<MarkdownContent>` with a "Last updated <relative>" badge. Explicitly no edit affordance — heartbeats are agent-authored narrative; user editing is meaningless.

There are *two* heartbeat surfaces in the codebase that should not be confused:

- `~/.bakin/heartbeats/<id>.json` — structured status JSON written by the `bakin_exec_heartbeat` MCP tool. Used by the watchdog and online-status detection. Not surfaced in the UI.
- `<workspace>/HEARTBEAT.md` — markdown narrative the agent maintains for human consumption. This is what the Heartbeat tab shows.

### Active Context: Latest Session Transcript

`ActiveContextTab` fetches `/api/plugins/team/:id/active-context` and renders the parsed message stream from the agent's most recent session JSONL. One row per message with a role-colored badge (system/user/assistant/tool). Plain text via `<MarkdownContent>`; tool calls and JSON-shaped content as `<pre>`. Truncation banner appears when the underlying transcript was capped (default 200 messages on the server).

Backed by `lib/session-reader.ts` — a sibling to `src/core/agent-usage.ts`. Where agent-usage sums tokens/cost across the latest session, session-reader returns the messages themselves.

### New REST Endpoints (introduced in the Overview rework)

Three GET routes on the team plugin, sibling to the existing `/:agentId/stats`:

| Route | Returns |
|---|---|
| `/:agentId/heartbeat` | `{ ok, heartbeat: { content, lastUpdated } \| null }` |
| `/:agentId/active-context?max=200` | `{ ok, transcript: SessionTranscript \| null }` |
| `/:agentId/recent-activity` | `{ ok, activity: { windowMs, errors, sinceServerStart } }` |

All three follow the existing per-agent route pattern (agentId from search params, structured ok/error response, log + 500 on errors).

### What Got Killed

- **Stats tab** — folded into the OverviewTab "Latest Session" panel.
- **Profile tab** — replaced by OverviewTab. Old behavior was to re-render Soul / Rules / Tools / Heartbeat content alongside the Identity card; that was redundant since each has its own tab.
- **FileEditorTab** — replaced by MarkdownEditTab.

If a future iteration restores any of these, prefer adding back via new components rather than git-reverting — the new components have better tests + layout discipline.

## Test Coverage Map

| Concern | Test file |
|---------|-----------|
| Runtime main-agent resolver | `tests/core/runtime-main-agent.test.ts`, `tests/core/main-agent.test.ts` |
| Adapter-private OpenClaw config/home helpers | `tests/core/openclaw-config.test.ts`, `tests/core/openclaw-home.test.ts` |
| Pyramid graph builder | `tests/plugins/team/build-graph.test.ts` |
| Write normalization + read degradation + lifecycle routes | `tests/plugins/team/routes.test.ts` |
| Agent lifecycle MCP exec tools | `tests/plugins/team/exec-tools.test.ts` |
| Doctor integrity check | `tests/core/onboarding/runtime.test.ts` |
| Owned health checks (agent-roster / personas / agent-assets) | `tests/plugins/team/health-checks.test.ts` |

## Owned health checks

Team registers three checks via `ctx.registerHealthCheck` in `activate()`:

- **`agent-roster`** — diff Bakin's agent ids against the active runtime adapter roster. Not auto-fixable (requires human judgment about which side is "right").
- **`personas`** — verify each agent has a `team/personas/{agent}.md` file. Repairable through the explicit doctor repair workflow, which stubs missing files.
- **`agent-assets`** — wraps `agentAssetsComponent.check()` from `src/core/onboarding/agent-assets.ts` to surface drift in projected agent-package files. Repairable through explicit doctor repair flows, which run the same install flow as `bakin install agent-assets`.

All three live at `plugins/team/lib/health-checks.ts`. Migrated out of `src/core/doctor.ts` in #139 C1. Deep reference: `.claude/knowledge/doctor-and-health-checks.md`.

## Common Pitfalls

- **Don't add settings.agents back.** The field was deleted for a reason — having two sources of truth caused the original "duplicate main-operator + main" bug on production.
- **Don't cache runtime config in a new spot.** Use typed runtime adapter surfaces first; any unavoidable raw read must go through `src/core/runtime-config-raw.ts`.
- **Don't write provider config for agent add/delete.** Use the runtime adapter. Provider-specific mutation belongs in `packages/adapter-openclaw/`.
- **Don't write provider config from validation code.** Integrity problems are the user's job to fix — surface them via the doctor, don't auto-heal.
- **Don't hard-code the main agent's display name** (e.g. "Main Operator"). It varies per install. Always resolve via `getMainAgentName()` server-side or `useMainAgentId()` + `useAgent(id)` client-side.
- **Don't skip the test mocks.** `tests/plugins/team/*` must mock runtime adapters and content-dir paths; adapter-private tests that touch OpenClaw home also mock `@bakin/adapter-openclaw/home` — leaking into `~/.openclaw/` has caused real incidents.
