import { Box } from 'ink'
import type { TuiStatus } from './style-tokens'
import {
  FindingRows,
  NextActions,
  ScreenHeader,
  Section,
  SummaryStrip,
  type FindingRow,
  type SummaryItem,
} from './tui'

export interface DoctorResultRow {
  check: string
  status: string
  message: string
}

export interface DoctorSummaryData {
  total: number
  errors: number
  warnings: number
}

export type DoctorMode = 'offline' | 'full'

function isSkippedDoctorResult(result: DoctorResultRow): boolean {
  return result.status === 'skip' || /^Skipped\b/i.test(result.message)
}

function doctorStatus(result: DoctorResultRow): TuiStatus {
  if (isSkippedDoctorResult(result)) return 'skip'

  switch (result.status) {
    case 'ok':
      return 'ok'
    case 'fixed':
      return 'applied'
    case 'warn':
      return 'warn'
    case 'error':
      return 'fail'
    default:
      return 'run'
  }
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return count === 1 ? singular : pluralLabel
}

function doctorCounts(results: DoctorResultRow[], summary: DoctorSummaryData): {
  skipped: number
  warnings: number
  fixed: number
} {
  const skipped = results.filter(isSkippedDoctorResult).length
  return {
    skipped,
    warnings: Math.max(0, summary.warnings - skipped),
    fixed: results.filter(result => result.status === 'fixed').length,
  }
}

function summaryItems(results: DoctorResultRow[], summary: DoctorSummaryData): SummaryItem[] {
  const counts = doctorCounts(results, summary)
  const items: SummaryItem[] = [
    { label: plural(summary.errors, 'error'), value: summary.errors, status: summary.errors > 0 ? 'fail' : 'ok' },
    { label: plural(counts.warnings, 'warning', 'warnings'), value: counts.warnings, status: counts.warnings > 0 ? 'warn' : 'ok' },
  ]

  if (counts.skipped > 0) {
    items.push({ label: 'skipped', value: counts.skipped, status: 'skip' })
  }

  if (counts.fixed > 0) {
    items.push({ label: 'fixed', value: counts.fixed, status: 'applied' })
  }

  items.push({ label: 'checks', value: summary.total })
  return items
}

function subtitleForMode(mode?: DoctorMode): string {
  if (mode === 'full') return 'Fresh server-backed diagnostics'
  if (mode === 'offline') return 'Offline diagnostics from this machine'
  return 'Health diagnostics'
}

function findingRows(results: DoctorResultRow[]): FindingRow[] {
  return results.map(result => ({
    status: doctorStatus(result),
    label: result.check,
    message: result.message,
  }))
}

function nextActions(results: DoctorResultRow[], summary: DoctorSummaryData, mode?: DoctorMode): string[] {
  const counts = doctorCounts(results, summary)
  const actions: string[] = []

  if (mode === 'offline' && counts.skipped > 0) {
    actions.push('Run `bakin start`, then `bakin doctor --full` to include server-backed checks.')
  }

  if (summary.errors > 0) {
    actions.push('Run `bakin doctor --fix` to preview deterministic repairs.')
  } else if (counts.warnings > 0) {
    actions.push('Run `bakin doctor --delegate` to create a board task for unresolved manual work.')
  }

  return actions
}

export function DoctorReport({ results, summary, mode, color = true }: {
  results: DoctorResultRow[]
  summary: DoctorSummaryData
  mode?: DoctorMode
  color?: boolean
}) {
  const actions = nextActions(results, summary, mode)

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title="Doctor"
        subtitle={subtitleForMode(mode)}
        meta={mode ? `mode: ${mode}` : undefined}
        color={color}
      />
      <SummaryStrip items={summaryItems(results, summary)} color={color} />
      <Section title="Health checks" color={color}>
        <FindingRows rows={findingRows(results)} color={color} />
      </Section>
      {actions.length > 0 ? <NextActions actions={actions} color={color} /> : null}
    </Box>
  )
}
