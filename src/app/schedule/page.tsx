'use client'

import { AlarmClock } from 'lucide-react'

export default function SchedulePage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <AlarmClock className="h-12 w-12 stroke-[1.5]" />
      <h1 className="text-lg font-semibold text-foreground">Schedule</h1>
      <p className="text-sm">Coming soon</p>
    </div>
  )
}
