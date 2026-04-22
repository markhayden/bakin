'use client'

import { useRouter } from 'next/navigation'
import { Slot } from '@bakin/sdk/slots'

export default function Page() {
  const router = useRouter()
  return (
    <Slot
      name="page:/workflows/new"
      mode="create"
      onSaved={(savedId: string) => router.push(`/workflows/${savedId}`)}
      onCancel={() => router.push('/workflows')}
    />
  )
}
