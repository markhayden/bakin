'use client'

import { useState } from 'react'
import { useContentStore } from '@/hooks/use-content-store'
import { Badge } from '@/components/ui/badge'
import { AgentDrawer } from './agent-drawer'
import type { Heartbeat } from '@/types'

function formatAge(timestamp: string) {
  const ms = Date.now() - new Date(timestamp).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  return `${hours}h ago`
}

const AGENT_DETAILS: Record<string, { emoji: string; name: string; title: string; subtitle: string; headshot: string }> = {
  roscoe: {
    emoji: '🐾',
    name: 'Roscoe',
    title: 'Orchestrator',
    subtitle: 'Lead Agent',
    headshot: '/headshots/roscoe.png',
  },
  basil: {
    emoji: '🥗',
    name: 'Basil',
    title: 'Content Creator',
    subtitle: 'Nutritionist & Chef',
    headshot: '/headshots/basil.png',
  },
  pixel: {
    emoji: '🖼️',
    name: 'Pixel',
    title: 'Image Generation',
    subtitle: 'Visual Content',
    headshot: '/headshots/pixel.png',
  },
  rolo: {
    emoji: '🎬',
    name: 'Rolo',
    title: 'Videographer',
    subtitle: 'Video & Editing',
    headshot: '/headshots/rolo.png',
  },
  patch: {
    emoji: '⚙️',
    name: 'Patch',
    title: 'Lead Developer',
    subtitle: 'Infrastructure',
    headshot: '/headshots/patch.png',
  },
}

function AgentCard({ id, heartbeat, onClick }: { id: string; heartbeat?: Heartbeat; onClick?: () => void }) {
  const agent = AGENT_DETAILS[id]
  if (!agent) return null
  const isActive = heartbeat && (Date.now() - new Date(heartbeat.timestamp).getTime()) < 15 * 60 * 1000

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden w-36 shrink-0 flex flex-col cursor-pointer hover:border-foreground/30 transition-colors" onClick={onClick}>
      {/* Headshot */}
      <div className="relative w-full" style={{ paddingBottom: '100%' }}>
        <img
          src={agent.headshot}
          alt={agent.name}
          className="absolute inset-0 w-full h-full object-cover object-top"
        />
        {/* Status dot */}
        <div className={`absolute top-2 right-2 size-2.5 rounded-full border-2 border-card ${isActive ? 'bg-green-500' : 'bg-zinc-500'}`} />
      </div>

      {/* Info */}
      <div className="p-2.5 flex flex-col gap-0.5">
        <div className="text-sm font-semibold text-foreground leading-tight">{agent.name}</div>
        <div className="text-xs text-muted-foreground leading-tight">{agent.title}</div>
        <div className="text-xs text-muted-foreground/60 leading-tight">{agent.subtitle}</div>
        <div className="mt-1.5">
          <Badge variant={isActive ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
            {isActive ? `active · ${formatAge(heartbeat!.timestamp)}` : 'standby'}
          </Badge>
        </div>
      </div>
    </div>
  )
}

export function TeamGrid() {
  const heartbeats = useContentStore((s) => s.heartbeats)
  const subagentIds = ['basil', 'pixel', 'rolo', 'patch']
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

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

        {/* Connector */}
        <div className="w-px h-8 bg-border" />

        {/* Roscoe */}
        <AgentCard
          id="roscoe"
          heartbeat={heartbeats['roscoe'] as Heartbeat | undefined}
          onClick={() => setSelectedAgent('roscoe')}
        />

        {/* Connector */}
        <div className="w-px h-8 bg-border" />

        {/* Horizontal bar */}
        <div className="relative flex items-start justify-center gap-6">
          <div className="absolute top-0 left-[calc(50%-((4*144px+3*24px)/2))] w-[calc(4*144px+3*24px)] h-px bg-border" />
          {subagentIds.map((id) => (
            <div key={id} className="flex flex-col items-center">
              <div className="w-px h-8 bg-border" />
              <AgentCard
                id={id}
                heartbeat={heartbeats[id] as Heartbeat | undefined}
                onClick={() => setSelectedAgent(id)}
              />
            </div>
          ))}
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
