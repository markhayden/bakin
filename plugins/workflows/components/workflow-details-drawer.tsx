'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  Button,
  Field,
  FieldControl,
  FieldError,
  FieldGroup,
  FieldLabel,
  Form,
  Input,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'
import {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
} from '@makinbakin/sdk/patterns'
import type { WorkflowDefinition } from '../types'

const FORM_ID = 'workflow-details-form'

/**
 * Controlled inspector panel for editing a workflow's name + description.
 * Self-contained: owns its draft name/description state (re-seeded when the
 * definition prop changes), props-only interface, no closure over editor
 * state. Composes the vetted InspectorPanel pattern beside the canvas.
 */
export function WorkflowDetailsDrawer({
  definition,
  onApply,
  onClose,
  applyLabel = 'Apply',
  applying = false,
}: {
  definition: WorkflowDefinition
  onApply: (patch: Pick<WorkflowDefinition, 'name' | 'description'>) => void | Promise<void>
  onClose: () => void
  applyLabel?: string
  applying?: boolean
}) {
  const [name, setName] = useState(definition.name)
  const [description, setDescription] = useState(definition.description ?? '')
  const canApply = name.trim().length > 0

  useEffect(() => {
    setName(definition.name)
    setDescription(definition.description ?? '')
  }, [definition.description, definition.name])

  return (
    <InspectorPanel label="Workflow details" side>
      <InspectorPanelHeader
        title="Workflow details"
        description="Edit the workflow name and description."
        actions={(
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close workflow details"
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-3.5" />
          </Button>
        )}
      />
      <InspectorPanelContent>
        <Form
          id={FORM_ID}
          busy={applying}
          onSubmit={async (event) => {
            event.preventDefault()
            if (!canApply) return
            await onApply({
              name: name.trim(),
              description: description.trim(),
            })
          }}
        >
          <FieldGroup>
            <Field name="name" invalid={!canApply}>
              <FieldLabel htmlFor="workflow-details-name" requirement="required">Name</FieldLabel>
              <Input
                id="workflow-details-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Workflow name"
                aria-invalid={!canApply || undefined}
              />
              {!canApply && <FieldError match>Enter a workflow name.</FieldError>}
            </Field>
            <Field name="description">
              <FieldLabel htmlFor="workflow-details-description">Description</FieldLabel>
              <FieldControl
                render={(
                  <Textarea
                    id="workflow-details-description"
                    rows={5}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe when this workflow should be used"
                  />
                )}
              />
            </Field>
          </FieldGroup>
        </Form>
      </InspectorPanelContent>
      <InspectorPanelFooter className="justify-between">
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={applying}>
          Cancel
        </Button>
        <SubmitButton
          form={FORM_ID}
          size="sm"
          busy={applying}
          busyLabel="Saving..."
          disabled={!canApply}
        >
          {applyLabel}
        </SubmitButton>
      </InspectorPanelFooter>
    </InspectorPanel>
  )
}
