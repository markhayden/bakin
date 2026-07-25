'use client'

import {
  CirclePlus,
  Clock,
  Copy,
  MoreHorizontal,
  Pencil,
  Play,
  Power,
  ShieldAlert,
  ShieldCheck,
  SkipForward,
  Terminal,
  Timer,
  Trash2,
  Undo2,
  Workflow,
} from 'lucide-react'
import { AgentAvatar, StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import {
  BakinDrawer,
  BakinDrawerSection,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@makinbakin/sdk/ui'
import { useAgent, type ScheduleJob } from '@makinbakin/sdk/hooks'
import { AgentBadge } from './agent-badge'
import { RunHistory } from './run-history'
import { PauseControls } from './pause-controls'

function jobStatus(job: ScheduleJob): { label: string; tone: StatusTone } {
  if (job.paused) return { label: 'Paused', tone: 'attention' }
  if (job.completed) return { label: 'Completed', tone: 'success' }
  if (job.enabled) return { label: 'Active', tone: 'success' }
  return { label: 'Disabled', tone: 'neutral' }
}

function sourceLabel(job: ScheduleJob): string {
  if (job.source === 'adopted') return 'Adopted'
  return job.isBakinJob ? 'Bakin schedule' : 'Runtime cron'
}

function MetadataItem({
  icon: Icon,
  label,
  value,
  mono = false,
  className,
}: {
  icon?: typeof Clock
  label: string
  value: React.ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className={`min-w-0 rounded-bakin-surface bg-bakin-surface-default p-bakin-3 ${className ?? ''}`}>
      <dt className="flex items-center gap-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
        {Icon ? <Icon aria-hidden="true" className="size-bakin-3" /> : null}
        {label}
      </dt>
      <dd className={`m-0 mt-bakin-1 break-words text-bakin-text-primary ${
        mono ? 'font-bakin-typography-family-mono text-bakin-typography-size-meta' : 'font-bakin-typography-weight-medium'
      }`}>
        {value}
      </dd>
    </div>
  )
}

export function JobDrawer({
  job,
  open,
  onClose,
  onPause,
  onResume,
  onDelete,
  onRunNow,
  onEdit,
  onDuplicate,
  onAdopt,
  onRestoreNative,
  onSkipNext,
}: {
  job: ScheduleJob | null
  open: boolean
  onClose: () => void
  onPause: (jobId: string, pauseUntil?: string) => Promise<boolean>
  onResume: (jobId: string) => Promise<boolean>
  onDelete: (jobId: string) => void
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit: () => void
  onDuplicate: () => void
  onAdopt: () => void
  onRestoreNative: (jobId: string) => Promise<boolean>
  onSkipNext: (jobId: string, n?: number) => Promise<boolean>
}) {
  const jobAgent = useAgent(job?.agentId ?? '')

  if (!job) return null

  const status = jobStatus(job)
  const nextRunCopy = job.completed && job.completedAt
    ? `Ran once — ${new Date(job.completedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
    : job.nextRun
      ? `Next: ${new Date(job.nextRun).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      : null

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      storageKey="schedule-job-detail"
      title={(
        <span className="flex min-w-0 items-center gap-bakin-2">
          <span className="truncate">{job.displayName || job.id}</span>
          <StatusBadge tone="neutral" variant="soft" size="xs">
            {sourceLabel(job)}
          </StatusBadge>
        </span>
      )}
      actions={(
        <DropdownMenu>
          <DropdownMenuTrigger
            render={(
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Job actions" />
            )}
          >
            <MoreHorizontal aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {job.isBakinJob ? (
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy aria-hidden="true" />
                Duplicate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onAdopt}>
                <CirclePlus aria-hidden="true" />
                Adopt into Bakin
              </DropdownMenuItem>
            )}
            {job.canRestoreNative ? (
              <DropdownMenuItem onClick={() => onRestoreNative(job.id)}>
                <Undo2 aria-hidden="true" />
                Restore native
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(job.id)} variant="danger">
              <Trash2 aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    >
      <div className="flex min-w-0 flex-col gap-bakin-6 pb-bakin-6">
        <div className="flex min-w-0 items-center gap-bakin-4 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4">
          {jobAgent ? (
            <AgentAvatar
              agent={{
                id: jobAgent.id,
                name: jobAgent.name,
                imageSrc: jobAgent.headshot || null,
              }}
              size="lg"
              decorative
            />
          ) : (
            <AgentBadge agentId={undefined} size="lg" showName={false} />
          )}
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">
              {jobAgent?.name || 'System'}
            </p>
            <div className="mt-bakin-2 flex min-w-0 flex-wrap items-center gap-bakin-2">
              <StatusBadge tone={status.tone} variant="solid" size="xs">{status.label}</StatusBadge>
              {nextRunCopy ? (
                <span className="min-w-0 text-bakin-typography-size-meta text-bakin-text-muted">
                  {nextRunCopy}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <BakinDrawerSection title="Actions" contentClassName="flex flex-wrap gap-bakin-2">
          <Button variant="outline" size="sm" onClick={() => onRunNow(job.id)}>
            <Play aria-hidden="true" /> Run now
          </Button>
          {job.isBakinJob ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onSkipNext(job.id, 1)}>
                <SkipForward aria-hidden="true" /> Skip next
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil aria-hidden="true" /> Edit
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onAdopt}>
              <CirclePlus aria-hidden="true" /> Adopt into Bakin
            </Button>
          )}
          {job.canRestoreNative ? (
            <Button variant="outline" size="sm" onClick={() => onRestoreNative(job.id)}>
              <Undo2 aria-hidden="true" /> Restore native
            </Button>
          ) : null}
          {!job.isBakinJob ? (
            <Button variant="outline" size="sm" onClick={() => job.enabled ? onPause(job.id) : onResume(job.id)}>
              <Power aria-hidden="true" /> {job.enabled ? 'Disable' : 'Enable'}
            </Button>
          ) : null}
        </BakinDrawerSection>

        <BakinDrawerSection title="Details">
          <dl className="m-0 grid grid-cols-1 gap-bakin-3 sm:grid-cols-2">
            <MetadataItem
              icon={Clock}
              label="Schedule"
              value={(
                <>
                  {job.humanSchedule}
                  {job.tz ? <span className="ml-bakin-1 font-bakin-typography-weight-regular text-bakin-text-muted">({job.tz})</span> : null}
                </>
              )}
            />
            {job.cron ? <MetadataItem icon={Timer} label="Cron" value={job.cron} mono /> : null}
            {job.workflowId ? <MetadataItem icon={Workflow} label="Workflow" value={job.workflowId} /> : null}
            {job.owner ? <MetadataItem label="Owner" value={job.owner} /> : null}
            {job.lastTaskId ? <MetadataItem label="Last task" value={job.lastTaskId.slice(0, 8)} mono /> : null}
            {job.toolsAllow?.length || job.toolsAllowMissing ? (
              <MetadataItem
                icon={job.toolsAllowMissing ? ShieldAlert : ShieldCheck}
                label="Cron tools"
                value={job.toolsAllow?.length ? job.toolsAllow.join(', ') : 'Missing allowlist'}
                mono={!job.toolsAllowMissing}
                className="sm:col-span-2"
              />
            ) : null}
            <MetadataItem label="Job ID" value={job.id} mono className="sm:col-span-2" />
          </dl>
          {job.requireTriage || job.allowOverlap ? (
            <div className="mt-bakin-3 flex flex-wrap gap-bakin-2">
              {job.requireTriage ? <StatusBadge tone="attention" variant="soft" size="xs">Triage required</StatusBadge> : null}
              {job.allowOverlap ? <StatusBadge tone="neutral" variant="soft" size="xs">Overlap allowed</StatusBadge> : null}
            </div>
          ) : null}
        </BakinDrawerSection>

        {job.taskPrompt ? (
          <BakinDrawerSection
            title="Task prompt"
            actions={<Terminal aria-hidden="true" className="size-bakin-4 text-bakin-text-muted" />}
          >
            <div className="whitespace-pre-wrap rounded-bakin-surface border-l-2 border-bakin-signal-accent bg-bakin-surface-default p-bakin-4 leading-relaxed text-bakin-text-primary">
              {job.taskPrompt}
            </div>
          </BakinDrawerSection>
        ) : null}

        {job.isBakinJob ? (
          <BakinDrawerSection title="Pause or resume">
            <PauseControls job={job} onPause={onPause} onResume={onResume} />
          </BakinDrawerSection>
        ) : null}

        <BakinDrawerSection title="Run history">
          <RunHistory jobId={job.id} />
        </BakinDrawerSection>
      </div>
    </BakinDrawer>
  )
}
