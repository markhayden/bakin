'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@makinbakin/sdk/hooks'
import { ArrowLeft, Workflow, Lock, Pencil, GitBranch } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Switch } from "@makinbakin/sdk/ui"
import { WorkflowCanvas } from './workflow-canvas'
import { StepDetailDrawer } from './step-detail-drawer'
import { ManagedWorkflowCopyDialog } from './managed-workflow-copy-dialog'
import {
  clearWorkflowDialogFieldError,
  hasWorkflowDialogFieldErrors,
  parseWorkflowDialogServerError,
  validateWorkflowDialogFields,
  type WorkflowDialogFieldErrors,
} from './workflow-dialog-validation'
import { WorkflowDeleteAction } from './workflow-delete-action'
import type { WorkflowDefinition, WorkflowStep, ParallelStep, NestedWorkflowStep, WorkflowShadowedSource } from '../types'

/** Find a step by ID in the step tree (top-level, parallel children, sub-workflow expansions) */
function findStepById(
  steps: WorkflowStep[],
  nodeId: string,
  subWorkflows?: Record<string, WorkflowDefinition>,
): WorkflowStep | null {
  for (const step of steps) {
    if (step.id === nodeId) return step

    // Check parallel children
    if (step.type === 'parallel') {
      const parallel = step as ParallelStep
      for (const child of parallel.steps) {
        if (child.id === nodeId) return child
      }
    }

    // Check sub-workflow steps (node IDs are prefixed: parentId__childId)
    if (step.type === 'workflow' && subWorkflows) {
      const nested = step as NestedWorkflowStep
      const subDef = subWorkflows[nested.workflow_id]
      if (subDef) {
        // Try stripping the prefix and searching recursively
        const prefix = step.id + '__'
        if (nodeId.startsWith(prefix)) {
          const childId = nodeId.slice(prefix.length)
          const found = findStepById(subDef.steps, childId, subWorkflows)
          if (found) return found
        }
        // Also try direct match in sub-workflow
        const found = findStepById(subDef.steps, nodeId, subWorkflows)
        if (found) return found
      }
    }
  }
  return null
}

/** Recursively search for a step across the full node ID space (handles deeply nested prefixes) */
function findStepByNodeId(
  definition: WorkflowDefinition,
  nodeId: string,
  subWorkflows?: Record<string, WorkflowDefinition>,
): WorkflowStep | null {
  // Direct match first
  const direct = findStepById(definition.steps, nodeId, subWorkflows)
  if (direct) return direct

  // Try stripping nested prefixes progressively
  const parts = nodeId.split('__')
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join('__')
    const found = findStepById(definition.steps, suffix, subWorkflows)
    if (found) return found
  }

  return null
}

interface WorkflowDetailProps {
  workflowId: string
  onBack: () => void
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function WorkflowDetail({ workflowId, onBack }: WorkflowDetailProps) {
  const router = useRouter()
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [subWorkflows, setSubWorkflows] = useState<Record<string, WorkflowDefinition>>({})
  const [source, setSource] = useState<'plugin' | 'agent-package' | 'user' | undefined>()
  const [shadowedSource, setShadowedSource] = useState<WorkflowShadowedSource | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [copyFieldErrors, setCopyFieldErrors] = useState<WorkflowDialogFieldErrors>({})
  const [creatingCopy, setCreatingCopy] = useState(false)
  const [copyName, setCopyName] = useState('')
  const [copyId, setCopyId] = useState('')
  const [copyIdEdited, setCopyIdEdited] = useState(false)
  const [disableOriginal, setDisableOriginal] = useState(true)
  const [workflowDisabled, setWorkflowDisabled] = useState(false)
  const [availabilitySaving, setAvailabilitySaving] = useState(false)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDefinition() {
      try {
        const res = await fetch(`/api/plugins/workflows/definitions/${workflowId}`)
        if (!res.ok) {
          setError(res.status === 404 ? 'Workflow not found' : 'Failed to load workflow')
          return
        }
        const data = await res.json()
        const loadedDefinition = data.definition as WorkflowDefinition
        const defaultCopyName = loadedDefinition.name ? `${loadedDefinition.name} Copy` : `${workflowId} Copy`
        setDefinition(loadedDefinition)
        setSubWorkflows(data.subWorkflows ?? {})
        setSource(data.source)
        setShadowedSource(data.shadowedSource)
        setWorkflowDisabled(data.disabled === true)
        setAvailabilityError(null)
        setCopyError(null)
        setCopyFieldErrors({})
        setCopyName(defaultCopyName)
        setCopyId(slugify(defaultCopyName))
        setCopyIdEdited(false)
        setDisableOriginal(true)
      } catch {
        setError('Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }
    fetchDefinition()
  }, [workflowId])

  const handleNodeClick = useCallback((nodeId: string) => {
    if (!definition) return
    // Skip trigger and subflow group nodes
    if (nodeId === '__trigger' || nodeId.endsWith('__trigger')) return

    const step = findStepByNodeId(definition, nodeId, subWorkflows)
    if (step) {
      setSelectedStep(step)
      setDrawerOpen(true)
    }
  }, [definition, subWorkflows])

  const isManagedSource = source === 'plugin' || source === 'agent-package'
  const canDelete = source === 'user'

  function handlePrimaryEditAction() {
    if (workflowDisabled) return
    if (!isManagedSource) {
      router.push(`/workflows/${workflowId}/edit`)
      return
    }
    setCopyError(null)
    setCopyFieldErrors({})
    setCopyOpen(true)
  }

  async function handleAvailabilityChange(nextEnabled: boolean) {
    if (!isManagedSource) return
    const nextDisabled = !nextEnabled
    const previousDisabled = workflowDisabled

    setWorkflowDisabled(nextDisabled)
    setAvailabilitySaving(true)
    setAvailabilityError(null)
    try {
      const availabilityRes = await fetch(`/api/plugins/workflows/definitions/${workflowId}/availability`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: nextDisabled }),
      })
      const availabilityData = (await availabilityRes.json().catch(() => ({}))) as Record<string, unknown>
      if (!availabilityRes.ok) {
        setWorkflowDisabled(previousDisabled)
        setAvailabilityError((availabilityData.error as string | undefined) || `Availability update failed (${availabilityRes.status})`)
        return
      }
      setWorkflowDisabled(availabilityData.disabled === true)
    } catch (e) {
      setWorkflowDisabled(previousDisabled)
      setAvailabilityError((e as Error).message)
    } finally {
      setAvailabilitySaving(false)
    }
  }

  async function handleCreateCopy() {
    if (!definition) return
    const nextId = copyId.trim()
    const nextName = copyName.trim()
    const fieldErrors = validateWorkflowDialogFields({
      id: nextId,
      name: nextName,
      nameRequiredMessage: 'Copy name is required.',
    })
    if (hasWorkflowDialogFieldErrors(fieldErrors)) {
      setCopyFieldErrors(fieldErrors)
      setCopyError(null)
      return
    }

    setCreatingCopy(true)
    setCopyError(null)
    setCopyFieldErrors({})
    try {
      const nextDefinition = {
        ...definition,
        id: nextId,
        name: nextName,
      }
      const createRes = await fetch('/api/plugins/workflows/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextDefinition, id: nextId }),
      })
      const createData = (await createRes.json().catch(() => ({}))) as Record<string, unknown>
      if (!createRes.ok) {
        const parsedError = parseWorkflowDialogServerError(createData, `Copy failed (${createRes.status})`)
        setCopyFieldErrors(parsedError.fieldErrors)
        setCopyError(parsedError.error)
        return
      }

      if (disableOriginal) {
        const availabilityRes = await fetch(`/api/plugins/workflows/definitions/${workflowId}/availability`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: true }),
        })
        if (!availabilityRes.ok) {
          const availabilityData = (await availabilityRes.json().catch(() => ({}))) as Record<string, unknown>
          setCopyError((availabilityData.error as string | undefined) || `Copied, but disabling the managed workflow failed (${availabilityRes.status})`)
        } else {
          setWorkflowDisabled(true)
        }
      }

      router.push(`/workflows/${nextId}/edit`)
    } catch (e) {
      setCopyError((e as Error).message)
    } finally {
      setCreatingCopy(false)
    }
  }

  async function handleDeleteWorkflow() {
    if (!canDelete) return false

    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/plugins/workflows/definitions/${workflowId}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setDeleteError((data.error as string | undefined) || `Delete failed (${res.status})`)
        return false
      }
      onBack()
      return true
    } catch (e) {
      setDeleteError((e as Error).message)
      return false
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col animate-pulse">
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="h-4 w-4 rounded bg-zinc-800" />
          <div className="h-5 w-48 rounded bg-zinc-800" />
        </div>
        <div className="flex-1 bg-zinc-950" />
      </div>
    )
  }

  if (error || !definition) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">{error || 'Workflow not found'}</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4 mr-1" /> Back to Workflows
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="size-8">
          <ArrowLeft className="size-4" />
        </Button>
        <Workflow className="size-4 text-amber-400" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-medium truncate">{definition.name}</h1>
          {definition.description && (
            <p className="text-xs text-muted-foreground truncate">{definition.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {isManagedSource && (
            <div
              className={`flex items-center gap-2 ${availabilitySaving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              title="Controls whether this managed workflow is available for matching and automatic starts"
            >
              <Switch
                size="sm"
                checked={!workflowDisabled}
                onCheckedChange={handleAvailabilityChange}
                disabled={availabilitySaving}
                aria-label={workflowDisabled ? 'Enable workflow' : 'Disable workflow'}
              />
              <span className={`select-none text-xs font-medium ${workflowDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                {workflowDisabled ? 'Disabled' : 'Enabled'}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrimaryEditAction}
            title={isManagedSource ? 'Create an editable copy of this workflow' : 'Edit workflow'}
            disabled={workflowDisabled}
          >
            <Pencil className="size-3.5 mr-1" />
            Edit
          </Button>
          {canDelete && (
            <WorkflowDeleteAction
              workflowName={definition.name || workflowId}
              deleting={deleting}
              error={deleteError}
              onClearError={() => setDeleteError(null)}
              onDelete={handleDeleteWorkflow}
            />
          )}
        </div>
      </div>

      {availabilityError && (
        <div className="border-b border-border bg-destructive/10 px-6 py-2 text-xs text-destructive">
          {availabilityError}
        </div>
      )}

      {isManagedSource && workflowDisabled && (
        <div className="flex items-center gap-2 border-b border-border bg-destructive/10 px-6 py-2 text-xs text-destructive">
          <Lock className="size-3.5" />
          <span>
            Disabled: matching and automatic starts skip this workflow. Enable it before editing or creating a copy.
          </span>
        </div>
      )}

      {/* Read-only banner — managed definitions cannot be edited in place */}
      {isManagedSource && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-6 py-2 text-xs text-amber-200">
          <Lock className="size-3.5" />
          <span>
            This workflow is managed by Bakin directly. If you&apos;d like to make changes select &ldquo;Edit&rdquo; and create a copy when prompted. You&apos;ll optionally be able to disable this default workflow as well.
          </span>
        </div>
      )}

      {source === 'user' && shadowedSource && (
        <div className="flex items-center gap-2 border-b border-border bg-cyan-500/10 px-6 py-2 text-xs text-cyan-200">
          <GitBranch className="size-3.5" />
          <span>
            This custom workflow shadows a managed default with the same id.
          </span>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <WorkflowCanvas
          definition={definition}
          subWorkflows={subWorkflows}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* Step detail drawer */}
      <StepDetailDrawer
        step={selectedStep}
        allSteps={definition.steps}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      <ManagedWorkflowCopyDialog
        open={copyOpen}
        creating={creatingCopy}
        error={copyError}
        fieldErrors={copyFieldErrors}
        copyName={copyName}
        copyId={copyId}
        disableOriginal={disableOriginal}
        onOpenChange={(open) => {
          setCopyOpen(open)
          if (!open) {
            setCopyError(null)
            setCopyFieldErrors({})
          }
        }}
        onCopyNameChange={(value) => {
          setCopyName(value)
          setCopyError(null)
          setCopyFieldErrors((prev) => (
            copyIdEdited
              ? clearWorkflowDialogFieldError(prev, 'name')
              : clearWorkflowDialogFieldError(prev, 'name', 'id')
          ))
          if (!copyIdEdited) setCopyId(slugify(value))
        }}
        onCopyIdChange={(value) => {
          setCopyIdEdited(true)
          setCopyError(null)
          setCopyFieldErrors((prev) => clearWorkflowDialogFieldError(prev, 'id'))
          setCopyId(slugify(value))
        }}
        onDisableOriginalChange={setDisableOriginal}
        onCancel={() => setCopyOpen(false)}
        onCreate={handleCreateCopy}
      />

    </div>
  )
}
