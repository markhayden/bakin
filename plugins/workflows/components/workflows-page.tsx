'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from '@makinbakin/sdk/hooks'
import { PluginHeader } from "@makinbakin/sdk/components"
import { EmptyState } from "@makinbakin/sdk/components"
import { Skeleton } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import { Plus, Workflow } from 'lucide-react'
import { useQueryState } from "@makinbakin/sdk/hooks"
import { useSearch } from "@makinbakin/sdk/hooks"
import { useDebug } from "@makinbakin/sdk/hooks"
import { WorkflowCard } from './workflow-card'
import { ManagedWorkflowCopyDialog } from './managed-workflow-copy-dialog'
import {
  clearWorkflowDialogFieldError,
  hasWorkflowDialogFieldErrors,
  parseWorkflowDialogServerError,
  validateWorkflowDialogFields,
  type WorkflowDialogFieldErrors,
} from './workflow-dialog-validation'
import type { WorkflowTemplate } from '../types'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

export function WorkflowsPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useQueryState('q', '')
  const [debug] = useDebug()
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createFieldErrors, setCreateFieldErrors] = useState<WorkflowDialogFieldErrors>({})
  const [createName, setCreateName] = useState('')
  const [createId, setCreateId] = useState('')
  const [createIdEdited, setCreateIdEdited] = useState(false)
  const [createDescription, setCreateDescription] = useState('')
  const normalizedSearch = search.trim()

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/workflows/definitions?includeDisabled=1')
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

  // Build a score map keyed by workflow id/filename (stripping the `def:` search key prefix).
  // Used for both the relevance reorder AND the debug-mode RRF/BM25/SEM overlay.
  const scoreMap = useMemo(() => {
    const map = new Map<string, ScoreInfo>()
    if (searchHook.meta?.query !== normalizedSearch) return map
    for (const r of searchHook.results) {
      if (!r.id.startsWith('def:')) continue
      const id = r.id.startsWith('def:') ? r.id.slice('def:'.length) : r.id
      map.set(id, { score: r.score, indexScores: r.indexScores })
    }
    return map
  }, [normalizedSearch, searchHook.meta?.query, searchHook.results])

  const filtered = useMemo(() => {
    if (!normalizedSearch) return templates
    if (scoreMap.size > 0) {
      return templates
        .filter(t => scoreMap.has(t.filename))
        .sort((a, b) => (scoreMap.get(b.filename)?.score ?? 0) - (scoreMap.get(a.filename)?.score ?? 0))
    }
    const q = normalizedSearch.toLowerCase()
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    )
  }, [templates, normalizedSearch, scoreMap])

  const isManagedWorkflow = (template: WorkflowTemplate) => template.source === 'plugin' || template.source === 'agent-package'
  const managedWorkflows = filtered.filter(isManagedWorkflow)
  const customWorkflows = filtered.filter(t => !isManagedWorkflow(t))

  function openCreateWorkflowDialog() {
    setCreateError(null)
    setCreateFieldErrors({})
    setCreateOpen(true)
  }

  function closeCreateWorkflowDialog() {
    if (creating) return
    setCreateOpen(false)
    setCreateError(null)
    setCreateFieldErrors({})
  }

  async function handleCreateWorkflow() {
    const id = createId.trim()
    const name = createName.trim()
    const fieldErrors = validateWorkflowDialogFields({ id, name })
    if (hasWorkflowDialogFieldErrors(fieldErrors)) {
      setCreateFieldErrors(fieldErrors)
      setCreateError(null)
      return
    }

    setCreating(true)
    setCreateError(null)
    setCreateFieldErrors({})
    try {
      const res = await fetch('/api/plugins/workflows/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name,
          description: createDescription.trim(),
          version: 1,
          steps: [],
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const parsedError = parseWorkflowDialogServerError(data, `Create failed (${res.status})`)
        setCreateFieldErrors(parsedError.fieldErrors)
        setCreateError(parsedError.error)
        return
      }

      const savedId = (data.id as string | undefined) || id
      setCreateOpen(false)
      router.push(`/workflows/${savedId}/edit`)
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  function WorkflowSection({
    title,
    workflows,
    empty,
  }: {
    title: string
    workflows: WorkflowTemplate[]
    empty: string
  }) {
    return (
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
          <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {workflows.length}
          </span>
        </div>
        {workflows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/40 px-3 py-4 text-sm text-muted-foreground">
            {empty}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((t) => {
              const scoreInfo = scoreMap.get(t.filename)
              const showScores = debug && normalizedSearch && scoreInfo ? scoreInfo : undefined
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
      </section>
    )
  }

  return (
    <div className="p-6 flex flex-col h-full min-h-0 gap-4">
      <PluginHeader
        title="Workflows"
        count={loading ? undefined : filtered.length}
        search={{ value: search, onChange: setSearch, placeholder: 'Search workflows...' }}
        actions={
          <Button size="sm" onClick={openCreateWorkflowDialog}>
            <Plus className="size-3.5 mr-1" /> New workflow
          </Button>
        }
      />

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Workflow}
            title={search ? 'No matching workflows' : 'No workflow templates found'}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <WorkflowSection
              title="Custom workflows"
              workflows={customWorkflows}
              empty="No custom workflows yet."
            />
            <WorkflowSection
              title="Managed workflows"
              workflows={managedWorkflows}
              empty="No managed workflows match this view."
            />
          </div>
        )}
      </div>

      <ManagedWorkflowCopyDialog
        open={createOpen}
        variant="create"
        creating={creating}
        error={createError}
        fieldErrors={createFieldErrors}
        copyName={createName}
        copyId={createId}
        workflowDescription={createDescription}
        disableOriginal={false}
        showDescription
        showDisableOriginal={false}
        onOpenChange={(open) => {
          if (!open) closeCreateWorkflowDialog()
          else openCreateWorkflowDialog()
        }}
        onCopyNameChange={(value) => {
          setCreateName(value)
          setCreateError(null)
          setCreateFieldErrors((prev) => (
            createIdEdited
              ? clearWorkflowDialogFieldError(prev, 'name')
              : clearWorkflowDialogFieldError(prev, 'name', 'id')
          ))
          if (!createIdEdited) setCreateId(slugify(value))
        }}
        onCopyIdChange={(value) => {
          setCreateIdEdited(true)
          setCreateError(null)
          setCreateFieldErrors((prev) => clearWorkflowDialogFieldError(prev, 'id'))
          setCreateId(slugify(value))
        }}
        onWorkflowDescriptionChange={(value) => {
          setCreateDescription(value)
          setCreateError(null)
          setCreateFieldErrors((prev) => clearWorkflowDialogFieldError(prev, 'description'))
        }}
        onDisableOriginalChange={() => {}}
        onCancel={closeCreateWorkflowDialog}
        onCreate={handleCreateWorkflow}
      />
    </div>
  )
}
