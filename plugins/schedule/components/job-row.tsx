'use client'

import { MoreHorizontal, Play, Pause, RotateCcw, Trash2 } from 'lucide-react'
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
    return <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20">{label}</Badge>
  }
  if (job.skipNextN && job.skippedCount !== undefined && job.skippedCount < job.skipNextN) {
    return <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/20">Skipping {job.skippedCount}/{job.skipNextN}</Badge>
  }
  if (job.consecutiveFailures > 0) {
    return <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20">{job.consecutiveFailures} failures</Badge>
  }
  if (!job.enabled) {
    return <Badge variant="outline" className="bg-zinc-500/10 text-zinc-400 border-zinc-500/20">Disabled</Badge>
  }
  return <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/20">Active</Badge>
}

export function JobRow({
  job,
  onClick,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: {
  job: ScheduleJob
  onClick: () => void
  onPause: () => void
  onResume: () => void
  onRunNow: () => void
  onDelete: () => void
}) {
  return (
    <TableRow className="cursor-pointer group" onClick={onClick}>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{job.displayName || job.id}</span>
          {job.isBeaconJob && (
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Beacon</span>
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
            className="p-1 rounded hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onRunNow}>
              <Play className="size-4" /> Run Now
            </DropdownMenuItem>
            {job.paused ? (
              <DropdownMenuItem onClick={onResume}>
                <RotateCcw className="size-4" /> Resume
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onPause}>
                <Pause className="size-4" /> Pause
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
