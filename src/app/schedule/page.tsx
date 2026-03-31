'use client'

import { Suspense } from 'react'
import { SchedulePage } from '../../../plugins/schedule/components/schedule-page'

export default function Page() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <SchedulePage />
      </Suspense>
    </div>
  )
}
