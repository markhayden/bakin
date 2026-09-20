/**
 * #852 D5 — opt-in availability probing. Fires the runtime's optional
 * models.probe per fetched model (the fetched list IS the configured-
 * provider scope: adapters only list models whose provider has auth),
 * bounded concurrency, per-model verdicts. Outcomes ride the SAME
 * evidence pipeline as real turns (noteProbeOutcome → model_rejections),
 * so a probe success resolves an open rejection and a probe rejection
 * opens one. User-triggered only — never called from background refresh
 * or any schedule.
 */
import type { PluginContext } from '@bakin/core/plugin-types'
import { noteProbeOutcome } from '../../../src/core/model-availability'

export interface ProbeVerdict {
  model: string
  status: 'verified' | 'rejected' | 'skipped'
  detail?: string
}

const PROBE_CONCURRENCY = 3
const VERDICT_DETAIL_CAP = 200

export async function probeModels(
  ctx: PluginContext,
  models: Array<{ id: string }>,
): Promise<{ supported: boolean; verdicts: ProbeVerdict[] }> {
  const probe = ctx.runtime.models.probe?.bind(ctx.runtime.models)
  if (!probe) {
    return {
      supported: false,
      verdicts: models.map((m) => ({ model: m.id, status: 'skipped' as const, detail: 'active runtime has no probe support' })),
    }
  }

  const verdicts: ProbeVerdict[] = []
  const queue = [...models]
  const worker = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      try {
        await probe(next.id)
        noteProbeOutcome(next.id, { ok: true })
        verdicts.push({ model: next.id, status: 'verified' })
      } catch (err) {
        noteProbeOutcome(next.id, { ok: false, err })
        const kind = (err as { kind?: unknown } | null)?.kind
        const message = err instanceof Error ? err.message : String(err)
        verdicts.push(kind === 'model_not_supported'
          ? { model: next.id, status: 'rejected', detail: message.slice(0, VERDICT_DETAIL_CAP) }
          // A transport/timeout/auth failure proves nothing about the model —
          // an honest inconclusive, never a fake verdict in either direction.
          : { model: next.id, status: 'skipped', detail: `probe inconclusive (${typeof kind === 'string' ? kind : 'unclassified error'})` })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker))
  // Stable order for the response regardless of completion order.
  const rank = new Map(models.map((m, i) => [m.id, i]))
  verdicts.sort((a, b) => (rank.get(a.model) ?? 0) - (rank.get(b.model) ?? 0))
  return { supported: true, verdicts }
}
