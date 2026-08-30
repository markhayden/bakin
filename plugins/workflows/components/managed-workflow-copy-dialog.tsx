'use client'

import { Copy, Workflow } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'
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
        <Form
          busy={creating}
          onSubmit={(event) => {
            event.preventDefault()
            onCreate()
          }}
        >
          <FieldGroup>
            <Field name="name" invalid={Boolean(fieldErrors.name)}>
              <FieldLabel htmlFor="workflow-copy-name" requirement="required">{nameLabel}</FieldLabel>
              <Input
                id="workflow-copy-name"
                value={copyName}
                onChange={(e) => onCopyNameChange(e.target.value)}
                placeholder={namePlaceholder}
                aria-invalid={Boolean(fieldErrors.name) || undefined}
                aria-describedby={nameErrorId}
              />
              {fieldErrors.name && (
                <FieldError id={nameErrorId} match>{fieldErrors.name}</FieldError>
              )}
            </Field>
            <Field name="id" invalid={Boolean(fieldErrors.id)}>
              <FieldLabel htmlFor="workflow-copy-id" requirement="required">Workflow id</FieldLabel>
              <Input
                id="workflow-copy-id"
                value={copyId}
                onChange={(e) => onCopyIdChange(e.target.value)}
                placeholder={idPlaceholder}
                aria-invalid={Boolean(fieldErrors.id) || undefined}
                aria-describedby={idErrorId}
              />
              {fieldErrors.id && (
                <FieldError id={idErrorId} match>{fieldErrors.id}</FieldError>
              )}
            </Field>
            {showDescription && (
              <Field name="description" invalid={Boolean(fieldErrors.description)}>
                <FieldLabel htmlFor="workflow-copy-description">Description</FieldLabel>
                <FieldControl
                  render={(
                    <Textarea
                      id="workflow-copy-description"
                      rows={3}
                      value={workflowDescription}
                      onChange={(e) => onWorkflowDescriptionChange?.(e.target.value)}
                      placeholder="Describe when this workflow should be used"
                      aria-invalid={Boolean(fieldErrors.description) || undefined}
                      aria-describedby={descriptionErrorId}
                    />
                  )}
                />
                {fieldErrors.description && (
                  <FieldError id={descriptionErrorId} match>{fieldErrors.description}</FieldError>
                )}
              </Field>
            )}
            {showDisableOriginal && (
              <Field orientation="horizontal" name="disableOriginal">
                <Checkbox
                  aria-label="Disable the managed workflow"
                  checked={disableOriginal}
                  onCheckedChange={(checked) => onDisableOriginalChange(checked === true)}
                />
                <FieldLabel>Disable the managed workflow</FieldLabel>
                <FieldDescription>
                  The original stays visible in Managed workflows, but matching and automatic starts will skip it.
                </FieldDescription>
              </Field>
            )}
          </FieldGroup>
          {error && (
            <Alert tone="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <FormActions>
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={creating}
            >
              {cancelLabel}
            </Button>
            <SubmitButton busyLabel="Creating...">
              <SubmitIcon className="mr-1 size-3.5" />
              {submitLabel}
            </SubmitButton>
          </FormActions>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
