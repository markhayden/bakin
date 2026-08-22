'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription, AlertTitle, Badge, Button, Drawer, DrawerSection, Overline, Separator, Text } from '@makinbakin/sdk/ui'
import { CodeBlock } from '@makinbakin/sdk/content'
import { Stack } from '@makinbakin/sdk/layout'
import { KeyValue, type KeyValueItem } from '@makinbakin/sdk/patterns'
import { useAgent } from '@makinbakin/sdk/hooks'
import { WorkflowAgentAvatar } from './workflow-agent-identity'
import {
  useNotificationChannels,
  getChannelLabel,
} from '../hooks/use-notification-channels'
import { ChannelIcon } from '../hooks/channel-icon'
import {
  User,
  Users,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  Clock,
  Zap,
  Package,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { isTeamStepToken, teamIdFromToken } from '../lib/team-token'
import type {
  WorkflowStep,
  AgentStep,
  GateStep,
  OutputStep,
  ParallelStep,
  NestedWorkflowStep,
  MapWorkflowStep,
  WorkflowSkillDriftSummary,
} from '../types'
import type { WorkflowSkillDriftReport } from '../lib/workflow-skill-drift'

const STEP_TYPE_TONES: Record<string, 'success' | 'attention' | 'accent' | 'primary' | 'neutral'> = {
  agent: 'success',
  gate: 'attention',
  output: 'accent',
  parallel: 'primary',
  workflow: 'neutral',
  map_workflow: 'accent',
}

function StepTypeBadge({ type }: { type: string }) {
  return (
    <Badge tone={STEP_TYPE_TONES[type] ?? 'neutral'} variant="soft" size="xs">
      {type}
    </Badge>
  )
}

function IconLabel({ icon: Icon, children }: { icon?: React.ElementType; children: React.ReactNode }) {
  if (!Icon) return <>{children}</>
  return (
    <span className="inline-flex items-center gap-bakin-1">
      <Icon aria-hidden="true" className="size-bakin-3" />
      {children}
    </span>
  )
}

function DeniedToolsSection({ tools }: { tools?: string[] }) {
  if (!tools || tools.length === 0) return null
  return (
    <DrawerSection title="Denied tools">
      <div className="flex flex-wrap gap-1.5">
        {tools.map((tool) => (
          <Badge key={tool} tone="danger" variant="outline" size="xs">
            {tool}
          </Badge>
        ))}
      </div>
    </DrawerSection>
  )
}

// ─── Step Type Details ─────────────────────────────────────────────

function AgentStepDetail({ step }: { step: AgentStep }) {
  const isDynamic = step.agent === '$assigned' || isTeamStepToken(step.agent)
  const lookedUp = useAgent(!isDynamic ? step.agent : '')
  const agentMeta = !isDynamic ? lookedUp : undefined

  return (
    <div className="space-y-6">
      {/* Agent hero */}
      <div className="flex items-center gap-4 rounded-bakin-surface p-4 border border-bakin-border-subtle bg-bakin-surface-default">
        {step.agent === '$assigned' ? (
          <span className="inline-flex size-10 items-center justify-center rounded-bakin-pill bg-bakin-signal-info/15 ring-1 ring-bakin-signal-info/40">
            <User className="size-5 text-bakin-signal-info" />
          </span>
        ) : isTeamStepToken(step.agent) ? (
          <span className="inline-flex size-10 items-center justify-center rounded-bakin-pill bg-bakin-signal-accent/15 ring-1 ring-bakin-signal-accent/40">
            <Users className="size-5 text-bakin-signal-accent" />
          </span>
        ) : (
          <WorkflowAgentAvatar agentId={step.agent} size="lg" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">
            {step.agent === '$assigned'
              ? 'Assigned Agent'
              : isTeamStepToken(step.agent)
                ? `Team · ${teamIdFromToken(step.agent)}`
                : agentMeta?.name ?? step.agent}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StepTypeBadge type="agent" />
            {step.skill && (
              <Badge tone="neutral" variant="soft" size="xs" className="font-bakin-typography-family-mono">{step.skill}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Task description */}
      {step.task && (
        <DrawerSection title="Task">
          <div className="text-bakin-typography-size-body text-bakin-text-primary rounded-bakin-surface p-4 border-l-2 border-bakin-action-primary-background/40 bg-bakin-surface-default whitespace-pre-wrap leading-relaxed">
            {step.task}
          </div>
        </DrawerSection>
      )}

      {/* Description */}
      {step.description && (
        <DrawerSection title="Description">
          <div className="text-bakin-typography-size-body text-bakin-text-primary rounded-bakin-surface p-4 bg-bakin-surface-default whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </DrawerSection>
      )}

      {/* Metadata grid */}
      {Boolean(step.outputs?.length) && (
        <>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            {step.outputs && step.outputs.length > 0 && (
              <div className="col-span-2 rounded-bakin-surface bg-bakin-surface-default p-3 space-y-1">
                <Overline as="div" className="flex items-center gap-1.5">
                  <Package className="size-3" />
                  Expected Outputs
                </Overline>
                <div className="space-y-1.5 mt-2">
                  {step.outputs.map((out) => (
                    <div key={out.id} className="flex items-center gap-2">
                      <span className="text-bakin-typography-size-body font-bakin-typography-weight-medium font-bakin-typography-family-mono">{out.id}</span>
                      {out.type && <Badge variant="outline" size="xs">{out.type}</Badge>}
                      {out.path && <span className="text-bakin-typography-size-meta text-bakin-text-muted font-bakin-typography-family-mono">{out.path}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Denied tools */}
      <DeniedToolsSection tools={step.deny_tools} />
    </div>
  )
}

function GateStepDetail({ step }: { step: GateStep }) {
  const channels = useNotificationChannels()
  return (
    <div className="space-y-6">
      {/* Description */}
      {step.description && (
        <DrawerSection title="Description">
          <div className="text-bakin-typography-size-body text-bakin-text-primary rounded-bakin-surface p-4 border-l-2 border-bakin-signal-highlight/40 bg-bakin-surface-default whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </DrawerSection>
      )}

      {/* Metadata */}
      <KeyValue
        layout="columns"
        items={[
          {
            label: <IconLabel icon={ShieldCheck}>Approval</IconLabel>,
            value: step.approval_required !== false ? 'Required' : 'Optional',
          },
          ...(step.preview && step.preview.length > 0
            ? [{
              label: 'Preview Steps',
              value: (
                <span className="flex flex-wrap gap-bakin-1">
                  {step.preview.map((id) => (
                    <Badge key={id} tone="neutral" variant="soft" size="xs" className="font-bakin-typography-family-mono">{id}</Badge>
                  ))}
                </span>
              ),
            }]
            : []),
        ]}
      />

      {/* Notification channels */}
      {step.notify && step.notify.length > 0 && (
        <DrawerSection title="Notifications">
          <div className="space-y-2">
            {step.notify.map((ch, i) => (
              <div key={i} className="flex items-center gap-2 rounded-bakin-surface bg-bakin-surface-default p-3">
                <Badge variant="outline" size="xs" className="inline-flex items-center gap-1">
                  <ChannelIcon channelId={ch.channel} className="size-3" />
                  {getChannelLabel(ch.channel, channels)}
                </Badge>
                <span className="text-bakin-typography-size-body font-bakin-typography-family-mono text-bakin-text-muted">{ch.target}</span>
              </div>
            ))}
          </div>
        </DrawerSection>
      )}

      <Separator />

      {/* Paths */}
      <div className="space-y-4">
        <DrawerSection title="On Approve">
          <div className="flex items-center gap-2 rounded-bakin-surface bg-bakin-surface-default p-3">
            <ArrowRight className="size-4 text-bakin-action-primary-background shrink-0" />
            <span className="text-bakin-typography-size-body font-bakin-typography-weight-medium">Continue to the next step</span>
          </div>
        </DrawerSection>

        {step.on_reject && (
          <DrawerSection title="On Reject">
            <div className="rounded-bakin-surface bg-bakin-signal-danger/10 border border-bakin-signal-danger/20 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <ArrowRight className="size-4 text-bakin-signal-danger shrink-0" />
                <span className="text-bakin-typography-size-body font-bakin-typography-weight-medium">Rewind to</span>
                <Badge tone="neutral" variant="soft" size="xs" className="font-bakin-typography-family-mono">{step.on_reject.goto}</Badge>
              </div>
              {step.on_reject.note_to_agent && (
                <p className="text-bakin-typography-size-meta text-bakin-text-muted ml-6">Rejection reason forwarded to agent</p>
              )}
            </div>
          </DrawerSection>
        )}
      </div>
    </div>
  )
}

function OutputStepDetail({ step }: { step: OutputStep }) {
  const outputItems: KeyValueItem[] = []
  if (step.channels && step.channels.length > 0) {
    outputItems.push({
      label: <IconLabel icon={Zap}>Channels</IconLabel>,
      value: (
        <span className="flex flex-wrap gap-bakin-1">
          {step.channels.map((ch) => (
            <Badge key={ch} tone="neutral" variant="soft" size="xs">{ch}</Badge>
          ))}
        </span>
      ),
    })
  }
  if (step.schedule) {
    outputItems.push({ label: <IconLabel icon={Clock}>Schedule</IconLabel>, value: step.schedule, mono: true })
  }
  return (
    <div className="space-y-6">
      {/* Agent hero (if present) */}
      {step.agent && (
        <div className="flex items-center gap-4 rounded-bakin-surface p-4 border border-bakin-border-subtle bg-bakin-surface-default">
          {isTeamStepToken(step.agent) ? (
            <span className="inline-flex size-10 items-center justify-center rounded-bakin-pill bg-bakin-signal-accent/15 ring-1 ring-bakin-signal-accent/40">
              <Users className="size-5 text-bakin-signal-accent" />
            </span>
          ) : (
            <WorkflowAgentAvatar agentId={step.agent} size="lg" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">
              {isTeamStepToken(step.agent) ? `Team · ${teamIdFromToken(step.agent)}` : step.agent}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <StepTypeBadge type="output" />
              {step.skill && (
                <Badge tone="neutral" variant="soft" size="xs" className="font-bakin-typography-family-mono">{step.skill}</Badge>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      {step.description && (
        <DrawerSection title="Description">
          <div className="text-bakin-typography-size-body text-bakin-text-primary rounded-bakin-surface p-4 border-l-2 border-bakin-signal-accent/40 bg-bakin-surface-default whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </DrawerSection>
      )}

      {/* Metadata */}
      {outputItems.length > 0 && <KeyValue layout="columns" items={outputItems} />}

      {/* Content templates */}
      {step.content && Object.keys(step.content).length > 0 && (
        <>
          <Separator />
          <DrawerSection title="Content Templates">
            <Stack gap="item">
              {Object.entries(step.content).map(([key, value]) => (
                <Stack key={key} gap="dense">
                  <Overline>{key}</Overline>
                  {/* A template IS its exact source — CodeBlock owns the mono
                      frame and makes the block keyboard-reachable, which a
                      bare scrollable <pre> never is. */}
                  <CodeBlock code={value} label={`${key} template`} copyable wrap />
                </Stack>
              ))}
            </Stack>
          </DrawerSection>
        </>
      )}

      {/* Denied tools */}
      <DeniedToolsSection tools={step.deny_tools} />
    </div>
  )
}

function ParallelStepDetail({ step }: { step: ParallelStep }) {
  return (
    <div className="space-y-6">
      <DrawerSection title={`Parallel Steps (${step.steps.length})`}>
        <div className="space-y-3">
          {step.steps.map((child) => (
            <div key={child.id} className="rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-4">
              <div className="flex items-center gap-3 mb-2">
                <StepTypeBadge type={child.type} />
                <span className="text-bakin-typography-size-body font-bakin-typography-weight-medium">{child.label}</span>
              </div>
              {child.type === 'agent' && (
                <div className="flex items-center gap-2">
                  <WorkflowAgentAvatar agentId={(child as AgentStep).agent} size="sm" />
                  <Text size="meta" tone="muted">
                    {(child as AgentStep).agent}
                  </Text>
                </div>
              )}
              {(child as AgentStep).task && (
                <p className="text-bakin-typography-size-meta text-bakin-text-muted mt-2 leading-relaxed line-clamp-3">
                  {(child as AgentStep).task}
                </p>
              )}
            </div>
          ))}
        </div>
      </DrawerSection>
    </div>
  )
}

function WorkflowStepDetail({ step }: { step: NestedWorkflowStep }) {
  return (
    <div className="space-y-6">
      {/* Metadata */}
      <KeyValue
        layout="columns"
        items={[
          { label: <IconLabel icon={RefreshCw}>Workflow ID</IconLabel>, value: step.workflow_id, mono: true },
        ]}
      />

      {/* Description */}
      {step.description && (
        <DrawerSection title="Description">
          <div className="text-bakin-typography-size-body text-bakin-text-primary rounded-bakin-surface p-4 border-l-2 border-bakin-signal-info/40 bg-bakin-surface-default whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </DrawerSection>
      )}
    </div>
  )
}

function MapWorkflowStepDetail({ step }: { step: MapWorkflowStep }) {
  return (
    <div className="space-y-6">
      <KeyValue
        layout="columns"
        items={[
          { label: <IconLabel icon={RefreshCw}>Child Workflow</IconLabel>, value: step.workflow_id, mono: true },
          { label: <IconLabel icon={Zap}>Source Array</IconLabel>, value: step.source, mono: true },
          { label: <IconLabel icon={Package}>Item Key</IconLabel>, value: step.item_key || 'item', mono: true },
          { label: <IconLabel icon={AlertTriangle}>Max Children</IconLabel>, value: step.max_children ?? 32, mono: true, numeric: true },
        ]}
      />

      <p className="text-bakin-typography-size-meta text-bakin-text-muted leading-relaxed">
        Fans out one child workflow per element of the source array at runtime.
        Live children appear as sub-tasks on the board; per-child retry and
        cancel live on the parent task's detail panel.
      </p>

      {step.description && (
        <DrawerSection title="Description">
          <div className="text-bakin-typography-size-body text-bakin-text-primary rounded-bakin-surface p-4 border-l-2 border-bakin-signal-accent/40 bg-bakin-surface-default whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </DrawerSection>
      )}
    </div>
  )
}

// ─── Drawer Shell ──────────────────────────────────────────────────

interface StepDetailDrawerProps {
  step: WorkflowStep | null
  allSteps?: WorkflowStep[]
  open: boolean
  onOpenChange: (open: boolean) => void
  skillDrift?: WorkflowSkillDriftSummary
  onSkillRepaired?: () => Promise<void> | void
}

function stepSkillName(step: WorkflowStep | null): string | undefined {
  const skill = step ? (step as { skill?: unknown }).skill : undefined
  return typeof skill === 'string' ? skill : undefined
}

function stepSkillNames(step: WorkflowStep | null): string[] {
  if (!step) return []
  const names: string[] = []
  const skillName = stepSkillName(step)
  if (skillName) names.push(skillName)
  if (step.type === 'parallel') {
    for (const child of step.steps) {
      names.push(...stepSkillNames(child))
    }
  }
  return Array.from(new Set(names))
}

function sourceLabel(report: WorkflowSkillDriftReport): string {
  const sourceName = report.managedSource.id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())

  return report.managedSource.kind === 'plugin'
    ? `${sourceName} plugin`
    : `${sourceName} agent package`
}

function findingDisplayLabel(id: string, fallback: string): string {
  switch (id) {
    case 'image-output-asset-id':
      return 'Old image output fields'
    case 'media-output-asset-id':
      return 'Old media output fields'
    case 'prompt-packet-sidecar':
      return 'Old prompt packet output'
    case 'legacy-tool-rename':
      return 'Old tool name'
    default:
      return fallback
  }
}

function driftImpactText(report: WorkflowSkillDriftReport): string {
  const findingIds = new Set(report.findings.map(finding => finding.id))
  if (findingIds.has('image-output-asset-id') || findingIds.has('prompt-packet-sidecar')) {
    return 'The current image flow saves generated files as managed assets. This local copy still asks for older filename fields, so generated images can fail or lose their saved-asset link.'
  }
  if (findingIds.has('media-output-asset-id')) {
    return 'The current media flow tracks generated files as managed assets. This local copy still asks for older path fields, so generated media can be left untracked.'
  }
  if (findingIds.has('legacy-tool-rename')) {
    return 'This local copy calls an older Bakin tool name, so the workflow step may fail when it runs.'
  }
  return 'This local copy uses older instructions than the managed version, so this workflow step may not behave like the current package expects.'
}

function repairActionText(report: WorkflowSkillDriftReport): string {
  if (report.repairable) {
    return `Bakin can replace only the local ${report.skillName} instruction file with the current version from the ${sourceLabel(report)}. The workflow, task, and agent stay the same.`
  }
  return `Bakin will not change this file automatically. Review the local ${report.skillName} instruction file and compare it with the current ${sourceLabel(report)} version.`
}

function repairabilityText(report: WorkflowSkillDriftReport): string {
  switch (report.repairability) {
    case 'safe-managed':
      return 'This local copy is still tracked as Bakin-managed, so it is safe to replace.'
    case 'known-old-confirmable':
      return 'This matches an older Bakin-managed copy, so it is safe to replace.'
    case 'user-edited':
      return 'This file is marked as edited by you, so Bakin will only warn and will not overwrite it.'
    case 'custom-advisory':
      return 'This local copy is customized or untracked, so Bakin will only warn and will not overwrite it.'
  }
}

function SkillDriftSection({
  reports,
  repairingSkill,
  repairError,
  onRepair,
}: {
  reports: WorkflowSkillDriftReport[]
  repairingSkill: string | null
  repairError: string | null
  onRepair: (report: WorkflowSkillDriftReport) => void
}) {
  if (reports.length === 0) return null

  return (
    <div className="space-y-3">
      {reports.map((report) => (
        <Alert key={report.skillName} tone="attention">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>
            <span className="flex flex-wrap items-center gap-2">
              This step is using old instructions
              <Badge tone="attention" variant="outline" size="xs" className="font-bakin-typography-family-mono">
                {report.skillName}
              </Badge>
            </span>
          </AlertTitle>
          <AlertDescription>
            <div className="min-w-0 space-y-3">
              <p className="m-0 leading-relaxed">
                A local copy is overriding the current {sourceLabel(report)} version.
              </p>

              <div className="space-y-3 border-t border-bakin-border-subtle pt-3">
                <div>
                  <Overline as="div">What can break</Overline>
                  <p className="m-0 mt-1 leading-relaxed">{driftImpactText(report)}</p>
                </div>
                <div>
                  <Overline as="div">What the fix does</Overline>
                  <p className="m-0 mt-1 leading-relaxed">{repairActionText(report)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {report.findings.map((finding) => (
                    <Badge key={finding.id} tone="attention" variant="outline" size="xs">
                      {findingDisplayLabel(finding.id, finding.label)}
                    </Badge>
                  ))}
                </div>
              </div>

              <p className="m-0 leading-relaxed">{repairabilityText(report)}</p>
              {repairError && (
                <p className="m-0 leading-relaxed text-bakin-signal-danger">{repairError}</p>
              )}
              {report.repairable && (
                <div className="flex justify-stretch sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => onRepair(report)}
                    disabled={repairingSkill === report.skillName}
                    className="w-full sm:w-auto"
                  >
                    <Wrench aria-hidden="true" className="mr-2 size-4" />
                    {repairingSkill === report.skillName ? 'Upgrading...' : 'Upgrade to latest instructions'}
                  </Button>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

export function StepDetailDrawer({
  step,
  open,
  onOpenChange,
  skillDrift,
  onSkillRepaired,
}: StepDetailDrawerProps) {
  const [repairingSkill, setRepairingSkill] = useState<string | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)
  const driftReports = useMemo(() => {
    const skillNames = stepSkillNames(step)
    if (skillNames.length === 0 || !skillDrift) return []
    return skillDrift.reports.filter(report => skillNames.includes(report.skillName))
  }, [step, skillDrift])

  useEffect(() => {
    setRepairError(null)
  }, [open, step?.id])

  async function handleRepair(report: WorkflowSkillDriftReport) {
    setRepairingSkill(report.skillName)
    setRepairError(null)
    try {
      const res = await fetch(`/api/plugins/workflows/skills/${encodeURIComponent(report.skillName)}/repair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmKnownOld: true }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string; status?: string }
      if (!res.ok || data.status !== 'applied') {
        setRepairError(data.message || `Repair failed (${res.status})`)
        return
      }
      await onSkillRepaired?.()
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : String(err))
    } finally {
      setRepairingSkill(null)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={
        step ? (
          <div className="flex items-center gap-2">
            <StepTypeBadge type={step.type} />
            <span>{step.label}</span>
          </div>
        ) : undefined
      }
    >
      {step && (
        <div className="space-y-6">
          {step.type === 'agent' && <AgentStepDetail step={step as AgentStep} />}
          {step.type === 'gate' && <GateStepDetail step={step as GateStep} />}
          {step.type === 'output' && <OutputStepDetail step={step as OutputStep} />}
          {step.type === 'parallel' && <ParallelStepDetail step={step as ParallelStep} />}
          {step.type === 'workflow' && <WorkflowStepDetail step={step as NestedWorkflowStep} />}
          {step.type === 'map_workflow' && <MapWorkflowStepDetail step={step as MapWorkflowStep} />}
          <SkillDriftSection
            reports={driftReports}
            repairingSkill={repairingSkill}
            repairError={repairError}
            onRepair={handleRepair}
          />
        </div>
      )}
    </Drawer>
  )
}
