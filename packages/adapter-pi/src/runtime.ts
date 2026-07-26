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
import { listAuthCredentials } from './config'
import { MAIN_AGENT_ID, seedMainAgentIfEmpty } from './main-agent'
import { createMemorySurface } from './memory'
import { createMessagingSurface, enforcePiOffline } from './messaging'
import { capabilitiesForModel, createModelsSurface, resetModelRegistry } from './models'
import { readRegistry } from './registry'
import { createImagesSurface } from './images'
import { createExtensionsSurface } from './extensions'
import { codexImageAuth } from './codex-images'
import { resolveProviderApiKeySource } from '@bakin/core/media'
import { createSessionsSurface } from './sessions'
import { sessionContextStats } from './context-stats'
import { createSkillsSurface } from './skills'

export interface PiRuntimeAdapterOptions {
  settings?: Record<string, unknown>
}

export class PiRuntimeAdapter implements AgentRuntimeAdapter {
  readonly name = 'pi'
  readonly version = '0.1.0'
  readonly requiredCoreVersion = '>=1.0.0'

  private initOpts: AdapterInitOpts | null = null

  constructor(private readonly options: PiRuntimeAdapterOptions = {}) {}

  /**
   * Read-only by contract (conformance-pinned): stores opts, writes NOTHING.
   * Seeding the main agent is a provisioning concern — read-only consumers
   * (`bakin check`, the runtime-switch dry-run's secondary target) initialize
   * without ever mutating ~/.pi.
   */
  async initialize(opts: AdapterInitOpts): Promise<void> {
    this.initOpts = opts
    // A Bakin agent turn (and its provisioning) must NEVER install a Pi
    // package — the SDK resolver would run npm/git install side effects
    // (postinstall = arbitrary code) for any configured-but-missing package,
    // bypassing the extension allowlist entirely. Force the resolver offline
    // for the whole adapter lifecycle; installing packages is a deliberate
    // terminal act, never a side effect of serving a turn.
    enforcePiOffline()
  }

  async shutdown(): Promise<void> {}

  /**
   * Cheap can-serve-a-turn probe (contract semantics, T29): initialized AND
   * at least one LLM credential on disk. A turn without any provider
   * credential always fails, so credential presence is the cheapest honest
   * signal for an in-process runtime — the old `initOpts !== null` was
   * vacuously true after boot and made the health plugin's runtime check
   * meaningless on Pi. Resolves false, never throws (unreadable auth.json
   * reads as no credentials). Deeper probes are registered separately with
   * the canonical Health registry at application composition.
   */
  async ping(): Promise<boolean> {
    if (this.initOpts === null) return false
    try {
      return listAuthCredentials().length > 0
    } catch {
      return false
    }
  }

  /**
   * Re-read ALL durable config (contract semantics, T29). Pi's only cached
   * durable state is the model registry and the images surface (which holds
   * provider auth); settings.json and auth.json are read from disk on every
   * call, and turn sessions are built fresh per turn (resourceLoader.reload).
   * Session-pool disposal lands with P7.
   */
  async restart(): Promise<void> {
    resetModelRegistry()
    this._images = null
  }

  /** Pi agents call Bakin exec tools natively (in-process tool bridge, filtered per turn). */
  describeToolAccess = (): RuntimeToolAccess => ({ style: 'in-process', perTurnExecToolFiltering: true })

  /**
   * Presence-only credential report (P2.2): provider names from Pi's
   * auth.json (never secret material). Pi keys credentials per-install, not
   * per-agent, so `agentId` is irrelevant; no channel layer → no channels.
   */
  credentialStatus = async (_opts?: { agentId?: string }): Promise<RuntimeCredentialStatus> => {
    const llmCredentials = listAuthCredentials()
    return {
      llmProviders: llmCredentials.map((entry) => entry.provider),
      llmCredentials,
      channels: [],
    }
  }

  /**
   * No external wiring to provision — Pi's exec tools are injected per
   * session via the `execTools` provider passed to `initialize`. What
   * provisioning DOES own on Pi is first-boot seeding: every supported
   * mutating path (server boot, onboarding install, runtime switch) calls
   * provisionToolAccess, so an empty registry gains its main orchestrator
   * here — never during read-only initialize. Idempotent: seeds only when
   * the registry is empty.
   */
  provisionToolAccess = async (): Promise<void> => {
    await seedMainAgentIfEmpty(this.initOpts?.logger)
  }
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
    // Honored in openTurnSession: runWorkspace moves ONLY the session's
    // tool-execution cwd; loader/settings/sessions stay workspace-pinned.
    // Conformance-pinned by the isolation probe (pi.conformance.test.ts).
    concurrency: { sameAgentTurns: 'isolated' },
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

  /**
   * Adapter-private settings, LIVE when the host provides the getter
   * (getLiveSettings — settings edits apply next turn, no restart), else the
   * boot snapshot / factory options (tests, thin callers).
   */
  private settingsNow(): Record<string, unknown> | undefined {
    return this.initOpts?.getLiveSettings?.() ?? this.initOpts?.settings ?? this.options.settings
  }

  agents: AgentRuntimeAdapter['agents'] = createAgentsSurface()

  messaging: AgentRuntimeAdapter['messaging'] = createMessagingSurface({
    getExecTools: () => this.initOpts?.execTools,
    getLogger: () => this.initOpts?.logger,
    getToolActivity: () => this.initOpts?.onToolActivity,
    getTurnActivity: () => this.initOpts?.onTurnActivity,
    // Live: extension policy + retry knobs apply on the NEXT TURN.
    getSettings: () => this.settingsNow(),
  })


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

  /**
   * Extension trust surface (WS4): inert discovery of what the resource
   * loader would load, statused by the SAME policy the loader applies.
   */
  get extensions(): AgentRuntimeAdapter['extensions'] {
    return createExtensionsSurface(() => this.settingsNow())
  }

  // channels/cron are OMITTED (P2.1): Pi has no delivery layer and no
  // runtime-native cron. Absence — not a throwing stub — is the contract's
  // honest signal; consumers feature-detect and degrade.

  skills: AgentRuntimeAdapter['skills'] = createSkillsSurface()

  // contextStats joins the surface HERE (not in sessions.ts) — the
  // context-stats module imports messaging's settings manager, and a
  // sessions.ts import would close a cycle (CI check:cycles).
  sessions: AgentRuntimeAdapter['sessions'] = {
    ...createSessionsSurface(),
    contextStats: sessionContextStats,
  }

  memory: AgentRuntimeAdapter['memory'] = createMemorySurface()

  models: AgentRuntimeAdapter['models'] = createModelsSurface()

}
