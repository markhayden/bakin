'use client'

import { Workflow, Lock, PauseCircle, GitBranch, AlertTriangle } from 'lucide-react'
import { Badge } from "@makinbakin/sdk/ui"
import { AgentAvatar } from "@makinbakin/sdk/components"
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
  /** Search score info — only shown when debug mode + active search */
  scoreInfo?: ScoreInfo
}) {
  const agentIds = collectAgents(template.definition.steps)
  const disabled = template.disabled === true

  const semKey = 'embeddings'
  const bm25Key = scoreInfo?.indexScores
    ? Object.keys(scoreInfo.indexScores).find(k => k !== semKey)
    : undefined

  return (
    <button
      onClick={onClick}
      className={`relative text-left w-full rounded-lg border border-border bg-card p-4 transition-colors group ${
        disabled
          ? 'opacity-55 hover:opacity-75'
          : 'hover:bg-[rgba(255,255,255,0.04)]'
      }`}
    >
      {scoreInfo && (
        <div className="pointer-events-none absolute right-3 top-3 z-10 flex flex-col items-end gap-0.5 rounded bg-black/80 px-1.5 py-1 text-right font-mono text-[10px]">
          <span className="text-amber-400">RRF {scoreInfo.score.toFixed(3)}</span>
          <span className="text-cyan-400">
            BM25 {(bm25Key ? scoreInfo.indexScores?.[bm25Key] ?? 0 : 0).toFixed(3)}
          </span>
          <span className="text-purple-400">
            SEM {(scoreInfo.indexScores?.[semKey] ?? 0).toFixed(3)}
          </span>
        </div>
      )}
      <div className={`flex items-start gap-2 mb-2 ${scoreInfo ? 'pr-24' : ''}`}>
        <Workflow className="size-4 shrink-0 text-amber-400 mt-0.5" />
        <h3 className="text-sm font-medium text-foreground group-hover:text-white line-clamp-1">
          {template.name}
        </h3>
      </div>

      <p className={`text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3 ${scoreInfo ? 'pr-24' : ''}`}>
        {template.description || 'No description'}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {template.stepCount} steps
          </Badge>
          {template.source === 'plugin' && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1"
              title={`Shipped by plugin${template.pluginId ? ` "${template.pluginId}"` : ''} — read-only`}
            >
              <Lock className="size-2.5" />
              {template.pluginId ?? 'plugin'}
            </Badge>
          )}
          {template.source === 'user' && template.shadowedSource && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-cyan-500/40 text-cyan-200"
              title="This custom workflow shadows a managed workflow with the same id"
            >
              <GitBranch className="size-2.5" />
              shadows default
            </Badge>
          )}
          {template.skillDrift && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-amber-500/40 text-amber-200"
              title="This workflow references a stale local workflow skill"
            >
              <AlertTriangle className="size-2.5" />
              {template.skillDrift.count === 1 ? 'stale skill' : `${template.skillDrift.count} stale skills`}
            </Badge>
          )}
          {disabled && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-zinc-600 text-zinc-400"
              title="Disabled for automatic workflow selection"
            >
              <PauseCircle className="size-2.5" />
              disabled
            </Badge>
          )}
        </div>
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
