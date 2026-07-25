'use client'

/**
 * Node config drawer — parallel child-step list editor (add/remove/reorder
 * agent children plus the per-child id/label/agent/skill/task form).
 * Extracted from node-config-drawer.tsx (FW4); JSX unchanged.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Textarea } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import { AgentSelect } from "@makinbakin/sdk/components"

import {
  type ParallelChildRow,
  nextChildId,
  FIELD_GROUP_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_HELP_CLASS,
  CONTROL_CLASS,
  TEXTAREA_CLASS,
} from '../lib/node-config-fields'

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
    <div className="border-t border-border pt-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Parallel child steps</span>
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
      <div className="space-y-5">
        {childrenRows.map((child, index) => {
          const childId = child.id || `child-${index + 1}`
          if (child.type !== 'agent') {
            return (
              <div key={`${childId}-${index}`} className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                Child {childId} has unsupported type {child.type}; it is preserved read-only.
              </div>
            )
          }
          return (
            <div key={`${childId}-${index}`} className="rounded border border-border p-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{child.label || childId}</span>
                <div className="flex items-center gap-1">
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
                </div>
              </div>
              <div className="grid gap-5">
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-id`}>
                    Child step ID
                  </Label>
                  <Input
                    id={`parallel-child-${index}-id`}
                    aria-label={`Child step ID for ${childId}`}
                    value={child.id}
                    placeholder="write-caption"
                    className={CONTROL_CLASS}
                    onChange={(e) => updateChild(index, { id: e.target.value })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Stable identifier used by workflow links.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-label`}>
                    Display name
                  </Label>
                  <Input
                    id={`parallel-child-${index}-label`}
                    aria-label={`Display name for child ${childId}`}
                    value={child.label}
                    placeholder="Write Caption"
                    className={CONTROL_CLASS}
                    onChange={(e) => updateChild(index, { label: e.target.value })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Human-readable name shown inside the parallel group.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS}>Agent</Label>
                  <AgentSelect
                    value={typeof child.agent === 'string' ? child.agent : ''}
                    onValueChange={(v) => updateChild(index, { agent: v || '' })}
                    includeAssigned
                    includeTeams
                    allowNone={false}
                    className={CONTROL_CLASS}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Choose who should run this child step — or a team to route at dispatch.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-skill`}>
                    Skill instructions
                  </Label>
                  <Input
                    id={`parallel-child-${index}-skill`}
                    aria-label={`Skill instructions for child ${childId}`}
                    value={typeof child.skill === 'string' ? child.skill : ''}
                    placeholder="brand-voice"
                    className={CONTROL_CLASS}
                    onChange={(e) => updateChild(index, { skill: e.target.value || undefined })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Optional skill or instruction bundle to load first.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-task`}>
                    Task brief
                  </Label>
                  <Textarea
                    id={`parallel-child-${index}-task`}
                    aria-label={`Task brief for child ${childId}`}
                    rows={3}
                    value={typeof child.task === 'string' ? child.task : ''}
                    placeholder="Draft the caption for this audience segment."
                    className={TEXTAREA_CLASS}
                    onChange={(e) => updateChild(index, { task: e.target.value || undefined })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Short, concrete instruction for this child agent.
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        {childrenRows.length === 0 && (
          <div className="rounded border border-border p-3 text-xs leading-relaxed text-muted-foreground">
            Add at least one child agent before saving this parallel step.
          </div>
        )}
      </div>
    </div>
  )
}
