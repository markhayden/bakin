'use client'

import { MoreHorizontal, Play, Pause, RotateCcw, Trash2, Pencil, Copy, SkipForward, CirclePlus, Undo2, ShieldAlert } from 'lucide-react'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  TableRow,
  TableCell,
} from '@makinbakin/sdk/ui'
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
    return <StatusBadge tone="attention" variant="solid" size="xs">{label}</StatusBadge>
  }
  if (job.skipNextN && job.skippedCount !== undefined && job.skippedCount < job.skipNextN) {
    return <StatusBadge tone="attention" variant="solid" size="xs">Skipping {job.skippedCount}/{job.skipNextN}</StatusBadge>
  }
  if (job.consecutiveFailures > 0) {
    return <StatusBadge tone="danger" variant="solid" size="xs">{job.consecutiveFailures} failures</StatusBadge>
  }
  if (job.completed) {
    return <StatusBadge tone="success" variant="solid" size="xs">Completed</StatusBadge>
  }
  if (!job.enabled) {
    return <StatusBadge tone="neutral" variant="solid" size="xs">Disabled</StatusBadge>
  }
  return <StatusBadge tone="success" variant="solid" size="xs">Active</StatusBadge>
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
  const label = job.displayName || job.id
  return (
    <TableRow
      className="group cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
      tabIndex={0}
      aria-label={`Open ${label}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onClick()
      }}
    >
      <TableCell>
        <div className="flex flex-col gap-bakin-1">
          <span className="text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">{label}</span>
          <span className="text-bakin-typography-size-meta uppercase tracking-wider text-bakin-text-muted">
            {job.source === 'adopted' ? 'Adopted' : job.isBakinJob ? 'Bakin schedule' : 'Runtime cron'}
          </span>
          {job.toolsAllowMissing && (
            <span className="inline-flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-signal-highlight">
              <ShieldAlert className="size-bakin-3" />
              Missing cron tools
            </span>
          )}
          {scoreInfo && (
            <span className="mt-bakin-1 flex items-center gap-bakin-2 font-bakin-typography-family-mono text-bakin-typography-size-meta">
              <span className="text-bakin-signal-highlight">RRF {scoreInfo.score.toFixed(3)}</span>
              <span className="text-bakin-signal-accent">
                BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
              </span>
              <span className="text-bakin-action-primary-background">
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
        <span className="text-bakin-typography-size-body text-bakin-text-muted">
          {job.humanSchedule}
          {job.tz && <span className="ml-bakin-1 text-bakin-typography-size-meta opacity-60">{job.tz.replace(/^.*\//, '')}</span>}
        </span>
        {job.nextRun && !job.paused && (
          <div className="text-bakin-typography-size-meta text-bakin-text-muted/70">
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
            render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${label}`}
                className="text-bakin-text-muted md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              />
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-36 whitespace-nowrap" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onRunNow}>
              <Play /> Run Now
            </DropdownMenuItem>
            {job.isBakinJob ? (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSkipNext}>
                  <SkipForward /> Skip Next
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onClick={onAdopt}>
                <CirclePlus /> Adopt into Bakin
              </DropdownMenuItem>
            )}
            {job.canRestoreNative && (
              <DropdownMenuItem onClick={onRestoreNative}>
                <Undo2 /> Restore Native
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {job.paused ? (
              <DropdownMenuItem onClick={onResume}>
                <RotateCcw /> Resume
              </DropdownMenuItem>
            ) : (
              job.enabled ? (
                <DropdownMenuItem onClick={onPause}>
                  <Pause /> {job.isBakinJob ? 'Pause' : 'Disable'}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={onResume}>
                  <RotateCcw /> {job.isBakinJob ? 'Resume' : 'Enable'}
                </DropdownMenuItem>
              )
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} variant="danger">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
