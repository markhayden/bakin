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

export interface SearchStatsTableData {
  table?: unknown
  pluginId?: unknown
  stats?: unknown
  indexHealth?: unknown
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

function searchIndexHealth(value: unknown): Array<{ name?: unknown; error?: unknown; walBacklog?: unknown; rebuilding?: unknown }> {
  return Array.isArray(value) ? value : []
}

function searchStatsDocCount(stats: unknown): string {
  return valueText(
    objectField(stats, 'documents') ?? objectField(stats, 'num_docs') ?? objectField(stats, 'documentCount'),
    '?',
  )
}

function searchStatsStatus(table: SearchStatsTableData, enabled: boolean): TuiStatus {
  if (!enabled) return 'skip'
  const health = searchIndexHealth(table.indexHealth)
  if (table.healthy === false || health.some(index => valueText(index.error, '') !== '')) return 'fail'
  if (health.some(index => numberValue(index.walBacklog) > 0 || index.rebuilding === true)) return 'run'
  return 'ok'
}

function searchStatsHealth(table: SearchStatsTableData, enabled: boolean): string {
  if (!enabled) return 'disabled'
  const health = searchIndexHealth(table.indexHealth)
  if (table.healthy === false || health.some(index => valueText(index.error, '') !== '')) return 'unhealthy'
  if (health.some(index => numberValue(index.walBacklog) > 0 || index.rebuilding === true)) return 'enriching'
  return 'healthy'
}

function searchStatsTableRows(tables: SearchStatsTableData[], enabled: boolean): SearchStatsTableRow[] {
  return tables.map(table => ({
    status: searchStatsStatus(table, enabled),
    table: valueText(table.table),
    plugin: valueText(table.pluginId),
    docs: searchStatsDocCount(table.stats),
    health: searchStatsHealth(table, enabled),
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

export function SearchStatsReport({ enabled, tables, color = true }: {
  enabled: boolean
  tables: SearchStatsTableData[]
  color?: boolean
}) {
  const rows = searchStatsTableRows(tables, enabled)
  const unhealthy = rows.filter(row => row.status === 'fail').length
  const enriching = rows.filter(row => row.status === 'run').length

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Search Stats" subtitle="Search index health and document counts" color={color} />
      <SummaryStrip items={[
        { label: enabled ? 'enabled' : 'disabled', value: 'search', status: enabled ? 'ok' : 'skip' },
        { label: plural(rows.length, 'table'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
        { label: 'unhealthy', value: unhealthy, status: unhealthy > 0 ? 'fail' : 'ok' },
        { label: 'enriching', value: enriching, status: enriching > 0 ? 'run' : 'ok' },
      ]} color={color} />
      <Section title="Tables" color={color}>
        {rows.length > 0 ? (
          <StatusTable
            rows={rows}
            columns={[
              { key: 'table', header: 'TABLE', width: 24, grow: true, render: row => row.table },
              { key: 'plugin', header: 'PLUGIN', width: 16, render: row => row.plugin },
              { key: 'docs', header: 'DOCS', width: 8, render: row => row.docs },
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
