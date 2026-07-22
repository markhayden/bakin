import { Box } from 'ink'
import { DataTable, FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, numberValue, objectField, plural } from './format'

export interface SearchResultData {
  id?: unknown
  key?: unknown
  table?: unknown
  score?: unknown
  _table?: unknown
  fields?: unknown
  document?: unknown
}

export interface SearchAggregationBucketData {
  value?: unknown
  count?: unknown
}

export type SearchAggregationsData = Record<string, SearchAggregationBucketData[]>

export interface SearchMetaData {
  query?: unknown
  total?: unknown
  took_ms?: unknown
  source?: unknown
}

/** Row shape = SearchHealthTable from /api/plugins/health/search-status.
 *  The old table/stats/indexHealth fields never existed on that route —
 *  the TTY view rendered "-" names and "?" docs for perfectly healthy
 *  tables while the piped view told the truth (field-confirmed 2026-07-21). */
export interface SearchStatsTableData {
  logical?: unknown
  pluginId?: unknown
  docCount?: unknown
  journalPending?: unknown
  state?: unknown
  phase?: unknown
  legs?: unknown
  healthy?: unknown
}

export interface ReindexTableData {
  table?: unknown
  indexed?: unknown
  result?: unknown
  error?: unknown
}

export interface ReindexResultData {
  ok?: unknown
  total?: unknown
  errors?: unknown
  parked?: unknown
  tables?: ReindexTableData[]
}

interface SearchResultTableRow {
  title: string
  table: string
  score: string
  key: string
}

interface SearchStatsTableRow {
  status: TuiStatus
  table: string
  plugin: string
  docs: string
  backlog: string
  health: string
}

interface ReindexTableRow {
  status: TuiStatus
  table: string
  docs: string
  outcome: string
  issue: string
}

function searchTableName(value: unknown): string {
  return valueText(value).replace(/^bakin_/, '')
}

function searchScoreText(value: unknown): string {
  const score = typeof value === 'number' && Number.isFinite(value) ? value : Number(value)
  return Number.isFinite(score) ? score.toFixed(3) : valueText(value, '?')
}

function searchResultTitle(result: SearchResultData): string {
  const document = result.fields ?? result.document
  const title = objectField(document, 'title') ?? objectField(document, 'name')
  return valueText(title, valueText(result.id ?? result.key, '(untitled result)'))
}

function searchResultTableRows(results: SearchResultData[]): SearchResultTableRow[] {
  return results.map(result => ({
    title: searchResultTitle(result),
    table: searchTableName(result.table ?? result._table),
    score: searchScoreText(result.score),
    key: valueText(result.id ?? result.key),
  }))
}

function searchFacetRows(aggregations: SearchAggregationsData = {}): Array<{ status: TuiStatus; label: string; message: string }> {
  return Object.entries(aggregations).map(([facet, values]) => ({
    status: values.length > 0 ? 'ok' : 'skip',
    label: facet,
    message: values.length > 0
      ? values.map(value => `${valueText(value.value)}(${valueText(value.count, '0')})`).join(', ')
      : 'none',
  }))
}

function searchStatsLegs(value: unknown): Array<{ name?: unknown; error?: unknown; pending?: unknown; rebuilding?: unknown }> {
  return Array.isArray(value) ? value : []
}

function searchStatsBacklog(table: SearchStatsTableData): { queued: number; embedding: number } {
  const embedding = searchStatsLegs(table.legs).reduce((sum, leg) => sum + numberValue(leg.pending), 0)
  return { queued: numberValue(table.journalPending), embedding }
}

function searchStatsStatus(table: SearchStatsTableData, enabled: boolean, reachable: boolean): TuiStatus {
  if (!enabled) return 'skip'
  if (!reachable) return 'warn'
  const legs = searchStatsLegs(table.legs)
  if (table.healthy === false || legs.some(leg => valueText(leg.error, '') !== '')) return 'fail'
  if (valueText(table.state) === 'migrating' && valueText(table.phase) === 'parked') return 'fail'
  if (valueText(table.state) === 'migrating') return 'run'
  const backlog = searchStatsBacklog(table)
  if (backlog.queued > 0 || backlog.embedding > 0 || legs.some(leg => leg.rebuilding === true)) return 'run'
  return 'ok'
}

function searchStatsHealth(table: SearchStatsTableData, enabled: boolean, reachable: boolean): string {
  if (!enabled) return 'disabled'
  if (!reachable) return 'unreachable'
  const legs = searchStatsLegs(table.legs)
  if (table.healthy === false || legs.some(leg => valueText(leg.error, '') !== '')) return 'unhealthy'
  if (valueText(table.state) === 'migrating' && valueText(table.phase) === 'parked') return 'parked'
  if (valueText(table.state) === 'migrating') return 'migrating'
  const backlog = searchStatsBacklog(table)
  if (backlog.queued > 0 || backlog.embedding > 0 || legs.some(leg => leg.rebuilding === true)) return 'enriching'
  return 'healthy'
}

function searchStatsBacklogText(table: SearchStatsTableData): string {
  const backlog = searchStatsBacklog(table)
  const parts = [
    backlog.queued > 0 ? `${backlog.queued} queued` : '',
    backlog.embedding > 0 ? `${backlog.embedding} embedding` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function searchStatsTableRows(tables: SearchStatsTableData[], enabled: boolean, reachable: boolean): SearchStatsTableRow[] {
  return tables.map(table => ({
    status: searchStatsStatus(table, enabled, reachable),
    table: searchTableName(table.logical),
    plugin: valueText(table.pluginId),
    docs: valueText(table.docCount, '?'),
    backlog: searchStatsBacklogText(table),
    health: searchStatsHealth(table, enabled, reachable),
  }))
}

function reindexTableRows(tables: ReindexTableData[]): ReindexTableRow[] {
  return tables.map(table => {
    const hasError = Boolean(table.error)
    const parked = table.result === 'parked'
    return {
      status: hasError ? 'fail' : parked ? 'warn' : 'ok',
      table: valueText(table.table, '(unknown)'),
      docs: valueText(table.indexed, '0'),
      outcome: valueText(table.result),
      // NEVER through valueText's '-' fallback here: the truthy '-' made
      // the parked text unreachable (review finding).
      issue: hasError ? valueText(table.error) : parked ? 'parked — green never converged' : '',
    }
  })
}

export function SearchResultsReport({ query, results, aggregations = {}, meta, color = true }: {
  query: string
  results: SearchResultData[]
  aggregations?: SearchAggregationsData
  meta?: SearchMetaData
  color?: boolean
}) {
  const rows = searchResultTableRows(results)
  const facets = searchFacetRows(aggregations)
  const total = numberValue(meta?.total ?? rows.length)
  const took = meta?.took_ms === undefined ? undefined : `${numberValue(meta.took_ms)}ms`
  const source = valueText(meta?.source, 'unknown')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Search" subtitle={valueText(meta?.query, query)} meta={`source: ${source}`} color={color} />
      <SummaryStrip items={[
        { label: 'total', value: total, status: total > 0 ? 'ok' : 'skip' },
        { label: 'returned', value: rows.length, status: rows.length > 0 ? 'ready' : 'skip' },
        ...(took ? [{ label: 'elapsed', value: took }] : []),
      ]} color={color} />
      <Section title="Results" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'title', header: 'TITLE', width: 42, grow: true, render: row => row.title },
              { key: 'table', header: 'TABLE', width: 16, render: row => row.table },
              { key: 'score', header: 'SCORE', width: 8, render: row => row.score },
              { key: 'key', header: 'KEY', width: 24, render: row => row.key },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No results found.' }]} color={color} />
        )}
      </Section>
      {facets.length > 0 ? (
        <Section title="Facets" color={color}>
          <FindingRows rows={facets} color={color} />
        </Section>
      ) : null}
    </Box>
  )
}

export function SearchStatsReport({ enabled, engineReachable, outbox, tables, color = true }: {
  enabled: boolean
  engineReachable?: boolean
  outbox?: { pending?: unknown; quarantined?: unknown }
  tables: SearchStatsTableData[]
  color?: boolean
}) {
  const reachable = engineReachable !== false
  const rows = searchStatsTableRows(tables, enabled, reachable)
  const unhealthy = rows.filter(row => row.status === 'fail').length
  const enriching = rows.filter(row => row.status === 'run').length
  const journalPending = numberValue(outbox?.pending)
  const quarantined = numberValue(outbox?.quarantined)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Search Stats" subtitle="Search index health and document counts" color={color} />
      <SummaryStrip items={[
        { label: enabled ? 'enabled' : 'disabled', value: 'search', status: enabled ? 'ok' : 'skip' },
        // "disabled" and "unreachable" are DIFFERENT failures with different
        // fixes — never let one masquerade as the other (2026-07-21 field
        // incident: a crash-looping engine reported "search disabled").
        ...(enabled && !reachable ? [{ label: 'engine', value: 'unreachable', status: 'fail' as TuiStatus }] : []),
        { label: plural(rows.length, 'table'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'unhealthy', value: unhealthy, status: unhealthy > 0 ? 'fail' as TuiStatus : 'ok' as TuiStatus },
        { label: 'enriching', value: enriching, status: enriching > 0 ? 'run' as TuiStatus : 'ok' as TuiStatus },
        ...(journalPending > 0 || quarantined > 0
          ? [{ label: 'journal', value: `${journalPending} pending${quarantined > 0 ? ` · ${quarantined} quarantined` : ''}`, status: quarantined > 0 ? 'fail' as TuiStatus : 'run' as TuiStatus }]
          : []),
      ]} color={color} />
      <Section title="Tables" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'table', header: 'TABLE', width: 22, grow: true, render: row => row.table },
              { key: 'plugin', header: 'PLUGIN', width: 12, render: row => row.plugin },
              { key: 'docs', header: 'DOCS', width: 7, render: row => row.docs },
              { key: 'backlog', header: 'BACKLOG', width: 22, render: row => row.backlog },
              { key: 'health', header: 'HEALTH', width: 12, render: row => row.health },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No search tables are registered.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function ReindexReport({ result, target = 'all content', rebuild = false, color = true }: {
  result: ReindexResultData
  target?: string
  rebuild?: boolean
  color?: boolean
}) {
  const rows = reindexTableRows(result.tables ?? [])
  const total = numberValue(result.total)
  const errors = numberValue(result.errors)
  const parked = numberValue(result.parked)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Reindex"
        subtitle={rebuild ? 'Search content indexed with rebuilt indexes' : 'Search content indexed'}
        meta={`target: ${target}`}
        color={color}
      />
      <SummaryStrip items={[
        { label: plural(total, 'document'), value: total, status: total > 0 ? 'ok' : 'skip' },
        { label: plural(rows.length, 'table'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'errors', value: errors, status: errors > 0 ? 'fail' : 'ok' },
        { label: 'parked', value: parked, status: parked > 0 ? 'warn' : 'ok' },
      ]} color={color} />
      <Section title="Tables" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'table', header: 'TABLE', width: 16, render: row => row.table },
              { key: 'docs', header: 'DOCS', width: 6, render: row => row.docs },
              { key: 'outcome', header: 'OUTCOME', width: 12, render: row => row.outcome },
              { key: 'issue', header: 'ISSUE', width: 24, grow: true, render: row => row.issue },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No reindex table results returned.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}
