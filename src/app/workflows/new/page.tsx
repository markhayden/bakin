'use client'

import { useRouter } from 'next/navigation'
import { WorkflowCanvasEditor } from '@bakin/workflows/components/workflow-canvas-editor'

export default function NewWorkflowRoute() {
  const router = useRouter()
  return (
    <WorkflowCanvasEditor
      mode="create"
      onSaved={(id) => router.push(`/workflows/${id}`)}
      onCancel={() => router.push('/workflows')}
    />
  )
}
