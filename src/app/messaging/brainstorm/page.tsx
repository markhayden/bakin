'use client'

import { Suspense } from 'react'
import { BrainstormView } from '@bakin/messaging/components/brainstorm-view'

export default function MessagingBrainstormPage() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Suspense>
        <BrainstormView />
      </Suspense>
    </div>
  )
}
