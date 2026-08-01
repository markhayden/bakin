'use client'

import { ConfirmDialog } from "@makinbakin/sdk/patterns"

interface DeleteTaskDialogProps {
  title: { id: string; title: string } | null
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteTaskDialog({ title: target, onConfirm, onCancel }: DeleteTaskDialogProps) {
  return (
    <ConfirmDialog
      open={!!target}
      title="Delete task"
      description={<>Are you sure you want to delete &ldquo;{target?.title}&rdquo;? This can&apos;t be undone.</>}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
