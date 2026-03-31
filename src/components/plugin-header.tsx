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
  }
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
          <div className="relative w-80 focus-within:w-[32rem] transition-all duration-200">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder || 'Search...'}
              className="pl-9 h-8 text-xs bg-surface border-border"
            />
          </div>
        )}
        {actions}
      </div>
    </div>
  )
}
