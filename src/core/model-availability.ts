/**
 * #852 — the ONE model-availability recording chokepoint.
 *
 * `withModelAvailabilityObservation` wraps the adapter that
 * createRuntimeAdapter() returns, so every consumer (dispatch, chat, the
 * system-route call sites, images, probes) inherits both evidence edges
 * with zero per-call-site code:
 *
 *  - rejection edge: a typed `model_not_supported` failure (thrown
 *    RuntimeError with providerInfo.model, or a stream terminal error chunk
 *    carrying `data: { kind, model }`) → durable model_rejections row +
 *    `model.rejected` audit (only when the row opens/reopens — the UNIQUE
 *    is the debounce). The error passes through byte-identical.
 *  - success edge: a call with an EXPLICIT model that completes → resolve
 *    the open rejection, if any (cheap indexed UPDATE; no happy-path write
 *    amplification), + `model.rejection_resolved` audit when a row flipped.
 *    Inherit-model successes are not attributable (the actual model is
 *    adapter-private) and record nothing.
 *
 * Recording is best-effort fire-and-forget: a ledger/audit failure logs a
 * warning and NEVER masks or alters the original turn outcome. Ledger
 * unavailable therefore fails OPEN — models stay available on missing
 * evidence (opposite of the budget gate's posture, by design).
 *
 * Implementation note: the adapter is wrapped with a Proxy delegating via
 * `Reflect.get(target, prop, target)` so lazy surface getters (Pi's
 * init-time-bound `get images()`) are never forced at wrap time.
 */
import { RuntimeError } from '@bakin/core/adapters/runtime'
import type { AgentRuntimeAdapter, ChatChunk, MessageArgs } from '@bakin/core/adapters/runtime'
import { recordModelRejection, resolveModelRejection, type ModelRejectionResolution } from './execution-ledger'
import { appendAudit } from './audit'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'

const log = createLogger('model-availability')

function noteModelRejected(model: string, opts: { provider?: string; detail?: string; source: string }): void {
  try {
    const result = recordModelRejection({
      model,
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.detail ? { detail: opts.detail } : {}),
    })
    if (result.opened) {
      appendAudit(getContentDir(), 'model.rejected', 'system', {
        model,
        ...(opts.provider ? { provider: opts.provider } : {}),
        source: opts.source,
      })
    }
  } catch (err) {
    log.warn('model rejection not recorded (ledger/audit unavailable?)', { model, error: String(err) })
  }
}

function noteModelSucceeded(model: string, source: string, resolution: ModelRejectionResolution = 'model_succeeded'): void {
  try {
    if (resolveModelRejection({ model, resolution })) {
      appendAudit(getContentDir(), 'model.rejection_resolved', 'system', { model, source, resolution })
    }
  } catch (err) {
    log.warn('model rejection not resolved (ledger/audit unavailable?)', { model, error: String(err) })
  }
}

function observeThrown(err: unknown, source: string): void {
  if (err instanceof RuntimeError && err.kind === 'model_not_supported' && err.providerInfo?.model) {
    noteModelRejected(err.providerInfo.model, {
      ...(err.providerInfo.provider ? { provider: err.providerInfo.provider } : {}),
      detail: err.message,
      source,
    })
  }
}

function wrapMessaging(messaging: AgentRuntimeAdapter['messaging']): AgentRuntimeAdapter['messaging'] {
  return {
    async send(args: MessageArgs) {
      try {
        const result = await messaging.send(args)
        // #880: a turn that carried a model but was override-denied ran on
        // the agent DEFAULT — crediting args.model would falsely heal an
        // open rejection for a model that was never exercised.
        const overrideDenied = Boolean((result.metadata as { modelOverrideDenied?: unknown } | undefined)?.modelOverrideDenied)
        if (args.model && !overrideDenied) noteModelSucceeded(args.model, 'send')
        return result
      } catch (err) {
        observeThrown(err, 'send')
        throw err
      }
    },
    stream(args: MessageArgs) {
      return {
        async *[Symbol.asyncIterator]() {
          let sawError = false
          let overrideDenied = false
          for await (const chunk of messaging.stream(args)) {
            if (chunk.type === 'error') {
              sawError = true
              const data = chunk.data as { kind?: unknown; model?: unknown } | undefined
              if (data?.kind === 'model_not_supported' && typeof data.model === 'string') {
                noteModelRejected(data.model, {
                  ...(typeof chunk.content === 'string' && chunk.content ? { detail: chunk.content } : {}),
                  source: 'stream',
                })
              }
            }
            if (chunk.type === 'done' && (chunk.data as { modelOverrideDenied?: unknown } | undefined)?.modelOverrideDenied) {
              overrideDenied = true // #880: ran on the default, not args.model
            }
            yield chunk
          }
          // Terminal done without an error chunk = the turn completed.
          if (!sawError && !overrideDenied && args.model) noteModelSucceeded(args.model, 'stream')
        },
      } satisfies AsyncIterable<ChatChunk>
    },
  }
}

type ImagesSurface = NonNullable<AgentRuntimeAdapter['images']>

function carrierModelOf(result: unknown): string | undefined {
  const r = result as { provider?: unknown; metadata?: { carrierModel?: unknown } } | undefined
  if (typeof r?.provider === 'string' && typeof r.metadata?.carrierModel === 'string') {
    return `${r.provider}/${r.metadata.carrierModel}`
  }
  return undefined
}

function wrapImages(images: ImagesSurface): ImagesSurface {
  const observeResult = (result: unknown): void => {
    // A successful call can still have burned rungs on the carrier ladder
    // (#852): the adapter reports them as facts on the result; core turns
    // them into the same durable evidence a thrown rejection produces.
    const rejected = (result as { metadata?: { rejectedCarriers?: unknown } } | undefined)?.metadata?.rejectedCarriers
    if (Array.isArray(rejected)) {
      for (const model of rejected) {
        if (typeof model === 'string' && model) {
          noteModelRejected(model, { detail: 'carrier rejected during image fallback', source: 'images' })
        }
      }
    }
    const carrier = carrierModelOf(result)
    if (carrier) noteModelSucceeded(carrier, 'images')
  }
  return {
    ...images,
    async generate(input) {
      try {
        const result = await images.generate(input)
        observeResult(result)
        return result
      } catch (err) {
        observeThrown(err, 'images')
        throw err
      }
    },
    async edit(input) {
      try {
        const result = await images.edit(input)
        observeResult(result)
        return result
      } catch (err) {
        observeThrown(err, 'images')
        throw err
      }
    },
  }
}

export function withModelAvailabilityObservation(adapter: AgentRuntimeAdapter): AgentRuntimeAdapter {
  const surfaceCache = new WeakMap<object, unknown>()
  const cached = <T extends object>(surface: T, wrap: (s: T) => T): T => {
    const hit = surfaceCache.get(surface)
    if (hit) return hit as T
    const wrapped = wrap(surface)
    surfaceCache.set(surface, wrapped)
    return wrapped
  }
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === 'messaging') return cached(target.messaging, wrapMessaging)
      if (prop === 'images') {
        const images = target.images
        return images ? cached(images, wrapImages) : images
      }
      // Preserve `this` = the real adapter so lazy getters memoize on it.
      return Reflect.get(target, prop, target)
    },
  })
}

/**
 * Probe outcome recording (T8/#852 D5): probes ride the same evidence
 * pipeline as real turns — exported for the probe orchestration, which
 * knows the probed id even when the adapter's error carries no model.
 */
export function noteProbeOutcome(model: string, outcome: { ok: true } | { ok: false; err: unknown }): void {
  if (outcome.ok) {
    noteModelSucceeded(model, 'probe', 'probe_succeeded')
    return
  }
  const err = outcome.err
  if (err instanceof RuntimeError && err.kind === 'model_not_supported') {
    noteModelRejected(err.providerInfo?.model ?? model, {
      ...(err.providerInfo?.provider ? { provider: err.providerInfo.provider } : {}),
      detail: err.message,
      source: 'probe',
    })
  }
}
