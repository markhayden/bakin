/**
 * PiRuntimeAdapter — composition root.
 *
 * P1 stub: every surface throws until its module lands (P5–P11). The class
 * exists now so the factory wiring, settings enum, and boundary tests are
 * in place before any behavior.
 */
import type {
  AgentRuntimeAdapter,
  AdapterInitOpts,
} from '@bakin/core/adapters/runtime'

import type { RuntimeCapabilities, RuntimeToolAccessHint } from '@bakin/core/adapters/runtime'

import { createAgentsSurface } from './agents'
import { createConfigSurface } from './config'
import { MAIN_AGENT_ID, seedMainAgentIfEmpty } from './main-agent'
import { createMessagingSurface } from './messaging'
import { capabilitiesForModel, createModelsSurface, resetModelRegistry } from './models'
import { readRegistry } from './registry'
import { createSessionsSurface } from './sessions'
import { createSkillsSurface } from './skills'

export interface PiRuntimeAdapterOptions {
  settings?: Record<string, unknown>
}

function notImplemented(member: string): never {
  throw new Error(`adapter-pi: ${member} is not implemented yet (build in progress)`)
}

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly name = 'pi'
  readonly version = '0.1.0'
  readonly requiredCoreVersion = '>=1.0.0'

  private initOpts: AdapterInitOpts | null = null

  constructor(private readonly options: PiRuntimeAdapterOptions = {}) {}

  async initialize(opts: AdapterInitOpts): Promise<void> {
    this.initOpts = opts
    await seedMainAgentIfEmpty(opts.logger)
  }

  async shutdown(): Promise<void> {}

  /** In-process runtime: alive iff initialized (deep probes are health checks). */
  async ping(): Promise<boolean> {
    return this.initOpts !== null
  }

  async restart(): Promise<void> {
    // No external process to bounce: drop cached SDK state so the next call
    // re-reads auth/models from disk. Session-pool disposal lands with P7.
    resetModelRegistry()
  }

  /** Pi agents call Bakin exec tools natively (in-process tool bridge). */
  describeToolAccess = (): RuntimeToolAccessHint => ({ invocation: 'native' })

  /** Conservative modality probe from the agent's effective Pi model. */
  capabilities = async (opts?: { agentId?: string }): Promise<RuntimeCapabilities> => {
    const agents = readRegistry().agents
    const requested = opts?.agentId?.trim()
    if (requested) {
      const record = agents.find((a) => a.id === requested)
      if (!record) return { imageInput: false, audioInput: false }
      return capabilitiesForModel(record.model)
    }
    const main = agents.find((a) => a.id === MAIN_AGENT_ID) ?? agents[0]
    return capabilitiesForModel(main?.model)
  }

  getHealthChecks(): ReturnType<AgentRuntimeAdapter['getHealthChecks']> {
    return []
  }

  agents: AgentRuntimeAdapter['agents'] = createAgentsSurface()

  messaging: AgentRuntimeAdapter['messaging'] = createMessagingSurface({
    getExecTools: () => this.initOpts?.execTools,
    getLogger: () => this.initOpts?.logger,
    getSettings: () => this.initOpts?.settings ?? this.options.settings,
  })

  tools: AgentRuntimeAdapter['tools'] = {
    invoke: async () => notImplemented('tools.invoke'),
  }

  channels: AgentRuntimeAdapter['channels'] = {
    list: async () => notImplemented('channels.list'),
    sendNotification: async () => notImplemented('channels.sendNotification'),
    sendMessage: async () => notImplemented('channels.sendMessage'),
    deliverContent: async () => notImplemented('channels.deliverContent'),
    createApproval: async () => notImplemented('channels.createApproval'),
    editApproval: async () => notImplemented('channels.editApproval'),
    cancelApproval: async () => notImplemented('channels.cancelApproval'),
    resolveApproval: async () => notImplemented('channels.resolveApproval'),
    subscribeApprovalResponses: () => notImplemented('channels.subscribeApprovalResponses'),
  }

  skills: AgentRuntimeAdapter['skills'] = createSkillsSurface()

  sessions: AgentRuntimeAdapter['sessions'] = createSessionsSurface()

  memory: AgentRuntimeAdapter['memory'] = {
    listTiers: async () => notImplemented('memory.listTiers'),
    listEntries: async () => notImplemented('memory.listEntries'),
    getEntry: async () => notImplemented('memory.getEntry'),
    statEntry: async () => notImplemented('memory.statEntry'),
    readEntryRange: async () => notImplemented('memory.readEntryRange'),
    resolvePath: async () => notImplemented('memory.resolvePath'),
    watchPaths: async () => notImplemented('memory.watchPaths'),
    search: async () => notImplemented('memory.search'),
  }

  models: AgentRuntimeAdapter['models'] = createModelsSurface()

  cron: AgentRuntimeAdapter['cron'] = {
    list: async () => notImplemented('cron.list'),
    get: async () => notImplemented('cron.get'),
    create: async () => notImplemented('cron.create'),
    update: async () => notImplemented('cron.update'),
    remove: async () => notImplemented('cron.remove'),
    runNow: async () => notImplemented('cron.runNow'),
    listRuns: async () => notImplemented('cron.listRuns'),
    getRaw: async () => notImplemented('cron.getRaw'),
    restoreRaw: async () => notImplemented('cron.restoreRaw'),
  }

  config: AgentRuntimeAdapter['config'] = createConfigSurface()
}
