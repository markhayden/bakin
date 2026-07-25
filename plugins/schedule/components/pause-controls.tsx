'use client'

import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button, Field, FieldControl, FieldLabel } from '@makinbakin/sdk/ui'
import type { ScheduleJob } from '@makinbakin/sdk/hooks'

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
    const description = job.pauseReason === 'auto-failures'
      ? `Auto-paused after ${job.maxFailures} consecutive failures`
      : job.pauseUntil
        ? `Paused until ${new Date(job.pauseUntil).toLocaleDateString()}`
        : 'Manually paused'

    return (
      <Alert tone="attention">
        <AlertTitle>This job is paused</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
        <Button size="xs" variant="outline" onClick={() => onResume(job.id)}>
          <Play aria-hidden="true" /> Resume
        </Button>
      </Alert>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-bakin-2 sm:flex-row sm:items-end">
      <Field className="min-w-0 flex-1">
        <FieldLabel>Pause until</FieldLabel>
        <FieldControl
          type="date"
          aria-label="Pause until (optional)"
          value={pauseUntil}
          onChange={(event) => setPauseUntil(event.target.value)}
        />
      </Field>
      <Button size="sm" variant="outline" onClick={handlePause}>
        <Pause aria-hidden="true" /> Pause
      </Button>
    </div>
  )
}
