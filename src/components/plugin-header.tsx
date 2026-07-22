import { useState, useEffect, useRef, useCallback } from 'react'
import { SearchInput } from '@makinbakin/sdk/patterns'
import { Badge } from '@/components/ui/badge'

export interface PluginHeaderProps {
  title: string
  subtitle?: string
  count?: number
  /** Optional path context rendered above the title. Supply a labelled nav when interactive. */
  breadcrumbs?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  search?: {
    value: string
    onChange: (value: string) => void
    /** Durable accessible name independent from the visual placeholder. */
    label?: string
    placeholder?: string
    /** Debounce delay in ms (default: 300) */
    debounce?: number
  }
}

/**
 * Debounced search input — keeps local state for instant keystroke feedback,
 * syncs to parent (URL state) after `debounce` ms of idle typing.
 */
function DebouncedSearchInput({ value, onChange, label, placeholder, debounce = 300 }: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
  debounce?: number
}) {
  const [local, setLocal] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external value changes (e.g. URL navigation) into local state
  useEffect(() => {
    setLocal(value)
  }, [value])

  const handleChange = useCallback((v: string) => {
    setLocal(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(v), debounce)
  }, [onChange, debounce])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div
      className="w-full min-w-[14rem] max-w-full flex-[0_1_22rem] @3xl/plugin-header:w-[22rem] @3xl/plugin-header:shrink-0"
      data-testid="plugin-header-search"
      data-slot="plugin-header-search"
    >
      <SearchInput
        align="end"
        label={label}
        value={local}
        onValueChange={handleChange}
        placeholder={placeholder}
        className="max-w-full"
        inputClassName="h-8 bg-surface text-xs"
      />
    </div>
  )
}

export function PluginHeader({
  title,
  subtitle,
  count,
  breadcrumbs,
  actions,
  meta,
  search,
}: PluginHeaderProps) {
  return (
    <div
      className="@container/plugin-header w-full min-w-0"
      data-testid="plugin-header"
      data-slot="plugin-header"
    >
      <div
        className="grid min-w-0 items-start gap-x-4 gap-y-3 @3xl/plugin-header:grid-cols-[minmax(0,1fr)_auto]"
        data-testid="plugin-header-layout"
        data-slot="plugin-header-layout"
      >
        <div
          className="flex min-w-0 flex-col items-start gap-1"
          data-testid="plugin-header-heading"
          data-slot="plugin-header-heading"
        >
          {breadcrumbs && (
            <div
              className="w-full min-w-0 break-words text-xs text-muted-foreground [&_a]:text-foreground/80 [&_a]:underline-offset-4 [&_a:hover]:underline"
              data-testid="plugin-header-breadcrumbs"
              data-slot="plugin-header-breadcrumbs"
            >
              {breadcrumbs}
            </div>
          )}
          <div
            className="flex min-w-0 flex-wrap items-center gap-2"
            data-testid="plugin-header-title-row"
            data-slot="plugin-header-title-row"
          >
            <h1 className="min-w-0 break-words text-xl font-semibold text-foreground">{title}</h1>
            {count !== undefined && (
              <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[11px] tabular-nums">
                {count}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="w-full min-w-0 max-w-3xl break-words text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
          {meta && (
            <div className="w-full min-w-0 break-words" data-slot="plugin-header-meta">
              {meta}
            </div>
          )}
        </div>
        {(search || actions) && (
          <div
            className="flex w-full min-w-0 max-w-full flex-wrap items-center justify-end gap-3 @3xl/plugin-header:w-auto @3xl/plugin-header:flex-nowrap"
            data-testid="plugin-header-controls"
            data-slot="plugin-header-controls"
          >
            {search && (
              <DebouncedSearchInput
                value={search.value}
                onChange={search.onChange}
                label={search.label || (search.placeholder || 'Search...').replace(/\.{3}|…/g, '')}
                placeholder={search.placeholder || 'Search...'}
                debounce={search.debounce}
              />
            )}
            {actions && (
              <div className="flex min-w-0 shrink-0 items-center gap-2" data-slot="plugin-header-actions">
                {actions}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
