# Phase 6: Adapter Layer & Fresh Install

**Status:** Pending
**Dependencies:** All prior phases

## Purpose

Create an adapter interface between Bakin and external agentic systems so the app isn't hard-wired to OpenClaw. Also define the fresh install experience so a new user can get Bakin running from scratch.

## Deliverables

### 1. AgentBridge Interface

Abstract the agentic system behind an interface. Today it's OpenClaw; tomorrow it could be something else.

```typescript
// packages/core/src/agent-bridge.ts

interface AgentInfo {
  id: string
  name: string
  model?: string
  status: 'online' | 'offline' | 'working' | 'idle' | 'error'
}

interface AgentBridge {
  /** Send a message to an agent */
  sendMessage(agentId: string, message: string): Promise<void>

  /** Get current status of an agent */
  getAgentStatus(agentId: string): Promise<AgentInfo>

  /** List all available agents */
  listAgents(): Promise<AgentInfo[]>

  /** Start an agent session */
  startAgent(agentId: string): Promise<void>

  /** Invoke a skill on an agent */
  invokeSkill(agentId: string, skill: string, args: unknown): Promise<unknown>

  /** Deliver a task to an agent with context */
  deliverTask(agentId: string, taskId: string, context: TaskContext): Promise<void>

  /** Get the main/orchestrator agent ID */
  getMainAgentId(): string

  /** Check if the bridge is connected and healthy */
  healthCheck(): Promise<{ ok: boolean; message: string }>
}
```

### 2. OpenClawBridge Implementation

Refactor `src/core/openclaw-client.ts` into `OpenClawBridge implements AgentBridge`:

```typescript
class OpenClawBridge implements AgentBridge {
  private binaryPath: string
  private gatewayUrl: string
  private gatewayPort: number

  constructor(settings: BakinSettings['openclaw']) {
    this.binaryPath = settings.binaryPath
    this.gatewayUrl = settings.gatewayUrl
    this.gatewayPort = settings.gatewayPort
  }

  async sendMessage(agentId: string, message: string): Promise<void> {
    // Existing openclaw HTTP call
  }

  // ... implement all interface methods using existing openclaw-client logic
}
```

### 3. Bridge Selection

Settings determine which bridge to use:

```json
// ~/.bakin/settings.json
{
  "agentBridge": "openclaw",
  "mainAgentId": "main"
}
```

Bridge factory:
```typescript
function createAgentBridge(settings: BakinSettings): AgentBridge {
  switch (settings.agentBridge) {
    case 'openclaw': return new OpenClawBridge(settings.openclaw)
    // Future: case 'langchain': return new LangChainBridge(settings.langchain)
    default: throw new Error(`Unknown agent bridge: ${settings.agentBridge}`)
  }
}
```

The bridge is created once at startup and passed to:
- `src/core/dispatch.ts` (delivers tasks)
- `src/core/agents.ts` (agent status and communication)
- Any plugin that uses `/ask` or `/brainstorm` (projects, calendar)
- MCP server (for agent identity resolution)

### 4. Bridge on PluginContext

Plugins that need to communicate with agents use the bridge via context:

```typescript
interface PluginContext {
  // ... existing methods ...
  bridge: AgentBridge
}
```

This replaces all direct `import * as openclaw from '../../src/core/openclaw-client'` in plugins.

### 5. Fresh Install Experience

#### `bakin init` CLI command

Interactive setup flow:

```
$ bakin init

Welcome to Bakin!

Checking dependencies...
  ✓ Node.js v22.x
  ✓ pnpm 10.x
  ✗ Antfly — not found (optional, search features disabled)
  ✓ OpenClaw — found at /usr/local/bin/openclaw

Detecting agent bridge...
  Found OpenClaw config at ~/.openclaw/openclaw.json
  Main agent: main (display name "Roscoe" from identity.name)

Creating ~/.bakin/ directory structure...
  ✓ settings.json
  ✓ plugin-settings/
  ✓ plugins/
  ✓ agents/
  ✓ assets/ (7 type directories)
  ✓ projects/
  ✓ heartbeats/
  ✓ workflows/ (definitions, instances, skills)
  ✓ team/

Seeding defaults...
  ✓ Workflow definitions (3 files)
  ✓ Workflow skills (5 files)

Syncing agent files...
  ✓ Injected Bakin context blocks into 5 agent workspaces

Ready! Run `bakin start` to launch.
```

#### Dependency checker

```typescript
interface DependencyCheck {
  name: string
  required: boolean
  check: () => Promise<{ ok: boolean; version?: string; message?: string }>
}

const dependencies: DependencyCheck[] = [
  { name: 'Node.js', required: true, check: checkNodeVersion },     // >= 20
  { name: 'pnpm', required: true, check: checkPnpm },               // any
  { name: 'OpenClaw', required: true, check: checkOpenClaw },       // binary exists
  { name: 'Antfly', required: false, check: checkAntfly },          // optional
  { name: 'Claude CLI', required: false, check: checkClaudeCli },   // optional
]
```

#### First-run detection

On server start, check if `~/.bakin/settings.json` exists:
- If not: redirect all web requests to `/onboarding`
- If yes but `setupComplete: false`: same redirect
- If yes and `setupComplete: true`: normal operation

#### Onboarding wizard (web UI)

5-step wizard at `/onboarding`:

1. **System check** — run dependency checker, show results
2. **Agent bridge** — auto-detect OpenClaw, confirm settings, test connection
3. **Agent discovery** — list agents from bridge, confirm main agent, show profiles
4. **Plugin selection** — show core plugins (all enabled by default), explain each
5. **Test** — send a test message to main agent, verify round-trip, show activity feed

On completion: set `setupComplete: true` in settings, redirect to dashboard.

### 6. MCP Config Injection

`src/core/mcporter.ts` injects Bakin's MCP server config into agent workspace files. This becomes bridge-aware:

```typescript
interface AgentBridge {
  // ... existing methods ...

  /** Inject MCP config for Bakin's tools into agent workspace */
  injectMcpConfig?(agentId: string, mcpConfig: McpServerConfig): Promise<void>
}
```

OpenClawBridge implements this by writing to `~/.openclaw/workspaces/{agent}/mcp.json`. Other bridges may have different mechanisms (or none).

## Key Files to Modify/Create

| File | Action |
|------|--------|
| `packages/core/src/agent-bridge.ts` | New — interface definition |
| `packages/core/src/bridges/openclaw-bridge.ts` | New — refactored from openclaw-client.ts |
| `src/core/openclaw-client.ts` | Deprecate → re-export from bridge |
| `src/core/dispatch.ts` | Use bridge instead of openclaw-client |
| `src/core/agents.ts` | Use bridge instead of openclaw-client |
| `src/core/mcporter.ts` | Make bridge-aware |
| `plugins/projects/index.ts` | Use `ctx.bridge` instead of openclaw import |
| `plugins/calendar/index.ts` | Use `ctx.bridge` for brainstorm |
| `cli/bakin.ts` | Add `init` command |
| `src/app/onboarding/` | New — 5-step wizard pages |

## Verification

- [ ] `AgentBridge` interface covers all current openclaw-client functionality
- [ ] `OpenClawBridge` passes all existing tests
- [ ] Dispatch works through bridge (no direct openclaw imports)
- [ ] Plugins use `ctx.bridge` (no openclaw imports in plugin code)
- [ ] `bakin init` creates complete `~/.bakin/` structure from scratch
- [ ] Dependency checker correctly identifies installed/missing tools
- [ ] Onboarding wizard completes successfully
- [ ] `bakin doctor` reports healthy after fresh install
- [ ] Swapping bridge implementation doesn't require plugin changes
