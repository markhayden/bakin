# Agent System — Deep Reference

## Overview

Bakin orchestrates a team of AI agents through the active runtime adapter. Each agent has a profile (identity, capabilities, tools), receives tasks through a dispatch engine, reports progress via MCP tools, and maintains a heartbeat for status tracking.

## Agent Profiles

### Source of truth: runtime adapter via Team Plugin

Agent data is runtime-owned and is accessed through `ctx.runtime` inside the team plugin. With the OpenClaw adapter, that data lives in the OpenClaw home directory. **Bakin reads provider state through the runtime adapter. Bakin writes provider state through the runtime adapter. Bakin never copies provider-owned agent state into core/plugin storage.**

OpenClaw path handling is adapter-private. The current adapter resolves paths via `getOpenClawHome()` / `getOpenClawPath()` from `packages/adapter-openclaw/src/home.ts`. This respects the `OPENCLAW_HOME` env var (defaults to `~/.openclaw/`), enabling dev/test environments via the Imitation Crab mock (`dev/imitation-crab/`).

- `{OPENCLAW_HOME}/openclaw.json` — agent roster (IDs, names, models, identity, subagent perms)
- `{OPENCLAW_HOME}/workspace/` — main agent workspace files in the current adapter layout
- `{OPENCLAW_HOME}/workspaces/{id}/` — subagent workspace files (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, etc.)

```typescript
// Lightweight (dropdowns, badges) — from plugins/team/types.ts
interface AgentMeta { id: string; name: string; emoji: string; role: string; headshot: string }

// Full profile (detail pages) — merged from runtime profile + workspace files
interface AgentProfile extends AgentMeta {
  model: string; workspacePath: string;
  soul: string | null; identity: string | null; rules: string | null;
  tools: string | null; heartbeatMd: string | null; subagentPerms: string[] | null
}
```

### Client store: `plugins/team/hooks/use-agent-store.ts`
Single Zustand store loaded on app init. All components use `useAgent(id)`, `useAgentList()`, `useAgentIds()`, `useAgentColor(id)` from this store.

### Bakin-owned display data (not in provider state)
- Display settings (accent colors, display name overrides, team assignments) — `~/.bakin/plugin-settings/team.json`
- Avatars — `~/.bakin/agents/{id}/avatar.jpg`
- Heartbeats — `~/.bakin/heartbeats/{id}.json`

### Organizational teams
Teams are a Bakin concept for grouping agents (e.g. "Builders", "Creators"). Stored in `~/.bakin/plugin-settings/team.json` alongside display settings. Each team has a `reportsTo` agent, creating the org chart hierarchy. Agents are assigned to teams via display settings (`teamId` field).

### Model management
Agent models are changed via the models plugin API, not direct provider writes:
- **Agent detail page** (`/team/:id`): `ModelSelect` dropdown in the header saves via `POST /api/plugins/models/config` with `{ agentId, ownModel }`
- **Agent creation** (`agent-form.tsx`): fetches dynamic model list from `GET /api/plugins/models/available`, which is derived from `ctx.runtime.models.listAvailable({ includeUnavailable: true })` filtered to `available === true`
- **Models page** (`/models`): manages `agents.defaults.model.primary`, `agents.defaults.model.fallbacks`, per-agent `model.primary`, and default/per-agent subagent model settings
- The models plugin writes via `ctx.runtime.config.replace()` and fires the `models.configChanged` hook when agent effective model changes

### Agent IDs
Bakin uses runtime canonical agent ids verbatim — no translation layer. With the current OpenClaw runtime adapter, the orchestrator id is the literal string `"main"` on **every** install; there is no detection heuristic, no settings override, no fallback. Subagents keep whatever ids the runtime assigns. Display names come from the runtime profile at render time and never leak into storage keys.

Runtime helpers in `@bakin/core/adapters/runtime`:
- `getRuntimeMainAgentId(runtime): Promise<string>` — returns `"main"` if the entry exists, throws otherwise (with a pointer to `bakin check runtime`)
- `getRuntimeMainAgent(runtime): Promise<RuntimeAgent>` — returns the canonical runtime agent
- `getRuntimeMainAgentName(runtime): Promise<string>` — reads the runtime agent name, falling back to `"Main"`

Callers get these values from `getAppServices().runtime.agents` or `ctx.runtime.agents`, not from raw provider config. With OpenClaw, the adapter reads `openclaw.json` through `packages/adapter-openclaw/src/config.ts`; live edits are picked up by the adapter cache on the next read. Callers that need the raw roster use runtime adapter methods — **never** `BakinSettings.agents` (that field no longer exists).

### Roster validation and dedupe
The OpenClaw runtime adapter validates the roster on every read:
- If no entry has `id: "main"`, `listAgents()` returns `[]` and logs an error. The UI then renders an empty team rather than a partial/broken pyramid.
- Duplicate ids → first-wins, error logged with the discarded entry.
- Duplicate **resolved** workspaces (explicit `workspace` field, falling back to `defaults.workspace`) → first-wins, error logged.

The adapter is **read-only** — it never writes back to runtime config to "fix" violations. Repairs are the user's job; `bakin check runtime` reports the exact violations (see `src/core/onboarding/runtime.ts`).

## Dispatch Permissions

Each agent's runtime allowlist controls which other agents it can dispatch tasks to. Managed via `ctx.runtime.agents.updateAllowlist()`:

- **On create:** `addToRuntimeAllowlists(newId, dispatchable)` — `"main"` (default) adds to main only; `"all"` adds to every agent with an existing list; `string[]` adds to specific agents plus always main.
- **On delete:** `removeFromRuntimeAllowlists(agentId)` — removes from all agents' lists.
- **Direct edit:** `runtime.agents.updateAllowlist(agentId, { replace: allowAgents })` — full replacement of one agent's list.

Self-referencing (agent dispatching to itself) is rejected at both the MCP tool and REST route level.

## Agent Communication

### Runtime Messaging (`AppServices.runtime`)
Agents run behind the active runtime adapter. Communication flows:
1. Bakin → runtime adapter messaging API → agent receives message/task
2. Agent → MCP tools (served by Bakin) → reads/writes state
3. Agent → `bakin_log_progress` → SSE broadcast to dashboard

### Key functions in `src/core/agents.ts`:
- `getAgentStatus(agentId)` — reads heartbeat + task board to determine status
- `sendMessageToAgent(agentId, message)` — delegates to the active runtime adapter

## Dispatch Engine (`src/core/dispatch.ts`)

The dispatch system assigns tasks to agents:
1. Reads the Bakin task store via `src/core/task-store.ts`
2. Checks runtime roster/availability, heartbeat, current task count, and dispatch cooldown
3. Sends task to the assigned agent through `getAppServices().runtime.messaging`
4. Moves task to `inProgress` column
5. Monitors for completion/blocking

Runs on an interval defined in `BakinSettings.dispatch.intervalMs`.

## Heartbeat & Status System

### Heartbeat files
Each agent writes a heartbeat JSON file to `~/.bakin/heartbeats/{agentId}.json` via the `bakin_exec_heartbeat` MCP tool:
```json
{
  "agent": "chef",
  "timestamp": "2026-03-28T10:30:00Z",
  "status": "working",
  "currentTask": "task-abc123"
}
```

Status values: `working`, `idle`

### Dual-signal status resolution
The team plugin resolves agent status from two sources:
1. **Heartbeat file** — primary signal, written by `bakin_exec_heartbeat`
2. **Audit log** — fallback signal, reads tail of `audit.jsonl` for recent agent events

Whichever source has the more recent timestamp wins. This means agents show as online even if they forget to write heartbeats, as long as they're generating audit events (task moves, tool calls, etc.).

### Status color logic (UI):
- **Green** (success): working, last activity < threshold
- **Yellow** (warning): idle / online but not working
- **Gray** (muted): no heartbeat and no audit activity, or stale (> threshold)
- **Red** (destructive): error status

Threshold is configurable via team plugin settings (`staleThresholdMinutes`, default 15).

## MCP Tool Access

Agents interact with Bakin through MCP tools served by `src/core/mcp-server.ts`:

### Dynamic tool registration (all tools from exec registry):
`mcp-server.ts` has NO hardcoded tools. All tools come from `getAllExecTools()` in the exec tool registry.

| Source | Count | Registration method | Examples |
|--------|-------|---------------------|----------|
| tasks plugin | 11 | `ctx.registerExecTool()` | `bakin_exec_tasks_list`, `bakin_exec_tasks_create`, `bakin_exec_tasks_move` |
| workflows plugin | 10 | `ctx.registerExecTool()` | `bakin_exec_workflows_list_definitions`, `bakin_exec_workflows_get_step` |
| assets plugin | 9 | `ctx.registerExecTool()` | `bakin_exec_assets_save`, `bakin_exec_assets_list` |
| schedule plugin | 10 | `ctx.registerExecTool()` | `bakin_exec_schedule_list`, `bakin_exec_schedule_fire` |
| official messaging plugin | 15 | `ctx.registerExecTool()` | `bakin_exec_messaging_list`, `bakin_exec_messaging_create`, `bakin_exec_messaging_session_list` |
| official projects plugin | 15 | `ctx.registerExecTool()` | `bakin_exec_project_list`, `bakin_exec_project_create` |
| team plugin | 12 | `ctx.registerExecTool()` | `bakin_exec_team_list`, `bakin_exec_team_org`, `bakin_exec_team_create_agent`, `bakin_exec_team_delete_agent`, `bakin_exec_team_update_identity`, `bakin_exec_team_set_permissions` |
| scripts/lib/log-progress.ts | 1 | `addExecTool()` | `bakin_exec_log` |
| scripts/lib/generate-image.ts | 1 | `addExecTool()` | `bakin_exec_gen_image` (Gemini generation or raw file import via `filePath` param) |
| scripts/lib/post-channel.ts | 1 | `addExecTool()` | `bakin_exec_post_channel` |
| scripts/lib/get-paths.ts | 1 | `addExecTool()` | `bakin_exec_get_paths` |
| scripts/lib/heartbeat.ts | 1 | `addExecTool()` | `bakin_exec_heartbeat` |

**Total:** 79 exec tools (74 plugin + 5 script). Naming: `bakin_exec_{pluginId}_{action}`.

### Agent identity
MCP sessions bind agent identity via `?agent=chef` query param at connection time. All tool calls carry the agent ID for audit attribution.

### MCP tool policy

`src/core/mcp-tool-policy.ts` resolves the effective tool policy when a Bakin
MCP session is created:

- Unmanaged runtime agents have legacy unrestricted access.
- Managed agent-package agents must have a non-empty
  `agent.allowedTools` policy in their installed `bakin-package.json`; missing
  or malformed package policy fails closed.
- Adopted package agents with an explicit `allowedTools` policy are scoped by
  that policy. Adopted agents without a policy remain unrestricted until
  configured.
- Patterns are tool-name based and support exact names plus `*` wildcards, e.g.
  `bakin_exec_assets_*`.

The MCP server still registers every exec tool internally, but disallowed tools
are disabled so they do not appear in `tools/list`. Direct calls to a hidden
but registered tool return an audited denial (`exec.<tool>.denied`) instead of
running the handler.

This is distinct from workflow `deny_tools`, which is step prompt guidance, and
from OpenClaw cron `toolsAllow`, which belongs to native isolated runtime cron
jobs.

## Activity Logging

### Live activity feed
`bakin_log_progress` → `logProgress()` in `src/core/task-service.ts`:
1. Broadcasts immediately via SSE: `{ type: 'activity', agent, message, ts, taskId, channel }`
2. Appends to the task log through the tasks plugin hook backed by `~/.bakin/tasks`

### Structured categories (from `scripts/lib/log-progress.ts`):
`[START]`, `[PROGRESS]`, `[MILESTONE]`, `[BLOCKED]`, `[COMPLETE]`
Optional stage tags: `[image-gen]`, `[copy-review]`, etc.

### Audit trail
`appendAudit()` in `src/core/audit.ts`:
1. Writes to `~/.bakin/audit.jsonl` (append-only)
2. Broadcasts via SSE: `{ type: 'audit', entry }`
3. Indexes to Antfly (fire-and-forget)

Audit event format:
```typescript
{
  ts: string,
  event: string,      // 'task.moved', 'exec.save_asset.ok', 'workflow.step_complete'
  agent: string,
  data: Record<string, unknown>,
  channel?: 'mcp' | 'rest' | 'cli' | 'system'
}
```

## SSE Broadcasting (`src/core/sse.ts`)

Uses `globalThis.__bakinBroadcast` so every reach into this module shares one SSE client set.

Two broadcast functions:
- `broadcast(data)` — sends to SSE clients + replay buffer
- `broadcastAuditEvent(entry)` — sends `{ type: 'audit', entry }`

Reconnecting clients get missed events via `Last-Event-ID` header.

## Watchdog (`src/core/watchdog.ts`)

Monitors agent and MCP server health:
- Checks heartbeat freshness on interval
- Detects stuck agents (working but no progress > threshold)
- Auto-recovery: restart agent or move task back to todo. Suppressed when the task's `updatedAt` is within a 60 s guard window to avoid racing dispatch's move (`AUTO_RECOVERY_GUARD_MS` in `watchdog.ts`, issue #114)
- Detects MCP 5xx outages via a rolling error-rate check on `/mcp` (configurable window/threshold/min-samples/cooldown in `settings.watchdog.mcp*`) — fires SSE alert, audit entry, and optional runtime channel notification
- Alert delivery via `settings.notifications.channel` (runtime channel ID; blank means in-app only) — configurable in the **System & Alerts** settings tab
- Re-reads settings every cycle, so channel/threshold changes apply without a restart

## Restart Recovery (`src/core/restart-recovery.ts`)

Runs once after server boot, after plugins are active and the HTTP server is
listening, before the normal dispatch/watchdog loops start. It repairs
`inProgress` tasks whose active agent heartbeat is missing/stale after a crash
or restart:

- Plain tasks use the card assignee heartbeat.
- Workflow tasks use `workflows.getActiveAgents` so the current workflow step
  owner is authoritative.
- Workflow gates waiting on approval are skipped.
- Partial parallel heartbeat loss and workflow states with no active agents
  are surfaced through the health plugin's `restart-recovery` doctor check
  instead of being mutated automatically.
- Recovered tasks move back to `todo` through `src/core/task-store.ts`; Bakin
  starts the normal loops and immediately triggers a dispatch cycle so the
  normal dispatcher reassigns them.
- The retry cap is shared with watchdog recovery via
  `settings.watchdog.maxAutoRecoveries`; exhausted tasks move to `blocked`.

## Key Files

| File | Purpose |
|------|---------|
| `src/core/app-services.ts` | Boot-created runtime/search/task service object |
| `packages/adapter-openclaw/src/config.ts` | OpenClaw adapter-private mtime-cached reader for `openclaw.json` |
| `packages/adapter-openclaw/src/main-agent.ts` | Adapter-private canonical `"main"` resolver |
| `plugins/team/index.ts` | Team plugin server: routes, hooks, exec tools. Uses `ctx.runtime.agents` for roster/workspace reads and writes |
| `plugins/team/lib/build-graph.ts` | Pure pyramid-graph builder — root derived from `mainAgentId`, `reportsTo ?? mainAgentId` resolution, unknown-id fallback |
| `plugins/team/hooks/use-agent-store.ts` | Client-side Zustand store for agent data |
| `src/core/agents.ts` | Agent status resolution and communication |
| `src/core/dispatch.ts` | Task dispatch engine. Roster from `getAppServices().runtime.agents` |
| `src/core/restart-recovery.ts` | One-shot boot repair for orphaned `inProgress` tasks |
| `src/core/mcp-server.ts` | MCP tool server |
| `packages/adapter-openclaw/src/runtime.ts` | OpenClaw runtime adapter implementation |
| `src/core/task-service.ts` | Task mutations with side effects |
| `src/core/audit.ts` | Audit logging |
| `src/core/sse.ts` | SSE client management |
| `src/core/watchdog.ts` | Agent health monitoring |
| `src/core/onboarding/runtime.ts` | Doctor check — validates missing `main`, duplicate ids, duplicate workspaces. Reports only, never auto-fixes |
| `src/core/settings.ts` | BakinSettings (dispatch/watchdog/antfly/etc. config). **Does not** contain the agent roster |
| `scripts/lib/log-progress.ts` | Structured activity logging exec tool |
