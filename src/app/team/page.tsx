'use client'

import { Suspense } from 'react'
import { TeamGrid } from '@bakin/team/components/team-grid'

export default function TeamPage() {
  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <TeamGrid />
      </Suspense>
    </div>
  )
}
