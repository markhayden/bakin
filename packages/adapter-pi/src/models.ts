/**
 * models.* + capabilities() over Pi's ModelRegistry.
 *
 * The registry is constructed against EXPLICIT paths under getPiHome()
 * (auth.json, models.json) — never Pi's own env/default resolution, so
 * tests and PI_HOME overrides behave. Model ids cross the boundary as
 * `provider/modelId` (matching Bakin's models-plugin convention).
 */
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent'

import type { AgentRuntimeAdapter, RuntimeAvailableModel, RuntimeCapabilities, RuntimeRoutingPolicy, RuntimeRoutingSupport } from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'
import { readRoutingDefaultModel, writeRoutingDefaultModel } from './config'
import { toRuntimeError } from './errors'
import { getPiPath } from './home'

/** Probe hard ceiling — a probe is a verdict, never a hang. */
const PROBE_TIMEOUT_MS = 20_000

interface PiModelHandle {
  registry: ModelRegistry
  runtime: ModelRuntime
}

let handlePromise: Promise<PiModelHandle> | null = null
let resolvedHandle: PiModelHandle | null = null

export function getModelRegistry(): Promise<PiModelHandle> {
  if (!handlePromise) {
    // 0.85.x: ModelRuntime is the canonical async model/auth facade;
    // ModelRegistry survives as its synchronous read facade. Paths stay
    // EXPLICIT under getPiHome() (never Pi's env/default resolution).
    // modelsStorePath wires in Pi's dynamically refreshed catalog
    // (models-store.json) so retired/added provider models reach Bakin
    // without an SDK re-pin. allowModelNetwork stays default-false: no
    // network at create (initialize() is write-free by conformance pin).
    handlePromise = ModelRuntime.create({
      authPath: getPiPath('agent', 'auth.json'),
      modelsPath: getPiPath('agent', 'models.json'),
      modelsStorePath: getPiPath('agent', 'models-store.json'),
    }).then((runtime) => {
      resolvedHandle = { runtime, registry: new ModelRegistry(runtime) }
      return resolvedHandle
    })
  }
  return handlePromise
}

/**
 * Synchronous snapshot access for sync read paths (findPiModel /
 * context-stats). Null until the first getModelRegistry() resolves;
 * callers already treat an unresolvable model conservatively.
 */
function getResolvedHandle(): PiModelHandle | null {
  if (!handlePromise) void getModelRegistry().catch(() => { /* surfaced on the awaited path */ })
  return resolvedHandle
}

/** Reset cached registry (tests / restart()). */
export function resetModelRegistry(): void {
  handlePromise = null
  resolvedHandle = null
}

export function qualifiedModelId(provider: string, id: string): string {
  return `${provider}/${id}`
}

/** Find a Pi model by `provider/modelId` (or bare modelId as fallback).
 *  Sync snapshot read — undefined until the runtime handle has resolved
 *  (turn paths await getModelRegistry() first, so they always see it). */
export function findPiModel(modelRef: string | undefined) {
  if (!modelRef) return undefined
  const handle = getResolvedHandle()
  if (!handle) return undefined
  const { registry } = handle
  const slash = modelRef.indexOf('/')
  if (slash > 0) {
    const found = registry.find(modelRef.slice(0, slash), modelRef.slice(slash + 1))
    if (found) return found
  }
  return registry.getAll().find((m) => m.id === modelRef)
}

export function createModelsSurface(): AgentRuntimeAdapter['models'] {
  return {
    async listAvailable(opts?: { includeUnavailable?: boolean }): Promise<RuntimeAvailableModel[]> {
      const { registry } = await getModelRegistry()
      // 0.85.x: refresh() is async (models.json/models-store reload) — await
      // it or the synchronous reads below race the reload.
      await registry.refresh()
      const models = opts?.includeUnavailable ? registry.getAll() : registry.getAvailable()
      return models.map((m) => ({
        id: qualifiedModelId(String(m.provider), m.id),
        name: m.name,
        input: m.input.join(','),
        contextWindow: m.contextWindow,
        local: false,
        available: registry.hasConfiguredAuth(m),
        tags: m.reasoning ? ['reasoning'] : [],
        metadata: { maxTokens: m.maxTokens, api: String(m.api) },
      }))
    },

    /**
     * Account-callability probe (#852): a minimal direct completion via
     * ModelRuntime.completeSimple — no agent session, no workspace, no
     * history. The SDK resolves provider failures into the message
     * (stopReason 'error' + errorMessage) instead of throwing, so both
     * shapes funnel through toRuntimeError for the typed verdict.
     */
    async probe(modelId: string, opts?: { signal?: AbortSignal }): Promise<void> {
      const { runtime } = await getModelRegistry()
      const model = findPiModel(modelId)
      if (!model) {
        throw new RuntimeError(`adapter-pi: model '${modelId}' is not in the runtime catalog — nothing to probe`, {
          kind: 'runtime_failed',
        })
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      const onCallerAbort = () => controller.abort()
      opts?.signal?.addEventListener('abort', onCallerAbort, { once: true })
      try {
        const message = await runtime.completeSimple(
          model,
          { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] },
          { signal: controller.signal, maxTokens: 8 },
        )
        if (message.stopReason === 'error' || message.stopReason === 'aborted') {
          throw toRuntimeError(
            new Error(message.errorMessage ?? `probe ${message.stopReason} without detail`),
            { model: modelId, aborted: message.stopReason === 'aborted' },
          )
        }
      } catch (err) {
        throw toRuntimeError(err, { model: modelId, aborted: opts?.signal?.aborted })
      } finally {
        clearTimeout(timer)
        opts?.signal?.removeEventListener('abort', onCallerAbort)
      }
    },

    // Routing policy (P2.3): Pi honors defaultModel only (session build falls
    // back to it when an agent has no assignment). Fallbacks / aliases /
    // subagent models have no Pi semantics — declared unsupported, and a
    // patch carrying one is REJECTED, never silently stored.
    routingSupport: (): RuntimeRoutingSupport => ({
      defaultModel: true,
      fallbackModels: false,
      defaultSubagentModel: false,
      aliases: false,
      perAgentSubagentModel: false,
      // Pi sessions honor a bounded thinking ladder; 'adaptive'/'max' have
      // no Pi semantics — Bakin clamps before the send (never silent).
      supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      // In-process runtime: per-turn model refs are always honored (#880).
      perTurnModel: true,
    }),

    async routingPolicy(): Promise<RuntimeRoutingPolicy> {
      return {
        defaultModel: readRoutingDefaultModel(),
        fallbackModels: [],
        defaultSubagentModel: null,
        aliases: {},
      }
    },

    async setRoutingPolicy(patch: Partial<RuntimeRoutingPolicy>, _reason: string): Promise<void> {
      const unsupported = [
        ...(patch.fallbackModels !== undefined && patch.fallbackModels.length > 0 ? ['fallbackModels'] : []),
        ...(patch.defaultSubagentModel !== undefined && patch.defaultSubagentModel !== null ? ['defaultSubagentModel'] : []),
        ...(patch.aliases !== undefined && Object.keys(patch.aliases).length > 0 ? ['aliases'] : []),
      ]
      if (unsupported.length > 0) {
        throw new RuntimeError(
          `adapter-pi: routing policy field(s) not supported by the pi runtime: ${unsupported.join(', ')}`,
          { kind: 'runtime_failed' },
        )
      }
      if (patch.defaultModel !== undefined) writeRoutingDefaultModel(patch.defaultModel)
    },
  }
}

/**
 * Input-modality capabilities for an agent's effective model. Conservative:
 * unknown agent or unresolvable model reports all-false; Pi models never
 * declare audio input.
 */
export async function capabilitiesForModel(modelRef: string | undefined): Promise<RuntimeCapabilities> {
  const { registry } = await getModelRegistry()
  const model = findPiModel(modelRef) ?? registry.getAvailable()[0]
  if (!model) return { imageInput: false, audioInput: false }
  return { imageInput: model.input.includes('image'), audioInput: false }
}
