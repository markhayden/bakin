/**
 * User-side availability overrides for managed workflow definitions.
 *
 * Disabled defaults stay visible in management surfaces, but automatic
 * selection paths should ignore them unless they explicitly opt in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import { getContentDir } from './content-dir'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('workflows:availability')

const disabledDefaultsFileSchema = z.object({
  disabledWorkflowIds: z.array(z.string()).default([]),
}).passthrough()

let cachedPath: string | null = null
let cachedDisabledWorkflowIds: Set<string> | null = null

function availabilityPath(contentDir?: string): string {
  if (contentDir && contentDir.split(/[\\/]+/).includes('..')) {
    throw new Error('contentDir must not contain parent-directory segments')
  }
  return join(contentDir || getContentDir(), 'workflows', 'disabled-defaults.json')
}

export function readDisabledWorkflowIds(contentDir?: string): Set<string> {
  const file = availabilityPath(contentDir)
  if (cachedPath === file && cachedDisabledWorkflowIds) {
    return new Set(cachedDisabledWorkflowIds)
  }
  if (!existsSync(file)) {
    cachedPath = file
    cachedDisabledWorkflowIds = new Set()
    return new Set()
  }
  try {
    const parsed = disabledDefaultsFileSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')))
    if (!parsed.success) {
      log.warn('Ignoring invalid disabled-defaults file', { file, issues: parsed.error.issues })
      cachedPath = file
      cachedDisabledWorkflowIds = new Set()
      return new Set()
    }
    cachedPath = file
    cachedDisabledWorkflowIds = new Set(parsed.data.disabledWorkflowIds)
    return new Set(cachedDisabledWorkflowIds)
  } catch (err) {
    log.warn('Ignoring unreadable disabled-defaults file', { file, error: err instanceof Error ? err.message : String(err) })
    cachedPath = file
    cachedDisabledWorkflowIds = new Set()
    return new Set()
  }
}

export function isWorkflowDisabled(id: string, contentDir?: string): boolean {
  return readDisabledWorkflowIds(contentDir).has(id)
}

export function setWorkflowDisabled(id: string, disabled: boolean, contentDir?: string): void {
  const file = availabilityPath(contentDir)
  const ids = readDisabledWorkflowIds(contentDir)
  if (disabled) ids.add(id)
  else ids.delete(id)

  mkdirSync(dirname(file), { recursive: true })
  cachedPath = file
  cachedDisabledWorkflowIds = new Set(ids)
  writeFileSync(
    file,
    `${JSON.stringify({ disabledWorkflowIds: Array.from(ids).sort() }, null, 2)}\n`,
    'utf-8',
  )
}

export function resetWorkflowAvailabilityCache(): void {
  cachedPath = null
  cachedDisabledWorkflowIds = null
}
