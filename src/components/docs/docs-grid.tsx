'use client'

import { useState, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { MarkdownContent } from '@/components/markdown-content'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import type { DocMeta } from '@/types'

function parseDocMeta(filename: string, content: string): DocMeta {
  const titleMatch = content.match(/^# (.+)/m)
  return {
    filename,
    title: titleMatch ? titleMatch[1] : filename.replace('.md', ''),
    content,
  }
}

export function DocsGrid() {
  const files = useContentStore((s) => s.files)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<DocMeta | null>(null)

  const docs = useMemo(() => {
    const result: DocMeta[] = []
    for (const [key, content] of Object.entries(files)) {
      if (key.startsWith('docs/') && key.endsWith('.md')) {
        const filename = key.replace('docs/', '')
        result.push(parseDocMeta(filename, content))
      }
    }
    return result
  }, [files])

  const filtered = useMemo(() => {
    if (!search) return docs
    const q = search.toLowerCase()
    return docs.filter((d) => d.title.toLowerCase().includes(q))
  }, [docs, search])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold text-foreground">Docs</h1>
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

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No docs found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((doc) => (
            <button
              key={doc.filename}
              onClick={() => setSelected(doc)}
              className="text-left rounded-lg border border-border bg-card p-4 hover:border-[rgba(255,255,255,0.15)] transition-all duration-150 hover:-translate-y-0.5"
            >
              <h3 className="text-sm font-medium text-foreground">{doc.title}</h3>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {doc.content.slice(0, 120).replace(/^#.+\n/, '')}
              </p>
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          {selected && <MarkdownContent content={selected.content} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}
