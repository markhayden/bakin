'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Workflow } from 'lucide-react'
import { WorkflowCanvas } from './workflow-canvas'
import { AGENTS } from '@/lib/constants'
import type { WorkflowTemplate, WorkflowStep, WorkflowDefinition, AgentStep } from '../types'

/** Collect unique agent IDs from workflow steps */
function collectAgents(steps: WorkflowStep[]): string[] {
  const ids = new Set<string>()
  for (const step of steps) {
    if (step.type === 'agent') ids.add((step as AgentStep).agent)
    if (step.type === 'parallel') {
      for (const sub of step.steps) {
        if (sub.type === 'agent') ids.add(sub.agent)
      }
    }
  }
  return Array.from(ids)
}

export function WorkflowsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [subWorkflows, setSubWorkflows] = useState<Record<string, WorkflowDefinition>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const deepLinkHandled = useRef(false)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/workflows/list')
      const data = await res.json()
      setTemplates(data.templates ?? [])
      setSubWorkflows(data.subWorkflows ?? {})
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  // Handle ?id= deep link
  useEffect(() => {
    if (deepLinkHandled.current || templates.length === 0) return
    const id = searchParams.get('id')
    if (id) {
      const match = templates.find(t => t.filename === id)
      if (match) {
        setSelected(match.filename)
        deepLinkHandled.current = true
        router.replace('/workflows', { scroll: false })
      }
    }
  }, [templates, searchParams, router])

  const handleSelect = useCallback((filename: string) => {
    setSelected(filename)
    router.replace(`/workflows?id=${filename}`, { scroll: false })
  }, [router])

  const selectedTemplate = templates.find(t => t.filename === selected)

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Workflow className="size-4 text-amber-400" />
            <h1 className="text-base font-semibold">Workflows</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">Agent Workflows</p>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — template list */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
          <div className="flex-1 overflow-y-auto">
            <div className="px-3 pt-3 pb-1">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Templates
              </span>
            </div>
            {templates.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground">No workflow templates found.</p>
            )}
            {templates.map((t) => {
              const agentIds = collectAgents(t.definition.steps)
              return (
                <button
                  key={t.filename}
                  onClick={() => handleSelect(t.filename)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 px-3 py-3 text-left transition-colors hover:bg-muted/50',
                    selected === t.filename && 'bg-muted',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Workflow className="size-3 shrink-0 text-amber-400" />
                    <span className="truncate text-sm font-medium">{t.name}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">{t.description}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {t.stepCount} steps
                    </Badge>
                    <div className="flex -space-x-1.5">
                      {agentIds.map(id => {
                        const agent = AGENTS.find(a => a.id === id)
                        return agent ? (
                          <img
                            key={id}
                            src={agent.headshot}
                            alt={agent.name}
                            title={agent.name}
                            className="size-5 rounded-full ring-1 ring-zinc-700 object-cover"
                          />
                        ) : null
                      })}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right panel — canvas or empty state */}
        <div className="flex-1 overflow-hidden">
          {selectedTemplate ? (
            <WorkflowCanvas definition={selectedTemplate.definition} subWorkflows={subWorkflows} />
          ) : (
            <div className="flex h-full items-center justify-center bg-zinc-950">
              <div className="text-center">
                <Workflow className="mx-auto mb-3 size-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  Select a template to view its workflow
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
