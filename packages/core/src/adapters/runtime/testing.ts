import type { AgentRuntimeAdapter, ChatChunk, MessageArgs, RuntimeAgent, RuntimeSession, RuntimeToolActivity } from './concepts'
import { RuntimeError } from './errors'

const mockAbortError = () => new RuntimeError('mock send aborted', { kind: 'aborted' })

/**
 * Content markers the mock honors so tests can exercise contract behavior
 * real adapters have (pinned by the runtime conformance suite):
 *  - `[[tool]]`  → the turn "uses a tool": structured tool call/result chunks
 *    on the stream, and tool+status chunks to a send() onActivity tap.
 *  - `[[fail]]`  → terminal failure: the STREAM ends with a typed `error`
 *    chunk (no `done`, iterator never throws); a SEND rejects with a typed
 *    RuntimeError. Mirrors provider/gateway failures on real runtimes.
 */
const TOOL_MARKER = '[[tool]]'
const FAIL_MARKER = '[[fail]]'

const mockFailureError = () =>
  new RuntimeError('mock provider failure ([[fail]] marker)', { kind: 'runtime_failed' })

function mockToolActivity(phase: 'call' | 'result'): RuntimeToolActivity {
  return {
    phase,
    callId: 'mock-call-1',
    toolName: 'mock_tool',
    status: phase === 'call' ? 'running' : 'completed',
    ...(phase === 'result' ? { outputPreview: 'mock tool output' } : { inputPreview: 'mock tool input' }),
  }
}

/** Contained tap invocation — a throwing onActivity callback never fails the turn. */
function tap(args: MessageArgs, chunk: ChatChunk): void {
  try {
    args.onActivity?.(chunk)
  } catch {
    // contract: adapters contain tap exceptions
  }
}

/**
 * One macrotask yield so a caller holding MessageArgs.signal can abort
 * mid-turn (the contract behavior real adapters have; pinned by the runtime
 * conformance suite). A synchronous `controller.abort()` issued after send()
 * starts rejects; without a signal the send resolves on the next tick.
 */
function mockTurnDelay(signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 0)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(mockAbortError())
      },
      { once: true },
    )
  })
}

/**
 * Contract-conformant mock stream (R5): status → [tool call/result] → text →
 * exactly-one trailing done; a caller abort ends the stream with a clean done
 * (never an error chunk — deliberate aborts settle clean); a `[[fail]]`
 * marker ends the stream with a typed `error` chunk and NO done (the
 * iterator itself never throws).
 */
async function* mockChatStream(args: MessageArgs): AsyncIterable<ChatChunk> {
  if (!args.signal?.aborted) {
    yield { type: 'status', content: 'thinking' }
    try {
      await mockTurnDelay(args.signal)
      if (args.content.includes(FAIL_MARKER)) {
        yield { type: 'error', content: 'mock provider failure', data: { kind: 'runtime_failed' } }
        return
      }
      if (args.content.includes(TOOL_MARKER)) {
        yield { type: 'tool', data: mockToolActivity('call') }
        yield { type: 'tool', data: mockToolActivity('result') }
      }
      yield { type: 'text', content: `mock reply: ${args.content}` }
    } catch {
      // aborted mid-turn — fall through to the clean done
    }
  }
  yield { type: 'done' }
}

export function createMockRuntimeAdapter(
  overrides: Partial<AgentRuntimeAdapter> = {}
): AgentRuntimeAdapter {
  const agents = new Map<string, RuntimeAgent>()
  const sessions = new Map<string, RuntimeSession>()
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
        if (args.signal?.aborted) throw mockAbortError()
        // Best-effort live-activity tap (MessageArgs.onActivity): tool +
        // status chunks only, exceptions contained — same v1 semantics the
        // real adapters implement (T8/D-plan-1).
        tap(args, { type: 'status', content: 'thinking' })
        if (args.content.includes(TOOL_MARKER)) {
          tap(args, { type: 'tool', data: mockToolActivity('call') })
          tap(args, { type: 'tool', data: mockToolActivity('result') })
        }
        await mockTurnDelay(args.signal)
        if (args.content.includes(FAIL_MARKER)) throw mockFailureError()
        // Threaded sends carry the session identity, per the contract the
        // conformance suite pins (stable per agent+thread, like real
        // adapters' deterministic session mapping) — and the session shows
        // up in sessions.list, because the mock declares sessions 'native'
        // and declared-native surfaces must actually work.
        if (args.threadId) {
          const sessionId = `mock-session-${args.agentId}-${args.threadId}`
          const now = new Date().toISOString()
          const existing = sessions.get(sessionId)
          sessions.set(sessionId, {
            id: sessionId,
            agentId: args.agentId,
            startedAt: existing?.startedAt ?? now,
            updatedAt: now,
          })
        }
        return {
          id: `msg-${Date.now()}`,
          content: `mock reply: ${args.content}`,
          ...(args.threadId ? { metadata: { sessionId: `mock-session-${args.agentId}-${args.threadId}` } } : {}),
        }
      },
      stream: (args) => mockChatStream(args),
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
      // Backed by threaded sends: the mock declares sessions 'native', so
      // list/get return the sessions real turns created (capability-honesty
      // pin — a declared-native surface must work, not stub).
      list: async (agentId?: string) =>
        Array.from(sessions.values()).filter((s) => !agentId || s.agentId === agentId),
      get: async (sessionId: string) => sessions.get(sessionId) ?? null,
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

  }

  return { ...adapter, ...overrides }
}
