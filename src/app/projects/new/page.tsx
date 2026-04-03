'use client'

import { useRouter } from 'next/navigation'
import { ProjectDetail } from '@bakin/projects/components/project-detail'

export default function NewProjectPage() {
  const router = useRouter()

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      <ProjectDetail
        onBack={() => router.push('/projects')}
        initialEdit
        onEditChange={(editing) => {
          if (!editing) router.push('/projects')
        }}
      />
    </div>
  )
}
