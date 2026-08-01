'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import { Textarea } from "@makinbakin/sdk/ui"
import {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
} from "@makinbakin/sdk/patterns"
import type { WorkflowDefinition } from '../types'

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
    <InspectorPanel
      label="Workflow details"
      className="w-100 shrink-0 gap-0 border-l border-bakin-border-subtle bg-bakin-surface-default"
    >
      <InspectorPanelHeader
        className="px-3 pt-3"
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
      <InspectorPanelContent className="flex-1 overflow-y-auto p-3">
        <div className="mb-3">
          <Label className="text-bakin-typography-size-meta" htmlFor="workflow-details-name">
            Name <span className="text-bakin-signal-danger">*</span>
          </Label>
          <Input
            id="workflow-details-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Workflow name"
            aria-invalid={!canApply || undefined}
          />
          {!canApply && (
            <p className="mt-1 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-signal-danger">Enter a workflow name.</p>
          )}
        </div>
        <div className="mb-3">
          <Label className="text-bakin-typography-size-meta" htmlFor="workflow-details-description">
            Description
          </Label>
          <Textarea
            id="workflow-details-description"
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe when this workflow should be used"
          />
        </div>
      </InspectorPanelContent>
      <InspectorPanelFooter className="justify-between p-3">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={applying}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            if (!canApply) return
            await onApply({
              name: name.trim(),
              description: description.trim(),
            })
          }}
          disabled={!canApply || applying}
        >
          {applying ? 'Saving...' : applyLabel}
        </Button>
      </InspectorPanelFooter>
    </InspectorPanel>
  )
}
