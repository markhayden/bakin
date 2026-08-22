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
import { AgentAvatar, KeyValue, StatusBadge, type KeyValueItem, type StatusTone } from '@makinbakin/sdk/patterns'
import {
  Button,
  Drawer,
  DrawerSection,
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

function IconLabel({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-bakin-1">
      <Icon aria-hidden="true" className="size-bakin-3" />
      {children}
    </span>
  )
}

function jobDetailItems(job: ScheduleJob): KeyValueItem[] {
  const items: KeyValueItem[] = [
    {
      label: <IconLabel icon={Clock}>Schedule</IconLabel>,
      value: (
        <>
          {job.humanSchedule}
          {job.tz ? <span className="ml-bakin-1 text-bakin-text-muted">({job.tz})</span> : null}
        </>
      ),
    },
  ]
  if (job.cron) items.push({ label: <IconLabel icon={Timer}>Cron</IconLabel>, value: job.cron, mono: true })
  if (job.workflowId) items.push({ label: <IconLabel icon={Workflow}>Workflow</IconLabel>, value: job.workflowId })
  if (job.owner) items.push({ label: 'Owner', value: job.owner })
  if (job.lastTaskId) items.push({ label: 'Last task', value: job.lastTaskId.slice(0, 8), mono: true })
  if (job.toolsAllow?.length || job.toolsAllowMissing) {
    items.push({
      label: <IconLabel icon={job.toolsAllowMissing ? ShieldAlert : ShieldCheck}>Cron tools</IconLabel>,
      value: job.toolsAllow?.length ? job.toolsAllow.join(', ') : 'Missing allowlist',
      mono: !job.toolsAllowMissing,
      breakValue: true,
    })
  }
  items.push({ label: 'Job ID', value: job.id, mono: true, breakValue: true })
  return items
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
    <Drawer
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

        <DrawerSection title="Actions" contentClassName="flex flex-wrap gap-bakin-2">
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
        </DrawerSection>

        <DrawerSection title="Details">
          <KeyValue layout="columns" items={jobDetailItems(job)} />
          {job.requireTriage || job.allowOverlap ? (
            <div className="mt-bakin-3 flex flex-wrap gap-bakin-2">
              {job.requireTriage ? <StatusBadge tone="attention" variant="soft" size="xs">Triage required</StatusBadge> : null}
              {job.allowOverlap ? <StatusBadge tone="neutral" variant="soft" size="xs">Overlap allowed</StatusBadge> : null}
            </div>
          ) : null}
        </DrawerSection>

        {job.taskPrompt ? (
          <DrawerSection
            title="Task prompt"
            actions={<Terminal aria-hidden="true" className="size-bakin-4 text-bakin-text-muted" />}
          >
            <div className="whitespace-pre-wrap rounded-bakin-surface border-l-2 border-bakin-signal-accent bg-bakin-surface-default p-bakin-4 leading-relaxed text-bakin-text-primary">
              {job.taskPrompt}
            </div>
          </DrawerSection>
        ) : null}

        {job.isBakinJob ? (
          <DrawerSection title="Pause or resume">
            <PauseControls job={job} onPause={onPause} onResume={onResume} />
          </DrawerSection>
        ) : null}

        <DrawerSection title="Run history">
          <RunHistory jobId={job.id} />
        </DrawerSection>
      </div>
    </Drawer>
  )
}
