'use client'

import { useState } from 'react'
import { Plus, Wand2, X } from 'lucide-react'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, ListRow, ListRows, ModelSelect } from '@makinbakin/sdk/patterns'
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
} from '@makinbakin/sdk/ui'

import { WORK_CLASSES } from '../../../src/core/model-routing'
import type { ModelsData } from './use-models-data'

interface RecommendPayload {
  proposals: Array<{ workClass: string; model: string; reason: string }>
  skipped: Array<{ workClass: string; reason: string }>
}

// The full ordered ladder; the active runtime's declared support filters it.
const ALL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const

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
      const res = await fetch('/api/plugins/models/routing/recommend', { method: 'POST' })
      const data = await res.json() as RecommendPayload & { error?: string }
      if (!res.ok) throw new Error(data.error ?? `Recommend failed (${res.status})`)
      setRecommend(data)
    } catch (err) {
      setRecommend({ proposals: [], skipped: [] })
      setRecommendError(err instanceof Error ? err.message : String(err))
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

  const routeList = (rows: typeof DISPATCH_ROWS, label: string) => (
    <ListRows
      aria-label={label}
      variant="separated"
      columns="minmax(12rem,.7fr) minmax(0,1fr) minmax(10rem,.42fr)"
      columnsAt="3xl"
      columnsAlign="end"
    >
      {rows.map((workClass) => {
        const route = displayRouting.routes.find((item) => item.workClass === workClass.id)
        const modelId = `routing-${workClass.id}-model`
        const thinkingId = `routing-${workClass.id}-thinking`

        return (
          <ListRow
            key={workClass.id}
            data-routing-row={workClass.id}
            className="px-bakin-4 py-bakin-4"
          >
            <div className="min-w-0 @3xl/list-rows:self-center">
              <h3 className="text-bakin-typography-size-body">
                {workClass.label}
              </h3>
              <p className="m-0 mt-bakin-1 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
                {workClass.description}
              </p>
            </div>

            <Field name={modelId}>
              <FieldLabel htmlFor={modelId}>
                <span className="sr-only">{workClass.label} </span>
                Model
              </FieldLabel>
              <ModelSelect
                id={modelId}
                value={route?.model ?? ''}
                onValueChange={(value) => setRouteField(workClass.id, 'model', value)}
                models={modelOptions}
                defaultLabel="Use agent model"
                defaultValue=""
                ariaLabel={`${workClass.label} model`}
                className="w-full min-w-0"
              />
            </Field>

            <Field name={thinkingId}>
              <FieldLabel htmlFor={thinkingId}>
                <span className="sr-only">{workClass.label} </span>
                Thinking
              </FieldLabel>
              {thinkingSelect(
                thinkingId,
                `${workClass.label} thinking`,
                route?.thinking,
                (value) => setRouteField(workClass.id, 'thinking', value),
              )}
            </Field>
          </ListRow>
        )
      })}
    </ListRows>
  )

  return (
    <div className="@container/routing flex min-w-0 flex-col gap-bakin-8">
      <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/routing:flex-row @2xl/routing:items-start @2xl/routing:justify-between">
        <p className="m-0 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
          Choose a model and thinking level for each kind of work. Blank routes inherit the agent&apos;s model, while tag overrides take priority over the routes below. Interactive chat always keeps the operator&apos;s selected model.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full shrink-0 @2xl/routing:w-auto"
          onClick={() => void openRecommend()}
        >
          <Wand2 className="size-4" />
          Apply recommended routes
        </Button>
      </div>

      <ConfirmDialog
        open={recommend !== null}
        title="Apply recommended routes"
        description={recommend && recommend.proposals.length > 0 ? (
          <span className="block space-y-1">
            <span className="block">These work classes will use lower-cost models. Existing routes stay unchanged.</span>
            {recommend.proposals.map((proposal) => (
              <span key={proposal.workClass} className="block font-bakin-typography-family-mono text-bakin-typography-size-meta">
                {proposal.workClass} → {proposal.model}
                <span className="text-bakin-text-muted"> ({proposal.reason})</span>
              </span>
            ))}
            {recommend.skipped.map((item) => (
              <span key={item.workClass} className="block text-bakin-typography-size-meta text-bakin-text-muted">
                Skipped {item.workClass}: {item.reason}
              </span>
            ))}
          </span>
        ) : (
          <span className="block">
            Nothing to apply. Every recommended work class already has a route.
            {recommend?.skipped.map((item) => (
              <span key={item.workClass} className="block text-bakin-typography-size-meta text-bakin-text-muted">
                Skipped {item.workClass}: {item.reason}
              </span>
            ))}
          </span>
        )}
        confirmLabel={recommend && recommend.proposals.length > 0 ? `Apply ${recommend.proposals.length} route(s)` : 'Close'}
        confirmTone="primary"
        busy={recommendBusy}
        error={recommendError}
        onConfirm={confirmRecommend}
        onCancel={() => {
          setRecommend(null)
          setRecommendError(null)
        }}
      />

      <Section spacing="compact" aria-label="Task dispatch routes">
        <Stack gap="dense">
          <h2
            id="task-dispatch-routes-heading"
          >
            Task dispatch
          </h2>
          <p className="m-0 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
            Routes for scheduled, workflow, manually started, recovery, and decomposition work.
          </p>
        </Stack>
        {routeList(DISPATCH_ROWS, 'Task dispatch routes')}
      </Section>

      <Section spacing="compact" divider="top" aria-label="System work routes">
        <Stack gap="dense">
          <h2
            id="system-work-routes-heading"
          >
            System work
          </h2>
          <p className="m-0 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
            Background work Bakin performs for titles, enrichment, relays, team routing, and direct sends.
          </p>
        </Stack>
        {routeList(SYSTEM_ROWS, 'System work routes')}
      </Section>

      <Section spacing="compact" divider="top" aria-labelledby="tag-overrides-heading">
        <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/routing:flex-row @2xl/routing:items-start @2xl/routing:justify-between">
          <Stack gap="dense">
            <h2
              id="tag-overrides-heading"
            >
              Tag overrides
            </h2>
            <p className="m-0 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
              Match a task tag before its work-class route. The first matching override wins.
            </p>
          </Stack>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full shrink-0 @2xl/routing:w-auto"
            onClick={addTagOverride}
          >
            <Plus className="size-4" />
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
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Remove tag override ${index + 1}`}
                    className="justify-self-end text-bakin-text-muted hover:text-bakin-signal-danger @3xl/list-rows:mb-px"
                    onClick={() => removeTagOverride(index)}
                  >
                    <X className="size-4" />
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
