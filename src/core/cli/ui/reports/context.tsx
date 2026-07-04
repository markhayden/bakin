/**
 * `bakin agents context [id]` — startup-context diagnostics (#357).
 * Renders the /api/context-report payloads: per-source byte/token estimates,
 * workspace file sizes, and observed dispatch-run grounding. Numbers only —
 * the API never ships content, so neither can this view.
 */
import { Box, Text } from 'ink'
import { FindingRows, ScreenHeader, Section, StatusTable, SummaryStrip } from '../tui'
import { bytesText, plural } from './format'

export interface ContextSectionData {
  source: string
  bytes: number
  approxTokens: number
}

export interface ContextReportData {
  agentId: string
  tokenEstimateNote: string
  dispatch: {
    task: { sections: ContextSectionData[]; totalBytes: number; totalApproxTokens: number }
    workflow: { sections: ContextSectionData[]; totalBytes: number; totalApproxTokens: number }
    dynamicCaps: Array<{ source: string; maxBytes: number; setting: string }>
    estimatedMaxTaskBytes: number
  }
  workspace: {
    available: boolean
    files: Array<{ name: string; bytes: number; kind: string; managedBlockBytes?: number }>
    totalBytes: number
  }
  observed: {
    label: string
    runs: Array<{
      runId: string
      inputTokens: number | null
      cacheReadTokens: number | null
      cacheWriteTokens: number | null
      occurredAt: number
    }>
  }
}

export interface ContextSummaryRowData {
  agentId: string
  staticTaskBytes: number
  staticWorkflowBytes: number
  estimatedMaxTaskBytes: number
  workspaceAvailable: boolean
  workspaceTotalBytes: number
  lastObserved: { inputTokens: number | null; cacheReadTokens: number | null; occurredAt: number } | null
}

function sectionRows(sections: ContextSectionData[]) {
  return sections.map((s) => ({ status: 'ok' as const, ...s }))
}

export function ContextReportReport({ report, color = true }: {
  report: ContextReportData
  color?: boolean
}) {
  const sectionColumns = [
    { key: 'source', header: 'SOURCE', width: 24, grow: true, render: (row: ContextSectionData) => row.source },
    { key: 'bytes', header: 'BYTES', width: 12, render: (row: ContextSectionData) => bytesText(row.bytes) },
    { key: 'tokens', header: '~TOKENS', width: 10, render: (row: ContextSectionData) => String(row.approxTokens) },
  ]
  const latest = report.observed.runs[0]

  return (
    <Box flexDirection="column">
      <ScreenHeader title={`Startup context — ${report.agentId}`} subtitle={report.tokenEstimateNote} color={color} />
      <SummaryStrip items={[
        { label: 'static/dispatch', value: bytesText(report.dispatch.task.totalBytes), status: 'ok' },
        { label: 'est. max/dispatch', value: bytesText(report.dispatch.estimatedMaxTaskBytes), status: 'ok' },
        { label: 'workspace', value: report.workspace.available ? bytesText(report.workspace.totalBytes) : 'unavailable', status: report.workspace.available ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Task dispatch (static sections)" color={color}>
        <StatusTable rows={sectionRows(report.dispatch.task.sections)} columns={sectionColumns} color={color} />
      </Section>
      <Section title="Workflow dispatch (static sections)" color={color}>
        <StatusTable rows={sectionRows(report.dispatch.workflow.sections)} columns={sectionColumns} color={color} />
      </Section>
      <Section title="Dynamic blocks (configured caps)" color={color}>
        {report.dispatch.dynamicCaps.length > 0 ? (
          <StatusTable
            rows={report.dispatch.dynamicCaps.map((c) => ({ status: 'ok' as const, ...c }))}
            columns={[
              { key: 'source', header: 'SOURCE', width: 16, render: (row) => row.source },
              { key: 'max', header: 'MAX', width: 12, render: (row) => (row.maxBytes > 0 ? bytesText(row.maxBytes) : 'disabled') },
              { key: 'setting', header: 'SETTING', width: 44, grow: true, render: (row) => row.setting },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'none', message: 'No capped dynamic blocks configured.' }]} color={color} />
        )}
      </Section>
      <Section title={`Runtime workspace (${plural(report.workspace.files.length, 'file')})`} color={color}>
        {report.workspace.available ? (
          <StatusTable
            rows={report.workspace.files.map((f) => ({ status: 'ok' as const, ...f }))}
            columns={[
              { key: 'name', header: 'FILE', width: 34, grow: true, render: (row) => row.name },
              { key: 'kind', header: 'KIND', width: 11, render: (row) => row.kind },
              { key: 'bytes', header: 'BYTES', width: 12, render: (row) => bytesText(row.bytes) },
              { key: 'managed', header: 'MANAGED BLOCK', width: 14, render: (row) => (row.managedBlockBytes !== undefined ? bytesText(row.managedBlockBytes) : '-') },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'unavailable', message: 'Runtime workspace stats not available for this agent.' }]} color={color} />
        )}
      </Section>
      <Section title="Observed dispatch runs" color={color}>
        {latest ? (
          <StatusTable
            rows={report.observed.runs.map((r) => ({ status: 'ok' as const, ...r }))}
            columns={[
              { key: 'run', header: 'RUN', width: 26, grow: true, render: (row) => row.runId },
              { key: 'in', header: 'TOKENS IN', width: 11, render: (row) => String(row.inputTokens ?? '-') },
              { key: 'cacheR', header: 'CACHE READ', width: 11, render: (row) => String(row.cacheReadTokens ?? '-') },
              { key: 'cacheW', header: 'CACHE WRITE', width: 12, render: (row) => String(row.cacheWriteTokens ?? '-') },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'none', message: 'No dispatch runs recorded for this agent yet.' }]} color={color} />
        )}
        <Text dimColor>{report.observed.label}</Text>
      </Section>
    </Box>
  )
}

export function ContextSummaryReport({ agents, color = true }: {
  agents: ContextSummaryRowData[]
  color?: boolean
}) {
  return (
    <Box flexDirection="column">
      <ScreenHeader title="Startup context" subtitle="Per-agent dispatch overhead — run `bakin agents context <id>` for the breakdown" color={color} />
      <SummaryStrip items={[
        { label: plural(agents.length, 'agent'), value: agents.length, status: agents.length > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Agents" color={color}>
        {agents.length > 0 ? (
          <StatusTable
            rows={agents.map((a) => ({ status: 'ok' as const, ...a }))}
            columns={[
              { key: 'id', header: 'AGENT', width: 16, grow: true, render: (row) => row.agentId },
              { key: 'static', header: 'STATIC', width: 10, render: (row) => bytesText(row.staticTaskBytes) },
              { key: 'max', header: 'EST. MAX', width: 10, render: (row) => bytesText(row.estimatedMaxTaskBytes) },
              { key: 'workspace', header: 'WORKSPACE', width: 12, render: (row) => (row.workspaceAvailable ? bytesText(row.workspaceTotalBytes) : 'n/a') },
              { key: 'observed', header: 'LAST TOKENS IN', width: 15, render: (row) => String(row.lastObserved?.inputTokens ?? '-') },
            ]}
            color={color}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No agents reported by the runtime.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}
