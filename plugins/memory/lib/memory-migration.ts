/**
 * Memory-plugin schema migration.
 *
 * Per-plugin version marker separate from the global
 * `~/.bakin/.search-state.json` — bumping the global version drops every
 * `bakin_*` table, which is too blunt when the only thing that changed is
 * memory's TTL/filter rules.
 *
 * Version history:
 *   1 — introduce turn/audit retention (turn 7d, audit 30d). Historical
 *       rows indexed before this version predate the filter, so the table
 *       is dropped and the offsets cache is cleared; `onReady`'s backfill
 *       then re-enriches everything under the new rules.
 *   2 — populate `kind` on durable tier (soul/rules/tools/identity/
 *       heartbeat/memory/memory-log/dreams/user/bootstrap) and bring
 *       `{workspace}/skills/*\/SKILL.md` into the durable indexer with
 *       kind=skill. Existing rows have no `kind` — drop + re-derive.
 *   3 — rename runtime-originated source refs from provider-specific
 *       `openclaw` to `runtime` and daily-note meta from `openclawIndexed`
 *       to `runtimeIndexed`. Existing rows need a provider-neutral rederive.
 *
 * Bump `MEMORY_SCHEMA_VERSION` whenever a write-path change means existing
 * rows should be re-derived from source (new filters, new fields, changed
 * id hashing, etc.). Pure UI tweaks do NOT need a bump.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getContentDir } from '@bakin/core/content-dir'
import { createLogger } from '../../../src/core/logger'
import type { SearchAPI } from '@bakin/core/plugin-types'
import { clearAllOffsets, getOffsetsFilePath } from './offsets'

const log = createLogger('memory:migration')

export const MEMORY_SCHEMA_VERSION = 3

function versionFilePath(): string {
  return join(getContentDir(), 'plugin-settings', 'memory', 'schema-version.json')
}

function readStoredVersion(): number {
  const path = versionFilePath()
  if (!existsSync(path)) return 0
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as { version?: number }
    return typeof raw.version === 'number' ? raw.version : 0
  } catch (err) {
    log.warn('memory schema version file malformed — treating as 0', {
      err: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
}

function writeStoredVersion(version: number): void {
  const path = versionFilePath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify({ version }, null, 2), 'utf-8')
}

function resetOffsets(): void {
  const path = getOffsetsFilePath()
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch (err) {
      log.warn('failed to unlink offsets.json', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  clearAllOffsets()
}

export interface MigrationResult {
  migrated: boolean
  from: number
  to: number
}

/**
 * Runs once per boot. When the stored version is behind the code version:
 *   1. Reset `bakin_memory` so historical rows disappear.
 *   2. Wipe `offsets.json` so the backfill re-reads every watched file from
 *      byte 0 instead of skipping past data that's no longer in the index.
 *   3. Recreate the registered table with the current schema before the
 *      backfill starts writing.
 *   4. Write the new version marker so this doesn't repeat.
 */
export async function migrateIfNeeded(search: SearchAPI): Promise<MigrationResult> {
  const stored = readStoredVersion()
  if (stored >= MEMORY_SCHEMA_VERSION) {
    return { migrated: false, from: stored, to: MEMORY_SCHEMA_VERSION }
  }

  const maintenance = search.maintenance
  if (!maintenance || !await maintenance.available()) {
    log.info('Search adapter unavailable — skipping memory migration but still bumping marker', {
      stored,
      target: MEMORY_SCHEMA_VERSION,
    })
    writeStoredVersion(MEMORY_SCHEMA_VERSION)
    return { migrated: false, from: stored, to: MEMORY_SCHEMA_VERSION }
  }

  log.info('Memory schema version behind — resetting memory table and clearing offsets', {
    stored,
    target: MEMORY_SCHEMA_VERSION,
  })

  try {
    await maintenance.resetContentType()
  } catch (err) {
    log.warn('Resetting memory search table failed — continuing', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  resetOffsets()

  writeStoredVersion(MEMORY_SCHEMA_VERSION)
  return { migrated: true, from: stored, to: MEMORY_SCHEMA_VERSION }
}
