'use client'

import { use, Suspense } from 'react'
import { Slot } from '@bakin/sdk/slots'

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Suspense fallback={null}>
        <Slot name="page:/team/[id]" agentId={id} />
      </Suspense>
    </div>
  )
}
