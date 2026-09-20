'use client'

import {
  AlertTriangle,
  GitBranch,
  GitFork,
  Info,
  ListPlus,
  Lock,
  PauseCircle,
  ShieldCheck,
  UserRound,
  UsersRound,
  Workflow,
} from 'lucide-react'
import {
  Badge,
  Button,
  Text,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { DataTable, ScoreOverlay, type DataTableColumn, type ScoreOverlayInfo } from '@makinbakin/sdk/patterns'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import { WorkflowAgentAvatar } from './workflow-agent-identity'
import type { WorkflowTemplate, WorkflowStep } from '../types'
import { getWorkflowSource, type WorkflowSort, type WorkflowSortField } from '../lib/workflow-sort'
import {
  collectWorkflowAssignments,
  getWorkflowScanCounts,
  humanizeWorkflowId,
} from '../lib/workflow-presentation'

function workflowStepSummary(step: WorkflowStep): {
  label: string
  icon?: typeof ShieldCheck
} {
  switch (step.type) {
    case 'gate':
      return { label: `Gate · ${step.label}`, icon: ShieldCheck }
    case 'workflow':
      return { label: `Nested · ${humanizeWorkflowId(step.workflow_id)}`, icon: Workflow }
    case 'map_workflow':
      return { label: `Fan-out · ${humanizeWorkflowId(step.workflow_id)}`, icon: GitFork }
    case 'parallel':
      return { label: `Parallel · ${step.steps.length} lanes`, icon: GitFork }
    case 'createTask':
      return {
        label: step.workflowId
          ? `Task · ${humanizeWorkflowId(step.workflowId)}`
          : `Task · ${step.label}`,
        icon: ListPlus,
      }
    default:
      return { label: step.label }
  }
}

function WorkflowScanSignals({ steps }: { steps: WorkflowStep[] }) {
  const { gateCount, nestedCount } = getWorkflowScanCounts(steps)

  if (gateCount === 0 && nestedCount === 0) return <Text tone="muted">—</Text>

  return (
    <ul
      aria-label="Workflow features"
      className="flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted"
    >
      {gateCount > 0 ? (
        <li className="flex items-center gap-bakin-1">
          <ShieldCheck aria-hidden="true" className="size-bakin-3 shrink-0 text-bakin-signal-highlight" />
          {gateCount === 1 ? 'Human approval' : `${gateCount} human approvals`}
        </li>
      ) : null}
      {nestedCount > 0 ? (
        <li className="flex items-center gap-bakin-1">
          <Workflow aria-hidden="true" className="size-bakin-3 shrink-0 text-bakin-signal-accent" />
          {nestedCount === 1 ? 'Nested workflow' : `${nestedCount} nested workflows`}
        </li>
      ) : null}
    </ul>
  )
}

function WorkflowStepPreview({
  stepCount,
  steps,
}: {
  stepCount: number
  steps: WorkflowStep[]
}) {
  const stepLabel = `${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`

  if (steps.length === 0) {
    return (
      <Badge tone="neutral" variant="soft" size="xs">
        {stepLabel}
      </Badge>
    )
  }

  return (
    <>
      <Badge tone="neutral" variant="soft" size="xs">
        {stepLabel}
      </Badge>
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="cursor-help rounded-bakin-pill text-bakin-text-muted"
                aria-label={`Show ${stepCount} workflow ${stepCount === 1 ? 'step' : 'steps'}`}
              />
            )}
          >
            <Info aria-hidden="true" className="size-bakin-3" />
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="items-stretch"
          >
            <div className="min-w-0">
              <p className="m-0 font-bakin-typography-weight-bold">Workflow steps</p>
              <ol
                aria-label="Workflow sequence"
                className="mt-bakin-2 flex flex-col gap-bakin-2"
              >
                {steps.map((step, index) => {
                  const summary = workflowStepSummary(step)
                  const Icon = summary.icon
                  return (
                    <li key={step.id} className="flex min-w-0 items-start gap-bakin-2">
                      <span className="flex size-bakin-6 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-canvas-default/10 font-bakin-typography-family-mono text-bakin-typography-size-meta">
                        {index + 1}
                      </span>
                      <span className="flex min-w-0 items-start gap-bakin-1">
                        {Icon ? <Icon aria-hidden="true" className="mt-bakin-1 size-bakin-3 shrink-0" /> : null}
                        <span className="min-w-0">{summary.label}</span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  )
}

type ScoreInfo = ScoreOverlayInfo

function WorkflowAssignments({ template }: { template: WorkflowTemplate }) {
  const assignments = collectWorkflowAssignments(template.definition.steps)
  return (
    <Inline gap="dense">
      {assignments.inheritsTaskAgent && (
        <span className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">
          <UserRound aria-hidden="true" className="size-bakin-3 shrink-0" />
          Task agent
        </span>
      )}
      {assignments.teamIds.map(teamId => (
        <span key={teamId} className="flex min-w-0 items-center gap-bakin-1 break-words text-bakin-typography-size-meta text-bakin-text-muted">
          <UsersRound aria-hidden="true" className="size-bakin-3 shrink-0" />
          <span className="min-w-0 break-words">{teamId}</span>
        </span>
      ))}
      {assignments.agentIds.slice(0, 5).map(id => (
        <WorkflowAgentAvatar key={id} agentId={id} size="sm" />
      ))}
      {assignments.agentIds.length > 5 && (
        <Text size="meta" tone="muted">+{assignments.agentIds.length - 5}</Text>
      )}
      {!assignments.inheritsTaskAgent && assignments.teamIds.length === 0 && assignments.agentIds.length === 0 && (
        <Text tone="muted">—</Text>
      )}
    </Inline>
  )
}

export function WorkflowTable({
  label,
  templates,
  onOpen,
  scoreMap,
  sort,
  onSortChange,
}: {
  label: string
  templates: WorkflowTemplate[]
  onOpen: (filename: string) => void
  /** Search scores are supplied only while debug mode and search are active. */
  scoreMap?: Map<string, ScoreInfo>
  sort?: WorkflowSort
  onSortChange?: (field: WorkflowSortField) => void
}) {
  // The page sorts the complete result set; this table receives the visible slice.
  const columns: ReadonlyArray<DataTableColumn<WorkflowTemplate, WorkflowSortField>> = [
    {
      key: 'name', header: 'Workflow', headClassName: 'w-5/12', sortable: true,
      cell: template => (
        <Stack gap="dense">
          <Inline gap="dense" justify="between">
            <Text weight="semibold" tone={template.disabled ? 'muted' : 'default'}>{template.name}</Text>
            {scoreMap?.has(template.filename) && <ScoreOverlay info={scoreMap.get(template.filename)!} />}
          </Inline>
          <Text as="p" size="meta" tone="muted">{template.description || 'No description'}</Text>
          {(template.shadowedSource || template.skillDrift || template.disabled) && (
            <Inline gap="dense">
              {template.source === 'user' && template.shadowedSource && (
                <Badge tone="accent" variant="soft" size="xs"><GitBranch />shadows default</Badge>
              )}
              {template.skillDrift && (
                <Badge tone="attention" variant="solid" size="xs">
                  <AlertTriangle />
                  {template.skillDrift.count === 1 ? 'stale skill' : `${template.skillDrift.count} stale skills`}
                </Badge>
              )}
              {template.disabled && <Badge tone="neutral" variant="solid" size="xs"><PauseCircle />disabled</Badge>}
            </Inline>
          )}
        </Stack>
      ),
    },
    {
      key: 'source', header: 'Source', headClassName: 'w-1/8', sortable: true,
      cell: template => {
        const managed = getWorkflowSource(template) === 'managed'
        const provenance = template.source === 'plugin'
          ? `Managed by ${template.pluginId ?? 'plugin'} plugin; read-only`
          : `Managed by ${template.packageId ?? 'agent'} package; read-only`
        return (
          <Inline gap="dense" wrap={false}>
            <Badge tone="neutral" variant="soft" size="xs">{managed ? 'Managed' : 'Custom'}</Badge>
            {managed && (
              <TooltipProvider delay={0}>
                <Tooltip>
                  <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={provenance} />}>
                    <Lock aria-hidden="true" className="size-bakin-3 text-bakin-text-muted" />
                  </TooltipTrigger>
                  <TooltipContent>{provenance}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </Inline>
        )
      },
    },
    {
      key: 'steps', header: 'Steps', headClassName: 'w-1/8', sortable: true,
      cell: template => (
        <Inline gap="dense" wrap={false} data-testid="workflow-row-meta">
          <WorkflowStepPreview stepCount={template.stepCount ?? template.definition.steps.length} steps={template.definition.steps} />
        </Inline>
      ),
    },
    { key: 'features', header: 'Features', headClassName: 'w-1/6', sortable: true, cell: template => <WorkflowScanSignals steps={template.definition.steps} /> },
    { key: 'assignment', header: 'Assignment', headClassName: 'w-1/6', sortable: true, cell: template => <WorkflowAssignments template={template} /> },
  ]

  return (
    <DataTable
      label={label}
      columns={columns}
      sort={sort}
      onSortChange={onSortChange}
      rows={templates}
      rowKey={template => template.filename}
      tableProps={{ className: 'min-w-3xl table-fixed' }}
      onRowActivate={template => onOpen(template.filename)}
      rowActivateLabel={template => `Open ${template.name}`}
      rowProps={template => ({
        'data-testid': `row-${template.filename}`,
        // Disabled definitions remain openable for inspection and editing.
        'data-disabled': template.disabled ? '' : undefined,
      })}
    />
  )
}
