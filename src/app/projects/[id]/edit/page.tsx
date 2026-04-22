'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { Slot } from '@bakin/sdk/slots'

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Slot
        name="page:/projects/[id]/edit"
        projectId={id}
        onBack={() => router.push('/projects')}
        initialEdit
        onEditChange={(editing: boolean) => {
          if (!editing) router.replace(`/projects/${id}`, { scroll: false })
        }}
      />
    </div>
  )
}
