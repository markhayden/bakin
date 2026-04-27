import type { AgentRuntimeAdapter, RuntimeAgent, TaskExecutionStatus } from './concepts'

async function* emptyStream(): AsyncIterable<never> {
  const items: never[] = []
  for (const item of items) yield item
}

export function createMockRuntimeAdapter(
  overrides: Partial<AgentRuntimeAdapter> = {}
): AgentRuntimeAdapter {
  const agents = new Map<string, RuntimeAgent>()
  const executions = new Map<string, TaskExecutionStatus>()

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
        const next = { ...existing, ...input }
        agents.set(agentId, next)
        return next
      },
      remove: async (agentId) => {
        agents.delete(agentId)
      },
      readWorkspaceFile: async () => null,
      writeWorkspaceFile: async () => {},
      updatePermissions: async () => {},
      updateAllowlist: async () => {},
      heartbeat: async () => true,
    },

    messaging: {
      send: async () => ({ id: `msg-${Date.now()}` }),
      stream: () => emptyStream(),
    },

    tools: {
      invoke: async () => ({ ok: true }),
      list: async () => [],
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
      onMessage: () => () => {},
      onInteraction: () => () => {},
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
    },

    tasks: {
      dispatch: async (args) => {
        const flowId = `flow-${args.bakinTaskId}`
        executions.set(flowId, {
          flowId,
          bakinTaskId: args.bakinTaskId,
          state: 'queued',
          retryCount: 0,
          updatedAt: new Date().toISOString(),
        })
        return { flowId }
      },
      getExecutionStatus: async (flowId) => executions.get(flowId) ?? { flowId, state: 'unknown' },
      listExecutions: async () => Array.from(executions.values()),
      cancelExecution: async (flowId) => {
        const existing = executions.get(flowId)
        if (existing) executions.set(flowId, { ...existing, state: 'cancelled', endedAt: new Date().toISOString() })
      },
      subscribeExecutionUpdates: () => () => {},
    },

    cron: {
      list: async () => [],
      get: async () => null,
      create: async (input) => ({
        id: input.id ?? `cron-${Date.now()}`,
        name: input.name,
        schedule: input.schedule,
        command: input.command,
        enabled: input.enabled ?? true,
        metadata: input.metadata,
      }),
      update: async (id, patch) => ({
        id,
        name: patch.name ?? id,
        schedule: patch.schedule ?? '* * * * *',
        command: patch.command ?? '',
        enabled: patch.enabled ?? true,
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
    },

    config: {
      get: async <T = Record<string, unknown>>() => ({}) as T,
      update: async () => {},
      raw: async <T = unknown>() => undefined as T,
    },
  }

  return { ...adapter, ...overrides }
}
