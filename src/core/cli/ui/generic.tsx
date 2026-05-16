import { Box, Text } from 'ink'
import type { CliEnvelope } from '../result'

function statusLabel(envelope: CliEnvelope): string {
  if (envelope.ok && envelope.exitCode === 2) return 'WARN'
  return envelope.ok ? 'OK' : 'FAIL'
}

function dataPreview(data: unknown): string[] {
  if (data === undefined || data === null) return []
  if (typeof data === 'string') return data.length > 0 ? [data] : []
  if (typeof data === 'number' || typeof data === 'boolean') return [String(data)]
  if (Array.isArray(data)) return data.length === 0 ? [] : JSON.stringify(data, null, 2).split('\n')
  if (typeof data === 'object') {
    const keys = Object.keys(data as Record<string, unknown>)
    if (keys.length === 0) return []
    return JSON.stringify(data, null, 2).split('\n')
  }
  return [String(data)]
}

export interface GenericResultViewProps {
  envelope: CliEnvelope
  color?: boolean
}

export function GenericResultView({ envelope, color = true }: GenericResultViewProps) {
  const label = statusLabel(envelope)
  const labelColor = envelope.ok
    ? envelope.exitCode === 2 ? 'yellow' : 'green'
    : 'red'
  const preview = dataPreview(envelope.data)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color ? labelColor : undefined}>[{label}]</Text>
        <Text> {envelope.command}</Text>
      </Box>
      {envelope.error ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>{envelope.error.message}</Text>
          <Text dimColor={color}>Code: {envelope.error.code}</Text>
        </Box>
      ) : null}
      {preview.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {preview.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
