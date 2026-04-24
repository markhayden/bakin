'use client'

import { AgentAvatar } from '@bakin/sdk/components'
import { useAgent } from '@bakin/sdk/hooks'

interface DefaultEmptyStateProps {
  agentId: string
}

export function DefaultEmptyState({ agentId }: DefaultEmptyStateProps) {
  const agent = useAgent(agentId)
  const name = agent?.name ?? agentId ?? 'your agent'
  return (
    <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-10 gap-3 px-4">
      <AgentAvatar agentId={agentId} size="xl" />
      <div className="space-y-1 max-w-md">
        <p className="text-sm font-medium text-foreground">Brainstorm with {name}</p>
        <p className="text-xs">Share a question or idea. {name} will take it from there.</p>
      </div>
    </div>
  )
}
