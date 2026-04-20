'use client'

/**
 * Form-driven workflow editor.
 *
 * Source-of-truth contract: every shape this form produces is validated by
 * `workflowDefinitionSchema` from `lib/node-type-registry.ts` server-side.
 * Same schema, same Zod errors — the form does not own validation, the API
 * does. We surface server-returned issues inline so the form and loader
 * cannot drift.
 *
 * MVP scope:
 *  - 4 of 5 node kinds editable via form (agent, gate, output, workflow).
 *    `parallel` steps are preserved when loaded but not creatable from the
 *    UI in MVP — they get a read-only chip in the list. Phase 2B (visual
 *    editor) will replace this whole component.
 *  - Save → POST (create) or PUT (edit user copy).
 *  - Plugin-source workflows: only "Save as new" is offered.
 *  - User-source workflows: Save + Delete.
 */

import { useState, useMemo } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Save, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AgentSelect } from '@/components/agent-select'
import type {
  WorkflowDefinition,
  WorkflowStep,
  AgentStep,
  GateStep,
  OutputStep,
  NestedWorkflowStep,
  ParallelStep,
} from '../types'

interface WorkflowEditorProps {
  mode: 'create' | 'edit'
  /** Required when mode === 'edit'. The id used as the URL path param. */
  initialId?: string
  /** Initial form values (edit mode) — omit for a blank create form. */
  initialDefinition?: WorkflowDefinition
  /** Drives Save vs Save-as-new and Delete visibility. */
  source?: 'plugin' | 'user'
  onSaved?: (id: string) => void
  onDeleted?: () => void
  onCancel?: () => void
}

type EditableStepKind = 'agent' | 'gate' | 'output' | 'workflow'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '')
}

function defaultStep(kind: EditableStepKind): WorkflowStep {
  switch (kind) {
    case 'agent':
      return { id: '', type: 'agent', label: '', agent: '' }
    case 'gate':
      return { id: '', type: 'gate', label: '', on_approve: '' }
    case 'output':
      return { id: '', type: 'output', label: '' }
    case 'workflow':
      return { id: '', type: 'workflow', label: '', workflow_id: '' }
  }
}

export function WorkflowEditor({
  mode,
  initialId,
  initialDefinition,
  source,
  onSaved,
  onDeleted,
  onCancel,
}: WorkflowEditorProps) {
  const [name, setName] = useState(initialDefinition?.name ?? '')
  const [description, setDescription] = useState(initialDefinition?.description ?? '')
  const [version, setVersion] = useState(initialDefinition?.version ?? 1)
  const [steps, setSteps] = useState<WorkflowStep[]>(initialDefinition?.steps ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveAsNewId, setSaveAsNewId] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const canDelete = mode === 'edit' && source === 'user'
  const canSaveInPlace = mode === 'create' || source !== 'plugin'

  const updateStep = (idx: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? ({ ...s, ...patch } as WorkflowStep) : s)),
    )
  }
  const removeStep = (idx: number) => setSteps((prev) => prev.filter((_, i) => i !== idx))
  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }
  const addStep = (kind: EditableStepKind) => {
    setSteps((prev) => [...prev, defaultStep(kind)])
  }

  const definition = useMemo<WorkflowDefinition>(
    () => ({ name, description, version, steps }),
    [name, description, version, steps],
  )

  async function postOrPut(method: 'POST' | 'PUT', url: string, body: unknown) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError((data.error as string) || `Save failed (${res.status})`)
        return
      }
      onSaved?.(data.id as string)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (mode === 'edit' && initialId) {
      await postOrPut('PUT', `/api/plugins/workflows/definitions/${initialId}`, definition)
    } else {
      const id = (initialDefinition?.id || slugify(name)) || ''
      if (!id) {
        setError('Name is required to derive an id')
        return
      }
      await postOrPut('POST', '/api/plugins/workflows/definitions', { id, ...definition })
    }
  }

  async function handleSaveAsNew(newId: string) {
    if (!newId.trim()) {
      setError('New id is required')
      return
    }
    await postOrPut('POST', '/api/plugins/workflows/definitions', { id: newId, ...definition })
    setSaveAsNewId(null)
  }

  async function handleDelete() {
    if (!initialId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/workflows/definitions/${initialId}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError((data.error as string) || `Delete failed (${res.status})`)
        return
      }
      onDeleted?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
      setConfirmingDelete(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-lg font-semibold">
          {mode === 'create' ? 'New workflow' : `Edit workflow${initialId ? ` · ${initialId}` : ''}`}
        </h1>
        {source === 'plugin' && (
          <p className="text-xs text-amber-300 mt-1">
            This workflow is shipped by a plugin and is read-only. Use &ldquo;Save as new&rdquo; to create your own copy.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div>
          <Label htmlFor="wf-name">Name</Label>
          <Input
            id="wf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Workflow"
          />
        </div>
        <div>
          <Label htmlFor="wf-description">Description</Label>
          <Textarea
            id="wf-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this workflow does"
            rows={2}
          />
        </div>
        <div>
          <Label htmlFor="wf-version">Version</Label>
          <Input
            id="wf-version"
            type="number"
            min={1}
            value={version}
            onChange={(e) => setVersion(Number(e.target.value) || 1)}
            className="w-24"
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Steps</h2>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => addStep('agent')}>
              <Plus className="size-3 mr-1" /> Add agent step
            </Button>
            <Button size="sm" variant="outline" onClick={() => addStep('gate')}>
              <Plus className="size-3 mr-1" /> Add gate
            </Button>
            <Button size="sm" variant="outline" onClick={() => addStep('output')}>
              <Plus className="size-3 mr-1" /> Add output
            </Button>
            <Button size="sm" variant="outline" onClick={() => addStep('workflow')}>
              <Plus className="size-3 mr-1" /> Add sub-workflow
            </Button>
          </div>
        </div>

        {steps.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed rounded p-6 text-center">
            No steps yet. Add the first step using the buttons above.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {steps.map((step, idx) => (
              <li key={idx} className="rounded border border-border p-3 bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {step.type}
                  </Badge>
                  <Input
                    aria-label={`step-${idx}-id`}
                    value={step.id}
                    onChange={(e) => updateStep(idx, { id: e.target.value })}
                    placeholder="step id"
                    className="h-7 text-xs flex-1"
                  />
                  <Input
                    aria-label={`step-${idx}-label`}
                    value={step.label}
                    onChange={(e) => updateStep(idx, { label: e.target.value })}
                    placeholder="Label"
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move step up"
                    onClick={() => moveStep(idx, -1)}
                    disabled={idx === 0}
                    className="size-7"
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move step down"
                    onClick={() => moveStep(idx, 1)}
                    disabled={idx === steps.length - 1}
                    className="size-7"
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove step"
                    onClick={() => removeStep(idx)}
                    className="size-7"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
                <StepBody step={step} onChange={(patch) => updateStep(idx, patch)} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex items-center justify-between border-t border-border pt-4">
        <div className="flex gap-2">
          {canSaveInPlace ? (
            <Button onClick={handleSave} disabled={saving}>
              <Save className="size-3.5 mr-1" /> Save
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setSaveAsNewId('')} disabled={saving}>
            <Copy className="size-3.5 mr-1" /> Save as new
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
        {canDelete && (
          <Button variant="destructive" onClick={() => setConfirmingDelete(true)} disabled={saving}>
            <Trash2 className="size-3.5 mr-1" /> Delete
          </Button>
        )}
      </section>

      {saveAsNewId !== null && (
        <div className="rounded border border-border bg-card p-3 flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="wf-newid">New id</Label>
            <Input
              id="wf-newid"
              value={saveAsNewId}
              onChange={(e) => setSaveAsNewId(e.target.value)}
              placeholder="my-copy"
            />
          </div>
          <Button onClick={() => handleSaveAsNew(saveAsNewId)} disabled={saving}>
            Create copy
          </Button>
          <Button variant="ghost" onClick={() => setSaveAsNewId(null)} disabled={saving}>
            Cancel
          </Button>
        </div>
      )}

      {confirmingDelete && (
        <div className="rounded border border-red-500/40 bg-red-500/5 p-3 flex items-center justify-between">
          <span className="text-xs text-red-200">
            Permanently delete this workflow YAML?
          </span>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              Confirm delete
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Per-step body renderers ───────────────────────────────────────────────

function StepBody({
  step,
  onChange,
}: {
  step: WorkflowStep
  onChange: (patch: Partial<WorkflowStep>) => void
}) {
  switch (step.type) {
    case 'agent':
      return <AgentStepBody step={step} onChange={onChange} />
    case 'gate':
      return <GateStepBody step={step} onChange={onChange} />
    case 'output':
      return <OutputStepBody step={step} onChange={onChange} />
    case 'workflow':
      return <WorkflowStepBody step={step} onChange={onChange} />
    case 'parallel':
      return <ParallelStepReadOnly step={step as ParallelStep} />
  }
}

function AgentStepBody({
  step,
  onChange,
}: {
  step: AgentStep
  onChange: (patch: Partial<AgentStep>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">Agent</Label>
        <AgentSelect value={step.agent} onValueChange={(v) => onChange({ agent: v })} />
      </div>
      <div>
        <Label className="text-xs">Skill</Label>
        <Input
          value={step.skill ?? ''}
          onChange={(e) => onChange({ skill: e.target.value || undefined })}
          placeholder="skill name (optional)"
        />
      </div>
      <div className="col-span-2">
        <Label className="text-xs">Description</Label>
        <Textarea
          rows={2}
          value={step.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="What this step should do"
        />
      </div>
    </div>
  )
}

function GateStepBody({
  step,
  onChange,
}: {
  step: GateStep
  onChange: (patch: Partial<GateStep>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="col-span-2">
        <Label className="text-xs">Description</Label>
        <Textarea
          rows={2}
          value={step.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <Checkbox
          id={`gate-approval-${step.id}`}
          checked={step.approval_required ?? false}
          onCheckedChange={(checked) => onChange({ approval_required: checked === true })}
        />
        <Label htmlFor={`gate-approval-${step.id}`} className="text-xs">Approval required</Label>
      </div>
      <div>
        <Label className="text-xs">On approve · next step id</Label>
        <Input
          value={step.on_approve}
          onChange={(e) => onChange({ on_approve: e.target.value })}
          placeholder="next-step-id"
        />
      </div>
      <div>
        <Label className="text-xs">On reject · goto step id</Label>
        <Input
          value={step.on_reject?.goto ?? ''}
          onChange={(e) =>
            onChange({
              on_reject: e.target.value
                ? { goto: e.target.value, note_to_agent: step.on_reject?.note_to_agent }
                : undefined,
            })
          }
          placeholder="(optional) fallback step"
        />
      </div>
    </div>
  )
}

function OutputStepBody({
  step,
  onChange,
}: {
  step: OutputStep
  onChange: (patch: Partial<OutputStep>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">Agent (optional)</Label>
        <AgentSelect
          value={step.agent ?? ''}
          onValueChange={(v) => onChange({ agent: v || undefined })}
          allowNone
        />
      </div>
      <div>
        <Label className="text-xs">Channels (comma-separated)</Label>
        <Input
          value={(step.channels ?? []).join(', ')}
          onChange={(e) =>
            onChange({
              channels: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="discord, slack"
        />
      </div>
    </div>
  )
}

function WorkflowStepBody({
  step,
  onChange,
}: {
  step: NestedWorkflowStep
  onChange: (patch: Partial<NestedWorkflowStep>) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">Sub-workflow id</Label>
        <Input
          value={step.workflow_id}
          onChange={(e) => onChange({ workflow_id: e.target.value })}
          placeholder="other-workflow-id"
        />
      </div>
      <div>
        <Label className="text-xs">Description</Label>
        <Input
          value={step.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
        />
      </div>
    </div>
  )
}

function ParallelStepReadOnly({ step }: { step: ParallelStep }) {
  return (
    <div className="text-xs text-muted-foreground">
      Parallel step with {step.steps.length} children — edit directly in the YAML for now.
      Visual editor (Phase 2B) will replace this read-only display.
    </div>
  )
}

// Re-export the discriminated <Select> primitives so consumers don't have to
// import them separately when extending the editor.
export const _selectComponents = { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }
