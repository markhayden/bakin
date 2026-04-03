'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { WorkflowDetail } from '@bakin/workflows/components/workflow-detail'

export default function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  return (
    <WorkflowDetail
      workflowId={id}
      onBack={() => router.push('/workflows')}
    />
  )
}
