import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { TaskLogTable } from '../components/task-log-table'
import { ApprovalPanel } from '../components/approval-panel'
import type { FlatTask } from '../hooks/use-task-filters'
import type { TaskApproval } from '../types'

const tasks: FlatTask[] = [
  { id: 'editorial', title: 'Prepare the seasonal editorial launch with cross-team review and publication approval', status: 'done', checked: true, date: '2026-01-14T13:00:00Z' },
  { id: 'review', title: 'Review campaign images', status: 'review', checked: false, date: '2026-01-15T08:00:00-07:00' },
  { id: 'undated', title: 'Unscheduled follow-up', status: 'todo', checked: false },
]

// ─── Approval panel states (spec D7): loading, failed, busy, long content ────
const base = { status: 'pending' as const, deliveries: [], createdAt: '2026-01-15T11:00:00Z', updatedAt: '2026-01-15T11:00:00Z' }
const gate: TaskApproval = {
  ...base,
  approvalId: 'workflow-gate:editorial:review:run-1:2026-01-15T11:00:00Z',
  owner: { kind: 'workflow-gate', taskId: 'editorial', workflowId: 'editorial-launch', runId: 'run-1', stepId: 'review' },
  request: { title: 'Gate: Review the complete campaign before the publication window opens for every regional channel', body: '', options: [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }], context: { requireRejectReason: true } },
}
const longChanges = Array.from({ length: 6 }, (_, index) => ({
  kind: 'file' as const,
  target: `bakin_editorial_publication_history_v${index + 1}_fp${(1234 + index).toString(16)}`,
  action: 'delete' as const,
  description: 'Drop the retired blue/green generation and rebuild it from the durable outbox so queries stop pinning a table that no longer converges.',
}))
const repair: TaskApproval = {
  ...base,
  approvalId: 'health-repair:repair-1',
  owner: {
    kind: 'health-repair', taskId: 'review', requestId: 'repair-1', incidentIds: ['health:search:retired-generations'],
    proposal: { reportId: 'report-1', observationIds: ['health.search:generations'], items: [{ actionId: 'search.drop-retired', itemId: 'search.drop-retired:all', safety: 'destructive', changes: longChanges }] },
  },
  request: {
    title: 'Repair: Retired search generations still consume the engine',
    body: ['Bakin Health proposes a repair that changes state and needs your approval before it runs.', '', '- Retired search generations still consume the engine (health:search:retired-generations)', '  Impact: Every query pays for six abandoned tables.', '', 'Proposed changes:', ...longChanges.map((change) => `- [destructive] ${change.action} ${change.kind} \`${change.target}\` — ${change.description}`), '', 'Apply runs exactly these changes after re-checking that nothing moved; Dismiss snoozes the incidents for 7 days.'].join('\n'),
    options: [{ id: 'apply', label: 'Apply repair', variant: 'primary' }, { id: 'dismiss', label: 'Dismiss', variant: 'neutral' }],
  },
}
const navigate: TaskApproval = {
  ...base,
  approvalId: 'health-navigate:repair-2',
  owner: { kind: 'health-navigate', taskId: 'undated', requestId: 'repair-2', incidentIds: ['health:runtime:auth-expired'], href: '/settings?tab=integrations' },
  request: { title: 'OpenAI auth expired', body: 'OpenAI auth expired\nImpact: Turns on OpenAI models fail until the key is renewed.\n\nThis needs you: Renew the key — http://localhost:3737/settings?tab=integrations\n\nDismiss snoozes the incident for 7 days; it closes on its own once Health verifies the fix.', options: [{ id: 'dismiss', label: 'Dismiss', variant: 'neutral' }] },
}
const noop = () => {}
const priorOutput = { caption: 'A long caption that proves the prior-step output viewer wraps inside the approval card instead of forcing a horizontal scroll on a phone-width screen.', hashtags: ['#launch', '#editorial', '#spring'], image_brief: { mood: 'calm', palette: 'warm pastels' } }

function TasksFixture() {
  return <Page><PageHeader title="Task log" /><PageBody>
    <Stack gap="section">
      <Section aria-label="Approval panel states" spacing="compact">
        <Stack gap="item">
          <ApprovalPanel approvals={[]} loading failed={false} busyApprovalId={null} error={null} onResolve={noop} onRetry={noop} />
          <ApprovalPanel approvals={[gate]} loading={false} failed busyApprovalId={null} error={null} onResolve={noop} onRetry={noop} />
          <ApprovalPanel
            approvals={[gate, repair, navigate]}
            loading={false}
            failed={false}
            busyApprovalId={repair.approvalId}
            error={{ approvalId: gate.approvalId, message: 'The proposed repair changed since this approval was requested; a fresh proposal is waiting on the task.' }}
            onResolve={noop}
            onRetry={noop}
            gate={{ priorStepOutput: priorOutput, outputLoading: false, outputUnavailable: false, fetchPriorOutput: noop }}
          />
        </Stack>
      </Section>
      <TaskLogTable currentTasks={tasks} statusFilter={[]} onTaskOpen={() => {}}
        onTaskEdit={() => {}} onTaskDuplicate={() => {}} onTaskDelete={() => {}} />
    </Stack>
  </PageBody></Page>
}

createRoot(document.getElementById('root')!).render(
  <PluginUiFixtureHost
    fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/tasks', network: [
      { path: '/api/plugins/memory/audit', status: 200, json: { entries: [] } },
    ] }}
    registrations={[{ id: 'tasks', routes: { '/tasks': TasksFixture } }]}
  />,
)
