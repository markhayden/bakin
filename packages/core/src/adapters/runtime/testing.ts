import type { AgentRuntimeAdapter, RuntimeAgent } from './concepts'
import { RuntimeError } from './errors'

async function* emptyStream(): AsyncIterable<never> {
  const items: never[] = []
  for (const item of items) yield item
}

export function createMockRuntimeAdapter(
  overrides: Partial<AgentRuntimeAdapter> = {}
): AgentRuntimeAdapter {
  const agents = new Map<string, RuntimeAgent>()
  // In-memory routing policy (P2.3) — mutated by setRoutingPolicy.
  const mockRoutingPolicy = {
    defaultModel: '',
    fallbackModels: [] as string[],
    defaultSubagentModel: null as string | null,
    aliases: {} as Record<string, string>,
  }

  const adapter: AgentRuntimeAdapter = {
    name: 'mock-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
    initialize: async () => {},
    shutdown: async () => {},
    ping: async () => true,
    restart: async () => {},
    getHealthChecks: () => [],

    agents: {
      list: async () => Array.from(agents.values()),
      get: async (agentId) => agents.get(agentId) ?? null,
      create: async (input) => {
        const agent: RuntimeAgent = {
          id: input.id ?? `agent-${agents.size + 1}`,
          name: input.name,
          role: input.role,
          model: input.model,
          status: 'active',
          metadata: input.metadata,
        }
        agents.set(agent.id, agent)
        return agent
      },
      update: async (agentId, input) => {
        const existing = agents.get(agentId) ?? { id: agentId, name: agentId, status: 'unknown' as const }
        const next: RuntimeAgent = {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        }
        // null clears; string assigns (P2.3 clearing semantics).
        if (input.model !== undefined) {
          if (input.model === null) delete next.model
          else next.model = input.model
        }
        if (input.subagentModel !== undefined) {
          if (input.subagentModel === null) delete next.subagentModel
          else next.subagentModel = input.subagentModel
        }
        agents.set(agentId, next)
        return next
      },
      remove: async (agentId) => {
        agents.delete(agentId)
      },
      listWorkspaceFiles: async () => [],
      readWorkspaceFile: async () => null,
      writeWorkspaceFile: async () => {},
      removeWorkspaceFile: async () => {},
      updatePermissions: async () => {},
      updateAllowlist: async () => {},
    },

    messaging: {
      send: async (args) => {
        if (args.signal?.aborted) {
          throw new RuntimeError('mock send aborted', { kind: 'aborted' })
        }
        return { id: `msg-${Date.now()}` }
      },
      stream: () => emptyStream(),
    },

    tools: {
      invoke: async () => ({ ok: true }),
    },

    channels: {
      list: async () => [],
      sendNotification: async () => ({ deliveries: [] }),
      sendMessage: async () => ({ deliveries: [] }),
      deliverContent: async () => ({ deliveries: [] }),
      createApproval: async () => ({ deliveries: [] }),
      editApproval: async (args) => ({ deliveries: args.deliveries }),
      cancelApproval: async () => {},
      resolveApproval: async () => {},
      subscribeApprovalResponses: () => () => {},
    },

    skills: {
      list: async () => [],
      get: async () => null,
      write: async () => {},
      remove: async () => {},
    },

    sessions: {
      list: async () => [],
      get: async () => null,
    },

    memory: {
      listTiers: async () => [],
      listEntries: async () => [],
      getEntry: async () => null,
      statEntry: async () => null,
      readEntryRange: async () => null,
      resolvePath: async () => null,
      watchPaths: async () => [],
      search: async () => ({ results: [] }),
    },

    models: {
      listAvailable: async () => [],
      routingSupport: () => ({
        defaultModel: true,
        fallbackModels: true,
        defaultSubagentModel: true,
        aliases: true,
        perAgentSubagentModel: true,
      }),
      routingPolicy: async () => ({ ...mockRoutingPolicy }),
      setRoutingPolicy: async (patch, _reason) => {
        Object.assign(mockRoutingPolicy, patch)
      },
    },

    // Conservative default matching production's no-app-services fallback
    // (dispatch-prompts DEFAULT_TOOL_ACCESS) so mock-driven prompts render the
    // same mcp-prefixed bytes; tests override per-case ({...mock, ...}).
    capabilities: async (_opts?: { agentId?: string }) => ({
      toolCalling: {
        mode: 'native' as const,
        access: { style: 'mcp' as const, mcpServerTemplate: 'bakin-<agent>' },
      },
      delivery: { mode: 'native' as const },
      imageGen: { mode: 'unavailable' as const },
      memory: { mode: 'native' as const },
      sessions: { mode: 'native' as const },
      workspaceFiles: { mode: 'native' as const },
      input: { imageInput: false, audioInput: false },
    }),

    describeToolAccess: () => ({ style: 'mcp' as const, mcpServerTemplate: 'bakin-<agent>' }),

    // Conservative default: no credentials configured; tests override.
    credentialStatus: async (_opts?: { agentId?: string }) => ({ llmProviders: [], channels: [] }),

    provisionToolAccess: async () => {},
    deprovisionToolAccess: async () => {},
    verifyToolAccess: async () => ({ style: 'mcp' as const, ok: true, issues: [] }),

    cron: {
      list: async () => [],
      get: async () => null,
      create: async (input) => ({
        id: input.id ?? `cron-${Date.now()}`,
        name: input.name,
        schedule: input.schedule,
        command: input.command,
        enabled: input.enabled ?? true,
        toolsAllow: input.toolsAllow,
        metadata: input.metadata,
      }),
      update: async (id, patch) => ({
        id,
        name: patch.name ?? id,
        schedule: patch.schedule ?? '* * * * *',
        command: patch.command ?? '',
        enabled: patch.enabled ?? true,
        toolsAllow: patch.toolsAllow === null ? undefined : patch.toolsAllow,
        metadata: patch.metadata,
      }),
      remove: async () => {},
      runNow: async (jobId) => ({
        id: `run-${Date.now()}`,
        jobId,
        status: 'succeeded',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }),
      listRuns: async () => [],
      getRaw: async (id, reason) => {
        if (!reason) throw new Error('cron.getRaw requires a reason')
        return (await adapter.cron?.get(id)) ?? null
      },
      restoreRaw: async (id, snapshot, reason) => {
        if (!reason) throw new Error('cron.restoreRaw requires a reason')
        const raw = snapshot && typeof snapshot === 'object' ? snapshot as Partial<{
          id: string
          name: string
          schedule: string | { expr?: string; value?: string }
          command: string
          payload: { message?: string; text?: string }
          toolsAllow: string[]
          enabled: boolean
          metadata: Record<string, unknown>
        }> : {}
        const schedule = typeof raw.schedule === 'string'
          ? raw.schedule
          : raw.schedule?.expr ?? raw.schedule?.value ?? '* * * * *'
        return {
          id,
          name: raw.name ?? raw.id ?? id,
          schedule,
          command: raw.command ?? raw.payload?.message ?? raw.payload?.text ?? '',
          enabled: raw.enabled ?? true,
          toolsAllow: raw.toolsAllow,
          metadata: raw.metadata,
        }
      },
    },

    config: {
      get: async <T = Record<string, unknown>>() => ({}) as T,
      replace: async () => {},
      raw: async <T = unknown>() => undefined as T,
    },
  }

  return { ...adapter, ...overrides }
}
