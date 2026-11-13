/**
 * The only state Home stores: things a person decided. What Home shows is
 * otherwise derived from the home's real state on every read.
 *
 * `~/.bakin/plugin-data/home/decisions.json`. Reads and writes are
 * synchronous, so one process never interleaves them. Keys this version
 * does not know are kept, so a downgrade and re-upgrade loses nothing. A
 * file that cannot be parsed is treated as "nothing decided" and is never
 * written over until the next real decision.
 */
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { getContentDir } from '../../../src/core/content-dir'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('home')

const isoInstant = z.string().min(1)

/** What the person said in the introduction. */
export const introductionAnswersSchema = z.object({
  agentName: z.string().trim().min(1).max(40),
  personality: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'), id: z.string().min(1) }),
    z.object({ kind: z.literal('custom'), description: z.string().trim().min(1).max(600) }),
  ]),
  userName: z.string().trim().min(1).max(60),
}).strict()
export type IntroductionAnswers = z.infer<typeof introductionAnswersSchema>

const decisionsSchema = z.object({
  version: z.literal(1),
  /**
   * The "meet your agent" introduction. Absent = never decided. `skipped`
   * hides it until reopened; `pending` holds the answers while they are
   * written; `completed` is written LAST, after every answer has landed.
   */
  introduction: z.discriminatedUnion('status', [
    z.object({ status: z.literal('skipped'), at: isoInstant }),
    z.object({ status: z.literal('completed'), at: isoInstant }),
    // The answers were given and are being written. Recorded BEFORE the first
    // write, so a failure midway resumes from here instead of leaving a
    // renamed agent with no personality and the introduction gone.
    z.object({ status: z.literal('pending'), at: isoInstant, answers: introductionAnswersSchema }),
  ]).optional(),
  /** The person sent their first hello after the introduction; the offer is not shown again. */
  saidHello: z.object({ at: isoInstant }).optional(),
}).passthrough()

export type HomeDecisions = z.infer<typeof decisionsSchema>

const EMPTY: HomeDecisions = { version: 1 }

export function decisionsPath(): string {
  return join(getContentDir(), 'plugin-data', 'home', 'decisions.json')
}

export function readDecisions(): HomeDecisions {
  const path = decisionsPath()
  if (!existsSync(path)) return { ...EMPTY }
  try {
    return decisionsSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
  } catch (err) {
    log.warn('Home decisions file could not be read; treating as nothing decided', { path, error: err instanceof Error ? err.message : String(err) })
    return { ...EMPTY }
  }
}

/** Read, change, write. `change` returns the next value; unknown keys ride along. */
export function updateDecisions(change: (current: HomeDecisions) => HomeDecisions): HomeDecisions {
  const next = decisionsSchema.parse(change(readDecisions()))
  const path = decisionsPath()
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteJson(path, next)
  return next
}
