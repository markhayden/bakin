import type { AgentRuntimeAdapter, ChatChunk, CronJob, CronRun, MessageArgs, RuntimeAgent, RuntimeSession, RuntimeToolActivity } from './concepts'
import { RuntimeError } from './errors'

/**
 * Opt-in channels surface for the mock (delivery capability pairs with it —
 * see createMockRuntimeAdapter). The DEFAULT mock omits `channels` entirely:
 * it is an optional contract member (Pi omits it in production), so plugin
 * code must feature-detect. A bare `runtime.channels.x()` against the default
 * mock now throws instead of silently passing (audit finding H2).
 *
 * Usage: `createMockRuntimeAdapter({ channels: mockChannels() })`
 */
export function mockChannels(): NonNullable<AgentRuntimeAdapter['channels']> {
  return {
    list: async () => [],
    sendNotification: async () => ({ deliveries: [] }),
    sendMessage: async () => ({ deliveries: [] }),
    deliverContent: async () => ({ deliveries: [] }),
    createApproval: async () => ({ deliveries: [] }),
    editApproval: async (args) => ({ deliveries: args.deliveries }),
    cancelApproval: async () => {},
    resolveApproval: async () => {},
    subscribeApprovalResponses: () => () => {},
  }
}

/**
 * Opt-in cron surface for the mock — same rationale as mockChannels():
 * `cron` is an optional contract member (Pi omits it), so the default mock
 * omits it and consumers feature-detect.
 *
 * Usage: `createMockRuntimeAdapter({ cron: mockCron() })`
 */
export function mockCron(): NonNullable<AgentRuntimeAdapter['cron']> {
  // Stateful (Map-backed) so the conformance CRUD round-trip pins real
  // behavior: created jobs are listable/gettable, updates persist, a missing
  // id is null on get and a typed not_found on update — same contract shape
  // the OpenClaw adapter has against its file store.
  const jobs = new Map<string, CronJob>()
  const runs = new Map<string, CronRun[]>()
  let seq = 0
  const cron: NonNullable<AgentRuntimeAdapter['cron']> = {
    list: async () => [...jobs.values()],
    get: async (id) => jobs.get(id) ?? null,
    create: async (input) => {
      const job: CronJob = {
        id: input.id ?? `cron-${++seq}`,
        name: input.name,
        schedule: input.schedule,
        command: input.command,
        enabled: input.enabled ?? true,
        toolsAllow: input.toolsAllow,
        metadata: input.metadata,
      }
      jobs.set(job.id, job)
      return job
    },
    update: async (id, patch) => {
      const existing = jobs.get(id)
      if (!existing) throw new RuntimeError(`cron job not found: ${id}`, { kind: 'not_found' })
      const job: CronJob = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
        ...(patch.command !== undefined ? { command: patch.command } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.toolsAllow !== undefined ? { toolsAllow: patch.toolsAllow === null ? undefined : patch.toolsAllow } : {}),
        ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      }
      jobs.set(id, job)
      return job
    },
    remove: async (id) => { jobs.delete(id) },
    runNow: async (jobId) => {
      const run: CronRun = {
        id: `run-${++seq}`,
        jobId,
        status: 'succeeded',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }
      runs.set(jobId, [...(runs.get(jobId) ?? []), run])
      return run
    },
    listRuns: async (jobId) => runs.get(jobId) ?? [],
    getRaw: async (id, reason) => {
      if (!reason) throw new Error('cron.getRaw requires a reason')
      return (await cron.get(id)) ?? null
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
      const job: CronJob = {
        id,
        name: raw.name ?? raw.id ?? id,
        schedule,
        command: raw.command ?? raw.payload?.message ?? raw.payload?.text ?? '',
        enabled: raw.enabled ?? true,
        toolsAllow: raw.toolsAllow,
        metadata: raw.metadata,
      }
      jobs.set(id, job)
      return job
    },
  }
  return cron
}

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
 * iterator itself never throws). `recordSession` mirrors send(): threaded
 * STREAM turns create sessions too, like real adapters (chat's
 * `chat:<id>` threads show up in sessions.list on OpenClaw/Pi — the mock
 * must not invert that).
 */
/** Echo suffix so tests can assert attachment pass-through end-to-end. */
function attachmentEcho(args: MessageArgs): string {
  if (!args.attachments?.length) return ''
  const names = args.attachments.map((a) => a.path.split('/').pop() ?? a.path).join(', ')
  return ` [attachments: ${names}]`
}

async function* mockChatStream(args: MessageArgs, recordSession: (args: MessageArgs) => void): AsyncIterable<ChatChunk> {
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
      recordSession(args)
      yield { type: 'text', content: `mock reply: ${args.content}${attachmentEcho(args)}` }
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
  // Per-agent in-memory workspace files — a REAL write→read round-trip so
  // the declared-'native' workspaceFiles capability is truthful (same
  // honesty standard as the send-backed sessions).
  const workspaceFiles = new Map<string, Map<string, { path: string; content: string }>>()

  /** Threaded turns create/refresh a session (shared by send and stream). */
  const recordSession = (args: MessageArgs): void => {
    if (!args.threadId) return
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
  // In-memory routing policy (P2.3) — mutated by setRoutingPolicy.
  const mockRoutingPolicy = {
    defaultModel: '',
    fallbackModels: [] as string[],
    defaultSubagentModel: null as string | null,
    aliases: {} as Record<string, string>,
  }

  // Serveability mirrors the contract: ready by construction, dead after
  // shutdown() — so ping() is a real signal, not a hardcoded true (T29).
  let alive = true

  const adapter: AgentRuntimeAdapter = {
    name: 'mock-runtime',
    version: '0.0.0',
    requiredCoreVersion: '*',
    initialize: async () => {
      alive = true
    },
    shutdown: async () => {
      alive = false
    },
    ping: async () => alive,
    restart: async () => {},

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
        // Mutating a missing agent is typed not_found (R28) — matching the
        // real adapters, and pinned by the conformance suite.
        const existing = agents.get(agentId)
        if (!existing) throw new RuntimeError(`mock: unknown agent: ${agentId}`, { kind: 'not_found' })
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
        if (!agents.has(agentId)) {
          throw new RuntimeError(`mock: unknown agent: ${agentId}`, { kind: 'not_found' })
        }
        agents.delete(agentId)
      },
      // Real in-memory round-trip (write → list/read → remove) — the
      // declared-'native' workspaceFiles capability must work, not stub.
      listWorkspaceFiles: async (agentId) => [...(workspaceFiles.get(agentId)?.keys() ?? [])],
      readWorkspaceFile: async (agentId, path) => {
        const file = workspaceFiles.get(agentId)?.get(path)
        return file ? { path: file.path, content: file.content } : null
      },
      writeWorkspaceFile: async (agentId, file) => {
        const files = workspaceFiles.get(agentId) ?? new Map<string, { path: string; content: string }>()
        files.set(file.path, { path: file.path, content: file.content ?? '' })
        workspaceFiles.set(agentId, files)
      },
      removeWorkspaceFile: async (agentId, path) => {
        workspaceFiles.get(agentId)?.delete(path)
      },
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
        // Threaded turns carry the session identity, per the contract the
        // conformance suite pins (stable per agent+thread, like real
        // adapters' deterministic session mapping) — and the session shows
        // up in sessions.list, because the mock declares sessions 'native'
        // and declared-native surfaces must actually work.
        recordSession(args)
        return {
          id: `msg-${Date.now()}`,
          content: `mock reply: ${args.content}${attachmentEcho(args)}`,
          ...(args.threadId ? { metadata: { sessionId: `mock-session-${args.agentId}-${args.threadId}` } } : {}),
        }
      },
      stream: (args) => mockChatStream(args, recordSession),
    },

    // NOTE: no `channels`, no `cron` — the minimal default (R24). Both are
    // OPTIONAL contract members (Pi omits them in production); consumers must
    // feature-detect. Opt in per test: mockChannels() / mockCron().

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
        supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'],
      }),
      routingPolicy: async () => ({ ...mockRoutingPolicy }),
      setRoutingPolicy: async (patch, _reason) => {
        Object.assign(mockRoutingPolicy, patch)
      },
    },

    // Honest for the minimal default shape (no channels ⇒ delivery
    // unavailable); the post-merge fixup below flips delivery to 'native'
    // when a test opts into channels. Conservative toolCalling default
    // matches production's no-app-services fallback (dispatch-prompts
    // DEFAULT_TOOL_ACCESS) so mock-driven prompts render the same
    // mcp-prefixed bytes; tests override per-case.
    capabilities: async (_opts?: { agentId?: string }) => mockCapabilities(false),

    describeToolAccess: () => ({ style: 'mcp' as const, mcpServerTemplate: 'bakin-<agent>', perTurnExecToolFiltering: true }),

    // Conservative default: no credentials configured; tests override.
    credentialStatus: async (_opts?: { agentId?: string }) => ({ llmProviders: [], channels: [] }),

    provisionToolAccess: async () => {},
    deprovisionToolAccess: async () => {},
    verifyToolAccess: async () => ({ style: 'mcp' as const, ok: true, issues: [] }),

  }

  const merged = { ...adapter, ...overrides }

  // Capability honesty across the merge (the conformance suite pins
  // native ⇒ surface-present in BOTH directions): opting into channels via
  // overrides flips delivery to 'native' automatically. Tests that override
  // `capabilities` themselves own their own honesty.
  if (!('capabilities' in overrides) && merged.channels) {
    merged.capabilities = async (_opts?: { agentId?: string }) => mockCapabilities(true)
  }

  return merged
}

/**
 * Opt-in image-input capability override for attachment tests:
 * `createMockRuntimeAdapter({ capabilities: mockImageInputCapabilities() })`.
 * The default mock declares `imageInput: false` (minimal shape); streams
 * still echo attachments in the reply text so pass-through is assertable
 * either way.
 */
export function mockImageInputCapabilities(): (opts?: { agentId?: string }) => Promise<ReturnType<typeof mockCapabilities>> {
  return async () => ({
    ...mockCapabilities(false),
    input: { imageInput: true, audioInput: false },
  })
}

function mockCapabilities(deliveryNative: boolean) {
  return {
    toolCalling: {
      mode: 'native' as const,
      access: { style: 'mcp' as const, mcpServerTemplate: 'bakin-<agent>', perTurnExecToolFiltering: true },
    },
    delivery: { mode: deliveryNative ? ('native' as const) : ('unavailable' as const) },
    imageGen: { mode: 'unavailable' as const },
    // 'native' is honest here: memory is a READ-ONLY surface and the mock
    // runtime genuinely has no tiers — empty reads report real (empty)
    // state, unlike a write→read surface where a no-op write would lie
    // (which is why workspaceFiles got a real in-memory round-trip). The
    // memory mode union has no 'shimmed'; widening the contract for a test
    // double would be the tail wagging the dog.
    memory: { mode: 'native' as const },
    sessions: { mode: 'native' as const },
    workspaceFiles: { mode: 'native' as const },
    input: { imageInput: false, audioInput: false },
  }
}
