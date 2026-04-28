'use client'

import { ArrowUpDown } from 'lucide-react'
import { TableHead } from '@/components/ui/table'

export type SortDir = 'asc' | 'desc'

interface SortableHeadProps<F extends string> {
  field: F
  current: F
  dir: SortDir
  onSort: (f: F) => void
  /** When true, clicks are ignored and the sort indicator is hidden. Used
   *  when an upstream relevance order should win. */
  disabled?: boolean
  children: React.ReactNode
}

export function SortableHead<F extends string>({
  field, current, dir, onSort, disabled, children,
}: SortableHeadProps<F>) {
  const isActive = current === field && !disabled
  return (
    <TableHead>
      <button
        onClick={() => !disabled && onSort(field)}
        disabled={disabled}
        className={`flex items-center gap-1 hover:text-foreground transition-colors ${
          isActive ? 'text-foreground' : ''
        } ${disabled ? 'cursor-default opacity-60' : ''}`}
      >
        {children}
        {!disabled && <ArrowUpDown className={`size-3 ${isActive ? 'opacity-100' : 'opacity-40'}`} />}
        {isActive && <span className="text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  )
}
