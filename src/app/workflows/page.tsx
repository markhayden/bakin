'use client'

import { Suspense } from 'react'
import { Slot } from '@bakin/sdk/slots'

export default function Page() {
  return (
    <Suspense>
      <Slot name="page:/workflows" />
    </Suspense>
  )
}
