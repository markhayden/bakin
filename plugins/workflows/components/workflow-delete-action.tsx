'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { ConfirmDialog } from "@makinbakin/sdk/components"

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

  async function handleDelete() {
    const deleted = await onDelete()
    if (deleted !== false) {
      setOpen(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
        aria-label="Delete workflow"
        title="Delete workflow"
        onClick={() => {
          onClearError?.()
          setOpen(true)
        }}
        disabled={disabled || deleting}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <ConfirmDialog
        open={open}
        busy={deleting}
        busyLabel="Deleting..."
        title="Delete workflow?"
        description={<>This will delete the custom workflow &ldquo;{workflowName}&rdquo;. This can&apos;t be undone.</>}
        error={error}
        onConfirm={() => void handleDelete()}
        onCancel={() => handleOpenChange(false)}
      />
    </>
  )
}
