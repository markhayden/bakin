'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { PluginHeader } from '@/components/plugin-header'
import { useQueryState } from '@/hooks/use-query-state'
import { useAntflySearch } from '@/hooks/use-antfly-search'
import { WorkflowCard } from './workflow-card'
import type { WorkflowTemplate } from '../types'

export function WorkflowsPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useQueryState('q', '')

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

  const antfly = useAntflySearch({ table: 'workflows', facets: ['type', 'status'], debounce: 300 })
  useEffect(() => {
    if (search) antfly.search(search)
    else antfly.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const filtered = useMemo(() => {
    if (!search.trim()) return templates
    const q = search.toLowerCase()
    let result = templates.filter(t =>
      t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    )
    if (antfly.results.length) {
      const scoreMap = new Map(antfly.results.map(r => [r.id.replace('def:', ''), r.score]))
      result = [...result].sort((a, b) => (scoreMap.get(b.name) ?? -1) - (scoreMap.get(a.name) ?? -1))
    }
    return result
  }, [templates, search, antfly.results])

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
            {filtered.map((t) => (
              <WorkflowCard
                key={t.filename}
                template={t}
                onClick={() => router.push(`/workflows/${t.filename}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
