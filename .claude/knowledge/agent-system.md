# Agent System — Deep Reference

## Overview

Beacon orchestrates a team of AI agents via the OpenClaw gateway. Each agent has a profile (identity, capabilities, tools), receives tasks through a dispatch engine, reports progress via MCP tools, and maintains a heartbeat for status tracking.

## Agent Profiles

### Single source of truth: `src/lib/agents-data.ts`

```typescript
interface AgentProfile {
  id: string           // 'roscoe', 'pixel', 'basil', etc.
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

**Note:** This is currently hardcoded. Phase 4 migrates to loadable YAML/JSON files in `~/.beacon/agents/` with the main agent ID resolved at runtime from settings.

### Lightweight agent list: `src/lib/constants.ts`
Derives `AGENTS: AgentMeta[]` from profiles for use in dropdowns/badges (id, emoji, name, role, headshot only).

## Agent Communication

### OpenClaw Gateway (`src/core/openclaw-client.ts`)
Agents run as OpenClaw agent instances. Communication flows:
1. Beacon → OpenClaw HTTP API → agent receives message/task
2. Agent → MCP tools (served by Beacon) → reads/writes state
3. Agent → `beacon_log_progress` → SSE broadcast to dashboard

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

Runs on an interval defined in `BeaconSettings.dispatch.intervalMs`.

## Heartbeat System

Each agent writes a heartbeat JSON file to `~/.beacon/heartbeats/{agentId}.json`:
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

Agents interact with Beacon through MCP tools served by `src/core/mcp-server.ts`:

### Core MCP tools (hardcoded in mcp-server.ts):
| Tool | Purpose |
|------|---------|
| `beacon_log_progress` | Log progress to activity feed |
| `beacon_move_task` | Move task between columns |
| `beacon_create_task` | Create a new task |
| `beacon_get_task` | Fetch task details |
| `beacon_block_task` | Mark task as blocked |
| `beacon_report_complete` | Mark task complete |
| `beacon_register_dependency` | Set task dependencies |
| `beacon_list_workflows` | List available workflow templates |
| `beacon_get_step` / `beacon_submit_step` | Workflow step execution |
| `beacon_get_paths` | Get content directory paths |

### Exec tools (from registry):
Registered by plugins and core scripts. Naming: `beacon_exec_{source}_{action}`.
Examples: `beacon_exec_save_asset`, `beacon_exec_project_list`, `beacon_exec_schedule_list`

### Agent identity
MCP sessions bind agent identity via `?agent=basil` query param at connection time. All tool calls carry the agent ID for audit attribution.

## Activity Logging

### Live activity feed
`beacon_log_progress` → `logProgress()` in `src/core/task-service.ts`:
1. Broadcasts immediately via SSE: `{ type: 'activity', agent, message, ts, taskId, channel }`
2. Appends to task's log in TASKBOARD.md

### Structured categories (from `scripts/lib/log-progress.ts`):
`[START]`, `[PROGRESS]`, `[MILESTONE]`, `[BLOCKED]`, `[COMPLETE]`
Optional stage tags: `[image-gen]`, `[copy-review]`, etc.

### Audit trail
`appendAudit()` in `src/core/audit.ts`:
1. Writes to `~/.beacon/audit.jsonl` (append-only)
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

Uses `globalThis.__beaconBroadcast` to survive Next.js webpack re-evaluation.

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
| `src/core/settings.ts` | BeaconSettings (agents list, dispatch config, etc.) |
| `scripts/lib/log-progress.ts` | Structured activity logging exec tool |
