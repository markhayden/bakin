'use client'

import { useState, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { parseMemoryLog } from '@/lib/parsers/memory'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

export function MemoryLog() {
  const files = useContentStore((s) => s.files)
  const content = files['MEMORY-LOG.md'] || ''
  const [search, setSearch] = useState('')

  const days = useMemo(() => {
    const parsed = parseMemoryLog(content)
    // Reverse chronological
    return parsed.reverse()
  }, [content])

  const filtered = useMemo(() => {
    if (!search) return days
    const q = search.toLowerCase()
    return days
      .map((d) => ({
        ...d,
        entries: d.entries.filter((e) => e.text.toLowerCase().includes(q)),
      }))
      .filter((d) => d.entries.length > 0)
  }, [days, search])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-foreground">Memory</h1>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-9 h-8 bg-surface border-border"
          />
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No entries found.</p>
        )}
        {filtered.map((day) => (
          <div key={day.date}>
            <h2 className="text-sm font-semibold text-foreground mb-2 font-mono">
              {day.date}
            </h2>
            <div className="flex flex-col gap-1.5">
              {day.entries.map((entry, i) => (
                <div
                  key={i}
                  className={`rounded-md border border-border bg-card px-4 py-3 text-sm ${
                    entry.type === 'decision'
                      ? 'border-l-2 border-l-accent'
                      : entry.type === 'learned'
                      ? 'border-l-2 border-l-success'
                      : ''
                  }`}
                >
                  <span className="text-muted-foreground">{entry.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
