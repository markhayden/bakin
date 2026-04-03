'use client'

import { useState, useEffect } from 'react'
import { useAgentList } from '@bakin/team/hooks/use-agent-store'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentWorkspace } from '../types'

function CollapsibleSection({
  title,
  content,
  defaultOpen = false,
}: {
  title: string
  content: string
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        {title}
      </button>
      {open && (
        <div className="px-4 py-3 border-t border-border bg-card">
          <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

export function AgentBrowser() {
  const agents = useAgentList()
  const [selectedAgent, setSelectedAgent] = useState('')
  const [workspace, setWorkspace] = useState<AgentWorkspace | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Set default agent once loaded
  useEffect(() => {
    if (!selectedAgent && agents.length > 0) setSelectedAgent(agents[0].id)
  }, [agents, selectedAgent])

  useEffect(() => {
    if (!selectedAgent) return
    setLoading(true)
    setError('')
    fetch(`/api/plugins/memory/workspace?agentId=${selectedAgent}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load workspace')
        return r.json()
      })
      .then((data) => setWorkspace(data))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [selectedAgent])

  const fileEntries = workspace ? Object.entries(workspace.files) : []
  const memoryEntries = workspace ? Object.entries(workspace.memoryFiles) : []

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 flex-wrap">
        {agents.map((a) => (
          <Button
            key={a.id}
            variant={selectedAgent === a.id ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setSelectedAgent(a.id)}
          >
            <span className="mr-1">{a.emoji}</span>
            {a.name}
          </Button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-muted-foreground">Loading workspace...</p>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && workspace && (
        <div className="flex flex-col gap-2">
          {fileEntries.length === 0 && memoryEntries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No workspace files found for this agent.
            </p>
          )}
          {fileEntries.map(([name, content]) => (
            <CollapsibleSection
              key={name}
              title={name}
              content={content}
              defaultOpen={name === 'SOUL.md' || name === 'IDENTITY.md'}
            />
          ))}
          {memoryEntries.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-foreground mt-4 mb-1">
                Daily Memory
              </h3>
              {memoryEntries.map(([name, content]) => (
                <CollapsibleSection
                  key={name}
                  title={name}
                  content={content}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
