'use client'

import { useState, useMemo } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { Badge } from '@/components/ui/badge'
import { AgentDrawer } from './agent-drawer'
import { AGENT_MAP } from '@/lib/agents-data'
import { formatAge, isStale } from '@/lib/format'
import { parseTasks } from '../../../plugins/tasks/parser'
import type { Heartbeat } from '@/types'

function AgentCard({ id, status, statusLabel, heartbeat, onClick }: {
  id: string
  status: 'online' | 'working' | 'available'
  statusLabel: string
  heartbeat?: Heartbeat
  onClick?: () => void
}) {
  const agent = AGENT_MAP[id]
  if (!agent) return null

  const dotColor = status === 'online' ? 'bg-green-500' : status === 'working' ? 'bg-blue-500' : 'bg-zinc-400'
  const badgeVariant = status === 'online' || status === 'working' ? 'default' : 'secondary'

  return (
    <div
      className="rounded-xl border border-border bg-card overflow-hidden w-36 shrink-0 flex flex-col cursor-pointer hover:border-foreground/30 transition-colors"
      onClick={onClick}
    >
      <div className="relative w-full" style={{ paddingBottom: '100%' }}>
        <img
          src={agent.headshot}
          alt={agent.name}
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        <div className={`absolute top-2 right-2 size-2.5 rounded-full border-2 border-card ${dotColor}`} />
      </div>
      <div className="p-2.5 flex flex-col gap-0.5">
        <div className="text-sm font-semibold text-foreground leading-tight">{agent.name}</div>
        {agent.fullName
          ? <div className="text-xs text-muted-foreground leading-tight">{agent.fullName}</div>
          : null}
        <div className="text-xs text-muted-foreground/60 leading-tight">{agent.subtitle}</div>
        <div className="mt-1.5">
          <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0">
            {statusLabel}
          </Badge>
        </div>
      </div>
    </div>
  )
}

export function TeamGrid() {
  const heartbeats = useContentStore((s) => s.heartbeats)
  const files = useContentStore((s) => s.files)
  const subagentIds = ['pixel', 'rolo', 'patch']
  const affiliateIds = ['basil', 'scout', 'nemo', 'zen']
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  // Parse active tasks to know who's working
  const activeAgents = useMemo(() => {
    const content = files['TASKBOARD.md'] || ''
    if (!content) return new Set<string>()
    const { columns } = parseTasks(content)
    return new Set(columns.inProgress.map(t => t.agent).filter(Boolean) as string[])
  }, [files])

  // Roscoe uses real heartbeat — he's persistent
  const roscoeHb = heartbeats['roscoe'] as Heartbeat | undefined
  const roscoeActive = roscoeHb && !isStale(roscoeHb.timestamp)

  function getSubagentStatus(id: string): { status: 'working' | 'available'; label: string } {
    if (activeAgents.has(id)) return { status: 'working', label: 'working' }
    return { status: 'available', label: 'available' }
  }

  return (
    <div>
      <h1 className="text-lg font-semibold text-foreground mb-8">Team</h1>

      <div className="flex flex-col items-center gap-0">
        {/* Mark */}
        <div className="rounded-xl border border-border bg-card px-5 py-3 flex items-center gap-3">
          <div className="size-9 rounded-full bg-accent/20 flex items-center justify-center text-base">👤</div>
          <div>
            <div className="text-sm font-semibold text-foreground">Mark</div>
            <div className="text-xs text-muted-foreground">Founder · Human</div>
          </div>
          <Badge variant="secondary" className="ml-4 text-xs font-mono">MDT</Badge>
        </div>

        <div className="w-px h-8 bg-border" />

        {/* Roscoe — heartbeat-based (persistent agent) */}
        <AgentCard
          id="roscoe"
          status={roscoeActive ? 'online' : 'available'}
          statusLabel={roscoeActive ? `online · ${formatAge(roscoeHb!.timestamp)}` : 'online'}
          heartbeat={roscoeHb}
          onClick={() => setSelectedAgent('roscoe')}
        />

        <div className="w-px h-8 bg-border" />

        {/* Subagents — task-based status */}
        <div className="relative flex flex-wrap items-start justify-center gap-6">
          <div className="absolute top-0 left-[72px] right-[72px] h-px bg-border hidden xl:block" />
          {subagentIds.map((id) => {
            const { status, label } = getSubagentStatus(id)
            return (
              <div key={id} className="flex flex-col items-center">
                <div className="w-px h-8 bg-border" />
                <AgentCard
                  id={id}
                  status={status}
                  statusLabel={label}
                  onClick={() => setSelectedAgent(id)}
                />
              </div>
            )
          })}
        </div>

        {/* BetterFit Affiliates */}
        <div className="mt-12 w-full">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2">Content Creators</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            {affiliateIds.map((id) => {
              const { status, label } = getSubagentStatus(id)
              return (
                <AgentCard
                  key={id}
                  id={id}
                  status={status}
                  statusLabel={label}
                  onClick={() => setSelectedAgent(id)}
                />
              )
            })}
          </div>
        </div>

      </div>

      <AgentDrawer
        agentId={selectedAgent}
        heartbeat={selectedAgent ? heartbeats[selectedAgent] as Heartbeat | undefined : undefined}
        open={!!selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  )
}
