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
import { onServerEvent } from '../server-events'
import { disposeApplyWatches } from './apply-watch'
import { createUpdatesEngine, type UpdatesEngine } from './engine'
import { startUpdatesTimer, type UpdatesTimer } from './timer'
import type { UpdateSource } from './types'

const log = createLogger('updates-service')

export const UPDATES_FILE_NAME = 'updates.json'

const sources: UpdateSource[] = []
let engine: UpdatesEngine | null = null
let timer: UpdatesTimer | null = null
let unobserve: (() => void) | null = null

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

export interface StartUpdatesOptions {
  /**
   * Where the records persist. The server owns `<home>/updates.json`; an
   * offline CLI check runs on a SCRATCH copy so it never writes beside a
   * server that starts meanwhile, nor beside another offline check
   * (review r15 #1).
   */
  storePath?: string
}

export function startUpdates(contentDir: string, options: StartUpdatesOptions = {}): UpdatesEngine {
  stopUpdates()
  engine = createUpdatesEngine({
    storePath: options.storePath ?? join(contentDir, UPDATES_FILE_NAME),
    sources: [...sources],
    intervalMs: () => getSettings().updates.intervalMs,
    // The shell fans `plugin-event` envelopes out to `usePluginEvent` (and the
    // doctor refresh reads the inner name): anything else never reaches a tab.
    publish: (event) => broadcast({ type: 'plugin-event', event: event.type, ids: event.ids }),
  })
  timer = startUpdatesTimer({ engine, settings: () => ({ enabled: getSettings().updates.enabled }) })
  engine.ready.catch((error) => log.error('Updates engine failed to reconcile at boot', error))
  // A plugin install/remove/upgrade or a settings write changes the subject
  // set or its fingerprints before the next tick would notice.
  const started = engine
  unobserve?.()
  unobserve = onServerEvent((event) => {
    if (engine !== started) return
    const type = typeof event.type === 'string' ? event.type : ''
    if (type !== 'plugin:manifest-changed' && type !== 'settings.changed') return
    started.refreshInventory().catch((error) => log.warn('Updates inventory refresh failed', { event: type, error: error instanceof Error ? error.message : String(error) }))
  })
  log.info('Updates started', { sources: sources.map((source) => source.kind) })
  return engine
}

export function stopUpdates(): void {
  timer?.stop()
  timer = null
  engine = null
  unobserve?.()
  unobserve = null
  disposeApplyWatches()
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
