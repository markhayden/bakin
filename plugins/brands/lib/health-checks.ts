/**
 * brands.integrity doctor check (#419, spec §10; self-healing PR1 row 189) —
 * a thin consumer of the shared lib/integrity.ts scan (same engine as
 * GET /:brandId/integrity). Findings attach structured evidence; UIs never
 * parse message text.
 *
 * One incident per affected BRAND (the record is the subject, its recover
 * page the control): dangling asset references, an unreadable manifest, or
 * tasks waiting at the brand gate on a brand that is missing, draft or
 * unreadable. `required` is a fact, never a presumption: the brand is in use
 * when an OPEN task carries it (or waits on it). Not in use ⇒ advisory. A
 * project's brand (`projects.getBrand`) is resolved per task through the
 * same effective-brand resolution the gate uses, so inherited usage counts.
 * Stale drafts alone stay an observation.
 */
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthIncidentInput, HealthObservationInput, JsonObject, PluginContext, PluginTask, PluginTaskColumn } from '@bakin/core/plugin-types'
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { scanBrandIntegrity } from './integrity'
import { getBrand, listBrands } from './store'

/** brands.integrity families (re-homing rows 189–190): broken references are the operator's decision on the recover page; stale drafts are an observation. */
export const BRANDS_INTEGRITY_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'integrity', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
]

/** Columns whose tasks still use their brand (done/archived history is not usage). */
const OPEN_TASK_COLUMNS: ReadonlySet<PluginTaskColumn> = new Set(['backlog', 'todo', 'inProgress', 'review', 'blocked'])

function stablePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown'
}

interface GhostTask { taskId: string; brandId: string }

/** Open tasks per brand id (own `brandId` only — the cheap, exact usage fact). */
function openTasksByBrand(tasks: readonly PluginTask[]): Map<string, string[]> {
  const byBrand = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.brandId || !OPEN_TASK_COLUMNS.has(task.column)) continue
    const bucket = byBrand.get(task.brandId) ?? []
    bucket.push(task.id)
    byBrand.set(task.brandId, bucket)
  }
  return byBrand
}

function brandIncident(input: {
  key: string
  brandId: string
  title: string
  summary: string
  impact: string
  required: boolean
  href: string
  tasks: readonly string[]
  evidence: JsonObject
}): HealthObservationInput {
  const incident: HealthIncidentInput = {
    key: input.key,
    title: input.title,
    impact: input.impact,
    disposition: input.required ? 'action_required' : 'advisory',
    subject: { kind: 'record', id: `brands/${input.brandId}`, label: input.brandId },
    declarationId: 'integrity',
    required: input.required,
    resources: input.tasks.map((taskId) => ({ kind: 'task' as const, id: taskId, label: taskId })),
    resolution: { key: 'recover-brand', type: 'human', needs: 'decision', label: 'Recover this brand', href: input.href },
  }
  return healthWarning({ key: input.key, summary: input.summary, evidence: input.evidence, incident })
}

export async function checkBrandsIntegrity(ctx: PluginContext): Promise<HealthCheckRunInput> {
  const report = await scanBrandIntegrity(async (assetId) => (await ctx.assets.getAsset(assetId)) !== null)

  // Usage facts. Tasks pointing at ghost/draft brands = tasks currently
  // deferring at the brand gate (todo only — done/archived history is not a
  // problem). Uses the SAME effective-brand resolution as the gate + badge
  // (own → ancestry → project), so inherited-brand deferrals aren't invisible.
  let tasksKnown = true
  let openByBrand = new Map<string, string[]>()
  const ghostTasks: GhostTask[] = []
  try {
    const all = await ctx.tasks.list()
    openByBrand = openTasksByBrand(all)
    const { resolveEffectiveBrand } = await import('../../../src/core/dispatch-context-blocks')
    for (const task of all.filter((candidate) => candidate.column === 'todo')) {
      const effective = await resolveEffectiveBrand(task)
      if (!effective) continue
      if ('unresolved' in effective) {
        ghostTasks.push({ taskId: task.id, brandId: `project:${effective.projectId}` })
        continue
      }
      const read = getBrand(effective.brandId)
      if (read.status !== 'ok' || read.manifest.draft) {
        ghostTasks.push({ taskId: task.id, brandId: effective.brandId })
        // An inherited brand is usage too.
        const bucket = openByBrand.get(effective.brandId) ?? []
        if (!bucket.includes(task.id)) openByBrand.set(effective.brandId, [...bucket, task.id])
      }
    }
  } catch {
    // Task store unavailable — report what the brand scan alone found, and say the usage fact is missing.
    tasksKnown = false
  }
  const usedBy = (brandId: string): string[] => openByBrand.get(brandId) ?? []
  const ghostsByBrand = new Map<string, string[]>()
  for (const ghost of ghostTasks) ghostsByBrand.set(ghost.brandId, [...(ghostsByBrand.get(ghost.brandId) ?? []), ghost.taskId])

  const observations: HealthObservationInput[] = []
  const covered = new Set<string>()

  // Row 189a: dangling asset references — one incident per brand.
  for (const finding of report.findings.filter((f) => f.dangling.length > 0)) {
    covered.add(finding.brandId)
    const tasks = usedBy(finding.brandId)
    observations.push(brandIncident({
      key: `integrity-${stablePart(finding.brandId)}`,
      brandId: finding.brandId,
      title: `Brand ${finding.brandId} references ${finding.dangling.length} missing asset${finding.dangling.length === 1 ? '' : 's'}`,
      summary: `Brand ${finding.brandId}: ${finding.dangling.length} dangling asset ref(s) (${finding.dangling.map((ref) => ref.where).join(', ')}).`,
      impact: tasks.length > 0
        ? `${tasks.length} open task(s) carry this brand; their dispatch cards will name assets that do not exist.`
        : 'No open task uses this brand right now; branded work would render with missing brand assets.',
      required: tasks.length > 0,
      href: `/brands/${encodeURIComponent(finding.brandId)}?recover=1`,
      tasks,
      evidence: { refs: finding.dangling.map((ref) => ({ assetId: ref.assetId, where: ref.where })), openTasks: tasks, usageKnown: tasksKnown },
    }))
  }

  // Row 189b: an unreadable manifest — the recover page shows the raw file and offers Recreate / Delete.
  for (const entry of report.invalid) {
    covered.add(entry.id)
    const tasks = [...new Set([...usedBy(entry.id), ...(ghostsByBrand.get(entry.id) ?? [])])]
    observations.push(brandIncident({
      key: `invalid-${stablePart(entry.id)}`,
      brandId: entry.id,
      title: `Brand ${entry.id} has an unreadable manifest`,
      summary: `Brand ${entry.id}: brand.json is unreadable (${entry.error.slice(0, 200)}).`,
      impact: tasks.length > 0
        ? `${tasks.length} open task(s) use this brand and wait at the brand gate until it reads again.`
        : 'No open task uses this brand right now; it cannot be edited or injected until the manifest reads again.',
      required: tasks.length > 0,
      href: `/brands/${encodeURIComponent(entry.id)}?recover=1`,
      tasks,
      evidence: { error: entry.error.slice(0, 500), openTasks: tasks, usageKnown: tasksKnown },
    }))
  }

  // Row 189c: tasks waiting on a brand that is missing or still a draft. The
  // control is where the wait ends: the task's brand field for a brand that
  // does not exist (or a project brand that could not be resolved), the brand
  // page (Publish) for a draft.
  for (const [brandId, tasks] of ghostsByBrand) {
    if (covered.has(brandId)) continue
    const read = brandId.startsWith('project:') ? null : getBrand(brandId)
    const draft = read?.status === 'ok' && read.manifest.draft === true
    const href = draft
      ? `/brands/${encodeURIComponent(brandId)}`
      : `/tasks?taskId=${encodeURIComponent(tasks[0]!)}&field=brand`
    observations.push(brandIncident({
      key: `ghost-${stablePart(brandId)}`,
      brandId,
      title: draft
        ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} wait on draft brand ${brandId}`
        : `${tasks.length} task${tasks.length === 1 ? '' : 's'} wait on missing brand ${brandId}`,
      summary: `${tasks.length} task(s) wait at the brand gate on ${draft ? 'draft' : 'missing'} brand ${brandId}.`,
      impact: draft
        ? 'Dispatch defers these tasks until the brand is published.'
        : 'Dispatch defers these tasks until they point at a brand that exists.',
      required: true,
      href,
      tasks,
      evidence: { brandId, draft, openTasks: tasks, usageKnown: tasksKnown },
    }))
  }

  const staleDrafts = report.findings.filter((f) => f.staleDraft).map((f) => f.brandId)
  const data: JsonObject = { brands: listBrands().brands.length, staleDrafts, usageKnown: tasksKnown }
  if (observations.length === 0 && staleDrafts.length > 0) {
    // Row 190: an observation — drafts block nothing.
    observations.push(healthWarning({
      key: 'stale-drafts',
      summary: `${staleDrafts.length} brand draft(s) older than 7 days await review.`,
      detail: 'Drafts do not block work, but may represent unfinished brand updates (review on /brands).',
      evidence: data,
    }))
  }
  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'integrity',
      summary: 'Brands have no dangling references, ghost-brand tasks, or invalid manifests.',
      evidence: data,
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
