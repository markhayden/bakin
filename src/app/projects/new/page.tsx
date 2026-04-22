'use client'

import { useRouter } from 'next/navigation'
import { Slot } from '@bakin/sdk/slots'

export default function Page() {
  const router = useRouter()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <Slot
        name="page:/projects/new"
        onBack={() => router.push('/projects')}
        initialEdit
        onEditChange={(editing: boolean) => {
          if (!editing) router.push('/projects')
        }}
      />
    </div>
  )
}
