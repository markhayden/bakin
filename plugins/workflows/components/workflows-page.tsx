'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import { Stack } from "@makinbakin/sdk/layout"
import {
  FacetFilter,
  DataTable,
  Page,
  PageBody,
  PageControls,
  PageHeader,
  Pagination,
  SearchDegradedChip,
  SearchInput,
  SearchPartialChip,
} from "@makinbakin/sdk/patterns"
import { Badge, Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, SystemState } from "@makinbakin/sdk/ui"
import { Plus } from 'lucide-react'
import { useSearch, useDebug, useAgentList, useAgentStore } from "@makinbakin/sdk/hooks"
import { WorkflowTable } from './workflow-table'
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
import { Inline } from '@makinbakin/sdk/layout'
import { getWorkflowSource, parseWorkflowSort, sortWorkflows, type WorkflowSortField } from '../lib/workflow-sort'

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

const PAGE_SIZE = 20
const SOURCE_OPTIONS = { all: 'All sources', custom: 'Custom', managed: 'Managed' }

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
  const [pageParam, setPageParam] = useQueryState('page', '1')
  const [sourceParam, setSourceParam] = useQueryState('source', 'all')
  const source = sourceParam === 'custom' || sourceParam === 'managed' ? sourceParam : 'all'
  const [sortField, setSortField] = useQueryState('sort', '')
  const [sortDir, setSortDir] = useQueryState('dir', 'asc')
  const sort = useMemo(() => parseWorkflowSort(sortField, sortDir), [sortField, sortDir])
  const agents = useAgentList()
  const displaySettings = useAgentStore(state => state.displaySettings)
  const agentNames = useMemo(() => new Map(agents.map(agent => [
    agent.id, displaySettings[agent.id]?.displayName ?? agent.name,
  ])), [agents, displaySettings])
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

  const sourceFiltered = useMemo(() => searchFiltered.filter(template => (
    source === 'all' || getWorkflowSource(template) === source
  )), [searchFiltered, source])

  const featureCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const feature of WORKFLOW_FEATURES) counts[feature.value] = 0
    for (const template of sourceFiltered) {
      for (const feature of getWorkflowFeatures(template.definition.steps)) {
        counts[feature] += 1
      }
    }
    return counts
  }, [sourceFiltered])

  const filtered = useMemo(
    () => sourceFiltered.filter((template) => (
      workflowMatchesFeatures(template.definition.steps, features)
    )),
    [features, sourceFiltered],
  )

  const sorted = useMemo(() => sortWorkflows(filtered, sort, agentNames), [filtered, sort, agentNames])
  const showAll = pageParam === 'all'
  const page = showAll ? 1 : Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const visibleWorkflows = showAll ? sorted : sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  useEffect(() => {
    if (!loading && !showAll && page !== safePage) {
      setPageParam(String(safePage))
    }
  }, [loading, page, safePage, setPageParam, showAll])

  function resetPage() {
    if (!showAll) setPageParam('1')
  }

  function handleSort(field: WorkflowSortField) {
    setSortField(field)
    setSortDir(sort?.field === field && sort.dir === 'asc' ? 'desc' : 'asc')
    resetPage()
  }

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

  const searchFeedback = searchSignalActive && searchHook.status !== 'loading' ? (
    <Inline gap="dense">
      {searchHook.status === 'unavailable' ? <SearchDegradedChip testId="workflows-search-degraded" /> : null}
      {searchHook.meta?.partial ? <SearchPartialChip meta={searchHook.meta} /> : null}
    </Inline>
  ) : undefined

  const resultState = loading ? (
    <DataTable
      label="Loading workflows"
      tableProps={{ className: 'min-w-3xl table-fixed', 'aria-busy': true }}
      columns={['Workflow', 'Source', 'Steps', 'Features', 'Assignment'].map((header, index) => ({
        key: header,
        header,
        headClassName: index === 0 ? 'w-5/12' : index < 3 ? 'w-1/8' : 'w-1/6',
        cell: () => <Skeleton className="h-bakin-4 w-full" />,
      }))}
      rows={Array.from({ length: 6 }, (_, i) => i)}
      rowKey={i => String(i)}
    />
  ) : filtered.length === 0 ? (
    normalizedSearch || features.length > 0 || source !== 'all' ? (
      <SystemState
        kind="no-results"
        scope="page"
        title="No workflows match this view"
        description="Clear the current search and filters to return to every workflow."
        action={(
          <Button
            variant="outline"
            onClick={() => {
              setSearch('')
              setFeatures([])
              setSourceParam('all')
              resetPage()
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
        meta={loading ? undefined : <Badge size="xs" tone="neutral" variant="soft">{filtered.length} shown</Badge>}
        controlsLabel="Workflow search"
        controls={(
          <SearchInput
            align="end"
            label="Workflow search"
            value={search}
            onValueChange={(value) => {
              setSearch(value)
              resetPage()
            }}
            placeholder="Search workflows…"
            busy={searchHook.status === 'loading'}
            mobileFullWidth
          />
        )}
        actionsLabel="Workflow actions"
        actions={<Button onClick={openCreateWorkflowDialog}><Plus /> New workflow</Button>}
      />

      <PageControls variant="filters" label="Workflow filters">
        <Select items={SOURCE_OPTIONS} value={source} onValueChange={value => {
          if (value === null) return
          setSourceParam(value)
          resetPage()
        }}>
          <SelectTrigger aria-label="Workflow source"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SOURCE_OPTIONS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <FacetFilter
          label="Features"
          options={WORKFLOW_FEATURES}
          selected={features}
          counts={featureCounts}
          onChange={(nextFeatures) => {
            setFeatures(nextFeatures)
            resetPage()
          }}
        />
      </PageControls>

      <PageBody
        label="Workflow results"
        busy={!loading && searchHook.status === 'loading'}
        feedback={searchFeedback}
        state={resultState}
      >
          <Stack gap="item">
            <WorkflowTable
              label="Workflows"
              templates={visibleWorkflows}
              sort={sort}
              onSortChange={handleSort}
              scoreMap={debug && normalizedSearch ? scoreMap : undefined}
              onOpen={(filename) => router.push(`/workflows/${filename}`)}
            />
            <Pagination
              ariaLabel="Workflows pagination"
              page={safePage}
              pageSize={PAGE_SIZE}
              showAll={showAll}
              total={sorted.length}
              onPageChange={(nextPage) => setPageParam(String(nextPage))}
              onShowAllChange={(nextShowAll) => setPageParam(nextShowAll ? 'all' : '1')}
            />
          </Stack>
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
