/**
 * Explore plugin — server entry point.
 * Curated-catalog discovery: browse and install official agents, plugins,
 * and packs. Discovery only — lifecycle management stays in Team/Health.
 */
import { z } from 'zod'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { getSettings } from '../../src/core/settings'
import type { BakinPlugin } from '@bakin/core/plugin-types'
import { definePlugin, defineRoute } from '@bakin/core/routing'
import { createLogger } from '../../src/core/logger'
import { getUpdatesEngine } from '../../src/core/updates/service'
import { mergedCatalog } from './lib/catalog'
import { gatherInstallSources, joinInstallState, NO_UPDATE_RECORDS, type UpdateRecordMap } from './lib/install-state'
import { refreshRemoteCatalog } from './lib/refresh'
import type { ExploreCatalogResponse } from './types'

const log = createLogger('explore')

const catalogEntryResponse = z.object({
  id: z.string(),
  kind: z.enum(['agent', 'plugin', 'skill-pack', 'workflow-pack', 'lesson-pack']),
  name: z.string(),
  emoji: z.string().optional(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  useCases: z.array(z.string()),
  source: z.string().optional(),
  ref: z.string().nullable(),
  trust: z.enum(['official', 'verified', 'community']),
  builtin: z.boolean(),
  dependencies: z.array(z.string()),
  defaultSelected: z.boolean(),
  iconUrl: z.string().optional(),
  screenshots: z.array(z.string()),
  installed: z.boolean(),
  updateAvailable: z.boolean().nullable(),
  installedVersion: z.string().nullable(),
})

const catalogResponse = z.object({
  activeAdapter: z.string(),
  ok: z.literal(true),
  updatedAt: z.string(),
  remoteUpdatedAt: z.string().nullable(),
  entries: z.array(catalogEntryResponse),
})

/**
 * The updates engine's records by id (#1007). The catalog never probes a
 * source itself: "Check for updates" is `POST /api/updates/check`, and the
 * page re-reads the catalog (and follows `updates.changed`) afterwards.
 * Without a running engine every installed entry is honestly unknown.
 */
async function updateRecords(): Promise<UpdateRecordMap> {
  const engine = getUpdatesEngine()
  if (!engine) return NO_UPDATE_RECORDS
  const snapshot = await engine.snapshot()
  return new Map(snapshot.records.map((record): [string, UpdateRecord] => [record.id, record]))
}

async function buildCatalogResponse(): Promise<ExploreCatalogResponse> {
  const [catalog, records] = await Promise.all([mergedCatalog(), updateRecords()])
  return {
    ok: true,
    updatedAt: catalog.updatedAt,
    remoteUpdatedAt: catalog.remoteUpdatedAt,
    entries: joinInstallState(catalog.entries, gatherInstallSources(), records),
    activeAdapter: getSettings().runtime.adapter,
  }
}

const routes = [
  defineRoute({
    path: '/catalog',
    method: 'GET',
    summary: 'Merged curated catalog with install state',
    description:
      'Embedded catalog merged with the cached remote catalog, joined against local lockfiles and the updates engine\'s records. ' +
      'Offline: it never probes a source — run POST /api/updates/check to observe.',
    responses: { 200: catalogResponse },
    handler: async () => {
      try {
        return Response.json(await buildCatalogResponse())
      } catch (err) {
        log.error('catalog route failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        )
      }
    },
  }),

  defineRoute({
    path: '/catalog/refresh',
    method: 'POST',
    summary: 'Fetch and cache the remote curated catalog',
    description:
      'Explicit user action: fetches catalog.json from the official bits repo, validates it, caches it, ' +
      'and returns the merged catalog. Failures leave the existing cache untouched.',
    responses: { 200: catalogResponse },
    handler: async () => {
      try {
        const result = await refreshRemoteCatalog()
        if (!result.ok) {
          return Response.json(
            { ok: false, reason: result.reason, error: result.error },
            { status: result.reason === 'no-remote-catalog' ? 404 : 502 },
          )
        }
        return Response.json(await buildCatalogResponse())
      } catch (err) {
        log.error('catalog refresh failed', err instanceof Error ? err : new Error(String(err)))
        return Response.json(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        )
      }
    },
  }),
]

const explorePlugin: BakinPlugin = definePlugin({
  id: 'explore',
  name: 'Explore',
  version: '1.0.0',
  routes,

  async activate() {
    log.info('Explore plugin activated')
  },
})

export default explorePlugin
