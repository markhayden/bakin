'use client'

import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import type { ScheduleJob } from "@makinbakin/sdk/hooks"

export function PauseControls({
  job,
  onPause,
  onResume,
}: {
  job: ScheduleJob
  onPause: (jobId: string, pauseUntil?: string) => Promise<boolean>
  onResume: (jobId: string) => Promise<boolean>
}) {
  const [pauseUntil, setPauseUntil] = useState('')

  const handlePause = async () => {
    await onPause(job.id, pauseUntil || undefined)
    setPauseUntil('')
  }

  if (job.paused) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-amber-400">
          {job.pauseReason === 'auto-failures'
            ? `Auto-paused after ${job.maxFailures} consecutive failures`
            : job.pauseUntil
              ? `Paused until ${new Date(job.pauseUntil).toLocaleDateString()}`
              : 'Manually paused'}
        </div>
        <Button size="sm" variant="outline" onClick={() => onResume(job.id)}>
          <Play className="size-3.5 mr-1.5" /> Resume
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-xs text-muted-foreground mb-1 block">Pause until (optional)</Label>
          <Input
            type="date"
            value={pauseUntil}
            onChange={(e) => setPauseUntil(e.target.value)}
            className="h-8 text-sm [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-40"
          />
        </div>
        <Button size="sm" variant="outline" onClick={handlePause}>
          <Pause className="size-3.5 mr-1.5" /> Pause
        </Button>
      </div>
    </div>
  )
}
