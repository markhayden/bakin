import { Box, Text } from 'ink'
import { Badge } from '@inkjs/ui'
import { StatusBadge, type CliStatus } from './status'

export interface ReportRow {
  label: string
  status: CliStatus
  message: string
  remediation?: string
}

export interface ReportGroup {
  title: string
  rows: ReportRow[]
}

export interface ReportProps {
  title: string
  groups: ReportGroup[]
  color?: boolean
}

export function Report({ title, groups, color = true }: ReportProps) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {groups.map((group, groupIndex) => (
        <Box key={group.title} flexDirection="column" marginTop={groupIndex === 0 ? 1 : 2}>
          <Badge color={color ? 'cyan' : 'white'}>{group.title}</Badge>
          {group.rows.map((row) => (
            <Box key={row.label} flexDirection="column">
              <Box>
                <StatusBadge status={row.status} color={color} />
                <Text> {row.label.padEnd(18)} {row.message}</Text>
              </Box>
              {row.remediation ? <Text dimColor>  {row.remediation}</Text> : null}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
