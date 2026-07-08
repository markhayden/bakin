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

// ─── Brand context (#419) ────────────────────────────────────────────────────
// Structural mirrors of the brands plugin's getContext result — core never
// imports plugin code (the dispatch-team.ts precedent).

/** Injection-record fields the brands plugin reports per card build. */
export interface BrandInjectionMeta {
  brandFingerprint: string | null
  cardBytes: number
  sectionsIncluded: string[]
  lessonsIncluded: string[]
  omitted: Array<{ item: string; reason: string }>
}

export type BrandDispatchBlock =
  | { status: 'none' }
  | { status: 'ready'; brandId: string; block: string; meta: BrandInjectionMeta; warnings: string[] }
  | { status: 'missing'; brandId: string }

/** Thrown by dispatch prep when a linked brand vanished post-gate — the claim is released, never dispatched brandless. */
export class BrandUnavailableError extends Error {
  constructor(readonly brandId: string) {
    super(`brand '${brandId}' not found — task will not dispatch until it exists`)
    this.name = 'BrandUnavailableError'
  }
}

const BRAND_ANCESTRY_MAX_HOPS = 10

/** Where a task's effective brand came from — surfaced in the task Brand panel. */
export type EffectiveBrandSource = 'own' | 'parent' | 'project'

export type EffectiveBrand =
  | { brandId: string; source: EffectiveBrandSource }
  /**
   * A project brand was intended (the task/ancestry carries a projectId) but
   * `projects.getBrand` ERRORED — we can't produce a brandId, but we also must
   * NOT treat the task as unbranded, or we'd dispatch brandless against the
   * feature's own fail-closed contract. The dispatch gate defers on this.
   */
  | { unresolved: true; projectId: string }

/**
 * Effective brand: own → nearest ancestor (cycle-safe parentId walk — the
 * decomposition/corrective paths must never lose the brand) → project brand
 * via the external projects plugin's hook (own or first ancestor projectId).
 * Lazy by design (spec D4): re-branding a project flows to its tasks. A
 * successful hook returning no brand = genuinely unbranded (undefined); a hook
 * ERROR = unresolved (fail closed, not open).
 */
export async function resolveEffectiveBrand(task: {
  id: string
  brandId?: string
  parentId?: string | null
  projectId?: string
}): Promise<EffectiveBrand | undefined> {
  if (task.brandId) return { brandId: task.brandId, source: 'own' }

  let projectId = task.projectId
  const seen = new Set<string>([task.id])
  let parentId = task.parentId ?? undefined
  // Dynamic import keeps this module's load graph free of the task store
  // (partial task-store mocks across tests/ break on new static imports).
  const { getTask } = await import('./task-store')
  for (let hop = 0; parentId && hop < BRAND_ANCESTRY_MAX_HOPS; hop++) {
    if (seen.has(parentId)) break
    seen.add(parentId)
    const parent = getTask(parentId)
    if (!parent) break
    if (parent.brandId) return { brandId: parent.brandId, source: 'parent' }
    if (!projectId && parent.projectId) projectId = parent.projectId
    parentId = parent.parentId ?? undefined
  }

  if (projectId && hooks().has('projects.getBrand')) {
    try {
      const brandId = await hooks().invoke<string | undefined>('projects.getBrand', { projectId })
      if (typeof brandId === 'string' && brandId) return { brandId, source: 'project' }
      // Hook succeeded and the project has no brand → genuinely unbranded.
    } catch (err) {
      // Hook ERRORED — we don't know whether the project is branded. Fail
      // CLOSED: signal unresolved so the dispatch gate defers instead of
      // silently firing brandless.
      log.warn('projects.getBrand failed; deferring rather than dispatching brandless', {
        taskId: task.id, projectId, error: formatDispatchError(err),
      })
      return { unresolved: true, projectId }
    }
  }
  return undefined
}

/**
 * Effective brand id only — the dispatch-path convenience over
 * resolveEffectiveBrand. Returns `{ unresolved: true }` when a project brand
 * was intended but the hook errored (fail-closed signal for the gate).
 */
export async function resolveEffectiveBrandId(task: {
  id: string
  brandId?: string
  parentId?: string | null
  projectId?: string
}): Promise<{ brandId: string } | { unresolved: true } | undefined> {
  const effective = await resolveEffectiveBrand(task)
  if (!effective) return undefined
  if ('unresolved' in effective) return { unresolved: true }
  return { brandId: effective.brandId }
}

// Notify-once per (taskId, brandId) incident. In-memory by design: a server
// restart re-notifies, which is acceptable (the durable option is a ledger
// UNIQUE like budget incidents if this ever needs to survive restarts).
// Cleared when the brand resolves again so a REPEAT deletion re-notifies.
const brandBlockNotified = new Set<string>()

/** @internal Test-only. */
export function __resetBrandBlockNotifications(): void {
  brandBlockNotified.clear()
}

/**
 * Pre-claim brand gate (#419, spec §5.3) — mirrors deferForBudget: a task
 * whose effective brand doesn't resolve to a published brand stays in todo
 * and is skipped WITHOUT claiming a run, resuming automatically the cycle
 * the brand exists again. First skip per incident audits
 * `brand.dispatch_blocked` and broadcasts the plugin-event that drives the
 * browser notification + board badge.
 */
export async function deferForMissingBrand(
  task: { id: string; title: string; brandId?: string; parentId?: string | null; projectId?: string },
  contentDir: string,
): Promise<{ brandId: string } | false> {
  const effective = await resolveEffectiveBrandId(task)
  if (!effective) return false
  // Project-brand hook errored → defer, keyed by projectId (we have no brandId
  // to check). The task resumes once resolution succeeds.
  const brandId = 'unresolved' in effective ? `project:${task.projectId ?? '?'}` : effective.brandId

  let available = false
  if ('unresolved' in effective) {
    available = false // fail closed — never dispatch brandless on a resolution error
  } else if (hooks().has('brands.get')) {
    try {
      const brand = await hooks().invoke<{ manifest?: { draft?: boolean } } | undefined>('brands.get', { brandId })
      available = !!brand?.manifest && !brand.manifest.draft
    } catch (err) {
      log.warn('brands.get failed during brand gate; failing closed', { taskId: task.id, brandId, error: formatDispatchError(err) })
    }
  }

  const key = `${task.id}:${brandId}`
  if (available) {
    brandBlockNotified.delete(key)
    return false
  }

  if (!brandBlockNotified.has(key)) {
    brandBlockNotified.add(key)
    const message = `Task "${task.title}" is waiting on brand '${brandId}' — it will not dispatch until the brand exists (recreate it or relink the task).`
    appendAudit(contentDir, 'brand.dispatch_blocked', 'system', { taskId: task.id, title: task.title, brandId, message })
    try {
      const { broadcast } = await import('./sse')
      broadcast({ type: 'plugin-event', event: 'brand.dispatch_blocked', taskId: task.id, brandId, message, timestamp: new Date().toISOString() })
    } catch {
      log.warn('brand.dispatch_blocked broadcast unavailable', { taskId: task.id, brandId })
    }
  }
  return { brandId }
}

/**
 * Triage brand resolution (#419): a triage dispatch (no agent) gets only a
 * one-liner brand mention in its prompt, so it needs just the effective
 * brandId — NOT a full card build or lesson retrieval. Fails closed the same
 * way (missing/draft → block). The returned `block` is empty; only `brandId`
 * feeds the triage one-liner.
 */
export async function resolveTriageBrand(task: {
  id: string
  brandId?: string
  parentId?: string | null
  projectId?: string
}): Promise<BrandDispatchBlock> {
  const effective = await resolveEffectiveBrandId(task)
  if (!effective) return { status: 'none' }
  if ('unresolved' in effective) return { status: 'missing', brandId: `project:${task.projectId ?? '?'}` }
  const brandId = effective.brandId

  let available = false
  if (hooks().has('brands.get')) {
    try {
      const brand = await hooks().invoke<{ manifest?: { draft?: boolean } } | undefined>('brands.get', { brandId })
      available = !!brand?.manifest && !brand.manifest.draft
    } catch (err) {
      log.warn('brands.get failed during triage brand resolution; failing closed', { taskId: task.id, brandId, error: formatDispatchError(err) })
    }
  }
  if (!available) return { status: 'missing', brandId }
  return {
    status: 'ready',
    brandId,
    block: '',
    meta: { brandFingerprint: null, cardBytes: 0, sectionsIncluded: [], lessonsIncluded: [], omitted: [] },
    warnings: [],
  }
}

/**
 * Build the per-dispatch brand block by invoking brands.getContext. Returns
 * `none` for unbranded tasks, `missing` when the effective brand does not
 * resolve to a published brand (caller decides: pre-claim defer or typed
 * prep failure) — NEVER a fabricated or empty-but-branded card.
 */
export async function buildDispatchBrandBlock(task: {
  id: string
  title?: string
  description?: string
  brandId?: string
  parentId?: string | null
  projectId?: string
}): Promise<BrandDispatchBlock> {
  const effective = await resolveEffectiveBrandId(task)
  if (!effective) return { status: 'none' }
  // Project-brand resolution errored → fail closed (missing), never brandless.
  if ('unresolved' in effective) return { status: 'missing', brandId: `project:${task.projectId ?? '?'}` }
  const brandId = effective.brandId
  if (!hooks().has('brands.getContext')) return { status: 'missing', brandId }

  try {
    const result = await hooks().invoke<
      | { notFound: true }
      | { card: string; warnings: string[]; meta: { brandId: string } & BrandInjectionMeta }
    >('brands.getContext', {
      brandId,
      taskQuery: [task.title, task.description].filter(Boolean).join('\n').slice(0, 2000),
      maxBytes: resolveBrandContextBudget(getSettings().dispatch?.maxBrandContextBytes),
    })
    if (!result || 'notFound' in result) return { status: 'missing', brandId }
    const { brandId: _ignored, ...meta } = result.meta
    return { status: 'ready', brandId, block: result.card, meta, warnings: result.warnings }
  } catch (err) {
    // A broken brands plugin must fail closed for branded tasks — dispatching
    // brandless would be the silent tripwire this feature exists to kill.
    log.error('brands.getContext failed', err instanceof Error ? err : new Error(String(err)), { taskId: task.id, brandId })
    return { status: 'missing', brandId }
  }
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
