'use client'

import { MoreHorizontal, Play, Pause, RotateCcw, Trash2, Pencil, Copy, SkipForward, CirclePlus, Undo2, ShieldAlert } from 'lucide-react'
import { TableRow, TableCell } from "@makinbakin/sdk/ui"
import { StatusBadge } from "@makinbakin/sdk/components"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@makinbakin/sdk/ui"
import { AgentBadge } from './agent-badge'
import type { ScheduleJob } from "@makinbakin/sdk/hooks"

export interface JobScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

function JobStatusBadge({ job }: { job: ScheduleJob }) {
  if (job.paused) {
    const label = job.pauseReason === 'auto-failures'
      ? 'Auto-paused'
      : job.pauseUntil
        ? `Paused until ${new Date(job.pauseUntil).toLocaleDateString()}`
        : 'Paused'
    return <StatusBadge tone="warning" variant="outline">{label}</StatusBadge>
  }
  if (job.skipNextN && job.skippedCount !== undefined && job.skippedCount < job.skipNextN) {
    return <StatusBadge tone="warning" variant="outline">Skipping {job.skippedCount}/{job.skipNextN}</StatusBadge>
  }
  if (job.consecutiveFailures > 0) {
    return <StatusBadge tone="destructive" variant="outline">{job.consecutiveFailures} failures</StatusBadge>
  }
  if (job.completed) {
    return <StatusBadge tone="success" variant="outline">Completed</StatusBadge>
  }
  if (!job.enabled) {
    return <StatusBadge tone="neutral" variant="outline">Disabled</StatusBadge>
  }
  return <StatusBadge tone="success" variant="outline">Active</StatusBadge>
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
  onAdopt,
  onRestoreNative,
  onSkipNext,
  scoreInfo,
}: {
  job: ScheduleJob
  onClick: () => void
  onPause: () => void
  onResume: () => void
  onRunNow: () => void
  onDelete: () => void
  onEdit: () => void
  onDuplicate: () => void
  onAdopt: () => void
  onRestoreNative: () => void
  onSkipNext: () => void
  scoreInfo?: JobScoreInfo
}) {
  const semKey = 'embeddings'
  const bm25Key = scoreInfo?.indexScores
    ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
    : undefined
  return (
    <TableRow className="cursor-pointer group" onClick={onClick}>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{job.displayName || job.id}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {job.source === 'adopted' ? 'Adopted' : job.isBakinJob ? 'Bakin schedule' : 'Runtime cron'}
          </span>
          {job.toolsAllowMissing && (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
              <ShieldAlert className="size-3" />
              Missing cron tools
            </span>
          )}
          {scoreInfo && (
            <span className="flex items-center gap-2 font-mono text-[10px] mt-0.5">
              <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
              <span className="text-cyan-400">
                BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
              </span>
              <span className="text-purple-400">
                SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
              </span>
            </span>
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
        {job.nextRun && !job.paused && (
          <div className="text-[10px] text-muted-foreground/70">
            next {new Date(job.nextRun).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </TableCell>
      <TableCell>
        <JobStatusBadge job={job} />
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-36 whitespace-nowrap" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onRunNow}>
              <Play className="size-3.5 mr-2" /> Run Now
            </DropdownMenuItem>
            {job.isBakinJob ? (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="size-3.5 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="size-3.5 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSkipNext}>
                  <SkipForward className="size-3.5 mr-2" /> Skip Next
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={onAdopt}>
                <CirclePlus className="size-3.5 mr-2" /> Adopt into Bakin
              </DropdownMenuItem>
            )}
            {job.canRestoreNative && (
              <DropdownMenuItem onClick={onRestoreNative}>
                <Undo2 className="size-3.5 mr-2" /> Restore Native
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {job.paused ? (
              <DropdownMenuItem onClick={onResume}>
                <RotateCcw className="size-3.5 mr-2" /> Resume
              </DropdownMenuItem>
            ) : (
              job.enabled ? (
                <DropdownMenuItem onClick={onPause}>
                  <Pause className="size-3.5 mr-2" /> {job.isBakinJob ? 'Pause' : 'Disable'}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onResume}>
                  <RotateCcw className="size-3.5 mr-2" /> {job.isBakinJob ? 'Resume' : 'Enable'}
                </DropdownMenuItem>
              )
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
