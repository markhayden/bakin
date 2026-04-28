'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from '@bakin/sdk/hooks'
import { Plus, ListFilter, FolderKanban } from 'lucide-react'
import { Button } from "@bakin/sdk/ui"
import { PluginHeader } from "@bakin/sdk/components"
import { EmptyState } from "@bakin/sdk/components"
import { Skeleton } from "@bakin/sdk/ui"
import { useQueryState } from "@bakin/sdk/hooks"
import { useSearch } from "@bakin/sdk/hooks"
import { useDebug } from "@bakin/sdk/hooks"
import { ProjectCard } from './project-card'
import type { ProjectSummary, ProjectStatus } from '../types'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

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
  const [debug] = useDebug()

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

  const searchHook = useSearch({ plugin: 'projects', facets: ['status'], debounce: 300 })
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Build a score map keyed by project id. Projects index with the raw
  // project.id (no search key prefix — see plugins/projects/index.ts reindex), so
  // no prefix-strip is needed. Used for both the relevance reorder AND the
  // debug-mode RRF/BM25/SEM overlay.
  const scoreMap = useMemo(() => {
    const map = new Map<string, ScoreInfo>()
    for (const r of searchHook.results) {
      map.set(r.id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [searchHook.results])

  const filtered = useMemo(() => {
    if (!search.trim()) return projects
    if (searchHook.results.length) {
      return projects
        .filter(p => scoreMap.has(p.id))
        .sort((a, b) => (scoreMap.get(b.id)?.score ?? 0) - (scoreMap.get(a.id)?.score ?? 0))
    }
    const q = search.toLowerCase()
    return projects.filter(p => p.title.toLowerCase().includes(q))
  }, [projects, search, searchHook.results, scoreMap])

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={search ? 'No matching projects' : status === 'all' ? 'No projects yet' : `No ${status} projects`}
            description={!search && status === 'all' ? 'Create one to get started.' : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => {
              const scoreInfo = scoreMap.get(p.id)
              const showScores = debug && scoreInfo && search.trim()
              const semKey = 'embeddings'
              const bm25Key = scoreInfo?.indexScores
                ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
                : undefined
              return (
                <div key={p.id} className="relative">
                  <ProjectCard
                    project={p}
                    onClick={() => router.push(`/projects/${p.id}`)}
                  />
                  {showScores && scoreInfo && (
                    <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 font-mono text-[10px] bg-black/80 px-1.5 py-1 rounded pointer-events-none">
                      <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
                      <span className="text-cyan-400">
                        BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
                      </span>
                      <span className="text-purple-400">
                        SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
