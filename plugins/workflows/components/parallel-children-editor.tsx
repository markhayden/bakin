'use client'

/**
 * Node config drawer — parallel child-step list editor (add/remove/reorder
 * agent children plus the per-child id/label/agent/skill/task form).
 * Extracted from node-config-drawer.tsx (FW4).
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldControl,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  SystemState,
  Textarea,
} from '@makinbakin/sdk/ui'
import { Section } from '@makinbakin/sdk/layout'
import { WorkflowAgentSelect } from './workflow-agent-identity'

import { type ParallelChildRow, nextChildId } from '../lib/node-config-fields'

const HEADING_ID = 'parallel-children-heading'

export function ParallelChildrenEditor({
  childrenRows,
  onChange,
}: {
  childrenRows: ParallelChildRow[]
  onChange: (next: ParallelChildRow[]) => void
}) {
  const updateChild = (index: number, patch: Record<string, unknown>) => {
    onChange(childrenRows.map((child, i) => (i === index ? { ...child, ...patch } : child)))
  }
  const removeChild = (index: number) => {
    onChange(childrenRows.filter((_, i) => i !== index))
  }
  const moveChild = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= childrenRows.length) return
    const next = [...childrenRows]
    const [moved] = next.splice(index, 1)
    next.splice(nextIndex, 0, moved)
    onChange(next)
  }
  const addChild = () => {
    const id = nextChildId(childrenRows)
    onChange([
      ...childrenRows,
      {
        id,
        type: 'agent',
        label: id,
        agent: '$assigned',
      },
    ])
  }

  return (
    <Section divider="top" spacing="compact" aria-labelledby={HEADING_ID}>
      <div className="flex items-center justify-between gap-bakin-2">
        <h3 id={HEADING_ID} className="m-0 text-bakin-typography-size-body font-bakin-typography-weight-semibold">
          Parallel child steps
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addChild}
          aria-label="Add child agent"
        >
          <Plus className="mr-1 size-3.5" /> Agent
        </Button>
      </div>
      {childrenRows.map((child, index) => {
        const childId = child.id || `child-${index + 1}`
        if (child.type !== 'agent') {
          return (
            <Alert key={`${childId}-${index}`} tone="attention">
              <AlertDescription>
                Child {childId} has unsupported type {child.type}; it is preserved read-only.
              </AlertDescription>
            </Alert>
          )
        }
        return (
          <Card key={`${childId}-${index}`} size="sm">
            <CardHeader>
              <CardTitle className="truncate">{child.label || childId}</CardTitle>
              <CardAction className="flex items-center gap-bakin-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move child ${childId} up`}
                  onClick={() => moveChild(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move child ${childId} down`}
                  onClick={() => moveChild(index, 1)}
                  disabled={index === childrenRows.length - 1}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove child ${childId}`}
                  onClick={() => removeChild(index)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field name="id">
                  <FieldLabel htmlFor={`parallel-child-${index}-id`}>Child step ID</FieldLabel>
                  <Input
                    id={`parallel-child-${index}-id`}
                    aria-label={`Child step ID for ${childId}`}
                    value={child.id}
                    placeholder="write-caption"
                    onChange={(e) => updateChild(index, { id: e.target.value })}
                  />
                  <FieldDescription>Stable identifier used by workflow links.</FieldDescription>
                </Field>
                <Field name="label">
                  <FieldLabel htmlFor={`parallel-child-${index}-label`}>Display name</FieldLabel>
                  <Input
                    id={`parallel-child-${index}-label`}
                    aria-label={`Display name for child ${childId}`}
                    value={child.label}
                    placeholder="Write Caption"
                    onChange={(e) => updateChild(index, { label: e.target.value })}
                  />
                  <FieldDescription>Human-readable name shown inside the parallel group.</FieldDescription>
                </Field>
                <Field name="agent">
                  <FieldLabel htmlFor={`parallel-child-${index}-agent`}>Agent</FieldLabel>
                  <WorkflowAgentSelect
                    id={`parallel-child-${index}-agent`}
                    value={typeof child.agent === 'string' ? child.agent : ''}
                    onValueChange={(v) => updateChild(index, { agent: v || '' })}
                    includeAssigned
                    allowNone={false}
                  />
                  <FieldDescription>
                    Choose who should run this child step — or a team to route at dispatch.
                  </FieldDescription>
                </Field>
                <Field name="skill">
                  <FieldLabel htmlFor={`parallel-child-${index}-skill`}>Skill instructions</FieldLabel>
                  <Input
                    id={`parallel-child-${index}-skill`}
                    aria-label={`Skill instructions for child ${childId}`}
                    value={typeof child.skill === 'string' ? child.skill : ''}
                    placeholder="brand-voice"
                    onChange={(e) => updateChild(index, { skill: e.target.value || undefined })}
                  />
                  <FieldDescription>Optional skill or instruction bundle to load first.</FieldDescription>
                </Field>
                <Field name="task">
                  <FieldLabel htmlFor={`parallel-child-${index}-task`}>Task brief</FieldLabel>
                  <FieldControl
                    render={(
                      <Textarea
                        id={`parallel-child-${index}-task`}
                        aria-label={`Task brief for child ${childId}`}
                        rows={3}
                        value={typeof child.task === 'string' ? child.task : ''}
                        placeholder="Draft the caption for this audience segment."
                        onChange={(e) => updateChild(index, { task: e.target.value || undefined })}
                      />
                    )}
                  />
                  <FieldDescription>Short, concrete instruction for this child agent.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        )
      })}
      {childrenRows.length === 0 && (
        <SystemState
          kind="initial-empty"
          scope="inline"
          headingLevel={4}
          title="No child agents yet"
          description="Add at least one child agent before saving this parallel step."
        />
      )}
    </Section>
  )
}
