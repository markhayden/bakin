'use client'

import { useState } from 'react'
import { Play, Pencil, Copy, Trash2, SkipForward, MoreHorizontal } from 'lucide-react'
import { BakinDrawer } from '@/components/bakin-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
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

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="w-[100px] shrink-0 text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
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

        <Separator />

        {/* Details */}
        <div className="space-y-3">
          <DetailRow label="Agent">
            <AgentBadge agentId={job.agentId} size="md" />
          </DetailRow>
          <DetailRow label="Schedule">
            {job.humanSchedule}
            {job.tz && <span className="ml-1.5 text-xs text-muted-foreground">({job.tz})</span>}
          </DetailRow>
          {job.cron && <DetailRow label="Cron">{job.cron}</DetailRow>}
          {job.workflowId && <DetailRow label="Workflow">{job.workflowId}</DetailRow>}
          {job.owner && <DetailRow label="Owner">{job.owner}</DetailRow>}
          {job.requireTriage && <DetailRow label="Triage">Required (task created unassigned)</DetailRow>}
          {job.allowOverlap && <DetailRow label="Overlap">Allowed</DetailRow>}
          {job.taskPrompt && (
            <DetailRow label="Prompt">
              <span className="text-xs text-muted-foreground whitespace-pre-wrap">{job.taskPrompt}</span>
            </DetailRow>
          )}
          {job.lastTaskId && (
            <DetailRow label="Last Task">
              <span className="font-mono text-xs">{job.lastTaskId.slice(0, 8)}</span>
            </DetailRow>
          )}
          <DetailRow label="Job ID">
            <span className="font-mono text-xs text-muted-foreground">{job.id}</span>
          </DetailRow>
        </div>

        <Separator />

        {/* Pause controls */}
        <div>
          <h3 className="text-sm font-medium mb-3">Pause / Resume</h3>
          <PauseControls job={job} onPause={onPause} onResume={onResume} />
        </div>

        <Separator />

        {/* Run history */}
        <div>
          <h3 className="text-sm font-medium mb-3">Run History</h3>
          <RunHistory jobId={job.id} />
        </div>
      </div>
    </BakinDrawer>
  )
}
