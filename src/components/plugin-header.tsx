import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
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
    placeholder?: string
    /** Debounce delay in ms (default: 300) */
    debounce?: number
  }
}

/**
 * Debounced search input — keeps local state for instant keystroke feedback,
 * syncs to parent (URL state) after `debounce` ms of idle typing.
 */
function DebouncedSearchInput({ value, onChange, placeholder, debounce = 300 }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  debounce?: number
}) {
  const [local, setLocal] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external value changes (e.g. URL navigation) into local state
  useEffect(() => {
    setLocal(value)
  }, [value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
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
      className="relative min-w-0 max-w-full flex-1 basis-80 transition-[flex-basis] duration-200 focus-within:basis-[32rem] motion-reduce:transition-none"
      data-testid="plugin-header-search"
      data-slot="plugin-header-search"
    >
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
      <Input
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="pl-9 h-8 text-xs bg-surface border-border"
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
      className="flex w-full min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3"
      data-testid="plugin-header"
      data-slot="plugin-header"
    >
      <div
        className="flex min-w-0 flex-1 basis-64 flex-col items-start gap-1"
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
          className="flex min-w-0 max-w-full flex-1 basis-72 flex-wrap items-center justify-end gap-3"
          data-testid="plugin-header-controls"
          data-slot="plugin-header-controls"
        >
          {search && (
            <DebouncedSearchInput
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder || 'Search...'}
              debounce={search.debounce}
            />
          )}
          {actions && (
            <div className="flex min-w-0 flex-wrap items-center gap-2" data-slot="plugin-header-actions">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
