/**
 * Search reindex and reset as operations (#895 D15). Both hold
 * `search-engine`, are not cancellable, and report the tables they rebuild
 * as concurrent items: an identical request attaches to the running
 * operation, and anything else (another reindex, a reset, an engine install,
 * a background migration pass) waits for it, visibly.
 *
 * Reset is the one-command clean slate for a corrupted or wedged engine:
 * stop → wipe DERIVED data (indexes only — models and source content are
 * untouched) → start clean → repair reindex, as stages of one operation.
 * The sequence was assembled by hand across eight recovery steps in the
 * 2026-07-21 field incident; the verb exists so nobody does that again.
 */
import { ENGINE_RESET_STAGES } from '@bakin/core/adapters/search'
import {
  OperationRejectedError,
  type OperationContext,
  type OperationOrigin,
  type OperationOutcome,
  type OperationPlan,
  type OperationStagePlan,
  type StartOperationInput,
} from '@bakin/core/operations'
import { createLogger } from './logger'
import { getSearchAdapterSetup } from './search-adapter-factory'
import { rebuildRegisteredTables, type ReindexTableOutcome } from './search-registry'
import { getSettings } from './settings'

const log = createLogger('search-operations')

/**
 * A table backfill can run for minutes between measurable steps (a table
 * finishing is the progress signal), and a frozen converge parks within a
 * minute on its own — so the default building row (30s/120s) would call a
 * healthy rebuild stuck.
 */
const REINDEX_STAGE: OperationStagePlan = {
  id: 'reindex',
  kind: 'building',
  label: 'Rebuild search tables',
  quiet: { quietMs: 60_000, stuckMs: 10 * 60_000 },
}

export const REINDEX_PLAN: OperationPlan = { stages: [REINDEX_STAGE], pointOfNoReturn: 'start' }
export const SEARCH_RESET_PLAN: OperationPlan = { stages: [...ENGINE_RESET_STAGES, REINDEX_STAGE], pointOfNoReturn: 'start' }

/** A reindex's result — the body `POST /api/reindex` answers. */
export interface ReindexReport {
  ok: boolean
  errors: number
  parked: number
  total: number
  tables: ReindexTableOutcome[]
}

/** A reset's result — the body `POST /api/search/reset` answers. */
export interface SearchResetResult {
  ok: boolean
  message: string
  /** The repair reindex that follows a successful wipe. */
  reindex: ReindexReport | null
}

export function summarizeReindex(tables: ReindexTableOutcome[]): ReindexReport {
  const errors = tables.filter((t) => t.error).length
  const parked = tables.filter((t) => t.result === 'parked').length
  return { ok: errors === 0 && parked === 0, errors, parked, total: tables.reduce((sum, t) => sum + (t.indexed ?? 0), 0), tables }
}

function describeUnconverged(report: ReindexReport): string {
  const parts = [report.errors > 0 ? `${report.errors} failed` : null, report.parked > 0 ? `${report.parked} parked` : null].filter(Boolean)
  return `${parts.join(', ')} of ${report.tables.length} tables — queries keep answering from the current tables; \`bakin doctor\` resumes parked work`
}

async function runReindex(op: OperationContext, table: string | undefined, force: boolean): Promise<ReindexReport> {
  op.stage('reindex')
  return summarizeReindex(await rebuildRegisteredTables(table, { force }, { op, stageId: 'reindex' }))
}

/**
 * Default is REPAIR (resume parked, regenerate engine-missing, migrate
 * drifted, skip healthy); `force` mints fresh generations. Blue/green either
 * way: queries answer from the old physical until the pointer flips.
 */
export function reindexOperation(input: { table?: string; force?: boolean; origin: OperationOrigin }): StartOperationInput<ReindexReport> {
  const force = input.force === true
  return {
    kind: 'search:reindex',
    owner: 'core',
    origin: input.origin,
    title: input.table ? `Reindex ${input.table}` : 'Reindex search',
    href: '/health',
    fingerprint: `search:reindex:${input.table ?? 'all'}:${force ? 'force' : 'repair'}`,
    resources: ['search-engine'],
    plan: REINDEX_PLAN,
    run: async (op): Promise<OperationOutcome<ReindexReport>> => {
      const report = await runReindex(op, input.table, force)
      return report.ok
        ? { status: 'succeeded', code: 'ok', httpStatus: 200, body: report }
        : { status: 'failed', code: 'tables_parked', message: describeUnconverged(report), httpStatus: 200, body: report }
    },
  }
}

/** Refusals answer 409 with today's `{ ok: false, message }` body, before anything starts. */
function resetRefusal(): string | null {
  const settings = getSettings()
  if (!settings.search.settings.enabled) return 'Search is disabled in settings — enable it before resetting.'
  if (!getSearchAdapterSetup(settings.search.adapter, undefined, settings.search.settings).resetEngineData) {
    return `The '${settings.search.adapter}' search adapter does not support engine reset.`
  }
  return null
}

export function searchResetOperation(origin: OperationOrigin): StartOperationInput<SearchResetResult> {
  return {
    kind: 'search:reset',
    owner: 'core',
    origin,
    title: 'Reset the search engine',
    href: '/health',
    fingerprint: 'search:reset',
    resources: ['search-engine'],
    plan: SEARCH_RESET_PLAN,
    validate: () => {
      const refusal = resetRefusal()
      if (refusal) throw new OperationRejectedError(409, { ok: false, message: refusal, reindex: null } satisfies SearchResetResult)
    },
    run: async (op): Promise<OperationOutcome<SearchResetResult>> => {
      const settings = getSettings()
      const setup = getSearchAdapterSetup(settings.search.adapter, undefined, settings.search.settings)
      log.warn('search engine reset requested — wiping derived engine data and rebuilding')
      const reset = await setup.resetEngineData!(op)
      if (reset.status !== 'installed') {
        return { status: 'failed', code: 'reset_failed', message: reset.message, httpStatus: 200, body: { ok: false, message: reset.message, reindex: null } }
      }
      // Repair-by-default: every registry row whose physical vanished with
      // the wipe regenerates, table by table in product-priority order.
      const reindex = await runReindex(op, undefined, false)
      if (!reindex.ok) {
        const message = `${reset.message} The rebuild did not converge: ${describeUnconverged(reindex)}.`
        return { status: 'failed', code: 'tables_parked', message, httpStatus: 200, body: { ok: false, message, reindex } }
      }
      return { status: 'succeeded', code: 'ok', httpStatus: 200, body: { ok: true, message: reset.message, reindex } }
    },
  }
}
