'use client'

import { useEffect, useMemo, useState } from 'react'
import { Drawer } from "@makinbakin/sdk/components"
import { Badge } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Separator } from "@makinbakin/sdk/ui"
import { AgentAvatar } from "@makinbakin/sdk/components"
import { useAgent } from "@makinbakin/sdk/hooks"
import {
  useNotificationChannels,
  getChannelLabel,
} from '../hooks/use-notification-channels'
import { ChannelIcon } from '../hooks/channel-icon'
import {
  User,
  Users,
  ShieldCheck,
  Megaphone,
  Ban,
  ArrowRight,
  AlertTriangle,
  Clock,
  Zap,
  Package,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { isTeamStepToken, teamIdFromToken } from '@bakin/core/workflows/team-token'
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

function StepTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    agent: 'bg-emerald-500/20 text-emerald-400',
    gate: 'bg-amber-500/20 text-amber-400',
    output: 'bg-purple-500/20 text-purple-400',
    parallel: 'bg-blue-500/20 text-blue-400',
    workflow: 'bg-cyan-500/20 text-cyan-400',
    map_workflow: 'bg-violet-500/20 text-violet-400',
  }
  return (
    <Badge className={`text-[10px] border-0 ${colors[type] || ''}`}>
      {type}
    </Badge>
  )
}

function SectionLabel({ icon: Icon, children }: { icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
      {Icon && <Icon className="size-3" />}
      {children}
    </div>
  )
}

function MetadataCard({ icon: Icon, label, children }: { icon?: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  )
}

function DeniedToolsSection({ tools }: { tools?: string[] }) {
  if (!tools || tools.length === 0) return null
  return (
    <div>
      <SectionLabel icon={Ban}>Denied Tools</SectionLabel>
      <div className="flex flex-wrap gap-1.5">
        {tools.map((tool) => (
          <Badge key={tool} variant="outline" className="text-[10px] text-red-400 border-red-500/30">
            {tool}
          </Badge>
        ))}
      </div>
    </div>
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
      <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
        {step.agent === '$assigned' ? (
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-blue-900/50 ring-1 ring-blue-500/40">
            <User className="size-5 text-blue-400" />
          </span>
        ) : isTeamStepToken(step.agent) ? (
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-purple-900/50 ring-1 ring-purple-500/40">
            <Users className="size-5 text-purple-400" />
          </span>
        ) : (
          <AgentAvatar agentId={step.agent} size="lg" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            {step.agent === '$assigned'
              ? 'Assigned Agent'
              : isTeamStepToken(step.agent)
                ? `Team · ${teamIdFromToken(step.agent)}`
                : agentMeta?.name ?? step.agent}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StepTypeBadge type="agent" />
            {step.skill && (
              <Badge variant="secondary" className="text-[10px] font-mono">{step.skill}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Task description */}
      {step.task && (
        <div>
          <SectionLabel>Task</SectionLabel>
          <div className="text-sm text-foreground/90 rounded-lg p-4 border-l-2 border-emerald-500/40 bg-surface whitespace-pre-wrap leading-relaxed">
            {step.task}
          </div>
        </div>
      )}

      {/* Description */}
      {step.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <div className="text-sm text-foreground/90 rounded-lg p-4 bg-surface whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </div>
      )}

      {/* Metadata grid */}
      {Boolean(step.outputs?.length) && (
        <>
          <Separator />
          <div className="grid grid-cols-2 gap-3">
            {step.outputs && step.outputs.length > 0 && (
              <div className="col-span-2 rounded-lg bg-surface p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                  <Package className="size-3" />
                  Expected Outputs
                </div>
                <div className="space-y-1.5 mt-2">
                  {step.outputs.map((out) => (
                    <div key={out.id} className="flex items-center gap-2">
                      <span className="text-sm font-medium font-mono">{out.id}</span>
                      {out.type && <Badge variant="outline" className="text-[9px]">{out.type}</Badge>}
                      {out.path && <span className="text-xs text-muted-foreground font-mono">{out.path}</span>}
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
        <div>
          <SectionLabel>Description</SectionLabel>
          <div className="text-sm text-foreground/90 rounded-lg p-4 border-l-2 border-amber-500/40 bg-surface whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetadataCard icon={ShieldCheck} label="Approval">
          {step.approval_required !== false ? 'Required' : 'Optional'}
        </MetadataCard>

        {step.preview && step.preview.length > 0 && (
          <MetadataCard label="Preview Steps">
            <div className="flex flex-wrap gap-1">
              {step.preview.map((id) => (
                <Badge key={id} variant="secondary" className="text-[10px] font-mono">{id}</Badge>
              ))}
            </div>
          </MetadataCard>
        )}

      </div>

      {/* Notification channels */}
      {step.notify && step.notify.length > 0 && (
        <div>
          <SectionLabel icon={Megaphone}>Notifications</SectionLabel>
          <div className="space-y-2">
            {step.notify.map((ch, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-surface p-3">
                <Badge variant="outline" className="text-[10px] inline-flex items-center gap-1">
                  <ChannelIcon channelId={ch.channel} className="size-3" />
                  {getChannelLabel(ch.channel, channels)}
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">{ch.target}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Paths */}
      <div className="space-y-4">
        <div>
          <SectionLabel>On Approve</SectionLabel>
          <div className="flex items-center gap-2 rounded-lg bg-surface p-3">
            <ArrowRight className="size-4 text-green-400 shrink-0" />
            <span className="text-sm font-medium">Continue to the next step</span>
          </div>
        </div>

        {step.on_reject && (
          <div>
            <SectionLabel>On Reject</SectionLabel>
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <ArrowRight className="size-4 text-red-400 shrink-0" />
                <span className="text-sm font-medium">Rewind to</span>
                <Badge variant="secondary" className="text-[10px] font-mono">{step.on_reject.goto}</Badge>
              </div>
              {step.on_reject.note_to_agent && (
                <p className="text-xs text-muted-foreground ml-6">Rejection reason forwarded to agent</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OutputStepDetail({ step }: { step: OutputStep }) {
  return (
    <div className="space-y-6">
      {/* Agent hero (if present) */}
      {step.agent && (
        <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
          {isTeamStepToken(step.agent) ? (
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-purple-900/50 ring-1 ring-purple-500/40">
              <Users className="size-5 text-purple-400" />
            </span>
          ) : (
            <AgentAvatar agentId={step.agent} size="lg" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">
              {isTeamStepToken(step.agent) ? `Team · ${teamIdFromToken(step.agent)}` : step.agent}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <StepTypeBadge type="output" />
              {step.skill && (
                <Badge variant="secondary" className="text-[10px] font-mono">{step.skill}</Badge>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      {step.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <div className="text-sm text-foreground/90 rounded-lg p-4 border-l-2 border-purple-500/40 bg-surface whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-3">
        {step.channels && step.channels.length > 0 && (
          <MetadataCard icon={Megaphone} label="Channels">
            <div className="flex flex-wrap gap-1">
              {step.channels.map((ch) => (
                <Badge key={ch} variant="secondary" className="text-[10px]">{ch}</Badge>
              ))}
            </div>
          </MetadataCard>
        )}

        {step.schedule && (
          <MetadataCard icon={Clock} label="Schedule">
            <span className="font-mono">{step.schedule}</span>
          </MetadataCard>
        )}

      </div>

      {/* Content templates */}
      {step.content && Object.keys(step.content).length > 0 && (
        <>
          <Separator />
          <div>
            <SectionLabel>Content Templates</SectionLabel>
            <div className="space-y-3">
              {Object.entries(step.content).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-surface p-3">
                  <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">{key}</div>
                  <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{value}</pre>
                </div>
              ))}
            </div>
          </div>
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
      <div>
        <SectionLabel icon={Zap}>Parallel Steps ({step.steps.length})</SectionLabel>
        <div className="space-y-3">
          {step.steps.map((child) => (
            <div key={child.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center gap-3 mb-2">
                <StepTypeBadge type={child.type} />
                <span className="text-sm font-medium">{child.label}</span>
              </div>
              {child.type === 'agent' && (
                <div className="flex items-center gap-2">
                  <AgentAvatar agentId={(child as AgentStep).agent} size="sm" />
                  <span className="text-xs text-muted-foreground">
                    {(child as AgentStep).agent}
                  </span>
                </div>
              )}
              {(child as AgentStep).task && (
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-3">
                  {(child as AgentStep).task}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function WorkflowStepDetail({ step }: { step: NestedWorkflowStep }) {
  return (
    <div className="space-y-6">
      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetadataCard icon={RefreshCw} label="Workflow ID">
          <span className="font-mono">{step.workflow_id}</span>
        </MetadataCard>
      </div>

      {/* Description */}
      {step.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <div className="text-sm text-foreground/90 rounded-lg p-4 border-l-2 border-cyan-500/40 bg-surface whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </div>
      )}
    </div>
  )
}

function MapWorkflowStepDetail({ step }: { step: MapWorkflowStep }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <MetadataCard icon={RefreshCw} label="Child Workflow">
          <span className="font-mono">{step.workflow_id}</span>
        </MetadataCard>
        <MetadataCard icon={Zap} label="Source Array">
          <span className="font-mono">{step.source}</span>
        </MetadataCard>
        <MetadataCard icon={Package} label="Item Key">
          <span className="font-mono">{step.item_key || 'item'}</span>
        </MetadataCard>
        <MetadataCard icon={AlertTriangle} label="Max Children">
          <span className="font-mono">{step.max_children ?? 32}</span>
        </MetadataCard>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Fans out one child workflow per element of the source array at runtime.
        Live children appear as sub-tasks on the board; per-child retry and
        cancel live on the parent task's detail panel.
      </p>

      {step.description && (
        <div>
          <SectionLabel>Description</SectionLabel>
          <div className="text-sm text-foreground/90 rounded-lg p-4 border-l-2 border-violet-500/40 bg-surface whitespace-pre-wrap leading-relaxed">
            {step.description}
          </div>
        </div>
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
        <div key={report.skillName} className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 ring-1 ring-amber-500/25">
              <AlertTriangle className="size-3.5 text-amber-200" />
            </span>
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-amber-100">This step is using old instructions</div>
                  <Badge variant="outline" className="border-amber-500/35 text-[10px] font-mono text-amber-100">
                    {report.skillName}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
                  A local copy is overriding the current {sourceLabel(report)} version.
                </p>
              </div>

              <div className="space-y-3 border-t border-amber-500/20 pt-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-amber-100/60">What can break</div>
                  <p className="mt-1 text-xs leading-relaxed text-amber-100/80">{driftImpactText(report)}</p>
                </div>
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-amber-100/60">What the fix does</div>
                  <p className="mt-1 text-xs leading-relaxed text-amber-100/80">{repairActionText(report)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {report.findings.map((finding) => (
                    <Badge key={finding.id} variant="outline" className="border-amber-500/35 text-[10px] text-amber-100">
                      {findingDisplayLabel(finding.id, finding.label)}
                    </Badge>
                  ))}
                </div>
              </div>

              <p className="text-xs leading-relaxed text-amber-100/75">{repairabilityText(report)}</p>
              {repairError && (
                <p className="text-xs leading-relaxed text-red-300">{repairError}</p>
              )}
            </div>
          </div>
          {report.repairable && (
            <div className="mt-4 flex justify-stretch sm:justify-end">
              <Button
                variant="outline"
                onClick={() => onRepair(report)}
                disabled={repairingSkill === report.skillName}
                className="h-10 w-full border-amber-500/35 px-4 text-sm font-semibold text-amber-100 hover:bg-amber-500/15 sm:w-auto"
              >
                <Wrench className="mr-2 size-4" />
                {repairingSkill === report.skillName ? 'Upgrading...' : 'Upgrade to latest instructions'}
              </Button>
            </div>
          )}
        </div>
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
