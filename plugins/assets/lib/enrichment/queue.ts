/**
 * Enrichment queue (spec D8/T9) — a SEPARATE in-process single-concurrency
 * worker, deliberately NOT the search outbox: outbox rows are free to
 * retry forever; enrichment calls are BILLED, so retries are bounded and
 * the durable record is the manifest itself (status/forVersion — nothing
 * to replay at boot, nothing to scan).
 *
 * Failure posture: enqueue never throws and never blocks asset creation;
 * a job that exhausts retries writes `status: 'failed'` (doctor surfaces
 * counts; explicit backfill retries). Unsupported asset kinds record
 * `skipped` with the reason.
 */
import { createIdempotencyRegistry } from '@bakin/core/media'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../../src/core/logger'
import { recordUsage } from '../../../../src/core/usage'
import { getAsset, resolveFile } from '../asset-core'
import { canExtractAssetContent, extractAssetContent } from '../content-extractor'
import {
  applyEnrichmentResult,
  markEnrichmentFailed,
  markEnrichmentPending,
  markEnrichmentSkipped,
} from './apply'
import type { EnrichmentSettings } from './providers'
import { resolveEnrichmentEngine } from './engine'
import type { VisionEnrichmentResult } from '@bakin/core/media'
import { createHash } from 'crypto'

const log = createLogger('asset-enrichment')

const MAX_ATTEMPTS = 2

const IMAGE_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
}
const AUDIO_MIMES: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
}

interface EnrichmentJob {
  assetId: string
  force: boolean
}

export interface EnrichmentQueueStats {
  depth: number
  running: boolean
  processed: number
  failed: number
  skipped: number
}

type SettingsReader = () => EnrichmentSettings
type RuntimeReader = () => AgentRuntimeAdapter | null

let readSettings: SettingsReader = () => ({})
let readRuntime: RuntimeReader = () => null
const pending = new Map<string, EnrichmentJob>()
let activePump: Promise<void> | null = null
let stopped = false
const counters = { processed: 0, failed: 0, skipped: 0 }

// In-flight dedup for the billed call; the DURABLE guard is the manifest
// (status done + forVersion), checked in the job itself.
const callRegistry = createIdempotencyRegistry<VisionEnrichmentResult>()

export function initEnrichmentQueue(settingsReader: SettingsReader, deps: { getRuntime?: RuntimeReader } = {}): void {
  readSettings = settingsReader
  readRuntime = deps.getRuntime ?? (() => null)
  stopped = false
}

export function stopEnrichmentQueue(): void {
  stopped = true
  pending.clear()
}

export function enrichmentQueueStats(): EnrichmentQueueStats {
  return { depth: pending.size, running: activePump !== null, ...counters }
}

/** Never throws; never blocks the caller. */
export function enqueueEnrichment(assetId: string, opts: { force?: boolean } = {}): void {
  if (stopped) return
  const existing = pending.get(assetId)
  pending.set(assetId, { assetId, force: opts.force || existing?.force || false })
  void pump()
}

/** Drain the queue (backfill/tests await this; live callers fire-and-forget). */
export async function drainEnrichmentQueue(): Promise<void> {
  await pump()
}

/** Single-flight: a concurrent pump shares the active cycle's promise. */
function pump(): Promise<void> {
  if (stopped) return Promise.resolve()
  if (activePump) return activePump
  activePump = (async () => {
    try {
      while (pending.size > 0 && !stopped) {
        const [assetId, job] = pending.entries().next().value as [string, EnrichmentJob]
        pending.delete(assetId)
        await processJob(job)
      }
    } finally {
      activePump = null
    }
  })()
  return activePump
}

function kindFor(manifest: NonNullable<ReturnType<typeof getAsset>>, absPath: string, mimeType: string): { kind: 'image' | 'audio' | 'document'; mime?: string } | null {
  const ext = absPath.split('.').pop()?.toLowerCase() ?? ''
  const imageMime = IMAGE_MIMES[ext] ?? (mimeType.startsWith('image/') ? mimeType : undefined)
  if (manifest.type === 'images' && imageMime) return { kind: 'image', mime: imageMime }
  const audioMime = AUDIO_MIMES[ext] ?? (mimeType.startsWith('audio/') ? mimeType : undefined)
  if (manifest.type === 'audio' && audioMime) return { kind: 'audio', mime: audioMime }
  if (canExtractAssetContent(absPath)) return { kind: 'document' }
  return null
}

async function processJob(job: EnrichmentJob): Promise<void> {
  const start = Date.now()
  let status: 'ok' | 'failed' | 'skipped' = 'ok'
  let model = ''
  try {
    const manifest = getAsset(job.assetId)
    if (!manifest) return

    // Durable skip guard: this exact version is already enriched.
    if (!job.force
      && manifest.enrichment?.status === 'done'
      && manifest.enrichment.forVersion === manifest.currentVersion) {
      return
    }

    const settings = readSettings()
    if (settings.enrichmentEnabled === false) return

    const file = resolveFile(job.assetId, manifest.currentVersion)
    if (!file) return
    const kind = kindFor(manifest, file.absPath, file.mimeType)
    if (!kind) {
      status = 'skipped'
      counters.skipped++
      await markEnrichmentSkipped(job.assetId, `unsupported asset kind for enrichment: ${manifest.type}`)
      return
    }

    const resolution = await resolveEnrichmentEngine(settings, { kind: kind.kind }, { runtime: readRuntime() })
    if (!resolution.ok) {
      status = 'skipped'
      counters.skipped++
      await markEnrichmentSkipped(job.assetId, resolution.reason)
      return
    }
    const engine = resolution.engine
    model = engine.modelId

    const extractedText = kind.kind === 'document'
      ? await extractAssetContent(file.absPath, file.absPath)
      : undefined
    if (kind.kind === 'document' && !extractedText) {
      status = 'skipped'
      counters.skipped++
      await markEnrichmentSkipped(job.assetId, 'document has no extractable text to summarize')
      return
    }

    await markEnrichmentPending(job.assetId)

    const signature = createHash('sha256')
      .update([job.assetId, manifest.currentVersion, engine.modelId].join('|'))
      .digest('hex')

    const callProvider = () => engine.run({
          kind: kind.kind,
          jobKey: `${job.assetId}:v${manifest.currentVersion}`,
          ...(kind.kind !== 'document' ? { mediaPath: file.absPath, mediaMime: kind.mime } : {}),
          ...(extractedText ? { extractedText } : {}),
          ...(manifest.description ? { existingDescription: manifest.description } : {}),
        })

    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // force = an explicit re-bill request — it bypasses the dedup cache.
        const result = job.force ? await callProvider() : await callRegistry.run(signature, callProvider)
        await applyEnrichmentResult(job.assetId, manifest.currentVersion, engine.modelId, result)
        counters.processed++
        return
      } catch (err) {
        lastError = err
        log.warn('enrichment attempt failed', {
          assetId: job.assetId, attempt, model: engine.modelId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
    status = 'failed'
    counters.failed++
    await markEnrichmentFailed(job.assetId, lastError instanceof Error ? lastError.message : String(lastError))
  } catch (err) {
    // The queue itself must never explode a pump cycle.
    status = 'failed'
    log.error('enrichment job crashed', err instanceof Error ? err : undefined, { assetId: job.assetId })
  } finally {
    // No parallel stat system: the single usage recorder feeds telemetry.
    // Skips count as 'ok' — they are correct outcomes, not failures.
    recordUsage({
      kind: 'rest',
      name: 'assets.enrich',
      agent: null,
      durationMs: Date.now() - start,
      status: status === 'failed' ? 'error' : 'ok',
      meta: {
        outcome: status,
        ...(model ? {
          model,
          engine: model.startsWith('runtime:') ? 'runtime' : 'direct',
          ...(model.startsWith('runtime:') ? { agent: model.slice('runtime:'.length) } : {}),
        } : {}),
      },
    })
  }
}

/** Backfill: enqueue every asset (or one) — the skip guard makes it cheap. */
export function enqueueEnrichmentBackfill(assetIds: string[], opts: { force?: boolean } = {}): number {
  for (const assetId of assetIds) enqueueEnrichment(assetId, opts)
  return assetIds.length
}
