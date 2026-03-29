'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus } from 'lucide-react'
import { ProjectCard } from './project-card'
import { ProjectDetail } from './project-detail'
import type { ProjectSummary, ProjectStatus } from '../types'

const TABS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Archived', value: 'archived' },
]

export function ProjectGrid() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [filter, setFilter] = useState<ProjectStatus | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProjects = useCallback(async () => {
    try {
      const url = filter === 'all'
        ? '/api/plugins/projects/list'
        : `/api/plugins/projects/list?status=${filter}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects)
      }
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleNew = async () => {
    const res = await fetch('/api/plugins/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled Project', owner: 'main-operator' }),
    })
    if (res.ok) {
      const data = await res.json()
      setSelectedId(data.id)
    }
  }

  // If a project is selected, show detail view
  if (selectedId) {
    return (
      <ProjectDetail
        projectId={selectedId}
        onBack={() => { setSelectedId(null); fetchProjects() }}
      />
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-foreground">Projects</h1>
        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 text-sm text-white hover:bg-blue-500 transition-colors"
        >
          <Plus className="size-4" />
          New Project
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === tab.value
                ? 'bg-zinc-700 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {filter === 'all' ? 'No projects yet. Create one to get started.' : `No ${filter} projects.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onClick={() => setSelectedId(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
