/**
 * `~/.bakin/updates.json` — the one engine-owned file (#1007, D7.3): records,
 * per-subject scheduling state, conditional-request state keyed by endpoint,
 * written atomically, schema-validated on read (invalid ⇒ logged + discarded,
 * never rewritten on read). `bakin.db` stays coordination-only.
 */
import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import { createLogger } from '../logger'
import { UpdateRecordSchema } from './schema'
import type { ConditionalEntry, UpdateScheduleEntry } from './types'

const log = createLogger('updates-store')

export const UPDATES_FILE_VERSION = 1

const ScheduleEntrySchema = z.object({
  lastCheckedAt: z.string().datetime().optional(),
  nextDueAt: z.string().datetime().optional(),
  failures: z.number().int().nonnegative(),
})

const ConditionalEntrySchema = z.object({
  etag: z.string().optional(),
  lastModified: z.string().optional(),
  body: z.unknown().optional(),
  sha: z.string().optional(),
  updatedAt: z.string().datetime(),
})

export const UpdatesFileSchema = z.object({
  version: z.literal(UPDATES_FILE_VERSION),
  records: z.record(z.string(), UpdateRecordSchema),
  schedule: z.record(z.string(), ScheduleEntrySchema),
  conditional: z.record(z.string(), ConditionalEntrySchema),
})

export interface UpdatesFile {
  version: typeof UPDATES_FILE_VERSION
  records: Record<string, UpdateRecord>
  schedule: Record<string, UpdateScheduleEntry>
  conditional: Record<string, ConditionalEntry>
}

export function emptyUpdatesFile(): UpdatesFile {
  return { version: UPDATES_FILE_VERSION, records: {}, schedule: {}, conditional: {} }
}

/** The file, or null when absent, unreadable or invalid (the last two are logged — the engine starts fresh). */
export function readUpdatesFile(path: string): UpdatesFile | null {
  if (!existsSync(path)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    log.warn('updates file unreadable — starting from an empty state', { path, error: err instanceof Error ? err.message : String(err) })
    return null
  }
  const parsed = UpdatesFileSchema.safeParse(raw)
  if (!parsed.success) {
    log.warn('updates file failed schema validation — starting from an empty state', { path, issues: parsed.error.issues.slice(0, 5) })
    return null
  }
  return parsed.data as UpdatesFile
}

export function writeUpdatesFile(path: string, file: UpdatesFile): void {
  atomicWriteJson(path, file)
}
