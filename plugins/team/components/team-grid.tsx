'use client'

import { useMemo, useCallback, useState } from 'react'
import { useRouter } from '@makinbakin/sdk/navigation'
import { Plus, Settings2, ScrollText } from 'lucide-react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  type Node,
  type NodeTypes,
  Position,
  Handle,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AgentAvatar,
  PageHeader,
  StatusBadge,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
  WorkflowPageBody,
  WorkflowPageCanvas,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Badge,
  BakinDrawer,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  SystemState,
} from '@makinbakin/sdk/ui'
import { useRuntimeStatus } from '@makinbakin/sdk/hooks'
import { useAgentStore, useMainAgentId, usePackageState, usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { buildGraph } from '../lib/build-graph'
import { AgentForm, type AgentFormData } from './agent-form'
import { TeamManager } from './team-manager'
import { PackageStateBadge, type PackageState } from './package-state-badge'
import type { AgentWithStatus } from '../types'
import './team-graph.css'

/**
 * Render a compact package badge on an agent card only when the state is
 * attention-worthy. Healthy states (managed/absent/undefined) leave
 * the card uncluttered — the convention is "no badge means OK."
 */
const ATTENTION_STATES: PackageState[] = ['unmanaged', 'drifted', 'update-available']
const TEAM_PAGE_DESCRIPTION = 'Create and organize agents, choose how they work, and see who is available.'

// ─── Custom Nodes ────────────────────────────────────────────────────────────

interface FounderNodeData extends Record<string, unknown> {
  label: string
  subtitle: string
}

function FounderNode({ data }: NodeProps) {
  const { label, subtitle } = data as FounderNodeData
  return (
    <div className="flex w-52 items-center justify-center gap-bakin-3 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-4 py-bakin-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-canvas-default" aria-hidden="true">
        👤
      </div>
      <div className="min-w-0">
        <div className="truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{label}</div>
        <div className="text-bakin-typography-size-meta text-bakin-text-muted">{subtitle}</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-border-subtle" />
    </div>
  )
}

interface AgentNodeData extends Record<string, unknown> {
  agent: AgentWithStatus
}

export function AgentCardNode({ data }: NodeProps) {
  const { agent } = data as AgentNodeData
  const pkgState = usePackageState(agent.id)
  const showBadge = pkgState && ATTENTION_STATES.includes(pkgState.state)

  const statusLabel =
    agent.status === 'working' ? 'working' :
    agent.status === 'online' ? 'online' :
    agent.status === 'available' ? 'available' :
    'offline'
  const statusTone = agent.status === 'working'
    ? 'attention'
    : agent.status === 'online' || agent.status === 'available'
      ? 'success'
      : 'neutral'

  return (
    <div
      data-team-agent-card=""
      className="flex w-52 cursor-pointer flex-col overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default"
    >
      <Handle type="target" position={Position.Top} className="!bg-bakin-border-subtle" />
      <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-bakin-canvas-default">
        {agent.headshot ? (
          <img
            src={agent.headshot}
            alt=""
            className="absolute inset-0 size-full object-cover object-top"
          />
        ) : (
          <AgentAvatar
            agent={{
              id: agent.id,
              name: agent.name,
              initials: agent.emoji || agent.name.charAt(0).toUpperCase(),
            }}
            size="xl"
            decorative
          />
        )}
        <div className="absolute right-bakin-2 top-bakin-2">
          <StatusBadge tone={statusTone} variant="solid" size="xs">
            {statusLabel}
          </StatusBadge>
        </div>
      </div>
      <div className="flex min-h-20 flex-1 flex-col items-center gap-bakin-1 p-bakin-3 text-center">
        <div className="flex w-full items-center justify-center gap-bakin-2 leading-tight">
          <span className="truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{agent.name}</span>
          {showBadge && pkgState && (
            <PackageStateBadge state={pkgState.state} compact />
          )}
        </div>
        <div
          className="line-clamp-3 w-full text-bakin-typography-size-meta leading-snug text-bakin-text-muted"
          title={agent.role || undefined}
        >
          {agent.role || 'No role assigned'}
        </div>
      </div>
      <div
        className="truncate border-t border-bakin-border-subtle bg-bakin-canvas-default px-bakin-3 py-bakin-2 text-center font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted"
        title={agent.model}
      >
        {agent.model}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-border-subtle" />
    </div>
  )
}

interface SectionNodeData extends Record<string, unknown> {
  label: string
  teamId?: string
  hasContext?: boolean
}

function SectionNode({ data }: NodeProps) {
  const { label, teamId, hasContext } = data as SectionNodeData
  const router = useRouter()
  return (
    <div className="flex items-center justify-center gap-bakin-1 px-bakin-4">
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={(e) => {
          e.stopPropagation()
          if (teamId) router.push(`/team/teams/${encodeURIComponent(teamId)}`)
        }}
        className="whitespace-nowrap uppercase tracking-widest text-bakin-text-muted"
        title={hasContext ? 'Team carries shared context — click to view' : 'Open team page'}
      >
        {label}
      </Button>
      {hasContext && (
        <ScrollText className="size-bakin-3 text-bakin-signal-info" aria-label={`${label} has shared context rules`} />
      )}
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

  // Badge data is best-effort: a failed fetch just renders no badges.
  const teamContextRes = usePluginJsonFetch<{
    ok?: boolean
    teams?: Array<{ teamId: string; content: string | null }>
  }>('team', 'context')
  const teamsWithContext = useMemo(() => {
    if (!teamContextRes.data?.ok) return new Set<string>()
    return new Set(
      (teamContextRes.data.teams ?? [])
        .filter((t) => (t.content ?? '').trim().length > 0)
        .map((t) => t.teamId),
    )
  }, [teamContextRes.data])
  const runtimeStatus = useRuntimeStatus()
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
      ? buildGraph({ agents: agentsWithStatus, teams, displaySettings, mainAgentId, teamsWithContext })
      : { nodes: [], edges: [] },
    [agentsWithStatus, teams, displaySettings, mainAgentId, loaded, teamsWithContext],
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
      <WorkspacePage mode="immersive">
        <WorkspacePageHeader>
          <PageHeader title="Team" description={TEAM_PAGE_DESCRIPTION} />
        </WorkspacePageHeader>
        <WorkspacePageCompactHeader
          title="Team"
          action={(
            <Button size="icon-sm" onClick={() => setShowCreate(true)} aria-label="New agent">
              <Plus aria-hidden="true" />
            </Button>
          )}
          overflowActionsLabel="Team actions"
          overflowActions={(
            <DropdownMenuItem onClick={() => setShowTeams(true)}>
              <Settings2 aria-hidden="true" />
              Manage teams
            </DropdownMenuItem>
          )}
        />
        <WorkspacePageBody>
          <WorkflowPageBody
            mode="contained"
            className="flex-1"
            state={(
              <SystemState
                kind="loading"
                scope="page"
                title="Loading your team"
                description="Reporting lines and agent availability will appear here when the roster is ready."
              />
            )}
          />
        </WorkspacePageBody>
      </WorkspacePage>
    )
  }

  return (
    <>
      <WorkspacePage mode="immersive">
        <WorkspacePageHeader>
          <PageHeader
            title="Team"
            description={TEAM_PAGE_DESCRIPTION}
            meta={<Badge size="xs" variant="outline">{agentsWithStatus.length} agents</Badge>}
            actions={(
              <>
                <Button variant="outline" onClick={() => setShowTeams(true)}>
                  <Settings2 />
                  Teams
                </Button>
                <Button onClick={() => setShowCreate(true)}>
                  <Plus />
                  New Agent
                </Button>
              </>
            )}
          />
        </WorkspacePageHeader>
        <WorkspacePageCompactHeader
          title="Team"
          action={(
            <Button size="icon-sm" onClick={() => setShowCreate(true)} aria-label="New agent">
              <Plus aria-hidden="true" />
            </Button>
          )}
          overflowActionsLabel="Team actions"
          overflowActions={(
            <DropdownMenuItem onClick={() => setShowTeams(true)}>
              <Settings2 aria-hidden="true" />
              Manage teams
            </DropdownMenuItem>
          )}
        />
        <WorkspacePageBody>
          <WorkflowPageBody
            mode="contained"
            className="h-full min-h-0 flex-1"
            feedback={runtimeStatus.restartNeeded ? (
              <Alert tone="attention">
                <AlertTitle>Runtime restart required</AlertTitle>
                <AlertDescription>
                  Agent configuration changed and is not active in the runtime yet.
                </AlertDescription>
                <AlertAction>
                  <Button
                    onClick={runtimeStatus.restart}
                    disabled={runtimeStatus.restarting}
                    variant="warning"
                    size="sm"
                  >
                    {runtimeStatus.restarting ? 'Restarting…' : 'Restart runtime'}
                  </Button>
                </AlertAction>
              </Alert>
            ) : undefined}
          >
            <WorkflowPageCanvas
              data-team-graph-canvas=""
              label="Team reporting graph"
              orientation="vertical"
              className="h-full min-h-bakin-32 flex-1 overflow-hidden rounded-none border-x-0 border-b-0"
            >
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
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  color="var(--bakin-color-border-subtle)"
                  gap={24}
                  size={1}
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            </WorkflowPageCanvas>
          </WorkflowPageBody>
        </WorkspacePageBody>
      </WorkspacePage>

      <BakinDrawer
        open={showCreate}
        onOpenChange={(o) => { if (!o) { setShowCreate(false); setPendingCreate(null); setCreateError(null) } }}
        title="New Agent"
        storageKey="team-new-agent"
      >
        <AgentForm
          onSubmit={handleFormSubmit}
          onCancel={() => setShowCreate(false)}
          submitting={submitting}
        />
      </BakinDrawer>

      {/* Confirm agent creation */}
      <Dialog open={!!pendingCreate} onOpenChange={(v) => { if (!v && !submitting) { setPendingCreate(null); setCreateError(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {pendingCreate?.data.name || 'agent'}?</DialogTitle>
            <DialogDescription>
              Register the agent in the active runtime and create its workspace.
            </DialogDescription>
          </DialogHeader>
          {createError && (
            <Alert tone="danger">
              <AlertTitle>Agent could not be created</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
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
              Save without restart
            </Button>
            <Button onClick={handleConfirmCreate} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create and restart'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BakinDrawer
        open={showTeams}
        onOpenChange={(o) => { if (!o) setShowTeams(false) }}
        title="Manage Teams"
        defaultWidth={480}
        storageKey="team-manager"
      >
        <TeamManager />
      </BakinDrawer>
    </>
  )
}
