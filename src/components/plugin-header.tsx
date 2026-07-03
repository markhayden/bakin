import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface PluginHeaderProps {
  title: string
  subtitle?: string
  count?: number
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
    <div className="relative w-80 focus-within:w-[32rem] transition-all duration-200">
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

export function PluginHeader({ title, subtitle, count, actions, meta, search }: PluginHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {count !== undefined && (
          <Badge variant="secondary" className="text-[11px] font-mono tabular-nums px-1.5 py-0">
            {count}
          </Badge>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
        {meta}
      </div>
      <div className="flex items-center gap-3">
        {search && (
          <DebouncedSearchInput
            value={search.value}
            onChange={search.onChange}
            placeholder={search.placeholder || 'Search...'}
            debounce={search.debounce}
          />
        )}
        {actions}
      </div>
    </div>
  )
}
