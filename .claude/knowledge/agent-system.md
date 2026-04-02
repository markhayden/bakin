# Agent System — Deep Reference

## Overview

Bakin orchestrates a team of AI agents via the OpenClaw gateway. Each agent has a profile (identity, capabilities, tools), receives tasks through a dispatch engine, reports progress via MCP tools, and maintains a heartbeat for status tracking.

## Agent Profiles

### Single source of truth: `src/lib/agents-data.ts`

```typescript
interface AgentProfile {
  id: string           // 'main-operator', 'pixel', 'chef', etc.
  emoji: string        // fallback display
  name: string         // display name
  fullName?: string
  role: string         // 'Orchestrator · Lead Agent'
  title: string
  subtitle: string
  headshot: string     // '/headshots/{id}.webp'
  model: string        // 'claude-sonnet-4-6'
  definition: string   // role description paragraph
  shouldDo: string[]   // instructions
  shouldNotDo: string[]// constraints
  examples: string[]   // use case examples
  tools: string[]      // available tool names
}
```

Exported as `AGENT_PROFILES` (array) and `AGENT_MAP` (Record by ID).

**Note:** This is currently hardcoded. Phase 4 migrates to loadable YAML/JSON files in `~/.bakin/agents/` with the main agent ID resolved at runtime from settings.

### Lightweight agent list: `src/lib/constants.ts`
Derives `AGENTS: AgentMeta[]` from profiles for use in dropdowns/badges (id, emoji, name, role, headshot only).

## Agent Communication

### OpenClaw Gateway (`src/core/openclaw-client.ts`)
Agents run as OpenClaw agent instances. Communication flows:
1. Bakin → OpenClaw HTTP API → agent receives message/task
2. Agent → MCP tools (served by Bakin) → reads/writes state
3. Agent → `bakin_log_progress` → SSE broadcast to dashboard

### Key functions in `src/core/agents.ts`:
- `getAgentStatus(agentId)` — reads heartbeat + taskboard to determine status
- `sendMessageToAgent(agentId, message)` — delegates to OpenClaw HTTP client
- `startAgent(agentId)` — start agent session
- `deliverTaskToAgent(agentId, taskId)` — deliver task with context

## Dispatch Engine (`src/core/dispatch.ts`)

The dispatch system assigns tasks to agents:
1. Reads TASKBOARD.md for tasks in `todo` column with an `@agent` assignment
2. Checks agent availability (heartbeat, current task count, cooldown)
3. Sends task to agent via OpenClaw with context (task details, workflow step if applicable)
4. Moves task to `inProgress` column
5. Monitors for completion/blocking

Runs on an interval defined in `BakinSettings.dispatch.intervalMs`.

## Heartbeat System

Each agent writes a heartbeat JSON file to `~/.bakin/heartbeats/{agentId}.json`:
```json
{
  "timestamp": "2026-03-28T10:30:00Z",
  "status": "working",
  "currentTask": "task-abc123"
}
```

Status values: `working`, `idle`, `error`

### Status color logic (UI):
- **Green** (success): working, last activity < 15 min
- **Yellow** (warning): idle
- **Gray** (muted): no heartbeat or stale (> 15 min)
- **Red** (destructive): error status

## MCP Tool Access

Agents interact with Bakin through MCP tools served by `src/core/mcp-server.ts`:

### Dynamic tool registration (all tools from exec registry):
`mcp-server.ts` has NO hardcoded tools. All tools come from `getAllExecTools()` in the exec tool registry.

| Source | Count | Registration method | Examples |
|--------|-------|---------------------|----------|
| tasks plugin | 11 | `ctx.registerExecTool()` | `bakin_exec_tasks_list`, `bakin_exec_tasks_create`, `bakin_exec_tasks_move` |
| workflows plugin | 10 | `ctx.registerExecTool()` | `bakin_exec_workflows_list_definitions`, `bakin_exec_workflows_get_step` |
| assets plugin | 8 | `ctx.registerExecTool()` | `bakin_exec_assets_save`, `bakin_exec_assets_list` |
| schedule plugin | 10 | `ctx.registerExecTool()` | `bakin_exec_schedule_list`, `bakin_exec_schedule_fire` |
| calendar plugin | 7 | `ctx.registerExecTool()` | `bakin_exec_calendar_list`, `bakin_exec_calendar_create` |
| projects plugin | 15 | `ctx.registerExecTool()` | `bakin_exec_projects_list`, `bakin_exec_projects_create` |
| scripts/lib/log-progress.ts | 1 | `addExecTool()` | `bakin_exec_log` |
| scripts/lib/gen-image.ts | 1 | `addExecTool()` | `bakin_exec_gen_image` |
| scripts/lib/post-discord.ts | 1 | `addExecTool()` | `bakin_exec_post_discord` |
| scripts/lib/get-paths.ts | 1 | `addExecTool()` | `bakin_exec_get_paths` |

**Total:** 62 exec tools (58 plugin + 4 script). Naming: `bakin_exec_{pluginId}_{action}`.

### Agent identity
MCP sessions bind agent identity via `?agent=chef` query param at connection time. All tool calls carry the agent ID for audit attribution.

## Activity Logging

### Live activity feed
`bakin_log_progress` → `logProgress()` in `src/core/task-service.ts`:
1. Broadcasts immediately via SSE: `{ type: 'activity', agent, message, ts, taskId, channel }`
2. Appends to task's log in TASKBOARD.md

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

Uses `globalThis.__bakinBroadcast` to survive Next.js webpack re-evaluation.

Two broadcast functions:
- `broadcast(data)` — sends to SSE clients + replay buffer
- `broadcastAuditEvent(entry)` — sends `{ type: 'audit', entry }`

Reconnecting clients get missed events via `Last-Event-ID` header.

## Watchdog (`src/core/watchdog.ts`)

Monitors agent health:
- Checks heartbeat freshness on interval
- Detects stuck agents (working but no progress > threshold)
- Auto-recovery: restart agent or move task back to todo
- Alert via notifications channel (Discord)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/agents-data.ts` | Agent profiles (single source of truth) |
| `src/lib/constants.ts` | Lightweight agent list for UI |
| `src/core/agents.ts` | Agent status resolution and communication |
| `src/core/dispatch.ts` | Task dispatch engine |
| `src/core/mcp-server.ts` | MCP tool server |
| `src/core/openclaw-client.ts` | OpenClaw HTTP gateway client |
| `src/core/task-service.ts` | Task mutations with side effects |
| `src/core/audit.ts` | Audit logging |
| `src/core/sse.ts` | SSE client management |
| `src/core/watchdog.ts` | Agent health monitoring |
| `src/core/settings.ts` | BakinSettings (agents list, dispatch config, etc.) |
| `scripts/lib/log-progress.ts` | Structured activity logging exec tool |
