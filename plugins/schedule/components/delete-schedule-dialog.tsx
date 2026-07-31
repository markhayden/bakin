'use client'

import { ConfirmDialog } from "@makinbakin/sdk/patterns"
import type { ScheduleJob } from "@makinbakin/sdk/hooks"

interface DeleteScheduleDialogProps {
  job: Pick<ScheduleJob, 'id' | 'displayName'> | null
  deleting?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteScheduleDialog({
  job,
  deleting = false,
  onConfirm,
  onCancel,
}: DeleteScheduleDialogProps) {
  return (
    <ConfirmDialog
      open={!!job}
      busy={deleting}
      title="Delete scheduled job"
      description={
        <>
          Are you sure you want to delete &ldquo;{job?.displayName || job?.id}&rdquo;? This will remove
          the runtime cron job and Bakin schedule records. This can&apos;t be undone.
        </>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
