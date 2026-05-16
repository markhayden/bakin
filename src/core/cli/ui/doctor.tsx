import { Box, Text } from 'ink'
import { Report, type ReportRow } from './report'

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

function doctorStatus(status: string): ReportRow['status'] {
  switch (status) {
    case 'ok':
      return 'complete'
    case 'fixed':
      return 'complete'
    case 'warn':
      return 'warning'
    case 'error':
      return 'failed'
    default:
      return 'checking'
  }
}

export function DoctorReport({ results, summary }: {
  results: DoctorResultRow[]
  summary: DoctorSummaryData
}) {
  return (
    <Box flexDirection="column">
      <Report
        title="Bakin doctor"
        groups={[
          {
            title: 'Health checks',
            rows: results.map(result => ({
              label: result.check,
              status: doctorStatus(result.status),
              message: result.message,
            })),
          },
        ]}
      />
      <Box marginTop={1}>
        {summary.errors > 0 ? (
          <Text color="red">{summary.errors} errors, {summary.warnings} warnings out of {summary.total} checks</Text>
        ) : summary.warnings > 0 ? (
          <Text color="yellow">{summary.warnings} warnings out of {summary.total} checks</Text>
        ) : (
          <Text color="green">All {summary.total} checks passed</Text>
        )}
      </Box>
    </Box>
  )
}
