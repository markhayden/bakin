'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PluginHeader } from '@/components/plugin-header'
import { FacetFilter, type FacetOption } from '@/components/facet-filter'
import { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
import { useSearch } from '@/hooks/use-search'
import { useDebug } from '@/hooks/use-debug'
import { ProjectCard } from './project-card'
import type { ProjectSummary, ProjectStatus } from '../types'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

const STATUS_OPTIONS: FacetOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

const STATUS_VALUES: ReadonlySet<ProjectStatus> = new Set(['draft', 'active', 'completed', 'archived'])

export function ProjectGrid() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)

  const [statusFilter, setStatusFilter] = useQueryArrayState('status')
  const [search, setSearch] = useQueryState('q', '')
  const [debug] = useDebug()

  // When exactly one status is selected we can ask the server to narrow the
  // query; otherwise we fetch everything and apply the filter client-side so
  // multi-select works without multi-request fan-out.
  const serverStatus = statusFilter.length === 1 ? statusFilter[0] : undefined

  const fetchProjects = useCallback(async () => {
    try {
      const url = serverStatus
        ? `/api/plugins/projects/?status=${serverStatus}`
        : '/api/plugins/projects/'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects)
      }
    } finally {
      setLoading(false)
    }
  }, [serverStatus])

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
  // project.id (no Antfly prefix — see plugins/projects/index.ts reindex), so
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
    // Multi-status client filter (single-status is already handled server-side).
    let base = projects
    if (statusFilter.length > 1) {
      const wanted = new Set(statusFilter.filter((s): s is ProjectStatus => STATUS_VALUES.has(s as ProjectStatus)))
      base = base.filter(p => wanted.has(p.status))
    }
    if (!search.trim()) return base
    if (searchHook.results.length) {
      return base
        .filter(p => scoreMap.has(p.id))
        .sort((a, b) => (scoreMap.get(b.id)?.score ?? 0) - (scoreMap.get(a.id)?.score ?? 0))
    }
    // While the search hook is in flight, keep the full list visible
    // instead of flashing "no matching projects" during the 300ms
    // debounce window before Antfly returns.
    if (searchHook.loading) return base
    const q = search.toLowerCase()
    return base.filter(p => p.title.toLowerCase().includes(q))
  }, [projects, statusFilter, search, searchHook.results, searchHook.loading, scoreMap])

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
        <FacetFilter
          label="Status"
          options={STATUS_OPTIONS}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading projects...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {search ? 'No matching projects.' : statusFilter.length === 0 ? 'No projects yet. Create one to get started.' : `No ${statusFilter.join('/')} projects.`}
          </div>
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
