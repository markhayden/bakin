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
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { ScoreOverlay, type ScoreOverlayInfo } from '@makinbakin/sdk/patterns'
import { WorkflowAgentAvatar } from './workflow-agent-identity'
import type { WorkflowTemplate, WorkflowStep } from '../types'
import {
  collectWorkflowAssignments,
  humanizeWorkflowId,
} from '../lib/workflow-presentation'

/** Collect unique agent IDs from workflow steps */
export function collectAgents(steps: WorkflowStep[]): string[] {
  return collectWorkflowAssignments(steps).agentIds
}

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
  const gateCount = steps.filter((step) => step.type === 'gate').length
  const nestedCount = steps.filter((step) => (
    step.type === 'workflow'
      || step.type === 'map_workflow'
      || (step.type === 'createTask' && Boolean(step.workflowId))
  )).length

  if (gateCount === 0 && nestedCount === 0) return null

  return (
    <ul
      aria-label="Workflow features"
      className="mb-bakin-3 flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted"
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
      <Badge tone="neutral" variant="solid" size="xs">
        {stepLabel}
      </Badge>
    )
  }

  return (
    <>
      <Badge tone="neutral" variant="solid" size="xs">
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
                        {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-bakin-3 shrink-0" /> : null}
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

export function WorkflowCard({
  template,
  onClick,
  scoreInfo,
}: {
  template: WorkflowTemplate
  onClick: () => void
  /** Search score info — only shown when debug mode + active search */
  scoreInfo?: ScoreInfo
}) {
  const assignments = collectWorkflowAssignments(template.definition.steps)
  const disabled = template.disabled === true
  const stepCount = template.stepCount ?? template.definition.steps.length

  return (
    <div className="relative h-full min-w-0">
      {/* Debug-only search-score overlay lives beside the Card: interactive
          Cards position their direct children, so corner-pinned decorations
          anchor to this wrapper instead. */}
      {scoreInfo && (
        <ScoreOverlay
          info={scoreInfo}
          className="pointer-events-none absolute right-bakin-3 top-bakin-3 z-10"
        />
      )}
    <Card
      data-testid={`card-${template.filename}`}
      interactive={{ label: `Open ${template.name}`, onActivate: onClick }}
      // Disabled cards de-emphasize via muted identity — never a
      // contrast-breaking surface fade (the "disabled" badge carries the
      // state in words).
      className="h-full"
      data-disabled={disabled ? '' : undefined}
    >
      <CardHeader>
        <div className={`flex min-w-0 items-start gap-bakin-2 ${scoreInfo ? 'pr-24' : ''}`}>
          <Workflow className={`mt-bakin-1 size-bakin-4 shrink-0 ${disabled ? 'text-bakin-text-muted' : 'text-bakin-signal-accent'}`} />
          <CardTitle className={`line-clamp-1 ${disabled ? 'text-bakin-text-muted' : ''}`}>{template.name}</CardTitle>
        </div>
      </CardHeader>

      <CardContent className={`flex-1 ${scoreInfo ? 'pr-24' : ''}`}>
        <CardDescription className="line-clamp-2 leading-relaxed">
          {template.description || 'No description'}
        </CardDescription>
        <div className="mt-bakin-3">
          <WorkflowScanSignals steps={template.definition.steps} />
        </div>
      </CardContent>

      <CardFooter variant="meta">
        <div
          data-testid="workflow-card-footer-meta"
          className="flex min-w-0 flex-wrap items-center gap-bakin-1"
        >
          {template.source === 'plugin' && (
            <span
              role="img"
              aria-label={`Managed by ${template.pluginId ?? 'plugin'} plugin; read-only`}
              className="inline-flex size-bakin-4 shrink-0 items-center justify-center text-bakin-signal-accent"
            >
              <Lock aria-hidden="true" className="size-bakin-3" />
            </span>
          )}
          <span className="inline-flex items-center gap-bakin-1">
            <WorkflowStepPreview
              stepCount={stepCount}
              steps={template.definition.steps}
            />
          </span>
          {template.source === 'user' && template.shadowedSource && (
            <Badge
              tone="accent"
              variant="soft"
              size="xs"
            >
              <GitBranch />
              shadows default
            </Badge>
          )}
          {template.skillDrift && (
            <Badge
              tone="attention"
              variant="solid"
              size="xs"
            >
              <AlertTriangle />
              {template.skillDrift.count === 1 ? 'stale skill' : `${template.skillDrift.count} stale skills`}
            </Badge>
          )}
          {disabled && (
            <Badge
              tone="neutral"
              variant="solid"
              size="xs"
            >
              <PauseCircle />
              disabled
            </Badge>
          )}
        </div>
        {(assignments.inheritsTaskAgent || assignments.teamIds.length > 0 || assignments.agentIds.length > 0) && (
          <div className="flex shrink-0 items-center gap-bakin-2">
            {assignments.inheritsTaskAgent ? (
              <span
                className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted"
              >
                <UserRound aria-hidden="true" className="size-bakin-3" />
                Task agent
              </span>
            ) : null}
            {assignments.teamIds.map((teamId) => (
              <span
                key={teamId}
                className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted"
              >
                <UsersRound aria-hidden="true" className="size-bakin-3" />
                {teamId}
              </span>
            ))}
            <div className="flex -space-x-1.5">
            {assignments.agentIds.slice(0, 5).map(id => (
              <WorkflowAgentAvatar key={id} agentId={id} size="sm" />
            ))}
            {assignments.agentIds.length > 5 && (
              <span className="ml-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">+{assignments.agentIds.length - 5}</span>
            )}
            </div>
          </div>
        )}
      </CardFooter>
    </Card>
    </div>
  )
}
