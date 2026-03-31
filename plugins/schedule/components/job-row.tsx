'use client'

import { MoreHorizontal, Play, Pause, RotateCcw, Trash2, Pencil, Copy, SkipForward } from 'lucide-react'
import { TableRow, TableCell } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { AgentBadge } from './agent-badge'
import type { ScheduleJob } from '@/hooks/use-schedule'

function StatusBadge({ job }: { job: ScheduleJob }) {
  if (job.paused) {
    const label = job.pauseReason === 'auto-failures'
      ? 'Auto-paused'
      : job.pauseUntil
        ? `Paused until ${new Date(job.pauseUntil).toLocaleDateString()}`
        : 'Paused'
    return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">{label}</Badge>
  }
  if (job.skipNextN && job.skippedCount !== undefined && job.skippedCount < job.skipNextN) {
    return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Skipping {job.skippedCount}/{job.skipNextN}</Badge>
  }
  if (job.consecutiveFailures > 0) {
    return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">{job.consecutiveFailures} failures</Badge>
  }
  if (!job.enabled) {
    return <Badge variant="outline" className="bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20">Disabled</Badge>
  }
  return <Badge variant="outline" className="bg-success/10 text-success border-success/20">Active</Badge>
}

export function JobRow({
  job,
  onClick,
  onPause,
  onResume,
  onRunNow,
  onDelete,
  onEdit,
  onDuplicate,
  onSkipNext,
}: {
  job: ScheduleJob
  onClick: () => void
  onPause: () => void
  onResume: () => void
  onRunNow: () => void
  onDelete: () => void
  onEdit: () => void
  onDuplicate: () => void
  onSkipNext: () => void
}) {
  return (
    <TableRow className="cursor-pointer group" onClick={onClick}>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{job.displayName || job.id}</span>
          {job.isBakinJob && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Bakin</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <AgentBadge agentId={job.agentId} size="md" />
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {job.humanSchedule}
          {job.tz && <span className="ml-1 text-[10px] opacity-60">{job.tz.replace(/^.*\//, '')}</span>}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge job={job} />
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onRunNow}>
              <Play className="size-3.5 mr-2" /> Run Now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5 mr-2" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="size-3.5 mr-2" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onSkipNext}>
              <SkipForward className="size-3.5 mr-2" /> Skip Next
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {job.paused ? (
              <DropdownMenuItem onClick={onResume}>
                <RotateCcw className="size-3.5 mr-2" /> Resume
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onPause}>
                <Pause className="size-3.5 mr-2" /> Pause
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-red-400 focus:text-red-400">
              <Trash2 className="size-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
