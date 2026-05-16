import { Box, Text } from 'ink'

export interface TableColumn<TRow> {
  key: string
  header: string
  render: (row: TRow) => string
}

export interface TableProps<TRow> {
  columns: Array<TableColumn<TRow>>
  rows: TRow[]
  empty?: string
}

export function computeColumnWidths<TRow>(columns: Array<TableColumn<TRow>>, rows: TRow[]): number[] {
  return columns.map(column => Math.max(
    column.header.length,
    ...rows.map(row => column.render(row).length),
  ))
}

export function Table<TRow>({ columns, rows, empty = '(none)' }: TableProps<TRow>) {
  if (rows.length === 0) return <Text dimColor>{empty}</Text>

  const widths = computeColumnWidths(columns, rows)
  const header = columns.map((column, index) => column.header.padEnd(widths[index])).join('  ')

  return (
    <Box flexDirection="column">
      <Text bold>{header}</Text>
      {rows.map((row, rowIndex) => (
        <Text key={rowIndex}>
          {columns.map((column, colIndex) => column.render(row).padEnd(widths[colIndex])).join('  ')}
        </Text>
      ))}
    </Box>
  )
}
