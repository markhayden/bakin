/**
 * brands.integrity doctor check (#419, spec §10) — a thin consumer of the
 * shared lib/integrity.ts scan (same engine as GET /:brandId/integrity).
 * Findings attach structured `data`; UIs never parse message text.
 *
 * Severity: dangling refs / ghost-brand tasks / currently-deferring tasks /
 * invalid manifests → warn; stale drafts alone → ok with a nudge in data.
 */
import type { HealthCheckRunInput, JsonObject, PluginContext } from '@bakin/core/plugin-types'
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import { scanBrandIntegrity } from './integrity'
import { getBrand, listBrands } from './store'

export async function checkBrandsIntegrity(ctx: PluginContext): Promise<HealthCheckRunInput> {
  const report = await scanBrandIntegrity(async (assetId) => (await ctx.assets.getAsset(assetId)) !== null)

  // Tasks pointing at ghost/draft brands = tasks currently deferring at the
  // brand gate (todo only — done/archived history is not a problem). Uses the
  // SAME effective-brand resolution as the gate + badge (own → ancestry →
  // project), so inherited-brand deferrals aren't invisible to the doctor.
  const ghostTasks: Array<{ taskId: string; brandId: string }> = []
  try {
    const { resolveEffectiveBrand } = await import('../../../src/core/dispatch-context-blocks')
    const todo = await ctx.tasks.list({ column: 'todo' })
    for (const task of todo) {
      const effective = await resolveEffectiveBrand(task)
      if (!effective) continue
      if ('unresolved' in effective) {
        ghostTasks.push({ taskId: task.id, brandId: `project:${effective.projectId}` })
        continue
      }
      const read = getBrand(effective.brandId)
      if (read.status !== 'ok' || read.manifest.draft) {
        ghostTasks.push({ taskId: task.id, brandId: effective.brandId })
      }
    }
  } catch {
    // Task store unavailable — report what the brand scan alone found.
  }

  const dangling = report.findings.filter((f) => f.dangling.length > 0)
  const staleDrafts = report.findings.filter((f) => f.staleDraft).map((f) => f.brandId)
  const data: JsonObject = {
    brands: listBrands().brands.length,
    dangling: dangling.map((f) => ({
      brandId: f.brandId,
      refs: f.dangling.map((ref) => ({ assetId: ref.assetId, where: ref.where })),
    })),
    invalid: report.invalid.map((entry) => ({ id: entry.id, error: entry.error })),
    ghostTasks: ghostTasks.map((task) => ({ taskId: task.taskId, brandId: task.brandId })),
    staleDrafts,
  }

  const problems: string[] = []
  if (dangling.length) problems.push(`${dangling.length} brand(s) with dangling asset refs`)
  if (report.invalid.length) problems.push(`${report.invalid.length} unreadable brand manifest(s)`)
  if (ghostTasks.length) problems.push(`${ghostTasks.length} task(s) waiting on a missing/draft brand`)

  if (problems.length) {
    return healthObserved([healthWarning({
      key: 'integrity',
      summary: `Brand integrity: ${problems.join('; ')}.`,
      evidence: data,
      incident: {
        key: 'integrity',
        title: 'Brand references need attention',
        impact: 'Tasks may wait at the brand gate or render with missing brand assets.',
        disposition: 'action_required',
        resources: [
          ...dangling.map((finding) => ({ kind: 'other' as const, id: finding.brandId, label: finding.brandId })),
          ...ghostTasks.map((task) => ({ kind: 'task' as const, id: task.taskId, label: task.taskId })),
        ],
        resolution: { key: 'review-brands', type: 'navigate', label: 'Review Brands', href: '/brands' },
      },
    })])
  }
  if (staleDrafts.length) {
    return healthObserved([healthWarning({
      key: 'stale-drafts',
      summary: `${staleDrafts.length} brand draft(s) older than 7 days await review.`,
      evidence: data,
      incident: {
        key: 'stale-drafts',
        title: 'Older brand drafts await review',
        impact: 'Drafts do not block work, but may represent unfinished brand updates.',
        disposition: 'advisory',
        resources: staleDrafts.map((id) => ({ kind: 'other', id, label: id })),
        resolution: { key: 'review-brands', type: 'navigate', label: 'Review Brands', href: '/brands' },
      },
    })])
  }
  return healthObserved([healthHealthy({
    key: 'integrity',
    summary: 'Brands have no dangling references, ghost-brand tasks, or invalid manifests.',
    evidence: data,
  })])
}
