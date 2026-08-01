'use client'

import { Copy, Workflow } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Checkbox } from "@makinbakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import { Textarea } from "@makinbakin/sdk/ui"
import type { WorkflowDialogFieldErrors } from './workflow-dialog-validation'

interface ManagedWorkflowCopyDialogProps {
  open: boolean
  variant?: 'copy' | 'create'
  creating: boolean
  error?: string | null
  fieldErrors?: WorkflowDialogFieldErrors
  copyName: string
  copyId: string
  workflowDescription?: string
  disableOriginal: boolean
  showDescription?: boolean
  showDisableOriginal?: boolean
  onOpenChange: (open: boolean) => void
  onCopyNameChange: (value: string) => void
  onCopyIdChange: (value: string) => void
  onWorkflowDescriptionChange?: (value: string) => void
  onDisableOriginalChange: (value: boolean) => void
  onCancel: () => void
  onCreate: () => void
}

export function ManagedWorkflowCopyDialog({
  open,
  variant = 'copy',
  creating,
  error,
  fieldErrors = {},
  copyName,
  copyId,
  workflowDescription = '',
  disableOriginal,
  showDescription = false,
  showDisableOriginal = true,
  onOpenChange,
  onCopyNameChange,
  onCopyIdChange,
  onWorkflowDescriptionChange,
  onDisableOriginalChange,
  onCancel,
  onCreate,
}: ManagedWorkflowCopyDialogProps) {
  const isCreate = variant === 'create'
  const title = isCreate ? 'Create workflow' : 'Edit managed workflow'
  const description = isCreate
    ? 'Name this workflow before opening the canvas. Bakin will create it now, then you can add and configure steps.'
    : 'To edit this workflow, Bakin will create a custom copy. Name the copy now, then optionally disable the managed original so automatic selection skips it.'
  const nameLabel = isCreate ? 'Workflow name' : 'Copy name'
  const namePlaceholder = isCreate ? 'Workflow name' : 'Workflow copy name'
  const idPlaceholder = isCreate ? 'workflow-id' : 'workflow-copy-id'
  const submitLabel = isCreate ? 'Create workflow' : 'Create copy'
  const creatingLabel = isCreate ? 'Creating...' : 'Creating...'
  const cancelLabel = isCreate ? 'Cancel' : 'Back'
  const SubmitIcon = isCreate ? Workflow : Copy
  const nameErrorId = fieldErrors.name ? 'workflow-copy-name-error' : undefined
  const idErrorId = fieldErrors.id ? 'workflow-copy-id-error' : undefined
  const descriptionErrorId = fieldErrors.description ? 'workflow-copy-description-error' : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (creating) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="workflow-copy-name"
              className={fieldErrors.name ? 'text-bakin-signal-danger' : undefined}
            >
              {nameLabel}
            </Label>
            <Input
              id="workflow-copy-name"
              value={copyName}
              onChange={(e) => onCopyNameChange(e.target.value)}
              placeholder={namePlaceholder}
              aria-invalid={Boolean(fieldErrors.name) || undefined}
              aria-describedby={nameErrorId}
            />
            {fieldErrors.name && (
              <p id={nameErrorId} className="text-bakin-typography-size-meta font-bakin-typography-weight-medium leading-relaxed text-bakin-signal-danger">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="workflow-copy-id"
              className={fieldErrors.id ? 'text-bakin-signal-danger' : undefined}
            >
              Workflow id
            </Label>
            <Input
              id="workflow-copy-id"
              value={copyId}
              onChange={(e) => onCopyIdChange(e.target.value)}
              placeholder={idPlaceholder}
              aria-invalid={Boolean(fieldErrors.id) || undefined}
              aria-describedby={idErrorId}
            />
            {fieldErrors.id && (
              <p id={idErrorId} className="text-bakin-typography-size-meta font-bakin-typography-weight-medium leading-relaxed text-bakin-signal-danger">
                {fieldErrors.id}
              </p>
            )}
          </div>
          {showDescription && (
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="workflow-copy-description"
                className={fieldErrors.description ? 'text-bakin-signal-danger' : undefined}
              >
                Description
              </Label>
              <Textarea
                id="workflow-copy-description"
                rows={3}
                value={workflowDescription}
                onChange={(e) => onWorkflowDescriptionChange?.(e.target.value)}
                placeholder="Describe when this workflow should be used"
                aria-invalid={Boolean(fieldErrors.description) || undefined}
                aria-describedby={descriptionErrorId}
              />
              {fieldErrors.description && (
                <p id={descriptionErrorId} className="text-bakin-typography-size-meta font-bakin-typography-weight-medium leading-relaxed text-bakin-signal-danger">
                  {fieldErrors.description}
                </p>
              )}
            </div>
          )}
          {showDisableOriginal && (
            <Label className="items-start gap-2 rounded-bakin-control border border-bakin-border-subtle bg-bakin-surface-default/30 p-2 text-bakin-text-primary">
              <Checkbox
                checked={disableOriginal}
                onCheckedChange={(checked) => onDisableOriginalChange(checked === true)}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-1">
                <span className="text-bakin-typography-size-meta font-bakin-typography-weight-medium">Disable the managed workflow</span>
                <span className="text-bakin-typography-size-meta font-bakin-typography-weight-regular leading-snug text-bakin-text-muted">
                  The original stays visible in Managed workflows, but matching and automatic starts will skip it.
                </span>
              </span>
            </Label>
          )}
        </div>
        {error && (
          <div className="rounded-bakin-control border border-bakin-signal-danger/40 bg-bakin-signal-danger/10 p-2 text-bakin-typography-size-meta text-bakin-signal-danger">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={creating}
          >
            {cancelLabel}
          </Button>
          <Button onClick={onCreate} disabled={creating}>
            <SubmitIcon className="mr-1 size-3.5" />
            {creating ? creatingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
