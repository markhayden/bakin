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

interface ScoreInfo {
  score: number
  indexScores?: Record<string, number>
}

export function WorkflowCard({
  template,
  onClick,
  scoreInfo,
}: {
  template: WorkflowTemplate
  onClick: () => void
  /** Antfly score info — only shown when debug mode + active search */
  scoreInfo?: ScoreInfo
}) {
  const agentIds = collectAgents(template.definition.steps)

  const semKey = 'embeddings'
  const bm25Key = scoreInfo?.indexScores
    ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
    : undefined

  return (
    <button
      onClick={onClick}
      className="relative text-left w-full rounded-lg border border-border bg-card p-4 hover:bg-[rgba(255,255,255,0.04)] transition-colors group"
    >
      {scoreInfo && (
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 font-mono text-[10px] bg-black/80 px-1.5 py-1 rounded pointer-events-none">
          <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
          <span className="text-cyan-400">
            BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
          </span>
          <span className="text-purple-400">
            SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
          </span>
        </div>
      )}
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
