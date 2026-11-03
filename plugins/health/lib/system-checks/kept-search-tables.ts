/**
 * The operator's durable "Keep" for unclaimed Search engine tables (re-homing
 * row 76). Dropping a table another Bakin instance may own is the one-click
 * repair; keeping it is a RECORDED decision — the check stops raising the
 * named tables (a table that appears later is new evidence and is raised),
 * and the kept names stay visible in the observation. ONE flat JSON file
 * beside the ack store: `~/.bakin/health/kept-search-tables.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { getContentDir } from '../../../../src/core/content-dir'

const KeptSearchTablesSchema = z.object({
  version: z.literal(1),
  tables: z.record(z.string(), z.object({ keptAt: z.string() })),
})
type KeptSearchTables = z.infer<typeof KeptSearchTablesSchema>

export function keptSearchTablesPath(): string {
  return join(getContentDir(), 'health', 'kept-search-tables.json')
}

function readStore(): KeptSearchTables {
  const path = keptSearchTablesPath()
  if (!existsSync(path)) return { version: 1, tables: {} }
  const parsed = KeptSearchTablesSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')))
  if (!parsed.success) throw new Error(`${path} is not a kept-tables record: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  return parsed.data
}

function writeStore(store: KeptSearchTables): void {
  const path = keptSearchTablesPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`)
}

/** The table names the operator decided to keep; an unreadable record throws (never "nothing kept"). */
export function readKeptSearchTables(): string[] {
  return Object.keys(readStore().tables).sort()
}

/** Record the decision for these tables; returns every name now kept. */
export function keepSearchTables(tables: readonly string[], now: () => string = () => new Date().toISOString()): string[] {
  const store = readStore()
  for (const table of tables) store.tables[table] ??= { keptAt: now() }
  writeStore(store)
  return Object.keys(store.tables).sort()
}

/** Reverse the decision: the next sweep raises these tables again. Omit `tables` to forget every kept table. */
export function forgetKeptSearchTables(tables?: readonly string[]): string[] {
  const store = readStore()
  if (!tables) store.tables = {}
  else for (const table of tables) delete store.tables[table]
  writeStore(store)
  return Object.keys(store.tables).sort()
}

/** Pure: the unclaimed tables a sweep found, split into the ones still to decide and the ones already kept. */
export function partitionUnclaimedTables(unclaimed: readonly string[], kept: readonly string[]): { pending: string[]; kept: string[] } {
  const keptSet = new Set(kept)
  return {
    pending: unclaimed.filter((table) => !keptSet.has(table)),
    kept: unclaimed.filter((table) => keptSet.has(table)),
  }
}
