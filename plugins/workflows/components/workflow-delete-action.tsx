'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { ConfirmDialog } from "@makinbakin/sdk/patterns"

interface WorkflowDeleteDialogProps {
  workflowName: string
  deleting?: boolean
  error?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => boolean | void | Promise<boolean | void>
}

export function WorkflowDeleteDialog({
  workflowName,
  deleting = false,
  error,
  open,
  onOpenChange,
  onDelete,
}: WorkflowDeleteDialogProps) {
  async function handleDelete() {
    const deleted = await onDelete()
    if (deleted !== false) {
      onOpenChange(false)
    }
  }

  return (
    <ConfirmDialog
      open={open}
      busy={deleting}
      busyLabel="Deleting..."
      title="Delete workflow?"
      description={<>This will delete the custom workflow &ldquo;{workflowName}&rdquo;. This can&apos;t be undone.</>}
      error={error}
      onConfirm={() => void handleDelete()}
      onCancel={() => {
        if (!deleting) onOpenChange(false)
      }}
    />
  )
}

interface WorkflowDeleteActionProps {
  workflowName: string
  disabled?: boolean
  deleting?: boolean
  error?: string | null
  onClearError?: () => void
  onDelete: () => boolean | void | Promise<boolean | void>
}

export function WorkflowDeleteAction({
  workflowName,
  disabled = false,
  deleting = false,
  error,
  onClearError,
  onDelete,
}: WorkflowDeleteActionProps) {
  const [open, setOpen] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && deleting) return
    setOpen(nextOpen)
    if (!nextOpen) onClearError?.()
  }

  return (
    <>
      <Button
        type="button"
        variant="danger"
        size="icon-sm"
        aria-label="Delete workflow"
        title="Delete workflow"
        onClick={() => {
          onClearError?.()
          setOpen(true)
        }}
        disabled={disabled || deleting}
      >
        <Trash2 aria-hidden="true" />
      </Button>

      <WorkflowDeleteDialog
        open={open}
        onOpenChange={handleOpenChange}
        workflowName={workflowName}
        deleting={deleting}
        error={error}
        onDelete={onDelete}
      />
    </>
  )
}
