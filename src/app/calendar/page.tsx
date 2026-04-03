'use client'

import { Suspense } from 'react'
import { ContentCalendar } from '@bakin/calendar/components/content-calendar'

export default function CalendarPage() {
  return (
    <div className="p-6 flex flex-col flex-1">
      <Suspense>
        <ContentCalendar />
      </Suspense>
    </div>
  )
}
