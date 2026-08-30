'use client'

import { useState } from 'react'
import { Plus, Wand2, X } from 'lucide-react'
import { Section, Stack } from '@makinbakin/sdk/layout'
import {
  ConfirmDialog,
  DataTable,
  KeyValue,
  ListRow,
  ListRows,
  ModelSelect,
  type DataTableColumn,
  type KeyValueItem,
} from '@makinbakin/sdk/patterns'
import {
  Button,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'

import { WORK_CLASSES } from '../../../src/core/model-routing'
import type { ModelsData } from './use-models-data'

interface RecommendPayload {
  proposals: Array<{ workClass: string; model: string; reason: string }>
  skipped: Array<{ workClass: string; reason: string }>
}

// The full ordered ladder; the active runtime's declared support filters it.
const ALL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const

/** Deadline for the proposal pass — the dialog must never wait forever. */
const RECOMMEND_TIMEOUT_MS = 15_000

const DISPATCH_ROWS = WORK_CLASSES.filter((c) => c.kind === 'dispatch' && c.routable)
const SYSTEM_ROWS = WORK_CLASSES.filter((c) => c.kind === 'system' && c.routable)

const THINKING_LABELS: Record<string, string> = {
  inherit: 'Inherit agent setting',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  adaptive: 'Adaptive',
  max: 'Maximum',
}

type RouteRow = (typeof DISPATCH_ROWS)[number]

export function RoutingTab({ m }: { m: ModelsData }) {
  const {
    displayRouting, routingSupport,
    setRouteField, addTagOverride, updateTagOverride, removeTagOverride, modelOptions, applyRecommendedRoutes,
  } = m

  // Apply-recommended flow: propose (server) → diff preview in a ConfirmDialog
  // (house rule: the whole action flow lives in the modal) → confirm PUTs.
  const [recommend, setRecommend] = useState<RecommendPayload | null>(null)
  const [recommendBusy, setRecommendBusy] = useState(false)
  const [recommendError, setRecommendError] = useState<string | null>(null)

  const openRecommend = async () => {
    setRecommendError(null)
    try {
      // A proposal pass prices every routable class; without a deadline a wedged
      // server leaves the dialog empty and the operator with no explanation.
      const res = await pluginFetch('models', 'routing/recommend', {
        method: 'POST',
        signal: AbortSignal.timeout(RECOMMEND_TIMEOUT_MS),
      })
      const data = await res.json() as RecommendPayload & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `Recommend failed (${res.status})`)
      setRecommend(data)
    } catch (err) {
      setRecommend({ proposals: [], skipped: [] })
      setRecommendError(
        err instanceof DOMException && err.name === 'TimeoutError'
          ? `Recommending routes took longer than ${RECOMMEND_TIMEOUT_MS / 1000}s. Try again.`
          : err instanceof Error ? err.message : String(err),
      )
    }
  }

  const confirmRecommend = async () => {
    if (!recommend || recommend.proposals.length === 0) { setRecommend(null); return }
    setRecommendBusy(true)
    setRecommendError(null)
    try {
      await applyRecommendedRoutes(recommend.proposals)
      setRecommend(null)
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecommendBusy(false)
    }
  }

  // One pair per proposed change, plus the classes the pass declined to touch —
  // a skipped class stays visible so the operator sees why it kept its route.
  const recommendItems: KeyValueItem[] = [
    ...(recommend?.proposals ?? []).map((proposal) => ({
      label: proposal.workClass,
      mono: true,
      value: (
        <>
          {proposal.model}
          <span className="text-bakin-text-muted"> ({proposal.reason})</span>
        </>
      ),
    })),
    ...(recommend?.skipped ?? []).map((item) => ({
      label: `Skipped ${item.workClass}`,
      value: item.reason,
    })),
  ]

  // Only offer levels the active runtime honors (capability honesty). A
  // persisted-but-unsupported level still clamps at send time with audit
  // evidence; the routing health check flags it.
  const supported = routingSupport?.supportedThinkingLevels
  const thinkingLevels = ['inherit', ...(supported ?? ALL_THINKING_LEVELS)]

  const thinkingSelect = (
    id: string,
    label: string,
    value: string | undefined,
    onChange: (v: string) => void,
  ) => (
    <Select
      value={value ?? 'inherit'}
      onValueChange={(next) => onChange(next ?? 'inherit')}
    >
      <SelectTrigger id={id} size="sm" aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {thinkingLevels.map((level) => (
          <SelectItem key={level} value={level}>
            {THINKING_LABELS[level] ?? level}
          </SelectItem>
        ))}
        {value && !thinkingLevels.includes(value) ? (
          <SelectItem value={value}>
            {THINKING_LABELS[value] ?? value} · unsupported by this runtime
          </SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  )

  const ROUTE_COLUMNS: ReadonlyArray<DataTableColumn<RouteRow>> = [
    {
      // The only sortable column: Model and Thinking are selects, and reordering
      // form rows by their current value would move fields under the operator.
      // No defaultSort — WORK_CLASSES carries its own canonical order.
      key: 'workClass',
      header: 'Work class',
      sortable: true,
      sortValue: (workClass) => workClass.label,
      cellClassName: 'whitespace-normal align-top',
      cell: (workClass) => (
        <div className="min-w-0">
          <h3>{workClass.label}</h3>
          <Text as="p" size="meta" tone="muted" className="mt-bakin-1 leading-relaxed">
            {workClass.description}
          </Text>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      cellClassName: 'align-top',
      cell: (workClass) => (
        <ModelSelect
          id={`routing-${workClass.id}-model`}
          value={displayRouting.routes.find((r) => r.workClass === workClass.id)?.model ?? ''}
          onValueChange={(value) => setRouteField(workClass.id, 'model', value)}
          models={modelOptions}
          defaultLabel="Use agent model"
          defaultValue=""
          ariaLabel={`${workClass.label} model`}
          className="w-full min-w-0"
        />
      ),
    },
    {
      key: 'thinking',
      header: 'Thinking',
      cellClassName: 'align-top',
      cell: (workClass) => thinkingSelect(
        `routing-${workClass.id}-thinking`,
        `${workClass.label} thinking`,
        displayRouting.routes.find((r) => r.workClass === workClass.id)?.thinking,
        (value) => setRouteField(workClass.id, 'thinking', value),
      ),
    },
  ]

  const routeList = (rows: typeof DISPATCH_ROWS, label: string) => (
    // A table, not stacked rows: "Model" and "Thinking" belong in the header
    // once instead of on every row. With eleven work classes that was twenty-two
    // repeated field labels for two concepts, which is what made this tab read
    // as busy.
    //
    // Collapsing stays OFF (the default). A collapsing DataTable renders both
    // the table and the list and hides one with CSS — fine for read-only rows,
    // but here it would put every one of these selects in the DOM and the tab
    // order twice. A narrow viewport scrolls the table sideways instead.
    <DataTable
      label={label}
      columns={ROUTE_COLUMNS}
      rows={rows}
      rowKey={(workClass) => workClass.id}
      rowProps={(workClass) => ({ 'data-routing-row': workClass.id })}
    />
  )

  return (
    <div className="@container/routing flex min-w-0 flex-col gap-bakin-8">
      <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/routing:flex-row @2xl/routing:items-start @2xl/routing:justify-between">
        <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
          Choose a model and thinking level for each kind of work. Blank routes inherit the agent&apos;s model, while tag overrides take priority over the routes below. Interactive chat always keeps the operator&apos;s selected model.
        </Text>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full shrink-0 @2xl/routing:w-auto"
          onClick={() => void openRecommend()}
        >
          <Wand2 className="size-bakin-4" />
          Apply recommended routes
        </Button>
      </div>

      <ConfirmDialog
        open={recommend !== null}
        title="Apply recommended routes"
        description={recommend && recommend.proposals.length > 0
          ? 'These work classes will use lower-cost models. Existing routes stay unchanged.'
          : 'Nothing to apply. Every recommended work class already has a route.'}
        confirmLabel={recommend && recommend.proposals.length > 0 ? `Apply ${recommend.proposals.length} route(s)` : 'Close'}
        confirmTone="primary"
        busy={recommendBusy}
        error={recommendError}
        onConfirm={confirmRecommend}
        onCancel={() => {
          setRecommend(null)
          setRecommendError(null)
        }}
      >
        {recommendItems.length > 0 ? (
          <KeyValue aria-label="Proposed route changes" layout="rows" items={recommendItems} />
        ) : null}
      </ConfirmDialog>

      <Section spacing="compact" aria-label="Task dispatch routes">
        <Stack gap="dense">
          <h2 id="task-dispatch-routes-heading">Task dispatch</h2>
          <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
            Routes for scheduled, workflow, manually started, recovery, and decomposition work.
          </Text>
        </Stack>
        {routeList(DISPATCH_ROWS, 'Task dispatch routes')}
      </Section>

      <Section spacing="compact" divider="top" aria-label="System work routes">
        <Stack gap="dense">
          <h2 id="system-work-routes-heading">System work</h2>
          <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
            Background work Bakin performs for titles, enrichment, relays, team routing, and direct sends.
          </Text>
        </Stack>
        {routeList(SYSTEM_ROWS, 'System work routes')}
      </Section>

      <Section spacing="compact" divider="top" aria-labelledby="tag-overrides-heading">
        <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/routing:flex-row @2xl/routing:items-start @2xl/routing:justify-between">
          <Stack gap="dense">
            <h2 id="tag-overrides-heading">Tag overrides</h2>
            <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
              Match a task tag before its work-class route. The first matching override wins.
            </Text>
          </Stack>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 @2xl/routing:w-auto"
            onClick={addTagOverride}
          >
            <Plus className="size-bakin-4" />
            Add override
          </Button>
        </div>

        {displayRouting.tagOverrides.length === 0 ? (
          <SystemState
            kind="initial-empty"
            scope="section"
            title="No tag overrides"
            description="Add one only when a task tag should take priority over its normal work route."
          />
        ) : (
          <ListRows
            aria-label="Tag routing overrides"
            variant="separated"
            columns="minmax(10rem,.7fr) minmax(0,1fr) minmax(10rem,.42fr) auto"
            columnsAt="3xl"
            columnsAlign="end"
          >
            {displayRouting.tagOverrides.map((row, index) => {
              const tagId = `routing-tag-${index}`
              const modelId = `routing-tag-${index}-model`
              const thinkingId = `routing-tag-${index}-thinking`

              return (
                <ListRow
                  key={index}
                  className="px-bakin-4 py-bakin-4"
                >
                  <Field name={tagId}>
                    <FieldLabel htmlFor={tagId}>
                      <span className="sr-only">Tag override {index + 1} </span>
                      Task tag
                    </FieldLabel>
                    <Input
                      id={tagId}
                      value={row.tag}
                      placeholder="e.g. heavy"
                      onChange={(event) => updateTagOverride(index, 'tag', event.target.value)}
                    />
                  </Field>

                  <Field name={modelId}>
                    <FieldLabel htmlFor={modelId}>
                      <span className="sr-only">Tag override {index + 1} </span>
                      Model
                    </FieldLabel>
                    <ModelSelect
                      id={modelId}
                      value={row.model ?? ''}
                      onValueChange={(value) => updateTagOverride(index, 'model', value)}
                      models={modelOptions}
                      defaultLabel="Use work route"
                      defaultValue=""
                      ariaLabel={`Tag override ${index + 1} model`}
                      className="w-full min-w-0"
                    />
                  </Field>

                  <Field name={thinkingId}>
                    <FieldLabel htmlFor={thinkingId}>
                      <span className="sr-only">Tag override {index + 1} </span>
                      Thinking
                    </FieldLabel>
                    {thinkingSelect(
                      thinkingId,
                      `Tag override ${index + 1} thinking`,
                      row.thinking,
                      (value) => updateTagOverride(index, 'thinking', value),
                    )}
                  </Field>

                  <Button
                    type="button"
                    variant="danger"
                    size="icon-sm"
                    aria-label={`Remove tag override ${index + 1}`}
                    className="justify-self-end @3xl/list-rows:mb-px"
                    onClick={() => removeTagOverride(index)}
                  >
                    <X className="size-bakin-4" />
                  </Button>
                </ListRow>
              )
            })}
          </ListRows>
        )}
      </Section>
    </div>
  )
}
