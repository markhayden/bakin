/**
 * Async prompt-context builders that hit external systems (agent-package
 * lessons via retrieval, attached assets via the assets hook). Owns the
 * lessonBlockCache. Extracted from dispatch.ts — distinct from the synchronous
 * prompt string assembly in dispatch-prompts.ts because these are async,
 * cached, and audit-emitting.
 */
import { createLogger } from './logger'
import { getSettings } from './settings'
import { appendAudit } from './audit'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import {
  formatLessonsForDispatch,
  retrieveAgentPackageLessons,
} from './agent-packages/lesson-retrieval'
import { formatDispatchError } from './dispatch-failures'

const log = createLogger('dispatch')
const hooks = () => getHookRegistry()

// Formatted lesson blocks cached per (agentId, query). The query embeds
// title/description/step instructions, so a workflow step change naturally
// misses while inProgress re-dispatches of the same step hit — no separate
// stepId bookkeeping needed. Bounded + TTL'd; empty blocks are cached too so
// lesson-less agents don't re-query every dispatch.
const LESSON_BLOCK_CACHE_TTL_MS = 5 * 60_000
const LESSON_BLOCK_CACHE_MAX = 200
const lessonBlockCache = new Map<string, { block: string; expires: number }>()

const BRAND_CONTEXT_DEFAULT_BUDGET = 12288
const BRAND_CONTEXT_MIN_BUDGET = 1024

/** @internal Clamp dispatch.maxBrandContextBytes: unset/0/invalid → default, floor at the minimum (#419). */
export function resolveBrandContextBudget(raw?: number): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return BRAND_CONTEXT_DEFAULT_BUDGET
  return Math.max(Math.floor(raw), BRAND_CONTEXT_MIN_BUDGET)
}

/** @internal Test-only. */
export function __resetLessonBlockCache(): void {
  lessonBlockCache.clear()
}

/** @internal Exported for testing. */
export async function buildDispatchLessonBlock(input: {
  contentDir: string
  taskId: string
  title: string
  agentId: string
  query: string
}): Promise<string> {
  const cacheKey = JSON.stringify([input.agentId, input.query])
  const hit = lessonBlockCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.block

  try {
    const settings = getSettings().agentPackages?.lessonsRetrieval
    const result = await retrieveAgentPackageLessons({
      contentDir: input.contentDir,
      agentId: input.agentId,
      query: input.query,
      settings,
      requireDispatchInjection: true,
    })
    const block = formatLessonsForDispatch(
      result.lessons,
      settings?.maxCharacters,
    )
    lessonBlockCache.set(cacheKey, { block, expires: Date.now() + LESSON_BLOCK_CACHE_TTL_MS })
    while (lessonBlockCache.size > LESSON_BLOCK_CACHE_MAX) {
      const oldest = lessonBlockCache.keys().next().value
      if (oldest === undefined) break
      lessonBlockCache.delete(oldest)
    }
    if (result.lessons.length > 0) {
      appendAudit(input.contentDir, 'agent_pkg.lessons_retrieved', input.agentId, {
        taskId: input.taskId,
        title: input.title,
        packageId: result.packageId,
        lessons: result.lessons.map((lesson) => ({
          lessonId: lesson.lessonId,
          title: lesson.title,
          score: lesson.score,
        })),
      })
    }
    return block
  } catch (err) {
    const error = formatDispatchError(err)
    log.warn('Dispatch lesson retrieval failed', { taskId: input.taskId, agentId: input.agentId, error })
    appendAudit(input.contentDir, 'agent_pkg.lessons_retrieval_failed', input.agentId, {
      taskId: input.taskId,
      title: input.title,
      error,
    })
    return ''
  }
}

/**
 * Resolve a task's attached assets via the assets.listByTask hook and render
 * the dispatch block. Async (hook invoke), so call sites compute it before
 * the synchronous message builders and pass the result in. Returns '' when
 * the task has no assets or the assets plugin is unavailable.
 */
export async function buildDispatchAssetBlock(taskId: string): Promise<string> {
  try {
    const assets = await hooks().invoke<Array<{ assetId: string; description?: string; type: string }>>(
      'assets.listByTask',
      { taskId },
    ) ?? []
    if (assets.length === 0) return ''
    const lines = assets.map((a) => `- ${a.assetId}${a.description ? ` — ${a.description}` : ''}`)
    return `\n\n## Attached Assets\nThis task has ${assets.length} linked asset(s). Review them for context before starting:\n${lines.join('\n')}\nOpen with bakin_exec_assets_open using the assetId to read the current content + metadata. AssetIds are stable identity — do not store raw disk paths.`
  } catch {
    // Assets plugin not activated (tests, minimal installs) — no block.
    return ''
  }
}
