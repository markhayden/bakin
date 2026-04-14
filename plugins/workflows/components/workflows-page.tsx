'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { PluginHeader } from '@/components/plugin-header'
import { useQueryState } from '@/hooks/use-query-state'
import { useSearch } from '@/hooks/use-search'
import { useDebug } from '@/hooks/use-debug'
import { WorkflowCard } from './workflow-card'
import type { WorkflowTemplate } from '../types'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

export function WorkflowsPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useQueryState('q', '')
  const [debug] = useDebug()

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/workflows/definitions')
      const data = await res.json()
      setTemplates(data.templates ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const searchHook = useSearch({ plugin: 'workflows', facets: ['type', 'status'], debounce: 300 })
  useEffect(() => {
    if (search) searchHook.search(search)
    else searchHook.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Build a score map keyed by workflow name (stripping the `def:` Antfly prefix).
  // Used for both the relevance reorder AND the debug-mode RRF/BM25/SEM overlay.
  const scoreMap = useMemo(() => {
    const map = new Map<string, ScoreInfo>()
    for (const r of searchHook.results) {
      const id = r.id.startsWith('def:') ? r.id.slice('def:'.length) : r.id
      map.set(id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [searchHook.results])

  const filtered = useMemo(() => {
    if (!search.trim()) return templates
    if (searchHook.results.length) {
      return templates
        .filter(t => scoreMap.has(t.name))
        .sort((a, b) => (scoreMap.get(b.name)?.score ?? 0) - (scoreMap.get(a.name)?.score ?? 0))
    }
    const q = search.toLowerCase()
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    )
  }, [templates, search, searchHook.results, scoreMap])

  return (
    <div className="p-6 flex flex-col h-full min-h-0 gap-4">
      <PluginHeader
        title="Workflows"
        count={loading ? undefined : filtered.length}
        search={{ value: search, onChange: setSearch, placeholder: 'Search workflows...' }}
      />

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading workflows...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {search ? 'No matching workflows.' : 'No workflow templates found.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => {
              const scoreInfo = scoreMap.get(t.name)
              const showScores = debug && search.trim() && scoreInfo ? scoreInfo : undefined
              return (
                <WorkflowCard
                  key={t.filename}
                  template={t}
                  onClick={() => router.push(`/workflows/${t.filename}`)}
                  scoreInfo={showScores}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
