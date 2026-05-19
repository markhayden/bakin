import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { APP_VERSION } from '../../../../packages/core/src/constants'
import { CLI_COLORS, statusToken, type TuiStatus } from './style-tokens'

const BAKIN_HEADER_TITLE = "🐷 Bakin'"
const BAKIN_HEADER_VERSION = `(v${APP_VERSION})`
const BAKIN_HEADER_WIDTH = Math.max(
  38,
  BAKIN_HEADER_TITLE.length + BAKIN_HEADER_VERSION.length + 6,
)

export const BAKIN_HEADER = [
  `┏${'━'.repeat(BAKIN_HEADER_WIDTH)}┓`,
  `┃${` ${BAKIN_HEADER_TITLE}`.padEnd(BAKIN_HEADER_WIDTH - BAKIN_HEADER_VERSION.length - 1)}${BAKIN_HEADER_VERSION} ┃`,
  `┗${'━'.repeat(BAKIN_HEADER_WIDTH)}┛`,
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
  grow?: boolean
  render: (row: TRow) => string
}

export function BakinHeader({ color = true }: { color?: boolean } = {}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      {BAKIN_HEADER.map(line => (
        <Text key={line} bold color={color ? 'white' : undefined}>{line}</Text>
      ))}
      <Text> </Text>
    </Box>
  )
}

export function ScreenHeader({ title, subtitle, meta, color = true, showBrand = true }: {
  title: string
  subtitle?: string
  meta?: string
  color?: boolean
  showBrand?: boolean
}) {
  return (
    <Box flexDirection="column">
      {showBrand ? <BakinHeader color={color} /> : null}
      <Box>
        <Text bold>{title}</Text>
        {meta ? <Text dimColor>  {meta}</Text> : null}
      </Box>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
    </Box>
  )
}

export function Section({ title, children, marginTop = 1, color = true }: {
  title: string
  children: ReactNode
  marginTop?: number
  color?: boolean
}) {
  const divider = '-'.repeat(Math.max(12, title.length + 4))

  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Text bold color={color ? 'white' : undefined}>{title.toUpperCase()}</Text>
      <Text bold color={color ? 'white' : undefined}>{divider}</Text>
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

export function SummaryStrip({ items, color = true }: { items: SummaryItem[]; color?: boolean }) {
  return (
    <Box marginTop={1} gap={2} flexWrap="wrap">
      {items.map(item => (
        <Box key={item.label}>
          {item.status ? <StatusToken status={item.status} color={color} /> : null}
          <Text bold>{item.status ? ' ' : ''}{item.value}</Text>
          <Text dimColor> {item.label}</Text>
        </Box>
      ))}
    </Box>
  )
}

export function FindingRows({ rows, color = true }: { rows: FindingRow[]; color?: boolean }) {
  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Box key={`${row.label}-${row.message}`} flexDirection="column">
          <Box gap={1}>
            <Box width={10} flexShrink={0}>
              <StatusToken status={row.status} color={color} />
            </Box>
            <Box width={22} flexShrink={0}>
              <Text wrap="truncate-end">{row.label}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{row.message}</Text>
            </Box>
          </Box>
          {row.detail ? (
            <FindingRowContinuation>
              <Text dimColor wrap="wrap">{row.detail}</Text>
            </FindingRowContinuation>
          ) : null}
          {row.next ? (
            <FindingRowContinuation>
              <Text color={color ? CLI_COLORS.info : undefined} wrap="wrap">Next: {row.next}</Text>
            </FindingRowContinuation>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}

function FindingRowContinuation({ children }: { children: ReactNode }) {
  return (
    <Box gap={1}>
      <Box width={10} flexShrink={0}>
        <Text> </Text>
      </Box>
      <Box width={22} flexShrink={0}>
        <Text> </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        {children}
      </Box>
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
          <Box
            key={column.key}
            width={column.width}
            flexGrow={column.grow ? 1 : 0}
            flexShrink={column.grow ? 1 : 0}
          >
            <Text bold wrap="truncate-end">{column.header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} gap={1}>
          {columns.map(column => (
            <Box
              key={column.key}
              width={column.width}
              flexGrow={column.grow ? 1 : 0}
              flexShrink={column.grow ? 1 : 0}
            >
              <Text wrap={column.grow ? 'wrap' : 'truncate-end'}>{column.render(row)}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Text> </Text>
    </Box>
  )
}

export function StatusTable<TRow extends { status: TuiStatus }>({ columns, rows, color = true }: {
  columns: Array<TableColumn<TRow>>
  rows: TRow[]
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Box width={10} flexShrink={0}>
          <Text bold>STATUS</Text>
        </Box>
        {columns.map(column => (
          <Box
            key={column.key}
            width={column.width}
            flexGrow={column.grow ? 1 : 0}
            flexShrink={column.grow ? 1 : 0}
          >
            <Text bold wrap="truncate-end">{column.header}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} gap={1}>
          <Box width={10} flexShrink={0}>
            <StatusToken status={row.status} color={color} />
          </Box>
          {columns.map(column => (
            <Box
              key={column.key}
              width={column.width}
              flexGrow={column.grow ? 1 : 0}
              flexShrink={column.grow ? 1 : 0}
            >
              <Text wrap={column.grow ? 'wrap' : 'truncate-end'}>{column.render(row)}</Text>
            </Box>
          ))}
        </Box>
      ))}
      <Text> </Text>
    </Box>
  )
}

export function NextActions({ actions, color = true }: { actions: string[]; color?: boolean }) {
  return (
    <Section title="Next" marginTop={1} color={color}>
      {actions.map(action => (
        <Box key={action}>
          <Box width={2} flexShrink={0}>
            <Text color={color ? CLI_COLORS.info : undefined}>-</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">{action}</Text>
          </Box>
        </Box>
      ))}
      <Text> </Text>
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
