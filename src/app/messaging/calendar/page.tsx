'use client'

import { Suspense } from 'react'
import { Slot } from '@bakin/sdk/slots'

export default function Page() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Suspense>
        <Slot name="page:/messaging/calendar" />
      </Suspense>
    </div>
  )
}
