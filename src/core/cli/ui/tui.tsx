import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { CLI_COLORS, statusToken, type TuiStatus } from './style-tokens'

export const BAKIN_HEADER = [
  "┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓",
  "┃  🐷 Bakin'                  (v1.0.0) ┃",
  "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
] as const

export interface FindingRow {
  status: TuiStatus
  label: string
  message: string
  detail?: string
  next?: string
}

export interface SummaryItem {
  label: string
  value: string | number
  status?: TuiStatus
}

export interface TableColumn<TRow> {
  key: string
  header: string
  width: number
  render: (row: TRow) => string
}

export function BakinHeader() {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      {BAKIN_HEADER.map(line => (
        <Text key={line} bold color="white">{line}</Text>
      ))}
      <Text> </Text>
    </Box>
  )
}

export function ScreenHeader({ title, subtitle, meta }: {
  title: string
  subtitle?: string
  meta?: string
}) {
  return (
    <Box flexDirection="column">
      <BakinHeader />
      <Box>
        <Text bold>{title}</Text>
        {meta ? <Text dimColor>  {meta}</Text> : null}
      </Box>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
    </Box>
  )
}

export function Section({ title, children, marginTop = 1 }: {
  title: string
  children: ReactNode
  marginTop?: number
}) {
  const divider = '-'.repeat(Math.max(12, title.length + 4))

  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Text bold color="white">{title.toUpperCase()}</Text>
      <Text bold color="white">{divider}</Text>
      <Box flexDirection="column">
        {children}
      </Box>
    </Box>
  )
}

export function StatusToken({ status, color = true }: {
  status: TuiStatus
  color?: boolean
}) {
  const token = statusToken(status)
  const label = ` ${token.label.padEnd(7)} `
  return (
    <Text
      bold
      color={color ? token.foreground : undefined}
      backgroundColor={color ? token.color : undefined}
    >
      {label}
    </Text>
  )
}

export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <Box marginTop={1} gap={2} flexWrap="wrap">
      {items.map(item => (
        <Box key={item.label}>
          {item.status ? <StatusToken status={item.status} /> : null}
          <Text bold>{item.status ? ' ' : ''}{item.value}</Text>
          <Text dimColor> {item.label}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function FindingRows({ rows }: { rows: FindingRow[] }) {
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Box key={`${row.label}-${row.message}`} flexDirection="column">
          <Box gap={1}>
            <Box width={10} flexShrink={0}>
              <StatusToken status={row.status} />
            </Box>
            <Box width={22} flexShrink={0}>
              <Text wrap="truncate-end">{row.label}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{row.message}</Text>
            </Box>
          </Box>
          {row.detail ? (
            <Box marginLeft={33}>
              <Text dimColor wrap="wrap">{row.detail}</Text>
            </Box>
          ) : null}
          {row.next ? (
            <Box marginLeft={33}>
              <Text color={CLI_COLORS.info} wrap="wrap">Next: {row.next}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

export function DataTable<TRow>({ columns, rows }: {
  columns: Array<TableColumn<TRow>>
  rows: TRow[]
}) {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        {columns.map(column => (
          <Box key={column.key} width={column.width} flexShrink={0}>
            <Text bold wrap="truncate-end">{column.header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} gap={1}>
          {columns.map(column => (
            <Box key={column.key} width={column.width} flexShrink={0}>
              <Text wrap="truncate-end">{column.render(row)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export function NextActions({ actions }: { actions: string[] }) {
  return (
    <Section title="Next" marginTop={1}>
      {actions.map(action => (
        <Box key={action}>
          <Text color={CLI_COLORS.info}>- </Text>
          <Text wrap="wrap">{action}</Text>
        </Box>
      ))}
    </Section>
  )
}

export function ProgressMeter({ label, current, total, percent }: {
  label: string
  current: number
  total: number
  percent: number
}) {
  const width = 30
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{label}</Text>
        <Text dimColor>  {current}/{total} steps  {percent}%</Text>
      </Box>
      <Text color={CLI_COLORS.info}>{bar}</Text>
    </Box>
  )
}
