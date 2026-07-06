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

import { createAgentsSurface } from './agents'
import { seedMainAgentIfEmpty } from './main-agent'

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
    // No external process to bounce; session-pool disposal lands with P7.
  }

  getHealthChecks(): ReturnType<AgentRuntimeAdapter['getHealthChecks']> {
    return []
  }

  agents: AgentRuntimeAdapter['agents'] = createAgentsSurface()

  messaging: AgentRuntimeAdapter['messaging'] = {
    send: async () => notImplemented('messaging.send'),
    stream: () => notImplemented('messaging.stream'),
  }

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

  skills: AgentRuntimeAdapter['skills'] = {
    list: async () => notImplemented('skills.list'),
    get: async () => notImplemented('skills.get'),
    write: async () => notImplemented('skills.write'),
    remove: async () => notImplemented('skills.remove'),
  }

  sessions: AgentRuntimeAdapter['sessions'] = {
    list: async () => notImplemented('sessions.list'),
    get: async () => notImplemented('sessions.get'),
  }

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

  models: AgentRuntimeAdapter['models'] = {
    listAvailable: async () => notImplemented('models.listAvailable'),
  }

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

  config: AgentRuntimeAdapter['config'] = {
    get: async () => notImplemented('config.get'),
    replace: async () => notImplemented('config.replace'),
    raw: async () => notImplemented('config.raw'),
  }
}
