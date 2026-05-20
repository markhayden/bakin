import { Box, Text } from 'ink'
import type { CliEnvelope } from '../result'
import type { TuiStatus } from './style-tokens'
import { FindingRows, ScreenHeader, Section, SummaryStrip, type SummaryItem } from './tui'

function envelopeStatus(envelope: CliEnvelope): TuiStatus {
  if (!envelope.ok) return 'fail'
  return envelope.exitCode === 2 ? 'warn' : 'ok'
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
  const status = envelopeStatus(envelope)
  const preview = dataPreview(envelope.data)
  const summary: SummaryItem[] = [
    { label: 'exit code', value: envelope.exitCode, status },
  ]
  if (envelope.error) summary.push({ label: 'code', value: envelope.error.code })

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title={envelope.error ? 'Command failed' : envelope.command}
        subtitle={envelope.error?.message}
        meta={envelope.error ? envelope.command : undefined}
        color={color}
      />
      <SummaryStrip items={summary} color={color} />
      {envelope.error ? (
        <Section title="Problem" color={color}>
          <FindingRows
            color={color}
            rows={[{
              status: 'fail',
              label: envelope.command,
              message: envelope.error.message,
              detail: `Code: ${envelope.error.code}`,
            }]}
          />
        </Section>
      ) : null}
      {preview.length > 0 ? (
        <Section title="Data" color={color}>
          {preview.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Section>
      ) : null}
    </Box>
  )
}
