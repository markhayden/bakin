'use client'

import type { ReactNode } from 'react'
import {
  Button,
  SystemState,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  badgeVariants,
  buttonVariants,
  type SystemStateHeadingLevel,
  type SystemStateScope,
} from '@bakin/ui'

import { PluginLink } from '../navigation/plugin-link'

/** Search response metadata needed to disclose partial source coverage. */
export interface SearchPartialMeta {
  partial?: boolean
  tables?: Array<{
    table: string
    hits: number
    took_ms: number
    budget?: 'degraded' | 'omitted'
  }>
}

export interface SearchUnavailableProps {
  /** Re-run the query that encountered the unavailable engine. */
  retry?: () => void
  /** Existing routed link or other host-owned system-health action. */
  healthAction?: ReactNode
  scope?: SystemStateScope
  headingLevel?: SystemStateHeadingLevel
  className?: string
}

/** Explicit search-engine failure that never masquerades as an empty result set. */
export function SearchUnavailable({
  retry,
  healthAction,
  scope = 'section',
  headingLevel = 2,
  className,
}: SearchUnavailableProps) {
  const resolvedHealthAction = healthAction === undefined ? (
    <PluginLink to="/health" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      Open health
    </PluginLink>
  ) : healthAction
  const action = retry || resolvedHealthAction ? (
    <>
      {retry ? <Button variant="outline" size="sm" onClick={retry}>Retry</Button> : null}
      {resolvedHealthAction}
    </>
  ) : null

  const shared = {
    title: 'Search is unavailable',
    description: 'The search engine is not responding. Browsing and filters still work while it recovers.',
    scope,
    headingLevel,
    className,
    'data-testid': 'search-unavailable',
  } as const

  return action ? (
    <SystemState {...shared} kind="error" recovery="available" action={action} />
  ) : (
    <SystemState {...shared} kind="error" recovery="unavailable" />
  )
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.6]">
      <path d="M8 2.1 14 13H2L8 2.1Z" />
      <path d="M8 5.7v3.5M8 11.5h.01" />
    </svg>
  )
}

export interface SearchDegradedChipProps {
  /** Plain-language name for the lower-quality fallback. */
  fallbackLabel?: string
  testId?: string
  className?: string
}

/** Visible disclosure when a listing falls back to lower-quality local matching. */
export function SearchDegradedChip({
  fallbackLabel = 'basic text matching',
  testId = 'search-degraded',
  className,
}: SearchDegradedChipProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={badgeVariants({
        tone: 'attention',
        variant: 'soft',
        className: `h-auto min-h-bakin-6 max-w-full shrink whitespace-normal py-bakin-1 text-left leading-tight ${className ?? ''}`,
      })}
    >
      <WarningIcon />
      Search is unavailable — showing {fallbackLabel}
    </span>
  )
}

const budgetLabels = {
  degraded: 'keyword-only',
  omitted: 'no answer in time',
} as const

function sourceName(table: string): string {
  return table.replace(/^bakin_/, '')
}

function partialDetails(meta: SearchPartialMeta): string[] {
  return (meta.tables ?? [])
    .filter((table) => table.budget !== undefined)
    .map((table) => `${sourceName(table.table)}: ${budgetLabels[table.budget!]} (${table.took_ms}ms)`)
}

export interface SearchPartialChipProps {
  meta: SearchPartialMeta | null | undefined
  className?: string
}

/** Focusable disclosure that names sources which degraded or missed the query budget. */
export function SearchPartialChip({ meta, className }: SearchPartialChipProps) {
  if (!meta?.partial) return null
  const details = partialDetails(meta)
  const summary = details.length
    ? `Partial results. ${details.join('. ')}`
    : 'Partial results. Some sources missed the search budget.'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={(
            <Button
              type="button"
              variant="warning"
              size="xs"
              aria-label={summary}
              data-testid="search-partial-chip"
              className={className}
            />
          )}
        >
          <WarningIcon />
          Partial results
        </TooltipTrigger>
        <TooltipContent className="max-w-sm" align="start">
          <span className="grid gap-bakin-1">
            <strong className="font-bakin-typography-weight-semibold">Some sources missed the search budget</strong>
            {details.length ? details.map((detail) => <span key={detail}>{detail}</span>) : null}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Exact search-relevance data reported by the active adapter. */
export interface ScoreOverlayInfo {
  score: number
  indexScores?: Record<string, number>
  matchedFields?: string[]
}

/** Client-side approximation of fields containing at least one multi-character query term. */
export function computeMatchedFields(query: string, fields: Record<string, unknown>): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1)
  if (!terms.length) return []
  const matched: string[] = []
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue
    const text = (typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase()
    if (terms.some((term) => text.includes(term))) matched.push(name)
  }
  return matched
}

function legLabel(leg: string): string {
  if (leg === 'full_text') return 'FT'
  const tail = leg.split('_').pop() ?? leg
  return tail.slice(0, 6).toUpperCase()
}

const legToneClasses = [
  'text-bakin-data-series-1',
  'text-bakin-data-series-2',
  'text-bakin-data-series-3',
  'text-bakin-data-series-4',
  'text-bakin-data-series-5',
  'text-bakin-data-series-6',
] as const

export interface ScoreOverlayProps {
  info: ScoreOverlayInfo
  className?: string
}

/** Compact, non-color-dependent evidence for fused and per-leg search relevance. */
export function ScoreOverlay({ info, className }: ScoreOverlayProps) {
  const legs = Object.entries(info.indexScores ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return (
    <div
      role="note"
      aria-label="Search relevance details"
      data-testid="score-overlay"
      className={`flex w-fit max-w-full flex-col gap-bakin-1 rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default/95 px-bakin-2 py-bakin-2 font-bakin-typography-family-mono [font-size:var(--bakin-typography-size-meta)] leading-tight shadow-bakin-elevation-raised ${className ?? ''}`}
    >
      <span className="font-bakin-typography-weight-semibold text-bakin-signal-highlight">RRF {info.score.toFixed(4)}</span>
      {info.matchedFields !== undefined ? (
        <span className="break-words text-bakin-text-muted" data-testid="score-overlay-matched">
          {info.matchedFields.length ? `matched: ${info.matchedFields.join(', ')}` : 'semantic match'}
        </span>
      ) : null}
      {legs.map(([leg, raw], index) => {
        const value = raw < 0 ? 1 + raw : raw
        return (
          <span key={leg} className={legToneClasses[index % legToneClasses.length]} title={leg}>
            {legLabel(leg)} {value.toFixed(4)}
          </span>
        )
      })}
    </div>
  )
}
