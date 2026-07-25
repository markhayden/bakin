/**
 * Assets plugin — server entry point.
 * Registers API routes, MCP exec tools, and cross-plugin hooks for asset management.
 *
 * Thin definePlugin shell: the route array lives in lib/routes.ts, the search
 * content-type registration in lib/register-search.ts, the assets.* hooks in
 * lib/register-hooks.ts, and the exec tools in lib/exec-tools.ts. activate()
 * orchestrates lifecycle wiring: plugin-ctx cell, enrichment queue, unmanaged
 * emitter, and the doctor health check.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'
import { definePlugin } from '@bakin/core/routing'
import { assetsRoutes } from './lib/routes'
import { setPluginCtx, registerAssetsSearch } from './lib/register-search'
import { registerAssetsHooks } from './lib/register-hooks'
import { registerAssetsExecTools } from './lib/exec-tools'
import { onAssetWritten } from './lib/asset-events'
import {
  drainEnrichmentQueue,
  enqueueEnrichment,
  enqueueEnrichmentBackfill,
  initEnrichmentQueue,
  stopEnrichmentQueue,
} from './lib/enrichment/queue'
import type { EnrichmentSettings } from './lib/enrichment/providers'
import { setUnmanagedEmitter } from './lib/unmanaged-tracker'
import { getContentDir } from '../../src/core/content-dir'
import { createLogger } from '../../src/core/logger'
import { assetRepair, checkAssets, checkEnrichmentEngine, incompleteEnrichmentAssetIds } from './lib/health-checks'
import { healthObserved } from '@makinbakin/sdk/utils'

const log = createLogger('assets')

/** Daily is effectively free: the done+forVersion skip guard makes passes
 *  over healthy assets no-ops, and nothing runs with force (no re-billing). */
const ENRICHMENT_SELF_HEAL_INTERVAL_MS = 24 * 60 * 60 * 1000
let selfHealTimer: ReturnType<typeof setInterval> | null = null

const assetsPlugin: BakinPlugin = definePlugin({
  id: 'assets',
  name: 'Assets',
  version: '2.2.0',
  routes: assetsRoutes,

  settingsSchema: {
    fields: [
      { key: 'thumbnails', type: 'boolean', label: 'Generate thumbnails', description: 'Auto-create optimized thumbnails on upload', default: true },
      { key: 'maxFileSize', type: 'number', label: 'Max file size (MB)', description: 'Reject uploads larger than this', default: 50 },
      { key: 'purgeClipboardOnComplete', type: 'boolean', label: 'Purge clipboard assets on task completion', description: 'Auto-delete clipboard-pasted assets when their linked task is marked done', default: false },
      { key: 'enrichmentEnabled', type: 'boolean', label: 'Vision enrichment', description: 'Derive caption/OCR/tags from asset content with a vision model (billed per asset version)', default: true },
      { key: 'enrichmentProvider', type: 'select', label: 'Enrichment provider', description: 'auto = cheapest configured API model, else the runtime agent when its model accepts images; runtime = agent turns only (subscription quota)', options: [{ value: 'auto', label: 'auto' }, { value: 'anthropic', label: 'anthropic' }, { value: 'openai', label: 'openai' }, { value: 'google', label: 'google' }, { value: 'runtime', label: 'runtime' }], default: 'auto' },
      { key: 'enrichmentModel', type: 'string', label: 'Enrichment model override', description: 'Exact model id (catalog or provider-native); empty = auto', default: '' },
      { key: 'enrichmentAgent', type: 'string', label: 'Enrichment agent', description: "Runtime agent for subscription-quota enrichment turns — its configured model must accept images (per-turn overrides don't pass the attachment gate; bakin#583/#584)", default: 'enrich' },
    ],
  },

  navItems: [],
  contentFiles: [],

  activate(ctx: PluginContext) {
    setPluginCtx(ctx)

    // ─── Enrichment queue (D8) ─────────────────────────────────────────
    // Every asset write enqueues; the queue never blocks creation; the
    // manifest's status/forVersion is the durable skip guard.
    initEnrichmentQueue(() => ctx.getSettings<EnrichmentSettings>(), {
      getRuntime: () => ctx.runtime ?? null,
      // Live Activity feed: started/enriched/failed per asset, attributed to
      // the agent doing the work — the answer to "how do I know it's working"
      // for 35s agent turns.
      onActivity: (event, agent, detail) => {
        try {
          ctx.activity.audit(event, agent, detail)
        } catch { /* activity surface unavailable (tests) */ }
      },
    })
    onAssetWritten(({ assetId }) => enqueueEnrichment(assetId))

    // ─── Enrichment self-heal (health trust overhaul) ──────────────────
    // A slow background pass re-attempts failed/missing/stale enrichment so
    // coverage recovers without a human. No force: nothing re-bills and the
    // done+forVersion skip guard keeps a pass over healthy assets free.
    selfHealTimer = setInterval(() => {
      try {
        const ids = incompleteEnrichmentAssetIds()
        if (ids.length === 0) return
        log.info(`Enrichment self-heal: re-attempting ${ids.length} asset(s)`)
        enqueueEnrichmentBackfill(ids)
        void drainEnrichmentQueue()
      } catch (err) {
        log.warn('Enrichment self-heal pass failed', { err: err instanceof Error ? err.message : String(err) })
      }
    }, ENRICHMENT_SELF_HEAL_INTERVAL_MS)
    selfHealTimer.unref?.()

    // ─── Search Content Type Registration ─────────────────────────────
    registerAssetsSearch(ctx)

    // ─── Cross-Plugin Hooks ────────────────────────────────────────────
    registerAssetsHooks(ctx)

    // No boot drain, no auto-ingest (D7): unmanaged files are surfaced by
    // the live tracker + on-demand scans and imported explicitly.
    setUnmanagedEmitter((count) => ctx.events.emit('asset.unmanaged', { count }))

    // ─── MCP Exec Tools ────────────────────────────────────────────────
    registerAssetsExecTools(ctx)

    // ─── Health check (migrated out of core/doctor.ts per #139 C3) ──────
    ctx.registerHealthRepairAction(assetRepair(getContentDir()))
    ctx.registerHealthCheck({
      id: 'assets',
      name: 'Asset store + manifest integrity',
      description: 'Checks asset-store structure, manifests, retention, unmanaged files, and enrichment readiness.',
      group: { key: 'assets', label: 'Assets' },
      maxAgeMs: 5 * 60_000,
      run: async () => {
        const base = checkAssets(getContentDir())
        if (base.outcome === 'not_applicable') return base
        return healthObserved([
          ...base.observations,
          await checkEnrichmentEngine(ctx.getSettings<EnrichmentSettings>(), ctx.runtime ?? null),
        ])
      },
    })
  },

  async onReady() {
    const contentDir = getContentDir()
    const storeRoot = join(contentDir, 'assets', 'store')
    if (existsSync(storeRoot)) {
      let count = 0
      try {
        for (const month of readdirSync(storeRoot)) {
          if (month.startsWith('.')) continue
          const monthDir = join(storeRoot, month)
          try { if (!statSync(monthDir).isDirectory()) continue } catch { continue }
          count++
        }
      } catch { /* skip */ }
      log.info(`Ready — ${count} month shards under assets/store/`)
    }
  },

  onShutdown() {
    if (selfHealTimer) clearInterval(selfHealTimer)
    selfHealTimer = null
    stopEnrichmentQueue()
    log.info('Shutting down assets plugin')
  },
})

export default assetsPlugin
