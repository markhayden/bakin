'use client'

import { useMemo, useCallback, useState } from 'react'
import { useRouter } from '@bakin/sdk/hooks'
import { Plus, Users, Settings2, Loader2 } from 'lucide-react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  type Node,
  type NodeTypes,
  Position,
  Handle,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge } from "@bakin/sdk/ui"
import { Button } from "@bakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bakin/sdk/ui"
import { BakinDrawer } from "@bakin/sdk/components"
import { useGatewayStatus } from "@bakin/sdk/hooks"
import { useAgentStore, useAgentColor, useMainAgentId } from '@bakin/sdk/hooks'
import { buildGraph } from '../lib/build-graph'
import { AgentForm, type AgentFormData } from './agent-form'
import { TeamManager } from './team-manager'
import type { AgentWithStatus } from '../types'

/** Strip default ReactFlow node chrome + animated edges + hover glow */
const RESET_STYLES = `
  .react-flow__node {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
  }
  .react-flow__edge.animated path {
    stroke-dasharray: 6 3;
    animation: edgeFlow 1.5s linear infinite;
  }
  @keyframes edgeFlow {
    to { stroke-dashoffset: -18; }
  }
  .agent-card-hover {
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  }
  .agent-card-hover:hover {
    transform: translateY(-2px);
    box-shadow: 0 0 24px color-mix(in srgb, var(--agent-glow, #a1a1aa) 25%, transparent),
                0 8px 24px rgba(0,0,0,0.4);
    border-color: var(--agent-glow, #71717a) !important;
  }
`

// ─── Custom Nodes ────────────────────────────────────────────────────────────

interface FounderNodeData extends Record<string, unknown> {
  label: string
  subtitle: string
}

function FounderNode({ data }: NodeProps) {
  const { label, subtitle } = data as FounderNodeData
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-3 flex items-center justify-center gap-3 shadow-md w-[152px]">
      <div className="size-9 rounded-full bg-zinc-800 flex items-center justify-center text-base shrink-0">👤</div>
      <div>
        <div className="text-sm font-semibold text-zinc-100">{label}</div>
        <div className="text-xs text-zinc-400">{subtitle}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
    </div>
  )
}

interface AgentNodeData extends Record<string, unknown> {
  agent: AgentWithStatus
}

function AgentCardNode({ data }: NodeProps) {
  const { agent } = data as AgentNodeData
  const accentColor = useAgentColor(agent.id)

  const dotColor =
    agent.status === 'online' ? 'bg-green-400' :
    agent.status === 'working' ? 'bg-amber-400' :
    agent.status === 'available' ? 'bg-green-400/60' :
    'bg-zinc-500'

  const statusLabel =
    agent.status === 'working' ? 'working' :
    agent.status === 'online' ? 'online' :
    agent.status === 'available' ? 'available' :
    'offline'

  return (
    <div
      className="agent-card-hover rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden w-[152px] flex flex-col cursor-pointer shadow-md"
      style={{ '--agent-glow': accentColor } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
      <div className="relative w-full" style={{ paddingBottom: '100%' }}>
        <img
          src={agent.headshot}
          alt={agent.name}
          className="absolute inset-0 w-full h-full object-cover object-top"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
        <div
          className="absolute inset-0 flex items-center justify-center text-4xl"
          style={{ display: 'none' }}
          aria-hidden
        >
          {agent.emoji}
        </div>
        <div className={`absolute top-2 right-2 size-2.5 rounded-full border-2 border-zinc-900 ${dotColor}`} />
      </div>
      <div className="p-2.5 flex flex-col gap-0.5">
        <div className="text-sm font-semibold text-zinc-100 leading-tight">{agent.name}</div>
        <div className="text-xs text-zinc-500 leading-tight truncate">{agent.role}</div>
        <div className="flex items-center gap-1.5 mt-1.5">
          <Badge
            variant={agent.status === 'online' || agent.status === 'working' ? 'default' : 'secondary'}
            className="text-[10px] px-1.5 py-0"
          >
            {statusLabel}
          </Badge>
          <span className="text-[10px] text-zinc-500 font-mono truncate">{agent.model}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
    </div>
  )
}

interface SectionNodeData extends Record<string, unknown> {
  label: string
}

function SectionNode({ data }: NodeProps) {
  const { label } = data as SectionNodeData
  return (
    <div className="flex items-center gap-3 px-4">
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <div className="h-px flex-1 bg-zinc-700 w-16" />
      <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 whitespace-nowrap">
        {label}
      </span>
      <div className="h-px flex-1 bg-zinc-700 w-16" />
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  )
}

const nodeTypes: NodeTypes = {
  founder: FounderNode,
  agentCard: AgentCardNode,
  section: SectionNode,
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TeamGrid() {
  const router = useRouter()
  const agentsWithStatus = useAgentStore((s) => s.agentsWithStatus)
  const teams = useAgentStore((s) => s.teams)
  const displaySettings = useAgentStore((s) => s.displaySettings)
  const mainAgentId = useMainAgentId()
  const loaded = useAgentStore((s) => s.loaded)
  const reload = useAgentStore((s) => s.load)
  const [showCreate, setShowCreate] = useState(false)
  const [showTeams, setShowTeams] = useState(false)
  const gateway = useGatewayStatus()
  const [submitting, setSubmitting] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<{ data: AgentFormData; avatarFile: File | null } | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'agentCard') router.push(`/team/${node.id}`)
    },
    [router],
  )

  const { nodes, edges } = useMemo(
    () => loaded
      ? buildGraph({ agents: agentsWithStatus, teams, displaySettings, mainAgentId })
      : { nodes: [], edges: [] },
    [agentsWithStatus, teams, displaySettings, mainAgentId, loaded],
  )

  // Step 1: form submits → stash data and show confirmation dialog
  const handleFormSubmit = async (data: AgentFormData, avatarFile: File | null) => {
    setCreateError(null)
    setPendingCreate({ data, avatarFile })
  }

  // Step 2: user confirms → actually create the agent
  const handleConfirmCreate = async () => {
    if (!pendingCreate) return
    const { data, avatarFile } = pendingCreate

    setSubmitting(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/plugins/team/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json()
        setCreateError(err.error || 'Failed to create agent')
        return
      }

      // Upload avatar if provided
      if (avatarFile) {
        const formData = new FormData()
        formData.append('avatar', avatarFile)
        await fetch(`/api/plugins/team/${data.id}/avatar`, {
          method: 'POST',
          body: formData,
        })
      }

      setPendingCreate(null)
      setShowCreate(false)
      await reload()
      router.push(`/team/${data.id}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (!loaded) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <Users className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-semibold">Team</h1>
        </div>
        <div className="flex-1 bg-zinc-950 flex items-center justify-center">
          <div className="flex flex-wrap gap-4 justify-center">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="w-36 h-56 rounded-xl border border-zinc-800 bg-zinc-900 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <style dangerouslySetInnerHTML={{ __html: RESET_STYLES }} />

      {/* Sharp header bar — matches workflow detail */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Users className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Team</h1>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{agentsWithStatus.length}</Badge>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setShowTeams(true)}>
          <Settings2 className="size-4" />
          Teams
        </Button>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          New Agent
        </Button>
      </div>

      {/* Restart banner */}
      {gateway.restartNeeded && (
        <div className="flex items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-6 py-2.5">
          <span className="text-sm text-amber-400">
            Gateway config out of sync. Restart to apply changes.
          </span>
          <Button
            onClick={gateway.restart}
            disabled={gateway.restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {gateway.restarting ? 'Restarting...' : 'Restart Gateway'}
          </Button>
        </div>
      )}

      {/* Dark canvas — matches workflow detail */}
      <div className="flex-1 overflow-hidden bg-zinc-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.4}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          panOnScroll
          zoomOnScroll={false}
        >
          <Background variant={BackgroundVariant.Dots} color="#3f3f46" gap={24} size={1.5} />
        </ReactFlow>
      </div>

      <BakinDrawer
        open={showCreate}
        onOpenChange={(o) => { if (!o) { setShowCreate(false); setPendingCreate(null); setCreateError(null) } }}
        title="New Agent"
      >
        <AgentForm
          onSubmit={handleFormSubmit}
          onCancel={() => setShowCreate(false)}
          submitting={submitting}
        />
      </BakinDrawer>

      {/* Confirm agent creation */}
      <Dialog open={!!pendingCreate} onOpenChange={(v) => { if (!v && !submitting) { setPendingCreate(null); setCreateError(null) } }}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Create agent?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will register <span className="text-foreground font-medium">{pendingCreate?.data.name}</span> in
            OpenClaw and create its workspace.
          </p>
          {createError && (
            <p className="text-sm text-destructive">{createError}</p>
          )}
          <div className="flex flex-col gap-2 mt-2">
            <Button onClick={handleConfirmCreate} disabled={submitting}>
              {submitting ? <><Loader2 className="size-3.5 animate-spin mr-1.5" />Creating...</> : 'Create & Restart Gateway'}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!pendingCreate) return
                const { data, avatarFile } = pendingCreate
                setSubmitting(true)
                setCreateError(null)
                try {
                  const res = await fetch('/api/plugins/team/?skipRestart=true', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                  })
                  if (!res.ok) {
                    const err = await res.json()
                    setCreateError(err.error || 'Failed to create agent')
                    return
                  }
                  if (avatarFile) {
                    const formData = new FormData()
                    formData.append('avatar', avatarFile)
                    await fetch(`/api/plugins/team/${data.id}/avatar`, { method: 'POST', body: formData })
                  }
                  setPendingCreate(null)
                  setShowCreate(false)
                  await reload()
                  router.push(`/team/${data.id}`)
                } finally {
                  setSubmitting(false)
                }
              }}
              disabled={submitting}
            >
              Save Without Restart
            </Button>
            <p className="text-[11px] text-muted-foreground/70 text-center">
              Without a restart, the agent won&apos;t be live until the gateway is manually restarted.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <BakinDrawer
        open={showTeams}
        onOpenChange={(o) => { if (!o) setShowTeams(false) }}
        title="Manage Teams"
        defaultWidth={480}
      >
        <TeamManager />
      </BakinDrawer>
    </div>
  )
}
