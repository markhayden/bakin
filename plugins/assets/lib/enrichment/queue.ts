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
import { isPdfPath, runScannedPdfEnrichment } from './scanned-pdf'
import {
  AssetGoneError,
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

type ActivityNotifier = (event: string, agent: string, detail: Record<string, unknown>) => void
let notifyActivity: ActivityNotifier = () => {}

/** Feed attribution: runtime engines run AS an agent; direct API calls are system work. */
function actingAgent(modelId: string): string {
  return modelId.startsWith('runtime:') ? modelId.slice('runtime:'.length) : 'system'
}

export function initEnrichmentQueue(
  settingsReader: SettingsReader,
  deps: { getRuntime?: RuntimeReader; onActivity?: ActivityNotifier } = {},
): void {
  readSettings = settingsReader
  readRuntime = deps.getRuntime ?? (() => null)
  notifyActivity = deps.onActivity ?? (() => {})
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

    const rawExtracted = kind.kind === 'document'
      ? await extractAssetContent(file.absPath, file.absPath)
      : undefined
    const extractedText = rawExtracted?.trim() ? rawExtracted : undefined
    // Scanned/image-only PDFs (#747): no text layer ⇒ render the first pages
    // and run them through the IMAGE vision pipeline instead of skipping.
    const scannedPdf = kind.kind === 'document' && !extractedText && isPdfPath(file.absPath)
    if (kind.kind === 'document' && !extractedText && !scannedPdf) {
      status = 'skipped'
      counters.skipped++
      await markEnrichmentSkipped(job.assetId, 'document has no extractable text to summarize')
      return
    }

    // Scanned PDFs need an IMAGE-capable engine, not a document summarizer.
    const effectiveKind = scannedPdf ? 'image' : kind.kind
    const resolution = await resolveEnrichmentEngine(settings, { kind: effectiveKind }, { runtime: readRuntime() })
    if (!resolution.ok) {
      status = 'skipped'
      counters.skipped++
      await markEnrichmentSkipped(job.assetId, resolution.reason)
      return
    }
    const engine = resolution.engine
    model = engine.modelId

    await markEnrichmentPending(job.assetId)
    notifyActivity('asset.enrich_started', actingAgent(engine.modelId), {
      message: `Enriching ${job.assetId}${pending.size > 0 ? ` (${pending.size} more queued)` : ''}`,
      assetId: job.assetId,
      engine: engine.modelId,
      queued: pending.size,
    })

    const signature = createHash('sha256')
      .update([job.assetId, manifest.currentVersion, engine.modelId].join('|'))
      .digest('hex')

    const callProvider = scannedPdf
      ? () => runScannedPdfEnrichment(
          engine, file.absPath, `${job.assetId}:v${manifest.currentVersion}`, manifest.description ?? undefined,
        )
      : () => engine.run({
          kind: kind.kind,
          jobKey: `${job.assetId}:v${manifest.currentVersion}`,
          ...(kind.kind !== 'document' ? { mediaPath: file.absPath, mediaMime: kind.mime } : {}),
          ...(extractedText ? { extractedText } : {}),
          ...(manifest.description ? { existingDescription: manifest.description } : {}),
        })

    // Billed call first, bounded retries; the manifest write retries
    // SEPARATELY so an apply hiccup can never re-bill a successful call
    // (force bypasses the dedup cache, so its retries would each re-bill).
    let result: VisionEnrichmentResult | null = null
    let lastError: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !result; attempt++) {
      try {
        result = job.force ? await callProvider() : await callRegistry.run(signature, callProvider)
      } catch (err) {
        lastError = err
        log.warn('enrichment attempt failed', {
          assetId: job.assetId, attempt, model: engine.modelId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (result) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await applyEnrichmentResult(job.assetId, manifest.currentVersion, engine.modelId, result)
          counters.processed++
          const caption = (result.caption ?? result.summary ?? '').slice(0, 120)
          notifyActivity('asset.enriched', actingAgent(engine.modelId), {
            message: `Enriched ${job.assetId}${caption ? ` — “${caption}”` : ''}`,
            assetId: job.assetId,
            engine: engine.modelId,
            caption,
            remaining: pending.size,
          })
          return
        } catch (err) {
          // Asset trashed mid-flight: retrying the write is pointless — bail
          // to the outer handler, which records a benign skip.
          if (err instanceof AssetGoneError) throw err
          lastError = err
          log.warn('enrichment apply failed (billed result held — no re-bill)', {
            assetId: job.assetId, attempt, model: engine.modelId,
            err: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
    // Record the failure BEFORE counting it: if the asset vanished mid-flight
    // this throws AssetGoneError and the outer handler books a skip instead —
    // a job must never inflate both counters.
    const failMessage = lastError instanceof Error ? lastError.message : String(lastError)
    await markEnrichmentFailed(job.assetId, failMessage)
    status = 'failed'
    counters.failed++
    notifyActivity('asset.enrich_failed', actingAgent(engine.modelId), {
      message: `Enrichment failed for ${job.assetId} — ${failMessage.slice(0, 160)}`,
      assetId: job.assetId,
      engine: engine.modelId,
      error: failMessage.slice(0, 160),
    })
  } catch (err) {
    if (err instanceof AssetGoneError) {
      // Deleted between enqueue and write — normal lifecycle race, not a failure.
      status = 'skipped'
      counters.skipped++
      log.info('asset deleted during enrichment; skipping', { assetId: job.assetId })
    } else {
      // The queue itself must never explode a pump cycle.
      status = 'failed'
      log.error('enrichment job crashed', err instanceof Error ? err : undefined, { assetId: job.assetId })
    }
  } finally {
    // No parallel stat system: the single usage recorder feeds telemetry.
    // Skips count as 'ok' — they are correct outcomes, not failures.
    recordUsage({
      kind: 'rest',
      activityClass: 'system',
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
