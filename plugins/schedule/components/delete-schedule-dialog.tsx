'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
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
    <Dialog open={!!job} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="bg-card border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete scheduled job</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &ldquo;{job?.displayName || job?.id}&rdquo;? This will remove
            the runtime cron job and Bakin schedule records. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
