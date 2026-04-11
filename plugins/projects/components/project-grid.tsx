'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PluginHeader } from '@/components/plugin-header'
import { useQueryState } from '@/hooks/use-query-state'
import { useAntflySearch, reorderByAntflyResults } from '@/hooks/use-antfly-search'
import { ProjectCard } from './project-card'
import type { ProjectSummary, ProjectStatus } from '../types'

const STATUS_TABS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Completed', value: 'completed' },
  { label: 'Archived', value: 'archived' },
]

export function ProjectGrid() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  const [status, setStatus] = useQueryState('status', 'all')
  const [search, setSearch] = useQueryState('q', '')

  const fetchProjects = useCallback(async () => {
    try {
      const url = status === 'all'
        ? '/api/plugins/projects/'
        : `/api/plugins/projects/?status=${status}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects)
      }
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const antfly = useAntflySearch({ table: 'projects', facets: ['status'], debounce: 300 })
  useEffect(() => {
    if (search) antfly.search(search)
    else antfly.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filtered = useMemo(() => {
    if (!search.trim()) return projects
    if (antfly.results.length) {
      const matchIds = new Set(antfly.results.map(r => r.id))
      const scoreMap = new Map(antfly.results.map(r => [r.id, r.score]))
      return projects
        .filter(p => matchIds.has(p.id))
        .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
    }
    const q = search.toLowerCase()
    return projects.filter(p => p.title.toLowerCase().includes(q))
  }, [projects, search, antfly.results])

  const handleNew = () => {
    router.push('/projects/new')
  }

  return (
    <div className="p-6 flex flex-col h-full min-h-0 gap-4">
      {/* Header */}
      <PluginHeader
        title="Projects"
        count={loading ? undefined : filtered.length}
        search={{ value: search, onChange: setSearch, placeholder: 'Search projects...' }}
        actions={
          <Button size="sm" onClick={handleNew}>
            <Plus className="size-4" />
            New Project
          </Button>
        }
      />

      {/* Status filter */}
      <div className="flex items-center gap-3">
        <ListFilter className="size-3.5 text-muted-foreground shrink-0" />
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatus(tab.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                status === tab.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading projects...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {search ? 'No matching projects.' : status === 'all' ? 'No projects yet. Create one to get started.' : `No ${status} projects.`}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onClick={() => router.push(`/projects/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
