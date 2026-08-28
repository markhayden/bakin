'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@makinbakin/sdk/hooks'
import {
  PageHeader,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
  PageBody,
  PageCanvas,
} from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, DropdownMenuItem, Field, FieldLabel, Skeleton, Switch, SystemState } from '@makinbakin/sdk/ui'
import { cn } from '@makinbakin/sdk/utils'
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react'
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
import { WorkflowDeleteDialog } from './workflow-delete-action'
import type { WorkflowDefinition, WorkflowStep, ParallelStep, NestedWorkflowStep, WorkflowShadowedSource, WorkflowSkillDriftSummary } from '../types'

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
  const [skillDrift, setSkillDrift] = useState<WorkflowSkillDriftSummary | undefined>()
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const fetchDefinition = useCallback(async (options: { preserveLoading?: boolean } = {}) => {
    if (!options.preserveLoading) setLoading(true)
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
      setSkillDrift(data.skillDrift)
      setWorkflowDisabled(data.disabled === true)
      setAvailabilityError(null)
      setCopyError(null)
      setCopyFieldErrors({})
      setCopyName(defaultCopyName)
      setCopyId(slugify(defaultCopyName))
      setCopyIdEdited(false)
      setDisableOriginal(true)
      setError(null)
    } catch {
      setError('Failed to load workflow')
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    fetchDefinition()
  }, [fetchDefinition])

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
      <WorkspacePage>
        <WorkspacePageHeader>
          <PageHeader eyebrow="Workflows / detail" title="Workflow" />
        </WorkspacePageHeader>
        <WorkspacePageBody className="px-bakin-4 @md/page-shell:px-bakin-6 @xl/page-shell:px-bakin-8">
          <PageBody
            gap="content"
            className="w-full"
            state={(
              <SystemState
                kind="loading"
                scope="page"
                title="Loading workflow"
                description="The workflow graph and step details will appear when ready."
                preview={<Skeleton className="h-32 w-full" />}
              />
            )}
          />
        </WorkspacePageBody>
      </WorkspacePage>
    )
  }

  if (error || !definition) {
    return (
      <WorkspacePage>
        <WorkspacePageHeader>
          <PageHeader
            navigation={(
              <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to workflows">
                <ArrowLeft aria-hidden="true" />
              </Button>
            )}
            eyebrow="Workflows / detail"
            title="Workflow not found"
          />
        </WorkspacePageHeader>
        <WorkspacePageBody className="px-bakin-4 @md/page-shell:px-bakin-6 @xl/page-shell:px-bakin-8">
          <PageBody
            gap="content"
            className="w-full"
            state={(
              <SystemState
                kind="error"
                recovery="available"
                scope="page"
                title="Workflow not found"
                description={error || 'This workflow may have been removed or is currently unavailable.'}
                action={<Button variant="outline" onClick={onBack}>Back to Workflows</Button>}
              />
            )}
          />
        </WorkspacePageBody>
      </WorkspacePage>
    )
  }

  const hasFeedback = Boolean(
    availabilityError
      || isManagedSource
      || (source === 'user' && shadowedSource)
      || skillDrift,
  )
  const feedback = hasFeedback ? (
    <>
      {availabilityError ? (
        <Banner
          tone="danger"
          title="Availability update failed"
          description={availabilityError}
          announce="polite"
        />
      ) : null}
      {isManagedSource && workflowDisabled ? (
        <Banner
          tone="danger"
          title="Workflow disabled"
          description="Matching and automatic starts skip this workflow. Enable it before editing or creating a copy."
        />
      ) : null}
      {isManagedSource ? (
        <Banner
          tone="info"
          title="Managed workflow"
          description={(
            <>
              This workflow is managed by Bakin directly. Select <strong>Edit</strong> to create a custom copy without changing the managed definition.
            </>
          )}
        />
      ) : null}
      {source === 'user' && shadowedSource ? (
        <Banner
          tone="info"
          title="Custom override"
          description="This custom workflow shadows a managed default with the same id."
        />
      ) : null}
      {skillDrift ? (
        <Banner
          tone="attention"
          title={skillDrift.count === 1 ? 'Stale workflow skill' : `${skillDrift.count} stale workflow skills`}
          description={(
            <>
              This workflow uses {skillDrift.count === 1 ? 'a stale workflow skill' : `${skillDrift.count} stale workflow skills`}. Open a highlighted step to review its impact and available repair options.
            </>
          )}
        />
      ) : null}
    </>
  ) : null

  return (
    <WorkspacePage mode="immersive">
      <WorkspacePageHeader>
        <PageHeader
        navigation={(
          <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to workflows">
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        eyebrow="Workflows / detail"
        measure="wide"
        title={definition.name}
        description={definition.description || 'Review the workflow sequence and open any step for its configuration and status.'}
        meta={(
          <>
            <Badge tone={isManagedSource ? 'accent' : 'neutral'} variant="solid" size="xs">
              {isManagedSource ? 'Managed' : 'Custom'}
            </Badge>
            <Badge tone="neutral" variant="solid" size="xs">
              {definition.steps.length} {definition.steps.length === 1 ? 'step' : 'steps'}
            </Badge>
            <code className="font-bakin-typography-family-mono">{workflowId}</code>
          </>
        )}
        actions={(
          <div
            className="flex w-full min-w-0 items-center gap-bakin-2 @3xl/page-header:w-auto"
            data-workflow-header-actions
          >
            {isManagedSource ? (
              <Field
                orientation="horizontal"
                name="availability"
                disabled={availabilitySaving}
                className={cn('min-h-bakin-control shrink-0', availabilitySaving && 'cursor-not-allowed')}
              >
                <Switch
                  size="sm"
                  checked={!workflowDisabled}
                  onCheckedChange={handleAvailabilityChange}
                  disabled={availabilitySaving}
                />
                <FieldLabel className={cn(workflowDisabled && 'text-bakin-text-muted')}>
                  {workflowDisabled ? 'Disabled' : 'Enabled'}
                </FieldLabel>
              </Field>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 @3xl/page-header:flex-none"
              onClick={handlePrimaryEditAction}
              disabled={workflowDisabled}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          </div>
        )}
        overflowActionsLabel="Workflow actions"
        overflowActions={canDelete ? (
          <DropdownMenuItem
            variant="danger"
            disabled={deleting}
            onClick={() => {
              setDeleteError(null)
              setDeleteDialogOpen(true)
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        ) : undefined}
        />
      </WorkspacePageHeader>
      <WorkspacePageCompactHeader
        navigation={(
          <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to workflows">
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        title={definition.name}
        action={(
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrimaryEditAction}
            disabled={workflowDisabled}
          >
            <Pencil aria-hidden="true" />
            Edit
          </Button>
        )}
        overflowActionsLabel="Workflow actions"
        overflowActions={canDelete ? (
          <DropdownMenuItem
            variant="danger"
            disabled={deleting}
            onClick={() => {
              setDeleteError(null)
              setDeleteDialogOpen(true)
            }}
          >
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        ) : undefined}
      />

      <WorkflowDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeleteError(null)
        }}
        workflowName={definition.name || workflowId}
        deleting={deleting}
        error={deleteError}
        onDelete={handleDeleteWorkflow}
      />

      <WorkspacePageBody>
        <PageBody
          gap="content"
          className="w-full gap-0"
          feedback={feedback ? (
            <div className="grid gap-bakin-2 px-bakin-4 pb-bakin-4 @md/page-shell:px-bakin-6 @xl/page-shell:px-bakin-8">
              {feedback}
            </div>
          ) : undefined}
        >
          <PageCanvas
            orientation="vertical"
            className="min-h-32 flex-1 overflow-hidden rounded-none border-x-0 border-y-0 @md/page-shell:border-t"
            label="Workflow graph"
          >
            <WorkflowCanvas
              definition={definition}
              subWorkflows={subWorkflows}
              skillDrift={skillDrift}
              onNodeClick={handleNodeClick}
            />
          </PageCanvas>
        </PageBody>
      </WorkspacePageBody>

      {/* Step detail drawer */}
      <StepDetailDrawer
        step={selectedStep}
        allSteps={definition.steps}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        skillDrift={skillDrift}
        onSkillRepaired={() => fetchDefinition({ preserveLoading: true })}
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

    </WorkspacePage>
  )
}
