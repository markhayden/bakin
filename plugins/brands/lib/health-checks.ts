/**
 * brands.integrity doctor check (#419, spec §10) — a thin consumer of the
 * shared lib/integrity.ts scan (same engine as GET /:brandId/integrity).
 * Findings attach structured `data`; UIs never parse message text.
 *
 * Severity: dangling refs / ghost-brand tasks / currently-deferring tasks /
 * invalid manifests → warn; stale drafts alone → ok with a nudge in data.
 */
import type { HealthCheckResult, PluginContext } from '@bakin/core/plugin-types'
import { healthOk as ok, healthWarn as warn } from '@makinbakin/sdk/utils'
import { scanBrandIntegrity } from './integrity'
import { getBrand, listBrands } from './store'

const CHECK = 'brands.integrity'

export async function checkBrandsIntegrity(ctx: PluginContext): Promise<HealthCheckResult> {
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
  const data = {
    brands: listBrands().brands.length,
    dangling: dangling.map((f) => ({ brandId: f.brandId, refs: f.dangling })),
    invalid: report.invalid,
    ghostTasks,
    staleDrafts,
  }

  const problems: string[] = []
  if (dangling.length) problems.push(`${dangling.length} brand(s) with dangling asset refs`)
  if (report.invalid.length) problems.push(`${report.invalid.length} unreadable brand manifest(s)`)
  if (ghostTasks.length) problems.push(`${ghostTasks.length} task(s) waiting on a missing/draft brand`)

  if (problems.length) {
    const result = warn(CHECK, `Brand integrity: ${problems.join('; ')}.`)
    return { ...result, data }
  }
  const message = staleDrafts.length
    ? `Brands healthy; ${staleDrafts.length} draft(s) older than 7 days await review/publish.`
    : 'Brands healthy — no dangling refs, ghost-brand tasks, or invalid manifests.'
  const result = ok(CHECK, message)
  return { ...result, data }
}
