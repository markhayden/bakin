'use client'

import { BakinDrawer } from "@makinbakin/sdk/components"
import { Badge } from "@makinbakin/sdk/ui"
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
  ShieldCheck,
  Megaphone,
  GitBranch,
  Ban,
  ArrowRight,
  Clock,
  Zap,
  Package,
  RefreshCw,
} from 'lucide-react'
import type {
  WorkflowStep,
  AgentStep,
  GateStep,
  OutputStep,
  ParallelStep,
  NestedWorkflowStep,
} from '../types'

function StepTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    agent: 'bg-emerald-500/20 text-emerald-400',
    gate: 'bg-amber-500/20 text-amber-400',
    output: 'bg-purple-500/20 text-purple-400',
    parallel: 'bg-blue-500/20 text-blue-400',
    workflow: 'bg-cyan-500/20 text-cyan-400',
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

function DependsOnSection({ dependsOn }: { dependsOn?: string | string[] }) {
  if (!dependsOn) return null
  const deps = Array.isArray(dependsOn) ? dependsOn : [dependsOn]
  return (
    <MetadataCard icon={GitBranch} label="Depends On">
      <div className="flex flex-wrap gap-1">
        {deps.map(d => (
          <Badge key={d} variant="secondary" className="text-[10px] font-mono">{d}</Badge>
        ))}
      </div>
    </MetadataCard>
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
  const lookedUp = useAgent(step.agent)
  const agentMeta = step.agent !== '$assigned' ? lookedUp : undefined

  return (
    <div className="space-y-6">
      {/* Agent hero */}
      <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
        {step.agent === '$assigned' ? (
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-blue-900/50 ring-1 ring-blue-500/40">
            <User className="size-5 text-blue-400" />
          </span>
        ) : (
          <AgentAvatar agentId={step.agent} size="lg" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            {step.agent === '$assigned' ? 'Assigned Agent' : agentMeta?.name ?? step.agent}
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
      {(step.outputs?.length || step.dependsOn) && (
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
            <DependsOnSection dependsOn={step.dependsOn} />
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

        <DependsOnSection dependsOn={step.dependsOn} />
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
            <span className="text-sm font-medium">Continue to</span>
            <Badge variant="secondary" className="text-[10px] font-mono">{step.on_approve}</Badge>
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
          <AgentAvatar agentId={step.agent} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">{step.agent}</div>
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

        <DependsOnSection dependsOn={step.dependsOn} />
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
        <DependsOnSection dependsOn={step.dependsOn} />
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

// ─── Drawer Shell ──────────────────────────────────────────────────

interface StepDetailDrawerProps {
  step: WorkflowStep | null
  allSteps?: WorkflowStep[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StepDetailDrawer({ step, open, onOpenChange }: StepDetailDrawerProps) {
  return (
    <BakinDrawer
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
        </div>
      )}
    </BakinDrawer>
  )
}
