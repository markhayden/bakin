/**
 * /workflows/$id/edit — workflow canvas "edit" route.
 *
 * Mirrors `src/app/workflows/[id]/edit/page.tsx` — this one carries real
 * data-fetching logic in the wrapper (fetch the definition before
 * rendering so the canvas editor can hydrate from existing state). The
 * port keeps the same useEffect/useState flow; the WorkflowCanvasEditor
 * slot expects mode/initialId/initialDefinition/source/onSaved/
 * onDeleted/onCancel props.
 */
import { useEffect, useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'
import { Slot } from '@makinbakin/sdk/slots'
import type { WorkflowDefinition } from '@makinbakin/sdk/types'
import { Route as RootRoute } from './__root'

function WorkflowEditPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [source, setSource] = useState<'plugin' | 'agent-package' | 'user' | undefined>()
  const [shadowedSource, setShadowedSource] = useState<unknown>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDefinition() {
      try {
        const res = await fetch(`/api/plugins/workflows/definitions/${id}`)
        if (!res.ok) {
          setError(res.status === 404 ? 'Workflow not found' : 'Failed to load workflow')
          return
        }
        const data = await res.json()
        setDefinition(data.definition)
        setSource(data.source)
        setShadowedSource(data.shadowedSource)
      } catch {
        setError('Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }
    fetchDefinition()
  }, [id])

  if (loading) {
    return (
      <SystemState
        kind="loading"
        scope="page"
        title="Loading workflow"
        preview={
          <div className="flex flex-col gap-bakin-3">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        }
      />
    )
  }

  if (error || !definition) {
    return (
      <SystemState
        kind="error"
        scope="page"
        title={error ?? 'Workflow not found'}
        description="The workflow definition could not be loaded from this address."
        action={
          <Button variant="outline" onClick={() => navigate({ to: '/workflows' })}>
            Back to workflows
          </Button>
        }
      />
    )
  }

  return (
    <Slot
      name="page:/workflows/[id]/edit"
      mode="edit"
      initialId={id}
      initialDefinition={definition}
      source={source}
      shadowedSource={shadowedSource}
      onSaved={(savedId: string) => navigate({ to: '/workflows/$id', params: { id: savedId } })}
      onCopied={(copiedId: string) => navigate({ to: '/workflows/$id/edit', params: { id: copiedId } })}
      onDeleted={() => navigate({ to: '/workflows' })}
      onCancel={() => navigate({ to: '/workflows' })}
    />
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/workflows/$id/edit',
  component: WorkflowEditPage,
})
