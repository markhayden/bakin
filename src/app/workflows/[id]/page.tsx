'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { Slot } from '@bakin/sdk/slots'

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  return (
    <Slot
      name="page:/workflows/[id]"
      workflowId={id}
      onBack={() => router.push('/workflows')}
    />
  )
}
