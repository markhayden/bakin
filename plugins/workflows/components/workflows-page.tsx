'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from '@makinbakin/sdk/hooks'
import { SearchDegradedChip, SearchPartialChip } from "@makinbakin/sdk/components"
import { Grid } from "@makinbakin/sdk/layout"
import {
  FacetFilter,
  Page,
  PageBody,
  PageControls,
  PageHeader,
  Pagination,
  SearchInput,
} from "@makinbakin/sdk/patterns"
import { Badge, Button, Skeleton, SystemState } from "@makinbakin/sdk/ui"
import { Plus } from 'lucide-react'
import { useQueryArrayState, useQueryState } from "@makinbakin/sdk/hooks"
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
import {
  getWorkflowFeatures,
  WORKFLOW_FEATURES,
  workflowMatchesFeatures,
} from '../lib/workflow-presentation'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

const MANAGED_PAGE_SIZE = 9

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
  const [features, setFeatures] = useQueryArrayState('features')
  const [managedPageParam, setManagedPageParam] = useQueryState('page', '1')
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

  // Honest search signal (spec D11): the substring fallback below keeps the
  // page browsable when the engine is down, but never silently — surface
  // loading, engine-down, and partial-results states near the search input.
  const searchSignalActive = Boolean(normalizedSearch) &&
    (searchHook.status === 'loading' || searchHook.status === 'unavailable' || Boolean(searchHook.meta?.partial))

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

  const searchFiltered = useMemo(() => {
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

  const featureCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const feature of WORKFLOW_FEATURES) counts[feature.value] = 0
    for (const template of searchFiltered) {
      for (const feature of getWorkflowFeatures(template.definition.steps)) {
        counts[feature] += 1
      }
    }
    return counts
  }, [searchFiltered])

  const filtered = useMemo(
    () => searchFiltered.filter((template) => (
      workflowMatchesFeatures(template.definition.steps, features)
    )),
    [features, searchFiltered],
  )

  const isManagedWorkflow = (template: WorkflowTemplate) => template.source === 'plugin' || template.source === 'agent-package'
  const managedWorkflows = filtered.filter(isManagedWorkflow)
  const customWorkflows = filtered.filter(t => !isManagedWorkflow(t))
  const showAllManaged = managedPageParam === 'all'
  const managedPage = showAllManaged
    ? 1
    : Math.max(1, Number.parseInt(managedPageParam, 10) || 1)
  const managedPageCount = Math.max(1, Math.ceil(managedWorkflows.length / MANAGED_PAGE_SIZE))
  const safeManagedPage = Math.min(managedPage, managedPageCount)
  const visibleManagedWorkflows = showAllManaged
    ? managedWorkflows
    : managedWorkflows.slice(
      (safeManagedPage - 1) * MANAGED_PAGE_SIZE,
      safeManagedPage * MANAGED_PAGE_SIZE,
    )

  useEffect(() => {
    if (!showAllManaged && managedPage !== safeManagedPage) {
      setManagedPageParam(String(safeManagedPage))
    }
  }, [managedPage, safeManagedPage, setManagedPageParam, showAllManaged])

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
    total = workflows.length,
    pagination,
  }: {
    title: string
    workflows: WorkflowTemplate[]
    empty: string
    total?: number
    pagination?: React.ReactNode
  }) {
    return (
      <section className="flex min-w-0 flex-col gap-bakin-3">
        <div className="flex min-w-0 items-center gap-bakin-2">
          <h2 className="m-0 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-[.12em] text-bakin-text-muted">
            {title}
          </h2>
          <Badge size="xs" variant="outline">{total}</Badge>
        </div>
        {workflows.length === 0 ? (
          <SystemState
            kind="initial-empty"
            scope="inline"
            title={empty}
            description="This section will update when a matching workflow is available."
          />
        ) : (
          <Grid layout="thirds" gap="item">
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
          </Grid>
        )}
        {pagination}
      </section>
    )
  }

  const searchFeedback = searchSignalActive && searchHook.status !== 'loading' ? (
    <div className="flex min-w-0 flex-wrap items-center gap-bakin-2">
      {searchHook.status === 'unavailable' ? <SearchDegradedChip testId="workflows-search-degraded" /> : null}
      {searchHook.meta?.partial ? <SearchPartialChip meta={searchHook.meta} /> : null}
    </div>
  ) : undefined

  const resultState = loading ? (
    <Grid layout="thirds" gap="item">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </Grid>
  ) : filtered.length === 0 ? (
    normalizedSearch || features.length > 0 ? (
      <SystemState
        kind="no-results"
        scope="page"
        title="No workflows match this view"
        description="Clear the current search and feature filters to return to every workflow."
        action={(
          <Button
            variant="outline"
            onClick={() => {
              setSearch('')
              setFeatures([])
            }}
          >
            Clear filters
          </Button>
        )}
      />
    ) : (
      <SystemState
        kind="initial-empty"
        scope="page"
        title="No workflows yet"
        description="Create a workflow to coordinate repeatable, multi-step work."
        action={<Button onClick={openCreateWorkflowDialog}><Plus /> New workflow</Button>}
      />
    )
  ) : undefined

  return (
    <>
      <Page>
      <PageHeader
        title="Workflows"
        description="Build and manage reusable, multi-step agent processes with approvals, branching, skills, and automated handoffs."
        meta={loading ? undefined : <Badge size="xs" variant="outline">{filtered.length} shown</Badge>}
        controlsLabel="Workflow search"
        controls={(
          <SearchInput
            align="end"
            label="Workflow search"
            value={search}
            onValueChange={(value) => {
              setSearch(value)
              setManagedPageParam('1')
            }}
            placeholder="Search workflows…"
            busy={searchHook.status === 'loading'}
            mobileFullWidth
          />
        )}
        actionsLabel="Workflow actions"
        actions={<Button onClick={openCreateWorkflowDialog}><Plus /> New workflow</Button>}
      />

      <PageControls label="Workflow filters">
        <FacetFilter
          label="Features"
          options={WORKFLOW_FEATURES}
          selected={features}
          counts={featureCounts}
          onChange={(nextFeatures) => {
            setFeatures(nextFeatures)
            setManagedPageParam('1')
          }}
        />
      </PageControls>

      <PageBody
        label="Workflow results"
        busy={!loading && searchHook.status === 'loading'}
        feedback={searchFeedback}
        state={resultState}
      >
          <div className="flex min-w-0 flex-col gap-bakin-6">
            <WorkflowSection
              title="Custom workflows"
              workflows={customWorkflows}
              empty="No custom workflows yet."
            />
            <WorkflowSection
              title="Managed workflows"
              workflows={visibleManagedWorkflows}
              total={managedWorkflows.length}
              empty="No managed workflows match this view."
              pagination={(
                <Pagination
                  ariaLabel="Managed workflows pagination"
                  page={safeManagedPage}
                  pageSize={MANAGED_PAGE_SIZE}
                  showAll={showAllManaged}
                  total={managedWorkflows.length}
                  onPageChange={(page) => setManagedPageParam(String(page))}
                  onShowAllChange={(showAll) => setManagedPageParam(showAll ? 'all' : '1')}
                />
              )}
            />
          </div>
      </PageBody>
      </Page>

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
    </>
  )
}
