'use client'

import { Suspense } from 'react'
import { Slot } from '@bakin/sdk/slots'

export default function Page() {
  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <Slot name="page:/team" />
      </Suspense>
    </div>
  )
}
