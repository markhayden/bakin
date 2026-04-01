'use client'

import { useState } from 'react'
import { Play, Pencil, Copy, Trash2, SkipForward, MoreHorizontal, Clock, Timer, Workflow, Terminal } from 'lucide-react'
import { BakinDrawer } from '@/components/bakin-drawer'
import { AgentAvatar } from '@/components/agent-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AGENTS } from '@/lib/constants'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { AgentBadge } from './agent-badge'
import { RunHistory } from './run-history'
import { PauseControls } from './pause-controls'
import type { ScheduleJob } from '@/hooks/use-schedule'

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
  onSkipNext,
}: {
  job: ScheduleJob | null
  open: boolean
  onClose: () => void
  onPause: (jobId: string, pauseUntil?: string) => Promise<boolean>
  onResume: (jobId: string) => Promise<boolean>
  onDelete: (jobId: string) => Promise<boolean>
  onRunNow: (jobId: string) => Promise<boolean>
  onEdit: () => void
  onDuplicate: () => void
  onSkipNext: (jobId: string, n?: number) => Promise<boolean>
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!job) return null

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const ok = await onDelete(job.id)
    if (ok) onClose()
    setConfirmDelete(false)
  }

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setConfirmDelete(false)
        }
      }}
      title={
        <span className="flex items-center gap-2">
          {job.displayName || job.id}
          {job.isBakinJob && (
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Bakin</Badge>
          )}
        </span>
      }
      actions={
        <DropdownMenu onOpenChange={(o) => { if (!o) setConfirmDelete(false) }}>
          <DropdownMenuTrigger className="p-1.5 rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDelete}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="size-3.5 mr-2" />
              {confirmDelete ? 'Confirm Delete' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-6">
        {/* Agent hero */}
        {(() => {
          const agent = AGENTS.find(a => a.id === job.agentId)
          const agentId = job.agentId || 'system'
          return (
            <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
              {agent ? (
                <AgentAvatar agentId={agentId} size="lg" />
              ) : (
                <AgentBadge agentId={undefined} size="lg" showName={false} />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{agent?.name || 'System'}</div>
                <div className="flex items-center gap-2 mt-1">
                  {job.paused ? (
                    <Badge className="bg-amber-500/20 text-amber-400">Paused</Badge>
                  ) : job.enabled ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400">Active</Badge>
                  ) : (
                    <Badge className="bg-zinc-500/20 text-zinc-400">Disabled</Badge>
                  )}
                  {job.isBakinJob && (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Bakin</Badge>
                  )}
                  {job.nextRun && (
                    <span className="text-xs text-muted-foreground">
                      Next: {new Date(job.nextRun).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onRunNow(job.id)}>
            <Play className="size-3.5 mr-1.5" /> Run Now
          </Button>
          <Button variant="outline" size="sm" onClick={() => onSkipNext(job.id, 1)}>
            <SkipForward className="size-3.5 mr-1.5" /> Skip Next
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1.5" /> Edit
          </Button>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
              <Clock className="size-3" />
              Schedule
            </div>
            <div className="text-sm font-medium">
              {job.humanSchedule}
              {job.tz && <span className="ml-1 text-xs font-normal text-muted-foreground">({job.tz})</span>}
            </div>
          </div>
          {job.cron && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                <Timer className="size-3" />
                Cron
              </div>
              <div className="text-sm font-medium font-mono">{job.cron}</div>
            </div>
          )}
          {job.workflowId && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wider">
                <Workflow className="size-3" />
                Workflow
              </div>
              <div className="text-sm font-medium">{job.workflowId}</div>
            </div>
          )}
          {job.owner && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Owner</div>
              <div className="text-sm font-medium">{job.owner}</div>
            </div>
          )}
          {job.lastTaskId && (
            <div className="rounded-lg bg-surface p-3 space-y-1">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Last Task</div>
              <div className="text-sm font-medium font-mono">{job.lastTaskId.slice(0, 8)}</div>
            </div>
          )}
          <div className="rounded-lg bg-surface p-3 space-y-1 col-span-2">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Job ID</div>
            <div className="text-sm font-mono text-muted-foreground">{job.id}</div>
          </div>
        </div>

        {/* Flags */}
        {(job.requireTriage || job.allowOverlap) && (
          <div className="flex flex-wrap gap-2">
            {job.requireTriage && <Badge variant="outline" className="text-xs">Triage Required</Badge>}
            {job.allowOverlap && <Badge variant="outline" className="text-xs">Overlap Allowed</Badge>}
          </div>
        )}

        {/* Task prompt */}
        {job.taskPrompt && (
          <div>
            <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">
              <Terminal className="size-3 inline mr-1.5" />
              Task Prompt
            </h3>
            <div
              className="text-sm text-foreground/90 leading-relaxed rounded-lg p-4 border-l-2 bg-surface whitespace-pre-wrap"
              style={job.agentId ? { borderLeftColor: `var(--agent-${job.agentId})` } : { borderLeftColor: 'var(--outline-variant)' }}
            >
              {job.taskPrompt}
            </div>
          </div>
        )}

        <Separator />

        {/* Pause controls */}
        <div>
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Pause / Resume</h3>
          <PauseControls job={job} onPause={onPause} onResume={onResume} />
        </div>

        <Separator />

        {/* Run history */}
        <div>
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Run History</h3>
          <RunHistory jobId={job.id} />
        </div>
      </div>
    </BakinDrawer>
  )
}
