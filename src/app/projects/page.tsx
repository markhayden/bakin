'use client'

import { Suspense } from 'react'
import { ProjectGrid } from '@bakin/projects/components/project-grid'

export default function ProjectsPage() {
  return (
    <div className="p-[5px] flex flex-col h-full min-w-0 overflow-hidden">
      <Suspense>
        <ProjectGrid />
      </Suspense>
    </div>
  )
}
