/**
 * `bakin agents doctor <id>` — the combined per-agent health report (#385):
 * drift findings (live scan), context budget summary, burn/effort status,
 * and the recent activity timeline. A thin renderer over the same four
 * endpoints the web Diagnostics tab uses — no logic of its own, so the CLI
 * and the UI can never disagree.
 */
import { Box, Text } from 'ink'
import { FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip } from '../tui'
import { bytesText, plural } from './format'

export interface AgentDoctorFindingData {
  type: string
  severity: 'warn' | 'error'
  message: string
  file?: string
  target?: string
  staleInputs?: string[]
  hint?: string
}

export interface AgentDoctorEffortData {
  windowTokens: number | null
  windowCostUsdMicros: number | null
  runs: number
  tokenApplicableRuns?: number
  tokenMeteredRuns?: number
  tokenAggregateRepresentable?: boolean
  costedRuns?: number
  costAggregateRepresentable?: boolean
  completions: number
  tokensPerCompletion: number | null
  totalObservedTokens: number | null
  interactiveTokens?: number | null
  unexplainedTokens?: number | null
  flags: Array<{ kind: string; message: string }>
}

export interface AgentDoctorTimelineEventData {
  type: 'run' | 'event'
  ts: number
  // run fields
  taskTitle?: string | null
  taskId?: string
  status?: string
  settleReason?: string | null
  durationMs?: number | null
  model?: string | null
  totalTokens?: number | null
  costUsdMicros?: number | null
  // event fields
  severity?: 'info' | 'warn'
  message?: string
}

export interface AgentDoctorData {
  agentId: string
  scan: { findings: AgentDoctorFindingData[]; scannedAt: string } | null
  context: { estimatedMaxTaskBytes: number; workspaceTotalBytes: number; workspaceAvailable: boolean } | null
  effort: AgentDoctorEffortData | null
  timeline: AgentDoctorTimelineEventData[] | null
}

function tokensText(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'unavailable'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function durationText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'in flight'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${s % 60}s`
  return `${Math.floor(m / 60)}h${m % 60}m`
}

type CurrentAgentDoctorEffortData = AgentDoctorEffortData & Required<Pick<
  AgentDoctorEffortData,
  | 'tokenApplicableRuns'
  | 'tokenMeteredRuns'
  | 'tokenAggregateRepresentable'
  | 'costedRuns'
  | 'costAggregateRepresentable'
>>

function hasCurrentEffortCoverage(
  effort: AgentDoctorEffortData | null,
): effort is CurrentAgentDoctorEffortData {
  return effort !== null
    && effort.tokenApplicableRuns !== undefined
    && effort.tokenMeteredRuns !== undefined
    && effort.tokenAggregateRepresentable !== undefined
    && effort.costedRuns !== undefined
    && effort.costAggregateRepresentable !== undefined
}

export function AgentDoctorReport({ data, color = true }: { data: AgentDoctorData; color?: boolean }) {
  const findings = data.scan?.findings ?? []
  const flags = data.effort?.flags ?? []
  const driftStatus = data.scan === null ? 'skip' : findings.some((f) => f.severity === 'error') ? 'fail' : findings.length > 0 ? 'warn' : 'ok'
  const currentEffort = hasCurrentEffortCoverage(data.effort) ? data.effort : null
  const burnEvidenceComplete = currentEffort !== null && currentEffort.windowTokens !== null
  const burnStatus = !burnEvidenceComplete ? 'skip' : flags.length > 0 ? 'warn' : 'ok'
  const tokenCoverage = !currentEffort
    ? 'coverage unavailable'
    : !currentEffort.tokenAggregateRepresentable
      ? `${currentEffort.tokenMeteredRuns} of ${currentEffort.tokenApplicableRuns} token-bearing calls reported totals; combined total too large to report`
      : currentEffort.tokenMeteredRuns !== currentEffort.tokenApplicableRuns
        ? `${currentEffort.tokenMeteredRuns} of ${currentEffort.tokenApplicableRuns} token-bearing calls metered`
        : null
  const costCoverage = !currentEffort
    ? 'coverage unavailable'
    : !currentEffort.costAggregateRepresentable
      ? `${currentEffort.costedRuns} of ${currentEffort.runs} runs priced; combined cost too large to report`
      : currentEffort.costedRuns !== currentEffort.runs
        ? `${currentEffort.costedRuns} of ${currentEffort.runs} runs priced`
        : null
  const attributedText = burnEvidenceComplete
    ? `Bakin ${tokensText(currentEffort.windowTokens)} tok`
    : `Bakin tokens unavailable${tokenCoverage ? ` (${tokenCoverage})` : ''}`
  const trackedCostText = currentEffort && currentEffort.windowCostUsdMicros !== null
    ? `tracked cost $${(currentEffort.windowCostUsdMicros / 1_000_000).toFixed(4)}`
    : `tracked cost unavailable${costCoverage ? ` (${costCoverage})` : ''}`

  return (
    <Box flexDirection="column">
      <ScreenHeader
        title={`Agent doctor — ${data.agentId}`}
        subtitle="Drift, context, burn, and activity in one view (24h window)"
        color={color}
      />
      <SummaryStrip
        items={[
          { label: 'drift', value: data.scan === null ? 'unavailable' : plural(findings.length, 'finding'), status: driftStatus },
          {
            label: 'context est. max',
            value: data.context ? bytesText(data.context.estimatedMaxTaskBytes) : 'unavailable',
            status: data.context ? 'ok' : 'skip',
          },
          { label: 'burn flags', value: burnEvidenceComplete ? String(flags.length) : 'unavailable', status: burnStatus },
          {
            label: 'runs/completions',
            value: data.effort ? `${data.effort.runs}/${data.effort.completions}` : '-',
            status: 'ok',
          },
        ]}
        color={color}
      />

      <Section title={`Drift (${plural(findings.length, 'finding')})`} color={color}>
        {data.scan === null ? (
          <FindingRows rows={[{ status: 'skip', label: 'unavailable', message: 'Drift scan endpoint unreachable.' }]} color={color} />
        ) : findings.length === 0 ? (
          <FindingRows rows={[{ status: 'ok', label: 'in sync', message: 'Live files match the composed/managed state.' }]} color={color} />
        ) : (
          <FindingRows
            rows={findings.map((f) => ({
              status: f.severity === 'error' ? ('fail' as const) : ('warn' as const),
              label: f.type,
              message: `${f.file ?? f.target ?? ''} ${f.message}${f.staleInputs?.length ? ` [inputs: ${f.staleInputs.join(', ')}]` : ''}`,
            }))}
            color={color}
          />
        )}
      </Section>

      <Section title="Token burn (effort vs outcome)" color={color}>
        {data.effort === null ? (
          <FindingRows rows={[{ status: 'skip', label: 'unavailable', message: 'Effort endpoint unreachable or no activity.' }]} color={color} />
        ) : (
          <Box flexDirection="column">
            <Text>
              {`${attributedText} · ${trackedCostText} · observed ${tokensText(data.effort.totalObservedTokens)} · interactive ${tokensText(currentEffort?.interactiveTokens ?? null)} · unexplained ${tokensText(currentEffort?.unexplainedTokens ?? null)} · ${tokensText(currentEffort?.tokensPerCompletion)} tok/completion`}
            </Text>
            {!burnEvidenceComplete ? (
              <Text dimColor>Burn flags unavailable because token metering is incomplete.</Text>
            ) : flags.length > 0 ? (
              <FindingRows rows={flags.map((f) => ({ status: 'warn' as const, label: f.kind, message: f.message }))} color={color} />
            ) : (
              <Text dimColor>No burn flags in the window.</Text>
            )}
          </Box>
        )}
      </Section>

      <Section title={`Activity (${plural((data.timeline ?? []).length, 'event')}, newest first)`} color={color}>
        {data.timeline === null ? (
          <FindingRows rows={[{ status: 'skip', label: 'unavailable', message: 'Timeline endpoint unreachable.' }]} color={color} />
        ) : data.timeline.length === 0 ? (
          <FindingRows rows={[{ status: 'ok', label: 'idle', message: 'No dispatch runs or notable events in the window.' }]} color={color} />
        ) : (
          <StatusTable
            rows={data.timeline.slice(0, 20).map((e) => ({
              ...e,
              runStatus: e.status,
              // run rows carry their own `status` ('settled' etc.) — the table's
              // status column needs a TuiStatus, so it goes last to win the spread.
              status: e.type === 'event' && e.severity === 'warn' ? ('warn' as const) : ('ok' as const),
            }))}
            columns={[
              { key: 'time', header: 'TIME', width: 9, render: (row) => new Date(row.ts).toLocaleTimeString() },
              {
                key: 'what',
                header: 'WHAT',
                width: 44,
                grow: true,
                render: (row) =>
                  row.type === 'run'
                    ? `${row.taskTitle ?? row.taskId ?? ''} — ${row.runStatus === 'settled' ? row.settleReason ?? 'settled' : row.runStatus ?? ''}`
                    : row.message ?? '',
              },
              {
                key: 'cost',
                header: 'TOKENS/COST',
                width: 16,
                render: (row) =>
                  row.type === 'run'
                    ? `${tokensText(row.totalTokens)}${row.costUsdMicros != null ? ` $${(row.costUsdMicros / 1_000_000).toFixed(2)}` : ''}`
                    : '',
              },
              { key: 'dur', header: 'DURATION', width: 10, render: (row) => (row.type === 'run' ? durationText(row.durationMs) : '') },
            ]}
            color={color}
          />
        )}
        <Text dimColor>Full context breakdown: `bakin agents context {data.agentId}`</Text>
      </Section>
    </Box>
  )
}
