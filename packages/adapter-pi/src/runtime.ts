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

import type { CapabilityMode, CapabilitySet, RuntimeCapabilities, RuntimeCredentialStatus, RuntimeToolAccess, ToolAccessProvisioningStatus } from '@bakin/core/adapters/runtime'

import { createAgentsSurface } from './agents'
import { listAuthProviders } from './config'
import { MAIN_AGENT_ID, seedMainAgentIfEmpty } from './main-agent'
import { createMemorySurface } from './memory'
import { createMessagingSurface } from './messaging'
import { capabilitiesForModel, createModelsSurface, resetModelRegistry } from './models'
import { readRegistry } from './registry'
import { createHealthChecks } from './health-checks'
import { createImagesSurface } from './images'
import { codexImageAuth } from './codex-images'
import { resolveProviderApiKeySource } from '@bakin/core/media'
import { createSessionsSurface } from './sessions'
import { createSkillsSurface } from './skills'
import { createToolsSurface } from './unsupported'

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
    this._images = null
  }

  /** Pi agents call Bakin exec tools natively (in-process tool bridge). */
  describeToolAccess = (): RuntimeToolAccess => ({ style: 'in-process' })

  /**
   * Presence-only credential report (P2.2): provider names from Pi's
   * auth.json (never secret material). Pi keys credentials per-install, not
   * per-agent, so `agentId` is irrelevant; no channel layer → no channels.
   */
  credentialStatus = async (_opts?: { agentId?: string }): Promise<RuntimeCredentialStatus> => ({
    llmProviders: listAuthProviders(),
    channels: [],
  })

  /**
   * No external wiring to provision — Pi's exec tools are injected per
   * session via the `execTools` provider passed to `initialize`.
   */
  provisionToolAccess = async (): Promise<void> => {}
  deprovisionToolAccess = async (): Promise<void> => {}
  verifyToolAccess = async (): Promise<ToolAccessProvisioningStatus> => ({
    style: 'in-process',
    ok: true,
    issues: [],
  })

  /** Full capability set; input modality is a conservative model probe. */
  capabilities = async (opts?: { agentId?: string }): Promise<CapabilitySet> => ({
    toolCalling: { mode: 'native', access: this.describeToolAccess() },
    // Pi has no channel layer (honest-empty until the in-app channel shim).
    delivery: { mode: 'unavailable' },
    imageGen: { mode: await this.imageGenMode() },
    memory: { mode: 'native' },
    sessions: { mode: 'native' },
    workspaceFiles: { mode: 'native' },
    input: await this.inputModality(opts?.agentId),
  })

  /**
   * Honest imageGen mode (P4.1): 'native' when the codex OAuth drives the
   * ChatGPT image path; 'shimmed' when only Bakin's direct-provider shim can
   * serve (a Bakin-owned openai/google key exists); 'unavailable' otherwise.
   * The images plugin gates on this descriptor instead of fusing readiness.
   */
  private imageGenMode = async (): Promise<CapabilityMode> => {
    try {
      if ((await codexImageAuth()) !== null) return 'native'
    } catch {
      // Unreadable auth is not fatal — fall through to the shim probe.
    }
    const shimKey = (['openai', 'google'] as const).some((provider) => resolveProviderApiKeySource(provider) !== null)
    return shimKey ? 'shimmed' : 'unavailable'
  }

  /** Conservative modality probe from the agent's effective Pi model. */
  private inputModality(agentId?: string): Promise<RuntimeCapabilities> {
    const agents = readRegistry().agents
    const requested = agentId?.trim()
    if (requested) {
      const record = agents.find((a) => a.id === requested)
      if (!record) return Promise.resolve({ imageInput: false, audioInput: false })
      return capabilitiesForModel(record.model)
    }
    const main = agents.find((a) => a.id === MAIN_AGENT_ID) ?? agents[0]
    return capabilitiesForModel(main?.model)
  }

  getHealthChecks(): ReturnType<AgentRuntimeAdapter['getHealthChecks']> {
    return createHealthChecks()
  }

  agents: AgentRuntimeAdapter['agents'] = createAgentsSurface()

  messaging: AgentRuntimeAdapter['messaging'] = createMessagingSurface({
    getExecTools: () => this.initOpts?.execTools,
    getLogger: () => this.initOpts?.logger,
    getSettings: () => this.initOpts?.settings ?? this.options.settings,
  })

  tools: AgentRuntimeAdapter['tools'] = createToolsSurface()

  /**
   * Codex-native image generation (primary) + direct-provider shim
   * (fallback). Built lazily so the carrier-model override from
   * settings.runtime.settings.images.carrierModel (init-time) is honored.
   */
  private _images: AgentRuntimeAdapter['images'] | null = null
  get images(): AgentRuntimeAdapter['images'] {
    if (!this._images) {
      const imagesSettings = (this.initOpts?.settings?.images ?? this.options.settings?.images) as
        | { carrierModel?: string }
        | undefined
      this._images = createImagesSurface({ carrierModel: imagesSettings?.carrierModel })
    }
    return this._images
  }

  // channels/cron are OMITTED (P2.1): Pi has no delivery layer and no
  // runtime-native cron. Absence — not a throwing stub — is the contract's
  // honest signal; consumers feature-detect and degrade.

  skills: AgentRuntimeAdapter['skills'] = createSkillsSurface()

  sessions: AgentRuntimeAdapter['sessions'] = createSessionsSurface()

  memory: AgentRuntimeAdapter['memory'] = createMemorySurface()

  models: AgentRuntimeAdapter['models'] = createModelsSurface()

}
