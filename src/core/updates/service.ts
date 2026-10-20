/**
 * The process-wide updates service (#1007): ONE engine over the registered
 * sources, ONE timer, started from startup recovery and stopped at
 * lifecycle shutdown. Sources register before `startUpdates` (adapter
 * factories and plugin activation run earlier in boot); routes and the
 * CLI read through `getUpdatesEngine` / `getUpdatesTimer`.
 */
import { join } from 'node:path'
import { getSettings } from '../settings'
import { broadcast } from '../sse'
import { createLogger } from '../logger'
import { createUpdatesEngine, type UpdatesEngine } from './engine'
import { startUpdatesTimer, type UpdatesTimer } from './timer'
import type { UpdateSource } from './types'

const log = createLogger('updates-service')

export const UPDATES_FILE_NAME = 'updates.json'

const sources: UpdateSource[] = []
let engine: UpdatesEngine | null = null
let timer: UpdatesTimer | null = null

/** Register a source for the next `startUpdates`. One source per kind; a second registration of a kind replaces the first. */
export function registerUpdateSource(source: UpdateSource): void {
  const index = sources.findIndex((existing) => existing.kind === source.kind)
  if (index >= 0) sources[index] = source
  else sources.push(source)
}

/** The registered sources, in registration order (tests + boot wiring). */
export function registeredUpdateSources(): ReadonlyArray<UpdateSource> {
  return sources
}

export function startUpdates(contentDir: string): UpdatesEngine {
  stopUpdates()
  engine = createUpdatesEngine({
    storePath: join(contentDir, UPDATES_FILE_NAME),
    sources: [...sources],
    intervalMs: getSettings().updates.intervalMs,
    publish: (event) => broadcast({ type: event.type, ids: event.ids }),
  })
  timer = startUpdatesTimer({ engine, settings: () => ({ enabled: getSettings().updates.enabled }) })
  engine.ready.catch((error) => log.error('Updates engine failed to reconcile at boot', error))
  log.info('Updates started', { sources: sources.map((source) => source.kind) })
  return engine
}

export function stopUpdates(): void {
  timer?.stop()
  timer = null
  engine = null
}

/** Null until `startUpdates` ran (serverless CLI paths build their own engine). */
export function getUpdatesEngine(): UpdatesEngine | null {
  return engine
}

export function getUpdatesTimer(): UpdatesTimer | null {
  return timer
}

/** Test seam: forget every registered source. */
export function resetUpdateSources(): void {
  sources.length = 0
}
