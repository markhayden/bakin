/**
 * Search schema migration — drops and recreates Bakin's search tables
 * when the in-code schema version advances beyond the last-migrated
 * version stored on disk.
 *
 * Why a separate state file instead of reading from settings.json:
 * The code's desired version lives in SCHEMA_VERSION below. The
 * persisted version is the "last successful migration" marker. Storing
 * it in settings.json would mix user-overridable config with internal
 * state, and every fresh install would see defaults matching defaults
 * (no migration would ever run). A dedicated state file at
 * `~/.bakin/.search-state.json` keeps the two concerns separate.
 *
 * Version history:
 *   1 — initial schema, single 'embeddings' index per table, global
 *       all-MiniLM-L6-v2 embedder.
 *   2 — multi-index support (assets_text + assets_visual on bakin_assets),
 *       content field populated server-side, default embedder swapped to
 *       BAAI/bge-small-en-v1.5 via Termite.
 *
 * Bump SCHEMA_VERSION whenever a change requires an existing table to
 * be dropped and recreated with new schema, indexes, or embedder config.
 * Pure data additions (no schema change, no embedder change) do NOT
 * need a bump — they flow through the existing reindex endpoint.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { getContentDir } from './content-dir'
import { getAppServices } from './app-services'
import { createLogger } from './logger'

const log = createLogger('search-migration')

/** Current in-code schema version. Bump when search tables need a drop+recreate. */
// 3 — antfly v0.2 migration: embeddings indexes now carry an explicit
//     `dimension` (the zig server requires declared dims for dense indexes)
//     and provider naming moved termite -> antfly. Tables created during the
//     migration window may exist with embeddings indexes the server rejected
//     — drop + recreate everything against the v0.2 config.
// 4 — drop create-time `schema` (breaks all queries on the table at
//     v0.2.0-rc.2, bakin#456) and swap the visual embedder to the Xenova
//     ONNX mirror. Tables created with a schema are unqueryable and must be
//     dropped + recreated schemaless.
export const SCHEMA_VERSION = 4

const STATE_FILE_NAME = '.search-state.json'
const TABLE_PREFIX = 'bakin_'

interface SearchState {
  version: number
}

function getStatePath(): string {
  return join(getContentDir(), STATE_FILE_NAME)
}

/** Read the last-migrated version from disk. Returns 0 when the file
 * does not exist yet (fresh install — first-ever migration will run). */
export function readStoredVersion(): number {
  const path = getStatePath()
  if (!existsSync(path)) return 0
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<SearchState>
    return typeof raw.version === 'number' ? raw.version : 0
  } catch (err) {
    log.warn('Failed to parse search state file — treating as version 0', err)
    return 0
  }
}

/** Persist the successfully-migrated version. Creates the content dir
 * if missing so first-boot writes work on a fresh install. */
export function writeStoredVersion(version: number): void {
  const path = getStatePath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify({ version }, null, 2), 'utf-8')
}

/**
 * If the stored version is behind the code version, drop every
 * `bakin_*` table and return true. The caller is responsible for
 * triggering the downstream reindex once the registry has recreated
 * the tables on the next `createRegisteredTables()` call.
 *
 * Returns false if no migration was needed. Never throws — migration
 * errors degrade to "keep the old tables and log loudly" rather than
 * blocking the whole boot.
 */
export async function migrateIfNeeded(): Promise<{
  migrated: boolean
  from: number
  to: number
}> {
  const search = getAppServices().search
  if (!await search.available()) {
    return { migrated: false, from: 0, to: SCHEMA_VERSION }
  }

  const stored = readStoredVersion()
  if (stored >= SCHEMA_VERSION) {
    return { migrated: false, from: stored, to: SCHEMA_VERSION }
  }

  log.info('Search schema version mismatch — dropping and recreating bakin_* tables', {
    stored,
    target: SCHEMA_VERSION,
  })

  try {
    const existing = await search.tables.list()
    const bakinTables = existing
      .map(t => t.name)
      .filter(name => name.startsWith(TABLE_PREFIX))

    for (const tableName of bakinTables) {
      try {
        await search.tables.drop(tableName)
        log.info(`Dropped table for schema migration: ${tableName}`)
      } catch (err) {
        log.warn(`Failed to drop table during migration: ${tableName}`, err)
      }
    }

    writeStoredVersion(SCHEMA_VERSION)
    return { migrated: true, from: stored, to: SCHEMA_VERSION }
  } catch (err) {
    log.error('Search migration failed — tables left in place', err)
    return { migrated: false, from: stored, to: SCHEMA_VERSION }
  }
}
