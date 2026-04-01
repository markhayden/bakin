'use client'

import { Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import type { WorkflowTemplate, WorkflowStep, AgentStep } from '../types'

/** Collect unique agent IDs from workflow steps */
export function collectAgents(steps: WorkflowStep[]): string[] {
  const ids = new Set<string>()
  for (const step of steps) {
    if (step.type === 'agent') ids.add((step as AgentStep).agent)
    if (step.type === 'output' && step.agent) ids.add(step.agent)
    if (step.type === 'parallel') {
      for (const sub of step.steps) {
        if (sub.type === 'agent') ids.add(sub.agent)
      }
    }
  }
  return Array.from(ids)
}

export function WorkflowCard({ template, onClick }: { template: WorkflowTemplate; onClick: () => void }) {
  const agentIds = collectAgents(template.definition.steps)

  return (
    <button
      onClick={onClick}
      className="text-left w-full rounded-lg border border-border bg-card p-4 hover:bg-[rgba(255,255,255,0.04)] transition-colors group"
    >
      <div className="flex items-start gap-2 mb-2">
        <Workflow className="size-4 shrink-0 text-amber-400 mt-0.5" />
        <h3 className="text-sm font-medium text-foreground group-hover:text-white line-clamp-1">
          {template.name}
        </h3>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3">
        {template.description || 'No description'}
      </p>

      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="text-[10px]">
          {template.stepCount} steps
        </Badge>
        {agentIds.length > 0 && (
          <div className="flex -space-x-1.5">
            {agentIds.slice(0, 5).map(id => (
              <AgentAvatar key={id} agentId={id} size="xs" />
            ))}
            {agentIds.length > 5 && (
              <span className="text-[10px] text-muted-foreground ml-1">+{agentIds.length - 5}</span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}
