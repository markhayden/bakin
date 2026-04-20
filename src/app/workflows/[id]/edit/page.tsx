'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { WorkflowEditor } from '@bakin/workflows/components/workflow-editor'
import { Skeleton } from '@/components/ui/skeleton'
import type { WorkflowDefinition } from '@bakin/workflows/types'

export default function EditWorkflowRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [source, setSource] = useState<'plugin' | 'user' | undefined>()
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
      <div className="p-6 max-w-3xl mx-auto flex flex-col gap-3">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error || !definition) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-sm text-muted-foreground">
        {error ?? 'Workflow not found'}
      </div>
    )
  }

  return (
    <WorkflowEditor
      mode="edit"
      initialId={id}
      initialDefinition={definition}
      source={source}
      onSaved={(savedId) => router.push(`/workflows/${savedId}`)}
      onDeleted={() => router.push('/workflows')}
      onCancel={() => router.push(`/workflows/${id}`)}
    />
  )
}
