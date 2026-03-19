'use client'

import { useState, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { MarkdownContent } from '@/components/markdown-content'
import type { ProjectMeta } from '@/types'

function parseProjectMeta(filename: string, content: string): ProjectMeta {
  const titleMatch = content.match(/^# (.+)/m)
  const statusMatch = content.match(/\*\*Status:\*\*\s*(.+)/m)
  return {
    filename,
    title: titleMatch ? titleMatch[1] : filename.replace('.md', ''),
    status: statusMatch ? statusMatch[1].trim() : undefined,
    content,
  }
}

export function ProjectLayout() {
  const files = useContentStore((s) => s.files)
  const [selected, setSelected] = useState<string | null>(null)

  const projects = useMemo(() => {
    const result: ProjectMeta[] = []
    for (const [key, content] of Object.entries(files)) {
      if (key.startsWith('projects/') && key.endsWith('.md')) {
        const filename = key.replace('projects/', '')
        result.push(parseProjectMeta(filename, content))
      }
    }
    return result
  }, [files])

  const activeProject = projects.find((p) => p.filename === selected) || projects[0]

  return (
    <div>
      <h1 className="text-lg font-semibold text-foreground mb-6">Projects</h1>

      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <div className="flex gap-6">
          {/* Sidebar */}
          <div className="w-56 shrink-0 hidden md:block">
            <div className="flex flex-col gap-0.5">
              {projects.map((p) => (
                <button
                  key={p.filename}
                  onClick={() => setSelected(p.filename)}
                  className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeProject?.filename === p.filename
                      ? 'bg-[rgba(255,255,255,0.06)] text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-[rgba(255,255,255,0.04)]'
                  }`}
                >
                  <div className="font-medium">{p.title}</div>
                  {p.status && (
                    <div className="text-xs mt-0.5">{p.status}</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Detail */}
          <div className="flex-1 min-w-0">
            {activeProject && (
              <div className="rounded-lg border border-border bg-card p-6">
                <MarkdownContent content={activeProject.content} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
