'use client'

import { useRouter } from 'next/navigation'
import { WorkflowEditor } from '@bakin/workflows/components/workflow-editor'

export default function NewWorkflowRoute() {
  const router = useRouter()
  return (
    <WorkflowEditor
      mode="create"
      onSaved={(id) => router.push(`/workflows/${id}`)}
      onCancel={() => router.push('/workflows')}
    />
  )
}
