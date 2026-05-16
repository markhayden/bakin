import { Text } from 'ink'

export type CliStatus = 'ready' | 'checking' | 'installing' | 'blocked' | 'warning' | 'failed' | 'complete' | 'skipped'

const STATUS_LABELS: Record<CliStatus, string> = {
  ready: 'READY',
  checking: 'CHECK',
  installing: 'INSTALL',
  blocked: 'BLOCKED',
  warning: 'WARN',
  failed: 'FAIL',
  complete: 'OK',
  skipped: 'SKIP',
}

const STATUS_COLORS: Record<CliStatus, string> = {
  ready: 'cyan',
  checking: 'blue',
  installing: 'blue',
  blocked: 'red',
  warning: 'yellow',
  failed: 'red',
  complete: 'green',
  skipped: 'gray',
}

export interface StatusBadgeProps {
  status: CliStatus
  color?: boolean
}

export function statusLabel(status: CliStatus): string {
  return STATUS_LABELS[status]
}

export function StatusBadge({ status, color = true }: StatusBadgeProps) {
  return <Text color={color ? STATUS_COLORS[status] : undefined}>[{STATUS_LABELS[status]}]</Text>
}
