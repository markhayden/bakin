'use client'

import { use, Suspense } from 'react'
import { AgentDetail } from '@bakin/team/components/agent-detail'

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Suspense fallback={null}>
        <AgentDetail agentId={id} />
      </Suspense>
    </div>
  )
}
