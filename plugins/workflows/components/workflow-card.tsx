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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { AgentAvatar } from '@makinbakin/sdk/components'
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
              <button
                type="button"
                className="inline-flex size-bakin-4 shrink-0 cursor-help items-center justify-center rounded-bakin-pill text-bakin-text-muted transition-colors hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
                aria-label={`Show ${stepCount} workflow ${stepCount === 1 ? 'step' : 'steps'}`}
              />
            )}
          >
            <Info aria-hidden="true" className="size-bakin-3" />
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="w-80 max-w-[90vw] items-stretch"
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
                      <span className="flex size-bakin-5 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-canvas-default/10 font-bakin-typography-family-mono text-bakin-typography-size-meta">
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

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

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

  const semKey = 'embeddings'
  const bm25Key = scoreInfo?.indexScores
    ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
    : undefined

  return (
    <article
      data-testid={`card-${template.filename}`}
      className={`group/card relative flex h-full min-w-0 flex-col rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4 text-left transition-colors ${
        disabled
          ? 'opacity-55 hover:opacity-75'
          : 'hover:border-bakin-border-strong hover:bg-bakin-surface-raised'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open ${template.name}`}
        className="absolute inset-0 z-0 rounded-bakin-surface outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
      />
      {scoreInfo && (
        <div className="pointer-events-none absolute right-bakin-3 top-bakin-3 z-10 flex flex-col items-end gap-0.5 rounded-bakin-control bg-bakin-canvas-default/90 px-bakin-2 py-bakin-1 text-right font-bakin-typography-family-mono text-bakin-typography-size-meta">
          <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
          <span className="text-cyan-400">
            BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
          </span>
          <span className="text-purple-400">
            SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
          </span>
        </div>
      )}
      <div className={`pointer-events-none relative z-[1] flex min-w-0 items-start gap-bakin-2 ${scoreInfo ? 'pr-24' : ''}`}>
        <Workflow className="mt-0.5 size-bakin-4 shrink-0 text-bakin-signal-accent" />
        <h3 className="m-0 min-w-0 line-clamp-1 text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">
          {template.name}
        </h3>
      </div>

      <p className={`pointer-events-none relative z-[1] mb-bakin-4 mt-bakin-2 line-clamp-2 text-bakin-typography-size-body leading-relaxed text-bakin-text-muted ${scoreInfo ? 'pr-24' : ''}`}>
        {template.description || 'No description'}
      </p>

      <div className="pointer-events-none relative z-[1]">
        <WorkflowScanSignals steps={template.definition.steps} />
      </div>

      <div className="pointer-events-none relative z-[1] mt-auto flex min-w-0 items-center justify-between gap-bakin-3 border-t border-bakin-border-subtle pt-bakin-3">
        <div
          data-testid="workflow-card-footer-meta"
          className="flex min-w-0 flex-wrap items-center gap-bakin-1"
        >
          {template.source === 'plugin' && (
            <span
              role="img"
              aria-label={`Managed by ${template.pluginId ?? 'plugin'} plugin; read-only`}
              title={`Managed by ${template.pluginId ?? 'plugin'} plugin; read-only`}
              className="inline-flex size-bakin-4 shrink-0 items-center justify-center text-bakin-signal-accent"
            >
              <Lock aria-hidden="true" className="size-bakin-3" />
            </span>
          )}
          <span className="pointer-events-auto inline-flex items-center gap-bakin-1">
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
              title="This custom workflow shadows a managed workflow with the same id"
            >
              <GitBranch className="size-2.5" />
              shadows default
            </Badge>
          )}
          {template.skillDrift && (
            <Badge
              tone="attention"
              variant="solid"
              size="xs"
              title="This workflow references a stale local workflow skill"
            >
              <AlertTriangle className="size-2.5" />
              {template.skillDrift.count === 1 ? 'stale skill' : `${template.skillDrift.count} stale skills`}
            </Badge>
          )}
          {disabled && (
            <Badge
              tone="neutral"
              variant="solid"
              size="xs"
              title="Disabled for automatic workflow selection"
            >
              <PauseCircle className="size-2.5" />
              disabled
            </Badge>
          )}
        </div>
        {(assignments.inheritsTaskAgent || assignments.teamIds.length > 0 || assignments.agentIds.length > 0) && (
          <div className="flex shrink-0 items-center gap-bakin-2">
            {assignments.inheritsTaskAgent ? (
              <span
                className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted"
                title="Agent is inherited from the task that starts this workflow"
              >
                <UserRound aria-hidden="true" className="size-bakin-3" />
                Task agent
              </span>
            ) : null}
            {assignments.teamIds.map((teamId) => (
              <span
                key={teamId}
                className="flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted"
                title={`Assigned from team ${teamId}`}
              >
                <UsersRound aria-hidden="true" className="size-bakin-3" />
                {teamId}
              </span>
            ))}
            <div className="flex -space-x-1.5">
            {assignments.agentIds.slice(0, 5).map(id => (
              <AgentAvatar key={id} agentId={id} size="sm" />
            ))}
            {assignments.agentIds.length > 5 && (
              <span className="ml-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">+{assignments.agentIds.length - 5}</span>
            )}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
