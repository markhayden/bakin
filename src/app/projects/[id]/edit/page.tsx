'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { ProjectDetail } from '@bakin/projects/components/project-detail'

export default function ProjectEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <ProjectDetail
        projectId={id}
        onBack={() => router.push('/projects')}
        initialEdit
        onEditChange={(editing) => {
          if (!editing) router.replace(`/projects/${id}`, { scroll: false })
        }}
      />
    </div>
  )
}
